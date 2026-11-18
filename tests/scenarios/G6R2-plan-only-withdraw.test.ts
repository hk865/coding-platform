/**
 * G6R2 T3（R2 冻结稿第三节；121-144 的待办、R2-5；只跑内存）。G8B 的世界只计划装检查、没有 Host 启动配置：人采用的底计划
 * 只带一条检查 `g6r2-only`，人撤回它，设置快照里这个工作区没有 `checks` 字段、`withdrawnChecks` 一项；人启动目标，这个任务的
 * 检查轮照开，缺口里有它查的必需要求，检查里没有命令检查。
 * 这一行守什么改坏：撤到一条不剩时仍退回“没有检查配置”（Host 撤掉注册，轮开不出，等轮红）；或把撤掉的检查又装回（快照或轮里红）。
 */
import { afterEach, expect, it } from 'vitest';
import { g8Check } from '../helpers/G8-world.js';
import { G8B_TEMPLATE, adoptWithChecks, openG8BWorld } from '../helpers/G8B-world.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

it('T3: withdrawing the only plan-installed check leaves an empty configuration: the round opens with an uncovered requirement', async () => {
  const w = await openG8BWorld('g6r2-t3');
  cleanup.push(w.close);
  const goal = await w.goal('g6r2-t3', 'G6R2 计划检查撤到一条不剩');
  await adoptWithChecks(w.world, w.scope, goal, 'g6r2-t3', [g8Check('g6r2-only', ['g6r2-t3-work'])]);

  const withdrawn = await w.world.settings('checks/withdraw', { scope: w.scope, checkId: 'g6r2-only' });
  expect(withdrawn.status, JSON.stringify(withdrawn)).toBe('ready');
  const entry = await w.steps.settingsEntry();
  expect(entry, 'T3: no public checks field').not.toHaveProperty('checks');
  expect(entry.withdrawnChecks, 'T3: one trace').toHaveLength(1);
  expect(entry.withdrawnChecks?.[0]).toMatchObject({ checkId: 'g6r2-only' });
  expect(entry.withdrawnChecks?.[0]).toHaveProperty('plan');

  const executor = await w.line('g6r2-t3-executor', G8B_TEMPLATE.executor);
  const round = await w.firstCheckRound(goal, executor, 'g6r2-t3-work', 'G6R2 T3 做完了');
  expect(round.checks.filter(check => check.definition.command !== undefined).map(check => check.checkId),
    'T3: no command check runs').toEqual([]);
  // 这份计划查的必需要求，按 `g8PlanForm` 的写法手算：`<tag>-static`。
  expect(round.gaps.map(gap => gap.coverage?.requirementId), 'T3: the requirement is uncovered').toContain('g6r2-t3-static');
}, 180_000);
