/**
 * P1“Run 步骤读”的场景行（冻结稿第四节 S1–S8）：只测接线，经 Host 的公开路由 `executions/steps`，加 `main/read`、
 * `queries/read` 取 ref。思考、截断、状态表和分页由纯表 `tests/runtime/P1S-steps-pure.test.ts` 守，这里不重测（RULES S1）；
 * 夹具一行不改（Q4），脚本模型不出思考，所以场景里没有 think 步。
 *
 * 世界：S1 是 PL readings 世界（真实 Host，Work 线有 write/shell 授权，PL-12 同一个世界）；S2–S7 是 S6A Host 世界，秘书
 * 授权 `run_readonly_command`，请求驱动关着，由公开的 `queries/claim`、`prepare`、`start` 跑一轮（R-09 的做法）；S8 是 XWS2A
 * 世界。业务行只跑 memory；S5 要重开、S7 要崩溃重启，照先例只跑 SQLite（RULES S3）。
 *
 * 今天红在哪一步：
 * - S1、S3、S6、S8 红在第一次 `executions/steps`：路由没发布，Host 答 `rejected`/`not_found`（unpublished core route）。
 * - S2、S4、S5、S7 红在从 `main/read` 取这一轮的 `runRef`：轮次今天没有这个字段（`roundRunRef` 抛错）。
 * B14 的 `unknown`/`unavailable` 映射不写场景（要坏 Kernel 记录只能用 RULES A7-3，Q9）；只读路由没有可改的状态，拒绝行不另读回。
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RunStepsReadV1 } from '../../src/contracts/run-steps.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openPLReadingsWorld } from '../helpers/PL-readings-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ABackend, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { openXWS2AWorld } from '../helpers/XWS2A-world.js';

// S6A Host 世界的闸门要的两个 vi.mock（tests/README.md 的 S6A-host-fixture 一行）。
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(closers.splice(0).map(close => close()));
  expect(left).toEqual([]);
});

type Scope = { projectId: string; workspaceId: string };
type Steps = Extract<RunStepsReadV1, { kind: 'steps' }>;

async function postSteps(world: S6AHostWorld, input: unknown, scope: Scope = S6A_SCOPE): Promise<ReadResult<RunStepsReadV1>> {
  return (await world.post('executions/steps', plain(scope, input))).body as ReadResult<RunStepsReadV1>;
}
const firstPage = (ref: RunRef | QueryRunRef) => ({ ref, after: null, limit: 50 });
function stepsOf(answer: ReadResult<RunStepsReadV1>): Steps {
  if (answer.status !== 'ready' || answer.value.kind !== 'steps') throw new Error(`P1S：应读成 steps，实际 ${JSON.stringify(answer)}`);
  return answer.value;
}

/** `main/read` 里这个请求第一轮的 `runRef`（冻结稿 G 加的字段）。 */
async function roundRunRef(world: S6AHostWorld, requestRoot: QueryJobRef): Promise<QueryRunRef> {
  const page = (await world.post('main/read', plain(S6A_SCOPE, { goalId: S6A_GOAL_1.goalId, cursor: null })))
    .body as ReadResult<{ requests: RequestCoreViewV1[] }>;
  if (page.status !== 'ready') throw new Error(`P1S：main/read 没读出来：${JSON.stringify(page)}`);
  const round = page.value.requests.find(entry => entry.requestRoot.queryJobId === requestRoot.queryJobId)?.rounds[0];
  const runRef = (round as { runRef?: QueryRunRef | null } | undefined)?.runRef;
  if (runRef === undefined || runRef === null) throw new Error(`P1S：main/read 的轮次没有 runRef：${JSON.stringify(round)}`);
  return runRef;
}

const answerText = (text: string): string => JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

/** 一个授权了只读命令的秘书，脚本是先调 `run_readonly_command echo q`、再作答；提交一个请求，轮停在排队。 */
async function openRound(backend: S6ABackend, label: string):
  Promise<{ world: S6AHostWorld; a: S6ASession; requestRoot: QueryJobRef; round: QueryJobRef }> {
  const world = await openS6AHostWorld({ backend, secretaryTools: ['read', 'run_readonly_command'] });
  closers.push(() => world.close());
  await ensureProjectPointers(world);
  const a = await world.createSecretary('a');
  await world.scripted.script(a, [
    { kind: 'calls', calls: [{ callId: `${label}-command`, name: 'run_readonly_command', args: { command: 'echo q' } }] },
    { kind: 'text', text: answerText(`${label} 的回答`) },
  ]);
  const submitted: RequestSubmitResultV1 = await world.submit({ commandId: `${label}-submit`, goalId: S6A_GOAL_1.goalId,
    text: `${label} 的请求` });
  if (submitted.status !== 'queued') throw new Error(`P1S：请求没排上：${JSON.stringify(submitted)}`);
  return { world, a, requestRoot: submitted.requestRoot, round: submitted.round };
}

/** 认领、准备、开始；`started` 不等：闸门按住的步骤让 `queries/start` 一直挂着。 */
async function startRound(world: S6AHostWorld, a: S6ASession, round: QueryJobRef, label: string):
  Promise<{ started: Promise<unknown> }> {
  expect(await claimWithSecretaryProfile(world, round, a, `${label}-claim`)).toMatchObject({ status: 'committed' });
  const prepared = await prepareAttempt(world, round, `${label}-prepare`);
  return { started: start(world, prepared, `${label}-start`).catch(() => undefined) };
}

const ended = (world: S6AHostWorld, requestRoot: QueryJobRef, status: string) =>
  world.waitForRequest(requestRoot, view => view.rounds[0]?.status === status, `这一轮读成 ${status}`);

describe('P1S executions/steps 场景', () => {
  it('S1 Work Run 结束后读步骤：依次 read、edit、command，回答正文不是一步', async () => {
    const fixture = await openPLReadingsWorld();
    closers.push(() => fixture.close());
    const task = fixture.tasks[0]!;
    const line = await fixture.line('p1s-s1', [task]);
    const run = await fixture.runTask({ line, taskId: task.taskId, flowId: 'p1s-s1', replies: [
      { kind: 'calls', calls: [{ callId: 'p1s-s1-read', name: 'read', args: { path: 'src/module.ts' } }] },
      { kind: 'calls', calls: [{ callId: 'p1s-s1-edit', name: 'edit',
        args: { mode: 'create', path: 'p1s-notes.md', newText: 'a\nb' } }] },
      { kind: 'calls', calls: [{ callId: 'p1s-s1-shell', name: 'shell', args: { command: 'echo hi' } }] },
      { kind: 'text', text: 'P1S S1 的回答正文' },
    ] });
    const read = stepsOf(await postSteps(fixture.world, firstPage(run)));
    expect(read.steps.map(step => step.kind)).toEqual(['read', 'edit', 'command']);
    expect(JSON.stringify(read.steps)).not.toContain('P1S S1 的回答正文');
  }, 120_000);

  it('S2 秘书轮结束后，main/read 轮次的 runRef 就是 queries/read 的那一个，拿它读到 run_readonly_command 步', async () => {
    const { world, a, requestRoot, round } = await openRound('memory', 'p1s-s2');
    const { started } = await startRound(world, a, round, 'p1s-s2');
    expect(await started).toMatchObject({ status: 'ready' });
    await ended(world, requestRoot, 'ended');
    const runRef = await roundRunRef(world, requestRoot);
    expect(runRef).toEqual((await readQuery(world.ag2b, round)).job.job.runRef);
    expect(stepsOf(await postSteps(world, firstPage(runRef))).steps)
      .toMatchObject([{ kind: 'command', tool: 'run_readonly_command' }]);
  }, 120_000);

  it('S3 命令按在闸门上时读成 running、live、runningFrom 是它的位置；放开、轮结束后同一位置是 done', async () => {
    const { world, a, round, requestRoot } = await openRound('memory', 'p1s-s3');
    const tool = await world.gates.toolCall(a, 'run_readonly_command');
    const { started } = await startRound(world, a, round, 'p1s-s3');
    await tool.reached;
    const ref = (await readQuery(world.ag2b, round)).run.ref;
    const live = stepsOf(await postSteps(world, firstPage(ref)));
    expect(live.steps).toMatchObject([{ kind: 'command', status: 'running', endedAt: null }]);
    const position = live.steps[0]!.position;
    expect(live.summary.live).toBe(true);
    expect(live.runningFrom).toBe(position);
    tool.release();
    expect(await started).toMatchObject({ status: 'ready' });
    await ended(world, requestRoot, 'ended');
    const after = stepsOf(await postSteps(world, firstPage(ref)));
    expect(after.steps.find(step => step.position === position)).toMatchObject({ kind: 'command', status: 'done' });
    expect(after.summary.live).toBe(false);
  }, 120_000);

  it('S4 请求刚提交、请求驱动关着：用 main/read 的 runRef 读成 not_started', async () => {
    const { world, requestRoot } = await openRound('memory', 'p1s-s4');
    expect(await postSteps(world, firstPage(await roundRunRef(world, requestRoot))))
      .toEqual({ status: 'ready', value: { kind: 'not_started' } });
  }, 120_000);

  it('S5 排队轮在重开后因没有绑定结束（QueryRun not_entered）：读成 not_entered（SQLite only，要重开）', async () => {
    const { world, requestRoot } = await openRound('sqlite', 'p1s-s5');
    await world.setResumeOnStartup(true);
    await world.reopen({ configuration: 'no_secretary', extraHostOptions: { requestDriver: 'on' } });
    expect((await ended(world, requestRoot, 'ended')).rounds[0]).toMatchObject({ closeCode: 'cancelled', closeDetail: 'no_binding' });
    expect(await postSteps(world, firstPage(await roundRunRef(world, requestRoot))))
      .toEqual({ status: 'ready', value: { kind: 'not_entered' } });
  }, 120_000);

  it('S7 秘书轮停在 run_readonly_command 上崩溃，平台不认定（QRR-05，轮 unknown）：那一步 unknown，live false（SQLite only，要崩溃）', async () => {
    const { world, a, round, requestRoot } = await openRound('sqlite', 'p1s-s7');
    const tool = await world.gates.toolCall(a, 'run_readonly_command');
    const { started } = await startRound(world, a, round, 'p1s-s7');
    await tool.reached;
    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    await ended(world, requestRoot, 'unknown');
    const read = stepsOf(await postSteps(world, firstPage(await roundRunRef(world, requestRoot))));
    expect(read.steps).toMatchObject([{ kind: 'command', tool: 'run_readonly_command', status: 'unknown' }]);
    expect(read.summary.live).toBe(false);
    expect(read.runningFrom).toBeNull();
    void started;
  }, 120_000);

  it('S8 主工作区的参谋在第二个工作区跑的 Run：用 Run 自己的工作区读成 steps，用主工作区读照旧 forbidden', async () => {
    const world = await openXWS2AWorld({ backend: 'memory' });
    closers.push(() => world.close());
    await world.waitCoarseAnswered();
    const { run } = await world.workRun({ label: 'p1s-s8', replies: [
      { kind: 'calls', calls: [{ callId: 'p1s-s8-read', name: 'read', args: { path: 'README.md' } }] },
      { kind: 'text', text: 'P1S S8 done' },
    ] });
    const host = world.base.world;
    expect(stepsOf(await postSteps(host, firstPage(run), world.second.scope)).steps)
      .toMatchObject([{ kind: 'read', path: 'README.md' }]);
    expect(await postSteps(host, firstPage(run), S6A_SCOPE)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  }, 180_000);
});

describe('rejects: executions/steps 的输入（S6，一行一个错）', () => {
  let shared: { world: S6AHostWorld; queryRunRef: QueryRunRef } | null = null;
  beforeAll(async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    await world.createSecretary('a');
    const submitted = await world.submit({ commandId: 'p1s-s6-submit', goalId: S6A_GOAL_1.goalId, text: 'P1S S6' });
    if (submitted.status !== 'queued') throw new Error(`P1S：请求没排上：${JSON.stringify(submitted)}`);
    shared = { world, queryRunRef: (await readQuery(world.ag2b, submitted.round)).run.ref };
  }, 120_000);
  afterAll(async () => { await shared?.world.close(); });

  // 没有这个 Run：同一个项目里读是 not_found；换成别的项目先被范围挡住。
  const MISSING: RunRef = { aggregateType: 'Run', projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId, runId: 'p1s-no-such-run' };
  const invalid = { status: 'rejected', code: 'invalid' };
  const forbidden = { status: 'rejected', code: 'forbidden' };
  const rows: Array<[string, (q: QueryRunRef) => unknown, Record<string, unknown>]> = [
    ['ref 的种类是 Goal', q => ({ ...firstPage(q), ref: { aggregateType: 'Goal', projectId: q.projectId,
      goalId: S6A_GOAL_1.goalId } }), invalid],
    ['limit 0', q => ({ ...firstPage(q), limit: 0 }), invalid],
    ['limit 51', q => ({ ...firstPage(q), limit: 51 }), invalid],
    ['after -1', q => ({ ...firstPage(q), after: -1 }), invalid],
    ['RunRef 在别的项目', () => firstPage({ ...MISSING, projectId: 'p1s-other-project' }), forbidden],
    ['QueryRunRef 在别的工作区', q => firstPage({ ...q, workspaceId: 'p1s-other-workspace' }), forbidden],
    ['不存在的 runId', () => firstPage(MISSING), { status: 'not_found' }],
  ];
  it.each(rows)('%s', async (_name, input, expected) => {
    const { world, queryRunRef } = shared!;
    expect(await postSteps(world, input(queryRunRef))).toMatchObject(expected);
  });
});
