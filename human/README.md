# 人类管理与审阅入口

本页提供阅读地图，具体规则以链接正文为准。职责规则见 [文档职责划分](../dev_docs/document-ownership.md)。

## 日常管理

| 你要决定什么 | 管理／审阅文档 | Agent 承接什么 |
| --- | --- | --- |
| 产品目标、范围和非目标 | [PRODUCT](../PRODUCT.md) | 同步规格细节、Ticket 和验收 |
| 系统分责、边界与架构取舍 | [ARCHITECTURE](../ARCHITECTURE.md) | 维护 Module、Interface 和检查 |
| 什么才算交付成功 | [MVP 场景](../dev_docs/evaluation/mvp-scenario.md) | 维护测试、验证程序和 Evidence |
| 阶段范围与优先级 | [ROADMAP](../dev_docs/planning/ROADMAP.md) | 拆分 Ticket、维护 DAG、协调并行与集成 |

你可以直接修改正文，或要求 Agent 按决定修订。下游同步由 Agent 按[更新流程](../dev_docs/agent/README.md)执行，无需你手工逐票修改。

## 按需审阅

- 完成、取消、部分接受等行为变化：[Completion Policy](../dev_docs/interfaces/completion-policy.md) 的相关规则。
- 架构取舍与理由：[决策索引](../dev_docs/decisions/INDEX.md)。
- 术语含义：[CONTEXT](../CONTEXT.md) 的相关条目。
- 直观理解系统：[入口与系统图](../dev_docs/design/agent-entry-and-system-map.md)，其依据仍是正式规范。
- 范围争议：[用户需求原文](../dev_docs/product/用户需求原文.md)。

## 当前审阅入口

**2026-09-06：Context 生命周期与编排交互方向已确认，正式文档及 Ticket 已同步。** 人类审阅过程保留在 [集中稿](../dev_docs/design/context-lifecycle-human-review.md)；当前行为查看 [PRODUCT](../PRODUCT.md) 与 [完整 MVP 场景](../dev_docs/evaluation/mvp-scenario.md)，具体改动与实现缺口见 [同步记录](../dev_docs/verification/2026-09-06-context-orchestration-sync.md)。

新增 P1-16／17 按依赖接入现有工作，已有 P1-03／06 证据按原范围保留。你无需重新审阅字段；新的业务选择再提交具体取舍。P0/P1 整体状态与新增实现授权未由这次文档修改改变。

项目建立位置见 [项目位置与建项入口](../dev_docs/agent/project-location.md)，由 Agent 维护具体路径和派发配置。

[P0-06](../dev_docs/planning/active/P0/tickets/06-user-review.md) 记录完成规则与 [P1 候选施工图](../dev_docs/planning/proposed/P1-foundation/DAG.md) 的审阅状态。状态以该 Ticket 为准；文档职责划分不代表接受产品方案或启动 P1。

Module 实现说明、接口字段、叶子 Ticket、依赖边、测试输出与 Handoff 由 Agent 日常维护。需要细查时进入 [Agent 维护入口](../dev_docs/agent/README.md)。
