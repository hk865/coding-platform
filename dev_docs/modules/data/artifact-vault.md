# ArtifactVault Module

```yaml
status: draft
updated: 2026-09-06
plane: Data
```

## Purpose

保存不可变产物、Context、报告与交接正文，让调用者通过精确引用读取。

## Interface

候选操作：`put(record) / open(ref, accessScope)`。共享字段、拒绝与状态语义唯一来源为 [运行时协作契约](../../interfaces/runtime-collaboration.md)，本页不复制 wire schema。首个消费者：P1-03 首次冻结；P1-04 消费其版本；设计已展开不代表契约已冻结或实现。

## Dependencies

无其他产品 Module 调用依赖；存储 Adapter 注入。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准；运行时事件反馈不是反向源码依赖。

## Hidden Implementation

内容寻址、正文存储、来源元数据、读授权与完整性检查；不判定报告的业务真实性。

## Test seam

通过上述 Interface 注入依赖 Adapter，验证：相同内容重放、损坏 digest、跨 scope 读取、正文已存但登记失败；缺失不伪装成空内容。 不以内部表或私有方法作为唯一测试入口。

## Context load

实现或扩展本 Module 时读取本页、当前 Ticket 与直接消费的 [运行时协作契约](../../interfaces/runtime-collaboration.md) 小节；初始协商及图文集成另读 [初始设计与统一展示](../../interfaces/human-design-status.md)。原始对话和完整历史按需追溯，不默认装入 Run。

## Context 生命周期与协作扩展

复用正文与来源保存执行理由、议题和交接；P1-16／17 不建立另一个记忆存储，清理不得造成权威引用悬空。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
