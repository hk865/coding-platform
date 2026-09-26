# AgentRuntime 当前实现

2026-09-25。`runtime.ts`/`ports.ts` 的 prepareExecution/startRun 仍是 unsupported 骨架；组合根已经接通 createSession/readSessionHistory/readExecutionHistory 及真实配置下的 capabilities 查询。已有底层组件不等于正式 Run 编排完成，具体复用前提见[能力索引](../../../../../docs/refactor/IMPLEMENTED-CAPABILITIES.md#6-agentruntime-与冻结-kernel)。

- `session-operations.ts` / `kernel-store-locator.ts`：已有真实 Session 创建、固定 Store 映射、原历史分页和创建失败恢复；组合根可调用。
- `observed-model-run.ts`：真实 Kernel 模型与工具循环、预算、调用前守卫和资源清理；已透传 sessionContext/executionIdentity，历史由 Kernel 装配，正式 Task/Query 驱动尚未接通。
- `project-source-tool.ts`、`exploration-tools.ts`：模型源码工具与有限精确读取；frozen 模式失败不回落 live。
- `source-capture-access.ts`：复制准备绑定，按当前已受理事实重核 Work/Reviewer/Query 身份与资格，维护一次循环独占的捕获注册表。
- `source-binding-types.ts`：仅保留绑定真正消费的准备字段；`source-tool-ports.ts` 是可信装配提供的工具能力。
- `../work-graph/source-authority-ports.ts`：只读事实接口；生产 provider 尚未实现。单元测试中的事实夹具不是运行派发器。

下一阶段接线必须由 WorkGraph/RecordStore 解码真实记录和事件、由平台运行入口提供已受理身份；不得接回旧 StateLedger 或以固定 system actor 代替。Query 历史扫描保留原成本，不能把迁移报告当作索引已实现。

验收与未闭合消费者见 [补迁对账](../../../../../docs/refactor/reviews/next-completed-migration-2026-09-24.md)。

`observation-recovery.ts` 当前仅组合既有历史 owner 提供精确 runId/turnId 原始证据读取，不归约执行状态或完成历史边界；空页不证明未进入，Kernel物理读取成本仍见能力索引 RT7。
