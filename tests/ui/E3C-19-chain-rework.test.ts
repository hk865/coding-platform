import { afterEach, describe, expect, it } from 'vitest';
import { AG2B_GOAL_REF, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { NOTES_FILE, editThenText } from '../scenarios/support/common.js';
import { cleanupRework } from '../scenarios/support/rework.js';
import { cleanupScenarios, openHostScenario, performs } from '../scenarios/harness.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS9ReviewWorld, openS9ReviewRound, answerS9Review, bookS9Review, finalizeS9Review } from '../helpers/S9-review-fixture.js';
import { findClass, findElement } from './helpers/boot-page.js';
import { barItem, bootChain, taskBar } from './helpers/E3C-world.js';
import { memberSearch, workLineOf } from './helpers/E3M-world.js';
import { hasClass, textOf } from './helpers/E3N-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * P06-3/P06-4 (test sheet §Chain; wiring C8/C3): the automatic rework's
 * count on the task bar and the second attempt's continuation. The world is
 * A1's (same session, one automatic requeue, Run 2 started from the brief);
 * the page is Chain over that Host, exactly as `bootChain` boots it.
 */

afterEach(async () => {
  await cleanupRework();
  await cleanupScenarios();
}, 180_000);

/** A1's world stopped after the automatic requeue and Run 2's claim: the brief exists, the bar counts 1. */
async function openReworkedWorld(key: string) {
  const h = await openHostScenario({ script: { replies: [
    { kind: 'calls', calls: [{ callId: `p3-run1-notes-${key}`, name: 'edit', args: { mode: 'create', path: NOTES_FILE,
      newText: 'P3: Run 1 writes notes, the result file is still missing\n' } }] },
    { kind: 'text', text: `P3 ${key}: Run 1 answers without the result file` },
    ...editThenText(`p3-rework-run2-${key}`),
  ] } });
  const toRequeue = await h.advance(h.select('a2-rework-1'), { stopBefore: performs('requeue_task') });
  expect(toRequeue.state, 'the FAILed round reached the automatic requeue').toBe('stopped');
  const toOpen = await h.advance(toRequeue.next!, { stopBefore: performs('open_checks') });
  expect(toOpen.state, 'the requeue was claimed and Run 2 started').toBe('stopped');
  const row = await h.taskRow();
  expect(row.effectivePhase, 'Run 2 is verifying').toBe('verifying');
  expect(row.failure?.automation, 'one automatic requeue of three').toMatchObject({ requeueAutoCount: 1, cap: 3 });
  const line = await workLineOf(h);
  const { page } = await bootChain(h.host, memberSearch(AG2B_GOAL_REF.goalId, line));
  return { page, line };
}

describe('E3C-CLKA the automatic rework on Chain', () => {
  it('P06-3 the task bar counts the automatic requeue: 自动返工 1/3', async () => {
    const { page } = await openReworkedWorld('p3-bar');
    try {
      expect(textOf(taskBar(page.root)), 'the dock belongs to the reworked task').toContain('自动返工');
      /* The stage the ruled world is in (A1's stop before Run 2's round opens).
         具名改坏: `barOf` 把 `task.rework` 读成 null（`自动返工 —`）；本行红。 */
      expect(textOf(findClass(taskBar(page.root)!, 'gb-state'))).toContain('验证中');
      expect(barItem(page.root, 'gb-item')).toBe('自动返工 1/3');
    } finally {
      await page.restore();
    }
  }, 300_000);

  it('P06-4 the second attempt draws 第 2 次尝试 · 接续 with the brief body', async () => {
    const { page } = await openReworkedWorld('p3-second');
    try {
      const text = textOf(page.root);
      // The ruled separator; the ordinal comes from the brief's trigger, not the array index.
      expect(text).toContain('第 2 次尝试 · 接续');
      const brief = findClass(page.root, 'lv-brief');
      expect(brief).toBeDefined();
      const briefText = textOf(brief);
      /* 页面错，已修：Chain 原先只用 brief.trigger 算序号/自动计数，正文没画。
         ruled 正文的字段来自 `ContinuationBriefV1`（渲染器
         contracts/continuation-brief-render.ts:227）；失败的 checkId 在这个 A1 世界里
         是 `ag2b-static`（同一份 brief 的 `checks.failing[0].checkId`），来源对比
         （clk-current.md:251）画成“来源对比”行。 */
      expect(briefText, 'the brief names the failed check').toContain('ag2b-static');
      expect(text, 'the brief names the file Run 1 changed').toContain(NOTES_FILE);
      expect(text, 'the brief names the comparison to the source').toContain('来源对比');
    } finally {
      await page.restore();
    }
  }, 300_000);
});

describe('E3C-CLKA the review conclusion on Chain', () => {
  it('P10-3 a reviewer round shows its conclusion in the check row', async () => {
    const review = await openS9ReviewWorld({ backend: 'memory' });
    const round = await openS9ReviewRound({ review });
    await answerS9Review(review, 'pass', { round });
    const evidence = await bookS9Review(review, round.roundRef);
    const finalized = await finalizeS9Review(review, round.roundRef, 'p3-review-finalize', [evidence]);
    expect(finalized.status).toBe('committed');
    // The round's delivery proves the conclusion is in the read the page gets.
    const shown = (await (await review.world.post('verification/round',
      plain(S6A_SCOPE, { roundRef: round.roundRef }))).body as {
      status: string; value?: { delivery?: { requirements: Array<{ requirementId: string; state: string }> } };
    });
    expect(shown.value?.delivery?.requirements.find((entry) => entry.requirementId === 's9-review')?.state).toBe('pass');
    const { page } = await bootChain(review.world, memberSearch(review.goal.goalId, review.workLine.ref));
    try {
      const text = textOf(page.root);
      expect(text).toContain('正式检查');
      /* 页面错，已修：`roundViewOf` 原先只读 `round.checks`，审阅项没有命令、
         会被画成 `平台只读核对`；`delivery.requirements[].state` 没读。公开读只给
         结论 state（`verification-round-read.ts:63-79`），不给 review 报告的正文
         （同一行的前置断言已经证到 state='pass'），所以页面画“审阅结论 + 通过”。 */
      expect(text, 'the review requirement reaches the page').toContain('审阅结论');
      const review = findElement(page.root, (element) => hasClass(element, 'step')
        && textOf(element).includes('审阅结论'));
      expect(review, 'the review step row').toBeDefined();
      expect(textOf(review), 'the review requirement state word').toContain('通过');
    } finally {
      await page.restore();
      await review.close();
    }
  }, 300_000);
});
