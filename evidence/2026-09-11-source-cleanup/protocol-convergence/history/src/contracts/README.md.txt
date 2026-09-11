# 共享契约

定义模块端口、信封、命令、事件与版本化材料结构。

## 源码入口

- [modules.ts](modules.ts)
- [ports.ts](ports.ts)
- [task-envelope.ts](task-envelope.ts)
- [verification.ts](verification.ts)
- [artifact.ts](artifact.ts)
- [material-access.ts](material-access.ts)
- [ledger.ts](ledger.ts)

## 边界与接线

按真实跨 Module 消费者保留协议。调用者直接导入所属协议文件，不再通过无消费者的根 barrel；不为目录整理新增业务层级。

- 反馈与补料：[execution-feedback.ts](execution-feedback.ts)、[query-job.ts](query-job.ts)、[runtime-context-materials.ts](runtime-context-materials.ts)。
- 协调与返工：[planning.ts](planning.ts)（含影响报告工作身份材料）、[问题材料](rework/issues.ts)、[提案](rework/proposal.ts)、[驱动](rework/drive.ts)、[Control受理](rework/acceptance.ts)。
- 验证与正式资格：[verification-service.ts](verification-service.ts)、[verification-round.ts](verification-round.ts)、[evidence.ts](evidence.ts)、[reduction.ts](reduction.ts)。

协议结构校验按入口在 [validation](validation/README.md) 中组织，消费者直接引用对应协议，无总转导出。公共问题结果与通用结构原语在 common.ts；原语只服务字段校验，不取代 Control 的正式准入政策。返工问题来源、当前处置与 ReworkDispositionPort 在同一问题协议；提案继续复用 PlanProposal。只有组合根消费的 ReworkIssueReadPort 位于 [harness/rework-composition.ts](../harness/rework-composition.ts)。

仅供测试的构造器和替身在 [tests/contract-support](../../tests/contract-support)；宿主实际消费的启动样例在 [src/fixtures](../fixtures)，确定性依赖与检查替身在 [src/testing](../testing)。它们保留明确消费者与原默认值，不作为公共业务协议导出。StateLedger 的提交结构校验位于 [ledger-validation.ts](../data/state-ledger/ledger-validation.ts)，Verification 的构造依赖位于 [verification-deps.ts](../control/verification-engine/verification-deps.ts)。

公开命名导出只保留真实跨文件消费者需要的入口；只作为同文件结果成员的子类型保留定义与字段但不额外导出。不存在消费者的 GoalChangePort/PublicSnapshotPort 已删除：前者的正式调用形状由 modules.ts 的 HumanCollaboration 定义，后者的真实快照路径由 query-job.ts 的 SnapshotPort 定义。ports.ts 不再转导出 Artifact/TaskContext/DispatchIntent。

Verification 的编译输入/结果与补丁检查注入类型位于该模块实现，Context 的 CoordinationSourcePort 位于 query-execution-context.ts；这些内部接口不属于跨 Module 公共协议。

持久字段和 HTTP wire 形状不因内部路径迁移改变；新增公共导出需说明真实跨模块消费者。私有包没有已登记的外部 deep-import 兼容承诺。

## 修改与验证入口

涉及职责或契约时读 [架构](../../../agent_learn/agent_dev/agent_platform/ARCHITECTURE.md)。 完成状态与实施顺序统一看 [module-status](../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/contracts](../../tests/contracts)。构建与测试命令以 [package.json](../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。
