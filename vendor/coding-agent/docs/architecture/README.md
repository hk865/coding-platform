# Architecture

本目录说明“模块在哪里、允许依赖谁、运行时如何组合”。

## 当前实现

- [模块地图](module-map.md)：App、Core、Adapter、Benchmark 的组合与静态依赖。
- [目录结构](folder-structure.md)：源码、测试和评测目录的所有权。
- [源码阅读指南](source-module-guide.md)：按 State/Event/Port/Loop/Adapter 的阅读顺序。
- [安全快照与增量一致性](m4-secure-snapshot-incremental-consistency.md)：workspace 基线设计。

## 演进提案

- [Agent Core 演进总览](evolution-overview.md)
- [Coding Agent、DSH 与 Pi 的关系](dsh-pi-relationship.md)
- [下一阶段模块图](next-module-map.md)
- [下一阶段数据流](../data-flow/next-agent-data-flow.md)

提案不等同于已实现模块。发生冲突时，以源码、通过的测试和上面的当前实现文档为准。
