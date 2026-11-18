/**
 * G8B-1b 写测试方（`g8b-rulings.md` 的 B2 撤回、B1f“被人撤回过的检查 agent 批准装不回去”；行 D5、D6；只跑内存）。
 * D5（`G8B-world.ts`）：底计划 v1 带一条只查底计划任务的种子检查（撤回后还有检查配置，`g8b-d1-work` 才开检查轮；
 * 人撤到一条不剩时 Host 装空配置、轮照开，见 G6R2 T3）。照 D1 装上 `g8b-d1-check` 后人撤回：快照 `checks` 只剩种子、
 * `withdrawnChecks` 记着它，计划仍 v2。
 * 人启动目标：`g8b-d1-work` 跑完，它的检查轮里没有这条检查，`g8b-d1-static` 是缺项。秘书再交一个带同 id、同命令检查的
 * 小改动（`taskIds` 加上新任务：规划轮的覆盖要每个工作任务都有检查，撤回后 `g8b-d1-work` 只剩它能查），参谋批，Host 不装
 * （B1f 按 `checkId` 拒），计划仍 v2，一行原因含“被人撤回过”的 `check_to_person`。
 * D6（G8A 的 `openG8Project`）：撤不存在的 id → `not_found`，快照不变，文字含这个 id；同一个撤回做两次都是 `ready`，
 * 快照相同。已批准清单里的单条检查不能撤的老口径（D6a）由 R2 改判删掉：人能撤，由 G6R2 T1 守。
 * 改坏演示：在 `host-settings.ts` 上临时写一个撤回替身，三行全绿；替身上再改坏一处：撤回不通知 Host → D5 红在检查轮里还有它；
 * agent 批准不拒被撤回过的 → D5 红在计划到 v3；重做报错 → D6c 红。都还原，`src` 无改动。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HostSettingsSnapshot, SettingsResponse } from '../../src/app/host-settings-types.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import { g8Check, g8PlanCall, g8PlanForm, openG8Project } from '../helpers/G8-world.js';
import { G8B_ROLE, G8B_TEMPLATE, adoptWithChecks, g8bCheckReview, openG8BWorld } from '../helpers/G8B-world.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

const OBJECTIVE = 'G8B 撤回以后';
type Snapshot = SettingsResponse<HostSettingsSnapshot>;
/** 设置路由 `checks/withdraw`（B2），回设置快照。 */
const withdraw = (world: S6AHostWorld, scope: WorkspaceScope, checkId: string): Promise<Snapshot> =>
  (world.settings as unknown as (route: string, input: unknown) => Promise<Snapshot>)('checks/withdraw', { scope, checkId });
const entryOf = (answer: Snapshot, scope: WorkspaceScope) => answer.status === 'ready'
  ? answer.value.workspaces.find(item => item.scope.workspaceId === scope.workspaceId) : undefined;

it('D5: withdrawn: off the snapshot and the Host, the plan stays; an agent approval cannot install it again', async () => {
  const w = await openG8BWorld('g8b-d5');
  cleanup.push(w.close);
  const adviser = await w.line('g8b-d5-adviser', G8B_TEMPLATE.adviser);
  const secretary = await w.line('g8b-d5-secretary', G8B_TEMPLATE.secretary);
  const executor = await w.line('g8b-d5-executor', G8B_TEMPLATE.executor);
  const goal = await w.goal('g8b-d5', OBJECTIVE, { adviser });
  await adoptWithChecks(w.world, w.scope, goal, 'g8b-d5-base',
    [g8Check('g8b-d5-seed', ['g8b-d5-base-work', 'g8b-d5-base-gate'])]);
  await w.world.scripted.script(adviser, ['g8b-d5-approve-1', 'g8b-d5-approve-2'].map(callId => g8bCheckReview(callId,
    [{ checkId: 'g8b-d1-check', decision: 'approve', reason: '改动前确实失败' }])), w.scope);
  const command = 'test -f g8b-d1.txt';
  await w.world.scripted.script(secretary, [
    g8PlanCall('g8b-d1-plan', g8PlanForm('g8b-d1', G8B_ROLE, [g8Check('g8b-d1-check', ['g8b-d1-work'], command)], true)),
    g8PlanCall('g8b-d5-plan', g8PlanForm('g8b-d5', G8B_ROLE,
      [g8Check('g8b-d1-check', ['g8b-d1-work', 'g8b-d5-work'], command)], true)),
  ], w.scope);
  /** 秘书的一个小改动：等 Host 的计划轮入口返回、参谋答完这份候选的批准轮；返回这份候选。 */
  const change = async (name: string) => {
    const asked = await w.steps.ask(name, secretary, goal);
    expect(await w.turnEnded(asked.round)).toEqual({ status: 'done' });
    const head = await w.steps.candidate(goal, asked.requestRoot);
    const sent = (await w.rounds(adviser, 'checkreview:'))
      .filter(round => round.text.split('\n')[0] === `checkreview:${head.ref.proposalId}:1`);
    expect(sent, `${name}: the adviser got no checkreview:`).toHaveLength(1);
    expect((await w.settled(sent[0]!.message.ref)).response, `${name}: not replied`).not.toBeNull();
    return head;
  };
  const d1 = await change('g8b-d1');

  const withdrawn = await withdraw(w.world, w.scope, 'g8b-d1-check');
  expect(withdrawn.status, JSON.stringify(withdrawn)).toBe('ready');
  expect(entryOf(withdrawn, w.scope)?.checks?.map(item => item.checkId)).toEqual(['g8b-d5-seed']);
  expect(entryOf(withdrawn, w.scope)).toMatchObject({ withdrawnChecks: [{ checkId: 'g8b-d1-check',
    plan: { proposalRef: d1.ref } }] });
  expect(await w.planRevision(goal), 'the withdrawal changed the plan').toBe(2);

  // 人启动目标：`g8b-d1-work` 跑完（不写 `g8b-d1.txt`），它的检查轮里没有这条检查，它查的必需要求是缺项。
  const round = await w.firstCheckRound(goal, executor, 'g8b-d1-work', 'G8B D5 做完了');
  expect(round.checks.map(item => item.checkId), 'the Host still runs the withdrawn check').not.toContain('g8b-d1-check');
  expect(round.gaps.map(gap => gap.coverage?.requirementId)).toContain('g8b-d1-static');
  expect(round.outcome).not.toBe('PASS');

  // 同一个 id 再由 agent 批（改动前仍失败）：Host 不装，计划不动，告诉人原因。
  const before = await w.noticeKeys(goal);
  await change('g8b-d5');
  expect(await w.planRevision(goal)).toBe(2);
  expect((await w.steps.settingsEntry()).checks?.map(item => item.checkId), 'installed again').toEqual(['g8b-d5-seed']);
  const notices = await w.newNotices(goal, before);
  expect(notices.map(item => item.noticeKind)).toEqual(['check_to_person']);
  expect(notices[0]!.summary).toMatch(
    new RegExp(`^来自 秘书 · 目标 ${OBJECTIVE}：参谋已批检查「g8b-d1-check」，但计划没采用上：.*被人撤回过`));
}, 300_000);

/** D6 的世界：初始化装了种子检查 `g8-seed-check`，人采用的计划装了 `<tag>-check`。 */
async function planCheckInstalled(tag: string) {
  const project = await openG8Project(tag, [g8Check('g8-seed-check', ['g8-seed-work', 'g8-seed-gate'])]);
  cleanup.push(project.close);
  const goal = (await s6aCardsWorkspace(project.world, project.scope).createGoal(`${tag}-goal`)).ref;
  await adoptWithChecks(project.world, project.scope, goal, tag, [g8Check(`${tag}-check`, [`${tag}-work`, `${tag}-gate`])]);
  return project;
}

describe('rejects: a withdrawal of an id the workspace settings do not have (D6)', () => {
  it.each([
    { row: 'D6b', what: 'an id the workspace does not have', checkId: 'g8b-d6b-none', says: 'g8b-d6b-none' },
  ])('$row: $what → not_found, nothing changes', async ({ row, checkId, says }) => {
    const project = await planCheckInstalled(`g8b-${row.toLowerCase()}`);
    const before = await project.settingsEntry();
    const answer = await withdraw(project.world, project.scope, checkId);
    expect(answer).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(answer.status === 'rejected' ? answer.reason : '').toContain(says);
    expect(await project.settingsEntry()).toEqual(before);
  }, 180_000);
});

it('D6c: the same withdrawal again is ready and answers the same snapshot', async () => {
  const project = await planCheckInstalled('g8b-d6c');
  const first = await withdraw(project.world, project.scope, 'g8b-d6c-check');
  const second = await withdraw(project.world, project.scope, 'g8b-d6c-check');
  expect([first.status, second.status], JSON.stringify(second)).toEqual(['ready', 'ready']);
  expect(entryOf(second, project.scope)).toEqual(entryOf(first, project.scope));
}, 180_000);
