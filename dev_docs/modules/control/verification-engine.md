# VerificationEngine Module

```yaml
status: draft
updated: 2026-09-06
plane: Control
```

## Purpose

组合工具与 Reviewer 的证据，返回绑定当前义务及来源的验证结果，不自行完成 Task。

## Interface

候选操作：`verify(intent) → verificationRef / incomplete / rejected`。共享字段、拒绝与状态语义唯一来源为 [运行时协作契约](../../interfaces/runtime-collaboration.md)，本页不复制 wire schema。首个消费者：P1-04；12/14 扩展代码图与迁移验证；设计已展开不代表契约已冻结或实现。

## Dependencies

ControlEngine、ContextCompiler、ArtifactVault。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准；运行时事件反馈不是反向源码依赖。

## Hidden Implementation

验证要求选择、工具证据采集、Reviewer 工作请求与异步结果汇合；完成归约由 Control 执行。

## Test seam

通过上述 Interface 注入依赖 Adapter，验证：FAIL/PASS 历史保留、stale applicability、未知结果、语义 verdict 与静态证据不能互相冒充。 不以内部表或私有方法作为唯一测试入口。

## Context load

实现或扩展本 Module 时读取本页、当前 Ticket 与直接消费的 [运行时协作契约](../../interfaces/runtime-collaboration.md) 小节；初始协商及图文集成另读 [初始设计与统一展示](../../interfaces/human-design-status.md)。原始对话和完整历史按需追溯，不默认装入 Run。

## Context 生命周期与协作扩展

审查绑定明确版本和范围；前次审查可作为来源，新版本重新判断适用性；角色共识不替代有效 Evidence。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
