/**
 * RC-03 工作身份的唯一性必须由 Control／账本权威保证（不是调用方约定、不是进程内锁）。
 *
 * ── 这个文件证明什么 ──────────────────────────────────────────────────────────
 * 票面四个场景各自都要有可复现证据，且每个证据都要落在**真实**的组件上
 * （真实 ControlEngine + 真实账本适配器 + 真实提交语义），不是替身：
 *   1. 不同 workId 指向同一任务（RW-13 之后仍然存在的命令面漏洞）；
 *   2. 并发：两个 bind 同时开始、都在"这个任务还没有身份"的结论上继续；
 *   3. 多连接／两个宿主进程：同一条 SQLite 文件、各自一条连接；
 *   4. 重开：close → reopen 之后重试同一 bind。
 * 另外证明既有语义**没有被削弱**：同一命令重放仍返回原回执（幂等），不同内容不覆盖既有身份，
 * 非 task 工作不受这条唯一性约束，解析不可读时仍然 fail-closed。
 *
 * ── 唯一性由谁保证（两层，缺一不可）──────────────────────────────────────────
 *   a. ControlEngine.bindWorkContext 的守卫（src/control/control-engine/work-record.ts）：
 *      复用 RW-13 的**唯一权威读面** resolveTaskWorkIdentity；同一 (项目, 工作区, 目标, 任务)
 *      已有身份而 workId 不同 → already_bound（零写，回执带既有身份）。
 *   b. StateLedger 的提交语义（两个适配器共用 data/state-ledger/ledger-validation.ts 的一份规则）：
 *      work-context-bind 在同一个事务里占用该任务的身份槽，被占用即拒绝。
 *      守卫是"先查后写"，只能给出可读的拒绝原因；**并发与跨进程**的唯一性只能由这里保证——
 *      场景 2 与场景 3 的"绕过守卫直接提交"用例就是专门用来把这一点单独证出来的。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createControlEngine } from '../../src/control/control-engine/control-engine.js';
import { ensureWorkIdentity, type WorkIdentityDeps } from '../../src/control/dispatch-engine/work-identity.js';
import { buildWorkContextBindLedgerCommit } from '../../src/control/control-engine/records/context.js';
import { buildDispatchClaimLedgerCommit } from '../../src/control/control-engine/records/dispatch.js';
import { InMemoryLedger } from '../../src/data/state-ledger/in-memory-ledger.js';
import { createSqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from '../../src/testing/sequences.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from '../contract-support/fixtures/bootstrap-fixture-v1.js';
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand, buildGoalCreateLedgerCommit } from '../contract-support/fixtures/goal-fixtures.js';
import { DISPATCH_PLAN_REVISION_FIXTURE_V1, DISPATCH_ELIGIBLE_TASK_ID, buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { buildBindWorkContextCommand } from '../contract-support/fixtures/context-fixtures.js';
import { workContextRefFor, type WorkContextBindingSnapshot } from '../../src/contracts/context-continuity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { LedgerCommit, StateLedger } from '../../src/contracts/ledger.js';

const FIXED = FIXED_ISO_2026_09_05;
const SCOPE = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
const PROJECT = SCOPE.projectId;
const WORKSPACE = SCOPE.workspaceId;
const GOAL = SCOPE.goalId;
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const PLAN_REF = {
  aggregateType: 'PlanRevision' as const,
  projectId: PROJECT,
  planId: DISPATCH_PLAN_REVISION_FIXTURE_V1.planId,
};
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId });

/** 世界构造（与 RW-12／RW-13 用例同一套夹具）：bootstrap + goal + 一条真实 claim（Run 聚合）。 */
async function seedWorld(ledger: StateLedger): Promise<RunRef> {
  const boot = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: 'cmd-boot', correlationId: 'corr-boot', submittedAt: FIXED });
  expect((await ledger.commit(buildBootstrapLedgerCommit(boot, { eventIds: ['e1', 'e2', 'e3', 'e4'], occurredAt: FIXED }))).status).toBe('committed');
  const goal = buildCreateGoalCommand(SCOPE, { commandId: 'cmd-goal', correlationId: 'corr-goal', submittedAt: FIXED });
  expect((await ledger.commit(buildGoalCreateLedgerCommit(goal, { eventId: 'e5', occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 }))).status).toBe('committed');
  const claim = buildDispatchClaimCommand({
    commandId: 'claim-run-1', correlationId: 'corr-run-1', submittedAt: FIXED, idempotencyKey: 'idem-run-1',
    projectId: PROJECT, goalId: GOAL, taskId: TASK, attemptId: 'attempt-run-1', runId: 'run-1',
  });
  expect((await ledger.commit(buildDispatchClaimLedgerCommit(claim, { eventId: 'e6', occurredAt: FIXED, workspaceId: WORKSPACE, planRef: PLAN_REF, workspaceRevision: 1 }))).status).toBe('committed');
  return runRef('run-1');
}

function bindCommand(workId: string, overrides: { commandId?: string; taskId?: string | null; goalId?: string | null; runRef?: RunRef; workKind?: 'task' | 'coordination' } = {}) {
  return buildBindWorkContextCommand({
    commandId: overrides.commandId ?? 'bind-' + workId,
    projectId: PROJECT,
    workId,
    workspaceId: WORKSPACE,
    workKind: overrides.workKind ?? 'task',
    goalId: overrides.goalId === undefined ? GOAL : overrides.goalId,
    taskId: overrides.taskId === undefined ? TASK : overrides.taskId,
    initialRunRef: overrides.runRef ?? runRef('run-1'),
  });
}

/** 该任务在账本里的全部 task 工作身份（由已提交的 WorkContextBound 事件数出来，不猜）。 */
async function taskIdentities(ledger: StateLedger, taskId: string = TASK): Promise<string[]> {
  const page = await ledger.events({ afterCursor: null, limit: 512 });
  return page.events
    .filter((positioned) => positioned.event.eventType === 'WorkContextBound')
    .map((positioned) => positioned.event as { projectId: string; workspaceId: string; aggregateId: string; payload: { binding: { workKind: string; goalId: string | null; taskId: string | null } } })
    .filter((event) => event.projectId === PROJECT && event.workspaceId === WORKSPACE
      && event.payload.binding.workKind === 'task' && event.payload.binding.goalId === GOAL
      && event.payload.binding.taskId === taskId)
    .map((event) => event.aggregateId);
}

async function eventCount(ledger: StateLedger): Promise<number> {
  return (await ledger.events({ afterCursor: null, limit: 4096 })).events.length;
}

const memoryWorld = async () => {
  const ledger = new InMemoryLedger();
  const run = await seedWorld(ledger);
  const deps = createDeterministicDeps();
  const control = createControlEngine({ ledger, now: deps.clock, eventId: deps.eventId });
  return { ledger, control, run };
};

/**
 * 把账本包一层"门"：前两次 events() 读取都完成之后才放行。这样两个并发 bind 会**都**在
 * "该任务还没有身份"这个结论上继续往下走 —— 这正是"先查后写"最危险的交错，
 * 也是唯一能证明"守卫之外还需要账本层"的构造。
 */
function gateFirstTwoEventReads(ledger: StateLedger): { ledger: StateLedger; release: () => void } {
  let arrived = 0;
  let releaseGate: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const gated: StateLedger = {
    load: (ref) => ledger.load(ref),
    commit: (batch) => ledger.commit(batch),
    events: async (query) => {
      const page = await ledger.events(query);
      arrived += 1;
      if (arrived >= 2) releaseGate?.();
      await gate;
      return page;
    },
    pendingDispatchIntents: (limit, selection) => ledger.pendingDispatchIntents(limit, selection),
  };
  return { ledger: gated, release: () => releaseGate?.() };
}

describe('RC-03 场景 1：不同 workId 指向同一任务 —— 第二条身份被权威拒绝（零写）', () => {
  it('命令面守卫拒绝 already_bound，回执给出既有身份，账本里仍然只有一条身份', async () => {
    const { ledger, control } = await memoryWorld();
    const first = await control.bindWorkContext(bindCommand('work-rc03-first'));
    expect(first.status).toBe('committed');

    const before = await eventCount(ledger);
    const second = await control.bindWorkContext(bindCommand('work-rc03-second'));
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected') {
      expect(second.code).toBe('already_bound');
      // 回执必须让调用方知道"该复用的是哪一条"，而不是只说"不行"。
      expect(second.existingWorkContextRef).toEqual(workContextRefFor(PROJECT, WORKSPACE, 'work-rc03-first'));
    }

    // 零写入：事件一条没多，第二条身份在账本里根本不存在。
    expect(await eventCount(ledger)).toBe(before);
    expect((await ledger.load(workContextRefFor(PROJECT, WORKSPACE, 'work-rc03-second'))).status).toBe('not_found');
    expect(await taskIdentities(ledger)).toEqual(['work-rc03-first']);
  });

  it('权威解析面给出的是同一条身份（守卫与派发面用的是同一个答案，不是两套规则）', async () => {
    const { control } = await memoryWorld();
    expect((await control.bindWorkContext(bindCommand('work-rc03-declared'))).status).toBe('committed');
    const resolved = await control.resolveTaskWorkIdentity({ projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL, taskId: TASK });
    expect(resolved).toMatchObject({ status: 'resolved', authority: 'declared', candidateCount: 1 });
    if (resolved.status === 'resolved') expect(resolved.binding.workId).toBe('work-rc03-declared');
    // 守卫拒绝时给的正是这条答案。
    const dup = await control.bindWorkContext(bindCommand('work-rc03-other'));
    expect(dup.status === 'rejected' && dup.existingWorkContextRef?.workId).toBe('work-rc03-declared');
  });

  it('既有语义不被削弱：同一命令重放返回原回执；不同内容不覆盖既有身份', async () => {
    const { ledger, control } = await memoryWorld();
    const command = bindCommand('work-rc03-idem');
    const first = await control.bindWorkContext(command);
    expect(first.status).toBe('committed');
    const eventsAfterFirst = await eventCount(ledger);

    // 1) 同一命令重放：committed(replayed) + 原 eventIds/commitCursor，一条事件都不多。
    const replay = await control.bindWorkContext(command);
    expect(replay.status).toBe('committed');
    if (replay.status === 'committed' && first.status === 'committed') {
      expect(replay.replayed).toBe(true);
      expect(replay.eventIds).toEqual(first.eventIds);
      expect(replay.commitCursor).toBe(first.commitCursor);
      expect(replay.workContextRef).toEqual(first.workContextRef);
    }
    expect(await eventCount(ledger)).toBe(eventsAfterFirst);

    // 2) 同一命令身份换内容（换目标 → 换槽）仍是 idempotency_conflict，且不覆盖既有身份。
    const conflict = await control.bindWorkContext(bindCommand('work-rc03-idem', { goalId: 'other-goal' }));
    expect(conflict.status === 'rejected' && conflict.code).toBe('idempotency_conflict');

    // 3) 同一 workId、换个命令再次创建仍是 revision_conflict（CAS@0 语义原样保留）。
    const sameWorkId = await control.bindWorkContext(bindCommand('work-rc03-idem', { commandId: 'bind-rc03-idem-again' }));
    expect(sameWorkId.status === 'rejected' && sameWorkId.code).toBe('revision_conflict');

    // 既有身份一个字都没变。
    const kept = await ledger.load(workContextRefFor(PROJECT, WORKSPACE, 'work-rc03-idem'));
    if (kept.status !== 'found') throw Error('既有身份被删除了');
    const snapshot = kept.snapshot as WorkContextBindingSnapshot;
    expect(snapshot.revision).toBe(1);
    expect(snapshot.binding.goalId).toBe(GOAL);
  });

  it('非 task 工作（coordination）不受这条唯一性约束：两条不同 workId 都成立', async () => {
    const { ledger, control } = await memoryWorld();
    const a = await control.bindWorkContext(bindCommand('work-rc03-coord-a', { workKind: 'coordination', goalId: null, taskId: null }));
    const b = await control.bindWorkContext(bindCommand('work-rc03-coord-b', { workKind: 'coordination', goalId: null, taskId: null }));
    expect([a.status, b.status]).toEqual(['committed', 'committed']);
    expect(await taskIdentities(ledger)).toEqual([]);
  });
});

describe('RC-03 场景 2：并发调用（两个 bind 同时进入，都在"还没有身份"上继续）', () => {
  it('恰好一条身份落账，另一条零写被拒；之后重试落败方得到 already_bound', async () => {
    const { ledger, control } = await memoryWorld();
    const gated = gateFirstTwoEventReads(ledger);
    const gatedControl = createControlEngine({
      ledger: gated.ledger,
      now: createDeterministicDeps().clock,
      eventId: createDeterministicDeps().eventId,
    });
    const before = await eventCount(ledger);

    // 两个并发 bind：都在门内读到"该任务没有身份"，然后同时往下走。
    const [a, b] = await Promise.all([
      gatedControl.bindWorkContext(bindCommand('work-rc03-race-a')),
      gatedControl.bindWorkContext(bindCommand('work-rc03-race-b')),
    ]);
    const committed = [a, b].filter((receipt) => receipt.status === 'committed');
    const rejected = [a, b].filter((receipt) => receipt.status === 'rejected');
    expect(committed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // 落败方由**账本**的提交语义拒绝（守卫在它读的时候还没看到 winner）。
    if (rejected[0]!.status === 'rejected') expect(rejected[0]!.code).toBe('revision_conflict');

    // 唯一性成立：账本里只有一条该任务的身份，只多了一条 WorkContextBound 事件。
    expect(await taskIdentities(ledger)).toHaveLength(1);
    expect(await eventCount(ledger)).toBe(before + 1);
    gated.release();

    // 落败方重试：这次守卫能看到 winner，给出 already_bound 与既有身份（可读、可行动的拒绝）。
    const loserWorkId = committed[0]!.status === 'committed' && committed[0]!.workContextRef.workId === 'work-rc03-race-a' ? 'work-rc03-race-b' : 'work-rc03-race-a';
    const retry = await gatedControl.bindWorkContext(bindCommand(loserWorkId, { commandId: 'bind-' + loserWorkId + '-retry' }));
    expect(retry.status).toBe('rejected');
    if (retry.status === 'rejected') {
      expect(retry.code).toBe('already_bound');
      expect(retry.existingWorkContextRef?.workId).toBe((await taskIdentities(ledger))[0]);
    }
  });
});

describe('RC-03 场景 2b：派发面遇到权威拒绝时改为复用（不新建第二条）', () => {
  it('解析先在"还没有身份"上继续，随后 bind 被守卫拒绝 → 重新解析并复用既有身份，只做 link', async () => {
    const { ledger, control } = await memoryWorld();
    // "赢家"先为这个任务建立了身份（另一个调用方／另一个进程先到）。
    const winner = await control.bindWorkContext(bindCommand('work-rc03-winner'));
    expect(winner.status).toBe('committed');
    const identitiesAfterWinner = await taskIdentities(ledger);
    const eventsAfterWinner = await eventCount(ledger);

    // 派发面的解析发生在赢家提交**之前**（这就是"先查后写"的交错）：第一次问"还没有身份"，
    // 之后每一次问都走真实权威读面。派发面必须因此被守卫拒绝，并改为复用 —— 绝不新建第二条。
    let resolutions = 0;
    const racing: WorkIdentityDeps['control'] = {
      bindWorkContext: (command) => control.bindWorkContext(command),
      linkWorkRun: (command) => control.linkWorkRun(command),
      resolveTaskWorkIdentity: async (query) => {
        resolutions += 1;
        if (resolutions === 1) return { status: 'absent' };
        return control.resolveTaskWorkIdentity(query);
      },
    };
    const intent = (await ledger.pendingDispatchIntents(10, { workKind: 'ordinary' }))[0]!.intent;
    const outcome = await ensureWorkIdentity({ ledger, control: racing, now: () => FIXED }, intent);
    expect(outcome).toMatchObject({ status: 'established', workId: 'work-rc03-winner', linked: true, revision: 1 });
    // 账本里仍然只有那一条身份，也没有多出任何事件（本 Run 是 link 到既有身份上的）。
    expect(await taskIdentities(ledger)).toEqual(identitiesAfterWinner);
    expect(await eventCount(ledger)).toBe(eventsAfterWinner);
    const binding = await ledger.load(workContextRefFor(PROJECT, WORKSPACE, 'work-rc03-winner'));
    if (binding.status !== 'found') throw Error('既有身份不见了');
    expect((binding.snapshot as WorkContextBindingSnapshot).binding.linkedRunRefs.map((ref) => ref.runId)).toEqual(['run-1']);
  });
});

describe('RC-03 场景 3：多连接／两个宿主进程（同一条 SQLite 文件、各自一条连接）', () => {
  it('宿主 B 的守卫看到宿主 A 已提交的身份并拒绝；绕过守卫直接提交也由账本拒绝', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rc03-multi-conn-'));
    const path = join(dir, 'ledger.sqlite');
    const hostA = createSqliteStateLedger({ path });
    const hostB = createSqliteStateLedger({ path });
    try {
      const run = await seedWorld(hostB);
      const depsA = createDeterministicDeps();
      const controlA = createControlEngine({ ledger: hostA, now: depsA.clock, eventId: depsA.eventId });
      expect((await controlA.bindWorkContext(bindCommand('work-rc03-host-a'))).status).toBe('committed');

      // 宿主 B：另一条连接、另一个引擎实例、没有共享任何进程内状态。
      const depsB = createDeterministicDeps();
      const controlB = createControlEngine({ ledger: hostB, now: depsB.clock, eventId: () => 'hostb-' + depsB.eventId() });
      const dup = await controlB.bindWorkContext(bindCommand('work-rc03-host-b'));
      expect(dup.status).toBe('rejected');
      if (dup.status === 'rejected') {
        expect(dup.code).toBe('already_bound');
        expect(dup.existingWorkContextRef).toEqual(workContextRefFor(PROJECT, WORKSPACE, 'work-rc03-host-a'));
      }

      // 直接绕过命令面守卫、把原始提交交给账本：账本自己必须拒绝（这才是并发时唯一有效的判定点）。
      const before = await eventCount(hostB);
      const raw = await hostB.commit(buildWorkContextBindLedgerCommit(bindCommand('work-rc03-raw'), { eventId: 'raw-evt', occurredAt: FIXED }));
      expect(raw.status).toBe('rejected');
      if (raw.status === 'rejected') expect(raw.code).toBe('revision_conflict');
      expect(await eventCount(hostB)).toBe(before);
      expect((await hostB.load(workContextRefFor(PROJECT, WORKSPACE, 'work-rc03-raw'))).status).toBe('not_found');
      expect(await taskIdentities(hostB)).toEqual(['work-rc03-host-a']);
      expect(await taskIdentities(hostA)).toEqual(['work-rc03-host-a']);

      // 换一个**还没有身份**的任务，两条原始提交并发推进同一个空槽：账本层也只放行一条。
      const PARALLEL_TASK = 'task-rc03-parallel';
      const raws: LedgerCommit[] = ['work-rc03-par-a', 'work-rc03-par-b'].map((workId) =>
        buildWorkContextBindLedgerCommit(bindCommand(workId, { taskId: PARALLEL_TASK }), { eventId: 'par-' + workId, occurredAt: FIXED }));
      const results = await Promise.all(raws.map((batch) => hostB.commit(batch)));
      expect(results.filter((receipt) => receipt.status === 'committed')).toHaveLength(1);
      expect(results.filter((receipt) => receipt.status === 'rejected')).toHaveLength(1);
      expect(await taskIdentities(hostB, PARALLEL_TASK)).toHaveLength(1);
      expect(await taskIdentities(hostB)).toEqual(['work-rc03-host-a']);
      void run;
    } finally {
      await hostA.close();
      await hostB.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('RC-03 场景 4：重开（close → reopen 之后重试同一 bind）', () => {
  it('同一命令重放仍是原回执；换 workId 仍被拒；唯一性跨重启继续成立', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rc03-reopen-'));
    const path = join(dir, 'ledger.sqlite');
    const before = createSqliteStateLedger({ path });
    let reopened = createSqliteStateLedger({ path });
    try {
      await seedWorld(before);
      const deps = createDeterministicDeps();
      const control = createControlEngine({ ledger: before, now: deps.clock, eventId: deps.eventId });
      const command = bindCommand('work-rc03-reopen');
      const original = await control.bindWorkContext(command);
      expect(original.status).toBe('committed');
      const eventsAfterBind = await eventCount(before);
      await before.close();

      // 重开：新连接、新引擎，不共享任何进程内状态。
      const deps2 = createDeterministicDeps();
      const control2 = createControlEngine({ ledger: reopened, now: deps2.clock, eventId: () => 'reopen-' + deps2.eventId() });

      // (a) 重试同一命令 → 原回执（幂等跨重启成立），一条事件都不多。
      const replay = await control2.bindWorkContext(command);
      expect(replay.status).toBe('committed');
      if (replay.status === 'committed' && original.status === 'committed') {
        expect(replay.replayed).toBe(true);
        expect(replay.eventIds).toEqual(original.eventIds);
        expect(replay.commitCursor).toBe(original.commitCursor);
      }
      expect(await eventCount(reopened)).toBe(eventsAfterBind);

      // (b) 换一个 workId 建第二条身份 → 仍被权威拒绝（守卫 + 账本两层都跨重启有效）。
      const dup = await control2.bindWorkContext(bindCommand('work-rc03-reopen-2'));
      expect(dup.status).toBe('rejected');
      if (dup.status === 'rejected') {
        expect(dup.code).toBe('already_bound');
        expect(dup.existingWorkContextRef?.workId).toBe('work-rc03-reopen');
      }
      const raw = await reopened.commit(buildWorkContextBindLedgerCommit(bindCommand('work-rc03-reopen-raw'), { eventId: 'reopen-raw', occurredAt: FIXED }));
      expect(raw.status).toBe('rejected');
      expect(await taskIdentities(reopened)).toEqual(['work-rc03-reopen']);
      expect(await eventCount(reopened)).toBe(eventsAfterBind);
    } finally {
      await before.close().catch(() => undefined);
      await reopened.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('RC-03 边界：解析不可读时 fail-closed（读不完整不等于"没有身份"）', () => {
  it('账本事件不可读 → 拒绝且零写入，不凭推导 id 硬写第二条身份', async () => {
    const { ledger, control } = await memoryWorld();
    void control;
    // 真实账本 + 只坏掉事件读取的视图：守卫必须诚实返回不可用并拒绝，而不是当作"没有身份"。
    const unreadable: StateLedger = {
      load: (ref) => ledger.load(ref),
      commit: (batch) => ledger.commit(batch),
      events: async () => { throw new Error('账本事件不可读'); },
      pendingDispatchIntents: (limit, selection) => ledger.pendingDispatchIntents(limit, selection),
    };
    const deps = createDeterministicDeps();
    const unreadableControl = createControlEngine({ ledger: unreadable, now: deps.clock, eventId: deps.eventId });
    const receipt = await unreadableControl.bindWorkContext(bindCommand('work-rc03-unreadable'));
    expect(receipt.status).toBe('rejected');
    if (receipt.status === 'rejected') expect(receipt.code).toBe('unavailable');
    expect(await taskIdentities(ledger)).toEqual([]);
    expect((await ledger.load(workContextRefFor(PROJECT, WORKSPACE, 'work-rc03-unreadable'))).status).toBe('not_found');
  });
});
