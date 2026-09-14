# M1 契约数据流

```yaml
status: current
updated: 2026-08-24
scope: M1 契约与确定性测试替身允许的数据方向；实际 M2–M4 流程见 m2-m4-runtime-flow.md
```

## 当前值流

```text
Run + Turn
  → createInitialRunState
  → RunState(created)

AgentEvent candidate + RunState
  → strict AgentEvent schema
  → RunState invariant
  → identity / sequence / elapsed / phase 校验
  → TransitionValidationResult

ContextBuilderInput
  → stable instruction/reference ordering
  → transcript association validation
  → stable tool ordering
  → strict ModelRequest

ModelClientPort（契约）
  → ordered ModelEvent stream
  → sequence / terminal / usage / tool-arguments validation

ToolExecutorPort（契约）
  → ToolResult
  → strict schema + callId association

HookInvocation + HookDecision candidate
  → point-specific strict schema
  → point / requestId / runId / callId 校验
  → HookDecisionValidationResult

AgentEvent
  → EventSinkPort(best_effort|required)
  → readonly ordered delivery（投递器在 M2）
```

## 测试替身值流

```text
调用序号 / callId
  → Fake script actions
  → emit / return / throw / explicit gate
  → 深拷贝记录 + action position + abort/concurrency/effect counters

AgentEvent
  → EventCollector attempt snapshot
  → optional gate / scripted failure
  → successful event snapshot + query counters
```

相同输入和脚本得到相同记录。gate 由测试显式释放，不依赖真实 sleep、网络或工作区。

## M2–M4 已实现的控制流入口

```text
RunStarted Event
  → Reducer
  → ContextBuilder
  → before_model Hook executor
  → ModelClientPort
  → delta aggregation
  → AssistantMessageCompleted Event
  → before_tool Hook executor
  → ToolExecutorPort（如有调用）
  → after_tool Hook executor
  → ToolCompleted/ToolFailed Event
  → EventSink delivery
  → Reducer
  → 下一次模型请求或唯一终止 Event
```

上述控制流已经在 M2–M4 实现；本页保留 M1 契约视角。当前实际持久化、工具安全链和恢复流程见
[M2–M4 实际数据流](m2-m4-runtime-flow.md)。

## 禁止的数据方向

- Provider/Tool/App/EventSink/Hook 直接修改 RunState；
- EventSink 返回 block/modify/pause 等控制结果；
- Hook 替代 Permission、Approval、Limit 或 Sandbox；
- after_tool Hook 改写 callId、status 或 effects；
- Core 导入真实 Provider、Tool、Storage、Policy 或 Sandbox；
- ContextBuilder 读取文件、Store、SkillProvider 或 MemoryProvider；
- Model Adapter 决定 Run 的业务终止状态；
- ToolResult 绕过 callId 关联或用模型声明替代安全策略。
