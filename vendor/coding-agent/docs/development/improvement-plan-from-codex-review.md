# Coding Agent 修改需求文档（基于两段 Codex 对话评审）

> 来源：两段 ChatGPT/Codex 对话（codex://threads/01a04760-10d3-7442-a2a4-7ba861208a05 与 codex://threads/01a0474f-8411-7691-b55e-115ca8f79336），主题分别是「Pi
> / DSH /
> coding-agent 架构对比与性能评估」和「Session 状态保留、取消/崩溃边界、DSH 借鉴」。本文档汇总两段对话最终达成的修改结论，并已对照
> **M6 基线源码**（分支 `codex/m6-completion`，标签 `m6-baseline`，提交
> `beaeaff7b1d830498fd98308a549b154383165c0`）逐条核对现状。核对时点工作树干净；此后 1-1/1-2/2-1 已实现（见 ADR-0005 与
> `tests/review/`），当前工作树含未提交改动与用户文档。对话中引用的行号与当前代码可能因近期改动略有偏移，均已复核。
>
> 维护建议：每完成一项，在本文件对应条目勾选并记录提交号。

---

## 0. 结论摘要

对话的共同结论是：**不用重做 Session 平台，也不用照搬 DSH「一切皆插件」**；最高优先级是修正「正常取消丢结果」和「异常中断语义不清」这两个状态语义问题，其次是批量持久化流式输出、补 Artifact
Store、edit 确定性对账、沙箱/审批加固；最后再推进 Projection、Inbox、Profile、多 Agent 等演进项。

| 优先级 | 领域         | 条目 | 一句话                                                                         |
| ------ | ------------ | ---- | ------------------------------------------------------------------------------ |
| P0     | 取消语义     | 1-1  | 正常取消先落盘 `tool.cancelled`（含 ToolResult/effects），再写 `run.cancelled` |
| P0     | 工具生命周期 | 1-2  | 固定 `pending→started→completed→failed→cancelled→outcome_unknown` 矩阵         |
| P1     | 崩溃恢复     | 2-1  | 先写结构化 `tool.outcome_unknown`，再 `run.failed`；生成模型可见合成结果       |
| P1     | 工具对账     | 2-2  | `edit` 基于 revision 确定性对账（未执行/已执行/冲突）                          |
| P1     | 工具契约     | 2-3  | ToolDefinition 声明 `recovery` 能力；shell 默认 `unknown_on_interrupt`         |
| P1     | 审计         | 2-4  | 流式输出分段落盘 `model.output_segment`（批量 + flush barrier，修订 ADR-0004） |
| P1     | 审计         | 2-5  | 实现 Artifact Store（CAS、配额、GC），启用 `artifactRefs`                      |
| P2     | 架构         | 3-1  | Session Context Projection（Runtime/Model Context/Web Timeline/Audit）         |
| P2     | 架构         | 3-2  | Durable Inbox + Immutable Profile                                              |
| P2     | 扩展面       | 3-3  | 增加 6 个 Port，核心稳定、外层可扩展                                           |
| P2     | 多 Agent     | 3-4  | 共享已验证基线 + 增量；每 Agent 独立 worktree/overlay                          |
| P2     | 性能         | 4    | 事务批量化、Reducer/Context 选择复杂度、Snapshot 增量、写竞争                  |
| P2     | 安全         | 5    | 资源配额、seccomp、敏感文件清单、审批粒度、权限模式拆分等                      |

---

## 1. P0：先修「正常取消」与「工具生命周期」语义（对话最高优先级）

> ✅ **1-1、1-2、2-1 已完成**（2026-08-28，对应提交见 `git log` 中「tool
> lifecycle」相关提交；实现证据：
> `tests/integration/runtime-tool-states.test.ts`、`docs/adr/0005-tool-lifecycle-states.md`）。
> `result_unknown` 已更名为 `outcome_unknown`；`tool.cancelled` 先于 `run.cancelled`
> 落盘；恢复器先追加 `tool.outcome_unknown`（含合成结果）再 `run.failed`。

### 1-1 正常取消必须保存真实 cancelled ToolResult

**对话结论（两段对话一致，且是「最值得立即做的修改」）：**

当前问题链（M6 基线 `beaeaff`）：

```
Tool 返回 cancelled ToolResult + effects
  → Runtime 看到父级 AbortSignal 已中止
  → 直接提交 run.cancelled
  → cancelled ToolResult 被丢弃
  → Reducer 把运行中的 Tool 标为 result_unknown
```

应该改成（**本轮已实现**）：

```
Tool 返回 cancelled ToolResult
  → 先持久化 tool.cancelled（payload 含 callId + result{status:"cancelled", reason, output, effects}）
  → Reducer 将 Tool 状态标为 cancelled
  → 再持久化 run.cancelled
```

这样「正常取消」与「Runtime 突然消失」可明确区分：

- 正常取消：存在真实 `tool.cancelled + ToolResult`；
- Runtime 崩溃/被强杀：只有 `tool.started`，才是 `outcome_unknown`（合成结果 + 禁止自动重试）。

**源码现状（已核对，当前工作树）：**

- `src/core/runtime/loop/runtime-runner.ts:695-701`：`result.status === "cancelled"` 且
  `context.cancellation.signal.aborted` 时直接 `#commit("run.cancelled")`，未落盘 ToolResult。
- `src/core/runtime/reducer/run-state-reducer.ts:73`：`run.cancelled` 把 `running` 的 call 标为
  `result_unknown`（`src/core/runtime/reducer/run-state-reducer.ts:72` 把 `pending` 标为
  `abandoned`）。
- 事件类型里**没有 `tool.cancelled`**：`src/core/runtime/events/agent-events.ts` 只有
  `run.cancelled`（第 115 行附近），ToolResult 状态类型只有 `completed/failed/cancelled` 的
  `status: z.literal("cancelled")`（`src/core/runtime/state/run-state.ts:56`），但**事件流不消费它**。
- 附带后果（对话中明确指出的真实缺口）：shell 在取消时其实已经杀了进程组、收集了 stdout/stderr、对比了 changedPaths/workspaceRevision（`src/sandbox/process/process-sandbox.ts:230`
  附近），这些成果全部没有进 Session。Pi 在正常取消时反而会把 aborted/error ToolResult 写入 JSONL。

**需要修改的文件（本轮已全部完成）：**

- `src/core/runtime/events/agent-events.ts`：新增 `tool.cancelled` 事件类型与 payload schema。
- `src/core/runtime/state/run-state.ts`：Tool call status 增加 `cancelled` 与 `outcome_unknown`，
  `result_unknown` 移除。
- `src/core/runtime/reducer/run-state-reducer.ts`：`tool.cancelled` / `tool.outcome_unknown`
  的归约；取消时 running→cancelled；终结兜底 pending→abandoned、running→outcome_unknown。
- `src/core/runtime/loop/runtime-runner.ts`：取消路径改为「先提交 tool.cancelled，再提交 run.cancelled」；强制中断先记录
  `tool.outcome_unknown`。
- Web Timeline 事件投影（`src/app/web/web-event-projection.ts`）。
- 测试：`tests/integration/runtime-tool-states.test.ts`（8 用例）、`tests/unit/web-event-projection.test.ts`、
  `tests/integration/m4-storage.test.ts`、`tests/e2e/m4-cross-process.test.ts`。

### 1-2 建立明确的 Tool 生命周期矩阵

**对话结论：** 固定状态机，语义严格区分：

```
pending → started → completed → failed → cancelled → outcome_unknown
```

- `pending`：模型已提出，但从未进入执行；
- `started`：执行前记录已持久化（当前代码用 `running`）；
- `completed`：取得成功结果并持久化；
- `failed`：取得确定失败结果并持久化；
- `cancelled`：协作式停止，取得取消结果并持久化（**新增**）；
- `outcome_unknown`：Runtime 消失，无法取得结果（**新增**，当前用 `result_unknown` 承担此义）。

现有 `abandoned` 只保留给「Run 结束时尚未启动的并行调用」，不得与 `cancelled`/`outcome_unknown`
混用。

**源码现状（已核对，本轮已实现）：** `src/core/runtime/state/run-state.ts`：
`status: z.enum(["pending", "running", "completed", "failed", "cancelled", "outcome_unknown", "abandoned"])`
——`cancelled` 与 `outcome_unknown` 已加入，`result_unknown` 已移除；`running`
作为 started 的实现名保留，语义见 `docs/adr/0005-tool-lifecycle-states.md`。

---

## 2. P1：恢复、对账与审计

### 2-1 崩溃修复先写结构化 Tool 事件（借鉴 DSH 的 TOOL_NOT_STARTED / TOOL_OUTCOME_UNKNOWN）

**对话结论：** 当前 Recovery 遇到运行中 Tool 直接
`run.failed(side_effect_result_unknown)`，应该先追加结构化事件再终止：

```
tool.outcome_unknown → run.failed / turn.interrupted
```

事件至少包含：

```ts
{
  callId, toolName, effectClass,
  reason: "process_interrupted",
  retryPolicy: "never_automatic",
  recordedCallEventId,
}
```

同时生成**模型可见的合成 ToolResult**（下一轮模型看到，而不是只看到 run 失败）：

```
工具已经开始执行，但没有持久化结果。
只读或幂等操作可以在确认后重试；可能产生副作用的操作不得自动重试。
```

借鉴 DSH 但**不照搬**其整套 Session 平台（DSH 用 `TOOL_NOT_STARTED` /
`TOOL_OUTCOME_UNKNOWN`，见 deepseek-harness `packages/core/session/src/repair.ts`）。

**源码现状（已核对，本轮已实现）：**
`src/core/runtime/recovery/recovery-coordinator.ts`：恢复时对每个 running 调用先追加
`tool.outcome_unknown`（含 `callId/toolName/effectClass/reason/retryPolicy/recordedCallEventId`
与合成结果），再追加 `run.failed(side_effect_result_unknown)`；Runner 侧强制中断同样记录
`tool.outcome_unknown(cancelled_while_running)`（并行组**有界 drain**
等待所有工具停止，只把确实无结果的调用记 unknown）。配套保障：`tool.started`
落盘失败不启动工具副作用；`recordedCallEventId` 仅成功后记录；`tool.cancelled`
的部分写入 revision 纳入 checkpoint。合成结果写入 Session 事实（transcript）并从恢复状态可投影为模型输入；
**边界**：`side_effect_result_unknown`
后原 Run 已终态，当前生产路径不再调用模型，合成结果供审计视图与未来 Context Projection/下一 Turn
handoff 消费（见 ADR-0005 与测试 `runtime-tool-states.test.ts` 的 Context Projection 用例）。

### 2-2 edit 确定性对账（大幅缩小「结果未知」窗口）

**对话结论：** `edit` 已具备对账所需的全部信息（`path / oldText / newText / expectedRevision`），在
`tool.started` 前还可预先计算 `expectedNewRevision`。恢复时：

```
当前 revision == expectedRevision      → 修改未生效，可安全重新执行
当前 revision == expectedNewRevision   → 修改已生效，补写 recovered tool.completed
其他 revision                           → 文件发生其他变化，记录 conflict
```

创建文件同理：

```
目标不存在            → 未执行
内容 hash == expected → 已执行
存在但 hash 不同      → conflict
```

**源码现状（已核对）：** `src/tools/builtin/edit/edit-tool.ts` 已有 `expectedRevision`（第 25 行）、
`newRevision`（第 96 行）、有界 diff（`boundedDiff`，上限 16_384 字节，第 50-52 行）；但
`RecoveryCoordinator` 不做对账，一律返回 `side_effect_result_unknown`。

### 2-3 Shell 声明可恢复能力（不能靠命令字符串猜幂等）

**对话结论：** 任意 shell 命令无法通用 exactly-once。ToolDefinition 增加：

```ts
recovery:
  | { mode: "read_only" }
  | { mode: "idempotent"; idempotencyKey: string }
  | { mode: "reconcilable"; reconciler: ... }
  | { mode: "unknown_on_interrupt" }
```

默认 shell 是 `unknown_on_interrupt`；只有明确声明只读/幂等的命令才允许自动重试。
**不要让模型根据命令字符串自行猜测幂等性。**

配套建议（对话 1）：把 shell 拆成两种运行模式，避免「看起来只读」被当只读：

- `shell_readonly`：workspace 只读挂载，不需要执行前强屏障；
- `shell_write`：workspace 可写，保留审批与提交屏障。

**源码现状（已核对）：** 工具只有 `effectClass: read_only | workspace_write | process`
（`src/tools/schemas/tool-schemas.ts:15`），没有 `recovery` 声明；shell 为 `process` 类且始终走完整
`tool.started` 屏障（`runtime-runner.ts` 对所有工具统一提交）。`RegistryToolBatchPolicy`
已支持并行执行独立只读工具（`src/tools/registry/tool-registry.ts:154` 附近），但屏障粒度未分层。

### 2-4 流式输出分段落盘（修订 ADR-0004 的「只持久化完整消息」决策）

**对话结论（第二轮修正，推翻第一轮「chunk 不必记录」的结论）：**

- 现状：chunk 只是 Web 层内存事件（`task.events` 上限 10,000 条，`deltaChunks`
  纯内存），只有模型完整结束后才提交
  `assistant.message_completed`。模型长输出/reasoning 中途崩溃会整段丢失。
- 建议新增两类持久事件：

```text
model.output_segment
  requestId, segmentIndex, channel: text | reasoning,
  content, byteOffset, occurredAt

assistant.message_completed
  requestId, message, segmentCount, contentDigest
```

- 实现要点：内存按 100–250ms 或 32–64KiB 聚合为 segment；segment 批量追加到 Session；在
  `assistant.message_completed`、`tool.started`、Run 终止前设**强制 flush
  barrier**；崩溃最多丢失未 flush 的小缓冲；可选逐 segment 同步模式（零丢失，代价是延迟/写放大）；reasoning 与正文分开保留策略（敏感推理内容默认不无限期保存）。
- 同时**修订 ADR-0004** 中「Session 只在现有语义事件边界持久化完整 assistant 消息」的决策记录。

**源码现状（已核对）：** `src/app/web/web-run-manager.ts:368`（10,000 上限）、
`src/app/web/web-run-manager.ts:379-384`（deltaChunks 纯内存）；
`docs/adr/0004-streaming-and-workspace-consistency.md:22`（「Session 只在现有语义事件边界持久化完整 assistant 消息」）；运行时只有
`assistant.message_completed` 进 required Session（`src/core/runtime/loop/runtime-runner.ts:520`
附近）。

### 2-5 实现 Artifact Store 并启用 artifactRefs

**对话结论：** `artifactRefs` 目前只是 schema 预留、所有工具返回 `[]`；「启用」= 补齐存储层：

- SHA-256 内容寻址，相同内容只存一份；小输出（<64KiB）直接进 Session；
- 大输出（完整 patch、被截断的 stdout/stderr、测试报告、诊断产物）按块存储/压缩，Session 只保存
  `{kind, digest, size, storageKey}` 引用与摘要；
- 单 Artifact / 单 Run / 单 Session 配额；引用计数或 mark-and-sweep GC；
- 超大 diff 用 manifest 分块，不生成单个巨型 JSON；
- 默认不复制源码文件本身（已有 path + revision 引用时只存元数据）；
- 开销只与「产出 Artifact 的大小」有关，与代码库总大小无关。

**源码现状（已核对）：** `src/core/ports/tool_executor/tool-executor-port.ts:41`（schema 有
`artifactRefs`）；`check-tool.ts:32`、`read-tool.ts:38`、`shell-tool.ts:38/141`、`edit-tool.ts:47/114`、
`runtime-runner.ts:610` 全部返回 `[]`；不存在 Artifact Store。

---

## 3. P2：架构演进（对话 1 与 evolution-overview 方向一致，优先级低于 P0/P1）

### 3-1 Session Context Projection

让 Session Log 投影出：Runtime State、Model Context、Web Timeline、Audit
View。恢复或续跑时使用经过验证的 Session 历史，而不是各模块分别拼装；同时支持 DSH 式「合成 ToolResult」，让下一轮模型明确看到：未开始 / 正常取消 / 确定失败 / 结果未知。

### 3-2 Durable Inbox 与 Immutable Profile

- Durable Inbox：运行中的新输入、steering、follow-up 不丢失（对应 DSH
  `packages/core/agent/src/inbox.ts`）；
- Immutable Profile：记录本 Session 使用的模型、工具、策略、Skill 和扩展版本。

两者已在 `docs/architecture/evolution-overview.md` 提出，优先级应低于工具取消语义修复。

### 3-3 核心稳定、外层可扩展（Port 化）

对话明确同意：`Act/Observe → Model → Tool → Result`
这类内核不必重构；真正变化大的是上下文工程与 Agent 工程。为会变化的地方提供清晰 Port：

```text
ContextProjectionPort     不同模型本轮看到什么
CompactionStrategyPort    如何压缩长 Session
ToolPresentationPort      针对模型调整工具 schema / 结果表达 / 错误反馈
InstructionComposerPort   组合 system prompt、项目规则、Skill、运行时约束
MemoryProviderPort        注入长期记忆与检索内容
AgentDriverPort           ReAct、计划执行、子 Agent 等不同策略
```

约束：扩展只能产生输入、建议或事件，**不能直接修改 RunState**。

### 3-4 多 Agent：共享已验证基线 + 增量（对话 1 修正后的表述）

「共享不可变历史」的正确表述是：**共享已经确认仍有效的状态基线/快照前缀；变化部分写增量**。

- 全局图只保存 `parentSessionId / baseRevision / childSessionId` 与合并关系；
- 每个 Agent 独立 Session、Inbox、Checkpoint、增量日志；
- 子 Agent 继承父 Agent 在确认边界上的 Context Projection 与文件版本映射；
- 未变化文件按引用复用；变化文件用 copy-on-write 或独立 worktree/overlay；
- 合并只比较增量集合，不重新扫描全部轨迹；
- 安全结构：每个写代码 Agent 独立 worktree/overlay + 集成 Agent 做冲突检查/测试/合并；容器方案可先延期，先补「破坏性操作防护」。

---

## 4. P2：性能热点（对话 1 识别，均为「轨迹长度/工具次数/并发数放大」型成本）

| #   | 热点                    | 现状（已核对）                                                                                                                                                                                                                           | 方向                                                                                                                      |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 4-1 | 每事件一次强持久化事务  | `SessionEventSink.publish()` 每事件一次 `append()`；SQLite `BEGIN IMMEDIATE` + WAL + `synchronous=FULL`（`src/storage/adapters/sqlite/sqlite-stores.ts:422-425,596`）；简单 `model→tool→model→final` 约 8–11 次事务                      | 按 2-4 的分段批量 + flush barrier 降提交次数；评估 `synchronous=NORMAL`（WAL 下仍较安全）作为可选模式                     |
| 4-2 | Reducer 近二次增长      | `reduceRunState()` 每次 `runStateSchema.parse` 全量解析、`applyEvent` 复制 transcript 数组、再 `parse` 校验（`src/core/runtime/reducer/run-state-reducer.ts:239` 起；`transcript` 展开见 126-127/183-187 行），最坏 O(事件数 × 轨迹长度) | 增量归约：只应用新草稿（ADR-0004 已有同进程 revision 缓存思路，可扩展）；或对 transcript 做结构化共享/惰性复制            |
| 4-3 | Context 选择重复序列化  | `estimateTokens` 对完整 input `JSON.stringify`（`src/core/context/selection_policy/context-selection-policy.ts:48-49`）；超预算时每删一个候选重新估算（174-207 行循环）                                                                  | 增量 token 估算（按候选预计算、删减只做差量），或缓存序列化结果                                                           |
| 4-4 | Workspace snapshot 成本 | Git 仓库跑 `git status`（`#gitStatus()`，`src/sandbox/workspace/workspace-sandbox.ts:527`）；非 Git 递归遍历 metadata；创建/编辑/审批/一致性检查可能重算                                                                                 | 增量快照、缓存 + 失效标记（`docs/architecture/m4-secure-snapshot-incremental-consistency.md` 已有基础）；避免整树重复扫描 |
| 4-5 | 多 Agent 写竞争         | 同一 SQLite 单写通道 + `busy_timeout=1000`，多 Agent 时事务串行排队、FULL 同步次数成倍、可能直接 busy                                                                                                                                    | 批量化、按 Agent 分库或写队列；最终走向 3-4 的「每 Agent 独立存储 + 增量合并」                                            |

---

## 5. P2：沙箱与权限审批加固（对话 1「Sandbox 强度评估」）

**已确认较强（无需改）：** WorkspaceSandbox 的路径安全（相对路径、拒绝
`..`/绝对路径/反斜杠、逐级 fd +
`O_NOFOLLOW`、revision 校验、临时文件+原子 rename）；ProcessSandbox 的 bubblewrap 隔离（namespace、只读系统目录、受信 fd 挂载 workspace、环境清空、loopback-only、敏感目录空挂载、进程组击杀、fail
closed）。

**明确缺口（需要改）：**

| #   | 缺口                            | 现状（已核对）                                                                                                                                             | 方向                                                                                      |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 5-1 | shell 批准后整个 workspace 可写 | 无 workspace 内部保护（除受保护路径）                                                                                                                      | 破坏性命令分级（删除/覆盖/移动）；必要时引入 5-6 的权限模式                               |
| 5-2 | 无资源配额                      | `process-sandbox.ts` 无 cgroup/RLIMIT_AS/RLIMIT_NPROC/磁盘配额，仅 timeout + 输出上限                                                                      | cgroup v2 或 rlimit：CPU/内存/进程数/磁盘；防止 fork bomb、内存耗尽、大量临时文件影响宿主 |
| 5-3 | 无 seccomp                      | 仅 namespace + 挂载隔离，共享宿主内核                                                                                                                      | seccomp 白名单（按工具类别）；明确文档说明「不等于容器/microVM」                          |
| 5-4 | 敏感文件覆盖清单有限            | 只隐藏 `.env`/credentials 等                                                                                                                               | 扩展到 `.npmrc`、`.pypirc`、PEM、自定义 token 文件（可配置清单）                          |
| 5-5 | `.git` 可读                     | 只读挂载但内容可见，`.git/config` 的 remote URL 可能含凭据                                                                                                 | 敏感项（config/credentials）空挂载或脱敏                                                  |
| 5-6 | 审批粒度偏粗                    | Web「本任务允许同名工具」= `allow_for_run` → `task.approvedTools.add(tool)`（`src/app/web/web-run-manager.ts:246-257`）；批准一次 shell 后不同命令自动放行 | shell 审批绑定「命令类别 + cwd + 沙箱模式 + 路径范围」，而非工具名                        |
| 5-7 | 缺目录 fsync                    | 编辑同步临时文件并 rename，未同步父目录（断电持久性不完整）                                                                                                | rename 后 fsync 父目录（仅在需要断电保证时）                                              |

**权限模型重构（对话 1 与 Codex 对齐）：** 把「沙箱范围」与「审批策略」拆成两个独立维度：

```
sandbox_mode = read_only | workspace_only | danger_full_access
approval_policy = on_request | never
```

- `danger_full_access + never` = 完全无拦截；`danger_full_access + on_request`
  = 可访问系统配置但保留确认；
- 绝对路径只允许出现在**管理员配置**的显式挂载中（`hostPath + mountPath + access`），模型工具调用时不得临时提交任意绝对路径；
- 当前 `permission-policy.ts:56`
  对所有绝对路径统一拒绝（`PathPolicyError("absolute")`），需要在权限模式重构时拆开：`workspace_only`
  模式下模型参数仍拒绝绝对路径，但显式授权的挂载点放行。

**破坏性操作防护（对话 1 建议先补，容器延期）：** 明确三类规则——直接拒绝（如 `git push --force`
无保护、删除非工作产物）、必须单次确认（`git push`、`kill` 进程、`rm -rf`
等）、普通工作区写入；不要把所有危险操作都塞进一个 shell 开关里。

---

## 6. 明确「不需要做」的事项（对话结论，防止过度设计）

1. 不必复制 DSH「一切皆插件」；不引入 Cordis/Profile/Bundle 体系。
2. 不必照搬 DSH 整套 Session 平台（Inbox/fork/projection 按 3-1/3-2 渐进引入即可）。
3. **不要让中断的 effectful
   Tool 自动重试**。现状核对：当前只有模型请求重试（`maxModelRetries`），工具失败不会自动重跑（`runtime-runner.ts:415/557`
   附近； `recovery-coordinator.ts:140`
   附近明确不重放）。后续若加重试，仅限：尚未进入执行器的调用、声明只读的工具、带 idempotency
   key 的外部调用、可 revision 对账的 edit；普通 shell/部署/删除/ 发消息不能凭 `retryable`
   布尔值重试。
4. 不要把「正常取消」也标成 `result_unknown`（1-1 修正后二者严格区分）。
5. 不要尝试用单个 SQLite 事务覆盖任意 shell 外部副作用（通用场景做不到）。
6. 文档核对结论：用户曾要求删除文档中「Session 复现/重建 Workspace」类表述——已全文检索
   `docs/`、README、模块文档，**不存在此类表述**（只有「恢复续跑前校验Workspace
   revision」的环境一致性检查，属正确内容，保留）；该说法仅出现在聊天回复中，无需改任何文件。

---

## 7. 建议实施顺序

对话给出的顺序（第一轮 P0/P1/P2 建议 + 第二轮修正后合并）：

1. `tool.cancelled` 先于 `run.cancelled` 落盘（1-1）；
2. 区分 `cancelled` 与 `outcome_unknown`（1-2）；
3. 增加取消与强制中断测试矩阵（1-1/1-2 配套，`runtime-resilience.test.ts`）；
4. 批量持久化的 `model.output_segment` + flush barrier（2-4）；
5. 内容寻址 Artifact Store、配额与 GC（2-5）；
6. `edit` revision 确定性对账（2-2）；
7. 结构化 `tool.outcome_unknown` 恢复事件 + 模型可见合成结果（2-1）；
8. 工具 `recovery` 声明与 shell 模式拆分（2-3）；
9. 沙箱/审批加固：资源配额 → seccomp → 敏感清单 → 审批粒度 → 权限模式拆分（第 5 节）；
10. 性能优化（第 4 节）与 Projection/Inbox/Profile/多 Agent（第 3 节），保持 Runtime 内核不膨胀。

第 1–3 项改动范围不大，却能立即修正当前最明显的状态语义问题，建议最先做。

---

## 附录：关键源码位置索引（当前工作树，2025-08 状态）

| 主题                                                    | 文件:行                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ✅ 取消先落盘 tool.cancelled 再 run.cancelled           | `src/core/runtime/loop/runtime-runner.ts`（`#executeTools` 结果结算循环）          |
| ✅ 终结兜底 pending→abandoned / running→outcome_unknown | `src/core/runtime/reducer/run-state-reducer.ts`（`abandonUnsettledTools`）         |
| ✅ Tool call 状态枚举（含 cancelled/outcome_unknown）   | `src/core/runtime/state/run-state.ts`（`toolExecutionStateSchema`）                |
| ✅ 恢复先 tool.outcome_unknown 再 run.failed            | `src/core/runtime/recovery/recovery-coordinator.ts`（running tool 分支）           |
| ✅ 合成 ToolResult / outcome_unknown payload            | `src/core/runtime/tool-outcome-unknown.ts`                                         |
| edit expectedRevision / newRevision / 16KiB diff        | `src/tools/builtin/edit/edit-tool.ts:25,50-52,96`                                  |
| artifactRefs schema（实现为空）                         | `src/core/ports/tool_executor/tool-executor-port.ts:41`；各工具 `artifactRefs: []` |
| chunk 仅内存（10,000 上限）                             | `src/app/web/web-run-manager.ts:368,379-384`                                       |
| ADR-0004「只持久化完整 assistant 消息」                 | `docs/adr/0004-streaming-and-workspace-consistency.md:22`                          |
| SQLite WAL/FULL/busy_timeout/BEGIN IMMEDIATE            | `src/storage/adapters/sqlite/sqlite-stores.ts:422-425,596`                         |
| Reducer 全量 parse + transcript 复制                    | `src/core/runtime/reducer/run-state-reducer.ts:239-260,126-127,183-187`            |
| Context 选择重复序列化                                  | `src/core/context/selection_policy/context-selection-policy.ts:48-49,174-207`      |
| Workspace snapshot（git status / 遍历）                 | `src/sandbox/workspace/workspace-sandbox.ts:459-465,527`                           |
| 绝对路径统一拒绝                                        | `src/policy/permissions/permission-policy.ts:56`                                   |
| 审批 allow_for_run（按工具名）                          | `src/app/web/web-run-manager.ts:246-257,320`                                       |
| 工具 effectClass 三分类                                 | `src/tools/schemas/tool-schemas.ts:15,63-64`                                       |
| 只读工具并行策略                                        | `src/tools/registry/tool-registry.ts:154` 附近                                     |
| 演进总览（Inbox/Profile/多 Agent 方向）                 | `docs/architecture/evolution-overview.md`                                          |

---

## 补充：第三轮独立复审 Runner 残余项修复（2026-08-28）

独立复审（`docs/development/m6-independent-quality-re-review-round-3-2026-08-28.md`）在第三轮修复后仍发现三个 Runner 阻塞项，本小节记录其修复（尚未提交）：

1. **`check` scenarioId 路径穿越**：`check` 曾有意接受外部场景目录并直接执行外部
   `acceptance/check.mjs`。已移除该例外：`list`/`validate`/`check` 统一使用 canonical direct-child
   containment，越界 id 输出 `runner_error` 且不执行任何外部脚本。Runner 自测改用「复制
   `runner.mjs` + `vendor/` 到临时场景根」模式（`tests/review/scenario-runner-security.test.ts`
   第 4–8 项、`scenario-runner-residual-security.test.ts`）。
2. **environment.yaml 无结构 schema**：原实现只做行级 key/value 与括号配对检查，`title: incomplete`
   也能通过。已改用真实 YAML parser（vendored
   js-yaml，`tests/scenarios/vendor/js-yaml.mjs`，重复 key 即结构错误），并按显式 schema 校验必需字段（scenario/title/runtime/tools/permissions/budget/evaluation，dependencies 可选）、字段类型、嵌套结构与未知字段。
3. **合法 JSON 但协议结构无效可假通过**：exit 0 输出 `{}`
   或数组曾被判 pass。已增加 acceptance 输出协议校验：`status` 只允许 `pass`/`fail`
   且 pass 必须显式声明；`failureClassification` 必须与 status 一致；`checks`（若存在）必须为
   `{ name, pass }`
   数组且与总 status 一致（pass 时不得存在未通过的阻塞检查项、fail 时必须存在未通过的阻塞检查项）；任何不可解析的输出不论退出码一律
   `runner_error`；协议违规一律 `runner_error`（带 `protocolError`）。

反向门禁保留为 `tests/review/scenario-runner-residual-security.test.ts`（6 项）与
`tests/review/scenario-runner-security.test.ts`（8 项），未降低断言。
