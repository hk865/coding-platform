import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { auxPanel, auxTab, callsTo, countRoute, onMain, quietPage, textOf, turns, type PageLog } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { g8Check, openG8Project, type G8Check } from '../helpers/G8-world.js';

/**
 * P4 命令页（冻结稿 11-18）C1–C7：画板读检查轮装上的检查（`verification/installed-checks`），每行经
 * `commands/start|read|stop` 运行、再运行、取消；第二个“命令”页的运行和第一页分开；工作区没开授权时“运行”不可点。
 * 世界用 G8A 的 `openG8Project`（新项目，首次采用的计划装上 `SEED`），七行共用一个：跑过的命令只记在那一页自己的
 * 表里（R2），每行开的是新页，所以 C5 不另开世界；C7 关掉授权，排在最后。页面用 `onMain` 的 stream 模式，命令自己
 * 的变化通知会让页面重读。R3 的字、圆点和输出拼法由 `P4C-commands-pure.test.ts` 的纯表守，这里只看接线。
 * 真实 bubblewrap，只跑 memory。
 * 具名改坏：C1 `readAuxPanel` 不读 `verification/installed-checks`、行不按回答的顺序；C2 页面不带 `timeoutMs`、
 * 快照不带 `executionMs`、结束后不读 `commands/read`；C3 `cwd` 回到严格规则；C4 取消发错 id、运行后不重读；
 * C5 两个命令页共用一份状态；C6 不把 `timeoutMs` 交给 Kernel；C7 画板不看 `allowed`。
 * C4 的“取消后不重读”在 stream 世界里测不出（停下时 Host 推变化通知，页面会重读），stopCommand 的重读照留。
 */

const SEED: G8Check[] = [
  g8Check('p4c-ok', 'all', 'echo p4c-ok'), { ...g8Check('p4c-fail', 'all', 'pwd; echo p4c-err >&2; exit 3'), cwd: 'src/' },
  g8Check('p4c-slow', 'all', 'sleep 30'), { ...g8Check('p4c-short', 'all', 'sleep 5'), timeoutMs: 1_000 },
];

let world: Awaited<ReturnType<typeof openG8Project>>;
beforeAll(async () => { world = await openG8Project('p4c', SEED); }, 180_000);
afterAll(async () => { await world.close(); }, 180_000);

/** 共享世界的一张新 Main 页，stream 模式，开在它的种子目标上。 */
async function onCommands(body: (page: BootedPage, log: PageLog) => Promise<void>): Promise<void> {
  await onMain(world.world, body, { search: `?goal=${world.seedGoal.goalId}`, mode: 'stream' });
}

const rowsOf = (root: FakeElement): FakeElement[] => findAllClass(auxPanel(root)!, 'cmd');
const noteOf = (root: FakeElement): string => textOf(findClass(auxPanel(root)!, 'fnote'));
const commandRowOf = (root: FakeElement, checkId: string): FakeElement | undefined => rowsOf(root)
  .find((row) => textOf(findClass(row, 'cmd-name')) === checkId);
/** 这一行里带类 `name` 的那一块（`cmd-st`、`cmd-line`、`cmd-out`、`cmd-kept`、`dot`）。 */
const partOf = (root: FakeElement, checkId: string, name: string): FakeElement | undefined => {
  const row = commandRowOf(root, checkId);
  return row === undefined ? undefined : findClass(row, name);
};
const buttonOf = (root: FakeElement, checkId: string, label: string): FakeElement | undefined =>
  findElement(commandRowOf(root, checkId)!, (element) => element.tagName.toLowerCase() === 'button' && textOf(element) === label);

/** 点这一行的按钮，再等这一页的读结束。 */
async function press(page: BootedPage, log: PageLog, checkId: string, label: string): Promise<void> {
  click(buttonOf(page.root, checkId, label)!);
  await quietPage(log);
}

/** 点 `opener`（缺省是页签条里的 `tab`），等 `tab` 选中、四行画出、读完。 */
async function openCommands(page: BootedPage, log: PageLog, tab = '命令', opener = () => auxTab(page.root, tab)): Promise<void> {
  click(opener()!);
  await turns(() => auxTab(page.root, tab)?.getAttribute('aria-selected') === 'true' && rowsOf(page.root).length > 0, 5_000);
  expect(rowsOf(page.root)).toHaveLength(4);
  await quietPage(log);
}

/** 等 `checkId` 这一行的状态句到达 `word`；等不到时报出实际的那一句。 */
async function waitWord(root: FakeElement, checkId: string, word: RegExp, timeoutMs = 15_000): Promise<void> {
  await turns(() => word.test(textOf(partOf(root, checkId, 'cmd-st'))), timeoutMs).catch(() => undefined);
  expect(textOf(partOf(root, checkId, 'cmd-st'))).toMatch(word);
}

describe('P4C 命令页 (real bubblewrap, memory)', () => {
  it('C1 lists the four installed checks in answer order and reads no command route', async () => {
    await onCommands(async (page, log) => {
      await openCommands(page, log);
      expect(rowsOf(page.root).map((row) => textOf(findClass(row, 'cmd-name'))))
        .toEqual(['p4c-ok', 'p4c-fail', 'p4c-slow', 'p4c-short']);
      expect(rowsOf(page.root).map((row) => textOf(findClass(row, 'cmd-st')))).toEqual(Array(4).fill('未运行'));
      expect(textOf(partOf(page.root, 'p4c-fail', 'cmd-line'))).toBe('pwd; echo p4c-err >&2; exit 3 · 目录 src/');
      expect(noteOf(page.root)).toBe('命令在 Host 的工作区里运行；这里不是终端，没有输入。');
      expect(countRoute(log, 'verification/installed-checks')).toBeGreaterThan(0);
      expect(['commands/start', 'commands/read', 'commands/stop'].map((route) => countRoute(log, route))).toEqual([0, 0, 0]);
    });
  }, 60_000);

  it('C2 runs p4c-ok with the check own timeout and draws its finished snapshot', async () => {
    await onCommands(async (page, log) => {
      await openCommands(page, log);
      await press(page, log, 'p4c-ok', '运行');
      await waitWord(page.root, 'p4c-ok', /^已结束 · 退出码 0 · 用时 \d+ 秒$/);
      expect(callsTo(log, 'commands/start').map((call) => call.input))
        .toEqual([{ requestId: expect.any(String), command: 'echo p4c-ok', cwd: '.', timeoutMs: 60_000 }]);
      expect(textOf(partOf(page.root, 'p4c-ok', 'cmd-out'))).toBe('p4c-ok');
      expect(buttonOf(page.root, 'p4c-ok', '再运行')).toBeDefined();
      await press(page, log, 'p4c-ok', '隐藏输出');
      expect(textOf(partOf(page.root, 'p4c-ok', 'cmd-kept'))).toBe('输出已隐藏，仍然保留（1 行）');
    });
  }, 60_000);

  it('C3 runs p4c-fail from src/ under the Kernel cwd rule', async () => {
    await onCommands(async (page, log) => {
      await openCommands(page, log);
      await press(page, log, 'p4c-fail', '运行');
      await waitWord(page.root, 'p4c-fail', /^已结束 · 退出码 3 · 用时 \d+ 秒$/);
      expect(partOf(page.root, 'p4c-fail', 'dot')?.getAttribute('class')).toBe('dot s-failed');
      expect(textOf(partOf(page.root, 'p4c-fail', 'cmd-out')).split('\n')[0]).toMatch(/\/src$/);
    });
  }, 60_000);

  it('C4 cancels p4c-slow with the commandId commands/start returned', async () => {
    await onCommands(async (page, log) => {
      await openCommands(page, log);
      await press(page, log, 'p4c-slow', '运行');
      await waitWord(page.root, 'p4c-slow', /^运行中 · 输出在结束后显示$/);
      const started = callsTo(log, 'commands/start')[0]?.reply as { value: { commandId: string } };
      await press(page, log, 'p4c-slow', '取消');
      expect(callsTo(log, 'commands/stop').map((call) => call.input)).toEqual([{ commandId: started.value.commandId }]);
      await waitWord(page.root, 'p4c-slow', /^已取消，输出保留$/);
      expect(partOf(page.root, 'p4c-slow', 'dot')?.getAttribute('class')).toBe('dot s-cancelled');
      expect(buttonOf(page.root, 'p4c-slow', '再运行')).toBeDefined();
    });
  }, 60_000);

  it('C5 keeps 命令 2 runs apart from the 命令 page', async () => {
    await onCommands(async (page, log) => {
      await openCommands(page, log);
      click(findElement(page.root, (element) => element.getAttribute('aria-label') === '新建页签')!);
      await turns(() => findButton(page.root, '再开一个命令页（命令 2）') !== undefined, 5_000);
      await openCommands(page, log, '命令 2', () => findButton(page.root, '再开一个命令页（命令 2）'));
      await press(page, log, 'p4c-ok', '运行');
      await waitWord(page.root, 'p4c-ok', /^已结束 · 退出码 0 · 用时 \d+ 秒$/);
      await openCommands(page, log);
      expect(textOf(partOf(page.root, 'p4c-ok', 'cmd-st'))).toBe('未运行');
    });
  }, 60_000);

  it('C6 stops p4c-short at its own 1000 ms timeout', async () => {
    await onCommands(async (page, log) => {
      await openCommands(page, log);
      await press(page, log, 'p4c-short', '运行');
      await waitWord(page.root, 'p4c-short', /^超时停下 · 用时 \d+ 秒$/, 20_000);
    });
  }, 60_000);

  /* B5：同一行连点两下只发一次启动；点下去这一行立刻是“正在启动”，回答后“运行中”加“取消”。 */
  it('C8 starts a double-clicked command once and shows 正在启动 at once', async () => {
    await onCommands(async (page, log) => {
      await openCommands(page, log);
      const run = buttonOf(page.root, 'p4c-slow', '运行')!;
      click(run);
      click(run);
      expect(callsTo(log, 'commands/start')).toHaveLength(1);
      expect(textOf(partOf(page.root, 'p4c-slow', 'cmd-st'))).toBe('正在启动');
      expect(partOf(page.root, 'p4c-slow', 'dot')?.getAttribute('class')).toBe('dot s-running');
      expect(buttonOf(page.root, 'p4c-slow', '运行')).toBeUndefined();
      await waitWord(page.root, 'p4c-slow', /^运行中/);
      expect(buttonOf(page.root, 'p4c-slow', '取消')).toBeDefined();
      await press(page, log, 'p4c-slow', '取消');
    });
  });

  /* C7 关掉这个工作区的“跑命令”授权，所以排在最后。 */
  it('C7 shows the no-command-authorization note and disables 运行', async () => {
    const changed = await world.world.settings('workspaces/access', {
      scope: world.scope, writeAllowed: true, commandsAllowed: false });
    expect(changed.status).toBe('ready');
    await onCommands(async (page, log) => {
      await openCommands(page, log);
      expect(noteOf(page.root)).toBe('这个工作区没有开“跑命令”的授权：命令能看，不能在这里运行。');
      const button = buttonOf(page.root, 'p4c-ok', '运行')!;
      expect([button.getAttribute('aria-disabled'), button.getAttribute('title')])
        .toEqual(['true', '这个工作区没有开“跑命令”的授权']);
      click(button);
      await quietPage(log);
      expect(countRoute(log, 'commands/start')).toBe(0);
    });
  }, 60_000);
});
