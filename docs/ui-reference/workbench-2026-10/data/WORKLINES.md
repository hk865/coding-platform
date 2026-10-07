# WORKLINES.md — work lines on every board (user decisions 25 and 30, 2026-10-05/06)

The work list the board agents follow to replace the old two-executor model ("执行者 · 状态机", "执行者 · 服务重构",
"2 位成员工作中") on every board. Shared step 1 of the rework (2026-10-06); DESIGN §21 will carry the summary. Code:
`data/worklines.js` (live), `data/worklines-snap.js` (snapshot), `data/squares.js` (the task square). Generators and
checks: `sketch/rework/gen/` (`build-worklines.mjs`, `check-worklines.mjs`, `gen-snapshot.mjs`, `show-snapshot.mjs`,
`checklist.mjs`).

## 1. The model in five lines

1. A **work line** is one Session plus the Sessions that continued it after an interruption — a Host restart that left a
   RUN of the line without an end (中断, 没有结束记录) opens the next Session; a line that ran nothing at the restart, or whose
   run went on past it, keeps its Session (integration step 2026-10-06, option (a) of notes-others-fix.md); never a role,
   never a person. "成员" is only a projection of the lines.
2. The long-lived roles have one line each — 秘书（主对话）, 架构参谋, 审阅者 · 规格 in the sample data (书记 and 模块维护 have
   none). **执行者 open one line per task**, named `执行者 · <task name>`, and run side by side.
3. A read-only consultation sits on the line that was asked; the line that asked shows **等回复** while it is answered.
4. Counts are written apart (decision 30): **工作中** (a run, check, consultation or turn of the line spans now) ·
   **待命** (every other line that is not archived: 等你决定, 等回复, 已暂停, 停下（失败）, 停下（受阻）, 已做完, 待命) ·
   **已归档** (an executor line whose task was 已满足 more than a day before) — never one "n 位成员" number.
5. Rails, member dots, 负责 texts and goal-bar counts all come from ONE read API, with the same names and shapes in
   `worklines.js` (computed live, on the boards that paste `timeline.js`) and `worklines-snap.js` (read from a generated
   snapshot, on every other board).

## 2. Which file, which moment

| board | pastes | moment (`at`) | notes |
|---|---|---|---|
| Main | `worklines.js` + `squares.js` (needs timeline.js, arch-semantic.js, std40, taskModel, isBig — all there) | `main` 10-04 14:15, `ctl` = null / 'paused' / 'cancelled' from its goal bar | live; its own clock adds 秘书's work after 采用 (§5) |
| TaskMap (becomes the DAG page) | `worklines.js` + `squares.js`; TaskDAG's `own.js` copies of runIndex, stamp, workLines, barAt, busyAt, waitingAt, agentAt, groupAgentAt, unitStats, wlUnits, sqAt and `draft().consult` go away | `main` | the 轨道 view (wlView / wlWindow / wlConc) stays TaskDAG's |
| Phone, Goals, Member, ArchOverview | `worklines-snap.js`: the read API + `wlSnapMain()` | `main` (Phone also `ctl`) | |
| Decide | read API + `wlSnapDecide()` | `decide` 10-04 14:15 (its stop reasons) | |
| Chain | read API + `wlSnapChain()` | `chain` 10-04 14:32 | |
| Plan | read API + `wlSnapPlan()` | `plan` 10-04 14:36 | its own clock adds goal 2's line after 采用 (§5) |
| Done | read API + `wlSnapDone()` | `done` 10-06 16:33 | built from Done's own `done40()` |

Every board that draws a task's own square also pastes `squares.js` (`sqAt(st)`; see its header for where it is used and
where not). A board pastes `worklines.js` OR `worklines-snap.js`, never both (`consistency/verbatim-all.mjs` reports a
method defined twice).

### The read API (both files)

| method | returns | example (main) |
|---|---|---|
| `wlRail(at, ctl)` | `{ at, rows, archived, counts, head, archivedText, goalBar }`; a row: `id, name, role, task, short, area, stage, files, sessions, first, last, attn, state, word, dot, why, recent` | head "工作中 3 · 待命 8 · 已归档 8" |
| `wlOwner(taskId, at, ctl)` | 负责 of a task | "执行者 · SSE 推送 · 工作中"; with more than one Session "执行者 · 前端拆分 · 已做完，第 2 次尝试（工作记录第 2 段）" |
| `wlGroupOwner(nodeId, at, ctl)` | 负责 of a stage or batch | "4 条工作线做过这里的任务，2 条在做" |
| `wlGoalOwner(at, ctl)` | 负责 of the goal root | "秘书 · 待命，另有 3 条工作线工作中" |
| `wlAreaOwner(path or files, at, ctl)` | 负责 of an architecture node (a long-lived role's line counts with the files of its tasks that had started — integration step) | "11 条工作线改过这里的文件，1 条在做" (WorkGraph) |
| `wlGoalBar(at, ctl)` | the goal bar's count | "3 条工作线工作中" |
| `wlLineOf(taskId or role, at, ctl)` | the line's rail row | `wlLineOf('T13')` → 执行者 · 重新入队与失败类别 |
| `wlHeadOf(rows, archived)` | the head again after the board changed rows itself | "工作中 4 · 待命 7 · 已归档 8" |
| `wlRecord(key, at, ctl)` (decision 33, 2026-10-06; key = a line id, a task id or a role) | the line's rail row + `attempt`, `archived`, `segs` and its `entries` in time order (runs, checks, consultations it answered, turns, marks) and its `acts` (the direct interventions you sent it: text, 被拒绝 / 已生效, reason, reply — final fix 2026-10-07) — for the line's own conversation in the centre (`lineview.snippet.js`) | `wlRecord('L:T28')` → 已结束 13:52–14:03 · 执行中 14:04 起 · 临时分支 · 你问 已回答 · 咨询 · 架构参谋问 正在回答 |

`worklines.js` adds the model itself (`workLines()`, `wlUnits(by)`, `agentAt(n, S)`, `groupAgentAt(n, S)`,
`busyAt(t)`, `waitingAt(S)`, `wlStatus(L, S)`, `wlNowStates(ctl)`, `wlAbout()`, `wlLabel(b)`) for the 轨道 lanes and the DAG.

## 3. The numbers

### 3.1 At 10-04 14:15 (`main`) — 19 lines: 工作中 3 · 待命 8 · 已归档 8

In rail order (秘书（主对话） first, then 需要你决定 > 失败 > 受阻 > 待核对, then the most recent activity):

| line | word | dot | why (shown after the word, or in the expanded row) | sessions |
|---|---|---|---|---|
| 秘书（主对话） | 待命 | s-idle | 没有进行中的工作 · 最近：修改方案，10-04 14:13 | 1 |
| 执行者 · 检查不完整判定 | 等你决定 | s-waiting | 自动返工已达上限（3/3） | 1 |
| 执行者 · 启动核对 | 停下（失败） | s-idle | 执行失败，系统自动重新入队（1/3），等待推进 | 1 |
| 执行者 · 检查链与重新检查 | 停下（受阻） | s-idle | 检查不完整，第 2 轮的类型检查被 Host 重启打断 | 1 |
| 执行者 · SSE 推送 | 工作中 | s-running | 第 1 次尝试，已改 3 个文件 (also answers 架构参谋's consultation) | 1 |
| 执行者 · 重新入队与失败类别 | 工作中 | s-running | 第 2 次尝试 · 接续，上次检查未通过 | 1 |
| 执行者 · 接续说明 | 正式检查中 | s-running | 正式检查第 1 轮进行中，9/14 项已完成 | 1 |
| 架构参谋 | 等回复 | s-waiting | 等 执行者 · SSE 推送 回复：core-routes 拆分后的边界 | 1 |
| 审阅者 · 规格 | 待命 | s-idle | 没有进行中的工作 · 最近：回答 执行者 · 重新入队与失败类别：检查不完整的计数，10-04 13:47 | 1 |
| 执行者 · 前端拆分 | 已做完 | s-idle | 最近：通过，10-03 15:58 | 2 |
| 执行者 · 证据链接 | 已做完 | s-idle | 最近：通过，10-03 14:31 | 1 |
| 已归档 8 条（任务已满足超过一天） | | | 平台中断识别、生命周期决定收口、执行事实读取迁移、查询任务写入收口、工作记录目录精简、检查轮次写入收口、消息写入收口、core-routes 拆分 | |

TaskDAG's goal bar at the same moment reads "3 条工作线在做 · 1 条在等" (`busyAt` 3, `waitingAt` 1 = 检查不完整判定) — the
same three lines; 架构参谋's 等回复 is not a task wait, so TaskDAG does not count it.

- **暂停** (`ctl: 'paused'`): 工作中 0 · 待命 11 · 已归档 8; SSE 推送, 重新入队与失败类别, 接续说明 → 已暂停 (s-waiting, "你暂停了目标");
  the others keep their words; 负责 "执行者 · 重新入队与失败类别 · 已暂停，第 2 次尝试"; goal 负责 "秘书 · 待命，另有
  3 条工作线已暂停".
- **取消目标** (`ctl: 'cancelled'`): 工作中 0 · 待命 11 · 已归档 8; every unfinished task's line → 待命 (s-idle, "目标已取消，记录保留") —
  the approved rule "after 取消目标 the two executors show 待命" now reads "every unfinished task's work line shows 待命";
  架构参谋 stays 等回复 (its consultation is still answered by a read-only copy); goal 负责 "秘书 · 待命".

### 3.2 The other moments

| at | head | goal bar | doing | what differs from `main` |
|---|---|---|---|---|
| `decide` 10-04 14:15 | 工作中 3 · 待命 11 · 已归档 8 | 3 条工作线工作中 | SSE 推送、重新入队与失败类别、接续说明 | three more lines from Decide's stop reasons: 执行者 · 目标列表接口 等你决定（预算耗尽，需要更大预算（200K 已用完））, 执行者 · 取消传播 等你决定（没有新依据，自动返工已停止）, 执行者 · 目标展示读取路由 已暂停（你在 13:58 暂停…）; 架构参谋 has 2 sessions (T44 路由边界登记 before the 14:02 restart) |
| `chain` 10-04 14:32 | 工作中 1 · 待命 9 · 已归档 9 | 1 条工作线工作中 | SSE 推送 | 重新入队与失败类别 (passed 14:22), 检查链与重新检查 (14:31), 接续说明 (14:21) 已做完; 证据链接 archived; 重新入队与失败类别's last step "回答 执行者 · SSE 推送：失败类别的界面文字，10-04 14:32" |
| `plan` 10-04 14:36 | 工作中 1 · 待命 9 · 已归档 9 | 1 条工作线工作中 | SSE 推送 | as `chain`; 架构参谋 still 等回复 (answered until 14:40) |
| `done` 10-06 16:33 | 工作中 0 · 待命 5 · 已归档 25 | 没有工作线在工作 | — | 30 lines (27 executor lines); live rows 秘书（主对话）, 审阅者 · 规格, 架构参谋 (待命), 执行者 · 增量刷新 (已做完, 10-06 14:20), 执行者 · 沿用结果标注 (已做完, 10-06 12:10) — exactly the two old executors' last steps |

### 3.3 负责 at 14:15 (`wlOwner`, `wlGroupOwner`, `wlGoalOwner`)

| task | 负责 |
|---|---|
| T01–T04, T11 | 审阅者 · 规格 · 已做完 |
| T05 T06 T07 T09 T10 T12 T19 T26 | 执行者 · <task> · 已做完 (e.g. 执行者 · 消息写入收口 · 已做完) |
| T08 执行事实读取迁移 | 执行者 · 执行事实读取迁移 · 已做完，第 2 次尝试 |
| T27 前端拆分 | 执行者 · 前端拆分 · 已做完，第 2 次尝试（工作记录第 2 段） |
| T13 重新入队与失败类别 | 执行者 · 重新入队与失败类别 · 工作中，第 2 次尝试 |
| T14 接续说明 | 执行者 · 接续说明 · 正式检查中 |
| T15 启动核对 | 执行者 · 启动核对 · 停下（失败） |
| T20 检查链与重新检查 | 执行者 · 检查链与重新检查 · 停下（受阻），第 2 次尝试 |
| T21 检查不完整判定 | 执行者 · 检查不完整判定 · 等你决定，第 4 次尝试 |
| T28 SSE 推送 | 执行者 · SSE 推送 · 工作中 |
| T16 T29 (可领取) | 未分配，等成员领取；开工时开一条工作线 |
| T17 T18 T22 T23 T30 T31 (待执行) | 未分配；开工时开一条工作线 |
| T24 T25 T32–T40 (未来意图 / 已延后) | 未分配 |
| goal 1 (root) | 秘书 · 待命，另有 3 条工作线工作中 |
| S1 规格与验收 | 1 条工作线做过这里的任务，没有在做的 |
| S2 写入收口 | 7 条工作线做过这里的任务，没有在做的 |
| S3 失败与重新入队 | 4 条工作线做过这里的任务，2 条在做 |
| S4 检查与返工 | 3 条工作线做过这里的任务，没有在做的 |
| S5 服务拆分 | 3 条工作线做过这里的任务，1 条在做 |
| S6 以后再做 | 还没有工作线做过这里的任务 |

At 600 tasks a synthetic task's 负责 names the line the model would open: "执行者 · <task name> · 工作中，第 2 次尝试"
(TaskDAG's rule; `big600()`'s owners must be the role "执行者", R3).

## 4. Replacement strings

| what | approved | now |
|---|---|---|
| goal bar (Main, Phone, TaskMap) | 运行中 · 2 位成员工作中 | 运行中 · 3 条工作线工作中 (`wlGoalBar`) |
| goal rows (Goals centre, Phone) | 运行中 · 2 位成员工作中 / 运行中，2 位成员工作中 | 运行中 · 3 条工作线工作中 / 运行中，3 条工作线工作中 |
| Plan's goal 2 after 采用 | 1 位成员工作中 | 1 条工作线工作中 |
| goal 负责 | 秘书 · 待命，另有 2 位成员工作中 / 已暂停 | 秘书 · 待命，另有 3 条工作线工作中 / 秘书 · 待命，另有 3 条工作线已暂停 / 秘书 · 待命 (`wlGoalOwner`) |
| rail section label | 成员 | **工作线**, then the head on the same line: 工作中 3 · 待命 8 · 已归档 8 (`wlRail().head`); `aria-label="项目、目标与工作线"` |
| rail rows | 5 member rows | `wlRail().rows` in its order, each: dot + name + word; expanded: 负责 (an executor row: "任务：<task>"; a role row: its approved duty), 正在做 (`why`), 最近一步 (`recent`, or the board's richer approved string — table below) |
| archived | — | one bottom row "已归档 8 条（任务已满足超过一天）" (`archivedText`); a click lists those lines (names `--text-3`) |
| member dot | dot s-running 工作中 · dot s-waiting 等回复 / 已暂停 · dot s-idle 待命 | the row's `dot`: s-running = 工作中 / 正式检查中 · s-waiting = 等你决定 / 等回复 / 已暂停 / 等正式检查 · s-idle = 待命 / 已做完 / 停下（失败） / 停下（受阻） |
| after 取消目标 | the two executors show 待命 | every unfinished task's line shows 待命 (`ctl: 'cancelled'`) |
| after 继续 | 已继续：两位执行者从停下的地方接续 | 已继续：3 条工作线从停下的地方接续 |
| 负责 of a task / stage / module | "执行者 · 状态机 · 工作中，第 2 次尝试" (agentText + memberWords) | `wlOwner(id)` / `wlGroupOwner(id)` / `wlAreaOwner(path)` (§3.3) |
| a stage's owner in the 树 at 详细 | 执行者 · 状态机 | not shown (a stage has no single line any more); its card and detail say `wlGroupOwner(id)` — *lead choice* |
| time view copy | 轨道：每位成员一条…; 每一行是一位成员（或一个阶段）…; bar card row 成员 | 轨道：每条工作线一行…; 每一行是一条工作线（或一个阶段）…; bar card row 工作线 |
| TaskMap legend | 负责的成员 | 负责的工作线 |
| two goals sharing files (Goals) | 同一时间只交给一个成员（改） | 同一时间只让一条工作线改 |
| Goals g2 fact | 成员：秘书在起草方案；采用后再分配成员 | 工作线：秘书在起草方案；采用后每个任务开一条工作线 |
| Goals g1 fact | 成员：执行者 · 状态机、执行者 · 服务重构 工作中；架构参谋 等回复 | 工作线：工作中 3 · 待命 8 · 已归档 8；架构参谋 等回复 |
| Done usage table | 各成员用量; rows per member | 各角色用量; column 角色; 秘书（主对话） 38 · 21 万 · 2 小时 10 分 / 执行者（27 条工作线） 310 · 141 万 · 27 小时 45 分 / 审阅者 · 规格 51 · 19 万 · 3 小时 20 分 / 架构参谋 13 · 5 万 · 50 分 (total unchanged 412 · 186 万 · 34 小时 5 分) |
| Chain step | 等待成员 ×6 / 等待成员 | 等待回复 ×6 / 等待回复 |
| Plan crew | 审阅者 · 规格先做规格；执行者 · 服务重构做完目标 1 的 SSE 推送后接手 | 审阅者 · 规格先做规格；之后每个任务开一条执行者工作线 (option C: "审阅者 · 规格写状态词表；之后每个任务开一条执行者工作线") |
| Decide 已暂停 ask (T29) | …执行者 · 服务重构 正在做 SSE 推送，新的执行会等成员空出来再领取。 | …新的执行接在 执行者 · 目标展示读取路由 这条工作线上，接着用它的工作记录。 (nothing waits for a member; one Session under the integration step's rule: the paused run had an end) |

### Old name → line

The two old executors were one name for many tasks; every sentence that names one of them names the task's line now.

| where | old | line |
|---|---|---|
| 14:15 (Main, Phone, Goals, Member, Decide, TaskMap, ArchOverview) | 执行者 · 状态机 (doing 重新入队与失败类别) | **执行者 · 重新入队与失败类别** |
| 14:15 | 执行者 · 服务重构 (doing SSE 推送) | **执行者 · SSE 推送** |
| Chain (its whole record: attempts 1–2 of 重新入队与失败类别, the reply to 审阅者 · 规格, the read-only copy at 14:31) | 执行者 · 状态机 / 执行者 · 状态机（只读副本） | 执行者 · 重新入队与失败类别 / 执行者 · 重新入队与失败类别（只读副本） |
| Chain 14:31 (asks about 失败类别的界面文字) | 执行者 · 服务重构 | 执行者 · SSE 推送 |
| Member (the page) | 执行者 · 服务重构 | 执行者 · SSE 推送; its 工作记录 1 = 执行者 · core-routes 拆分, 2 / 3 = 执行者 · 前端拆分 (other lines) |
| Member's refusal (src/core/work-graph) | 由执行者 · 状态机负责 | 正由 执行者 · 重新入队与失败类别 在改 |
| Decide (13:31–13:58) | 执行者 · 服务重构 (目标列表接口, 延后 任务格子摘要, 目标展示读取路由) | 执行者 · 目标列表接口 (also deferred 任务格子摘要 at 13:31), 执行者 · 目标展示读取路由 |
| Decide T16 | 执行者 · 状态机 | 执行者 · 取消传播 |
| Done (views.ts, 14:06 on 10-06) | 执行者 · 服务重构 | 执行者 · 增量刷新 |
| Done member rows | 执行者 · 状态机 (19 tasks) / 执行者 · 服务重构 (8 tasks) | 27 executor lines; live 执行者 · 沿用结果标注 and 执行者 · 增量刷新, the rest 已归档 (`wlRail('done')`) |
| any Diff note at 14:15 | 执行者 · 服务重构 14:11 / 13:58 / 14:03 的改动 | 执行者 · SSE 推送 14:11 / 13:58 / 14:03 的改动 |

### Approved row strings carried onto the new rows (Main, Decide, Member, Plan, Chain rails)

| new row | 正在做 | 最近一步 | live line |
|---|---|---|---|
| 执行者 · 重新入队与失败类别 (was 执行者 · 状态机) | 第 2 次尝试 · 接续 | 运行命令：状态机单元测试，12 秒前 | 正在运行命令：状态机单元测试 · link 看工作记录 → Chain |
| 执行者 · SSE 推送 (was 执行者 · 服务重构) | 第 1 次尝试 | 编辑 src/app/server.ts +38 −4，1 分钟前 | 正在编辑 src/app/server.ts · link 打开成员页 → Member |
| 审阅者 · 规格 | 没有进行中的工作 | 回复 执行者 · 重新入队与失败类别：检查不完整的计数，13:47 | — |
| 架构参谋 | 等 执行者 · SSE 推送 回复：core-routes 拆分后的边界 | 发出咨询，已送达，6 分钟前 (Plan: 14:09) | — |
| the six new rows | `why` of §3.1 | `recent` | — |

The links: "看工作记录" sits on 执行者 · 重新入队与失败类别's row with the title "这条工作线的工作记录：每一步、检查和原始记录";
"打开成员页" on 执行者 · SSE 推送's row (title unchanged).

### Data (identical copies on every board, R1 / R3)

- `std40()`: `agent: '执行者 · 状态机'` and `agent: '执行者 · 服务重构'` → `agent: '执行者'`; stage `owner` likewise (S2–S5).
  Reviewer / advisor agents and owners stay ('审阅者 · 规格', '架构参谋', '未分配').
- `big600()`: `const owners = [...]` — both executor names → `'执行者'`.
- Done's `done40()`: `const SM = …; const SV = …` → both `'执行者'` (or drop them and write `'执行者'`).
- Decide's `catalogTasks()`: T16 / T29 / T30 `agent` → `'执行者'`; T31's reason "（执行者 · 目标列表接口，13:31）".
- Plan's goal-2 stages A2 A3 B2 B3 C2 `owner: '执行者 · 服务重构'` → `'执行者'`.

### Shared files (not a board edit: change the source, regenerate, every board re-pastes)

- **S1** `timeline.js` (generator `sketch/gaps/gen-timeline.mjs`): row r11 "回答 执行者 · 重新入队与失败类别：检查不完整的计数"; row
  s38 "回答 执行者 · SSE 推送：失败类别的界面文字"; `members` and the 成员 grouping of `timeView()` give way to the work-line lanes.
  Until then `wlLabel()` renames the two old names in those two labels on the fly.
- **S2** `arch-semantic.js` (generator `gen-arch.mjs`, source ArchOverview's `areas`): owners of UI and Host
  ('执行者 · 服务重构') and of AgentRuntime and WorkGraph ('执行者 · 状态机') → `'未分配'` — the sample has no 模块维护 line; the
  负责 row shows `wlAreaOwner(id)`. Workflow (秘书) and docs (审阅者 · 规格) keep their owners.
- **S3** `auxtabs.snippet.js`: server.ts `disk.by` and its comment, and the three Diff notes → 执行者 · SSE 推送.
- **Done (integration step 2026-10-06):** S1 (the two labels; `members` SM / SV are named by the role "执行者" — no board groups
  轨道 by these codes any more, so the 成员 grouping of `timeView()` stays unused rather than rewritten), S2 (`gen-arch.mjs` run on
  today's ArchOverview: exactly the four owner lines) and S3 (5 replacements; Done's own `axRepo` copy too, through
  `rework-done.mjs`); `wlLabel()` no longer renames anything. Every board re-pasted them (`consistency/verbatim-all.mjs`).

## 5. Board notes (what is not a word swap)

- **Main** — the rail lists `wlRail('main', ctl).rows` (11 rows) and the archived row; the panel's 轨道 becomes work lines
  (decision 25: by 角色 / 模块 / 任务, at most 8 rows + "另 n 条 · 整页查看"; shared step 2 or the Main agent). Its own clock: after
  采用 the 秘书 row is 工作中 ("正在拆分任务") → recount with `wlHeadOf()` (工作中 4 · 待命 7 · 已归档 8) and the goal 负责 says
  "秘书 · 工作中，另有 3 条工作线工作中". The architecture map's module 负责 → `wlAreaOwner()`.
- **TaskMap (DAG page)** — paste `worklines.js`, delete TaskDAG's own copies (they are the same code; `check-worklines.mjs`
  compares 32,749 results); TaskDAG's draft note "其他画板仍是旧的两位执行者" goes. kit.css §17.7's dashed `border` is replaced by §18.
- **Phone** — goal row, goal bar, goal 负责 and the resume line as §4; the 13:50 answer (review fix 2026-10-06, finding 3: it says
  what was true at 13:50) "写入收口阶段已全部满足，验收通过。现在 1 条工作线在做：[重新入队与失败类别]；[SSE 推送]等成员领取。" with the one
  step "读取 · 工作记录：执行者 · 重新入队与失败类别" — it replaced the string below; the 14:15 conversation (line 214) as first written:
  "写入收口阶段已全部满足，验收通过。现在 3 条工作线在做：[重新入队与失败类别]、[SSE 推送]，接续说明在正式检查。"; the two steps
  "读取 · 工作记录：执行者 · 重新入队与失败类别" / "…：执行者 · SSE 推送".
- **Goals** — goal rows, facts and the "同一时间只交给一个成员" sentences (§4); the hint "排在前面的先改共享的文件、先用成员" →
  "排在前面的先改共享的文件、先开工" (executors no longer queue for a member) — *lead choice*.
- **Decide** — `wlSnapDecide()`; the catalog's agents (data); the 已暂停 ask (§4); the 预算 card's 谁做的 "Agent（执行者 · 目标列表接口）";
  the 延后 card's title "执行者 · 目标列表接口 延后了必需任务“任务格子摘要”" and 谁做的 "Agent（执行者 · 目标列表接口，13:31）";
  the Diff note "执行者 · 目标列表接口 和 执行者 · 目标展示读取路由 的改动：…".
- **Done** — `wlSnapDone()`: the member list is 5 rows + "已归档 25 条（任务已满足超过一天）"; the usage table by role (§4); the two
  executors' read-only-branch replies ("我完成了 19 / 8 个任务") cannot come from one line any more: an executor row answers for
  its own task, a summary over many tasks is the secretary's.
- **Chain** — `wlSnapChain()`; the page is the record of 执行者 · 重新入队与失败类别 (head-sub); every ledger name per "Old name →
  line"; "回复送出后这次执行结束；执行者 · 重新入队与失败类别 没有别的工作（任务 14:22 已满足）".
- **Member** — the page of ONE line, 执行者 · SSE 推送. The model gives it two Sessions (工作记录第 1 段 13:52–14:03, 第 2 段 from
  14:04 after the Host restart at 14:02), while the approved page shows one record "工作记录 4 · 13:52 起" with both runs: the
  timeline's run_c41a crosses the 14:02 restart (data/README cross-board conflict 2). Either the page splits its record in
  two (and Member's ledger ends run_c41a at 14:02 as 平台中断 + 接续), or the Session rule must not split where a run spans the
  restart — settled for the second (Questions 3, integration step 2026-10-06). Records 1–3 (core-routes 拆分; 前端拆分 ×2) belong to other lines: links to them
  or nothing (R16).
- **ArchOverview** — module owners per S2 (its `areas` are the source); the card / detail 负责 → `wlAreaOwner()`.
- **Plan** — `wlSnapPlan()`; after 采用 goal 2's first task runs on 审阅者 · 规格's line: that row → 工作中, recount with
  `wlHeadOf()`; the goal-2 bar "1 条工作线工作中".

### Questions the board agents should not settle alone

1. "等成员领取" (the approved reason of 可领取, also "采用后由成员领取", "补做任务重新等成员领取") is kept: it names the role that
   claims, not a member count. If the user wants "成员" gone from the UI, it would become "等工作线领取". 
2. The rail label "工作线" (instead of "成员"), and the Member board's title "成员页 · 分支与干预" (kept: the user's own
   decision list keeps 成员卡片 with 问一问 / 直接干预).
3. Member's Session split (above) — **settled by the integration step 2026-10-06**: option (a) of notes-others-fix.md, the rule
   in §1 point 1 (a restart opens a new Session only where it left a run without an end), so 执行者 · SSE 推送 has one Session and
   Member's single record ses_9a31, Chain's "同一份工作记录 ses_8d10" and every 负责 agree; data/README.md conflict 2 stays a
   data oddity (run_c41a crosses the 14:02 line; the rule reads it as a run the restart did not cut).

<!-- checklist:start (generated by sketch/rework/gen/checklist.mjs; line numbers are of the boards as of 2026-10-06 before the rework) -->

## 6. Per-board checklist (every occurrence found)

Generated: `node sketch/rework/gen/checklist.mjs` scans the boards (lines inside a pasted shared file are listed once, under "Shared files"). Line numbers are those of the boards on 2026-10-06 before the rework — the nearby text is the anchor. Lines that stay as they are (feature names such as 目标与成员左栏, the approved reason 等成员领取, the member page's own labels) are not listed unless they name an old executor or a count.

| rule | what replaces it |
|---|---|
| K | — keep: a feature name or the approved "等成员领取" reason / a page about a member card, not a count or an executor name |
| R1 | data: `agent` / stage `owner` of an executor → `'执行者'` (the role only); the text shown comes from `wlOwner(id)` / `wlGroupOwner(id)` (`std40()`, `big600()`, `done40()` and Decide's catalog stay identical copies on every board) |
| R3 | `big600()` owners: both executor names → `'执行者'` (at 600 `agentAt()` names the line the model would open: "执行者 · <task>") |
| R4 | `memberWords()` / `agentText()` / `goalAgent()` / `taskAgent()` / `stageAgent()` → the read API: a task `wlOwner(id, at, ctl)`, a stage or batch `wlGroupOwner(id, at, ctl)`, the goal root `wlGoalOwner(at, ctl)`, an architecture node `wlAreaOwner(path or files, at, ctl)`; the 轨道 `memberWords` input goes with the work-line lanes |
| R5 | goal 负责 → `wlGoalOwner(at, ctl)`: "秘书 · 待命，另有 3 条工作线工作中" · paused "秘书 · 待命，另有 3 条工作线已暂停" · cancelled "秘书 · 待命" |
| R6 | a combined count → `wlGoalBar(at)`: "3 条工作线工作中" (main / decide), "1 条工作线工作中" (chain / plan); never "n 位成员" |
| R7 | member list / dots → `wlRail(at, ctl)`: label "工作线" + `head` ("工作中 3 · 待命 8 · 已归档 8"), rows (`name`, `word`, `dot`, `why`, `recent`) in its order, one bottom row `archivedText` ("已归档 8 条（任务已满足超过一天）") that opens the archived rows |
| R8 | the 负责 / 负责的 Agent row binds the read API value (R4); the row label stays |
| R9 | "两位执行者 / 两位成员" → the lines, counted: "已继续：3 条工作线从停下的地方接续" (the lines that were 已暂停) |
| R10 | an executor named → the work line of that task (table "Old name → line" below) |
| R12 | a link on a line's row: "这条工作线的工作记录：每一步、检查和原始记录" (Chain is the record of 执行者 · 重新入队与失败类别, Member the page of 执行者 · SSE 推送) |
| R13 | "同一时间只交给一个成员（改）" → "同一时间只让一条工作线改"; "采用后再分配成员" → "采用后每个任务开一条工作线" (executors are per task and run side by side; the order of two goals is about their shared files) |
| R14 | usage by role, not by member: aria-label "各角色用量", column "角色"; rows 秘书（主对话） 38 · 21 万 · 2 小时 10 分 / 执行者（27 条工作线） 310 · 141 万 · 27 小时 45 分 / 审阅者 · 规格 51 · 19 万 · 3 小时 20 分 / 架构参谋 13 · 5 万 · 50 分 (the total stays 412 · 186 万 · 34 小时 5 分) |
| R15 | a step "等待成员" (the line waits for another line's reply) → "等待回复" ("等待回复 ×6") |
| R16 | Member page records: the page is ONE work line (执行者 · SSE 推送 and its Sessions); 工作记录 1 (core-routes 拆分) and 2 / 3 (前端拆分) are other lines' Sessions — link to those lines or drop them (see the Member note) |
| R11 | the time view's copy: "每一行是一条工作线（或一个阶段）…", "轨道：每条工作线一行，时间从左到右…", "负责的工作线" |
| S1 / S2 / S3 | shared files, §4 "Shared files" |

#### Main (52)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 39 | `<nav class="rail" aria-label="项目、目标与成员">` | R7 |  |
| 78 | `<div class="rail-label"><span>成员</span></div>` | R7 |  |
| 88 | `<span class="live"><span class="dot s-running" aria-hidden="true"></span>{{m.live}}</span>` | R7 |  |
| 91 | `<dt>负责</dt><dd>{{m.duty}}</dd>` | R8 |  |
| 102 | `…n btn-sm" href="Chain.dc.html" title="这位成员正在做的任务的工作记录：每一步、检查和原始记录">` | R12 |  |
| 740 | `…}}" onClick="{{showLanes}}" title="轨道：每位成员一条，时间从左到右；上面是按小时的活动日历">轨道</button>` | R11 | title="轨道：每条工作线一行，时间从左到右；上面是按小时的活动日历" |
| 963 | `<dt>负责</dt><dd>{{card.agent}}</dd>` | R8 |  |
| 1148 | `<dt>负责的 Agent</dt>` | R8 |  |
| 1252 | `{ id: 'S2', name: '写入收口', owner: '执行者 · 状态机', sem: '让所有正式写入只经状态机，不留旁路。' },` | R1 |  |
| 1253 | `{ id: 'S3', name: '失败与重新入队', owner: '执行者 · 状态机', sem: '失败分五类；能自动重新入队的自动排回，接续时带上原因。' },` | R1 |  |
| 1254 | `{ id: 'S4', name: '检查与返工', owner: '执行者 · 状态机', sem: '让检查能按项重跑、记轮次，返工有上限也有记录。' },` | R1 |  |
| 1255 | `{ id: 'S5', name: '服务拆分', owner: '执行者 · 服务重构', sem: '拆开路由和前端，用推送取代每秒轮询。' },` | R1 |  |
| 1263 | `… 'S2', '消息写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '成员之间的消息只经状态机写入，不再直接改记录。', files: ['src/core/work-graph/communication/mailbox-…` | R1 |  |
| 1264 | `…S2', '检查轮次写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '检查轮次和证据的写入都经状态机判定。', files: ['src/core/work-graph/evidence/evidence-service.t…` | R1 |  |
| 1265 | `…S2', '查询任务写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '查询任务和它的每次执行只经状态机写入。', files: ['src/core/work-graph/queries/query-job-service.…` | R1 |  |
| 1266 | `…S2', '执行事实读取迁移', 'satisfied', { agent: '执行者 · 状态机', att: 2, deps: ['T04'], sem: '把 Kernel 执行事实的读取搬到 Runtime，写入经状态机。', files: ['src/core/agent-runtime/…` | R1 |  |
| 1268 | `…S2', '工作记录目录精简', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '工作记录目录只保留工作记录状态机做出的决定。', files: ['src/core/work-graph/sessions/session-direct…` | R1 |  |
| 1269 | `…S2', '生命周期决定收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T09'], sem: '成员的开始、让出和结束只由工作记录状态机决定。', files: ['src/core/work-graph/sessions/session-lifec…` | R1 |  |
| 1271 | `… 'S3', '平台中断识别', 'satisfied', { agent: '执行者 · 状态机', deps: ['T11'], sem: 'Host 重启或连接中断时记为“平台中断”，不算成员失败。', files: ['src/core/work-graph/state/task-failu…` | R1 |  |
| 1272 | `…'S3', '重新入队与失败类别', 'running', { agent: '执行者 · 状态机', att: 2, why: '第 2 次尝试 · 接续，上次检查未通过', deps: ['T12', 'T05'], sem: '失败后按五种类别决定能否自动重新入队，并记下“系统自动重新入队（n…` | R1 |  |
| 1274 | `…', 'S3', '接续说明', 'verifying', { agent: '执行者 · 状态机', why: '正式检查第 1 轮进行中，9/14 项已完成', deps: ['T08', 'T12'], sem: '新的一次执行开头带上上次停在哪里、为什么停，只用已保存的事实组装。', fil…` | R1 |  |
| 1275 | `…T15', 'S3', '启动核对', 'failed', { agent: '执行者 · 状态机', why: '执行失败，系统自动重新入队（1/3），等待推进', deps: ['T12', 'T13'], sem: 'Host 启动时核对上次没结束的执行；结果未知的交给你决定。', files…` | R1 |  |
| 1279 | `…', 'S4', '证据链接', 'satisfied', { agent: '执行者 · 状态机', deps: ['T06'], sem: '每轮检查的报告、退出码和日志都挂到对应任务。', files: ['src/core/work-graph/evidence/coverage.ts'] …` | R1 |  |
| 1280 | `… 'S4', '检查链与重新检查', 'blocked', { agent: '执行者 · 状态机', att: 2, why: '检查不完整，第 2 轮的类型检查被 Host 重启打断', deps: ['T19', 'T06'], sem: '让检查链支持重新检查：重跑哪些项、记第几轮、什么时候…` | R1 |  |
| 1281 | `…', 'S4', '检查不完整判定', 'decide', { agent: '执行者 · 状态机', att: 4, why: '自动返工已达上限（3/3）', deps: ['T19'], sem: '检查进程被打断或报告缺项时判为“检查不完整”，不判为“检查未通过”。', files: ['s…` | R1 |  |
| 1287 | `…core-routes 拆分', 'satisfied', { agent: '执行者 · 服务重构', deps: ['T04'], sem: '把 core-routes 按目标、任务、成员、文件拆成四组路由。', files: ['src/app/core-routes.ts'] }),` | R1 |  |
| 1288 | `…', 'S5', '前端拆分', 'satisfied', { agent: '执行者 · 服务重构', att: 2, deps: ['T26'], sem: '前端拆成 api、state、components、views 四层。', files: ['src/ui/main.ts', 'src…` | R1 |  |
| 1290 | `…', 'S5', 'SSE 推送', 'running', { agent: '执行者 · 服务重构', why: '第 1 次尝试，已改 3 个文件', deps: ['T26', 'T27'], sem: '用 SSE 把状态变化推给工作台，取代每秒轮询。', files: ['src/app/…` | R1 |  |
| 1310 | `const owners = ['审阅者 · 规格', '执行者 · 状态机', '执行者 · 状态机', '执行者 · 状态机', '执行者 · 服务重构', '执行者 · 服务重构', '架构参谋', '执行者 · 状态机', '执行者 · 服务重构', '未分配'];` | R3 |  |
| 1926 | `/* ------------------------------------------------------------ hover info card (name · state + reason · 归属 · 负责 · 语义 · 任务) */` | R8 |  |
| 1931 | `goalAgent(goal) {` | R4 |  |
| 1933 | `…turn s.cancelled ? '秘书 · 待命' : '秘书 · 待命，另有 2 位成员' + (s.paused ? '已暂停' : '工作中');` | R5 |  |
| 1956 | `… this.cardCount(n, 'task'), agent: this.goalAgent(goal) });` | R4 |  |
| 1958 | `…), tx: 'tx-plain', why: '', agent: this.agentText(n.owner) });` | R4 |  |
| 1963 | `…kind === 'system' ? '架构参谋 · 等回复' : this.agentText(mod ? mod.owner : '未分配');` | R4 |  |
| 1995 | `agentText(a) { const M = this.memberWords(); return a && a !== '未分配' ? a + (M[a] ? ' · ' + M[a] : '') : '未分配'; }` | R4 |  |
| 1996 | `memberWords() {` | R4 |  |
| 1999 | `return { '执行者 · 状态机': w, '执行者 · 服务重构': w, '审阅者 · 规格': '待命', '架构参谋': '等回复', '秘书': '待命' };` | R10 | remove 'memberWords()'; callers use the read API (R4) |
| 2142 | `/* ------------------------------------------------------------ detail (路径/归属 · 负责的 Agent · 语义 · 关系) */` | R8 |  |
| 2170 | `…\|\| {}).cancelled ? '秘书 · 待命' : '秘书 · 待命，另有 2 位成员' + ((this.state \|\| {}).paused ? '已暂停' : '工作中') : goal === 'g2' ? '秘书 · 规划中' : '未分配')` | R5 |  |
| 2171 | `: this.agentText(n.owner);` | R4 |  |
| 2205 | `…kind === 'system' ? '架构参谋 · 等回复' : this.agentText(mod ? mod.owner : '未分配'), sem: sem, rel: rel, group: isGroup };` | R4 |  |
| 2354 | `{ id: 'm2', name: '执行者 · 状态机', st: 'running', duty: 'WorkGraph 的 state、tasks', doing: '重新入队与失败类别，第 2 次尝试 · 接续', last: '运行命令：状态机单元测试，12 秒前', live: '正在运…` | R7 |  |
| 2356 | `{ id: 'm3', name: '执行者 · 服务重构', st: 'running', duty: 'src/app、src/ui', doing: 'SSE 推送，第 1 次尝试', last: '编辑 src/app/server.ts +38 −4，1 分钟前', live: '正在编辑…` | R7 |  |
| 2358 | `…、验收与正式检查', doing: '没有进行中的工作', last: '回复 执行者 · 状态机：检查不完整的计数，13:47', live: '', branch: true,` | R7 | '回复 执行者 · 重新入队与失败类别：检查不完整的计数，13:47' |
| 2360 | `…'waiting', duty: '模块边界、架构目录', doing: '等 执行者 · 服务重构 回复：core-routes 拆分后的边界', last: '发出咨询，已送达，6 分钟前', live: '', branch: true,` | R7 |  |
| 2361 | `reply: '（只读分支）我在等执行者 · 服务重构回复 core-routes 拆分后的边界；回复之前，架构目录不会改。' }` | R10 | '（只读分支）我在等 执行者 · SSE 推送 回复 core-routes 拆分后的边界；回复之前，架构目录不会改。' |
| 2367 | `return { name: m.name, word: word, dot: 'dot ' + (st === 'running' ? 's-running' : st === 'waiting' ? 's-waiting' : 's-idle'),` | R7 |  |
| 2370 | `…ks to the two boards built for members: 执行者 · 状态机's record (Chain), 执行者 · 服务重构's page (Member) */` | R10 | comment: 看工作记录 (Chain) on the row of 执行者 · 重新入队与失败类别, 打开成员页 (Member) on the row of 执行者 · SSE 推送 |
| 2494 | `… ' + (s.pausedAt \|\| '14:15') + ' 暂停' : '2 位成员工作中',` | R6 | → 'this.wlGoalBar('main')' = '3 条工作线工作中' |
| 2497 | `…+ 1; pushLog([{ isSys: true, text: '已继续：两位执行者从停下的地方接续', goal: 'g1' }], { paused: false, stops: stopEnd('pause', c) }); },` | R9 | '已继续：3 条工作线从停下的地方接续' |
| 2585 | `…, stages: tlT.stages, memberWords: this.memberWords(),` | R4 |  |

#### TaskMap (40)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 59 | `… .lane-name { padding-right: 8px; } /* "执行者 · 服务重构" (93px) fits without narrowing the track */` | R10 | comment: the longest lane name is now "执行者 · 重新入队与失败类别" — measure it (TaskDAG gives lanes 200px) |
| 91 | `…dden="true"></span>运行中<span class="why">2 位成员工作中</span></span>` | R6 | <span class="why">3 条工作线工作中</span> (from 'wlGoalBar()') |
| 243 | `<dt>负责</dt><dd>{{card.agent}}</dd>` | R8 |  |
| 277 | `… hint-placeholder-val="{{ false }}"><dt>成员</dt><dd>{{tl.ccard.mem}}</dd></sc-if>` | R11 |  |
| 332 | `<p>悬停或用键盘聚焦任意节点，旁边先出一张信息卡：状态和原因、归属、负责的成员、语义。</p>` | R11 | "…状态和原因、归属、负责的工作线、语义。" |
| 338 | `<p>每一行是一位成员（或一个阶段），时间从左到右；每次执行是一段，颜色是它的结果，细的一段是正式检查。同一任务的几次尝试和重新检查用细线连起来，停下的地方有一道短标记。</p>` | R11 | "每一行是一条工作线（或一个阶段），时间从左到右；…" (the rest as is) |
| 372 | `<dt>负责的 Agent</dt>` | R8 |  |
| 480 | `{ id: 'S2', name: '写入收口', owner: '执行者 · 状态机', sem: '让所有正式写入只经状态机，不留旁路。' },` | R1 |  |
| 481 | `{ id: 'S3', name: '失败与重新入队', owner: '执行者 · 状态机', sem: '失败分五类；能自动重新入队的自动排回，接续时带上原因。' },` | R1 |  |
| 482 | `{ id: 'S4', name: '检查与返工', owner: '执行者 · 状态机', sem: '让检查能按项重跑、记轮次，返工有上限也有记录。' },` | R1 |  |
| 483 | `{ id: 'S5', name: '服务拆分', owner: '执行者 · 服务重构', sem: '拆开路由和前端，用推送取代每秒轮询。' },` | R1 |  |
| 491 | `… 'S2', '消息写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '成员之间的消息只经状态机写入，不再直接改记录。', files: ['src/core/work-graph/communication/mailbox-…` | R1 |  |
| 492 | `…S2', '检查轮次写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '检查轮次和证据的写入都经状态机判定。', files: ['src/core/work-graph/evidence/evidence-service.t…` | R1 |  |
| 493 | `…S2', '查询任务写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '查询任务和它的每次执行只经状态机写入。', files: ['src/core/work-graph/queries/query-job-service.…` | R1 |  |
| 494 | `…S2', '执行事实读取迁移', 'satisfied', { agent: '执行者 · 状态机', att: 2, deps: ['T04'], sem: '把 Kernel 执行事实的读取搬到 Runtime，写入经状态机。', files: ['src/core/agent-runtime/…` | R1 |  |
| 496 | `…S2', '工作记录目录精简', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '工作记录目录只保留工作记录状态机做出的决定。', files: ['src/core/work-graph/sessions/session-direct…` | R1 |  |
| 497 | `…S2', '生命周期决定收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T09'], sem: '成员的开始、让出和结束只由工作记录状态机决定。', files: ['src/core/work-graph/sessions/session-lifec…` | R1 |  |
| 499 | `… 'S3', '平台中断识别', 'satisfied', { agent: '执行者 · 状态机', deps: ['T11'], sem: 'Host 重启或连接中断时记为“平台中断”，不算成员失败。', files: ['src/core/work-graph/state/task-failu…` | R1 |  |
| 500 | `…'S3', '重新入队与失败类别', 'running', { agent: '执行者 · 状态机', att: 2, why: '第 2 次尝试 · 接续，上次检查未通过', deps: ['T12', 'T05'], sem: '失败后按五种类别决定能否自动重新入队，并记下“系统自动重新入队（n…` | R1 |  |
| 502 | `…', 'S3', '接续说明', 'verifying', { agent: '执行者 · 状态机', why: '正式检查第 1 轮进行中，9/14 项已完成', deps: ['T08', 'T12'], sem: '新的一次执行开头带上上次停在哪里、为什么停，只用已保存的事实组装。', fil…` | R1 |  |
| 503 | `…T15', 'S3', '启动核对', 'failed', { agent: '执行者 · 状态机', why: '执行失败，系统自动重新入队（1/3），等待推进', deps: ['T12', 'T13'], sem: 'Host 启动时核对上次没结束的执行；结果未知的交给你决定。', files…` | R1 |  |
| 507 | `…', 'S4', '证据链接', 'satisfied', { agent: '执行者 · 状态机', deps: ['T06'], sem: '每轮检查的报告、退出码和日志都挂到对应任务。', files: ['src/core/work-graph/evidence/coverage.ts'] …` | R1 |  |
| 508 | `… 'S4', '检查链与重新检查', 'blocked', { agent: '执行者 · 状态机', att: 2, why: '检查不完整，第 2 轮的类型检查被 Host 重启打断', deps: ['T19', 'T06'], sem: '让检查链支持重新检查：重跑哪些项、记第几轮、什么时候…` | R1 |  |
| 509 | `…', 'S4', '检查不完整判定', 'decide', { agent: '执行者 · 状态机', att: 4, why: '自动返工已达上限（3/3）', deps: ['T19'], sem: '检查进程被打断或报告缺项时判为“检查不完整”，不判为“检查未通过”。', files: ['s…` | R1 |  |
| 515 | `…core-routes 拆分', 'satisfied', { agent: '执行者 · 服务重构', deps: ['T04'], sem: '把 core-routes 按目标、任务、成员、文件拆成四组路由。', files: ['src/app/core-routes.ts'] }),` | R1 |  |
| 516 | `…', 'S5', '前端拆分', 'satisfied', { agent: '执行者 · 服务重构', att: 2, deps: ['T26'], sem: '前端拆成 api、state、components、views 四层。', files: ['src/ui/main.ts', 'src…` | R1 |  |
| 518 | `…', 'S5', 'SSE 推送', 'running', { agent: '执行者 · 服务重构', why: '第 1 次尝试，已改 3 个文件', deps: ['T26', 'T27'], sem: '用 SSE 把状态变化推给工作台，取代每秒轮询。', files: ['src/app/…` | R1 |  |
| 538 | `const owners = ['审阅者 · 规格', '执行者 · 状态机', '执行者 · 状态机', '执行者 · 状态机', '执行者 · 服务重构', '执行者 · 服务重构', '架构参谋', '执行者 · 状态机', '执行者 · 服务重构', '未分配'];` | R3 |  |
| 956 | `memberWords() { return { '执行者 · 状态机': '工作中', '执行者 · 服务重构': '工作中', '审阅者 · 规格': '待命', '架构参谋': '等回复', '秘书': '待命' }; }` | R4 | remove 'memberWords()'; callers use the read API (R4) |
| 957 | `agentText(a) { const M = this.memberWords(); return a && a !== '未分配' ? a + (M[a] ? ' · ' + M[a] : '') : '未分配'; }` | R4 |  |
| 958 | `goalAgent() { return '秘书 · 待命，另有 2 位成员工作中'; }` | R4 |  |
| 962 | `/* hover info card (name · state + reason · 归属 · 负责 · 语义) */` | R8 |  |
| 967 | `…: n.why ? '：' + n.why : '', agent: this.taskAgent(n) });` | R4 |  |
| 968 | `… ' · ' + this.cardCount(n), agent: this.goalAgent() });` | R4 |  |
| 969 | `…), tx: 'tx-plain', why: '', agent: this.agentText(n.owner) });` | R4 |  |
| 1028 | `/* ------------------------------------------------------------ detail (路径/归属 · 负责的 Agent · 语义 · 关系; 返工 inside 关系` | R8 |  |
| 1046 | `crumbs: crumbs, agent: this.taskAgent(n), sem: n.sem, rel: rel, group: false, canHandle: ['decide', 'failed', 'blocked'].indexOf(n.st) >= 0 };` | R4 |  |
| 1061 | `crumbs: crumbs, agent: isRoot ? this.goalAgent() : this.agentText(n.owner), sem: n.sem, rel: rel, group: true, canHandle: false };` | R4 |  |
| 1588 | `…ks, stages: T.stages, memberWords: this.memberWords(),` | R4 |  |
| 1646 | `…nst unit = by === 'stage' ? ' 个阶段' : ' 位成员';` | R6 | ' 条工作线' (lanes are work lines, R11) |

#### TaskDAG (49)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 233 | `<dt>负责</dt><dd>{{ol.card.agent}}</dd>` | R8 |  |
| 292 | `… hint-placeholder-val="{{ false }}"><dt>成员</dt><dd>{{wl.ccard.mem}}</dd></sc-if>` | R11 |  |
| 307 | `<span class="wide">每一行是一条工作线：一个工作记录，加上中断后接着它的工作记录；不是角色，也不是人。执行者的工作线按任务开，同一行里先后的几条互不重叠，所以行数等于最多同时有几条</span>` | R10 | keep (执行者 as the role, or the new model already) |
| 409 | `…时间读取任务状态的接口（编排后端）。草案：执行者按任务开工作线；其他画板仍是旧的两位执行者。</p>` | R9 |  |
| 472 | `<dt>负责的 Agent</dt>` | R8 |  |
| 586 | `{ id: 'S2', name: '写入收口', owner: '执行者 · 状态机', sem: '让所有正式写入只经状态机，不留旁路。' },` | R1 |  |
| 587 | `{ id: 'S3', name: '失败与重新入队', owner: '执行者 · 状态机', sem: '失败分五类；能自动重新入队的自动排回，接续时带上原因。' },` | R1 |  |
| 588 | `{ id: 'S4', name: '检查与返工', owner: '执行者 · 状态机', sem: '让检查能按项重跑、记轮次，返工有上限也有记录。' },` | R1 |  |
| 589 | `{ id: 'S5', name: '服务拆分', owner: '执行者 · 服务重构', sem: '拆开路由和前端，用推送取代每秒轮询。' },` | R1 |  |
| 597 | `… 'S2', '消息写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '成员之间的消息只经状态机写入，不再直接改记录。', files: ['src/core/work-graph/communication/mailbox-…` | R1 |  |
| 598 | `…S2', '检查轮次写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '检查轮次和证据的写入都经状态机判定。', files: ['src/core/work-graph/evidence/evidence-service.t…` | R1 |  |
| 599 | `…S2', '查询任务写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '查询任务和它的每次执行只经状态机写入。', files: ['src/core/work-graph/queries/query-job-service.…` | R1 |  |
| 600 | `…S2', '执行事实读取迁移', 'satisfied', { agent: '执行者 · 状态机', att: 2, deps: ['T04'], sem: '把 Kernel 执行事实的读取搬到 Runtime，写入经状态机。', files: ['src/core/agent-runtime/…` | R1 |  |
| 602 | `…S2', '工作记录目录精简', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '工作记录目录只保留工作记录状态机做出的决定。', files: ['src/core/work-graph/sessions/session-direct…` | R1 |  |
| 603 | `…S2', '生命周期决定收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T09'], sem: '成员的开始、让出和结束只由工作记录状态机决定。', files: ['src/core/work-graph/sessions/session-lifec…` | R1 |  |
| 605 | `… 'S3', '平台中断识别', 'satisfied', { agent: '执行者 · 状态机', deps: ['T11'], sem: 'Host 重启或连接中断时记为“平台中断”，不算成员失败。', files: ['src/core/work-graph/state/task-failu…` | R1 |  |
| 606 | `…'S3', '重新入队与失败类别', 'running', { agent: '执行者 · 状态机', att: 2, why: '第 2 次尝试 · 接续，上次检查未通过', deps: ['T12', 'T05'], sem: '失败后按五种类别决定能否自动重新入队，并记下“系统自动重新入队（n…` | R1 |  |
| 608 | `…', 'S3', '接续说明', 'verifying', { agent: '执行者 · 状态机', why: '正式检查第 1 轮进行中，9/14 项已完成', deps: ['T08', 'T12'], sem: '新的一次执行开头带上上次停在哪里、为什么停，只用已保存的事实组装。', fil…` | R1 |  |
| 609 | `…T15', 'S3', '启动核对', 'failed', { agent: '执行者 · 状态机', why: '执行失败，系统自动重新入队（1/3），等待推进', deps: ['T12', 'T13'], sem: 'Host 启动时核对上次没结束的执行；结果未知的交给你决定。', files…` | R1 |  |
| 613 | `…', 'S4', '证据链接', 'satisfied', { agent: '执行者 · 状态机', deps: ['T06'], sem: '每轮检查的报告、退出码和日志都挂到对应任务。', files: ['src/core/work-graph/evidence/coverage.ts'] …` | R1 |  |
| 614 | `… 'S4', '检查链与重新检查', 'blocked', { agent: '执行者 · 状态机', att: 2, why: '检查不完整，第 2 轮的类型检查被 Host 重启打断', deps: ['T19', 'T06'], sem: '让检查链支持重新检查：重跑哪些项、记第几轮、什么时候…` | R1 |  |
| 615 | `…', 'S4', '检查不完整判定', 'decide', { agent: '执行者 · 状态机', att: 4, why: '自动返工已达上限（3/3）', deps: ['T19'], sem: '检查进程被打断或报告缺项时判为“检查不完整”，不判为“检查未通过”。', files: ['s…` | R1 |  |
| 621 | `…core-routes 拆分', 'satisfied', { agent: '执行者 · 服务重构', deps: ['T04'], sem: '把 core-routes 按目标、任务、成员、文件拆成四组路由。', files: ['src/app/core-routes.ts'] }),` | R1 |  |
| 622 | `…', 'S5', '前端拆分', 'satisfied', { agent: '执行者 · 服务重构', att: 2, deps: ['T26'], sem: '前端拆成 api、state、components、views 四层。', files: ['src/ui/main.ts', 'src…` | R1 |  |
| 624 | `…', 'S5', 'SSE 推送', 'running', { agent: '执行者 · 服务重构', why: '第 1 次尝试，已改 3 个文件', deps: ['T26', 'T27'], sem: '用 SSE 把状态变化推给工作台，取代每秒轮询。', files: ['src/app/…` | R1 |  |
| 644 | `const owners = ['审阅者 · 规格', '执行者 · 状态机', '执行者 · 状态机', '执行者 · 状态机', '执行者 · 服务重构', '执行者 · 服务重构', '架构参谋', '执行者 · 状态机', '执行者 · 服务重构', '未分配'];` | R3 |  |
| 1062 | `memberWords() { return { '执行者 · 状态机': '工作中', '执行者 · 服务重构': '工作中', '审阅者 · 规格': '待命', '架构参谋': '等回复', '秘书': '待命' }; }` | R4 | remove 'memberWords()'; callers use the read API (R4) |
| 1063 | `agentText(a) { const M = this.memberWords(); return a && a !== '未分配' ? a + (M[a] ? ' · ' + M[a] : '') : '未分配'; }` | R4 |  |
| 1064 | `goalAgent() { return '秘书 · 待命，另有 2 位成员工作中'; }` | R4 |  |
| 1068 | `/* hover info card (name · state + reason · 归属 · 负责 · 语义) */` | R8 |  |
| 1073 | `…: n.why ? '：' + n.why : '', agent: this.taskAgent(n) });` | R4 |  |
| 1074 | `… ' · ' + this.cardCount(n), agent: this.goalAgent() });` | R4 |  |
| 1075 | `…), tx: 'tx-plain', why: '', agent: this.agentText(n.owner) });` | R4 |  |
| 1134 | `/* ------------------------------------------------------------ detail (路径/归属 · 负责的 Agent · 语义 · 关系; 返工 inside 关系` | R8 |  |
| 1152 | `crumbs: crumbs, agent: this.taskAgent(n), sem: n.sem, rel: rel, group: false, canHandle: ['decide', 'failed', 'blocked'].indexOf(n.st) >= 0 };` | R4 |  |
| 1167 | `crumbs: crumbs, agent: isRoot ? this.goalAgent() : this.agentText(n.owner), sem: n.sem, rel: rel, group: true, canHandle: false };` | R4 |  |
| 2309 | `/* the hover card of a DAG node at the cursor's time (the approved card: name, state + reason, 归属, 负责, 语义, hint).` | R8 |  |
| 2528 | `This draft opens one 执行者 line per task (a Session per task); 秘书, 架构参谋 and 审阅者 · 规格 keep one line each.` | R10 | keep (执行者 as the role, or the new model already) |
| 2542 | `else { const task = r.task \|\| execAt(r.m, r.s0); if (!task) return; L = get('L:' + task, 'executor', '执行者 · ' + (std[task] ? std[task].name : task), t…` | R10 | keep (执行者 as the role, or the new model already) |
| 2575 | `/* 负责 on this draft (hover card, detail, outline card): the task's own work line at t — the line whose run or check of` | R8 |  |
| 2576 | `this task started last by t (one 执行者 line per task; a long-lived role's line when that role ran it) — with what it` | R10 | keep (执行者 as the role, or the new model already) |
| 2578 | `…", or the owner role's line). TaskMap's taskAgent()` | R4 |  |
| 2587 | `else if (this.isBig() && !R.any[n.id] && n.agent) name = n.agent.indexOf('执行者') === 0 ? '执行者 · ' + n.name : n.agent;` | R10 | keep (执行者 as the role, or the new model already) |
| 2594 | `/* 负责 of a stage, a batch or the goal: how many work lines worked on its tasks by t, and how many are doing so at t */` | R8 |  |
| 2605 | `const k = t.agent.indexOf('执行者') === 0 ? 'syn:' + id : 'role:' + t.agent;` | R10 | keep (执行者 as the role, or the new model already) |
| 2659 | `groups = [['secretary', '秘书'], ['advisor', '参谋'], ['scribe', '书记'], ['reviewer', '审阅者'], ['executor', '执行者']]` | R10 | keep (执行者 as the role, or the new model already) |
| 2944 | `…ks, stages: T.stages, memberWords: this.memberWords(),` | R4 |  |
| 3120 | `/* 负责 = the work lines (this draft's model, at now: the outline shows today's states) */` | R8 |  |
| 3174 | `(this draft's model, not 2 位成员) */` | K |  |

#### Plan (36)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 57 | `<nav class="rail" aria-label="项目、目标与成员">` | R7 |  |
| 115 | `<div class="rail-label"><span>成员</span></div>` | R7 |  |
| 125 | `<span class="live"><span class="dot s-running" aria-hidden="true"></span>{{m.live}}</span>` | R7 |  |
| 128 | `<dt>负责</dt><dd>{{m.duty}}</dd>` | R8 |  |
| 775 | `<dt>负责</dt><dd>{{card.agent}}</dd>` | R8 |  |
| 843 | `<dt>负责的 Agent</dt>` | R8 |  |
| 1109 | `const crew = '审阅者 · 规格先做规格；执行者 · 服务重构做完目标 1 的 SSE 推送后接手';` | R10 | '审阅者 · 规格先做规格；之后每个任务开一条执行者工作线' |
| 1115 | `{ id: 'A2', name: '任务图与架构图', owner: '执行者 · 服务重构', sem: '格子加连线的树，悬停有信息卡，点一下点亮路径。' },` | R1 |  |
| 1116 | `{ id: 'A3', name: '工作台布局', owner: '执行者 · 服务重构', sem: '左栏目标与成员，中间对话，右边两张图。' },` | R1 |  |
| 1141 | `{ id: 'B2', name: '新界面骨架', owner: '执行者 · 服务重构', sem: '新目录、入口、三栏外壳和读取层。' },` | R1 |  |
| 1142 | `{ id: 'B3', name: '三栏内容', owner: '执行者 · 服务重构', sem: '左栏、对话与决定卡、任务图和架构图。' },` | R1 |  |
| 1161 | `… 小时', reqs: [], members: '审阅者 · 规格写状态词表；执行者 · 服务重构做完目标 1 的 SSE 推送后接手',` | R10 | '审阅者 · 规格写状态词表；之后每个任务开一条执行者工作线' |
| 1165 | `{ id: 'C2', name: '任务图与架构图', owner: '执行者 · 服务重构', sem: '格子加连线的树，悬停有信息卡，点一下点亮路径。' },` | R1 |  |
| 1411 | `…n ? (s.paused ? '已暂停' : '工作中') : '待命', '执行者 · 服务重构': '工作中', '执行者 · 状态机': '工作中', '架构参谋': '等回复', '秘书': '待命' }[a] \|\| '';` | R10 | remove; callers use the read API at 'plan' (R4) |
| 1413 | `agentText(a) { const w = this.memberWord(a); return a && a !== '未分配' ? a + (w ? ' · ' + w : '') : '未分配'; }` | R4 |  |
| 1414 | `taskAgent(n) {` | R4 |  |
| 1416 | `if (n.agent) return this.agentText(n.agent) + '，第 1 次尝试';` | R4 |  |
| 1420 | `stageAgent(n) {` | R4 |  |
| 1422 | `…derive(this.state \|\| {}).adopted ? this.agentText(n.owner) : n.owner + '，采用后负责';` | R4 |  |
| 1424 | `rootAgent() {` | R4 |  |
| 1428 | `return '秘书 · 待命，另有 1 位成员' + (s.paused ? '已暂停' : '工作中');` | R5 |  |
| 1435 | `/* hover info card of the task map: name · state + reason · 归属 · 负责 · 语义 */` | R8 |  |
| 1441 | `…arent].name, hasPath: true, agent: this.taskAgent(n) });` | R4 |  |
| 1444 | `…e.root.name, hasPath: true, agent: this.stageAgent(n) });` | R4 |  |
| 1447 | `…, path: '', hasPath: false, agent: this.rootAgent() });` | R4 |  |
| 1840 | `…kind === 'system' ? '架构参谋 · 等回复' : this.agentText(mod ? mod.owner : '未分配');` | R4 |  |
| 1877 | `…kind === 'system' ? '架构参谋 · 等回复' : this.agentText(mod ? mod.owner : '未分配'), sem: this.archSemOf(tree, n, taskTree), rel: rel, kind: 'arch', id: id };` | R4 |  |
| 2084 | `if (/谁\|成员\|负责\|人手\|执行者\|审阅/.test(text)) {` | R10 | keep (执行者 as the role, or the new model already) |
| 2106 | `…s + ' 个任务，' + (n.kind === 'goal' ? this.rootAgent() : this.stageAgent(n)) + '。' + (n.sem \|\| '');` | R4 |  |
| 2906 | `: stepWait ? '第一个任务等你确认开始' : '1 位成员工作中',` | R6 | goal 2 after 采用: '1 条工作线工作中' (审阅者 · 规格's line on goal 2's first task; Plan's own clock) |
| 2934 | `{ id: 'm2', name: '执行者 · 状态机', st: 'idle', duty: 'WorkGraph 的 state、tasks', doing: '没有进行中的工作', last: '重新入队与失败类别：第 2 轮检查通过，14:22', live: '' },` | R7 |  |
| 2935 | `{ id: 'm3', name: '执行者 · 服务重构', st: 'running', duty: 'src/app、src/ui', doing: '目标 1：SSE 推送，第 1 次尝试', last: '编辑 src/app/server.ts +38 −4，1 分钟前', live: …` | R7 |  |
| 2938 | `…stT ? '领取 ' + firstT.name + '，刚才' : '回复 执行者 · 状态机：检查不完整的计数，13:47', live: working ? '正在读取工作台原型' : '' },` | R10 | '回复 执行者 · 重新入队与失败类别：检查不完整的计数，13:47' |
| 2939 | `…'waiting', duty: '模块边界、架构目录', doing: '等 执行者 · 服务重构 回复：core-routes 拆分后的边界', last: '发出咨询，已送达，14:09', live: '' }` | R7 |  |
| 2944 | `return { name: m.name, word: word, dot: 'dot ' + (m.st === 'running' ? 's-running' : m.st === 'waiting' ? 's-waiting' : 's-idle'),` | R7 |  |
| 2998 | `crumbs: crumbs, agent: isTask ? this.taskAgent(n) : isRoot ? this.rootAgent() : this.stageAgent(n), sem: n.sem, rel: relRows,` | R4 |  |

#### Goals (43)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 377 | `<dt>负责</dt><dd>{{card.agent}}</dd>` | R8 |  |
| 443 | `<dt>负责的 Agent</dt>` | R8 |  |
| 627 | `{ id: 'S2', name: '写入收口', owner: '执行者 · 状态机', sem: '让所有正式写入只经状态机，不留旁路。' },` | R1 |  |
| 628 | `{ id: 'S3', name: '失败与重新入队', owner: '执行者 · 状态机', sem: '失败分五类；能自动重新入队的自动排回，接续时带上原因。' },` | R1 |  |
| 629 | `{ id: 'S4', name: '检查与返工', owner: '执行者 · 状态机', sem: '让检查能按项重跑、记轮次，返工有上限也有记录。' },` | R1 |  |
| 630 | `{ id: 'S5', name: '服务拆分', owner: '执行者 · 服务重构', sem: '拆开路由和前端，用推送取代每秒轮询。' },` | R1 |  |
| 638 | `… 'S2', '消息写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '成员之间的消息只经状态机写入，不再直接改记录。', files: ['src/core/work-graph/communication/mailbox-…` | R1 |  |
| 639 | `…S2', '检查轮次写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '检查轮次和证据的写入都经状态机判定。', files: ['src/core/work-graph/evidence/evidence-service.t…` | R1 |  |
| 640 | `…S2', '查询任务写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '查询任务和它的每次执行只经状态机写入。', files: ['src/core/work-graph/queries/query-job-service.…` | R1 |  |
| 641 | `…S2', '执行事实读取迁移', 'satisfied', { agent: '执行者 · 状态机', att: 2, deps: ['T04'], sem: '把 Kernel 执行事实的读取搬到 Runtime，写入经状态机。', files: ['src/core/agent-runtime/…` | R1 |  |
| 643 | `…S2', '工作记录目录精简', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '工作记录目录只保留工作记录状态机做出的决定。', files: ['src/core/work-graph/sessions/session-direct…` | R1 |  |
| 644 | `…S2', '生命周期决定收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T09'], sem: '成员的开始、让出和结束只由工作记录状态机决定。', files: ['src/core/work-graph/sessions/session-lifec…` | R1 |  |
| 646 | `… 'S3', '平台中断识别', 'satisfied', { agent: '执行者 · 状态机', deps: ['T11'], sem: 'Host 重启或连接中断时记为“平台中断”，不算成员失败。', files: ['src/core/work-graph/state/task-failu…` | R1 |  |
| 647 | `…'S3', '重新入队与失败类别', 'running', { agent: '执行者 · 状态机', att: 2, why: '第 2 次尝试 · 接续，上次检查未通过', deps: ['T12', 'T05'], sem: '失败后按五种类别决定能否自动重新入队，并记下“系统自动重新入队（n…` | R1 |  |
| 649 | `…', 'S3', '接续说明', 'verifying', { agent: '执行者 · 状态机', why: '正式检查第 1 轮进行中，9/14 项已完成', deps: ['T08', 'T12'], sem: '新的一次执行开头带上上次停在哪里、为什么停，只用已保存的事实组装。', fil…` | R1 |  |
| 650 | `…T15', 'S3', '启动核对', 'failed', { agent: '执行者 · 状态机', why: '执行失败，系统自动重新入队（1/3），等待推进', deps: ['T12', 'T13'], sem: 'Host 启动时核对上次没结束的执行；结果未知的交给你决定。', files…` | R1 |  |
| 654 | `…', 'S4', '证据链接', 'satisfied', { agent: '执行者 · 状态机', deps: ['T06'], sem: '每轮检查的报告、退出码和日志都挂到对应任务。', files: ['src/core/work-graph/evidence/coverage.ts'] …` | R1 |  |
| 655 | `… 'S4', '检查链与重新检查', 'blocked', { agent: '执行者 · 状态机', att: 2, why: '检查不完整，第 2 轮的类型检查被 Host 重启打断', deps: ['T19', 'T06'], sem: '让检查链支持重新检查：重跑哪些项、记第几轮、什么时候…` | R1 |  |
| 656 | `…', 'S4', '检查不完整判定', 'decide', { agent: '执行者 · 状态机', att: 4, why: '自动返工已达上限（3/3）', deps: ['T19'], sem: '检查进程被打断或报告缺项时判为“检查不完整”，不判为“检查未通过”。', files: ['s…` | R1 |  |
| 662 | `…core-routes 拆分', 'satisfied', { agent: '执行者 · 服务重构', deps: ['T04'], sem: '把 core-routes 按目标、任务、成员、文件拆成四组路由。', files: ['src/app/core-routes.ts'] }),` | R1 |  |
| 663 | `…', 'S5', '前端拆分', 'satisfied', { agent: '执行者 · 服务重构', att: 2, deps: ['T26'], sem: '前端拆成 api、state、components、views 四层。', files: ['src/ui/main.ts', 'src…` | R1 |  |
| 665 | `…', 'S5', 'SSE 推送', 'running', { agent: '执行者 · 服务重构', why: '第 1 次尝试，已改 3 个文件', deps: ['T26', 'T27'], sem: '用 SSE 把状态变化推给工作台，取代每秒轮询。', files: ['src/app/…` | R1 |  |
| 1229 | `agentText(a) { const M = this.memberWords(); return a && a !== '未分配' ? a + (M[a] ? ' · ' + M[a] : '') : '未分配'; }` | R4 |  |
| 1231 | `memberWords() { return { '执行者 · 状态机': '工作中', '执行者 · 服务重构': '工作中', '审阅者 · 规格': '待命', '架构参谋': '等回复', '秘书': '待命' }; }` | R4 | remove 'memberWords()'; callers use the read API (R4) |
| 1375 | `/* hover info card: name · state + reason · 归属 · 负责 · 语义 · for a file the tasks of each goal that change it` | R8 |  |
| 1379 | `…kind === 'system' ? '架构参谋 · 等回复' : this.agentText(mod ? mod.owner : '未分配');` | R4 |  |
| 1397 | `/* click detail: 路径/归属 · 负责的 Agent · 语义 · 关系 (each goal's tasks, 依赖, 路径) */` | R8 |  |
| 1450 | `…llel') return head + '两个目标都会改它；同一时间只交给一个成员，先后由我安排，每次合并后重跑检查。';` | R13 |  |
| 1467 | `…' + nm('g3') + '随之推后；并行的话，这两个文件同一时间只交给一个成员改。';` | R13 |  |
| 1473 | `…：两个目标并行，没有任务因此推后。' + files + ' 同一时间只交给一个成员改，先后由我安排；每次合并后重跑检查，没通过的会进“需要你决定”。';` | R13 |  |
| 1544 | `goalAgentText(g) { return g === 'g1' ? '秘书 · 待命，另有 2 位成员工作中' : g === 'g2' ? '秘书 · 规划中' : '未分配'; }` | R4 |  |
| 1554 | `/* hover card: name · state + reason · 归属 · 负责 · 语义 · for a task the overlapping files it changes (冲突) */` | R8 |  |
| 1560 | `…t, why: this.taskWhy(n, c), agent: this.taskAgentText(n), tasks: ov, hasTasks: ov.length > 0 });` | R4 |  |
| 1564 | `… ' + this.taskCardCount(n), agent: this.goalAgentText(n.goal) });` | R4 |  |
| 1566 | `…), tx: 'tx-plain', why: '', agent: this.agentText(n.owner) });` | R4 |  |
| 1567 | `…), tx: 'tx-plain', why: '', agent: this.agentText('秘书') });` | R4 |  |
| 1569 | `/* click detail: 路径/归属 · 负责的 Agent · 语义 · 关系 (冲突 = the overlapping files and the other goal's tasks on them;` | R8 |  |
| 1611 | `…turn both + '两个目标并行，它照常推进；同一个文件同一时间只交给一个成员改，先后由我安排。';` | R13 |  |
| 2124 | `… '运行中 · 与目标 ' + num.g2 + ' 冲突' : '运行中 · 2 位成员工作中')` | R6 | '运行中 · ' + this.wlGoalBar('main') = '运行中 · 3 条工作线工作中' |
| 2127 | `: '运行中 · 2 位成员工作中',` | R6 | '运行中 · ' + this.wlGoalBar('main') = '运行中 · 3 条工作线工作中' |
| 2140 | `['成员', '执行者 · 状态机、执行者 · 服务重构 工作中；架构参谋 等回复'],` | R10 | ['工作线', '工作中 3 · 待命 8 · 已归档 8；架构参谋 等回复'] |
| 2142 | `…度', this.progress('g2') + '：方案还没采用'], ['成员', '秘书在起草方案；采用后再分配成员'],` | R13 |  |
| 2174 | `…同一个文件可能要合并两次改动，检查没通过的风险更高。这两个文件同一时间只交给一个成员改，先后由秘书安排。';` | R13 |  |

#### Decide (52)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 51 | `<nav class="rail" aria-label="项目、目标与成员">` | R7 |  |
| 83 | `<div class="rail-label"><span>成员</span></div>` | R7 |  |
| 93 | `<span class="live"><span class="dot s-running" aria-hidden="true"></span>{{m.live}}</span>` | R7 |  |
| 96 | `<dt>负责</dt><dd>{{m.duty}}</dd>` | R8 |  |
| 517 | `<dt>负责</dt><dd>{{card.agent}}</dd>` | R8 |  |
| 701 | `<dt>负责的 Agent</dt>` | R8 |  |
| 813 | `{ id: 'S2', name: '写入收口', owner: '执行者 · 状态机', sem: '让所有正式写入只经状态机，不留旁路。' },` | R1 |  |
| 814 | `{ id: 'S3', name: '失败与重新入队', owner: '执行者 · 状态机', sem: '失败分五类；能自动重新入队的自动排回，接续时带上原因。' },` | R1 |  |
| 815 | `{ id: 'S4', name: '检查与返工', owner: '执行者 · 状态机', sem: '让检查能按项重跑、记轮次，返工有上限也有记录。' },` | R1 |  |
| 816 | `{ id: 'S5', name: '服务拆分', owner: '执行者 · 服务重构', sem: '拆开路由和前端，用推送取代每秒轮询。' },` | R1 |  |
| 824 | `… 'S2', '消息写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '成员之间的消息只经状态机写入，不再直接改记录。', files: ['src/core/work-graph/communication/mailbox-…` | R1 |  |
| 825 | `…S2', '检查轮次写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '检查轮次和证据的写入都经状态机判定。', files: ['src/core/work-graph/evidence/evidence-service.t…` | R1 |  |
| 826 | `…S2', '查询任务写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '查询任务和它的每次执行只经状态机写入。', files: ['src/core/work-graph/queries/query-job-service.…` | R1 |  |
| 827 | `…S2', '执行事实读取迁移', 'satisfied', { agent: '执行者 · 状态机', att: 2, deps: ['T04'], sem: '把 Kernel 执行事实的读取搬到 Runtime，写入经状态机。', files: ['src/core/agent-runtime/…` | R1 |  |
| 829 | `…S2', '工作记录目录精简', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '工作记录目录只保留工作记录状态机做出的决定。', files: ['src/core/work-graph/sessions/session-direct…` | R1 |  |
| 830 | `…S2', '生命周期决定收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T09'], sem: '成员的开始、让出和结束只由工作记录状态机决定。', files: ['src/core/work-graph/sessions/session-lifec…` | R1 |  |
| 832 | `… 'S3', '平台中断识别', 'satisfied', { agent: '执行者 · 状态机', deps: ['T11'], sem: 'Host 重启或连接中断时记为“平台中断”，不算成员失败。', files: ['src/core/work-graph/state/task-failu…` | R1 |  |
| 833 | `…'S3', '重新入队与失败类别', 'running', { agent: '执行者 · 状态机', att: 2, why: '第 2 次尝试 · 接续，上次检查未通过', deps: ['T12', 'T05'], sem: '失败后按五种类别决定能否自动重新入队，并记下“系统自动重新入队（n…` | R1 |  |
| 835 | `…', 'S3', '接续说明', 'verifying', { agent: '执行者 · 状态机', why: '正式检查第 1 轮进行中，9/14 项已完成', deps: ['T08', 'T12'], sem: '新的一次执行开头带上上次停在哪里、为什么停，只用已保存的事实组装。', fil…` | R1 |  |
| 836 | `…T15', 'S3', '启动核对', 'failed', { agent: '执行者 · 状态机', why: '执行失败，系统自动重新入队（1/3），等待推进', deps: ['T12', 'T13'], sem: 'Host 启动时核对上次没结束的执行；结果未知的交给你决定。', files…` | R1 |  |
| 840 | `…', 'S4', '证据链接', 'satisfied', { agent: '执行者 · 状态机', deps: ['T06'], sem: '每轮检查的报告、退出码和日志都挂到对应任务。', files: ['src/core/work-graph/evidence/coverage.ts'] …` | R1 |  |
| 841 | `… 'S4', '检查链与重新检查', 'blocked', { agent: '执行者 · 状态机', att: 2, why: '检查不完整，第 2 轮的类型检查被 Host 重启打断', deps: ['T19', 'T06'], sem: '让检查链支持重新检查：重跑哪些项、记第几轮、什么时候…` | R1 |  |
| 842 | `…', 'S4', '检查不完整判定', 'decide', { agent: '执行者 · 状态机', att: 4, why: '自动返工已达上限（3/3）', deps: ['T19'], sem: '检查进程被打断或报告缺项时判为“检查不完整”，不判为“检查未通过”。', files: ['s…` | R1 |  |
| 848 | `…core-routes 拆分', 'satisfied', { agent: '执行者 · 服务重构', deps: ['T04'], sem: '把 core-routes 按目标、任务、成员、文件拆成四组路由。', files: ['src/app/core-routes.ts'] }),` | R1 |  |
| 849 | `…', 'S5', '前端拆分', 'satisfied', { agent: '执行者 · 服务重构', att: 2, deps: ['T26'], sem: '前端拆成 api、state、components、views 四层。', files: ['src/ui/main.ts', 'src…` | R1 |  |
| 851 | `…', 'S5', 'SSE 推送', 'running', { agent: '执行者 · 服务重构', why: '第 1 次尝试，已改 3 个文件', deps: ['T26', 'T27'], sem: '用 SSE 把状态变化推给工作台，取代每秒轮询。', files: ['src/app/…` | R1 |  |
| 1250 | `exactly as on Main. Past, all today: 执行者 · 服务重构 ran 目标列表接口 until its budget ran out (13:40),` | R10 | comment: 执行者 · 目标列表接口 ran until its budget ran out (13:40) and deferred 任务格子摘要 (13:31); 执行者 · 目标展示读取路由 ran until you paused it (13:58); 执行者 · SSE 推送 took the run after the restart (14:02) |
| 1256 | `T16: { st: 'decide', agent: '执行者 · 状态机', why: '没有新依据，自动返工已停止',` | R1 |  |
| 1258 | `T29: { st: 'waiting', agent: '执行者 · 服务重构', why: '你在 13:58 暂停，Host 14:02 重启后这次执行已结束，需你点继续' },` | R1 |  |
| 1259 | `T30: { st: 'decide', agent: '执行者 · 服务重构', why: '预算耗尽，需要更大预算（200K 已用完）' },` | R1 |  |
| 1260 | `…: { st: 'deferred', why: '工作台界面改版会重画任务图（执行者 · 服务重构，13:31）' }` | R10 | '工作台界面改版会重画任务图（执行者 · 目标列表接口，13:31）' |
| 1417 | `…分钟。继续会开一次新的执行，带上停在哪里、为什么停，不会从头做，也不算自动返工。执行者 · 服务重构 正在做 SSE 推送，新的执行会等成员空出来再领取。' },` | R10 | ask ends: '…不会从头做，也不算自动返工。新的执行接在 执行者 · 目标展示读取路由 这条工作线上（工作记录第 2 段）。' (executors open a line per task and run side by side: nothing waits for a member) |
| 1431 | `…[['失败类别', '执行失败（预算耗尽）'], ['谁做的', 'Agent（执行者 · 服务重构）'], ['尝试', '第 1 次尝试'], ['最近拒绝', '13:41 自动重新入队被拒绝：预算和上次一样']],` | R10 | ['谁做的', 'Agent（执行者 · 目标列表接口）'] |
| 1455 | `label: '必需任务已延后', title: '执行者 · 服务重构 延后了必需任务“任务格子摘要”',` | R10 | title: '执行者 · 目标列表接口 延后了必需任务“任务格子摘要”' |
| 1457 | `…面改版会重画任务图，摘要要带的字段可能要变'], ['谁做的', 'Agent（执行者 · 服务重构，13:31）'], ['类别', '计划变更，不是失败']],` | R10 | ['谁做的', 'Agent（执行者 · 目标列表接口，13:31）'] |
| 1544 | `memberWords() { return { '执行者 · 状态机': '工作中', '执行者 · 服务重构': '工作中', '审阅者 · 规格': '待命', '架构参谋': '等回复', '秘书': '待命' }; }` | R4 | remove 'memberWords()'; callers use the read API (R4) |
| 1545 | `agentText(a) { const M = this.memberWords(); return a && a !== '未分配' ? a + (M[a] ? ' · ' + M[a] : '') : '未分配'; }` | R4 |  |
| 1546 | `goalAgent(goal) {` | R4 |  |
| 1548 | `return '秘书 · 待命，另有 2 位成员工作中';` | R5 |  |
| 1889 | `… this.cardCount(n, 'task'), agent: this.goalAgent(goal) });` | R4 |  |
| 1891 | `…), tx: 'tx-plain', why: '', agent: this.agentText(n.owner) });` | R4 |  |
| 1896 | `…kind === 'system' ? '架构参谋 · 等回复' : this.agentText(mod ? mod.owner : '未分配');` | R4 |  |
| 2012 | `/* ------------------------------------------------------------ detail (路径/归属 · 负责的 Agent · 语义 · 关系) */` | R8 |  |
| 2043 | `crumbs: crumbs, agent: isRoot ? this.goalAgent(goal) : this.agentText(n.owner), sem: n.sem, rel: rel, group: true };` | R4 |  |
| 2081 | `…kind === 'system' ? '架构参谋 · 等回复' : this.agentText(mod ? mod.owner : '未分配'), sem: sem, rel: rel, group: isGroup };` | R4 |  |
| 2625 | `const MW = this.memberWords();` | R4 |  |
| 2629 | `{ id: 'm2', name: '执行者 · 状态机', duty: 'WorkGraph 的 state、tasks', doing: '重新入队与失败类别，第 2 次尝试 · 接续', last: '运行命令：状态机单元测试，12 秒前', live: '正在运行命令：状态机单元测试' },` | R7 |  |
| 2630 | `{ id: 'm3', name: '执行者 · 服务重构', duty: 'src/app、src/ui', doing: 'SSE 推送，第 1 次尝试', last: '编辑 src/app/server.ts +38 −4，1 分钟前', live: '正在编辑 src/app/server…` | R7 |  |
| 2631 | `…、验收与正式检查', doing: '没有进行中的工作', last: '回复 执行者 · 状态机：检查不完整的计数，13:47', live: '' },` | R7 | '回复 执行者 · 重新入队与失败类别：检查不完整的计数，13:47' |
| 2632 | `…e: '架构参谋', duty: '模块边界、架构目录', doing: '等 执行者 · 服务重构 回复：core-routes 拆分后的边界', last: '发出咨询，已送达，6 分钟前', live: '' }` | R7 |  |
| 2638 | `return { name: m.name, word: word, dot: 'dot ' + dot, open: open, duty: m.duty, doing: m.doing, last: m.last, live: m.live,` | R7 |  |
| 2833 | `note: '执行者 · 服务重构 的改动：目标列表接口（13:40 预算耗尽），目标展示读取路由（13:58 暂停，路由已经加上）' }] : []);` | R10 | '执行者 · 目标列表接口 和 执行者 · 目标展示读取路由 的改动：目标列表接口（13:40 预算耗尽），目标展示读取路由（13:58 暂停，路由已经加上）' |

#### Done (32)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 82 | `<nav class="rail" aria-label="项目、目标与成员">` | R7 |  |
| 121 | `<div class="rail-label"><span>成员</span></div>` | R7 |  |
| 420 | `…lass="dv-use" role="table" aria-label="各成员用量">` | R14 |  |
| 421 | `…ow"><span class="h" role="columnheader">成员</span><span class="h r" role="columnheader">模型请求</span><span class="h r" role="columnheader">token</span><s…` | R14 |  |
| 840 | `<dt>负责</dt><dd>{{card.agent}}</dd>` | R8 |  |
| 1025 | `<dt>负责的 Agent</dt>` | R8 |  |
| 1159 | `const SM = '执行者 · 状态机'; const SV = '执行者 · 服务重构'; const RV = '审阅者 · 规格';` | R1 | const SM = '执行者 · 重新入队与失败类别'; |
| 1176 | `…', '消息写入收口', SM, { deps: ['T04'], sem: '成员之间的消息只经状态机写入，不再直接改记录。', files: [W + 'communication/mailbox-service.ts', W + 'state/message-machine.ts'] }),` | R1 |  |
| 1182 | `… '生命周期决定收口', SM, { deps: ['T09'], sem: '成员的开始、让出和结束只由工作记录状态机决定。', files: [W + 'sessions/session-lifecycle.ts'] }),` | R1 |  |
| 1184 | `… ['T11'], sem: 'Host 重启或连接中断时记为“平台中断”，不算成员失败。', files: [W + 'state/task-failure.ts'] }),` | R1 |  |
| 1207 | `…ps: ['T04'], sem: '把 core-routes 按目标、任务、成员、文件拆成四组路由。', files: ['src/app/core-routes.ts'] }),` | R1 |  |
| 1338 | `…['秘书（主对话）', 38, '21 万', '2 小时 10 分'], ['执行者 · 状态机', 214, '98 万', '19 小时 5 分'], ['执行者 · 服务重构', 96, '43 万', '8 小时 40 分'],` | R10 | R14: ['执行者（27 条工作线）', 310, '141 万', '27 小时 45 分'] in place of the two executor rows |
| 1354 | `…le is views.ts: you loaded it at 13:40, 执行者 · 服务重构 wrote it at 14:06 while doing` | R10 | comment: 执行者 · 增量刷新 wrote it at 14:06 |
| 1367 | `…ded: '13:40', disk: { at: '14:06', by: '执行者 · 服务重构', add: 3, del: 2, lines: disk } });` | R10 | by: '执行者 · 增量刷新' |
| 1814 | `goalAgent(goal) {` | R4 |  |
| 1843 | `… this.cardCount(n, 'task'), agent: this.goalAgent(goal) });` | R4 |  |
| 1845 | `…), tx: 'tx-plain', why: '', agent: this.agentText(n.owner) });` | R4 |  |
| 1850 | `….kind === 'system' ? '架构参谋 · 待命' : this.agentText(mod ? mod.owner : '未分配');` | R4 |  |
| 1891 | `agentText(a) { const M = this.memberWords(); return a && a !== '未分配' ? a + (M[a] ? ' · ' + M[a] : '') : '未分配'; }` | R4 |  |
| 1892 | `memberWords() { return { '执行者 · 状态机': '待命', '执行者 · 服务重构': '待命', '审阅者 · 规格': '待命', '架构参谋': '待命', '秘书': this.secBusy() ? '工作中' : '待命' }; }` | R4 | remove 'memberWords()'; callers use the read API (R4) |
| 1979 | `/* ------------------------------------------------------------ detail (路径/归属 · 负责的 Agent · 语义 · 关系) */` | R8 |  |
| 2018 | `crumbs: crumbs, agent: isRoot ? this.goalAgent(goal) : this.agentText(n.owner), sem: n.sem, rel: rel, group: true };` | R4 |  |
| 2047 | `….kind === 'system' ? '架构参谋 · 待命' : this.agentText(mod ? mod.owner : '未分配'), sem: sem, rel: rel, group: isGroup };` | R4 |  |
| 2189 | `{ id: 'm1', name: '秘书（主对话）', kv: [['负责', '和你对话、提方案、汇总进展'], ['正在做', secDoing], ['最近一步', '编辑交付汇总，16:35']], branch: false },` | R7 |  |
| 2190 | `{ id: 'm2', name: '执行者 · 状态机', kv: [['负责', 'WorkGraph 的 state、tasks'], ['完成', doneBy('执行者 · 状态机')], ['最近一步', '沿用结果标注通过，10-06 12:10']], branch: true,` | R7 |  |
| 2192 | `{ id: 'm3', name: '执行者 · 服务重构', kv: [['负责', 'src/app、src/ui'], ['完成', doneBy('执行者 · 服务重构')], ['最近一步', '增量刷新通过，10-06 14:20']], branch: true,` | R7 |  |
| 2194 | `{ id: 'm4', name: '审阅者 · 规格', kv: [['负责', '规格条目、验收与正式检查'], ['完成', doneBy('审阅者 · 规格')], ['最近一步', '目标验收第 2 轮，14/14 通过，16:31']], branch: true,` | R7 |  |
| 2196 | `{ id: 'm5', name: '架构参谋', kv: [['负责', '模块边界、架构目录'], ['完成', '记下 1 处与任务书不同'], ['最近一步', '推送接口留在 server.ts，记成以后再做，10-06 14:45']], branch: true,` | R7 |  |
| 2202 | `…word: busy ? '工作中' : '待命', dot: busy ? 'dot s-running' : 'dot s-idle', cls: 'row' + (m.id === 'm1' ? ' is-current' : ''), open: open,` | R7 |  |
| 3055 | `… SV, add: 38, del: 4, hunks: [], note: '执行者 · 服务重构 14:11 的改动：SSE 推送的心跳与断开处理' },` | R10 | note: '执行者 · SSE 推送 14:11 的改动：SSE 推送的心跳与断开处理' |
| 3056 | `…ts', add: 21, del: 6, hunks: [], note: '执行者 · 服务重构 13:58 的改动' },` | R10 | note: '执行者 · SSE 推送 13:58 的改动' |
| 3057 | `…ts', add: 17, del: 9, hunks: [], note: '执行者 · 服务重构 14:03 的改动' }` | R10 | note: '执行者 · SSE 推送 14:03 的改动' |

#### Chain (36)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 5 | `<title>思维链 · 执行者</title>` | R10 | keep (执行者 as the role, or the new model already) |
| 65 | `<nav class="rail" aria-label="项目、目标与成员">` | R7 |  |
| 103 | `<div class="rail-label"><span>成员</span></div>` | R7 |  |
| 105 | `<span class="row-lead"><span class="dot s-idle" aria-hidden="true"></span></span>` | R7 |  |
| 118 | `<span class="live"><span class="dot s-running" aria-hidden="true"></span>{{m.live}}</span>` | R7 |  |
| 121 | `<dt>负责</dt><dd>{{m.duty}}</dd>` | R8 |  |
| 141 | `<span class="head-sub">执行者 · 状态机</span>` | R10 | <span class="head-sub">执行者 · 重新入队与失败类别</span> (Chain is this line's record) |
| 216 | `…lse }}"><span class="live"><span class="dot s-running" aria-hidden="true"></span></span></sc-if>` | R7 |  |
| 233 | `…p-meta"><span class="live"><span class="dot s-running" aria-hidden="true"></span>{{st.liveText}}</span></span></sc-if>` | R7 |  |
| 319 | `<button class="btn btn-sm" type="button" onClick="{{bar.requeue}}" title="重新入队，等执行者领取；下一次尝试带上接续说明">` | R10 | keep (执行者 as the role, or the new model already) |
| 447 | `const wm = S('wm', 'wait', '等待成员 ×6', '审阅者 · 规格', { meta: '4 分 10 秒，收到回复', rec: 'call_6a07',` | R15 |  |
| 449 | `…p((t, i) => S('w' + (i + 1), 'wait', '等待成员', '审阅者 · 规格', {` | R15 |  |
| 492 | `/* the consultation from 执行者 · 服务重构, answered by a read-only copy (A′), not in this work record */` | R10 | comment: the consultation from 执行者 · SSE 推送 |
| 497 | `['提问', '执行者 · 服务重构，14:31'],` | R10 | ['提问', '执行者 · SSE 推送，14:31'] |
| 498 | `['结束', '回复送出后这次执行结束；执行者 · 状态机 仍是待命']] }),` | R10 | ['结束', '回复送出后这次执行结束；执行者 · 重新入队与失败类别 没有别的工作（任务 14:22 已满足）'] |
| 499 | `S('q1', 'chat', '收到问题', M3, { meta: '执行者 · 服务重构', rec: 'msg_8c02', prose: true, full: M3, detail: M3 }),` | R10 | meta: '执行者 · SSE 推送' |
| 504 | `S('l3', 'send', '回复', '执行者 · 服务重构', { meta: '已送达', rec: 'msg_8c09', prose: true, detail: ANS })` | R10 | S('l3', 'send', '回复', '执行者 · SSE 推送', …) |
| 607 | `const SM = '执行者 · 状态机';` | R10 | const SM = '执行者 · 重新入队与失败类别'; |
| 623 | `…g_7b20', '13:43:05', '消息', 'msg_7b20', '执行者 · 状态机 → 审阅者 · 规格 · queued', { kv: [['发信', SM], ['收信', '审阅者 · 规格'], ['状态', 'queued → delivered → replied', …` | R10 | '执行者 · 重新入队与失败类别 → 审阅者 · 规格 · queued' |
| 632 | `…3:47:30', '消息', 'msg_7b31', '审阅者 · 规格 → 执行者 · 状态机 · reply_to msg_7b20', { kv: [['发信', '审阅者 · 规格'], ['收信', SM], ['回复', 'msg_7b20', true], ['回答方', '派生工作…` | R10 | '审阅者 · 规格 → 执行者 · 重新入队与失败类别 · reply_to msg_7b20' |
| 639 | `…_6a10', '13:55:02', '回答', 'turn_6a10', '执行者 · 状态机 · run completed · 交给正式检查', { name: '交给正式检查', kv: [['结果', 'completed', true]], blk: [['正文', c.P2, fal…` | R10 | '执行者 · 重新入队与失败类别 · run completed · 交给正式检查' |
| 689 | `…_6b08', '14:17:05', '回答', 'turn_6b08', '执行者 · 状态机 · run completed · 交给正式检查', { name: '交给正式检查', kv: [['结果', 'completed', true]], blk: [['正文', c.P3, fal…` | R10 | '执行者 · 重新入队与失败类别 · run completed · 交给正式检查' |
| 695 | `const QC = '执行者 · 状态机（只读副本）';` | R10 | const QC = '执行者 · 重新入队与失败类别（只读副本）'; |
| 696 | `…g_8c02', '14:31:20', '消息', 'msg_8c02', '执行者 · 服务重构 → 执行者 · 状态机 · query', { kv: [['发信', '执行者 · 服务重构'], ['收信', SM], ['方式', '咨询，由派生的只读副本回答']], blk: [['正文…` | R10 | '执行者 · SSE 推送 → 执行者 · 重新入队与失败类别 · query', 发信 '执行者 · SSE 推送' |
| 702 | `…_6c02', '14:32:08', '回答', 'turn_6c02', '执行者 · 状态机（只读副本） · run completed', { name: '回复 执行者 · 服务重构', kv: [['结果', 'completed', true]], blk: [['正文', c.ANS…` | R10 | '执行者 · 重新入队与失败类别（只读副本） · run completed', name '回复 执行者 · SSE 推送' |
| 703 | `…g_8c09', '14:32:09', '消息', 'msg_8c09', '执行者 · 状态机（只读副本） → 执行者 · 服务重构 · reply_to msg_8c02', { kv: [['发信', QC], ['收信', '执行者 · 服务重构'], ['回复', 'msg_8c02',…` | R10 | '执行者 · 重新入队与失败类别（只读副本） → 执行者 · SSE 推送 · reply_to msg_8c02', 收信 '执行者 · SSE 推送' |
| 719 | `Object.assign({ id: 'm2', name: '执行者 · 状态机', duty: 'WorkGraph 的 state、tasks' }, m2),` | R7 |  |
| 720 | `{ id: 'm3', name: '执行者 · 服务重构', st: 'running', duty: 'src/app、src/ui', doing: 'SSE 推送，第 1 次尝试',` | R7 |  |
| 721 | `last: later ? '收到回复（执行者 · 状态机 的只读副本）：失败类别的界面文字，14:32' : '编辑 src/app/server.ts +38 −4，1 分钟前', live: '正在编辑 src/app/server.ts' },` | R10 | last: '收到回复（执行者 · 重新入队与失败类别 的只读副本）：失败类别的界面文字，14:32' — this row becomes 执行者 · SSE 推送's (R7) |
| 723 | `last: '回复 执行者 · 状态机：检查不完整的计数，13:47', live: '' },` | R10 | '回复 执行者 · 重新入队与失败类别：检查不完整的计数，13:47' |
| 724 | `…'waiting', duty: '模块边界、架构目录', doing: '等 执行者 · 服务重构 回复：core-routes 拆分后的边界',` | R7 |  |
| 845 | `group({ id: 'cq', head: '执行者 · 服务重构 来问失败类别的界面文字：只读副本回答，不写回这里', word: '已回复', t: '14:31–14:32' }, noThink(c.QA), { keepHead: true });` | R10 | head: '执行者 · SSE 推送 来问失败类别的界面文字：只读副本回答，不写回这里' |
| 853 | `requeue: () => [['requeue', '已重新入队（人工）：等执行者领取，下一次尝试带上接续说明；不计入自动返工']]` | R10 | keep (执行者 as the role, or the new model already) |
| 880 | `requeued: { sq: 'sq z10 s-claimable', word: '可领取', why: '你在 ' + lastT + ' 重新入队，等执行者领取' }` | R10 | keep (执行者 as the role, or the new model already) |
| 909 | `…派生工作记录 ses_9a41 · 只读 · 来源 ses_8d10 · 回答 执行者 · 服务重构 的咨询']];` | R10 | '… · 回答 执行者 · SSE 推送 的咨询' |
| 937 | `return { name: m.name, word: WORD[m.st], dot: 'dot ' + DOT[m.st],` | R7 |  |

#### Member (48)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 17 | `/* header = the member row expanded: 状态 · 职责 · 负责范围 · 当前任务 · 尝试, then the controls; its line keeps the scrolling thread off it */` | R8 |  |
| 89 | `<nav class="rail" aria-label="项目、目标与成员">` | R7 |  |
| 127 | `<div class="rail-label"><span>成员</span></div>` | R7 |  |
| 129 | `<span class="row-lead"><span class="dot s-idle" aria-hidden="true"></span></span>` | R7 |  |
| 150 | `<dt>负责</dt><dd>{{m.duty}}</dd>` | R8 |  |
| 170 | `<span class="head-title">执行者 · 服务重构</span>` | R10 | <span class="head-title">执行者 · SSE 推送</span> (the page of one work line) |
| 210 | `<span class="live"><span class="dot s-running" aria-hidden="true"></span>工作中</span>` | R7 |  |
| 214 | `<span class="dot s-running" aria-hidden="true"></span>{{hs.advText}}` | R7 |  |
| 387 | `…"pnote">原因：超出本任务范围；src/core/work-graph 由执行者 · 状态机负责</p>` | R10 | '原因：超出本任务范围；src/core/work-graph 正由 执行者 · 重新入队与失败类别 在改' |
| 390 | `…失败类别在 <code>src/core/work-graph</code>，归执行者 · 状态机负责，它正在做“重新入队与失败类别”，我改会撞车。需要的话在主对话里交给秘书安排；我继续做 SSE 推送。</p>` | R10 | '这条我不做：失败类别在 src/core/work-graph，不在 SSE 推送的范围里，执行者 · 重新入队与失败类别 正在改它，我改会撞车。需要的话在主对话里交给秘书安排；我继续做 SSE 推送。' |
| 537 | `…mode" role="radiogroup" aria-label="怎么发给执行者 · 服务重构">` | R10 | aria-label="怎么发给执行者 · SSE 推送" |
| 683 | `<dt>负责的 Agent</dt>` | R8 |  |
| 908 | `…思考', obj: '超出本任务范围：src/core/work-graph 归执行者 · 状态机负责，不改' },` | R10 | obj: '超出本任务范围：src/core/work-graph 正由 执行者 · 重新入队与失败类别 在改，不改' |
| 920 | `… return '这条我不做：它属于 src/core/work-graph，归执行者 · 状态机负责，我改会和它正在做的“重新入队与失败类别”撞车。需要的话在主对话里交给秘书安排；我接着做 SSE 推送。';` | R10 | '这条我不做：它属于 src/core/work-graph，执行者 · 重新入队与失败类别 正在改它，我改会撞车。需要的话在主对话里交给秘书安排；我接着做 SSE 推送。' |
| 995 | `const who = '执行者 · 服务重构 · ' + this.selfWord(ctl);` | R10 | const who = '执行者 · SSE 推送 · ' + this.selfWord(ctl) |
| 999 | `rows: [row('归属', '服务拆分'), row('负责', who + '，第 2 次尝试'), row('语义', '前端拆成 api、state、components、views 四层。', 'hc-sem')], hint: '点一下回到主画面' };` | R4 |  |
| 1003 | `…, who), row('语义', '把 core-routes 按目标、任务、成员、文件拆成四组路由。', 'hc-sem')], hint: '点一下回到主画面' };` | R4 |  |
| 1010 | `rows: [row('归属', '服务拆分'), row('负责', who + (att > 1 ? '，第 ' + att + ' 次尝试' : '')), row('语义', '用 SSE 把状态变化推给工作台，取代每秒轮询。', 'hc-sem')],` | R4 |  |
| 1029 | `mint: { name: '直接干预', word: '交给它本人，可能改变它接下来的做法', rows: [['何时', intWhen], ['状态', '已排队 → 已送达 → 已生效 / 被拒绝'], ['为何', '它能改负责范围里的文件、运行命令；中途插话会打断正在写的东西，所以等安全…` | R8 |  |
| 1056 | `hasA: true, aFrom: '执行者 · 服务重构 · 只读分支', creating: false, canIntervene: true, kind: 'reconnect',` | R10 | aFrom: '执行者 · SSE 推送 · 只读分支' |
| 1065 | `hasA: true, aFrom: '执行者 · 服务重构 · 只读分支', a: this.answerOf(b), creating: b.st === 'creating', canIntervene: true, kind: b.kind };` | R10 | aFrom: '执行者 · SSE 推送 · 只读分支' |
| 1072 | `w4: { name: '工作记录 4', task: 'SSE 推送', dot: 'dot ' + (this.moving(ctl) ? 's-running' : ctl === 'paused' ? 's-waiting' : 's-idle'),` | R7 |  |
| 1076 | `agent: '执行者 · 服务重构 · ' + this.selfWord(ctl),` | R10 | agent: '执行者 · SSE 推送 · ' + this.selfWord(ctl) |
| 1078 | `…[{ id: 'c1', name: '咨询 · 架构参谋问', lead: 'dot s-running' }, { id: 'b0', name: '临时分支 · 你问', lead: 'dot s-idle' }]` | R7 |  |
| 1079 | `…id: b.id, name: '临时分支 · ' + b.t, lead: 'dot s-idle' }))) },` | R7 |  |
| 1081 | `…: { name: '工作记录 3', task: '前端拆分', dot: 'dot s-idle', tx: 'tx-plain', word: '已结束', why: '：前端拆分，第 2 次尝试 · 接续，验收通过，10-03',` | R16 |  |
| 1082 | `agent: '执行者 · 服务重构',` | R1 | R16: the record's own line — w3 / w2 '执行者 · 前端拆分', w1 '执行者 · core-routes 拆分' |
| 1084 | `… id: 'w2', name: '工作记录 2 · 已中断', lead: 'dot s-cancelled' }], text: '带入已完成的 38 步和接续说明' },` | R7 |  |
| 1086 | `…: { name: '工作记录 2', task: '前端拆分', dot: 'dot s-cancelled', tx: 'tx-plain', word: '已中断', why: '：前端拆分，第 1 次尝试，平台中断，10-03',` | R16 |  |
| 1087 | `agent: '执行者 · 服务重构',` | R1 | R16: the record's own line — w3 / w2 '执行者 · 前端拆分', w1 '执行者 · core-routes 拆分' |
| 1089 | `… 'w3', name: '工作记录 3 · 第 2 次尝试', lead: 'dot s-idle' }] },` | R7 |  |
| 1091 | `…'工作记录 1', task: 'core-routes 拆分', dot: 'dot s-idle', tx: 'tx-plain', word: '已结束', why: '：core-routes 拆分，第 1 次尝试，验收通过，10-02',` | R16 |  |
| 1092 | `agent: '执行者 · 服务重构',` | R1 | R16: the record's own line — w3 / w2 '执行者 · 前端拆分', w1 '执行者 · core-routes 拆分' |
| 1159 | `['14:03:10', '消息', 'msg_5d02', '你 → 执行者 · 服务重构 · intervene', { id: 'msg_5d02', kind: 'intervention', to: 'ses_9a31', state: 'rejected', reason: { code…` | R1 | '你 → 执行者 · SSE 推送 · intervene', reason owner '执行者 · 重新入队与失败类别' |
| 1173 | `… ':00', type: '消息', id: e.id, sum: '你 → 执行者 · 服务重构 · intervene · ' + en,` | R10 | sum: '你 → 执行者 · SSE 推送 · intervene · ' + en |
| 1221 | `{ id: 'm2', name: '执行者 · 状态机', st: 'running', word: '工作中', duty: 'WorkGraph 的 state、tasks', doing: '重新入队与失败类别，第 2 次尝试 · 接续', last: '运行命令：状态机单元测试，12 秒前…` | R7 | rows from 'wlRail('main')' (R7); this board's own row is 执行者 · SSE 推送 |
| 1222 | `{ id: 'self', name: '执行者 · 服务重构', self: true },` | R7 |  |
| 1223 | `…、验收与正式检查', doing: '没有进行中的工作', last: '回复 执行者 · 状态机：检查不完整的计数，13:47' },` | R7 | '回复 执行者 · 重新入队与失败类别：检查不完整的计数，13:47' |
| 1224 | `…rd: '等回复', duty: '模块边界、架构目录', doing: '等 执行者 · 服务重构 回复：core-routes 拆分后的边界', last: '发出咨询，已送达，6 分钟前' }` | R7 |  |
| 1229 | `dot: 'dot ' + (liveOn ? 's-running' : ctl === 'paused' ? 's-waiting' : 's-idle'), duty: '', doing: '', last: '' };` | R7 |  |
| 1233 | `dot: 'dot ' + (m.st === 'running' ? 's-running' : m.st === 'waiting' ? 's-waiting' : 's-idle'),` | R7 |  |
| 1243 | `dot: 'dot ' + (ctl === 'paused' ? 's-waiting' : 's-idle'), word: ctl === 'paused' ? '已暂停' : '待命',` | R7 |  |
| 1296 | `….out ? '原因：超出本任务范围；src/core/work-graph 由执行者 · 状态机负责' : e.t2 + ' 已生效：它按你说的调整了接下来的做法';` | R10 | '原因：超出本任务范围；src/core/work-graph 正由 执行者 · 重新入队与失败类别 在改' |
| 1318 | `recRow('w4', '工作记录 4 · ' + this.attSpan(att), w4sub, '13:52 起', 'dot ' + (liveOn ? 's-running' : ctl === 'paused' ? 's-waiting' : 's-idle')),` | R7 |  |
| 1334 | `… · 第 2 次尝试', '接续 · 原工作记录已中断', '10-03', 'dot s-idle'),` | R7 |  |
| 1335 | `… 第 1 次尝试', '已中断：平台中断，不能再接着用', '10-03', 'dot s-cancelled')]),` | R7 |  |
| 1337 | `…· 第 1 次尝试', '已结束，2 次执行，验收通过', '10-02', 'dot s-idle')])` | R7 |  |
| 1423 | `inputLabel: isBranch ? '在临时分支里问执行者 · 服务重构（只读）' : '直接干预执行者 · 服务重构',` | R10 | inputLabel: isBranch ? '在临时分支里问 执行者 · SSE 推送（只读）' : '直接干预 执行者 · SSE 推送' |

#### Phone (33)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 204 | `…ot">·</span><span class="step-obj">工作记录：执行者 · 状态机</span>` | R10 | <span class="step-obj">工作记录：执行者 · 重新入队与失败类别</span> |
| 208 | `…ot">·</span><span class="step-obj">工作记录：执行者 · 服务重构</span>` | R10 | <span class="step-obj">工作记录：执行者 · SSE 推送</span> |
| 214 | `<p class="prose">写入收口阶段已全部满足，验收通过。现在两位成员在做：执行者 · 状态机做<button class="ref" type="button" onClick="{{refT13}}" title="在进度里看这个任务"><span class="{{refT13Sq}…` | R9 | "现在 3 条工作线在做：[重新入队与失败类别]、[SSE 推送]，接续说明在正式检查。" (refs keep their buttons and squares) |
| 618 | `<dt>负责的 Agent</dt>` | R8 |  |
| 902 | `{ id: 'S2', name: '写入收口', owner: '执行者 · 状态机', sem: '让所有正式写入只经状态机，不留旁路。' },` | R1 |  |
| 903 | `{ id: 'S3', name: '失败与重新入队', owner: '执行者 · 状态机', sem: '失败分五类；能自动重新入队的自动排回，接续时带上原因。' },` | R1 |  |
| 904 | `{ id: 'S4', name: '检查与返工', owner: '执行者 · 状态机', sem: '让检查能按项重跑、记轮次，返工有上限也有记录。' },` | R1 |  |
| 905 | `{ id: 'S5', name: '服务拆分', owner: '执行者 · 服务重构', sem: '拆开路由和前端，用推送取代每秒轮询。' },` | R1 |  |
| 913 | `… 'S2', '消息写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '成员之间的消息只经状态机写入，不再直接改记录。', files: ['src/core/work-graph/communication/mailbox-…` | R1 |  |
| 914 | `…S2', '检查轮次写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '检查轮次和证据的写入都经状态机判定。', files: ['src/core/work-graph/evidence/evidence-service.t…` | R1 |  |
| 915 | `…S2', '查询任务写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '查询任务和它的每次执行只经状态机写入。', files: ['src/core/work-graph/queries/query-job-service.…` | R1 |  |
| 916 | `…S2', '执行事实读取迁移', 'satisfied', { agent: '执行者 · 状态机', att: 2, deps: ['T04'], sem: '把 Kernel 执行事实的读取搬到 Runtime，写入经状态机。', files: ['src/core/agent-runtime/…` | R1 |  |
| 918 | `…S2', '工作记录目录精简', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '工作记录目录只保留工作记录状态机做出的决定。', files: ['src/core/work-graph/sessions/session-direct…` | R1 |  |
| 919 | `…S2', '生命周期决定收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T09'], sem: '成员的开始、让出和结束只由工作记录状态机决定。', files: ['src/core/work-graph/sessions/session-lifec…` | R1 |  |
| 921 | `… 'S3', '平台中断识别', 'satisfied', { agent: '执行者 · 状态机', deps: ['T11'], sem: 'Host 重启或连接中断时记为“平台中断”，不算成员失败。', files: ['src/core/work-graph/state/task-failu…` | R1 |  |
| 922 | `…'S3', '重新入队与失败类别', 'running', { agent: '执行者 · 状态机', att: 2, why: '第 2 次尝试 · 接续，上次检查未通过', deps: ['T12', 'T05'], sem: '失败后按五种类别决定能否自动重新入队，并记下“系统自动重新入队（n…` | R1 |  |
| 924 | `…', 'S3', '接续说明', 'verifying', { agent: '执行者 · 状态机', why: '正式检查第 1 轮进行中，9/14 项已完成', deps: ['T08', 'T12'], sem: '新的一次执行开头带上上次停在哪里、为什么停，只用已保存的事实组装。', fil…` | R1 |  |
| 925 | `…T15', 'S3', '启动核对', 'failed', { agent: '执行者 · 状态机', why: '执行失败，系统自动重新入队（1/3），等待推进', deps: ['T12', 'T13'], sem: 'Host 启动时核对上次没结束的执行；结果未知的交给你决定。', files…` | R1 |  |
| 929 | `…', 'S4', '证据链接', 'satisfied', { agent: '执行者 · 状态机', deps: ['T06'], sem: '每轮检查的报告、退出码和日志都挂到对应任务。', files: ['src/core/work-graph/evidence/coverage.ts'] …` | R1 |  |
| 930 | `… 'S4', '检查链与重新检查', 'blocked', { agent: '执行者 · 状态机', att: 2, why: '检查不完整，第 2 轮的类型检查被 Host 重启打断', deps: ['T19', 'T06'], sem: '让检查链支持重新检查：重跑哪些项、记第几轮、什么时候…` | R1 |  |
| 931 | `…', 'S4', '检查不完整判定', 'decide', { agent: '执行者 · 状态机', att: 4, why: '自动返工已达上限（3/3）', deps: ['T19'], sem: '检查进程被打断或报告缺项时判为“检查不完整”，不判为“检查未通过”。', files: ['s…` | R1 |  |
| 937 | `…core-routes 拆分', 'satisfied', { agent: '执行者 · 服务重构', deps: ['T04'], sem: '把 core-routes 按目标、任务、成员、文件拆成四组路由。', files: ['src/app/core-routes.ts'] }),` | R1 |  |
| 938 | `…', 'S5', '前端拆分', 'satisfied', { agent: '执行者 · 服务重构', att: 2, deps: ['T26'], sem: '前端拆成 api、state、components、views 四层。', files: ['src/ui/main.ts', 'src…` | R1 |  |
| 940 | `…', 'S5', 'SSE 推送', 'running', { agent: '执行者 · 服务重构', why: '第 1 次尝试，已改 3 个文件', deps: ['T26', 'T27'], sem: '用 SSE 把状态变化推给工作台，取代每秒轮询。', files: ['src/app/…` | R1 |  |
| 1170 | `agentText(a) { const M = this.memberWords(); return a && a !== '未分配' ? a + (M[a] ? ' · ' + M[a] : '') : '未分配'; }` | R4 |  |
| 1171 | `memberWords() {` | R4 |  |
| 1174 | `return { '执行者 · 状态机': w, '执行者 · 服务重构': w, '审阅者 · 规格': '待命', '架构参谋': '等回复', '秘书': '待命' };` | R10 | remove 'memberWords()'; callers use the read API (R4) |
| 1178 | `/* the tap detail = Main's detail: name, state + reason, 路径/归属, 负责的 Agent, 语义, 关系.` | R8 |  |
| 1204 | `… ? (st.cancelled ? '秘书 · 待命' : '秘书 · 待命，另有 2 位成员' + (st.paused ? '已暂停' : '工作中')) : goal === 'g2' ? '秘书 · 规划中' : '未分配')` | R5 |  |
| 1205 | `: this.agentText(n.owner);` | R4 |  |
| 1333 | `…取消，可重新入队' : s.paused ? '已暂停，可继续' : '运行中，2 位成员工作中',` | R6 | '运行中，' + this.wlGoalBar('main') = '运行中，3 条工作线工作中' |
| 1462 | `… ' + (s.pausedAt \|\| '14:15') + ' 暂停' : '2 位成员工作中',` | R6 | → 'this.wlGoalBar('main')' = '3 条工作线工作中' |
| 1465 | `…) => pushLog([{ isSys: true, text: '已继续：两位执行者从停下的地方接续', goal: 'g1' }], { paused: false }),` | R9 | '已继续：3 条工作线从停下的地方接续' |

#### ArchOverview (26)

| line | nearby text | rule | exact replacement / note |
|---|---|---|---|
| 240 | `<dt>负责</dt><dd>{{card.agent}}</dd>` | R8 |  |
| 330 | `<dt>负责的 Agent</dt>` | R8 |  |
| 407 | `{ id: 'S2', name: '写入收口', owner: '执行者 · 状态机', sem: '让所有正式写入只经状态机，不留旁路。' },` | R1 |  |
| 408 | `{ id: 'S3', name: '失败与重新入队', owner: '执行者 · 状态机', sem: '失败分五类；能自动重新入队的自动排回，接续时带上原因。' },` | R1 |  |
| 409 | `{ id: 'S4', name: '检查与返工', owner: '执行者 · 状态机', sem: '让检查能按项重跑、记轮次，返工有上限也有记录。' },` | R1 |  |
| 410 | `{ id: 'S5', name: '服务拆分', owner: '执行者 · 服务重构', sem: '拆开路由和前端，用推送取代每秒轮询。' },` | R1 |  |
| 418 | `… 'S2', '消息写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '成员之间的消息只经状态机写入，不再直接改记录。', files: ['src/core/work-graph/communication/mailbox-…` | R1 |  |
| 419 | `…S2', '检查轮次写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '检查轮次和证据的写入都经状态机判定。', files: ['src/core/work-graph/evidence/evidence-service.t…` | R1 |  |
| 420 | `…S2', '查询任务写入收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '查询任务和它的每次执行只经状态机写入。', files: ['src/core/work-graph/queries/query-job-service.…` | R1 |  |
| 421 | `…S2', '执行事实读取迁移', 'satisfied', { agent: '执行者 · 状态机', att: 2, deps: ['T04'], sem: '把 Kernel 执行事实的读取搬到 Runtime，写入经状态机。', files: ['src/core/agent-runtime/…` | R1 |  |
| 423 | `…S2', '工作记录目录精简', 'satisfied', { agent: '执行者 · 状态机', deps: ['T04'], sem: '工作记录目录只保留工作记录状态机做出的决定。', files: ['src/core/work-graph/sessions/session-direct…` | R1 |  |
| 424 | `…S2', '生命周期决定收口', 'satisfied', { agent: '执行者 · 状态机', deps: ['T09'], sem: '成员的开始、让出和结束只由工作记录状态机决定。', files: ['src/core/work-graph/sessions/session-lifec…` | R1 |  |
| 426 | `… 'S3', '平台中断识别', 'satisfied', { agent: '执行者 · 状态机', deps: ['T11'], sem: 'Host 重启或连接中断时记为“平台中断”，不算成员失败。', files: ['src/core/work-graph/state/task-failu…` | R1 |  |
| 427 | `…'S3', '重新入队与失败类别', 'running', { agent: '执行者 · 状态机', att: 2, why: '第 2 次尝试 · 接续，上次检查未通过', deps: ['T12', 'T05'], sem: '失败后按五种类别决定能否自动重新入队，并记下“系统自动重新入队（n…` | R1 |  |
| 429 | `…', 'S3', '接续说明', 'verifying', { agent: '执行者 · 状态机', why: '正式检查第 1 轮进行中，9/14 项已完成', deps: ['T08', 'T12'], sem: '新的一次执行开头带上上次停在哪里、为什么停，只用已保存的事实组装。', fil…` | R1 |  |
| 430 | `…T15', 'S3', '启动核对', 'failed', { agent: '执行者 · 状态机', why: '执行失败，系统自动重新入队（1/3），等待推进', deps: ['T12', 'T13'], sem: 'Host 启动时核对上次没结束的执行；结果未知的交给你决定。', files…` | R1 |  |
| 434 | `…', 'S4', '证据链接', 'satisfied', { agent: '执行者 · 状态机', deps: ['T06'], sem: '每轮检查的报告、退出码和日志都挂到对应任务。', files: ['src/core/work-graph/evidence/coverage.ts'] …` | R1 |  |
| 435 | `… 'S4', '检查链与重新检查', 'blocked', { agent: '执行者 · 状态机', att: 2, why: '检查不完整，第 2 轮的类型检查被 Host 重启打断', deps: ['T19', 'T06'], sem: '让检查链支持重新检查：重跑哪些项、记第几轮、什么时候…` | R1 |  |
| 436 | `…', 'S4', '检查不完整判定', 'decide', { agent: '执行者 · 状态机', att: 4, why: '自动返工已达上限（3/3）', deps: ['T19'], sem: '检查进程被打断或报告缺项时判为“检查不完整”，不判为“检查未通过”。', files: ['s…` | R1 |  |
| 442 | `…core-routes 拆分', 'satisfied', { agent: '执行者 · 服务重构', deps: ['T04'], sem: '把 core-routes 按目标、任务、成员、文件拆成四组路由。', files: ['src/app/core-routes.ts'] }),` | R1 |  |
| 443 | `…', 'S5', '前端拆分', 'satisfied', { agent: '执行者 · 服务重构', att: 2, deps: ['T26'], sem: '前端拆成 api、state、components、views 四层。', files: ['src/ui/main.ts', 'src…` | R1 |  |
| 445 | `…', 'S5', 'SSE 推送', 'running', { agent: '执行者 · 服务重构', why: '第 1 次尝试，已改 3 个文件', deps: ['T26', 'T27'], sem: '用 SSE 把状态变化推给工作台，取代每秒轮询。', files: ['src/app/…` | R1 |  |
| 1463 | `memberWords() { return { '执行者 · 状态机': '工作中', '执行者 · 服务重构': '工作中', '审阅者 · 规格': '待命', '架构参谋': '等回复', '秘书': '待命' }; }` | R4 | remove 'memberWords()'; callers use the read API (R4) |
| 1464 | `agentText(a) { const M = this.memberWords(); return a && a !== '未分配' ? a + (M[a] ? ' · ' + M[a] : '') : '未分配'; }` | R4 |  |
| 1465 | `…turn id === 'SYS' ? '架构参谋 · 等回复' : this.agentText(a ? a.owner : '未分配'); }` | R4 |  |
| 1530 | `/* ------------------------------------------------------------ detail (路径/归属 · 负责的 Agent · 语义 · 关系) */` | R8 |  |

#### Shared files (fix the source, then every board re-pastes it verbatim)

| file | text | on boards | what replaces it |
|---|---|---|---|
| arch-semantic.js | `{ id: 'src/ui', name: 'UI', group: 'outer', owner: '执行者 · 服务重构', sem: '浏览器里的工作台界面；只按类型引用 Host 的 HTTP 数据结构。', rule: '边界检查：只允许按类型引用 Host 的 HTTP 数据结构。' },` | Main, TaskDAG, Plan, Goals, Decide, Done, ArchOverview | S2 |
| arch-semantic.js | `{ id: 'src/app', name: 'Host', group: 'outer', owner: '执行者 · 服务重构', sem: 'Host 进程：启动平台实例、HTTP 路由、推送与关注观察。', rule: '边界检查：可以引用装配、共享契约和各模块的公开端口，不能引用 UI。' },` | Main, TaskDAG, Plan, Goals, Decide, Done, ArchOverview | S2 |
| arch-semantic.js | `{ id: AR, name: 'AgentRuntime', group: 'core', owner: '执行者 · 状态机', sem: 'Kernel 的执行、控制与观察；工作记录历史的桥接。', decl: [WG, WT, RS] },` | Main, TaskDAG, Plan, Goals, Decide, Done, ArchOverview | S2 |
| arch-semantic.js | `{ id: WG, name: 'WorkGraph', group: 'core', owner: '执行者 · 状态机', sem: '目标、任务、执行和工作记录的正式事实、原子状态操作与查询。', decl: [WT, RS] },` | Main, TaskDAG, Plan, Goals, Decide, Done, ArchOverview | S2 |
| timeline.js | `['r11', 'RV', null, 0, 'query', '10-04 13:43', '10-04 13:47', 'answered', '回答 执行者 · 状态机：检查不完整的计数', null, null, 3, 0, 0, 1, null, null, null],` | Main, TaskMap, TaskDAG | S1 |
| timeline.js | `['s38', 'SM', null, 0, 'query', '10-04 14:31', '10-04 14:32', 'answered', '回答 执行者 · 服务重构：失败类别的界面文字', null, null, 3, 0, 0, 1, null, null, null],` | Main, TaskMap, TaskDAG | S1 |
| timeline.js | `members: [{id: 'SM', name: '执行者 · 状态机'}, {id: 'SV', name: '执行者 · 服务重构'}, {id: 'RV', name: '审阅者 · 规格'}, {id: 'AA', name: '架构参谋'}, {id: 'SC', name: '秘书（主对话）'}],` | Main, TaskMap, TaskDAG | S1 |
| auxtabs.snippet.js | `/* what is on disk now: 执行者 · 服务重构 edited it at 14:11 (+38 −4, Member.dc.html call_7e2b); the window shows the heartbeat part */` | Main, Plan, Goals, Decide, Done | S3 |
| auxtabs.snippet.js | `disk: { at: '14:11', by: '执行者 · 服务重构', add: 38, del: 4, lines: [` | Main, Plan, Goals, Decide, Done | S3 |
| auxtabs.snippet.js | `{ path: SV, add: 38, del: 4, by: 'SSE 推送', hunks: [], note: '执行者 · 服务重构 14:11 的改动：SSE 推送的心跳与断开处理' },` | Main, Plan, Goals, Decide | S3 |
| auxtabs.snippet.js | `{ path: 'src/app/attention-observer.ts', add: 21, del: 6, by: 'SSE 推送', hunks: [], note: '执行者 · 服务重构 13:58 的改动' },` | Main, Plan, Goals, Decide | S3 |
| auxtabs.snippet.js | `{ path: 'src/ui/main.ts', add: 17, del: 9, by: 'SSE 推送', hunks: [], note: '执行者 · 服务重构 14:03 的改动：改成订阅推送，断线时退回轮询' },` | Main, Plan, Goals, Decide | S3 |

<!-- checklist:end -->
