import { describe, expect, it } from 'vitest';
import type { DispatchBasisV1 } from '../../src/contracts/ledger.js';
import type { TaskGraph } from '../../src/contracts/task-graph.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { asRecord, asText } from '../../src/ui/values.js';
import { findButton } from './helpers/boot-page.js';
import {
  bootDecide, card, cardButton, cardFacts, callsOf, factOf, opened, rowName, sectionRows, settle, typeInto, worldTarget,
} from './helpers/E3D-page.js';
import { click } from './helpers/E3N-interact.js';
import { textOf } from './helpers/E3N-page.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openT33, type T33World } from './helpers/E3D-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

/**
 * P2 T33 (frozen `p2-frozen.md:347`, §2.8 action cards): one `action_release` dispatch card and one
 * stop card. Both show the action, Task, requester and reason; the dispatch card adds the Plan version
 * at request time, the current blocker (hold/gate/node occupancy/line busy) and the preferred line; the
 * stop card adds the Run to stop (`frozen.run`) and requires no Plan version or preferred line. Approve
 * and deny answer `action_release` (`src/ui/boot.ts:749`, `:770`), never "消息放行".
 *
 * Today `CARD_KINDS` has no `action_release` (`views/decision-read-model.ts:208`), so both `it`s are red at
 * the first card assertion ("入口还没有"). The world is P1's real held request round (`P1-round-fixture.ts:105`):
 * the dispatch/stop owners are the real `platform.actionRequests` (`tasks/action-requests.ts:284`, `:374`).
 */

function taskIdOf(card: unknown): string {
  return asText(asRecord(asRecord(card)['taskRef'])['taskId']);
}

function actionCardsOf(queue: DecisionQueueReadV1): DecisionQueueReadV1['waitingAnswer'] {
  return queue.waitingAnswer.filter((card) => asText(asRecord(card.source)['kind']) === 'action_release');
}

/** The section row whose opened card carries the given action fact. */
async function rowForAction(
  rows: ReturnType<typeof sectionRows>, action: '派活' | '叫停', root: Parameters<typeof cardFacts>[0],
): Promise<ReturnType<typeof sectionRows>[number] | undefined> {
  for (const row of rows) {
    click(row);
    await settle(() => card(root) !== undefined, 3_000);
    /* The card's facts sit behind its 详情 toggle; open them before reading the action. */
    const open = card(root);
    const more = open === undefined ? undefined : findButton(open, '详情');
    if (more !== undefined) click(more);
    await settle(() => cardFacts(root).length > 0, 3_000);
    if (cardFacts(root).some((fact) => fact.key === '动作' && fact.value === action)) return row;
  }
  return undefined;
}

describe('P2-T33 the action_release dispatch and stop cards', () => {
  it('T33-1 decisions/queue carries one action_release card per request with the frozen fields', async () => {
    const { p1 } = await openT33();
    try {
      const queue = ready<DecisionQueueReadV1>(
        await p1.world.post('decisions/queue', plain(S6A_SCOPE, {
          workspace: S6A_SCOPE, goalRef: p1.goal, sections: ['waiting_answer'], page: { limit: 100 },
        })), 'decisions/queue');
      const cards = actionCardsOf(queue);
      /* The first P2 assertion: two action cards, one per request. Expected tA/tB;
         current [] because only message_release is a registered card source. */
      expect(cards.map(taskIdOf).sort(), 'decisions/queue 的两张 action_release 卡').toEqual(['p1-ta', 'p1-tb']);

      const graph = ready<TaskGraph>(await p1.world.post('tasks/query', plain(S6A_SCOPE, {
        goalRef: p1.goal,
      })), 'tasks/query');
      const basis = ready<DispatchBasisV1>(await p1.world.post('goals/dispatch-basis', plain(S6A_SCOPE, {
        goalRef: p1.goal,
      })), 'goals/dispatch-basis');
      expect(basis.planRevision).not.toBeNull();

      const dispatch = cards.find((card) => taskIdOf(card) === 'p1-ta');
      expect(dispatch, 'the dispatch card').toBeDefined();
      if (dispatch === undefined) throw new Error('P2-T33: no dispatch card');
      expect(asText(asRecord(dispatch.source)['kind'])).toBe('action_release');
      /* 请求时的计划版本: the dispatch basis on the card's action view, not a decision-source pin. */
      expect(asRecord(asRecord(dispatch)['actionRelease'])['planVersion'])
        .toMatchObject({ planRevision: basis.planRevision });
      /* 谁要 / 理由 / 当前阻塞 / 首选线. */
      expect(JSON.stringify(dispatch)).toContain('P2 T33 dispatch');
      expect(JSON.stringify(dispatch)).toContain('P2 T33 hold');
      expect(JSON.stringify(dispatch)).toContain('claim_hold');
      expect(JSON.stringify(dispatch)).toContain(p1.lines.E.ref.sessionId);
      /* 谁要: the asking line's Session (P2's action card carries its requester). */
      expect(JSON.stringify(dispatch)).toContain(p1.lines.A.ref.sessionId);
      expect(JSON.stringify(dispatch)).not.toContain('消息放行');

      const stop = cards.find((card) => taskIdOf(card) === 'p1-tb');
      expect(stop, 'the stop card').toBeDefined();
      if (stop === undefined) throw new Error('P2-T33: no stop card');
      const runB = p1.runB;
      expect(runB, 'the running tB Run').not.toBeNull();
      if (runB !== null) expect(asRecord(stop.runRef)['runId']).toBe(runB.runId);
      expect(JSON.stringify(stop)).toContain('P2 T33 stop');
      expect(JSON.stringify(stop)).toContain(p1.lines.S.ref.sessionId);
      /* 叫停不要求计划版本/首选线, and it is answerable. */
      expect(asRecord(stop)['preferredLine'] ?? null).toBeNull();
      expect(stop.readOnly).toBe(false);
      expect(stop.options.map((option) => asText(asRecord(option)['id']))).toEqual(
        expect.arrayContaining(['approve', 'deny']));
    } finally {
      await p1.close();
    }
  }, 180_000);

  it('T33-2 approve on the stop card answers action_release, never 消息放行', async () => {
    const { p1 } = await openT33();
    const booted = await bootDecide(worldTarget(p1.world));
    try {
      await opened(booted.log);
      const rows = sectionRows(booted.page.root, '要决定');
      /* The two action rows, not the old message-release row. The row label is the generic
         card kind; the action itself is a card fact, so find it by opening the row. */
      expect(rows.length, 'the two action rows').toBeGreaterThanOrEqual(2);
      const names = rows.map((row) => rowName(row));
      expect(names.filter((name) => name.includes('放行请求')).length, 'two 放行请求 rows').toBeGreaterThanOrEqual(2);
      expect(names).not.toContain('消息放行');

      const actionRows = rows.filter((row) => rowName(row).includes('放行请求'));
      const stopRow = await rowForAction(actionRows, '叫停', booted.page.root);
      expect(stopRow, 'the 叫停 row').toBeDefined();
      if (stopRow === undefined) throw new Error('P2-T33: no 叫停 row');
      const shown = card(booted.page.root);
      expect(shown, 'the stop card').toBeDefined();
      if (shown === undefined) throw new Error('P2-T33: the stop card did not open');

      const approve = findButton(shown, '批准');
      expect(approve, 'the 批准 button').toBeDefined();
      if (approve !== undefined) {
        click(approve);
        await settle(() => findButton(shown, '确定') !== undefined, 1_000);
        const confirm = findButton(shown, '确定');
        expect(confirm, 'the 确定 button').toBeDefined();
        if (confirm !== undefined) click(confirm);
        await settle(() => callsOf(booted.log, 'decisions/answer')
          .some((call) => call.reply !== undefined), 3_000);
      }
      const answer = callsOf(booted.log, 'decisions/answer').at(-1);
      expect(answer, 'decisions/answer').toBeDefined();
      if (answer !== undefined) {
        const input = asRecord(answer.input);
        expect(asText(asRecord(input['source'])['kind'])).toBe('action_release');
        expect(asRecord(input['selection'])['optionId']).toBe('approve');
        expect(JSON.stringify(answer)).not.toContain('message_release');
      }
    } finally {
      await booted.page.restore();
      await p1.close();
    }
  }, 180_000);

  /* Lead 11-25: Decide's 确定 reads the same needsOption as the main card; a
     release card is one the server refuses a text-only answer for. */
  it('T33-4 words alone leave 确定 grey on a release card until an option is picked', async () => {
    const { p1 } = await openT33();
    const booted = await bootDecide(worldTarget(p1.world));
    try {
      await opened(booted.log);
      const row = sectionRows(booted.page.root, '要决定').find((entry) => rowName(entry).includes('放行请求'));
      expect(row, 'a 放行请求 row').toBeDefined();
      click(row!);
      await settle(() => cardButton(booted.page.root, '批准') !== undefined, 3_000);
      typeInto(booted.page.root, 'dc-answer', '先别派');
      await settle(() => card(booted.page.root) !== undefined, 1_000);
      expect(cardButton(booted.page.root, '确定')!.getAttribute('aria-disabled')).toBe('true');
      click(cardButton(booted.page.root, '批准')!);
      await settle(() => cardButton(booted.page.root, '确定')?.getAttribute('aria-disabled') === 'false', 2_000);
      expect(cardButton(booted.page.root, '确定')!.getAttribute('aria-disabled')).toBe('false');
    } finally {
      await booted.page.restore();
      await p1.close();
    }
  }, 180_000);

  it('T33-3 the dispatch card shows the frozen fields and 拒绝 answers action_release', async () => {
    const { p1 } = await openT33();
    const booted = await bootDecide(worldTarget(p1.world));
    try {
      await opened(booted.log);
      const rows = sectionRows(booted.page.root, '要决定');
      /* The action_release 派活 row, found by the action fact on the opened card. */
      const actionRows = rows.filter((row) => rowName(row).includes('放行请求'));
      const dispatchRow = await rowForAction(actionRows, '派活', booted.page.root);
      expect(dispatchRow, 'the 派活 row').toBeDefined();
      if (dispatchRow === undefined) throw new Error('P2-T33: no 派活 row');
      await settle(() => cardFacts(booted.page.root).length > 0);
      const shown = card(booted.page.root);
      expect(shown, 'the dispatch card').toBeDefined();
      if (shown === undefined) throw new Error('P2-T33: the dispatch card did not open');

      const graph = ready<TaskGraph>(await p1.world.post('tasks/query', plain(S6A_SCOPE, {
        goalRef: p1.goal,
      })), 'tasks/query');
      const row = graph.tasks.find((task) => task.ref.taskId === 'p1-ta');
      const title = row === undefined ? '' : asText(asRecord(row.definition)['title']);
      expect(title, 'the tA Task title').not.toBe('');
      const basis = ready<DispatchBasisV1>(await p1.world.post('goals/dispatch-basis', plain(S6A_SCOPE, {
        goalRef: p1.goal,
      })), 'goals/dispatch-basis');

      /* 动作、任务、谁要、理由; 派活另读请求时计划版本、当前阻塞、首选线. Values are the frozen ones. */
      const text = [textOf(shown), ...cardFacts(booted.page.root).map((fact) => `${fact.key} ${fact.value}`)]
        .join(' ');
      expect(text, '动作').toContain('派活');
      expect(text, '任务').toContain(title);
      expect(text, '理由').toContain('P2 T33 dispatch');
      /* The card resolves the asking line and the preferred line to their names; the ids are
         not printed, so assert the frozen facts through the rendered words. */
      expect(factOf(booted.page.root, '谁要'), '谁要').toBe('参谋');
      expect(text, '当前阻塞').toContain('P2 T33 hold');
      expect(factOf(booted.page.root, '首选线'), '首选线').toBe('Independent work p1-tb');
      if (basis.planRevision !== null) expect(text, '请求时计划版本').toContain(String(basis.planRevision));

      const deny = findButton(shown, '拒绝');
      expect(deny, 'the 拒绝 button').toBeDefined();
      if (deny !== undefined) {
        click(deny);
        await settle(() => findButton(shown, '确定') !== undefined, 1_000);
        const confirm = findButton(shown, '确定');
        expect(confirm, 'the 确定 button').toBeDefined();
        if (confirm !== undefined) click(confirm);
        await settle(() => callsOf(booted.log, 'decisions/answer')
          .some((call) => call.reply !== undefined), 5_000);
      }
      const answer = callsOf(booted.log, 'decisions/answer').at(-1);
      expect(answer, 'decisions/answer').toBeDefined();
      if (answer !== undefined) {
        const input = asRecord(answer.input);
        expect(asText(asRecord(input['source'])['kind'])).toBe('action_release');
        expect(asRecord(input['selection'])['optionId']).toBe('deny');
        expect(JSON.stringify(answer)).not.toContain('message_release');
        expect(JSON.stringify(answer)).not.toContain('消息放行');
      }
    } finally {
      await booted.page.restore();
      await p1.close();
    }
  });
});
