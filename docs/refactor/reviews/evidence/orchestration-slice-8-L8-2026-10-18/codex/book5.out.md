**需改条款，不能直接判为 buildable。** 本次只读、未运行测试。以下可达性和读数均为 **STATIC**。

主要问题是：裁定 5 指定的 driver 重试不会保留旧命令身份；裁定 2、3 对已确认提交之后的恢复异常没有一致优先级；裁定 4 的实际影响超过 C-1；J 错把两个不同的取消分支写成依赖关系。裁定 6 的 **12/21 手算成立**，裁定 7 的 **Host 读取可达**，D 的 **memory 复用后端可行**。

下文简称：

| 简称 | 文件 |
|---|---|
| Svc | [architecture-service.ts](D:/cxt/s8l8-review3/src/core/work-graph/architecture/architecture-service.ts) |
| Driver | [auto-capture-driver.ts](D:/cxt/s8l8-review3/src/app/auto-capture-driver.ts) |
| Host / Platform | [host.ts](D:/cxt/s8l8-review3/src/app/host.ts) / [create-platform.ts](D:/cxt/s8l8-review3/src/composition/create-platform.ts) |
| Asm / Prep | [context-assembler.ts](D:/cxt/s8l8-review3/src/core/agent-runtime/context-assembler.ts) / [execution-preparation.ts](D:/cxt/s8l8-review3/src/core/agent-runtime/execution-preparation.ts) |
| Facts / Catalog | [architecture-reminder-facts.ts](D:/cxt/s8l8-review3/src/composition/architecture-reminder-facts.ts) / [catalog-service.ts](D:/cxt/s8l8-review3/src/core/work-graph/architecture/catalog-service.ts) |
| Brief | [continuation-brief-assembly.ts](D:/cxt/s8l8-review3/src/core/agent-runtime/continuation-brief-assembly.ts) |
| Obs / Pub / Count | [observation-state 测试](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-observation-state.test.ts) / [reminders-public 测试](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-reminders-public.test.ts) / [read-counts 测试](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-read-counts.test.ts) |
| Gate / HostTest | [auto-capture-gate 测试](D:/cxt/s8l8-review3/tests/app/S8A-L8-auto-capture-gate.test.ts) / [host-close-restart 测试](D:/cxt/s8l8-review3/tests/app/S8A-L8-host-close-restart.test.ts) |
| H4 / World | [S8A-L8-prepare.ts](D:/cxt/s8l8-review3/tests/helpers/S8A-L8-prepare.ts) / [S8A-L8-reminder-world.ts](D:/cxt/s8l8-review3/tests/helpers/S8A-L8-reminder-world.ts) |

**1. 书中 §2 和行表的全部 file:line 引用**

| 书中引用 | 核对 |
|---|---|
| 裁定 2，`architecture-service.ts:1221–1223` | **位置 ok，论证范围 wrong。** 确是 capture 的晚期 restore，成功后不检查取消。但不能据此说 capture 已满足整条裁定：`:1219` 对非 committed 直接映射错误，仍漏“失败返回时 signal 已取消”。 |
| 裁定 4，`context-assembler.ts:1084–1098` | **ok。** `:1084` 上游 facts await；`:1094` 只查 signal；`:1098` 忽略显式 cancelled。 |
| C，ledger `Obs:600、602、603、623、625、626、627` | **ok，均为旧位置。** 与所给 `d1-round.txt` 完全对应；不能当当前行号。承接场景在 Count:`97–144`，需恢复两次 facts ready、previous 状态和 12/13/12 节点检查。 |
| D，ledger `Gate:309、331` | **ok，旧位置。** 分别是删掉的双后端 describe、`bEnteredBeforeRetry > 0`。当前承接在 HostTest:`202–230`；其前置 helper 的 `:147–148` 明确让 B 从未进入，不能承接旧前提。 |
| H，`Obs:883–889、900` | **ok。** 手造 request 命令、首次提交、直接重放。 |
| H，`Obs:971–974` | **ok。** 手调 fail owner，手造 guard 和身份。 |
| H，`Obs:442`、helper `:384–388` | **ok，但 helper 引用不完整。** 完整命令构造是 `:384–390`，requestId 在 `:389`。同类自动 capture 重放还在 `:415–417、615–617`。 |
| I，`S8A-L8-http-watermark.test.ts:25–26、37–50` | **ok。** 缺 `rejects:` 分组；拒绝及公开状态不变检查已经存在。 |
| I，`S8A-L8-chunk-scope.test.ts:498` | **ok。** 跨项目 ref 拒绝夹在成功场景中。 |
| J，ledger `Pub:504、505` | **ok，旧位置。** 显式 cancelled、signal 未取消的结果及 `input=null`。但“等 C-1 修复才通过”是 **wrong**：现有 Asm:`1056` 已处理该 reminder-reader 分支。 |
| K，`S8A-L8-host-restart.test.ts:55、116` | **ok。** 都是靠定时循环证明非事件。 |

还有两个与行表范围直接相关的漏列：B 的手调通知除了 V 列出的七处，还有 **Obs:`606、847`**；H 的同类手造 watermark 还有上述 **`:416、616`**。不能只改表中示例而留下它们。

**2. 每条裁定涉及的函数、调用者和结果读者**

以下列生产调用链；测试助手的调用者另列。Platform 的转发不会吞掉异常：`trackedCall` 在 Platform:`1008–1014` 原样返回 Promise。

| 裁定 | 改动面及全部生产直接调用者 | 返回值、持久值的下游读者 |
|---|---|---|
| 1 | 三项接受结论本身不要求新生产修改。失败原因产生于 Driver:`runCapture` 的 `194、196、200`；显式 assembler/default assembler 分流在 Prep:`143–156`。`createExecutionPreparation` 由 [runtime.ts:372](D:/cxt/s8l8-review3/src/core/agent-runtime/runtime.ts:372) 创建。 | failure 经 Driver:`252` 写入；后续由 `readAutoCapture`、`observationState`、reminder facts 读取。关闭后读取是 HostTest:`observationPoint` → `createTargetPlatform` → `observationState`。显式 assembler 分支不读取 `materials`。 |
| 2 | `captureSourceChanges`、`requestAutoCapture`、`failAutoCapture`。分别经 Platform:`1178、1180、1181` 暴露。request 唯一生产调用者 Driver:`109`；fail 唯一生产调用者 Driver:`252`；capture 的调用者是 Driver:`232` 和 HTTP 绑定/派发 [core-routes.ts:662](D:/cxt/s8l8-review3/src/app/core-routes.ts:662)、`:926`。 | request 返回值仅 Driver:`114、130–133` 判断能否入队；fail 返回值在 Driver:`252` 被忽略。capture 结果由 Driver:`236–242` 分成功、取消、失败；HTTP 返回给客户端，UI 在 [apply-result.ts:63](D:/cxt/s8l8-review3/src/ui/state/apply-result.ts:63) 保存引用。持久值读者见下文。 |
| 3 | request、fail、`readAutoCapture`、`observationState`，以及书中指定的 capture **early replay**。`readAutoCapture` 经 Platform:`1182`，唯一生产调用者 Driver:`166`；`observationState` 经 Platform:`1183`，调用者 Driver:`186、281` 和 HTTP `core-routes.ts:931`。 | snapshot 的 revision/requestSeq 在 Driver:`170、233–234、253–254` 消费；observationState.current 在 `:191` 成为 previous，pending 在 `:285–289` 决定启动重试。异常/取消决定是否结束本轮、是否写 failure。 |
| 4 | 直接缺陷是 `assembleTask` 的 upstream 分支。若按“R2-4 每个 await”执行，还涉及 Facts.read、Svc.readReminderFacts 的依赖传播、`assembleBriefForContext`、`sessionBasisForContext`、`briefWorkspaceFactsFor` 等，不能只改 Asm:`1094`。 | Facts.read 唯一生产使用点 Asm:`1044`，由 Platform:`747` 装配；Svc.readReminderFacts 的调用者 Facts:`28、33`，另由 Platform:`1184` 公开。其值经 Asm:`1060` 的提醒 renderer、`:1165` 的段落装配进入 Prep:`294–326` 的 manifest。完整 continuation 共享链见下文。 |
| 5 | 应改测试路径，**没有授权改变 Driver 的 identity/retry 设计**。生产相关函数是 `retryPending → accept → writeRequest → pump → runCapture`。 | 重试消费者仍是裁定 2、3 所列链。Obs 的 `captureRequest` 调用点为 `244、416、442、508、616、674、1049`；其中 `416、442、616` 是自动命令身份/内部 watermark，不能与普通手动 capture 请求一起处理。 |
| 6 | 改 Count:`countFixture` 中 `readMany`、body read wrapper，唯一调用测试在 `:100`。不需要改生产读取算法。 | wrapper 计数由 Count:`118、138` 保存，`:123–125、142–144` 断言。真实 facts 仍经上述 Facts → Asm → Prep 链消费；恢复的 facts 检查应放在同一场景，额外检查不能污染 prepare 计数窗口。 |
| 7 | 改 H4:`prepareExecutionAndArtifact` 的 `:40–48`，直接使用传入 Host ctx。生产材料授权无需修改。 | H4 全部调用者：World:`413`；[chunk-scope 测试](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-chunk-scope.test.ts):`468、470、538`。材料 body 在 H4:`54–56` 解析 input，返回 prepared/bundleRef/input，供 reminder、scope、count 场景检查。 |

持久值的读取不能只列 Driver：

- **request/failure 记录**由 Svc:`readAutoCaptureRecord:796` 统一读取；全部调用点是 `:848、1033、1273、1343、1379`，分别服务状态基底、手动 capture watermark、下一请求、失败 guard、公开快照读取。回执事件由 `restoreAutoCapture:885` 读取，调用点 `:1260、1291、1332、1364`。
- **capture 的 current/previous/正文**：pointer 读者为 Svc:`846、1049、1183`；记录读者 `1407、1412` 服务 observationState。`loadObservation` 全部调用点 `1053、1063、1452、1464、1503、1534、1536、1562`，服务后续 capture、提醒、query、compare、queryImpact。`loadFileGraph` 经 `readFilePage:922` 服务 listFiles/neighbors/impact，另由 compareFormalObserved:`1660` 使用。回执 restore 在 `1002、1221`。
- UI 保存的 capture 引用还被 [requests.ts:207](D:/cxt/s8l8-review3/src/ui/views/setup/requests.ts:207)、`:215` 用作下一 capture.previous 和查询 selection；[panels.ts:119](D:/cxt/s8l8-review3/src/ui/views/setup/panels.ts:119)、`:124` 与 [tabs.ts:84](D:/cxt/s8l8-review3/src/ui/views/graphs/tabs.ts:84) 用于可用状态和展示。
- **准备结果**：Asm.assembleTask 唯一生产调用点 Prep:`284`；Prep.prepare 经 runtime:`602`、Platform:`1335–1336` 暴露，内部生产调用者 [workflow.ts:1841](D:/cxt/s8l8-review3/src/business/workflow/workflow.ts:1841)。非 ready 在 `:1843` 停住；ready 在 `:1847` 进入 startStep/startRun，后续由执行 driver 和 WorkGraph entry 验证 manifest/envelope/inputBinding。
- **共享 continuation helper**：`assembleBriefForContext` 仅 Asm:`1149` 调用；它调用 `readPreviousTurn`（`:923、932`）、`briefWorkspaceFactsFor`（`:937`）、`sessionBasisForContext`（`:941`）。`readPreviousTurn` 还被 [session-anomaly-facts.ts:123](D:/cxt/s8l8-review3/src/core/agent-runtime/session-anomaly-facts.ts:123) 调用；`briefWorkspaceFactsFor` 还经 Prep:`55–56` 被该文件 `:132` 调用，结果生成归档 changed-file facts。内部 window 链为 Brief:`314 → 323/325/327 → 220/251 → 181`。因此改 helper 返回类型时必须接住这些共享读者，不能只改准备分支。

**3. 裁定 5：六个 replay 分支均不能由所指定的 driver 重试到达**

真实启动序列：

`createWorkbenchHost`  
→ Host:`1064` `retryPending(boundWorkspaces)`  
→ Driver:`281` 公开 observationState  
→ `:285` 判断 pending  
→ `:289` `accept(scope,'startup_retry')`  
→ `:130` `writeRequest`  
→ `:109–112` **新 UUID 的 requestAutoCapture**  
→ Svc:`1276` 状态构造器  
→ [architecture-capture.ts:42、45](D:/cxt/s8l8-review3/src/core/work-graph/state/architecture-capture.ts:42) **revision+1、requestSeq+1**  
→ Driver:`132–151` 排队运行。

新轮次由真实 adopt/revise/PASS 提交通知进入：Platform:`1200、1209`（PASS 为 `:943` 后的通知）→ Host:`536` → Driver:`265–271` → 同一 `accept`。如果已 waiting/accepting，Driver:`126` 合并，**没有再调用 owner**；若接受新轮次，则同样先写新 request。

| owner / 分支 | 静态结论 |
|---|---|
| request early：Svc:`1253、1260` | **不可达**：Driver:`112` 每次生成新 requestId；`:110` 还生成新的 requestedAt。 |
| request late：Svc:`1291` | **不可达于该重试路径**：只有本次 `records.commit` 返回 `committed,replayed:true` 才进入；Driver 不重复派送同一 acceptance 命令。 |
| fail early：Svc:`1325、1332` | **不可达**：重试先递增 revision；Driver:`253–254` 用新 snapshot revision 构造 guard 和 failure identity。 |
| fail late：Svc:`1364` | **不可达于该重试路径**：每轮只调用一次 fail；下轮身份改变。 |
| capture early：Svc:`996、1002` | **不可达**：Driver:`233–234` 使用新的 requestSeq。若旧 capture 已提交，其满意水位还会使旧请求 pending=false，启动时直接跳过。 |
| capture late：Svc:`1221` | **不可达于该重试路径**：同 requestSeq 最多派一次 capture；下一轮先换序号。 |

另一个关键区别：这三个 owner **没有“commit 抛错后 lookup 并恢复”的代码**。目前所谓 late restore 是 **commit 返回 replayed receipt 后读事件**，不是本次调用捕获 lost reply 后的恢复流程。

这与旧书 [l8-impl.md:74–82](D:/cxt/s8l8-review3/.lead-ref/l8-impl.md:74) 完全一致：重试必须先写新 request。为了让 A/H 测试通过而复用旧身份，会违反仍有效的旧裁定。

手动 `architecture/capture` 的相同公开请求可以真实重放，Obs:`1034–1057` 已采用这种输入；它不能证明 driver 的 request/fail 重放。裁定 5 现在却把“一切 replay row”都限定到 driver，连这个合法路径也排除了。

**4. 裁定 6：逐调用手算为 12、21**

窗口为 Count:`58–61` 包住真实 Facts.read；入口为一次 `runtime.prepareExecution → Asm:1044`。已有正式 catalog。

| 调用顺序 | 实际调用位置 | 无 previous | 有 previous |
|---|---|---:|---:|
| 当前正式架构 active pointer | Catalog:`379`，一次 `records.readMany` | 1 | 1 |
| active pointer + baseline + catalog | Catalog:`388`，**三个 key 仍只算一次调用** | 1 | 1 |
| observation current pointer | Svc:`1442 → 846 → 812` | 1 | 1 |
| auto-capture request | Svc:`1442 → 848 → 799` | 1 | 1 |
| latest observation record | Svc:`1452 → 609` | 1 | 1 |
| previous observation record | Svc:`1464 → 609` | 0 | 1 |
| latest 主正文 | Svc:`1452 → 621` | 1 | 1 |
| latest 每块正文 | Svc:`639 → 698` | 6 | 7 |
| previous 主正文 | Svc:`1464 → 621` | 0 | 1 |
| previous 每块正文 | Svc:`639 → 698` | 0 | 6 |
| **合计** | | **5 record + 7 body = 12** | **6 record + 15 body = 21** |

`loadObservation` 的 access.open/release 在 Svc:`603、656`；当前场景的 Host bindings 不读取 record/body store，`readFileGraphChunks` 也不重新读 observation record。材料读取发生在 reminder 返回之后，不在窗口内。

因此 **裁定 6 正确**。Count:`72` 的 key 计数碰巧补偿了“active-only 算 0、三 key 批读算 2”，不能作为证明；body counter 也应在调用时加一，而非仅计成功且匹配 contentType 的结果。

**5. 裁定 7 和 D 的可达性**

**Host 可以打开准备材料。** 公开序列：

`runtime.prepareExecution`  
→ Prep:`324–326` 用 `{kind:'run',owner:runRef}` 保存 manifest  
→ H4 取得 `prepared.value.envelope.bundleRef`  
→ `platform.materials.openArtifact(原 Host ctx,{ref,usage:'historical_explanation'})`  
→ [material-service.ts:167](D:/cxt/s8l8-review3/src/core/work-graph/materials/material-service.ts:167) 核对 principal/reader/scope  
→ `:86` 读取正文、`:97` admission  
→ [applicability.ts:63](D:/cxt/s8l8-review3/src/core/work-graph/materials/applicability.ts:63) 读取真实 canonical Run  
→ `:69–77` 核对完整 ref 和 workspace  
→ `:79` allowed。

World:`203–205` 本来就是一致的 Host context，Run 来自真实 claim。因此这里没有必然拒绝，也无需 Run 身份替换。拒绝点分别是 context 不一致、owner 读不到、ref 不一致、跨 scope；`usage:'current'` 才在 applicability:`39–40` 固定拒绝。

**memory Host 可以通过 A4 重开。** 接缝是：

- Host:`500` 调真实 createTargetPlatform；
- Platform:`628–629` 调 memory backend factory；
- Platform:`636` 创建真实 body store；
- Platform:`2022` 关闭 backend。

A4 wrapper 必须让两次平台构造共享同一个真实 backend，并由测试 world 保有物理生命周期；Host 的逻辑 close/drain 照常完成，物理 backend 在最终清理时才关闭。必要时同样共享真实 body store。

不能先真的关闭 raw backend 再返回它：[in-memory-record-store.ts:95](D:/cxt/s8l8-review3/src/core/record-store/in-memory-record-store.ts:95)、`:654–656` 会永久拒绝后续访问。A4 正是允许在 factory/close 所有权处做这层包装，无需新增生产注入口。规则表引用的历史 `K3-35-continuation-fixture.ts` 在本副本不存在，不能声称已复用该 helper。

D 的公开步骤应为：第一 Host 注册 B → 等 B **进入 captureObservation** → close/abort/drain → 第二 Host 仅绑定 A → 等启动工作的完成边界 → 公开读 B 并核对进入计数未增加。不能复用当前“B 始终 queued”的 helper 作为该行前提。

**6. 裁定 2–4 的 await 结果矩阵**

这里把“返回业务 rejected”与“Promise reject/同步 throw”分开。`C` 表示返回 `rejected/cancelled`。

| await 位点 | resolve，未 abort | resolve 时已 abort | reject/throw，未 abort | reject/throw 时已 abort |
|---|---|---|---|---|
| request：Svc:`1253、1260、1273`；fail：`:1325、1332、1343`；capture early：`:996、1002` | 原有成功、业务失败、早期 replay 分流 | **C**，不开始后续 commit | 保持现有外抛 | **C** |
| readAutoCapture：`:1379`；observationState：`:1400、1407、1412` | 原结果，ready 前再检查 | **C** | 原有外抛 | **C** |
| 三个 commit：`:1216、1286、1358`，返回非 committed | 原失败；request 的 revision_conflict 按原有界重试 | **C**，不得先重试 | 原有外抛 | **C**，但这不证明底层没有提交 |
| 同上，返回 committed 且非 replayed | committed | **committed** | — | — |
| late restore：`:1221、1291、1364`，恢复成功 | committed/replayed | **committed/replayed** | 见下方冲突 | 见下方冲突 |
| late restore 返回业务失败 | 现有 restore 失败 | **书中未充分冻结**：不能伪造 committed，也不能无条件套取消规则 | — | — |
| capture 清理：`:1226 → 458` | 保留主结果 | 保留主结果 | quiet cleanup 保留主结果 | 同左；不回滚提交 |

最后两行暴露裁定 2、3 的冲突：**commit 已返回 committed，但 eventAt/restore 随后 throw 且 signal 已取消**。裁定 2 说不改 cancelled，裁定 3 说每个 await throw+abort 返回 cancelled。必须定优先级。

此外，“Only an early replay … checks … after each await”应限于**早晚 replay 的比较**，否则字面上会排除 request 当前记录读取、fail snapshot、普通读 owner 的取消检查，撞上 rework-2 行 B。

准备链的全部相关 await：

| await 位点 | 未取消时的既有结果 | signal 已取消／合法的显式 cancelled |
|---|---|---|
| Facts:`25` catalog；`:28、33` observed | catalog not_found 合法进入空目录；其他结果传出；throw 交 Asm | 最终 C；不能变成提醒降级 |
| Svc:`1442、1452、1464`；内部 `812、799、603、609、621、698、656` | 成功形成 facts；失败或 throw 经提醒层变成一条不可用 | 最终 C |
| Asm:`1044` reminder | ready 渲染；非取消失败/throw 恰一条“架构提醒不可用” | **C，0 后续 put** |
| Asm:`1084` upstream facts | ready 丰富信息；非取消失败/throw 保留可选回退 | **C，0 后续 put**；当前显式 cancelled 被吞 |
| Asm:`1111` input page | ready 消费；业务失败返回；throw→unavailable | **C** |
| Asm:`1149` brief；内部 `902` basis、`923/932` previous turn | 保留现有 ready/rejection/retry/unavailable 区别 | **C**，不能转普通 unavailable facts |
| Brief:`314` bounds、`:220/251` window helper、`:181` 每页 | 保留原有结果；page throw→retry/unavailable | **C**；显式 page cancelled 现已通过 retry code 传播 |
| Asm:`937` workspace facts；内部 `796` resolveRoot、`800` digest、`805` capture | 非取消错误可变 unavailable facts | **C**；`:799` 当前会把合法的 resolveRoot cancelled 降级 |
| Asm:`941` session basis；内部 `847` 每页 | 合法空结果可为 null | **C**；`:850` 当前把显式 cancelled 变成 null |
| Prep:`284` assembler | 非 ready 原样返回；throw→unavailable | **C** |
| Prep:`324` material put | ready 才继续；失败映射 capacity/unavailable；throw→unavailable | 写前取消：不调用 put；写中取消：**C**，已写正文不回滚 |

裁定 4 不能要求所有底层端口都返回同一种 cancelled 对象。[StoreError](D:/cxt/s8l8-review3/src/core/record-store/ports.ts:28) 没有 cancelled；[captureDigest](D:/cxt/s8l8-review3/src/core/agent-runtime/execution-contracts.ts:319) 只有 ready/unavailable；`readTurnBounds` 也使用自己的结果类型。对这些边界应检查原 signal，不能用强制类型转换造不存在的依赖结果。

因此，裁定 4 的取消目标明确，但**typed 边界、深层传播范围和共享 helper 的承接仍需写清**。仅修 C-1 不满足它现在的文字。

**7. 行表及冲突结论**

| 行 | 结论 |
|---|---|
| A | 普通失败/取消修复可施工；early/late replay 测试受裁定 5 阻断。必须先解决提交成功后的异常优先级，以及裁定 4 的完整范围。 |
| B | 真实 callback 路径正确；补上 Obs:`606、847`，共九处。 |
| C | 数值、恢复主体正确；额外 facts 检查不能计入 prepare 窗口。 |
| D | 可施工，A4 合规；必须单独建立 B 曾进入的场景，不改变 K5 的 A running/B queued 前提。 |
| E | 可施工，Host reader 可达。 |
| F | 可施工。abort listener 必须在 close 前装好，或先检查 `signal.aborted`，避免错过同步 abort。 |
| G | 可施工。计数从真实 captureObservation wrapper 进入持续到返回，B entered 后检查 high-watermark。 |
| H | 指定 driver 重试无法到达；且漏列 `:416、616`。不能靠改 identity、手造 replay 或伪造 replayed receipt通过。 |
| I | 可施工，符合 A6。 |
| J | 应恢复，但它**现在就应通过**；不是 C-1 的 RED 测试。 |
| K | 可施工。新书明确纳入，覆盖 V 的 DEFERRED 判定，不再构成范围冲突。 |

与规格、旧裁定的冲突集中在：

- **重试身份**：裁定 5 若被理解为“必须重试出 replay”，违反仍有效的 l8-impl 裁定 4、5。
- **提交与取消**：裁定 2、3 缺晚期恢复失败/throw 的统一优先级。
- **取消范围**：裁定 4 写“每个 R2-4 await”，A 却只给 upstream C-1 的具体验收例，容易漏掉 workspace/session helper 的显式取消。
- **规则表**：手工构造内部身份、让 wrapper 重发内部 owner 命令，不能自行宣称 A3；A3 只允许委托、计数和门控。没有现成 A7 豁免。
- **J 的因果**：与当前 Asm:`1056` 不符；不能为制造 RED 删除已有取消检查。

发包前建议替换以下确切条款：

1. **裁定 2、3，合并冻结优先级：**

   > 三个写 owner 在 commit 开始前检查 signal。commit 返回非 committed 时，先检查 signal；已取消则返回 cancelled，不进行冲突重试。commit 返回 committed 后，正常结果及成功恢复的 replay 结果不因后续取消改变。late restore 指 commit 返回 committed/replayed 后的事件恢复；当前没有 commit throw 后的 lost-reply 恢复流程。late restore 返回失败时保留该失败，抛错时保留该异常，不伪造 committed、不回滚、不改为 cancelled。尚未取得 committed receipt 的范围内，指定 owner await 的 Promise rejection/throw 遇原 signal 已取消，返回 cancelled；未取消保持原行为。capture 的 throw 修复范围为 early lookup/restore；其 commit 非 committed 分支另按本条修复。清理保持原有不覆盖主结果的语义。

2. **裁定 4及 A 的取消范围：**

   > 从 reminder 开始至 prepared material put，原 signal 已取消，或支持取消结果的依赖明确返回 cancelled，均结束准备。覆盖 upstream facts、input page、continuation basis/Turn window、workspace resolveRoot、session-basis window，以及 assembler/put 边界。取消必须穿过 helper，不能降为 unavailable facts 或 null。没有 cancelled 结果类型的端口只按原 signal 判断，不扩充或伪造结果类型。保持非取消行为；修改共享 helper 时同步核对 archive changed-file 消费者。写前取消为 0 put，写中取消不返回 ready且不回滚正文。

3. **裁定 5及 A/H 的 replay 项：**

   > Driver 的重试保持既有设计：先写新 request，使用新 requestId、requestSeq 和 revision，不重发旧命令。requestAutoCapture、failAutoCapture 及自动 capture 的 early/late replay 均不能由该路径到达；这些验收项预先记为 BLOCKED，不得报告完成、删除覆盖或改变生产身份规则。待 lead 冻结符合规则表的测试入口后再施工。手动 capture 的相同公开请求重放继续允许，用于 capture 自身的 replay 合同，不能替代内部 request/fail 的覆盖。

4. **B/H 的完整位点：**

   > B 包含 Obs:424、473、489、541、606、624、635、645、847 的全部手调通知。H 包含 Obs:415–417、441–442、615–617 的自动身份/内部 watermark 重放，以及 request/fail 两组；captureRequest 完整位置为 Obs:384–390。普通手动 capture 调用保留其公开输入语义。

5. **D 的场景分离和 A4 生命周期：**

   > K5 保留 A running/B queued 的 SQLite 场景。T18/T19 另建双后端场景，先证明 B 在第一 Host 真正进入 captureObservation，再关闭；第二 Host 只绑定 A。memory 通过 factory wrapper 共享同一个真实 record backend，必要时共享 body store；Host 逻辑关闭照常，物理 backend 由 world 最后关闭。不得复用已物理关闭的 backend。

6. **J 的依赖说明：**

   > 恢复 reminder reader 在原 signal 未取消时明确返回 cancelled 的旧行，保持 rejected/cancelled、input=null，并核对 0 prepared-material puts。该分支由现有 Asm:1056 处理，恢复后允许直接 GREEN；它与 A 中 upstream facts 的 C-1 是两个独立分支，不以 C-1 修复作为通过前提。