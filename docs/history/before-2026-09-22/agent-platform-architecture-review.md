# Agent Platform 架构交叉审查

审查日期：2026-09-20。对象：`/agent-platform/ARCHITECTURE.md`、`/agent-platform/PRODUCT.md`、`/agent-platform/source-analysis.md`。

**结论：架构方向可以保留，可以继续开展模块设计；当前版本不足以直接冻结接口、生成最终模块依赖规则，再批量实施。** 主要风险在会话准入、运行控制、派发收口、依赖验证和真实生产接线，不在于缺少更多模块。

本次没有修改这三份原文。源码判断来自 `source-analysis.md` 对提交 `58c9ada73966711437c5fcd3d8f8fb92f3dca210` 的盘点，不是本次重新检查源码或运行测试。公开实践使用文末的一手资料；Grok Bot 只比较其公开产品行为，不推断其内部数据库、状态机或编排实现。

## 1. 四个角度的判断

| 角度 | 判断 | 最重要的缺口 |
| --- | --- | --- |
| 与公开实践一致性 | 主方向相符；各家没有统一编排模板 | 把会话连续性与提示词缓存命中绑得过紧；协作模式尚未明确到具体场景 |
| 与产品一致性 | 核心概念覆盖较好，部分关键路径尚未闭合 | 忙碌 Agent 如何被不打断地查询；暂停与替换；秘书解释原方案；首个基线的建立 |
| 作为接口和模块 DAG 的输入 | 可产出候选接口，不能据此直接冻结 | 身份关系、状态机、失败语义、统一准入位置及依赖证据不完整 |
| 对既有源码的重构合理性 | 复用既有 Kernel、账本和查询系统是合理方向 | 仍有错误的现状签名；未明确全部生产启动路径；长期运行的 I/O 风险未进入最小改动集 |

“低分辨率架构地图”不必写完所有字段。它必须确定跨模块责任和不可兼容的选择，并链接到唯一的接口规格；不能把这些留给每个模块的实现者分别猜测。

## 2. 与 OpenAI、Claude、Grok Bot、Cursor 的实践比较

### 2.1 相符之处与适用边界

| 来源 | 可核实的实践 | 本架构对应设计 | 审查判断 |
| --- | --- | --- | --- |
| OpenAI Agents SDK [W1] | 允许模型编排与代码编排组合；区分由主 Agent 调用专家和转交当前会话控制权 | PlanCompiler 提案，ControlEngine 确定性受理，DispatchEngine 执行 | 相符；需要进一步区分“咨询专家”“交付任务”“转交控制权” |
| OpenAI Codex App Server [W2] | 持久 Thread 包含多次 Turn；结构化事件支持恢复界面和双向交互 | AgentInstance / Session / Run 分离，Kernel 负责执行记录 | 相符；缺少完整的运行中控制与消息投递契约，不能只规定恢复后的结果枚举 |
| OpenAI Harness Engineering [W3] | 版本化知识、渐进读取、机械检查模块边界 | 图索引、来源引用、版本 pin、依赖检查 | 相符；当前机械检查范围小于文档所声称的保障范围 |
| Anthropic Research [W4] | 主 Agent 分解并行调查，明确子任务边界，回收有界结果；强调协调与 Token 开销 | 主协调者、有界委托、产物引用、按需咨询 | 相符；并行研究的收益不能直接外推到强耦合代码修改 |
| Claude Code Agent Teams [W5] | 独立上下文、共享任务、成员直接通信和直接人工介入 | 定向邮箱、任务图、统一侧栏、子 Session | 相符；需要队列、忙闲、唤醒、超时和消息与任务的语义区分 |
| Anthropic 长任务与上下文工程 [W6][W7] | 用持久进度、文件与压缩跨上下文继续工作，按需读取工具材料 | 默认延续、按需取材、换手保留来源、ContextCompiler 收窄 | 相符；持续工作并不要求所有旧上下文或旧缓存始终保留 |
| Grok Bot [W8][W9] | 持久角色、异步消息唤醒、直接改变正在进行的工作；建议交付阶段有明确负责人 | 长期身份、按模块找负责人、定向消息、人工介入 | 产品形态接近；这不能证明它也采用本架构的 Ledger、CAS、Baseline 或图模型 |
| Cursor 规模化实验 [W10] | 分开 Planner 和 Worker；该实验减少 Worker 间协调，并发现额外集成角色可能造成瓶颈 | 单正式协调者，允许多 Agent 研究和审查 | 部分相符；不能据此声称“所有执行者互相发消息”或“固定集成 Agent”是行业统一做法 |

**建议保留的核心：**持久身份与有限会话分离；语义提案与确定性状态推进分离；完成声明不能直接完成任务；模块信息按需检索；普通消息无需重建完整上下文；Kernel 拥有模型循环和执行恢复。

### 2.2 不必照抄各家的地方

本产品面向单用户、单机、可交互的长期项目管理，首版坚持同一 checkout 一个 Writer 是合理边界。它允许并行调查和审查，但不会因此获得多 Writer 的修改吞吐量。这是产品取舍，不是不符合前沿实践。

建议把协作规则写为：有明确结果的子任务走委托；需要模块背景或接口意见时走咨询；存在真实分歧时做有结束条件的讨论。源码依赖边只提供咨询候选，不应自动产生“每条依赖都询问一次”的消息流。否则图越完整，通信成本越高。

秘书、参谋、协调者是职责，不必全部成为固定独立 Agent。独立审查有价值，但没有必要让所有消息串行经过秘书、参谋、协调者、集成者、Reviewer 五层。

### 2.3 必须修改的成本推理

定位：PRODUCT §7.5、§9.2；ARCHITECTURE §4.3、§8 #18/#25。

文档把“前缀一变，复用就失效”“压缩后不能保留可复用前缀就是亏的”写得过强。应区分：

1. **业务复用**：身份、责任、历史成果、关键理由仍然可用。
2. **会话复用**：Kernel 能继续原 Session。
3. **本地制品复用**：避免重复读取、解析和装配。
4. **模型提示词缓存命中**：取决于实际请求、缓存规则及有效期。

这四件事有关联，但不能互相推出。Claude 官方缓存文档明确要求缓存段精确匹配，并有缓存有效期及配置条件 [W11]。同一 Session 不保证命中；新 Session 也不必然失去可共享的稳定前缀。

压缩应尽量保持系统规则、工具定义和角色指令的稳定部分；历史段缩短后可能需要重新写入缓存。这个代价需要核算，不能作为禁止压缩的理由。按产品给定价格举一个仅比较单次输入的算例：100 万 Token 全命中是 0.02 元，1 万 Token 全未命中是 0.01 元。后者尚未计压缩调用和后续收益，但已经说明“命中率更高”不等于“总费用更低”。

建议改成：**连续复用为默认；在满足质量、授权、容量和恢复要求后，比较整个任务的费用与延迟。允许有依据地牺牲一次命中。** 记录模型输入、缓存读写、输出、压缩、咨询次数、准备时间和恢复成本。产品给定的 50 倍价差保留为指定条件下的参数，不外推到所有提供方。

本架构并不需要为此建设复杂的自动上下文优化器。首版保留显式压缩与归档，补齐观测和比较口径即可。

## 3. 产品符合度：真正没有闭合的路径

### 3.1 已定的产品选择被架构重新开放

| 定位 | 问题 | 最小修改 |
| --- | --- | --- |
| PRODUCT §7.1、D-7；ARCH §4.1 创建、§4.2 产生 | 产品已明确产生、拆解、归档等触发，架构仍用旧材料标“非人确认” | 抄回最新产品触发；仅保留实体字段、事务边界等工程待决项 |
| PRODUCT §4、§5.6、§8；ARCH §4.1 挂起恢复、U6/L-3 | 后文已经把 pause 收回首批，前文仍保留“首批不配”的旧建议 | 删除相互冲突的有效描述；只在历史备注保留旧方案 |
| PRODUCT §7.2.7 与 §12 P-2 | 产品自身一处称图权威未决，后一处称已决 | 明确 §12 的裁决覆盖前文旧段，不让接口设计者任选 |
| ARCH §9.2 与 §11-U1 | 同一模块在一处“已定”，另一处“待裁决” | 每项保留一个当前状态：已定、建议待审、或未定义 |

已知问题登记不等于问题已解决。新文档应让读者只找到一条当前规则。

### 3.2 忙碌的模块 Agent 如何在不被打断时回答

定位：PRODUCT §4.3–4.4、§5.4；ARCH §5.3、§6.2.1、§8 #15。

目前链路是“找到负责人→发消息→在原 Session 追加”，同时规定同一 Session 一个活跃 Run、新要求默认排队。若 Worker 正在执行长测试或修改，查询可能只能排队；若插入当前 Run，又可能打断它。

应明确三种路径：

| 场景 | 建议行为 |
| --- | --- |
| 查进度、阻塞、已接受决定 | 直接读持久状态和投影，返回来源及更新时间 |
| 需要解释，负责人空闲 | 续用其 Session，通过已有派发路径运行 |
| 需要解释，负责人忙碌 | 使用已有只读查询能力／子 Session，读取已落盘记录与有限来源；给原 Agent 的咨询异步等待 |

未知信息仍可答“缺少什么、正在等谁”。不可假装查询副本已经看到原 Worker 尚未落盘的内部状态。这里可以复用既有 QueryRun，不需要新增问答模块。

### 3.3 暂停、取消、替换和接管不能只靠能力布尔值

定位：ARCH §4.1、U5/U6/U7、L-3；PRODUCT §5.5–5.6。

必须区分“已受理暂停请求”和“已经停止写入”。最小协议要说明：请求对象、目标 revision、确认边界、在途工具处理、暂停结果、工作前沿和恢复方式。超时或失联应进入待核对状态，不能自动当作成功暂停。

“取消当前 Run，然后另开 Run 接续”可以成为实现选项，但只有义务保留、旧 Writer 已停止、外部结果已核对，才能实现产品要求的暂停语义。仅把取消按钮改名为暂停不成立。

建议首版保持租约绑定 Run：后继 Run 重新获取租约；不能仅凭超时就把写权交出去。无需为了稳定 Agent 身份改成长驻 Session 持有写锁。

### 3.4 跨模块工作包缺少明确的责任契约

定位：PRODUCT §7.10、D-10；ARCH §5.2、§5.4、U4/U11。

架构重点写了 Task→moduleId 和 module→Agent，但产品要求的是三个不同范围：长期专业责任、本次交付责任、执行资源范围。

一个跨模块工作包要有唯一交付负责人；其他模块负责人提供意见；实际 Writer 由资源约束决定。不能按模块数自动生成同等数量的执行任务和主负责人。

建议在任务／参与关系契约中明确交付 owner、关联模块、协作角色、结果回流位置以及负责人替换规则。Task→模块的字段可以对探索任务为空，但需要表达“尚未判定／不适用”，不能把缺字段当作不受任何模块影响。

### 3.5 秘书解释方案的链路没有进入关键交互

定位：PRODUCT §5.1、§7.7；ARCH §2 HumanCollaboration/PlanCompiler、§7.4。

架构只列四条 Session 与取材交互，未交代打开应用恢复秘书、追问已有方案、确认方案的最小路径。结果可能出现“为什么这么设计”又触发一次 `requestInitial`，生成新方案而非解释旧方案。

最低需要：方案的稳定引用与版本、所用来源、未决项、解释 Session 的关联；解释和修订是不同操作；确认必须绑定具体方案版本；确认时版本已变化则不能静默接受旧内容。秘书恢复入口和 Agent 侧栏读接口可以先做薄实现，不应一并后置到 UI 完整改版。

### 3.6 首个架构基线的形成仍有启动循环风险

定位：ARCH §5.1、§5.5、§8 #12/#13/#21、L-5；PRODUCT §5.2–5.3。

L-5 已正确允许只读草案，但没有完成其类型和准入路径。既有正式图要求 `planRef + baselinePin`，而新项目还没有 baseline；既有演进又要求与当前默认 baseline 对齐。不能给草案虚构 baseline 来满足类型。

应分开两条路径：

| 路径 | 必要语义 |
| --- | --- |
| 首次建立 | Workspace／来源快照→只读探索→草案及未知项→人确认→首次安装与激活 |
| 后续演进 | 已有基线→候选变更→影响／迁移检查→决定→CAS 激活 |

正式图仍绑定基线。探索草案有自己的来源约束，不参与漂移裁决。首次激活不要求一个不存在的“旧 baseline”。

### 3.7 技能、记忆和交互承诺还缺少归属

PRODUCT §7.6 对 skill/prompt 的来源、版本、适用范围、真实任务效果与回退有要求；ARCH 主要只落到 RoleSpec 和 ArtifactVault。应说明资产如何被选择、Run 如何记录版本、修改影响哪些 Session、怎样撤回，而不是只写“装入 Skill”。不必新增技能市场。

同样，PRODUCT §7.8 的记忆查看、纠正、移除，应定位到既有 HumanMemory／历史记录路径；区分停止未来使用与删除审计事实。此项可以分阶段交付，但应明确范围。

产品中“skill 决定准不准”也应收紧：skill 表达行为规范；真实工具授权和沙箱负责执行边界。仅靠提示词不能形成可验证的权限控制。现有 Kernel 足以作为落点，不需叠加新的细粒度审批体系。

## 4. 作为模块接口和 DAG 生成依据的不足

### 4.1 最关键的缺口：旧 Session 中的材料如何重新准入

定位：ARCH §6.2.1、§7.4 交互 1/2、§8 #17；SOURCE §5.9。

文档要求普通消息直接追加、原 Session 恢复成功后直接续用，同时要求每次进入模型输入的实际材料满足当前授权。当前方案只明确了新消息检查和必要时的 ContextCompiler，没有明确**继承历史**的检查点。

反例：Run A 获准读取材料 X，X 已进入原 Session；之后撤权；Run B 恢复此 Session。新消息本身完全合规，但模型继续看到的历史仍含 X，甚至含基于 X 的摘要。

因此仅检查新消息不够。“不再重新编译 Context”也不等于“历史可以不经过准入”。建议：

1. WorkerRuntime 在模型请求前对接既有 Control 准入路径，区分新材料和继承材料。
2. 未变的不可变内容复用；基于来源／授权变化定位受影响引用，避免每轮读全部正文。
3. 发生撤权时检查历史与衍生摘要的可用性；Kernel 不能安全排除时，在新 Session 中用当前允许材料接续。
4. 缓存、摘要或旧 Session 都不能恢复已撤销的授权。

这需要一份跨模块契约，不需要一个新的“安全编译器”模块。正常路径是轻量检查；真正失效时才重构材料。

### 4.2 Session 决策结果不完整，事实生产者的规则也冲突

定位：ARCH §6.1、L-1、§6.2.3、L-2。

候选 `decide → reuse_deferred / reuse_selected / needs_material / rejected` 没有明确表达没有可复用 Session 时如何新建、已忙碌时如何排队、何时只读分叉、返回 `needs_material` 后谁解除等待。`propose(action)` 可以承担一部分，但两接口间的协议尚未定义。

此外，L-1 把 `selectedRefs/gaps/manifest` 的唯一生产者定为 ContextCompiler；§6.2.3 又要求按需工具读取后把实际消费写进 manifest，且这些路径不经过 Compiler。两者需要分开：

| 记录 | 建议 owner | 含义 |
| --- | --- | --- |
| 初始化选材清单 | ContextCompiler | 本次编译选择了哪些材料，哪些缺失 |
| 运行中实际读取记录 | Kernel／WorkerRuntime 记录，平台保存引用 | 工具实际打开了什么、哪次调用消费了什么 |
| 当前可用历史材料索引 | 由已发生读取及失效信息形成的可重建视图 | 下一次模型输入允许继续使用什么 |

不要让初始化清单冒充整个 Session 的消费历史，也不要为了维护清单让每次读取重新经过 Compiler。

### 4.3 必须先确定的实体关系

现有 #15 只确定 Session→一个 Agent、Session→多个 Run。还需要确定以下关系，否则接口生成会分叉：

- AgentInstance 的稳定 ID 不能继续由 `(work, run)` 派生。
- Work 是长期责任，Session 是执行历史载体；复用 Session 后仍可创建新的 Run。
- 一个 Session 如何关联前后不同 Work；关联变化时怎样复核授权与来源。
- 同一 Agent 的多个 Session 中，哪个可恢复、哪个只读、哪个已归档。
- Kernel Session ID 与平台 Session 引用的映射，谁创建，失败时如何对账。
- 平台 Session 元数据与 Kernel 记录各自是哪些事实的权威。

建议用一页实体关系表和一页转换表收口，无需新增一整套管理框架。

### 4.4 消息、任务与启动的交互不能停留在成功路径

ARCH §7.4 有调用方、输入输出、状态归属，是进步。但至少应补以下结果：

| 事件 | 必须决定的行为 |
| --- | --- |
| 收件人忙碌／归档／失联 | 排队、恢复、分叉还是明确不可投递 |
| 消息落盘后进程崩溃 | 从什么游标继续，何处去重 |
| 收到重复完成回报 | 消息可重放，任务状态不得重复推进 |
| 旧计划消息晚到 | 仍可保存为历史，但不得执行已失效动作 |
| 两个调度尝试选择同一 Session | 选择不是占用；Control 原子受理才取得执行权 |
| 双方互相等待 | 有限等待、超时／阻塞反馈，不能因模块 DAG 无环就假定通信不会死锁 |
| 投影落后 | 读返回游标／更新时间；派发以 canonical 事实复核 |

继续复用现有 outbox、Delivery、Wait、游标和幂等机制即可。不需要引入消息中间件，也不必承诺外部副作用的 exactly-once。

### 4.5 “唯一派发入口”没有和源码对齐

定位：ARCH §2/§3/§7.4；SOURCE §2.4 D-14、§5.1、附录 A-09。

源码分析列出普通／协作、Reviewer、Handoff 三条生产 `runtime.start` 路径。架构仍把 `DispatchEngine.drive` 写成现有唯一入口。

需明确选择：统一公开 drive，再由内部按运行类型分派；或保留多个入口，但共用不可绕过的准入、Session 占用、授权和租约逻辑。两者都可能合理，必须声明目标并给出现有调用点迁移清单。

不能只把普通 Worker 改成 Session 复用，让 Reviewer 或 Handoff 留在旧语义。只读查询、探索和审阅类运行同样需要盘点能力与记录映射，但不必强行都拥有写任务的全部门禁。

### 4.6 I1–I12 不是可直接生成代码的接口表

| 定位 | 缺口 | 修改方向 |
| --- | --- | --- |
| §7.1 I4 | `submit` 目前只接 CreateGoal，源码实际有大量命名方法 | 明确采用命名命令端口，还是迁移到统一命令入口；不要由生成模型偷偷补总线 |
| §7.1 I1/I3 | 模块名被当作不存在的同名接口 | 列出实际 Port、owner、消费者、替换关系；不要求一个模块只能有一个接口 |
| §7.1 I7/I10/I12 | 返回形状及参数与源码摘要不符 | 标为“现状”与“目标候选”两列，避免把目标伪装为已有契约 |
| §7.1 总结 | “12 个 Module 接口全部变化”与表格不一一对应 | I9 是 RoleSpec/RoleBinding 领域类型，不是独立 Module；WorkspaceReader 没有对应行，需要补齐 |
| §7.2 A5；SOURCE §6.3 | 架构仍说现有缓存先校验 revision；源码分析明确否定 | 采用源码分析中的当前实现证据，避免复制旧结论 |
| §6.2.2 L3；SOURCE §6.4 | 宣称完整版本化引用，源码却有 digest 填 planId 或缺失 | 先确定 digest 与 revision 的不同含义、旧数据兼容和拒绝规则 |

“模块受到影响”不意味着每个方法签名都要改。保留核心完成策略、Work 身份、通用存储方法及可兼容的查询接口，有助于控制重构范围。

每个关键接口最少要有：owner／消费者、输入输出、前置条件、授权与版本依据、写入事实及原子边界、幂等／并发、失败／重试／取消、容量、兼容策略。字段细节写在接口文档，架构地图链接它即可。

### 4.7 DAG 无环，但验证目标尚不清楚

本次直接解析 ARCH §3 中的 Module 箭头：**38 条 Module 边，图无环**。一组合法的“依赖先就绪”拓扑顺序是：

1. StateLedger、WorkspaceReader
2. ControlEngine
3. ReadModelIndex
4. ArtifactVault、AgentLifecycle
5. ContextCompiler
6. PlanCompiler、VerificationEngine、WorkerRuntime、ArchitectureReconciler
7. DispatchEngine
8. HumanCollaboration

同层表示一种可行层次，并非完整开发顺序。原 §3.1 的文字把 PlanCompiler 放在 DispatchEngine 之后，与 `DispatchEngine → PlanCompiler` 不符，应修正。

更关键的是，目前混合了三种边：

| 边 | 应证明什么 |
| --- | --- |
| 模块允许依赖另一模块的接口 | 架构规则；每边有具体端口和调用理由 |
| 文件实际 import 另一模块实现／类型 | 源码事实；由静态扫描检查 |
| Host 把某个 provider 注入 consumer | 生产装配事实；由组合根和装配验证检查 |

**没有跨模块 import 不代表没有模块逻辑依赖。** 使用共享 Contracts 和 DI 是正常方式，源码分析将“没有 import”直接描述为“源码依赖不成立”需要限定口径。问题是架构同时把图称为源码依赖，又把 import 扫描当成全部边的验证。

建议保留逻辑 Module DAG，同时补端口与装配位置表；实际 import 图作为观测结果。SOURCE §1.8/§2.3 还指出检查器遗漏 vendor、动态导入以及白名单路径的约束，应明确允许的 Kernel 边和例外范围。

§6.3“既有 34 条边一条不删”不宜成为目标约束：外部命令和 HTTP 路由的兼容，并不要求内部依赖永远保留。尤其 ReadModelIndex→ControlEngine 当前有共享 helper 的缘由，PlanCompiler／DispatchEngine 对 ControlEngine 内部 policies 的直引应决定公开窄接口或移动纯函数，而非仅加一条注释。

禁止为了获得漂亮 DAG 把所有逻辑塞进 Contracts；Contracts 中的值和类型也要有归属。也不必为了消除每一条逻辑边增加新模块。

## 5. 从源码盘点看：哪些重构值得做，哪些判断要收紧

### 5.1 主要方向值得保留

SOURCE §4、§5、§6 支持下列改动：把稳定 Agent 与每次 Run 的身份分开；让 Session 能被明确选择；接入真实 Kernel 恢复能力；ContextCompiler 不再在每次派发全量取料；按消费者保留必要差异；接真实图来源；增加 Agent/Session 关联和可查询状态。

已有 WorkContext、完成归约、CAS／幂等、账本、版本化引用、投影都应优先复用。没有证据支持为了生命周期把这几部分整体重写。

AgentLifecycle 独立为模块是可接受选择，但“放 ControlEngine 内就失去独立可验证性”并不成立：内部纯策略也可以独立测试。新增模块的理由应是职责和变化边界，而非文件数量或可测试性口号。

### 5.2 当前最小改动集漏掉了长期运行的成本链

下表是源码盘点推导的风险，不是本次性能实测。上限不等于每次都会达到，真实严重度仍应通过冻结任务的观测确认。

| 风险及来源 | 对产品的影响 | 建议落点 |
| --- | --- | --- |
| `project-source-index.ts` 分页 query 重复捕获工作区，SOURCE P1/P2 | 查图、探索和审查可能被全树重复读取拖慢 | WorkspaceReader：一次不可变捕获对应多页读取；变更检测失败时显式重试／标 stale |
| `run-facts.ts::admittedDeliveryPins` 在请求准入路径扫大量历史事件，P9 | 即使取消 ContextCompiler 装配，模型调用前仍可能慢 | ControlEngine + 现有索引：按 Run／Delivery 定位，带版本复核 |
| `runtime-observation-journal.ts::save` 每事件重写累计记录并同步落盘，P16/P17 | 长 Run 写入量可能近似二次增长，轮询又重复克隆 | 优先使用 Kernel 持久事件／检查点；平台保留必要引用和进度。若确需补日志，也不要复制一套完整 transcript |
| `reviewRecords()` 被每事件调用并全读审阅投影，P13/P14 | Session、消息和事件增多后投影延迟放大 | ReadModelIndex：只在相关事件更新受影响记录，复用批内结果 |
| 状态查询反复触发 currentness 与全工作区快照，P20–P22 | 用户“随时问状态”的交互变慢 | 分开轻量状态读取与明确要求的新鲜源码核验；返回 freshness，按需验证具体来源 |
| `WORK_CONTEXT_MAX_RUN_LINKS = 32`，SOURCE §4.1/§6.3 | 连续复用后可能触及长期责任记录的容量上限 | 保持历史可定位的分页或范围引用，不把全部链接塞进单条快照 |

这些不是“以后有空再优化”的同一类事项。**模型调用准入、运行日志增长和状态查询属于产品核心路径，应在真实连续任务验收前验证。** 大文件拆分、界面改版、疑似死代码删除则可以按依赖分阶段进行。

优化 currentness 时不能简单删掉前后校验。需要用来源快照／版本化制品和明确的失效规则维持原语义；文件观察器也不应被当作永不漏报的事实权威。

### 5.3 源码分析本身不能当作全部设计结论

| 源码分析表述 | 审查意见 |
| --- | --- |
| §5.1 把复用既有载体与“新建 Run”对立，提到“不再产生新 Run” | 不应照抄。PRODUCT 明确 Session 可以包含多 Run；续用历史和记录新执行并不冲突 |
| §5.6 把 Reviewer 独立性从“必须不同”扩展为可追溯 | 追溯不能替代独立性；复用 Reviewer Session 时还要检查其是否已参与被审对象的实现及是否接触会造成偏置的历史 |
| §5.7 要对齐演进后“新 baseline” | 已接受 Plan pin 不应自动漂移；仅新计划或显式迁移后的计划切换，旧 Plan 对账仍使用自身 pin |
| §6.1 “改 I1 实际要同时改 12 处端口” | 需要影响分析，不必全部同步改签名；可从真实连续执行路径开始，内部复用共同逻辑 |
| §4.4 “内核已具备能力，平台未接线” | 可证明存在公开导出和恢复接入线索；不能仅据此断言暂停、压缩、撤权后恢复等目标语义都已完整可用 |
| 覆盖声明写“全量覆盖”，末尾又列未读或仅读符号的文件 | 按具体未覆盖清单限制结论；尤其内核源码、部分通信与投影实现需在落接口前补查 |
| 性能章节引用历史毫秒数、77.48% 命中率 | 本次不复述为当前实测。PRODUCT 已排除不可复现的旧缓存基线，应以冻结实验数据为准 |

SOURCE §7 中个别句子仍把本地重复装配代价直接乘上 50 倍，和其 §7.2 的澄清不一致。本地 I/O 影响时间和资源；只有改变实际模型输入与命中情况，才改变相应 Token 账单。

### 5.4 迁移不能只写新接口

当前数据中的 Agent 由 `(work, run)` 推导。引入稳定 Agent 后必须交代历史身份如何仍能查到，不能把过去多个主体无证据地合并成一个“始终存在的 Agent”。

建议最小迁移规则：旧事件语义不变；新运行使用显式的新关联；需要映射的历史关系记录来源；老 Session 缺乏可恢复记录时明确只支持查询或有界交接；投影能重建；升级失败能继续读取旧数据。SchemaVersion、切换点和回滚方式写在接口／重构计划中。

Kernel 原始记录落盘与平台正式状态提交也不是同一个事务。先有可定位的 Kernel 结果，再幂等地接纳为平台事实；遇到中断按事件 ID／游标对账，副作用未知就核对，不自动重跑。无需增加第二套事件框架。

## 6. 建议的修改次序

### 第一批：冻结接口前必须收口

| 次序 | 输出 | 验收条件 |
| --- | --- | --- |
| 1 | 清理产品已决项与架构旧待决项 | 同一问题只保留一条当前决定；pause、图权威、生命周期触发不再互相冲突 |
| 2 | 身份与生命周期表 | Agent／Work／Session／Run 基数、状态转换和 Kernel 映射可以唯一解释 |
| 3 | 统一运行准入与控制契约 | 普通、Reviewer、Handoff、查询／探索的入口和守卫可追踪；忙碌、暂停、撤权、失联有结果 |
| 4 | 取材与实际消费记录契约 | 默认追加；继承历史可重新准入；初始化 manifest 与运行读取记录不混淆 |
| 5 | 首基线与图关联契约 | 无 baseline 的探索能启动；首次安装与演进分开；工作包 owner 和模块关系可查询 |
| 6 | 模块端口与边表 | 每条逻辑依赖有 Port、owner、消费者、装配点及检查方式；真实接口签名与源码对齐 |

### 第二批：首条真实连续执行路径

先实现并验证：同一 Agent／Session 内至少两次 Run，期间有消息、只读状态查询、一次暂停恢复或明确能力降级；记录来源、费用、准备时间和结果。再覆盖归档后重新启用、Reviewer、Handoff 及局部目标变化。

真实路径验收至少包括：旧材料撤权后继续、旧 Writer 停止未确认、消息落盘后崩溃、Kernel 记录已落盘但平台事实未提交、计划变更后的迟到结果、长期 Work 超过现有链接上限。其目的都是验证上述跨模块契约，而不是再加一套测试框架。

同步检查热路径：不随每条消息扫全工作区、不随每次模型请求扫全历史、不随每条日志重写整段历史。是否达标以实际调用计数和耗时为准，不仅检查模块名或 API 返回值。

### 第三批：扩展与清理

随后完善图交互、模板体验、各消费用途的取材端口复用，分拆大文件并清理确认的重复逻辑。疑似死代码、旧前端和 fixture 依赖必须逐项确认使用情况；不把统计疑似比例当成可直接删除的比例。

**下一步最合适的产物是一小组跨模块契约表，随后用真实调用链复核。继续加模块、加不变量或扩写历史说明，不能替代这一步。**

## 7. 公开资料

下列链接均于本次审查访问。网页行为与接口会变化；这里只引用与审查有关的局部事实。

- [W1 — OpenAI Agents SDK: Agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [W2 — OpenAI: Unlocking the Codex harness / App Server](https://openai.com/index/unlocking-the-codex-harness/)
- [W3 — OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- [W4 — Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [W5 — Claude Code: Orchestrate teams of sessions](https://code.claude.com/docs/en/agent-teams)
- [W6 — Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [W7 — Anthropic: Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [W8 — Grok Bot: Create and manage Bots](https://docs.x.ai/grok-bot/bots)
- [W9 — Grok Bot: Message and collaborate](https://docs.x.ai/grok-bot/chat-and-collaboration)
- [W10 — Cursor: Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents)
- [W11 — Claude Platform: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

补充查阅了 [OpenAI Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)。它提供工作区复用、并发限制、恢复与执行协议的参考；不应将其 issue 驱动流程直接当成本产品的交互与状态设计。

## 8. 原文与源码路径口径

输入文档路径：

- `/agent-platform/ARCHITECTURE.md`
- `/agent-platform/PRODUCT.md`
- `/agent-platform/source-analysis.md`

源码分析记录的仓库根：`/home/hyh001/projects/coding-platform/coding-platform`。本文出现的 `src/...` 均相对此根，属于源码分析给出的定位，并非本次可访问的源码副本。

重点源码定位：

| 完整路径 | 用途 |
| --- | --- |
| `/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/dispatch-engine.ts` | 普通派发与 runtime.start |
| `/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/reviewer-dispatch.ts` | Reviewer 启动 |
| `/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/handoff/handoff-drive.ts` | Handoff 启动 |
| `/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/unconfigured-capabilities.ts` | 当前未接通的能力 |
| `/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/observed-model-run.ts` | Kernel 调用接线 |
| `/home/hyh001/projects/coding-platform/coding-platform/src/data/context-compiler/runtime-context.ts` | 最终输入组装及变化字段 |
| `/home/hyh001/projects/coding-platform/coding-platform/src/data/artifact-vault/runtime-observation-journal.ts` | 累计运行记录持久化 |
| `/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/run-facts.ts` | 运行事实与请求准入 |
| `/home/hyh001/projects/coding-platform/coding-platform/src/data/workspace-reader/project-source-index.ts` | 图／源码查询的捕获成本 |
| `/home/hyh001/projects/coding-platform/coding-platform/scripts/check-module-boundaries.mjs` | 依赖检查覆盖范围 |

