# PlanCompiler

把协调意图与人工计划编译成可受理的计划提案；正式接纳由 Control 决定。

## 源码入口

- [plan-compiler.ts](plan-compiler.ts)：统一 request／accept 入口
- [initial-plan-compiler.ts](initial-plan-compiler.ts)：初始协调意图与提案受理请求
- [operator-plan-compiler.ts](operator-plan-compiler.ts)：明确标识的人工计划来源
- [execution-feedback-compiler.ts](execution-feedback-compiler.ts)：公开执行反馈进入只读协调 Query。
- [rework-plan-compiler.ts](rework-plan-compiler.ts)：校验当前问题、去重并按义务承担者分组。
- [rework-proposal.ts](rework-proposal.ts)：模块内组装返工任务指令、影响与草稿；不负责受理。

## 边界与接线

`PlanCompilerImpl` 是统一自动规划入口，`OperatorPlanCompiler` 明确保留人工来源（`planOrigin: operator`）。确定性模型结果规范化是 Control 入场政策（`control-engine/policies/initial-plan-admission.ts`），本 Module 复用它，Control 的来源 guard 不反调本 Module。

`ReworkPlanCompiler` 同样只提案、不落账：输入是调用方给出的当前 active plan revision 快照与一组未处置问题（VerificationEngine 的只读投影结果），输出是 `ReworkProposalV1`（形状沿用 `PlanProposalV1`，任务集增量用 `PlanTaskSetDeltaV1`）。它是同步纯函数（无时钟、无账本、无端口），因此同一批问题与同一份源计划必然得到逐字相同的提案；任务集与义务承担者的推导复用 Control 的 `policies/goal-change-consistency.ts`，身份推导复用 [contracts/rework.ts](../../contracts/rework.ts)，本 Module 不另写第二份规则。受理（提案 → 人的决定 → CAS 应用，或 Control 的自动受理入口）不在本 Module。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/plan-compiler.md)。完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/control](../../../tests/control) 中的 `plan-compiler.test.ts`、`planning-interface.test.ts`、`rework-plan-compiler.test.ts`。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。
