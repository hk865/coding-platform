import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { findButton, findClass, findAllClass, findElement } from './helpers/boot-page.js';
import { bootE3N, callsTo, quietPage, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { lineOrder } from './helpers/E3N-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  advanceK3L3, crashK3L3Command, openK3L3World, readK3L3Review, selectK3L3, type K3L3World,
} from '../helpers/K3L3-adviser-world.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { FakeElement } from './helpers/dom.js';

const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('../scenarios/support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]):
    ToolDefinition => (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const k3worlds: K3L3World[] = [];
afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  commitBarrier.reset();
  await Promise.allSettled(k3worlds.splice(0).map((w) => w.world.close()));
});

const performs = (kind: string) => (op: { kind: string }) => op.kind === kind;

function railButton(root: FakeElement, index: number): FakeElement | undefined {
  const rail = findClass(root, 'rail');
  if (rail === undefined) return undefined;
  const rows = findAllClass(rail, 'lv-rw');
  const holder = rows[index + 1];
  if (holder === undefined) return undefined;
  const all = [holder, ...findAllClass(holder, 'lv-rw')];
  const buttons: FakeElement[] = [];
  const walk = (element: FakeElement): void => {
    if (element.tagName.toLowerCase() === 'button') buttons.push(element);
    for (const child of element.childNodes) if (child instanceof Object && (child as FakeElement).childNodes !== undefined) walk(child as FakeElement);
  };
  for (const row of all) walk(row);
  return buttons[0] ?? holder;
}

async function openReviewLine(page: Parameters<typeof findClass>[0] extends never ? never : { root: FakeElement }, log: Parameters<typeof quietPage>[0], index: number): Promise<void> {
  await waitFor(() => railButton(page.root, index) !== undefined);
  click(railButton(page.root, index)!);
  await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined);
  await quietPage(log);
}

function expectedOf(call: { body: unknown }): unknown {
  return (call.body as { request?: { meta?: { expected?: unknown } } })?.request?.meta?.expected;
}

describe('4b line view review and message facts', () => {
  it('⑥ 我来处理 holds the record and 继续 releases it', async () => {
    const w = await openK3L3World('e3u-4b');
    k3worlds.push(w);
    const runRef = await crashK3L3Command(w, 'e3u-4b');
    await advanceK3L3(w, selectK3L3(w, 'e3u-4b-a'), performs('send_system_round'));
    const review = await readK3L3Review(w, runRef);
    expect(review).toMatchObject({ status: 'awaiting_advice', revision: 2 });
    const index = (await lineOrder((route, body) => w.world.post(route, body).then((reply) => reply.body), S6A_SCOPE))
      .indexOf(w.workLine.ref.sessionId);
    const { page, log } = await bootE3N(w.world, 'Main', { search: `?goal=${w.goal.goalId}` });
    try {
      await openReviewLine(page, log, index);
      await waitFor(() => findButton(page.root, '我来处理') !== undefined);
      click(findButton(page.root, '我来处理')!);
      click(findButton(page.root, '我来处理')!);
      /* 具名改坏: `holdReview` 的 `input.text` 写成空串或缺 `reviewRef`；这一条红。 */
      await expect.poll(() => callsTo(log, 'unknown-call-reviews/hold').filter((call) => call.reply !== undefined).length,
        { timeout: 10_000, interval: 25 }).toBe(1);
      expect(callsTo(log, 'unknown-call-reviews/hold')).toHaveLength(1);
      const hold = callsTo(log, 'unknown-call-reviews/hold')[0]!;
      expect(hold.input).toEqual({ reviewRef: review.ref, text: null });
      expect(expectedOf(hold)).toEqual([{ ref: review.ref, revision: 2 }]);
      const reviewResume = (): FakeElement | undefined => findElement(page.root, (element) =>
        element.tagName.toLowerCase() === 'button' && element.textContent.includes('继续')
        && (element.getAttribute('title') ?? '').startsWith('放开这条核对记录'));
      await waitFor(() => reviewResume() !== undefined && reviewResume()!.getAttribute('aria-disabled') !== 'true');
      expect(findButton(page.root, '我来处理')).toBeUndefined();
      /* A9: a held review's requeue is refused by the owner, so the button is gone too. */
      expect(findButton(page.root, '重新入队')).toBeUndefined();
      click(reviewResume()!);
      await expect.poll(() => callsTo(log, 'unknown-call-reviews/release-hold').filter((call) => call.reply !== undefined).length,
        { timeout: 10_000, interval: 25 }).toBe(1);
      const release = callsTo(log, 'unknown-call-reviews/release-hold')[0]!;
      expect(release.input).toEqual({ reviewRef: review.ref });
      expect(expectedOf(release)).toEqual([{ ref: review.ref, revision: 3 }]);
      await waitFor(() => reviewResume() === undefined);
    } finally {
      await page.restore();
    }
  }, 180_000);


});
