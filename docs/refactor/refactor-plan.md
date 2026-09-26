# 可执行迁移批次计划

> **最新子集验收（2026-09-25）：** [A1 正式目录与 Session 图关联](reviews/next-a1-graph-session-2026-09-25.md)已通过独立副本 75 文件 / 719 项：initial catalog、Module/Task 关联开闭、目标索引发现、归档/重新启用及真实 SQLite/Kernel 重启。前序 [R4c.2b/.2c 图历史与 Source 组件](reviews/next-r4c-history-and-source-2026-09-25.md)的 620 项为历史基线，原语继续复用。后续按[实施方案 §0](IMPLEMENTATION-PLAN.md)完整 A/B/C/D 路径推进：B 装配/进入/观察归约/释放，C 沿图咨询与 Skill 编排，D 控制恢复/重组；不能缩成一次 entry。Query、R3/R4 余项及 R5/R6 未完成。

更新：2026-09-25。阶段主线仍为 [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) 的 R0–R6。主 Agent 负责架构、接口和两次独立审核，DSH 4.1F 先交骨架/测试，审核冻结后才实现；本页细化施工，不另起模块方案。

> **当前先读[独立目标工程迁移与验收](reviews/next-completed-migration-2026-09-24.md)。** `coding-platform/next` 已真实建立，后续 R2–R6 默认在该工程实施，原 `coding-platform/src` 只读参考。Workspace/Goal/material/body/Store 已迁入；五目录均存在，AgentRuntime 已补迁工具循环/来源绑定组件，本批Session创建/历史入口已接通，正式Workflow/Runtime执行入口仍unsupported，UI未迁。R3c reader/index 子项已通过独立验收（250 项目标测试，见迁移报告），不将整个 R3c 记为 PASS；完整目标契约尚未全部成为运行实现。

**路径与切换约定：** 下文“旧入口”属于原 C/src，只用于行为和实现对照；目标 `src/`、`core/`、`business/`、Host/UI 路径均相对 `C/next`。新实现不要求接回旧系统，旧产品消费者直到新 Workflow/UI 切换前继续使用旧产品，旧目录在最终切换后删除。各节历史通过结果只覆盖原工程版本，不能充当 next 完成证明。

## 1. 基线与执行方式

- Prompt 5 已有 [source-analysis](../history/before-2026-09-22/refactor/source-analysis.md)，直接作为已有调查；仅核对本批真实入口与后续 R1 变化。
- R0/R0b 设计已落盘，原工程 R1 局部优化已完成；next 已迁入基础实现，完整目标 Port、Workflow/Runtime 和 UI 仍须逐批实现与验收。
- 工作区是 `/home/hyh001/projects/coding-platform`；代码 Git 仓为其 `coding-platform/`，当前实现/检查根是 `coding-platform/next`，运行入口 [next/package.json](../../package.json)。Node24 和 pnpm 使用已有 `.toolchain/`，不重装依赖。
- 用户已有 AGENTS、集成测试、工作目录辅助文件及 R1 修改已保存本轮前置快照。不得 reset/restore/clean/stash、不得自动提交或 push。
- 每批按Astra架构/接口 → DSH骨架/测试 → Astra审核冻结 → DSH实现 → Astra审阅 → 隔离测试实施。骨架/测试交付后停止，审核后另起实现调用；实现阶段测试/接口只读。必要返修复用同一DSH Session，真实依赖通过后接入下一批。
- 子批可修改 next 内批准的跨模块消费者，不扩展旧 C/src，也不顺带实现后续能力；目标图、实际 import 与注入依赖分别核对。next 内无消费者的适配及时删除；原工程兼容入口随最终产品切换退役。

## 1.1 P0：并行实现前的契约基线

五模块方向已定，P0按当前真实路径将所需公开子集变成提供者/消费者共用的可编译契约；范围并行、入口驱动、索引分页、游标绑定及持久身份分别在使用它们的切片前闭合，不设置全量共同门禁；见[并行审阅](PARALLEL-COLLABORATION.md)。类型/端口可以先存在，不能以假成功实现或空目录冒充能力。共享contracts、ports、codec注册、Host装配和map有明确负责人。R3a已有精确Goal子集可独立验证，不要求为Goal创建预建全部范围/Session协议。首批可执行分工及dsh指令见[并行实现任务书](tasks/DSH-PARALLEL-IMPLEMENTATION.md)。

可并行内部工作：R2e后续源码能力与R3a；R4a Kernel扩展与R3；冻结repository/material契约后的R3c任务、R3d架构、R3f消息、R3g角色；固定JSON DTO后的UI组件。生产集成分别依赖实际使用的提供者，不能用fixture代替真实路径验收。R系列前置默认指真实集成前置，并非所有内部文件必须等待上批结束才能编写。

## 2. R2：工作区与源码工具

下表保留原工程 R2 的历史实施范围、测试数字与结果。next 已补齐原 Workspace 全部 26 个实际实现文件（不迁生产 Fake adapter）、模型工具循环、源码绑定与回归；旧模型/Host 端到端接线不是新工程验收。逐项迁移状态见当前补迁报告，后续 R2e 与新 Runtime 消费者在 next 继续。

| 子批 | 真实入口与实现变化 | 接口/旧路径处置 | 完成判据与依赖 | 状态 |
| --- | --- | --- | --- | --- |
| R2a 所有权迁移 | 18 个 WorkspaceReader TS 实现及 README → `src/core/workspace/`；迁 Host、Context、Runtime、Vault 的真实消费者及测试/脚本引用 | 现有 Port/响应/算法保持；实际 owner 改 WorkspaceTools，旧目录不留转发层 | 类型、模块边界、源码/用途读取相关测试、构建输出和脚本；以 [任务书](tasks/R2a-workspace-ownership.md) 为精确范围 | 已验收；56 文件/441 测试、类型/边界/构建通过 |
| [R2b 冻结 provider](tasks/R2b-frozen-source-query.md) | ProjectSourceIndex 分离 live 捕获、冻结材料查询、当前来源核验；query 与 architectureMaterials 共同消费 | 保留现有工具 wire 与独立请求的前后核验；不先发布半个跨请求 Port | R2a 后；同一冻结输入多种查询不读磁盘；旧材料不受外部变化污染，verify 检出 stale；配置并发不串源 | 已验收；9文件/56测试、类型/边界/构建及兼容对照通过 |
| [R2c 访问与捕获注册](tasks/R2c-capture-registry.md) | 按 Workspace 骨架接 CoreCallContext、真实 Host 授权重核、CaptureRegistry、容量/期限/游标/close | 一次捕获、多页续读；SourceCaptureRef 临时，保存正文与正式引用仍由领域模块处理 | R2b 后；跨主体/跨查询游标拒绝、取消/撤权/释放/过期、页间变化保留冻结结果；不得每页走 live query | 已验收；16文件/110测试、类型/边界/构建通过；模型分页仍待R2d |
| [R2d 真实工具接线](tasks/R2d-model-source-tools.md) | 新 project_source 冻结协议与工具释放骨架→Work/explore/Reviewer→Query 三个串行子批；既有精确摘录和单文件能力继续复用现有核心 | 正式模型清单退出 project_index，显式兼容 wire 保留原语义；普通读取不造 Run/LLM | R2c 后；四类真实工具路径通过，完整三页不重复取材/分析，来源当前性检查单独计数 | R2d.1/2/3均已独立验收；精确证据见逐批记录 |
| [R2e Git 与语言覆盖收口](reviews/workspace-remaining-capabilities.md) | 固定 argv 的 Git 版本读取/差分；按现有 provider 支持接 Python/C++/文本路径 | 旧 HEAD 身份保留；不执行仓库脚本，不伪造 AST/完整调用图 | 相关功能的范围/历史/容量/不支持/来源测试；缺引擎如实返回 | R2e.1已通过[独立验收](reviews/R2e-1-sol-dsh-acceptance.md)，18项+56项相关回归；其余子批待细化并分派 |

R2b–R2e 的完整主要接口以 [WorkspaceTools](modules/core/workspace.md) 和 [共同契约](skeleton/CONTRACTS.md) 为准。具体子批的 Host 接线和权限来源在其派发前写入任务书，不要求 dsh 临场猜核心语义。

## 3. R3–R6 可执行子批

以下为 next 的能力分批与验收要求，旧入口只读参考；历史验收数字和结论不改写。原工程 R3a/R4a 代码已落盘，首轮失败后已完成 Sol / dsh 返修并通过[独立验收](reviews/R3a-R4a-sol-dsh-acceptance.md)；其余子批仍按实际状态推进。子批按真实依赖实施，不以编号强制全局串行；接口基线和文件所有者冻结后，内部实现可并行，真实接线等待所需实现验收。具体见[并行开发图](PARALLEL-COLLABORATION.md)。R3 在 next 按领域操作逐步实现；未迁的旧 validator 和消费者仍留原产品，记录最终切换批次，不把它们注入新核心。R4a 可以独立于 R3 实现，但平台 Session 连续执行必须等其真实 Kernel 验收通过；平台连续Session与范围并行尚未交付。

R2e首个已细化子批：[R2e.1严格文本、精确文件读取与同范围比较](tasks/R2e-1-text-read-compare.md)，实现已通过[独立验收](reviews/R2e-1-sol-dsh-acceptance.md)。只复用同一registry和R2d真实工具入口，Git/非TS语义及GUI Host迁移仍是后续子批。

### 3.1 R3：正式结构、领域操作与物理存储

#### R3a — 一个正式 Goal 提交贯穿 RecordStore 与 WorkGraph

原工程历史骨架与验收见[任务书](tasks/R3a-goal-record-store.md)、[并行任务](tasks/DSH-PARALLEL-IMPLEMENTATION.md)及[独立验收](reviews/R3a-R4a-sol-dsh-acceptance.md)：当时 Goal 真链、guard、输入隔离、raw batch 与旧库重放已通过。next 已迁入 Goal/Store 子集，当前以新工程报告核对装配；以下行为与数据兼容要求继续适用。

**前置：** 本批所需公共 identity/call-context/results 最小定义；不先生成所有未来类型。R2 已有的装配约定保持兼容。

**旧入口：** `app/service.ts → HumanCollaborationImpl.createGoal → ControlEngine` 的既有 Goal 创建命令；`data/state-ledger` 的 `SqliteStateLedger`、`InMemoryLedger`、事件/幂等/identity_claims 事务。实施前精确核对 createGoal 实际 commit kind 及所有 validator 隐含读集。

**本批目标：** 将该 kind 编译和领域规则落入 `core/work-graph/tasks/task-service.ts`、`persistence/{commit-compiler,graph-repository,record-codecs}.ts`；通用事务机制落入 `core/record-store/{sqlite-record-store,in-memory-record-store,migrations}.ts`。next 的 N0/Workflow 创建目标入口直接调用该实现；不接回旧 Host，也不把未迁 kind 的旧业务代理搬入新 Store。保留必要 Goal 身份、事件与回执语义，不增加第二个活动目标记录。

**已核对的兼容约束：** 新 `createGoal` 输入显式保留 `goalId`，不能从 `GraphWrite.meta.requestId` 派生。原命令的目标 ID 与幂等键可以不同，GUI 恰好使用相同值不构成全局约束。当前 `goal-create` 的正式读集是 Project/Workspace revision 与 Goal 不存在的 CAS，不涉及 identity claims 或订阅范围；不要为此小批预建未被使用的范围索引。物理旧表将版本保存在 snapshot JSON 内，新增 codec/元数据必须兼容原键和数据。

**删除条件：** next 的 Goal 提交只走新规则，Store 与 WG 不重复领域判断。原 validator 随旧产品最终切换退役；本子批不扩展或逐分支修改原 C/src，也不宣称整个 StateLedger 已退役。

**验证：** 同身份同内容重放、不同内容冲突、旧 expected 不阻止合法幂等重放、并发创建、写中异常回滚、关闭重开读回。复用 `tests/sqlite-ledger/sqlite-ledger.contract.test.ts` 与 `tests/contract-suite/state-ledger.contract.suite.ts`；旧数据 fixture 必须来自原 schema writer。

#### R3b — 材料正文与普通 Host 读取贯通

**2026-09-24 状态：** 原工程材料功能、History Host 与 Run/Query 链通过[历史验收](reviews/R3b-sol-dsh-acceptance.md)，当时两条 legacy reader 边未收口。next 已迁入正文/材料实现，reader/index 子项已通过独立验收；旧 Host 接线不能当作 next 已有 UI。原消费者见[历史退出清单](reviews/R3b-material-consumer-inventory.md)，最终随新产品切换退出。

**前置：** R3a 的物理工厂及可信 Host context；R2 文件/来源验证工具。

**旧入口：** `data/artifact-vault` 的 `SqliteArtifactVault`、`material-access-policy.ts::createMaterialAccessResolver`；`data/context-compiler` 中供 console/人工查看、精确事实引用使用的普通材料读消费者。先列出全部普通读消费者，与模型输入准备消费者分开。

**本批目标：** 正文 digest、putIfAbsent、损坏检查迁 `record-store/sqlite-body-store.ts`；访问范围、exact grant/currentBasis 与来源适用性迁 `work-graph/materials/{material-service,applicability}.ts`。在 next 建立目标 Host 材料读取与真实 Run 材料读取路径，分别验收；不为此修改或重新接回原 Host。普通读以可信 `MaterialReader` 直接读取，不造 Run；真实 QueryRun/Run 保持各自授予范围。正文保存与正式引用是两步：正文先成功，正式提交失败允许未引用正文，不能声称跨库原子提交。

**删除条件：** next 入口直接消费目标材料 Port，不保留旧 Vault 业务代理；原产品 Vault 在最终消费者切换后删除。必要旧 ArtifactRef、首次 owner/来源的可读性独立验证；没有证明无引用的正文不自动清理。

**验证：** 原 owner 竞争、跨主体拒绝、Host 无 Run 精确读取、旧 legacy 来源读取、新写拒绝伪造 legacy、正文损坏、正式提交失败不留下“成功但正文缺失”的引用。复用 `tests/vault/{artifact-vault,sqlite-artifact-concurrency}.test.ts`。

原工程 R3b 曾借用 Ledger.load 与 ReadModelIndex.materialAccessCandidates，见[历史迁移图](module-dag.md)。next 不沿用这两条旧模块注入边：R3c 先由目标 Store 的 lookup/read 提供机械读取，WG 重核正式事实；当前 reader/index 子项已验收（目标 250 项测试 PASS）。

#### R3c — 计划受理、任务资格与任务读模型共用规则

**当前已交付子集：** next Store lookup/index、材料canonical reader、初始Plan采用、正式任务事实查询已验收；[关系与精确输入](reviews/next-r3c-relations-2026-09-24.md)补齐Plan正文v1/v2兼容、提示关系、按需readTaskInput和候选纠偏。后续仍有授权delta变更及正式领取/归约，不将整个R3c标完成。

**前置：** R3a/b；保持当前公开 Plan/Task 状态和不可变 PlanRevision，不借目录迁移改状态协议。

**旧入口：** `control/plan-compiler` 的初始/变更计划接受路径；`control/control-engine/task-eligibility.ts`、计划相关受理及 task/goal reducer；`data/read-model-index` 的任务投影和现有任务面板查询。

**本批目标：** `work-graph/tasks/{task-service,eligibility,task-index,completion}.ts`、`persistence` 承接 `proposePlan/applyPlanChange/queryTaskGraph/queryReadyTasks`。提案统一外形适配旧引用，只有一个活动 Plan 指针；邻接保存关系与提示，不能用前驱整项完成替代精确输入可用性；候选与读取分别解释。查询与提交复用任务自身状态判据，领取仍核对实际身份、占用和版本。显示投影物理分页/水位迁 RecordStore，正式领取不能信任滞后显示投影。

**兼容与删除：** next 的 claim/start 与 Session 接线留到 R4c，消费新共同资格规则；原产品旧入口保持只读参考，不为其补回调新核心的适配。任务 UI 的旧查询 DTO 可适配新读模型；所有对应读消费者切换后删除旧任务 reducer/全表重复查找副本。不可变 Plan 中的 phase 与投影列兼容保留，执行变化不回写 Plan。

**验证：** 初始/变更计划、旧显式消费DAG合法性、允许白板提示成环、独立任务并行、旧运行项的计划变更规则、需求改变后旧证据适用性、投影分页水位/失败重放、索引与正式任务关系对账。增加范围成员后原 range guard 必须冲突；记录资格查询实际扫描/查找次数。

#### R3d — 架构捕获、差异与正式结构更新

**next 已验收子集（2026-09-24）：** 持久observed捕获/历史读取、邻域/比较/反向影响、真实环与精确CAS已接通；真实TS索引JSON成员有来源证据，重启/撤权/重复请求已验收。正式catalog/baseline与decision/gate尚未实现，不能关闭整个R3d。见[本批报告](reviews/next-r3d-r3g-2026-09-24.md)。

**前置：** R2 冻结捕获及 R3a/b 的不可变正文和正式提交。

**旧入口：** `control/architecture-reconciler`、`control/control-engine/{architecture-inspection,baseline-evolution}.ts`、既有架构报告/采用入口及 ReadModel 架构查询。

**本批目标：** `work-graph/architecture/{architecture-service,graph-index,architecture-delta}.ts` 调用 WorkspaceTools 捕获/比较/verify，保存 PersistedSourceCaptureRef，再形成 observed 结构；正式 baseline/catalog 仅通过 `applyArchitectureChange` 的原 finding/candidate/decision/gate 链接受。在 next 实现架构报告及正式采用的核心规则，业务提示与顺序由 R5a 的目标 Workflow 接入；原应用流程只读参考。

**删除条件：** 报告、机械检查与正式更新全部消费共同结构后删除旧 Reconciler 算法和重叠投影；保留原治理引用与缺失 catalog 的历史读取，不能从文件夹推测历史职责。

**验证：** 无 baseline、观测/正式差异、旧记录 catalog=null、unresolved、来源捕获中途变化、正式接受前版本变化、旧 gate 链拒绝、重复受理和历史版本查询。已知文件/精确图查询不创建 Run。R1 的一次分析收益不得回退。

#### R3e — 正式证据、检查轮次与完成归约

**前置：** R3a–d；保留现有检查执行器与 Reviewer 入口，先迁规则和持久关联。

**旧入口：** `control/verification-engine/verification-rounds.ts::VerificationRounds`、VerificationJournal、`control/control-engine/{task-reducer,goal-reducer}.ts` 和 submitEvidence 路径。

**本批目标：** `work-graph/evidence/{evidence-service,coverage}.ts` 与 tasks/completion 承接 `openVerification/recordCheckResult/submitEvidence/finalizeChecks/completeTask/completeGoal` 的正式规则。轮次配置、fingerprint、各 check 的来源和命令身份固定；目标 RoundSnapshot 显式增加 codec/schema，旧轮次 journal 可读，迁移标记防止双录。next 的真实检查结果经目标入口入账，由目标 Workflow 消费；旧业务流程不反向接入。

**删除条件：** next 对应领域规则和 journal 新写者只保留一份；实际命令执行、调度和返工由目标 R4/R5 承接，不提前搬入 WG。旧产品原入口继续运行到最终切换后退役，不反向接新核心。`finalizeChecks` 不偷偷完成 Task，角色建议产物不升级成门禁。

**验证：** PASS、missing、stale、interrupted、独立审查要求、重复结果、错误 Run/Task/Plan/source 绑定拒绝、配置变化、旧 journal 重启读取。Run.completed 不等于 Task.satisfied；两项通过一项缺失不能完成。

#### R3f — 消息、阅读确认、等待与历史查询

**前置：** R3a/b/c 的正式事务、材料与 Work/Run 查询；本批不增加永久 Agent 身份。

**旧入口：** `control/control-engine/coordination/{directed-request-operations,participation-operations,waiting-successor-operations,mailbox-view}.ts`，真实工具发送/回复与通信面板查询。

**本批目标：** `work-graph/communication/{mailbox-service,routing-rules}.ts`、材料历史索引和 Store 分页；切换发送→正文引用→请求/投递意图提交→阅读/回复的真实路径。Delivery 原记录不可变，新增 MessageAckRecord；读不等于已读，ack 不等于 respond。普通收件箱改为有水位的增量查询，原事件重建仅作回放/核对。

**兼容与删除：** 等待/换手规则可先迁，但**新 Session 感知的唯一后继受理要在 R4c/R5c 加入相同事务占用后才能启用**。原产品保持原受理路径；next 尚未支持的受理明确拒绝，不调用旧业务兜底或冒充新独占。所有消息消费者切換后删除旧全事件扫描与重复路由；工作消息仍要求真实工作 Run，不借 Query/Host 伪造身份。

**验证：** 重复发送/回复、正文失败、跨范围拒绝、阅读/ack/响应区别、换手后的当前参与者、等待超时/取消与唯一后继、历史分页水位。通信环不能被误作任务前置环。

#### R3g — 角色/记忆规则收口与 R3 退出清单

**next 已验收子集（2026-09-24）：** RoleSpec安装/激活/历史pin读取/正式矩阵解析已接入组合根；resolved仅证明规格相容。协调策略生产安装、记忆操作及UI/执行消费者尚待后续，不把测试种入的治理事实当生产bootstrap。见[本批报告](reviews/next-r3d-r3g-2026-09-24.md)。

**前置：** R3a/b，相关旧配置入口清单。

**旧入口：** `control/control-engine/role-spec.ts::RoleSpecEngineImpl`、`memory.ts::MemoryControlEngine`、`data/context-compiler/memory-context.ts`、`app/memory.ts` 与旧 memory-ledger。

**本批目标：** `work-graph/configuration/role-memory-service.ts` 承接 read/install/activate/resolveRoleBinding 与当前有限记忆读取/修改/选择；物理记录留 RecordStore。至少切换真实人类记忆修改/读取与既有角色准入消费。role spec 的精确读不替代准入解析；旧 legacy_template 走原真实配置，不伪造 RoleSpecRevision。

**删除条件与交接：** 相关旧规则退出。输出按 commit kind/读端口的剩余清单：Run/lease/control/query/Session 相关正式规则交 R4，业务流程与执行消费者交 R5，UI 参数兼容交 R6；不得以“R3完成”为由删掉尚未迁 validator。已迁代码只保留一个正式写者。

**验证：** 角色 pin 不随配置激活偷换、真实授予交集、human/system 更新限制、记忆 revision/容量/过期/来源、删除正文语义、旧模板兼容。不要把长期专家知识库自动维护作为本批新功能。

### 3.2 R4：先 Kernel 独立扩展，再闭合 Session/执行

#### R4a — 最小 Kernel 公开扩展及独立验收

**历史状态：** 受管 Kernel 公开扩展及旧 Run 重放、暂停恢复约束 / 配置 / 工作区检查通过[原工程独立验收](reviews/R3a-R4a-sol-dsh-acceptance.md)。next 使用冻结 Kernel 公共构建；平台连续 Session 仍待目标 Runtime 接线与独立验证。

**前置：** 核对 Kernel 来源工程的 `AGENTS.md`、`INTEGRATION.md` 和 `modules/core/agent-runtime.md` 能力矩阵。next 默认只消费冻结 public 构建；若需新增 Kernel 能力，另列明确源码与冻结产物范围并记录版本，不绕过公共边界或默认扩展原 C/src。

**旧入口及目标：** 真实 `runCodingAgent` 的旧调用可接受 sessionId，但新轮默认没有历史上下文；`resumeCodingAgent` 是原中断 Run 恢复，不是新指令继续。已按冻结骨架增加可选 sessionContext（current_turn / session_history + throughPosition）、稳定 executionIdentity、controlHooks，并补 resume 所需 limits/workspace/process sandbox 参数，本批契约行为已经过修复验收。默认旧调用的 current_turn/随机身份行为不变；扩展版本按骨架公开能力标识。

**实际实现边界：** 历史完成游标固定、历史消息投影、tool-call/response 配对、旧前缀与当前 turn 去重、一次全量预算选择、checkpoint/contextBasis 版本及幂等身份均在 Kernel 内实现。平台不另写 transcript 存储或 ContextBuilder wrapper；不调用不存在的 open/compact/pause 高层方法。native compact 本轮继续 unsupported。

**删除/启用条件：** 不删除旧公开默认路径或重写旧 checkpoint。独立 Kernel 测试与构建通过前，平台不得发布真实连续执行/暂停能力。新写格式不能由旧二进制读取时明确版本拒绝与备份恢复边界，不能“回滚代码即可”冒充数据降级方案。

**独立验收：** 使用真实 SQLite Store 与本地可控模型 fixture，验证同 Session 两轮实际模型输入含前轮历史；固定完成游标排除当前 turn 重复；工具请求/响应配对；同 run/turn ID 重放不重复进入、不同输入冲突；写入后崩溃重建；损坏/缺失历史不降级为空成功；旧 checkpoint/default CLI；整套输入预算；真实 before_model/before_tool 暂停及同配置恢复。Kernel 自身检查、导出构建、平台类型/构建均通过，才开始 R4b/c 的能力接线。

#### R4b — Session 创建、稳定映射、目录与原历史读取

**前置：** R3 正式仓库/材料，以及 R4a 能力版本验证。创建与只读历史本身不调用模型。

**旧入口：** `execution/worker-runtime/coding-agent-runtime.ts` 中每 Run sqlite locator/Session 创建；新目标还没有既有正式 Session 表，不伪造 currentClaim/lastRunRef 迁移。

**本批目标：** WorkGraph sessions 组件与 Runtime `session-operations.ts`、`kernel-store-locator.ts` 接真实 `SqliteStores.open`/SessionStore。`admitSessionCreation → 固定 Kernel 身份创建 → recordSessionCreated`；planned ref 不可领取。adapterId 稳定对应真实存储实例：新执行按 workspace 选稳定库，旧 per-Run 库保留可核对 locator。接一条 Host 创建→目录读取→Kernel 原历史分页读取入口，并为下一批执行驱动消费。

**删除条件：** 被迁新入口不再随机另开 per-Run Session；旧执行的 locator reader 保留。只能根据可验证的旧记录登记 Session，无法核对的旧 Run 保持未映射。history 由 Runtime 读 Kernel Store，WorkGraph 不反向依赖 Runtime。

**验证：** 创建不启动模型；创建响应丢失原身份恢复；不同库同 SessionId 不混淆；失败不注册可用假映射；目录索引分页；原历史无 Run 读取；旧 per-Run 记录可访问；Host 关闭句柄归属正确。

#### R4c — Task 与 Query 的唯一占用、真实执行与增量观察

**已完成的窄子集 R4c.1（next）：** `platform.claims.claimTask/readTaskClaim` 已真实接通；五记录原子提交、同Task/同Session竞争、不同Task/Session并行、原回执重放、close排空与重开均已验收。见[本批报告](reviews/next-r4c-claim-2026-09-24.md)和[冻结接口](modules/core/work-graph.md#42-r4c1-当前冻结的-task-领取接口2026-09-24)。不重复建领取/角色/任务状态解释；后续直接消费TaskClaim。尚未启动Kernel，也未实现prepare、Query受理、观察入账和释放，不能将R4c整体标为完成。

**前置：** R3 的资格/角色/材料规则、R4a/b；先完成共享原子 admission，再分别切 Task 和 Query 两个真实入口。

**旧入口：** `control/control-engine/{claim,start-run,run-facts}.ts`、QueryJob 受理/执行；`control/dispatch-engine/runtime-dispatch.ts::RuntimeDispatch`、`execution/worker-runtime/{coding-agent-runtime,read-only-query-runtime,observed-model-run}.ts`、RuntimeObservationJournal。

**本批目标：** Task claim 同事务写 Task/Attempt/Run/outbox 与 Session execution slot；Query 以 QueryRunRef/QueryJob 进入同一排他槽，不伪造 TaskTriple。`prepareExecution → authorizeRuntimeEntry(consumerId/generation) → 真正进入 Kernel → recordExecutionEntered → 真实观察 recordRunResult` 接到新 `execution-driver.ts`。Task 保留信封、lease、RunFact/ModelCallAccess；Query 保留自己的角色/只读工具/预算/fact 发布校验。continueSession 消费已有 admission，不再领取。

**材料核验的时机：** 不在 claim 时全量打开计划所有 inputRequirements。仅本次启动立刻消费的输入经现有材料 reader 核验；其余在实际工具消费时检查。未核验不伪装已满足，也不因此禁止调查独立部分；候选查询不产生执行授权。

**Query原发起者与过渡退出：** R2d.3因旧QueryJob/Run没有原actor直接入口，临时在模型启动时扫描精确QueryJobSubmitted一次。R4c迁Query受理与准备时必须贯通可核对的原发起者：新受理写入版本化来源引用/记录，旧数据用精确索引或一次迁移回填且保留缺失/冲突拒绝，不能猜human/system。运行期读取走该精确来源，删除R2d.3全历史扫描；验证同名跨scope、原actor与调度actor不同、旧数据兼容及真实events扫描次数为零。

**持久链：** 技术记录按完整 binding 的规范摘要定位；RecordStore 的 appendObservedDelta 原子保存技术状态/lastKernelPosition/增量观察；随后 WG 按真实 event/sequence/generation 入账。正式入账失败只补送观察，不重复模型/工具。Kernel 原日志不复制；旧累计 JSON 单向迁移、显式标记去重读取。

**删除条件：** next 两条真实入口统一使用 Session 占用与观察写入；Reviewer/Handoff 的目标调用者由 R5b/c 接通，不引入旧驱动代理。原产品共用驱动和观察实现仍供旧消费者使用，最终切换后删除。未进入 Kernel 的 claim 释放须核对真实阶段，unknown 不当作未进入。

**验证：** 两 Task、Task/Query、Query/Query 同 Session 竞争只一方成功；失败没有孤立 Attempt/重复启动/占用残留，先前合法创建的闲置 Session 可保留。真实模型收到前轮历史；准备 stale 拒绝；permit consumer/generation 绑定；启动响应丢失不重跑；观察落盘/正式入账各失败窗口；迟到旧代际结果不释放新占用。保留真实请求最终预算/权限核对。

#### R4p — 同一工作区的并行操作与结果整合

**当前范围（2026-09-24 纠偏）：** 图是白板/检索，Agent 结合规范与已有事实决定并行；不要求启动前证明无语义冲突或预占全部未来资源。旧统一 ScopeProposal/Reservation 领取方案保存在[并行文档审计段](PARALLEL-COLLABORATION.md)，不得直接冻结给 DSH；资源分区索引扩展未落码。

**接口和骨架顺序：** 先盘点具体文件/命令操作已有权限、版本及原子保证，再按真实消费者补最小接口与测试。复用 [WorkGraph §4.0](modules/core/work-graph.md#40-执行前后静态分析的实现复用2026-09-24) 的 Workspace compare、observed compare/impact/邻域；不为并发再造一套图、文件扫描或影响遍历。Session 身份/重复启动保护按 R4c 共同协议接线，不能扩成全项目 writer 锁。

**执行前/后：** 执行前可对已知范围提供机械影响提示，既不是普遍前置也不是未来无冲突证明。执行后记录共同基线、实际变更与执行来源，定向比较并保存结果；机械无冲突部分复用，冲突保留双方成果，由 Agent 协调局部处理与必要检查。当前跨隔离根对齐、hunk/三方合并是未实现的实际工具能力，按消费者需要补齐，不以 observed 结构差分冒充。

**验收：** 同工作区独立 Session 的已授权操作可真实同时推进；预测相关/未知范围不自动全局阻塞；工具级文件版本/权限/重复副作用约束仍有效；前置提醒不迫使模型重复扫描；执行后的相交路径、结构影响、真实文本冲突分别报告；不因局部冲突回滚全部成果。不要求对所有 shell 的所有未来副作用做静态证明才允许开始。

**退役：** 全部真实执行与检查消费者切换后，删除旧全根单writer路径及重复扫描/图实现；旧产品尚在服务时只读保留，不把删文档或少一条锁当能力验收。

#### R4d — 控制、重启与查询终止

**前置：** R4c 已有可恢复真实执行和 Kernel 控制 hook。

**旧入口：** 旧控制命令/回执、生命周期能力占位适配、RuntimeDispatch.recover、QueryJob.close 与 Host durable wake。

**本批目标：** 正式期望由 RunStatePort 保存；`control-adapter.ts`/`observation-recovery.ts` 驱动实际停止/暂停/恢复并归约。暂停只在真实 Kernel checkpoint 后报告，resume 沿原 Run/Session、角色/工具/沙箱/预算继续；不支持组合明确 unsupported。Query.close 的协议 closed 不证明 Kernel 停止，driver 必须观察 closed 意图、abort 并取得实际 terminal 才释放 slot；Query pause 首批 unsupported。

**删除条件：** 真实控制与重启入口全部接线后退役 Fake/unconfigured 生命周期适配在生产中的使用；测试 fake 可以保留。保留 side_effect_result_unknown 和尚不能证明终态的占用，不自动新 Session 重跑同副作用。

**验证：** pause requested/observed 区别、before_model/before_tool、恢复剩余预算与原沙箱、cancel响应迟到、Query closed但writer未停、Host重启、旧代际、unknown、server shutdown。关闭顺序为停止驱动/实际观察落盘→Runtime关闭→Store关闭，shutdown 不伪用户 cancel ack。

#### R4e — Session 维护、责任关联与 R4 收口

**前置：** R4b–d，维护与执行共享同一个 SessionOccupancy 判别槽。

**旧入口：** 当前未实现的生命周期目标与已有 handoff 材料路径；本批实现新正式维护原语，不新增常驻“生命周期 Agent”。

**本批目标：** find/link/archive/reactivate 与 regroupSession 的真实路径。重组 target 必须已有真实映射；按稳定顺序读取所有 source/target，一次受理占用全部维护槽，再核对来源/交接材料并提交责任变更与结果。必要摘要是另一个已授权执行的材料，不在维护操作内隐式跑模型。源历史保留、不自动归档；native compact 返回 unsupported 且不先占用/写成功状态。

**删除条件：** 首版可执行维护替代对应空能力占位；没有真 compact 不新造替代实现。相关 Session/Run/lease/control/query validator 迁完后删除旧分支，剩余仅 R5 业务/入口适配。

**验证：** 执行/维护与维护/维护冲突、目标无映射拒绝、部分阶段失败恢复、同 operation 重放、归档占用拒绝、关联 since/until 历史、不可用能力无副作用、故障不假称已重组/压缩/归档。

### 3.3 R5：业务推进与全部执行消费者

#### R5a — 人机、计划、架构及 Session 选择的真实应用流程

**前置：** R3 核心规则、R4 真实执行/选择能力；保持现有 HTTP/action 入参兼容。

**旧入口：** `HumanCollaborationImpl.createGoal/amend/decide/applyChange`、InitialPlanCompiler/PlanCompilerImpl、baseline-evolution 的业务顺序、planned-task-dispatch、app/service 与 scheduling wake。

**本批目标：** next 的 `business/workflow/{goal-planning,architecture-workflow,session-policy,input-policy,advancement}.ts` 接目标 Host 动作；旧路由只作为产品行为和 DTO 对照。确定性筛选/排序候选 Session，优先相关可用连续会话；相关忙会话可等待，独立审查/调查可新建。已知事实直接读核心；需语义判断才启动真实 Query/Run。已有授权范围内细化/推进自动继续，仅新的范围、约束或验收取舍形成具体待决项。

**删除条件：** 所有真实规划/人机/架构入口消费 Workflow 后删除旧应用流程实现；初始规划原解析约束和 Query 轮次限制先保持。业务结果不直接写表、不以 ContextCompiler 总门面兜底；上下文需求选择仅保留一处。

**验证：** 无 baseline 的授权调查、初次计划确认与已有范围自动推进、不重复问用户；同任务继续/独立调查/忙候选/不兼容候选；已知文件普通读零模型启动；只有确需修改计划时 propose/apply，结果到达不自动重写 Plan。

#### R5b — 检查、独立 Reviewer、返工与完成

**前置：** R3e EvidencePort、R4 共用 driver/control/材料；真实检查执行器迁 Runtime，与 WG 无 shell 依赖。

**旧入口：** VerificationService、`command-check-lifecycle.ts::CommandCheckLifecycle`、command-check-provider、reviewer-dispatch、rework-drive。

**本批目标：** Runtime `check-execution.ts` 接现有真实沙箱命令/租约/报告，Reviewer 通过同一执行驱动，保留独立性及角色/来源绑定。Workflow `verification-workflow.ts` 决定开轮次、需要哪些检查、返工与完成调用；WG 执行确定性 coverage/currentSource/完成核对。返工通常是同 Task 新 Attempt/Run，范围变化才修订 Plan；无进展重复失败停止或改变策略，不无限循环。

**删除条件：** 检查/Reviewer/返工真实入口全部切换后删除旧 Verification 调度/驱动/Context 组装副本；旧 journal reader 按兼容保留。不能靠空报告或取消独立审查获得绿色。

**验证：** 真实命令成功/失败/超时/中断/unknown，重启不重复危险命令；本轮配置与每项来源精确绑定；独立 Reviewer 的 Session/角色隔离；返工后旧 PASS stale；最终归约完整、可选产物不强制门禁；连续无新信息失败不会无限生成 Attempt。

#### R5c — Handoff、等待唤醒及六类 Context 消费者退役

**前置：** R3f 的通信规则、R4 Session 占用、R5a/b 应用流程。

**旧入口：** `dispatch-engine/handoff/handoff-drive.ts`、waiting-successor、参与者换手、现有 terminal-continuation/durable-wake；ContextCompiler 的规划、普通工作、Reviewer、Handoff、架构对账、运行事实/普通读取等实际消费者按 import 再核对。

**本批目标：** Handoff/等待后继使用同一 driver，唯一后继受理与真实 Session 占用同事务，不先创建 Run 再抢 Session。结束 Run 等消息不继续占槽，Work 等待与当前参与关系持续。Context 需求选择归 Workflow、材料与来源操作归 WG、Kernel 输入格式归 Runtime、文件操作归 WorkspaceTools；精确读不进入准备模型链。

**删除条件：** 逐消费者列出旧符号→新调用及证据，清空后删除 ContextCompiler 总门面、旧 Handoff/普通/Reviewer 驱动副本、旧 Human/Plan/Verification/Dispatch 产品门面。尚存测试辅助按真实责任迁移，不留下只为维持旧模块名的生产出口。

**验证：** 消息回环不造成 task DAG 边、ack不唤醒 response等待、换手前后唯一参与/后继、竞争领取、恢复不双执行、上下文来源/角色/预算不缩水；规划/工作/审查/换手/架构/事实读各至少一条生产集成路径。

### 3.4 R6：Host/UI 接线与最后退役

#### R6a — 两图、材料与历史的真实只读界面

**前置：** JSON DTO冻结后UI组件可并行实现；正式架构/任务/材料查询接线依赖相应R3读能力，Session原历史依赖R4。普通只读界面不等待全部R5业务；涉及写动作的界面再等待对应业务能力。

**旧入口：** `app/service.ts/server.ts`、`src/ui/src/api`、现有 task-graph/architecture 或 misc ArchitectureView、日志/历史面板。

**本批目标：** 在 next 按 `skeleton/END-TO-END.md` 实现 core-call-context/core-queries/core-http-types，按既有 `/api/state`、`/api/real/*`、workspace/file 行为与 DTO 建立目标入口；UI 连接采用/观测架构、任务当前与历史、文件/精确材料/Session历史定位。上下文身份由 Host 注入，不接受客户端 principal/materialReader。分页按 cursor/scope，不为面板拉全日志/全图再过滤。

**删除条件：** 同一界面切新查询后删旧重复组装/全量读取；旧 endpoint 仅必要 DTO 兼容，不再保留第二套解释规则。不存在数据、无 baseline、能力 unavailable、投影 not_ready 必须区别显示。

**验证：** 真实浏览器走文件→架构节点→任务→证据→Session历史返回，切历史版本不混当前；作用域拒绝、游标失效/投影落后、损坏/缺失来源；普通查询不创建 Run/调用模型，分页取数有界。

#### R6b — Session、通信、控制与验证结果的真实操作反馈

**前置：** R4d/e 与 R5 全路径；新动作必须有真实 capability 才启用。

**旧入口：** UI agents、communication、verification-round、workbench registry/view-props 与现有控制/计划采用动作。

**本批目标：** 以角色配置+Session+工作关联呈现 Agent；Task/Query 区别；显示 requested 与实际 observed、占用/unknown、操作待完成/完成/失败。消息阅读/确认/响应分开，验证缺口和当前来源可定位。pause/resume/regroup 只按真能力启用，compact 明确不可用；既有控制、计划接受、验证、架构决策以原动作路由作兼容对照，接 next 的目标实现。

**删除条件：** 删除假的成功提示、随机 Session 推断、点击读自动发模型、重复新旧动作通道及仅占位的能力展示；不为图布局添加调度权威。

**验证：** 操作延迟/失败/重复点击、Query协议closed但实际未停、unknown保留占用、权限/不支持拒绝、新会话创建无模型、恢复状态真实性、消息往返与缺项检查。覆盖 A12 的真实 UI 路径而非只截图静态页面。

#### R6c — 剩余消费者清零、真实模块图与交付核查

**前置：** R3–R6b 的退出清单均可核对，未迁 kind/生产消费者数量为零；旧数据 reader 可保留但归正确模块。

**旧入口：** 旧模块导出、composition/persistent-platform 装配、临时 legacy-adapter、module-map 与边界允许项。

**本批目标：** next Host 按 Store/Workspace→WG→Runtime→Workflow 装配；完成 Workflow/UI 产品切换后删除原工程无消费者旧目录，清除 next 临时边，保留有明确协议价值的旧数据 reader/对外 DTO。新工程实际边界与五模块八条目标依赖一致；Contracts 无实现反向依赖，WG 无 Kernel/Runtime 调用，Store 无领域回调。

**删除条件：** 按 M01–M13 逐项签出实际旧生产符号/入口清零。不能靠排除文件或放宽架构检查隐藏旧模块；外部兼容 DTO 不要求无故破坏，但必须指向唯一真实实现。

**最终验证：** next 独立类型、完整相关测试、构建与架构边界及隔离检查；旧库/旧 artifact/旧 Kernel per-Run库/旧 journal 兼容样本；A1–A12 集成与真实 UI；重启/重复输入/unknown/代际/范围 guard 集中回归。报告生产净行数、退役实现和主路径跳转变化，记录平台观察实际写入量、任务查询与架构捕获的重复工作变化。只有真实路径和全部必要迁移完成后才标整个重构完成。


## 4. 兼容、回退和验收

- **代码回退**：记录本批开始时的实际工作树内容，回退仅针对本批自己造成的差异，不恢复整个仓库到 HEAD，不覆盖用户修改。
- **数据迁移**：每个持久 schema/引用变化列版本、旧数据读取路径、兼容写者和回退条件；正文、平台数据库、Kernel 不承诺跨库原子事务。无数据变化的目录迁移无需制造迁移脚本。
- **语义验收**：独立检查准入、占用/租约、幂等原回执、来源失效、未知副作用、检查与完成分离；按本批相关场景执行，不每批重复全部测试。
- **结构验收**：真实入口与消费者接通，当前 map/白名单精确，旧规则副本与无消费者入口删除；不以空目录/新门面/目标图通过替代源码实现。
- **可读性与性能**：比较调用跳转、规则副本、生产/测试代码量以及 UI 行为；捕获/扫描/写入工作量用相同输入计量，不预测未测模型金额或端到端提速。

新工程当前结果先记入[独立目标工程迁移与验收](reviews/next-completed-migration-2026-09-24.md)，后续子批登记各自报告与 dsh Session/任务书；`reviews/implementation-batches.md` 保留原工程批次证据。历史 PASS 只覆盖原来批次、工程与文件版本。
