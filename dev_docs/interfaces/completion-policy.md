# Completion Policy Interface：Task → Goal 完成契约

```yaml
status: proposed
updated: 2026-09-05
review_gate: P0-06
owner: ControlEngine
participants: ControlEngine, VerificationEngine, ReadModelIndex, HumanCollaboration
scope: 当前 PlanRevision 的验证、Task/Gate 满足与 Goal 状态归约
```

## Purpose

2026-09-05 [设计复核](../design/human-framework-role-review.md)：完成归约规则仍供审阅，需核对规划／集成、执行和 Reviewer 的职责；角色名称不赋予直接完成权。

本 Interface 是 P0-06 的当前、非归档裁决文本。它规定调用者、Verifier、Reviewer 和用户必须共同遵守的完成语义，但不规定数据库字段、存储布局、Provider 品牌或 UI 样式。

文中的“必须”是规范约束。只有 `ControlEngine` 能依据本契约推进 canonical Task/Goal 状态；ReadModel 只能投影结果。

## 1. Task 的正交维度

每个当前 PlanRevision 中的 Runtime Task 至少具有下列彼此独立的语义维度：

```text
requirementLevel = required | optional
taskKind         = work | gate
disposition      = active | deferred | cancelled | superseded
phase            = pending | ready | running | verifying | blocked | satisfied | failed
```

- `requirementLevel` 回答该 Task 是否阻塞 Goal 完成；
- `taskKind` 回答它执行工作还是承担显式汇合/验收；
- `disposition` 回答当前 PlanRevision 如何处置这项义务；
- `phase` 回答当前执行生命周期走到哪里。

这些维度不得合并成一个枚举。尤其：

- `optional` 不是 phase；optional Task 仍可 running、blocked 或 satisfied；
- `deferred/cancelled` 不是完成，也不得被翻译为 `satisfied`；
- AgentRun 的 cancelled outcome 不自动取消 Runtime Task；Controller 依据策略决定重试、阻塞或改变 disposition；
- `superseded` 只表示该 Task 不属于当前 PlanRevision 的完成集合，历史事实仍保留。

所有 MVP Task 都是 executable。`gate` 是特殊 Task，不是文档布尔值；ModuleGate、StageGate 和 GoalGate 只在 scope 上不同，使用同一生命周期与证据规则。

## 2. TaskHierarchy 与 RuntimeExecutionDAG

系统保存两种不同关系：

### TaskHierarchy

`parent_of` 只表达工作分解和 ReadModel 分组。它：

- 不参与 readiness、环检测或依赖满足；
- 不使父 Task 自动完成；
- 不使叶 Task 获得特殊完成权；
- 不改变任何 required Task 的 Goal 完成义务。

### RuntimeExecutionDAG

`depends_on` 只在缺少上游可标识、可版本化输出时，下游无法安全开始或有效验收的情况下建立。每条硬依赖必须指出所需 output contract、Artifact、Decision、环境 revision 或 Gate 结果。

- 同一 Module、相邻 Module、相同 Stage、展示顺序或潜在写冲突都不自动建边；
- 写冲突由 lease/conflict policy 处理，不伪装成业务依赖；
- Stage 不自动产生先后关系；
- GateTask 只有被下游显式 `depends_on` 时才形成调度 barrier；
- 当前 PlanRevision 的 RuntimeExecutionDAG 必须无环。

## 3. Plan 与验收非空约束

Plan Validator 必须在激活 PlanRevision 前同时证明：

1. 至少存在一个 required executable Task；
2. 至少存在一个 `requirementLevel = required`、`taskKind = gate`、`disposition = active` 且 scope 为 Goal 的 `GoalGateTask`；
3. 至少存在一个 required `AcceptanceObligation`；
4. 每个 required executable Task 至少映射一个 required AcceptanceObligation；
5. 每个 required AcceptanceObligation 至少有一个负责取证或归约的 work/gate Task；
6. 每个 required AcceptanceObligation 编译出至少一个 required `VerificationRequirement`；
7. TaskHierarchy 合法，RuntimeExecutionDAG 无环，所有引用属于同一有效 PlanRevision。

`AcceptanceObligation` 描述“必须为真的结果或不变量”；`VerificationRequirement` 描述当前 CompletionPolicy 要求用什么证据覆盖它。二者都不是专属测试文件，也不能用空集合代表成功。

若目标已经满足、无需修改，也不得激活空 Plan。系统必须创建 required `AlreadySatisfied GoalGateTask`，并用当前适用 Evidence 证明 no-change 结论。

## 4. CompletionPolicy 与分层验证

PlanRevision 通过 Project active ref 解析版本化 `CompletionPolicy`，Task 默认继承，仅在明确例外时 override。`VerificationEngine` 根据当前 Task contract、Workspace revision、ArchitectureBaseline revision、Policy revision、变更范围、风险和可用检查编译 `VerificationPlan`。

任何 effective CompletionPolicy 与 ArchitectureBaseline ref 都必须解析到持久、不可变且 digest/revision 匹配的对象。MVP 在首个 Plan 消费前，只能从显式版本化 local fixture 经受支持的 install/activation contract 建立 revision 与 Project active ref；fixture 必须走同一正式路径，active ref 以 CAS 移动。PlanRevision 接受时固定解析出的精确 refs。缺失、悬空或内容不匹配的 ref 使 Plan 激活或 VerificationPlan 编译确定性失败，不能回退到内置默认值。

验证按成本和信息增益分层：

1. **静态层**：schema/type/build/lint、AST/symbol/import/call graph、Module/Interface/依赖规则、变更范围与 Artifact 完整性；
2. **动态层**：复用 affected/contract/smoke tests，Module/Stage join 运行 integration tests，GoalGate 对可测试行为运行全量测试；容器、沙箱、staging、probe 或遥测可产生 live Evidence；
3. **Reviewer 层**：静态和动态证据不能封闭的普通语义变化，由独立 Reviewer 使用紧凑 ReviewPacket 审查。

明确静态或动态 FAIL 先返工，不为它启动昂贵 Reviewer。只有机械证明无语义变化且 CompletionPolicy 明确允许时才能走无 Reviewer 快路径。

人类不是普通验证的默认第四层。没有机器 oracle 的审美/真实反馈、未预授权业务或架构变化、高风险/付费/不可逆操作以及策略无法消解的证据冲突，才进入 Human Decision。

## 5. Evidence、Binding 与当前有效证据集

### Evidence

Evidence 是不可变、可追溯的事实或 verdict，至少能回答来源、观察对象、覆盖范围、产生时适用的 revision、结果 `PASS | FAIL | INCONCLUSIVE` 以及 Artifact 引用。后续成功不得删除或改写先前失败。

### EvidenceBinding

EvidenceBinding 把一条 Evidence 解释到精确的 Task、AcceptanceObligation、VerificationRequirement、Workspace、Plan、ArchitectureBaseline、CompletionPolicy 和 VerificationPlan revision。Evidence 本身不可变；Binding 相对当前计划的 applicability 是派生结果：

- `APPLICABLE`：revision、scope、来源与有效期都覆盖当前 requirement；
- `STALE`：曾经适用，但相关 revision、scope 或有效期已经改变；
- `OUT_OF_SCOPE`：从未覆盖当前 requirement。

Supersession 与 applicability 分开。只有 CompletionPolicy/VerificationPlan 明确允许、且新旧 Binding 覆盖同一 requirement 和 scope 时，新 Evidence 才能 supersede 旧 Evidence 在当前 guard 中的位置。旧 Evidence 仍可审计。

### EffectiveEvidenceSet

```text
EffectiveEvidenceSet(taskRevision)
= 当前 VerificationPlan 为精确 revision tuple 选择的
  applicability = APPLICABLE
  AND 未被合法 supersede
  AND coverage 满足对应 requirement
  的 EvidenceBinding 所引用 Evidence
```

- 默认不累计所有历史 Attempt；策略明确要求累计时除外；
- 旧 FAIL 可被同一 requirement/scope 的新 PASS 合法 supersede，但不能被删除；
- 当前仍有效且未被 supersede 的 required FAIL 或 INCONCLUSIVE 会阻止满足；
- 相互冲突且策略不能唯一归约的当前 Evidence 必须继续验证或进入 Decision，不能以后到结果覆盖。

## 6. AcceptanceObligation、Task 与 Gate 的满足

required AcceptanceObligation 只有在其全部 required VerificationRequirement 都被当前适用 PASS 覆盖，且不存在当前有效、未被 supersede 的 required FAIL/INCONCLUSIVE 时才满足。

Controller 仅在下式成立时把 work Task 或 GateTask 的 phase 推进为 `satisfied`：

```text
TaskSatisfied(taskRevision)
= Task 属于当前 active PlanRevision
  AND disposition = active
  AND Task 映射的全部 required AcceptanceObligation 已满足
  AND 当前 EffectiveEvidenceSet 覆盖全部 required VerificationRequirement
  AND scope 内没有按策略阻断的未处置 Finding
  AND 没有未对账的高风险或 outcome_unknown 副作用
```

- CompletionClaim、Reviewer verdict、exit code `0`、单项测试或 Todo 勾选都不能单独满足 Task；
- `phase = blocked/failed` 或 `disposition = deferred/cancelled` 的 required Task/Gate 不满足；
- GateTask 不享有人工点绿捷径，仍应用同一 Evidence 公式；
- requirementLevel 只影响 Goal 汇总；optional Task 自身若显示 `satisfied`，仍必须满足同一公式。

## 7. ModuleProgress 与 StageProgress

`ModuleProgress` 和 `StageProgress` 是从当前 PlanRevision 重建的 ReadModel，不是 canonical state，也不是 Goal reducer 的输入缓存。

```text
ModuleProgress SATISFIED
= 该 Module scope 的 required work Task 全部 SATISFIED
  AND required ModuleGate Task 全部 SATISFIED

StageProgress SATISFIED
= 该 Stage 的 required work Task 全部 SATISFIED
  AND required StageGate Task 全部 SATISFIED
```

Goal 必须直接从底层 required Task、AcceptanceObligation、GateTask、Evidence 与副作用归约，不能因为某个投影错误显示绿色而完成。

## 8. Goal 完成公式

```text
GoalCompletionGuard(planRevision)
= active PlanRevision 通过全部非空约束
  AND 所有 required work Task 都 SATISFIED
  AND 所有 required AcceptanceObligation 都 satisfied
  AND 所有 required ModuleGate/StageGate Task 都 SATISFIED
  AND required GoalGateTask 集合非空且全部 SATISFIED
  AND 不存在未对账的高风险或 outcome_unknown 副作用
```

`COMPLETED` 只能来自该公式。用户、Worker、Reviewer 和 UI 都不能覆盖它。

Optional Task 不进入 GoalCompletionGuard，因此不会阻止 COMPLETED；但每个 optional Task 的 pending/running/blocked/satisfied、deferred/cancelled/superseded 处置必须在 ReadModel 和 Timeline 中保留，不能静默丢弃。

## 9. Goal reducer 的完整优先级

对每个合法 Goal/Plan 状态组合，Controller 按下列顺序选择且只选择一个 primary Goal phase；较低优先级事实仍作为 attention flags 展示：

1. `CANCELLED`：有当前有效、具 Goal 权限的取消 Decision；历史工作与失败不改写。
2. `CHANGE_PENDING`：目标、验收或 Plan 变更正在影响分析/确认，尚未激活新 revision；受影响子图保持安全停止。
3. `PAUSED`：当前 desired state 为 paused，且没有优先级更高的取消或变更状态。
4. `COMPLETED`：`GoalCompletionGuard` 成立。
5. `ACCEPTED_PARTIAL`：具有当前有效、具 Goal 权限的显式 partial-accept Decision，精确列出仍未满足的 required 义务及风险处置；CompletionGuard 不成立。
6. `PLANNING`：尚无 active PlanRevision，且仍存在可执行的规划、澄清或批准动作。
7. `RUNNING`：至少还有一个 required 前沿 ready/running/verifying，或存在可自动执行的 retry/replan；其他 blocked/failed 项作为 attention flags 展示。
8. `NEEDS_DECISION`：没有可继续推进的 required 前沿，且 required Task/Gate 被 deferred/cancelled、存在必须由人裁决的 Finding/主观 oracle/契约变化，或未知副作用需要授权处置。
9. `BLOCKED`：存在未满足的 required 义务，或尚无 active Plan 且规划/批准前沿被阻塞；无可运行前沿、无待决选择、无终局失败，且全部剩余前沿被真实输入、权限、环境或外部条件阻塞。
10. `FAILED`：存在未满足的 required 义务，其执行/验证或规划已终局失败，允许的 retry/replan 已耗尽，且没有尚待作出的授权选择；任何其他未覆盖的 canonical invariant violation 也 fail closed 为 FAILED 并产生诊断事实。

补充约束：

- required Task/Gate 的 blocked 不自动令 Goal BLOCKED；只要另有 required 前沿可推进，Goal 仍是 RUNNING；
- required Task/Gate 的 deferred/cancelled 不算完成，通常归约为 NEEDS_DECISION；若该义务不再需要，必须用 Decision 创建新 PlanRevision；
- required Task/Gate 的终局 failed 不得伪装为 BLOCKED；
- `ACCEPTED_PARTIAL` 是独立终局结果，不是 `COMPLETED` 的别名，也不把失败 Evidence 改写为 PASS；以后继续工作必须显式打开新 revision；
- 没有 active Plan 时不能因空集合真值进入 COMPLETED；
- terminal phase 不能靠普通 Command 回退；恢复、扩展或改变范围必须产生有权限的新 revision/Decision。

## 10. 权限边界

| 主体              | 可以                                                                               | 不可以                                                                |
| ----------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Worker            | 实现、运行工具、提交 CompletionClaim、改动清单、缺口和风险                         | 写 Task/Goal phase、修改 CompletionPolicy 或把 Claim 当 Evidence PASS |
| Evidence Provider | 产生静态、动态、live Observation/Evidence                                          | 发明业务要求、删除失败或完成 Task                                     |
| Reviewer Agent    | 按 contract/rubric 对剩余语义给出带来源 verdict                                    | 修改验收契约、直接写状态、移动 ArchitectureBaseline                   |
| Controller        | 校验 revision，编译/应用规则，唯一归约 Task、Gate、Goal                            | 猜测业务语义、覆盖失败事实或绕过非空 guard                            |
| Human             | 提供主观 oracle、业务事实，批准风险/例外/范围/重大演进，取消或 partial-accept Goal | 把已经发生的机械 FAIL 改成 PASS，或直接将 Task 标为 satisfied         |
| ReadModel/UI      | 展示状态、Evidence、处置和 Decision 来源                                           | 拥有独立 Todo 状态或写 canonical phase                                |

人类可以通过新 Decision/PlanRevision 改变未来义务；这与篡改旧 Evidence 或强制完成当前义务是不同操作。

## 11. Conformance test seam

任何实现必须只通过公开 Command、Fact/Event 和 ReadModel Interface 验证本契约，至少覆盖：

- 空 Plan、缺少 active required GoalGateTask、空 required obligation、空 required VerificationRequirement 均被拒绝；
- `parent_of` 不改变 readiness/完成，Stage 不隐式串行，Gate 只阻塞显式依赖者；
- 旧 revision PASS 变为 STALE，历史 FAIL 保留，新 PASS 只在合法 supersession 后生效；
- current required FAIL/INCONCLUSIVE 阻止 Task 满足；CompletionClaim 和 Reviewer 自报不直接写状态；
- 一个 required Task blocked、另一个仍可运行时 Goal 为 RUNNING；全部剩余前沿真实阻塞时才为 BLOCKED；
- required deferred/cancelled 导致 NEEDS_DECISION，而 optional 未完成不阻止 COMPLETED；
- COMPLETED、ACCEPTED_PARTIAL、CANCELLED、FAILED 在相同事实输入下确定性唯一；
- 无 active Plan 的 Goal 为 PLANNING/NEEDS_DECISION/BLOCKED/FAILED 之一，绝不因空集合完成；
- ModuleProgress/StageProgress 删除并重建后逐项一致，且损坏的投影不能改变 Goal phase。

## Explicitly not responsible

- 不定义数据库表、Event Store 布局、索引或事务实现；
- 不选择测试框架、静态分析器、Reviewer 模型或第三方 Provider；
- 不定义 Planner 如何拆任务或 UI 如何绘制 PlanMatrix；
- 不把 ArchitectureBaseline 演进塞进 CompletionPolicy；架构变化仍使用独立 Decision 与 revision 链。

## P0-06 review checklist

用户只需裁决以下产品语义，而无需审核存储实现：

1. requirementLevel、taskKind、disposition、phase 是否必须保持正交；
2. 是否只为真实版本化输入输出建立 RuntimeExecutionDAG 边；
3. 是否接受 active required GoalGateTask/义务非空与 Evidence applicability/supersession 规则；
4. 是否接受 Task/Gate 与 Goal 的完成公式及 reducer 优先级；
5. 是否接受 `ACCEPTED_PARTIAL` 与 `COMPLETED` 永久分开；
6. 是否接受普通完成由静态→动态→Reviewer→Controller 自动闭环，人只处理主观 oracle、授权与未预授权变化。
