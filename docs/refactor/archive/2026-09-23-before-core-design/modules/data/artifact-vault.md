# ArtifactVault Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Data
module: ArtifactVault
code_dir: coding-platform/src/data/artifact-vault/
contract_state: planned
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> 不可变正文持久化与材料授权适用性：把正文、来源、首次拥有者与内容摘要一起落盘，按精确引用读取，并按既有 `MaterialAccessGrantV1` 判定谁在什么基线下能读。
> 分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文；跨模块切分见 `docs/refactor/modules/ownership-map.md`。

## 1. 职责

**负责**

本模块内部只保留三类变化原因：不可变正文核心、授权适用性判定、记录型扩展。`artifact-vault.ts` 的内容寻址、首写者、完整性与 owner-only 默认是两种存储实现共用的核心；`SqliteArtifactVault` 与内存实现只适配持久化和原子插入。`RuntimeObservationJournal`、`ExecutionNote` 与图正文沿用该核心，不各自复制 put/open、摘要或权限规则。

- **不可变正文持久化**：`put(record)` 把正文、`sourceRefs`、首次拥有者与内容摘要写在同一持久行；正文以内容寻址（UTF-8 body 的 SHA-256）；同一内容键采用**原子不覆盖插入**，竞争输家返回已提交首始记录的精确引用并标记重放，不抛唯一键冲突、不把自己的来源或拥有者写入既有记录。【代码】
- **精确引用读取与完整性检查**：`open(ref, accessScope)` 读取时复核正文 SHA-256 与 UTF-8 字节数；损坏返回 `rejected/invalid`；正文不存在返回 `unavailable`；**缺失不伪装成空内容**。【代码】
- **材料授权适用性解析**（`MaterialAccessResolver`／`material-access-policy`）：注入解析器后，非拥有者仅在**读者一致性 ＋ 材料一致性 ＋ 基线一致 ＋ 签发者是材料拥有者或 Control** 四项同时成立时放行；**读者一致性、材料一致性、声明基线与签发者权威由本模块自己判定**，解析器结果只是候选、不是决定（契约原话：*"a resolver result is a candidate, never a decision"*）。缺解析器时行为与 owner-only 默认完全一致。【代码】
- **授权读的版本化增量语义**：`open` 的 `currentBasis`／`stale`／`includeOwner`／`history.crossWorkspace`；未传新字段的旧调用语义不变；基线不一致返回 `rejected/stale`；`includeOwner` 只做「先执行同一权限检查」后的原 owner 返回。【代码】
- **Work／Session 记录正文的承载**：`ExecutionNote`（不可变、有界 16 KiB、body-first；每个 `noteId` 只创建一次）是"先落盘再生效"的记录承载；`RuntimeObservationJournal` 持有成功原子写入的公开运行快照。【代码】承载范围扩展见 §7（I8）。
- **运行日志的增量存储改造（架构稿 §9.2「必须先改」第 6 项）**：`RuntimeObservationJournal` 当前**每事件累计重写**，须改为**按事件增量存储**（追加式落盘，只写本事件新增的观察），使长 Run 的写入量随事件数线性增长而不是累计重写；写入与查询接线由 WorkerRuntime 承担（见 §7、`execution/worker-runtime.md`）。【设计新增】
- **图正文承载**：架构图的结构与关联正文以 `bodyRef` 引用持久化在 `artifacts(key, record)` 表内（架构稿 §5.1「存在形式」；`ownership-map.md` §1「图正文承载」）。【代码】表已存在，产品接线【契约未接】。
- **编码与重组校验**：探索新报告分块采用 `scoped-json-v1`（正文封装原生产者 scope、runId、part 与 text）；manifest 声明编码，读取时校验来源、顺序并核对重组报告摘要。【代码】
- **Skill／prompt 版本化资产的正文与元信息责任**：**资产本体与版本**落在本模块（版本化产物），元信息至少含**来源、版本、适用范围、已验证的真实任务与失败例**；与 `RoleSpec` 的引用关系、Run 的**正式引用**（Run 记录所用版本）对齐；**显式版本失效**（撤回＝显式失效，**不静默放开**）经既有治理／记录路径受理。据此支持"**资产版本 → 使用运行 → 验证结果／失败例**"的反查，以及"改动影响谁"由引用了该版本的 `RoleSpec`／Session 反查（架构稿 §6.4）。**不扩成技能市场**、不新增注册体系（`docs/PRODUCT.md` §7.6）。【设计新增】

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| 不判定报告／正文的业务真实性：**产物正文 ≠ 正式证据，也不产生新授权** | ControlEngine（Evidence 接纳与完成归约，不变量 #2／#6）；VerificationEngine（验证结论的组织） |
| 授权不改变 Task／Goal 相位、不满足证据要求 | ControlEngine（相位与义务归约） |
| 不签发授权（本模块只做适用性判定与读取） | ControlEngine（`ControlEngine.grantMaterialAccess`，提交不可变 `material-access-grant`，CAS@0，幂等） |
| 不成为第二个存储权威：canonical 的授权事实、撤销与版本不在本模块 | StateLedger（原子提交 canonical）；ControlEngine（归约） |
| **不新增逐条材料授权系统**；复用范围是**推荐线索**（Skill／prompt 指导阅读 + 推荐材料与检索入口），不是硬白名单；也不把"每轮继承历史复核"设为新增必经门禁 | 沿用既有 `MaterialAccessGrantV1` 判定；推荐入口的产出归 ContextCompiler（`selectedRefs`／`gaps`／manifest 的唯一生产者） |
| 不编译、不校验图正文与来源绑定，不做结构差分／Finding／漂移裁决 | ContextCompiler（`SourceGraphContextCompiler`）；ArchitectureReconciler（差分／Finding／Brief／候选物化） |
| 不判定源码来源的有效性与路径边界 | WorkspaceReader（`SourceApplicabilityPort`／来源 pin） |
| 不提供工作卡片、Session 与角色查询视图 | ReadModelIndex（`materialAccessGrants`／`materialAccessCandidates` 只做候选发现，判定仍在本模块） |
| 不做 message 的路由、投递与等待 | ControlEngine（路由事实与归约）；ReadModelIndex（`MailboxViewV1`／`communication-view.ts` 投影） |
| 长期记忆管理（查看／纠正／移除、跨任务消费）**未交付**：本模块只提供正文持久化与接口位置 | 扩展预留，**明确未交付**（架构稿 §6.4；不新增记忆模块、不提前建设独立数据库） |
| 跨项目／跨 Goal 的历史继承：**尚无转授权协议**，不能靠伪造 Control 身份隐式放行；跨项目复用首版不做 | ControlEngine／HumanCollaboration（**显式拒绝并说明原因，不静默降级**，不变量 #27） |

## 2. 对外接口

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `ArtifactPort.put(record)`【代码】 | HumanCollaboration、DispatchEngine、VerificationEngine、ArchitectureReconciler、ContextCompiler、WorkerRuntime | `ArtifactPutRecord` → 精确 `ArtifactRef` | SHA-256 内容寻址、原子不覆盖；重放不转移 owner 或来源；与 Ledger 登记不跨库原子 | 保留；Work／Session 记录、图正文、资产版本继续走此入口，不另造 put |
| `ArtifactPort.open(ref, query)`【代码】 | 同上需要读正文的消费者 | 精确引用＋requester/currentBasis/usage → `ready \| unavailable \| rejected` | 复核 digest/字节数；`forbidden \| invalid \| stale`；历史权限不能满足 current 用途 | 保留；新用途扩展 query，旧调用保持 owner-only 默认 |
| `RuntimeObservationJournal.init/save/read/flush` 及只读 `observations.all/integrityIssues`【代码，公开类】 | WorkerRuntime；只读观察对象按现有装配交给 Context/Verification/Dispatch 消费 | 运行记录 → 原子文件；key → 精确已提交记录；只读观察列表与完整性诊断 | `save` 当前按 key 原子替换完整序列；写失败不污染缓存；歧义/完整性问题不返回为可恢复记录 | 目标按单事件增量落盘，方法名与兼容读形状待接口阶段定；保持观察能力与真实 owner，不因 Host 接线隐藏逻辑依赖 |

**接口命名口径**：以真实 Port／实现名为主。`ArtifactPort`（架构名义名 `ArtifactVault.put/open`）；`MaterialAccessResolver`（架构名义名 `material-access-policy`）；持久实现 `SqliteArtifactVault`（正文、来源、拥有者与摘要在同一 SQLite 行提交），内存实现保留用于隔离测试。

**内部映射（不构成额外业务接口）**：`material-access-policy` 在 Vault 内解析授权候选，`MaterialAccessResolver` 是注入解析器的 seam；候选不等于许可，最终适用性仍由 Vault 的读取核心判定。Host 注入 Ledger／ReadModel／source-applicability，不改变 §3 的三条逻辑依赖。`MaterialAccessGrantV1` 与 `scoped-json-v1` 是协议/编码；图 bodyRef、ExecutionNote、Skill／prompt 版本资产是 put/open 的承载用途，不另列提供接口。两种 Adapter 共用现有核心，不把规则复制到 Journal、ExecutionNote 或 SQLite 分支。

**`put/open` 用途扩展【目标】**：图正文继续以 `bodyRef` 持久化；ExecutionNote 继续 body-first 且 canonical 记录由 Control→Ledger 登记；Skill／prompt 资产由已有正文写入消费者先 `put` 得精确版本引用，再交 Control 通过 Ledger 记录 `RoleSpec`／Run 引用。ControlEngine 不直接调用 Vault，本用途不新增 `ControlEngine → ArtifactVault` 边。

**本次变化方向**：见 §7（I8 ＋ A6；此处只写一句指引）。

## 3. 依赖

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| StateLedger | `load(ref)`（经解析器与 policy 复核 canonical） | canonical 的授权事实、撤销与版本；`currentBasisValid` 所需的账本持有版本（计划／工作区）。Vault **不 fold、不写 canonical** | 既有 |
| ReadModelIndex | `materialAccessCandidates({reader, material})`（完整候选，不截断）／`materialAccessGrants(query)`（有界展示，≤256 条，**不得当作授权候选**） | 候选发现：按精确 Run／QueryRun 身份及 `contentType`／`digest`／`sizeBytes` 取回**全部**候选；Vault 拿到候选后自己判定 | 既有 |
| WorkspaceReader | `SourceApplicabilityPort`（`materialSourcePinIsCurrent` 一类来源校验） | 原生来源适用性与来源 pin 核对；**方向是 Vault → WorkspaceReader，WorkspaceReader 不反向调用 Vault** | 既有 |

> 本模块**本轮不新增依赖边**：`put/open` 的 owner 与范围扩展、复用时的授权复核都落在上述三条既有边上；撤回的准入要求**不产生新边**。

## 4. 被依赖

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| HumanCollaboration | `ArtifactPort.put`／`open` | 消息正文先入 Vault 得到 `bodyRef`，ControlEngine 再登记引用与路由事实；历史授权读取入口 | 架构稿 §6.2.1（定向通信路径）、§7.4 交互 1 |
| DispatchEngine | `ArtifactPort.put`／`open`（授权解析在 open 内部）；只读运行观察对象 | 派发收口保存材料，按精确授权取材；查询已持久观察，不直接消费内部 resolver | 架构稿 §6.2.1、§6.2.3、§7.4 交互 3 |
| VerificationEngine | `ArtifactPort.put`／`open` | **原始检查报告先入 Vault**；审查材料从"装正文"改为 **L3 引用 + 按需正文**，正文经授权打开 | 架构稿 §6.2.3 审查材料收口方向、架构稿 §9.1 VerificationEngine 行 |
| ArchitectureReconciler | `ArtifactPort.put`／`open`（图正文 `bodyRef`） | 图差分的报告与 Finding／Brief 正文持久化；对账材料的正文读取 | 架构稿 §5.1；`ownership-map.md` §1 |
| ContextCompiler | `ArtifactPort.put`／`open`；Journal 只读观察对象 | 保存选中材料、按需读取正文与已持久观察；授权解析由 open 内部负责，实际读入内容与缺口写入 manifest | 架构稿 §6.2.2／§6.2.3；`module-boundaries.md`「原生源码与绑定材料分开」 |
| WorkerRuntime | `ArtifactPort.put`（公开观察）、`RuntimeObservationJournal` | 公开运行观察与快照的正文持久化；观察不是正式完成 | `module-status.md` WorkerRuntime 行「公开观察交 ArtifactVault」 |

> 宿主（`src/app/**`、`src/composition/**`，`owner()` 记为 Host）注入存储 Adapter 与 `MaterialAccessResolver`（`createMaterialAccessResolver(ledger, readModel, sourceApplicability)`）；**宿主边，不计入 38 条**。

## 5. 状态归属

| 状态／对象 | 对象性质 | 权威写入者 | 本模块持有形态 |
| --- | --- | --- | --- |
| 产物正文、来源列表、首次拥有者、内容摘要 | 不可变正文存储（canonical 引用在账本） | ArtifactVault **持有正文**；canonical 事实由 ControlEngine 归约、StateLedger 提交 | **持有**（正文与来源记录） |
| `MaterialAccessGrantV1` | **正式事实**（不因本模块只判定而改变性质） | ControlEngine 签发（`grantMaterialAccess`，`material-access-grant`，CAS@0，幂等） | **只读**：登记与归约在 Control＋Ledger，本模块只做**适用性判定**；ReadModelIndex 投影为 `material_access_grant_rows` |
| `currentBasis` 与 `stale` 判定 | 观测／只读解释（`currentBasis` 是**调用方声明**） | 调用方声明基线与版本；**判定**由 ArtifactVault 在读取时作出（声明基线本身不构成权威） | **持有判定结果**，不持有声明所指向的事实 |
| `RuntimeObservationJournal` | 观测 | ArtifactVault 持有（公开运行快照） | **持有**；**不代替正式 Ledger 状态** |
| `ExecutionNote` | 记录正文承载；正式事实仍由 Control 归约 | ArtifactVault（不可变、有界、body-first） | **持有正文**；正式事实不在本模块 |
| **Skill／prompt 资产版本与其元信息**（正文、来源、版本、适用范围、已验证任务与失败例） | **正式事实**（版本化资产） | ArtifactVault 持有正文与版本元信息；失效经既有治理／记录路径受理；`RoleSpec`／Run 的引用关系由 ControlEngine 归约 | **持有**资产本体与版本元信息；被引用关系**派生副本**，来源写 `RoleSpec`／Run（owner 在别处不改变资产版本本身的性质） |
| 架构图结构与关联正文 | 正文承载（**正文 ≠ 结构权威**） | ArtifactVault 持有正文（`bodyRef`）；**结构权威＝ArchitectureBaseline revision**（不变量 #20／#21） | **持有正文**；不判定结构 |

> **列口径**：本表按 **对象性质／权威写入者／本模块持有形态** 三列表达；生命周期阶段与动作见本节末的归属说明。

**本模块拥有的对象**：正文与来源记录、首次拥有者、内容摘要、材料授权适用性判定、`RuntimeObservationJournal` 观察、`ExecutionNote` 正文、`bodyRef` 指向的图正文、**Skill／prompt 资产本体与版本元信息**（设计新增）。owner 维度**以 Run 为主体**。
**本模块不拥有的**：canonical 授权／撤销／版本（StateLedger）、授权签发（ControlEngine）、Task／Goal 相位与 Evidence 接纳（ControlEngine）、工作卡片与 Session 视图（ReadModelIndex）、来源有效性与路径边界（WorkspaceReader）、`WorkContextBinding`／`workId`（不在本模块，见 §6）、`agentId`（本模块不持有）。

> 生命周期口径（架构稿 §4）：本模块落在**五阶段**的初始化（阶段 2 正文与投影）、运行与销毁＝归档（产物与来源关系保留）；落在**四动作**的压缩（记录正文承载）与归档（保留正文）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**，不由本模块承载。

## 6. 旧标识去向

- 本模块**以 Run 为 owner**，**不持有 `agentId`**。拥有者引用只有两类：`RunRef(projectId, goalId, runId)` 与 `QueryRunRef(projectId, workspaceId, queryJobId, runId)`；**不同 Project 或 Goal 中的同名 Run 不视为同一拥有者**，两类运行身份**不能互相替代**（P1-09 查询正文允许以 QueryRunRef 为拥有者，不伪造 Worker Run）。
- `WorkContextBinding`／`workId` **不在本模块**：正文持久化只需要精确引用与 owner，不需要工作维度身份；`workId` 首版**未宣布必需**（§4.5 标识取舍），本模块不为它预留基数。
- `AgentInstanceV1.agentInstanceId`／`AgentInstanceStatus`（含 `retired`／`retiredAt`）与本模块无关：本模块不持有 Agent 运行实例状态，也不把四态写入该字段。
- **内容寻址重放不转移首次记录的拥有者权限**：不同拥有者存入相同 digest 后仍须原拥有者身份或有效精确授权才能读取；旧 grant 或相同正文**不能继承权限**。
- 旧事件语义不变（架构稿 §9.3 第 1 条）：既有正文／来源／owner／摘要与旧 grant 不因本轮职责同步而改写；旧 manifest 保留原编码与访问权限，**不自动复制或转移历史正文**。
- 结论：本模块**无需标识迁移动作**；I8 扩展的是 **owner 与承载范围**（Work／Session 记录正文 body-first），不是给旧标识改名。

## 7. 本次接口变化方向

**共用与去向**：共用 `artifact-vault.ts` 的内容寻址、完整性、首写者和授权判定；保留 SQLite/内存的事务与持久布局差异，保留 Journal 的时序语义和 Note 的 16 KiB/唯一 noteId 约束。旧累计观察快照只承担迁移兼容，目标写路径改为单事件增量记录；旧图/记录/资产入口归并到既有 `put/open`，不另建平行正文 API。

`对应项号：I8 ＋ A6 ｜ ArtifactVault.put/open：Work／Session 记录正文改为 body-first 持久化（沿用 work-record 雏形与 ExecutionNote 承载，扩展 owner 与范围），复用时的授权复核沿用既有 MaterialAccessGrantV1 判定；并为 **skill／prompt 版本化资产**承担本体与版本元信息（来源、版本、适用范围、已验证任务与失败例、显式失效），支持"资产版本 → 使用运行 → 验证结果／失败例"反查（§6.4）；**运行日志改为增量存储**——`runtime-observation-journal` 的每事件累计重写改为按事件增量落盘，写入与查询接线由 WorkerRuntime 承担（架构稿 §9.2「必须先改」第 6 项） ｜ 边动作：保留（StateLedger／ReadModelIndex／WorkspaceReader 三条既有边语义不变，本轮不新增边） ｜ 理由：产品要求"保留原始记录及纠正链供追溯"（§7.1 I8）；"复用不得沿用旧授权"且首版不新增逐条材料授权系统（§7.2 A6、§4.3 第 5 条、L-1 撤回）；资产版本必须可追溯到使用它的运行与验证结果（架构稿 §6.4）；长 Run 的累计重写属必须先改的成本链（架构稿 §9.2） ｜ 不变量：#17（复用不沿用旧授权、无逐条授权系统、执行端权限不由 prompt 绕过）、#20／#21（图正文承载不成为第二权威）、#22（摘要必须能回到来源核验）、#28（L3 引用用于授权复核与完成归约）`

## 8. 信息缺口

- **对齐架构稿 §11.4.3**：
  - **①** 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、旧标识兼容映射）→ 架构稿 §9.2 第 1 份契约：Work／Session 记录正文的 owner 与承载形态（L-2：**平台不复制 Kernel 正文，只保存引用**）。
  - **②** 各 Port 精确形状／字段命名／装配点 → 架构稿 §9.2 第 2／4 份契约：`ArtifactPort` 与 `MaterialAccessResolver` 的字段命名、宿主注入点、Kernel 适配面划分。
  - **③** 工作卡片与三种记录的查询接口、筛选字段 → 架构稿 §9.2 第 3 份契约（查询面在 ReadModelIndex，本模块只提供正文与授权判定）。
  - **④** 迁移切换点、删除顺序与回滚方式 → 架构稿 §9.2 第 4 份契约与 Prompt 6。
  - **⑥** 度量口径的具体采集实现 → 按 U12 指标表，标"待测"。
- **本模块新增缺口**：
  1. **长期记忆管理仍未完成**：长期领域专家＝角色配置 ＋ 知识库 ＋ 可积累记忆属**扩展预留、明确未交付**；本模块只提供正文持久化与接口接入位置，**不得写成已有能力**（架构稿 §6.4）。
  2. **通用源码适用性与完整历史消费者未完成**。
  3. **未实现通用账本版本推进后的自动撤销**：`currentBasis` 仍是调用方声明，探索消费者另行检查当前计划／工作区／源码摘要；**不得把"声明基线不一致返回 `stale`"表述为通用自动作废**。
  4. **旧进程中从未落盘的正文无法凭引用恢复**；读取返回 `unavailable`，**缺失不伪装成空内容**。
  5. 跨项目／跨 Goal 的历史继承**尚无转授权协议**：不能靠伪造 Control 身份隐式放行；跨项目复用首版不做（显式拒绝并说明原因）。
  6. 正文分块重组必须与已验收 `reportDigest` 一致；manifest 只标记**实际读入**的内容，**给出索引不等于原文已被消费**（不变量 #28）。

## 9. 重构目标与质量验收

> 通用依据：[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。本节已纳入本轮模块文档要求；以下均为重构目标与验收条件，**不表示源码已经达成或验收通过**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| 内存与 SQLite 已共用 `artifact-vault.ts` 的内容寻址、首写者、完整性与 owner-only 核心；记录型用途仍可能各自复制正文规则（§1／§2；S12） | 保持共同核心＋薄存储适配，不新增通用 Repository，不把正文存储提升为业务真实性或 canonical 状态权威 | `ExecutionNote`、图正文、Skill／prompt 版本资产继续复用既有 `put/open`；等价验证后删除用途侧重复摘要、完整性或权限分支 | 两种 Adapter 对同一正文、重放、损坏、缺失与拒绝产生等价契约结果；真实消费者仍经既有入口接线（RG-01／RG-02／RG-03；CQ-01／CQ-04／CQ-08） |
| `RuntimeObservationJournal` 当前每事件累计重写，长 Run 写入量随历史累计增长（§1／§7） | 改为单事件增量落盘，同时保留观察顺序、完整性诊断和兼容读取；不改变 WorkerRuntime→ArtifactVault 既有边 | 新增量写路径替代累计快照写路径；旧快照只在明确兼容期内读取，删除条件随迁移步骤登记 | 固定事件量下记录写入次数与字节量，验证重开、顺序、损坏与兼容读取；收益须为同条件测量（RG-03／RG-06；CQ-06／CQ-08／CQ-09／CQ-12） |
| 授权解析器结果只是候选，正文相同或历史 grant 不能自动转移权限（§1／§2／§5） | 共同读取核心继续在每次 `open` 内复核 reader、material、basis 与签发者；不得为复用新增逐条授权系统或第二状态权威 | 保留 `MaterialAccessGrantV1` 与现有 resolver seam；旧 owner-only 调用语义不变，扩展用途通过同一判定核心 | 覆盖 owner、有效精确授权、stale、撤销后投影落后、跨 Project／Goal 与损坏正文；确认拒绝不返回正文且不写 canonical（RG-01／RG-04；CQ-01／CQ-03／CQ-05／CQ-06／CQ-08） |

**专项验收场景**：同一正文并发写入只保留首写记录且不转移 owner；撤销授权后即使读模型滞后也拒绝读取；长 Run 的观察记录从累计重写切换为增量写后仍可按原顺序恢复并报告完整性问题。

**当前状态**：共同 Vault 核心与两种 Adapter 已存在；运行观察增量存储、扩展资产用途的真实接线及上述完整验收仍待实现或复核，不能标记为通过。
