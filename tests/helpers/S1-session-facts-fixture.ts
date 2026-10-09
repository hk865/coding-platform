/** Shared, production-entry fixtures for the fx2 service rows. No model is invoked. */
import { expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin, WorkspaceScope, WorkLinkTarget, WorkLinkRelation } from '../../src/contracts/core/identity.js';
import type { SessionProvenanceV1 } from '../../src/contracts/core/session.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { SessionArchiveRequestV1 } from '../../src/contracts/core/session-archive.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { AggregateRef } from '../../src/contracts/ledger.js';
import { seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import { consultationQueryRefs } from '../../src/contracts/query-job.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { TaskResultObservation, AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { SessionOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { EncodedRecord, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { materialRecordSchemas, createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { PLAN_STATE_RECORD_SCHEMAS, PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-history-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { SESSION_RECORD_SCHEMAS, plainSessionRefToAggregate, encodeSessionOperationRecord } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createLegacySessionProvenanceReader } from '../../src/core/work-graph/tasks/session-provenance-facts.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { checkAllInvariants, invariantStoreOf, readInvariantWorld, platformRecordSchemas,
  type InvariantWorld } from '../state/invariants.js';
import { B2_HOST, type B2ExecutionFixture, type B2Admitted } from './B2-execution-fixture.js';
import type { TaskClaimFixture, Records } from './task-claim-fixture.js';

export const t0 = '2026-10-08T00:00:00.000Z';
export const t1 = '2026-10-09T00:00:00.000Z';
export const key = (ref: object): string => canonicalJson(ref as JsonValue);
export function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready: ${JSON.stringify(result)}`);
  return result.value;
}
export function committed<T>(result: WriteResult<T>): Extract<WriteResult<T>, { status: 'committed' }> {
  if (result.status !== 'committed') throw new Error(`expected committed: ${JSON.stringify(result)}`);
  return result;
}

/** Register every actual schema once, plus read-only census indexes for physical observations. */
export function s1Schemas(r3e = false): RecordBackendSchemas {
  const installed = [materialRecordSchemas(), PLAN_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS,
    PLAN_GOVERNANCE_RECORD_SCHEMAS, SESSION_RECORD_SCHEMAS, ROLE_RECORD_SCHEMAS, TASK_CLAIM_RECORD_SCHEMAS,
    EXECUTION_ENTRY_RECORD_SCHEMAS, MODEL_REQUEST_RECORD_SCHEMAS, EXECUTION_HISTORY_RECORD_SCHEMAS,
    ...(r3e ? [EVIDENCE_RECORD_SCHEMAS, PROJECT_BOOTSTRAP_RECORD_SCHEMAS] : [])];
  const all = platformRecordSchemas();
  const recordIds = new Set(installed.flatMap(bundle => bundle.records.map(schema => schema.schemaId)));
  const eventIds = new Set(installed.flatMap(bundle => bundle.events.map(schema => `${schema.eventType}@${schema.schemaVersion}`)));
  const lookupIds = new Set(installed.flatMap(bundle => (bundle.lookups ?? []).map(index => index.name)));
  return {
    records: all.records.filter(schema => !recordIds.has(schema.schemaId)),
    events: all.events.filter(schema => !eventIds.has(`${schema.eventType}@${schema.schemaVersion}`)),
    lookups: [...(all.lookups ?? []).filter(index => !lookupIds.has(index.name)),
      ...all.records.map(schema => ({ name: `fx2-census-${schema.aggregateType}`, aggregateType: schema.aggregateType,
        paths: ['ref.projectId'] }))],
  };
}

export async function pin(records: Records, ref: AggregateRef): Promise<VersionPin> {
  const read = await records.readMany([key(ref)]);
  if (read.status !== 'ready') throw new Error(`pin read: ${JSON.stringify(read)}`);
  return { ref, revision: read.value.records[0]?.revision ?? 0 };
}

export function sqliteCounts(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.['n']);
    return { records: count('snapshots'), events: count('events'), receipts: count('idempotency') };
  } finally { db.close(); }
}

/** Observe the *backend object* shared by every owner, not the claim-only spy.
 * SQLite counts are SQL totals. Memory counts read all snapshots and the actual
 * event horizon; receipt deltas count only successful fresh backend receipts.
 * Each successful mutation checks the SQLite world against the preceding world.
 */
export async function observeStore(base: TaskClaimFixture) {
  let previous: InvariantWorld | undefined;
  let seeding = false;
  const receipts = new Map<string, string>();
  const check = async () => {
    if (base.kind === 'sqlite' && !seeding) {
      const world = await readInvariantWorld(invariantStoreOf(base.directory), base.scope.projectId);
      // Owners may recover a thrown commit response by replaying its receipt.
      // A soft assertion records the failure without masquerading as a lost response.
      expect.soft(checkAllInvariants(world, previous)).toEqual([]);
      previous = world;
    }
  };
  await check();
  const commit = base.records.commit.bind(base.records);
  let checks = Promise.resolve();
  base.records.commit = async batch => {
    const result = await commit(batch);
    if (result.status === 'committed' && !result.replayed) {
      receipts.set(result.identityKey, batch.fingerprint);
      checks = checks.then(async () => {
        try { await check(); }
        catch (error) { expect.soft(error, 'the committed invariant world must be readable').toBeUndefined(); }
      });
      await checks;
    }
    return result;
  };
  const records = async (): Promise<EncodedRecord[]> => {
    const found: EncodedRecord[] = [];
    for (const schema of platformRecordSchemas().records) {
      let after: string | undefined;
      do {
        const page = await base.records.lookup({ index: `fx2-census-${schema.aggregateType}`,
          values: [base.scope.projectId], limit: 200, ...(after === undefined ? {} : { after }) });
        if (page.status !== 'ready') throw new Error(`census: ${JSON.stringify(page)}`);
        found.push(...page.value.records);
        after = page.value.next ?? undefined;
      } while (after !== undefined);
    }
    return found.sort((a, b) => a.refKey.localeCompare(b.refKey));
  };
  const counts = async () => {
    if (base.kind === 'sqlite') return sqliteCounts(base.ledgerPath);
    const read = await base.records.readMany([]);
    if (read.status !== 'ready') throw new Error(`horizon: ${JSON.stringify(read)}`);
    for (const [identityKey, fingerprint] of receipts) {
      const receipt = await base.records.lookupCommit({ identityKey, fingerprint });
      if (receipt.status !== 'ready') throw new Error(`receipt census: ${JSON.stringify(receipt)}`);
    }
    return { records: (await records()).length,
      events: read.value.readThrough === null ? 0 : seqOfCommitCursor(read.value.readThrough),
      receipts: receipts.size };
  };
  /** A raw old-format seed (SV10) is a fixture, not an owner mutation: no per-commit invariant
   * check while it is written; the next check starts from the seeded world. */
  const seed = async (write: () => Promise<void>) => {
    seeding = true;
    try { await write(); } finally { seeding = false; previous = undefined; }
  };
  return { counts, records, check, seed };
}
export type StoreObservation = Awaited<ReturnType<typeof observeStore>>;

export function sessionOwners(base: TaskClaimFixture) {
  const records = base.records;
  const facts = createSessionFactsService({ records });
  const provenance = createLegacySessionProvenanceReader(records, facts);
  const directory = createSessionDirectory({ records, lookups: records, legacyProvenance: provenance });
  const lifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts: facts });
  return { facts, provenance, directory, lifecycle };
}

export function plannedSession(base: TaskClaimFixture, requestId: string): SessionRef {
  if (base.ctx.principal.kind !== 'host') throw new Error('Host fixture required');
  const digest = sha256Hex(canonicalJson({ actor: base.ctx.principal.actor, projectId: base.scope.projectId, requestId }));
  return { projectId: base.scope.projectId, sessionId: `session-${digest}` };
}

export async function createSession(base: TaskClaimFixture, requestId: string, options: {
  provenance?: SessionProvenanceV1; workspace?: WorkspaceScope;
  initialLinks?: { target: WorkLinkTarget; relation: WorkLinkRelation }[];
} = {}) {
  const { directory } = sessionOwners(base);
  const workspace = options.workspace ?? base.scope;
  const ctx: CoreCallContext = { ...base.ctx, workspaceId: workspace.workspaceId,
    materialReader: base.ctx.materialReader.kind === 'host'
      ? { ...base.ctx.materialReader, workspaceId: workspace.workspaceId } : base.ctx.materialReader };
  const admission = committed(await directory.admitSessionCreation(ctx, {
    input: { workspace, kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' }, recommendedRefs: [],
      initialLinks: options.initialLinks ?? [], ...(options.provenance === undefined ? {} : { provenance: options.provenance }) },
    meta: { requestId, expected: [] },
  }));
  const result = committed(await directory.recordSessionCreated(ctx, {
    input: { operationRef: admission.value.ref, sessionRef: admission.value.action.plannedSessionRef,
      adapterId: 'r4c-claim-kernel', kernelSessionId: `kernel-${requestId}`, historyCursor: null, observedAt: new Date().toISOString() },
    meta: { requestId: `${requestId}-register`, expected: [] },
  }));
  return { ref: admission.value.action.plannedSessionRef, operationRef: admission.value.ref, created: result };
}

/** D4: import a genuinely old accepted operation (no provenance key), then let
 * the production completion entry write SessionCreated and bind initial links.
 * The new admission entry is deliberately not used for a legacy record.
 */
export async function createLegacySession(base: TaskClaimFixture, requestId: string,
  initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[] = []) {
  const ref = plannedSession(base, requestId);
  const now = new Date().toISOString();
  const operation: SessionOperationRecord = {
    ref: { aggregateType: 'CoreOperation', projectId: base.scope.projectId, operationId: `legacy-${requestId}` },
    revision: 1, action: { kind: 'create', plannedSessionRef: ref, workspace: base.scope,
      kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' }, recommendedRefs: [], initialLinks },
    phase: 'accepted', requestedAt: now, updatedAt: now, observation: null, failure: null,
  };
  // Serialize old keys explicitly; today's encoder must not normalize the old action to new.
  const encoded = encodeSessionOperationRecord(operation);
  const old = { ...encoded, json: JSON.stringify(operation) };
  const seeded = await base.commitRaw([old]);
  if (seeded.status !== 'committed') throw new Error(`legacy operation: ${JSON.stringify(seeded)}`);
  const result = committed(await sessionOwners(base).directory.recordSessionCreated(base.ctx, {
    input: { operationRef: operation.ref, sessionRef: ref, adapterId: 'r4c-claim-kernel',
      kernelSessionId: `legacy-kernel-${requestId}`, historyCursor: null, observedAt: now },
    meta: { requestId: `${requestId}-register`, expected: [] },
  }));
  expect(result.value.provenance ?? null).toBeNull();
  return { ref, operationRef: operation.ref, created: result };
}

/** Real Work entry with the exact Host grant needed by send/respond. */
export function workHistory(b2: B2ExecutionFixture) {
  const base = b2.base;
  let seq = 0;
  const now = () => new Date().toISOString();
  const permissions = { ...B2_HOST.permissions, tools: ['read', 'send_session_message', 'respond_session_message'] };
  const calls = { host: 0 };
  const modelAuthorization = vi.spyOn(b2.model, 'authorizeModelRequest');
  const modelAttempt = vi.spyOn(b2.model, 'recordModelRequestAttempt');
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    calls.host += 1;
    if (ctx.projectId !== base.scope.projectId || ctx.workspaceId !== base.scope.workspaceId
      || key(input.permissions) !== key(permissions) || key(input.hostTemplate ?? {}) !== key(B2_HOST.hostTemplate)
      || input.configurationRevision !== B2_HOST.configurationRevision) {
      return { status: 'rejected', code: 'forbidden', reason: 'fixture Host grant mismatch' };
    }
    return { status: 'ready', value: { ...B2_HOST, permissions } };
  };
  const eventId = () => `fx2-work-event-${++seq}`;
  const roles = createRoleConfigurationService({ records: base.records, now, eventId });
  const reads = createRunStateReader({ records: base.records });
  const entry = createExecutionEntryService({ records: base.records, reads, roles, bodies: b2.bodies,
    authorizeConfiguration, now, eventId, newId: () => `fx2-entry-${++seq}` });
  const mailbox = createSessionMailbox({ records: base.records, sessions: sessionOwners(base).directory,
    executions: reads, roles, materials: createMaterialService({ bodies: b2.bodies,
      authority: createMaterialRecordReaders(base.records).authority, now }),
    runtimeAdmission: { bodies: b2.bodies, authorizeConfiguration },
    systemActor: { kind: 'system', id: 'fx2-materials' }, now, newId: () => `fx2-mail-${++seq}` });
  const workContext = (claim: TaskClaim): CoreCallContext => ({ ...base.ctx,
    principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: base.roleBinding },
    materialReader: { kind: 'run', requester: claim.runRef } });
  const kernelFor = async (claim: TaskClaim) => ({ ...await b2.kernelFor(claim),
    runId: `fx2-kernel-${claim.runRef.runId}`, turnId: `fx2-turn-${claim.runRef.runId}` });
  async function enter(claim: TaskClaim = b2.claim): Promise<B2Admitted> {
    const prepared = await b2.buildPrepared({ claim, permissions });
    const authorized = committed(await entry.authorizeRuntimeEntry(base.ctx, {
      input: { prepared, consumerId: `fx2-consumer-${++seq}` },
      meta: { requestId: `fx2-authorize-${++seq}`, expected: [await b2.pin(claim)] } }));
    const begun = committed(await entry.beginRuntimeEntry(base.ctx, {
      input: { permit: authorized.value, kernel: await kernelFor(claim) },
      meta: { requestId: `fx2-begin-${++seq}`, expected: [await b2.pin(claim)] } }));
    const permit = { ...authorized.value, authorizationRevision: begun.value.authorization.revision };
    const kernel = await kernelFor(claim);
    committed(await entry.recordExecutionEntered(base.ctx, {
      input: { permit, enteredAt: now(), kernelSource: { ...kernel, position: 3 },
        history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: `fx2-enter-${++seq}`, expected: [await b2.pin(claim)] } }));
    return { prepared, permit: await b2.currentPermit(claim) };
  }
  async function finish(admitted: B2Admitted, continuation?: TaskResultObservation['continuation'], crash?: string) {
    const claim = admitted.prepared.claim;
    const kernel = await kernelFor(claim);
    const event = b2.terminalEvent({ runRef: claim.runRef, eventId: `fx2-terminal-${++seq}`, occurredAt: now(),
      ...(crash === undefined ? {} : { eventType: 'run_crashed' as const,
        payload: { kind: 'crashed' as const, error: crash } }),
      ...(continuation === undefined ? {} : { eventType: 'run_yielded' as const,
        payload: { kind: 'yielded' as const, yield: { reason: 'reply_required', requestedBy: 'app' as const,
          yieldedAt: now(), pendingToolCallId: null } } }) });
    return committed(await entry.recordRunResult(base.ctx, {
      input: { claim, entry: { consumerId: admitted.permit.consumerId, entryGeneration: admitted.permit.entryGeneration },
        event, kernelSource: { ...kernel, position: 4 },
        completedHistoryBoundary: { source: { ...kernel, position: 4 }, cursor: `fx2-boundary-${++seq}` },
        history: { kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 },
        ...(continuation === undefined ? {} : { continuation }) },
      meta: { requestId: `fx2-finish-${++seq}`, expected: [await b2.pin(claim)] } }));
  }
  async function wait(withResponse: boolean, claim = b2.claim, runningResponder?: B2Admitted) {
    const admitted = await enter(claim);
    let message = committed(await mailbox.sendMessage(workContext(claim), {
      input: { recipient: b2.secondClaim.sessionRef, text: 'm: please reply', intent: 'inquiry', needsReply: true, waitAfterSend: true },
      meta: { requestId: `fx2-send-${++seq}`, expected: [] } })).value;
    if (withResponse) {
      const responder = runningResponder ?? await enter(b2.secondClaim);
      message = committed(await mailbox.respondMessage(workContext(b2.secondClaim), {
        input: { messageRef: message.ref, text: 'm: reply saved' },
        meta: { requestId: `fx2-response-${++seq}`, expected: [{ ref: message.ref, revision: message.revision }] } })).value;
      if (runningResponder === undefined) await finish(responder);
    }
    await finish(admitted, { schemaVersion: 1, kind: 'wait_reply', task: claim.task,
      sessionRef: claim.sessionRef, messageRef: message.ref });
    return message;
  }
  async function copyMessage(source: SessionRef, child: SessionRef): Promise<SessionMessage> {
    const sent = committed(await mailbox.sendMessage(base.ctx, {
      input: { recipient: source, text: 'Read the original history in an isolated copy', intent: 'inquiry', needsReply: true },
      meta: { requestId: `fx2-copy-send-${++seq}`, expected: [] } })).value;
    const record = ready(await sessionOwners(base).directory.readSession(base.ctx, source)).record;
    if (mailbox.recordConsultationDerivation === undefined) throw new Error('missing consultation entry');
    return committed(await mailbox.recordConsultationDerivation(base.ctx, {
      input: { messageRef: sent.ref, derivation: { childSessionRef: child, sourceSessionRef: source,
        sourceKernel: record.kernel, throughPosition: null } },
      meta: { requestId: `fx2-copy-bind-${++seq}`, expected: [{ ref: sent.ref, revision: sent.revision }] } })).value;
  }
  const crash = (admitted: B2Admitted) => finish(admitted, undefined, 'fixture writer crashed');
  return { entry, mailbox, enter, finish, crash, wait, copyMessage, calls, modelAuthorization, modelAttempt };
}

/** A fresh, plan-less Goal removes the unrelated initial-coordination guard. */
export async function pendingQuery(b2: B2ExecutionFixture, id: string, injectFacts = true, message?: SessionMessage) {
  const base = b2.base;
  const now = () => new Date().toISOString();
  const goals = createGoalService({ records: base.records, now, eventId: () => id + '-goal-event' }).tasks;
  const goalRef = { aggregateType: 'Goal' as const, projectId: base.scope.projectId, goalId: id };
  committed(await goals.createGoal(base.ctx, {
    input: { goalId: id, workspace: base.scope, objective: 'Read-only Session facts fixture' },
    meta: { requestId: `${id}-goal`, expected: [await pin(base.records, base.projectRef), await pin(base.records, base.workspaceRef)] } }));
  const queryJobRef: QueryJobRef = message === undefined
    ? { aggregateType: 'QueryJob', ...base.scope, queryJobId: `${id}-job` } : consultationQueryRefs(message.ref).queryJobRef;
  const queryRunRef: QueryRunRef = message === undefined
    ? { aggregateType: 'QueryRun', ...base.scope, queryJobId: queryJobRef.queryJobId, runId: `${id}-run` }
    : consultationQueryRefs(message.ref).queryRunRef;
  let seq = 0;
  const eventId = () => `${id}-event-${++seq}`;
  const consultations = workHistory(b2).mailbox;
  const question = message === undefined ? 'Read current facts'
    : ready(await consultations.readMessageBody(base.ctx, { messageRef: message.ref, part: 'message' })).text;
  const jobs = createQueryJobService({ records: base.records, now, eventId, consultations });
  const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobRef.queryJobId, ...base.scope, goalId: id,
    question, focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
    multiTurn: { maxRounds: 1 }, correlationId: id,
    execution: { kind: message === undefined ? 'initial_coordination' : 'semantic_query',
      roleBinding: base.roleBinding, runtimeBudget: DEFAULT_RUNTIME_BUDGET,
      ...(message === undefined ? {} : { consultation: { messageRef: message.ref, recipient: message.recipient as SessionRef,
        ...(message.consultationDerivation === undefined ? {} : { derivation: message.consultationDerivation }) } }) } };
  committed(await jobs.submitQueryJob(base.ctx, {
    input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
    meta: { requestId: `${id}-submit`, expected: [await pin(base.records, base.projectRef),
      await pin(base.records, base.workspaceRef), await pin(base.records, goalRef),
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] } }));
  const calls = { configuration: 0 };
  const execution = createQueryExecution({ records: base.records, bodies: b2.bodies,
    roles: createRoleConfigurationService({ records: base.records, now, eventId }),
    authorizeConfiguration: async () => { calls.configuration += 1;
      return { status: 'rejected', code: 'forbidden', reason: 'this fixture does not prepare a Query' }; },
    now, eventId, ...(injectFacts ? { sessionFacts: sessionOwners(base).facts } : {}) });
  const request = async (sessionRef: SessionRef) => ({ input: { queryRunRef, sessionRef },
    meta: { requestId: `${id}-claim`, expected: [await pin(base.records, queryJobRef),
      await pin(base.records, queryRunRef), await base.sessionPin(sessionRef)] } });
  return { jobs, execution, queryJobRef, queryRunRef, request, calls };
}

export async function archiveWait(b2: B2ExecutionFixture, message: SessionMessage,
  kind: 'cancel' | 'transfer', handler?: SessionRef) {
  const base = b2.base;
  const { lifecycle } = sessionOwners(base);
  if (kind === 'transfer' && handler === undefined) throw new Error('transfer requires a real handler Session');
  const requested = committed(await lifecycle.requestSessionArchive(base.ctx, {
    input: { sessionRef: b2.claim.sessionRef, reason: 'archive wait', tasks: [],
      wait: kind === 'cancel' ? { kind, runRef: b2.claim.runRef, messageRef: message.ref }
        : { kind, runRef: b2.claim.runRef, messageRef: message.ref, to: handler! } },
    meta: { requestId: 'a', expected: [await base.sessionPin(b2.claim.sessionRef)] } }));
  const archiveRequest = requested.value.archiveRequest;
  if (archiveRequest == null) throw new Error('archive request was not stored');
  const step = { sessionRef: b2.claim.sessionRef, archiveRequestId: archiveRequest.requestId,
    requestReceipt: archiveRequest.receipt, step: kind === 'cancel' ? 'wait_cancel' as const : 'reply_handler' as const,
    subjectKey: key(kind === 'cancel' ? b2.claim.runRef : message.ref) };
  const mailbox = workHistory(b2).mailbox;
  if (mailbox.disposeArchiveWait === undefined) throw new Error('missing archive wait owner');
  const disposed = committed(await mailbox.disposeArchiveWait(base.ctx, step));
  // The yielded Run is already terminal. Its formal cancel immediately closes
  // the wait; no live Kernel handle needs a synthetic terminal observation.
  let seq = 0;
  const controls = createRunControlService({ records: base.records, reads: createRunStateReader({ records: base.records }),
    authority: createMaterialRecordReaders(base.records).authority, now: () => t1, eventId: () => `fx2-cancel-${++seq}` });
  committed(await controls.submitControl(base.ctx, archiveControlRequest(archiveRequest, b2.claim.runRef)));
  return { requested, disposed, step };
}

/** §2.3: archive stop uses the original persisted Run pin and stable public identity. */
export function archiveControlRequest(request: SessionArchiveRequestV1, runRef: RunRef) {
  const original = request.executionPins.find(entry => key(entry.ref) === key(runRef));
  if (original === undefined) throw new Error('archive request has no original Run pin');
  const requestId = 's1-archive-control:' + sha256Hex(canonicalJson({
    requestReceipt: request.receipt, runRef, action: 'cancel',
  }));
  return { input: { runRef, kind: 'cancel' as const, reason: request.reason },
    meta: { requestId, expected: [original] } };
}

