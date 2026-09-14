# M5 App、Provider 与扩展边界

M5 已加入显式多 Provider App 边界：静态 `ProviderRegistry` 首批注册 `openai` 与
`deepseek`，调用方必须明确选择，不自动路由，也不在失败时切换厂商。

## Provider

- OpenAI Adapter 使用官方 SDK 的 Responses API、`stream: true`、`store: false`；
- DeepSeek Adapter 使用官方 OpenAI-compatible Chat Completions endpoint，支持流式文本、Tool
  Calls、usage、截断、取消和错误脱敏；
- DeepSeek 默认显式使用 `thinking=enabled`。Core 将厂商的 `reasoning_content` 映射为可选的assistant
  `reasoningContent` 和流式
  `reasoning_delta`；ToolCall 完成后的下一次请求会回传原 assistant 的推理字段，避免协议状态丢失；
- 两家 Adapter 都实现既有 `ModelClientPort`，Provider SDK 类型不会进入 Core；
- API key 只从当前选择 Provider 的秘密来源取得，不进入 argv、JSON 配置、Session 或 trace。

## ToolList

生产 Composition 明确注册并冻结 `read`、`edit`、`shell`。`read` 只读允许；`edit` 和 `shell`
仍经过 Permission 与 Approval；缺少 bubblewrap 时 `shell` fail closed。测试用 `external_echo`
证明外部 Tool 可只通过 Registry 接入，不修改 Runtime Loop。

Registry 发给模型的 JSON Schema 会归一到跨 Provider 的保守子集：顶层对象分支联合会合并成
`type: object`，字面量变成
`enum`，并移除厂商不普遍支持的字符串长度关键字。这只影响模型协议；工具执行前仍由原始 Zod
schema 严格校验，因此不会放宽实际权限或输入边界。

## Skill 与 Memory

`SkillProviderPort` 只接受显式 ID，固定加载 `resources/skills/<id>/skill.json + content.md`。
`MemoryProviderPort` 冻结 recall/write 形状，M5 默认 `EmptyMemoryProvider`，不建立隐藏长期状态。

## App

配置优先级为 CLI > `CODING_AGENT_*` > strict JSON > 默认值。`run` 命令装配 Workspace、SQLite
required Session sink、Provider、Skill、Empty Memory、安全 ToolDispatcher 和 RuntimeRunner。
`resume` 重新装配同一 Provider、ToolList、Skill/Memory 与 workspace 环境，再由 Session 事实和
`RecoveryCoordinator`
判定 terminal、paused、continue 或副作用结果未知；未知副作用返回人工处理退出码 13。
