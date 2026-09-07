---
status: accepted
---

# 分离模块依赖、开发 Ticket 与运行时执行图

Plane 只组织 Module；`ModuleDependencyDAG` 属于 ArchitectureBaseline，只描述长期源码与 Interface 依赖，不表达施工顺序。`DevelopmentTicketDAG` 属于开发计划，以可在一个新 Context 中独立验收的 tracer-bullet 纵向切片及其 blocking edges 组织施工；`RuntimeExecutionDAG` 属于 PlanRevision，只表达产品运行后 Runtime Task 之间的真实输入输出前置关系。三种图可以引用彼此但不能互相替代；Module Worker 可以在一个 Ticket 内并行，但必须在该纵向切片的 Integration Gate 汇合，避免把首次集成交互推迟到产品末期形成大爆炸集成。

## Harness 依据

本决策吸收 [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/) 的四项仓库实践，但不把博客目录原样复制成本产品架构：

- 根 `AGENTS.md` 是短索引，不是百科；Agent 沿 Ticket 的 Context pointer 渐进加载；
- 仓库内版本化文档和计划是记录系统，聊天与完整 transcript 不是长期真相源；
- 链接、Artifact 闭包、依赖方向和边界用脚本或结构测试机械验证；
- 人的架构判断进入 Baseline、Policy、Decision 与后续小步复盘，使约束持续生效。

因此，Ticket 既不能大到重新装入整个产品历史，也不能窄成只改一个水平层。它应从一个可证伪输入穿过必要的少量 Module，在当前切片内得到用户可观察结果和 Evidence。架构边界中央约束，边界内部允许 Agent 自主实现。

这是一项设计来源，不是“OpenAI 已验证本产品架构”的证据；本平台是否提升连续性、速度或成本，仍由自己的 MVP 场景评价。
