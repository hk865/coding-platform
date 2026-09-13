# M7 长任务上下文压缩与多 Agent 管理实施计划（已拆分）

```yaml
status: superseded
updated: 2026-09-03
scope: 原 M7 合并计划的工程副本；不得作为当前实现计划
baseline_branch: codex/m6-completion
baseline_commit: 0635a4d
superseded_by:
  - /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/README.md
  - /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/P0-产品定义与总体架构.md
```

> 2026-09-03 边界决策：本计划混合了 `coding-agent` 执行内核演进和独立 Agent
> Platform 的产品能力，已停止作为 current 施工清单。平台部分迁入
> [Agent Platform P0](/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/P0-产品定义与总体架构.md)。
> `coding-agent`
> 后续若继续使用 M7 编号，只会在 P0 冻结 RuntimePort/Handoff/Context 边界后重新定义为收窄的执行内核里程碑。下文仅为历史快照。

## 1. 目标与判断

M6 已经建立工具生命周期、取消/中断恢复、Session 事实、Web
Timeline、真实场景 Runner 和独立评审门禁。下一阶段的真实问题不再是“Agent 能否跑通一次短任务”，而是：

- 多小时、大量模型轮次和工具输出后，模型上下文如何保持有效；
- Session、Artifact 和摘要如何控制存储、读取和重建成本；
- 中断恢复后如何继续使用压缩前的事实，而不是只依赖一段不可验证的总结；
- 多个 Agent 如何分工、取消、恢复、交接和合并，同时不破坏单 Agent 内核的不变量；
- 管理 Agent 如何知道子任务的真实状态、预算、产物和失败原因。

本阶段的一句话目标：

> 在不改写 Session 事实、不放松安全与副作用屏障的前提下，让单 Agent 可以长期运行，并建立可审计、可取消、可恢复的多 Agent 管理基础。

## 2. 强制架构边界

### 2.1 事实、投影、压缩与 Artifact 分层

```text
Session facts（唯一事实源，append-only）
  ├─ Runtime State Projection
  ├─ Web/Audit Projection
  ├─ Model Context Projection
  │    └─ Compaction（派生、可失效、可重建）
  └─ Artifact references（大输出、patch、报告、摘要正文）
```

必须满足：

1. 压缩不得删除、覆盖或重写原始 SessionRecord/AgentEvent；
2. 每个压缩结果必须记录来源 Session、位置区间、源摘要校验、策略版本和生成时间；
3. 摘要损坏、版本不兼容或来源校验失败时必须回退原始事实重建；
4. 大型 stdout/stderr、patch、测试报告和摘要正文进入 Artifact Store，Session 只保存引用和必要索引；
5. 模型请求必须能说明哪些内容来自原始事实、哪些来自压缩摘要、哪些被舍弃；
6. 压缩是 Model Context Projection 的策略，不得进入 RuntimeRunner 直接修改 RunState。

### 2.2 多 Agent 分层

```text
Agent Manager / Task Graph
  ├─ Parent task + budget envelope
  ├─ Child Agent A → independent Session + Inbox + worktree/overlay
  ├─ Child Agent B → independent Session + Inbox + worktree/overlay
  └─ Handoff / Artifact / Patch → evaluator or merge gate
```

必须满足：

1. 每个 Agent 拥有独立的 Session、Inbox、Profile、取消源、预算和 Workspace 增量；
2. 子 Agent 不共享可变 RunState，不直接写父 Agent transcript；
3. 父子交接使用结构化 Handoff，至少包含结论、证据、Artifact、patch、测试和未解决风险；
4. 父级取消必须传播到子级；子级失败不得自动伪装为父级成功；
5. 同一 Workspace 不允许多个 Agent 直接并发写；写任务必须使用独立 worktree/overlay；
6. 合并是显式步骤，必须检查基线、冲突、测试和审批；
7. 首版只支持单机、单进程控制面，不建设分布式调度平台。

## 3. 明确非目标

本阶段不做：

- 不复制完整插件平台、Profile/Bundle 生态或分布式工作流系统；
- 不让模型自行创建无限数量的子 Agent；
- 不允许子 Agent 绕过 Permission → Approval → Sandbox；
- 不用模型摘要替代原始审计事实；
- 不允许多个 Agent 直接并发修改同一个 checkout；
- 不实现无验证的自动合并、自动发布或远程写操作；
- 不把“上下文长度没有超限”当成压缩质量已经合格。

## 4. 里程碑与实施顺序

### M7-01 建立长任务基准与上下文可观测性

目标：先测量当前 Context/Session 的真实增长和瓶颈，不先实现摘要算法。

任务：

1. 为每次 Model Request 记录选入内容类别、来源位置、估算 Token 和实际 Provider usage；
2. 记录 Session 记录数/字节数、Artifact 字节数、Context 构建时间和恢复重放时间；
3. 建立长轨迹 fixture：大量 read、shell 输出、测试失败/修复、多轮模型请求；
4. 建立大型仓库 fixture，记录 Context Selection 和 workspace 检索成本；
5. 固定无压缩 baseline，保存功能正确性、Token、时间和存储数据。

完成标准：

- 相同输入重复运行的指标结构稳定；
- 能区分模型上下文增长、Session 增长、Artifact 增长和 Workspace 扫描成本；
- benchmark 不依赖真实 Provider 也能做确定性回放，真实 Provider 结果单独报告。

### M7-02 Artifact Store 与大输出外置

目标：压缩前先解决“大内容存在哪里”。

任务：

1. 定义 ArtifactStorePort：put/get/stat/listRefs/deleteUnreferenced；
2. 采用内容寻址和 SHA-256 校验，正文与元数据分离；
3. 定义单 Artifact、Run、Session 配额和拒绝语义；
4. 将截断的工具输出、完整 patch、测试报告、诊断文件保存为 Artifact；
5. Session 记录 artifactRefs、媒体类型、大小、摘要和校验，不内联重复大正文；
6. 增加 mark-and-sweep 或等价的可恢复 GC，禁止删除仍被 Session 引用的 Artifact。

完成标准：

- Artifact 损坏可检测；
- Session 重放不需要读取所有 Artifact 正文；
- 大输出任务的 Session 增长由“正文大小”降为“引用与索引大小”；
- 配额超限产生明确、模型可见且可审计的失败。

### M7-03 Context Projection 与来源契约

目标：从 Session 事实构造版本化的 Model Context，不再由恢复路径临时拼接。

建议接口：

```text
ContextProjectionPort.project(session, boundary, budget, profile)
  → ContextProjection

ContextProjection
  - projectionId / strategyVersion
  - sourceRanges[]
  - messages[]
  - artifactRefs[]
  - estimatedTokens
  - omissions[]
```

任务：

1. 定义来源区间和 lineage schema；
2. 统一首次运行、恢复、下一 Turn handoff 的 Context 构建入口；
3. 投影必须包含取消、outcome_unknown、失败和人类纠偏事实；
4. 提供 deterministic identity projection 作为无压缩基线；
5. Context Selection token 估算改为按候选缓存/增量计算，避免重复全量序列化。

完成标准：

- 相同事实、Profile 和策略版本生成相同投影；
- 恢复后的下一 Turn 能看到必要的合成 ToolResult；
- Web/Audit 与 Model Context 可以使用不同投影，但都能追溯同一事实位置。

### M7-04 Append-only Compaction

目标：实现可验证、可失效、可重建的上下文压缩。

建议接口：

```text
CompactionStrategyPort.shouldCompact(metrics, budget)
CompactionStrategyPort.compact(source, targetBudget)
  → CompactionResult
```

CompactionResult 至少包含：

- compactionId、策略/模型版本；
- 来源 Session 与位置区间；
- 来源 canonical digest；
- 摘要 ArtifactRef；
- 保留的关键事实、未解决问题、文件/符号引用和 omission；
- 估算 Token、生成成本和质量诊断。

触发策略至少支持：

- Context 预计超过预算阈值；
- Session 事件数/字节数超过阈值；
- Turn、工具批次、任务阶段或 handoff 边界；
- 用户显式请求压缩；
- 恢复时发现已有压缩失效后重新生成。

完成标准：

- 原事实保留，摘要删除后可以重新生成；
- 未解决错误、outcome_unknown、用户约束、修改文件和测试结论不得静默丢失；
- 压缩后真实场景正确率不低于预设阈值，同时 Token/构建时间有可测改善；
- 对错误摘要和陈旧摘要有反向测试。

### M7-05 Durable Inbox、Immutable Profile 与 Agent Task

目标：先建立可靠控制面，再创建子 Agent。

任务：

1. Durable Inbox 支持 send、steer、follow-up、ack、去重和顺序消费；
2. Immutable Profile 固定 Provider、模型、工具、策略、Skill、权限和版本摘要；
3. 定义 AgentTask、AgentAttempt、AgentLease、AgentStatus 和父子 lineage；
4. 状态至少区分 queued、starting、running、waiting、completed、failed、cancelled、outcome_unknown；
5. 定义预算 envelope：Token、模型请求、工具调用、时间、并发数和 Artifact 字节；
6. 父级只通过控制面启动、取消和观察子级，不能直接改子级 RunState。

完成标准：

- 输入在崩溃后不丢失、不重复执行；
- Profile 重放不受运行中配置热更新影响；
- 租约过期和进程崩溃产生明确状态，不自动假定子任务失败或成功；
- 父子预算总和受上级 envelope 限制。

### M7-06 多 Agent 只读研究与结构化 Handoff

目标：用最低风险方式验证多 Agent 管理价值。

任务：

1. 支持并行只读代码搜索、模块分析、测试定位和方案比较；
2. 每个子 Agent 使用独立 Session，默认不获得写权限；
3. 定义 Handoff schema：结论、证据位置、置信度、Artifact、建议和阻塞；
4. Manager 对重复/冲突结论进行合并，并保留来源；
5. 子 Agent 原始 transcript 不进入父 Agent Context，只投影必要 Handoff 与可追溯引用。

完成标准：

- 一个大型仓库问题可拆成至少两个独立只读子任务；
- 子 Agent 中断/超时不会让 Manager 永久等待；
- 父级报告能追溯每个结论来自哪个 Agent、Session 和证据。

### M7-07 隔离写入、验证与合并门禁

目标：在独立增量中允许实现型子 Agent，不开放共享 Workspace 并发写。

任务：

1. 每个写任务创建独立 worktree/overlay，并记录基线 revision；
2. 子 Agent 返回 patch/commit、changedPaths、测试和风险；
3. 合并前执行基线一致性、路径冲突、策略和测试检查；
4. 冲突、测试失败或基线漂移时进入 waiting/failed，由 Manager 或人类决策；
5. 合并动作本身是可审计、有权限约束的独立工具操作。

完成标准：

- 两个 Agent 不直接并发写同一 checkout；
- 无冲突改动可验证合并，有冲突改动不会静默覆盖；
- 取消、崩溃和重试不会重复合并同一 patch。

## 5. 真实业务验证矩阵

| 层级 | 场景                        | 重点指标                                 |
| ---- | --------------------------- | ---------------------------------------- |
| L1   | 10k+ Session 记录重放与压缩 | 重建一致性、时间、内存、损坏回退         |
| L2   | Bug Hunt 长轨迹             | 未解决约束保留、压缩后修复正确性         |
| L2   | Web/3D 项目多轮构建         | 大输出 Artifact、截图/报告引用、重启恢复 |
| L3   | 单 Agent 大型仓库任务       | Token、耗时、Context 命中、最终正确性    |
| L3   | 多 Agent 并行只读调研       | 时间收益、重复工作、Handoff 完整性       |
| L4   | 隔离实现与合并              | 冲突、安全、取消恢复、端到端交付         |

必须保存的对比指标：

- 任务正确率与 evaluator 分数；
- 模型输入/输出 Token、模型请求数和工具调用数；
- Context 构建、压缩、恢复和总耗时；
- Session/Artifact 字节数；
- 子 Agent 数、并发峰值、重复工作比例；
- Handoff 被采用/丢弃/冲突的数量；
- 合并冲突、人工介入和失败恢复次数。

## 6. 风险与约束

1. 摘要失真：摘要不是事实；必须保存来源和回退路径。
2. 压缩抖动：频繁压缩可能比不压缩更慢；必须有阈值、缓存和 benchmark。
3. 共享上下文污染：子 Agent 不共享可变 transcript，只共享结构化 Handoff。
4. 预算爆炸：父级预算必须约束所有子级，禁止无界 fan-out。
5. 写竞争：独立 worktree/overlay 是首版强制边界。
6. 取消传播：父级取消后必须停止创建新子任务，并有界等待子级收尾。
7. 孤儿任务：租约、心跳和恢复对账必须能识别仍在运行、已退出和结果未知。
8. 合并副作用：合并与发布不得自动重试，必须有 operationId 和幂等对账。

## 7. 当前立即执行的下一任务

下一轮只做 M7-01：长任务基准与 Context 可观测性，不同时实现摘要器或子 Agent。

交付要求：

1. 建立长轨迹确定性 fixture 和大型仓库 fixture；
2. 定义 Context/Session/Artifact 指标 schema；
3. 在不改变模型请求语义的情况下采集 baseline；
4. 输出修改前基线报告，明确主要成本来自哪里；
5. 为 M7-02/M7-03 提供可失败的性能与正确性门禁；
6. 更新长期 M7 计划中的实测数据，不提前宣称压缩收益。

禁止事项：

- 不修改 Session 事实 schema；
- 不引入模型摘要；
- 不实现多 Agent spawn；
- 不用 mock benchmark 冒充真实大型仓库结果；
- 不在没有基线数据前优化 RuntimeRunner。

## 8. 后续 Agent 交付格式

```text
目标：本轮只完成哪个 M7 条目
基线：分支、提交、工作树状态
事实：当前代码、测试和 benchmark 数据
设计：事实/投影/Artifact/控制面边界
改动：文件、接口和职责
验证：L0/L1 + 对应 L2/L3 场景
性能：修改前后 Token、时间、Session/Artifact 大小
失败：未通过项和外部依赖
风险：摘要失真、预算、取消、孤儿任务、合并
后续：明确不在本轮范围内的条目
```
