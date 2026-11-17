/**
 * G8B-1a 施工方补测（lead 11-17 19:2x 第 1 条；世界同 D1，`G8B-world.ts`）：参谋批了，平台采用上了，第一次写请知悉的
 * 提交失败；下一次收尾查本轮采用回执时，回执读取又失败一次（包住真实 store 的 `lookupCommit`，只对这次采用的身份
 * 失败一次，RULES A2）。读取失败不能当成“不是本轮采用”：来源要留着，再下一次查到回执，补写请知悉，正好一行。
 * 改前红在：回执读取失败后往下走，读到候选已被采用就关了来源，请知悉永远没有。
 */
import { afterEach, expect, it, vi } from 'vitest';
import { g8Check, g8PlanCall, g8PlanForm } from '../helpers/G8-world.js';
import { G8B_ROLE, G8B_TEMPLATE, g8bCheckReview, openG8BWorld } from '../helpers/G8B-world.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';

/** 记下这次采用提交的身份；之后对这个身份的下一次回执读取失败一次。 */
const fault = vi.hoisted(() => ({ adoptionKey: null as string | null, failed: 0 }));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const barrier = await (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal);
  return { ...barrier, createInMemoryRecordBackend: (options: Parameters<typeof barrier.createInMemoryRecordBackend>[0]) => {
    const backend = barrier.createInMemoryRecordBackend(options);
    const real = backend.records;
    return { ...backend, records: { ...real,
      commit: async (input: Parameters<typeof real.commit>[0]) => {
        const receipt = await real.commit(input);
        // 批准轮收尾的采用：固定请求号 `checkreview:<候选>:<版本>:adopt` 在身份里。
        if (fault.adoptionKey === null && input.identityKey.startsWith('plan-apply:')
          && input.identityKey.includes('checkreview:')) {
          fault.adoptionKey = input.identityKey;
        }
        return receipt;
      },
      lookupCommit: async (input: Parameters<typeof real.lookupCommit>[0]) => {
        if (fault.adoptionKey !== null && fault.failed === 0 && input.identityKey === fault.adoptionKey) {
          fault.failed += 1;
          return { status: 'rejected' as const, code: 'unavailable' as const, reason: 'G8B1a: injected receipt read failure' };
        }
        return real.lookupCommit(input);
      } } };
  } };
});

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  commitBarrier.reset();
  fault.adoptionKey = null;
  fault.failed = 0;
  await Promise.allSettled(cleanup.splice(0).reverse().map(close => close()));
});

const OBJECTIVE = 'G8B 回执读取失败';

it('G8B1a-R: a failed receipt read after the adoption keeps the source open; the notice is written once later',
  async () => {
    const tag = 'g8b1a-r';
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
    commitBarrier.failCommitOnce(commit => commit.records.some(record =>
      record.refKey.includes('"aggregateType":"ProjectNotice"')));
    const asked = await w.steps.ask(tag, secretary, goal);
    expect(await w.turnEnded(asked.round), 'the Host\'s own plan turn').toEqual({ status: 'done' });
    const sent = await w.roundsAfter(adviser, 'checkreview:');
    expect(sent).toHaveLength(1);
    expect((await w.settled(sent[0]!.message.ref)).response, 'the round was not replied').not.toBeNull();
    expect(fault.failed, 'the receipt read never failed').toBe(1);
    expect(await w.planRevision(goal)).toBe(2);
    const notices = await w.newNotices(goal, before);
    expect(notices.map(item => item.summary)).toEqual([
      `来自 秘书 · 目标 ${OBJECTIVE}：加了检查「${check.checkId}」，改动前跑会失败（已核实），参谋已批，已生效`]);
  }, 180_000);
