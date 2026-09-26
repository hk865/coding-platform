# R3d：正式包含关系与已授权目录修订（Stage1）

状态：2026-09-26，Astra 主审已批准本任务及五路径 scope，无需另请用户确认；**主审未改源码/测试、未建占位**。Initial Plan 骨架已精确导入，其第二阶段四算法文件不写 composition；五路径骨架与后续两文件实现现已完成独立验收并导入；本页保留冻结设计。本文更新原 R3d 草案，以本轮正常产品链取代旧草案的六组局部测试要求。唯一冻结范围见 [scope](R3d-architecture-evolution-skeleton-scope.json)：4 个既有生产文件、1 个既有测试文件。依旧先骨架/最终行为测试 STOP → 中审冻结 → 实现 → 有界独立验收。

依据：PRODUCT §3/§5.5/§6.5、MVP-BEHAVIOR §架构演进/E09、UI-WORKBENCH 的真实包含树、当前 U10/U14/WG10/WG14/WG15。架构包含表示组成，dependencies 表示依赖，paths 表示映射，不能互相猜测；已授权局部维护直接推进，新的实质治理取舍才进入相应决定路径。

## 1. 本批真实产品链

真实空 SQLite 初始化 Project/Workspace → 初始采用没有包含声明的旧形状目录 → Host 明确修订同一目录、保存父子包含及新增模块 → 读取新当前/旧历史 → 原 Session 正式关联新模块并发现 → 同库重开与原修订请求 replay。

这是一条真实正式采用链，不是 UI 假字段或仅内存草案。包含事实由当前 catalog owner 随不可变 baseline/catalog 修订和唯一 active pointer 同事务维护。它不表示源码已遵循新目录，不隐式迁移已采用 Plan、Task、Run、Role、Session 及其历史；纯目录维护不要求读取工作树、模型调用或检查命令。

本批允许名称/职责/路径/接口维护、已授权新增模块、明确包含关系和既有依赖调整。保留 ModuleRef；模块撤销/替换 ID、修改 baseline 治理内容、自动 remediation、运行迁移与决定/gate 采用仍有后续范围。不能以本批交付声明完整 E09 已完成。

## 2. 已有原子结构与可复用符号

路径相对 coding-platform/next：

- architecture/catalog-service.ts：`createArchitectureCatalogService/adoptInitialArchitecture` 已在一次事务写 baseline/catalog/唯一 ProjectArchitectureBaselineActive/event；`readCurrentCatalogWindow` 返回当前准确版本与局部 guards，`readRevisionByRef` 读不可变历史。复用此 owner，不新建树服务或 active 指针。
- catalog-record-codecs.ts：`validateAdoptedArchitecture/readModuleRef/architectureBaselineDigest/readArchitectureBaselineSnapshot` 与 `hasCycleInEdges` 已维护正式目录形状、项目引用、依赖及摘要。扩原 validator，不复制另一套目录规则。
- `ARCHITECTURE_CATALOG_SCHEMAS` 注册原 catalog 及采用事件；baseline/active 唯一注册继续由 `PLAN_GOVERNANCE_RECORD_SCHEMAS` 提供。本批新 revised event 加入现集合，不重复注册 baseline 或建立 containment schema/index。
- sessions/session-lifecycle.ts 的 `linkSessionWork` 已用 `readCatalogModuleFacts` 核当前正式 Module 并合入其 CAS；session-directory.ts 的 `findSessions` 用真实 target 索引发现同一 Session。该链不需要 Session 新身份或第二模块关联 owner。
- create-platform.ts 已将 observed 四方法、A1 两方法装在同一公开 architecture 对象，并使用 trackedCall 排空。只增原 catalog 的一个 tracked 方法，保留在途 Query/Runtime/Workflow 的组合根变动。
- 当前 `ModuleDefinition` 仅 ref/name/responsibility/paths/interfaces；`AdoptedArchitecture` 仅 modules/dependencies/requireDag。observed `CodeGraphEdge` 也没有 contains，只有 dependency/interface/type/calls。**现代码没有正式包含事实可直接展示为树**，不能把 graph-index 的邻接索引、module paths 或 source AST 观测边当作已采用父子关系。

## 3. 在既有 catalog 中保存明确包含事实

只在 catalog-contracts.ts 的既有 `AdoptedArchitecture` 增加一个兼容可选字段，ModuleDefinition/ModuleRef 不另造身份：

```ts
export type ModuleContainment = {
  parentOf: { parent: ModuleRef; child: ModuleRef }[];
};
export type AdoptedArchitecture = {
  modules: ModuleDefinition[];
  dependencies: { from: ModuleRef; to: ModuleRef; reason: string }[];
  requireDag: boolean;
  containment?: ModuleContainment;
};
```

语义必须区别：

- containment 缺省：该历史/当前修订没有声明正式包含关系；读取保留缺省，不填空数组，不从 paths 或 dependencies 推断树。
- 显式 `{parentOf:[]}`：采用方明确声明本修订所有模块平铺。
- 显式非空：parent 包含 child；没有父边的模块是该已声明森林中的根，可有多个根，不制造持久 Project 根模块。UI 后续可用展示根包围森林，但该展示根不是正式 ModuleRef。

局部 validator 只核本次完整 catalog：parent/child 都是本项目已声明 ModuleRef、不同端点、关系不重复、每个 child 至多一个 parent、包含关系无环。依赖和包含分别检查，不把两类边合起来找环；两兄弟可以依赖，父子路径也不要求目录嵌套。结构检查复用现 `readModuleRef` 和图循环工具，不能扩大为工作区扫描/语义分析/并发安全证明。

初始采用和后续修订共用同一 validator/codec：当前 @1 记录和旧事件缺该字段仍按原值读取/replay，不能改写旧 JSON/摘要或把旧版“未知”归一成新“平铺”。既有记录/事件 codec 顶层仍严格闭合，只允许这个有定义的可选字段。若 parent 已有 containment，新修订不能因旧客户端漏字段就静默清除：完整新 catalog 须显式保留/修改 containment，省略为 invalid；显式空数组才是明确平铺。parent 未声明时可继续未声明或本次首次声明。

## 4. 已授权修订接口与唯一提交

catalog-contracts.ts 沿用 GraphWrite/ArchitectureRevision/ArchitectureBaselinePin/WriteResult：

```ts
type ReviseArchitectureCatalogInput = {
  basedOn: ArchitectureBaselinePin;
  catalog: AdoptedArchitecture;
  reason: string;
};
reviseArchitectureCatalog(ctx: CoreCallContext,
  request: GraphWrite<ReviseArchitectureCatalogInput>
): Promise<WriteResult<ArchitectureRevision>>;
```

保持 A1 可信 human/system Host 和 scope 检查、首 await 前隔离纯输入、保留原 signal。reason 非空且最多 2,048 UTF-8 bytes。输入不接受目标 revision/摘要、替换 baseline 内容、policy/noGate 布尔值或自报 decision/gate。该写入口由真正受信 Host 发出；不发布模型工具或让 continuation 伪造 Host。

caller expected 沿 A1 恰为 Project/Workspace 两个 pin；basedOn 是不可变 baseline 的完整 ref+digest，取自 readArchitectureRevision/原采用结果，不能猜 active revision。请求 identity 为 architecture-catalog-revise: 加原 commandIdentityKey；fingerprint 覆盖 workspace/basedOn/完整 catalog/reason/规范 expected。先查询原 receipt，miss 才读取当前目录与 Project/Workspace；原 replay 取原 event 结果，不按后来 active/source/Role 状态否定旧成功。同 key 不同输入仍 idempotency_conflict。

fresh 修订复用 current window，basedOn 不符 source_stale；无当前 baseline 为 incomplete，旧 catalog=null 为 unsupported，不能猜空目录。复用 validateAdoptedArchitecture 一次，旧 ModuleRef 集合不减少。沿袭 parent baseline.content 全文，包括原 description/constraints/sourceBinding；新版本同 baselineId、contentRevision=parent.ref.revision+1，用原 architectureBaselineDigest 重算。存在 typed dependencyRules 的历史 baseline 暂保持明确 unsupported，等待其具体规则 consumer；不默默忽略它，也不将自然语言 constraints 变成新自动 gate。

一次 PreparedCommit：

- guards：Project/Workspace caller 版本、当前 active 与父 baseline/catalog 版本、新 baseline/catalog 键缺席；只守这些相交对象，无 ledgerHorizon、全工作区无活动 Run 或所有 Plan 迁移完成门槛。
- records：新 immutable baseline/catalog（行 revision=1）和唯一 active（old+1），包含事实只在该新 catalog body 中；不重写父记录，不另存树事实/索引。
- `ArchitectureCatalogRevised@1`：fromPin、真实 actor/reason、identity/fingerprint、完整原 ArchitectureRevision，给 eventAt 精确恢复原值/cursor。
- 不写 Goal/Plan/Task/Run/Session/WorkLink/Role/材料/源码；旧 Plan.effectiveArchitectureBaseline 与历史继续定位旧版本，新目录只影响之后主动读取当前默认目录的消费者。

同 basedOn 的相交修订至多一成功，复用现局部 CAS 和有界 identity conflict recovery；不增加全局锁或无限 retry。取消前零写，提交成功后仍报告 committed。Stage1 新 revise 方法明确 unsupported 后 STOP；不要提前实现版本提交算法。

## 5. Plan、decision、gate 的真实对账与后续边界

| 当前实际入口/结构 | 已有行为 | 本批能否借作架构演进授权 |
| --- | --- | --- |
| architecture.adoptInitialArchitecture/readArchitectureRevision | 首次采用、当前/精确历史读取 | 复用同 catalog owner；initial 仍不能覆盖 active |
| plans.proposePlan/applyPlanChange | 初始 Plan 与 W1/W2 已批准范围内未来修订；已采用 Plan 保存自己的治理 pin | 不能把非空 decisionRefs 当“已有治理”；初始采用拒 decisionRefs，W1/W2 也不把任意 refs 当授权 |
| CandidateArchitectureBaseline/ArchitectureChangeDecision/MigrationGateTask/BaselineActivation | next 当前仅保留 ref 声明 | 没有可调用正式 writer/evaluator/activation chain，不能 seed、伪造或宣称已通过 |
| ArchitectureEvolutionPolicyRevision | 当前仅 refs，无 schema/reader/writer | 不能从不存在的 policy 推导默认自动 remediation 权限 |
| evidence.openVerification、checks.runRegisteredCheck、finalizeChecks、tasks.completeTask/completeGoal | 已有真实任务检查和正式完成链 | Goal/task gate 不是 MigrationGateTask，真实 PASS 也不自动授权新架构治理取舍 |
| architecture 的 capture/query/compare/impact | 真实源码观测/机械差分，结果 noVerdict | 可作解释依据，不自动成为正式包含或目录采用 |

本批是既有授权内的 Host 目录维护，actor/reason 留在正式修订事件；它不替代用户真正需要作出的新决定。后续治理仍保留：具体范围取舍的候选与接受/拒绝/延期事实、已采用结构化政策的适用规则、必要迁移 gate、正式采用与受影响 Plan/上下文迁移。实现这些 producer 后再让相应消费者使用精确来源链；不得把 CompletionPolicy、自然语言说明、非空 decisionRefs 或任意 Evidence 当万能许可。

普通目录读取/replay、Session 模块关联不加 Run/Role/全 Plan ownership 链；授权撤销只在实际受控操作检查。不引入运行中换 Role、直接损坏持久记录或全局安全证明测试。

## 6. 精确五路径与一条正常产品链

冻结 scope 为 4 个现有生产文件：

1. `coding-platform/next/src/core/work-graph/architecture/catalog-contracts.ts`：containment DTO 与窄 revise 方法。
2. `coding-platform/next/src/core/work-graph/architecture/catalog-service.ts`：同 owner 的 unsupported 接缝；第二阶段复用当前窗口、原请求回执、局部 CAS 实现修订。
3. `coding-platform/next/src/core/work-graph/architecture/catalog-record-codecs.ts`：兼容可选包含结构及 revised event；同一 validator/原 schemas，不复制算法或新建树存储。
4. `coding-platform/next/src/composition/create-platform.ts`：同 catalog 实例公开 tracked revise，新事件随原集合注册一次，原 close 排空。

测试只写现有 `coding-platform/next/tests/composition/A1-graph-session-platform.test.ts`，**只新增一个 it，原用例不改/弱化**。新正常链在同文件复用 setup 风格，但用现 platform.projects.createProject/registerWorkspace 真实初始化，不调用旧 seedTrustedScope 或 raw Store 来伪造新链。无需模型、Task/Plan、CompletionPolicy 或源码授权；原 workspace grant 可拒绝源码读取，以表明纯目录维护不依赖它。

一条链足够：

1. 空 SQLite/真实 Kernel store → Project/Workspace 公开 writer → 初始采用旧三字段 catalog（containment 缺省）。
2. 以原返回 baseline pin、正式 Project/Workspace pins 提交 revise，保留原模块并新增 Module，显式声明至少一层父子；选用不嵌套的 paths 与独立依赖边，验证结果直接保留声明而非按路径/依赖猜树。
3. 新 current 精确读出 containment；旧 revision 仍无该字段、无新增模块，baseline.description/constraints 原样延续。
4. 真实 runtime.createSession → sessions.linkSessionWork 指向新 Module → findSessions(target) 找到同一 Kernel/Session，角色与 occupancy 未被目录修订改写。
5. 关闭/重开同库，读取新 current/旧历史，并原样重发原 revise request 得到原 revision/cursor/replayed，不重新创建版本或根据当前值伪造旧回执。

Stage1 第一次 revise 应在明确 unsupported 首红，后段如实报告未达；initial/Session fixture 自身必须真实合法。第二阶段将这条链跑通即可，不增加第二轮测试矩阵、全 DB/并发/撤权/损坏排列。固定检查为 `python3 tools/dsh-refactor/check.py next-catalog next-catalog-platform`（前者保护现初始目录基本契约，后者只读本批既有组合文件），再单独执行 `python3 tools/dsh-refactor/check.py next-types`。不运行全套。已有正式 DAG/端点检查继续，新增包含 validator 的局部结构规则只作必要审阅，不扩大为全系统证明。

阶段一 codec/DTO/事件接缝可声明新形状，新 revise 保持 unsupported，不提前创建新 baseline/active。中审冻结测试后，预计实现写范围只需 catalog-service.ts 与 catalog-record-codecs.ts；若确有新接口缺口先报主审，不自行扩写。机器 scope 已列出所有既有文件，无新源码占位。

## 7. 批间协调与真实消费者

唯一共享生产写点为 create-platform.ts：与当前 Query/初始 Plan/R4 等批次须由主审串行安排 fresh snapshot/导入，不能覆盖它们的 raw owners 或新公共方法。catalog 三文件和 A1 组合测试与 R2 mixed/R6 app/UI 无交集。W2/Task 完成现已真实存在，但不是本批目录修订前置，也不消费它们的 private writers。

现 `core-http-types` 的 ArchitectureReadResponse 与 BootstrapReviewArchitecture 直接使用原 catalog 类型，后续 R6 可从真实 readArchitectureRevision 结果画声明森林；缺省 containment 要显示“尚未声明包含关系”，不能把当前平铺图当已采用树。该批不写 app/UI，不声称页面接线完成；R6 后续只需具名 revise 路由/编辑及树消费者，不新建页面树事实或另一个采用 owner。

真实源码影响解释继续复用 observed 图/Material 的现端口。历史 sourceBinding 只是出处，目录维护不自建 source capture/Evidence。模块撤销、复杂决定与迁移、自动 Agent 采用及完整 E09 继续保留原产品范围，不从本批窄链推断已交付。

## 8. 2026-09-26 骨架中审与精确导入

新 DSH 会话 `session-ebddebcf-5413-4eeb-9267-6ac109e32892` 已 exit 0 STOP。Astra 独立固定检查：`next-catalog next-catalog-platform` 共 33 项，32 pass + 新正常链在首次 revise unsupported 处的 1 个预期首红；`next-types` pass。原组合用例主体逐字保持，只新增 1 条真实公开 Project/Workspace 初始化链；中审未见阻断正常链或目录/历史/关联语义的问题。scope audit 越界与主区基线漂移均为空，按 originalAllowedHashes 精确导入 5 文件。

证据：[`r3d-architecture-evolution-skeleton-import.json`](../reviews/evidence/next-b2-2026-09-26/r3d-architecture-evolution-skeleton-import.json)。契约、组合根、测试自此冻结；实现仅允许 catalog-service.ts 与 catalog-record-codecs.ts，需 fresh 独立 scope。包含 DTO 已可读取，不表示正式修订算法或 UI 已完成。

Stage2 后续已完成：33/33 pass + types，精确导入唯一 catalog-service.ts 变更；见 [实现与最终证据](R3d-architecture-evolution-implementation.md#5-独立验收与精确导入)。本批契约/实现/正常消费者链已闭合，不再追加局部测试；继续 UI 或下一真实产品能力。
