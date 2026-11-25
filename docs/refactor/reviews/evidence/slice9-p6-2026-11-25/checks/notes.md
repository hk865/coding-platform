# G6 notes 2026-11-24（运行号 g6-2026-11-24-46014f5e）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 466070（含缓存命中），输出 8272，缓存命中 355200，Query 请求 15。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| gate | C-185 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| paths | C-185, C-217 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| kept | C-185 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| single-occupancy | C-71 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| convention | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| duplicates | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| reviewer | C-208, C-218 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| name-different | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| name-same | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| temporary | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |
| line-choice | C-73, C-191 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step) |

- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason suggestion_committed: the repeated pass performs no step)
- goal-confirm:goal.confirmDraft:824bc5eeafff30d2fb204243a58e9b273e8d411570701ad440491258c36b1543 (RUNNING): pause because E05 ended: committed

### E06：uncovered

- C 行：C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 0（含缓存命中），输出 0，缓存命中 0，Query 请求 0。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| handoff | C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| successor-input | C-75, C-209, C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| successor-frontier | C-75 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| no-restatement | C-209 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| excluded-path | C-209 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| same-task-new-run | C-135 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| history-continuity | C-106, C-194 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| restart-running | C-149 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| restart-paused | C-151 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| archive | C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| hand-or-drop | C-223 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| wake | C-68, C-181 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |

- stopped: not-run: E05 left no project/work line to continue

### E08：fail

- C 行：C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210；自治档 `every_step`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2084121（含缓存命中），输出 30854，缓存命中 1827328，Query 请求 29。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-b7dc668c72f4760acaeb7da89be16461；Goal 指针 {"aggregateType":"PlanRevision","projectId":"2b812ea3ebbf6f0ed6b3ad3d5f898988","planId":"initial-plan-b7dc668c72f4760acaeb7da89be16461"} |
| hold-before-adopt | C-210 | uncovered (not-run) | sub 在 mul 之前先被领了（提交改需求时 sub 已有 1 个 Run），“sub 可领、没开工时暂缓”这一支没走到 |
| versions | C-210 | pass | plans/versions 2 版；改目标的候选由人 plans/apply（committed，采用 {"aggregateType":"PlanRevision","projectId":"2b812ea3ebbf6f0ed6b3ad3d5f898988","planId":"initial-plan-bf1f6e05d2bf294ba0d9af8b58ebe567"}） |
| switch | C-210 | fail | div satisfied；sub active；mul satisfied；sub 的取消：采用版本的 dispositionRecord 里没有 sub 的记录 |
| old-evidence | C-210 | pass | 采用版本 initial-plan-bf1f6e05d2bf294ba0d9af8b58ebe567；div 必需要求 2 条：div 实现与测试/r-div-static(static):pass，覆盖（#1 判 d7e804e3-d426-42b6-9819-e018657d56ce，计划 initial-plan-bf1f6e05d2bf294ba0d9af8b58ebe567）；div 实现与测试/r-div-dynamic(dynamic):pass，覆盖（#1 判 d7e804e3-d426-42b6-9819-e018657d56ce，计划 initial-plan-bf1f6e05d2bf294ba0d9af8b58ebe567） |
| required-cancel | C-210 | uncovered (not-run) | 采用的版本 initial-plan-bf1f6e05d2bf294ba0d9af8b58ebe567 里没有被取消或接替的必需任务（sub active），这条判据没有对象 |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- first plan initial-plan-b7dc668c72f4760acaeb7da89be16461: sub = t-sub，mul = t-mul
- 提交改需求时：mul 0 个 Run（-），sub 1 个 Run；sub 的 dispatch.claimableNow null
- the person selected idea 1 of 3 on the change: 方案 A：换掉 sub → div，mul 保留（只加 1 个新任务，不新增清理步骤）
- requeue card t-sub (after Run 05b0c1ca-9a8d-4b11-a5c2-b63167188f7c): committed
- node review t-mul (calc.js, test/mul.test.js): committed
- node review t-sub (calc.js, test/sub.test.js): committed
- node review t-div (calc.js, test/div.test.js): committed

### E09：fail

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2504335（含缓存命中），输出 29897，缓存命中 2168064，Query 请求 21。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | pass | 执行者上报 session-message-f69a9ee5cb4ba2e5ed303cdc5533359e0277664688b71a410a683328bb0aca74（要回复的 send_session_message）：发件线 session-bd3f1e833b3b14024ff87329a48c639a92d3830860a534a5c11cb51284c1a0de（work_run）→ 收件线 session-89503e8d0c8db2743884a150f0a7a1d4fb5fb2fcfea9d58a8a39646062d3ccf0（参谋），needsReply true，answeredBy line；还没有答复；参数 {"needsReply":true,"recipient":{"projectId":"2a56a14218f3ba0ced0bb3475f712403","sessionId":"session-89503e8d0c8db2743884a150f0a7a1d4fb5fb2fcfea9d58a8a39646062d3ccf0"},"taskRef":{"goalId":"goal-confirm:goal.confirmDraft:5a285fb0688de3a1e1e791902a512336a402931e9c00e13fa0996383ab139068","projectId":"2a56a14218f3ba0ced0bb3475f712403","taskId":"T-B"},"text":"T-B 冲突回执（parseDate 返回值口径），请转人裁决。\n\n对象：src/api.js 的 parseDate(text)。\n- A 以及目标口径要求：返回 Date 对象（无效输入返回 Invalid Date，不抛异常）。已落地：`export function parseDate(text){ return new Date(text); }`。\n- B 的任务书原话要求：parseDate 返回 {y,m,d}，monthOf 按解构出的 m 取月份。\n影响面：api 的返回值口径，以及所有调用方/后续任务（T-TEST 的断言、T-GATE 的检查，任何以后 import parseDate 的模块）。若改成 {y,m,d}，A 的 parse-date 测试（断言 instanceof Date、Number.isNaN(getTime())）会失败，且无效输入无法用 Invalid Date 表达。\n\n可选项：\n1) 保持 Date（现状），report 内自行做 Date → {y,m,d} 转换（本次即采用，量最小，不改 api）；\n2) 保持 Date，另加 parseParts(text) 返回 {y,m,d} 作为新导出，供需要分量的调用方用；\n3) 由人决定把 parseDate 改成返回 {y,m,d}，同时必须改 A 的测试与所有调用方（影响最大，需重开 T-A）。\n\n已做的：src/report.js 已按 Date 口径实现并导出 monthOf(text)：import { parseDate } from './api.js'，Invalid Date 时返回 null，否则 getMonth()+1；未改动 src/api.js，未改 test/parse-date.test.js，只写了自己的 src/report.js（test/month-of.test.js 已在工作区存在，沿用未改）。\n验证：node --test 退出码 0，tests 5 / pass 5 / fail 0（含 monthOf 2 条、parseDate 3 条）。\n需要人定的是选 1 还是 2/3；不裁决的话当前代码即选项 1，冲突保持开放。","wake":true} |
| adviser-explains | C-211 | fail | 收到上报 session-message-f69a9ee5cb4ba2e5ed303cdc5533359e0277664688b71a410a683328bb0aca74 的参谋轮 1 个；最终答复或 ask_person/notify_person 正文同时点到 api.js 和 report.js 的：无 |
| person-decides | C-211, C-62 | pass | 2026-11-24T20:46:22.340Z 人答卡 {"kind":"message","messageRef":{"aggregateType":"SessionMessage","messageId":"session-message-02d17847c99c72db1a62b4b4231ad5d3ca7327eb58ab5e29c619d76925352379","projectId":"2a56a14218f3ba0ced0bb3475f712403","workspaceId":"af8884295e52be314cc9a1977c5bd119"}}（来源消息 session-message-02d17847c99c72db1a62b4b4231ad5d3ca7327eb58ab5e29c619d76925352379，答复 committed）；钉住 Goal 版本 3，另有对象 1 个：[{"ref":{"aggregateType":"Goal","projectId":"2a56a14218f3ba0ced0bb3475f712403","goalId":"goal-confirm:goal.confirmDraft:5a285fb0688de3a1e1e791902a512336a402931e9c00e13fa0996383ab139068"},"revision":3},{"ref":{"aggregateType":"PlanRevision","projectId":"2a56a14218f3ba0ced0bb3475f712403","planId":"initial-plan-a1334493a13ea65e59fdcc4d9fc15f1a"},"revision":1}] |
| new-version | C-211, C-55 | uncovered (not-run) | 当前计划 initial-plan-a1334493a13ea65e59fdcc4d9fc15f1a 的取消/接替记录（0 条）里没有一条来自卡 {"kind":"message","messageRef":{"aggregateType":"SessionMessage","messageId":"session-message-02d17847c99c72db1a62b4b4231ad5d3ca7327eb58ab5e29c619d76925352379","projectId":"2a56a14218f3ba0ced0bb3475f712403","workspaceId":"af8884295e52be314cc9a1977c5bd119"}} 答复轮的候选（plans/proposal 的 sourceMessageRef = session-message-02d17847c99c72db1a62b4b4231ad5d3ca7327eb58ab5e29c619d76925352379、sourcePart = decision_answer）：这次决定没有产生替换任务的新版本 |
| report-after-dispatch | C-185, C-211 | uncovered (not-run) | 同目标没有 agent 派活落实（任务卡 dispatch.request 没有 applied 的），这一支没走到 |
| diagnosis-reverify | C-211 | uncovered (not-run) | 3 个检查轮里没有一轮的重验以消息为依据（reverify.newInputRefs 没有 session_message），这一支没走到（可选） |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 5 条 finding；带路径的：package.json, README.md, src/report.js, test/, test/ |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"2a56a14218f3ba0ced0bb3475f712403","workspaceId":"af8884295e52be314cc9a1977c5bd119","captureId":"ca125a3e-78aa-440e-82ca-e9aa294a3636"} |
| observation-after-pass | C-98 | fail | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"2a56a14218f3ba0ced0bb3475f712403","workspaceId":"af8884295e52be314cc9a1977c5bd119","captureId":"ca125a3e-78aa-440e-82ca-e9aa294a3636"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"2a56a14218f3ba0ced0bb3475f712403","workspaceId":"af8884295e52be314cc9a1977c5bd119","captureId":"ca125a3e-78aa-440e-82ca-e9aa294a3636"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：T-A PASS/gaps 0, T-B PASS/gaps 0, T-TEST PASS/gaps 0 |
| uncovered-round | C-99 | uncovered (not-run) | 这次没有出现缺覆盖（INCONCLUSIVE）的检查轮 |

- goal-confirm:goal.confirmDraft:5a285fb0688de3a1e1e791902a512336a402931e9c00e13fa0996383ab139068: the draft chose every_step; set to after_plan_confirmation after adoption (committed )
- E09 Goal ended COMPLETED
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：uncovered

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1015946（含缓存命中），输出 13316，缓存命中 870656，Query 请求 16。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | pass | QueryRun 3→3，输入 393233→393233，changesHead h0000000922→h0000000922 |
| graph-cards | C-88, C-89 | pass | goal children 1，find 5，path 卡 有 |
| raw-history | C-42, C-157 | pass | 线的原历史 57 条，Run 历史 56 条 |
| completion-chain | C-104 | pass | 检查轮卡 2 张，有非空 evidenceRefs：true |
| restart-state | C-145, C-215 | pass | 重启后旧 Goal COMPLETED，计划 initial-plan-5ae9f79912d6eeafdca59031fadfaa50，Run 1/1 |
| reconcile | C-146 | pass | host/reconcile-report：lease owned |
| redrive-sets | C-155 | pass | 旧 Goal 的 causes：[] |
| new-goal | C-114, C-158 | pass | 新 Goal goal-confirm:goal.confirmDraft:354689f3ef8bd790174bc029e2840a0b3fee363917422dea3835623ea098f498（采用 committed，起步时 2 个任务都没满足）→ COMPLETED；旧 Goal 仍 COMPLETED |
| history-reuse | C-220 | uncovered (not-run) | 新 Goal 的 Run 没有一个成功的工具结果引用旧 Goal 或旧 Run（这次新工作没有查询已完成工作） |
| stale-premise | C-220 | uncovered (entry-missing) | 适用范围和“过期前提不升级”是模型对已查到事实的取舍，公开读口没有逐项可判的字段，不判通过 |
| replay | C-147 | pass | 同一 flowId 两次 driver-start：ready/ready，state running/running |
| wait-registry | C-207 | uncovered (entry-missing) | 目标等待登记表只在 Host 内存里，没有公开读口；重启后只能看到它的效果（等待的线被叫醒），看不到登记表本身 |

- restart: SIGINT, exit 0 after 128 ms
- goal-confirm:goal.confirmDraft:354689f3ef8bd790174bc029e2840a0b3fee363917422dea3835623ea098f498: the person selected idea 1 of 3 (A. 简单复刻：greet.js 里并排加 farewell + 独立测试文件)

### iteration：fail

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1364829（含缓存命中），输出 12529，缓存命中 1197696，Query 请求 18。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | fail | the platform did not do it: the platform stopped: no_new_basis on t1 |
| select | C-109 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |
| candidate | C-110 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |
| what-changed | C-213, C-110 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |
| per-request | C-111 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |
| why | C-112, C-226 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |
| continues | C-105 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |
| request-goal | C-107 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |
| cards-ask | C-113 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |
| multi-round | C-194 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on t1 |

- stopped: not-run: the platform stopped: no_new_basis on t1
- goal-confirm:goal.confirmDraft:f5322af07f4b728026918aa78d2e614214dbbc62e7f676336bcda3d9867216bd (NEEDS_DECISION): pause because iteration ended: committed

### intervention：fail

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2100215（含缓存命中），输出 32681，缓存命中 1870080，Query 请求 30。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | pass | 问一问 queued → answered；原线 Run ended/completed，输入含这个问题的轮 无；问件 session-message-0e63e92d83ed0a40c1c1cf92bb7bce82668b4b8e8ef2c630f2c9e7a39acb0372 answeredBy copy，送进 无 |
| delivery-states | C-189, C-192 | uncovered (not-run) | disposition 依次：offerable → answered（发送回执 sent）；发信时在跑的 Run 05c1fcf6-a892-4572-b185-f38e45ae564b；送进 无：不是忙线那一支（发信时在跑的 Run 在下一个安全点之前就结束了，消息走了无任务那一支，收尾为 answered） |
| busy-original-words | C-189, C-199 | uncovered (not-run) | disposition 依次：offerable → answered（发送回执 sent）；发信时在跑的 Run 05c1fcf6-a892-4572-b185-f38e45ae564b；送进 无：消息没有送进发信时在跑的 Run |
| continue-no-planning | C-199 | pass | 发送时线上当前任务 goal-confirm:goal.confirmDraft:f708a1701d80757007439029371e0b3debfa36dcf2fb712075155005c9a8d21c/t2 active/running；这条消息的 intervention_planning Query：没有 |
| planning-when-idle | C-199, C-200 | uncovered (not-run) | 长目标活跃期间没有出现“干过活的线上没有未完成任务”的时刻，没走到这个分支 |
| claim-once | C-199 | uncovered (not-run) | 长目标活跃期间没有出现“干过活的线空闲、它当前的任务没完成”的时刻，没走到这个分支 |
| four-endings | C-201, C-202, C-203 | uncovered (entry-missing) | “反问”“非法”两种收尾没有公开入口能造出；这次看到的结局：无 |
| review-packet | C-199 | uncovered (not-run) | 被 Run 接受的直接干预 1 条；审阅线 无；这个目标的 execreview 包 0 个；逐条：session-message-73582c39fb4ac6b707d54487ea7f2a03562534a0d40d6a81902280e89a7f8f8d（Run 05c1fcf6-a892-4572-b185-f38e45ae564b，任务 t2）：没有对上这个任务和 Run 的审阅包（检查计划里没有审阅项时不出包） |
| completed-goal | C-114 | uncovered (not-run) | 干过已完成目标 goal-confirm:goal.confirmDraft:e97184e0d9c3726e2f5fa250ce3567d9cacc8fd8c0efb7cc82dd55314e2922e1 的线（session-2cb98e3ac4462cdc59de79e0af7c54ae22df8d6e115937b72bbea64828b5e4af）现在的 latestWork 都不是它（被别的目标复用），发给它们的消息不会成为新目标请求 |
| paused-queues | C-197 | fail | the platform did not do it: timed out after 30 min waiting for delivery after resume |

- goal-confirm:goal.confirmDraft:f708a1701d80757007439029371e0b3debfa36dcf2fb712075155005c9a8d21c: the person selected idea 1 of 3 (三任务并行 + 一个验收门)
- driver-start goal-confirm:goal.confirmDraft:f708a1701d80757007439029371e0b3debfa36dcf2fb712075155005c9a8d21c: ready running
- paused-queues: later read fail: 暂停 rejected：暂停中 offerable；恢复 rejected 后 30 分钟里没有收尾
- 长目标结束 COMPLETED

### waiting：fail

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1554082（含缓存命中），输出 31177，缓存命中 1179904，Query 请求 26。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | pass | 成员 session-2313d1dfac2913fc8fd5b5c589d90f15813f02d0e9db7533d81c44f5f593f410 的 Work（Run a077f141-06fc-41a7-9ec2-7f75d5b50624）经工具发出等待 session-message-647b7e55af98b28ec82e82d2340c7fd29a86eeaafb8ceebc353550ee976c9664：收信人 session-eed9bd3568046edaf8e33353d89ab6af4fec7dbcd704db8240e14f1fb6fd2f97，期限 2026-11-24T21:36:23.540Z，waitAfterSend true；发信的 Run a077f141-06fc-41a7-9ec2-7f75d5b50624 ended/yielded，continuation wait_reply → session-message-647b7e55af98b28ec82e82d2340c7fd29a86eeaafb8ceebc353550ee976c9664 |
| interject-keeps-wait | C-188, C-224 | pass | 插话 session-message-2c9a176dca8c987a5bbaeca736b5e9cef9e734f82b1bb24020b0fab50f671de7（sent）：接它的 Run 08bfb80c-fda9-4f0e-a37d-4bb453ee1fc5（consumedWait intervention，在 session-2313d1dfac2913fc8fd5b5c589d90f15813f02d0e9db7533d81c44f5f593f410）；原等待 session-message-647b7e55af98b28ec82e82d2340c7fd29a86eeaafb8ceebc353550ee976c9664 open，期限 2026-11-24T21:36:23.540Z（原 2026-11-24T21:36:23.540Z）；新中断通知 成员侧 1 条、秘书侧 1 条 |
| restart-kept | C-170, C-207 | pass | 重启后同一等待：从sessions/facts 的 waits（expired）读到，期限 2026-11-24T21:36:23.540Z（原 2026-11-24T21:36:23.540Z），收信人 session-eed9bd3568046edaf8e33353d89ab6af4fec7dbcd704db8240e14f1fb6fd2f97；消费它的接受 expiry → Run 60c30b52-a06f-450b-8a65-c29cb68cf013；接续的 Run 60c30b52-a06f-450b-8a65-c29cb68cf013 consumedWait expiry，messageRef session-message-647b7e55af98b28ec82e82d2340c7fd29a86eeaafb8ceebc353550ee976c9664，originalRun a077f141-06fc-41a7-9ec2-7f75d5b50624（原 a077f141-06fc-41a7-9ec2-7f75d5b50624），在 session-2313d1dfac2913fc8fd5b5c589d90f15813f02d0e9db7533d81c44f5f593f410（成员 session-2313d1dfac2913fc8fd5b5c589d90f15813f02d0e9db7533d81c44f5f593f410） |
| expiry-once | C-171, C-190 | pass | expiredAt 2026-11-24T21:37:29.467Z；记下时消费 false；之后由 expiry 消费 |
| second-expiry | C-171, C-190, C-224 | fail | 同一追问链实际到期 2 次，第二次已由 expiry 接受；成员之后的 turn 输入写“第 2 次到期”：false |
| consumes | C-187 | pass | 接受条目：message:false@2026-11-24T21:39:40.696Z, expiry:true@2026-11-24T21:39:45.422Z（只认一次真实接受消费等待） |
| late-reply | C-224, C-189 | uncovered (env-unavailable) | 等待链已结束（t-wait satisfied，链上 2 条等待都已了结）；到期（2026-11-24T21:37:29.467Z）之后没有回复（回复槽空，也没有接受的回复） |
| reply-first | C-187, C-224 | uncovered (not-run) | 第二个问题 session-message-48f4ca41215b16139a01df2013045c748beff731500a8dee83b193032a6522be（期限 2026-11-24T22:09:45.340Z）：还开着（没有回复），回复抢先没有发生，转去做转交（P6 Q8） |
| transfer | C-224 | fail | waits/dispose transfer rejected invalid waiting_line_live；期限 2026-11-24T22:09:45.340Z → 2026-11-24T22:09:45.340Z |
| disconnect | C-195, C-196 | uncovered (entry-missing) | 归档 session-eed9bd3568046edaf8e33353d89ab6af4fec7dbcd704db8240e14f1fb6fd2f97（archived）后：等待 session-message-48f4ca41215b16139a01df2013045c748beff731500a8dee83b193032a6522be 的 disconnect 项「断开通知 · Session session-eed9bd3568046edaf8e33353d89ab6af4fec7dbcd704db8240e14f1fb6fd2f97 · 2026-11-24T21:40:14.875Z · 没人接，等你定」；新断开通知 归档侧 2 条（断开通知 · Session session-eed9bd3568046edaf8e33353d89ab6af4fec7dbcd704db8240e14f1fb6fd2f97 · 2026-11-24T21:40:14.875Z · 没人接，等你定）、成员侧 1 条；接不上：归档侧 成员侧 的通知正文和公开记录里不带这条等待的消息，无法证明是这次断开的通知 |
| supply-order | C-172, C-192, C-184 | uncovered (entry-missing) | 供给顺序只在 Kernel 的一次输入里，公开读口不给逐项来源顺序 |

- P6 Q8 插话在第一个等待开着时发出；它让成员线多开了一个 Run（08bfb80c-fda9-4f0e-a37d-4bb453ee1fc5），之后的到期链在这之后发生
- close and restart: SIGINT, exit 0 after 245 ms
- restart: resumeOnStartup = ask
- 等待链 session-message-647b7e55af98b28ec82e82d2340c7fd29a86eeaafb8ceebc353550ee976c9664 → session-message-647b7e55af98b28ec82e82d2340c7fd29a86eeaafb8ceebc353550ee976c9664；结束方式 chain-over

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-24T20:06:05.444Z | E05 | tool submit_initial_plan (call call_ab5545c663cc4dd69d688875) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:06:15.233Z | E05 | tool submit_initial_plan (call call_c5378b723aff4504bf01845f) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-24T20:39:03.462Z | E08 | tool submit_initial_plan (call call_ceadebdb2b3341dfad39b4e9) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:39:23.154Z | E08 | core/goals/confirm-draft confirm-again-mwv5r6z6-8 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-24T20:39:23.166Z | E08 | core/goals/control goals-control-mwv5r6zi-9 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-24T20:39:51.873Z | E08 | tool edit (call call_cc91ef064ada49ae829d5b15) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-24T20:40:26.735Z | E08 | tool submit_plan_round (call call_4c187badfc904f3994093b6d) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan.tasks.0.taskKind: Invalid discriminator value. Expected 'work' \| 'gate'; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3.title: Invalid input: expected string, received undefined; plan.tasks.3: Unrecognized key: "phase"; plan.tasks.4: Unrecognized key: "phase"; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-24T20:40:36.873Z | E08 | tool submit_plan_round (call call_f85f7fc6f35b4c5894eeb732) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:40:48.406Z | E08 | tool submit_plan_round (call call_149ec7de64c847ca9e2e7ba3) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:40:58.218Z | E08 | tool submit_plan_round (call call_4574c2145ea14fae81c5f75a) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:41:08.953Z | E08 | tool submit_plan_round (call call_06ff07094178489993f0c2d7) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:41:20.624Z | E08 | tool submit_plan_round (call call_40fd6847bc1849f7842098f3) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:41:30.285Z | E08 | tool submit_plan_round (call call_371b1eee42354c12a10a0e4c) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:43:02.607Z | E09 | tool run_readonly_command (call call_f51302ea4e6e4d0ca8ffc5bc) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-24T20:43:25.678Z | E09 | tool submit_initial_plan (call call_585fa1f0a0f842f9b89071f1) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-24T20:43:39.531Z | E09 | tool submit_initial_plan (call call_5536b629ef9344b7acebc639) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-24T20:43:53.821Z | E09 | tool submit_initial_plan (call call_4c605381dd7545f6b52db281) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:45:27.292Z | E09 | tool shell (call call_4e361f45134548b8ae7255f6) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |
| 2026-11-24T20:45:34.535Z | E09 | tool edit (call call_2d9d8cc7aeba42f79d4d8de1) | execution_failed: test/parse-date.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-24T20:45:40.139Z | E09 | tool edit (call call_1a70b1a5b9c44f83b2c799a9) | execution_failed: test/parse-date.test.js 已存在 | 无理由 | - | 待定 |
| 2026-11-24T20:45:45.096Z | E09 | tool edit (call call_30c9ecbf23d04b98879d9fd3) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-24T20:45:45.156Z | E09 | tool edit (call call_72275c63cfca46089bfb8124) | execution_failed: test/month-of.test.js 已存在 | 无理由 | - | 待定 |
| 2026-11-24T20:45:55.311Z | E09 | tool find_graph (call call_9c2602f37f724e8291f30c58) | not_found: anchor_not_found | 无理由 | - | 待定 |
| 2026-11-24T20:45:57.749Z | E09 | tool look_graph (call call_8a0aff996bc9494d95a68e6b) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-24T20:46:01.755Z | E09 | tool record_note (call call_c350f8d59b3c417ba6ddf09b) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'review' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-24T20:46:57.642Z | E12 | tool read (call call_5692e64386014d39b00a6a9d) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-24T20:47:10.161Z | E12 | tool submit_initial_plan (call call_3768ea5f01944c219f7e6746) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:47:18.999Z | E12 | tool submit_initial_plan (call call_c24da5e44b8343db9c30bd0d) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:48:17.774Z | E12 | tool edit (call call_23a50e6e0e644f059a899b4e) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-24T20:48:21.699Z | E12 | tool edit (call call_697ce4359e0c479dae4a6f74) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-24T20:50:11.663Z | E12 | tool submit_plan_round (call call_76bb9d91496146dd89fc1f02) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-24T20:51:01.982Z | iteration | tool submit_initial_plan (call call_8daf45760ffb4145870b1806) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:51:11.197Z | iteration | tool submit_initial_plan (call call_f3363729b8f84cdd9119f5a0) | invalid_arguments: 工具参数不符合 schema：goalCardDrafts: Invalid input: expected array, received undefined | 无理由 | - | 待定 |
| 2026-11-24T20:51:50.818Z | iteration | tool submit_plan_round (call call_540c7340050144fa8b5611d8) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:51:53.922Z | iteration | tool submit_plan_round (call call_7e6f336e4eb1491dac72f9cb) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-24T20:52:29.937Z | iteration | tool look_graph (call call_5402979554694b0b94e0fc83) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-24T20:56:11.722Z | intervention | tool submit_initial_plan (call call_e7840f7cc3f84ec39d1a3472) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-24T20:56:20.593Z | intervention | tool submit_initial_plan (call call_9eab7f878b4547c2b2d5508f) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T20:56:29.897Z | intervention | tool submit_initial_plan (call call_538ead1f55f448c280413b3b) | invalid_arguments: 工具参数不符合 schema：plan.obligations.0: Unrecognized key: "verificationRequirementsPlaceholder" | 产品规则 | - | 待定 |
| 2026-11-24T20:57:41.862Z | intervention | tool edit (call call_6cb38028e5c343529de09b76) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-24T20:58:34.117Z | intervention | tool submit_secretary_answer (call call_821d1d79c4ca4713b4b93f75) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized keys: "planDraftIndex", "setup", "plan", "summary" | 无理由 | - | 待定 |
| 2026-11-24T20:59:23.201Z | intervention | tool submit_plan_round (call call_1412f64f276140068e5d2fdb) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase"; plan.tasks.4: Unrecognized key: "phase" | 无理由 | - | 待定 |
| 2026-11-24T21:01:01.989Z | intervention | core/goals/control goals-control-mwv6j15x-48 | invalid: the Goal is completed for its active Plan; it has no work to stop | 无理由 | - | 待定 |
| 2026-11-24T21:01:59.373Z | intervention | core/goals/control goals-control-mwv6k9fx-50 | busy: the Goal is not paused | 协调 | - | 待定 |
| 2026-11-24T21:32:07.622Z | waiting | tool read (call call_9e06d795c2a4440da72c0701) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-24T21:32:16.840Z | waiting | tool look_graph (call call_aeeb358e0614463687d8048f) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-24T21:32:30.340Z | waiting | tool submit_initial_plan (call call_66b0210cee4d44b1a68740f5) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T21:32:41.002Z | waiting | tool submit_initial_plan (call call_39a8f06287c044bd9f2a1533) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary"; planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-24T21:32:49.891Z | waiting | tool submit_initial_plan (call call_022931c12dd64038aa254822) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T21:34:04.642Z | waiting | tool dispatch_task (call call_e32c5d5b20144207871007ce) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-24T21:39:35.376Z | waiting | tool respond_session_message (call call_003a93e957c245908d74e300) | forbidden: 这条消息由这一轮的结论回复；要先说进度，另发一条不要回复的 | 无理由 | - | 待定 |
| 2026-11-24T21:39:54.564Z | waiting | tool record_note (call call_a4880bc121d9456fa1ea67c6) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-24T21:40:14.821Z | waiting | core/waits/dispose transfer-mwv7xgmd-60 | invalid: waiting_line_live | 无理由 | - | 待定 |
| 2026-11-24T21:40:20.972Z | E08b | tool run_readonly_command (call call_f2482b9233654b21b5bc689d) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-24T21:40:33.003Z | E08b | tool submit_initial_plan (call call_d2e72cbe8e3e47f1ae1abdda) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-24T21:40:45.501Z | E08b | tool submit_initial_plan (call call_9fe3fc1bcf3f4595af72d628) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-24T21:40:57.046Z | E08b | tool submit_initial_plan (call call_68fdb19ab91b426da964a80c) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-24T21:41:29.538Z | E08b | tool dispatch_task (call call_52f3cff7169c41f2a973cb7a) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-24T21:41:34.279Z | E08b | tool edit (call call_f4d29247f40144bdb7ba5e62) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-24T21:41:36.709Z | E08b | tool shell (call call_f0bb22b67f274ddeb6cbc1fe) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1

没跑：`uncovered (not-run)`。

### B1

没跑：`uncovered (not-run)`。

### 压缩

没跑：`uncovered (not-run)`。

### B06

没跑：`uncovered (not-run)`。

### E08b：fail

- sub-running（C-210）：pass。提交改需求时 sub（T1）的 Run 74fdcfc8-69ee-41c6-8824-d34858e657de 正在跑（开始于 2026-11-24T21:41:26.359Z）
- stop-delivered（C-210）：uncovered (not-run)。stopped before this check: timed out after 30 min waiting for the changed plan candidate
- safe-point-end（C-210）：uncovered (not-run)。stopped before this check: timed out after 30 min waiting for the changed plan candidate
- adopt-after-end（C-210）：fail。the platform did not do it: timed out after 30 min waiting for the changed plan candidate
- stopped: not-run: timed out after 30 min waiting for the changed plan candidate
- goal-confirm:goal.confirmDraft:fa3feaf6fcecfa183f3a7a0b634c5237b680307fa4e99a350efdd63a12378d7b (RUNNING): pause because E08b ended: committed

## 预算

- 上限：总量 395000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 12554428（输入 12378292，输出 176136；缓存命中 10594816）；Query 请求 181 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 21 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：12320471；估算部分 57821。
- 超预算退出：整轮 没有；按场景/格 没有。
- E05：用量 474342（输入 466070，输出 8272，缓存命中 355200；Query 请求 15（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 466070）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 0）
- E08：用量 2114975（输入 2084121，输出 30854，缓存命中 1827328；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2084121）
- E09：用量 2534232（输入 2504335，输出 29897，缓存命中 2168064；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3；实报输入 2504335）
- E12：用量 1029262（输入 1015946，输出 13316，缓存命中 870656；Query 请求 16（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1015946）
- iteration：用量 1377358（输入 1364829，输出 12529，缓存命中 1197696；Query 请求 18（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1364829）
- intervention：用量 2132896（输入 2100215，输出 32681，缓存命中 1870080；Query 请求 30（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2100215）
- waiting：用量 1585259（输入 1554082，输出 31177，缓存命中 1179904；Query 请求 26（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 5；实报输入 1496261）
- E08b：用量 1306104（输入 1288694，输出 17410，缓存命中 1125888；Query 请求 26（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1288694）
- P6 记账：模型调用 311 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）0 个，其中只回“收到”的 0 个（成功的工具调用只有读类和 respond_session_message，没交候选、没发信、没出卡；裁定 Q11，只计数不判）。
- E05：模型调用 15，叫醒轮 0，只回收到 0
- E08：模型调用 48，叫醒轮 0，只回收到 0
- E09：模型调用 60，叫醒轮 0，只回收到 0
- E12：模型调用 29，叫醒轮 0，只回收到 0
- iteration：模型调用 36，叫醒轮 0，只回收到 0
- intervention：模型调用 52，叫醒轮 0，只回收到 0
- waiting：模型调用 39，叫醒轮 0，只回收到 0
- E08b：模型调用 32，叫醒轮 0，只回收到 0

## 延迟探针

- w-accept#0：{"startedAt":"2026-11-24T20:05:46.359Z","writtenAt":"2026-11-24T20:48:43.752Z","samples":129399,"p50Ms":20.25,"p95Ms":20.99,"p99Ms":21.46,"maxMs":540.54,"meanMs":20.72}；关闭 SIGINT, exit 0 after 128 ms
- w-accept#1：{"startedAt":"2026-11-24T20:48:43.809Z","writtenAt":"2026-11-24T21:34:59.422Z","samples":137705,"p50Ms":20.89,"p95Ms":21.2,"p99Ms":21.66,"maxMs":410.78,"meanMs":21.03}；关闭 SIGINT, exit 0 after 245 ms
- w-accept#2：{"startedAt":"2026-11-24T21:37:27.752Z","writtenAt":"2026-11-24T22:11:53.157Z","samples":102918,"p50Ms":20.96,"p95Ms":21.27,"p99Ms":21.86,"maxMs":399.77,"meanMs":21.01}；关闭 SIGINT, exit 0 after 125 ms

## 其它记录

- 2026-11-24T21:37:30.359Z waiting: waiting: request 007d12a6-9959-4f13-b3e6-2ee4f16881a7 counted at its reservation 57821+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-24T22:11:53.185Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
