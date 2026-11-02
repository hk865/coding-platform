/**
 * MR: a model service that cannot be reached is retried four times before the Run
 * is interrupted (lead ruling 2026-11-02, MR-1/2/5/7).
 *
 * The real Host world and its public routes are used; the provider is scripted
 * (rule sheet A8), never a real model or the network. The Kernel retry count is
 * the production composition's (four retries after the first attempt).
 */
import { afterEach, expect, it } from 'vitest';
import { sessionRecordSchema } from '../../vendor/coding-agent/dist/public-api.js';
import type { TaskExecutionPage, TaskRow } from '../../src/app/core-http-types.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import type { RunActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { initializeProject, submitRound, waitForRound } from '../helpers/S6A-history-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { readReady } from '../helpers/S6B3-fixture.js';
import { taskRowOf } from '../scenarios/harness.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
}, 60_000);

/** Four real retry waits run 30 s, so the shared 15 s poll is too short here. */
async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 800 && !done(value); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    value = await read();
  }
  if (!done(value)) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
  return value;
}

const TASK = 'mr-model-retry-task';

type Work = { world: S6AHostWorld; goal: GoalRef; main: ReturnType<typeof s6aCardsWorkspace> };

async function startWork(label: string, workBudget?: Partial<RuntimeBudget>): Promise<Work> {
  const world = await openS6AHostWorld({ backend: 'memory', ...(workBudget === undefined ? {} : { workBudget }) });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = (await main.createGoal(`mr-${label}`, `MR ${label}`)).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label, taskIds: [TASK], role: S6A_WORK_ROLE.templateId });
  await createS6BLine(main, { label: `${label}-line`, role: S6A_WORK_ROLE, tasks });
  await world.setResumeOnStartup(false);
  return { world, goal, main };
}

async function startMrWork(work: Work, label: string): Promise<void> {
  const started = await work.world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: {
    schemaVersion: 1, goalRef: work.goal, flowId: `mr-${label}`, sessionHint: null, kind: 'select_work', taskId: TASK,
  }, queryProfileIds: [] }));
  expect(started.body).toMatchObject({ status: 'ready' });
}

async function runs(work: Work): Promise<TaskExecutionPage['items']> {
  const body = (await work.world.post('executions/list', plain(S6A_SCOPE,
    { goalRef: work.goal, taskId: TASK, page: { afterCursor: null, limit: 10 } }))).body;
  return readReady<TaskExecutionPage>(body as ReadResult<TaskExecutionPage>, 'executions/list').items;
}

async function taskRow(work: Work): Promise<TaskRow> {
  const body = (await work.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: work.goal }))).body;
  return taskRowOf(body as ReadResult<{ tasks: TaskRow[] }>, TASK);
}

async function goalDisplay(work: Work): Promise<{ phase: string; causes: Array<{ code: string; taskId?: string }> }> {
  const body = (await work.world.post('goals/display', plain(S6A_SCOPE, { goalRef: work.goal }))).body;
  return readReady<{ display: { phase: string; causes: Array<{ code: string; taskId?: string }> } }>(
    body as ReadResult<{ display: { phase: string; causes: Array<{ code: string; taskId?: string }> } }>, 'goals/display').display;
}

/** The Run's own `model.request_started` records, read through the public execution history. */
async function requestStarts(work: Work, runRef: RunRef): Promise<number> {
  const body = (await work.world.post('executions/history', plain(S6A_SCOPE,
    { runRef, afterCursor: null, limit: 200 }))).body;
  const page = readReady<{ items: SessionHistoryEntry[] }>(
    body as ReadResult<{ items: SessionHistoryEntry[] }>, 'executions/history');
  let starts = 0;
  for (const item of page.items) {
    const entry = item.body;
    if (!('encoding' in entry) || entry.encoding !== 'kernel_session_record_json') continue;
    const record = sessionRecordSchema.parse(JSON.parse(entry.text));
    if (record.recordType === 'agent.event' && record.payload.event.type === 'model.request_started') starts += 1;
  }
  return starts;
}

it('MR-1: four connection failures then a success complete the Run without an interruption', async () => {
  const work = await startWork('mr-1');
  work.world.scriptReplies([
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'text', text: 'MR-1: the fifth model request succeeds' },
  ]);
  await startMrWork(work, 'mr-1');
  const listed = await waitFor(async () => await runs(work),
    items => items.some(item => item.run.status === 'ended'), 'the Run to end');
  expect(work.world.model.calls(), 'the model receives exactly five requests').toBe(5);
  expect(listed).toHaveLength(1);
  const run = listed[0]!.run;
  expect(run.outcome).toBe('completed');
  const row = await taskRow(work);
  expect(row.failure?.failureClass ?? null, 'the Task is not stopped').toBeNull();
  expect(row.failure?.interruption ?? null, 'no Goal interruption is recorded').toBeNull();
  expect(row.failure?.automation.verdict.kind, 'no automatic rework is counted').toBe('none');
  expect((await goalDisplay(work)).causes.map(cause => cause.code)).not.toContain('interrupted_pending_resume');
}, 240_000);

it('MR-2: five connection failures interrupt the Run, stop the Task and wait for a person', async () => {
  const work = await startWork('mr-2');
  work.world.scriptReplies([
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
  ]);
  await startMrWork(work, 'mr-2');
  const row = await waitFor(async () => await taskRow(work), row => row.failure !== undefined, 'the Task interruption');
  expect(work.world.model.calls(), 'the model receives exactly five requests').toBe(5);
  expect(row.failure?.failureClass).toBe('interrupted');
  expect(row.failure?.automation.verdict).toMatchObject({
    kind: 'stopped', reason: 'interrupted_pending_resume', detail: { source: 'model_service', code: 'provider_request_failed' },
  });
  expect(row.failure?.automation.requeueAutoCount, 'an interrupted Run is not counted').toBe(0);
  const shown = await goalDisplay(work);
  expect(shown.phase).toBe('NEEDS_DECISION');
  expect(shown.causes).toContainEqual(expect.objectContaining({ code: 'interrupted_pending_resume', taskId: TASK }));
}, 240_000);

it('MR-5: two connection failures in a secretary Query still save one answer and add no second Query', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  await initializeProject(world);
  const answer = JSON.stringify({ schemaVersion: 1, body: 'MR-5: the third request answers', ideas: [], goalCardDrafts: [] });
  world.scriptReplies([
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'text', text: answer },
  ]);
  const round = await submitRound(world, {
    commandId: 'mr-5-secretary-round', goalId: null, text: 'MR-5 a secretary Query survives two connection failures',
  });
  const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
  const ended = view.rounds.find(entry => entry.ref.queryJobId === round.round.queryJobId);
  if (ended === undefined) throw new Error('the request read must list the ended round');
  expect(ended.closeCode, 'a normal answer closes with no reason code').toBeNull();
  expect(ended.answer).toContain('MR-5: the third request answers');
  expect(view.rounds, 'the retry does not create a second Query').toHaveLength(1);
  expect(world.model.calls()).toBe(3);
}, 240_000);

it('MR-7: only the completed request reports usage; failed attempts add no fake tokens or request', async () => {
  const work = await startWork('mr-7');
  work.world.scriptReplies([
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'error', code: 'provider_request_failed', retryable: true },
    { kind: 'text', text: 'MR-7: the fifth model request succeeds', usage: { inputTokens: 1_000, outputTokens: 100, cachedInputTokens: 0, costUsdMicros: null } },
  ]);
  await startMrWork(work, 'mr-7');
  const listed = await waitFor(async () => await runs(work),
    items => items.some(item => item.run.status === 'ended'), 'the Run to end');
  const runRef: RunRef = listed[0]!.run.ref;
  const body = (await work.world.post('activity/runs', plain(S6A_SCOPE, { runRefs: [runRef] }))).body;
  const view = readReady<RunActivityViewV1[]>(body as ReadResult<RunActivityViewV1[]>, 'activity/runs')
    .find(candidate => candidate.runRef.runId === runRef.runId);
  if (view === undefined) throw new Error('activity/runs must list the ended Run');
  expect(view.status).toBe('counted');
  expect(view.usage, 'failed attempts mark no request unknown').toMatchObject({
    inputTokens: 1_000, outputTokens: 100, complete: true,
  });
}, 240_000);

it('MR-7b: a failed attempt that reported usage before failing stays counted', async () => {
  const usage = { inputTokens: 1_000, outputTokens: 100, cachedInputTokens: 0, costUsdMicros: null };
  const work = await startWork('mr-7b');
  work.world.scriptReplies([
    { kind: 'error', code: 'provider_request_failed', retryable: true, usage },
    { kind: 'text', text: 'MR-7b: the retry succeeds with the same usage', usage },
  ]);
  await startMrWork(work, 'mr-7b');
  const listed = await waitFor(async () => await runs(work),
    items => items.some(item => item.run.status === 'ended'), 'the Run to end');
  const runRef: RunRef = listed[0]!.run.ref;
  const body = (await work.world.post('activity/runs', plain(S6A_SCOPE, { runRefs: [runRef] }))).body;
  const view = readReady<RunActivityViewV1[]>(body as ReadResult<RunActivityViewV1[]>, 'activity/runs')
    .find(candidate => candidate.runRef.runId === runRef.runId);
  if (view === undefined) throw new Error('activity/runs must list the ended Run');
  expect(view.status).toBe('counted');
  // Hand-computed from the two requests: each reports 1,000 input / 100 output.
  expect(view.usage, 'the failed attempt kept its recorded usage').toMatchObject({
    inputTokens: 2_000, outputTokens: 200, complete: true,
  });
}, 240_000);

const MR8 = [
  { label: 'token budget', workBudget: undefined },
  { label: 'request cap 3', workBudget: { maxRequests: 3 } },
] as const;

it.each(MR8)('MR-8 ($label): a retry blocked by the cumulative budget ends interrupted with the model-service code', async ({ label, workBudget }) => {
  const work = await startWork(`mr-8-${label}`, workBudget);
  expect(await work.world.settings('run-budget/save', { workRunTokenBudget: 40_000 })).toMatchObject({ status: 'ready' });
  work.world.scriptReplies([
    { kind: 'error', code: 'provider_request_failed', retryable: true },
  ]);
  await startMrWork(work, `mr-8-${label}`);
  const row = await waitFor(async () => await taskRow(work), row => row.failure !== undefined,
    'the Task interruption');
  const listed = await waitFor(async () => await runs(work),
    items => items.some(item => item.run.status === 'ended'), 'the Run to end');
  const runRef: RunRef = listed[0]!.run.ref;
  expect(work.world.model.calls(), 'the budget refuses every retry before the provider').toBe(1);
  expect(await requestStarts(work, runRef), 'the Run records the first request and the blocked retry only').toBe(2);
  expect(row.failure?.failureClass).toBe('interrupted');
  expect(row.failure?.automation.verdict).toMatchObject({
    kind: 'stopped', reason: 'interrupted_pending_resume',
    detail: { source: 'model_service', code: 'provider_request_failed' },
  });
  expect(row.failure?.automation.requeueAutoCount, 'an interrupted Run is not counted').toBe(0);
  const shown = await goalDisplay(work);
  expect(shown.phase).toBe('NEEDS_DECISION');
  expect(shown.causes).toContainEqual(expect.objectContaining({
    code: 'interrupted_pending_resume', taskId: TASK,
  }));
}, 240_000);

