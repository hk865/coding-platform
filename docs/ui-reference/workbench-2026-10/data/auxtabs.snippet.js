/* =====================================================================
   auxtabs.snippet.js — G2: the right auxiliary area kept from the 2026-09-28 acceptance
   (任务图 / 架构图 / 文件 / 命令 / Diff + pages opened from nodes; hide, maximise, new tab, switch, close;
   two draggable dividers; file tree and file pages apart; save with a conflict example; 引用到草稿 with
   path, lines and a snippet, 草稿快照 for an unsaved selection; commands run / cancel with kept output;
   Git ↔ working tree diff, line level).
   Paste every method into the board's logic class, spread axState() into the constructor's this.state,
   and bind the markup of auxtabs.snippet.html. Needs semTreeData() from arch-semantic.js (G3) for the tree.
   Content is the moment of 10-04 14:15 (Main, Decide); other boards pass their own clock to axView().
   Every handler is state only: no timers, no DOM writes. Pointer drag uses setPointerCapture on the handle.
   ===================================================================== */

  /* ------------------------------------------------------------ state keys (spread into this.state) */
  axState() {
    return {
      ptab: 'task',                                   /* 'task' | 'arch' | 'files' | 'cmd' | 'diff' | 'f:<path>' | a node page key */
      axTabs: ['files', 'cmd', 'diff'],               /* tool tabs that are open (closable, reopened from +) */
      axPages: ['src/core/work-graph/state/task-machine.ts', 'src/app/server.ts'],   /* open file pages */
      axMax: false, axNew: false, railW: null, panelW: null, axBox: null, axDrag: null,   /* widths unset until a divider moves */
      axDirs: { src: true, 'src/core': true, 'src/core/work-graph': true, 'src/core/work-graph/state': true, 'src/app': true },
      axMore: {}, axSel: null, axEdit: {}, axDraft: {}, axText: {}, axSaved: {}, axReload: {}, axConflict: null, axCmp: null,
      axCmd: { c2: { st: 'done', shown: false, n: 1 } }, axDiff: 'src/core/work-graph/state/task-machine.ts', quotes: [], axQn: 0
    };
  }

  /* ------------------------------------------------------------ the shared fake workspace (real paths, short content) */
  axRepo() {
    if (this._axr) return this._axr;
    const TM = 'src/core/work-graph/state/task-machine.ts'; const AM = 'src/core/work-graph/state/attempt-machine.ts';
    const RC = 'src/core/work-graph/persistence/record-codecs.ts'; const SV = 'src/app/server.ts';
    const VM = 'src/core/work-graph/state/verification-machine.ts';
    const files = {};
    /* a file page shows one window of the file (from, lines) inside its real length (total); the rest is a quiet fold */
    files[TM] = { from: 80, total: 212, loaded: '14:12', lines: [
      '  const facts = readAttemptFacts(record);', '  const failureClass = deriveReworkClass(facts);', "  let counted = failureClass !== 'interrupted';",
      '  switch (failureClass) {', "    case 'check_failed':", "    case 'check_incomplete':", "      reason = 'auto-rework:' + failureClass;", '      break;',
      "    case 'cancelled':", '      counted = false;', '      break;', "    case 'interrupted':", "      reason = 'platform-interrupted';", '      break;',
      '    default:', "      reason = 'run-failed';", '  }', '  if (counted && input.autoReworks >= REWORK_LIMIT) {',
      "    return refuse('needs_decision', 'auto_rework_limit_reached');", '  }', "  return accept({ kind: 'task_requeued', failureClass, counted, reason });"] };
    files[SV] = { from: 118, total: 402, loaded: '14:09', lines: [
      '  if (suffix === CHANGES_SUFFIX) {', '    const resume = parseChangeStreamResume(req.headers[LAST_EVENT_ID_HEADER]);',
      "    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });", '    const stop = feed.subscribe(resume, (notice) => {',
      "      res.write('id: ' + notice.id + '\\n');", "      res.write('data: ' + JSON.stringify(notice) + '\\n\\n');", '    });',
      "    req.on('close', stop);", '    streams.add(res);', '    return;', '  }'],
      /* what is on disk now: 执行者 · SSE 推送 edited it at 14:11 (+38 −4, Member.dc.html call_7e2b); the window shows the heartbeat part */
      disk: { at: '14:11', by: '执行者 · SSE 推送', add: 38, del: 4, lines: [
        '  if (suffix === CHANGES_SUFFIX) {', '    const resume = parseChangeStreamResume(req.headers[LAST_EVENT_ID_HEADER]);',
        "    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });", '    const stop = feed.subscribe(resume, (notice) => {',
        "      res.write('id: ' + notice.id + '\\n');", "      res.write('data: ' + JSON.stringify(notice) + '\\n\\n');", '    });',
        '    const beat = setInterval(() => {', "      res.write(': heartbeat\\n\\n');", '    }, HEARTBEAT_MS);',
        "    req.on('close', () => {", '      clearInterval(beat);', '      stop();', '    });', '    streams.add(res);', '    return;', '  }'] } };
    files['src/app/core-routes.ts'] = { from: 1, total: 2134, loaded: '14:15', lines: [
      '/**', ' * Core HTTP routes of the workbench: goals, tasks, members and files.', ' * Every route parses its payload, then calls one port; no route touches the', ' * RecordStore directly.', ' */',
      "import type { CoreRouteSuffix, CoreScope } from './core-http-types.js';", "import { createHostCoreCallContext } from './core-call-context.js';", '',
      'export const CORE_ROUTE_SPECS = [', "  { suffix: 'goals/list', method: 'POST', port: 'workflow' },", "  { suffix: 'goals/show', method: 'POST', port: 'workflow' },",
      "  { suffix: 'tasks/graph', method: 'POST', port: 'workGraph' },", "  { suffix: 'members/list', method: 'POST', port: 'workGraph' },", "  { suffix: 'files/read', method: 'POST', port: 'workspace' },", '] as const;'] };
    files['src/ui/views.ts'] = { from: 1, total: 88, loaded: '14:15', lines: [
      "import { renderConversation } from './views/conversation/center.js';", "import { renderGraphs } from './views/graphs/interaction.js';",
      "import { renderFiles } from './views/files/render.js';", "import { renderShell } from './views/shell/layout.js';", '',
      '/** The workbench views: rail, conversation and the right-hand pages. */', 'export function renderViews(state: WorkbenchState): void {',
      '  renderShell(state);', '  renderConversation(state);', '  renderGraphs(state);', '  renderFiles(state);', '}'] };
    files['package.json'] = { from: 1, total: 22, loaded: '14:15', lines: [
      '{', '  "name": "coding-platform-next",', '  "private": true,', '  "type": "module",', '  "engines": {', '    "node": ">=24.15.0 <25"', '  },', '  "scripts": {',
      '    "check:architecture": "node scripts/check-boundaries.mjs",', '    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.ui.json",',
      '    "build": "tsc -p tsconfig.build.json && node scripts/build-workbench.mjs",', '    "test": "vitest run --maxWorkers=1",', '    "verify:isolated": "node scripts/verify-isolated.mjs"',
      '  },', '  "dependencies": {', '    "marked": "18.0.14",', '    "typescript": "6.0.3"', '  },', '  "devDependencies": {', '    "vitest": "4.1.10"', '  }', '}'] };
    /* Git ↔ working tree at 14:15: the uncommitted changes of goal 1 (Chain.dc.html and Member.dc.html name the counts).
       by = the task whose runs made the change, as the boards tell it: 重新入队与失败类别 (T13) task-machine.ts, attempt-machine.ts
       and record-codecs.ts (Chain: "record-codecs.ts 读取旧记录时类别留空"); SSE 推送 (T28) server.ts, attention-observer.ts and
       main.ts (Member: "已改 3 个文件"); 检查不完整判定 (T21) verification-machine.ts (Decide q1: lint 第 3 行、第 88 行) */
    const H = (head, oldAt, newAt, rows) => ({ head: head, oldAt: oldAt, newAt: newAt, rows: rows });
    const changed = [
      { path: TM, add: 15, del: 6, by: '重新入队与失败类别', hunks: [
        H('@@ -66,6 +66,15 @@ 重新入队 · task_requeued', 66, 66, [[' ', 'export function requeueTask(record: TaskRecord, input: RequeueInput) {'], [' ', "  let reason = '';"],
          ['-', "  const failureClass = input.failureClass ?? 'run_failed';"], ['-', '  const counted = true;'], ['-', "  if (input.autoReworks >= 3) return refuse('needs_decision', 'limit');"],
          ['+', '  if (input.failureClass !== undefined) {'], ['+', "    return refuse('invalid', 'failure_class_is_derived');"], ['+', '  }'], ['+', '  const lease = record.lease;'],
          ['+', "  if (lease && lease.state === 'held') {"], ['+', "    return refuse('conflict', 'lease_still_held');"], ['+', '  }'], ['+', '  const attempt = record.attempt + 1;'],
          ['+', '  const brief = input.continuationBriefRef ?? null;'], ['+', '  const actor = input.actorClass;'], ['+', "  if (!actor) return refuse('invalid', 'actor_required');"], ['+', ''],
          [' ', '  const facts = readAttemptFacts(record);']]),
        H('@@ -79,7 +88,8 @@', 79, 88, [[' ', "    case 'cancelled':"], [' ', '      counted = false;'], ['+', '      break;'], [' ', "    case 'interrupted':"]]),
        H('@@ -121,7 +131,6 @@ 读取旧记录', 121, 131, [[' ', '  const record = readRecord(raw);'], ['-', '  const legacyClass = readLegacyClass(record);'], ['-', '  if (legacyClass) record.failureClass = legacyClass;'],
          ['-', '  delete record.legacyClass;'], ['+', '  // 类别由事实推导，不再读旧字段'], ['+', '  const failureClass = deriveReworkClass(readAttemptFacts(record));'], [' ', '  return { record, failureClass };']])] },
      { path: AM, add: 9, del: 2, by: '重新入队与失败类别', hunks: [
        H('@@ -31,6 +31,13 @@ 结束一次尝试', 31, 31, [[' ', 'export function endAttempt(attempt: AttemptRecord, outcome: RunOutcome) {'],
          ['-', "  const failureClass = outcome.failureClass ?? 'run_failed';"], ['-', '  return { ...attempt, phase: outcome.phase, failureClass };'],
          ['+', '  const facts = readOutcomeFacts(outcome);'], ['+', '  const failureClass = deriveFailureClass(facts);'], ['+', "  if (failureClass === 'unknown') {"],
          ['+', "    return refuse('needs_decision', 'result_unknown');"], ['+', '  }'], ['+', '  return {'], ['+', '    ...attempt, phase: outcome.phase, failureClass,'],
          ['+', "    counted: failureClass !== 'interrupted',"], ['+', '  };'], [' ', '}']])] },
      { path: RC, add: 14, del: 2, by: '重新入队与失败类别', hunks: [
        H('@@ -168,7 +168,19 @@ 重新入队记录 · 解码', 168, 168, [[' ', 'export function decodeRequeue(raw: unknown): RequeueRecord {'], [' ', '  return {'],
          ['-', '    failureClass: requiredEnum(raw.failureClass, REWORK_CLASSES),'], ['-', "    actorClass: requiredEnum(raw.actorClass, ACTOR_CLASSES),"],
          ['+', '    // 类别只作审计副本；10-02 之前的记录没有这个字段'], ['+', '    failureClass: optionalEnum(raw.failureClass, REWORK_CLASSES),'],
          ['+', "    actorClass: optionalEnum(raw.actorClass, ACTOR_CLASSES) ?? 'system',"], ['+', '    autoRework: decodeAutoRework(raw.autoRework),'], ['+', '  };'], ['+', '}'], ['+', ''],
          ['+', 'function decodeAutoRework(raw: unknown): AutoRework {'], ['+', "  if (raw === undefined) return { used: 0, limit: 3 };"], ['+', '  return {'],
          ['+', '    used: requiredInt(raw.used), limit: requiredInt(raw.limit),'], ['+', '  };'], ['+', '}'], [' ', '']])] },
      { path: SV, add: 38, del: 4, by: 'SSE 推送', hunks: [], note: '执行者 · SSE 推送 14:11 的改动：SSE 推送的心跳与断开处理' },
      { path: 'src/app/attention-observer.ts', add: 21, del: 6, by: 'SSE 推送', hunks: [], note: '执行者 · SSE 推送 13:58 的改动' },
      { path: 'src/ui/main.ts', add: 17, del: 9, by: 'SSE 推送', hunks: [], note: '执行者 · SSE 推送 14:03 的改动：改成订阅推送，断线时退回轮询' },
      { path: VM, add: 7, del: 1, by: '检查不完整判定', hunks: [
        H('@@ -1,3 +1,4 @@ 导入', 1, 1, [[' ', "import type { CheckReport, VerificationRound } from '../model/contracts.js';"], [' ', "import { transition } from './transition.js';"],
          ['+', "import { readCheckFacts } from '../evidence/evidence-service.js';"], [' ', "import { deriveReworkClass } from './task-failure.js';"]]),
        H('@@ -82,4 +83,9 @@ 判定检查不完整', 82, 83, [[' ', 'export function judgeRound(round: VerificationRound, report: CheckReport | null) {'],
          ['-', "  if (!report) return 'failed';"], ['+', '  const facts = readCheckFacts(round);'], ['+', '  if (!report || facts.interrupted) {'], ['+', "    return 'incomplete';"], ['+', '  }'],
          ['+', '  const missing = facts.expected.filter((k) => !report.items[k]);'], ['+', "  if (report.items.length < facts.expected.length) return 'incomplete';"],
          [' ', "  return report.failed.length ? 'failed' : 'passed';"], [' ', '}']])] }
    ];
    const cmds = [
      { id: 'c1', name: '类型检查', line: 'npm run typecheck', out: ['> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.ui.json', '0 个错误'], took: '41 秒', exit: 0 },
      { id: 'c2', name: '状态机单元测试', line: 'npm test -- tests/state', out: ['> vitest run --maxWorkers=1 tests/state', ' 通过  tests/state/task-machine.test.ts（18）', ' 通过  tests/state/attempt-machine.test.ts（13）', '31 个通过'], took: '6 秒', exit: 0 },
      { id: 'c3', name: '全部测试', line: 'npm test', long: true, out: ['> vitest run --maxWorkers=1', ' 通过  tests/state（31）', ' 通过  tests/work-graph（214）', ' … 已完成 245 / 612'], took: '' },
      { id: 'c4', name: '边界检查', line: 'npm run check:architecture', out: ['> node scripts/check-boundaries.mjs', '0 处越界'], took: '3 秒', exit: 0 },
      { id: 'c5', name: '构建', line: 'npm run build', out: ['> tsc -p tsconfig.build.json && node scripts/build-workbench.mjs', '工作台已构建'], took: '18 秒', exit: 0 }
    ];
    this._axr = { files: files, changed: changed, cmds: cmds };
    return this._axr;
  }

  /* the repository's folders and files (from semTreeData, arch-semantic.js), parsed once */
  axTree() {
    if (this._axt) return this._axt;
    const str = this.semTreeData(); let i = 0;
    const parse = (base) => {
      const out = [];
      while (i < str.length) {
        let j = i;
        while (j < str.length && str[j] !== '{' && str[j] !== ',' && str[j] !== '}') j += 1;
        const name = str.slice(i, j); i = j; const path = base ? base + '/' + name : name;
        if (str[i] === '{') { i += 1; out.push({ name: name, path: path, kids: parse(path) }); } else out.push({ name: name, path: path, kids: null });
        if (str[i] === ',') { i += 1; continue; }
        if (str[i] === '}') { i += 1; break; }
      }
      return out.sort((a, b) => (!!b.kids - !!a.kids) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    };
    this._axt = parse('');
    return this._axt;
  }

  /* the repository's real files and folders (the 文件 tree's data), for "can this path be opened" (axRepo() first: a board
     at another moment may add files to the tree there) */
  axPaths() {
    this.axRepo();
    if (this._axp) return this._axp;
    const files = new Set(); const dirs = new Set();
    const w = (list) => list.forEach((n) => { if (n.kids) { dirs.add(n.path); w(n.kids); } else files.add(n.path); });
    w(this.axTree());
    this._axp = { files: files, dirs: dirs };
    return this._axp;
  }

  /* a path in a map's detail (文件, 路径) and on node pages (markup: .d-fline): a file opens its page in the auxiliary area,
     a folder opens 文件 at it, a changed file also offers 看 Diff; a path not in the repository (a planned file) stays text */
  axFileItem(path) {
    const P = this.axPaths(); const isFile = P.files.has(path); const isDir = !isFile && P.dirs.has(path);
    const changed = isFile && this.axRepo().changed.some((f) => f.path === path);
    const a = String(path).split('/'); const noop = () => {};
    return { full: path, parts: a.map((x, i) => (i < a.length - 1 ? x + '/' : x)), canOpen: isFile || isDir, cantOpen: !isFile && !isDir,
      open: isFile ? () => this.axOpenFile(path) : isDir ? () => this.axRevealDir(path) : noop,
      tip: isFile ? '打开文件：' + path : isDir ? '在“文件”里展开：' + path : path + '（仓库里还没有这个文件）',
      hasDiff: changed, diff: changed ? () => this.axOpenDiff(path) : noop };
  }
  /* open a file as its own page tab; a changed file's Diff; 文件 opened at a folder (the panel shows if it was hidden) */
  axOpenFile(path) {
    const st = this.state || {};
    const pages = (st.axPages || []).indexOf(path) >= 0 ? st.axPages : (st.axPages || []).concat([path]);
    this.setState({ axPages: pages, ptab: 'f:' + path, axSel: null, axNew: false, panel: true, hover: null });
  }
  axOpenDiff(path) {
    const st = this.state || {};
    this.setState({ axTabs: (st.axTabs || []).indexOf('diff') >= 0 ? st.axTabs : (st.axTabs || []).concat(['diff']), ptab: 'diff', axDiff: path, axCmp: null, axNew: false, panel: true, hover: null });
  }
  axRevealDir(path) {
    const st = this.state || {};
    const d = Object.assign({}, st.axDirs || {}); const parts = String(path).split('/');
    parts.forEach((x, i) => { d[parts.slice(0, i + 1).join('/')] = true; });
    this.setState({ axTabs: (st.axTabs || []).indexOf('files') >= 0 ? st.axTabs : (st.axTabs || []).concat(['files']), ptab: 'files', axDirs: d, axNew: false, panel: true, hover: null });
  }

  /* line-level diff of two short texts (longest common subsequence) → rows [sign, oldNo, newNo, text];
     in a changed block the removed lines come before the added ones, as in git diff */
  axLineDiff(a, b, from) {
    const n = a.length; const m = b.length; const L = [];
    for (let x = 0; x <= n; x += 1) { L.push([]); for (let y = 0; y <= m; y += 1) L[x].push(0); }
    for (let x = n - 1; x >= 0; x -= 1) for (let y = m - 1; y >= 0; y -= 1) L[x][y] = a[x] === b[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
    const rows = []; let x = 0; let y = 0;
    while (x < n || y < m) {
      if (x < n && y < m && a[x] === b[y]) { rows.push([' ', from + x, from + y, a[x]]); x += 1; y += 1; }
      else if (x < n && (y >= m || L[x + 1][y] >= L[x][y + 1])) { rows.push(['-', from + x, null, a[x]]); x += 1; }
      else { rows.push(['+', null, from + y, b[y]]); y += 1; }
    }
    return rows;
  }

  /* ------------------------------------------------------------ everything the markup binds: ax.*
     s = this.state; o = { at: '14:15' (the board's clock), extra: [{ key, name }] node pages (Main's s.extra) } */
  axView(s, o) {
    const set = (p) => this.setState(p);
    const cur = () => this.state || {};
    o = o || {}; const at = o.at || '14:15';
    const repo = this.axRepo(); const ptab = s.ptab || 'task';
    const noop = () => {};
    const go = (key) => set({ ptab: key, axNew: false, hover: null });
    /* ---- tabs */
    const toolName = { files: '文件', cmd: '命令', diff: 'Diff' };
    /* a second (third …) 命令 page is 'cmd:2' (…): its own runs and output, named 命令 2, so several terminals tell apart */
    const cmdN = (k) => { const m = /^cmd:(\d+)$/.exec(String(k)); return m ? +m[1] : 0; };
    const toolOf = (k) => toolName[k] || (cmdN(k) ? '命令 ' + cmdN(k) : '');
    const isCmdTab = ptab === 'cmd' || cmdN(ptab) > 0;
    const isDirty = (p) => cur().axDraft && cur().axDraft[p] !== undefined;
    const closeTab = (key) => {
      const c = cur(); const patch = {};
      if (toolOf(key)) patch.axTabs = (c.axTabs || []).filter((k) => k !== key);
      else if (key.indexOf('f:') === 0) patch.axPages = (c.axPages || []).filter((p) => 'f:' + p !== key);
      else patch.extra = (c.extra || []).filter((y) => y.key !== key);
      if ((c.ptab || 'task') === key) patch.ptab = 'task';
      set(patch);
    };
    /* file pages with the same name (src/app/main.ts, src/ui/main.ts) get the shortest parent that tells them apart, in
       front ("app/main.ts" / "ui/main.ts": under the strip's name cap the part that differs is the part that stays);
       a file tab's title and close label carry its full path, a node page's its name */
    const twins = {}; const tabName = {};
    (s.axPages || []).forEach((p) => { const b = p.split('/').pop(); (twins[b] = twins[b] || []).push(p); });
    Object.keys(twins).forEach((b) => {
      const ps = twins[b]; if (ps.length < 2) { tabName[ps[0]] = b; return; }
      const dirs = ps.map((p) => p.split('/').slice(0, -1)); const most = Math.max.apply(null, dirs.map((d) => d.length));
      let k = 1; const tail = (d) => d.slice(Math.max(0, d.length - k)).join('/');
      while (k < most && new Set(dirs.map(tail)).size < ps.length) k += 1;
      ps.forEach((p, i) => { tabName[p] = tail(dirs[i]) ? tail(dirs[i]) + '/' + b : b; });
    });
    const tab = (key, name, closable, extraCls, tip) => {
      const on = ptab === key;
      return { key: key, name: name, on: on, cls: 'tab' + (extraCls || '') + (on ? ' is-on' : ''), pick: () => go(key), canClose: closable, tip: tip || null,
        close: () => closeTab(key), closeLabel: '关闭 ' + (tip || name), dirty: key.indexOf('f:') === 0 && isDirty(key.slice(2)) };
    };
    /* every tab has a title: the map or the tool, a file's full path, a node page's name; a node page whose name a file page
       also has (task-machine.ts as a file and as a node) reads "name · 节点" */
    const fileNames = new Set((s.axPages || []).map((p) => tabName[p] || p.split('/').pop()));
    const TIP = { task: '任务图', arch: '架构图', files: '文件：工作区的目录树', diff: 'Diff：Git（HEAD）↔ 工作区，逐行' };
    const tabs = [tab('task', '任务图', false, '', TIP.task), tab('arch', '架构图', false, '', TIP.arch)]
      .concat((s.axTabs || []).map((k) => tab(k, toolOf(k), true, '', TIP[k] || toolOf(k) + '：项目的命令，输出隐藏后仍保留')))
      .concat((s.axPages || []).map((p) => tab('f:' + p, tabName[p] || p.split('/').pop(), true, ' is-file', p)))
      .concat((o.extra || s.extra || []).map((x) => tab(x.key, fileNames.has(x.name) ? x.name + ' · 节点' : x.name, true, '', '节点详情：' + x.name)));
    const newItems = [['files', '文件'], ['cmd', '命令'], ['diff', 'Diff']].map((p) => {
      const open = (s.axTabs || []).indexOf(p[0]) >= 0;
      return { label: p[1], open: open, cls: 'menu-item' + (open ? ' is-on' : ''),
        go: () => { const c = cur(); set({ axTabs: open ? c.axTabs : (c.axTabs || []).concat([p[0]]), ptab: p[0], axNew: false, panel: true }); } };
    });
    /* with 命令 open, + also opens another 命令 page (the next free number) */
    if ((s.axTabs || []).indexOf('cmd') >= 0) {
      const used = (s.axTabs || []).map(cmdN); let nx = 2; while (used.indexOf(nx) >= 0) nx += 1;
      newItems.splice(2, 0, { label: '再开一个命令页（命令 ' + nx + '）', open: false, cls: 'menu-item',
        go: () => { const c = cur(); set({ axTabs: (c.axTabs || []).concat(['cmd:' + nx]), ptab: 'cmd:' + nx, axNew: false, panel: true }); } });
    }
    /* ---- dividers: pointer drag (captured on the handle) and keyboard arrows. The widths stay unset (railW / panelW
       null: the shell keeps the CSS widths of each window size, 232 / 480 and 208 / 420 at ≤ 1240px) until you drag a
       divider or use its keys; the container's real width comes with every pointer, key or focus event on a divider
       (axBox) and sets the limits, aria-valuemax and the width a drag starts from; Home and double-click go back to the
       CSS width. o.rail === false: a board without a rail (Goals) — the panel may then take all but 360px */
    const hasRail = o.rail !== false;
    const boxW = (e) => (e && e.currentTarget && e.currentTarget.parentNode && e.currentTarget.parentNode.clientWidth) || cur().axBox || 1440;
    const defW = (side, W) => (side === 'rail' ? (W <= 1240 ? 208 : 232) : (W <= 1240 ? 420 : 480));
    const railOf = (W, c) => (hasRail ? c.railW || defW('rail', W) : 0);
    const clamp = (v, r) => Math.round(Math.max(r[0], Math.min(r[1], v)));
    const W0 = s.axBox || 1440;
    const handle = (side) => {
      const key = side === 'rail' ? 'railW' : 'panelW'; const dir = side === 'rail' ? 1 : -1;
      const range = (W, c) => (side === 'rail' ? [180, 360] : [360, Math.max(360, W - railOf(W, c) - 360)]);
      const put = (v, W) => { const p = { axBox: W }; p[key] = v; set(p); };
      return {
        down: (e) => {
          if (e && e.button !== undefined && e.button !== 0) return;
          if (e && e.currentTarget && e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
          const W = boxW(e); set({ axDrag: { side: side, x: e ? e.clientX : 0, w: cur()[key] || defW(side, W), total: W }, axBox: W });
        },
        move: (e) => { const c = cur(); const d = c.axDrag; if (!d || d.side !== side) return; const p = {}; p[key] = clamp(d.w + dir * ((e ? e.clientX : d.x) - d.x), range(d.total, c)); set(p); },
        up: () => { if (cur().axDrag) set({ axDrag: null }); },
        key: (e) => {
          const k = e && e.key; const c = cur(); const W = boxW(e); const r = range(W, c); const w = c[key] || defW(side, W); const step = e && e.shiftKey ? 64 : 16;
          let v;
          if (k === 'ArrowLeft') v = w - dir * step; else if (k === 'ArrowRight') v = w + dir * step; else if (k === 'Home') v = null; else if (k === 'End') v = r[1]; else return;
          if (e.preventDefault) e.preventDefault();
          put(v === null ? null : clamp(v, r), W);
        },
        reset: () => { const p = {}; p[key] = null; set(p); },
        seen: (e) => { const W = boxW(e); if (cur().axBox !== W) set({ axBox: W }); },
        cls: 'split-handle for-' + side + (s.axDrag && s.axDrag.side === side ? ' is-drag' : ''),
        min: side === 'rail' ? 180 : 360, max: range(W0, s)[1], now: s[key] || defW(side, W0)
      };
    };
    /* ---- files: the directory tree (one row per open level; 100 per folder, then 再显示 100 个) */
    const changedBy = {}; repo.changed.forEach((f) => { changedBy[f.path] = f; });
    const rows = [];
    const walk = (list, depth) => {
      const shown = 100 + ((s.axMore || {})[list.dirPath] || 0);
      list.items.slice(0, shown).forEach((n) => {
        if (n.kids) {
          const open = !!(s.axDirs || {})[n.path];
          rows.push({ key: n.path, isDir: true, isFile: false, name: n.name, cls: 'frow d' + Math.min(depth, 9) + (open ? ' is-open' : ''), meta: '', hasMeta: false, ex: open,
            go: () => { const d = Object.assign({}, cur().axDirs || {}); if (d[n.path]) delete d[n.path]; else d[n.path] = true; set({ axDirs: d }); } });
          if (open) walk({ dirPath: n.path, items: n.kids }, depth + 1);
        } else {
          const ch = changedBy[n.path];
          rows.push({ key: n.path, isDir: false, isFile: true, name: n.name, cls: 'frow d' + Math.min(depth, 9) + (ptab === 'f:' + n.path ? ' is-on' : ''), ex: null,
            meta: ch ? '+' + ch.add + ' −' + ch.del : '', hasMeta: !!ch, addTxt: ch ? '+' + ch.add : '', delTxt: ch ? '−' + ch.del : '',
            go: () => { const c = cur(); const pages = (c.axPages || []).indexOf(n.path) >= 0 ? c.axPages : (c.axPages || []).concat([n.path]); set({ axPages: pages, ptab: 'f:' + n.path, axSel: null }); } });
        }
      });
      if (list.items.length > shown) rows.push({ key: list.dirPath + ':more', isDir: false, isFile: false, isMore: true, name: '再显示 100 个（共 ' + list.items.length + ' 个）', cls: 'frow is-more d' + Math.min(depth, 9),
        meta: '', hasMeta: false, ex: null, go: () => { const m = Object.assign({}, cur().axMore || {}); m[list.dirPath] = (m[list.dirPath] || 0) + 100; set({ axMore: m }); } });
    };
    if (ptab === 'files') walk({ dirPath: '', items: this.axTree() }, 0);
    /* ---- a file page */
    let fp = null;
    if (ptab.indexOf('f:') === 0) {
      const path = ptab.slice(2); const F = repo.files[path];
      const reloaded = !!(s.axReload || {})[path];
      const baseLines = F ? ((s.axText || {})[path] || (reloaded && F.disk ? F.disk.lines : F.lines)) : [];
      const draft = (s.axDraft || {})[path];
      const lines = draft !== undefined ? draft.split('\n') : baseLines;
      const from = F ? F.from : 1; const to = from + lines.length - 1;
      const sel = s.axSel && s.axSel.path === path ? s.axSel : null;
      const editing = !!(s.axEdit || {})[path];
      const dirty = draft !== undefined;
      const pick = (no) => (e) => {
        const c = cur(); const prev = c.axSel && c.axSel.path === path ? c.axSel : null;
        if (e && e.shiftKey && prev) set({ axSel: { path: path, anchor: prev.anchor, a: Math.min(prev.anchor, no), b: Math.max(prev.anchor, no) } });
        else if (prev && prev.a === no && prev.b === no) set({ axSel: null });
        else set({ axSel: { path: path, anchor: no, a: no, b: no } });
      };
      const codeRows = [];
      if (F && from > 1) codeRows.push({ fold: true, line: false, text: '第 1–' + (from - 1) + ' 行，原型没有收录', cls: 'fl is-fold' });
      lines.forEach((t, k) => { const no = from + k; const on = !!sel && no >= sel.a && no <= sel.b;
        codeRows.push({ fold: false, line: true, no: no, text: t, cls: 'fl' + (on ? ' is-sel' : ''), pick: pick(no), label: '选中第 ' + no + ' 行；按住 Shift 再点一行，选中一段' }); });
      if (F && to < F.total) codeRows.push({ fold: true, line: false, text: '第 ' + (to + 1) + '–' + F.total + ' 行，原型没有收录', cls: 'fl is-fold' });
      const savedAt = (s.axSaved || {})[path];
      const conflict = s.axConflict === path && F && F.disk;
      const saveNow = () => {
        const c = cur(); const d = (c.axDraft || {})[path]; if (d === undefined) return;
        const t = Object.assign({}, c.axText || {}); t[path] = d.split('\n');
        const dr = Object.assign({}, c.axDraft || {}); delete dr[path];
        const sv = Object.assign({}, c.axSaved || {}); sv[path] = at;
        set({ axText: t, axDraft: dr, axSaved: sv, axConflict: null });
      };
      /* quotes of this file waiting in the draft: with nothing selected the bar says so (the composer may be hidden by 放大
         or by a decision card) */
      const nQf = (s.quotes || []).filter((q) => q.path === path).length;
      const snippet = (a, b) => { const k = Math.max(0, a - from); const t = (lines.slice(k, k + (b - a + 1)).filter((x) => x.trim())[0] || '').trim(); return t.length > 56 ? t.slice(0, 55) + '…' : t; };
      fp = {
        path: path, name: path.split('/').pop(), parts: path.split('/').map((x, k, a) => (k < a.length - 1 ? x + '/' : x)), known: !!F,
        state: !F ? '原型没有收录这个文件的内容' : dirty ? '未保存的修改' : savedAt ? '已保存 ' + savedAt : reloaded ? '已重新载入 ' + at : '载入于 ' + F.loaded,
        stateCls: 'fp-state' + (dirty ? ' tx-waiting' : ''), rows: codeRows, editing: editing, viewing: !editing, draftText: lines.join('\n'),
        editLabel: editing ? '查看' : '编辑', toggleEdit: () => { const e = Object.assign({}, cur().axEdit || {}); if (e[path]) delete e[path]; else e[path] = true; set({ axEdit: e }); },
        onEdit: (e) => { const d = Object.assign({}, cur().axDraft || {}); d[path] = e && e.target ? e.target.value : lines.join('\n'); set({ axDraft: d }); },
        onSelect: (e) => { const t = e && e.target; if (!t || t.selectionStart === t.selectionEnd) return; const v = String(t.value);
          const a = from + v.slice(0, t.selectionStart).split('\n').length - 1; const b = from + v.slice(0, Math.max(t.selectionStart, t.selectionEnd - 1)).split('\n').length - 1;
          set({ axSel: { path: path, anchor: a, a: a, b: b } }); },
        canSave: dirty, cantSave: !dirty, saveCls: 'btn btn-sm btn-line' + (dirty ? '' : ' is-off'),
        save: () => { const c = cur(); if ((c.axDraft || {})[path] === undefined) return; if (F && F.disk && !(c.axReload || {})[path] && !(c.axSaved || {})[path]) set({ axConflict: path }); else saveNow(); },
        hasSel: !!sel, selText: sel ? (sel.a === sel.b ? '已选第 ' + sel.a + ' 行' : '已选第 ' + sel.a + '–' + sel.b + ' 行') : '',
        barText: sel ? (sel.a === sel.b ? '已选第 ' + sel.a + ' 行' : '已选第 ' + sel.a + '–' + sel.b + ' 行') + (dirty ? '（未保存，引用的是草稿快照）' : '')
          : nQf ? '已引用到草稿（' + nQf + ' 条），还没有发送'
          : F ? (editing ? '在编辑框里选中几行，再引用' : '点行号选中一行，按住 Shift 再点一行选中一段') : '可以把整个文件引用到草稿',
        quoteLabel: sel ? '引用到草稿' : '把整个文件引用到草稿', clearSel: () => set({ axSel: null }),
        quote: () => {
          const c = cur(); const n = (c.axQn || 0) + 1;
          const q = sel ? { id: 'q' + n, path: path, a: sel.a, b: sel.b, snip: snippet(sel.a, sel.b), snap: dirty } : { id: 'q' + n, path: path, a: null, b: null, snip: F ? snippet(from, to) : '', snap: dirty };
          set({ quotes: (c.quotes || []).concat([q]), axQn: n, axSel: null });
        },
        conflict: !!conflict, conflictText: conflict ? '磁盘上的 ' + path.split('/').pop() + ' 在 ' + F.disk.at + ' 被 ' + F.disk.by + ' 改过（+' + F.disk.add + ' −' + F.disk.del + '），晚于你载入的版本（' + F.loaded + '）。' : '',
        reload: () => { const c = cur(); const r = Object.assign({}, c.axReload || {}); r[path] = true; const dr = Object.assign({}, c.axDraft || {}); delete dr[path]; set({ axReload: r, axDraft: dr, axConflict: null }); },
        compare: () => set({ ptab: 'diff', axCmp: path, axTabs: (cur().axTabs || []).indexOf('diff') >= 0 ? cur().axTabs : (cur().axTabs || []).concat(['diff']) }),
        overwrite: () => saveNow(), dismiss: () => set({ axConflict: null })
      };
    }
    /* ---- commands */
    const cmdKey = (id) => (cmdN(ptab) ? ptab + '/' + id : id);   /* 命令 keeps the old keys; 命令 2 … key by page */
    const cmds = repo.cmds.map((c0) => {
      const ck = cmdKey(c0.id);
      const st = (s.axCmd || {})[ck] || { st: 'idle', shown: false, n: 0 };
      const upd = (p) => { const all = Object.assign({}, cur().axCmd || {}); all[ck] = Object.assign({}, all[ck] || { st: 'idle', shown: false, n: 0 }, p); set({ axCmd: all }); };
      const hasOut = st.st !== 'idle';
      const word = { idle: '未运行', running: '运行中', done: '已结束 · 退出码 ' + c0.exit + ' · 用时 ' + c0.took, cancelled: '已取消，输出保留' }[st.st];
      const out = st.st === 'cancelled' ? c0.out.concat(['已取消']) : c0.out;
      return { id: c0.id, name: c0.name, line: c0.line, word: word, dot: 'dot ' + (st.st === 'running' ? 's-running' : st.st === 'cancelled' ? 's-cancelled' : st.st === 'done' ? 's-satisfied' : 's-idle'),
        canRun: st.st !== 'running', canCancel: st.st === 'running', runLabel: st.st === 'idle' ? '运行' : '再运行',
        run: () => upd({ st: c0.long ? 'running' : 'done', shown: true, n: (st.n || 0) + 1 }), cancel: () => upd({ st: 'cancelled', shown: true }),
        hasOut: hasOut, shown: hasOut && !!st.shown, kept: hasOut && !st.shown, keptText: '输出已隐藏，仍然保留（' + out.length + ' 行）',
        toggleLabel: st.shown ? '隐藏输出' : '显示输出', toggle: () => upd({ shown: !st.shown }), out: out.join('\n'), outLines: out.length };
    });
    /* ---- diff: Git ↔ working tree, or (from a conflict) the disk ↔ your draft */
    const cmpPath = s.axCmp && repo.files[s.axCmp] && repo.files[s.axCmp].disk ? s.axCmp : null;
    const dfiles = repo.changed.map((f) => ({ path: f.path, name: f.path.split('/').pop(), dir: f.path.split('/').slice(0, -1).join('/'), add: '+' + f.add, del: '−' + f.del,
      cls: 'frow d0' + (!cmpPath && s.axDiff === f.path ? ' is-on' : ''), go: () => set({ axDiff: f.path, axCmp: null }) }));
    let drows = []; let dnote = ''; let dhead = ''; let dPath = null;
    if (cmpPath) {
      const F = repo.files[cmpPath]; const mine = ((s.axDraft || {})[cmpPath] !== undefined ? s.axDraft[cmpPath].split('\n') : F.lines);
      dhead = F.disk.by + ' ' + F.disk.at + ' 写到磁盘的版本 ↔ 你的草稿 · ' + cmpPath.split('/').pop() + ' 第 ' + F.from + ' 行起';
      drows = [{ hunk: true, line: false, text: '@@ 第 ' + F.from + ' 行起 · 磁盘 ↔ 草稿', cls: 'dl-hunk' }].concat(this.axLineDiff(F.disk.lines, mine, F.from).map((r) => ({ hunk: false, line: true, cls: 'dl-row' + (r[0] === '+' ? ' is-add' : r[0] === '-' ? ' is-del' : ''), sign: r[0] === ' ' ? '' : r[0] === '-' ? '−' : '+', o: r[1] === null ? '' : String(r[1]), n: r[2] === null ? '' : String(r[2]), text: r[3] })));
    } else {
      const f = repo.changed.filter((x) => x.path === s.axDiff)[0] || repo.changed[0]; dPath = f.path;
      dhead = 'Git（HEAD）↔ 工作区 · ' + f.path.split('/').pop() + ' · +' + f.add + ' −' + f.del + (f.by ? ' · ' + f.by : '');
      f.hunks.forEach((h) => {
        drows.push({ hunk: true, line: false, text: h.head, cls: 'dl-hunk' });
        let o2 = h.oldAt; let n2 = h.newAt;
        h.rows.forEach((r) => { const row = { hunk: false, line: true, cls: 'dl-row' + (r[0] === '+' ? ' is-add' : r[0] === '-' ? ' is-del' : ''), sign: r[0] === ' ' ? '' : r[0] === '-' ? '−' : '+', o: r[0] === '+' ? '' : String(o2), n: r[0] === '-' ? '' : String(n2), text: r[1] };
          if (r[0] !== '+') o2 += 1; if (r[0] !== '-') n2 += 1; drows.push(row); });
      });
      if (!f.hunks.length) dnote = (f.note ? f.note + '；' : '') + '逐行内容在原型里没有收录。';
    }
    /* ---- quotes in the composer */
    const quotes = (s.quotes || []).map((q) => ({ id: q.id, path: q.path, lines: q.a === null ? '整个文件' : q.a === q.b ? '第 ' + q.a + ' 行' : '第 ' + q.a + '–' + q.b + ' 行',
      snap: !!q.snap, snip: q.snip, hasSnip: !!q.snip, remove: () => set({ quotes: (cur().quotes || []).filter((x) => x.id !== q.id) }) }));
    const rail = handle('rail'); const panel = handle('panel');
    return {
      appCls: (s.axMax ? 'panel-max' : '') + (s.axDrag ? ' is-dragging' : ''), railW: s.railW || defW('rail', W0), panelW: s.panelW || defW('panel', W0),
      /* the root's two widths: 'initial' while unset, so var(--rail-w, …) / var(--panel-w, …) fall back to the CSS widths */
      railCss: s.railW ? s.railW + 'px' : 'initial', panelCss: s.panelW ? s.panelW + 'px' : 'initial',
      rail: rail, panel: panel,
      tabs: tabs, isFiles: ptab === 'files', isCmd: isCmdTab, isDiff: ptab === 'diff', isFile: !!fp, isTool: ptab === 'files' || isCmdTab || ptab === 'diff' || !!fp,
      newOpen: !!s.axNew, toggleNew: () => set({ axNew: !cur().axNew }), newItems: newItems,
      maxLabel: s.axMax ? '还原右栏' : '放大右栏', isMax: !!s.axMax, notMax: !s.axMax, toggleMax: () => set({ axMax: !cur().axMax, panel: true }),
      hide: () => set({ panel: false, axMax: false, axNew: false }),
      fileRows: rows, fileNote: 'coding-platform · 分支 feat/reliability-and-structure · 改动 ' + repo.changed.length + ' 个文件',
      fp: fp || { rows: [], parts: [] },
      cmds: cmds, cmdNote: '命令在 Host 的工作区里运行；这里不是终端，没有输入。',
      dfiles: dfiles, drows: drows, dhead: dhead, dnote: dnote, hasDnote: !!dnote, isCmp: !!cmpPath, backToGit: () => set({ axCmp: null }),
      /* Diff's head: the file shown in Git ↔ 工作区 opens as its page (from Main's review) */
      dOpenShow: ptab === 'diff' && !!dPath, dOpen: () => { if (dPath) this.axOpenFile(dPath); }, dOpenTip: dPath ? '在文件页里打开 ' + dPath : '',
      quotes: quotes, hasQuotes: quotes.length > 0, quoteNote: '已引用到草稿，还没有发送',
      /* 放大 hides the composer: the quotes waiting there are counted beside the strip's buttons; a click restores the panel */
      qMax: { show: !!s.axMax && quotes.length > 0, n: quotes.length, go: () => set({ axMax: false }) }
    };
  }
  /* the quoted lines as plain text, for the message you send (the board's send() decides; quoting never sends) */
  axQuoteText(q) { return '引用：' + q.path + '，' + (q.a === null ? '整个文件' : q.a === q.b ? '第 ' + q.a + ' 行' : '第 ' + q.a + '–' + q.b + ' 行') + (q.snap ? '（草稿快照）' : ''); }
