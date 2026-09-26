# W2 工具独审收尾

沿原 implementation scope（7 文件）原地修正，冻结测试不改：

1. 当前模型看到的 draft 说明只罗列几个字段，且使用不存在的顶层 `relations`，未兑现任务要求的准确 v2 格式/示例。读取真实 `contracts/plan.ts` 的 PlanRevisionDraft，给出准确顶层字段、Task/assignment/obligation/输入与关系字段的简洁说明或结构示例；说明从 query_task_graph 的当前 Plan 复制已知结构、去除 accepted/compiler metadata 后局部修改，不要求模型猜 schema。不另写 Plan 语义校验器。所有字段与真实类型一致，不能虚报未来 intent 字段已经支持。
2. catch 当前报“operation failed before completing”，但领域服务可能已经提交后连接丢失。改为结果不可确认的准确提示：不要断言未提交，不鼓励用新 callId 重试；写请求应按同一真实请求身份核对原回执。保留失败而非伪成功，不扩大协议或新建恢复系统。

原工厂可信身份、完整 typed 结果、真实 callId 和 late cancel 语义保持。运行 next-types 与 next-whiteboard-tools 并报告结果。除此不扩大范围、不改测试或共享结构。
