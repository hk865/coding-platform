# src/contracts/core：共享契约里的核心原语

## 负责什么，不负责什么

- 本文件夹是 `src/contracts` 的核心子层：身份/作用域、结果与拒绝、Session 记录、归档/消息、准备执行清单。
- 只放类型、纯函数和纯常量；不 import `src/core`、`src/app`、`src/business`、`src/composition`。
- 不做 I/O、不加时钟/随机数、不选业务策略、不写状态；状态迁移只经过 `src/core/work-graph/state/`。
- 结果原语是各 Core 端口共用的失败/成功词汇，别处不要再写一份。

## 文件

- `call-context.ts` — 受信 Host/工具适配器绑定的调用身份与范围：`CorePrincipal`、`MaterialReader`、`PlatformMaterialOrigin`、`CoreCallContext`；`query_run` 主体可带冻结的 `goalId`（只由 Runtime 从 manifest 设置）。
- `execution-history.ts` — `RunExecutionHistoryV1`：Run 在 Kernel Session 里的起止/已观察位置。
- `identity.ts` — 作用域、版本 pin、命令元数据，以及 `SessionRef`、`ModuleRef`、`WorkLinkTarget`、`RoleConfigurationRef` 等身份。
- `operations.ts` — `OperationRef`：跨 Store 与 Kernel 效果的操作身份。
- `prepared-execution.ts` — 准备执行清单：`PreparedTaskManifestV1`、`PreparedQueryManifestV1`、`UnknownCallReviewInputV1` 与 `renderUnknownCallReviewZh`。
- `rejections.ts` — 拒绝结果构造器：`rejected`、`rejectedWithCurrent`、`rejectedWithNonEmptyCurrent`、`okFalse`。
- `results.ts` — 结果词汇：`CoreError`、`CoreRejection`、`ReadResult`、`WriteResult`、`ReadStamp`、`Page`、`OperationReceipt`。
- `session-archive.ts` — 不可变归档请求 `SessionArchiveRequestV1` 与 `deriveArchiveStepCommitIdentityV1`。
- `session-message.ts` — `SessionMessageRef` 完整地址、通信意图、用户/决策消息与 `isUserMessageRecipient`。
- `session.ts` — Session 记录/占用/健康/来源：`SessionRecord`、`SessionProvenanceV1`、`SessionHealthConclusion`、`SESSION_HEALTH_CONCLUSIONS`。
- `source.ts` — 临时与持久化来源捕获引用：`SourceCaptureRef`、`PersistedSourceCaptureRef`。
- `task-claim.ts` — `TaskClaim`：不可变的任务领取结果。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `rejected` **正本** | `src/contracts/core/rejections.ts:5` | 生成不带 `current` 的领域拒绝 `{status,code,reason}`。 | Core 端口返回失败、且没有要回传的当前版本时。 |
| `rejectedWithCurrent` | `src/contracts/core/rejections.ts:13` | 生成拒绝；调用方传了 `current` 就保留（含空数组）。 | 调用方明确区分“传了空数组”和“没传”时。 |
| `rejectedWithNonEmptyCurrent` | `src/contracts/core/rejections.ts:22` | 生成拒绝；只在 `current` 非空时附带。 | 修订冲突等只回传实际观察到的非空版本集时。 |
| `okFalse` | `src/contracts/core/rejections.ts:33` | 生成 `{ok:false,code,reason}` 结果。 | 返回布尔式结果而不是 `ReadResult`/`WriteResult` 的读/查询端口。 |
| `CoreError` | `src/contracts/core/results.ts:16` | 关闭的端口失败词汇（拒绝形状见 `CoreRejection`）。 | 声明端口失败码；不要另造同义词或把损坏折叠成普通失败。 |
| `ReadResult` | `src/contracts/core/results.ts:25` | 区分 `ready`、`not_found`、带真实戳的 `not_ready` 与拒绝。 | 所有读取端口；失败读取不得变成空事实。 |
| `WriteResult` | `src/contracts/core/results.ts:32` | 提交结果必带真实 cursor 与 `replayed`。 | 所有写入端口；没写任何东西的分支不得报 `committed`。 |
| `ReadStamp` | `src/contracts/core/results.ts:39` | 读水位：platform/plan/source/session 四种戳。 | 声明读取的新鲜度要求。 |
| `Page` | `src/contracts/core/results.ts:44` | 带下一游标与 basis 的分页结果。 | 声明分页端口。 |
| `OperationReceipt` | `src/contracts/core/results.ts:45` | accepted/completed 的操作回执（含 replay 与 cursor）。 | 跨操作提交的结果形状。 |
| `SessionProvenanceV1` | `src/contracts/core/session.ts:22` | 区分 `new`、任务续接、秘书换手与只读副本。 | 跟随/排除后继 Session 时按 kind 判定；不要用一个 kind 代替另一个。 |
| `SessionOccupancy` | `src/contracts/core/session.ts:7` | Session 被 execution/maintenance 占用的形状与 generation。 | 声明占用形状；不在这里做占用变更。 |
| `SessionRecord` | `src/contracts/core/session.ts:29` | 持久化 Session 的完整记录形状。 | 编解码与只读投影的共享声明。 |
| `SESSION_HEALTH_CONCLUSIONS` | `src/contracts/core/session.ts:16` | 健康不可用原因的闭集。 | 校验/展示健康结论，不另写字面量。 |
| `TaskClaim` | `src/contracts/core/task-claim.ts:15` | 任务领取结果的唯一声明。 | 准备执行与入口契约引用 claim 时。 |
| `SourceCaptureRef` | `src/contracts/core/source.ts:9` | 指向 WorkspaceTools 临时捕获的引用；过期/重启后失效。 | 传递来源观测；不要把它当持久化事实。 |
| `PersistedSourceCaptureRef` | `src/contracts/core/source.ts:24` | 临时捕获与其持久化 Artifact 正文的配对。 | 捕获已落盘后读取；持久化不等于当前文件见证。 |
| `CorePrincipal` | `src/contracts/core/call-context.ts:12` | 受信绑定的人/工作 Run/Query Run 主体。 | 端口接收调用者身份时；它只记录身份，不授予能力。 |
| `CoreCallContext` | `src/contracts/core/call-context.ts:51` | 项目/工作区、主体、材料读者与取消信号。 | Core 端口统一的调用上下文。 |
| `RunExecutionHistoryV1` | `src/contracts/core/execution-history.ts:7` | Run 历史位置与已观察水位。 | 记录/读取 Run 执行历史；旧 Run 缺失表示未索引，不是未执行。 |
| `SessionArchiveRequestV1` | `src/contracts/core/session-archive.ts:21` | 不可变归档请求（任务去留、等待、执行、回执）。 | 发起/重放 Session 归档。 |
| `deriveArchiveStepCommitIdentityV1` | `src/contracts/core/session-archive.ts:52` | 由请求与步骤派生 identityKey、fingerprint、eventId。 | 归档各步骤提交；步骤必须属于该请求，否则抛错。 |
| `SessionMessageRef` | `src/contracts/core/session-message.ts:24` | 带项目/工作区范围的完整消息聚合引用。 | 寻址消息；`messageId` 单独不是地址，也不是授权。 |
| `isUserMessageRecipient` | `src/contracts/core/session-message.ts:99` | 结构判定收件人是否为工作区用户。 | 分派/展示消息；不要从 id 猜收件人。 |
| `renderUnknownCallReviewZh` | `src/contracts/core/prepared-execution.ts:112` | 把结构化审查输入渲染成中文章节，可重渲染比对。 | 准备审查/提案轮输入；WorkGraph 校验章节区间与摘要时复用。 |
| `PreparedTaskManifestV1` | `src/contracts/core/prepared-execution.ts:212` | 任务执行清单：claim、role、预算、上下文、提示词、唯一 input。 | 准备/校验任务 Run；清单内容必须重新对正式事实核对。 |
| `PreparedQueryManifestV1` | `src/contracts/core/prepared-execution.ts:284` | Query 执行清单与 `PreparedQueryExecution` 回执形状；`goal` 可空（仅 secretary callKind），`request` 必填（非 request 为 null）。 | 准备/校验 Query Run。 |

## 内部用

无：本层导出的函数和常量都供其他层直接调用；类型按上面的文件说明使用。

## 不要做

- 不要另写 `rejection` 或结果包装；用 `rejected`/`rejectedWith*` 与 `ReadResult`/`WriteResult`（**M1-29**）。
- `rejected` 另有旧副本：`src/business/workflow/workflow.ts:131`、`src/business/workflow/activity-backfill.ts:62`、`src/core/work-graph/tasks/context-input-service.ts:107`、`src/core/work-graph/views/context-extensions.ts:169` 的本地 `rejection`（`request-service.ts` 已改为引用正本），新代码一律用正本，旧副本由清理轮删除。
- 不要把读取失败折叠成空事实、普通阻塞项或成功的 drain（**FP-05, M1-12, M1-15, MH-06**）。
- 不要在本层 import 上层实现，或加入 I/O、时钟、状态机；状态迁移只经过 `src/core/work-graph/state/`。
- 不要把 `SessionRef` 当裸 id 或文件路径，也不要用 `messageId` 单独寻址消息。
- 不要混用 `SessionProvenanceV1` 的 kind；续接、handoff、只读副本各有规则（**FP-01**）。
- 不要信任 prepared manifest 里的声明而不重读当前正式事实与受信配置。
