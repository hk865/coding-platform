确认 **10 项跨目录问题**，估计可净减 `src` **1,165–1,520 行**。没有确认可整块删除的业务模块，也没有确认无生产读取方的实际索引。主要成本来自重复的机械助手，以及上层读口拿不到下层已读取的事实。

全程只读；未运行测试、构建、网络或模型调用。检查前后均为 `1e0b1383`，工作区仍只有原有的 `?? .lead-ref/`。

下文：

- `WG/` 表示 `src/core/work-graph/`。
- `规格/` 表示 `docs/refactor/design/orchestration-2026-10/slices/`。
- 行数是扣除新增共享实现及接线后的估算；不同条目不重复计算。
- 重复项采用“副本位置并列”作为证据。没有把覆盖业务行为的测试算作可删测试。

**XX-1｜类别 4：结构校验原语重复铺开**

**位置、证据：** 位置表 A 的 O、S、N、K 列，共找到 153 个三行函数：O 62 个、S 54 个、N 21 个、K 16 个。

这些分别判断非数组对象、非空字符串、安全正整数、允许字段集合，函数体相同。仓库已有对象判断入口 `src/contracts/validation/common.ts:11–13`，但各目录仍各写一份。这里只合并相同语义；不把“允许零”“必须去空白”“允许数组”等不同规则合并。

**建议：** 合并到 `src/contracts/validation/common.ts`；各业务校验保留，只替换机械原语。N、S、K 各保留一个实现。

**估计可删：** src **340–380 行**；tests **0 行**。  
**行为影响：** 无。  
**风险／把握：** 低／高；注意类型谓词及导入依赖。  
**依赖：** 无。涉及 `sessions/message-record-codecs.ts`、`views/decision-read-model.ts` 的部分标记为 **K3 会改**。

**XX-2｜类别 4：46 个事件编码器重复拼同一种信封**

**位置、证据：** 位置表 B。46 个函数共 319 行，都从事件复制 `eventId/eventType/schemaVersion/occurredAt`，再 `JSON.stringify(event)`。例如 `WG/configuration/project-bootstrap-record-codecs.ts:383–400` 与 `WG/sessions/lifecycle-record-codecs.ts:593–651`。

**建议：** 在 WorkGraph 的持久化公共层保留一个事件信封编码器。需要维持各领域参数类型的出口，可以保留一行的类型约束包装；各事件的解码、规则校验和注册不变。

**估计可删：** src **210–240 行**；tests **0 行**。  
**行为影响：** 无；保持现有 JSON 序列化及信封字段。  
**风险／把握：** 低／高。  
**依赖：** 无。`sessions/message-record-codecs.ts` **K3 会改**。

**XX-3｜类别 8：历史及审查说明混在长期代码说明中**

**位置、证据：** 跨 `tasks/`、`materials/`、`persistence/` 等目录。估计尚可压缩 **150–250 行**，属于抽样估算，不是把所有规格注释都算作冗余。

三个例子：`WG/tasks/run-activity-codecs.ts:1–10` 用十行解释规格原路径和 integration fix，长期需要的主要是实际实现位置及依赖方向；`WG/materials/run-snapshot-decoder.ts:1–8` 混入 task D、决定 40 和反复强调 “ONE”，可以只保留解码职责及依赖原因；`WG/tasks/plan-readers.ts:1–2` 仍把 R4c claim checks 称为 future，与当前已有调用不相称。

**建议：** 删除历史编号、审查过程和重复强调，保留规则、兼容原因、依赖约束。此估算排除了其他条目已经计入的删除范围。

**估计可删：** src **150–250 行**；tests **0 行**。  
**行为影响：** 无。  
**风险／把握：** 低／中，须逐段判断，不能按关键词批删。  
**依赖：** 无。状态机规则注释明确保留，依据 `docs/refactor/HANDOFF.md:125`。

**XX-4｜类别 5：整体做法问题：每个读口自己读**

已有采用计划的目标，存在以下同一次请求内的重复。

| 请求链 | 第一遍 | 重复的一遍 |
|---|---|---|
| 决定队列的目标原因 | `goal-decision-reader.ts:430–431` 调任务图；任务图读取规范任务事实，`plan-service.ts:1937` | 随后 `goal-decision-reader.ts:432` 调展示原因，内部 `:266` 调目标展示；目标展示再次读取相同事实，`plan-service.ts:2121` |
| 悬停、节点摘要 | `node-detail-reader.ts:847`、`:1107` 读取任务图 | 紧接着 `:849`、`:1109` 调 `readRunsByTask`；该函数又完整调用 `readCanonicalTaskFacts`，`:216–221` |
| 悬停中的工作线 | 节点读取已取得目标、计划、任务行，`node-detail-reader.ts:843–854` | `buildLineIndexes` 经工作线装配，`:670–673`；装配新建空缓存，`work-line-reader.ts:289–291`，随后 `:881–903` 再读目标和任务图 |
| 暂停任务的继续提示 | `requeue-service.ts:402–412` 读取目标、计划、任务事实，结果包含 Run，`:418–447` | `work-line-reader.ts:945–947` 已找到该 Run 快照，却又调 `readRunByRef`；`:1159–1164` 再读、再解码它 |
| 工作线中的 Session | 列表已读出并解码 Session，`work-line-reader.ts:1587–1616` | `:3012–3014` 只传 ref，装配时 `:354` 又读取 Session；实际读取和解码在 `:635–647` |

生产接线可达：`src/composition/create-platform.ts:746`、`:755`、`:1621–1622`；图读入口在 `src/app/core-routes.ts:423–424`、`:746–749`。上述不是仅测试路径。

**建议：** 在 `tasks/` 保留一个内部的“本次目标读取窗口”，提供只读投影所需的：

- Goal、指定 PlanRevision、规范任务事实、TaskRow、Run 索引和读取水位；
- 由相同事实生成任务图、目标展示和目标原因；
- 通过依赖注入交给节点、工作线和执行文件读取；已读 Session 可作为本次装配的初始数据。

缓存按完整目标／计划身份和读取尝试隔离。窗口重试、下一次公开分页、写操作之后都重新取得。不能把现有授权、guard 或状态迁移折叠掉。

这与规格方向一致：`规格/slice-2C-SPEC.md:175`、`:228–232` 已要求任务行与重新入队事实共享按目标读取的部分。`规格/slice-2A-SPEC.md:181–184` 又明确限制不能跨尝试、跨调用缓存。

**能省的读取：** 消除一次重复规范事实读取，至少省掉该目标的整轮 Run 索引分页、一次包含 Run／TaskLease／TaskReduction 的 `readMany`，以及随后的依据、返工和轮次读取；实际过程见 `WG/tasks/plan-readers.ts:1439–1451`、`:1498–1521`。设索引需要 P 页、Run 数为 R、任务数为 T，仅前两步就是 P 次 lookup 和一次 R＋2T 键读取。Session 初始数据复用还可省每个已列出线头的一次 keyed read；必须保留 `work-line-reader.ts:350–351` 指定的一致性重读。

**估计可删：** src **100–180 行**；tests **0 行**。这是扣除共享窗口及接线后的保守估算；主要收益是少读取，不是大量减行。未测时延。  
**行为影响：** 目标为无；必须保持权限、失败传播、预算及窗口重试语义。  
**风险／把握：** 高／中；重复读取事实把握高，改造规模需 lead 再定。  
**依赖：** 无；与 XX-9 可以独立做，节省量分别计算。

**XX-5｜类别 4：nullable canonical JSON 包装重复**

**位置、证据：** 位置表 A 的 C 列。26 处 WorkGraph 包装执行同一件事：调用 `canonicalJson`，失败返回 `null`。外部还有同形实现：

`src/app/collaboration-driver.ts:156–158`、`src/core/agent-runtime/session-operations.ts:163–169`、`src/business/workflow/decision-actions.ts:145–147`、`session-archive.ts:113–115`、`session-maintenance.ts:109–111`。

**建议：** 合并到 `src/contracts/fingerprint.ts` 的一个明确返回 `string | null` 的助手。直接抛错的 canonical key 函数，以及包含摘要、字段选取的函数不在此项范围。

**估计可删：** src **95–110 行**，只计 WorkGraph；tests **0 行**。  
**行为影响：** 无。  
**风险／把握：** 低／高。  
**依赖：** 无。`sessions/message-record-codecs.ts` **K3 会改**。

**XX-6｜类别 4：JSON 对象解析的 null 返回版本有 16 份**

**位置、证据：** 位置表 A 的 J 列，共 124 行；都捕获 `JSON.parse` 异常，只接受非数组对象，否则返回 `null`。例如 `WG/persistence/control-record-codecs.ts:141–148` 与 `WG/tasks/session-anomaly-service.ts:107–112`。

**建议：** 合并成一个 `parseJsonObjectOrNull`。带详细 `DecodeResult.reason` 的解析器保持自己的错误输出，不在本项中强行统一。

**估计可删：** src **85–100 行**；tests **0 行**。  
**行为影响：** 无。  
**风险／把握：** 低／高。  
**依赖：** 可以复用 XX-1 的对象判断；本项不重复计算对象判断函数。

**XX-7｜类别 4：相同的存储失败转换及 revision pin 解码重复**

**位置、证据：**

| 相同部分 | 副本位置 |
|---|---|
| 完整失败映射：相同错误码、unique-slot 文案、corrupt 文案及 current pins 处理 | `WG/communication/mailbox-service.ts:171–191`；`WG/sessions/session-directory.ts:144–165`；`WG/sessions/session-lifecycle.ts:139–159`；`WG/sessions/session-responsibility-service.ts:83–103` |
| 从 current 条目跳过 null revision，解析对象 ref，生成 VersionPin | 上述映射内部；另有 `WG/tasks/claim-service.ts:133–143`、`execution-entry-service.ts:153–163`、`execution-history-service.ts:107–117`；目录版本在 `WG/sessions/session-directory.ts:125–143` |

**建议：** 抽出共享的 current-to-pins 助手和上述四处完全相同的映射。保留特殊映射，例如执行入口将 unique conflict 映射为 busy、unsupported 映射为 unavailable，见 `WG/tasks/execution-entry-service.ts:164–175`。

**估计可删：** src **70–85 行**；tests **0 行**。  
**行为影响：** 无，错误码、reason、空 current 的省略规则保持原样。  
**风险／把握：** 中／高。  
**依赖：** 可用 XX-6，但本项不计算其解析助手删除量。

**XX-8｜类别 4：读到底的分页搬运循环重复**

**位置、证据：**

| 机械循环 | 副本 |
|---|---|
| 等值索引：读取、收集 records、跟随 next | `WG/views/activity-read-model.ts:206–226`；`automatic-rework-notices.ts:119–134`；`task-state-timeline.ts:135–155`；`track-read-model.ts:187–207`；`WG/tasks/goal-executed-files-reader.ts:113–128` |
| 有序索引：读取、收集或 yield records、跟随 next | `WG/views/activity-read-model.ts:173–203`；`automatic-rework-notices.ts:91–116`；`task-state-timeline.ts:113–133`；`WG/tasks/goal-executed-files-reader.ts:131–148` |

**建议：** 在 WorkGraph 持久化公共层提供等值／有序两个页迭代助手；预算扣减、解码、业务过滤留在调用方。稳定窗口重试、有界扫描、特殊缺失语义不塞进这个助手。

**估计可删：** src **60–80 行**；tests **0 行**。  
**行为影响：** 无；尤其保留活动读取预算，以及执行文件读取没有历史总量上限的差别，后者见 `WG/tasks/goal-executed-files-reader.ts:9–13`。  
**风险／把握：** 中／高。  
**依赖：** 无。

**XX-9｜类别 5：校验器解析后丢弃对象，解码器再次解析**

**位置、证据：** 下列解码路径先调用会解析 JSON 的校验器，再解析同一段正文。明确例子是 Run：第一次解析在 `WG/materials/record-readers.ts:190–196`，第二次在 `WG/materials/run-snapshot-decoder.ts:38–41`；QueryRun 对应 `record-readers.ts:284–290` 与 `WG/queries/query-record-codecs.ts:725–733`。

| 文件 | 已确认的重复解析出口 |
|---|---|
| `WG/architecture/architecture-record-codecs.ts` | `371–385` |
| `WG/architecture/catalog-record-codecs.ts` | `550–566` |
| `WG/materials/record-readers.ts` | `382–397` |
| `WG/materials/run-snapshot-decoder.ts` | `36–43` |
| `WG/persistence/plan-record-codecs.ts` | `1017–1045`、`1068–1084` |
| `WG/persistence/record-codecs.ts` | `764–822`、`845–873`、`905–909` |
| `WG/queries/query-record-codecs.ts` | `494–502`、`558–566`、`603–611`、`658–666`、`725–733` |
| `WG/sessions/message-record-codecs.ts` | `1216–1232`、`1241–1259`，**K3 会改** |
| `WG/sessions/session-record-codecs.ts` | `1055–1083`、`1089–1095`、`1107–1122` |
| `WG/tasks/completion-record-codecs.ts` | `199–207` 与 `226–230` |
| `WG/tasks/run-state-service.ts` | `145–152` |
| `WG/tasks/session-facts.ts` | `461–468` |

**建议：** 内部校验函数返回已解析、已校验的对象；存储注册所需的 validator 由薄适配器保留原协议，领域 decoder 使用该对象继续投影。旧字段默认值、隐去 wire 字段等逻辑仍保留，例如消息投影的 `WG/sessions/message-record-codecs.ts:1224–1231`。

**估计可删：** src **30–60 行**；tests **0 行**。新增适配器会抵消部分减行；主要收益是这些出口每次少一次 JSON 解析。  
**行为影响：** 无，不删校验。  
**风险／把握：** 中／高。  
**依赖：** 无；与 XX-6 的助手合并分开计数。

**XX-10｜类别 4：六个索引同时维护描述表和实际声明**

**位置、证据：**

| 模型层副本 | codec 中实际声明 |
|---|---|
| `WG/model/session-facts-contracts.ts:43–44` | `WG/sessions/session-record-codecs.ts:969–970` |
| 同文件 `45–46` | `WG/tasks/claim-record-codecs.ts:847–848` |
| 同文件 `47–48` | `WG/queries/query-record-codecs.ts:792–793` |
| 同文件 `49–50` | `WG/tasks/session-anomaly-codecs.ts:392–393` |
| 同文件 `51–52` | 同上 `394–395` |
| 同文件 `53–54` | `WG/sessions/message-record-codecs.ts:113–117`，**K3 会改** |

描述表 `SLICE1_LOOKUP_INDEXES` 的实际生产消费者 **1 处**：`src/composition/create-platform.ts:555–560`，只检查名称是否注册，未用表里的 aggregateType／paths。测试消费者 **1 个文件**：`tests/work-graph/S1-codecs-indexes.test.ts:194–208`、`:302–312`、`:351`。

**建议：** 实际声明留在各 codec；索引名称常量继续按 `规格/slice-1-SPEC.md:391` 放在模型层。把用于验证规格的完整期望表移到测试，删除生产镜像表及专门维持镜像的启动检查。保留索引注册和读取行为；规格要求的六个索引见 `规格/slice-1-SPEC.md:378–389`。

**估计可删：** src **25–35 行**；tests **不减，预计增加 10–20 行**。  
**行为影响：** 正常产品行为无；错误构建漏注册某个索引时，不再由这段专用启动检查提前抛错，应继续由注册测试覆盖。  
**风险／把握：** 中／高。  
**依赖：** 描述表、组合根检查和测试期望必须一起调整。

**位置表 A：XX-1、XX-5、XX-6 的副本**

O＝非数组对象；S＝非空字符串；N＝安全正整数；K＝允许字段集合。O/S/N/K 后面的数字是起始行，函数均连续三行。C、J 给出完整范围。以下文件均位于 `WG/`。

| 文件 | XX-1 | XX-5：C | XX-6：J |
|---|---|---|---|
| `architecture/architecture-record-codecs.ts` | O59 S62 | — | — |
| `architecture/architecture-service.ts` | O84 S92 | — | — |
| `architecture/catalog-record-codecs.ts` | O86 S89 | — | — |
| `architecture/catalog-service.ts` | O105 S108 | — | — |
| `communication/decision-application.ts` | — | 31–37 | — |
| `communication/decision-service.ts` | O49 S52 N55 | 62–68 | — |
| `communication/decision-source-facts.ts` | O81 | 89–95 | — |
| `communication/mailbox-service.ts` | O120 S123 N126 | 133–139 | — |
| `configuration/decision-settings-service.ts` | O29 S32 | 38–44 | — |
| `configuration/line-settings-service.ts` | O48 S51 | 57–63 | — |
| `configuration/project-bootstrap-record-codecs.ts` | O84 S87 N90 | — | — |
| `configuration/project-bootstrap-service.ts` | O135 S138 N144 | — | — |
| `configuration/role-memory-service.ts` | O87 S90 N93 | — | — |
| `configuration/role-record-codecs.ts` | O46 S49 N52 | 71–77 | — |
| `evidence/evidence-service.ts` | — | 148–150 | — |
| `materials/run-snapshot-decoder.ts` | O20 | — | 23–30 |
| `persistence/commit-compiler.ts` | O141 | — | — |
| `persistence/control-record-codecs.ts` | O82 S85 N132 K135 | 149–151 | 141–148 |
| `persistence/decision-record-codecs.ts` | O109 S112 K118 | — | — |
| `persistence/evidence-record-codecs.ts` | O130 S133 K153 | 150–152 | 142–149 |
| `persistence/execution-entry-codecs.ts` | O54 S57 N60 K69 | — | 653–660 |
| `persistence/execution-history-codecs.ts` | O66 S69 N72 K75 | — | 78–85 |
| `persistence/line-settings-codecs.ts` | O79 S82 K88 | — | — |
| `persistence/plan-record-codecs.ts` | O86 S90 N98 | — | — |
| `persistence/record-codecs.ts` | O83 S87 | — | — |
| `persistence/rework-codecs.ts` | O23 S26 K38 | — | — |
| `persistence/run-activity-codecs.ts` | O61 S64 N70 K73 | 84–90 | 76–83 |
| `queries/query-execution.ts` | O94 S97 | — | — |
| `queries/query-job-service.ts` | O79 S83 | — | — |
| `queries/query-record-codecs.ts` | O136 S140 N144 | — | — |
| `sessions/lifecycle-record-codecs.ts` | O125 S128 N131 K134 | — | 137–144 |
| `sessions/message-body-envelope.ts` | O52 S60 K56 | 184–190 | — |
| `sessions/message-record-codecs.ts` | O199 S202 N205 K208 | 211–217 | — |
| `sessions/session-directory.ts` | O101 S104 | 110–116 | — |
| `sessions/session-lifecycle.ts` | O90 S93 K96 | 126–132 | — |
| `sessions/session-record-codecs.ts` | O115 S118 K142 | 145–151 | 152–159 |
| `sessions/session-responsibility-service.ts` | O67 S70 | 73–79 | — |
| `sessions/session-targets.ts` | O29 | 32–38 | — |
| `state/context-input.ts` | O80 | 93–95 | — |
| `state/run-machine.ts` | O2340 S2344 | — | — |
| `tasks/claim-record-codecs.ts` | O128 S131 | — | 137–144 |
| `tasks/claim-service.ts` | O103 S106 N112 | — | — |
| `tasks/completion-record-codecs.ts` | O77 S80 N83 K100 | 97–99 | 89–96 |
| `tasks/completion.ts` | N111 | 104–106 | — |
| `tasks/context-input-service.ts` | S156 | — | — |
| `tasks/control-service.ts` | N399 | 189–191 | — |
| `tasks/execution-entry-service.ts` | O117 S120 N123 | 144–146 | 147–152 |
| `tasks/execution-history-service.ts` | O76 S79 N82 | — | — |
| `tasks/initial-plan.ts` | O42 S45 | — | — |
| `tasks/model-request-codecs.ts` | O51 S54 N57 K63 | 77–79 | 69–76 |
| `tasks/plan-readers.ts` | O113 S116 | — | 128–135 |
| `tasks/plan-service.ts` | O252 S293 | — | — |
| `tasks/plan-validation.ts` | O18 | — | — |
| `tasks/plan-write-admission.ts` | O94 S97 | — | — |
| `tasks/request-facts-reader.ts` | O22 S25 | — | — |
| `tasks/requeue-service.ts` | O152 S155 | — | — |
| `tasks/run-activity-service.ts` | O83 S86 | — | — |
| `tasks/run-state-service.ts` | O104 S107 | 123–125 | 126–133 |
| `tasks/session-anomaly-codecs.ts` | O42 S45 K51 | 62–68 | 54–61 |
| `tasks/session-anomaly-service.ts` | O91 S94 | — | 107–112 |
| `tasks/session-facts.ts` | O52 S55 | — | — |
| `tasks/session-provenance-facts.ts` | O60 S63 | — | — |
| `tasks/task-service.ts` | O304 S300 | — | — |
| `views/context-extensions.ts` | O49 | — | — |
| `views/decision-read-model.ts` | O1299 | — | — |
| `views/graph-context-reader.ts` | O93 S96 | — | — |
| `views/notice-display-token.ts` | O18 | — | — |

跨 WorkGraph 的同形原语也检索过，以下只作副本证据，不计入本报告的删除量：

| 文件前缀 | 文件及起始行，符号同上 |
|---|---|
| `src/contracts/` | `validation/common.ts:11` O；`continuation-brief.ts:631` O、`:643` S、`:1124` K；`query-job.ts:190` O |
| `src/app/` | `collaboration-driver.ts:150` O、`:153` S |
| `src/core/agent-runtime/` | `check-execution.ts:268` S；`continuation-brief-assembly.ts:105` O；`execution-control.ts:123` O、`:126` S；`execution-driver.ts:88` O、`:91` S；`execution-observation.ts:93` O、`:96` S；`execution-preparation.ts:64` O、`:67` S |
| 同上 | `graph-execution-history.ts:75` O、`:78` S、`:81` N；`kernel-turn-facts.ts:19` O；`observation-recovery.ts:56` S；`query-execution.ts:52` O、`:55` S；`query-observation.ts:48` O、`:51` S；`query-preparation.ts:148` O、`:151` S；`run-reconcile.ts:79` O |
| `src/business/workflow/` | `activity-backfill.ts:66` O、`:69` S；`consultation.ts:35` O、`:38` S；`decision-actions.ts:90` O、`:93` S；`session-archive.ts:99` O、`:102` S；`session-maintenance.ts:100` O、`:103` S；`workflow.ts:79` O、`:82` S |

另有同形的箭头对象谓词：`src/app/core-routes.ts:454`、`host-settings.ts:296`、`main.ts:56`、`runtime-configuration.ts:203`、`src/core/agent-runtime/source-capture-access.ts:65–66`。同样不计入删除量。

**位置表 B：XX-2 的全部 46 个编码器**

以下文件均位于 `WG/`。

| 文件 | 范围 |
|---|---|
| `architecture/architecture-record-codecs.ts` | 367–369 |
| `architecture/catalog-record-codecs.ts` | 542–544、546–548 |
| `configuration/project-bootstrap-record-codecs.ts` | 383–391、392–400、401–411、412–422 |
| `configuration/role-record-codecs.ts` | 459–462、463–466 |
| `persistence/control-record-codecs.ts` | 440–443、498–501 |
| `persistence/decision-record-codecs.ts` | 53–61、77–87 |
| `persistence/evidence-record-codecs.ts` | 498–501 |
| `persistence/execution-entry-codecs.ts` | 716–719、737–740、768–771、783–786、802–805 |
| `persistence/execution-history-codecs.ts` | 130–140 |
| `persistence/line-settings-codecs.ts` | 49–57 |
| `persistence/plan-record-codecs.ts` | 1110–1113、1115–1118 |
| `persistence/record-codecs.ts` | 754–762、895–903 |
| `persistence/run-activity-codecs.ts` | 431–439、458–466 |
| `queries/query-record-codecs.ts` | 547–555、615–623、669–677 |
| `sessions/lifecycle-record-codecs.ts` | 593–601、603–611、613–621、623–631、633–641、643–651 |
| `sessions/message-record-codecs.ts` | 1170–1178、1202–1210 |
| `sessions/session-record-codecs.ts` | 1031–1039、1041–1049 |
| `tasks/claim-record-codecs.ts` | 346–349、757–760、780–783 |
| `tasks/completion-record-codecs.ts` | 233–236 |
| `tasks/model-request-codecs.ts` | 193–196 |
| `tasks/session-anomaly-codecs.ts` | 325–333 |

**按类别汇总**

| 类别 | 条目 | src 净减行数 | tests 净减行数 |
|---|---|---:|---:|
| 1 无必要模块 | 未确认 | 0 | 0 |
| 2 死代码 | 未确认跨目录项 | 0 | 0 |
| 3 被替代的旧路径 | 未确认独立项 | 0 | 0 |
| 4 重复实现／声明 | XX-1、2、5、6、7、8、10 | 885–1,030 | −20～−10 |
| 5 同次调用重复工作 | XX-4、9 | 130–240 | 0 |
| 6 转发层 | 未确认值得单列的项 | 0 | 0 |
| 7 仅防数据库篡改 | 未确认跨目录且不受规格保护的项 | 0 | 0 |
| 8 注释 | XX-3 | 150–250 | 0 |
| **合计** | **10 项** | **1,165–1,520** | **增加约 10–20 行** |

没有超过上限后省略的已确认项。

**留给后面的片**

| 保留项及代码位置 | 后续用途／规格依据 |
|---|---|
| `WG/tasks/plan-readers.ts:1894–1980` 的终止原因及时间 | 4C 当前理解更新提醒；`规格/slice-4-SPEC.md:154`、`:216–219`；具体复用依据 `.lead-ref/updatedue-facts.md:5`、`:12` |
| `WG/tasks/plan-readers.ts:346–363`、`WG/views/notice-position.ts:43–59` | 保留游标／通知位置语义及入口；用户指定的 4C 复用项，`.lead-ref/updatedue-facts.md:3` |
| TaskRequeue 编解码、按 since 索引；`WG/tasks/claim-record-codecs.ts:58–73`、`:383–388`；`plan-readers.ts:89`、`:310` | 4C 返工触发；`规格/slice-4-SPEC.md:154`、`:216–219`；`.lead-ref/updatedue-facts.md:6` |
| `WG/persistence/plan-record-codecs.ts:1155` 起的计划版本索引 | 4C 采用计划触发；`.lead-ref/updatedue-facts.md:7`、`:12` |
| Session archivedAt 及任务链接索引：`WG/sessions/session-record-codecs.ts:757–758`、`:965–966` | 4C 归档触发；`.lead-ref/updatedue-facts.md:8`、`:12` |
| `WG/views/graph-context-reader.ts:725–797` 及图邻居读取能力 | 4C 图查找继续依赖；`规格/slice-4-SPEC.md:56–57`。XX-1 只合并其机械谓词，不撤读口 |
| 初始化落实证明分支：`WG/communication/decision-application.ts:71–74` | 6C 补齐证明及旧卡关闭，`规格/slice-6-SPEC.md:164`、`:304`、`:368`；不能因现在返回 unsupported 就删 |
| 悬停和节点详情读口：`WG/views/node-detail-reader.ts:843–900`、`:1102` 起 | E3 界面仍需这些后台能力；`docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md:3–4`。XX-4 共享内部事实，不删除产品读口 |

**建议先做的五项**

1. **XX-1：结构原语。** 已有公共入口，规则相同，减行最多，风险低。
2. **XX-2：事件信封。** 机械重复清楚，可保持各领域类型出口，验证范围容易限定。
3. **XX-6：JSON 对象解析。** 16 份相同失败语义，适合一次收口。
4. **XX-9：重复解析。** 无需改变存储协议，就能让每次解码少做一次实际工作。
5. **XX-4：共享读取窗口。** 读取收益最大，也最需要先冻结边界；建议先做“目标原因＝任务图＋展示”这一条链，再接节点和工作线，避免一次扩大并发、分页和预算语义的变更范围。