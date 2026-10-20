P2b 只读盘点完成：**24 项，其中 19 项建议删除或收紧，5 项建议保留。预计涉及约 649 行 P2b 生产代码**，这是改动范围估计，不是已验证的净删除量。未写文件，未运行测试或构建，未联网。

本报告以 `docs/refactor/HANDOFF.md:566-569` 的“只读当前格式、不保留开发旧数据迁移”为依据；测试处理遵守 `docs/refactor/HANDOFF.md:591`。下面的“覆盖”均为静态核对，不表示本轮运行通过。涉及 `src/core/work-graph/` 的引用只用于证明写入行为或指出 P2a 联动，不计入 P2b 行数。

| 编号 | 类别 | 位置（含相关测试） | 证据：接受什么、当前是否仍写 | 建议 | 被谁覆盖／旧行为退役依据 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---:|---|---|
| P2b-01 | old-data | `src/core/record-store/body-codec.ts:160-218,239-286`；`src/core/record-store/body-ports.ts:7-15`。测试：`tests/data/R3b-materials-contract.test.ts:63`，`reopens the original artifacts table and reads legacy first-owner provenance`；`:151`，`does not infer a Host-readable scope from a legacy record without an owner`。 | 解码器在缺少 `origin` 时从 `ownerRunRef` 合成 `legacy` 来源。当前编码器始终写 `origin`，并额外写供旧 reader 使用的 `ownerRunRef` 镜像（`body-codec.ts:247`）；内存和 SQLite 写入都经过它（`body-store.ts:27-39`、`sqlite-body-store.ts:25-51`）。**缺 `origin` 的形状已无正常新写入方；镜像字段仍在写。** | `change:只保留规范 origin，删除缺 origin 解码、legacy 来源类型及仅为旧 reader 保存的 ownerRunRef 镜像和一致性检查`。与 P2a 的 `src/core/work-graph/materials/applicability.ts:97` 联动。 | 旧格式读取依决定 79-1 退役（`HANDOFF.md:566`）。当前首次所有者、Host 来源与历史读边界由上述测试文件 `:45`、`:110`、`:132` 保留。`:88` 的混合测试只去旧类型子情形，不能连损坏正文边界一起删除。 | 40 | 否 | 高 |
| P2b-02 | old-data | `src/core/record-store/sqlite-text-scan.ts:54-60,135-160`。测试：`tests/record-store/SP-text-scan.test.ts:400`，`SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)`；旧夹具调用在 `:414-415`。 | 开库查找并删除 `next_fts_meta`、`next_fts_%` FTS 虚表，还容忍缺少 FTS5 模块。当前写入的是 `next_text_meta` 和普通 `next_text_*` 表（`sqlite-text-scan.ts:43,187-243`），没有当前 FTS 建表方。 | `delete`：删除旧表查询常量及旧 FTS 升级清理块；删除仅服务该旧场景的夹具引用。**保留**当前索引重建和多连接追赶（`:193-253,263-350`）。 | SP-12 的旧库升级行为依 `HANDOFF.md:566` 退役。当前行为仍由 `SP-text-scan.test.ts:176` SP-05、`:316` SP-09、`:333` SP-10、`:350` SP-11、`:374` SP-11B 钉住。 | 36 | 是 | 高 |
| P2b-03 | old-data | `src/core/record-store/sqlite-lookup-indexes.ts:85-113`，特别是 `:106-109`。相关测试：`tests/record-store/SP-lookup-index-migration.test.ts:107,154,188,223`，SP-40～SP-43。 | 接受无 `WHERE` 谓词的旧全表 lookup 索引并删除转换。当前索引 SQL 始终带 aggregate type 的局部谓词（`sqlite-lookup-indexes.ts:54-66`），创建方在 `:72-82`。同一模块还处理当前注册集合变化，不能整体当作旧迁移删除。 | `change:去掉 predicate===null 的旧全表索引转换，保留当前局部索引创建、注册变更和事务保护`。 | 旧全表格式依 `HANDOFF.md:566` 退役。SP-40～SP-43 测的是当前不同注册集合、部分打开、补充类型和新库，**不是旧全表夹具**，应保留。未找到直接钉住无谓词分支的测试。 | 8 | 是 | 高 |
| P2b-04 | old-data | `src/ui/state/display-preference.ts:14-16,106-137`。测试：`tests/app/MVP-ui-entry.test.ts:239`，`keeps display ids per scope and migrates only explicit v1 scopeKey`；旧迁移断言在 `:261-273`。 | 缺 v2 数据时读取 v1 单记录，迁移 scope 和全局偏好。当前保存只写 v2 scope/global 键（`display-preference.ts:140-149`），没有 v1 写入方。 | `delete`：删除 v1 键、`readLegacy` 和两条迁移分支。保留当前键缺失／损坏时的默认值处理。测试仅删除旧迁移段。 | 旧 localStorage 格式依 `HANDOFF.md:566` 退役。同一测试 `MVP-ui-entry.test.ts:243-259` 的多 scope 行为保留，`:276` 起恢复流程保留。 | 30 | 否 | 高 |
| P2b-05 | legacy | `src/core/agent-runtime/kernel-store-locator.ts:14-31,59-72,90-98,106-136`；`src/app/main.ts:153-158`；`src/core/agent-runtime/session-operations.ts:788-815,912-916`。测试：`tests/runtime/R4b-session-skeleton.test.ts:54` 的显式 legacy locator 场景；`tests/scenarios/K-W-workflow-close.test.ts:487` 的 KA-12 只读 legacy reader 场景。 | Host 配置仍可注入 `legacyEntries`，以原 Kernel Session ID 匹配只读旧库。当前 Session 创建经 workspace 注册定位（`session-operations.ts:585`），拒绝 legacy 创建（`:635`）；当前注册结构在 `kernel-store-locator.ts:8-13,74-87`。没有当前创建流程生成 legacy 注册。 | `delete`：删除 legacy entry/location 类型、注册表、配置解析、`legacy`／`withLegacyReader` 和对应读分流；同步收窄 Runtime／Query 中仅识别该分支的检查。保留“未注册 adapter”“不能关闭 Turn”等真实能力失败。 | 旧 locator 支持依 `HANDOFF.md:566` 退役。KA-12 其余真实失败仍在 `K-W-workflow-close.test.ts:397,421,456,524`，不能整组删除；当前接续流程在 `:233,259,287`。 | 110 | 是 | 高 |
| P2b-06 | old-data | `src/business/workflow/session-maintenance.ts:365-398,604-618,695-702`；`src/business/workflow/ports.ts:137-141`；`src/contracts/core/session.ts:21-56`；`src/composition/create-platform.ts:804-822,845-848,1273-1280,1834-1837`。测试：`tests/scenarios/S2C-K-legacy-provenance.test.ts:437,462`，2C-26 维护前／回填后。 | 对缺 `provenance` 的 Session 推导并回填来历；未解决者阻止自动退役。当前创建入口把缺输入归为 `{schemaVersion:1,kind:'new'}`（`src/core/work-graph/sessions/session-directory.ts:714-722`），保存规范来历（`:792`）；旧恢复路径可因旧 operation 再写旧形状，不等于正常新建仍需要旧格式。 | `change:随 P2a 收紧 Session 格式，删除 P2b 的旧来历回填依赖、遍历和 legacyPending 专用阻断`。同步收窄共享来历类型与 `src/contracts/work-line.ts:121` 的旧计数。不要一并要求 `unavailableSince` 永远存在。 | 2C-26 的旧来历回填行为依 `HANDOFF.md:566` 退役。该文件 `:482` 的执行列表索引场景另行判断，不能因同文件而全删；当前 Session 维护能力保留。 | 100 | 是 | 高 |
| P2b-07 | old-data | `src/core/agent-runtime/session-operations.ts:95-97,171-182,214-221,430-432`。当前范围测试：`tests/runtime/R4c-graph-history.test.ts:768`，`rejects a continuation position below the frozen range instead of reading from the Session head`；`:808` 的 bounded page 场景。 | 继续游标容忍缺少或为 null 的下界 `l`，读取时补成 1。当前编码器总写 `l`（`:171-182`），下界由当前范围计算，调用点在 `:362,482,502,512`。 | `change:游标要求合法的 l，移除 nullable lower 和缺字段补 1 分支`。保留合法 head 下界 1、范围校验及当前 `throughCursor` 语义。 | 缺下界旧游标依 `HANDOFF.md:566` 退役。上述当前范围测试保留；未找到直接制造“缺 l”旧游标的测试。 | 8 | 否 | 高 |
| P2b-08 | old-data | `src/core/agent-runtime/source-capture-access.ts:257-265,631-726`。测试：`tests/runtime/source-binding-migration.test.ts:221`，`resolves Query source authority from the original submission with one shared history scan`；`:232` 的冲突提交／当前执行改变混合测试。 | 没有 `readQuerySubmission` 或 Job 缺 `submission` 时，回退扫描整个事件历史以找原提交 actor。当前 Job 新建和事件恢复都写定位字段（`src/core/work-graph/queries/query-job-service.ts:498,729-731`）；当前组合安装定点 reader（`src/composition/create-platform.ts:1039,1218`）。旧测试 Job 在 `source-binding-migration.test.ts:190-218` 手写缺字段。 | `change:只用当前 submission 定点读取，删除全历史扫描、旧 authority 联合分支和专用分页常量`。测试应改走当前提交定位，保留原 actor 权限和执行改变后拒绝的断言。 | 旧扫描路径依 `HANDOFF.md:566` 退役。当前生产 reader 位于 `src/core/work-graph/source-authority-reader.ts:98,164`；不能把测试 `:232-239` 的当前执行改变断言一起删除。 | 75 | 否 | 高 |
| P2b-09 | old-data | `src/contracts/dispatch.ts:112-116,223`；`src/app/startup-reconcile.ts:199-211,336-339`；`src/core/agent-runtime/run-reconcile.ts:264-265`；`src/contracts/run-activity.ts:98-105`。测试：`tests/state/run-machine.test.ts:444`，`reads V1 and pre-B2 authorizations as legacy history, not damage`；`tests/work-graph/S2B-r2-r5-not-entered.test.ts:36`，2B-r2 R5。 | 保留无 V2 标识的 `ExecutionAuthorizationV1`，各消费方把它分类为旧授权、只读或不可核对。当前授权状态机只写 V2（`src/core/work-graph/state/run-machine.ts:863-869,959-963`）。 | `change:随 P2a 解码收紧移除 V1 联合成员及 V1 专用分类，保留当前尚未授权 Run 的分支`。Runtime、brief、observation 等消费方相应收窄，不能把“无授权”和“旧授权”混删。 | V1 历史读取依 `HANDOFF.md:566` 退役。2B-r2 R5 中只针对 V1 的旧子情形随之退役，V2 的未进入证明规则仍保留。 | 40 | 是 | 高 |
| P2b-10 | old-data | `src/business/workflow/decision-actions.ts:190-205,363-411`，旧 fallback 在 `:386-411`。当前测试：`tests/scenarios/S5-two-request-decisions.test.ts:37`，SC01；来源及 pins 断言在 `:84,147-148`。 | 回答没有捕获的 `decision.source` 时，改读当前来源并执行冲突决定。当前回答写入方始终写规范 source（`src/core/work-graph/communication/decision-service.ts:784,841`），共享响应类型也要求它（`src/contracts/core/session-message.ts:78-85`）。 | `change:删除无 captured source 的兼容执行路径，缺规范来源时明确拒绝，不用当前来源替代回答时来源`。保留真正的来源校验和当前执行路径。 | 旧回答形状依 `HANDOFF.md:566` 退役；SC01 钉住当前回答来源和应用证明。未找到直接钉住“缺 captured source 后仍成功”的测试。 | 28 | 是 | 高 |
| P2b-11 | legacy | `src/business/workflow/contracts.ts:234-238,267-272`。测试：`tests/business/K3-UR7-crr-failed-set.test.ts:388,444-445`；`tests/business/K3-46-review-advance-failures.test.ts:629,736`。 | 两处 `failedReviewRefs` 声明仍声称 Host 会发送旧字段、结果会投影旧字段。但当前 driver 只传 `failedCardRefs`（`src/app/collaboration-driver.ts:818-830`）；Workflow 明示不再生成旧字段（`src/business/workflow/workflow.ts:510-520`），解析只读新集合（`:684-717`）。 | `delete`：删除两个旧字段声明及失实的兼容注释。保留 `workflow.ts:725` 公共入口拒绝注入内部字段的检查。 | 当前 K3 测试已断言旧字段不存在；公共入口拒绝行为仍存在，保留 `K3-46-review-advance-failures.test.ts:629`。这是声明残留，不是删除 K3 业务规则。 | 11 | 是 | 高 |
| P2b-12 | legacy | `src/core/agent-runtime/exploration-tools.ts:68-77,113-120,174-177`；`src/core/agent-runtime/observed-model-run.ts:79-88,274-285,327`。测试：`tests/app/project-source-tool.test.ts:266`，保留 old wire/live 模式；`tests/runtime/source-tool-lifecycle.test.ts:226,246,308` 的 legacy 模式。 | 仍可选 `legacy_live`／隐式默认，创建 `ProjectSourceIndex` 并暴露 `project_index`。当前两个生产模型入口在有文件读权限时都构造 frozen source factory（`execution-driver.ts:1135-1152,1243`；`query-execution.ts:328-356,542`）；无文件读权限时不创建 exploration tools（`observed-model-run.ts:274-279`）。 | `delete`：删除生产调用链已不用的 legacy 模式、默认分支和 `project_index` 暴露；移除只为该分支创建的对象。**不要据此删除共享 TS/Python/C++ 索引实现。**同步去掉 `project-source-tool.ts:237` 对旧工具的指引。 | 当前 frozen 工具行为由 `project-source-tool.test.ts:154,189,234` 和 `source-tool-lifecycle.test.ts:260` 保留。旧模式依决定 79 清理；legacy 专用测试退役，通用清理／关闭语义保留到 frozen 路径。 | 30 | 否 | 中 |
| P2b-13 | old-data | `src/app/host-settings-types.ts:26-42`。测试：`tests/app/A2-settings-automation.test.ts:60,125`；`tests/app/RL-40-43-resource-cap-settings.test.ts:72,85,114`。 | 输出 DTO 将 `automation`、`resourceCaps` 设为可选，注释理由是兼容旧 snapshot／测试字面量。但当前 `snapshotOf` 总是发布两者（`src/app/host-settings.ts:548-570`），不存在缺字段的当前输出方。 | `change:将公开 HostSettingsSnapshot 的这两个字段改为必需，删除旧 snapshot 理由并更新旧测试字面量`。这不等于让磁盘设置文件也必须含两字段，见下一项。 | 当前默认输出、保存和重开行为由上述 A2、RL-40／RL-41 测试覆盖。保留这些行为测试。 | 10 | 是 | 高 |
| P2b-14 | old-data | `src/app/host-settings.ts:286-298,424-426,454-480,510-516`。测试：`tests/app/A2-settings-automation.test.ts:60,71,86`；`tests/app/RL-40-43-resource-cap-settings.test.ts:72,85,131`。 | 磁盘文件允许缺 `automation`／`resourceCaps`。**当前无文件初始化就会产生缺这两字段的对象**（`:454-460`），未显式保存相应设置前，普通保存仍不补字段（`:510-516`），读取使用当前默认值（`:471-480`）。 | `keep`：这是当前新安装／未设置状态，不是仅供旧版本读取。若未来要统一磁盘形状，应同时改初始化和保存语义，不能只删 reader。 | A2 默认设置及 RL-40／RL-41 明确覆盖；旧措辞不改变当前写入事实。 | 0 | 是 | 高 |
| P2b-15 | old-data | `src/core/record-store/migrations.ts:17-21,102-152`；`src/core/record-store/record-codec.ts:757-833`；`src/core/record-store/ports.ts:201-212`。测试：`tests/record-store/R3a-transaction-boundaries.test.ts:46`，`%s: beforeWrite belongs only to a real Goal write and receipts cannot mutate storage`。 | 四张基础表和幂等 JSON 被注释称为 legacy，但仍是当前格式。SQLite 当前提交仍写 `fingerprint/eventIds/aggregateRevisions/commitCursor`（`sqlite-record-store.ts:476-481`）；内存后端同样写（`in-memory-record-store.ts:366-371`）。schema 检查容忍部分额外列（`migrations.ts:130-137`），不是库版本识别。 | `keep`：保留当前基础表、幂等编解码和完整性检查；不要因文件名 `migrations` 或 legacy 注释整删。是否改成严格库版本门槛，见后面的开放选项。 | 当前真实 Goal 提交／重放断言在 `R3a-transaction-boundaries.test.ts:55-69`。两个后端继续保留的决定在 `HANDOFF.md:683`。未找到统一“旧版本库请重建”行为的现成测试。 | 0 | 否 | 高 |
| P2b-16 | old-data | `src/contracts/core/prepared-execution.ts:201-205,270-271`；`src/core/agent-runtime/execution-preparation.ts:498,520-533`；`src/core/agent-runtime/query-preparation.ts:332,359`。测试：`tests/work-graph/S3-prepared-context-admission.test.ts:499`，`AD05: an old manifest without contextAssembly authorizes as before and is not migrated`。 | manifest 的 `contextAssembly` 可缺，并将缺失解释成旧输入。当前 assembler 成功结果要求 binding（`src/core/agent-runtime/context-assembler.ts:123`），Task／Query prepare 都使用它，新生产 manifest 不需要无 binding 形状。 | `change:当前 Task 和 Query manifest 必须有 contextAssembly，删除写入时无意义的可选展开，并与 P2a 旧 manifest admission 分支一起收紧`。不删除合法可缺的 `sessionBasis`、workspace baseline。 | AD05 的旧 manifest 放行依 `HANDOFF.md:566` 退役。当前合法准备与重放仍由同文件 `:438` AD01、`:451` AD02 保留。 | 12 | 是 | 高 |
| P2b-17 | old-data | `src/contracts/verification.ts:199-203,238-239`。测试：`tests/work-graph/A2-step1-codecs.test.ts:380`，`a legacy round (no chain, no incompleteCause) still decodes unchanged`；`:387` 当前 successor round-trip。 | `RoundSnapshot.chain` 可缺，缺失被解释为旧无槽位根。当前根 round 写 `rootRoundChain`（`src/core/work-graph/state/verification-machine.ts:920`），后继 round 构造明确 chain（`:633-660`）。 | `change:随 P2a round 解码收紧，将当前 RoundSnapshot.chain 改为必需并删除旧根解释`。不要顺带把 `incompleteCause` 改为必需：当前非相应结论仍可无该字段（`verification-machine.ts:1623`）。 | 无 chain 旧 round 依 `HANDOFF.md:566` 退役。当前链 round-trip 和坏链校验在 `A2-step1-codecs.test.ts:387,426` 保留。 | 6 | 否 | 高 |
| P2b-18 | old-data | `src/contracts/plan.ts:221-227`；`src/contracts/input-declaration-id.ts:13-16`；`src/core/agent-runtime/context-assembler.ts:775-785`。相关测试：`tests/runtime/S3-context-assembler.test.ts:191` 的输入声明夹具，`:781` CA11 合法缺上游提醒。 | `PlanRevisionSnapshot` V1/V2 并存，精确输入沿用 `legacy:` 声明 ID。当前 compiler **仍能写 V1**（`src/core/work-graph/tasks/plan-commit-compiler.ts:157-162`），V2 当前也继续携带 `inputRequirements`（`:159-160`）；assembler 正常把它们转为 `legacy:` ID。 | `keep`：不能仅凭 V1／legacy 名称删除这些 reader。若要取消，必须先由 P2a 同时取消当前生产入口与 writer；这不是“只删旧数据 reader”。不要与旧 PlanProposal 格式混为一项。 | 当前 compiler 和 CA11 输入解析行为仍存在；本项不提出删测试。 | 0 | 是 | 高 |
| P2b-19 | legacy | `src/business/workflow/consultation.ts:292-298,363-365,440-457`；`src/contracts/core/prepared-execution.ts:263-269`。相关测试：`tests/app/AG2-consultation.test.ts:330` 正式回答回原消息；`:447` 忙源 Session 的隔离咨询。 | 注释称无 derivation 只会来自 legacy Query，但当前 `part:'response'` 明确让 derivation 为 undefined（`:363-365`），提交 intent 时条件写入（`:457`）。因此原 Session 目标分支仍有当前生产来源。 | `keep`：保留无 derivation 的当前回复处理分支，以及对应可缺 `sessionBasis`。不能把“缺 derivation”一概视为旧数据。 | 当前回复／非隔离处理仍存在；隔离 inquiry 的业务断言也保留。上述 AG2 测试覆盖相邻主流程，但未将它们冒称为所有 response 子路径的逐项覆盖。 | 0 | 否 | 高 |
| P2b-20 | c1-transfer | `src/contracts/architecture-inspection.ts:1` 等 **31 个文件的第 1 行**；完整清单见表后。 | 都是相同的 N0 来源注释，没有运行时行为。C1 验收明确移交 T（`docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:77,92`）。 | `delete`：只删这 31 条来源行；不据此删契约声明或另行改写历史证据。 | 行为未存在：纯注释；具体清理依据是上述 C1 裁定 3。没有需要删除的行为测试。 | 31 | 否 | 高 |
| P2b-21 | n0 | `src/business/workflow/contracts.ts:60-68`；`src/business/workflow/ports.ts:221-226`；`src/business/workflow/index.ts:4`；`src/business/workflow/workflow.ts:813-818`。测试：`tests/composition/platform.test.ts:50`，其中 `:79-83` 仍调用 N0 输入并期待 unsupported。 | N0 `request_work` 输入仅保留类型、联合入口和永远 unsupported 的骨架。当前初始规划使用 `planning_answer`／`adopt_initial_plan`；真实流程见 `tests/business/R5b-initial-planning-workflow.test.ts:286-312`。决定 85-4 明确把 N0 Workflow 输入交 T（`HANDOFF.md:683`）。 | `change:删除 N0GoalInput 类型、导入导出及入口联合成员，移除 N0 专属骨架理由，保留真实边界拒绝和当前规划入口`。不是删除整个 `handleGoalInput`。 | N0 骨架由 `HANDOFF.md:683` 移交清理。当前流程由 `R5b-initial-planning-workflow.test.ts:247`，`consumes the answer, adopts the candidate, then advances to a formal Goal completion` 覆盖。 | 17 | 否 | 高 |
| P2b-22 | legacy | `src/app/attention-observer.ts:588-599,651-715`；`src/app/host.ts:1444-1447`。旧夹具：`tests/app/S0-attention-edge-label.test.ts:42-64`；S0-01～03 在 `:68,76,87`。 | 缺 `readAttentionGraph` 时直接读 plans/catalog 拼图。当前组合始终发布该方法（`src/composition/create-platform.ts:1509-1515`）；Runtime skeleton 和真实实现也都发布（`src/core/agent-runtime/runtime.ts:96,737`）。缺方法 fallback 是旧装配路径。 | `change:删除直接 plans/catalog 图读取 fallback 及只为它保留的依赖，要求当前 assembler reader`。S0 测试改用当前 reader，保留边标签／种类变化断言。 | 当前 scanner 路径由 `tests/app/S3-attention-context.test.ts:300` AT04、`:462` AT11 钉住。边语义仍存在，**S0 规格行不能随旧夹具一起删掉**。 | 56 | 是 | 高 |
| P2b-23 | allowlist-wire-format | `src/app/core-http-types.ts:393-496` 的 46 个 allowlist DTO 别名；对应清单从 `tests/architecture/production-reach-allowlist.json:643` 起。测试例：`tests/app/S2B-35-activity-routes.test.ts:222`、`tests/app/S4C-note-routes.test.ts:71,82`。 | 这些是当前 goals/settings、decisions、activity、notes、versions 请求／响应形状。当前路由表和 dispatch 仍接线（`src/app/core-routes.ts:472-506,1140-1172`）。它们不是仅为读旧存储保留的字段；“别名没有运行时引用”也不等于旧 wire 已无消费者。 | `keep`：本轮旧格式检查不支持删除这些当前 DTO。allowlist 条目本身的完整分类由 P1 合并，避免重复计数。 | 当前 route 行为仍存在；活动、注记及版本路由测试保留。没有把架构检查列为删项。 | 0 | 是 | 高 |
| P2b-24 | old-data | `src/contracts/goal-decisions.ts:50-52` 的 `NoticePositionV1` legacy 成员。测试：`tests/work-graph/S2A-notices-rework.test.ts:37`，`QA-11 legacy requeues without since order by occurredAt before the commit-position requeues`；`tests/work-graph/S5-notices.test.ts:195` NR05。 | 旧通知位置按 `occurredAt` 排序，源自缺 `since` 记录（`src/core/work-graph/views/automatic-rework-notices.ts:158-173,526-528`；`decision-read-model.ts:1565-1567`）。当前新消息绑定真实提交游标（`communication/mailbox-service.ts:297-320`），新 requeue 也绑定（`tasks/requeue-service.ts:1110-1116`），新 round 同样绑定（`evidence/evidence-service.ts:352-358,1701-1702`）。 | `change:随 P2a 删除缺 since 通知路径，移除 P2b NoticePositionV1 的 legacy 联合成员`。这里只计共享类型的一行；不能单独改类型、留下 P2a 生产返回方。 | QA-11 的旧位置排序依 `HANDOFF.md:566` 退役。NR05 混合了旧位置与损坏 origin，不能整行测试无区分删除。当前提交游标绑定仍由 `tests/record-store/WP2-notice-cursors.test.ts:61,78` 的 W231 规则约束。 | 1 | 是 | 高 |

P2b-20 的 31 个位置如下，均只涉及第 1 行：

- `src/contracts/architecture-inspection.ts:1`、`src/contracts/architecture-source.ts:1`、`src/contracts/artifact.ts:1`、`src/contracts/command-event.ts:1`、`src/contracts/context-continuity.ts:1`、`src/contracts/control-intent.ts:1`、`src/contracts/coordination.ts:1`。
- `src/contracts/core/call-context.ts:1`、`src/contracts/core/identity.ts:1`、`src/contracts/core/results.ts:1`、`src/contracts/core/source.ts:1`。
- `src/contracts/dispatch.ts:1`、`src/contracts/evidence.ts:1`、`src/contracts/fingerprint.ts:1`、`src/contracts/goal-change.ts:1`、`src/contracts/goal-phase.ts:1`、`src/contracts/governance.ts:1`、`src/contracts/human-role-collaboration.ts:1`、`src/contracts/initial-planning.ts:1`、`src/contracts/ledger.ts:1`、`src/contracts/material-access.ts:1`、`src/contracts/opaque.ts:1`、`src/contracts/plan.ts:1`、`src/contracts/query-job.ts:1`、`src/contracts/reduction.ts:1`、`src/contracts/reviewer-work.ts:1`、`src/contracts/role-spec.ts:1`、`src/contracts/task-envelope.ts:1`。
- `src/contracts/validation/common.ts:1`、`src/contracts/validation/goal.ts:1`、`src/contracts/validation/identity.ts:1`。

```json
[
  {
    "id": "P2b-01",
    "category": "old-data",
    "file": "src/core/record-store/body-codec.ts",
    "lines": "160-218,239-286",
    "tests": [
      "tests/data/R3b-materials-contract.test.ts:63::reopens the original artifacts table and reads legacy first-owner provenance",
      "tests/data/R3b-materials-contract.test.ts:151::does not infer a Host-readable scope from a legacy record without an owner"
    ],
    "evidence": "缺 origin 在 207-213 合成 legacy；247 的当前编码器总写 origin，仍写 ownerRunRef 兼容镜像。body-store.ts:27-39 和 sqlite-body-store.ts:25-51 共用编码器；body-ports.ts:7-15 暴露 legacy 类型。",
    "action": "change:只保留规范 origin，移除缺 origin 解码、legacy 类型及旧 reader 的 ownerRunRef 镜像，与 P2a applicability.ts:97 联动",
    "covered_by": "旧格式行为依 docs/refactor/HANDOFF.md:566 退役；当前所有者、Host 来源和历史读保留 tests/data/R3b-materials-contract.test.ts:45,110,132；88 的损坏正文部分保留",
    "est_lines": 40,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-02",
    "category": "old-data",
    "file": "src/core/record-store/sqlite-text-scan.ts",
    "lines": "54-60,135-160",
    "tests": [
      "tests/record-store/SP-text-scan.test.ts:400::SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)"
    ],
    "evidence": "开库删除 next_fts_meta 和旧 FTS 虚表；当前只创建 43,187-243 的 next_text 普通表。",
    "action": "delete",
    "covered_by": "旧 FTS 升级行为依 docs/refactor/HANDOFF.md:566 退役；保留 sqlite-text-scan.ts:193-253,263-350 当前重建和追赶，以及 SP-text-scan.test.ts:176,316,333,350,374 的 SP-05/09/10/11/11B",
    "est_lines": 36,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-03",
    "category": "old-data",
    "file": "src/core/record-store/sqlite-lookup-indexes.ts",
    "lines": "85-113",
    "tests": [
      "tests/record-store/SP-lookup-index-migration.test.ts:107::SP-40",
      "tests/record-store/SP-lookup-index-migration.test.ts:154::SP-41",
      "tests/record-store/SP-lookup-index-migration.test.ts:188::SP-42",
      "tests/record-store/SP-lookup-index-migration.test.ts:223::SP-43"
    ],
    "evidence": "106-109 转换无谓词旧全索引；54-66 的当前 SQL 始终有 aggregateType 局部谓词。SP-40 至 SP-43 测当前注册变化，不是旧全索引夹具；未找到旧分支直接测试。",
    "action": "change:删除 predicate===null 旧全表索引转换，保留当前注册变化、缺索引创建与事务",
    "covered_by": "旧格式依 docs/refactor/HANDOFF.md:566 退役；SP-40 至 SP-43 保留",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-04",
    "category": "old-data",
    "file": "src/ui/state/display-preference.ts",
    "lines": "14-16,106-137",
    "tests": [
      "tests/app/MVP-ui-entry.test.ts:239::keeps display ids per scope and migrates only explicit v1 scopeKey"
    ],
    "evidence": "读取 v1 单记录迁移 scope/global；140-149 当前只保存 v2。旧迁移断言在测试 261-273。",
    "action": "delete",
    "covered_by": "旧 v1 读取依 docs/refactor/HANDOFF.md:566 退役；保留 MVP-ui-entry.test.ts:243-259 多 scope 和 276 起恢复行为，以及当前缺失/损坏默认处理",
    "est_lines": 30,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-05",
    "category": "legacy",
    "file": "src/core/agent-runtime/kernel-store-locator.ts",
    "lines": "14-31,59-72,90-98,106-136",
    "tests": [
      "tests/runtime/R4b-session-skeleton.test.ts:54::显式 trusted legacy locator 场景",
      "tests/scenarios/K-W-workflow-close.test.ts:487::KA-12 only a read-only legacy reader is registered"
    ],
    "evidence": "src/app/main.ts:153-158 仍接受 legacyEntries；session-operations.ts:788-815,912-916 分流旧只读库。当前创建使用 workspace 注册（585），拒绝 legacy（635），不生成 legacy 注册。",
    "action": "delete",
    "covered_by": "旧 locator 支持依 docs/refactor/HANDOFF.md:566 退役；保留 K-W-workflow-close.test.ts:397,421,456,524 真实能力失败及 233,259,287 当前接续流程",
    "est_lines": 110,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-06",
    "category": "old-data",
    "file": "src/business/workflow/session-maintenance.ts",
    "lines": "365-398,604-618,695-702",
    "tests": [
      "tests/scenarios/S2C-K-legacy-provenance.test.ts:437::2C-26 before maintenance",
      "tests/scenarios/S2C-K-legacy-provenance.test.ts:462::2C-26 after one maintenance pass"
    ],
    "evidence": "缺 provenance 时推导回填并保留 legacyPending 阻断；当前 session-directory.ts:714-722,792 规范化并保存新来历。相关 P2b 接线在 workflow/ports.ts:137-141、contracts/core/session.ts:21-56、create-platform.ts:804-822,845-848,1273-1280,1834-1837。",
    "action": "change:随 P2a 收紧 Session 格式，删除旧来历回填接线、维护分支与旧计数；保留当前健康和生命周期逻辑",
    "covered_by": "旧回填行为依 docs/refactor/HANDOFF.md:566 退役；2C-26 中 482 的执行列表索引场景不能随文件整删",
    "est_lines": 100,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-07",
    "category": "old-data",
    "file": "src/core/agent-runtime/session-operations.ts",
    "lines": "95-97,171-182,214-221,430-432",
    "tests": [
      "tests/runtime/R4c-graph-history.test.ts:768::rejects a continuation position below the frozen range instead of reading from the Session head",
      "tests/runtime/R4c-graph-history.test.ts:808::reads one bounded Kernel page from startPosition - 1 up to the frozen throughPosition"
    ],
    "evidence": "读取缺失或 null 的 l 并回填下界 1；171-182 当前编码器总写 l，当前调用点在 362,482,502,512。未找到缺 l 旧游标的直接测试。",
    "action": "change:要求当前游标具有合法 l，删除 nullable lower 和旧补值分支，保留 head/range/throughCursor 当前语义",
    "covered_by": "缺下界旧游标依 docs/refactor/HANDOFF.md:566 退役；保留当前范围读取和越界拒绝测试",
    "est_lines": 8,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-08",
    "category": "old-data",
    "file": "src/core/agent-runtime/source-capture-access.ts",
    "lines": "257-265,631-726",
    "tests": [
      "tests/runtime/source-binding-migration.test.ts:221::resolves Query source authority from the original submission with one shared history scan",
      "tests/runtime/source-binding-migration.test.ts:232::rejects a conflicting original Query submission and changed current execution"
    ],
    "evidence": "无定点 reader 或无 job.submission 时扫描全部历史。query-job-service.ts:498,729-731 当前总写 submission；create-platform.ts:1039,1218 安装 source authority reader。测试 190-218 手写缺字段 Job。",
    "action": "change:只保留当前 submission 定点读取，移除历史扫描及旧 authority 分支；测试保留原 actor 和执行变化拒绝语义",
    "covered_by": "旧扫描路径依 docs/refactor/HANDOFF.md:566 退役；当前 reader 为 src/core/work-graph/source-authority-reader.ts:98,164；测试 232-239 的当前执行变化断言保留",
    "est_lines": 75,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-09",
    "category": "old-data",
    "file": "src/contracts/dispatch.ts",
    "lines": "112-116,223",
    "tests": [
      "tests/state/run-machine.test.ts:444::reads V1 and pre-B2 authorizations as legacy history, not damage",
      "tests/work-graph/S2B-r2-r5-not-entered.test.ts:36::2B-r2 R5 a V1 authorization does not prove non-entry"
    ],
    "evidence": "保留 V1 授权联合和 startup-reconcile.ts:199-211,336-339、run-reconcile.ts:264-265、run-activity.ts:98-105 的旧分类；当前 state/run-machine.ts:863-869,959-963 只写 V2。",
    "action": "change:随 P2a 解码收紧移除 V1 类型和专用消费分支，保留当前无授权 Run 的合法状态",
    "covered_by": "V1 历史行为依 docs/refactor/HANDOFF.md:566 退役；2B-r2 R5 的 V2 未进入证明规则保留",
    "est_lines": 40,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-10",
    "category": "old-data",
    "file": "src/business/workflow/decision-actions.ts",
    "lines": "190-205,363-411",
    "tests": [
      "tests/scenarios/S5-two-request-decisions.test.ts:37::SC01 two root requests"
    ],
    "evidence": "386-411 对缺回答时 captured source 的响应改读当前来源。当前 decision-service.ts:784,841 总写 source；contracts/core/session-message.ts:78-85 要求该字段。未找到该旧成功分支的直接测试。",
    "action": "change:删除缺 captured source 的兼容执行路径，缺规范来源明确拒绝",
    "covered_by": "旧回答形状依 docs/refactor/HANDOFF.md:566 退役；SC01 在 84,147-148 钉住当前来源、pins 和应用证明",
    "est_lines": 28,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-11",
    "category": "legacy",
    "file": "src/business/workflow/contracts.ts",
    "lines": "234-238,267-272",
    "tests": [
      "tests/business/K3-UR7-crr-failed-set.test.ts:388,444-445::旧字段不存在的断言",
      "tests/business/K3-46-review-advance-failures.test.ts:629,736::公共输入拒绝与旧字段不存在"
    ],
    "evidence": "failedReviewRefs 两处声明声称仍发送/投影；实际 collaboration-driver.ts:818-830 只发送 failedCardRefs，workflow.ts:510-520,684-717 不生成或解析旧字段。",
    "action": "delete",
    "covered_by": "删除两个死声明；当前 K3 测试已断言旧字段不存在；workflow.ts:725 和测试 629 的公共入口拒绝内部字段行为仍存在并保留",
    "est_lines": 11,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-12",
    "category": "legacy",
    "file": "src/core/agent-runtime/exploration-tools.ts",
    "lines": "68-77,113-120,174-177",
    "tests": [
      "tests/app/project-source-tool.test.ts:266::publishes one TS project protocol per trusted mode while retaining the full old wire and live stale checks",
      "tests/runtime/source-tool-lifecycle.test.ts:226,246,308::legacy_live 生命周期场景"
    ],
    "evidence": "仍可选 legacy_live/隐式默认暴露 project_index；当前 execution-driver.ts:1135-1152,1243 和 query-execution.ts:328-356,542 在有文件读权限时总给 frozen factory；observed-model-run.ts:274-279 无文件读权限不创建工具。",
    "action": "delete",
    "covered_by": "删除旧模式、默认和工具暴露，保留共享语言索引；当前 frozen 行为在 project-source-tool.test.ts:154,189,234 和 source-tool-lifecycle.test.ts:260；旧模式依 HANDOFF.md:566,584-591 清理",
    "est_lines": 30,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2b-13",
    "category": "old-data",
    "file": "src/app/host-settings-types.ts",
    "lines": "26-42",
    "tests": [
      "tests/app/A2-settings-automation.test.ts:60,125::默认输出及保存重开",
      "tests/app/RL-40-43-resource-cap-settings.test.ts:72,85,114::RL-40/RL-41"
    ],
    "evidence": "DTO 两字段可选只为旧 snapshot/字面量；host-settings.ts:548-570 当前 snapshotOf 总发布 automation 和 resourceCaps。",
    "action": "change:公开 snapshot 两字段改为必需并更新旧测试字面量，不收紧磁盘缺省设置形状",
    "covered_by": "当前 A2 与 RL-40/RL-41 输出、保存和重开测试保留",
    "est_lines": 10,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-14",
    "category": "old-data",
    "file": "src/app/host-settings.ts",
    "lines": "286-298,424-426,454-480,510-516",
    "tests": [
      "tests/app/A2-settings-automation.test.ts:60,71,86::缺省设置与未显式保存字段",
      "tests/app/RL-40-43-resource-cap-settings.test.ts:72,85,131::RL-40/RL-41"
    ],
    "evidence": "当前无设置文件初始化在 454-460 就缺 automation/resourceCaps；510-516 普通保存仍可缺，471-480 读取默认值，非仅旧数据。",
    "action": "keep",
    "covered_by": "当前新安装和未设置状态仍存在；A2 默认设置及 RL-40/RL-41 明确覆盖",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-15",
    "category": "old-data",
    "file": "src/core/record-store/migrations.ts",
    "lines": "17-21,102-152",
    "tests": [
      "tests/record-store/R3a-transaction-boundaries.test.ts:46::%s: beforeWrite belongs only to a real Goal write and receipts cannot mutate storage"
    ],
    "evidence": "四表和 record-codec.ts:757-833 的所谓 legacy 幂等格式仍由 sqlite-record-store.ts:476-481、in-memory-record-store.ts:366-371 当前写入。130-137 的额外列容忍不是库级版本识别。",
    "action": "keep",
    "covered_by": "当前提交及重放断言在 R3a-transaction-boundaries.test.ts:55-69；两个后端保留依据 HANDOFF.md:683。统一旧版本开库提示尚无对应实现/测试，另列选项",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-16",
    "category": "old-data",
    "file": "src/contracts/core/prepared-execution.ts",
    "lines": "201-205,270-271",
    "tests": [
      "tests/work-graph/S3-prepared-context-admission.test.ts:499::AD05: an old manifest without contextAssembly authorizes as before and is not migrated",
      "tests/work-graph/S3-prepared-context-admission.test.ts:438,451::AD01/AD02"
    ],
    "evidence": "允许缺 contextAssembly；context-assembler.ts:123 的成功结果必有 binding，execution-preparation.ts:498,520-533 和 query-preparation.ts:332,359 当前使用该结果写 manifest。",
    "action": "change:当前 Task/Query manifest 要求 contextAssembly，删除可选写入并与 P2a admission 一起收紧",
    "covered_by": "AD05 旧 manifest 行为依 HANDOFF.md:566 退役；AD01/AD02 当前准备与重放保留；不删除合法可缺的 sessionBasis/workspace baseline",
    "est_lines": 12,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-17",
    "category": "old-data",
    "file": "src/contracts/verification.ts",
    "lines": "199-203,238-239",
    "tests": [
      "tests/work-graph/A2-step1-codecs.test.ts:380::a legacy round (no chain, no incompleteCause) still decodes unchanged",
      "tests/work-graph/A2-step1-codecs.test.ts:387::a successor round (ordinal 2, Agent reverify) with incompleteCause and a chain root round-trip"
    ],
    "evidence": "缺 chain 被解释为旧根；state/verification-machine.ts:920 当前根写 rootRoundChain，633-660 后继构造 chain。incompleteCause 在 1623 仍可合法缺失。",
    "action": "change:随 P2a 解码收紧要求当前 round.chain，删除旧根解释，保留 incompleteCause 的合法可选性",
    "covered_by": "无 chain 旧行为依 HANDOFF.md:566 退役；A2-step1-codecs.test.ts:387,426 当前链和坏链检查保留",
    "est_lines": 6,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-18",
    "category": "old-data",
    "file": "src/contracts/plan.ts",
    "lines": "221-227",
    "tests": [
      "tests/runtime/S3-context-assembler.test.ts:191::inputRequirements 夹具",
      "tests/runtime/S3-context-assembler.test.ts:781::CA11 a legal missing upstream stays ready and reminds with its declaration and tA facts"
    ],
    "evidence": "tasks/plan-commit-compiler.ts:157-162 当前仍可写 V1，159-160 的 V2 仍携带 inputRequirements；context-assembler.ts:775-785 与 contracts/input-declaration-id.ts:13-16 当前产生 legacy: 声明 ID。",
    "action": "keep",
    "covered_by": "当前 writer 和 CA11 输入解析行为仍存在；取消必须先与 P2a 一起改变生产入口，不能仅删除 reader，也不能与旧 PlanProposal 格式混同",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-19",
    "category": "legacy",
    "file": "src/business/workflow/consultation.ts",
    "lines": "292-298,363-365,440-457",
    "tests": [
      "tests/app/AG2-consultation.test.ts:330::answers the original question from the saved formal Query answer and replies on the original message",
      "tests/app/AG2-consultation.test.ts:447::consults a busy source through an isolated child and refuses a non-recipient binding"
    ],
    "evidence": "无 derivation 分支被注释称为 legacy，但当前 response 路径在 363-365 明确不带 derivation，457 条件写入；prepared-execution.ts:263-269 的 sessionBasis 因而仍可合法缺失。",
    "action": "keep",
    "covered_by": "当前回复/非隔离处理仍存在；AG2 覆盖相邻主流程，不声称逐项覆盖所有 response 子路径",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-20",
    "category": "c1-transfer",
    "file": "src/contracts/architecture-inspection.ts",
    "lines": "1；同类共31文件第1行",
    "tests": [],
    "evidence": "相同 N0 来源注释共31条：contracts 下 architecture-inspection, architecture-source, artifact, command-event, context-continuity, control-intent, coordination, dispatch, evidence, fingerprint, goal-change, goal-phase, governance, human-role-collaboration, initial-planning, ledger, material-access, opaque, plan, query-job, reduction, reviewer-work, role-spec, task-envelope；contracts/core 下 call-context, identity, results, source；contracts/validation 下 common, goal, identity；均为 .ts:1。",
    "action": "delete",
    "covered_by": "纯注释无运行时行为；docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:77,92 明确移交 T，只删来源行",
    "est_lines": 31,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-21",
    "category": "n0",
    "file": "src/business/workflow/contracts.ts",
    "lines": "60-68",
    "tests": [
      "tests/composition/platform.test.ts:50,79-83::public composition 中 N0 unsupported 断言",
      "tests/business/R5b-initial-planning-workflow.test.ts:247::consumes the answer, adopts the candidate, then advances to a formal Goal completion"
    ],
    "evidence": "N0GoalInput 只剩 ports.ts:221-226、index.ts:4、workflow.ts:813-818 类型入口和 unsupported 骨架；当前测试 286-312 驱动 planning_answer/adopt_initial_plan。HANDOFF.md:683 明确移交 T。",
    "action": "change:删除 N0 输入类型、导入导出和联合成员，移除旧骨架理由，保留当前规划入口和真实边界拒绝",
    "covered_by": "N0 清理依据 HANDOFF.md:683；当前完整规划流程由 R5b-initial-planning-workflow.test.ts:247 覆盖",
    "est_lines": 17,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-22",
    "category": "legacy",
    "file": "src/app/attention-observer.ts",
    "lines": "588-599,651-715",
    "tests": [
      "tests/app/S0-attention-edge-label.test.ts:42-64,68,76,87::旧 scanner 夹具及 S0-01/02/03",
      "tests/app/S3-attention-context.test.ts:300::AT04",
      "tests/app/S3-attention-context.test.ts:462::AT11"
    ],
    "evidence": "缺 readAttentionGraph 时直接读 plans/catalog；create-platform.ts:1509-1515 总发布该方法，runtime.ts:96,737 的 skeleton/真实实现也都发布；host.ts:1444-1447 仍留可选分支。",
    "action": "change:移除直接图读取 fallback 和专用依赖，要求当前 assembler reader；旧测试改入口并保留边语义断言",
    "covered_by": "当前 scanner 有 AT04/AT11；S0 边标签和种类行为仍存在，规格行不能随旧夹具删除",
    "est_lines": 56,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-23",
    "category": "allowlist-wire-format",
    "file": "src/app/core-http-types.ts",
    "lines": "393-496",
    "tests": [
      "tests/app/S2B-35-activity-routes.test.ts:222::当前活动路由",
      "tests/app/S4C-note-routes.test.ts:71,82::当前注记和版本路由"
    ],
    "evidence": "allowlist 中 P2b 的46个 wire-format DTO 别名对应当前 goals/settings、decisions、activity、notes、versions；core-routes.ts:472-506,1140-1172 仍有表项和 dispatch。清单从 production-reach-allowlist.json:643 起。",
    "action": "keep",
    "covered_by": "当前 HTTP 请求响应仍存在，不是仅旧存储格式；活动/注记/版本路由测试保留，allowlist 完整分类交 P1 合并避免重计",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-24",
    "category": "old-data",
    "file": "src/contracts/goal-decisions.ts",
    "lines": "50-52",
    "tests": [
      "tests/work-graph/S2A-notices-rework.test.ts:37::QA-11 legacy requeues without since order by occurredAt before the commit-position requeues",
      "tests/work-graph/S5-notices.test.ts:195::NR05",
      "tests/record-store/WP2-notice-cursors.test.ts:61,78::W231"
    ],
    "evidence": "legacy 位置来自缺 since：automatic-rework-notices.ts:158-173,526-528、decision-read-model.ts:1565-1567。当前 mailbox-service.ts:297-320、requeue-service.ts:1110-1116、evidence-service.ts:352-358,1701-1702 为新记录绑定提交游标。",
    "action": "change:随 P2a 删除缺 since 通知路径，移除 NoticePositionV1 的 legacy 成员，仅计 P2b 类型一行",
    "covered_by": "QA-11 旧位置排序依 HANDOFF.md:566 退役；NR05 的损坏 origin 子情形独立保留判断；W231 当前提交游标绑定规则保留",
    "est_lines": 1,
    "spec_row": true,
    "confidence": "高"
  }
]
```

**分类合计**

`keep` 项计 0 行；跨 P2a 的实现和所有测试行数均未计入。C1 的 31 条注释合并计为一项发现。

| 类别 | 项数 | 预计涉及的 P2b 生产行数 |
|---|---:|---:|
| allowlist-kept-for | 0 | 0 |
| allowlist-pre-batch | 0 | 0 |
| allowlist-wire-format | 1 | 0 |
| old-data | 16 | 394 |
| legacy | 5 | 207 |
| c1-transfer | 1 | 31 |
| n0 | 1 | 17 |
| **合计** | **24** | **649** |

这里的两个 allowlist 零项表示本报告没有新增该类裁定，**不表示仓库没有这些条目**。P2b-23 是当前 wire 形状核对，不能再与 P1 的同批条目重复累计。

**决定 79-1 的开库提示：选项与位置，不作选择**

当前没有库级版本门槛。`src/core/record-store/migrations.ts:147-149` 先执行 `CREATE TABLE IF NOT EXISTS`，再检查四表物理结构；`src/core/record-store/sqlite-record-store.ts:158-166` 随后初始化 lookup 和文本索引。物理四表相同、内部 JSON 已过期的库，不能仅靠这项检查识别。平台还有独立正文库：`src/composition/create-platform.ts:678` 打开 `ledger.sqlite`，`:685` 打开 `artifacts.sqlite`；后者建表在 `src/core/record-store/sqlite-body-store.ts:72-82`。

可选方案：

1. **不增加库级版本，只收紧各当前 decoder。**  
   优点是改动少；代价是旧库可能成功打开，直到访问某条旧记录才报错，不能保证统一、提前提示。现有物理结构检查仍保留。

2. **增加明确的平台存储版本，开库先检查，不符即提示重建。**  
   可用 SQLite `user_version` 或平台元数据表。检查应放在 `sqlite-record-store.ts:158` 的初始化调用之前，且早于 lookup/text 索引的任何修改。空新库初始化当前版本；非空但无标记、或版本不符的库拒绝打开，给出固定重建提示，**不自动迁移或删除**。独立 `artifacts.sqlite` 也需要对应门槛，或采用能明确覆盖两库一致性的存储目录版本方案。此选项需要定义“新空库”和版本升级规则。

3. **仅把现有物理 schema 不兼容错误改为统一重建提示。**  
   插入点是 `migrations.ts:149-152` 的失败出口。改动最小，但只能覆盖物理布局不匹配，不能覆盖同四表下的旧正文格式，因此不能等同完整的“旧版本库识别”。

现有额外列容忍（`migrations.ts:130-137`）是否保留，也应跟上述选择一起裁定。不能在没有选择版本策略时，把四表检查整体删除或宣称它已经提供版本保护。Kernel 存储不应因平台两库的选择而被顺带改写。

**覆盖范围与未定事项**

本轮枚举并对 **275 个 P2b 文件**做了关键词和读取／解析入口扫描：app 17、business 10、composition 6、contracts 72、agent-runtime 47、record-store 17、workspace 27、UI 79。UI 仅分析存储和 wire 数据读取，没有开展视觉或交互改版审查。环境没有可用 `rg`，实际使用只读的 `git grep --no-index` 和 PowerShell 文本读取；没有调用 Git 写操作。

完整阅读的文件：

- `src/core/record-store/body-codec.ts:1-287`
- `src/core/record-store/body-ports.ts:1-27`
- `src/core/record-store/body-store.ts:1-80`
- `src/core/record-store/sqlite-body-store.ts:1-93`
- `src/core/record-store/migrations.ts:1-155`
- `src/core/record-store/sqlite-lookup-indexes.ts:1-141`
- `src/core/record-store/sqlite-text-scan.ts:1-359`
- `src/core/agent-runtime/kernel-store-locator.ts:1-145`
- `src/ui/state/display-preference.ts:1-216`
- `src/contracts/core/session.ts:1-66`
- `src/contracts/control-intent.ts:1-120`
- `src/contracts/reduction.ts:1-75`
- `src/contracts/architecture-source.ts:1-98`
- `src/contracts/architecture-observation.ts:1-75`
- `src/core/workspace/workspace-baseline-artifact.ts:1-71`

其余 **260 个文件按检索命中、声明及相关读写调用段略读**；主要候选沿当前写入方和测试继续追查。测试也是按相关场景定位阅读，没有将整个 `tests/` 宣称为完整审查。跨 P2a 的 writer 阅读只用于本报告所列证据。

尚需合并裁定的事项：

- P2b-01、06、09、16、17、24 必须与 P2a 合并处理：共享类型和消费方不能先于 owner／decoder 单独收紧。
- P2b-03、07、10 未找到直接钉住旧分支的测试；这不是“无需验证”的结论，也未据此增加测试任务。
- P2b-12 已找到当前两个生产入口都选择 frozen 的证据，但未把共享语言索引及全部相关测试判定为可删，故把握记为中。
- P2b-19 的无 derivation 分支有当前写入证据，应保留；相邻 AG2 测试不能被用来声称每个 response 子路径都已覆盖。
- `legacy_template` 按任务明确排除；当前版本化模板解析仍在使用，例如 `src/composition/session-duty.ts:34-36,75`。同样，真正的历史记录读取、当前默认值、真实边界坏输入拒绝和当前索引重建，不能因出现 old／legacy 字样而一起删除。