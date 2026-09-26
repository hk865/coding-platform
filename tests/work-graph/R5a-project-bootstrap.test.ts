/**
 * R5a stage-1 boundary tests for the four Project/Workspace/CompletionPolicy
 * writers. They run against a REAL in-memory RecordStore and the real service
 * factory (no fixture seeds), and assert the FINAL semantics frozen in
 * docs/refactor/tasks/R5a-project-bootstrap-skeleton.md §3-4.
 *
 * Stage-1 skeleton: every writer is explicitly `unsupported`, so these
 * assertions are EXPECTED to be red until the stage-2 implementation lands.
 * They must not be relaxed to pass early. Tests whose setup needs an earlier
 * writer to commit stop at that first red; the later assertions in those tests
 * have NOT been reached by the skeleton run (listed in the hand-back report).
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CompletionPolicyContentV1 } from '../../src/contracts/governance.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createInMemoryRecordBackend, type InMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import type { ProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-contracts.js';

const projectId = 'r5a-bootstrap-project';
const workspaceId = 'r5a-bootstrap-workspace';
const at = '2026-09-26T00:00:00.000Z';
const actor = { kind: 'human' as const, id: 'r5a-operator' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const policyId = 'r5a-policy';
const policyRef = (contentRevision: number) =>
  ({ aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId, revision: contentRevision });

/**
 * Independent protocol check: fixed canonical JSON bytes for the contentRevision
 * 1/2 fixtures and their SHA-256 computed here with `node:crypto`, NOT by the
 * production digest function. This is what the writer must reproduce byte for
 * byte; `contentRevision` is folded into the digest while the immutable ROW
 * revision stays 1.
 */
const POLICY_CANONICAL_1 = '{"content":{"minimumRequiredRequirementsPerObligation":1,"requirementKinds":["test"],"schemaVersion":1},"identity":{"policyId":"r5a-policy"},"revision":1,"schemaVersion":1}';
const POLICY_CANONICAL_2 = '{"content":{"minimumRequiredRequirementsPerObligation":1,"requirementKinds":["test"],"schemaVersion":1},"identity":{"policyId":"r5a-policy"},"revision":2,"schemaVersion":1}';
const POLICY_DIGEST_1 = '32e65cb6277136aada9aa6770dc046e549b99a4a0de2cae495fe3a81c0746524';
const POLICY_DIGEST_2 = '6241d22bddc352d7d7ba6acbd07790c0bae8177b504375cc7df86bc394a1b5d5';
const independentDigest = (canonical: string) => createHash('sha256').update(canonical, 'utf8').digest('hex');

function content(over: Partial<CompletionPolicyContentV1> = {}): CompletionPolicyContentV1 {
  return { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1, ...over };
}

const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const ctxFor = (scopeProjectId: string, scopeWorkspaceId?: string): CoreCallContext => ({
  projectId: scopeProjectId,
  ...(scopeWorkspaceId === undefined ? {} : { workspaceId: scopeWorkspaceId }),
  principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId: scopeProjectId, ...(scopeWorkspaceId === undefined ? {} : { workspaceId: scopeWorkspaceId }), actor },
  signal: new AbortController().signal,
});
const roleBinding = { schemaVersion: 1 as const, bindingId: 'r5a-binding', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const workRunCtx: CoreCallContext = { projectId, workspaceId,
  principal: { kind: 'work_run', runRef: { aggregateType: 'Run', projectId, goalId: 'r5a-goal', runId: 'r5a-run' }, roleBinding },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const queryRunCtx: CoreCallContext = { projectId, workspaceId,
  principal: { kind: 'query_run', queryRunRef: { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: 'r5a-qj', runId: 'r5a-qr' }, initiator: actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };

const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...(GOAL_RECORD_SCHEMAS.lookups ?? []), ...(PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? [])],
};

const backends: InMemoryRecordBackend[] = [];
afterEach(async () => { for (const backend of backends.splice(0)) await backend.close(); });
function newBackend(): InMemoryRecordBackend {
  const backend = createInMemoryRecordBackend({ schemas });
  backends.push(backend);
  return backend;
}
function bootstrap(records: GoalRecordTransactionPort): ProjectBootstrapServices {
  let counter = 0;
  return createProjectBootstrapServices({ records, now: () => at, eventId: () => `r5a-event-${++counter}` });
}
function service(): { services: ProjectBootstrapServices; backend: InMemoryRecordBackend } {
  const backend = newBackend();
  return { backend, services: bootstrap(backend.records) };
}
type Committed<T> = Extract<T, { status: 'committed' }>;
function committed<T extends { status: string }>(result: T): Committed<T> {
  if (result.status !== 'committed') throw new Error('expected a committed write, got ' + result.status);
  return result as Committed<T>;
}
async function eventBody(backend: InMemoryRecordBackend, cursor: CommitCursor, eventType: string): Promise<Record<string, unknown>> {
  const event = await backend.records.eventAt(cursor);
  expect(event).toMatchObject({ status: 'ready', value: { cursor, event: { eventType } } });
  if (event.status !== 'ready') throw new Error('no event at the receipt cursor');
  return JSON.parse(event.value.event.json) as Record<string, unknown>;
}
async function commitProject(services: ProjectBootstrapServices, requestId = 'r5a-project-1') {
  return committed(await services.projects.createProject(ctx, { meta: { requestId, expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } }));
}
async function installPolicy(services: ProjectBootstrapServices, contentRevision: number, requestId: string, body = content()) {
  return committed(await services.completionPolicies.installCompletionPolicy(ctx, {
    meta: { requestId, expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef(contentRevision), revision: 0 }] },
    input: { policyId, contentRevision, content: body } }));
}
const activePin = (expectedRevision: number) => ({ requestId: 'r5a-activate-' + String(expectedRevision), expected: [
  { ref: projectRef, revision: 1 }, { ref: activeRef, revision: expectedRevision }] });

describe('R5a Project registration', () => {
  it('creates Project@1, attributes the receipt event and replays the original value/cursor', async () => {
    const { services, backend } = service();
    const first = await commitProject(services);
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: { ref: projectRef, revision: 1 } });
    expect(await eventBody(backend, first.cursor, 'ProjectRegistered')).toMatchObject({
      projectId, actor: { kind: 'human', id: actor.id }, requestId: 'r5a-project-1', payload: { value: first.value } });
    const replay = await services.projects.createProject(ctx, { meta: { requestId: 'r5a-project-1', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } });
    expect(replay).toMatchObject({ status: 'committed', replayed: true, value: first.value, cursor: first.cursor });
  });

  it('rejects a NEW request for an existing Project with revision_conflict and never overwrites it', async () => {
    const { services } = service();
    await commitProject(services);
    const second = await services.projects.createProject(ctx, { meta: { requestId: 'r5a-project-2', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } });
    expect(second).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(second).not.toMatchObject({ status: 'committed' });
    // A nonzero absence pin is unsatisfiable, but it does not prove the real
    // current Project is absent. Report no current detail or the actual revision.
    const nonzero = await services.projects.createProject(ctx, {
      meta: { requestId: 'r5a-existing-nonzero', expected: [{ ref: projectRef, revision: 7 }] }, input: { projectId } });
    expect(nonzero).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    if (nonzero.status === 'rejected' && nonzero.code === 'revision_conflict' && nonzero.current !== undefined) {
      expect(nonzero.current).not.toContainEqual({ ref: projectRef, revision: 0 });
    }
  });

  it('rejects work_run/query_run principals and a foreign ctx project as forbidden', async () => {
    const { services } = service();
    const request = { meta: { requestId: 'r5a-project-forbidden', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } };
    expect(await services.projects.createProject(workRunCtx, request)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await services.projects.createProject(queryRunCtx, request)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await services.projects.createProject(ctxFor('another-project'), request)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('rejects a changed expected set under the same request identity as idempotency_conflict', async () => {
    const { services } = service();
    await commitProject(services);
    const conflict = await services.projects.createProject(ctx, {
      meta: { requestId: 'r5a-project-1', expected: [{ ref: projectRef, revision: 4 }] }, input: { projectId } });
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it('rejects missing, duplicated, foreign or wrong-version expected pins', async () => {
    const { services } = service();
    const base = { input: { projectId } };
    expect(await services.projects.createProject(ctx, { ...base, meta: { requestId: 'r5a-e1', expected: [] } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await services.projects.createProject(ctx, { ...base, meta: { requestId: 'r5a-e2', expected: [{ ref: projectRef, revision: 0 }, { ref: projectRef, revision: 0 }] } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await services.projects.createProject(ctx, { ...base, meta: { requestId: 'r5a-e3', expected: [{ ref: { aggregateType: 'Project', projectId: 'foreign' }, revision: 0 }] } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await services.projects.createProject(ctx, { ...base, meta: { requestId: 'r5a-e4', expected: [{ ref: projectRef, revision: 7 }] } }))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  });
});

describe('R5a Workspace registration', () => {
  it('requires the Project to exist, writes Workspace@1, attributes the receipt and replays it', async () => {
    const { services, backend } = service();
    const request = { meta: { requestId: 'r5a-w1', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: { projectId, workspaceId } } };
    expect(await services.projects.registerWorkspace(ctx, request)).toMatchObject({ status: 'rejected', code: 'not_found' });
    await commitProject(services);
    const registered = committed(await services.projects.registerWorkspace(ctx, request));
    expect(registered).toMatchObject({ status: 'committed', replayed: false, value: { ref: workspaceRef, revision: 1 } });
    expect(await eventBody(backend, registered.cursor, 'ProjectWorkspaceRegistered')).toMatchObject({
      projectId, actor: { kind: 'human', id: actor.id }, requestId: 'r5a-w1', payload: { value: registered.value } });
    expect(await services.projects.registerWorkspace(ctx, request)).toMatchObject({ status: 'committed', replayed: true, value: registered.value, cursor: registered.cursor });
  });

  it('rejects a ctx/workspace scope mismatch as forbidden and a NEW request over an existing Workspace as revision_conflict', async () => {
    const { services } = service();
    await commitProject(services);
    expect(await services.projects.registerWorkspace(ctx, { meta: { requestId: 'r5a-w-mismatch', expected: [{ ref: projectRef, revision: 1 }] }, input: { workspace: { projectId, workspaceId: 'other' } } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    const request = { meta: { requestId: 'r5a-w-existing', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: { projectId, workspaceId } } };
    await committed(await services.projects.registerWorkspace(ctx, request));
    expect(await services.projects.registerWorkspace(ctx, { meta: { requestId: 'r5a-w-overwrite', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: { projectId, workspaceId } } }))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  });
});

describe('R5a CompletionPolicy configuration', () => {
  it('installs immutable revisions with the frozen canonical bytes/digest and the row revision stays 1', async () => {
    const { services, backend } = service();
    await commitProject(services);
    expect(independentDigest(POLICY_CANONICAL_1)).toBe(POLICY_DIGEST_1);
    const installed = await installPolicy(services, 1, 'r5a-i1');
    expect(installed).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: policyRef(1), revision: 1, policyId, contentRevision: 1, content: content() } });
    expect(installed.value.contentDigest).toBe(POLICY_DIGEST_1);
    expect(await eventBody(backend, installed.cursor, 'ProjectCompletionPolicyInstalled')).toMatchObject({
      projectId, actor: { kind: 'human', id: actor.id }, requestId: 'r5a-i1', payload: { value: installed.value } });

    // A SECOND content revision gets its own identity/digest but is still an
    // immutable ROW revision 1; install never activates it.
    expect(independentDigest(POLICY_CANONICAL_2)).toBe(POLICY_DIGEST_2);
    const second = await installPolicy(services, 2, 'r5a-i2');
    expect(second.value).toMatchObject({ ref: policyRef(2), revision: 1, contentRevision: 2 });
    expect(second.value.contentDigest).toBe(POLICY_DIGEST_2);
    const active = await backend.records.readMany([canonicalJson(activeRef as unknown as JsonValue)]);
    expect(active).toMatchObject({ status: 'ready', value: { missing: [canonicalJson(activeRef as unknown as JsonValue)] } });
  });

  it('rejects structurally invalid policy content as invalid', async () => {
    const { services } = service();
    await commitProject(services);
    for (const [index, body] of [content({ requirementKinds: [] }),
      content({ minimumRequiredRequirementsPerObligation: 0 }),
      content({ fastPathDiffClasses: ['ok', 7 as unknown as string] })].entries()) {
      expect(await services.completionPolicies.installCompletionPolicy(ctx, {
        meta: { requestId: 'r5a-bad-' + String(index), expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef(1), revision: 0 }] },
        input: { policyId, contentRevision: 1, content: body } })).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
  });

  it('activates an exact installed pin, attributes the receipt and advances only that project pointer', async () => {
    const { services, backend } = service();
    await commitProject(services);
    const first = await installPolicy(services, 1, 'r5a-i1');
    const activated = committed(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: activePin(0), input: { target: { ref: first.value.ref, digest: first.value.contentDigest } } }));
    expect(activated).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: activeRef, projectId, activeRevision: policyRef(1), revision: 1 } });
    expect(await eventBody(backend, activated.cursor, 'ProjectCompletionPolicyActivated')).toMatchObject({
      projectId, actor: { kind: 'human', id: actor.id }, requestId: 'r5a-activate-0', payload: { value: activated.value } });
    const second = await installPolicy(services, 2, 'r5a-i2');
    const advanced = committed(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: activePin(1), input: { target: { ref: second.value.ref, digest: second.value.contentDigest } } }));
    expect(advanced).toMatchObject({ status: 'committed', value: { activeRevision: policyRef(2), revision: 2 } });
  });

  it('rejects a wrong pin digest as source_stale, an uninstalled target as not_found, a foreign target scope as forbidden and a foreign expected pin as invalid', async () => {
    const { services } = service();
    await commitProject(services);
    const installed = await installPolicy(services, 1, 'r5a-i1');
    const validTarget = { ref: installed.value.ref, digest: installed.value.contentDigest };
    expect(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: activePin(0), input: { target: { ref: installed.value.ref, digest: 'f'.repeat(64) } } }))
      .toMatchObject({ status: 'rejected', code: 'source_stale' });
    expect(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: activePin(0), input: { target: { ref: policyRef(9), digest: 'a'.repeat(64) } } }))
      .toMatchObject({ status: 'rejected', code: 'not_found' });
    // Input target scope violation is forbidden; a foreign EXPECTED pin is invalid.
    expect(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: activePin(0), input: { target: {
        ref: { aggregateType: 'CompletionPolicyRevision', projectId: 'foreign-project', policyId, revision: 1 }, digest: 'a'.repeat(64) } } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: { requestId: 'r5a-activate-foreign-expected', expected: [
        { ref: projectRef, revision: 1 }, { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: 'foreign-project' }, revision: 0 }] },
      input: { target: validTarget } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('lets only one of two different requests on the same active pin commit', async () => {
    const { services } = service();
    await commitProject(services);
    const one = await installPolicy(services, 1, 'r5a-i1');
    const two = await installPolicy(services, 2, 'r5a-i2');
    const [left, right] = await Promise.all([
      services.completionPolicies.activateCompletionPolicy(ctx, { meta: { requestId: 'r5a-race-left', expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] }, input: { target: { ref: one.value.ref, digest: one.value.contentDigest } } }),
      services.completionPolicies.activateCompletionPolicy(ctx, { meta: { requestId: 'r5a-race-right', expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] }, input: { target: { ref: two.value.ref, digest: two.value.contentDigest } } }),
    ]);
    const outcomes = [left, right];
    expect(outcomes.filter(outcome => outcome.status === 'committed')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected' && outcome.code === 'revision_conflict')).toHaveLength(1);
  });

  it('recovers the SAME cursor/value for two same-identity calls through a real lookup-miss window', async () => {
    const backend = newBackend();
    const setup = bootstrap(backend.records);
    await commitProject(setup);
    const one = await installPolicy(setup, 1, 'r5a-i1');

    let releaseLookups!: () => void;
    const lookupGate = new Promise<void>(resolve => { releaseLookups = resolve; });
    let lookups = 0;
    const gated: GoalRecordTransactionPort = {
      readMany: keys => backend.records.readMany(keys),
      commit: input => backend.records.commit(input),
      eventAt: cursor => backend.records.eventAt(cursor),
      async lookupCommit(input) {
        lookups += 1;
        if (lookups >= 2) releaseLookups();
        await lookupGate;
        return backend.records.lookupCommit(input);
      },
    };
    const racer = bootstrap(gated);
    const request = { meta: { requestId: 'r5a-same-key', expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
      input: { target: { ref: one.value.ref, digest: one.value.contentDigest } } };
    try {
      const [a, b] = await Promise.all([
        racer.completionPolicies.activateCompletionPolicy(ctx, request),
        racer.completionPolicies.activateCompletionPolicy(ctx, request),
      ]);
      const left = committed(a);
      const right = committed(b);
      expect(left.cursor).toBe(right.cursor);
      expect(left.value).toEqual(right.value);
      expect([left.replayed, right.replayed].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    } finally {
      releaseLookups();
    }
  });

  it('keeps replaying the original activation receipt after a later activation', async () => {
    const { services } = service();
    await commitProject(services);
    const one = await installPolicy(services, 1, 'r5a-i1');
    const original = committed(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: activePin(0), input: { target: { ref: one.value.ref, digest: one.value.contentDigest } } }));
    const two = await installPolicy(services, 2, 'r5a-i2');
    await committed(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: activePin(1), input: { target: { ref: two.value.ref, digest: two.value.contentDigest } } }));
    expect(await services.completionPolicies.activateCompletionPolicy(ctx, {
      meta: activePin(0), input: { target: { ref: one.value.ref, digest: one.value.contentDigest } } }))
      .toMatchObject({ status: 'committed', replayed: true, value: original.value, cursor: original.cursor });
  });
});

describe('R5a cancellation/commit seam', () => {
  it('cancels at a real lookup await boundary with zero writes, and keeps a real committed result after a late cancel', async () => {
    // Before commit: abort while the service is inside the necessary lookup await.
    const backend = newBackend();
    const controller = new AbortController();
    const beforeCommit: GoalRecordTransactionPort = {
      readMany: keys => backend.records.readMany(keys),
      commit: input => backend.records.commit(input),
      eventAt: cursor => backend.records.eventAt(cursor),
      async lookupCommit(input) {
        const result = await backend.records.lookupCommit(input);
        controller.abort();
        return result;
      },
    };
    const request = { meta: { requestId: 'r5a-cancel-before', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } };
    expect(await bootstrap(beforeCommit).projects.createProject({ ...ctx, signal: controller.signal }, request))
      .toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(await backend.records.readMany([canonicalJson(projectRef as unknown as JsonValue)]))
      .toMatchObject({ status: 'ready', value: { missing: [canonicalJson(projectRef as unknown as JsonValue)] } });

    // After commit: the REAL store commit returns committed first, then the
    // original signal aborts; the service must still return that committed result.
    const lateBackend = newBackend();
    const late = new AbortController();
    const afterCommit: GoalRecordTransactionPort = {
      readMany: keys => lateBackend.records.readMany(keys),
      eventAt: cursor => lateBackend.records.eventAt(cursor),
      async commit(input) {
        const result = await lateBackend.records.commit(input);
        if (result.status === 'committed') late.abort();
        return result;
      },
      lookupCommit: input => lateBackend.records.lookupCommit(input),
    };
    const committedWrite = await bootstrap(afterCommit).projects.createProject({ ...ctx, signal: late.signal },
      { ...request, meta: { requestId: 'r5a-cancel-after', expected: [{ ref: projectRef, revision: 0 }] } });
    expect(committedWrite).toMatchObject({ status: 'committed' });
    late.abort();
    expect(committedWrite).toMatchObject({ status: 'committed' });
  });
});

// Independent implementation-review regressions: real provider calls with only
// their response timing changed. No records or receipts are seeded or mutated.
describe('R5a real provider response windows', () => {
  it('recovers the original receipt when the real commit succeeds but its response is lost', async () => {
    const backend = newBackend();
    let commits = 0;
    let actualCursor: CommitCursor | undefined;
    const records: GoalRecordTransactionPort = {
      readMany: keys => backend.records.readMany(keys),
      lookupCommit: input => backend.records.lookupCommit(input),
      eventAt: cursor => backend.records.eventAt(cursor),
      async commit(input) {
        commits++;
        const result = await backend.records.commit(input);
        if (result.status === 'committed') {
          actualCursor = result.cursor;
          throw new Error('the committed response was lost');
        }
        return result;
      },
    };
    const services = bootstrap(records);
    const request = { meta: { requestId: 'r5a-lost-commit', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } };
    const result = await services.projects.createProject(ctx, request);
    expect(actualCursor).toBeDefined();
    expect(result).toMatchObject({ status: 'committed', replayed: true,
      value: { ref: projectRef, revision: 1 }, cursor: actualCursor });
    expect(await services.projects.createProject(ctx, request)).toEqual(result);
    expect(commits).toBe(1);
    expect(await eventBody(backend, committed(result).cursor, 'ProjectRegistered'))
      .toMatchObject({ requestId: request.meta.requestId, payload: { value: committed(result).value } });
  });

  it('honors cancellation during each real necessary read before any registration or policy commit', async () => {
    const outcomes: Array<{ operation: string; status: string; code?: string; commits: number }> = [];
    for (const operation of ['workspace', 'install', 'activate'] as const) {
      const backend = newBackend();
      const setup = bootstrap(backend.records);
      await commitProject(setup);
      const installed = operation === 'activate' ? await installPolicy(setup, 1, 'r5a-read-cancel-setup') : null;
      const controller = new AbortController();
      let commits = 0;
      const records: GoalRecordTransactionPort = {
        lookupCommit: input => backend.records.lookupCommit(input),
        eventAt: cursor => backend.records.eventAt(cursor),
        async readMany(keys) {
          const result = await backend.records.readMany(keys);
          controller.abort();
          return result;
        },
        async commit(input) { commits++; return backend.records.commit(input); },
      };
      const services = bootstrap(records);
      const cancelledCtx = { ...ctx, signal: controller.signal };
      const result = operation === 'workspace'
        ? await services.projects.registerWorkspace(cancelledCtx, {
          meta: { requestId: 'r5a-read-cancel-workspace', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
          input: { workspace: { projectId, workspaceId } } })
        : operation === 'install'
          ? await services.completionPolicies.installCompletionPolicy(cancelledCtx, {
            meta: { requestId: 'r5a-read-cancel-install', expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef(1), revision: 0 }] },
            input: { policyId, contentRevision: 1, content: content() } })
          : await services.completionPolicies.activateCompletionPolicy(cancelledCtx, {
            meta: activePin(0), input: { target: { ref: installed!.value.ref, digest: installed!.value.contentDigest } } });
      outcomes.push({ operation, status: result.status, ...(result.status === 'rejected' ? { code: result.code } : {}), commits });
    }
    expect(outcomes).toEqual(['workspace', 'install', 'activate'].map(operation =>
      ({ operation, status: 'rejected', code: 'cancelled', commits: 0 })));
  });

  it('rejects an expected policy content revision that names a different row from the install input', async () => {
    const { services, backend } = service();
    await commitProject(services);
    const result = await services.completionPolicies.installCompletionPolicy(ctx, {
      meta: { requestId: 'r5a-wrong-policy-ref', expected: [{ ref: projectRef, revision: 1 }, { ref: policyRef(2), revision: 0 }] },
      input: { policyId, contentRevision: 1, content: content() } });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    const keys = [1, 2].map(revision => canonicalJson(policyRef(revision) as unknown as JsonValue));
    expect(await backend.records.readMany(keys)).toMatchObject({ status: 'ready', value: { records: [], missing: keys } });
  });

  it('recovers a same-identity winner committed after the loser lookup miss but before its fresh active read', async () => {
    const backend = newBackend();
    const winner = bootstrap(backend.records);
    await commitProject(winner);
    const installed = await installPolicy(winner, 1, 'r5a-post-miss-install');
    const request = { meta: { requestId: 'r5a-post-miss-activate', expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 0 }] },
      input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } } };
    let winnerResult: Awaited<ReturnType<ProjectBootstrapServices['completionPolicies']['activateCompletionPolicy']>> | undefined;
    let intercepted = false;
    const records: GoalRecordTransactionPort = {
      readMany: keys => backend.records.readMany(keys),
      commit: input => backend.records.commit(input),
      eventAt: cursor => backend.records.eventAt(cursor),
      async lookupCommit(input) {
        const result = await backend.records.lookupCommit(input);
        if (!intercepted && result.status === 'rejected' && result.code === 'not_found') {
          intercepted = true;
          winnerResult = await winner.completionPolicies.activateCompletionPolicy(ctx, request);
          expect(winnerResult).toMatchObject({ status: 'committed', replayed: false });
        }
        return result;
      },
    };
    const loser = await bootstrap(records).completionPolicies.activateCompletionPolicy(ctx, request);
    expect(intercepted).toBe(true);
    expect(winnerResult).toBeDefined();
    const original = committed(winnerResult!);
    expect(loser).toMatchObject({ status: 'committed', replayed: true, value: original.value, cursor: original.cursor });
    const active = await backend.records.readMany([canonicalJson(activeRef as unknown as JsonValue)]);
    expect(active).toMatchObject({ status: 'ready', value: { records: [{ revision: 1 }] } });
  });
});
