import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { PreparedTaskManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type { ExecutionAuthorizationV2, RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import { planningReplyTextOf } from '../../../contracts/plan-round.js';
import { isPos as isPositiveInt, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import type { QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobRef, QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../../contracts/query-job.js';
import { consultationQueryRefs, interventionPlanningQueryRefs } from '../../../contracts/query-job.js';
import type { MessageQueryAnswerSender, MessageWorkRunSender, SessionMessage } from '../model/communication-contracts.js';
import { interventionGoalRefOf } from '../model/communication-contracts.js';
import type { TaskClaimOutbox } from '../model/claim-contracts.js';
import type { TaskExecutionRecord } from '../model/execution-read-contracts.js';
import type { SecretaryQueryRunV1 } from '../model/secretary-query-run-contracts.js';
import { decodeQueryJobAnswerSnapshot, decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord } from '../queries/query-record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import type { DecodeResult, EncodedRecord, GoalRecordTransactionPort, RecordBatchRead, StoreResult } from '../../record-store/ports.js';
import { decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { SESSION_MESSAGE_MAX_TEXT_BYTES } from '../sessions/message-record-codecs.js';
import { decodeDispatchOutboxEntry, dispatchOutboxRefKey } from '../tasks/claim-record-codecs.js';
import { readStoredManifest, recheckHostRoleAdmission } from '../tasks/execution-entry-service.js';
import { readBatch, readGoal } from '../tasks/plan-readers.js';
import type { QueryAnswerBinding } from '../state/message-machine.js';
import {
  identityKeyOf, internalHostContext, isolatedContext, isUserRecipient, mapBatchFailure, mapReadResult, ownContext,
  presenceOf, senderIdentityOf,
} from './mailbox-common.js';
import type {
  AuthOutcome, FactsOutcome, IdentityOutcome, MailboxContext, Owned, QueryAnswerFacts, QueryRecordRead, WorkRunPrincipal,
} from './mailbox-types.js';

/**
 * MSG-06's consultation binding in today's check order. A derived A′ answer is
 * answered by the CHILD Session, while the original message recipient (source
 * A) stays the formal source: the two are never conflated and the derivation
 * must name that exact source.
 */
function consultationBindingOf(job: QueryJobSnapshot, run: QueryRunSnapshot, messageRef: SessionMessageRef, recipient: SessionRef): {
  binding: QueryAnswerBinding; answererSession: SessionRef | null;
} {
  const execution = job.job.intent.execution;
  // The intervention planning Query is the second Host-only answer association: it must name exactly this source
  // message or the executor message frozen on `repliesToMessageRef` (a planresume/planfix continuation), and exactly
  // its own deterministic Job/Run pair. It is never dressed up as a consultation; the caller line, the settled
  // Answer and the claimed Session generation stay with the shared guards below.
  if (execution.kind === 'intervention_planning') {
    const source = execution.sourceMessageRef as SessionMessageRef;
    const repliesTo = execution.repliesToMessageRef;
    if (canonicalOf(source) !== canonicalOf(messageRef)
      && (repliesTo === undefined || canonicalOf(repliesTo) !== canonicalOf(messageRef))) {
      return { binding: 'other_message', answererSession: null };
    }
    const refs = interventionPlanningQueryRefs(source);
    if (refs.queryJobRef.queryJobId !== job.job.queryJobId || refs.queryRunRef.runId !== run.run.runId) {
      return { binding: 'other_query_identity', answererSession: null };
    }
    return { binding: 'matches', answererSession: recipient };
  }
  const consultation = execution.consultation;
  if (execution.kind !== 'semantic_query' || consultation === undefined) {
    return { binding: 'other_message', answererSession: null };
  }
  if (canonicalOf(consultation.messageRef) !== canonicalOf(messageRef)) return { binding: 'other_message', answererSession: null };
  if (canonicalOf(consultation.recipient) !== canonicalOf(recipient)) return { binding: 'other_recipient', answererSession: null };
  const derivation = consultation.derivation;
  if (derivation !== undefined && canonicalOf(derivation.sourceSessionRef) !== canonicalOf(recipient)) {
    return { binding: 'other_derivation_source', answererSession: null };
  }
  const answererSession = derivation === undefined
    ? recipient
    : { projectId: derivation.childSessionRef.projectId, sessionId: derivation.childSessionRef.sessionId };
  const refs = consultationQueryRefs(consultation.messageRef);
  if (refs.queryJobRef.queryJobId !== job.job.queryJobId || refs.queryRunRef.runId !== run.run.runId) {
    return { binding: 'other_query_identity', answererSession };
  }
  return { binding: 'matches', answererSession };
}

// --------------------------------------------------------------------------
// Identity, messageId and fingerprints
// --------------------------------------------------------------------------

/**
 * One exact Query-family record read for the exported read-only helper below:
 * the same decoders and failure translation the mailbox's own loaders use, but
 * over a plain `records` read port and without a mailbox instance.
 */
async function readStoredQueryRecord<T>(
  records: Pick<GoalRecordTransactionPort, 'readMany'>,
  ref: unknown,
  decode: (record: EncodedRecord) => DecodeResult<T>,
  what: string,
): Promise<ReadResult<T>> {
  const key = canonicalOf(ref);
  if (key === null) return reject('invalid', `the ${what} ref is not canonicalizable JSON`);
  let read: StoreResult<RecordBatchRead>;
  try {
    read = await records.readMany([key]);
  } catch {
    return reject('unavailable', 'the Query record could not be read');
  }
  if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    return read.value.missing.includes(key)
      ? { status: 'not_found' }
      : reject('unavailable', 'the record store neither returned nor reported missing the Query record');
  }
  const decoded = decode(record);
  if (decoded.status !== 'decoded') return reject('unavailable', `the ${what} snapshot is damaged: ${decoded.reason}`);
  return { status: 'ready', value: decoded.value };
}

/**
 * The read-only identity of a formal Query-answer reply commit (§6.4.2,
 * DR-P2-03): from source R's deterministic intervention-planning Query and its
 * settled formal Answer, restore the SAME `query_run` sender the
 * `respond_from_query_answer` arm derives, then return the exact commit
 * identity. It reuses `senderIdentityOf` and `identityKeyOf`; it writes no
 * record, adds no mailbox method, and copies no hash. The caller reads the
 * receipt cursor with `readCommitByIdentity`. The Query lives in
 * `queryWorkspaceId` (the workspace of the Goal R names); `ctx` is bound to R's
 * own workspace, where the reply's identity was taken.
 */
export async function respondReceiptIdentityOf(
  ctx: CoreCallContext,
  records: Pick<GoalRecordTransactionPort, 'readMany'>,
  source: SessionMessageRef,
  requestId: string,
  queryWorkspaceId: string,
): Promise<ReadResult<string>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  if (!nonEmpty(requestId)) return reject('invalid', 'the reply request id must be a non-empty string');
  const refs = interventionPlanningQueryRefs(source, queryWorkspaceId);
  const jobRead = await readStoredQueryRecord(records, refs.queryJobRef, decodeQueryJobSnapshot, 'QueryJob');
  if (jobRead.status !== 'ready') return jobRead;
  const job = jobRead.value;
  const execution = job.job.intent.execution;
  if (execution.kind !== 'intervention_planning'
    || canonicalOf(execution.sourceMessageRef) !== canonicalOf(source)) {
    return { status: 'not_found' };
  }
  const answerRef = job.job.answerRefs.at(-1);
  if (answerRef === undefined) return { status: 'not_found' };
  const answerRead = await readStoredQueryRecord(records, answerRef, decodeQueryJobAnswerSnapshot, 'QueryJobAnswer');
  if (answerRead.status !== 'ready') return answerRead;
  const answer = answerRead.value;
  const runRead = await readStoredQueryRecord(records, answer.answer.runRef, decodeQueryRunSnapshotRecord, 'QueryRun');
  if (runRead.status !== 'ready') return runRead;
  const state = runRead.value.run.executionState;
  const generation = state?.sessionGeneration;
  if (state === undefined || !isPositiveInt(generation)) {
    return reject('unavailable', 'the QueryRun Session generation is not readable');
  }
  const sender: MessageQueryAnswerSender = {
    kind: 'query_run',
    sessionRef: { projectId: state.sessionRef.projectId, sessionId: state.sessionRef.sessionId },
    queryRunRef: { ...answer.answer.runRef },
    answerRef: { ...answerRef },
    generation,
  };
  return {
    status: 'ready',
    value: identityKeyOf('respond_from_query_answer', owned, senderIdentityOf(sender), requestId),
  };
}

// ---- exact Run/outbox/Session identity (historical reads) ---------------

/** The fresh full WG11 snapshot a NEW work_run write needs. */
export async function readFreshWorkRunFacts(mailbox: MailboxContext, owned: Owned, runRef: WorkRunPrincipal['runRef']): Promise<FactsOutcome> {
  if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox write was cancelled before locating the Run') };
  let result: ReadResult<TaskExecutionRecord>;
  try {
    result = await mailbox.deps.executions.readExecution(internalHostContext(mailbox, owned), runRef);
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the formal execution facts could not be read') };
  }
  if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox write was cancelled during the execution read') };
  if (result.status === 'ready') return { ok: true, record: result.value };
  if (result.status === 'not_found') return { ok: false, rejection: reject('not_found', 'the formal execution Run does not exist') };
  if (result.status === 'not_ready') return { ok: false, rejection: reject('incomplete', 'the formal execution Run is not readable at the required watermark') };
  return { ok: false, rejection: result };
}

/**
 * Historical identity loader: exactly the Run, its claim-linked outbox and the
 * Session those name. It deliberately does NOT read the Plan, TaskAttempt or
 * TaskLease, so an unrelated missing/faulty record can never block reading a
 * committed message. It proves the complete RunRef, the original Role binding,
 * the claim/attempt/Session association, the workspace and the reader/requester
 * (the latter already bound by `ownContext`) from one final consistent window.
 * It is a read-only identity proof, never a current write permit.
 */
export async function readWorkRunIdentity(mailbox: MailboxContext, owned: Owned, principal: WorkRunPrincipal, runRef: WorkRunPrincipal['runRef']): Promise<IdentityOutcome> {
  const runKey = canonicalOf(runRef);
  if (runKey === null) return { ok: false, rejection: reject('invalid', 'the Run ref is not canonicalizable JSON') };
  for (let round = 0; round < 4; round += 1) {
    if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox read was cancelled before locating the Run') };
    const runRead = await readBatch(mailbox.records, [runKey]);
    if (runRead.status !== 'ready') return { ok: false, rejection: mapBatchFailure(mailbox, runRead) };
    const runPresence = presenceOf(mailbox, runRead.batch, runKey);
    if (runPresence === 'missing') return { ok: false, rejection: reject('not_found', 'the formal execution Run does not exist') };
    if (runPresence === 'unaccounted') return { ok: false, rejection: reject('unavailable', 'the Run key was neither returned nor reported missing') };
    const runDecoded = decodeRun(runRead.batch.present.get(runKey) as EncodedRecord);
    if (!runDecoded.ok) return { ok: false, rejection: reject('unavailable', `the Run is damaged: ${runDecoded.reason}`) };
    const discovered = runDecoded.value;
    const outboxKey = dispatchOutboxRefKey({
      aggregateType: 'DispatchOutboxEntry', projectId: discovered.task.projectId,
      goalId: discovered.task.goalId, taskId: discovered.task.taskId, attemptId: discovered.attemptId,
    });
    const outboxRead = await readBatch(mailbox.records, [outboxKey]);
    if (outboxRead.status !== 'ready') return { ok: false, rejection: mapBatchFailure(mailbox, outboxRead) };
    const outboxPresence = presenceOf(mailbox, outboxRead.batch, outboxKey);
    if (outboxPresence === 'unaccounted') return { ok: false, rejection: reject('unavailable', 'the claim outbox was neither returned nor reported missing') };
    if (outboxPresence === 'missing') return { ok: false, rejection: reject('incomplete', 'the claim-linked dispatch outbox is missing') };
    const linked = decodeDispatchOutboxEntry(outboxRead.batch.present.get(outboxKey) as EncodedRecord);
    if (linked.status !== 'decoded') return { ok: false, rejection: reject('unavailable', `the dispatch outbox is damaged: ${linked.reason}`) };
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(linked.value.claim.sessionRef));

    const finalKeys = [...new Set([runKey, outboxKey, sessionKey])];
    const finalRead = await readBatch(mailbox.records, finalKeys);
    if (finalRead.status !== 'ready') return { ok: false, rejection: mapBatchFailure(mailbox, finalRead) };
    for (const key of finalKeys) {
      if (presenceOf(mailbox, finalRead.batch, key) === 'unaccounted') {
        return { ok: false, rejection: reject('unavailable', 'a requested identity key was neither returned nor reported missing') };
      }
    }
    if (presenceOf(mailbox, finalRead.batch, runKey) === 'missing') return { ok: false, rejection: reject('not_found', 'the formal execution Run does not exist') };
    if (presenceOf(mailbox, finalRead.batch, outboxKey) === 'missing') return { ok: false, rejection: reject('incomplete', 'the claim-linked dispatch outbox is missing') };
    if (presenceOf(mailbox, finalRead.batch, sessionKey) === 'missing') return { ok: false, rejection: reject('incomplete', 'the claim-linked Session is missing') };
    const finalRunDecoded = decodeRun(finalRead.batch.present.get(runKey) as EncodedRecord);
    if (!finalRunDecoded.ok) return { ok: false, rejection: reject('unavailable', `the Run is damaged: ${finalRunDecoded.reason}`) };
    const finalRun = finalRunDecoded.value;
    const finalLinked = decodeDispatchOutboxEntry(finalRead.batch.present.get(outboxKey) as EncodedRecord);
    if (finalLinked.status !== 'decoded') return { ok: false, rejection: reject('unavailable', `the dispatch outbox is damaged: ${finalLinked.reason}`) };
    const finalOutbox = finalLinked.value;
    const finalSessionDecoded = decodeSessionRecord(finalRead.batch.present.get(sessionKey) as EncodedRecord);
    if (finalSessionDecoded.status !== 'decoded') return { ok: false, rejection: reject('unavailable', `the Session is damaged: ${finalSessionDecoded.reason}`) };
    const session = finalSessionDecoded.value;

    const finalOutboxKey = dispatchOutboxRefKey({
      aggregateType: 'DispatchOutboxEntry', projectId: finalRun.task.projectId,
      goalId: finalRun.task.goalId, taskId: finalRun.task.taskId, attemptId: finalRun.attemptId,
    });
    const finalSessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(finalOutbox.claim.sessionRef));
    if (finalOutboxKey !== outboxKey || finalSessionKey !== sessionKey) continue;

    if (canonicalOf(finalRun.ref) !== runKey) return { ok: false, rejection: reject('unavailable', 'the Run ref is not the requested key') };
    // The trusted principal's ORIGINAL binding identity must be the persisted
    // Run binding. A later Role-matrix revocation is deliberately NOT evaluated
    // here, so a committed receipt/read is never erased by a governance change.
    if (canonicalOf(principal.roleBinding) !== canonicalOf(finalRun.roleBinding)) {
      return { ok: false, rejection: reject('forbidden', 'the caller role binding is not the persisted Run role binding') };
    }
    if (finalRun.task.projectId !== owned.projectId) return { ok: false, rejection: reject('forbidden', 'the Run belongs to another project') };
    const claim = finalOutbox.claim;
    if (canonicalOf(claim.runRef) !== runKey) return { ok: false, rejection: reject('unavailable', 'the claim names another Run') };
    if (canonicalOf(claim.attemptRef) !== canonicalOf({
      aggregateType: 'TaskAttempt', projectId: finalRun.task.projectId, goalId: finalRun.task.goalId,
      taskId: finalRun.task.taskId, attemptId: finalRun.attemptId,
    })) return { ok: false, rejection: reject('unavailable', 'the claim names another Attempt than the Run') };
    // Rule W: the Run and its claim live in the Run's workspace; the line may
    // live elsewhere, so the Session's workspace is no longer compared here.
    if (claim.workspaceId !== owned.workspaceId || finalRun.workspaceSnapshot.workspaceId !== owned.workspaceId) {
      return { ok: false, rejection: reject('forbidden', 'the Run/claim workspace is not the bound workspace') };
    }
    if (canonicalOf(session.ref) !== sessionKey) return { ok: false, rejection: reject('unavailable', 'the Session ref is not the claimed key') };
    if (claim.sessionRef.projectId !== session.ref.projectId || claim.sessionRef.sessionId !== session.ref.sessionId) {
      return { ok: false, rejection: reject('unavailable', 'the claim Session mapping changed') };
    }
    return { ok: true, run: finalRun, claim, session };
  }
  return { ok: false, rejection: reject('busy', 'the execution identity references changed in every final read window') };
}

export function deriveWorkRunSender(mailbox: MailboxContext, identity: { run: RunSnapshot; claim: TaskClaimOutbox['claim'] }): { ok: true; sender: MessageWorkRunSender } | { ok: false; rejection: CoreRejection } {
  const claim = identity.claim;
  if (!isPositiveInt(claim.generation)) return { ok: false, rejection: reject('unavailable', 'the claim generation is not readable') };
  if (!isObject(identity.run.roleBinding)) return { ok: false, rejection: reject('unavailable', 'the Run role binding is not readable') };
  const sender: MessageWorkRunSender = {
    kind: 'work_run',
    sessionRef: { projectId: claim.sessionRef.projectId, sessionId: claim.sessionRef.sessionId },
    runRef: { aggregateType: 'Run', projectId: identity.run.ref.projectId, goalId: identity.run.ref.goalId, runId: identity.run.ref.runId },
    roleBinding: {
      schemaVersion: 1,
      bindingId: identity.run.roleBinding.bindingId,
      templateId: identity.run.roleBinding.templateId,
      templateRevision: identity.run.roleBinding.templateRevision,
      bindingVersion: identity.run.roleBinding.bindingVersion,
      policyRevision: identity.run.roleBinding.policyRevision,
    },
    generation: claim.generation,
  };
  return { ok: true, sender };
}

// ---- new work_run action authorization ----------------------------------

/** The saved manifest must describe exactly the same formal claim/envelope/Session. */
function manifestAgainstRun(mailbox: MailboxContext, manifest: PreparedTaskManifestV1, record: TaskExecutionRecord, bodyDigest: string,
  authorization: ExecutionAuthorizationV2): CoreRejection | null {
  const { run, outbox, session } = record;
  if (canonicalOf(manifest.claim) !== canonicalOf(outbox.claim)) return reject('forbidden', 'the saved manifest claim disagrees with the persisted claim');
  if (canonicalOf(manifest.roleBinding) !== canonicalOf(run.roleBinding)) return reject('forbidden', 'the saved manifest role binding disagrees with the Run');
  if (canonicalOf(manifest.workspaceSnapshot) !== canonicalOf(run.workspaceSnapshot)) return reject('forbidden', 'the saved manifest workspace snapshot disagrees with the Run');
  if (canonicalOf(manifest.budget) !== canonicalOf(run.budget)) return reject('forbidden', 'the saved manifest budget disagrees with the Run');
  if (canonicalOf(manifest.sessionRole) !== canonicalOf(session.role)) return reject('forbidden', 'the saved manifest session role disagrees with the Session');
  const envelope = run.envelope;
  if (envelope === null) return reject('forbidden', 'the Run has no saved prepared envelope');
  if (canonicalOf(manifest.permissions) !== canonicalOf(envelope.permissions)) return reject('forbidden', 'the saved manifest permissions disagree with the Run envelope');
  const inputBinding = run.inputBinding;
  if (inputBinding === undefined) return reject('forbidden', 'the Run has no persisted input binding');
  if (bodyDigest !== inputBinding.manifestDigest) {
    return reject('forbidden', 'the saved manifest body digest disagrees with the Run input binding');
  }
  if (manifest.inputDigest !== inputBinding.inputDigest) return reject('forbidden', 'the saved manifest input digest disagrees with the Run input binding');
  if (manifest.inputDigest !== authorization.inputDigest) return reject('forbidden', 'the saved manifest input digest disagrees with the Run entry binding');
  return null;
}

export async function authorizeNewWorkRunAction(mailbox: MailboxContext, args: {
  owned: Owned;
  principal: WorkRunPrincipal;
  operationToolName: string;
}): Promise<AuthOutcome> {
  const { owned, principal, operationToolName } = args;
  // A NEW work_run write needs the fresh Host/Role admission dependency. Without
  // it the write is explicitly unsupported and can never fall back to the weaker
  // envelope-only authorization. Replay already returned above, so historical
  // receipts stay readable.
  const admission = mailbox.deps.runtimeAdmission;
  if (admission === undefined) {
    return { ok: false, rejection: reject('unsupported', 'a new work_run mailbox write requires the fresh Host admission dependency') };
  }
  // Fresh write: re-read the full WG11 snapshot (the stable identity loader's
  // snapshot is never reused here) and re-check the current world.
  const fresh = await readFreshWorkRunFacts(mailbox, owned, principal.runRef);
  if (!fresh.ok) return { ok: false, rejection: fresh.rejection };
  const record = fresh.record;
  const { run, session, lease, outbox } = record;
  const claim = outbox.claim;
  if (canonicalOf(principal.roleBinding) !== canonicalOf(run.roleBinding)) {
    return { ok: false, rejection: reject('forbidden', 'the caller role binding is not the Run role binding') };
  }
  if (run.status !== 'running') return { ok: false, rejection: reject('forbidden', 'the Run is not running') };
  if (run.outcome !== null) return { ok: false, rejection: reject('forbidden', 'the Run is already terminal') };
  if (session.lifecycle !== 'active') return { ok: false, rejection: reject('forbidden', 'the sender Session is not active') };
  const occupancy = session.occupancy;
  if (occupancy === null || occupancy.kind !== 'execution'
    || canonicalOf(occupancy.executionRef) !== canonicalOf(run.ref)
    || occupancy.generation !== claim.generation) {
    return { ok: false, rejection: reject('forbidden', 'the sender Session is not occupied by this exact Run generation') };
  }
  if (lease === null) {
    return { ok: false, rejection: reject('forbidden', 'the TaskLease is not held by this exact Run and attempt') };
  }
  if (canonicalOf(claim.runRef) !== canonicalOf(run.ref)
    || canonicalOf(claim.attemptRef) !== canonicalOf({
      aggregateType: 'TaskAttempt', projectId: run.ref.projectId, goalId: run.ref.goalId,
      taskId: run.task.taskId, attemptId: run.attemptId,
    })
    || claim.sessionRef.projectId !== session.ref.projectId
    || claim.sessionRef.sessionId !== session.ref.sessionId
    || claim.generation !== occupancy.generation) {
    return { ok: false, rejection: reject('forbidden', 'the claim does not match the Run, attempt and Session') };
  }
  const authorization = run.executionAuthorization;
  if (authorization?.phase !== 'entered' || authorization.sessionGeneration !== claim.generation) {
    return { ok: false, rejection: reject('forbidden', 'the Run has not entered with this Session generation') };
  }
  if (authorization.kernel === null
    || authorization.kernel.adapterId !== session.kernel.adapterId
    || authorization.kernel.kernelSessionId !== session.kernel.kernelSessionId) {
    return { ok: false, rejection: reject('forbidden', 'the entered kernel binding does not match the Session mapping') };
  }
  const envelope = run.envelope;
  if (envelope === null || envelope === undefined) {
    return { ok: false, rejection: reject('forbidden', 'a new mailbox action requires a bound envelope') };
  }
  if (canonicalOf(envelope.runRef) !== canonicalOf(run.ref)
    || canonicalOf(envelope.attemptRef) !== canonicalOf(claim.attemptRef)
    || canonicalOf(envelope.planRef) !== canonicalOf(run.planRef)
    || canonicalOf(envelope.roleBinding) !== canonicalOf(run.roleBinding)
    || envelope.projectId !== owned.projectId
    || envelope.workspaceId !== owned.workspaceId
    || envelope.goalId !== run.ref.goalId
    || envelope.taskId !== run.task.taskId
    || !envelope.permissions.tools.includes(operationToolName)) {
    return { ok: false, rejection: reject('forbidden', 'the envelope does not authorize this mailbox operation for this Run') };
  }
  if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox action was cancelled before the stored manifest read') };
  // The SAME verified Run envelope carries the exact prepared manifest; this is
  // the one manifest parser (no second body parser) and the one Host/Role
  // re-check (no second Role parser). The operation grant comes from the
  // manifest permissions the Host/Role re-check just accepted.
  let stored;
  try {
    stored = await readStoredManifest({ bodies: admission.bodies }, run);
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the saved prepared manifest could not be read') };
  }
  if (!stored.ok) return { ok: false, rejection: stored.rejection };
  const manifest = stored.value.manifest;
  const manifestProblem = manifestAgainstRun(mailbox, manifest, record, stored.value.bodyDigest, authorization);
  if (manifestProblem !== null) return { ok: false, rejection: manifestProblem };
  if (!manifest.permissions.tools.includes(operationToolName)) {
    return { ok: false, rejection: reject('forbidden', `the current Host/Role grant does not include ${operationToolName}`) };
  }
  if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox action was cancelled before role resolution') };
  let hostRole;
  // Rule W: the Host/Role recheck reads the line's workspace; the Run facts it
  // compares stay the Run's.
  const lineCtx = { ...internalHostContext(mailbox, owned), workspaceId: session.workspaceId };
  try {
    hostRole = await recheckHostRoleAdmission(
      { roles: mailbox.deps.roles, authorizeConfiguration: admission.authorizeConfiguration },
      lineCtx,
      {
        run, manifestRole: manifest.role, sessionRole: session.role, roleBinding: run.roleBinding,
        permissions: manifest.permissions, hostTemplate: manifest.hostTemplate,
        configurationRevision: manifest.hostConfigurationRevision,
      },
    );
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the current Host/Role admission could not be verified') };
  }
  if (!hostRole.ok) return { ok: false, rejection: hostRole.rejection };
  if (owned.signal.aborted) return { ok: false, rejection: reject('cancelled', 'the mailbox action was cancelled during role resolution') };
  const runKey = canonicalOf(run.ref) ?? '';
  const sessionKey = canonicalOf(session.ref) ?? '';
  const leaseKey = canonicalOf(lease.ref) ?? '';
  const merged = mergeGuards([
    { refKey: runKey, expectedRevision: run.revision },
    { refKey: sessionKey, expectedRevision: session.revision },
    { refKey: leaseKey, expectedRevision: lease.revision },
    ...hostRole.value.roleFacts.guards,
  ]);
  if (!merged.ok) return { ok: false, rejection: merged.rejection };
  return { ok: true, guards: merged.guards };
}

// ---- official Query answer reads (read-only, codec-owned) ----------------

export async function loadQueryJob(mailbox: MailboxContext, owned: Owned, ref: QueryJobRef): Promise<QueryRecordRead<QueryJobSnapshot>> {
  if (owned.signal.aborted) return reject('cancelled', 'the QueryJob read was cancelled');
  return readStoredQueryRecord(mailbox.records, ref, decodeQueryJobSnapshot, 'QueryJob');
}

export async function loadQueryRun(mailbox: MailboxContext, owned: Owned, ref: QueryRunRef): Promise<QueryRecordRead<QueryRunSnapshot>> {
  if (owned.signal.aborted) return reject('cancelled', 'the QueryRun read was cancelled');
  return readStoredQueryRecord(mailbox.records, ref, decodeQueryRunSnapshotRecord, 'QueryRun');
}

export async function loadQueryAnswer(mailbox: MailboxContext, owned: Owned, ref: QueryJobAnswerRef): Promise<QueryRecordRead<QueryJobAnswerSnapshot>> {
  if (owned.signal.aborted) return reject('cancelled', 'the QueryJobAnswer read was cancelled');
  return readStoredQueryRecord(mailbox.records, ref, decodeQueryJobAnswerSnapshot, 'QueryJobAnswer');
}

/**
 * MSG-06's facts, read in today's order: the Answer, its QueryJob and its
 * QueryRun (a failed read keeps today's rejection). The body and the
 * `query_run` sender come from the settled Answer/Job/Run, never from caller
 * text or caller identity.
 */
export async function readQueryAnswerFacts(mailbox: MailboxContext, owned: Owned, message: SessionMessage, answerRef: QueryJobAnswerRef): Promise<
  { ok: true; facts: QueryAnswerFacts } | { ok: false; rejection: CoreRejection }> {
  const answerRead = await loadQueryAnswer(mailbox, owned, answerRef);
  if (answerRead.status !== 'ready') return { ok: false, rejection: mapReadResult(answerRead) as CoreRejection };
  const answer = answerRead.value;
  const jobRead = await loadQueryJob(mailbox, owned, answer.answer.queryJobRef);
  if (jobRead.status !== 'ready') return { ok: false, rejection: mapReadResult(jobRead) as CoreRejection };
  const job = jobRead.value;
  const runRead = await loadQueryRun(mailbox, owned, answer.answer.runRef);
  if (runRead.status !== 'ready') return { ok: false, rejection: mapReadResult(runRead) as CoreRejection };
  const run = runRead.value;

  const messageRecipient = message.recipient;
  if (isUserRecipient(messageRecipient)) {
    // Slice 5: a user-recipient decision card is answered through the decision
    // owner, never by associating a formal Query Answer with it.
    return { ok: false, rejection: reject('invalid', 'a user-recipient message cannot be answered by a Query Answer association') };
  }
  const recipient = { projectId: messageRecipient.projectId, sessionId: messageRecipient.sessionId };
  const { binding, answererSession } = consultationBindingOf(job, run, message.ref, recipient);
  const state = run.run.executionState;
  const settlement: QueryAnswerFacts['verdict']['run'] = state === undefined || state.phase !== 'settled' ? 'not_settled'
    : run.run.status !== 'answered' || run.run.outcome !== 'answered' ? 'not_answered' : 'settled_answered';
  const generation = state?.sessionGeneration;
  const answerText = answer.answer.answer;
  // DR-P2-05: a planning line's reply is the DERIVED short text, then held to
  // the ordinary 16 KiB reply bound; the source Answer may itself be the
  // 256 KiB planning answer. An ordinary consultation keeps its original text.
  // A plan_review answer that no longer parses has no reply (`null`): the
  // machine's `bodyBounded` guard refuses the write before this arm runs.
  const execution = job.job.intent.execution;
  const replyText = execution.kind === 'intervention_planning'
    ? planningReplyTextOf({
      shape: execution.answerShape ?? 'text', answerText, queryJobId: job.job.queryJobId,
    })
    : answerText;
  const text = replyText ?? answerText;
  return {
    ok: true,
    facts: {
      verdict: {
        binding,
        jobAnsweredWithAnswer: job.job.status === 'answered'
          && job.job.answerRefs.some((candidate) => canonicalOf(candidate) === canonicalOf(answerRef)),
        run: settlement,
        answeringSessionIsClaimSession: state !== undefined && answererSession !== null
          && state.sessionRef.projectId === answererSession.projectId && state.sessionRef.sessionId === answererSession.sessionId,
        answerOfRun: canonicalOf(answer.answer.runRef) === canonicalOf(run.ref),
        sessionGenerationReadable: isPositiveInt(generation),
      },
      bodyBounded: replyText !== null && text.length > 0
        && Buffer.byteLength(text, 'utf8') <= SESSION_MESSAGE_MAX_TEXT_BYTES,
      text,
      answerSource: answer.answer.bodyRef.source,
      sender: answererSession === null || !isPositiveInt(generation) ? null : {
        kind: 'query_run',
        sessionRef: { projectId: answererSession.projectId, sessionId: answererSession.sessionId },
        queryRunRef: { ...answer.answer.runRef },
        answerRef: { ...answerRef },
        generation,
      },
    },
  };
}

/**
 * The one secretary-round resolution: the resolver runs after a receipt miss
 * (or on every read) and the resolved round must be exactly the literal
 * QueryRun caller and scope. Each entry keeps its own required injections and
 * business authorization, and the withdraw shares the session-project check.
 */
export async function resolveSecretaryRound(mailbox: MailboxContext, owned: Owned):
Promise<{ ok: true; round: SecretaryQueryRunV1 } | { ok: false; rejection: CoreRejection }> {
  if (owned.principal.kind !== 'query_run') {
    return { ok: false, rejection: reject('forbidden', 'the secretary round requires a query_run caller') };
  }
  if (mailbox.deps.secretaryRounds === undefined) {
    return { ok: false, rejection: reject('unsupported', 'the secretary round is not configured') };
  }
  let resolved: { status: 'ready'; value: SecretaryQueryRunV1 } | CoreRejection;
  try {
    resolved = await mailbox.deps.secretaryRounds.resolveSecretaryQueryRun(isolatedContext(owned));
  } catch {
    return { ok: false, rejection: reject('unavailable', 'the secretary round could not be resolved') };
  }
  if (resolved.status !== 'ready') return { ok: false, rejection: resolved };
  const round = resolved.value;
  if (canonicalOf(round.run) !== canonicalOf(owned.principal.queryRunRef)
    || round.scope.projectId !== owned.projectId || round.scope.workspaceId !== owned.workspaceId
    || round.session.projectId !== owned.projectId) {
    return { ok: false, rejection: reject('forbidden', 'the resolved round is not this QueryRun caller') };
  }
  return { ok: true, round };
}

/**
 * The one secretary read admission: the resolver runs on every `query_run`
 * read (there is no receipt to miss), and its Session is the reader. It reads
 * no message, no owner and no outbox.
 */
export async function secretaryReader(mailbox: MailboxContext, owned: Owned): Promise<
  { ok: true; round: SecretaryQueryRunV1; reader: SessionRef } | { ok: false; rejection: CoreRejection }
> {
  if (owned.principal.kind !== 'query_run') {
    return { ok: false, rejection: reject('forbidden', 'the secretary reader requires a query_run caller') };
  }
  if (mailbox.deps.secretaryRounds === undefined || mailbox.deps.requestOwners === undefined
    || mailbox.deps.recipientExecutions === undefined) {
    return { ok: false, rejection: reject('unsupported', 'the secretary mailbox read is not configured') };
  }
  const resolved = await resolveSecretaryRound(mailbox, owned);
  if (!resolved.ok) return resolved;
  return { ok: true, round: resolved.round, reader: { ...resolved.round.session } };
}

/**
 * The ONE narrow system-Host withdraw exception: the message must be the exact source of a formally ended
 * `intervention_planning` Query with no usable Answer, claimed on the very line the message is addressed to. Every
 * read failure is returned; a not-found or mismatched fact is not an exception.
 */
export async function interventionSourceFormallyEnded(mailbox: MailboxContext, owned: Owned, message: SessionMessage):
Promise<{ ok: true } | { ok: false; rejection?: CoreRejection }> {
  if (isUserRecipient(message.recipient)) return { ok: false };
  // The Query lives in the workspace of the Goal the message names; a Goal ref carries no workspace, so the Goal
  // record is read by its key (the mailbox has no Goal port).
  const goalRef = interventionGoalRefOf(message);
  let queryWorkspaceId = message.ref.workspaceId;
  if (goalRef !== null) {
    const goal = await readGoal(mailbox.records, goalRef);
    if (goal.status !== 'ready') return { ok: false, rejection: goal };
    queryWorkspaceId = goal.goal.workspaceRef.workspaceId;
  }
  const refs = interventionPlanningQueryRefs(message.ref, queryWorkspaceId);
  const jobRead = await loadQueryJob(mailbox, owned, refs.queryJobRef);
  if (jobRead.status === 'not_found') return { ok: false };
  if (jobRead.status !== 'ready') return { ok: false, rejection: mapReadResult(jobRead) as CoreRejection };
  const job = jobRead.value;
  const execution = job.job.intent.execution;
  if (execution.kind !== 'intervention_planning'
    || canonicalOf(execution.sourceMessageRef) !== canonicalOf(message.ref)) return { ok: false };
  // The formal Answer is the whole point: a settled ended run with no answer, never one with a reply to give.
  // A stored review answer that no longer parses has no reply (`planningReplyTextOf`), so its source still retires.
  const answerRef = job.job.answerRefs.at(-1);
  if (answerRef !== undefined) {
    if (execution.answerShape !== 'plan_review') return { ok: false };
    const answerRead = await loadQueryAnswer(mailbox, owned, answerRef);
    if (answerRead.status !== 'ready') return { ok: false, rejection: mapReadResult(answerRead) as CoreRejection };
    const replyText = planningReplyTextOf({ shape: 'plan_review', answerText: answerRead.value.answer.answer,
      queryJobId: job.job.queryJobId });
    if (replyText !== null) return { ok: false };
  }
  const runRead = await loadQueryRun(mailbox, owned, refs.queryRunRef);
  if (runRead.status === 'not_found') return { ok: false };
  if (runRead.status !== 'ready') return { ok: false, rejection: mapReadResult(runRead) as CoreRejection };
  const run = runRead.value;
  if (canonicalOf(run.run.queryJobRef) !== canonicalOf(job.ref)) return { ok: false };
  const state = run.run.executionState;
  if (state === undefined || state.phase !== 'settled') return { ok: false };
  const recipient = message.recipient;
  if (state.sessionRef.projectId !== recipient.projectId
    || state.sessionRef.sessionId !== recipient.sessionId) return { ok: false };
  return { ok: true };
}
