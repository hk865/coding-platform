/** WP2 F-N: real S1 owners and backends; constructor hooks only add schemas and
 * the backend's own beforeWrite fault point. No histories or cursor values are seeded. */
import { expect, vi } from 'vitest';
import { withBackendOrderedLookup } from './ordered-lookup-forward.js';
import { DatabaseSync } from 'node:sqlite';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionNoticeSourcePort, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionReadRecordsPort } from '../../src/core/work-graph/views/goal-conflicts.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { QueryEntryIdentity } from '../../src/core/work-graph/queries/contracts.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { consultationQueryRefs, type QueryJobAnswerV1, type QueryJobRef, type QueryRunRef } from '../../src/contracts/query-job.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteBackend from '../../src/core/record-store/sqlite-record-store.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { SESSION_ACTIVITY_SCHEMAS } from '../../src/core/work-graph/sessions/session-activity.js';
import { createDecisionSettingsService } from '../../src/core/work-graph/configuration/decision-settings-service.js';
import { createDecisionReadModel } from '../../src/core/work-graph/views/decision-read-model.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { createSessionMailbox, createMessageWriteOwner } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { decodeSessionRecord } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { kernelSessionClaimKey } from '../../src/core/work-graph/sessions/session-directory.js';
import { createArchiveServiceFixture, committed, ready, key, type ArchiveServiceFixture } from './S1-archive-service-fixture.js';
import { B2_HOST } from './B2-execution-fixture.js';
import { preparationHost, prepareQueryForReal } from './task-claim-fixture.js';

export { committed, ready, key };
export type NoticeSourceFactory = (deps: { records: DecisionReadRecordsPort;
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  messages: Pick<SessionMailboxPort, 'readUndeliveredReplies' | 'readMessage'> }) => DecisionNoticeSourcePort;
export const noticeKey = (message: SessionMessage): string => {
  if (!message.response) throw new Error('noticeKey requires an original saved response');
  return 'undelivered_reply:' + canonicalJson({ messageRef: message.ref, responseRef: message.response.bodyRef } as JsonValue);
};

export async function openWP2NoticesFixture(kind: 'memory' | 'sqlite', factory: NoticeSourceFactory) {
  let failBeforeWrite = false;
  let beforeWrites = 0;
  const types = new Set<string>();
  const beforeWrite = () => { beforeWrites++; if (failBeforeWrite) { failBeforeWrite = false; throw new Error('WP2 beforeWrite failure'); } };
  function schemas(original: RecordBackendSchemas): RecordBackendSchemas {
    const groups = [original, DECISION_RECORD_SCHEMAS, QUERY_JOB_RECORD_SCHEMAS, SESSION_ACTIVITY_SCHEMAS];
    const records = [...new Map(groups.flatMap(g => g.records).map(s => [s.schemaId, s])).values()];
    records.forEach(s => types.add(s.aggregateType));
    return { records,
      events: [...new Map(groups.flatMap(g => g.events).map(s => [s.eventType + ':' + s.schemaVersion, s])).values()],
      lookups: [...new Map(groups.flatMap(g => g.lookups ?? []).map(s => [s.name, s])).values(),
        ...[...types].map(aggregateType => ({ name: 'wp2-all-' + aggregateType, aggregateType, paths: ['ref.aggregateType'] }))] };
  }
  // The callback belongs to the actual backend even after these spies restore.
  // Do not use this fixture with concurrent tests: constructor injection is scoped.
  async function withBackendOptions<T>(action: () => Promise<T>): Promise<T> {
    const memory = memoryBackend.createInMemoryRecordBackend;
    const sqlite = sqliteBackend.createSqliteRecordBackend;
    const m = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend').mockImplementation(options => memory({
      ...options, schemas: schemas(options.schemas), beforeWrite }));
    const s = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend').mockImplementation(options => sqlite({
      ...options, schemas: schemas(options.schemas), beforeWrite }));
    try { return await action(); } finally { m.mockRestore(); s.mockRestore(); }
  }
  const f = await withBackendOptions(() => createArchiveServiceFixture(kind));
  const { records, ctx, base, b2 } = f;
  const actor = ctx.principal.kind === 'host' ? ctx.principal.actor : (() => { throw new Error('Host fixture required'); })();
  const roles = createRoleConfigurationService({ records, now: f.now, eventId: f.id });
  const materials = createMaterialService({ bodies: b2.bodies, authority: createMaterialRecordReaders(records).authority, now: f.now });
  const reads = createRunStateReader({ records, bodies: b2.bodies });
  const grant = { ...B2_HOST.permissions, tools: [...B2_HOST.permissions.tools,
    'send_session_message', 'respond_session_message', 'send_user_message'] };
  const sessionGrant = { ...B2_HOST.permissions, tools: [...B2_HOST.permissions.tools, 'send_session_message', 'respond_session_message'] };
  const authorizeConfiguration: AuthorizeConfiguration = async (requestCtx, input) => {
    if (requestCtx.projectId !== base.scope.projectId || requestCtx.workspaceId !== base.scope.workspaceId
      || input.configurationRevision !== B2_HOST.configurationRevision || key({ template: input.hostTemplate }) !== key({ template: B2_HOST.hostTemplate })
      || ![B2_HOST.permissions, sessionGrant, grant].some(allowed => key(allowed) === key(input.permissions))) {
      return { status: 'rejected', code: 'forbidden', reason: 'WP2 trusted Host configuration mismatch' };
    }
    return { status: 'ready', value: { configurationRevision: B2_HOST.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(B2_HOST.hostTemplate) } };
  };
  const mailboxDeps = { records, sessions: f.sessions, executions: reads, roles, materials,
    defaultInquiryDeadlineMs: 86_400_000,
    runtimeAdmission: { bodies: b2.bodies, authorizeConfiguration }, systemActor: actor, now: f.now, newId: f.id,
    // NR tests reply binding; DU owns testing how these trusted facts are resolved.
    duties: { async readMessageDutiesFacts() { return { status: 'ready' as const,
      value: { duties: ['adviser' as const], readOnlyCopy: false, independentReview: false, guards: [] } }; } } };
  const userMailbox = createSessionMailbox(mailboxDeps);
  const decisions = createDecisionMessageService({ records, now: f.now, newId: f.id, operatorActor: actor,
    messages: userMailbox, materials, messageWrites: createMessageWriteOwner(mailboxDeps),
    sources: createDecisionSourceFacts({ records, bindings: createInitializationBindingReader({ records }) }) });
  const reconcile = createRunReconcileService({ records, reads, hostInstance: { hostInstanceId: 'wp2-host', lease: 'owned' }, now: f.now, eventId: f.id });
  let tokens = createNoticeDisplayToken(new Uint8Array(32).fill(1));
  let tokenGeneration = 1;
  function notices() {
    const source = factory({ records, sessions: f.sessions, messages: f.mailbox });
    const positions = createNoticePositionComparator();
    const queue = createDecisionReadModel({ records, cardSources: [], noticeSources: [source], positions, displayTokens: tokens,
      // Notice-only requests never call the unrelated conflict assembler.
      conflicts: { async queryGoalConflicts() { throw new Error('notice-only reads must not query conflicts'); } } });
    const settings = createDecisionSettingsService({ records, now: f.now, newId: f.id, operatorActor: actor, positions, displayTokens: tokens });
    return { source, queue, settings };
  }
  async function page(limit = 100) {
    return ready(await notices().queue.queryDecisionQueue(ctx, { workspace: base.scope,
      sections: ['notices'], categories: ['undelivered_reply'], page: { limit } }));
  }
  async function mark(value: DecisionQueueReadV1) {
    if (!value.displayToken) throw new Error('display page must issue a token');
    return committed(await notices().settings.markNoticesSeen(ctx, { input: { workspace: base.scope,
      displayToken: value.displayToken, seenThrough: value.seenThrough },
      meta: { requestId: f.id(), expected: [await f.pin(base.workspaceRef)] } }));
  }
  async function send(claim = b2.claim, recipient = f.D, waitAfterSend = false) {
    return committed(await f.mailbox.sendMessage(f.workCtx(claim), { input: { recipient, text: 'Which file should this work use?',
      intent: 'inquiry', needsReply: true, waitAfterSend }, meta: { requestId: f.id(), expected: [] } })).value;
  }
  async function replyWrite(message: SessionMessage) {
    return { input: { messageRef: message.ref, text: 'Use result.txt.' },
      meta: { requestId: f.id(), expected: [await f.pin(message.ref)] } };
  }
  async function health(verdict: 'ready' | 'missing' | 'damaged', sessionRef = f.S) {
    return f.healthOn().recordSessionHealth(ctx, { sessionRef, probe: { verdict, activeRunId: null } });
  }
  async function transfer(message: SessionMessage) {
    const request = await f.register({ wait: { kind: 'transfer', runRef: b2.claim.runRef, messageRef: message.ref, to: f.D } }, f.id());
    const receipt = committed(await f.mailbox.disposeArchiveWait(ctx, f.step(request, 'reply_handler', message.ref)));
    return { request, receipt };
  }
  async function closeWait(request: Awaited<ReturnType<ArchiveServiceFixture['register']>>) {
    committed(await f.mailbox.disposeArchiveWait(ctx, f.step(request, 'wait_cancel', b2.claim.runRef)));
    await f.cancel(request);
  }
  async function accept(message: SessionMessage) {
    const fact = await f.kernelAccept(b2.secondClaim, message);
    const write = { input: { messageRef: message.ref, part: 'response' as const, executionRef: b2.secondClaim.runRef,
      executionSessionRef: f.D, kernel: fact.kernel }, meta: { requestId: f.id(), expected: [] } };
    return committed(await f.mailbox.recordInputAccepted(ctx, write));
  }
  async function enterUser() {
    const entry = createExecutionEntryService({ records, reads, roles, bodies: b2.bodies, authorizeConfiguration, now: f.now, eventId: f.id, newId: f.id });
    const prepared = await b2.buildPrepared({ permissions: grant });
    const kernel = await b2.kernelFor(b2.claim);
    const permit = committed(await entry.authorizeRuntimeEntry(ctx, { input: { prepared, consumerId: f.id() }, meta: { requestId: f.id(), expected: [await f.pin(b2.claim.runRef)] } }));
    const begun = committed(await entry.beginRuntimeEntry(ctx, { input: { permit: permit.value, kernel }, meta: { requestId: f.id(), expected: [await f.pin(b2.claim.runRef)] } }));
    return committed(await entry.recordExecutionEntered(ctx, { input: { permit: { ...permit.value, authorizationRevision: begun.value.authorization.revision },
      enteredAt: f.now(), kernelSource: { ...kernel, position: 3 }, history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: f.id(), expected: [await f.pin(b2.claim.runRef)] } }));
  }
  async function userQuestion() {
    return committed(await userMailbox.sendUserMessage(f.workCtx(b2.claim), { input: { goalRef: base.goalRef,
      intent: 'decision_request', text: 'Continue the work?', needsReply: true, waitAfterSend: false,
      options: [{ id: 'continue', label: 'Continue', effect: 'defer' }], objects: [] }, meta: { requestId: f.id(), expected: [] } })).value;
  }
  async function userAnswerWrite(message: SessionMessage) {
    if (!message.decision) throw new Error('real question has no decision source');
    return { input: { source: message.decision.source, selection: { kind: 'option' as const, optionId: 'continue' }, text: 'Continue.', annotations: [] },
      meta: { requestId: f.id(), expected: [...message.decision.source.pins, await f.pin(message.ref)] } };
  }
  /** Query preparation and Kernel boundary observations use the existing trusted
   * B2 boundary, like S5-queue-support. No model/terminal record is raw-seeded. */
  async function query(sessionRef: SessionRef, message?: SessionMessage) {
    const budget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 };
    const host = { configurationRevision: 'wp2-query-host', permissions: { tools: ['read'], writeScope: [] as [] },
      hostTemplate: B2_HOST.hostTemplate, budget };
    const owner = createQueryExecution({ records: withBackendOrderedLookup(records, b2.base.records), roles, bodies: b2.bodies, now: f.now, eventId: f.id,
      hostInstance: { hostInstanceId: 'wp2-host', lease: 'owned' }, authorizeConfiguration: async () => ({ status: 'ready', value: host }) });
    const jobs = createQueryJobService({ records, execution: owner, consultations: f.mailbox, now: f.now, eventId: f.id });
    const ids = message ? consultationQueryRefs(message.ref) : (() => { const id = f.id(); return {
      queryJobRef: { aggregateType: 'QueryJob', ...base.scope, queryJobId: id } as QueryJobRef,
      queryRunRef: { aggregateType: 'QueryRun', ...base.scope, queryJobId: id, runId: id + '-run' } as QueryRunRef }; })();
    const { queryJobRef, queryRunRef } = ids;
    const question = message ? ready(await f.mailbox.readMessageBody(ctx, { messageRef: message.ref, part: 'message' })).text : 'Read the current goal.';
    committed(await jobs.submitQueryJob(ctx, { input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId,
      intent: { schemaVersion: 1, intentId: queryJobRef.queryJobId, ...base.scope, goalId: base.goalRef.goalId,
        question, focusTaskRefs: [], budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: f.id(),
        execution: { kind: 'semantic_query', roleBinding: base.roleBinding, runtimeBudget: budget,
          ...(message ? { consultation: { messageRef: message.ref, recipient: sessionRef } } : {}) } } },
      meta: { requestId: f.id(), expected: [await f.pin(base.projectRef), await f.pin(base.workspaceRef), await f.pin(base.goalRef),
        { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] } }));
    committed(await owner.claimQuery(ctx, { input: { queryRunRef, sessionRef }, meta: { requestId: f.id(),
      expected: [await f.pin(queryJobRef), await f.pin(queryRunRef), await f.sessionPin(sessionRef)] } }));
    const facts = ready(await owner.readPreparationFacts(ctx, queryRunRef));
    const prepared = (await prepareQueryForReal({ records, ctx }, {
      bodies: b2.bodies, queryRunRef, queryExecution: owner, now: f.now, requestId: f.id(),
      host: preparationHost({ configurationRevision: host.configurationRevision, permissions: host.permissions,
        hostTemplate: host.hostTemplate, budget }),
    })).prepared;
    const kernel = { ...facts.record.session.kernel, runId: f.id(), turnId: f.id() };
    const ticket = committed(await owner.beginQueryEntry(ctx, { input: { prepared, consumerId: f.id(), kernel }, meta: { requestId: f.id(),
      expected: [await f.pin(queryJobRef), await f.pin(queryRunRef), await f.sessionPin(sessionRef)] } })).value;
    const entry: QueryEntryIdentity = { queryRunRef, sessionRef, sessionGeneration: ticket.sessionGeneration,
      entryGeneration: ticket.entryGeneration, consumerId: ticket.consumerId, kernel };
    const history = { schemaVersion: 1 as const, sessionRef, kernel, startPosition: 1, observedThroughPosition: 2, endPosition: null };
    committed(await owner.recordQueryObservation(ctx, { input: { entry, history, source: { position: 2, cursor: 'wp2-query-entered' },
      observation: { kind: 'entered', occurredAt: f.now() } }, meta: { requestId: f.id(), expected: [await f.pin(queryRunRef)] } }));
    return { owner, queryRunRef, history, async answer() {
      const text = 'Use result.txt.';
      const stored = ready(await b2.bodies.put({ body: text, contentType: 'text/plain; charset=utf-8', sourceRefs: [],
        origin: { kind: 'run', owner: queryRunRef }, requestedAt: f.now() }));
      const answer: QueryJobAnswerV1 = { schemaVersion: 1, answerId: f.id(), queryJobRef, runRef: queryRunRef,
        roundIndex: 0, answer: text, sources: [], followsAnswerRef: null, stale: false, staleReason: null, answeredAt: f.now(), bodyRef: stored.ref, ideas: [], goalCardDrafts: [], planDraftIndex: null };
      const result = committed(await owner.recordQueryObservation(ctx, { input: { entry, history: { ...history, observedThroughPosition: 3, endPosition: 3 },
        source: { position: 3, cursor: 'wp2-query-answer' }, observation: { kind: 'terminal', occurredAt: f.now(), outcome: 'answered', answer, reason: null, answerCheck: null,
          activity: {
            status: 'counted', ruleVersion: 1,
            window: { kernelRunId: 'inert-run', kernelTurnId: 'inert-turn', fromPosition: 1, throughPosition: 1,
              bound: 'end_position', turnTerminal: true, unresolvedCalls: 0,
              turnStartedAt: '2026-10-23T09:00:00.000Z', lastRecordAt: '2026-10-23T09:00:00.000Z' },
            quarters: [], overflow: null, totals: { steps: 0, edits: 0, editsUnknown: 0 },
            changedFiles: { definite: [], possible: [], definiteOmitted: 0, possibleOmitted: 0,
              possiblyIncomplete: false, incompleteBecause: [] },
            usage: { requests: [], omitted: 0, totals: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, complete: true },
          },
        } },
        meta: { requestId: f.id(), expected: [await f.pin(queryRunRef)] } }));
      if (!result.value.answer || !message) throw new Error('answer association requires real consultation');
      const write = { input: { messageRef: message.ref, answerRef: result.value.answer.ref }, meta: { requestId: f.id(), expected: [await f.pin(message.ref)] } };
      return { result: committed(await f.mailbox.respondFromQueryAnswer!(ctx, write)), write };
    } };
  }
  async function workUnavailable(attest = false, claim = b2.claim) {
    const runRef = claim.runRef;
    const turn = { terminal: false, inFlightToolCallIds: [], lastPosition: 3, kernelPaused: false, entered: null, acceptedSteers: [], inputsConfirmed: true };
    if (attest) committed(await reconcile.reconcileRun(ctx, { input: { runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'wp2-host' },
      probe: 'missing', result: { kind: 'unknown', cause: 'kernel_unreadable', unresolvedToolCallIds: [], observedThroughPosition: null, turn: null } },
      meta: { requestId: f.id(), expected: [await f.pin(runRef)] } }));
    return attest ? committed(await reconcile.resolveUnknownRun(ctx, { input: { runRef, reason: 'Checked interrupted work', kernelTurnOpen: true, inputsConfirmed: null,
      review: { inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', items: [], itemsOmitted: 0,
        workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'WP2' } } },
      meta: { requestId: f.id(), expected: [await f.pin(runRef)] } })) : committed(await reconcile.reconcileRun(ctx, {
      input: { runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'wp2-host' }, probe: 'ready', result: { kind: 'interrupted_clean', turn } },
      meta: { requestId: f.id(), expected: [await f.pin(runRef)] } }));
  }
  async function queryUnavailable(q: Awaited<ReturnType<typeof query>>, attest = false) {
    if (!q.owner.reconcileQueryRun || !q.owner.resolveUnknownQueryRun) throw new Error('Query recovery ports missing');
    if (attest) committed(await q.owner.reconcileQueryRun(ctx, { input: { queryRunRef: q.queryRunRef, hostInstanceId: 'wp2-host', probe: 'missing',
      inputsConfirmed: 'kernel_unreadable', result: { kind: 'unknown', unresolvedToolCallIds: [], history: null } }, meta: { requestId: f.id(), expected: [await f.pin(q.queryRunRef)] } }));
    return attest ? committed(await q.owner.resolveUnknownQueryRun(ctx, { input: { queryRunRef: q.queryRunRef, reason: 'Checked interrupted query', kernelTurnOpen: true, inputsConfirmed: null },
      meta: { requestId: f.id(), expected: [await f.pin(q.queryRunRef)] } })) : committed(await q.owner.reconcileQueryRun(ctx, { input: {
      queryRunRef: q.queryRunRef, hostInstanceId: 'wp2-host', probe: 'ready', inputsConfirmed: true,
      result: { kind: 'interrupted_clean', kernelStatus: 'running', history: q.history } }, meta: { requestId: f.id(), expected: [await f.pin(q.queryRunRef)] } }));
  }
  async function storeSnapshot() {
    const horizon = ready(await records.readMany([])).readThrough;
    const saved = [];
    for (const aggregateType of [...types].sort()) {
      let after: string | undefined;
      do { const p = ready(await records.lookup({ index: 'wp2-all-' + aggregateType, values: [aggregateType], limit: 200,
        ...(after ? { after } : {}) })); saved.push(...p.records); after = p.next ?? undefined; } while (after);
    }
    const events = [];
    if (horizon) for (let seq = 1; seq <= seqOfCommitCursor(horizon); seq++) events.push(ready(await records.eventAt(makeCommitCursor(seq))));
    const claims: { claimKey: string; owner: string }[] = [];
    const known = new Set(f.batches.flatMap(b => b.batch.claims.map(c => c.claimKey)));
    for (const record of saved) if (JSON.parse(record.refKey).aggregateType === 'Session') {
      const decoded = decodeSessionRecord(record); if (decoded.status !== 'decoded') throw new Error(decoded.reason);
      known.add(kernelSessionClaimKey(decoded.value.kernel.adapterId, decoded.value.kernel.kernelSessionId));
    }
    const keys = [...known].sort();
    const beforeProbe = beforeWrites;
    for (const claimKey of keys) {
      const event = { eventId: 'wp2-probe', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: f.now() };
      const result = await records.commit({ identityKey: 'wp2-probe:' + claimKey, fingerprint: 'wp2-probe', guards: [], records: [],
        claims: [{ claimKey, expectedOwner: 'wp2-never-owner', nextOwner: 'wp2-never-owner' }], events: [{ ...event, json: JSON.stringify(event) }], indexGuards: [], indexChanges: [], ledgerHorizon: null });
      if (result.status !== 'rejected') throw new Error('snapshot claim probe must reject');
      if (result.code === 'unique_conflict') { const owner = result.current.find(c => c.claimKey === claimKey)?.owner;
        if (owner) claims.push({ claimKey, owner }); }
      else if (!(result.code === 'revision_conflict' && result.current.length === 0)) throw new Error('unexpected claim probe failure: ' + JSON.stringify(result));
    }
    expect(beforeWrites).toBe(beforeProbe); // Even a mistakenly matching slot loses the deliberately empty horizon.
    let receipts: unknown = f.writes.receipts;
    if (kind === 'sqlite') { const db = new DatabaseSync(base.ledgerPath, { readOnly: true });
      try {
        receipts = db.prepare('SELECT * FROM idempotency ORDER BY identity_key').all();
        claims.length = 0;
        for (const row of db.prepare('SELECT claim_key, owner_key FROM identity_claims ORDER BY claim_key').all()) {
          if (typeof row.claim_key !== 'string' || typeof row.owner_key !== 'string') throw new Error('corrupt persisted claim');
          claims.push({ claimKey: row.claim_key, owner: row.owner_key });
        }
      } finally { db.close(); } }
    expect(ready(await records.readMany([])).readThrough).toEqual(horizon);
    return { records: saved.sort((a, b) => a.refKey.localeCompare(b.refKey)), events, claims, receipts, horizon, calls: structuredClone(f.calls) };
  }
  return { f, kind, records, ctx, scope: base.scope, notices, page, mark, send, replyWrite, health, transfer, closeWait, accept,
    enterUser, userQuestion, userAnswerWrite, decisions, mailboxDeps, query, queryUnavailable, workUnavailable, storeSnapshot,
    get tokens() { return tokens; }, beforeWrites: () => beforeWrites,
    failBeforeWrite() { failBeforeWrite = true; },
    async reopen() { await withBackendOptions(() => f.reopen());
      if (kind === 'sqlite') tokens = createNoticeDisplayToken(new Uint8Array(32).fill(++tokenGeneration)); },
    close: () => f.close() };
}
export type WP2NoticesFixture = Awaited<ReturnType<typeof openWP2NoticesFixture>>;
