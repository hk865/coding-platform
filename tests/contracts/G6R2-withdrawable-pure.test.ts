/**
 * G6R2 T2（R2 冻结稿第三节；纯函数 A5，一张表）：`withdrawableFailingChecks` 六格，(a) 回两个 id、原顺序，(b)–(f) 回 null。
 * 这一行守什么改坏：纯规则少判任何一个条件（有这个目标的计划带来的、有缺口、有不是 FAIL 的、有不在设置里的、一条都没失败），
 * 对应那一格就红。
 */
import { expect, it } from 'vitest';
import { withdrawableFailingChecks } from '../../src/contracts/verification.js';

type Outcome = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
const input = (failing: [string, Outcome][], gapCodes: string[], settings: string[], goalPlan: string[] = []) => ({
  failing: failing.map(([checkId, outcome]) => ({ checkId, outcome })), gapCodes,
  settingsCheckIds: new Set(settings), goalPlanCheckIds: new Set(goalPlan) });
const BOTH: [string, Outcome][] = [['g6r2-a', 'FAIL'], ['g6r2-b', 'FAIL']];

it.each([
  ['a: two FAILs installed in the settings, neither from this Goal\'s plan', input(BOTH, [], ['g6r2-a', 'g6r2-b']),
    ['g6r2-a', 'g6r2-b']],
  ['b: one came from this Goal\'s own plan', input(BOTH, [], ['g6r2-a', 'g6r2-b'], ['g6r2-b']), null],
  ['c: the round has an uncovered requirement', input([['g6r2-a', 'FAIL']], ['uncovered_requirement'], ['g6r2-a']), null],
  ['d: one is INCONCLUSIVE, not FAIL', input([['g6r2-a', 'FAIL'], ['g6r2-b', 'INCONCLUSIVE']], [], ['g6r2-a', 'g6r2-b']), null],
  ['e: one is not installed in the settings (a review item, a witness or a start-up check)',
    input([['g6r2-a', 'FAIL'], ['g6r2-c', 'FAIL']], [], ['g6r2-a']), null],
  ['f: no check failed', input([], [], ['g6r2-a']), null],
] as const)('%s', (_row, given, expected) => {
  expect(withdrawableFailingChecks(given)).toEqual(expected);
});
