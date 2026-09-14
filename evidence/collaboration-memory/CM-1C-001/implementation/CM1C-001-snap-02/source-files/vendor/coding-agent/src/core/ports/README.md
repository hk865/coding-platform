# Core Ports

Ports 是 Core 依赖外部能力的最窄接口。接口与跨边界值由 Core 拥有，具体实现位于外层：

| Port                                       | 典型实现                                   |
| ------------------------------------------ | ------------------------------------------ |
| `ModelClientPort`                          | OpenAI / DeepSeek Adapter                  |
| `ToolExecutorPort`                         | `ToolDispatcher`                           |
| `ToolBatchPolicy`                          | Serial 或 Registry 策略                    |
| `EventSinkPort`                            | Session、Checkpoint、日志、trace、Web 投影 |
| `SessionStorePort` / `CheckpointStorePort` | InMemory / SQLite                          |
| `SkillProviderPort`                        | `SkillRegistry`                            |
| `MemoryProviderPort`                       | `EmptyMemoryProvider`                      |

Port 文件不得导入 Adapter 或厂商 SDK；新增实现应复用对应 contract
tests，而不是扩张 Runtime 对实现细节的认识。
