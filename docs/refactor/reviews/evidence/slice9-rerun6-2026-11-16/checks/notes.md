# G6 notes 2026-11-16（运行号 g6-2026-11-16-f8645d87）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1183673（含缓存命中），输出 13854，缓存命中 1032576，Query 请求 16。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| gate | C-185 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| paths | C-185, C-217 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| kept | C-185 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| single-occupancy | C-71 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| convention | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| duplicates | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| reviewer | C-208, C-218 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| name-different | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| name-same | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| temporary | C-208 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |
| line-choice | C-73, C-191 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied) |

- driver-start t-users: ready running
- driver-start t-orders: ready running
- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver completed, wait reason the selected Task t-users is satisfied)
- g6-e05-mwjaa3zk-27 (RUNNING): pause because E05 ended: committed

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
- 用量：输入 3234878（含缓存命中），输出 40632，缓存命中 2943104，Query 请求 30。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-0cdf2c76515f34426879237b50f5cbd2；Goal 指针 {"aggregateType":"PlanRevision","projectId":"18f64bf4eb4fa02af01a023c3e3aeb52","planId":"initial-plan-0cdf2c76515f34426879237b50f5cbd2"} |
| versions | C-210 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason l46_blocked: T5) |
| switch | C-210 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason l46_blocked: T5) |
| old-evidence | C-210 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason l46_blocked: T5) |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason l46_blocked: T5) |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- the person selected idea 1 of 3 on the change: 彻底移除 sub（我的默认理解）
- node review T2 (calc.js, test/mul.test.js): committed
- node review T1 (calc.js, test/sub.test.js): committed
- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason l46_blocked: T5)
- goal-confirm:goal.confirmDraft:c66cb7f8daf1d1148593679965fdfa452fd46ce61394cc2043f008f1a28262a5 (RUNNING): pause because E08 ended: committed

### E09：uncovered

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 9685256（含缓存命中），输出 62456，缓存命中 8866882，Query 请求 56。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | pass | 执行者上报 session-message-8faa8533214d600ba6158f2562bdd8088beb9fcfb95c2ae09e7a349b5e26f14c：{"deadlineMs":120000,"intent":"inquiry","needsReply":true,"recipient":{"projectId":"b9d3ba23dc5d94a5aebac495129f18af","sessionId":"session-e826fd15b646858b755854022b66dbc2595d395fbd020d4c3ca6c5279b7f3254"},"taskRef":{"goalId":"goal-confirm:goal.confirmDraft:9b9d12efab3434667f8ed71e011dcb674f825d8abbf0a605a0c2f08551361e65","projectId":"b9d3ba23dc5d94a5aebac495129f18af","taskId":"t-b"},"text":"t-b（monthOf 复用 parseDate）阻塞上报，请转给参谋/用户裁决。\n\n事实：开工时 src/api.js 只有一行注释、无 export，test/ 目录不存在，上游任务 t-a 没有任何 Run 或执行记录；本线写权限只有 src/report.js 与 test/report.test.js，不能在 api.js 里加占位。因此「import ./api.js 的 parseDate」目前无可引入的实现。\n\n关于冲突：这不是 Date vs {y,m,d} 的冲突。架构基线与 module api 接口都写 parseDate(text)->Date，monthOf 只需 Date.getMonth()+1 即可，本线不需要 {y,m,d}，也不主张改对方接口；同样也不能另写一套解析（违基线「解析逻辑单一来源」）。\n\n影响：t-b 无法完成，o-b 的 r-b-static / r-b-dyn 无法满足，下游 t-gate 阻塞。\n\n待裁决：(1) 让上游 t-a 先落地 parseDate(text)->Date，本线随后实现 monthOf；(2) 放宽本线写权限、允许同时实现 src/api.js；(3) 其它契约。在答复前本线不改 src/api.js、不复制解析逻辑，只保留记录（注记 9ea902a7-7ee4-4deb-b058-bbb8f0479fce）。另请确认你是否为本目标的参谋线，若不是请告知应上报给谁。"} |
| adviser-explains | C-211 | uncovered (not-run) | 上报 session-message-8faa8533214d600ba6158f2562bdd8088beb9fcfb95c2ae09e7a349b5e26f14c 发给了参谋线 session-e826fd15b646858b755854022b66dbc2595d395fbd020d4c3ca6c5279b7f3254，但参谋的 2 个轮的输入里都没有它：参谋还没处理这条上报 |
| person-decides | C-211, C-62 | uncovered (not-run) | 参谋没有解释这条上报（uncovered），人对它的决定和新版本这两环没有发生 |
| new-version | C-211, C-55 | uncovered (not-run) | 参谋没有解释这条上报（uncovered），人对它的决定和新版本这两环没有发生 |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 5 条 finding；带路径的：package.json, README.md, src/report.js, test/api.test.js, test/report.test.js |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"b9d3ba23dc5d94a5aebac495129f18af","workspaceId":"741eed1249d1a7cd22f6ef9492ee2b46","captureId":"7b7b9eb5-f424-4df8-b710-41a8fddbfa00"} |
| observation-after-pass | C-98 | pass | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"b9d3ba23dc5d94a5aebac495129f18af","workspaceId":"741eed1249d1a7cd22f6ef9492ee2b46","captureId":"7b7b9eb5-f424-4df8-b710-41a8fddbfa00"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"b9d3ba23dc5d94a5aebac495129f18af","workspaceId":"741eed1249d1a7cd22f6ef9492ee2b46","captureId":"a27b5872-d3d9-49de-b552-0a453c9614ab"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：t-a PASS/gaps 0, t-b PASS/gaps 0 |
| uncovered-round | C-99 | pass | 2 个 INCONCLUSIVE 轮，对应任务：satisfied, satisfied |

- goal-confirm:goal.confirmDraft:9b9d12efab3434667f8ed71e011dcb674f825d8abbf0a605a0c2f08551361e65: the draft chose every_step; set to after_plan_confirmation after adoption (committed )
- E09 Goal ended COMPLETED
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：uncovered

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1049965（含缓存命中），输出 12751，缓存命中 909440，Query 请求 15。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | pass | QueryRun 3→3，输入 260691→260691，changesHead h0000001367→h0000001367 |
| graph-cards | C-88, C-89 | pass | goal children 1，find 4，path 卡 有 |
| raw-history | C-42, C-157 | pass | 线的原历史 62 条，Run 历史 61 条 |
| completion-chain | C-104 | pass | 检查轮卡 2 张，有非空 evidenceRefs：true |
| restart-state | C-145, C-215 | pass | 重启后旧 Goal COMPLETED，计划 initial-plan-97a32b7eae07b85bdd15933425fb1519，Run 1/1 |
| reconcile | C-146 | pass | host/reconcile-report：lease owned |
| redrive-sets | C-155 | pass | 旧 Goal 的 causes：[] |
| new-goal | C-114, C-158 | pass | 新 Goal goal-confirm:goal.confirmDraft:db1a596056430fd89fb5d2d2d5e5c87c47b841c56b441ca43f4f3358fd6af7eb（采用 committed，起步时 3 个任务都没满足）→ COMPLETED；旧 Goal 仍 COMPLETED |
| history-reuse | C-220 | uncovered (not-run) | 新 Goal 的 Run 没有一个成功的工具结果引用旧 Goal 或旧 Run（这次新工作没有查询已完成工作） |
| stale-premise | C-220 | uncovered (entry-missing) | 适用范围和“过期前提不升级”是模型对已查到事实的取舍，公开读口没有逐项可判的字段，不判通过 |
| replay | C-147 | pass | 同一 flowId 两次 driver-start：ready/ready，state running/running |
| wait-registry | C-207 | uncovered (entry-missing) | 目标等待登记表只在 Host 内存里，没有公开读口；重启后只能看到它的效果（等待的线被叫醒），看不到登记表本身 |

- restart: SIGINT, exit 0 after 214 ms
- goal-confirm:goal.confirmDraft:db1a596056430fd89fb5d2d2d5e5c87c47b841c56b441ca43f4f3358fd6af7eb: the person selected idea 1 of 3 (A · 最简：固定文案，无标点参数)

### iteration：uncovered

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 729076（含缓存命中），输出 16775，缓存命中 605568，Query 请求 19。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| select | C-109 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| candidate | C-110 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| what-changed | C-213, C-110 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| per-request | C-111 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| why | C-112, C-226 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| continues | C-105 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| request-goal | C-107 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| cards-ask | C-113 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| multi-round | C-194 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |

- goal-confirm:goal.confirmDraft:9507a200f1659f2d6093b3483df32e5713d7f0b2465305228f65bc9a52b8cfef: the draft chose every_step; set to after_plan_confirmation after adoption (committed )
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- goal-confirm:goal.confirmDraft:9507a200f1659f2d6093b3483df32e5713d7f0b2465305228f65bc9a52b8cfef (RUNNING): pause because iteration ended: committed
- iteration ended: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

### intervention：uncovered

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 -（含缓存命中），输出 -，缓存命中 -，Query 请求 -。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| delivery-states | C-189, C-192 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| continue-no-planning | C-199 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| planning-when-idle | C-199, C-200 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| four-endings | C-201, C-202, C-203 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| completed-goal | C-114 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| paused-queues | C-197 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |

- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

### waiting：uncovered

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 -（含缓存命中），输出 -，缓存命中 -，Query 请求 -。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| restart-kept | C-170, C-207 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| expiry-once | C-171, C-190 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| second-expiry | C-171, C-190, C-224 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| consumes | C-187 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| late-reply | C-224, C-189 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| transfer | C-224 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| disconnect | C-195, C-196 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact |

- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-16T13:08:32.208Z | A1 | core/completion-policies/read | not_found: project 2b75f7d23c420a84acd063103bfff629 has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-16T13:09:37.417Z | A1 | tool look_graph (call call_00_JkzUs1E5XDiXRcVXZxIu8416) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-16T13:09:37.581Z | A1 | tool run_readonly_command (call call_01_IakrazuFzK4bRaLKKbWF0775) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-16T13:09:54.573Z | B1 | core/completion-policies/read | not_found: project g6-wb has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-16T13:12:23.534Z | E05 | tool read (call call_01_kqm9nfyik8v9m53jmqjcfz9s) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-16T13:13:07.717Z | E05 | tool edit (call call_00_di01oarl0otwkenno6gdg91r) | execution_failed: test/users.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-16T13:14:20.078Z | E05 | tool look_graph (call call_01_8nutd9ajrk8lkrv44wbc0zjq) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T13:14:26.592Z | E05 | tool read_execution_history (call call_00_gso1x6hfk520mt2yjhavv3vy) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T13:14:50.094Z | E05 | tool read_execution_history (call call_00_d5zchbt8z4342gsmgpead3fv) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run 42288521-c0f2-4d23-9288-24d27b16d575) | 无理由 | - | 待定 |
| 2026-11-16T13:15:04.682Z | E05 | tool read_execution_history (call call_00_ks2q50mhdm3q4hsoml54xa4o) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run 42288521-c0f2-4d23-9288-24d27b16d575) | 无理由 | - | 待定 |
| 2026-11-16T13:45:57.938Z | E08 | tool read (call call_e24142c021df4041b55f3797) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-16T13:46:59.422Z | E08 | tool submit_initial_plan (call call_00_0acmrdeddmcg4961q7g1thio) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "text" | 安全 | - | 待定 |
| 2026-11-16T13:47:51.382Z | E08 | tool submit_initial_plan (call call_00_jm3t206qejakx716dylt3ga5) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-16T13:48:17.603Z | E08 | core/goals/confirm-draft confirm-again-mwjbjpkz-38 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-16T13:48:17.618Z | E08 | core/goals/control goals-control-mwjbjple-39 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-16T13:49:41.845Z | E08 | tool read (call call_01_ukz7yuma89ejw7bps575od1j) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-16T13:49:47.450Z | E08 | tool shell (call call_00_zve4saxu5auuh6fnk0ivf8jo) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |
| 2026-11-16T13:49:52.221Z | E08 | tool look_graph (call call_00_9gy4p61nnchk42x4za021hny) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T13:49:53.899Z | E08 | tool edit (call call_01_5829rnlgciffdyhsewsvzavn) | execution_failed: test/mul.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-16T13:49:54.877Z | E08 | tool look_graph (call call_00_gyk1nbz1gf6gdpu1luoe5s7e) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T13:49:57.372Z | E08 | tool look_graph (call call_00_q4jqp40ffxfxcmh2p285e73t) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T13:50:15.699Z | E08 | tool submit_initial_plan (call call_00_ou5gfteg3mmyfok813aoq5l8) | hook_blocked: submit_initial_plan is not a submit tool of this round. This round's submit tools are: submit_secretary_answer. Call one of them to give this round's answer; the round is still open | 安全 | - | 待定 |
| 2026-11-16T13:50:43.604Z | E08 | tool submit_plan_round (call call_00_o5dtapf8dlg4azu7terrgm39) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase"; plan: Unrecognized key: "schemaVersion" | 安全 | - | 待定 |
| 2026-11-16T13:50:51.336Z | E08 | tool submit_plan_round (call call_00_5nxv6e9axxientkke7naogpg) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-16T13:50:59.774Z | E08 | tool submit_plan_round (call call_00_1i8qoes607c7psp4fchd3jtl) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-16T13:51:19.291Z | E08 | tool look_graph (call call_00_mun9rxq39icq5azg992wjzvp) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T13:51:23.341Z | E08 | tool look_graph (call call_01_kknoj9ogi5g8zipx1cdewhil) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-16T14:26:31.744Z | E09 | tool read (call call_00_smaebdblepttr6uxe7ju5ml8) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-16T14:26:31.749Z | E09 | tool read (call call_01_8thcatoo6wcvvynqtx1702gg) | execution_failed: src 不是普通文件 | 无理由 | - | 待定 |
| 2026-11-16T14:26:56.636Z | E09 | tool record_note (call call_00_2od2kqvwot7c8zvvevg633p7) | invalid_arguments: 工具参数不符合 schema：anchor: Unrecognized key: "projectId" | 安全 | - | 待定 |
| 2026-11-16T14:27:14.102Z | E09 | tool read_session_message_body (call call_00_heli3pqx0s6ffxdoqts2ii84) | execution_failed: the requested mailbox record does not exist | 无理由 | - | 待定 |
| 2026-11-16T14:27:44.942Z | E09 | tool edit (call call_00_j5ij58uhu90cxi7erpe3a3ae) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 安全 | - | 待定 |
| 2026-11-16T14:27:50.443Z | E09 | tool edit (call call_00_5ysa0uznwq8b7j6bi2n1bidb) | execution_failed: test/api.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-16T14:29:25.237Z | E09 | tool look_graph (call call_278bc3d62b8c4e30ba7c59d6) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:29:29.382Z | E09 | tool look_graph (call call_780715ad9e6b4b75af4ed022) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:29:36.058Z | E09 | tool look_graph (call call_00785d768de34a56adbf3cc7) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:29:36.080Z | E09 | tool look_graph (call call_093a972932014d0d9c61ad47) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:29:36.145Z | E09 | tool read_execution_history (call call_b34d6c20a45a481da005c142) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T14:29:39.090Z | E09 | tool look_graph (call call_16a663dee72844859177e9a9) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:30:03.137Z | E09 | tool read_execution_history (call call_61047f47ebf242c48da8e9c7) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run 9380b9e0-30e4-440e-9585-6ee5692f9aae) | 无理由 | - | 待定 |
| 2026-11-16T14:30:39.237Z | E09 | tool look_graph (call call_01_2kxg5fn21ahx7wfdi2oe631k) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:30:47.954Z | E09 | tool project_source (call call_00_0k3gvr7y8kuaj3hqnfvquc49) | not_found: .workbench/checks/108f41e4143283b7336f43a02fdb62f97cfd7117dd1cad7a34f8dcc17ce9bb4d.json 不存在 | 无理由 | - | 待定 |
| 2026-11-16T14:31:25.280Z | E09 | tool record_note (call call_00_44k6gk7oyw9908ngtl8ggtp4) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized keys: "expectedVersion", "noteId" | 安全 | - | 待定 |
| 2026-11-16T14:31:37.323Z | E09 | tool send_session_message (call call_00_0g4ecev5qdb93288epztskjj) | invalid: a goal-bearing action_request requires the expected basis | 产品规则 | - | 待定 |
| 2026-11-16T14:32:06.587Z | E09 | tool read_execution_history (call call_5dd117d0e3fd40e7be1e127a) | invalid: afterCursor is not a valid cursor for this Session mapping (Run 67ebca4e-2701-4aca-a1ca-44e545b9865c) | 无理由 | - | 待定 |
| 2026-11-16T14:34:21.405Z | E09 | tool read_execution_history (call call_9454f6c9d463498b968ddc97) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 94c2a48a-dbcd-4f89-bbce-790cd8e2b001) | 无理由 | - | 待定 |
| 2026-11-16T14:40:40.976Z | E12 | tool submit_initial_plan (call call_3e14c66af32249969c084245) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-16T14:40:54.020Z | E12 | tool submit_initial_plan (call call_8b9a0defca244394a22a43fd) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-16T14:41:25.555Z | E12 | tool read (call call_e11506eb73f94dd29a22513c) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-16T14:41:39.934Z | E12 | tool edit (call call_01_st3gq12wp9qgojqm968xrfuf) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-16T14:44:15.283Z | E12 | tool submit_plan_round (call call_a803e286e04a4615809843a0) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase" | 安全 | - | 待定 |
| 2026-11-16T14:45:35.681Z | iteration | tool submit_initial_plan (call call_00_kFcLsdBa7nzU90W2eU051507) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "setup"; setup: Invalid input: expected object, received undefined | 安全 | - | 待定 |
| 2026-11-16T14:45:44.680Z | iteration | tool submit_initial_plan (call call_00_Swcaoga4hLbZD4cv0lWp2561) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-16T14:45:52.968Z | iteration | tool submit_initial_plan (call call_00_sHxNqG3AfiggOsCJhaf40931) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-16T14:47:34.383Z | iteration | tool look_graph (call call_03541f64636a4cc3961ab83b) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:47:34.405Z | iteration | tool look_graph (call call_8371fc452ed1438abc7e37e3) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:47:34.458Z | iteration | tool read_execution_history (call call_d19628173f7f418faa25f1c0) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T14:47:43.346Z | iteration | tool look_graph (call call_898d5b9bd1aa4f93b4ce7b66) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:47:43.353Z | iteration | tool look_graph (call call_734fe12d8eba4abdb08cd4a1) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:47:50.298Z | iteration | tool look_graph (call call_238422368ac44ca38b1796c7) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T14:49:56.077Z | iteration | tool read_execution_history (call call_230bf1b194e04acba630eba3) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run d3d48fa1-2151-44bd-9f4c-b859005fc8e1) | 无理由 | - | 待定 |
| 2026-11-16T14:49:56.107Z | iteration | tool look_graph (call call_eb5526a0a5d841aeb0f2c9ef) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 90793b25-6101-4f94-8965-31801d793744）
- usage（C-214）：pass。usageStatus reported，输入 29010，输出 94，缓存命中 3200
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 94 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"90793b25-6101-4f94-8965-31801d793744","reservedOutput":131072,"usageStatus":"reported","inputTokens":29010,"outputTokens":94,"cachedInputTokens":3200},{"requestId":"18ec29b8-c6c3-484f-9057-7f2abd0c9e97","reservedOutput":131072,"usageStatus":"reported","inputTokens":30935,"outputTokens":170,"cachedInputTokens":29056},{"requestId":"6c074689-bf69-4529-ad15-873717609cd5","reservedOutput":131072,"usageStatus":"reported","inputTokens":31980,"outputTokens":232,"cachedInputTokens":31104},{"requestId":"930f9111-28b4-47ea-b4e5-7c11a77c0927","reservedOutput":131072,"usageStatus":"reported","inputTokens":32617,"outputTokens":189,"cachedInputTokens":32128},{"requestId":"b8460646-0c5b-4aea-983f-571fd2414790","reservedOutput":131072,"usageStatus":"reported","inputTokens":34161,"outputTokens":214,"cachedInputTokens":32768},{"requestId":"daf83e9a-bd4b-42ed-9cb5-541ddeb10e52","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request daf83e9a-bd4b-42ed-9cb5-541ddeb10e52: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId d275f4f1-08ae-4357-b8b7-a32f1eee5d95）
- usage（C-214）：pass。usageStatus reported，输入 15616，输出 101，缓存命中 9472
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 101 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"d275f4f1-08ae-4357-b8b7-a32f1eee5d95","reservedOutput":64000,"usageStatus":"reported","inputTokens":15616,"outputTokens":101,"cachedInputTokens":9472},{"requestId":"4cb59f06-8e74-42f4-a222-72b94b345c43","reservedOutput":63899,"usageStatus":"reported","inputTokens":16660,"outputTokens":151,"cachedInputTokens":15488},{"requestId":"2bcad0db-fed9-447c-9534-db6463ea6942","reservedOutput":63748,"usageStatus":"reported","inputTokens":17506,"outputTokens":114,"cachedInputTokens":16768},{"requestId":"42f34f03-7ecc-4319-9f1c-933adec158d7","reservedOutput":63634,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request 42f34f03-7ecc-4319-9f1c-933adec158d7: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### 压缩：uncovered

- compacted（K2-P2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- six-sections（K2-P2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- accepted（K2-P2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- cache-after（K2-P2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

### C-216：uncovered

- observed-start（C-216）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- adopted-done（C-216）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

### C-221：uncovered

- first-plan（C-221）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- fail-rework（C-221）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- delivered（C-221）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

### C-222：uncovered

- created（C-222）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- started（C-222）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

### B06：uncovered

- W1a（B06-W1a）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W2（B06-W2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W3（B06-W3）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W5（B06-W5）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W10（B06-W10）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W12（B06-W12）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 16239066（输入 16091333，输出 147733；缓存命中 14527554）；Query 请求 146 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 13 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 计量不可用：request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- A1：用量 159602（输入 158703，输出 899，缓存命中 128256；Query 请求 6（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- B1：用量 50148（输入 49782，输出 366，缓存命中 41728；Query 请求 4（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E05：用量 1197527（输入 1183673，输出 13854，缓存命中 1032576；Query 请求 16（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E08：用量 3275510（输入 3234878，输出 40632，缓存命中 2943104；Query 请求 30（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3）
- E09：用量 9747712（输入 9685256，输出 62456，缓存命中 8866882；Query 请求 56（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5）
- E12：用量 1062716（输入 1049965，输出 12751，缓存命中 909440；Query 请求 15（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- iteration：用量 745851（输入 729076，输出 16775，缓存命中 605568；Query 请求 19（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）

## 延迟探针

- wa#0：{"startedAt":"2026-11-16T13:08:30.259Z","writtenAt":"2026-11-16T13:09:52.943Z","samples":3954,"p50Ms":20.19,"p95Ms":20.41,"p99Ms":33.08,"maxMs":261.62,"meanMs":20.77}；关闭 SIGINT, exit 0 after 40 ms
- wb#0：{"startedAt":"2026-11-16T13:09:52.994Z","writtenAt":"2026-11-16T13:11:15.350Z","samples":3972,"p50Ms":20.15,"p95Ms":20.4,"p99Ms":22.64,"maxMs":219.15,"meanMs":20.59}；关闭 SIGINT, exit 0 after 23 ms
- w-accept#0：{"startedAt":"2026-11-16T13:11:15.382Z","writtenAt":"2026-11-16T14:42:14.543Z","samples":266572,"p50Ms":20.15,"p95Ms":20.46,"p99Ms":21.58,"maxMs":1213.2,"meanMs":20.48}；关闭 SIGINT, exit 0 after 214 ms
- w-accept#1：{"startedAt":"2026-11-16T14:42:14.598Z","writtenAt":"2026-11-16T14:54:58.591Z","samples":37078,"p50Ms":20.28,"p95Ms":20.77,"p99Ms":21.4,"maxMs":344.46,"meanMs":20.58}；关闭 SIGINT, exit 0 after 180 ms

## 其它记录

- 2026-11-16T13:09:52.867Z A1: g6-a1-mwja4l1o-4 (BLOCKED): pause because wa closes: committed
- 2026-11-16T13:09:52.885Z A1: A1: request daf83e9a-bd4b-42ed-9cb5-541ddeb10e52 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-16T13:11:15.297Z B1: g6-b1-mwja6cl7-15 (BLOCKED): pause because wb closes: committed
- 2026-11-16T13:11:15.313Z B1: B1: request 42f34f03-7ecc-4319-9f1c-933adec158d7 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-16T14:54:57.864Z iteration: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- 2026-11-16T14:54:58.345Z -: w-accept closes: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- 2026-11-16T14:54:58.602Z -: the run stopped early: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- 2026-11-16T14:54:58.602Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
