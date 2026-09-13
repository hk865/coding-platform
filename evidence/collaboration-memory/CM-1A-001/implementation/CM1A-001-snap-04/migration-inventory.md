# CM1A-001-snap-04 共存清单（A11）

| 入口 | 当前推进与边界 | 回归入口 |
| --- | --- | --- |
| planned / operator ordinary Task | claim 仍创建既有唯一 TaskAttempt/Run/outbox；唯一 DispatchEngineImpl.drive 消费 ordinary，先 Context，再 start 授权、execution_entered、实际 Runtime；机械 retry 保留领域 Attempt | tests/control/dispatch-drive.test.ts、tests/control/workspace-drive.test.ts、tests/app/real-runtime.test.ts |
| 协作后继 | Wait admission 原子创建唯一 Attempt/Run/ordinary outbox；通过 successorPreparation 重建 RuntimeSpec，同一 drive 启动；不会出现第二协作运行队列 | tests/coordination/host-tool-chain.test.ts、handoff-successor.test.ts、route-drive.test.ts |
| parallel harness | 既有场景调用相同 DispatchPort；新并发位于唯一 drive，写入继续受 Workspace lease 排斥 | tests/integration/p1-07.contract-suite.sqlite.test.ts、tests/coordination/runtime-concurrency.test.ts |
| Query / exploration | 保留独立非 ordinary 的现有上下文/宿主路径；本票没有把它们登记成第二份 ordinary pending，不宣称逐调用许可已完整迁移 | tests/app/exploration-runtime.test.ts、tests/app/exploration-source.test.ts、tests/context/query-execution-context.test.ts |
| Reviewer | review 类型不被 ordinary 消费；仍由 review dispatcher 和对应 Context 驱动，新增可选窄端口兼容既有调用 | tests/control/reviewer-dispatch-isolation.test.ts、tests/verification/reviewer-recovery.test.ts |
| Handoff / replacement | ordinary 在 Context 前检查 ReplacementAttempt 并跳过；只由 handoff drive 消费，沿用 replacement 权威 | tests/control/handoff-drive.test.ts、tests/runtime/handoff-control-adapter.test.ts |
| Rework / planning queues | 继续产 Plan/Task 与合法 claim，不增加直接 Worker 执行循环 | tests/app/semantic-collaboration.test.ts、tests/verification/rework-issues.test.ts |
| cancel / recovery | 本票 Run desired state 与正式 control intent 先落账；恢复读取 durable journal，execution generation 与 permit 决定可否执行；无法证明无副作用不重发 | tests/coordination/process-recovery.test.ts、model-request-evidence-bypass.test.ts、tests/control/runtime-dispatch.test.ts |

未迁移入口的历史 human command identity 为旧协议兼容保留，不是把 Agent 工具伪装成 human；Agent 协调工具始终由宿主绑定 exact principal。M02/M03/M05 完整迁移未开始。本清单只说明当前排他路径与回归位置，不等于这些 M 票通过。
