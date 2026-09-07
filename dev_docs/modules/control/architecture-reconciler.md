# ArchitectureReconciler Module

```yaml
status: draft
updated: 2026-09-06
plane: Control
```

## Purpose

对照有效 Baseline 与实际源码产生差异、Finding 和可审阅的演进材料。

## Interface

候选操作：`inspect(intent) → assessmentRef；演进操作由 P1-14 冻结`。共享字段、拒绝与状态语义唯一来源为 [运行时协作契约](../../interfaces/runtime-collaboration.md)，本页不复制 wire schema。首个消费者：P1-12；13/14 扩展修复与演进；设计已展开不代表契约已冻结或实现。

## Dependencies

ControlEngine、ContextCompiler、ArtifactVault。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准；运行时事件反馈不是反向源码依赖。

## Hidden Implementation

差异分类、授权内修复提案、候选基线物化与迁移要求；源码变化不自动改写规范。

## Test seam

通过上述 Interface 注入依赖 Adapter，验证：索引落后、source baseline 移动、候选 digest 不匹配、无授权激活、迁移失败。 不以内部表或私有方法作为唯一测试入口。

## Context load

实现或扩展本 Module 时读取本页、当前 Ticket 与直接消费的 [运行时协作契约](../../interfaces/runtime-collaboration.md) 小节；初始协商及图文集成另读 [初始设计与统一展示](../../interfaces/human-design-status.md)。原始对话和完整历史按需追溯，不默认装入 Run。

## Context 生命周期与协作扩展

P1-12 支持没有代码变更的版本化接口／架构问题输入；P1-14 保留提案、决定、迁移门禁，不能因模型共识激活 baseline。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
