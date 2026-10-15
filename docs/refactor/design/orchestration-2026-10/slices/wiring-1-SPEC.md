# 接线包 1 冻结规格：I-1、I-3、目标内容核对、普通接续的交接

**后注（决定 49、56、60）：** 后来的决定改写了本规格的这几处：
- §0.2 L3（约 21 行）：L3 让 I-4 把自治级别加进 Goal 内容摘要并把 `contentVersion` 升到 2；接线包 2 规格 §0.3 已撤回这条预告（决定 49、56）——I-4 不改 Goal 内容摘要 G，L3 的 `contentVersion` 预告不执行。
- L16（约 38 行）：「模块维护的线不自动归档」只属于执行者/模块维护关系；决定 60-3、60-7、60-8 的参谋/书记位置、闲满一天归档和责任迁移由第 7 片 7D 扩展（8B 的模块维护者与区域参谋分开），本条不赋予区域参谋永不归档资格。
- 正文原样保留，只加此注。

> **状态：** lead 冻结，2026-10-09。代码基线 216e0e2b（第 0、1、3 片已合入：21a99915、327ec020、ccecc016、e48218a5；全量 250 个测试文件、5626 项通过）。依据：HANDOFF 决定 38、42、43、45、46、47；[分片总说明](README.md)“合入以后的接线”；[第 1 片规格](slice-1-SPEC.md) §1.1、§2.2–§2.4、§3.2、§4.1（第 801 行）、§4.2；[第 3 片规格](slice-3-SPEC.md) §2.2、§2.4、§2.5、§3.2、§3.6、§4.2、§4.3。本规格由 lead 写，每一行都对着 216e0e2b 的代码（`file:symbol`）核过，冻结前经 Codex（xhigh，只读）按决定 46 画状态表逐行核对，lead 核实后改（§0.6）。§0 与正文不一致时以 §0 为准。

本包有四件事，合称“接线包 W”（决定 47 第 2、3、4 条）：
- **I-1**：第 1 片的 `SessionDutyResolver` 按第 3 片的职责规则（`effectivePlatformDuty`）判断；读不到时仍是 `'unknown'`。
- **I-3**：第 3 片装配器的 `extensions.anomalies` 接第 1 片的 `listSessionAnomalies`（这个目标里还没被接手的锚点），提醒段行键 `anomaly:<refkey>`。
- **G（目标内容核对）**：替换 e48218a5 去掉的 Goal 版本钉：只比较任务上下文里实际展示的、来自 Goal 记录的内容；准备之后变了，入口拒绝并给出专门的原因，Workflow 重新准备上下文；不相关的计划采用仍不拦（C6 / U-11 和它的测试不变）。
- **E15（普通接续的交接）**：第 1 片 §4.1 后半：普通接续建新 Session 时，把这个任务的负责关系交给新 Session，并在前一条线没有别的事时归档它。

## 0. 冻结说明（lead）

### 0.1 OPEN：要用户定

无。四件事的用户行为都已定：I-1、I-3 是 README 的接线项；G 是决定 47 第 2 条；E15 是第 1 片 §1.1 第 2 项（“接续后转走本任务责任，归档旧 Session；部分交出保留旧 Session”）、§4.1 第 801 行和决定 47 第 3 条。§0.2 里 lead 定的都是技术做法或故障时的处理，不改已定的用户行为；其中 L13、L16 有用户能察觉的边角（技术故障时旧线多显示一会儿“负责中”、部分交出的旧线按已有规则晚一些归档）：L16 是第 1 片“部分交出保留旧 Session”的直接结果；L13 是 lead 补的故障处理，HANDOFF 决定里没有，标“用户可改”，交付时向用户说明。两处都不挡施工。

### 0.2 lead 定的技术选择（一行一项，理由在括号里）

- **L1 G 今天还触发不了（如实记下）。** 当前代码里 Goal 的目标文字只在创建时写一次：`state/goal-machine.ts:GoalEvent` 只有 `goal_created`、`plan_adopted`、暂停/恢复/取消、`goal_completed`，没有改目标文字的事件；`contracts/goal-change.ts:AmendGoalRequestV1.objectiveDelta` 没有生产写入方（DESIGN §2.3：按答复改目标在第 6 片）。装配器目标段里来自 Goal 记录的内容（`agent-runtime/context-assembler.ts:goalPayload` 的 goal、objective、workspace 名）今天都不会变。所以本包的核对要等第 5 片的接线 I-4（自治级别存在 Goal 记录上：slice-5-SPEC §2.1 `GoalSnapshot.settings`）或第 6 片改目标落地后，才会在生产里真的拦下一次进入。决定 47 第 2 条要求现在和接线一起做，lead 照做：成本小，以后那两处落地时不用回头补。测试用纯函数（CG 行）和手工构造的、未绑定的已准备 manifest（GE02、GE06，沿 `tests/work-graph/S3-prepared-context-admission.test.ts:makeBinding` 的先例），**不改数据库记录来触发**（AGENTS.md 第 4 条）。
- **L2 G 比的是“目标段里来自 Goal 记录的内容”的摘要，存在绑定的 Goal 来源上。** 新纯函数 `goalContextContentV1 / goalContextDigestV1` 放 `src/contracts/graph-context.ts`；Work 的装配器把绑定里这个任务所属 Goal 的 `record` 来源的 `digest`（今天恒为 `null`，`views/graph-context-reader.ts:973/995`）填成这份摘要；入口用当前 Goal 重算后，经新的纯函数 `state/context-input.ts:contextGoalContentProblem` 比较。不比较目标段全文（全文里还有工作区版本、自治级别、注记，入口算不出来），也不重新钉 Goal 的版本（那正是 e48218a5 去掉的，会挡住不相关的采用）；入口按**当前**版本守卫 Goal 的那条照旧（`execution-entry-service.ts` 第 1504 行），两者不同。`digest` 为 `null`、或没有这条来源、或没有绑定的旧 manifest，照旧通过（兼容已准备好的旧 manifest）。只改 Work 的装配和入口；Query 的绑定和 `bindPreparedQuery` 不变（Query 不在决定 47 的范围，且是短的只读调用）。G 只改绑定和 manifest 的字节，不改喂给模型的输入文字。
- **L3 摘要内容的版本规则。** `GoalContextContentV1` 带 `contentVersion: 1`，字段 `goalId / objective / workspaceId`。以后目标段每多显示一项来自 Goal 记录的内容（I-4 的自治级别就是第一项），必须同时把它加进这个函数并把 `contentVersion` 升到 2；入口按绑定里存的摘要比较，不需要认识旧版本号（摘要不同就是“变了”，重新准备一次即可）。这一条写进 I-4 的任务书。
- **L4 G 的拒绝走重新准备，不走等待。** 入口拒绝 `revision_conflict`，原因以 `context_goal_changed:` 开头；Workflow 的 `start` 步看到这个确切的码和前缀，下一步就是对同一个 Run 的 `prepare`（`advance`，不是 `waiting`）。`prepareExecution` 对未绑定的 Run 每次重新装配（`agent-runtime/execution-preparation.ts:prepareExecution`，`run.inputBinding === undefined` 时不走 `rehydratePreparedExecution`），不按 requestId 重放，所以同一个确定性的 `prepare` 请求号拿到的是新 manifest，第二次 `start` 的请求号也随之不同。别的 `start` 拒绝照旧 `waiting`。已绑定、被撤销后重新授权（CTX-02，`rebinding`）不做这项核对：输入已经绑定，不重装（slice-3-SPEC §3.2 CTX-02；换绑定本来就被 `state/run-machine.ts:preparedFixedBindingGuard` 拒）。
- **L5 I-1 只看 Session 自己固定的角色事实。** 新文件 `src/composition/session-duty.ts:createSessionDutyResolver`。`role_spec` 的 Session 读它钉住的 RoleSpec 正文的 `platformDuty`（`RoleConfigurationPort.readRoleSpec`，按 pin 读，不随激活指针变）；`legacy_template` 的 Session 看它是不是五个 `platform-<duty>@s3.1` 模板之一（`agent-runtime/role-profiles.ts:platformRoleProfile(duty).template`）；有一方给了职责，就交给 `state/context-input.ts:effectivePlatformDuty({ roleDuty, hostDuty: templateDuty })` 定，拒绝（冲突）读作 `'unknown'`。两方都没给时，**不用** `effectivePlatformDuty` 的缺省 `executor`，而沿用第 1 片现在的规则（`composition/create-platform.ts:defaultSessionDutyResolver`）：角色的完整规范 ref 等于 Host 某个普通 Work 绑定的 `sessionRole` 才算 `executor`，否则 `'unknown'`。理由：职责在这里只决定“执行者满一天自动归档”，证据不足时宁可不归档（第 1 片 §2.8、L4）；第 3 片缺省 `executor` 是给提示词用的。Host 授权里的 `grant.platformDuty` 不读：它是可改的 Host 配置，而 Session 的职责在创建时就由角色定了（`contracts/platform-duty.ts` 注释、slice-3-SPEC §2.5）；Host 配置校验已保证 legacy 模板上的授权职责和模板一致（`app/runtime-configuration.ts` 第 245–256 行）。读 RoleSpec 失败、没有 ctx、抛异常，都读作 `'unknown'`。
- **L6 I-1 的签名只加一个可选参数。** `SessionDutyResolver` 改为 `(role: RoleConfigurationRef, ctx?: CoreCallContext) => Promise<ReadResult<PlatformDutyV1 | 'unknown'>>`。现有测试替身 `async (role) => …`（`tests/business/S1-session-maintenance.test.ts:217/473`、`tests/business/S1-archive-flow.test.ts:229`、`tests/helpers/S1-workflow-archive-fixture.ts:1250`）照样能赋值，不用改。`session-maintenance.ts:dutyOf` 把本次维护已核过的 ctx 传进去。`options.sessionDutyResolver` 仍然优先（Host 显式给的可信函数）。
- **L7 I-3 的提供方放 `views`，由它自己换成同范围的 Host 上下文；它不是一道授权关口。** 新文件 `src/core/work-graph/views/context-extensions.ts:createContextExtensionsReader`，作为 `createGraphContextReader` 已有的可选依赖 `extensions` 装进生产 composition（`create-platform.ts` 第 641 行起）。图读取器的三处调用（`graph-context-reader.ts:readIndexes` 在 `readContextFacts`、`lookGraph`、`findGraph` 里，第 1332、1474、1542 行）传进来的是调用方原来的 ctx，可能是 `work_run` 或 `query_run`；`listSessionAnomalies` 只认 Host（`tasks/session-anomaly-service.ts:trustedContext`）。所以提供方按同一个 projectId、workspaceId、signal 构造内部 Host 上下文（actor 用注入的 `hostActor`，即 composition 的 `SYSTEM_ACTOR`），和读取器自己的 `internalHostContext` 同一个做法。三处调用都在读取器的 `resolveReadContexts` / `loadUniverse` 已核过调用方能读这个目标之后；锚点 owner 还会再核 Goal 的项目和工作区。所以提供方**只能**装进图读取器，不导出给模型、HTTP 或别的模块（规则 §7.9）。读取器本身不改。
- **L8 I-3 读不到就整次读取失败，不吞成空。** 沿用第 3 片 `readIndexes` 的冻结规则（“A throw or a rejection is returned as the real refusal, never made available”）：锚点列表读失败，提供方把原拒绝原样返回，上下文读取随之失败；不新造 `'unavailable'` 加空行的路。分页：每页 100 条，最多读 25 页（2,500 条）。这和锚点 owner 自己的扫描上限相同（`session-anomaly-service.ts` 的 `LOOKUP_PAGE_LIMIT = 100`、`LOOKUP_MAX_PAGES = 25`：一个目标的锚点超过 2,500 条时 owner 自己就回 `incomplete`），所以提供方不在 owner 之外另加失败边界；第 25 页之后 `nextCursor` 仍非空时返回 `incomplete`，原因以 `anomaly_index_page_limit:` 开头。已被接手的旧锚点也算在这 2,500 条里（owner 不能只列未接手的）；这是第 1 片 owner 的既有上限，不是本包新定的。
- **L9 I-3 的行写法（给模型看的索引行，不是界面文字）。** owner 列出的每项是 `SessionAnomalyViewV1 = { anchor, pickedUpBy }`；只留 `pickedUpBy === null` 的，每项一行：`key = 'anomaly:' + sessionAnomalyRefKey(item.anchor.ref)`（`tasks/session-anomaly-codecs.ts:sessionAnomalyRefKey`）；`node = { kind: 'task', ref: anchor.task, planRef: anchor.planRef }`；`text` 见 §4.2；`sources = [{ kind: 'record', ref: anchor.ref, revision: 1, digest: null }]`（`SessionAnomalyAnchorRef` 已在 `contracts/ledger.ts:AggregateRef` 里）。只按目标列，不按焦点任务过滤：同一锚点可能也出现在这个任务的接续说明里，slice-3-SPEC §4.3 末段允许提醒引用同一锚点，但不能写第二份不同正文，所以行文只是索引。其它四个扩展（notes、footprint、goalSettings、decisions）照旧 `not_implemented`。装配器不用改：`context-assembler.ts:optionalRowsFromExtensions` 已把 anomalies 行放进提醒段、保留 `anomaly:` 前缀，`not_implemented` 时才加“异常锚点投影尚未接入”。
- **L10 E15 的交接在建新 Session 之后、领取之前做，用两个新的 Workflow 步。** `WorkflowCalls` 加 `transfer_responsibility`（就是 `sessions/session-responsibility-service.ts:SessionResponsibilityPort.transferSessionResponsibility`）和 `archive_predecessor`（就是 `business/workflow/session-archive.ts:InternalSessionArchivePort.archiveLineInternal`）。理由：转交负责关系会让新 Session 的版本加 1（`state/session-responsibility.ts` 的 `responsibility_transferred` 两个 Session 各加 1），必须在领取的版本钉算出来之前做，否则领取会 `revision_conflict`；放在维护里做会和刚建好的领取步撞版本。两个新步都用 `automationContext(owned)`（平台自动化身份，和 `requeue_task` 相同，`workflow.ts:automationContext`），请求号用 `automaticGraphWrite`（`wf-auto:` 前缀，确定性）。
- **L11 能当场归档的前一条线，转交和归档在同一步里做。** 前一条线 P“可当场交接归档”（§4.4.3：活着、没有归档请求、没有占用、不在等回复、手上开放的负责关系**只有**这个任务 T 一条）时，下一步是 `archive_predecessor`，任务选择是 `[{ T → 转交给 C }]`：第 1 片的归档组合在同一次调用里先转交（`session-archive.ts:drive` 第 6 步，`disposeArchiveResponsibility`）、再最终归档。否则下一步是单独的 `transfer_responsibility`，P 保留（部分交出，第 1 片 §1.1 第 2 项）。理由：Workflow 在每个提交了新东西的步之后跑一页维护（`workflow.ts:advanceWork`），钉在 P 上的请求如果分两步，中间的维护可能动 P（关掉已终结的关系、按执行者规则归档），后一步的钉就过期了；合成一步、且只在 P 手上只有 T 时这样做，建 Session 之后那一页维护不会碰 P（T 还开着、未终结：不关闭、不算执行者闲置）。
- **L12 退役的前一条线由维护归档。** P `health === 'unavailable'`（退役：Kernel 回合没收尾、缺失、损坏；和 `session-archive.ts` 第 805 行、`session-maintenance.ts` 第 481 行的判断相同）时，Workflow 只发 `transfer_responsibility`；维护的退役分支改为：有接续、没有占用、没有开放的 task/work 负责关系时，以 `handoff_complete` 归档（今天这一支 `continue`，退役线会一直挂着，`session-maintenance.ts` 第 505 行）。转交步提交了新东西，紧接着那一页维护就会处理 P（测试里工作区的 Session 数少于一页 100 个；Session 多时可能晚几次推进，有界维护本来如此，第 1 片 §4.2）。
- **L13 交接被拒时怎么办（lead 定，用户可改；HANDOFF 决定里没有这一条，是 lead 补的故障处理）。** 两个交接步的回执：转交 `committed`、归档组合 `ready/archived` → 下一步领取；归档组合 `ready` 但 `pending` / `partial`：现读 P，P 对 T 的关系已关（转交做完了，只是最终归档没成）→ 领取，P 仍对 T 开放（转交没做完）→ 回到 `select_work`（归档请求已登记，同一次推进的维护页会续做它，转交会让 C 的版本 +1，所以不能先拿旧版本去领取）；`revision_conflict` → 下一步回到 `select_work`，由当时的事实重算（冲突说明别处先写了一次，所以不会空转；和 `requeue_task` 的映射相同，`workflow.ts` 第 1436 行）；别的拒绝：归档步被拒而 P 仍对 T 开放 → 下一步 `transfer_responsibility`，否则领取；转交步被拒 → 领取。领取不因交接失败而等待。代价：转交以非冲突的原因失败（例如存储读不到、旧写者没停）时，P 和 C 会同时显示对 T 负责，直到 T 下一次被领取时重算（W1-HO-04），或 T 做完后维护关掉 P 那条已终结的关系。这是技术故障下的如实显示，不是新的产品行为。
- **L14 E15 不写异常锚点、不重新入队、不动消息。** 归档模式 `handoff_complete`，执行是 `none`（P 没有占用）、等待处置为 `null`；`session-archive.ts:drive` 只在 `execution.kind === 'work'` 时写锚点、在有锚点或等待处置时重新入队，所以都不会发生。锚点只给归档、退役造成的中断（决定 38、42、43；第 1 片 S1-ANCHOR-01/02）。决定 45（U1 选甲）不变：退役线手上执行结果未知时，维护照旧跳过、记 `busy` / `archive_unknown_confirmation_required:`、对它零提交（IT34），本包新分支排在它后面。
- **L15 哪些路径今天真的会建普通接续（写给夹具和场景）。** 平台证明的干净中断（Host 接管、`interrupted_clean`、没有人的暂停意图）留下的 `kernel_turn_open` 线，第 1 片的维护在下一次推进选活之前就以 `retired` 归档了（写锚点、放下负责关系，`session-maintenance.ts` 第 504–526 行、IT10）；这时 P 没有占用，归档请求的执行是 `none`，归档组合不重新入队（`session-archive.ts` 第 575–580 行），T 之后由已有的重启再推进 / 普通推进重新入队，领取时 P 已归档，来历为空，**不走 E15**。这是决定 42、43 的既定行为，本包不改。会建普通接续、走 E15 的是维护不先归档的那些：带人暂停围栏的中断（人点“继续”后的 C3 重新入队，A8-host-restart-paused 的路径）、人认定已停的结果未知执行（`platformCleanInterruption` 为假）、角色不符（Host 配置里这个 assignment 的 `sessionRole` 变了）、被等待排除的前任。HO、SC 用例的给定照这一条挑。
- **L16 活着的 P 部分交出以后，按已有规则归档。** P 手上还有别的负责关系（未完、已终结未关、或模块）、被占用、在等回复时，只转交 T，P 保留；之后它按已有规则走：执行者满一天（以它别的任务的终结时间算；转走的这条不算“做完”，`session-maintenance.ts:finishedAtProof` 跳过非 terminal 的关闭）、或退役规则。所以一条做完别的事、没有新任务的执行者线，最晚一天后归档；“模块维护的线不自动归档”不变（DESIGN §4.5）。这是第 1 片 §1.1 第 2 项“部分交出保留旧 Session”的直接结果。
- **L17 交接的崩溃恢复。** 恢复靠持久事实重算，不靠内存：`claimRequeued` 选中一个可复用的 Session C，且 C 的来历是“接续自 P、任务 T”，而 P 没有归档请求、仍对 T 开放负责时，先发和建 Session 之后同样判断出的交接步（§4.4.3），再领取。所以建好 C 之后、交接之前崩溃，下一次推进照样交接并（能归档时）归档。归档请求已登记、归档中途失败的，由维护按已有规则续做（`session-maintenance.ts` 第 473–478 行，`continueArchiveLine`），它自己会做转交；这时恢复不再另发转交（P 有归档请求）。

### 0.3 和别的工作的接缝

- **第 5 片收尾（轨道 A）同时在做**，同改的文件：`business/workflow/workflow.ts`、`contracts.ts`、`ports.ts`、`composition/create-platform.ts`、`agent-runtime/context-assembler.ts`、`tasks/execution-entry-service.ts`、`state/context-input.ts`（第 5 片副本里多数改过）。本包在 216e0e2b 上施工，先合入；第 5 片合入时 lead 三方合并，两边新增都保留。本包新加的符号（两个 Workflow 步、`WorkflowHandoverContinuation`、`goalContext*`、`contextGoalContentProblem`、`createSessionDutyResolver`、`createContextExtensionsReader`）第 5 片没有。
- **I-4（以后）**：要按 L3 扩 `goalContextContentV1`；`createContextExtensionsReader` 的 `goalSettings` 那一格由 I-4 接，届时同一个提供方再加一个依赖。**I-6** 的 `decisions` 同理。**I-2、I-5** 不碰本包的文件。

### 0.4 lead 抽查的代码出处（216e0e2b）

`business/workflow/workflow.ts`：`selectWorkStep`（308）、`continuationProvenanceFor`（718）、`claimRequeued`（992–1060，`chosen.kind === 'create'` 才写来历）、`responsibleSessionFor`（681）、`chooseExcluded`（660）、`roleReusable`（412）、`performStep` 的 `create_session`（1304）、`start`（1353）、`requeue_task`（约 1429–1440）分支、`automationContext`（473）、`automaticGraphWrite`（112）、`prepareStep`（117）、`advanceWork` 的维护页（1465–1500）。`business/workflow/session-archive.ts`：`archiveLine`（723）、`firstAcceptanceResponsibilityProblem`（294）、`drive` 的锚点条件（约 458–472）和重新入队条件（575–580）、`ARCHIVE_MODES` 已含 `handoff_complete`（96）。`business/workflow/session-maintenance.ts`：已登记请求的续做（473–478）、退役分支（481–526）、`dutyOf`（391）、`finishedAtProof`（173）、`openResponsibleLinks`（110）。`sessions/session-responsibility-service.ts`：`transferSessionResponsibility`（359，四个版本钉，`0` 表示不存在的关系）、`destinationEligible`（197）。`tasks/session-facts.ts`：`continuations` 只收 `provenance.kind === 'continuation'` 且 `from` 是本 Session 的后继（278–300）。`tasks/session-anomaly-service.ts`：`listSessionAnomalies`（614）、`LOOKUP_PAGE_LIMIT/LOOKUP_MAX_PAGES`（80–81）。`tasks/execution-entry-service.ts`：`contextConsumptionProblem`（1100）、`contextConsumptionGuards`（1175，e48218a5 去掉 Goal 钉的地方）、`authorizeAdmission`（1206）、`authorizeRuntimeEntry` 读当前 Goal（`readGoalScope`，1451）并按当前版本守卫（1504）。`agent-runtime/context-assembler.ts`：`goalPayload`（415）、`optionalRowsFromExtensions`（533）、`assembleTask` 的绑定构造（922）、`assembleQuery` 的绑定构造（998）、`sortedSources`（148）。`agent-runtime/execution-driver.ts:553–560`（`start` 把入口拒绝原样返回，`mapWrite`）。`views/graph-context-reader.ts`：`GraphContextReaderDependencies.extensions`（75）、`readIndexes`（390）、Goal 来源 `digest: null`（973、995）。`composition/create-platform.ts`：`defaultSessionDutyResolver`（204）、`sessionDuty` 注入（992）、图读取器构造（641）、`sessionAnomalies` 构造（509）。`state/context-input.ts:effectivePlatformDuty`（459）。`state/run-machine.ts:preparedFixedBindingGuard`（1337）。

### 0.5 精确数量（冻结）

- 新状态行 9 行：W1-CTX-01、W1-WF-01、W1-HO-01…04、W1-AUTO-01、W1-DUTY-01、W1-ANOM-01（§3）。新正式记录 0、新事件类型 0、新索引 0、新路由 0、新工具 0；新 Workflow 步 2 个；已有字段的新取值 1 处（Work 绑定里 Goal 来源的 `digest` 由 `null` 变为摘要）。
- 文件 19 个：源码 11 个（新建 2、修改 9），新测试文件 8 个（§6）。另外两类允许的改动不计入 19：Codex 写夹具时可加最多 3 个测试辅助文件（名字以 `tests/helpers/WP1-` 开头，lead 核对后计入）；`src/business/workflow/index.ts` 只在需要导出新类型时改。上限 23 个。
- 用例 55 个：GC 4、CG 5、AN 9、GE 7、WF 2、DU 9、HO 13、HM 4、SC 2。GE（7 个）和 AN07 在 memory 和 SQLite 各跑一次，共 63 次。一行一个 `it`（DU04 这类多子情形写在同一个 `it` 里）。
- 估计行数（不是验收数字）：生产代码约 500–750 行，测试约 1,300–1,900 行。

### 0.6 冻结前的 Codex 核对（2026-10-09）

Codex（xhigh，只读，216e0e2b 的一次性副本 + 本规格初稿，16 分钟）按决定 46 画了 E15 的四视角状态表（两个 Session、两条负责关系、归档请求、Workflow 步和维护页）和 G 的状态表，逐行核对用例，报了 10 条。lead 逐条对代码核实：
- **改了的（7 条）**：F1（初稿让活着的 P 先转交、下一步再归档，中间的维护页可能动 P 使归档步的钉过期，“一条线一条归档路”不成立）→ 改成 L11：只在 P 手上只有 T 时用一步“带转交的归档”，别的情况只转交、按已有规则以后归档（L16）。F3（建 Session 的回执重放时下一步不一定相同）→ §3 改为“由当时的事实重算”。F4（L15 把重新入队说成归档组合做的）→ 改正。F5（GE05 要的“已撤销 + 固定绑定里摘要过期”用今天的 owner 造不出来）→ 摘要比较抽成纯函数 `contextGoalContentProblem`，`rebinding` 跳过在 CG03 里测；GE05 改为真实撤销后用原绑定重新授权。F6（DU09、HO02、HO03、HO09、HM02、HM04 的给定漏条件）→ 补齐。F7（几处行号、“§11 不变量”没写清）→ 改正。F9（初稿说崩溃在转交后、归档前，活着的 P 不再补归档）→ L17：恢复重算同一个交接步，包括归档。
- **改了说法的（2 条）**：F2（维护页不只在“提交了新东西”时跑，被拒的步之后也跑）→ 期望里的“零写”都改成“这一步的 owner 零写”。F8（转交失败时 P、C 同时负责）→ L13：冲突回到 `select_work` 重算，非冲突的故障如实显示，写明代价。
- **核实后部分采纳（1 条）**：F10（锚点历史太多会让上下文读取失败）→ 提供方的页数上限改为和 owner 自己的扫描上限相同（25 页，L8），不另加失败边界；owner 本身的 2,500 条上限是第 1 片的既有限制，本包不改。
- **改版后再核一次**（Codex，推理强度 high，只读，4 分钟，只看改过的部分）：合成的一步归档（L11）、恢复（L17）、HO08、HO13 的给定都对得上代码，数量对。又报了两条，都改了：R1（归档组合中途失败、转交还没做完时，同一次推进的维护页续做会让 C 的版本 +1，先领取会撞版本）→ L13 和 W1-HO-03：这种情况回到 `select_work`；R2（L13 是 lead 补的故障处理，HANDOFF 里没有）→ L13 写明。HO13 的期望按 R6 分清回执快照和库里的 P。
- 原报告、提示和用时在 lead 临时目录 `impl/w1/`。（2026-10-09 补注：那里的文件 17:31 丢了；第一次核对的原报告留在[接线包 1 的证据](../../../reviews/evidence/orchestration-wiring-1-2026-10-09/README.md) `spec-check/`，用时记在同一页。）

---

## 1. 范围

### 1.1 本包交付

1. 执行者自动归档按 Session 真实的职责判断（I-1）。
2. 每次 Work 上下文的提醒段列出这个目标里还没被接手的异常锚点（I-3）；“异常锚点投影尚未接入”这句在生产里不再出现。
3. 准备好上下文以后，若目标段里来自 Goal 记录的内容变了，进入被拒、重新准备；不相关的计划采用照旧不拦（G；今天生产里还触发不了，L1）。
4. 普通接续建新 Session 时，这个任务的负责关系交给新 Session；前一条线手上只有这个任务时一并归档（活着的在同一步，退役的在紧接着的维护里）；还有别的事时保留，之后按已有规则归档（E15）。

用户能看到的结果：接续以后旧线不再一直挂“负责中”；只做这一件事的旧线随即归档，左栏计数随之正确（决定 30：归档后算“已归档”）；退役线一直挂着的问题解决。新界面的词和按钮仍在 E3。

### 1.2 不在本包

- I-2、I-4、I-5、I-6（等第 5 片合入）。
- Query 绑定的目标内容核对、Query 的提醒段（Query 的 copy 模式没有提醒段，slice-3-SPEC §4.3 表）。
- 改目标文字的写入路径（第 6 片）。
- 交接（handoff，`provenance.kind === 'handoff'`，第 7 片）。
- 让锚点 owner 只列未接手的锚点、或放宽它的 2,500 条上限（第 1 片的 owner，L8）。
- 界面、路由、文档同步（lead 验收后做）。

## 2. 数据与接口

### 2.1 目标内容（`src/contracts/graph-context.ts`，修改）

```ts
import type { GoalSnapshot } from './ledger.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';

/** The Goal-record content the Work context's Goal section shows (decision 47 (2)). */
export type GoalContextContentV1 = {
  contentVersion: 1;
  goalId: string;
  objective: string;
  workspaceId: string;
};
export function goalContextContentV1(
  goal: Pick<GoalSnapshot, 'ref' | 'objective' | 'workspaceRef'>,
): GoalContextContentV1;
// = { contentVersion: 1, goalId: goal.ref.goalId, objective: goal.objective,
//     workspaceId: goal.workspaceRef.workspaceId }
export function goalContextDigestV1(
  goal: Pick<GoalSnapshot, 'ref' | 'objective' | 'workspaceRef'>,
): string;
// = sha256Hex(canonicalJson(goalContextContentV1(goal) as unknown as JsonValue))
```

纯函数：不读时钟、不读存储。`objective` 原样（不规范化、不截断）。`contracts/fingerprint.ts` 是 Contracts 内部依赖，`graph-context.ts` 仍不 import WorkGraph 或 AgentRuntime（slice-3-SPEC §2.2）。

### 2.2 入口比较（`src/core/work-graph/state/context-input.ts`，修改）

```ts
export function contextGoalContentProblem(input: {
  binding: ContextAssemblyBindingV1 | undefined;
  claimGoal: { projectId: string; goalId: string };
  currentGoalDigest: string;
  rebinding: boolean;
}): CoreRejection | null;
```

纯函数（state 只 import contracts）。顺序：`binding === undefined` → `null`；`rebinding` → `null`；取 `binding.sources` 里所有 `kind === 'record'`、`ref.aggregateType === 'Goal'`、`ref.projectId === claimGoal.projectId`、`ref.goalId === claimGoal.goalId` 的来源；其中有一条 `digest` 是字符串且 `!== currentGoalDigest` → `{ status: 'rejected', code: 'revision_conflict', reason: 'context_goal_changed: the Goal content shown by the prepared context changed after preparation; prepare the context again' }`；否则 `null`（没有这种来源、`digest` 为 `null` 都是 `null`）。

`execution-entry-service.ts`：`contextConsumptionProblem` 的输入加 `goal: GoalSnapshot`（当前 Goal，`authorizeRuntimeEntry` 已读到的 `goalScope.goal`）；`authorizeAdmission` 加同名参数并转交；在 Workspace 版本循环之后、输入声明核对之前调用 `contextGoalContentProblem({ binding, claimGoal: { projectId: claim.task.projectId, goalId: claim.task.goalId }, currentGoalDigest: goalContextDigestV1(goal), rebinding })`，非空就返回它。`contextConsumptionGuards` 继续跳过 Goal（e48218a5 的规则和注释保留，注释末尾补一句 “the shown Goal content is compared instead (wiring 1 W1-CTX-01)”）。

### 2.3 Workflow 的两个新步（`src/business/workflow/contracts.ts`，修改）

```ts
import type { SessionResponsibilityPort } from '../../core/work-graph/sessions/session-responsibility-service.js';
import type { InternalSessionArchivePort } from './session-archive.js';

export type WorkflowCalls = {
  // … 现有 12 个不变 …
  /** E15 (wiring 1 §4.4): hand the continued Task's responsibility to the new Session. */
  transfer_responsibility: SessionResponsibilityPort['transferSessionResponsibility'];
  /** E15: transfer the Task and archive a live predecessor line in one composition (mode 'handoff_complete'). */
  archive_predecessor: InternalSessionArchivePort['archiveLineInternal'];
};

/** What a handover step carries so the claim of the continuation can follow it. */
export type WorkflowHandoverContinuation = {
  taskRef: TaskTriple;
  planRef: PlanRevisionRef;
  successor: SessionRef;
  requeue?: WorkflowSessionRequeue;
};

export type WorkflowOperation = {
  [K in WorkflowStepKind]: { kind: K; request: Parameters<WorkflowCalls[K]>[1] }
    & (K extends 'create_session'
      ? { taskRef: TaskTriple; planRef: PlanRevisionRef; requeue?: WorkflowSessionRequeue }
      : K extends 'transfer_responsibility' | 'archive_predecessor'
        ? WorkflowHandoverContinuation : {})
}[WorkflowStepKind];
```

`WorkflowStepReceipt` 由映射类型自动多两种。`archive_predecessor` 不是 WorkGraph owner，而是 Workflow 自己的归档组合入口（同一个 `createSessionArchiveService` 实例的 `archiveLineInternal`），这是 `WorkflowCalls` 注释“exact owner method”的一处有意例外，在注释里写明。

### 2.4 职责解析（`src/business/workflow/ports.ts` 修改；`src/composition/session-duty.ts` 新建）

```ts
// ports.ts
export type SessionDutyResolver =
  (role: RoleConfigurationRef, ctx?: CoreCallContext) => Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;

// composition/session-duty.ts
export type SessionDutyResolverDependencies = {
  readRoleSpec: RoleConfigurationPort['readRoleSpec'];
  configuration: WorkflowHostConfiguration | undefined;
};
export function createSessionDutyResolver(deps: SessionDutyResolverDependencies): SessionDutyResolver;
```

`create-platform.ts`：`sessionDuty: options.sessionDutyResolver ?? createSessionDutyResolver({ readRoleSpec: roleService.readRoleSpec.bind(roleService), configuration: workflowConfiguration })`；删去 `defaultSessionDutyResolver`（它的规则搬进新文件的缺省分支，L5）。

### 2.5 上下文扩展提供方（`src/core/work-graph/views/context-extensions.ts`，新建）

```ts
export type ContextExtensionsDependencies = {
  anomalies: Pick<SessionAnomalyPort, 'listSessionAnomalies'>;
  hostActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};
export function createContextExtensionsReader(deps: ContextExtensionsDependencies):
  (ctx: CoreCallContext, request: ContextReadRequestV1) => Promise<ReadResult<ContextExtensionsV1>>;
```

`create-platform.ts` 构造图读取器时加 `extensions: createContextExtensionsReader({ anomalies: sessionAnomalies, hostActor: SYSTEM_ACTOR })`（`sessionAnomalies` 在第 509 行已构造，早于第 641 行的读取器）。

## 3. 状态行

本包不加新状态、不改任何状态机的构造函数；下面是对已有转换的守卫补充和 Workflow / 维护的新分支。ID 用 `W1-*`。“零写”指这一步的 owner 零写；同一次推进里 Workflow 照旧可能跑一页维护（`advanceWork`：只有回执顶层 `replayed: true` 时不跑）。

| # | 位置 | from | 事件 / 动作 | 守卫 | to / 下一步 | effects | 幂等 | 依据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W1-CTX-01（CTX-01 补充） | `tasks/execution-entry-service.ts:contextConsumptionProblem` → `state/context-input.ts:contextGoalContentProblem` | Run `Starting.Unbound` | `entry_authorized` | 原顺序不动；在 Workspace 版本核对之后、输入声明核对之前：§2.2 | 拒：`revision_conflict` / `context_goal_changed:`；通过：原 `Starting.Authorized` | 拒时入口零写 | 原回执先于新守卫（`lookupCommit` 命中照旧重放） | 决定 47(2)；L2、L4 |
| W1-WF-01 | `workflow.ts:performStep` `start` | — | `start` 回执 `rejected` | `code === 'revision_conflict'` 且 `reason` 以 `context_goal_changed:` 开头 | `advance`，`next` = 同一 Run 的 `prepare`（`prepareStep(base, operation.request.prepared.claim.runRef)`） | 映射本身不写 | — | L4 |
| W1-HO-01 | `performStep` `create_session` | 新 Session C 已建 | `create_session` 回执 `completed` | 请求的 `provenance.kind === 'continuation'`（前任 P、任务 T）；`deps.responsibilities` 已装；P 的卡片可读、P 没有归档请求、P 对 `{kind:'task', ref:T}` 有开放 `responsible` 关系 | `advance`：P 可当场交接归档（§4.4.3）→ `archive_predecessor`（带 T→C 的转交选择）；否则 → `transfer_responsibility`；守卫不满足 → 原来的 `claim_task` | 判断本身不写 | 原回执重放时下一步按当时的事实重算 | 第 1 片 §4.1；决定 47(3)；L10、L11 |
| W1-HO-02 | `performStep` `transfer_responsibility` | P 对 T 开放，C 对 T 开放 | 转交回执 | — | `committed` → `claim_task`（C 的版本现读）；`revision_conflict` → `select_work`；别的拒绝 → `claim_task` | P 对 T 的关系 `until=cursor`；C 的关系不变；P、C 各版本 +1（owner 写） | owner 自己的回执（`wf-auto:` 请求号） | L10、L13 |
| W1-HO-03 | `performStep` `archive_predecessor` | P 活着、空闲、手上只有 T | 归档组合结果 | — | `ready/archived` → `claim_task`（C 的版本现读）；`ready/pending` 或 `ready/partial`：现读 P，P 对 T 已关 → `claim_task`，仍开放 → `select_work`；`rejected` 且 `revision_conflict` → `select_work`；别的拒绝：P 仍对 T 开放 → `transfer_responsibility`，否则 `claim_task` | 成功时：归档请求（mode `handoff_complete`、执行 `none`）→ T 转给 C → P `archived`；无锚点、无重新入队 | 归档请求自己的回执（`readSessionArchiveRequestReceipt`） | L11、L13、L14 |
| W1-HO-04 | `workflow.ts:claimRequeued` 复用分支 | 选中的复用 Session C | 选择 | C 的 `provenance.kind === 'continuation'`、`provenance.task` 等于这个任务；`deps.responsibilities` 已装；P 的卡片可读、P 没有归档请求、P 仍对 T 开放负责 | `advance`，`next` = 和 W1-HO-01 同样判断出的交接步（不先领取）；不满足 → 原领取 | 判断本身不写 | — | L17 |
| W1-AUTO-01 | `session-maintenance.ts` 退役分支 | P `active`、`health==='unavailable'`、没有归档请求 | 维护一步 | 不是 U1 跳过的情形；无占用；`facts.continuations.length > 0`；先关掉已终结的关系（原步骤）后，没有开放的 task/work `responsible` 关系 | 以 `handoff_complete` 走 `archiveLineInternal`，任务选择 `[]`、等待 `null`；有开放的 task/work 关系 → 跳过（零提交、不记失败） | 归档请求 + 归档，无锚点 | 请求号 `s1-maintenance-archive:<p>:<s>:handoff_complete:<rev>`（原写法） | L12；第 1 片 S1-AUTO-02 |
| W1-DUTY-01 | `composition/session-duty.ts` | — | 解析职责 | §4.1 的顺序 | `ready` + 职责或 `'unknown'`；永不拒、永不抛 | 无写 | 纯读 | L5、L6 |
| W1-ANOM-01 | `views/context-extensions.ts` | — | 读扩展 | §4.2 的顺序 | anomalies `available` + 行；其余四个 `not_implemented`；读不到 → 原拒绝 | 无写 | 纯读 | L7–L9 |

## 4. 规则

### 4.1 I-1：`createSessionDutyResolver`

对一个 `role`、可选 `ctx`，按顺序：
1. 求 `roleDuty`：`role.kind === 'role_spec'` 时：没有 `ctx` → 结果 `'unknown'`，不调用 `readRoleSpec`；否则 `deps.readRoleSpec(ctx, { pin: role.pin })`；不是 `ready`、或抛异常 → 结果 `'unknown'`；`ready` 时 `roleDuty = value.content.platformDuty`（可能缺省）。`legacy_template` 时 `roleDuty` 缺省。
2. 求 `templateDuty`：`role.kind === 'legacy_template'` 且存在 `d`（五种职责之一）使 `platformRoleProfile(d).template` 的 `templateId`、`templateRevision` 都等于 `role` 的 → `d`；否则缺省。
3. 两者都缺省 → 缺省分支：`canonicalJson(role)` 等于某个 `deps.configuration.bindings[i].sessionRole` 的 `canonicalJson` → `'executor'`，否则 `'unknown'`（`role` 无法规范编码 → `'unknown'`）。
4. 否则 `effectivePlatformDuty({ roleDuty, hostDuty: templateDuty })`：`ready` → 它的值；否则 `'unknown'`。

返回值一律 `{ status: 'ready', value }`。`session-maintenance.ts:dutyOf(record)` 改为 `dutyOf(ctx, record)`，调用 `deps.sessionDuty(record.role, ctx)`，`ctx` 用 `maintainSessions` 已核过的入参 ctx（`callerProblem` 之后）。

### 4.2 I-3：`createContextExtensionsReader`

对 `(ctx, request)`，按顺序：
1. `ctx.projectId`、`ctx.workspaceId` 是非空字符串，`ctx.signal` 存在，否则 `forbidden`（`the context extensions need a bound project/workspace context`）；`request.goalRef.projectId !== ctx.projectId` → `forbidden`。`ctx.signal.aborted` → `cancelled`。这几种情况都不调用 owner。
2. 构造内部 Host 上下文：`{ projectId, workspaceId, principal: { kind: 'host', actor: hostActor }, materialReader: { kind: 'host', projectId, workspaceId, actor: hostActor }, signal: ctx.signal }`。
3. 读锚点：`listSessionAnomalies(hostCtx, { goalRef: request.goalRef, page: { limit: 100 } })`，之后每页带上一页的 `nextCursor`，最多 25 页。任何一页不是 `ready`：`rejected` 原样返回；`not_found` 返回 `{ status: 'not_found' }`；`not_ready` 返回 `incomplete`（`the Goal anomaly anchors are not readable at the required watermark`）。抛异常 → `unavailable`（`the anomaly anchor read failed: <message>`）。读完 25 页 `nextCursor` 仍非空 → `incomplete`，原因 `anomaly_index_page_limit: the Goal anomaly anchors did not fit the 25-page read budget`。
4. 每项是 `{ anchor, pickedUpBy }`；只留 `pickedUpBy === null` 的；每项按 L9 写成一行；按 `key` 的字符码升序。`text` 精确为：
   - `anchor.cause === 'archive_interrupted'`：`中断，待核对：任务 ${anchor.task.taskId} 的执行 ${anchor.runRef.runId} 被归档中断，改动没撤销也没核对`
   - `anchor.cause === 'retired_archive'`：`中断，待核对：任务 ${anchor.task.taskId} 的执行 ${anchor.runRef.runId} 因线退役被归档中断，改动没撤销也没核对`
5. 返回 `{ status: 'ready', value: { notes: NI, anomalies: { availability: 'available', rows }, footprint: NI, goalSettings: { availability: 'not_implemented', autonomy: null }, decisions: NI } }`，`NI = { availability: 'not_implemented', rows: [] }`。

### 4.3 G：目标内容核对

1. **装配（`context-assembler.ts:assembleTask`）。** `facts !== null` 时，绑定的 `sources` 由 `sortedSources(facts.sources 映射后)` 得到：映射只改一种来源：`kind === 'record'`、`ref.aggregateType === 'Goal'`、`ref.projectId === claim.task.projectId`、`ref.goalId === claim.task.goalId` 的那一条，`digest` 换成 `goalContextDigestV1(facts.goal)`；其余原样。先映射、再排序（`digest` 参与规范键）。目标段文字（`goalPayload`）一个字节都不改。`assembleQuery` 不改。
2. **入口（W1-CTX-01）。** §2.2。比较用当前 Goal（`authorizeRuntimeEntry` 里 `readGoalScope` 读到的，即入口按当前版本守卫的同一份）。
3. **Workflow（W1-WF-01）。** 只认确切的码和前缀；其它 `start` 拒绝照旧 `waiting(receipt, receiptReason(...))`。

### 4.4 E15：普通接续的交接

1. **哪些建 Session 算普通接续。** 只有 `claimRequeued` 里 `chosen.kind === 'create'` 且 `continuationProvenanceFor` 给出 `continuation` 来历的那一种（前任活着、同工作区、没有归档请求；原因 `interrupted` / `damaged` / `role_mismatch`）。前任已归档、在归档中、跨工作区、读不到时来历为空（T10，归档后的普通领取），**不做交接**。复用一个已有 Session 不改来历（第 1 片 §2.2），只有 W1-HO-04 的恢复。哪些真实路径会走到这里见 L15。
2. **读 P 和 C。** 用 `deps.sessions.readSession(owned.ctx, …)` 读 P、C 的卡片（`record` + `links`），用 `deps.sessionFacts?.readSessionFacts(owned.ctx, P)` 读 P 的等待。P 或 C 读不到 → 不交接，直接领取。
3. **P“可当场交接归档”。** 全部满足：`lifecycle === 'active'`、`health !== 'unavailable'`、`archiveRequest` 为空、`occupancy === null`、`deps.sessionFacts` 已装且 `facts.wait === null`、P 的开放 `responsible` 关系（含 module）恰好一条且就是 `{kind:'task', ref:T}`、`deps.sessionLifecycle` 已装（Workflow 有归档组合）。
4. **归档步的请求（可当场交接归档时）。** `input = { sessionRef: P, reason: \`continuation handover: task ${T.taskId} continues in Session ${C.sessionId}\`, tasks: [{ target: { kind: 'task', ref: T }, disposition: { kind: 'transfer', to: C } }], wait: null, mode: 'handoff_complete' }`；`expected = [{ ref: P.record.ref, revision: P.record.revision }]`；请求号 `automaticGraphWrite(base, 'archive_predecessor', input, expected)`；调用 `archiveService.archiveLineInternal(automationContext(owned), request)`。
5. **转交步的请求（其余情况，P 仍对 T 开放）。** `input = { from: P, to: C, target: { kind: 'task', ref: T } }`；`expected` 恰好四个钉：P 的 Session 版本、C 的 Session 版本、P 对 T 的 `responsible` 关系版本、C 对 T 的 `responsible` 关系版本（C 没有这条关系时，用 `{ ref: { projectId, sessionId: C.sessionId, aggregateType: 'SessionWorkLink', target: { kind: 'task', ref: T }, relation: 'responsible' }, revision: 0 }`，owner 把 0 当作不存在，`session-responsibility-service.ts:writePrepared` 的 `cas`）。请求号 `automaticGraphWrite(base, 'transfer_responsibility', input, expected)`；调用 `deps.responsibilities.transferSessionResponsibility(automationContext(owned), request)`。
6. **领取。** 交接步之后的领取，和 `create_session` 分支现在建领取的方法相同（读 Goal、TaskGraph、assignment、binding，`buildClaimOperation`），只是 Session 版本用现读的 C 卡片，`requeue` 用步里带的，`sessionHint` 是 C。读不到 → `waiting(receipt, 原因)`，原因措辞照 `create_session` 分支的同类句子，把 “Session-created” 换成 “handover”。
7. **恢复（W1-HO-04）。** `claimRequeued` 在 `chosen.kind === 'reuse'`（不论来自 `responsibleSessionFor` 还是 afterRun 的原 Session）之后、`buildClaimOperation` 之前做：条件满足 → 按本节第 2–5 条发交接步（`successor` = 这张卡，`requeue` = 本次的）。
8. **没装 `deps.responsibilities`**（旧的窄测试替身）→ 一切照旧：`create_session` 之后直接领取，`claimRequeued` 不检查。
9. **维护（W1-AUTO-01）。** 退役分支改成：
   ```
   if (record.occupancy !== null) continue;
   if (facts.continuations.length > 0) {
     if (openResponsibleLinks(record, links).some(l => l.ref.target.kind !== 'module')) continue;
     mode = 'handoff_complete'; reason = 'the retired line was handed over to its continuation';
   } else { …原来的无接续分支，原样… }
   ```
   `mode` 的类型加 `'handoff_complete'`。其后建请求的代码不变（任务选择由开放关系映射，这里为空）。U1 跳过（第 484–495 行）仍在它前面。

## 5. 测试

### 5.1 夹具与跑法

- 夹具由 Codex 按本表分组写（决定 46），lead 在 WSL 核对后冻结；DSH 只写用例和实现。服务级用例（GE、AN07）沿用 `tests/helpers/S1-workflow-archive-fixture.ts:createTaskClaimFixture(kind)` 的 memory / SQLite 双后端；Workflow 级（HO、HM）用 `workflowForFixture` 的真实 owner，memory 一种；场景（SC）固定 SQLite，沿用 `tests/scenarios/harness.ts`、`tests/scenarios/support/restart.ts` 和 `assertInvariants`（`tests/state/invariants.ts`，即 STATE-MACHINES-SPEC §11 的不变量）。
- 不调用真实模型；模型回复都是脚本。不改数据库记录来造状态（AGENTS.md 第 4 条）：G 的“Goal 变了”只用纯函数（CG）和手工构造的、未绑定的已准备 manifest（GE02、GE06）；E15 的崩溃只用“不执行下一步”模拟；HO13 的最终提交冲突沿 S1-archive-flow IT13 的注入做法（不伪造记录）。
- 工作区里的 Session 少于一页（100 个），所以“紧接着那一页维护”一定处理到 P。
- 固定时钟 `t0='2026-10-08T00:00:00.000Z'`、`t1='2026-10-09T00:00:00.000Z'`。

### 5.2 用例

| id | 文件 | 给定 / 动作 | 精确期望 |
| --- | --- | --- | --- |
| GC01 | tests/state/WP1-goal-content.test.ts | `goalContextContentV1(goal)`，goal = `{ ref:{aggregateType:'Goal',projectId:'p',goalId:'g'}, objective:'Ship A\n第二行', workspaceRef:{…workspaceId:'w'} …}` | `{ contentVersion:1, goalId:'g', objective:'Ship A\n第二行', workspaceId:'w' }`；`goalContextDigestV1(goal)` 等于 `sha256Hex(canonicalJson(上面这个对象))`，64 位小写十六进制 |
| GC02 | 同上 | 两个 Goal 只差 `revision`、`activePlanRevision`、`desiredState`；再一个只差 `objective` | 前两个摘要相等；第三个不等 |
| CG01 | 同上 | `contextGoalContentProblem`：绑定里同 Goal 的 `record` 来源 `digest` 等于 `currentGoalDigest`，`rebinding:false` | `null` |
| CG02 | 同上 | 同 CG01，但 `digest` 是另一个 64 位十六进制 | `{status:'rejected', code:'revision_conflict', reason:'context_goal_changed: the Goal content shown by the prepared context changed after preparation; prepare the context again'}` |
| CG03 | 同上 | 同 CG02，但 `rebinding:true` | `null` |
| CG04 | 同上 | (a) `binding: undefined`；(b) 同 Goal 来源 `digest:null`；(c) 只有别的 Goal（`goalId:'other'`）的来源，`digest` 不等 | 三种都 `null` |
| CG05 | 同上 | 两条同 Goal 的来源（版本不同），一条摘要相等、一条不等 | 拒绝，同 CG02 |
| GC03 | tests/runtime/WP1-context-assembly.test.ts | `assembleTask`，图事实 `sources` 含这个 Goal 的 `record` 来源（`digest:null`）、Plan 来源、Run 来源 | 绑定里 Goal 来源 `digest === goalContextDigestV1(facts.goal)`；Plan、Run 来源原样（`digest:null`）；`sources` 按规范键升序；`contextAssemblyProblem(...) === null`；`binding.sections` 里 goal 段区间的文字逐字节等于 `## Goal\ngoal: g\nobjective: <原文>\nworkspace: w@<Run 的工作区版本>\nautonomy: (not_implemented)\ncurrent understanding: (not_implemented)`（`goalPayload` 不变） |
| GC04 | 同上 | `assembleQuery`，同样的图事实 | 绑定里 Goal 来源 `digest === null`（Query 不改） |
| AN08 | 同上 | `assembleTask`，图事实 anomalies `available`、一行（AN01 的形状），notes `not_implemented`，预算 4096（这一行放得下） | 提醒段含这行的 `canonicalJson({key,node,text,sources})`；含“注记索引尚未接入”；**不含**“异常锚点投影尚未接入”；`binding.extensions.anomalies==='available'` |
| AN01 | tests/work-graph/WP1-context-anomalies.test.ts | 提供方；`listSessionAnomalies` 替身返回 `{items:[{anchor:A, pickedUpBy:null},{anchor:B, pickedUpBy:<某 RunRef>}], nextCursor:null}`，A：`cause:'archive_interrupted'`、task `t1`、run `r1` | `ready`；anomalies `available`，`rows` 恰好一条：`key='anomaly:'+sessionAnomalyRefKey(A.ref)`，`node={kind:'task',ref:A.task,planRef:A.planRef}`，`text='中断，待核对：任务 t1 的执行 r1 被归档中断，改动没撤销也没核对'`，`sources=[{kind:'record',ref:A.ref,revision:1,digest:null}]`；notes、footprint、decisions 为 `{availability:'not_implemented',rows:[]}`，goalSettings 为 `{availability:'not_implemented',autonomy:null}` |
| AN02 | 同上 | 替身返回空页 | `available`，`rows=[]` |
| AN03 | 同上 | 150 项未接手（第一页 100、`nextCursor` 非空，第二页 50、`nextCursor:null`），其中一项 `cause:'retired_archive'` | 恰好调用两次，第二次带第一页的游标、`limit:100`；150 行按 key 升序；那一项的 text 为 `中断，待核对：任务 <id> 的执行 <id> 因线退役被归档中断，改动没撤销也没核对` |
| AN04 | 同上 | 替身 (a) 返回 `{status:'rejected',code:'unavailable',reason:'x'}`；(b) 抛 `new Error('boom')` | (a) 原样返回该拒绝；(b) `rejected/unavailable`，原因 `the anomaly anchor read failed: boom` |
| AN05 | 同上 | 替身每页都给非空 `nextCursor` | 恰好调用 25 次；`rejected/incomplete`，原因以 `anomaly_index_page_limit:` 开头 |
| AN06 | 同上 | (a) ctx 是 `work_run`（绑定 p/w）；(b) ctx 没有 `workspaceId`；(c) `request.goalRef.projectId` 是别的项目 | (a) 替身收到的 ctx：`principal={kind:'host',actor:hostActor}`、projectId/workspaceId 同原 ctx、`signal` 是同一个对象；(b)、(c) `rejected/forbidden`，替身没被调用 |
| AN07 | 同上（memory / SQLite） | 真实锚点 owner 写了一条锚点 A（用第 1 片的归档夹具），图读取器装了提供方（真实 `listSessionAnomalies`）；Host ctx 调 `readContextFacts(goalRef, focus=[A 的任务])` | `ready`；`extensions.anomalies.availability==='available'`，一行，`key='anomaly:'+sessionAnomalyRefKey(A.ref)`；对同一读取器用同目标里另一个任务的 Run 的 `work_run` ctx 调用也 `ready` 且同一行 |
| AN09 | 同上 | (a) 第二页返回 `{status:'not_ready'}`；(b) `ctx.signal` 已中止 | (a) `rejected/incomplete`，原因 `the Goal anomaly anchors are not readable at the required watermark`；(b) `rejected/cancelled`，替身没被调用 |
| GE01 | tests/work-graph/WP1-goal-content-entry.test.ts（memory / SQLite） | 真实准备（装配器带图读取器）后马上入口 | `committed`；准备好的绑定里 Goal 来源 `digest===goalContextDigestV1(当前 Goal)` |
| GE02 | 同上 | 未绑定的 Run；它的已准备 manifest 的绑定里 Goal 来源 `digest = goalContextDigestV1({...goal, objective:'other'})`（手工构造，其余合法） | `rejected`，`code:'revision_conflict'`，`reason` 以 `context_goal_changed:` 开头；Run 版本不变，没有 `ExecutionEntryAuthorized` 事件 |
| GE03 | 同上 | 同 GE02，但 Goal 来源 `digest:null` | `committed` |
| GE04 | 同上 | 真实准备 → 另一个任务的计划采用（P2 只加一个不相关的未来意图）→ 入口 | `committed`；审计事件 `activePlanRef` 是 P2；绑定 Goal 来源摘要非空（证明核对跑过） |
| GE05 | 同上 | 真实准备、入口授权（摘要相等）→ 用真实 reconcile owner 证明未进入并撤销（RUN-16）→ 用同一份固定的绑定和外壳重新授权 | `committed`，`entryGeneration===2` |
| GE06 | 同上 | 未绑定的 Run，手工绑定里 Workspace 来源版本不对，且 Goal 摘要也不对 | `rejected/revision_conflict`，原因是 `the assembled context named another Workspace revision`（Workspace 核对在前） |
| GE07 | 同上 | GE01 的同一个授权请求再发一次 | `committed`、`replayed:true`、cursor 同原回执 |
| WF01 | tests/business/WP1-start-refusal.test.ts | Workflow 替身：`runtime.startRun` 返回 `{status:'rejected',code:'revision_conflict',reason:'context_goal_changed: x'}`；执行 `perform start` | `{status:'ready', value:{state:'advance', receipt:{kind:'start',…}, next:{kind:'perform', operation:{kind:'prepare', request:{runRef:<prepared.claim.runRef>, requestId:<prepareStep 的值>}}}}}` |
| WF02 | 同上 | 同 WF01，但 `reason:'the Goal changed since the caller read it'` | `state:'waiting'`，`next:null`（原行为） |
| DU01 | tests/composition/WP1-session-duty.test.ts | `role_spec`，`readRoleSpec` 替身返回 `content.platformDuty:'secretary'`；这个 role 也在 Work 绑定里；传 ctx | `'secretary'`；替身收到同一个 ctx 和 `{pin: role.pin}` |
| DU02 | 同上 | `role_spec`，正文无 `platformDuty`，在 Work 绑定里 | `'executor'` |
| DU03 | 同上 | `role_spec`，正文无 `platformDuty`，不在 Work 绑定里 | `'unknown'` |
| DU04 | 同上 | `role_spec`，替身 (a) `not_found`、(b) `rejected/unavailable`、(c) 抛异常 | 三种都 `{status:'ready', value:'unknown'}`，不抛 |
| DU05 | 同上 | `legacy_template` `platform-reviewer@s3.1`，也在 Work 绑定里 | `'reviewer'` |
| DU06 | 同上 | `legacy_template` `builder@1`：(a) 在 Work 绑定里；(b) 不在 | (a) `'executor'`；(b) `'unknown'` |
| DU07 | 同上 | `legacy_template` `platform-secretary@s3.0`，不在 Work 绑定里 | `'unknown'` |
| DU08 | 同上 | `role_spec`，不传 ctx | `'unknown'`；`readRoleSpec` 没被调用 |
| DU09 | 同上 | 维护服务（真实 records、真实 `createRoleConfigurationService`，`sessionDuty = createSessionDutyResolver(...)`）。安装两个 RoleSpec：R1 带 `platformDuty:'secretary'`，R2 不带职责；Work 绑定里有两个绑定，`sessionRole` 分别钉 R1、R2；Session S1（钉 R1）、S2（钉 R2）各自负责一个任务，任务在 t0 满足、关系已 terminal 关闭（关闭事件带 `finishedAt=t0`）；两者都无占用、不在等、无 module 关系、无归档请求；now=t1 | `maintainSessions` 的 `archived=[S2]`；S1 仍 `active` |
| HO01 | tests/business/WP1-continuation-handover.test.ts | P 负责 T；P 上 T 的 Run 停下后 P 留下 `kernel_turn_open`（退役），维护不会先把 P 自动归档（L15：带人暂停围栏、人点了“继续”，或人认定的停止）；T 有指向这次 Run 的 TaskRequeue；工作区里没有别的可复用的同角色 Session；`select_work` → 执行 `create_session` | `create_session` 请求带 `provenance:{kind:'continuation',from:P,reason:'interrupted',task:T}`；执行后 `state:'advance'`，`next.operation.kind==='transfer_responsibility'`（P 退役，不可当场归档），`request.input={from:P,to:C,target:{kind:'task',ref:T}}`，`request.meta.expected` 四个钉（P、C 的 Session 版本，P 对 T 关系版本，C 对 T 关系版本 1），`requestId` 以 `wf-auto:` 开头；`operation.successor===C`，`taskRef===T` |
| HO02 | 同上 | 接 HO01，执行 `transfer_responsibility` | 回执 `committed`；P 对 T 的关系 `until` 等于回执 cursor；C 对 T 的关系仍开放、`since` 和版本不变；`next.operation.kind==='claim_task'`，钉的 C 版本等于转交后 C 的版本；同一次推进的维护页把 P 归档：P `lifecycle:'archived'`，`SessionArchiveRequested` 事件的 `mode:'handoff_complete'`；没有任何 `SessionAnomalyAnchor`；T 没有新的 TaskRequeue；结果没有 `maintenanceFailures` |
| HO03 | 同上 | P 活着、空闲、角色和 T 现在的 assignment 不符（`role_mismatch`：T 先在 Workflow 配置 1 下由 P（角色 Y）领取、结束、重新入队，之后换成配置 2，这个 assignment 的 `sessionRole` 是 X，工作区里没有角色 X 的 Session）；P 的开放负责关系只有 T；推进到建 Session 并执行 | `create_session` 之后 `next.operation.kind==='archive_predecessor'`，`request.input={sessionRef:P, reason:'continuation handover: task <T> continues in Session <C>', tasks:[{target:{kind:'task',ref:T},disposition:{kind:'transfer',to:C}}], wait:null, mode:'handoff_complete'}`，`expected=[P 的当前版本]`；执行后结果 `ready/state:'archived'`；P `archived`，P 对 T 的关系已关、C 对 T 的关系开放；没有锚点、没有新 TaskRequeue；下一步 `claim_task`（C 的当前版本） |
| HO04 | 同上 | 同 HO03，但 P 还负责另一个未完任务 T2 | `create_session` 之后下一步 `transfer_responsibility`（不是归档）；执行后 P 仍 `active`、`archiveRequest` 为空、对 T2 开放、对 T 关闭；下一步 `claim_task` |
| HO05 | 同上 | 同 HO03，但 P 正被另一个任务的 Run 占用 | `create_session` 之后下一步 `transfer_responsibility`；执行后 P 除对 T 的关系关闭、版本 +1 外不变；下一步 `claim_task` |
| HO06 | 同上 | HO01 执行完 `create_session` 后不执行下一步（模拟崩溃），重新 `select_work` | `next.operation.kind==='transfer_responsibility'`（不是 `claim_task`），`successor===C`，钉按当前版本 |
| HO07 | 同上 | HO03 执行完 `create_session` 后不执行下一步（模拟崩溃），重新 `select_work` | `next.operation.kind==='archive_predecessor'`，输入同 HO03，`expected` 按当前版本；执行后 P `archived` |
| HO08 | 同上 | 执行 HO01 的转交步之前，用已有的公开写让 C 的版本 +1（例如给 C 加一条与 T 无关的关系） | 转交回执 `rejected/revision_conflict`（这一步 owner 零写）；下一步 `select_work`；再推进一次：`next.operation.kind==='transfer_responsibility'`，钉按当前版本 |
| HO09 | 同上 | P 有归档请求（或已归档）时 T 被领取；工作区里没有别的可复用的同角色 Session | `create_session` 请求没有 `provenance`；执行后下一步 `claim_task`（没有交接步） |
| HO10 | 同上 | Workflow 没装 `responsibilities`（窄替身），其余同 HO01 | `create_session` 之后下一步 `claim_task`（原行为） |
| HO11 | 同上 | T 重新入队，afterRun 的原 Session 可复用且不是接续 Session | 下一步 `claim_task`，没有交接步 |
| HO12 | 同上 | HO02 的同一个 `transfer_responsibility` 请求紧接着再发一次（其间 C 没有别的写） | 回执 `replayed:true`、cursor 同原回执；`next` 同 HO02；这次推进不跑维护页 |
| HO13 | 同上 | 同 HO03，但在执行 `archive_predecessor` 时注入最终归档提交冲突（沿 S1-archive-flow IT13 的做法） | 回执里的结果 `ready/state:'partial'`（它的 `session` 快照仍带归档请求），P 对 T 的关系已转给 C；下一步 `claim_task`；同一次推进的维护页续做这个请求（转交按原回执重放，不再写一次），所以这次推进结束时库里的 P 已 `archived`；全程没有锚点 |
| HM01 | 同上 | 维护：P 退役、有接续 C、无占用、无归档请求、对任何 task/work 都没有开放关系 | `archived=[P]`；P 的 `SessionArchiveRequested` 事件 `mode:'handoff_complete'`，请求号 `s1-maintenance-archive:<p>:<P>:handoff_complete:<rev>`；没有锚点；C 不变 |
| HM02 | 同上 | 维护：P 退役、有接续、无占用，对一个**未终结**的任务 T 仍开放负责 | P 零提交；P 不在 `archived`、`pending`、`failures` 里 |
| HM03 | 同上 | 维护：P 退役、有接续、被一个结果未知的 Run 占用、无归档请求 | `failures` 恰有 P 一条 `busy`，原因以 `archive_unknown_confirmation_required:` 开头；P 零提交（决定 45 不变） |
| HM04 | 同上 | 维护：P 退役、有接续、无占用、无归档请求，只剩一条开放的 module 负责关系 | `archived=[P]`，mode `handoff_complete` |
| SC01 | tests/scenarios/WP1-wiring.test.ts | 场景（SQLite），沿 A8-host-restart-paused 的路径：T 的 Run 进行中人点暂停，暂停生效前 Host 重启，T 停在 paused-interrupted、P 留下 `kernel_turn_open`（维护因暂停围栏不自动归档 P）；人点“继续”，推进到底 | 收到的步依次含 `create_session`、`transfer_responsibility`、`claim_task`（没有 `archive_predecessor`），之后 T 正常完成、`satisfied`；P `archived`，归档事件 mode `handoff_complete`，P 对 T 的关系 `until` 等于转交回执 cursor；整个场景没有 `SessionAnomalyAnchor`；`tasks/archive-state(T)` 的 `label===null`；每步之后 `assertInvariants` 成立 |
| SC02 | 同上 | 场景（SQLite），目标里事先没有别的锚点：T 的 Run 进行中，操作者用 `sessions/archive-line` 归档这条线（选“放下”）→ 锚点 A；推进让别的 Session 领取 T 并准备 | 这次准备的 manifest：绑定 `extensions.anomalies==='available'`；提醒段含 key `anomaly:`+refKey(A) 那一行；接续说明的异常锚点段也列 A；输入里没有“异常锚点投影尚未接入”；这个 Run 进入、T 完成后，再对这个目标 `readContextFacts`，anomalies 的 `rows` 为空 |

### 5.3 已有测试

- **必须保持通过、期望不改：** `tests/scenarios/C6-unrelated-adoption.test.ts`（全部 5 个），`tests/work-graph/S3-prepared-context-admission.test.ts`、`tests/runtime/S3-context-assembler.test.ts`（含 CA14：没装扩展时仍 `not_implemented`）、`tests/work-graph/S3-graph-context.test.ts`（含 GR13）、`tests/state/context-input.test.ts`、`tests/business/S1-session-maintenance.test.ts`（含 IT09、IT10、IT34）、`tests/business/S1-archive-flow.test.ts`、`tests/business/A2-workflow-auto-rework.test.ts`、`tests/business/R5c-workflow.test.ts`、`tests/business/A2-workflow-result-mapping.test.ts`、`tests/composition/platform.test.ts`。
- **可能因 E15 变的：** 建过普通接续 Session 的场景：`tests/scenarios/A7-control-goal29.test.ts`、`A7-control.test.ts`（A7-G4）、`A8-host-restart-paused.test.ts`、`A8-host-restart*.test.ts`、`tests/composition/A2-requeue-platform.test.ts`、`tests/scenarios/harness.test.ts`。它们多数用 `arrayContaining` 断言步骤，不受影响；但若某条断言读到前一条线的版本、生命周期或回执个数，交接以后会变。规则：只因“前一条线被转交 / 归档”而失败的断言，DSH 不改，列进 UNSPECIFIED（文件:行、原断言、新值、对应本规格哪一行），由 lead 定；别的失败一律当回归修实现。
- **I-3 的影响：** 生产 composition 里提醒段不再有“异常锚点投影尚未接入”一行，有锚点时多出锚点行。若有已有测试在生产 composition 上断言这句话或整段输入字节，同上列出交 lead。
- **G 的影响：** 生产准备出的绑定里 Goal 来源摘要从 `null` 变为字符串（绑定字节、manifest 摘要随之变，输入文字不变）。同上。

## 6. 文件清单

| ID | N/M | 文件 | 用途 |
| --- | --- | --- | --- |
| W01 | M | src/contracts/graph-context.ts | §2.1 `GoalContextContentV1`、`goalContextContentV1`、`goalContextDigestV1` |
| W02 | M | src/core/work-graph/state/context-input.ts | §2.2 `contextGoalContentProblem` |
| W03 | M | src/core/agent-runtime/context-assembler.ts | §4.3 第 1 条：Work 绑定的 Goal 来源摘要 |
| W04 | M | src/core/work-graph/tasks/execution-entry-service.ts | §2.2 后半、W1-CTX-01 |
| W05 | M | src/business/workflow/contracts.ts | §2.3 两个新步 |
| W06 | M | src/business/workflow/workflow.ts | W1-WF-01、W1-HO-01…04、§4.4 |
| W07 | M | src/business/workflow/session-maintenance.ts | W1-AUTO-01、§4.1 末段（`dutyOf` 传 ctx） |
| W08 | M | src/business/workflow/ports.ts | §2.4 `SessionDutyResolver` 加可选 ctx |
| W09 | N | src/composition/session-duty.ts | §2.4、§4.1 |
| W10 | M | src/composition/create-platform.ts | 用新解析器、删 `defaultSessionDutyResolver`；图读取器加 `extensions` |
| W11 | N | src/core/work-graph/views/context-extensions.ts | §2.5、§4.2 |
| W12 | N | tests/state/WP1-goal-content.test.ts | GC01–GC02、CG01–CG05 |
| W13 | N | tests/runtime/WP1-context-assembly.test.ts | GC03–GC04、AN08 |
| W14 | N | tests/work-graph/WP1-context-anomalies.test.ts | AN01–AN07、AN09 |
| W15 | N | tests/work-graph/WP1-goal-content-entry.test.ts | GE01–GE07 |
| W16 | N | tests/business/WP1-start-refusal.test.ts | WF01–WF02 |
| W17 | N | tests/composition/WP1-session-duty.test.ts | DU01–DU09 |
| W18 | N | tests/business/WP1-continuation-handover.test.ts | HO01–HO13、HM01–HM04 |
| W19 | N | tests/scenarios/WP1-wiring.test.ts | SC01–SC02 |

不在写范围：`module-target.json`（`views → tasks`、`composition` 都已允许）、`vendor/`、`src/ui/`、路由文件、文档。`tests/architecture/production-reach-allowlist.json` 原则上不改（新导出都有生产调用方）；若检查要求改，DSH 列进 UNSPECIFIED，不自己改。测试文件名用 `WP1-` 开头，因为 `tests/composition/W1-future-plan-platform.test.ts` 已经占了 `W1-`。

## 7. 规则（任务书逐句带入）

1. **交接不卡领取。** 交接步的结果只按 W1-HO-02、W1-HO-03 的表走：做完 → 领取，冲突或转交没做完的归档中途失败 → `select_work`，别的拒绝 → 转交或领取；不重试同一个请求、不 `waiting`（L13）。
2. **交接先于领取的版本钉。** 领取的 Session 版本一律在交接步之后现读，不用 `create_session` 回执里的版本（L10）。
3. **能当场归档就一步做完。** P 手上只有 T、活着、空闲、不在等时，发带转交选择的 `archive_predecessor`，不先发转交（L11）；退役的 P 只转交，归档交给维护（L12）。
4. **交接不写锚点、不重新入队、不动消息。** 归档模式 `handoff_complete`、等待 `null`（L14）；不改 `drive`。
5. **U1 不变。** 维护里结果未知的退役线照旧跳过、记 `busy`，零提交；新分支在它之后（决定 45）。
6. **不加回 Goal 钉。** G 只比较摘要；`contextConsumptionGuards` 继续跳过 Goal；不相关的采用必须仍能进入（C6、GE04）。
7. **目标段字节不变。** `goalPayload` 不改；摘要只进绑定。
8. **I-1 证据不足就 `'unknown'`。** 不用 `effectivePlatformDuty` 的缺省 `executor`；不读 Host 授权里的职责（L5）。
9. **I-3 读不到就失败；提供方只给图读取器。** 不把读失败变成空行或 `unavailable`（L8）；`createContextExtensionsReader` 只在 `create-platform.ts` 里装进 `createGraphContextReader`，不传给别处（L7）。
10. **不改数据库造状态。** G 的“变了”只用纯函数和手工构造的未绑定 manifest；E15 的崩溃只用“不执行下一步”模拟。
11. **不调用真实模型；不碰 3080、3099、44797；不改 `vendor/coding-agent/dist`；不跑 git 写命令。**

## 8. 怎么核对（lead）

- 两段做法（AGENTS.md 第 5 条、决定 46）：Codex 写夹具 → lead 冻结 → DSH 第一段（骨架和用例，RED 来自 `not implemented` 桩）→ lead 冻结测试 sha256 → DSH 第二段（实现，新 Session）→ 脚本核对、Codex 复审、lead 读 diff。
- 第二段之后：`npm run typecheck`、`npm run check:architecture`、§6 的 8 个新测试文件、§5.3 第一条点名的文件；合入前在有 bwrap 的 WSL 槽位跑一次全量，比较失败信息而不只是个数（DSH-WORKFLOW §6.10）。期望：全量 = 250 个文件、5626 项 + 本包 8 个文件 63 次，原有的一个不少；§5.3 第二至四条列出的变化由 lead 逐条定。
- 交付报告固定四段 `FILES CHANGED / CHECKS / UNSPECIFIED / NOTES`。
