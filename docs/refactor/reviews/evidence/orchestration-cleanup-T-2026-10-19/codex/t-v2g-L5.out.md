按当前文件重新核对，未沿用旧清单的行号。以下按**不同调用行**计数：循环、参数化后端、重复执行不重复计；组外 helper 记在本组调用行。同一行的公开输入与夹具中的 F3 写入分别列项。

“v2 允许”只裁定该输入或写入形状，不表示整个测试合规；A1 不豁免 F4。签发字段必须来自真实公开步骤，依据 `.lead-ref/books/test-rule-sheet-v2.md:30`、`.lead-ref/books/test-rule-sheet-v2.md:32`。表内 `文件:79,85` 表示该文件第 79、85 行两个调用位置。

下面使用四个共享说明，避免反复抄写相同调用链：

- **基础夹具**：`tests/helpers/task-claim-fixture.ts:367` 直接创建 Kernel Session，`:370` 写 `SessionCreated`，`:376`、`:377` 自动执行；因此相关测试不是全程只走公开步骤。
- **运行夹具**：C2 在 `tests/helpers/C2-runtime-platform-fixture.ts:75` 使用基础夹具，`:106` 原始提交协调政策；B2 对应 `tests/helpers/B2-runtime-fixture.ts:183`、`:204`；活动夹具对应 `tests/helpers/S2B-be1-platform-fixture.ts:208`。
- **架构夹具 H**：`tests/helpers/S8D-platform-fixture.ts:184`、`:189` 公开创建项目及 Workspace，`:210` 采用目录，`:223` 公开读取目录 pin，`:234` 捕获，`:244` 返回捕获引用，`:251` 读取文件图，`:258` 组合捕获、采用和比较。输入文件、标识和 mapping 手写；摘要、捕获引用、previous 均来自真实公开结果。
- **WP2 夹具**：`tests/helpers/WP2-platform-support.ts:331`、`:542` 使用基础夹具，SQLite 分支在 `:579` 原始提交协调政策；`:526` 登记只读副本的手造 Kernel identity。`preparedBundle` 在 `:917` 真正 prepare、`:919` 打开材料，`:922` 原样返回 prepared。

**一、A1 公开输入**

| 编号及调用位置 | owner；值的来源及平台字段 | 后续是否只公开；裁定 |
|---|---|---|
| A01 `tests/composition/A1-graph-session-platform.test.ts:79,85,103,106,117,122,135,140,150,155,158,164,169,173,180,197,198,201,205,209,233,237,253,276,288,293,305,318,321,334,336,339` | runtime、sessions、projects、architecture；手写创建、选择、分页、链接、生命周期、目录请求；版本取公开创建/读取，修订摘要取 `:253`，历史分页游标为 null | 否，`:54` 播种；**v2 允许** |
| A02 `tests/composition/A2-reconcile-classifier-platform.test.ts:54,57,60,62,117,119,123,125` | C2 helper、runtime、`send_session_message`；手写消息，recipient 在 `:59`、`:122` 换成实际 Session；prepared 取 `:60`、`:123` | 否，运行夹具，且 `:47` 改造 Run；**v2 允许** |
| A03 `tests/composition/A2-requeue-platform.test.ts:177,179,183,188,191,196,200,203,221,235,257,260,326,333,367,379,391,398,439,467,509,537,550,563,569,586` | projects、completionPolicies、architecture、goals、plans、workflow、claims、runtime、messages、sessions；手写启动、Plan 草稿、select、重排原因及查询；policy 摘要取 `:183`，CAS 取公开 Goal/Run/Session，启动 prepared 来自真实 prepare | 是，业务链公开，另有故障和计数；**v2 允许** |
| A04 `tests/composition/A2-reverify-platform.test.ts:153,155,159,164,167,172,176,179,198,208,240` | 启动 owners、plans、workflow、evidence；手写草稿、select、复核理由；policy 摘要取 `:159`，round/版本取 `:221` 的公开 finalize 回执 | 是；**v2 允许** |
| A05 `tests/composition/A2-verification-chain-platform.test.ts:199,201,205,210,213,218,222,225,233,234,248,251,271,283,319,320,339,459,466,472,478,505` | 启动 owners、plans、workflow、evidence；手写启动、select、链查询；第二份草稿由 `:233` 公开图克隆，proposal/policy pin 取公开结果 | 是；**v2 允许** |
| A06 `tests/composition/AG1-session-discovery.test.ts:51,61,62,63,66,100,103,110,114,125,135` | sessions、runtime、messages、发现/卡片/发送工具；手写过滤、消息、链接；脚本目标取实际工具返回，prepared 取 `:100`，链接版本取 `:48` | 否，C2 运行夹具；**v2 允许** |
| A07 `tests/composition/B2-runtime-platform.test.ts:26,37,39,41,49,65,67` | B2 helper、runtime；手写配置、能力/prepare/observe/启动包装；prepared 取 `:39`、`:65` | 否，B2 运行夹具；**v2 允许** |
| A08 `tests/composition/C1-M1-platform.test.ts:18,42,48,54,59,61,64,65,67,69` | 基础 helper、runtime、sessions、messages；手写 Session、消息、读取包装；接收者由 `:42` 返回值构造，消息引用取 `:54` | 否，基础夹具；**v2 允许** |
| A09 `tests/composition/C2-runtime-platform.test.ts:35,36,38,40,43,81,84,89,92` | 图/提案/采用工具、runtime、plans；草稿由 `:47` 公开图克隆修改，proposal/ref/revision 取 `:69` 工具结果，prepared 取 `:81` | 否，C2 运行夹具；**v2 允许** |
| A10 `tests/composition/K-R-close-open-turn-health.test.ts:103,135,153,171` | `buildRun24KernelOpen` → Host/workflow/requeue；手写场景标识，实际暂停、重启、继续；组外 `tests/helpers/K-t1-support.ts:60`、`:76` | 否，另有 `:51` Kernel 追加；**v2 允许** |
| A11 `tests/composition/K-R-close-open-turn.test.ts:205,227,248` | 同上；手写场景标识，requeue 引用来自真实命令；组外 `tests/helpers/K-t1-support.ts:60` | 否，另有 Kernel 夹具写；**v2 允许** |
| A12 `tests/composition/K-R-observers-kernel-closed.test.ts:52,54,68,88,89,90,91` | 场景、workflow、read 工具、Host 查询流程；手写场景、select、Session/query 参数；组外 `tests/scenarios/harness.ts:1320`、`tests/scenarios/support/common.ts:90`、`tests/helpers/AG2b-collaboration-fixture.ts:395,473,513,552` | 否，`:32` 直接读 Kernel、`:38` 关闭 Turn；**v2 允许** |
| A13 `tests/composition/K-R-previous-turn-bounds.test.ts:49,50,55,57,68,72,75,77` | Host、workflow、controls、requeue、brief、read 工具；手写场景及取消/继续理由，Run/边界来自真实公开结果；组外 `tests/scenarios/harness.ts:1205`、`tests/helpers/A2-restart-fixture.ts:121,155`、`tests/scenarios/support/common.ts:90,163,196` | 是；**v2 允许** |
| A14 `tests/composition/R3c-R4b-platform.test.ts:115,122,131,138,148,150,154,164,183,192,198,207,210,215,219,222,230,237,263,266,268,273,277` | goals、materials、plans、runtime、sessions、claims；手写草稿、材料正文、创建、查询/分页/claim；artifact 引用取 `:122`，atLeastCursor 取真实 apply/claim | 否，`:93` 播种；**v2 允许** |
| A15 `tests/composition/R3d-R3g-platform.test.ts:133,136,148,152,171,179,190` | architecture；手写捕获、选择、比较；previous/capture 引用取前次实际捕获 | 否，`:87` 播种；**v2 允许** |
| A16 `tests/composition/R3e-command-check-platform.test.ts:62,83,89,102,136,146,155,156,183` | R3e helper、evidence、checks、materials；手写打开/执行/完成检查请求；round 版本及 reportRef 取真实结果；请求 helper 位于 `tests/helpers/R3e-evidence-fixture.ts:336,344,352` | 否，夹具造 entered/terminal，且 `:167` 手动 begin；**v2 允许** |
| A17 `tests/composition/R3e-completion-platform.test.ts:33,51,60,72,78,87,100,106,117,128,142,146` | R3e helper、checks、evidence、goals、plans；手写检查及完成请求；round/CAS 取公开检查和 Goal 读取结果 | 否，`tests/helpers/R3e-evidence-fixture.ts:252,265`；**v2 允许** |
| A18 `tests/composition/R4-control-platform.test.ts:59,61,80,103,116` | 基础 helper、claims、controls；手写 claim、控制种类/原因/id；Run pin 取 `:66` | 否，基础夹具；**v2 允许** |
| A19 `tests/composition/R4-control-runtime-platform.test.ts:103,130,135,150,161,198,204,219,227` | B2 helper、runtime、controls、plans、claims；手写 prepare/启动/控制/投递/claim；prepared 取 `:130`，intentRef 取 `:150`、`:219` | 否，B2 运行夹具；**v2 允许** |
| A20 `tests/composition/R4c-history-platform.test.ts:10,11,69,75` | 基础 helper、claims、runtime；手写 claim/历史分页；续页 cursor 原样取 `:69` 返回页 | 否，`:40,60,67` 造历史；**v2 允许** |
| A21 `tests/composition/R5a-project-bootstrap-platform.test.ts:107,112,122,128,134,143,155,167,178,183,185,193,198,202,215,217,219,221,224,225,239,242,248,255,263,275,279,284,291` | projects、workspace、goals、plans、completionPolicies、architecture；手写启动、草稿、查询、重放；激活摘要取 `:143`、`:193`，proposalRef 取真实 propose | 是；**v2 允许** |
| A22 `tests/composition/R5b-query-job-platform.test.ts:112,114,119,137,144,147,154,155,166,171,174,180,185,190,197,207,231,236` | projects、goals、queries、plans、completionPolicies、architecture；手写 Query 意图/id/关注任务、启动草稿；policy/Plan pin 取公开结果 | 是；**v2 允许** |
| A23 `tests/composition/R5c-workflow-platform.test.ts:151,153,158,164,167,173,177,181,195,246,282,339,378,396,419,458,555,583,618` | 启动 owners、plans、workflow、runtime；手写启动、草稿、select、历史请求；policy 摘要/proposalRef 取公开结果 | 是，业务链公开；**v2 允许** |
| A24 `tests/composition/S2B-39-run17-activity.test.ts:69,70,78,80` | read 工具、C2 helper、runtime；手写路径/prepare 包装；prepared 取 `:78` | 否，`:109` 记录端口收集及运行夹具；**v2 允许** |
| A25 `tests/composition/S2B-40-run20iii-activity.test.ts:50,52,56,58` | 发送工具、C2 helper、runtime；手写消息，recipient 在 `:55` 换真实 Session；prepared 取 `:56` | 否，`:45` 改造 Run/outbox；**v2 允许** |
| A26 `tests/composition/S2B-be1-counting-failure.test.ts:79,88,98,104,110,120` | 活动 helper、read、runtime、activity；手写路径、运行 id、日历区间；prepared 由 helper 真正生成 | 否，运行夹具；helper 运行/读取在 `tests/helpers/S2B-be1-platform-fixture.ts:305,328,333`；**v2 允许** |
| A27 `tests/composition/S2B-be1-cross-hour.test.ts:17,29,35,40,43` | 同上；手写路径、运行 id、日期范围；无手造签发字段 | 否，运行夹具；**v2 允许** |
| A28 `tests/composition/S2B-be1-five-tools.test.ts:24,33,36,37,46,59,70,77` | 活动 helper、edit/create、read、look_graph、runtime、activity、decisions；手写文本、路径、普通图目标 id、日历条件 | 否，运行夹具及下列 F1；**v2 允许** |
| A29 `tests/composition/S2B-be1-step-boundaries.test.ts:17,30,37,43,51,52,60,62,73,85,92,106,118,124,132,146,148` | 活动 helper、read、runtime、activity；手写配置、运行/活动请求；`:51,52` 是预算内两个 read；`:54` 未执行调用不计 | 否，运行夹具；**v2 允许** |
| A30 `tests/composition/S2B-be1-usage.test.ts:17,23,25,28,35,38` | 活动 helper、read、runtime、activity；手写路径、运行 id；prepared 来自实际 prepare | 否，运行夹具；**v2 允许** |
| A31 `tests/composition/S2B-be1s-shell.test.ts:34,47,49,67,72,78,97,98,99,107,119,125,138,146,149,160,168,177,184,187,193,199,205,206,210` | 活动 helper、shell、run_readonly_command、runtime、controls、activity、decisions；手写命令/控制/查询；prepared 取 `:47` 或 helper，intent 取 `:67` | 否，运行夹具；**v2 允许** |
| A32 `tests/composition/S4C2-platform.test.ts:36,41,48,65,78` | notes、graphContext、S4A helper；手写笔记、锚点、focus/上下文请求；`write` 转交 `tests/helpers/S4A-note-fixture.ts:282` 的真实 `writeNote` | 后续含 readContextFacts 及组装读取；没有伪造签发字段；**v2 允许** |
| A33 `tests/composition/S8A-AE1-formal-comparison.test.ts:78,82,97,107,115,151,179` | projects、architecture；手写项目、目录、捕获/比较包装；catalog 摘要取 `:107` 公开读取 | 是；**v2 允许** |
| A34 `tests/composition/S8A-AE1-observation.test.ts:85,89,98,109,125,170,179,192,199,204,210,214,258,268` | projects、architecture；手写捕获、目录、文件/邻接/影响查询；cursor 取 `:170`，catalog pin 取 `:125`，captureRef 取 `:98` | 是；**v2 允许** |
| A35 `tests/composition/S8A-L8-adoption-capture.test.ts:106,110,133,180,189,205,215,221,237,242,250,258` | projects、architecture；手写采用、修订、查询；catalog pin 取 `:215,250`，captureRef 取公开 state | 否，`:174` 是下列 F1，另有 driver 通知观察；**v2 允许** |
| A36 `tests/composition/S8A-L8-capture-mappings.test.ts:84,88,113,122,128,140,144,150,169,175,182,197,203,212,218,224,236,255,260,268,271` | projects、architecture；手写空/显式 mapping、捕获/查询；显式 mapping 取 `:140` 公开目录，previous 原样使用 | 业务链公开，另有通知观察；**v2 允许** |
| A37 `tests/composition/S8A-L8-pass-capture.test.ts:212,216,223,229,235,243,247,254,273,315,390,398,413,422,432` | 启动 owners、plans、workflow、architecture、checks、evidence；手写草稿、select、检查/finalize；policy 摘要取 `:223`，round/版本取真实流程结果 | 后续另有 `:382,407` 通知调用；**v2 允许** |
| A38 `tests/composition/S8D-A06-multilingual.test.ts:94,97,99,101,113,129,132,133,147,151,153,155,174,188,192,194,196,208,220,225,227` | 架构夹具 H；手写多语言文件、catalog、mapping、查询；签发字段来自 H 的公开步骤 | 是；**v2 允许** |
| A39 `tests/composition/S8D-A11-python-failure.test.ts:44,51` | 架构夹具 H；手写文件/解释器选项；graph 内部走真实 capture/read/adopt/compare | 是；**v2 允许** |
| A40 `tests/composition/W1-future-plan-platform.test.ts:154,159,163,168,202,204,211,216,221,226,231,233,237,242,246,251,258,274,281,284,315,318,329,335` | goals、plans、claims、基础 helper；手写及公开 Plan 克隆草稿；`:221` 的 basedOn 来自 `:189` 播种记录；proposalRef 取真实 propose | 否，`:135,189` 播种及存储断言；普通 basedOn id 不当作签发凭证；**v2 允许** |
| A41 `tests/composition/W2-future-intent-platform.test.ts:143,147,152,160,170,185,198,208` | goals、plans、基础 helper、future-plan 工具；手写草稿，`:184` 从夹具公开 Plan 派生；采用 pin 取 `:190` 工具结果 | 否，`:119` 播种及基础夹具；**v2 允许** |
| A42 `tests/composition/WP1-session-duty.test.ts:168` | `openDutyMaintenanceFixture` → goals/plans/runtime；夹具内手写公开 Plan/Role 输入；公开结果提供 pin；组外 `tests/helpers/WP1-units-fixture.ts:123,199,204` | 否，`:257` 经 S1 helper 手造完成事实；**v2 允许** |
| A43 `tests/composition/platform.test.ts:60,68,70,74,87,117,120,124,129,135,149` | materials、workspace、projects、goals、plans；手写正文、捕获、查询、启动、草稿；artifactRef 取 `:60`，captureRef 取 `:70` | 是；**v2 允许** |
| A44 `tests/composition/WP2-wiring.test.ts:29,360,398,399,451,452,486,510,513` | WP2 helper、preparedBundle、claimSuccessorRun；手写配置/requestId/task；prepared 原样取真实 prepare；组外 `tests/helpers/WP2-platform-support.ts:890,914,927` | 否，WP2 夹具；**v2 允许** |
| A45 `tests/composition/WP2-wiring.test.ts:90,144,202,250,275,339,350,353,403,496,554,569,815,849,899,1011,1168,1231,1301,1374,1421,1502,1555,1566,1652,1660,1768,1793,1865,1893,1894,1937,2025` | decisions、projects、goalSettings、graphContext、plans、messages、sessions；手写过滤、分页、Goal/Workspace/Session 选择器；无手造签发字段 | 否，WP2 夹具及 Host 事实写；**v2 允许** |
| A46 `tests/composition/WP2-wiring.test.ts:101,110,116,126,193,196,231,234,293,296,313,362,433,436,489,619,645,654,752,755,759,776,923,925,937,944,995,1004,1022,1059,1091,1100,1106,1114,1152,1161,1191,1200,1383,1385,1387,1389,1497,1499,1623,1632,1776,1785,1873,1882,1917,1920,1926,1934,2031,2033,2035,2037` | runtime prepare/start；手写 runRef/requestId/consumerId 包装；所有 prepared 原样来自前序真实 prepare，`:362,489` 来自 `:360,486` helper | 否，WP2 夹具及 Host 事实写；**v2 允许** |
| A47 `tests/composition/WP2-wiring.test.ts:104,119,187,223,287,423,469,648,737,745,940,998,1035,1054,1094,1111,1127,1155,1194,1198,1242,1363,1486,1509,1532,1584,1626,1779,1876,1929,2007,2017` | messages、decisionMessages、send_user_message；手写正文/选项；messageRef/revision 取真实发送，answer source/pins 取 `:454,1502` 公开队列；参数 helper 在 `tests/helpers/WP2-platform-support.ts:848` | 否，WP2 夹具及 Host 事实写；**v2 允许** |
| A48 `tests/composition/WP2-wiring.test.ts:331` | decisionMessages.sendUserMessage；正文取 `:282`，requestId 从 `:323,327` 捕获提交中读取；这是调用方幂等键，没有把它认作公开读取来源或签发凭证 | 否，读取捕获提交；**v2 允许** |
| A49 `tests/composition/WP2-wiring.test.ts:146,851` | workspaceDecisionSettings.markNoticesSeen；displayToken、seenThrough 原样取 `:142`→`:90`、`:844`→`:815` 真实队列页；Workspace 版本取 `:144,849` | 否，WP2 其他步骤含 F3；这些签发字段本身 **v2 允许** |
| A50 `tests/composition/WP2-wiring.test.ts:366,392,445,500,639,915,950,965,1273,1287,1615,1904,1912,1956,2056` | goalSettings、runtime、sessions、claims、workflow、queries、resolveUnknown；手写设置、provenance、重排/归档、select、query、确认原因；CAS 取公开读取，`:1289` task 取真实 claim | 否，WP2 夹具及 Host 事实写；**v2 允许** |
| A51 `tests/composition/WP2-wiring.test.ts:380,622,671,1207,1528,1702` | materials.openArtifact、messages.readMessageBody；手写 usage/part；材料引用分别取 `:374` 公开 execution、`:619` prepare、`:668` 公开 consultation；消息引用取实际发送 | 否，其他步骤含 F3；这里没有从捕获提交重建材料引用；**v2 允许** |
| A52 `tests/composition/WP2-wiring.test.ts:656,1670,1721,1733,1787` | workflow.consumeConsultation；手写预算、consumerId、角色配置；messageRef 取 `:648,1626,1779` 真实发送 | 否，WP2 夹具及 Host 事实写；**v2 允许** |
| A53 `tests/composition/S2B-be1-five-tools.test.ts:31,34` | edit；expectedRevision 在 `:32,35` 由 `:18` 的 `revOf` 对手写正文自行 SHA-256；没有前序公开读取返回该指纹；`:55` 确认工具成功 | 否；**F1，A1 平台签发/派生指纹条款** |
| A54 `tests/composition/S8A-L8-adoption-capture.test.ts:174` | architecture.captureSourceChanges；手写 `requestSeq:1` 和自动捕获请求身份；随后 `:180,189` 继续查询 | 否；**F1，A1 完整公开参数契约**；`src/app/core-routes.ts:573,576,577` 禁止公开请求携带 requestSeq |
| A55 `tests/data/R2e-git-operations.test.ts:192,194,197` | workspace.readWorkspace/compareWorkspace；手写路径、上限、git 版本对；commit 来自真实 git 命令，是外部版本输入 | 公开工具及真实文件/git；无手造平台签发字段；**v2 允许** |
| A56 `tests/data/R2e-text-boundaries.test.ts:56` | workspace.captureSourceChanges；手写 Workspace/revision/provider | 后续公开捕获；**v2 允许** |
| A57 `tests/data/R3b-material-admission-boundaries.test.ts:46,71,114` | materials.openArtifact；ArtifactRef 的 digest/size 由 `:12,13` 自行计算，raw 替身在 `:34,65,102` 返回造出的记录 | 否；**F1，A1 平台派生指纹条款**；同时存在 F4 |
| A58 `tests/data/R3b-material-await-boundaries.test.ts:52` | materials.openArtifact；ArtifactRef/digest 在 `:14,15` 手造，raw 记录和 Run snapshot 也由测试提供 | 否；**F1，A1 平台派生指纹条款** |
| A59 `tests/data/R3b-materials-contract.test.ts:71` | materials.storeArtifact；手写正文、sources、origin；输入没有签发字段 | 否，`:63` 写替身返回自造 ref；仅输入形状 **v2 允许**，不豁免 F4 |
| A60 `tests/data/R3b-materials-contract.test.ts:85` | materials.openArtifact；ref 的 digest/size 由 `:28,29` 自行计算，`:32` 替身返回对应记录 | 否；**F1，A1 平台派生指纹条款** |
| A61 `tests/data/S8A-file-graph.test.ts:73,76,79` | workspace captureObservation/captureSourceChanges/captureFileGraph；手写 scope/provider/config；captureRef 取真实捕获 | 否，`:45` 显式 access 夹具；签发引用未伪造；**v2 允许** |
| A62 `tests/data/S8D-A17-ts-light-scan.test.ts:56,58` | 架构夹具 H；手写文件与参数，公开产生 pin/capture | 是；**v2 允许** |
| A63 `tests/data/S8D-A18-ts-light-scan.test.ts:18,26,42,63,65,67,76,95,104,109` | H、architecture 查询/邻接；手写文件、mapping、查询；引用取真实捕获 | 是；`:53` 取消分支不计接受实例；**v2 允许** |
| A64 `tests/data/S8D-A19-ts-light-scan.test.ts:22,27,38,43,53,59,72,78,89,95,105,111,118,124,143,145` | 架构夹具 H；手写文件/config，公开捕获及 graph | 是；**v2 允许** |
| A65 `tests/data/S8D-A20-python-imports.test.ts:26,27,28,138,140` | H、architecture.compareFormalObserved；手写文件/比较包装；catalog/capture 取 `:26,27` | 是；**v2 允许** |
| A66 `tests/data/S8D-A21-python-config.test.ts:36,65,67,82,96,98,111,113,129,143,145,158,160,173,180,192,194,209,215` | H；`:36` 是真实 python_index 工具，手写 operation/path；其余手写文件/config，公开生成 capture/pin | 是；**v2 允许** |
| A67 `tests/data/S8D-A22-cpp-imports.test.ts:25,38,39,40,51,69,87,105,124,146,162,180,231,256,281,305,321,340,361,383,394,408` | H、architecture.compareFormalObserved；手写源文件/编译配置/查询；catalog/capture 取实际公开步骤 | 是；**v2 允许** |
| A68 `tests/data/S8D-A23-cpp-config.test.ts:22,40,56,72,90,113,136,158,178,193,207,225,242,259,275,291,307,323,338,355,372` | 架构夹具 H；手写源文件/编译配置，真实 graph 链 | 是；**v2 允许** |
| A69 `tests/data/S8D-A24-runner.test.ts:102,106,126,130,154,158,186` | 架构夹具 H；手写文件、解释器选项；公开捕获/graph | 是，解释器故障为 A2；`:191` 取消分支不计；**v2 允许** |
| A70 `tests/data/S8D-exploration-regressions.test.ts:45` | python_index/cpp_index；本文件 helper 原样转交手写参数，具体调用为 `:57,81,103,116` | 真实工具和文件；无签发字段；**v2 允许** |
| A71 `tests/data/S8D-language-providers.test.ts:72,77` | workspace.captureObservation/captureFileGraph；手写 scope/provider，captureRef 取 `:76` | 否，`:44` 显式 access 夹具；**v2 允许** |
| A72 `tests/data/S8D-platform-fixture.test.ts:11,16,30` | 架构夹具 H；手写文件，真实 graph 及修改后重读 | 是；**v2 允许** |
| A73 `tests/data/S8E-A07-git-inventory.test.ts:22,26,27` | 架构夹具 H；手写文件/git 配置，真实 capture/list | 是；**v2 允许** |
| A74 `tests/data/S8E-A08-skip-list.test.ts:22,24,25` | 架构夹具 H；手写文件，真实 capture/list | 是；**v2 允许** |
| A75 `tests/data/S8E-A09-scale.test.ts:24,35,37,50,52,53` | H、architecture.listFiles/queryArchitecture；手写文件/mapping/查询；cursor 初始 null，随后取 `:28` 实际 nextCursor | 是；**v2 允许** |
| A76 `tests/data/S8E-A11-lightscan-fault.test.ts:22,33,37,38,50,64,68,69` | H、architecture、workspace.captureObservation；手写 mapping/scope/provider；引用来自实际捕获 | 是，`:56` 拒绝语义查询不计接受实例；**v2 允许** |
| A77 `tests/data/S8E-A12-file-chunks.test.ts:59,63,65,72,81,119` | H、architecture.listFiles/neighbors/impact；手写文件、图查询，captureRef 来自真实捕获 | 是；`:123` 容量拒绝不计；**v2 允许** |
| A78 `tests/data/S8E-A13-edge-cap.test.ts:22` | 架构夹具 H 的公开初始化；手写文件/限制选项 | 是；`:26` 捕获容量拒绝不计接受实例；**v2 允许** |
| A79 `tests/data/S8E-A14-narrowed-grant.test.ts:22,24,26` | 架构夹具 H；手写文件、公开捕获/list | 是；`:31,32,34` 缩窄授权后拒绝不计；**v2 允许** |
| A80 `tests/data/S8E-A15-previous-observation.test.ts:25,27,28,42,43` | 架构夹具 H；手写文件、mapping；`:42` previous 原样取 first.persisted | 是；**v2 允许** |
| A81 `tests/data/S8E-A23-ignored-databases.test.ts:41,43,44,63,68,71,77,81` | 架构夹具 H；手写文件/config，真实 capture/list | 是；**v2 允许** |
| A82 `tests/data/S8E-A25-strict-capture.test.ts:74,75,78,79` | workspace 捕获/架构源/文件图；手写请求和 MAPPINGS，captureRef 取 `:88,103,121` 实际返回 | 否，`:44` 显式 access 夹具；没有手造接受的摘要；**v2 允许** |
| A83 `tests/data/S8E-A27-ts-light-scan-contract.test.ts:36,43,58,65,87` | 架构夹具 H；手写文件/配置，真实 graph | 是；`:108` 取消不计接受实例；**v2 允许** |
| A84 `tests/data/S8E-A28-chunk-contract.test.ts:24,26,27,33,40,55` | 架构夹具 H；手写文件/限制，真实捕获和 graph | 是；`:43,58` 容量拒绝不计；**v2 允许** |
| A85 `tests/data/S8E-file-fault-module-layer.test.ts:21,30,32,41` | H、architecture；手写文件、mapping、查询；引用取真实捕获 | 是；**v2 允许** |
| A86 `tests/data/cpp-source-index.test.ts:125,141` | cpp_index；手写 definitions/path/line/column，分别直接 execute 和真实模型工具循环 | 真实工具，另在 `:137` 观察模型请求；无签发字段；**v2 允许** |
| A87 `tests/data/workspace-capture-architecture.test.ts:104,107,159,166` | workspace.captureSourceChanges/captureArchitectureSource；手写 scope/provider/config/mappings；captureRef 取 `:104,159` | 后续含 `:120` 等端口计数；引用原样；**v2 允许** |
| A88 `tests/data/workspace-capture.test.ts:108,110,139,186,373,389,391,392,400,408,411,453,456,486,491,533,534,537,559` | workspace 捕获/查询/架构源；手写请求包装；cursor/previous 均取实际 capture/page；`:373` 是并发中的成功捕获 | 否，`:74` access 替身和内部计数；未把伪造 cursor 当接受实例；**v2 允许** |
| A89 `tests/data/workspace-text-operations.test.ts:137,139,141,143,168,189` | workspace capture/query/read/compare；手写路径、文本条件、provider；captureRef、前后版本和 cursor 来自实际返回 | 公开工具/真实文件，另有 `:122` 计数；**v2 允许** |
| A90 `tests/data/S8D-capture-error.test.ts:51,54` | workspace 的 CaptureRegistry 捕获入口；手写 scope/provider，`:54` captureRef 原样取 `:51` | 否，`:41` access 替身，`:47` 注入依赖异常；输入本身 **v2 允许** |

原样直接传递前序公开返回的完整值，不重复作为“测试构造输入”列项。例如 `tests/composition/C2-runtime-platform.test.ts:102` 直接读取前序工具返回的 proposalRef；`tests/composition/R5c-workflow-platform.test.ts:405,412` 直接使用前一步 next。

**二、record-store 目录测试**

| 范围 | 结果 |
|---|---|
| `.lead-ref/groups/L5-files.txt:1` 至 `.lead-ref/groups/L5-files.txt:98` | 本组没有 `tests/record-store/` 文件。两个 `tests/data` 文件中的 RawArtifactBodyStore 自身契约行在下一表单列；按 `.lead-ref/books/test-rule-sheet-v2.md:41` 根据实际验证对象判断。 |

**三、F3 及直接存储写入命中**

下表“到达者”均是当前组的调用文件，不把组外 helper 自身另算为本组文件。

| 编号及本组位置 | 写入内容、实际写入点和到达者 | 裁定 |
|---|---|---|
| S01 `tests/composition/A1-graph-session-platform.test.ts:54` | `records.commit` 写 Project、Workspace、TrustedScopeSeeded；内容在 `:49,50`，本文件 `:61` 调用 seed | **F3** |
| S02 `tests/composition/K-R-close-open-turn-health.test.ts:51` | Kernel append 手造 turn.started、Run/config/workspace；本文件 `:116` 调用；不是 damageKernel | **F3** |
| S03 `tests/composition/K-R-close-open-turn.test.ts:62,63,64,196` | KernelSessionFixture 创建 Session、开启 Turn、追加 run.started；实际写点 `tests/helpers/K-session-support.ts:119,151,194`；本文件 `:143,154,162,171,184` 到达局部 helper | **F3** |
| S04 `tests/composition/K3-R1-close-open-turn.test.ts:41,42,43` | 同一 KernelSessionFixture 写法；实际写点 `tests/helpers/K-session-support.ts:119,151,194`；本文件 `:95` 到达 | **F3** |
| S05 `tests/composition/R3c-R4b-platform.test.ts:93` | 原始提交 Project/Workspace、CompletionPolicy、ArchitectureBaseline 及 active 治理记录；记录数组在 `:81` | **F3** |
| S06 `tests/composition/R3d-R3g-platform.test.ts:87` | 原始提交 Project、Workspace、TrustedScopeSeeded；记录在 `:90` | **F3** |
| S07 `tests/composition/R3e-command-check-platform.test.ts:167` | 直接 `evidence.beginCheck` 留下 executing 窗口；请求 helper 为 `tests/helpers/R3e-evidence-fixture.ts:344`；代行正常 Host 写入 | **F3** |
| S08 `tests/composition/R4c-history-platform.test.ts:40,60,64,67` | `:40` 手造两个 Turn 及 started/cancelled；`:60,67` 写/重放 kernel-target 和位置 5/7/7；`:64` 是关闭后被拒绝的同类写尝试 | **F3** |
| S09 `tests/composition/W1-future-plan-platform.test.ts:135,189` | `:135` 写 scope/治理；`:189` 写 PlanRevision、Goal、运行中 Run，记录列在 `:193,194` | **F3** |
| S10 `tests/composition/W2-future-intent-platform.test.ts:119` | scope、CompletionPolicy、ArchitectureBaseline、active 治理记录；数组在 `:124` | **F3** |
| S11 `tests/composition/C1-M1-platform.test.ts:18` | 调基础夹具，触及 `tests/helpers/task-claim-fixture.ts:367,370` 的 Kernel/SessionCreated 写 | **F3** |
| S12 `tests/composition/R4-control-platform.test.ts:59` | 同上，基础夹具 | **F3** |
| S13 `tests/composition/R4c-history-platform.test.ts:10` | 同上，基础夹具 | **F3** |
| S14 `tests/composition/W1-future-plan-platform.test.ts:281` | 同上，基础夹具 | **F3** |
| S15 `tests/composition/W2-future-intent-platform.test.ts:170` | 同上，基础夹具 | **F3** |
| S16 `tests/composition/A2-reconcile-classifier-platform.test.ts:57,119` | C2 helper：基础夹具加协调政策/active 原始提交；`tests/helpers/C2-runtime-platform-fixture.ts:75,106,119,120` | **F3** |
| S17 `tests/composition/AG1-session-discovery.test.ts:66,125` | 同上，C2 helper | **F3** |
| S18 `tests/composition/C2-runtime-platform.test.ts:43` | 同上，C2 helper | **F3** |
| S19 `tests/composition/S2B-39-run17-activity.test.ts:70` | 同上，C2 helper | **F3** |
| S20 `tests/composition/S2B-40-run20iii-activity.test.ts:52` | 同上，C2 helper | **F3** |
| S21 `tests/composition/B2-runtime-platform.test.ts:26` | B2 helper：基础夹具加协调政策/active 原始提交；`tests/helpers/B2-runtime-fixture.ts:183,204` | **F3** |
| S22 `tests/composition/R4-control-runtime-platform.test.ts:103` | 同上，B2 helper | **F3** |
| S23 `tests/composition/R3e-command-check-platform.test.ts:62` | R3e helper：基础夹具、手造 entered、run_completed、位置 4 和完成 cursor；`tests/helpers/R3e-evidence-fixture.ts:252,254,261,262,265`，进入事实写点 `tests/helpers/B2-execution-fixture.ts:309` | **F3** |
| S24 `tests/composition/R3e-completion-platform.test.ts:33` | 同上，R3e helper | **F3** |
| S25 `tests/composition/S2B-be1-counting-failure.test.ts:79` | 活动 helper：基础夹具加协调政策/active；`tests/helpers/S2B-be1-platform-fixture.ts:208` | **F3** |
| S26 `tests/composition/S2B-be1-cross-hour.test.ts:17` | 同上，活动 helper | **F3** |
| S27 `tests/composition/S2B-be1-five-tools.test.ts:24` | 同上，活动 helper | **F3** |
| S28 `tests/composition/S2B-be1-step-boundaries.test.ts:17,43,73,106,132` | 同上，活动 helper | **F3** |
| S29 `tests/composition/S2B-be1-usage.test.ts:17` | 同上，活动 helper | **F3** |
| S30 `tests/composition/S2B-be1s-shell.test.ts:34,193` | 同上，活动 helper | **F3** |
| S31 `tests/composition/WP1-session-duty.test.ts:168` | `tests/helpers/WP1-units-fixture.ts:123,257` → 基础/执行夹具；`tests/helpers/S1-workflow-archive-fixture.ts:358,360,362` 手造完成事件、完成 cursor 并 recordRunResult | **F3** |
| S32 `tests/composition/WP2-wiring.test.ts:29` | WP2 helper：基础夹具；SQLite 协调政策；只读副本手造 Kernel identity 登记；`tests/helpers/WP2-platform-support.ts:331,542,579,526` | **F3** |
| S33 `tests/composition/WP2-wiring.test.ts:133,767,934,1039,1049,1183,1542,1637` | 手写 ready/missing probe 调 `recordSessionHealth`，推进健康/不可用位置；`:1039` 为故障拒绝，其余继续读消息/队列 | **F3** |
| S34 `tests/composition/WP2-wiring.test.ts:1402,1808,1821,1950,2046` | `reconcileRun/reconcileQuery`：公开 read 的 record 加手写 probe/hostInstanceId，直接代行 Host 恢复写；record 来源为 `:1398,1804,1948,2044` | **F3** |
| S35 `tests/data/R3b-body-boundaries.test.ts:23` | RawArtifactBodyStore.put 手写正文；`:19,24,26,28` 验证内容寻址/hash 次数，没有上层 owner 消费其状态 | **v2 允许：存储自身契约** |
| S36 `tests/data/R3b-materials-contract.test.ts:40,41` | RawArtifactBodyStore.put 重复正文、不同 source/owner；`:45,46,47,52,53` 验证重放、第一来源保留、返回隔离；上层材料测试另起于 `:58` | **v2 允许：存储自身契约** |
| S37 `tests/composition/W1-future-plan-platform.test.ts:302,310` | 接收真实业务 owner 生成的 prepared，原样委托 commit 并返回真实结果；门闩在 `:299,307,308,309`，上游在 `:315,318` | **v2 允许：保留的 A3 委托包装** |

**四、A7**

| 命名 helper | 本组及所追踪调用链 | 边界裁定 |
|---|---|---|
| buildNoteTools | 无使用；限定文件与用途见 `.lead-ref/books/test-rule-sheet-v2.md:45,47,49` | 无 A7 实例 |
| damageKernel | 无使用；本组 Kernel 写入已列 S02–S04、S08，不冒充此例外；边界见 `.lead-ref/books/test-rule-sheet-v2.md:50,54,58` | 无 A7 实例 |
| process-sandbox-standin / executeChecks | 无使用；边界见 `.lead-ref/books/test-rule-sheet-v2.md:59,60,63,64` | 无 A7 越界实例 |

**无实例**（限本题四类，不表示对整个文件作其他规则的合规裁定）：

- `tests/data/S8D-compact-snapshot.test.ts:44`：快照压缩函数。
- `tests/data/S8D-cpp-import-graph-script.test.ts:73`：分析脚本入口。
- `tests/data/S8D-formal-unresolved-reason.test.ts:23`：图比较函数。
- `tests/data/S8D-observation-inventory.test.ts:104`：底层来源清单。
- `tests/data/S8D-observed-v2-codecs.test.ts:59`：编码/解码，不提交记录。
- `tests/data/S8D-python-import-graph-script.test.ts:95`：分析脚本入口。
- `tests/data/S8E-A26-git-classification.test.ts:115`：底层 git 分类。
- `tests/data/S8E-old-format-rejection.test.ts:52`：旧格式解码拒绝。
- `tests/data/analysis-runner.test.ts:130`：分析进程执行器。
- `tests/data/candidate-workspace-reader.test.ts:20`：候选目录读取器。
- `tests/data/project-source-snapshot.test.ts:26`：底层来源快照。
- `tests/data/python-source-index.test.ts:20`：直接 PythonSourceIndex。
- `tests/data/source-index.test.ts:20`：直接 SourceIndex。
- `tests/data/typescript-source-query.test.ts:44`：直接 TypeScriptSourceAnalyzer。
- `tests/data/typescript-source-reuse.test.ts:18`：直接分析器复用。
- `tests/data/workspace-capture-access.test.ts:94`：底层 workspace access。
- `tests/data/workspace-path-boundary.test.ts:10`：路径前缀常量。

JSON 的 `line` 数组逐一保留调用行；`note` 中的 A/S 编号对应上表完整来源说明。

```json
[
  {"section":"A1","file":"tests/composition/A1-graph-session-platform.test.ts","line":[79,85,103,106,117,122,135,140,150,155,158,164,169,173,180,197,198,201,205,209,233,237,253,276,288,293,305,318,321,334,336,339],"owner":"runtime/sessions/projects/architecture","value":"手写请求；版本和基线摘要来自公开创建及读取","verdict":"v2 允许","note":"A01；后续非仅公开，54播种"},
  {"section":"A1","file":"tests/composition/A2-reconcile-classifier-platform.test.ts","line":[54,57,60,62,117,119,123,125],"owner":"C2 helper/runtime/send_session_message","value":"手写消息；实际Session；真实prepared","verdict":"v2 允许","note":"A02；后续非仅公开"},
  {"section":"A1","file":"tests/composition/A2-requeue-platform.test.ts","line":[177,179,183,188,191,196,200,203,221,235,257,260,326,333,367,379,391,398,439,467,509,537,550,563,569,586],"owner":"projects/completionPolicies/architecture/goals/plans/workflow/claims/runtime/messages/sessions","value":"手写启动、草稿、select、重排和查询；签发字段来自公开结果","verdict":"v2 允许","note":"A03；后续公开业务链"},
  {"section":"A1","file":"tests/composition/A2-reverify-platform.test.ts","line":[153,155,159,164,167,172,176,179,198,208,240],"owner":"projects/completionPolicies/architecture/goals/plans/workflow/evidence","value":"手写草稿、select、复核；公开policy摘要和finalize回执","verdict":"v2 允许","note":"A04；后续公开"},
  {"section":"A1","file":"tests/composition/A2-verification-chain-platform.test.ts","line":[199,201,205,210,213,218,222,225,233,234,248,251,271,283,319,320,339,459,466,472,478,505],"owner":"projects/completionPolicies/architecture/goals/plans/workflow/evidence","value":"手写启动及select；由公开图克隆草稿；公开pin","verdict":"v2 允许","note":"A05；后续公开"},
  {"section":"A1","file":"tests/composition/AG1-session-discovery.test.ts","line":[51,61,62,63,66,100,103,110,114,125,135],"owner":"sessions/runtime/messages/发现及发送工具","value":"手写过滤、链接和消息；实际工具返回目标和prepared","verdict":"v2 允许","note":"A06；C2 helper；后续非仅公开"},
  {"section":"A1","file":"tests/composition/B2-runtime-platform.test.ts","line":[26,37,39,41,49,65,67],"owner":"B2 helper/runtime","value":"手写能力、prepare、observe、启动请求；实际prepared","verdict":"v2 允许","note":"A07；后续非仅公开"},
  {"section":"A1","file":"tests/composition/C1-M1-platform.test.ts","line":[18,42,48,54,59,61,64,65,67,69],"owner":"task-claim helper/runtime/sessions/messages","value":"手写Session及消息；引用来自真实创建和发送","verdict":"v2 允许","note":"A08；后续非仅公开"},
  {"section":"A1","file":"tests/composition/C2-runtime-platform.test.ts","line":[35,36,38,40,43,81,84,89,92],"owner":"图/提案/采用工具/runtime/plans","value":"公开图克隆草稿；公开proposal及真实prepared","verdict":"v2 允许","note":"A09；后续非仅公开"},
  {"section":"A1","file":"tests/composition/K-R-close-open-turn-health.test.ts","line":[103,135,153,171],"owner":"buildRun24KernelOpen→Host/workflow/requeue","value":"手写场景参数；实际公开暂停及继续","verdict":"v2 允许","note":"A10；tests/helpers/K-t1-support.ts:60；另有51存储写"},
  {"section":"A1","file":"tests/composition/K-R-close-open-turn.test.ts","line":[205,227,248],"owner":"buildRun24KernelOpen→Host/workflow/requeue","value":"手写场景参数；真实requeue引用","verdict":"v2 允许","note":"A11；tests/helpers/K-t1-support.ts:60；另有Kernel夹具"},
  {"section":"A1","file":"tests/composition/K-R-observers-kernel-closed.test.ts","line":[52,54,68,88,89,90,91],"owner":"场景/workflow/read/Host查询","value":"手写场景、select及查询参数；实际准备结果","verdict":"v2 允许","note":"A12；harness.ts:1320，AG2b-collaboration-fixture.ts:395,473,513,552；后续非仅公开"},
  {"section":"A1","file":"tests/composition/K-R-previous-turn-bounds.test.ts","line":[49,50,55,57,68,72,75,77],"owner":"Host/workflow/controls/requeue/brief/read","value":"手写场景和操作理由；Run及边界来自公开结果","verdict":"v2 允许","note":"A13；harness.ts:1205，A2-restart-fixture.ts:121,155，common.ts:90,163,196；后续公开"},
  {"section":"A1","file":"tests/composition/R3c-R4b-platform.test.ts","line":[115,122,131,138,148,150,154,164,183,192,198,207,210,215,219,222,230,237,263,266,268,273,277],"owner":"goals/materials/plans/runtime/sessions/claims","value":"手写草稿、正文、创建、claim和读取；真实artifact和cursor","verdict":"v2 允许","note":"A14；后续非仅公开，93播种"},
  {"section":"A1","file":"tests/composition/R3d-R3g-platform.test.ts","line":[133,136,148,152,171,179,190],"owner":"architecture","value":"手写捕获及查询；previous/capture来自真实捕获","verdict":"v2 允许","note":"A15；后续非仅公开，87播种"},
  {"section":"A1","file":"tests/composition/R3e-command-check-platform.test.ts","line":[62,83,89,102,136,146,155,156,183],"owner":"R3e helper/evidence/checks/materials","value":"手写检查请求；真实round版本和报告引用","verdict":"v2 允许","note":"A16；R3e-evidence-fixture.ts:336,344,352；后续非仅公开"},
  {"section":"A1","file":"tests/composition/R3e-completion-platform.test.ts","line":[33,51,60,72,78,87,100,106,117,128,142,146],"owner":"R3e helper/checks/evidence/goals/plans","value":"手写检查及完成请求；公开round和Goal版本","verdict":"v2 允许","note":"A17；后续非仅公开"},
  {"section":"A1","file":"tests/composition/R4-control-platform.test.ts","line":[59,61,80,103,116],"owner":"task-claim helper/claims/controls","value":"手写claim及控制；Run pin来自66公开读取","verdict":"v2 允许","note":"A18；后续非仅公开"},
  {"section":"A1","file":"tests/composition/R4-control-runtime-platform.test.ts","line":[103,130,135,150,161,198,204,219,227],"owner":"B2 helper/runtime/controls/plans/claims","value":"手写运行控制请求；prepared和intent由实际步骤返回","verdict":"v2 允许","note":"A19；后续非仅公开"},
  {"section":"A1","file":"tests/composition/R4c-history-platform.test.ts","line":[10,11,69,75],"owner":"task-claim helper/claims/runtime","value":"手写claim和历史分页；cursor原样取69返回页","verdict":"v2 允许","note":"A20；后续非仅公开"},
  {"section":"A1","file":"tests/composition/R5a-project-bootstrap-platform.test.ts","line":[107,112,122,128,134,143,155,167,178,183,185,193,198,202,215,217,219,221,224,225,239,242,248,255,263,275,279,284,291],"owner":"projects/workspace/goals/plans/completionPolicies/architecture","value":"手写启动、草稿和查询；policy摘要及proposal来自公开结果","verdict":"v2 允许","note":"A21；后续公开"},
  {"section":"A1","file":"tests/composition/R5b-query-job-platform.test.ts","line":[112,114,119,137,144,147,154,155,166,171,174,180,185,190,197,207,231,236],"owner":"projects/goals/queries/plans/completionPolicies/architecture","value":"手写Query意图、id和草稿；公开policy/Plan pin","verdict":"v2 允许","note":"A22；后续公开"},
  {"section":"A1","file":"tests/composition/R5c-workflow-platform.test.ts","line":[151,153,158,164,167,173,177,181,195,246,282,339,378,396,419,458,555,583,618],"owner":"projects/completionPolicies/architecture/goals/plans/workflow/runtime","value":"手写启动、草稿、select及历史请求；公开签发字段","verdict":"v2 允许","note":"A23；后续公开业务链"},
  {"section":"A1","file":"tests/composition/S2B-39-run17-activity.test.ts","line":[69,70,78,80],"owner":"read/C2 helper/runtime","value":"手写路径和prepare请求；真实prepared","verdict":"v2 允许","note":"A24；后续非仅公开"},
  {"section":"A1","file":"tests/composition/S2B-40-run20iii-activity.test.ts","line":[50,52,56,58],"owner":"send_session_message/C2 helper/runtime","value":"手写消息；55实际Session；56真实prepared","verdict":"v2 允许","note":"A25；后续非仅公开"},
  {"section":"A1","file":"tests/composition/S2B-be1-counting-failure.test.ts","line":[79,88,98,104,110,120],"owner":"S2B helper/read/runtime/activity","value":"手写路径、运行id及日历；真实prepared","verdict":"v2 允许","note":"A26；S2B-be1-platform-fixture.ts:305,328,333；后续非仅公开"},
  {"section":"A1","file":"tests/composition/S2B-be1-cross-hour.test.ts","line":[17,29,35,40,43],"owner":"S2B helper/read/runtime/activity","value":"手写路径、运行id和日期范围","verdict":"v2 允许","note":"A27；后续非仅公开"},
  {"section":"A1","file":"tests/composition/S2B-be1-five-tools.test.ts","line":[24,33,36,37,46,59,70,77],"owner":"S2B helper/edit/read/look_graph/runtime/activity/decisions","value":"手写create文本、路径、普通图id和日历","verdict":"v2 允许","note":"A28；后续非仅公开；31、34另列F1"},
  {"section":"A1","file":"tests/composition/S2B-be1-step-boundaries.test.ts","line":[17,30,37,43,51,52,60,62,73,85,92,106,118,124,132,146,148],"owner":"S2B helper/read/runtime/activity","value":"手写配置、预算内read、运行及活动请求","verdict":"v2 允许","note":"A29；后续非仅公开"},
  {"section":"A1","file":"tests/composition/S2B-be1-usage.test.ts","line":[17,23,25,28,35,38],"owner":"S2B helper/read/runtime/activity","value":"手写read路径及运行id","verdict":"v2 允许","note":"A30；后续非仅公开"},
  {"section":"A1","file":"tests/composition/S2B-be1s-shell.test.ts","line":[34,47,49,67,72,78,97,98,99,107,119,125,138,146,149,160,168,177,184,187,193,199,205,206,210],"owner":"S2B helper/shell/run_readonly_command/runtime/controls/activity/decisions","value":"手写命令、控制、查询；prepared及intent来自真实结果","verdict":"v2 允许","note":"A31；后续非仅公开"},
  {"section":"A1","file":"tests/composition/S4C2-platform.test.ts","line":[36,41,48,65,78],"owner":"notes/graphContext/S4A helper","value":"手写笔记、锚点和上下文请求","verdict":"v2 允许","note":"A32；S4A-note-fixture.ts:282；后续含上下文组装读取"},
  {"section":"A1","file":"tests/composition/S8A-AE1-formal-comparison.test.ts","line":[78,82,97,107,115,151,179],"owner":"projects/architecture","value":"手写目录及捕获比较；catalog摘要来自107公开read","verdict":"v2 允许","note":"A33；后续公开"},
  {"section":"A1","file":"tests/composition/S8A-AE1-observation.test.ts","line":[85,89,98,109,125,170,179,192,199,204,210,214,258,268],"owner":"projects/architecture","value":"手写图查询；cursor、catalog、capture来自真实结果","verdict":"v2 允许","note":"A34；后续公开"},
  {"section":"A1","file":"tests/composition/S8A-L8-adoption-capture.test.ts","line":[106,110,133,180,189,205,215,221,237,242,250,258],"owner":"projects/architecture","value":"手写采用修订查询；pin及capture来自公开read/state","verdict":"v2 允许","note":"A35；后续非仅公开，174另列F1"},
  {"section":"A1","file":"tests/composition/S8A-L8-capture-mappings.test.ts","line":[84,88,113,122,128,140,144,150,169,175,182,197,203,212,218,224,236,255,260,268,271],"owner":"projects/architecture","value":"手写mapping和查询；公开目录及previous","verdict":"v2 允许","note":"A36；公开业务链，另有通知观察"},
  {"section":"A1","file":"tests/composition/S8A-L8-pass-capture.test.ts","line":[212,216,223,229,235,243,247,254,273,315,390,398,413,422,432],"owner":"projects/completionPolicies/architecture/goals/plans/workflow/checks/evidence","value":"手写启动、草稿、select、检查；真实policy及round pin","verdict":"v2 允许","note":"A37；另有382、407通知调用"},
  {"section":"A1","file":"tests/composition/S8D-A06-multilingual.test.ts","line":[94,97,99,101,113,129,132,133,147,151,153,155,174,188,192,194,196,208,220,225,227],"owner":"S8D helper/projects/architecture","value":"手写文件、catalog、mapping；真实公开签发字段","verdict":"v2 允许","note":"A38；架构夹具H；后续公开"},
  {"section":"A1","file":"tests/composition/S8D-A11-python-failure.test.ts","line":[44,51],"owner":"S8D helper/projects/architecture","value":"手写文件及解释器选项；真实graph链","verdict":"v2 允许","note":"A39；H；后续公开"},
  {"section":"A1","file":"tests/composition/W1-future-plan-platform.test.ts","line":[154,159,163,168,202,204,211,216,221,226,231,233,237,242,246,251,258,274,281,284,315,318,329,335],"owner":"goals/plans/claims/task-claim helper","value":"手写及公开Plan克隆草稿；221 basedOn来自189播种；proposal来自真实propose","verdict":"v2 允许","note":"A40；后续非仅公开"},
  {"section":"A1","file":"tests/composition/W2-future-intent-platform.test.ts","line":[143,147,152,160,170,185,198,208],"owner":"goals/plans/task-claim helper/future-plan工具","value":"手写草稿；公开Plan派生；采用pin来自工具结果","verdict":"v2 允许","note":"A41；后续非仅公开"},
  {"section":"A1","file":"tests/composition/WP1-session-duty.test.ts","line":[168],"owner":"openDutyMaintenanceFixture→goals/plans/runtime","value":"夹具手写Plan和Role输入；公开结果提供pin","verdict":"v2 允许","note":"A42；WP1-units-fixture.ts:123,199,204,257；后续非仅公开"},
  {"section":"A1","file":"tests/composition/platform.test.ts","line":[60,68,70,74,87,117,120,124,129,135,149],"owner":"materials/workspace/projects/goals/plans","value":"手写正文、查询、启动及草稿；实际artifact/capture引用","verdict":"v2 允许","note":"A43；后续公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[29,360,398,399,451,452,486,510,513],"owner":"WP2 helper/preparedBundle/claimSuccessorRun/preparedBundleInput","value":"手写配置、requestId、task；真实prepared原样返回","verdict":"v2 允许","note":"A44；WP2-platform-support.ts:890,914,917,919,927；后续非仅公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[90,144,202,250,275,339,350,353,403,496,554,569,815,849,899,1011,1168,1231,1301,1374,1421,1502,1555,1566,1652,1660,1768,1793,1865,1893,1894,1937,2025],"owner":"decisions/projects/goalSettings/graphContext/plans/messages/sessions","value":"手写过滤、分页、普通实体选择器","verdict":"v2 允许","note":"A45；无伪造签发字段；后续非仅公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[101,110,116,126,193,196,231,234,293,296,313,362,433,436,489,619,645,654,752,755,759,776,923,925,937,944,995,1004,1022,1059,1091,1100,1106,1114,1152,1161,1191,1200,1383,1385,1387,1389,1497,1499,1623,1632,1776,1785,1873,1882,1917,1920,1926,1934,2031,2033,2035,2037],"owner":"runtime.prepareExecution/startRun/prepareQuery/startQuery","value":"手写调用包装；prepared全取前序真实prepare并原样使用","verdict":"v2 允许","note":"A46；后续非仅公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[104,119,187,223,287,423,469,648,737,745,940,998,1035,1054,1094,1111,1127,1155,1194,1198,1242,1363,1486,1509,1532,1584,1626,1779,1876,1929,2007,2017],"owner":"messages/decisionMessages/send_user_message","value":"手写正文选项；真实消息引用及公开queue的source/pins","verdict":"v2 允许","note":"A47；WP2-platform-support.ts:848；后续非仅公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[331],"owner":"decisionMessages.sendUserMessage","value":"282正文；323、327捕获提交中的requestId","verdict":"v2 允许","note":"A48；requestId是调用方幂等键；来源非公开读取；后续非仅公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[146,851],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough原样取142→90、844→815真实页；版本取144、849","verdict":"v2 允许","note":"A49；签发字段来源符合v2；其他步骤非仅公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[366,392,445,500,639,915,950,965,1273,1287,1615,1904,1912,1956,2056],"owner":"goalSettings/runtime/sessions/claims/workflow/queries/resolveUnknown","value":"手写设置、provenance、重排、归档、select、query及原因；真实CAS/claim","verdict":"v2 允许","note":"A50；后续非仅公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[380,622,671,1207,1528,1702],"owner":"materials.openArtifact/messages.readMessageBody","value":"手写usage/part；artifact取374、619、668公开结果；消息取实际发送","verdict":"v2 允许","note":"A51；未从捕获提交重建ref；后续非仅公开"},
  {"section":"A1","file":"tests/composition/WP2-wiring.test.ts","line":[656,1670,1721,1733,1787],"owner":"workflow.consumeConsultation","value":"手写预算、角色配置、consumerId；实际消息引用","verdict":"v2 允许","note":"A52；后续非仅公开"},
  {"section":"A1","file":"tests/composition/S2B-be1-five-tools.test.ts","line":[31,34],"owner":"edit","value":"32、35的expectedRevision由18自行SHA-256手写正文","verdict":"F1","note":"A53；A1平台派生指纹条款；无真实公开read来源"},
  {"section":"A1","file":"tests/composition/S8A-L8-adoption-capture.test.ts","line":[174],"owner":"architecture.captureSourceChanges","value":"手写requestSeq:1及自动捕获身份","verdict":"F1","note":"A54；A1完整公开参数契约；core-routes.ts:573,576,577禁止该字段"},
  {"section":"A1","file":"tests/data/R2e-git-operations.test.ts","line":[192,194,197],"owner":"workspace.readWorkspace/compareWorkspace","value":"手写路径及git版本对；真实git commit","verdict":"v2 允许","note":"A55；外部版本输入，非平台签发字段"},
  {"section":"A1","file":"tests/data/R2e-text-boundaries.test.ts","line":[56],"owner":"workspace.captureSourceChanges","value":"手写Workspace/revision/provider","verdict":"v2 允许","note":"A56；后续公开"},
  {"section":"A1","file":"tests/data/R3b-material-admission-boundaries.test.ts","line":[46,71,114],"owner":"materials.openArtifact","value":"12、13手造ArtifactRef指纹；raw替身提供记录","verdict":"F1","note":"A57；A1平台派生指纹条款；后续非仅公开"},
  {"section":"A1","file":"tests/data/R3b-material-await-boundaries.test.ts","line":[52],"owner":"materials.openArtifact","value":"14、15手造ArtifactRef指纹及raw记录","verdict":"F1","note":"A58；A1平台派生指纹条款；后续非仅公开"},
  {"section":"A1","file":"tests/data/R3b-materials-contract.test.ts","line":[71],"owner":"materials.storeArtifact","value":"手写正文、sources、origin","verdict":"v2 允许","note":"A59；63替身返回手造ref，A1不豁免F4"},
  {"section":"A1","file":"tests/data/R3b-materials-contract.test.ts","line":[85],"owner":"materials.openArtifact","value":"28、29自行计算ref指纹；32替身提供记录","verdict":"F1","note":"A60；A1平台派生指纹条款；后续非仅公开"},
  {"section":"A1","file":"tests/data/S8A-file-graph.test.ts","line":[73,76,79],"owner":"workspace.captureObservation/captureSourceChanges/captureFileGraph","value":"手写捕获请求；真实capture引用","verdict":"v2 允许","note":"A61；45 access夹具；后续非仅公开"},
  {"section":"A1","file":"tests/data/S8D-A17-ts-light-scan.test.ts","line":[56,58],"owner":"S8D helper/projects/architecture","value":"手写文件；公开capture/pin","verdict":"v2 允许","note":"A62；H；后续公开"},
  {"section":"A1","file":"tests/data/S8D-A18-ts-light-scan.test.ts","line":[18,26,42,63,65,67,76,95,104,109],"owner":"S8D helper/projects/architecture","value":"手写文件、mapping、查询；真实capture","verdict":"v2 允许","note":"A63；H；后续公开"},
  {"section":"A1","file":"tests/data/S8D-A19-ts-light-scan.test.ts","line":[22,27,38,43,53,59,72,78,89,95,105,111,118,124,143,145],"owner":"S8D helper/projects/architecture","value":"手写文件/config；公开graph链","verdict":"v2 允许","note":"A64；H；后续公开"},
  {"section":"A1","file":"tests/data/S8D-A20-python-imports.test.ts","line":[26,27,28,138,140],"owner":"S8D helper/projects/architecture","value":"手写文件/比较；真实catalog/capture","verdict":"v2 允许","note":"A65；H；后续公开"},
  {"section":"A1","file":"tests/data/S8D-A21-python-config.test.ts","line":[36,65,67,82,96,98,111,113,129,143,145,158,160,173,180,192,194,209,215],"owner":"S8D helper/projects/architecture/python_index","value":"手写文件/config及工具operation/path；公开capture/pin","verdict":"v2 允许","note":"A66；H；后续公开"},
  {"section":"A1","file":"tests/data/S8D-A22-cpp-imports.test.ts","line":[25,38,39,40,51,69,87,105,124,146,162,180,231,256,281,305,321,340,361,383,394,408],"owner":"S8D helper/projects/architecture","value":"手写源文件/编译配置；真实capture/catalog","verdict":"v2 允许","note":"A67；H；后续公开"},
  {"section":"A1","file":"tests/data/S8D-A23-cpp-config.test.ts","line":[22,40,56,72,90,113,136,158,178,193,207,225,242,259,275,291,307,323,338,355,372],"owner":"S8D helper/projects/architecture","value":"手写源文件/编译配置；公开graph链","verdict":"v2 允许","note":"A68；H；后续公开"},
  {"section":"A1","file":"tests/data/S8D-A24-runner.test.ts","line":[102,106,126,130,154,158,186],"owner":"S8D helper/projects/architecture","value":"手写文件/解释器选项；公开capture/graph","verdict":"v2 允许","note":"A69；H；后续公开"},
  {"section":"A1","file":"tests/data/S8D-exploration-regressions.test.ts","line":[45],"owner":"python_index/cpp_index","value":"本文件57、81、103、116手写参数经helper转交","verdict":"v2 允许","note":"A70；无签发字段；真实工具继续"},
  {"section":"A1","file":"tests/data/S8D-language-providers.test.ts","line":[72,77],"owner":"workspace.captureObservation/captureFileGraph","value":"手写scope/provider；实际captureRef","verdict":"v2 允许","note":"A71；44 access夹具；后续非仅公开"},
  {"section":"A1","file":"tests/data/S8D-platform-fixture.test.ts","line":[11,16,30],"owner":"S8D helper/projects/architecture","value":"手写文件；真实graph和修改后重读","verdict":"v2 允许","note":"A72；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A07-git-inventory.test.ts","line":[22,26,27],"owner":"S8D helper/projects/architecture","value":"手写文件/git配置；真实capture/list","verdict":"v2 允许","note":"A73；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A08-skip-list.test.ts","line":[22,24,25],"owner":"S8D helper/projects/architecture","value":"手写文件；真实capture/list","verdict":"v2 允许","note":"A74；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A09-scale.test.ts","line":[24,35,37,50,52,53],"owner":"S8D helper/projects/architecture","value":"手写文件/mapping/query；cursor取28真实nextCursor","verdict":"v2 允许","note":"A75；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A11-lightscan-fault.test.ts","line":[22,33,37,38,50,64,68,69],"owner":"S8D helper/projects/architecture/workspace","value":"手写mapping和捕获请求；真实capture","verdict":"v2 允许","note":"A76；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A12-file-chunks.test.ts","line":[59,63,65,72,81,119],"owner":"S8D helper/projects/architecture","value":"手写文件和图查询；真实capture","verdict":"v2 允许","note":"A77；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A13-edge-cap.test.ts","line":[22],"owner":"S8D helper/projects","value":"手写初始化文件/限制","verdict":"v2 允许","note":"A78；H；26容量拒绝另排除"},
  {"section":"A1","file":"tests/data/S8E-A14-narrowed-grant.test.ts","line":[22,24,26],"owner":"S8D helper/projects/architecture","value":"手写文件；真实capture/list","verdict":"v2 允许","note":"A79；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A15-previous-observation.test.ts","line":[25,27,28,42,43],"owner":"S8D helper/projects/architecture","value":"手写文件/mapping；previous取first.persisted原值","verdict":"v2 允许","note":"A80；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A23-ignored-databases.test.ts","line":[41,43,44,63,68,71,77,81],"owner":"S8D helper/projects/architecture","value":"手写文件/config；真实capture/list","verdict":"v2 允许","note":"A81；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A25-strict-capture.test.ts","line":[74,75,78,79],"owner":"workspace.captureSourceChanges/captureObservation/captureArchitectureSource/captureFileGraph","value":"手写请求/MAPPINGS；captureRef取88、103、121实际结果","verdict":"v2 允许","note":"A82；44 access夹具；后续非仅公开"},
  {"section":"A1","file":"tests/data/S8E-A27-ts-light-scan-contract.test.ts","line":[36,43,58,65,87],"owner":"S8D helper/projects/architecture","value":"手写文件/config；真实graph","verdict":"v2 允许","note":"A83；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-A28-chunk-contract.test.ts","line":[24,26,27,33,40,55],"owner":"S8D helper/projects/architecture","value":"手写文件/限制；真实capture/graph","verdict":"v2 允许","note":"A84；H；后续公开"},
  {"section":"A1","file":"tests/data/S8E-file-fault-module-layer.test.ts","line":[21,30,32,41],"owner":"S8D helper/projects/architecture","value":"手写文件、mapping及query；真实capture","verdict":"v2 允许","note":"A85；H；后续公开"},
  {"section":"A1","file":"tests/data/cpp-source-index.test.ts","line":[125,141],"owner":"cpp_index","value":"手写definitions/path/line/column","verdict":"v2 允许","note":"A86；真实工具；137观察模型请求"},
  {"section":"A1","file":"tests/data/workspace-capture-architecture.test.ts","line":[104,107,159,166],"owner":"workspace.captureSourceChanges/captureArchitectureSource","value":"手写scope/provider/config/mapping；实际captureRef","verdict":"v2 允许","note":"A87；后续含内部访问计数"},
  {"section":"A1","file":"tests/data/workspace-capture.test.ts","line":[108,110,139,186,373,389,391,392,400,408,411,453,456,486,491,533,534,537,559],"owner":"workspace.captureSourceChanges/querySource/captureArchitectureSource","value":"手写包装；cursor/previous取实际capture/page","verdict":"v2 允许","note":"A88；74 access替身；后续非仅公开"},
  {"section":"A1","file":"tests/data/workspace-text-operations.test.ts","line":[137,139,141,143,168,189],"owner":"workspace.captureSourceChanges/querySource/readWorkspace/compareWorkspace","value":"手写路径/文本条件/provider；实际capture及cursor","verdict":"v2 允许","note":"A89；公开工具及真实文件，另有122计数"},
  {"section":"A1","file":"tests/data/S8D-capture-error.test.ts","line":[51,54],"owner":"workspace CaptureRegistry.captureObservation/captureFileGraph","value":"手写scope/provider；真实captureRef","verdict":"v2 允许","note":"A90；41 access替身、47依赖异常；不豁免F4"},
  {"section":"F3","file":"tests/composition/A1-graph-session-platform.test.ts","line":[54],"owner":"records.commit","value":"Project、Workspace、TrustedScopeSeeded","verdict":"F3","note":"S01；本文件61到达"},
  {"section":"F3","file":"tests/composition/K-R-close-open-turn-health.test.ts","line":[51],"owner":"Kernel.append","value":"手造turn.started及Run/config/workspace","verdict":"F3","note":"S02；本文件116到达；非A7"},
  {"section":"F3","file":"tests/composition/K-R-close-open-turn.test.ts","line":[62,63,64,196],"owner":"KernelSessionFixture","value":"session.created、turn.started、run.started","verdict":"F3","note":"S03；K-session-support.ts:119,151,194；本文件到达"},
  {"section":"F3","file":"tests/composition/K3-R1-close-open-turn.test.ts","line":[41,42,43],"owner":"KernelSessionFixture","value":"session.created、turn.started、run.started","verdict":"F3","note":"S04；K-session-support.ts:119,151,194；本文件95到达"},
  {"section":"F3","file":"tests/composition/R3c-R4b-platform.test.ts","line":[93],"owner":"records.commit","value":"scope、CompletionPolicy、ArchitectureBaseline和active记录","verdict":"F3","note":"S05；记录数组81；本文件到达"},
  {"section":"F3","file":"tests/composition/R3d-R3g-platform.test.ts","line":[87],"owner":"records.commit","value":"Project、Workspace及seed事件","verdict":"F3","note":"S06；记录90；本文件到达"},
  {"section":"F3","file":"tests/composition/R3e-command-check-platform.test.ts","line":[167],"owner":"evidence.beginCheck","value":"手动写executing检查窗口","verdict":"F3","note":"S07；R3e-evidence-fixture.ts:344；代行Host"},
  {"section":"F3","file":"tests/composition/R4c-history-platform.test.ts","line":[40,60,64,67],"owner":"Kernel.append/executions.recordExecutionHistory","value":"手造Turn及位置5/7/7","verdict":"F3","note":"S08；64是被拒绝写尝试；60成功、67重放"},
  {"section":"F3","file":"tests/composition/W1-future-plan-platform.test.ts","line":[135,189],"owner":"records.commit","value":"scope/治理；PlanRevision、Goal、运行中Run","verdict":"F3","note":"S09；记录193、194；本文件到达"},
  {"section":"F3","file":"tests/composition/W2-future-intent-platform.test.ts","line":[119],"owner":"records.commit","value":"scope、政策、架构和active记录","verdict":"F3","note":"S10；记录124；本文件到达"},
  {"section":"F3","file":"tests/composition/C1-M1-platform.test.ts","line":[18],"owner":"createTaskClaimFixture","value":"Kernel Session、SessionCreated","verdict":"F3","note":"S11；tests/helpers/task-claim-fixture.ts:367,370"},
  {"section":"F3","file":"tests/composition/R4-control-platform.test.ts","line":[59],"owner":"createTaskClaimFixture","value":"Kernel Session、SessionCreated","verdict":"F3","note":"S12；tests/helpers/task-claim-fixture.ts:367,370"},
  {"section":"F3","file":"tests/composition/R4c-history-platform.test.ts","line":[10],"owner":"createTaskClaimFixture","value":"Kernel Session、SessionCreated","verdict":"F3","note":"S13；tests/helpers/task-claim-fixture.ts:367,370"},
  {"section":"F3","file":"tests/composition/W1-future-plan-platform.test.ts","line":[281],"owner":"createTaskClaimFixture","value":"Kernel Session、SessionCreated","verdict":"F3","note":"S14；tests/helpers/task-claim-fixture.ts:367,370"},
  {"section":"F3","file":"tests/composition/W2-future-intent-platform.test.ts","line":[170],"owner":"createTaskClaimFixture","value":"Kernel Session、SessionCreated","verdict":"F3","note":"S15；tests/helpers/task-claim-fixture.ts:367,370"},
  {"section":"F3","file":"tests/composition/A2-reconcile-classifier-platform.test.ts","line":[57,119],"owner":"createC2RuntimePlatform","value":"基础Session写及协调政策/active原始提交","verdict":"F3","note":"S16；C2-runtime-platform-fixture.ts:75,106,119,120"},
  {"section":"F3","file":"tests/composition/AG1-session-discovery.test.ts","line":[66,125],"owner":"createC2RuntimePlatform","value":"基础Session写及协调政策/active原始提交","verdict":"F3","note":"S17；C2-runtime-platform-fixture.ts:75,106,119,120"},
  {"section":"F3","file":"tests/composition/C2-runtime-platform.test.ts","line":[43],"owner":"createC2RuntimePlatform","value":"基础Session写及协调政策/active原始提交","verdict":"F3","note":"S18；C2-runtime-platform-fixture.ts:75,106,119,120"},
  {"section":"F3","file":"tests/composition/S2B-39-run17-activity.test.ts","line":[70],"owner":"createC2RuntimePlatform","value":"基础Session写及协调政策/active原始提交","verdict":"F3","note":"S19；C2-runtime-platform-fixture.ts:75,106,119,120"},
  {"section":"F3","file":"tests/composition/S2B-40-run20iii-activity.test.ts","line":[52],"owner":"createC2RuntimePlatform","value":"基础Session写及协调政策/active原始提交","verdict":"F3","note":"S20；C2-runtime-platform-fixture.ts:75,106,119,120"},
  {"section":"F3","file":"tests/composition/B2-runtime-platform.test.ts","line":[26],"owner":"createB2RuntimeFixture","value":"基础Session写及协调政策/active原始提交","verdict":"F3","note":"S21；B2-runtime-fixture.ts:183,204"},
  {"section":"F3","file":"tests/composition/R4-control-runtime-platform.test.ts","line":[103],"owner":"createB2RuntimeFixture","value":"基础Session写及协调政策/active原始提交","verdict":"F3","note":"S22；B2-runtime-fixture.ts:183,204"},
  {"section":"F3","file":"tests/composition/R3e-command-check-platform.test.ts","line":[62],"owner":"createR3eEvidenceFixture","value":"基础Session、entered、run_completed及手造历史边界","verdict":"F3","note":"S23；R3e-evidence-fixture.ts:252,254,261,262,265；B2-execution-fixture.ts:309"},
  {"section":"F3","file":"tests/composition/R3e-completion-platform.test.ts","line":[33],"owner":"createR3eEvidenceFixture","value":"基础Session、entered、run_completed及手造历史边界","verdict":"F3","note":"S24；R3e-evidence-fixture.ts:252,254,261,262,265；B2-execution-fixture.ts:309"},
  {"section":"F3","file":"tests/composition/S2B-be1-counting-failure.test.ts","line":[79],"owner":"createS2BBe1Platform","value":"基础Session及协调政策/active原始提交","verdict":"F3","note":"S25；S2B-be1-platform-fixture.ts:208"},
  {"section":"F3","file":"tests/composition/S2B-be1-cross-hour.test.ts","line":[17],"owner":"createS2BBe1Platform","value":"基础Session及协调政策/active原始提交","verdict":"F3","note":"S26；S2B-be1-platform-fixture.ts:208"},
  {"section":"F3","file":"tests/composition/S2B-be1-five-tools.test.ts","line":[24],"owner":"createS2BBe1Platform","value":"基础Session及协调政策/active原始提交","verdict":"F3","note":"S27；S2B-be1-platform-fixture.ts:208"},
  {"section":"F3","file":"tests/composition/S2B-be1-step-boundaries.test.ts","line":[17,43,73,106,132],"owner":"createS2BBe1Platform","value":"基础Session及协调政策/active原始提交","verdict":"F3","note":"S28；S2B-be1-platform-fixture.ts:208"},
  {"section":"F3","file":"tests/composition/S2B-be1-usage.test.ts","line":[17],"owner":"createS2BBe1Platform","value":"基础Session及协调政策/active原始提交","verdict":"F3","note":"S29；S2B-be1-platform-fixture.ts:208"},
  {"section":"F3","file":"tests/composition/S2B-be1s-shell.test.ts","line":[34,193],"owner":"createS2BBe1Platform","value":"基础Session及协调政策/active原始提交","verdict":"F3","note":"S30；S2B-be1-platform-fixture.ts:208"},
  {"section":"F3","file":"tests/composition/WP1-session-duty.test.ts","line":[168],"owner":"openDutyMaintenanceFixture","value":"基础Session、entered、手造完成事件和cursor","verdict":"F3","note":"S31；WP1-units-fixture.ts:123,257；S1-workflow-archive-fixture.ts:358,360,362"},
  {"section":"F3","file":"tests/composition/WP2-wiring.test.ts","line":[29],"owner":"createWP2Platform","value":"基础Session、SQLite协调政策、只读副本Kernel identity","verdict":"F3","note":"S32；WP2-platform-support.ts:331,542,579,526"},
  {"section":"F3","file":"tests/composition/WP2-wiring.test.ts","line":[133,767,934,1039,1049,1183,1542,1637],"owner":"reconcile.recordSessionHealth","value":"手写ready/missing probe推进Session健康","verdict":"F3","note":"S33；1039故障拒绝；其他继续读取消息队列"},
  {"section":"F3","file":"tests/composition/WP2-wiring.test.ts","line":[1402,1808,1821,1950,2046],"owner":"reconcile.reconcileRun/reconcileQuery","value":"公开record加手写probe和hostInstanceId，代行Host恢复写","verdict":"F3","note":"S34；record来源1398、1804、1948、2044"},
  {"section":"F3","file":"tests/data/R3b-body-boundaries.test.ts","line":[23],"owner":"RawArtifactBodyStore.put","value":"手写正文；验证内容寻址和hash次数","verdict":"v2 允许","note":"S35；19-28是存储自身契约"},
  {"section":"F3","file":"tests/data/R3b-materials-contract.test.ts","line":[40,41],"owner":"RawArtifactBodyStore.put","value":"重复正文及不同owner/source；验证重放与隔离","verdict":"v2 允许","note":"S36；37-54是存储自身契约，上层测试另起于58"},
  {"section":"F3","file":"tests/composition/W1-future-plan-platform.test.ts","line":[302,310],"owner":"委托records.commit","value":"原样传入真实业务prepared并返回真实结果","verdict":"v2 允许","note":"S37；A3委托包装；299-312"}
]
```

v2 允许 886，F1 8，F3 61，A7 越界 0，文件 98/98；枚举完整