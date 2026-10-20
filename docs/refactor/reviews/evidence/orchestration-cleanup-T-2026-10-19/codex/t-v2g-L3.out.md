本次仍未达到“完整枚举”。下面列出已确认实例、42 个无本题实例的文件，以及尚未完成 A1 枚举的文件。计数按静态调用位置计算，不展开 `.each`；“v2 允许”只评价所列输入或包装，不豁免同一测试中的 F4、F7。相关限制见 `.lead-ref/books/test-rule-sheet-v2.md:30`、`.lead-ref/books/test-rule-sheet-v1.md:77`。

**A1：已确认部分**

表内省略的同行行号沿用该行文件路径。

| 文件与行号 | owner；输入与来源；平台签发字段 | 后续是否只走公开步骤 | 裁定 |
|---|---|---|---|
| `tests/business/K3-46-review-advance-failures.test.ts:143,149` | `plans.proposePlan/applyPlanChange`；`:126,128` 公开读取后在 `:133` 编辑 draft；采用公开 proposal 引用 | 否；另有存储包装 `:269` | v2 允许，A1 公共计划输入 |
| `tests/business/K3-UR7-crr-failed-set.test.ts:338,344` | 同上；公开读取 `:321,323`，draft 构造 `:328` | 否；内部消息读取 `:301` | v2 允许，A1 |
| `tests/business/R5c-workflow.test.ts:140,155,161` | `goals.createGoal/plans`；手写目标、`:148` 的计划；proposal 引用来自公开返回 | 是，继续 `advanceWork:168` | v2 允许，A1 |
| `tests/business/S1-session-maintenance.test.ts:296,303` | `plans`；从 `currentPlan:292` 编辑 draft；采用后更新 `:308` | 否；Kernel 直写 `:454` | v2 允许，A1 |
| `tests/business/S5-decision-workflow.test.ts:192,230` | `goalSettings`；手写自治设置、目标顺序、版本条件；无签发字段 | 否；`storeSnapshot:205,207,257,259` | v2 允许，A1 |
| `tests/business/S5R2-settings-replay.test.ts:138` | `settings.setGoalSettings`；手写 `every_step`、版本 8；无签发字段 | 否；内部 `observeC:143,145` | v2 允许，A1 |
| `tests/runtime/C1-communication-tools.test.ts:244,252,258,263,267,271` | 邮箱工具；手写正文、分页、回复；消息引用来自公开返回 `:247,249` | 是，公开工具链 `:252–271` | v2 允许，A1 |
| `tests/runtime/C2-runtime-platform-tools.test.ts:157` | `messages.sendMessage`；手写正文、接收人；无签发字段 | 是，`startRun:163`、`readMessage:175` | v2 允许，A1 |
| `tests/runtime/S1-routed-replies.test.ts:97` | `messages.respondMessage`；手写回复；消息和版本来自公开读取 `:96` | 否；随后 `sourceInputs:100` | v2 允许，A1 |
| `tests/runtime/S4C-note-related-find.test.ts:26,28,29` | `notes.writeNote`；手写注记，经组外 `tests/helpers/S4A-note-fixture.ts:282` | 是，`memoryFind:46,55,70` | v2 允许，A1 |
| `tests/runtime/S4C2-assembly.test.ts:189,291,307` | `notes.writeNote`；手写注记；`:189` 经上述组外 helper；`:307` 的替换目标来自 `:291` 返回 | 否；正文存储读取 `:202` | v2 允许，A1 |
| `tests/runtime/S5-user-message-tools.test.ts:98,352` | `send_user_message/messages.sendMessage`；手写决策、询问正文；`:98` 参数来自 `tests/helpers/S5-user-message-support.ts:82` | 否；`storeSnapshot:113`、泵检查 `:391` | v2 允许，A1 |
| `tests/runtime/S5R2-agent-application.test.ts:143,198,298,335` | 计划工具／`plans.applyPlanChange`；`:50` 编辑计划；proposal、answer 引用来自前置步骤；`:298` 的 source 来自内部消息 `:174,182` | 否；事件、提交读取 `:187,227` | v2 允许，仅评价公共输入形状 |
| `tests/runtime/W2-whiteboard-tools.test.ts:268,322,338,349,396` | 计划工具；手写 draft、reason、expected；构造 `:59,67`；未把输出 receipt 作为输入 | 否；录制端口 `:117,123` | v2 允许，A1 不豁免 F4 |
| `tests/business/A2-workflow-result-mapping.test.ts:84,100,110` | `workflow.advanceWork`；`:71–73` 强转出仅有 `meta` 的 start／observe／finalize 请求；替身 `:57–68` 忽略请求 | 否 | **F1：完整参数合同条款**，v2 `:30–31` |
| `tests/business/K3-review-workflow-rows.test.ts:869,887,926` | `workflow.advanceWork`；`:810–813` 手造仅有 `meta` 的请求；替身 `:803,804` 返回保存的 Run | 否 | **F1：完整参数合同条款** |
| `tests/business/WP1-start-refusal.test.ts:18,43` | `workflow.advanceWork`；组外 helper 手造 manifest、prepared、摘要：`tests/helpers/WP1-units-fixture.ts:515,530,564`；`:559` 替身忽略请求 | 否 | **F1：平台派生值／prepared 条款**，v2 `:32–37` |
| `tests/runtime/S5-user-message-tools.test.ts:410,449` | 协作 driver，随后到 `runtime.startRun`；`:250` 读 manifest、`:255` 改写、`:265` 重建 prepared，`:377` 装入操作 | 否；`:347` 替身推进 | **F1：prepared 条款** |
| `tests/runtime/S5R2-agent-application.test.ts:241,282,374` | `record_decision_application/decisions.recordDecisionApplication`；从内部事件 `:187,217` 重建 receipt `:224` | 否；存储读取 `:248,289` | **F1：receipt 来源条款** |
| `tests/runtime/S3-graph-tools.test.ts:702,718,721` | `look_graph/find_graph`；手写游标 `c1/c0`，参数 `:703,719,722` | 否；录制端口接收 | **F1：cursor 来源条款** |
| `tests/runtime/S3-graph-tools.test.ts:955` | `plans.proposePlan`；draft 包含测试构造的 ArtifactRef；指纹计算 `:809–813`，装入 draft `:952,953` | 否；随后直写 Run `:978` | **F1：fingerprint 来源条款** |
| `tests/runtime/W2-role-skills.test.ts:188` | `query_ready_tasks`；手写 `prior-page` 游标；替身 `:172` 接受 | 否；`:207` 断言成功 | **F1：cursor 来源条款** |
| `tests/runtime/R4c-graph-history.test.ts:786,824,880,894` | `runtime.readSessionHistory`；位置来自 Kernel 存储读取 `:779,817,874`，重建 range `:784,826,878`；`:894` 虽使用公开 cursor，仍携带该 range | 否 | **F1：position 来源条款** |
| `tests/runtime/S5-user-message-tools.test.ts:203` | `mailbox.recordInputAccepted`；kernel 映射来自公开读取 `:198`，但 `position:7` 在 `:204` 手写 | 否；`storeSnapshot:211` | **F1：position／entered fact 条款** |
| `tests/runtime/K3-14-record-unknown-call-review-tool.test.ts:94,113` | `record_unknown_call_review`；`:80–83` 手写 `item:1`，没有公开步骤返回该条目号；执行封装 `:87` | 否；检查录制写入 `:101` | **F1：平台派生字段条款**；alias 分配见 `src/core/agent-runtime/unknown-call-draft.ts:190` |
| `tests/runtime/K3-16-proposal-tool.test.ts:103,120` | `propose_safer_method`；手写 `item:1/2`，来源 `:67–69,120` | 否；检查录制写入 `:106,121` | **F1：平台派生字段条款** |
| `tests/runtime/B2-02-recognition-unified.test.ts:222,274` | `request_command_rerun`；手写 `rewriteOf.alias:1`，来源 `:223,276`；组外执行 helper：`tests/helpers/B2-blocked-runtime.ts:417,424` | 后续检查 `:229,278`；输入 alias 未来自公开返回 | **F1：平台派生字段条款** |
| `tests/runtime/B2-03-request-tool.test.ts:120` | 同上；手写 alias 位于 `:122`；同一组外 helper | 后续检查 `:124`；alias 未来自公开返回 | **F1：平台派生字段条款** |

**记录存储自身测试**

| 范围 | 结果 |
|---|---|
| `.lead-ref/groups/L3-files.txt:1` 至 `:138` | 本组没有 `tests/record-store/` 文件；本节无实例。 |

**F3：已确认的直接写入及委托排除**

组外写入链缩写如下：

- B：`tests/helpers/B2-runtime-fixture.ts:204` → `tests/helpers/task-claim-fixture.ts:311`，手工提交协调策略和活动指针。
- S：`tests/helpers/S2B-runtime-store-fixture.ts:75` → B。
- C：`tests/helpers/C2-runtime-platform-fixture.ts:106`，同类协调策略写入。
- R：`tests/helpers/S2B-be1-platform-fixture.ts:208`，同类协调策略写入。
- K：`tests/helpers/K-session-support.ts:119,151,194`，手造 Session、Turn、agent event 后写 Kernel store。

| 文件与行号 | 写入内容／到达路径 | 到达的测试文件 | 裁定 |
|---|---|---|---|
| `tests/runtime/R4b-session-input-boundaries.test.ts:53` | `:48–51` 构造 Project、Workspace 后提交 | 本文件 | F3 |
| `tests/runtime/R4b-session-operations.test.ts:59,154` | Project、Workspace；SQL 改写 Kernel `record_json` | 本文件 | F3 |
| `tests/runtime/R4b-session-recovery.test.ts:60,214` | Project、Workspace；SQL 删除 Kernel 记录 | 本文件 | F3 |
| `tests/runtime/R4c-execution-history.test.ts:61,325` | Project、Workspace；SQL 损坏 Kernel 记录 | 本文件 | F3 |
| `tests/runtime/S3-graph-tools.test.ts:903,909,978` | 范围／治理记录；artifact 正文；两个 RunSnapshot。正文调用 `:913,914`；Run 经 `commitRaw:967,972` | 本文件夹具调用 `:468,491,516,605` | F3 |
| `tests/runtime/S5-user-message-tools.test.ts:261` | 改写后的 PreparedTaskManifest 正文 | 本文件泵测试 `:410,449` | F3 |
| `tests/business/S1-session-maintenance.test.ts:454` | `:444–452` 手造 Kernel Turn 记录后 append | 本文件 | F3 |
| `tests/kernel/R4a-legacy-fixtures.ts:200` | 原始 SQL 插入 `session_records`；SQL 定义 `:188` | `tests/kernel/R4a-frozen-public.test.ts:429`；`tests/runtime/R4b-session-input-boundaries.test.ts:119`；`tests/runtime/R4b-session-recovery.test.ts:184,192` | F3 |
| `tests/kernel/R4a-frozen-public.test.ts:427,615,639` | 手造 Session；改写 checkpoint JSON、checksum | 本文件 | F3 |
| `tests/runtime/R4b-session-skeleton.test.ts:25,62` | 手造 `session.created` | 本文件 | F3 |
| `tests/runtime/R4c-kernel-history-range.test.ts:152,155,304,426,442,460,462,475,490,495,505,525,540,541,542,561,577,596` | 手造 Session／Turn／事件；SQL 改 JSON、位置或删除记录 | 本文件；seed helper 位于 `:151` | F3 |
| `tests/kernel/K-close-open-turn.test.ts:36,37,38,39,92,93,94,95,96,101,117,118,119,132,133,134,169,170,171,186,187,188,219,220,221,222,223,228,232,233,259,260,265,266,267,268,275,276,277,278,279,287,307,308,309,310,326,327,328,333,340,341,350,351,358,359,366,367,374,375,389,390,391,434,435,436,460` | K；`:460` 另有直接并发 append | 本文件 | F3 |
| `tests/kernel/K-interrupted-history.test.ts:347,348,349,350,351,356,359,375,436,438,439,440,441,446,449,450,451,452,457,460` | K | 本文件 | F3 |
| `tests/runtime/A2-reconcile-runtime.test.ts:78` | B | 本文件 | F3 |
| `tests/runtime/B2-runtime-execution.test.ts:36` | B | 本文件 | F3 |
| `tests/runtime/K3-14-record-unknown-call-review-tool.test.ts:202` | B | 本文件 | F3 |
| `tests/runtime/K3-19-review-capability.test.ts:50,116` | B | 本文件 | F3 |
| `tests/runtime/K3-24-unknown-outcome-stability.test.ts:75` | B | 本文件 | F3 |
| `tests/runtime/R2e-git-source-loop.test.ts:45,141` | B | 本文件 | F3 |
| `tests/runtime/R4-control-runtime.test.ts:58` | B | 本文件 | F3 |
| `tests/runtime/R4c-source-authority-guards.test.ts:284` | B | 本文件 | F3 |
| `tests/runtime/S2B-15-end-retry-activity.test.ts:33` | B | 本文件 | F3 |
| `tests/runtime/orchestration-boundaries.test.ts:130` | B | 本文件 | F3 |
| `tests/runtime/S2B-36-observer-cancel-reread.test.ts:46` | S | 本文件 | F3 |
| `tests/runtime/S2B-37-observer-reread-failure.test.ts:42` | S | 本文件 | F3 |
| `tests/runtime/S2B-38-run08-unknown-activity.test.ts:124,163,230` | S | 本文件 | F3 |
| `tests/runtime/S2B-44-backfill-late-evidence-race.test.ts:91` | S | 本文件 | F3 |
| `tests/runtime/S2B-45-inprocess-run21-activity.test.ts:74` | S | 本文件 | F3 |
| `tests/runtime/S2B-r2-run08-current-revision.test.ts:92` | S | 本文件 | F3 |
| `tests/runtime/K-readonly-command.test.ts:548,680,707,768,782,806` | `:680` 经 B；其余经 `tests/helpers/K-readonly-work-support.ts:64,80`，还提交第二版策略 | 本文件 | F3 |
| `tests/runtime/C2-runtime-platform-tools.test.ts:138,187,212,237` | C | 本文件 | F3 |
| `tests/runtime/RL-30-shell-resource-caps.test.ts:36` | R | 本文件 | F3 |
| `tests/runtime/RL-31-readonly-resource-caps.test.ts:226` | R | 本文件 | F3 |
| `tests/runtime/RL-35-36-sandbox-and-retry.test.ts:40,46` | R | 本文件 | F3 |
| `tests/runtime/S4C2-assembly.test.ts:283` | 协调策略写入：`tests/helpers/WP2-platform-support.ts:579` | 本文件 | F3 |
| `tests/runtime/A2-reconcile-runtime.test.ts:965` | `overwriteSession`；`tests/helpers/task-claim-fixture.ts:466,471` | 本文件 | F3 |
| `tests/business/S1-archive-flow.test.ts:520,559` | `query.answer` 直接写回答正文：`tests/helpers/S1-workflow-archive-fixture.ts:522` | 本文件 | F3 |
| `tests/business/S1-session-maintenance.test.ts:332` | 同上 | 本文件 | F3 |
| `tests/business/K3-17-goal-guard.test.ts:76` | 原始 batch 委托；提交前真实 pause，`:62–76` | 本文件 | v2 允许，A2/A3 |
| `tests/business/K3-44-crr-recovery.test.ts:77` | 真实 commit 与具名故障计数，`:71–83` | 本文件 | v2 允许，A2/A3 |
| `tests/business/K3-46-review-advance-failures.test.ts:269,295,362` | 原始 batch 委托／具名故障／真实 pause 竞争 | 本文件 | v2 允许，A2/A3 |
| `tests/business/K3-UR7-crr-failed-set.test.ts:172` | 具名故障后原样委托，`:157–172` | 本文件 | v2 允许，A2/A3 |
| `tests/business/S1-archive-flow.test.ts:193` | 一次归档 CAS 故障，原始 batch 不改写，`:187–193` | 本文件 | v2 允许，A2/A3 |
| `tests/runtime/B2-16-hook-reads.test.ts:111` | 原始提交委托，`:107–114` | 本文件 | v2 允许，A3 |
| `tests/runtime/K3-merge-cancel-propagation.test.ts:89` | 正文 put 计数后原样委托，`:84–89` | 本文件 | v2 允许，A3 |
| `tests/runtime/S3-graph-tools.test.ts:990` | 提交计数后原样委托，`:985–991` | 本文件 | v2 允许，A3 |

**A7**

| 文件与行号 | helper／边界 | 裁定 |
|---|---|---|
| `tests/runtime/S4C-note-tools.test.ts:114` | `buildNoteTools`；检查默认发布的工具名称和元数据，`:115–120` | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:124,151` | 参数映射、默认值；录制写入端口 `:73` | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:165,177` | 检查失败、写入拒绝的结果透传；录制端口 `:73,93` | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:188,206` | review／withdraw 参数与结果透传；录制端口 `:77,84` | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:215` | 参数边界拒绝，`:224–230` 确认未写入 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:240` | 拒绝结果的 JSON 安全透传，`:241–258` | v2 允许 |
| `.lead-ref/groups/L3-files.txt:1` 至 `:138` | 本组检索未发现 `damageKernel`、`process-sandbox-standin` 调用；上述 helper 定义在 `tests/runtime/S4C-note-tools.test.ts:67`，未达真实 owner 状态 | 无额外实例 |

**尚未完成 A1 枚举，不能列为“无实例”**

以下只给出待完成文件及已定位入口，不把它们计入已确认实例数。已列实例的文件也尚未穷尽普通公共输入及组外 helper 调用。

| 文件与已定位入口 | 尚缺的核对 |
|---|---|
| `tests/business/A2-workflow-auto-rework.test.ts:126` | 手写选择输入、公开返回 next、拒绝输入分别枚举 |
| `tests/business/A2-workflow-disposition.test.ts:76` | 选择输入与替身依赖边界 |
| `tests/business/A2-workflow-reverify.test.ts:152,337,339` | 选择、finalize 请求的完整合同 |
| `tests/business/K3-15-ur3h.test.ts:156,189,220` | hold、控制、Workflow 及组外 review helper |
| `tests/business/K3-41-release-hold.test.ts:83,202,284` | HTTP 输入及组外场景 helper |
| `tests/business/R5b-initial-planning-workflow.test.ts:166,200,292` | 初始化、查询、规划输入 |
| `tests/business/S1-task-order.test.ts:109` | Workflow 输入及其依赖边界 |
| `tests/business/S4C2-U6.test.ts:75` | 决策输入与替身 receipt 的边界 |
| `tests/business/S5R2-automation-cards.test.ts:38,75,94` | Workflow、决策、组外设置 helper |
| `tests/business/WP1-continuation-handover.test.ts:64,87` | 外部夹具的选择输入与公共 next |
| `tests/runtime/B1-kernel-assembly.test.ts:306,360` | 脚本及直接平台工具输入 |
| `tests/runtime/B2-01-shell-hook.test.ts:35` | 组外 `openB2BlockedWorld` 内公共输入 |
| `tests/runtime/B2-02-approved-method.test.ts:48,58,63` | review、disposition、proposal helper |
| `tests/runtime/B2-04-allowance.test.ts:43,48` | 工具输入及 answer helper |
| `tests/runtime/B2-05-06-denial.test.ts:58,60` | 工具输入及拒绝决策 |
| `tests/runtime/B2-09-allowance-crash.test.ts:47,49` | 工具输入及 answer helper |
| `tests/runtime/B2-13-allow-one-form.test.ts:35,37` | 工具输入及 answer helper |
| `tests/runtime/B2-15-replay.test.ts:86,121` | 脚本工具参数、组外夹具 |
| `tests/runtime/B2-16-hook-closure.test.ts:63,67,92` | 工具、answer、disposition helper |
| `tests/runtime/B2-401-world.test.ts:48` | 组外 `openB401World` 输入链 |
| `tests/runtime/K3-12-review-round-tools.test.ts:130,132` | 组外 review 初始化及工具参数 |
| `tests/runtime/K3-19-review-admission.test.ts:142,292` | review helper、Workflow 输入 |
| `tests/runtime/K3-35-T-by-hand.test.ts:102,135` | 组外公共记录及 prepare helper |
| `tests/runtime/K3-35-approved-methods-brief.test.ts:84,149` | 同上 |
| `tests/runtime/K3-35-review-input-size.test.ts:143,180` | prepared 来源、组外驱动输入 |
| `tests/runtime/K3-35-workspace-baseline-prepare.test.ts:34,36` | 组外公共场景及 prepare 输入 |
| `tests/runtime/K3-B3-cancellation-cancelled.test.ts:94,152,189` | 请求 helper、Runtime 输入 |
| `tests/runtime/K3-B3-newest-request-order.test.ts:79,83,110` | 重跑请求和决策输入 |
| `tests/runtime/K3-review-preparation.test.ts:171,180,344` | review helper、准备／控制输入 |
| `tests/runtime/R5b-query-session-loop.test.ts:170,192,195` | 查询、prepared、脚本工具参数 |
| `tests/runtime/RL-32-check-resource-caps.test.ts:43,74` | 组外 evidence helper 及材料读取 |
| `tests/runtime/S1-archive-cancelled-reader.test.ts:68,125` | 控制与归档输入 |
| `tests/runtime/S1-archive-files-brief.test.ts:69,177` | 归档、控制及组外夹具输入 |
| `tests/runtime/S3-context-assembler.test.ts:320` | 准备 owner 与内部 assembler／body-store 替身的范围划分 |
| `tests/runtime/source-binding-migration.test.ts:60,352,403` | Workspace 与 Query 公共输入 |
| `tests/runtime/source-text-loop-migration.test.ts:205,228,247` | 平台工具参数及公开 cursor／capture 转用 |
| `tests/runtime/source-tool-lifecycle.test.ts:275,314,337` | 平台工具参数及拒绝分支 |

**无实例**

这里只表示没有本题四节实例，不评价其他 v1 规则；引用为对应测试入口。

- `tests/kernel/B2-history-public-export.test.ts:133`
- `tests/kernel/K-readonly-sandbox.test.ts:206`
- `tests/kernel/R4-terminal-history.test.ts:206`
- `tests/kernel/R4-tool-group-barrier.test.ts:362`
- `tests/kernel/RL-01-02-caps-effect.test.ts:48`
- `tests/kernel/RL-03-05-oom-pids.test.ts:54`
- `tests/kernel/RL-06-11-stop.test.ts:199`
- `tests/kernel/RL-12-15-conditions.test.ts:73`
- `tests/kernel/RL-15c-gate-stream-error.test.ts:106`
- `tests/kernel/RL-20-resource-cap-attribution.test.ts:39`
- `tests/kernel/RL-22-settlement.test.ts:59`
- `tests/runtime/C3-brief-timeline.test.ts:124`
- `tests/runtime/K3-06-mixed-kinds-pure.test.ts:110`
- `tests/runtime/K3-15-blocked-omission.test.ts:75`
- `tests/runtime/K3-15-blocked-sentence-pure.test.ts:16`
- `tests/runtime/K3-15-blocked-sentence.test.ts:36`
- `tests/runtime/K3-15-disposition-effects-pure.test.ts:186`
- `tests/runtime/K3-16-approved-method-lines.test.ts:15`
- `tests/runtime/K3-16-proposal-input.test.ts:124`
- `tests/runtime/K3-16-proposals-pure.test.ts:93`
- `tests/runtime/K3-16-review-extremes-pure.test.ts:97`
- `tests/runtime/K3-16-targets-pure.test.ts:79`
- `tests/runtime/K3-18-requeue-confirmed-pure.test.ts:42`
- `tests/runtime/K3-18-review-card-pure.test.ts:99`
- `tests/runtime/K3-19-review-admission-pure.test.ts:46`
- `tests/runtime/K3-26-unknown-call-review-codec-pure.test.ts:73`
- `tests/runtime/K3-26-unknown-call-review-pure.test.ts:70`
- `tests/runtime/K3-34-tool-name-constants.test.ts:28`
- `tests/runtime/K3-35-manifest-trim-pure.test.ts:273`
- `tests/runtime/K3-35-renderer-boundary-pure.test.ts:232`
- `tests/runtime/K3-40-ignored-at-capture.test.ts:40`
- `tests/runtime/K3-40-workspace-change-capture.test.ts:47`
- `tests/runtime/K3-48-2-proposal-budget-pure.test.ts:129`
- `tests/runtime/K3-48-3-extremes-pure.test.ts:121`
- `tests/runtime/K3-B3-runtime-fail-closed.test.ts:27`
- `tests/runtime/K3-continuation-review-note.test.ts:194`
- `tests/runtime/K3-review-input-pure.test.ts:82`
- `tests/runtime/K3-unknown-call-review-section.test.ts:66`
- `tests/runtime/R4c-session-continuity.test.ts:62`
- `tests/runtime/S2B-tally.test.ts:43`
- `tests/runtime/S4C-note-run-task-resolver.test.ts:53`
- `tests/runtime/WP1-context-assembly.test.ts:36`

JSON 对应已确认表；`line` 数组逐项计数。

```json
[
  {"section":"A1","file":"tests/business/K3-46-review-advance-failures.test.ts","line":[143,149],"owner":"plans.proposePlan/applyPlanChange","value":"公开图读取后编辑draft及采用请求","verdict":"v2 允许","note":"来源126、128、133；后续有269存储包装"},
  {"section":"A1","file":"tests/business/K3-UR7-crr-failed-set.test.ts","line":[338,344],"owner":"plans.proposePlan/applyPlanChange","value":"公开图读取后编辑draft及采用请求","verdict":"v2 允许","note":"来源321、323、328；另有301内部读取"},
  {"section":"A1","file":"tests/business/R5c-workflow.test.ts","line":[140,155,161],"owner":"goals/plans","value":"手写目标、计划；公开proposal引用","verdict":"v2 允许","note":"计划148；后续公开advanceWork168"},
  {"section":"A1","file":"tests/business/S1-session-maintenance.test.ts","line":[296,303],"owner":"plans","value":"编辑currentPlan后的draft","verdict":"v2 允许","note":"来源292、308；后续454内部写入"},
  {"section":"A1","file":"tests/business/S5-decision-workflow.test.ts","line":[192,230],"owner":"goalSettings","value":"手写设置、顺序和版本条件","verdict":"v2 允许","note":"无签发字段；205、207、257、259读storeSnapshot"},
  {"section":"A1","file":"tests/business/S5R2-settings-replay.test.ts","line":[138],"owner":"settings.setGoalSettings","value":"every_step设置及版本8","verdict":"v2 允许","note":"无签发字段；143、145内部observeC"},
  {"section":"A1","file":"tests/runtime/C1-communication-tools.test.ts","line":[244,252,258,263,267,271],"owner":"邮箱工具","value":"手写正文、分页、回复；公开消息引用","verdict":"v2 允许","note":"引用来源247、249；后续公开工具"},
  {"section":"A1","file":"tests/runtime/C2-runtime-platform-tools.test.ts","line":[157],"owner":"messages.sendMessage","value":"手写正文和接收人","verdict":"v2 允许","note":"无签发字段；后续163、175公开步骤"},
  {"section":"A1","file":"tests/runtime/S1-routed-replies.test.ts","line":[97],"owner":"messages.respondMessage","value":"手写回复及公开消息版本","verdict":"v2 允许","note":"版本来源96；后续100读内部接受记录"},
  {"section":"A1","file":"tests/runtime/S4C-note-related-find.test.ts","line":[26,28,29],"owner":"notes.writeNote","value":"手写注记","verdict":"v2 允许","note":"tests/helpers/S4A-note-fixture.ts:282；后续46、55、70公开memoryFind"},
  {"section":"A1","file":"tests/runtime/S4C2-assembly.test.ts","line":[189,291,307],"owner":"notes.writeNote","value":"手写注记、公开noteId作为替换目标","verdict":"v2 允许","note":"189经tests/helpers/S4A-note-fixture.ts:282；307引用291返回；202读正文存储"},
  {"section":"A1","file":"tests/runtime/S5-user-message-tools.test.ts","line":[98,352],"owner":"send_user_message/messages.sendMessage","value":"手写决策和询问正文","verdict":"v2 允许","note":"tests/helpers/S5-user-message-support.ts:82；后续113读storeSnapshot"},
  {"section":"A1","file":"tests/runtime/S5R2-agent-application.test.ts","line":[143,198,298,335],"owner":"计划工具/plans.applyPlanChange","value":"编辑夹具计划、采用参数","verdict":"v2 允许","note":"draft50；298的source来自174、182内部消息；后续187、227存储读取"},
  {"section":"A1","file":"tests/runtime/W2-whiteboard-tools.test.ts","line":[268,322,338,349,396],"owner":"计划工具","value":"手写draft、reason、expected、proposal引用","verdict":"v2 允许","note":"来源59、67；录制端口117、123；不豁免F4"},
  {"section":"A1","file":"tests/business/A2-workflow-result-mapping.test.ts","line":[84,100,110],"owner":"workflow.advanceWork","value":"仅meta的操作请求","verdict":"F1","note":"71—73强转；57—68替身忽略请求；违反v2:30—31完整参数合同"},
  {"section":"A1","file":"tests/business/K3-review-workflow-rows.test.ts","line":[869,887,926],"owner":"workflow.advanceWork","value":"仅meta的start/observe请求","verdict":"F1","note":"810—813构造；803、804忽略请求；违反完整参数合同"},
  {"section":"A1","file":"tests/business/WP1-start-refusal.test.ts","line":[18,43],"owner":"workflow.advanceWork","value":"手造manifest和prepared","verdict":"F1","note":"tests/helpers/WP1-units-fixture.ts:515,530,559,564；违反平台派生值条款"},
  {"section":"A1","file":"tests/runtime/S5-user-message-tools.test.ts","line":[410,449],"owner":"协作driver/runtime.startRun","value":"内部manifest改写后重建prepared","verdict":"F1","note":"250读取、255改写、265重建、377装入操作；违反prepared条款"},
  {"section":"A1","file":"tests/runtime/S5R2-agent-application.test.ts","line":[241,282,374],"owner":"record_decision_application","value":"从内部事件重建receipt","verdict":"F1","note":"187、217读取，224重建；违反receipt来源条款"},
  {"section":"A1","file":"tests/runtime/S3-graph-tools.test.ts","line":[702,718,721],"owner":"look_graph/find_graph","value":"手写c1/c0游标","verdict":"F1","note":"参数703、719、722；违反cursor来源条款"},
  {"section":"A1","file":"tests/runtime/S3-graph-tools.test.ts","line":[955],"owner":"plans.proposePlan","value":"含测试计算artifact指纹的draft","verdict":"F1","note":"809—813构造，952、953装入draft；违反fingerprint来源条款"},
  {"section":"A1","file":"tests/runtime/W2-role-skills.test.ts","line":[188],"owner":"query_ready_tasks","value":"手写prior-page游标","verdict":"F1","note":"172替身接受，207断言成功；违反cursor来源条款"},
  {"section":"A1","file":"tests/runtime/R4c-graph-history.test.ts","line":[786,824,880,894],"owner":"runtime.readSessionHistory","value":"内部Kernel记录重建range位置","verdict":"F1","note":"779、817、874读取；784、826、878构造；违反position来源条款"},
  {"section":"A1","file":"tests/runtime/S5-user-message-tools.test.ts","line":[203],"owner":"mailbox.recordInputAccepted","value":"手写position=7","verdict":"F1","note":"204构造；198仅返回kernel映射；210后公开读、211读store；违反position/entered fact条款"},
  {"section":"A1","file":"tests/runtime/K3-14-record-unknown-call-review-tool.test.ts","line":[94,113],"owner":"record_unknown_call_review","value":"手写item=1","verdict":"F1","note":"80—83常量；87执行；平台alias分配见src/core/agent-runtime/unknown-call-draft.ts:190"},
  {"section":"A1","file":"tests/runtime/K3-16-proposal-tool.test.ts","line":[103,120],"owner":"propose_safer_method","value":"手写item=1/2","verdict":"F1","note":"67—69、120构造；无真实公开步骤取得item；平台派生字段条款"},
  {"section":"A1","file":"tests/runtime/B2-02-recognition-unified.test.ts","line":[222,274],"owner":"request_command_rerun","value":"手写rewriteOf.alias=1","verdict":"F1","note":"223、276构造；tests/helpers/B2-blocked-runtime.ts:417,424执行；平台派生字段条款"},
  {"section":"A1","file":"tests/runtime/B2-03-request-tool.test.ts","line":[120],"owner":"request_command_rerun","value":"手写rewriteOf.alias=1","verdict":"F1","note":"122构造；tests/helpers/B2-blocked-runtime.ts:417,424执行；平台派生字段条款"},
  {"section":"F3","file":"tests/runtime/R4b-session-input-boundaries.test.ts","line":[53],"owner":"records","value":"Project/Workspace记录","verdict":"F3","note":"48—51构造；本文件到达"},
  {"section":"F3","file":"tests/runtime/R4b-session-operations.test.ts","line":[59,154],"owner":"records/Kernel SQLite","value":"Project/Workspace；损坏record_json","verdict":"F3","note":"54—57构造；154直接SQL；本文件到达"},
  {"section":"F3","file":"tests/runtime/R4b-session-recovery.test.ts","line":[60,214],"owner":"records/Kernel SQLite","value":"Project/Workspace；删除Kernel记录","verdict":"F3","note":"55—58构造；214直接SQL；本文件到达"},
  {"section":"F3","file":"tests/runtime/R4c-execution-history.test.ts","line":[61,325],"owner":"records/Kernel SQLite","value":"Project/Workspace；损坏Kernel记录","verdict":"F3","note":"56—59构造；325直接SQL；本文件到达"},
  {"section":"F3","file":"tests/runtime/S3-graph-tools.test.ts","line":[903,909,978],"owner":"records/rawBodies/commitRaw","value":"范围治理记录、artifact正文、RunSnapshot","verdict":"F3","note":"909调用913、914；978经967、972；本文件468、491、516、605到达"},
  {"section":"F3","file":"tests/runtime/S5-user-message-tools.test.ts","line":[261],"owner":"body store","value":"改写的PreparedTaskManifest","verdict":"F3","note":"250读取、255改写；本文件410、449到达"},
  {"section":"F3","file":"tests/business/S1-session-maintenance.test.ts","line":[454],"owner":"Kernel store","value":"手造Turn/Run记录","verdict":"F3","note":"444—452构造；本文件到达"},
  {"section":"F3","file":"tests/kernel/R4a-legacy-fixtures.ts","line":[200],"owner":"Kernel SQLite","value":"原始session_records插入","verdict":"F3","note":"SQL188；到达tests/kernel/R4a-frozen-public.test.ts:429、tests/runtime/R4b-session-input-boundaries.test.ts:119、tests/runtime/R4b-session-recovery.test.ts:184,192"},
  {"section":"F3","file":"tests/kernel/R4a-frozen-public.test.ts","line":[427,615,639],"owner":"Kernel store/SQLite","value":"Session及checkpoint JSON/checksum","verdict":"F3","note":"本文件到达"},
  {"section":"F3","file":"tests/runtime/R4b-session-skeleton.test.ts","line":[25,62],"owner":"Kernel store","value":"session.created","verdict":"F3","note":"本文件到达"},
  {"section":"F3","file":"tests/runtime/R4c-kernel-history-range.test.ts","line":[152,155,304,426,442,460,462,475,490,495,505,525,540,541,542,561,577,596],"owner":"Kernel store/SQLite","value":"Session、Turn、事件；改JSON/位置或删除记录","verdict":"F3","note":"seedSession151；本文件到达"},
  {"section":"F3","file":"tests/kernel/K-close-open-turn.test.ts","line":[36,37,38,39,92,93,94,95,96,101,117,118,119,132,133,134,169,170,171,186,187,188,219,220,221,222,223,228,232,233,259,260,265,266,267,268,275,276,277,278,279,287,307,308,309,310,326,327,328,333,340,341,350,351,358,359,366,367,374,375,389,390,391,434,435,436,460],"owner":"KernelSessionFixture/SqliteStores","value":"手造Session、Turn、agent event","verdict":"F3","note":"tests/helpers/K-session-support.ts:119,151,194；460直接append；本文件到达"},
  {"section":"F3","file":"tests/kernel/K-interrupted-history.test.ts","line":[347,348,349,350,351,356,359,375,436,438,439,440,441,446,449,450,451,452,457,460],"owner":"KernelSessionFixture","value":"手造Session、Turn、agent event","verdict":"F3","note":"tests/helpers/K-session-support.ts:119,151,194；本文件到达"},
  {"section":"F3","file":"tests/runtime/A2-reconcile-runtime.test.ts","line":[78],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204→tests/helpers/task-claim-fixture.ts:311；本文件到达"},
  {"section":"F3","file":"tests/runtime/B2-runtime-execution.test.ts","line":[36],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204→tests/helpers/task-claim-fixture.ts:311；本文件到达"},
  {"section":"F3","file":"tests/runtime/K3-14-record-unknown-call-review-tool.test.ts","line":[202],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/K3-19-review-capability.test.ts","line":[50,116],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/K3-24-unknown-outcome-stability.test.ts","line":[75],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/R2e-git-source-loop.test.ts","line":[45,141],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/R4-control-runtime.test.ts","line":[58],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/R4c-source-authority-guards.test.ts","line":[284],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/S2B-15-end-retry-activity.test.ts","line":[33],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/orchestration-boundaries.test.ts","line":[130],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/S2B-36-observer-cancel-reread.test.ts","line":[46],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-runtime-store-fixture.ts:75→tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/S2B-37-observer-reread-failure.test.ts","line":[42],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-runtime-store-fixture.ts:75→tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/S2B-38-run08-unknown-activity.test.ts","line":[124,163,230],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-runtime-store-fixture.ts:75→tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/S2B-44-backfill-late-evidence-race.test.ts","line":[91],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-runtime-store-fixture.ts:75→tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/S2B-45-inprocess-run21-activity.test.ts","line":[74],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-runtime-store-fixture.ts:75→tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/S2B-r2-run08-current-revision.test.ts","line":[92],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-runtime-store-fixture.ts:75→tests/helpers/B2-runtime-fixture.ts:204；本文件到达"},
  {"section":"F3","file":"tests/runtime/K-readonly-command.test.ts","line":[548,680,707,768,782,806],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"680经tests/helpers/B2-runtime-fixture.ts:204；其余经tests/helpers/K-readonly-work-support.ts:64,80；本文件到达"},
  {"section":"F3","file":"tests/runtime/C2-runtime-platform-tools.test.ts","line":[138,187,212,237],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/C2-runtime-platform-fixture.ts:106；本文件到达"},
  {"section":"F3","file":"tests/runtime/RL-30-shell-resource-caps.test.ts","line":[36],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-be1-platform-fixture.ts:208；本文件到达"},
  {"section":"F3","file":"tests/runtime/RL-31-readonly-resource-caps.test.ts","line":[226],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-be1-platform-fixture.ts:208；本文件到达"},
  {"section":"F3","file":"tests/runtime/RL-35-36-sandbox-and-retry.test.ts","line":[40,46],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/S2B-be1-platform-fixture.ts:208；本文件到达"},
  {"section":"F3","file":"tests/runtime/S4C2-assembly.test.ts","line":[283],"owner":"commitRaw","value":"协调策略及活动指针","verdict":"F3","note":"tests/helpers/WP2-platform-support.ts:579；本文件到达"},
  {"section":"F3","file":"tests/runtime/A2-reconcile-runtime.test.ts","line":[965],"owner":"overwriteSession","value":"改写Session","verdict":"F3","note":"tests/helpers/task-claim-fixture.ts:466,471；本文件到达"},
  {"section":"F3","file":"tests/business/S1-archive-flow.test.ts","line":[520,559],"owner":"query.answer/body store","value":"Query回答正文","verdict":"F3","note":"tests/helpers/S1-workflow-archive-fixture.ts:522；本文件到达"},
  {"section":"F3","file":"tests/business/S1-session-maintenance.test.ts","line":[332],"owner":"query.answer/body store","value":"Query回答正文","verdict":"F3","note":"tests/helpers/S1-workflow-archive-fixture.ts:522；本文件到达"},
  {"section":"F3","file":"tests/business/K3-17-goal-guard.test.ts","line":[76],"owner":"真实存储委托","value":"平台原始提交","verdict":"v2 允许","note":"62—76真实pause竞争；A2/A3"},
  {"section":"F3","file":"tests/business/K3-44-crr-recovery.test.ts","line":[77],"owner":"真实存储委托","value":"平台原始提交","verdict":"v2 允许","note":"71—83具名故障；A2/A3"},
  {"section":"F3","file":"tests/business/K3-46-review-advance-failures.test.ts","line":[269,295,362],"owner":"真实存储委托","value":"平台原始提交","verdict":"v2 允许","note":"260—269、284—295、351—364；故障/真实pause；A2/A3"},
  {"section":"F3","file":"tests/business/K3-UR7-crr-failed-set.test.ts","line":[172],"owner":"真实存储委托","value":"平台原始提交","verdict":"v2 允许","note":"157—172具名故障；A2/A3"},
  {"section":"F3","file":"tests/business/S1-archive-flow.test.ts","line":[193],"owner":"真实存储委托","value":"平台原始提交","verdict":"v2 允许","note":"187—193一次CAS故障；A2/A3"},
  {"section":"F3","file":"tests/runtime/B2-16-hook-reads.test.ts","line":[111],"owner":"真实存储委托","value":"平台原始提交","verdict":"v2 允许","note":"107—114原样委托；A3"},
  {"section":"F3","file":"tests/runtime/K3-merge-cancel-propagation.test.ts","line":[89],"owner":"真实正文存储委托","value":"平台原始正文","verdict":"v2 允许","note":"84—89计数后原样委托；A3"},
  {"section":"F3","file":"tests/runtime/S3-graph-tools.test.ts","line":[990],"owner":"真实存储委托","value":"平台原始提交","verdict":"v2 允许","note":"985—991计数后原样委托；A3"},
  {"section":"A7","file":"tests/runtime/S4C-note-tools.test.ts","line":[114,124,151,165,177,188,206,215,240],"owner":"buildNoteTools","value":"适配器默认发布、参数映射、默认值、结果透传","verdict":"v2 允许","note":"定义67；录制端口73、77、84、93；未到达真实owner状态"}
]
```

v2 允许 56，F1 30，F3 162，A7 越界 0，文件 101/138；枚举不完整：待核表中的 37 个文件尚未完成 A1 清单；已有条目的文件也未穷尽普通公共输入及组外 helper 调用。