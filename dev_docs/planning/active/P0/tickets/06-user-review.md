# P0-06：User review

```yaml
status: in_review
updated: 2026-09-05
kind: design-ticket
gate: user-decision
```

## Blocked by

2026-09-05 用户提出实质修订，现仍为 `in_review`。本次反馈不视作接受旧架构／Interface／P1 施工图。
新增审阅范围见 [统一界面、角色与框架复核](../../../../design/human-framework-role-review.md)：确认角色分责、需求／架构共同建立、双向反馈、状态图与文本契约，并先修订相应 Ticket 与 MVP 门禁。

本轮反馈：用户认为 PRODUCT 基本符合要求，角色定义随复核稿继续收敛；ARCHITECTURE 的首图曾阻塞阅读，后续部分尚未审阅。本次已修订 Data Plane 下的 ReadModel／Context 分工、校验职责、协调指挥与反馈，以及事件触发的自治／升级规则，不代表用户已接受架构剩余部分。

- [P0-05 Proposed build DAG](./05-proposed-build-dag.md) — 已满足；
- 用户对 Task→Goal Completion Policy 和本开发地图的明确接受或修订 — 等待中。

## 本轮文档收敛记录

用户表示整体方向差不多并委托完成其余文档。已补齐 Module 职责、初始设计／展示契约、P1-15、新版 G3 与 MVP 场景。该委托授权文档同步，不自动转换为阶段 accept。当前仅待整体施工授权及实际评价任务／技术栈选择，不要求人逐条审阅接口字段。

## What it delivers

用户沿一个完整场景审阅产品：Goal 如何被拆成 Module×Stage 视图，RuntimeExecutionDAG 如何只表达真依赖，Worker 如何提交 CompletionClaim，Evidence 如何完成 required work/GateTask，以及最终状态如何出现在统一控制台。

审阅结果不是聊天里的默认同意，而是一条明确 Decision：`accept`、`accept_with_changes` 或 `reject`。

## Module / Interface refs

- [Task→Goal Completion Policy](../../../../interfaces/completion-policy.md)；
- [产品定义](../../../../../PRODUCT.md)与[架构地图](../../../../../ARCHITECTURE.md)；
- [任务图旧路径路由](../../../../design/任务图与完成判定.md)；
- [P1 候选 DAG](../../../proposed/P1-foundation/DAG.md)；
- [MVP 场景](../../../../evaluation/mvp-scenario.md)。

## Acceptance

- 本轮补充复核：语义协调归入 Control；角色／记忆／Context 策略与 Data 编译材料的职责分开；直接查询和有限 Agent 交流不依赖一个共享长 Context，新增契约及 MVP 范围明确后再冻结；
- 明确秘书／参谋与规划／集成者的职责关系，以及执行者交接和集成验证如何由框架维护；
- 明确需求确立、架构建立／变更、人类知情和适用决策进入执行的完整路径；
- 统一界面的状态图和文本来源、freshness 与 MVP 验收已明确；角色协作门禁已替代仅证明并发数量的旧定义；
- ReadModel 查询、Context 编译和 Verification 校验职责明确；协调者能在授权内完成分工、耦合／测试设计与返工，事件策略能区分自动处理、语义协调和人类决定；
- 用户明确确认或修改：Goal 归约所有 required executable work Task、required AcceptanceObligation 与 required GateTask；
- 用户确认 required 的 blocked/deferred/cancelled 不等于完成，optional 不阻塞但必须保留处置结果；
- 用户确认 `COMPLETED` 与显式 `ACCEPTED_PARTIAL` 是不同结果；
- 用户确认 `parent_of` 不改变完成义务，Stage 不自动产生依赖；
- 用户确认 P1 的 ticket 顺序和 MVP 场景可用于开始实现；
- 若有修改，受影响 ticket/DAG 先产生新 revision，再关闭本票；
- 只有明确 `accept` 后，本票和 P0 才能标为 `completed`，P1 才可转为 `active`。

## 2026-09-06 专项确认与同步

用户认可 Context 生命周期、执行记忆及编排交互方向，并明确要求“开始修改文档”。本轮专项确认不等于整套 P0／P1 accept，也不授权新增实现。本票继续 in_review。

专项 Acceptance：正式规范、P1-16／17、相关消费者及 G2／G3 场景覆盖持续 Context、跨任务记录继承、多个包工头的冲突、秘书／参谋上报架构／接口变化、决定返回受影响工作；P1-03／06 原证据与新增义务分开。同步结果见 [影响记录](../../../../verification/2026-09-06-context-orchestration-sync.md)。
