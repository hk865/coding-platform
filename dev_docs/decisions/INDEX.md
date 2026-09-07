# Agent Platform 决策索引

本目录记录已经接受、难以逆转且需要保留理由的架构决策。ADR 只保存决策及其原因；当前术语、接口和施工状态仍以顶层地图、Module、Interface 与当前 Ticket 为准。

| ADR                                                     | 状态     | 决策                                                                        | 读取条件                                                  |
| ------------------------------------------------------- | -------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| [0001](0001-separate-platform-from-execution-kernel.md) | accepted | Agent Platform 与 Execution Kernel 是两个产品边界                           | 调整产品归属、RuntimePort 或 `coding-agent` 职责时        |
| [0002](0002-module-dag-and-tracer-bullet-tickets.md)    | accepted | 架构、开发与运行时使用彼此分离的图；开发 Ticket 采用 tracer-bullet 纵向切片 | 设计 Module、拆 Ticket、声明 blocking edge 或运行时依赖时 |
