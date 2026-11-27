import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import { memberSearch, settle } from './helpers/E3M-world.js';
import { callsTo, quietPage, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { bootChain, taskBar } from './helpers/E3C-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  advanceK3L3, crashK3L3Command, openK3L3World, readK3L3Review, selectK3L3, type K3L3World,
} from '../helpers/K3L3-adviser-world.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
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

const expectedOf = (call: { body: unknown }): unknown =>
  (call.body as { request?: { meta?: { expected?: unknown } } })?.request?.meta?.expected;

/**
 * E3C-21 (8a A9): the Chain task bar's 我来处理 / 继续 on the K3L3 world, where
 * the record stops at `awaiting_advice` with revision 2 (the same world and
 * crash recipe as E3U-4b-line's Main row).
 */
describe('E3C-21 the Chain review buttons', () => {
  it('⑦ 我来处理 holds once; 继续 releases once; a held record shows no 重新入队', async () => {
    const w = await openK3L3World('e3c20-hold');
    k3worlds.push(w);
    const runRef = await crashK3L3Command(w, 'e3c20-hold');
    await advanceK3L3(w, selectK3L3(w, 'e3c20-hold-a'), (op) => op.kind === 'send_system_round');
    const review = await readK3L3Review(w, runRef);
    expect(review).toMatchObject({ status: 'awaiting_advice', revision: 2 });
    const { page, log } = await bootChain(w.world, memberSearch(w.goal.goalId, w.workLine.ref));
    try {
      await waitFor(() => taskBar(page.root) !== undefined);
      await waitFor(() => findButton(taskBar(page.root)!, '我来处理') !== undefined);
      const handle = (): FakeElement | undefined => findButton(taskBar(page.root)!, '我来处理');
      click(handle()!);
      click(handle()!);
      /* 具名改坏: `writeReview` 在 Chain 页仍取 latestLine；本行没有请求，红。 */
      await expect.poll(() => callsTo(log, 'unknown-call-reviews/hold')
        .filter((call) => call.reply !== undefined).length, { timeout: 10_000, interval: 25 }).toBe(1);
      expect(callsTo(log, 'unknown-call-reviews/hold')).toHaveLength(1);
      const hold = callsTo(log, 'unknown-call-reviews/hold')[0]!;
      expect(hold.input).toEqual({ reviewRef: review.ref, text: null });
      expect(expectedOf(hold)).toEqual([{ ref: review.ref, revision: 2 }]);
      await waitFor(() => findButton(taskBar(page.root)!, '我来处理') === undefined);
      const resume = (): FakeElement | undefined => findElement(taskBar(page.root)!,
        (element) => element.tagName.toLowerCase() === 'button' && element.textContent.includes('继续')
          && (element.getAttribute('title') ?? '').startsWith('放开这条核对记录'));
      await waitFor(() => resume() !== undefined);
      /* A9: the held record has no requeue (the owner would refuse it as busy). */
      expect(findButton(taskBar(page.root)!, '重新入队')).toBeUndefined();
      await settle(() => resume()!.getAttribute('aria-disabled') === 'false');
      click(resume()!);
      await expect.poll(() => callsTo(log, 'unknown-call-reviews/release-hold')
        .filter((call) => call.reply !== undefined).length, { timeout: 10_000, interval: 25 }).toBe(1);
      const release = callsTo(log, 'unknown-call-reviews/release-hold')[0]!;
      expect(release.input).toEqual({ reviewRef: review.ref });
      expect(expectedOf(release)).toEqual([{ ref: review.ref, revision: 3 }]);
      await waitFor(() => resume() === undefined);
      await quietPage(log);
      expect(findClass(page.root, 'tx-failed')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 180_000);
});
