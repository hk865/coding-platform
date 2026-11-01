# 第 9 片规格：执行结果审阅、只读报告见证边界、真实冲突与真实验收、量线长

lead，2026-11-01。代码、测试行号按基线 `7570e87`，文档行号按同一时刻的文档。未合入片（7D2、6C、L2、7D1、PL、8B-2、8C、8E）按各自规格的基线，落地后只重指 `file:line`，不改规则。

状态：**已冻结（lead，2026-11-01）**。Codex 两次完整审查（21 条、16 条）和一次快速核对（3 条）都已并入，决定 56 的上限用完。§0.1 的 U1–U5 待用户定，不挡施工的顺序：第 9 片排在 6C 之后。范围按 `DESIGN.md:1294`（§8.2 第 9 行）和任务书四块收账；只读报告见证按 `DESIGN.md:1479`（§9.5）只写边界与现状，不并入本片施工（见 §4、L6）。审阅按 lead 2026-11-01 的改裁定 L2-c 写成系统轮，不是 Work Run。全文没有行数预算，只有估计（§12）。

**一句话。** 让采用的计划要求的执行结果审阅真正起得来、读得到三样、结论进检查证据并能完成；把真实冲突和真实模型验收做成可逐场景判定的证据；量出线长和缓存命中，供你决定 K2 进不进 MVP；只读报告见证另开片，本片只交编排这部分的证据。

## 0. 一页说明（给用户）

**要解决什么。** 第 9 片是编排后端最后一片（K2 除外）。它要关掉三个一直挂着的问题：① 采用的计划要求独立审阅时，今天没有任何代码起审阅者，检查状态机还明确拒绝审阅证据（`src/core/work-graph/state/verification-machine.ts:1098-1101`）；② 真实冲突只有提示和比较，没有从正式入口做过逐场景验收；③ “线多长、缓存命中多少”没有真实数据，K2 进不进 MVP 一直悬着（决定 39）。

**怎么改。**
- **冲突前提**：先实测 Kernel 写文件（§5.2.2），再决定实际共享冲突的验收判据；冲突编排本身生产代码 0，只做夹具/验收。
- **审阅**：Workflow 在命令检查跑完后、finalize 前，读当前采用计划里的 required `kind: 'reviewer'`；有要求才发一轮审阅系统轮（审阅线的 Query），没有不强加。审阅者用普通只读文件工具、`look_graph`/`find_graph`、原历史读取看三样；结论写成一条 `verdict` Evidence，进本轮 `evidenceRefs`，finalize 接受并按 coverage 折叠；缺审阅或审阅过期不 PASS。
- **冲突与验收**：不另造冲突图。复用已有的重叠门、`architecture/compare-formal`、`project_source compare duplicates`，8E 的联系读口在它合入后可选；第 9 片补的是这些出口的验收接缝，以及从 CLI + HTTP 正式入口跑 E05/E06/E08/E09/E12、方案迭代、直接干预、等待的验收驱动和证据格式。
- **量线长**：不新存记录。直接用 2B 已存的逐请求用量（`RunActivity`/`QueryActivity`）算每条工作线最近一次输入的 token 和 `cachedInputTokens`；查询线今天就能算，执行者线缺“按线取最近一次”的公开读口（L8）。
- **只读报告见证**：按设计不属本片。本片只查清代码里已有多少（端到端 0，可复用底座约 60%），把边界和缺口交给另开的一片（§4）。

**范围变了什么。** 相对设计书，本规格把“冲突”并入真实验收块收账，把“只读报告见证”明确划出本片，把“记忆基准集/性能测量”单列为清单里另归第 9 片的事项（§6.4），等 lead 裁是否并入。除此之外不新增需求。

**不改什么。** 计划候选审阅（PL-1）不改；`reviewAdmissionProtocol` 不启用；`ReviewWork` 的旧材料授权不复活；证据种类仍是 `claim | observation | verdict`，完成状态仍是 `PASS | FAIL | INCONCLUSIVE`；不新增 `witness` 职责、不新增 `Report` 聚合、不新增冲突图；E3 界面不做。

**改完你能看到什么。** 一个要求审阅的计划跑完后：系统轮消息、Query 答案、一条 `verdict` Evidence、轮次折叠结果都可读；审阅结论带依据进检查证据，Task 能到 `satisfied`、Goal 能 `COMPLETED`；没有审阅要求的计划不会多出审阅者。一轮真实验收报告能按场景看到“通过/失败/未覆盖”、正式入口操作、对象引用链、实际模型调用和 token；一张线长表能按线看到最近一次输入、缓存命中、是否超 500K、样本是否完整。

### 0.1 要你定的（产品问题）

**现状。** 真实模型尚未授权（U1）；规划轮没有 131072，默认 4096、工作台 16384（U2）；K2 维持决定 39（U3）；树里没有界面（U4）；记忆基准 0 条（U5）。

| ID | 问题 | 可选 | lead 建议 | 状态 |
|---|---|---|---|---|
| U1 | 真实模型调用的授权 | (a) 每次运行前单独点头；(b) 给一个窗口：场景清单 + 模型/费用上限，窗口内逐场景跑，越界停 | b。窗口写进验收配置，报告逐场景记授权原文；没有窗口就只跑不花钱的夹具 | 待你定 |
| U2 | 131072 用哪个 provider/模型，拒收怎么办 | (a) 只测 DeepSeek 1M 窗口模型；(b) DeepSeek + OpenAI 都测；(c) 拒收就降到 16384 | a，先测 1M→131072 与 128k→64000 两格；拒收记 `provider_request_failed`，**不静默降**；换 provider 或降预留都要你另定 | 待你定 |
| U3 | K2 进不进 MVP | (a) 维持决定 39，不算门槛；(b) 只把第一步“清旧工具结果”提进 MVP；(c) 整片 K2 进 | 先按 a 跑到量完；若参谋/书记线“常常太长”，按 b，摘要仍在 MVP 之后（`DESIGN.md:1049`） | 量完后你定 |
| U4 | “用户能看到”是否接受 HTTP 读模型 | (a) 本轮接受 CLI + HTTP 读模型，浏览器核对记未覆盖（E3 未到）；(b) 等 E3 后再补浏览器证据 | a。`src/ui` 已删，页面请求回 503；验收不拿“没界面”判场景失败 | 待你定 |
| U5 | 记忆基准集是否值得跑完整规模（若 L11 并入本片） | (a) 完整 10k 文件/20k 注记/100k 版本；(b) 先缩小规模看趋势再决定 | 先完整跑 SQLite 单读者 + 重建，再扩并发/内存；缩水必须标“未覆盖” | 待你定 |

> 不在本表问的：只读报告见证的归属。设计已经写“不在任何一片、MVP 门槛前另做”（`DESIGN.md:1479`，`plan-loop-design.md:50`、`:400`）；任务书把它列进第 9 片，是本轮输入与设计的冲突，按 L6 处理，不再让你重复裁一次产品范围。

### 0.2 范围与读法

**四块与设计节号的对应。**

| 本规格 | 设计出处 | 任务书 | 本片做什么 | 不做什么 |
|---|---|---|---|---|
| §3 执行结果审阅 | `DESIGN.md:560-570`（§2.9）、`MVP-BEHAVIOR.md:154`、`:265`、`:269`、E17 `:357` | 第 1 块 | 触发、审阅者身份/输入、证据准入、状态机一行、完成折叠、四种起点 | 计划候选审阅（PL-1）、材料授权、审阅者模型质量 |
| §4 只读报告见证 | `MVP-BEHAVIOR.md:154`；`plan-loop-design.md:50`、`:400`；`DESIGN.md:1479` | 第 2 块 | 现状盘点、边界、另开片的接口 | 见证机制本体的实现（L6） |
| §5 真实冲突与真实验收 | `DESIGN.md:1294`；`MVP-BEHAVIOR.md:289-293`、E05/E06/E08/E09/E12 `:345-352` | 第 3 块 | 冲突处置接缝、8 场景验收驱动、逐场景判定、131072 两格 | 6C/PL-2/8B-2/8C/8E/L2 的生产代码 |
| §6 量线长与 K2 裁定输入 | `DESIGN.md:1046-1049`、`:1632`；决定 39；`slice-7-SPEC.md:262` | 第 4 块 | 线长/命中的口径、读数、报告、给 K2 的输入 | K2 的压缩实现 |

**读法。** 文档已定的写成事实；文档没定又必须施工定的，放 §10.1 并标 `【lead 定，待审】`；产品取舍放 §0.1/§10.2；代码与文档对不上的放 §10.3。正文提到未合入片时，只写“依赖/接缝”，不写它的做法；每处都带“落地后重指”的句子。

**“不加没有依据的字段、状态、记录”。** 本规格只动已有对象：`PlanRevision.verificationRequirements[].kind`、`FinalizeChecksInput.reviewerEvidence`、`EvidenceV1`、`RoundSnapshot.evidenceRefs`、`RunActivity/QueryActivity` 的用量、`rerun-checklist.md` 的 C 行。新增的只有 PL-1 系统轮正本上的 `exec_review` 种类/`execreview:` 前缀/冻结包头、两个 Workflow step（`send_system_round`/`record_review`）、一条状态机 guard（§3.4）、一个 `recordReviewEvidence` 入账口、两个工具（`submit_exec_review`、`read_execution_history`）及提示词，以及验收报告目录（§5.6，文档产物，不是账本记录）。

## 1. 现状、基线和依赖

### 1.1 基线

| 项 | 值 | 说明 |
|---|---|---|
| 代码/测试 | 基线 `7570e87` 的代码树 | 内容即任务书基线 `7570e87`；副本提交号不同，不是基线偏差。tree 没有独立 `.git`，行号按文件内容核对；下文所有 `src/...:nnn` 都按当前内容 |
| 文档 | 同一时刻的文档 | 设计书、MVP、决策、状态机规格的行号都按这一副本 |
| 核对表 | 冒烟核对表 v4 | **379 物理行 / 207 评分行**（`:342` 的“合计 207”是评分行）。任务书说 207 行，指的是后者；引用时写清（D-1） |
| 树里没有 | `vendor/`、`scripts/`、`src/ui/` | K2 的 Kernel 补丁和真实 provider client 不在树里；E3 界面未建 |

**未合入片（本规格只引规格节号，不引未写的书）。**

| 片 | 在树 | 对本片提供什么 | 未合入时 |
|---|---|---|---|
| 7D2 | 否 | 审阅线（`role_line_add` 加 reviewer）、开局三线、开线/改范围、运行准入、上限卡；只供审阅线 | 审阅块只写“复用 7D2 的审阅线”；没有审阅线时保留 open 轮、等待 `no_review_line`（PL-1 同一口径），晚建线后同一轮续；不发明“审阅通过” |
| 6C | 否 | 按答复改目标/验收/范围、在跑切换、加预算；E08、方案迭代的正式生产者 | E08/方案迭代只写依赖；验收记 `prereq-slice-missing`，不写“已实现待跑” |
| L2 片（7C-2 handoff） | 否 | `handoffs` 绑定、`hand_off` 真实调用、H-01/H-02、人回复入口；E06、干预、等待 | 只验审批卡/简报记录/未绑定 `unsupported`；人回复入口记 `entry-missing` |
| 7D1 | 否 | `RoleScopeV1`、`SessionRoleFactsV1`、`RoleLineAllocationV1`、`planReanchor`/`reanchorSessionResponsibility` | 不提前定义这些类型；审阅者范围先用现有 `DecisionSubjectV1`，标“待 7D1 换” |
| PL | 否 | PL-1 系统轮正本、`sendSystemRound`、`planningAnswerShapeOf`/`finalizeToolNamesOf`、`compileVerificationCoverage`、`submit_plan_review` 先例、`planningOutputReserveTokens`；PL-2 偏差回计划 | **PL-1 是 §3 的硬依赖**：没有它，审阅系统轮/答案形状/共享覆盖都无从接；131072 两格等 PL-1，之前只跑显式探针；E09 偏差等 PL-2 |
| 8B-2 | 否 | `assign_module_maintainer`、`module_maintainer_assignment` 卡源；冲突时“谁负责这个模块” | 冲突协调不写工具名/卡源；只写“负责关系由 8B-2 提供” |
| 8C | 否 | `RepairInputV1`/`RepairPayloadV1`、`structural_proposal`、目录修订唯一写入方；冲突后的正式架构变更 | 不写自动修订/自动删模块；不提前定义 `ResponsibilityMoveV1` |
| 8E | 否 | 注记 `link`/`flow`、证据核对、联系层读出 | 冲突块把“读联系”标可选/不做；`NoteKind` 仍只有 8 种，不写 `link`/`flow` 字段名 |

补充：8B-1 已在树（`71281a9a`），可直接引目录 pin/`unknown_module`；7C-1/7C-2 的 F2/T/H/GP 已在树（`hand_off` 工具、审批卡、简报、`workflow/driver-start`），不要写成“未接线”。本表的 L2 是 7C-2 的 handoff 段，不是 8C 的小改/结构改动界线。

### 1.2 代码事实（✓ = 本次核对过）

| ID | 事实 | 位置 |
|---|---|---|
| F1 ✓ | 检查种类已有 `reviewer`，但 `roundReviewerEvidenceProblem` 对任何非空 `reviewerEvidence` 直接返回 `unsupported`；`finalizeChecks` 在 scope 检查前就拒绝 | `src/contracts/verification.ts:245`；`state/verification-machine.ts:1098-1101`；`evidence/evidence-service.ts:1521-1524` |
| F2 ✓ | Workflow 在最后一个 pending 检查完成后直接 `finalizeChecksStep`，没有任何“读计划审阅要求、起审阅者”的分支 | `business/workflow/workflow.ts:270-284`、`:2507-2555` |
| F3 ✓ | 审阅三样输入的底座都在：普通只读文件工具（`allowedPath`/`assertCurrent`）、`look_graph`/`find_graph`、`readTaskExecutionHistory`（按 Run 定位、只读、分页、按项目+工作区查范围） | `agent-runtime/execution-driver.ts:969-978`；`exploration-tools.ts:67-69`；`agent-runtime/graph-execution-history.ts:175-291`；`graph-tools.ts:361-370` |
| F4 ✓ | 编译器把 required `kind: 'reviewer'` 当“无检查覆盖”→ `uncovered`；`completion-policy` 用 `reviewerMissing` 特判硬拒（本片删除该特判），phase 固定 `verifying` | `evidence/verification-plan.ts:85-103`；`tasks/completion-policy.ts:100-116` |
| F5 ✓ | 计划里唯一能表达“要求独立审阅”的现有字段是 `verificationRequirements[].kind === 'reviewer'`；`reviewAdmissionProtocol` 只被校验/持久化，没有任何消费者 | `contracts/plan.ts:153-160`、`:201`、`:241`；`plan-validation.ts:136-140`、`:490-493` |
| F6 ✓ | `ReviewWorkBinding`/`ReviewWorkSnapshot`/`ReviewInputBinding` 契约还在，但没有 writer/provider；`ReviewInputBinding.grantRefs` 依赖已删的材料授权；`RunSnapshot.purpose` 只有 `unknown_call_review`，没有“执行结果审阅”。**本片不走这条路（L2-c）**：审阅是系统轮，不领取 Task、不开 Run，这些旧契约不需要 writer | `contracts/reviewer-work.ts:26-36`、`:58-82`；`source-authority-reader.ts:156-159`；`contracts/dispatch.ts:232-237` |
| F7 ✓ | 冲突底座在：重叠门、`goal-conflicts`、`project_source compare duplicates`、`architecture/compare-formal`/`impact`；没有独立的冲突记录/协调者/自动闸门 | `tasks/overlap-gates.ts:88`；`views/goal-conflicts.ts:1-450`；`workspace/duplicate-candidates.ts:66`；`app/core-routes.ts:474-482` |
| F8 ✓ | 正式入口是 `app/main.ts` 的显式 JSON 配置 → `createLocalWorkbenchHost` → loopback HTTP；`runtimeProvider` 是测试缝，B17 禁用；树里没有界面 | `app/main.ts:190-218`；`app/host.ts:193`、`:2302`；`IMPLEMENTED-CAPABILITIES.md:522` |
| F9 ✓ | 逐请求用量已存：`RunActivity` 有 `inputTokens/outputTokens/cachedInputTokens`、`omitted`、`complete`；`QueryActivity` 同样；查询线的“太长”读取今天就有 | `contracts/run-activity.ts:18`、`:42-49`；`contracts/query-job.ts:532-544`；`agent-runtime/run-activity-tally.ts:231-260`；`tasks/secretary-handoff-basis.ts:36-87` |
| F10 ✓ | 执行者线没有按线取“最近一次输入”的公开读口：`RunActivityViewV1` 只有 `usage.totals + complete`，没有 `sessionRef`/逐请求字段；活动 cell 没有 token | `views/activity-read-model.ts:106-149`、`:262-264` |
| F11 ✓ | 每请求默认 4096、本地工作台 16384、硬上限 393216；没有 131072 常量，也没有 `planningOutputReserveTokens`；本地工作台模型特判只给 `deepseek-flash`/`deepseek-v4-pro` 1M 窗口 | `contracts/runtime-budget.ts:19-21`、`:33`；`app/runtime-configuration.ts:117-122`；`app/host.ts:339-344`；`model-budget.ts:92` |
| F12 ✓ | 只读报告见证端到端 0；可复用底座约 60%（报告存储、Evidence 聚合、轮次状态机、来源捕获、历史读取、Workflow 顺序）；没有 witness 种类、产出者、报告实体、入口、测试 | `contracts/verification.ts:245`；`evidence-service.ts:1616-1623`；`contracts/artifact.ts:11-18`；`reviewer-work.ts:45-56` |

### 1.3 依赖矩阵

| 依赖 | 用到哪 | 没有它时 |
|---|---|---|
| **PL-1（硬依赖）** | 系统轮正本 `SystemRoundV1`/`SystemRoundHeadV1`/`systemRoundRequestId`、`sendSystemRound`、`systemRoundMessageRef`/`systemRoundOfText`/`lookupHostSendCommit`、`planningAnswerShapeOf`/`finalizeToolNamesOf`、`compileVerificationCoverage`、`submit_plan_review` 先例 | §3 不能开工：没有系统轮发送/回执/答案形状/共享覆盖可接；不写替代端口、不发明第二套系统轮，等 PL-1 合入 |
| 7D2 审阅线 | §3.3 的 `role_line_add` 加 reviewer、审阅 Session 的职责/范围、reviewer profile、只读工具 | 没有审阅线时保留 open 轮、等待 `no_review_line`，晚建线后同一轮续；不是“未实现”，不伪装审阅通过 |
| 7D1 角色范围 | 审阅者读原历史的范围、`RoleScopeV1` | 先用 `DecisionSubjectV1`（Goal 或 project）；标“待 7D1 换”，不提前定义 `RoleScopeV1` |
| 6C | E08 改目标/验收、方案迭代的回答→候选 | 场景记 `prereq-slice-missing`；只验现有确认/采用/pin 的部分，不写“已实现” |
| L2 片（7C-2） | E06 换手、直接干预/等待的人回复入口 | 场景记 `entry-missing`；只验审批卡/简报/未绑定 `unsupported` |
| PL-2 | E09 的偏差回计划、替代任务 | E09 只验 `compare-formal` 漂移读取；修复/正式版本记未覆盖 |
| 8B-2/8C | E09 的模块负责人、正式架构变更 | 同上；不写工具名/卡源，不提前定义 8C 类型 |
| 8E | 冲突发现后读联系 | 标“可选/不做”；不写 `link`/`flow` 字段名 |

### 1.4 今天的缺口（按运行顺序）

1. **采用计划后没有审阅触发。** 计划里 `kind: 'reviewer'` 的 required 要求只能让轮次变 `uncovered`、让完成卡在 `verifying`，不会起审阅者（F1/F4）。
2. **审阅没有 Work Run 入口，本片也不走这条路（L2-c）。** `ReviewWork` 有类型没 writer，`RunSnapshot.purpose` 只有 `unknown_call_review`（F6）；但审阅是平台发给审阅线的系统轮，不领取 Task、不开 Run、不占执行者名额，所以这些旧契约不需要 writer，也不等 7D2 才能起。真正缺的是 PL-1 的系统轮正本（硬依赖）和 7D2 的审阅线（缺线只等待 `no_review_line`）。
3. **审阅证据进不了轮次。** `finalizeChecks` 收 `reviewerEvidence` 但一律拒绝；没有“接受并校验”的入口（F1）。
4. **完成规则把“缺审阅”当硬阻塞。** 有正式审阅 PASS 也放不过；本片删 `reviewerMissing` 特判，走统一有效证据折叠，不拆第二套完成规则（F4、S9-12）。
5. **真实验收没有驱动/报告。** 8 个场景有 8 个可复用 fixture、27 个相关测试，0 个真实模型端到端脚本，0 份逐场景报告（§5.3）。
6. **线长没有真实数据。** 查询线能算，执行者线只有 Run 合计；真实运行 0 条（F9/F10）。

## 2. 范围：四块

| 块 | 做什么 | 不做什么 | 依赖 | 出口 |
|---|---|---|---|---|
| §3 执行结果审阅 | 触发条件、审阅系统轮/Query、三样输入、结论进 Evidence、状态机 guard、完成折叠、四种起点 | 计划候选审阅、材料授权、审阅者模型质量、自动返工 | PL-1（硬）、7D2（只供审阅线）、7D1 | 审阅 Evidence 在轮次 `evidenceRefs` 里，轮次 PASS/INCONCLUSIVE 可解释，Task/Goal 能按证据完成 |
| §4 只读报告见证 | 现状、边界、另开片接口 | 见证本体（L6） | 无（只读盘点） | 一份“已有/缺口/交接”的边界节，不冒充本片交付 |
| §5 真实冲突与真实验收 | 冲突处置接缝、8 场景驱动、逐场景判定、131072 两格 | 6C/PL-2/8B-2/8C/8E/L2 的生产代码；自动协调者；冲突图 | 全部前置片 | 一份按场景“通过/失败/未覆盖”的报告 + 机器可读 `result.json` |
| §6 量线长 | 口径、读数、报告、K2 输入 | K2 压缩实现 | 2B（已在树）、真实验收 | 一张按线的 token/命中表 + 给用户的 K2 裁定输入 |

**改的文件（按块）。**

| 块 | 文件 | 加/改什么 | 不改什么 |
|---|---|---|---|
| 审阅 | `src/business/workflow/contracts.ts`、`src/business/workflow/workflow.ts` | 新增 `send_system_round`/`record_review` 两个 step 与 `WorkflowCalls`；`nextAfterRound` 在 finalize 前判 `review-packet`；系统轮扩展用 PL-1 正本 | 不改现有 `run_check`/`finalize_checks` 的语义与顺序 |
| 审阅 | `src/contracts/exec-review.ts`（新）、`src/core/work-graph/tasks/exec-review-packet.ts`（新） | 答案文本/解析；`ExecReviewPacketV1` 冻结包读写（只进正文，不写记录） | 不加账本记录、不加消息字段 |
| 审阅 | `src/core/work-graph/evidence/evidence-service.ts`、`src/core/work-graph/model/evidence-contracts.ts` | `EvidencePort.recordReviewEvidence`（一次提交 Evidence + 索引）；`finalizeChecks` 指纹纳入非空 `reviewerEvidence`，refs 折叠 | 不改命令检查的 report 写入 |
| 审阅 | `src/core/work-graph/state/verification-machine.ts` | 跳过 `review-packet`；`roundReviewerEvidenceProblem` 只核 ref 形状；身份/归属回读后判；fold 认审阅 coverage | 不新增 round 字段 |
| 审阅 | `src/core/work-graph/evidence/verification-plan.ts`、`src/contracts/verification.ts` | 共享 `compileVerificationCoverage` 加 reviewer 路径，不再一律 `uncovered` | 不给命令检查加“无 command”形状 |
| 审阅 | `src/core/work-graph/tasks/completion-policy.ts` | 删 `reviewerMissing`，走统一有效证据折叠 | 不保留第二套完成规则 |
| 审阅 | `src/core/work-graph/sessions/duty-recipient.ts` | duty 联合加 `'reviewer'` | 不改其他 duty |
| 审阅 | `src/core/agent-runtime/answer-tools.ts`、工具表/`answerShape` 分派（`query-preparation.ts`/`execution-preparation.ts`/`execution-driver.ts`/`tool-group-assembly.ts` 按 S9-05 实际落点）、`graph-tools.ts`（`read_execution_history` 经 `createGraphHistoryProxy`）、`src/contracts/query-job.ts`（`PlanningAnswerShapeV1`/`QueryAnswerShapeV1`/`validQueryExecution` 形状类型/校验）、`resources/prompts/platform/templates/exec-review-input.txt`、`slot-tables.ts` | `exec_review` 的形状类型/校验；`submit_exec_review`（新工具名，不与 plan review 同名）的 exec schema；`read_execution_history` 经 proxy 读；审阅提示词 | 不改 plan review 的 `submit_plan_review` schema/解析 |
| 审阅 | **不动** `src/contracts/dispatch.ts` 的 `RunPurpose`、**不动** `src/contracts/reviewer-work.ts` | L2-c 不新增审阅目的、不补 `ReviewWork` writer | 旧契约原样保留，只不参与本片 |
| 冲突/验收 | `tests/`（新验收驱动/夹具） | 8 场景驱动、报告、C 行回指 | 不改生产代码；不改核对表旧行，只从 C-208 起补 |
| 量线长 | `src/core/work-graph/views/activity-read-model.ts`（L8） | 执行者线按线读最近一次输入/命中 | 不改 `RunActivity` 的存储形状 |

**不改的层。** `plans/propose`/`plans/apply` 的采用语义；`reviewAdmissionProtocol`；`EvidenceKind`/`EvidenceOutcome`/`VerificationCheckKind` 的既有值；`RoundSnapshot` 的 codec 闭合字段；`PlatformDutyV1` 的五种职责；E3 的界面和读模型；K2 的 Kernel 补丁。

## 3. 第一块：执行结果审阅

### 3.1 触发：只在冻结轮次的计划要求时起

**源头。** 采用的 `PlanRevision` 里 required obligation 的 `verificationRequirements[]`，只认 `requirementLevel === 'required'` 且 `kind === 'reviewer'`（`src/contracts/plan.ts:153-160`，L1）。轮次打开时 `compileVerificationPlan` 把它编成一条 `satisfactionPath: 'review-packet'` 的计划项（`verification.ts:252`；B §3.4、S9-11 的共享编译器）；编译按 `round.subject.taskId` 过滤 obligation 的 `taskIds`，只留这个 Task 的 `{obligationId, requirementId}` 对（S9-10）。`review-packet` 不建 `RoundCheckSnapshot`，`open_checks`/`pendingRoundChecks` 跳过它（B §3.4、S9-07）；所以 `round.checks` 里只有命令检查。`nextAfterRound` 只读冻结的 `RoundSnapshot.verificationPlan.checks`（`verification.ts:219`），不再读当前采用的计划；执行中被改的计划不改变本轮的审阅要求。

**三种出口。**

| 情况 | 出口 |
|---|---|
| `checks` 里没有 `kind === 'reviewer'` 的 `review-packet` 项 | 原样 `finalizeChecksStep`；不建 Query、不发消息、不新增 Session/Run |
| 有 reviewer 项，还有 `executing` 或 `pending` 检查 | `displayRoundStatus`（`verification-machine.ts:430`）为 `running` → `null`；有 `pending` → `run_check`；不发送 |
| 有 reviewer 项，检查全结束（`completed` / `interrupted`，或没有命令检查的 `incomplete`） | `perform(send_system_round)`；不 finalize、不写 Evidence |

**为什么在 finalize 前。** 文档说审阅者看“被审任务和执行事实、改动与检查结果”（`MVP-BEHAVIOR.md:267`），结论“作为检查证据”（`DESIGN.md:569`）。检查结果在命令检查跑完后才齐；审阅 Evidence 必须和本轮一起折叠，所以插入点只能是“命令检查全结束、finalize 之前”（N1）。

**不看什么。** 不看 `reviewAdmissionProtocol`；不看计划候选（计划候选审阅是 PL-1 的 `planreview:`）；不看别的 Goal/Task 的 reviewer 要求；不在检查还没跑完时发审阅。**依赖。** PL-1 的 §5.2/§6.3 是硬依赖；7D2 只供审阅线（`resolveDutyRecipient` 的 `'reviewer'`、`role_line_add`、profile 和只读工具），不是本节的运行时分支。

### 3.2 真实运行顺序（从计划被采用到出口）

**第 0 步：采用、执行、开轮。** `plans/propose` → `plans/apply` → Host `applyPlanChange`；随后 `selectNext` 选 Task → `claim_task` → `prepare` → `start`；Run 正常结束（`normalEnd`，`workflow.ts:578`）后 `resumeRoundChain` 读链头，`not_found` 才 `open_checks`（`workflow.ts:1135` 一带）。轮次冻结 `subject`、`subjectRunRef`、`adoptedPlanRef`、`identity.sourceDigest` 和 `verificationPlan`（`verification.ts:219`、`verification-context.ts:46`）；命令检查按 `nextAfterRound` 跑完。

**① 判出要审阅：`nextAfterRound`。**
调用者：`performStep` 的 `open_checks`/`run_check`（`workflow.ts:2507`、`:2515`）和 `continueRoundChain`（`:1122`）都调 `nextAfterRound`（`:270`）。
读：`round.status`、`round.checks` 的 phase、`round.verificationPlan.checks`。
写：无。
出口：没有 reviewer 项 → `finalizeChecksStep`；检查未全结束 → `null`/`run_check`；有 reviewer 项且全结束 → 返回 `advance` + `next: makePerform(base, {kind:'send_system_round', request: {roundRef: round.ref}})`，并带 `waitBasis = goalWaitBasisOf(goal, ['exec_review_pending'], ['SessionMessage','Session','VerificationRound','Evidence','Run'])`，不 finalize。发送步骤的等待依据随 `advance` 交给驱动，先登记后 drain 再发（见④）。

**选择阶段先读同一份审阅状态（S9Q-01）。** `continueRoundChain`（`workflow.ts:1122`）在返回 `send_system_round` 之前调用 ② 的同一个 `readReviewState`：`s = await readReviewState(round); if (s.waiting) return waiting(round, s.reason, undefined, s.basis); return nextReviewStep(s);`（`nextReviewStep` 就是 ② 里 `not_sent`→③、`answered`→`record_review`、`closed`→`finalize_checks` 的分派）。返回的 `waiting` 交给现有任务循环（`collaboration-driver.ts:879`、`:1116`）收集并跳过当前 Task，别的 Task 继续走；`not_sent` 才返回发送步骤，`answered`/`closed` 直接给 `record_review`/不带 ref 的 `finalize_checks`。发送成功后重新进入选择也走这一读，所以同一轮“已发未答”不会在发送步与选择之间来回打转。

**② 审阅状态读取：`readReviewState`（发没发、答没答）。**
调用者：`continueRoundChain` 的选择阶段（返回发送步骤之前，见①）和 `performStep` 的 `send_system_round`（同一个 step 在每次推进都重新进入）；两处调同一个读函数，不各写一份。
读：`readVerification(roundRef)`；`requestId = execreview:<roundId>`；`systemRoundMessageRef(scope, requestId)` → `interventionPlanningQueryRefs(messageRef)` → `readQueryJob`（PL §5.2.6 #3）；消息回执用 `lookupHostSendCommit`；`not_sent` 时同一读再看收件线 `resolveDutyRecipient({workspace, duty:'reviewer'})`。
写：无。
出口：`waiting`（回执 `committed`、Query `pending`/`running`，或 Query 还没建出；或 `not_sent` 且收件线为 `null`）→ 原样返回 `waiting(reason, basis)`，不重发、不 `rememberWaiting`；选择阶段调用时，返回值由 `continueRoundChain` 直接交给现有任务循环收集并跳过当前 Task（发送步重入时同一出口也返回等待）（`collaboration-driver.ts:879`、`:1116`；`workflow.ts:1716`；S92-05/S9Q-01）；同一条 `not_sent` 且有线 → ③；`answered` → 若 R 尚未关联/撤回，先走该窗口的唯一收尾分派（补回复；坏答案按无合法结论），再 `advancing(receipt, makePerform(base, {kind:'record_review', request}))`；`closed` 无合法结论 → 同样先走同一收尾分派（补撤回），再直接 `finalize_checks` 不带 ref。重启时同一分派先于记账生效（§3.5 表）。

**③ 冻结包（只在 `not_sent`）。**
调用者：同一个 `send_system_round`。
读：`execReviewPacketOfRound(round)`（纯函数，字段全部从冻结轮次取）；`status === 'finalized'` → `selectWorkStep`，不发送。
写：无；包只进正文，不写记录。
出口：包 = `roundRef = round.ref`、`planRevisionRef = round.adoptedPlanRef`、`taskRef = round.subject`、`subjectRunRef = round.subjectRunRef`、`checkRefs` = `round.checks` 中 `phase === 'finished'` 且 `reportRef !== null` 的 `ArtifactRef`（按 `checkId` 排序；没有报告的检查由轮次卡给出结果）、`sourceDigest = round.identity.sourceDigest`、`coverage` = reviewer 项 `coverage` 的 `{obligationId, requirementId}` 按 `(obligationId, requirementId)` 排序去重对（`evidence.ts:22`），非空；空 → `invalid`，不发。不新增消息字段；这是正文首行之后的固定头：

```
execreview:<roundId>
roundRef: <canonicalJson(round.ref)>
planRevisionRef: <canonicalJson(round.adoptedPlanRef)>
taskRef: <canonicalJson(round.subject)>
subjectRunRef: <canonicalJson(round.subjectRunRef)>
checkRefs: <canonicalJson([...])>
sourceDigest: <round.identity.sourceDigest>
coverage: <canonicalJson([...])>

<请求正文：只读审这一轮执行结果；结论用 submit_exec_review 填>
```

首行严格等于 `systemRoundRequestId`（`systemRoundSendInput` 校验，PL §5.2.3）；头之后空一行再写请求正文；模型看见头但不填进工具。`execReviewPacketText`/`execReviewPacketOfText` 是唯一读写这对头行的纯函数；`execReviewPacketOfText` 缺行/多行/JSON 坏 → `invalid`。

**④ 解析审阅线并发送（只在 `not_sent`）。**
调用者：同一个 `send_system_round`；`sendSystemRound(systemRoundContext(scope, signal), deps.messages, {round, recipient, text})`（PL §5.2.5）。
读：`resolveDutyRecipient({workspace, duty:'reviewer'})`（`duty-recipient.ts:22`；PL §6.3.1 #1；PL 给入参加 `'reviewer'`，`PlatformDutyV1` 已有该值）；`systemRoundRequestId({kind:'exec_review', goalRef, roundRef})` = `execreview:<roundId>`；`lookupHostSendCommit` 按 requestId/scope/arguments 读回执（PL §5.2.2 #4、§5.2.5）；`systemRoundSendInput`（PL §5.2.3）。
写：一条 `SessionMessage` R；`intent:'action_request'`、`needsReply:true`、`goalRef`、**不填 `taskRef`**、`expected:[]`；`messageId` 由 `(projectId, workspaceId, host:plan-round, requestId)` 哈希（PL §5.2.6 #2）。
出口：`ready null` → 不直接结束整趟：返回 `waiting(reason='no_review_line', basis=goalWaitBasisOf(goal, ['no_review_line'], ['Session','SessionMessage']))`，交驱动按等待收集并跳过当前 Task（下一次选择仍先走 ②）（`task-gate.ts:176`；`collaboration-driver.ts:879`、`:1116`；`workflow.ts:1716`），轮次保持 open，不 finalize、不写 gap；没线已在 ② 的选择阶段读过，这里是发送前二次确认，不写等待标记；没线事实同时由 PL-1 的 `plan_notice` 投影源投影为一条无审阅线通知（不依赖本次发送步）（来源/去重见 §3.5，`itemKey=exec-review-no-line:<goalId>:<roundId>`，条件成立期间只有一条、不写记录）；duty 读失败原样；`sessionDuty`/`messages` 未装配 → `unsupported`，不冒充 `no_review_line`。有线：`committed`/`replayed`/`skipped already_committed` → 正常返回发送成功，回到目标选择由 ② 的同一读判 `exec_review_pending` 等待（不在这里 `rememberWaiting; continue`），不直接返回整趟 `waiting`；拒绝 → `waiting`（`forbidden`/`unavailable`/`not_found`）或原 `invalid`；不写 Evidence、不 finalize。收件线自己在忙不挡发送，由 Host 消费侧按 `busyReasonOf` 排队，系统轮不绕过占用/健康/归档（PL §5.2.4 #1）。

**发送前接 PL 的共用路径（S92-06）。** 不另写“检查 `pending`/`executing` + 消息回执”的排空规则；`send_system_round` 由 `advance(next:send, waitBasis)` 返回，驱动按 `register(basis, cursorBeforeRead) → drain() → sendSystemRound()` 执行：读前游标先登记，再让 Goal 等待队列 drain 一次、处理登记前已发生的提交，最后发送（`goal-wait-wakes.ts:86`；`collaboration-driver.ts:1124`；PL §6.1.2 步 7/8、§5.5.1 步 5）。Goal 循环和任务看守都用这一条；`skipped already_committed` 也按已发读同一消息/Query，不重发。发送后回到目标选择：重新进入 `continueRoundChain` 时 ② 的同一读看到回执 `committed`、Query `pending`/`running`，返回 `exec_review_pending` 等待，循环跳过本 Task、别的 Task 继续选；不在发送步内 `rememberWaiting; continue`（`collaboration-driver.ts:1116`、`workflow.ts:1716`）。

**⑤ 收件线开审阅 Query。**
调用者：Host `consumeIdle` → `handleIntervention`（PL §5.2.4 #1/#2/#3）；`offerKindOf` 把 Host 系统 `action_request` 归 `action_request`，`busy` 不绕过；`planningAnswerShapeOf(message, duty, head.kind)` 得 `exec_review`（PL §5.2.4；`roundKind`/`exec_review` 一臂按 L14 由本片直接改 `planningAnswerShapeOf` 正本；L14 只是不加薄包装，PL 正本的 `PlanningAnswerShapeV1`/`QueryAnswerShapeV1`/`validQueryExecution` 与 manifest 形状校验仍同次扩 `exec_review`（S92-07）），`planOnIdleLine` 建 Query。reviewer 分支按 `head.kind` 分派：`planreview` 走 C 6.3，`exec_review` 走本节 §3.3；不读 `PlanProposal`。`head.kind` 来自 `planOnIdleLine` 已经为 base/收尾读的 `systemRoundOfText(question)`，不是第二次解析；`answerShape` 在建 Query 时冻结，准备/启动不读正文。
读：R 的正文首行/头；收件线 duty。
写：`intervention_planning` QueryJob/QueryRun；`execution = {kind:'intervention_planning', sourceMessageRef:R, answerShape:'exec_review', roleBinding, runtimeBudget}`；`question` = 正文；不调 `proposePlan`、不建候选。
出口：Query `pending`。`message.taskRef` 为空 → `addressed = null`，不领取、不调 `claimFirstReady`，不占执行者名额（PL §5.2.4 的“不领”）。

**⑥ 准备、启动、提交结论。**
调用者：Query 准备/启动（PL §5.2.7 #5）；模型；`submit_exec_review`。
读：`execution.answerShape`、`manifest.answerShape`、正文首行和包头；不读 `PlanProposal`。
写：`PreparedQueryManifestV1.answerShape = 'exec_review'`；`promptSet.toolNames` 含 `submit_exec_review`；`exec-review-input` 指南；模型工具表；`QueryJobAnswer.answer`。启动侧从 `job.job.intent.question` 的包头取 `subjectRunRef`，冻进 `read_execution_history` 的工具配置（不新增 manifest 字段）；模型不传 Run。
出口：`queryAnswerShapeOf` 得 `exec_review`；`finalToolNamesOf` 映射到 `submit_exec_review`（plan review 仍映射到 `submit_plan_review`）；`createAnswerTools` 为 `submit_exec_review` 建 `{verdict, basis, report}` 的 strict schema；`answerProblems` 校验；接受后屏障结束 Turn；观察器 `submittedAnswerArgumentsOf` + `buildAnswerText('exec_review')` 写答案；`associate_answer` 只回 R，短文本由 `planningReplyTextOf` 的 `exec_review` 分支派生（`pass` → “执行结果审阅通过”；`fix` → “执行结果审阅要求返工：见 Query <queryJobId>”），不复制 JSON。工具不写 Evidence、不返回 `evidenceRef`。

**形状值域由本片一起扩（S92-07）。** 产生、准备、启动、观察器共用本片扩后的 `PlanningAnswerShapeV1`/`QueryAnswerShapeV1`/`validQueryExecution` 与 `PreparedQueryManifestV1.answerShape` 校验，不新增第二份 parser，也不做未知形状/旧清单的兼容推断；完整落点见 §3.3。

**回复回执身份。** `associate_answer` 用固定身份 `intervention:<messageKey>:respond`（PL §6.3.3、§6.4.2），sender 是审阅 QueryRun 的 Session，`queryMessageRef`/`replyToMessageRef` 都是 R，`repliesToMessageRef = R`；R 是唯一回复槽，`replyToOriginal` 不产生执行者 M 的第二个槽。回复正文只是短结论；结论 JSON 只在 `QueryJobAnswer.answer`，`record_review` 不解析回复正文，也不把“消息有回复”当闭环。

**答案已存、R 尚未关联/撤回的重启窗口（S92-08）。** Query 已 `answered`/`closed`、源消息 R 的回复或撤回还没提交时重启，不能靠普通干预入口补：`handleIntervention` 在领取前先判 Goal 显示，`COMPLETED` 会先走 `requestNewGoal`（`intervention.ts:99`），而最后一个审阅可能已让 Goal 完成，原 R 就永远补不上收尾。把 `exec_review` 接进 PL 的终态恢复：扩展既有 `settlementOfferOf` 的报价判定和审阅收尾分派（PL §5.5.2 `:857`、`:861` 现只识别 `plan_review`），按 `sourceMessageRef=R` 给原 R 报价，走同一 `planOnIdleLine`/`associate_answer` 补这条消息的唯一收尾（`intervention.ts:136`；身份仍是 `intervention:<messageKey>:respond`），不重开 Query、不写候选、不再审。`answered` 用已存 `QueryJobAnswer.answer` 派生的短回复；`closed` 无合法答案走现有 `no_answer` 收尾与撤回，坏答案沿用“无合法结论”只补原 R 收尾、`record_review` 仍 `finalize_checks` 不带 ref。收尾完成后才回到普通“已完成 Goal”分支（新 Goal 另起），顺序不能反；`SessionMessage` 提交在 `GOAL_WAIT_WAKE_AGGREGATE_TYPES` 内（`goal-wait-wakes.ts:31`），目标能被叫醒。不新增恢复记录或入口。

**⑦ 入账：`record_review`。**
调用者：`performStep` 的 `record_review`（选择阶段或发送步的 `readReviewState` 读到 `answered` 时交出的下一步）；`record_review` 是 `WorkflowCalls` 的一个 step，owner 是 `recordReviewEvidence`。
读：`readVerification(roundRef)`；`systemRoundMessageRef(scope, requestId)` → `interventionPlanningQueryRefs` → `readQueryJob`/`readQueryAnswer`（PL §5.2.6 #3、§6.1.2 步 5）；校验 `intent.execution.kind==='intervention_planning'`、`sourceMessageRef=R`、`answerShape==='exec_review'`、`goalId=round.ref.goalId`；`systemRoundOfText`/`execReviewPacketOfText`/`parseExecReviewAnswer`；`job.job.enteredSession ?? assignedSession` → `readSession` → `sessionDuty`；`readExecution(round.subjectRunRef)` + `normalEnd`（`workflow.ts:578`）；读失败 → `waiting`，不写。
写：`recordReviewEvidence` 一次提交——报告 artifact + 一条 `EvidenceV1` + `TaskEvidenceIndex`（`evidence.ts:77`、`:102`；`evidence-service.ts:900` 的 body store、`:1655` 的 admission 写法）。Evidence：`kind:'verdict'`；`outcome` `pass`→PASS、`fix`→FAIL、终态坏→INCONCLUSIVE；`source.actor = {kind:'system', id: reviewerSessionId}`（`ActorRef` 的 agent 臂必须带 `runRef`，L2-c 没有审阅 Run；`source.runRef = null`、`source.checkId = null`）；`subject = round.subject`；`coverage` 从 reviewer 项派生；`anchor = anchorOf(round)`；`verificationPlanRef = {planId: round.verificationPlan.planId, planDigest: round.verificationPlan.planDigest}`；`summary.text = basis`（≤ `EVIDENCE_SUMMARY_MAX_BYTES` 4096）；`summary.artifactRef = 报告`。
出口：`finalizeChecksStep(base, round, [evidenceRef])`；无合法答案/Query `closed`/解析失败 → 不写 Evidence，`finalize_checks` 不带 ref，fold 写 `reviewer_missing`；被审 Run 未结束 → `waiting`，不写；非正常结束 → 只写 INCONCLUSIVE，不写 PASS；审阅线 duty 不是 `reviewer` → `forbidden`；duty 读失败/`unknown` → `unavailable`；`sessionDuty` 未装配 → `unsupported`；头的 `roundId`/`planRevisionRef`/`taskRef`/`subjectRunRef`/`checkRefs`/`sourceDigest`/coverage 与轮次不符 → `invalid`，不写。Evidence 的 subject/coverage 由轮次派生，别的 Task 的 ref 进不了这条路径；B §3.4 的 guard 再逐条核对（S9-17）。入账身份固定为 `H(scope, roundRef, 'record_review')`（排除 flow、操作者和现时事实）；重启换不同 flow 仍命中同一身份，owner 按 `replay(id) ?? readAndBookOnce()` 回放原 `{evidenceRef}`，不新增。

**⑧ finalize 与出口。**
调用者：`record_review` 完成后发 `finalize_checks`；`readReviewState` 读到 `closed` 时也直接发 `finalize_checks`；`performStep` 的 `finalize_checks` case（`workflow.ts:2531`）执行。
读/写：`finalizeChecks(..., {reviewerEvidence})`（`evidence-contracts.ts:202`）；非空 `reviewerEvidence` 进 finalize 指纹（S9-08，B §3.4）；`finalizeChecksStep` 加可选第三参 `reviewerEvidence?`，原调用不变。B §3.4 的 `roundReviewerEvidenceProblem`/`finalizeRoundOutcome`；`round.evidenceRefs`、`round_finalized`。
出口：干净 PASS → `complete_task`；非 PASS/gap → `select_work`；`busy` 且已 finalize → `select_work`。`complete_task` 读 `round.evidenceRefs` + `TaskEvidenceIndex`，按 coverage 判；PASS → 完成；FAIL → 返工/新 Attempt/新轮 → 新 `execreview:<newRoundId>`（S9-20 R4）。

**失败出口。** 没有线：open + `no_review_line` 分支等待，继续选其他 Task，不是“未实现”；发不出去/已发未答：选择阶段读回分支等待，不写，下次同请求号；只有没有其他动作才合并返回 `waiting`；答案坏/无答案：`finalize_checks` 不带 ref → INCONCLUSIVE `reviewer_missing`，不 PASS、不重发、不重审；`fix`：FAIL → `select_work`，保留原轮/证据，不替执行者改计划；过期：交 B §3.4 的 fold（`reviewer_stale`），guard 不拒；入账 `unavailable` → 读回等待后跳过本 Task，owner `busy`（轮次已 finalize）→ `select_work`，都不写；所有读失败原样（`unavailable`/`not_found` 不折成没审）。

**逐步接 PL-1。**

| 步 | PL-1 正本 | 本片只加 |
|---|---|---|
| ① | `nextAfterRound`（`workflow.ts:270`）、`displayRoundStatus`（`verification-machine.ts:430`） | `send_system_round`/`record_review` 两个 step；不改检查顺序 |
| ② | PL §5.2.6 #3 的确定性消息/Query 读 | 选择阶段与发送步共用的状态读（`not_sent`/`waiting`/`answered`/`closed`） |
| ③ | PL §5.2.3 的正文规则 | `execReviewPacketOfRound`/`execReviewPacketText`/`execReviewPacketOfText` |
| ④ | PL §5.2.2/§5.2.5/§5.2.6 的请求号、发送、回执；§6.3.1 #1 的收件人 | `exec_review` 臂、`execreview:` 前缀、`no_review_line` |
| ⑤ | PL §5.2.4 的消费/Query 创建 | `answerShape='exec_review'`、`exec-review-input` |
| ⑥ | PL §5.2.7/§6.3.3 的接受、屏障、观察器 | 新工具 `submit_exec_review`、exec schema、`execReviewAnswerText`/`parseExecReviewAnswer` |
| ⑦ | PL §5.2.6 #3、§6.1.2 步 5 的读答案 | `recordReviewEvidence`、`record_review` |
| ⑧ | `finalizeChecks` 的 `reviewerEvidence`（`evidence-contracts.ts:202`）、B §3.4 | 无；guard/fold 在 B §3.4 |

### 3.3 审阅者是谁、读什么、写什么、出口

**身份。** 审阅线 Session，duty `reviewer`（`platform-duty.ts:6`；`role-profiles.ts:54-60` 的 `platformRoleProfile('reviewer')`；PL §6.3.1）。不是 Work Run：没有审阅 Run、Attempt、Lease、预算、Session 占用；不写 `RunSnapshot.purpose`。发起是 `Workflow` 的 `send_system_round`/`record_review` 两个 step（前者调 `sendSystemRound`，后者调 `recordReviewEvidence`），不是审阅派发端口。

| 项 | 内容 |
|---|---|
| Query | `intervention_planning`，`answerShape='exec_review'`，`sourceMessageRef` 是 `execreview:` 消息 R；审阅线自己的 `WorkbenchQueryProfile`（PL §6.3.1 #2） |
| 读什么 | ① 代码：`read`/`find`，工作区只读；② 事实：`look_graph`/`find_graph` 的 node/path 模式读 Task、Run 卡、改动文件、轮次/检查结果；③ 原历史：`read_execution_history`（无 `runRef` 参数；工具工厂把包里的 `subjectRunRef` 冻在闭包）→ `createGraphHistoryProxy(existingQueryContext)` 的 `proxy.readTaskExecutionHistory(toolCtx, {runRef:packet.subjectRunRef, afterCursor, limit})`（`tool-group-assembly.ts:134`、`:438`；`graph-tools.ts:365` 的同一适配），由 proxy 先用原工具身份按受信 Goal 与同一 workspace 校验 Run 卡、再用 Host 上下文读 RT8，分页、项目+工作区范围；被审 Session 忙碌/归档不影响读（`graph-execution-history.ts:22-23`） |
| 不读什么 | 不走材料授权（`grantRefs` 不参与）；不读别的 Goal/项目；不把执行者自述当来源；不读计划候选 |
| 写什么 | 只写 `QueryJobAnswer.answer`（工具/观察器）；报告 artifact 由 `record_review` 写；不写工作区、计划、卡、返工、Evidence |
| 工具集 | PL 审阅 Query 的只读集（`read`/`find`/`look_graph`/`find_graph` 的 node/path；`look_graph` 的 history 分支在本 Query 不挂；reviewer duty 不给注记）+ `read_execution_history`（新，只暴露 `afterCursor`/`limit`，Run 由工厂从冻结包填；经 `createGraphHistoryProxy` 读，不另写范围或 Host 身份转换）+ `submit_exec_review`（新工具名，exec schema）；无 `edit`/`shell` 写、无 `propose_future_plan`/`request_rework`/`request_recheck`/计划写；`read_execution_history` 和 `submit_exec_review` 都 `effectClass:'read_only'`、`requiredCapabilities:['workspace_read']`、`independentReadOnly:false`（与 PL 的 `submit_plan_review` 同一条基础设施） |
| 模型填 | 只填 `verdict`、`basis`、`report`；`read_execution_history` 只填 `afterCursor`/`limit`；**不填** `roundRef`/`planRevisionRef`/`taskRef`/`subjectRunRef`/`checkRefs`/`sourceDigest`/`coverage`/`anchor`/`evidenceRef` |
| 结论形状 | 恰好一个 JSON：`{"schemaVersion":1,"kind":"exec_review","verdict":"pass"\|"fix","basis":"…","report":"…"}`；整条答案文本 ≤16 KiB（PL §5.3.5 的 `MAX_ANSWER_BYTES`，不是 report 单独 16 KiB），`basis` 非空且 ≤4096 字节，`report` 非空、占用剩余额度；`fix` 的 `report` 写具体问题；strict，无未知成员 |
| 出口 | `pass`/`fix` → `record_review`；不建候选、不采用、不改计划 |

**形状值域由本片一起扩（S92-07）。** PL-1 先落地，这些类型和校验那时已在树上；第 9 片是它们的下一个改动者，PL-1 不为本片改任何东西。产生/准备/启动 `exec_review` 不只是加一条工具映射：本片在同一组改动里，`PlanningAnswerShapeV1`、`QueryAnswerShapeV1` 各加 `'exec_review'`，`validQueryExecution`（`src/contracts/query-job.ts:354`）扩该 planning 枚举，`PreparedQueryManifestV1.answerShape` 的校验同步认它（PL §5.2.7；`slice-PL-SPEC.md:566`、`:592`）。`validQueryExecution` 今天只接受 `'plan_round' | 'plan_review' | 'text'` 三种 planning shape；本片扩成 `'plan_round' | 'plan_review' | 'exec_review' | 'text'`（`answerShape` 仍只许出现在 `intervention_planning`，别的 kind 带它 → `false`）。不改这层，Query 提交会在 `query-job-service.ts:299` 被拒、读回会在 `query-record-codecs.ts:271` 被拒。准备、启动、观察器共用这一份值域，不新增第二份 parser，也不做旧清单/未知形状的兼容推断。

**新工具 `submit_exec_review`（L13）：只共用答案基础设施，不共用工具名。** `answerShape='exec_review'` 时，`finalToolNamesOf` 映射到新工具名 `submit_exec_review`；plan review 仍是 `submit_plan_review`，两个名字各建各的 strict schema（plan 是 `{verdict, findings?}`，exec 是 `{verdict, basis, report}`）。共用的是：接受/屏障路径、`acceptedAnswerCallIds`、观察器 `submittedAnswerArgumentsOf` 取第一条成功提交这一段、`QueryJobAnswer` 存储、Query 身份与回执幂等。**不共用**的是：工具名、schema、`planReviewAnswerText`/`parsePlanReviewAnswer`（它们仍只认 `kind:'plan_review'`）、正文和解析、结论去向（`record_review` 读并交轮次 fold，C 的 `decidePlanCandidate` 读并采用/转卡）。**理由：**同名不同 schema 会让模型和测试都看混；PL §6.3.3 的第一条 unknown-member 检查会把 `basis`/`report` 当未知成员拒，`planReviewAnswerText` 只会写 `kind:'plan_review'`，而 `execreview:` 没有 `PlanProposal` 可读。参数重建复用 PL §5.2.7 #5 的 `submittedAnswerArgumentsOf` + `buildAnswerText('exec_review', …)` 这一段；`createAnswerTools` 为两个工具分别建 schema，不按 shape 复用同名入口。

**回执幂等不在工具层。** 工具没有 command id、没有幂等键，Kernel transcript 是唯一记录（PL §5.2.7 工具行）。重放靠三件事：`execreview:<roundId>` 请求号 → 同一 `messageRef`（PL §5.2.6 #2）→ `interventionPlanningQueryRefs` 同一 Query 对 → 同一 `QueryJobAnswer`；`sendSystemRound` 先读 `lookupHostSendCommit`；`recordReviewEvidence` 用 `H(scope, roundRef, 'record_review')` 的回执身份回放原 `{evidenceRef}`（重启换不同 flow 仍命中原回执，`replay(id) ?? readAndBookOnce()`）；不按 flow/操作者或现时事实另算身份。

### 3.4 证据形状与状态机的那一行

**一句话。** 审阅结论是一条已入账的 `kind:'verdict'` Evidence；`record_review` 在终态与报告核对后一次写 Evidence 和 `TaskEvidenceIndex`；`finalize_checks` 只把这条已有 ref 与命令检查新铸的 ref 一起折叠，不重铸、不重判过期；`review-packet` 在状态机里只占计划项，不占 `RoundCheckSnapshot`。

**A. 触发与归属（S9-10）。** 触发只看冻结轮次的 `round.verificationPlan.checks` 中 `kind === 'reviewer'` 且 `satisfactionPath === 'review-packet'` 的项。它的 coverage 来自采用的 `PlanRevision`，筛选顺序固定：

```
required obligations
  .filter(o => o.taskIds.includes(round.subject.taskId))
  .filter(o => o.requirementLevel === 'required')
  .flatMap(o => o.verificationRequirements
      .filter(r => r.requirementLevel === 'required' && r.kind === 'reviewer')
      .map(r => ({obligationId: o.obligationId, requirementId: r.requirementId})))
```

每一对就是既有 `EvidenceCoverageV1 = {obligationId, requirementId}`（`evidence.ts:22`），不出现裸 `requirementId` 列表；同一 `requirementId` 落在两个义务下就是两对，不能合并，也不能只取第一个（`completion-policy.ts:45`、`:49`；`verification-plan.ts:70`、`:78`；`plan.ts:153-158`、`:168`）。

**同一筛选，三处消费。**

| 消费者 | 读什么 | 筛完为空时 |
|---|---|---|
| 触发 `nextAfterRound` | 冻结的 `round.verificationPlan.checks` | 没有 reviewer 项 → 原 `finalizeChecksStep`，不建 Query、不发消息、不新增 Session/Run |
| 编译 `compileVerificationCoverage` | `compileVerificationPlan` 先按 `taskRef.taskId` 过滤好的 obligations（S9-11） | 不产 `review-packet` 项，也不把 reviewer 放进 `uncovered` |
| 输入包 `execReviewPacketOfRound(round)` | 同一批 `review-packet` 项的 `coverage`，排序去重 | 包 `coverage` 为空 → `invalid`，不发 |

包不回读当前计划，因此天然不含别的 Task 的对。**别的 Task 不能误起审阅。** 同一 Goal 只有别的 Task 的 reviewer 义务时，`taskIds` 不含本 Task，本轮的 `checks` 里没有这一项，`nextAfterRound` 不会发 `send_system_round`；即使两个义务复用了同一个 `requirementId`，本 Task 的 `{obligationId, requirementId}` 仍是独立键，不会覆盖成别人的要求。

**B. Evidence 形状（L2-c、S9-04）。** 一条审阅结论恰好一条 Evidence，字段全部由可信 principal 从冻结包与轮次派生，模型只填 `{verdict, basis, report}`：

| 字段 | 值 | 来源/约束 |
|---|---|---|
| `kind` | `'verdict'` | 固定；不新增 `EvidenceKind` |
| `outcome` | `pass` → `PASS`；`fix` → `FAIL`；被审 Run 非正常结束 → `INCONCLUSIVE` | `normalEnd(run)`（`workflow.ts:578`）之后才写 |
| `source.actor` | `{kind:'system', id: reviewerSessionId}` | 审阅线 Session；system 臂不要求 `runRef` |
| `source.runRef` | `null` | L2-c：没有审阅 Run；不写“本片第一次写 runRef”一类说法 |
| `source.checkId` | `null` | 审阅不是命令检查 |
| `subject` | `round.subject` | 冻结轮次，不用模型给的 Task |
| `coverage` | 冻结包里的 reviewer 对，逐对相等 | 多一对、少一对、换一个 `requirementId` 都 `forbidden`（归属不符，不是形状问题）；不是“至少含一个” |
| `anchor` | `anchorOf(round)`（`evidence-service.ts:242`） | 冻结轮次的 effectivity anchor |
| `verificationPlanRef` | `{planId, planDigest}` = `round.verificationPlan` | 按冻结轮次计划产出，不按当前计划重算 |
| `summary.text` | `basis`，非空且 ≤ `EVIDENCE_SUMMARY_MAX_BYTES`（4096） | 答案正文；不复制报告全文 |
| `summary.artifactRef` | 报告 artifact | 答案里的 `report` 落 body store 后回填 |

模型不填 `roundRef`/`planRevisionRef`/`taskRef`/`subjectRunRef`/`checkRefs`/`sourceDigest`/`coverage`/`anchor`/`evidenceRef`；这些只从包头和轮次派生，包头对模型可见但只读，答案 schema 里没有对应成员（§3.3）。定位字段不靠“模型填了再校验”，而是根本不进模型输入。

**C. 一次入账（S9-03；S92-02/04/12）。** Workflow step `record_review` 的入参收窄为 `{roundRef}`，端口输入为 `GraphWrite<RecordReviewEvidenceInputV1>`，其中 `RecordReviewEvidenceInputV1 = {roundRef: VerificationRoundRef}`（其余全由轮次、答案和回执派生）。顺序固定为 `replay(id) ?? (readTerminal → readAcceptedSubmit → validateReport → bookOnce)`，其中入账身份 `id = H(scope, roundRef, 'record_review')` 只由 scope、`roundRef`、操作种类派生，**不含 flow、操作者或任何现时事实**；命中回执时 1–4 全不执行，直接回放原 `{evidenceRef}`。未命中才读事实：

1. `readTerminal`：`readExecution(round.subjectRunRef)` 后调 `normalEnd`（`workflow.ts:578`）；Run 未结束 → `waiting`，不写。
2. `readAcceptedSubmit`：按 `execreview:<roundId>` 定位消息/Query，校验 `intent.execution.kind === 'intervention_planning'`、`sourceMessageRef` 是 R、`answerShape === 'exec_review'`、`goalId` 是轮次的；只定位原 Query，读已存 `QueryJobAnswer.answer`（`readQueryJob(queryJobRef).job.job.answerRefs.at(-1)` → `readQueryAnswer(answerRef).answer.answer`，`query-job.ts:603`），再 `parseExecReviewAnswer(answer.answer)`。不在入账侧重读 transcript，不调 `submittedAnswerArgumentsOf`/`buildAnswerText` 重建参数；提交参数重建只留在 PL 观察器（`query-observation.ts:477-478`；`slice-PL-SPEC.md:1375`、`:1378`）。
3. `validateReport`：整条答案文本 ≤ `MAX_ANSWER_BYTES`（16 KiB）、`basis` 非空且 ≤4096、`report` 非空；算报告正文的 digest/size，检查 JSON 形状（strict、无未知成员）。
4. `bookOnce`：报告先落 body store（拿 `artifactRef`），核对刚写入的 digest/size 与 `summary.text` 的 `basis`；随后**一次** `GraphWrite<RecordReviewEvidenceInputV1>`（`{roundRef}`）提交，Evidence 其余字段全部由冻结轮次与答案派生。链路固定 `guard(open, executor, pin) → admit(Evidence, index) → commit(result:{evidenceRef})`：这是状态机的新迁移 **`VR-16`**（机器事件 `review_recorded`，接在 `VR-15` 之后的下一个空号）；`RoundEventHead`（`verification-machine.ts:359`）加 `review_recorded` 一臂，`roundWriteAdmission`（`:1074`）对它复用 open/executor/pin 三项判断；`from` 是 `open` 轮，`guard` 复用 `checkRoundPin`/`roundWriteAdmission` 的 open/executor/pin（pin = `round.revision`），`to` 轮次不变（仍 `open`），effects 只追加 Evidence@1 与 `TaskEvidenceIndex@k+1`，不写 Round 记录、不新增聚合；pin 以现有 `RecordGuard` 进同一次 `PreparedCommit.guards`（`mergeGuards` 通路）。Evidence 不可变（`evidence.ts:92`），索引用既有 `nextTaskEvidenceIndex`（`verification-machine.ts:1047`）只追加一次，`revision = 旧长度 + 1`。回执事件是新增的 `VerificationReviewEvidenceRecorded`（常量 `VERIFICATION_REVIEW_EVIDENCE_RECORDED_EVENT_TYPE`，沿用 `EVIDENCE_EVENT_SCHEMA_VERSION = 1`），事件 `result` 明确为 `{evidenceRef: EvidenceRef}`。codec/replay 接线全在现有 `evidence-record-codecs.ts`：`VerificationRoundEvent` 联合（`:94`）加这一支、`VERIFICATION_ROUND_EVENT_TYPES` 闭集（`:120`）加这个 `eventType`、`EVIDENCE_RECORD_SCHEMAS.events`（`:778` 由该闭集生成）随之注册、`verificationRoundEventFromEvent`（`:493`）按闭集校验解码；`a2RoundEventProblem`（`:534`）加一臂，用现有 `refProblem` 校验 `result.evidenceRef` 是完整 `Evidence` ref（坏 ref → `invalid`），不靠 TS 类型兜底；replay 走现有 `replayEvent`（`:498`），它按 `expectedEventType` 匹配后返回 `event.result`，所以新事件必须进闭集并带 `{evidenceRef}` result；`commitRoundWrite`（`:347`）的 committed/replayed 与 `commitOrRecover`（`:427`）复用同一通路，不新增第二个 replay 分支。**现有回放只认识检查轮事件的闭集**，新事件不进 `VERIFICATION_ROUND_EVENT_TYPES` 就会在 `:495` 被拒；这是 S92-04 要求写全的落点。

出口：无合法答案/Query `closed`/解析失败 → 不写 Evidence，`finalize_checks` 不带 ref，fold 写 `reviewer_missing`；被审 Run 未结束 → `waiting`；非正常结束 → 只写 `INCONCLUSIVE`，不写 `PASS`；审阅线 duty 不是 `reviewer` → `forbidden`；duty 读失败/`unknown` → `unavailable`；`sessionDuty` 未装配 → `unsupported`；包头与轮次不符 → `invalid`。

工具不写 Evidence，不返回 `evidenceRef`/`reviewRef`，只回 `{status:'accepted'}`。`bookOnce` 的幂等键就是入账身份 `id = H(scope, roundRef, 'record_review')`（不含 flow、操作者、现时事实），不另造 Workflow 请求号：同一身份重入走 `replay(id) ?? readAndBookOnce()`，命中只回放原 `{evidenceRef}`，不新增 Evidence、不追加索引。**入账后、finalize 前崩溃**：`round` 仍 `open`、Evidence 与索引已存在；重启后同一 `record_review` 重入，先回放原回执拿 `evidenceRef`，随后只补 `finalize_checks`，不再读终态/答案、不重发、不重审（S9-20 R8）；R8 重启时换一个 flow（如 `goal-wait:`）验证仍命中原回执。

**D. 状态机那一行（S9-07）。** `review-packet` 不建 `RoundCheckSnapshot`，也不注册命令：

| 位置 | 处理 | 依据 |
|---|---|---|
| `pendingRoundChecks` / `roundOpenChecksProblem` / `buildOpenedRound` | 遍历计划项时跳过 `satisfactionPath === 'review-packet'`；不要求它出现在 `configuration.checks` 里，因此不会因“未注册命令”抛错。`roundOpenChecksProblem` 经 `pendingRoundChecks` 得到同一结果 | `verification-machine.ts:884`、`:1237`、`:905` |
| `foldSteps` / `foldVerdictChecks` | 同样跳过 `review-packet`；不为它产生 `missing_check`，不把它当 pending/interrupted | `verification-machine.ts:755`、`:782` |
| 命令折叠 | `finalizeRoundOutcome` 的命令候选只来自命令检查；fold 的 admissions 仍只含命令 check 的 verdict | `verification-machine.ts:802` |
| 审阅折叠 | 以计划里的 `review-packet` 对为全集：缺 ref 的对写 `reviewer_missing`；有 ref 的逐条算 binding，再作为**同一 fold 的候选**并入（PASS 进 covering，FAIL/INCONCLUSIVE 进 blocking），不另算一遍 outcome；它们只参与 blocked/missing 与最终 outcome，不生成 admissions 项（admissions 仍只从命令候选出），不构造 `VerdictAdmissionV1` | `evidence-coverage.ts:153`、`:111` |
| `round.evidenceRefs` | `新命令 refs + 已入账审阅 refs`；命令 refs 由 fold admissions 新铸，审阅 refs 原样拼接 | `evidence-service.ts:1637` |
| `TaskEvidenceIndex` | finalize 只追加新命令 refs；审阅 refs 已在 `record_review` 入过索引，不重复追加 | `verification-machine.ts:1047`、`evidence-service.ts:1655` |

`requiredKeys` 与命令折叠是同一集合：计划项 coverage（含 `review-packet`）加 `uncovered`（`verification-machine.ts:863-866`）。reviewer 是覆盖键，不是命令 key；不能因为命令侧没覆盖或 `configuration.checks` 没注册就先判 missing——审阅候选进 covering 后该键自然有覆盖。

命令折叠与审阅结果折叠必须分开：

- `commandAdmissions = finalizeRoundOutcome` 对命令检查给出的 admissions；
- reviewOutcome 从已入账 Evidence 的 `outcome` + 适用性来；
- 两个结果在 `finalizeChecks` 的同一份 fold 事实里合并（只读内存事实，随 `round_finalized` 交给 transition；owner 与 `roundOnFinalized` 用同一份事实重算，不落两套结论）；
- `reviewer_missing` 是 fold 的 gap，不是 `completion-policy` 的 `reviewerMissing` 特判；
- **不为审阅重铸 Evidence**，也不把 reviewer ref 放进 fold 的 admissions 数组（`VerdictAdmissionV1` 只属命令）。

`evidence-service.ts:1644` 的 `verdicts.get(admission.checkId)` 只服务命令 admission：reviewer ref 混进去会找不到对应 check 的 verdict 而抛错，所以审阅 ref 只进 `round.evidenceRefs`，不进 admissions 数组。事件沿用现有两段：finalize 把 `input.reviewerEvidence` 原样接在命令新 refs 后面写进 `evidenceRefs`；前 `fold.admissions.length` 个是命令新 refs，后 `reviewerEvidenceCount` 个是已入账审阅 refs。`roundOnFinalized` 的 refs 校验从 `=== fold.admissions.length` 改为 `=== fold.admissions.length + reviewerEvidenceCount`，前段建 admissions，后段只拼接。`round.evidenceRefs` 直接拼两段，`admit_verdict_evidence` 只取前段。最终 `RoundSnapshot.outcome` 不另写第二套合并，直接取同一 `finalizeRoundOutcome` 的 `outcome`：`candidates = commandCandidates + reviewCandidates`，`outcome = applicableFail ? 'FAIL' : (gapOrBlockerOrMissing ? 'INCONCLUSIVE' : 'PASS')`（`verification-machine.ts:839-840`、`:863`、`:875`）。`blocker` 包含适用的 INCONCLUSIVE 候选（`evidence-coverage.ts:111`），所以命令检查为 INCONCLUSIVE、既无 gap 又无 missing 时也不能落 PASS；`reviewer_stale`/`reviewer_missing` 只是 gap 的两种来源。

**E. 过期与折叠（S9-06）。** pre-IO guard 只做 ref 语法/形状核对：`isolateWrite` 解码，`roundReviewerEvidenceProblem` 允许非空（删 `unsupported`）。它在 `evidence-service.ts:1521` 的调用位于 scope、回执查找和 Evidence 读之前，只拿得到 `reviewerEvidenceCount`，读不到轮次或 Evidence 内容，因此不判身份、归属或 coverage，顺序也不动。

身份/归属/coverage 的逐条核对放在后面：回执未命中 → `checkRoundPin` → `readRoundRecord` → `roundWriteAdmission`（open/executor/pin）通过 → 读 Goal/当前 plan/source 和 `reviewerEvidence` 的 Evidence 快照 → 逐条核对，全部在 fold 之前：

- 身份形状：`source.actor.kind === 'system'`，`source.runRef`/`source.checkId` 必须为 null；`actor.id` 是审阅线 Session，这一点已在 `record_review` 读 Query 收件 Session 的 duty 时核对（§3.2⑦），finalize 不再读 Session；
- 本轮绑定（来源证明）：按入账身份 `H(scope, roundRef, 'record_review')` 用现有 `lookupCommittedReceiptByIdentity`（`receipt-lookup.ts:54`，只按身份读，不拿当前指纹）读原回执，`expected = readRecordReviewReceipt(roundRef).evidenceRef`（该读取就是上面 `lookupCommittedReceiptByIdentity` 的薄读，不新增记录）；`suppliedRefs` 必须恰好等于 `[expected]`（重复、换序、多一条都不行），否则 `forbidden`。字段相同不再当作“本轮产生”的证明，也不靠 `TaskEvidenceIndex` 反推来源；旧链 ref、同 Task 同 anchor/plan 的另一轮 ref 都因 `ref !== expected` 在这里被挡（`verification-plan.ts:106`；`evidence-service.ts:242`；`contracts/verification.ts:199`；`contracts/evidence.ts:77`）。
- 归属：`subject` 必须是 `round.subject`（别的 Task 的 Evidence 因此进不来），`coverage` 必须与包内 reviewer 对完全相等（多、少、换都不行），`verificationPlanRef` 必须是冻结轮次计划，`anchor` 必须是 `anchorOf(round)`。

拒绝码只用 `forbidden`/`invalid`：`actor.kind` 不是 `system`（如普通命令检查的 executor agent 臂）、`actor.id` 不是该审阅 Session、`subject`/`coverage` 不符、别的 Task、`ref !== expected`（旧链或另一轮）用 `forbidden`；ref 不可解码/不存在/与快照不符、system 臂上 `runRef`/`checkId` 非 null、`verificationPlanRef`/`anchor` 不符用 `invalid`；不再用 `unsupported`。过期不在这里拒，交 fold。S9-17 的负例断言这一段。

合法但过期的 ref 一律交 fold：

```
binding = evidenceApplicabilityWithBasis({
  evidence, adoptedPlan, evidencePlan, currentAnchor
})                                    // evidence-coverage.ts:153
sourceCurrent = deps.source.capture(root).sourceDigest
                === round.identity.sourceDigest   // evidence-service.ts:1593-1601
```

其中 `evidencePlan` 是冻结轮次的 `PlanRevisionSnapshot`、`adoptedPlan` 是当前采用的计划、`currentAnchor` 是当前 adopted plan 的锚。`binding = STALE` 或 `sourceCurrent = false` → 该审阅结果不算 PASS，fold 记 `INCONCLUSIVE` 并逐对写 `reviewer_stale` gap（coverage 为对应的 `{obligationId, requirementId}`；现有 `source_changed` 上下文 gap 照旧，不互相替代）；`OUT_OF_SCOPE` 走现有 `evidence_<basis>` 缺口，不另立审阅专用名。Evidence 永远按冻结轮次计划产出，适用性由既有 same-basis/same-plan 规则判，不另写“计划版本相等”。

**F. finalize 指纹（S9-08）。** 非空 `reviewerEvidence` 进指纹：

```
fingerprintOf({kind:'r3e-finalize', roundRef, expected, reviewerEvidence})
```

`reviewerEvidence` 缺省或空数组时不加这个成员，指纹与今天逐字节相同（`evidence-service.ts:1532`）。顺序固定：

1. `isolateWrite` → ref/scope/参数形状核对；
2. 算指纹 → `lookupReceipt`；
3. 命中先 `replayEvent` 原回执（不读轮次/计划/来源）；
4. 未命中才 `checkRoundPin` → `readRoundRecord` → `roundWriteAdmission`（open/executor/pin）；
5. admission 通过后读 Goal/当前 plan/source 和 `reviewerEvidence` 的 Evidence 快照；
6. 逐条做 E 段的身份/归属/coverage 核对，不过则 `forbidden`/`invalid`；
7. 最后 fold。

作用域/参数形状核对之后先回放原回执；未命中后也先 pin/round/admission，再读当前事实。旧提交不会按新世界重判。同一 `requestId` 换一组 refs 得到不同指纹，不命中原回执，落到同一提交 identity 的冲突拒绝；不静默替换证据，也不把旧回执当新事实重放。空输入保持原指纹，这是兼容旧调用者的唯一分支。

**G. 共享覆盖编译（S9-11）。** 在 PL 落地后的 `compileVerificationCoverage` 正本（`contracts/verification.ts`，PL §6.2 `:1213`）加 reviewer 路径：本 Task 的 required reviewer 要求 → 一条计划项：

```
{ checkId: 'review-packet', kind: 'reviewer', satisfiesKind: 'reviewer',
  coverage: [{obligationId, requirementId}, ...], satisfactionPath: 'review-packet' }
```

不再放进 `uncovered`。`compileVerificationPlan`（`verification-plan.ts:61`）改为调用它，编译与 `diagnosePlanCandidate` 共同消费同一份 `checks`/`uncovered`；诊断不再产出 `reviewer_not_supported`，也不另写 reviewer 诊断分支。清单 A 补两行：共享覆盖函数 `compileVerificationCoverage`，以及 `duty-recipient.ts:23` 的 duty 联合加 `'reviewer'`（非 scribe 分支已按 duty 相等筛，`:48`，一行）。

**H. 删特判（S9-12）。** 删 `reviewerMissing` 的整个计算（`completion-policy.ts:100`）及它在 `hardNotSatisfied` 里的项（`:116`）；完成判定只走统一有效证据折叠：`blocking → failed`，`missingKeys → blocked`，`allCovered → satisfied`（`:109`、`:117`），stale/out-of-scope 仍走现有 `verifying` + `stale_or_out_of_scope`，不为 reviewer 另立出口。审阅 Evidence 已通过 `record_review` 进 `TaskEvidenceIndex`，完成消费者读同一有效证据集，不需要第二套规则。不加“生产者能力”字段，不加第二套 Goal 闸门；`requiresReviewer` 保持现状、不升级为硬闸；附注文字按 L17/D-20 本片改：`goal-machine.ts:492-495` 不再写“no formal producer yet”，改成“只作提示，不是硬闸”，并同步 `tests/state/goal-machine.test.ts:528-544`。

**收口。** reviewer 在状态机里只增加“一条已入账 Evidence + 一个计划项 + 两个 gap 名（`reviewer_missing`/`reviewer_stale`）”，不增加 RoundCheck、Run、Attempt、Lease、预算、新状态或新记录；`roundReviewerEvidenceProblem` 的 `unsupported`、`completion-policy` 的 `reviewerMissing`、`reviewer_not_supported` 诊断三处特判同时消失。

### 3.5 四种起点：等待与恢复

**定位链（重启和入账都用它，不扫表）。**

```
requestId = execreview:<roundId>
messageRef = systemRoundMessageRef({projectId, workspaceId}, requestId)
{queryJobRef, queryRunRef} = interventionPlanningQueryRefs(messageRef)
answerRef = readQueryJob(queryJobRef).job.job.answerRefs.at(-1)
answer = readQueryAnswer(answerRef).answer.answer
```

`not_found` 分三种（PL §5.2.6 #3）：消息回执不是 `committed` = 这一轮没发；消息已提交、Query `not_found` = 建 Query 的窗口，选择阶段读回等待后跳过本 Task；Query 已终态但没有合法结论 = 先按 §3.2 的重启窗口给原 R 补唯一收尾（回复/撤回），再 `finalize_checks` 不带 ref，fold 写 `reviewer_missing`，不重发、不重审。

| 起点 | 定位/读 | 动作 | 写/不写 | 出口 |
|---|---|---|---|---|
| **冷启动** | `startup-reconcile` 起驱动后，`nextAfterRound` 读 open 轮 | 有线：发/回放 `execreview:<roundId>`；无线：保留 open 轮，选择阶段读回 `no_review_line` 等待并跳过本 Task，无其他动作才返回合并的 `waiting` | 不写恢复记录；不把“没线”记成未实现 | `auto` 续；`ask` 等人 `workflow/driver-start`；`off` 只核对（PL §6.3.4 的 97-9） |
| **重启（已发未答）** | 按 `systemRoundRequestId` 算 `systemRoundMessageRef(scope, requestId)`，不扫表（PL §5.2.6 #3）；读消息回执 + Query 对 | 回执 `committed`、Query `not_found` → 选择阶段读回等待，不重发；Query `pending`/`running` → 读回等待；`answered` 且 R 已关联 → `record_review`；`answered` 但 R 未关联 → 先走下一行的收尾；`closed` 无合法结论 → 若 R 已回复/撤回则 `finalize_checks` 不带 ref、写 `reviewer_missing`，否则先走下一行 | 不新建第二个 Query/消息；`sendSystemRound` 重放回 `skipped` | PL §5.2.6 #3、§6.1.2 步 5 的规则照用；不加恢复记录 |
| **绑定晚于启动（晚建线）** | 同一个 open 轮、同一个 `execreview:<roundId>` | 线不存在时 `no_review_line`；`Session` 提交唤醒后同轮再判 | 不新开轮、不改旧轮、不补记录 | 同一轮续；已发出的消息不会改投新线 |
| **Run 还在跑** | `displayRoundStatus` 为 `running` | `null`，不发审阅、不开检查轮、不写 Evidence | 无 | Run 正常结束后下一次推进才发；历史读取只读，忙/归档不影响 |
| **入账后、finalize 前重启** | 同一 `record_review` 步；`round` 仍 open | 入账身份固定为 `H(scope, roundRef, 'record_review')`（不含 flow、操作者、现时事实）；owner 先 `replay(id)`，命中即回放原 `{evidenceRef}`，未命中才 `readAndBookOnce()` 读终态/答案并一次入账；随后只补 `finalize_checks` | 不新增 Evidence、不再调模型、不重发/重审；重启换 flow 仍命中原回执 | S9-20 R8：重启用不同 flow（如 `goal-wait:`）验证只补 finalize |
| **答案已存、R 未关联/撤回** | Query `answered`/`closed`；源消息 R 的 `response`/撤回未提交；不靠普通干预入口（`intervention.ts:99` 会先走已完成 Goal → 新 Goal） | 由 `settlementOfferOf` 的 `exec_review` 臂按源 R 报价，只补这条 R 的唯一收尾：`answered` 关联已存答案，`closed` 无合法答案走 `no_answer` 收尾与撤回，坏答案沿用无合法结论收尾；之后才回到普通已完成 Goal 分支 | 不重开 Query、不写候选/Evidence、不建新 Goal；`record_review` 仍按原答案入账 | 收尾回执幂等（`intervention:<messageKey>:respond`）；R8 补此窗口，断言只补回复/撤回、不开 Query、不建新 Goal |

**等待形状。** 不直接返回 `waiting(next:null)`：`continueRoundChain` 在返回发送步骤之前调 ② 的 `readReviewState`，读到已发未答（`exec_review_pending`）或没线（`no_review_line`）就返回 `waiting(round, reason, undefined, basis)`；现有任务循环收集它、跳过当前 Task，能选到别的 Task 就返回下一个 `perform`。只有确实没有其他可推进动作时，才把各分支依据按 `goalWaitBasisOf` 合并（`reasons` 并入、游标取较早；`workflow.ts:1716`、`collaboration-driver.ts:879`、`:1116`），返回合并后的 `waiting(..., next:null)`。发送步本身不再 `rememberWaiting; continue`；发送成功后重新进入选择，同一读看到 Query `pending` → `exec_review_pending`，因此不会反复选中同一轮。`Session`/`SessionMessage`/`VerificationRound`/`Evidence` 的提交会叫醒目标（`task-gate.ts:176`；PL §6.1.5），所以只挡这个 Task 的这一轮，别的 Task/段照常选（PL §6.1.5 的“只挡那一支”）。发送步骤仍走同一条：`advance(next:send, waitBasis) → register(basis, cursorBeforeRead) → drain() → sendSystemRound()`，Goal 循环和任务看守共用（`goal-wait-wakes.ts:86`；PL §6.1.2 步 7/8、§5.5.1 步 5）。`no_review_line` 和 `exec_review_pending` 是等待理由标签，不是记录；不新增字段、状态或恢复表。

**无审阅线的通知（L16；S92-09/10/11）。** 人不能只看到 `waiting`。条件是确定性的：轮次 open、命令检查全结束、计划含 required reviewer 项、`resolveDutyRecipient({duty:'reviewer'})` 为 `null`（不是 `unavailable`/`unsupported`）。此时由 PL-1 的 `plan_notice` 投影源（`createPlanNoticeSource`/`plan-notices.ts`，类别仍是 `plan_notice`，注册在 `create-platform.ts` 的 `noticeSources`）在同一个源里加一个只读分支 `exec-review-no-line`，人的 `decisions/queue` notices 与 `main/read` 直接读到；项形状沿用现有 `NoticeItemV1`，不加字段，注入读口只用现有 `VerificationRound`/TaskRow 读与 `resolveDutyRecipient`，缺读口该分支 `unsupported`、读失败 `unavailable`。内容三项：要审阅的 Task（`round.subject` 的 Task ref 与标题）、当前没有审阅线、从 `role-lines/open` 开线（依赖 7D2 冻结书已提供的 `role-lines/open` → `role_line_add` 路径，收 `reviewer`；第 9 片不扩入口）后系统会在同一轮自动继续。`itemKey=exec-review-no-line:<goalId>:<roundId>`；`position` 取使通知条件成立的检查终态提交游标（最后结束的那条命令检查的提交 event cursor），没有命令检查时才取开轮提交；`VerificationRound.since` 是创建时绑定的 origin、后续更新原样复制，不是当前这次轮记录更新的提交位置（`evidence-service.ts:306`、`:356`），不能当 `position`。复用现有 commit/event 读与 `noticePositionOf`/比较（`automatic-rework-notices.ts:262`、`:277`；`notice-position.ts:42`），不新增记录。读时序：先开轮（推进已读水位），再结束命令检查使条件成立，`position` 才落在水位之后（R11 按此顺序）。按当前待处理事实投影：条件成立期间同一轮同一 `itemKey` 固定一条、`position` 固定，`send_system_round` 重试/回放、`workflow/advance` 重读、冷启动/重启都不追加；条件解除（线已建、轮次不再 open）后不再产项，也不保留历史项——没有“已有项”可读、也不缓存（`decision-contracts.ts:473`；`goal-decisions.ts:63`）。不写记录、不发 Session `notify`、不建卡；轮次/线/读模型任一处读失败 → `unavailable`，不折成“没有线”。

### 3.6 复用与不做

**复用 PL-1。**
- 系统轮正本：`SystemRoundV1`/`SystemRoundHeadV1`/`systemRoundRequestId`（加 `exec_review` 臂）、`systemRoundSendInput`、`sendSystemRound`、`systemRoundMessageRef`、`systemRoundOfText`、`SYSTEM_ROUND_ACTOR`、`lookupHostSendCommit` 的同一版一次判据。
- 消费与创建：§5.2.4 的 `offerKindOf`/`proveInterventionSource`/`handleIntervention`/`planOnIdleLine`；§5.2.7 的 `answerShape`/`finalToolNamesOf`/`createAnswerTools`/`buildAnswerText`/观察器；§5.2.8 的规划注记准入（reviewer 仍不能写注记）。
- 答案：§6.3.3 的接受/屏障/短回复；`submit_exec_review` 的工具入口和第一条成功提交的读取（plan review 的 `submit_plan_review` 原样不动）。
- 审阅线：§6.3.1 的 `resolveDutyRecipient('reviewer')`、reviewer profile；§6.3.4 的重启/没线口径。

**复用现有代码。**
- `read_execution_history` → 经 `createGraphHistoryProxy` 调 `readTaskExecutionHistory`（`graph-tools.ts:365` 的同一适配；Goal/Workspace 校验与 Query 身份转换由 proxy 做）、`ArtifactRef`/body store。
- `EvidenceV1`/`TaskEvidenceIndex`、`finalizeChecks` 的 `reviewerEvidence`、`anchorOf`、`normalEnd`、`goalWaitBasisOf`。
- `readQueryJob`/`readQueryAnswer`、`interventionPlanningQueryRefs`。不另写证据服务、完成规则或发送身份。

**不做。**
- 删掉审阅领取、审阅 Attempt/Lease/预算/占用、`RunSnapshot.purpose`、把审阅当 Work Run 的一切说法。S9-01、S9-02 因此作废：没有审阅 Run，不参与 Task 当前 Run 选择/Goal 已结束 Run 计数。
- S9-05 只剩审阅 Query 的工具集和提示词资源（`read_execution_history`、`exec-review-input`）；S9-09 只剩上面的等待和重启。
- 不新增 `EvidenceKind`/`EvidenceOutcome`/`PlatformDuty` 值；不新增 `RoundSnapshot` 字段、恢复记录、消息字段、报告聚合；不复活材料授权；不把审阅塞进 `RoundCheckSnapshot`。
- 不让工具写 Evidence 或返回 `evidenceRef`/`reviewRef`；不让模型填定位字段；不传裸 `requirementId` 列表（S9-10）；不设 `reviewerMissing`、不造第二套完成规则（S9-12）；不转卡、不发明“审阅通过”；不新增路由。

### 3.7 测试（业务流程、公开入口、不读库）

**口径。** 只走公开入口：`core-routes.ts` 的冻结表（`plans/propose`/`apply`、`workflow/advance`/`driver-start`、`graph/look`、`queries/read`、`sessions/queries`、`executions/history`、`sessions/archive`、`goals/read`/`display`、`sessions/facts`、`decisions/queue` 的 notices、`main/read`、`role-lines/open`（7D2））、`world.platform` 的公开方法、Host、驱动的 `start`/`wake`/`read`/`stop`。不构造状态机节点、不读 `deps.records`/SQLite、不断言私有字段；期望值来自本规格和手算，不从被测系统读回；先写失败测试再改实现。本块用脚本模型与真实平台夹具，不需要真实模型；真实模型只在 §5。

**轮次读数（S9-16）。** R2/R10b 的轮次事实只走现有 `graph/look`：对 Task 节点用 `relation:'checks'` 分页取 round 卡，每项 `NodeCardV1.round` 就是完整 `RoundSnapshot`（`graph-context-reader.ts:1665-1669`、`:1355`；类型 `graph-context-contracts.ts:70`）；或先 `relation:'card'` 读 Task 卡上的 `rounds`，再按 round 节点 `relation:'card'` 读。断言 `round.evidenceRefs`、`round.gaps`、`round.outcome`。读法就是 Task → `rounds` → round 卡 → `round.evidenceRefs`/`gaps`/`outcome`；平台业务测试也可用既有 `EvidencePort.readVerification`（`evidence-contracts.ts:130`）读同一快照。**`tasks/query`/`executions/read` 不是完整检查轮读口**：前者只作 Task/计划事实，后者只作 Run 终态与用途；不新增路由，不读 store。

| 行 | 事件序列（公开入口） | 证明什么 | 具名改坏方式（生产判断） |
|---|---|---|---|
| R1 | 采用含 required `static`+`reviewer` 的计划；Work Run 正常结束；命令检查 PASS → `graph/look` 的 Task `checks` 出现本轮 round 卡：`status='open'`、`gaps=[]`；`queries/read` 在 Host 消费后有 `exec_review` Query；此刻无审阅 Evidence、未 finalize | 有要求才起审阅，且停在 finalize 之前；不新增 `RoundCheckSnapshot` | 让 `nextAfterRound`（`workflow.ts:270`）在命令检查后直接 `finalizeChecksStep`，或让 `pendingRoundChecks` 不跳过 `review-packet`；R1 红 |
| R2 | 审阅者用 `read`/`find`、`graph/look`（Task/Run/round 卡）、`read_execution_history` 读代码/事实/原历史，交 `pass`；`record_review` 入账并 finalize 后 `graph/look` 本轮 round 卡：`evidenceRefs` = 命令检查 refs + 恰一条审阅 `verdict`、`outcome='PASS'`、`gaps=[]`；Task satisfied、`goals/display` 完成。世界必须已执行且全部 required 满足（命令 required PASS + reviewer required PASS），这是 S9-19 的“有效审阅后可完成”证明。同一世界再加“两个 obligation 复用同一 `requirementId`”：两对 `{obligationId, requirementId}` 都含本 Task 的 required reviewer，包内保留两对、finalize 后两对均满足，不按裸 `requirementId` 去重（S92-16）。两变体：① 同一 Session 上有在跑 Query/Run（忙碌）时读旧 Run；② `sessions/archive` 后读；`read_execution_history` 工具与 `executions/history` 路由两条入口各跑一遍，均 `ready` 且页范围不缩 | 三样输入可读、结论进证据、完成链可下钻；忙碌/归档不是读历史的门槛（E17 两条入口）；两个同名 `requirementId` 是两对，不合并、不丢第一对 | 只写 Evidence 不把 ref 交给 `finalizeChecks`（`record_review` 返回不带 ref 的 `finalize_checks`）；或让 `readTaskExecutionHistory`（`graph-execution-history.ts:175`）按 Session 占用/归档提前拒绝；或把包内 coverage 按裸 `requirementId` 去重成一对；R2 红 |
| R3 | 同 Goal 两个 Task：一个只有 required `static`、不要求审阅，另一个才有 required reviewer；只推进前者并跑到 finalize（后者不推进） | 没有 reviewer 项就不建 Query、不发消息、不新增 Session/Run 与轮次；同 Goal 另一 Task 有 reviewer 也不误起（按 `round.subject.taskId` 过滤） | `nextAfterRound` 无条件 `send_system_round`，或删掉 reviewer 项的 `taskIds.includes(round.subject.taskId)` 过滤（另一 Task 的要求也触发）；R3 红 |
| R4 | 审阅交 `fix` → round FAIL、`goals/display` 未完成；`select_work` 返工出同 Task 新 Attempt → 新 Run 结束 → 新轮 `execreview:<newRoundId>` → 再审 `pass` → 完成 | FAIL 不完成；旧 FAIL 保留且被新 PASS 正确超越（`completion.ts:389` 的 supersede/chain） | 把 `fix` 折成 PASS；或返工时清空/覆盖旧 Evidence（旧轮 `evidenceRefs` 丢 FAIL）；R4 红 |
| R5 | 三变体：① Query `closed` 无合法答案/答案 schema 坏；② 具名 body-store 写入/回读失败（包住真实 body store，在 `record_review` 写报告或回读刚写正文的具名点失败一次；`tests/RULES.md:54` 的 A2 故障注入）；③ 合法但 `sourceDigest`/适用性过期。推进到 finalize | ① → INCONCLUSIVE + `reviewer_missing`；② → `unavailable` + `waiting`，零入账（无 Evidence、索引不增），不 finalize；③ → INCONCLUSIVE + `reviewer_stale`；三者都不 PASS、不重发、不重审 | 缺失当空集合 PASS；或吞掉该 body-store I/O 失败仍提交 Evidence（② 红）；或在逐条归属核对里判过期并拒（应只交 fold，`evidence-coverage.ts:153`），③ 就写不出 gap；R5 红 |
| R6 | 被审 Run 仍 `running` 时 `workflow/advance` | 不起审阅、不开新轮、不写 Evidence；`graph/look` 无新 round 卡 | 让 running Run 进 `open_checks`/`nextAfterRound`；R6 红 |
| R7 | Host 先起、审阅线后建；采用计划并开工，晚建线后下一次 `workflow/advance` | 同一 open 轮补发 `execreview:<roundId>`，不新开轮、不改旧轮 | 只在启动时快照计划/线；R7 红 |
| R8 | SQLite 三窗口：① 已发未答重启，`ask` 等人 `workflow/driver-start`、`auto` 续；② 审阅入账后、轮次 finalize 前重启；③ Query 答案已存、源消息 R 尚未关联/撤回时重启 | ① 不新建第二个 Query/消息；② 重入 `record_review` 按同一入账身份 `H(scope, roundRef, 'record_review')` 回放原 `{evidenceRef}`，换不同 flow（如 `goal-wait:`）仍命中原回执，随后只补 `finalize_checks`；`queries/read` 的 `requests.length`/`queryRunRef`/answerRef 不变，最终 `round.evidenceRefs` 里该 `evidenceRef` 只出现一次（不重复），模型调用数不增加；③ 只补源 R 的回复/撤回（`settlementOfferOf` 的 `exec_review` 臂），不开 Query、不建新 Goal | 重启后无条件重发/重审，或让 `record_review` 重调模型/再写一条 Evidence；或把窗口③交给普通干预入口（`intervention.ts:99` 先走“已完成 Goal → 新 Goal”，源 R 收不了尾）；R8 红 |
| R9 | 冷启动前已有“已发审阅、未 finalize”的轮 | 同一 round/同一 Query 续；不重开轮、不重发 | 冷启动重开轮/重发；R9 红 |
| R10a | 非审阅线（`answerShape` 是 `plan_round`/`text`）的真实 Query，由脚本模型在该 Query 内调用 `submit_exec_review`（参数是合法的 `exec_review` 结论：JSON 合法、`kind:'exec_review'`、`verdict`/`basis`/`report` 齐全） | 该 Query 的冻结工具表没有 `submit_exec_review`，plan review 的 `submit_plan_review` 仍在；工具入口拒绝这次调用（`toolDenied`，不落到解析层 `invalid`）；Evidence 没有新写入：`queries/read` 的 `answerRefs` 不增、round `revision`/`evidenceRefs` 不变。错误 `kind`（如 `kind:'plan_round'` → `invalid`）只在纯解析测试里断言（`tests/RULES.md:79` 的 A5），不混进 R10a | 让 `finalToolNamesOf` 给所有 Query 都挂 `submit_exec_review`，或让真实 Query 的工具准入按答案内容而不是 Query 的冻结 `answerShape` 放行；R10a 红 |
| R10b | 三负例加一对照，全走同一 `finalizeChecks` 入口（`world.platform.evidence` 的公开方法）：前置直接走公开 `recordReviewEvidence` 入账并保存返回的 ref：`booked = await platform.evidence.recordReviewEvidence(...); expected = booked.value.evidenceRef;`，不调内部回执 helper（`readRecordReviewReceipt` 只留在生产侧 §3.4 E）。① 把上一轮（同 Task、同链）已 finalize 的审阅 Evidence ref（actor 是 system、coverage 与包相同）提交 → 身份/归属都过，回读后 `ref !== expected`（并命中 `round.chain.supersededEvidenceIds`），`forbidden`；② 把同 Task、相同 anchor/plan 的另一轮 `execreview:` 审阅 Evidence ref 提交给本轮 → 字段可与本轮相同，但 `ref !== expected`，`forbidden`；③ 把别的 Task 的 Evidence ref（`subject` 不符）提交 → `forbidden`。三次都断言 `round.revision`/`evidenceRefs`/`outcome` 与随后 complete 不变。对照：交本轮合规非空 refs → pre-IO 放行、归属核对通过、committed，ref 进 `round.evidenceRefs`，PASS | 拒绝发生在具体层、给具体码；归属规则既不是“全拒”，也不是“只判 count>0”；旧链或同 Task 同 anchor/plan 的另一轮证据都不能冒充本轮 | 把归属核对移回 pre-IO（它读不到轮次/Evidence，只能全拒非空，对照红）；或让 pre-IO 只判 `count>0 → unsupported`（`verification-machine.ts:1098`，①②③ 会以错误码被拒、对照也红，归属规则没被证明）；R10b 红 |
| R11 | 采用含 required `reviewer` 的计划；**时序**先开轮、推进已读水位，再结束命令检查使“无线”条件成立；先不建审阅线；`workflow/advance` 后读 `decisions/queue` 的 notices / `main/read`；再 `workflow/advance` 一次、重启 Host 后再读；最后走 `role-lines/open` 建 reviewer 线（依赖 7D2 冻结书的入口，本片不扩入口），下一次 `workflow/advance` | 条件成立期间同一 open 轮、`no_review_line` 等待；恰好一条 `plan_notice`（`itemKey=exec-review-no-line:<goalId>:<roundId>`，条件成立期间固定），`position` 取使条件成立的检查终态提交游标（没有命令检查才取开轮提交），不得取 `since`；写明该 Task、没有审阅线、从 `role-lines/open` 开线后同轮自动继续；解决前重读/重启不重复；建线后同轮续、不新开轮，只看同轮继续、不检查通知项是否保留 | 把通知做成 Session `notify`/新记录（人的队列读不到或重复追加）；或每次 `send_system_round` 重试都插一条；或把 `position` 取 `since`（落在已读水位之前，通知被永久过滤）；或建线后新开一轮；R11 红 |

**R1/R3 的起与不起。** R1 在命令检查 PASS 后先读 round 卡：`status` 仍是 `open`、`outcome` 为空、`evidenceRefs` 为空（命令结果在 `checks[].reportRef`），Host 消费后 `queries/read` 能看到 `execreview:` Query；若这一步已经 `finalized`，说明审阅被跳过。R3 用同一读法确认没有新 round 卡、`sessions/queries` 的线头请求数不变、没有新增 Session/Run；两行合起来证明“有 required reviewer 才起、没有就不起”。

**R2 的世界（S9-19）。** 这个世界不是“只补一条审阅 Evidence”：命令 required 已执行并 PASS，required reviewer 已被一条 `pass` 覆盖，Task 的 required 项全部满足，`goals/display` 才允许完成。R3e 的旧负例另有未执行的 required future、且没有审阅 Evidence，所以它仍必须拒绝完成；两者不能互相替代。R2 的完成断言只在这个世界成立，不能拿“有 reviewer Evidence”单独推出完成。

**R2 的两变体（S9-20）。** 忙碌变体用公开入口让同一 Session 上有在跑 Query/Run（`sessions/queries` 可见 `running`），再读被审 Run 的历史；归档变体先 `sessions/archive`，再读同一 Run。两条入口都跑：`read_execution_history` 工具（模型只填 `afterCursor`/`limit`，`subjectRunRef` 由工厂从包冻结，模型传不了 Run）与 `executions/history` 路由（`core-routes.ts:531` 的同一 `readTaskExecutionHistory`）。断言两处 `ready`、`items` 不空、`nextCursor` 行为一致；不因 Session 忙/归档返回 `busy`/`not_found`，也不缩页。

**R4 的返工链（S9-20）。** 第一次 `fix` 后先断言旧 round 卡 `outcome='FAIL'`、`evidenceRefs` 仍含那条 FAIL，`goals/display` 未完成；返工产生同 Task 的新 Attempt（不是新 Task），新 Run 正常结束开新轮 `execreview:<newRoundId>`，再审 `pass` 后新轮 `outcome='PASS'`。完成时读 `round.evidenceRefs` 与 `complete_task` 用的同一有效证据集：旧 FAIL 还在记录里，但已被新轮的 PASS 按 `completion.ts:389` 的 supersede/chain 超越，不能拿旧 FAIL 永久挡完成，也不能把旧 FAIL 删掉。

**R5 三变体。** ① 让审阅 Query 走到 `closed` 但没有合法答案（答案缺 `kind`/`verdict`/`basis`）；② 答案合法，但包住真实 body store，在 `record_review` 写报告正文或回读刚写正文的具名点失败一次（`tests/RULES.md:54` 的 A2 故障注入；不把“合法答案携带缺失 artifact”当这个入口的负例——答案只含 `report` 字符串，不接收 artifact ref）；③ 答案合法、ref 可解码，但 Evidence 的适用性按 `evidence-coverage.ts:153` 是 STALE，或 `sourceDigest` 与轮次不符。① 必须在 `record_review` 就停写，`finalize_checks` 不带 ref，fold 给 `reviewer_missing`；② 返回 `unavailable`、`waiting` 等待重试，零入账（不写 Evidence、索引不追加）、不 finalize，重试仍走同一具名点；③ 必须先入账再交 fold，给 `reviewer_stale`。三者都不重发、不重审、不 PASS。

**R6/R7/R9 的恢复与等待。** R6 在 Run `running` 时推进，读 `graph/look` 确认没有新 round 卡、`goals/display`/Task phase 不动；R7 先无审阅线，采用计划并开工，晚建线后同一 open 轮补发，断言 round ref 不变、没有第二个 round；R9 冷启动时已有“已发未 finalize”的轮，断言 `systemRoundMessageRef(scope, 'execreview:<roundId>')` 仍是原消息、`interventionPlanningQueryRefs` 仍是原 Query 对，不重开轮、不重发。三行都不构造恢复记录、不读 SQLite 表。

**R8 的三窗口（S9-20）。** 窗口①在“已发、未答”时重启：`ask` 下 `goals/display` 是 `interrupted_pending_resume`，等人 `workflow/driver-start`；`auto` 直接续。两档都断言 `execreview:` 消息/Query 只有原一对，没有第二个。窗口②在“审阅已入账、轮次未 finalize”时重启：`record_review` 用同一入账身份 `H(scope, roundRef, 'record_review')`（不含 flow/操作者/现时事实）回放原 `{evidenceRef}`，重启换不同 flow（如 `goal-wait:`）仍命中原回执，随后只提交 `finalize_checks`；`queries/read` 的 `requests.length`、`queryRunRef`、`answerRef` 与重启前逐项相等，最终 `round.evidenceRefs` 里该 ref 只出现一次（不重复），模型调用数不增。只补 finalize，不补发、不重审、不再写 Evidence。窗口③在“Query 答案已存、源消息 R 尚未关联/撤回”时重启：不能走普通干预入口（`intervention.ts:99` 会先走“已完成 Goal → 新 Goal”），由 `settlementOfferOf` 的 `exec_review` 臂按源 R 报价（`answered` 关联已存答案，`closed` 无合法答案走 `no_answer` 收尾与撤回），只补这条 R 的唯一回复/撤回；断言不开新 Query、不建新 Goal、不写候选/Evidence，`record_review` 仍按原答案入账。

**R10a/R10b 的断言（S9-17；S92-15；S9Q-02/03）。** R10a：非审阅线的真实 Query（`answerShape` 是 `plan_round`/`text`）里，脚本模型调用 `submit_exec_review`，参数是一份合法的 `exec_review` 结论（JSON 合法、`kind`/`verdict`/`basis`/`report` 齐全）；该 Query 的冻结工具表里没有 `submit_exec_review`，plan review 的工具表仍只有 `submit_plan_review`、没有 `submit_exec_review`，工具入口拒绝这次调用（`toolDenied`，不落到解析层 `invalid`），Evidence 没有新写入（`queries/read` 的 `answerRefs` 不增、round `revision`/`evidenceRefs` 不变）。错误 `kind`（如 `kind:'plan_round'` → `invalid`）单独放纯解析测试（`parseExecReviewAnswer`/`answerProblems`；`tests/RULES.md:79` 的 A5）；工具准入只由真实非审阅 Query 证明，纯解析测试不承担这项断言。R10b：前置直接保存公开 `recordReviewEvidence` 返回的 ref：`booked = await platform.evidence.recordReviewEvidence(...); expected = booked.value.evidenceRef;`，不调内部 `readRecordReviewReceipt`（它只留在生产侧 §3.4 E 的来源证明）；① 上一轮同 Task 同链已 finalize 的审阅 Evidence ref（actor system、coverage 相同）：pre-IO 只核形状放行，身份/归属也过，回读后 `ref !== expected`（并命中 `round.chain.supersededEvidenceIds`），拒 `forbidden`；② 同 Task、相同 anchor/plan 的另一轮 `execreview:` 的审阅 ref：字段可以与本轮相同，但 `ref !== expected`，拒 `forbidden`；③ 别的 Task 的 ref：`subject` 不符，拒 `forbidden`；④ 对照：同一 `finalizeChecks` 入口交本轮合规非空 refs，pre-IO 放行、归属核对通过、`committed`，ref 进 `round.evidenceRefs`、`outcome='PASS'`。三个负例都比对 `round.revision`/`evidenceRefs`/`outcome` 与随后 complete，确认一条记录没写。

**R11 的通知来源与去重（L16；S92-09/10）。** 通知不是新记录，也不给参谋 Session 发 `notify`；它由 PL-1 的 `plan_notice` 投影源在 `noticeSources` 里产出，类别仍是 `plan_notice`。稳定 `itemKey=exec-review-no-line:<goalId>:<roundId>`，`position` 取使通知条件成立的检查终态提交游标（最后结束的命令检查的提交 event cursor；没有命令检查才取开轮提交），不取 `VerificationRound.since`。时序必须先开轮（推进已读水位）、再结束命令检查，`position` 才落在水位之后。条件成立期间重试/回放/重启/再读只一条；条件解除（线已建、轮次不再 open）后不再产项；只验证“解决前重读/重启不重复”和“建线后同轮继续、不新开轮”，不检查通知项是否保留或位置是否沿用。`decisions/queue` 的 notices 与 `main/read` 是公开读口；读不到/读失败按 `unavailable` 记，不折成“没有线”。`role-lines/open` 开线依赖 7D2 冻结书已提供的入口（收 `reviewer`），本片不扩入口；未合入时按 §5.6 记 `prereq-slice-missing`，不把该段改绿。

**三层拒绝（S9-17）。** Query 入口（`record_review` 读答案）挡“不是审阅 Query”；`finalizeChecks` 的 pre-IO（`isolateWrite` 解码 + `roundReviewerEvidenceProblem` 只看 count，`evidence-service.ts:1521`）只挡 ref 不可解码/形状坏，**允许非空**；身份、`subject`/`coverage`/`verificationPlanRef`/`anchor` 归属、别的 Task 的 Evidence 在回执未命中、`roundWriteAdmission` 通过、读完 round/plan/source/Evidence 快照之后、fold 之前逐条核对，码只用 `forbidden`/`invalid`。合法但过期交 fold，不在这一层拒。

**每行的最小断言集。** ① round 卡：`status`、`outcome`、`evidenceRefs`、`gaps`（`graph/look` 或 `readVerification`）；② Query：`queryJobRef`/`queryRunRef`、`answerShape`、`answerRefs.at(-1)`（`queries/read`）；③ 完成：`goals/display` 的 Goal 状态与 Task phase；④ 去重：同一 `execreview:` 只有一条消息、一个 Query 对，没有第二个 round；⑤ 不写：负例前后 round revision 与 `evidenceRefs` 不增，随后 complete 仍不完成（索引未加）；⑥ 通知：`decisions/queue` notices / `main/read` 里同一轮在条件成立期间恰一条 `plan_notice`，内容含 Task/没有线/开线指令，重读/重启不追加。六项都从公开读口取，不从被测系统反推期望值。

**夹具与数据。** 用真实平台夹具从公开写口建 Goal/计划/Run/轮次，不手写 `RoundSnapshot`、不构造状态机事件、不塞 `deps.records`。审阅答案用脚本模型回固定的 `submit_exec_review` 调用；报告正文用真实 body store 写入，不用 mock 文件系统。重启窗口用真实 SQLite 文件，其余用 memory；两者都只经公开 ref 读回，不扫表。

**失败与重跑。** 一行里任一断言失败即该行红，不记“部分通过”；没有 `skip`/`todo`/`only`，不因为前置片缺失把本块行改成绿。重跑用同一输入、同一脚本答案；真实模型的重跑只在 §5 记，不能拿本块的脚本结果替代。

**与 §5/§6 的分工。** 本块只证明审阅编排、证据入账、折叠与恢复；§5 的真实模型验收另跑 8 场景，不拿本块的脚本模型结果充数；§6 的线长读数另走 `sessions/queries`（M1/M2），不拿本块的 round 卡或 `queries/read` 的请求行代替逐轮样本。三块可以互相回指 ref，但不共用判定。

**不验什么。** 不验材料授权、审阅者模型质量、自动返工、witness 行为、浏览器界面；不把 `tasks/query` 的 Task 卡或 `executions/read` 的 Run 卡当“完整检查轮”来断言 Evidence 进轮；不新增路由补这个读口。

**测试落点。** R1–R11 放 `tests/work-graph/`（真实平台夹具 + 脚本模型），R8 的重启窗口放 `tests/scenarios/`（SQLite），老行改在 `tests/state/verification-machine.test.ts` 与 `tests/state/goal-machine.test.ts`；不新开测试目录。

**证据与索引的读法。** 不直接读 `TaskEvidenceIndex` 表：用 round 卡 `evidenceRefs`、`round.outcome`/`gaps` 与随后的 `complete_task`/`goals/display` 观察入账是否发生、是否被超越；需要条数时从 round 卡的 ref 数组取，不从 store 数记录。

**相对第一稿的改动。** 行号沿用，事件重写处如下：

- R1/R3/R6/R7/R9：R1/R6/R7/R9 事件骨架不变；R1 的“审阅步骤出现”改读 `graph/look` round 卡，不再用 `tasks/query`。R3 改为同 Goal 两个 Task、只推进不含 reviewer 的那个，另一 Task 有 reviewer 也不误起（S92-16）。
- R2：轮次读数走 `graph/look`；加忙碌/归档两变体；完成证明限定在“已执行且全部 required 满足”的世界（S9-19）；包内 coverage 加两个复用同一 `requirementId` 的 obligation，保留两对且均满足（S92-16）。
- R4：从“首次 fix”续到“返工→同 Task 新 Attempt→再审 PASS→完成”，并核对旧 FAIL 保留与超越（S9-20）。
- R5：旧稿的“审阅 Run 中断”改成“无合法答案/body-store 写入或回读失败/合法但过期”三变体；没有审阅 Run 可中断（S92-14）。
- R8：保留“已发未答重启（ask/auto）”，新增“入账后、finalize 前重启”与“答案已存、R 未关联/撤回”窗口；窗口②按入账身份回放并换 flow 验证（S9-20、S92-02/08）。
- R10a/R10b：R10a 改在真实非审阅 Query 内由脚本模型调 `submit_exec_review`，证明工具入口拒绝且无 Evidence 写入，纯解析只测错误 `kind`（S92-15、S9Q-02）；R10b 前置改存公开 `recordReviewEvidence` 返回的 ref，不调内部回执 helper（S9Q-03），三条归属负例（上一轮同链 ref、同 Task 同 anchor/plan 的另一轮 ref、别的 Task）加合规对照，各给具体码（S9-17、S92-03）。
- 旧稿“老行要改的”段里 `R3e-completion` 一项删除；该测试原样保留（S9-19）。
- R11（第三稿）：新增无审阅线 `plan_notice`（`exec-review-no-line`）与条件成立期间去重；`position` 取条件成立提交游标、解除后不再产项、开线依赖 7D2 入口（S92-09/10/11）。

**RED 行。** R1/R2/R4/R5/R10b/R11 今天必红：`nextAfterRound` 直接 finalize（`workflow.ts:270-284`），pre-IO guard 对任何非空也拒（`verification-machine.ts:1098-1101`），`completion-policy` 硬卡（`:100-116`）；R10b 的对照也红；R11 还缺 `plan_notice` 的 `exec-review-no-line` 分支。R3/R6/R7/R9 今天多半已绿，按新入口重跑作回归；R8 的窗口②/③是新增。

**老行。** `tests/state/verification-machine.test.ts:545-552` 与 `tests/state/goal-machine.test.ts:528-544` 要改：“count 1/2 → unsupported”改成“0/1/2 全放行；同一条 `finalize` 的非空 ref 落到 status/executor 的 `busy`/`forbidden`；非空 ref 的形状由 `isolateWrite` 解码与 ref 核对挡，身份/归属在回读后按 `forbidden`/`invalid` 拒，过期交 fold”。`tests/state/goal-machine.test.ts:528-544` 本片同步改（L17/D-20）：`goal-machine.ts:492-495` 的 `requiresReviewer` 附注改成“只作提示，不是硬闸”，不再写“no formal producer yet”；这条测试钉住新文字，仍只在 `evaluation.completed:false` 时追加。`tests/work-graph/R3e-completion.test.ts:36-133` 一字不改（S9-19：它的世界还有未执行的 required future，且没有审阅 Evidence，改后仍必须拒绝 Goal 完成）。表外老测试一行不改。**不写 witness 行为测试（S9-21）**，留给见证片；本片不为测试先造 witness 对象或入口。

## 4. 第二块：只读报告见证（边界与现状，不在本片施工）

### 4.1 文档怎么定

> “按已采用义务冻结本轮检查要求和实际来源；使用真实命令、**只读报告见证**及要求中明确存在的独立审阅。没有独立审阅要求时不强加 Reviewer。**报告、正文材料、Evidence、检查轮次和正式完成是不同事实。**”（`MVP-BEHAVIOR.md:154`）

> “只读报告见证（B06）**不在任何一片**，但 **MVP 门槛之前必须做完**。”（`plan-loop-design.md:50`；`:400` 同义，并说 `explore` 任务也要靠它判完成）

> “原来的草稿建在已删的读取器上，**已作废，以后另做**。它**不在任何一片里**，但 MVP 门槛之前必须做完：**第 9 片只给出编排这部分的证据。**”（`DESIGN.md:1479`）

**结论。** B06 是一个独立的 MVP 门槛项，不是第 9 片的施工范围；第 9 片对它的义务只有一条：把“执行结果审阅”这条编排证据做出来，并保证审阅证据不被当成“只读报告见证”。任务书把它列为第 9 片四块之一，是本轮输入与设计的冲突（D-2），按 L6 处理。

### 4.2 代码里已有多少

**端到端 0 条见证流程。** 按“可复用底座”算，最接近的 P2 口径（只读工作报告见证）约 **6/10 = 60%**，P1 口径（已执行命令报告入账）约 4/10，P3 口径（独立审阅报告）约 3/10。百分比是“底座可复用占比”，**不是完成度**；没有 witness 种类、产出者、报告实体、入账口、入口、测试。

| 能力 | 现状 | 判定 | 位置 |
|---|---|---|---|
| 报告正文存储、摘要、不可变 | 内容寻址 body store，`ArtifactRef` 带 digest/size/contentType/source，同内容 first-writer-wins | 能用 | `contracts/artifact.ts:11-35`；`record-store/body-store.ts:27-46` |
| Evidence 聚合/不可变/覆盖折叠 | `EvidenceV1` + `EvidenceSnapshot`（revision 固定 1）+ `selectEffectiveEvidenceSet` | 能用 | `contracts/evidence.ts:77-99`；`tasks/evidence-coverage.ts:76`、`:153` |
| 检查轮/检查项状态机 | 命令检查全套；round revision CAS；一个 commit 写齐 | 能用（仅命令检查） | `verification-machine.ts:884-895`、`:959`、`:1008`、`:1348` |
| 来源捕获/sourceDigest | `VerificationWorkspaceReader` 读 Git/文件元数据，finalize 重新捕获比对 | 能用 | `core/workspace/verification-workspace-reader.ts:41-125`；`evidence-service.ts:1590-1610` |
| 原始执行历史读取 | 按 Run 定位、只读分页、占用/归档不妨碍 | 能用，但未注入 evidence | `agent-runtime/graph-execution-history.ts:1-40`；`composition/create-platform.ts:2139` |
| Workflow 检查顺序 | `open_checks`→`run_check`→`finalize_checks`→PASS 才 complete | 能用（固定 step） | `workflow.ts:270-284`、`:2331-2338`、`:2507-2553` |
| 报告→Evidence 的 verdict | finalize 为每个 check 写 `verdict`，`source.runRef` 固定 null | 半成品（只覆盖 Host 命令检查） | `evidence-service.ts:1616-1623` |
| 审阅报告/ReviewWork | 类型/输出绑定完整（`reportRef`/`reportDigest`/`runRef`），无 owner/runner/结果写入 | 半成品 | `contracts/reviewer-work.ts:45-78`；`source-authority-reader.ts:156-159` |
| 审阅证据进轮 | `finalizeChecks` 收 `reviewerEvidence`，状态机一律拒 | 半成品/被拒 | `model/evidence-contracts.ts:202-206`；`verification-machine.ts:1098-1101` |
| 已存报告入账（VR-06） | 状态机无该行；启动核对遇 `executing` 一律 interrupt，不读已存报告 | 完全没有（已删） | `verification-machine.ts:29-33`；`startup-reconcile.ts:458-465` |
| witness 种类/产出者/入账/事件/入口/测试 | 不存在 | 完全没有 | `grep -riE "witness"` / `grep -riE "见证"` 只命中 Query 来源引用和注释 |

### 4.3 另开一片要建什么（交接清单）

只列缺口，不写做法；这些**不是第 9 片的施工任务**，是 L6 之后那片的最小清单。

| ID | 要建什么 | 落点（候选） | 不能怎么做 |
|---|---|---|---|
| W-1 | 先定“报告”和“见证”的语义：执行者最终文字/工作区报告/检查报告 artifact/审阅报告；见证走 round 内 check 还是独立 Evidence producer | 无代码，lead 决策 | 不能先写代码再补定义 |
| W-2 | witness 的种类/能力（若走 check）：`VerificationCheckKind`、`RoundCheckSnapshot`、`VerificationCheckPlan.satisfactionPath`、`host.ts` 的 `validProposalCheck`、提示词 schema | `contracts/verification.ts:245`；`verification-plan.ts:86-104`；`host.ts:1522-1528` | 不能给 `RegisteredCommandCheck` 硬塞空 command |
| W-3 | witness runner：读报告正文、原执行历史、来源 witness，机械判定，不模拟命令进程 | 放 `core/agent-runtime/`（像 `check-execution.ts`），或 evidence 窄端口由组合根注入 | 不能只读报告正文、不看历史/来源 |
| W-4 | Evidence 入账口：`source.runRef` 写非 null，`kind` 用现有值，`summary.artifactRef` 指报告 | `model/evidence-contracts.ts:119`；`evidence-service.ts:874` | 不能新增 `EvidenceKind`/`EvidenceOutcome`/`EvidenceSnapshot.revision` |
| W-5 | 状态机行/事件/编码：新 transition 或 check phase；`evidence-record-codecs.ts` 的闭合 keys | `verification-machine.ts:959`、`:1008`、`:1348`；`evidence-record-codecs.ts:94-125` | 不能手写 round 字段绕状态机 |
| W-6 | Workflow step：witness 的 pending 不能进 `run_check`；PASS/非 PASS 出口复用现有 | `workflow/contracts.ts:89-167`；`workflow.ts:270-284`、`:2507-2553` | 不能另写完成链 |
| W-7 | 公开读口：从 Goal 完成下钻到义务/证据/原检查/文件版本 | `app/core-routes.ts`（当前无 verification/evidence 明细读口） | 不能靠读库测试代替 |
| W-8 | 测试：报告/历史/来源三者一致、缺失/过期/重启不重跑 | `tests/`，复用 `R3e-*` 的真实平台夹具 | 不能用脚本模型的渲染测试冒充模型判断 |

### 4.4 与审阅的边界

- **审阅 != 见证。** 审阅是“按采用的计划要求，起一个 reviewer 看执行结果，结论进检查证据”；见证是“对一份报告正文，平台只读历史/来源，机械判定它覆盖某条要求”。两者可以共用 Evidence/轮次/完成折叠，但不能互相冒充。
- **不能共用 `reviewerEvidence` 输入。** 那个参数是给“审阅结论”的，不是给“报告见证”的；共用会撞 `roundReviewerEvidenceProblem`，也会让“审阅通过”看起来像“报告已见证”。
- **不能让 witness 满足 `reviewer` requirement。** 反之亦然。B06 把两者并列，完成折叠要按 requirement 的 kind 分开。
- **本片只交编排证据。** §3 的审阅路径通过，只证明“执行结果审阅”这一条编排证据；B06 的 MVP 门槛仍由另开片关闭。第 9 片的验收报告要写这一句，不能把 §3 的通过写成 B06 通过。

### 4.5 L6（要 lead 定）

**L6 只读报告见证的归属。** 文档说另做（`DESIGN.md:1479`），任务书说第 9 片四块之一。

| 选项 | 做法 | 代价 | 建议 |
|---|---|---|---|
| a | 维持设计：另开一片，本片只写 §4 边界 | B06 仍开，MVP 门槛前要另排一片；第 9 片不膨胀 | **建议 a**；与本规格 §2 的范围一致 |
| b | 并入第 9 片 | 要加 W-1～W-8；至少多 800–1,200 行生产/测试（估计），且 W-1 的产品语义未定，会把“最后一片”变成“两片” | 不建议；若 lead 选 b，本规格要重开 §4 为施工节，§12 的估计翻倍 |

**本片对 B06 的实际交付（选 a 也成立）。** ① §4.2 的现状盘点；② §3 的审阅证据路径，证明“审阅”这一条编排证据能进检查；③ 明确“B06 未关闭”的验收口径，防止真实验收报告把它算进 MVP。

## 5. 第三块：真实冲突与真实模型验收

### 5.1 这一块要交什么

| 交付 | 是什么 | 不是什么 |
|---|---|---|
| 冲突处置接缝 | 把已有的“发现”（重叠门、`goal-conflicts`、`compare duplicates`、`compare-formal`、8E 联系）接到“具体对象 + 人的决定 + 计划版本/替代任务”的出口；不自动拦工作（E15） | 不造第二张冲突图、不设单独协调者、不自动修订（8C） |
| 验收驱动 | 从 CLI + HTTP 正式入口起 Host、按 8 场景操作、收证据、写 `result.json` 的测试/脚本；不改生产 | 不是单元测试、不是 `runtimeProvider` 回放、不是直接读 SQLite |
| 8 个场景 | E05、E06、E08、E09、E12、方案迭代、直接干预、等待；逐场景“通过/失败/未覆盖” | 不是“跑一遍冒烟”；不是“部分通过” |
| 131072 两格 | 规划轮 `1M→131072`、`128k→64000`；profile 与 Host binding 同设，真实 provider 接不接受 | 不是“配置合法”、不是“16384 成功”、不是只看 profile 配置值 |

**粗分（本块自身，不含前置片）。** 生产代码 0（可选 O1 30–80 行）；实验 1（Kernel 写文件，§5.2.2）；写夹具 4（E05、E06、直接干预、等待）；只跑 1（E12）；E08、E09、方案迭代的主障碍在 6C/PL-2/8B-2/8C/8E，不在本块。E05 第三项要 §3 的审阅代码，E06/干预/等待要 L2 的人回复入口。这个粗分是施工组织，不是“本块不重要”：8 个场景的证据格式、驱动、判定都在本块。

### 5.2 冲突处置接缝

**文档要求。** “冲突发现与协调”（`DESIGN.md:1294`）；E05 要“两个任务实际并行、时间上重叠、都需要同一条校验规则”，并回具体对象（`MVP-BEHAVIOR.md:366-372`）；E09 要“执行者上报接口/架构冲突 → 参谋解释 → 人的具体决定 → 正式计划版本/替代任务”（`MVP-BEHAVIOR.md:349`）；E15 要“目标冲突时分别选择等待、调整顺序、接受风险并行；提示不自动拦工作”（`MVP-BEHAVIOR.md:355`）；PRODUCT 说“真实冲突的发现与协调在第 9 片”（`PRODUCT.md:201`）。

**今天已有（F7）。** 三层“发现/协调”（C1–C3，避免与 lead 决定 L1–L3 混）已经分散在现有代码里：

| 层 | 已有 | 位置 | 边界 |
|---|---|---|---|
| C1 同目标同模块重叠 | 模块重叠判定、门、注记请求、人释放、公开读口 | `tasks/overlap-gates.ts:45`（`moduleOverlapOf`）、`:88`（满足）、`:171`（请求注记）、`:308`（开）、`:386`（释放）；`workflow.ts:1593-1595`、`:1781-1796`、`:2714-2735`；`core-routes.ts:549-550` | 只看同一 Goal、`running`、同 `moduleId`；门会挡第二个任务到注记/人释放；注记要晚于冲突 Run 的 `startCursor`；不是文件级、不跨 Goal |
| C2 目标冲突提示 | `goalConflictFacts`、`goals/conflicts` 卡/标签、等待/调序/接受风险 | `state/goal-settings-machine.ts:266`；`views/goal-conflicts.ts:70`、`:208`、`:342`；`communication/decision-source/goal-conflict.ts:105-109` | 按两个 Goal 的计划模块 + 已执行文件算；**只建议、不拦**；卡的 `objects` 固定 `[]` |
| C3 接口/架构冲突 | 执行者上报/参谋解释/人的决定走现有消息/卡；`compare-formal`/`impact` 出漂移 finding | `architecture/architecture-service.ts:1686`、`:1708`；`core-routes.ts:479-480`；现有消息/决定卡 | 正式版本/替代任务在 PL-2/6C，正式架构变更在 8B-2/8C；本片不写 |
| 比对候选 | `project_source compare duplicates:true` | `workspace/duplicate-candidates.ts:66`；`ports.ts:107-108` | 只列候选，不判“同一条规则” |

**缺的不是“冲突引擎”，是验收和两个接缝。** 文档把“余下冲突”交给正式检查和返工（`DESIGN.md:611`、`:1468`），“不另造冲突图”（`PRODUCT.md:201`）；决定 89 明确“不在派工时做语义拦截、不加锁、不加新的消息或记录种类、也不改授权”（`PRODUCT.md:370`、`HANDOFF.md:856`）。所以本块的生产代码下限是 **0 行**；唯一可选的只读增量是 O1。

#### 5.2.1 生产代码：0 行（逐条）

| 文档要求 | 今天谁做 | 读什么 | 写什么 | 出口 | 本片新代码 |
|---|---|---|---|---|---|
| 先实测 Kernel 写文件 | lead/验收人；Kernel 是冻结依赖，补丁走 `vendor/`（`DESIGN.md:815`） | Kernel 写行为、Run/Turn 记录、工作区文件 | 不写业务状态；只写实验报告 | 实测报告（§5.2.2） | 0；实验不是产品代码 |
| 平台发现重叠 | `moduleOverlapOf` + 门服务 | Plan/Task、Run、`startedSince`、已有 gate/note | `ModuleOverlapGate` + 事件 | `goals/overlap-gates` 读回模块+waiting+running task/run/startCursor | 0；7C-1 N/L1 已合入 |
| 协调：参谋/秘书写约定、人释放 | `overlap-gates.ts:171`/`:386`；`note-service.ts:1206`；`notes/write`；三份提示词 | 注记/消息/决定卡、模块锚点、`since` 游标 | `convention`/`decision` 注记、`ModuleOverlapGateReleased` | 门满足（`by` 为 `note` 或 `release`）、卡/消息 | 0；现有服务 |
| 冲突返回具体对象 | 门读口返回 `moduleId + running{task,run,startCursor}`；`architecture/impact`/`compare-formal` 返回 module/path/version | Task/Run/Plan/架构目录/观测图 | 只读 | `goals/overlap-gates`、`architecture/impact`、`architecture/compare-formal` | 0（可选 O1） |
| 目标冲突提示/处置 | `goalConflictFacts`、`goals/conflicts`、`decisions/answer` | 两个 Goal、活动 Plan、catalog、`executedFiles`、GoalPhase | 无新记录（`parallelRisks` 已有） | 卡/标签 | 0；第 5 片已合入 |
| E05 比对工具 | `duplicateCandidates` + `project_source compare` | before/after 材料 | 只读报告 | `project_source` 工具值 | 0；7B-2 已合入 |
| E05 接口约定 | 提示词 + 门/注记 | 模块锚点、任务卡、同伴 | `convention` 注记 | `record_note` 回执、门满足 | 0 |
| E05 审阅者判断 | §3 的审阅路径 | 代码/事实/原历史 | 审阅 Evidence | 检查证据 | 另计（§3） |
| E09 上报→解释→决定→正式版本→替代任务 | 上报/解释/决定：现有消息/卡；正式版本：PL-2/6C；架构：8C | 任务/执行/检查/计划/架构目录 | 新计划版本/替代任务/架构修订（前置片） | `plans/*`、`architecture/revise` | 0 冲突代码 |
| worktree/三方合并/接口约定锁 | 无实现，也不该在本片新建 | — | — | — | 0 |

**可选 O1（L7，【lead 定，待审】）：给 `goals/conflicts` 卡补具体对象投影。** 现在 `goal-conflicts.ts:342` 固定 `objects: []`，而 `goalConflictFacts` 已经算出 `moduleRefs`/`filePaths`。若 lead 要求 E05 的“具体对象”也从冲突卡读，补 30–80 行只读投影 + 测试；若接受 `goals/overlap-gates` 作为对象出口，则 0 行。**不做 O2 统一冲突读口、O3 跨 Goal 门、O4 执行后文件级碰撞检测**：O3/O4 与“不按语义拦派工/不加锁/不自动拦/不另造冲突图”冲突，要做先改产品口径（L7）。

#### 5.2.2 先实测 Kernel 写文件（DESIGN 第 9 片行的第一件事）

**为什么。** `DESIGN.md:1294` 第 9 片行开头就是“**先实测 Kernel 写文件**”；J14 也写“先实测 Kernel 写文件的行为”（`DESIGN.md:491`）。这是决定“实际共享冲突会不会丢更新、要不要 worktree/串行/补丁”的前提；不做这个实验，E05 的“实际共享冲突”没有事实基础。

**量什么。** 两个真实 Session/两个 Work Run 在同一工作区、同一文件/模块上并发写；观察：① 最终文件内容/版本（是否丢更新、半写、覆盖）；② Kernel Turn/工具调用记录（两次写是否串行、有无锁/冲突码）；③ Run 的 `changedFiles`/结果；④ 失败时的码与时间。对照：串行写同一文件、不同文件并发写。

**怎么量。** 从正式入口起 Host（script 模型即可；这个实验不需要真实模型，Kernel 是真的），两个 Task/Run 用真实写工具写同一文件；不写业务状态，只写实验报告和临时工作区快照。报告记：Kernel 版本/补丁、文件系统、并发时序、结果、是否可复现。**不改 Kernel**；若发现丢更新，按 `DESIGN.md:815` 走 `vendor/` 补丁流程或产品取舍（worktree/串行），另开决定，不塞进本片代码。

**出口/谁定。** 实验报告给 lead；结论只写“串行/丢更新/未知 + 证据”。若结论影响 E05 的验收判据，回写 §5.3；若影响产品范围，报用户。估计 1–2 天实验 + 100–200 行脚本/夹具（估计），不是生产代码。

#### 5.2.3 协调与 E15 的边界（施工照这个写断言）

- **目标冲突卡只读**：出卡/标签不改 Goal `desiredState`、不挡 `selectNext`/领取/执行（E15、B13；`DESIGN.md:143`、`:153`）。
- **只有人选“等前一个”才挡**：挡“会开始改东西的事”（新任务、干预小任务、秘书“请动手”）；不停已做的，不挡只读问答/查找/出方案（`DESIGN.md:146-148`）。
- **“调整顺序”只影响以后抢同一成员**：不停正在做的工作，不偷换等待对象（`DESIGN.md:145`、`:158`）。
- **“接受风险并行”不是永久授权**：按“两个 Goal + 两边计划版本”记；任一边换计划且仍有交集，卡再出现（`DESIGN.md:154-155`）。
- **没提示 ≠ 无冲突**：不能把“没算出交集”当证明，也不能因语义不确定统一禁止启动（B13 `MVP-BEHAVIOR.md:243`；`PRODUCT.md:366`）。
- **7C 同目标同模块门不受 E15 约束**：它确实挡第二个任务到注记/人释放；这是派工门，不是目标冲突提示（`DESIGN.md:611`；`slice-7-SPEC.md:107`、`:772`）。

#### 5.2.4 worktree/三方合并/接口约定锁：不做

`PRODUCT.md:531` 把三者列在“还缺（未来方向）”，并明说“worktree 是隔离手段之一，不是并行的前提；运行时隔离和集成另行设计，还没做”；同表总注“这不是决定，不改 MVP 范围和施工顺序”（`:525`）；`DESIGN.md:443` 说独立 worktree 不作为强制前提；`PRODUCT.md:370`/`HANDOFF.md:856` 明确不加锁、不加新记录。**本片不实现 worktree/合并/锁**，验收记“未覆盖（另行设计）”；若 lead 要把其中任何一项提进 MVP，另做决定，不是第 9 片默认（L7）。

### 5.3 场景矩阵（8 个）

| 场景 | 现有夹具/测试（file:line） | 缺什么 | 分类 | 验收判据 | 主判据 C 行 |
|---|---|---|---|---|---|
| **E05** 并行 + 共享冲突 + 决定 89 三处核对 | `tests/business/S7C-L1-overlap.test.ts:30`；`tests/state/S7C-overlap-gate-service.test.ts:414`；`tests/data/S7B2-duplicate-candidates.test.ts:26`、`:47`；`tests/helpers/S7C-n-overlap-fixture.ts:11`；`tests/work-graph/R4c-task-claim-concurrency.test.ts:54` | 两个真实 Session 的 Run 时间重叠；实际共享文件/模块冲突；副本在任务开始**之后**埋入；三处核对（接口约定/比对工具/审阅者）；三组反例；临时件收回 | 写夹具（前两处）+ §3 审阅（第三处） | 两个 Run 的 `startedAt/endedAt` 真实重叠且 Session 不同；冲突回具体对象（task/module/path）；独立成果仍在；同 Session 第二领取 `busy`；`duplicates` 列出埋入副本及两处位置；审阅者独立判“同一条规则”；名字不同规则同→报、名字同规则不同→不报、临时件收回；脚本模型不算 | C-182、C-183、C-185、C-71 |
| **E06** 换手后的连续工作 | `tests/business/WP1-continuation-handover.test.ts:86`；`tests/helpers/WP1-handover-fixture.ts:428`；`tests/business/S7B1-B-continuation.test.ts:51`；`tests/business/S6B2-handoff-brief.test.ts:121`；`tests/scenarios/S7B-V-restart.test.ts:56`；`tests/helpers/S7B-fixture.ts:38` | 真实模型换手：谁提出、为什么、接任者读到什么；接任者输入含目标/义务/理由/前沿/未决项；用户不重述；归档后历史可读；记忆子场景避开已排除路径 | 写夹具；L2/7D1 | 接任者实际输入含前任义务/理由/前沿；不是只有同一 Session ID；用户没重述；归档后 `sessions/history`/`executions/history` 可读；接任者引用当前理解/注记并避开已排除路径 | C-75、C-135、C-106/C-194、C-149/C-151 |
| **E08** 采用前/执行中改目标或验收 | `tests/scenarios/S6B3-goal-cards.test.ts:34`；`tests/scenarios/S6B3-adoption.test.ts:36`；`tests/work-graph/S6B3-adoption-service.test.ts:262`；`tests/business/S5-decision-workflow.test.ts:188` | **没有“改目标/验收/范围”的正式路径**（`DESIGN.md:434`；`plan-machine.ts:1331` 拒 `decisionRefs`）；缺执行中切换、旧证据不完成新义务、required 取消不变全绿 | 写代码在 6C | 改前/改后版本与授权可核对；受影响任务/检查/上下文切到新定义；无关任务继续；旧证据不满足新义务；required 取消后不因空集合变绿；拒绝/延期/过期不采用 | C-47、C-62、C-63、C-133a、C-126 |
| **E09** 接口/架构冲突 + 源码漂移 | `tests/state/S7C-overlap-gate-service.test.ts:414`；`tests/business/S7C-L1-overlap.test.ts:31`；`tests/work-graph/S8A-formal-comparison.test.ts:63`、`:105`；`tests/app/S8A-architecture-routes.test.ts:109` | 执行者上报→参谋解释→人的决定→正式计划版本→替代任务（PL-2）；正式架构变更/修复路径（8B-2/8C；`core-routes.ts:474-482` 无 revise）；漂移的修复/待决 | 写代码在 PL-2/6C/8B-2/8C | 冲突由执行者上报，不是只由平台门推断；参谋解释具体对象/影响；人的决定有授权与版本；新计划版本替换受影响任务，新定义进入上下文；漂移能定位版本/文件并进入修复或待决；不把观测 imports 当正式职责 | C-185、C-89、C-65/C-98、C-93/C-95/C-99 |
| **E12** 双图查看 + 重启后新工作 | `tests/scenarios/S3-query-graph.test.ts:96`；`tests/work-graph/S3-graph-context.test.ts:882`；`tests/app/S8A-architecture-routes.test.ts:54`；`tests/work-graph/S8A-formal-comparison.test.ts:63`；`tests/scenarios/A8-host-restart.test.ts:79`；`tests/scenarios/A8-host-restart-paused.test.ts:86`；`tests/app/S8A-L8-host-restart.test.ts:35`；`tests/scenarios/S7B-V-restart.test.ts:56` | 组合场景：真实模型从双图查文件/历史/消息/完成证据，重启后发起相关新工作；查询不触发模型/已读/状态写；历史可复用但过期前提不升级。**重启后不能直接 `driver-start` 旧 Goal**：已完成 Goal 不产生新工作，必须先走“干预消息→`intervention_new_goal` 请求→确认新 Goal→采用首方案”，再启动新 Goal | 只跑一遍（薄脚本） | 路径/版本可回指；查询前后 `activity/queries` 无新 QueryRun、`usage` 不增、`GET changes` 游标不动；`sessions/history`/`executions/history` 可读；重启后旧 Goal 仍 `COMPLETED`，不得用 `driver-start(oldGoalRef)` 充当新工作；新工作经旧工作线 `messages/send` 追加 `intervention_new_goal`（`goalId:null`），由 `goals/confirm-draft` 确认新 Goal、`initialization/adopt` 采用首方案，`workflow/driver-start` 的 `advance.goalRef` 必须是新 Goal；新 Goal 不继承旧 Goal 的完成事实/证据，旧版本只作历史依据，前提过期标“需复查”；沿记录回到文件/轮/证据 | C-36、C-42/C-157、C-88、C-89、C-104、C-145/C-146、C-158 |
| **方案迭代** | `tests/scenarios/S6A-secretary-context-answers.test.ts:135`；`tests/scenarios/S6A-secretary-flow-select.test.ts:101`；`tests/scenarios/S6B3-adoption.test.ts:36`；`tests/work-graph/S5-decision-queue.test.ts:96` | 秘书回答写成正式候选计划的生产者（C-110 明说“不能”）；每轮“改了什么”；候选按请求分开、采用一个后旧候选 `stale`；追问“为什么”复用原版本 | 写代码在 6C | 先给 2–3 个思路且用户选一个；每轮说明改了什么；目标卡和首方案由用户确认；候选按请求分开；采用一个后其他旧候选 `stale`；追问引用原版本/理由 | C-108、C-109、C-110、C-111、C-112 |
| **直接干预** | `tests/scenarios/S7B-V-intervention.test.ts:56`；`tests/helpers/S7B-fixture.ts:220`；`tests/helpers/IV-host-fixture.ts:53`；`tests/scenarios/IV-intervention-host.test.ts:55`；`tests/scenarios/S7B-V-wait-kept.test.ts:30` | 人经正式入口发“直接干预”；四种收尾（反问/非法/没答/放弃）在真实模型下跑；已完成 Goal 的新 Goal 分支；暂停/取消/未知只排队；人回复入口（L2）；界面（E3） | 写夹具；L2/7D1 | 消息在安全点送达，分别显示已排队/已送达/已生效/被拒绝；“问一问”只读副本不打扰原线；有任务接着做，没有任务开 `intervention_planning`；四种收尾通知/回复/撤回正确；已完成 Goal 先确认新 Goal；暂停/取消/未知不冒充继续 | C-199、C-200、C-201、C-202、C-203、C-114 |
| **等待** | `tests/business/S7B1-B-continuation.test.ts:51`、`:153`；`tests/work-graph/S7B-waits-read.test.ts:27`；`tests/scenarios/S7B-V-wait-kept.test.ts:30`；`tests/scenarios/S7B-V-restart.test.ts:56`；`tests/work-graph/S7B2-R-restart.test.ts:25` | 真实模型发 `waitAfterSend` 询问并让出；重启后核对原等待；到期只算一次、第二次到期写“第 2 次到期”；迟回作为新输入；转交保留问题/期限；人回复入口（L2）；不自动换收信人 | 写夹具；L2/7D1 | 原问题/收信人/期限保留；重启后仍核对原等待；同一追问链第二次实际到期 `expiryCount=2`；到期先记不算消费，真实接受才 `consumesWait:true`；迟回保存为下一个安全点新输入、不重开旧等待；归档前先取消/转交，未送达不自动换人 | C-170、C-171、C-187、C-188、C-190 |

**支撑行与重叠。** 每场景的支撑 C 行按下面的清单执行：E05 支撑 C-73/C-191；E06 C-68/C-181；E08 C-46/C-52/C-116/C-118；E09 C-55/C-62；E12 C-147/C-155/C-207；方案迭代 C-105/C-107/C-113/C-194；干预 C-189/C-192/C-197/C-198；等待 C-172/C-184/C-189/C-192/C-195/C-196/C-207。支撑行没跑仍记未覆盖，不能因为主判据通过就一起通过。

### 5.4 正式入口与真实运行顺序

**入口。** `node dist/app/main.js <workbench-config.json>`（`src/app/main.ts:53`、`:190-193`）→ `createLocalWorkbenchHost`（`:204`）→ loopback `host.listen()`（`host.ts:2302`）→ `POST /api/real/core/<route>`（`server.ts:220`；token 见 `core-http-types.ts:141`、`:146`）。`runtimeProvider` 是测试缝（`host.ts:193`），B17 禁用；不能用它跑真实验收。

| 起点 | 实际顺序 | 验收要注意 |
|---|---|---|
| **冷启动** | 先 snapshot 启动数据（`host.ts:454-480`）；无 `runtime` 时 seed 空配置（`:568-570`）；取租约（`:686-689`）；组装 platform（`:704-706`）；恢复设置（`:1582-1586`）；有租约才启动对账（`:1658`）；`startRedrive` 只在 `auto`（`:1689-1702`）；请求队列 `wakeLoop.start` 在核对/重驱之后（`:1703-1712`）；server/listen（`:2281`、`:2302`） | 没有模型时请求排队不是失败（C-193）；`settings/models/save`+`select` 后 `installFromSettings` 重建 runtime；报告记“排队原因：无 profile” |
| **重启** | `host.close()` 先在安全点暂停在跑 Work，不发取消（`execution-control.ts:216`）；新 Host 取租约；启动对账在 drivers/server 之前（`host.ts:1619-1658`）；`ask` 默认写 `GoalInterruption`，`goals/display` 显示 `interrupted_pending_resume`，等人 `workflow/driver-start`；`auto` 合并重驱；`off` 只核对 | 默认 `ask` 下“没开工”可能是对的；正常 SIGINT 与 kill -9 结算不同（kill 留 Kernel Turn，按 W-11 结算）；报告先记档位再判。E12 的“重启后新工作”不是对旧 Goal 发 `driver-start`；旧 Goal 已 `COMPLETED` 时按 E12 起点行走新 Goal 流程 |
| **绑定晚于启动** | 先无 runtime；`settings/models/save`/`select`（`host-settings.ts:839-921`）；`installFromSettings` 重装自动化/预算/Work Run token 预算（`host.ts:1277-1305`）、重建 bindings/profiles（`:1205-1260`）、`resolverRegistry.install`（`:1318`）、替换 `runtimeProfiles`（`:1324-1331`）；新 workspace `addWorkspaceState`+`reconcileAddedScope`（`:1390-1425`） | 不是热替换：旧 handle 保留 pinned 版本；新 profile 只影响之后的消费/领取；先排队的请求绑定后续跑，不记失败；`save` 后 `select` 失败回 `unavailable` 时重试同一保存，不新建第二个模型 |
| **Run 还在跑** | 正常关 Host：`hostClosing` abort → 安全点暂停 → 关 drivers/server/platform/lease（`host.ts:2307-2340`）；直接 kill：Kernel Turn 可能开着，新 Host 按 W-11 结算；在途工具结果未知：保留身份/占用，`unknown-call-reviews/list` 出复核，不自动重跑；模型服务错误：Work `interrupted`/FC-7m，Query `failed`+`closeMessage`，不自动返工 | 报告记关闭方式、停止点、在途工具、Kernel Turn 状态、复核卡、是否人工认定；不要把“暂停”记成“失败” |

**每个场景从哪进（公开路由）。**

| 场景 | 起点 | 关键写 | 关键读 |
|---|---|---|---|
| E05 | `settings/workspaces/open` → `settings/models/save`/`select` → `goals/create` → `plans/propose` → `initialization/adopt` → `workflow/driver-start`/自动驱动 | 计划采用、两次 Work 领取、`project_source compare`（`duplicates:true`）、`goals/overlap-release` | `executions/list`/`read`、`workflow/driver-read`、`goals/overlap-gates`、`tasks/query`、`sessions/history` |
| E06 | 接 E05 的工作线；`messages/send` 或模型 `hand_off`；`decisions/answer` | 交接操作、审批、`HandoffBrief` 写入 | `sessions/find`/`read`、`executions/brief`、`sessions/history`、`lines/read` |
| E08 | 已采用计划的目标；`goals/settings/set`（只改自治/顺序）；改目标/验收等 6C | 新计划版本/决定落实 | `goals/display`、`plans/versions`、`tasks/query`、`sessions/history`、检查轮 |
| E09 | 两个工作包的计划+执行；`architecture/compare-formal`、`architecture/read` | 冲突上报/计划版本、正式架构变更（8B-2 后） | `architecture/compare-formal`、`decisions/queue`、`requests/read`、`plans/proposal` |
| E12 | 任意已完成 Goal；先 `graph/look`/`graph/find`、`sessions/history`、`executions/history`、`activity/runs`；重启后 `messages/send`（旧工作线）→ `requests/read` → `goals/confirm-draft` → `initialization/adopt` → `workflow/driver-start`（`advance.goalRef` 为新 Goal） | 只读为主；重启后新工作才写：`intervention_new_goal` 请求、确认新 Goal、采用首方案 | `activity/queries`（前后）、`GET changes` 游标、`graph/look`、`tasks/query`、`goals/display`、`requests/read`、`plans/versions` |
| 方案迭代 | `requests/submit` → `requests/read` → `requests/ask`/选思路 | 选思路、追问、候选计划 | `requests/read` 的 `answer.ideas`/`selectedIdea`/`candidate`、`plans/request-candidate`、`plans/versions` |
| 直接干预 | `messages/send`（到工作线）→ 领取/驱动 | 干预消息、`intervention_planning`、提案/采用、决定卡 | `queries/read`（`execution.kind=intervention_planning`）、`messages/view`/`inbox`、`plans/proposal`、`decisions/queue` |
| 等待 | 成员经真实工具发 `waitAfterSend` → 回复/到期 | 发送、回答、到期、转交 | `sessions/facts`（`waits`）、`messages/read`（`consumesWait`/`withdrawnAt`）、`requests/read`、`executions/read` |

### 5.5 131072 两格

**代码事实（F11）。** 每请求默认 4096（`contracts/runtime-budget.ts:19`）；本地工作台 profile 覆盖为 16384（`app/runtime-configuration.ts:122`）；硬上限 393216（`runtime-budget.ts:21`）；本地模型 1M 窗口只特判 `deepseek-flash`/`deepseek-v4-pro`（`host.ts:339-344`）；实际请求取 `min(request.maxOutputTokens ?? perResponseTokens, perResponseTokens, 剩余累计输出)`（`model-budget.ts:92`）；没有 131072 常量，没有 `planningOutputReserveTokens`。

**131072 从哪来。** PL-1 的设计公式是 `planningOutputReserveTokens(contextWindowTokens) = min(131072, floor(contextWindowTokens/2))`（`slice-PL-SPEC.md:803`、`:895`）：1M 窗口 → 131072；默认 128k 窗口 → 64000。请求侧和 Host 侧必须用同一个函数值，只改一边会被 `Math.min(requested, host)` 截住（`query-preparation.ts:118`、`:149`；`slice-PL-SPEC.md:803`）。本片不写 PL-1，只验收/探针。

**两格。**

| 格 | `contextWindowTokens` | 目标 `perResponseTokens`（profile 与 binding 同值） | 通过条件（只认请求事实） |
|---|---|---|---|
| A | 1,000,000 | 131072 | `queries/read` 的 `run.run.executionState.requests[]` 中该请求 `reservedOutput=131072`；该请求 `usageStatus='reported'`，`inputTokens`/`outputTokens` 非 null（`cachedInputTokens` 有就记）；profile 的 `runtimeBudget.outputTokens=null`（默认值；报告标“null = 不设上限”，不作通过条件）；provider 不返回 400/422；结束原因不是长度截断 |
| B | 128,000 | 64000 | 同 A，但 `reservedOutput=64000`；`fits` 通过；provider 接受 |

**探针配置（可在 PL-1 前做，不能冒充 PL-1 已实现）：用显式 trusted 启动配置，两处同时设，缺一即被截回。** ① Query profile 的 `runtimeBudget.perResponseTokens`；② 该 profile 的 `runtimeBindingId` 所指 `WorkbenchRuntimeBinding.grant.budget.perResponseTokens`。`projectQueryConfiguration` 在准备时用 `tightenRuntimeBudget` 取 `Math.min(requested, host)`（`query-preparation.ts:118`、`:149`），本地 Host 默认 16384（`runtime-configuration.ts:122`）；只改 profile 仍会发 16384。两格的 `contextWindowTokens` 也在 profile 与 binding 同时设成该格值（同一个 `Math.min`，任何一边小都会改 `fits`/预留）；profile 与 binding 的 scope/Role 必须一致（`runtime-configuration.ts:386`）；`perResponseTokens` 硬上限 393216，合法配置校验走 `runtime-configuration.ts:392-394`。

**累计输出额度也要容纳预留。** `ModelBudget.measure` 取 `Math.min(request.maxOutputTokens ?? perResponseTokens, perResponseTokens, outputTokens - totals.output)`（`model-budget.ts:92`），`outputTokens` 小了会把 131072/64000 再截一次。探针把 `runtimeBudget.outputTokens` 置 null（无累计上限）或 ≥ 预留；`budget.maxTokens` 若显式设置，也要 ≥ 输入预留 + 输出预留（`model-budget.ts:71-81`）。**当前 `validateRuntimeBudget` 给 `outputTokens` 的上限是 128000（`runtime-budget.ts:33`），本片不放宽（L15）：A 格写 `outputTokens: null`（默认本来就是 null，不设累计上限），B 格写 64000。** 报告在每个 A 格记录后标“null = 不设上限”。`outputTokens` 默认就是 null，规划轮的输出预留由 `perResponseTokens` 走，不受这一格影响；这是探针配置约束，不是 PL-1 公式改动，也不改 `validateRuntimeBudget` 的既有上限。

**判定：只看请求事实，不看配置回显。** `queries/read` 返回 `{job, run}`（`queries/contracts.ts:59-62`），读 `run.run.executionState.requests[]`（`query-job.ts:532-544`）：`reservedOutput` 必须是目标值；`usageStatus='reported'` 且有真实 `inputTokens`/`outputTokens`；`400/422`/provider 拒收不算通过。profile 的 `runtimeBudget.perResponseTokens` 即使显示 131072/64000，只要请求 `reservedOutput` 不是目标值，该格就是未覆盖（配置没生效/被 Host 截断），不能判 pass。两格分别判，不互相代替：A 格证明 1M→131072，B 格证明 128k→64000；一格通过不推出另一格。

**失败怎么记。**

| 情况 | 判定 | 记录 |
|---|---|---|
| 请求 `reservedOutput=131072`/`64000`，provider 400/422/拒绝 | **fail**（该格目标能力未达成） | QueryRun `status='closed'`/`outcome='failed'`；`job.job.closeReason.code='failed'`；`requests/read` 的 `closeMessage='<code>: <message>'`；请求行 `usageStatus` 保持 `reserved`/`unknown`，不补造 usage；报告记 `source=model_service`、`kernelCode=provider_request_failed`、`occurredAt`、`autoRetry=false` |
| `reservedOutput` 不是目标值（仍是 16384，或 profile 写 131072 但请求被 Host 截断） | **uncovered** | 原因 `prereq-slice-missing`（PL-1 未合入/配置未生效）；记实际 `reservedOutput`；不记 provider 拒绝 |
| 输入+预留装不下，`ContextCapacityExceeded` | **uncovered provider 接受性** | 请求未发出；记 fits 失败，不记 provider 拒收；不改窗口迁就 |
| 静默降到 16384 后成功（或 provider 拒收后自动降级重试成功） | **禁止记 pass**；该格按实际判 `fail`/`uncovered`，并记两次请求 | 报告写实际 `reservedOutput` 序列（目标值→16384）和两次 `requestId`；不新增字段；降级重试不得覆盖第一次的失败记录 |

**provider 拒收时不静默降。** 131072/64000 被拒就记第一次请求的拒绝和真实 `reservedOutput`；不得把 16384 重试成功写成该格通过，也不得只留降级后的成功记录。探针只回答“provider 收不收这个值”，不回答“规划轮公式是否实现”；PL-1 合入后必须再跑一次走公式的正式路径。

### 5.6 判定、记录、报告

**判定只有三个词：`pass` / `fail` / `uncovered`。** 没有“部分通过”。部分断言没跑到 → `uncovered`，附“已执行的部分”；不能因为“大部分通过”记 pass。旧冒烟的“30 部分”（`STATUS.md:439`）是历史口径，不改 `MVP-BEHAVIOR.md:293`，报告里不私设第四种。

**记录字段（正本 `MVP-BEHAVIOR.md:378`，不另造同义字段）。**

| 组 | 字段 |
|---|---|
| 身份 | `scenario`、`checklistRows`、`runId`、`startedAt/endedAt` |
| 版本 | `tree`、`sourceDiffHash`、`docsVersion`、`promptPack` |
| 环境 | `os`、`node`、`kernelAdapter`、`provider`、`model`、`baseUrlHost`、`contextWindowTokens`、`perResponseTokens`、`cumulativeTokenBudget`（A 格 null 时写“null = 不设上限”）、`settingsHash`、`credentialConfigured` |
| 目标/授权 | `goalRef`、`goalRevision`、`autonomy`、`authorization`、`userCommand` |
| 初始文件 | `workspaceRoot`、`gitHead`、`dirty`、`snapshotHash` |
| 入口 | `cliConfigPath`（脱敏）、`httpSequence[]`（route/commandId/status/code/refs） |
| 调用 | `modelRequests`、`inputTokens/outputTokens/cachedInputTokens`、`commandCalls`、`reruns` |
| 对象链 | `goal→plan→task→run→attempt→session→message→card→evidence`，每段 ref+revision |
| 产物/检查 | `artifactRefs`、`checkRoundRef`、`roundOrdinal`、`checks[]`、`evidenceRefs`、`sourceVersions` |
| 终态 | `goalDisplay`、`taskPhase`、`runOutcome`、`lineState`、`queueCounts` |
| 故障/恢复 | `failureClass`、`source`、`kernelCode`、`occurredAt`、`autoRetry`、`recoveryPath` |
| 未覆盖 | `uncovered[]`（项、原因码、阻断入口） |
| 判定/证据 | `verdict`、`reportPath`、`logs[]`、`resultJson` |

**未覆盖原因码**（统一用）：`prereq-slice-missing`、`entry-missing`、`capability-unsupported`、`provider-rejected`、`env-unavailable`、`ui-not-built`、`not-run`。

**报告位置/形状（建议，不新增账本记录）。**

```text
docs/refactor/reviews/evidence/slice9-rerun-<YYYY-MM-DD>/
  README.md          # 场景汇总表 + 证据链接
  result.json        # 每场景一条记录，schemaVersion 1
  checks/
    commands.txt
    model-calls.jsonl
    http.jsonl
    notes.md
```

`result.json` 只写实际发生的；`README.md` 汇总 `total=8 / pass / fail / uncovered`，**不写 partial**；每个判定后跟 C 行/原文行；失败带 code/reason/time/ref；不写密钥/token/完整 baseUrl 凭据。

### 5.7 和 `rerun-checklist.md` 对齐（不另造一份）

**事实。** 核对表 379 物理行 / 207 评分行；C-168 起接旧表，不重编旧行（`:15`）；最后一行 C-207，新增缺口从 **C-208** 起。核对表对“第 9 片”模式 0 命中，没有现成映射；B17 的 8 场景与 C 行的对应要新建，但**只加链接/补缺口行，不复制行为文字**。

**要补进核对表的缺口（C-208 起；由 lead 定补几条/怎么编号，L9）。**

| 缺口 | 依据 | 建议 |
|---|---|---|
| G1 E05 三处核对 + 三组反例 | `MVP-BEHAVIOR.md:366-374` | 补 1–2 行，不塞进 C-185 |
| G2 E06 记忆/理解交接 | `DESIGN.md:749`；`MVP-BEHAVIOR.md:195-200` | 补一行，不与 C-106/C-194 合并 |
| G3 E08 改目标/验收 | `MVP-BEHAVIOR.md:348`；`DESIGN.md:434` | 补一行；6C 前记“不能” |
| G4 E09 偏差回计划 | `MVP-BEHAVIOR.md:349`；PL-2 | 补一行，与 C-185 分开 |
| G5 E09 正式架构变更 | `MVP-BEHAVIOR.md:349`；`core-routes.ts:474-482` 无 revise | 补一行；8B-2/8C 前记“不能” |
| G6 方案迭代“每轮改了什么” | `MVP-BEHAVIOR.md:98` | 补一行或并入 C-111 |
| G7 人回复入口 | `rerun-checklist.md:59`、`:137`、`:140`、`:367-368` | 不新增行为行；在 C-170/C-187/C-189 的观察里写“L2 后补跑” |
| G8 131072 | `STATUS.md:516`；`slice-PL-SPEC.md:803` | 补一行或并入 C-23/C-169：规划轮 1M→131072、128k→64000；profile 与 binding 两处预算同设；`queries/read` 请求 `reservedOutput` 为期望值且有真实 usage；不以 profile 配置值判 |
| G9 判定词“部分” | `MVP-BEHAVIOR.md:293` vs `STATUS.md:439` | 不改行，改口径：只用三词；旧“部分”只作历史统计 |

**施工规则。** ① 核对表仍是唯一评分表；B17 报告只做“场景→C 行”的卷宗/证据链接/三词汇总。② 缺口补进核对表，不在报告里另开一套。③ 报告每条判据必须回指 C 行或 B17/E05 原文；回指不到的先补核对表，再跑。④ 未跑 C 行不能因场景通过而通过。⑤ 旧冒烟只作历史，不进入本次判定。

### 5.8 依赖、提前做、顺序

**依赖。** E08/方案迭代等 6C；E09 等 PL-2/8B-2/8C/8E；E06/干预/等待等 L2/7D1；E05 第三项等 §3；131072 的正式公式路径等 PL-1（显式探针可提前）；界面等 E3。

**可以提前做（不冒充通过）。**

- **先做 Kernel 写文件实测**（§5.2.2）：script 模型 + 真实 Kernel，两个 Run 并发写同一文件；它不需要真实模型授权，是 E05 的事实前提。
- E12 的“查询不触发模型/已读/状态写”可先用脚本模型验入口/读数；重启后的新工作按“确认新 Goal→采用首方案→启动新 Goal”走，真实模型那一步留空。
- E05 的 `duplicates` 三组反例可先在数据层做机械候选测试；审阅者判断留空。
- E09 的 `compare-formal` 漂移读取可先跑；修复/正式变更留空。
- E06 的交接简报/接任者输入可先在服务层验段和版本；真实模型“避开已排除路径”留空。
- 等待/干预的等待状态、到期、续作可先在 S7B 世界预演；真实模型那一步留空。
- 131072 的“显式配置探针”可先跑（§5.5），但只回答 provider 接受性，不回答 PL-1 公式；探针必须 profile 与 binding 两处预算同设，以 `queries/read` 的 `reservedOutput` + 真实 usage 判，不以 profile 配置值判。

**建议顺序。** ① 不依赖前置片的证据面（E12、E05 前两项、E09 漂移）→ ② L2/7D1 合入后（等待/干预，再 E06）→ ③ 6C 合入后（方案迭代、E08）→ ④ PL-1 合入后（131072 两格正式路径；显式探针可提前）→ ⑤ PL-2/8B-2/8C 合入后（E09 全链路）→ ⑥ 全部齐后按 8 场景做最终重跑；最终报告只认这一次，之前分段运行作证据附件。

## 6. 第四块：量线长与 K2 裁定输入

### 6.1 口径：线长是什么

**线长 = 一条工作线（当前线头 Session）最近一次模型请求的输入 token 量；“命中”= 同一请求的 `cachedInputTokens`。** 不是代码行数，不是执行路径长度，也不是把整条链的 token 相加。

依据：

- `DESIGN.md:1632`（附录 C 第 17 字段“执行的用量”）：“用量：每次模型请求的输入、输出、**命中缓存的 token**（有上限），和查询存的一样”→“**一条线多长、缓存命中多少**；‘太长’和压缩（§4.11）”。
- `DESIGN.md:1048`：“怎么量：第 2 片在执行上存用量；第 9 片真实运行时，看**各条线多长、命中多少**。”
- `slice-7-SPEC.md:262`：“太长：**最近一次模型请求的输入量**（2B 的逐请求用量；`unknown` 或被省略的不算）到了第 6 片 L10 的阈值。”
- `slice-6-SPEC.md:132`：用户 2026-10-15 晚定 **500K，软预算**；到了不打断正在跑的一轮，这一轮结束以后换手；常量 `SECRETARY_HANDOFF_INPUT_TOKENS = 500_000`。
- 判定口径是线头 Session 的 QueryRun 记录：按 `QueryRunSnapshot.run.executionState.sessionGeneration` 倒序（`contracts/query-job.ts:554`），每轮从 `requests[]` 末尾取最后一个 `inputTokens !== null` 的 request，同时取它的 `cachedInputTokens`；现有内部 reader `secretary-handoff-basis.ts:50-87` 是这条口径的实现，但量线长脚本不直接调用它，按 §6.3 从公开 `sessions/queries` 读同一批记录（它只作交叉核对）。换手后新 Session 重新起算，链上前任的 token 不相加。

**“太长”的操作定义。** `min(500_000, floor(0.8 × contextWindowTokens))`；`usage !== null && inputTokens >= threshold`（`secretary-handoff-basis.ts:36-40`；常量在 `model/request-contracts.ts:27`）。500K 是软预算，不是硬上限；到了只在一轮结束后换手，不中断当前轮。这是单次换手判据；L10 的“常常”按 §6.3 的 500K/25% 另算，两个数不混。

### 6.2 今天能算什么、缺什么

| 线 | 能不能按线取“最近一次输入 + 命中” | 依据 | 缺什么 |
|---|---|---|---|
| 查询线（秘书/参谋/书记） | **能，走已有公开原始读口 `sessions/queries`，不需要新代码/新读口** | 2B 的 `QueryModelUsageV1` 逐请求带 `inputTokens`/`cachedInputTokens`/`usageStatus`（`contracts/query-job.ts:532-544`）；每个 `QueryRunSnapshot` 的 `run.executionState.sessionGeneration` 给轮次序（`:554`）；公开路由 `sessions/queries` 分页返回线头 Session 的 `QueryRunSnapshot`（`core-routes.ts:564`；`tasks/session-facts.ts:512`）；内部 reader `secretary-handoff-basis.ts:50-87` 与活动视图 `QueryActivityViewV1`（`views/activity-read-model.ts:91-104`）只作交叉核对 | 只有线头 Session 的单轮读法，没有逐请求增长曲线/全链汇总；这是口径本身，不是缺口。观察窗口内逐轮样本从同一 `sessions/queries` 分页取，不另开读口 |
| 执行者线 | **不能直接取** | `RunActivity` 有逐请求用量和 `sessionRef`（`contracts/run-activity.ts:42-49`、`:66`），但公开视图 `RunActivityViewV1` 只有 `usage.totals + complete`，没有 `sessionRef`/逐请求字段（`activity-read-model.ts:138-149`）；活动 cell 没有 token（`:106-116`） | 一个公开读口，或允许按 Run 合计 + 客户端 join（L8） |

**清单 A 增补（§11）。** `sessions/queries`（`core-routes.ts:564`）是已有公开原始读口，本片只补进清单 A，不新增路由/reader；它是查询线逐轮样本的唯一来源。

**当前实测值：0 条真实记录。** 这是“没有数据”，不是“0 token”。第 9 片还没开书（`plan-loop-design.md:487`），真实重跑也还没做（`STATUS.md:516` 的下一步仍是 `… → 6C → 第 9 片 → E3`）。测试里的 100/200/300/600 是合成值（`tests/composition/S2B-be1-usage.test.ts:24-42`），不能当真实线长。

**文档滞后一处。** `DESIGN.md:1012` 仍写“工作执行的计量只在内存里……没存下来”，那是 2B 之前的事实；树里已实现 `RunActivity`（`contracts/run-activity.ts`）。这是偏差 D-7，写书时改设计，不改代码。

### 6.3 量什么、怎么量、谁定

**量什么（每条线一行）。**

| 字段 | 说明 |
|---|---|
| `lineKey` / `headSessionRef` | 线头 Session；链上前任只作 `chainLength` 记录，不相加 |
| `role` | 秘书/参谋/书记/执行者（按角色线） |
| `lastInputTokens` | 线头 Session 按 `QueryRunSnapshot.run.executionState.sessionGeneration` 降序，第一个有样本轮的最后一次 `inputTokens`；`inputTokens` 为 null 的 request 不算，不记 0 |
| `lastCachedInputTokens` | 同一请求的缓存命中 token |
| `hitRate` | `cachedInputTokens / inputTokens`；分母为 0/unknown/null 时记 null |
| `overThreshold` | 该次是否 ≥ `min(500K, 80% 窗口)`（单次换手判据） |
| `overThresholdRounds` / `observedRounds` | `observedRounds` = 观察窗口内至少有一个 `inputTokens !== null` request 的轮次数；`overThresholdRounds` = 这些轮次中该轮样本 `inputTokens > 500_000` 的轮次数（L10 的固定 500K，不用 80% 窗口值）；最后读数不再另加一条 |
| `usageStatus` / `complete` | 逐请求 `usageStatus`；活动视图 `usage.complete=false` 必须标；分页/交叉核对不完整按“不足以判”，不把缺页当 0 |
| `sourceRefs` | 对应的 QueryRun/request ref（`queryRunRef`、`requestId`），能沿记录核对 |
| `p50` / `p95` | 按角色/线汇总，样本数、预热/丢弃写清；`observedRounds < 10` 不写 p50/p95，写“不足以判” |

**怎么量。**

1. 在 §5 的真实重跑里搭车，不另造场景、不额外调模型。每次场景运行后，从公开读口取每条线的 Session/Run ref 和用量。冷启动/重启/绑定晚于启动/Run 在跑的四种起点按 §5.4 处理；重启后只补读记录，不重跑模型。
2. 查询线：`lines/list` 取 `key`（线头）和 `chainSessions`（`contracts/work-line.ts:105`、`:115`；`key` 就是线头）→ 对线头 Session 用 `sessions/queries`（`core-routes.ts:564`；body `{sessionRef, page:{limit, cursor}}`，`limit` 1–100）分页读完：每页取 `items`，`nextCursor` 非 null 继续；若一页取不到可推进的 ref 而底层仍有下一页，该读直接返回 `incomplete/session_facts_page_limit`（`session-facts.ts:544-547`），按“不完整/不足以判”记，不猜、不把缺页当 0 → 按 `QueryRunSnapshot.run.executionState.sessionGeneration` 降序排序（`contracts/query-job.ts:554`）→ 每轮从 `requests[]` 末尾往前取第一个 `inputTokens !== null` 的 request，同时取 `cachedInputTokens`；该轮没有样本就不计轮次（不记 0）→ 线头最近值取排序后第一个有样本轮的样本；观察窗口内各轮样本保留算频率，`lastInputTokens` 不再在轮次之外重复计一次。内部 reader `secretary-handoff-basis.ts:50-87` 与 `activity/queries` 只作交叉核对，不替代这条读法；不加读口、不读 SQLite。
3. 执行者线：先按 Run 合计汇总（`RunActivityViewV1.usage.totals`），报告里标“混合口径：Run 合计，不是最近一次”；若要“最近一次”，按 L8 加公开读口，或明确允许客户端把 `lines/read` + `readRunActivities` join。**不读 SQLite 表**。
4. 每次真实运行记 `tree`、`docsVersion`、`provider`、`model`、`contextWindowTokens`、`perResponseTokens`、`settingsHash`、机器/Node；数字只记实测，不估算。
5. 频率判据（L10 已定，不再由施工自定）：观察窗口就是本片 §5 真实重跑期间这些线头 Session 的 QueryRun（同一天、同一环境）；窗口外旧轮不补算，也不为凑轮次重跑模型。一条角色线（线头 Session 的 QueryRun）至少 10 个有样本轮（`observedRounds ≥ 10`），且其中 `inputTokens > 500_000` 的轮次占比 ≥25%，才算“常常太长”。`observedRounds < 10` 或分页/交叉核对不完整，写“不足以判”，不写 0、不写未覆盖。500K 是 L10 的固定频率判据；单次 `overThreshold` 仍按 §6.1 的 `min(500K, 80% 窗口)` 记，两个数不混。
6. 交叉核对：用 `secretary-handoff-basis` 重算 `lastInputTokens`/`threshold`，与脚本值逐项比对；用 `activity/queries` 的 `usage.totals`/`complete` 核对合计和完整性，不用它生成逐轮样本，也不把合计当最近值。两边不一致时先查分页/排序，查不清记“不足以判”，不手改数字。
7. 报告位置：`docs/refactor/reviews/evidence/slice9-lines-<date>/README.md` + `result.json` + `raw/lines.jsonl`；和 §5 的报告同一天、同一环境，能互相回指。

**谁定。** lead 出数与提议；**用户**拍板 K2 进不进 MVP（决定 39 的边界）。第 9 片 owner 是 lead（`DESIGN.md:1294`）；500K 阈值是用户 2026-10-15 定的软预算，可改。

**不量什么。** 不量代码行数（没有文档依据）；不跑覆盖率（线长不是覆盖率问题）；不把整条链的 token 相加；不把 `unknown`/`omitted` 当 0；不为凑 10 轮重跑模型或补造样本。

### 6.4 附册：记忆基准集/性能测量（文档归第 9 片，四块未列）

**这是清单里查出来、四块范围没写的一项。** `MEMORY-LOOKUP.md:240` 把“限额”归第 4 片、“性能测量”归第 9 片；`DESIGN.md:1444` 写“第 9 片记忆基准集”；`slice-4-SPEC.md:300` 把“性能尺子的实测”列为不在第 4 片。它不是“再做记忆”，而是“第 4 片已实现，第 9 片补一把可复现的尺子并核对实际使用效果”。

**文档目标（全部是【提议】【没实测的数字】，不是性能承诺）。**

| 项 | 目标/规模 | 出处 |
|---|---|---|
| 基准集 | 单项目 10,000 文件、2,000 任务、20,000 注记、100,000 注记历史版本、100,000 关系引用（O34 字段引用，不是独立记录）、10,000 Session、50,000 Run；正文平均 1 KiB | `MEMORY-LOOKUP.md:30`；`DESIGN.md:1444` |
| 机器 | 本地 SSD、4 核、16 GiB；记录实际 Node/机器/索引大小；内存/SQLite 分开 | `DESIGN.md:1445`；`MEMORY-LOOKUP.md:30` |
| 暖缓存 p95 | 锚点/路径/状态首屏 ≤50 ms；全文 ≤150 ms；关系/历史/冲突 ≤100 ms；当前性 ≤250 ms | `MEMORY-LOOKUP.md:34-37`；`DESIGN.md:1446` |
| 冷启动/重建 | 冷首查 p95 ≤500 ms（不含建索引）；全量重建 ≤60 s | `MEMORY-LOOKUP.md:39`；`DESIGN.md:1446` |
| 并发 | 单读者；4 读者 + 1 写者 | `DESIGN.md:1445`；`MEMORY-LOOKUP.md:39` |
| 记录 | p50/p95、热门锚点、中文短词、最后一页、错误数、`complete`、未核对项 | `MEMORY-LOOKUP.md:39` |

**建议（L11）。** 作为“测量附册”并入第 9 片，四块正文不动；先做 SQLite 单读者 + 重建，再扩 4+1 和内存后端。入口用 `platform.notes.memory*`（`create-platform.ts:2534`）为主表，`look_graph`/`find_graph` 的 `{memory}` 分支（`graph-tools.ts:404-505`）做一组校准；不要拿 HTTP `notes/list` 冒充 memory 读。合成基准不调模型，不需要用户授权；真实使用效果搭 §5 的车，不额外调模型。估计：生产 0–150 行，测试/脚本 700–1,300 行（估计，不是预算）。性能数字不是 MVP 门槛；跑不达如实记录，由 lead 报用户决定是否优化/改范围。

**若 lead 不并入，** 另开一个测量小片，写进排期；不要把“待实现（第 9 片）”留成空指针（L11）。

### 6.5 清单里其余“第 9 片”事项

| 事项 | 文档怎么说 | 本规格怎么处理 |
|---|---|---|
| 语义记忆的验收 | “查找结构化、确定执行，工具内部不调用模型……验收在第 9 片”（`REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md:451`） | 并入 §5 的真实验收 / §6.4 的实际使用核对：看 memory 读的结构化/确定性/不调模型；不另开场景、不新增代码；若 lead 要单独判，按 L11 附册 |
| K3 的真实使用数据 | “等第 9 片有真实使用的数据再定”（`slice-K3-SPEC.md:1586`） | 是数据依赖，不是交付；§5/§6 的真实运行数据可回指，不单列 |
| E3 新界面 | 第 9 片“之后做新界面”（`DESIGN.md:1294`、`E3-UI-ITEMS.md:22`） | 不做；浏览器证据记 `ui-not-built` |
| 记忆基准集 | 见 §6.4 | 附册，待 L11 |

### 6.6 给 K2 的裁定输入

| 项 | 内容 | 依据 |
|---|---|---|
| 判据 | K2 不算 MVP 门槛；第 9 片量过各条线实际多长以后，再定要不要算；在那之前线太长就换手 | `DESIGN.md:1046`；决定 39；`HANDOFF.md:147` |
| 具体提议 | 量出来参谋、书记这些长期线“常常太长”，就把 K2 第一步（清旧工具结果）提进 MVP；摘要那一步在 MVP 之后 | `DESIGN.md:1049` |
| 输入表 | 每条线 `lastInputTokens`、`lastCachedInputTokens`、`hitRate`、`overThresholdRounds/observedRounds`、`complete`；按角色 p50/p95；轮次样本按 §6.3 每轮计一次，不重复计最后读数 | §6.3 |
| 判定门槛（已定） | 一条角色线 ≥10 个有样本轮（`observedRounds ≥ 10`），且 ≥25% 的轮次 `inputTokens > 500_000`，算“常常太长”；不足 10 轮或样本不完整写“不足以判”；不用 20%–30% 区间，不自定比例 | L10（已定；§10.1）；`DESIGN.md:1046`、`:1049` |
| 谁定 | 用户拍板；lead 出数并提议 | `DESIGN.md:1049`、`:1294`；`HANDOFF.md:145-147` |
| 出口 | K2 维持不算 / 只提第一步 / 整片进；无论哪种，都把实测表和未覆盖项写进报告，不改决定 39 的原文 | §0.1 U3 |

## 7. 对外入口与接口

**结论：本片不新增 HTTP 路由，不改 CLI 配置格式，不改公开状态词。** 审阅是 PL-1 系统轮正本上的内部步骤；冲突/验收走现有路由；量线长走现有读口（执行者线按 L8 加读口也不改路由）。新增的只有内部接口（`send_system_round`/`record_review`/`recordReviewEvidence`）、两个工具和一套提示词。

**明确不做。** 不加 HTTP 路由；`queries/read`、`graph/look`、`sessions/queries`、`sessions/history` 只读现有记录；`ReviewWork` 和材料授权不复活；不改 `src/contracts/dispatch.ts` 的 `RunPurpose`；不改 `src/contracts/reviewer-work.ts`。

| 情况 | 今天 | 改后 |
|---|---|---|
| 采用计划里有 required `reviewer` | `nextAfterRound` 直接 finalize；reviewer requirement 变 `uncovered`；Task 卡 `verifying`（F1/F4） | 命令检查跑完后进 `send_system_round`（系统轮）；审阅 Evidence 进轮；PASS 可完成，缺失/过期/FAIL 按 §3.4 出具体 gap |
| 计划里没有 required `reviewer` | 原样 finalize | 原样 finalize，不多一个 Session/Run |
| `finalizeChecks` 带非空 `reviewerEvidence` | `guard_failed/unsupported`（`verification-machine.ts:1098-1101`） | pre-IO 只核 ref 形状；身份/归属回读后按 `forbidden`/`invalid` 拒；过期交 fold |
| 审阅系统轮重启/冷启动 | 没有审阅步骤，无从恢复 | `ask` 等人、`auto` 续驱；按 `execreview:` 请求号定位，不新建第二个 Query/消息；不新增恢复记录 |
| 131072 | 允许配置到 393216，但工作台 profile 是 16384，没有规划公式 | 显式配置探针可发 131072/64000；PL-1 后走公式；报告记实际值 |
| 线长/命中 | 查询线可算；执行者线只有 Run 合计 | 查询线按现口径；执行者线按 L8 加公开读口或标混合口径 |
| 只读报告见证 | 无入口、无种类、无证据 | 本片不改；另开片（L6） |

**新增内部接口（L2-c；不是公开路由）。**

| 内部接口 | 谁调用/注入 | 输入 | 输出/行为 | 失败/边界 |
|---|---|---|---|---|
| `send_system_round`（Workflow step） | `performStep`/`continueRoundChain`（`nextAfterRound` 给出后先过 `readReviewState`，`not_sent` 且有收件线才返回发送步骤） | `{roundRef}` | 调 PL-1 `sendSystemRound`；冻结 `ExecReviewPacketV1` 进正文；同 `execreview:<roundId>` 回放 | 没有审阅线 → 保留 open 轮，等待 `no_review_line`，不是“未实现”；已发未答 → `waiting`，不重发 |
| `record_review`（Workflow step） | `readReviewState` 读到 `answered` 时交出（选择阶段或发送步重入同一分派）；owner 是 `recordReviewEvidence` | `{roundRef}`；答案、冻结包、被审 Run 终态都由 owner 按轮次读 | 先按入账身份回放，未命中才一次 `recordReviewEvidence`；随后 `finalize_checks` | 答案坏/无答案 → 不带 ref 进 finalize；Run 未结束 → `waiting`；不回 `evidenceRef` 给模型 |
| `EvidencePort.recordReviewEvidence` | 组合根 → Workflow | `GraphWrite<RecordReviewEvidenceInputV1>`，`RecordReviewEvidenceInputV1 = {roundRef}` | `{evidenceRef}`；`guard(open, executor, pin) → admit(Evidence, index) → commit`，迁移 `VR-16`、事件 `VerificationReviewEvidenceRecorded`（result 为 `{evidenceRef}`，进 `VERIFICATION_ROUND_EVENT_TYPES` 闭集） | 不合规 → `rejected`/`forbidden`/`invalid`，不写半条；入账身份 `H(scope, roundRef, 'record_review')` 回放原 ref，不用 Workflow 请求号 |
| `finalizeChecks(..., {reviewerEvidence?})` | Workflow `finalize_checks` | 已有签名加可选 `reviewerEvidence` | 非空 refs 纳入 finalize 指纹并随 fold 折叠；空输入保持原指纹 | 只核 ref 形状；身份/归属回读后判；过期交 fold |
| 工具 `submit_exec_review` | 审阅 Query 的工具表 | 新工具名；exec schema `{verdict, basis, report}`；`answerShape='exec_review'` 时由 `finalToolNamesOf` 映射到这里 | 只交结论；不写 Evidence、不返回 `evidenceRef` | 与 plan 的 `submit_plan_review` 不同名、不同 schema；只共用接受/屏障/观察器/存储，解析不共用（D-19） |
| 工具 `read_execution_history` | 审阅 Query 的工具表 | 模型只填 `afterCursor`/`limit`；`subjectRunRef` 由冻结包填 | 经 `createGraphHistoryProxy(existingQueryContext)` 调 `readTaskExecutionHistory`；Goal/Workspace 校验与 Query 身份转换由 proxy 做；分页、只读 | 被审 Session 忙碌/归档不影响读；模型不传 Run |
| 系统轮消息头 `ExecReviewPacketV1` | `send_system_round` 写、审阅 Query 读 | `roundRef`/`planRevisionRef`/`taskRef`/`subjectRunRef`/`checkRefs`/`sourceDigest`/`coverage` | 正文首行后的固定头；模型可见、不可填 | 缺行/多行/JSON 坏 → `invalid`；coverage 为空 → `invalid` |
| `resolveDutyRecipient({duty:'reviewer'})` | `readReviewState`（选择阶段与发送步） | workspace + duty `'reviewer'` | 审阅线收件人 | 没有线 → `null` → `no_review_line`；duty 读失败原样 |
| 通知 `plan_notice`（`exec-review-no-line` 分支） | PL-1 `plan_notice` 投影源；条件成立的 open 轮（命令检查全结束、required reviewer、收件线 `null`） | open 轮 + 缺线事实 | 一条人可读通知：Task、没有审阅线、`role-lines/open` 开线后自动继续；条件成立期间固定 `itemKey`/`position`，解除后不再产项 | 不写记录、不发 Session `notify`、不建卡；读失败 `unavailable` |

**不新增 HTTP 路由。** `queries/read`、`graph/look`、`sessions/queries`、`sessions/history` 只读现有记录；`ReviewWork`/材料授权不复活；`RunPurpose` 和 `reviewer-work.ts` 不动。

**不改的接口。** `plans/propose`/`plans/apply` 的入参/返回；`reviewAdmissionProtocol` 的取值；`EvidenceKind`/`EvidenceOutcome`/`VerificationCheckKind`；`RoundSnapshot` 的字段；`PlatformDutyV1` 的五种职责；`runtime/capabilities`（那是 Kernel 暂停/取消能力，不是 provider 能力）；`settings/models/*` 的形状。

**CLI/配置。** 格式不变（`main.ts:190-193`）；验收配置只多记字段，不加新键。131072 探针用显式 trusted 配置的 `perResponseTokens`，不新增“规划预留”配置键；PL-1 的公式由 PL-1 加。

## 8. 测试

### 8.1 总口径

**只走公开入口。** `core-routes.ts` 的冻结表（`plans/propose`/`apply`、`workflow/advance`/`driver-start`、`graph/look`、`queries/read`、`sessions/queries`、`executions/history`、`sessions/archive`、`goals/read`/`display`、`decisions/queue` 的 notices、`main/read`、`role-lines/open`（7D2））、`world.platform` 的公开方法、Host、驱动的 `start`/`wake`/`read`/`stop`。不构造状态机节点、不读 store/SQLite 表、不断言私有字段。

**期望与红。** 期望值来自本规格或手算，不从被测系统读回；每行先写失败测试再改实现；每行配一个具名改坏方式，指到一处生产判断，不写“实现有 bug”这种不可施工的说明。

**轮次读数（S9-16）。** 只走现有 `graph/look` 的 round 卡：Task 节点 `relation:'checks'` 取 `NodeCardV1.round`（`graph-context-reader.ts:1665-1669`、`:1355`；类型 `graph-context-contracts.ts:70`），或 Task 卡 `rounds` 再按 round 节点 `relation:'card'`。读法就是 Task → `rounds` → round 卡 → `round.evidenceRefs`/`gaps`/`outcome`；平台业务测试可用 `EvidencePort.readVerification`（`evidence-contracts.ts:130`）。`tasks/query`/`executions/read` 只作 Task/Run 事实，**不是完整检查轮读口**；不新增路由。

**后端与模型。** 业务/平台测试用 memory；只有实际重启的 R8 用 SQLite。Host 触发的发送、消费、重启对账经 Host 测。§3 的 Query 步骤用脚本模型回固定工具调用（R10a 在非审阅真实 Query 内用脚本模型调 `submit_exec_review`；R10b 的负例直接走公开平台方法）；§5 才用真实模型。不记“部分通过”，没有 `skip`/`todo`/`only`；某行没跑到就写“未覆盖 + 原因码”，不改绿。

### 8.2 四块的测试入口

| 块 | 入口 | 验什么 | 不验什么 |
|---|---|---|---|
| 审阅 | `plans/propose`/`apply`、`workflow/advance`/`driver-start`、`graph/look`（round 卡）、`queries/read`、`sessions/queries`、`executions/history`（审阅 Query 内另有 `read_execution_history`）、`goals/read`/`display`、`sessions/facts`、`decisions/queue` 的 notices、`main/read`、`role-lines/open`（7D2）；平台业务测试用 `EvidencePort.readVerification` | 有要求才起、三样输入只读、结论进证据、PASS/FAIL/INCONCLUSIVE 折叠、§3.5 的起点与 L16 通知/去重、S9-17 三层拒绝、S9-20 返工/重启 | 材料授权、审阅者模型质量、自动返工、新路由；`tasks/query`/`executions/read` 不当完整轮读口 |
| 见证 | 无（本片不施工） | 无测试行；只在 §4.2/§4.4 做只读盘点与边界口径 | **witness 行为测试（含“witness 是否满足 reviewer”）留给见证片**（S9-21）；本片不造对象、不加入口 |
| 冲突/验收 | CLI + HTTP（§5.4 路由）；验收驱动；131072 走 `queries/read` 的 `requests[]` | 8 场景逐条、C 行回指、131072 两格、授权/记录/判定三词 | 前置片的生产逻辑、浏览器界面、witness |
| 量线长 | `lines/list`、`sessions/queries`、`queries/read`、`activity/runs`、`executions/read`/`list`、`sessions/history` | 查询线最近输入/命中、`complete`、`observedRounds`/`overThresholdRounds`、p50/p95、K2 输入表 | 代码行数、覆盖率、执行者逐请求（公开视图只有 Run 合计） |

**入口的分工。** 审阅块的事件细目就是 §3.7 的 R1–R11，本表只列入口，不重抄事件。S9-15 的 `sessions/queries` 逐轮样本读法只在量线长块用（M1/M2）；S9-13 的 `queries/read` 请求事实（`requests[].reservedOutput`）只在验收块的 131072 两格用（A1/B1）。§3.7 也用 `queries/read`，但只读 Query/答案，不拿它判 131072；两处都不重复 §5/§6 正文。见证块 0 行，不把“审阅证据不是见证”写成行为测试去捏造 witness 对象。

### 8.3 新行（验收）

**审阅块。** R1–R11 见 §3.7；R1–R10b 行号沿用第一稿，R11 为第三稿新增。本稿相对第一稿按下表改/新增，其余行按新入口重跑：

| 行 | 改法 | 依据 |
|---|---|---|
| R2 | 轮次读 `graph/look` round 卡；加“被审 Session 忙碌/已归档仍能读历史”两变体（`read_execution_history` 工具与 `executions/history` 路由各跑）；“有效审阅后可完成”限定在已执行且全部 required 满足的世界；包内 coverage 用两个复用同一 `requirementId` 的 obligation，保留两对且均满足（S92-16） | S9-16、S9-19、S9-20、S92-16 |
| R3 | 同 Goal 只推进不要求审阅的 Task，另一个 Task 才有 required reviewer；仍不建 Query、不发消息、不新开轮（按 `round.subject.taskId` 过滤，S92-16） | S92-16、S9-10 |
| R4 | 从首次 `fix` 续到 `fix→返工→同 Task 新 Attempt→再审 PASS→完成`；核对旧 FAIL 保留且被新 PASS 超越 | S9-20 |
| R8 | 保留“已发未答重启（ask/auto）”，新增“审阅入账后、轮次 finalize 前重启”与“Query 答案已存、R 未关联/撤回”第三窗口；② 按同一入账身份 `H(scope, roundRef, 'record_review')` 回放并换 flow 仍命中，只补 finalize、模型调用数不增；③ 只补源 R 回复/撤回，不开 Query、不建新 Goal | S9-20、S92-02、S92-08 |
| R10a/R10b | R10a：由真实非审阅 Query 内的脚本模型调 `submit_exec_review` 证明工具入口拒绝（合法 exec 参数 → `toolDenied`，无 Evidence 写入），纯解析只测错误 `kind`（→ `invalid`）；并断言 `validQueryExecution` 的 planning 值域为 `plan_round`/`plan_review`/`exec_review`/`text` 四种（别的 kind 带 `answerShape` → `false`）、旧清单缺 `answerShape` → `unavailable`、不回推。R10b：前置保存公开 `recordReviewEvidence` 返回的 ref（`expected = booked.value.evidenceRef`）；三负例为上一轮同链 ref、同 Task 同 anchor/plan 的另一轮 ref、别的 Task 的 Evidence（均 `ref !== expected`/`subject` 不符 → `forbidden`）加合规对照 PASS | S9-17、S92-03、S92-07、S92-15 |
| R11 | 无审阅线时发一条 `plan_notice`（`exec-review-no-line:<goalId>:<roundId>`），条件成立期间固定 `itemKey`/`position`，`position` 取检查终态提交游标（无命令检查取开轮提交）；时序先开轮推进已读水位、再结束检查；写明 Task/没有线/`role-lines/open` 开线后同轮续（7D2 依赖，本片不扩入口）；解决前重读/重启不重复，建线后同轮续，解除后不再产项 | L16；§3.5；S92-09/10/11 |
| `R3e-completion` | 不列入本表、测试一字不改；它另有未执行的 required future 且无审阅 Evidence，仍必须拒绝完成 | S9-19 |

**验收块。** 8 场景各一行，事件序列沿用 §5.3，本节不重抄。真实验收行不写“改坏方式”，改写“授权 + 记录 + 通过/失败/未覆盖”；红不是代码变异，是环境/授权/模型。

| 行 | 场景 | 公开入口/主读 | 判定 |
|---|---|---|---|
| A-E05 | 并行 + 共享冲突 + 决定 89 | `goals/overlap-gates`、`executions/list`/`read`、`sessions/history`；第三处走审阅 Query（§3） | 三处核对 + 三组反例 |
| A-E06 | 换手后的连续工作 | `sessions/history`、`executions/brief`、`lines/read` | 接任者输入含义务/理由/前沿 |
| A-E08 | 采用前/执行中改目标或验收 | `goals/display`、`plans/versions`、`tasks/query` | 旧证据不满足新义务；required 取消不变绿 |
| A-E09 | 接口/架构冲突 + 源码漂移 | `architecture/compare-formal`、`decisions/queue`、`plans/versions` | 上报→解释→决定→新版本/替代任务 |
| A-E12 | 双图查看 + 重启后新工作 | `graph/look`、`activity/queries`、`messages/send`、`goals/confirm-draft` | 查询不触发模型；重启走新 Goal |
| A-iter | 方案迭代 | `requests/read`、`plans/request-candidate`、`plans/versions` | 2–3 思路、每轮改了什么、旧候选 `stale` |
| A-int | 直接干预 | `messages/send`、`queries/read`、`decisions/queue` | 四种收尾 + 已完成 Goal 新 Goal 分支 |
| A-wait | 等待 | `sessions/facts`、`messages/read`、`requests/read` | 原等待保留、到期计数、迟回为新输入 |

**131072 两格（S9-13）。** 不另立场景，按 §5.5 的显式探针配置单独跑，判定不并入 8 场景：

| 行 | 格 | 读什么 | 判定 |
|---|---|---|---|
| A1 | 1M → 131072 | `queries/read` 的 `run.run.executionState.requests[]`：`reservedOutput=131072`、`usageStatus='reported'`、`inputTokens`/`outputTokens` 非 null；profile `outputTokens=null`（默认值；报告标“null = 不设上限”，不作通过条件） | 只认请求事实；provider 400/422 记 fail，配置回显不算 |
| B1 | 128k → 64000 | 同 A1，`reservedOutput=64000` | 同 A1；两格分别判，不互相代替 |

**量线长块。** M1 的读法就是 §6.3 的口径：`lines/list` 取 `key`/`chainSessions`（`work-line.ts:105`、`:115`）→ 对线头 Session 用 `sessions/queries`（`core-routes.ts:564`；`session-facts.ts:512`）分页读完 → 按 `sessionGeneration` 降序（`query-job.ts:554`）→ 每轮从 `requests[]` 末尾取第一个 `inputTokens !== null` 的 request，同时取 `cachedInputTokens`（`:537`、`:539`）；`secretary-handoff-basis.ts:50-87` 只作交叉核对。

| 行 | 事件序列 | 证明什么 | 改坏方式 |
|---|---|---|---|
| M1 | 跑完 §5 一个真实场景；`lines/list` 取线头；`sessions/queries` 分页读完；每轮取最后一个 `inputTokens !== null` 的请求；窗口内各轮样本保留算 `observedRounds`/`overThresholdRounds`，`lastInputTokens` 不重复计；该读返回 `incomplete/session_facts_page_limit` 时记“不完整/不足以判”，不把缺页当 0 | 查询线口径正确、能回指 QueryRun/request；分页不完整如实标 | 把链上前任 token 相加，或每轮取第一个请求而不判 `null`；M1 红 |
| M2 | 用字段形状与 `sessions/queries` 的 `QueryRunSnapshot.run.executionState.requests[]`（或 `queries/read` 同一记录）一致的固定夹具，三条（旧→新）：700K reported、600K reported、unknown；期望 `lastInputTokens=600K`，`complete` 如实。夹具是量线长脚本的纯输入，不写 store、不冒充业务行 | “最近 reported”=600K；`unknown` 不算，取最大/当 0 都能检出 | 扫全部 `requests` 取最大（得 700K），或把 `unknown` 当 0 后取最后一条（得 0）；M2 红 |
| M3 | 同一线换手后新 Session 只有 100K，前任 600K | 换手后重新起算，不相加 | 跨链相加；M3 红 |
| M4 | 执行者线只有 Run 合计 | 报告标“混合口径”，不冒充最近一次 | 把 Run 合计写成 `lastInputTokens`；M4 红 |
| M5 | 样本 <10 轮 | 写“不足以判”，不写“常常太长/不长” | 用 1 轮下结论；M5 红 |

**见证块。** 0 行。witness 的种类/生产者/入账/状态机行都没有，本片只保留 §4 的边界文字；行为测试留给见证片（S9-21）。

### 8.4 要改的老行与 D1 台账

**删除 `R3e-completion` 这一项（S9-19）。** `tests/work-graph/R3e-completion.test.ts:36-133` 原样保留：它的世界还有未执行的 required future intent，而且没有审阅 Evidence，改后仍必须拒绝 Goal 完成；“有效审阅后可完成”由 §3.7 R2 的已执行且全部 required 满足的世界证明，不靠改这条旧负例。

| 文件:行 | 今天断言 | 改后 | 依据 |
|---|---|---|---|
| `tests/state/verification-machine.test.ts:545-552` | `roundReviewerEvidenceProblem(1/2)` → `unsupported`；finalize 先拒任何非空 | `roundReviewerEvidenceProblem(0/1/2)` 全 `null`；同一条 `finalize(..., reviewerEvidenceCount:1, callerIsExecutor:false)` 不再 `unsupported`，按 status/executor 顺序落到 `busy`（`FINAL_PASS` 已 finalized）或 `forbidden`；非空 ref 的形状由 `isolateWrite` 解码/ref 核对挡；身份/归属在回读后按 `forbidden`/`invalid` 拒，过期交 fold | §3.4、S9-17 |
| `tests/state/goal-machine.test.ts:528-544` | `requiresReviewer:true` + `completed:false` 时 detail 附“no formal producer yet” | 附注改为“requiresReviewer 只作提示，不是硬闸”（`goal-machine.ts:492-495`）；测试同步断言新文字，不再出现“no formal producer yet”；仍只在 `evaluation.completed:false` 追加 | §3.4 H；L17；D-20 |

**旧负例。** `tests/work-graph/R3e-completion.test.ts:36-133` 原样保留（S9-19），不列入改动表。今天没有针对该特判的直测，`tests/app` 也没有“reviewer 证据必拒”的 HTTP 断言。

**D1 台账。** 本片改 `tests/state/verification-machine.test.ts:545-552` 与 `tests/state/goal-machine.test.ts:528-544` 两行，涉及 2 个文件；`R3e-completion`、app 不在台账。不新增 `skip`/`todo`/`only`；表外的老测试原样通过，一行不改。若施工查出这两处之外的真实改动，先补这张表再改，不先改测试后补账。

### 8.5 预算

生产行数不在本节重估：§12 的 §3 生产 480–720 由 E 按 L2-c 实际增删回填（删审阅 Run/领取/Lease 口径，增冻结包/入账/fold），本节只列测试/脚本与运行次数。

| 块 | 测试/脚本 | 运行次数 |
|---|---|---|
| §3 审阅 | 400–600 行（R1–R11；含 S9-17 三负例、S9-20 的 R2 两变体/R4 返工链/R8 三窗口、R11 通知去重） | 脚本模型，不调真实模型；R8 至少 4 次 SQLite 重启（窗口① ask/auto 各 1 次 + 窗口② 1 次 + 窗口③ 1 次） |
| §5 验收 | 1,000–1,500 行（驱动 + 8 场景 + 131072 两格） | 8 场景 × 至少 1 个真实模型轮 + 失败重跑 + 2 格 131072 |
| §6 量线长 | 200–300 行（脚本；M1 走公开记录，M2 用同形状夹具） | 搭 §5 的车，不额外调模型 |
| §6.4 附册（若 L11 并入） | 700–1,300 行 | 合成基准 0 模型；实际使用搭 §5 |
| 合计 | 2,300–3,700 行 | 至少 8 次完整场景 + 2 格 131072 + 失败重跑 |

**给 §12 的联动。** 第一稿 §12 曾写 §3 测试 350–550、合计 2,250–3,650；S9-20 把 R2/R4/R8 扩了，本稿已把 §12 的这两处按 400–600 / 2,300–3,700 回填，不留两个数。真实运行的 token/墙钟只记不拦；131072 两格与 8 场景分开计，不把一格通过当两格通过。

## 9. 文件、施工和顺序

### 9.1 文件清单

| 块 | 生产文件 | 测试/脚本 |
|---|---|---|
| 审阅（契约/包） | `src/contracts/exec-review.ts`（新：答案文本/解析）、`src/core/work-graph/tasks/exec-review-packet.ts`（新：`ExecReviewPacketV1` 冻结包读写）；PL 正本 `src/contracts/query-job.ts`（`PlanningAnswerShapeV1`/`QueryAnswerShapeV1` 加 `'exec_review'`、`validQueryExecution` 与 `PreparedQueryManifestV1.answerShape` 校验） | `tests/` 下包/答案解析单测（§3.7） |
| 审阅（Workflow/状态机） | `src/business/workflow/workflow.ts`、`src/business/workflow/contracts.ts`（`nextAfterRound` + `send_system_round`/`record_review` 两个 step）、`src/core/work-graph/state/verification-machine.ts`（跳过 `review-packet`、guard、fold） | `tests/state/verification-machine.test.ts`、`tests/scenarios/` 新审阅流程、`tests/helpers/` 新 fixture |
| 审阅（证据/完成） | `src/core/work-graph/evidence/evidence-service.ts`（`recordReviewEvidence`、finalize 指纹、reviewer refs 折叠）、`src/core/work-graph/model/evidence-contracts.ts`（端口）、`src/core/work-graph/tasks/completion-policy.ts`（删 `reviewerMissing`）、`src/core/work-graph/persistence/evidence-record-codecs.ts`（`VerificationReviewEvidenceRecorded` 的联合/闭集/注册） | `tests/work-graph/R3e-evidence.test.ts`、`tests/work-graph/R3e-completion.test.ts`（原样保留） |
| 审阅（编译/收件人/通知） | `src/core/work-graph/evidence/verification-plan.ts`、`src/contracts/verification.ts`（共享 `compileVerificationCoverage`、reviewer 路径）、`src/core/work-graph/sessions/duty-recipient.ts`（duty 联合加 `'reviewer'`）、`src/core/work-graph/views/plan-notices.ts`（PL-1 的 `plan_notice` 源加 `exec-review-no-line` 只读分支，L16） | `tests/state/` 覆盖编译、duty 解析；notices 读模型 |
| 审阅（工具/提示词） | `src/core/agent-runtime/answer-tools.ts` + 工具表/`answerShape` 分派（`query-preparation.ts`/`execution-preparation.ts`/`execution-driver.ts`/`tool-group-assembly.ts` 按 S9-05 实际落点，含 `query-preparation.ts` 的清单 `answerShape` 复制与 `query-execution.ts` 的启动同值域校验）、`src/core/agent-runtime/graph-tools.ts`（`read_execution_history`，经 `tool-group-assembly.ts:134`/`:438` 的 `createGraphHistoryProxy` 读冻结 Run，不另写 Goal/Workspace 校验或 Query 身份转换）、`resources/prompts/platform/templates/exec-review-input.txt`、`slot-tables.ts` | `tests/agent-runtime/` 工具集/答案形状；R10a/R10b 负例 |
| 冲突/验收 | 0（O1 不做；若 lead 选 O1 另加 30–80 行） | `tests/helpers/` 8 场景、`tests/scenarios/`/`scripts/` 验收驱动、报告目录、Kernel 实验脚本 |
| 量线长 | `src/core/work-graph/views/activity-read-model.ts`（L8，可选） | `tests/work-graph/` 用量读数、`scripts/` 汇总 |
| 记忆附册 | 0–150 行（基准入口/计时钩子） | 生成器/runner/报告 700–1,300 行 |

### 9.2 施工顺序

1. **PL-1 先落（硬依赖）。** 系统轮正本、`sendSystemRound`、`systemRoundMessageRef`/`systemRoundOfText`/`lookupHostSendCommit`、`planningAnswerShapeOf`/`finalizeToolNamesOf`、`compileVerificationCoverage`、`submit_plan_review` 先例。没有这一步，第 2 步整块不能开工；不写替代端口/第二套系统轮。卡：PL-1。
2. **本片 §3 落地。** `exec-review.ts`/`exec-review-packet.ts`、两个 Workflow step（`send_system_round`/`record_review`）、Evidence 入账（`VR-16`/`review_recorded`，`RecordReviewEvidenceInputV1 = {roundRef}`，回执事件 `VerificationReviewEvidenceRecorded` 与 codec/replay 接线）与 fold、`reviewerMissing` 删除、`duty-recipient` 加 reviewer、两个工具与 `exec-review-input` 提示词、`planningAnswerShapeOf` 正本直接加 `exec_review` 一臂并同次扩 `PlanningAnswerShapeV1`/`QueryAnswerShapeV1`/`validQueryExecution`/manifest 校验（L14、S92-07）、`settlementOfferOf` 的 `exec_review` 臂（S92-08，R8 窗口③）、`plan_notice` 的 `exec-review-no-line` 只读分支（L16）。可在 7D2 前落：没有审阅线就保留 open 轮等待 `no_review_line`，并出那条通知。卡：第 1 步。
3. **7D2 审阅线。** 依赖 7D2 已提供的 `role-lines/open` → `role_line_add` 路径（收 reviewer），以及 reviewer profile、只读工具范围；本片不施工入口。线未建时同轮等待，不重开轮、不改旧轮。卡：7D2。
4. **R1–R11 与 E2E R2。** 先红后绿；R2 的端到端在 7D2 线就绪后跑，R8 的 SQLite 重启不依赖 7D2。卡：第 2 步；R2 全链再卡第 3 步。
5. **§5 的 8 场景 / 131072、§6 量线长。** 8 场景按 §5.8：E08/方案迭代卡 6C，E09 卡 PL-2/8B-2/8C，E06/干预/等待卡 L2/7D1；131072 公式路径卡 PL-1（显式探针可提前）。量线长搭 8 场景真实验收的车，执行者线按 L8 先出混合口径。卡：各自前置片 + 第 4 步。

### 9.3 合入条件

- R1–R11 全绿；8.4 的 D1 台账按表改（本稿列 2 行：`verification-machine` 与 `goal-machine`，后者按 L17/D-20 同步改）；表外老测试原样通过；无 `skip`/`todo`/`only`。
- 审阅流程在 memory + SQLite 都跑；重启行 SQLite only。
- 没有为“不会发生”的错误造防御（§11 B 列表）。
- 依赖未合入时，对应能力标 `unavailable`/等待/记未覆盖，不伪装成功，也不返回“未实现”当交付。
- 真实验收报告只认最终一次完整运行；分段运行作附件。

### 9.4 冻结前演练 vs 交付验收

- **冻结前演练**（可失败、可改稿）：在副本上起 CLI + HTTP，跑 R1–R11 和 1–2 个不依赖前置片的场景（E12、E05 前两项），验证入口/读数/证据格式；失败改规格，不改验收结论。
- **交付验收**（只记结果）：8 场景 + 131072 两格 + 线长表；按 §5.6 记 pass/fail/uncovered。**不要把演练结果抄成交付验收的通过**；演练里没跑到的，交付验收记未覆盖。

### 9.5 依赖落地后的重指

每个未合入片落地后，按它的落地树重指 `file:line`，不改规则；7D2 落地后把 `send_system_round` 的“预置 reviewer 线”换成 `role_line_add`；PL-1 落地后把 131072 探针换成公式路径；6C/PL-2/8B-2/8C/8E/L2 落地后把对应场景从“未覆盖”改成“可跑”，再按 §5.8 的顺序补跑。

## 10. 三个登记

### 10.1 要 lead 定（技术选择）

> `L1`–`L17` 是本规格的 lead 决定编号；片名 `L2` 指 7C-2 的 handoff 段，正文写“L2 片”区分。L2 的审阅身份已按 2026-11-01 改裁定为 **L2-c**。冲突层的编号用 `C1`–`C3`（§5.2）。

| ID | 问题 | 建议 | 不选另一条的理由 | 依据 |
|---|---|---|---|---|
| L1 | “采用的计划要求独立审阅”读哪个字段 | 只读 required `verificationRequirements[].kind === 'reviewer'`；`reviewAdmissionProtocol` 不启用 | 后者没有任何触发消费者，规划提示还让候选 omit；启用它会多一套状态而文档没说语义 | `contracts/plan.ts:153-160`、`:201`；`plan-validation.ts:490-493` |
| L2 | 审阅轮的身份 | **c**：平台发给审阅线（duty `reviewer`）的系统轮，用 Query 跑，只读，不领取 Task、不开 Run、不占执行者名额；`execreview:` 前缀，`send_system_round`/`record_review` 两个 step | a 普通 Work Run 要补领取分支、预算、Attempt、Lease、Session 占用，还要把审阅 Run 从 Task 当前 Run 选择和 Goal 计数里排除、补恢复定位链，成本大且 DESIGN §2.9 没要求；b 要补 `ReviewWork` writer、删/改 `grantRefs`、加结果 snapshot，与“不靠材料授权”冲突 | `DESIGN.md:560-570`；`contracts/reviewer-work.ts:30-36`、`:58-78`；PL §5.2/§6.3 |
| L3 | 审阅证据/状态机形状 | 一条 `verdict` Evidence 进 `round.evidenceRefs`；pre-IO 只核 ref 形状（`roundReviewerEvidenceProblem` 允许非空），身份/归属回读后判，过期交 fold；gap 名仍用 `reviewer_missing`/`reviewer_stale`；不新增 round 字段/事件 | 在 pre-IO 判身份/归属会拿不到轮次/证据，且过期先拒就写不出 `reviewer_stale`；新增字段会破 codec 闭合 | §3.4；`contracts/verification.ts:236`；`evidence-service.ts:1521` |
| L4 | 审阅的恢复规则 | 审阅系统轮/Query 已发未答：不新建第二个；`ask` 等人、`auto` 续驱、`off` 只核对；只补收尾，不重开模型轮；不加恢复记录 | 文档 B10 的“已发未收尾的审阅按原记录续做”写的是待 PL-1，没区分计划/执行结果审阅；加恢复记录会违反“不另建记录” | `MVP-BEHAVIOR.md:217`；§3.5 |
| L5 | 是否新增公开 Evidence/verification 读口 | 本片不新增路由；测试用 `graph/look` 的 round 卡（Task→`rounds`→`round.evidenceRefs`/`gaps`/`outcome`），平台业务测试可用 `EvidencePort.readVerification`；B06 的“Goal→义务→证据→原检查”下钻留给 E3/见证片 | 树里没有该路由；为测试加路由会把 E3 的活提前，且 B06 不在本片 | `core-routes.ts:556`；`graph-context-contracts.ts:70`；`E3-UI-ITEMS.md:76` |
| L6 | 只读报告见证归属 | **a** 另开一片，本片只写 §4 边界 | b 要把 W-1～W-8 塞进最后一片，且产品语义未定；设计明确说另做 | `DESIGN.md:1479`；`plan-loop-design.md:50`、`:400` |
| L7 | 冲突生产代码/夹具边界 | 冲突编排生产代码 **0**；只做夹具/验收 + Kernel 写文件实测；E05 对象默认从 `goals/overlap-gates` 读；若要求冲突卡也带对象，做 O1 30–80 行；worktree/三方合并/锁不做 | 文档把重叠限定在同目标同模块，余下靠检查/返工；决定 89 不加锁/不加记录；PRODUCT 自己说隔离/集成为未来方向 | `DESIGN.md:611`、`:1294`、`:1468`；`PRODUCT.md:370`、`:531`；`HANDOFF.md:856` |
| L8 | 执行者线怎么取“最近一次输入” | 先出“Run 合计”的混合口径表并标清；若要“最近一次”，加一个公开读口（不改路由）或允许客户端 join | 直接读 SQLite 违反测试/验收口径；把 Run 合计冒充最近一次会误导 K2 | `activity-read-model.ts:138-149`；§6.2 |
| L9 | 核对表补哪些 C 行 | 按 §5.7 G1–G6/G8 补，C-208 起；G7 不新增行；G9 只改口径 | 不补会让下一轮继续漏；在报告里另开一套会破坏“唯一评分表” | `rerun-checklist.md:15`、`:342` |
| L10 | “常常太长”的量化门槛 | 每角色线 ≥10 个有样本轮；其中 `inputTokens > 500_000` 的轮次 ≥25% 算“常常”；样本不足写“不足以判” | 文档只给单次阈值，没有频率；不定门槛就无法把数据变成 K2 裁定 | `DESIGN.md:1046`、`:1049`；§6.3 |
| L11 | 记忆基准集/性能测量放哪 | 作为“测量附册”并入第 9 片，四块正文不动；若工期紧另开测量小片并写进排期 | §8.2 四块没列，§9.3/MEMORY-LOOKUP 明确归第 9 片；不处理会留空指针 | `MEMORY-LOOKUP.md:240`；`DESIGN.md:1444` |
| L12 | 131072 何时验 | 先在显式配置上做“provider 接受性探针”，PL-1 合入后再跑公式两格；探针不冒充 PL-1 | 不做探针要等 PL-1 才知道 provider 收不收；把探针当公式会漏“1M→131072/128k→64000” | `slice-PL-SPEC.md:803`；§5.5 |
| L13 | exec 审阅结论用什么工具名 | **新工具名 `submit_exec_review`**；plan review 仍 `submit_plan_review`。同名不同 schema 会让模型和测试看混；共用只保留答案基础设施（接受、屏障、`acceptedAnswerCallIds`、观察器、`QueryJobAnswer` 存储、回执幂等），schema/正文/解析各写各的 | 同名分派虽省一个工具入口，但两条 strict schema 在同一名字下不可区分，PL 的解析只认 `kind:'plan_review'`；新名让工具表/提示词/测试显式区分，代价是各写一份 schema/解析 | §3.3；§7；D-19 |
| L14 | `planningAnswerShapeOf` 加 `roundKind`/`exec_review` 一臂：改 PL-1 正本还是本片加薄包装 | **本片施工时直接改 `planningAnswerShapeOf` 正本**，不加薄包装；这一臂是第 9 片自己的改动，`PlanningAnswerShapeV1`/`QueryAnswerShapeV1`/`validQueryExecution`/manifest 校验也由本片一起扩 `exec_review`（S92-07，见 §3.3）；PL-1 不动 | 函数本来就按 `head.kind`/duty 分派，执行结果审阅是同一族系统轮；加薄包装会复制“哪种轮→哪种 shape”的判据，PL-1 落地后留两套。直接改正本一处，C 的 plan review 与 `execreview:` 共用 | PL §5.2.4；§3.2⑤；§9.2 |
| L15 | `RuntimeBudget.outputTokens` 上限 128000 与 A 格 131072 冲突 | **不放宽 128000**：A 格写 `outputTokens: null`（默认本来就是 null，不设累计上限），B 格写 64000；报告标“null = 不设上限” | 放宽会改 `validateRuntimeBudget` 的既有上限、影响所有 profile；null 足以完成 A 格探针。规划轮的输出预留由 `perResponseTokens` 走，不受这一格影响 | `runtime-budget.ts:33`；§5.5；D-16 |
| L16 | 无审阅线：PL-1 转候选卡 `no_review_line`，本片保留 open 轮等待，二者口径是否统一 | **统一为 PL-1 的 `no_review_line` 等待标签**：轮次保持 open、不转卡、不记未覆盖；线晚建后同轮续。另发一条 `plan_notice`（`exec-review-no-line:<goalId>:<roundId>`），写明哪个 Task 要审阅、没有审阅线、从 `role-lines/open` 开线后自动继续；条件成立期间固定 `itemKey`/`position`（`position` 取使条件成立的检查终态提交游标，无命令检查取开轮提交），解除后不产项；`role-lines/open` 是 7D2 依赖、本片不扩入口；不加记录 | 转卡会把“等线”变成产品卡，且本片没有候选可转、线建后没有回轮入口；只等待人不知道，故用 PL-1 的投影通知（不是 Session `notify`、不是新记录）。通知按当前待处理事实投影，重试/回放/重启不追加，也不沿用历史位置 | PL §19.1；§3.2④；§3.5；D-18 |
| L17 | `goal-machine.ts:494` 的“no formal producer yet”附注在本片后失真，改不改 | **改**：本片交付后已有正式生产者（系统轮审阅），附注改成“requiresReviewer 只作提示，不是硬闸”，并同步改 `tests/state/goal-machine.test.ts:528-544`；与 §8.4 台账一起一次改 | 不改会让下一轮读者以为审阅还没生产者；与“表外老测试原样通过”的冲突按 D1 台账登记解决——只改这一条已列出的老测试，其余表外老测试仍原样通过 | `goal-machine.ts:492-495`；`tests/state/goal-machine.test.ts:528-544`；§8.4；D-20 |

### 10.2 要用户定（OPEN）

| ID | 问题 | 选项 | lead 建议 | 状态 |
|---|---|---|---|---|
| U1 | 真实模型调用授权 | (a) 每次点头；(b) 窗口：场景清单 + 模型/费用上限，窗口内逐场景跑，越界停 | b；报告逐场景记授权原文 | 待定 |
| U2 | 131072 的 provider/模型与拒收处理 | (a) 只测 DeepSeek 1M 模型；(b) DeepSeek+OpenAI；(c) 拒收降 16384（备选） | a；拒收记失败，不静默降；换 provider/降预留另定。**本稿默认不降**，c 只作你拍板后的备选 | 待定 |
| U3 | K2 进不进 MVP | (a) 维持决定 39；(b) 只提第一步清旧工具结果；(c) 整片进 | 先 a，量完再按 b/c 裁 | 待定 |
| U4 | “用户能看到”是否接受 HTTP 读模型 | (a) 本轮接受，浏览器记未覆盖；(b) 等 E3 补浏览器 | a；不因没界面判失败 | 待定 |
| U5 | 记忆基准是否值得跑完整规模（若 L11 并入） | (a) 完整 10k/20k/100k；(b) 先缩小规模看趋势再决定 | 先完整跑 SQLite 单读者+重建，再扩并发/内存；缩水标未覆盖 | 待定 |

### 10.3 偏差（总表）

| ID | 设计/文档怎么说 | 代码/现状 | 影响 | 落法/建议 |
|---|---|---|---|---|
| D-1 | 任务书说核对表 207 行 | 文件 379 物理行；207 是评分行（`:342`） | 容易以为文件被截断 | 引用写“207 评分行 / 379 物理行”；不重编旧行 |
| D-2 | 任务书把只读报告见证列为第 9 片第 2 块 | `DESIGN.md:1479`、`plan-loop-design.md:50`、`:400` 说不在任何一片、另做；第 9 片只给编排证据 | 范围冲突；若按任务书做，第 9 片膨胀 | 按 L6-a；§4 只写边界/现状；B06 另开片 |
| D-3 | `DESIGN.md:560` 标执行结果审阅“已定”；`:490` J13 表写“提议” | 同一文档自相矛盾；STATE-MACHINES 仍写 `reviewerEvidence` 必须为空（`:3051`、`:3073`、`:3199`）；L2-c 不改这条文档矛盾 | 测试可能同时钉“接受”和“拒绝”；读者会以为审阅证据仍必须为空 | 以 §2.9 的“已定行为 + 提议落法”为目标；旧规格行按本片改写；本片新增 `VR-16` 并放宽 VR-07 的 `reviewerEvidence` 守卫；L3 冻结；不引用 STATE-MACHINES 的旧禁令 |
| D-4 | 设计说“起审阅者、结论进检查证据” | `nextAfterRound` 没有分支；`ReviewWork` 无 writer；`RunPurpose` 只有 unknown-call review；**L2-c 不走 Run/ReviewWork**，缺的是系统轮接缝 | 按 L2-a 要补领取/预算/Attempt/Lease/占用五段无用成本；按 L2-c 只需 PL-1 系统轮 + 两个 step + 入账/fold | §3 按 L2-c 落；不补领取分支、不加 `RunPurpose`、不补 `ReviewWork` writer；`ReviewWork` 只作历史契约保留 |
| D-5 | “缺少要求的审阅不能算通过” | `completion-policy` 对任何 required reviewer 硬拒，message 写“no formal producer yet”（`:100`、`:116`） | 有正式审阅也完不成；保留特判会形成第二套完成规则 | 删 `reviewerMissing` 及 `hardNotSatisfied` 项，走统一有效证据折叠；不拆“生产者能力”；§3.4 H |
| D-6 | `DESIGN.md:565` 说审阅者不靠材料授权 | `STATUS.md:458` 说“审阅者以后要另想办法读材料”；`ReviewInputBinding.grantRefs` 仍在 | 读者会以为还要授权 | 以 DESIGN §2.9 为准；`grantRefs` 是历史字段，不进本片 |
| D-7 | `DESIGN.md:1012` 说执行用量“只在内存里、没存下来” | 2B 已实现 `RunActivity`（`contracts/run-activity.ts`） | 文档滞后 | 写书时改设计；不改代码 |
| D-8 | MVP E08 要改目标/验收 | `DESIGN.md:434` 自己说今天做不到；`plan-machine.ts:1331` 拒 `decisionRefs` | E08 现在不能判通过 | 等 6C；本片记 `prereq-slice-missing` |
| D-9 | MVP E09 要正式架构变更/修复 | `core-routes.ts:474-482` 只有 initial adopt/capture/read/query/compare/compare-formal/impact/observation-state，无 revise | E09 只能验漂移读取 | 等 PL-2/8B-2/8C；本片记未覆盖 |
| D-10 | PL-1 要规划轮 131072/64000 | 没有 131072 常量/`planningOutputReserveTokens`；工作台 16384、默认 4096、上限 393216 | 现在不能走公式；只能显式配置探针 | 等 PL-1；§5.5 两格；探针不冒充。**PL-1 已把 `planningOutputReserveTokens` 写进设计（`slice-PL-SPEC.md:803`），本片只验收、不实现** |
| D-11 | B17 只要通过/失败/未覆盖 | 旧冒烟用“部分”（`STATUS.md:439`） | 报告口径会打架 | 坚持三词；旧“部分”只作历史；不改 MVP 原文 |
| D-12 | 设计把“记忆基准集/性能测量”归第 9 片 | §8.2 四块没列；`MEMORY-LOOKUP.md:240`、`DESIGN.md:1444` 明确归第 9 片 | 规格会漏项或超范围 | L11：附册并入或另开片；先冻结口径 |
| D-13 | `plan-loop-design.md:476` 说真实模型验收“第 9 片之前先跑一次” | `MVP-BEHAVIOR.md:289`、`STATUS.md:519` 说在第 9 片内 | 排期理解不一致 | 以 B17 为准：第 9 片交付验收；第 9 片之前可跑限定演练，不冒充 |
| D-14 | PRODUCT `:531` 把 worktree/三方合并/接口约定锁列在“第 9 片真实冲突”行 | 同句说“运行时隔离和集成另行设计，还没做”；DESIGN §5.2 说 worktree 是隔离手段之一，不是并行前提 | 容易把三件大事塞进本片 | 本片不做；验收记“未覆盖（另行设计）”；L7 |
| D-15 | 任务书把“执行结果审阅”与“只读报告见证”并列成两块 | B06 把“只读报告见证”和“独立审阅”并列，但 DESIGN §9.5 把见证划出本片 | 两块的范围不同 | §3 做审阅；§4 只写见证边界；不共用 `reviewerEvidence` |
| D-16 | 131072 探针要 A 格 131072 | `validateRuntimeBudget` 给 `outputTokens` 的上限是 128000（`runtime-budget.ts:33`）；A 格 131072 不能写进累计值 | 写 131072 会被配置校验拒；写小值会被 `ModelBudget.measure` 再截一次，探针测不到 provider | **不放宽 128000（L15）**：A 格 `outputTokens: null`（默认值，无累计上限），B 格 64000；报告标“null = 不设上限”；规划轮输出预留不受影响 |
| D-17 | 设计说 Evidence 来源写审阅线 Session | `ActorRef` 的 `agent` 臂必须带 `runRef`；L2-c 没有审阅 Run | 直接写 `{kind:'agent', id:sessionId}` 会缺必填 `runRef`，写假 RunRef 又伪造来源 | Evidence actor 落 `{kind:'system', id: reviewerSessionId}`；`source.runRef=null`、`source.checkId=null`；§3.4 B |
| D-18 | PL-1 无审阅线时转候选卡/`no_review_line` | 本片是系统轮，没有 `PlanProposal` 可转；只能保留 open 轮等待 | 转卡会把“等线”变成产品卡，且线建好后没有回轮入口；两片口径不一致；只等待人又不知道 | 本稿统一为 `no_review_line` 等待标签，不转卡、不记未覆盖；并额外出一条 `plan_notice`（`exec-review-no-line:<goalId>:<roundId>`，条件成立期间固定 `itemKey`/`position`（`position` 取使条件成立的检查终态提交游标，无命令检查取开轮提交），解除后不产项；`role-lines/open` 是 7D2 依赖、本片不扩入口；不写记录）；§3.2④、§3.5 |
| D-19 | PL 的 `submit_plan_review` 是 strict schema，只认 `kind:'plan_review'` | exec 结论是 `{verdict,basis,report}`；同名不同 schema 会让模型和测试看混（L13） | 共用工具名会让 plan review 多出字段，或 exec 被 unknown-member 拒；同名分派也让测试难分清入口 | **新工具名 `submit_exec_review`（L13）**，plan 仍 `submit_plan_review`；只共用答案基础设施（接受、屏障、`acceptedAnswerCallIds`、观察器、`QueryJobAnswer` 存储、回执幂等）；schema、正文、解析各写各的（`execReviewAnswerText`/`parseExecReviewAnswer`）；见 §3.3、§7 |
| D-20 | `goal-machine.ts:494` 附注写“no formal producer yet” | 本片交付后有正式生产者（系统轮审阅）；`tests/state/goal-machine.test.ts:528-544` 钉住该文字 | 附注失真，下一轮读者会以为审阅还没生产者；改文字要动一条已列出的老测试 | 本片按 L17 改：附注改成“requiresReviewer 只作提示，不是硬闸”，同步 `tests/state/goal-machine.test.ts:528-544`；进 §8.4 台账，涉及 2 个文件 |

### 10.4 规格新定的（总表）

| ID | 内容 | 落点 | 依据 |
|---|---|---|---|
| N1 | 审阅步骤插在“命令检查全结束、finalize 之前”；这是从“审阅者看检查结果 + 结论进检查证据”推出的施工位置，不是文档逐字写的 | §3.1/§3.2 | `DESIGN.md:560-570`；`MVP-BEHAVIOR.md:267` |
| N2 | 审阅是 **L2-c 系统轮**：平台发给审阅线（duty `reviewer`）的 Query，只读，不领取 Task、不开 Run、不占执行者名额；不改 `RunPurpose`、不复活 `ReviewWork`、不加派发端口 | §3.2/§3.3 | L2-c；`DESIGN.md:560-570`；PL §5.2/§6.3 |
| N3 | 系统轮种类 `exec_review`、前缀 `execreview:`、冻结包头 `ExecReviewPacketV1`（`roundRef`/`planRevisionRef`/`taskRef`/`subjectRunRef`/`checkRefs`/`sourceDigest`/`coverage`）；头只进正文，不写记录；模型可见不可填 | §3.2③/§3.4 B | PL §5.2.3/§5.2.6 |
| N4 | `answerShape='exec_review'`；exec 用新工具名 `submit_exec_review`（`{verdict,basis,report}`），plan review 仍 `submit_plan_review`；只共用接受/屏障/观察器/存储，解析不共用；并由本片一起扩 `PlanningAnswerShapeV1`/`QueryAnswerShapeV1`/`validQueryExecution`/manifest 校验，准备、启动、观察器同一值域 | §3.3/§7 | PL §5.2.7/§6.3.3；D-19；S92-07 |
| N5 | Workflow 两个 step：`send_system_round`（入 `{roundRef}`，调 PL-1 `sendSystemRound`）与 `record_review`（入 `{roundRef}`；答案、冻结包、被审 Run 终态由 owner 按轮次读，一次入账） | §3.2②④⑦/§7 | PL §5.2.5；S9-03 |
| N6 | Evidence actor 用 system 臂：`{kind:'system', id: reviewerSessionId}`，`runRef=null`、`checkId=null`；不写“本片第一次写 runRef” | §3.4 B | `contracts/evidence.ts:77-99`；D-17 |
| N7 | 无审阅线：保留 open 轮、等待 `no_review_line`，晚建线后同轮续；不是“未实现”，不转卡、不记未覆盖；并额外出一条 `plan_notice`（`exec-review-no-line:<goalId>:<roundId>`），写明 Task/没有线/`role-lines/open` 开线后自动继续；条件成立期间固定 `itemKey`/`position`（`position` 取检查终态提交游标，无命令检查取开轮提交），解除后不产项；`role-lines/open` 是 7D2 依赖、本片不扩入口；不写记录 | §3.2④/§3.5/§3.7 R11 | PL §19.1；S9-09；L16；D-18 |
| N8 | `record_review` 按入账身份 `H(scope, roundRef, 'record_review')` 先回放、再一次提交 Evidence + 索引；`VerificationReviewEvidenceRecorded` 进 `VERIFICATION_ROUND_EVENT_TYPES` 闭集、result `{evidenceRef}`；`finalizeChecks(..., {reviewerEvidence})` 的非空 refs 纳入指纹并折叠；工具不返回 `evidenceRef` | §3.4 C/F/§7 | S9-03/S9-08；S92-04；`evidence-contracts.ts:202` |
| N9 | L10 门槛：一条角色线 ≥10 个有样本轮，且 ≥25% 轮次 `inputTokens > 500_000` 算“常常”；不足写“不足以判” | §6.3/§8.3 M5 | L10；`DESIGN.md:1046` |
| N10 | 131072 探针：profile 与 binding 同设 `perResponseTokens`（及 `contextWindowTokens`），只认请求 `reservedOutput` 与真实 usage，不认配置回显；A 格 `outputTokens=null`（默认值；报告标“null = 不设上限”，不放宽 128000） | §5.5/§8.3 A1/B1 | S9-13；`runtime-budget.ts:33`；L15；D-16 |
| N11 | gap code 用 `reviewer_missing`/`reviewer_stale`；`RoundGapV1.code` 是 string，不新增枚举 | §3.4 | `contracts/verification.ts:236` |
| N12 | 执行者线先出“Run 合计”的混合口径表并标清；要“最近一次”再按 L8 加读口 | §6.2 | L8；`activity-read-model.ts:138-149` |
| N13 | 冲突编排生产代码 0；只做夹具/验收 + Kernel 写文件实测；可选 O1 30–80 行 | §5.2 | `DESIGN.md:611`、`:1294`、`:1468`；`PRODUCT.md:370` |
| N14 | reviewer requirement 用既有的 `satisfactionPath:'review-packet'` 承载；开轮跳过、不建 `RoundCheckSnapshot`；不新增 check 形状 | §3.4 | `contracts/verification.ts:247-254`；`verification-plan.ts:85-103` |

## 11. 不做的事、复用清单 A、不处理的错误 B

**A. 复用（原样用，不重写）。**

- PL-1 系统轮正本：`SystemRoundV1`/`SystemRoundHeadV1`/`systemRoundRequestId`、`sendSystemRound`、`systemRoundMessageRef`、`systemRoundOfText`、`lookupHostSendCommit`、`answerShape`、`finalizeToolNamesOf`、`createAnswerTools`、`submit_plan_review` 入口（plan review）；本片 exec 用新名 `submit_exec_review`，只共用接受/屏障/观察器/存储。`PlanningAnswerShapeV1`/`QueryAnswerShapeV1`/`validQueryExecution` 不按原样复用，按 §3.3 在 PL 正本扩 `exec_review`（manifest 校验同次扩），准备/启动/观察器同一值域。
- 共享覆盖编译：`compileVerificationCoverage`（PL §6.2 正本），本片只加 reviewer 路径。
- 收件人：`resolveDutyRecipient`（`duty-recipient.ts:22`）的 `'reviewer'` 臂。
- 只读文件工具：`execution-driver.ts:969-978`、`exploration-tools.ts:67-69`。
- `look_graph`/`find_graph`、`readTaskExecutionHistory`、`createGraphHistoryProxy`：`graph-tools.ts:361-370`、`graph-execution-history.ts:175-291`、`tool-group-assembly.ts:134`/`:438`；新工具 `read_execution_history` 必须经 `proxy = createGraphHistoryProxy(existingQueryContext)` 再 `proxy.readTaskExecutionHistory(toolCtx, {runRef:packet.subjectRunRef, ...page})`，Goal/Workspace 校验与 Query 身份适配由 proxy 正本做，不另写范围或 Host 身份转换。
- `graph/look` 的 round 卡（`Task→rounds→round.evidenceRefs/gaps/outcome`）、`sessions/queries`（`core-routes.ts:564`）：现有公开读口，不新增路由。
- `ArtifactRef`/body store、`MaterialPort.storeArtifact/openArtifact`：`contracts/artifact.ts:11-35`、`materials/material-service.ts:120`、`:181`。
- `EvidenceV1`/`EvidenceSnapshot`/`TaskEvidenceIndex`、`selectEffectiveEvidenceSet`/`evidenceApplicabilityWithBasis`、`EvidencePort.readVerification`：`contracts/evidence.ts:77-99`、`tasks/evidence-coverage.ts:76`、`:153`、`evidence-contracts.ts:130`。
- `compileVerificationPlan`、`verification-machine` 的写入口、`finalizeChecks` 及其 `reviewerEvidence` 可选参数、Workflow 的 PASS/非 PASS 出口、`completion-policy` 的 required/coverage 折叠：§3.6 列的位置。
- 2B 的 `RunActivity`/`QueryActivity` 用量、`secretary-handoff-basis` 的读法：§6.1。
- 8A 的 `compare-formal`/`impact`、`duplicate-candidates`、重叠门、`goal-conflicts`：§5.2。

**B. 不处理的错误（不会发生/不防御）。**

- 不做审阅 Run：不为“审阅 Run 的领取/Attempt/Lease/预算/占用/恢复定位”造任何分支；L2-c 没有这些对象。
- 不做 `ReviewWork` writer，不复活材料授权：`grantRefs` 只作历史字段，不参与新审阅。
- 不做 witness 生产者：本片没有 witness 种类/入口/行为测试，留给见证片（S9-21）。
- 不做第二套完成规则：删 `reviewerMissing` 后只走统一有效证据折叠。
- 不为“审阅者写工作区/改计划”造防御：工具集本来就不给写；只在测试里证明没有写工具，不写运行时拦截器。
- 不为“同一轮起两个审阅”造分布式锁：Workflow 单写者 + round CAS 已经保证；重试用同一入账身份 `H(scope, roundRef, 'record_review')` 幂等（回放原 `{evidenceRef}`）。
- 不为“Evidence 被伪造”造签名：Evidence 只由平台端口写，审阅模型没有写证据的工具。
- 不为“provider 不支持 131072”造自动降级：拒收就记失败/未覆盖，降不降由用户定（U2）。
- 不为“浏览器没界面”造假页面：E3 之前页面 503，验收记 `ui-not-built`。
- 不为“旧轮次没有审阅字段”造迁移：`VR-16` 是状态机迁移，不是数据格式/字段迁移；仍不加 round 字段，旧轮次按原样读。

**唯一一份。** 复用清单只有这一份，§3.6 不再重列；不处理的错误只有这一份，§7/§9 不另开“防御清单”。

## 12. 估计（不是预算）

| 块 | 生产 | 测试/脚本 | 真实运行 |
|---|---|---|---|
| §3 执行结果审阅 | 480–720 行 | 400–600 行 | 脚本模型即可；不需要真实模型 |
| §4 只读报告见证 | 0 | 0 | 0；若 L6-b 并入，+800–1,200 行 |
| §5 冲突/真实验收 | 0（O1 不做；若 lead 选 O1 另加 30–80 行） | 1,000–1,500 行（驱动+8 场景） | 8 场景 × 至少 1 轮真实模型 + 失败重跑 + 2 格 131072；Kernel 写文件 1–2 天 |
| §6 量线长 | 0–150 行（执行者线读口，L8） | 200–300 行 | 搭 §5 的车，不额外调模型 |
| §6.4 记忆附册（若 L11 并入） | 0–150 行 | 700–1,300 行 | 合成基准不调模型；实际使用效果搭 §5 |
| **合计** | **480–1,020 行** | **2,300–3,700 行** | **8 场景 × ≥1 轮真实模型 + 失败重跑 + 2 格 131072 + R8 至少 4 次 SQLite 重启（三窗口，含答案已存窗口）+ Kernel 写文件 1–2 天** |

**规格本身。** v1 890 行 → v2 1,192 行（+302）→ v3 1,209 行（+17）→ v4 1,221 行（+12）→ v5 1,230 行（+9）。第三稿只按 L13–L17 小改，正文沿用第二稿的 L2-c 结构；第五稿只按 S9Q-01/02/03 收口；行数以交付文件为准。

这些是估计，不是预算，也不是验收数字；施工后按实际行数/运行次数回填。真实运行的 token/墙钟只记不拦。

## 13. 审查与改动记录

### 第一稿（2026-11-01）

- 范围按任务书四块 + `DESIGN.md:1294`；只读报告见证按 `DESIGN.md:1479` 划出本片；记忆基准集按 `MEMORY-LOOKUP.md:240` 单列附册。
- 待 lead 审：L1–L12（尤其 L2 审阅轮身份、L6 见证归属、L7 冲突边界、L11 记忆附册）。
- 待 Codex 审：§3.4 的状态机/fold、§5.5 的 131072 两格、§5.7 的 C 行对齐、§11 的 B 列表。
- 本稿没有改代码、没有跑测试、没有提交。

### 第二稿（2026-11-01，收口）

- **L2 改裁定为 L2-c**：执行结果审阅是平台发给审阅线（duty `reviewer`）的系统轮/Query，只读，不领取 Task、不开 Run、不占执行者名额；`execreview:` 前缀，`send_system_round`/`record_review` 两个 step；不改 `RunPurpose`、不复活 `ReviewWork`、不加派发端口。
- **Codex 21 条落点**：S9-01、S9-02 作废（不再有审阅 Run/领取）；S9-03/S9-04/S9-05/S9-06–S9-21 的落点见 §3.2–§3.7、§5.5、§6.2–§6.3、§8.3–§8.4、§11。没有一条只改文字：每条都指到具体节或测试行。
- **新增 5 个待 lead 定的问题**：L13（同名工具分派 schema）、L14（`planningAnswerShapeOf` 改 PL-1 正本）、L15（`outputTokens` 128000 上限）、L16（无审阅线口径统一）、L17（`goal-machine` 附注失真）；见 §10.1，第三稿已由裁定关掉。
- **偏差表**：删 D-0（基线就是 `7570e87` 的内容，副本提交号不同）；按 L2-c 改写 D-3/D-4/D-5；新增 D-16（`outputTokens` 上限）、D-17（Evidence actor system 臂）、D-18（无审阅线口径）、D-19（同名工具 strict schema）、D-20（`goal-machine` 附注）；见 §10.3。
- **规格新定**：N2 换 L2-c；补 N3–N10（系统轮/`exec_review`/包头、`answerShape` 与同名工具、两个 step、Evidence actor、`no_review_line`、一次入账/finalize 指纹、L10 门槛、131072 探针）；旧 N3–N6 顺延为 N11–N14；见 §10.4。
- **行数**：v1 890 行 → v2 1,192 行（+302）；§12 按 L2-c 重估为生产 480–1,020、测试 2,300–3,700。
- 本稿只改 `out/slice-9-SPEC.v2.md` 与 `.dsh-scratch/parts/s9-map.md`；没有改代码/测试，没有提交，没有跑测试。

### 第三稿（2026-11-01，按 lead 五条裁定）

- **L13 新工具名 `submit_exec_review`**：exec 审阅不再与 plan review 同名。plan 仍 `submit_plan_review`；只共用接受/屏障/`acceptedAnswerCallIds`/观察器/`QueryJobAnswer` 存储/回执幂等，schema、正文、解析各写各的；D-19 改写。落点：§0.2、§2 文件表、§3.2③/⑥、§3.3、§3.4 C、§3.6、§3.7 R10a、§7 接口表、§10.1 L13、§10.3 D-19、§10.4 N4、§11 A。
- **L14 直接改 `planningAnswerShapeOf` 正本**：本片施工时加 `roundKind`/`exec_review` 一臂，不加薄包装；这一臂和形状类型/校验都由本片改，按 S92-07 一起扩 `exec_review`（见 §3.3），PL-1 不动。落点：§3.2⑤、§9.2、§10.1 L14。
- **L15 不放宽 128000**：A 格写 `outputTokens: null`（默认值），B 格 64000；报告标“null = 不设上限”；规划轮输出预留不受影响。落点：§5.5、§8.3 A1、§10.1 L15、§10.3 D-16、§10.4 N10。
- **L16 无审阅线通知**：保留 open 轮、等待 `no_review_line`、线建好后同轮续、不转卡；由 PL-1 的 `plan_notice` 投影源加 `exec-review-no-line:<goalId>:<roundId>` 只读分支，写明 Task/没有线/`role-lines/open` 开线后自动继续；条件成立期间固定 `itemKey`/`position`（`position` 取检查终态提交游标），解除后不再产项；`role-lines/open` 是 7D2 依赖、本片不扩入口；不写记录；新增测试 R11。落点：§3.2④、§3.5、§3.7 R11、§7、§8.3、§8.5、§9.1、§9.2、§10.1 L16、§10.3 D-18、§10.4 N7。
- **L17 改旧附注并同步老测试**：`goal-machine.ts:492-495` 改成“只作提示，不是硬闸”，同步 `tests/state/goal-machine.test.ts:528-544`；§8.4 台账从 1 行增到 2 行。落点：§3.4 H、§3.7 老行、§8.4、§9.3、§10.1 L17、§10.3 D-20。
- 本稿只改 `out/slice-9-SPEC.v3.md` 与 `s9-spec-reply3.md`；没有改代码/测试，没有提交，没有跑测试。

### 第五稿（2026-11-01，按 lead 对快速核对的 3 条裁定）

- **S9Q-01 等待改在选择阶段判**：`continueRoundChain` 在返回 `send_system_round` 之前调同一个 `readReviewState`，`waiting` 交现有任务循环收集并跳过当前 Task，别的 Task 继续；发送成功后重新进入选择也走这一读，发送步里的 `rememberWaiting; continue` 全部删除。落点：§3.2①（新增选择阶段读）、②（改成 `readReviewState` 并含收件线判断）、④（发送前二次确认与发送后重选）、§3.5 等待形状/重启行/冷启动行、§3.6 步骤表。
- **S9Q-02 R10a 改真实非审阅 Query**：删“经 `record_review` 提交外来答案”和统一 `forbidden` 断言，改成脚本模型在非审阅真实 Query 内调 `submit_exec_review`，验证工具入口拒绝（`toolDenied`）且 Evidence 无新写入；同步删“不经模型”的限制。落点：§3.7 R10a、§8.1、§8.3 的 R10a/R10b 行与改动摘要、§8.3 新行表。
- **S9Q-03 R10b 前置改公开入账结果**：删测试对内部 `readRecordReviewReceipt` 的调用，直接保存公开 `recordReviewEvidence` 返回的 `evidenceRef`；`readRecordReviewReceipt` 只留在生产侧 §3.4 E。落点：§3.7 R10b、§8.3 的断言段/新行表/改动摘要。
- 本稿只改 `out/slice-9-SPEC.v5.md` 与 `s9-spec-reply5.md`；没有改代码/测试，没有提交，没有跑测试。
