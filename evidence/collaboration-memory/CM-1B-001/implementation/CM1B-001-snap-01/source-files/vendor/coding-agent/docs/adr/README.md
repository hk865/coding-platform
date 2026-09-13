# Architecture Decision Records

ADR 记录已经接受的工程选择、约束、替代方案和后果。决策变化时新增 ADR 并注明 supersedes，不静默重写旧记录。

| ADR                                                 | 决策主题                             |
| --------------------------------------------------- | ------------------------------------ |
| [0001](0001-engineering-baseline.md)                | TypeScript、Node、测试与工程基线     |
| [0002](0002-node-sqlite-session-storage.md)         | 使用 Node 内置 SQLite 持久化 Session |
| [0003](0003-multi-provider-baseline.md)             | 静态多 Provider 与显式选择           |
| [0004](0004-streaming-and-workspace-consistency.md) | 真流式交付与分层工作区一致性         |
| [0005](0005-tool-lifecycle-states.md)               | 工具生命周期、取消与中断语义         |

模块现状见 [Architecture](../architecture/README.md)，接口现状见
[Interfaces](../interfaces/README.md)。
