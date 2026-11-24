import { afterAll, describe, expect, it } from 'vitest';
import { findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import { callsTo, descendants, lineRows, onMain, sleep, textOf, waitFor, type PageLog } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { lineOrder } from './helpers/E3N-world.js';
import { runRows } from './helpers/E3U-run-steps-page.js';
import type { FakeElement } from './helpers/dom.js';
import { openStuckRunWorld, type StuckRunWorld } from './helpers/E3U-stuck-run-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { RunStepsReadV1 } from '../../src/contracts/run-steps.js';

/**
 * E3U 1A row ③ (ui-batches 156): a live Run block on Main's line view is
 * re-read from `runningFrom - 1` while it stays open. The world is the SHT-2
 * stuck-shell recipe: a real Host, one Work Run whose first `shell` command
 * loops until released, its own start marker, and the clock past 10 minutes.
 * The page boots Main on the executor's line, selects 详细 so the block
 * opens, reads `executions/steps` once (`after:null`), then its one 5 s timer
 * must send the follow-up with `after === runningFrom - 1`.
 *
 * Only the test-runner clock bounds the waits: the world fakes `Date` alone,
 * so no `Date.now()` deadline can advance here.
 */

const LABEL = 'e3u-row3-live';
let stuck: StuckRunWorld | undefined;
afterAll(async () => { await stuck?.close(); }, 180_000);

function stepsOf(reply: unknown): Extract<RunStepsReadV1, { kind: 'steps' }> {
  const read = reply as { status?: string; value?: RunStepsReadV1 };
  if (read.status !== 'ready' || read.value?.kind !== 'steps') {
    throw new Error(`E3U row ③: executions/steps did not answer steps: ${JSON.stringify(reply)}`);
  }
  return read.value;
}

/** The rail button of `lines/list` row `index` (after the synthetic 秘书（主对话） row). */
function railButton(root: FakeElement, index: number): FakeElement | undefined {
  const holder = lineRows(root)[index + 1];
  return holder === undefined ? undefined
    : descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
}

/** Selects the 详细 density before the line view replaces the main conversation's header. */
async function pickDetailed(page: BootedPage): Promise<void> {
  const toggle = (): FakeElement | undefined => findElement(page.root, (element) =>
    element.getAttribute('aria-haspopup') === 'menu'
    && (element.getAttribute('title') ?? '').includes('显示多少过程'));
  await waitFor(() => toggle() !== undefined);
  click(toggle()!);
  await waitFor(() => findElement(page.root, (element) =>
    element.getAttribute('role') === 'menuitemradio' && textOf(element) === '详细') !== undefined);
  click(findElement(page.root, (element) =>
    element.getAttribute('role') === 'menuitemradio' && textOf(element) === '详细')!);
  await waitFor(() => textOf(toggle()).includes('详细'));
}

describe('E3U 1A row ③ the live block continues from runningFrom − 1', () => {
  it('the follow-up executions/steps request after one more step has after === runningFrom − 1', async () => {
    stuck = await openStuckRunWorld(LABEL);
    await stuck.started();
    /* SHT-2's clock past the 10-minute line: the Run is genuinely long-lived. */
    stuck.fixture.world.clock.advance(11 * 60_000);
    const fixture = stuck.fixture;
    const posting = async (route: string, body: unknown): Promise<unknown> =>
      (await fixture.world.post(route, body)).body;
    await onMain(fixture.world, async (page: BootedPage, log: PageLog): Promise<void> => {
      await waitFor(() => lineRows(page.root).length > 0);
      const index = (await lineOrder(posting, S6A_SCOPE)).indexOf(stuck!.line.ref.sessionId);
      expect(index, 'the executor line in the rail').toBeGreaterThanOrEqual(0);
      await pickDetailed(page);
      await waitFor(() => railButton(page.root, index) !== undefined);
      click(railButton(page.root, index)!);
      await waitFor(() => findClass(page.root, 'lv-thread') !== undefined);
      const lineThread = (): FakeElement => findClass(page.root, 'lv-thread')!;
      await waitFor(() => runRows(lineThread()).length > 0);
      /* The block is live: it opened under 详细 and says 起 (still running). */
      expect(runRows(lineThread())[0]!.getAttribute('class') ?? '').toContain('is-live');
      await waitFor(() => runRows(lineThread())[0]?.getAttribute('aria-expanded') === 'true');
      expect(textOf(findClass(runRows(lineThread())[0]!, 't'))).toMatch(/^\d\d:\d\d 起$/);

      await waitFor(() => callsTo(log, 'executions/steps').some((call) => call.reply !== undefined));
      const first = callsTo(log, 'executions/steps').find((call) => call.reply !== undefined)!;
      expect((first.input as { after?: unknown }).after, 'the first read is unpaged').toBeNull();
      const initial = stepsOf(first.reply);
      expect(initial.summary.live, 'the Run is live').toBe(true);
      expect(initial.runningFrom, 'the live step position').not.toBeNull();
      expect(initial.steps.some((step) => 'status' in step && step.status === 'running'),
        'a running step').toBe(true);
      const expectedAfter = initial.runningFrom! - 1;

      /* One 5 s timer later the page re-reads the still-live block (wait past
         it on the runner's real clock; the Host's `Date` is frozen). */
      const firstIndex = log.calls.indexOf(first);
      await sleep(6_000);
      const followUps = log.calls.slice(firstIndex + 1)
        .filter((call) => call.route === 'executions/steps');
      expect(followUps.length, 'a follow-up executions/steps read').toBeGreaterThan(0);
      expect((followUps[0]!.input as { after?: unknown }).after,
        'the follow-up continues from runningFrom − 1').toBe(expectedAfter);
      /* Let that read answer, then release the Run and wait for the page's next
         reread to publish it ended: the live signal stops, so teardown leaves
         no 5 s timer behind. */
      await waitFor(() => followUps[0]?.reply !== undefined);
      await stuck!.release();
      await waitFor(() => !runRows(lineThread()).some((row) =>
        (row.getAttribute('class') ?? '').includes('is-live')), 15_000);
    }, { search: '?goal=' + fixture.goal.goalId });
  }, 180_000);
});
