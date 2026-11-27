# G6 notes 2026-11-27（运行号 g6-2026-11-27-5f54852b）

## 逐场景判据

### E05：uncovered

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1110148（含缓存命中），输出 19248，缓存命中 906496，Query 请求 19。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| gate | C-185 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| paths | C-185, C-217 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| kept | C-185 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| single-occupancy | C-71 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| convention | C-208 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| duplicates | C-208 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| reviewer | C-208, C-218 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| name-different | C-208 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| name-same | C-208 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| temporary | C-208 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |
| line-choice | C-73, C-191 | uncovered (not-run) | stopped before this check: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged |

- 人采用了候选 plan-proposal-47fda1e08af5e656fbc02d4f37d0a6a8（版本 1）。
- reverify card t1 (head round c2e52f11-b6b0-478f-8b66-4451c04a79f9, candidates plan-proposal-47fda1e08af5e656fbc02d4f37d0a6a8): committed
- stopped: not-run: plans/apply plan-proposal-8711310f22fd3b6335767dd125ee4a63: rejected invalid the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged
- goal-confirm:goal.confirmDraft:648ccedf61f8ac4ab7412811352c1abc6e9f7fc06ae59bc14395538d36625e6f (NEEDS_DECISION): pause because E05 ended: committed

### E06：uncovered

- C 行：C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 0（含缓存命中），输出 0，缓存命中 0，Query 请求 0。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| handoff | C-219 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| successor-input | C-75, C-209, C-219 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| successor-frontier | C-75 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| no-restatement | C-209 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| excluded-path | C-209 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| same-task-new-run | C-135 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| history-continuity | C-106, C-194 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| restart-running | C-149 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| restart-paused | C-151 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| archive | C-219 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| hand-or-drop | C-223 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |
| wake | C-68, C-181 | uncovered (not-run) | stopped before this check: E05 没有留下可接续的对象：没有真实项目或做过工的线 |

- stopped: not-run: E05 没有留下可接续的对象：没有真实项目或做过工的线

### E08：fail

- C 行：C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210；自治档 `every_step`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1254998（含缓存命中），输出 14351，缓存命中 1038976，Query 请求 22。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-cd0c0fea2e16a9bdbcd63db41f3ed7e1；Goal 指针 {"aggregateType":"PlanRevision","projectId":"62c918151eb2b65f12176d1bf16d7bdf","planId":"initial-plan-cd0c0fea2e16a9bdbcd63db41f3ed7e1"} |
| hold-before-adopt | C-210 | uncovered (not-run) | sub 在提交改需求前 0.167 s 被领（提交时至少已有 1 个 Run） |
| versions | C-210 | pass | plans/versions 2 版；改目标的候选由人 plans/apply（committed，采用 {"aggregateType":"PlanRevision","projectId":"62c918151eb2b65f12176d1bf16d7bdf","planId":"initial-plan-ed1327bc458fb4583ac1888c1a472e85"}） |
| switch | C-210 | fail | div add-div；sub active；mul active；记录 无；接替 无；版本 无；采用者 无 |
| old-evidence | C-210 | pass | div Run 2381be6b-e68b-484e-ba02-dde1e3e25101；检查轮计划 initial-plan-ed1327bc458fb4583ac1888c1a472e85；采用 initial-plan-ed1327bc458fb4583ac1888c1a472e85；ob-div/vr-div-dynamic:pass |
| required-cancel | C-210 | uncovered (not-run) | 平台停在等人（the platform stopped: claim_hold_held: the Task's claim waits for 用户改需求（取消 sub、改为 div）：等新方案被采用、任务图更新后再领。mul 本身照旧，但它的依赖与指令引用了 sub，需随新计划一起重写。），Goal 没有 COMPLETED；div 满足前不完成这一条没有对象 |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- first plan initial-plan-cd0c0fea2e16a9bdbcd63db41f3ed7e1: sub = add-sub，mul = add-mul
- 提交前最近一次轮询：mul 0 个 Run（-），sub 1 个 Run；sub 的 dispatch.claimableNow null
- E08 改需求的轮：?:request/ideas 2
- the person selected idea 1 of 2 on the change: A：把 sub 任务整体改写成 div（推荐，最少确认次数）
- while the change candidate was written the person answered action_release card {"kind":"action_release","requestRef":{"aggregateType":"ActionRequest","goalId":"goal-confirm:goal.confirmDraft:b78d304c7d5ad683bd6a7b52473674422418f4f1f05da60e009335584bf50a0a","projectId":"62c918151eb2b65f12176d1bf16d7bdf","requestId":"action_request.stop:71c887076e6c826e1875abf72640bbfeb4ce83638f8365fdb021511629301177","taskId":"add-sub"},"revision":1}
- E08 采用 initial-plan-ed1327bc458fb4583ac1888c1a472e85：任务 add-sub:active, add-mul:active, goal-gate:active, add-div:active；处置记录 0 条
- node review add-sub (calc.js, test/sub.test.js): committed
- node review add-div (calc.js, test/div.test.js, test/sub.test.js): committed
- goal-confirm:goal.confirmDraft:b78d304c7d5ad683bd6a7b52473674422418f4f1f05da60e009335584bf50a0a (RUNNING): pause because E08 ended: committed

### E09：uncovered

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2098628（含缓存命中），输出 44997，缓存命中 1812224，Query 请求 27。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | uncovered (not-run) | 首版计划 initial-plan-88d7fa172f8e5b98a93bb907ba1c4c75 的任务书没有把 parseDate 冲突留给执行者上报（开工前已消掉）：task-api「只改 src/api.js 并新增 test/api.test.js。导出 function parseDate(text) 返回 Date；非法输入抛 RangeError。用 node:test + node:assert/strict。不碰 src/report.js。」；task-report「只改 src/report.js 并新增 test/report.test.js。导出 function monthOf(text)，内部 import { parseDate } from './api.js'，用返回的 Date 取月（getMonth 从 0 起）。不改 src/api.js。」 |
| adviser-explains | C-211 | uncovered (not-run) | 首版计划 initial-plan-88d7fa172f8e5b98a93bb907ba1c4c75 的任务书没有把 parseDate 冲突留给执行者上报（开工前已消掉）：task-api「只改 src/api.js 并新增 test/api.test.js。导出 function parseDate(text) 返回 Date；非法输入抛 RangeError。用 node:test + node:assert/strict。不碰 src/report.js。」；task-report「只改 src/report.js 并新增 test/report.test.js。导出 function monthOf(text)，内部 import { parseDate } from './api.js'，用返回的 Date 取月（getMonth 从 0 起）。不改 src/api.js。」 |
| person-decides | C-211, C-62 | uncovered (not-run) | 首版计划 initial-plan-88d7fa172f8e5b98a93bb907ba1c4c75 的任务书没有把 parseDate 冲突留给执行者上报（开工前已消掉）：task-api「只改 src/api.js 并新增 test/api.test.js。导出 function parseDate(text) 返回 Date；非法输入抛 RangeError。用 node:test + node:assert/strict。不碰 src/report.js。」；task-report「只改 src/report.js 并新增 test/report.test.js。导出 function monthOf(text)，内部 import { parseDate } from './api.js'，用返回的 Date 取月（getMonth 从 0 起）。不改 src/api.js。」 |
| new-version | C-211, C-55 | uncovered (not-run) | 首版计划 initial-plan-88d7fa172f8e5b98a93bb907ba1c4c75 的任务书没有把 parseDate 冲突留给执行者上报（开工前已消掉）：task-api「只改 src/api.js 并新增 test/api.test.js。导出 function parseDate(text) 返回 Date；非法输入抛 RangeError。用 node:test + node:assert/strict。不碰 src/report.js。」；task-report「只改 src/report.js 并新增 test/report.test.js。导出 function monthOf(text)，内部 import { parseDate } from './api.js'，用返回的 Date 取月（getMonth 从 0 起）。不改 src/api.js。」 |
| report-after-dispatch | C-185, C-211 | uncovered (not-run) | 没有认出执行者的上报，这一支没走到 |
| diagnosis-reverify | C-211 | uncovered (not-run) | 2 个检查轮里没有一轮的重验以消息为依据（reverify.newInputRefs 没有 session_message），这一支没走到（可选） |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 3 条 finding；带路径的：package.json, README.md, src/report.js |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"12d068793502eda73c42a2e5d76707c0","workspaceId":"a2a881ec7b5d372b2023abf361375b61","captureId":"80581dc4-475a-417c-a85d-3d8e01e50bfc"} |
| observation-after-pass | C-98 | pass | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"12d068793502eda73c42a2e5d76707c0","workspaceId":"a2a881ec7b5d372b2023abf361375b61","captureId":"80581dc4-475a-417c-a85d-3d8e01e50bfc"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"12d068793502eda73c42a2e5d76707c0","workspaceId":"a2a881ec7b5d372b2023abf361375b61","captureId":"cc994d24-1abd-4e66-a865-05034e027809"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：task-api PASS/gaps 0, task-report PASS/gaps 0 |
| uncovered-round | C-99 | uncovered (not-run) | 这次没有出现缺覆盖（INCONCLUSIVE）的检查轮 |

- E09 Goal ended COMPLETED（完成观测于 2026-11-27T06:20:42.042Z）
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：fail

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 733689（含缓存命中），输出 14582，缓存命中 601344，Query 请求 14。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| graph-cards | C-88, C-89 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| raw-history | C-42, C-157 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| completion-chain | C-104 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| restart-state | C-145, C-215 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| reconcile | C-146 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| redrive-sets | C-155 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| new-goal | C-114, C-158 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| history-reuse | C-220 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| stale-premise | C-220 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| replay | C-147 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |
| wait-registry | C-207 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet) |

- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason the goal gate g1 has no ended ordinary producer Run yet)
- goal-confirm:goal.confirmDraft:58b96317bb48d283db44aece6c5d079359eebac9b23f50fe63ef5dd05e5fc9bc (RUNNING): pause because E12 ended: committed

### iteration：fail

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1378144（含缓存命中），输出 21643，缓存命中 1163520，Query 请求 27。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | pass | 3 个思路，目标卡草稿 0 |
| select | C-109 | pass | select-idea queued；下一轮输入提到所选：true |
| candidate | C-110 | pass | 候选 plan-proposal-49dee74176aac525fe837b96d7f880df（candidate） |
| what-changed | C-213, C-110 | fail | 第二轮回答说明改动：false；新候选 plan-proposal-45b26390ac6dbe2e50e1229f8ef6ab4f，前一版 {"proposalRef":{"aggregateType":"PlanProposal","projectId":"be495b6d14860788aea4310915cff163","workspaceId":"5f1ce8822996ce7b0b0f459e9eeced28","proposalId":"plan-proposal-49dee74176aac525fe837b96d7f880df"},"revision":2} |
| per-request | C-111 | pass | 采用第一请求的候选 committed；第二请求候选 plan-proposal-ddf764105d1e664842569c5cf9e3c940 现在 stale |
| why | C-112, C-226 | pass | 追问后候选不变：true；回答 2027 字 |
| continues | C-105 | pass | 同一请求 3 轮，秘书 Session session-aea170b7df0e9730f0d11fb2aa790b68ab68a8f5d2f01e0770caf21e4f1c5c82 |
| request-goal | C-107 | pass | 请求记的目标 goal-confirm:goal.confirmDraft:529a27cd11cdc85cc1f415a43c6d142dbb9f41886b3d9be7b780bb762279dfc9 |
| cards-ask | C-113 | pass | 秘书线的 turn 输入带 ## Cards：true |
| multi-round | C-194 | pass | 后续轮的回答接上前面改过的内容（process.argv） |

- goal-confirm:goal.confirmDraft:529a27cd11cdc85cc1f415a43c6d142dbb9f41886b3d9be7b780bb762279dfc9 (RUNNING): pause because iteration ended: committed

### intervention：fail

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 3471268（含缓存命中），输出 36261，缓存命中 2975744，Query 请求 44。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | pass | 问一问 queued → answered；原线 Run running/-，输入含这个问题的轮 无；问件 session-message-1252e99c0f812dea614b20368cedb9d0492d1014043487c097f43c325262fc4b answeredBy copy，送进 无 |
| delivery-states | C-189, C-192 | pass | disposition 依次：offerable → delivered（发送回执 sent）；发信时在跑的 Run 289d34ca-810e-4957-95eb-5c4f6ed5d8b3；送进 Run 289d34ca-810e-4957-95eb-5c4f6ed5d8b3 |
| busy-original-words | C-189, C-199 | pass | 送进发信时在跑的 Run 289d34ca-810e-4957-95eb-5c4f6ed5d8b3（接受于 2026-11-27T07:04:30.843Z）；这个 Run 输入含原话的轮：kturn-76e1963d6c38705d930e783fe7c8366487772524c37e6c869edfe71ebfef932b |
| continue-no-planning | C-199 | pass | 发送时线上当前任务 goal-confirm:goal.confirmDraft:a0878ce64b358492635bcf9954a1603eaf8a335265019145f28e9db2503f8218/t-slugify active/running；这条消息的 intervention_planning Query：没有 |
| planning-when-idle | C-199, C-200 | pass | 2026-11-27T07:04:31.124Z 发给 session-ad9cea83c8fd1df4e5a5942301e49ae1788f93c5ffad940b780fd7c5119ad7dd（目标 RUNNING，线上当前任务 goal-confirm:goal.confirmDraft:a0878ce64b358492635bcf9954a1603eaf8a335265019145f28e9db2503f8218/t-slugify active/satisfied）；Query intervention-planning-942d85a0c863acfd7e0c5974e6cc90442b5d64953bd8ceb48887aa3b182e8811（开在 session-ad9cea83c8fd1df4e5a5942301e49ae1788f93c5ffad940b780fd7c5119ad7dd）answered；候选 {"goalRef":{"aggregateType":"Goal","goalId":"goal-confirm:goal.confirmDraft:a0878ce64b358492635bcf9954a1603eaf8a335265019145f28e9db2503f8218","projectId":"bafe8a391429890c8e7dd2ed327a4ceb"},"kind":"candidate","requestRef":{"aggregateType":"QueryJob","projectId":"bafe8a391429890c8e7dd2ed327a4ceb","queryJobId":"intervention-planning-942d85a0c863acfd7e0c5974e6cc90442b5d64953bd8ceb48887aa3b182e8811","workspaceId":"9f8f015db47911b4125edb4e946a85f2"}}（waiting_answer）；规划 Query 开在原线 |
| claim-once | C-199 | uncovered (not-run) | 长目标活跃期间没有出现“干过活的线空闲、它当前的任务没完成”的时刻，没走到这个分支 |
| four-endings | C-201, C-202, C-203 | uncovered (entry-missing) | “反问”“非法”两种收尾没有公开入口能造出；这次看到的结局：candidate |
| review-packet | C-199 | uncovered (not-run) | 被 Run 接受的直接干预 1 条；审阅线 无；这个目标的 execreview 包 0 个；逐条：session-message-dd3029e4387990fdfb5be4302fd6ae2175b7b9f9886a2da380500f22a14652e3（Run 289d34ca-810e-4957-95eb-5c4f6ed5d8b3，任务 t-slugify）：没有对上这个任务和 Run 的审阅包（检查计划里没有审阅项时不出包） |
| completed-goal | C-114 | uncovered (not-run) | 干过已完成目标 goal-confirm:goal.confirmDraft:d45408db326b00a0a85fff66bbf2439b49d72a1cef2b82bb2a7bfb58ea91c1d9 的线（session-a4178ffaa684d2915c49fd7f162de7531239be6a6529ab1ffdd62517e4dde6b7, session-ad9cea83c8fd1df4e5a5942301e49ae1788f93c5ffad940b780fd7c5119ad7dd）页面上显示的目标都不是它（被别的目标复用），发给它们的消息不会成为新目标请求 |
| paused-queues | C-197 | fail | the platform did not do it: timed out after 30 min waiting for delivery after resume |

- goal-confirm:goal.confirmDraft:a0878ce64b358492635bcf9954a1603eaf8a335265019145f28e9db2503f8218: the person selected idea 1 of 3 (A：一函数一任务，三个任务并行，阶段门统一跑 node --test)
- driver-start goal-confirm:goal.confirmDraft:a0878ce64b358492635bcf9954a1603eaf8a335265019145f28e9db2503f8218: rejected busy
- paused-queues: later read fail: 暂停 committed（目标当时 RUNNING）：暂停中 offerable；恢复 committed  后 30 分钟里没有收尾
- 长目标结束 COMPLETED

### waiting：uncovered

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1346879（含缓存命中），输出 26654，缓存命中 1073152，Query 请求 16。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | pass | 成员 session-a5d82af5753b7f405621ee6609cdc43184aa0d3a0447f9c4f97c985eba8bd80d 的 Work（Run d04a8a50-25a9-446f-84d6-61751f022de1）经工具发出等待 session-message-8252098d2a04ff3bc7eae51c7066467bbf6b48f9b8bfa7c985af997358d82105：收信人 session-e7bbb0837dd0ffb5ffef333fea429c89455bf1e9ee6a5fd5c36b9f101e86355b，期限 2026-11-27T07:40:06.527Z，waitAfterSend true；发信的 Run d04a8a50-25a9-446f-84d6-61751f022de1 ended/yielded，continuation wait_reply → session-message-8252098d2a04ff3bc7eae51c7066467bbf6b48f9b8bfa7c985af997358d82105 |
| interject-keeps-wait | C-188, C-224 | pass | 插话 session-message-f9c3b559bf397b39a97cf3bb9c1462fd513586232494f8f5dc9143dbd02eaac0（sent）：接它的 Run d6923419-eb95-4d4e-a874-9a2467d8690f（consumedWait intervention，在 session-a5d82af5753b7f405621ee6609cdc43184aa0d3a0447f9c4f97c985eba8bd80d）；原等待 session-message-8252098d2a04ff3bc7eae51c7066467bbf6b48f9b8bfa7c985af997358d82105 open，期限 2026-11-27T07:40:06.527Z（原 2026-11-27T07:40:06.527Z）；新中断通知 成员侧 1 条、秘书侧 1 条 |
| restart-kept | C-170, C-207 | pass | 重启后同一等待：从sessions/facts 的 waits（expired）读到，期限 2026-11-27T07:40:06.527Z（原 2026-11-27T07:40:06.527Z），收信人 session-e7bbb0837dd0ffb5ffef333fea429c89455bf1e9ee6a5fd5c36b9f101e86355b；消费它的接受 expiry → Run 793d10ed-1ed7-4422-9515-0e8767f8d419；接续的 Run 793d10ed-1ed7-4422-9515-0e8767f8d419 consumedWait expiry，messageRef session-message-8252098d2a04ff3bc7eae51c7066467bbf6b48f9b8bfa7c985af997358d82105，originalRun d04a8a50-25a9-446f-84d6-61751f022de1（原 d04a8a50-25a9-446f-84d6-61751f022de1），在 session-a5d82af5753b7f405621ee6609cdc43184aa0d3a0447f9c4f97c985eba8bd80d（成员 session-a5d82af5753b7f405621ee6609cdc43184aa0d3a0447f9c4f97c985eba8bd80d） |
| expiry-once | C-171, C-190 | pass | expiredAt 2026-11-27T07:41:13.098Z；记下时消费 false；之后由 expiry 消费 |
| second-expiry | C-171, C-190, C-224 | uncovered (not-run) | 第二封等待已由回复消费（2026-11-27T07:44:07.632Z），回复胜过到期（STATE-MACHINES-SPEC.md:3650） |
| consumes | C-187 | pass | 等待 session-message-8252098d2a04ff3bc7eae51c7066467bbf6b48f9b8bfa7c985af997358d82105 的接受条目：message:false@2026-11-27T07:43:30.602Z, expiry:true@2026-11-27T07:44:07.592Z（只认一次真实接受消费等待） |
| late-reply | C-224, C-189 | uncovered (env-unavailable) | 等待链已结束（t-wait satisfied，链上 2 条等待都已了结）；到期（2026-11-27T07:41:13.098Z）被消费之后没有回复（回复槽空，也没有接受的回复） |
| reply-first | C-187, C-224 | uncovered (not-run) | 第二个问题 session-message-221b6f6f4d9043a70cf33240a35aa02acc195a9b62c9a53131955bfb0a64bec7（期限 2026-11-27T08:14:07.528Z；第一次在 2026-11-27T07:44:12.042Z 轮询到（当时回复 无，到期 无））：先到期了（2026-11-27T08:14:30.520Z），没有回复抢先 |
| transfer | C-224 | uncovered (not-run) | 第二个问题 session-message-221b6f6f4d9043a70cf33240a35aa02acc195a9b62c9a53131955bfb0a64bec7（期限 2026-11-27T08:14:07.528Z；第一次在 2026-11-27T07:44:12.042Z 轮询到（当时回复 无，到期 无））：回复先到（2026-11-27T08:14:30.648Z），转交没有发生 |
| disconnect | C-195, C-196 | uncovered (not-run) | 归档前重读成员线：已没有开着的等待（都已回答或处理），断开无从造出 |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | 公开读口给出 7 项接受顺序（见 notes），但“接受顺序等于供给顺序”没有书面依据，不判 pass |

- P6 Q8 插话在第一个等待开着时发出；它让成员线多开了一个 Run（d6923419-eb95-4d4e-a874-9a2467d8690f），之后的到期链在这之后发生
- 关 Host 时 t-wait 的 Run 在 starting（d6923419-eb95-4d4e-a874-9a2467d8690f）：已领取、未进入，重启后同一次领取续驱（W-01..W-03），不是等待的接续
- close and restart: SIGINT, exit 0 after 771 ms
- restart: resumeOnStartup = ask
- 供给顺序旁证（run.input_accepted 的接受顺序，不作判据）：krun-34ab8d708ec2ed8ff292a37a5e7768b41ccc170e8f64090f9f3bba6c79d115ee/kturn-cbc881ddbdddbca0715affc2042437c75830a72393866364fa0c4dfbecf00eb3: SessionMessage/message session-message-f9c3b559bf397b39a97cf3bb9c1462fd513586232494f8f5dc9143dbd02eaac0 用户插话（消息 session-message-f9c3b559bf397b39a97cf3bb9c1462fd513586232494f8f5dc9143dbd02eaac0）： 插一句：先别改代码，继续等秘书回答你刚才的问题，拿到回答再 ｜ krun-34ab8d708ec2ed8ff292a37a5e7768b41ccc170e8f64090f9f3bba6c79d115ee/kturn-cbc881ddbdddbca0715affc2042437c75830a72393866364fa0c4dfbecf00eb3: SessionMessage/message session-message-e16866642d28a925ac723ad9bf61d2bef08c3cf04f84d60112f83615929f38d4 消息 session-message-e16866642d28a925ac723ad9bf61d2bef08c3cf04f84d60112f83615929f38d4，来自 平台，要回复：否，叫醒你：不会 中断通知 · Session se ｜ krun-2712003038fda1ef5cc38b5f6536c6e06be597f5879f8e7baebebf4da581a174/kturn-9b8fc6dc114977ab5eef806af8e0427465b8a236f0c40576c2109f476f64b4b8: SessionMessage/expiry session-message-8252098d2a04ff3bc7eae51c7066467bbf6b48f9b8bfa7c985af997358d82105 你的问题到截止时间还没有回复（消息 session-message-8252098d2a04ff3bc7eae51c7066467bbf6b48f9b8bfa7c985af997358d82105，截止 2026-11-27T07:40:0 ｜ krun-2712003038fda1ef5cc38b5f6536c6e06be597f5879f8e7baebebf4da581a174/kturn-9b8fc6dc114977ab5eef806af8e0427465b8a236f0c40576c2109f476f64b4b8: SessionMessage/message session-message-0c524208055a1e585eb5c684caafc11e12a36ebbca43770df7d3d679c6ff1211 消息 session-message-0c524208055a1e585eb5c684caafc11e12a36ebbca43770df7d3d679c6ff1211，来自 session-e7bbb0837dd0ffb5ffef333fe ｜ krun-2712003038fda1ef5cc38b5f6536c6e06be597f5879f8e7baebebf4da581a174/kturn-9b8fc6dc114977ab5eef806af8e0427465b8a236f0c40576c2109f476f64b4b8: SessionMessage/response session-message-3382fda59b97d25c5976f9c530ffd4c2a9599a8d2fdd449abfde4cdc94ed2e32 你的问题有了回复（消息 session-message-3382fda59b97d25c5976f9c530ffd4c2a9599a8d2fdd449abfde4cdc94ed2e32）。 你的问题： num.js 现在有哪些导出函数？（第 ｜ krun-c30f00123f7215dd935e09c3da1612da157d5cd9b14d71fbfe33fcdab1d10378/kturn-b0d453f8356d9231d5817b7d546a0f77369fedcd67c3553fd356d5e4ea313b5c: SessionMessage/response session-message-221b6f6f4d9043a70cf33240a35aa02acc195a9b62c9a53131955bfb0a64bec7 你的问题有了回复（消息 session-message-221b6f6f4d9043a70cf33240a35aa02acc195a9b62c9a53131955bfb0a64bec7）。 你的问题： README 的标题要不要改成中文？  ｜ krun-c30f00123f7215dd935e09c3da1612da157d5cd9b14d71fbfe33fcdab1d10378/kturn-b0d453f8356d9231d5817b7d546a0f77369fedcd67c3553fd356d5e4ea313b5c: SessionMessage/message session-message-07d87985b7a5862e5eac8771158830d3a7a4c7529bdf44e59938d34649c00b9e 消息 session-message-07d87985b7a5862e5eac8771158830d3a7a4c7529bdf44e59938d34649c00b9e，来自 session-e7bbb0837dd0ffb5ffef333fe
- 等待链 session-message-8252098d2a04ff3bc7eae51c7066467bbf6b48f9b8bfa7c985af997358d82105 → session-message-3382fda59b97d25c5976f9c530ffd4c2a9599a8d2fdd449abfde4cdc94ed2e32；结束方式 chain-over

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-27T06:03:07.701Z | A1 | core/completion-policies/read | not_found: project 10c51c5c6a90190c8a10d1cf88d4df59 has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-27T06:04:16.588Z | B1 | core/completion-policies/read | not_found: project g6-wb has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-27T06:07:14.033Z | E05 | tool submit_initial_plan (call call_20f25026c0b64f87b8cb1862) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:07:29.447Z | E05 | tool submit_initial_plan (call call_e47d77333e4444538fa4c844) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T06:07:41.688Z | E05 | tool submit_initial_plan (call call_ac0c46671ae14c7b82d576b7) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "setup0" | 无理由 | - | 待定 |
| 2026-11-27T06:09:58.685Z | E05 | core/plans/apply plans-apply-mwyl0om5-26 | invalid: the plan's checks c-only-readme cannot be installed, so the plan was not adopted: check c-only-readme is already installed in this workspace with other content, and a check id names one check in a workspace: give the new check another checkId, or propose the installed check unchanged | 产品规则 | - | 待定 |
| 2026-11-27T06:10:07.527Z | E08 | tool read (call call_9a16bcd3e7384673b4f86cb3) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T06:10:27.045Z | E08 | tool submit_initial_plan (call call_e9bd004f2bde4a739e5a28b8) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:10:38.000Z | E08 | tool submit_initial_plan (call call_580f2e8a96254be7aa9c4f45) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:10:58.725Z | E08 | core/goals/confirm-draft confirm-again-mwyl1yxx-31 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-27T06:10:58.735Z | E08 | core/goals/control goals-control-mwyl1yy7-32 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-27T06:11:08.906Z | E08 | tool list_files (call call_d0709d8f3b3444b09a672776) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-27T06:11:10.728Z | E08 | tool list_files (call call_91f0cf4479954f60a12a80c7) | execution_failed: ENOENT: no such file or directory, open '/proc/self/fd/27/test' | 无理由 | - | 待定 |
| 2026-11-27T06:11:48.047Z | E08 | tool edit (call call_e47e1d7d5746440fbfa2cfbd) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T06:11:50.782Z | E08 | tool list_files (call call_167e747414ff4c4a8271fe6f) | execution_failed: ENOENT: no such file or directory, open '/proc/self/fd/26/test' | 无理由 | - | 待定 |
| 2026-11-27T06:12:06.429Z | E08 | tool submit_plan_round (call call_8860a6ec2f084ef3b5a7553d) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:15:15.025Z | E09 | tool look_graph (call call_cbb76d943a754be680dbabef) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-27T06:15:52.589Z | E09 | tool submit_initial_plan (call call_07b60c8f4fee46098739a8ed) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:16:22.406Z | E09 | tool submit_initial_plan (call call_ab70734feaef4f44ab92d7fc) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined; setup.completionPolicy: Invalid input: expected object, received undefined; setup.checks.1.kind: Invalid option: expected one of "static"\|"dynamic"; setup.checks.4.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-27T06:16:39.049Z | E09 | tool submit_initial_plan (call call_b7befb68407241448c7d80c1) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:16:57.882Z | E09 | tool submit_initial_plan (call call_4f5b0fba42a84b9484c2d5df) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:17:08.889Z | E09 | tool submit_initial_plan (call call_0a0695abf4f34c7797bc814f) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:17:29.944Z | E09 | tool submit_initial_plan (call call_e24c08bbb8064eabac3a646c) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary"; goalCardDrafts: Invalid input: expected array, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:17:43.465Z | E09 | tool submit_initial_plan (call call_8138bf081a034a86a96ae1fa) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:18:04.122Z | E09 | tool submit_initial_plan (call call_093b709d23be4ef8a512d24a) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:18:16.641Z | E09 | tool submit_initial_plan (call call_20eaeca8179e4dc1b6941f07) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:18:54.589Z | E09 | tool submit_initial_plan (call call_6cd4dc95dcb8483b9a7c4807) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined; setup.checks.0.timeoutMs: Invalid input: expected number, received undefined; setup.checks.1.timeoutMs: Invalid input: expected number, received undefined; setup.checks.2.timeoutMs: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:19:06.493Z | E09 | tool submit_initial_plan (call call_98a483a473574e19be583e2b) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:19:37.771Z | E09 | tool run_readonly_command (call call_2a9332f866934d3782668969) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-27T06:19:55.973Z | E09 | tool list_files (call call_566b043ab56b485c96d44a70) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-27T06:19:56.424Z | E09 | tool run_readonly_command (call call_32c3d398364c4777a8f41100) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-27T06:19:57.987Z | E09 | tool read (call call_540732e9d33f4d5a9b6a8f7b) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T06:19:58.823Z | E09 | tool read (call call_70d9145d0f4845aca0c2eb28) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T06:20:15.064Z | E09 | tool edit (call call_8fc675369e604da89faa745b) | execution_failed: test/api.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T06:20:15.578Z | E09 | tool edit (call call_fa41212fb777498bb1b92f22) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:20:15.655Z | E09 | tool edit (call call_8b4d0ba10ccb403aadb1c4e0) | execution_failed: test/report.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T06:21:05.710Z | E12 | tool submit_initial_plan (call call_8d46cd55ef674fa497f080e2) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T06:21:16.833Z | E12 | tool submit_initial_plan (call call_72775eff2b45447fb6a72c58) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:21:28.744Z | E12 | tool submit_initial_plan (call call_74025701778440bb9e1b3b07) | invalid_arguments: 工具参数不符合 schema：setup.checks.0.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-27T06:21:37.757Z | E12 | tool submit_initial_plan (call call_7848b13412e34381a94af3f8) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:21:49.317Z | E12 | tool submit_initial_plan (call call_6e50607859bc47c8a0e231b5) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:22:35.467Z | E12 | tool edit (call call_17d264d2efc84988a8732597) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T06:55:42.798Z | iteration | tool submit_initial_plan (call call_17a0c37a59764a2a8b525e14) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "goalCardDraftsNote" | 无理由 | - | 待定 |
| 2026-11-27T06:55:52.745Z | iteration | tool submit_initial_plan (call call_4aca32a21c0a4d539fd67689) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:56:01.057Z | iteration | tool submit_initial_plan (call call_608a70c3d73e467c8488543e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T06:56:58.502Z | iteration | tool dispatch_task (call call_d85d0cd3aaef4ea48b3bf7d5) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-27T06:58:05.437Z | iteration | tool submit_plan_round (call call_da18a775b4074a0fb4566006) | invalid_arguments: 工具参数不符合 schema：checks.0.timeoutMs: Invalid input: expected number, received undefined; checks.1.timeoutMs: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T06:59:56.090Z | iteration | core/goals/control goals-control-mwymsxfe-61 | revision_conflict: the GoalPhase changed since the caller read it | 协调 | - | 待定 |
| 2026-11-27T07:00:15.540Z | intervention | tool submit_initial_plan (call call_7409cd11cd0344a0931dafb5) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T07:00:26.743Z | intervention | tool submit_initial_plan (call call_b3c485f8f5944bcbad19e93f) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T07:01:32.571Z | intervention | tool list_files (call call_e1e1096984d045f1bf36d3f2) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-27T07:01:33.501Z | intervention | tool read (call call-d81fd9e6-baaf-4097-ad67-53d83561966a) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T07:01:41.893Z | intervention | tool edit (call call_75bd54697b4847f3a7e01656) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T07:03:09.416Z | intervention | tool submit_plan_round (call call_02ba98186f154820988aad0d) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T07:03:27.464Z | intervention | core/workflow/driver-start | busy: another collaboration advancement is already active for this Goal | 协调 | - | 待定 |
| 2026-11-27T07:04:03.111Z | intervention | tool read_session_message_body (call call_9ff8c6467e1a4a3c952981d5) | execution_failed: the requested mailbox record does not exist | 无理由 | - | 待定 |
| 2026-11-27T07:04:22.756Z | intervention | tool edit (call call-822036f0-3951-41bb-b8ac-20bae82b910e) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-27T07:06:35.117Z | intervention | tool respond_session_message (call chatcmpl-tool-8869932d7c8df4ba) | forbidden: only the Host may settle this source | 无理由 | - | 待定 |
| 2026-11-27T07:06:35.160Z | intervention | tool respond_session_message (call chatcmpl-tool-bbb84d96ae1ffbf8) | invalid: 这条消息不要回复；要说话另发一条 | 无理由 | - | 待定 |
| 2026-11-27T07:36:03.851Z | waiting | tool submit_initial_plan (call call-475f82e6-01c8-4d03-9ea4-26bdebe29efc) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T07:44:12.026Z | waiting | core/sessions/archive-line sessions-archive-line-mwyodure-86 | busy: archive_wait_disposal_required: the Session is waiting for a continuation reply | 协调 | - | 待定 |
| 2026-11-27T08:14:40.128Z | waiting | tool edit (call call_8a088fd4b30d4e069d359f00) | execution_failed: test/triple.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T08:16:00.162Z | C-216 | tool submit_initial_plan (call call-5e92dbdd-d6d8-4378-a3db-dc86362f9f14) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan.obligations.0.verificationRequirements.0.requirementLevel: Invalid option: expected one of "required"\|"optional"; plan: Unrecognized key: "summary" | 产品规则 | - | 待定 |
| 2026-11-27T08:16:21.155Z | C-216 | tool submit_initial_plan (call call-41474da4-84b4-46e2-9557-06f195be868e) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T08:16:38.856Z | C-216 | tool submit_initial_plan (call call-3f8653f3-165a-4f6f-b60a-69a2b108fe9b) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T08:16:59.343Z | C-216 | tool submit_initial_plan (call call-eac0e950-e8de-43ca-bf00-85fa6594b1b2) | invalid_arguments: 工具参数不符合 schema：setup.checks.2.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-27T08:19:02.236Z | C-221 | tool read (call call-16c31b94-f105-4e85-8bbd-6ad77925ae5d) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T08:19:24.107Z | C-221 | tool submit_initial_plan (call call_1807254fd72e4078890c6e90) | invalid_arguments: 工具参数不符合 schema：plan: Invalid input: expected object, received null | 无理由 | - | 待定 |
| 2026-11-27T08:19:42.326Z | C-221 | tool submit_initial_plan (call call_93a922c962a144a796d9fce3) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "stages_dummy" | 无理由 | - | 待定 |
| 2026-11-27T08:19:53.547Z | C-221 | tool submit_initial_plan (call call_a71fda6f8a654206acbe0f9b) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T08:21:55.808Z | C-221 | tool edit (call call_06f12aac78e7477bac0fe608) | execution_failed: test/fizzbuzz.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T08:22:40.328Z | C-222 | tool look_graph (call call-c5ef2c8d-8c74-4cc8-8424-1a154a07dd20) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-27T08:23:03.368Z | C-222 | tool submit_initial_plan (call call_aa491275736f4304afe6f2d4) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T08:23:19.445Z | C-222 | tool submit_initial_plan (call call_f657d81a69c542de85dea73d) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T08:23:31.593Z | C-222 | tool submit_initial_plan (call call_1ec0bd80ea5242e383e30204) | invalid_arguments: 工具参数不符合 schema：setup.checks.0.kind: Invalid option: expected one of "static"\|"dynamic"; setup.checks.1.kind: Invalid option: expected one of "static"\|"dynamic" | 无理由 | - | 待定 |
| 2026-11-27T08:25:30.038Z | C-222 | tool edit (call call_e374a69263864a3a9142a07d) | execution_failed: test/shapes.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T08:25:34.606Z | C-222 | tool edit (call call_7b635ba79ea4410c9852e3cd) | execution_failed: test/shapes.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T08:25:39.419Z | C-222 | tool edit (call call_282a26c37617491a8f38e3e7) | execution_failed: test/shapes.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T08:26:22.505Z | B06 | tool look_graph (call call-7516a0a9-74ac-44fb-b820-8acd23fb7ec3) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-27T08:26:46.673Z | B06 | tool submit_initial_plan (call call-f9ac94aa-92dd-4895-8ded-87488813eff1) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T08:27:01.389Z | B06 | tool submit_initial_plan (call call-c387fc2b-80be-46d8-bcba-09d3da5da687) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T08:27:52.033Z | B06 | tool record_note (call call_373c1f2c2ac44c65853d2c9a) | invalid_arguments: 工具参数不符合 schema：anchor: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T08:29:39.442Z | B06 | tool look_graph (call call_faffa4d975ad4694a1413ef6) | not_found: the Plan declares no input o-read for this consumer | 无理由 | - | 待定 |
| 2026-11-27T08:30:40.351Z | B06 | tool submit_initial_plan (call call_a3bad8dccff143dd915dc2b9) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T08:30:54.562Z | B06 | tool submit_initial_plan (call call_165dd2dfc8374c47a3c962ca) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T08:31:38.055Z | B06 | tool shell (call call-708d18a7-9034-4b1b-8a5c-78488dc6d783) | execution_failed: shell 退出码 128 | 无理由 | - | 待定 |
| 2026-11-27T08:32:28.157Z | E08b | tool read (call call-0c93eb0c-b573-4562-b3fd-cd10b2bd1f85) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T08:32:28.324Z | E08b | tool run_readonly_command (call call-a4915b86-c1e6-4d18-96c4-49b03bef4acd) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-27T08:32:59.408Z | E08b | tool submit_initial_plan (call call-6f26c376-10d5-44a9-925b-3ba1f2610862) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T08:34:24.995Z | E08b | tool dispatch_task (call call-d99354cb-f8b8-4586-87bf-c898aacf285b) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-27T08:34:25.035Z | E08b | tool dispatch_task (call call-45e9bd40-c3eb-4287-a407-ee634096a4d2) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-27T08:34:25.834Z | E08b | tool edit (call call_043ebd1c3ed94c2ca3d8e9d1) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T08:34:28.297Z | E08b | tool edit (call call_b71f5de17eca448b8f612548) | execution_failed: calc.js 已被其他操作修改 | 无理由 | - | 待定 |
| 2026-11-27T08:34:38.887Z | E08b | tool look_graph (call call-def84aaa-7269-44fa-8781-065f52968cb5) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "limit" | 无理由 | - | 待定 |
| 2026-11-27T08:34:47.099Z | E08b | tool edit (call call_5c9bd33ea31f44a6b84b7493) | execution_failed: calc.js 已被其他操作修改 | 无理由 | - | 待定 |
| 2026-11-27T08:34:59.204Z | E08b | tool respond_session_message (call call-3a11e699-d22f-43c6-8bcb-c73ffc201070) | forbidden: 这条消息由这一轮的结论回复；要先说进度，另发一条不要回复的 | 无理由 | - | 待定 |
| 2026-11-27T08:35:09.185Z | E08b | tool read_session_message (call call_9b73298466ab44f996e4b941) | forbidden: this message is not addressed to or sent by the caller Session | 无理由 | - | 待定 |
| 2026-11-27T08:35:49.202Z | E08b | tool look_graph (call call_d102c6a2c53f4f5e8ad803d6) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-27T08:36:08.423Z | E08b | tool record_note (call call_7e65930cb1f244ce9ecd934d) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized keys: "expectedVersion", "noteId" | 无理由 | - | 待定 |
| 2026-11-27T08:37:39.457Z | E08b | tool read_user_decision (call call-4b2eb438-e23f-467f-9f2d-397c5fe5560c) | invalid_arguments: 工具参数不符合 schema：source: Invalid input: expected object, received array; (根): Unrecognized keys: "kind", "pins", "subject" | 无理由 | - | 待定 |
| 2026-11-27T08:37:44.366Z | E08b | tool read_user_decision (call call-cd48c171-97e2-4c3d-be1f-c0307874acc2) | forbidden: a query round reads only the answer of an ask_person card its own line sent | 无理由 | - | 待定 |
| 2026-11-27T08:43:51.233Z | compaction | tool run_readonly_command (call call-df5c1184-004e-4016-8332-865a4328d7e6) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-27T08:47:23.196Z | compaction | tool submit_initial_plan (call call_b59337c51b614cac8fd74b0c) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined; setup.architecture.catalog: Unrecognized key: "dependencies_placeholder"; setup: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T08:47:41.069Z | compaction | tool submit_initial_plan (call call_da1c77df94b44756b39287bb) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined; setup: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T08:47:53.825Z | compaction | tool submit_initial_plan (call call_2845f0da2de34c2eb8672aac) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T08:48:08.777Z | compaction | tool submit_initial_plan (call call_2d38435a861848a3922bdc4b) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 62759470-3b46-4819-9466-865131029bab）
- usage（C-214）：pass。usageStatus reported，输入 32620，输出 91，缓存命中 30336
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 91 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"62759470-3b46-4819-9466-865131029bab","reservedOutput":131072,"usageStatus":"reported","inputTokens":32620,"outputTokens":91,"cachedInputTokens":30336}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- 证据：{"startedAt":"2026-11-27T06:03:05.084Z","cliConfigPath":"wa/workbench-config.json","model":{"modelId":"smoke-deepseek","provider":"deepseek","model":"deepseek-flash","baseUrlHost":null,"credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"be86de17285dbd8a"},"requests":[{"requestId":"62759470-3b46-4819-9466-865131029bab","reservedOutput":131072,"usageStatus":"reported","inputTokens":32620,"outputTokens":91,"cachedInputTokens":30336}],"settled":true,"endedAt":"2026-11-27T06:04:13.949Z","project":{"name":"a1","root":"/home/han001/g6-run-1127c/wa/projects/a1","scope":{"projectId":"10c51c5c6a90190c8a10d1cf88d4df59","workspaceId":"f892e1e8728b80d4e6be78c71b39e3f2"},"initial":{"gitHead":"0afceb70f49bf9cf577815d4af75d9099db7b4b4","dirty":false,"snapshotHash":"166905d174d57ccb13a03349ba18c9080cb38db1e55f369b3a2ecdec5ee8a2a0"}}}

### B1：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 5483ea04-ae16-4ae1-b0cc-687abd1a4f0a）
- usage（C-214）：pass。usageStatus reported，输入 12854，输出 98，缓存命中 10752
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 98 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"5483ea04-ae16-4ae1-b0cc-687abd1a4f0a","reservedOutput":64000,"usageStatus":"reported","inputTokens":12854,"outputTokens":98,"cachedInputTokens":10752},{"requestId":"6d7952a2-f440-476c-8cea-0f6a9e999046","reservedOutput":63902,"usageStatus":"reported","inputTokens":13891,"outputTokens":83,"cachedInputTokens":12928},{"requestId":"d536c062-1b14-4545-a0b7-932dac20f273","reservedOutput":63819,"usageStatus":"reported","inputTokens":14416,"outputTokens":91,"cachedInputTokens":13952},{"requestId":"217b7b19-4261-4a32-b7bf-33d88d5f5bc2","reservedOutput":63728,"usageStatus":"reported","inputTokens":15076,"outputTokens":100,"cachedInputTokens":14464},{"requestId":"fc7a6804-2ac3-4f23-a15b-86636ce76545","reservedOutput":63628,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request fc7a6804-2ac3-4f23-a15b-86636ce76545: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)
- 证据：{"startedAt":"2026-11-27T06:04:13.950Z","cliConfigPath":"wb/workbench-config.json","model":{"modelId":"smoke-deepseek","provider":"deepseek","model":"deepseek-flash","baseUrlHost":null,"credentialConfigured":true,"promptPack":null,"contextWindowTokens":128000,"perResponseTokens":64000,"cumulativeTokenBudget":64000,"settingsHash":"33c62ae32fe24a12"},"requests":[{"requestId":"5483ea04-ae16-4ae1-b0cc-687abd1a4f0a","reservedOutput":64000,"usageStatus":"reported","inputTokens":12854,"outputTokens":98,"cachedInputTokens":10752},{"requestId":"6d7952a2-f440-476c-8cea-0f6a9e999046","reservedOutput":63902,"usageStatus":"reported","inputTokens":13891,"outputTokens":83,"cachedInputTokens":12928},{"requestId":"d536c062-1b14-4545-a0b7-932dac20f273","reservedOutput":63819,"usageStatus":"reported","inputTokens":14416,"outputTokens":91,"cachedInputTokens":13952},{"requestId":"217b7b19-4261-4a32-b7bf-33d88d5f5bc2","reservedOutput":63728,"usageStatus":"reported","inputTokens":15076,"outputTokens":100,"cachedInputTokens":14464},{"requestId":"fc7a6804-2ac3-4f23-a15b-86636ce76545","reservedOutput":63628,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}],"settled":true,"endedAt":"2026-11-27T06:05:30.487Z","project":{"name":"b1","root":"/home/han001/g6-run-1127c/wb/projects/b1","scope":{"projectId":"g6-wb","workspaceId":"g6-wb-ws"},"initial":{"gitHead":"f61e6727e3f993070a87a78af2ecbb7acfbdf111","dirty":false,"snapshotHash":"166905d174d57ccb13a03349ba18c9080cb38db1e55f369b3a2ecdec5ee8a2a0"}}}

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImIwZGI3OGQyMjhhYTBjZTE2ZDY5YmQwYWRhZWUwNjVkIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zZTY2YjVkYzNjZTgzYzg4MDc2OTUxZmY2YWE2ZGFlNGRhZjk3MTllYTkzNzA5YzlmMTM5ZWI3ZDIyNTk1OTMwIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC01MGM2MDdhZjg3ODFkOTdlMDQ5MGFiMTI2ZTNmNjAzNCIsImsiOiJzZXNzaW9uLTNlNjZiNWRjM2NlODNjODgwNzY5NTFmZjZhYTZkYWU0ZGFmOTcxOWVhOTM3MDljOWYxMzllYjdkMjI1OTU5MzAiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjQ1fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImIwZGI3OGQyMjhhYTBjZTE2ZDY5YmQwYWRhZWUwNjVkIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zZTY2YjVkYzNjZTgzYzg4MDc2OTUxZmY2YWE2ZGFlNGRhZjk3MTllYTkzNzA5YzlmMTM5ZWI3ZDIyNTk1OTMwIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC01MGM2MDdhZjg3ODFkOTdlMDQ5MGFiMTI2ZTNmNjAzNCIsImsiOiJzZXNzaW9uLTNlNjZiNWRjM2NlODNjODgwNzY5NTFmZjZhYTZkYWU0ZGFmOTcxOWVhOTM3MDljOWYxMzllYjdkMjI1OTU5MzAiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjc0fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImIwZGI3OGQyMjhhYTBjZTE2ZDY5YmQwYWRhZWUwNjVkIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zZTY2YjVkYzNjZTgzYzg4MDc2OTUxZmY2YWE2ZGFlNGRhZjk3MTllYTkzNzA5YzlmMTM5ZWI3ZDIyNTk1OTMwIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC01MGM2MDdhZjg3ODFkOTdlMDQ5MGFiMTI2ZTNmNjAzNCIsImsiOiJzZXNzaW9uLTNlNjZiNWRjM2NlODNjODgwNzY5NTFmZjZhYTZkYWU0ZGFmOTcxOWVhOTM3MDljOWYxMzllYjdkMjI1OTU5MzAiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjkwfQ:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImIwZGI3OGQyMjhhYTBjZTE2ZDY5YmQwYWRhZWUwNjVkIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zZTY2YjVkYzNjZTgzYzg4MDc2OTUxZmY2YWE2ZGFlNGRhZjk3MTllYTkzNzA5YzlmMTM5ZWI3ZDIyNTk1OTMwIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC01MGM2MDdhZjg3ODFkOTdlMDQ5MGFiMTI2ZTNmNjAzNCIsImsiOiJzZXNzaW9uLTNlNjZiNWRjM2NlODNjODgwNzY5NTFmZjZhYTZkYWU0ZGFmOTcxOWVhOTM3MDljOWYxMzllYjdkMjI1OTU5MzAiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjQ1fQ）1973 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 62adfddf-c124-4273-8481-e5489af3cdae：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 62adfddf-c124-4273-8481-e5489af3cdae：输入 35650，缓存命中 27648（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01
- 证据：{"startedAt":"2026-11-27T08:43:32.601Z","cliConfigPath":"compaction/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"cf90863834784739"},"settled":true,"endedAt":"2026-11-27T08:48:34.598Z","project":{"name":"compaction","root":"/home/han001/g6-run-1127c/compaction/projects/compaction","scope":{"projectId":"b0db78d228aa0ce16d69bd0adaee065d","workspaceId":"ac4844ff24cbd541788367ce37df01f1"},"initial":{"gitHead":"f9ef60c7ac712f20f79b866b4cf932d8346f2890","dirty":false,"snapshotHash":"9b653292ac80696b7e427d719f932760c65af0e7d4342e939d865d6a866db77b"}}}

### C-216：pass

- observed-start（C-216）：pass。采用前观察 2026-11-27T08:14:59.374Z（{"aggregateType":"ObservedArchitecture","projectId":"cfeb63cceeb00242e691b174b51fcc1d","workspaceId":"650bc6f1a4578cb66e4e041649e4326f","captureId":"85e0feab-6252-4089-b180-db0f98f7baf1"}）；候选 3 个模块、路径 src/store.js, src/report.js, test/store.test.js（inventory-initial）；采用版 {"aggregateType":"ArchitectureBaselineRevision","projectId":"cfeb63cceeb00242e691b174b51fcc1d","baselineId":"inventory-initial","revision":1}：3 个模块、3 个路径：src/store.js, src/report.js, test/store.test.js；覆盖种子文件：src/store.js
- adopted-done（C-216）：pass。Goal COMPLETED
- cold start: round 1d4f6430-1815-4104-a0ef-0db4393d1965 asked the person questions (needs_decision) instead of a plan; the person answered on the request
- 证据：{"startedAt":"2026-11-27T08:14:58.005Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"d4cae4ccc63a93a6"},"userCommand":["接手这个已有项目：先看现状，再加一个 remove(sku, count)（不能减到负数），并加测试。验收：node --test 通过。","按你推荐的做法；没提到的按最简单的处理"],"draftAutonomy":"after_plan_confirmation","c216":{"candidate":{"modules":3,"paths":["src/store.js","src/report.js","test/store.test.js"],"version":"inventory-initial"},"adoptedPaths":["src/store.js","src/report.js","test/store.test.js"],"adoptedModules":3,"baselineRef":{"aggregateType":"ArchitectureBaselineRevision","projectId":"cfeb63cceeb00242e691b174b51fcc1d","baselineId":"inventory-initial","revision":1},"observationRead":"ready","observedAt":"2026-11-27T08:14:59.374Z","covered":"src/store.js"},"settled":true,"endedAt":"2026-11-27T08:18:55.267Z","project":{"name":"c216","root":"/home/han001/g6-run-1127c/w-accept/projects/c216","scope":{"projectId":"cfeb63cceeb00242e691b174b51fcc1d","workspaceId":"650bc6f1a4578cb66e4e041649e4326f"},"initial":{"gitHead":"ab62bce6e8f1ec5a3d689bbbcfa391d4c57e1134","dirty":false,"snapshotHash":"e6c2abc9b9dcc92cbfb86a7501993ee9129a31b49d72228017bd01b1b7b0f3df"}}}

### C-221：uncovered

- first-plan（C-221）：pass。首案采用 initial-plan-9b5cb287fe2cf3d01d9457b90c3e907a
- fail-rework（C-221）：uncovered (not-run)。没有同一 Task 上“检查轮 FAIL → 返工的新 Run → 检查轮 PASS”这条链（真实模型一次做对，不伪造失败）
- delivered（C-221）：pass。Goal COMPLETED
- 证据：{"startedAt":"2026-11-27T08:18:55.268Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"cf9a9cdddb841e4f"},"draftAutonomy":"after_plan_confirmation","settled":true,"endedAt":"2026-11-27T08:22:33.094Z","project":{"name":"c221","root":"/home/han001/g6-run-1127c/w-accept/projects/c221","scope":{"projectId":"0b454227e90a8f394218541a5c8ef614","workspaceId":"62d5f52dfe4d09ff56f9448150fecea2"},"initial":{"gitHead":"2c73122ee3881102ca9a0e0ed0c89258cac0ff72","dirty":false,"snapshotHash":"c8f388a8981813c942423aca14eec9bc455639abe417d638f380f0893af09512"}}}

### C-222：fail

- created（C-222）：fail。secretaryCreated 的线：无
- started（C-222）：fail。建出的线上 Run：无；Goal COMPLETED；null
- 证据：{"startedAt":"2026-11-27T08:22:33.094Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"0a81477f9a95742b"},"draftAutonomy":"after_plan_confirmation","settled":true,"endedAt":"2026-11-27T08:26:13.076Z","project":{"name":"c222","root":"/home/han001/g6-run-1127c/w-accept/projects/c222","scope":{"projectId":"b6233ba3052f3f256e490a5c6e46e233","workspaceId":"51b4765ca28d16d584906020e6400cf0"},"initial":{"gitHead":"741818b8be7b73ea127dff429d5c001e86d04c91","dirty":false,"snapshotHash":"5402ffdc7b0a787ac0981924849dccb29df17e242be8780408e6343af23c0bac"}}}

### B06：pass

- W1a（B06-W1a）：pass。witness PASS/matched；Task satisfied；Goal PAUSED；报告 367 字
- W2（B06-W2）：pass。witness FAIL；Task running
- W3（B06-W3）：pass。witness FAIL；Task failed
- W5（B06-W5）：pass。非 Git：witness INCONCLUSIVE/matched；Task blocked
- W10（B06-W10）：pass。witness PASS，witness 要求由 platform:witness 覆盖：true；reviewer 要求 pass，覆盖它的检查 无（由独立审阅回答）；Task satisfied
- W12（B06-W12）：pass。四段：task 有 → round 有 → evidence 1 → material keys reportText,roundRef,subjectRunRef
- explore（B06-cond3）：pass。没写 witness 要求的 explore：计划被收下，轮 finalized，没有 platform:witness 检查
- cancel e4c58bcb-9e02-4b7e-a0a5-f7075a50e849: submit committed, deliver ready  
- cancel 14aa5f1d-de6d-4bd6-91ef-8a3b0a731d23: submit committed, deliver ready  
- B06-W1b、W4、W6、W8、W11、W13 和条件 1 引 B06 G2 的绿测（f580d77e，决定 121-122），G6 不重跑；第 9 片审阅的通过不写成 B06 通过。
- 证据：{"startedAt":"2026-11-27T08:26:13.078Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"bfa6c47b8864eb19"},"draftAutonomy":"after_plan_confirmation","settled":true,"endedAt":"2026-11-27T08:32:22.350Z","project":{"name":"b06","root":"/home/han001/g6-run-1127c/w-accept/projects/b06","scope":{"projectId":"61eaa75197420d7cf67acb5a5f9499ff","workspaceId":"49b440ed3baabd35fcc2d81ac05ffc29"},"initial":{"gitHead":"ddc3d8b53b6b34221d78d3ed989b9160764480ac","dirty":false,"snapshotHash":"0f17aae36aea5d621c9cf0af34c8c7321d927e5a086d41cb4415d26c9910d38c"}}}

### E08b：uncovered

- sub-running（C-210）：pass。提交改需求时 sub（t-sub）的 Run 7bbaeebc-b3ff-4224-be31-bd6bef9a1573 正在跑（开始于 2026-11-27T08:34:20.389Z）
- stop-delivered（C-210）：uncovered (not-run)。没有读到可采用的候选。问题或探针不构成候选，没有发生采用，这一支没走到；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；叫停请求 released；sub 的 Run completed @ 2026-11-27T08:35:04.013Z
- safe-point-end（C-210）：uncovered (not-run)。没有读到可采用的候选。问题或探针不构成候选，没有发生采用，这一支没走到；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；叫停请求 released；sub 的 Run completed @ 2026-11-27T08:35:04.013Z
- adopt-after-end（C-210）：uncovered (not-run)。没有读到可采用的候选。问题或探针不构成候选，没有发生采用，这一支没走到；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；叫停请求 released；sub 的 Run completed @ 2026-11-27T08:35:04.013Z
- E08b 改需求的轮：?:request/ideas 0
- while the change candidate was written the person answered message card {"kind":"message","messageRef":{"aggregateType":"SessionMessage","messageId":"session-message-050182bb13bb887966cab138c2959809454962aac6a248935475305b6fa546e6","projectId":"3283298eb3f52259e53c1a3c3d878f06","workspaceId":"dbd3420413c03bcf6cc738b7f1b797f1"}}
- 改需求没有候选：the request's last round b49ac3c3-76d0-46ad-a43d-188b06c8474c ended without a candidate and no Query ran for 5 min
- goal-confirm:goal.confirmDraft:1a1bc29c1b2f0850753e727d155d2e0b17ce533557e3dc1694afca4f56159bbf (RUNNING): pause because E08b ended: committed
- 证据：{"startedAt":"2026-11-27T08:32:22.351Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"7a41b78cebf1d89c"},"userCommand":["分两个独立任务：一是在 calc.js 加 sub(a, b) 并加 test/sub.test.js；二是在 calc.js 加 mul(a, b) 并加 test/mul.test.js。验收：node --test 全部通过。","改目标和验收：不要 sub 了（取消那个任务和它的验收）；改为加 div(a, b)，b 为 0 时抛 RangeError，并加 test/div.test.js。mul 照旧。"],"draftAutonomy":"after_plan_confirmation","e08b":{"rounds":[{"roundRef":{"aggregateType":"QueryJob","projectId":"3283298eb3f52259e53c1a3c3d878f06","workspaceId":"dbd3420413c03bcf6cc738b7f1b797f1","queryJobId":"aed068f4-4111-4f4f-b649-69ac0df3c93a"},"kind":"request","status":"ended","ideas":0,"selectedIdea":null,"closeCode":"invalid_answer","kernel":{"adapterId":"host-settings-kernel-311ee1259bdf2add504c99512e89f1ba","kernelSessionId":"session-6b8dac9b7ac04501f7675ae21c0a375722981b98c9daab62894b78fc47970c6c","runId":"krun-7c3571111b5bbee770eab4f7a46c658fe7230687ced09e7d37c28839d9db5559","turnId":"kturn-3c6496465de03943a0fb63bb1829067043638938bbb59bfe9000e9093ce74d95"},"tools":["ask_copy","ask_person","check_links","code_index","cpp_index","create_member","dispatch_task","find_graph","hold_claim","list_files","look_graph","notify_person","project_source","python_index","query_ready_tasks","query_task_graph","read","read_requests","read_session_inbox","read_session_message","read_session_message_body","read_user_decision","record_note","release_hold","request_stop","respond_session_message","run_readonly_command","search","send_session_message","source_excerpt","submit_plan_round","submit_secretary_answer","symbols","web_fetch","web_search","withdraw_session_message"],"toolsGap":null,"read":{"queries":"ready","history":"ready"},"calls":[{"name":"query_ready_tasks","status":"tool.completed"},{"name":"request_stop","status":"tool.completed"},{"name":"run_readonly_command","status":"tool.completed"},{"name":"ask_person","status":"tool.completed"}],"refusals":[]}],"evidenceGaps":[],"selectIdea":null,"candidate":{"readable":true,"status":"closed","proposalRef":null,"task":null}},"settled":true,"endedAt":"2026-11-27T08:43:30.935Z","project":{"name":"e08b","root":"/home/han001/g6-run-1127c/w-accept/projects/e08b","scope":{"projectId":"3283298eb3f52259e53c1a3c3d878f06","workspaceId":"dbd3420413c03bcf6cc738b7f1b797f1"},"initial":{"gitHead":"4f8c01836497e7aac7a72ef44e1d58df981c4647","dirty":false,"snapshotHash":"a8c68975ea91eeffb929240b8e8cf424a62eac7f17cf98666979c836de80e98e"}}}

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 20930690（输入 20635495，输出 295195；缓存命中 17743360）；Query 请求 307 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 36 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：20424732；估算部分 210763。
- 超预算退出：整轮 没有；按场景/格 没有。
- A1：用量 32711（输入 32620，输出 91，缓存命中 30336；Query 请求 1（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 32620）
- B1：用量 56609（输入 56237，输出 372，缓存命中 52096；Query 请求 5（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 56237）
- E05：用量 1129396（输入 1110148，输出 19248，缓存命中 906496；Query 请求 19（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1110148）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 0）
- E08：用量 1269349（输入 1254998，输出 14351，缓存命中 1038976；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1254998）
- E09：用量 2143625（输入 2098628，输出 44997，缓存命中 1812224；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 2098628）
- E12：用量 748271（输入 733689，输出 14582，缓存命中 601344；Query 请求 14（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 733689）
- iteration：用量 1399787（输入 1378144，输出 21643，缓存命中 1163520；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1378144）
- intervention：用量 3507529（输入 3471268，输出 36261，缓存命中 2975744；Query 请求 44（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5；实报输入 3471268）
- waiting：用量 1373533（输入 1346879，输出 26654，缓存命中 1073152；Query 请求 16（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 5；实报输入 1212566）
- C-216：用量 667552（输入 651858，输出 15694，缓存命中 515072；Query 请求 14（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 651858）
- C-221：用量 814797（输入 800959，输出 13838，缓存命中 636032；Query 请求 12（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 800959）
- C-222：用量 819069（输入 806229，输出 12840，缓存命中 683136；Query 请求 13（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 806229）
- B06：用量 2042071（输入 2019536，输出 22535，缓存命中 1855360；Query 请求 28（其中按未计费 0 计的 2：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 11；实报输入 1943086）
- E08b：用量 3965043（输入 3936189，输出 28854，缓存命中 3564672；Query 请求 41（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 3936189）
- compaction：用量 961348（输入 938113，输出 23235，缓存命中 835200；Query 请求 24（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 938113）
- P6 记账：模型调用 525 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）24 个，其中只回“收到”的 3 个（成功的工具调用只有读类和答复，且答复的都不是要回复的信，没交候选、没发信、没出卡；裁定 Q11、lead 11-25 #31，只计数不判；回复对象读不到的照旧计数，见其它记录）。
- A1：模型调用 1，叫醒轮 1，只回收到 1
- B1：模型调用 5，叫醒轮 1，只回收到 1
- E05：模型调用 28，叫醒轮 2，只回收到 0
- E08：模型调用 35，叫醒轮 1，只回收到 0
- E09：模型调用 50，叫醒轮 1，只回收到 0
- E12：模型调用 22，叫醒轮 1，只回收到 0
- iteration：模型调用 34，叫醒轮 1，只回收到 0
- intervention：模型调用 86，叫醒轮 4，只回收到 0
- waiting：模型调用 34，叫醒轮 4，只回收到 1
- C-216：模型调用 19，叫醒轮 1，只回收到 0
- C-221：模型调用 24，叫醒轮 1，只回收到 0
- C-222：模型调用 24，叫醒轮 1，只回收到 0
- B06：模型调用 62，叫醒轮 3，只回收到 0
- E08b：模型调用 80，叫醒轮 2，只回收到 0
- compaction：模型调用 21，叫醒轮 0，只回收到 0

## 延迟探针

- wa#0：{"startedAt":"2026-11-27T06:03:05.122Z","writtenAt":"2026-11-27T06:04:13.937Z","samples":3371,"p50Ms":20.89,"p95Ms":21.81,"p99Ms":28.69,"maxMs":372.51,"meanMs":21.53}；关闭 SIGINT, exit 0 after 49 ms
- wb#0：{"startedAt":"2026-11-27T06:04:14.016Z","writtenAt":"2026-11-27T06:05:30.476Z","samples":3832,"p50Ms":20.91,"p95Ms":21.97,"p99Ms":32.49,"maxMs":259.39,"meanMs":21.53}；关闭 SIGINT, exit 0 after 35 ms
- w-accept#0：{"startedAt":"2026-11-27T06:05:30.530Z","writtenAt":"2026-11-27T07:38:18.377Z","samples":282276,"p50Ms":20.69,"p95Ms":21.97,"p99Ms":23.12,"maxMs":750.26,"meanMs":21.32}；关闭 SIGINT, exit 0 after 771 ms
- w-accept#1：{"startedAt":"2026-11-27T07:41:08.560Z","writtenAt":"2026-11-27T08:43:32.541Z","samples":187977,"p50Ms":20.76,"p95Ms":22.05,"p99Ms":29.9,"maxMs":1135.61,"meanMs":21.61}；关闭 SIGINT, exit 0 after 516 ms
- compaction#0：{"startedAt":"2026-11-27T08:43:32.838Z","writtenAt":"2026-11-27T08:48:34.571Z","samples":15466,"p50Ms":20.33,"p95Ms":21.84,"p99Ms":22.15,"maxMs":509.61,"meanMs":21.08}；关闭 SIGINT, exit 0 after 67 ms

## 其它记录

- 2026-11-27T06:04:13.842Z A1: g6-a1-mwykrvjj-4 (BLOCKED): pause because wa closes: committed
- 2026-11-27T06:05:30.390Z B1: g6-b1-mwyktcpj-15 (BLOCKED): pause because wb closes: committed
- 2026-11-27T06:05:30.413Z B1: B1: request fc7a6804-2ac3-4f23-a15b-86636ce76545 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-27T07:41:14.833Z waiting: waiting: request 6dc90a72-b735-4133-829a-e6cefb5c6db7 counted at its reservation 134313+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-27T08:28:50.588Z B06: B06: Run e4c58bcb-9e02-4b7e-a0a5-f7075a50e849 counted with its reported part only, the rest 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-27T08:30:45.939Z B06: B06: Run 14aa5f1d-de6d-4bd6-91ef-8a3b0a731d23 counted with its reported part only, the rest 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-27T08:48:34.599Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
