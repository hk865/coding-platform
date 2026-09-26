/**
 * R5b.1 stage-1 boundary tests for the pending QueryJob/QueryRun writer and
 * reader. They run against a REAL in-memory RecordStore, the real Project/Goal
 * producers and the real query service factory (no fixture seeds), and assert
 * the FINAL semantics frozen in docs/refactor/tasks/R5b-query-planning-skeleton.md
 * §4-5 and §7.2/3/4/5.
 *
 * Stage-1 skeleton: `submitQueryJob`/`readQueryJob` are explicitly `unsupported`,
 * so these assertions are EXPECTED to be red until the stage-2 implementation
 * lands. They must not be relaxed to pass early. Every negative assertion uses a
 * code other than `unsupported`, so a stage-1 run can never satisfy it by
 * accident. Tests whose setup needs an earlier writer to commit stop at that
 * first red; the later assertions have NOT been reached by the skeleton run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import { createInMemoryRecordBackend, type InMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import type { QueryJobPort } from '../../src/core/work-graph/queries/contracts.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';

const projectId = 'r5b-query-project';
const workspaceId = 'r5b-query-workspace';
const at = '2026-09-26T00:00:00.000Z';
const human = { kind: 'human' as const, id: 'r5b-operator' };
const system = { kind: 'system' as const, id: 'r5b-scheduler' };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5b-goal' };
const queryJobRef = (queryJobId = 'r5b-query-job'): QueryJobRef =>
  ({ aggregateType: 'QueryJob', projectId, workspaceId, queryJobId });
const queryRunRef = (queryJobId = 'r5b-query-job', runId = 'r5b-query-run'): QueryRunRef =>
  ({ aggregateType: 'QueryRun', projectId, workspaceId, queryJobId, runId });

const roleBinding = { schemaVersion: 1 as const, bindingId: 'r5b-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };
const role = { schemaVersion: 1 as const, bindingId: 'r5b-run-binding', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };

function ctxFor(actor: typeof human | typeof system, project = projectId, workspace = workspaceId): CoreCallContext {
  return { projectId: project, workspaceId: workspace, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: project, workspaceId: workspace, actor }, signal: new AbortController().signal };
}
const ctx = ctxFor(human);
const workRunCtx: CoreCallContext = { projectId, workspaceId,
  principal: { kind: 'work_run', runRef: { aggregateType: 'Run', projectId, goalId: goalRef.goalId, runId: 'r5b-run' }, roleBinding: role },
  materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal: new AbortController().signal };
const queryRunCtx: CoreCallContext = { projectId, workspaceId,
  principal: { kind: 'query_run', queryRunRef: queryRunRef(), initiator: human },
  materialReader: { kind: 'host', projectId, workspaceId, actor: human }, signal: new AbortController().signal };

function initialCoordinationIntent(overrides: Partial<QueryJobIntentV1> = {}, queryJobId = 'r5b-query-job'): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: queryJobId, projectId, workspaceId, goalId: goalRef.goalId,
    question: 'Explain the current goal and outline the next investigation',
    focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
    correlationId: 'r5b-correlation-1',
    execution: { kind: 'initial_coordination', roleBinding, runtimeBudget },
    ...overrides,
  };
}
function submitRequest(requestId: string, overrides: Partial<QueryJobIntentV1> = {},
  ids: { queryJobId?: string; runId?: string } = {}) {
  const queryJobId = ids.queryJobId ?? 'r5b-query-job';
  const runId = ids.runId ?? 'r5b-query-run';
  return {
    meta: { requestId, expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }, { ref: goalRef, revision: 1 },
      { ref: queryJobRef(queryJobId), revision: 0 }, { ref: queryRunRef(queryJobId, runId), revision: 0 },
    ] },
    input: { queryJobId, runId, intent: initialCoordinationIntent(overrides, queryJobId) },
  };
}

const schemas: RecordBackendSchemas = (() => {
  const material = materialRecordSchemas();
  return {
    records: [...material.records, ...QUERY_JOB_RECORD_SCHEMAS.records],
    events: [...material.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...QUERY_JOB_RECORD_SCHEMAS.events],
    lookups: [...(material.lookups ?? []), ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? [])],
  };
})();

const backends: InMemoryRecordBackend[] = [];
afterEach(async () => { for (const backend of backends.splice(0)) await backend.close(); });

function eventIds(prefix: string): () => string {
  let counter = 0;
  return () => `r5b-${prefix}-event-${++counter}`;
}
function newBackend(): InMemoryRecordBackend {
  const backend = createInMemoryRecordBackend({ schemas });
  backends.push(backend);
  return backend;
}
function newQueries(records: GoalRecordTransactionPort): QueryJobPort {
  return createQueryJobService({ records, now: () => at, eventId: eventIds('q') });
}
async function seedGoal(records: GoalRecordTransactionPort): Promise<void> {
  const bootstrap = createProjectBootstrapServices({ records, now: () => at, eventId: eventIds('b') });
  const project = await bootstrap.projects.createProject(ctx, { meta: { requestId: 'r5b-project-1', expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId } });
  if (project.status !== 'committed') throw new Error('Project seed failed: ' + JSON.stringify(project));
  const workspace = await bootstrap.projects.registerWorkspace(ctx, { meta: { requestId: 'r5b-workspace-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: { projectId, workspaceId } } });
  if (workspace.status !== 'committed') throw new Error('Workspace seed failed: ' + JSON.stringify(workspace));
  const goals = createGoalService({ records, now: () => at, eventId: eventIds('g') });
  const goal = await goals.tasks.createGoal(ctx, { meta: { requestId: 'r5b-goal-1', expected: [
    { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: goalRef.goalId, workspace: { projectId, workspaceId }, objective: 'R5b query goal' } });
  if (goal.status !== 'committed') throw new Error('Goal seed failed: ' + JSON.stringify(goal));
}
async function world(): Promise<{ backend: InMemoryRecordBackend; queries: QueryJobPort }> {
  const backend = newBackend();
  await seedGoal(backend.records);
  return { backend, queries: newQueries(backend.records) };
}
type Committed<T> = Extract<T, { status: 'committed' }>;
function committed<T extends { status: string }>(result: T): Committed<T> {
  if (result.status !== 'committed') throw new Error('expected a committed write, got ' + JSON.stringify(result));
  return result as Committed<T>;
}
async function eventBody(backend: InMemoryRecordBackend, cursor: CommitCursor, eventType: string): Promise<Record<string, unknown>> {
  const event = await backend.records.eventAt(cursor);
  expect(event).toMatchObject({ status: 'ready', value: { cursor, event: { eventType } } });
  if (event.status !== 'ready') throw new Error('no event at the receipt cursor');
  return JSON.parse(event.value.event.json) as Record<string, unknown>;
}

describe('R5b.1 pending QueryJob submission', () => {
  it('records QueryJob@1 + QueryRun@1 pending, locates the original actor, and replays the same receipt', async () => {
    const { backend, queries } = await world();
    const request = submitRequest('r5b-submit-1');

    const submitted = await queries.submitQueryJob(ctx, request);
    expect(submitted).toMatchObject({ status: 'committed', replayed: false });
    if (submitted.status !== 'committed') throw new Error('public submit did not commit');
    const pair = submitted.value;

    expect(pair.job).toMatchObject({ ref: queryJobRef(), revision: 1, schemaVersion: 1,
      job: { schemaVersion: 1, queryJobId: 'r5b-query-job', projectId, workspaceId,
        goalId: goalRef.goalId, status: 'pending', runRef: queryRunRef(), answerRefs: [], closeReason: null,
        intent: { intentId: request.input.queryJobId, question: request.input.intent.question, focusTaskRefs: [] } } });
    // The submission locator is written by the writer, never supplied by the caller.
    const locator = pair.job.submission;
    expect(locator).toMatchObject({ schemaVersion: 1 });
    expect(locator?.identityKey).toEqual(expect.any(String));
    expect(locator?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(locator?.eventId).toEqual(expect.any(String));
    expect(Object.prototype.hasOwnProperty.call(request.input, 'submission')).toBe(false);

    expect(pair.run).toMatchObject({ ref: queryRunRef(), revision: 1, schemaVersion: 1,
      run: { schemaVersion: 1, queryJobRef: queryJobRef(), runId: 'r5b-query-run', status: 'pending',
        startedAt: null, endedAt: null, outcome: null } });
    expect(pair.run.run.execution).toBeUndefined();

    // The REAL event carries the original human actor and the pending submitted job.
    const body = await eventBody(backend, submitted.cursor, 'QueryJobSubmitted');
    expect(body).toMatchObject({ projectId, actor: { kind: 'human', id: human.id },
      identityKey: locator?.identityKey, fingerprint: locator?.fingerprint,
      payload: { job: { status: 'pending', queryJobId: 'r5b-query-job', runRef: queryRunRef() } } });
    expect(body['eventId']).toBe(locator?.eventId);

    expect(await queries.readQueryJob(ctx, queryJobRef())).toMatchObject({ status: 'ready', value: pair });

    const replay = await queries.submitQueryJob(ctx, request);
    expect(replay).toMatchObject({ status: 'committed', replayed: true, cursor: submitted.cursor, value: pair });
    // Replay must not create a second Run or a second Job.
    const jobRow = await backend.records.readMany([canonicalJson(queryJobRef() as unknown as JsonValue)]);
    expect(jobRow).toMatchObject({ status: 'ready', value: { records: [expect.objectContaining({ revision: 1 })] } });
  });

  it('keeps each original actor for two distinct submit identities and conflicts on a changed input', async () => {
    const { backend, queries } = await world();
    const firstRequest = submitRequest('r5b-actor-1', {}, { queryJobId: 'r5b-job-a', runId: 'r5b-run-a' });
    const first = committed(await queries.submitQueryJob(ctxFor(human), firstRequest));
    const second = committed(await queries.submitQueryJob(ctxFor(system), submitRequest('r5b-actor-2', {}, { queryJobId: 'r5b-job-b', runId: 'r5b-run-b' })));
    expect(await eventBody(backend, first.cursor, 'QueryJobSubmitted')).toMatchObject({ actor: { kind: 'human', id: human.id } });
    expect(await eventBody(backend, second.cursor, 'QueryJobSubmitted')).toMatchObject({ actor: { kind: 'system', id: system.id } });

    // A changed question/budget/focus under the SAME identity is a conflict.
    expect(await queries.submitQueryJob(ctx, { ...firstRequest, input: { ...firstRequest.input,
      intent: { ...firstRequest.input.intent, question: 'A different question' } } }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await queries.submitQueryJob(ctx, { ...firstRequest, input: { ...firstRequest.input,
      intent: { ...firstRequest.input.intent, budget: { maxTokens: 8192, deadline: null } } } }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it('rejects untrusted principals, cross-scope ids, unsupported intent kinds and malformed intents without writing', async () => {
    const { backend, queries } = await world();
    const submit = (context: CoreCallContext, request: ReturnType<typeof submitRequest>) =>
      queries.submitQueryJob(context, request);

    expect(await submit(workRunCtx, submitRequest('r5b-bound-work-run')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await submit(queryRunCtx, submitRequest('r5b-bound-query-run')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    // The intent project/workspace/goal must agree with the bound context.
    expect(await submit(ctx, submitRequest('r5b-bound-foreign-scope', { projectId: 'other-project' })))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await submit(ctx, { ...submitRequest('r5b-bound-foreign-expected'), meta: { requestId: 'r5b-bound-foreign-expected',
      expected: [{ ref: { aggregateType: 'Project', projectId: 'other-project' }, revision: 0 }] } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    // Execution coordination and implementation authorization are not delivered here.
    expect(await submit(ctx, submitRequest('r5b-bound-execution-coordination', { execution: {
      kind: 'execution_coordination', feedback: {}, roleBinding, runtimeBudget } as NonNullable<QueryJobIntentV1['execution']> })))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
    expect(await submit(ctx, submitRequest('r5b-bound-authorization', { execution: {
      kind: 'initial_coordination', roleBinding, runtimeBudget,
      implementationAuthorization: { requestId: 'r5b-auth', writeScope: ['*'], instruction: 'do it' } } })))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
    // Structural limits: non-empty question, UTF-8 <= 16 KiB, focus <= 64, positive budget.
    expect(await submit(ctx, submitRequest('r5b-bad-question', { question: '' })))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await submit(ctx, submitRequest('r5b-bad-budget', { budget: { maxTokens: 0, deadline: null } })))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await submit(ctx, { ...submitRequest('r5b-bad-focus'), input: { queryJobId: 'r5b-query-job', runId: 'r5b-query-run',
      intent: initialCoordinationIntent({ focusTaskRefs: Array.from({ length: 65 }, (_, i) => ({ aggregateType: 'Task', projectId, goalId: goalRef.goalId, taskId: 't' + String(i) })) }) } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });

    // None of the rejected requests left a Job or Run behind.
    for (const key of [canonicalJson(queryJobRef() as unknown as JsonValue), canonicalJson(queryRunRef() as unknown as JsonValue)]) {
      expect(await backend.records.readMany([key])).toMatchObject({ status: 'ready', value: { missing: [key] } });
    }
  });

  it('requires a Goal-owned focus and accepts the no-Plan/empty-focus case; readQueryJob reports not_found exactly', async () => {
    const { queries } = await world();
    // No accepted Plan: a non-empty focus cannot be proven a member of the Goal.
    expect(await queries.submitQueryJob(ctx, submitRequest('r5b-focus-unknown', { focusTaskRefs: [
      { aggregateType: 'Task', projectId, goalId: goalRef.goalId, taskId: 'not-in-any-plan' }] })))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    // A task ref for another project/Goal is a scope violation.
    expect(await queries.submitQueryJob(ctx, submitRequest('r5b-focus-foreign', { focusTaskRefs: [
      { aggregateType: 'Task', projectId, goalId: 'another-goal', taskId: 't' }] })))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    // No Plan + empty focus is the legal first positive case.
    expect(await queries.submitQueryJob(ctx, submitRequest('r5b-focus-empty')))
      .toMatchObject({ status: 'committed', replayed: false });

    expect(await queries.readQueryJob(ctx, queryJobRef('r5b-absent-job'))).toMatchObject({ status: 'not_found' });
  });
});

describe('R5b.1 atomic acceptance and recovery', () => {
  it('lets only one of two fresh requests on the same Job/Run commit, and restores one receipt for concurrent same-identity calls', async () => {
    const { backend, queries } = await world();
    const first = submitRequest('r5b-race-left');
    const second = submitRequest('r5b-race-right', { question: 'The other question' });
    const outcomes = await Promise.all([queries.submitQueryJob(ctx, first), queries.submitQueryJob(ctx, second)]);
    expect(outcomes.filter(result => result.status === 'committed')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected' && result.code === 'revision_conflict')).toHaveLength(1);
    // The loser leaves no orphan Run.
    const runs = await backend.records.readMany([canonicalJson(queryRunRef() as unknown as JsonValue)]);
    expect(runs).toMatchObject({ status: 'ready', value: { records: [expect.objectContaining({ revision: 1 })] } });

    // Same identity, delivered twice: both calls report the ORIGINAL receipt.
    const sameIdentity = { ...submitRequest('r5b-race-same', {}, { queryJobId: 'r5b-job-same', runId: 'r5b-run-same' }) };
    const [left, right] = await Promise.all([
      queries.submitQueryJob(ctx, sameIdentity), queries.submitQueryJob(ctx, sameIdentity),
    ]);
    const committedLeft = committed(left);
    const committedRight = committed(right);
    expect(committedLeft.cursor).toBe(committedRight.cursor);
    expect(committedLeft.value).toEqual(committedRight.value);
    expect([committedLeft.replayed, committedRight.replayed].filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });

  it('does not tie a fresh submit to an unrelated Goal change after its last read (no whole-ledger horizon)', async () => {
    const backend = newBackend();
    await seedGoal(backend.records);
    const otherGoalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'r5b-other-goal' };
    const goals = createGoalService({ records: backend.records, now: () => at, eventId: eventIds('g2') });
    let injected = false;
    const wrapped: GoalRecordTransactionPort = {
      readMany: async keys => {
        const result = await backend.records.readMany(keys);
        if (!injected) {
          injected = true;
          // A legal, unrelated Goal write lands between the submit's last read
          // and its commit; it must not require or invalidate a whole-ledger horizon.
          const other = await goals.tasks.createGoal(ctx, { meta: { requestId: 'r5b-other-goal-1', expected: [
            { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
            input: { goalId: otherGoalRef.goalId, workspace: { projectId, workspaceId }, objective: 'An unrelated goal' } });
          if (other.status !== 'committed') throw new Error('unrelated Goal creation failed: ' + JSON.stringify(other));
        }
        return result;
      },
      lookupCommit: input => backend.records.lookupCommit(input),
      commit: input => backend.records.commit(input),
      eventAt: cursor => backend.records.eventAt(cursor),
    };
    expect(await newQueries(wrapped).submitQueryJob(ctx, submitRequest('r5b-unrelated-goal')))
      .toMatchObject({ status: 'committed' });
    expect(await backend.records.readMany([canonicalJson(otherGoalRef as unknown as JsonValue)]))
      .toMatchObject({ status: 'ready', value: { records: [expect.objectContaining({ revision: 1 })] } });
  });

  it('cancels before commit with zero writes and preserves a real committed result after a late cancel', async () => {
    const before = newBackend();
    await seedGoal(before.records);
    const controller = new AbortController();
    const gated: GoalRecordTransactionPort = {
      readMany: keys => before.records.readMany(keys),
      commit: input => before.records.commit(input),
      eventAt: cursor => before.records.eventAt(cursor),
      async lookupCommit(input) {
        const result = await before.records.lookupCommit(input);
        controller.abort();
        return result;
      },
    };
    expect(await newQueries(gated).submitQueryJob({ ...ctx, signal: controller.signal }, submitRequest('r5b-cancel-before')))
      .toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(await before.records.readMany([canonicalJson(queryJobRef() as unknown as JsonValue)]))
      .toMatchObject({ status: 'ready', value: { missing: [canonicalJson(queryJobRef() as unknown as JsonValue)] } });

    const lateBackend = newBackend();
    await seedGoal(lateBackend.records);
    const late = new AbortController();
    const afterCommit: GoalRecordTransactionPort = {
      readMany: keys => lateBackend.records.readMany(keys),
      lookupCommit: input => lateBackend.records.lookupCommit(input),
      eventAt: cursor => lateBackend.records.eventAt(cursor),
      async commit(input) {
        const result = await lateBackend.records.commit(input);
        if (result.status === 'committed') late.abort();
        return result;
      },
    };
    const committedWrite = await newQueries(afterCommit).submitQueryJob({ ...ctx, signal: late.signal }, submitRequest('r5b-cancel-after'));
    expect(committedWrite).toMatchObject({ status: 'committed' });
    late.abort();
    expect(committedWrite).toMatchObject({ status: 'committed' });
  });

  it('restores the original receipt when a committed response is lost, and never fabricates committed', async () => {
    const backend = newBackend();
    await seedGoal(backend.records);
    let loseNext = false;
    const flaky: GoalRecordTransactionPort = {
      readMany: keys => backend.records.readMany(keys),
      lookupCommit: input => backend.records.lookupCommit(input),
      eventAt: cursor => backend.records.eventAt(cursor),
      async commit(input) {
        const result = await backend.records.commit(input);
        if (loseNext && result.status === 'committed') { loseNext = false; throw new Error('lost commit response'); }
        return result;
      },
    };
    const queries = newQueries(flaky);
    loseNext = true;
    const recovered = await queries.submitQueryJob(ctx, submitRequest('r5b-lost-response'));
    expect(recovered).toMatchObject({ status: 'committed', replayed: true });
    if (recovered.status !== 'committed') throw new Error('lost response was not recovered');
    expect(await eventBody(backend, recovered.cursor, 'QueryJobSubmitted')).toMatchObject({ actor: { kind: 'human', id: human.id } });

    // A second delivery of the same identity now replays the ORIGINAL receipt.
    expect(await queries.submitQueryJob(ctx, submitRequest('r5b-lost-response')))
      .toMatchObject({ status: 'committed', replayed: true, cursor: recovered.cursor, value: recovered.value });
  });
});
