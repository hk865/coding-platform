# ContextCompiler Module

```yaml
status: draft
updated: 2026-09-06
plane: Data
```

## Purpose

按已接受任务与角色选取有界、适用的工作材料，返回可审计来源清单。

## Interface

候选操作：`assemble(request) → ready / needs_material / rejected`。共享字段、拒绝与状态语义唯一来源为 [运行时协作契约](../../interfaces/runtime-collaboration.md)，本页不复制 wire schema。首个消费者：P1-03；06/09/11 扩展换手、查询、协调 Context；设计已展开不代表契约已冻结或实现。

## Dependencies

StateLedger、ReadModelIndex、ArtifactVault、WorkspaceReader。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准；运行时事件反馈不是反向源码依赖。

## Hidden Implementation

范围与版本过滤、检索排序、预算分配和来源归一；必要材料不足返回缺口。需要语义补充由调用方经 Control 派发。

## Test seam

通过上述 Interface 注入依赖 Adapter，验证：跨 scope、旧 revision、缺少必需规范、超预算、索引缺失；不得自行创建 Agent 或变更角色。 不以内部表或私有方法作为唯一测试入口。

## Context load

实现或扩展本 Module 时读取本页、当前 Ticket 与直接消费的 [运行时协作契约](../../interfaces/runtime-collaboration.md) 小节；初始协商及图文集成另读 [初始设计与统一展示](../../interfaces/human-design-status.md)。原始对话和完整历史按需追溯，不默认装入 Run。

## Context 生命周期与协作扩展

P1-16 编译关键理由与前沿；P1-17 按工作／模块／版本选取已完成历史，输出缺失与适用性，不整体重放 transcript。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
