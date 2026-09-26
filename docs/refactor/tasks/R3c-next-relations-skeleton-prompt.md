# 第一阶段：R3c 骨架和行为测试，完成后停止

用户刚刚调整分工：Astra 架构/接口 → DSH 4.1F 骨架与测试 → Astra 审核冻结 → DSH 实现 → Astra 审阅 → 隔离测试。本次只执行第一阶段，**不实现生产算法**。之前Sol的可编译契约、骨架及测试已落盘，直接复用，不重写或丢弃。Astra必须先审本阶段产物才能另行启动实现。

W=/home/hyh001/projects/coding-platform，T=W/coding-platform/next。读取以下已有路径：
- docs/refactor/DSH-EXECUTION-HARNESS.md、DSH-WORKFLOW.md、HANDOFF.md
- docs/PRODUCT.md §3/5.2、docs/refactor/ARCHITECTURE.md §3/6.1、docs/refactor/intent/2026-09-23-PARALLEL-AND-PRODUCT.md §4/5
- docs/refactor/modules/core/work-graph.md §4.0/4.1
- docs/refactor/tasks/R3c-next-task-relations-alignment-prompt.md
- T/src/contracts/plan.ts、dispatch.ts、core/work-graph/tasks/{plan-contracts,plan-service,plan-record-codecs,plan-validation,plan-commit-compiler,eligibility}.ts
- T/tests/work-graph/R3c-task-relations.test.ts、R3c-task-inputs.test.ts、R3c-canonical-task-state.test.ts；T/tests/composition/R3c-R4b-platform.test.ts

骨架已有明确的readTaskInput unsupported入口、v1/v2契约、TaskRow三个解释字段；不需要为了“搭骨架”重新建文件。请审查其是否足够约束上述语义，并用最后报告列出实现者必须遵循的调用顺序、事实来源。若骨架有具体缺口，报告主审，不自行改公共接口。

唯一可写文件：T/tests/work-graph/R3c-task-relations-boundaries.test.ts。补充少量有价值且不与已有测试重复的行为反例（先阅读现有测试）：
1. evaluateEligibility没有本任务的canonical phase必须eligible:false/reason task_state_incomplete，不允许默认pending（该reason已经冻结在dispatch.ts）；有自身pending/free时，只有上游running/未完成不得拒绝。
2. codec记录schemaId和body schemaVersion不一致拒绝，旧v1夹带新字段拒绝；复用真实codec，不自造decoder。可复用现有构造风格，避免巨大fixture复制。
3. 如发现额外核心未覆盖风险，最多补少量相应反例并说明来源；不要为凑测试数写实现镜像。

运行 `python3 tools/dsh-refactor/check.py next-task-relations` 和 `next-types`，分清当前因缺实现而红与测试自身错误。不能改旧测试/源码来变绿，不能执行第二阶段。测试可以RED但types必须通过。报告新增/复用骨架、测试范围、红测根因及是否有接口缺口，然后停止等待Astra审阅。不stage/commit/push/reset/restore/clean/stash，不装依赖，不读凭据或其他会话日志。
