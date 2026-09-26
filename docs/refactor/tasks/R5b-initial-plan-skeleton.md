# R5b.4 正式回答到初始 Plan：第一阶段骨架

状态：2026-09-26，**Query execution 与 Workflow advanceWork 实现已独审导入；3 个占位和 next-initial-plan selector 已就绪，已从最终 main fresh prepare 并启动第一阶段：lane `r5b-initial-plan-skeleton-20260926`，session `session-7c0cb8f2-6261-4566-93f1-ceb732a1d4c9`；已 exit0 STOP，经主审中审、冻结并精确导入**。唯一协议依据为 [R5b 主任务 §11](R5b-query-planning-skeleton.md#11-下一实际消费者正式回答--初始候选--采用--workflow)，机器范围为 [10 生产＋2 测试 scope](R5b-initial-plan-skeleton-scope.json)。本文件只安排第一阶段接口、依赖装配和最终正常行为测试；明确 unsupported 后 STOP，由主审审核冻结后另行授权实现。

## 1. 精确开工前置

1. R5b Query execution **实现**已独审导入：公开无 Plan Goal → 正式 Query/Session claim → 原 Kernel 执行 → 已持久 Answer/Job/Run、settled/observation 与原历史 locator 可读；prepared manifest/body owner、正式 answer reader 与 codecs 均以合入后的真实符号为准。pending pair 或骨架存在不满足此前置。
2. R5c.1 Workflow advanceWork **实现**已独审导入，真实已有 Plan 的执行/检查/Task/Goal 完成链已可达；R3e.3 正式完成实现也在该 main。handleGoalInput 原 N0 缺口保持明确，不以本批代替尚未接通的从零输入前段。
3. 主审在两批导入后重新准备 fresh lane，核对共享 `query-preparation.ts`、Workflow 三文件与 `create-platform.ts` 的最终接口及 hash；不得从旧 lane 覆盖它们。只在此时按 scope 准备一个新生产文件及两个测试文件，并登记本批固定检查入口。文档准备本身不创建占位、不派 DSH。

R6 Session/mailbox 只写 app/UI，可以并行；Query execution 或 Workflow 实现仍在写本 scope 时不派本批。待导入后若符号有微调，只沿既定 §11 语义适配；如缺实际 producer，报准确接口/事实缺口给主审，不 seed 状态或扩大范围。

## 2. 第一阶段交付与复用

发布 §11 的 `InitialPlanningResponseV2`、`InitialPlanDecision`、`InitialPlanProposalResult`、`PlanTaskPort.proposeInitialPlanFromAnswer`，以及现 Workflow.handleGoalInput 的两个窄判别输入/result。DTO 直接引用既有 Plan、GraphWrite、Query refs 与 owner return types，不声明影子版本。返回 needs_decision 只表示原回答中的明确问题，不写候选，也不把人工确认变成每次采用的前置。

`initial-plan.ts` 声明唯一 normalization 与窄事实读取接缝，运行依赖单向。新算法入口显式 unsupported，**本阶段不实现** JSON → Plan 转换、来源批准、proposal/apply 事务、Workflow 续传或 Query guide 注入；允许完成可编译类型、依赖透传和说明 Skill 协议。新 `initial_coordination` guide 的调用接缝可声明，但普通 Query、已采用 Plan 的 W2 tools、原 Host 无 origin 的 propose/apply 及已有 advanceWork 行为保持。

Plan writer 仍是现 plan-service；新适配最终复用原 propose/receipt、resolveGovernance、validatePlanDraft/Assignments、compileInitialPlanAdoption。只窄增 `initialPlanning:{bodies:Pick<RawArtifactStorePort,'read'>}`；records/materials 与组合根已持有的 bodies 全部复用同实例，不引入 Runtime port、Kernel Store、source provider、SourceApplicabilityPort、第二 Plan owner 或候选库。缺可选依赖只使新 model-origin 消费明确不可用。公开新方法沿现 trackedCall，原 close/在途步骤排空保持。

正式答复身份来自实际 Answer/Job/Run/正文 digest、Query 已持久 settled/observation 事实及原历史 locator。Plan 不直接调用 Runtime 重扫 Kernel 历史；原 Query producer 负责确认实际执行与正文来源。原 manifest 的 Goal/Workspace pin 只填 origin provenance，历史 capture/source witness 不变成采用时全量当前性门槛。实际消费记录的版本进入现局部 CAS，权限与治理仍由原 owner 决定；已提交回执先恢复。schema v2 的 optional plan_only 可以无 assignment/验收，parser 不补 gate/分配/依赖或虚构 Role binding。

更新已有参谋 Skill，描述同一 v2 初始只读回复协议及已有 Plan 的 future tools 分工；不改秘书/书记，不据自然语言关键词切换角色。Query preparation 的响应 guide 仅适用于正式 initial_coordination，使用原可信 Role/Skill/Host 配置，不添加写工具授权。Host 缺模型/预算/Role 配置的真实情况另由 R6 接线解决，本批不迁旧 app/model-settings 或开新的 model loop。

## 3. 两条最终正常产品链

只使用 scope 内两个新文件，每文件一条完整正常链；复用既有真实 backend/Host/Kernel/受控 provider 的组件和公开 bootstrap，不修改或复制通用夹具，不增加异常/并发/篡改矩阵。模型答复必须经正式 Query owner 保存，禁止 seed Answer/Job/Run、伪造 settled/observation 或内部 terminal writer 直接写成功。

1. `tests/work-graph/R5b-initial-plan.test.ts`：空 SQLite 经公开 Project/Workspace/Goal（起初无 Plan、policy、baseline）→ initial_coordination Query → 真 Kernel/受控 provider 的 v2 plan 回答；模型实际使用源码工具时保留真实 witness。调用新 proposeInitialPlanFromAnswer 得到同 Plan owner 的 candidate_v2，核 origin 完整身份/digest/原 manifest pin、同一 draft 中 optional plan_only 保留且无分配/验收，不提前成为已采用或可执行。候选可在缺治理时读取；随后经原公开入口补齐实际初始架构与 CompletionPolicy，按当前 caller pins 调原 apply，再 queryTaskGraph 看见正式普通 work/gate 与 optional future。计划结构及工作要求来自该真实答复和现 validator，不因历史 source 版本或已释放 capture 自动要求再跑 Query。原候选/采用请求的回执重放在同链内复用原 request；不另建去重测试矩阵。
2. `tests/business/R5b-initial-planning-workflow.test.ts`：公开创建相同性质的无 Plan Goal，真实 initial_coordination 答复 → handleGoalInput(planning_answer) 得到候选及完整采用 continuation → 在原公开治理配置可用后，handleGoalInput(adopt_initial_plan) 返回现 advanceWork.select_work；每调用只委托一个 owner，固定原 flowId/sessionHint/request。沿已验收 advanceWork 的真实 Work Run → registered check → finalize → completeTask → 独立 Goal gate → completeGoal 链推进，核正式 GoalPhase 完成而 optional future 仍在图。Role/预算/Skill 由真实可信配置提供，检查结果来自实际 ProcessSandbox，不制造 PASS、假 terminal 或假控制 ack。首个新增入口 unsupported 后未到达的后半段如实记为未达。

已有 Query 正常回答测试与 Workflow 完成链负责它们自己的边界；本批只补消费者身份和 handoff 断言，不重复其历史/权限/预算矩阵。needs_decision、缺治理和 required reviewer/future 的语义按 §11 保持；不为每个分支另加用例，已有 owner 结果不得被新适配伪装成完成。资源 finally 有界清理，测试只用受控本地 provider，不读取开发者凭据或真实联网模型。

## 4. 精确写范围与交付

10 个生产路径与主任务 §11.6 一致：initial-planning contract、Plan contract、新 initial-plan、原 Plan service、Workflow contracts/ports/implementation、同 composition、Query preparation、既有参谋 Skill。只增加上述两个正常链测试，**合计 12 路径，新增 3 文件**。所有 Query producer/observer、RecordStore/材料/Source/Session/Role owners、其他 Runtime、Kernel/vendor/build、app/UI、其他测试及 harness 只读。

`next/runtime-assets.json` 已锁定本 scope 的 `resources/skills/platform-adviser/content.md`。该 manifest 保持主审集成所有权，DSH 全程只读，scope 仍恰好 12 路径。中审冻结参谋 Skill 内容后，主审只更新该资源条目的 SHA-256，将更新后的 runtime-assets.json 刷新到 lane 的只读 manifest，并同步其只读 snapshotHashes；不改 originalAllowedHashes 或其他冻结写入基线。随后主审运行 architecture 边界与 import 检查，通过后集成；不重新生成整个资源表或让 DSH 扩权改锁定文件。本阶段 DSH 只按 scope 修改参谋 Skill；资源 SHA 与 manifest 实际值仍由主审在中审冻结后单项更新。

阶段一只跑本批两个目标文件、next-types 和受本次接口接线影响的既有 next-plan 最小邻接；主审在上述资源 SHA 同步后完成 architecture/import 边界验证。冻结前若旧资源 SHA 不匹配，DSH 如实报告该确定原因、内容 hash 与其余检查结果，不能改 manifest 消除失败，也不能用这个预期过渡状态略过最终验证。不重跑全矩阵或 Kernel 构建。若固定 selector 尚未登记，主审在 prepare 前登记 `next-initial-plan`，仅映射此两路径；DSH 不编辑 check.py。目标应在明确的新 unsupported 点红，类型及既有正常 Plan 行为应绿；由主审中审后冻结测试/接口再进入实现。

交付实际文件 hash、outside-scope 清单、检查结果及每条正常链首红/未达步骤，随后 **STOP**。不以测试覆盖更完整为理由扩 scope 或增加第三轮准备。该批完成只说明正式答复消费和采用后 handoff；从零自然语言入口、可信 CLI/runtime 配置和 Host 自动续传仍按 R6 的真实消费者接线继续，不将设计稿写成现成 E2E 能力。

## 本次中审结论（2026-09-26）

12 路径已逐一核对原 main 基线后导入；仅 adviser 资源条目的 SHA 同步。两条真实 Query 前态成立，新 Plan 与 Workflow 入口各在显式 unsupported 首红；原 Plan 8 项、next-types、architecture/import 均通过。新分支提前实现的 Workflow 续传已收回 unsupported，原 advanceWork 保留；身份说明遵循 saved Job project/goal/intentId，两个固定正常链已保存原 candidate/apply 请求及答复后治理前态，无新增 case。记录见 [import evidence](../reviews/evidence/next-b2-2026-09-26/r5b-initial-plan-skeleton-import.json)。

四个算法文件的 [第二阶段](R5b-initial-plan-implementation.md)已获主审批准；契约、两测试、composition、Skill/manifest 冻结只读。骨架导入不代表候选/采用/新 Workflow 完成链已运行。
