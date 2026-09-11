# Context Types

`context-types.ts` 定义跨 Core 模块共享的纯数据边界：

- `JsonValue` / `JsonObject`：拒绝非有限数、函数和其他不可序列化值。
- `UserMessage` / `AssistantMessage`：模型无关的消息内容。
- `ContextFragment`：调用方提供的受来源标记片段。
- `SkillContext`：只读 instruction/reference。
- `MemoryItem`：可召回的长期记忆数据。

所有结构都有 strict Zod schema，可做 JSON round-trip。这里不负责加载、选择、执行或持久化；Provider
SDK 与存储字段不得进入这些类型。
