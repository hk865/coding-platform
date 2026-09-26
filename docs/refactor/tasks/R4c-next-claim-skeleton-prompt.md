# R4c.1 第一阶段：原子 Task 领取骨架和测试，交付后停止

W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。
顺序：Astra 架构/接口 → DSH 4.1F 骨架/测试 → Astra 审核冻结 → 第二次 DSH 实现 → Astra 审阅 → 物理隔离验收。**本次只做骨架和行为测试，不得实现生产算法。** 用户要求复用已有功能，宽读窄写；不新建重复施工包/数据引擎/ConflictGraph。

阅读现有真源（按相关章节，勿全量加载历史）：
- docs/PRODUCT.md §5.2；docs/refactor/ARCHITECTURE.md §6.1；docs/refactor/modules/core/work-graph.md §4.1/§5/§6；docs/refactor/intent/2026-09-23-PARALLEL-AND-PRODUCT.md §4/5；DSH-WORKFLOW.md、HANDOFF.md。
- 下述冻结设计覆盖模块页已标撤回的旧 scope/reservationRef 必填草案。
- T/src/core/work-graph/tasks/claim-contracts.ts、configuration/contracts.ts 是Astra冻结契约。
- 复用源码 tasks/{plan-readers,eligibility,plan-service}.ts、sessions/{session-directory,session-record-codecs}.ts、configuration/role-memory-service.ts、materials/record-readers.ts、record-store/{ports,lookup-ports,in-memory-record-store,sqlite-record-store}.ts、composition/create-platform.ts。
- 行为参考 T/tests/work-graph/{R3c-canonical-task-state,R4b-session-directory,R3g-role-spec}.test.ts 与 tests/composition/R3c-R4b-platform.test.ts；尽量复用已有fixture，不拷贝整个套件。

## 冻结设计

本批只交付 TaskClaimPort.claimTask/readTaskClaim 与目标装配。不是完整R4c：不启动Kernel、不释放/过期租约、不做Query claim、授权/prepare/entry、事件结束归约。不宣称已可执行任务。

1. claimTask 的输入与结果见claim-contracts。只允许可信Host human/system上下文，ctx与materialReader的project/workspace/actor全部相符。同步隔离request和ctx可变字段（保留原AbortSignal），每次真正提交前再检查cancel。meta.expected恰为Goal/Workspace/Session三项当前版本，不重复/跨scope/多余。Plan已接受、是Goal当前pin且Task存在，Goal active，task_kind work/disposition active，预算正安全整数且deadline合法未过期。
2. 先验证及查原命令幂等结果；重放用原事件恢复immutable TaskClaim，不从当下Session状态构造，不重新生成ID/时钟，不重新占用。identity包含可信actor/project/workspace+requestId；fingerprint包括语义输入及expected，排除动态时钟。异内容同identity为idempotency_conflict。
3. canonical state必须复用readCanonicalTaskFacts的同一fold与evaluateEligibility。实现阶段给reader增加可选taskId定向读取，注册Run by project/goal/task精确索引，只读本Task的Run/Lease/Reduction。不得整Goal扫描/所有Task guards/使用全局ledgerHorizon提交。本批没有重新排队协议，任何已有本Task Run（包括ended无lease）都不能偷偷当首次领取。缺索引/事实不完整不能解释成pending/free。TaskLease absent CAS封闭首次Run phantom；所有后续合法写者必须原子更新该TaskLease，禁止绕开。
4. Session必须有实际Kernel映射、active且health available、occupancy null，workspace匹配。复用SessionRecord codec；本次generation=Session新revision。它防同Session Task/Query/maintenance竞争，不锁整个workspace。TaskLease absent CAS + Session revision CAS已经够，不再建立重复Task/Session unique slot。
5. 复用当前角色解析器，通过内部resolveRoleBindingFacts返回同一解析结果+精确RecordGuard[]（每次重试只保留成功读窗口的guards）。guard policy active、policy revision、role active、spec；no-matrix确证缺失也guard。公开resolveRoleBinding不变。角色必须匹配Task assignment与Session配置：legacy模板同ID/revision；role_spec匹配resolved exact pin（含digest，使用已读spec内容）。resolved/inadmissible/absent语义沿用；role_spec不接受absent；legacy仅在无matrix且实际Session配置同模板时可接受。这里只检查角色身份，declaredPermissions为空并不授予工具权限，真实entry重核权限/所需材料。
6. 同一PreparedCommit写：TaskLease@1、TaskAttempt@1 claimed、Run@1 starting（envelope/start/end/outcome null、eventSeq0且无executionAuthorization）、DispatchOutboxEntry@1 pending（保存TaskClaim）、Session revision+1 occupancy execution。Run/Lease/Session复用已有注册codec；仅新建Attempt/outbox/TaskClaimed事件codec。不修改Goal/Workspace/Plan，不新建中间事务层，不把claimed伪装成Kernel run_started。新增ID由依赖newId产生，与requestId独立且有absence guards防碰撞。失败无任何孤立记录/占用。Session.lastExecutionRef设为本run，不复制Kernel日志。关联SessionWorkLink未来复用已有工具，本批不重复发布第二套关联。
7. readTaskClaim 读原outbox claim，校验完整ref及Host scope；只读不产生授权。后续修改outbox状态需版本化扩展，不将“pending”永远当正在执行。Replay解析必须验证事件身份/actor/fingerprint/结果引用一致，Store码细化保留。
8. 任务关系只提示Agent；不检查前驱整个Task完成，不扫描未来材料，不创建范围预占。不同Task/不同Session同workspace应可并发，即便reads之后有无关提交也不应失败。真正授权/消费在后续entry工具。

## 本阶段可写（4文件）
- T/src/core/work-graph/tasks/claim-service.ts：export createTaskClaimService(deps):TaskClaimPort，两个入口只返回明确unsupported；注释调用次序，不能填算法。
- T/src/core/work-graph/tasks/claim-record-codecs.ts：export TASK_CLAIM_RECORD_SCHEMAS、实际所需decode/encode签名；骨架不实现codec逻辑。已存在Run/Lease/Session schemas只复用，不能重定义注册。
- T/tests/helpers/task-claim-fixture.ts：复用真实Memory/SQLite schemas和原有Goal/Plan/Session创建、Kernel映射；可显式可信fixture seed治理/Plan，但不伪造claim结果。
- T/tests/work-graph/R4c-task-claim.test.ts：测试调用正式service，真实backend，不用mock service结果。骨架阶段可RED但typecheck必须通过。roles dependency可用真实RoleConfigurationService经临时测试适配返回空guards仅限尚未实现内部facts入口的明确fixture，第二阶段将由主审替换为真实facts方法并冻结；更建议测试侧调用类型交集且不存在时拒绝，使types通过而行为红。

覆盖高价值行为：真实原子五记录写入及查询；同Task/不同Session、同Session/不同Task仅一个成功；不同Task/Session可同时成功；无关写入不造成全局CAS失败；原始回执重放/异内容冲突/重开SQLite；CAS失败零partial；plan/session stale/scope/role/budget/closed lifecycle拒绝；Run已有无lease不视作pending；请求await后修改不能改变受理；取消零写入；计数spy验证没有整Goal Run扫描/前驱门槛/材料读取。至少在两个SQLite连接上竞争（实际存储，不以JS mutex代替）。少量大行为测试即可，不凑数、不复制实现。record codecs本阶段可只空注册（测试RED），类型须正确。

运行 python3 tools/dsh-refactor/check.py next-types；测试可用同一Node24/vitest已有调用。报告骨架、测试、真实红测原因、无法在当前scope解决的缺口，然后停止。不得stage/commit/push/reset/restore/clean/stash，不装依赖，不读凭据/其他会话内容。不要直接继续实现。

## Astra 并行审阅补充（第二阶段必须满足）

- deadline是否已过期、Goal/Plan/Session当前资格只用于**幂等miss后的新请求**；先检查输入形状、可信scope/pins，再lookup原结果。不能因时间过去或Session已占用拒绝合法重放。
- 任何已有本Task Run包括旧Plan Run。现有canonical fold在按Plan筛选前已经把所有所读Run加入guards；定向读取必须保留这些事实并在首次claim拒绝，不能只看当前Plan的execution，也不能为此再扫描一次。
- assignment沿用 `plan.assignments ?? plan.origin?.assignments ?? []`，显式空数组不回落。恰好一条本Task assignment且role等于roleBinding.templateId；不要拒绝合法origin旧结构。可迁入旧contracts/plan.ts里现有8行revisionAssignments纯函数到next同名契约文件，由主审冻结供复用。
