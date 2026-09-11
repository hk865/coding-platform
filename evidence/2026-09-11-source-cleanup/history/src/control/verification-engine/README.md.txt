# VerificationEngine

编译检查计划并收集工具观察；整体完成由 Control 根据有效证据归约。

## 源码入口

- [verification-engine.ts](verification-engine.ts)
- [verification-service.ts](verification-service.ts)：命令、benchmark、记录审阅及报告查询的模块入口
- [verification-plan-compiler.ts](verification-plan-compiler.ts)：固定材料到内容寻址检查计划的纯算法
- [command-check-lifecycle.ts](command-check-lifecycle.ts)：命令日志、Evidence 接纳、租约副作用对账
- [benchmark-verification.ts](benchmark-verification.ts)：候选冻结及 original/diagnostic/repair 成绩资格
- [verification-journal.ts](verification-journal.ts)、[verification-reports.ts](verification-reports.ts)：兼容现有持久记录、完整报告与分块材料
- [recorded-verification.ts](recorded-verification.ts)：探索操作者审阅和外部 benchmark 的不同证据资格
- [exploration-report-verifier.ts](exploration-report-verifier.ts)：真实只读运行、成功 read 来源与探索报告资格
- [candidate-patch-check.ts](candidate-patch-check.ts)：实际 Git 反向检查候选补丁，不修改工作区
- [evidence-admission.ts](evidence-admission.ts)：共享 Evidence 接纳、Task/Goal 归约请求顺序
- [command-check-provider.ts](command-check-provider.ts)
- [code-graph-port.ts](code-graph-port.ts)
- [migration-gate-port.ts](migration-gate-port.ts)
- [role-output-completeness.ts](role-output-completeness.ts)：角色规格产出期望的**见证知识表**与逐类核对报告（RW-15／RW-16 建立；RW-18 起为审计信息，不再是门禁）

## 边界与接线

应用组合 `VerificationService` 并消费 [VerificationServicePort](../../contracts/verification-service.ts)，不再组织命令日志和归约顺序。当前正式材料、来源摘要、报告与恢复事实均通过 [VerificationContextPort](../../contracts/verification-context.ts) 读取，Context 实现分别是 [verification-context.ts](../../data/context-compiler/verification-context.ts) 与 [verification-migration-context.ts](../../data/context-compiler/verification-migration-context.ts)。Canonical 状态变更只提交 Control 的 Evidence、Patch、归约与租约端口。

候选工作树的遍历、ignore 与摘要字节规则归 [CandidateWorkspaceReader](../../data/workspace-reader/candidate-workspace-reader.ts)，通过 CandidateWorkspaceSourcePort 注入 Context。Context 只绑定当前作用域的注册根并读取来源材料。GitCandidatePatchCheck 由宿主以 CandidatePatchCheckPort 注入 VerificationService；真实补丁检查不在 Context 中执行。精确契约见 [verification-source.ts](../../contracts/verification-source.ts)。

真实命令检查、报告存储与持久 checkpoint 对账已有消费者；独立 Reviewer、返工和实际进程强杀后的全部恢复义务尚未闭环。

## 角色产出期望的见证报告（RW-15／RW-16 建立，RW-18 改为声明性）

轮次冻结材料时按 [RoleSpecReadPort](../../contracts/role-spec-materials.ts) 解析本 Run 绑定的角色规格（判据仍是 ControlEngine 那一份，组合根注入），对规格里的每一个产出期望判定「有哪条既有事实见证它确实被这次运行产出了」，结果写在轮次记录的 `roleOutputs` 上。

**RW-18 的取舍：保留知识，去掉门禁。** 用户判断「要求每个角色声明必须产出什么并逐次核对」会给 Agent 不必要的认知负担，而且这件事本质属于**记忆／交互历史**，不属于**角色规格**。因此：

- `requiredOutputs` 仍是规格字段、内容不动，仍随既有通道进入 ContextBundle（[work-run-materials.ts](../../data/context-compiler/work-run-materials.ts) 的 `RuntimeRoleSpecMaterials.requiredOutputs`），作为该角色的**产出期望**供 Agent 与读者参考；
- 核对结果**不再产生门禁后果**：不写轮次 `gaps`、不把 `outcome` 从 PASS 降为 INCONCLUSIVE、不在 `reduction.withheld` 上扣留归约（`reduction.withheld` 字段保留，只为不让 RW-15／RW-16 期间落盘的历史轮次失去既有记录，不批量重写）；
- **不是**「永远满足」的假声明：没有见证事实的种类仍在 `roleOutputs.missing` 里如实列出，逐类的原因仍在 `required[].detail` 里。它现在是**审计信息**（哪些产出被见证、哪些没有），不是完成判据。Evidence 照常接纳，Task/Goal 的完成仍只由 ControlEngine 依正式 Evidence 归约。

**退出条件**：当记忆模块接上产出核对（按工作／运行核对产出并对外提供历史事实）后，核对责任移交该模块；届时本文件随知识迁移，或退化为纯知识表而 VerificationEngine 不再调用它（唯一调用点是 verification-rounds.ts 的 `prepare()`）。

没有规格可依（端口未接线／未安装／绑定已不再被受理）记 `status: 'absent'`：如实说明、不阻断，也不假装核对过；早于本字段落盘的历史轮次为 `null`，不补算、不批量重写。

### 每一类必产出今天由哪条既有事实见证（RW-16）

见证通道是**全键穷尽**的表（[role-output-completeness.ts](role-output-completeness.ts) 的 `ROLE_OUTPUT_WITNESS_V1`，类型 `Record<RoleOutputKindV1, ...>`）：新增一类必产出而表里没有键，`npx tsc --noEmit -p tsconfig.json` 直接失败，强制逐键表态。轮次记录里的 `roleOutputs.required[].channel` 记下用了哪条通道。

| 必产出种类 | 见证通道 | 见证的既有事实（事实出处） |
| --- | --- | --- |
| `verification-verdict` | `run-bound-review-output` | 独立审阅运行的原报告：正式 `ReviewWork.output`（reportRef／reportDigest／runRef）绑定到本 Run，报告正文按 review-report-v1 校验后才落账（[reviewer-verification.ts](reviewer-verification.ts)、[reviewer-report.ts](reviewer-report.ts)） |
| `implementation-result` | `run-bound-patch-record` | 本 Run 的 canonical `PatchRecord`：按 `PatchRecorded` 事件的 `payload.runRef` 归因，再 `load` 聚合逐字段复核（[patch.ts](../../contracts/patch.ts)、[patch-record.ts](../control-engine/patch-record.ts) 的守卫） |
| `integration-result` | `run-bound-integration-result` | 本 Run 的 canonical `IntegrationResult` 记录：聚合按 (project, goal, task) `load`，只认 `runRef` 等于本 Run 的条目（[integration.ts](../../contracts/integration.ts)） |
| `conflict-report` | `run-bound-conflict-surface` | 同一条集成记录里已落账的冲突面：`conflicts`（机械检测 + 来源证据）／`escalate`／`explanation`；冲突无解释且未升级的记录会被 Control 拒绝（`conflict_unresolved`，零写） |
| `work-record` | `run-bound-execution-note` | 本 Run 的 canonical `ExecutionNote`：按 `ExecutionNoteRecorded` 的 `note.runRef` 归因，复核 body-first 正文引用与 `noFullTranscript=true`（[context-continuity.ts](../../contracts/context-continuity.ts)） |
| `answer-with-sources` | **null（今天无通道）** | 见下 |
| `proposal` | **null（今天无通道）** | 见下 |

**为什么这些见证不可能被模型自述伪造**：通道读的全是已提交事实（canonical 聚合 + 带 runRef 的落账事件），并且逐字段复核归属（runRef／taskId／workspaceId／planRef 全等）；落账这些事实的是 ControlEngine 的既有命令守卫 —— 补丁要求运行已结束、持有活动写租约、改动路径 ⊆ 租约范围、基于当前工作区版本；集成记录要求输入是已接纳证据；留痕要求作者运行已 link 进该工作身份且正文先落 Vault。轮次**不**用工作区变化反推产出（来源证明恒为 `runBaselineKnown: false`），也不读调用方声明或正文文本。事实不存在、读不到、账本事件扫描超过上限（256×256 条）→ 一律回落到**缺项**（fail-closed）。

### 仍无见证通道的两类（如实登记，不是「已满足」，也不再是门禁）

- `answer-with-sources`：平台今天没有把「带来源答案」归因到某个 dispatch Run 的事实。QueryJobAnswer 绑的是 QueryRun（P1-09 的独立运行身份，不是本 Run 的聚合），探索报告只落在探索会话 journal 与 Vault，审阅原报告则是审阅 Run 的逐条结论事实（已用于 `verification-verdict`）。**如实记录**：只读探索入口绑定的 `investigator`（其规格产出期望正是该种类）以及任何要求该种类的角色，`roleOutputs` 仍会把它列进 `missing`。**RW-18 起它不再扣留归约**；要让这条期望真的可见，需要一条「答案正文 + 来源清单 + 作者运行」一起落账、且 runRef 就是本 Run 的正式答案记录。
- `proposal`：`PlanProposalV1`／`InitialDesignProposalV1` 都不带 runRef，提案的正式承载是 ControlEngine 的受理链而不是某次运行的产物记录。**如实记录**：`planner`／`advisor` 角色的 `missing` 会列出它；同样**不再扣留归约**，直到提案记录带上提出它的运行身份。
- **必读材料通道已接通（RW-17）**：[work-run-materials.ts](../../data/context-compiler/work-run-materials.ts) 的桥表五类值都不再是 `null`——contract 取自已接受的 PlanRevision 快照、code 走既有 WorkspaceReader 的受权限有界读取、evidence 取 canonical 证据索引、decision 取自可归属的已接受决定、history 沿用既有工作上下文端口。装 executor 规格与含 roles 的矩阵之后，普通运行**能真正开始**（模型被调用、Run 以 completed 收口），并有「运行开始 → 本 Run 的 PatchRecord → 轮次 PASS → Task satisfied」的端到端回归。通道缺失、越权、工作区版本前进、索引与证据不一致仍一律 fail-closed。
- `implementation-result` 的可得性取决于运行是否**登记**了实现结果：见证只消费既有事实，不替运行补造。**普通运行今天不会自动登记 `PatchRecord`**（既有运行时写入路径不产出 P1-07 补丁记录），因此这条期望在普通任务上通常仍会出现在 `missing` 里 —— 它是如实陈述，既不是「已满足」，也（自 RW-18 起）不是完成判据。要让「运行产出自动成为实现结果」成立，仍需在运行收口接一次既有 `recordPatch`（属 WorkerRuntime 侧的后续义务）。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/verification-engine.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/verification](../../../tests/verification)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。

CommandCheckProvider 的 progress checkpoint 在命令前与报告落盘后分别持久化；effects 与 PASS/FAIL/INCONCLUSIVE 分类独立。Verification 内部负责租约对账与 Evidence 登记，Provider 不完成 Task。历史材料索引通过 `checkReportMaterials()` 取得已持久报告的来源引用，不能把执行 intent 或中断报告直接当作有效验收证据。
