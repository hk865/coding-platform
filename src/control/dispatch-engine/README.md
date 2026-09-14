# DispatchEngine

按已提交的 outbox 意图驱动实际运行：准备、领取、启动与运行事件对账。

## 源码入口

- [dispatch-engine.ts](dispatch-engine.ts)：普通与协调 outbox 的 `drive(trigger)` 入口（outbox-before-side-effect）
- [handoff/handoff-drive.ts](handoff/handoff-drive.ts)：换手面 driveHandoff
- [workspace-drive.ts](workspace-drive.ts)：旧 scope 并行入口适配同一普通调度实例，不另持有启动/消费循环
- [planned-task-dispatch.ts](planned-task-dispatch.ts)：已接受分工的准备、领取与恢复
- [operator-task-dispatch.ts](operator-task-dispatch.ts)：人明确请求的运行
- [reviewer-dispatch.ts](reviewer-dispatch.ts)：独立 Reviewer 运行
- [query-drive.ts](query-drive.ts)：只读查询运行
- [exploration-context-drive.ts](exploration-context-drive.ts)：前驱材料授权与 Context 编译调用
- [runtime-dispatch.ts](runtime-dispatch.ts)：持久运行记录恢复
- [leased-worker-runtime.ts](leased-worker-runtime.ts)：租约、启动前材料失败与真实执行接线
- [role-spec-read.ts](role-spec-read.ts)：角色规格的只读解析（`RoleSpecReadPort`）与角色绑定签发（`issueMatrixRoleBinding`）
- [work-material-drive.ts](work-material-drive.ts)：派发收口的工作身份与工作／历史材料编译
- [rework-drive.ts](rework-drive.ts)：验证失败之后的返工触发面：读取未处置问题 → PlanCompiler 编译提案 → Control 按自动返工边界受理。**当前返工处置规则按“处置事实”（而不是“证据 anchor 是否仍生效”）挑选分组**：一次触发把所有尚未处置的分组推进完（推进后仍由原任务承担、且未重验通过的分组照样接手），并在结果里逐条交代每一条失败的落点（谁接手了／停在哪个明确阻塞上／已被什么取代），“未处置的还剩什么”因此可以从结果与只读视图直接看到

## 内部职责分组

- `execution/`：本地容量、Control 启动与执行代际栅栏、逐次模型许可、已知无副作用失败的持久退避。普通、Reviewer、Replacement 的资格检查仍在各自入口。
- `handoff/`：人工有界换手请求、从来源 RunSpec 重建准备、消费独立 ReplacementAttempt。宿主不自行拼接 packet/claim/start。
- `WorkspaceDrive` 只适配旧 scope 调用；生产 `RuntimeDispatch` 同时唤醒普通与换手消费者，Reviewer 按 ReviewWork 单独发现。三者由组合根注入同一个 `ExecutionSlots`。
- Query 使用 QueryJob/QueryRun 精确轮次绑定，保存的结果可对账；缺少结果时显式 unknown，不能套用普通 Run 的重跑机制。

## 角色绑定的来源：由角色矩阵签发

派发提交给 claim 的角色绑定**不是**调用方写死的角色名字符串，而是按**当前生效的角色矩阵**（`CoordinationPolicyContentV1.roles`）的 pin 签发：见 [role-spec-read.ts](role-spec-read.ts) 的 `issueMatrixRoleBinding`。

- 矩阵登记了该角色时，`templateId`／`templateRevision` 直接取自 pin，`policyRevision` 记录签发依据（`matrix:<policyId>@<contentRevision>#<pin 摘要前 16 位>`），签发结果自带 `source: 'matrix'` 与所用 pin；
- **没有矩阵**（或矩阵未登记该角色）时不编造角色目录：逐字沿用既有的静态绑定（`source: 'static-fallback'`），仍交由 ControlEngine 未改动的 claim 守卫判定（`role_not_registered`／`role_spec_stale` → 拒绝且零写）；
- 签发函数只确定绑定来源。计划入口解析规格以收窄声明权限，Control 在受理时仍独立复核安装、激活和权限。因此**矩阵必须先安装并激活它 pin 的每一份规格，再安装并激活该矩阵**；派发入口（[operator-task-dispatch.ts](operator-task-dispatch.ts) 与 [planned-task-dispatch.ts](planned-task-dispatch.ts)）只消费签发结果。
- 范围：本条覆盖**派发面按调用方角色意图建绑定**的两条入口（人工真实运行／只读探索、已接受分工的任务派发）。独立 Reviewer 与 QueryJob 的绑定来自各自的**固定配置**（ReviewerProfileCompiler 的只读 profile、QueryJobIntent 上已落账的角色绑定），不是派发面写死的角色名字符串；它们仍由**同一个** claim 守卫按矩阵校验，本次未改动（要改成矩阵签发，需要让 profile 编译器依赖矩阵，属另一条依赖边，不在当前实现范围）。

## 边界与接线

普通、计划和人工运行共享同一个普通 outbox 消费实例。实例内按工作区允许只读重叠、串行写冲突，等待写任务前不会插入同工作区的新读任务；其他工作区仍可使用空闲执行槽。等待期间 outbox 保持持久 pending，内存等待表不授予启动权。跨进程仍由 Control/Ledger 与工作区租约作最终复核。

普通与换手运行只消费已持久的 outbox，Context/执行错误以明确事实与失败结果报告。可证明未产生副作用的准备失败按持久 schedule 退避；这不是新增领域 TaskAttempt。旧 scope 并行入口也复用相同规则，不以本地重试覆盖未知执行。`RuntimeDispatch.recover` 只处理完整 Project/Workspace 匹配的记录；已开始且无法证明完成的记录转待对账，不重跑模型或工具。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/dispatch-engine.md)。完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/control](../../../tests/control) 中的 `dispatch-*.test.ts`、`runtime-dispatch.test.ts`。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。
