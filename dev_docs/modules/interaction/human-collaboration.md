# HumanCollaboration Module：Goal 创建切片

```yaml
status: draft
updated: 2026-09-06
slice: 创建 Goal → 持久化 → 投影显示
plane: Human Interaction
```

## Purpose

2026-09-05 [设计复核](../../design/human-framework-role-review.md)：本 Module 仅展开 Goal 创建切片。完整协调入口见 [运行时协作](../../interfaces/runtime-collaboration.md) 与 [初始设计／展示](../../interfaces/human-design-status.md)，不能把下述首切片类型当作完整产品入口。

`HumanCollaboration` 把一次用户级 Goal 创建请求转换为可审计 Command，并从
`ReadModelIndex` 返回可显示结果。它让调用者不必理解 Command 构造、幂等重试或投影延迟。

## Interface

扩展查询与协调消费 [运行时协作 Interface](../../interfaces/runtime-collaboration.md)：新增 PlanCompiler 协调入口与 DispatchEngine 公开快照读取依赖。下述代码与依赖限制仅适用于 CreateGoal 首切片，不能用于否定扩展路径。正式状态仅来自 ReadModel；报告与语义解释可展示，但必须分种类标明来源。

```ts
interface HumanCollaboration {
  createGoal(request: CreateGoalRequest): Promise<CreateGoalResult>;
  goalView(query: GoalViewQuery): Promise<GoalViewResult>;
}

type CreateGoalRequest = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  objective: string;
  actor: ActorRef;
  idempotencyKey: string;
};

type UserFacingRejectionCode =
  | "invalid_request"
  | "scope_not_found"
  | "conflict"
  | "temporarily_unavailable";

type CreateGoalResult =
  | { status: "persisted"; goalId: string; commitCursor: CommitCursor }
  | { status: "rejected"; code: UserFacingRejectionCode };
```

- `CreateGoalRequest` 只含 `projectId、workspaceId、goalId、objective、actor、idempotencyKey`；
- `CreateGoalResult` 只暴露 `persisted(goalId, commitCursor)` 或用户级 rejection，不泄漏 Control 内部错误；
- `goalView` 可携带 `atLeastCursor`，用于区分“投影尚未追上”与“Goal 不存在”；
- 成功提交返回 `commitCursor`，不伪装成已经完成投影。

## Hidden Implementation

Implementation 隐藏：输入规范化、`CreateGoal` Command 构造、correlation 传播、幂等键复用、
Control 错误到用户错误的映射，以及提交后按 cursor 读取或等待 Goal View 的策略。映射固定为：
`invalid → invalid_request`、`not_found → scope_not_found`、revision/idempotency conflict → `conflict`、
`unavailable → temporarily_unavailable`。

首切片接收已经提取出的结构化 objective；自然语言 Intent 编译和 Advisory 留给后续 Module。

完整产品的候选查询入口允许用户直接查询事实、读取已公开的执行快照，或请求独立 QueryJob；参谋可只转交工具结果。
当前首切片的 `goalView` 仍只返回已定义的 Goal 投影，不混入未验证的执行者报告。扩展查询时需分别声明回答种类、来源、时效和权限，细节见 [角色与查询复核](../../design/human-framework-role-review.md)。

## Dependencies

- 写入只依赖 `ControlEngine.Interface`；
- 展示只依赖 `ReadModelIndex.Interface`；
- 写入类型使用[Command/Event Interface](../../interfaces/command-event.md)，查询类型使用
  [Goal View Interface](../../interfaces/goal-view.md)；
- 不依赖 `StateLedger`、数据库或 Worker Runtime；扩展快照通过 DispatchEngine 访问。

## Invariants

### Global

- 用户写意图只能变成 Command，不能直写 canonical state 或 Read Model；
- 正式状态只能来自 Read Model，不能从成功文案、模型记忆或本地表单状态推断；扩展报告／解释另行标识；
- ActorRef、correlation 和 CommandIdentity 必须贯穿整条写路径。

### Local

- UI 重试必须复用原 `(projectId, actor, idempotencyKey)` CommandIdentity；
- `goalId` 与 `workspaceId` 都是 Project 内的本地 ID；构造 Command 和 GoalViewQuery 时必须始终携带
  `projectId`，不得以任一局部 ID 代替完整 scope；
- 只有底层 `CommandReceipt.status = committed` 才能映射为 `CreateGoalResult.persisted`；
- 投影未达到 `commitCursor` 时返回 `not_ready`，不得错误显示 `not_found`；
- objective 的展示值来自 `GoalCreated` 投影，不从提交请求旁路回填。

## Test seam

通过本 Module 的 Interface 测试，并注入 Control 与 Read Model Adapter。最小契约场景：成功提交、
校验拒绝、相同请求重试、同键异载荷冲突、投影延迟后追上，以及已经追上后的真实 not-found。
另用两个 Project 复用相同 `workspaceId/goalId`，验证写入和查询都不会串 scope。

## Explicitly not responsible

- 不拥有 Goal、Task 或 Plan 状态；
- 不执行产品级规划、调度、验证或 Agent 通信；
- 不决定 revision guard，也不生成 Domain Event；
- 不渲染具体 Web/桌面 UI。

## Context load

默认只装载：本文件、[Command/Event Interface](../../interfaces/command-event.md)、
[Goal View Interface](../../interfaces/goal-view.md)、当前 Ticket；调用依赖时只装载
[`ControlEngine.Interface`](../control/control-engine.md#interface) 与
[`ReadModelIndex.Interface`](../data/read-model-index.md#interface) 小节。领域词义有歧义时再读取
[`CONTEXT.md`](../../../CONTEXT.md) 的相关条目；不默认装载总体架构、完整 DAG 或其他 Ticket。

## Context 生命周期与协作扩展

P1-14／15 消费架构／接口变更通知和待决结果；主动展示、精确决定与反馈见人类交互契约。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
