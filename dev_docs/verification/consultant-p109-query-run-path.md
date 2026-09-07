# 咨询 Agent C — P1-09 QueryJob 独立只读 Run 生成/驱动路径裁决

ticket_ref: P1-09（未开工）
role: consultant (C) — read-only analysis
结论可复现：全部依据来自本仓库 docs（模块/接口文档 + 冻结 Ticket 形状）；**本仓库无 src/ 源码**（find 全树 '*.ts' = 0），故 src/control/*.ts 与 src/contracts/*.ts 均为“设计态”路径，按模块文档与冻结形状裁决，无实现源码佐证。凡依赖实现源码处一律标“未证实”。

---

## 0. 关键证据链（已精读）

- worker-runtime.md §Extension records：P1-03 冻结 RunPort=capabilities/start/events（supportsSnapshot=false, maxEnvelopeBytes=64KiB）；“Run 身份”列为 Hidden Implementation（Run 身份是适配器内部细节，非契约强制字段）。※ **未证实** RunPort.start 是否允许非 Task/Attempt 锚点的 envelope。
- dispatch-engine.md §Extension records：P1-03 冻结 DispatchPort.drive(trigger) 唯一入口；outbox-before-side-effect：加载 pending → assemble → startRun 提交 → 之后才 runtime.start。P1-06 用 driveHandoff（replacement intents 专用面；normal drive 扫描前跳过带 ReplacementAttempt 的意图）。P1-07 用 WorkspaceDrivePort.driveParallel（版本化新增，**不改 P1-03 DispatchPort**；run-scoped 幂等键）。→ **既有扩展范式 = 新增专用 drive 面，绝不再编辑 DrivePort 字段**。
- runtime-collaboration.md：line 19 Run 引用绑定版本；line 43 HumanCollaboration.query → fact(ReadModelIndex)/report(公开快照经 DispatchEngine+WorkerRuntime)/pending(独立 QueryJob)/unavailable/rejected；line 46 DispatchEngine.drive “所有角色复用该路径”；line 48 WorkerRuntime 可选 snapshot(query)，capabilities 显式声明，无能力→unsupported；line 76 查询显式区分 fact/report/新语义回答，pending 返回独立 QueryJob ref，unsupported/stale 不自动伪装成最新回答，仅当请求允许+预算授权才转 QueryJob；line 78 QueryJob 不改源 Worker Context/lease/预算/任务义务，快照只读不注入；line 96 机械查询无模型调用，独立 QueryJob 不干扰源 Run。
- P1-07 Ticket：两个只读 Reader Run + 一个 Writer Run，**各自有独立 Attempt/Context/预算/来源**；Reader 不改目标 Workspace，输出只作 Evidence/Artifact/Handoff；经 DispatchEngine.drive/accept 并发与预算。→ Reader Run **是 Task**（DAG 节点）只是只读能力。
- P1-06 Ticket：HandoffControlPort.snapshot 只返回公开报告（noHiddenContextRead）。
- ticket 09 contracts_to_create：SubmitQueryJobCommand / QueryContextRequest / QueryJob / QueryJobResult / QueryJobView；interfaces_to_freeze：DispatchEngine.SnapshotPort、WorkerRuntime.PublicSnapshotPort、HumanCollaboration.QueryJobPort、ContextCompiler.QueryContextPort、WorkerRuntime.ReadOnlyQueryPort。

---

## 1. 语义裁决：**推荐 (c) — 复用 P1-03 Run 聚合 + 驱动路径，QueryJob 独立聚合只负责状态机**

### (a) 伪 task 映射：taskId="query-job:<id>" —— **拒绝**

- 违背 ticket 09 硬约束：“QueryJob 具有独立 ID、Run、Context、预算、超时和只读权限”“源 lease/TaskAttempt 不被 QueryJob 改变”。走 P1-03 claim/readiness 会产生 TaskLease/TaskAttempt，并进入 P1-05 任务态归约，直接违反“不改变任务态”。
- 污染 P1-07 语义：Reader Run **是** Task（合法），QueryJob **不是** Task（无 RuntimeExecutionDAG 节点、无 depends_on、无 CompletionPolicy）。二者不能同构。
- **严重度：高（硬违反约束）。** 排除。

### (b) 新建 QueryRun/QueryAttempt 聚合 + 独立 commitKind（平行于 P1-03）—— **不推荐**

- 优点：下游 P1-10/15 消费一个专用 QueryJob 形状，不触碰 P1-03 Run 投影。此项被其总代价抵消。
- 缺点：完整复制 Run/Attempt 生命周期不变量（幂等启动、重放、cursor、crash/outcome_unknown 分流），事件/commitKind 面翻倍，需独立投影；违背 runtime-collab line 46 “所有角色复用该路径”与 worker-runtime“Run 身份=隐藏实现”的复用方向。
- 违背“最小”。**实现面最大**。
- **注意**：其“下游最少改动”优点在 (c) 下同样成立——(c) 也提供**专用** QueryJob/QueryJobView 契约供下游，只是底层复用 Run 路径。故 (b) 不存在相对于 (c) 的下游优势。

### (c) 复用 P1-03 Run 聚合 + RunPort + drive 路径，QueryJob 聚合负责状态机 —— **推荐**

- 复用 startRun / RuntimeEvent / cursor / run-scoped 幂等键（P1-07 已验证 run-scoped 幂等键），“所有角色复用该路径”。
- 只做**版本化追加**：新增 QueryJobIntentV1 进入**独立 outbox/队列** + 新增 QueryJobDrivePort.driveQuery（P1-06/07 同款新增专用面）；**不编辑** DispatchPort.drive、不动 DispatchIntentV1 字段、不改 P1-03 RuntimeEvent commitKind。
- 满足全部硬约束：只读（复用 P1-07 WorkspaceCapabilityPort.evaluateWorkspaceOperation → reader 无写能力）；不触碰源 Run lease/context/budget；多轮澄清 rounds≤4（复用 P1-16 WorkContextBinding/ContextContinuationResult，且绑定主体=QueryJob 而非源 Run）；超时/缺口/过期可观察（状态机终态可投影）。

### 1.0 唯一“需人类确认架构粒度”点：Run 是否可无 Task/Attempt 锚点

(c) 的前提是 Run 聚合可无任务锚点（worker-runtime 将 Run 身份列为隐藏实现、contracts 列表**不含** Run 独立聚合，暗示可非任务实体化）。但**无源码佐证 RunPort.start 是否接受非任务 envelope**（未证实）。若被否决，则退化为 (b)。粒度选项（标“需人类确认架构粒度”）：

- **Granularity-A（推荐）**：Run 无任务锚点 — 用 runRef 作生命周期锚 + run-scoped idempotencyKey（P1-07 已有先例）；RunPort.start 直接消费 QueryJobIntentV1。
- **Granularity-B**：RunPort.start 增加版本化重载 startQuery(queryJobIntent)（只枚举追加，不改既有字段/签名）；仍复用 Run 聚合，最保守。
- **Granularity-C（回退）**：走 (b)，QueryRun/QueryAttempt 平行聚合——仅当 A/B 均被架构否决时启用，实现面最大。

> 判定：存在优雅解 (c)，无需就“整体无解”提交人类；**仅“Run 锚点可选性”这一维度**需人类确认架构粒度（上列 A/B/C）。

---

## 2. 真冲突 / 契约冲突面（逐条）

| # | 冲突点 | 严重度 | 选项（≥2） | 推荐 | 理由（对既有测试/冻结形状/下游 P1-10/15 影响） |
|---|--------|--------|------------|------|----------------------------------------------|
| 1 | QueryJob 无 Task/Attempt vs P1-03 startRun 按 Attempt 供给 | 中 | ① Run 无锚点（A/B）② 平行聚合（b） | ①（A，回退 B，兜底 b） | QueryJob 无 DAG 节点/无 CompletionPolicy；A 复用 startRun+run-scoped 幂等键，零改动 P1-03 事件；B 仅版本化重载；b 面最大且与“复用该路径”矛盾。对既有 P1-03/05/06/07 测试零 diff；下游 P1-10/15 消费新 QueryJobView，不触碰 Run 投影。 |
| 2 | DrivePort.drive 扫描 vs 查询意图落入同 outbox | 中 | ① 独立 outbox/队列，drive 永不看到 ② 同 outbox + “normal drive 跳过 QueryJob 类意图”（P1-06 先例） | ① | ①对 P1-03 freeze 零改动；②需在 drive 扫描加一分类规则（版本化枚举追加，可接受但不若①干净）。任选其一对既有 compete-claim / outbox-before-side-effect 测试无回归。 |
| 3 | DispatchIntentV1 的 taskId 必填 | 中（潜在高） | ① 改 taskId 可空 ② 另建 QueryJobIntentV1 | **②** | ①违背“不改既有聚合字段”（冻结字段不可改/可空化）；②版本化新增，尊重 P1-03 冻结。选项(a)哨兵值“query-job:<id>”属①的反模式，排除。下游 P1-10/15 只看 QueryJobIntentV1，零影响。 |
| 4 | “无写目标 Workspace/无 CompletionClaim/不刷 lease” 落地 | 低 | 复用 P1-07 WorkspaceCapabilityPort(reader) + ControlEngine 预算/权限校验；Noop 写拒绝 | 复用 | 纯能力分配，属“只版本化追加”。QueryJob 意图无 taskId/goalId、无 DAG 节点，P1-05 reducer 天然不可触达；触发 P1-04 completion 所需 Evidence 路径不绑 QueryJob。对 P1-07 read-only-capability 测试复用。 |
| 5 | QueryJob 自预算/rounds≤4 vs 源 Run 预算不变 | 低 | 独立预算（ControlEngine 校验）+ 源 Run 不挂接 QueryJob 预算 | 独立 | 隔离，非结构冲突。保证源 Run 不读 QueryJob 预算/token。 |
| 6 | 多轮澄清（rounds≤4）与 P1-16 连续性 | 低 | QueryJob 直接消费 WorkContextBinding/ContextContinuationResult，绑定主体=QueryJob | 消费而非改写 | P1-16 已冻结；QueryJob 是消费者。关键：绑定主体必须是 queryJobId，绝不写回源 Run 的 context/binding。对 P1-16 WorkRecordPort 零 diff。 |
| 7 | P1-08 ReadModelIndex 机械查询 vs QueryJob 创建 | 低 | 机械→ReadModel 直答；语义→QueryJob | 路由分流 | runtime-collab line 43/76 已明确；无冲突。 |

**结论：除冲突 1 的“Run 锚点可选性”需人类确认粒度外，其余均为“版本化追加”即可优雅解决，不违反 P1-03/06/07 冻结形状。**

---

## 3. 归属（文件 / 区域 / 归 P1-09 哪个 lane）

设计决策落点（docs 为设计态，源码路径为建议开工后落点）：

- **控制/派发区域**：dispatch-engine.md（Extension records 追加 QueryJobDrivePort 条目）；开工后 `src/control/query-job-drive.ts`（QueryJobDrivePort.driveQuery，复用 startRun/RuntimeEvent/run-scoped 幂等键）。→ **P1-09 lane: query-drive**。
- **契约区域**：`src/contracts/query-job.ts`（QueryJobIntentV1 / QueryJobState{pending→running→answered/closed + aborted/timeout/stale} / SubmitQueryJobCommand / QueryContextRequest / QueryJobResult / QueryJobView）。→ **P1-09 lane: query-contract**。
- **运行时只读区域**：`src/runtime/read-only-query-adapter.ts`（ReadOnlyQueryPort；capabilities 诚实声明无写能力）——对应 ticket09 interfaces_to_freeze 的 WorkerRuntime.ReadOnlyQueryPort / PublicSnapshotPort。→ **P1-09 lane: query-runtime**。
- **投影/读取区域**：read-model-index.md（query-job-view 新增投影；现有事件投影不动）+ human-collaboration.md（QueryJobPort）。→ **P1-09 lane: query-view**。
- **只读消费、严禁编辑**：dispatch-engine.md 的 DispatchPort.drive、DispatchIntentV1（taskId/goalId 必填）、P1-03 RuntimeEvent commitKind 集合、P1-05 goal reducer、TaskLease/TaskAttempt、P1-16 WorkRecordPort。→ 归 **P1-03/05/16 冻结形状**，P1-09 只消费。

---

## 4. 可执行条款（供 B 派发的 write_scope 与验证断言）

### write_scope（允许写入）
- [新增] src/contracts/query-job.ts — QueryJobIntentV1、QueryJobState（含终态 aborted/timeout/stale）、QueryJob 聚合状态机、QueryJobResult/View。
- [新增] src/control/query-job-drive.ts — QueryJobDrivePort.driveQuery（outbox-before-side-effect：加载 query pending → assemble(QueryContextRequest) → startRun 提交 → 之后 runtime.start；run-scoped idempotencyKey）。
- [新增] src/runtime/read-only-query-adapter.ts — ReadOnlyQueryPort。
- [修改·仅消费] src/data/read-model-index.ts — 新增 query-job-view 投影（新 commitKind，不改既有投影）。
- [修改·仅文档] dispatch-engine.md / worker-runtime.md / runtime-collaboration.md / read-model-index.md 的 Extension records。

### write_scope（禁止触碰）
- DispatchIntentV1 字段（不改/不空化 taskId/goalId）；DispatchPort.drive；outbox-before-side-effect 顺序；P1-03 RuntimeEvent commitKind；TaskLease/TaskAttempt 创建路径；P1-05 reducer；P1-16 WorkRecordPort 字段；源 Run lease/context/budget 写入路径。

### 验证断言（新增单测）
1. **query-job-no-task-leak-test**：创建并作答 QueryJob 全程产生 0 TaskLease/TaskAttempt、0 RuntimeExecutionDAG 节点、Task phase 无任何变化。
2. **query-run-isolated-test**：QueryJob pending→running→answered 期间，源 Worker current phase/lease/context/budget 与事件 cursor 完全不变。
3. **read-only-enforcement-test**：QueryJob Run 经 WorkspaceCapabilityPort(reader)；evaluateWorkspaceOperation 对 query scope 任意写操作返回 rejected；WorkspaceDrivePort 无任何写成功。
4. **query-budget-timeout-test**：QueryJob 超预算/超时 → 状态机转 timeout/closed，源 Run 不受影响。
5. **query-rounds-bound-test**：followup ≤4；第 5 轮返回 closed/exhausted；followup provenance 引用上一 QueryJobResult。
6. **query-context-bound-test**：QueryContextRequest bundle ≤ 硬上限，仅 selectedRefs+来源，不含隐藏思维链/完整 transcript。
7. **query-drive-not-intruding-test**：DispatchPort.drive() 不消费 QueryJob 意图（独立 outbox/队列）——任务意图 outbox 扫描行为不变。
8. **query-stale-test**：selectedRefs 对应 Evidence/Artifact 陈旧时回答标记 stale；unsupported/stale 快照不自动伪装为最新回答，除非请求允许且预算授权。
9. **no-phase-overwrite-test**：QueryJob 失败/超时不写 Task/Goal phase（复用 P1-05 reducer 不可达断言）。

---

## 5. 未证实项
- RunPort.start 是否接受非 Task/Attempt 锚点的 envelope（Run 锚点可选性）——无源码佐证，见 §1.0。
- DispatchIntentV1 wire 字段是否含“查询类 commitKind 预留”——未证实；建议以新 QueryJobIntentV1 规避，不依赖既有字段可扩容。
- P1-09 尚未开工，无实现证据可引；本裁决为设计/契约层结论。
