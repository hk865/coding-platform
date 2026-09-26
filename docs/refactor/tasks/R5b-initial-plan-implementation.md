# R5b.4 正式回答到初始 Plan：第二阶段实现

状态：2026-09-26，骨架已独审冻结并精确导入，四个算法文件的窄实现范围已获主审批准，已启动第二阶段，lane `r5b-initial-plan-implementation-20260926`，session `session-f1c99e97-db59-4a71-8e2c-f9944b0673c9`，已 exit0 STOP，经独立有界验收并精确导入四算法。协议依据为 [R5b 主任务 §11](R5b-query-planning-skeleton.md#11-下一实际消费者正式回答--初始候选--采用--workflow)，骨架任务为 [R5b-initial-plan-skeleton](R5b-initial-plan-skeleton.md)，机器写范围为 [4 个生产路径](R5b-initial-plan-implementation-scope.json)。本批只完成既有正式 Answer → 同 Plan owner 候选 → 原采用 → 原 Workflow 推进；从零自然语言 Host 前段不是本批。

## 开工与冻结

先读 docs/AGENTS.md、DSH-WORKFLOW、IMPLEMENTED-CAPABILITIES 的对应 Query/Plan/Workflow 条目、主任务 §11，再读已导入源码和两条冻结正常链。只在原 owner 内完成算法；不要复制模型循环、Store、候选库、来源管理器或第二份 Plan DTO。

骨架已发布 InitialPlanningResponseV2、InitialPlanDecision/ProposalResult、有限 Workflow input/result、同 bodies 注入、公开 trackedCall 和真实参谋 Skill。PlanTaskPort 的新方法对旧只读消费者兼容可选；同一个 createPlanService 返回 PlanServicePort，真实 service/composition 方法必有，不允许以 optional 接口伪装真实消费者缺失。二阶段所有契约、测试、composition、资源及 manifest、配置、harness 只读。原 advanceWork 算法完整保留。

## 四个算法落位

1. `initial-plan.ts`：唯一纯 v2 JSON/结构 normalization。只按真实 Job intent 的 projectId/goalId/intentId 和既有 canonicalJson/SHA-256 确定 Plan 身份，planRevision=1；实际答案 UTF-8 digest、原 manifest Goal/Workspace revision、原 intent.intentId 进入现 origin。origin.assignments 来自 plan.assignments。保留 optional plan_only 的无分配/验收节点；不补 gate/依赖/验收/Role binding，不把缺项一律改成 needs_decision。needs_decision 只返回模型明确问题，不写候选、不强加人工确认。
2. `plan-service.ts`：实现 proposeInitialPlanFromAnswer，且只替换原 initial apply 中 model_coordination 的明确 unsupported。第一次 await 前隔离原 request/ctx；新请求指纹绑定完整原输入、meta 与可信调用身份，原提交回执优先恢复，不能为了恢复候选先要求当前事实仍可读/当前 Goal 尚无 Plan。复用现 propose/receipt/单次提交，可局部抽同一个共同写函数，不能另建提交算法。读取正式 Answer/Job/Run/body 与 QueryRun.executionState.prepared.bundleRef，复用同 records/materials/initialPlanning.bodies；核同 scope、initial_coordination、正式 answered/settled/observation 和其已保存历史 locator、精确正文及 prepared body owner/contentType/digest。Plan 不调用 Runtime 或重扫 Kernel 历史，也不重新要求已结束 Query 占 Session、重新准入 Role/Host。实际读事实加入原局部 CAS；不要把历史 manifest/source witness 当成当前采用额外门禁。apply 从真实回答重算完整规范 draft/origin 并精确比较，之后仍走原 resolveGovernance、validatePlanDraft/Assignments、compileInitialPlanAdoption。保留 Host 无 origin 与已有 W2 路径。
3. `workflow.ts`：替换两个初始规划分支的 stage-one unsupported，每调用只委托一个原 owner，保留完整 receipt。planning_answer 得真实候选后，按原 executeWithinRequest 决定是否形成完整 adopt_initial_plan continuation；原 flowId/sessionHint/request 固定，同 key 不刷新 pins。needs_decision/waiting 不伪装成功。adopt 成功后按本次推进授权交出现 advanceWork.select_work；不重复执行 advanceWork 或建自动控制循环。输入所指 Goal 与实际 owner 结果一致，不能错误 handoff 到另一个 Goal。原 N0 分支仍明确 unsupported。
4. `query-preparation.ts`：只对已确认 initial_coordination 把现同一 v2 guide 注入有界正式 Query 输入。沿原可信 Role/Skill/Host、原预算及只读工具交集；普通 Query/已接受 Plan 的 Work 不变，不给规划 Query 写工具授权。

缺 policy/initial architecture 时仍允许真实答复、候选及查看；采用按原 owner 报缺口。治理由公开配置补齐；不得制造空治理或新的审批步骤。历史来源版本变动、capture 关闭或已释放不自动否决候选；后续受控材料/执行检查仍在原实际消费点核验。不得加 hot-rebind 防御、内部篡改校验或异常矩阵。

## 有界验证与 STOP

冻结检查仅 `next-initial-plan` 的两个最终正常链、`next-plan` 最小邻接及独立 `next-types`；必要边界用 next-architecture（含真实 import/资源检查）。当前中审首红分别在新 Plan 入口与新 Workflow 入口，前态均已真实 Query/Kernel/provider answered；后续候选/采用/执行/完成断言在骨架阶段尚未达到。实现必须沿这些原正常链到达结尾，不能改断言、seed Answer/Run/terminal 或制造 PASS。测试里 public governance 在正式答复/候选之后设置，optional future 仍保留；原 candidate/apply 请求原样重放。

有准确接口/夹具错误先报告最小反例，不自行扩范围、改冻结测试或为了局部完备继续加测试。完成后报告真实入口、检查、四文件 hash、outside-scope 清单及未达事项并 STOP。主审独立有界验收和精确导入后再推进下一产品消费者。


## 本次 STOP 后的有界返修（原 session，2026-09-26）

只处理下列正常链和原合同问题，不扩四文件写范围，不加/改测试。第一个产品链已达 candidate/apply/graph/replay；第二个已达候选/采用/handoff，后续夹具让源根包含平台自身 SQLite/Kernel 文件，导致每次平台落盘改变 sourceDigest。主审已对照原 R5c 正常链把同一个业务测试的 workspaceRoot 与 storage directory 分开，并刷新只读测试；没有新 case 或更换领域结果。请复用这条真实链完成到 GoalPhase。

实现必须修正新 propose 的回执/CAS 边界：当前先 readInitialPlanAnswerFacts 再调用 proposePlan，故“原 proposePlan 内部 lookup 在 current Goal 前”不等于本入口回执优先；已提交请求在原正文目前无法读取时仍会错误失败。请在同一 Plan service 内窄抽原候选共同提交/回执步骤，让新入口以原完整 request（input+meta，包括 expected）和可信 actor/完整 scope 得身份指纹，先 lookup 并从原事件恢复同 candidate 原回执，再读取新操作所需来源。不要从当前 candidate 快照拼装原回执；不要先重新解析正文才查已提交请求，也不要在重复请求里更新 pins。原 Host propose/W2 保留。

新请求经原 Host/完整 workspace 绑定后才读答案；所读 Answer/Job/Run 的真实 revision 必须加入同一个候选 commit 的局部 guards，不能只在 apply 侧加 guards。仍复用同 writer/event/receipt，不新建候选 store 或第二 commit 算法。apply 的新增 model-origin 正文读取也使用该次首次 await 前隔离的 ctx，不能后来从调用者可变对象恢复材料身份；这是本次新 I/O 的输入所有权，不添加当前 Role 重读或运行中 hot-rebind。

无需新增其他防御或返回分支。修复完成只跑原 next-initial-plan + next-plan、next-types 与必要 architecture，报四 hash 后 STOP。主审独立复核同一固定集合，再精确导入。

## 实际验收结果（2026-09-26）

原两条完整正常链和原 Plan 邻接共 6 文件 10 项 PASS，独立 next-types、architecture/import PASS，audit 越界/主基线变化均为空。共同候选 writer 已完成原完整请求回执优先及来源局部 CAS；同一业务测试只分离 source root 与 SQLite/Kernel storage，未加 case。原 Session 一次返修后主审仅修完整 workspace 绑定的一参；四路径逐项核原 main 基线后导入。[实际 evidence](../reviews/evidence/next-b2-2026-09-26/r5b-initial-plan-implementation-import.json)。

已达：真实初始 Query 答复 → candidate → 原治理/采用 → Workflow 原执行/检查/完成 → 正式 GoalPhase，optional future 仍在图；未达：N0 从零自然语言/可信 Host planning 配置及 Host 自动续传，继续 R6 公共消费者接线。
