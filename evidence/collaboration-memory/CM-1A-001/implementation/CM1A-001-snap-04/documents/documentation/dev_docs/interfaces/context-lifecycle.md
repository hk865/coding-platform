# Context 生命周期与执行记忆 Interface

```yaml
status: draft
updated: 2026-09-12
first_consumer: P1-16
```

依据：[PRODUCT](../../PRODUCT.md)、[ARCHITECTURE](../../ARCHITECTURE.md)。本文件是生命周期与执行记忆行为的单一正文；方向已由用户确认并授权同步文档，wire schema 和实现尚未冻结。P1-16 首先落实同工作连续性，P1-17 扩展已完成工作向新任务的继承。P1-03／06 原版本与历史 Evidence 保留，扩展不得追溯宣称旧验收已覆盖新行为。

## 工作、Context 与运行

WorkContext 围绕明确工作范围持续更新，可以包含多次模型调用和工具反馈。一次响应、工具完成或暂时等待不自动结束工作。ContextBundle 是为一次初始化或接续编译的有界材料，其大小上限不是完整内核会话的生命周期规则。

工作关联包含 Project／Workspace、任务或协调／查询工作、角色绑定、Agent／Run 及当前适用版本。工作责任可跨 Run；这些关联不要求新增 Work Agent 或独立 MemoryStore。跨 Development Ticket 默认从新 Context 开始，并按需继承来源记录；产品 Runtime Task 的相关返工即使生成新任务／版本，也显式关联上游工作记录。

同一 Module 可被多次工作修改，一次工作也可涉及少量 Module。ExecutionMemory 按工作与受影响模块／接口、版本组织，作者用于追溯，不限制其他有权限执行者继承。

## 工作身份与影响材料（2026-09-11）

任务工作身份由 Control 的 canonical 解析及 Ledger 原子提交约束保证；派发先解析，已有身份只链接新 Run，不改名或另造。返工后继任务沿已接受 Plan 的同一替换链关联起源工作，计划影响报告使用该权威结果，不用 taskId 拼接不存在的 WorkContextRef。未建立绑定是可核对的 absent；读取不完整或未供身份材料明确报告缺口，不能声称工作影响清单完整。旧绑定、历史失败及原始验收保留。

角色规格的 requiredOutputs 是声明性产出期望；移除其独立门禁不改变 Plan 的 AcceptanceObligation/VerificationRequirement。后续运行产出与长期记忆核对仍在既有 12 Module 内讨论，不新增 MemoryStore Module。当前派发 WorkContext 消费已实现不表示完整补料、暂停/换手或决定刷新回执已接通；准确实现状态见唯一模块状态。

## 职责与连续范围

| 职责 | Context 连续范围 | 结束与保留 |
| --- | --- | --- |
| 执行者 | 连贯的调查、实现、测试与相关返工 | 验收、取消或转交结束活跃责任，保留变更、理由、验证和未解项 |
| 规划／集成者 | 一个工作包的分工、反馈、跨包协商与汇合 | 完成、撤销或转交；等待可休眠，保留前沿、待答复与依赖 |
| 秘书／参谋 | 初始需求及执行中决策议题的多轮讨论 | 决定、搁置或议题转移；保留各方依据、选项、理由与决定 |
| 书记 | 一次汇报议题和必要的前次背景 | 交付简报；持续跟踪保留覆盖位置、来源与分歧 |
| 调查／QueryJob | 一个问题及其有界澄清 | 答复、超时或缺口明确；追问关联适用结果，不侵入源执行 Context |
| Reviewer | 对明确版本和验收范围的审查 | verdict 或缺口后结束；新版本重新核对审查材料，可参考历史问题 |

角色职责不强制独立进程。独立审查所需隔离按验证契约执行；其他紧密相关职责可共享运行承载，但分别标明报告、建议与决定。

## 生命周期事件

| 触发 | 必须可观察的行为 |
| --- | --- |
| 正常回复／工具结果／授权内返工 | 继续当前工作理解并加载相关反馈，不逐调用机械地新建 Run |
| 等待／暂停 | 保存工作前沿、在等谁及哪些动作尚不能执行；不要求进程常驻 |
| 恢复 | 能恢复原运行则先核对事实和权限；能力不支持或原运行丢失则新 Run 接续，公开标明实际路径 |
| 容量压力／压缩／rollover | 在安全点压缩、刷新或换手；容量和压缩次数只是诊断信号，不证明任务失败 |
| 目标／计划／规范变化 | 计算受影响工作并刷新或重建材料；旧假设保留适用性说明；不受影响工作继续 |
| 故障／转交 | 用已持久事实恢复；缺总结、缺理由或未知副作用显式保留，不能虚构结果或盲目重放工具 |
| 完成／取消 | 结束活跃责任，正常退出留下有界记录；故障恢复不依赖最后一次总结成功 |
| 后续相关新任务 | 加载当前代码／规范及适用历史，标明继承来源；旧授权、旧完成状态不被继承 |

框架保留转交、暂停与当前运行状态的区别。原 Run 的旧 lease、迟到反馈和过期版本不能推进接续状态；Context 刷新本身不改变授权或完成义务。

## 平台与内核 Interface

Control 按策略接受继续、刷新或转交请求并持久化意图；Dispatch 调用 WorkerRuntime 并接受事实；ContextCompiler 只选材。Run 内模型／工具循环、压缩与原会话恢复由内核承担。

WorkerRuntime 必须显式报告有关继续、暂停恢复、安全点及 Context 管理的能力和结果。不支持原会话恢复时，返回不可用或走已授权的新 Run 接续；不得假定 FakeRuntime 的能力等同真实内核。P1-16 以版本化扩展明确这些行为，旧版本要么兼容转换，要么明确拒绝；不静默改变 P1-03／06 契约。

精确字段在首个消费者冻结，现阶段不强制新增通用状态机、固定 token 阈值或独立 restore 服务。

## ExecutionMemory 留痕与读取

执行者在影响接口／行为、后续维护、失败路线或未解风险的关键选择发生时记录：选择、简短理由、必要备选／放弃项、来源和适用版本、不确定性与验证结果。机械步骤无需逐项解释。普通记录在已有权限内保存；规范、授权和验收变化仍需正式决定。

记录复用 Artifact、事件、Session／Handoff 及来源索引，正文先保存、引用经 Control 登记；未登记正文不能显示成已接受记录。关键检查点增量保存，最终退出只补充整理。当前事实与历史解释分开；书记不得把事后猜测写成原作者理由。

ContextCompiler 按当前工作、权限、版本和预算选取当前事实、关键理由与前沿，manifest 列出来源、缺失、截断和适用性。必要约束缺失时返回 needs_material；过期历史可作为解释材料带标识保留，不可当成当前事实。不能要求每次载入完整记录链。

工作完成不会自动删除其记录。新任务可继承同项目／授权 Workspace 范围内的适用材料；不存在或已不可用的历史显式报告缺口。保留与清理不得造成权威引用悬空，具体保留期限不在此臆定。

## 消费与验证

- P1-16：同工作多轮执行、关键理由增量留痕、换手／故障和原会话能力降级；真实内核适配验证与 Fake 契约验证分别留证。
- P1-09／10／11：独立追问、暂停恢复、变更适用性分别消费 P1-16 的上下文连续性产物。
- P1-17：完成后新任务继承；重启、旧前提、权限隔离与缺失记录可观察。
- P1-15：与跨包协调和人的决定反馈整合；角色交互正文见 [运行时协作](runtime-collaboration.md)，人类通知正文见 [初始设计与统一展示](human-design-status.md)。

验收判断接续是否保留义务、关键理由、待决项与未知结果，是否识别过期前提；不以模型声称“记得”替代证据。任务完成仍由 CompletionPolicy 归约。

## 2026-09-08 当前局部实现约束

WorkContext manifest 只列筛选及数量截断后实际纳入的 notes 与 continuation。已完成历史视图以当前计划的 TaskReduction satisfied 或 Goal COMPLETED 为准，Run 结束不等于工作完成；尚无正式结束资格的协调绑定保守排除。

CompletedWork selection 的 notes 新增兼容旧正文的可选 reason、alternatives、sourceRefs、applicableVersions，值来自账本中的 ExecutionNote。比较记录与请求的 workspace／plan／governance 版本；变化或无法核实的显式 relatedRef 版本仅作为历史解释。文本命中不证明代码引用关系。清单字节数对应实际 Vault 正文；跨 scope、缺记录与容量不足显式拒绝或返回缺口。这些局部修复尚未接通真实角色的长期继承与补料链。

P1-15 rollover 的 replacement Run ended/completed 仅证明运行终止；无正式验证归约时，workContext 中接续／未解决笔记继续可见，completedWorkView 不纳入。P1-15 回归已明确这一负例，P1-17 双存储测试保留正式完成后的正例。此处未放宽产品完成状态机。

2026-09-08 P1-18 补充：跨 Run 读取另一运行产出的材料不再依赖应用层副本，而是经账本登记的 `MaterialAccessGrantV1` 授权，并绑定授权时的 planRef／workspaceRevision／sourceDigest。读者声明的当前基线与授权基线不一致时，Vault 返回 `rejected/stale`，即“旧授权与旧版本结果不随新版本继承”；重新取材必须重新授权。该机制只约束正文读取，不改变完成状态、义务或授权范围。具体语义见 [运行时协作契约](runtime-collaboration.md) 的 P1-18 记录。


## 2026-09-12 有来源工作记忆的版本链

ExecutionNote 可附带 memory { key, revision, state, topics }，作为原工作内提炼的可复用知识记录，复用现有 Ledger/Vault/Control 路径。它不是新存储 Module，也不是任意日志自动升级为长期记忆。正文必须有公开来源，topics 为有界适用主题；来源版本、验证状态及正文引用继续沿用 ExecutionNote。

noteId 由 memory key 的摘要及 revision 确定。首版必须 active；后续版本须有同工作、同 key 的前一版本，独立 CAS@0 防止并发覆盖与分叉。retired 版本保留旧正文；恢复须提交后继 active 版本。写作者仍必须属于原工作绑定，跨工作知识维护委派尚未实现。

CompletedWorkContext 按相关主题选 active 版本，并在账本复核后继是否存在；有后继即排除旧版本，投影视图截断不能恢复旧记忆。实际 WorkRun Context 再次检查版本有效性，随后逐条核对原 ArtifactVault 的历史访问授权。被选入内容携带记忆版本、来源和验证状态，只作历史解释，不继承工具权限、任务完成状态或验收结论。角色模板标识和任务标识可作为检索主题。

当前是记忆生命周期及 Context 选材的基础实现：自动提炼工具、产品写入入口、跨任务授权选择界面、语义检索与真实开放任务质量验证尚待接通，不能据此将完整长期记忆产品标记为完成。

## 知识库作为记忆来源的接入预留（2026-09-12）

产品用途以 [PRODUCT 的记忆与领域知识支持](../../PRODUCT.md#记忆经验复用与领域知识支持) 为准。本节仅预留外部知识作为记忆相关材料参与选材的方向，不新增 Memory Module、Provider 注册系统或源码依赖，不表示已有知识库连接器。

后续知识来源应能表达来源身份与版本、个人／项目／领域适用范围、读取权限、更新时间及是否可核实。保留外部知识、正式规范、用户明确偏好和运行提炼经验的来源区别；共同检索不等于拥有相同权威。具体 schema 与读取适配在首个实际消费者中设计，不能把外部知识伪装成由某个 Work／Run 产生的 ExecutionNote。

复用现有材料登记、正文授权和 Context 选材边界：ContextCompiler 负责按职责与当前任务选取有界材料，来源不可用、过期、冲突或无权限时显式处理；不直接承担网络采集、模型提炼或知识库编辑。接入具体外部系统时再确定适配归属，保持当前 ModuleDependencyDAG。

知识读取、知识整理为经验、经验整理为 Skill 是不同操作，派生内容保留来源和适用条件。多 Agent 可以在授权范围内引用同一材料版本；检索命中、进入实际模型输入和效果改善分别留证。完整个人化知识库管理与独立产品体验暂不设计，本次不改变当前工作记忆的写入资格与历史授权规则。


## CM-1A-001：后继输入固定与逐请求复核

CommunicationAdmission 在 wait satisfied、唯一 successor Run/TaskAttempt/outbox 的事务内固定 Work、当前参与关系/授权版本与必需 Delivery 集合。后继准备经既有 RuntimePreparationPort 从持久事实重建；Dispatch 与 WorkMaterialDrive 消费同一 admission，不重新解析成另一 task Work，也不把整个邮箱作为本次必需材料。

DeliveryMaterialCompiler 只按这份集合选择精确正文；Vault 按 grant、reader、scope、当前 basis/sourcePin 与撤销状态实际读取。Runtime 组装最终输入并保存 manifest 后落 RuntimeInputBound；materialAccessRefs 与 deliveryRefs 固定。每次实际模型调用先重读固定来源/授权，再把最终请求摘要、输入摘要、manifest 摘要与 exact Run 许可绑定。不可用、撤权、版本变化或摘要不一致导致显式失败；不能重新选另一版本然后沿用旧许可。

inputDigest/manifestDigest 是可信宿主记录与本次请求的绑定证据，不代表 Control 重读全部正文或证明语义正确。Control 不引入正文读取端口。实际摘要边界在预算包装之后的 ModelClient.stream；材料及请求改动均不可只改一条证据而被接受。旧没有 inputBinding 的运行保持历史可读，不获得新调用许可。

源码阅读：src/data/context-compiler/delivery-materials.ts、runtime-context.ts → src/control/dispatch-engine/work-material-drive.ts、successor-run-preparation.ts → src/contracts/runtime-input-authorization.ts → src/execution/worker-runtime/observed-model-run.ts。失效与多轮调用反例见 tests/coordination/delivery-into-input.test.ts、model-request-evidence-bypass.test.ts；它们使用真实平台/内核与确定性 ModelClient，不证明真实模型质量。
