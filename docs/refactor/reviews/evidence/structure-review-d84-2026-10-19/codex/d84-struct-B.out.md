本轮建议：**8 项在各自相关分片前处理，1 项合拢后处理，1 项只记下。编解码试验放在 6A 前；合并 RecordStore 后端不作为 6A 前置。**

全程只读，未写文件、未运行测试或构建。以下按你提供的 `35b5f5b1` 副本判断。行数估计均为**新增＋删除**，包含必要的调用点调整，不含剩余分片本身的功能代码，也不含修改测试。

为缩短表格，下文：

- `state/`、`model/`、`persistence/` 均相对于 `src/core/work-graph/`。
- `contracts/` 相对于 `src/`；`record-store/` 相对于 `src/core/`。
- S6、S7、S8 分别指 `docs/refactor/design/orchestration-2026-10/slices/slice-{6,7,8}-SPEC.md`，按顶部后注覆盖正文旧归属。

| # | 问题（file:line，一两句） | 现在的代价（读、改、复用各难在哪；具体例子） | 剩下哪一片会碰到（spec 和章节；不碰写“无”） | 改法（一两句；只说结构） | 会不会动行为（不会 / 会：哪里） | 估计改多少行（新增＋删除） | 归类（1 片前做 / 2 合拢后做 / 3 只记下） | 把握（高 / 中 / 低） |
|---|---|---|---|---|---|---|---|---|
| 1 | **同一事件协议的格式知识仍分散在类型、解码流水线、正文检查和登记里。** [persistence/decision-record-codecs.ts:64](D:/cxt/d84-struct/src/core/work-graph/persistence/decision-record-codecs.ts:64)、`:84` 与 [persistence/line-settings-codecs.ts:56](D:/cxt/d84-struct/src/core/work-graph/persistence/line-settings-codecs.ts:56) 是三个现成试验对象。 | C1 已合并小 helper，但新增同族事件仍需手接外层检查、解析、内外绑定、正文检查、返回值和 schema 登记。现在这一协议族有 **3 份**流水线；以后新增记录还会继续发生类似登记劳动，不能靠共享 `encodeEventEnvelope` 消除。 | **6A**：S6 §0.3 L1、L7、L16，`:86`、`:127`、`:182`；以后还有下文列出的 12 种新增持久记录。 | 按决定 70-3，先以这三个事件做小范围“格式说明→编解码及登记”试验；格式说明允许调用已有正文校验器，不预先统一全库协议。 | **不会**：限定保留序列化结果、检查顺序、错误文字、返回协议和回放结果。 | 350–600 | **1；6A 前完成有界试验。** 不把全库迁移设成 6A 前置。 | 高 |
| 2 | **Query 正常生命周期的准入规则在 owner，状态目录主要提供写记录的构造器；恢复生命周期才有完整纯转移。** [state/query-run-recovery.ts:449](D:/cxt/d84-struct/src/core/work-graph/state/query-run-recovery.ts:449)、`:516`；跨区 `queries/query-execution.ts:889`、`:1058`、`:1198`、`:1490`。 | 查“能否 prepare/start/entered”要在 owner 和构造器间往返；owner 返回业务拒绝，构造器又用 throw 检查部分相同前提。6A 增加请求轮次、吸收、重试和启动排空时，容易继续把规则加在正常路径 owner，而恢复规则留在另一套入口。 | **6A**：S6 §0.3 L1、L3–L5，`:86`、`:102`、`:111`、`:118`；7B、7D2 复用底层 Query driver，见 S6 顶部后注 `:5`。 | 为正常生命周期增加纯准入入口，与现有记录构造器相邻；owner 仍逐步读取事实，在原位置询问准入，恢复与正常路径共享适用的 phase/binding 规则。 | **不会**：保留读取短路顺序、拒绝优先级及内部构造器防错，不改变合法转移。 | 300–500 | **1；6A 前。** | 高 |
| 3 | **共享持久记录的声明有三种归属，部分被放进状态机，再由 model 转引。** [state/plan-machine.ts:66](D:/cxt/d84-struct/src/core/work-graph/state/plan-machine.ts:66)、[state/message-machine.ts:151](D:/cxt/d84-struct/src/core/work-graph/state/message-machine.ts:151)、[model/session-contracts.ts:24](D:/cxt/d84-struct/src/core/work-graph/model/session-contracts.ts:24)。 | `PlanProposalRecord`、`SessionMessageRecord`、`SessionOperationRecord` 都是持久协议，却分别藏在两个机器和一个 owner API 文件里。codec、Runtime、业务编排要通过 model/状态实现找到它们；扩字段时不易区分是在改存储协议、机器上下文还是 owner 接口。消息事件又另放 `model/communication-contracts.ts:76`。 | **6B** handoff/SessionOperation：S6 §0.3 L10，`:139`；**6C、8B** PlanProposal：S6 L13 `:169`、S8 L10 `:157`、§6 `:457`；**7A** 消息：S7 §6 `:700`；7D2 再扩 role_line。 | 按领域把上述三组纯持久形状及其事件形状下沉到共享 contracts；model 保留 owner ports、依赖和事实读取接口，state 保留事件输入、守卫上下文和 effects。原导出路径可转引，避免顺手改公共名字。 | **不会**：只移动声明和依赖，不改 JSON、可选性或版本。 | 600–900 | **1；分组做：SessionOperation 在 6B 前，消息在 7A 前，PlanProposal 在首次相关计划扩展前。** | 高 |
| 4 | **接续说明一个文件同时承担数据格式、校验、摘要、中文模板和截断布局。** [contracts/continuation-brief.ts:169](D:/cxt/d84-struct/src/contracts/continuation-brief.ts:169)、`:299`、`:343`、`:382`、`:1108`；同类情况见 `contracts/core/prepared-execution.ts:97`。 | `continuation-brief.ts` 共 1,703 行，不同部分因不同原因变化。更实际的耦合是 `state/unknown-call-review.ts:850` 用其中的中文渲染计算字节预算；模板变化会牵动状态准入和输入复验，不能当普通文案替换。 | **决定 83 补规格、6A/6B、7B**：HANDOFF `:651`；S6 顶部 `:3`、L8 `:131`、L10 `:139`；S7 L7 `:125`。 | 在同一共享层内拆成格式/校验、摘要与标记、确定性的版本化渲染模块；保留共同渲染实现和旧入口，供 Runtime 与 WorkGraph 同用。模板可配置的功能本身等决定 83 的规格冻结。 | **不会**：本项不改任何输出字节、截断次序、预算或摘要算法。 | 1,500–1,800 | **1；与决定 83 补规格衔接，在 6A 前完成结构拆分。** | 中 |
| 5 | **注记“处置是否合法”没有一个完整的纯规则入口。** [state/note-machine.ts:354](D:/cxt/d84-struct/src/core/work-graph/state/note-machine.ts:354)、`:408` 负责状态/部分条件；作者身份、书记权限、作用范围和 resolution 条件在跨区 `notes/note-service.ts:1624`、`:1647`、`:1689`。 | 阅读一次 accept/withdraw 必须拼合两处规则。新的秘书、探索 Query、区域书记接入时，既要知道 `noteWriteAuthority`，又要知道处置核心还有另一套权限分支；这些规则无法仅凭 state 的入口复用。 | **6B**：S6 §0.3 L9，`:138`；**7D1/7D2** 区域职责；**8C** 修补激活：S8 §0.3 L4 `:110`、§6 `:458`。 | 把处置的纯授权、作用范围判断及 resolution 条件集中为 state 的准入函数；owner 继续读取职责、目标和冲突事实，维持当前“一个处置核心”。 | **不会**：不扩大秘书/探索 Query 权限，不改变书记能处理的范围和拒绝顺序。 | 200–350 | **1；6B 前。** | 高 |
| 6 | **消息正文上限由 codec 持有，导致机器不能复用真正的正文准入规则。** [state/message-machine.ts:516](D:/cxt/d84-struct/src/core/work-graph/state/message-machine.ts:516) 明确承认自己的 capacity reason 不是当前业务结果；常量在跨区 `sessions/message-record-codecs.ts:98`，实际检查在 `communication/mailbox-service.ts:453`。 | 当前要靠 owner 先 `normalizeText`，再传 `bodyBounded: true`；同一 owner 的 `:1816`、`:3679` 还有正文长度判断。新消息动作必须知道该用哪条检查，直接复用机器反而会换掉错误文字。 | **7A**：S7 §0.3 L1 `:91`、§6 `:700`；7B 的消息消费继续使用同一记录。 | 将正文限额放进共享消息契约，把公开写入的纯正文检查放进 state；codec 做持久形状校验，owner 和机器复用同一准入结果。 | **不会**：保留 16 KiB、UTF-8 计数、空串规则、错误码与文字；不顺手改变 trim 等处理。 | 80–140 | **1；7A 前。** | 高 |
| 7 | **Plan 机器把一部分业务准入接成“已经判完的结果”，纯校验仍位于 owner 目录。** [state/plan-machine.ts:12](D:/cxt/d84-struct/src/core/work-graph/state/plan-machine.ts:12)、`:368`、`:948`；跨区 `tasks/plan-validation.ts:1`、`tasks/plan-service.ts:1688`、`:2983`。 | 读一次计划采用，要同时追机器、owner 的分步调用和纯校验；初始采用与未来修改各自接 `draftIssues → assignmentReasons → phaseReasons`。但校验本身已经只有一份，没有发现必须通过搬目录才能解决的重复算法。 | **6C、8B**：S6 §0.3 L13 `:169`；S8 L10 `:157`、§6 `:457`。 | 长期可把纯 Plan 准入与所需的纯 basis 计算收进 state 的 Plan 子模块，owner 只交原始事实；保持分步准入接口，不把读取一次性前置。 | **不会**，前提是逐阶段短路和错误顺序完全保留。 | 1,400–2,200 | **3。** 虽然后续会碰，但现有单一纯实现可继续扩；搬迁量不足以成为 6C/8B 前置。 | 高 |
| 8 | **责任转移的机器已拿到 destination Session，却仍让 owner 另算其业务资格。** [state/session-responsibility.ts:21](D:/cxt/d84-struct/src/core/work-graph/state/session-responsibility.ts:21)、`:53`；跨区 `sessions/session-responsibility-service.ts:98`。 | `destinationEligible` 把 active、available、无 archiveRequest、非 readonly_copy 四项规则藏在 owner 中，机器只收 boolean。新 reanchor/区域转移入口要借用 owner 私有规则，或重新解释这四项条件；并非所有 guard boolean 都有这个问题，此处原始记录已经在机器输入里。 | **7D1**：S7 §0.3 L25 `:195`、§6 `:706`；**8B/8C**：S8 §6 `:457`、`:458`。 | 把 Session 的纯接任资格放在 state，供既有转移和未来 planReanchor 共用；目标存在性、停写证明、读取和事务提交仍归 owner。 | **不会**：不改变范围支持、转移顺序或资格条件。 | 160–300 | **1；7D1 前。** | 高 |
| 9 | **卡源的公开协议与通用实现没有形成一个完整的扩展入口。** [model/decision-contracts.ts:361](D:/cxt/d84-struct/src/core/work-graph/model/decision-contracts.ts:361) 用 `needsGoal` 加可选 goal；跨区 `views/decision-read-model.ts:226` 的通用 collection spec 却要求 Goal，`:269` 无 Goal 直接空页，candidate 还被 `:939` 排除在注入源之外。 | 已有通用源用于 note_review、unknown_call_review、command_rerun_request **3 种**；goal_cause、planning_question、candidate 仍是 **3 条不同接法**（`:188`、`:206`、`:899`）。增加项目主体时，除了扩 model 类型，还要找协调器内的特殊分支；不能把所有来源直接塞进现有 collection helper，因为 planning_question 已有分页协议。 | **6B**：S6 顶部后注 `:11`；**7C/7D2**：S7 §2 `:426`、`:530`；**8C**：S8 §6 `:458`。具名新增 source kind 至少 **6 个**：member_creation、rework_request、role_capacity、role_line_change、repair_approval、structural_proposal。 | 先统一 model 层的源登记接口，并区分“已有分页源”与“集合源适配”；把上述三条接法接到登记入口。Goal 内容读取作为适配器职责，6B 再按冻结规格加入 subject，不在结构改动中提前开放项目卡。 | **不会**：必须保留来源键、分页、水位、关闭历史、缓存窗口与读取次数；简单套 collection helper 会动这些行为，不应那样改。 | 450–800 | **1；6B 前。** 这是 C1 ruling 6 的后续；主要实现会跨到 views。 | 中 |
| 10 | **RecordStore 仍维护两套物理事务和查询实现。** [record-store/in-memory-record-store.ts:71](D:/cxt/d84-struct/src/core/record-store/in-memory-record-store.ts:71)、[record-store/sqlite-record-store.ts:111](D:/cxt/d84-struct/src/core/record-store/sqlite-record-store.ts:111)。 | schema、提交计划和部分扫描规则已共用，但快照/事件/幂等/claim 写入、索引更新、回滚及查询执行仍需两条实现。主实现共 **1,503 行**；完整量化见下文。 | 剩余片会增加共同 schema、索引和事务使用，但**没有冻结需求明确要求新增一种 backend 私有实现**。因此本项的物理后端合并没有明确分片落点；不是“每新增记录就写两遍 codec”。 | 保留 SQLite 实现；memory 使用 SQLite `:memory:`，保留现有 factory/port 外观及必要的错误兼容。保留共用 codec、扫描算法和 artifact body 算法，不按“两个后端”误删共享代码。 | **不会改变领域行为**：持久模式仍落盘，memory 仍易失；必须保留查询顺序、回执、失败/关闭协议。运行时开销会变化，当前只读审查没有性能结论。 | 700–900 | **2；合拢后做。** 不作为 6A 或 7D1 前置。 | 中 |

**新增记录及事件的清点，按“独立持久记录”与“现有记录扩展”分开。**

冻结规格明确要求新增 **12 种持久记录形状**。这不等于已经冻结了 12 份完整的 `EncodedRecord` 定义：部分规格尚未给出最终 schemaId、完整 ref 或 revision 包装，不能让生成器自行补猜。

| 分片 | 新增持久记录 | 规格依据 |
|---|---|---|
| 6A | `QueryActivity` | S6 §0.3 L16，`slice-6-SPEC.md:182`；QueryRun 活动事实、关联 Session、可空 Goal、结束/记录时间和 span。 |
| 6B | `InitializationBindingV1` | S6 §0.3 L8，`:133`；顶部后注 `:10` 将提议、采用、读取闭环前移到 6B。不可变的 answer/request/draft 与 Goal 绑定事实。 |
| 7A | `DispatchCounterSnapshot`／`DispatchCounter` | S7 §0.3 L2，`slice-7-SPEC.md:101`；§2 `:385`；§6 `:700` 明确新派工序号 codec 和服务。 |
| 7D1 | `SessionRoleFactsV1` | S7 §2 `:460`；§6 `:706`。 |
| 7D1 | `ProjectRoleLimitsV1` | S7 §0.3 L31，`:230`；§2 `:471`；§6 `:706`。 |
| 7D1 | `RoleLineAllocationV1` | S7 §0.3 L31，`:230`；§2 `:476`；§6 `:706`。 |
| 7D2 | `RoleCapacityEpisodeV1` | S7 §0.3 L32，`:246`；§2 `:524`。 |
| 7D2 | `GoalAdviserQueueV1` | S7 §0.3 L33，`:252`；§2 `:497`。`GoalScreeningV1` 是其中的嵌入形状，不另算一条记录。 |
| 7D2 | `AutonomyRuleV1` | S7 §0.3 L37，`:286`；§2 `:509`。 |
| 7D2 | `AutonomyRuleSetV1` | S7 §0.3 L37，`:286`；§2 `:516`。不能漏掉这个“没有匹配规则也要守”的 revision 记录。 |
| 8C | `ArchitectureProposalV1` | S8 §0.3 L6，`slice-8-SPEC.md:132`；§2 `:250`；§6 `:458`。 |
| 8C | `ArchitectureProposalBatchV1` | S8 §2 `:258`；§6 `:458`。它是批准前冻结成员、操作和摘要的独立批次，不能并入单条 proposal 计数。 |

以下是扩展，不另算新增独立记录：

| 分片 | 扩展的现有记录或协议 | 规格依据 |
|---|---|---|
| 6A | QueryJob 的 requestRoot、轮次、路由、归属、selectedIdea、卡引用；QueryJobAnswer 的 ideas；Query 的无 Goal 调用类；ActivityRecording 的 querySince。 | S6 L1 `:86`、L7 `:127`、L8 `:131`、L16 `:182`。 |
| 6B | SessionOperation 的 handoff；Goal 的 continuedFrom、copiedInterventions；卡/通知/source facts 的 goal/project subject；初始化采用证明。 | S6 顶部 `:8`、`:11`；L10 `:139`、L12 `:162`、L14 `:177`。不新增 handoff 表。 |
| 6C | PlanProposal/计划写入的授权与请求关联，未来计划修改闭环。 | S6 L13 `:169`、§6 `:398`。 |
| 7A | SessionMessage 的任务、请求、deadline、release、接受证据、application、转移和处置时间、pins。 | S7 L1 `:91`；§2 `:369`。 |
| 7B | RunContinuation、ConsumedWait 的 expiry/intervention 判别式；到期输入身份；Query 调用种类。 | S7 L7–L8 `:125`；§6 `:701`。不新增 wait 表或到期调度记录。 |
| 7C | 成员、返工和换手工具使用既有消息、Query、SessionOperation、决定来源；咨询增加 mode。 | S7 L14 `:162`、L17–L19 `:168`；§6 `:702`。 |
| 7D1 | WorkLinkTarget 增 goal/project，职责范围、占位与责任转移；项目卡的跨工作区身份。 | S7 L23–L25 `:184`、§2 `:445`、`:519`；顶部后注区分 subject 与跨工作区身份的落地时间。 |
| 7D2 | `RoleLineOperationV1` 是 SessionOperation 的新 kind，含 7 种 action；筛选结果嵌入 GoalAdviserQueue。 | S7 L41 `:307`；§2 `:487`、`:501`。 |
| 8B | PlanRevisionDraft/PlanProposal 的 catalogPin；目录 containment、负责关系及唯一 claim。 | S8 L9–L11 `:149`；§6 `:457`。 |
| 8C | Note 的 RepairInput/RepairPayload、Round 的 stagedRepairs、目录修订和 responsibilityMoves。 | S8 L1 `:94`、L4 `:110`、L5 `:124`；§6 `:458`。 |

**事件不能按上述记录数一对一推算。** 冻结文字中，剩余片明确命名的新增持久事件只有：

- **`ProjectRoleLimitsChanged { from, to, actor }`**：S7 §0.3 L31，`slice-7-SPEC.md:245`；§6 `:706`。规格此处没有给出完整 envelope 和 schemaVersion。

其余可以确定的事项是：

- **6B 扩展已有事件** `ArchitectureCatalogAdopted`、`ProjectCompletionPolicyActivated`，来自卡回答时增加 `acknowledgementRef`。依据 S6 L14，`slice-6-SPEC.md:178`。不是两个新 event type。
- **8C 复用目录修订提交/事件机制**；修补生效还要同次提交注记、目录、基线、指针及责任关系。依据 S8 L4、L6，`slice-8-SPEC.md:110`、`:132`。不能自行把状态表中的 `activateRepair` 当作已经冻结的 wire event 名。
- **7A 的 application 证明登记**是给已有证明 registry 增加事件适配，S7 顶部 `:12`；这不等于规格已经决定了全部新增消息事件名称。
- QueryActivity、InitializationBinding、角色线/队列/规则、ArchitectureProposal/Batch 的提交是否使用新事件，以及各事件的名字、版本、正文和回放载荷，**未在这三份冻结规格中逐一列定**。这些应在对应任务书冻结，不能在此次审查里补成看似确定的事件清单。
- 不重复计算已经合入的 8A、8D、L8 记录或事件。

**以 `RunActivity` 为例，当前端到端手工接线有多少。**

这里按“独立维护入口”计数，不把正文校验器内部每个字段判断拆成一项，也不把同一 helper 的调用次数算成多份实现。

| 手写部分 | 数量 | 位置 |
|---|---:|---|
| 记录形状、事件形状 | 2 | `contracts/run-activity.ts:61`；`persistence/run-activity-codecs.ts:48`。 |
| 记录 encoder、decoder、正文校验入口 | 3 | `persistence/run-activity-codecs.ts:324`、`:333`、`:272`。记录 envelope/refKey/revision 检查包含在 decoder 中，不再重复计数。 |
| 事件 encoder、decoder、事件 envelope 检查 | 3 | 同文件 `:401`、`:405`、`:382`。 |
| canonical ref key、持久 ref 检查、公开 owner 输入 ref 检查 | 3 | 同文件 `:316`、`:64`；跨区 `tasks/run-activity-service.ts:120`。 |
| 记录 schema、事件 schema 登记 | 2 | `persistence/run-activity-codecs.ts:458`、`:477`。 |
| Store failure → 业务拒绝映射 | 1 | 跨区 `tasks/run-activity-service.ts:92`。 |
| 回执回放、正常提交组装 | 2 | 跨区 `tasks/run-activity-service.ts:311`、`:325`。 |
| 查询索引登记 | 1 | `persistence/run-activity-codecs.ts:447`。不是所有记录都必须有，但这一条有。 |
| **生产维护入口合计** | **17** | 这些入口还跨 contracts、persistence、owner 和组合根登记链。 |
| 本轮定位的三类现有验证入口 | **3 个测试文件** | `tests/work-graph/S2B-r2-activity-run-ended-at.test.ts:48`：真实写入及 codec；`tests/work-graph/S2B-r2-conflict-catalog.test.ts:45`：公开写入及下游查询、双后端；`tests/work-graph/S2B-run-activity-read.test.ts:34`：公开读结果、双后端。这是三个代表性维护入口，**不是全库 RunActivity 测试总数**。 |

所以，不能把“格式说明生成 codec”描述成“以后新记录只写一个定义”。它能缩小的是**编解码、机械 envelope/ref 检查和登记**；业务准入、事务组合、回执语义、权限以及独立的测试期望仍须人工定义。

试验应在 **6A 前**，原因是 6A 是剩余片中第一个新增持久记录、扩 Query 协议并被后续复用的入口；拖到 6A 后，最先一批新 codec 已经按旧方式复制。但试验范围应严格停在决定指定的 **2 个 decision 事件＋1 个 line-settings 事件**：它们已经共用 envelope helper，最适合检验描述方式是否真的减少分散维护，而不是先造覆盖全库的 schema 框架。

**格式说明必须表达的差异，以及 C1 ruling 7 留下的近似代码。**

| 差异 | 现有证据 | 结构判断 |
|---|---|---|
| **校验顺序及首个错误** | decision 先外层 envelope，再解析正文：`persistence/decision-record-codecs.ts:64`；RunActivity 先解析：`persistence/run-activity-codecs.ts:405`。 | 不能统一换成一种先后。格式族需要明确 pipeline；否则同时损坏两个位置的输入会改变结果。 |
| **首错返回与累计错误** | `persistence/event-validation.ts:11` 逐项首错返回；`persistence/plan-record-codecs.ts:907` 累积 issues。 | 需要不同的错误收集模式及原文字模板；不是给所有 parser 换同一个函数名。 |
| **严格字段集、允许扩展、投影返回** | `persistence/event-validation.ts:48` 对 RunRef 检查 exact keys；`persistence/execution-history-codecs.ts:63` 的复合 `isRunRef` 不做同样的 extra-field 拒绝；`persistence/execution-entry-codecs.ts:74` 的 SessionRef 检查也允许额外字段。 | **这类差异适合显式格式参数**，如字段集、extra-field 策略、返回原对象还是投影；不能默认“越严格越好”。 |
| **数值域不是一个规则** | `record-store/record-codec.ts:72` 接受 revision 0；`persistence/decision-record-codecs.ts:317` 只允许 proof 的 before 使用 absence pin 0，after 要正版本。 | 格式需要表达 safe integer、最小值和分支约束。内联 safe-integer 判断不值得另外做全库清扫。 |
| **null、缺省、union、跨字段一致性** | GoalSettingsChanged 的 value 可以是单个 Goal 或非空 goals 数组：`persistence/decision-record-codecs.ts:337`；其 proof 可空，而 notice/line-pins 的 proof 必须为空：`:352`、`:367`、`line-settings-codecs.ts:82`；RunActivity 有 scope 一致性：`run-activity-codecs.ts:415`。 | 描述不能只列字段类型；必须容纳分支和命名 refinement。复杂业务约束继续调用已有纯校验。 |
| **抛错、nullable、boolean 是不同 API** | `tasks/claim-service.ts:121` 的 refKeyOf 与 `:124` 的 sameRef；`state/plan-machine.ts:894` 的比较入口。 | 不建议制造 `refHelper(mode)` 把它们揉成一个返回多种结果的函数。可以共享底层 canonicalization，但应保留清晰的上层协议。 |
| **结构相等与领域身份相等不同** | `state/ref-equality.ts:2` 比较完整结构；`state/command-rerun-request.ts:249`、`:253` 和 `state/review-lease.ts:67` 比较身份字段。 | K3 的 sameTask/sameReviewRef/sameRunRef 不应直接替换成通用深比较。若以后确有多处同一身份定义，可共享一个明确命名的身份函数；本轮不建议另开迁移。 |
| **Store failure 的业务映射不同** | `persistence/read-result-failures.ts:65` 将 unique_conflict 映射为 revision_conflict；`:88` 的 execution 写入映射为 busy，且文字不同；`:123` 的读侧又是另一协议。 | C1 已把这些差异集中为命名策略。不要让 schema 生成器推断领域错误码，也不要继续合成一个“大而全”映射器。 |

另外，格式说明还需保留既有的 schema/version 分派、编码字段次序、copy/alias 行为、字符与 UTF-8 字节上限，以及登记后的原始 envelope 返回方式。**不能用同一份格式说明同时生成实现和全部测试期望**，否则格式表写错时两边会一起通过。现有测试仍是独立依据；这次没有新增或执行测试。

**双后端的实际成本，比“两份 codec”小，但仍然具体。**

| 范围 | 当前静态数量 | 含义 |
|---|---:|---|
| 两个 RecordStore 主实现 | **2 文件，1,503 行** | memory 660 行；SQLite 843 行。 |
| 加 SQLite 专用 schema/index/SQL/text-scan 支撑 | **6 文件，2,195 行** | 另有 `migrations.ts` 155、`sqlite-lookup-indexes.ts` 141、`sqlite-sql-literals.ts` 37、`sqlite-text-scan.ts` 359。**这不是合并后能删除 2,195 行**；保留 SQLite 时，大部分仍需要。 |
| 独立查询/提交入口 | **7 类读取＋1 类提交，各有两条执行路径** | readMany、lookupCommit、eventAt、lookup、lookupOrdered、countLookup、searchText，以及 commit。memory 的汇总入口在 `in-memory-record-store.ts:635`，SQLite 在 `sqlite-record-store.ts:809`。 |
| 专门的 RecordStore 测试目录 | **13 个 `.test.ts`，3,700 行** | 不含 helper/worker；这是静态文件计数，没有运行。 |
| 其中显式的 memory/sqlite 参数化声明 | **69 处，跨 8 个文件** | 同一断言要覆盖两个后端，至少对应 138 个后端参数组合；**不是 138 份重复测试代码**。 |
| 全 tests 树直接引用两个 backend factory 的文件 | **81 个测试或 helper 文件** | 表示调用面较广，不表示 81 个文件都要修改，也不表示都可以删除。 |

共同部分已经包括：

- schema registry 与提交计划：`record-store/record-codec.ts:143`、`:472`。
- commit 扩展与 cursor binding：`record-store/commit-extensions.ts:1`、`record-codec.ts:698`。
- lookup 请求解码、排序/范围规则：`record-store/lookup-index.ts:168`、`:245`、`:438`。
- 文本扫描基础算法：`record-store/text-scan.ts`，SQLite 也使用。
- artifact body 的 put/read/first-writer-wins 算法：`record-store/body-store.ts:24`，SQLite 只是 `ArtifactBodyRows` 适配器，见 `sqlite-body-store.ts:34`。这部分不是两套领域实现。

剩余片给双后端增加的负担主要是：

1. 上述 **12 种记录形状及现有记录扩展，登记一份，共同消费**；组合根当前就是把同一个 `schemas` 交给两个 factory，`src/composition/create-platform.ts:677`。
2. 6A 的三个 request 查询索引，以及 QueryRun ended 索引，共 **4 个具名新增索引**，见 S6 L2 `:99`、L16 `:182`。后续有新的查找需要，但规格没有逐一冻结所有索引名及数量，不能按每条新记录一个索引估算。
3. 新记录的 guard、claim、幂等及查询语义仍要在两个物理实现上成立；若共享提交机制变化，也要核对两边的事务内调用和失败回滚。
4. 7D1/7D2 有嵌套 cursor 字段：`RoleLineAllocationV1` 的 holders/reservations、`GoalAdviserQueueV1` 的 entries，见 S7 `:476`、`:497`。当前 binding 只支持四个顶层字段，`record-store/ports.ts:91`。**这是届时需要冻结的提交能力设计，不应偷偷混入“合并后端”的结构改动。** 选择扩共享 binder，也仍不意味着要写两套记录 codec。

因此第 10 项归 **2**。我没有把“两个后端都使用新增记录”误判为“剩余片一定会在两个 backend 实现里新增代码”。

还有一处文档引用应由 lead 分清：`HANDOFF.md:237` 的决定 49 Q9 实际写的是**注记只加一个全文索引**；“只留一个 RecordStore 后端”的此次审查授权来自决定 70-4（`:467`）和 C1 ruling 11（`.lead-ref/c1-lead-rulings.md:32`）。后者足够支撑本轮审查，但不能把 Q9 写成已经批准删除某个 backend。

**state 与 owner 的总判断：边界已基本建立，尚未在所有领域一致。**

我没有发现需要否定整个 `state/` 划分的理由。Run、Attempt、Task、Verification、Control 已有纯转移、事实输入和 effects；owner 分步读事实、提前调用同一纯 guard 以保持短路，并不自动构成“重复校验”。例如：

- `state/verification-machine.ts:1082`、`:1122`、`:1257` 提供可独立调用的准入规则。
- `state/control-intent-machine.ts:530`、`:540` 直接表达下一步是否需要读取相应事实。
- `state/decision-policy.ts:31` 已有共同策略入口，`:82` 复用它派生决定原因。
- `state/review-lease.ts:63` 集中了“已知结束”的共同判断。

真正需要分开的情况是：

- **同一规则在 owner 判断、构造器又判断**：Query 正常生命周期，第 2 项。
- **机器只接已判定 boolean，而规则和原始对象仍散在 owner**：消息正文、第 6 项；责任接任资格、第 8 项。
- **一项业务动作的纯规则分布在机器与 owner**：注记处置，第 5 项。
- **有意把独立纯校验结果作为机器事实**：Plan，第 7 项。它不理想，但不能和“重复实现规则”混为一谈。

没有仅凭 `run-machine.ts` 2,606 行、`verification-machine.ts` 1,689 行或 `task-failure.ts` 1,474 行就提出拆文件。它们需要结合规则变化轴拆分；当前已经有明确的纯函数和状态入口，未证明再做通用状态机框架能让剩余片更小。

**contracts 与 model 的总判断：存在可用原则，但声明位置没有完全贯彻。**

可执行的原则应是：

- **跨模块共享的纯记录、事件、引用和协议形状**放 contracts。
- **WorkGraph owner 的端口、依赖装配、读事实接口**放 model。
- **纯转移的输入事件、guard context、effects、机器私有中间态**放 state。
- 不按“interface 就放 model、type 就放 contracts”机械划分；共享能力端口也可以在 contracts。

明确错位且剩余片继续扩展的，是第 3 项的三组：

| 类型 | 当前声明位置与转引链 | 具体成本 |
|---|---|---|
| `PlanProposalRef`、`CandidatePlanProposal`、`PlanProposalRecord` 等 | `state/plan-machine.ts:66`；`model/plan-contracts.ts:20`、`:32` 转引；`persistence/plan-record-codecs.ts:51` 再从 model 导入。 | 持久协议的定义依赖于状态机文件的组织；6C/8B 修改 proposal 格式时，必须跨三个层次追定义。 |
| `SessionMessageRecord` 及 sender/response 等持久形状 | `state/message-machine.ts:70`、`:109`、`:151`；`model/communication-contracts.ts:38`、`:64` 转引。事件形状又在同 model 文件 `:76`。 | 记录与事件分居 state/model，公共消息 contracts 只持有另一部分形状；7A 的一组字段变更需要先弄清哪一份是存储真源。 |
| `SessionOperationRecord` | `model/session-contracts.ts:24`，与创建 API 和 SessionDirectoryPort 混放；`src/core/agent-runtime/session-operations.ts:10` 直接使用。 | 6B handoff、7D2 role_line 都扩它；它已经是跨 Runtime/WorkGraph 的持久协议，而非创建服务的私有返回类型。 |

没有看到 `src/contracts/` 反向导入 WorkGraph 实现形成循环的证据。`model/graph-context-contracts.ts:31` 的 `GraphContextFactsV1`、各类 `*Dependencies`、`DecisionSourceFactsPort` 等依赖 owner 事实，留在 model 合理。`GraphTaskCardV1`、`NodeCardV1` 等纯读 DTO 虽然也可下沉，但**目前没有足够收益把全部公开 DTO 搬家列为另一个片前任务**。

最后按表中估计汇总：

| 归类 | 发现数 | 新增＋删除估计 |
|---|---:|---:|
| **1：对应分片前做** | **8**（#1–#6、#8、#9） | **3,640–5,390 行** |
| **2：合拢后做** | **1**（#10） | **700–900 行** |
| **3：只记下** | **1**（#7） | **1,400–2,200 行**，仅表示若实施的规模，不建议现在投入 |
| 合计 | **10** | **5,740–8,490 行**；不表示建议一次性施工 |

看到的行为问题单独列一项，不计入结构发现：

- `src/contracts/ledger.ts:103` 接受 `10_000_000_000` 并生成 11 位数字 cursor，但同文件 `:109` 的解析器只接受 10 位；该边界下生成值不能被自身解析器接受。静态可确定，未运行复现。

以下是本区文件读取清单。`read` 表示通读；`skimmed` 表示做了声明/依赖结构扫描及相关区段抽读，**不表示逐行完整审查**。跨区追踪的 owner、views、组合根和测试文件已在上文定位，不混入本区清单。

```text
src/core/work-graph/state/architecture-capture.ts — skimmed
src/core/work-graph/state/attempt-machine.ts — skimmed
src/core/work-graph/state/command-normalization.ts — skimmed
src/core/work-graph/state/command-rerun-request.ts — skimmed
src/core/work-graph/state/context-input.ts — skimmed
src/core/work-graph/state/control-intent-machine.ts — skimmed
src/core/work-graph/state/decision-policy.ts — skimmed
src/core/work-graph/state/goal-machine.ts — skimmed
src/core/work-graph/state/goal-settings-machine.ts — skimmed
src/core/work-graph/state/line-pin-machine.ts — skimmed
src/core/work-graph/state/line-status.ts — skimmed
src/core/work-graph/state/message-machine.ts — skimmed
src/core/work-graph/state/no-progress.ts — skimmed
src/core/work-graph/state/note-machine.ts — skimmed
src/core/work-graph/state/notice-settings-machine.ts — skimmed
src/core/work-graph/state/plan-machine.ts — skimmed
src/core/work-graph/state/query-run-recovery.ts — skimmed
src/core/work-graph/state/ref-equality.ts — read
src/core/work-graph/state/review-lease.ts — skimmed
src/core/work-graph/state/run-machine.ts — skimmed
src/core/work-graph/state/session-anomaly.ts — skimmed
src/core/work-graph/state/session-availability.ts — skimmed
src/core/work-graph/state/session-responsibility.ts — read
src/core/work-graph/state/task-failure.ts — skimmed
src/core/work-graph/state/task-machine.ts — skimmed
src/core/work-graph/state/transition.ts — skimmed
src/core/work-graph/state/unknown-call-kinds.ts — skimmed
src/core/work-graph/state/unknown-call-review.ts — skimmed
src/core/work-graph/state/verification-machine.ts — skimmed
src/core/work-graph/persistence/commit-compiler.ts — skimmed
src/core/work-graph/persistence/control-record-codecs.ts — skimmed
src/core/work-graph/persistence/decision-record-codecs.ts — skimmed
src/core/work-graph/persistence/event-envelope.ts — read
src/core/work-graph/persistence/event-validation.ts — read
src/core/work-graph/persistence/evidence-record-codecs.ts — skimmed
src/core/work-graph/persistence/execution-entry-codecs.ts — skimmed
src/core/work-graph/persistence/execution-history-codecs.ts — skimmed
src/core/work-graph/persistence/graph-repository.ts — skimmed
src/core/work-graph/persistence/line-settings-codecs.ts — read
src/core/work-graph/persistence/lookup-all.ts — skimmed
src/core/work-graph/persistence/note-record-codecs.ts — skimmed
src/core/work-graph/persistence/plan-record-codecs.ts — skimmed
src/core/work-graph/persistence/read-result-failures.ts — read
src/core/work-graph/persistence/record-codecs.ts — skimmed
src/core/work-graph/persistence/rework-codecs.ts — skimmed
src/core/work-graph/persistence/run-activity-codecs.ts — skimmed
src/core/work-graph/model/claim-contracts.ts — skimmed
src/core/work-graph/model/command-recognition-contracts.ts — skimmed
src/core/work-graph/model/command-rerun-request-contracts.ts — skimmed
src/core/work-graph/model/communication-contracts.ts — skimmed
src/core/work-graph/model/configuration-contracts.ts — skimmed
src/core/work-graph/model/context-input-contracts.ts — skimmed
src/core/work-graph/model/decision-contracts.ts — skimmed
src/core/work-graph/model/evidence-contracts.ts — skimmed
src/core/work-graph/model/execution-entry-contracts.ts — skimmed
src/core/work-graph/model/execution-history-contracts.ts — skimmed
src/core/work-graph/model/execution-read-contracts.ts — skimmed
src/core/work-graph/model/graph-context-contracts.ts — read
src/core/work-graph/model/kernel-command-read-contracts.ts — read
src/core/work-graph/model/material-contracts.ts — skimmed
src/core/work-graph/model/note-contracts.ts — skimmed
src/core/work-graph/model/plan-contracts.ts — skimmed
src/core/work-graph/model/session-contracts.ts — read
src/core/work-graph/model/session-facts-contracts.ts — skimmed
src/core/work-graph/model/task-contracts.ts — skimmed
src/core/work-graph/model/task-index.ts — skimmed
src/core/work-graph/model/tool-commit-arguments.ts — skimmed
src/core/work-graph/model/unknown-call-review-contracts.ts — skimmed
src/core/work-graph/model/work-line-contracts.ts — skimmed
src/contracts/architecture-catalog.ts — skimmed
src/contracts/architecture-inspection.ts — skimmed
src/contracts/architecture-observation.ts — skimmed
src/contracts/architecture-source.ts — skimmed
src/contracts/artifact.ts — skimmed
src/contracts/command-event.ts — skimmed
src/contracts/command-rerun-request.ts — skimmed
src/contracts/context-continuity.ts — skimmed
src/contracts/continuation-brief.ts — skimmed
src/contracts/control-intent.ts — skimmed
src/contracts/coordination.ts — skimmed
src/contracts/delegated-write.ts — skimmed
src/contracts/dispatch.ts — skimmed
src/contracts/evidence.ts — skimmed
src/contracts/execution-feedback.ts — skimmed
src/contracts/fingerprint.ts — skimmed
src/contracts/goal-change.ts — skimmed
src/contracts/goal-decisions.ts — skimmed
src/contracts/goal-phase.ts — skimmed
src/contracts/governance.ts — skimmed
src/contracts/graph-context.ts — skimmed
src/contracts/human-role-collaboration.ts — skimmed
src/contracts/initial-planning.ts — skimmed
src/contracts/input-declaration-id.ts — skimmed
src/contracts/ledger.ts — skimmed
src/contracts/material-access.ts — skimmed
src/contracts/memory.ts — skimmed
src/contracts/no-progress.ts — skimmed
src/contracts/note.ts — skimmed
src/contracts/opaque.ts — skimmed
src/contracts/path-ownership.ts — skimmed
src/contracts/plan.ts — skimmed
src/contracts/platform-duty.ts — skimmed
src/contracts/query-execution-context.ts — skimmed
src/contracts/query-job.ts — skimmed
src/contracts/reduction.ts — skimmed
src/contracts/resource-caps.ts — skimmed
src/contracts/review-admission.ts — skimmed
src/contracts/reviewer-context.ts — skimmed
src/contracts/reviewer-verification.ts — skimmed
src/contracts/reviewer-work.ts — skimmed
src/contracts/role-material-channels.ts — skimmed
src/contracts/role-spec-materials.ts — skimmed
src/contracts/role-spec.ts — skimmed
src/contracts/run-activity.ts — read
src/contracts/runtime-budget.ts — skimmed
src/contracts/session-anomaly.ts — skimmed
src/contracts/task-envelope.ts — skimmed
src/contracts/task-failure.ts — skimmed
src/contracts/task-requeue.ts — skimmed
src/contracts/unknown-call-review.ts — skimmed
src/contracts/utf8.ts — skimmed
src/contracts/verification-context.ts — skimmed
src/contracts/verification-import.ts — skimmed
src/contracts/verification.ts — skimmed
src/contracts/work-line.ts — skimmed
src/contracts/core/call-context.ts — skimmed
src/contracts/core/execution-history.ts — skimmed
src/contracts/core/identity.ts — skimmed
src/contracts/core/operations.ts — skimmed
src/contracts/core/prepared-execution.ts — skimmed
src/contracts/core/rejections.ts — skimmed
src/contracts/core/results.ts — skimmed
src/contracts/core/session-archive.ts — skimmed
src/contracts/core/session-message.ts — skimmed
src/contracts/core/session.ts — skimmed
src/contracts/core/source.ts — skimmed
src/contracts/core/task-claim.ts — skimmed
src/contracts/validation/common.ts — skimmed
src/contracts/validation/goal.ts — skimmed
src/contracts/validation/identity.ts — skimmed
src/contracts/validation/role.ts — skimmed
src/core/record-store/body-codec.ts — skimmed
src/core/record-store/body-ports.ts — skimmed
src/core/record-store/body-store.ts — skimmed
src/core/record-store/commit-extensions.ts — skimmed
src/core/record-store/guarded-revision.ts — skimmed
src/core/record-store/in-memory-record-store.ts — skimmed
src/core/record-store/lookup-index.ts — skimmed
src/core/record-store/lookup-ports.ts — read
src/core/record-store/migrations.ts — skimmed
src/core/record-store/ports.ts — read
src/core/record-store/record-codec.ts — skimmed
src/core/record-store/sqlite-body-store.ts — skimmed
src/core/record-store/sqlite-lookup-indexes.ts — skimmed
src/core/record-store/sqlite-record-store.ts — skimmed
src/core/record-store/sqlite-sql-literals.ts — skimmed
src/core/record-store/sqlite-text-scan.ts — skimmed
src/core/record-store/text-scan.ts — skimmed
```