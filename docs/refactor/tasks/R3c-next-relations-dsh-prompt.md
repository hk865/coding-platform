# R3c：按冻结骨架实现任务关系与精确输入

你是本批实现者。这是第二阶段，仅在 Astra 对第一阶段骨架与测试完成审核并记录冻结证据后才可执行。主审冻结产品语义、接口、复用的 Sol 产物和 DSH 第一阶段测试；请完成实际代码，不能只输出建议。工作区为 `/home/hyh001/projects/coding-platform`（W），目标 T=`W/coding-platform/next`。旧 `coding-platform/src`、旧tests、Kernel源码与next/vendor只读。

## 先读已有真源

1. `docs/AGENTS.md`、`docs/refactor/HANDOFF.md`，并阅读 `docs/PRODUCT.md` §3/5.2、`docs/refactor/ARCHITECTURE.md` §3/6.1。
2. `docs/refactor/intent/2026-09-23-PARALLEL-AND-PRODUCT.md` §4/5、`docs/refactor/modules/core/work-graph.md` §4.0/4.1、`docs/refactor/tasks/R3c-next-task-relations-alignment-prompt.md`。用户已经纠正：Task图是协作白板和证据索引，不承担未来并行安全证明。不要复活过时的全scope/reservation前置草案。
3. T 的 `src/contracts/plan.ts`、`src/core/work-graph/tasks/plan-contracts.ts`，本批五个生产文件及只读 `plan-readers.ts`、materials/{contracts,material-service,applicability,record-readers}.ts。读真实事实来源，不因不可写而忽略它。
4. T 的 `tests/work-graph/R3c-task-relations.test.ts`、`R3c-task-inputs.test.ts`、`R3c-task-relations-boundaries.test.ts`、既有R3c测试以及 `tests/composition/R3c-R4b-platform.test.ts`。测试是行为约束，不能修改。

## 冻结行为

- Plan draft/snapshot schemaVersion 1|2 判别联合；v2才有taskRelations/inputRequirements，旧内容继续读且不改写。PlanProposal@2内嵌有版本draft；accepted event沿现有外层版本，内部snapshot有显式版本。审核修正：RecordStore只持久正文，按aggregate注册唯一codec并重建schemaId，不能同时注册两个Plan codec。本批机械schemaId固定PlanRevisionSnapshot@1（不改Store）；正文schemaVersion 1|2才是内容版本。单一codec接受两种正文、拒绝未知正文版本与外层非注册schemaId。原第一阶段outer@2测试已由主审核正，不得重新实现。不得接受v1新字段后静默丢弃。
- taskRelations只表达coordination/expected_dependency提示，允许循环；其两端必须为本Plan任务。精确inputRequirements本批只有artifact，requirementId在本Plan唯一，consumer必须存在，复用完整ArtifactRef；不造材料索引或事实库。
- 图与候选通过同一个taskRow投影；输入为not_checked；新增关系/输入按一次查询归组，避免每个Task重复遍历完整新增列表，旧executionDag/requires保留legacy_unverifiable。普通查询不得openArtifact、source capture、调用模型或扫描材料历史。去掉evaluateEligibility中前驱整个task satisfied判断，也去掉queryReadyTasks独立blockedByDeps过滤/无用邻接构造。保留真正Task/Run/Lease/Reduction canonical读和自身状态约束；缺自身phase不得默认pending，使用已冻结的 task_state_incomplete 原因。
- readTaskInput(ctx,{goalRef,planRef,taskId,requirementId})：先同步隔离调用输入和身份（保留AbortSignal），验证完整refs和scope，读取已接受Plan中的确切需求，仅打开这一项。调用已有MaterialPort.openArtifact，usage=current。不得接受调用方替换的ArtifactRef；不可将历史可读或生产task satisfied当作当前适用。不需要调用queryTaskGraph全量扫描所有任务状态才能打开已指明的输入。
- 读取复用readGoal/readPlan及已有授权函数；显式Plan是不可变引用，不暗中取最新。已接受历史Plan可作为需求pin的选择来源；current仍仅指MaterialPort对本次reader的当前适用性，不证明旧计划活跃或获准执行，不额外要求selectionPlan等于Run/currentBasis plan。跨Goal/Project/Workspace拒绝；缺失要求/任务/计划用既有ReadResult区分；旧label不能猜成exactref。MaterialPort的具体失败原样传递，缺注入unsupported。Host current source_stale是现有真实限制，不要扩大授权以做假正例。Run当前读取必须经过真实materials权限/来源链。
- 原有提案幂等、采用单事务、读取水位、旧Plan字节与既有错误语义保留；新字段从提案→接受记录→事件→重放→重启不能丢。新字段的格式错误返回类型化结果，不能throw或静默降级。

## 文件写范围及测试能力

只可修改 scope.json 精确列出的5个生产文件。共享contracts、tests、composition、runner均只读，不新增文件、不安装依赖，不stage/commit/push/reset/restore/clean/stash。若契约无法满足具体反例，汇报给主审；不要绕过测试或私造fallback。

在W运行现成固定检查：

```bash
python3 tools/dsh-refactor/check.py next-task-relations
python3 tools/dsh-refactor/check.py next-plan
python3 tools/dsh-refactor/check.py next-types
python3 tools/dsh-refactor/check.py next-architecture
```

无需新建施工说明或测试副本。完成后报告实际改动、删除的重复规则、复用的reader、测试实测结果和未支持项。主审会独立测试和审阅后才导入。
