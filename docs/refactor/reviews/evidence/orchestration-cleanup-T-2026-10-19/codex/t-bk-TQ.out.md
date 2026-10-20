改完再施工

已完整核对 TQ-001～TQ-115，共 115 项。以下列出需要修改的 18 个条目；同一编号有多个问题时分别列出。全程只读，未修改文件、运行测试或构建、执行 git 写操作、访问网络。

文中“规则表”指 `docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md`。标记 `BLOCKED` 的部分需要先补齐施工书，不能作为已完成项交付。

**1．需要修改的条目**

| 编号 | 问题 | 证据（`file:line`） | 改法 |
|---|---|---|---|
| TQ-001 | 动作要求修改 S0 测试，但该文件不在 TQ 白名单；T3-009 又负责同一转换。两组会重复施工。 | `.lead-ref/books/t-items-TQ.md:6`；`.lead-ref/books/t-items-T3.md:61`；`.lead-ref/books/t-files-T3.txt:9`；测试入口在 `tests/app/S0-attention-edge-label.test.ts:64`。 | 将 `tests/app/S0-attention-edge-label.test.ts` 加入 TQ 白名单，把 T3-009 的转换要求并入 TQ-001，撤销 T3 对这一文件和条目的重复施工。 |
| TQ-001 | AT11 的修改文件不在 TQ 白名单。AT04 也残留被删除的 `plans/architecture` 假件，动作只点了 AT11。 | `tests/app/S3-attention-context.test.ts:302`、`:304`、`:305`、`:464`、`:466`、`:467`；`.lead-ref/books/t-items-TQ.md:6`。 | 将 `tests/app/S3-attention-context.test.ts` 加入白名单；删除 AT04、AT11 的 `plans/architecture` 假件及对应旧说明，保留 AT04 的边断言和 AT11 的读取失败、基线保留、不发删除通知断言。 |
| TQ-001 | 漏了一个真实调用方。扫描器改为必须提供 `readAttentionGraph` 后，SC02 的构造仍不提供它。该文件由 T2 修改。 | `tests/scenarios/S3-query-graph.test.ts:459`；`.lead-ref/books/t-files-T2.txt:44`；`.lead-ref/books/t-items-T2.md:356`、`:363`。 | 将该文件加入 TQ 的明确共享白名单；把 SC02 的扫描器构造改为绑定 `h.platform.runtime.readAttentionGraph`，删除 `plans/architecture` 参数，保留 SC02 全部业务断言；与 T2-051、T2-052由 lead 合并协调。 |
| TQ-001 | “只换入口、其余期望照留”不能直接执行。S0-01 固定要求 `plan:p1`，而真实读取器会把已采用架构的摘要加入 revision。S0-02/03 的总变化数还会计入 revision 变化。 | `tests/app/S0-attention-edge-label.test.ts:71`、`:79`、`:90`；`src/core/work-graph/views/graph-context-reader.ts:1711`、`:1715`；`src/app/attention-observer.ts:238`。 | 在条目中明确：三个 S0 用例使用符合规则表 A1 的真实建图前置步骤，并运行 memory、SQLite；固定两次比较所用的 Plan 标识和架构内容，只改变指定的依赖 kind/label；将 S0-01 的 revision 期望改为按固定输入手算的完整 `plan:…\|arch:…` 字面量，保留两条边变化及零节点、零状态变化断言。 |
| TQ-070 | 明确要求保留的测试，又被 TQ-099 明确要求整条删除；覆盖依据还引用 TQ-094 要删除的测试。 | `.lead-ref/books/t-items-TQ.md:422`、`:423`、`:615`；`tests/data/R3b-materials-contract.test.ts:88`；`tests/data/R3b-body-boundaries.test.ts:44`。 | 删除 TQ-070 中“88-106 照留”及两处将被删除的损坏正文覆盖引用；统一写明该混合测试按 TQ-099 删除，当前格式覆盖保留 materials-contract 的 45、110、132、144 行用例和 body-concurrency 的 60 行用例。 |
| TQ-075 | 要求“保留原条目的测试列表”，但原条目没有测试列表，记的是调用 owner。 | `tests/architecture/production-reach-allowlist.json:614`；实际调用在 `src/core/work-graph/configuration/role-memory-service.ts:375`。 | note 保留已裁定的 Role 保留理由，末句改为 `called by RoleConfigurationPort.installRoleSpec; no direct test caller`；删除不存在的测试列表占位要求。 |
| TQ-076 | 同上；原条目记录的是 `activateRoleSpec`，没有测试列表。 | `tests/architecture/production-reach-allowlist.json:620`；`src/core/work-graph/configuration/role-memory-service.ts:500`。 | note 保留已裁定的 Role 保留理由，末句改为 `called by RoleConfigurationPort.activateRoleSpec; no direct test caller`；删除测试列表占位要求。 |
| TQ-077 | 同上；原条目记录的是 `installRoleSpec`，没有测试列表。 | `tests/architecture/production-reach-allowlist.json:626`；`src/core/work-graph/configuration/role-memory-service.ts:379`。 | note 保留已裁定的 Role 保留理由，末句改为 `called by RoleConfigurationPort.installRoleSpec; no direct test caller`；删除测试列表占位要求。 |
| TQ-078 | 同上；原条目记录的是 `activateRoleSpec`，没有测试列表。 | `tests/architecture/production-reach-allowlist.json:632`；`src/core/work-graph/configuration/role-memory-service.ts:504`。 | note 保留已裁定的 Role 保留理由，末句改为 `called by RoleConfigurationPort.activateRoleSpec; no direct test caller`；删除测试列表占位要求。 |
| TQ-087 | 动作中的字段范围写成 50-53；第 50 行是 `runRef`，`manifestDigest` 在第 54 行。符号清单正确，但行号不能按字面施工。 | `src/core/work-graph/tasks/model-call-contracts.ts:50`、`:51`、`:54`。 | 将动作中的字段范围改为 `model-call-contracts.ts:51-54`，明确仅将所列四个可选字段改为必填。 |
| TQ-088 | “删 464-470 的指针例外”把仍有效的 project/workspace 校验和 Session 归属校验也包进去了；删除补充合并后还会留下多个被引用的局部变量。 | `src/core/work-graph/tasks/session-facts.ts:395`、`:403`、`:443`、`:450`、`:453`、`:464`、`:469`、`:474`、`:476`。 | 明确保留 464-466 的作用域校验；469 改为只检查 `!sessionMatch`；删除 453 的指针豁免。删除全部 `pointerDone/pointerKey/pointerDoneNext` 相关读写，直接遍历索引返回的 keys，以索引分页结果推进游标；不得删除 canonical read 缺记录、损坏记录、作用域和 Session 归属拒绝。 |
| TQ-091 | 只改历史 revision 读取器不够。当前指针读取器仍能返回 `catalog:null`，其返回类型也仍可空。动作又要求删除下游空值分支，会留下类型和行为缺口。 | `src/core/work-graph/architecture/catalog-service.ts:357`、`:396`、`:398`、`:411`、`:779`、`:781`、`:820`。 | 同时将 `CurrentCatalogWindow` 的 ready 分支改为非空 catalog；`readCurrentCatalogWindow` 缺 catalog 行时返回 `unavailable`，成功时必须解码得到 catalog，并无条件加入 catalog guard；将 `readCatalogBesideBaseline` 成功返回类型同步收窄。 |
| TQ-091 | `architecture-service.ts:1548` 不是 `revision.catalog` 的旧格式分支。没有采用架构时，真实调用方仍传入 `catalog:null`。删掉会改变当前行为。 | `src/core/work-graph/architecture/architecture-service.ts:1548`；`src/composition/architecture-reminder-facts.ts:25`、`:27`、`:28`。 | 从简化清单中删除 `architecture-service.ts:1548`；保留没有当前 catalog 时返回空 findings 的处理。 |
| TQ-091 | `architecture-service.ts:1716` 是公开输入校验，不是旧 revision 返回值的空分支。 | `src/core/work-graph/architecture/architecture-service.ts:1708`、`:1715`、`:1716`、`:1721`。 | 从简化清单中删除 `architecture-service.ts:1716`；完整保留 catalog pin 的解析拒绝及其相对于后续作用域检查的顺序。 |
| TQ-091 | 删除 `graph-session-fixture.ts:123-127` 会同时删掉仍使用的 `createSession` 参数及返回类型结尾。 | `tests/helpers/graph-session-fixture.ts:121`、`:123`、`:124`、`:125`、`:127`。 | 接口处只删除 125-127 的旧基线说明和 `seedLegacyArchitectureBaseline` 声明；保留 121-124 的完整 `createSession` 声明。实现和返回对象成员仍按 403-417、511 删除。 |
| TQ-099 | “整条 88-108”包含外层 `describe` 的结束括号，按范围删除会破坏文件结构。 | `tests/data/R3b-materials-contract.test.ts:88`、`:106`、`:107`、`:109`。 | 删除范围改为 88-106；保留 107 行外层 `describe` 的结束括号。 |
| TQ-103 | 所列 `proposePlan` 调用不足以构成规则表允许的转换：从现有手写 Plan 拼出 draft 再交 owner 接受，仍是 F1。条目没有指定允许的 draft 生产入口。 | 当前手写 Plan 在 `tests/helpers/graph-session-fixture.ts:443`、`:464`；规则表 `:24`、`:57`；动作在 `.lead-ref/books/t-items-TQ.md:643`。 | 本项暂标 `BLOCKED`；保留“只在 seedAcceptedTask 内先 adopt”的要求，补齐由真实 Workflow 和脚本模型生成计划提议的前置链后再冻结施工动作；禁止把手写 snapshot 改成手写 draft 后直接调用 `proposePlan`。 |
| TQ-104 | “claimTask 自动打开 responsible 链接”不符合代码。只有显式传 `openResponsibleLink:true` 才打开；因此没有必要改掉原有单独开链接断言。 | `src/core/work-graph/tasks/claim-service.ts:1035`、`:1040`、`:1227`；原开链接步骤在 `tests/work-graph/A1-session-lifecycle.test.ts:143`。 | 改为：claim 时不传 `openResponsibleLink`；断言 busy；通过 `submitControl` 取消未进入的 Run；保留原 143-154 的开责任链接、阻止归档、关闭链接、成功归档步骤及断言。夹具登记 `CONTROL_RECORD_SCHEMAS` 并接入真实 control owner，然后删除 `overwriteSession`。 |
| TQ-105 | “healthy 段也删或改用 adopt，只留 not_found”有不同读法，并与 TQ-110 明确保留 healthy 分支冲突。 | `.lead-ref/books/t-items-TQ.md:657`、`:692`、`:693`；`tests/work-graph/A1-architecture-catalog.test.ts:181`、`:189`、`:192`。 | 统一按 TQ-110：只删篡改段和专用篡改用例；保留缺指针断言及 189-193 的 healthy 分支，把 190 行改为 `healthy.adopt(...)`。删除“healthy 段也删”和“只留 not_found”。 |
| TQ-106 | “涉及测试”写了不存在的 `openGraphSessionFixture`；实际入口名称不同。删除四个 export 的动作本身成立。 | `.lead-ref/books/t-items-TQ.md:668`；`tests/helpers/graph-session-fixture.ts:257`。 | 将“涉及测试”中的 `openGraphSessionFixture` 改为 `createGraphSessionFixture`。 |
| TQ-111 | 首个用例的 `keep-note` 仍保留直接改库生成不可达状态，违反书本和规则表。条目自己也确认公开 Plan 变更不允许物理删除 Task。 | `tests/work-graph/A1-independent-review.test.ts:39`、`:48`；`src/core/work-graph/tasks/plan-validation.ts:336`；`.lead-ref/books/t-book.md:52`；规则表 `:53`、`:61`、`:64`。 | 将 22-62 子项由 `keep-note` 改为 `BLOCKED`，不得计作完成；保留原文件等待 lead 冻结处置。66-95 的真实 adopt→revise 竞争转换单独继续。 |
| TQ-112 | 动作给了“另一个 Session”和“B2 enter→recordRunResult”两条不同实现，还与 TQ-104 的取消路径不一致；后一个方案又触犯 F3。 | `.lead-ref/books/t-items-TQ.md:706`；`tests/work-graph/A1-session-lifecycle.test.ts:132`；规则表 `:64`、`:66`；释放路径在 `src/core/work-graph/state/session-availability.ts:810`、`:814`。 | 将动作统一为修正后的 TQ-104：同一 Session，不传 `openResponsibleLink` 的 claim→busy→取消未进入 Run→原责任链接及归档步骤。删除另一个 Session 和 B2 终态方案。 |
| TQ-114 | 指定的执行链并不符合规则表。所引 S2B 夹具自己构造 entered、终态事件和 observation，再调用 Runtime 通常负责的写入。 | `tests/helpers/S2B-activity-fixture.ts:471`、`:483`、`:501`、`:508`；规则表 `:64`、`:66`。 | 将执行事实转换改为真实 Host/Workflow 调度脚本模型，由 Runtime 产生 entered 和终态事实；禁止测试直接调用 `recordExecutionEntered`、带手写 observation 的 `recordRunResult`。符合 v1 的具体共享入口冻结前，本子项标 `BLOCKED`。 |
| TQ-114 | 现有夹具写了三条 Run，动作只说 runA/runB；而且两者目标状态不同，不能都执行到 `recordRunResult`。 | `tests/work-graph/S3-context-inputs.test.ts:484`、`:486`、`:488`、`:489`；runA2 的使用在 `:395`、`:721`。 | 明确三条状态映射：runA、runA2 由真实执行结束；runB 只走真实 claim，保留 starting 状态，不执行 entry 和终态步骤。不得留下 runA2 的 raw commit。 |
| TQ-114 | 明确保留 IN04 手写跨工作区 Run，仍然不符合 v1；没有公开步骤不能成为保留手写事实的理由。 | `tests/work-graph/S3-context-inputs.test.ts:482`、`:485`、`:487`、`:712`；`.lead-ref/books/t-book.md:52`；规则表 `:64`。 | 将 IN04 子项标为 `BLOCKED`，删去“继续手写”的施工授权；在 lead 冻结允许的前置状态前，不得把该子项计为转换完成。 |
| TQ-114 | 明确保留 IN14 手写 Message，同样违反 v1；其断言还通过直接读 store 获取消息状态。 | `tests/work-graph/S3-context-inputs.test.ts:134`、`:501`、`:604`、`:606`、`:827`；规则表 `:64`、`:76`。 | 将 IN14 子项标为 `BLOCKED`，删去继续提交手写 Message 的授权；放行前必须冻结真实发送、回复、决策标签关联及公开消息读取的完整步骤。 |
| TQ-114 | 当前前置初始化直接提交 Project、Workspace 和治理记录。仅替换 Run 段仍没有 A1 前置状态。 | `tests/work-graph/S3-context-inputs.test.ts:301`、`:321`、`:326`、`:329`；规则表 `:21`、`:64`。 | 在本项转换范围中明确加入公开项目登记、两个 Workspace 登记、策略安装和激活、架构采用，替换 288-330 的 raw scope/governance seed；由真实登记结果承接后续版本 pin。 |
| TQ-114 | 当前材料前置直接调用 raw body store 写入，不能原样搬进宣称符合 v1 的替换夹具。 | `tests/work-graph/S3-context-inputs.test.ts:395`、`:401`、`:405`；规则表 `:64`。 | 将 old-A、new-A 的准备改为在对应真实 owner 已存在后，通过真实 `materials.storeArtifact` 写入；缺正文用例不写 old-A。删除前置的两处 `rawBodies.put`。 |
| TQ-114 | 当前 Plan 前置是测试直接构造 draft 并让 owner 接受；替换执行夹具并不会消除这一 F1。 | `tests/work-graph/S3-context-inputs.test.ts:432`、`:458`、`:464`；规则表 `:57`。 | 将 Plan 前置纳入同一真实 Workflow／脚本模型转换链，禁止直接接受测试构造的 `PlanRevisionDraft`；此入口与 Run 前置一起冻结，未冻结前本项保持 `BLOCKED`。 |
| TQ-115 | IN11 指定测试直接调用 `recordCheckResult`，实际上这是检查 runner 依据真实进程观察调用的写入，不能用手写结果完成转换。 | `src/core/work-graph/model/evidence-contracts.ts:172`、`:178`；`src/core/agent-runtime/check-execution.ts:108`、`:115`；规则表 `:64`。 | 将 IN11 的步骤改为 `openVerification`→真实 `runRegisteredCheck` 执行登记脚本→`finalizeChecks`；begin 和 result recording 由真实 runner 完成，测试不得构造 `CheckProcessObservation`。 |
| TQ-115 | 上述公开流程无法保留 IN11 的原精确期望：原测试要求 finalized round revision 为 1、报告为 text/plain 的 new-A；真实流程会递增版本，并存储专门的检查报告 JSON。 | `tests/work-graph/S3-context-inputs.test.ts:112`、`:795`、`:796`；`src/core/work-graph/state/verification-machine.ts:915`、`:978`、`:1026`；`src/core/work-graph/evidence/evidence-service.ts:832`、`:847`。 | IN11 暂标 `BLOCKED`；在条目中撤销对原 `revision:1/reportRef:newRef` 的保留要求，由 lead 先冻结真实单检查流程的精确断言，包括手算 revision 为 4 和真实检查报告语义；冻结前不得放宽 `toEqual`、删除来源字段断言或复制运行输出作为期望。 |
| TQ-115 | IN12 的 `keep-note` 保留了公开状态机明确拒绝的 PASS→FAIL 后继链，与书本的不可达状态规则冲突。 | `tests/work-graph/S3-context-inputs.test.ts:375`、`:497`、`:799`；`src/core/work-graph/state/verification-machine.ts:1440`；`.lead-ref/books/t-book.md:52`。 | 将 IN12 由 `keep-note` 改为 `BLOCKED`；删除由 DSH 自行选择退役或改链的文字，等待 lead 冻结处置，不得保留手写链并报完成。 |

**2．白名单补充**

以下是按现有动作和上述调用方修正，已经确定需要编辑的缺失文件。

| 文件 | 对应条目 | 是否在其他组白名单 |
|---|---|---|
| `tests/app/S0-attention-edge-label.test.ts` | TQ-001 | 是，T3：`.lead-ref/books/t-files-T3.txt:9`。T3-009 与本项是同一转换，应统一归 TQ。 |
| `tests/app/S3-attention-context.test.ts` | TQ-001 | 否，其他四组白名单均未列入。 |
| `tests/scenarios/S3-query-graph.test.ts` | TQ-001 | 是，T2：`.lead-ref/books/t-files-T2.txt:44`。保留明确共享文件例外，由 lead 协调扫描器修改与 T2-051/052。 |

TQ-114 引用的 `tests/helpers/B2-execution-fixture.ts`、`tests/helpers/S2B-activity-fixture.ts` 分别在 TP 白名单第 136、145 行。不能把引用这些文件理解成获准修改它们，也不能把现有实现视为已经满足 v1。TQ-103/114/115 的替换入口尚未冻结；新入口若需要编辑其他文件，必须随修订后的条目明确列入白名单。

**3．生产改动的调用方及下游核对**

下表区分了“白名单外但无需改动”和“白名单外且动作漏覆盖”。只改允许清单说明、明确不改源码的 TQ-002～061、063～064、075～078，没有生产接口变化。

| 条目 | 调用方及下游 | 白名单与动作覆盖结论 |
|---|---|---|
| TQ-001 | 五处 scanner 构造：`src/app/host.ts:1444`；`tests/app/S0-attention-edge-label.test.ts:64`；`tests/app/S3-attention-context.test.ts:302`、`:464`；`tests/scenarios/S3-query-graph.test.ts:459`。实际 runtime reader 装配在 `src/composition/create-platform.ts:1509`。 | Host 在白名单；三个测试文件缺失，已逐处列入问题表。runtime 装配无需修改。 |
| TQ-062 | 生产者 `src/app/host-settings.ts:548`；输出包含两个字段，见 `:564`、`:565`。UI 消费在 `src/ui/settings.ts:71`、`:85`、`:463`。测试及场景读取在 `tests/app/host-settings.test.ts:368`、`tests/app/A2-automation-verdict.test.ts:60`、`tests/scenarios/harness.ts:1087`、`tests/scenarios/support/receipts.ts:208`。 | 这些白名单外调用方不构造缺字段快照，无需修改。需要补齐的两个字面量已由动作覆盖：`tests/app/settings-ui.test.ts:38`、`:93`。 |
| TQ-065～069、089 | 五个契约仅形成读取器内部依赖，见 `src/contracts/role-material-channels.ts:32`、`:35`、`:51` 和 `src/core/workspace/role-source-reader.ts:39`。外部使用只有 `tests/data/workspace-path-boundary.test.ts:67`、`:75`、`:97`。 | 删除闭包全部在 TQ 白名单，动作覆盖。保留的拒绝前缀断言确实在 `tests/data/workspace-path-boundary.test.ts:57`。 |
| TQ-070、079 | 编解码调用方为 `src/core/record-store/body-store.ts:30`、`:63`，SQLite 复用该 store，见 `src/core/record-store/sqlite-body-store.ts:48`。来源读取方包括 `src/core/work-graph/materials/material-service.ts:103`、`src/core/work-graph/tasks/context-input-service.ts:423`、`:506`；RawArtifactRecord 下游还包括 `src/core/work-graph/tasks/execution-entry-service.ts:326`、`src/core/work-graph/tasks/run-state-service.ts:679`、`src/core/work-graph/queries/query-execution.ts:451`、`src/core/agent-runtime/query-execution.ts:101`。 | 上述调用方均在 TQ 白名单外；当前 run/platform 来源及公共返回形状不变，无需修改。不能顺带删除一般的 owner-null 拒绝：`src/core/work-graph/materials/applicability.ts:98` 仍可能从 TaskAttempt 来源得到 null。测试内 legacy 使用由动作覆盖。 |
| TQ-071、072 | 两个初始化调用均在 `src/core/record-store/sqlite-record-store.ts:162`、`:166`，平台后端装配在 `src/composition/create-platform.ts:678`。 | 白名单外，无需改调用接口。071 保留缺索引创建和事务；072 保留当前 text scan 初始化。对应测试和专用 FTS 夹具删除已覆盖。 |
| TQ-073、080、082、083 | 被删声明分别在 `src/core/work-graph/architecture/architecture-record-codecs.ts:41`、`src/core/work-graph/model/note-contracts.ts:44`、`src/core/work-graph/persistence/decision-record-codecs.ts:53`、`:54`；`rg` 的其他命中只有生产可达性允许清单。 | 无遗漏调用方。当前块格式校验使用 schemaVersion，见 `src/core/work-graph/architecture/architecture-record-codecs.ts:317`；决定事件登记使用 eventType/schemaVersion，见 `src/core/work-graph/persistence/decision-record-codecs.ts:431`、`:436`。 |
| TQ-074 | catalog 解码调用在 `src/core/work-graph/architecture/catalog-service.ts:399`、`:421`，以及白名单外 `src/core/work-graph/notes/note-version-lists.ts:135`；内嵌 catalog 校验在 `src/core/work-graph/architecture/catalog-record-codecs.ts:523`。 | 调用接口不变；当前两处 writer 都写 since，见 `src/core/work-graph/architecture/catalog-service.ts:525`、`:707`，修订提交绑定游标在 `:741`。无需补调用方文件。 |
| TQ-081 | 被删函数只有测试调用：`tests/work-graph/K3-39-tool-commit-lookup.test.ts:72`。实际分派自行返回结果，见 `src/composition/tool-commit-lookup.ts:48`。 | 测试修改已覆盖；分派文件在白名单外，无需改。命名覆盖确实断言 `lookup_not_published`：`tests/work-graph/K3-39-tool-commit-lookup.test.ts:111`、`tests/work-graph/K3-39-record-note-lookup.test.ts:94`。 |
| TQ-084 | `withNoticeClass` 三处使用在 `src/core/work-graph/persistence/note-record-codecs.ts:472`、`:584`、`:612`。解码下游包括 `src/core/work-graph/notes/note-read-model.ts:177`、`src/core/work-graph/views/note-review-notices.ts:109`、`src/core/work-graph/views/note-views.ts:255`、`src/core/work-graph/notes/note-service.ts:533`、`:576`、`src/core/work-graph/communication/decision-application.ts:72`。 | `note-views.ts` 在白名单，其余下游在白名单外；当前返回形状不变，无需修改它们。三个 helper 调用点均已被动作点名。 |
| TQ-085、086 | 被删 wrapper 的调用都在 `tests/state/command-normalization.test.ts:52`、`:62`、`:116`、`:222`、`:269`、`:282`、`:331`、`:401`、`:436`。生产使用 detailed：`src/core/work-graph/tasks/command-recognition.ts:60`、`src/core/work-graph/tasks/command-expansion.ts:170`、`src/core/work-graph/tasks/unknown-call-review-service.ts:238`。 | wrapper 调用全部覆盖；三处生产 detailed 调用在白名单外，但该接口保留，无需修改。 |
| TQ-087 | 唯一许可生产者及消费更新在 `src/core/work-graph/tasks/model-call-service.ts:144`、`:251`；解码读取在 `:237`，事件恢复在 `:287`。另有测试 helper 读取 `tests/helpers/S5-queue-support.ts:89`。 | 这些文件在白名单外；当前 producer 已写四个字段，收紧类型无需修改调用方。问题仅为动作行号。 |
| TQ-088 | 下游为 `src/business/workflow/session-archive.ts:210`、`src/business/workflow/session-maintenance.ts:329`；HTTP 绑定和分派在 `src/app/core-routes.ts:805`、`:1128`，DTO 在 `src/app/core-http-types.ts:604`。 | 均在白名单外；接口不变，无需改调用方。必须保留问题表指出的当前校验和正常分页语义。 |
| TQ-090、093 | V1 键的外部导出和测试使用在 `src/ui/main.ts:64`、`tests/app/MVP-ui-entry.test.ts:31`、`:264`。当前全局读取在 `src/ui/main.ts:119`；恢复读取在 `src/ui/views/sessions/restore.ts:41`、`:45`。 | V1 使用的删除已覆盖。恢复文件在白名单外，无需改；当前 v2 读取和恢复保留。 |
| TQ-091 | 条目列出的生产 catalog 字段读取位置均存在。另有返回类型链 `src/core/work-graph/architecture/catalog-service.ts:357`、`:781`，以及白名单外的 `src/core/work-graph/notes/note-service.ts:1040`、`src/composition/create-platform.ts:1376`、`src/app/core-routes.ts:694`、`src/app/core-http-types.ts:82`。 | 缺失的是当前读取器收窄，已列问题；这些白名单外消费者无需改接口。直接使用 ArchitectureRevision 类型的外部测试/包装器包括 `tests/app/R6-workbench.test.ts:123`、`tests/helpers/S4A-note-fault-fixture.ts:113`、`tests/helpers/S4B-note-check-fixture.ts:108`，没有必须保留的成功 `catalog:null` 构造。 |
| TQ-091 的旧夹具删除 | 三处调用分别是 `tests/work-graph/A1-architecture-catalog.test.ts:171`、`:190`、`tests/work-graph/A1-independent-review.test.ts:66`。 | 全部在白名单，已由 091、101、109、110、111 覆盖；必须按下述顺序闭合。 |

**4．必须一起落地或按顺序执行的条目**

| 条目组合 | 必须遵守的关系 |
|---|---|
| TQ-001 与 S0 转换、AT04/AT11 修改、SC02 调用方修改 | 作为一个完整变更验收。删除回退前不能留下 S0 的旧构造或 SC02 的缺参调用；具体位置见 `tests/app/S0-attention-edge-label.test.ts:42`、`tests/scenarios/S3-query-graph.test.ts:459`。同时解决 T3-009 重复归属和 T2 共享文件。 |
| TQ-065～069、089 | 五个契约、读取器、三个专用测试及六条允许清单记录一起删除。类型引用链在 `src/core/workspace/role-source-reader.ts:39`、`src/contracts/role-material-channels.ts:51`。 |
| TQ-070、079、095、097、098、099，以及 IN18 删除 | 同批闭合来源类型、编解码、镜像检查及旧格式测试。先统一 070/099 的冲突。IN18 的旧来源假件在 `tests/work-graph/S3-context-inputs.test.ts:554`，用例在 `:874`。 |
| TQ-072、100、107 | SP-12 与专用夹具、导入必须一起删除，见 `tests/record-store/SP-text-scan.test.ts:16`、`:415`。生产 drop 删除与测试删除没有技术上的先后依赖；不要重复施工同一段。 |
| TQ-085、086、108 | 先把保留测试全部迁往 detailed，再删 wrapper/type；108 的合并目标保留 `unparsed` 和非空 reason 两个断言，见 `tests/state/command-normalization.test.ts:281`、`:325`。 |
| TQ-088、113 | 查询指针补充路径和 SV53 同批处理；SV06 保留。旧测试直接改 Session 指针在 `tests/work-graph/S1-session-facts.test.ts:181`。 |
| TQ-090、093 | V1 生产读取、导出、测试导入和迁移段一起删除；保留 `tests/app/MVP-ui-entry.test.ts:243` 至 `:259` 的当前分 scope／全局断言。 |
| TQ-091、101、109、110、111 的第二段 | 先将两个“借旧基线作为正常前提”的调用改为真实 adopt/revise，再删旧 helper 和旧格式用例，最后完成非空类型及所有读取分支收窄。不能先删 helper 再留调用方。 |
| TQ-105、110 | 使用同一份删除清单，保留同一份 healthy 分支；不要各自执行互相冲突的版本。 |
| TQ-102 → TQ-103 → TQ-104、112 | 先公开初始化，再建立合法已采用 Plan，最后做 claim/cancel 归档场景。103 的合法计划生产入口未冻结前，后两项不能被当作已经具备合法前置。 |
| TQ-114 → TQ-115 的 IN11 | 先取得真实结束的 producer Run，再开 gate verification。gate 使用同 Goal 的真实 ended work Run，见 `src/core/work-graph/evidence/evidence-service.ts:1074`。IN12 和 111 的首段保留独立 BLOCKED 状态。 |
| 所有允许清单编辑与 TP | TQ 按声明定位修改自身条目，不重排文件；既有共享规则在 `.lead-ref/books/t-run-TQ.md:5`。 |

**5．book／run 文件的问题**

1. **“动作最终”与非法转换之间缺少明确优先级。**  
   `.lead-ref/books/t-book.md:22` 说动作最终，`:48` 要求遵循默认拒绝的 v1，`:52` 又规定不可达状态必须 BLOCKED。TQ-111、114、115 却明确要求保留手写事实。应补一句：**动作中点名的步骤若违反 v1，按 BLOCKED 处理；“keep-note”不是 v1 例外，也不能报 done。** v1 的例外清单目前为空，见规则表 `:53`。

2. **“生产先做、最后做测试”的顺序必须服从依赖组合。**  
   `.lead-ref/books/t-run-TQ.md:6` 的括号只说生产项点名的测试，没有明确覆盖共享 helper 和重复条目的完整依赖。应改为：**按本次冻结的依赖组合施工，每个组合内同时完成生产、调用方、夹具、断言和允许清单修改，再检查；禁止把组合拆成悬空状态交付。**

3. **“白名单不重叠”的说明需要随 TQ-001 修订。**  
   当前 run 只声明允许清单的 TP 例外，见 `.lead-ref/books/t-run-TQ.md:5`。补入上述三个文件后，必须明确 S0 的唯一负责人及 SC02 的 T2 共享编辑范围，不能继续笼统写“白名单不重叠”。

4. **内存规则的“never two at once”作用范围不清楚。**  
   五组并行见 `.lead-ref/books/t-run-TQ.md:5`；每组又都被要求由自己的 coordinator 跑 typecheck，见 `:7` 和 `.lead-ref/books/t-book.md:71`。应明确：**五组共用一个 typecheck 串行名额，由 lead 排队；不能只保证每组内部不并发。**

文档后注统一由 lead 处理，按 `.lead-ref/books/t-book.md:33` 执行；不把条目里的规格后注文字解释为 DSH 可以编辑 `docs/`。

**6．相同问题的 JSON**

```json
[
  {
    "id": "TQ-001",
    "problem": "S0 转换缺 TQ 白名单，且与 T3-009 重复负责；见 .lead-ref/books/t-items-T3.md:61、.lead-ref/books/t-files-T3.txt:9。",
    "fix": "把 S0 测试归入 TQ，将 T3-009 要求并入本项，撤销 T3 对该条目和文件的重复施工。",
    "files_add": ["tests/app/S0-attention-edge-label.test.ts"]
  },
  {
    "id": "TQ-001",
    "problem": "AT11 修改文件缺白名单，AT04 也残留被删除的依赖假件；见 tests/app/S3-attention-context.test.ts:304、:305、:466、:467。",
    "fix": "删除 AT04、AT11 的 plans/architecture 假件及旧说明，保留边断言以及读取失败、基线保留和不发送删除通知的断言。",
    "files_add": ["tests/app/S3-attention-context.test.ts"]
  },
  {
    "id": "TQ-001",
    "problem": "漏改未提供 readAttentionGraph 的 SC02 调用方；见 tests/scenarios/S3-query-graph.test.ts:459。",
    "fix": "为 SC02 扫描器绑定 h.platform.runtime.readAttentionGraph，删除 plans/architecture 参数，保留业务断言；将文件列为与 T2 明确共享的编辑范围。",
    "files_add": ["tests/scenarios/S3-query-graph.test.ts"]
  },
  {
    "id": "TQ-001",
    "problem": "真实 reader 的 revision 带架构摘要，不能保留原 plan:p1 期望；revision 差异还会计入变化数。见 tests/app/S0-attention-edge-label.test.ts:71、src/core/work-graph/views/graph-context-reader.ts:1715、src/app/attention-observer.ts:238。",
    "fix": "使用符合 A1 的真实前置链并覆盖 memory、SQLite；固定比较双方的 Plan 标识和架构内容，只改变依赖 kind/label；明确完整 revision 的手算字面量，保留两条边变化及零节点、零状态变化断言。",
    "files_add": []
  },
  {
    "id": "TQ-070",
    "problem": "要求保留的混合测试被 TQ-099 删除，覆盖依据还引用 TQ-094 删除的测试。见 .lead-ref/books/t-items-TQ.md:422、:423、:615。",
    "fix": "删除“88-106 照留”及已删除测试的覆盖引用；按 TQ-099 删除混合测试，保留当前格式材料测试和 SQLite 并发重开覆盖。",
    "files_add": []
  },
  {
    "id": "TQ-075",
    "problem": "原允许清单条目没有要求保留的测试列表；见 tests/architecture/production-reach-allowlist.json:614。",
    "fix": "保留已裁定的 Role 理由，note 末句改为 called by RoleConfigurationPort.installRoleSpec; no direct test caller。",
    "files_add": []
  },
  {
    "id": "TQ-076",
    "problem": "原允许清单条目没有要求保留的测试列表；见 tests/architecture/production-reach-allowlist.json:620。",
    "fix": "保留已裁定的 Role 理由，note 末句改为 called by RoleConfigurationPort.activateRoleSpec; no direct test caller。",
    "files_add": []
  },
  {
    "id": "TQ-077",
    "problem": "原允许清单条目没有要求保留的测试列表；见 tests/architecture/production-reach-allowlist.json:626。",
    "fix": "保留已裁定的 Role 理由，note 末句改为 called by RoleConfigurationPort.installRoleSpec; no direct test caller。",
    "files_add": []
  },
  {
    "id": "TQ-078",
    "problem": "原允许清单条目没有要求保留的测试列表；见 tests/architecture/production-reach-allowlist.json:632。",
    "fix": "保留已裁定的 Role 理由，note 末句改为 called by RoleConfigurationPort.activateRoleSpec; no direct test caller。",
    "files_add": []
  },
  {
    "id": "TQ-087",
    "problem": "字段范围 50-53 错位；manifestDigest 实际在 src/core/work-graph/tasks/model-call-contracts.ts:54。",
    "fix": "字段修改范围改为 model-call-contracts.ts:51-54，仅将四个点名字段改为必填。",
    "files_add": []
  },
  {
    "id": "TQ-088",
    "problem": "删除范围包含当前作用域和 Session 校验，且指针分页变量还有剩余引用；见 src/core/work-graph/tasks/session-facts.ts:443、:453、:464、:469、:476。",
    "fix": "保留作用域校验，将归属判断改为 !sessionMatch；只删除指针豁免和全部指针游标逻辑，直接按索引 keys 与分页结果读取、推进，保留缺记录和损坏记录拒绝。",
    "files_add": []
  },
  {
    "id": "TQ-091",
    "problem": "当前指针读取器及 CurrentCatalogWindow 仍允许 catalog:null；见 src/core/work-graph/architecture/catalog-service.ts:358、:396、:411、:781。",
    "fix": "同时收窄 CurrentCatalogWindow；当前读取缺目录行返回 unavailable，成功必须包含解码后的 catalog 和无条件 catalog guard；历史读取成功类型同步收窄。",
    "files_add": []
  },
  {
    "id": "TQ-091",
    "problem": "architecture-service.ts:1548 处理当前未采用架构的合法输入；真实调用见 src/composition/architecture-reminder-facts.ts:28。",
    "fix": "从简化清单删除 architecture-service.ts:1548，保留 catalog 为 null 时的空 findings 行为。",
    "files_add": []
  },
  {
    "id": "TQ-091",
    "problem": "architecture-service.ts:1716 是公开 catalog pin 输入校验，不是旧 revision 分支。",
    "fix": "从简化清单删除 architecture-service.ts:1716，保留该拒绝及其检查顺序。",
    "files_add": []
  },
  {
    "id": "TQ-091",
    "problem": "123-127 删除范围侵入 createSession 声明；见 tests/helpers/graph-session-fixture.ts:123、:124。",
    "fix": "接口处只删除 125-127，保留完整 createSession 声明；旧 helper 实现和返回成员按原点名位置删除。",
    "files_add": []
  },
  {
    "id": "TQ-099",
    "problem": "88-108 包含外层 describe 的结束括号；见 tests/data/R3b-materials-contract.test.ts:107。",
    "fix": "只删除 88-106，保留 107 行外层结束括号。",
    "files_add": []
  },
  {
    "id": "TQ-103",
    "problem": "直接把手写 Plan 改成 draft 后交 proposePlan 接受仍违反 F1；原状态见 tests/helpers/graph-session-fixture.ts:443、:464，规则表:57。",
    "fix": "暂标 BLOCKED；保留 seedAcceptedTask 内先 adopt 的要求，先冻结真实 Workflow 与脚本模型生产计划提议的入口，禁止直接接受测试构造的 draft。",
    "files_add": []
  },
  {
    "id": "TQ-104",
    "problem": "claim 只有显式 openResponsibleLink:true 才开责任链接；见 src/core/work-graph/tasks/claim-service.ts:1040、:1227。",
    "fix": "claim 不传 openResponsibleLink，断言 busy 后取消未进入的 Run，保留原单独开链接和归档断言；夹具登记 CONTROL_RECORD_SCHEMAS 并使用真实 control owner，然后删除 overwriteSession。",
    "files_add": []
  },
  {
    "id": "TQ-105",
    "problem": "healthy 分支可删可留的动作有歧义，并与 TQ-110 冲突；见 .lead-ref/books/t-items-TQ.md:657、:693。",
    "fix": "统一按 TQ-110 保留缺指针和 healthy 分支，将 healthy seed 改为 adopt，只删篡改段及专用篡改用例。",
    "files_add": []
  },
  {
    "id": "TQ-106",
    "problem": "涉及测试中的 openGraphSessionFixture 不存在；真实入口见 tests/helpers/graph-session-fixture.ts:257。",
    "fix": "将入口名称改为 createGraphSessionFixture，四处删除 export 的动作保留。",
    "files_add": []
  },
  {
    "id": "TQ-111",
    "problem": "keep-note 保留直接改库的不可达 Plan 状态；见 tests/work-graph/A1-independent-review.test.ts:48、src/core/work-graph/tasks/plan-validation.ts:336。",
    "fix": "22-62 子项改为 BLOCKED，不计完成；66-95 的 adopt/revise 竞争转换单独继续。",
    "files_add": []
  },
  {
    "id": "TQ-112",
    "problem": "动作给出不同实现并含 F3 禁止的 B2 手写终态路径；见 .lead-ref/books/t-items-TQ.md:706、规则表:64、:66。",
    "fix": "统一采用修正后的 TQ-104：同一 Session，不带 openResponsibleLink 的 claim、busy、取消未进入 Run、原责任链接和归档步骤；删除其余方案。",
    "files_add": []
  },
  {
    "id": "TQ-114",
    "problem": "所引 S2B 入口手写 entered 和终态 observation；见 tests/helpers/S2B-activity-fixture.ts:471、:501、:508。",
    "fix": "使用真实 Host/Workflow 调度脚本模型，由 Runtime 写执行事实；禁止测试直接写 entered 和终态 observation，具体合规共享入口冻结前标 BLOCKED。",
    "files_add": []
  },
  {
    "id": "TQ-114",
    "problem": "漏掉 runA2，且 runB 原目标是 starting，不能同样执行到终态；见 tests/work-graph/S3-context-inputs.test.ts:484、:486、:489。",
    "fix": "明确 runA、runA2 真实执行结束；runB 只真实 claim 并保持 starting；删除三条 Run 的 raw seed。",
    "files_add": []
  },
  {
    "id": "TQ-114",
    "problem": "IN04 明确保留手写跨工作区 Run；见 tests/work-graph/S3-context-inputs.test.ts:482、:485、:712。",
    "fix": "IN04 标 BLOCKED，删除继续手写的授权，等待 lead 冻结允许的前置状态。",
    "files_add": []
  },
  {
    "id": "TQ-114",
    "problem": "IN14 保留手写 Message，并从 store 读取断言状态；见 tests/work-graph/S3-context-inputs.test.ts:501、:606、:827。",
    "fix": "IN14 标 BLOCKED；放行前冻结真实发送、回复、决策标签关联和公开消息读取步骤，禁止保留手写 Message。",
    "files_add": []
  },
  {
    "id": "TQ-114",
    "problem": "转换仍依赖 raw scope/governance seed；见 tests/work-graph/S3-context-inputs.test.ts:321、:329。",
    "fix": "把公开项目和两个 Workspace 登记、策略安装激活、架构采用纳入转换，替换 raw 初始化并承接真实版本 pin。",
    "files_add": []
  },
  {
    "id": "TQ-114",
    "problem": "材料前置直接写 raw body store；见 tests/work-graph/S3-context-inputs.test.ts:401、:405。",
    "fix": "在真实 owner 存在后经 materials.storeArtifact 写 old-A 和 new-A；缺正文用例不写 old-A，删除前置 rawBodies.put。",
    "files_add": []
  },
  {
    "id": "TQ-114",
    "problem": "Plan 前置直接接受测试构造的 draft；见 tests/work-graph/S3-context-inputs.test.ts:432、:458。",
    "fix": "将 Plan 前置纳入真实 Workflow 与脚本模型转换链；禁止直接接受手写 PlanRevisionDraft，入口冻结前保持 BLOCKED。",
    "files_add": []
  },
  {
    "id": "TQ-115",
    "problem": "recordCheckResult 是 runner 根据实际进程观察调用的写入；见 src/core/agent-runtime/check-execution.ts:115。",
    "fix": "改为 openVerification、真实 runRegisteredCheck 执行登记脚本、finalizeChecks；begin 和结果记录由 runner 完成。",
    "files_add": []
  },
  {
    "id": "TQ-115",
    "problem": "真实流程无法保留 revision:1 和 new-A 报告引用；见 tests/work-graph/S3-context-inputs.test.ts:795、src/core/work-graph/state/verification-machine.ts:978、:1026、src/core/work-graph/evidence/evidence-service.ts:832。",
    "fix": "IN11 暂标 BLOCKED；撤销保留 revision:1/reportRef:newRef 的要求，先由 lead 冻结单检查流程 revision:4 和真实报告语义的精确断言，不得放宽断言或复制输出充当期望。",
    "files_add": []
  },
  {
    "id": "TQ-115",
    "problem": "IN12 keep-note 保留公开状态机拒绝的 PASS 后继链；见 tests/work-graph/S3-context-inputs.test.ts:497、src/core/work-graph/state/verification-machine.ts:1440。",
    "fix": "IN12 改为 BLOCKED，删除 DSH 自行选择退役或改链的文字，等待 lead 冻结处置。",
    "files_add": []
  }
]
```

**7．检查完整度**

- **完整核对：TQ-001～TQ-115，全部 115 项。**
- **只略看：无。**
- 需要修改的 18 项：**001、070、075、076、077、078、087、088、091、099、103、104、105、106、111、112、114、115**。
- 其余 97 项在本次施工书核对范围内未发现需要修改的问题：**002～069、071～074、079～086、089～090、092～098、100～102、107～110、113**。这些结论是静态核对结果，不是测试通过或施工验收结论。