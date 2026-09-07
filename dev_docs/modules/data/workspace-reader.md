# WorkspaceReader Module

```yaml
status: draft
updated: 2026-09-06
plane: Data
```

## Purpose

在显式读权限内访问源码、Git 差异及可用代码／测试索引，隐藏工作区读取差异。

## Interface

候选操作：`read(query) → sourced / unsupported / stale / rejected`。共享字段、拒绝与状态语义唯一来源为 [运行时协作契约](../../interfaces/runtime-collaboration.md)，本页不复制 wire schema。首个消费者：P1-12 首个真实源码读取切片；设计已展开不代表契约已冻结或实现。

注：运行访问控制面（WorkspaceReadLease / WorkspaceCapabilityPort，P1-07 冻结）与本模块分工不同——前者只管借用与能力声明，不读取工作区内容；本模块 read() 首个消费者仍为 P1-12。

## Dependencies

无其他产品 Module 调用依赖；文件／Git／索引能力注入。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准；运行时事件反馈不是反向源码依赖。

## Hidden Implementation

路径解析与逃逸防护、commit 与工作树快照区别、索引版本和能力检测；只读，不初始化代码目录。

## Test seam

通过上述 Interface 注入依赖 Adapter，验证：读取中变化、越界路径及符号链接、索引落后、缺少图能力和有限检索结果。 不以内部表或私有方法作为唯一测试入口。

## Context load

实现或扩展本 Module 时读取本页、当前 Ticket 与直接消费的 [运行时协作契约](../../interfaces/runtime-collaboration.md) 小节；初始协商及图文集成另读 [初始设计与统一展示](../../interfaces/human-design-status.md)。原始对话和完整历史按需追溯，不默认装入 Run。

## Context 生命周期与协作扩展

P1-17 复用当前来源读取与版本检查；既有文本／快照可降级，不能把旧执行理由当作当前代码事实。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。
