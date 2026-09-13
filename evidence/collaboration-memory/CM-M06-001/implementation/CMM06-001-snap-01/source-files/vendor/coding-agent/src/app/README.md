# App

`app`
是可执行入口与生产装配层。它可以依赖 Core 和所有外层 Adapter，负责把配置、秘密、进程资源和用户交互转换成一次完整运行；Core 不反向依赖本目录。

## 内部结构

- `cli/`：解析 `run` / `resume` 命令、终端审批、流式输出、信号与退出码。
- `web/`：仅回环地址的 HTTP/SSE UI、单活动任务管理和事件投影。
- `composition/`：配置合并、新会话装配、恢复装配和资源释放。
- `prompts/`：由 Composition 注入并写入运行配置快照的版本化系统提示。

`runCodingAgent()` 和 `resumeCodingAgent()`
是生产主入口。它们创建具体 Provider、工具安全链、SQLite、Skill/Memory 与
`RuntimeRunner`；业务状态转换仍只发生在 Core 的 Event/Reducer 中。
