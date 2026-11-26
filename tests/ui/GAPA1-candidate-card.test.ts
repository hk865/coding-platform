import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionCardV1 } from '../../src/ui/adapters/decide.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { click } from './helpers/E3N-interact.js';
import { bootE3N, callsOf, count, descendants, openedPage, quietPage, textOf } from './helpers/E3N-page.js';
import {
  card, cardButton, factOf, isOff, pinSet, sectionRows, settle, stepConfirm, writeOf,
} from './helpers/E3D-page.js';
import { openIpfCandidate, type IpfCandidate } from './helpers/GAPA1-candidate.js';
import { openOldAnswerWorld } from './helpers/E3D-world.js';

/**
 * GAPA1 1a (frozen card A §1a): the plan candidate's 采用/放弃 on Decide, its
 * stale state, and the same candidate on Main with 放弃 disabled. The stale
 * reason table (T4) lives in the pure file E3D-15-cards-pure.test.ts. The candidate world is IPF's public intervention (Q W1's
 * world); every expected pin is the card's own `source.pins` as the public
 * `decisions/queue` read returns it.
 *
 * Today all three rows are red: `actsOf` gives a candidate card no action, so
 * there is no 采用/放弃, no stale tip and no candidate detail rows.
 *
 * Named mutations (one per row):
 * - T1: drop `adopt` from the candidate's action table → 采用 disappears and
 *   the one `plans/apply` count is 0.
 * - T2: build the abandon pins from every `source.pins` entry → the owner
 *   answers `invalid` (three pins), so the `committed` assertion is red.
 * - T3: skip the reread on `revision_conflict` → `decisions/queue` does not
 *   grow and the card keeps the first failure without the second answer.
 */
const worlds: IpfCandidate[] = [];
afterEach(async () => { for (const entry of worlds.splice(0)) await entry.w.world.close().catch(() => undefined); });

async function bootDecideOn(opened: IpfCandidate) {
  const booted = await bootE3N(opened.w.world, 'Decide', { search: '?goal=' + opened.w.goal.goalId });
  await openedPage(booted.log);
  await settle(() => sectionRows(booted.page.root, '要决定').some((row) => textOf(row).includes('计划候选')), 8_000);
  return booted;
}

function candidateRow(root: Parameters<typeof sectionRows>[0]) {
  return sectionRows(root, '要决定').find((row) => textOf(row).includes('计划候选'));
}

function openFacts(root: Parameters<typeof sectionRows>[0]): void {
  const details = cardButton(root, '详情');
  if (details !== undefined && details.getAttribute('aria-expanded') !== 'true') click(details);
}

const pinsInCardOf = (cardValue: DecisionCardV1): Array<{ ref: { aggregateType?: string }; revision: number }> =>
  cardValue.source.pins as Array<{ ref: { aggregateType?: string }; revision: number }>;

const pinInCardOf = (cardValue: DecisionCardV1, type: string) =>
  pinsInCardOf(cardValue).find((pin) => pin.ref.aggregateType === type);

describe('GAPA1 1a candidate cards', () => {
  it('T1 采用 writes plans/apply with the proposal and Goal pins, then the card leaves 要决定', async () => {
    const opened = await openIpfCandidate('gapa1-t1');
    worlds.push(opened);
    const proposalPin = pinInCardOf(opened.card, 'PlanProposal');
    const goalPin = pinInCardOf(opened.card, 'Goal');
    expect(proposalPin, 'the candidate card carries its PlanProposal pin').toBeDefined();
    expect(goalPin, 'the candidate card carries its Goal pin').toBeDefined();
    const { page, log } = await bootDecideOn(opened);
    try {
      const row = candidateRow(page.root);
      expect(row, 'the candidate row').toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 3_000);
      expect(cardButton(page.root, '采用'), 'the primary action').toBeDefined();
      expect(isOff(cardButton(page.root, '采用'))).toBe(false);
      expect(cardButton(page.root, '放弃'), 'the secondary action').toBeDefined();
      openFacts(page.root);
      await settle(() => factOf(page.root, '理由') !== undefined, 3_000);
      expect(factOf(page.root, '理由')).toBe(opened.reasonText);
      expect(factOf(page.root, '任务')).toContain(opened.taskTitle);
      click(cardButton(page.root, '采用')!);
      await settle(() => callsOf(log, 'plans/apply').some((call) => call.reply !== undefined), 10_000);
      await quietPage(log);
      expect(count(log, 'plans/apply')).toBe(1);
      const sent = writeOf(callsOf(log, 'plans/apply')[0]!);
      expect(sent.input).toEqual({ proposalRef: proposalPin!.ref,
        expectedProposalRevision: proposalPin!.revision, decisionRefs: [] });
      expect(pinSet(sent.meta.expected)).toEqual(pinSet([goalPin]));
      expect((callsOf(log, 'plans/apply')[0]!.reply as { status?: string }).status).toBe('committed');
      const read = await opened.w.world.post('plans/proposal', plain(S6A_SCOPE, proposalPin!.ref)) as
        { body?: { value?: { status?: string } } };
      expect(read.body?.value?.status).toBe('accepted');
      await settle(() => !sectionRows(page.root, '要决定').some((row) => textOf(row).includes('计划候选')), 10_000);
      expect(sectionRows(page.root, '要决定').some((row) => textOf(row).includes('计划候选'))).toBe(false);
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('T2 a withdrawn candidate disables 采用 and 放弃 confirms with exactly the proposal and Goal pins', async () => {
    const opened = await openIpfCandidate('gapa1-t2');
    worlds.push(opened);
    const withdrawn = await opened.w.world.post('messages/withdraw',
      graphWrite(S6A_SCOPE, { messageRef: opened.messageRef }, 'gapa1-t2-withdraw'));
    expect((withdrawn.body as { status?: string }).status).toBe('committed');
    const { page, log } = await bootDecideOn(opened);
    try {
      const row = candidateRow(page.root);
      expect(row, 'the stale candidate row').toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 3_000);
      const adopt = cardButton(page.root, '采用');
      expect(adopt, 'the stale card still draws 采用').toBeDefined();
      expect(isOff(adopt)).toBe(true);
      expect(adopt!.getAttribute('title')).toBe('来源已撤回');
      click(adopt!);
      await quietPage(log);
      expect(count(log, 'plans/apply')).toBe(0);
      click(cardButton(page.root, '放弃')!);
      await settle(() => stepConfirm(page.root) !== undefined, 2_000);
      expect(textOf(card(page.root)!)).toContain('放弃这份候选：卡会关掉，现在的计划不变。要换做法，在主对话里说。');
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'plans/abandon').some((call) => call.reply !== undefined), 10_000);
      await quietPage(log);
      expect(count(log, 'plans/abandon')).toBe(1);
      const sent = writeOf(callsOf(log, 'plans/abandon')[0]!);
      expect(sent.input['proposalRef']).toEqual(pinInCardOf(opened.card, 'PlanProposal')!.ref);
      expect(pinSet(sent.meta.expected)).toEqual(pinSet([
        pinInCardOf(opened.card, 'PlanProposal'), pinInCardOf(opened.card, 'Goal'),
      ]));
      expect(sent.meta.expected).toHaveLength(2);
      expect((callsOf(log, 'plans/abandon')[0]!.reply as { status?: string }).status).toBe('committed');
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('T3 Main adopts the candidate, rerereads on revision_conflict and disables 放弃', async () => {
    const opened = await openOldAnswerWorld();
    try {
      const { page, log } = await bootE3N(opened.world, 'Main', { mode: 'controlled',
        search: '?goal=' + opened.world.goals.first.goalId,
        rejectOnce: { route: 'plans/apply', code: 'revision_conflict', reason: 'GAPA1: the Goal moved once' } });
      try {
        await quietPage(log);
        const line = descendants(page.root).find((element) => hasTextClass(element, 'plan-line')
          && textOf(element).includes('计划候选'));
        expect(line, 'the plan candidate line').toBeDefined();
        const open = descendants(line!).find((element) => element.tagName.toLowerCase() === 'button'
          && textOf(element) === '打开');
        expect(open).toBeDefined();
        click(open!);
        await settle(() => card(page.root) !== undefined, 3_000);
        const abandon = cardButton(page.root, '放弃');
        expect(abandon, 'the Main card still draws 放弃').toBeDefined();
        expect(isOff(abandon)).toBe(true);
        expect(abandon!.getAttribute('title')).toBe('到‘需要你决定’页放弃');
        const queued = count(log, 'decisions/queue');
        click(cardButton(page.root, '采用')!);
        await settle(() => callsOf(log, 'plans/apply').some((call) => call.reply !== undefined), 10_000);
        await quietPage(log);
        expect(count(log, 'decisions/queue')).toBeGreaterThan(queued);
        expect(textOf(card(page.root)!)).toContain('计划刚变过，等页面刷新后再点一次。');
        click(cardButton(page.root, '采用')!);
        await settle(() => callsOf(log, 'plans/apply').filter((call) => call.reply !== undefined).length === 2, 10_000);
        await quietPage(log);
        expect(count(log, 'plans/apply')).toBe(2);
        expect((callsOf(log, 'plans/apply')[1]!.reply as { status?: string }).status).toBe('committed');
        await settle(() => descendants(page.root).every((element) => !hasTextClass(element, 'plan-line')
          || !textOf(element).includes('计划候选')), 10_000);
      } finally {
        await page.restore();
      }
    } finally {
      await opened.world.close();
    }
  }, 240_000);

});

/** A class test that works on the element's own class list (`hasTextClass`). */
function hasTextClass(element: { getAttribute(name: string): string | null }, name: string): boolean {
  return (element.getAttribute('class') ?? '').split(/\s+/).includes(name);
}
