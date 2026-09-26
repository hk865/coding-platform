# AgentLifecycle Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Control
module: AgentLifecycle
code_dir: coding-platform/src/control/agent-lifecycle/（规划；**当前无目录、无契约**）
contract_state: 【设计新增】proposed（无实现、无契约、无目录）
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> Agent/Session 生命周期**决策与提案**：决定是否复用、是否产生、如何拆解、是否压缩、是否归档、能否重新启用；决定用哪个角色配置、创建／解析哪条 Session、关联哪些必要任务。它**只输出决策与提案**，不写 canonical、不派发、不取材、不读源码正文、不执行压缩、不裁决完成。
> 分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文；跨模块切分见 `docs/refactor/modules/ownership-map.md`。

## 1. 职责

**负责**

**内部责任与共用实现。** 本模块只形成生命周期选择与处置提案；候选筛选、理由生成和动作判据可共用同一决策支持，但创建/复用选择与压缩/归档提案保留不同约束。实施时先清点 ControlEngine/DispatchEngine 中确实存在的重复选择与身份推导：属于生命周期选择的部分迁入本模块后退出旧路径；已有角色绑定守卫、正式身份登记与提交复核保留原 owner。尚未存在的 Session 选择按新能力实现，不假称已删除旧实现；本模块不能只做包装层，且当前尚无源码实现。

- **派发前决策**："用哪个角色配置、创建还是复用哪条 Session、关联哪些必要任务"，产出**可解释**的决策给 DispatchEngine（架构稿 §6.1「它做什么」1／§4.1 阶段 1／§3.2）。【设计新增】
- **复用范围作为推荐线索**：复用哪段工作、推荐的来源范围与检索入口、预算与触发原因；**范围是提示不是白名单**，具体选了哪些材料由 ContextCompiler 产出（§6.1 边界行／L-1）。【设计新增】
- **容量决策**：回答 `decision/02` C10 的问题——**压缩还是更换 Session**（§6.1「它做什么」2）。【设计新增】
- **上下文处置选择**：在**延续／压缩／重组／归档**中选择（§4.7）。判据是功能差别：任务未完成、历史决策与状态仍起作用 → 压缩；目标变了、过去上下文不再适用、不如直接基于当下文件状态 → 重组；两张图显示后续工作与已有上下文相关 → 延续（**默认动作**）；退出日常使用 → 归档。**例外必须写明**：任务未变但执行已持续混乱、重复错误，或多次压缩后质量下降，也可重组。【设计新增】
  - **归档的前提（`docs/PRODUCT.md` §7.1 动作表「归档」行）**：**没有未交接的活跃义务**，且近期不再需要参与，才可归档。三种情况分别处理：**仍有活跃义务** → 先办交接，提案阶段就带上义务处置依据；**已交接** → 义务有接收方、处置依据随提案提交；**无义务** → 直接可归档。**Lifecycle 提案携带义务处置依据，ControlEngine 受理时复核；存在未完成交接则不能正式归档**。归档**不等于删除记录**：身份与可检索记录保留（#19／架构稿 §4.6）。【设计新增】
- **四动作提案**：把**产生／拆解／压缩／归档**作为**提案**提交 ControlEngine，并给出进入／退出条件的判据与证据引用（§6.1「它做什么」3／§4.2／#1）。【设计新增】
- **目标变更时的复用/处置判定**：目标变更链为「PlanCompiler 输出影响与未知项 → ControlEngine 受理并确定停派状态与控制意图 → DispatchEngine／WorkerRuntime 执行控制交接并回报 → ControlEngine 归约，迟到结果重新检查 → HumanCollaboration 展示未完成处置」；本模块在该链上只提供**延续／压缩／重组／归档的处置决策与复用建议**，**不接管停派、不取消 Runtime**（`docs/PRODUCT.md` §5.5）。【设计新增】
- **重新启用判定**：既有角色配置与责任范围是否仍合适、原 Session 的上下文是否适用、是否确需新 Session 并保留交接来源（§6.1「它做什么」4／§4.2「重新启用」行）。与"创建"的分界：**重新启用＝优先复用既有 Session／角色配置**；只有不存在合适 Session 时才走"创建"。【设计新增】
- **挂起·恢复中"恢复哪条 Session"的决策**：恢复入口与后继 Run 属 DispatchEngine，Kernel 负责执行停止／恢复点，本模块只做"恢复哪条"的决策与提案（§4.1 阶段 4／§7.4 交互 2）。【设计新增】
- **Session 创建／解析的决策侧**：决定"创建还是复用哪条 Session、创建哪种配置的 Session"；**创建／打开动作不在本模块执行**（见下方推导结论）（§4.1 阶段 1 分界行／§7.4 交互 3）。【设计新增】
- **只读决策依据**：从 StateLedger 读 canonical 生命周期事实、从 ReadModelIndex 读忙闲与角色／任务视图（§3.2 新增边）。【设计新增】
- **跨项目复用显式拒绝**：首版不做；跨项目请求**显式拒绝并说明原因，不静默降级**；跨项目检索后置（§4.3 第 6 条／#27）。【设计新增】
- **可解释性输出**：说明为何选中该角色配置与 Session、复用了哪些**推荐范围**、哪些因过期或撤权被排除（§4.3 第 7 条）。【设计新增】
- **成本口径**：**连续复用为默认**；在满足质量、授权、容量与恢复要求后比较**整个任务的费用与延迟**，**允许有依据地牺牲一次命中**；记录模型输入、缓存读写、输出、压缩、咨询次数、准备时间与恢复成本的口径按 U12 指标表（§4.3 第 9 条／#25）。**不得**以"固定常驻 Agent 数量"或新增进程管理器代替需求分析（§4.3 第 8 条）。【设计新增】
- **并行口径（澄清，不是新增能力）**：**同一角色可并行多条独立 Session**（#15）；本模块的决策只受两条保留的并发限制约束——① 同一 Session 只允许一个拥有执行控制权的活跃 Run；② 同一共享工作区的写入沿用唯一 Writer 租约（§4.5「基数与并发」）。

**硬约束（架构稿 §4.3；不变量化见 §8 #18，决策时必须携带）**

1. **先落盘再生效**：压缩与归档都是**有记录的写操作**，不是内存里的临时整理。
2. **压缩**不得把推断写成事实、不得丢弃关键的不确定性、不得把历史授权带入新任务；应尽量保持系统规则、工具定义与角色指令的稳定部分，重写缓存的代价要核算，但**不作为禁止压缩的理由**。
3. **复用不得沿用旧授权**：沿用既有 `MaterialAccessGrantV1` 判定，与本 Run 的读写权限正交；**执行端真实权限不能由 prompt 绕过**（#17／L-1）。
4. **四种"复用"不得互相推出**：业务复用／会话复用／本地制品复用／模型提示词缓存命中有关联，但同一 Session 不保证命中，新 Session 也不必然失去可共享的稳定前缀（§4.3 开头）。
5. **归档**是"当前不参与装配"的部分，不是装配要用的稳定前缀；归档省下的存储不能换来更大的输入成本。
6. **跨项目复用首版不做**（见上「跨项目复用显式拒绝」；#27）。

> **Session 创建／打开（由 DAG 推导的结论）**：本模块决策 → **DispatchEngine 在派发收口经 WorkerRuntime 调 Kernel 适配接口创建／打开** → **平台只保存引用与映射**（不复制 Kernel 正文）。依据：本模块**没有** `→ WorkerRuntime` 边，本轮**不新增**该边（§3.1 末条／§6.3）；创建动作属"派发与运行"收口（§7.4 交互 3／§4.1 阶段 1 分界行）。R-5 口径：**映射本身不是幂等**，**"创建请求重试不产生两份会话"才是幂等问题**；映射保持轻量，**不新增跨系统事务框架**（§4.5 R-5／L-2）。
>
> **创建路径口径（A5 收窄）**：普通工作按"**创建／解析 Session → 选择配置 → 关联必要任务 → 启动执行**"进行；本模块**不做身份登记**。只在确需独立责任、并行调查或可寻址通信时，才由 ControlEngine 归约 `registerAgentInstance`／`startWorkParticipation` 一类命令，并按当前生效矩阵 pin 签发绑定（`issueMatrixRoleBinding`，签发不代替守卫）（§4.1 阶段 1 边界）。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| 不写 canonical 状态、**不生成 snapshot/Event** | ControlEngine（归约）＋ StateLedger（原子提交）；不变量 #1／#3／**#16** |
| 不派发、**不建立 Run**、不签发角色绑定 | DispatchEngine（唯一 `drive` 的目标口径；`issueMatrixRoleBinding`） |
| **不取材、不组装 ContextBundle** | ContextCompiler（五类触发点有界选材，§6.2） |
| **不产出 `selectedRefs`／`gaps`／manifest**（L-1 收口）：只输出复用决策与推荐范围 | ContextCompiler（三者的**唯一生产者**） |
| 不读源码正文 | WorkspaceReader（经 ContextCompiler 取用） |
| 不执行压缩、**不调用内核** | WorkerRuntime（能力探测与适配；**如实**返回 `supported`／`unsupported` 并指名缺失能力） |
| 不执行平台归档、不登记归档状态；**归档的正式链路经既有记录落账** | 本模块只**提案**（携带义务处置依据）；`AgentLifecycle 提案 → ControlEngine 归约 → StateLedger → ReadModelIndex 投影`；DispatchEngine 消费正式归档状态以阻止普通派发（架构稿 §4.1 阶段 5／§4.6） |
| 不裁决完成、**不制造 Evidence** | VerificationEngine ＋ ControlEngine（#2／#6） |
| 不创建／打开 Session、不保存 Kernel 正文与检查点 | DispatchEngine 在派发收口经 WorkerRuntime 调 Kernel 适配接口；平台只保存引用与映射（L-2／R-5） |
| 不产出工作卡片／角色名册的投影与查询 | ReadModelIndex（I6；注意既有 `ActiveAgentView` 是按 `(project, goal, task)` 查询，**不是按 `agentId`**） |
| 不新增独立记忆存储或**每角色常驻进程** | `docs/PRODUCT.md` §7.5、§7.15；知识库与记忆只留接口与积累方案、**声明未交付**（§6.4） |
| 不建立通用外部副作用对账系统、复杂自动接管平台或逐工具／子进程停机复查 | WorkerRuntime ＋ Kernel（平台**信任停止契约**，失败如实显示）；平台只处理自己拥有的状态（A4／A6 撤回项） |
| 不新增**身份治理聚合**、不新增逐条材料授权系统、不把"每轮继承历史复核"设为必经门禁 | 治理种类不变（#11）；材料权限沿用既有 `MaterialAccessGrantV1`（#17／L-1 撤回项） |
| 不生成工作分解提案本身 | PlanCompiler（工作分解与提案）；本模块只定"承担角色与复用决策"（§4.2「拆解」） |

## 2. 对外接口

**接口命名口径**：本模块**没有**源码或 `contracts/**` 中的真实标识符（无目录、无契约、无实现），下表**全部**是架构稿 §2／§6.1 的**候选名义名**，标【设计新增】proposed；冻结前不得当作已有 Port 使用（§7.1 注：新增模块无既有接口可改）。

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `decide(request)`（目标候选） | DispatchEngine | 已受理任务、角色/矩阵 pin、候选 Session、忙闲视图、预算与触发原因 → 创建/复用/等待/补料/拒绝的决策及理由 | 不写 canonical；跨项目显式拒绝；恢复能力不足不得声称可复用 | 新增候选、名称与结果集未冻结；旧的选择/身份推导从 DispatchEngine 与 ControlEngine 迁入后删除 |
| `propose(action)`（目标候选） | DispatchEngine／生命周期协调器 | 产生、拆解、压缩、归档、重新启用请求 → 提案或拒绝 | 提案不推进状态；ControlEngine 受理时复核；未完成交接不得正式归档 | 新增候选；与 `decide` 的转换、幂等和重入留待接口契约，不预先冻结完整实现 |

**候选结果集不完整（必须在接口设计时补足，架构稿 §2／§6.1 审阅 §4.2）**

| # | 还须表达什么 | 现状 |
| --- | --- | --- |
| 1 | **没有可复用 Session 时如何创建**：`reuse_deferred` 无法区分"延后派发／等待"与"确认需要新 Session" | 候选值不足以表达；与 `propose(产生)` 的边界未定 |
| 2 | **复用范围作为推荐线索如何交给 ContextCompiler**：以推荐来源范围／检索入口／预算／触发原因表达，经 DispatchEngine 的派发请求转达；**不经本模块产出 `selectedRefs`** | 字段形状未定（L-1：`drive` 的决策结果只带意图与理由，材料清单仍来自 `assemble`） |
| 3 | **何时只读分叉**：收件人忙碌／归档／失联时"排队、恢复、只读分叉，还是明确不可投递"必须与既有 outbox／Delivery／Wait 机制在同一组契约里决定 | 首版只读分叉的判定点未定义（§7.4.1） |
| 4 | **返回 `needs_material` 后由谁解除等待**：缺口由 Control 路径创建短生命周期工作补齐，ContextCompiler **不自行启动 Agent**；补齐后由 ControlEngine 受理、DispatchEngine 重新派发 | 等待与重入的归属未定；本模块不持有等待队列 |

**`decide` 与 `propose` 之间的协议未定**：决定在什么条件下转为提案、由谁触发、以什么身份提交、幂等键与重复提交如何处理、`reuse_deferred`／`needs_material` 的等待与重入、提案被 ControlEngine 拒绝后本模块如何重入——全部属接口参数（§11.4.3 第 1／2 份契约）。

**本次变化方向**：见 §7（此处只写一句指引，细节放第 7 节）。

## 3. 依赖

`allowedModuleDependencies[AgentLifecycle] = { ControlEngine, StateLedger, ReadModelIndex }`——**3 条边，全部本次新增**（`*` 标记）。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| ControlEngine | 【设计新增】生命周期提案受理命令面（精确方法名按 I4 冻结；不是本模块提供的 `propose(action)`） | 把产生／拆解／压缩／归档／重新启用提案交 Control 复核并归约；本模块不写 canonical（#1／#3／#16） | **本次新增** |
| StateLedger | `load(ref)`；`events(query)`（**只读**） | 只读 canonical 生命周期事实：`AgentInstanceV1`、`WorkParticipationV1`、`RoleSpecRevision`／矩阵 pin、`WorkContextBinding`（§3.2 新增边 3） | **本次新增** |
| ReadModelIndex | 既有 `activeAgent`／通信视图；【目标候选】`WorkSessionProjectionPort.query`（I6） | 只读忙闲、当前工作、任务与角色视图，用于判断复用是否可行（§3.2 新增边 4）；整个 AgentLifecycle 消费接线尚未实现 | **本次新增** |

**边界与已知限制**：三条边都**只读或只提案**；本模块**不新增**第 4 条以外的任何依赖边（也不新增 `→ WorkerRuntime` 边，见 §1 推导结论、§3.1 末条）。既有 `ActiveAgentView` 按 `(project, goal, task)` 查询而**不是按 `agentId`**，Session 维度的"忙闲／当前工作"视图需 I6 的投影扩展才可用（§7.1 I6／§11.4.3）。

## 4. 被依赖

反向表（架构稿 §3 依赖 DAG 的反向推导）共 **1 条**边，本次新增。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| DispatchEngine | 【设计新增】`decide(request)`（候选） | 派发前取"用哪个角色配置、创建还是复用哪条 Session、关联哪些必要任务"的决策；派发结果记录**复用决策与其排除理由**。决策**不改变派发权**：唯一派发入口按 §2 的目标口径收口（统一 `drive` 或共用不可绕过的准入与租约逻辑） | 架构稿 §3.2／§7.1 I2／§6.1；改动锚点 `dispatch-engine.ts`、`work-identity.ts`、`role-spec-read.ts`（架构稿 §9.1 DispatchEngine 行） |
| 宿主边（**不计入 38 条**） | —— | 本模块**当前无宿主调用点**（无目录、无装配）；未来装配位置（Host 构造 Adapter 并注入 DispatchEngine）属 架构稿 §9.2 第 4 份契约 | 架构稿 §3.1「三种边必须分开」 |

**没有其他 Module 依赖它**：DAG 中 `AgentLifecycle` 只被 `DispatchEngine` 依赖（§3.1 无环说明），这是新增边不构成环的原因之一。

## 5. 状态归属

**本模块不写状态**：canonical 生命周期事实由 **ControlEngine 归约 ＋ StateLedger 原子提交**（不变量 **#16**）。本模块**拥有的是决策与提案**（非 canonical）。

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| `decide` 结果、复用决策与**推荐范围**、排除理由 | 否（决策，非 canonical） | **AgentLifecycle**（输出给 DispatchEngine；派发结果记录复用决策与理由） | 创建（用哪个配置／哪条 Session／关联哪些任务）；运行（压缩或更换 Session 的判定）；挂起·恢复（恢复哪条 Session 的决策）；销毁＝归档（是否归档的决策） |
| `propose` 提案与其判据、证据引用 | 否（提案） | **AgentLifecycle**（提交 ControlEngine 归约） | 产生／拆解／压缩／归档／重新启用 |
| `AgentInstanceV1`／`WorkParticipationV1`／`RoleBindingRefV1` | 是 | ControlEngine 归约（需要时才登记：`registerAgentInstance` CAS@0／`startWorkParticipation`／`endWorkParticipation`）＋ StateLedger 提交 | 创建／四动作·产生 |
| `RoleSpecRevision`／`ProjectRoleSpecActive`／矩阵 pin | 是 | ControlEngine 治理路径（`role-spec-install`／`role-spec-activate`）；本模块**只读** | 创建 |
| `WorkContextBinding`／`workId` | 是 | ControlEngine（`bindWorkContext`／`linkWorkRun`）；本模块**只读** | 运行／挂起·恢复／重新启用 |
| Session 身份、关联与**平台侧引用／Kernel 映射** | 是（**正式关联**）；Runtime 暂时返回的 Kernel 引用在受理前只是观测 | **平台只保存引用与映射**，正式关联由 **ControlEngine** 归约；Session 正文、执行记录、检查点与压缩日志属 **Kernel**（L-2／R-5／#22） | 创建／挂起·恢复 |
| 压缩记录（正式事实）与 `ExecutionNote` | 正式事实：是；正文：否 | ControlEngine 归约＋StateLedger 提交；执行＝WorkerRuntime／Kernel；正文＝ArtifactVault（不可变、有界 16 KiB、body-first） | 四动作·**压缩** |
| `archived`（四态之一）及其归档事实 | 否（**Session／工作卡片**状态）；事实经既有记录落账 | canonical 归约侧＝ControlEngine（受理时**复核义务处置依据**：存在未完成交接则不能正式归档）；持久＝StateLedger；投影＝ReadModelIndex；本模块只提案 | 销毁＝归档／四动作·归档 |
| 四态 `working`／`standby`／`paused`／`archived` | 否（Session／工作卡片状态） | ReadModelIndex（工作卡片投影，用现有记录与查询生成） | 五阶段／归档·重新启用 |
| `RuntimeRecord`／运行态与能力声明 | 否（运行观测） | WorkerRuntime | 运行／挂起·恢复 |
| `ContextBundle`／`selectedRefs`／`gaps`／manifest | 否 | ContextCompiler（**唯一生产者**） | 初始化／运行／接续／重组 |

**本模块拥有的对象**：只有**决策与提案**——复用决策、推荐范围与排除理由、四动作提案与其进入／退出判据。它们是建议，不是 canonical；生命周期事实一律经 ControlEngine 归约＋StateLedger 提交。

**本模块不拥有的**：Role／Session／Run／Work／Task／Evidence 的任一实体；`AgentInstanceV1`／`WorkParticipationV1` 等 canonical 标识（只读、只提案）；Run、租约与 outbox（DispatchEngine／ControlEngine）；ContextBundle 与 `selectedRefs`／`gaps`／manifest（ContextCompiler）；Kernel Session 正文与检查点（Kernel，平台只存引用）；Evidence 与 verdict（VerificationEngine／ControlEngine）；工作卡片与图查询投影（ReadModelIndex）；源码正文（WorkspaceReader）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化（项目认知初始化）／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另 §4.2 列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**。

## 6. 旧标识去向

**本模块不持有任何旧 Agent／Work 标识，因此没有属于它的迁移写动作**——它是决策方，写入路径唯一在 ControlEngine 归约 ＋ StateLedger 提交（#16）。但它**消费**下列标识，必须按架构稿 §4.5（R-1、标识取舍表）与 架构稿 §9.3（七条最小迁移规则）表态：

- **`AgentInstanceV1.agentInstanceId`**：作为输入的只读标识**保留**（R-1 已定：保留为平台侧标识）；**不要求**为守旧写法继续由 `(work, run)` 派生，**也不把"迁移到稳定新主体"当作强制方向**（架构稿 §9.3 首段）。本模块的复用决策**不得**假设历史实例等同于"始终存在的 Agent"。
- **`WorkParticipationV1.workId`**：`workId` **不先宣布必需**；若仅重复 `taskId` 就合并；**合并前必须确认**：若 `workId` 正在维系**跨 Run 或换手后的连续性**，删除时要把该关系移到任务图或等效既有记录——**不能把"删掉 ID 字段"与"去掉开销"直接画等号**（§4.5 标识取舍表）。在本模块里它只作为"这条参与关系是否还能承担后续工作"的输入。
- **`WorkContextBinding`**：工作维度的跨 Run 身份（"A Run is NOT a work identity"，§4.0）；本模块只读，用于判断复用哪条 Session／哪段工作；**不写、不改写**。
- **`AgentInstanceStatus = "active" | "retired"`（含 `retiredAt`）**：**不扩写**。**撤回"把 `working`／`paused` 等四态强塞进持久 `AgentInstanceStatus`"**——四态描述 **Session／工作卡片**，由 ReadModelIndex 用现有记录与查询生成（§4.6／#19）。本模块**不为 `retired` 新增写路径**，也不把归档等同于设置该字段。
- **旧事件语义不变、旧标识保留可查或提供兼容映射**（架构稿 §9.3 规则 1）；需要映射的历史关系**记录来源**（规则 3）；**老 Session 缺乏可恢复记录时只支持查询或有界交接，不假装可恢复**（规则 4）——本模块的 `decide` 因此**不得**把"存在旧 Session"直接当作"可恢复／可复用"，恢复能力必须以 WorkerRuntime 的**如实**能力声明为准。
- **`RoleSpec`／`RoleBinding` 方向（I9）**：本模块消费的是"可复用的角色／能力配置 ＋ 角色绑定 ＋ 负责范围 ＋ 运行实例轻量标识"；**不默认扩建跨任务长期主体**，也不为它新增身份治理聚合（§7.1 I9／#11）。

## 7. 本次接口变化方向

**新增/复用/迁出或删除。** 新增候选 `decide`/`propose` 及内部共用决策支持；对 ControlEngine/DispatchEngine 中经核实的重复选择与推导，迁移属于生命周期决策的部分并删除等价旧分支，不把正式登记和最终守卫迁入本模块。Session 创建/打开仍由 DispatchEngine 经 WorkerRuntime 执行，canonical 写入仍由 ControlEngine/StateLedger 完成。当前没有目录、契约或实现，以上均为目标而非落地事实。

对应项号：**—（§7.1 注：新增模块，无既有接口可改）** ｜ 接口名：候选 `decide(request)`／`propose(action)`（架构名义名，未冻结）｜ 边动作：**新增**——覆盖 §3 新增 4 条边的**全部 4 条**（1 条入边 `DispatchEngine → AgentLifecycle`；3 条出边 `AgentLifecycle → ControlEngine`／`→ StateLedger`／`→ ReadModelIndex`），**不新增这 4 条以外的边**（也不新增 `→ WorkerRuntime` 边）｜ 理由：生命周期决策今天**没有任何 Module 拥有**（U1 已定为新增本模块，理由是职责与变化边界），且决策必须与 canonical 写入分离（#16）｜ 不变量：**#1／#3／#16／#17／#18／#19／#25／#27**。

供 Prompt 4 边表使用（调用者 → 被调用者 ｜ 传递内容 ｜ 本次动作 ｜ 理由 ｜ 对应不变量编号）：

| 调用者 → 被调用者 | 传递内容 | 本次动作 | 理由 | 不变量 |
| --- | --- | --- | --- | --- |
| DispatchEngine → AgentLifecycle | 派发前取"用哪个角色配置、创建还是复用哪条 Session、关联哪些必要任务"的决策；派发结果记录复用决策与排除理由 | **新增** | 派发前的选人／选 Session 决策必须有唯一落点（§3.2／§7.1 I2）；"唯一派发入口"按目标口径收口 | #16／#17／#27 |
| AgentLifecycle → ControlEngine | 产生／拆解／压缩／归档／重新启用的**提案**（含进入／退出条件判据与证据引用） | **新增** | 四动作全部走"提案 → 归约"；ControlEngine 是唯一状态推进者（§4.4） | #1／#3／#16／#18 |
| AgentLifecycle → StateLedger | **只读** canonical 生命周期事实：`AgentInstanceV1`、`WorkParticipationV1`、`RoleSpecRevision`／矩阵 pin、`WorkContextBinding` | **新增** | 决策依据必须是 canonical 事实而非投影；Ledger 仍是唯一原子提交方 | #3／#16／#22 |
| AgentLifecycle → ReadModelIndex | **只读**忙闲／当前工作／任务与角色视图（`ActiveAgentView`、`MailboxViewV1`、角色视图） | **新增** | "复用是否可行"需要跨聚合视角；投影只读、不作权威 | #4／#16 |

## 8. 信息缺口

- **对齐架构稿 §11.4.3**（引用，不重新推导）：① 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、旧标识兼容映射）→ 架构稿 §9.2 第 1 份契约；② 各 Port 的精确形状、字段命名、装配点（含 Kernel 适配面"创建／打开、消息、执行、控制、状态、增量事件"的划分）→ 架构稿 §9.2 第 2／4 份契约；③ 工作卡片与三种记录的查询接口、筛选字段 → 架构稿 §9.2 第 3 份契约；④ 迁移切换点、删除顺序与回滚方式（含普通／Reviewer／Handoff 调用点）→ 架构稿 §9.2 第 4 份契约与 Prompt 6；⑥ 度量口径的具体采集实现（压缩与稳定前缀的度量、扫描次数）→ 按 U12 指标表，标"**待测**"，不得以文件数证明收益；⑦ 生产 `lifecycleControl`／continuation 能力开关的放开与 Kernel 接线验证 → §11.4.2 第一行，真实连续任务验收。
- **本模块新增缺口**：
  1. **接口是候选且结果集不完整**：`decide(request)` 的四值不足以表达"新建 Session／等待／不可投递"，`decide` 与 `propose` 之间的协议（触发、身份、幂等、重入）未定——见 §2 两张表，由 架构稿 §9.2 第 1／2 份契约定。
  2. **capacity／前缀度量口径未定**：判定"容量不足或噪声增加"、判定稳定前缀是否真的被复用，都需要测量口径与采集实现；按 U12 标"待测"。
  3. **承载字段与 Port 形状属接口参数**（§11.4.3 第 1／2／4 份契约）：`contracts/agent-lifecycle.ts` 是候选路径（架构稿 §9.1 主要文件锚点），本模块**无目录、无契约、无实现**；机械面同步（`scripts/module-map.mjs` 的 `moduleDirs` 与 `allowedModuleDependencies`、`tests/contracts/module-ownership.test.ts`、`src/README.md`、`dev_docs/modules/control/agent-lifecycle.md`）尚未落地（§6.1「模块变更必须同步的机械面」）。
  4. **决策所需视图不全**：`ActiveAgentView` 按 `(project, goal, task)` 查询而**不是按 `agentId`**（I6）；"忙闲／当前工作／角色卡片"的 Session 维度投影与筛选字段尚未定义，本模块的复用可行性判断在 I6 落地前只能得到部分依据。
  5. **职责迁移的验收判据（A3）**：**旧的重复选择、重复身份推导与重复取材路径必须迁出或删除；加一层 wrapper 让演示跑通不算完成**，也不以"最小闭环／wrapper 演示"作为重构完成标准（架构稿 §9.2 重构完成判据 1／3）；迁移清单、删除顺序与回滚点属 Prompt 6。
  6. **只读分叉与不可投递的判定点**：§7.4.1 要求在同一组契约里决定"排队／恢复／只读分叉／明确不可投递"，首版只读分叉由谁判定、以什么事实为依据仍未定。
  7. **未交付项的显式边界**：长期领域专家（角色配置 ＋ 知识库 ＋ 可积累记忆）只预留接口与积累方案，**明确未交付**；记忆与知识库的读取接口属 架构稿 §9.2 第 1 份契约的预留附件（§6.4／用户原话 14）。

## 9. 重构目标与质量验收

本节已纳入本轮模块文档要求；通用依据见[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。以下均为目标，**源码达成待验证**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| 当前无目录、契约和实现；§1 的创建/复用与处置提案、§8 的结果集和重入协议均属设计 | 建立可解释决策与提案实现；不冻结 schema，不新增长期 Agent 人格、通用工作流或依赖边 | 模块内共用候选筛选、判据和理由生成，保留创建/复用与压缩/归档约束差异；**本模块无自身旧实现可删除** | 覆盖无合适 Session、容量超限、未交接归档、重新启用（RG-01、RG-02、RG-05；CQ-01、CQ-02、CQ-05） |
| §2 尚不能完整表达创建、等待、补料和拒绝重入；推荐范围不得冒充 `selectedRefs` | 交接只表达决策、提案、推荐线索和理由；canonical 与选材仍归既有 owner | Dispatch 的 S05 消费本模块结论；经核实属于生命周期决策的旧选择／推导在消费者迁移后退役，正式绑定与提交守卫留在 Dispatch/Control | 契约覆盖调用者、输入输出、失败、重入和无 canonical 副作用；`selectedRefs` 仍仅由 ContextCompiler 生产（RG-03、RG-04；CQ-03、CQ-04、CQ-06、CQ-12；S05） |
| 新模块尚无生产接线，§1/§8 所列授权、义务、能力约束与全任务成本尚无本链路验收证据 | 跨项目显式拒绝，旧授权不继承，能力不足如实返回；按相同任务条件比较复用、压缩与新 Session | 权威政策不迁入本模块；Control 归约、Runtime/Kernel 执行和 Vault 授权保留 owner，不新增缓存体系 | 验证 `unsupported`、单 Session 单控制 Run、归档义务；报告输入/缓存/输出/压缩/准备/恢复成本，未测标待测（RG-01、RG-04、RG-06；CQ-06、CQ-08、CQ-09） |

专项关注：新模块须接入生产派发并替代外部重复职责，同时守住提案、归约、执行边界。状态：文档目标已明确；实现、接线和成本待验证。
