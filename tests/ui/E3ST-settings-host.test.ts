import { afterEach, describe, expect, it } from 'vitest';
import {
  blockOf, fieldIn, heldSettingsPage, typeField,
} from './helpers/E3ST-settings.js';
import { findAllClass, findButton, findClass } from './helpers/boot-page.js';
import {
  bootE3N, callsTo, countRoute, settledN, textOf, waitFor,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openKLS1BTwoProjects } from '../helpers/KLS1B-two-projects.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * Settings page, the snapshot-only blocks (7D2 batch 2, group 1): the startup
 * automation pair, the Work Run token budget and the command resource caps. The
 * world is the KLS-1b two-project Host; every write is the page's own click.
 */

const worlds: Array<Awaited<ReturnType<typeof openKLS1BTwoProjects>>> = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map((world) => world.dispose()));
});

async function openWorld() {
  const world = await openKLS1BTwoProjects({ backend: 'memory' });
  worlds.push(world);
  return world;
}

function block(root: FakeElement, name: string): FakeElement {
  const found = blockOf(root, name);
  expect(found, name).toBeDefined();
  return found!;
}

function modeButton(block: FakeElement, label: string): FakeElement {
  const found = findAllClass(block, 'mode-btn').find((button) => textOf(button).startsWith(label));
  expect(found, label).toBeDefined();
  return found!;
}

describe('settings snapshot blocks (7D2 batch 2)', () => {
  it('① 启动时自动续做 and 自动返工上限 save together, and a value over 10 stays local', async () => {
    const world = await openWorld();
    const page = await bootE3N(world, 'Settings', { gate: true });
    try {
      await waitFor(() => blockOf(page.page.root, '启动时自动续做') !== undefined);
      const auto = () => block(page.page.root, '启动时自动续做');
      const ask = modeButton(auto(), '问我');
      expect(ask.getAttribute('class')).toContain('is-on');
      expect(textOf(ask)).toContain('· 默认');
      expect(textOf(findClass(auto(), 'blk-desc'))).toContain('问我：记下原因');
      expect(fieldIn(auto(), '自动返工上限')!.value).toBe('3');
      expect(findButton(auto(), '保存')!.disabled).toBe(true);

      click(modeButton(auto(), '自动'));
      expect(textOf(findClass(auto(), 'blk-desc'))).toContain('自动：Host 启动后直接续做');
      expect(countRoute(page.log, 'settings/automation/save')).toBe(0);

      typeField(fieldIn(auto(), '自动返工上限')!, '11');
      click(findButton(auto(), '保存')!);
      expect(countRoute(page.log, 'settings/automation/save')).toBe(0);
      expect(fieldIn(auto(), '自动返工上限')!.getAttribute('class')).toContain('is-bad');
      expect(textOf(findClass(auto(), 'err'))).toBe('自动返工上限要 0 到 10 的整数');

      typeField(fieldIn(auto(), '自动返工上限')!, '5');
      click(findButton(auto(), '保存')!);
      await settledN(page.log, 'settings/automation/save', 1);
      expect(countRoute(page.log, 'settings/automation/save')).toBe(1);
      expect(callsTo(page.log, 'settings/automation/save')[0]?.input)
        .toEqual({ autoReworkLimit: 5, resumeOnStartup: 'auto' });
      await waitFor(() => textOf(findClass(page.page.root, 'auto-saved')).includes('已保存'));
      await waitFor(() => textOf(findClass(auto(), 'auto-saved')).includes('已保存'));
    } finally {
      await page.page.restore();
    }

    const again = await bootE3N(world, 'Settings', { gate: true });
    try {
      await waitFor(() => blockOf(again.page.root, '启动时自动续做') !== undefined);
      const auto = block(again.page.root, '启动时自动续做');
      expect(modeButton(auto, '自动').getAttribute('class')).toContain('is-on');
      expect(fieldIn(auto, '自动返工上限')!.value).toBe('5');
    } finally {
      await again.page.restore();
    }
  }, 120_000);

  it('② the Work Run token budget saves an integer and clears back to the default', async () => {
    const world = await openWorld();
    const page = await bootE3N(world, 'Settings', { gate: true });
    try {
      await waitFor(() => blockOf(page.page.root, '每次执行的 token 上限') !== undefined);
      const tok = () => block(page.page.root, '每次执行的 token 上限');
      expect(textOf(findClass(tok(), 'tok-cur'))).toBe('4 亿（默认）');
      expect(findButton(tok(), '保存')!.disabled).toBe(true);

      typeField(fieldIn(tok(), '每次执行的 token 上限')!, '300000000');
      expect(textOf(findClass(tok(), 'fld-hint'))).toBe('= 3 亿');
      click(findButton(tok(), '保存')!);
      await settledN(page.log, 'settings/run-budget/save', 1);
      expect(countRoute(page.log, 'settings/run-budget/save')).toBe(1);
      expect(callsTo(page.log, 'settings/run-budget/save')[0]?.input)
        .toEqual({ workRunTokenBudget: 300000000 });
      await waitFor(() => textOf(findClass(tok(), 'tok-cur')) === '3 亿');

      typeField(fieldIn(tok(), '每次执行的 token 上限')!, '');
      click(findButton(tok(), '保存')!);
      await settledN(page.log, 'settings/run-budget/save', 2);
      expect(callsTo(page.log, 'settings/run-budget/save')[1]?.input)
        .toEqual({ workRunTokenBudget: null });
      await waitFor(() => textOf(findClass(tok(), 'tok-cur')) === '4 亿（默认）');

      typeField(fieldIn(tok(), '每次执行的 token 上限')!, '600000001');
      click(findButton(tok(), '保存')!);
      expect(countRoute(page.log, 'settings/run-budget/save')).toBe(2);
      expect(textOf(findClass(tok(), 'err'))).toBe('要 1 到 600000000（6 亿）之间的整数');
    } finally {
      await page.page.restore();
    }
  }, 120_000);

  it('③ the command memory and process caps save both cells and clear back to the defaults', async () => {
    const world = await openWorld();
    const page = await bootE3N(world, 'Settings', { gate: true });
    try {
      await waitFor(() => blockOf(page.page.root, '命令的内存和进程数') !== undefined);
      const cap = () => block(page.page.root, '命令的内存和进程数');
      expect(textOf(findClass(cap(), 'machine'))).toBe('还没检查');
      expect(findButton(cap(), '保存')!.disabled).toBe(true);

      /* 裁定 13: 100 is not refused locally any more; the Host's own range does. */
      typeField(fieldIn(cap(), '内存上限')!, '100');
      click(findButton(cap(), '保存')!);
      await settledN(page.log, 'settings/resource-caps/save', 1);
      expect(countRoute(page.log, 'settings/resource-caps/save')).toBe(1);
      expect(callsTo(page.log, 'settings/resource-caps/save')[0]?.input)
        .toEqual({ memoryMaxMiB: 100, tasksMax: null });
      expect(textOf(findClass(cap(), 'err'))).toBe('内存超出这台机器能设的范围');

      typeField(fieldIn(cap(), '内存上限')!, '1024');
      typeField(fieldIn(cap(), '进程数上限')!, '256');
      click(findButton(cap(), '保存')!);
      await settledN(page.log, 'settings/resource-caps/save', 2);
      expect(countRoute(page.log, 'settings/resource-caps/save')).toBe(2);
      expect(callsTo(page.log, 'settings/resource-caps/save')[1]?.input)
        .toEqual({ memoryMaxMiB: 1024, tasksMax: 256 });
    } finally {
      await page.page.restore();
    }

    const again = await bootE3N(world, 'Settings', { gate: true });
    try {
      await waitFor(() => blockOf(again.page.root, '命令的内存和进程数') !== undefined);
      const cap = block(again.page.root, '命令的内存和进程数');
      expect(fieldIn(cap, '内存上限')!.value).toBe('1024');
      expect(fieldIn(cap, '进程数上限')!.value).toBe('256');
      click(findButton(cap, '填回默认值')!);
      expect(fieldIn(cap, '内存上限')!.value).toBe('');
      expect(fieldIn(cap, '进程数上限')!.value).toBe('');
      click(findButton(cap, '保存')!);
      await settledN(again.log, 'settings/resource-caps/save', 1);
      expect(callsTo(again.log, 'settings/resource-caps/save')[0]?.input)
        .toEqual({ memoryMaxMiB: null, tasksMax: null });
    } finally {
      await again.page.restore();
    }

    const third = await bootE3N(world, 'Settings', { gate: true });
    try {
      await waitFor(() => blockOf(third.page.root, '命令的内存和进程数') !== undefined);
      const cap = block(third.page.root, '命令的内存和进程数');
      typeField(fieldIn(cap, '内存上限')!, '99999999');
      click(findButton(cap, '保存')!);
      await settledN(third.log, 'settings/resource-caps/save', 1);
      await waitFor(() => textOf(findClass(cap, 'err')) === '内存超出这台机器能设的范围');
      expect(third.page.root.textContent).not.toContain('memoryMaxMiB');
    } finally {
      await third.page.restore();
    }
  }, 180_000);

  it.each([
    {
      kind: 'automation' as const, route: 'automation/save',
      reason: 'the automation policy was saved but the Host configuration was not confirmed; retry the same save',
    },
    {
      kind: 'budget' as const, route: 'run-budget/save',
      reason: 'the work run token budget was saved but the Host configuration was not confirmed; retry the same save',
    },
    {
      kind: 'caps' as const, route: 'resource-caps/save',
      reason: 'the resource caps were saved but the Host configuration was not confirmed; retry the same save',
    },
  ])('④ $route shows 已保存，尚未生效 and 重试 sends the same write', async ({ kind, route, reason }) => {
    const world = await openWorld();
    const { page, log } = await heldSettingsPage(world, '?from=Main', route,
      { status: 'rejected', code: 'unavailable', reason });
    try {
      const write = async (): Promise<FakeElement> => {
        if (kind === 'automation') {
          await waitFor(() => blockOf(page.root, '启动时自动续做') !== undefined);
          const auto = block(page.root, '启动时自动续做');
          click(modeButton(auto, '自动'));
          typeField(fieldIn(auto, '自动返工上限')!, '5');
          return auto;
        }
        if (kind === 'budget') {
          await waitFor(() => blockOf(page.root, '每次执行的 token 上限') !== undefined);
          const tok = block(page.root, '每次执行的 token 上限');
          typeField(fieldIn(tok, '每次执行的 token 上限')!, '300000000');
          return tok;
        }
        await waitFor(() => blockOf(page.root, '命令的内存和进程数') !== undefined);
        const cap = block(page.root, '命令的内存和进程数');
        typeField(fieldIn(cap, '内存上限')!, '1024');
        typeField(fieldIn(cap, '进程数上限')!, '256');
        return cap;
      };
      const target = await write();
      click(findButton(target, '保存')!);
      await settledN(log, 'settings/' + route, 1);
      await waitFor(() => textOf(findClass(target, 'saved')).includes('已保存，尚未生效'));
      /* 表一 2: the reread draws the Host's stored value; the snapshot read is the 2nd. */
      expect(countRoute(log, 'settings/snapshot')).toBe(2);
      if (kind === 'automation') {
        expect(fieldIn(target, '自动返工上限')!.value).toBe('5');
        expect(modeButton(target, '自动').getAttribute('class')).toContain('is-on');
      } else if (kind === 'budget') {
        expect(textOf(findClass(target, 'tok-cur'))).toBe('3 亿');
      } else {
        expect(fieldIn(target, '内存上限')!.value).toBe('1024');
        expect(fieldIn(target, '进程数上限')!.value).toBe('256');
      }
      const first = callsTo(log, 'settings/' + route)[0]?.input;
      click(findButton(target, '重试')!);
      await settledN(log, 'settings/' + route, 2);
      expect(callsTo(log, 'settings/' + route).map((call) => call.input)).toEqual([first, first]);
      await waitFor(() => !page.root.textContent.includes('已保存，尚未生效'));
    } finally {
      await page.restore();
    }
  }, 120_000);
});
