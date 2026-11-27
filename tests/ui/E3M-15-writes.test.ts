import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, callsTo, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { memberSearch, openMemberS7C, settle } from './helpers/E3M-world.js';
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

/** The page's own composer foot: its one visible `.composer-foot .to` sentence. */
function footText(root: FakeElement): string {
  const composer = findClass(root, 'composer-foot');
  return textOf(composer === undefined ? undefined : findClass(composer, 'to'));
}

/** The review's 继续, told apart from the line's own 继续 by Main's title. */
function reviewResume(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.tagName.toLowerCase() === 'button'
    && element.textContent.includes('继续')
    && (element.getAttribute('title') ?? '').startsWith('放开这条核对记录'));
}

describe('E3M-15 the Member page writes', () => {
  it('⑥ 我来处理 holds once on a double click; 继续 releases once; a held record shows no 重新入队', async () => {
    const w = await openK3L3World('e3m15-hold');
    k3worlds.push(w);
    const runRef = await crashK3L3Command(w, 'e3m15-hold');
    await advanceK3L3(w, selectK3L3(w, 'e3m15-hold-a'), (op) => op.kind === 'send_system_round');
    const review = await readK3L3Review(w, runRef);
    expect(review).toMatchObject({ status: 'awaiting_advice', revision: 2 });
    const { page, log } = await bootE3N(w.world, 'Member', { search: memberSearch(w.goal.goalId, w.workLine.ref) });
    try {
      await waitFor(() => findClass(page.root, 'mh-acts') !== undefined);
      expect(findButton(findClass(page.root, 'mh-acts')!, '我来处理')).toBeDefined();
      const handle = (): FakeElement | undefined => findButton(findClass(page.root, 'mh-acts')!, '我来处理');
      click(handle()!);
      click(handle()!);
      /* 具名改坏: page's `lineAct` 不看在途（`s.mBusy`）；连点会发两次 hold，这一句红。 */
      await expect.poll(() => callsTo(log, 'unknown-call-reviews/hold')
        .filter((call) => call.reply !== undefined).length, { timeout: 10_000, interval: 25 }).toBe(1);
      expect(callsTo(log, 'unknown-call-reviews/hold')).toHaveLength(1);
      const hold = callsTo(log, 'unknown-call-reviews/hold')[0]!;
      expect(hold.input).toEqual({ reviewRef: review.ref, text: null });
      expect(expectedOf(hold)).toEqual([{ ref: review.ref, revision: 2 }]);
      await waitFor(() => handle() === undefined);
      await waitFor(() => reviewResume(page.root) !== undefined
        && reviewResume(page.root)!.getAttribute('aria-disabled') !== 'true');
      /* A9: the held record's requeue would be refused as busy, so the button is gone. */
      expect(findButton(findClass(page.root, 'mh-acts')!, '重新入队')).toBeUndefined();
      click(reviewResume(page.root)!);
      await expect.poll(() => callsTo(log, 'unknown-call-reviews/release-hold')
        .filter((call) => call.reply !== undefined).length, { timeout: 10_000, interval: 25 }).toBe(1);
      const release = callsTo(log, 'unknown-call-reviews/release-hold')[0]!;
      expect(release.input).toEqual({ reviewRef: review.ref });
      expect(expectedOf(release)).toEqual([{ ref: review.ref, revision: 3 }]);
      await waitFor(() => reviewResume(page.root) === undefined);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑦ a refused pause writes the writeTextOf sentence in the foot and the pause greys in flight', async () => {
    const w = await openMemberS7C({ firstRun: 'held' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let gated = false;
    try {
      const { page, log } = await bootE3N(w.s7c.world, 'Member', {
        search: memberSearch('s7c-goal', w.module),
        gate: true,
        rejectOnce: { route: 'controls/submit', code: 'revision_conflict', reason: 'E3M-15: one revision conflict' },
        before: { 'controls/submit': () => { if (gated) return Promise.resolve(); gated = true; return gate; } },
      });
      try {
        await waitFor(() => findClass(page.root, 'mh-acts') !== undefined);
        const pause = (): FakeElement | undefined => findButton(findClass(page.root, 'mh-acts')!, '暂停');
        expect(pause()).toBeDefined();
        const original = footText(page.root);
        expect(original).toBe('复制一份上下文来回答，不改文件，也不打扰它');
        click(pause()!);
        await settle(() => pause()?.getAttribute('aria-disabled') === 'true');
        /* 具名改坏: 页头按钮不绑 `s.mBusy`；在途时 `aria-disabled` 不是 true，这一句红。 */
        expect(pause()!.getAttribute('aria-disabled')).toBe('true');
        release();
        await expect.poll(() => callsTo(log, 'controls/submit')
          .filter((call) => call.reply !== undefined).length, { timeout: 10_000, interval: 25 }).toBe(1);
        await settle(() => footText(page.root) !== original);
        /* 具名改坏: `footNote` 不接 `s.mErr`；这一句红（还是原来那句）。 */
        expect(footText(page.root)).toBe('这条工作线的版本已变化，请重读后再试。');
        await waitFor(() => pause()?.getAttribute('aria-disabled') !== 'true');
        click(pause()!);
        await expect.poll(() => callsTo(log, 'controls/submit')
          .filter((call) => call.reply !== undefined).length, { timeout: 10_000, interval: 25 }).toBe(2);
        await settle(() => footText(page.root) === original);
        /* The next control clears the failure and the successful pause leaves the original sentence. */
        expect(footText(page.root)).toBe(original);
      } finally {
        await page.restore();
      }
    } finally {
      release();
      await w.s7c.close();
    }
  }, 240_000);
});
