# G6 notes 2026-11-14（运行号 g6-2026-11-14-06f31495）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 990684（含缓存命中），输出 8794，缓存命中 871680，Query 请求 9。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| gate | C-185 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| paths | C-185, C-217 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| kept | C-185 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| single-occupancy | C-71 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| convention | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| duplicates | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| reviewer | C-208, C-218 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| name-different | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| name-same | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| temporary | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| line-choice | C-73, C-191 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:a85d1b270398b5b771010e72ec3e65e94ad5c7d8b15a4080b89aaa3a6a090e2d (NEEDS_DECISION): pause because E05 ended: committed

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
- 用量：输入 1290883（含缓存命中），输出 11533，缓存命中 1141120，Query 请求 24。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-f07bc456cdf90d798aea51d74bfc59d1；Goal 指针 {"aggregateType":"PlanRevision","projectId":"52de1a87cd03edeed54502e2442229c4","planId":"initial-plan-f07bc456cdf90d798aea51d74bfc59d1"} |
| versions | C-210 | fail | the platform did not do it: timed out after 30 min waiting for the changed plan candidate |
| switch | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| old-evidence | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- stopped: not-run: timed out after 30 min waiting for the changed plan candidate
- goal-confirm:goal.confirmDraft:b2c456b68b3f6757d59e3c5a08d5d000513051958d0b02d19efc74d5ff8fdd92 (RUNNING): pause because E08 ended: committed

### E09：fail

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 5864999（含缓存命中），输出 33367，缓存命中 5612288，Query 请求 12。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | fail | the platform did not do it: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| adviser-explains | C-211 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| person-decides | C-211, C-62 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| new-version | C-211, C-55 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| formal-change | C-212 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| drift | C-212, C-89 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"ca9453abba6df8b818d2a9eb45f10fe5","workspaceId":"29cf014d8a86279bd1d71fdc225f058a","captureId":"47d140f4-f126-4cd6-bf28-544f7c879870"} |
| observation-after-pass | C-98 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| rounds | C-93, C-95, C-218 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| uncovered-round | C-99 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 150 min waiting for goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:6d3011ddb5d78dd8337a310d0dade04d7b6d0e105e3893d5b8e9262be5f878c5 (RUNNING): pause because E09 ended: committed

### E12：fail

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 470763（含缓存命中），输出 4316，缓存命中 377984，Query 请求 6。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | fail | the platform did not do it: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| graph-cards | C-88, C-89 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| raw-history | C-42, C-157 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| completion-chain | C-104 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| restart-state | C-145, C-215 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| reconcile | C-146 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| redrive-sets | C-155 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| new-goal | C-114, C-158 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| history-reuse | C-220 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| stale-premise | C-220 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| replay | C-147 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| wait-registry | C-207 | uncovered (not-run) | stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:87600560fc698d0dd8190c28ca6b532c4af5cb5090a90daba17f1433b98d05f2 (NEEDS_DECISION): pause because E12 ended: committed

### iteration：fail

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1045018（含缓存命中），输出 9335，缓存命中 907904，Query 请求 13。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | fail | the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| select | C-109 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| candidate | C-110 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| what-changed | C-213, C-110 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| per-request | C-111 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| why | C-112, C-226 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| continues | C-105 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| request-goal | C-107 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| cards-ask | C-113 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| multi-round | C-194 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:61700989ad9a137b891b6f0ba7ea21d88e3d6dd5f4e96a0ad16aacd3996c6ca6 (RUNNING): pause because iteration ended: committed

### intervention：fail

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 443533（含缓存命中），输出 5026，缓存命中 347392，Query 请求 8。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| delivery-states | C-189, C-192 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| continue-no-planning | C-199 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| planning-when-idle | C-199, C-200 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| four-endings | C-201, C-202, C-203 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| completed-goal | C-114 | fail | the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| paused-queues | C-197 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:9034a16a5e79a912008493675275b598cfd2ceebdea6ebf11c096be8bcc40b2b (NEEDS_DECISION): pause because intervention ended: committed

### waiting：fail

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 411437（含缓存命中），输出 4696，缓存命中 314880，Query 请求 10。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | fail | the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| restart-kept | C-170, C-207 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| expiry-once | C-171, C-190 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| second-expiry | C-171, C-190, C-224 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| consumes | C-187 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| late-reply | C-224, C-189 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| transfer | C-224 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| disconnect | C-195, C-196 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:828c6bad27b73a173c4f17c113461a9f08c6ccf6f91213e5c0cc1014518ad20e (RUNNING): pause because waiting ended: committed

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-14T14:44:49.396Z | A1 | core/completion-policies/read | not_found: project c162158b271dcc20707e27346ccc25a8 has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-14T14:49:56.964Z | B1 | core/completion-policies/read | not_found: project g6-wb has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-14T14:56:09.050Z | E05 | tool read (call call_00_PWsax2ITrUEx5IaNZlNW2956) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-14T15:01:27.644Z | E05 | tool look_graph (call call_00_hcdt5cuvg5agxcn5ppoy3f7u) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T15:01:30.576Z | E05 | tool look_graph (call call_00_7gytyo8t79hd4bao997g11uk) | forbidden: the Round node is outside the requested scope | 无理由 | - | 待定 |
| 2026-11-14T15:01:33.770Z | E05 | tool look_graph (call call_00_smqxlzebba1pa8ugcnntcxeq) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T15:01:36.737Z | E05 | tool look_graph (call call_00_ykbpiv7vol6um18bweyb9iku) | forbidden: the Task node is outside the requested goal | 无理由 | - | 待定 |
| 2026-11-14T15:01:39.052Z | E05 | tool look_graph (call call_00_607ibw630lvg2m8o6ytikoz9) | forbidden: the Task node is outside the requested goal | 无理由 | - | 待定 |
| 2026-11-14T15:01:42.034Z | E05 | tool look_graph (call call_00_6eknno8yhterf41hjt5wye1q) | forbidden: the Goal node is outside the requested goal | 无理由 | - | 待定 |
| 2026-11-14T15:01:53.419Z | E05 | tool look_graph (call call_00_t5uuh1krmv7wkrs8a4uscbpc) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T15:01:55.819Z | E05 | tool look_graph (call call_00_0mh8qlf7ag5hq8uad385sebu) | forbidden: the Task node is outside the requested goal | 无理由 | - | 待定 |
| 2026-11-14T15:02:05.146Z | E05 | tool record_note (call call_00_4w1omvgr2nmz17hxiu2tdi5q) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "evidenceIndexes" | 安全 | - | 待定 |
| 2026-11-14T15:56:57.507Z | E08 | tool run_readonly_command (call call_3e5094a9567e44c4bdcd7dcd) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-14T15:57:27.691Z | E08 | core/goals/confirm-draft confirm-again-mwgla497-28 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-14T15:57:27.703Z | E08 | core/goals/control goals-control-mwgla49j-29 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-14T16:03:36.670Z | E08 | tool look_graph (call call_aeda96555bc84b5790cf783c) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T16:03:42.444Z | E08 | tool find_graph (call call_77b4024b344b4658b7c375c6) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T16:03:43.438Z | E08 | tool edit (call call_896ba1ea547f47cba3770a7b) | execution_failed: test/mul.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-14T16:03:49.076Z | E08 | tool look_graph (call call_163481470da94c3ab0efebf0) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T16:03:55.130Z | E08 | tool look_graph (call call_2ce8a764ea5340dca17e9716) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T16:03:58.530Z | E08 | tool look_graph (call call_80debf79b7b14879a9bd5554) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T16:04:03.277Z | E08 | tool look_graph (call call_ba1616d3365d488e8beed0a0) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T16:04:03.286Z | E08 | tool look_graph (call call_44fd6e32306a4e8faf1d4097) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T16:04:08.497Z | E08 | tool find_graph (call call_6c2cd3111d2746418124fe3e) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-14T16:35:35.134Z | E09 | tool run_readonly_command (call call_944b2f8cda2e416dafc7ad8e) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-14T16:40:45.760Z | E09 | tool read (call call_d8422099e02341de9faa0d26) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-14T16:41:26.166Z | E09 | tool edit (call call_a180bcb1c2a543a6a598c588) | execution_failed: test/report.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-14T16:42:51.359Z | E09 | tool record_note (call call_92963711294642bc9fbccc5a) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-14T16:43:01.736Z | E09 | tool hand_off (call call_c911d9ab16764aad9ffbb8dc) | execution_failed: HandoffAction.input.assignments[0].target is the source Session | 无理由 | - | 待定 |
| 2026-11-14T16:43:15.016Z | E09 | tool send_session_message (call call_234d5ea61e634c91a2bbf8f9) | not_found: the requested record does not exist | 无理由 | - | 待定 |
| 2026-11-14T16:43:21.101Z | E09 | tool send_session_message (call call_f29dc10d5ea648f9bfa2ab40) | not_found: the requested record does not exist | 无理由 | - | 待定 |
| 2026-11-14T16:43:42.214Z | E09 | tool request_rework (call call_11791c2e2e354c2599ebd445) | busy: the selected Run has not ended; stop or reconcile it first | 协调 | - | 待定 |
| 2026-11-14T16:43:57.396Z | E09 | tool record_note (call call_f5bbd6c5c0c24f6184127f54) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedVersion" | 安全 | - | 待定 |
| 2026-11-14T16:44:12.091Z | E09 | tool record_note (call call_d1e65504d6ae414f96cd7e85) | invalid_arguments: 工具参数不符合 schema：expectedVersion: Invalid input: expected number, received undefined; (根): Unrecognized key: "kind" | 安全 | - | 待定 |
| 2026-11-14T16:45:32.922Z | E09 | tool edit (call call_f0cf89376f434f56a10c85ae) | invalid_arguments: 工具参数不符合 schema：oldText: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-14T16:47:20.174Z | E09 | tool record_note (call call_ad1b6448bfb2465c8cfbdad6) | forbidden: only a scribe, the author or the user may change a disposition | 无理由 | - | 待定 |
| 2026-11-14T16:49:38.911Z | E09 | tool record_note (call call_bee4bdaef9254b4c914f513d) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedVersion" | 安全 | - | 待定 |
| 2026-11-14T19:06:38.130Z | E12 | tool run_readonly_command (call call_8041bf59c31f4132aa975c0e) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-14T19:12:41.355Z | E12 | tool read (call call_87aa3863141d4f16a2dfd879) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-14T19:12:51.027Z | E12 | tool look_graph (call call_698af2dcad90434fb814c1bd) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T19:12:55.707Z | E12 | tool edit (call call_4c7ecc861f594e29a758002e) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-14T20:37:50.526Z | iteration | tool submit_secretary_answer (call call_d250e44613944578877b3fd0) | invalid_arguments: 工具参数不符合 schema：ideas: Invalid input: expected array, received undefined | 无理由 | - | 待定 |
| 2026-11-14T20:43:46.209Z | iteration | tool look_graph (call call_ec631131666449398c3b7f46) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T20:43:46.216Z | iteration | tool look_graph (call call_0e524aeee58f4d1b8c2340a8) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T20:43:46.223Z | iteration | tool look_graph (call call_5e227505e76446d58a6c7db1) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T20:44:40.110Z | iteration | tool read (call call_f0b7853c09144a04860003a9) | execution_failed: test 不是普通文件 | 无理由 | - | 待定 |
| 2026-11-14T21:38:01.291Z | intervention | tool read (call call_9ecd11e5964b484b8c1a7149) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-14T21:44:22.570Z | intervention | tool edit (call call_403f96b208a1491ebe3e0aed) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-14T22:38:53.819Z | waiting | tool submit_initial_plan (call call_5a211cd66c1e4f618e77d69e) | invalid_arguments: 工具参数不符合 schema：goalCardDrafts.0.autonomy: Invalid option: expected one of "every_step"\|"after_plan_confirmation"; (根): Unrecognized key: "goalCardDraftsNote" | 安全 | - | 待定 |
| 2026-11-14T23:39:24.002Z | C-216 | tool look_graph (call call_95752e5cd52f4c5f80b70d88) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-14T23:45:56.760Z | C-216 | tool read (call call_39a0846288204c83ab742134) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-14T23:46:07.148Z | C-216 | tool look_graph (call call_639512092f794a6581caee20) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T01:16:29.235Z | C-221 | tool read (call call_2829bb104d9544bc886f206e) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T01:16:36.329Z | C-221 | tool look_graph (call call_627af0425b4c462bb551f62e) | not_found: anchor_not_found | 无理由 | - | 待定 |
| 2026-11-15T01:16:36.337Z | C-221 | tool look_graph (call call_810cf611cd064f2ca4398820) | not_found: anchor_not_found | 无理由 | - | 待定 |
| 2026-11-15T01:16:46.902Z | C-221 | tool edit (call call_f3c345e617a04d47a7cf7e18) | execution_failed: test/fizzbuzz.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T02:40:54.145Z | C-222 | tool create_member (call call_834b93045cc144b88fc56aff) | invalid: no_responsible_adviser | 无理由 | - | 待定 |
| 2026-11-15T02:45:40.206Z | C-222 | tool edit (call call_93509496f49941938ff62717) | execution_failed: test/shapes.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T02:45:55.058Z | C-222 | tool look_graph (call call_c87705420d234542a652cabe) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T02:45:57.897Z | C-222 | tool look_graph (call call_e1b1603e955048df9dea47a5) | forbidden: the Module node is outside the requested project | 无理由 | - | 待定 |
| 2026-11-15T05:13:07.874Z | compaction | tool run_readonly_command (call call_e016c3a057834226ad628b84) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-15T05:15:08.941Z | compaction | tool submit_initial_plan (call call_c623671d0c4c40d5aaac6f33) | invalid_arguments: 工具参数不符合 schema：plan.tasks.1: Unrecognized key: "dependsOnNote" | 安全 | - | 待定 |
| 2026-11-15T05:15:29.107Z | compaction | tool submit_initial_plan (call call_c5515d92e97546cd9a2fcf8d) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-15T05:15:48.502Z | compaction | tool submit_initial_plan (call call_e2b93c3139594be796e7d673) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-15T05:16:06.264Z | compaction | tool submit_initial_plan (call call_42964fa390724db985756e0a) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T05:17:04.150Z | compaction | tool run_readonly_command (call call_e06266e3261d4ad4b9e1930a) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 0ea2fc95-5820-47eb-a44c-a169639dddeb）
- usage（C-214）：pass。usageStatus reported，输入 29183，输出 92，缓存命中 25728
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 92 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"0ea2fc95-5820-47eb-a44c-a169639dddeb","reservedOutput":131072,"usageStatus":"reported","inputTokens":29183,"outputTokens":92,"cachedInputTokens":25728},{"requestId":"828901af-0138-48ff-9767-6049accf2fa4","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 828901af-0138-48ff-9767-6049accf2fa4: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId fd786aba-9c86-49a9-a89f-08bc7501bd46）
- usage（C-214）：pass。usageStatus reported，输入 16004，输出 96，缓存命中 384
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 96 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"fd786aba-9c86-49a9-a89f-08bc7501bd46","reservedOutput":64000,"usageStatus":"reported","inputTokens":16004,"outputTokens":96,"cachedInputTokens":384}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImJhNDhlY2EzNmQ2MjUxMDA3MTk3YTNiYjQ3MGQwMjJiIiwic2Vzc2lvbklkIjoic2Vzc2lvbi03NmQzZmNhMTE2ZjgxOTNjZjQ0ZDFlYWMzZjA4Y2MxNjk1NzRhMjhjY2RjNDJjNWZiYWY0M2JiZmQxYTJkMjhiIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1iNDJiYTYxNThkN2Q2NGNlNjFmYjQxMGNkYWM4MzhhMyIsImsiOiJzZXNzaW9uLTc2ZDNmY2ExMTZmODE5M2NmNDRkMWVhYzNmMDhjYzE2OTU3NGEyOGNjZGM0MmM1ZmJhZjQzYmJmZDFhMmQyOGIiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjQ1fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImJhNDhlY2EzNmQ2MjUxMDA3MTk3YTNiYjQ3MGQwMjJiIiwic2Vzc2lvbklkIjoic2Vzc2lvbi03NmQzZmNhMTE2ZjgxOTNjZjQ0ZDFlYWMzZjA4Y2MxNjk1NzRhMjhjY2RjNDJjNWZiYWY0M2JiZmQxYTJkMjhiIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1iNDJiYTYxNThkN2Q2NGNlNjFmYjQxMGNkYWM4MzhhMyIsImsiOiJzZXNzaW9uLTc2ZDNmY2ExMTZmODE5M2NmNDRkMWVhYzNmMDhjYzE2OTU3NGEyOGNjZGM0MmM1ZmJhZjQzYmJmZDFhMmQyOGIiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjcxfQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImJhNDhlY2EzNmQ2MjUxMDA3MTk3YTNiYjQ3MGQwMjJiIiwic2Vzc2lvbklkIjoic2Vzc2lvbi03NmQzZmNhMTE2ZjgxOTNjZjQ0ZDFlYWMzZjA4Y2MxNjk1NzRhMjhjY2RjNDJjNWZiYWY0M2JiZmQxYTJkMjhiIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1iNDJiYTYxNThkN2Q2NGNlNjFmYjQxMGNkYWM4MzhhMyIsImsiOiJzZXNzaW9uLTc2ZDNmY2ExMTZmODE5M2NmNDRkMWVhYzNmMDhjYzE2OTU3NGEyOGNjZGM0MmM1ZmJhZjQzYmJmZDFhMmQyOGIiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjEwNX0:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImJhNDhlY2EzNmQ2MjUxMDA3MTk3YTNiYjQ3MGQwMjJiIiwic2Vzc2lvbklkIjoic2Vzc2lvbi03NmQzZmNhMTE2ZjgxOTNjZjQ0ZDFlYWMzZjA4Y2MxNjk1NzRhMjhjY2RjNDJjNWZiYWY0M2JiZmQxYTJkMjhiIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1iNDJiYTYxNThkN2Q2NGNlNjFmYjQxMGNkYWM4MzhhMyIsImsiOiJzZXNzaW9uLTc2ZDNmY2ExMTZmODE5M2NmNDRkMWVhYzNmMDhjYzE2OTU3NGEyOGNjZGM0MmM1ZmJhZjQzYmJmZDFhMmQyOGIiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjQ1fQ）2057 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 e4e20868-aa3d-4f5a-affd-cc6288207e31：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 e4e20868-aa3d-4f5a-affd-cc6288207e31：输入 32450，缓存命中 0（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01

### C-216：fail

- observed-start（C-216）：pass。采用的架构模块路径：src/report.js, src/store.js, test/
- adopted-done（C-216）：fail。the platform did not do it: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:a6b29ce5c2c204b75a945d5adcd2fdf2471faffa0336074b12dcddade822dfa0 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:a6b29ce5c2c204b75a945d5adcd2fdf2471faffa0336074b12dcddade822dfa0 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:a6b29ce5c2c204b75a945d5adcd2fdf2471faffa0336074b12dcddade822dfa0 (RUNNING): pause because C-216 ended: committed

### C-221：fail

- first-plan（C-221）：pass。首案采用 initial-plan-be7fe6e4e48f1572b85c59814d98dfec
- fail-rework（C-221）：fail。the platform did not do it: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:9a33dae4f4ceb75c126d78c3e5ed74c4a4c83ae718d7b7ae4ffaf7e93cd90e0c to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- delivered（C-221）：uncovered (not-run)。stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:9a33dae4f4ceb75c126d78c3e5ed74c4a4c83ae718d7b7ae4ffaf7e93cd90e0c to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:9a33dae4f4ceb75c126d78c3e5ed74c4a4c83ae718d7b7ae4ffaf7e93cd90e0c to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:9a33dae4f4ceb75c126d78c3e5ed74c4a4c83ae718d7b7ae4ffaf7e93cd90e0c (NEEDS_DECISION): pause because C-221 ended: committed

### C-222：fail

- created（C-222）：fail。the platform did not do it: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:1bfb7550ee3ead4a1b74013612eeccd0a47ce1e60fa1102c769f808ed16ac256 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- started（C-222）：uncovered (not-run)。stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:1bfb7550ee3ead4a1b74013612eeccd0a47ce1e60fa1102c769f808ed16ac256 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:1bfb7550ee3ead4a1b74013612eeccd0a47ce1e60fa1102c769f808ed16ac256 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:1bfb7550ee3ead4a1b74013612eeccd0a47ce1e60fa1102c769f808ed16ac256 (RUNNING): pause because C-222 ended: committed

### B06：fail

- W1a（B06-W1a）：fail。the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W2（B06-W2）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W3（B06-W3）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W5（B06-W5）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W10（B06-W10）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W12（B06-W12）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:09ab8cde12c67b5c1043fa930af00ea55cd84a88269c8c56560330c8350e9f0f (RUNNING): pause because B06 ended: committed

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 14200213（输入 14069256，输出 130957；缓存命中 12480640）；Query 请求 147 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 18 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零，会让计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- A1：用量 29275（输入 29183，输出 92，缓存命中 25728；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- B1：用量 16100（输入 16004，输出 96，缓存命中 384；Query 请求 1（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- E05：用量 999478（输入 990684，输出 8794，缓存命中 871680；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 2）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- E08：用量 1302416（输入 1290883，输出 11533，缓存命中 1141120；Query 请求 24（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 2）
- E09：用量 5898366（输入 5864999，输出 33367，缓存命中 5612288；Query 请求 12（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 3）
- E12：用量 475079（输入 470763，输出 4316，缓存命中 377984；Query 请求 6（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- iteration：用量 1054353（输入 1045018，输出 9335，缓存命中 907904；Query 请求 13（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 2）
- intervention：用量 448559（输入 443533，输出 5026，缓存命中 347392；Query 请求 8（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- waiting：用量 416133（输入 411437，输出 4696，缓存命中 314880；Query 请求 10（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- C-216：用量 1197252（输入 1186103，输出 11149，缓存命中 1017600；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 3）
- C-221：用量 501418（输入 494824，输出 6594，缓存命中 397952；Query 请求 6（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- C-222：用量 581002（输入 575822，输出 5180，缓存命中 479104；Query 请求 7（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- B06：用量 357925（输入 354031，输出 3894，缓存命中 262016；Query 请求 8（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- compaction：用量 922857（输入 895972，输出 26885，缓存命中 724608；Query 请求 24（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）

## 延迟探针

- wa#0：{"startedAt":"2026-11-14T14:44:47.132Z","writtenAt":"2026-11-14T14:49:54.997Z","samples":15181,"p50Ms":20.5,"p95Ms":20.77,"p99Ms":21.12,"maxMs":284.69,"meanMs":20.62}；关闭 SIGINT, exit 0 after 40 ms
- wb#0：{"startedAt":"2026-11-14T14:49:55.056Z","writtenAt":"2026-11-14T14:56:02.024Z","samples":18131,"p50Ms":20.51,"p95Ms":20.74,"p99Ms":21,"maxMs":224.4,"meanMs":20.57}；关闭 SIGINT, exit 0 after 24 ms
- w-accept#0：{"startedAt":"2026-11-14T14:56:02.061Z","writtenAt":"2026-11-15T05:12:15.267Z","samples":2554661,"p50Ms":20.99,"p95Ms":21.74,"p99Ms":22.05,"maxMs":2054.16,"meanMs":21.03}；关闭 SIGINT, exit 0 after 373 ms
- compaction#0：{"startedAt":"2026-11-15T05:12:15.339Z","writtenAt":"2026-11-15T05:17:54.025Z","samples":16778,"p50Ms":21.56,"p95Ms":22.07,"p99Ms":22.5,"maxMs":437.78,"meanMs":21.82}；关闭 SIGINT, exit 0 after 45 ms

## 其它记录

- 2026-11-14T14:49:54.931Z A1: g6-a1-mwgiopf2-4 (BLOCKED): pause because wa closes: committed
- 2026-11-14T14:49:54.946Z A1: A1: request 828901af-0138-48ff-9767-6049accf2fa4 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-14T14:56:01.974Z B1: g6-b1-mwgivaqp-15 (BLOCKED): pause because wb closes: committed
- 2026-11-15T05:17:54.039Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
