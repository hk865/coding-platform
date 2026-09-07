# 产品／架构复核与对话导入记录

日期：2026-09-05。依据：用户逐条纠正 PRODUCT、ARCHITECTURE，并指定四份共享对话补入需求来源。

## 已处理

- [PRODUCT](../../PRODUCT.md)：明确统一图文界面、框架维护状态、Context／状态问题来源、角色分责，以及人和参谋共同明确需求、参与架构建立与变更。
- [ARCHITECTURE](../../ARCHITECTURE.md)：补反馈方向，区分运行时图与源码依赖图，并标注完整角色和协作路径未冻结。
- [复核稿](../design/human-framework-role-review.md)：保存候选信息流、状态工程实现和下游影响，未决选择保持可讨论。
- P0-06、P0 DAG、P1 DAG、MVP、15 张 P1 票、4 份 Interface 和 4 份 Module 均可沿局部入口到达复核要求；未把旧并发 fixture 当作新角色协作验收。
- README、人类入口、AGENTS、图形入口和职责分类已同步。

## 来源导入

[来源索引](../product/README.md) 链接四份共享页与本地文本，共 33 条可见文本消息。通过公开页结构化数据解析 current_node 的祖先链，保留用户和面向用户的 Assistant 文本；排除隐藏内容、工具载荷和内部推理。正文保存后逐份与选定消息文本比较一致。不会将历史回答的断言默认为当前已核实事实。

| 快照 | 消息数 | SHA-256 |
| --- | --- | --- |
| [S-001](../product/conversations/S-001.txt) | 9 | `87cacd4bc088bb879653894b3bbd604523c411c4c1db5b710a1651d12dd83299` |
| [S-002](../product/conversations/S-002.txt) | 4 | `27849d9119f7f5cb8ea0431389d9bf845676751a0f30b88bad74441529f3c694` |
| [S-003](../product/conversations/S-003.txt) | 10 | `8f030ea0f89a1ac47e7711189d9129fe5400d3d7bbd665eb09a8c0d4d66af425` |
| [S-004](../product/conversations/S-004.txt) | 10 | `714860e60a12b976e4623bebbd83ccadc2b0d04f3cd4105b954b9496a8fc56d9` |

## 尚未完成的设计决定

秘书／参谋与规划／集成者的关系、初始架构协作的 MVP 切片、图文一致性契约和新版角色门禁仍需讨论。现行 Ticket 与 Interface 标为待复核候选，尚未重写为一套已接受的新实现方案。P0 保持 in_review，P1 保持 proposed，未创建产品代码。

## 验证范围

运行 `node dev_docs/verification/validate-docs.mjs`，链接、状态、DAG、产物关系与历史归档检查 10/10 通过。另核对四份对话摘要与所有 P1 局部复核入口。此结果证明文档结构和导入完整性，不证明候选设计已经语义一致或可直接实施；未运行产品行为测试。
