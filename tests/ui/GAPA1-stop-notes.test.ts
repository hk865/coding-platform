import { afterAll, describe, expect, it } from 'vitest';
import { findElement } from './helpers/boot-page.js';
import { click } from './helpers/E3N-interact.js';
import { descendants, quietPage, textOf } from './helpers/E3N-page.js';
import {
  bootDecide, callsOf, card, cardButton, composer, count, hostTarget, openCardWith, opened, quiet, settle, stepConfirm,
  typeInto, writeOf,
} from './helpers/E3D-page.js';
import { openCapWorld, openInterruptedWorld, openReverifyWorld } from './helpers/E3D-world.js';
import { cleanupScenarios, type HostScenario } from '../scenarios/harness.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, plain } from '../helpers/AG2b-collaboration-fixture.js';

/**
 * GAPA1 1b (frozen card A §1b, 121-171): the stop card's explanation box. The
 * box's words follow the action the person presses into that step's own field
 * and never go through `decisions/answer`; a button that sends nothing says so;
 * words alone only prefill the question composer.
 *
 * Today all five rows are red: `hasAnswerBox` excludes `goal_cause`, so there is
 * no `dc-answer` on these cards and no prefilled `dc-note`/`dc-reason`.
 *
 * Named mutations (one per row):
 * - T5: copy the box into the note step but drop it from the write input →
 *   `verification/reverify` carries no `note`.
 * - T6: keep the fixed `reason.text` (延后任务) after the words are typed →
 *   the `plans/propose` text assertion is red.
 * - T6b: append the words to `reason.text` only, not to the repair
 *   `instruction` → the assignment assertion is red.
 * - T7: send the box words with the Goal-level continue → the body contains the
 *   sentence and D24's zero count is red.
 * - T8: answer the card with the box's text when 问秘书 is pressed → the
 *   `decisions/answer` count is 1 and the draft is empty.
 */
const scenarios = new Map<string, HostScenario>();
afterAll(async () => { await cleanupScenarios(); });

async function scenario(name: string, open: () => Promise<HostScenario>): Promise<HostScenario> {
  const found = scenarios.get(name);
  if (found !== undefined) return found;
  const made = await open();
  scenarios.set(name, made);
  return made;
}

const fieldValue = (root: Parameters<typeof findElement>[0], id: string): string =>
  findElement(root, (element) => element.getAttribute('id') === id)?.value ?? '';

describe('GAPA1 1b stop-card explanation box', () => {
  it('T5 附上说明 carries the box words into dc-note and the reverify note, never an answer', async () => {
    const h = await scenario('reverify', openReverifyWorld);
    const words = '报告改到 reports/';
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const note = await openCardWith(page.root, '附上说明作为新依据');
      expect(note, 'the no_new_basis card').toBeDefined();
      expect(findElement(page.root, (element) => element.getAttribute('id') === 'dc-answer'),
        'the stop card has the explanation box').toBeDefined();
      typeInto(page.root, 'dc-answer', words);
      click(note!);
      await settle(() => stepConfirm(page.root) !== undefined, 2_000);
      expect(fieldValue(page.root, 'dc-note')).toBe(words);
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'verification/reverify').some((call) => call.reply !== undefined), 8_000);
      await quiet(log);
      expect(count(log, 'verification/reverify')).toBe(1);
      expect(writeOf(callsOf(log, 'verification/reverify')[0]!).input['note']).toBe(words);
      expect(count(log, 'decisions/answer')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T6 延后任务 prefills dc-reason and writes the words as the plan change reason', async () => {
    const h = await scenario('cap-defer', openCapWorld);
    const words = '等上游接口定了再做';
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const defer = await openCardWith(page.root, '延后任务');
      expect(defer, 'the cap card').toBeDefined();
      typeInto(page.root, 'dc-answer', words);
      click(defer!);
      await settle(() => stepConfirm(page.root) !== undefined, 2_000);
      expect(fieldValue(page.root, 'dc-reason')).toBe(words);
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'plans/propose').some((call) => call.reply !== undefined), 10_000);
      await quiet(log);
      expect(count(log, 'plans/propose')).toBe(1);
      const sent = writeOf(callsOf(log, 'plans/propose')[0]!).input as { reason?: { text?: string } };
      expect(sent.reason?.text).toBe(words);
      expect(count(log, 'decisions/answer')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T6b 添加修复任务 appends the words to the repair instruction and its reason', async () => {
    const h = await scenario('cap-fix', openCapWorld);
    const words = '先看 lint 配置';
    const name = '修 lint 配置';
    const plan = await h.answer('tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF })) as
      { value?: { plan?: { tasks?: Array<Record<string, unknown>> } } };
    const known = new Set((plan.value?.plan?.tasks ?? []).map((task) => task['taskId']));
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const fix = await openCardWith(page.root, '添加修复任务');
      expect(fix, 'the cap card').toBeDefined();
      typeInto(page.root, 'dc-answer', words);
      click(fix!);
      await settle(() => stepConfirm(page.root) !== undefined, 2_000);
      expect(fieldValue(page.root, 'dc-reason')).toBe(words);
      typeInto(page.root, 'dc-name', name);
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'plans/propose').some((call) => call.reply !== undefined), 10_000);
      await quiet(log);
      expect(count(log, 'plans/propose')).toBe(1);
      const sent = writeOf(callsOf(log, 'plans/propose')[0]!).input as {
        draft?: { tasks?: Array<Record<string, unknown>>;
          assignments?: Array<{ taskId: string; instruction?: string }> };
        reason?: { text?: string };
      };
      const added = (sent.draft?.tasks ?? []).filter((task) => !known.has(String(task['taskId'])));
      expect(added).toHaveLength(1);
      const fixId = String(added[0]!['taskId']);
      const assignment = (sent.draft?.assignments ?? []).find((entry) => entry.taskId === fixId);
      expect(assignment?.instruction).toBeDefined();
      expect(assignment!.instruction!.endsWith('。' + words)).toBe(true);
      expect(sent.reason?.text).toBe(assignment!.instruction);
      expect(count(log, 'decisions/answer')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T7 the Goal-level 继续 does not send the box words and the hint names it', async () => {
    const h = await scenario('interrupted', openInterruptedWorld);
    const words = '先把接口那件事做完';
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const resume = await openCardWith(page.root, '继续');
      expect(resume, 'the interruption card').toBeDefined();
      expect(textOf(card(page.root)!)).toContain('‘继续’不带它');
      typeInto(page.root, 'dc-answer', words);
      click(resume!);
      if (await settle(() => stepConfirm(page.root) !== undefined, 800)) click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'workflow/driver-start').some((call) => call.reply !== undefined), 8_000);
      await quiet(log);
      expect(count(log, 'workflow/driver-start')).toBe(1);
      expect(JSON.stringify(callsOf(log, 'workflow/driver-start')[0]!.body)).not.toContain(words);
      expect(count(log, 'tasks/requeue')).toBe(0);
      expect(count(log, 'decisions/answer')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T8 words alone prefill the composer and send nothing', async () => {
    const h = await scenario('reverify-t8', openReverifyWorld);
    const words = '先别动检查配置，等我看一下';
    const { page, log } = await bootDecide(hostTarget(h));
    try {
      await opened(log);
      const note = await openCardWith(page.root, '附上说明作为新依据');
      expect(note, 'the no_new_basis card').toBeDefined();
      typeInto(page.root, 'dc-answer', words);
      click(cardButton(page.root, '问秘书')!);
      await settle(() => composer(page.root) !== undefined, 2_000);
      expect(composer(page.root)?.value).toBe(words);
      await quiet(log);
      for (const route of ['decisions/answer', 'verification/reverify', 'tasks/requeue', 'plans/propose']) {
        expect(count(log, route), route).toBe(0);
      }
      expect(descendants(page.root).some((element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-label') === '发送')).toBe(true);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
