# R5c.1 已有 Plan 的 Workflow 推进：第二阶段实现

> 用户现要求新建 DSH 会话接手。旧会话因传输中断未交付；已确认并修复沙箱遮住系统 DNS 文件的问题。沿当前 lane 已落盘源码继续，不重新 prepare、不覆盖已有成果。先核当前文件与本任务必要接口，然后直接完成剩余施工，不重做全仓调查；仍严格保持本任务阶段、写范围、冻结测试和 STOP 边界。旧 Session 与 attempts 继续保留。

状态：2026-09-26，七文件骨架已中审冻结并导入，R3e.3 五文件正式完成实现已独审导入。主审现授权从最新 main 创建第二阶段 lane，仅实施以下单文件；Query execution 后续共享 composition 只读，不覆盖其新接口。

行为依据为 [主任务 §2–5](R5-workflow-advancement-skeleton.md#2-有限接口与原请求-continuation)和 [Workflow §11](../modules/business/workflow.md#11-r5c1-候选已有正式-plan-的首条推进闭环2026-09-26)。沿已冻结的十种 owner 请求及原回执推进，不扩架构、产品范围或测试矩阵。

## 唯一写范围

[scope](R5-workflow-advancement-implementation-scope.json)仅授权：

- `coding-platform/next/src/business/workflow/workflow.ts`。

实现 `createWorkflow().advanceWork`；原 `handleGoalInput` 保持已有 unsupported 行为。contracts.ts、ports.ts、index.ts、composition/create-platform.ts、所有 tests/fixtures、WorkGraph、AgentRuntime、Workspace、RecordStore、Kernel 与原工程均只读。不新增文件、数据库、manager、持久 continuation 或私有循环；接口若有真实不可施工缺口，交主审决定，不能扩大 scope 或改测试迁就实现。

## 必须复用的真实接缝

冻结 `WorkflowDependencies` 已提供同一套 raw owner：tasks/plans/sessions/claims/executions/runtime/evidence/checks/sourceAuthority 和可选可信 configuration。composition 既有 rawRuntime 仅把原 runtime.port 与 Session operations/history readers 合并；公开 Workflow 调用由原 trackedCall 排空。业务不读 Store，不创建第二 Runtime/Kernel，不再绕 public tracked wrappers，不自建后台工作。

1. `select_work` 只读正式 queryGoal/TaskGraph，依主任务优先 required 及 Plan 顺序，复用现 eligibility/effectivePhase。只选 active work 的可执行节点，不把 required plan_only 转成工作、不 claim goal gate、不另启 Query。无正式 Plan/缺配置/缺真实依据返回原缺口；正式 GoalPhase 才能判 completed。
2. 可信配置仅选择 workspace/template 对应的明确 sessionRole/roleBinding/budget 与 consumerId；权限仍归原 owner。Session hint 及目录分页复用，相关 busy Session 不以新建绕过；无可用候选才 createSession。Goal/Workspace/Session pin 来自真实读/创建回执；Workspace 复用 sourceAuthority.load，不能直接把 ReadyTask 的 Goal+Plan expected 当成 claim 所需 pins。
3. `perform` 用十种有限 switch 调一次原 owner，保留其完整 result。首 await 前隔离 ctx 纯字段和输入、保留 signal。原请求优先调用 owner 恢复回执，不能先用当前选择/配置再审拒绝重放。操作未明确成功则 waiting，无后台重发；accepted Session 创建、未知执行/检查和非正常终态不伪装完成。
4. 下一完整请求的 `wf:` identity 复用 canonicalJson/sha256Hex，绑定 schemaVersion/flowId/真实 actor/Goal/kind/完整 requestWithoutRequestId（含实际 expected）。Runtime 顶层 requestId、GraphWrite meta.requestId、Session 自有 meta 沿原 DTO。Host 原样重发 perform；不刷新同 identity 的 expected、不重选 Task、不重置已有 Run 预算。
5. claim→prepare→start/observe 沿既有 B2 owner；只消费真实正常 ended/completed 执行。prepare 不能自造 Prepared/Kernel 身份。后继 openVerification→按正式 round.checks 顺序 runRegisteredCheck→finalizeChecks，读取实际 Round revision；executing/unknown 不 rerun，finished 不重复执行。真实 ProcessSandbox 必须沿 checks owner，无无隔离 shell fallback；Workflow 不直接运行命令，不 seed PASS、sourceProof 或自造 Evidence。
6. finalize 后以原 FinalizedChecks/TaskReduction pin 提交 completeTask；owner 继续裁决材料/source/current policy/reviewer。普通 work 完成回到 select_work 并带原 Session hint，第二 work 沿真实 Session 新 Turn。不能用宽目标 capability false 否认已有 B2 历史连续性，也不新增 resume API。
7. goal gate 独立 subject/round/evidence，复用同 Goal 已正常结束的普通 Run 作 producer；不 claim gate、不制造 gate Run。completeTask 完成 gate 后才 completeGoal；required future/reviewer 真缺口保留 incomplete/waiting，optional future 留在图。正式 COMPLETED 后结束该 Goal，无同 Goal 新任务。

首批无失败重排、自动返工、冷启动丢失原请求/轮次后的自动恢复、Query 调查或 UI 接线。不复制核心完成 fold，不增加 Evidence supersession；这些边界依主任务保持明确。

## 已冻结测试与验收

固定 `next-workflow-advancement`：2 文件、3 条最终行为测试；以及 `next-types`、`next-architecture`。不扩大异常矩阵或全量 Kernel 检查。

中审只修正 composition 测试一处真实前态：源码 workspaceRoot 与 SQLite/Kernel 持久目录分离，避免 whole-source capture 把检查自己的数据库写入误算源码变化；用例、断言和生产接口不变。两条业务测试覆盖真实 Plan/Session 的选择→claim 原请求 replay→prepare continuation，以及 required plan_only waiting；平台测试沿公开 bootstrap、真实 SQLite/Kernel、两 work 复用 Session 新 Turn、真实注册检查与独立 gate，直到正式 Goal 完成。

阶段一三个首红均为第一次 advanceWork 的显式 unsupported，后面的执行/检查/完成断言尚未到达，不能宣称通过。第二阶段正常平台全链依赖 R3e.3 完成 producer 实现；由 root 在 fresh snapshot 前协调导入。若该 owner 尚 unsupported，应报告准确阻塞及真实到达位置，不改 fixture 造 completed，也不将预期 unsupported 改成绿测。

交付唯一生产文件 hash、固定检查结果和实际达到的正常链，完成后 STOP 供主审导入。不得自行 merge、派发其它批次或更新完成能力声明。

## 2026-09-26 本次独审后的唯一返修

沿原 session-e3afb465-48be-42a5-afe2-4ddbef3b8d97、同 lane、同一个 workflow.ts 继续；不要重新调查全仓。原 578 行实现保留，只修下面三处真实现有契约，不加新文件/新测试/异常矩阵。

1. performStep 不在调用原 owner 前一律要求 Workflow configuration。原 perform 输入先调用 owner并保留完整 receipt；只有成功后继真正需要 trusted binding 或 consumerId 时才检查配置。缺配置/后继事实读取失败时返回 waiting + 原 receipt + next=null，不丢已提交事实。select_work 仍需要真实配置。
2. open_checks/run_check 得到的 Round 只要有 executing/interrupted 检查，停止自动推进并保留 receipt（waiting、next=null）；不能跳过未知检查去跑后面的 pending 或提前 finalize。原 pending 顺序/finished复用不变。
3. select_work 在还有 required 普通 work 未满足时保留真实缺项，不先安排 Goal gate；包含 required plan_only。普通 work 全部满足后才用已结束普通 Run 给独立 gate 生产证据，不制造 gate Run。

主审已修只读平台测试两处无效 Host 前态：template digest 按实际静态指导计算 sha256，Skill 根指向现成 frozen Kernel 资源。没有修改断言/用例，也不放宽生产校验。此版已刷新到 lane，SHA 743012174fb194bf23705cdc75f45ca95f5a409448a2f7ae953942742d3095ad。

仅跑 next-workflow-advancement（原3项）与 next-types，两者分开调用。交付唯一生产hash和真实全链结果后 STOP；本次不以其他可选覆盖继续迭代。
