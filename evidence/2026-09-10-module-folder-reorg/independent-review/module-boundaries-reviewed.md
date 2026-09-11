# 当前源码的 Module 边界

更新：2026-09-10。本文记录既有 12 Module 的实际消费边界；产品范围仍以 PRODUCT 为准，当前完成程度与证据统一见 [模块状态](../../human/module-status.md)。旧版本 Interface 与持久 schema 继续有效。**目录名即 Module**（2026-09-10 模块目录重组后）：每个 Module 恰好拥有一个目录，`src/control/control-engine/`、`src/control/control-engine/`、`src/data/workspace-reader/` 等路径前缀就是归属判据，`scripts/module-map.mjs` 的 `owner()` 只按路径前缀判定，不再依赖文件名清单或正则例外。

## Module 目录（12 Module，一 Module 一目录）

| Module | 目录 | 目录内文件数 |
| --- | --- | --- |
| ControlEngine | `src/control/control-engine/` | 65 |
| PlanCompiler | `src/control/control-engine/` | 3 |
| DispatchEngine | `src/control/control-engine/` | 10 |
| VerificationEngine | `src/control/control-engine/` | 20 |
| ArchitectureReconciler | `src/control/control-engine/` | 3 |
| HumanCollaboration | `src/interaction/human-collaboration/` | 4 |
| WorkerRuntime | `src/execution/worker-runtime/` | 15 |
| StateLedger | `src/data/workspace-reader/` | 6 |
| ArtifactVault | `src/data/workspace-reader/` | 6 |
| ReadModelIndex | `src/data/workspace-reader/` | 8 |
| ContextCompiler | `src/data/workspace-reader/` | 24 |
| WorkspaceReader | `src/data/workspace-reader/` | 16 |

内存与 SQLite 适配器同属其 owning Module 目录：`state-ledger/{in-memory-ledger,sqlite-ledger}.ts`、`read-model-index/{read-model-index,sqlite-read-model-index}.ts`、`artifact-vault/{artifact-vault,sqlite-artifact-vault}.ts`。ControlEngine 的 `policies/`、`records/` 子目录保留原名。`src/contracts/`、`src/harness/`、`src/app/`、`src/ui/`、`src/storage/` 不在 Module 目录内：contracts 是共享接口面，harness/app 是组合根（`owner()` 记为 Host），storage 是共享工具。归属断言见 `tests/contracts/module-ownership.test.ts`。

## 入口与隐藏职责

下表路径相对于产品根。精确 TypeScript 字段以所列 contracts 为准；这里说明谁拥有行为、谁能推进正式状态。

| Module | 实际接口与主要消费者 | 应隐藏的实现 |
| --- | --- | --- |
| HumanCollaboration | `modules.ts` 的目标/决定入口；`exploration-session.ts` 的 ExplorationSessionPort；宿主/UI 调用 | 人输入校验、请求/审阅 journal、重放、展示路由。探索计划交 OperatorPlanningPort，报告资格交 Verification，取材交 Context；不分析 trace 或归约 Goal |
| PlanCompiler | `planning.ts` 的 request/accept；`operator-planning.ts` 的人工计划入口；HumanCollaboration 与宿主消费 | 初始协调请求、结果处理、修订提案、人工图校验及 pending plan journal。PlanCompilerImpl 是统一自动规划入口；OperatorPlanCompiler 明确保留人工来源。正式接纳仍由 Control 决定 |
| ControlEngine | `modules.ts` 与各命令 contracts；规划、派发、验证、协作消费 | canonical guard、来源/CAS/权限复核、幂等、Task/Goal/lease/变更政策、snapshot/event 构造。实现分在 `src/control/control-engine/policies`、`src/control/control-engine/records` 与命令处理器；只读政策解释另见下文 |
| DispatchEngine | `ports.ts` drive；`runtime-dispatch.ts` 恢复；`operator-dispatch.ts` 人工运行；宿主与协作消费 | outbox 执行、准备与 claim 的顺序、租约、来源授权、运行事件/失败对账、未知副作用处理。planned-task-dispatch 消费已接受 assignments；operator-task-dispatch 消费人明确请求 |
| VerificationEngine | `verification.ts`、`verification-service.ts`、`exploration-session.ts` 的报告核验端口；宿主/协作消费 | 检查生命周期、候选/证据受理编排、真实命令执行与 journal 恢复、显式中断对账、报告读取、探索 trace 资格。只把有来源的结果交 Control，不直接完成 Task |
| ArchitectureReconciler | `architecture-reconciler.ts` inspect、`baseline-evolution.ts` materialize；harness 提供 | 源图差异、Finding 分类、报告持久化、逐步消费正式回执、候选物化。取材与来源版本比较交 ArchitectureContext/BaselineEvolutionContext |
| WorkerRuntime | `ports.ts` RunPort、`runtime-preparation.ts`、查询/能力/公开快照 contracts；Dispatch 消费 | 一次实际内核运行、取消、工具观察、事件和不可变输入、公开运行记录。观察不是正式完成；编排/计划/状态归约不在 Runtime |
| StateLedger | `ledger.ts` load/commit/events；Control、Context、投影、Dispatch 消费 | 原子提交、CAS、幂等、完整性校验、事件/outbox 保存与重开。`src/data/state-ledger/governance-records.ts` 是只读记录解析：精确 ref/revision/digest，不能更改治理状态 |
| ArtifactVault | `artifact.ts` put/open 及 material-access；各授权消费者使用 | 正文/来源/owner 持久化、摘要校验、权限与撤销/适用性复核。产物文字不等于正式证据或新授权 |
| ReadModelIndex | `goal-view.ts` 与各 view contracts；UI/Context 消费 | 按已提交事件投影、cursor、scope、重建、查询布局。InitialPlanningView 提供规划视图；canonical目录另由 StateLedger 的 ScopeCatalogPort 提供；政策解释用注入端口，不复制 Control 算法 |
| ContextCompiler | Task/Work/Review/Planning/Query/Verification/Architecture/Exploration Context contracts；角色工作消费者使用 | 找到当前 scope/version 的事实、契约、公开观察和产物，组装材料、检查来源/权限/大小，返回缺口/拒绝。不得启动模型、写正式状态或裁决任务完成 |
| WorkspaceReader | `architecture-source.ts` 的 ArchitectureSourceCapturePort、来源工具与 applicability；Context/Runtime 使用 | 路径边界、完整来源 pin、索引/工具适配、语言能力差异、来源更新判断；只返回来源快照，不查Ledger或保存Vault。旧 workspace-read.ts 的绑定图返回形状由Context适配 |

**不属于上表 12 Module 的随产品发布代码**（B-2/A-4，2026-09-10 登记）：下表所有者由 `scripts/module-map.mjs` 记录，只为文件归属服务，**不构成 Module、不产生上表的依赖边**。

| 所有者 | 文件 | 性质与消费者 |
| --- | --- | --- |
| Storage | `src/storage/atomic-file.ts` | 跨 Module 的原子替换工具，不承载业务语义、不持 canonical 状态、不查 Ledger。调用方：`src/control/plan-compiler/operator-plan-compiler.ts`、`src/interaction/human-collaboration/exploration-session.ts`、`src/data/artifact-vault/runtime-observation-journal.ts`、`src/control/verification-engine/verification-journal.ts` |
| UI（legacy，host-only） | `src/app/public/**`（12 个手写 `.js` + 静态资源） | 上一版前端，仅经 `server.ts` 的 `/legacy` 与 asset 白名单提供；React workbench 是默认入口。它不是 Module，也不参与 12 Module 的职责划分 |
| WorkerRuntime（owner-only） | `src/execution/worker-runtime/terminal-sandbox.py` | 随产品发布的终端沙箱入口，由 `app/workspace-tools.ts` 使用。仅登记归属，其路径包含/Landlock 语义**未**被边界检查器验证 |

## 持久与失败约束

命令构造位于 `contracts/commands`：scope、actor、时间、权限、预算和幂等键由调用者显式传入；测试 fixtures 只提供样例与测试默认值。生产 fold 属 Control，契约总出口不导出 fixtures/testing。现有请求、Run、plan/report/review journal 的身份不因目录迁移而改变；需要保留的旧 actor/键已在调用者中显式写出。历史 JSON 与 Evidence 不批量重写。

PlanCompiler request 通过 Control 保存 QueryJob；accept 读取精确回答及当前材料、提交提案并检查回执。Control 的 `policies/initial-plan-admission.ts` 负责把模型公开结果确定性规范化并验证可受理形状；PlanCompiler 和来源 guard 共享它，Control 不调用 PlanCompiler 的协调器。人工计划保留 `planOrigin: operator`，不能声称模型自动规划。

Dispatch 的 RuntimePreparationPort 只保存/观察运行输入。RuntimeDispatch.recover 仅处理完整 Project/Workspace 匹配的记录，按 canonical revision 接受尚未提交的事件；拒绝即停止该运行后续事件。已开始且无法证明完成的记录转待对账，不重新执行模型或工具。OperatorTaskDispatch 与 PlannedTaskDispatch 最终都通过 Control claim 和持久 outbox 才能启动运行；服务关闭等待已派发工作保存。

VerificationService 持有命令检查记录的生命周期；宿主只读取 `checkReportMaterials`，不解释内部 progress 字段。中断执行默认不自动重放命令，必须显式对账已存观察。RecordedVerificationPort 将既有真实检查/操作者审阅转正式 Evidence 请求，Control 复核当前版本。ExplorationReportPort 只接受完成且正式匹配的只读运行、最终助手报告与成功的真实 read 轨迹。

通用工具轮次的字段唯一来源是 `contracts/verification-round.ts` 和 `verification-context.ts`。VerificationService 的 startRound/round/resumeRound 及带显式 round 参数的 VerificationPort 使用同一持久流程；配置明确列出 checkId、static/dynamic、命令、相对 cwd、单次超时和 workspace/task 适用范围。同类型的全部适用检查各执行一次，覆盖关系独立保存；缺配置 incomplete，坏配置 rejected。同请求不重新执行，配置改变不得重绑旧轮次。UI 只呈现服务返回的检查、来源资格、缺项、原始报告与正式接纳/归约回执。

Context.resolveRound 负责读取 canonical Run/Task/Plan/Goal/Workspace、精确治理 pin 和实际源码，来源 I/O 前后重读身份。Verification 保存完整身份，每项执行、恢复、原报告读取及 Evidence 使用时复核。WorkspaceReader 提供 Candidate 原摘要及当前 HEAD 比较说明；HEAD 到当前工作树可以有已知文件表，但没有 Run 前态时 Run 前后变化范围仍未知，不能采信 caller 的无变化声明或借空文件表快放。

Verification 的轮次编排复用 CommandCheckLifecycle/Provider/Journal，不另建执行器或租约状态机。原始检查报告先入 Vault，未知效果停止后续检查并保留待对账；只有显式 resume 能继续尚未执行的项。每条 required VR 所覆盖的全部适用工具结果聚合为 FAIL 优先、其次 INCONCLUSIVE、全部 PASS 才 PASS，正文绑定完整原报告集，再通过稳定身份交 Control 接纳。无对应 VR 的额外适用工具失败仍影响轮次结论，不增造 Evidence 覆盖。托管子检查禁止从旧单项接口单独接纳，以免后项 PASS 覆盖同一 VR 的 FAIL。独立 Reviewer 未实现时保持缺项，ready/轮次结束不表示 Task 满足。

新普通人工计划包含 required dynamic 与 reviewer，旧已受理 Plan 保持原义务。旧单命令记录带 root/name/bindingDigest 等挂载字段时，只按原字段精确复算指纹并核对原命令/种类/超时，保留原文件身份；不批量重写历史。其他旧候选/探索入口的请求身份格式不随本轮改变。轮次 source stale 只表示当前读取/操作资格；Control 现有 Evidence applicability 仍按 canonical revision tuple，裸文件变更不自动撤销已接纳事实。独立Reviewer由下文VR-02接续；完整语义规划资格、返工及正式版本自动失效继续是后续义务。

探索的 plan journal 归 PlanCompiler，report/review journal 归 HumanCollaboration；正文资格与存储交 Verification/Vault，来源与正式前驱适用性交 Context。恢复 Goal 前沿由 Control 的 ExplorationStartupReconciler 生成正常归约命令，不修改历史记录或用运行完成代替工作满足。

## 只读解释和观察的边界

工作区能力受理由 Control 的 ConfiguredWorkspaceCapabilityPolicy 负责：构造时取得宿主显式配置的运行支持事实或 null，计算支持能力与当前 envelope.permissions 的交集。它不回调活 Runtime；WorkspaceCapabilityPort 保留既有异步返回形状，实际 owner 明确为 Control admission。source=runtime 表示支持声明的来源，不能表示运行已执行。缺配置返回 unsupported；实际沙箱/内核启动仍由 Runtime 预检与报告，不把环境检查塞进 Control。

`policy-explanation.ts` 的 PolicyExplanationPort 由 ControlPolicyExplanation 实现。ReadModel 传入投影材料，得到证据适用性/有效集合以及计划变更解释；该能力无 I/O、无 commit、不能授权执行。两种 ReadModel 由 harness 注入同一实现，解释结果不改投影 reduction/cursor。它是显式 ReadModel→Control 依赖，不能因使用依赖注入而从架构图中省略。

公开 Runtime 观察经有界材料接口交 Context，只有 spec/status/events/公开工具轨迹等已暴露信息，没有隐藏推理。读取观察不具有执行权限；Control 仍以自己的 canonical Run 和 plan/workspace 锚点复核。模型运行、Context 编译、事件投影分工不同，不能把一次公开快照读取当成 Task 满足的证明。

原生源码与绑定材料分开：ProjectArchitectureSourceReader只捕获原生图；SourceGraphContextCompiler校验reader Run、Plan pin与Workspace版本，将图保存Vault，并保留旧WorkspaceReadPort的返回形状供现有调用者消费。兼容的是wire形状，canonical取材/正文编译归Context，不能再把完整SourceGraphContext归到WorkspaceReader。Vault的material-access-policy拥有授权适用性解析，依赖StateLedger、ReadModel候选发现和WorkspaceReader来源校验；WorkspaceReader不反向调用Vault。

MigrationGatePort当前完成来源guards后返回unsupported；版本相等只证明来源适用，不能生成PASS或凭空构造Evidence。接入真实迁移检查/已登记Evidence仍是后续核心功能义务，旧身份helper不构成真实验证能力。

## 组合根、样例与检查

`app/service.ts` 与 `harness/*` 是组合根，不是第十三个 Module。服务解析 HTTP 范围、绑定适配器、串行化宿主操作与关闭资源；应通过上表接口提交工作。明确命名的 Fake Adapter 和样例场景继续用于合同/演示测试，真实执行路径不能在缺能力时悄悄退回假结果。

产品 `scripts/module-map.mjs` 记录源文件所有者，`scripts/check-module-boundaries.mjs` 扫描 imports/exports，拒绝 contracts 反向引用实现、未批准生产 fixture 依赖、Module 反向依赖宿主和未登记源码。

**检查器的实际覆盖与排除范围**（A-4，2026-09-10 核正）：当前覆盖 `src/**` 下 `.ts`/`.tsx`/`.js`（解析 import/export 边并分配 owner）与 `.py`（**仅**分配 owner，不解析边）。模块目录重组后实测 **366 个源文件（365 解析 + 1 仅归属）、0 issues**。历史快照见 `evidence/2026-09-10-external-review-repair/module-boundaries-targeted.json`（重组前 361/360+1）；重组的 before/after 清单与路径映射见 `evidence/2026-09-10-module-folder-reorg/`。排除依赖目录、构建产物（`dist`）与 `.vite` 缓存；未登记的 `.ts/.tsx/.js` 文件会报 issue，`Unmapped` 也会报 issue。

这**只是文件归属与 import/export 的机械结构证据**，不是沙箱验证：它不检查 `terminal-sandbox.py` 的路径包含或 Landlock 语义等价性，不检查 `.py`/`.js` 的运行期行为，也不代替 DI 的语义归属、历史兼容、重复政策和真实路径复核。**不得**把"边界检查通过"宣称为完整沙箱验证或整体完成。

新功能先定位 Module 和直接 Interface，在该 Module 内完成实现与真实消费者接线；变更公开字段、失败语义、来源、恢复或依赖时同步本契约及对应 Module。开发 Agent 的上下文只需本表、当前 Ticket、直接一跳 Interface 和版本化交接，不要求继承全部历史对话。

## 独立 Reviewer 消费者（VR-02）

本票已在原12 Module/34边内接入并按[VR-02验收](../verification/2026-09-09-independent-review/acceptance.md)完成限定范围，全仓、浏览器、源码身份及独立审计均已确认。准确入口、版本与历史读取边界见[独立审阅Interface](independent-review.md)。Verification拥有审阅请求journal、材料/报告资格与恢复；Control拥有正式ReviewWork/Result/TaskReviewProtocol与原子Evidence，Dispatch拥有独立运行/授权/最终回答绑定；Context提供固定配置和当前有界材料，Runtime复用原内核只读执行，WorkspaceReader提供与pin相同覆盖的源码读取。宿主仅组合、解析HTTP与排空后台工作，UI消费真实状态及原报告。两套ReadModel共用Reviewer资格解释，保留投影而不提交命令。旧工具轮次上文的“未实现Reviewer”描述其VR-01范围；返工、自动来源推进及已接纳Evidence的一般来源失效仍不在VR-02。
