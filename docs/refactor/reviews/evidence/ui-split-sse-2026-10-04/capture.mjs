#!/usr/bin/env node
/**
 * Task E screenshot capture over the deterministic Host started by run-host.mjs.
 *
 * Evidence harness only. Playwright is NOT a repository dependency: capture.sh
 * resolves it through `npx -p playwright@<version>` and passes the package
 * directory in PLAYWRIGHT_DIR.
 *
 *   node capture.mjs --state <run-host state.json> --out <dir> [--polling] [--host-pid <pid>]
 *
 * Writes <out>/*.png, <out>/manifest.json and, with --polling, <out>/polling.json.
 * Every screenshot uses a fixed viewport, zh-CN locale, Asia/Shanghai time zone,
 * reduced motion, a fixed page clock (Date only; timers keep running), disabled
 * CSS animations, a hidden caret and a parked mouse, after the page has had no
 * in-flight request for QUIET_MS.
 *
 * Phase 2 (SSE): the change stream `GET /api/real/core/changes` stays open for
 * the page's lifetime, so it is logged like every request but never counted as
 * in flight (otherwise every shot would wait the full settle timeout). Before
 * phase 2 the page sent no such request, so the screenshot steps are unchanged.
 * The polling pages also read the stream's frames through CDP
 * (Network.streamResourceContent) and record them next to the requests. The
 * three added scenarios (fallback, fallbackAtLoad, hidden) keep their console
 * messages in polling.json, apart from the manifest's consoleProblems: a
 * Playwright route abort makes Chromium log `Failed to load resource`.
 * `--host-pid` lets the fallback scenario break the open stream (run-host.mjs
 * destroys the stream sockets on SIGUSR2); without it that scenario is skipped.
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
const hostPid = option('host-pid', undefined) === undefined ? null : Number(option('host-pid', undefined));
if (statePath === undefined) {
  process.stderr.write('usage: node capture.mjs --state <state.json> --out <dir> [--polling] [--host-pid <pid>]\n');
  process.exit(2);
}
const seed = JSON.parse(await readFile(statePath, 'utf8'));
await mkdir(outDir, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const QUIET_MS = 600;
// Phase 2: every capture-side time is monotonic. In WSL the wall clock runs fast
// and systemd-timesyncd steps it back by about 0.7 s every ~30 s, which shortened
// the after-split idle window and reordered request offsets in a trial run.
const monotonicMs = () => Math.round(performance.now());
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
/** The phase 2 change stream (one long GET per page connection). */
const CHANGES_PATH = '/api/real/core/changes';

/**
 * Read the change stream's SSE frames through CDP. Network.streamResourceContent
 * returns what arrived before it was enabled and makes every later
 * Network.dataReceived carry its bytes; chunks that arrive before that reply is
 * handled are queued, so the frames stay in order.
 */
async function observeStreamFrames(context, page, frames, now) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const connections = new Map();
  const feed = (state, base64) => {
    state.text += Buffer.from(base64, 'base64').toString('utf8');
    let cut;
    while ((cut = state.text.indexOf('\n\n')) >= 0) {
      const lines = state.text.slice(0, cut).split('\n').filter(line => line.length > 0);
      state.text = state.text.slice(cut + 2);
      if (lines.length === 0) continue;
      if (lines.every(line => line.startsWith(':'))) { frames.push({ t: now(), heartbeat: true }); continue; }
      const field = name => lines.filter(line => line.startsWith(`${name}:`)).map(line => line.slice(name.length + 1).replace(/^ /, ''));
      const text = field('data').join('\n');
      let data = text;
      try { data = JSON.parse(text); } catch { /* keep the raw text */ }
      frames.push({ t: now(), event: field('event')[0] ?? 'message', id: field('id')[0] ?? null, data });
    }
  };
  cdp.on('Network.requestWillBeSent', event => {
    if (new URL(event.request.url).pathname === CHANGES_PATH) {
      connections.set(event.requestId, { text: '', enabled: false, queued: [] });
    }
  });
  cdp.on('Network.responseReceived', event => {
    const state = connections.get(event.requestId);
    if (state === undefined) return;
    cdp.send('Network.streamResourceContent', { requestId: event.requestId }).then(result => {
      feed(state, result.bufferedData);
      state.enabled = true;
      for (const chunk of state.queued.splice(0)) feed(state, chunk);
    }).catch(error => frames.push({ t: now(), error: String(error) }));
  });
  cdp.on('Network.dataReceived', event => {
    const state = connections.get(event.requestId);
    if (state === undefined || !event.data) return;
    if (state.enabled) feed(state, event.data); else state.queued.push(event.data);
  });
}

/** One isolated browser context per scenario; display preferences are seeded once.
 * Phase 2 options (polling pages only): `observe` reads the stream frames,
 * `ownConsole` keeps console messages on the page instead of the manifest,
 * `controlVisibility` lets the scenario switch document.visibilityState. */
async function openPage({ viewport = DESKTOP, colorScheme = 'light', goalId = seed.goalId, mobile = false,
  observe = false, ownConsole = false, controlVisibility = false } = {}) {
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
  if (controlVisibility) {
    // A headless page is always visible; the scenario flips this value and sends visibilitychange.
    await context.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__captureVisibility ?? 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => (window.__captureVisibility ?? 'visible') === 'hidden' });
    });
  }
  const page = await context.newPage();
  // Each page gets its own fixed instant (one minute apart, in a fixed order):
  // the UI builds request ids from Date.now() + a per-page counter, so two pages
  // on the same Host with the SAME frozen instant would replay each other's
  // idempotent requests (observed: a second page's commands/start never ran).
  await page.clock.setFixedTime(new Date(FIXED_PAGE_TIME.getTime() + (pageCounter++) * 60_000));
  const inflight = new Set();
  let lastActivity = monotonicMs();
  const log = [];
  const t0 = monotonicMs();
  const now = () => monotonicMs() - t0;
  const streams = [];
  const streamOf = new Map();
  const frames = [];
  const pageConsole = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === CHANGES_PATH) {
      // Logged like every request, but never "in flight": it stays open.
      const entry = { index: streams.length + 1, t: now(), lastEventId: request.headers()['last-event-id'] ?? null,
        status: null, contentType: null, end: null };
      streams.push(entry);
      streamOf.set(request, entry);
      log.push({ t: entry.t, method: request.method(), path: url.pathname, stream: entry.index });
      return;
    }
    inflight.add(request); lastActivity = monotonicMs();
    log.push({ t: monotonicMs() - t0, method: request.method(), path: url.pathname });
  });
  page.on('response', response => {
    const entry = streamOf.get(response.request());
    if (entry !== undefined) { entry.status = response.status(); entry.contentType = response.headers()['content-type'] ?? null; }
  });
  const done = request => { inflight.delete(request); lastActivity = monotonicMs(); };
  page.on('requestfinished', request => {
    const entry = streamOf.get(request);
    if (entry === undefined) done(request); else entry.end = { t: now(), outcome: 'finished' };
  });
  page.on('requestfailed', request => {
    const entry = streamOf.get(request);
    if (entry === undefined) done(request); else entry.end = { t: now(), outcome: 'failed', error: request.failure()?.errorText ?? null };
  });
  page.on('console', message => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (ownConsole) pageConsole.push({ t: now(), type: message.type(), text: message.text() });
    else consoleProblems.push({ type: message.type(), text: message.text() });
  });
  page.on('pageerror', error => {
    if (ownConsole) pageConsole.push({ t: now(), type: 'pageerror', text: String(error) });
    else consoleProblems.push({ type: 'pageerror', text: String(error) });
  });
  if (observe) await observeStreamFrames(context, page, frames, now);
  const setVisibility = value => page.evaluate(next => {
    window.__captureVisibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
  const settle = async (timeoutMs = 20_000) => {
    const start = monotonicMs();
    while (monotonicMs() - start < timeoutMs) {
      if (inflight.size === 0 && monotonicMs() - lastActivity >= QUIET_MS) break;
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolvePromise =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise(undefined))))));
  };
  return { context, page, settle, log, t0: () => t0, now, streams, frames, pageConsole, setVisibility };
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

/** Phase 2: the change-stream connections alive in a window and the frames read
 * from them (offsets relative to `fromMs`, like `offsetsMs`). At most one
 * connection is open at a time, so a frame belongs to the latest connection
 * that had answered 200 when the frame was read. */
function streamWindow({ streams, frames }, fromMs, toMs) {
  const inside = time => time >= fromMs && time < toMs;
  const connectionOf = time => streams.filter(entry => entry.status === 200 && entry.t <= time).at(-1)?.index ?? null;
  return {
    connections: streams.filter(entry => entry.t < toMs && (entry.t >= fromMs || entry.end === null || entry.end.t >= fromMs))
      .map(entry => ({ stream: entry.index, startedAtMs: entry.t - fromMs, lastEventId: entry.lastEventId,
        httpStatus: entry.status, contentType: entry.contentType,
        end: entry.end === null || entry.end.t >= toMs ? 'open at window end'
          : { atMs: entry.end.t - fromMs, outcome: entry.end.outcome, error: entry.end.error ?? null } })),
    heartbeats: frames.filter(frame => frame.heartbeat === true && inside(frame.t)).length,
    events: frames.filter(frame => frame.heartbeat !== true && inside(frame.t))
      .map(({ t, heartbeat: _heartbeat, ...frame }) => ({ atMs: t - fromMs, stream: connectionOf(t), ...frame })),
  };
}

/** Consecutive phases of one scenario: each gets its own request summary. */
function phases(observed, cuts) {
  return Object.fromEntries(cuts.slice(0, -1).map(([name, fromMs], index) => {
    const toMs = cuts[index + 1][1];
    return [name, { fromMs: fromMs - cuts[0][1], ...summarize(observed.log, fromMs, toMs) }];
  }));
}

const switchScopeAwayAndBack = async (page, settle) => {
  await click(page, '[data-action="select-scope"]:has-text("示例库")');
  await settle();
  await click(page, '[data-action="select-scope"]:has-text("演示工程")');
};
const startCommand = async (page, command) => {
  await click(page, topTool('terminal'));
  await page.locator('#region-tab-body [data-field="commandLine"]').fill(command);
  await click(page, '#region-tab-body [data-action="start-command"]');
};
const commandSettled = page => page.locator('#region-tab-body [data-command-state="settled"]').waitFor({ timeout: 30_000 });
/** When the page's stream was live again: the first event read at or after
 * `afterMs` (no connection is open between the break and the reconnect). */
const liveAgainAt = (observed, afterMs) => observed.frames
  .find(frame => frame.heartbeat !== true && frame.event !== undefined && frame.t >= afterMs)?.t ?? null;

if (withPolling) {
  const polling = { capturedWith: 'Playwright request events (page.on("request")), monotonic ms (performance.now in the capture process; before/ used wall-clock ms)',
    streamFramesCapturedWith: 'phase 2: CDP Network.streamResourceContent + Network.dataReceived on GET /api/real/core/changes',
    scenarios: {} };
  // P0: idle page (completed Goal, main conversation), nothing running.
  {
    const observed = await openPage({ observe: true });
    const { context, page, settle, log, t0 } = observed;
    await page.goto(seed.url);
    await settle();
    const from = monotonicMs() - t0();
    await page.waitForTimeout(30_000);
    const to = monotonicMs() - t0();
    polling.scenarios.idle = { description: '空闲页面：已完成的 Goal、主对话；页面加载并静止后记录 30 秒', loadRequests: summarize(log, 0, from), ...summarize(log, from, to),
      streamFromLoad: streamWindow(observed, 0, to) };
    await context.close();
  }
  // P2: one running command (nothing else running), from start until 3 s after settled.
  {
    const observed = await openPage({ observe: true });
    const { context, page, settle, log, t0 } = observed;
    await page.goto(seed.url);
    await settle();
    await click(page, topTool('terminal'));
    await page.locator('#region-tab-body [data-field="commandLine"]').fill('sleep 8');
    const fromCommand = monotonicMs() - t0();
    await click(page, '#region-tab-body [data-action="start-command"]');
    await page.locator('#region-tab-body [data-command-state="settled"]').waitFor({ timeout: 30_000 });
    const settledAt = monotonicMs() - t0();
    await page.waitForTimeout(3_000);
    const toCommand = monotonicMs() - t0();
    polling.scenarios.command = {
      description: '命令页运行 sleep 8（没有其它运行中的工作）：从点击运行到 settled 后 3 秒',
      settledAfterMs: settledAt - fromCommand,
      ...summarize(log, fromCommand, toCommand),
      stream: streamWindow(observed, fromCommand, toCommand),
    };
    await context.close();
  }
  // P1: a running collaboration driver (the scripted model blocks, state stays running).
  {
    const observed = await openPage({ goalId: seed.pollGoalId, observe: true });
    const { context, page, settle, log, t0 } = observed;
    await page.goto(seed.url);
    await settle();
    const fromStart = monotonicMs() - t0();
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
    let harnessReads = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      harnessReads += 1;
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
    // Phase 2: stay on 演示工程 for 1.5 s so the notices of the driver's first
    // commits reach the page while the Goal is shown (no request ran here before).
    await page.waitForTimeout(1_500);
    const toStart = monotonicMs() - t0();
    await click(page, '[data-action="select-scope"]:has-text("示例库")');
    await settle();
    const fromCollab = monotonicMs() - t0();
    await click(page, '[data-action="select-scope"]:has-text("演示工程")');
    await page.waitForTimeout(12_000);
    const toCollab = monotonicMs() - t0();
    polling.scenarios.collaboration = {
      description: '协作驱动运行中（脚本模型阻塞，状态保持 running）；切到“示例库”再切回“演示工程”触发页面自己的轮询，记录 12 秒',
      driverStart: { httpStatus: started.status, status: started.body?.status ?? null, state: started.body?.value?.state ?? null },
      driverStateBeforeSwitch: driverState,
      ...summarize(log, fromCollab, toCollab),
      stream: streamWindow(observed, fromCollab, toCollab),
      // Phase 2: what the page did from driver-start until the switch away. The
      // driver's commits arrive as notices; the requests include the harness's own calls.
      afterDriverStart: {
        harnessRequests: { 'POST /api/real/core/workflow/driver-start': 1, 'POST /api/real/core/workflow/driver-read': harnessReads },
        ...summarize(log, fromStart, toStart),
        stream: streamWindow(observed, fromStart, toStart),
      },
    };
    // Both page timers at once: the driver-read poll keeps running while a short
    // command is polled (no assertion beyond recording what happened).
    await click(page, topTool('terminal'));
    await page.locator('#region-tab-body [data-field="commandLine"]').fill('sleep 1');
    const fromSide = monotonicMs() - t0();
    await click(page, '#region-tab-body [data-action="start-command"]');
    let sideSettled = true;
    try {
      await page.locator('#region-tab-body [data-command-state="settled"]').waitFor({ timeout: 15_000 });
    } catch { sideSettled = false; }
    const toSide = monotonicMs() - t0();
    const sideState = await page.locator('#region-tab-body [data-command-state]').first().getAttribute('data-command-state').catch(() => null);
    polling.scenarios.commandWhileDriverRunning = {
      description: '协作 Run 保持 running、页面仍在轮询 driver-read 时再运行 sleep 1：两种轮询并行时的请求（只记录现象）',
      settledWithin15s: sideSettled, lastCommandState: sideState,
      ...summarize(log, fromSide, toSide),
      stream: streamWindow(observed, fromSide, toSide),
    };
    await context.close();
  }
  // P3 (phase 2): the open stream breaks while a command and the driver read loop
  // are registered; reconnects are refused for 5 s, then allowed again.
  if (hostPid === null) {
    polling.scenarios.fallback = { skipped: 'no --host-pid: the open stream cannot be broken' };
  } else {
    const observed = await openPage({ goalId: seed.pollGoalId, observe: true, ownConsole: true });
    const { context, page, settle, now } = observed;
    await page.goto(seed.url);
    await settle();
    await switchScopeAwayAndBack(page, settle); // the P1 driver is still running: the page follows it
    await settle();
    const from = now();
    await startCommand(page, 'sleep 14');
    await page.waitForTimeout(1_000);
    await page.route(`**${CHANGES_PATH}`, route => route.abort());
    const brokenAt = now();
    process.kill(hostPid, 'SIGUSR2'); // run-host.mjs destroys the open stream's socket
    await page.waitForTimeout(5_000);
    await page.unroute(`**${CHANGES_PATH}`);
    const allowedAt = now();
    await commandSettled(page);
    const settledAt = now();
    await page.waitForTimeout(3_000);
    const to = now();
    const recoveredAt = liveAgainAt(observed, allowedAt) ?? to;
    polling.scenarios.fallback = {
      description: '流中途断开：页面在跟随运行中的 driver，并运行 sleep 14；1 秒后拦截 changes 路由（route abort）并让 Host 断开已打开的流，5 秒后解除拦截；记录到 settled 后 3 秒',
      marksMs: { streamBroken: brokenAt - from, routeAllowed: allowedAt - from, streamLiveAgain: recoveredAt - from, commandSettled: settledAt - from },
      ...summarize(observed.log, from, to),
      phases: phases(observed, [['live', from], ['fallback', brokenAt], ['recovered', recoveredAt], ['end', to]]),
      stream: streamWindow(observed, from, to),
      console: observed.pageConsole.map(({ t, ...entry }) => ({ atMs: t - from, ...entry })),
    };
    await context.close();
  }
  // P4 (phase 2): the stream is refused from the first load; allowed again 3 s after a command starts.
  {
    const observed = await openPage({ observe: true, ownConsole: true });
    const { context, page, settle, now } = observed;
    await page.route(`**${CHANGES_PATH}`, route => route.abort());
    await page.goto(seed.url);
    await settle();
    const from = now();
    await startCommand(page, 'sleep 8');
    await page.waitForTimeout(3_000);
    await page.unroute(`**${CHANGES_PATH}`);
    const allowedAt = now();
    await commandSettled(page);
    const settledAt = now();
    await page.waitForTimeout(3_000);
    const to = now();
    const recoveredAt = liveAgainAt(observed, allowedAt) ?? to;
    polling.scenarios.fallbackAtLoad = {
      description: '加载时 changes 路由就被拦截（route abort）：运行 sleep 8，3 秒后解除拦截；记录从加载到 settled 后 3 秒',
      marksMs: { commandStarted: from, routeAllowed: allowedAt, streamLiveAgain: recoveredAt, commandSettled: settledAt },
      ...summarize(observed.log, 0, to),
      phases: phases(observed, [['load', 0], ['fallback', from], ['recovered', recoveredAt], ['end', to]]),
      stream: streamWindow(observed, 0, to),
      console: observed.pageConsole.map(({ t, ...entry }) => ({ atMs: t, ...entry })),
    };
    await context.close();
  }
  // P5 (phase 2): the page is hidden for 9 s while a command and the driver read loop are registered.
  {
    const observed = await openPage({ goalId: seed.pollGoalId, observe: true, ownConsole: true, controlVisibility: true });
    const { context, page, settle, now, setVisibility } = observed;
    await page.goto(seed.url);
    await settle();
    await switchScopeAwayAndBack(page, settle);
    await settle();
    const from = now();
    await startCommand(page, 'sleep 6');
    await page.locator('#region-tab-body [data-command-state]').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(500);
    const hiddenAt = now();
    await setVisibility('hidden');
    await page.waitForTimeout(9_000);
    const visibleAt = now();
    await setVisibility('visible');
    await commandSettled(page);
    const settledAt = now();
    await page.waitForTimeout(3_000);
    const to = now();
    polling.scenarios.hidden = {
      description: '页面隐藏：页面在跟随运行中的 driver，运行 sleep 6 后把 visibilityState 设为 hidden 9 秒（命令在隐藏期间结束），再设回 visible；记录到 settled 后 3 秒',
      marksMs: { hidden: hiddenAt - from, visible: visibleAt - from, commandSettledSeen: settledAt - from },
      ...summarize(observed.log, from, to),
      phases: phases(observed, [['visible', from], ['hidden', hiddenAt], ['visibleAgain', visibleAt], ['end', to]]),
      stream: streamWindow(observed, from, to),
      console: observed.pageConsole.map(({ t, ...entry }) => ({ atMs: t - from, ...entry })),
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
