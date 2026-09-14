# ControlEngine／PlanCompiler／DispatchEngine／ArchitectureReconciler

受理提案、校验守卫、提交正式状态，组织计划与派发。

## 源码入口

- [control-engine.ts](control-engine.ts)
- [plan-compiler.ts](../plan-compiler/plan-compiler.ts)
- [initial-plan-compiler.ts](../plan-compiler/initial-plan-compiler.ts)：初始协调意图与提案受理请求
- [dispatch-engine.ts](../dispatch-engine/dispatch-engine.ts)
- [planned-task-dispatch.ts](../dispatch-engine/planned-task-dispatch.ts)：已接受分工的准备、领取与恢复
- [exploration-context-drive.ts](../dispatch-engine/exploration-context-drive.ts)：前驱材料精确授权与 Context 编译调用
- [leased-worker-runtime.ts](../dispatch-engine/leased-worker-runtime.ts)：租约、启动前材料失败与真实执行接线
- [architecture-reconciler.ts](../architecture-reconciler/architecture-reconciler.ts)
- [task-reducer.ts](task-reducer.ts)
- [goal-reducer.ts](goal-reducer.ts)
- [evidence-intake.ts](evidence-intake.ts)
- [autonomous-rework.ts](autonomous-rework.ts)：返工提案的自动受理（ADR 0003 D1-4 的四条边界；预算计数与拒绝事实都从账本重建）
- [work-identity-resolution.ts](work-identity-resolution.ts)：任务工作身份的权威只读解析（RW-13；账本事件扫描，唯一权威，无第二份事实）
- [policies/autonomous-rework.ts](policies/autonomous-rework.ts)：自动受理的纯策略（边界判定与确定性身份）
- [workspace-lease.ts](workspace-lease.ts)
- [replacement-claim.ts](replacement-claim.ts)
- [material-access.ts](material-access.ts)

## 边界与接线

目录承载四个设计模块，见下表。ArchitectureReconciler 已替换固定 Finding 为绑定源码的机械差异与待审问题；当前真实产品闭环仍在验证和接线。

自动受理只复用既有 plan-change 三段入口（recordPlanChangeProposal → recordUserDecision → applyPlanChange）：它判定「触发源是已提交验证结论／改动落在 inScopeRework／自动化预算未耗尽／人没有拒绝过这条问题」四条边界，任一条不满足即零写入转人工；它自己不做账本提交，也不重新推导提案草稿。

人可随时停用自动返工：**每次受理**都读当前生效 CoordinationPolicy 的 `allowed.inScopeRework`，为 false 时边界 (b) 直接转 `needs_human_decision` 并零写入（之后每条失败都必须由人决定）。停用与重新启用都只是一次 install + activate，没有暂停命令、暂停聚合或「暂停」状态。重放也不是免检路径：受理前把本次输入与已落账提案的 `rework`／`planDraft` 比对（这两部分不在 `planProposalDigest` 内），不一致即返回提案冲突码且零写入；落账前的草稿一致性预检沿用既有守卫的归因码（`draft_mismatch`／`obligation_semantics_forbidden`），不再统一压成 `invalid`。

RW-13：**一个任务只有一个持久工作身份**。身份的权威答案由 [work-identity-resolution.ts](work-identity-resolution.ts) 的 `resolveTaskWorkIdentity` 给出（只读：扫账本里的 `WorkContextBound` 事件 + 按 ref 复读当前快照，不新增索引表、不新增命令）。派发面（DispatchEngine.ensureWorkIdentity）**先解析、后建立**：解析到就复用那条身份（workId 与推导 id 不同也照样复用）并只做 `linkWorkRun`；只有 `absent` 才按推导规则建立；`unavailable`（读不到／超过扫描上限 200×1000 条事件）一律拒绝派发且零写入，绝不凭推导 id 硬写。同一任务存在多条历史身份（RW-13 之前留下的不一致）时，解析面按「显式声明的身份优先于推导兜底身份，同为显式取账本顺序最早」给出唯一答案，并且**不改名、不删除**任何一条绑定；已完成工作视图用同一条规则（`dedupeTaskWorks`）把一个任务归并成一行。

材料授权登记检查实际 Goal.workspaceRef、Run.workspaceSnapshot 与 Project/Goal 范围；材料存在性和首次 owner 仍由 Vault 在读取时检查。架构 sourceBinding 与分类边界见 ArchitectureReconciler Module；无来源绑定、版本过期或登记拒绝时停止，不以测试夹具补足。

RW-18：**角色绑定由角色矩阵签发**。矩阵与 guard 判据都在本模块：`policies/role-binding-admission.ts` 的 `evaluateRoleBindingAdmission` 是 claim 的唯一受理判据（角色存在 → 绑定 revision 与矩阵 pin 一致 → pin 的规格已安装且摘要一致 → 生效引用等于 pin → 声明权限 ⊆ 规格上界，任一不成立即拒绝且零写），判据集合**没有改动**；派发面按同一份矩阵的 pin 签发绑定（[role-spec-read.ts](../dispatch-engine/role-spec-read.ts) 的 `issueMatrixRoleBinding`），绑定内容（roleId／revision／签发依据摘要）来自矩阵而不是调用方写死的字符串。矩阵仍是**可选字段**：没有矩阵的项目沿用既有绑定语义，本模块不编造默认角色目录。签发的**前提**是矩阵 pin 指向的规格先经 install + activate 装齐并激活，再安装并激活该矩阵；签发本身不替守卫判断安装／激活状态，判断只发生在 claim 上。

| 设计模块 | 主入口 | 正式规范 |
| --- | --- | --- |
| ControlEngine | [control-engine.ts](control-engine.ts) | [Module](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/control-engine.md) |
| PlanCompiler | [plan-compiler.ts](../plan-compiler/plan-compiler.ts) | [Module](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/plan-compiler.md) |
| DispatchEngine | [dispatch-engine.ts](../dispatch-engine/dispatch-engine.ts) | [Module](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/dispatch-engine.md) |
| ArchitectureReconciler | [architecture-reconciler.ts](../architecture-reconciler/architecture-reconciler.ts) | [Module](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/architecture-reconciler.md) |

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/control-engine.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/control](../../../tests/control)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。


[material-access-revocation.ts](material-access-revocation.ts) 受理精确授权撤销（CAS@1），保存原 grant 和撤销来源；宿主直接复核账本，投影延迟不会延长权限。
