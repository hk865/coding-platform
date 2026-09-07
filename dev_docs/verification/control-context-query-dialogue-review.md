# Control、Context、直接查询与交流职责修订

日期：2026-09-05。

依据：用户关于 Semantic Planning 是否归入 Control 的问题、保留工具直查执行报告的讨论，以及角色／记忆职责与 Agent 对话是否形成大循环的本轮反馈。

## 本次落盘

- [ARCHITECTURE](../../ARCHITECTURE.md)：语义协调纳入 Control Plane，PlanCompiler 的注册归属同步；Control 管理角色绑定、记忆生命周期、Context 使用规则和通信，Data 保存与编译材料。补直接事实查询、公开快照和独立 QueryJob 路径。
- [角色复核稿](../design/human-framework-role-review.md)：补职责表、Control 内部分组与查询反馈连线；角色交流默认有界消息与交接，必要讨论具备议题、预算和退出条件。
- P1-09、HumanCollaboration 首切片说明和 P0-06 同步复核要求。现有 goalView 契约不承载未验证的执行报告。

## 设计边界

查询仍受作用域、权限和时效检查；直接返回回答不改变 Task 完成状态。快照能力必须由运行内核明确支持，不读取隐藏推理、不向源 Coder Context 注入查询。

本次明确的是职责与候选路径，未创建新的记忆、通信 Module 或产品运行实现。角色规格／绑定、记忆接纳／失效、消息与快照的具体契约、讨论预算和 MVP 覆盖仍待收敛。P0 继续 in_review，P1 继续 proposed。

## 验证

运行现有文档检查，并核对两张主图全部边有说明、Control 与 Data 分组及直接查询／反馈路径。结果见本次交接；检查通过不表示运行时功能已实现或设计已获完整批准。
