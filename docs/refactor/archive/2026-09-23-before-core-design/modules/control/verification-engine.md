# VerificationEngine Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Control
module: VerificationEngine
code_dir: coding-platform/src/control/verification-engine/
contract_state: planned
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> 验证编排：组织工具检查与独立审阅，产出绑定当前义务与来源的验证结果，并把有来源的结果交 Control——**不自行完成 Task，不裁决完成**。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文。

## 1. 职责

**负责**

**内部责任与共用实现。** 轮次验证与生产单项检查保留不同生命周期：前者拥有全检查覆盖、配置冻结、恢复与聚合，后者拥有 checkpoint、租约和副作用状态。两条路径目标复用计划准备、能力规范化和已选检查执行；`VerificationEngineImpl.verify` 不是顶层服务入口，但仍由 `CommandCheckLifecycle` 的生产单项路径内部调用，不能按死代码删除。

- **验证编排（本模块的一句话职责）**：把工具证据与 Reviewer 证据组合成绑定当前义务与来源的验证结果；完成归约由 Control 执行（架构稿 §2 Module Registry；`VerificationPort.verify` 的实现说明）。
- **检查生命周期与 journal 状态机**：`CommandCheckRecord.lifecycle` = `intent_recorded`／`acquisition_rejected`／`lease_acquired`／`executing`／`report_stored`／`result_recorded`／`lease_released`／`observation_complete`／`reconciliation_required`（`contracts/verification-service.ts`）。执行 checkpoint 落盘失败**禁止启动命令**；报告 body 落盘与 `VerificationResult` 登记**分开**；报告独立保存 `effects = not_started／known／unknown`，**不得用 `timeout`／`stale_source` 等结果分类替代副作用状态**；未知副作用保留独占租约，重复 `requestId` 不重跑。
- **轮次编排**：`startRound`／`round`／`resumeRound`（`verification-rounds.ts`）持有明确 Task／Run 的不可变检查配置、完整来源身份、唯一子检查及覆盖集合；同类型的**全部适用检查各执行一次**，覆盖关系独立保存；聚合规则＝**FAIL 优先，其次 INCONCLUSIVE，全部 PASS 才 PASS**；正文绑定完整原报告集后才请求 Control 接纳。无对应 VR 的额外适用工具失败**仍影响轮次结论**，但不增造 Evidence 覆盖；托管子检查禁止从旧单项接口单独接纳（防止后项 PASS 覆盖同一 VR 的 FAIL）。
- **独立 Reviewer 工作的组织与汇合**：`ReviewerVerificationPort` 的实际审阅方法（`reviewMaterial`／`startReview`／`recoverReview`／`review`／`reviewReceipt`／`resumeReview`）＋ 只读 `openIssues`；`reviewer-report.ts` 验证逐 VR 覆盖、原工具报告、引用与结论资格；`reviewer-record.ts` 保存请求／采用协议后的归约、原报告 assessment、正式接纳与结果后归约 checkpoint。**模型执行交给 Dispatch**；本模块只消费 canonical `Work.output` 原报告；临时缺料、永久格式拒绝与合法 `FAIL`／`INCONCLUSIVE` 各自保存；**失败不能用新请求重抽清除**，Task 结果不复制到 GoalGate。
- **命令检查消费者（真实执行面）**：`CommandCheckProvider` 使用内置 `ProcessSandbox` 执行明确配置的 static／dynamic 命令；上下文匹配 Project／Goal／Task／Plan／Workspace revision 并绑定工作树内容摘要，前后变化使结果 `INCONCLUSIVE`；**命令退出失败（FAIL）、超时、运行异常、环境失败与缺少副作用确认分开记录**；报告保存到 Vault，**保存失败不能输出已确认结果**；命令通过不是 Reviewer 结论或整体完成。
- **HTTP 与恢复入口**：`/api/real/verifications/run-check`（接受用户明确授权的命令、类型和单次超时；仅允许已结束且无待对账运行的开发工作区；持有独占工作区租约；重复 `requestId` 不重新执行，参数改变拒绝）；`check-report`（读取结果登记前已落盘的原报告）／`reconcile-check`（只消费完整性校验后的报告和 Ledger 租约）／`check-evidence`（要求精确 `reportDigest`，重核 Task／Run／Plan／Workspace 与当前内容摘要，先记 pending 再提交原子 Evidence）。
- **返工重验与审阅准备**：`reverifyRework` 与 `prepareReworkReview`（`rework-verification.ts`）——经 Context 读取正式新承担者及原问题，继承原冻结工具配置并限制到当前 Task，使用既有轮次／检查 journal 完成执行和恢复。**旧版本、未受理来源与未知副作用不盲目重跑**；Verifier 不用 journal PASS 或本地 Reviewer decision 另算一套处置资格。
- **报告资格检查的三类消费者**：普通只读任务（`readonly-report-check.ts`，只提供机械的报告／来源检查，不能用只读 Run 执行命令）、探索报告（`exploration-report-verifier.ts`：只接受完成且正式匹配的只读运行、最终助手报告与成功的真实 read 轨迹）、普通 GoalGate 独立取证（`startRound`／`startReview` + 显式 `scope.gateSubject='goal'`，自己编译义务、重新执行检查、保存报告并请求接纳，不复制 Task PASS、不伪造 Gate Worker Run）。
- **只读观察**：`queryFacts` 只读观察轮次、Reviewer 实际执行／正式接纳与当前来源适用性；**不启动或重做验证**；并发 journal 变化不混合为成功结果。
- **证据受理请求的确定顺序**：`evidence-admission.ts` 共享"接纳证据 → Task 归约 → Goal 归约"的顺序；本模块只提交请求，**正式接纳与归约在 Control**。
- **迁移门禁与补丁／图能力**：`MigrationGatePort.run(...)`（无真实检查／Evidence provider 时明确返回 `unsupported`，**版本相等不能证明检查通过**）、`CandidatePatchCheckPort`／`GitCandidatePatchCheck`、`CodeGraphPort`。
- **`requiredOutputs` 见证（自 RW-18 起是声明性产出期望）**：`role-output-completeness.ts` 按同一张见证表逐类核对并如实写进轮次记录的 `roleOutputs`（`status: complete／incomplete／absent`）；**缺项不再降级轮次结论、不再扣留归约、也不再写进轮次 gaps**；保留字段与内容并随既有通道进入 `ContextBundle`。**移除其独立门禁不改变 Plan 的 `AcceptanceObligation`／`VerificationRequirement`**——正式验收义务与要求继续按原验证与归约规则执行。
- **结果分类的取值集合（按契约逐字使用，不得互相冒充）**：`FAIL`／`INCONCLUSIVE`（证据与检查结论）＋ `timeout`／`stale_source`／`interrupted`／`unsupported`／`incomplete`（生命周期与恢复的如实分类）。**不得用 `timeout`／`stale_source` 替代副作用状态 `effects`**，也不得把 `unsupported`／`incomplete` 写成 PASS。
- **持有**：检查／审阅 **journal** 与**原始问题材料**；canonical 运行产出经 Context 取得（`RunOutputMaterialPort.runOutputWitness`），**不直读 Ledger**。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| **不自行完成 Task、不制造 Evidence 结论、不裁决完成、不制造决定** | ControlEngine：`submitEvidence`／`reduceTask`／`reduceGoal`（不变量 #2／#6）+ CompletionPolicy 的完成归约义务；人的决定走 HumanCollaboration → ControlEngine |
| **问题材料的传交经组合根单向完成** | 组合根捕获问题材料后传给 Dispatch（`harness/rework-composition.ts`）；本模块只提供只读出口 `ReviewerVerificationPort.openIssues`（`/api/real/rework/issues`） |
| 不降低轮次结论、不扣留归约（`requiredOutputs` 缺项只是审计信息） | 轮次结论按 FAIL 优先／INCONCLUSIVE 规则在本模块内聚合；归约判据只在 ControlEngine |
| **工具轮次不替代 Reviewer 资格** | 独立 Reviewer 资格与正式 ReviewWork／ReviewResult 由 ControlEngine 归约；本模块只组织审阅运行与保存原报告 |
| 不执行模型、不发起独立审阅运行 | DispatchEngine（`reviewer-dispatch.ts` 的 `ReviewerDispatch`）+ WorkerRuntime（`RunPort`） |
| 不取材、不组装 `ContextBundle`、不产出 `selectedRefs`／`gaps`／manifest | ContextCompiler：`VerificationContextPort`（`resolveVerification`／`resolveRound`／`runOutputWitness` 等） |
| **不直接读 Ledger** | canonical 运行产出与 load／events 适配经 ContextCompiler（`RunOutputMaterialPort`）；租约与 Evidence 的原子提交在 StateLedger |
| 不写正文、不判定材料的授权适用性 | ArtifactVault：`put(record)`／`open(ref, accessScope)`；授权判定沿用 `MaterialAccessResolver`（`rejected/stale`、`rejected/invalid`、`unavailable`） |
| 不生成返工提案、不受理返工 | PlanCompiler（`rework-proposal.ts` 机械推导）+ ControlEngine（`acceptReworkProposal` 四条边界） |
| 不做义务处置解释、不重算处置资格 | ControlEngine：`ControlReworkDisposition.projectIssues`（canonical 版本移动返回 unknown） |
| 不激活 baseline、不做迁移决策、不登记门禁与激活 | Control／基线演进集成者（门禁与激活的正式登记）；本模块只**只读运行**门禁并如实返回 `unsupported` |
| 不建第二套执行器或租约状态机 | 复用既有 `CommandCheckLifecycle`／`Provider`／`Journal`；租约状态机在 ControlEngine + StateLedger |
| 不解释自然语言、不渲染结果给用户 | HumanCollaboration（读侧消费真实报告与回执）+ Host／UI |

## 2. 对外接口

**接口命名口径**：以真实 Port／实现名为主；架构名义名用括号对照，例如 `VerificationPort.verify`（架构名义名 `verify(intent) → verification ref`）。

**必须如实标注的一条**：生产顶层轮次入口是 `VerificationService`（`verification-service.ts`，由 `app/service.ts` 装配）；`VerificationEngineImpl.verify` 不是该顶层入口，**但仍由 `CommandCheckLifecycle` 的生产单项检查路径内部构造并调用**。本页保留这两类语义并要求共用准备/执行步骤；精确签名与生产入口整理属 架构稿 §9.2 第 2／4 份契约。

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `VerificationPort.verify`（现状） | `CommandCheckLifecycle` 的生产单项路径 | 单次验证请求 → 有来源的检查结果 | 不裁决完成；无轮次绑定时仍调用 `VerificationEngineImpl.verify` | 保留单项语义；准备与执行迁到模块内共用实现，不删除旧入口 |
| `VerificationService`（现状顶层轮次入口） | 宿主/API 适配、返工组合 | 轮次启动/读取/恢复、审阅与返工请求 → 轮次、报告、问题视图 | 同请求不重跑；配置改变不重绑旧轮次；只读查询不写状态 | 保留；轮次覆盖/冻结/恢复/聚合差异不被共用实现吞掉 |
| `ReviewerVerificationPort`（现状） | Host/API 与 rework composition 适配 | 审阅材料与请求 → 审阅视图、报告回执、未处置问题 | 失败不能靠新请求清除；Task 结果不复制到 GoalGate | 保留；此入口当前由 Host 消费，不形成 Dispatch→Verification 边；Human 的既有消费见下方报告端口 |
| `MigrationGatePort.run`（现状） | Host 的基线演进集成者 | candidate、workspace revision、plan ref → pass/fail/stale/unsupported | 无真实 provider 返回 `unsupported`；缺 planRef 失败 | 保留只读门禁；Host 装配不形成 Reconciler→Verification 边 |
| `CodeGraphPort.codeGraph`（现状） | Host 图查询适配 | 工作区版本查询 → supported/unsupported/stale/rejected | stale/unsupported 对需要图的验证失败关闭 | 保留当前公开 provider；Host 转发不形成 Reconciler→Verification 边，真实图生产者仍未接 |
| `RecordedVerificationPort`／`ExplorationReportPort`（现状） | HumanCollaboration 的探索会话；Host verification/exploration 适配 | 已有检查或操作者审阅 → 正式 Evidence 请求/资格结果 | 内部经 Control 复核当前版本；只接完成且正式匹配的只读运行 | 保留既有结果受理面；Control 是本模块消费依赖，不是此入口调用者 |

**内部映射与消费面**

| 内部类／端口 | 责任与去向 |
| --- | --- |
| `VerificationEngineImpl`／`CommandCheckProvider` | 生产单项内部执行；与轮次共用准备、能力规范化、已选检查执行。 |
| `CheckPort`／`CandidatePatchCheckPort`／`VerificationContextPort` | 本模块消费面，统一列在 §3，不作为本模块提供接口。 |
| HTTP 路由 | 宿主转发，不计 Module 公共接口或逻辑边。 |

**本次变化方向**：见 §7（此处只写一句指引，细节放第 7 节）。

## 3. 依赖

`allowedModuleDependencies[VerificationEngine] = { ControlEngine, ContextCompiler, ArtifactVault }`——**3 条边，全部既有，本轮不新增**。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| ControlEngine | `VerificationControlPort = Pick<ControlEngine,'submitEvidence'\|'reduceTask'\|'reduceGoal'\|'recordPatch'>`（`verification-deps.ts`）；`ReworkDispositionPort`（`ControlReworkDisposition.projectIssues`） | 正式 Evidence 请求与 Task／Goal 归约请求；义务处置的只读解释 | 既有 |
| ContextCompiler | `VerificationContextPort`＋`RunOutputMaterialPort.runOutputWitness`（`resolveRound` 提供轮次所需完整身份；`openReport` 按授权开报告正文） | 精确版本材料、canonical 运行产出见证、政策／baseline 解析、轮次与任务／目标归约 revision | 既有（**语义收紧**：对账与选材统一走 §6.2 的有界选材；load／events 与读取适配归 ContextCompiler） |
| ArtifactVault | `ArtifactPort.put(record)`／`open(ref, accessScope)`；授权适用性由 `MaterialAccessResolver` 判定 | 原始检查报告、审阅报告与 problem 材料的正文持久与按授权读取 | 既有（**语义收紧**：审查材料从"装正文"改为 **L3 引用 + 按需正文**，见 §7） |

**非 Module 执行适配**：`CheckPort`／`CandidatePatchCheckPort` 由 Host 注入实际检查能力；它们是本模块消费的执行适配契约，不是本模块新增提供面，也不代表与 Dispatch/Runtime 新增逻辑边。

**不变量与边界**：本模块不依赖 StateLedger（canonical 运行产出经 `runOutputWitness` 取得，租约与 Evidence 属 StateLedger 但由 Control 归约）；不依赖 DispatchEngine（模型执行由 Dispatch 承担），**两者之间没有任何依赖边**——验证请求形成**既有正式任务／派发事实**，由**既有入口**执行：经 ControlEngine 受理、由 DispatchEngine 的既有派发路径承担（`reviewer-dispatch.ts` 的 `ReviewerDispatch` + `RunPort`）；不依赖 WorkspaceReader（源码摘要经 Context 转达）。

## 4. 被依赖

反向表（架构稿 §3 依赖 DAG 的反向推导）共 **1 条 Module 边**。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| HumanCollaboration | `ExplorationReportPort`（`exploration-session.ts` 的报告核验端口）；`RecordedVerificationPort`（`contracts/verification-service.ts`） | 探索报告的来源资格核验；既有真实检查／操作者审阅转正式 Evidence 请求 | 【代码】`interaction/human-collaboration/exploration-session.ts`；架构稿 §3 依赖 DAG 的反向推导 |
| 宿主边（**不计入 38 条**） | `harness/rework-composition.ts` 构造 `ReworkIssueReadPort`，只读消费 `openIssues`（`/api/real/rework/issues`）；`app/service.ts` 装配 `VerificationService`／`ExplorationReportVerifier`／`GitCandidatePatchCheck`／`CodeGraphPortImpl` | 未处置问题材料的捕获与转交（再传给 Dispatch）；HTTP 适配与关闭排空。**宿主不是 Dispatch 的回调通道**：不注入"让 Dispatch 查询 Verification"的回调 | 架构稿 §3.1「三种边必须分开」；`module-boundaries.md` §自动返工 |

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| 检查／审阅 **journal**（`CommandCheckRecord.lifecycle` 九态、`reviewer-record.ts` 的 checkpoint） | 否（中间日志属应用持久文件） | 本模块（`verification-journal.ts`／`command-check-lifecycle.ts`） | 运行／**挂起·恢复**（journal 恢复与对账） |
| **原始问题材料**（未处置问题清单） | 否（只读归一） | 本模块 `openIssues`（`/api/real/rework/issues`）；处置解释在 ControlEngine | 运行 |
| 轮次记录与覆盖集合（`VerificationRoundRecord`、检查绑定） | 否（记录／候选） | 本模块（`startRound`／`round`／`resumeRound`）；正式事实需经 Control 接纳为 Evidence | 运行 |
| 原始检查报告正文与审阅报告正文 | 否（正文） | ArtifactVault（`put`／`open`）；本模块只保存引用 | 运行 |
| 租约（独占工作区租约） | 是 | StateLedger（提交）＋ ControlEngine（`acquireWorkspace*Lease`）；本模块持有租约的申请结果与 `leaseId` | 运行 |
| Evidence 与其适用性 | 是 | ControlEngine：`submitEvidence`（#2／#6） | 运行 |
| Task／Goal 归约 phase | 是 | ControlEngine：`reduceTask`／`reduceGoal` | 运行 |
| `RuntimeRecord`／运行产出与公开观察 | 否（观测） | WorkerRuntime；本模块经 `RunOutputMaterialPort.runOutputWitness` 取见证，**不直读 Ledger** | 运行 |
| `RoleOutputWitness` 见证事实（`roleOutputs` 的 `complete／incomplete／absent`） | 否（审计信息） | 本模块 `role-output-completeness.ts`；**缺项不降级轮次、不扣留归约** | 运行 |
| `ContextBundle`／`selectedRefs`／`gaps`／manifest | 否 | ContextCompiler（唯一生产者） | 初始化／运行 |
| ArchitectureBaseline 与迁移门禁记录 | 是 | 登记＝ControlEngine／基线演进集成者（CAS，不变量 #13）；本模块只**只读运行**门禁（`MigrationGatePort`） | 架构演进（不属本模块的五阶段动作） |
| 四态 `working`／`standby`／`paused`／`archived` | 否（Session／工作卡片状态） | canonical 归约在 ControlEngine；投影在 ReadModelIndex；本模块不持有 | 不适用 |

**本模块拥有的对象**：检查／审阅 **journal**；轮次记录与覆盖集合；原始问题材料；报告正文的**引用**；`RoleOutputWitness` 见证事实；审阅请求与恢复记录。在 Role／Session／Run／Work 里，本模块只真正持有 **Run 的验证侧记录**（轮次与检查绑定到精确 `RunRef`／`TaskRef`），**不持有 Role、Session、Work 的任何实体**。

**本模块不拥有的**：canonical 完成状态与 Evidence（ControlEngine）；Task／Goal 归约（ControlEngine）；租约与事件提交（StateLedger）；运行与能力声明（WorkerRuntime）；材料与其编译输出 `selectedRefs`／`gaps`／manifest（ContextCompiler）；正文持久化（ArtifactVault）；`AgentInstance`／`RoleBinding`（ControlEngine 归约 + DispatchEngine 签发）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化（项目认知初始化）／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另 §4.2 列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**。
>
> **本模块的归属阶段／动作**：**运行**（轮次与审阅编排、证据受理请求）与**挂起·恢复**（journal 恢复、`reconcile-check`、`recoverReview`、`resumeReview`）；不承担四动作中的任何一项（压缩／归档的执行与提案都不在此）。

## 6. 旧标识去向

按架构稿 §9.3（七条最小迁移规则）与 §4.5（R-1、标识取舍表）表态，属于本模块的部分如下。

- **本模块不持有 `AgentInstance`，也不写任何 `agentId` 字段**：verdict 与 Evidence 必须能追溯"**哪条 Session、哪次 Run** 在哪个来源版本下产出"（不变量 #6）——**这就是把 Session 身份引入本模块接口的方式**（I7 的落点），而不是在本模块新建实例标识。绑定形状属 架构稿 §9.2 第 1／2 份契约。
- **轮次身份保留**：`VerificationRoundScope` 的 Project／Goal／Workspace／Task／Run 与 `reportDigest` 一类身份字段沿用；**旧单命令记录**带 `root`／`name`／`bindingDigest` 等挂载字段时，只按**原字段精确复算指纹**并核对原命令／种类／超时，**保留原文件身份，不批量重写历史**。
- **旧事件语义不变**：既有事件不可原地改变 v1 含义，演进必须新增 `schemaVersion` 与兼容策略，未知版本继续拒绝（架构稿 §7.3）。
- **`workId` 与工作身份材料**：本模块不持有、不解析；工作身份材料经 Context 取得（`resolveRound` 的完整身份），处置解释在 ControlEngine。
- **Kernel 原始记录与平台正式状态不是同一事务**：报告**先落盘**（Vault）再登记 `VerificationResult`；重开后 `running` 与未确认释放的 `finished` 都需对账；副作用未知就核对、**不自动重跑**，重复 `requestId` 不重跑。
- **本模块不产生"稳定新主体"**：不新增独立的验证侧身份体系；`Evidence` 的绑定锚沿用既有 `submitEvidence` 语义。

## 7. 本次接口变化方向

**新增/复用/迁出或删除。** 目标给 verdict 增加 Session 与来源版本绑定；在模块内部抽取轮次与单项检查共用的计划准备、能力规范化和已选检查执行。`VerificationEngineImpl` 继续承载生产单项内部语义，不能直接删除；确认兼容适配或入口整理后，才删除重复准备分支。当前源码尚未完成该抽取。

对应项号：**I7（主）＋ §6.2.3 审查材料面** ｜ 接口名：`VerificationPort.verify`／生产入口 `VerificationService`（轮次、审阅与 `openIssues` 同一服务）｜ 方向：verification ref **绑定 Agent／Session 身份与来源版本**——返回形状**以源码摘要为准标"现状"**（现状：`verify(request) → VerificationResultV1`、执行面为 `VerificationService`），目标另列为"结果携带产出该 verdict 的 Session／Run 身份与来源 revision"；同时**审查不再默认装正文**——正式 Evidence／Decision／契约走 **L3 引用**，当下代码与外部参考走 L1／L2，需要正文时按需经授权打开（`open(bodyRef, {requesterRunRef, usage, currentBasis})`），**实际读入内容与缺口写进 manifest** ｜ 边动作：**保留**（`→ ControlEngine`／`→ ContextCompiler`／`→ ArtifactVault` 三条依赖边语义不变，**不新增边**；Verification 也不新增对 StateLedger 的直读）｜ 理由：不变量 #6 要求每个 Evidence／verdict 绑定 revision 与来源，复用 Session 后必须能回答"哪条 Session、哪次 Run 在哪个来源版本下产出"；审查链路的**有界性改由"引用 + 按需正文"保证**，而不是由"多装材料"保证（架构稿 §9.2「可以后置」列：审查材料全面改为 L3 引用 + 按需正文）｜ 不变量：**#2／#6／#28**（材料三级不得互相冒充；复用不沿用旧授权另涉 #17）。

## 8. 信息缺口

- **R03 拒绝路径政策归属仍待架构决定**：当前 `CommandCheckProvider` 有拒绝前缀副本，而 VerificationEngine → WorkspaceReader 不在既定 38 条逻辑边中。候选一是把稳定公共协议值放入有 owner 的共享契约，路径规范化、符号链接/越界判定与沙箱执行仍留在实现；候选二是由 WorkspaceReader 提供窄政策面并先在上位架构新增逻辑边。Host 注入不消除依赖，本稿保持现有边，不把任一候选写成已采用，也不把整套文件访问政策下沉 Contracts。

- **对齐架构稿 §11.4.3**（引用，不重新推导）：① 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、旧标识兼容映射）→ 架构稿 §9.2 第 1 份契约（**verdict 绑定 Session 身份的承载字段在此**）；② 各 Port 的精确形状、字段命名、装配点（含 Kernel 适配面划分）→ 架构稿 §9.2 第 2／4 份契约；③ 工作卡片与三种记录的查询接口、筛选字段 → 架构稿 §9.2 第 3 份契约（本模块的 journal 与 manifest 记录不另建数据库）；④ 迁移切换点、删除顺序与回滚方式（**含普通／Reviewer／Handoff 调用点**）→ 架构稿 §9.2 第 4 份契约与 Prompt 6；⑥ 度量口径的具体采集实现 → 按 U12 指标表，标"待测"；⑦ 生产 `lifecycleControl`／continuation 能力开关的放开与 Kernel 接线验证 → §11.4.2 第一行，真实连续任务验收。
- **本模块新增缺口**：
  1. **端口产出 observation 草稿尚未自动接纳 Evidence**：`run-check` 当前端口产出 observation 草稿，**尚未自动接纳 Evidence／Reviewer／返工状态机**（本模块历史切片原话）；`check-evidence` 是一条显式入口，不是自动通道。
  2. **`MigrationGate` 无真实 provider 时返回 `unsupported`**：接入真实迁移检查／已登记 Evidence 仍是后续核心功能义务；旧身份 helper 不构成真实验证能力。
  3. **未配置的通用 Reviewer 验证返回 `incomplete`**：真实应用未配置时如实返回 `incomplete`，不伪造覆盖；缺项由独立 Reviewer 流程承担。
  4. **独立进程强杀恢复仍待覆盖**：重开对账只覆盖 `running` 与未确认释放的 `finished`；进程被强杀的恢复路径仍在复验（`human/module-status.md` 本模块条目：「广泛多工作与强杀断点未据此完成」）。
  5. **C-9**：顶层轮次入口走 `VerificationService`，而 `VerificationEngineImpl.verify` 仍被生产单项检查内部调用。后续应共用准备与执行支持并保留轮次差异，不能误删旧类，也不能长期维护两套重复准备过程。
  6. **`requiredOutputs` 的后续归属未定**：自 RW-18 起它只是声明性产出期望，退出条件写在 `role-output-completeness.ts` 文件头；后续产出核对属现有 12 Module 内的记忆能力，**不据此新增 Module**，具体后续工作未在本次实施。
  7. **同一任务的必要重审联合链、连续失败与中途恢复仍待完整验收**（`human/module-status.md` 本模块条目）；这些是实现与验收缺口，不改本页的接口方向。

## 9. 重构目标与质量验收

本节已纳入本轮模块文档要求；通用依据见[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。以下均为目标，**源码达成待验证**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| §1/§8 的轮次与单项检查有重复准备，`VerificationEngineImpl` 仍有生产内部消费者 | 分开准备、能力规范化、执行与两类生命周期；保留单项 checkpoint/租约/effects 和轮次冻结/覆盖/恢复/聚合 | S04 沿用 `compileVerificationPlan`/`executePlannedCheck`；消费者迁移前不删旧类，之后删除重复准备 | 相同输入验证共同计划/执行，并分别覆盖单项副作用与轮次聚合（RG-01、RG-02、RG-03；CQ-01、CQ-02、CQ-04、CQ-08、CQ-12；S04） |
| §2 有多个真实提供面，顶层是 `VerificationService`，结果还需绑定 Session/Run/revision | 各入口明确调用者、三态/报告、错误和副作用；绑定字段留待契约，不把目标签名当现状 | Host/Human/command-check 消费者按真实入口保留；共同步骤不升级为公共 Port | 覆盖 `ready/incomplete/rejected`、verdict 与 lifecycle/effects 分类，并可追溯 Session、Run、来源（RG-01、RG-04；CQ-01、CQ-03、CQ-05、CQ-06） |
| §8 的拒绝路径 S09 owner 未定，强杀/联合链和成本也未验收 | 按架构边界接线；journal、报告引用、Evidence 受理分离，未知副作用先对账，未测收益不宣称 | S09 决策前不借 Host 隐藏边；S04 在本模块、S06 在 Context 内各自收敛已确认重复，安全拒绝不与索引 ignore 合并 | 边界脚本加装配／调用审查，确认无隐藏逻辑边；覆盖重复请求、重开、强杀、写报告后接纳失败、stale/unknown effects；测准备/打开/检查/恢复成本（RG-03、RG-04、RG-06；CQ-06、CQ-08、CQ-09；S04、S06、S09） |

专项关注：共同准备不能吞掉单项副作用或轮次冻结/聚合语义，消费者未迁移前不得删除旧类。状态：S04/S09、强杀恢复和成本待验证。
