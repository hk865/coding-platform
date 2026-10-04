#!/usr/bin/env node
/**
 * Task E screenshot capture over the deterministic Host started by run-host.mjs.
 *
 * Evidence harness only. Playwright is NOT a repository dependency: capture.sh
 * resolves it through `npx -p playwright@<version>` and passes the package
 * directory in PLAYWRIGHT_DIR.
 *
 *   node capture.mjs --state <run-host state.json> --out <dir> [--polling]
 *
 * Writes <out>/*.png, <out>/manifest.json and, with --polling, <out>/polling.json.
 * Every screenshot uses a fixed viewport, zh-CN locale, Asia/Shanghai time zone,
 * reduced motion, a fixed page clock (Date only; timers keep running), disabled
 * CSS animations, a hidden caret and a parked mouse, after the page has had no
 * in-flight request for QUIET_MS.
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ? join(process.env.PLAYWRIGHT_DIR, 'index.js') : 'playwright');

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};
const statePath = option('state', undefined);
const outDir = resolve(option('out', 'shots'));
const withPolling = argv.includes('--polling');
if (statePath === undefined) {
  process.stderr.write('usage: node capture.mjs --state <state.json> --out <dir> [--polling]\n');
  process.exit(2);
}
const seed = JSON.parse(await readFile(statePath, 'utf8'));
await mkdir(outDir, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const QUIET_MS = 600;
const FIXED_PAGE_TIME = new Date('2026-10-04T09:30:00+08:00');
const scopeKey = scope => JSON.stringify([scope.projectId, scope.workspaceId]);
const GLOBAL_KEY = 'workbench.display-preference.v2.global';
const scopeStorageKey = scope => `workbench.display-preference.v2.scope:${scopeKey(scope)}`;

// Rasterisation flags commonly used for repeatable screenshots; before and after must use the same set.
const CHROMIUM_ARGS = ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--disable-gpu',
  '--disable-partial-raster', '--disable-skia-runtime-opts', '--run-all-compositor-stages-before-draw'];
const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
const manifest = [];
const consoleProblems = [];
let pageCounter = 0;

/** One isolated browser context per scenario; display preferences are seeded once. */
async function openPage({ viewport = DESKTOP, colorScheme = 'light', goalId = seed.goalId, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme,
    reducedMotion: 'reduce', isMobile: mobile, hasTouch: mobile,
  });
  const entries = [
    [GLOBAL_KEY, JSON.stringify({ lastScopeKey: scopeKey(seed.scope), theme: null })],
    [scopeStorageKey(seed.scope), JSON.stringify({ goalId, sessionId: null, mainSessionId: seed.sessions.main })],
  ];
  await context.addInitScript(({ entries }) => {
    try {
      if (window.sessionStorage.getItem('__capture_seeded') === '1') return;
      for (const [key, value] of entries) window.localStorage.setItem(key, value);
      window.sessionStorage.setItem('__capture_seeded', '1');
    } catch { /* storage unavailable: the page still renders without restore */ }
  }, { entries });
  const page = await context.newPage();
  // Each page gets its own fixed instant (one minute apart, in a fixed order):
  // the UI builds request ids from Date.now() + a per-page counter, so two pages
  // on the same Host with the SAME frozen instant would replay each other's
  // idempotent requests (observed: a second page's commands/start never ran).
  await page.clock.setFixedTime(new Date(FIXED_PAGE_TIME.getTime() + (pageCounter++) * 60_000));
  const inflight = new Set();
  let lastActivity = Date.now();
  const log = [];
  const t0 = Date.now();
  page.on('request', request => {
    inflight.add(request); lastActivity = Date.now();
    const url = new URL(request.url());
    log.push({ t: Date.now() - t0, method: request.method(), path: url.pathname });
  });
  const done = request => { inflight.delete(request); lastActivity = Date.now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push({ type: message.type(), text: message.text() });
  });
  page.on('pageerror', error => consoleProblems.push({ type: 'pageerror', text: String(error) }));
  const settle = async (timeoutMs = 20_000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (inflight.size === 0 && Date.now() - lastActivity >= QUIET_MS) break;
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolvePromise =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise(undefined))))));
  };
  return { context, page, settle, log, t0: () => t0 };
}

async function shot(page, settle, file, title, steps) {
  await settle();
  await page.mouse.move(viewportOf(page).width - 2, viewportOf(page).height - 2);
  await page.waitForTimeout(50);
  const path = join(outDir, file);
  const buffer = await page.screenshot({ path, animations: 'disabled', caret: 'hide', scale: 'css' });
  manifest.push({ file, title, steps, viewport: viewportOf(page), bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex') });
  process.stderr.write(`captured ${file}\n`);
}
const viewportOf = page => page.viewportSize() ?? DESKTOP;

async function click(page, selector) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await locator.click();
}
async function centerMenu(page, settle, action, value) {
  await click(page, '[data-action="toggle-center-menu"]');
  await settle();
  await click(page, `[data-view="center-menu"] [data-action="${action}"][${action === 'set-center-mode' ? 'data-mode' : 'data-grouping'}="${value}"]`);
  await settle();
  if (await page.locator('[data-view="center-menu"]').count() > 0) {
    await click(page, '[data-action="toggle-center-menu"]');
    await settle();
  }
}
const member = id => `button[data-action="select-session"][data-session="${id}"]`;
const topTool = page => `.q-right-tools [data-action="open-page"][data-page="${page}"]`;

// ---------------------------------------------------------------------------
// Desktop walkthrough (one page, deterministic order).
// ---------------------------------------------------------------------------
{
  const { context, page, settle } = await openPage();
  await page.goto(seed.url);
  await page.locator('#region-nav').waitFor({ state: 'visible' });
  await shot(page, settle, '01-overview-main-conversation.png', '总览：项目树 + 主对话（顾问只读调查的问答）',
    ['打开 /workbench/（显示偏好预置：当前 Goal 与主对话 Session）']);

  await click(page, member(seed.sessions.work));
  await shot(page, settle, '02-member-builder-session.png', '成员“执行者”的 Session 原历史（工具卡片、失败读取、最终正文）',
    ['左侧成员列表点击“执行者”']);

  await centerMenu(page, settle, 'set-center-mode', 'observe');
  if (await page.locator('[data-view="observe"] [data-action="load-executions"]').count() > 0) {
    await click(page, '[data-view="observe"] [data-action="load-executions"]');
  }
  await shot(page, settle, '03-observe-timeline.png', '行为观察：真实 Run 时间轴与 Task 折叠',
    ['更多 → 行为观察', '读取执行事实']);

  await click(page, '[data-view="observe"] [data-action="open-execution-history"]');
  await shot(page, settle, '04-execution-history-tab.png', '右侧辅助区：Task → Run 执行记录页',
    ['行为观察中点击第一条 Run 的“查看本次执行 / 原历史”']);

  await centerMenu(page, settle, 'set-center-mode', 'chat');
  await click(page, '#region-tab-body [data-action="open-claim-session"]');
  await shot(page, settle, '05-execution-tab-claim-session.png', 'Task → Run → 原 claim 会话：右侧执行记录 + 中间完整原历史',
    ['更多 → 对话', '执行记录页点击“查看原会话 / 完整会话原历史”']);

  await centerMenu(page, settle, 'set-grouping', 'task');
  await shot(page, settle, '06-builder-task-fold.png', '对话模式 + Task 收纳（同一批保存事件按 Task 分组）',
    ['更多 → Task 收纳']);
  await centerMenu(page, settle, 'set-grouping', 'original');

  await click(page, '[data-action="toggle-aux"]');
  await click(page, member(seed.sessions.reviewer));
  await shot(page, settle, '07-member-reviewer-session.png', '成员“顾问”（关联 parser 模块）的一次只读问答',
    ['隐藏右侧辅助区', '左侧点击第二个“顾问”成员']);

  await click(page, '[data-action="toggle-archived"]');
  await settle();
  await click(page, member(seed.sessions.archived));
  await shot(page, settle, '08-archived-session.png', '已归档成员：只读显示',
    ['左侧“加载归档”', '点击归档成员']);

  await click(page, '[data-action="select-main-conversation"]');
  await click(page, topTool('tasks'));
  await shot(page, settle, '09-task-graph.png', '任务图（结构/时间焦点；未来意图节点保留）',
    ['选回主对话', '顶栏“任务图”']);

  await click(page, '#region-tab-body .q-graphnode[data-task-id="parse-result"]');
  await shot(page, settle, '10-task-node-detail.png', '任务图节点详情（下方详情区）',
    ['点击节点“解析器返回 ParseResult”']);

  await click(page, topTool('architecture'));
  await click(page, '#region-tab-body [data-action="toggle-branch"][data-module-id="app"]');
  await shot(page, settle, '11-architecture-graph.png', '架构图（包含树，展开“应用入口”分支）',
    ['顶栏“架构图”', '展开“应用入口”']);
  await click(page, '#region-tab-body .q-graphnode[data-module-id="parser"]');
  await shot(page, settle, '12-architecture-node-detail.png', '架构图节点详情（parser 模块）', ['点击模块“解析器”']);
  await click(page, '[data-action="expand-aux"]');
  await shot(page, settle, '13-architecture-aux-expanded.png', '放大辅助区后的架构图与详情', ['辅助区“放大”']);
  await click(page, '[data-action="expand-aux"]');

  await click(page, topTool('files'));
  await shot(page, settle, '14-files-directory.png', '文件资源管理器（根目录）', ['恢复辅助区宽度', '顶栏“文件树”']);
  await click(page, '#region-tab-body [data-action="open-file"][data-path="README.md"]');
  await shot(page, settle, '15-file-tab.png', '文件页（README.md）', ['目录中点击 README.md']);

  await click(page, topTool('terminal'));
  await page.locator('#region-tab-body [data-field="commandLine"]').fill('cat README.md');
  await click(page, '#region-tab-body [data-action="start-command"]');
  await page.locator('#region-tab-body [data-command-state="settled"]').waitFor({ timeout: 20_000 });
  await shot(page, settle, '16-command-page.png', '命令页：cat README.md 已结束（无 stdin / 非 PTY）',
    ['顶栏“命令”', '输入 cat README.md 并运行', '等待状态 settled']);

  await click(page, topTool('diff'));
  await shot(page, settle, '17-diff-page.png', 'Diff 页（比较表单）', ['顶栏“Diff”']);

  await click(page, '[data-action="open-settings"]');
  await shot(page, settle, '18-settings-dialog.png', '设置对话框（工作区与模型）', ['左下角“设置”']);
  await page.keyboard.press('Escape');
  await settle();

  await click(page, '[data-action="select-scope"]:has-text("示例库")');
  await shot(page, settle, '19-second-workspace.png', '切换到第二个工作区“示例库”', ['左侧项目树点击“示例库”']);
  await context.close();
}

// ---------------------------------------------------------------------------
// Dark theme and mobile width.
// ---------------------------------------------------------------------------
{
  const { context, page, settle } = await openPage({ colorScheme: 'dark' });
  await page.goto(seed.url);
  await shot(page, settle, '20-overview-dark.png', '深色主题总览（系统深色偏好）', ['prefers-color-scheme: dark 打开 /workbench/']);
  await click(page, topTool('tasks'));
  await shot(page, settle, '21-task-graph-dark.png', '深色主题任务图', ['顶栏“任务图”']);
  await context.close();
}
{
  const { context, page, settle } = await openPage({ viewport: MOBILE, mobile: true });
  await page.goto(seed.url);
  await shot(page, settle, '22-mobile-overview.png', '390×844 窄屏总览', ['移动视口打开 /workbench/']);
  await click(page, topTool('tasks'));
  await shot(page, settle, '23-mobile-task-graph.png', '390×844 窄屏任务图', ['顶栏“任务图”']);
  await context.close();
}

// ---------------------------------------------------------------------------
// Polling observation (run once; documents today's timers).
// ---------------------------------------------------------------------------
function summarize(log, fromMs, toMs) {
  const window = log.filter(entry => entry.t >= fromMs && entry.t < toMs);
  const byPath = {};
  for (const entry of window) (byPath[`${entry.method} ${entry.path}`] ??= []).push(entry.t);
  const stats = Object.fromEntries(Object.entries(byPath).map(([key, times]) => {
    const gaps = times.slice(1).map((time, index) => time - times[index]);
    const sorted = [...gaps].sort((left, right) => left - right);
    return [key, { count: times.length,
      medianIntervalMs: sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)],
      minIntervalMs: sorted[0] ?? null, maxIntervalMs: sorted.at(-1) ?? null,
      offsetsMs: times.map(time => time - fromMs) }];
  }));
  return { windowMs: toMs - fromMs, requestCount: window.length, byRoute: stats };
}

if (withPolling) {
  const polling = { capturedWith: 'Playwright request events (page.on("request")), wall-clock ms', scenarios: {} };
  // P0: idle page (completed Goal, main conversation), nothing running.
  {
    const { context, page, settle, log, t0 } = await openPage();
    await page.goto(seed.url);
    await settle();
    const from = Date.now() - t0();
    await page.waitForTimeout(30_000);
    const to = Date.now() - t0();
    polling.scenarios.idle = { description: '空闲页面：已完成的 Goal、主对话；页面加载并静止后记录 30 秒', loadRequests: summarize(log, 0, from), ...summarize(log, from, to) };
    await context.close();
  }
  // P2: one running command (nothing else running), from start until 3 s after settled.
  {
    const { context, page, settle, log, t0 } = await openPage();
    await page.goto(seed.url);
    await settle();
    await click(page, topTool('terminal'));
    await page.locator('#region-tab-body [data-field="commandLine"]').fill('sleep 8');
    const fromCommand = Date.now() - t0();
    await click(page, '#region-tab-body [data-action="start-command"]');
    await page.locator('#region-tab-body [data-command-state="settled"]').waitFor({ timeout: 30_000 });
    const settledAt = Date.now() - t0();
    await page.waitForTimeout(3_000);
    const toCommand = Date.now() - t0();
    polling.scenarios.command = {
      description: '命令页运行 sleep 8（没有其它运行中的工作）：从点击运行到 settled 后 3 秒',
      settledAfterMs: settledAt - fromCommand,
      ...summarize(log, fromCommand, toCommand),
    };
    await context.close();
  }
  // P1: a running collaboration driver (the scripted model blocks, state stays running).
  {
    const { context, page, settle, log, t0 } = await openPage({ goalId: seed.pollGoalId });
    await page.goto(seed.url);
    await settle();
    const started = await page.evaluate(async ({ scope, goalId, profiles }) => {
      const token = document.querySelector('meta[name="platform-token"]').getAttribute('content');
      const response = await fetch('/api/real/core/workflow/driver-start', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token },
        body: JSON.stringify({ scope, input: { advance: { schemaVersion: 1, goalRef: { aggregateType: 'Goal',
          projectId: scope.projectId, goalId }, flowId: 'demo-poll-flow', sessionHint: null, kind: 'select_work' },
        queryProfileIds: profiles } }),
      });
      return { status: response.status, body: await response.json() };
    }, { scope: seed.scope, goalId: seed.pollGoalId, profiles: seed.queryProfileIds });
    // Wait until the Host driver reports an active state, then trigger the page's
    // own poll exactly as a user does: switch to the other workspace and back.
    let driverState = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      driverState = await page.evaluate(async ({ scope, goalId }) => {
        const token = document.querySelector('meta[name="platform-token"]').getAttribute('content');
        const response = await fetch('/api/real/core/workflow/driver-read', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token },
          body: JSON.stringify({ scope, input: { goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId } } }),
        });
        const body = await response.json();
        return body.status === 'ready' ? body.value.state : body.status;
      }, { scope: seed.scope, goalId: seed.pollGoalId });
      if (driverState === 'running' || driverState === 'waiting_for_reply') break;
      await page.waitForTimeout(100);
    }
    await click(page, '[data-action="select-scope"]:has-text("示例库")');
    await settle();
    const fromCollab = Date.now() - t0();
    await click(page, '[data-action="select-scope"]:has-text("演示工程")');
    await page.waitForTimeout(12_000);
    const toCollab = Date.now() - t0();
    polling.scenarios.collaboration = {
      description: '协作驱动运行中（脚本模型阻塞，状态保持 running）；切到“示例库”再切回“演示工程”触发页面自己的轮询，记录 12 秒',
      driverStart: { httpStatus: started.status, status: started.body?.status ?? null, state: started.body?.value?.state ?? null },
      driverStateBeforeSwitch: driverState,
      ...summarize(log, fromCollab, toCollab),
    };
    // Both page timers at once: the driver-read poll keeps running while a short
    // command is polled (no assertion beyond recording what happened).
    await click(page, topTool('terminal'));
    await page.locator('#region-tab-body [data-field="commandLine"]').fill('sleep 1');
    const fromSide = Date.now() - t0();
    await click(page, '#region-tab-body [data-action="start-command"]');
    let sideSettled = true;
    try {
      await page.locator('#region-tab-body [data-command-state="settled"]').waitFor({ timeout: 15_000 });
    } catch { sideSettled = false; }
    const toSide = Date.now() - t0();
    const sideState = await page.locator('#region-tab-body [data-command-state]').first().getAttribute('data-command-state').catch(() => null);
    polling.scenarios.commandWhileDriverRunning = {
      description: '协作 Run 保持 running、页面仍在轮询 driver-read 时再运行 sleep 1：两种轮询并行时的请求（只记录现象）',
      settledWithin15s: sideSettled, lastCommandState: sideState,
      ...summarize(log, fromSide, toSide),
    };
    await context.close();
  }
  await writeFile(join(outDir, 'polling.json'), JSON.stringify(polling, null, 2));
}

await writeFile(join(outDir, 'manifest.json'), JSON.stringify({ viewport: { desktop: DESKTOP, mobile: MOBILE },
  fixedPageTime: { first: FIXED_PAGE_TIME.toISOString(), stepPerPageMs: 60_000, pages: pageCounter },
  chromium: { version: browser.version(), args: CHROMIUM_ARGS }, shots: manifest, consoleProblems }, null, 2));
await browser.close();
process.stderr.write(`done: ${manifest.length} screenshots${withPolling ? ' + polling.json' : ''}\n`);
