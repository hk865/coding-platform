# M1 Core 契约索引

```yaml
status: current
updated: 2026-08-20
scope: 与当前代码同步的完整 M1 类型、schema、Port、验证器和确定性测试替身
```

## 契约所有权

| 契约                                      | 唯一位置                                             | 当前成熟度          |
| ----------------------------------------- | ---------------------------------------------------- | ------------------- |
| Run、Turn、RunState、Outcome、Pause       | `src/core/runtime/state/run-state.ts`                | CONTRACT            |
| AgentEvent、EventMeta、转换校验           | `src/core/runtime/events/agent-events.ts`            | CONTRACT            |
| ModelRequest、ModelEvent、ModelClientPort | `src/core/ports/model_client/model-client-port.ts`   | CONTRACT            |
| ToolCall、ToolResult、ToolExecutorPort    | `src/core/ports/tool_executor/tool-executor-port.ts` | CONTRACT            |
| EventSinkPort、投递等级                   | `src/core/ports/event_sink/event-sink-port.ts`       | CONTRACT            |
| JSON/message/Skill/Memory 值              | `src/core/context/types/context-types.ts`            | CONTRACT            |
| ContextBuilderInput/Port                  | `src/core/context/builder/context-builder.ts`        | CONTRACT            |
| Hook invocation/decision/Port             | `src/core/hooks/protocol/hook-protocol.ts`           | CONTRACT            |
| FakeModel/FakeTool/EventCollector         | `tests/fakes/`                                       | TEST INFRASTRUCTURE |

外层 Provider、Tool、Storage、Observability 和 App 不得复制这些类型。Adapter 只向内实现 Port。

## 运行状态与事件

`createInitialRunState` 从不可变 Run 建立 `created` 快照。`validateRunStateInvariants`
校验字段组合，`deriveRunPhase` 从结构派生下一类合法动作。阶段不持久化。

`validateTransition(state,event)` 只校验事实是否可以应用，不修改 State。完整 `State + Event → State`
Reducer 属于 M2。终止状态固定为 completed、cancelled、limit_exceeded、failed；终止后不接受事件。

## 模型与工具边界

`ModelClientPort.stream(request,{signal})` 返回
`AsyncIterable<ModelEvent>`。事件 sequence 从 1 连续，必须且只能有一个 completed/truncated/error/cancelled 终止事件。
`validateModelEventSequence` 覆盖 usage 倒退、半截工具 JSON、requestId 混流、跳号和终止后事件。

`ToolExecutorPort.execute(call,{signal})` 返回 success/error/cancelled
ToolResult。普通业务失败不 reject
Promise。每个结果携带 effects，callId 必须与输入一致。真实执行链由 M3 Dispatcher 实现。

## Context 边界

`buildModelRequest` 只组装传入值：基础规则、附加指令、Skill、参考、Memory、transcript 和 tool
spec。它不访问 Provider、Storage、Tool、文件系统或网络。

组内使用 priority desc/id asc，tools 使用 name
asc，transcript 保持原顺序。tokenBudget 的选择和裁剪属于 M2 SelectionPolicy。

## Hook 边界

M1 固定三个控制点：

| point          | 输入                 | 允许结果                         | 不可变事实              |
| -------------- | -------------------- | -------------------------------- | ----------------------- |
| `before_model` | State + ModelRequest | continue/modify/block/pause/fail | requestId、runId        |
| `before_tool`  | State + ToolCall     | continue/modify/block/pause/fail | callId                  |
| `after_tool`   | State + ToolResult   | continue/modify/pause/fail       | callId、status、effects |

`after_tool.modify` 只返回新的 `output` 展示值，因此在类型层面不能改写真实副作用。
`validateHookDecision` 重新执行 strict schema，并拒绝跨 point
decision 和身份改写。Hook 注册、排序、超时与异常归一化由 M2 registry/executor 实现。

Hook 不是权限、审批、Limit 或 Sandbox。任何修改后的 ToolCall 仍须进入 M3
Dispatcher 的完整强制安全链。

## EventSink 边界

`EventSinkPort.publish(event,{signal})` 是只读观察接口，不返回 block/modify/pause：

- `best_effort` 失败由 M2 记录，但不改变 Run 业务结果；
- `required` 失败由 M2 映射为 `RunFailure(category=required_sink)`；
- 同一 sink 必须按 AgentEvent.sequence 串行投递；
- required sink 失败后的终止事件不递归投递给已失败 sink，但应尝试其余 sink；
- Event 可能含源码、命令输出和模型文本，具体 Adapter 必须按敏感数据处理。

## 确定性测试替身

`FakeModelClient` 和 `FakeToolExecutor`
按调用顺序或 callId 消费显式动作脚本，支持 emit/return、throw、gate 等待和 AbortSignal。它们记录输入深拷贝、脚本位置、取消观察、并发和副作用计数，并允许注入非法值来验证 Runtime 防御。

`EventCollector`
深拷贝每次投递，区分 attempts 与成功 events，可在指定 sequence 失败或等待 gate，并提供事件类型和终止事件计数。gate 由测试显式释放，不使用真实 sleep。

## Schema 与导出规则

- schemaVersion 固定为 1；
- 所有不可信边界使用 Zod strict schema；
- 未知字段、未知 discriminant、非有限 number 和非法时间被拒绝；
- JSON round-trip 后应深度相等；
- AbortSignal、Date、Error、Map、Set、callback 和句柄不进入序列化值；
- `src/public-api.ts` 只导出稳定生产契约；测试替身从 `tests/fakes/test-fakes.ts` 导入；
- `ENGINEERING_STATUS.milestone=M1` 且 `agentCapabilities=false`，不把契约误认为 Agent 能力。
