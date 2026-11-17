/**
 * G8B-1a 施工方补测（lead 11-17 18:2x 裁定 1；世界和 D1 同一个，`G8B-world.ts`）：参谋批了秘书小改动带来的检查，
 * 平台采用上了，但写“请知悉”的那一次提交失败。收尾下一次重做时查本轮自己的采用回执（固定请求号
 * `checkreview:<候选>:<版本>:adopt`），补写同身份的 `check_approved`，正好一行，然后才关来源。
 * 改前红在：重做时候选已被采用，收尾直接结束，请知悉永远没有。
 */
import { afterEach, expect, it, vi } from 'vitest';
import { g8Check, g8PlanCall, g8PlanForm } from '../helpers/G8-world.js';
import { G8B_ROLE, G8B_TEMPLATE, g8bCheckReview, openG8BWorld } from '../helpers/G8B-world.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  commitBarrier.reset();
  await Promise.allSettled(cleanup.splice(0).reverse().map(close => close()));
});

const OBJECTIVE = 'G8B 采用后补请知悉';

it('G8B1a-N: the notice write fails after the adoption; the redo finds its own adoption receipt and writes it once',
  async () => {
    const tag = 'g8b1a-n';
    const check = g8Check(`${tag}-check`, [`${tag}-work`], `test -f ${tag}.txt`);
    const w = await openG8BWorld(tag);
    cleanup.push(w.close);
    const adviser = await w.line(`${tag}-adviser`, G8B_TEMPLATE.adviser);
    const secretary = await w.line(`${tag}-secretary`, G8B_TEMPLATE.secretary);
    const goal = await w.goal(tag, OBJECTIVE, { adviser, base: true });
    const before = await w.noticeKeys(goal);
    await w.world.scripted.script(adviser, [g8bCheckReview(`${tag}-approve`,
      [{ checkId: check.checkId, decision: 'approve', reason: '改动前确实失败，查的正是新任务' }])], w.scope);
    await w.world.scripted.script(secretary, [g8PlanCall(`${tag}-plan`, g8PlanForm(tag, G8B_ROLE, [check], true))],
      w.scope);
    // 第一次写请知悉的提交失败（不落地）；采用的提交照常。
    const fault = commitBarrier.failCommitOnce(commit => commit.records.some(record =>
      record.refKey.includes('"aggregateType":"ProjectNotice"')));
    const asked = await w.steps.ask(tag, secretary, goal);
    expect(await w.turnEnded(asked.round), 'the Host\'s own plan turn').toEqual({ status: 'done' });
    const sent = await w.roundsAfter(adviser, 'checkreview:');
    expect(sent).toHaveLength(1);
    expect((await w.settled(sent[0]!.message.ref)).response, 'the round was not replied').not.toBeNull();
    fault.release();
    expect(await w.planRevision(goal)).toBe(2);
    const notices = await w.newNotices(goal, before);
    expect(notices.map(item => item.summary)).toEqual([
      `来自 秘书 · 目标 ${OBJECTIVE}：加了检查「${check.checkId}」，改动前跑会失败（已核实），参谋已批，已生效`]);
    expect(notices[0]).toMatchObject({ noticeKind: 'check_approved' });
  }, 180_000);
