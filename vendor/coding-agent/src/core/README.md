# Core

`core`
是厂商无关的 Agent 内核，拥有可序列化领域值、状态转换和外部能力 Port。它只依赖自身模块、Zod 与标准库，不依赖
`app`、`model`、`tools`、`storage`、`policy`、`sandbox` 或其他 Adapter。

## 子系统

- `context/`：上下文值、预算选择和确定性模型请求组装。
- `hooks/`：受控的模型前、工具前、工具后扩展协议。
- `ports/`：模型、工具、事件、Session、Checkpoint、Skill、Memory 的窄接口。
- `runtime/`：RunState、AgentEvent、Reducer、主循环、限制、取消、提交与恢复。

核心数据方向为：

```text
外部输入 → ContextBuilder → ModelClientPort → ModelEvent
    → AgentEvent → required sinks → Reducer → RunState
                         │
                  ToolExecutorPort
```

外层通过 `src/public-api.ts` 使用稳定导出。新增 Adapter 不应要求 Core 引入厂商类型或 IO。
