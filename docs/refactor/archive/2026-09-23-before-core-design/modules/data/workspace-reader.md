# WorkspaceReader Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Data
module: WorkspaceReader
code_dir: coding-platform/src/data/workspace-reader/
contract_state: extension draft
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> 路径边界内的源码与原图来源捕获：在显式读权限内返回**来源快照与 provenance**，隐藏工作区读取差异；不查 Ledger、不存 Vault、不判授权、不写状态。
> 分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文；跨模块切分见 `docs/refactor/modules/ownership-map.md`。

## 1. 职责

**负责**

内部把“来源读取与快照”“语言/索引适配”“路径政策”分开复用。所有入口共用规范化、工作区逃逸防护和拒绝结果；TS/JS、Python、C++ 保留各自能力与覆盖声明。执行权限的 denied prefixes 与索引扫描为控制成本而忽略的目录是两类政策：前者拒绝访问，后者仅跳过发现，不能合成一张清单或一个错误码。

- **有界源码读取**：`read(query) → sourced／unsupported／stale／rejected`；每次查询重建并**再次读取核对来源**，变更返回 `stale`，删除／拒绝／超容量返回 `rejected`；**不缓存来源有效性**、不静默复用旧缓存。【代码】
- **原生图来源捕获**：`ArchitectureSourceCapturePort`（`architecture-source.ts`／`ProjectArchitectureSourceReader`）捕获架构图的**原生来源与 pin**；正文编译与保存不归本模块。【代码】
- **索引与工具**：`SourceIndex.query`／`excerpt`；`ProjectSourceIndex` 与工具 `code_index`／`source_excerpt`／`project_index`／`python_index`／`symbols`；`PythonSourceIndex`；`cpp-source-index.ts` 的受限 libclang 局部语义。【代码】
- **按消费者划分的有界来源面**：`role-source-reader.ts`（角色 `code` 通道的原生列举、读取、根目录与路径边界）、`query-workspace-source-reader.ts`（独立查询来源版本）、`verification-workspace-reader.ts`、`reviewer-source-reader.ts`（有界原文与同一可见路径策略）、`candidate-workspace-reader.ts`、`readonly-read-witness-reader.ts`。【代码】
- **来源适用性与 pin**：`ExplorationSourceApplicability`（实现 `SourceApplicabilityPort`）、`WorkspaceSourceApplicability`、`verification-source-applicability.ts`；**来源 pin 在重读两次相等后产生**，读取失败或期间变化明确拒绝。【代码】
- **路径边界与拒绝前缀**：`denied-prefixes.ts` 是拒绝前缀的共同来源；路径解析与逃逸防护、符号链接只记身份不跟随。【代码】
- **能力与容量如实声明**：语言能力差异（TS/JS 语义导入、Python AST、C++ 受限局部）、覆盖范围与容量常量随结果一并声明，超限与发现不完整**不截断冒充成功**。【代码】
- **初始化阶段的只读探索与来源捕获**（架构稿 §4.1 阶段 2；`ownership-map.md` §1「原生来源捕获」）。【代码】

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| 不编译图正文、不校验 reader Run／Plan pin／Workspace 版本、不保存正文：**不能把完整 `SourceGraphContext` 归到本模块** | ContextCompiler（`source-graph-context.ts`／`architecture-context-compiler.ts` 的 `SourceGraphContextCompiler`） |
| 不做图差分、Finding／Brief、漂移判据与候选物化 | ArchitectureReconciler（`inspect`／`computeArchitectureDelta`／`BaselineEvolutionPort`） |
| 不保存正文、不做正文持久化 | ArtifactVault |
| **不调用 Ledger 或 Vault** | StateLedger／ArtifactVault（读取它们不是本模块的职责） |
| **不承担材料授权或 Evidence 接纳** | ArtifactVault（`material-access-policy` 授权判定）；ControlEngine（Evidence 适用性与完成归约，不变量 #2／#6） |
| 不判定完成、不写任何正式状态 | ControlEngine（归约）＋StateLedger（原子提交） |
| **只读，不初始化代码目录**：新项目创建目录、说明文件与模块／接口文档需要普通工作区权限 | DispatchEngine（派发）／WorkerRuntime（执行）；草案路径见 L-5（**没有 baseline 不阻止开始工作**） |
| 不自动把整仓及依赖放入材料 | ContextCompiler（有界选材，L1 路径级） |
| 不做持久全仓增量索引、不提供通用历史 Git 差异接口 | 当前**无该能力**；加载范围与增量缓存策略尚未形成开发约定（见 §8） |
| 不提供工作卡片、Session 与任务图投影 | ReadModelIndex |
| 不参与身份解析：不读也不产生 Agent／Work 身份 | 身份与工作身份由 ControlEngine 权威解析（`work-identity-resolution.ts`）＋StateLedger 持久 |

## 2. 对外接口

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `read(query)`【架构名义；现有实现分散】 | ContextCompiler、WorkerRuntime | 来源/索引查询 → `sourced \| unsupported \| stale \| rejected` | 每查询重核来源；不缓存有效性；能力缺失须指明 | 目标收口一次捕获多页读取；旧 consumer reader 迁移前保留 |
| `ArchitectureSourceCapturePort`【代码】 | ContextCompiler | 工作区范围 → 原生图来源＋pin | 只捕获原图；正式绑定和正文归 Context/Vault | 保留现入口 |
| `SourceIndex.query/excerpt`、`ProjectSourceIndex`【代码】 | ContextCompiler、WorkerRuntime 工具适配 | 声明/位置/分页 → 定义、引用、摘录、inventory | 局部 coverage；容量与发现不完整显式报告；配置只作数据 | 保留；分页目标复用一次捕获，避免重复扫整树 |
| `PythonSourceIndex`／受限 C++ provider【代码】 | WorkerRuntime/Context 的对应工具消费者 | 权限过滤源码 → 局部语义结果 | 不执行项目代码；不完整关系标 unknown/static_candidate；不冒充全语言图 | 保留语言专用 Adapter，共用路径政策但不合并能力语义 |
| `SourceApplicabilityPort.capture`；导出 helper `materialSourcePinIsCurrent`【代码】 | ArtifactVault、ContextCompiler | scope＋sourceSet → sourced(pin)／unavailable／rejected／stale；已有 pin＋scope → boolean currentness | capture 重读可信来源产生 pin；helper 重捕获并精确比较，异常/缺能力/不匹配为 false；workspace identity 不冒充 Git commit | 保留；区分 Port 多态结果与 helper 布尔结果，不把二者当作同一方法 |
| `RoleSourceIndexPort`（实现 `WorkspaceSourceIndexReader`）／`readReviewerSource`／`VerificationRoundSourcePort`（实现 `VerificationWorkspaceReader`）／`QuerySourceRevisionPort`（实现 `QueryWorkspaceSourceReader`）【代码】 | ContextCompiler 的执行、Reviewer、验证、Query 编译器 | 用途范围 → 有界原文、摘要、同次 inventory、独立查询来源版本 | 共享可见路径政策；Candidate 排除目录任意层不可读；用途身份和输出形状保留 | 现入口保留，内部复用来源捕获与路径政策 |
| `WorkspaceReadPort`／`CodeGraphReadQueryV1`【代码】 | ContextCompiler/旧图消费者 | 旧绑定图 query → bounded wire result/unsupported | 只兼容 wire；canonical 编译归 Context；正式图入口仍未接 | 保留兼容入口，不改成局部查询协议 |

**接口命名口径**：以真实 Port／实现名为主。`WorkspaceReader.read` 是架构名义名，源码实现分散在各 consumer reader 与索引类上；`ArchitectureSourceCapturePort`、`SourceApplicabilityPort`、`WorkspaceReadPort` 为源码真实 Port 名。

**实现映射**：`role-source-reader.ts` 等文件承载用途适配，索引类是上表当前真实消费面，不能全部藏成内部实现；内部共用路径、捕获与容量支持见 §7。`denied-prefixes.ts` 当前归 Reader；是否把七项拒绝前缀提升为稳定共享协议值待架构决定，决定前不把它当成 Verification 可直接消费的跨模块 Port。

**本次变化方向**：见 §7（I-补 ＋ 图原图来源捕获那一片）。

## 3. 依赖

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| （无） | — | 本模块是 **DAG 的汇之一**（`WorkspaceReader → {}`，`module-map.mjs` 的 `allowedModuleDependencies.WorkspaceReader = []`）：**无其他产品 Module 调用依赖**；文件／Git／索引能力与 `workspace` 沙箱由宿主**注入**（`WorkspaceReadPort`、`listFiles`、`identity`）。 | 既有 |

> 边界三条：① **不调用 Ledger 或 Vault**；② **WorkspaceReader 不反向调用 Vault**——`material-access-policy` 对来源校验的依赖方向是 **ArtifactVault → WorkspaceReader**；③ 本轮**不新增任何依赖边**，也不把"来源读取"包装成对控制面的反向依赖（撤回的准入要求不产生新边）。

## 4. 被依赖

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| ContextCompiler | `ArchitectureSourceCapturePort`（经 `SourceGraphContextCompiler`）；`role-source-reader.ts` 等窄端口 | 原生图来源与 pin；角色 `code` 通道的有界索引／源码；来源 pin、实际版本与不可用／越界结果**保留原义** | 架构稿 §5.1「源码落点」；`module-boundaries.md`「ProjectArchitectureSourceReader 只捕获原生图；SourceGraphContextCompiler …将图保存 Vault」 |
| ArtifactVault | `SourceApplicabilityPort`（经 `createMaterialAccessResolver(ledger, readModel, sourceApplicability)` 注入） | 授权适用性判定所需的**原生来源校验**；Vault 拿到结果后自己判定（**本模块不反向调用 Vault**） | `module-boundaries.md`「Vault 的 material-access-policy 拥有授权适用性解析，依赖 StateLedger、ReadModel 候选发现和 WorkspaceReader 来源校验」 |
| WorkerRuntime | 既有索引与工具注入（`code_index`／`source_excerpt`／`project_index`／`python_index`／`symbols`）及路径拒绝政策 | 执行期只读来源、路径边界与来源快照；`WorkspaceCapabilityPort` 的配置受理政策归 Control，不是 Reader 提供面 | 架构稿 §3；`module-status.md` WorkerRuntime／WorkspaceReader 行 |

> 宿主（`src/app/workspace-tools.ts`、`src/composition/**`）注入文件／Git／索引读能力与沙箱；**宿主边，不计入 38 条**。

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| 来源快照与 provenance（排序后的路径／内容 SHA-256／解析器版本摘要、来源身份、真实根） | 否（**无 canonical 状态**；每次查询重建） | WorkspaceReader | 初始化（只读探索与来源捕获）／运行（执行、审查、查询的来源读取） |
| 来源 pin | 否（观测；**重读两次相等后产生**） | WorkspaceReader（`ExplorationSourceApplicability` 等） | 初始化（阶段 2） |
| 路径边界与拒绝前缀 | 否（策略常量） | WorkspaceReader（`denied-prefixes.ts`） | — |
| 语言能力差异（TS/JS 语义导入、Python 语法 AST／受限跨文件、C++ 受限 libclang） | 否（能力声明） | WorkspaceReader 如实声明；实际执行能力由 Kernel／沙箱决定 | 每次查询 |
| 正式工作区版本 `workspaceRevision` | 否 | **不属于本模块**：canonical workspace 版本在 ControlEngine ＋ StateLedger；**来源 snapshot 与它的正式映射尚缺**（见 §6） | — |
| 架构 baseline pin | 否 | ArchitectureBaseline（治理，不可改写 ＋ CAS 激活，不变量 #13／#20／#21） | — |
| 图正文与来源绑定 | 否 | ContextCompiler（编译）→ ArtifactVault（正文）；本模块只给原生来源 | 初始化（阶段 2） |

**本模块拥有的对象**：来源快照、provenance、来源可用性与 pin 判定、语言能力声明、路径边界。**不持有** Role／Session／Run／Work 的任何持久标识，也**不持有 canonical 状态**。
**本模块不拥有的**：canonical workspace revision（ControlEngine ＋ StateLedger）、图正文与来源绑定（ContextCompiler → ArtifactVault）、图结构权威（ArchitectureBaseline）、材料授权与 Evidence（ArtifactVault／ControlEngine）、证据与完成判定（ControlEngine）。

> 生命周期口径（架构稿 §4）：本模块主要落在**五阶段**的**初始化（项目认知初始化：只读探索与来源捕获）**，并在运行期作为执行／审查／查询的来源读取面；不承担四动作的任何写操作（不产生、不拆解、不压缩、不归档）。

## 6. 旧标识去向

**本模块不持有旧 Agent／Work 标识，无需迁移动作。** 理由：本模块只按**路径与来源**工作——路径边界、内容摘要、来源身份与能力声明；它**不参与身份解析**，既不读也不产生 `agentId`／`AgentInstanceV1.agentInstanceId`／`workId`／`WorkContextBinding`／`AgentInstanceStatus`。来源身份里的 `identity.workspace` 只标明算法与真实根，`commit=null`，**不冒充 Git commit**，也不构成任何 Agent／Work 标识。

但必须表态（缺项）：**来源 snapshot 与账本 `workspaceRevision`、已 pin 架构 baseline 的正式映射尚缺**——不能把文件集合摘要强行转成数字 revision，也不能沿用固定 revision 0 充当真实基准；该映射是正式架构对账与跨角色交接的前置条件。

另两条与旧语义直接相关的如实口径：

- `verification-workspace-reader.ts` 独立 Git 根只读 `ls-tree` 原始 blob 比较，**不运行项目 clean filter**；非 Git、外层 Git 子目录或比较不可靠时保留当前快照并**明确变化范围未知**；**`HEAD` 比较不能冒充 Run 前态**。
- 旧 `manifestDigest` 与旧 manifest 保留原编码与访问权限（`exploration-source-v1`），**不自动复制或转移历史正文**；不同 ignore／字节语义**不可强行合并**而破坏历史记录（不变量 #14 的同向口径）。

## 7. 本次接口变化方向

**共用与去向**：Reader 内共用路径规范化、逃逸防护、来源 pin 和拒绝映射；语言索引保留能力差异，扫描 ignore 继续只影响发现成本。旧 consumer reader 在迁移到共同捕获支持后仍可保留用途薄适配。跨模块 denied-prefixes 有两种稳定候选：① 若七项只是长期稳定的共享协议值，放入有归属的 Contracts，只放值/编码，算法仍归 Reader/Runtime/Verification；② 若其行为随 Reader 访问政策演进，由 Reader owner 提供窄公共面，并先由架构明确新增 Verification→Reader 逻辑边。当前不选择、不新增边；Runtime→Reader 已有边，DI 不消除 Verification 的逻辑依赖。登记见 `ownership-map.md` §14。

`对应项号：I-补 ｜ WorkspaceReader.read：一次不可变捕获对应多页读取（避免分页 query 重复捕获整树）；变更检测失败时显式重试／标 stale；能力差异与允许的 Kernel 边显式登记 ｜ 边动作：保留（WorkspaceReader → {} 仍是 DAG 的汇，本轮不新增任何边） ｜ 理由：project-source-index 分页重复捕获属产品核心路径成本链（架构稿 §9.2「必须先改」第 6 项）；能力必须如实声明、不支持返回 unsupported 并指名缺失能力 ｜ 不变量：#7（唯一 Writer 写租约仍归 Run，来源读取不改变写权，不得仅凭超时交出写权）、#20／#21（来源捕获不成为结构权威，正式图仍 pin 到已接受 baseline）、#22（摘要必须能回到来源核验）、#28（L1 路径级只用于检索与解释，不得用于完成归约、授权判定或审批）`

## 8. 信息缺口

- **对齐架构稿 §11.4.3**：
  - **②** 各 Port 精确形状／字段命名／装配点（含 Kernel 适配面划分）→ 架构稿 §9.2 第 2／4 份契约：`read(query)` 的"一次捕获＋多页读取"形状、能力差异与**允许的 Kernel 边显式登记方式**。
  - **④** 迁移切换点、删除顺序与回滚方式 → 架构稿 §9.2 第 4 份契约与 Prompt 6：默认 `FakeWorkspaceReaderAdapter` → 真实适配器的切换点。
  - **⑥** 度量口径的具体采集实现（读取／扫描次数）→ 按 U12 指标表，标"待测"。
  - **⑦** 生产 `lifecycleControl`／continuation 能力开关的放开与 Kernel 接线验证 → §11.4.2 第一行、真实连续任务验收（本模块只提供来源读取面，不持有该开关）。
- **本模块新增缺口**：
  1. **`FakeWorkspaceReaderAdapter` 仍是默认装配**；架构稿 §9.1 把它列为"替换（改接法）"，真实适配器尚未成为生产默认。
  2. **图读取返回 `unsupported`**；`ArchitectureView` 的实现是 `UnavailableState`；**正式架构图入口仍待接通**（图端口能力目前仅 TS/JS 语义导入）。
  3. **Python 跨文件语义与 C++ 未实现（完整）**：Python 跨文件推断可不完整、动态关系保留 `unknown`／`static_candidate`；C++ 只有受限 libclang 局部能力。这些局部能力**不代表完整语言／依赖／动态调用图**。
  4. **TS solution project references 未完整**：当前要求分别查询引用配置，**未声称完整 solution 分析**。
  5. **可信 tsconfig／依赖索引的加载范围与全仓覆盖／增量缓存策略尚未形成开发约定**：`SourceIndex`（显式文件集）**不加载项目插件／tsconfig／package 配置或外部依赖**；`ProjectSourceIndex` 只把 tsconfig/jsconfig 当数据解析（`include`／`exclude`／`extends`／`paths`），**不执行插件**；当前保守实现显式文件集，**不自动把整仓及依赖放入材料**。
  6. **AST 关系到产品 Module／Interface 的分类规则尚不具体**：语义引用是真实代码事实，架构裁决需独立规则，**不能根据同名符号或一条依赖边直接产生固定 Finding**。
  7. **来源 snapshot 与账本 `workspaceRevision`、已 pin 架构 baseline 的正式映射尚缺**（见 §6）。
  8. 如实口径：**仅保证可观察变化检测，不声称多文件原子快照**；**范围不完整不截断冒充成功**（`ProjectSourceIndex` 发现不完整会拒绝）；**不缓存来源有效性**；分页不能冒充全量。
  9. 本模块**只读，不初始化代码目录**；**不调用 Ledger 或 Vault**；**不承担材料授权或 Evidence 接纳**。
  10. 长期记忆（查看／纠正／移除、跨任务消费）属**扩展预留、明确未交付**，与本模块无关；本模块不为它新增存储或索引职责。

## 9. 重构目标与质量验收

> 通用依据：[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。本节已纳入本轮模块文档要求；以下均为重构目标与验收条件，**不表示源码已经达成或验收通过**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| 多个 consumer reader 重复来源捕获、规范化、逃逸防护与拒绝映射；语言和用途能力又有真实差异（§1／§2；S09） | 共用来源捕获、路径规范化、pin 与拒绝映射；保留 TS/JS、Python、C++ 及 Reviewer/Query/Verification 的能力和输出差异 | 旧 consumer reader 迁为用途薄适配后删除等价读取副本；不合并语言语义，不新增 Module 或依赖边 | 各真实消费者仍收到原有用途字段与能力声明；共同拒绝场景一致，unsupported/unknown 不被改写为成功（RG-01／RG-02／RG-03／RG-04；CQ-01／CQ-02／CQ-03／CQ-04／CQ-08） |
| `ProjectSourceIndex` 分页可能重复捕获整树；来源变化只保证可观察，不承诺多文件原子快照（§2／§7／§8） | 一次不可变捕获服务多页读取；变化时显式 `stale`／重试，不能把分页或不完整发现冒充全量结果 | 多页查询复用同一捕获结果；旧逐页重扫路径在消费者迁移和等价验证后删除，不新增持久全仓索引 | 固定文件量与页数记录捕获／扫描次数；跨页 pin 一致，捕获期间变化返回 stale 或拒绝，收益按同条件测量（RG-01／RG-03／RG-06；CQ-06／CQ-08／CQ-09／CQ-12） |
| denied prefixes 是安全拒绝；tsconfig/index ignore 只控制发现与成本，两者不能合成同一清单或错误码（§1／§2／§8；S09） | 继续区分“不可访问”与“未参与发现”；Verification 共享路径政策的 owner 未定前，不用注入隐藏新逻辑边 | Reader 内保留现有 `denied-prefixes.ts` owner；跨模块共享只在上位裁决后选择 Contracts 值或窄公共面，当前不新增 Verification→WorkspaceReader 边 | 覆盖逃逸、符号链接、任意层拒绝目录、被 ignore 但显式允许读取、超容量与不完整发现；实际文件访问与结果码一致（RG-01／RG-04／RG-05；CQ-01／CQ-03／CQ-05／CQ-06／CQ-08／CQ-11） |

**专项验收场景**：同一捕获的多页结果使用一致来源 pin 且不重复扫描整树；文件在捕获期间变化时不返回 sourced；安全拒绝路径始终不可读，而仅被索引 ignore 的允许路径不会被误报为权限拒绝。

**当前状态**：现有来源读取、语言 Adapter、路径逃逸防护与拒绝前缀已存在；一次捕获多页复用、默认真实适配器接线、共享路径政策裁决和成本测量仍待实现或验证。
