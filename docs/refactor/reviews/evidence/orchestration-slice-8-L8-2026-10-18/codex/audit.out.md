本次为只读静态审计：33 个范围文件全部逐行读完；改动函数及其实际调用链已追查。未修改文件，未运行测试、构建、Host 或模型。范围内 **UNREAD：无**。

以下按“独立代码位置或独立缺测行为”计数；共用 helper 的根问题计一次，并列出其调用方。KNOWN、异步表、覆盖表对同一问题的重复引用不重复计数。“删掉检查仍能通过”均为静态控制流判断，没有运行变异测试。

为缩短表格，后文使用文件名加行号；完整路径在 COVERAGE 中。范围外 helper 保留其路径。

## 1. COVERAGE

| 文件 | 全文读完 | 发现类别 | 最后读到的函数、测试或声明 |
|---|---|---|---|
| `docs/refactor/module-target.json` | 是，208 行 | clean on T, P1–P6 | `RecordStore`，文件结束 `:208` |
| `src/app/auto-capture-driver.ts` | 是，282 行 | P1、P2、P3、P4 建议 | `createAutoCaptureDriver.close:270` |
| `src/app/core-http-types.ts` | 是，780 行 | P5 | 文件末尾 `ChangeReset`，`:780` |
| `src/app/core-routes.ts` | 是，1035 行 | P3、P5 | `dispatchCoreRoute:873`，读至结束 |
| `src/app/host.ts` | 是，1616 行 | P1、P2、P3 | `createLocalWorkbenchHost.close:1593` |
| `src/composition/architecture-reminder-facts.ts` | 是，31 行 | P1，KNOWN3 同链 | `createArchitectureReminderFactsReader:14` |
| `src/composition/create-platform.ts` | 是，2042 行 | P1、P3 建议 | `createTargetPlatform:567`，读至结束 |
| `src/contracts/architecture-catalog.ts` | 是，87 行 | clean on T, P1–P6 | `moduleMappingsOf:81` |
| `src/contracts/architecture-observation.ts` | 是，62 行 | P4 | `ArchitectureReminderFactsV1:56` |
| `src/contracts/path-ownership.ts` | 是，100 行 | clean on T, P1–P6 | `bestModuleDirectoryPrefixLength:93` |
| `src/core/agent-runtime/architecture-reminders.ts` | 是，204 行 | P6，测试缺口；未发现额外 P5 实现错误 | `architectureReminderRowEntries:188` |
| `src/core/agent-runtime/context-assembler.ts` | 是，1290 行 | P1、P4 建议 | `createContextAssembler.readAttentionGraph`，读至 `:1290` |
| `src/core/agent-runtime/execution-contracts.ts` | 是，324 行 | P4 建议 | `ContinuationWorkspaceSource:317` 及末尾导出 |
| `src/core/work-graph/architecture/architecture-record-codecs.ts` | 是，812 行 | P3、P4 | `decodeArchitectureSourceObservedEvent:808` |
| `src/core/work-graph/architecture/architecture-service.ts` | 是，1623 行 | P1、P3、P4、P5 | `compareFormalObserved:1582` 及返回端口 `:1620` |
| `src/core/work-graph/architecture/contracts.ts` | 是，165 行 | P3、P5 | `ObservedArchitecturePort.compareFormalObserved:162` |
| `src/core/work-graph/state/architecture-capture.ts` | 是，92 行 | P4 | `newArchitectureCaptureFailureRecord:74` |
| `src/ui/api/routes.ts` | 是，154 行 | clean on T, P1–P6 | `routeLabel:154` |
| `src/ui/views/setup/requests.ts` | 是，269 行 | clean on T, P1–P6 | `taskGoalIdOf:266` |
| `tests/app/S8A-L8-auto-capture-gate.test.ts` | 是，355 行 | T、P2、P3、P6 | `does not retry a pending request of a workspace not bound in this Host`，`:310` |
| `tests/app/S8A-L8-auto-capture-host.test.ts` | 是，173 行 | T | `the manual architecture/capture route still works`，`:154` |
| `tests/app/S8A-L8-host-restart.test.ts` | 是，119 行 | clean on T, P1–P6 | `a settings Host restart with a pending request captures exactly once (sqlite)`，`:65` |
| `tests/app/support/S8A-L8-host.ts` | 是，176 行 | P4 注释建议 | `completed`，读至 `:176` |
| `tests/architecture/state-writes.test.ts` | 是，1100 行 | T、P4 | `reports nothing else:1096` |
| `tests/composition/S8A-L8-adoption-capture.test.ts` | 是，267 行 | T | 注册、初次采用、修订、重放及首次空模块层比较的综合行，`:160` 后读至结束 |
| `tests/composition/S8A-L8-capture-mappings.test.ts` | 是，306 行 | T | `keeps the requested time on the record after the failure write:281` |
| `tests/composition/S8A-L8-pass-capture.test.ts` | 是，431 行 | T | `row 3: the same finalize request replays and changes no capture state:398` |
| `tests/composition/WP2-wiring.test.ts` | 是，2079 行 | T、P6 | `F10 … Work recognition:1989` |
| `tests/scenarios/WP2-wiring-scenario.test.ts` | 是，269 行 | T、P6 | Z01，读至 `finally` 和原有 timeout `:269` |
| `tests/state/S8A-L8-auto-capture-state.test.ts` | 是，129 行 | clean on T, P1–P6 | `rejects a 2001-character reason … naming 2000:114` |
| `tests/work-graph/S8A-L8-observation-state.test.ts` | 是，644 行 | T、P1、P2、P6 | `L8-6 … one reminder read loads each observation once:564` 及末尾清理 |
| `tests/work-graph/S8A-L8-reminders-public.test.ts` | 是，568 行 | T、P1、P6 | `a failure after a success keeps the old observation rows until the retry:512` |
| `tests/work-graph/S8A-L8-reminders.test.ts` | 是，244 行 | T、P6 | `keeps the literal src/a before src/a/inner paths with ascending keys:221` |

额外全文读过 `src/core/agent-runtime/execution-preparation.ts:1` 至 `:418`、`tests/helpers/WP2-platform-support.ts:1` 至 `:929`；相关 owner、Runtime、Workflow、Host 恢复、存储和正文读取函数按实际调用链读取。没有把这些外围文件一概宣称为全文审计通过。

## 2. KNOWN

下面各行均为 **必须改**。第 4 项的“同类实例”包括其他范围文件中的伪造 Host 事实、伪造失败和直接读库断言；不因它们位于旧 WP2 测试而豁免。

先固定后文使用的修复路径。这里没有声称新的共享 helper 已经存在：

| 路径 | 唯一采用的公开步骤及已有定位 |
|---|---|
| H1：真实初始计划 | 从 `tests/app/R6-host.test.ts:752` 抽取 `initial_coordination → queries/submit:754 → sessions/create:761 → claim:768 → prepare:774 → start:780 → planning_answer → workflow/goal-input:807、:834`；新 helper 只收 ids、名称、文件及脚本模型回复。 |
| H2：真实 Host、工作区 | 复用 `tests/app/support/S8A-L8-host.ts:78` 的 `startHost`、`:74` 的配置及 `:149` 的登记；根和授权由 `src/app/host.ts:450`、`:456` 产生。 |
| H3：真实后续触发 | 初次采用走 `tests/app/support/S8A-L8-host.ts:161`；修订抽取 `S8A-L8-adoption-capture.test.ts:215、:221` 的真实步骤，经 `corePost:107` 调用。 |
| H4：公开 prepare 和正文 | 抽取 `tests/helpers/WP2-platform-support.ts:914` 的步骤：`runtime.prepareExecution:917 → materials.openArtifact:919 → 解析公开正文:922`；不继承旧夹具的造事实部分。 |
| H5：委托门控、计数 | 保留 `S8A-L8-observation-state.test.ts:88` 的真实依赖委托门控；增加 entered/completed 握手，计数安装在 H4 的一次公开 prepare 之下。 |
| H6：真实运行配置 | 使用 `src/app/runtime-configuration.ts:351` 的 `createWorkbenchRuntimeHostBindings`，配置脚本 provider；不直接返回 assembled configuration。 |
| H7：真实 Kernel 故障、恢复 | 使用 `tests/helpers/A2-restart-fixture.ts:203` 的 `moveKernelAside`、`tests/scenarios/support/common.ts:434` 的 `putKernelBack`，以及 `tests/scenarios/harness.ts:930` 的真实 Host restart。 |

### KNOWN1：chunk 未纳入 project/workspace

| 实例 | 位置及现状 | 唯一处置 |
|---|---|---|
| K1-01 | `architecture-service.ts:369`：空图 chunk 的正文只有 schema、nodes、edges、unresolved；所有空工作区可得到同一正文。 | 生产修复：正文加入稳定的 projectId/workspaceId。 |
| K1-02 | `architecture-service.ts:380`：节点 chunk 的序列化没有 scope。 | 生产修复：节点 chunk 使用同一带 scope 的格式。 |
| K1-03 | `architecture-service.ts:381`：边 chunk 的序列化没有 scope；相同索引对即可碰撞。 | 生产修复：边 chunk 使用同一带 scope 的格式。 |
| K1-04 | `architecture-service.ts:382`：unresolved chunk 的序列化没有 scope。 | 生产修复：unresolved chunk 使用同一带 scope 的格式。 |
| K1-05 | `src/core/work-graph/architecture/contracts.ts:47`：`ObservedFileGraphChunkV2` 没有 project/workspace 字段。 | 生产修复：更新当前格式声明。 |
| K1-06 | `architecture-record-codecs.ts:318、:321、:334、:338`：校验、精确键集合、解码结果都没有 scope。 | 生产修复：只接受新格式，并返回、校验 scope。 |
| K1-07 | `architecture-service.ts:1129、:1134、:1136`：分块、字节上限和编码自检仍按无 scope 正文计算。 | 生产修复：把 scope 字节计入实际分块上限。 |
| K1-08 | `architecture-service.ts:1152` 写入正文；`body-store.ts:39` 复用已有内容地址并保留首写 origin；`architecture-service.ts:698` 又要求 origin 属于当前工作区。 | 生产修复：以正文 scope 消除跨工作区内容地址复用，保留 origin 检查。 |
| K1-09 | `architecture-service.ts:706` 解码 chunk 后没有正文 scope 与请求 scope 的核对。 | 生产修复：新增正文 scope 一致性核对，保留 `:714、:720` 的路径授权。 |
| K1-10 | `S8A-L8-auto-capture-gate.test.ts:33、:35` 特意使用不同内容避开首写 origin；范围内没有相同内容双工作区各再次触发、各 prepare 的回归。 | 公开路径 H2＋H3＋H4，双后端补完整回归。 |

### KNOWN2：capture 开始后的 observation-state 失败静默退出

| 实例 | 位置及现状 | 唯一处置 |
|---|---|---|
| K2-01 | `auto-capture-driver.ts:175、:178`：已有开始 seq/revision，observation-state 非 ready 却直接 return。 | 生产修复：非取消失败进入已有 revision 守卫的统一 failure 出口。 |
| K2-02 | `auto-capture-driver.ts:180`：同一读取抛错也直接 return。 | 生产修复：取消不写；其他异常转成有原因的失败。 |
| K2-03 | `S8A-L8-observation-state.test.ts:451、:457` 只故障注入目录读取，没有 start observation-state 的拒绝、抛错和取消行。 | 公开路径 H3＋H5，分别覆盖三个结果及旧 revision 不覆盖新请求。 |

目录 `not_ready` 的直接返回 `auto-capture-driver.ts:197` 已由返工书明确允许，本报告不推翻该裁定。

### KNOWN3：提醒读取取消被当成普通提醒失败

| 实例 | 位置及现状 | 唯一处置 |
|---|---|---|
| K3-01 | `context-assembler.ts:1040`：await 后不检查 signal；取消期间 resolve ready 仍生成正常行。 | 生产修复：处理返回值前检查取消。 |
| K3-02 | `context-assembler.ts:1043`：取消期间 throw 被降级成“架构提醒不可用”。 | 生产修复：catch 中优先返回 cancelled。 |
| K3-03 | `context-assembler.ts:1047`：只识别返回的 `code:'cancelled'`；signal 已取消但返回其他失败时仍继续。 | 生产修复：signal 与返回的取消都终止准备。 |
| K3-04 | `execution-preparation.ts:264、:270`：assemble 返回后未检查 signal，继续构造 manifest。 | 生产修复：assembly await 后检查取消。 |
| K3-05 | `execution-preparation.ts:267`：assembly 因取消抛错时统一变 unavailable。 | 生产修复：catch 中按 signal 保留 cancelled。 |
| K3-06 | `execution-preparation.ts:298、:322`：正文写入等待期间取消仍可返回 ready。 | 生产修复：返回准备成功前核对取消；已产生的未引用正文不冒充成功准备。 |
| K3-07 | `architecture-reminder-facts.ts:20、:22、:25`：catalog await 和 observed Promise 的取消依赖下游返回，没有自行保证最终取消结果。 | 生产修复：在真实 facts 读取链保留取消语义。 |
| K3-08 | `architecture-service.ts:1400`：提醒 basis 读取后不检查取消。 | 生产修复：读后检查取消。 |
| K3-09 | `architecture-service.ts:1407`：latest 读取后不检查取消。 | 生产修复：读后检查取消。 |
| K3-10 | `architecture-service.ts:1418、:1429`：previous 读取后仍可返回 ready facts。 | 生产修复：最终成功返回前检查取消。 |
| K3-11 | `S8A-L8-reminders-public.test.ts:497、:501` 只返回 cancelled，未取消真实 signal；`:465` 的 throw 行未取消。 | 公开路径 H4＋H5，补“读取过程中取消且抛错”这一独立行。 |

### KNOWN4：L8 测试里的全部同类残留

| 实例 | 文件:行及原因 | 唯一处置 |
|---|---|---|
| K4-01 | `S8A-L8-auto-capture-gate.test.ts:207`：无采用事实却发送 `catalog_adopted`，F5。 | H3。 |
| K4-02 | `S8A-L8-auto-capture-gate.test.ts:221`：再次发送无真实原因的 adopted，F5。 | H3。 |
| K4-03 | `S8A-L8-observation-state.test.ts:311`：改文件后重复登记通知，F5。 | H3。 |
| K4-04 | `S8A-L8-observation-state.test.ts:356`：移走根后重复登记通知，F5。 | H3。 |
| K4-05 | `S8A-L8-observation-state.test.ts:369`：恢复根后重复登记通知，F5。 | H3。 |
| K4-06 | `S8A-L8-observation-state.test.ts:418`：运行中重复登记通知，F5。 | H3。 |
| K4-07 | `S8A-L8-observation-state.test.ts:494`：目录拒绝靠重复登记触发，F5。 | H3。 |
| K4-08 | `S8A-L8-observation-state.test.ts:502`：目录拒绝后的重试仍靠重复登记，F5。 | H3。 |
| K4-09 | `S8A-L8-observation-state.test.ts:508`：目录抛错靠重复登记触发，F5。 | H3。 |
| K4-10 | `S8A-L8-reminders-public.test.ts:543`：`:161` 已采用目录，此处没有新采用却直接通知，F5。 | H3。 |
| K4-11 | `S8A-L8-reminders-public.test.ts:558`：再次直接 adopted，F5。 | H3。 |
| K4-12 | `S8A-L8-capture-mappings.test.ts:286`：替 Host 写 request、指定 requestedAt，F3。 | 删除 `:281` 的重复服务行；保留纯状态测试 `S8A-L8-auto-capture-state.test.ts:58`。 |
| K4-13 | `S8A-L8-capture-mappings.test.ts:292`：手写 failure，未真实移走根，F6/F3。 | 删除同一重复服务行。 |
| K4-14 | `S8A-L8-observation-state.test.ts:334、:336`：经 `pointerOf:252、:255` 直接读库断言 watermark，F7。 | H3＋公开 `observationState:215`。 |
| K4-15 | `S8A-L8-observation-state.test.ts:443`：旧失败守卫行再次直接读 pointer，F7。 | 公开 `observationState:215`。 |
| K4-16 | `S8A-L8-observation-state.test.ts:557`：manual max 行重复直接读库；`:553` 已有公开断言，F7。 | 删除该库断言及不再使用的 helper，保留公开断言。 |
| K4-17 | `S8A-L8-observation-state.test.ts:576`：经 `chunkCountOf:263、:266` 读库取得期望的 chunk 数，F7/F8。 | H4＋H5，使用独立手算的文件与分块例子。 |
| K4-18 | `S8A-L8-observation-state.test.ts:604`：再次读第一观测 chunk 数作为 oracle，F7。 | H4＋H5。 |
| K4-19 | `S8A-L8-observation-state.test.ts:614`：读第二观测 chunk 数作为 oracle，F7。 | H4＋H5。 |
| K4-20 | `S8A-L8-observation-state.test.ts:628`：读 latest chunks 支撑计数期望，F7。 | H4＋H5。 |
| K4-21 | `S8A-L8-observation-state.test.ts:630`：读 previous chunks 支撑计数期望，F7。 | H4＋H5。 |
| K4-22 | `S8A-L8-observation-state.test.ts:598`：只计 reader，不调用 prepare，F10。 | 把委托计数安装到 H4。 |
| K4-23 | `S8A-L8-observation-state.test.ts:621`：第二次仍只计 reader，F10。 | 把委托计数安装到 H4。 |
| K4-24 | `S8A-L8-reminders-public.test.ts:300、:302`：`preparePublic` 直接读 RawArtifactBodyStore 并解析，全部成功文本断言依赖它，F7。 | H4，改用 `materials.openArtifact`。 |

K4-24 的全部成功调用点为 `S8A-L8-reminders-public.test.ts:342、:370、:394、:416、:435、:454、:471、:487、:536、:553`；`:503` 的取消分支提前返回，不执行该 raw read。

`S8A-L8-observation-state.test.ts:478` 有 `:476` 的真实非重放采用前因；`S8A-L8-adoption-capture.test.ts:122`、`S8A-L8-pass-capture.test.ts:260` 也在转发真实通知，不列 F5。

### KNOWN4 同类：旧 WP2 的 21 个伪造 health/reconcile 位点

统一问题是 F3；伪造 missing/失败同时命中 F6。下面每行只采用 H7 的真实 Host 故障、恢复路径；既有提交故障包装可以保留。

| 实例 | 文件:行 | 唯一处置 |
|---|---|---|
| K4-25 | `WP2-wiring.test.ts:767`：F11 手写 missing。 | H7。 |
| K4-26 | `WP2-wiring.test.ts:934`：F13 手写 missing。 | H7。 |
| K4-27 | `WP2-wiring.test.ts:1039`：F15 提交失败前使用 built missing probe。 | 保留 A2 提交故障，由 H7 真实探测触发写入。 |
| K4-28 | `WP2-wiring.test.ts:1049`：F15 重试再次手写 missing。 | H7 的真实重试。 |
| K4-29 | `WP2-wiring.test.ts:1183`：F14 Work 手写 missing。 | H7。 |
| K4-30 | `WP2-wiring.test.ts:1258` → `:133`：F09 手写 missing。 | H7。 |
| K4-31 | `WP2-wiring.test.ts:1321` → `:133`：F10 手写 missing。 | H7。 |
| K4-32 | `WP2-wiring.test.ts:1402`：Work reconcile 接受 built ready/activeRunId。 | H7，重启观察真实挂起的 Turn。 |
| K4-33 | `WP2-wiring.test.ts:1447` → `:133`：F12 首次 missing。 | H7。 |
| K4-34 | `WP2-wiring.test.ts:1459` → `:133`：F12 手写 ready 恢复。 | 恢复真实 Kernel 后 H7。 |
| K4-35 | `WP2-wiring.test.ts:1465` → `:133`：F12 再次 missing。 | 第二次真实故障后 H7。 |
| K4-36 | `WP2-wiring.test.ts:1542`：F14 user answer 手写 missing。 | H7。 |
| K4-37 | `WP2-wiring.test.ts:1637`：F14 Query answer 手写 missing。 | H7。 |
| K4-38 | `WP2-wiring.test.ts:1808`：Query reconcile 接受 built ready。 | H7，观察真实正在执行的 Query。 |
| K4-39 | `WP2-wiring.test.ts:1821`：再次提交旧 Query record 和 built ready probe。 | 第二次真实 Host restart，验证公开状态不变。 |
| K4-40 | `WP2-wiring.test.ts:1950`：Query 手写 missing→unknown。 | H7；保留后续公开 `resolveUnknownQueryRun`。 |
| K4-41 | `WP2-wiring.test.ts:2046`：Work 手写 missing→unknown。 | H7；保留 `resolveUnknownRun:2056`。 |
| K4-42 | `WP2-wiring-scenario.test.ts:197`：Z01 手写 missing。 | H7。 |
| K4-43 | `WP2-wiring-scenario.test.ts:243`：Z01 手写 ready。 | 恢复 Kernel 后 H7。 |
| K4-44 | `WP2-wiring-scenario.test.ts:251`：Z01 再次手写 missing。 | 第二次真实故障后 H7。 |
| K4-45 | `WP2-wiring-scenario.test.ts:257`：Z01 再次手写 ready。 | 第二次恢复后 H7。 |

共同 `recordHealth` 实现 `WP2-wiring.test.ts:131` 不另计一个调用实例。

### KNOWN4 同类：旧 WP2 的 raw event/store oracle

| 实例 | 文件:行及原因 | 唯一处置 |
|---|---|---|
| K4-46 | `WP2-wiring.test.ts:323`：从 raw `SessionMessageSent` event 提取原 requestId，后续测试依赖内部事件。 | 从公开发送步骤 `WP2-wiring.test.ts:103` 抽 helper，直接保存调用时提供的 requestId。 |
| K4-47 | `WP2-wiring.test.ts:1226、:1234`：经 `responseIdentityOf:55` 读 raw responseRef/respondedAt 自证 DTO。 | 将精确 DTO 映射例移到具名 `WP2-undelivered-reply-dto-pure.test.ts`；服务行用公开正文和回执。 |
| K4-48 | `WP2-wiring.test.ts:1416、:1424`：同一 raw helper 用于 F10 Work。 | 同一具名纯测试接收本例，服务行保留公开回执检查。 |
| K4-49 | `WP2-wiring.test.ts:1550、:1558`：同一 raw helper 用于 user answer。 | 同一具名纯测试接收本例，服务行使用公开正文。 |
| K4-50 | `WP2-wiring.test.ts:1678、:1706`：raw Query answer event 产生 DTO 期望及位置依据。 | DTO 映射移到上述纯测试；位置使用公开 CommitNotice。 |
| K4-51 | `WP2-wiring-scenario.test.ts:136、:147、:161`：从 raw send event 提取 key，再据此期待提醒文本。 | 从真实模型工具公开回执取得消息 ID，按规格手写 key 和文本；正文走 H4。 |
| K4-52 | `WP2-wiring-scenario.test.ts:203、:229`：读 raw health event JSON 选择 health 提交。 | 使用生产公开 CommitNotice，按操作窗口和 Session aggregate 定位。 |
| K4-53 | `WP2-wiring-scenario.test.ts:182` → `tests/scenarios/harness.ts:590、:618`：默认 invariants 每步直接读记录库核对。 | built-world 判定迁至具名 `WP2-invariants-pure.test.ts`；场景中的业务不变量改用公开 read，保留原覆盖。 |

`tests/helpers/WP2-platform-support.ts:793` 的 `preparedCommits()` 复制 backend 的 event JSON，属于上述问题；`:779` 的生产 `commitObserver` 提供公开 CommitNotice，不等同直接读库。公开首次回执与重放回执相等也不属于 F8。

### KNOWN5：真实 Host 的排队关闭和重启

| 实例 | 位置及现状 | 唯一处置 |
|---|---|---|
| K5-01 | `S8A-L8-auto-capture-gate.test.ts:232、:254、:268` 调 `driver.close()`，未覆盖真实 Host 的关闭接线。 | H2＋H5，SQLite Host 中 A 运行、B 排队时真实 close，验证两者 pending。 |
| K5-02 | `S8A-L8-auto-capture-gate.test.ts:285、:288、:291` 重建 platform 后手调 `retryPending`，未覆盖 Host 启动恢复。 | 重开 K5-01 的同一 SQLite Host，验证 A/B 各新增一次 startup_retry 并完成。 |

`S8A-L8-auto-capture-host.test.ts:119`、`S8A-L8-host-restart.test.ts:65` 是真实“失败后重启”，应保留；它们不等于关闭时尚未运行的排队请求恢复。

## 3. FINDINGS per class

本节编号 **T01–T71、P01–P16** 均为 KNOWN 之外的独立必须改实例，共 87 个。建议使用单独的 S 编号，不计入末尾数字。

### T：新增 L8 测试问题

系统性修复：把状态生成收回真实 Host、Runtime、Workflow 和公开 owner 路径；门控只包装真实依赖；纯规则放具名纯测试；期望不读取内部存储或被测输出生成。

| ID／分类 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| T01 必须改，F1 | `S8A-L8-pass-capture.test.ts:113、:243`：手造完整 Plan draft 后被 owner 接受。 | H1。 |
| T02 必须改，F1 | `S8A-L8-reminders-public.test.ts:175、:190`：手造 Plan 后继续采用、claim、prepare。 | H1。 |
| T03 必须改，F4 | `S8A-L8-adoption-capture.test.ts:70`：root/revision 是替身构造的 ready 值。 | H2。 |
| T04 必须改，F4 | `S8A-L8-adoption-capture.test.ts:75`：替身构造授权结果。 | H2。 |
| T05 必须改，F4 | `S8A-L8-capture-mappings.test.ts:56`：替身构造 root/revision。 | H2。 |
| T06 必须改，F4 | `S8A-L8-capture-mappings.test.ts:61`：替身构造授权结果。 | H2。 |
| T07 必须改，F4 | `S8A-L8-pass-capture.test.ts:167`：替身构造 root/revision。 | H2。 |
| T08 必须改，F4 | `S8A-L8-pass-capture.test.ts:172`：替身构造无条件授权。 | H2。 |
| T09 必须改，F4 | `S8A-L8-observation-state.test.ts:128`：access factory 的 root 端口返回 built 值。 | H2。 |
| T10 必须改，F4 | `S8A-L8-observation-state.test.ts:131`：access factory 的授权端口返回 built 值。 | H2。 |
| T11 必须改，F4 | `S8A-L8-reminders-public.test.ts:114`：root/revision 替身。 | H2。 |
| T12 必须改，F4 | `S8A-L8-reminders-public.test.ts:119`：授权替身。 | H2。 |
| T13 必须改，F4 | `S8A-L8-pass-capture.test.ts:86`：`resolveConfiguration` 构造完整配置，`:97` 又固定 tokens=256。 | H6，去掉这份组装后配置替身。 |
| T14 必须改，F4 | `S8A-L8-reminders-public.test.ts:253`：`hostFor` 构造配置，model client 为空对象强转。 | H6。 |
| T15 必须改，F4 | `S8A-L8-reminders-public.test.ts:284、:286`：把公开 Role resolution 重新包装为 `{result, guards:[]}`，不是实际 facts reader 的原样结果。 | H4，使用 composition root 的真实 Role facts。 |
| T16 必须改，F9 | `S8A-L8-auto-capture-gate.test.ts:208`：sleep 250ms，之后谓词恒 true。 | H3＋H5 的完成握手。 |
| T17 必须改，F9 | `S8A-L8-auto-capture-gate.test.ts:271`：已 await close，仍 sleep 250ms。 | 删除 sleep，保留 close 后断言。 |
| T18 必须改，F9 | `S8A-L8-auto-capture-gate.test.ts:326`：同样在 close 后 sleep。 | 删除 sleep。 |
| T19 必须改，F9/P6 | `S8A-L8-auto-capture-gate.test.ts:344`：sleep 400ms 证明未绑定工作区未重试；当前也只是给 driver 传 `[A]`。 | H2＋H5，以真实 Host 启动完成边界验证未绑定 B 不重试。 |
| T20 必须改，F9 | `S8A-L8-auto-capture-host.test.ts:50`：sleep 250ms 后才检查重放未触发。 | H2＋A3 委托通知计数，以真实调用边界检查。 |
| T21 必须改，F9 | `S8A-L8-adoption-capture.test.ts:239`：sleep 300ms；真实通知已在 `:122` 同步记录。 | 删除 sleep，保留 events 精确断言和公开状态断言。 |
| T22 必须改，F9 | `S8A-L8-pass-capture.test.ts:423`：sleep 300ms 等潜在错误 detached capture。 | H5，给真实通知链增加完成握手。 |
| T23 必须改，F9 | `S8A-L8-auto-capture-gate.test.ts:156`：用 sleep 轮询内部 gate；调用在 `:170、:177、:199、:213、:259、:319`。 | H5，增加 entered Promise 并直接等待。 |
| T24 必须改，F11 | `S8A-L8-auto-capture-gate.test.ts:172`：通知 B 后立即检查未进入并释放 A；B 的异步请求写入可能尚未完成，删除 driver `:138` 的串行检查仍可通过。 | H5，A 保持门内，等 B 真实接受及调度边界，记录并断言 `maxActive=1`。 |
| T25 必须改，F11/P6 | `S8A-L8-reminders.test.ts:175`：同时设 catalog=null、taskModule=null；删除生产 `architecture-reminders.ts:142` 任一 OR 条件仍通过。 | 具名 `S8A-L8-reminders-pure.test.ts`，拆成两个独立输入。 |
| T26 必须改，F11/P6 | `S8A-L8-reminders.test.ts:181`：同时 2 deleted、2 added；删除生产 `:111` 或 `:113` 任一唯一性检查，另一项仍遮蔽。 | 同一具名纯测试，分别测 2/1、1/2，并保留 1/1 正例。 |
| T27 必须改，A5 | `S8A-L8-reminders.test.ts:221`：文件与其子文件同时存在属于明确不可达组合，却未放 `*-pure.test.ts`。 | 将该纯渲染测试文件命名为 `S8A-L8-reminders-pure.test.ts`。 |
| T28 必须改，Every row | `S8A-L8-reminders-public.test.ts:278`：两种后端的 prepare 都新建 memory body store；SQLite 标签未覆盖实际 SQLite 正文链。 | H4，使用实际平台的 prepare/body store/openArtifact。 |
| T29 必须改，P6 | `S8A-L8-observation-state.test.ts:383` 只测第一轮失败、第二轮成功；没有第一轮成功后新请求仍 pending 的独立行。 | H3＋H5，双后端门住两轮，断言第一轮成功后 seq2/pending=true，第二轮后 false。 |
| T30 必须改，P6 | `S8A-L8-reminders.test.ts:195` 标题称 each threshold，却没有 60 秒、60 分、24 小时边界及分钟/天的非整数取整例。 | 具名纯测试补这些独立手算边界。 |
| T31 必须改，P6 | `S8A-L8-reminders.test.ts:181`、`S8A-L8-reminders-public.test.ts:329` 都没有“未移动文件也有同 digest，但 deleted/added 各唯一”的例子；错误复用 full-list 唯一性也可通过。 | 具名纯测试补 1 deleted＋1 added＋1 unchanged 同 digest，字面期望一个 move。 |
| T32 必须改，P6 | `S8A-L8-reminders.test.ts:128、:221` 没有同类、同 path、不同 rest 的乱序输入，第三排序键没有证据。 | 具名纯测试提供打乱输入及完整字面顺序。 |

规则 A3 明文接受的 gate 基础绑定例外问题留在 OPEN QUESTIONS；没有把 `S8A-L8-auto-capture-gate.test.ts:87、:97` 直接算进 T03–T12。

施工书允许的公开状态有界轮询不计 F9：`S8A-L8-auto-capture-gate.test.ts:148`、`S8A-L8-host.ts:143`、`S8A-L8-adoption-capture.test.ts:142`、`S8A-L8-pass-capture.test.ts:281`、`S8A-L8-observation-state.test.ts:230`、`S8A-L8-reminders-public.test.ts:322`、`S8A-L8-host-restart.test.ts:55、:116`。

### T：旧 WP2 共用夹具的根实例

这些 helper 虽不在 33 个文件名中，却由范围内测试实际调用，受规则表约束。系统性修复是统一公共前置步骤；不保留另一套“测试世界”状态写入。

| ID／分类 | 根实例 | 唯一处置 |
|---|---|---|
| T33 必须改，F1/F3 | `tests/helpers/task-claim-fixture.ts:178、:201、:206、:212`：手造治理、Project、Workspace 记录并直接 commit。 | 抽取 `tests/helpers/AG2b-collaboration-fixture.ts:350` 的公开 create/register/install/activate/adopt 步骤。 |
| T34 必须改，F1 | `tests/helpers/task-claim-fixture.ts:259`：手写初始 Plan draft 再 propose。 | H1。 |
| T35 必须改，F3 | `tests/helpers/task-claim-fixture.ts:297、:303、:306`：直接写 Kernel store 并调用 `recordSessionCreated`。 | 使用 `tests/helpers/AG2b-collaboration-fixture.ts:381` 的正式 sessions/create 路径。 |
| T36 必须改，F4 | `tests/helpers/task-claim-fixture.ts:224`：materials 端口固定返回手造 unsupported，并非包装真实依赖的 A2 故障。 | 使用正式平台 material owner。 |
| T37 必须改，F1/F3/A1 | `tests/helpers/WP2-platform-support.ts:579` 经 `task-claim-fixture.ts:237` 的 `commitRaw` 手造 coordination revision/active；helper 接收 EncodedRecord。 | 使用 `tests/helpers/AG2b-collaboration-fixture.ts:185` 的真实配置加载和 Host 路径，删除这条种记录路径。 |
| T38 必须改，F1/F3 | `tests/helpers/WP2-platform-support.ts:517、:595`：手造只读副本的 Kernel identity、Session 创建事实和不存在的 source 消息引用。 | 从真实 Session 创建 `AG2b-collaboration-fixture.ts:381` 进入真实 Query prepare/start `:460`，产生副本。 |
| T39 必须改，F1 | `tests/helpers/WP2-platform-support.ts:621`：第二个 Goal 的 built draft。 | H1，独立规划第二个 Goal。 |
| T40 必须改，F1 | `tests/helpers/WP2-platform-support.ts:675`：deferred Goal 的 built draft。 | H1，用脚本模型回复产生所需计划。 |
| T41 必须改，F1 | `tests/helpers/WP2-platform-support.ts:288`：memory 分支手写 draft；调用 `:468、:474`。 | H1，并经 A4 共享 memory backend。 |
| T42 必须改，F4 | `tests/helpers/WP2-platform-support.ts:711`：SQLite 分支 Work 配置替身。 | H6。 |
| T43 必须改，F4 | `tests/helpers/WP2-platform-support.ts:731`：SQLite 分支 Query 配置替身。 | H6。 |
| T44 必须改，F4 | `tests/helpers/WP2-platform-support.ts:750`：SQLite 分支 root 替身。 | H2 的真实 Host 绑定。 |
| T45 必须改，F4 | `tests/helpers/WP2-platform-support.ts:755`：SQLite 分支授权替身。 | H2 的真实 Host 绑定。 |
| T46 必须改，F4 | `tests/helpers/WP2-platform-support.ts:339`：memory 分支 Work 配置替身。 | H6，A4 共享 memory backend。 |
| T47 必须改，F4 | `tests/helpers/WP2-platform-support.ts:360`：memory 分支 Query 配置替身。 | H6，A4 共享 memory backend。 |
| T48 必须改，F4 | `tests/helpers/WP2-platform-support.ts:379`：memory 分支 root 替身。 | H2，A4 共享 memory backend。 |
| T49 必须改，F4 | `tests/helpers/WP2-platform-support.ts:384`：memory 分支授权替身。 | H2，A4 共享 memory backend。 |
| T50 必须改，F1 | `WP2-wiring-scenario.test.ts:168` → `tests/scenarios/harness.ts:874` → `AG2b-collaboration-fixture.ts:369`：接受 `ag2bPlanDraft:307`。 | H1 替换种计划步骤，保留真实 Host 创建。 |

上述 WP2 共用夹具的全部范围内入口如下；分支按各行 options 实际执行，不把共用根问题重复计数：

| 测试声明 | fixture 调用 |
|---|---|
| `WP2-wiring.test.ts:183` F01 | `WP2-wiring.test.ts:184` |
| `WP2-wiring.test.ts:217` F02，两个 duty | `WP2-wiring.test.ts:219` |
| `WP2-wiring.test.ts:259` F03 | `WP2-wiring.test.ts:260` |
| `WP2-wiring.test.ts:281` F04 | `WP2-wiring.test.ts:283` |
| `WP2-wiring.test.ts:347` F05 | `WP2-wiring.test.ts:348` |
| `WP2-wiring.test.ts:415` F06 | `WP2-wiring.test.ts:418` |
| `WP2-wiring.test.ts:479` F06 budget | `WP2-wiring.test.ts:483` |
| `WP2-wiring.test.ts:549` F07 | `WP2-wiring.test.ts:550` |
| `WP2-wiring.test.ts:608` F08 | `WP2-wiring.test.ts:613`；两个故障源由 `:706` 调用 |
| `WP2-wiring.test.ts:715` F11 | `WP2-wiring.test.ts:719` |
| `WP2-wiring.test.ts:869` F13 | `WP2-wiring.test.ts:872` |
| `WP2-wiring.test.ts:982` F15 | `WP2-wiring.test.ts:986` |
| `WP2-wiring.test.ts:1080` F15 receipt lost | `WP2-wiring.test.ts:1083` |
| `WP2-wiring.test.ts:1138` F14 Work | `WP2-wiring.test.ts:1143` |
| `WP2-wiring.test.ts:1254` F09 | `WP2-wiring.test.ts:1255` → `openReplyWorld:79` |
| `WP2-wiring.test.ts:1314` F10 health | `WP2-wiring.test.ts:1315` → `:79` |
| `WP2-wiring.test.ts:1332` F10 Work reconcile | `WP2-wiring.test.ts:1340` |
| `WP2-wiring.test.ts:1444` F12 | `WP2-wiring.test.ts:1445` → `:79` |
| `WP2-wiring.test.ts:1477` F14 user answer | `WP2-wiring.test.ts:1480` |
| `WP2-wiring.test.ts:1595` F14 Query answer | `WP2-wiring.test.ts:1600` |
| `WP2-wiring.test.ts:1747` F10 Query recovery | `WP2-wiring.test.ts:1756` |
| `WP2-wiring.test.ts:1843` F10 Query recovery positive | `WP2-wiring.test.ts:1852` |
| `WP2-wiring.test.ts:1989` F10 Work recognition | `WP2-wiring.test.ts:1997` |
| `WP2-wiring-scenario.test.ts:75` Z02 | `WP2-wiring-scenario.test.ts:76` |

没有仅因 `WP2-platform-support.ts:465` 另建真实 claim owner 就单独判 F4；A1 允许真实 public owner。问题在它继承的前置事实和替身，已逐项列出。

### T：helper 参数、断言及双后端

| ID／分类 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| T51 必须改，A1 | `WP2-wiring.test.ts:113` 的 reply helper 接收完整 SessionMessage；调用 `:1260、:1318、:1448`。 | 只接收 messageRef/ID，内部沿公开 `messages.readMessage` 路径取 revision；已有读法 `:1975`。 |
| T52 必须改，A1 | `WP2-wiring.test.ts:744` 的 reply helper 接收完整 SessionMessage；调用 `:764、:765、:774`。 | 同样改为 ID＋label，内部公开读取。 |
| T53 必须改，F11 | `WP2-wiring.test.ts:377`：实际 bound envelope 缺失时回退到最初 prepared ref，`:384` 仍可能证明“旧输入没变”。 | 在公开 `executions.readExecution:374` 后先要求 envelope 存在，再只读实际绑定 ref；删除 fallback。 |
| T54 必须改，F11 | `WP2-wiring.test.ts:630`：只断言不存在“note_review 未接入”文字，整个 extension 被省掉也满足。 | 使用真实发卡步骤 `:418` 和 H4，在该 Work 行核对一条规格字面 row。 |
| T55 必须改，A6 | `WP2-wiring.test.ts:689`：foreign scope refusal 不在 rejects 块，零 commit/model 计数也不是公共状态不变读。 | 移到 `describe('rejects: foreign context scope')`，精确 refusal＋合法 scope 的公开 facts 前后不变。 |
| T56 必须改，A6/F11 | `WP2-wiring.test.ts:694`：不存在的 Goal 只要求“不 ready”，无关错误也能满足。 | 独立 `describe('rejects: foreign goal scope')`，使用真实另一 scope 的 Goal，只放一个错误，精确拒绝并公开验证不变。 |
| T57 必须改，F11 | `WP2-wiring.test.ts:1975`：readMessage 不 ready 时把 acceptedInputs 替成 `[]`，空数组断言仍通过。 | 先断言 ready，再检查真实 acceptedInputs；删除替代数组。 |
| T58 必须改，F8 | `WP2-wiring.test.ts:462`：从被测 queue 的 `card.source.key` 拼预期行，同一 key 错误可一起漂移。 | 从已有公开发送回执的 message ref，按规格独立构造字面 key 和行。 |
| T59 必须改，Every row | `WP2-wiring.test.ts:183` F01 仅 SQLite。 | 合规公共夹具下 memory/SQLite `.each`。 |
| T60 必须改，Every row | `WP2-wiring.test.ts:217` F02 两个 duty 都仅 SQLite。 | 两种 duty 各覆盖 memory/SQLite。 |
| T61 必须改，Every row | `WP2-wiring.test.ts:259` F03 仅 SQLite。 | 真实只读副本路径覆盖双后端。 |
| T62 必须改，Every row | `WP2-wiring.test.ts:281` F04 仅 SQLite。 | 角色失效与 replay 公共路径覆盖双后端。 |
| T63 必须改，Every row | `WP2-wiring.test.ts:347` F05 仅 SQLite。 | 公开 prepare/bind 路径覆盖双后端。 |
| T64 必须改，Every row | `WP2-wiring.test.ts:415` F06 仅 SQLite。 | 真实发卡、公开准备路径覆盖双后端。 |
| T65 必须改，Every row | `WP2-wiring.test.ts:479` F06 budget 仅 SQLite。 | 真实 continuation＋平台小预算覆盖双后端。 |
| T66 必须改，Every row | `WP2-wiring.test.ts:549` F07 仅 SQLite。 | 真实 deferred 计划和卡片路径覆盖双后端。 |
| T67 必须改，Every row | `WP2-wiring.test.ts:608` F08 的 Work、Query、拒绝和两个故障源均仅 SQLite。 | 同一公共行为矩阵覆盖双后端，保留 A2 故障包装。 |
| T68 必须改，Every row | `WP2-wiring-scenario.test.ts:75` Z02 仅 SQLite。 | 公开 Workflow 场景覆盖双后端。 |
| T69 必须改，Every row | `WP2-wiring-scenario.test.ts:164` Z01 当前没有真实重启，不能据“Host”自动豁免 memory。 | 通过 A4 的共享 backend seam 覆盖 memory Host 的同一业务行。 |
| T70 必须改，P4/规则豁免 | `state-writes.test.ts:213` 多放行 `encodeArchitectureAutoCapture`；生产 `architecture-record-codecs.ts:762` 只编码机械封套。 | 删除该 encoder allowlist 项。 |
| T71 必须改，P4/规则豁免 | `state-writes.test.ts:214` 多放行 `encodeArchitectureAutoCaptureEvent`；生产 `architecture-record-codecs.ts:765` 同样无需豁免。 | 删除该 encoder allowlist 项。 |

`state-writes.test.ts:473` 按 enclosing function 名整体放行，因此 T70/T71 会扩大绕过面；应保留对应 decoder 项。该文件其他源码字符串是 AST 检测输入，不是 owner 接受的业务事实。

`WP2-wiring.test.ts:1080` 专门验证 SQLite reopen 后恢复丢失回执，有明确 SQLite-only 理由，不列 T59–T69。

### T：F1–F12 与 Every row 总核对

| 规则 | 结果 |
|---|---|
| F1 | T01、T02、T33、T34、T37–T41、T50；逐实例见上。 |
| F2 | 未发现额外“篡改实际读回事实再交 owner”的独立实例；纯函数输入的 spread/override 不误算 F2。 |
| F3 | KNOWN4 的请求、失败、health/reconcile；另有 T33、T35、T37、T38。 |
| F4 | T03–T15、T36、T42–T49；gate 的明确 accepted 示例留 OPEN。 |
| F5 | K4-01–K4-11。 |
| F6 | K4-13 及手造失败的 health/reconcile 位点。 |
| F7 | K4-14–K4-24、K4-46–K4-53。 |
| F8 | K4-17–K4-21 的内部计数 oracle、K4-47–K4-51 的 raw 输出期望、T58；六个 SHA 的来源留 STATIC。 |
| F9 | T16–T23；有界 public observation-state polling 不计。 |
| F10 | K4-22、K4-23。 |
| F11 | T24–T26、T53、T54、T56、T57；缺少必要区分例的行为另列 T29–T32。 |
| F12 | 未发现额外删弱断言、删除 backend、skip/todo/only 或提高 timeout；KNOWN5 的真实 Host 行替换仍须恢复。 |
| Every row | 后端缺口 T28、T59–T69；必要行为和反事实区分缺口 T29–T32；公共行被违规夹具阻断的情况已在各表指出。 |

`WP2-wiring.test.ts:543` 的遗漏数量 **2→3 是正确的精确调整**：0 条 note＋1 条 message_release＋1 条 goal update＋1 条“还没有观测”＝3，符合 `.lead-ref/l8-impl.md:188`。`WP2-wiring-scenario.test.ts:64、:217` 新增公开状态有界等待，原 `:222` 的零副作用断言保留；不是弱化。

### P1：额外静默失败和取消问题

系统性修复：每个后台阶段保留成功、取消、合法 CAS 冲突、其他失败四类结果。正式采用/PASS 的原回执不变，但后台失败不能因此无声消失。没有拿到开始 revision 时，不得编造 failed 写入。

| ID | 每个实例、影响 | 唯一处置 |
|---|---|---|
| P01 必须改 | `auto-capture-driver.ts:105、:110、:111、:127`：请求写入非 committed 或 throw 都变 null；首次登记可没有记录、没有队列、没有原因，下次启动也无 pending 可恢复。 | 生产修复：保留可观测的接受失败及恢复依据；诊断接口留 OPEN，不改变原正式回执。 |
| P02 必须改 | `auto-capture-driver.ts:159、:162、:164`：开始快照读取非 ready、ready/null 或 throw 全部静默结束。 | 生产修复：报告开始快照读取失败，保留 pending；未取得 revision 时不强写 failed。 |
| P03 必须改 | `auto-capture-driver.ts:229、:233`：failAutoCapture 的返回值完全不检查，异常全吞；除合法 revision_conflict 外的写失败也被忽略。 | 生产修复：区分 CAS 冲突与失败记录未写入，保留后者原因。 |
| P04 必须改 | `auto-capture-driver.ts:258、:261、:263`：启动扫描读取失败或 throw 就跳过当前工作区，Host 正常启动而不暴露重试未完成。 | 生产修复：逐工作区报告启动扫描失败，保留后续工作区扫描和 pending。 |
| P05 必须改 | `architecture-service.ts:1223、:1243、:1245、:1257、:1266、:1271`：requestAutoCapture 只在入口检查取消；调用者在读取等待期间取消，仍可能开始 commit，或正常返回 replay。 | 生产修复：等待后、进入提交前以及纯重放返回前检查调用 signal；已开始提交的边界见 OPEN。 |
| P06 必须改 | `architecture-service.ts:1284、:1304、:1306、:1316、:1327、:1333`：failAutoCapture 同样只在入口检查取消，可在取消后开始失败写入。 | 生产修复：保留开始 revision 守卫，同时补提交前及重放返回前取消检查。 |
| P07 必须改 | `architecture-service.ts:1339、:1347`：readAutoCapture 入口后直接返回 record Promise，读取中取消仍可 ready。 | 生产修复：await 后检查 signal，再返回结果。 |
| P08 必须改 | `architecture-service.ts:1351、:1364、:1369、:1373、:1378`：observationState 读取中取消仍返回正常状态。 | 生产修复：各读取边界及最终成功返回前保留取消。 |
| P09 必须改 | `architecture-service.ts:992、:994、:996`：capture 的早期重放读取期间取消，仍返回正常 committed/replayed；该路径绕过 `:1001` 的取消检查。 | 生产修复：早期重放读取后、返回前检查取消，不把取消作为正常 capture 答复。 |

### P2：额外触发缺陷

| ID | 每个实例、影响 | 唯一处置 |
|---|---|---|
| P10 必须改 | `host.ts:910` 注册已提交，`:922` 的 addWorkspaceState 在 `:831` 已加入 maps/tools 后，`:838` 注册 Kernel store 或 `:855` reconcile 抛错，会跳过 `:933`；重试同一路径又在 `:879` 提前 ready，永久丢失本次登记触发。 | 生产修复：让“登记已提交、绑定部分完成”可恢复，并在真正完成绑定时补足一次登记触发。 |
| P11 必须改 | `host.ts:1595、:1599、:1601、:1602、:1603、:1604` 先等待其他关闭工作，`:1608` 才停止自动捕获；期间 driver `:150` 可启动关闭时已排队的 B。 | 生产修复：Host close 入口即停止队列并 abort running，随后按既有次序 drain。 |

### P3：额外 scope 键碰撞

| ID | 每个实例、影响 | 唯一处置 |
|---|---|---|
| P12 必须改 | `auto-capture-driver.ts:65` 和沿用的 `host.ts:183` 以 NUL 拼接两个未限制字符集的 ID；`(projectId="a", workspaceId="b\\u0000c")` 与 `("a\\u0000b","c")` 得到同键。`host.ts:225`、`core-routes.ts:511` 只要求非空；`host.ts:1576` 的 scope 准入、`:544` 的“已绑定”判断及 `:452、:457` 的 root/授权查找都使用这个键。 | 生产修复：统一使用无歧义的 tuple 编码作为 scope key，替换本链的拼接键，保持各 scope 独立。 |

P12 不只是“两个配置同时加入会被误报重复”：一个已配置 scope 与另一个可公开登记的同键 scope，也会让 `host.ts:544` 把未绑定者视为已绑定，随后从 `host.ts:452` 得到另一 scope 的根。`server.ts:241` 的准入调用最终仍落到 `host.ts:1576`，没有消除该歧义。

其他存储身份的静态核对如下；没有额外发现普通 clone/worktree 会使这些身份碰撞：

| 值 | scope 核对 |
|---|---|
| auto-capture 记录 | `architecture-service.ts:783、:795` 的 ref 含 project/workspace；编解码也检查完整 scope，`architecture-record-codecs.ts:616`。 |
| current pointer | `architecture-service.ts:786、:808` 含 project/workspace。 |
| observed record | `architecture-service.ts:1166` 含 project/workspace/captureId。 |
| 主观测正文 | `architecture-service.ts:1110` 包含 scoped capture；读取在 `:595、:623、:642` 核对 scope/ref/body。 |
| capture/request/failure 指纹 | `architecture-service.ts:984、:1239、:1300` 均含 project/workspace。 |
| 自动捕获 requestId | `auto-capture-driver.ts:212` 使用 project/workspace/start seq；另有指纹 scope，未发现普通工作区间共享同一命令身份。 |
| 文件图 chunk | KNOWN1；正文缺 scope 是实质例外。 |
| prepared manifest | `execution-preparation.ts:280、:311` 带 claim、Run、project/workspace 等身份，不能仅因提醒文字相同就认定其跨 scope 碰撞。 |

### P4：规则重复和残留

| ID | 每个实例、原因 | 唯一处置 |
|---|---|---|
| P13 必须改 | trigger 集合分别维护于 `architecture-service.ts:97`、`architecture-record-codecs.ts:612`，另有 `architecture-observation.ts:15` 的类型联合；同一允许值规则有多份维护点。 | 生产修复：一个共享常量及校验规则，类型从该规则派生。 |
| P14 必须改 | 失败原因 2000 字符限制分别维护于 `architecture-capture.ts:15` 和 `architecture-record-codecs.ts:614`；截断与拒绝上限可能漂移。 | 生产修复：共享一个生产限制常量；测试仍保留手写 2000/2001。 |
| P15 必须改 | `architecture-record-codecs.ts:13` 的 `ArchitectureAutoCaptureFailureV1` import 没有使用。 | 删除该 import 名称。 |
| S01 建议 | `context-assembler.ts:78` 仍称 rejection 一律传播，与 `:1043` 的非取消降级规则冲突。 | 删除失效保证文字。 |
| S02 建议 | `execution-contracts.ts:237` 同样称 rejected read 不隐藏，与现行降级规则冲突。 | 删除失效保证文字。 |
| S03 建议 | `execution-preparation.ts:31` 的依赖声明没有新 reminder reader，而默认 assembler `:136` 通过 cast 消费完整依赖。真实 Runtime 接线成立，但直接工厂声明不一致。 | 生产修复：统一工厂实际可消费的依赖声明。 |
| S04 建议 | `S8A-L8-host.ts:58` 的“增加文件拖慢扫描”注释已不适合作为测试指导；当前调用没有实际用大量文件拖时。 | 删除该过时指导注释。 |
| S05 建议 | `auto-capture-driver.ts:46、:75` 接受 human actor，但错误文字和实际 Host 接线要求 system；生产由 `host.ts:530` 传固定自动捕获 actor。 | 生产修复：收窄声明到实际 system actor 合同。 |

没有发现需要新增产品入口才能到达的 L8 生产声明。提醒 reader、状态构造器、共享 mappings、目录前缀 helper 均有实际生产调用；也没有把纯测试中的源码字符串或合理的兼容窄对象分支当作不可达生产功能删除。

### P5：公开手动接口泄露内部 watermark

| ID | 每个实例、影响 | 唯一处置 |
|---|---|---|
| P16 必须改 | `core-http-types.ts:306` 从完整 capture port 派生 HTTP DTO；`core-routes.ts:533、:656、:920` 没有拒绝或移除内部 `requestSeq`；`architecture-service.ts:956` 只检查安全非负整数，`:1022` 直接采用，`:1193` 写入 max watermark。手动请求可传超前 seq，使以后实际请求被错误显示为不 pending，失败或关闭后的启动重试也可能被抑制。 | 生产修复：把 driver 的可信开始 watermark 与公开 manual 输入隔离；HTTP DTO 和运行时解析明确拒绝公开 `requestSeq`，手动 capture 始终读当前记录。 |

其余文字、顺序和数据源未发现额外实现违约：依赖任一端过滤在 `architecture-reminders.ts:50、:64`；严格最长目录前缀在 `:80`；移动只按 deleted/added 子集唯一匹配在 `:95`；时间向下取整在 `:123`；kind/path/rest 排序在 `:164`；10 条上限、精确省略数和空态在 `:188`。对应测试缺口不能据此省略，已列 T25–T32。

`formal-comparison.ts:101` 的真实 import_undeclared producer 给 proven，因此没有把人工拼出的 unknown import 组合当成当前产品缺陷。

### 其他建议，不计必须改

| ID | 文件:行及边界 | 唯一处置 |
|---|---|---|
| S06 建议 | `create-platform.ts:1192、:1194`：初次采用 await 后从原始 ctx 取 projectId；未找到真实调用方并发修改 ctx 的路径。 | 生产修复：在 await 前固定触发 scope。 |
| S07 建议 | `create-platform.ts:1199、:1201`：修订有同类后 await ctx 读取。 | 生产修复：在 await 前固定 scope。 |
| S08 建议 | `create-platform.ts:940、:942`：PASS wrapper 有同类后 await ctx 读取。 | 生产修复：在 await 前固定 scope。 |
| S09 建议 | `auto-capture-driver.ts:245`：boundWorkspaces 抛错直接吞；真实 Host 提供的是内存绑定列表，未发现正常生产抛错来源。 | 生产修复：纳入统一后台诊断出口。 |
| S10 建议 | `create-platform.ts:918`：通知 callback 抛错全吞以保留原回执；原回执不变正确，但异常没有诊断。 | 生产修复：保留回执并记录通知故障。 |
| S11 建议 | `auto-capture-driver.ts:95`：detached Promise 的最后 rejection 被统一 settle。已知阶段故障由 P01–P04 修复后，仍宜保留未知异常诊断。 | 生产修复：最后一道 settle 同时保留诊断。 |
| S12 建议 | `auto-capture-driver.ts:229`：failure write 使用新 signal，关闭中不会随 running controller 取消；失败落盘是否属于“仍在运行的 capture”未定。 | 生产修复：按 lead 对 OPEN Q2 的裁定贯通该轮取消语义。 |

## 4. P1 TABLE

表中“取消”指 await 期间发生取消。正常结果是该阶段真实成功时的预期；报告指出的是失败、异常或取消被冒充正常结束的路径。

### driver、Host 与触发链

| 调用点 | resolve-ok | resolve-failure | throw | abort → 当前结果 → 要求 |
|---|---|---|---|---|
| `auto-capture-driver.ts:105` request write | 返回记录，后续排队 | null，无原因 | null，无原因 | 使用独立 signal；close 后保存已接受请求可留 pending；失败不得无声丢失，P01 |
| `auto-capture-driver.ts:126` writeRequest | 入 queue、pump | null 后 return | 内层吞掉；余下异常被 detach settle | `:127` 检查 closed，已关闭不入队；保留已写请求 |
| `auto-capture-driver.ts:147` runCapture | finally 清 running 并 pump | 函数无失败结果值 | finally 仍 pump，detached settle | 正确 stop 后不 pump；Host stop 太晚，P11 |
| `auto-capture-driver.ts:159` start record | 固定 seq/revision | 直接 return | 直接 return | `:167` 检查 signal；非取消失败须可见，P02 |
| `auto-capture-driver.ts:175` state | 使用 current.persistedRef | 直接 return | 直接 return | `:183` 检查 signal；其他失败按开始 revision 落盘，KNOWN2 |
| `auto-capture-driver.ts:192` catalog | ready 映射；not_found 空映射 | cancelled 不写；not_ready 返回；其他失败走 failure | 未取消时转 unavailable failure | catch 和 `:205` 检查；not_ready 保留 lead 裁定 |
| `auto-capture-driver.ts:212` capture | committed 结束 | cancelled 不写；其他进入 failure | 未取消时转 unavailable failure | catch 和 `:225` 检查；普通取消不写 failed |
| `auto-capture-driver.ts:229` failure write | 结果未检查 | 所有失败均被忽略 | 吞掉 | 新 signal 不随 running abort；非 CAS 故障须可见，P03；取消边界 Q2 |
| `auto-capture-driver.ts:258` startup state | pending 则写新 request | 跳过该工作区 | 跳过该工作区 | 独立 signal；closed guard 阻止随后接受；扫描失败须可见，P04 |
| `auto-capture-driver.ts:277` drain | 等 tracked work 结束 | allSettled 吸收失败 | 无正常外抛分支 | queue 已清、running 已 abort；错误应在阶段出口留下原因 |
| `host.ts:861` realpath | 继续 | 无状态型失败 | not_found | settings 调用没有传入独立取消 signal |
| `host.ts:862` stat | 目录则继续 | 非目录拒绝 | not_found | 同上 |
| `host.ts:881` canonicalExisting | 同根提前 ready | helper 回退比较 | helper 内处理 | 部分绑定后重试被提前返回，P10 |
| `host.ts:891` createProject | 继续注册 | unavailable | 外层 unavailable | 已提交事实不能假装回滚 |
| `host.ts:899` readProject | 使用 revision | invalid | 外层 unavailable | 无单独取消入口 |
| `host.ts:904` read registration | ready 视作已有登记 | 非 ready 尝试注册 | 外层 unavailable | 不应把恢复登记再当新登记 |
| `host.ts:910` register | 非重放置 registeredNow | unavailable | 外层 unavailable | 已提交后仍需完成绑定触发，P10 |
| `host.ts:920` registration reread | 取 workspace revision | 用 0 继续绑定 | 外层 unavailable | 这是 P10 的同一提交后接缝，应明确处理读取失败 |
| `host.ts:838` registerKernelStore | 继续绑定 | void，无失败值 | open catch；maps 已写 | 触发被跳过且重试不补，P10 |
| `host.ts:855` reconcileAddedScope | 返回后触发 | 按 reconcile 自身报告 | open catch；触发跳过 | 同 P10 |
| `host.ts:1012` settings restore | 完成绑定 | 按恢复流程拒绝 | 启动失败 | 不伪造登记；pending 交 startup retry |
| `host.ts:1041` activity ensure | 继续启动 | 原流程报告 | 启动拒绝 | 尚未到 retryPending |
| `host.ts:1058` reconcile | 后续调用 `:1064` retryPending | 原流程报告 | 启动拒绝 | retry 自身失败不得被当“没有 pending” |
| `host.ts:1563` route register | 非重放 committed 才触发 | 原样返回，无触发 | 原样失败 | 正式提交后触发应保留；closed driver 不新入队 |
| `host.ts:1595` server.close | 后续 drain | 无状态型失败 | 可阻断后续 stop | 自动队列此时仍运行，P11 |
| `host.ts:1599` backfill drain | 继续 | 无状态型失败 | catch 后继续 | 自动队列仍未 stop，P11 |
| `host.ts:1600` attention drain | 继续 | 无状态型失败 | catch 后继续 | 同 P11 |
| `host.ts:1601` inputJobs | 继续 | 无状态型失败 | 可阻断后续 stop | 同 P11 |
| `host.ts:1602` collaboration.close | 继续 | 无状态型失败 | 可阻断后续 stop | 同 P11 |
| `host.ts:1603` fanOut.close | 继续 | 无状态型失败 | 可阻断后续 stop | 同 P11 |
| `host.ts:1604` tools close | 继续 | 无状态型失败 | 可阻断后续 stop | 同 P11 |
| `host.ts:1608` autoCapture.close | stop、abort、drain | 无状态型失败 | 非预期异常外抛 | 调用过晚；应先发起 stop/abort |
| `host.ts:1609` platform.close | drain 并关闭存储 | 无状态型失败 | 外抛 | 自动工作必须已收到取消 |
| `create-platform.ts:940` finalize | 新 PASS 才通知 | 原结果，无通知 | 原异常 | 正式已提交的 PASS 不能因后续取消而被否认 |
| `create-platform.ts:1192` adopt | 新提交才通知 | 原结果，无通知 | 原异常 | 同上；scope 固定见 S06 |
| `create-platform.ts:1199` revise | 新提交才通知 | 原结果，无通知 | 原异常 | 同上；scope 固定见 S07 |

### 观测、提醒读取和 preparation

下面 shared helper 没有 CoreCallContext 的，取消责任必须由持有 ctx 的公共 owner 收口；不能因为 helper 不接 signal 就正常返回已取消结果。

| 调用点 | resolve-ok | resolve-failure | throw | abort → 当前结果 → 要求 |
|---|---|---|---|---|
| `architecture-service.ts:795` read request record | 记录或合法不存在 | 显式映射 store failure | 外抛 | helper 无 signal；调用 owner 必须检查 |
| `architecture-service.ts:808` read pointer | pointer 或合法不存在 | 显式失败 | 外抛 | 同上 |
| `architecture-service.ts:820` read observed record | 已解码记录 | 显式失败/not_found | 外抛 | 同上 |
| `architecture-service.ts:842` basis pointer | 继续 request read | 原失败 | 外抛 | basis 不检查 signal |
| `architecture-service.ts:844` basis request | 返回 basis | 原失败 | 外抛 | 公共 owner 收口 |
| `architecture-service.ts:1347` readAutoCapture 返回 Promise | ready | 原失败 | 外抛 | 取消中仍 ready，P07 |
| `architecture-service.ts:1364` observation basis | 继续 | 原失败 | 外抛 | 无读后检查，P08 |
| `architecture-service.ts:1369` current record | 填 current | 原失败 | 外抛 | 无读后检查，P08 |
| `architecture-service.ts:1373` previous record | 填 previous | 原失败 | 外抛 | 最终仍可 ready，P08 |
| `architecture-reminder-facts.ts:20` catalog | ready；not_found→null | 其余原样返回 | 传到 assembler | 取消可能被后续降级，KNOWN3 |
| `architecture-reminder-facts.ts:22` observed，无目录 | 返回 facts | 原失败 | 传到 assembler | 同 KNOWN3 |
| `architecture-reminder-facts.ts:25` observed，有目录 | 返回 facts | 原失败 | 传到 assembler | 同 KNOWN3 |
| `architecture-service.ts:1400` reminder basis | 继续 | 原失败 | 外抛 | 无取消检查，KNOWN3 |
| `architecture-service.ts:1407` latest load | 取 latest/graph | 原失败 | 外抛 | 无取消检查，KNOWN3 |
| `architecture-service.ts:1418` previous load | 取 previous | 原失败 | 外抛 | 无取消检查并返回 ready，KNOWN3 |
| `architecture-service.ts:599` access.open | 获得真实授权 handle | 映射 workspace failure | 外抛 | 依赖可返回 cancelled；若成功后才取消，外层仍须检查 |
| `architecture-service.ts:605` observed record | 解码并继续 | 显式失败 | 外抛 | 无本地取消检查 |
| `architecture-service.ts:617` body read | 校验 ref/origin/digest | not_found/unavailable | 外抛 | 无本地取消检查 |
| `architecture-service.ts:635` chunk graph | 共享 graph | 原失败 | 外抛 | 无本地取消检查 |
| `architecture-service.ts:694` 每个 chunk read | 校验并合并 | 显式失败 | 外抛 | helper 无 signal；公共读取不能因此吞取消 |
| `architecture-service.ts:652` access.release | 原结果继续 | void | 可覆盖此前结果为异常 | assembler catch 必须先识别已取消，KNOWN3 |
| `architecture-service.ts:741` file graph access | 继续 | 显式失败 | 外抛 | 依赖处理入口取消，外层保留最终取消 |
| `architecture-service.ts:746` file graph record | 继续 | 显式失败 | 外抛 | 无本地取消检查 |
| `architecture-service.ts:752` file graph chunks | 返回 graph | 原失败 | 外抛 | 外层公共 owner 负责取消 |
| `architecture-service.ts:754` file graph release | 原结果继续 | void | 覆盖原结果为异常 | 不应把取消改成普通成功 |
| `context-assembler.ts:1040` reminders | 生成行 | cancelled 传播；其他降级 | 全部降级 | ready、非取消失败、throw 三种均可吞 signal；KNOWN3 |
| `execution-preparation.ts:154` execution read | 新准备继续；已有绑定走重放 | mapRead | unavailable | 新路径 `:178` 检查；既有重放取消边界见 OPEN |
| `execution-preparation.ts:183` role facts | 继续 | mapRead | unavailable | `:199` 检查 signal |
| `execution-preparation.ts:204` config | 继续 | mapRead | unavailable | `:231` 检查 signal |
| `execution-preparation.ts:264` assemble | 构造 manifest | 原样返回 | unavailable | 无读后检查，KNOWN3 |
| `execution-preparation.ts:298` manifest put | ready prepared | capacity/unavailable | unavailable | 无最终检查，KNOWN3 |
| `execution-preparation.ts:380` load old manifest | 解码并恢复 | unavailable | unavailable | loader 不接 ctx；由重放入口定义取消边界 |

`context-assembler.ts:985、:1074、:1099、:1135` 的既有 graph、upstream、taskInputs、continuation await 也已追查：正常读取继续，明确失败按各旧合同返回或形成缺失说明；没有把这些旧链的取消语义全部扩成 L8 新功能。L8 不能再经 `:1040` 把取消降级后送入这些后续步骤。

### capture 和请求/失败写入

| 调用点 | resolve-ok | resolve-failure | throw | abort → 当前结果 → 要求 |
|---|---|---|---|---|
| `architecture-service.ts:992` lookupCommit | 命中则 restore | not_found 继续；其他明确失败 | 外抛 | 命中路径不经 `:1001`，P09 |
| `architecture-service.ts:994` early restore | committed/replayed | 明确恢复失败 | 外抛 | 可正常答复取消，P09 |
| `architecture-service.ts:767` restore eventAt | 校验原事件 | 明确失败 | 外抛 | helper 无 signal，由 capture 返回前检查 |
| `architecture-service.ts:1011` catalog | 映射；无目录空数组 | rejected 传播；其他 unavailable | 外抛 | 没有紧邻 signal 检查；后续 capture/提交边界仍须取消，不能写成普通失败原因 |
| `architecture-service.ts:1024` manual start seq | 固定记录 seq 或 0 | 原失败 | 外抛 | 无紧邻检查；提交前有 `:1186` |
| `architecture-service.ts:1029` canonical scope | 核对 pins | 原失败 | 外抛 | 无紧邻检查；后续 workspace 接收原 signal |
| `architecture-service.ts:534` canonical readMany | 解码 scope | 显式失败 | 外抛 | helper 无 signal |
| `architecture-service.ts:1040` start pointer | 固定 previous | 原失败 | 外抛 | 无紧邻检查；下游 load/capture 收原 signal |
| `architecture-service.ts:1044` previous load | 复用 persistedRef/files | 原失败 | 外抛 | driver 识别 abort；manual 不应把取消误报正常答复 |
| `architecture-service.ts:1054` explicit previous load | 复用 prior files | 原失败 | 外抛 | 同上 |
| `architecture-service.ts:1065` captureObservation | 进入 retained capture | workspace failure | 外抛 | 成功后 `:1069` 检查；失败携 cancelled 时传播 |
| `architecture-service.ts:1070` verify | 继续 | workspace failure | 外抛并 finally release | 原 signal 传递；后续仍有提交前检查 |
| `architecture-service.ts:1072` export | 继续 | workspace failure | 外抛并 release | 同上 |
| `architecture-service.ts:1077` file graph | 继续 | workspace failure | 外抛并 release | 同上 |
| `architecture-service.ts:1088` module graph | 继续；不适用时空模块图 | workspace failure | 外抛并 release | 同上 |
| `architecture-service.ts:1142` 主正文 put | 形成 persistedRef | 显式 put failure | 外抛并 release | 可能留下不可达正文；尚未发布 pointer |
| `architecture-service.ts:1152` 每个 chunk put | 累积 refs | 显式 put failure | 外抛并 release | 同上，不等于成功观测 |
| `architecture-service.ts:1163` 再 verify | 继续发布准备 | workspace failure | 外抛并 release | 原 signal 传递 |
| `architecture-service.ts:1173` 当前 pointer read | 计算 previous/max | store failure | 外抛并 release | `:1186` 在 commit 前检查 signal |
| `architecture-service.ts:1206` observation commit | committed | 显式失败 | 外抛并 release | commit 已开始后的取消边界未规定，不能声称能回滚；见 Q3 |
| `architecture-service.ts:1211` commit replay restore | committed/replayed | 明确恢复失败 | 外抛并 release | 已存在提交的取消回复边界见 Q3 |
| `architecture-service.ts:1216` release helper | 原结果继续 | helper 不改业务结果 | helper 内吞清理异常 | 使用新 signal 是为了释放临时槽位，不是吞业务取消 |
| `architecture-service.ts:454` releaseCapture | 清理完成 | best-effort 清理失败 | 吞掉，槽位由过期回收 | 这是明确的清理合同，不列新缺陷 |
| `architecture-service.ts:1243` request lookup | 命中恢复 | not_found 继续；其他明确失败 | 外抛，driver 后吞为 P01 | 无读后取消检查，P05 |
| `architecture-service.ts:1245` request early restore | committed/replayed | 原失败 | 外抛 | P05 |
| `architecture-service.ts:1257` request current read | 构造下一 seq | 原失败 | 外抛 | 取消后仍可开始 commit，P05 |
| `architecture-service.ts:1266` request commit | committed；重放再恢复 | revision_conflict 有界重试；其他失败 | 外抛 | 进入提交前必须检查；提交后边界 Q3 |
| `architecture-service.ts:1271` request replay restore | committed/replayed | 原失败 | 外抛 | P05；已提交事实不回滚 |
| `architecture-service.ts:1304` failure lookup | 命中恢复 | not_found 继续；其他明确失败 | 外抛，driver 后吞为 P03 | 无读后取消检查，P06 |
| `architecture-service.ts:1306` failure early restore | committed/replayed | 原失败 | 外抛 | P06 |
| `architecture-service.ts:1316` start-revision read | 匹配才构造失败记录 | 不存在/冲突明确拒绝 | 外抛 | 取消后仍可开始 commit，P06 |
| `architecture-service.ts:1327` failure commit | committed | 明确失败 | 外抛 | 提交前取消必须保留；已开始提交边界 Q3 |
| `architecture-service.ts:1333` failure replay restore | committed/replayed | 原失败 | 外抛 | P06 |
| `architecture-service.ts:887` auto eventAt | 校验 scope/身份后恢复 | 明确失败 | 外抛 | helper 无 signal，由 request/failure owner 收口 |

### P2 触发矩阵补表

| 操作 | 新成功 | 重放 | 启动恢复 | Host 关闭 |
|---|---|---|---|---|
| settings 登记 | `host.ts:918、:933`，非重放且完成绑定后一次；P10 接缝会丢 | 已存在或 replay 不触发 | `host.ts:904` 已有登记不冒充新登记 | driver `:118` 拒绝新接受；Host 停止时点有 P11 |
| core 登记 | `host.ts:1563` 后从 committed ref 触发共享步骤 `:1566` | 不触发 | 预绑定根由 `:544` 判断；该键有 P12 | 同上 |
| 初次采用 | `create-platform.ts:1192` 后通知；driver `:245` 枚举同项目 bound scopes | 不触发 | 不重放采用事件 | closed guard 不接受 |
| 修订采用 | `create-platform.ts:1199` 同上 | 不触发 | 同上 | 同上 |
| 直接 PASS finalize | `create-platform.ts:940` 的唯一 rawEvidence wrapper | 不触发 | 不重新 finalize | 正式回执保留，后台阶段错误须可见 |
| Workflow PASS finalize | `workflow.ts:1903` 调同一 rawEvidence，无第二套通知 | 不触发 | 同上 | 同上 |
| 非 PASS／拒绝／throw | `create-platform.ts:941` 条件不满足，无触发 | 不适用 | 不适用 | 不适用 |
| 已绑定 pending | `host.ts:1064` → driver `:258` → 新 seq/startup_retry | 不复用旧 capture identity | 读取失败会跳过，P04 | 已接受请求留 pending |
| 未绑定 pending | 不枚举 | 不适用 | 保持原 pending | 不适用 |
| prepare | `context-assembler.ts:1040` 只读提醒 | 原 manifest 按既有重放 | 不触发 capture | 取消链见 KNOWN3 |

## 5. ROW TABLE（P6）

“会失败”表示按当前断言和控制流，删掉对应生产规则会破坏该行；不是已运行结果。夹具违规会妨碍该行作为合规验收证据，表中单独注明。

A-03 的四条完整字面量以施工书 `.lead-ref/l8-impl.md:138` 的修正为准：

1. `声明的依赖没有 import：A→B，src/a/core（3 小时前的观测）`
2. `import 没有声明的依赖：src/b/extra.ts → src/a/core/util.ts（3 小时前的观测）`
3. `新文件没归组：src/a/loose.ts（3 小时前的观测）`
4. `可能移动：src/old.ts → src/new.ts（3 小时前的观测）`

| 规格／施工书行为 | 当前测试 file:line | 后端与手算字面量 | 删除所守规则的静态判断 |
|---|---|---|---|
| 登记，两条入口；impl `:172` | `S8A-L8-auto-capture-host.test.ts:24、:59` | 双后端；seq1、workspace_registered、requested、failure=null、pending=false | 漏通知会失败 |
| 登记重放不触发 | `S8A-L8-auto-capture-host.test.ts:38` | 双后端；replayed=true、seq1、current 不变 | T20 的 sleep 需换确定性边界 |
| 初次采用 | `S8A-L8-adoption-capture.test.ts:205` | 双后端；seq2、catalog_adopted、previous=旧 current | 漏通知会失败；T03/T04 夹具不合规 |
| 修订采用 | `S8A-L8-adoption-capture.test.ts:221` | 双后端；seq3、catalog_revised | 漏通知会失败；未另断言第三次 previous=第二次 current |
| Workflow PASS | `S8A-L8-pass-capture.test.ts:351` | 双后端；PASS、applicable、非重放、seq2/check_passed | 漏通知会失败；前置受 T01/T07/T08/T13 影响 |
| public finalize PASS | `S8A-L8-pass-capture.test.ts:373` | 双后端；同上，真实 registered check/Kernel | 漏通知会失败 |
| finalize replay | `S8A-L8-pass-capture.test.ts:398` | 双后端；seq/current/previous 不变 | T22 的时序证据需修复 |
| adoption replay | `S8A-L8-adoption-capture.test.ts:237` | 双后端；events=2、seq3/current 不变 | 同步通知断言有效；删除 T21 的 sleep |
| 全 Host 串行 | `S8A-L8-auto-capture-gate.test.ts:164` | 双后端；A/B 各 seq1 | **不能证明**；T24 可在串行检查删除后通过 |
| waiting trigger 合并 | `S8A-L8-auto-capture-gate.test.ts:191` | 双后端；waiting seq1，idle 后新触发 seq2 | 受 K4-01/02 和 T16 影响 |
| 接受时、排队前写 request | `S8A-L8-auto-capture-gate.test.ts:254` | 双后端；B seq1/requested/pending=true/current=null | driver 层可观察；真实 Host 覆盖 K5-01 缺失 |
| 失败按开始 revision 守卫 | `S8A-L8-observation-state.test.ts:383` | 双后端；新 seq2 保持 requested/failure=null | 守卫删除会改变结果；触发和库断言须按 K4 修复 |
| 取消不写 failed | `S8A-L8-auto-capture-gate.test.ts:232` | 双后端；A/B requested/pending=true/current=null | 仅 driver close；真实 Host 接线缺失 |
| manual 早开始晚提交，max 不倒退 | `S8A-L8-observation-state.test.ts:520` | 双后端；manual 为 current、previous 为自动 current、seq1/pending=false | 删除 max 会使公开 pending 断言失败；删除 K4-16 冗余库断言 |
| running 时新请求，第一轮成功后仍 pending | 无；`S8A-L8-observation-state.test.ts:383` 是第一轮失败 | 双后端应测 seq2/pending=true→false | **缺，T29** |
| 同一运行期间仅再排一轮 | `S8A-L8-observation-state.test.ts:383`、gate 合并行 | 双后端；两轮请求/完成 | 有失败场景，成功场景仍缺 T29 |
| 失败原因截断 | `S8A-L8-auto-capture-state.test.ts:43、:68` | 纯函数；2500→2000、2000 不变 | 删除截断会失败 |
| codec 上限 | `S8A-L8-auto-capture-state.test.ts:79、:102、:114` | 纯函数；2000 接受、2001 拒绝，reason 指明 2000 | 删除限制会失败 |
| requestedAt 保持原值 | `S8A-L8-auto-capture-state.test.ts:58` | 纯函数；原 requestedAt 不变 | 改写时间会失败；重复服务行 K4-12/13 删除 |
| 失败 event 用真实写入时间 | `architecture-service.ts:1325` 静态实现 | 当前没有适当公开 event 读验收行 | lead 已接受静态核对；不得补 raw event oracle |
| request identity 使用开始 seq | `S8A-L8-observation-state.test.ts:285`、`S8A-L8-adoption-capture.test.ts:174` | 双后端；任务书 requestId 模板 | 身份构造错误会影响引用断言；第二触发须修 K4-03 |
| current/previous 为提交替换关系 | `S8A-L8-capture-mappings.test.ts:193`、`S8A-L8-observation-state.test.ts:285` | 双后端；current/previous 等于前后公开 capture ref | 删除 previous 更新会失败 |
| current.persistedRef/previousPersistedRef 可再公开读 | `S8A-L8-capture-mappings.test.ts:193` | 双后端；引用关系及公开查询 | 删除 persistedRef 会失败 |
| 启动重试失败的 pending | `S8A-L8-auto-capture-host.test.ts:119`、`S8A-L8-host-restart.test.ts:65` | SQLite-only，真实重启；startup_retry、seq2/seq3、pending=false | 删除 startup retry 会失败 |
| 已满足的请求重启不抓 | `S8A-L8-host-restart.test.ts:31` | SQLite-only；seq1/current 不变 | 公开状态可观察；未运行确认 |
| 未绑定 pending 不重试 | `S8A-L8-auto-capture-gate.test.ts:310` | 当前双后端；B seq1/current=null、A seq2 | 仅手传 `[A]`，没有证明 Host 枚举；T19 |
| 下一个真实触发重试 | `S8A-L8-auto-capture-host.test.ts:83` | 双后端；真实移根失败，真实采用后 seq2/pending=false | 漏触发会失败 |
| 同类服务失败重试 | `S8A-L8-observation-state.test.ts:343` | 双后端；failed/pending→完成 | K4-04/05 伪触发需修 |
| 有目录时共享 mappings | `S8A-L8-capture-mappings.test.ts:109` | 双后端；module A 的手算映射 | 映射错误会失败；Host 替身 T05/T06 需修 |
| 无目录只文件层 | `S8A-L8-capture-mappings.test.ts:163`、adoption `:180` | 双后端；modules=[]，文件 notes.md/src/a.ts | 错误要求目录会失败 |
| 首图后来与目录比较 | `S8A-L8-adoption-capture.test.ts:247` | 双后端；唯一 ungrouped=notes.md | 错用空模块层替代正式比较会失败 |
| omitted mappings 的重放稳定 | `S8A-L8-capture-mappings.test.ts:247` | 双后端；采用后重放原 capture，current=first、previous=null | 若重放重新派生输入会失败 |
| A-03 四类文本和时刻 | `S8A-L8-reminders-public.test.ts:329`；pure `S8A-L8-reminders.test.ts:128` | public 双后端；上列四条完整字面量，clock=observedAt+3h05m | 文本/类目错误会失败；public 正文 oracle K4-24 需修 |
| dependency 任一端是任务模块 | `S8A-L8-reminders.test.ts:128、:208`；public `:329` | A→B missing、B→A undeclared、B→A missing 手算例 | 只筛 source 端会失去 B→A 行 |
| 未归组严格最长目录前缀 | `S8A-L8-reminders.test.ts:99、:104、:109、:119` | 纯函数；2 对 1、tie 1 不归属、至少一级 | 删除严格比较或最小一级会失败 |
| module 多 path 取最佳分数 | `S8A-L8-reminders.test.ts:119` | 纯函数；按最佳目录 path 归属 | 使用非最佳 path 会改变结果 |
| move 不按任务过滤、不排除其他类 | `S8A-L8-reminders.test.ts:128、:175`；public `:329` | old→new，移动位于任务模块之外仍显示 | 错误任务过滤会失败 |
| 无 previous 不造 move | `S8A-L8-reminders.test.ts:169` 及 public 空段行 | 纯＋public 双后端；无 move | 当前数据可观察空行；未运行 |
| deleted/added 各自唯一 | `S8A-L8-reminders.test.ts:181` | 当前 2/2 | **被另一条件遮蔽，T26** |
| 与 full-list 唯一性不同 | 没有对应独立行 | 应为 1 deleted/1 added/1 unchanged 同 digest→一个 move | **缺，T31** |
| 无目录仅 move | `S8A-L8-reminders.test.ts:175` | 当前 catalog/task 同时 null | **不能单独证明，T25** |
| 无 task module 仅 move | `S8A-L8-reminders.test.ts:175` | 同上 | **不能单独证明，T25** |
| kind/path 顺序 | `S8A-L8-reminders.test.ts:128、:221`；public `:357` | 四类顺序；`src/a` 在 `src/a/inner` 前 | 已有字面断言；不可达路径例须 T27 |
| 相同 kind/path 的 rest 顺序 | 无独立行 | 应给乱序输入和完整输出 | **缺，T32** |
| unknown 文本 | `S8A-L8-reminders.test.ts:137`；public `S8A-L8-reminders-public.test.ts:408` | 行末 `，不确定` | 删除 suffix 会失败 |
| 时间取整 | `S8A-L8-reminders.test.ts:195`；public `:329` | 59秒、59分、23小时、3天；3h05m→3小时 | 已测取整部分；精确阈值缺 T30 |
| 12 条→10＋省略2 | `S8A-L8-reminders.test.ts:146`；public `S8A-L8-reminders-public.test.ts:383` | 10 条事实＋`另有 2 条架构提醒没列出` | 删除 cap 会失败 |
| 无观测 | `S8A-L8-reminders.test.ts:161`；public `:428` | `还没有观测` 恰一次 | 删除无观测行会失败 |
| 成功观测无提醒 | `S8A-L8-reminders.test.ts:169`；public `:446` | 不含架构行，也不含“还没有观测” | 错误兜底会失败 |
| 全局预算和原省略机制保留 | `WP2-wiring.test.ts:479、:543` | 当前 SQLite；精确遗漏3 | 有字面值；T65 缺 memory，公共夹具仍需修 |
| 每次 prepare 各观测最多读一次 | `S8A-L8-observation-state.test.ts:564、:598、:621` | 当前是内部 reader 的 `6+chunks` / `8+两份chunks` | **未证明 prepare，且期望来自库；K4-17–23** |
| 失败后仍用旧图、旧时刻 | `S8A-L8-reminders-public.test.ts:512` | 双后端；重试前仍上列四条“3 小时前” | 正文和伪触发须 K4-10/11/24 |
| close 时排队保持 pending，重启处理 | `S8A-L8-auto-capture-gate.test.ts:232、:285` | 当前只 driver | **真实 Host 缺，KNOWN5；生产还有 P11** |
| 手动 capture 路由保留 | `S8A-L8-auto-capture-host.test.ts:154` | 双后端；committed、新 capture，auto seq1/pending=false | 删除路由/写入会失败；未覆盖非法公开 watermark，P16 |
| 非取消提醒失败降级一次 | `S8A-L8-reminders-public.test.ts:465、:481` | 双后端；`架构提醒不可用` 恰一次，prepare ready | 删除降级会失败 |
| 提醒读取取消并 throw | 无；`:497` 仅返回 cancelled | 应 cancelled、无 prepared 成功 | **KNOWN3** |
| start observation read 失败 | 无；`S8A-L8-observation-state.test.ts:451` 是 catalog | 应 guarded failed；取消不写 | **KNOWN2** |
| 同内容两工作区各再触发、各 prepare | 无；gate `:33` 回避同内容 | 双后端，两个 scope 独立成功 | **KNOWN1** |

旧 R3d/R3d–R3g、R5a、R6-host、A2 在本次没有运行；它们不在 33 文件范围内，不能由这份静态报告宣称回归通过。调用链追查和现有测试定位不等于执行验收。

## 6. STATIC claims

| 静态主张／未运行验证项 | 依赖的准确公开调用序列 |
|---|---|
| 同内容 workspace 的后续 capture/prepare 会受 chunk origin 冲突阻断；未实际创建 clone/worktree 验证。 | H2 登记 A/B → 各手动或自动 capture → H3 再次采用/修订触发 → `architecture-service.ts:1044` 读前图 → H4 prepare → `:1407` 读 latest；冲突点 `:698`，首写复用 `body-store.ts:39`。 |
| Host close 时 B 可能在 stop 前启动；没有实跑调度。 | H2 启动 Host → H5 门住 A → 真实触发 B 并公开确认 pending → 调 `LocalWorkbenchHost.close()` → 在 `host.ts:1595` 等待期间释放 A → driver `:150` 可 pump B。 |
| 部分绑定后重试可能永久漏登记触发；未注入真实 Kernel 注册故障运行。 | settings open → `host.ts:910` committed → `:831` 加入绑定 → A2 在 `:838` 的真实依赖失败 → open 返回 unavailable → 再次同路径 open → `:881` ready，未经过 `:933`。 |
| 公共 manual 可推进超前 watermark；未实际发送 HTTP。 | H2 登记完成 → POST `architecture/capture`，input 增加安全整数 requestSeq → `core-routes.ts:920` → `architecture-service.ts:1022、:1193` → 下一真实触发失败或关闭 → 公开 observation-state / restart 观察错误 pending。 |
| NUL scope 键存在真实准入别名；未实际启动这种 ID 配置。 | Host 配置 scope A=`("a","b\\u0000c")` → 带 Host token 的公开请求使用 B=`("a\\u0000b","c")` → `server.ts:241` / `host.ts:1576` 同键通过 → 公开 createProject/registerWorkspace → `host.ts:1566、:544` 触发 B → `:452` 使用 A 的根。 |
| 新读 owner 在 await 中取消仍可能 ready；未运行故障门。 | 公开 `observationState` / `readAutoCapture` → A3 门住真实 records read → abort 原 ctx.signal → 放行真实结果 → `architecture-service.ts:1347、:1378` 正常返回。 |
| request/failure owner 可在取消后开始写；未运行取消门。 | 公开 `requestAutoCapture` 或 `failAutoCapture` → A3 门住真实前置 read → abort → 放行 → `architecture-service.ts:1266` 或 `:1327` 开始 commit。 |
| 提醒读取取消可保存 prepared material；未运行 Runtime。 | H1 真实 Plan/Session/claim → H4 prepare → A2/A3 在真实 reminder read 中取消并 throw → `context-assembler.ts:1043` 降级 → `execution-preparation.ts:298` put → `:322` ready。 |
| T24、T25、T26 等删除检查后仍可能通过的判断来自静态控制流。 | 当前 gate 顺序 `S8A-L8-auto-capture-gate.test.ts:172`；OR 双空输入 `S8A-L8-reminders.test.ts:175`；双侧重复 digest `:181`；没有修改生产检查或运行变异测试。 |
| 六个 SHA 消息 ID 的独立期望来源未验证。 | `WP2-wiring.test.ts:798` 至六个字面量所在段 → F11 的真实消息排序路径；文件注释说 handwritten，但未提供独立复算过程，不能仅凭外形判 F8。 |
| 历史 green 不是本次验证结果。 | `.lead-ref/l8-rework-2.md:55` 记录 lead 的 419 文件、3904 passed、5 skipped；本次未重跑，也未把它作为消除本报告缺陷的证据。 |

## 7. OPEN QUESTIONS

这里只列书和规则尚未决定的边界；不代 lead 选择。

| 问题 | 最小选项 |
|---|---|
| Q1：请求尚未成功持久化，或失败记录本身写不进去时，后台错误放在哪里？`auto-capture-driver.ts:105、:229、:258` 当前无诊断出口，且正式业务回执必须保持不变。 | ① 接现有 Host 诊断/状态通道；② 增加一个明确的后台失败报告接口。不能继续静默。 |
| Q2：capture 已返回失败，但 failed 记录仍在写入时，Host close 是否取消这次失败落盘？`auto-capture-driver.ts:229` 当前使用新 signal。 | ① 整轮直到失败落盘结束都属 running，随 close 取消；② 失败落盘视为必须完成的收尾。 |
| Q3：records.commit 已经开始后才取消，调用方应得到何种结果？`architecture-service.ts:1206、:1266、:1327` 的提交接口不接 signal。 | ① 已确认提交则返回已提交事实；② 返回显式“取消但提交结果需恢复确认”的状态。不能假称回滚；提交前已取消的 P05/P06 不依赖这项裁定。 |
| Q4：A3 的 accepted gate 示例是否也豁免它底下自造的 root/auth？`S8A-L8-auto-capture-gate.test.ts:48、:87、:97` 与规则 F4 有解释边界。 | ① 明确该 accepted 例的豁免范围；② 保留门控，底层改包 H2 真实绑定。 |
| Q5：提醒的 observation/catalog 来源是否要进入 prepared manifest 的 provenance pins？`context-assembler.ts:1194` 只合并原 graph/note sources，提醒正文已固定，但任务书未规定新增 source pin。 | ① 固定正文即满足本片；② 明确要求追加 reminder 来源 pins。 |
| Q6：六个 SHA 期望的冻结依据是什么？`WP2-wiring.test.ts:798` 的字面量没有独立推导证据。 | ① 补规格或独立计算依据；② 按公开输入和明确排序规则重新冻结可复算例子。 |

同内容 chunk 的新 scope 字节会改变小 chunk 夹具的分块数量；K4 的公开 prepare 计数应在新格式确定后独立重算，不能机械保留旧 reader 的 12/21，也不能从运行输出反抄期望。

## 8. SEARCH LOG

以下都是读取和检索，没有执行测试、构建或写文件。

| 检查 | 可复跑的方法 |
|---|---|
| 输入和范围 | 读取 `.lead-ref/l8-files.txt`、`l8-all-stat.txt`、`l8-all.diff`、规则表、施工书、两份返工书、DSH 回报、两份旧 review、断言 ledger。 |
| 仓库入口 | 读取根 README、STATUS 当前状态与相关下一步、HANDOFF 顶部决定 1–79、设计 README；发现并读取 `docs/AGENTS.md`。 |
| scope 文件完整性 | 对 `l8-files.txt` 每项使用 `@(Get-Content -Encoding UTF8 -LiteralPath $path).Count` 取得物理行数；编号全文读取；长文件按相接行段读取，截断处重新读取。 |
| diff 覆盖 | `Select-String -Path .lead-ref/l8-all.diff -Pattern '^diff --git','^@@','new file mode','deleted file mode'`；逐一对应 33 个文件。 |
| 测试声明和削弱 | 对范围测试检索 `\.skip\b|\.todo\b|\.only\b|it\(|it\.each|test\(|describe`，并核对 diff 中删除断言、backend、timeout 变化。 |
| 计时与伪触发 | 检索 `setImmediate|setTimeout|sleep\(|delay\(|workspaceRegistered\(|projectChanged\(|retryPending\(`；逐条区分公开有界轮询与内部计时。 |
| 手写状态和读库 | 检索 `requestAutoCapture\(|failAutoCapture\(|recordSessionHealth|recordHealth|reconcileRun|reconcileQuery|recordSessionCreated|commitRaw|readMany\(|preparedCommits|responseIdentityOf|bodies\.read`，追到实际 helper 和全部范围内调用。 |
| draft、配置和授权替身 | 检索 `PlanRevisionDraft|planDraft|resolveConfiguration|resolveQueryConfiguration|WorkspaceHostBindings|resolveRoot|authorize|guards:\s*\[\]`；与真实 Host/Runtime 装配对照。 |
| 生产触发调用者 | `Get-ChildItem src -Recurse -File -Filter '*.ts' \| Select-String`，检索 `adoptInitialArchitecture\(|reviseArchitectureCatalog\(|finalizeChecks\(|workspaceRegistered\(|retryPending\(`。 |
| reminder 调用链 | 检索 `architectureReminders|createArchitectureReminderFactsReader|createContextAssembler|createExecutionPreparation|prepareExecution|openArtifact`；追到 Runtime、Workflow、公开 prepare 和正文读取。 |
| 每个 await | 对 `auto-capture-driver.ts`、`architecture-service.ts`、facts reader、Host 改动函数、assembler 和 preparation 检索 `\bawait\b`；逐点核对成功、状态失败、throw、abort。 |
| scope 和内容地址 | 追读 `body-store.ts`、body codec、command identity、chunk serializer/decoder；检索 `scopeKey|projectId|workspaceId|requestSeq|satisfiedRequestSeq|origin`。 |
| scope 准入补查 | 读取 `host.ts:218、:450、:1562、:1576`、`core-routes.ts:508`、`server.ts:224` 的完整相关函数段，确认拼接键的准入与 root 查找链。 |
| 单源规则和残留 | 全 src 检索 `AUTO_CAPTURE_TRIGGERS|AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS|ArchitectureAutoCaptureFailureV1|moduleMappingsOf|bestModuleDirectoryPrefixLength`，核对定义、引用与调用。 |
| WP2 隐藏路径 | 读取 `WP2-platform-support.ts` 全文，追 `task-claim-fixture`、AG2b 创建/seed、harness advance/invariants/restart、移走/恢复 Kernel helper。 |
| 文字与行覆盖 | 对 slice-8 SPEC 和书检索 `L8|A-03|A-04|AE2|提醒|自动抓|取消|close|Reads`，逐条对照测试标题、字面量和生产分支。 |

本环境 `rg` 不可用，实际使用 PowerShell `Select-String` 和 `Get-ChildItem`。读取命令使用 `login:false`、`Get-Content -Encoding UTF8`，中文显示前执行 `cmd /c chcp 65001`。少数编码设置、路径定位和辅助展示命令失败后，改用固定行界限重新读取；没有用失败命令作为已读证据，也没有把输出截断的范围文件留作“clean”。

**KNOWN 之外的必须改实例数：87。**