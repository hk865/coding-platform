# M7 预备：Session 数据面与 Memory 积累预研（基于分级压缩策略）

> 状态：预研（presearch），非实施计划。结论用于指导 M7-01～M7-07 的落地顺序与接口边界。
> 依据来源：
> - `deepseek-harness-plugins/compaction-hierarchical`（实现）、`compaction-hierarchical-docs/DESIGN.zh.md` 与 `DESIGN-v4-state-semantic.zh.md`（权威设计）、`REAL_SESSION_ALL_ARCHIVES_2026-08-31.zh.md`（真实归档验收）
> - coding-agent 当前实现：`src/core/`（context/runtime/ports）、`src/storage/`、`src/memory/`、`docs/development/m7-context-compaction-multi-agent-plan.md`、`docs/adr/0002-node-sqlite-session-storage.md`
> 日期：2026-08-31

## 1. 预研问题

在 DSH 分级压缩（Hierarchical Compaction）体现的 context 思想下：

1. coding-agent 的长会话能力需要哪些**数据面基础设施**（相对当前实现的缺口）？
2. 这些基础设施**如何实现 compact 策略**（分层机制、接口形状、不变量、验收）？
3. **Memory 积累**与压缩策略是什么关系，项目级长期记忆应如何设计？

结论先行：压缩的真正难点不在"让模型写摘要"，而在**程序侧的状态编译与投影基础设施**。插件实测 30 个切点中，模型无关的 L1 加权节省约 4.7%、L2 约 5.5%，而 L3 检查点把最终节省推到 64%–89%——但 L3 的 durable state 全部由程序生成，模型只提供有界语义 IR。因此 coding-agent 应先补齐数据面（事实层、Artifact、投影、账本、状态编译、watermark），再谈摘要器。

## 2. 分级压缩策略体现的 Context 思想

> **来源口径注记（2026-08-31 核实）**：本文第 2、5 节对 L2 的描述（closed phase + 七字段 `PhaseSemanticIR`）是**文档口径**（插件 README.zh.md / DESIGN.zh.md / docs DESIGN-v4），即 schema 4 phase-L2。**代码生产路径已切换为 schema 5 step-L2**（`compileClosedSteps` + `compactClosedStepBatch`，engine.ts 只调用此路径；旧 `compactOneClosedPhase` 已标 deprecated、从包根导出移除）。step-L2 以原生 `{turn,step,callId}` 身份编译 closed SDK step、只折叠完全 L1 物化（强 rehydration）的 span、每批一次模型调用且模型只能输出 `semanticResidual`/`unresolved`、receipt/stateDelta 程序生成、落地 schema-5 envelope + `L2StepAuthorityV1` 锚、摊销门控 `expectedFutureRequests=3`。两种 L2 共享的思想（闭合才可压缩、模型只补有界语义、状态真值程序拥有、fail closed、正收益门控）不变；本文引用其思想时两种口径均成立，若照搬实现请以 step-L2 形态为准。插件文档本身存在多份冲突（README/DESIGN 落后于 V4_COMPLETION_STATUS 与代码；`compaction-hierarchical-docs/` 与 `deepseek-harness-plugins/compaction-hierarchical-docs/` 两份副本不同步，diff 518 行），阅读顺序建议：V4_COMPLETION_STATUS → REAL_SESSION_ALL_ARCHIVES → L2-L3重构实施指南（唯一区分"当前/目标"标记）→ DESIGN-v4 → DESIGN.zh.md（v3 能力表）。



### 2.1 事实与投影严格分层

```text
append-only session events（唯一事实源，审计与离线恢复）
        └─ 各种派生投影：Model Context / Web / Audit / Memory
              └─ Compaction 只是 Model Context 投影的策略，不是事实写入
```

- 原始事件永不删除、永不改写；压缩产物是**替换投影**，必须携带 `sourceEventSeqs`（来源区间）、SHA-256 digest、schema 版本、`retrieval` 能力声明；
- 压缩结果是"可失效、可重建"的：摘要损坏、版本不兼容或来源校验失败时回退原始事实重建（fail closed）；
- 插件一个关键纪律：**不写自定义会话事件类型**。折叠 watermark 从"最新一条结构有效的 plugin-origin replacement"（已知类型 `user/message`）派生，保证持久化 catalog 天然认识全部落地事件、真实重启加载不会拒绝含折叠历史的日志。任何新增会话记录类型都必须版本化并有迁移/拒绝语义。

### 2.2 职责按"事实权限"划分，不按"是否出现模型"划分

| 层 | 模型参与 | 程序拥有 |
|---|---|---|
| L0 准入 | 无 | 工具结果入 Surface 的有界化（原文留 Log） |
| L1 平衡区间折叠 | 无 | 操作账本投影：typed facts + current state + 逐字 assistant 文本 |
| L2 阶段语义 | 只补七字段 `PhaseSemanticIR` | 阶段边界、状态编译、校验、收益门控、原子替换 |
| L3 全局检查点 | 只生成十节有界 IR | 边界、校验、确定性渲染、durable state pack、事务 |

状态真值由程序拥有：任何模型文本都不能把 failed/aborted mutation 写成成功、不能推进 entity version、不能把 partial 观察声明为 complete、不能删除 open 链中的 reasoning。

### 2.3 程序状态编译是核心资产

- **Typed Operation Ledger**：`call + result + meta + error + seq → OperationFact[]`，确定性、可重放、带 source refs；只有成功 mutation 推进状态，失败保留 `failed …; state unchanged`；
- **Schema 4 状态时间线**：按 canonical path 编译 `baseline → transitions → current`，覆盖 complete/windows/unknown、validation、inconsistency、失败、回滚、net edit；chronological delta（每个 transition 引用直接前驱）；
- **Read 语义**：首次观察、同版本窗口折叠计数、分页窗口合并、重叠行 diff（绝不推断文件增删）、mutation 后 read 归并为 validation；
- **Working Set**：hot/warm/cold 按"继续工作风险"降级，活跃文件超预算也保持 warm 不降 cold。

### 2.4 有界语义投影 + fail closed

- 模型只输出固定词汇：L2 七字段（intent/decisions/failedApproaches/evidence/result/next/constraints），L3 十节 canonical bullet；
- 程序严格校验（精确键集合、条目/字符上限、非全空），有限重试后仍无效 → fail closed（原始阶段保持逐字）；
- 经济性门控：只有 `savingsTokens > 0` 且摊销收益为正才提交。实测 39 次 L2 摘要调用 18 提交、21 拒绝，全部拒绝都是 non-positive-amortized-gain（典型：b807dc11 单次仅省 603 token、摘要输入 9.2K → 拒绝）。

### 2.5 压力、时机与继续工作优先

- 四档压力 `healthy / soft / hard / critical` 由 `projectedPeak = currentInput + expectedNextRunIngress + reservedModelOutput + reservedToolBatchIngress + safetyMarginTokens` 推导；
- 正常 pre-step 至多一个历史重写动作（单动作不变量）；overflow 是唯一例外；
- 语义任务锚点：可折叠区间从 surface 上**第一个真实 user 任务**之后开始，绝不按位置计数；
- 保留 open phase、active reasoning、recent raw tail（`retainRatio`）与 hot 工作集；
- 迟滞：watermark 门控避免每个 pre-step 重写前缀；缓存感知推迟有持久上界。

### 2.6 能力诚实

`recoveryRefs` 只接受 `archival-only`：没有模型可调用的只读恢复 API 之前，所有投影都声明"仅归档可审计"，不承诺"可恢复原文"。L3 检查点超出 durable pack 预算上限时零追加 fail closed（实测 30 切点中 6 个因此未落地，宁可保存率低也不放松强校验）。

### 2.7 实测结论（用于设定 coding-agent 的目标量级）

| 指标 | 结果 |
|---|---|
| 数据 | 6 个真实归档 × 5 切点 = 30 cuts，原生 decoder + Session.fromRestore |
| L1（无模型） | 加权节省 4.72%，min/median/max 0 / 5.66% / 7.52% |
| L2（程序边界+IR） | 加权节省 5.53%，边际 0 / 0.65% / 6.31% |
| L3（检查点） | 加权最终节省 64.32%（旧两份 85.34%），落地 24/30 |
| 正确性 | source refs 4,516 条 invalid=0；recon mismatch=0；Authority live/restart/continuation 全通过 |

结论：**无模型折叠只能省个位数百分比；大头在结构化检查点，但检查点的正确性全部依赖程序状态编译**。这直接决定 coding-agent 的投入顺序。

## 3. coding-agent 数据面现状盘点

### 3.1 已有（与压缩思想兼容的部分）

| 能力 | 现状 | 与分级压缩的关系 |
|---|---|---|
| append-only Session | SQLite（ADR-0002），`session.created / turn.started / agent.event` 三类记录，position + SHA-256 checksum + revision 乐观并发 | 事实源已就位；插件架构同款前提 |
| KernelEvent 闭集 | `run.started / model.request_started / model.usage_recorded / assistant.message_completed / tool.started / tool.completed / tool.failed / tool.cancelled / tool.outcome_unknown …`，strict zod schema | 天然的 L2 候选边界事件；`tool.completed/failed/cancelled/outcome_unknown` 已覆盖插件 reducer 需要的 status 词汇 |
| EventDelivery | required/best-effort Sink 提交顺序；先记账再生效 | 插件"compaction/prune 紧跟 replacement"的原子性要求可在此层扩展 |
| CheckpointStore | 带 checksum 的派生快照 | 与"派生可失效"思想一致 |
| ContextSelectionPolicy | 确定性预算裁剪（estimate = serialized/3），记录 `removed` | 只有"裁剪"，没有"替换"；是未来 identity projection 的雏形 |
| ContextBuilder | 组装 `{role:"tool", callId, result}` | 工具结果**原样全量**进请求——L0 准入缺失的直接证据 |
| MemoryProviderPort | `recall/write` + `MemoryItem{id, content, priority, source, createdAt}`；生产注入 `empty`；`project_memory` 占位 | 端口形状正确，无实现 |
| Recovery | Session 重放 + checkpoint 对账 + `tool-outcome-unknown` 合成保守结果 | 与插件"结果未知不许猜成功"一致 |
| Context Compactor | `src/core/context/compactor/` 仅 README 占位，主链路不调用 | 明确的方向声明（不改写 Session、保护当前消息与未闭合 ToolCall、失败回退 SelectionPolicy），无实现 |

### 3.2 缺口（对照分级压缩的数据面需求）

1. **无 L0 准入**：超大 tool result（bash 长输出、大文件 read）直接内联进模型请求；
2. **无 Artifact Store**：大输出、完整 write 参数、测试报告全部内联在 Session 记录（M7-02 已计划，未实现）；
3. **无 Typed Operation Ledger / reducer**：call + result 没有被归约为结构化事实，无法程序化重放文件状态；
4. **无状态时间线编译器**：没有 baseline/transitions/current/coverage、read 窗口合并、chronological delta；
5. **无阶段（phase）识别**：没有 run 内候选边界、open/closed 状态；
6. **无投影契约**：Context 构建没有 `sourceRanges / omissions / artifactRefs` 的显式契约（M7-03 已计划，未实现）；
7. **无 watermark/epoch**：没有"折叠推进到哪条记录"的持久化机制，任何重写动作都无从迟滞；
8. **无压力引擎**：只有 SelectionPolicy 的简单预算裁剪，没有四档压力、projectedPeak、expected ingress；
9. **Memory 无实现**：无积累、无失效、无来源版本化。

## 4. 数据面基础设施需求

### 4.1 数据面定义

**数据面** = 会话事实的持久化与读取基础设施，加上在其之上构造所有派生视图（Model Context、Web/Audit、Memory）的统一层。控制面（AgentHost/Supervisor/Driver/Inbox）只消费数据面提供的投影，不直接改写事实。

### 4.2 分层清单与落点

```text
D0 事实层   Session Store（已有，需扩展记录类型与原子批）
D1 内容寻址  Artifact Store（新增）
D2 投影层    ContextProjectionPort（新增；identity + 压缩两种策略）
D3 账本层    Typed Operation Ledger + reducer registry（新增）
D4 状态编译   FileTimeline 编译器 + working set（新增）
D5 语义投影   PhaseSemanticIR + checkpoint 渲染（占位 → 实现）
D6 记忆层    Project Memory provider（占位 → 实现）
横切         TokenMeter、Metrics、恢复对账（已有骨架）
```

### 4.3 各项基础设施的形态

**D0：事实层扩展（`src/storage/` + `src/core/ports/session_store/`）**

- Session 记录类型保持闭集，但需版本化扩展：新增 `projection.created`（压缩/投影落地记录，含策略版本、来源 position 区间、canonical digest、artifactRef）、`artifact.ref`（引用）类记录。受插件"不写自定义事件类型"纪律启发：**新增记录类型必须进 strict schema 并随 schemaVersion 升级**，未知版本 fail closed（ADR-0002 已定此语义）；
- 原子性：插件受困于"逐事件 append 可能留下 log-only prune"。coding-agent 的 SQLite 短事务可做**单事务多记录写入**（replacement + 账目记录同批提交），应把"投影替换"设计为一条事务内的 record 批次，从源头消灭悬空对；
- watermark 派生：与插件一致，从**已知记录类型**推导折叠推进位置（如最新一条 `projection.created` 的 position），不依赖进程内计数器，重启可确定性重建。

**D1：Artifact Store（新增，建议 `src/storage/artifacts/`）**

```ts
// Core Port（src/core/ports/artifact_store/artifact-store-port.ts 风格）
export interface ArtifactStorePort {
  put(input: { digest: string; mediaType: string; bytes: Uint8Array; metadata: ArtifactMeta }): Promise<ArtifactRef>;
  get(ref: ArtifactRef, options: { signal: AbortSignal }): Promise<Artifact | undefined>; // 校验 digest
  stat(ref: ArtifactRef): Promise<ArtifactStat | undefined>;
  listRefs(sessionId: string): Promise<readonly ArtifactRef[]>;
  deleteUnreferenced(sessionId: string): Promise<number>; // mark-and-sweep，禁止删除仍被 Session 引用的
}
```

- 内容寻址 + SHA-256 校验；正文与元数据分离；Session 只存 `artifactRefs`（digest、mediaType、size、摘要、校验）；
- 配额：单 Artifact / Run / Session 三档，超限产生模型可见、可审计的失败（M7-02 已有此设计，落实即可）；
- 这同时是 L0 的物理前提：tool result 截断的正文落 Artifact，模型 Surface 只留引用与头尾。

**D2：投影层（新增，`src/core/context/projection/`）**

```ts
export interface ContextProjectionPort {
  project(input: { session: SessionRef; boundary: ProjectionBoundary; budget: TokenBudget; profile: ProjectionProfile }): Promise<ContextProjection>;
}
export interface ContextProjection {
  projectionId: string;
  strategyVersion: string;            // identity | ledger | phase | checkpoint
  sourceRanges: readonly SourceRange[]; // 每个 message 块对应的 session position 区间
  messages: readonly ProjectedMessage[];
  artifactRefs: readonly ArtifactRef[];
  estimatedTokens: number;
  omissions: readonly Omission[];     // 被裁剪/被替换的区间与原因（对齐 selection policy 的 removed）
}
```

- 统一首次运行、恢复、下一 Turn 的 Context 构建入口（现 `DeterministicContextBuilder` 收敛为 identity 策略的实现之一）；
- `sourceRanges + omissions` 让"模型请求哪些来自原始事实、哪些来自摘要、哪些被舍弃"可回答（M7 强制边界第 5 条）；
- 同一事实源可派生 Model / Web / Audit 三种视图（现有 `web-event-projection.ts` 保持，只是纳入统一来源契约）。

**D3：Typed Operation Ledger（新增，`src/core/ledger/` 或 `src/core/context/compactor/ledger/`）**

```ts
interface FactBase {
  operationId: string; callId: string; tool: string;
  confidence: "structured-meta" | "legacy-parsed" | "opaque";
  status: "succeeded" | "failed" | "aborted" | "unknown";
  semanticLine: string; eventSeq: number; source: SessionRef;
}
type OperationFact =
  | FactBase & { kind: "mutation"; status: "succeeded"; entity: Entity; after: State; delta: MutationDelta }
  | FactBase & { kind: "mutation"; status: "failed" | "aborted" | "unknown"; entity: Entity }
  | FactBase & { kind: "external-effect"; status: "succeeded"; receipt: ReceiptIdentity }
  | FactBase & { kind: "opaque" };
```

- reducer registry 按工具类注册：`file`（read/write/edit 消费结构化 meta 优先）、`bash`（保留 command/digest、exit/signal、唯一错误行、首尾统计，**绝不从命令文本推断副作用**）、`listing`（grep/glob 等）、`external`（只收结构化 receipt）、`unknown`（失败可保守投影；未知成功无 receipt 拒绝折叠）；
- 不变量：call/result 配对平衡才可折叠；只有 succeeded mutation 推进状态；canonical path 归一（`src/a.ts` ≡ `./src/a.ts`，不访问文件系统）；
- 确定性可重放：`factsOfProjection` 从 Log + reducer 重算，投影携带 digest，不另存事实表。

**D4：状态时间线编译器（新增，`src/core/context/compactor/timeline/`）**

```ts
interface FileTimeline {
  path: string; baseline?: FileSnapshot;
  transitions: readonly FileTransition[]; current?: FileSnapshot;
  confidence: "complete" | "partial" | "unknown";
}
interface FileSnapshot {
  version: string; identity: ContentIdentity; coverage: Coverage;
  materialization: "inline" | "archival-only" | "reconstructable";
  content?: string; windows?: readonly ReadWindow[];
}
```

- read 覆盖 `1..totalLines` 才是 complete；分页为 windows；无法证明为 unknown——**partial 永不冒充 complete**；
- 同版本同窗口 read 折叠计数；重叠行 diff（只判重叠行，不推断增删）；mutation 后 read 归并 validation；
- 只有 succeeded mutation 推进版本；failed/aborted 保留且 `stateChanged=false`；连续成功 mutation 同阶段合并 net delta，失败/回滚/用户引用版本永远保留；
- 完整 write 参数可成为 after snapshot（内容在 Artifact），但必须有成功 result；delta 缺失写 `unavailable`，绝不写零变化。

**D5：语义投影（占位 → 实现，`src/core/context/compactor/`）**

- L2 阶段语义：七字段 `PhaseSemanticIR`（intent/decisions/failedApproaches/evidence/result/next/constraints），程序定边界（user steering、exploration→mutation、mutation→validation、failed→repair、validation passed、todo 完成、阶段 token/operation 阈值），模型只补语义；精确 schema 校验、非全空、条目/字符上限、正收益才提交、fail closed；
- L3 检查点：程序渲染十节固定结构 + **Durable State 由程序生成**（goal/todo + project state manifest：每个 canonical path 的 tier/current identity/coverage/digest + unresolved 失败）；摘要模型无权编造状态块；
- 所有入口（自动/手动/overflow）共用同一语义任务锚点选择器（第一个真实 user 消息之后），头部逐字保留或要求完整重建，绝不两难。

**D6：Memory 层（占位 → 实现，`src/memory/providers/project_memory/`）**——详见第 6 节。

**横切**：TokenMeter 需要从"估算"升级为"运行时计量"（插件用 runtime token meter 对 shadowed/replacement 双向计价）；Metrics 记录各层 token、压缩次数、冷前缀跨度（`src/observability/metrics/` 已有骨架）。

### 4.4 与 M7 计划的映射

| M7 条目 | 数据面基础设施 | 压缩机制 |
|---|---|---|
| M7-01 可观测性 | TokenMeter、指标 schema、fixture | 基线采集 |
| M7-02 Artifact Store | D1 | 大输出外置（L0 前提） |
| M7-03 Context Projection | D2 | identity 基线 + 来源契约 |
| M7-04 Append-only Compaction | D0 扩展、D3、D4、D5 | L1/L2/L3 全链 |
| M7-05～07 多 Agent | D2 投影隔离（子 Agent 独立 Session，父级只消费 Handoff） | — |

## 5. Compact 策略实现路径

### Step 0：可观测性与基准（M7-01，先行）

- 每次 ModelRequest 记录：来源位置、类别、估算 token、实际 usage；Session 记录数/字节、Context 构建与恢复时间；
- 长轨迹 fixture + 大型仓库 fixture；固定无压缩基线。
- 验收：指标结构稳定；能区分模型上下文 / Session / Artifact / Workspace 成本。

### Step 1：L1 程序折叠（账本 + 时间线，先 shadow 后替换）

- 实现 D3/D4 编译器，先从完整 Session 重放编译 `baseline → transitions → current`（shadow，不改变 Surface）；
- 实现平衡操作区间选择（区间内只允许 assistant(tool-call) 与 tool/result，不跨越任务锚点与保护尾部）；
- 收益门控：`savingsTokens > 0` 才提交；提交 = 单事务内写 `projection.created` + 替换投影（在 coding-agent 可做到原子，优于插件的两事件时序）；
- 验收：结构化 meta 保留率 100%；failed/aborted 推进率为 0；digest 可重算；restart 后时间线逐字确定。

### Step 2：L2 阶段语义（run 内闭合阶段）

> 实现形态注记：下列门槛（8 ops/12,000 tokens/384/6/512）是文档口径 phase-L2 配置；现行 step-L2 默认配置为 `minClosedSteps=1`、`maxClosedStepsPerBatch=8`、`maxSummaryInputTokens=96000`、`expectedFutureRequests=3`，且要求候选 span 已完全 L1 物化（先 L1 后 L2，单 pre-step 单动作）。

- 程序识别候选边界与 open/closed；模型只补七字段 IR；
- 提交前重验 state digest；无效/超时/负收益/状态变化 → fail closed；
- 缓存感知：空闲年龄取最近 assistant completion，热缓存可推迟但 `maxSoftDeferralMs` 设上界；
- 验收：open 链合法；阶段原始 reasoning 只在 IR 校验通过后删除；单 pre-step 单动作。

### Step 3：L3 检查点 + 压力引擎 + watermark（M7-04 完成态）

- 压力四档（healthy/soft/hard/critical）+ projectedPeak 预算推导；
- 检查点 preflight-first 事务：输入组装、IR 生成、durable pack 分配、完整替换帧计量全部先于首次日志写入；任何失败零追加；
- durable pack 有硬上限（插件 16,384 cap 曾致 6/30 切点 fail closed）——coding-agent 的 artifact 外置可以显著缩小 mandatory pack，这是相对插件的结构优势；
- watermark 从已知记录派生，重启可重建；不写自定义事件。
- 验收：压缩后不立即重复读取 hot 文件；任务锚点/steering/未决失败全保留；正确率不低于阈值且 token 有可测改善。

### Step 4：Memory 积累（见第 6 节）

## 6. Memory 积累预研

### 6.1 定位：Memory 是派生投影，不是事实

coding-agent `src/memory/README.md` 已声明"Memory 是派生知识，不是 Session/Checkpoint 的运行事实，也不能携带系统权限"。分级压缩的思想把这一点具体化：

- **状态真值 vs 语义记忆分离**：项目记忆存两类条目——(a) 程序生成的决策/状态记录（带 source refs、digest，可验证）；(b) 语义条目（instruction/reference，来自 checkpoint 或显式 write，带来源与置信度）。模型文本永远不能覆盖 (a)；
- **记忆必须有来源与失效**：对应压缩的 watermark/epoch 思想——每个条目记录 `source`（sessionId + position 区间）、`createdAt/updatedAt`、`digest`；当来源会话被压缩或条目被更新时，旧条目可失效/降级，而不是无限累积（memoryWriteResult 已有 `duplicate` 语义可扩展为 versioned）；
- **注入防护**：memory 文本按不可信数据处理（`project_memory/README.md` 已声明），注入 Context 时标记来源，不获得系统权限、不绕过 PermissionPolicy；关闭 Provider 不影响 Session 重放与恢复正确性。

### 6.2 积累机制（两个入口）

```text
自动积累：L3 checkpoint 落地时
     durable project state（goal/todo/文件 manifest）→ 程序写入项目级 memory（跨 session）
     closed phase 的 PhaseSemanticIR → 决策/教训 memory（intent、failedApproaches、result、constraints）
显式积累：模型/用户通过 MemoryProviderPort.write
     instruction（工作方式、约定） / reference（事实、位置）
召回：recall(query, workspaceIdentity, limit) → ContextFragment 注入
```

- 自动积累写入由**程序**执行（compactor 层调用 MemoryProviderPort），保证"模型只能解释、不能编造状态"的纪律延伸到记忆；
- 冲突策略：同名条目版本化；来源冲突时按"程序事实 > 语义记忆 > 模型记忆"排序（与压缩的"模型无权改状态"同构）。

### 6.3 数据面支撑

- 小条目：SQLite 新表 `memory_items(id, workspace_identity, kind, content, priority, source_ref, source_digest, version, created_at, updated_at, active)`，归 `src/memory/providers/project_memory/` 的 adapter，Port 形状不变；
- 大正文：内容寻址进 Artifact Store，memory 条目只存 ref；
- 版本化与失效：`version` + `updated_at` + `active`；重复写入升级版本（保留历史），来源会话失效可批量标记；
- 配额：per-workspace 条目数/字节上限；超限按 priority 淘汰并记录（可审计）。

### 6.4 与压缩的闭环

压缩把"长会话"沉淀为"结构化状态 + 有界语义"，这正是跨会话记忆的最佳原料：每次 L3 落地后，程序把 durable pack 的关键事实写入 project memory，使后续新 Session 在冷启动时就能 recall 到"项目当前状态/约束/已知失败"，而不用重读旧会话。**前提仍是 M7-02/03 的数据面先行**：没有 Artifact/投影契约，记忆条目就没有可验证的来源。

## 7. 验收指标（借鉴插件三组指标）

| 组 | 指标 | 门槛 |
|---|---|---|
| 正确性 | structured-meta 的 path/status/diff/callId/receipt 保留率 100%；failed/aborted 错误推进率 0；complete 文件 digest 100% 匹配；partial 从不冒充 complete；restart 后投影逐字确定 | 硬性 |
| 继续工作质量 | 压缩后能说明任务/阶段/关键决定/失败；能继续下一项 edit/test；不立即重复读 hot 文件；与未压缩基线比较任务成功率 | 真实 continuation A/B |
| 成本 | 原始/L1/L2/L3 各层 token；累计 prompt/output/cacheRead/cacheWrite；摘要调用次数与摊销；replacement 次数与冷前缀跨度；hot/warm/cold 文件数与压缩后重读次数 | 真实长会话最终节省 ≥50%（插件实测 64%–89%） |

## 8. 风险与边界

1. **摘要失真**：摘要不是事实。必须有来源区间 + digest + fail-closed 回退；模型文本无权改状态。
2. **压缩抖动/负收益**：插件实测 b807dc11 单次 Surface 省 603 token、摘要输入 9.2K → 21/39 调用被摊销门控拒绝。coding-agent 必须保留同样的经济性门控，不能"为了压缩而压缩"。
3. **容量**：插件 6/30 切点因 mandatory durable pack 超 16,384 cap 零追加 fail closed。coding-agent 应利用 Artifact 外置缩小 mandatory pack，并把 cap 作为配置而非拍脑袋数字。
4. **原子性**：插件受上游逐事件 append 限制存在 log-only 悬空对风险；coding-agent 的 SQLite 短事务可做到 replacement 批次原子提交——实现时必须坚持"单事务内完成投影替换"。
5. **记忆污染**：memory 注入必须带来源标记、无权限提升；程序事实优先级高于模型记忆；Provider 缺失时行为等同 empty。
6. **恢复承诺诚实**：在实现只读恢复 capability 之前，所有投影引用保持 `retrieval="archival-only"`，不在文档或类型中承诺可恢复。
7. **不动摇现有边界**：压缩是 Model Context 投影的策略（对应 `context/compactor` 占位方向），不得进入 RuntimeRunner 直接改写 RunState；Session 事实 schema 的扩展必须走版本化 + fail-closed。

## 9. 结论与建议下一步

### 数据面基础设施清单（按实施优先级）

1. **TokenMeter 与可观测性指标**（M7-01 先行，无它一切无基准）；
2. **ArtifactStorePort**（M7-02；L0 准入与 L3 小 pack 的物理前提）；
3. **ContextProjectionPort + 来源契约**（M7-03；identity 基线，统一 Context 入口）；
4. **Typed Operation Ledger + reducer registry**（L1 基础，无模型）；
5. **FileTimeline 状态编译器 + working set**（L1/L2 基础，程序状态真值）；
6. **PhaseSemanticIR + checkpoint + watermark/压力引擎**（L2/L3）；
7. **Project Memory provider**（跨会话积累，依赖 1–6 的来源契约）。

### 实现 compact 策略的核心机制清单

- 平衡操作区间折叠 + 投影 envelope（digest、sourceEventSeqs、schema 版本、`archival-only`）；
- 程序状态编译（baseline → transitions → current，coverage，失败不推进）；
- 有界语义 IR（七字段/十节）+ 程序校验 + fail closed；
- 收益门控（正 savings + 正摊销）+ 单动作 + watermark 迟滞 + 缓存感知；
- durable state 程序生成（模型无权编造状态）；
- 全部落地引用来源区间，Log 永不改写。

### 建议的下一轮动作

只做 M7-01（基准与可观测性），不同时实现摘要器——与现有 M7 计划一致；本预研文档作为 M7-02/03 的接口与分层依据。

---

*附：关键参考来源*
- `deepseek-harness-plugins/compaction-hierarchical/README.zh.md`、`DESIGN.zh.md`
- `deepseek-harness-plugins/compaction-hierarchical-docs/DESIGN.zh.md`、`DESIGN-v4-state-semantic.zh.md`
- `deepseek-harness-plugins/compaction-hierarchical/docs/REAL_SESSION_ALL_ARCHIVES_2026-08-31.zh.md`
- coding-agent：`src/core/context/compactor/README.md`、`src/core/ports/session_store/session-store-port.ts`、`src/core/runtime/events/agent-events.ts`、`src/memory/`、`docs/development/m7-context-compaction-multi-agent-plan.md`、`docs/adr/0002-node-sqlite-session-storage.md`
