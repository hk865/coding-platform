按“节＋文件＋入口行”计数；同一入口的多个字段合并，循环和不同后端不重复计数。组外 helper 记在本组调用处，组内转发 helper 记在实际递交处。JSON 的 `line` 是行号数组。

以下“v2 允许”只判定本次新增的输入规则；后续含非公开步骤的地方单独注明，不把原有 F3、F4重新列入本次清单（`.lead-ref/books/test-rule-sheet-v2.md:27`、`:30`、`:42`）。

为避免反复展开相同调用链，使用以下说明：

- **P**：真实 owner 接收完整目录、Plan 草稿并采用；随后夹具仍有非公开 Session 建立步骤。目录见 `tests/helpers/task-claim-fixture.ts:271`，草稿和提议见 `:323`、`:344`，采用见 `:350`，非公开后续见 `:367`、`:370`。策略摘要来自真实安装返回，见 `:252`、`:258`。R3e、WP1、WP2 的额外草稿和策略步骤分别见 `tests/helpers/R3e-evidence-fixture.ts:171`、`:194`、`:209`，`tests/helpers/WP1-units-fixture.ts:168`、`:187`、`:199`，`tests/helpers/WP2-platform-support.ts:265`、`:288`、`:298`、`:621`、`:675`。
- **G**：AG2b 真实路由提交完整目录、Plan 草稿并采用；策略摘要取安装返回，HTTP token 取真实首页。见 `tests/helpers/AG2b-collaboration-fixture.ts:339`、`:354`、`:446`、`:450`、`:453`、`:461`、`:464`。Workflow 原样续传返回的 `next`，见 `tests/scenarios/harness.ts:671`。
- **H**：S8D helper 向真实 architecture owner 提交完整目录，再公开读取和比较。见 `tests/helpers/S8D-platform-fixture.ts:210`、`:219`、`:223`、`:267`。比较使用公开读取返回的 baseline 摘要原值，见 `:226`。已采用时直接复用引用，不再提交草稿，见 `:203`。
- **B**：S2B helper 真实 prepare 后原样 start，见 `tests/helpers/S2B-be1-platform-fixture.ts:303`、`:305`。

**1．A1 草稿及外部值**

| 文件：行 | owner；值 | 契约与后续 | 判定 |
|---|---|---|---|
| tests/composition/A1-graph-session-platform.test.ts:103、253、276、339 | architecture；目录初稿、修订 | 完整；103 所在用例有非公开种库（同文件:54）；253 后公开继续 | v2 允许 |
| tests/composition/A2-reconcile-classifier-platform.test.ts:57、119 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/A2-requeue-platform.test.ts:191、200 | architecture、plans；目录、planDraft | 草稿完整（同文件:128）；公开采用、Workflow 继续 | v2 允许 |
| tests/composition/A2-reverify-platform.test.ts:167、176 | architecture、plans；目录、planDraft | 草稿完整（同文件:106）；公开继续 | v2 允许 |
| tests/composition/A2-verification-chain-platform.test.ts:213、222、248 | architecture、plans；目录、初稿、修订 | 完整（同文件:139、237）；修订取公开图（同文件:233）；公开继续 | v2 允许 |
| tests/composition/AG1-session-discovery.test.ts:66、125 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/B2-runtime-platform.test.ts:26 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/C1-M1-platform.test.ts:18 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/C2-runtime-platform.test.ts:36、43 | propose_future_plan、plans、architecture；工具草稿及夹具草稿 | 工具参数在调用前补齐（同文件:47、52、63），随后真实采用、查询（同文件:69、74、89）；夹具为 P | v2 允许 |
| tests/composition/K-R-close-open-turn-health.test.ts:103、135、153、171 | architecture、plans；G 目录、草稿 | 完整；后续含内部 Kernel 操作 | v2 允许 |
| tests/composition/K-R-close-open-turn.test.ts:205、227、248 | architecture、plans；G 目录、草稿 | 完整；后续含内部 Kernel 操作 | v2 允许 |
| tests/composition/K-R-observers-kernel-closed.test.ts:52、88 | architecture、plans；G 目录、草稿 | 完整；后续含内部 Kernel 操作 | v2 允许 |
| tests/composition/K-R-previous-turn-bounds.test.ts:49 | architecture、plans；G 目录、草稿 | 完整；后续公开推进、读取（同文件:57、68、72、77） | v2 允许 |
| tests/composition/platform.test.ts:129 | plans.proposePlan；PROPOSAL_DRAFT | 完整（同文件:99）；后续公开读取（同文件:135、136） | v2 允许 |
| tests/composition/R3c-R4b-platform.test.ts:131 | plans.proposePlan；withInput | 完整（同文件:55、128），公开采用（同文件:138）；前置含种库（同文件:93） | v2 允许 |
| tests/composition/R3e-command-check-platform.test.ts:62 | plans、architecture；夹具草稿、目录 | P 及 R3e 额外草稿；完整，后续非仅公开 | v2 允许 |
| tests/composition/R3e-completion-platform.test.ts:33 | plans、architecture；夹具草稿、目录 | P 及 R3e 额外草稿；完整，后续非仅公开 | v2 允许 |
| tests/composition/R4-control-platform.test.ts:59 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/R4-control-runtime-platform.test.ts:103 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/R4c-history-platform.test.ts:10 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/R5a-project-bootstrap-platform.test.ts:134、167、284、291 | plans、architecture；Plan、目录 | 完整（同文件:51）；后续公开 | v2 允许 |
| tests/composition/R5b-query-job-platform.test.ts:174、180 | architecture、plans；目录、futureFocusDraft | 完整（同文件:79）；后续公开 | v2 允许 |
| tests/composition/R5c-workflow-platform.test.ts:167、177 | architecture、plans；目录、planDraft | 完整（同文件:118）；后续公开 | v2 允许 |
| tests/composition/S2B-39-run17-activity.test.ts:70 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/S2B-40-run20iii-activity.test.ts:52 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/S2B-be1-counting-failure.test.ts:79 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/S2B-be1-cross-hour.test.ts:17 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/S2B-be1-five-tools.test.ts:24 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/S2B-be1-step-boundaries.test.ts:17、43、73、106、132 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/S2B-be1-usage.test.ts:17 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/S2B-be1s-shell.test.ts:34、193 | plans、architecture；夹具草稿、目录 | P；完整，后续非仅公开 | v2 允许 |
| tests/composition/S4C2-platform.test.ts:36、41 | notes.writeNote、plans、architecture；NoteDraftV1、夹具草稿 | 注记完整（同文件:15），helper 原样转发（tests/helpers/S4A-note-fixture.ts:282）；后续内部读取（本文件:48、65、78） | v2 允许 |
| tests/composition/S8A-AE1-formal-comparison.test.ts:97 | architecture.adoptInitialArchitecture；目录 | 完整（同文件:95）；后续公开读取、比较（同文件:107、151、179） | v2 允许 |
| tests/composition/S8A-AE1-observation.test.ts:109 | architecture.adoptInitialArchitecture；目录 | 完整（同文件:114）；后续公开读取、比较（同文件:125、268） | v2 允许 |
| tests/composition/S8A-L8-adoption-capture.test.ts:205、221、237 | architecture；目录、修订 | 完整（同文件:200、223）；后续含 driver 通知，非仅公开 | v2 允许 |
| tests/composition/S8A-L8-capture-mappings.test.ts:113、260 | architecture.adoptInitialArchitecture；目录 | 完整；后续公开 capture、query（同文件:122、128、267） | v2 允许 |
| tests/composition/S8A-L8-pass-capture.test.ts:235、247 | architecture、plans；目录、planDraft | 完整（同文件:113）；后续含 driver 通知，非仅公开 | v2 允许 |
| tests/composition/S8D-A06-multilingual.test.ts:97、151、192 | architecture.adoptInitialArchitecture；模块、依赖目录 | H；完整，后续公开 | v2 允许 |
| tests/composition/S8D-A11-python-failure.test.ts:51 | architecture.adoptInitialArchitecture；helper 空目录 | H；完整，后续公开 | v2 允许 |
| tests/composition/W1-future-plan-platform.test.ts:159、221、237、274、281 | plans、architecture；composedDraft、changePolishDraft、夹具草稿 | 完整（同文件:97、114、267）；真实采用；含非公开种库和 P（同文件:135、189、281） | v2 允许 |
| tests/composition/W2-future-intent-platform.test.ts:147、170、185、198、208 | plans、architecture、whiteboard tools；初稿、提议／采用／查询参数 | 完整（同文件:90、95）；类型转换未掩盖缺项（同文件:182）；真实工具继续；前置含种库和 P（同文件:119、170） | v2 允许 |
| tests/composition/WP1-session-duty.test.ts:168 | plans、architecture；夹具及 WP1 草稿 | 完整；P，后续非仅公开 | v2 允许 |
| tests/composition/WP2-wiring.test.ts:29 | plans、architecture；夹具及 WP2 草稿 | 完整；P，后续非仅公开 | v2 允许 |
| tests/data/cpp-source-index.test.ts:125 | cpp_index；definitions 参数 | operation、path、line、column 完整；虽有转换，真实分支接收并执行 | v2 允许 |
| tests/data/R2e-git-operations.test.ts:409 | project_source；compare 参数 | capture/capture 分支混入 prefix，以 `as never` 递交（同文件:411），实际返回 invalid_arguments（同文件:415）；非 A6 块 | F1 |
| tests/data/S8D-A17-ts-light-scan.test.ts:58 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开 | v2 允许 |
| tests/data/S8D-A18-ts-light-scan.test.ts:26、109 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开 | v2 允许 |
| tests/data/S8D-A19-ts-light-scan.test.ts:27、43、59、78、95、111、124、145 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开 | v2 允许 |
| tests/data/S8D-A20-python-imports.test.ts:140 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开；同文件:27 仅复用已采用引用 | v2 允许 |
| tests/data/S8D-A21-python-config.test.ts:36、67、98、113、145、160、180、194、215 | python_index、architecture；imports 参数、空目录 | 36 的工具参数完整，转换未补造内容（同文件:38、84、131）；其余 H；后续公开 | v2 允许 |
| tests/data/S8D-A22-cpp-imports.test.ts:51、69、87、105、124、146、162、180、231、256、281、305、321、340、361、383、394、408 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开；同文件:39 仅复用引用 | v2 允许 |
| tests/data/S8D-A23-cpp-config.test.ts:40、56、72、90、113、136、158、178、193、207、225、242、259、275、291、307、323、338、355、372 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开 | v2 允许 |
| tests/data/S8D-A24-runner.test.ts:106、130、158 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开；取消入口在采用前返回（同文件:191；tests/helpers/S8D-platform-fixture.ts:261） | v2 允许 |
| tests/data/S8D-exploration-regressions.test.ts:45 | python_index、cpp_index；imports／symbols 参数 | 调用方给全参数（同文件:57、81、103、116）；真实工具，无忽略参数的替身；后续公开 | v2 允许 |
| tests/data/S8D-platform-fixture.test.ts:16 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开；同文件:30 仅复用目录 | v2 允许 |
| tests/data/S8E-A27-ts-light-scan-contract.test.ts:43、65 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开 | v2 允许 |
| tests/data/S8E-A28-chunk-contract.test.ts:33 | architecture.adoptInitialArchitecture；空目录 | H；完整，后续公开 | v2 允许 |

**2．A1 平台签发字段**

| 文件：行 | owner；字段 | 来源 | 判定 |
|---|---|---|---|
| tests/composition/A1-graph-session-platform.test.ts:276、339 | architecture.reviseArchitectureCatalog；basedOn.digest | 真实采用返回（同文件:253），仅包装原值（同文件:274），339 原样重放 | v2 允许 |
| tests/composition/A2-reconcile-classifier-platform.test.ts:57、62、119、125 | completionPolicies、runtime.startRun；digest、prepared | P；prepared 分别来自公开 prepare（同文件:60、123） | v2 允许 |
| tests/composition/A2-requeue-platform.test.ts:188、221、379、391、439、522、532、537 | completionPolicies、workflow、runtime；digest、prepared | 安装返回（同文件:183）；Workflow 原样 next（同文件:225、381、394、441）；start 使用 prepare 原值（同文件:510、513） | v2 允许 |
| tests/composition/A2-requeue-platform.test.ts:421 | claims.requeueTask；newInputRefs 中 digest、sizeBytes | 测试签发摘要和长度（同文件:422），经本地 write 转交（同文件:402、403）；非 A6 块 | F1 |
| tests/composition/A2-reverify-platform.test.ts:164、198 | completionPolicies、workflow；digest、prepared | 安装返回（同文件:159）；原样 next（同文件:202） | v2 允许 |
| tests/composition/A2-verification-chain-platform.test.ts:210、271 | completionPolicies、workflow；digest、prepared | 安装返回（同文件:205）；原样 next（同文件:277） | v2 允许 |
| tests/composition/AG1-session-discovery.test.ts:66、103、125、145 | completionPolicies、runtime、sessions；digest、prepared、cursor | P；prepare（同文件:100）；真实查找返回的 nextCursor（同文件:135、139、146） | v2 允许 |
| tests/composition/B2-runtime-platform.test.ts:26、41、67 | completionPolicies、runtime；digest、prepared | P；prepare 原值（同文件:39、65） | v2 允许 |
| tests/composition/C1-M1-platform.test.ts:18 | completionPolicies；target.digest | P；真实安装返回 | v2 允许 |
| tests/composition/C2-runtime-platform.test.ts:43、84 | completionPolicies、runtime；digest、prepared | P；公开 prepare 原值（同文件:81） | v2 允许 |
| tests/composition/K-R-close-open-turn-health.test.ts:103、135、153、171 | HTTP、completionPolicies、workflow；token、digest、prepared | G；真实首页、安装和 Workflow 返回 | v2 允许 |
| tests/composition/K-R-close-open-turn.test.ts:205、227、248 | HTTP、completionPolicies、workflow；token、digest、prepared | G；原样使用公开返回 | v2 允许 |
| tests/composition/K-R-observers-kernel-closed.test.ts:52、68、88、89、90、91、95 | HTTP、workflow、runtime.startQuery；token、digest、prepared | G；Query prepare→start 原样转交（tests/helpers/AG2b-collaboration-fixture.ts:553、557） | v2 允许 |
| tests/composition/K-R-previous-turn-bounds.test.ts:49、55、57、68、72、75、77 | HTTP、workflow；token、digest、prepared | G；原样使用。endPosition 仅读取、断言，不另计（同文件:63、89） | v2 允许 |
| tests/composition/platform.test.ts:68、74、87 | materials、workspace；ArtifactRef、SourceCaptureRef 摘要 | 真实 store、capture 返回（同文件:60、70）；87 使用原引用 | v2 允许 |
| tests/composition/R3c-R4b-platform.test.ts:131、148、150、273 | plans、materials、executions；ArtifactRef、atLeastCursor | ArtifactRef 来自 store（同文件:122）；游标来自 apply（同文件:138）和真实 claim（同文件:273、274） | v2 允许 |
| tests/composition/R3d-R3g-platform.test.ts:136、148、152、171、190 | architecture；PersistedSourceCaptureRef 摘要 | 真实 capture 返回（同文件:133、148）；previous、比较及历史查询原样使用 | v2 允许 |
| tests/composition/R3e-command-check-platform.test.ts:62、102 | completionPolicies、materials；digest、reportRef | P；报告取真实检查返回（同文件:89、99、100） | v2 允许 |
| tests/composition/R3e-completion-platform.test.ts:33 | completionPolicies；target.digest | P 及 R3e 的真实安装返回 | v2 允许 |
| tests/composition/R4-control-platform.test.ts:59 | completionPolicies；target.digest | P | v2 允许 |
| tests/composition/R4-control-runtime-platform.test.ts:103、135 | completionPolicies、runtime；digest、prepared | P；公开 prepare 原值（同文件:130） | v2 允许 |
| tests/composition/R4c-history-platform.test.ts:10、75 | completionPolicies、runtime.readTaskExecutionHistory；digest、afterCursor | P；真实历史页 nextCursor（同文件:69、76） | v2 允许 |
| tests/composition/R5a-project-bootstrap-platform.test.ts:155、198、221 | completionPolicies；target.digest | 真实安装返回（同文件:143、193）；221 原样重放 | v2 允许 |
| tests/composition/R5b-query-job-platform.test.ts:171 | completionPolicies；target.digest | 安装返回（同文件:166） | v2 允许 |
| tests/composition/R5c-workflow-platform.test.ts:164、195、412、458 | completionPolicies、workflow；digest、prepared | 安装返回（同文件:158）；原样 next（同文件:201、405、467） | v2 允许 |
| tests/composition/S2B-39-run17-activity.test.ts:70、80 | completionPolicies、runtime；digest、prepared | P；prepare 原值（同文件:78） | v2 允许 |
| tests/composition/S2B-40-run20iii-activity.test.ts:52、58 | completionPolicies、runtime；digest、prepared | P；prepare 原值（同文件:56） | v2 允许 |
| tests/composition/S2B-be1-counting-failure.test.ts:79、104 | completionPolicies、runtime；digest、prepared | P、B | v2 允许 |
| tests/composition/S2B-be1-cross-hour.test.ts:17、35 | completionPolicies、runtime；digest、prepared | P、B | v2 允许 |
| tests/composition/S2B-be1-five-tools.test.ts:24、46 | completionPolicies、runtime；digest、prepared | P、B | v2 允许 |
| tests/composition/S2B-be1-five-tools.test.ts:31、34 | edit；expectedRevision | revOf 从测试文件正文自行计算（同文件:18），填入参数（同文件:32、35），不是公开 read 返回 | F1 |
| tests/composition/S2B-be1-step-boundaries.test.ts:17、30、43、60、73、85、106、118、132、146 | completionPolicies、runtime；digest、prepared | P、B | v2 允许 |
| tests/composition/S2B-be1-usage.test.ts:17、35 | completionPolicies、runtime；digest、prepared | P、B | v2 允许 |
| tests/composition/S2B-be1s-shell.test.ts:34、49、107、184、193、205 | completionPolicies、runtime；digest、prepared | P、B；49 取同文件:47 的 prepare 原值 | v2 允许 |
| tests/composition/S4C2-platform.test.ts:41 | completionPolicies；target.digest | 真实安装返回（tests/helpers/S4A-note-fixture.ts:183、187、190） | v2 允许 |
| tests/composition/S8A-AE1-formal-comparison.test.ts:151、179 | architecture.compareFormalObserved；baseline.digest | 公开 read 返回（同文件:107），仅包装原值（同文件:110） | v2 允许 |
| tests/composition/S8A-AE1-observation.test.ts:179、222、268 | architecture；cursor、baseline.digest | 游标来自真实首页（同文件:170）；摘要来自公开目录（同文件:125） | v2 允许 |
| tests/composition/S8A-L8-adoption-capture.test.ts:221、258 | architecture；baseline.digest | 公开目录原值（同文件:215、250），仅包装（同文件:224、256） | v2 允许 |
| tests/composition/S8A-L8-adoption-capture.test.ts:174、180 | architecture.captureSourceChanges、queryArchitecture；requestSeq、selection.capture | 175 测试签发 requestSeq；公开路由明确禁止此字段（src/app/core-routes.ts:573）。180 使用这次 driver 专用重放取得的引用，不是合法公开步骤返回 | F1 |
| tests/composition/S8A-L8-capture-mappings.test.ts:128、150、175、212 | architecture.queryArchitecture；selection.capture | 真实 capture 返回原值（同文件:122、144、169、197） | v2 允许 |
| tests/composition/S8A-L8-pass-capture.test.ts:229、315 | completionPolicies、workflow；digest、prepared | 安装返回（同文件:223）；原样 next（同文件:321） | v2 允许 |
| tests/composition/S8D-A06-multilingual.test.ts:113、174、208 | architecture.compareFormalObserved；baseline.digest | H；分别在同文件:97、151、192 采用后公开读取 | v2 允许 |
| tests/composition/S8D-A11-python-failure.test.ts:51 | architecture.compareFormalObserved；baseline.digest | H | v2 允许 |
| tests/composition/W1-future-plan-platform.test.ts:281 | completionPolicies；target.digest | P | v2 允许 |
| tests/composition/W2-future-intent-platform.test.ts:170 | completionPolicies；target.digest | P | v2 允许 |
| tests/composition/WP1-session-duty.test.ts:168 | completionPolicies；target.digest | P 及 WP1 真实安装返回 | v2 允许 |
| tests/composition/WP2-wiring.test.ts:29、110、126、146、196、234、296、315、360、362、380、399、436、452、486、489、513、622、654、671、755、776、851、925、944、1004、1059、1100、1114、1161、1200、1385、1389、1499、1632、1785、1882、1920、1934、2033、2037 | completionPolicies、runtime、workspaceDecisionSettings、materials；digest、prepared、displayToken、seenThrough、材料引用 | 29 为 P；各 start 使用相邻 prepare 原值；362／489 取360／486；1920 取1917。146／851 使用真实队列页（同文件:142、844）。材料引用来自真实 prepare→open（tests/helpers/WP2-platform-support.ts:917、919），或公开 execution／consultation（本文件:374、619、668） | v2 允许 |
| tests/data/R2e-git-operations.test.ts:373、375、378、380、409 | workspace.compareWorkspace、project_source；sourceDigest、configDigest | 测试签发引用（同文件:356、357、402、403）；这些拒绝用例不在 A6 块 | F1 |
| tests/data/R3b-material-admission-boundaries.test.ts:46、48、50、59、71、83、93、114、116 | materials.openArtifact；ArtifactRef.digest、sizeBytes | 测试计算并包装（同文件:12、29），依赖替身提供记录（同文件:34、56、68、81、91、101），无真实公开签发 | F1 |
| tests/data/R3b-material-await-boundaries.test.ts:52、54 | materials.openArtifact；ArtifactRef.digest、sizeBytes | 测试计算（同文件:14），替身返回记录（同文件:45） | F1 |
| tests/data/R3b-materials-contract.test.ts:85、86、88、90、96 | materials.openArtifact；ArtifactRef.digest、sizeBytes | readyBody 测试计算并制造返回记录（同文件:28、32） | F1 |
| tests/data/S8A-file-graph.test.ts:79、239 | workspace.captureFileGraph、verifyCapture；SourceCaptureRef 摘要 | 真实 capture 返回（同文件:73、76），原样使用 | v2 允许 |
| tests/data/S8D-A17-ts-light-scan.test.ts:58 | architecture.compareFormalObserved；baseline.digest | H | v2 允许 |
| tests/data/S8D-A18-ts-light-scan.test.ts:26、76、109 | architecture；baseline.digest、selection.capture | 26／109 为 H；76 使用真实 capture.persisted（同文件:65） | v2 允许 |
| tests/data/S8D-A19-ts-light-scan.test.ts:27、43、59、78、95、111、124、145 | architecture.compareFormalObserved；baseline.digest | H | v2 允许 |
| tests/data/S8D-A20-python-imports.test.ts:28、140 | architecture.compareFormalObserved；baseline.digest | H；28 复用已公开读取的引用 | v2 允许 |
| tests/data/S8D-A21-python-config.test.ts:67、98、113、145、160、180、194、215 | architecture.compareFormalObserved；baseline.digest | H | v2 允许 |
| tests/data/S8D-A22-cpp-imports.test.ts:40、51、69、87、105、124、146、162、180、231、256、281、305、321、340、361、383、394、408 | architecture.compareFormalObserved；baseline.digest | H；40 复用已公开读取的引用 | v2 允许 |
| tests/data/S8D-A23-cpp-config.test.ts:40、56、72、90、113、136、158、178、193、207、225、242、259、275、291、307、323、338、355、372 | architecture.compareFormalObserved；baseline.digest | H | v2 允许 |
| tests/data/S8D-A24-runner.test.ts:106、130、158 | architecture.compareFormalObserved；baseline.digest | H | v2 允许 |
| tests/data/S8D-exploration-regressions.test.ts:45 | — | 此入口只属于第1节；无签发字段，故本节不计 | — |
| tests/data/S8D-language-providers.test.ts:77 | workspace.captureFileGraph；SourceCaptureRef 摘要 | 真实 capture 返回（同文件:72、76） | v2 允许 |
| tests/data/S8D-platform-fixture.test.ts:16、30 | architecture.compareFormalObserved；baseline.digest | H；30 原样复用目录引用 | v2 允许 |
| tests/data/S8E-A09-scale.test.ts:24、53 | architecture.listFiles、queryArchitecture；cursor、capture 摘要 | 游标取前页（同文件:28）；capture 取真实返回（同文件:52） | v2 允许 |
| tests/data/S8E-A11-lightscan-fault.test.ts:22、56 | architecture.queryArchitecture、workspace.querySource；capture 摘要 | 真实返回（同文件:37、50）；23 的类型转换未改造内容 | v2 允许 |
| tests/data/S8E-A15-previous-observation.test.ts:42 | architecture.captureSourceChanges；previous 摘要 | 原样使用首次 capture.persisted（同文件:27） | v2 允许 |
| tests/data/S8E-A25-strict-capture.test.ts:76、78、79 | workspace.exportCapture、captureArchitectureSource、captureFileGraph；capture 摘要 | 实参来自真实 capture（同文件:88、103、121） | v2 允许 |
| tests/data/S8E-A27-ts-light-scan-contract.test.ts:43、65 | architecture.compareFormalObserved；baseline.digest | H | v2 允许 |
| tests/data/S8E-A28-chunk-contract.test.ts:33 | architecture.compareFormalObserved；baseline.digest | H | v2 允许 |
| tests/data/S8E-file-fault-module-layer.test.ts:32 | architecture.queryArchitecture；capture 摘要 | 真实 capture.persisted（同文件:30） | v2 允许 |
| tests/data/workspace-capture-architecture.test.ts:107、108、166、167 | workspace.captureArchitectureSource、releaseCapture；capture 摘要 | 真实 capture 返回原值（同文件:104、159） | v2 允许 |
| tests/data/workspace-capture.test.ts:108、110、135、139、166、198、199、200、219、229、230、231、251、253、260、261、262、263、265、276、279、280、291、295、301、311、347、355、362、389、391、392、402、408、411、436、456、478、480、486、489、491、536、537、569、602、615、619 | workspace；capture 摘要、previous、cursor | 使用真实 capture 返回及前页游标；来源见同文件:122、160、225、226、345、386、400、533、534。345 的结果被修改前已复制原引用（同文件:346），后续使用未改值 | v2 允许 |
| tests/data/workspace-capture.test.ts:237 | workspace.exportCapture；sourceDigest、configDigest | 测试改写成零摘要（同文件:233）；拒绝用例不在 A6 块 | F1 |
| tests/data/workspace-text-operations.test.ts:139、141、143、230、237、239、265、336、339、344、428、433、465、478、487、511、513、541、542、586 | workspace.querySource、readWorkspace、compareWorkspace；capture 摘要、cursor | 真实 capture 返回，经 helper 原样转交（同文件:137、139）；游标取前页（同文件:154、157、342） | v2 允许 |
| tests/data/workspace-text-operations.test.ts:432 | workspace.compareWorkspace；sourceDigest | 测试把公开引用中的摘要改成全零；非 A6 块 | F1 |

**3．Record-store 测试**

| 范围 | 实例 |
|---|---|
| L5 清单为 composition、data（.lead-ref/groups/L5-files.txt:1、46、98）；该例外只覆盖 tests/record-store 及专用 helper（.lead-ref/books/test-rule-sheet-v2.md:38） | 无；本节不列上层手工记录，也不计 F3 |

**4．A7**

| 点名 helper | L5 使用情况 |
|---|---|
| buildNoteTools（.lead-ref/books/test-rule-sheet-v2.md:45） | 本组及所追踪的 helper 调用链无使用 |
| damageKernel（.lead-ref/books/test-rule-sheet-v2.md:50） | 本组及所追踪的 helper 调用链无使用 |
| process-sandbox-standin.ts 的 probe（.lead-ref/books/test-rule-sheet-v2.md:59） | 本组及所追踪的 helper 调用链无使用；`tests/composition/R3e-command-check-platform.test.ts:28` 的同名 probe 调用真实实现（同文件:30），不是点名替身 |

**无实例文件**

以下文件没有本次四类实例；引用行指向其实际测试或输入位置：

- tests/composition/K3-R1-close-open-turn.test.ts:52
- tests/data/R2e-text-boundaries.test.ts:85
- tests/data/R3b-body-boundaries.test.ts:22
- tests/data/S8D-capture-error.test.ts:40
- tests/data/S8D-compact-snapshot.test.ts:44
- tests/data/S8D-cpp-import-graph-script.test.ts:73
- tests/data/S8D-formal-unresolved-reason.test.ts:23
- tests/data/S8D-observation-inventory.test.ts:104
- tests/data/S8D-observed-v2-codecs.test.ts:59
- tests/data/S8D-python-import-graph-script.test.ts:95
- tests/data/S8E-A07-git-inventory.test.ts:26
- tests/data/S8E-A08-skip-list.test.ts:24
- tests/data/S8E-A12-file-chunks.test.ts:63
- tests/data/S8E-A13-edge-cap.test.ts:26
- tests/data/S8E-A14-narrowed-grant.test.ts:24
- tests/data/S8E-A23-ignored-databases.test.ts:43
- tests/data/S8E-A26-git-classification.test.ts:115
- tests/data/S8E-old-format-rejection.test.ts:52
- tests/data/analysis-runner.test.ts:130
- tests/data/candidate-workspace-reader.test.ts:20
- tests/data/project-source-snapshot.test.ts:26
- tests/data/python-source-index.test.ts:20
- tests/data/source-index.test.ts:20
- tests/data/typescript-source-query.test.ts:44
- tests/data/typescript-source-reuse.test.ts:18
- tests/data/workspace-capture-access.test.ts:94
- tests/data/workspace-path-boundary.test.ts:10

```json
[
  {"section":"A1草稿","file":"tests/composition/A1-graph-session-platform.test.ts","line":[103,253,276,339],"owner":"architecture","value":"目录初稿、修订","verdict":"v2 允许","note":"完整；103含非公开前置；253后公开继续"},
  {"section":"A1草稿","file":"tests/composition/A2-reconcile-classifier-platform.test.ts","line":[57,119],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/A2-requeue-platform.test.ts","line":[191,200],"owner":"architecture、plans","value":"目录、planDraft","verdict":"v2 允许","note":"完整；公开采用、Workflow继续"},
  {"section":"A1草稿","file":"tests/composition/A2-reverify-platform.test.ts","line":[167,176],"owner":"architecture、plans","value":"目录、planDraft","verdict":"v2 允许","note":"完整；公开继续"},
  {"section":"A1草稿","file":"tests/composition/A2-verification-chain-platform.test.ts","line":[213,222,248],"owner":"architecture、plans","value":"目录、初稿、未来修订","verdict":"v2 允许","note":"完整；修订取公开图；公开继续"},
  {"section":"A1草稿","file":"tests/composition/AG1-session-discovery.test.ts","line":[66,125],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/B2-runtime-platform.test.ts","line":[26],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/C1-M1-platform.test.ts","line":[18],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/C2-runtime-platform.test.ts","line":[36,43],"owner":"propose_future_plan、plans、architecture","value":"工具Plan草稿、夹具草稿和目录","verdict":"v2 允许","note":"工具参数63补齐后真实采用、查询；夹具P"},
  {"section":"A1草稿","file":"tests/composition/K-R-close-open-turn-health.test.ts","line":[103,135,153,171],"owner":"architecture、plans","value":"AG2b目录、Plan草稿","verdict":"v2 允许","note":"G；完整；后续含内部Kernel操作"},
  {"section":"A1草稿","file":"tests/composition/K-R-close-open-turn.test.ts","line":[205,227,248],"owner":"architecture、plans","value":"AG2b目录、Plan草稿","verdict":"v2 允许","note":"G；完整；后续含内部Kernel操作"},
  {"section":"A1草稿","file":"tests/composition/K-R-observers-kernel-closed.test.ts","line":[52,88],"owner":"architecture、plans","value":"AG2b目录、Plan草稿","verdict":"v2 允许","note":"G；完整；后续含内部Kernel操作"},
  {"section":"A1草稿","file":"tests/composition/K-R-previous-turn-bounds.test.ts","line":[49],"owner":"architecture、plans","value":"AG2b目录、Plan草稿","verdict":"v2 允许","note":"G；完整；后续公开推进、读取"},
  {"section":"A1草稿","file":"tests/composition/platform.test.ts","line":[129],"owner":"plans.proposePlan","value":"PROPOSAL_DRAFT","verdict":"v2 允许","note":"完整；后续公开读取"},
  {"section":"A1草稿","file":"tests/composition/R3c-R4b-platform.test.ts","line":[131],"owner":"plans.proposePlan","value":"withInput","verdict":"v2 允许","note":"完整；公开采用；前置含种库"},
  {"section":"A1草稿","file":"tests/composition/R3e-command-check-platform.test.ts","line":[62],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P及R3e额外草稿；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/R3e-completion-platform.test.ts","line":[33],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P及R3e额外草稿；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/R4-control-platform.test.ts","line":[59],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/R4-control-runtime-platform.test.ts","line":[103],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/R4c-history-platform.test.ts","line":[10],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/R5a-project-bootstrap-platform.test.ts","line":[134,167,284,291],"owner":"plans、architecture","value":"Plan、目录","verdict":"v2 允许","note":"完整；后续公开"},
  {"section":"A1草稿","file":"tests/composition/R5b-query-job-platform.test.ts","line":[174,180],"owner":"architecture、plans","value":"目录、futureFocusDraft","verdict":"v2 允许","note":"完整；后续公开"},
  {"section":"A1草稿","file":"tests/composition/R5c-workflow-platform.test.ts","line":[167,177],"owner":"architecture、plans","value":"目录、planDraft","verdict":"v2 允许","note":"完整；后续公开"},
  {"section":"A1草稿","file":"tests/composition/S2B-39-run17-activity.test.ts","line":[70],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S2B-40-run20iii-activity.test.ts","line":[52],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S2B-be1-counting-failure.test.ts","line":[79],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S2B-be1-cross-hour.test.ts","line":[17],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S2B-be1-five-tools.test.ts","line":[24],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S2B-be1-step-boundaries.test.ts","line":[17,43,73,106,132],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S2B-be1-usage.test.ts","line":[17],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S2B-be1s-shell.test.ts","line":[34,193],"owner":"plans、architecture","value":"夹具Plan草稿、目录","verdict":"v2 允许","note":"P；完整；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S4C2-platform.test.ts","line":[36,41],"owner":"notes.writeNote、plans、architecture","value":"NoteDraftV1、夹具Plan和目录","verdict":"v2 允许","note":"完整、原样转发；后续内部readContextFacts，非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S8A-AE1-formal-comparison.test.ts","line":[97],"owner":"architecture.adoptInitialArchitecture","value":"目录","verdict":"v2 允许","note":"完整；公开读取、比较"},
  {"section":"A1草稿","file":"tests/composition/S8A-AE1-observation.test.ts","line":[109],"owner":"architecture.adoptInitialArchitecture","value":"目录","verdict":"v2 允许","note":"完整；公开读取、比较"},
  {"section":"A1草稿","file":"tests/composition/S8A-L8-adoption-capture.test.ts","line":[205,221,237],"owner":"architecture","value":"目录、修订","verdict":"v2 允许","note":"完整；后续含driver通知，非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S8A-L8-capture-mappings.test.ts","line":[113,260],"owner":"architecture.adoptInitialArchitecture","value":"目录","verdict":"v2 允许","note":"完整；后续公开capture、query"},
  {"section":"A1草稿","file":"tests/composition/S8A-L8-pass-capture.test.ts","line":[235,247],"owner":"architecture、plans","value":"目录、planDraft","verdict":"v2 允许","note":"完整；后续含driver通知，非仅公开"},
  {"section":"A1草稿","file":"tests/composition/S8D-A06-multilingual.test.ts","line":[97,151,192],"owner":"architecture.adoptInitialArchitecture","value":"模块、依赖目录","verdict":"v2 允许","note":"H；完整；后续公开"},
  {"section":"A1草稿","file":"tests/composition/S8D-A11-python-failure.test.ts","line":[51],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开"},
  {"section":"A1草稿","file":"tests/composition/W1-future-plan-platform.test.ts","line":[159,221,237,274,281],"owner":"plans、architecture","value":"composedDraft、changePolishDraft、夹具草稿","verdict":"v2 允许","note":"完整；真实采用；含种库、竞态端口及P"},
  {"section":"A1草稿","file":"tests/composition/W2-future-intent-platform.test.ts","line":[147,170,185,198,208],"owner":"plans、architecture、whiteboard tools","value":"初稿、提议及采用查询参数","verdict":"v2 允许","note":"完整；类型转换未掩盖缺项；真实工具；前置含种库及P"},
  {"section":"A1草稿","file":"tests/composition/WP1-session-duty.test.ts","line":[168],"owner":"plans、architecture","value":"夹具及WP1草稿、目录","verdict":"v2 允许","note":"完整；P；后续非仅公开"},
  {"section":"A1草稿","file":"tests/composition/WP2-wiring.test.ts","line":[29],"owner":"plans、architecture","value":"夹具及WP2草稿、目录","verdict":"v2 允许","note":"完整；P；后续非仅公开"},
  {"section":"A1草稿","file":"tests/data/cpp-source-index.test.ts","line":[125],"owner":"cpp_index","value":"definitions参数","verdict":"v2 允许","note":"参数完整；as never未掩盖缺项；真实工具"},
  {"section":"A1草稿","file":"tests/data/R2e-git-operations.test.ts","line":[409],"owner":"project_source","value":"compare参数","verdict":"F1","note":"capture/capture分支混入prefix并强转；实际拒绝；非A6块"},
  {"section":"A1草稿","file":"tests/data/S8D-A17-ts-light-scan.test.ts","line":[58],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开"},
  {"section":"A1草稿","file":"tests/data/S8D-A18-ts-light-scan.test.ts","line":[26,109],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开"},
  {"section":"A1草稿","file":"tests/data/S8D-A19-ts-light-scan.test.ts","line":[27,43,59,78,95,111,124,145],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开"},
  {"section":"A1草稿","file":"tests/data/S8D-A20-python-imports.test.ts","line":[140],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开；27仅复用引用"},
  {"section":"A1草稿","file":"tests/data/S8D-A21-python-config.test.ts","line":[36,67,98,113,145,160,180,194,215],"owner":"python_index、architecture.adoptInitialArchitecture","value":"imports参数、空目录","verdict":"v2 允许","note":"36完整，强转不改内容；其余H；后续公开"},
  {"section":"A1草稿","file":"tests/data/S8D-A22-cpp-imports.test.ts","line":[51,69,87,105,124,146,162,180,231,256,281,305,321,340,361,383,394,408],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开；39仅复用引用"},
  {"section":"A1草稿","file":"tests/data/S8D-A23-cpp-config.test.ts","line":[40,56,72,90,113,136,158,178,193,207,225,242,259,275,291,307,323,338,355,372],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开"},
  {"section":"A1草稿","file":"tests/data/S8D-A24-runner.test.ts","line":[106,130,158],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开；取消路径未采用不计"},
  {"section":"A1草稿","file":"tests/data/S8D-exploration-regressions.test.ts","line":[45],"owner":"python_index、cpp_index","value":"imports、symbols参数","verdict":"v2 允许","note":"完整；真实工具，无忽略请求替身；后续公开"},
  {"section":"A1草稿","file":"tests/data/S8D-platform-fixture.test.ts","line":[16],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开；30仅复用引用"},
  {"section":"A1草稿","file":"tests/data/S8E-A27-ts-light-scan-contract.test.ts","line":[43,65],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开"},
  {"section":"A1草稿","file":"tests/data/S8E-A28-chunk-contract.test.ts","line":[33],"owner":"architecture.adoptInitialArchitecture","value":"空目录","verdict":"v2 允许","note":"H；完整；后续公开"},

  {"section":"A1签发字段","file":"tests/composition/A1-graph-session-platform.test.ts","line":[276,339],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"253真实采用返回；274仅包装；339原样重放"},
  {"section":"A1签发字段","file":"tests/composition/A2-reconcile-classifier-platform.test.ts","line":[57,62,119,125],"owner":"completionPolicies、runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"P；prepared来自60、123真实prepare"},
  {"section":"A1签发字段","file":"tests/composition/A2-requeue-platform.test.ts","line":[188,221,379,391,439,522,532,537],"owner":"completionPolicies、workflow、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"183安装；Workflow原样next；510、513真实prepare"},
  {"section":"A1签发字段","file":"tests/composition/A2-requeue-platform.test.ts","line":[421],"owner":"claims.requeueTask","value":"newInputRefs内digest、sizeBytes","verdict":"F1","note":"422测试签发；402、403转交；非A6块"},
  {"section":"A1签发字段","file":"tests/composition/A2-reverify-platform.test.ts","line":[164,198],"owner":"completionPolicies、workflow","value":"target.digest、prepared","verdict":"v2 允许","note":"159安装返回；202原样next"},
  {"section":"A1签发字段","file":"tests/composition/A2-verification-chain-platform.test.ts","line":[210,271],"owner":"completionPolicies、workflow","value":"target.digest、prepared","verdict":"v2 允许","note":"205安装返回；277原样next"},
  {"section":"A1签发字段","file":"tests/composition/AG1-session-discovery.test.ts","line":[66,103,125,145],"owner":"completionPolicies、runtime、sessions","value":"target.digest、prepared、cursor","verdict":"v2 允许","note":"P；100 prepare；135查找返回的nextCursor原样使用"},
  {"section":"A1签发字段","file":"tests/composition/B2-runtime-platform.test.ts","line":[26,41,67],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P；39、65 prepare原值"},
  {"section":"A1签发字段","file":"tests/composition/C1-M1-platform.test.ts","line":[18],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"P；真实安装返回"},
  {"section":"A1签发字段","file":"tests/composition/C2-runtime-platform.test.ts","line":[43,84],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P；81 prepare原值"},
  {"section":"A1签发字段","file":"tests/composition/K-R-close-open-turn-health.test.ts","line":[103,135,153,171],"owner":"HTTP、completionPolicies、workflow","value":"token、digest、prepared","verdict":"v2 允许","note":"G；真实公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/composition/K-R-close-open-turn.test.ts","line":[205,227,248],"owner":"HTTP、completionPolicies、workflow","value":"token、digest、prepared","verdict":"v2 允许","note":"G；真实公开返回原样使用"},
  {"section":"A1签发字段","file":"tests/composition/K-R-observers-kernel-closed.test.ts","line":[52,68,88,89,90,91,95],"owner":"HTTP、workflow、runtime.startQuery","value":"token、digest、prepared","verdict":"v2 允许","note":"G；Query真实prepare后原样start"},
  {"section":"A1签发字段","file":"tests/composition/K-R-previous-turn-bounds.test.ts","line":[49,55,57,68,72,75,77],"owner":"HTTP、workflow","value":"token、digest、prepared","verdict":"v2 允许","note":"G；endPosition仅读取断言，不计输入"},
  {"section":"A1签发字段","file":"tests/composition/platform.test.ts","line":[68,74,87],"owner":"materials、workspace","value":"ArtifactRef、SourceCaptureRef摘要","verdict":"v2 允许","note":"60 store、70 capture真实返回"},
  {"section":"A1签发字段","file":"tests/composition/R3c-R4b-platform.test.ts","line":[131,148,150,273],"owner":"plans、materials、executions","value":"ArtifactRef、atLeastCursor","verdict":"v2 允许","note":"122 store.ref；138 apply.cursor；真实claim.cursor"},
  {"section":"A1签发字段","file":"tests/composition/R3d-R3g-platform.test.ts","line":[136,148,152,171,190],"owner":"architecture","value":"PersistedSourceCaptureRef摘要","verdict":"v2 允许","note":"133、148真实capture返回原值"},
  {"section":"A1签发字段","file":"tests/composition/R3e-command-check-platform.test.ts","line":[62,102],"owner":"completionPolicies、materials","value":"target.digest、reportRef","verdict":"v2 允许","note":"P；89真实检查，99、100取reportRef"},
  {"section":"A1签发字段","file":"tests/composition/R3e-completion-platform.test.ts","line":[33],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"P及R3e真实安装返回"},
  {"section":"A1签发字段","file":"tests/composition/R4-control-platform.test.ts","line":[59],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"P"},
  {"section":"A1签发字段","file":"tests/composition/R4-control-runtime-platform.test.ts","line":[103,135],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P；130 prepare原值"},
  {"section":"A1签发字段","file":"tests/composition/R4c-history-platform.test.ts","line":[10,75],"owner":"completionPolicies、runtime.readTaskExecutionHistory","value":"target.digest、afterCursor","verdict":"v2 允许","note":"P；69真实页nextCursor，76原样传入"},
  {"section":"A1签发字段","file":"tests/composition/R5a-project-bootstrap-platform.test.ts","line":[155,198,221],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"143、193安装结果；221原样重放"},
  {"section":"A1签发字段","file":"tests/composition/R5b-query-job-platform.test.ts","line":[171],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"166安装结果"},
  {"section":"A1签发字段","file":"tests/composition/R5c-workflow-platform.test.ts","line":[164,195,412,458],"owner":"completionPolicies、workflow","value":"target.digest、prepared","verdict":"v2 允许","note":"158安装；201、405、467公开next原样使用"},
  {"section":"A1签发字段","file":"tests/composition/S2B-39-run17-activity.test.ts","line":[70,80],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P；78 prepare原值"},
  {"section":"A1签发字段","file":"tests/composition/S2B-40-run20iii-activity.test.ts","line":[52,58],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P；56 prepare原值"},
  {"section":"A1签发字段","file":"tests/composition/S2B-be1-counting-failure.test.ts","line":[79,104],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P、B"},
  {"section":"A1签发字段","file":"tests/composition/S2B-be1-cross-hour.test.ts","line":[17,35],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P、B"},
  {"section":"A1签发字段","file":"tests/composition/S2B-be1-five-tools.test.ts","line":[24,46],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P、B"},
  {"section":"A1签发字段","file":"tests/composition/S2B-be1-five-tools.test.ts","line":[31,34],"owner":"edit","value":"expectedRevision","verdict":"F1","note":"18 revOf从测试正文计算；32、35填入；无公开read签发"},
  {"section":"A1签发字段","file":"tests/composition/S2B-be1-step-boundaries.test.ts","line":[17,30,43,60,73,85,106,118,132,146],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P、B"},
  {"section":"A1签发字段","file":"tests/composition/S2B-be1-usage.test.ts","line":[17,35],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P、B"},
  {"section":"A1签发字段","file":"tests/composition/S2B-be1s-shell.test.ts","line":[34,49,107,184,193,205],"owner":"completionPolicies、runtime","value":"target.digest、prepared","verdict":"v2 允许","note":"P、B；49取47 prepare原值"},
  {"section":"A1签发字段","file":"tests/composition/S4C2-platform.test.ts","line":[41],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"S4A helper183安装，187至190原样使用"},
  {"section":"A1签发字段","file":"tests/composition/S8A-AE1-formal-comparison.test.ts","line":[151,179],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"107公开read；110仅包装原值"},
  {"section":"A1签发字段","file":"tests/composition/S8A-AE1-observation.test.ts","line":[179,222,268],"owner":"architecture","value":"cursor、baseline.digest","verdict":"v2 允许","note":"170真实页nextCursor；125公开目录"},
  {"section":"A1签发字段","file":"tests/composition/S8A-L8-adoption-capture.test.ts","line":[221,258],"owner":"architecture","value":"baseline.digest","verdict":"v2 允许","note":"215、250公开目录原值；224、256仅包装"},
  {"section":"A1签发字段","file":"tests/composition/S8A-L8-adoption-capture.test.ts","line":[174,180],"owner":"architecture.captureSourceChanges、queryArchitecture","value":"requestSeq、selection.capture","verdict":"F1","note":"175测试签发；路由573禁止；180使用driver专用重放结果"},
  {"section":"A1签发字段","file":"tests/composition/S8A-L8-capture-mappings.test.ts","line":[128,150,175,212],"owner":"architecture.queryArchitecture","value":"selection.capture摘要","verdict":"v2 允许","note":"122、144、169、197真实capture.value原样传入"},
  {"section":"A1签发字段","file":"tests/composition/S8A-L8-pass-capture.test.ts","line":[229,315],"owner":"completionPolicies、workflow","value":"target.digest、prepared","verdict":"v2 允许","note":"223安装结果；321原样next"},
  {"section":"A1签发字段","file":"tests/composition/S8D-A06-multilingual.test.ts","line":[113,174,208],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H；对应97、151、192采用后的公开read"},
  {"section":"A1签发字段","file":"tests/composition/S8D-A11-python-failure.test.ts","line":[51],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H"},
  {"section":"A1签发字段","file":"tests/composition/W1-future-plan-platform.test.ts","line":[281],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"P"},
  {"section":"A1签发字段","file":"tests/composition/W2-future-intent-platform.test.ts","line":[170],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"P"},
  {"section":"A1签发字段","file":"tests/composition/WP1-session-duty.test.ts","line":[168],"owner":"completionPolicies","value":"target.digest","verdict":"v2 允许","note":"P及WP1真实安装返回"},
  {"section":"A1签发字段","file":"tests/composition/WP2-wiring.test.ts","line":[29,110,126,146,196,234,296,315,360,362,380,399,436,452,486,489,513,622,654,671,755,776,851,925,944,1004,1059,1100,1114,1161,1200,1385,1389,1499,1632,1785,1882,1920,1934,2033,2037],"owner":"completionPolicies、runtime、workspaceDecisionSettings、materials","value":"digest、prepared、displayToken、seenThrough、材料引用","verdict":"v2 允许","note":"P；prepare原值；142、844真实队列页；材料来自prepare或公开execution、consultation，来源详见表"},
  {"section":"A1签发字段","file":"tests/data/R2e-git-operations.test.ts","line":[373,375,378,380,409],"owner":"workspace.compareWorkspace、project_source","value":"sourceDigest、configDigest","verdict":"F1","note":"356、357、402、403测试签发；非A6块"},
  {"section":"A1签发字段","file":"tests/data/R3b-material-admission-boundaries.test.ts","line":[46,48,50,59,71,83,93,114,116],"owner":"materials.openArtifact","value":"ArtifactRef.digest、sizeBytes","verdict":"F1","note":"12计算、29包装；记录替身提供；无真实公开签发"},
  {"section":"A1签发字段","file":"tests/data/R3b-material-await-boundaries.test.ts","line":[52,54],"owner":"materials.openArtifact","value":"ArtifactRef.digest、sizeBytes","verdict":"F1","note":"14测试计算；45替身返回记录"},
  {"section":"A1签发字段","file":"tests/data/R3b-materials-contract.test.ts","line":[85,86,88,90,96],"owner":"materials.openArtifact","value":"ArtifactRef.digest、sizeBytes","verdict":"F1","note":"28、32 readyBody测试计算并制造返回记录"},
  {"section":"A1签发字段","file":"tests/data/S8A-file-graph.test.ts","line":[79,239],"owner":"workspace.captureFileGraph、verifyCapture","value":"SourceCaptureRef摘要","verdict":"v2 允许","note":"73、76真实capture返回"},
  {"section":"A1签发字段","file":"tests/data/S8D-A17-ts-light-scan.test.ts","line":[58],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H"},
  {"section":"A1签发字段","file":"tests/data/S8D-A18-ts-light-scan.test.ts","line":[26,76,109],"owner":"architecture","value":"baseline.digest、selection.capture","verdict":"v2 允许","note":"26、109为H；76取65真实capture.persisted"},
  {"section":"A1签发字段","file":"tests/data/S8D-A19-ts-light-scan.test.ts","line":[27,43,59,78,95,111,124,145],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H"},
  {"section":"A1签发字段","file":"tests/data/S8D-A20-python-imports.test.ts","line":[28,140],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H；28复用原引用"},
  {"section":"A1签发字段","file":"tests/data/S8D-A21-python-config.test.ts","line":[67,98,113,145,160,180,194,215],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H"},
  {"section":"A1签发字段","file":"tests/data/S8D-A22-cpp-imports.test.ts","line":[40,51,69,87,105,124,146,162,180,231,256,281,305,321,340,361,383,394,408],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H；40复用原引用"},
  {"section":"A1签发字段","file":"tests/data/S8D-A23-cpp-config.test.ts","line":[40,56,72,90,113,136,158,178,193,207,225,242,259,275,291,307,323,338,355,372],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H"},
  {"section":"A1签发字段","file":"tests/data/S8D-A24-runner.test.ts","line":[106,130,158],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H"},
  {"section":"A1签发字段","file":"tests/data/S8D-language-providers.test.ts","line":[77],"owner":"workspace.captureFileGraph","value":"SourceCaptureRef摘要","verdict":"v2 允许","note":"72、76真实capture返回"},
  {"section":"A1签发字段","file":"tests/data/S8D-platform-fixture.test.ts","line":[16,30],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H；30复用原引用"},
  {"section":"A1签发字段","file":"tests/data/S8E-A09-scale.test.ts","line":[24,53],"owner":"architecture.listFiles、queryArchitecture","value":"cursor、capture摘要","verdict":"v2 允许","note":"28前页游标；52真实capture.persisted"},
  {"section":"A1签发字段","file":"tests/data/S8E-A11-lightscan-fault.test.ts","line":[22,56],"owner":"architecture.queryArchitecture、workspace.querySource","value":"capture摘要","verdict":"v2 允许","note":"37、50真实返回；23强转未改内容"},
  {"section":"A1签发字段","file":"tests/data/S8E-A15-previous-observation.test.ts","line":[42],"owner":"architecture.captureSourceChanges","value":"previous摘要","verdict":"v2 允许","note":"27 first.persisted原样传入"},
  {"section":"A1签发字段","file":"tests/data/S8E-A25-strict-capture.test.ts","line":[76,78,79],"owner":"workspace.exportCapture、captureArchitectureSource、captureFileGraph","value":"SourceCaptureRef摘要","verdict":"v2 允许","note":"88、103、121真实capture返回"},
  {"section":"A1签发字段","file":"tests/data/S8E-A27-ts-light-scan-contract.test.ts","line":[43,65],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H"},
  {"section":"A1签发字段","file":"tests/data/S8E-A28-chunk-contract.test.ts","line":[33],"owner":"architecture.compareFormalObserved","value":"baseline.digest","verdict":"v2 允许","note":"H"},
  {"section":"A1签发字段","file":"tests/data/S8E-file-fault-module-layer.test.ts","line":[32],"owner":"architecture.queryArchitecture","value":"capture摘要","verdict":"v2 允许","note":"30真实capture.persisted"},
  {"section":"A1签发字段","file":"tests/data/workspace-capture-architecture.test.ts","line":[107,108,166,167],"owner":"workspace.captureArchitectureSource、releaseCapture","value":"SourceCaptureRef摘要","verdict":"v2 允许","note":"104、159真实capture返回原值"},
  {"section":"A1签发字段","file":"tests/data/workspace-capture.test.ts","line":[108,110,135,139,166,198,199,200,219,229,230,231,251,253,260,261,262,263,265,276,279,280,291,295,301,311,347,355,362,389,391,392,402,408,411,436,456,478,480,486,489,491,536,537,569,602,615,619],"owner":"workspace","value":"SourceCaptureRef摘要、previous、cursor","verdict":"v2 允许","note":"真实capture及前页返回原值；346在修改前复制原引用；来源详见表"},
  {"section":"A1签发字段","file":"tests/data/workspace-capture.test.ts","line":[237],"owner":"workspace.exportCapture","value":"sourceDigest、configDigest","verdict":"F1","note":"233改成零摘要；非A6块"},
  {"section":"A1签发字段","file":"tests/data/workspace-text-operations.test.ts","line":[139,141,143,230,237,239,265,336,339,344,428,433,465,478,487,511,513,541,542,586],"owner":"workspace.querySource、readWorkspace、compareWorkspace","value":"SourceCaptureRef摘要、cursor","verdict":"v2 允许","note":"真实capture原值；154、157、342前页游标；432另列"},
  {"section":"A1签发字段","file":"tests/data/workspace-text-operations.test.ts","line":[432],"owner":"workspace.compareWorkspace","value":"sourceDigest","verdict":"F1","note":"测试改成全零；非A6块"}
]
```

v2 允许 472，F1 29，F3 0，A7 越界 0，文件 98/98；枚举完整