# Agent Platform Language

```yaml
status: draft
updated: 2026-09-06
scope: Agent Platform 的唯一领域词典
```

Agent Platform 用统一语言描述长期人机协作、执行状态与开发工作。本文只定义领域词汇，不记录实现方案。

## 产品边界

**Agent Platform**:
保存长期工作事实，并协调用户、多个 Agent 与执行内核的产品。
_Avoid_: Secretary Agent、超级 Agent、M7

**Execution Kernel**:
完成一次 Agent Run 内模型、工具、安全与 Context 循环的执行系统；当前实现是 `coding-agent`。
_Avoid_: Platform、Controller

**Project**:
一项长期业务或工程工作的隔离范围。

**Workspace**:
Project 中可执行和恢复工作的环境范围。

## 目标与执行

**Goal**:
用户希望最终得到的可观察结果。

**PlanRevision**:
某一时刻为实现 Goal 而接受的一版工作结构。

**Runtime Task**:
Agent Platform 在 PlanRevision 内调度、验证和归约的工作义务。
_Avoid_: Development Ticket、Todo item

**AcceptanceObligation**:
当前 PlanRevision 中必须为真的结果或不变量，不等同于某个专属测试。

**VerificationRequirement**:
CompletionPolicy 为某项 AcceptanceObligation 解析出的证据覆盖要求。

**CompletionPolicy**:
Project/Goal 激活并由 Runtime Task 继承的版本化完成策略，定义哪些证据足以满足当前义务。

**TaskAttempt**:
某个 Runtime Task 的一次执行尝试。

**AgentInstance**:
具有能力描述和连续身份的逻辑执行者。

**AgentRun**:
AgentInstance 的一次实际运行。

**CompletionClaim**:
Worker 对“本次工作已经完成”的声明；它不是完成事实。

**Evidence**:
支持或反驳某个当前义务的可追溯事实。

**EvidenceBinding**:
把不可变 Evidence 关联到精确 Task、义务和 revision，并据此解释其当前适用性的关系。

**EffectiveEvidenceSet**:
针对精确当前 revision 选出的适用且未被合法替代、用于完成归约的 Evidence 集合。

**GateTask**:
以汇合和验收为目标的 Runtime Task。

## 架构

**Plane**:
按权责和运行角色组织 Module 的高层视图；Plane 本身没有 Interface，也不是代码包。
_Avoid_: Module、开发阶段

**Module**:
在一个 Seam 上提供小 Interface、并隐藏较多 Implementation 的代码责任单元。
_Avoid_: Plane、任意流程方框

**Interface**:
调用者正确使用 Module 必须知道的全部契约，包括输入输出、不变量、错误和必要的性能约束。
_Avoid_: 只指类型签名的 API

**Seam**:
Module 的 Interface 所在、允许替换行为而不修改调用者的位置。

**ArchitectureBaseline**:
某个 revision 已接受的 Module、Interface、Seam、依赖和不变量集合。

**ArchitectureEvolutionPolicy**:
规定架构漂移分类、自动修复边界、人工裁决条件与 baseline 激活门禁的版本化策略。

**ArchitectureFinding**:
实际系统与 ArchitectureBaseline 对账后，需要解释或处理的问题。

**Decision**:
对目标、架构、策略或例外作出的有权限、可追溯选择。

## 三类图

**ModuleDependencyDAG**:
Module 之间长期的源码或 Interface 依赖图。
_Avoid_: 开发顺序、RuntimeExecutionDAG

**Development Ticket**:
为构建 Agent Platform 而存在、可在一个新 Context 中完成并独立验收的纵向开发切片。
_Avoid_: Runtime Task

**DevelopmentTicketDAG**:
Development Ticket 之间的 blocking edges；它描述当前施工前沿。

**Stage**:
按时间或成熟度观察多个 Module 工作进展的视图；它不自动创建 Runtime dependency。
_Avoid_: Plane、TaskPhase、串行开发阶段

**TaskPhase**:
Runtime Task 在执行生命周期中的当前位置；它与 Stage、是否 required 以及完成证据彼此独立。
_Avoid_: Stage、requirement level

**TaskHierarchy**:
PlanRevision 中由 `parent_of` 组成的工作分解图，只用于层级表达而不产生执行依赖或完成豁免。

**RuntimeExecutionDAG**:
Agent Platform 运行时，Runtime Task 之间由真实输入输出形成的前置关系。

## Context 与展示

**WorkContext**:
围绕一段连贯工作持续更新的模型工作上下文，可服务多次模型与工具调用。

**ExecutionMemory**:
与工作及受影响模块／接口关联、可供后续工作继承的工程事实、关键取舍、开发轨迹与未解项集合。

**CoordinationIssue**:
相关工作需要共同澄清或决定的有范围、来源和参与职责的协作议题。

**ContextBundle**:
为指定角色和任务按权限、版本与信息预算选取的有界材料集合；包含事实、规范及相关产物，不等同于状态查询结果。

**HandoffPacket**:
把未完成工作前沿交给另一 Run 或 Agent 的可追溯 ContextBundle。

**ReadModel**:
从权威事实派生的可重建查询结构，可被界面或 Context 消费者读取；它不是完成判定器。

**Coordination Role**:
对目标澄清、任务分工、耦合与测试设计、结果集成和返工承担语义协调责任的角色；秘书／参谋是其面向人的决策支持视角，书记是事实整理与汇报视角；规划／集成者组织执行及跨工作包协调。

**Execution Role**:
在已分配任务和权限内产生实现、观察及验证材料的角色；角色身份不同于某一次 Run 或读写能力。

**Progress Views**:
`ModuleProgress` 与 `StageProgress` 是分别按空间 Module 和成熟度 Stage 重建的 ReadModel，不拥有 canonical 完成状态。

**TodoView**:
Runtime Task 状态的 ReadModel，不拥有独立状态。

## 关系

- Plane 组织 Module；只有 Module 拥有 Interface 和 Implementation。
- 一个 Development Ticket 可以穿过少量 Module，并在当前切片内完成集成。
- ModuleDependencyDAG 不决定开发先后；DevelopmentTicketDAG 不定义源码依赖。
- Development Ticket 属于构建产品的工程流程；Runtime Task 属于产品运行时领域。
