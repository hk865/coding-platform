# 源码模块阅读指南

```yaml
status: current
updated: 2026-08-26
scope: M1–M4 生产源码的职责化文件命名、模块职责与推荐阅读顺序
related_code: /home/han001/projects/agents/coding-agent/src/
```

## 命名约定

- 项目自有 TypeScript 模块不使用 `index.ts`；文件名必须表达主要职责。
- `*-port.ts` 表示 Core 与外层实现之间的抽象边界。
- `*-coordinator.ts` 表示编排多个依赖但不亲自实现底层能力。
- `*-sink.ts` 表示消费事件并把事件投递到日志、存储或 checkpoint。
- `*-policy.ts` 表示产生确定性决策，不执行被决策的副作用。
- 每个生产模块顶部都有“模块职责、设计边界、关键流程”中文注释。

## 推荐阅读顺序

1. 从 `src/public-api.ts` 了解对外公开的能力。
2. 阅读 `run-state.ts`、`agent-events.ts` 和 `run-state-reducer.ts`，理解状态机。
3. 阅读各个 `*-port.ts`，理解 Core 允许依赖的外部能力。
4. 阅读 `runtime-runner.ts` 和 `model-stream-consumer.ts`，理解主循环。
5. 阅读 `tool-dispatcher.ts`、权限/审批和两个 sandbox，理解工具安全链。
6. 阅读 Session、checkpoint、存储适配器和恢复协调器，理解 M4 持久化闭环。

## Core 模块

| 文件                                                            | 主要职责                            |
| --------------------------------------------------------------- | ----------------------------------- |
| `src/core/context/types/context-types.ts`                       | JSON、上下文、技能和记忆共享值类型  |
| `src/core/context/builder/context-builder.ts`                   | 确定性组装 ModelRequest             |
| `src/core/context/selection_policy/context-selection-policy.ts` | token 预算估算与上下文裁剪          |
| `src/core/hooks/protocol/hook-protocol.ts`                      | Hook 调用与决策协议                 |
| `src/core/hooks/registry/hook-registry.ts`                      | Hook 注册、排序与冻结               |
| `src/core/hooks/executor/hook-executor.ts`                      | Hook 超时执行、校验与短路           |
| `src/core/ports/model_client/model-client-port.ts`              | 模型请求和流式事件端口              |
| `src/core/ports/tool_executor/tool-executor-port.ts`            | 工具调用和结果端口                  |
| `src/core/ports/tool_batch_policy/tool-batch-policy-port.ts`    | 多工具调用分组策略端口              |
| `src/core/ports/event_sink/event-sink-port.ts`                  | required/best-effort 事件投递端口   |
| `src/core/ports/session_store/session-store-port.ts`            | append-only Session 存储端口        |
| `src/core/ports/session_store/session-projection.ts`            | Session 记录到 RunState 的纯投影    |
| `src/core/ports/checkpoint_store/checkpoint-store-port.ts`      | checkpoint 结构、校验和存储端口     |
| `src/core/runtime/state/run-state.ts`                           | RunState、阶段与状态不变量          |
| `src/core/runtime/events/agent-events.ts`                       | AgentEvent 与转换规则               |
| `src/core/runtime/reducer/run-state-reducer.ts`                 | AgentEvent 到 RunState 的唯一推进器 |
| `src/core/runtime/limits/limit-guard.ts`                        | 运行资源上限检查                    |
| `src/core/runtime/cancellation/cancellation-controller.ts`      | 协作式取消传播                      |
| `src/core/runtime/event_delivery/event-delivery-coordinator.ts` | 事件投递和提交屏障                  |
| `src/core/runtime/loop/model-stream-consumer.ts`                | 模型流校验与结果归并                |
| `src/core/runtime/loop/runtime-runner.ts`                       | Agent 主循环编排                    |
| `src/core/runtime/checkpointing/checkpointing-event-sink.ts`    | 稳定边界 checkpoint 写入            |
| `src/core/runtime/recovery/recovery-coordinator.ts`             | 事实重放、中断对账和恢复动作        |

## 工具、安全与适配器模块

| 文件                                                   | 主要职责                                 |
| ------------------------------------------------------ | ---------------------------------------- |
| `src/tools/schemas/tool-schemas.ts`                    | ToolDefinition、handler 与安全元数据契约 |
| `src/tools/registry/tool-registry.ts`                  | 工具注册、快照与并行分组                 |
| `src/tools/dispatcher/tool-dispatcher.ts`              | 权限、审批、handler 调度链               |
| `src/tools/builtin/read/read-tool.ts`                  | workspace 受限读取工具                   |
| `src/tools/builtin/edit/edit-tool.ts`                  | workspace 受限编辑工具                   |
| `src/tools/builtin/shell/shell-tool.ts`                | process sandbox 命令工具                 |
| `src/policy/permissions/permission-policy.ts`          | 路径规范化和 allow/deny/ask 决策         |
| `src/policy/approval/approval-coordinator.ts`          | 有时限且绑定操作指纹的审批               |
| `src/sandbox/workspace/workspace-sandbox.ts`           | symlink-safe workspace 文件能力          |
| `src/sandbox/process/process-sandbox.ts`               | 受限进程执行和清理                       |
| `src/storage/session_event_sink/session-event-sink.ts` | required Session 事件持久化屏障          |
| `src/storage/adapters/in_memory/in-memory-stores.ts`   | 内存 Session/checkpoint 适配器           |
| `src/storage/adapters/sqlite/sqlite-stores.ts`         | SQLite Session/checkpoint 适配器         |
| `src/observability/logging/structured-event-logger.ts` | 脱敏结构化事件日志                       |
| `src/observability/trace/in-memory-trace-sink.ts`      | 内存精简时间线                           |
| `src/observability/event_sink/event-sink-adapters.ts`  | 通用 EventSink 适配器扩展入口            |
| `src/public-api.ts`                                    | 稳定生产 API 的显式导出入口              |

## 测试支持入口

- `tests/fakes/test-fakes.ts`：统一导出可脚本化的模型、工具和事件测试替身。
- `tests/helpers/test-helpers.ts`：统一导出确定性 ID、时钟、临时 workspace 与清理工具。
