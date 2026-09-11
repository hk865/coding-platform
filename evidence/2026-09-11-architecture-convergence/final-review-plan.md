# AC-PLAN 独立责任与可读性复核

复核者 audit_data 未参与 AC-PLAN 实施，只读检查 contracts/planning-work-materials.ts、task-work-identity.ts、rework.ts，PlanCompiler 的 planning-work-materials/plan-compiler/rework-plan-compiler，Dispatch 的 work-identity/rework-drive，以及 app/service 和两套 harness 的实际依赖注入。

结论：未发现阻断本次身份影响分析修复的责任偏移或消费者断线。

| 核查 | 实际代码与独立判断 |
| --- | --- |
| 身份权威 | resolvePlanningWorkIdentities 调用既有 Control.resolveTaskWorkIdentity；核对 returned binding 的 project/workspace/goal/originTask/kind 与 workRef。没有从 taskId 拼造work引用，没有自行bind/link，既存自定义workId被原样保留。缺省或读取异常变unavailable，明确absent才表示不存在。 |
| 规划责任 | PlanCompilerImpl.request 在 Context 提供目标/源Plan后只读解析身份；buildProposal以这些材料构造affectedWorks，缺失进入staleAssumptions。ReworkPlanCompiler仍是纯材料到提案的编译器；不会直接读账本或接受长期状态。 |
| 真实普通变更消费者 | app/service 的 InitialPlanning使用 PlanCompilerImpl并注入workIdentity:h；in-memory-harness、persistent-harness均为PlanCompilerImpl注入实际control。不是只有新测试能传入身份材料。 |
| 真实返工消费者 | ReworkDrive 的执行与preview两条compile调用均传入await workIdentities(request, canonical.plan)；该方法调用同一resolvePlanningWorkIdentities并保持Control方法this绑定。源Plan由现有loadScope核对Goal工作区及active ref后提供。 |
| 身份链规则唯一 | taskWorkOrigin是共享的纯source-plan遍历，Dispatch.resolveOriginTaskId和planning material解析都消费；workIdFor仍仅供已确认absent时的派发建立使用，影响报告不再用兜底id冒充已登记事实。长期Module依赖方向未改变。 |
| 返工影响列表 | affectedWorks/independentWork/materialsToRefresh都来自相同已读workRef，按workId去重；已被affected列出的身份不再同时标成independent。后继任务按同一起源查询，避免给同一工作报告另一个身份。 |
| 共享契约 | PlanningTaskWorkMaterial仅描述task/origin及resolved/absent/unavailable；rework.ts的可选字段保持旧调用可报告缺口。没有把查询实现、存储适配、接受政策放进contract，也没有新Module。 |
| 可读性 | 一个具名材料解析步骤、一组纯影响报告取材助手服务两种真实消费者；权威解析、缺口表达、报告引用选择彼此清楚，没有机械转发框架。历史长注释仍可局部维护，但此次未扩大重构。 |

证据与边界：检查了 tests/control/plan-impact-work-identity.test.ts 中自定义/派生身份、返工起源与absent/unavailable反例，并读取 ac-plan-tests-final.log 的真实 **3文件/39测试通过**记录；本复核没有自行重复运行测试，不把这些用例当全仓证明。主仍需完成集成回归和最终源码身份。

共享taskWorkOrigin保留原16-hop上限及遇到已见节点停止的行为；本次不是异常链、缺失Plan或历史分裂身份的完整治理改造。影响报告的缺口不授予权限，也不决定提案能否接受；正式Control守卫仍独立负责版本/接受资格。这些边界应随最终摘要保留，不能宣称全部工作身份历史问题已被消除。
