# ArchitectureReconciler Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Control
module: ArchitectureReconciler
code_dir: coding-platform/src/control/architecture-reconciler/
contract_state: planned
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> 架构对账：图差分 → Finding／Brief → 候选物化；对照有效 baseline 与实际源码产生差异与可审阅的演进材料，**不激活 baseline**。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文。

## 1. 职责

**负责**

**内部责任与共用实现。** 本模块规模小，继续以 `inspect` 编排、`computeArchitectureDelta` 机械差分和现有 Control 记录入口组成，不为套模板新增 service/repository 层。差分键与摘要计算由模块内纯实现共用；来源读取、正式记录与 baseline 激活仍分别归 ContextCompiler、ControlEngine。

- **架构漂移对账（本模块的一句话职责）**：把**同一工作区版本**的源码图与 **plan pin 的 baseline** 做机械差异比较，产出待审问题与可审阅材料（架构稿 §5.1「生成方」落点里属于本模块的那一片：**差分／Finding／Brief／候选物化**，见架构稿 §5.1）。
- **`inspect` 的一条确定性流水线**：`ArchitectureContextPort.assemble(intent)` 取精确版本材料 → `computeArchitectureDelta(before, after)` 计算机械差分 → 分类 `ArchitectureFindingV1` → 保存 snapshot／delta／brief 正文到 Vault → **逐个检查 Control 回执**（`architecture-reconciler.ts`）。
- **机械差分只做机械差异**：`ArchitectureDeltaV1` 带 `noVerdict: true`（契约原话：*"a raw Delta carries NO correct/incorrect verdict"*）；普通结构差异低风险且**不判正确性**，接口／依赖变化为待审语义问题，新未解析关系为低置信问题；无变化不产生固定 Finding。
- **Finding 的风险分档与规则判定**：`dependencyRules` 只支持 `kind: 'forbid_dependency'`，规则 ID 唯一且两端必须是 `sourceBinding` 显式 Module；新增违规依赖的 Finding 为高风险／`material`，并保留具体规则、机械变化与 delta 来源。**自由文字 `constraints` 不被猜测成可执行规则。**
- **可审阅的演进材料（Brief）**：`ArchitectureDecisionBriefV1` 的选项要求"调查或另行提出精确修订"，**不自动生成已选业务方案**；候选物化完整保留 `sourceBinding`。
- **候选基线物化**：`BaselineEvolutionPort.materialize(proposalRef)`（`baseline-evolution-port.ts`）从"提案 + 其**精确来源**"确定性派生候选并重算摘要；端口**只读、从不写账本**——候选记录与不可变 revision 由 Control 提交。`needs_material` 是保留状态（本只读端口不取正文材料）。
- **回执消费的失败语义**：每一步 Control 登记必须消费回执，**只有 `committed` 才继续**；拒绝返回 `fail_closed`／`recording_rejected`，`diagnostics` 保留拒绝的 `commandId`、`code` 与 `issues`，**停止后续登记**；此前已提交的记录保留，**不能把部分提交说成整个 inspect 成功**；重试使用已存 inspection 时间与相同身份。
- **来源绑定的核对**：核对实际 `PlanRevision` pin、治理内容摘要与真实 reader run；源码前后摘要核对与数字版本核对并行生效；缺少 `sourceBinding` 时机械检查 **fail_closed，不回退 revision 0**。
- **不把推断固化成权威**：`unresolved` 如实保留；未映射源码与缺失依赖**永不呈现为"没有依赖"**。
- **容量上限的显式拒绝**：超出完整差分／单 Brief 上限**明确拒绝，不省略问题**（`INSPECTION_MAX_DELTA_CHANGES = 256`；超出时 `fail_closed: workspace_unavailable`）。**当前只能拒绝，尚无拆分能力**——`ArchitectureInspectionIntentV1` 没有机械检查范围／分片字段，因此没有可调用的恢复契约；登记为契约欠账（见 §8），**不截断结果伪装完整、不省略问题、不只提高上限充当解决**。
- **归属阶段**：**初始化（形成候选结构）**——项目认知初始化里"结构化"那一步；**运行（架构漂移对账）**。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| **不激活 baseline**：**不能因模型共识激活 baseline** | ControlEngine：`install`／`activate` 的 CAS 激活路径（不变量 #13／#21；本模块只产生候选与记录） |
| 不写 canonical、不做迁移决策 | ControlEngine：`recordArchitectureInspection`／`recordArchitectureFinding`／`recordArchitectureDecisionBrief`；候选提案与基线激活的登记＝Control／基线演进集成者 |
| **不把源码变化自动改写为规范** | 保留差异及其依据（架构稿 §5.5 第 6 条）；规范的变更走人的决定与治理路径（HumanCollaboration → ControlEngine） |
| **不将目录名称猜作产品 Module** | `ArchitectureSourceMapping` 显式映射；契约原话：*"Explicit, versioned mapping; a directory name is not implicitly a product Module."* |
| **不把静态 imports 称为运行时调用图** | 本模块只声明 TS/JS 语义导入；运行时关系另有来源，**当前不声明具备** |
| 不取材、不组装材料、不读 Ledger | ContextCompiler：`ArchitectureContextPort.assemble`／`BaselineEvolutionContextPort.assemble` |
| 不捕获源码、不做路径边界读取 | WorkspaceReader：`ArchitectureSourceCapturePort.capture(request)`（图读取当前返回 `unsupported`） |
| 不写正文、不判定材料授权适用性 | ArtifactVault：`put(record)`／`open(ref, accessScope)`（授权由 Vault 判定） |
| 不提供图查询投影、不做工作卡片 | ReadModelIndex（图查询视图）；`ArchitectureView` 当前实现是 `UnavailableState` |
| **不写 module ↔ 文件夹 ↔ Agent ↔ session 关联，也不以该关联作判定依据** | 写入＝ControlEngine 既有协调／记录命令族（**日常事实，不进 install／activate 审批**）；读取＝ReadModelIndex 图查询视图 |
| **不建草案治理平台** | 草案只是"还没有第一份被采用的架构"，按普通工作区权限创建与修订（架构稿 §5.1「首次建立」；L-5） |
| 不建独立图模块、不做第二个图索引机制 | 图能力由既有 Module 职责扩展承担（架构稿 §5.1「本稿立场」；U2） |
| 不裁决完成、不制造 Evidence | VerificationEngine + ControlEngine（图上的结论引用对应 session 片段、执行记录或文件版本，摘要不是事实本身） |

## 2. 对外接口

**接口命名口径**：以真实 Port／实现名为主；架构名义名用括号对照，例如 `InspectionPort.inspect`（架构名义名 `inspect(intent) → assessment ref`）。

**归属提示（避免误读）**：`contracts/architecture-reconciler.ts` 同时声明 `InspectionPort`（本模块）与 `CodeGraphPort`（**实现落在 VerificationEngine** 的 `code-graph-port.ts`）；图的数据契约（`CodeGraphSnapshotV1`／`CodeGraphQueryV1`／`CodeGraphResultV1`）是共用面，本模块只生产与消费其中的快照与差分部分。

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `InspectionPort.inspect`（现状） | harness；目标由 Host 产品入口调用 | `ArchitectureInspectionIntentV1` → `recorded` 或 `fail_closed` | pin/来源缺失、摘要不匹配或记录失败均失败关闭；不改 baseline 或 active ref | 保留；接真实图来源与 Host 产品入口尚未实现；Human 只经既有读/决定面，不新增 Human→Reconciler 边 |
| `BaselineEvolutionPort.materialize`（现状） | 基线演进集成者 | `proposalRef` 与精确来源 → `materialized`／`needs_material`／`rejected` | 只读；来源移动即 `source_stale`；重算候选摘要 | 保留候选物化；首次建立与后续演进继续分路，不并入激活 |

**内部映射（不是公共接口）**

| 内部类／文件 | 责任与共用关系 |
| --- | --- |
| `ArchitectureReconcilerImpl` | `InspectionPort` 的当前实现与编排入口。 |
| `computeArchitectureDelta`、`structuralKey`、`contentDigest` | 共用机械差分与身份/摘要规则；保持 `noVerdict`。 |
| `ArchitectureContextPort`／`BaselineEvolutionContextPort` | 本模块消费的 ContextCompiler 面，详见 §3。 |
| 图与 baseline 数据契约、容量常量 | 输入输出约束，不作为本模块另行提供的 Port。 |

**本次变化方向**：见 §7（此处只写一句指引，细节放第 7 节）。

## 3. 依赖

`allowedModuleDependencies[ArchitectureReconciler] = { ControlEngine, ContextCompiler, ArtifactVault }`——**3 条边，全部既有，本轮不新增**。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| ControlEngine | `Pick<ControlEngine,'recordArchitectureInspection'\|'recordArchitectureFinding'\|'recordArchitectureDecisionBrief'>`（`ArchitectureReconcilerDeps`） | 检查、Finding、DecisionBrief 的**逐次落账回执**，只有 committed 才继续；候选提案与基线激活的正式登记由 Control／基线演进集成者承担。本模块的 `BaselineEvolutionPort.materialize` 是 §2 提供面，只读物化、不依赖 Control | 既有 |
| ContextCompiler | `ArchitectureContextPort.assemble(intent)`；`BaselineEvolutionContextPort.assemble(proposalRef)` | 相同版本的规范、代码关系、图材料与证据；精确 plan pin 与真实 reader run 核对 | 既有（**语义收紧**：对账材料由 ContextCompiler 按 §6.2 的有界选材提供） |
| ArtifactVault | `ArtifactPort.put(record)`／`open(ref, accessScope)` | baseline／当前图、真实 delta、Brief 正文的保存与读取；**保持 reader owner** | 既有 |

**不变量与边界**：本模块不依赖 StateLedger（canonical 读取经 Context）；不依赖 WorkspaceReader（原生来源捕获经 `ArchitectureSourceCapturePort`，由 Context 转达）；不依赖 ReadModelIndex（图查询投影不在本模块）；**没有图模块，也没有 `X → 图模块` 的边**。

## 4. 被依赖

**必须显式写出：本模块当前没有任何 Module 依赖它**——反向边为 **0 条**（按架构稿 §3 的依赖 DAG 反推；本模块的 `inspect` 尚未接产品入口，当前仅 harness 可调用）。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| **无 Module**（0 条反向边） | — | — | 架构稿 §3 依赖 DAG 的反向推导；本模块的 inspect 尚未接产品入口，也没有其他 Module 的调用点 |
| 宿主边（**不计入 38 条**） | `src/composition/persistent-platform.ts` 的 `inspection?: InspectionPort`（默认 `ArchitectureReconcilerImpl`）与 `codeGraphQuery(...)` 转发；`src/app/service.ts` 的 `codeGraph` 适配 | harness 可调用 `inspect` 与图查询转发；组合根只做装配与 HTTP 适配，**不承接模块权威** | 架构稿 §3.1「三种边必须分开」；`human/module-status.md` 本模块条目：「harness 可调用 `inspect`」 |

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| **结构真相**：已接受的模块／接口／依赖 | 是 | **ArchitectureBaseline**（治理；revision 不可改写、candidate 须经 Decision + migration Gate + CAS activation，#13／#21）；本模块**只读 pin、不激活** | 初始化（形成候选结构）／架构演进 |
| `ArchitectureInspection`／`ArchitectureFinding`／`ArchitectureDecisionBrief` 记录 | 是（经 Control 落账的正式记录） | 本模块**产生** → ControlEngine 的逐次 `committed` 回执后成为正式记录 | 运行（架构漂移对账） |
| `ArchitectureDeltaV1` 原始差分 | 否（机械差异，`noVerdict: true`） | 本模块纯函数 `computeArchitectureDelta` | 运行 |
| 候选基线（`CandidateArchitectureBaselineV1`）与 materialize 结果 | 否（候选） | 本模块 `BaselineEvolutionPort.materialize` **计算**；ControlEngine 提交候选与不可变 revision | 初始化／架构演进 |
| `sourceBinding`（`ArchitectureSourceSnapshotV1`） | 是（随 baseline 内容纳入不可变治理摘要） | 本模块**核对**（reader run／数字版本／内容摘要并行）；**撰写与激活**走 ControlEngine 治理路径 | 初始化 |
| `dependencyRules`（只支持 `forbid_dependency`） | 是（baseline 内容的一部分） | 同上；本模块只按规则判定违规依赖，不改写规则 | 架构演进 |
| 图正文（snapshot／delta／brief 的 `bodyRef`） | 否（正文） | ArtifactVault；结构与关联的真相同上 | 初始化／运行 |
| **module ↔ 文件夹 ↔ Agent ↔ session 关联** | 是（**正式关联**，日常事实但不因本模块不持有而降级；不进 install／activate 审批） | **写入**：ControlEngine 既有协调／记录命令族；**读取**：ReadModelIndex 图查询视图；**本模块不写、不读该关联** | 运行（本模块只出结构差分与候选） |
| 图查询投影与工作卡片 | 否（投影） | ReadModelIndex | 全阶段 |
| 四态 `working`／`standby`／`paused`／`archived` | 否（Session／工作卡片状态） | canonical 归约在 ControlEngine；投影在 ReadModelIndex；本模块不持有 | 不适用 |

**本模块拥有的对象**：架构对账的**记录链产生权**（inspection／finding／brief 的候选与正文）；原始机械差分；候选基线的**物化结果**；`sourceBinding` 与 `dependencyRules` 的**核对判据**。在 Role／Session／Run／Work 中，本模块只持有**绑定到精确 `PlanRevision` pin 与工作区版本的检查身份**（`inspectionId`、`requestedByRunRef`），**不持有 Role／Session／Agent 的任何实体**。

**本模块不拥有的**：baseline 的治理与激活（ControlEngine）；结构与关联的真相（ArchitectureBaseline／ControlEngine 命令族）；图查询投影（ReadModelIndex）；正文持久化（ArtifactVault）；源码捕获（WorkspaceReader）；材料编译与缺口判定（ContextCompiler）；完成与证据裁决（ControlEngine + VerificationEngine）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化（项目认知初始化）／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另 §4.2 列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**。
>
> **本模块的归属阶段**：**初始化**（项目认知初始化里的"结构化"：形成**候选**结构，不是 baseline）与**运行**（架构漂移对账）。挂起·恢复在本模块尚无闭环（见 §8）。

## 6. 旧标识去向

按架构稿 §9.3（七条最小迁移规则）与 §4.5（R-1、标识取舍表）表态，属于本模块的部分如下。

- **本模块不持有 `agentId`／`workId`，也不持有 `AgentInstanceV1`**：inspect 只绑定 `PlanRevision` pin、工作区版本与 `requestedByRunRef`，**无需迁移动作**；`agentId` 的轻量实例标识归 ControlEngine 的 `registerAgentInstance`，`workId` 的权威解析归 ControlEngine（`resolveTaskWorkIdentity`）。
- **但本模块必须对 module ↔ 文件夹 ↔ Agent ↔ session 关联表态**：本模块负责**结构差分与候选**（哪个 module 与哪段 path 在结构上变了、该变化是否越界）；**关联的写入不归它**——写入归 ControlEngine 既有协调／记录命令族，读取归 ReadModelIndex 的图查询视图。关联是**日常事实，不进 install／activate 审批**；**本模块不产生正式关联**。
- **`ArchitectureSourceMapping` 是显式的、版本化的映射**：目录名不是隐式的产品 Module；旧 baseline 缺 `sourceBinding` 时保持可读、机械检查 `fail_closed`，**不回退 revision 0**，也不把新局部语义索引当作已完成架构对账。
- **草案（无 baseline 阶段）不参与漂移裁决、不产生正式关联**：正式图仍绑定基线（#20／#21）；**没有 baseline 不阻止开始工作**（L-5）。
- **旧事件语义不变**：既有事件不可原地改变 v1 含义，演进必须新增 `schemaVersion` 与兼容策略，未知版本继续拒绝（架构稿 §7.3）；旧 baseline 的 `content` 形状保持可读。
- **`structuralKey` 与摘要的兼容口径**：变更检测用归一化内容 sha256，而不是路径或目录名；旧记录的 `structuralKey` 保留可查，**不批量重写历史**。

## 7. 本次接口变化方向

**新增/复用/迁出或删除。** 目标是让现有 `inspect` 接真实图来源与产品入口，并重定义漂移判据；复用现有机械 Delta、结构键和摘要实现，不新增中间层。旧的 report-only/空来源替代路径在真实来源接通后删除或失败关闭；baseline 建立与后续演进继续走两条明确路径。以上接线与判据改造尚未在源码完成。

对应项号：**I10（主）** ｜ 接口名：`InspectionPort.inspect(intent) → InspectResultV1` 与 `BaselineEvolutionPort.materialize(proposalRef)` ｜ 方向：**baseline 演进后重新定义"漂移"判据**——不再把"与某版图不同"直接当成问题，而以**plan pin 的 baseline revision + `sourceBinding` + `dependencyRules`** 为判据基线，区分"有意变更（需演进）"与"漂移（Finding）"；**接入真实图来源与产品 inspect 入口**（当前 `WorkspaceReader` 图读取返回 `unsupported`、`ArchitectureView` 是 `UnavailableState`、inspect 只有 harness 调用点）；**首次建立与后续演进分两条路径**——**已有代码库**先只读探索，**新项目创建目录／说明／模块接口文档需要普通工作区权限**，**无 baseline 不阻止开始工作**（首次建立不要求一个不存在的"旧 baseline"，后续演进才走"候选变更 → 影响／迁移检查 → 决定 → CAS 激活"）；**候选生产／门禁检查／人的决定／正式登记与激活四面分开**——候选生产＝本模块（`inspect` + `BaselineEvolutionPort`），门禁检查＝VerificationEngine 的**只读** `MigrationGatePort`，人的决定入口＝HumanCollaboration 的 `ArchitectureDecisionPort`，正式登记与 CAS 激活＝Control／基线演进集成者；本模块**只保留自己实际需要的窄接口**；**不建草案治理平台**，草案不参与漂移裁决、不产生正式关联 ｜ 边动作：**保留**（`→ ControlEngine`／`→ ContextCompiler`／`→ ArtifactVault` 三条依赖边语义各自不变；`ArchitectureReconciler → ContextCompiler` 为**既有边、语义收紧**；**不新增边**，也不新增图模块）｜ 理由：C7 与审阅 §3.6——模块边界变更后 baseline 必须同步演进，否则 Reconciler 会把**有意变更**误报为漂移（架构稿 §4.4 第 5 行）；而新项目在没有 baseline 时需要能开始工作，两条路径不能混成一个"探索永远只读"的流程；候选生产者不得因共享契约文件而获得决定或激活的权力 ｜ 不变量：**#12／#13／#20／#21／#22**（图不成为第二权威、摘要必须能回到来源核验；材料分级另涉 #28）。

## 8. 信息缺口

**这是三个 Control 模块里信息最薄的模块**（`control/architecture-reconciler/`：3 文件 / 260 行；`architecture-reconciler.ts`、`architecture-delta.ts`、`baseline-evolution-port.ts`），缺口按实写足。

- **对齐架构稿 §11.4.3**（引用，不重新推导）：① 持久字段、主键与基数约束 → 架构稿 §9.2 第 1 份契约（本模块相关的是 inspection／finding／brief／candidate 的聚合身份与基数）；② 各 Port 的精确形状、字段命名、装配点 → 架构稿 §9.2 第 2／4 份契约（**产品 inspect 入口与图来源 producer 的装配点在此**）；④ 迁移切换点、删除顺序与回滚方式 → 架构稿 §9.2 第 4 份契约与 Prompt 6；⑤ **草案承载形态与转换门禁判定者、探索计划 UI 入口** → 架构稿 §9.2 第 1／4 份契约（本模块是候选结构的一侧，草案承载形态直接决定"首次建立"如何落地）；⑥ 度量口径的具体采集实现 → 按 U12 指标表，标"待测"。
- **本模块新增缺口**：
  1. **未接产品 inspect 入口**：`inspect` 当前只能由 harness 调用（`composition/persistent-platform.ts` 的 `inspection?: InspectionPort`）；产品侧的触发点、路由与权限形状属接口参数（架构稿 §9.2 第 2／4 份契约）。
  2. **真实初始 `sourceBinding` 缺失**：真实初始基线（第一份被采用的架构）如何产生并绑定 `ArchitectureSourceSnapshotV1` 尚未闭环；早期基线只有 `description` + `constraints(name, scope)`，没有 pin 到源码 commit／工作树快照／CodeGraph 版本的字段或解析规则。
  3. **完整语义架构审阅缺失**：模块内只有机械路径（差分 → Finding → Brief → 逐次回执）；**语义架构审查**（判断"这个依赖变化在业务上是否可接受"）与真实角色消费仍未形成闭环（`human/module-status.md`：「未接产品 inspect、真实初始 sourceBinding、完整语义审查和 MigrationGate」）。
  4. **`MigrationGate` 完整行为缺失**：门禁的完整行为与真实 provider 仍未落地；`MigrationGatePort` 在无真实检查／Evidence provider 时返回 `unsupported`，**版本相等不能证明检查通过**。
  5. **固定 Finding 与 revision 0 基准待修**：`2026-09-08` 登记的"固定 Finding 与 revision 0 基准仍待修"作为历史缺口保留；`2026-09-09` 的来源绑定已替代其一部分（缺 binding 时 `fail_closed`、不回退 revision 0），但**固定 Finding 的替换**仍需按新判据收口。
  6. **只声明 TS/JS**：图端口能力仅 TS/JS 语义导入，**未映射源码与缺失依赖保留 `unresolved`**；C++/Python 必然 `unsupported`，不得据此推断"没有依赖"。
  7. **仍非文件系统原子快照**：源码前后摘要核对与数字版本核对并行生效，但**不是文件系统原子快照**；HEAD 到当前工作树可以有已知文件表，缺少 Run 前态时变化范围仍未知，不得采信调用方的"无变化"声明。
  8. **恢复与长流程未闭环**：初始基线准备／演进 UI、规则判定与真实角色消费、完整恢复仍待后续闭环；本模块不声称长流程与压缩排版已完成可读性重构。
  9. **C-10**：`control-engine/policies/**` 被跨模块直接 import 的边界气味同样适用于图能力（跨模块只能经**声明 Port** 消费）；按 架构稿 §9.1 收窄列／§11.4.2 C-10 处理，**不新增 Module、不新增 DAG 边**。
  10. **`WorkspaceReader` 的图 producer 缺口**：`ArchitectureSourceCapturePort`（`data/workspace-reader/architecture-source.ts`）与图读取当前返回 `unsupported`（`FakeWorkspaceReaderAdapter` 仍默认装配）→ 本模块的真实来源在实现面上被上游卡住；按 架构稿 §9.1 本模块「新增」列与本模块「替换（改接法）」列处理，属实现工作（§11.4.2 末段「图 producer、`moduleId` 与协作投影」）。
  11. **超容量后无恢复契约（契约欠账，独立于第 10 项）**：差分超过 `INSPECTION_MAX_DELTA_CHANGES = 256` 时当前**只能拒绝**（`fail_closed: workspace_unavailable`），**尚无拆分 inspection 范围的能力**：`ArchitectureInspectionIntentV1` 没有机械检查范围／分片字段，也没有规定分片者与跨片覆盖汇合；在补齐"同版本分片、跨片边界与完整覆盖汇合"的契约之前，**不声称存在可调用的恢复路径**，也**不截断结果伪装完整、不只提高上限充当解决**。字段与归属属 架构稿 §9.2 第 2／4 份契约。

## 9. 重构目标与质量验收

本节已纳入本轮模块文档要求；通用依据见[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。以下均为目标，**源码达成待验证**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| §1 的 `inspect` 串联取材、差分、保存和逐项登记；§8 的真实图来源和产品入口未接 | 保持入口为清晰编排，分开机械差分、分类、持久和登记；不新增 service/repository 或图模块 | `computeArchitectureDelta`、`structuralKey`、`contentDigest` 继续共用；读取、正文和正式记录仍归 Context、Vault、Control | 从入口追到失败和已发生副作用，真实适配器与 harness 分开报告（RG-01、RG-02、RG-05；CQ-01、CQ-02、CQ-07、CQ-08） |
| §2 的多次 Control 登记可能部分成功，且只有 committed 才能继续 | 保留 `recorded/fail_closed`、拒绝详情和已提交记录，不伪装原子成功 | Control 在自身内部通过 S01 共用回执映射；本模块只消费公开回执并在拒绝后停步，不直接引用 Control 内部支持 | 第 N 次拒绝后无后续登记、此前记录可查、同身份重试不改 inspection 时间（RG-03、RG-04；CQ-03、CQ-06、CQ-08；S01） |
| §1/§8 的 256 上限只有显式拒绝，来源 pin、mapping 和 unresolved 也不能被猜测 | 保留拒绝且不截断；分片 schema 后置；保持 `noVerdict`、显式 mapping 和来源核对 | 材料步骤复用 S06，架构专用 pin/sourceBinding/差分约束保留；无旧整包路径退役承诺 | 覆盖超限、缺 binding、摘要移动、unresolved、无 provider；不增加 38 边（RG-01、RG-04；CQ-03、CQ-06、CQ-11；S06） |

专项关注：机械差分保持无 verdict，逐项登记的部分副作用可见。状态：真实图接线、产品入口和容量恢复契约待验证。
