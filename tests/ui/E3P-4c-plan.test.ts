import { afterEach, describe, expect, it } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { planNoticeTextOf } from '../../src/ui/adapters/plan.js';
import { findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, descendants, hasClass, quietPage, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { answerOf, goalCard, goalCardValue, headOf, lineText, openPAW2, planCard, planLines, planReady } from './helpers/E3P-world.js';
import { cancelGoal } from './helpers/E3N-world.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { openS7BPlanningWorld } from '../helpers/S7B3-planning-world.js';
import { completeS7BGoal, interveneS7B, s7bVWorkProfile } from '../helpers/S7B-V-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import {
  openPLDeviationConsumptionWorld, runSoftLineDeviationPair,
} from '../helpers/PL-deviation-fixture.js';
import { FakeElement } from './helpers/dom.js';

/**
 * 7D2 CU4C: the Plan page's candidate facts and stale reason, the stopping
 * adoption that retries itself, a request opened from a completed Goal, and
 * the Goal's plan notices. Rows ⑥/⑦ (the gap row and the stop card's
 * "让秘书补检查") live in E3N-CU6-taskmap-running.test.ts.
 */

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

/** The plan card's `opt-kv` rows of the selected option. */
function optFacts(card: FakeElement): Record<string, string> {
  const list = findClass(card, 'opt-kv');
  const out: Record<string, string> = {};
  if (list === undefined) return out;
  let key = '';
  for (const child of descendants(list)) {
    if (child.tagName.toLowerCase() === 'dt') key = textOf(child);
    else if (child.tagName.toLowerCase() === 'dd' && key !== '') out[key] = textOf(child);
  }
  return out;
}

/** The goal card's foot note. */
function goalNote(root: FakeElement): string {
  const foot = findClass(goalCard(root)!, 'plan-foot');
  return textOf(findClass(foot!, 'note'));
}

describe('E3P 4c Plan candidate facts', () => {
  it('① the selected candidate reads decisions/candidate-card once and shows its check gaps', async () => {
    const w = await openPAW2({ reviewer: true });
    worlds.push(w.world);
    const { page, log } = await bootE3N(w.world, 'Plan', { search: '?goal=ag2b-goal' });
    try {
      await planReady(log);
      const reads = callsTo(log, 'decisions/candidate-card');
      const requests = callsTo(log, 'plans/request-candidate');
      /* 具名改坏: 读候选详情时用页面上的 proposalRef 副本；这一句红。 */
      expect(reads.length).toBe(requests.length);
      for (let index = 0; index < requests.length; index += 1) {
        const reply = requests[index]!.reply as { value: { head: { ref: unknown } } };
        expect((reads[index]!.input as Record<string, unknown>)['proposalRef']).toEqual(reply.value.head.ref);
      }
      const facts = optFacts(planCard(page.root)!);
      /* 具名改坏: `hasKv` 恒 false；这两句红。 */
      expect(facts['检查缺口']).toBeDefined();
      expect(facts['检查缺口']).not.toBe('');
      /* `not_sent` draws no 审阅 row; the export is not configured and the
         first plan has no standard change. */
      expect(facts['审阅']).toBeUndefined();
      expect(facts['任务书']).toBeUndefined();
      expect(facts['降标']).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('② a candidate whose base is no longer the active Plan says why, and its 采用 sends nothing', async () => {
    const w = await openPAW2({ reviewer: true });
    worlds.push(w.world);
    const { page, log } = await bootE3N(w.world, 'Plan', { search: '?goal=ag2b-goal' });
    try {
      await planReady(log);
      const goal = ready<{ goal: { revision: number; activePlanRevision: { planId: string; revision: number } | null } }>(
        await w.world.post('goals/read', plain(S6A_SCOPE, S6A_GOAL_1)), 'the Goal read').goal;
      const head = ready<{ head: { ref: unknown; revision: number; draft: Record<string, unknown> } | null }>(
        await w.world.post('plans/request-candidate', plain(S6A_SCOPE, { goalRef: S6A_GOAL_1, requestRef: w.requestRoot })),
        'the request candidate').head!;
      const proposed = (await w.world.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: S6A_GOAL_1, basedOn: goal.activePlanRevision,
        draft: { ...head.draft, planId: 'pa-other-plan' }, reason: { text: 'PA other version', sources: [] },
      }, 'pa-other-propose', [{ ref: S6A_GOAL_1, revision: goal.revision }]))).body as
        { status: string; value: { ref: unknown; revision: number } };
      expect(proposed.status).toBe('committed');
      const applied = await w.world.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
      }, 'pa-other-apply', [{ ref: S6A_GOAL_1, revision: goal.revision }]));
      expect((applied.body as { status?: string }).status).toBe('committed');
      /* The change stream rereads the page; the candidate is now stale. */
      await waitFor(() => headOf(planCard(page.root), 'st') === '计划已经变了，这份候选不能直接采用');
      const card = planCard(page.root)!;
      const foot = findClass(card, 'plan-foot');
      /* 具名改坏: 过期时底栏按 `live` 收起；这一句红。 */
      expect(foot).toBeDefined();
      const adopt = findButton(foot!, '采用方案');
      expect(adopt).toBeDefined();
      /* 具名改坏: 过期按钮仍可点（`adoptOff` 用 `live` 之外的值）；这两句红。 */
      expect(adopt!.getAttribute('aria-disabled')).toBe('true');
      expect(adopt!.getAttribute('title')).toBe('计划已经变了，这份候选不能直接采用');
      const before = countRoute(log, 'plans/apply');
      click(adopt!);
      await quietPage(log);
      expect(countRoute(log, 'plans/apply')).toBe(before);
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('③ a stopping adoption rereads, then adopts again by itself with a new request id', async () => {
    const w = await openPAW2();
    worlds.push(w.world);
    let seen = 0;
    let root: FakeElement | null = null;
    let secondHeld = false;
    let releaseSecond: () => void = () => undefined;
    const holdSecond = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const { page, log } = await bootE3N(w.world, 'Plan', {
      search: '?goal=ag2b-goal',
      rejectOnce: { route: 'plans/apply', code: 'busy', reason: 'stopping_affected_work' },
      before: {
        'plans/apply': async () => {
          seen += 1;
          if (seen !== 2) return;
          /* The footnote is on the page before the second call goes out; hold
             the call so a click on the repainted card is observed. */
          await waitFor(() => {
            const foot = root === null ? undefined : findClass(planCard(root)!, 'plan-foot');
            return foot !== undefined && textOf(findClass(foot, 'note')).includes('采用中：受影响的执行已经停下，正在再采用一次。');
          });
          secondHeld = true;
          await holdSecond;
        },
      },
    });
    root = page.root;
    try {
      await planReady(log);
      click(findButton(findClass(planCard(page.root)!, 'plan-foot')!, '采用方案')!);
      await waitFor(() => secondHeld);
      const before = seen;
      try {
        click(findButton(findClass(planCard(page.root)!, 'plan-foot')!, '采用方案')!);
        await quietPage(log);
        /* 具名改坏: 采用中仍可点 (`adopt` 不是 `nc`)；这一句红。 */
        expect(seen).toBe(before);
      } finally {
        releaseSecond();
      }
      await waitFor(() => callsTo(log, 'plans/apply').filter((call) => call.reply !== undefined).length >= 2);
      const sent = callsTo(log, 'plans/apply');
      /* 具名改坏: 自动再采用沿用第一次的 requestId；这一句红。 */
      expect(sent.length).toBe(2);
      const first = sent[0]!.body as { request: { meta: { requestId: string }; input: unknown } };
      const second = sent[1]!.body as { request: { meta: { requestId: string }; input: unknown } };
      expect(second.request.meta.requestId).not.toBe(first.request.meta.requestId);
      expect(second.request.input).toEqual(first.request.input);
      expect((sent[0]!.reply as Record<string, unknown>)['code']).toBe('busy');
      expect((sent[1]!.reply as Record<string, unknown>)['status']).toBe('committed');
      await waitFor(() => planLines(page.root).length === 2);
      await quietPage(log);
      expect(countRoute(log, 'plans/apply')).toBe(2);
      expect(planLines(page.root).map(lineText)).toEqual([
        '第 2 版 · PA version two', '第 1 版 · PA version one',
      ]);
    } finally {
      await page.restore();
    }
  }, 300_000);
});

describe('E3P 4c completed Goal and plan notices', () => {
  it('④ a request opened from a completed Goal says what confirming it means', async () => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    const { world, goalRef, sessionRef } = planning;
    await completeS7BGoal(planning);
    await cancelGoal(world, planning.noPlanGoalRef);
    const message = await sendS7A2PersonMessage(world, { label: 'p4c', recipient: sessionRef.ref, goal: goalRef });
    const asked = await interveneS7B(world, message.ref, s7bVWorkProfile());
    expect(asked).toMatchObject({ status: 'requested', branch: 'goal_completed' });
    const requestRef = (asked as { requestRef: QueryJobRef }).requestRef;
    const secretary = await world.createSecretary('p4c-secretary');
    expect(await world.route({ commandId: 'p4c-route', round: requestRef, to: secretary })).toMatchObject({ status: 'routed' });
    expect(await claimWithSecretaryProfile(world, requestRef, secretary, 'p4c-claim')).toMatchObject({ status: 'committed' });
    const prepared = await prepareAttempt(world, requestRef, 'p4c-prepare');
    await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: 'P4C answer',
      goalCardDrafts: [{ objective: 'P4C new Goal', completion: ['P4C done'], autonomy: 'after_plan_confirmation',
        screening: null }] }) }]);
    expect(await start(world, prepared, 'p4c-start')).toMatchObject({ status: 'ready' });
    const { page, log } = await bootE3N(world, 'Plan');
    try {
      await planReady(log);
      await waitFor(() => goalCard(page.root) !== undefined);
      /* 具名改坏: 目标卡底栏仍写死默认句；这一句红。 */
      expect(goalNote(page.root)).toBe('这是加在已完成的目标 1「S6A goal one」上的工作，要确认成一个接续的新目标；'
        + '原目标的完成不变。确认后秘书出方案；方案采用前不改项目代码。');
      expect(goalCardValue(goalCard(page.root)!, '目标')).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('⑤ the Plan tail lists the Goal’s deviation notice without machine prefixes', async () => {
    const fixture = await openPLDeviationConsumptionWorld({
      label: 'p4c5', taskIds: ['p4c5-a'], write: true, checks: true,
      sizes: [{ taskId: 'p4c5-a', sizeClass: 'small', estimatedLines: 10 }],
    });
    worlds.push(fixture.world);
    const task = fixture.tasks[0]!;
    await runSoftLineDeviationPair(fixture, {
      taskId: task.taskId, flowId: 'p4c5-a1', path: 'p4c5-lines.txt', prefix: 'P4C5',
    });
    const { page, log } = await bootE3N(fixture.world, 'Plan', { search: '?goal=' + fixture.goal.goalId });
    try {
      await planReady(log);
      await waitFor(() => findAllClass(page.root, 'sys-line')
        .filter((element) => textOf(element).startsWith('偏差：')).length === 2);
      const lines = findAllClass(page.root, 'sys-line')
        .filter((element) => textOf(element).startsWith('偏差：')).map((element) => textOf(element));
      /* 具名改坏: 原样上屏 `summary`；这两句红。 */
      for (const line of lines) {
        expect(line).toContain('21 行');
        expect(line).toContain('2100000');
      }
      const text = textOf(page.root);
      /* The adviser's own answer is the person's words and may repeat the
         fixture's `growth:`/`lines:`; the reading before 参谋不改计划 must not. */
      for (const line of lines) {
        const reading = line.slice(0, line.indexOf('；参谋不改计划：'));
        for (const prefix of ['growth:', 'lines:', 'usage:']) expect(reading).not.toContain(prefix);
      }
      for (const prefix of ['role-lines/open', 'duty:']) expect(text).not.toContain(prefix);
      /* The two lines came from the already-read `main/read`; no second notice read. */
      expect(countRoute(log, 'main/read')).toBeGreaterThan(0);
    } finally {
      await page.restore();
    }
  }, 300_000);
});

/**
 * P4: the deviation summary is a machine record, so the page reads its token,
 * growth and line figures and writes them without the English reading. The
 * summaries below keep the server's shape: `growth` ends the line and `lines`
 * starts the next one.
 */
const deviationNotices = [
  {
    name: 'complete',
    summary: 'usage: 1200000; growth: 1200000\nlines: 12 (added 12, deleted 0) · 参谋不改计划 · 这一版不改计划',
    expected: '偏差：用量 1200000 token，增长 1200000 token，改了 12 行（新增 12、删除 0）；参谋不改计划：这一版不改计划',
  },
  {
    name: 'incomplete',
    summary: 'usage: at least 900000, incomplete; growth: at least 700000, incomplete\n'
      + 'lines: at least 40 (added 30, deleted 10), incomplete · 参谋不改计划 · 读数不全，先不改计划',
    expected: '偏差：用量 至少 900000 token（不全），增长 至少 700000 token（不全），'
      + '改了 至少 40 行（新增 30、删除 10），不全；参谋不改计划：读数不全，先不改计划',
  },
  {
    name: 'unknown growth',
    summary: 'usage: 1200000; growth: unknown\nlines: 12 (added 12, deleted 0) · 参谋不改计划 · 增长没读到',
    expected: '偏差：用量 1200000 token，增长 未知，改了 12 行（新增 12、删除 0）；参谋不改计划：增长没读到',
  },
] as const;

describe('E3P 4c plan notice readings', () => {
  it.each(deviationNotices)('the deviation notice reads $name in the page’s words', ({ summary, expected }) => {
    expect(planNoticeTextOf(summary)).toBe(expected);
  });
});
