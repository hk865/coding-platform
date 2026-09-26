# R3c next：计划采用与任务读取骨架（本轮初始计划切片已冻结）

状态：本轮初始采用与任务事实读取切片已独立验收（2026-09-24），见[本轮报告](../reviews/next-r3c-r4b-2026-09-24.md)。施工根为 `coding-platform/next`；旧 `coding-platform/src`、`tests` 只读参考。R3c 材料 reader/index 子项已独立验收，本任务不重做。本文只界定本轮可交付的计划与任务切片，不将整个 R3c 标记完成。

## 1. 输入、输出与状态归属

- 公开入口沿目标 `TaskPort`：`proposePlan` 输入 GoalRef、basedOn、PlanRevisionDraft、ChangeReason 和可信 CoreCallContext/CommandMeta，返回持久候选；`applyPlanChange` 输入候选 Ref/期望版本与决定引用，返回不可变 PlanRevisionSnapshot；`queryTaskGraph` 输入 GoalRef/可选 PlanRevisionRef，返回定义、当前归约、依赖和来源游标；`queryReadyTasks` 输入 GoalRef、角色过滤、阻塞显示和有界页，返回携带精确版本条件的 ReadyTask。
- WorkGraph 唯一拥有 Goal 活动计划指针、候选状态、计划受理、正式任务关系和资格判据。PlanRevision 是 revision=1 的不可变快照，`planRevision` 业务序号单独递进；运行变化不回写该快照。候选不是第二个活动计划。PlanProposal 沿用旧 `{projectId, workspaceId, proposalId}` 完整身份，v2 编码同一聚合类型，reader 兼容旧 v1；不建另一个候选聚合。旧 v1 只有 patch、没有完整 draft，读取时以判别视图保留 `draft=null` 与原 snapshot，不能伪造完整新草稿。Store 只拥有物理记录、CAS、唯一槽、幂等和候选查找，不判断任务是否合法。
- 此切片的资格读只解释当前正式记录。`claimTask`、Session 占用、Run/Attempt/证据完成属于后续真实前置；未接入这些事实时，不能把任务报告为可正式领取，也不能把本批称为完整任务资格或完成归约。查询 DTO 对无运行记录保留明确空值与来源缺口。

## 2. 原子操作与拒绝

1. 复制并验证调用者输入；绑定真实 project/workspace/actor，验证 caller pins 的结构。标准化请求后构造 `project + actor + requestId` 的身份键与领域指纹。同身份同内容从原事件/回执重放，同身份不同内容拒绝。重放不读当前 Goal 拼造旧结果。
2. 提案只持久候选及其 basedOn、草稿、原因和问题；不能更新 Goal.activePlanRevision。应用先读取 Goal、候选、当前计划、有效政策/正式架构引用、适用决定及受影响的运行/证据事实；旧初始路径可用 `basedOn=null`，变更路径须验证真实接受决定。所有计划义务、依赖 DAG、成员、运行项保留/取代、来源适用性使用原产品规则。
3. 应用在一个 `PreparedCommit` 中 CAS Goal 版本、候选版本、旧活动 Plan 与全部会影响判据的成员/治理记录，写新 PlanRevision、Goal 指针、候选状态和原事件。新 PlanRef 使用完整 project/planId；旧计划只读。物理协议增加保守的 `ledgerHorizon`，保护范围内新增事实所造成的 phantom；任何在范围成员增加或治理变化后失效的 read-set 必须冲突，不能据提交前查询结果继续采用。计划变更沿用旧受限 delta 与已接受的 UserDecision 目标绑定，不能把任意全量 Draft 与非空 decisionRefs 当授权。
4. 空计划、义务缺失、悬空任务/前驱、执行 DAG 环、非法旧运行项替换、拒绝/未受理决定、跨项目/工作区、失效来源和版本冲突均零写拒绝，保留细分理由。数据库失败不返回成功；成功提交后客户端取消仍可凭请求身份取原回执。

## 3. 查询和索引

- 任务读从唯一活动 Plan 指针与不可变 Plan 加载正式定义；历史 PlanRef 明确读历史。按邻接与未满足前驱解释依赖；显示投影可有水位，但正式资格必须重新核对 Goal/Plan、实际执行与版本，不信任滞后索引。`TaskRow.definition.phase` 保留原始计划值，`effectivePhase` 来自正式归约；`eligibilityScope='task_state'` 明确这是任务状态候选，R4c 领取再添加真实预算、角色、Session 和资源准入。查询不会伪造预算或产生启动许可。
- 候选 lookup/index 只返回候选键；WorkGraph 必须复读 canonical 记录并复核 scope 和状态。首版单 Goal Plan 图可有界 DAG 遍历，不做全库扫描，也不声称有同步 ready 索引。页游标绑定 scope、过滤条件、来源版本、读取权限；稳定水位不足返回 `not_ready`，跨页变化拒绝或重查，不能以空页当“无任务”。
- 后续计划采用时增量维护 taskById、正反依赖、未满足前驱/同步就绪；范围内成员增加必须使旧查询/领取条件冲突。提交事务内维护需要 Store 的索引 CAS/变化协议，不能以当前只读 lookup 伪造同步索引。

## 4. 真实前置与最小骨架

当前 `next/src/contracts/plan.ts` 只有 Task 基础字段和 PlanRevisionRef，缺 Draft/Snapshot/事件/校验；`record-store/ports.ts` 的 `PreparedCommit.claims/indexGuards/indexChanges` 为只接受空元组，只有 Goal 家族写 schema。R3c 不能在这些缺口上声称原子计划采用或同步就绪索引已经可运行。主审负责共享契约与 Store `ledgerHorizon` 扩展；本 Sol lane 新增 `work-graph/tasks/` 专用端口和显式 `unsupported` 骨架，不改已通过的 Goal/Store/材料实现。生产工厂最终注册 Plan/Proposal schema，并在同一个 Store/Goal 服务实例上暴露 TaskPort；不得新造假服务或从旧 `src` 注入。

独立测试放 `next/tests/work-graph/R3c-*.test.ts`，使用 `createTargetPlatform` 的真实 Memory 和临时 SQLite 两后端，经真实 Goal 创建入口、正式计划入口、重启与重放检验。可由测试环境建立已受理 Project/Workspace 前置，但不借旧测试 harness/fake Goal 服务。至少覆盖：初始/变更受理、并行独立任务与环、旧运行项变更、范围成员并发变化、候选决定拒绝、同键重放/不同体冲突、历史计划不可变、索引分页水位与正式资格对账。对于尚无执行/证据/Session 入口的反例，测试应明确预期 `unsupported`/`not_ready`，待真实提供者接线后升级，不能用夹具通过来宣告功能完成。

## 5. 验收边界

先冻结接口和失败形状，再由 DSH 实现，主 Agent 用隔离 next 构建、Memory/SQLite、真实平台工厂及上述行为独立验收。通过本轮仅关闭已真实接通的子能力；R4c 的 claim/start、R3e 的证据/完成、任务 UI 与旧消费者清零仍各自验收。

## 6. 主审冻结与分批界限（2026-09-24）
共享 Draft/Snapshot/结构校验及 TaskEligibility 已迁入，Store 的 ledgerHorizon/claims/binding 协议已冻结并交另一 lane 实现。本文旧“当前缺失”描述为开始骨架时的观察，不覆盖此进度。
本轮先交付初始计划 v2 候选/受理与六方法真实读取、计划状态候选查询。v2 full draft 不包含旧 patch 的受限 delta 与 target digest，因而**不能**把 decisionRefs 非空当作变更授权。本轮变更可持久候选，但 apply 变更必须明确拒绝，缺受理决定用 forbidden/incomplete，未实现的已授权 delta 编译用 unsupported；后续单独冻结有授权绑定的变更协议并关闭 R3c 剩余。legacy v1 必须可按判别 union 读取，不伪造 draft。整体 R3c 未关闭。
构建单 Goal adjacency 一次，执行/归约/lease 使用同 Goal/Plan registered lookup 分页与批量复读，不每 Task 反复扫表。未接入必要事实时 fail closed；初始无运行任务可以作为 task_state 候选，不需要伪造预算或假装已获派发授权。正式治理内容 digest 需要复核规范 fixture hash。schema 自带严格校验；注册组合由主 Agent负责，不在实现文件依赖旧服务。
本切片验收用真实 Backend+Goal+Plan工厂，之后主 Agent另加 createTargetPlatform 装配验收；独立用例文件不能改动。
