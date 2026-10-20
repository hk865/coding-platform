改完再施工

本次只做了静态读取和检索；没有修改文件，没有运行测试、构建、Git 写操作或网络请求。`rg` 不在当前环境中，调用方检索使用了 PowerShell 的区分大小写文本检索。

以下行号均指本次基线。为缩短重复路径，下文：

- **条目表**＝`.lead-ref/books/t-items-TP.md`
- **总则**＝`.lead-ref/books/t-book.md`
- **运行书**＝`.lead-ref/books/t-run-TP.md`
- **规则表**＝`docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md`
- **可达性名单**＝`tests/architecture/production-reach-allowlist.json`

**1．需要修改的条目**

同一条目有多个独立问题时分行列出。白名单遗漏在下一节逐文件展开。

| 编号 | 问题 | 证据（file:line） | 改法 |
|---|---|---|---|
| TP-001、TP-005 | 删除 N0 测试时，会一起删掉现有未知 `kind` 返回 `unsupported` 的断言；未知类型拒绝分支仍存在。不能用“不补测试”解释删除这项当前行为覆盖。 | `tests/composition/platform.test.ts:79`；`src/business/workflow/workflow.ts:815`；条目表:5、32 | 删除 N0 专用声明和处理；把现有拒绝测试的输入换成非 N0 的未知 `kind`，保留 `unsupported` 断言，按 A6 放在拒绝输入场景中。两条合并执行一次。 |
| TP-003 | 同一条同时写“保留 outbox 断言”和“整条 it 也可以删，由 lead 定”，会产生不同删除范围。 | 条目表:19、20、21；`tests/state/attempt-machine.test.ts:705` | 与 TP-040 同批；只删 `TaskDispatchStateV1` 的导入、声明、转出及第 708、709、711、712 行的恒等断言，保留第 706、707、710 行的 outbox 断言；删除“整条 it 也可删”的文字。 |
| TP-004 | 删除类型字段以后，三处通过点访问检查字段不存在的测试需要同步修改；涉及两个 T3 文件。 | `tests/business/K3-46-review-advance-failures.test.ts:736`；`tests/business/K3-UR7-crr-failed-set.test.ts:388`、`:445` | 三处分别改为 `expect(value).not.toHaveProperty('failedReviewRefs')`；保留公共入口拒绝测试，并补齐白名单及 T3 交接安排。 |
| TP-006 | 动作提到的外部 Workflow 装配没有进入白名单，其中四个文件属于 T3。还必须区分“只给 Workflow 使用的 sources”和仍供 decision service 使用的 sources。 | `tests/business/K3-46-review-advance-failures.test.ts:229`、`:241`；`tests/business/K3-UR7-crr-failed-set.test.ts:268`、`:281`；`tests/helpers/K3-review-card-fixture.ts:283`、`:315` | 补齐下一节所列五个文件；删除 Workflow 的 `decisionSources` 参数及其专用构造，保留 `K3-review-card-fixture.ts:283` 仍传给 decision service 的 `sources`。 |
| TP-009、TP-054 | “真实 prepare 或合法 binding 构造器”不是等价路径。后者仍允许手造 manifest/binding 后交给 owner 接受，违反规则表 F1、F3。并且遗漏七个组外 manifest 构造文件。 | 条目表:60、349；规则表:57、64；`tests/helpers/S2A-planning-fixture.ts:74`；`tests/helpers/WP2-notices-fixture.ts:198`；`tests/work-graph/S5-goal-settings.test.ts:280` | 删除“合法 binding 构造器”选项；统一通过真实 Task/Query prepare 取得 manifest 和 binding。共用 helper 只能接收公开输入、文件和脚本回复，不能接收 prepared/binding。补齐下一节文件；以 TP-054 为实施条目，TP-009 标记由其吸收。 |
| TP-010 | 动作仍是“lead rules first；if accepted”，没有冻结删除决定；这与总则“动作最终”冲突。不能交给 DSH 选择是否撤掉当前 manifest 字段和交叉检查。 | 条目表:67；总则:22；`src/contracts/core/prepared-execution.ts:189`；`src/core/work-graph/tasks/execution-entry-service.ts:451` | 将本条标为 `BLOCKED：待 lead 冻结 selectedTaskInputs 的删除范围及对应规格后注`。冻结文本必须明确只处理 manifest 投影及其检查，不能连带删除仍公开使用的 TaskInputPage 字段。 |
| TP-011 | 使用约数描述收窄点，并把 `collaboration-driver` 列为需去掉版本收窄的地方；该处实际只有缺授权和 `phase === 'authorized'` 判断。无授权 running 的处理也仍留给施工者决定。 | 条目表:74；`src/app/collaboration-driver.ts:435`；条目表:309 | 用 TP-048、TP-055、TP-060 的具体清单替换约数清单；删除本主题对 `collaboration-driver` 的修改要求；无授权 running 按 TP-048 列出的旧用例删除，保留 D7 无绑定 Ended。 |
| TP-014、TP-051 | 必填字段修改没有覆盖仍构造旧形状 Goal 的调用方；只改生产创建器和两条旧字节测试不够。 | `tests/app/A2-startup-redrive-select.test.ts:34`；`tests/business/A2-workflow-auto-rework.test.ts:53`；`tests/helpers/WP1-units-fixture.ts:377`；`tests/runtime/S3-context-assembler.test.ts:100`；`tests/work-graph/material-readers.test.ts:21` | 两条合并，以 TP-051 的创建事件重建范围为准。逐个迁移下一节列出的 Goal 构造点：纯输入中的初始 Goal 明确写 `desiredStateRevision:1`、`desiredStateRequestedBy:null`；平台夹具通过真实 `createGoal` 取得当前记录。保留暂停、恢复、请求者及计划采用断言。 |
| TP-015 | 已点名的两个 Query 执行文件，以及其他执行意图读取方不在白名单；这些是接口收紧和分支修改，不能只靠删除符号的编译例外。 | `src/core/agent-runtime/query-execution.ts:186`；`src/core/work-graph/queries/query-execution.ts:899`、`:1212`；`src/business/workflow/consultation.ts:141`；`src/core/work-graph/tasks/planning-question-reader.ts:168` | 把下一节四个生产文件加入范围；分别去掉“缺 execution”路径及相应可选读取，保留 execution 内部真正可选的 consultation 字段。 |
| TP-016 | 要求保留“现有测试清单”，但该名单项没有测试清单。 | 可达性名单:416 | note 改为条目指定的 decision 6／B01 前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec`，不要写 `used only by tests`。 |
| TP-018 | 同上；该项记录的是 install 入口可达关系。 | 可达性名单:428 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec`。 |
| TP-019 | 同上；该项记录的是 activate 入口可达关系。 | 可达性名单:434 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.activateRoleSpec`。 |
| TP-020 | 同上。 | 可达性名单:440 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec`。 |
| TP-021 | 同上。 | 可达性名单:446 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.activateRoleSpec`。 |
| TP-022 | 同上。 | 可达性名单:452 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec`。 |
| TP-023 | 同上。 | 可达性名单:458 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.activateRoleSpec`。 |
| TP-024 | 同上。 | 可达性名单:464；`src/contracts/role-spec.ts:248` | 只修改 `RoleSpecInstalledEvent` 对应项；使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec`。 |
| TP-025 | “两个旧根的测试由 lead 定删还是改”仍未冻结；这些位置包含坏链、槽冲突等不同断言，不能由 DSH 一律删除。 | 条目表:161、162；`tests/state/task-machine.test.ts:1350`；`tests/work-graph/A2-gate-chain-facts.test.ts:218`；`tests/work-graph/R3e-reverify.test.ts:467` | 将“两个旧根”这一子项标为 BLOCKED，要求 lead 在本条逐一列出 VD-1、VD-15、GAP-52、P10、P20 的保留断言及当前 chain 输入；已明确的缺 chain 兼容删除与当前 rootChain 转换仍按清单执行。 |
| TP-026 | `ProjectSourceAccess` 已经在目标文件声明，不能再把它“移过去再导出”成第二份声明；另有两个动态类型导入仍指向待删除模块。 | `src/core/workspace/project-source-snapshot.ts:18`；`src/core/workspace/project-source-index.ts:4`；`src/core/agent-runtime/exploration-tools.ts:186`、`:187` | 保留目标文件现有 `ProjectSourceAccess`；只迁移 `ProjectSourceQuery`，并将 Python、C++ 处理器中的两个动态类型导入一起改到 `project-source-snapshot.js`。 |
| TP-026 | 指定的 analyzer cover 没有覆盖旧测试的 tsconfig include、路径别名和 72 个源文件断言。 | `tests/data/project-source-index.test.ts:14`、`:25`；`tests/data/typescript-source-query.test.ts:15` | 删除旧文件前，把第 25–35 行的 include、别名、72 个文件、定义、引用、静态调用断言迁入 `typescript-source-query.test.ts`，用真实文件捕获后交给 `TypeScriptSourceAnalyzer`；保留原有字面期望。 |
| TP-026 | “换 frozen 测 Python 释放”没有说明原来“两种 index 都尝试释放”断言如何处理；删除 ProjectSourceIndex 后，组内只剩 Python 的显式 dispose，C++ 没有 dispose。 | `tests/runtime/source-tool-lifecycle.test.ts:229`、`:250`；`src/core/agent-runtime/exploration-tools.ts:98`、`:119`、`:127` | 明确把释放失败注入移到真实 `PythonSourceIndex.dispose`；保留一次释放、重复 close 返回同一失败、关闭后 handler 拒绝、外部 capture 不被关闭的断言；明确删除仅针对已退役 ProjectSourceIndex 的第二个释放计数。 |
| TP-026 | 工具说明仍向模型推荐已删除的 `project_index`。另有两处类型导入文件不在白名单。 | `src/core/agent-runtime/project-source-tool.ts:237`；`tests/data/project-source-snapshot.test.ts:2`；`tests/data/typescript-source-reuse.test.ts:2` | 删除工具说明中 `project_index` 仍是实时兼容路径的承诺；补齐这三个文件。保留无 frozen access 时 Python/C++ 等现有工具的构造能力，不要求所有直接调用者凭空提供 capture。 |
| TP-027 | 动作已点名的启动配置和 Query 执行守卫不在白名单；启动文件属于 TQ。 | `src/app/main.ts:153`；`src/core/agent-runtime/query-execution.ts:313` | 补入两个文件，并安排与 TQ 串行交接；同时将 TP-074 标记为被本条删除动作吸收。 |
| TP-028 | 九个选项构造文件中七个不在白名单。必填参数补充不是删除符号的编译例外。 | 条目表:182；`tests/app/AG6-agent-assembly.test.ts:192`；`tests/runtime/R4c-execution-history.test.ts:101`；`tests/data/cpp-source-index.test.ts:148` | 补齐下一节七个文件；所有缺省调用显式传 `{tokenBudget:null, deadline:null}`，保留现有预算映射期望。 |
| TP-030 | “changed current execution”现有测试靠改写返回记录完成；TP-118 的真实 Query 准备步骤不能自动替代这一步。该断言不能原样留下，也不能由 DSH自行删除。 | `tests/runtime/source-binding-migration.test.ts:232`、`:238`；规则表:61；条目表:794 | 把“绑定后 execution 改变”子场景标为 BLOCKED，要求 lead 补出符合规则表、能够触发同一再校验分支的公开步骤。原始提交人、共享一次精确读取的转换照常保留；不得继续使用 `state.set` 改写事实。 |
| TP-031 | “约 25 个文件、64 处”没有形成可施工清单；多个生产读取方、消息类型/codec、测试和资源文件不在白名单，并与 T1/T2/T3/TQ 重叠。 | `src/core/work-graph/state/message-machine.ts:183`、`:1202`；`src/core/work-graph/sessions/message-record-codecs.ts:780`；`src/app/host.ts:1224`；`resources/skills/platform-work/content.md:24`；`runtime-assets.json:47` | 将下一节 TP-031 文件清单直接纳入条目及白名单。所有旧 `wait` 调用改为 `intent:'inquiry', needsReply:true, waitAfterSend:true`；删除记录字段、codec 字段及读取回退；同步技能文本和其 SHA256；原 fire-and-forget 场景保持原行为。 |
| TP-032 | note 没有“现有测试清单”，实际列出两个入口。 | 可达性名单:566 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec, RoleConfigurationPort.activateRoleSpec`。 |
| TP-033 | note 没有测试清单。 | 可达性名单:572 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec`。 |
| TP-034 | note 没有测试清单。 | 可达性名单:578 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.activateRoleSpec`。 |
| TP-035 | note 没有测试清单。 | 可达性名单:584 | 使用指定的新前缀，结尾保留两个 RoleConfigurationPort 入口。 |
| TP-036 | note 没有测试清单。 | 可达性名单:590 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec`。 |
| TP-037 | note 没有测试清单。 | 可达性名单:596 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.activateRoleSpec`。 |
| TP-038 | note 没有测试清单。 | 可达性名单:602 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.installRoleSpec`。 |
| TP-039 | note 没有测试清单。 | 可达性名单:608 | 使用指定的新前缀，结尾保留 `only reached from RoleConfigurationPort.activateRoleSpec`。 |
| TP-041 | “整条测试也可删”与 TP-003 的保留要求冲突。 | 条目表:264；条目表:20；`tests/state/attempt-machine.test.ts:705` | 删除“整条测试也可删”；声明本条由 TP-003＋TP-040 同批吸收，保留 outbox 三行断言。 |
| TP-045 | 要求删除 `legacyRound` helper，但仍保留的 lookup 测试继续调用它；TP-025、TP-138 则要求改为当前 rootChain。 | 条目表:289、162、935；`tests/work-graph/A2-step1-codecs.test.ts:397`、`:409` | 把 `legacyRound` 改名并改成带 rootChain 的当前根轮次；保留合法缺 `incompleteCause` 以及第 395–414 行 lookup 断言。只删除第 380–385 行的无 chain 兼容测试。 |
| TP-045 | chain 的下游读取及组外测试迁移未纳入白名单。 | `src/core/work-graph/state/task-machine.ts:120`；`src/core/work-graph/state/task-failure.ts:1180`；`src/core/work-graph/tasks/completion.ts:390`；条目表:162 | 补齐下一节文件；将源代码的旧根默认读取与当前测试输入迁移列为本主题范围，不让 DSH 按“按需”自行决定跨组修改。 |
| TP-046 | 删除第 284–296 行会删掉当前从无 index 开始追加证据的断言；TP-141 明确要求保留后半段。 | 条目表:296、956；`tests/work-graph/A2-verification-chain.test.ts:284`、`:288`、`:295` | 只删除旧 @0 的提交及其注释；保留 `gateIndexRef`，让第 288–296 行从不存在的 index 开始执行，并保留 revision/evidenceIds 断言；改测试名。 |
| TP-048 | 漏掉 V1 类型的两个外部使用文件；保留 malformed V2 时，也不能继续依赖将被删除的 `legacy` 前置变量。 | `tests/state/invariants.ts:36`、`:112`；`tests/helpers/S2B-r2-activity-support.ts:13`、`:43`；`tests/work-graph/B2-execution-entry.test.ts:214` | 补齐两个文件，去掉其 V1 类型路径；malformed V2 用例改为以当前 V2 前置状态构造拒绝输入，移除对 `legacy` 变量的依赖，保留该拒绝断言及 D7 Ended 断言。 |
| TP-049 | 动作已经要求删除 `LegacyPlanProposal` 转出，但对应文件没有进入白名单。 | `src/core/work-graph/model/plan-contracts.ts:33`；条目表:316 | 将 `src/core/work-graph/model/plan-contracts.ts` 加入白名单，随 legacy proposal 类型、codec、状态机分支一起删除该转出。 |
| TP-050 | 只说“约 25 个 V1 草稿”不够。还有 V1 快照、codec 输入和多个组外 helper；它们不会因为草稿改为 2 自动变成当前快照。 | `tests/helpers/graph-session-fixture.ts:444`；`tests/work-graph/R3c-canonical-task-state.test.ts:23`；`tests/work-graph/R4b-session-directory.test.ts:118`；`tests/work-graph/S4C2-goal-triggers.test.ts:48`；`tests/work-graph/R3c-task-relations-boundaries.test.ts:88` | 将下一节所有 TP-050 文件加入条目。当前场景的草稿和快照统一迁到 V2，快照补当前关系/输入字段；codec 文件只删除 V1 专属分支和断言，保留 V2 边界检查。 |
| TP-050 | TP-132 明确保留 schemaVersion 1 草稿断言，与本条只收 V2 冲突。 | 条目表:323、893；`tests/state/plan-machine.test.ts:498` | 在 TP-050 中明确吸收 TP-132 的草稿版本部分：当前候选场景改用 V2；撤掉“保留 schemaVersion 1 草稿”的指令，保留非版本相关的候选状态断言。 |
| TP-052 | 三个已点名的 locator 读取文件不在白名单，其中 graph-context-reader 属于 TQ。 | `src/core/work-graph/queries/query-execution.ts:335`；`src/core/work-graph/tasks/request-facts-reader.ts:67`；`src/core/work-graph/views/graph-context-reader.ts:579` | 补齐三个文件；与 TP-030 同批，删除缺 locator 回退，保留精确提交读取失败时的现有拒绝语义。 |
| TP-055 | 同批依赖写成 P2a-06，实际指向 Goal 字段条目；删除行号 414 也错误，它属于当前 `run_outcome_unknown` 断言。 | 条目表:356；条目表:329；`tests/state/task-failure.test.ts:404`、`:412`、`:414` | 同批依赖改为 TP-011／TP-048；删除第 404 行的 V1 构造和第 412 行的对应断言，保留第 413–414 行的无 outcome 断言。 |
| TP-058 | 两个已点名的别名使用文件在 TP 白名单外，其中一个属于 T1。 | `tests/state/unknown-call-review.test.ts:30`、`:157`；`tests/work-graph/K3-45-review-incomplete.test.ts:20`、`:114` | 把两个文件补入范围，四处统一改用 `UnknownCallReviewEventV1`；与 T1 串行交接，不删除状态机断言。 |
| TP-060 | 同批依赖同样错误地写成 P2a-06。 | 条目表:390；条目表:329；`src/core/work-graph/state/run-machine.ts:94` | 将依赖明确改为 TP-011／TP-048；六处区域内和十六处区域外清理随 V1 类型退出同批落地。 |
| TP-061 | 前置条件 P2a-03 实际是授权 V1；真正使 Plan V2 读取成立的是 TP-050。另有四个生产文件不在白名单。 | 条目表:397；条目表:308、322；`src/core/work-graph/tasks/plan-readers.ts:1347`；`src/core/work-graph/tasks/plan-task-basis.ts:106` | 前置条件改为 TP-049＋TP-050；补齐下一节四个文件；保留 `taskStateBasis` 缺省为自身的当前语义。 |
| TP-062 | 整文件删除与 TP-007 保留真实 execution 列表场景冲突。 | 条目表:47、404、823；`tests/scenarios/S2C-K-legacy-provenance.test.ts:482` | 禁止整文件删除；只删旧 provenance/backfill 场景，把第 482 行起的 execution 列表场景改用当前 Session 创建与真实执行前置后保留。TP-122 同步改为引用这一范围。 |
| TP-062 | 删除 provenance reader 会断掉 claim-service 的真实调用；动作没有列出这条调用链。 | `src/core/work-graph/tasks/claim-service.ts:103`、`:731`、`:762`、`:775` | 删除 claim-service 的 legacy reader 构造与派生调用；直接使用已解码的当前 `session.provenance`，保留 readonly_copy 的派发拒绝语义。 |
| TP-062 | `provenance` 仅“改必填、拒绝缺字段”仍可留下 null 兼容；实际 Session codec 及多处当前测试构造也漏出范围。 | `src/contracts/core/session.ts:54`；`src/core/work-graph/sessions/session-record-codecs.ts:736`、`:1030`；`tests/work-graph/S1-codecs-indexes.test.ts:166`；`tests/work-graph/A2-step1-codecs.test.ts:677` | 明确类型为非空 `SessionProvenanceV1`，codec 不再接受缺失或 null，不再补 null；保留创建输入省略 provenance 时生成 `kind:'new'` 的当前规则。迁移下一节列出的 Session 构造和混合测试，不删除其当前 health、归档、索引断言。 |
| TP-062 | 还漏了两个直接测试 backfill API 的文件，其中包含纯状态机与 owner 场景，不能靠删 import 修完。 | `tests/state/S1-session-archive.test.ts:194`、`:204`、`:212`；`tests/work-graph/S1-provenance.test.ts:238`、`:406` | 将两文件纳入条目；逐项删除 backfill/legacy derivation 专属场景，保留同文件当前 Session 归档与 provenance 行为。补齐跨 T1/T2 交接。 |
| TP-063 | NR05 删除 legacy 项后仍保留 `items[1]` 的当前提交位置断言，索引已经不成立。 | `tests/work-graph/S5-notices.test.ts:206`、`:209`；条目表:1131 | 保留 fresh 通知及损坏位置拒绝；数量改为 1，第 209 行两处索引都改为 `items[0]`，仍与同一真实提交位置比较。 |
| TP-063 | NR08 整条删除会连同“策略改变后已记录通知不变”的回读断言一起删除；TP-167 只写成可选迁移。 | `tests/work-graph/S5-notices.test.ts:271`、`:280`、`:283`；条目表:1138 | 删除旧 cap 缺失场景；把策略由 3 改为 7 后同一通知的 cap 和内容保持不变的断言强制迁到 NR01 的当前格式 reverify 场景。TP-167 改为必须迁移。 |
| TP-063 | 对错误 cursor 示例仍给出“改成普通错误或删掉”两种不同代码。 | 条目表:411；`tests/work-graph/WP2-undelivered-notices.test.ts:446` | 将该输入改成未知 `kind:'unknown'` 的格式错误值，保留原拒绝断言，不删除这项错误输入检查。 |
| TP-065 | `unplaced.rounds`、`checksUnplaced` “删掉或固定 0”尚未冻结；会导致不同公开 DTO。 | 条目表:425；`src/core/work-graph/views/track-read-model.ts:1024`；`tests/work-graph/S2B-activity-calendar.test.ts:260` | 保留两个现有公开字段，清掉旧来源后固定为 0；在本条明确该结果，删除“由 lead 决定删字段”的施工选项。 |
| TP-065 | “finalized 轮次必须有 finalizedAt”没有限定存储记录校验。共享的 snapshot 校验也校验事件中的公开 DTO，而公开 DTO 不带 wire-only finalizedAt。 | `src/core/work-graph/persistence/evidence-record-codecs.ts:329`、`:335`、`:342`、`:509` | 只在 `roundRecordProblem` 对存储记录强制 finalizedAt；不要把该要求加入同时校验事件 result 的 `roundSnapshotProblem`。 |
| TP-065 | 日历测试的删除范围容易连带删掉当前两个时段的 checks/task 断言；后半清单也引用同一片段。 | `tests/work-graph/S2B-activity-calendar.test.ts:235`、`:249`、`:253`、`:257` | 精确删除旧 runC/legacy round 准备及第 257–260 行的旧来源期望；保留第 249–256 行当前时段断言与第 261 行归属断言。同步 TP-090、TP-157 的范围。 |
| TP-067 | 末句仍允许施工时再决定是否收紧 work-line DTO，超出了已冻结的 mailbox 修改；另有两个注释文件不在白名单。 | 条目表:438；`src/contracts/core/session.ts:62`；`src/core/work-graph/state/message-machine.ts:166`、`:1333` | 删除末句可选扩展；本条只收紧 `UndeliveredReplyV1` 和 mailbox 输出，SessionRecord 的位置字段仍按当前语义可选；补齐两个文件。 |
| TP-071 | 要求共享的 `until` 是 sleep 轮询，直接违反 F9。 | `tests/app/S2B-backfill-host.test.ts:58`、`:63`；`tests/app/S2B-r2-backfill-real-kernel.test.ts:58`、`:63`；规则表:80 | 不新增共享 `until`；两处改用包装真实 backfill/Runtime 公共操作的 A3 完成闸门，闸门完成后做公开读断言。其余 deferred、viewOf、readPageToken 合并照做。 |
| TP-071 | 清单含简称和省略号，缺少实际 helper 所在文件；其中三个真实路径属于 T3。 | `.lead-ref/books/t-files-TP.txt:1`、`:121`；`tests/app/S2B-35-activity-routes.test.ts:108`；`tests/app/S2B-41-decision54-backfill-bound.test.ts:81`；`tests/app/S2B-backfill-host.test.ts:58` | 用下一节完整路径替换简称；补入 S2B-35、S2B-backfill-host；删除已经有完整条目的 done-cursor 简称，不新增重复行。 |
| TP-072 | 引用的 `runAndEnd` 仍手写 Runtime 入场和结束事实；R9 的 counter 也固定返回手造 facts。仅替换旧记录 seed 不满足转换规则。 | `tests/helpers/S2B-activity-fixture.ts:453`、`:471`、`:501`、`:508`；`tests/app/S2B-r2-backfill-done-cursor.test.ts:68`、`:95`；规则表:64、68 | 扩展真实 Runtime 夹具到至少 103 个工作任务。先通过真实执行及真实 backfill 形成 101 条已记录活动，再创建两个真实结束但尚未记录活动的候选；被测 backfill 使用真实 `countRunActivity`。删除固定 counter，不调用手写 enter/end helper。 |
| TP-072 | `claimThenCancel` 不能产生现有期望中的 counted 活动。真实 Runtime 对无 locator 的此类 Run 返回 not_entered 或 unknown。 | `tests/helpers/S2B-activity-fixture.ts:529`；`src/core/agent-runtime/runtime.ts:623`、`:627`、`:635`；`tests/app/S2B-r2-backfill-done-cursor.test.ts:101`、`:108` | 删除“两个候选可直接用 claimThenCancel”；两个候选都用真实进入并结束的 Run，保留两页 processed、done、next 及最终 counted 断言。 |
| TP-074 | 合并目标和源测试都由 TP-027 删除，不能再执行 merge。 | 条目表:175、487；`tests/scenarios/K-W-workflow-close.test.ts:487` | 改为“由 TP-027 吸收：删除 legacy-only 场景，不执行合并”，并在 ledger 同时标记 TP-027、TP-074。 |
| TP-076 | 指定的 267–277 行没有 `{closed, available}` 断言；实际在 279–280 行。指定 merge 目标只断言最终 Session 状态，不直接断言 close 返回形状。 | `tests/composition/K-R-close-open-turn.test.ts:267`、`:279`；`tests/scenarios/K-W-maintenance.test.ts:149`、`:153` | 动作明确改为删除第 219–226 行重复测试；覆盖分别写为 maintenance 的真实 RUN-19 状态断言和 composition 第 279–280 行的真实 close 返回形状断言，不再要求把返回形状断言搬进没有该返回值的目标。 |
| TP-080 | `f.createSession` 内部仍替 Runtime 调用 `recordSessionCreated`，不是规则表允许的转换终点。 | 条目表:529；`tests/helpers/task-claim-fixture.ts:318`、`:327`；规则表:64 | 在安装 role_spec 后通过真实 `Runtime.createSession` 创建 Session，再用返回 ref 认领任务；保留本条列出的四处调用方修改。不得把手工 registration 包装后称为公开转换。 |
| TP-081 | 明确要求调用 `recordExecutionEntered`，正是规则表明确拒绝的形式。 | 条目表:536；`tests/helpers/B2-execution-fixture.ts:297`；规则表:64、66 | 改为真实 Runtime prepare/start，使用脚本模型 A3 闸门停在真实 entered 后；从公开执行读取取得 currentRun、envelope，复用真实 manifest body。删除手写授权、history position 和 inputBinding 的准备路径。 |
| TP-083 | “公开 bootstrap 作为可选模式，默认保持现状”与 TP-107／108 要求共享夹具默认改成公开 bootstrap 冲突。 | 条目表:550、718、725；`tests/helpers/task-claim-fixture.ts:198`；`tests/helpers/S1-workflow-archive-fixture.ts:304` | 先完成 TP-107／108，使共享夹具统一使用公开 bootstrap；本条不再提供旧 seed 模式开关。clock、审计开关、底座工厂、非首 claim 的独立 Kernel 身份仍参数化并保留原调用方行为。 |
| TP-084 | 吸收条目的编号写成 F-03；实际是 TP-083／F-18。 | 条目表:549、557 | 改为“由 TP-083 合并吸收；合并后只处理仍存在的声明和 export，不再按原行号重复删除”。 |

**2．白名单补充及跨组冲突**

下表是缺失路径；路径后的行号同时给出修改依据。`T3:31` 表示该文件出现在 `.lead-ref/books/t-files-T3.txt:31`，其他组同理。“无”表示未出现在其他组白名单。

仅删除符号的外部 import/usage 可以适用总则第 31–32 行的编译例外；**新增必填字段、转换前置状态、修改断言、修改资源，不属于该例外**。下面的共享文件需要 lead 安排串行交接，不能继续按运行书第 5 行声称的互不重叠来并行施工。

| 文件及证据行 | 条目 | 其他组白名单 |
|---|---|---|
| `src/contracts/core/session.ts:36`、`:62` | TP-062、067 | 无 |
| `src/contracts/work-line.ts:60` | TP-062 | 无 |
| `src/core/work-graph/model/session-contracts.ts:63` | TP-062 | 无 |
| `src/core/work-graph/model/session-facts-contracts.ts:95` | TP-062 | 无 |
| `src/core/work-graph/queries/contracts.ts:233` | TP-062 | 无 |
| `src/core/work-graph/queries/query-execution.ts:335`、`:899`、`:933`、`:1079` | TP-015、052、054、062 | 无 |
| `src/core/work-graph/sessions/lifecycle-record-codecs.ts:98` | TP-062 | 无 |
| `src/core/work-graph/sessions/session-record-codecs.ts:736`、`:1030` | TP-062 | 无 |
| `src/core/work-graph/tasks/claim-service.ts:762` | TP-062 | 无 |
| `src/business/workflow/consultation.ts:141`、`:364` | TP-015、031 | 无 |
| `src/core/agent-runtime/query-execution.ts:186`、`:313` | TP-015、027 | 无 |
| `src/core/work-graph/tasks/planning-question-reader.ts:168` | TP-015 | 无 |
| `src/core/work-graph/tasks/request-facts-reader.ts:67` | TP-052 | 无 |
| `src/core/work-graph/views/graph-context-reader.ts:579`、`:914`、`:1143` | TP-052、061 | TQ:33 |
| `src/app/main.ts:153` | TP-027 | TQ:7 |
| `src/core/agent-runtime/project-source-tool.ts:237` | TP-026 | 无 |
| `src/core/work-graph/state/task-failure.ts:1180` | TP-025、045 | 无 |
| `src/core/work-graph/state/task-machine.ts:120` | TP-025、045 | T2:1 |
| `src/core/work-graph/tasks/completion.ts:390` | TP-025、045 | 无 |
| `src/core/work-graph/model/plan-contracts.ts:33` | TP-049 | 无 |
| `src/core/work-graph/tasks/plan-readers.ts:1347`、`:2277` | TP-061 | 无 |
| `src/core/work-graph/tasks/plan-task-basis.ts:106`、`:244` | TP-061 | 无 |
| `src/core/work-graph/tasks/evidence-coverage.ts:64` | TP-061 | 无 |
| `src/core/work-graph/state/message-machine.ts:166`、`:183`、`:309`、`:1120`、`:1202`、`:1333` | TP-031、067 | 无 |
| `src/app/collaboration-driver.ts:439`、`:665`、`:671` | TP-031 | 无 |
| `src/app/host.ts:1224` | TP-031 | TQ:6 |
| `src/contracts/core/session-message.ts:37` | TP-031 | 无 |
| `src/core/agent-runtime/execution-control.ts:84` | TP-031，旧字段注释 | 无 |
| `src/core/agent-runtime/execution-inputs.ts:128` | TP-031 | 无 |
| `src/core/work-graph/model/tool-commit-arguments.ts:28`、`:98` | TP-031 | TQ:22 |
| `src/core/work-graph/sessions/message-record-codecs.ts:721`、`:780`、`:781` | TP-031 | 无 |
| `src/ui/views/execution/panel.ts:36` | TP-031 | 无 |
| `resources/skills/platform-work/content.md:24` | TP-031 | 无 |
| `runtime-assets.json:47` | TP-031 | 无 |
| `tests/business/K3-46-review-advance-failures.test.ts:241`、`:736` | TP-004、006 | T3:31 |
| `tests/business/K3-UR7-crr-failed-set.test.ts:281`、`:388`、`:445` | TP-004、006 | T3:32 |
| `tests/helpers/K3-blocked-command-fixture.ts:499` | TP-006 | T3:63 |
| `tests/helpers/K3-review-card-fixture.ts:315` | TP-006 | T3:67 |
| `tests/helpers/S5R2-b-support.ts:139` | TP-006 | 无 |
| `tests/state/S1-session-archive.test.ts:194`、`:204`、`:212` | TP-062 | T2:53 |
| `tests/work-graph/S1-provenance.test.ts:43`、`:238`、`:406` | TP-062 | T1:35 |
| `tests/helpers/S2A-planning-fixture.ts:74` | TP-009、054 | 无 |
| `tests/helpers/S2C-L-runs-support.ts:136`、`:420` | TP-009、054 | 无 |
| `tests/helpers/S2C-X-scale-fixture.ts:152` | TP-009、054 | T1:3 |
| `tests/helpers/WP1-units-fixture.ts:377`、`:509` | TP-014、051、054 | T3:82 |
| `tests/helpers/WP2-duties-fixture.ts:159` | TP-009、054 | T3:83 |
| `tests/helpers/WP2-notices-fixture.ts:198` | TP-009、054 | 无 |
| `tests/work-graph/S5-goal-settings.test.ts:280` | TP-009、054 | 无 |
| `tests/state/invariants.ts:36`、`:112`、`:1890`、`:1949` | TP-011、025、045、048 | 无 |
| `tests/helpers/S2B-r2-activity-support.ts:13`、`:43` | TP-011、048 | 无 |
| `tests/app/A2-startup-redrive-select.test.ts:34` | TP-014、051 | 无 |
| `tests/business/A2-workflow-auto-rework.test.ts:53` | TP-014、051 | T3:27 |
| `tests/business/A2-workflow-disposition.test.ts:33` | TP-014、051 | 无 |
| `tests/business/A2-workflow-reverify.test.ts:51` | TP-014、051 | 无 |
| `tests/business/S1-task-order.test.ts:77` | TP-014、051 | 无 |
| `tests/runtime/S3-context-assembler.test.ts:100`、`:239` | TP-014、051、062 | T2:27 |
| `tests/work-graph/material-readers.test.ts:21` | TP-014、051 | T1:75 |
| `tests/work-graph/R3b-material-applicability.test.ts:25` | TP-014、051 | T1:26 |
| `tests/work-graph/R4b-session-directory.test.ts:108`、`:118` | TP-014、050、051 | T1:32 |
| `tests/app/R6-workbench.test.ts:176` | TP-062 | T3:6 |
| `tests/state/S1-responsibility.test.ts:40` | TP-062 | 无 |
| `tests/state/WP2-positions.test.ts:56`、`:76` | TP-031、062 | 无 |
| `tests/work-graph/R4b-session-boundaries.test.ts:198`、`:239` | TP-062 | T1:31 |
| `tests/work-graph/S1-codecs-indexes.test.ts:166` | TP-062 | T1:34 |
| `tests/data/project-source-snapshot.test.ts:2` | TP-026 | 无 |
| `tests/data/typescript-source-reuse.test.ts:2` | TP-026 | 无 |
| `tests/data/cpp-source-index.test.ts:148` | TP-028 | 无 |
| `tests/app/AG6-agent-assembly.test.ts:192` | TP-028 | 无 |
| `tests/runtime/B1-kernel-assembly.test.ts:188` | TP-028 | 无 |
| `tests/runtime/R4c-execution-history.test.ts:101` | TP-028 | T2:25 |
| `tests/runtime/R4c-session-continuity.test.ts:65` | TP-028 | 无 |
| `tests/runtime/source-text-loop-migration.test.ts:185` | TP-028 | 无 |
| `tests/runtime/W2-role-skills.test.ts:144` | TP-028 | 无 |
| `tests/state/task-machine.test.ts:59`、`:1350` | TP-025、045 | T2:59 |
| `tests/work-graph/A2-gate-chain-facts.test.ts:218` | TP-025、045 | T1:10 |
| `tests/work-graph/R3e-reverify.test.ts:320`、`:467` | TP-025、045 | T1:29 |
| `tests/state/unknown-call-review.test.ts:30`、`:157` | TP-058 | 无 |
| `tests/work-graph/K3-45-review-incomplete.test.ts:20`、`:114` | TP-058 | T1:23 |
| `tests/app/S2B-35-activity-routes.test.ts:108` | TP-071 | T3:10 |
| `tests/app/S2B-41-decision54-backfill-bound.test.ts:81` | TP-071 | T3:11 |
| `tests/app/S2B-backfill-host.test.ts:58` | TP-071 | T3:12 |
| `tests/app/S2B-backfill-workflow.test.ts:91` | TP-071 | 无 |
| `tests/app/S2B-be2-late-evidence-activity.test.ts:40` | TP-071 | 无 |
| `tests/app/S2B-be2-run23-activity.test.ts:35` | TP-071 | 无 |
| `tests/app/S2B-be2-startup-reconcile-activity.test.ts:41` | TP-071 | 无 |
| `tests/app/S2B-r2-backfill-identity.test.ts:52` | TP-071 | 无 |
| `tests/app/S2B-r2-backfill-probe-first.test.ts:32` | TP-071 | 无 |
| `tests/app/S2B-r2-backfill-real-kernel.test.ts:58`、`:67`、`:75` | TP-071 | 无 |
| `tests/app/S2B-r2-backfill-revision-race.test.ts:31` | TP-071 | 无 |
| `tests/app/S2B-r2-r6-probe-verdicts.test.ts:29` | TP-071 | 无 |
| `tests/app/AG2b-collaboration.test.ts:80`、`:167`、`:169`、`:390`、`:487` | TP-031 | T3:4 |
| `tests/app/orchestration-mechanism.test.ts:111`、`:181`、`:183`、`:185`、`:469` | TP-031 | T3:21 |
| `tests/app/S5-decision-routes.test.ts:269` | TP-031 | T3:14 |
| `tests/composition/WP2-wiring.test.ts:871` | TP-031 | T3:42 |
| `tests/runtime/S1-routed-replies.test.ts:36` | TP-031 | 无 |
| `tests/scenarios/support/fuzz.ts:413`、`:620`、`:697`、`:1948` | TP-031 | 无 |
| `tests/scenarios/A11-no-progress.test.ts:648` | TP-031 | 无 |
| `tests/scenarios/A7-control.test.ts:458` | TP-031 | T1:5 |
| `tests/scenarios/A8-host-restart.test.ts:162`、`:232`、`:575` | TP-031 | 无 |
| `tests/scenarios/C3-reply-other-session.test.ts:59`、`:79` | TP-031 | 无 |
| `tests/scenarios/C7-defer-reactivate.test.ts:415` | TP-031 | 无 |
| `tests/scenarios/K3-26-inventory-scenarios.test.ts:275` | TP-031 | 无 |
| `tests/scenarios/K3-R1-restart-flows.test.ts:82`、`:92`、`:117` | TP-031 | 无 |
| `tests/scenarios/K3-r1-seams.test.ts:170` | TP-031 | T2:41 |
| `tests/scenarios/K3-R1-session-not-closable.test.ts:75` | TP-031 | 无 |
| `tests/scenarios/S1-wait-copy-retirement.test.ts:63`、`:65`、`:81`、`:118`、`:119` | TP-031 | 无 |
| `tests/scenarios/S3-query-graph.test.ts:388` | TP-031 | T2:44 |
| `tests/scenarios/WP2-wiring-scenario.test.ts:167` | TP-031 | 无 |
| `tests/state/message-machine.test.ts:161`、`:598`、`:599`、`:628`、`:815`、`:895`、`:943`、`:945`、`:946`、`:951` | TP-031 | 无 |
| `tests/state/S5-message-decision.test.ts:115`、`:235`、`:292` | TP-031 | 无 |
| `tests/work-graph/K3-47-continuation-gate.test.ts:144` | TP-031 | 无 |
| `tests/work-graph/S2B-r2-s-yielded.test.ts:38` | TP-031 | 无 |
| `tests/composition/R3c-R4b-platform.test.ts:55` | TP-050 | T3:36 |
| `tests/helpers/graph-session-fixture.ts:444` | TP-050 | TQ:50 |
| `tests/helpers/S2C-D-node-support.ts:269` | TP-050 | T3:73 |
| `tests/helpers/S4A-note-fixture.ts:204` | TP-050 | 无 |
| `tests/helpers/S4A-note-scope-fixture.ts:196`、`:223` | TP-050 | 无 |
| `tests/helpers/S4B-memory-fixture.ts:64` | TP-050 | 无 |
| `tests/helpers/S4B-note-multi-scope-fixture.ts:84` | TP-050 | T1:4 |
| `tests/helpers/S8A-L8-reminder-world.ts:424` | TP-050 | T3:76 |
| `tests/helpers/WP1-handover-fixture.ts:450` | TP-050 | T3:80 |
| `tests/helpers/WP2-platform-support.ts:288`、`:621` | TP-050 | T3:84 |
| `tests/work-graph/R3c-canonical-task-state.test.ts:23` | TP-050 | 无 |
| `tests/work-graph/S2C-lines-attention.test.ts:133` | TP-050 | T1:37 |
| `tests/work-graph/S4C-note-related-find.test.ts:75` | TP-050 | 无 |
| `tests/work-graph/S4C-related-scope.test.ts:119` | TP-050 | 无 |
| `tests/work-graph/S4C2-goal-triggers.test.ts:48` | TP-050 | T1:61 |
| `tests/work-graph/S4C2-read-counts.test.ts:240` | TP-050 | 无 |
| `tests/work-graph/S4C2-rework-staleness.test.ts:270` | TP-050 | 无 |
| `tests/work-graph/S4C2-update-due-fold.test.ts:23` | TP-050 | 无 |
| `tests/work-graph/S8A-L8-chunk-scope.test.ts:150` | TP-050 | 无 |
| `tests/work-graph/R3c-task-relations-boundaries.test.ts:30`、`:88`、`:98` | TP-050 | 无 |

调用方核对还区分了以下无需机械扩大的地方：

- `ReviewPlan.draft` 已直接引用 `PlanRevisionDraft`，修改公共类型后会自然收紧；不需要仅为这一点改 TQ 的 `core-http-types.ts`。证据：`src/app/core-http-types.ts:730`、`:733`。
- Query 当前两个生产 writer 已提供 execution；这两处写入本身不需要补字段。证据：`src/ui/views/execution/query-flow.ts:96`、`src/business/workflow/consultation.ts:440`。
- `ProjectSourceAccess` 的 capture 和 architecture 使用方已经从目标模块导入，不需要迁移它们的导入。证据：`src/core/workspace/capture.ts:7`、`src/core/workspace/architecture-language-provider.ts:18`。
- TP-013、TP-017、TP-057 的删除对象没有实际消费者；检索只找到定义及可达性名单。证据：`src/contracts/human-role-collaboration.ts:73`、`src/contracts/role-spec.ts:154`、`src/core/work-graph/state/unknown-call-review.ts:37`；可达性名单:378、420、1086。
- TP-058 的生产命中 `unknown-call-review.ts:268` 是错误标签字符串，不是类型消费者，不能把字符串当成漏改的类型引用。证据：`src/core/work-graph/state/unknown-call-review.ts:268`。
- TP-059 不要求改 `attemptNodeOf` 的投影代码；本条收紧的是 ended 记录允许的输入，现有正常结束仍由非空 outcome 写入。证据：`src/core/work-graph/state/attempt-machine.ts:88`、`:310`、`:318`。
- TP-064／066 提到的现有测试没有证明 Query 的 `ca` 游标续页；不能把 Work 轨道续页当成该覆盖。不过条目没有要求新增测试，本次不据此扩项。证据：`tests/work-graph/S2B-r2-r3-track-pagination.test.ts:57`、`:73`；`tests/work-graph/S2B-r3-consultation-cap.test.ts:51`、`:61`。

**3．必须同批或按顺序执行**

| 条目组合 | 固定顺序或同批要求 | 依据 |
|---|---|---|
| TP-001、005 | 同一删除只执行一次；保留未知 kind 拒绝断言。 | 条目表:5、32；`tests/composition/platform.test.ts:79` |
| TP-002、008 | 同一批合同头注释清理，只执行一次。 | 条目表:12、53 |
| TP-003、040、041 | 同批改 outbox 别名、移除 V1 别名、更新测试导入；不能先留下悬空类型。 | `src/core/work-graph/model/claim-contracts.ts:92`、`:105`；条目表:257 |
| TP-007、062、122、126 | 同批清理 provenance/backfill；先固定保留的 execution 列表场景，再删除 legacy 场景。 | 条目表:47、404、823、851；`tests/scenarios/S2C-K-legacy-provenance.test.ts:482` |
| TP-009、054、081，以及相关 manifest helper 转换 | 先使真实 prepare/Runtime 前置可用，再将 contextAssembly 改为必填；同批撤销旧 manifest 路径。 | `tests/helpers/C1-mailbox-fixture.ts:142`；`src/contracts/core/prepared-execution.ts:205`；条目表:349 |
| TP-010 | 未冻结前保持 BLOCKED；不得作为 TP-009／054 的隐含删除。 | 条目表:67；总则:22 |
| TP-011、048、055、060、129、133、143 | V1 类型、codec、状态机、收窄和旧用例同批；保留 malformed V2 与 D7 无绑定 Ended。 | 条目表:309、356、390、977 |
| TP-014、051、139 | 创建器、创建事件重放、codec、下游 fallback 和夹具迁移同批。 | `src/core/work-graph/persistence/record-codecs.ts:850`；条目表:330 |
| TP-015、052、030、118 | 先保证 Query 提交产生 execution 和 submission，再移除来源扫描回退；TP-030 的状态变化子场景仍需补冻结路径。 | `src/core/agent-runtime/source-capture-access.ts:646`；条目表:101、337、795 |
| TP-025、045、137、138、140 | 先固定当前根轮次夹具和旧根用例范围，再收紧 chain；不能删除仍被 lookup 场景调用的 helper。 | `tests/work-graph/A2-step1-codecs.test.ts:397`；条目表:935 |
| TP-026、056、119 | 共用 observed-model-run 和工具生命周期范围；先迁移保留的 analyzer 断言及类型，再删旧实现。 | `src/core/agent-runtime/observed-model-run.ts:303`、`:323`；条目表:168、363、802 |
| TP-027、074、111 | TP-074 由 TP-027 吸收，不能寻找已删除目标执行 merge；保留 helper 的 absent 模式。 | 条目表:175、487；`tests/scenarios/K-W-workflow-close.test.ts:524` |
| TP-031、068 | 显式通信输入、记录字段、读取方、技能文本及 hash 同批。 | 条目表:202、445；`runtime-assets.json:47` |
| TP-046、141 | 使用同一精确删除范围：删 @0 seed，保留当前追加断言。 | `tests/work-graph/A2-verification-chain.test.ts:284`、`:288`；条目表:956 |
| TP-049、050、061、132 | legacy proposal 清理与 Plan V2 收紧协调完成；TP-061 不能先于 V2 类型及 writer 修改。 | 条目表:316、323、397、893 |
| TP-012、063、085、153、166、167 | 通知位置、legacy 索引、helper 和测试同批；NR05 索引及 NR08 当前 cap 回读必须一起修正。 | 条目表:81、411、564、1131、1138 |
| TP-064、066 | 同一 ca decoder 修改，只执行一次。 | `src/core/work-graph/views/track-read-model.ts:224`；条目表:418、432 |
| TP-065、090、093、097、157 | 先固定记录层 finalizedAt 要求和当前测试保留范围，再删除旧索引、旧扫描与 helper。 | `src/core/work-graph/persistence/evidence-record-codecs.ts:335`、`:509`；条目表:425 |
| TP-071、072、091、096 | 共享 helper 合并不得先固化旧轮询和手写入场路径；R9 真实前置完成后再删 seedLegacyActivity。 | `tests/helpers/S2B-activity-fixture.ts:471`、`:508`；条目表:466、473、606 |
| TP-073、098、161 | 合并 route equality 断言时同步采用去掉 legacy L 后的 D1 数据集名称和数量。 | `tests/app/S2C-line-routes.test.ts:299`；条目表:480、655、1096 |
| TP-080、092 | B2 Runtime 的真实 Session 创建先完成，再合并 S2B 副本，四处依赖默认 Session 的调用方一起改。 | 条目表:529、613 |
| TP-107／108 → TP-083 → TP-084 | 先统一公开 bootstrap，再合并共享夹具，最后清理仍存在的死声明/export。 | 条目表:550、557、718、725 |
| TP-086 与 S5 fixture 合并项 | bootstrap 事件 schema 登记必须随最终保留的 S5 fixture 一起保留；不能在随后 helper 合并时丢掉。 | `tests/helpers/S5-decision-fixture.ts:440`；条目表:571 |

**4．总则和运行书问题**

| 位置 | 问题 | 唯一改法 |
|---|---|---|
| 总则:22；条目表:67、161、425、438 | “动作最终”与多条仍要求 lead 再决定的动作冲突。 | 在交付 DSH 前冻结这些分支；尚未冻结的子项明确标 BLOCKED，禁止 DSH 选择。 |
| 总则:30；运行书:5 | 白名单与真实修改范围不一致；新增范围会与 T1、T2、T3、TQ 多处重叠。 | 将本报告逐文件清单并入施工范围，并为共享文件安排串行交接；删除“互不重叠”的笼统声明。 |
| 总则:39；条目表:411、1131 | “保留断言和期望值原样”没有容纳 NR05 删除前一项后必须发生的索引调整。 | 在 TP-063／166 显式授权 `items[1] → items[0]`，仅改变定位下标，保留比较内容。 |
| 总则:47、48、65；条目表:466、473、529、536 | named public helper 被错误当成当然合规：这些 helper 仍有 sleep、手写 Runtime/Host 事实。 | 在总则转换规则后补一句：是否公开以规则表允许形式为准，调用公开名称的 owner 写方法不豁免 F3；上述条目按本报告修正。 |
| 总则:85；条目表:202 | 提交命令只暂存 `src tests scripts`，会漏掉 TP-031 的技能文本和 `runtime-assets.json`。 | 暂存路径明确加入 `resources/skills/platform-work/content.md runtime-assets.json`，仍排除 `.dsh-ref/`。 |
| `.lead-ref/books/t-files-TP.txt:1` 至 `:10`、`:121`、`:125` | 十个简称、一个省略号路径及 `production-reach-allowlist.js` 不是基线中的实际文件。 | 用本报告列出的真实 `.test.ts` 路径替换；done-cursor 已有完整路径，删除其简称；删除不存在的 `.js` 项，保留实际 `.json` 项。 |
| 条目表:356、390、397、557 | 旧 finding 编号交叉引用发生串项：P2a-06 指向 Goal，P2a-03 指向授权，F-03 不是归档 fixture 合并。 | 分别改为 TP-011／048、TP-049／050、TP-083，后续依赖统一使用 TP 编号。 |

**5．同一批问题的 JSON**

`files_add` 按实际实施条目归属列出；被明确吸收的重复条目不重复列文件。

```json
[
  {
    "id": "TP-001",
    "problem": "删除 N0 测试会同时丢失仍存在的未知 kind unsupported 拒绝覆盖。",
    "fix": "删除 N0 专用代码，把现有拒绝测试输入改为非 N0 的未知 kind，保留 unsupported 断言；与 TP-005 合并执行一次。",
    "files_add": []
  },
  {
    "id": "TP-005",
    "problem": "重复 TP-001，且同样会删除未知 kind 的当前拒绝覆盖。",
    "fix": "由修正后的 TP-001 吸收，不再次删除测试。",
    "files_add": []
  },
  {
    "id": "TP-003",
    "problem": "保留 outbox 断言与整条 it 可删两种指令冲突。",
    "fix": "与 TP-040 同批，只删除 V1 别名相关导入及第 708、709、711、712 行，保留第 706、707、710 行。",
    "files_add": []
  },
  {
    "id": "TP-004",
    "problem": "删除字段类型后，三处点访问断言需要同步改写，文件属于 T3。",
    "fix": "三处改用 not.toHaveProperty('failedReviewRefs')，保留公共拒绝断言并安排 T3 串行交接。",
    "files_add": [
      "tests/business/K3-46-review-advance-failures.test.ts",
      "tests/business/K3-UR7-crr-failed-set.test.ts"
    ]
  },
  {
    "id": "TP-006",
    "problem": "外部 Workflow 装配遗漏白名单；部分 sources 仍被 decision service 使用。",
    "fix": "删除 Workflow 的 decisionSources 参数及专用构造，保留 K3-review-card-fixture 中传给 decision service 的 sources。",
    "files_add": [
      "tests/business/K3-46-review-advance-failures.test.ts",
      "tests/business/K3-UR7-crr-failed-set.test.ts",
      "tests/helpers/K3-blocked-command-fixture.ts",
      "tests/helpers/K3-review-card-fixture.ts",
      "tests/helpers/S5R2-b-support.ts"
    ]
  },
  {
    "id": "TP-009",
    "problem": "合法 binding 构造器仍允许手造 accepted manifest/binding，不符合 F1、F3。",
    "fix": "删除构造器选项，统一真实 prepare；由 TP-054 吸收实施。",
    "files_add": []
  },
  {
    "id": "TP-010",
    "problem": "lead rules first、if accepted 表明删除决定尚未冻结。",
    "fix": "标为 BLOCKED，待 lead 冻结 manifest selectedTaskInputs 删除范围及规格后注；不得连带删除 TaskInputPage 字段。",
    "files_add": []
  },
  {
    "id": "TP-011",
    "problem": "版本收窄清单使用约数并误列 collaboration-driver，无授权 running 范围也未固定。",
    "fix": "采用 TP-048、055、060 的明确清单；删除 collaboration-driver 的本主题修改要求；保留 D7 无绑定 Ended。",
    "files_add": []
  },
  {
    "id": "TP-014",
    "problem": "Goal 必填字段修改遗漏当前 Goal 构造方。",
    "fix": "由 TP-051 合并实施，覆盖创建事件重建和所有列明构造方，保留当前 Goal 行为断言。",
    "files_add": []
  },
  {
    "id": "TP-015",
    "problem": "execution 必填修改涉及四个白名单外生产读取文件。",
    "fix": "补齐范围，删除缺 execution 分支及对应可选读取，保留 consultation 自身的可选语义。",
    "files_add": [
      "src/business/workflow/consultation.ts",
      "src/core/agent-runtime/query-execution.ts",
      "src/core/work-graph/queries/query-execution.ts",
      "src/core/work-graph/tasks/planning-question-reader.ts"
    ]
  },
  {
    "id": "TP-016",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定 decision 6/B01 前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-018",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-019",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-020",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-021",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-022",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-023",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-024",
    "problem": "RoleSpecInstalledEvent 的 note 没有可保留的测试清单。",
    "fix": "只修改该项 note，使用指定新前缀并保留 only reached from RoleConfigurationPort.installRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-025",
    "problem": "两个旧根相关测试仍由施工者决定删改，涉及不同当前坏链与槽冲突断言。",
    "fix": "该子项标 BLOCKED，lead 逐项冻结 VD-1、VD-15、GAP-52、P10、P20 的当前输入和保留断言；其余明确转换按 TP-045 同批执行。",
    "files_add": []
  },
  {
    "id": "TP-026",
    "problem": "类型迁移重复目标已有 ProjectSourceAccess，遗漏动态类型导入、analyzer 覆盖、生命周期断言迁移和旧工具说明。",
    "fix": "保留已有 ProjectSourceAccess，仅迁移 ProjectSourceQuery；改两个动态导入；迁移 include、别名、72 文件及跨文件分析断言；用 Python dispose 迁移当前生命周期断言；删除 project_index 说明。",
    "files_add": [
      "src/core/agent-runtime/project-source-tool.ts",
      "tests/data/project-source-snapshot.test.ts",
      "tests/data/typescript-source-reuse.test.ts"
    ]
  },
  {
    "id": "TP-027",
    "problem": "已点名启动与 Query 守卫文件不在白名单，且 TP-074 仍要求合并待删除目标。",
    "fix": "补齐两个文件并与 TQ 串行交接；TP-074 由本条删除动作吸收。",
    "files_add": [
      "src/app/main.ts",
      "src/core/agent-runtime/query-execution.ts"
    ]
  },
  {
    "id": "TP-028",
    "problem": "七个需要补 taskBudget 的测试文件不在白名单。",
    "fix": "补齐文件，缺省调用显式传 tokenBudget:null、deadline:null，保留映射期望。",
    "files_add": [
      "tests/app/AG6-agent-assembly.test.ts",
      "tests/runtime/B1-kernel-assembly.test.ts",
      "tests/runtime/R4c-execution-history.test.ts",
      "tests/runtime/R4c-session-continuity.test.ts",
      "tests/runtime/source-text-loop-migration.test.ts",
      "tests/runtime/W2-role-skills.test.ts",
      "tests/data/cpp-source-index.test.ts"
    ]
  },
  {
    "id": "TP-030",
    "problem": "保留的 changed current execution 测试仍靠改写事实，真实 Query 准备不能替代该步骤。",
    "fix": "将该子场景标 BLOCKED，待 lead 给出触发同一再校验分支的合规公开步骤；不得保留 state.set 或自行删除断言。",
    "files_add": []
  },
  {
    "id": "TP-031",
    "problem": "replyMode 全链清理缺少可施工文件清单，遗漏多个组外生产文件、测试、技能及资源 hash。",
    "fix": "纳入全部列明文件；旧 wait 调用改为 inquiry/true/true；删除字段、codec 与回退，保留 fire-and-forget 行为，同步技能及 SHA256。",
    "files_add": [
      "src/app/collaboration-driver.ts",
      "src/app/host.ts",
      "src/business/workflow/consultation.ts",
      "src/contracts/core/session-message.ts",
      "src/core/agent-runtime/execution-control.ts",
      "src/core/agent-runtime/execution-inputs.ts",
      "src/core/work-graph/model/tool-commit-arguments.ts",
      "src/core/work-graph/sessions/message-record-codecs.ts",
      "src/core/work-graph/state/message-machine.ts",
      "src/ui/views/execution/panel.ts",
      "resources/skills/platform-work/content.md",
      "runtime-assets.json",
      "tests/app/AG2b-collaboration.test.ts",
      "tests/app/orchestration-mechanism.test.ts",
      "tests/app/S5-decision-routes.test.ts",
      "tests/composition/WP2-wiring.test.ts",
      "tests/runtime/S1-routed-replies.test.ts",
      "tests/scenarios/support/fuzz.ts",
      "tests/scenarios/A11-no-progress.test.ts",
      "tests/scenarios/A7-control.test.ts",
      "tests/scenarios/A8-host-restart.test.ts",
      "tests/scenarios/C3-reply-other-session.test.ts",
      "tests/scenarios/C7-defer-reactivate.test.ts",
      "tests/scenarios/K3-26-inventory-scenarios.test.ts",
      "tests/scenarios/K3-R1-restart-flows.test.ts",
      "tests/scenarios/K3-r1-seams.test.ts",
      "tests/scenarios/K3-R1-session-not-closable.test.ts",
      "tests/scenarios/S1-wait-copy-retirement.test.ts",
      "tests/scenarios/S3-query-graph.test.ts",
      "tests/scenarios/WP2-wiring-scenario.test.ts",
      "tests/state/message-machine.test.ts",
      "tests/state/S5-message-decision.test.ts",
      "tests/state/WP2-positions.test.ts",
      "tests/work-graph/K3-47-continuation-gate.test.ts",
      "tests/work-graph/S2B-r2-s-yielded.test.ts"
    ]
  },
  {
    "id": "TP-032",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 installRoleSpec、activateRoleSpec 两个入口可达说明。",
    "files_add": []
  },
  {
    "id": "TP-033",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-034",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-035",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 installRoleSpec、activateRoleSpec 两个入口可达说明。",
    "files_add": []
  },
  {
    "id": "TP-036",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-037",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-038",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-039",
    "problem": "目标 note 没有可保留的测试清单。",
    "fix": "使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。",
    "files_add": []
  },
  {
    "id": "TP-041",
    "problem": "整条测试可删与 TP-003 的 outbox 断言保留要求冲突。",
    "fix": "删除整条测试可删的选项，由 TP-003、040 同批吸收。",
    "files_add": []
  },
  {
    "id": "TP-045",
    "problem": "删除 legacyRound 会破坏保留的 lookup 场景，chain 迁移还遗漏组外文件。",
    "fix": "将 helper 改为当前 rootChain，保留缺 incompleteCause 和 lookup 断言；只删无 chain 兼容测试；补齐迁移范围。",
    "files_add": [
      "src/core/work-graph/state/task-failure.ts",
      "src/core/work-graph/state/task-machine.ts",
      "src/core/work-graph/tasks/completion.ts",
      "tests/state/task-machine.test.ts",
      "tests/state/invariants.ts",
      "tests/work-graph/A2-gate-chain-facts.test.ts",
      "tests/work-graph/R3e-reverify.test.ts"
    ]
  },
  {
    "id": "TP-046",
    "problem": "删除 284–296 会丢失当前证据追加断言，与 TP-141 冲突。",
    "fix": "仅删 @0 seed，保留 gateIndexRef 和 288–296，从不存在的 index 开始验证追加。",
    "files_add": []
  },
  {
    "id": "TP-048",
    "problem": "遗漏外部 V1 类型使用，保留的 malformed V2 仍依赖 legacy 变量。",
    "fix": "清理两个外部 V1 类型路径；malformed V2 使用当前 V2 前置状态，保留拒绝断言和 D7 Ended。",
    "files_add": [
      "tests/state/invariants.ts",
      "tests/helpers/S2B-r2-activity-support.ts"
    ]
  },
  {
    "id": "TP-049",
    "problem": "LegacyPlanProposal 转出文件遗漏白名单。",
    "fix": "将 model/plan-contracts.ts 纳入范围并随类型、codec、状态机分支同批清理。",
    "files_add": [
      "src/core/work-graph/model/plan-contracts.ts"
    ]
  },
  {
    "id": "TP-050",
    "problem": "V1 迁移遗漏快照与组外构造方，并与 TP-132 保留 V1 草稿冲突。",
    "fix": "当前草稿和快照统一迁至 V2；补当前快照字段，保留 V2 边界断言；吸收 TP-132 的版本部分，撤掉保留 V1 草稿指令。",
    "files_add": [
      "tests/composition/R3c-R4b-platform.test.ts",
      "tests/helpers/graph-session-fixture.ts",
      "tests/helpers/S2C-D-node-support.ts",
      "tests/helpers/S4A-note-fixture.ts",
      "tests/helpers/S4A-note-scope-fixture.ts",
      "tests/helpers/S4B-memory-fixture.ts",
      "tests/helpers/S4B-note-multi-scope-fixture.ts",
      "tests/helpers/S8A-L8-reminder-world.ts",
      "tests/helpers/WP1-handover-fixture.ts",
      "tests/helpers/WP2-platform-support.ts",
      "tests/work-graph/R3c-canonical-task-state.test.ts",
      "tests/work-graph/R4b-session-directory.test.ts",
      "tests/work-graph/S2C-lines-attention.test.ts",
      "tests/work-graph/S4C-note-related-find.test.ts",
      "tests/work-graph/S4C-related-scope.test.ts",
      "tests/work-graph/S4C2-goal-triggers.test.ts",
      "tests/work-graph/S4C2-read-counts.test.ts",
      "tests/work-graph/S4C2-rework-staleness.test.ts",
      "tests/work-graph/S4C2-update-due-fold.test.ts",
      "tests/work-graph/S8A-L8-chunk-scope.test.ts",
      "tests/work-graph/R3c-task-relations-boundaries.test.ts"
    ]
  },
  {
    "id": "TP-051",
    "problem": "Goal 必填字段迁移遗漏十个组外构造文件。",
    "fix": "吸收 TP-014；创建器、事件重建、codec 和构造方同批迁移；纯初始输入写 1/null，平台前置用真实 createGoal。",
    "files_add": [
      "tests/app/A2-startup-redrive-select.test.ts",
      "tests/business/A2-workflow-auto-rework.test.ts",
      "tests/business/A2-workflow-disposition.test.ts",
      "tests/business/A2-workflow-reverify.test.ts",
      "tests/business/S1-task-order.test.ts",
      "tests/helpers/WP1-units-fixture.ts",
      "tests/runtime/S3-context-assembler.test.ts",
      "tests/work-graph/material-readers.test.ts",
      "tests/work-graph/R3b-material-applicability.test.ts",
      "tests/work-graph/R4b-session-directory.test.ts"
    ]
  },
  {
    "id": "TP-052",
    "problem": "三个已点名的 submission 读取文件不在白名单。",
    "fix": "补齐文件并与 TP-030 同批，删除缺 locator 回退，保留精确读取失败语义。",
    "files_add": [
      "src/core/work-graph/queries/query-execution.ts",
      "src/core/work-graph/tasks/request-facts-reader.ts",
      "src/core/work-graph/views/graph-context-reader.ts"
    ]
  },
  {
    "id": "TP-054",
    "problem": "允许手造 binding，且遗漏七个 manifest 构造文件及 Query 执行文件。",
    "fix": "吸收 TP-009，统一真实 Task/Query prepare；共享 helper 不接收 prepared/binding；补齐全部构造方。",
    "files_add": [
      "src/core/work-graph/queries/query-execution.ts",
      "tests/helpers/S2A-planning-fixture.ts",
      "tests/helpers/S2C-L-runs-support.ts",
      "tests/helpers/S2C-X-scale-fixture.ts",
      "tests/helpers/WP1-units-fixture.ts",
      "tests/helpers/WP2-duties-fixture.ts",
      "tests/helpers/WP2-notices-fixture.ts",
      "tests/work-graph/S5-goal-settings.test.ts"
    ]
  },
  {
    "id": "TP-055",
    "problem": "同批依赖指错 Goal 条目，删除行号 414 实为当前无 outcome 断言。",
    "fix": "依赖改 TP-011、048；删除 task-failure 第 404、412 行，保留第 413–414 行。",
    "files_add": []
  },
  {
    "id": "TP-058",
    "problem": "两个已点名的外部别名使用文件不在 TP 白名单。",
    "fix": "四处改用 UnknownCallReviewEventV1，保留状态机断言，并与 T1 串行交接。",
    "files_add": [
      "tests/state/unknown-call-review.test.ts",
      "tests/work-graph/K3-45-review-incomplete.test.ts"
    ]
  },
  {
    "id": "TP-060",
    "problem": "同批依赖 P2a-06 指向 Goal 字段而非授权 V1。",
    "fix": "依赖改为 TP-011、048，列明的全部收窄随 V1 退出同批清理。",
    "files_add": []
  },
  {
    "id": "TP-061",
    "problem": "前置条件误指授权 V1，且遗漏四个生产读取文件。",
    "fix": "前置改 TP-049、050；补齐读取文件，保留 taskStateBasis 缺省为自身。",
    "files_add": [
      "src/core/work-graph/tasks/plan-readers.ts",
      "src/core/work-graph/tasks/plan-task-basis.ts",
      "src/core/work-graph/tasks/evidence-coverage.ts",
      "src/core/work-graph/views/graph-context-reader.ts"
    ]
  },
  {
    "id": "TP-062",
    "problem": "整文件删除与 TP-007 冲突；漏 claim-service 调用链、Session codec、直接 backfill 测试及当前 Session 构造方；必填仍未排除 null。",
    "fix": "保留并转换 execution 列表场景；claim 直接读取当前 provenance 并保留 readonly_copy 拒绝；provenance 改为非空，codec 不补 null；保留创建输入省略时生成 new；逐项删除 legacy 测试并迁移当前构造方，TP-122 同步。",
    "files_add": [
      "src/contracts/core/session.ts",
      "src/contracts/work-line.ts",
      "src/core/work-graph/model/session-contracts.ts",
      "src/core/work-graph/model/session-facts-contracts.ts",
      "src/core/work-graph/queries/contracts.ts",
      "src/core/work-graph/queries/query-execution.ts",
      "src/core/work-graph/sessions/lifecycle-record-codecs.ts",
      "src/core/work-graph/sessions/session-record-codecs.ts",
      "src/core/work-graph/tasks/claim-service.ts",
      "tests/state/S1-session-archive.test.ts",
      "tests/work-graph/S1-provenance.test.ts",
      "tests/app/R6-workbench.test.ts",
      "tests/runtime/S3-context-assembler.test.ts",
      "tests/state/S1-responsibility.test.ts",
      "tests/state/WP2-positions.test.ts",
      "tests/work-graph/R4b-session-boundaries.test.ts",
      "tests/work-graph/S1-codecs-indexes.test.ts"
    ]
  },
  {
    "id": "TP-063",
    "problem": "NR05 索引失效；NR08 删除丢失策略变化后的通知稳定性断言；错误 cursor 仍有删改两种指令。",
    "fix": "NR05 数量改 1 且两处 items[1] 改 items[0]；将 cap 3→7 后通知不变断言强制迁入 NR01；错误 cursor 改 kind:unknown 并保留拒绝断言。",
    "files_add": []
  },
  {
    "id": "TP-065",
    "problem": "公开字段删或置零未冻结；finalizedAt 校验层次不明确；日历测试删除范围会包含当前断言。",
    "fix": "保留两个公开字段并固定 0；finalizedAt 只在存储 record 校验；删除旧 runC/legacy 准备及旧 unplaced 期望，保留两个当前时段和归属断言。",
    "files_add": []
  },
  {
    "id": "TP-067",
    "problem": "末句允许临时扩大 work-line DTO 修改，另有两个注释文件不在白名单。",
    "fix": "删除可选扩展，仅收紧 mailbox 和 UndeliveredReplyV1；保留 SessionRecord 位置字段的当前可选语义。",
    "files_add": [
      "src/contracts/core/session.ts",
      "src/core/work-graph/state/message-machine.ts"
    ]
  },
  {
    "id": "TP-071",
    "problem": "共享 until 违反 F9；白名单含简称、省略号并漏真实 helper 文件。",
    "fix": "不共享轮询，改用真实公共操作的 A3 完成闸门；其他 helper 合并照做；用完整路径替换简称并安排 T3 交接。",
    "files_add": [
      "tests/app/S2B-35-activity-routes.test.ts",
      "tests/app/S2B-41-decision54-backfill-bound.test.ts",
      "tests/app/S2B-backfill-host.test.ts",
      "tests/app/S2B-backfill-workflow.test.ts",
      "tests/app/S2B-be2-late-evidence-activity.test.ts",
      "tests/app/S2B-be2-run23-activity.test.ts",
      "tests/app/S2B-be2-startup-reconcile-activity.test.ts",
      "tests/app/S2B-r2-backfill-identity.test.ts",
      "tests/app/S2B-r2-backfill-probe-first.test.ts",
      "tests/app/S2B-r2-backfill-real-kernel.test.ts",
      "tests/app/S2B-r2-backfill-revision-race.test.ts",
      "tests/app/S2B-r2-r6-probe-verdicts.test.ts"
    ]
  },
  {
    "id": "TP-072",
    "problem": "runAndEnd 仍手写 Runtime 事实，固定 counter 违反 F4，claimThenCancel 不能产生 counted 期望。",
    "fix": "使用至少 103 个真实工作任务；真实执行和真实 backfill 先形成 101 条已记录活动，再创建两个真实结束未记录候选；被测 backfill 使用真实 countRunActivity，保留原分页和 counted 断言。",
    "files_add": []
  },
  {
    "id": "TP-074",
    "problem": "源和合并目标均由 TP-027 删除。",
    "fix": "改为由 TP-027 吸收删除，不执行 merge，ledger 同时记录两项。",
    "files_add": []
  },
  {
    "id": "TP-076",
    "problem": "返回形状覆盖行号错误，merge 目标没有该返回值断言。",
    "fix": "改为删除重复测试；cover 分别引用 maintenance 的 RUN-19 状态和 composition 第 279–280 行真实返回形状，不执行所写 merge。",
    "files_add": []
  },
  {
    "id": "TP-080",
    "problem": "f.createSession 内部仍代 Runtime 调用 recordSessionCreated，违反 F3。",
    "fix": "安装 role_spec 后通过真实 Runtime.createSession 创建，再认领任务；同步四处调用方。",
    "files_add": []
  },
  {
    "id": "TP-081",
    "problem": "转换明确使用规则表禁止的 recordExecutionEntered。",
    "fix": "真实 Runtime prepare/start，加脚本模型 A3 闸门；公开读取 currentRun/envelope 并复用真实 manifest，删除手写入场事实。",
    "files_add": []
  },
  {
    "id": "TP-083",
    "problem": "公开 bootstrap 可选且默认保持旧方式，与 TP-107、108 冲突。",
    "fix": "先完成 TP-107、108，再合并；不保留旧 seed 开关，其余 clock、审计、工厂和逐 claim Kernel 身份继续参数化。",
    "files_add": []
  },
  {
    "id": "TP-084",
    "problem": "吸收条目误写 F-03。",
    "fix": "改为由 TP-083 吸收，合并后只清理仍存在的声明和 export。",
    "files_add": []
  }
]
```

**6．检查完成范围**

- **完整静态检查：TP-001 至 TP-086。** 包括所引符号、删除覆盖、合并目标、转换步骤、生产调用方检索、白名单及组内冲突。
- **仅通读：TP-087 至 TP-172。** 为判断上述依赖，进一步核对了表中涉及的后半条目；这不构成对后半组的完整审查或放行。
- **TP-001 至 TP-086 没有仅浏览后就判为干净的条目。** 未列入问题表的条目，本次未发现符合用户所列判错条件的问题；仍须遵守上面的同批关系。
- 本结论是施工前静态检查，不包含运行验证。