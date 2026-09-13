# WorkerRuntime Module

> 当前代码与接线评价见 [模块审计](../../../human/module-status.md) 的对应条目。本页保留职责、Interface 要求及明确标注的首切片约定；旧切片状态不能代替当前实现结论。


```yaml
status: draft
updated: 2026-09-06
plane: Execution
```

## Purpose

作为内核适配 Interface 执行一次有界 Run，暴露能力、控制回执和运行结果。

## Interface

候选操作：`capabilities / start / control / events；可选 snapshot`。共享字段、拒绝与状态语义唯一来源为 [运行时协作契约](../../interfaces/runtime-collaboration.md)，本页不复制 wire schema。首个消费者：P1-03；06/07/09/10 按消费扩展；设计已展开不代表契约已冻结或实现。

## Dependencies

无反向 Control 依赖；CodingAgentAdapter 与 FakeRuntimeAdapter 实现本 Interface。长期调用关系以 [ModuleDependencyDAG](../../../ARCHITECTURE.md#moduledependencydag) 为准；运行时事件反馈不是反向源码依赖。

## Hidden Implementation

适配模型与工具内核、Run 身份、能力约束、事件 cursor、控制安全点及 outcome_unknown；不重写内核推理循环。

## Test seam

通过上述 Interface 注入依赖 Adapter，验证：启动幂等、只读／写 lease、取消安全点、重复事件、断线恢复、快照 unsupported。 不以内部表或私有方法作为唯一测试入口。

## Context load

实现或扩展本 Module 时读取本页、当前 Ticket 与直接消费的 [运行时协作契约](../../interfaces/runtime-collaboration.md) 小节；初始协商及图文集成另读 [初始设计与统一展示](../../interfaces/human-design-status.md)。原始对话和完整历史按需追溯，不默认装入 Run。

## Extension records

- **P1-03（首个消费者，冻结）**：RunPort = capabilities/start/events（RunCapabilities：replayable、supportsSnapshot=false、maxEnvelopeBytes=64KiB 诚实声明；FakeRuntimeAdapter 按 FakeRuntimeScriptV1 只发事件，不判真伪）。
- **P1-06**：HandoffControlPort = control + snapshot；snapshot 只返回公开报告（noHiddenContextRead），实现见 src/execution/worker-runtime/handoff-control-adapter.ts。
- **P1-07 wire 保持，2026-09-09 实现归位**：WorkspaceCapabilityPort = capabilitiesFor → ready / unsupported / rejected。运行支持事实由宿主显式配置，支持与 envelope 权限的交集由 Control 的 ConfiguredWorkspaceCapabilityPolicy 求值；无配置返回 unsupported。它不查询活 Runtime；实际内核能力、沙箱预检和执行失败继续由 WorkerRuntime 负责。

## Context 生命周期与协作扩展

P1-16 扩展能力声明与同工作连续运行／接续；原会话不可恢复时明确降级。Run 内模型循环、压缩与恢复由内核承担；Fake 与真实内核分别验证。 行为依据：[Context 生命周期](../../interfaces/context-lifecycle.md)、[运行时协作](../../interfaces/runtime-collaboration.md)、[人类交互](../../interfaces/human-design-status.md)。精确 schema 在对应消费者冻结，文档同步不表示已有实现。

## RAT-02 真实运行消费者（2026-09-07）

通过内置 coding-agent 公共组合 API 执行有界任务，RunPort 使用事件长轮询；配置版本、Run/session、工具结果与 usage 持久化。上下文容量继续使用 TaskBudget.tokenBudget；累计消耗另用宿主计量器。本消费者支持显式写授权、隔离工具、取消、幂等提交；能力声明 replayable=false / supportsSnapshot=false。中断或工具副作用未知时保留 outcome_unknown 和工作区锁，不自动重跑；模型结束不直接完成 Task/Goal。

内核组合入口新增可选 limits/workspaceOptions/processSandboxOptions，ProcessSandbox 新增受验证的只读根路径和执行 PATH；默认 CLI 兼容。当前单 Goal 单工作任务，跨角色累计账户和会话接续尚未接入。具体边界与真实/可控测试分层见 [RAT-02 evidence](../../archive/2026-09-08-verification-history/rat-02-evidence.md)。

2026-09-08：CodingAgentRuntime 对进程沙箱不可用及沙箱 Node 探测失败保留具体的安全预检提示，并持久化到运行记录；不回显原始探测详情，不改变取消／未知副作用分类。沙箱不可用反例验证模型零调用、重开保留提示；不等于任务续跑。
## 当前源码边界（2026-09-09）

`src/execution/worker-runtime/coding-agent-runtime.ts` 承载实际内核，`read-only-query-runtime.ts` 承载独立查询。公开观察的原子保存交 ArtifactVault 的 RuntimeObservationJournal；Context 获得 journal 独立读对象，仅见成功持久化的快照，不反调 Runtime。准备/取消通过明确端口交 Dispatch，执行前 Context 输入及来源工具保持受限；Runtime 不组织 Plan 或归约 Task。真实应用尚未实现的 handoff、continuation、safe-point 明确声明 unsupported/拒绝，不使用 Fake Adapter 确认未发生的效果。

跨 Module 的精确入口与失败/持久兼容规则见 [当前 Module 边界](../../interfaces/module-boundaries.md)。此源码映射不代替整体功能验收。

VR-02 在原 `CodingAgentRuntime` / `observed-model-run` 增加明确 review 模式及 canonical Work/profile/input 绑定，实际使用 `read_source`、`read_material` 和受限分析工具。分析/发现复用原探索工具，但按Reviewer source pin范围过滤；不暴露edit/shell或绕过路径过滤的通用read。每次模型调用与工具前后检查当前配置/来源/授权，沿用原任务预算和用量记录，不新增累计限制；真实观测最终回答交 Dispatch 绑定，本模块不赋PASS。详见[独立审阅](../../interfaces/independent-review.md)，本批已按[VR-02验收](../../verification/2026-09-09-independent-review/acceptance.md)确认限定能力。


CM-1B-001（实施中、未冻结验收）：Runtime 继续保存实际输入及摘要；记忆版本由 Context 选入，既有运行输入不被维护操作改写。保存版本与具体响应采用版本分别展示，偏好变化不触发全部运行取消。 契约见[记忆维护与回应选材](../../interfaces/memory-maintenance.md)。
