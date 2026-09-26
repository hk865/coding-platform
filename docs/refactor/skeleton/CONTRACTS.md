# 共同契约、身份与模块装配约定

> **2026-09-24 并行语义纠偏：** 任务图是协作白板、状态/历史与证据索引；预期依赖和架构影响不自动阻止执行。明确采用的具体输入条件在需要消费时检查，不以生产方整个 Task satisfied 代替。取消每次 Task/Query 领取必须预证明全部未来范围、预占资源的要求；身份、权限、幂等、同 Session 一致性及实际操作的原子性仍保留。下文尚含该旧方案的 scope/reservationRef 必填代码块，标记为**待按具体工具收窄的草案，不得直接冻结施工**。最新行为图见[并行设计 §1.2、§3](../PARALLEL-COLLABORATION.md)；当前代码差异见[审阅报告](../reviews/task-graph-orchestration-intent-2026-09-24.md)。


状态：目标骨架设计，2026-09-23。本文给出五模块共享的最小字段与调用约定；各能力的完整 Port、请求/结果及实现文件在相应模块页。**代码块是目标 TypeScript 设计，不表示这些源码文件已经存在或已经通过类型检查。** 旧类型注明实际来源；新增类型需要同批实现和装配验证。

## 1. 契约文件的归属

相对于代码仓 `coding-platform/`：

```text
src/contracts/
  command-event.ts           # 保留 ActorRef / CommandIdentity / CommitCursor
  dispatch.ts                # 保留 TaskTriple / RunRef / TaskAttemptRef / RuntimeEventV1
  plan.ts                    # 保留计划/任务/义务与 PlanRevisionRef
  artifact.ts                # 保留 ArtifactRef 与旧 ArtifactPort 兼容入口
  query-job.ts               # 保留 QueryRunRef / QueryJob 及既有只读查询协议
  ledger.ts                  # 保留既有聚合与旧提交契约，按批次扩展并退出旧适配
  core/                      # 新增共享身份/记录；不是第六个 Module
    identity.ts              # TaskRef 别名、SessionRef、ModuleRef、ExecutionRef
    call-context.ts          # 真实调用上下文、MaterialReader / PlatformMaterialOrigin
    results.ts               # ReadResult / WriteResult / CoreError / Page / ReadStamp
    operations.ts            # OperationRef / OperationReceipt / OperationProgress
    source.ts                # 临时捕获与持久来源引用，分别表达
    session.ts               # SessionRecord / SessionWorkLink / 占用联合
```

每个模块内部的 `ports.ts` 只导出本模块公开能力；不把所有领域请求和算法集中进一个大 Port。只有两个以上模块必须共享的身份/持久记录放入 `contracts/core/`。共享契约不导入五模块实现；RecordStore 不为了理解一个记录类型反向 import WorkGraph。

旧 `src/contracts/**` 的事件正文、ID 和版本语义继续有效。改变代码归属不能自动改变磁盘格式；旧调用者仍在时保留窄兼容转换，逐个 `commitKind` 验证迁移后删除旧分支。

## 2. 稳定身份

```ts
// 以下 import 均对应现有源码类型；路径按目标 contracts/core 文件计算。
import type { TaskTriple, RunRef, TaskAttemptRef } from '../dispatch.js';
import type { QueryRunRef } from '../query-job.js';
import type { WorkContextRef } from '../context-continuity.js';
import type { RoleSpecPinV1 } from '../role-spec.js';
import type { VersionedRef } from '../ledger.js';
import type { OperationRef } from './operations.js';

export type ProjectScope = { projectId: string };
export type WorkspaceScope = ProjectScope & { workspaceId: string };
export type TaskRef = TaskTriple;
export type ExecutionRef = RunRef | QueryRunRef;
export type SessionRef = ProjectScope & { sessionId: string };
export type SessionAggregateRef = SessionRef & { aggregateType: 'Session' };
export type ModuleRef = ProjectScope & { moduleId: string };
export type WorkLinkTarget =
  | { kind: 'task'; ref: TaskRef }
  | { kind: 'work'; ref: WorkContextRef }
  | { kind: 'module'; ref: ModuleRef };
export type WorkLinkRelation = 'responsible' | 'participates' | 'investigated';
export type SessionWorkLinkRef = SessionRef & {
  aggregateType: 'SessionWorkLink';
  target: WorkLinkTarget;
  relation: WorkLinkRelation;
};
export type RoleConfigurationRef =
  | { kind: 'role_spec'; pin: RoleSpecPinV1 }
  | { kind: 'legacy_template'; templateId: string; templateRevision: string };
// next 的 AggregateRef 已统一包含 Session/SessionWorkLink/CoreOperation。
export type VersionPin = VersionedRef;
export type CommandMeta = {
  requestId: string;
  expected: readonly VersionPin[];
};
```

TaskRef 不是新 Task 聚合，不添加新的 Task ID。RunRef 与 QueryRunRef 的字段不同，必须分型，不能强转或伪造 TaskAttempt。PlanRevisionRef 的 `planId` 定位不可变计划，快照 revision=1 与业务计划序号 `planRevision` 不相同。ModuleRef 可定位正式 baseline 内的模块，不意味着每个 Module 要新建聚合表。

调用者从先前查询结果取得版本和来源引用，不自行猜 digest。requestId 不是全系统唯一键；与真实 project/actor/principal 及原命令指纹一起映射到既有 CommandIdentity。同身份、同内容返回原结果；同身份、不同内容拒绝。

## 3. 调用上下文：由 Host/工具适配器绑定

```ts
import type { ActorRef } from '../command-event.js';
import type { AgentPrincipalRefV1 } from '../coordination.js';
import type { RoleBindingRefV1 } from '../dispatch.js';
import type { ArtifactOwnerRunRef } from '../artifact.js';
import type { MaterialBasisV1 } from '../material-access.js';

export type CorePrincipal =
  | { kind: 'host'; actor: Extract<ActorRef, { kind: 'human' | 'system' }> }
  | { kind: 'work_run'; runRef: RunRef; roleBinding: RoleBindingRefV1;
      agentPrincipal?: AgentPrincipalRefV1 }
  | { kind: 'query_run'; queryRunRef: QueryRunRef;
      initiator: Extract<ActorRef, { kind: 'human' | 'system' }> };
export type MaterialReader =
  | { kind: 'run'; requester: ArtifactOwnerRunRef; currentBasis?: MaterialBasisV1 }
  | { kind: 'host'; projectId: string; workspaceId?: string;
      actor: Extract<ActorRef, { kind: 'human' | 'system' }> };
export type PlatformMaterialOrigin = {
  kind: 'platform_operation'; projectId: string; workspaceId?: string;
  requestId: string;
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};
export type CoreCallContext = {
  projectId: string;
  workspaceId?: string;
  principal: CorePrincipal;
  materialReader: MaterialReader;
  signal: AbortSignal;
};
```

CoreCallContext 是受信调用层构造的参数，不进入模型可填写的 tool schema。它记录身份和实际范围，不凭某个 `kind` 发放全部能力：Host 已有权限与 Workspace 沙箱检查、运行的真实能力授予、领域提交的现行版本/范围条件仍各自在使用时执行。跨 workspace 读要有真实合法 scope，不能删除 workspaceId 达到扩大权限的效果。

work_run 由受信运行适配器绑定真实 RunRef 与固定 RoleBinding，不要求先建立邮箱参与关系。已有协作参与时可附 agentPrincipal，其 Run/角色/项目必须与外层一致；没有参与关系也能按真实授予执行文件读取。通信或正式 agent 命令仍必须解析并核对完整 AgentPrincipal，再生成原 ActorRef.agent / CommandIdentity；不能因这里的字段可选而放宽旧命令规则、伪造 agentInstanceId，或改用 human/system 归因。原命令身份、指纹和旧记录不变。query_run 不强塞进它：QueryRun 占用 Session，但只装配当前查询路径实际允许的工具；这不自动授予修改 Task/Plan/正式架构的能力。其受理和运行结果由真实 driver/system 写入对应 Query 协议，仍记录 QueryRun 来源，不能假扮普通工作 Run。未来扩展查询 Agent 的正式写工具时必须显式演进 principal 契约，不偷偷用 human 身份代写。

这一主体细化在 R2c 接线时根据实际 TaskEnvelope 与可选 coordination grant 确定；只解耦读取身份与协作身份，不增加任何授予。

普通文件/图/历史查询直接使用合法 host 或现有运行上下文，不创建虚假的 QueryRun。需要模型作答才进入 QueryJob/QueryRun。原 ArtifactPort 只支持 Run 读者的限制由 WorkGraph 材料入口拆分；RecordStore raw body 读取只供可信内部实现，不暴露给模型/UI绕过材料适用性。

## 4. 结果、分页与长操作

```ts
import type { CommitCursor } from '../command-event.js';
import type { PlanRevisionRef } from '../plan.js';

// operations.ts拥有OperationRef；identity.ts仅import type，避免双份定义。
export type OperationRef = {
  aggregateType: 'CoreOperation'; projectId: string; operationId: string;
};
export type CoreError =
  | 'invalid' | 'forbidden' | 'revision_conflict' | 'idempotency_conflict'
  | 'not_found' | 'dependency_blocked' | 'cycle' | 'busy'
  | 'source_stale' | 'incomplete' | 'capacity' | 'unsupported'
  | 'unavailable' | 'cancelled';
export type ReadStamp =
  | { kind: 'platform'; cursor: CommitCursor }
  | { kind: 'plan'; ref: PlanRevisionRef }
  | { kind: 'source'; capture: SourceCaptureRef }
  | { kind: 'session'; ref: SessionRef; cursor: string };
export type ReadBasis = { atLeastCursor?: CommitCursor; revision?: number };
export type Page<T> = { items: T[]; nextCursor: string | null; basis: ReadStamp };
export type CoreRejection = {
  status: 'rejected'; code: CoreError; reason: string; current?: VersionPin[];
};
export type ReadResult<T> =
  | { status: 'ready'; value: T }
  | { status: 'not_ready'; observed: ReadStamp | null; required: ReadStamp }
  | { status: 'not_found' }
  | CoreRejection;
export type WriteResult<T> =
  | { status: 'committed'; value: T; replayed: boolean; cursor: CommitCursor }
  | CoreRejection;
export type OperationReceipt<T> =
  | { status: 'accepted'; operationRef: OperationRef;
      replayed: boolean; cursor: CommitCursor }
  | { status: 'completed'; operationRef: OperationRef; value: T;
      replayed: boolean; cursor: CommitCursor }
  | CoreRejection;
export type OperationProgress<T> =
  | { phase: 'accepted'; operationRef: OperationRef }
  | { phase: 'running'; operationRef: OperationRef; executionRef: ExecutionRef | null }
  | { phase: 'completed'; operationRef: OperationRef; value: T }
  | { phase: 'failed'; operationRef: OperationRef; code: CoreError; reason: string }
  | { phase: 'unknown'; operationRef: OperationRef; reason: string };
```

`WriteResult.committed` 表示平台原子提交完成，不等于 Kernel 副作用成功。`OperationReceipt.accepted` 需查询/观察进度；progress.running 表示该操作进入执行适配阶段，执行引用可空，不能据此在 UI 显示模型已运行。unknown 保存实际缺口和占用，不随便改成 failed 释放资源。

旧接口的细分错误保留为明确适配，不能为了套 CoreError 丢弃信息。WorkspaceTools 等需要表达解析覆盖/partial 的操作在模块页定义专用结果；不能让“没有解析器”返回成功空图。

分页游标对调用方是不透明字符串，必须绑定查询条件、scope、来源版本及实际读取权限范围。ReadStamp 标明结果依据；历史页可继续读冻结版本，要求当前性的使用还需 verify。token 过期/捕获被释放返回显式失效，不能换新来源接着拼页。

## 5. 临时源码捕获与持久来源

```ts
import type { ArtifactRef } from '../artifact.js';

export type SourceCaptureRef = WorkspaceScope & {
  captureId: string;
  workspaceRevision: number;
  sourceDigest: string;
  configDigest: string;
  indexVersion: string;
};
export type PersistedSourceCaptureRef = {
  capture: SourceCaptureRef;
  material: ArtifactRef;
};
```

SourceCaptureRef 指向 WorkspaceTools 的有界捕获对象，没有 ArtifactRef；WorkspaceTools 不依赖 RecordStore。它保留冻结清单和本次查询所需内容，游标使用同一捕获。保存历史由 WorkGraph 调 RawArtifactStorePort，再建立 PersistedSourceCaptureRef。进程重启或释放捕获后，临时句柄失效；已保存的正文仍可按历史解释读取。

workspaceRevision 只是工作区登记版本，不能证明外部文件未改。sourceDigest/配置/索引版本、HEAD 与清单校验共同决定来源适用性。缓存命中不能跳过敏感使用时的当前性核验；核验可以复用可靠失效机制，不能依赖墙钟时间推断文件没变。

## 6. Session 与维护占用

```ts
export type SessionOccupancy =
  | { kind: 'execution'; executionRef: ExecutionRef; generation: number }
  | { kind: 'maintenance'; operationRef: OperationRef; generation: number };
export type SessionRecord = {
  ref: SessionAggregateRef;
  revision: number;
  kernel: { adapterId: string; kernelSessionId: string };
  lifecycle: 'active' | 'archived';
  health: 'available' | 'recoverable' | 'unavailable';
  role: RoleConfigurationRef;
  workspaceId: string;
  lastExecutionRef: ExecutionRef | null;
  occupancy: SessionOccupancy | null;
  historyCursor: string | null;
  createdAt: string;
  archivedAt: string | null;
};
export type SessionWorkLink = {
  ref: SessionWorkLinkRef;
  revision: number;
  since: CommitCursor;
  until: CommitCursor | null;
};
```

availability 从 lifecycle、health 和 occupancy 派生；维护占用也属于 busy。数据库同一事务更新 Session 与唯一占用槽；释放需相同 owner/generation，旧 Run 的迟到结果不能释放继任者。创建操作可以先有稳定 planned SessionRef，但完成 Kernel 映射前没有可领取 SessionRecord。

kernel.adapterId 定位配置的Kernel存储实例，不只是厂商/适配类名称。Runtime保存它到kernelStoreKey与宿主真实数据库位置的映射；目标新工作使用稳定workspace存储，旧按Run分库保留原locator。同sessionId在不同库中不能被当成同一条历史，路径不由模型或SessionRef参数指定。

SessionWorkLink.since/until 绑定真实提交边界：需要当前提交 cursor 的字段由 WG 编译为 RecordStore 白名单 commitCursorBindings，在同一次事务写入并完整校验，不预猜 cursor、不事后补写。物理协议见 [RecordStore §4](../modules/core/record-store.md)。并行执行的资源 reservation 与此 Session 对话占用不同；同工作区可多个 writer，结构与新增共享 resources.ts 的边界见 [并行接口](../PARALLEL-COLLABORATION.md)。

上轮文档的 `currentClaim/lastRunRef` 是未实现草案字段，现由此联合替换；不存在需要伪造的“旧 Session 表迁移”。实际旧 RuntimeRecord 的 sessionId/runRef 仍需按真实记录核对后建立映射，不能直接假定一个 Run 就是一条可延续 Session。

## 7. 跨模块公开面与类型所有权

| 提供方 | 公开 Port 家族 | 谁消费 | 实现不得省略 |
| --- | --- | --- | --- |
| Workflow | WorkflowPort | Host | 输入归一、策略顺序、何时调用模型、输出意图及既有授权传递 |
| WorkGraph | ArchitecturePort / TaskPort / RunStatePort / SessionDirectoryPort / MailboxPort / EvidencePort / MaterialPort / RoleMemoryPort | Workflow、AgentRuntime、Host | 领域准入、完整事务条件、结构更新、来源和水位 |
| AgentRuntime | RuntimeExecutionPort | Workflow、Host | Kernel 能力矩阵、稳定执行映射、真实控制观察与恢复 |
| WorkspaceTools | WorkspaceToolsPort | WorkGraph、AgentRuntime、Workflow/Host | 读取、capture、分页、比较、verify、释放与覆盖 |
| RecordStore | RecordTransactionPort / RawArtifactStorePort / RuntimeRecordStorePort / IndexStorePort | WorkGraph；AgentRuntime仅所需技术存储 | 物理CAS/唯一性/编码/事务、原正文引用、异步索引水位 |

Port 名不是模型 tool 名；tool adapter 将真实宿主上下文绑定后调用窄 Port。禁止把整个 RecordStore 或一个“调用任意模块任意方法”入口暴露给 Agent。

## 8. 骨架实现时的类型验收

1. 每个导出方法都能找到输入、结果、错误和状态副作用定义；既有类型有实际文件来源，新类型有计划文件归属。
2. 除解码边界外，不用 any/unknown/object 占位关键数据；边界未知值经 schema 解析后进入领域。
3. type-only import 同样遵守模块依赖；序列化结构位于共享契约，不从底层反向导入上层实现。
4. Session 同时覆盖 Run、QueryRun 和维护占用；QueryRun 不假造 Task 或工作主体。
5. SourceCaptureRef 与持久 Artifact 引用分开；普通读取无模型前置。
6. 迁移适配包含旧结果/错误映射；新接口和真实消费者一同接入后，才删除旧签名。
