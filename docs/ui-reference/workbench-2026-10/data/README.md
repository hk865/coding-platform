# proto/v2/data — shared data for the gap pass (2026-10-05)

The canvas prototype was approved on 2026-10-05 ("canvas的原型可以"); this folder closes the three gaps decided before
the approval (DESIGN.md §18). Board agents paste these into their boards; the lead keeps them canonical.

| file | paste where | needs |
|---|---|---|
| `arch-semantic.js` | every method into the logic class (Main, Plan, Goals, Decide, Done) | the board's `worst()` (all boards have it) |
| `timeline.js` | every method into the logic class (Main, TaskMap; optional Plan / Goals / Decide / Done) | the board's `taskModel()` for `tlTasks()` |
| `timeview.snippet.html` | [1] into the 任务图 view switch, [2] into `.pbody` while the view is 轨道 | `tl = this.timeView({...})` in renderVals |
| `auxtabs.snippet.js` | every method into the logic class; `...this.axState()` into the constructor's `this.state` | `semTreeData()` from arch-semantic.js |
| `auxtabs.snippet.html` | pieces [1]–[5] where each comment says | `ax = this.axView(s, { at, extra })` in renderVals |
| `squares.js` (rework 2026-10-06) | `sqAt(st)` into the logic class of every board that draws a task's own square | — (its header says where to use it and where not) |
| `worklines.js` (rework 2026-10-06) | every method into the logic class: Main, TaskMap (the DAG page) | timeline.js, arch-semantic.js (`semAreas()`), the board's `std40()`, `taskModel(goal)`, `isBig()` |
| `worklines-long.js` (final fix 2026-10-06) | the whole file into the logic class, after worklines.js: Main, TaskMap | timeline.js, worklines.js, squares.js, the board's `big600()`, `std40()`, `isBig()` — section "Final fix 2026-10-06" |
| `worklines-snap.js` (rework 2026-10-06) | the read API (wlSnapshot … wlHeadOf, wlRecord since decision 33) + the ONE data method of the board's moment: Phone, Goals, Member, ArchOverview `wlSnapMain`; Decide `wlSnapDecide`; Chain `wlSnapChain`; Plan `wlSnapPlan`; Done `wlSnapDone` — never together with `worklines.js` | nothing |
| `WORKLINES.md` (rework 2026-10-06) | — the work list: the model, the numbers, the replacement strings and the per-board checklist of every old-executor / combined-count occurrence | — |
| `taskpanel.snippet.js` (rework 2026-10-06, step 2) | the methods into the logic class, verbatim: **part A** (tpState … tpThumb) on Main, Plan, Goals, Decide, Done; **part B** (tpWin, tpConc, tpUnits, tpLanes) where 轨道 is drawn — Main; `...this.tpState()` into the constructor's `this.state` | part A: `squares.js`, `worklines.js` or `worklines-snap.js`, the board's tree engine (Main's `flatTree` / `focusTree` / `posMap`), its task view returning `o`; part B: `timeline.js`, `worklines.js`, `arch-semantic.js` (`semAreas`) — section "taskpanel" below |
| `taskpanel.snippet.html` (rework 2026-10-06, step 2) | pieces [0]–[3] where each comment says: [0] helmet style, [1] view switch + 整页查看, [2] the tree block, [3] 轨道 (Main) | `tpv` / `tpb` = `tpThumb(…).view` / `.bar`, `wl` = `tpLanes(…)`, `tpHasLanes`, `tpIsTask` in renderVals |
| `wlRecord(key, at, ctl)` in `worklines.js` and `worklines-snap.js` (decision 33, 2026-10-06) | comes with the file: re-paste `worklines.js` whole (Main, TaskMap) or the snapshot's read API + the board's data method (the data methods now carry `recs`) | — section "Decision 33 2026-10-06" |
| `lineview.snippet.js` (decision 33, 2026-10-06) | every method into the logic class, verbatim: every board with a work-line rail (Main, Plan, Decide, Done, Chain, Member); `...this.lvState()` into the constructor's `this.state` | `worklines.js` or `worklines-snap.js` (`wlRecord`), the board's line objects (its rail rows with their approved texts), its clock — section "Decision 33 2026-10-06" |
| `lineview.snippet.html` (decision 33, 2026-10-06) | pieces [1]–[3] where each comment says: [1] the rail rows, [2] the archived names, [3] the line's conversation in the centre | `lvr = this.lvRail(…)`, `lv = this.lvView(…)` in renderVals; kit.css §19 |

Do not hand-edit `arch-semantic.js` or `timeline.js`: they are generated (`proto/v2/sketch/gaps/gen-arch.mjs`,
`gen-timeline.mjs`; the view part of timeline.js comes from `tl-view.src.js`). Run inside WSL from `proto/v2/sketch/gaps`:
`bash shoot.sh` (regenerates both, builds the harness boards `GapsDemo.dc.html` and `MainSem.dc.html`, lints, runs the
flows into `build.log`, screenshots into `proto/v2/shots/gaps/`, leaves nothing running); `node verify-arch.mjs <Board>`;
`node paths.mjs`; `node try-tl.mjs`.

---

## G3 · the canonical semantic architecture (`arch-semantic.js`)

**Source.** `project/ArchOverview.dc.html` — its `treeData`, `wgAssign`, `dataHead`, `areas`, `groupNames`, `semGroups`,
`semSource`, `wgProposal`, `dirSem`, `fileSemKnown` are copied verbatim (renamed `semTreeData`, `semWgAssign`, `semDataHead`,
`semAreas`, `semGroupNames`, `semGroupDefs`, `semSourceOf`, `semWgProposal`, `semDirSem`, `archFileSem`). `semDeps()` is
computed with ArchOverview's own `levelEdges('SYS')` (file-level imports between areas, data head 0543261).
`archSemantic()` is ArchOverview's `repo()` tree builder without the import edges, in Main's node shape.

**Shape.** `{ id, name, kind, path, owner, sem, deps, area, kids }`; kind `system` → `module` (10 areas + `BAND` 支撑) →
`sub` (a semantic group, `path: ''`) or `dir` (a real folder, a folder's loose files "X 根目录文件", or a slice) → `file`
(`id = path` = the real path). Every node carries `area` (the id of its area node). 2,709 files, 11 root children, no comb
wider than 16 (WorkGraph 13, state 13); lists longer than 16 are cut into slices of ≤ 12 by name (`slice: true`; sem says
it is not a semantic group). `archAttach(root, tasks)` sets each file's `st` (most urgent state of the tasks that change
it, else `none`) and `tasks`.

**archModel() for Main-style boards** (Main, Plan, Decide, Done; replaces archData / synthDir / synthModule and the old
body; `verify-arch.mjs` and `make-demo.mjs` read the block between the markers):

<!-- archModel:start -->
```js
  archModel(goal) {
    const s = this.state || {};
    goal = goal || s.goal || 'g1';
    const tm = this.taskModel(goal);
    const key = tm.key + '|sem';
    if (this._am && this._am.key === key) return this._am;
    const tree = this.finishTree(this.archAttach(this.archSemantic(), tm.tasks));
    /* 当前工作: files changed by tasks that are running (or paused), need you, or failed */
    const WORK = ['running', 'waiting', 'decide', 'failed'];
    const work = [];
    tm.tasks.forEach((t) => { if (WORK.indexOf(t.st) >= 0) (t.files || []).forEach((f) => { if (tree.byId[f] && work.indexOf(f) < 0) work.push(f); }); });
    Object.assign(tree, { key: key, goal: goal, big: this.isBig ? this.isBig() : false, work: work });
    this._am = tree;
    return tree;
  }
```
<!-- archModel:end -->

Also replace, in `archCard()` and `archDetail()`, the line
`let mod = n; while (mod && mod.parent && mod.parent !== 'SYS') mod = tree.byId[mod.parent];` by
`const mod = n.area ? tree.byId[n.area] : null;` (so docs under 支撑 keep 审阅者 · 规格 as owner). That is the only
engine change; `MainSem.dc.html` is the approved Main with exactly these three edits and renders 当前工作, 全部, 大纲,
search, the goal-2 conflict and the detail correctly (shots `g3-*`).

**Old folder-group ids → new location** (only `archData()` used these ids; Goals also lists them in `pairModel`'s
`LAYER`, Done in `delivery().mods`; Main's harness scenarios use them):

| old id (name) | new id (crumb) | note |
|---|---|---|
| `WG` | `src/core/work-graph` (WorkGraph) | 13 semantic submodules instead of 10 folders |
| `WG/state` | `src/core/work-graph/state` | 13 files (gains `control-intent-machine.ts`, `query-run-recovery.ts`) |
| `WG/tasks` | `src/core/work-graph/tasks` | 26 files, shown as 3 slices `…/tasks~1..~3`; `task-index.ts` moved to **model** |
| `WG/evidence` | `src/core/work-graph/evidence` | `coverage.ts` moved to **tasks** (shown as `evidence/coverage.ts`) |
| `WG/sessions` | `src/core/work-graph/sessions` | gains `communication/message-record-codecs.ts` |
| `WG/communication` · `WG/queries` · `WG/persistence` · `WG/materials` · `WG/configuration` · `WG/architecture` | `src/core/work-graph/<same>` | files re-assigned per `semWgAssign` |
| — | `src/core/work-graph/model`, `…/source-authority-ports`, `…/source-authority-reader` | new semantic submodules |
| `AR` | `src/core/agent-runtime` (AgentRuntime) | |
| `AR/execution` · `AR/checks` · `AR/recovery` · `AR/tools` · `AR/kernel` | `src/core/agent-runtime#execution` · `#checks` · `#recovery` · `#tools` · `#kernel` | `kernel-turn-facts.ts` is in **#recovery**; `run-limits.ts` in **#kernel**; plus `#api`, `#queries`, `#contracts`, `#sessions` |
| `WF`, `WF/workflow` | `src/business/workflow`, `#workflow` | plus `#api`, `#contracts` |
| `WT`, `WT/capture` · `WT/git` · `WT/access` | `src/core/workspace`, `#capture` (capture, git-read, access) · `#identity` (denied-prefixes) | plus `#facade`, `#readers`, `#sources`, `#architecture`, `#index`, `#ports` |
| `RS`, `RS/store` · `RS/migrations` | `src/core/record-store`, `#store` · `#migrations` | plus `#index`, `#codec`, `#ports` |
| `APP` "App（Host 与工作台）" | **two areas**: `src/app` (Host) and `src/ui` (UI) | as ArchOverview: UI, Host and Composition apart |
| `APP/host` | `src/app#host` (host.ts, main.ts) and `src/app#server` (server.ts, attention-observer.ts, change-feed.ts, …) | |
| `APP/core-routes` | `src/app#core-routes` (core-routes.ts) and `src/app#types` (core-http-types.ts, host-settings-types.ts) | |
| `APP/ui` | `src/ui/:files` "UI 根目录文件" (main.ts, views.ts, styles.css, settings.ts, index.html, markdown.ts) | the rest of `src/ui` is real folders: api, components, state, views |
| `TS` | `tests` (under `BAND` 支撑) | real folders, 195 files |
| `DOC`, `DOC/<x>` | `docs` (under 支撑), real folders (`docs/refactor/reviews/evidence` …) | 1,834 files |
| `VEN`, `VEN/agent-*`, synthetic package paths | `vendor/coding-agent` (Kernel): `dist`, `patches`, `resources` | 305 real files; the 17,763 synthetic files are gone |
| — | `src/composition` (Composition), `src/contracts` (Contracts), `BAND` (支撑: tests, docs, scripts, resources, tools, .github, .local, 项目根目录文件) | new |

**Story files, where they sit now** (`node verify-arch.mjs Main`): goal 1 当前工作 (14:15) = Host / host / host.ts;
Host / server / server.ts, attention-observer.ts; AgentRuntime / recovery / observation-recovery.ts; WorkGraph / state /
task-machine.ts, attempt-machine.ts, verification-machine.ts — 7 files in 3 modules, the same note as before
("正在处理 7 个文件，在 3 个模块"). Decide adds AgentRuntime / execution / execution-control.ts (T16) and WorkGraph /
architecture / catalog-service.ts (T44). Goal 2's overlap (computed, unchanged) = Host / core-routes / core-routes.ts and
UI / UI 根目录文件 / views.ts. Every file named by goal 1's tasks (40 and 600) resolves; Decide, Done and the 600-task
FILE map too.

**Not in the tree, on purpose:** files that do not exist at data head 0543261 — goal 2's planned new files
(`src/ui/words.ts`, `src/ui/maps/*`, `src/ui/shell/*`, `src/ui/maps/hover-card.test.ts`) and the test files goal 1
creates in Done's 改动 list (`tests/work-graph/write-closure.test.ts`, …). Their lists keep naming them; the map shows
the repository as it is (as ArchOverview does). Text-only mentions elsewhere (Main / Phone `tests/work-graph/verification-machine.test.ts`,
Chain `tests/work-graph/requeue-replay.test.ts`, Member `src/ui/api.ts` …) are untouched.

**Scale tweak:** both scales draw the real 2,709-file repository exactly as this file gives it (as ArchOverview, which has
no scale tweak). Only Main has the 600-task tweak; there, to keep the approved stress case (≈ 2 万个文件, BRIEF-V2 §3),
Main's own `archStress()` adds **one clearly marked synthetic folder under Kernel**, outside every semantic group:
"合成压力数据（不是仓库内容）" (`vendor/coding-agent/:synthetic`, 12 `<prefix>-*` folders, 140 packages, 17,504 files in folders
of at most 12, the approved `synthDir` generator; every node `synth: true`, its sem says it is not repository content), so
the root reads 20,213 files as on the approved board (verify finding 4, DESIGN §18.11). The semantic dataset itself is
unchanged. The 600 tasks' FILE map names real files, so it still lights them.

**Board notes (G3).**
- *Main*: archData / synthModule → arch-semantic.js; archModel as above (+ `archStress()` at 600); the two `mod` lines.
  Root sem becomes ArchOverview's. Rest-line nouns, the same on all five map boards: semantic groups 子模块, real folders
  文件夹, slices 段, semantic groups mixed with a folder 组 (AgentRuntime, Host's non-code files), otherwise 项.
- *Plan*: same as Main for the engine; **goal 2's planned new files are drawn** (方案新加, lit as on the approved Plan) and counted apart from the repository's 2,709 (Plan review, DESIGN §18.7; accepted in the consistency pass, §18.10). The overlap still is core-routes.ts, views.ts.
- *Goals*: `pairModel()` loops `archData()` sorted by `LAYER = ['APP','WF','AR','WG','RS','WT']`; build it from
  `archSemantic()` instead (keep the root's order: UI, Host, Composition, Workflow, AgentRuntime, WorkGraph,
  WorkspaceTools, RecordStore, Contracts, Kernel, 支撑 — ArchOverview's top-down order) and attach the pair states to
  `kind === 'file'` nodes as today.
- *Decide*: same as Main.
- *Done*: same as Main for the map. Its changed-files list (`delivery().mods`) groups by the old modules; rename the group
  "App（Host 与工作台）" into **Host** (src/app files) and **UI** (src/ui files) with names from `semAreas()`, keep its
  rule "a test sits with the module it tests".

---

## G1 · 轨道 + 活动日历 (`timeline.js`)

**Moments.** Main / Decide / TaskMap / Phone `'10-04 14:15'`; Chain's later moment `'10-04 14:32'`; Done `'10-06 16:33'`
(`tlData().moments`). A run that is still going at the moment is cut there and drawn running, with its counts at that
moment (given where a board states them, else in proportion).

**Run rows** (122): id, member (SM 执行者 · 状态机, SV 执行者 · 服务重构, RV 审阅者 · 规格, AA 架构参谋, SC 秘书),
task, attempt, kind (run / check / query / talk), start, end, result, reason, previous run in the chain, how the chain
went on (返工 · 系统自动 … / 接续 / 系统自动重新检查), steps, edits, check items, model requests, counts at a moment,
variant (`'decide'`), goal (`'g2'`, `'g3'`). `tlData().marks` = stops without a bar (需要你决定, 延后); `events` = the two
Host restarts.

**Sources of every number** (each row in `gen-timeline.mjs` carries its source in a comment):

| what | value | source |
|---|---|---|
| Host restarts | 10-03 15:12 · 10-04 14:02 | Member w2 (平台中断) · Main conversation and ledger, Decide q7 / q8 |
| T13 重新入队与失败类别 | a1 run 13:31–13:55 (steps 18, edits 2, 2 requests); check R1 13:55–14:00 检查未通过 lint 2 项，回放测试 1 项 (12/14); requeue 14:00 (1/3); a2 run 14:04–14:17 (7 steps, 2 edits at 14:15; 10 / 2 at the end); R2 14:17–14:22 通过 14/14; consultation answered by the read-only copy 14:31–14:32 | Chain ledger (att_41c2 … tsk_13, msg_8c02) |
| T21 检查不完整判定 | four attempts with checks failing (lint 3 · lint 2 + 类型检查 1 · lint 2 · lint 2, 其余 12 项通过), R4 14:05–14:11, mark 14:11 自动返工已达上限（3/3）; requeued by you 10-04 15:05; a5 passes | Main std40 rework rows, Decide q1 (14:11), Done T21 (15:05, 第 5 次尝试通过) |
| T14 接续说明 | check R1 from 14:05, 9 / 14 items at 14:15, passes 14:21 | Decide q4 |
| T15 启动核对 | a1 14:01:20–14:02:11 执行失败 (读到 Host 重启时写了一半的记录), 系统自动重新入队（1/3）; a2 passes 10-04 | Main ledger att_5c0e 14:02:11, Decide q3, Done T15 |
| T20 检查链与重新检查 | a2 R1 13:40–13:47 检查不完整, R2 13:55–14:02 interrupted by the restart (受阻 at 14:15), R3 14:25–14:31 通过 | Main T20 why, Done T20 (第 3 轮通过) |
| T26 core-routes 拆分 (SV) | 10-02 runs 09:30–10:18 (读取 3、编辑 2), 10:18–10:27 (运行检查); 验收通过 11:05 | Member w1 |
| T27 前端拆分 (SV) | 10-03 a1 14:41–15:03 (读取 2、编辑 3), 15:03–15:12 平台中断; a2 接续 15:20–15:34 (读取 3、编辑 2), check 15:34–15:40 样式检查 4 项未通过, 返工 · 人工 15:41, run 15:41–15:58, 通过 15:58 | Member w2 / w3, Main std40 rework, Done (接续 1 次) |
| T28 SSE 推送 (SV) | run_c41a 13:52–14:03 (2 edits: attention-observer.ts, main.ts; your intervention rejected), run_d7f3 14:04– (server.ts +38 −4 at 14:11); 临时分支 14:05 (41 秒); 咨询 from 架构参谋 14:07– (answering at 14:15) | Member ledger and records |
| 审阅者 · 规格 | gate checks T04 10-02 17:40 (23 条) · T11 10-03 11:05 · T18 10-05 09:52 (6 个场景) · T25 10-05 10:52 检查不完整 → 11:30 通过 (18 项) · T33 10-06 14:40 (32 项) · goal gate 10-06 16:02 检查不完整 → 16:31 通过 (14 项): **8 rounds, 47 min** | Done delivery() A1–A6 and usage note |
| 架构参谋 | 发出咨询 14:05–14:09; 10-06 14:30–14:45 记下与任务书不同的一处 | Plan member row (14:09), Done (10-06 14:45) |
| 秘书 | 10-02 09:05–09:30 (adopted at 09:30, when 服务重构 claims core-routes 拆分; consistency pass); 10-04 14:06–14:10 方案第 1 版 (steps 11, edits 2), 14:12–14:13 修改方案; 15:00–15:06 (your requeue of T21); 10-06 16:31–16:33 交付 (用时 2 分); goal 2 13:20–13:23; goal 3 10-03 18:40–18:41 | Done note, Main conversation and ledger |
| member last steps at Done | 状态机 "沿用结果标注通过，10-06 12:10" (T42); 服务重构 "增量刷新通过，10-06 14:20" (T32) | Done member rows |
| **totals at Done** | run time 秘书 2 h 10 m · 状态机 19 h 5 m · 服务重构 8 h 40 m · 审阅者 3 h 20 m · 架构参谋 50 m; model requests 38 · 214 · 96 · 51 · 13 (412) | Done usage table — matched exactly: one "filled" run per member (below) takes up the rest of the time; requests are fixed where a board states them, the rest in proportion to time |
| Decide variant (`variant: 'decide'`) | T16 run 11:36–11:58, R1 12:00 and R2 12:30 检查不完整, mark 14:09 没有新依据; T30 12:40–13:40 预算耗尽, mark 13:41; T29 13:41–13:58 已暂停（你在 13:58 暂停）; T31 mark 13:31 延后; T44 (架构参谋) 13:20–14:02 执行结果待核对; T45 gate 13:15–13:38, check 13:40–13:47 failed, mark 13:52 | Decide `catalogTasks()` comment and queue q5–q10 |
| a past pause of goal 1 | you paused the goal 10-03 13:40 and continued 13:52; only 执行者 · 状态机 was running: T19 证据链接 13:30–13:40 已暂停 (mark; the bar reads 已暂停 once it has gone on), gap, 接续 13:52–14:25 (`s16` → `s16c`), check 14:25–14:31 通过 — so every board with 轨道 (TaskMap's 本周 / 全部, Main's 本周) shows a pause as a gap with a mark in the data, not only after you press 暂停 on Main (verify finding 1) | filled: no board describes T19's run; its run time is 12 min shorter, 状态机's flex run absorbs it |
| filled (no board says) | T20 a1 10-03 15:30–16:20 执行失败 + 系统自动重新入队（1/3） (Main shows 第 2 次尝试 without a rework, so it is not counted in Done's 返工 6); the other 10-02 – 10-06 runs of satisfied tasks (T01–T12, T16, T17, T19, T22–T24, T29–T33, T41, T42) placed in working hours without overlapping a member's own runs; 秘书 10-03 18:10, 10-05 09:00, 17:00, 10-06 10:00; 架构参谋 10-05 09:30; flex runs that close the totals: 状态机 T42 from 10:00:51, 服务重构 T32 from 13:03:41, 审阅者 goal gate prep 15:45–15:55, 秘书 10-06 10:00–10:22, 架构参谋 10-05 09:30–10:01 | `gen-timeline.mjs` (rows marked "filled") |

Steps and edits of rows no board details: steps = 0.7 per minute, edits = 0.16 × steps. Check rows count check items
(14 for 状态机's suites, 12 for 服务重构's, the gate counts above); a check bar's card says them ("检查 14 项").

**Activity calendar.** Computed by `timeView()` from the same runs: each run's steps and edits are spread over the hours it
covers in proportion to time (largest remainder, so every run's totals are kept exactly); each check run counts **once**, in
the hour it starts (UI-WORKBENCH: 检查的次数; verify finding 9). A cell's level is steps + edits + check runs:
0 / 1–14 / 15–29 / 30–44 / ≥ 45. At Main's moment, today = 步骤 213 · 编辑 34 · 检查 8 次.

**Stops and the data moment** (verify findings 1 and 3). `stops: [{ kind: 'pause' | 'cancel', t, until }]` are the goal's
pauses and cancels kept as history; a run or check that spans one ends there (已暂停，可继续 / 已取消, with a mark) whatever
the moment, and after 继续 / 重新入队 (`until`) goes on as a linked bar ("接续：你在 14:18 继续…", id `<run>+1`); rows that
would start while the goal is stopped are not drawn. `dataMoment` = the moment the board's task states are taken at
(Main: '10-04 14:15'): tlData's rows are known up to it; a row still going then goes on up to the board's clock.

**Window.** On the full page (TaskMap) 今天 is the day from 08:00; in a panel (Main) 今天 draws the last three hours up to
the next hour (12:00–15:00 at 14:15, ticks every 30 min) and the sum line says "轨道从 12:00 画起" — the calendar and the
sum keep the whole day (verify finding 8).

**How boards call it.** `const T = this.tlTasks(this.taskModel(goal));
tl = this.timeView({ goal, moment, dataMoment, variant, stops, by, win, cell, hover, full, tasks: T.tasks, stages: T.stages,
memberWords: this.memberWords(), on: { by, win, cell, hover, unhover, pick } })` — state keys suggested: `tlBy`
('member'), `tlWin` ('today'), `tlCell` (null); `hover` is the board's existing hover key (bar ids and `'cell:MM-DD HH'`
never clash with node ids). Main: `dataMoment: '10-04 14:15', stops: s.stops` (the goal bar's 暂停 / 继续 / 取消 / 重新入队 keep them);
`pick: (id) => set({ view: 'tree', sel: id, hover: null })`. TaskMap: `full: true`. Plan (goal 2): pass `extraRuns` (rows in
the object shape of `tlData().runs`) for its own clock — its turns from 14:36 and, after 采用, 审阅者 · 规格's running run
of goal 2's first task — and `moment` = its clock.

---

## G2 · the auxiliary area (`auxtabs.snippet.*`)

Content is the workspace of 10-04 14:15, consistent with the boards:
- **Diff (Git ↔ working tree)** = the uncommitted changes of goal 1, each with the task that made it (`by`, shown in the
  Diff's head): task-machine.ts +15 −6 and attempt-machine.ts +9 −2 (Chain: "2 个文件 +21 −5" after attempt 1, then +3 −3 in
  attempt 2 at lines 88 and 131) and record-codecs.ts +14 −2 (Chain c6: "record-codecs.ts 读取旧记录时类别留空") — 重新入队与失败类别;
  server.ts +38 −4, attention-observer.ts +21 −6, main.ts +17 −9 (Member: "已改 3 个文件") — SSE 推送; verification-machine.ts
  +7 −1 (Decide q1: lint no-unused-vars 第 88 行, import/order 第 3 行) — 检查不完整判定. These files show every line; server.ts,
  attention-observer.ts and main.ts show their counts and say the lines are not in the prototype. The task maps' `files` stay
  as approved (T13 lists task-machine.ts and attempt-machine.ts, T28 server.ts and attention-observer.ts), so 当前工作 is
  unchanged (verify finding 10, DESIGN §18.11).
- **File pages** show a window of the real file (`from`, `total`): task-machine.ts lines 80–100 of 212 (line 88 is
  `case 'cancelled':`, line 90 the added `break;`, matching the diff); server.ts 118–128 of 402, loaded 14:09; on disk since
  14:11 (执行者 · 服务重构, +38 −4) with the heartbeat block → the conflict example; core-routes.ts 1–15 of 2,134 ("2 千多行",
  Member / Decide); views.ts; package.json (the real one). Any other file opens with "原型没有收录这个文件的内容" and can
  still be quoted whole.
- **Commands** = the real scripts of package.json (typecheck, test, check:architecture, build); "状态机单元测试 31 个通过"
  as in Chain. Chain's `npm run lint` is not a real script, so it is not listed.
- State keys (`axState()`): `ptab` (Main already has it; values gain 'files' | 'cmd' | 'diff' | 'f:<path>'), `axTabs`,
  `axPages`, `axMax`, `axNew`, `railW`, `panelW`, `axBox`, `axDrag`, `axDirs`, `axMore`, `axSel`, `axEdit`, `axDraft`, `axText`,
  `axSaved`, `axReload`, `axConflict`, `axCmp`, `axCmd`, `axDiff`, `quotes`, `axQn`. Main's `extra` (node pages) is read
  by `axView` and closed through it; `panel` stays the hide flag.
- The board's `isMap` must be true only for 任务图 / 架构图; `send()` should prepend `axQuoteText(q)` lines for
  `s.quotes` to the message and clear `quotes` (quoting itself never sends).

**After the consistency pass (2026-10-05, DESIGN §18.10)** the snippet carries what the board reviews had added on one
board each, so every board with the auxiliary area (Main, Plan, Goals, Decide, Done) behaves the same; boards paste the
methods verbatim (`sketch/consistency/verbatim-all.mjs`; Done's `axRepo` keeps its one documented hook):
- **Tabs**: same-name file pages get the shortest parent that tells them apart, in front ("app/main.ts" / "ui/main.ts";
  from Main); a file tab's `tip` (title) and close label carry the full path, a node page's its name. Markup [3] binds
  `title="{{t.tip}}"`.
- **Quotes**: with nothing selected, a file page's bar says "已引用到草稿（n 条），还没有发送" for that file's quotes (from Main
  and Done); while 放大, `ax.qMax` puts "草稿里 n 条引用" beside the strip's buttons (a click restores) — markup [3]. The
  panel stays maximised on quote (Goals used to step back).
- **Dividers** (from Main): `railW` / `panelW` are null until a divider moves (`axState`), the root binds
  `--rail-w: {{ax.railCss}}; --panel-w: {{ax.panelCss}};` ("initial" while unset, so the CSS widths hold: 232 / 480, and
  kit §15.10's 208 / 420 at 961–1240px); every pointer, key or focus event (`onFocus="{{ax.rail.seen}}"`) reads the real
  container width (`axBox`), which sets the limits and aria-valuemax; Home and double-click go back to the CSS width.
  `axView(s, { rail: false })` is the rail-less option (Goals: panel 360 – window − 360).
- **比较** (`axLineDiff`): in a changed block the removed lines come before the added ones (Done's local reorder removed).
- **Diff's head** (from Main): `ax.dOpenShow` / `dOpen` / `dOpenTip` — 打开文件 for the file shown in Git ↔ 工作区 (markup [4]).
- **File rows in the map detail** (from Main): `axPaths()`, `axFileItem(path)`, `axOpenFile`, `axOpenDiff`, `axRevealDir`;
  markup piece [6] (`.d-fline`, kit §15.10): a file opens its page, a folder opens 文件 at it, a changed file offers 看 Diff,
  a planned file stays text.

---

## Cross-board conflicts found while building the timeline (not fixed here: boards are approved)

1. **Goal 1's start.** Done: "从 10-02 10:20 开始，历时 4 天 6 小时"; Member: core-routes 拆分 claimed 10-02 09:30. The
   timeline follows Member and has 秘书's goal turn adopted at 10:20, so one run starts before the goal does. Smallest fix:
   Done's note → "从 10-02 09:30 开始，历时 4 天 7 小时". **Fixed in the consistency pass:** 秘书's turn c01 is
   10-02 09:05–09:30 ("你在 09:30 采用"; same 25 minutes, so Done's usage table is unchanged) and Done says
   "从 10-02 09:30 开始，历时 4 天 7 小时" (usage span "4 天 7 小时").
2. **The 14:02 Host restart vs T28.** Main and Decide restart the Host at 14:02 (T20's check, T44, T29 end there); Member's
   T28 run_c41a runs 13:52–14:03 straight through it (tool call 14:03:28), although a restart ends running runs (T27,
   10-03). The timeline keeps Member's times; the dashed restart line crosses that bar. A later fix would end run_c41a at
   14:02 in Member (a 平台中断 and a 接续), which touches Member's ledger.
3. **Decide's 服务重构 morning** (每种原因各一条): 目标展示读取路由 runs until you pause it at 13:58 while Member has SSE 推送
   claimed at 13:52 — in the Decide variant the lane shows two rows 13:52–13:58.
4. **架构参谋's consultation**: Member says it arrived 14:07, Plan says "发出咨询，已送达，14:09". The timeline has the
   sending turn 14:05–14:09 and the answer 14:07–14:40.
5. **Done's 检查链验收** (T25) passes 10-05 11:30 while two of its dependencies (T41, T42) pass later (T42 10-06 12:10, Done's
   member row). Dependencies are not claim conditions, but a gate passing before the tasks it covers reads oddly.
6. **T20's first attempt** is described nowhere (Main shows 第 2 次尝试 without a rework row); filled as 执行失败 +
   系统自动重新入队 so Done's "返工 4 个任务，共 6 次 · 接续 1 次" stays true.
7. **T40 运行轨道视图** is still a future intent of goal 1 (std40 S6) although the prototype now shows that view; it is
   goal 1's fake backlog, left as is.

## G1 after the TaskMap gap review (2026-10-05)

`timeline.js` was regenerated (run data unchanged; the view functions changed: the calendar keeps the window's days
while an hour is picked, the `.now-row` axis in 本周 / 全部, 检查不完整 stop marks, wait lines that stop at the next bar of
their row, `task` on every mark and link with `.on` for the hovered task, the 类型 row and the status lookup in bar cards).
TaskMap and Main re-pasted it (kit §15.8 gained the matching additive rules). DESIGN.md §18.6, §18.9.

## Rework 2026-10-06 — squares and work lines (user decisions 25, 27, 30; shared step 1)

**`squares.js`** — `sqAt(st)`: a TASK's own square, `'s-' + (st === 'pending' ? 'notyet' : st)`. A task that has not
started is hollow on every board (待执行 dashed, 可领取 blue ring, 未来意图 grey ring); group squares keep the approved rule.
An architecture FILE leaf takes the state of the tasks that touch it, so it uses `sqAt()` too (a file whose only task has
not started is hollow); folders and modules are group squares. The look is kit.css §18 (swatches:
`sketch/rework/swatch/`, pictures `shots/rework/`).

**`worklines.js`** — the work-line model: TaskDAG's `own.js` methods moved here (runIndex, stamp, workLines, barAt, busyAt,
waitingAt, agentAt, groupAgentAt, unitStats, wlUnits; ten documented edits in `sketch/rework/gen/build-worklines.mjs`,
none of which changes a TaskDAG result: `check-worklines.mjs` compares 32,749 of them), plus the read API (wlAbout,
wlLabel, wlNowStates, wlStatus, wlRailAt, wlRail, wlOwner, wlGroupOwner, wlGoalBar, wlLineOf, wlAreaOwner, wlGoalOwner,
wlHeadOf). Generated by `sketch/rework/gen/build-worklines.mjs` from `sketch/taskdag/src/own.js` and
`sketch/rework/gen/worklines-api.js`.

**`worklines-snap.js`** — the same read API over a generated snapshot, for boards without timeline.js: one data method
per moment (main 10-04 14:15 with 暂停 / 取消 variants; decide 10-04 14:15 with Decide's stop reasons; chain 10-04 14:32; plan
10-04 14:36; done 10-06 16:33 from Done's `done40()`). Generated by `sketch/rework/gen/gen-snapshot.mjs` from the live model
(TaskMap's logic class — the TaskDAG draft's until the integration step — with `timeline.js`, `arch-semantic.js` and `worklines.js` on top); it checks the snapshot API against the live API (843 results, all equal).
Regenerate after `timeline.js`, `std40()`, `done40()`, Decide's `catalogTasks()` or `worklines.js` change.

**`WORKLINES.md`** — the model in five lines, the canonical numbers (14:15: 19 lines, 工作中 3 · 待命 8 · 已归档 8; goal bar
"3 条工作线工作中"), the replacement strings, the board notes and the per-board checklist (`sketch/rework/gen/checklist.mjs`
regenerates it between its markers).

Checks: `sketch/consistency/verbatim-all.mjs` now also reports `squares.js`, `worklines.js` (pasted only with its model)
and `worklines-snap.js` ("API n/m, data <moment method>"), and flags a board that pastes both work-line files.

## taskpanel — the right panel's 任务图 tab (rework 2026-10-06, shared step 2; decisions 25, 27, 28, 30)

`taskpanel.snippet.js` + `taskpanel.snippet.html` are the one 任务图 tab of Main, Plan, Goals, Decide and Done. The worked
example is the harness `sketch/rework/panel/`: `make-panel.mjs` turns `project/Main.dc.html` into `PanelDemo.dc.html` with
exactly the edits below (each a literal replacement that must match once), `build.sh` builds the static sketches and runs
the flows (`build.log`), `shoot.sh` takes the pictures (`shots/rework/panel/`). Notes: `sketch/rework/notes-shared2.md`.

**What the tab does now**
- **树 = a thumbnail** (decision 28), built on the board's own tree engine (Main's `flatTree` / `focusTree`; no second engine):
  from the goal root at most 3 levels — goal → stages → their children on the combs (40: the tasks; 600: the batches). A
  folded row that can open keeps its chevron (quiet) and a comb square that holds more has a short stub under it (kit-style,
  outside the square). A click opens up to 3 more levels under the node in place — the approved one-click open + select;
  a group opened by you also opens its children that hold groups — and a second click folds it (approved). The tree area
  pans: drag (the pointer is captured only after 5px, so a click still reaches a square), wheel (Shift = sideways), a
  selection made elsewhere is brought into view; **回到起点** puts the tree back and folds what you opened. One quiet line
  says the tree is grouping only: "树只按阶段分组，不画依赖；依赖在整页查看" (when it can pan: "…；拖动看其余部分").
- **Fallback** when the opened tree is more than one and a half panels tall (`viewH × 1.5`): the architecture's 当前工作
  pattern — the paths to the selection (and its children) and to the most urgent work (需要你决定 › 失败 › 受阻 › 执行中 ›
  验证中 › 已暂停, as many as one panel holds), every other node as a compact square on its parent's branch, each level one
  summary ("另 6 个阶段 · 失败 2 · 受阻 3", "另 5 个批次，60 个任务"); the line reads "树放不下：只画到选中的和最紧要的 n
  个任务，其余在小格子里" (title: the totals and "整棵树在整页查看"). 回到起点 returns to the 3-level start.
- **大纲** as approved; **架构图** passes through (same viewport, no pan, nothing changed).
- **Squares** (decision 27): a task's own square via `sqAt()` — tree and outline task rows, comb squares, outline strips,
  the hover card's head, the detail's head and its 依赖 / 后续 / 任务 / 重叠 items, search hits, the calendar card's tasks.
  Group squares keep the approved rule.
- **负责** (decisions 25, 30): a task `wlOwner`, a stage or batch `wlGroupOwner`, the goal root `wlGoalOwner` (card and
  detail), only where the map's goal has work lines (`opt.lines`); elsewhere the board's own text stays.
- **轨道** (part B, decision 25): work lines grouped 角色 (default) / 模块 / 任务; executor lines that never overlap share a row
  (rows = peak concurrency; a shared row names its line now and "+ n 条已结束"); a closed group is one row of concurrency;
  read-only consultations on the line that was asked; archived lines behind the bottom row "已归档 n 条"; order pinned →
  需要你决定 > 失败 > 受阻 > 待核对 → most recent activity (任务: the plan's order), taken once when the view opens or the
  grouping, window, hour, archive switch or pins change, never moved while you look ("顺序已变 · 重新排序" when the data
  moved under it); at most 8 rows of lines — rows with activity in the window first, quiet ones while room is left — then
  "另 n 条 · 整页查看" (a link to TaskMap.dc.html); a sticky axis; calendar, window, ticks, Host restarts, now line and sum
  line are the approved `timeView()` (verbatim); the goal's pauses and cancels and your own turns are drawn as approved.

**Pieces of `taskpanel.snippet.html`**

| piece | where | replaces |
|---|---|---|
| [0] style | the board's `<helmet><style>` (kept in the helmets by the integration step: each of the five boards pastes it, and a helmet rule wins over the kit anyway) | — (Main's `.lg-*` legend rules stay; a board that adds 轨道 copies them) |
| [1] switch | inside `.ptools`, the 视图 `.seg` | the board's 树 / 大纲 (/ 轨道) switch; 轨道 only when `tpHasLanes` (= `isTask` on Main, false elsewhere) |
| [1] link | the end of the same `.ptools`, shown on the 任务图 (`tpIsTask`) | Main's 整页查看 link (new title "整页的任务图：依赖图（DAG）、大纲和轨道"); new on the other four |
| [2] tree block | inside `.pbody`, after the crumbs | the board's `<div class="{{treeCls}}">…</div>` with its rows, connector and card — the card moves out of the tree into the viewport |
| [3] 轨道 | inside `.pbody` (Main) | the `<sc-if value="{{isLanes}}">…</sc-if>` block of `timeview.snippet.html` [2] |

**Methods of `taskpanel.snippet.js`** (paste verbatim; `verbatim-all.mjs` reports "A n/7" and "B n/4")

| method | part | what |
|---|---|---|
| `tpState()` | A | state keys: `tpPan`, `tpBox`, `wlBy` 'role', `wlWin` 'today', `wlCell`, `wlShut`, `wlArch`, `wlPins`, `wlSort` |
| `tpThumb(v, s, opt)` | A | the tree of the tab → `{ flat, mode, view, bar, place, qrows, pmap, width, height }` |
| `tpRestLine`, `tpTextW` | A | the fallback's summaries; text width |
| `tpOwner`, `tpCard`, `tpDetail` | A | 负责 from the work lines; the card and the detail with hollow task squares |
| `tpLanes(s, o)` | B | 轨道 → `wl` (tools, calendar, sum, axis, rows, bar card, legend switch) |
| `tpWin`, `tpUnits`, `tpConc` | B | the panel window (timeView's rules repeated), the units by grouping, the concurrency row |

**What every board provides (part A)**
1. Paste `squares.js`, the work-line read API (`worklines.js` on Main, else `worklines-snap.js` with the board's moment)
   and part A; `this.state = Object.assign(this.axState(), this.tpState(), { … })`; `mapReset()` also clears
   `tpPan: null, wlCell: null`.
2. The task view returns the engine options it built: `return { o: o, goal: goal, tree: tree, …` (one line in `taskView`).
3. In `renderVals()`, the 任务图 branch, before the rows are wired:
   `const v = this.taskView(…); tp = this.tpThumb(v, s, tpOpt); v.flat = tp.flat;` — then the card
   `card = tp.place(this.tpCard(cardOf(v, pmap, (n) => this.taskCard(v.goal, n)), byId[s.hover], tpOpt))`, the search list
   `qlist = tp.qrows(…)`, the detail `det = this.tpDetail(this.taskDetail(…), byId[detId], tpOpt)` (and on a task node
   page). The 架构图 branch: `tp = this.tpThumb(v, s, { set: set, map: 'arch' })`. Bind `tpv: tp ? tp.view : { cls:
   'tp-view', x: 0, y: 0, down: noop, move: noop, up: noop, wheel: noop }`, `tpb: tp ? tp.bar : { show: false, cls:
   'tp-hint', text: '', tip: '', canBack: false, back: noop }`, `tpHasLanes`, `tpIsTask`.
4. `tpOpt = { set, map: 'task', viewW: <tree width: panel − 32>, viewH: 750 (the 900px frame: tabs 48, tools 40, padding,
   the line), hasDetail: <a task selected or pinned>, detailH: 330, lines, at: <the board's moment>, ctl: <'paused' |
   'cancelled' | null>, keep }`.

**Part B (Main)**: paste part B; call `wl = this.tpLanes(s, { show: isLanes, goal, model: { moment, dataMoment, variant,
extraRuns, stops, tasks, stages }, states: <goal 1's task states now: { id: { st, why, name, stage } }>, plan: <goal 1's
task ids in order>, sel: s.sel, hover: s.hover, trackPx: panelPx(s) − 32 − 132, max: 8, legend: !!s.legend, synth: <600's
line or ''>, on: { hover, unhover, pick: (id) => { go.selTask(id); set({ view: 'tree' }); } } })` on **every** render (with
`show: false` it only forgets the order, so the order is taken again when 轨道 opens); bind `wl`. Remove Main's old `tl`
binding, its 600 lane patch and tick filter (they are in `tpLanes` now) and the state keys `tlBy` / `tlWin` / `tlCell`.

**Per board**

| board | pieces | part | read API · `at` | `opt` | notes |
|---|---|---|---|---|---|
| Main | [0] [1] [2] [3] | A + B | `worklines.js` · 'main' | `lines: goal === 'g1'`, `ctl` from the goal bar, `viewW: panelPx(s) − 32` | `make-panel.mjs` is the exact edit list |
| Decide | [0] A, [1], [2] | A | `worklines-snap.js` + `wlSnapDecide` · 'decide' | `lines: (s.mgoal \|\| 'g1') === 'g1'` | its `taskView(s)` keeps the conflict hits; `sketch/rework/panel/probe-boards.mjs` runs part A on Decide's engine |
| Done | [0] A, [1], [2] | A | `wlSnapDone` · 'done' | `lines: goal === 'g1'` | keep `ref="{{r.ref}}"` on the row `<div>` inside [2]; `revealSel()` stays for 大纲 and the 架构图 (the thumbnail brings the selection into view itself, its pbody no longer scrolls the 树); probed like Decide |
| Plan | [0] A, [1] link only (no switch on Plan's 任务图), [2] | A | `wlSnapPlan` · 'plan' | `keep: true`, `lines: false` (goal 2's plan; after 采用 the board's own clock text) | Plan builds its task rows by hand (goal → stage → task, never deeper): pass `v = { flat: { rows, height }, byId, root, sel: cur }` with `keep`, which keeps them; rows without `.node` are looked up by id; keep Plan's row attributes inside [2] (no `onDoubleClick`); its `focusTree` variant calls `this.restLine` (arch words) — unused with `keep` |
| Goals | [0] A, [1] link (the approved switch stays), [2] | A | `wlSnapMain` · 'main' | `keep: true`, `lines: (n) => <n is under goal 1>` | pass `v = { flat, byId: tm.byId, root: tm.root, sel: tsel, outline }`; its 任务图 already draws only the paths to the tasks on the shared files (the fallback pattern): `keep` keeps that story and adds the squares, the pan, the line and the card's place; its rows have no `onDoubleClick` |

**Not covered by the snippet (board agents)**: queue rows, conversation references and the detail's `d-pins` that name a
task (use `sqAt`); the architecture's file leaves and its 负责 (`wlAreaOwner`, WORKLINES.md §5); the rail's work lines
(WORKLINES.md); a stage owner in the 树 at 详细 (lead choice 6 of shared step 1: not shown).

**Checks** (`sketch/rework/panel/`): `build.log` — format lint clean, no unknown holes, every handler a function, no handler
errors (every reachable handler called in all 41 scenarios), DOM ≤ 1,141 elements; flows for the 3-level start, opening,
the batch square, the fallback, 回到起点, the pan (capture after 5px, clamps, wheel), the reveal, every card, the detail,
轨道's groupings, the frozen order (stale after a requeue, 重新排序, taken again on reopening), pins, the closed group, the bar
card and its click, a pause at 14:16, goal 2, 600. `shoot.log` — 41 PNGs + 9 crops at 3×, no console problems, no sideways
overflow, the selection inside the viewport, every card inside the panel, at most 8 rows of lines, no cut lane names.
`verbatim-all.mjs ../rework/panel/PanelDemo.dc.html` — every data file whole (taskpanel A 7/7, B 4/4).

## Integration step 2026-10-06 (rework decisions 25–30, last step; DESIGN §21)

The board steps and their review fixes left shared-file requests in `sketch/rework/notes-*.md`; this step applied them, re-pasted
every board and retired the TaskDAG draft. Backups: `v2/prev/pre-integration-1006/` (project, data, the generators); the
step's scripts and logs: `sketch/integration/`.

**What changed in the data files**

| file | change | asked by |
|---|---|---|
| `auxtabs.snippet.js` | S3: server.ts's `disk.by` and its comment, and the three Diff notes, name **执行者 · SSE 推送** (5 replacements) | Main F1, Decide 6, Plan / Goals 5 |
| `timeline.js` | S1 (generator `sketch/gaps/gen-timeline.mjs`): r11 "回答 执行者 · 重新入队与失败类别：检查不完整的计数", s38 "回答 执行者 · SSE 推送：失败类别的界面文字"; `members` SM / SV are named "执行者" (the run codes of the old two executors; every executor run belongs to its task's line; no board groups 轨道 by them — Main uses tpLanes, TaskMap wlView) | Main F1, WORKLINES S1 |
| `arch-semantic.js` | S2 (`gen-arch.mjs` run on today's ArchOverview): UI, Host, AgentRuntime, WorkGraph owner '未分配' — exactly these four lines | ArchOverview, others-fix 8 |
| `worklines.js` | (1) the **Session rule** (option (a), notes-others-fix.md finding 1): a Host restart opens a new Session on a line only where it left a RUN of that line without an end (中断 / 没有结束记录) — an EDIT in `build-worklines.mjs`; (2) **a long-lived role's line** (秘书, 架构参谋, 审阅者 · 规格) owns the goal's story tasks whose agent is that role (`workLines().std`, never the 600 example's synthetic ones): it gets the files of those that had started (so `wlAreaOwner` counts it), and its most urgent owned task that needs you ranks it and, unless it is at work, gives it that task's word, dot and reason; `base` keeps the line's own state for boards that change tasks later (`wlRailAt`, in `worklines-api.js`); (3) `wlLabel()` renames nothing any more (S1 done); comments that placed 轨道 on the draft or quoted a 段 that no longer exists | others-fix 1; Main F2, Decide / Done 1–2 (S-1) |
| `worklines-snap.js` | regenerated: 段 only where a line really has two Sessions (T27 前端拆分; 架构参谋 at `decide`); role rows with files (审阅者 · 规格: STATE-MACHINES-SPEC.md, goal-machine.ts); `decide`'s 架构参谋 / 审阅者 · 规格 ranked and worded by their tasks (the order Decide's board already showed) | as above |
| `taskpanel.snippet.js` | Plan / Goals review fix (tested patch, `sketch/rework/plan-goals-fix/trial/`): a calibrated `rowW` (estimate − measured −4 … +7px), a tree that fits is never measured (`down` / `wheel` return without `canPan`), no drag on a right-click, a drag whose release was lost is dropped at the next move without the button; Main F3: `tpUnits` honours a run's own line (`r.line`); Main F6: a packed group's header "本段 n 条工作线，最多同时 r 条，在做的最多 k 条" | Plan / Goals 1, 3; Main F3, F6 |
| `taskpanel.snippet.html` | [0] PART A: `.tp-bar` wraps and the hint stays on one line; a viewport with nothing to pan is as tall as the tree (`.tp-view.is-pan:not(.can-pan)`); a tree wider than the panel keeps its labels whole (`width: max-content`) | Plan / Goals 1, 4 |
| `WORKLINES.md` | the Session rule (§1), the sessions and 负责 of §3, the Decide ask, S1–S3 done, Phone's 13:50 answer, Member's question settled | others-fix 1, 3 |

**Generators.** `gen-snapshot.mjs` runs on TaskMap's class (the draft's gave byte-identical output; `SNAP_BASE=<Board>` picks
another) with `timeline.js`, `arch-semantic.js` and `worklines.js` from this folder on top, so it never reads an older paste.
`check-worklines.mjs` reads the retired draft (`v2/prev/retired-taskdag/TaskDAG.dc.html`) and gives its `workLines()` the
new Session rule in memory: 32,749 comparisons, 0 differ. `gen-snapshot.mjs`: 843 comparisons, 0 differ.

**Re-pasting** (each board's own way; `sketch/integration/xcheck/final-xcheck.sh` then rebuilds every board independently — its
copy from before this step + `sketch/integration/repaste.mjs`, the old pasted text of each changed data file replaced by the
new, whole file or method by method, + the few board edits named below — and gets the same bytes for all ten boards):
Decide / Done `rework-decide.mjs` / `rework-done.mjs` (they now also re-paste `arch-semantic.js` method by method:
`repasteMethods()` in `sketch/rework/boards-common.mjs`; COMMON's `wlRoleRow` starts from `base`; Decide's q8 answer "…接着用
它的工作记录" (one Session under the new rule); Done's script also applies S3 to its own `axRepo`); TaskMap
`sketch/taskmap-dag/build.sh` (its `src/own.js` says the packed group's numbers as the panel does, F6); Plan `paste-snippets.mjs` + piece [0]; Goals `paste-rework.mjs` + `semAreas`, `axRepo` and
piece [0]; Chain, Member, Phone, ArchOverview `sketch/rework/boards4/paste.mjs`; Main `repaste.mjs` (no script: its
part 1–3 scripts refuse to run on a later Main) plus `common-main.mjs` (the COMMON `wlRoleRow` that starts from `base`) and
`main-talkruns.mjs` (a read-only question names its line: F3, board side). `consistency/verbatim-all.mjs`: every board as
before the step (Goals' "NOT whole" and Done's `axRepo` are their documented own copies).

**Not changed (and why)**: piece [0] stays in the helmets (see the table above); Decide / Done's `TP_FIX` stays theirs (on
Main a pannable tree keeps the approved `flex: 1 1 0`); the work-line row's form differs between rails (DESIGN §21.10, open question 1).

## Final fix 2026-10-06 (the final critic's findings; DESIGN §21.14)

Backup before this step: `v2/prev/pre-final-fix-1006/` (project, data, DESIGN, TaskMap's `src/`). Scripts and logs:
`sketch/final-fix/` (notes: `sketch/rework/notes-final-fix.md`).

| file | change | why |
|---|---|---|
| `worklines-long.js` (new) | TaskMap's `hist600()`, `wlSrc()`, `wl6()`, `wlActs()`, `wlLongView()` moved here from its `own.js`. `hist600()` / `wl6()` now read `big600()` itself (TaskMap's model of it gave the same rows: every TaskMap static sketch byte-identical after the move), so a board's pause, cancel or decision never rewrites the synthetic history; the proxy's `tlModel()` adds the synthetic rows AFTER the board's own `extraRuns` (Main's turns) and its marks only for goal 1. `wlLongView()` takes `hk` (the hover's state key: 'wHover' on the DAG page, 'hover' in the panel), `calX` (where the hour row starts) and an optional `clampFor` (the DAG page's cursor) | finding 1: Main and TaskMap read ONE model at 600 ("21 条工作线工作中" on both; before, Main's rail and goal bar counted goal 1's real lines only); the panel's 全部 spans 8 weeks at 600, so it needs the year-style calendar too |
| `taskpanel.snippet.js` | part A: `tpThumb` gives the 任务图's viewport the class `is-task` (kit §18.5 a dims group squares further there, never on the 架构图); `tpOwner` reads `opt.src` when given. Part B: `tpLanes` reads `o.src` (the work-line model, `wlSrc()`), draws the year-style calendar when 全部 spans more than 14 days (`wlLongView`; `tpWin` takes a picked `day`), has the filter "只看需要关注的" (state `wlAttn`: the lines that need you, in the order key; the archived row leaves while filtering; "没有需要关注的工作线" when none), a closed group's short line "本段 n 条，\n最多同时在做 k 条" (the DAG page's words, on two lines), no 记录 row on a bar card of a one-Session line | findings 1, 2, 5, 6, 7 |
| `taskpanel.snippet.html` | [0] PART B: the closed group's two-line short line (`pre-line`, a 56px row); [3]: the filter button after the window, the crumb (全部 › 日 › 时), the year grid before the hour calendar (which shows only when a day is picked in a long 全部), legend lines | findings 5, 6, 1 |

**Re-pasting**: `sketch/final-fix/repaste-ff.mjs <Board> <oldDir> <files>` (and `sketch/integration/repaste.mjs` with
`REPASTE_OLD`) — the old pasted text replaced by the new, whole file or method by method: Main (taskpanel whole, [0] PART B,
[3], worklines-long.js pasted after worklines.js by `main-edits.mjs`), Plan, Goals, Decide, Done (`tpThumb`, `tpOwner`);
TaskMap by `sketch/taskmap-dag/build.sh` (assemble.mjs pastes worklines-long.js whole). `consistency/verbatim-all.mjs`
also reports worklines-long.js: Main and TaskMap whole, 5/5.

**Not changed**: `worklines.js`, `worklines-snap.js`, `timeline.js`, `arch-semantic.js`, `auxtabs.snippet.*`,
`squares.js`, `timeview.snippet.html` (the snapshot boards — Plan, Goals, Decide, Done, Chain, Member, Phone, ArchOverview —
show the 40-task story only, so the 600 record does not reach them).

## Decision 33 2026-10-06 — a work line's own conversation in the centre (lineview, shared step; DESIGN §22)

The user, on version 14: a click on a work line in the left rail only expanded a summary, and nothing showed where the
line's own conversation is or that you can talk to it (repo HANDOFF decision 33, UI-WORKBENCH §0 item 13; the older
direction UI-WORKBENCH §1 item 2). Now a click on ANY work line switches the centre to that line's conversation; the
summary becomes the row's hover card. Backup before this step: `v2/prev/pre-lineview-1006/` (project, data, DESIGN).
Harness, shots and notes: `sketch/lineview/` (`notes-shared.md`).

| file | change |
|---|---|
| `worklines.js` | new read method **`wlRecord(key, at, ctl)`** (in `sketch/rework/gen/worklines-api.js`, generated by `build-worklines.mjs`; the header line names it). Every other method is unchanged (`check-worklines.mjs`: 32,749 comparisons, 0 differ) |
| `worklines-snap.js` | the same `wlRecord()` over the snapshot, and each data method carries `recs` (every line's record at that moment; `alt.<ctl>.recs` where the goal's 暂停 / 取消 changes a line's entries). Generated by `gen-snapshot.mjs` (extended): snapshot vs live read API **1,144 comparisons, 0 differ** (the 843 of before + 301 `wlRecord` comparisons by line id, by task and by role, at every moment and control). The data methods grow: main 15.2 → 37.1 KB, decide 13.2 → 33.9, chain 11.1 → 29.2, plan 11.1 → 29.2, done 14.9 → 43.6 (a board pastes one) |
| `lineview.snippet.js` (new) | 15 methods, pasted verbatim: `lvState`, `lvLeave`, `lvCur`, `lvRowOf`, `lvDoing`, `lvTx`, `lvRail`, `lvSays`, `lvAnswer`, `lvSafe`, `lvWeekday`, `lvMin`, `lvSteps`, `lvTipCard`, `lvView` |
| `lineview.snippet.html` (new) | pieces [1] the rail rows, [2] the archived names, [3] the line's conversation (head, facts and controls, record, composer) |
| kit.css | **§19** appended (the first 90,193 bytes unchanged): rail rows and their card, the head, the facts and controls, the record's rows, what you send, the composer's switch, narrow windows |

**`wlRecord(key, at, ctl)`** — key = a line id (`'L:T28'`), a task id (`'T28'`) or a role (`'advisor'`), as `wlLineOf()` takes
it; returns the rail row of `wlLineOf()` (id, name, role, task, short, area, stage, files, sessions, first, last, attn,
state, word, dot, why, recent) plus `attempt` (of its last run or check; null for a role's line), `archived`, `segs`
(`[{ seg, from, why }]`, why = "Host 10-03 15:12 重启后接续") and `entries` in time order: every run, check, read-only
consultation it answered and conversation turn of the line, and the marks of the tasks it ran (需要你决定 …):
`{ id, kind: 'run' | 'check' | 'query' | 'talk' | 'mark', task, taskName, att, seg, round, start, end, day, time, dur, res,
word, tx, label, gap, asker, steps, edits, checks, live }` (`asker`: the line that asked a consultation, '' = you, null when
not a consultation; `gap`: why the bar began — 接续 / 返工 / 系统自动重新检查). `ctl` 'paused' / 'cancelled': a run or check
still going ends at the moment as 已暂停，可继续 / 已取消 (tlModel's stop rule); consultations and turns go on. Examples at
14:15: 执行者 · SSE 推送 = v10 run 已结束, v11 run 执行中 (live), v12 临时分支 · 你问 已回答, v13 咨询 · 架构参谋问 正在回答;
执行者 · 检查不完整判定 = four attempts with their checks and the mark "自动返工已达上限（3/3），需要你决定"; 执行者 · 前端拆分 = two
Sessions. At 600 tasks Main reads it through `wlSrc()` (the synthetic record's lines open the same way).

**What the snippet draws** (the worked example is `sketch/lineview/demo/make-demo.mjs`: Main → `LineDemo.dc.html`, every
edit a literal replacement that must match once):
- **Rail** ([1], [2]; `lvr = this.lvRail(lines, archivedLines, s, { set })`): a row is a button that opens the line in the
  centre (state `line`; 秘书（主对话）'s row goes back to the main conversation); the row of the conversation in the centre is
  current (`aria-current`, `--active`); hover / focus (`lvHover`) shows the card the click used to expand — dot + name, the
  word (and the live line while it works), 负责 · 正在做 / 原因 · 最近一步, "点一下在中间打开它的对话" — under the row inside the
  rail, above it for the last three rows and the archived names. The archived names are buttons now (read-only lines).
- **Centre** ([3]; `lv = this.lvView(s, o)`): a head "‹ 回到主对话 / <line name>  <goal>  整页查看 ▯" (整页查看 only for
  执行者 · SSE 推送 → Member.dc.html and 执行者 · 重新入队与失败类别 → Chain.dc.html); the facts 状态 · 任务 (a link to the task in the
  map) or 负责 · 尝试 · 工作记录, then 正在做 / 原因 (or 最近一步 for an ended line); the controls that apply with the approved
  hover cards (Member's state machine: 暂停 → 已请求暂停，等安全点 → 已暂停，可继续 → 继续; 取消 asks first → 已请求取消 → 已取消 →
  重新入队 with 接续说明; only while a run of the line goes on, none while the goal is stopped, a role's line 暂停 / 继续 only); the
  record as the conversation's rows (day lines, the run row of the kit with its steps where the board passes them, a quiet
  row per check, consultation and turn, attempt and Session separators, the marks), newest at the bottom and in view; then
  what you sent it; the composer with 问一问（只读） / 直接干预 (hover cards say what each does; 直接干预 is off on an archived or
  ended line).
- **Rows of the rail count what the line views did**: a board maps its rows through `lvRowOf(row, s)` before counting
  (`wlHeadOf`, the goal bar), so a line paused in its view reads 已暂停 and the head says "工作中 2 · 待命 9 · 已归档 8".

**What every board provides**
1. Paste `lineview.snippet.js` (verbatim) and re-paste `worklines.js` whole / the snapshot's API + data method;
   `this.state = Object.assign(…, this.lvState(), { … })`.
2. Markup: [1] for the `<sc-for list="{{members}}">` block, [2] for the archived names, the board's own header, threads
   and dock inside `<sc-if value="{{lv.hide}}" hint-placeholder-val="{{ true }}">`, [3] after them inside `<main>`.
3. renderVals: line objects in the rail's shape `{ id, name, role, task, short, state, word, dot, why, recent, duty,
   doingKey, doing, last, live }` (the board's approved texts; `task` / `short` may be left out — `lvView` reads them from
   the record), the archived ones too; `lvr = this.lvRail(lines, archived, s, { set })`; `lv = this.lvView(s, { set, line,
   rec: W.wlRecord(s.line, <moment>, <goal ctl>), rich: { reply, liveStep, steps, page }, goal, goalCtl, stamp, back |
   backHref, backLabel, togglePanel, showThink, full, autoOpen, selTask, taskSq, rejects, rejectReply })`; return `lvr`, `lv`.
4. Count the rail over `lvRowOf(row, s)`; merge `this.lvLeave()` into every action that goes to the main conversation
   (Main: `openDec`, the goal rows, 在对话里问 in the detail; the line view hides the decision card and the goal bar).
5. Drop the old expansion: `member` state, `m.branch` / `askTo` (the 临时分支问一问 in the rail and the composer's
   "发给：… · 临时分支（只读）" line — 问一问（只读） is in the line's own composer now), `hasRecord` / `hasPage` links (整页查看 now).

**Per board** (for the board agents; the lead decides where a board differs)

| board | moment · read API | back row | rich texts (`o.rich`) | notes |
|---|---|---|---|---|
| Main | `worklines.js` · 'main' (`wlSrc()` at 600), ctl from the goal bar | button | CARRY's `reply`, `liveStep` from its live lines (T13 运行命令 · 状态机单元测试, T28 编辑 · src/app/server.ts), `page` (T13 chain, T28 member) | `make-demo.mjs` is the exact edit list; the demo passes Member's out-of-scope rule as `rejects` for 执行者 · SSE 推送 |
| Plan | `wlSnapPlan` · 'plan' | button (its centre is the secretary's goal-2 conversation) | its own row strings | its rail rows lose the expansion; its clock (14:36 …) as `stamp` |
| Decide | `wlSnapDecide` · 'decide' | button, label for the lead ("回到主对话" goes to Decide's own centre, or a link to Main) | its CARRY | its stale order and `wlRoleRow` stay; rows through `lvRowOf` |
| Done | `wlSnapDone` · 'done' | button | its rows | most lines are archived or 已做完 there: read-only views |
| Chain | `wlSnapChain` · 'chain' | link (`backHref`) to Main.dc.html; its own line's row = its own page (`line: null`) | — | keeps its two-line rail rows: take [1]'s attributes and card on its own row markup |
| Member | `wlSnapMain` · 'main' | link to Main.dc.html; 执行者 · SSE 推送's row = its own page | — | its own page keeps 临时分支问一问（只读） / 直接干预 as approved; other lines open as line views in its centre |

**Checks** (`sketch/lineview/`): `gen-snapshot.log` (1,144 / 0), `check-worklines.log` (32,749 / 0), `demo/build.log`
(format lint clean, no unknown holes, every handler a function, no handler errors — Main's own handlers walked as its harness
does and every rail-row and line-view handler in full; the centre with no line open renders the same HTML as Main's (whitespace between tags aside) in five states;
flows for open / back, every card, every line's view, 问一问, 直接干预 on a working, a refusing and an idle line, 暂停 → 继续 →
取消 → 重新入队, read-only lines, the goal paused, 600), `demo/shoot.log` (46 shots + 16 crops in `sketch/lineview/shots/`:
no console problems, no sideways overflow, every rail card inside the rail and clear of its row), `verbatim-all.log`.

### Integration 2026-10-07 (DESIGN §22.4) — what the six boards had added round these files is in them now

After the board steps and the independent verification each board carried its own copies of the same fixes (helmet rules,
methods round `lvView`, `[3]` variants). The integration step moved them here and every board re-pasted the files whole
(`sketch/lineview/integ/integ-boards.mjs` rebuilds each board from the one its own step left, `v2/prev/pre-integ-lv-1007/`).
Backup before this step: `v2/prev/pre-integ-lv-1007/` (project, data, DESIGN.md, the harnesses; SHA256SUMS).

| file | change |
|---|---|
| `lineview.snippet.js` | **17 methods** (+ `lvSwapTo`, `lvCardUp`): every conversation opens on 问一问（只读） (`lvLeave()` and the rail's pick reset `lvMode`; picking the open line again keeps it); `lvLeave()` also settles a question whose copy was being made (`lvCur`) when a line was open; the card's direction is measured on hover / focus (`lvCardUp`, state `lvHoverUp`; a static page keeps `o.upFrom`); an archived line's card keeps a 正在做 row where the board gives one (`L.doing`); `lvView` holds a 直接干预 to a line whose word is 等你决定 (st `'decide'`: 已排队, no step-on button, "等你决定：你在「需要你决定」里处理后，在第一个安全点送达", 何时 / foot "它在等你决定：你在「需要你决定」里处理后交给它"); a refused 直接干预 ends the run that handled it ("处理你的直接干预，不改，接着做原来的任务") and a busy line goes on with its task (a run "接着做 <task>" with `rich.liveStep`); the 任务 fact in three forms (`lv.task.isBtn` / `isLink` / `isPlain`, below); the quotes of 引用到草稿 belong to the conversation in the centre (`lvSwapTo`, state `lvKeep`: each conversation keeps its own, as its draft) and go with what you send (a quote alone can be sent); a sent quote that keeps its lines folds open (`lvOpen`) |
| `lineview.snippet.html` | [3] only: the 任务 fact as a button to the map shown, a link to Main's task map (`Main.dc.html`, "在主画面的任务图里看这个任务") or plain text (`.lv-task.is-plain`: its name, its square only where the board gives `taskSq`, the title `o.noTaskTip`); your two bubbles lead with the quotes they took (Main's `.bq`); the composer shows the quotes waiting in its draft (the kit's `.composer-quote`, §15.5). Every board pastes [3] whole now (Main, Chain and Member had their own variants) |
| kit.css §19 | 13,883 bytes now (was 8,713; the first 90,193 bytes unchanged — `sketch/lineview/apply-kit.sh` = v14 kit + `kit-19.css`): the spinner hidden at both ends of its 1ms animation, `forwards`, its grid place on itself; the `>` rules across an `<sc-if>` of [3] written as descendants; the card's name wraps; the centre of the app shell (`.kit.app > .main`) is a query container: under 640px the head takes two rows, under 440px the controls go under the facts; `flex: none` for 整页查看 and the panel button; a step's words wrap (a path keeps one line); word joiners round the "·" of a result word; `.lv-task.is-plain`; the bubble quotes |

**New `lvView` inputs**: `o.hasTask(id)` (the map shown has the task; else plain text with `o.noTaskTip` — Main at 600 tasks),
`o.taskHref: true` (a page without a task map links the fact to Main's: Chain, Member). Neither `selTask` nor `taskHref`: the
task's name only (Plan, whose maps hold goal 2). The quotes need nothing from the board: `state.quotes` is the auxiliary area's
(`auxtabs.snippet.js`); a board without it (Chain, Member) has none. Main keeps its own `lvAttach` for one thing only: a
question's copy answers in the next minute on its clock, so 轨道 draws the consultation (talkRuns).

**Per board after the integration** (DESIGN §22.2 lists what each board still does on its own): Main, Decide and Done pass
`selTask` (Main also `hasTask`), Plan passes none; Chain and Member pass `taskHref: true` and `backHref`; Decide's own `lvHold` keeps holding a line its
queue asks about under another word and gives a paused task's line the item's 继续 / 取消, in the shared hold's words; Plan's
board code still gives 审阅者 · 规格's card the live line of its own goal-2 run.

### Final fix 2026-10-07 (DESIGN §22.9) — the final critic's findings

Backup before this step: `v2/prev/pre-finalfix-lv-1007/` (project, data, DESIGN.md, `kit-19.css`, the generators in `gen/`,
the harnesses; SHA256SUMS over project, data and DESIGN.md). `sketch/lineview/final-fix/fix-boards.mjs` rebuilds every board
from that copy with the files below (each edit a literal replacement that must match once; `fix-boards.log`).

| file | change |
|---|---|
| `lineview.snippet.js` | still 17 methods. `lvDoing`: a paused line's 正在做 by Main's rule on every board — the run you started, live or stopped by your pause; else, for a line you paused in its view, the step it was on (its live line without 正在, or the board's 正在做 text — never another key's text, such as Done's 完成); a line the goal's pause holds keeps the board's approved row; it returns `was` (what the line was doing when it stopped). `lvAnswer(L, row, rich, changed, before)`: 最近一步 is the card's (`L.last` before the read API's `recent`); "暂停时…" says `before` (lvView passes `was`). `lvView`: a line the goal's 暂停 / 取消 holds reads 原因 (你暂停了目标 / 目标已取消，记录保留) and the record ends with a line (the kit's sys-line, in view when the view opens at its newest rows) that says where to go on ("目标已暂停：这条工作线跟着目标停下。要它接着做，回到主对话在目标栏点继续。"; idle lines: "…发给它的直接干预会排队…"); an ended line's 最近一步 is `L.last` first; the back row takes `o.backLabel` / `o.backTip`; `o.decide(line)` (a handler) or `o.decideHref: true` (a link to Main.dc.html) makes the record's newest 需要你决定 mark and a held message's 「需要你决定」 a `.ref` button or link while the line waits for your decision; `R.acts` (the record's direct interventions) are drawn as your bubbles, in time order, with their track (已排队 → 已送达 → 被拒绝 / 已生效), reason and reply |
| `lineview.snippet.html` | [3] only: the back row's title is `{{lv.backTip}}`; the mark row has `e.noGo` / `e.goBtn` / `e.goLink` (the kit's `.ref`); the act note has `e.noteOnly` / `e.noteGo` / `e.noteLink` (`noteA` + 需要你决定 + `noteB`) |
| `worklines.js` (from `sketch/rework/gen/worklines-api.js`, `build-worklines.mjs`) | `wlRecord` returns `acts`: `{ id, start, day, time, text, res: 'rejected' \| 'applied', why, reply }`, each at the end of the run that handled it. The sample has one: 执行者 · SSE 推送's run v10 refused "顺便把状态机的失败类别也改了。" at 14:03 (the approved Member page's message, reason and reply) |
| `worklines-snap.js` (`gen-snapshot.mjs`) | `recs.<line>.acts` where a line has any; the snapshot's `wlRecord` returns `acts: rec.acts \|\| []`. 1,144 comparisons, 0 differ; `check-worklines.mjs` 32,749 / 0 |
| `WORKLINES.md` | the read-API table's `wlRecord` row names `acts` |
| kit.css §19 | 19.8 (+ 356 bytes; the first 90,193 bytes unchanged): `.lv-msg .pnote .ref` without the kit `.ref`'s padding, so 「需要你决定」 reads as a word of the sentence |

**New `lvView` inputs**: `o.backLabel` / `o.backTip` (Decide: 回到需要你决定 → its queue; Chain: 回到 重新入队与失败类别 → its
record; Member: 回到 SSE 推送 → its page — each a button; the 秘书（主对话） row stays the link to Main), `o.decide(line)` (Main:
the decision card of the line's task; Decide: the queue with the item open) or `o.decideHref: true` (Plan, Chain, Member: their
rail's 需要你决定 row links to Main).
