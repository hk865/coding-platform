# next R3c 任务关系与精确输入验收（2026-09-24）

**本批已独立验收：57 个测试文件、383 项全部通过，类型、构建、模块边界和构建入口加载通过。完整 R3c / R4c / R4p 尚未完成。** 前序是 [R4c 连续历史转发子集](next-r4c-continuity-2026-09-24.md)。

## 交付行为

任务图现在明确分开三种信息：可循环的白板关系、具体 ArtifactRef 输入需求，以及由 Plan/Run/TaskLease/TaskReduction 得到的任务实际状态。关系用于提示；候选不再因为前驱整个 Task 尚未完成而被排除。自身状态和占用检查继续保留，缺少 canonical phase 不能默认 pending。

Plan 正文新增 schemaVersion 2，旧正文版本 1 继续读取，不重写历史。v2 保存 `taskRelations` 和 `inputRequirements`，经提案、采用、事件、幂等重放及 SQLite 重启保持。关系端点和输入消费者必须存在，需求 ID 在 Plan 内唯一。旧 executionDag/requires 原样保留并标 `legacy_unverifiable`，不能根据 label 猜测精确材料。

普通图/候选查询只投影关系与 `not_checked` 输入，不调用材料读取、不增加捕获或模型调用。新增关系和输入每次查询只归组一次。删除 `evaluateEligibility` 与 `queryReadyTasks` 两处前驱整项完成判断，以及无用邻接构造；没有新增图系统或 Store 抽象。

唯一新增读取入口：

```text
plans.readTaskInput(ctx, {goalRef, planRef, taskId, requirementId})
  → 固定调用身份、输入及原取消信号
  → 读取并绑定已接受的 Goal / Plan / 需求
  → materials.openArtifact(exactRef, usage=current)
  → 返回真实当前材料或原有失败原因
```

调用方不能替换 Plan 中选定的 ArtifactRef；一次只打开明确请求的输入。任务自身不是候选时仍可按材料权限读取。历史 Plan 只负责定位需求，材料的当前适用性由本次 reader/Run/grant/source 决定，不额外要求历史 Plan 等于 reader 的当前 Plan，也不产生派发授权。

组合根已注入真实 materials，并把新增异步读取纳入 close 排空。Host 当前材料仍因缺少可信来源 pin 返回 `source_stale`，没有为正例扩大授权。正例使用真实 Memory/SQLite、材料正文、Run/Grant、来源捕获；测试中的已受理事实夹具不代表 TaskClaim 或授权计划变更已实现。

## 两次审核及实际 DSH 执行

本批采用用户最新时序：**Astra 架构/接口 → DSH 4.1F 骨架/测试 → Astra 审核冻结 → DSH 实现 → Astra 审阅 → isolated test**。先前已产出的 Sol 契约和测试复用，不为换分工重写。

- 第一阶段 DSH 在 `next-r3c-relations-skeleton-20260924` 只补批准的测试文件，然后停止。主审发现原版本断言与真实 Store 不符：Store 按 aggregate 注册唯一 codec，不持久化独立 schemaId。因此采用稳定机械 `PlanRevisionSnapshot@1` 加显式正文版本 1/2；不为测试扩 Store。另修正真实 schema 夹具、候选预期和跨 Goal/Host 反例，记录[中间审核](evidence/next-r3c-relations-2026-09-24/skeleton-review.md)。冻结红测 12 项中 9 失败、3 通过，失败对应缺失行为。
- 审核后新建实现 lane `next-r3c-relations-implementation-20260924`，仅开放五个生产文件；接口、测试、Store、Kernel 和组合根只读。复用同一 DSH Session `session-793152ca-22bb-4af3-bb57-17212884ac19`。本机配置核对为 `deepseek-flash`，本地 provider 目录名称为 `DeepSeek-V41-Flash`，未改全局配置。
- 实现第一次调用只读取后结束，没有代码产出，不计完成；沿同一 Session 继续。第一版自检通过后，独立审阅发现身份在 await 期间可被替换、null 请求抛异常及精确输入 source 校验不全。主审增强原测试，复现 4 失败/8 通过；同 Session 返修，使用既有 `isArtifactRef`，未增加第二份校验。
- 返修经另一轮 Astra 只读审阅、主审增强反例和范围核验后导入。DSH 两阶段都无越界修改，主目录未被直接修改。最终在物理复制的 next 中独立构建/测试；副本没有旧平台源码，只链接已安装的第三方包。

骨架和测试由 DSH 编写不等于独立验收。主审审核标准本身、补反例、独立运行，并在有具体问题时修订冻结内容；[修订与重新冻结记录](evidence/next-r3c-relations-2026-09-24/implementation-review-repair.md)保留了两版哈希。执行方式统一在 [DSH-WORKFLOW](../DSH-WORKFLOW.md) 和 [Harness](../DSH-EXECUTION-HARNESS.md)，不另造重复施工规范。

## 验证、规模与剩余工作

| 检查 | 独立实测 |
| --- | --- |
| R3c 关系/输入/任务事实及真实组合根 | 6 文件 / 12 项通过，含 Memory/SQLite、幂等、重启、来源失效、撤权、跨 Goal、身份快照、不提权、取消及历史 Plan 输入 |
| 物理隔离全套 | 57 文件 / 383 项通过，0 失败、0 跳过 |
| 类型 / 构建 / 编译入口 / 边界 | 全部通过，5 模块、5 实际 / 8 允许依赖 |
| 旧 src / tests / Kernel src | 1313 文件，0 修改、0 缺失、0 新增 |
| next 生产 TypeScript | 144 文件 / 23,300 物理行，比前序增加 271 行 |
| 其中共享 contracts | 56 文件 / 3,762 行，增加 29 行 |
| 测试 TypeScript，含 fixture/helper | 59 文件 / 11,657 行，增加 3 文件 / 727 行；另有既存 mjs 辅助文件 34 行 |

本批消除了两个重复门槛并复用了材料校验，但增加了实际输入功能、版本兼容和测试，**没有实现总代码行数下降**。没有测端到端延迟或费用，不将局部扫描减少推导为整体提速。任务自身查找等既有查询开销仍存在，本批不宣称整个查询链已线性化。

后续可沿 R4c 的 Task 唯一 Session 占用、真实执行和观察回流继续，再闭合 Query、控制/恢复/维护。不得在 claim 时遍历所有未来输入或恢复预测范围的统一启动门槛。R3c 授权 delta、R3d 正式架构采用、R3e/f、R3g 记忆、R5 Workflow、R6 UI/旧目录最终退役仍有工作。

用户粘贴的架构图复用讨论方向合理，具体边界已写入 [WorkGraph §4.0](../modules/core/work-graph.md#40-执行前后静态分析的实现复用2026-09-24)：同文件双改不等于冲突，未分析不等于无影响，相同 HEAD 不证明脏工作区共同基线，先后捕获不等于独立分支。R4p 复用 Workspace diff 和 observed 图；跨 worktree 的共同基线、ChangeSet 整合与三方合并尚未交付，本批未假造这些接口。

证据：[最终隔离](evidence/next-r3c-relations-2026-09-24/isolated-verification.log)、[主审专项](evidence/next-r3c-relations-2026-09-24/candidate-accepted.log)、[独立反例红测](evidence/next-r3c-relations-2026-09-24/independent-review-red.log)、[终审](evidence/next-r3c-relations-2026-09-24/astra-source-review.md)、[范围](evidence/next-r3c-relations-2026-09-24/scope-result.json)、[导入](evidence/next-r3c-relations-2026-09-24/import-review.json)、[规模与保护](evidence/next-r3c-relations-2026-09-24/metrics-and-protection.json)、[受验文件](evidence/next-r3c-relations-2026-09-24/verified-target-files.json)。施工自报另存同目录，不替代独立结果。
