/**
 * Slice 5 part-1 route contract (SPEC §4.5/§5.4 RT01–RT08, F70, §8.2 scope/权限).
 *
 * Every row drives the REAL `dispatchCoreRoute` through the REAL
 * `createPlatformCoreRouteBindings`. The platform is a recorder: each named port
 * method records its name/arguments and returns the controlled result the row
 * installs for RT01–RT05/RT07, so those rows test the route layer (named binding,
 * graph_write rejection mapping, scope-before-owner order, ctx never taken from
 * the body). RT06 uses a real page/token/settings owner on SQLite; RT08 uses
 * the real composed queue and its scripted provider counter.
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { decodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createDecisionSettingsService } from '../../src/core/work-graph/configuration/decision-settings-service.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createExecutedFilesStub } from '../../src/core/work-graph/tasks/executed-files-stub.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createAutomaticReworkNoticeSource } from '../../src/core/work-graph/views/automatic-rework-notices.js';
import { createDecisionReadModel } from '../../src/core/work-graph/views/decision-read-model.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { platformRecordSchemas } from '../state/invariants.js';
import { cleanupScenarios, openPlatformScenario, type Platform } from '../scenarios/harness.js';
import { s5StoreSnapshot } from '../scenarios/support/S5-decisions.js';
import { createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest } from '../../src/app/core-routes.js';
import {
  CANDIDATE_U1, GOAL_B, GOAL_REVISION, OPERATOR, REQUEST_Q1, T, WORKSPACE, WORKSPACE_REVISION, WORKSPACE_SCOPE,
  openS5DecisionFixture,
} from '../helpers/S5-decision-fixture.js';

const P = WORKSPACE_SCOPE.projectId;
const SESSION = { projectId: P, sessionId: 'S' };
const OTHER = { projectId: P, workspaceId: 'OTHER' };
const ctx: CoreCallContext = { projectId: P, workspaceId: WORKSPACE_SCOPE.workspaceId,
  principal: { kind: 'host', actor: { ...OPERATOR } },
  materialReader: { kind: 'host', projectId: P, workspaceId: WORKSPACE_SCOPE.workspaceId, actor: { ...OPERATOR } },
  signal: new AbortController().signal };

type OwnerCall = { name: string; args: unknown[] };
const calls: OwnerCall[] = [];
const responses = new Map<string, unknown>();
const respond = (name: string, result: unknown): void => { responses.set(name, result); };
const callsTo = (name: string): OwnerCall[] => calls.filter(call => call.name === name);
const calledNames = (): string[] => calls.map(call => call.name);
const reset = (): void => { calls.length = 0; responses.clear(); };
const argAt = (call: OwnerCall | undefined, index: number): unknown => {
  if (call === undefined) throw new Error('the route owner was not called');
  if (index >= call.args.length) throw new Error(`the owner call has no argument ${index}`);
  return call.args[index];
};
const rejected = (code: string, reason: string) => ({ status: 'rejected', code, reason });
const committed = (value: unknown) => ({ status: 'committed', replayed: false, cursor: 'c-rt', value });
const ready = (value: unknown) => ({ status: 'ready', value });

function owner(name: string): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    calls.push({ name, args });
    if (!responses.has(name)) throw new Error(`unexpected route owner call: ${name}`);
    const controlled = responses.get(name);
    return typeof controlled === 'function'
      ? (controlled as (...inner: unknown[]) => unknown)(...args) : controlled;
  };
}
const group = (name: string): unknown => new Proxy({}, { get: (_t, key) => owner(`${name}.${String(key)}`) });
// `resolveUnknownRun`/`resolveUnknownQueryRun` are the only top-level method
// accesses (`.bind(platform)`), so they must be functions, not group proxies.
const TOP_LEVEL = new Set(['resolveUnknownRun', 'resolveUnknownQueryRun']);
let realPlatform: Platform;
let bindings: ReturnType<typeof createPlatformCoreRouteBindings>;
beforeEach(async () => {
  realPlatform = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: {
    async resolveRoot() { return { status: 'rejected', code: 'not_found', reason: 'no route fixture workspace IO' }; },
    async authorize() { return { status: 'rejected', code: 'forbidden', reason: 'no route fixture workspace IO' }; },
  } });
  // A typed real platform supplies the shape; recorder methods are restricted
  // to forwarding rows, never installed in RT06/RT08's owners under test.
  const recorder = new Proxy(realPlatform, {
    get: (_t, key) => (TOP_LEVEL.has(String(key)) ? owner(String(key)) : group(String(key))),
  });
  bindings = createPlatformCoreRouteBindings(recorder);
});
afterEach(async () => { await realPlatform.close(); await cleanupScenarios(); });
const dispatch = (suffix: Parameters<typeof dispatchCoreRoute>[1], body: unknown) =>
  dispatchCoreRoute(bindings, suffix, ctx, parseCoreRouteRequest(suffix, body));

it('RT01 decisions/queue is a plain read forwarded only to queryDecisionQueue with no write', async () => {
  reset();
  const queue = ready({ capabilities: [{ source: 'automatic_rework', availability: 'not_available' }] });
  respond('decisions.queryDecisionQueue', queue);
  const result = await dispatch('decisions/queue', { scope: WORKSPACE_SCOPE, input: {
    workspace: WORKSPACE_SCOPE, sections: ['waiting_answer', 'notices'], page: { limit: 10 } } });
  expect(result).toBe(queue);
  expect(callsTo('decisions.queryDecisionQueue')).toHaveLength(1);
  expect(calledNames()).toEqual(['decisions.queryDecisionQueue']); // one read, zero writes
});

it('RT02 decisions/answer is a Host-bound graph write: ctx operator stays, body actor/duties have no effect', async () => {
  reset();
  const answer = ready({ state: 'answered' });
  respond('workflow.resolveDecision', answer);
  const messageRef = { aggregateType: 'SessionMessage' as const, ...WORKSPACE_SCOPE, messageId: 'rt02' };
  const input = { source: { kind: 'message', key: decisionSourceKey({ kind: 'message', messageRef }), goalRef: GOAL_B, pins: [] },
    selection: { kind: 'option', optionId: 'accept' }, text: 'go', annotations: [] };
  const forged = { ...input, actor: { kind: 'human', id: 'forged' }, duties: ['admin'] };
  const meta = { requestId: 's5-rt02', expected: [{ ref: messageRef, revision: 1 }] };
  const forgedResult = await dispatch('decisions/answer', { scope: WORKSPACE_SCOPE, request: { input: forged, meta } });
  const cleanResult = await dispatch('decisions/answer', { scope: WORKSPACE_SCOPE, request: { input, meta } });
  expect(forgedResult).toBe(answer);
  expect(cleanResult).toBe(answer);
  const [forgedCall, cleanCall] = callsTo('workflow.resolveDecision');
  expect(argAt(forgedCall, 0)).toEqual(argAt(cleanCall, 0)); // trusted ctx identical forged vs clean
  const ownerCtx = argAt(forgedCall, 0) as CoreCallContext;
  expect(ctx.principal).toEqual({ kind: 'host', actor: { ...OPERATOR } }); // trusted Host operator
  expect(ownerCtx.principal).toEqual(ctx.principal); // body actor/duties never replaced it
  expect((argAt(forgedCall, 1) as { input: { actor?: unknown } }).input.actor)
    .toEqual({ kind: 'human', id: 'forged' }); // present only as untrusted data
  expect((argAt(forgedCall, 1) as { meta: unknown }).meta).toEqual(meta); // pins untampered
});

it('RT03 plans/propose carries requestRef, replaces and the expected pins to the owner', async () => {
  reset();
  const result = committed({ ref: CANDIDATE_U1 });
  respond('plans.proposePlan', result);
  const pin = { ref: GOAL_B, revision: GOAL_REVISION };
  const replaces = { proposalRef: CANDIDATE_U1, revision: 1 };
  const request = { input: { goalRef: GOAL_B, basedOn: null, draft: {}, reason: { text: 'rt03', sources: [] }, requestRef: REQUEST_Q1, replaces },
    meta: { requestId: 's5-rt03', expected: [pin] } };
  const returned = await dispatch('plans/propose', { scope: WORKSPACE_SCOPE, request });
  expect(returned).toBe(result);
  const [call] = callsTo('plans.proposePlan');
  expect(argAt(call, 0)).toBe(ctx);
  expect(argAt(call, 1)).toEqual(request); // full fields and expected pins reach the owner unchanged
});

it('RT04 plans/abandon without the proposal pin is invalid and never reaches a follow-up apply', async () => {
  reset();
  respond('requestCandidates.abandonPlanProposal', (...args: unknown[]) => {
    const request = args[1] as { meta?: { expected?: { ref?: unknown }[] } };
    const pinned = (request.meta?.expected ?? []).some(pin => JSON.stringify(pin.ref) === JSON.stringify(CANDIDATE_U1));
    return pinned ? committed({ ref: CANDIDATE_U1 })
      : rejected('invalid', 'plans/abandon requires the proposal version pin');
  });
  await expect(dispatch('plans/abandon', { scope: WORKSPACE_SCOPE, request: { input: { proposalRef: CANDIDATE_U1 },
    meta: { requestId: 's5-rt04', expected: [{ ref: GOAL_B, revision: GOAL_REVISION }] } } }))
    .rejects.toMatchObject({ rejection: { status: 'rejected', code: 'invalid' } });
  expect(calledNames()).toEqual(['requestCandidates.abandonPlanProposal']); // no apply/follow-up owner
});

it('RT05 goals/settings/set from another workspace is forbidden before any owner call', async () => {
  reset();
  await expect(dispatch('goals/settings/set', { scope: OTHER, request: { input: { goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null },
    meta: { requestId: 's5-rt05', expected: [{ ref: GOAL_B, revision: GOAL_REVISION }] } } }))
    .rejects.toMatchObject({ rejection: { status: 'rejected', code: 'forbidden' } });
  expect(calls).toHaveLength(0); // scope compares before the binding is reached
});

it('RT06 decisions/notices/seen with a mismatched display token is invalid and changes no Workspace', async () => {
  reset();
  const f = await openS5DecisionFixture('sqlite');
  const sourceRoot = join(f.base.directory, 'rt06-source');
  await mkdir(sourceRoot);
  await writeFile(join(sourceRoot, 'source.txt'), 'RT06 real requeue source\n');
  const composed = await createTargetPlatform({ storage: { kind: 'sqlite', directory: f.base.directory }, now: () => T,
    workspace: {
      async resolveRoot(scope) {
        return scope.projectId === WORKSPACE_SCOPE.projectId && scope.workspaceId === WORKSPACE_SCOPE.workspaceId
          ? { status: 'ready', value: { root: sourceRoot, workspaceRevision: WORKSPACE_REVISION } }
          : { status: 'rejected', code: 'not_found', reason: 'outside RT06 scope' };
      },
      async authorize() { return { status: 'ready', value: { subjectKey: 'rt06', permissionRevision: 'rt06@1', allowsRead: () => true } }; },
    } });
  const backend = createSqliteRecordBackend({ path: f.b2.base.ledgerPath, schemas: platformRecordSchemas() });
  try {
    // A real entered Run ends and is requeued by the system. Thus the token
    // comes from a nonempty formal notice page, never a hand-issued payload.
    const runRead = await composed.executions.readExecution(f.ctx, f.runRA.ref);
    if (runRead.status !== 'ready') throw new Error('RT06 entered Run must be readable');
    const run = runRead.value.run;
    const auth = run.executionAuthorization;
    if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2 || auth.kernel === null) {
      throw new Error('RT06 needs the stored entered authorization');
    }
    const kernel = auth.kernel;
    const ended = await f.b2.entry.recordRunResult(f.ctx, {
      input: { claim: f.claimRA, entry: { consumerId: auth.consumerId, entryGeneration: auth.generation },
        event: { eventType: 'run_crashed', schemaVersion: 1, eventId: 'rt06-crashed', runRef: run.ref,
          sequence: run.lastEventSeq + 1, occurredAt: T, payload: { kind: 'crashed', error: 'RT06 work failed' } },
        kernelSource: { ...kernel, position: 4 },
        completedHistoryBoundary: { source: { ...kernel, position: 4 }, cursor: 'rt06-terminal-4' },
        history: { kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 } },
      meta: { requestId: 'rt06-end', expected: [{ ref: run.ref, revision: run.revision }] } });
    expect(ended).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'crashed' } });
    if (ended.status !== 'committed') throw new Error(`RT06 terminal: ${JSON.stringify(ended)}`);
    const goal = await composed.plans.queryGoal(f.ctx, GOAL_B);
    if (goal.status !== 'ready') throw new Error('RT06 Goal must be readable');
    const automationCtx: CoreCallContext = { ...f.ctx, principal: { kind: 'host', actor: WORKFLOW_AUTOMATION_ACTOR },
      materialReader: { kind: 'host', ...WORKSPACE_SCOPE, actor: WORKFLOW_AUTOMATION_ACTOR } };
    const requeue = composed.claims.requeueTask;
    if (requeue === undefined) throw new Error('RT06 requeue owner is absent');
    const requeued = await requeue(automationCtx, { input: { taskRef: run.task, afterRunRef: run.ref, reason: 'RT06 automatic retry' },
      meta: { requestId: 'rt06-requeue', expected: [{ ref: GOAL_B, revision: goal.value.goal.revision },
        { ref: run.ref, revision: ended.value.revision }] } });
    expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued', requeue: { automation: { autoCount: 1 } } } });
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') throw new Error(`RT06 requeue: ${JSON.stringify(requeued)}`);

    // Same real token codec and position comparator shared by reads/settings,
    // as create-platform builds them; settings binds the configured operator.
    const records = backend.records;
    const displayTokens = createNoticeDisplayToken(randomBytes(32));
    const positions = createNoticePositionComparator();
    const reads = createDecisionReadModel({ records, cardSources: [],
      noticeSources: [createAutomaticReworkNoticeSource({ records })], displayTokens, positions,
      conflicts: createGoalConflictAssembler({ records, catalog: createArchitectureCatalogService({ records }),
        executedFiles: createExecutedFilesStub() }) });
    const settings = createDecisionSettingsService({ records, displayTokens, positions,
      operatorActor: OPERATOR, now: () => T, newId: randomUUID });
    const realBindings = createPlatformCoreRouteBindings({ ...composed, decisions: reads, workspaceDecisionSettings: settings });
    const page = await reads.queryDecisionQueue(f.ctx, { workspace: WORKSPACE_SCOPE, sections: ['notices'],
      categories: ['automatic_rework'], page: { limit: 1 } });
    if (page.status !== 'ready') throw new Error(`RT06 page: ${JSON.stringify(page)}`);
    expect(page.value.notices).toHaveLength(1);
    const notice = page.value.notices[0];
    if (notice === undefined || page.value.displayToken === null) throw new Error('RT06 needs an issued display token');
    expect(displayTokens.verify(page.value.displayToken)).toMatchObject({ workspace: WORKSPACE_SCOPE,
      operator: OPERATOR, categories: ['automatic_rework'], returnedKeys: [notice.itemKey],
      seenThrough: { automatic_rework: notice.position } });
    const readWorkspace = async () => {
      const batch = await records.readMany([canonicalJson(WORKSPACE)]);
      if (batch.status !== 'ready') throw new Error('RT06 Workspace read failed');
      const record = batch.value.records[0];
      if (record === undefined) throw new Error('RT06 Workspace missing');
      const decoded = decodeWorkspaceSnapshot(record);
      if (decoded.status !== 'decoded') throw new Error(decoded.reason);
      return decoded.value;
    };
    const beforeWorkspace = await readWorkspace();
    expect(beforeWorkspace).toMatchObject({ revision: 3, decisionSettings: { schemaVersion: 1, noticeSeen: {} } });
    const before = s5StoreSnapshot(f.b2.base.ledgerPath);
    const body = { scope: WORKSPACE_SCOPE, request: {
      // The signed page is automatic_rework; trying to mark another category
      // with its real displayed position is a filter mismatch.
      input: { workspace: WORKSPACE_SCOPE, displayToken: page.value.displayToken, seenThrough: { member_notice: notice.position } },
      meta: { requestId: 's5-rt06', expected: [{ ref: WORKSPACE, revision: WORKSPACE_REVISION }] } } };
    await expect(dispatchCoreRoute(realBindings, 'decisions/notices/seen', f.ctx,
      parseCoreRouteRequest('decisions/notices/seen', body)))
      .rejects.toMatchObject({ rejection: { status: 'rejected', code: 'invalid' } });
    expect(await readWorkspace()).toEqual(beforeWorkspace);
    expect(s5StoreSnapshot(f.b2.base.ledgerPath)).toEqual(before);
  } finally {
    await backend.close();
    await composed.close();
    await f.close();
  }
});

it('RT07 messages/send keeps the old SessionRef binding and never enters sendUserMessage', async () => {
  reset();
  const sent = committed({ ref: { aggregateType: 'SessionMessage', projectId: P, workspaceId: WORKSPACE_SCOPE.workspaceId, messageId: 'rt07' }, revision: 1 });
  respond('messages.sendMessage', sent);
  const request = { input: { recipient: SESSION, text: 'old session message', replyMode: 'wait' }, meta: { requestId: 's5-rt07', expected: [] } };
  const result = await dispatch('messages/send', { scope: WORKSPACE_SCOPE, request });
  expect(result).toBe(sent);
  expect(argAt(callsTo('messages.sendMessage')[0], 1)).toEqual(request); // old binding/response shape
  expect(callsTo('decisionMessages.sendUserMessage')).toHaveLength(0);
  expect(calledNames()).toEqual(['messages.sendMessage']);
});

it('RT08 an unsupported-source queue returns capabilities, not a fake completion, and calls no model', async () => {
  reset();
  const h = await openPlatformScenario({ actor: OPERATOR, script: { replies: [] } });
  const caller = h.ctx();
  const scope = { projectId: caller.projectId, workspaceId: caller.workspaceId };
  const realBindings = createPlatformCoreRouteBindings(h.platform);
  const before = s5StoreSnapshot(join(h.database, 'ledger.sqlite'));
  const result = await dispatchCoreRoute(realBindings, 'decisions/queue', caller,
    parseCoreRouteRequest('decisions/queue', { scope, input: { workspace: scope,
      sections: ['waiting_answer', 'notices'], categories: ['undelivered_reply'], page: { limit: 1 } } }));
  expect(result).toMatchObject({ status: 'ready', value: { countsComplete: false,
    capabilities: expect.arrayContaining([{ source: 'undelivered_reply', availability: 'not_available' }]) } });
  expect(s5StoreSnapshot(join(h.database, 'ledger.sqlite'))).toEqual(before);
  expect(h.modelCalls(), 'the actual scripted provider received no request').toBe(0);
});
