/**
 * The persisted initial-plan answer facts reader (R5b.4 §11.4). It consumes only
 * the persisted Query owner's formal facts through the injected ports; it never
 * calls Runtime, opens the Kernel store or rescans a transcript.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { PreparedQueryManifestV1 } from '../../../contracts/core/prepared-execution.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { messageOf } from '../../../contracts/error-message.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { InitializationSourceV1, InterventionAnswerSourceV1 } from '../../../contracts/initial-planning.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type {
  InitialPlanAnswerFacts,
  InitialPlanSourceResolutionV1,
  QueryJobAnswerRef,
  QueryJobRef,
  QueryJobSnapshot,
  QueryRunSnapshot,
} from '../../../contracts/query-job.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { InitializationBindingReadPort } from '../model/goal-card-contracts.js';
import type { MaterialPort } from '../model/material-contracts.js';
import type { PlanProposal } from '../model/plan-contracts.js';
import { sessionMessageRefFromValue } from '../persistence/plan-record-codecs.js';
import {
  decodeQueryJobAnswerSnapshot,
  decodeQueryJobSnapshot,
  decodeQueryRunSnapshotRecord,
} from '../queries/query-record-codecs.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../queries/query-execution.js';
import { appendGuardFirstWins } from '../queries/request-rounds-read.js';
import { messageConsumptionProblem } from '../state/message-machine.js';
import { sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import {
  normalizeInitialPlanningResponseV2,
  parseInitialPlanningResponseV2,
} from './initial-plan.js';
import { asWriteRejection, mapStoreReadFailure, type Owned, type Rejection } from './plan-result-helpers.js';
import { readWaitMessage } from './session-facts.js';

type InitialPlanAnswerDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  materials?: Pick<MaterialPort, 'openArtifact'>;
  initialPlanning?: { bodies: Pick<RawArtifactStorePort, 'read'> };
  /** The binding owner's read port. Absent makes only the binding source arm `unavailable`; the plain and
   *  prepared_goal arms never read it. */
  bindings?: InitializationBindingReadPort;
};

/** The answer read plus the intervention source proof's own version guards. */
type InitialPlanAnswerReadFacts = InitialPlanAnswerFacts & {
  /** The QueryJob and SessionMessage revisions the intervention-source proof read; absent for every other source. */
  sourceGuards?: readonly RecordGuard[];
};

/** The proven intervention source and the exact QueryJob/SessionMessage revisions it read. */
export type InterventionSourceProof = {
  sourceMessageRef: SessionMessageRef;
  guards: readonly RecordGuard[];
};

/**
 * The ONE intervention-source proof shared by the candidate reader, the answer
 * reader and the future adoption. `null` means the Query does not prove a source
 * for this Goal (the caller keeps its own refusal code); `selector` is the
 * message a proposal claims, or null while the Query's own source is discovered.
 */
export async function proveInterventionSource(input: {
  records: GoalRecordTransactionPort & RecordLookupPort;
  signal: AbortSignal;
  query: QueryJobSnapshot;
  goalRef: GoalRef;
  selector: SessionMessageRef | null;
}): Promise<ReadResult<InterventionSourceProof | null>> {
  const execution = input.query.job.intent.execution;
  if (execution.kind !== 'intervention_planning') {
    return { status: 'ready', value: null };
  }
  // The QueryJob codec requires `sourceMessageRef` on every `intervention_planning` intent.
  const source = execution.sourceMessageRef as SessionMessageRef;
  if (input.selector !== null && sessionMessageRefKey(input.selector) !== sessionMessageRefKey(source)) {
    return { status: 'ready', value: null };
  }
  // The Query, the message it names and the Goal this caller proves are one Goal.
  if (source.projectId !== input.goalRef.projectId || source.workspaceId !== input.query.ref.workspaceId
    || input.query.job.projectId !== input.goalRef.projectId || input.query.job.goalId !== input.goalRef.goalId) {
    return { status: 'ready', value: null };
  }
  const read = await readWaitMessage(input.records as Parameters<typeof readWaitMessage>[0], input.signal, source);
  if (read.status === 'not_found') return { status: 'ready', value: null };
  if (read.status !== 'ready') return read;
  const message = read.value;
  if (message.goalRef === null
    || canonicalJson(message.goalRef as unknown as JsonValue) !== canonicalJson(input.goalRef as unknown as JsonValue)) {
    return { status: 'ready', value: null };
  }
  // A withdrawn or unreleased message is never an admitted source.
  if (messageConsumptionProblem(message) !== null) return { status: 'ready', value: null };
  // Book §3.10 item 6: a person, or an authorized agent's released `action_request`.
  const person = message.sender.kind === 'host' && message.sender.actor.kind === 'human';
  const releasedRequest = (message.sender.kind === 'work_run' || message.sender.kind === 'secretary_round')
    && message.intent === 'action_request' && message.release === 'released';
  if (!person && !releasedRequest) return { status: 'ready', value: null };
  return { status: 'ready', value: {
    sourceMessageRef: { ...source },
    guards: [
      { refKey: canonicalJson(input.query.ref as unknown as JsonValue), expectedRevision: input.query.revision },
      { refKey: sessionMessageRefKey(message.ref), expectedRevision: message.revision },
    ],
  } };
}

/**
 * The Answer/Job/Run revisions the read saw, plus a binding source's record
 * (revision 1) and an intervention source's exact message revision: the
 * provenance guards every proposal and adoption takes.
 */
export function sourceFactsGuards(facts: InitialPlanAnswerReadFacts): RecordGuard[] {
  const guards: RecordGuard[] = [
    { refKey: canonicalJson(facts.answerRef as unknown as JsonValue), expectedRevision: 1 },
    { refKey: canonicalJson(facts.job.ref as unknown as JsonValue), expectedRevision: facts.job.revision },
    { refKey: canonicalJson(facts.run.ref as unknown as JsonValue), expectedRevision: facts.run.revision },
  ];
  if (facts.resolution.kind === 'binding') {
    guards.push({ refKey: canonicalJson(facts.resolution.bindingRef as unknown as JsonValue), expectedRevision: 1 });
  }
  for (const guard of facts.sourceGuards ?? []) appendGuardFirstWins(guards, guard);
  return guards;
}

/**
 * `records` is the instance the plan service already took from `deps` when it was built, so the store is read
 * through one instance and `deps.records` is never read a second time. The optional `materials` and
 * `initialPlanning` ports stay on `deps` and are read on each call, where the plan service read them.
 */
export function createInitialPlanAnswerReader(deps: InitialPlanAnswerDependencies, records: InitialPlanAnswerDependencies['records']) {
  /**
   * R5b.4 §11.4 the narrow fact read. It consumes only the persisted Query
   * owner's formal facts (Answer/Job/Run + the frozen prepared manifest body)
   * through the same records/materials/bodies instances; it never calls Runtime,
   * opens the Kernel store or rescans a transcript.
   */
  async function readInitialPlanAnswerFacts(
    ctx: CoreCallContext,
    answerRef: QueryJobAnswerRef,
    source?: InitializationSourceV1 | InterventionAnswerSourceV1,
  ): Promise<ReadResult<InitialPlanAnswerReadFacts>> {
    const materials = deps.materials;
    const bodies = deps.initialPlanning?.bodies;
    if (materials === undefined || bodies === undefined) {
      return rejected('unsupported', 'the initial-plan answer consumption requires the injected materials and prepared-body stores');
    }
    if (!isRecord(answerRef) || answerRef.aggregateType !== 'QueryJobAnswer'
      || !nonEmpty(answerRef.projectId) || !nonEmpty(answerRef.workspaceId)
      || !nonEmpty(answerRef.queryJobId) || !nonEmpty(answerRef.answerId)) {
      return rejected('invalid', 'the initial-plan consumer requires a complete QueryJobAnswerRef');
    }
    const wanted = answerRef as QueryJobAnswerRef;
    const answerKey = canonicalJson(wanted as unknown as JsonValue);
    // An explicit source is a selector only: it must name the answer being read, never a second answer's facts.
    if (source !== undefined) {
      if (source.kind === 'intervention') {
        if (sessionMessageRefFromValue(source.messageRef) === null) {
          return rejected('source_stale', 'the initial-plan intervention source is not a complete message ref');
        }
      } else if ((source.kind !== 'binding' && source.kind !== 'prepared_goal')
        || !isRecord(source.answerRef)
        || canonicalJson(source.answerRef as unknown as JsonValue) !== answerKey) {
        return rejected('source_stale', 'the initial-plan source does not name the requested answer');
      }
    }
    let answerRead;
    try { answerRead = await records.readMany([answerKey]); }
    catch (error) { return rejected('unavailable', `the Query answer read failed: ${messageOf(error)}`); }
    if (answerRead.status !== 'ready') return mapStoreReadFailure(answerRead, 'the Query answer is not readable');
    const answerRecord = answerRead.value.records.find((record) => record.refKey === answerKey);
    if (answerRecord === undefined) {
      return answerRead.value.missing.includes(answerKey)
        ? { status: 'not_found' } : rejected('unavailable', 'the Query answer read was not reported');
    }
    const decodedAnswer = decodeQueryJobAnswerSnapshot(answerRecord);
    if (decodedAnswer.status !== 'decoded') {
      return rejected('unavailable', `the Query answer is not decodable: ${decodedAnswer.reason}`);
    }
    const answer = decodedAnswer.value;
    if (answer.ref.answerId !== wanted.answerId || answer.ref.queryJobId !== wanted.queryJobId
      || answer.ref.projectId !== wanted.projectId || answer.ref.workspaceId !== wanted.workspaceId) {
      return rejected('invalid', 'the stored Query answer does not match the requested answer identity');
    }
    const jobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: wanted.projectId,
      workspaceId: wanted.workspaceId, queryJobId: wanted.queryJobId };
    const runRef = answer.answer.runRef;
    if (!isRecord(runRef) || runRef.aggregateType !== 'QueryRun'
      || runRef.projectId !== wanted.projectId || runRef.workspaceId !== wanted.workspaceId
      || runRef.queryJobId !== wanted.queryJobId || !nonEmpty(runRef.runId)) {
      return rejected('invalid', 'the stored Query answer carries an inconsistent QueryRunRef');
    }
    const jobKey = canonicalJson(jobRef as unknown as JsonValue);
    const runKey = canonicalJson(runRef as unknown as JsonValue);
    let coreRead;
    try { coreRead = await records.readMany([jobKey, runKey]); }
    catch (error) { return rejected('unavailable', `the Query Job/Run read failed: ${messageOf(error)}`); }
    if (coreRead.status !== 'ready') return mapStoreReadFailure(coreRead, 'the Query Job/Run are not readable');
    const present = new Map(coreRead.value.records.map((record) => [record.refKey, record]));
    const jobRecord = present.get(jobKey);
    if (jobRecord === undefined) return rejected('not_found', 'the QueryJob record does not exist');
    const runRecord = present.get(runKey);
    if (runRecord === undefined) return rejected('not_found', 'the QueryRun record does not exist');
    const decodedJob = decodeQueryJobSnapshot(jobRecord);
    if (decodedJob.status !== 'decoded') return rejected('unavailable', `the QueryJob is not decodable: ${decodedJob.reason}`);
    const decodedRun = decodeQueryRunSnapshotRecord(runRecord);
    if (decodedRun.status !== 'decoded') return rejected('unavailable', `the QueryRun is not decodable: ${decodedRun.reason}`);
    const job: QueryJobSnapshot = decodedJob.value;
    const run: QueryRunSnapshot = decodedRun.value;
    // Same formal scope, the initial_coordination kind and the real answered facts.
    if (job.ref.projectId !== wanted.projectId || job.ref.workspaceId !== wanted.workspaceId
      || job.ref.queryJobId !== wanted.queryJobId
      || job.job.projectId !== wanted.projectId || job.job.workspaceId !== wanted.workspaceId) {
      return rejected('forbidden', 'the QueryJob is outside the requested answer scope');
    }
    // The ordinary Query path keeps its old intent admission and no-Goal refusal. An explicit source bypasses
    // both: the frozen manifest (prepared_goal) or the binding decides which Goal the answer planned.
    const jobGoalId = job.job.goalId;
    if (source === undefined) {
      if (job.job.intent.execution.kind !== 'initial_coordination') {
        return rejected('invalid', 'the QueryJob intent is not an initial_coordination request');
      }
      if (jobGoalId === null || jobGoalId === '') {
        return rejected('incomplete', 'the QueryJob intent has no Goal');
      }
    }
    if (job.job.runRef === null || job.job.runRef.runId !== runRef.runId) {
      return rejected('invalid', 'the QueryJob does not point at the answered QueryRun');
    }
    if (job.job.status !== 'answered') return rejected('incomplete', 'the QueryJob is not formally answered');
    if (!job.job.answerRefs.some((ref) => canonicalJson(ref as unknown as JsonValue) === answerKey)) {
      return rejected('invalid', 'the QueryJob does not carry this answer');
    }
    if (run.ref.projectId !== wanted.projectId || run.ref.workspaceId !== wanted.workspaceId
      || run.ref.queryJobId !== wanted.queryJobId || run.ref.runId !== runRef.runId) {
      return rejected('forbidden', 'the QueryRun is outside the requested answer scope');
    }
    if (run.run.status !== 'answered' || run.run.outcome !== 'answered') {
      return rejected('incomplete', 'the QueryRun is not formally answered');
    }
    const state = run.run.executionState;
    if (state === undefined || state.phase !== 'settled') {
      return rejected('incomplete', 'the QueryRun has no settled execution observation');
    }
    if (state.history === null) return rejected('incomplete', 'the QueryRun has no saved history locator');
    if (state.prepared === null) return rejected('incomplete', 'the QueryRun has no frozen prepared manifest reference');
    // The exact persisted answer body, opened as a Host historical explanation.
    let opened;
    try {
      opened = await materials.openArtifact(ctx, {
        ref: answer.answer.bodyRef, usage: 'historical_explanation' });
    } catch (error) { return rejected('unavailable', `the Query answer body read failed: ${messageOf(error)}`); }
    if (opened.status !== 'ready') return opened;
    const body = opened.value;
    if (body.body !== answer.answer.answer || body.ref.digest !== answer.answer.bodyRef.digest
      || sha256Hex(body.body) !== answer.answer.bodyRef.digest) {
      // A source read names the exact answer it proved; a digest drift is that source being stale.
      return source === undefined
        ? rejected('invalid', 'the stored Query answer body disagrees with the recorded answer')
        : rejected('source_stale', 'the stored Query answer body no longer matches its recorded digest');
    }
    // No body-owner check: a body is content-addressed and keeps its first writer (`contracts/artifact.ts`), so another
    // QueryRun's byte-identical answer is this answer's body too. The Answer's runRef, matched against the Job above,
    // and the digest check prove the body is this QueryRun's answer.
    // The frozen prepared manifest body, re-read through the same raw body store.
    const prepared = state.prepared;
    const bundleRef = prepared.bundleRef;
    if (bundleRef.contentType !== QUERY_MANIFEST_CONTENT_TYPE) {
      return rejected('invalid', 'the prepared Query manifest reference is not a bounded query-execution manifest');
    }
    let storedManifest;
    try { storedManifest = await bodies.read(bundleRef); }
    catch (error) { return rejected('unavailable', `reading the prepared Query manifest failed: ${messageOf(error)}`); }
    if (storedManifest.status !== 'ready') {
      return rejected('invalid', 'the frozen prepared Query manifest body is not readable');
    }
    const raw = storedManifest.value;
    if (raw.ref.contentType !== bundleRef.contentType || raw.ref.digest !== bundleRef.digest
      || raw.ref.sizeBytes !== bundleRef.sizeBytes
      || sha256Hex(raw.body) !== bundleRef.digest
      || Buffer.byteLength(raw.body, 'utf8') !== bundleRef.sizeBytes) {
      return rejected('invalid', 'the stored Query manifest body disagrees with the prepared reference');
    }
    if (raw.origin.kind !== 'run'
      || canonicalJson(raw.origin.owner as unknown as JsonValue) !== runKey) {
      return rejected('forbidden', 'the prepared Query manifest is not owned by this QueryRun');
    }
    let parsedManifest: unknown;
    try { parsedManifest = JSON.parse(raw.body); }
    catch { return rejected('invalid', 'the prepared Query manifest is not valid JSON'); }
    if (!isRecord(parsedManifest) || parsedManifest['schemaVersion'] !== 1
      || parsedManifest['kind'] !== 'query_execution'
      || typeof parsedManifest['input'] !== 'string' || !nonEmpty(parsedManifest['inputDigest'])) {
      return rejected('invalid', 'the prepared Query manifest is incomplete');
    }
    const manifest = parsedManifest as unknown as PreparedQueryManifestV1;
    if (canonicalJson(manifest.queryRunRef as unknown as JsonValue) !== runKey) {
      return rejected('invalid', 'the prepared Query manifest disagrees with the QueryRun');
    }
    if (sha256Hex(manifest.input) !== manifest.inputDigest || manifest.inputDigest !== prepared.inputDigest) {
      return rejected('invalid', 'the prepared Query manifest input digest is inconsistent');
    }
    if (!isRecord(manifest.workspace) || !isRecord(manifest.workspace.ref)
      || manifest.workspace.ref.workspaceId !== wanted.workspaceId) {
      return rejected('invalid', 'the prepared Query manifest does not pin this Goal/Workspace');
    }
    if (source === undefined) {
      if (!isRecord(manifest.goal) || !isRecord(manifest.goal.ref)
        || manifest.goal.ref.projectId !== wanted.projectId || manifest.goal.ref.goalId !== job.job.goalId) {
        return rejected('invalid', 'the prepared Query manifest does not pin this Goal/Workspace');
      }
    } else if (source.kind === 'prepared_goal') {
      // A prepared_goal source is exactly a goal request prepared as initial_coordination; the manifest's Goal is
      // the authority, not the Job's own Goal (the Job may be a no-goal request).
      if (!isRecord(manifest.goal) || !isRecord(manifest.goal.ref)
        || manifest.goal.ref.projectId !== wanted.projectId || !nonEmpty(manifest.goal.ref.goalId)) {
        return rejected('source_stale', 'the frozen prepared manifest does not carry the source Goal');
      }
      if (manifest.request?.executionKind !== 'initial_coordination') {
        return rejected('source_stale', 'the frozen request is not an initial_coordination preparation');
      }
    }
    let sourceGuards: readonly RecordGuard[] = [];
    let resolution: InitialPlanSourceResolutionV1;
    if (source === undefined) {
      // The plain admission above refused a Job that names no Goal, so the resolved Goal is that Job's own Goal.
      resolution = { kind: 'plain', source: null, bindingRef: null,
        goal: { aggregateType: 'Goal', projectId: wanted.projectId, goalId: jobGoalId as string },
        goalRevision: (manifest.goal as { revision: number }).revision };
    } else if (source.kind === 'intervention') {
      if (!isRecord(manifest.goal) || !isRecord(manifest.goal.ref)
        || manifest.goal.ref.projectId !== wanted.projectId || !nonEmpty(manifest.goal.ref.goalId)
        || job.job.intent.execution.kind !== 'intervention_planning') {
        return rejected('source_stale', 'the frozen manifest is not an intervention-planning preparation');
      }
      const interventionGoal = manifest.goal as { ref: { aggregateType: 'Goal'; projectId: string; goalId: string };
        revision: number };
      const proof = await proveInterventionSource({ records, signal: ctx.signal, query: job,
        goalRef: interventionGoal.ref, selector: source.messageRef });
      if (proof.status !== 'ready') return proof;
      if (proof.value === null) {
        return rejected('source_stale', 'the intervention source message does not prove this Query and Goal');
      }
      sourceGuards = proof.value.guards;
      resolution = { kind: 'intervention', source, bindingRef: null,
        goal: { ...interventionGoal.ref }, goalRevision: interventionGoal.revision };
    } else if (source.kind === 'prepared_goal') {
      const manifestGoal = manifest.goal as { ref: { aggregateType: 'Goal'; projectId: string; goalId: string };
        revision: number };
      resolution = { kind: 'prepared_goal', source, bindingRef: null,
        goal: { ...manifestGoal.ref }, goalRevision: manifestGoal.revision };
    } else {
      const bindings = deps.bindings;
      if (bindings === undefined) {
        return rejected('unavailable', 'the initial-plan binding source requires the injected binding read port');
      }
      let bindingRead;
      try {
        bindingRead = await bindings.readBindingByAnswerDraft(ctx,
          { answerRef: wanted, draftIndex: source.draftIndex });
      } catch (error) {
        return rejected('unavailable', `the initialization binding read failed: ${messageOf(error)}`);
      }
      if (bindingRead.status === 'not_found') {
        return rejected('source_stale', 'the initialization binding for this answer draft does not exist');
      }
      if (bindingRead.status !== 'ready') return bindingRead;
      const binding = bindingRead.value;
      // The selector and binding must name the same answer/draft with the still-current digest; planDraftIndex is checked only by normalization.
      if (canonicalJson(binding.ref.answerRef as unknown as JsonValue) !== answerKey
        || binding.ref.draftIndex !== source.draftIndex
        || binding.answerDigest !== sha256Hex(answer.answer.answer)) {
        return rejected('source_stale', 'the initialization binding does not match the source answer');
      }
      resolution = { kind: 'binding', source, bindingRef: { ...binding.ref },
        goal: { ...binding.goalRef }, goalRevision: 1 };
    }
    return { status: 'ready', value: {
      answer: answer.answer, answerRef: { ...answer.ref }, job, run, manifest,
      answerText: answer.answer.answer, resolution,
      ...(sourceGuards.length === 0 ? {} : { sourceGuards }) } };
  }

  /**
   * R5b.4 §11.4 the apply-side provenance proof: the candidate must be the
   * UNIQUE normalization of its real persisted answer. The actual read versions
   * join the original local CAS; a mismatch is an explicit rejection and never a
   * repair of the stored draft.
   */
  async function verifyModelCoordinationDraft(
    ownedContext: Owned<CoreCallContext>,
    proposal: Extract<PlanProposal, { kind: 'candidate_v2' }>,
    /** The Goal revision the adopting scope read; an explicit source frozen at another revision is a conflict. */
    currentGoalRevision: number,
  ): Promise<{ guards: RecordGuard[] } | { rejection: Rejection }> {
    const origin = proposal.draft.origin;
    if (origin === undefined || origin.kind !== 'model_coordination') {
      return { rejection: rejected('invalid', 'the candidate does not carry the model-coordination origin it claims') };
    }
    if (deps.materials === undefined || deps.initialPlanning === undefined) {
      return { rejection: rejected('unsupported', 'model-coordination adoption requires the injected materials and prepared-body stores') };
    }
    if (ownedContext.status === 'invalid') return { rejection: rejected('invalid', ownedContext.reason) };
    // Re-read through the SAME declared source; a binding or prepared_goal source is re-proved against its binding/manifest.
    const declaredSource = origin.source;
    const source = declaredSource === undefined || declaredSource.kind === 'plain'
      ? undefined : declaredSource.selector;
    const factsRead = await readInitialPlanAnswerFacts(ownedContext.value, origin.answerRef, source);
    if (factsRead.status !== 'ready') {
      return { rejection: asWriteRejection(factsRead, 'the initial-plan answer facts are not readable') };
    }
    const facts = factsRead.value;
    // An explicit source froze its Goal revision; a moved Goal is a conflict, while the plain path leaves comparison to the machine's scope guard.
    if (source !== undefined && facts.resolution.goalRevision !== currentGoalRevision) {
      return { rejection: rejected('revision_conflict', 'the Goal moved since the source captured its revision') };
    }
    const parsed = parseInitialPlanningResponseV2(facts.answerText);
    if (parsed.status === 'rejected') return { rejection: parsed };
    const normalized = normalizeInitialPlanningResponseV2(parsed.response, facts);
    if (normalized.status !== 'plan') {
      return { rejection: rejected('invalid', 'the real answer no longer normalizes to the proposed plan') };
    }
    // A record frozen before the source arm carries no source; it reads as { kind: 'plain' } only when the
    // re-read facts are plain too. The record is never rewritten and every other field is compared strictly.
    const compared = declaredSource === undefined && facts.resolution.kind === 'plain'
      ? { ...proposal.draft, origin: { ...origin, source: { kind: 'plain' as const } } }
      : proposal.draft;
    if (canonicalJson(normalized.draft as unknown as JsonValue)
      !== canonicalJson(compared as unknown as JsonValue)) {
      return { rejection: rejected('invalid', 'the candidate draft is not the unique normalization of the real answer') };
    }
    return { guards: sourceFactsGuards(facts) };
  }

  return { readInitialPlanAnswerFacts, verifyModelCoordinationDraft };
}
