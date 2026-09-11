# 组合根与测试宿主

装配 Ledger、Vault、Control、读模型和 Adapter，提供运行入口。

## 源码入口

- [persistent-harness.ts](persistent-harness.ts)
- [in-memory-harness.ts](in-memory-harness.ts)
- [index.ts](index.ts)

## 边界与接线

规划/补料消费者直接使用已有 `planProposal.request`、`planningContext.assemblePlanningContext`、`queryContext.assembleQueryContext`、`workContext.assembleWorkContext`、`completedWork.assembleCompletedWorkContext`；计划正式受理走 `control.recordPlanChangeProposal/recordUserDecision/applyPlanChange`，人的变更入口为 `collaboration.amend`。两宿主不再为这些方法另建同名转发面。带投影推进的授权入口与带问题材料预取的返工组合入口仍保留，不能按纯转发删除。

默认夹具注入不等于真实能力；核对 app/service.ts 对真实模式的实际注入。持久宿主把 `materialAccessGrants` 接到 Vault 的授权解析器，`grantMaterialAccess` 在返回前推进投影，保证已提交授权立即可解析。

两个宿主都暴露返工触发面（`reworkDrive`／`driveRework`／`reworkView`）。未处置问题只经构造参数 `reworkIssues` 注入（产品注入的是 `VerificationService.openIssues`），没有注入时驱动返回**显式不可用**而不是"没有问题"；因此 DispatchEngine 不依赖 VerificationEngine 的实现，ModuleDependencyDAG 保持无环。

[query-composition.ts](query-composition.ts) 统一 Query 授权提交后推进投影的接线；内存宿主仍每次 drive 创建实例，持久宿主仍每个宿主实例保留一个驱动。[rework-composition.ts](rework-composition.ts) 先从 Verification 取得材料再传入 Dispatch；两者都只组合，不迁移业务守卫。

## 修改与验证入口

涉及职责或契约时读 [架构](../../../agent_learn/agent_dev/agent_platform/ARCHITECTURE.md)。 完成状态与实施顺序统一看 [module-status](../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/integration](../../tests/integration)。构建与测试命令以 [package.json](../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。


两个宿主均暴露 revokeMaterialAccess；读取候选后从账本复核撤销、来源身份和当前计划/工作区版本。history grant 只在显式范围内读取旧正文，不复制 owner。
