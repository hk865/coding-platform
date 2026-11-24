import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boardUrlOf, bootPage, findAllClass, findButton, findClass, findElement, findLink,
} from './helpers/boot-page.js';
import {
  auxPanel, auxTab, bootE3N, callsTo, countRoute, forwardPage, gateChanges, newPageLog,
  quietPage, settledN, textOf, turns, waitFor,
} from './helpers/E3N-page.js';
import { click, pressKey } from './helpers/E3N-interact.js';
import type { FakeElement } from './helpers/dom.js';
import { g8Check, openG8Project } from '../helpers/G8-world.js';
import { adoptWithChecks } from '../helpers/G8B-world.js';
import { writeAG2bWorkspace } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';

/**
 * Settings page shell: the rail-foot link on a real Host world (①) and the one
 * snapshot read's failure state with its retry (⑥). The page source, token and
 * every route are the served page and the real Host; only the snapshot's first
 * answer is held unavailable (A2).
 */

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map((close) => close())); });

const LABEL = 'settings-ws';
const SEED = 'settings-check';
const PLAN_CHECK = 'settings-plan-check';

async function world(checks = [g8Check(SEED, 'all')]) {
  const project = await openG8Project(LABEL, checks);
  cleanup.push(project.close);
  return project;
}

/** The `.ws` row whose `.ws-name` holds `name`. */
function workspaceRow(root: FakeElement, name: string): FakeElement | undefined {
  return findAllClass(root, 'ws').find((row) => textOf(findClass(row, 'ws-name')).includes(name));
}

/** The checkbox of the `.ck` label whose text contains `text`, inside `row`. */
function inputBox(row: FakeElement | undefined, text: string): FakeElement | undefined {
  const label = row === undefined ? undefined
    : findAllClass(row, 'ck').find((entry) => textOf(entry).includes(text));
  return label === undefined ? undefined
    : findElement(label, (element) => element.tagName.toLowerCase() === 'input');
}

/** One real checkbox change: flip the property, then dispatch the event the page listens to. */
function setBox(box: FakeElement, checked: boolean): void {
  box.checked = checked;
  box.dispatch('change', { target: box, currentTarget: box });
}

function checkRow(root: FakeElement, checkId: string): FakeElement | undefined {
  return findAllClass(root, 'rl-check').find((row) => row.getAttribute('data-check') === checkId);
}

function withdrawnRow(root: FakeElement, checkId: string): FakeElement | undefined {
  return findAllClass(root, 'rl-withdrawn').find((row) => row.getAttribute('data-withdrawn') === checkId);
}

function revokedFold(root: FakeElement): FakeElement | undefined {
  return findAllClass(root, 'rl-fold')
    .find((entry) => entry.tagName.toLowerCase() === 'button' && textOf(entry).includes('已撤回'));
}

/** The `.sw` row whose `.sw-name` holds `name`. */
function switchRow(root: FakeElement, name: string): FakeElement | undefined {
  return findAllClass(root, 'sw').find((row) => textOf(findClass(row, 'sw-name')).includes(name));
}

/** One `.mode-btn` of that switch, found by its text. */
function modeButton(root: FakeElement, name: string, label: string): FakeElement | undefined {
  const row = switchRow(root, name);
  return row === undefined ? undefined
    : findAllClass(row, 'mode-btn').find((button) => textOf(button).startsWith(label));
}

/** The integer field of the command review line block. */
function reviewLineField(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.tagName.toLowerCase() === 'input'
    && (element.getAttribute('aria-label') ?? '') === '命令审查线');
}

/** Types into a text field the way the page listens (`change` maps to `input`). */
function typeField(field: FakeElement, value: string): void {
  field.value = value;
  field.dispatch('input', { target: field, currentTarget: field });
}

/** The Settings page on the shared world's Goal/first read. */
async function settingsPage(project: Awaited<ReturnType<typeof world>>) {
  return await bootE3N(project.world, 'Settings', {
    search: '?from=Main&goal=' + encodeURIComponent(project.seedGoal.goalId), gate: true,
  });
}

/** Boot Settings with one settings route's answer replaced by `answer` after the
 *  real Host handled it, so the Host's own snapshot holds the new value. */
async function heldSettings(project: Awaited<ReturnType<typeof world>>, route: string, answer: unknown) {
  const log = newPageLog();
  gateChanges(log);
  const forward = forwardPage(project.world, log, 'stream');
  let held = false;
  const page = await bootPage({
    name: 'Settings', search: '?from=Main&goal=' + encodeURIComponent(project.seedGoal.goalId),
    token: () => project.world.token,
    request: async (url, init, realFetch) => {
      const sent = await forward(url, init, realFetch);
      if (!held && url.endsWith('/api/real/settings/' + route)) {
        held = true;
        return new Response(JSON.stringify(answer), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return sent;
    },
  });
  return { page, log };
}

/** Open a check's inline 撤回 confirmation and press its 撤回. */
function inlineWithdraw(root: FakeElement, checkId: string): void {
  const row = checkRow(root, checkId)!;
  click(findElement(row, (entry) => entry.tagName.toLowerCase() === 'button' && textOf(entry) === '撤回')!);
  click(findButton(findClass(row, 'rl-edit')!, '撤回')!);
}

describe('settings page shell', () => {
  it('S-1 the rail 设置 link opens Settings and 返回工作台 keeps the Goal', async () => {
    const project = await world();
    const goalId = project.seedGoal.goalId;
    const main = await bootE3N(project.world, 'Main', { search: `?goal=${goalId}`, gate: true });
    try {
      const link = findLink(main.page.root, '设置', 'Settings.dc.html');
      expect(link).toBeDefined();
      click(link!);
      expect(main.page.assigned()).toEqual([]);
      const target = boardUrlOf(link!.getAttribute('href'), 'Main.dc.html');
      expect(target.pathname).toBe('/workbench/Settings.dc.html');
      expect(target.searchParams.get('goal')).toBe(goalId);
      expect(target.searchParams.get('from')).toBe('Main');
    } finally {
      await main.page.restore();
    }

    const settings = await bootE3N(project.world, 'Settings', { search: '?from=Main&goal=' + encodeURIComponent(goalId), gate: true });
    try {
      expect(settings.log.calls.map((call) => call.route)).toContain('bootstrap');
      expect(settings.log.calls.map((call) => call.url)).toContainEqual(expect.stringContaining('/api/real/settings/snapshot'));
      expect(settings.page.root.textContent).toContain('设置');
      expect(settings.page.root.textContent).toContain(LABEL);
      expect(settings.page.root.textContent).toContain('工作区与权限');
      expect(settings.page.root.textContent).toContain('自动化与规则');
      expect(settings.page.root.textContent).toContain('运行上限');
      expect(settings.page.root.textContent).not.toContain('架构图和注记');

      const back = findLink(settings.page.root, '返回工作台', 'Main.dc.html');
      const backUrl = boardUrlOf(back!.getAttribute('href'), 'Settings.dc.html');
      expect(backUrl.pathname).toBe('/workbench/Main.dc.html');
      expect(backUrl.searchParams.get('goal')).toBe(goalId);
      click(back!);
      expect(settings.page.assigned()).toEqual([]);
    } finally {
      await settings.page.restore();
    }

    const back = await bootE3N(project.world, 'Main', { search: `?goal=${goalId}`, gate: true });
    try {
      expect(back.page.root.textContent).toContain(LABEL + ' seed goal');
      expect(back.page.root.textContent).toContain('设置');
    } finally {
      await back.page.restore();
    }
  }, 60_000);

  it('S-2 unticking 允许跑命令 writes once and disables 运行 on the command page', async () => {
    const project = await world();
    const goalId = project.seedGoal.goalId;
    const settings = await bootE3N(project.world, 'Settings', {
      search: '?from=Main&goal=' + encodeURIComponent(goalId), gate: true,
    });
    try {
      await waitFor(() => workspaceRow(settings.page.root, LABEL) !== undefined);
      const command = inputBox(workspaceRow(settings.page.root, LABEL), '允许跑命令');
      expect(command).toBeDefined();
      expect(command!.checked).toBe(true);
      setBox(command!, false);
      await settledN(settings.log, 'settings/workspaces/access', 1);
      expect(countRoute(settings.log, 'settings/workspaces/access')).toBe(1);
      expect(callsTo(settings.log, 'settings/workspaces/access')[0]?.input)
        .toEqual({ scope: project.scope, writeAllowed: true, commandsAllowed: false });
      /* 回答里的新快照重画了这一行；不再另读。 */
      await waitFor(() => inputBox(workspaceRow(settings.page.root, LABEL), '允许跑命令')?.checked === false);
      /* 表一 1：勾选写成功后，这一行写“已保存”，和命令审查线、结构开关同一个字样。 */
      expect(textOf(findClass(workspaceRow(settings.page.root, LABEL)!, 'ws-why'))).toContain('已保存');
      expect(countRoute(settings.log, 'settings/snapshot')).toBe(1);
    } finally {
      await settings.page.restore();
    }

    const main = await bootE3N(project.world, 'Main', { search: `?goal=${goalId}`, gate: true });
    try {
      await waitFor(() => auxTab(main.page.root, '命令') !== undefined);
      click(auxTab(main.page.root, '命令')!);
      await turns(() => auxTab(main.page.root, '命令')?.getAttribute('aria-selected') === 'true', 5_000);
      await quietPage(main.log);
      const panel = auxPanel(main.page.root)!;
      expect(textOf(findClass(panel, 'fnote')))
        .toBe('这个工作区没有开“跑命令”的授权：命令能看，不能在这里运行。');
      const run = findElement(panel, (element) =>
        element.tagName.toLowerCase() === 'button' && textOf(element) === '运行');
      expect(run).toBeDefined();
      expect(run!.getAttribute('aria-disabled')).toBe('true');
      expect(run!.getAttribute('title')).toBe('这个工作区没有开“跑命令”的授权');
    } finally {
      await main.page.restore();
    }
  }, 90_000);

  it('S-3 withdraws a plan-brought check once and a whole-list approval puts it back', async () => {
    /* 种子里两条（整批回答里也有两条）；先把计划检查从已批准清单里撤掉，再让一份计划用同一个 id 装回来。 */
    const project = await world([g8Check(SEED, 'all'), g8Check(PLAN_CHECK, 'all')]);
    const goal = (await s6aCardsWorkspace(project.world, project.scope).createGoal('st-s3-goal')).ref;
    const cleared = await project.world.settings('checks/withdraw', { scope: project.scope, checkId: PLAN_CHECK });
    expect(cleared.status).toBe('ready');
    await adoptWithChecks(project.world, project.scope, goal, 'st-s3-plan',
      [g8Check(PLAN_CHECK, ['st-s3-plan-work', 'st-s3-plan-gate'])]);

    const settings = await bootE3N(project.world, 'Settings', {
      search: '?from=Main&goal=' + encodeURIComponent(project.seedGoal.goalId), gate: true,
    });
    try {
      await waitFor(() => checkRow(settings.page.root, PLAN_CHECK) !== undefined);
      const row = checkRow(settings.page.root, PLAN_CHECK)!;
      expect(textOf(findClass(row, 'rl-name'))).toContain(PLAN_CHECK);
      expect(textOf(findClass(row, 'rl-sub'))).toContain('计划带来的');
      click(findElement(row, (element) =>
        element.tagName.toLowerCase() === 'button' && textOf(element) === '撤回')!);
      /* 备注 8：先出行内确认，说明一句；取消不发请求，确认才撤。 */
      const inline = findClass(row, 'rl-edit');
      expect(inline).toBeDefined();
      expect(textOf(inline)).toContain('撤回以后，这条检查不再跑；要用得重新加');
      expect(countRoute(settings.log, 'settings/checks/withdraw')).toBe(0);
      click(findButton(inline!, '取消')!);
      expect(findClass(row, 'rl-edit')).toBeUndefined();
      click(findElement(row, (element) =>
        element.tagName.toLowerCase() === 'button' && textOf(element) === '撤回')!);
      click(findButton(findClass(row, 'rl-edit')!, '撤回')!);
      await settledN(settings.log, 'settings/checks/withdraw', 1);
      expect(countRoute(settings.log, 'settings/checks/withdraw')).toBe(1);
      expect(callsTo(settings.log, 'settings/checks/withdraw')[0]?.input)
        .toEqual({ scope: project.scope, checkId: PLAN_CHECK });
      await waitFor(() => checkRow(settings.page.root, PLAN_CHECK) === undefined);

      const fold = revokedFold(settings.page.root);
      expect(fold).toBeDefined();
      click(fold!);
      await turns(() => withdrawnRow(settings.page.root, PLAN_CHECK) !== undefined, 5_000);
      const gone = withdrawnRow(settings.page.root, PLAN_CHECK)!;
      expect(textOf(gone)).toContain('计划带来的');
      expect(textOf(gone)).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/);
    } finally {
      await settings.page.restore();
    }

    /* 用同一份回答整批批回来：这一条回到已批准清单，页面以检查列表为准。 */
    const approved = await project.world.settings('checks/approve', {
      scope: project.scope, answerRef: project.seedAnswer,
      checks: [g8Check(SEED, 'all'), g8Check(PLAN_CHECK, 'all')],
    });
    expect(approved.status, JSON.stringify(approved)).toBe('ready');

    const again = await bootE3N(project.world, 'Settings', {
      search: '?from=Main&goal=' + encodeURIComponent(project.seedGoal.goalId), gate: true,
    });
    try {
      await waitFor(() => checkRow(again.page.root, PLAN_CHECK) !== undefined);
      expect(textOf(findClass(checkRow(again.page.root, PLAN_CHECK)!, 'rl-sub'))).toContain('已批准清单');
      const fold = revokedFold(again.page.root);
      if (fold !== undefined) click(fold);
      await turns(() => true, 50);
      expect(withdrawnRow(again.page.root, PLAN_CHECK)).toBeUndefined();
    } finally {
      await again.page.restore();
    }
  }, 180_000);

  it('S-4 both structural switches start 自动 and 出卡问我 saves once', async () => {
    const project = await world();
    const settings = await bootE3N(project.world, 'Settings', {
      search: '?from=Main&goal=' + encodeURIComponent(project.seedGoal.goalId), gate: true,
    });
    try {
      await waitFor(() => modeButton(settings.page.root, '结构提案自动批准', '自动') !== undefined);
      expect(modeButton(settings.page.root, '结构提案自动批准', '自动')!.getAttribute('class')).toContain('is-on');
      expect(modeButton(settings.page.root, '结构修补自动批准', '自动')!.getAttribute('class')).toContain('is-on');
      expect(modeButton(settings.page.root, '结构提案自动批准', '出卡问我')!.getAttribute('class'))
        .not.toContain('is-on');

      click(modeButton(settings.page.root, '结构提案自动批准', '出卡问我')!);
      await settledN(settings.log, 'settings/structural-approval/save', 1);
      expect(countRoute(settings.log, 'settings/structural-approval/save')).toBe(1);
      expect(callsTo(settings.log, 'settings/structural-approval/save')[0]?.input)
        .toEqual({ projectId: project.scope.projectId, value: { proposals: 'ask', repairs: 'auto' } });
      /* 回答里的新快照重画了这一行；不再另读。 */
      await waitFor(() => modeButton(settings.page.root, '结构提案自动批准', '出卡问我')!
        .getAttribute('class')?.includes('is-on') === true);
      expect(textOf(findClass(settings.page.root, 'sw-saved'))).toContain('已保存');
      expect(countRoute(settings.log, 'settings/snapshot')).toBe(1);
    } finally {
      await settings.page.restore();
    }

    /* 再开一次：saved 跟着变了。 */
    const again = await bootE3N(project.world, 'Settings', {
      search: '?from=Main&goal=' + encodeURIComponent(project.seedGoal.goalId), gate: true,
    });
    try {
      await waitFor(() => modeButton(again.page.root, '结构提案自动批准', '出卡问我') !== undefined);
      expect(modeButton(again.page.root, '结构提案自动批准', '出卡问我')!.getAttribute('class')).toContain('is-on');
      expect(modeButton(again.page.root, '结构提案自动批准', '自动')!.getAttribute('class')).not.toContain('is-on');
      expect(modeButton(again.page.root, '结构修补自动批准', '自动')!.getAttribute('class')).toContain('is-on');
    } finally {
      await again.page.restore();
    }
  }, 120_000);

  it('S-5 the command review line saves 30, then clearing saves the default 60', async () => {
    const project = await world();
    const settings = await bootE3N(project.world, 'Settings', {
      search: '?from=Main&goal=' + encodeURIComponent(project.seedGoal.goalId), gate: true,
    });
    try {
      await waitFor(() => reviewLineField(settings.page.root) !== undefined);
      expect(textOf(findClass(settings.page.root, 'lim-cur'))).toContain('60 分钟');
      typeField(reviewLineField(settings.page.root)!, '30');
      click(findButton(settings.page.root, '保存')!);
      await settledN(settings.log, 'settings/command-review/save', 1);
      expect(countRoute(settings.log, 'settings/command-review/save')).toBe(1);
      expect(callsTo(settings.log, 'settings/command-review/save')[0]?.input)
        .toEqual({ commandReviewLineMinutes: 30 });
      await waitFor(() => textOf(findClass(settings.page.root, 'lim-cur')).includes('30 分钟'));
      expect(textOf(findClass(settings.page.root, 'lim-saved'))).toContain('已保存');

      typeField(reviewLineField(settings.page.root)!, '');
      click(findButton(settings.page.root, '保存')!);
      await settledN(settings.log, 'settings/command-review/save', 2);
      expect(callsTo(settings.log, 'settings/command-review/save')[1]?.input)
        .toEqual({ commandReviewLineMinutes: null });
      await waitFor(() => textOf(findClass(settings.page.root, 'lim-cur')).includes('60 分钟'));
      expect(countRoute(settings.log, 'settings/snapshot')).toBe(1);
    } finally {
      await settings.page.restore();
    }
  }, 120_000);

  it('S-7 a write the Host saved but did not confirm shows 已保存，尚未生效 and 重试 sends it again', async () => {
    const project = await world();
    /* The Host's own answer shape for this state (host-settings.ts:1911): rejected/unavailable, and the
       reason says the value was saved while the Host configuration was not confirmed. The write reaches
       the Host, so its snapshot already holds 30; only the confirmation is held back (表一 2). */
    const notConfirmed = {
      status: 'rejected', code: 'unavailable',
      reason: 'the command review line was saved but the Host configuration was not confirmed; retry the same save',
    };
    const { page, log } = await heldSettings(project, 'command-review/save', notConfirmed);
    try {
      await waitFor(() => reviewLineField(page.root) !== undefined);
      typeField(reviewLineField(page.root)!, '30');
      click(findButton(page.root, '保存')!);
      await settledN(log, 'settings/command-review/save', 1);
      await waitFor(() => textOf(findClass(page.root, 'lim-saved')).includes('已保存，尚未生效'));
      /* 表一 2：先重读快照，输入框旁画 Host 已存下的 30。 */
      await waitFor(() => textOf(findClass(page.root, 'lim-cur')).includes('30 分钟'));
      expect(countRoute(log, 'settings/snapshot')).toBe(2);
      const retry = findButton(page.root, '重试');
      expect(retry).toBeDefined();
      click(retry!);
      await settledN(log, 'settings/command-review/save', 2);
      expect(callsTo(log, 'settings/command-review/save').map((call) => call.input))
        .toEqual([{ commandReviewLineMinutes: 30 }, { commandReviewLineMinutes: 30 }]);
      await waitFor(() => textOf(findClass(page.root, 'lim-cur')).includes('30 分钟'));
      await waitFor(() => !textOf(findClass(page.root, 'lim-saved')).includes('尚未生效'));
      expect(textOf(findClass(page.root, 'lim-saved'))).toContain('已保存');
      /* 重试是同一个写，它的快照就是新数据，不再另读。 */
      expect(countRoute(log, 'settings/snapshot')).toBe(2);
    } finally {
      await page.restore();
    }
  }, 90_000);
  it('S-6 an unavailable snapshot shows the reason and 重试 reads it again', async () => {
    const project = await world();
    const opened = await bootE3N(project.world, 'Settings', {
      search: '?from=Main&goal=' + encodeURIComponent(project.seedGoal.goalId), unavailableOnce: 'settings/snapshot', gate: true,
    });
    try {
      expect(opened.page.root.textContent).toContain('暂时读不到，可以重试。');
      const retry = findButton(opened.page.root, '重试');
      expect(retry).toBeDefined();
      click(retry!);
      await waitFor(() => opened.page.root.textContent.includes(LABEL));
      expect(opened.page.root.textContent).not.toContain('暂时读不到，可以重试。');
      expect(opened.page.root.textContent).toContain(LABEL);
    } finally {
      await opened.page.restore();
    }
  }, 60_000);
  /* 表一 2：三块写口回“已保存，尚未生效”时，先重读快照再画，Host 已存下的新值就在控件上。 */
  it.each([
    { block: '执行者开关', kind: 'access', route: 'workspaces/access', reason: 'the workspace access was saved but the Host configuration was not confirmed; retry the same save' },
    { block: '结构开关', kind: 'structural', route: 'structural-approval/save', reason: 'the setting was saved but the Host configuration was not confirmed; retry the same save' },
    { block: '撤回检查', kind: 'withdraw', route: 'checks/withdraw', reason: '撤回已保存，Host 还没确认；重做同一个撤回' },
  ])('S-8 $block draws the saved value and 重试 after 已保存，尚未生效 (表一 2)', async ({ kind, route, reason }) => {
    const project = await world();
    const { page, log } = await heldSettings(project, route, { status: 'rejected', code: 'unavailable', reason });
    try {
      if (kind === 'access') {
        await waitFor(() => inputBox(workspaceRow(page.root, LABEL), '允许跑命令') !== undefined);
        setBox(inputBox(workspaceRow(page.root, LABEL), '允许跑命令')!, false);
      } else if (kind === 'structural') {
        await waitFor(() => modeButton(page.root, '结构提案自动批准', '出卡问我') !== undefined);
        click(modeButton(page.root, '结构提案自动批准', '出卡问我')!);
      } else {
        await waitFor(() => checkRow(page.root, SEED) !== undefined);
        inlineWithdraw(page.root, SEED);
      }
      await settledN(log, 'settings/' + route, 1);
      let retry: FakeElement | undefined;
      if (kind === 'withdraw') {
        await waitFor(() => checkRow(page.root, SEED) === undefined);
        click(revokedFold(page.root)!);
        await turns(() => withdrawnRow(page.root, SEED) !== undefined, 5_000);
        await waitFor(() => textOf(withdrawnRow(page.root, SEED)).includes('已保存，尚未生效'));
        retry = findButton(withdrawnRow(page.root, SEED)!, '重试');
      } else {
        await waitFor(() => page.root.textContent.includes('已保存，尚未生效'));
        retry = kind === 'access'
          ? findButton(workspaceRow(page.root, LABEL)!, '重试')
          : findButton(switchRow(page.root, '结构提案自动批准')!, '重试');
        expect(kind === 'access'
          ? inputBox(workspaceRow(page.root, LABEL), '允许跑命令')!.checked === false
          : modeButton(page.root, '结构提案自动批准', '出卡问我')!.getAttribute('class')?.includes('is-on') === true)
          .toBe(true);
      }
      expect(countRoute(log, 'settings/snapshot')).toBe(2);
      expect(retry).toBeDefined();
      click(retry!);
      await settledN(log, 'settings/' + route, 2);
      await waitFor(() => !page.root.textContent.includes('已保存，尚未生效'));
    } finally {
      await page.restore();
    }
  }, 120_000);

  /* 表一 5：空 = 清空回默认，正整数 = 保存，其余在本地标红写中文原因，不发请求。 */
  it.each([
    { raw: 'abc' }, { raw: '0' }, { raw: '1.5' }, { raw: '-3' },
  ])('S-9 the command review line refuses $raw locally (表一 5)', async ({ raw }) => {
    const project = await world();
    const settings = await settingsPage(project);
    try {
      await waitFor(() => reviewLineField(settings.page.root) !== undefined);
      typeField(reviewLineField(settings.page.root)!, raw);
      click(findButton(settings.page.root, '保存')!);
      await turns(() => true, 50);
      expect(countRoute(settings.log, 'settings/command-review/save')).toBe(0);
      expect(reviewLineField(settings.page.root)!.getAttribute('class')).toContain('is-bad');
      expect(findAllClass(settings.page.root, 'err').some((entry) =>
        textOf(entry).includes('要 1 或更大的整数分钟；清空就回默认'))).toBe(true);
    } finally {
      await settings.page.restore();
    }
  }, 60_000);

  /* 表一 6：Host 的原因不上屏；每种已知原因一句中文，未知原因一句通用话并把原文写进日志。 */
  it.each([
    { act: 'access', route: 'workspaces/access', code: 'invalid', reason: 'commandsAllowed requires writeAllowed', text: '跑命令要先允许改文件' },
    { act: 'access', route: 'workspaces/access', code: 'unsupported', reason: 'the Host does not publish the workspace access switch', text: '这个工作区的权限由启动配置决定，这里改不了' },
    { act: 'access', route: 'workspaces/access', code: 'unavailable', reason: 'the settings file could not be written', text: '设置文件写不进去，可以重试' },
    { act: 'review', route: 'command-review/save', code: 'invalid', reason: 'commandReviewLineMinutes must be null or a positive integer', text: '要填正整数分钟，或者留空用默认' },
    { act: 'withdraw', route: 'checks/withdraw', code: 'invalid', reason: '这个工作区的设置里没有检查 gone-check（Host 启动配置里的检查在启动配置里改）', text: '这个工作区的设置里没有检查 gone-check（Host 启动配置里的检查在启动配置里改）' },
    { act: 'access', route: 'workspaces/access', code: 'invalid', reason: 'something unexpected', text: '没有保存成功，可以重试', unknown: true },
  ])('S-10 $route says $text instead of $reason (表一 6)', async ({ act, route, code, reason, text, unknown }) => {
    const project = await world();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { page, log } = await heldSettings(project, route, { status: 'rejected', code, reason });
    try {
      if (act === 'access') {
        await waitFor(() => inputBox(workspaceRow(page.root, LABEL), '允许跑命令') !== undefined);
        setBox(inputBox(workspaceRow(page.root, LABEL), '允许跑命令')!, false);
      } else if (act === 'review') {
        await waitFor(() => reviewLineField(page.root) !== undefined);
        typeField(reviewLineField(page.root)!, '30');
        click(findButton(page.root, '保存')!);
      } else {
        await waitFor(() => checkRow(page.root, SEED) !== undefined);
        inlineWithdraw(page.root, SEED);
      }
      await settledN(log, 'settings/' + route, 1);
      await waitFor(() => page.root.textContent.includes(text));
      if (act !== 'withdraw') expect(page.root.textContent).not.toContain(reason);
      if (unknown === true) {
        expect(logged.mock.calls.some((call) => call[0] === route && call[2] === reason)).toBe(true);
      }
    } finally {
      await page.restore();
      logged.mockRestore();
    }
  }, 90_000);

  it('S-11 a workspace with no installed check says so (表一 8)', async () => {
    const project = await world();
    const emptyRoot = await mkdtemp(join(tmpdir(), 's11-empty-'));
    cleanup.push(async () => { await rm(emptyRoot, { recursive: true, force: true }); });
    await writeAG2bWorkspace(emptyRoot);
    const opened = await project.world.settings('workspaces/open', {
      path: emptyRoot, name: 'S11 empty', projectId: project.scope.projectId,
      writeAllowed: false, commandsAllowed: false,
    });
    expect(opened.status, JSON.stringify(opened)).toBe('ready');
    const settings = await settingsPage(project);
    try {
      await waitFor(() => workspaceRow(settings.page.root, 'S11 empty') !== undefined);
      expect(findAllClass(settings.page.root, 'rl-empty').map(textOf))
        .toContain('这个工作区没有在平台里装上的检查。');
    } finally {
      await settings.page.restore();
    }
  }, 90_000);

  /* 表一 7：从 Member 进设置再返回，lineProject / lineSession 和 goal 原样带回。 */
  it('S-12 the Member round trip keeps lineProject and lineSession (表一 7)', async () => {
    const project = await world();
    const line = await project.line('s12-line');
    const search = `?goal=${encodeURIComponent(project.seedGoal.goalId)}`
      + `&lineProject=${encodeURIComponent(line.ref.projectId)}&lineSession=${encodeURIComponent(line.ref.sessionId)}`;
    const member = await bootE3N(project.world, 'Member', { search, gate: true });
    try {
      const target = boardUrlOf(findLink(member.page.root, '设置', 'Settings.dc.html')!.getAttribute('href'), 'Member.dc.html');
      expect(Object.fromEntries(target.searchParams)).toEqual({
        goal: project.seedGoal.goalId, from: 'Member',
        lineProject: line.ref.projectId, lineSession: line.ref.sessionId,
      });
      const settings = await bootE3N(project.world, 'Settings', { search: target.search, gate: true });
      try {
        const back = boardUrlOf(findLink(settings.page.root, '返回工作台', 'Member.dc.html')!.getAttribute('href'), 'Settings.dc.html');
        expect(back.pathname).toBe('/workbench/Member.dc.html');
        expect(Object.fromEntries(back.searchParams)).toEqual({
          goal: project.seedGoal.goalId,
          lineProject: line.ref.projectId, lineSession: line.ref.sessionId,
        });
      } finally {
        await settings.page.restore();
      }
    } finally {
      await member.page.restore();
    }
  }, 120_000);

  /* 备注 9：焦点在输入框里按 Esc 只失焦，不离开设置页。 */
  it('S-13 Esc in the command review field blurs it and stays on Settings (备注 9)', async () => {
    const project = await world();
    const settings = await settingsPage(project);
    try {
      await waitFor(() => reviewLineField(settings.page.root) !== undefined);
      const field = reviewLineField(settings.page.root)!;
      field.focus();
      pressKey(field, 'Escape');
      expect(document.activeElement).toBeNull();
      expect(settings.page.assigned()).toEqual([]);
    } finally {
      await settings.page.restore();
    }
  }, 60_000);
});
