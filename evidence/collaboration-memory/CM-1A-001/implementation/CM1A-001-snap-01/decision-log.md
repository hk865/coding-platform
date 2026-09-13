# CM-1A-001 decision-log（开工前技术裁决 D01–D05）

- ticket: CM-1A-001
- 记录时间：实施开始（第 1 个工作段）
- 记录者角色：本票唯一实现 owner（同时担任本批实施统筹）
- 依据：CM-1A-001 §3、PLAN §5、§7 阶段 0、CURRENT-CALLCHAIN-EVIDENCE §1–7
- 性质：这是**开写前的技术收敛**，每条给出 owner、事务/版本边界、兼容策略与可证伪方法。
  尚未经过运行验证的部分如实标注为「待本票测试证明」，不当作已验证事实。

## 0. 已核对的源码事实（本决策的输入）

| 事实 | 位置 |
| --- | --- |
| 唯一 Task 调度权威是 `DispatchOutboxEntry`，与 TaskLease/TaskAttempt/Run 在 `dispatch-claim` 同一事务创建 | `src/contracts/ledger.ts:367-391`、`src/control/control-engine/claim.ts` |
| `pendingDispatchIntents` 只是 pending 快照扫描，没有 consumer/claim token/可见性超时 | `src/data/state-ledger/sqlite-ledger.ts:919-934`、`src/data/state-ledger/in-memory-ledger.ts:824-835` |
| 真正互斥点是 `Control.startRun` 对 Run/Attempt/Outbox 三 revision 的 CAS；ledger 幂等优先于 CAS | `src/control/control-engine/start-run.ts:122-143`、`src/data/state-ledger/sqlite-ledger.ts:940-952` |
| ordinary / parallel / handoff / Reviewer 四个 driver 都**没有**检查 `startReceipt.replayed`，只有 Query 明确跳过 replay | `src/control/dispatch-engine/dispatch-engine.ts:129-145`、`query-drive.ts:80-90` |
| Runtime 真实 adapter 声明 `replayable=false, supportsSnapshot=false`，启动时把遗留 running 观察改为 `outcome_unknown`，不自动重跑 | `src/execution/worker-runtime/coding-agent-runtime.ts:83-89,119-148` |
| `ActorRef` 只有 human/system；`commandIdentityKey` 只由 (projectId, actor.kind, actor.id, idempotencyKey) 组成 | `src/contracts/command-event.ts:12-21,122-128` |
| 账本通用提交路径 `commitGeneric` 的顺序是：幂等（replay/conflict）→ CAS → 身份槽 → beforeWrite → 一次原子写 | `src/data/state-ledger/sqlite-ledger.ts:940-995`、`in-memory-ledger.ts:837-896` |
| `ActorRef` 被下游 117 处引用，其中 12 处显式取 `actor.kind`；UI 类型也固化 `'human' | 'system'` | 见 D03 |

---

## D01 — Task outbox 的原地演进／兼容方式

**决定：原地演进 `DispatchOutboxEntry`，不新建第二套 Task pending/started/done。**

- 唯一调度权威：ordinary Task 的 pending→started→done 只由 `DispatchOutboxEntry` 表达。本票新增的通信/路由 intent **不复用** `DispatchOutboxEntry` 的形状，也不为同一 TaskAttempt 再落一份通用 pending 记录。
- 新增的 `CommunicationIntent` 是**另一类**typed durable intent（route page / wait deadline / wait successor）。它与 Task outbox 共用同一机械 claim/settle 原语（`CommunicationIntentRecord` 的 CAS + generation），但**不共享状态对象**。
- wait 满足后的唯一后继 admission 走 PLAN §5.3 的既定形态：**唯一调度记录就是新 TaskAttempt 对应的 `DispatchOutboxEntry`**（与 `dispatch-claim` 同一提交，或按其扩展路径同事务提交），不额外创建 successor intent。
- 兼容：旧库里已存在的 `DispatchOutboxEntry` 语义不变；不迁移、不双写。没有旧 outbox 的只读投影需求，因为本票不替换 Task authority。
- 可证伪方法：A11 断言「一个 TaskAttempt 恰好一条 DispatchOutboxEntry，且机械化 retry 计数不产生新的 TaskAttempt」；A04 断言两个消费者竞争同一 communication intent 只有一个取得当前 generation。

## D02 — 前驱公开结束、Work 可接收性与 wait→successor 资格

**决定：wait 的接续资格 = 条件满足 ∧ 前驱 Run 已公开结束；两者都成立才在**同一事务**做 satisfied + successor admission。**

- 前驱公开结束以 canonical `RunSnapshot.status === 'ended'` 为准（由 `run-fact` 落账），不看 Runtime 私有日志，也不看内存句柄。
- 条件先到而前驱仍 `starting`/`running` 时：只写 `WaitCondition.observation`（条件版本 + 观察到的时间），**不创建** successor，不重叠启动同一 Work 的后继 Run。
- 两个触发点都必须复查资格：(a) 条件事实提交时；(b) 前驱终态 `run-fact` 提交时。最后满足的那一次在同事务完成 satisfied + TaskAttempt/Run/DispatchOutboxEntry。
- 唯一键：`(workRef, waitRef, satisfiedRevision)`；同一 wait 只能有一个 successor admission 记录。
- 不假装挂起原模型：wait 注册是当前 Run 的显式产出，满足后启动**同 Work 的新 Run**。
- 可证伪方法：A05 的「事件先于 wait / 晚于 wait / 前驱先结束 / 前驱后结束」四例，断言恰好一个 successor；A09 在 satisfied 提交后、启动前强杀，重启后不得再产生第二个 successor。

## D03 — Agent principal、Host 工具注入与 provider 提交边界

**决定：`ActorRef` 增加第三种 kind `'agent'`，并要求 agent command 自带 exact principal；Host 注入窄 Adapter；Runtime 不反向依赖 Control/PlanCompiler。**

- `ActorRef` 版本化扩展为 `{ kind: 'human' | 'system' | 'agent'; id: string; runRef?: RunRef }`：
  - `kind: 'agent'` 时 `runRef` 必填，`id` 是 AgentInstance id；
  - 需要 Work/参与关系时，由 `CommandIdentity.agentPrincipal`（新增可选字段）承载 `{ agentInstanceId, workRef, participationRef, roleBinding }` 的精确版本。
- `commandIdentityKey` 扩展为把 `agentPrincipal`（存在时）折叠进 key，避免不同 Agent 用同一 idempotencyKey 互相 replay 到对方的命令。
- 兼容策略：`actor` 的新可选字段对既有 human/system 调用是无影响的增量；既有 human/system 断言（例如 `workspace-registration.ts:19`）**不放宽**——agent principal 走本票新增命令自己的校验，不去修改与 1A 无关的注册守卫。
- Host 注入：新增的协调工具 Adapter 只承接调用，不保存 canonical 状态，不新增 Module；`WorkerRuntime` 与 `Control`/`PlanCompiler` 之间不新增反向依赖（由 A11/A12 的 Module DAG 检查证明）。
- provider 提交边界（写进 §5.4 的证据层级）：本票实现 `provider_call_authorized`（Control 在提交前用 exact Run + manifest digest + selected revisions 重核）与 `provider_call_attempted`（wrapper 在实际 `stream(request)` 边界记录 request digest）。契约面先按「一次性许可 + 调用证据」落账；A06 证明目标 Delivery 版本进入捕获的实际 ModelRequest。
- 可证伪方法：A01（错误 expected participation、无权绑定被拒，且 agent 命令不是假 human）；A06（captured ModelRequest digest + nonce/version witness）。

## D04 — 两类 intent 的领取、取消与 unknown 对账

**决定：Task outbox 与 communication intent 复用同一机械 claim/settle 语义，但各有自己的状态对象；每类外部副作用都有四个可达终态。**

- 机械状态集合（对两类 intent 一致）：`pending | leased | done | retry_scheduled | canceled | outcome_unknown | quarantined`。
- lease 字段：`leaseOwner`（consumer id）、`leaseGeneration`（单调递增）、`leaseExpiresAt`、`attemptCount`、`availableAt`、`lastFailureClass`。
- 取消：desired-state-first。Control 先以 expected generation 写 `cancel_requested`，handler 再以同一 generation 确认 `cancelled`、`done`（已发生）或 `outcome_unknown`。过期 generation 不能 settle。
- unknown 对账：lease 过期只允许重新领取**已证明未产生外部副作用**的工作；其余进 `outcome_unknown`，由 typed handler 收敛到 confirmed done / confirmed no-effect 后 retry / confirmed cancelled / quarantine(人工处置)。**无法确认不得重跑**。
- 本票范围：communication route page 与 wait deadline 两类 intent 走完整路径；Task outbox 沿用既有 CAS，并补齐「replayed 不重复调用副作用端口」的调度保证。
- 可证伪方法：A04（跨进程单次有效启动）、A07（cancel 的 pending/leased/running/完成竞争四种）、A08（外部动作已发生但回执未落账，重启后不重做）。

## D05 — 旧入口与新 scheduler 的共存方式

**决定：本票只新增一个**同一 drive 内的新 typed handler**，不新增第二生产入口；已有入口的处置按清单登记并回归。**

- ordinary Task 仍只由唯一 `DispatchEngine.drive` 消费；新通信 handler 挂在同一个 `drive(trigger)` 收口之内，不新开后台循环，不与 `planningQueue`/`semanticReworkQueue`/`RuntimeDispatch.queue` 竞争推进同一工作。
- 本票登记的消费者范围与去向：
  | 入口 | 本票处置 |
  | --- | --- |
  | `DispatchEngineImpl.drive`（ordinary） | 保留，作为唯一公开 drive；本票在其内部增加 communication route/wait handler |
  | `PlannedTaskDispatch` / `OperatorTaskDispatch` | 不改受理差异；它们产生的仍是同一种 Task dispatch intent |
  | `WorkspaceDrive.driveParallel` | 本票不启用；登记为「仅 harness，未与 app 收口」，M01 处理 |
  | `HandoffDrive` | 不动；M03 处理 |
  | `ReviewerDispatch` | 不动；M03 处理 |
  | `QueryJobDrive` | 不动；M02 处理 |
  | `ReworkDrive` | 不动（只产 Plan 提案）；M04 处理 |
  | `/api/tasks/run` fixture | 测试入口，不计入产品链 |
- 取消：本票新增路径一律 desired-state-first；旧 `/api/real/cancel` 直连 Runtime 的路径不在本票范围内改写，但必须在共存清单里写明「两条未统一入口」仍然存在，M05 收口。
- 可证伪方法：A11 的共存清单 + 回归；A12 的 Module DAG 与「无重复调度」审阅。

## 可在实现中收敛（不提前冻结）

WorkParticipation 是否单独记录（本票结论见 D03/D02 的实现记录）、CAS 数据布局、分页大小、退避参数、局部错误码、poll/wake 适配、输入证据存放位置、测试文件名。

## 尚未验证的声明

以上 D01–D05 是**设计裁决**。A01–A12 中任何一条在独立验收通过前都不得标记为已验证；环境 preflight、构建与测试结果另见 `verification.md`。

---

## D06（第 1 工作段追加）— provider 提交边界与调用证据的落账载体

**背景（只读调查结论，已核到源码行）**：

- 真实 ModelRequest 的精确摘要是 `MeterEntry.inputDigest`（`src/execution/worker-runtime/model-budget.ts:34`），
  只写 WorkerRuntime 的本地 journal；`RuntimeRecord.context`（含 `manifest.inputDigest` 与 `manifest.selected`）同样只在 journal。
- Runtime → Control 的**唯一**写通道是 `RunHandle.pollFreshEvents()` → `control.runFact`；
  而 `RunFactV1`（`src/contracts/dispatch.ts:555-558`）只接受 `runtime_event` 或 `outcome_unknown`，
  `RuntimeEventType`（`:115-120`）与 `payload.kind`（`:169-174`）都是封闭枚举。
- 因此**今天不存在**任何把「这次 Delivery 版本真的进了这次 ModelRequest」写成账本事实的路径。

**决定（继续 D03，不改变其方向）**：

1. **不污染 `RuntimeEventType`**。该枚举被 `isTerminalRuntimeEvent`、`runtimeEventTerminalOutcome`、
   `goal-phase` 策略与 `goal-reducer` 共同消费；把「非生命周期」的调用证据塞进去会让阶段归约面对未知事件类型。
2. **用 `RunFactV1` 的新变体承载调用证据**（候选 C）：新增一个 `model_request_evidence` 变体，
   携带 `runRef / requestId / requestDigest / contextInputDigest / deliveryRefs / observedAt`，
   经既有 `RunFactCommand` 与 `RunFactLedgerCommitV1` 落账（复用既有 CAS 与去重语义，不新增写通道）。
3. **一次性提交许可（`provider_call_authorized`）由 Control 侧事实给出**，不能用 runtime 事件冒充；
   **`provider_call_acknowledged` 只在 provider 回执可得时表述**（今日唯一可得信号是 `MeterEntry.status = 'reported'`），
   否则必须诚实停在 `provider_call_attempted`。
4. **目标 Delivery 版本进输入的载体**：`TaskEnvelopeV1` 目前没有 Delivery 字段，`SourceRefV1.kind` 是封闭四值；
   后继 Run 的 Delivery 绑定必须先成为 canonical 的输入绑定，再经 `RuntimeContextMaterials.rules` 进入 `input` 与
   `manifest.selected`（正文进 input、摘要进 manifest，二者由 `manifest.inputDigest` 合并）。

**为什么这是技术裁决而不是新的产品取舍**：CM-1A-001 §3 D03 已经要求「确定一次性 submission authorization 与
actual call journal 的线性化边界」、§5 A06 已经要求「目标 Delivery 版本进入捕获的实际 ModelRequest」；
D06 只是在核到源码后**选定**实现载体，没有引入新的产品承诺、权限或范围。

**可证伪方法（A06）**：确定性 ModelClient 捕获实际 `stream(request)`；断言
(a) `request` 的 user message 含目标 Delivery 正文且其中的版本标识只存在于该 Delivery 版本；
(b) 账本里存在该 Run 的 `model_request_evidence`，其 `requestDigest` 与由捕获请求重算的 sha256 一致、
`contextInputDigest` 与 `RuntimeContextManifest.inputDigest` 一致；
(c) 输出或工具行为引用只存在于目标版本的 nonce。

**状态：设计裁决，未实现、未验证。**

