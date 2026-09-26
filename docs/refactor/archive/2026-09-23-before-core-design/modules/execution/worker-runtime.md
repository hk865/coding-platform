# WorkerRuntime Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Execution
module: WorkerRuntime
code_dir: coding-platform/src/execution/worker-runtime/
contract_state: extension draft
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> **一次真实内核运行**：启动、取消、能力探测、公开观察与快照。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文。跨模块重复承载的切分见 [`../ownership-map.md`](../ownership-map.md)。

## 1. 职责

**负责**

- **一次真实内核运行**：适配模型与工具内核，暴露能力、控制回执、公开观察与运行结果（架构稿 §2 一句话职责）。执行、公开观察与快照的**唯一执行侧承载**。
- **能力如实声明（I3）**：`RunCapabilities`（`replayable`／`supportsSnapshot`／`maxEnvelopeBytes`）；**不支持时返回 `unsupported` 并指名缺失能力**，不得把"未配置"写成"不支持"，也不得把"支持"写成"已验证可用"。
- **Session 恢复／压缩的能力探测与调用（I3 新增方向）**：`ContextContinuationPort.checkContinuation` 如实观测 `restored_original`／`took_over`／`unsupported`／`rejected`；压缩在**安全点**发生，结果如实报告。
- **执行态与能力如实报告**（四态里本模块的那一片）：`RuntimeRecord`（prepared／running／终态）、safe-point、`outcome_unknown`。**四态的权威不在本模块**（架构稿 §4.6）。
- 持有 **Run 身份、能力约束、事件 cursor、控制安全点、`outcome_unknown`**，以及配置版本／Run／session／工具结果与 usage 的持久化（架构稿 §9.1）。
- **公开观察**：运行公开面（`all`／`RunHandle` 事件／模型请求证据）**只读取 journal 已提交的观察**；终态事件先原子保存，再进入内部事件列表并 wake（IG11）。
- **运行日志写入与查询的接线（架构稿 §9.2「必须先改」第 6 项）**：本模块承担 `RuntimeObservationJournal` 的**写入与查询接线**，配合 ArtifactVault 改为按事件增量保存。按消费者拆分保留范围：平台 `trace` 只留调度、控制、UI 必要的公开事实与引用；Kernel 原始事件正文、会话日志和检查点留在 Kernel，平台只保存引用／cursor；Vault 只增量保存必要公开观察，不再每事件累计复制整段正文。【目标设计，未实现】
- **共用运行骨架，保留业务差异**：环境准备、Kernel Session 创建／打开与调用、已提交观察发布、平台结果翻译分责；模型执行继续复用现有 `runObservedModel`，不在平台另建推理循环。`query-answer-review` 与 `query-answer-audit` 共用结构检查和受限流消费，但各自保留 verdict、预算、错误保留方式与生命周期语义。【目标设计，未实现】
- **目标变更的停止请求执行与回报**：受影响 Run 的边界处置由 ControlEngine 决定停派与控制意图、DispatchEngine 执行控制交接，本模块**向 Kernel 发出停止请求并如实回传结果**；未确认的结果保留为待对账，**精确边界与迟到结果的取舍由 Control 决定**（`docs/PRODUCT.md` §5.5）。【设计新增】
- **只读 Adapter**：探索／独立 Reviewer／只读 Query 只开放读取和源码工具，**不拥有 Coder 写租约、编辑或 shell**；`read_source`／`read_material` 按 Reviewer source pin 范围过滤，不暴露绕过路径过滤的通用 read。
- **Session 创建／打开**（**由 DAG 推导的结论**，见下方专栏）：AgentLifecycle 决策 → **DispatchEngine 在派发收口经本模块调 Kernel 适配接口创建／打开** → 平台只保存引用与映射。

**Session 创建／打开：由 DAG 推导的结论（不是新增决策）**

| 环节 | 归属 | 依据 |
| --- | --- | --- |
| 决策"创建还是复用哪条 Session" | **AgentLifecycle** | 架构稿 §3.2 新增边 `DispatchEngine → AgentLifecycle` |
| 在派发收口调 Kernel 适配接口**创建／打开** | **DispatchEngine**，经本模块的 Kernel 适配接口 | 本结论**由 DAG 推导**：AgentLifecycle **没有** `→ WorkerRuntime` 边，本轮**不新增**边；`DispatchEngine → WorkerRuntime` 是既有边 |
| 只保存 Session **引用与映射** | 平台（运行关联在 Dispatch／Control，投影在 ReadModelIndex） | §11.1.1 L-2／R-5：映射保持轻量，**不新增跨系统事务框架**；幂等判据是"创建请求重试不产生两份会话" |

**内核侧设施已定＝使用**：`RecoveryCoordinator`／`SessionStorePort`／`CheckpointStorePort`、`sessionRecordSchema`／`checkpointSchema` **由内核实现、平台提供适配接口**（U7 已关闭，**不再作为开放项**）。接受"同一 Session 同时一个活动 Run"的串行约束（内核在已有活动 Run 时抛错）。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| 编排、规划、归约 | **DispatchEngine**（派发与顺序）／**PlanCompiler**（计划）／**ControlEngine**（状态归约与租约） |
| 重写内核推理循环 | **Kernel**（`vendor/coding-agent`）：Run 内模型／工具循环、压缩与原会话恢复由内核承担 |
| 询问源 Run 的**隐藏上下文** | 不存在该能力：只暴露**公开报告**（`noHiddenContextRead`）；查询也不得向源 Run 注入消息 |
| 在执行开始前注入**协调上下文** | `CodingAgentRuntime.start` **主动拒绝**；协调能力由 Host 经精确 Run／当前参与关系授予 |
| 只读路径的写权限（Coder 写租约／编辑／shell） | **ControlEngine** 的写租约（`TaskLeaseSnapshot.holderRunId`）与 **DispatchEngine** 的派发；真实写权限由 Kernel 授权与沙箱决定 |
| **逐个复查工具或子进程是否停下**、复制 Kernel 的取消机制 | **Kernel**：平台信任其停止契约（承诺"成功返回即已达停止边界"就直接采信），**失败如实显示，不把失败显示成成功**（A6） |
| 通用**外部副作用对账**、复杂**自动接管平台**、逐工具／子进程停机复查 | **本轮撤回，不建设**（A4／A6）；未知副作用不靠重跑猜测 |
| 决定"延续／压缩／重组／归档" | **AgentLifecycle**（处置决策）；本模块只**执行**压缩／恢复并如实报告（架构稿 §4.7） |
| 四态的 canonical 归约与原子提交 | **ControlEngine** 归约 + **StateLedger** 原子提交（#16）；四态描述 Session／工作卡片 |
| 裁决任务完成 | **ControlEngine**（`CompletionPolicy`）：**Run 终态不是 provider 可验证 ack，也不是 Task／Goal 完成** |
| 用 Fake 适配器的行为冒充真实内核 | 不允许：未配置即如实返回 `unsupported`／`rejected`；Fake 只按 `FakeRuntimeScriptV1` 发事件、**不判真伪** |
| 决定最终模型输入的响应结构 | **消费者契约**（PlanCompiler／Query 消费者的严格解析）；格式指导**偏好只能影响契约字段内的表达，不能替代响应结构** |
| 验收结论与 Evidence 适用性 | **VerificationEngine** 组织、**ControlEngine** 归约 |

**内部责任边界**：环境准备只解析本次配置、权限与来源有效性，不缓存会过期的授权结论；Kernel 调用适配只负责 Session／Run 调用与 `runObservedModel` 流；观察层只发布已持久化的必要公开事实；结果翻译把 Kernel 结果映射为平台状态与错误，但不自行裁决完成。四层可以共用窄工具，不合并成新的全能 Runtime façade。

## 2. 对外接口

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `RunPort.capabilities/start` + `RunHandle.pollFreshEvents/pollModelRequestEvidence`（现状） | DispatchEngine | `TaskEnvelopeV1`、模型调用许可 → `RunHandle`、公开事件/证据 | P1-03 冻结；启动幂等；终态保存失败不得先发布 completed；能力诚实声明 | 保留真实接口；三条 start 调用路径由 DispatchEngine 负责准入／Session 占用收敛，本模块共用执行侧支持，旧接口迁移前仍可用 |
| `HandoffControlPort.control/snapshot`（现状） | DispatchEngine | 控制请求、Run 引用 → 控制回执或公开快照 | P1-06 冻结；`noHiddenContextRead`；未配置时 `control → rejected/forbidden`、`snapshot → unsupported` | 保留；Human 通过 Dispatch 的既有 SnapshotPort 契约获取公开快照；真实转发待接线，两套 wire 需适配，不能直连 Runtime |
| `RuntimePreparationPort.all/preflight/prepare`（现状） | DispatchEngine | `RunSpec` → 预检/准备完成或错误；`all()` → `PreparedRunFact[]` | 事实是适配器观察；同一 Run 的准备内容不得静默覆盖；不能代替 Control 受理 | 保留；环境准备内部共用，业务准入仍由 Dispatch/Control 承担 |
| `RuntimeReconciliationPort.all/markUnknown`、可选 `cancel`（现状） | DispatchEngine | `RunRef` → 标记未知或执行已持久化的取消；`all()` → 已准备 Run 事实 | 不重跑外部工作来猜测结果；不直接返回或裁决 Task/Goal 终态 | 保留；由 Dispatch 把观察交 Control 归约 |
| `ReadOnlyQueryPort.capabilities/startQuery`、可选 `inspectQuery/cancelQuery`（现状） | DispatchEngine／Host 查询装配 | 精确 QueryRun、材料引用、问题与预算 → `ReadOnlyQueryResultV1`；检查入口读取精确已持久请求的结果/活动/不可用状态 | 只读、有界；不改变源 Run 的租约；`inspectQuery` 不执行模型 | 保留独立 Query 身份；review/audit 可共用结构检查与受限流消费 |
| `LifecycleControlPort.capabilities/apply`（契约已有，生产适配未配置；目标接 Kernel） | DispatchEngine | Run 引用 → 能力声明；控制意图＋Run 引用 → `SafePointAcknowledgementV1` 或调用失败 | 当前能力全 false，`apply` 抛出未配置错误且未应用意图；不得写成已执行或伪造统一 unsupported 回执 | 保留契约；目标复用 Kernel 控制能力，不复制取消循环 |
| `ContextContinuationPort.capabilities/checkContinuation`（现状未配置；目标接 Kernel） | DispatchEngine | Session/Run 恢复请求 → `restored_original/took_over/unsupported/rejected` | 当前生产返回 unsupported；同一 Session 同时仅一个活动 Run；结果如实报告 | 保留；目标接 Kernel Recovery/Session/Checkpoint ports，旧 unsupported 路径继续有效 |

**共同观察约束**：上表 `all()` 与 `RunHandle` 只发布 journal 已提交的观察；终态/usage 保存前不可见。目标保留公开事件语义，平台 trace 只留必要公开事实及 Kernel 引用/cursor，Vault 改增量写。`WorkspaceCapabilityPort` 的配置受理政策由 **ControlEngine** 的 `ConfiguredWorkspaceCapabilityPolicy` 实现，**不是本模块提供面**；真实运行预检和 Kernel/沙箱结果仍由本模块报告。

**接口命名与内部映射**：契约中没有名为 `WorkerRuntime` 的接口；上述现有 Port 均因有真实 Dispatch/Host 消费者而保留。`CodingAgentAdapter`、`FakeRuntimeAdapter`、`coding-agent-runtime.ts`、`observed-model-run.ts`、`query-answer-review.ts` 与 `query-answer-audit.ts` 是 §1 内部职责的实现映射，不是新增公共接口。Fake 不得冒充真实 Kernel。共享字段、拒绝与状态语义仍以 `runtime-collaboration.md` 为准。

**本次变化方向**：见第 7 节。

## 3. 依赖

覆盖 `allowedModuleDependencies[WorkerRuntime]` 的全部 3 条边（架构稿 §3）。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| **ContextCompiler** | 现有公开实现 `assembleRuntimeContext`；`QueryExecutionMaterialPort.readFact` | envelope、精确运行范围和材料访问能力 → 运行输入与 manifest；Query 按需读取事实及来源。`TaskContextPort` 产出由 Dispatch 传入；journal 归 Vault，不归 Context | 既有 |
| **WorkspaceReader** | `read(query) → sourced／unsupported／stale／rejected`；role `code` 通道；现有 `denied-prefixes` owner | 路径边界内受限源码与来源材料；变化明确拒绝，**不声称多文件原子快照**。Runtime 目标复用 Reader 的拒绝清单窄出口，不再保留两份字面量 | 既有（R03 复用现有 owner） |
| **ArtifactVault** | `put(record)`／`open(ref, accessScope)`；`RuntimeObservationJournal` | **公开观察的原子保存**与正文承载；执行记录正文 body-first | 既有 |

**必须写明：没有 `WorkerRuntime → ControlEngine` 边。** 本轮**明确不新增**该边（架构稿 §3.1／§6.3）：上一版为"模型请求前复核继承材料"设想的准入边**随该要求一并撤回**（L-1）。**已有的运行控制依赖如实保留**：`DispatchEngine → WorkerRuntime`（派发与租约执行）与 `DispatchEngine → ControlEngine`（运行事实受理与归约）。运行事实经 **DispatchEngine** 的 fact 路径回流 Control；模型调用许可经 `start(envelope, access.modelCalls)` 的**参数**传入，也不构成新的模块依赖边。平台暂停／恢复走"向 Kernel 提交控制请求并接收结果"，不需要新的模块依赖边。

## 4. 被依赖

覆盖全部反向边（架构稿 §3 依赖 DAG 的反向推导：1 条）。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| **DispatchEngine** | `RunPort`／`RunHandle`；`RuntimePreparationPort`／`RuntimeReconciliationPort`；`ReadOnlyQueryPort`；`HandoffControlPort`；`LifecycleControlPort`／`ContextContinuationPort`（生产接线待完成） | 准备与启动、Query 执行、控制请求、公开快照、未终结 Run 对账、接续能力与结果 | 架构稿 §3 依赖 DAG 的反向推导、§7.4 交互 2 |

> **宿主边（不计入 38 条）**：`src/app/**`／`src/harness/**`／`src/composition/**`（`owner()` 记为 Host）与 UI 装配 `CodingAgentAdapter`／`FakeRuntimeAdapter` 并注入能力提供方；宿主负责接线，不承接模块权威。测试台对 Kernel 的适配做验证，**不重复为 Kernel 已承担的每个内部故障编一套平台恢复测试**。

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| `RuntimeRecord`（prepared／running／终态） | 否（**运行态观测**） | **本模块** | 运行／挂起·恢复 |
| Run 身份（`runId`）、事件 cursor、控制安全点、`outcome_unknown` | 否（执行侧）；canonical `RunSnapshot.status`（running／ended）由 **ControlEngine** 纯函数 fold 归约 | 本模块持有执行侧表示；canonical 归约在 ControlEngine，原子提交在 StateLedger | 运行／挂起·恢复 |
| 能力约束与能力声明（`RunCapabilities`、`lifecycleControl.capabilities()`、`ContextContinuationResult`） | 否（**如实声明**） | 本模块／适配器声明；**不编造结果** | 运行／挂起·恢复 |
| 配置版本、Run／session、工具结果与 usage 持久化 | 否（实现态） | 本模块 | 运行 |
| **公开观察**（`RuntimeObservationJournal`） | 否（观测） | **原子保存交 ArtifactVault**；本模块只发布已提交的观察 | 运行 |
| Session **引用与映射** | Kernel 返回引用是执行观察；经 Control 接纳的运行关联是正式事实，不能因只存引用而称为非 canonical | 本模块报告引用；Control 归约、Ledger 保存平台正式关联；**Kernel 拥有会话日志、检查点、压缩与恢复**（L-2／R-6） | 创建／运行／挂起·恢复 |
| Kernel 侧设施（`RecoveryCoordinator`／`SessionStorePort`／`CheckpointStorePort`、`sessionRecordSchema`／`checkpointSchema`） | canonical 归 **Kernel** | **内核实现、平台提供适配接口**（已定＝使用） | 挂起·恢复 |
| Checkpoint／压缩记录 | 是（**Kernel 侧**） | Kernel；**Kernel 已完成的有效压缩直接使用，平台不再二次编译**（#18） | 压缩 |

**本模块拥有的对象**：Run 身份、能力约束、事件 cursor、控制安全点、`outcome_unknown`、`RuntimeRecord`，以及配置版本／Run／session／工具结果／usage 的持久化记录。

**本模块不拥有的**：`AgentInstanceV1`（canonical，ControlEngine 归约）；Agent／Session 的生命周期处置决策（AgentLifecycle）；四态的 canonical 归约（ControlEngine）；Task／Goal 完成状态（ControlEngine `CompletionPolicy`）；正式 Evidence 与适用性（VerificationEngine 组织、ControlEngine 归约）；写租约（`TaskLeaseSnapshot.holderRunId`，ControlEngine）；会话日志、检查点、压缩与恢复的正文（Kernel）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另列"重新启用"）。**观察 ≠ 正式完成**：Run 终态不是 provider 可验证 ack，也不是 Task／Goal 完成。

## 6. 旧标识去向

1. **会话相关**：平台只保存 Session 的**引用与映射**，**不复制 Kernel 正文**。权威划分：**Kernel 拥有会话日志、检查点、压缩与恢复；平台拥有运行关联、调度与正式事实引用**（§11.1.1 L-2／R-6）。本模块是"运行关联"的执行侧承载，不是会话内容的第二权威。
2. **`runId` 保留**：沿用可满足需求的现有表示（架构稿 §4.5 标识取舍表）。
3. **`agentId` 有消费者时保留轻量标识**：本模块的 `RuntimeRecord` 与事件区分是消费者之一；**不为它扩建跨任务长期身份体系**。
4. **本模块持有 `RuntimeRecord`（运行态），不持有 canonical 的 `AgentInstanceV1`**。`AgentInstanceStatus`（`"active" | "retired"`，含 `retiredAt`）与本模块无关：其写路径在 **ControlEngine**，且 `retired` 字段目前**没有任何命令／事件写入**（架构稿 §4.0 已登记的缺失）。四态 `working`／`standby`／`paused`／`archived` 描述 Session／工作卡片，**不写进 `AgentInstanceStatus`**。
5. **`workId`**：本模块不持有；`workId` **不先宣布必需**，是否与 `taskId` 合并按 §4.5 处理。
6. 旧记录兼容：`RuntimeRecord.sessionId` 在 prepare 时由 `randomUUID()` 产生；**旧没有 `inputBinding` 的运行保持历史可读，不获得新调用许可**，也不为旧记录补造授权或无副作用证明（架构稿 §9.3 规则 2／7）。

## 7. 本次接口变化方向

**共用与去向**：继续用 `runObservedModel`，抽取环境准备、Kernel 调用、已提交观察发布与结果翻译；review/audit 共用结构检查和受限流消费，保留各自 verdict、预算、错误与生命周期语义。普通/Reviewer/Handoff 的派发准入与 Session 占用在 DispatchEngine 内收敛，本模块共用它们调用的执行侧支持，保留必要的执行侧拒绝。累计 trace 正文改为 Kernel 引用/cursor 与 Vault 必要观察增量；Runtime 经既有依赖复用 Reader 拒绝政策（见 `ownership-map.md` §13 S07–S09）。现有运行、准备、查询、对账端口保留；未接 Kernel 的能力继续如实失败，不补造成功结果。

`对应项号：I3 ｜ 接口方向：RunPort 能力面、LifecycleControlPort、ContextContinuationPort、HandoffControlPort 扩展 Session 恢复／压缩的能力探测与调用；承担 RuntimeObservationJournal 增量写入与查询接线；目标变更时向 Kernel 发出控制请求并如实回报 ｜ 边动作：3 条依赖、1 条被依赖不变，不新增 WorkerRuntime→ControlEngine ｜ 理由：挂起·恢复与压缩需要真实执行能力；运行日志需消除累计重写；目标变更的停止信号须到达执行侧 ｜ 不变量：#15（同一 Session 只有一个拥有执行控制权的活跃 Run）、#18（Kernel 已完成的有效压缩直接使用）、#19（归档≠删除）。`

## 8. 信息缺口

**对齐架构稿 §11.4.3（引用，不重新推导）**

- **② 各 Port 的精确形状、字段命名、装配点（含 Kernel 适配面"创建／打开、消息、执行、控制、状态、增量事件"的具体划分）** → 架构稿 §9.2 第 2／4 份契约。`RunPort`（P1-03）与 `HandoffControlPort`（P1-06）已冻结，其余端口与"创建／打开"适配接口形状待定。
- **④ 迁移切换点、删除顺序与回滚方式（含普通／Reviewer／Handoff 调用点）** → 架构稿 §9.2 第 4 份契约与 Prompt 6：三条生产 `runtime.start` 路径的收敛方式（C-13）会改变本模块的被调用方式。
- **⑦ 生产 `lifecycleControl`／continuation 能力开关的放开与 Kernel 接线验证**（**本模块主要相关项**）→ §11.4.2 第一行"接上 Kernel 实现并确认适配结果"，由真实连续任务验收。

**本模块新增缺口**（§11.4.3 未覆盖）

- **真实同 Run 暂停／继续／steer 与通用公开 snapshot 仍 `unsupported` 或未接**：生产 `lifecycleControl.capabilities()` 全 `false`、`contextContinuation` 返回 `unsupported` 且**无配置入口**（`unconfigured-capabilities.ts` 写死）。这是**"未配置"而非"不支持"**——**不得用 Fake 适配器的行为冒充已接通**；放开路径属实现工作。
- **内核"已导出恢复能力"只证明存在接入线索**，**不等于**暂停、压缩、撤权后恢复等目标语义已完整可用；必须由真实连续任务验收，不能据公开导出推断。
- **`recordSafePointAck` 旧 revision 宽松行为**是**已登记的延期缺口**（B5，无已发现生产消费者）；本次取消意图归约的验证**不等于**全部安全点协议通过。
- **跨角色累计账户与会话接续尚未接入**：当前为单 Goal 单工作任务；`ContextContinuationResult` 的观测路径与恢复入口的绑定仍待接口设计（§4.2"重新启用"末列）。
- **N-2（本目录 `README.md` §5.2）**："暂停成功"这一事实由谁归约成哪条 canonical 记录（`ControlIntentReconciled`？Run 状态？Kernel 回报？）**没有唯一落点**。本模块只负责把控制请求交给 Kernel 并如实回报结果，**不代为归约**。
- **N-4（本目录 `README.md` §5.2）**：`runtime-collaboration.md` **缺"`WorkerRuntime` 不得依赖 `ControlEngine`"的字面禁止条款**（契约中只有 `ArtifactVault`、`ContextCompiler` 的同类表述）。本页按架构稿 §6.3 写明该禁止，接口契约侧待维护补齐。
- **N-7（本目录 `README.md` §5.2）**：`module-status.md` 没有统一状态标签体系，本页只能用架构稿 §2 的 `契约状态` 列 ＋【代码】／【契约未接】／【设计新增】标记，无法引用机器可读的模块状态。

## 9. 重构目标与质量验收

通用依据：[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。本轮已把职责、公共能力、共同实现及旧路径写入本文；源码收敛、真实 Kernel 接线与成本收益均为待验证。目标仍为 13 Module／38 条逻辑边，源码基线仍是 12 Module／34 条边；本章不新增 `WorkerRuntime → ControlEngine`。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| `coding-agent-runtime` 混合环境准备、Kernel 调用、观察发布与结果翻译；§1 已划分四责 | 在模块内部按变化原因拆分，继续复用 `runObservedModel`，不重写 Kernel 推理循环或建立万能 Runtime 门面 | 三类启动路径由 DispatchEngine 负责收敛与 Session 占用；本模块共用环境准备、Kernel 适配、观察发布和结果翻译。Runtime 内部等价副本在三类调用方接线验证后退役 | 三条真实入口的等价行为、取消/终态保存失败与未配置 adapter 场景；源码收敛**待实现／待验证**（RG-01～RG-05；CQ-01、CQ-02、CQ-06～CQ-08、CQ-12） |
| `query-answer-review` 与 `query-answer-audit` 重复结构检查和受限流消费（[S07](../ownership-map.md#13-共用实现与旧路径去向)） | 共用 block/index/quote/citation 检查及取消/结束/容量处理；保留不同 verdict、预算、请求身份、错误保留和记录生命周期 | 两条旧流程迁到共同内部支持后删除同义副本；不把二者合成同一业务入口 | 共用核心契约场景 + review/audit 各自消费者接线与差异断言；当前**待实现／待验证**（RG-01～RG-05；CQ-01、CQ-04、CQ-06、CQ-08、CQ-12） |
| `RuntimeRecord.trace`、Kernel 事件正文与 Vault journal 存在重复承载和累计重写风险（[S08](../ownership-map.md#13-共用实现与旧路径去向)） | 先清点消费者；平台只保留必要公开事实，Kernel 正文留 Kernel，平台保存引用/cursor，Vault 增量保存必要观察 | 旧累计 trace 只在消费者完成迁移后退役；不能把整段副本改成分条副本，也不能删除正式事实 | 固定长 Run 下比较写入次数/字节、读取与恢复结果，并核对 Dispatch/UI/报告消费者；收益**待测**（RG-01、RG-03、RG-06；CQ-01、CQ-04、CQ-08、CQ-09、CQ-12） |
| Runtime 与只读 Runtime 复制 Reader 拒绝清单；Verification 的跨边 owner 尚未裁决（§3、§8） | Runtime 通过现有 `WorkerRuntime → WorkspaceReader` 边复用 Reader owner；只共用稳定拒绝值/窄政策，不移动路径规范化与沙箱执行 | Runtime 两份字面量在接线验证后退役；Verification 路径保持未决，不在本模块偷加边或复制新权威 | Runtime 普通/只读消费者的拒绝等价、符号链接/越界仍由原实现负责；Verification 决策**待上位确认**（RG-01、RG-03、RG-04；CQ-01、CQ-04～CQ-06、CQ-08、CQ-12） |
| `LifecycleControlPort`／`ContextContinuationPort` 当前未配置，真实 Kernel 恢复/控制尚未接 | 保留现有 `unsupported/rejected`，接 Kernel 后仍如实报告；不把 Fake 或公开导出当生产可用证明 | 旧 unsupported 路径继续有效；接线不得复制 Kernel 取消、会话正文、检查点或恢复循环 | 真实连续 Session 的控制、恢复、压缩及失败场景；当前**待实现／待验证**（RG-01、RG-02、RG-04；CQ-01～CQ-03、CQ-06、CQ-08、CQ-11） |
