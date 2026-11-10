import { afterEach, describe, expect, it } from 'vitest';
import { asRecord } from '../../src/ui/values.js';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { findClass } from './helpers/boot-page.js';
import { bootChain, groupHeads, seedChainChecks, stepRows } from './helpers/E3C-world.js';
import { callsOf, memberSearch, worldSlot } from './helpers/E3M-world.js';
import { click } from './helpers/E3N-interact.js';
import { descendants, hasClass, sleep, textOf } from './helpers/E3N-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3C-6 (test sheet §2.2, E3C-14/15; wiring C8): the two formal check rounds
 * on one Run — `chain-lint` passes both times, `chain-unit` fails the first
 * round and passes the second after its file is written and the person's
 * `verification/reverify` opens the successor round (§1.2). The group heads
 * and the check rows come from `verification/round`, read per round.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);
const twoRounds = async (key: string) => {
  const s7c = await slot.use(key, () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());
  const checks = await seedChainChecks(s7c, 2);
  return { s7c, checks };
};

const roundHead = (root: FakeElement, ordinal: number): FakeElement | undefined => groupHeads(root, `正式检查 · 第 ${ordinal} 轮`)[0];
const roundGroup = (root: FakeElement, ordinal: number): FakeElement | undefined =>
  descendants(findClass(root, 'thread') ?? root).find((element) => hasClass(element, 'grp')
    && textOf(element).includes(`正式检查 · 第 ${ordinal} 轮`));

/** Open a round's group and its folded passing rows (the prototype's 其余 n 项通过), the reading's preconditions. */
async function openRound(root: FakeElement, ordinal: number): Promise<void> {
  const head = roundHead(root, ordinal);
  if (head !== undefined && head.getAttribute('aria-expanded') !== 'true') click(head);
  await sleep(100);
  const rest = descendants(roundGroup(root, ordinal) ?? root).find((element) => element.tagName.toLowerCase() === 'button'
    && /^(其余 \d+ 项通过|\d+ 项全部通过)$/.test(textOf(findClass(element, 'step-verb'))));
  if (rest !== undefined) click(rest);
  await sleep(100);
}

/** checkId → the row's outcome words (`.step-obj`) in one round's group. */
function checkRows(root: FakeElement, ordinal: number): Record<string, string> {
  return Object.fromEntries(stepRows(roundGroup(root, ordinal))
    .map((step) => [textOf(findClass(step, 'step-verb')), textOf(findClass(step, 'step-obj'))]));
}

describe('E3C-6 the formal check rounds', () => {
  it('E3C-14 the two round heads: 未通过 1/2, then 通过 2/2 (C8)', async () => {
    const { s7c } = await twoRounds('E3C-14');
    const { page } = await bootChain(s7c.world, memberSearch('s7c-goal', s7c.lines.module.ref));
    try {
      const first = roundHead(page.root, 1);
      expect(first, 'the round 1 head').toBeDefined();
      expect(textOf(findClass(first!, 'w'))).toBe('未通过');
      /* Hand count: round 1 has 2 checks, chain-lint PASS and chain-unit FAIL.
         具名改坏: 组尾写成 checks.length + '/' + checks.length；第一轮的 2/2 让本行的 1/2 红。 */
      expect(textOf(findClass(first!, 'tail'))).toContain('1/2');
      const second = roundHead(page.root, 2);
      expect(second, 'the round 2 head').toBeDefined();
      expect(textOf(findClass(second!, 'w'))).toBe('通过');
      expect(textOf(findClass(second!, 'tail'))).toContain('2/2');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('E3C-15 each round’s two checks and their words; the subject read comes before the per-round reads (C8)', async () => {
    const { s7c, checks } = await twoRounds('E3C-15');
    const { page, log } = await bootChain(s7c.world, memberSearch('s7c-goal', s7c.lines.module.ref));
    try {
      await openRound(page.root, 1);
      const first = checkRows(page.root, 1);
      /* The check row's verb is its configured command (§2.8): chain-lint is the passing one. */
      const pass = first['node -e "process.exit(0)"'] ?? '';
      expect(pass).toContain('通过');
      expect(pass).not.toContain('未通过');
      /* 具名改坏: 把 FAIL 映射成 `通过`；本行的 `未通过` 红。
         (`verification/round` gives chain-unit `reason: null` in this world, so no reason text is asserted; reply §1.) */
      expect(first['test -f chain-unit.pass'] ?? '').toContain('未通过');
      await openRound(page.root, 2);
      const second = checkRows(page.root, 2);
      for (const command of ['node -e "process.exit(0)"', 'test -f chain-unit.pass']) {
        expect(second[command] ?? '').toContain('通过');
        expect(second[command] ?? '').not.toContain('未通过');
      }
      const inputs = callsOf(log, 'verification/round').map((call) => asRecord(call.input));
      const subjectAt = inputs.findIndex((input) => asRecord(input['subjectRunRef'])['runId'] === checks.firstRun.runId);
      const roundAt = inputs.findIndex((input) => input['roundRef'] !== undefined);
      expect(subjectAt).toBeGreaterThanOrEqual(0);
      expect(roundAt).toBeGreaterThan(subjectAt);
      const rounds = inputs.map((input) => input['roundRef']).filter((ref) => ref !== undefined);
      expect(rounds).toEqual(expect.arrayContaining([checks.firstRound.ref, checks.secondRound!.ref]));
    } finally {
      await page.restore();
    }
  }, 180_000);
});
