# AgentRuntime：执行与 Session 操作的实现骨架

> **2026-09-26 当前实现：** 正式B2 prepare/start/observe、C2通信/白板/材料及Role/Skill装配已进入原Kernel执行循环。Query已完成公开受理→Session claim→有界prepare→readonly工具/模型→持久Answer/Job/Run→同generation释放的独立真实链（13项/4文件及types），预算和来源使用原manifest，未另建引擎。Git固定commit及双向working_tree普通文本比较已接工具消费者。R4.1持久控制受理与R4.2工具组安全点已有，R4.3物理投递/ack及后续恢复、维护/重组仍未交付；Query外部材料、多轮/高级恢复与完整Host消费者继续。已有Plan的Workflow及Session/mailbox已导入，初始Plan和UI布局接续。最近完整隔离仍为[R5a/R4.2的102文件/1,007项](../../reviews/evidence/next-b2-2026-09-26/r5a-r4-isolated-result.json)；精确当前增量见[能力索引](../../IMPLEMENTED-CAPABILITIES.md)，不把下文完整目标接口当已实现。

> **2026-09-24 并行语义纠偏：** 任务图是协作白板、状态/历史与证据索引；预期依赖和架构影响不自动阻止执行。明确采用的具体输入条件在需要消费时检查，不以生产方整个 Task satisfied 代替。取消每次 Task/Query 领取必须预证明全部未来范围、预占资源的要求；身份、权限、幂等、同 Session 一致性及实际操作的原子性仍保留。下文尚含该旧方案的 scope/reservationRef 必填代码块，标记为**待按具体工具收窄的草案，不得直接冻结施工**。最新行为图见[并行设计 §1.2、§3](../../PARALLEL-COLLABORATION.md)；当前代码差异见[审阅报告](../../reviews/task-graph-orchestration-intent-2026-09-24.md)。


```yaml
status: implementation-blueprint
updated: 2026-09-26
target: coding-platform/next/src/core/agent-runtime/
implementation: B2/W2/C2、R5a、R4.2及R4.1持久受理已合入；Runtime实际控制投递/ack、Query、恢复、维护和Workflow尚未闭合
```

当前源码位置是 `coding-platform/next/src/core/agent-runtime/`：已有模型工具循环、源码工具与来源授权组件，见[迁移验收](../../reviews/next-completed-migration-2026-09-24.md)。Session 创建/目录/历史子集见[next R3c/R4b验收](../../reviews/next-r3c-r4b-2026-09-24.md)；其后 B2 接通正式 Task 执行及完成后原 Session 的下一轮，C2 接通平台工具消费者。范围并行、控制恢复与完整 UI 不据此宣称交付。本文完整文件树/联合接口仍是目标设计，实际接口以 next 代码和已合入批次为准。

**2026-09-24 窄接线实测：** `runObservedModel` 已接可选 sessionContext / executionIdentity，复用真实 Kernel 历史与重放；默认行为保持。54文件/376项隔离通过，见[R4c子集验收](../../reviews/next-r4c-continuity-2026-09-24.md)。当时正式 admission/执行驱动/历史边界选择尚未接通；现已由 B2 消费这一接缝，公共 continueHistory 能力标志仍未全面开放。

原工程 R2d/R4a 的来源桥、工具薄适配、资源释放和 Kernel 扩展是行为对照，已完成迁入的实现不得再复制。原工程历史见[批次验收](../../reviews/implementation-batches.md)，不能将旧工程文件路径当作当前施工位置。

## 1. 产品目的、边界与选定路线

2026-09-26：本模块属于[完整 A/B/C/D 路径](../../IMPLEMENTATION-PLAN.md)的 B 及 C/D 执行适配部分。prepare/start 必须消费真实 Role 版本、Skill/工具配置、双图引用与材料入口；已有 RoleSpec 或固定 coding-safety 不等于该装配完成。消息送入、控制、恢复和执行观察使用同一 Session/Kernel 适配，不另建 AgentManager。Run 终态先形成事实，再由 WorkGraph 同一正式路径更新占用和图上忙闲；B2 已由真实 entry/观察生产者维护历史区间并归约结果；C2 的真实工具回合复用同一闭环，不以夹具手工写入区间替代生产证据。

把已经受理的工作可靠地送入真实 Kernel，保存可核对的进入、工具、结果和控制观察；让相关工作延续原 Session，让普通、查询、Reviewer、Handoff 共用执行机制。Workflow 决定继续谁、为什么重组，WorkGraph 决定当前能否受理/占用/完成，本模块执行并回报，不反调业务策略。

本模块依赖 WorkGraph、WorkspaceTools、RecordStore。模型循环、原始 Session 日志、历史 Context 选择、工具执行和检查点继续由 Kernel 维护。新增的是平台适配和明确的 Kernel 公共扩展，不在平台复制一套历史消息拼装器。

**已选定最小 Kernel 公共扩展路线，保留默认 CLI 行为；暂不采用平台 ContextBuilder wrapper。** 当前仅传同一个 sessionId 不会继承前一轮 Context，resume 也不能代替完成后的新一轮。扩展必须先通过 §6 独立验收，再把 continueHistory 能力置 true。native compact 当前没有实现，仍返回 unsupported；不能用一个新摘要 Session 冒充原会话压缩。

Session 是稳定交互身份，ExecutionRef 是一次正式执行，二者不能混用。角色是配置，不制造常驻模型。创建 Session 和读取历史都不调用模型；模型执行才要求 Run/QueryRun。相同会话的执行和维护共用一个占用槽，跨会话独立工作可并行；源码写并行仍受真实工作区能力约束。

并行目标已明确为同一工作目录按实际资源范围同时执行。注释：移除旧入口要求写权限必须包含 `*` 及 LeasedWorkerRuntime 默认全根占用的目标前提；先由 WG 解析/领取范围，再把实际限制接入 Kernel 文件、补丁与命令执行边界。不同模块名不是沙箱隔离证明；范围缺口/争用返回给编排 Agent 修正，不一律转成 Run 失败。详见 [并行协作接口](../../PARALLEL-COLLABORATION.md)。当前源码尚未完成此迁移。

共同身份/结果见[公共契约](../../skeleton/CONTRACTS.md)，领域状态见[WorkGraph](work-graph.md)，生命周期转换见[状态机](../../ORCHESTRATION-STATE-MACHINES.md)。本页约定在这些契约之上给出完整执行骨架。

## 2. 文件树、内部依赖与状态所有权

```text
src/core/agent-runtime/
  index.ts
  ports.ts
  contracts.ts
  runtime.ts
  execution-driver.ts
  session-operations.ts
  input-adapter.ts
  observation-recovery.ts
  control-adapter.ts
  kernel-adapter.ts
  kernel-store-locator.ts
  model-budget.ts
  run-limits.ts
  check-execution.ts
  tool-adapters/
    source-tools.ts
    material-tools.ts
    coordination-tools.ts
  legacy-adapter.ts
```

| 文件 | 主要导出与责任 | 内部依赖 / 读写 |
| --- | --- | --- |
| index.ts / ports.ts | `createAgentRuntime/RuntimeExecutionPort/RuntimeDependencies` | 只导出公开面；无导入副作用 |
| contracts.ts | 本页执行、历史、能力、技术观察 DTO | 共享契约与现有准确类型；不导入 Workflow |
| runtime.ts | `createAgentRuntime`，装配公开入口 | driver/session/input/recovery/control/check；无第二调度策略 |
| execution-driver.ts | `prepareExecution/startRun/continueSession/driveAccepted` | WG 受理/进入，Kernel 启动；技术记录通过 Store |
| session-operations.ts | `createSession/compactSession/regroupSessions` | WG 正式维护操作，Kernel 创建，逐阶段登记观察 |
| input-adapter.ts | `prepareRuntimeInput/bindRuntimeTools` | WG 材料/角色读取，Workspace 来源；只组装本轮输入，不重放历史 |
| observation-recovery.ts | `observe/reconcile/mapKernelObservation` | 增量读 Kernel 原记录；技术游标与平台事件原子保存，再向 WG 回流 |
| control-adapter.ts | `applyControl/createControlHooks` | 读正式控制意图；绑定真实 Run；只在确实暂停/停止后 ack |
| kernel-adapter.ts | `createKernelAdapter`，唯一执行组合适配 | 只用 public-api；不 import Kernel 私有实现 |
| kernel-store-locator.ts | `KernelStoreRegistry` | Host 配置 adapterId→受信存储位置；恢复旧 per-Run 库映射 |
| model-budget.ts / run-limits.ts | 复用 `ModelBudget/kernelRunLimits` | 真正最终请求容量与用户配置预算；不新增默认累计预算 |
| check-execution.ts | `runCheck/reconcileCheck` | 复用命令检查、sandbox、租约和未知副作用恢复；结果受理交 WG |
| tool-adapters/* | 现有工具工厂迁移 | 源码→Workspace；材料/通信→WG；身份由Host绑定 |
| legacy-adapter.ts | 旧 RunPort/RuntimeDispatch 调用兼容 | 只有格式转换；消费者迁完删除，不保留另一条模型启动链 |

内部方向为公开组合→driver/session/control/check→Kernel 适配/输入/观察。Kernel 事件经过观察适配回流 WG，不导入 Workflow。source/material/coordination 工具只注入所需窄 Port；不得把 Store 或任意方法调用器暴露给模型。

## 3. 本地类型：执行与维护分别表达

代码路径按目标目录。以下 `ExecutionAdmission/PreparedExecution/ExecutionObservation/EntryPermit/KernelObservationSource/CompletedHistoryBoundary` 是由 WorkGraph 持有的**目标接口草案**，不是宣称当前 `tasks/contracts.ts` 已导出这些类型：前者为 `{kind:'task',claim:TaskClaim}` 或 `{kind:'query',queryJobRef,queryRunRef,sessionRef,generation}`；PreparedExecution 为现有 TaskEnvelopeV1 或 QueryExecutionBindingV1 的带 kind 联合。任务与查询不得互相强转。当前 Runtime [ports.ts](../../../../src/core/agent-runtime/ports.ts) 已有 B2 的 Task 专用 prepare/start/observe 实现，复用真实 Claim、WG11/WG12、固定 Kernel 身份及终态事实；Query 联合入口、控制/维护仍未交付。下方完整联合类型仍是目标草案，不能据其声称 Query 已接通。

```ts
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { SourceRefV1, RunRef } from '../../contracts/dispatch.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { ControlIntentRef, SafePointAcknowledgementV1 } from '../../contracts/control-intent.js';
import type { VerificationScope } from '../../contracts/verification-import.js';
import type { VerificationRoundCheckBinding } from '../../contracts/verification-round.js';
import type { CommandCheckRecord } from '../../contracts/verification-service.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, ExecutionRef, WorkspaceScope, RoleConfigurationRef,
  CommandMeta, WorkLinkTarget, WorkLinkRelation } from '../../contracts/core/identity.js';
import type { OperationRef, OperationReceipt, OperationProgress } from '../../contracts/core/operations.js';
import type { ReadResult, CoreRejection, Page } from '../../contracts/core/results.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { ExecutionAdmission, PreparedExecution, ExecutionObservation,
  EntryPermit } from '../work-graph/tasks/contracts.js';
import type { SessionAction, SessionOperationRecord } from '../work-graph/sessions/contracts.js';

export type RuntimeCapability = { supported: boolean; reason: string };
export type RuntimeCapabilities = {
  adapterId: string; kernelSessionApiVersion: 1 | 2;
  createSession: RuntimeCapability; readHistory: RuntimeCapability;
  continueHistory: RuntimeCapability; recoverRun: RuntimeCapability;
  safePointPause: RuntimeCapability; cancel: RuntimeCapability;
  nativeCompact: RuntimeCapability;
  scopedWorkspaceWrites: RuntimeCapability;
};
export type RuntimeInputIntent = {
  mode: 'initial' | 'append' | 'handoff';
  instruction: string; requiredRefs: readonly SourceRefV1[];
  handoffRef: ArtifactRef | null; budget: RuntimeBudget;
};
export type PrepareExecutionRequest = {
  admission: ExecutionAdmission; intent: RuntimeInputIntent; meta: CommandMeta;
};
export type ExecutionPreparation =
  | { status: 'ready'; prepared: PreparedExecution; inputDigest: string }
  | { status: 'needs_material'; missing: readonly string[]; selectedRefs: readonly SourceRefV1[] }
  | CoreRejection;
export type StartExecutionRequest = {
  admission: ExecutionAdmission; prepared: PreparedExecution; meta: CommandMeta;
};
export type ExecutionDispatchReceipt =
  | { status: 'pending'; executionRef: ExecutionRef; reason: string }
  | { status: 'entered'; executionRef: ExecutionRef; sessionRef: SessionRef; generation: number }
  | { status: 'observed'; executionRef: ExecutionRef; observation: ExecutionObservation }
  | { status: 'unknown'; executionRef: ExecutionRef; reason: string }
  | CoreRejection;
export type CreateSessionRequest = {
  workspace: WorkspaceScope; role: RoleConfigurationRef;
  recommendedRefs: ArtifactRef[];
  initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[];
  meta: CommandMeta;
};
export type MaintainSessionRequest = {
  action: Exclude<SessionAction, { kind: 'create' }>; meta: CommandMeta;
};
export type SessionHistoryRequest = {
  sessionRef: SessionRef; afterCursor: string | null;
  throughCursor: string | null; limit: number;
};
export type SessionHistoryEntry = {
  recordId: string; cursor: string; recordedAt: string;
  kind: 'session_created' | 'turn_started' | 'agent_event';
  source: { adapterId: string; kernelSessionId: string; position: number };
  body: ArtifactRef | { encoding: 'kernel_session_record_json'; text: string };
};
export type ApplyControlRequest = {
  runRef: RunRef; intentRef: ControlIntentRef; meta: CommandMeta;
};
export type ControlObservation =
  | { status: 'pending'; intentRef: ControlIntentRef }
  | { status: 'observed'; ack: SafePointAcknowledgementV1 }
  | { status: 'unknown'; intentRef: ControlIntentRef; reason: string }
  | CoreRejection;
export type RunCheckRequest = {
  scope: VerificationScope; requestId: string;
  binding: VerificationRoundCheckBinding; meta: CommandMeta;
};
export type CheckExecutionReceipt =
  | { status: 'recorded'; check: CommandCheckRecord; replayed: boolean }
  | CoreRejection;
```

历史正文允许直接返回经过 Kernel sessionRecordSchema 验证的序列化记录，避免公共 Port 泄漏 Kernel 实现类型；这不是任意 JSON 的成功回执。不把原记录改成“永久正确”的摘要；如需持久引用，由 WG 材料入口登记 Kernel 位置和明确版本，不重复保存整本 transcript。

## 4. 完整 Port 与装配

```ts
export interface RuntimeExecutionPort {
  capabilities(ctx: CoreCallContext, workspace: WorkspaceScope): Promise<ReadResult<RuntimeCapabilities>>;
  readSessionHistory(ctx: CoreCallContext, request: SessionHistoryRequest): Promise<ReadResult<Page<SessionHistoryEntry>>>;
  createSession(ctx: CoreCallContext, request: CreateSessionRequest): Promise<OperationReceipt<SessionRecord>>;
  compactSession(ctx: CoreCallContext, request: MaintainSessionRequest): Promise<OperationReceipt<SessionOperationRecord>>;
  regroupSessions(ctx: CoreCallContext, request: MaintainSessionRequest): Promise<OperationReceipt<SessionOperationRecord>>;
  getSessionOperation(ctx: CoreCallContext, ref: OperationRef): Promise<ReadResult<OperationProgress<SessionOperationRecord>>>;
  prepareExecution(ctx: CoreCallContext, request: PrepareExecutionRequest): Promise<ExecutionPreparation>;
  startRun(ctx: CoreCallContext, request: StartExecutionRequest): Promise<ExecutionDispatchReceipt>;
  continueSession(ctx: CoreCallContext, request: StartExecutionRequest): Promise<ExecutionDispatchReceipt>;
  driveAccepted(ctx: CoreCallContext, request: { workspace: WorkspaceScope; limit: number }): Promise<ReadResult<Page<ExecutionDispatchReceipt>>>;
  observe(ctx: CoreCallContext, request: { executionRef: ExecutionRef; afterSequence: number; limit: number }): Promise<ReadResult<Page<RuntimeObservation>>>;
  reconcile(ctx: CoreCallContext, executionRef: ExecutionRef): Promise<ExecutionDispatchReceipt>;
  applyControl(ctx: CoreCallContext, request: ApplyControlRequest): Promise<ControlObservation>;
  runCheck(ctx: CoreCallContext, request: RunCheckRequest): Promise<CheckExecutionReceipt>;
  reconcileCheck(ctx: CoreCallContext, request: Pick<RunCheckRequest, 'scope' | 'requestId'>): Promise<CheckExecutionReceipt>;
}
export type RuntimeDependencies = {
  tasks: TaskPort; runs: RunStatePort; sessions: SessionDirectoryPort;
  materials: MaterialPort; roles: RoleMemoryPort; evidence: EvidencePort;
  mailbox: MailboxPort; workspace: WorkspaceToolsPort;
  records: RuntimeRecordStorePort<RuntimeOperationRecord, RuntimeObservation>;
  kernelStores: KernelStoreRegistry;
  host: RuntimeHostBindings;
  kernel: typeof import('../../../vendor/coding-agent/dist/public-api.js');
  now: () => string;
};
export interface KernelStoreRegistry {
  forWorkspace(scope: WorkspaceScope): Promise<ReadResult<{ adapterId: string; kernelStoreKey: string }>>;
  resolve(adapterId: string): Promise<ReadResult<{ kernelStoreKey: string; databasePath: string }>>;
}
export type RuntimeModelBinding = {
  configuration: { revision: string; provider: string; model: string; baseUrl: string };
  client: import('../../../vendor/coding-agent/dist/public-api.js').ModelClientPort;
  inputCounter?: import('./model-budget.js').ModelInputCounter;
};
export interface RuntimeHostBindings {
  bindModel(executionRef: ExecutionRef): Promise<RuntimeModelBinding>;
  resolveWorkspace(scope: WorkspaceScope): Promise<ReadResult<{
    root: string; deniedRoots: readonly string[];
    processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
  }>>;
}
export type AgentRuntimeService = {
  port: RuntimeExecutionPort;
  initialize(): Promise<void>;
  close(): Promise<void>;
};
export function createAgentRuntime(deps: RuntimeDependencies): AgentRuntimeService;
```

WG Port 导入 `../work-graph/ports.ts`，Store 从 `../record-store/ports.ts`，Workspace 从 `../workspace/ports.ts`。Kernel 路径相对于目标入口调整构建产物，复用现有加载方式，不动态 import 用户指定路径。

`continueSession` 是同一 driver 的已有 Session 入口，消费已有 admission，不再 claim。Workflow 负责先选择/创建并调用 WG claim；需要组合便捷 API 时也只能调用这一条 claim+driver 链，不能生成第二 Attempt。`startRun` 名称兼容现有用语，参数明确支持 QueryClaim，结果保留 QueryRun 身份。

`compactSession/regroupSessions` 按方法检查 action.kind；不匹配返回 invalid。创建受理与正式映射是两个阶段；WG 的 WriteResult 只说明本地提交，Runtime 的 OperationReceipt 才表达操作已接受或有真实完成观察。一般执行沿原 outbox/ExecutionRef，不为统一返回格式另造 CoreOperation。

Host 建立 Store→Workspace→WG→Runtime→Workflow，并注入稳定 KernelStoreRegistry。其 `resolve(adapterId)` 返回宿主登记的 `{kernelStoreKey,databasePath}`；只能用配置项查路径，模型输入不能指定存储路径。adapterId 表示一个真实存储实例，不只是内核厂商名。

forWorkspace只为首次创建选择该workspace配置的默认存储实例；在 WG 受理前把 adapterId/storeKey 作为内部路由建议交给 admitSessionCreation，后续一律使用受理 action 保存的 pin。重试/恢复原实例未登记时拒绝，不在新的默认库另建。历史Session总是按其已登记adapterId调用resolve，不能因默认配置变化搬库。RuntimeHostBindings复用现有provider配置绑定与受信根解析，不授予新的领域写能力；任务与Query传完整ExecutionRef，不能仅以局部runId命中缓存。Kernel预算和工具策略从真实配置构造，provider secret由原provider绑定持有，不进入技术记录/工具结果。

initialize只恢复映射/技术观察和待对账列表，不自行规划或调用模型；Host初始化后显式drive。close仅供Host关机，先禁止新drive，再按现有server_shutdown取消机制停止进行中调用、等待已观察结果落盘并flush，最后关闭自己打开的Kernel连接；共享RecordStore由Host最后关闭。关机中断不是用户请求取消的ack，未确认工具副作用继续unknown。close不暴露为业务/模型工具，重复调用须安全。

## 5. 当前真实 Kernel 能力与适配矩阵

以下已经核对 [public-api.ts](../../../../coding-platform/vendor/coding-agent/src/public-api.ts)、[run 组合入口](../../../../coding-platform/vendor/coding-agent/src/app/composition/composition-root.ts)、[resume 组合入口](../../../../coding-platform/vendor/coding-agent/src/app/composition/resume-composition.ts)；修改前必须读 vendor 的 AGENTS.md / INTEGRATION.md。

| 能力 | 当前公开能力与实际行为 | 选定目标接法 |
| --- | --- | --- |
| 创建空 Session | `SqliteStores.open` + `SessionStorePort.create/get`；不调用模型 | 直接支持，稳定 create recordId，真实映射后 WG recordSessionCreated |
| 打开/读历史 | Store get/read，分页位置为数字 | 只读适配；平台游标绑定实例/session/上界，不用恢复函数读历史 |
| 新 Run | `runCodingAgent`已增加可选executionIdentity；默认仍随机生成runId/turnId，旧Run重放已修复并通过R4a验收 | B2正式Task driver已以固定Kernel身份和fresh begin调用；Query入口仍待接线 |
| 完成后继续原 Context | Kernel已增加session_history与throughPosition历史入口；只传sessionId仍是默认current_turn | B2已接正式完成边界后的下一Task/Turn；公共continueHistory标志仍未全面开放，不代表任意恢复/维护已支持 |
| 恢复未完成 Run | `resumeCodingAgent` 调 RecoveryCoordinator，再 resume/continueRecovered | 支持边界内恢复；terminal 和 side_effect_result_unknown 不启动新执行 |
| 安全点 pause | RuntimeRunner before_model/before_tool有Hook pause；公共组合入口已增加controlHooks，恢复预算/沙箱约束已修复并通过R4a验收 | §6 Kernel扩展已验收；平台未接通返回unsupported |
| cancel | AbortSignal 实际取消；不是 pause | 消费正式控制并 abort，等待真实结果后 ack |
| 原生 compact | compactor README 明确无 TS 实现；selectContext 只是预算选材 | nativeCompact=false，未来独立 Kernel 能力；当前不写假成功 |
| 重组/换手 | 没有魔法 Session 合并接口 | 创建目标 Session + 已引用交接材料 + 正式关联更新；旧来源保留 |
| 历史/检查点恢复 | Kernel Store、RecoveryCoordinator、CheckpointStore | 原记录不复制；未知副作用保持缺口，不通过重跑获得“确定结果” |
| 文件修改/工具 | 既有 WorkspaceSandbox/ToolDispatcher/read/edit/shell；当前可写入口仍要求全根授权 | 保留权限、路径和沙箱，按R4p接真实范围限制与共享命令资源；接通并验收前scopedWorkspaceWrites不得为true |

`RuntimeRunner` 没有可直接调用的 pause 方法；after_tool pause 当前不支持。`resumeCodingAgent`已增加limits/workspaceOptions/processSandboxOptions；2026-09-23首轮验收发现的暂停后增预算、省略沙箱限制问题已修复，并通过[2026-09-24独立验收](../../reviews/R3a-R4a-sol-dsh-acceptance.md)。恢复核对实际有效限制、原配置和工作区，不能悄悄丢失原约束；不承诺任意修改参数后都可恢复。平台FakeContextContinuation/FakeLifecycleControl通过不代表真实能力接通。

旧工程 `CodingAgentRuntime.execute` 使用 `join(directory,keyFor(spec)+'.sqlite')`，即每 Run 独立数据库；这不是当前 next driver 的装配。next 已复用正式 Session 的 adapterId/kernelSessionId 与 KernelStoreRegistry 路由，同 Session 的下一 Turn 沿原库和完成边界。旧运行仍须使用其实际 locator，同 sessionId 落在另一库绝不算延续。

## 6. 已选定的最小 Kernel 公共扩展

这部分属于Kernel受管边界内的独立实现项。R4a已按[并行实现任务](../../tasks/DSH-PARALLEL-IMPLEMENTATION.md)修改本项目受管vendor副本；旧Run重放及暂停恢复的预算/沙箱/配置/工作区约束已完成Sol/dsh返修并通过[2026-09-24独立验收](../../reviews/R3a-R4a-sol-dsh-acceptance.md)。[2026-09-23失败报告](../../reviews/R3a-R4a-independent-acceptance.md)只记录首轮历史。以下契约继续作为验收标准；B2已通过公共run接通正式Task及完成后连续Turn，R4平台控制/精确恢复仍未闭合。不直接拼Runner、provider、policy、sink来复制组合根。

**R4.2 Kernel 工具组安全点已验收。** 公开 `ToolGroupBarrier` 由普通 run、固定 executionIdentity 命中的原 Turn 恢复及公开 resume 三条路径透传到唯一 Runner。`before_group` 在本组 tool.started 前真实 await，`after_group` 在整组结果和 required sink 完成后真实 await，最后一组也执行；暂停必须等待原 run.paused 的 required sink。callback 异常和非法返回在持有最新工具组 state 的接缝内落失败事实，保留已完成工具结果与连续 sequence；取消/unknown 不被 pause 覆盖。真 SQLite 测试验证暂停后以原 identity 恢复，仅执行剩余组、不新增 Turn。见[验收报告](../../reviews/next-r5a-r4-tool-group-2026-09-26.md)及[公开 Kernel 回归](../../../../tests/kernel/R4-tool-group-barrier.test.ts)。这是 Kernel 子能力，当前平台 Runtime 尚未接通持久 intent 投递、清理完成证明和 ack；[R4 任务 §11 候选](../../tasks/R4-control-recovery-skeleton.md#11-r43-候选契约持久控制投递进入事实与原历史确认)规定后续接线，尚未交付，不能把 safePointPause/cancel/recoverRun 标为完整支持。

```ts
// Kernel public-api 已增加这些导出；version=2不能替代本节独立行为验收。
export const kernelSessionApiVersion = 2 as const;
export type SessionContextMode =
  | { version: 1; mode: 'current_turn' }
  | { version: 1; mode: 'session_history'; throughPosition: number };
export type ExecutionIdentity = { runId: string; turnId: string };
// 在原类型所在文件向现有interface追加这些字段，不移除原字段。
export interface RunAppInput {
  readonly sessionContext?: SessionContextMode;
  readonly executionIdentity?: ExecutionIdentity;
  readonly controlHooks?: readonly HookPort[];
}
export interface ResumeAppInput {
  readonly controlHooks?: readonly HookPort[];
  readonly limits?: RunAppInput['limits'];
  readonly workspaceOptions?: RunAppInput['workspaceOptions'];
  readonly processSandboxOptions?: RunAppInput['processSandboxOptions'];
}
```

扩展实现必须满足以下行为，不能由猜测的方法补洞：

1. 缺省 sessionContext 仍为 current_turn、缺省 executionIdentity 仍随机生成，旧 CLI 的运行含义不变。平台按执行引用+generation派生固定 runId/turnId并持久保存；重试先按原身份查记录。同身份内容不一致拒绝，已存在的同一 Turn 进入恢复/回放，不追加重复 turn.started。
2. session_history 的 throughPosition 固定为**开始当前 Turn 前最后已完成轮次的边界**。在 Kernel 内校验位置属于该 Session、对应完整稳定边界且没有未决执行；不能把“最后看到的位置”当完成证据。新 Turn 只追加当前 input一次，旧前缀不得含当前 Turn。
3. Kernel 内复用现有 RunState/TranscriptEntry、事件归约、消息校验及 selectContext。逐完成 Turn还原对话，保留 tool-call/result配对；不能只提取模型文本。损坏记录、无法解释的版本、缺失结果均明确拒绝/标缺口，不默默丢弃后宣称恢复成功。
4. ContextBuilder接收前缀+当前 transcript；selectContext基于真实 system/skills/tools和完整合并输入进行一次一致的预算选择。保护工具交换完整性；平台 ModelBudget再核对真实最终请求，不把两次检查变成两套历史选择算法。
5. Kernel `turn.started` 与 checkpoint 需保存可重建绑定 `contextBasis:{version:1,mode:'session_history',throughPosition:number}`；摘要可加速校验但不能取代原记录。重启从该边界和当前 Turn事件重建，不能改成重启时“最新历史”。resume不接新的user input，不创建新身份。
6. 对现有schemaVersion=1日志/检查点采取**可选字段兼容扩展**：新读取器接受无contextBasis的旧记录并保持current_turn含义，校验旧checksum仍按旧原正文；新记录有字段时按其真实正文校验。调整所有strict schema、投影和checkpoint codec；老二进制不能读新字段时明确version_unsupported，不改写旧记录“补字段”。
7. controlHooks由组合根接入既有HookRegistry/HookExecutor；只允许本适配的before_model/before_tool暂停Hook参与控制。确认run.paused持久化后才能ack；模型/工具进行中先显示pending。resume沿原配置与沙箱、预算重建；历史预算状态不得因重启清零。
8. Kernel扩展自身必须用真实SQLite/本地模型替身核对：两轮历史进入实际请求、工具配对、重启与旧checkpoint、重复执行身份、边界损坏、容量裁剪、pause/resume。默认CLI回归和完整kernel+platform构建也要通过，才宣布适配可用。

Kernel已有内部 `session-projection.ts` 不是public-api导出；本方案在Kernel内部复用，不要求平台导入私有路径。缺少辅助投影能力就在本扩展内部实现一次。native compact仍不随这次扩展自动获得。

## 7. 核心执行顺序和材料处理

**2026-09-25 R4c.2a 已验收子集（[报告](../../reviews/next-r4c-execution-reads-2026-09-25.md)）：** `observation-recovery.ts` 提供只读 `readExecutionHistory`，签名见 [execution-history-contracts.ts](../../../../src/core/agent-runtime/execution-history-contracts.ts)。它组合已有 Session history，每调用最多委托一页，按 Kernel runId + turnId 筛选，保留原始记录及来源；不建立另一份日志，也不重写 Kernel reducer。Host 提供的执行身份只用于检索，本函数不证明它与某平台 Run 的绑定，后续 entry 必须持久保存并核对绑定。

分页 limit 是扫描原始条数，命中可少于 limit 甚至为零；nextCursor 封装原页面 nextCursor 并绑定 Session 和执行身份，不能从最后命中记录构造。原 Session basis/entry cursor 和 throughCursor 仍由既有读取器解释，其中 throughCursor 的 position 指定截断位置，不自动代表全 Session 尾部。没有读到记录不证明从未执行，读完页面也不证明完整 Turn 已结束；不在本原语发布 completedHistoryBoundary 或释放许可。

**R4c.2b 已验收区间接线（[报告](../../reviews/next-r4c-history-and-source-2026-09-25.md)）：** `readTaskExecutionHistory(runRef)` 先复用 WG11 获取 `Run.executionHistory`，以其 Session/Kernel 身份及 `startPosition..(endPosition ?? observedThroughPosition)` 调用既有 RT7/RT1；不再扫描发现位置。Run 没有 locator 时明确 unsupported，不默默回退。Graph 只处理关联和外层游标，不重新解析原历史正文；RT7 保留一页过滤；RT1 与 Kernel 负责真实有界读取。同一次分页冻结上界，图水位增长不扩张正在进行的分页；源截短或关联变更明确失败。身份唯一只能定位 Session，实际性能还必须由持久区间和 Kernel 主键范围读取保证。这些起点/终点须来自实际执行证据；B2现已在正式Runtime进入/观察时维护区间，维护操作本身仍待后续接线。

RT7 不传 range 时仍保留从 Session 开头分页的原语义；通过 `readTaskExecutionHistory` 则从已持久区间起点读取。续页只接受本操作返回的游标并固定来源范围。根据[用户原话 DLG-037](../../intent/ORIGINAL-DIALOGUE.md#dlg-037-用户)，两图及 Session/执行关联应降低查找成本：真实进入及观察回流时维护关联、结果和原历史位置，后续查询复用位置，不重复遍历发现。WorkGraph 的正式关系、结果摘要和索引不是另一份 Kernel transcript；Runtime 负责按可信映射和原历史读取协议取回正文，不让业务手工拼游标或另建一套图。

Kernel 的 `SqliteStores.read` 已复用原主键范围读取，同一只读快照获取 header/tail/page；本批消除 read 的全 Session 物化。RT1 删除全量首读，非头页只额外核验位置 1；terminal cursor 可读空末页但仍核 source tail。图定位减少查找范围，Kernel 范围读保证实际 I/O 有界，两处已贯通。append/replay 未改，不能声称 Kernel 全部读写已优化。平台不复制 Kernel 私有 SQL/历史恢复代码。公共 `resumeCodingAgent` 默认选择最新 Turn，不能据它承诺精确恢复任意历史执行。


**R4c.2c 已验收组件接线：** Work 的 `source-capture-access` 依赖 WorkGraph 窄 `SourceSnapshotReads`，复用 Material reader 精确读当前事实，不再要求 Work 消费者提供 events。未知 principal 拒绝，已存 envelope 的实际身份/权限叶字段损坏返回 unavailable，不进入文件 I/O；合法但与绑定不一致仍 forbidden。真实 SQLite → 两层 reader → source access → WorkspaceTools 测试通过；Query 原来源仍依赖真实 events，未迁 provider 保持 unsupported；Task 的正式 prepare/start 已由 B2 接通，不能从组件存在推断 Query 也已支持。

源读取和普通材料工具绑定真实 RunRef/RoleBinding 的 work_run；Query 工具绑定真实 QueryRun。不要统一先通过 coordination resolver 才装配所有读取工具。协作工具继续使用精确 AgentPrincipal 和原领域规则；从共有只读上下文转写命令时不得凭可选字段合成授权。

下列统一执行顺序中，Task路径已由B2实现；Query、控制和未完成执行的resume仍是待接目标。`prepareExecution` 的目标联合入口读取当前任务/Query、占用、角色、材料适用性，保留来源版本。普通任务沿 TaskEnvelopeV1/合法有界ContextBundle，Query沿 QueryExecutionBindingV1；只有本轮新增指令和必要材料进入新Turn，原Session历史交Kernel。append不等于把任意delta JSON塞进旧bundle schema；需要改变正文schema时必须新版本、reader、admission一同交付。既有字段要求保留时填真正的当前规范，避免为减字节省掉必要义务。

执行顺序：

1. 校验admission真实存在、类型匹配、来源当前、Session映射/占用generation一致。业务选中的Session正忙返回busy，不另建会话绕开。
2. `authorizeRuntimeEntry`在WG原子核对当前许可、控制期望、输入摘要及绑定，绑定唯一consumerId/entryGeneration，返回含Session generation的EntryPermit；这两种代际不能混用。权限/资料变化在实际使用前仍检查，prepared不代表已执行。
3. 技术记录固定Kernel store/session/run/turn、输入摘要及permit。调用Kernel之前必须fresh-commit `beginRuntimeEntry`；只有本进程收到committed且replayed=false才可实施这次调用，重复回执只走观察/对账。entering/entry_attempted只说明可能已进入；第一次Kernel持久turn/event或可靠入口回执到达后才`recordExecutionEntered`。崩溃或响应丢失核对原身份，不跳过begin门槛重开执行。
4. `runCodingAgent`消费确定的sessionContext和executionIdentity；恢复未完成执行使用`resumeCodingAgent`。前一轮terminal后的继续必须是新ExecutionRef/newTurn，不能滥用resume。
5. 观察器只保存必要平台增量，RecordStore原子保存技术游标+该增量，然后调用WG recordRunResult；WG按真实event identity/sequence和generation归约。WG提交失败只重送观察，不重跑模型/工具。
6. 完成后WG释放相同owner/generation的占用；旧迟到结果不能释放继任者。完成Run不是完成Task；验证/义务归约由WG继续负责，Workflow决定后续。

旧observer是best_effort，不能当完整日志。中断/掉帧时从Kernel Store补读缺失位置；每个执行只维护一个已保存位置，不靠重复拉全历史来找新事件。Kernel的现有SessionEventSink/RecoveryCoordinator内部仍可能全量读取，本页不声称已经优化；平台不再加一层同等扫描。

记录入账必须传递 RuntimeObservation.source 与 completedHistoryBoundary，不能只解包内层 event 丢掉Kernel来源。Kernel runId/turnId在首次受理后固定，consumer换代不重新生成；beginRuntimeEntry携带该固定映射。完成历史边界从真实完整Turn产生，非终态/缺口不能推进目录cursor。

真正请求上的容量计数、来源再核对、provider配置绑定、结构化Reviewer响应格式、工具授予保留。推荐材料不是隐藏白名单；已有合法范围内的图、历史、文件可通过工具继续查。只读Query不继承普通Run的图写能力；读取历史也不需要造一个QueryRun。

entryGeneration 属于执行驱动者，Session generation 属于对话占用。RuntimeOperationRecord 的执行 binding 同时保存这两者，技术键和观察关联包含 entryGeneration；authorized 阶段换手需WG撤销旧入口，entering后先对账/停止实际旧执行。数据库代际只能拒绝后续不合法提交，不能自动终止旧OS命令；unknown按实际资源保留占用。详细顺序以 [WorkGraph §6.3](work-graph.md) 为准。

准备与恢复用RunStatePort.readExecution读取精确Run/Attempt/outbox/Plan/Session或QueryRun/QueryJob/Session，不能从TaskRow拼猜。工作Run的角色解析调RoleMemoryPort.resolveRoleBinding，保留resolved/absent/inadmissible原语义；declaredPermissions来自真实授予。普通工作Run保留ModelCallAccess.bind/beforeCall：实现落在Runtime薄适配，正式输入/准入通过WG recordRunFact/authorizeModelRequest；它没有虚构的“调用完成ack”方法。Query从真实QueryJob.execution及Session配置取得已有角色，缺省按旧查询配置处理，不为了套工作Run链而制造RoleBinding；保留现有精确QueryExecutionBinding、只读工具、ModelBudget、read_query_fact来源校验和发布检查，不伪造普通Run的ModelRequestPermit。源材料/真实最终请求变化要形成准确指纹，不能复用旧permit放行新请求。

### 7.1 B1/B2 接线与 C2 当前消费者（2026-09-26）

**状态：B1 Kernel 适配接缝已验收；与 W1 联合物理隔离 78 文件 / 726 项通过，typecheck、build、边界和编译入口均通过。** 见 [B1/W1 验收](../../reviews/next-b1-w1-2026-09-25.md)、[B1 专项记录](../../reviews/evidence/next-b1-w1-2026-09-25/b1-independent.log)及[真实 Kernel 测试](../../../../tests/runtime/B1-kernel-assembly.test.ts)。这是 B1 当时的组件验收；后续 B2 已接正式 prepare/start、进入入账、观察归约和精确释放，C2 已接平台工具消费者。上述历史验收数量不作为本次合入或完整隔离的统计。本节收敛前述完整草案的做法，不以新增管理模块补接缝。

**受信配置装配接缝已有。** `runObservedModel` 已接受可选 `skills/controlHooks`，复用公开 Kernel 配置与 HookPort。首次 await 前快照 resourceRoot/enabledIds、Hook 元数据及 execute 引用；函数保留原 receiver，不 JSON 克隆，也不承诺冻结 Hook 闭包状态。显式空 enabledIds 保持为空，未传 skills 才保留原 coding-safety。B2/C2现从正式Session/Role与可信Host配置装配该输入；模型JSON不能直接作为此配置。已有 sessionContext/executionIdentity 仍交 Kernel，平台不复制原历史正文。

**真实进入屏障。** 冻结 Kernel 的 [composition-root.js](../../../../vendor/coding-agent/dist/app/composition/composition-root.js) 等待写入 `turn.started`；[runtime-runner.js](../../../../vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js) 等待提交 `run.started` 后，在首次模型请求前 `await hooks.beforeModel(...)`；公开 [control-hooks.js](../../../../vendor/coding-agent/dist/app/composition/control-hooks.js) 也等待 Hook 的 `execute`，只接受 continue/pause。B2正式driver已复用公开 `controlHooks.before_model`：

```text
Run 上 fresh begin，固定 Kernel 身份
→ Kernel 持久化真实 Turn / Run 开始事实
→ before_model 等待：核对原历史来源 → WG12 维护定位 → WG 确认 entered
→ 仅确认成功才 continue → 模型调用
```

上述是B2正式fresh进入所消费的顺序；需要同时更新定位和业务状态时复用 WG12 校验/编译进同一事务，不要求额外重复写 Run。`onConfiguration` 没有被 await，不能承担异步屏障；best_effort observer 的异常会被吞下，也不能作为唯一保证。确认失败返回 pause 或抛错，不继续调用模型，不在调用 Kernel 前预写 running。B1 已把 RT3 的 controlHooks 传给既有 Kernel，真实测试确认 before_model 在 Turn/Run 持久化之后等待，暂停时零模型调用；B2已把该屏障接到生产WG entered writer。预算、取消、配置等路径可能在 before_model 前结束，后续观察器仍须核对真实终态；未经过屏障不等于模型已经调用，也不证明 Kernel 未写 Turn。

**来源工具惰性打开已有。** [observed-model-run.ts](../../../../src/core/agent-runtime/observed-model-run.ts) 的 frozen 来源已支持 `openOn:'first_use'`：先注册 project_source，实际有效工具调用才复用原 factory/guard 打开；缺省或 before_run 保留旧打开时机。原 [source-capture-access.ts](../../../../src/core/agent-runtime/source-capture-access.ts) 的 `Run.running + authorization.entered` 守卫不放宽，不另造权限实现。project_source 通过既有 access 的 resolver 形式，在参数/路径/当前性检查及取消检查后取能力；无 read、未使用工具或首次 before_model 暂停时 factory 不调用。

同一 Run 共享一次打开 Promise，并缓存同步抛错与异步拒绝；后续调用不重试、不回落 project_index。惰性打开失败作为工具 error 交给 Kernel，不假定整个 Run 必须抛异常。工具组先取消并排空在途操作，再等待已开始的 factory，最后关闭实际创建的 source 一次；当前性检查期间发生取消不再启动 factory，打开期间取消则等待并清理。清理不覆盖原执行错误，也不把清理失败伪报成功。正式driver现选择first_use；进入之后仍核对实际材料撤权及真实Run绑定。C2只选择平台工具的Run不打开源码factory，不因没有文件读授权阻挡已获准的平台操作。

**Prepared 的信任边界。** 复用已有 Artifact/RecordStore body 保存有界装配清单，由 Run.envelope/inputBinding 固定引用、版本与摘要；start 依据这些可信记录重读、核对，并从 Host 绑定取得模型和受信根。调用者回传的 Prepared、摘要或字段不能授予 tools、sandbox、Role、Kernel 身份。正文若需新形状，交付版本化 codec/reader，不能把任意 delta 塞进旧 bundle。清单只含必要当前输入和双图、材料、Session 区间定位；原历史继续通过 RT7/RT1/Kernel 读取，不复制 transcript。B2已实现版本化Prepared清单及reader，C2复用同一正文与M2 facts，不另建装配状态。

**正式Task执行消费者已接。** `model-call-access.ts` 已将 bind/beforeCall 接入真实 WG 模型许可，driver 依据最终请求指纹签发/消费，重放不再次调用 provider。`execution-observation.ts` 沿原历史归约真实终态，WG仅释放相同owner/generation，Session挂靠保持；未知结果不释放。Task/Goal是否完成仍归正式证据/义务归约，Query咨询、控制/恢复、维护与Workflow不因这条Task路径完成而视为已交付。

**B2已实现的接线约束。** 下表的Task路径已经由现有driver和WG消费，仍是后续扩展必须遵守的边界。有可信依赖时 `runtime.ts` 装配真实prepare/start/observe；无Runtime Host配置时执行明确unsupported，原Session创建/历史读取保持可用。表中Query、控制及维护的扩展目标不得据此视为已实现。

| 接线面 | 复用入口 | 已接Task路径的约束 |
| --- | --- | --- |
| Role / TaskInput / Session 装配 | [configuration/contracts.ts](../../../../src/core/work-graph/configuration/contracts.ts) 的 `resolveRoleBindingFacts/readRoleSpec`、[plan-contracts.ts](../../../../src/core/work-graph/tasks/plan-contracts.ts) 的 `readTaskInput`、[sessions/contracts.ts](../../../../src/core/work-graph/sessions/contracts.ts) 的 `readSession` | 受信 Host 将精确 Role pin 映射到稳定 Skill/工具配置；保留 resolved/absent/inadmissible。通过既有 Artifact body 保存有界装配清单，引用本次 Task/Module、材料和 Session 区间，不复制原历史。 |
| Run 固定授权与 fresh 进入 | WG11 `readExecution`；[dispatch.ts](../../../../src/contracts/dispatch.ts) 的 Run `inputBinding/executionAuthorization`；唯一 Run schema owner [record-readers.ts](../../../../src/core/work-graph/materials/record-readers.ts) | 在原 Run 绑定上版本化核对输入、固定 Kernel 身份、Session generation 与 entryGeneration；已接 `authorizeRuntimeEntry/beginRuntimeEntry`，仅 fresh 提交允许调用 Kernel，重放只观察/对账。同步原 codec，不另建进入状态源。 |
| entered 与历史定位同事务 | B1 `runObservedModel.controlHooks`；WG12 [execution-history-service.ts](../../../../src/core/work-graph/tasks/execution-history-service.ts) 的 `recordExecutionHistory` | 提取并共用 WG12 的内部校验/编译逻辑，在 before_model 核对真实 Turn/Run 起始证据后，将 entered 与历史定位合成一次 WG 提交；不串行重复写同一 Run，不以 best_effort observer 代替屏障。 |
| 增量观察与真实终态 | RT8 [graph-execution-history.ts](../../../../src/core/agent-runtime/graph-execution-history.ts) → RT7 [observation-recovery.ts](../../../../src/core/agent-runtime/observation-recovery.ts) → RT1 原历史读取 | 沿已存位置补读并归约原事件；核对持久终态与完整 Turn 后才推进完成边界，不能只依据 Kernel 返回状态。paused、记录缺口和未知工具副作用分别保留，用户分页游标不能直接当跨主体的续轮授权。 |
| 相同 owner 的终态释放 | 原 Run/Attempt、Session occupancy、`TaskLeaseSnapshot`；[claim-contracts.ts](../../../../src/core/work-graph/tasks/claim-contracts.ts) 的 `TaskClaimOutbox` | 给既有 Lease/outbox 补 released/终态语义并同步原 codec、领取与资格 reader；结果归约仅释放匹配 owner/generation 的占用，下一次领取 CAS 当前版本。Run 结束不自动完成 Task/Goal，也不移除待命 Session 的图挂靠。 |
| 每次模型调用的正式准入 | `ModelCallAccess.bind/beforeCall` 与 [observed-model-run.ts](../../../../src/core/agent-runtime/observed-model-run.ts) 的最终请求核对调用点 | Runtime薄适配与WG正式输入/请求准入已接；绑定真实装配摘要，按最终请求指纹取得并消费许可。正式 driver 不跳过该接口，重放许可不再次调用 provider，不虚构完成 ack。 |


**C2平台工具与材料已接入真实回合。** [execution-driver.ts](../../../../src/core/agent-runtime/execution-driver.ts) 从正式Run/Session/Prepared固定work_run和材料reader，复用 `createSessionMailboxTools` 的六种通信工具及 `createWhiteboardTools` 的 `query_task_graph/query_ready_tasks/propose_future_plan/apply_future_plan`。工具清单严格取有效manifest授权交集，稳定requestId由实际callId及完整执行/操作身份派生；工厂声明names与实际definitions一致，未知工具或缺依赖在fresh路径拒绝。通信回合真实读取inbox/正文并回应；白板回合真实query→propose→apply→query，沿W2领域授权与future-only规则，不由Runtime另行规划。

[create-platform.ts](../../../../src/composition/create-platform.ts) 使用唯一executionReader、Plan service、mailbox与Host授权投影：W2 delegatedWrites、C1新动作、B2 entry/model复用同一回调；M2 facts由同一个authority/index/source/bodies构造。真实M1 grant→W1接受exact TaskInput→consumer claim→Prepared→模型输入已接，撤销grant后fresh start拒绝，已经发生的终态/原start回执仍可读取。此处交付的是正式材料输入与局部facts/CAS准入；当前driver没有装配通用 `read_material` 模型工具，不扩大这一能力声明。

C1新写在receipt miss后复用Prepared/Host/Role准入，历史读取只核原Run/outbox/Session身份与实际访问范围，不机械读取当前Plan/Attempt/Lease。相同identity的ack/respond在另一调用真实提交后读取到read/responded时，恢复原committed回执，不重复正文或事件。初始Role身份和外部caller仍核对，不增加运行中换Role生命周期；真实Host grant撤权阻止新动作，不抹去旧事实。

**三种Skill与系统指令由可信Host选择。** 已部署 `resources/skills/platform-secretary`、`platform-adviser`、`platform-scribe`，分别提供秘书、参谋、书记指导。driver将Host的resourceRoot/enabledIds和非null systemInstruction交同一runObservedModel；真实Kernel请求已验证三种Skill正文与Host提供的安全指令一同进入system prompt。显式空enabledIds保持为空，不自动启用角色Skill；Skill正文不产生权限、常驻Agent或调度器。

平台工具与文件权限分别装配：仅通信/白板工具的Run仍使用真实Kernel root，但不调用源码authorize/assertCurrent或打开source factory；没有获授的read/edit/shell不会出现在真实清单。平台写不因此打开文件写权限，原readOnly与沙箱约束保持。公开操作沿组合根trackedCall排空，内部持有raw领域服务，不把关闭包装反注入进行中的调用。

真实消费者证据见 [C2 Runtime回合测试](../../../../tests/runtime/C2-runtime-platform-tools.test.ts)、[组合根白板/材料测试](../../../../tests/composition/C2-runtime-platform.test.ts)、[邮箱回执/历史身份测试](../../../../tests/work-graph/C2-mailbox-admission.test.ts)及[三种Skill测试](../../../../tests/runtime/W2-role-skills.test.ts)。这些接线已合入，并随 R5a/R4.2 纳入[最新完整隔离验收](../../reviews/evidence/next-b2-2026-09-26/r5a-r4-isolated-result.json)：102 文件／1,007 项通过，类型、构建、模块边界（实际 6 条／允许 8 条）、24 项 Kernel 产物再生及编译入口 open/close 均通过；8,827 个受保护文件零变化，目标源码 194 个 TypeScript 文件、43,116 行。Query 真实执行/有来源回答、平台持久控制到实际 pause/cancel 及清理后 ack、平台原 identity 恢复、compact/维护/重组和 Workflow 自动推进仍待各自闭环。Kernel 原 identity 恢复及 R4.2 安全点已有子能力证据，公共平台能力标志仍不能整体开启。

## 8. 创建、控制、重组与命令检查

创建/原历史读取已有正式入口；R4.2 已交付 §6 的 Kernel 工具组安全点。R4.1已提供platform.controls持久queued受理/读取及四个fresh屏障；以下Runtime投递、Query取消、维护/重组和命令检查仍描述目标协议，R4.3观察/清理/ack及后续恢复未交付，具体候选见[R4 任务 §11](../../tasks/R4-control-recovery-skeleton.md#11-r43-候选契约持久控制投递进入事实与原历史确认)。

**创建：** WG admitSessionCreation 保存稳定plannedSessionRef与操作 →技术映射配置 →Store.create固定sessionId/recordId →WG recordSessionCreated。create响应丢失先get核对原身份，不能随机新建。映射未完成不给claim；claim冲突时已独立创建的Session可闲置，无需回滚删除。

**控制：** applyControl只接已受理intentRef，通过readControl读取期望与当前真实Run再作用。cancel发送AbortSignal后等待真实终止；pause将复用§6的before_model与R4.2工具组屏障，持久投递和ack仍待接线。控制过期或指向另一generation没有副作用；unsupported如实返回。恢复发现side_effect_result_unknown保留占用/租约和具体缺口，不能用cancel成功掩盖此前未知写入。QueryRun cancel沿QueryJob close路径：driver观察正式关闭要求，对该Query的实际controller发送AbortSignal，真实终止/未知观察再归约并释放占用；close提交本身不是Kernel已停。首批不支持QueryRun pause。

**重组：** Workflow给出sources、target、版本化handoffRef与角色；WG原子占用所有需变更的Session槽 →确认来源可读取/目标已创建且闲置 →装配交接材料 →WG提交关联及实际结果 →释放同operation generation维护占用。重组不自动运行模型，不自动归档旧Session，不删除历史。需要模型生成交接摘要时先安排单独已授权执行；摘要是来源材料，不能把未生成摘要当Kernel压缩。创建目标与维护失败可分阶段重试，原会话资料保留。

**检查：** runCheck复用CommandCheckLifecycle的正式requestId/fingerprint、现行轮次绑定、工作区租约、ProcessSandbox、报告正文与证据受理；租约经WG acquireReadLease/acquireWriteLease/releaseLease原精确命令，不直接写Store。检查不必启动Agent或伪造新Run；现有VerificationScope可引用被检查Run。平台在原人类请求已授权验证时传真实授权依据，不新增一次同义allowExecute确认。命令未启动可重试；副作用未知禁止自动重执行，只reconcileCheck补观察/入账；租约未知时保留。检查PASS不直接改Task为satisfied。

上段 V1 租约调用是旧路径迁移依据。新并行路径中检查按独立 check owner 进入同一资源协议，不借被检查 Run 身份重入写占用；命令 footprint 包含输入现场读取、生成输出和共享资源。不可证明的副作用返回 unresolved/unsupported 及原因，Agent 可选限域命令/输出隔离/调整分工。普通冻结源码查询继续不占全工作区读锁。范围收缩/释放前排空相应在途工具；权限 token 或 generation 变化不能撤销已经运行的 OS 进程。

文件修改继续通过受许可的Kernel编辑/shell或既有候选补丁桥接；这里不新增无占用的任意文件写Port。完成后把变化提示交Workspace捕获/失效，完整来源验证仍由Workspace负责。

## 9. 技术记录、失败窗口与恢复

正式CoreOperation/Run/Session状态由WG维护。以下只是Runtime namespace中的适配技术记录草案，RecordStore通过泛型和codec存取，不反向依赖本模块。

**B 首批收敛选择（2026-09-25，待实现/验证）：** 下方 `RuntimeOperationRecord/RuntimeObservation` 和 §4 的 records 依赖保留为完整设计草案，不要求先建第二数据库、第二运行表才能接通执行。已有 `Run.executionAuthorization`、`Run.executionHistory`、`Run.inputBinding` 能表达的进入绑定、历史位置和输入引用优先复用/版本化，正式变更由 WG 提交；RuntimeEntryRecord 只是其公开结果，不能与 Run 各自推进状态。只有发现独立技术消费者确实需要、现有记录无法表达的预算计量、适配恢复或待投递观察，才冻结最小新增记录及其原子推进关系；仍使用既有 RecordStore，不复制 Kernel 历史。下文技术 binding/游标的约束保留，但不意味着这些字段必须再保存一份。

```ts
export type RuntimeOperationRecord = {
  schemaVersion: 1; operationId: string; revision: number;
  binding:
    | { kind: 'session_operation'; operationRef: OperationRef }
    | { kind: 'execution'; executionRef: ExecutionRef; generation: number; consumerId: string; entryGeneration: number }
    | { kind: 'check'; scope: VerificationScope; requestId: string };
  sessionRef: SessionRef | null;
  kernel: { adapterId: string; kernelSessionId: string;
    runId: string | null; turnId: string | null; lastPosition: number } | null;
  delivery: 'adapter_prepared' | 'entry_attempted' | 'observing' | 'reconciled';
  inputDigest: string | null; preparedRef: ArtifactRef | null;
  modelConfiguration: RuntimeModelBinding['configuration'] | null;
  meter: { budget: RuntimeBudget; inputTokens: number; outputTokens: number;
    requests: number; toolCalls: number; deadlineAt: string | null } | null;
  lastObservationSequence: number; updatedAt: string;
};
export type RuntimeObservation = {
  operationId: string; sequence: number; observedAt: string;
  source: KernelObservationSource | null;
  completedHistoryBoundary: CompletedHistoryBoundary | null;
  value:
    | { kind: 'execution'; observation: ExecutionObservation }
    | { kind: 'control'; acknowledgement: SafePointAcknowledgementV1 }
    | { kind: 'session'; operationRef: OperationRef; observation: SessionOperationRecord['observation'] }
    | { kind: 'check'; record: CommandCheckRecord }
    | { kind: 'gap'; reason: string };
};
```

`operationId`是Runtime技术键，不宣称每个值都是WG CoreOperation。键由完整binding的canonical表示派生并版本化（例如runtime-v1+SHA-256），包含项目、scope、kind、正式完整引用；绝不直接用局部operationId/runId。执行consumerId在同一受理代际内稳定；更换消费者必须先走WG入口授权代际规则，不能仅改技术记录。delivery不是正式phase，不用于解除占用、认定完成或跳过准入。check的sessionRef/kernel为null，不制造会话。meter保存平台累计预算的必要已观察计数，与观察同事务推进；重启从记录和未消费Kernel观察补齐，不清零deadline或用量。实例Host配置按adapterId可恢复定位，不把绝对路径写给模型。

| 失败窗口 | 恢复依据与允许行为 | 禁止行为 |
| --- | --- | --- |
| WG受理后未准备 | 原admission/outbox重新prepare | 重新claim制造第二Attempt |
| 已授权、确定未进Kernel | 按WG原入口授权重试/撤销流程核对 | 仅凭“没有平台日志”断言未执行 |
| Kernel已写Turn、平台未记entered | 原store+runId/turnId查证，再recordExecutionEntered | 随机身份第二次start |
| 模型/工具中断 | Kernel恢复结果决定continue/paused/terminal/unknown | 不检查副作用直接重跑 |
| 技术观察已存、WG提交失败 | 同eventId/sequence再次归约 | 重执行工作取得同样结果 |
| 历史游标失效或DB不可读 | 标unavailable/缺口，保留原位置 | 换新DB当原Session恢复 |
| 占用已换generation，旧结果迟到 | 作为旧执行观察核对，保留历史 | 清掉新执行占用 |
| 维护部分完成 | 按operation查实际创建/材料/关联阶段 | 失败即声称旧会话已归档/压缩 |

不承诺跨平台事务和Kernel的exactly-once副作用；稳定身份+持久记录使重复入口可检测，未知区间明确暴露。重启只恢复已保存意图，不启动新的业务规划。

## 10. 旧符号迁移、删除点与验收

| 当前源码/符号 | 目标去向 | 保留/删除条件 |
| --- | --- | --- |
| [CodingAgentRuntime](../../../../coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts) prepare/start/execute/cancel | driver、Kernel适配、control、store locator | 删除每Run随机Session默认；旧库/日志读兼容保留直到迁移可核对 |
| [runObservedModel](../../../../coding-platform/src/execution/worker-runtime/observed-model-run.ts) | kernel-adapter、input、budget | 复用最终请求计量/来源守卫/工具授予，不能只迁 happy path |
| [RuntimeDispatch](../../../../coding-platform/src/control/dispatch-engine/runtime-dispatch.ts) drive/recover | driver、observation-recovery | 旧普通/Handoff重复drive退出；现有结果去重和未知保护保留 |
| dispatch-engine / reviewer-dispatch / handoff-drive | 同一driver，模式保留角色与必要隔离 | 所有生产入口迁入后删旧执行副本 |
| [runtime-context](../../../../coding-platform/src/data/context-compiler/runtime-context.ts)及reviewer-runtime-context | input-adapter；材料索引/读取归WG/Workspace | 不搬整套历史重建为Runtime私有副本 |
| context-continuation-adapter / lifecycle-control-adapter | legacy测试适配逐步退出 | Fake成功不能启用生产capability |
| read-only-query-runtime、query-answer-review/audit | driver的Query分支与原结果校验 | Query权限/来源和answer格式不能被普通Run吞并 |
| CommandCheckLifecycle / CommandCheckProvider | check-execution | 现行租约、报告、未知副作用恢复和轮次核对迁完才能删 |
| RuntimeObservationJournal累计JSON保存 | RecordStore增量技术观察 | 旧文件按明确迁移标记双读，不重复回流；原Kernel日志不复制 |

实施先落Kernel §6扩展并独立验收，再接空Session/历史读取和稳定Store映射，随后接统一driver及控制、检查，最后迁普通/Query/Reviewer/Handoff调用点并删适配。源码结构与Kernel扩展必须在[实施方案](../../IMPLEMENTATION-PLAN.md)记录为不同前置；本页完成不代表两者已实现。

最少验收场景：

1. create/readHistory不会调用provider；映射失败无法claim；重复create不生第二Session。
2. 同Session连续两次Run实际请求包含前轮必要user/assistant/tool交换，当前input只出现一次，数据库实例相同；只有sessionId相同不算通过。
3. 两个并发claim最多一个进入同Session；maintenance与执行也互斥；未用的合法新Session可闲置。
4. 真实普通、Query、Reviewer、Handoff共用driver且工具/写范围不同；Query身份不强转普通Run。
5. 注入每个失败窗口，确认重复启动受阻、观察可补送、unknown不伪成功、旧generation不释放新占用。
6. pause有真实run.paused后才ack，cancel不是pause；未接能力返回unsupported，compact不伪实现。
7. resume恢复原角色/工具/沙箱/预算，side_effect_result_unknown不重跑；旧checkpoint兼容可验证。
8. 检查命令结果已存后提交失败只补受理；工具副作用未知时保持租约和可见缺口。
9. 容量使用真实完整请求计数；来源变化在使用前被发现；历史查询分页冻结上界且不重扫平台全日志。
10. 对比新旧主路径、重复判断与观察保存量；移除旧生产入口后再宣告代码精简。测试和构建证据指向实际运行产物，不能把设计代码块当编译结果。
