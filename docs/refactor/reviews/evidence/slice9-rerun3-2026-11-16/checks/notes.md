# G6 notes 2026-11-15（运行号 g6-2026-11-15-013c515b）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 572575（含缓存命中），输出 7073，缓存命中 468608，Query 请求 11。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| gate | C-185 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| paths | C-185, C-217 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| kept | C-185 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| single-occupancy | C-71 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| convention | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| duplicates | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| reviewer | C-208, C-218 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| name-different | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| name-same | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| temporary | C-208 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| line-choice | C-73, C-191 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:7801cdafaf345dae7ce0c663e969321087083e0bfc728f2e4f8c523de7c62f4f (RUNNING): pause because E05 ended: committed

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
- 用量：输入 1150075（含缓存命中），输出 19885，缓存命中 999680，Query 请求 20。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-0cafe04ebf854cafba67c243ae25af68；Goal 指针 {"aggregateType":"PlanRevision","projectId":"48922d823002f311dbe63303bd78c194","planId":"initial-plan-0cafe04ebf854cafba67c243ae25af68"} |
| versions | C-210 | fail | the platform did not do it: timed out after 30 min waiting for the changed plan candidate |
| switch | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| old-evidence | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: timed out after 30 min waiting for the changed plan candidate |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- stopped: not-run: timed out after 30 min waiting for the changed plan candidate
- goal-confirm:goal.confirmDraft:1a9f8f9650b798fefbfe7532adb737dc9e669903f3c28cb0a922f65ed3842151 (RUNNING): pause because E08 ended: committed

### E09：uncovered

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2799574（含缓存命中），输出 33814，缓存命中 2592896，Query 请求 16。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | pass | 执行者上报 （结果里没有消息引用）：{"intent":"inquiry","needsReply":true,"recipient":{"projectId":"4f04df80bae332af4dc8a29a40b20557","sessionId":"session-4dece003034287bce33cefba011ba1961e8ab660526c0e548468c52544f2740d"},"text":"B-month-of（在 src/report.js 实现 monthOf）只读问询，不改你的计划，也不要求你做额外动作。\n\n我读到的事实：src/api.js 目前只有一行注释 `// The date API lives here.`，没有任何导出；A-parse-date 在任务卡上仍是 pending、无执行记录。因此 report 侧 `import { dateParts } from './api.js'` 现在会解析到 undefined，node --test 无法通过。\n\n按任务卡与 dated 模块接口记录，我实现的约定是：\n- monthOf(text) -> {y, m}，m 为 1-12 自然月\n- 实现方式：import { dateParts } from './api.js'，直接取 dateParts(text) 的 y 与 m，不复制任何解析逻辑，不改 src/api.js\n\n想确认两点（回答你已定的约定即可，不必承诺实施）：\n1. dateParts(text) 是否就按 {y, m, d}、m 自然月 1-12、内部调用 parseDate 的形态导出？\n2. 非法文本（含 2024-02-30 越界、空串、非字符串）是否统一抛 RangeError？report 侧测试依赖这一点，把错误原样向上传播不断言具体类型名也行，但如果统一 RangeError 我就直接断言 it.\n\n我这边不阻塞在答复上，会先把 tests/report.test.js 按上述约定写好。","waitAfterSend":false} |
| adviser-explains | C-211 | uncovered (entry-missing) | 接不上：上报工具结果里读不到消息引用 |
| person-decides | C-211, C-62 | uncovered (entry-missing) | 接不上：上报工具结果里读不到消息引用 |
| new-version | C-211, C-55 | uncovered (entry-missing) | 接不上：上报工具结果里读不到消息引用 |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 5 条 finding；带路径的：package.json, README.md, src/report.js, tests/api.test.js, tests/report.test.js |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"4f04df80bae332af4dc8a29a40b20557","workspaceId":"97c59e957706c44af26ca6bd82b472f9","captureId":"f167a17d-e84c-475c-947d-b8995c475d70"} |
| observation-after-pass | C-98 | pass | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"4f04df80bae332af4dc8a29a40b20557","workspaceId":"97c59e957706c44af26ca6bd82b472f9","captureId":"f167a17d-e84c-475c-947d-b8995c475d70"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"4f04df80bae332af4dc8a29a40b20557","workspaceId":"97c59e957706c44af26ca6bd82b472f9","captureId":"3dea0909-0b71-460c-beda-7c96e33666d8"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：A-parse-date PASS/gaps 0, B-month-of PASS/gaps 0 |
| uncovered-round | C-99 | uncovered (not-run) | 这次没有出现缺覆盖（INCONCLUSIVE）的检查轮 |

- E09 Goal ended COMPLETED
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：fail

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 920936（含缓存命中），输出 9903，缓存命中 801408，Query 请求 20。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | pass | QueryRun 3→3，输入 258960→258960，changesHead h0000000861→h0000000861 |
| graph-cards | C-88, C-89 | pass | goal children 2，find 4，path 卡 有 |
| raw-history | C-42, C-157 | pass | 线的原历史 57 条，Run 历史 56 条 |
| completion-chain | C-104 | pass | 检查轮卡 2 张，有非空 evidenceRefs：true |
| restart-state | C-145, C-215 | pass | 重启后旧 Goal COMPLETED，计划 initial-plan-f357051029d35920c6ff1ed9f18c45f5，Run 1/1 |
| reconcile | C-146 | pass | host/reconcile-report：lease owned |
| redrive-sets | C-155 | pass | 旧 Goal 的 causes：[] |
| new-goal | C-114, C-158 | fail | the platform did not do it: the new request gave no Goal card draft |
| history-reuse | C-220 | uncovered (not-run) | stopped before this check: the new request gave no Goal card draft |
| stale-premise | C-220 | uncovered (not-run) | stopped before this check: the new request gave no Goal card draft |
| replay | C-147 | uncovered (not-run) | stopped before this check: the new request gave no Goal card draft |
| wait-registry | C-207 | uncovered (not-run) | stopped before this check: the new request gave no Goal card draft |

- restart: SIGINT, exit 0 after 157 ms
- stopped: not-run: the new request gave no Goal card draft

### iteration：fail

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 518304（含缓存命中），输出 7627，缓存命中 462208，Query 请求 13。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | fail | the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| select | C-109 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| candidate | C-110 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| what-changed | C-213, C-110 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| per-request | C-111 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| why | C-112, C-226 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| continues | C-105 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| request-goal | C-107 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| cards-ask | C-113 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| multi-round | C-194 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:a516329ddce6d322702e26bca8c04f6eb526006bdf3fc7321c81f114a0a7e543 (RUNNING): pause because iteration ended: committed

### intervention：fail

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 819261（含缓存命中），输出 11061，缓存命中 704512，Query 请求 15。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | fail | the platform did not do it: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| delivery-states | C-189, C-192 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| continue-no-planning | C-199 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| planning-when-idle | C-199, C-200 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| four-endings | C-201, C-202, C-203 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| completed-goal | C-114 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| paused-queues | C-197 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |

- stopped: not-run: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON
- goal-confirm:goal.confirmDraft:281e069524db8c1a875813fd2da4b7623ec43aeeca85fb940921b8725eaef1eb (PLANNING): pause because intervention ended: committed

### waiting：uncovered

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 593290（含缓存命中），输出 7902，缓存命中 508672，Query 请求 9。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | pass | 成员 session-5f27086215ed48bbe8a58523355e45b32fd76ae774c7bf2ab224e3d0a1053e9e 的 Work（Run 82f31a81-dd1e-45a2-8360-213e586d2719，现在 ended/yielded）经工具发出等待 session-message-09f4c3bd3f6511934ca3e90dc2c60a1cf2fd5a7888533251b484186661446514：收信人 session-01c93af5bd6bea94ffa444eeca82a137b5ab0c3103ada25dacf03b2f50c37f8b，期限 2026-11-15T13:43:39.712Z，waitAfterSend true |
| restart-kept | C-170, C-207 | pass | 重启后同一等待：expired，期限 2026-11-15T13:43:39.712Z |
| expiry-once | C-171, C-190 | uncovered (not-run) | stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts |
| second-expiry | C-171, C-190, C-224 | uncovered (not-run) | stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts |
| consumes | C-187 | uncovered (not-run) | stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts |
| late-reply | C-224, C-189 | uncovered (not-run) | stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts |
| transfer | C-224 | uncovered (not-run) | stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts |
| disconnect | C-195, C-196 | uncovered (not-run) | stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts |

- close and restart: SIGINT, exit 0 after 221 ms
- restart: resumeOnStartup = ask
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- g6-wait-mwhvuygs-58 (RUNNING): pause because waiting ended: committed
- waiting ended: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-15T10:27:16.860Z | A1 | core/completion-policies/read | not_found: project a114181c21fa33622f83ff38ae3391e2 has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-15T10:32:05.479Z | B1 | core/completion-policies/read | not_found: project g6-wb has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-15T10:37:54.509Z | B1 | tool read (call call_01_R0VFyPX1tdfyGiT6JynP2673) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T10:38:16.172Z | E05 | tool read (call call_ae192c4008ba4fa487f9850f) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T10:38:49.047Z | E05 | tool submit_initial_plan (call call_ec3a42a399f54832b40fa92e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T10:44:37.113Z | E05 | tool look_graph (call call_e5d8fa25341c414783508347) | not_found: anchor_not_found | 无理由 | - | 待定 |
| 2026-11-15T11:39:41.660Z | E08 | tool create_member (call call_ad235db2bf58430399bbfdc8) | invalid: no_responsible_adviser | 无理由 | - | 待定 |
| 2026-11-15T11:40:01.477Z | E08 | tool submit_initial_plan (call call_417f9b29895b41618cbe2d3b) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T11:40:24.668Z | E08 | tool submit_initial_plan (call call_6cd46d8962774badb7edfa20) | invalid_arguments: 工具参数不符合 schema：setup.completionPolicy: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-15T11:40:43.402Z | E08 | tool submit_initial_plan (call call_376f23d36553489096d31e8d) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T11:41:14.315Z | E08 | core/goals/confirm-draft confirm-again-mwhrkgqz-28 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-15T11:41:14.326Z | E08 | core/goals/control goals-control-mwhrkgra-29 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-15T11:44:34.855Z | E08 | tool edit (call call_01_WEuaSuZTORV4ppgOP7hI2597) | execution_failed: test/mul.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T11:44:40.520Z | E08 | tool look_graph (call call_fee50e7e3f5044e8b8b9b5fb) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T11:44:40.527Z | E08 | tool look_graph (call call_1822ec70fc4342dca7ab82cd) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T12:15:56.822Z | E09 | tool run_readonly_command (call call_8ba2217d9ec3448a8cd07445) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-15T12:16:18.895Z | E09 | tool submit_initial_plan (call call_79cdce6e9df74bab9cbf8abd) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T12:16:39.410Z | E09 | tool submit_initial_plan (call call_a6698942c5c64f42b97e82fb) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-15T12:20:46.810Z | E09 | tool edit (call call_00_A5dMQ0qMB4nl4gIssydE7075) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 安全 | - | 待定 |
| 2026-11-15T12:20:49.474Z | E09 | tool edit (call call_00_mdXCphmTrbb7euSczEOk4780) | execution_failed: tests/report.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T12:20:51.766Z | E09 | tool run_readonly_command (call call_2c04619710d84b6f91c26d6b) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-15T12:20:52.531Z | E09 | tool shell (call call_00_pJQcot2IJTSCl4szW90r6107) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |
| 2026-11-15T12:21:16.074Z | E09 | tool send_session_message (call call_00_tkVGmzpJJqcd6E2AEKfn3750) | invalid: a goal-bearing action_request requires the expected basis | 产品规则 | - | 待定 |
| 2026-11-15T12:21:28.753Z | E09 | tool record_note (call call_00_YMVSX0FrQSanbNDCigmi9421) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'review' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-15T12:21:28.799Z | E09 | tool record_note (call call_01_HEPxISpeoNuXgoRKteZs9636) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'review' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-15T12:22:01.661Z | E09 | tool edit (call call_00_R37XnbA0KYrqsSChfZOH0859) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-15T12:22:13.934Z | E09 | tool edit (call call_00_ApkgneuZ1RkNswWka3pr2583) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 安全 | - | 待定 |
| 2026-11-15T12:23:05.077Z | E09 | tool record_note (call call_00_1W8bs8cRIUrqMWU9y7fL4085) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-15T12:23:05.104Z | E09 | tool record_note (call call_01_zWuJRbOHSvXzazIASjRA6855) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-15T12:24:06.896Z | E12 | tool submit_initial_plan (call chatcmpl-tool-8edf269ba782ee99) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T12:27:31.624Z | E12 | tool read (call call_89b90ae463e64255982c2c50) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T12:27:47.395Z | E12 | tool edit (call call_9e530de71c4448bea4cd40c9) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T12:29:41.873Z | E12 | tool look_graph (call chatcmpl-tool-9caef8f0e631b828) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T12:29:45.623Z | E12 | tool look_graph (call chatcmpl-tool-a41f2638293948d0) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T12:29:49.699Z | E12 | tool look_graph (call chatcmpl-tool-9a8e02e2c8398dd0) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T12:30:04.365Z | E12 | tool look_graph (call chatcmpl-tool-939dff6a686f095f) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T12:30:07.628Z | E12 | tool look_graph (call chatcmpl-tool-b60265e787c1326f) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T12:30:11.734Z | E12 | tool look_graph (call chatcmpl-tool-ae82e984a4f1aee0) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T12:30:11.743Z | E12 | tool look_graph (call chatcmpl-tool-83168dc6bebb60ce) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T12:31:23.569Z | iteration | tool submit_initial_plan (call call_c7d7bee2f0364cadb1970bab) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T12:31:36.922Z | iteration | tool submit_initial_plan (call call_77dd870ec6314ae285f95642) | invalid_arguments: 工具参数不符合 schema：plan.obligations.0: Unrecognized key: "verificationRequirements_note"; planDraftIndex: Invalid input: expected number, received undefined | 安全 | - | 待定 |
| 2026-11-15T12:34:31.305Z | iteration | tool read (call call_16af1d97b56240879544b658) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T13:32:19.575Z | intervention | tool submit_initial_plan (call call_00_W7kDCHltQIQF5Zgr3WXz3488) | invalid_arguments: 工具参数不符合 schema：setup.architecture.constraints.1.scope: Invalid input: expected string, received undefined; setup.architecture.constraints.2.scope: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-15T13:32:28.820Z | intervention | tool submit_initial_plan (call call_00_iSyFBvc53UhUnwSoLWUG3478) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T13:35:49.960Z | intervention | tool read (call call_01_5ylij47uc23hmmjuvzy6yi1r) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T13:36:08.631Z | intervention | tool edit (call call_00_0rjcxnp3uoqaygp2elbkg5rp) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T13:37:34.123Z | intervention | core/initialization/adopt adopt-mwhvq2ej-53 | invalid: the initial-planning answer is not valid JSON | 无理由 | - | 待定 |
| 2026-11-15T13:37:49.426Z | waiting | tool run_readonly_command (call call_8442398dc8fc453aabcc2185) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-15T13:38:05.026Z | waiting | tool submit_initial_plan (call call_63248d45fbc142af8e995f68) | invalid_arguments: 工具参数不符合 schema：setup: Unrecognized key: "checksNote" | 安全 | - | 待定 |
| 2026-11-15T13:38:16.087Z | waiting | tool submit_initial_plan (call call_86b34a488f904a54abb9999a) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T13:40:48.318Z | waiting | tool read (call call_3b5b990a21b747189b59850b) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T13:41:29.648Z | waiting | tool send_session_message (call call_5f6217d8c38e4202b2c4938f) | forbidden: the recipient Session belongs to another project | 无理由 | - | R45（决定 121-149：拒绝原文写出调用方的项目号，Work 输入的目标段带 `projectId`） |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId f91fa089-8685-4328-88de-cc2f29937845）
- usage（C-214）：pass。usageStatus reported，输入 29534，输出 89，缓存命中 3200
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 89 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"f91fa089-8685-4328-88de-cc2f29937845","reservedOutput":131072,"usageStatus":"reported","inputTokens":29534,"outputTokens":89,"cachedInputTokens":3200},{"requestId":"9580f589-fdd6-4484-9bf3-a14bdc00422e","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 9580f589-fdd6-4484-9bf3-a14bdc00422e: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId cffe95c5-f3f4-455a-aab2-e890b2c5fbb0）
- usage（C-214）：pass。usageStatus reported，输入 16204，输出 96，缓存命中 12800
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 96 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"cffe95c5-f3f4-455a-aab2-e890b2c5fbb0","reservedOutput":64000,"usageStatus":"reported","inputTokens":16204,"outputTokens":96,"cachedInputTokens":12800},{"requestId":"9d5d56af-60e1-4d96-ae23-e559c6b3f62c","reservedOutput":63904,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request 9d5d56af-60e1-4d96-ae23-e559c6b3f62c: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### 压缩：uncovered

- compacted（K2-P2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- six-sections（K2-P2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- accepted（K2-P2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- cache-after（K2-P2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

### C-216：uncovered

- observed-start（C-216）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- adopted-done（C-216）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

### C-221：uncovered

- first-plan（C-221）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- fail-rework（C-221）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- delivered（C-221）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

### C-222：uncovered

- created（C-222）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- started（C-222）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

### B06：uncovered

- W1a（B06-W1a）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W2（B06-W2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W3（B06-W3）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W5（B06-W5）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W10（B06-W10）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W12（B06-W12）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 7517203（输入 7419753，输出 97450；缓存命中 6553984）；Query 请求 108 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 11 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零，会让计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 计量不可用：request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- A1：用量 29623（输入 29534，输出 89，缓存命中 3200；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- B1：用量 16300（输入 16204，输出 96，缓存命中 12800；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- E05：用量 579648（输入 572575，输出 7073，缓存命中 468608；Query 请求 11（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- E08：用量 1169960（输入 1150075，输出 19885，缓存命中 999680；Query 请求 20（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 2）
- E09：用量 2833388（输入 2799574，输出 33814，缓存命中 2592896；Query 请求 16（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 3）
- E12：用量 930839（输入 920936，输出 9903，缓存命中 801408；Query 请求 20（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- iteration：用量 525931（输入 518304，输出 7627，缓存命中 462208；Query 请求 13（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- intervention：用量 830322（输入 819261，输出 11061，缓存命中 704512；Query 请求 15（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- waiting：用量 601192（输入 593290，输出 7902，缓存命中 508672；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 2）

## 延迟探针

- wa#0：{"startedAt":"2026-11-15T10:27:14.976Z","writtenAt":"2026-11-15T10:32:03.520Z","samples":14497,"p50Ms":21.74,"p95Ms":22.17,"p99Ms":22.3,"maxMs":305.92,"meanMs":21.66}；关闭 SIGINT, exit 0 after 40 ms
- wb#0：{"startedAt":"2026-11-15T10:32:03.584Z","writtenAt":"2026-11-15T10:38:06.020Z","samples":17915,"p50Ms":20.68,"p95Ms":21.73,"p99Ms":22.05,"maxMs":221.64,"meanMs":20.87}；关闭 SIGINT, exit 0 after 25 ms
- w-accept#0：{"startedAt":"2026-11-15T10:38:06.075Z","writtenAt":"2026-11-15T12:28:24.654Z","samples":326021,"p50Ms":20.17,"p95Ms":20.4,"p99Ms":21.4,"maxMs":1286.6,"meanMs":20.31}；关闭 SIGINT, exit 0 after 157 ms
- w-accept#1：{"startedAt":"2026-11-15T12:28:24.721Z","writtenAt":"2026-11-15T13:41:43.087Z","samples":216454,"p50Ms":20.14,"p95Ms":20.3,"p99Ms":20.82,"maxMs":375.13,"meanMs":20.32}；关闭 SIGINT, exit 0 after 221 ms
- w-accept#2：{"startedAt":"2026-11-15T13:44:43.293Z","writtenAt":"2026-11-15T13:44:52.519Z","samples":321,"p50Ms":20.19,"p95Ms":35.52,"p99Ms":136.45,"maxMs":749.73,"meanMs":25.73}；关闭 SIGINT, exit 0 after 3785 ms

## 其它记录

- 2026-11-15T10:32:03.448Z A1: g6-a1-mwhoxcu2-4 (BLOCKED): pause because wa closes: committed
- 2026-11-15T10:32:03.467Z A1: A1: request 9580f589-fdd6-4484-9bf3-a14bdc00422e counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-15T10:38:05.967Z B1: g6-b1-mwhp3jja-15 (BLOCKED): pause because wb closes: committed
- 2026-11-15T10:38:05.984Z B1: B1: request 9d5d56af-60e1-4d96-ae23-e559c6b3f62c counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-15T13:44:47.331Z waiting: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- 2026-11-15T13:44:48.706Z -: w-accept closes: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- 2026-11-15T13:44:52.542Z -: the run stopped early: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- 2026-11-15T13:44:52.542Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
