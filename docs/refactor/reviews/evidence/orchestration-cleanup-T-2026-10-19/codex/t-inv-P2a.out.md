P2a 只读盘点完成，共 **20 项候选，约涉及本区生产代码 1,802 行**。未写文件，未运行测试或构建，未联网。

删除旧格式支持的共同依据是 `docs/refactor/HANDOFF.md:565–570`（79-1）；逐项交代删除范围及覆盖依据的要求见 `docs/refactor/HANDOFF.md:584–603`（79-4）。下文“现有覆盖”均指静态阅读到的测试，**不表示本次运行通过**。行数为预计删除或修改的生产代码行数，不含测试、外区联动及文档，也不等于净删除量。

为使表格可读，使用以下明确路径前缀；JSON 使用完整路径：

- `W/`＝`src/core/work-graph/`
- `T/`＝`tests/`
- `D79`＝`docs/refactor/HANDOFF.md:565–570`
- `C1验收`＝`docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md`

| 编号 | 类别 | 位置；相关测试 | 证据：接受什么、当前是否还写 | 建议及精确范围 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---:|---|---|
| P2a-01 | old-data | `W/persistence/plan-record-codecs.ts:804–818,1005–1020`；`W/state/plan-machine.ts:104–112`。旧测试：`T/work-graph/S5-request-candidates.test.ts:305–341::RC11` | 接受没有完整 draft 的旧 `PlanProposal@1`，包装成 `legacy_v1`。当前构造器只创建 `candidate_v2/schemaVersion:2`：`W/state/plan-machine.ts:132–135`；当前保存入口使用该候选：`W/tasks/plan-service.ts:1424–1425,3355–3356`。未找到当前生产入口新建旧 proposal。 | **delete**：旧 proposal 校验、包装、`LegacyPlanProposal` 联合成员及专属拒绝/过滤分支。联动 `W/tasks/plan-service.ts:1349,2397,2852–2853,3287`、`W/tasks/plan-readers.ts:554,633`。只删除 RC11 的旧格式场景，不删除候选生命周期测试。 | 旧支持由 D79 撤销；当前候选读取、替换和采用路径见 `T/work-graph/S5-request-candidates.test.ts:58::RC01,146::RC04,175::RC05`。 | 80 | 是，RC11 | 高 |
| P2a-02 | legacy | `W/persistence/plan-record-codecs.ts:518–522,569–583`；`W/tasks/plan-commit-compiler.ts:127–162`。旧测试：`T/work-graph/W2-future-intent.test.ts:140–164::legacy full v1/v2 without executionIntent still adopts…` | Plan **内容版本**仍接受 1、2；编译器在收到 v1 draft 时仍实际生成 v1：`W/tasks/plan-commit-compiler.ts:157–162`。因此不是无写入端的死格式。当前 initial-plan 输出已为 v2：`W/tasks/initial-plan.ts:61,77`；未来细化也输出 v2：`W/tasks/plan-commit-compiler.ts:412`。 | **change:公开计划入口和编译器统一 v2，再移除 v1 分支。** 同步 `src/contracts/plan.ts:223,264`。上述混合测试只去掉 v1 采用部分；保留未标注 `executionIntent` 的合法 v2，以及空计划、仅 optional 等约束。不要把所有 `schemaVersion:1` 都删掉，提交事件和其他协议仍有自己的版本。 | 当前 v2 codec：`T/work-graph/W2-future-intent.test.ts:116–129`；实际采用及 SQLite 重开：同文件 `:198::initial required plan_only saves…`；未来细化：`:350::future refinement preserves…`。 | 60 | 是，混合场景需拆分 | 中 |
| P2a-03 | old-data | `W/persistence/execution-entry-codecs.ts:129–149`；`W/state/run-machine.ts:77–81,155–167,1456–1457,2199–2200`。旧测试：`T/work-graph/B2-execution-entry.test.ts:205–213`；`T/state/run-machine.test.ts:444–452,1012,1409` 的旧授权部分 | 接受没有新 schema 标志的 `ExecutionAuthorizationV1`，并把部分 pre-B2 running Run 标为 `legacyV1`，只读、不允许重新 begin。当前授权写入明确为 V2：`W/state/run-machine.ts:861–869`。 | **delete**：V1 校验器、版本分流、`legacyV1` 状态位和专属 begin/reconcile 拒绝分支。**保留**新 claimed Run 尚无授权，以及 D7 未入 Kernel 就结束时没有绑定的状态，见 `W/state/run-machine.ts:79`。B2 混合测试 `:214–219` 的 malformed V2 部分不随旧 V1 删除。 | D79；当前授权/begin/replay：`T/work-graph/B2-execution-entry.test.ts:156–184::fresh begin and replay are distinct…`；SQLite 竞态及重开：`:117`。 | 60 | 是，涉及 Run 状态表 | 高 |
| P2a-04 | old-data | `W/tasks/session-provenance-facts.ts:1–611`；`W/sessions/session-directory.ts:966–977,1607–1789`；`W/sessions/session-record-codecs.ts:660–664,736–740,1026–1031`；`W/state/session-availability.ts:1003–1026`。旧测试：`T/work-graph/S1-provenance.test.ts:293::SV12,338::SV13,364::SV14,393::SV15,415::SV45,440::SV46`；`T/work-graph/S1-codecs-indexes.test.ts:275::SV01` 的旧 provenance 部分 | 旧 Session / 已接受创建操作可以没有 provenance；系统通过咨询、requeue、manifest 等事实推导并一次性补填。当前创建入口把未指定来源规范化为 `new`，接受操作写入 provenance：`W/sessions/session-directory.ts:704–733,781–792`；只在重放旧操作时仍生成缺字段 Session：`:966–977`。 | **delete**：整个旧来源推导文件、补填 API/事件/状态迁移、旧来源注入端口、claim 的推导回退、为旧来源而扫描 Workspace 的 `legacyPending` 分支。具体联动：`W/tasks/claim-service.ts:731,762–775`、`W/queries/query-execution.ts:930–946`、`W/tasks/session-facts.ts:272–315`、`W/views/work-line-reader.ts:282–310,1776`、相关 model contracts。外区接线见 `src/composition/create-platform.ts:806–808,822,848,1280,1837`、`src/business/workflow/session-maintenance.ts:368–381`，不计入本行估算。保留当前 new/continuation/readonly_copy 及真实后继关系；SV14 不能因包含旧夹具而整项删除。 | D79；真实创建及两种后继区分：`T/work-graph/S1-codecs-indexes.test.ts:454::SV04`；创建入口拒绝非法 provenance：`:485::SV05`；只读副本派发约束：`T/work-graph/S1-dispatch-guards.test.ts:45::SV39`。旧补填状态表项另见 `T/state/S1-session-archive.test.ts:192::UT09,209::UT10`，须随废止行为更新。 | 1,000 | 是，SV/UT 表项 | 高 |
| P2a-05 | old-data | `W/tasks/session-facts.ts:417–440,467–477`。旧测试：`T/work-graph/S1-session-facts.test.ts:172::SV53` | 为没有 `executionState`、因而没有 Session 索引项的旧 QueryRun，额外合并 Session 的 `lastExecutionRef`，并在游标保存 `pointerDone`。当前 claim 创建 executionState 后，将 QueryRun 与占用 Session 同批提交：`W/queries/query-execution.ts:983–1002`；executionState 写入见 `:518`。 | **delete**：旧指针补充候选、去重/排序合并、`pointerDone` 游标状态以及“指针例外可没有匹配 executionState”的条件。保留尚未 claim 的 pending QueryRun 没有 executionState；它不应因此成为某 Session 的已执行历史。 | D79；当前 Query 指针不会遮蔽既有 Work wait：`T/work-graph/S1-session-facts.test.ts:62::SV06`。SV53 中仅旧 Query 指针场景退出支持。 | 45 | 是，SV53 | 高 |
| P2a-06 | old-data | `W/persistence/record-codecs.ts:718–727,779–783,850–862`。旧测试：`T/work-graph/A2-step1-codecs.test.ts:557–561::decodes a record written before A.2…`、`:573–579::writes a never-changed Goal in its legacy shape…` | 不只是读取旧记录：encoder **现在仍主动去掉**未变化 Goal 的 `desiredStateRevision:1`、`desiredStateRequestedBy:null`；创建事件重建快照也不提供它们。decoder 再补回 1/null。 | **change:当前 Goal 创建、重放和编码统一显式保存 desiredStateRevision/desiredStateRequestedBy，再删除缺字段默认。** 删除 `neverChanged ? legacyShape : snapshot`，同步创建快照和 validator。不能只收紧 decoder，否则会拒绝当前 writer。 | D79；当前状态值及 requester round-trip：`T/work-graph/A2-step1-codecs.test.ts:564–572::round-trips the three desired states with and without a requester`。两个“保持 pre-A.2 字节”的测试退出支持。 | 35 | 否 | 高 |
| P2a-07 | old-data | `W/persistence/rework-codecs.ts:45–77`；`W/persistence/decision-record-codecs.ts:382–425`；`W/persistence/plan-record-codecs.ts:1023–1041,1072–1078`；`W/views/automatic-rework-notices.ts:118–174,205–211,255–262,422–434,526–533`。旧测试：`T/work-graph/S2A-notices-rework.test.ts:37–76::QA-11`；`T/work-graph/S5-notices.test.ts:195–212::NR05,271–283::NR08` | 接受缺 `since` 的通知记录，生成 `(occurredAt,itemKey)` legacy 位置，另扫 legacy equality 索引；自动 reverify 缺 cap 时显示“上限未记录”。当前消息、计划候选、requeue、round 创建都提供待绑定 `since`：`W/communication/mailbox-service.ts:298–315`、`W/tasks/plan-service.ts:1425,3356`、`W/tasks/requeue-service.ts:1110–1116`、`W/evidence/evidence-service.ts:352–358`；自动 reverify 保存 cap：`:1697–1702,2030`。 | **change:通知统一使用提交位置，删除旧 origin/legacy position/legacy 索引扫描及自动 reverify 的 unknown-cap 分支。** 还包括 `W/views/notice-position.ts:47–52`、`W/persistence/record-codecs.ts:240–245`、`W/views/decision-read-model.ts:1566,1818`、`W/tasks/claim-record-codecs.ts:59–74`、`W/persistence/evidence-record-codecs.ts:732–736`。仅自动 reverify successor 必须有 cap；人类操作、root round 不因此强制有 cap。提交前 `since:null` 占位仍保留。NR05 的非法持久化 null 检查不能与 legacy 排序部分一起删。 | D79；当前自动通知：`T/work-graph/S5-notices.test.ts:116–135::NR01`；创建位置不随确认改写：`:165–193::NR04`；重开保留已读位置：`:214::NR06`。 | 200 | 是，QA-11/NR05/NR08 | 高 |
| P2a-08 | old-data | `W/views/track-read-model.ts:642–650,702,750,769–780`；`W/views/activity-read-model.ts:480–487`；`W/persistence/evidence-record-codecs.ts:745–760`。旧测试：`T/work-graph/S2B-30-track-bars.test.ts:188–207::2B-30 legacy rounds without since…` | 旧 round 缺创建位置，或已 finalize 却缺 `finalizedAt`，不画 bar，只计入 unplaced。当前 round 创建绑定 since，finalize 写终结时刻：`W/evidence/evidence-service.ts:352–358,1605`。 | **change:移除缺时间旧 round 的扫描与 unplaced 计数，当前 finalized round 要求终结时间。** 删除 `S2B_ROUND_BY_GOAL_LEGACY_LOOKUP` 及其消费者。**保留** `W/persistence/evidence-record-codecs.ts:748,767–771` 的 UNFINALIZED 索引：当前 open round 本来就没有 finalizedAt；也保留无负责 Session 的 gate unplaced 业务。与 P2a-07 的通知 legacy 索引分开计数。 | D79；当前 open/closed 检查条及时间：`T/work-graph/S2B-30-track-bars.test.ts:154–185::2B-30 check bars carry…`；gate 无负责 Session：`:209`。 | 65 | 是，2B-30 | 高 |
| P2a-09 | old-data | `W/persistence/evidence-record-codecs.ts:324–326`；`W/state/verification-machine.ts:99–101,633–670,912–920`。旧测试：`T/work-graph/A2-step1-codecs.test.ts:380–384::a legacy round (no chain, no incompleteCause)…`；`T/state/verification-machine.test.ts:1101,1111` 的 legacy root 部分 | 缺 chain 的旧 round 被视作 ordinal 1/root。当前新 root 已明确写 chain：`W/state/verification-machine.ts:110–112,912–920`；successor 也写完整 chain：`:633–670`。 | **change:VerificationRound 的 chain 成为当前格式必填，删除缺 chain 视作 root 的解释分支。** 保留正常 root/successor 及链一致性业务。不要顺带要求 `incompleteCause` 必填：它在当前非 incomplete 状态仍可以没有。 | D79；当前 successor/root 编解码：`T/work-graph/A2-step1-codecs.test.ts:387::a successor round…with incompleteCause and a chain root round-trip`；实际链通知及计数：`T/work-graph/S5-notices.test.ts:116::NR01,262–269::NR07`。 | 60 | 是，含状态表旧 root 分支 | 高 |
| P2a-10 | old-data | `W/persistence/evidence-record-codecs.ts:436`；`W/state/verification-machine.ts:1036–1059`。旧测试：`T/work-graph/A2-verification-chain.test.ts:269::VR-10..12: no index row for zero evidence, a legacy @0 row repaired` | 已存 `TaskEvidenceIndex@0` 被接受，下次追加时修复。当前 writer 在无新增 evidence 时不写记录；有新增时 revision 为正：`W/state/verification-machine.ts:1055–1059`。 | **change:持久化 TaskEvidenceIndex 要求正 revision，移除 legacy @0 修复契约和测试部分。** 不删 `exists`、不存在记录的 null CAS、零追加不写入：这些仍是当前正确行为；也不删除整个 `nextTaskEvidenceIndex`。 | D79；同一 `VR-10..12` 保留“零 evidence 无记录”以及正常追加/CAS 部分。旧 @0 修复部分退出支持。 | 5 | 是，VR-10..12 | 高 |
| P2a-11 | old-data | `W/architecture/catalog-record-codecs.ts:398–409,576–578` | 缺 `since` 的旧 ArchitectureCatalog 通过两套 key 集合校验，解码补 null。当前 adopt/revise 都提供 since 占位：`W/architecture/catalog-service.ts:525,707`；重放、提交返回会绑定原 receipt cursor：`:322–327,756–760`。本轮未找到专门固定“省略 since”的独立测试断言。 | **change:Catalog 当前记录必须有 since 键，删除缺键 key-set 和解码补 null。** 区分事件中提交前 null 与已提交记录 cursor；不把事件预绑定快照误删。 | `T/work-graph/S8A-catalog-version-time.test.ts:21::binds the revised record to its event cursor…`、`:68::returns the bound cursor in the revision write result…`。 | 20 | 否 | 高 |
| P2a-12 | old-data | `W/persistence/note-record-codecs.ts:120–123,387–390,612–633` | 旧 NoteVersion 缺 `noticeClass` 补 null；旧 disposition event 缺 actor/proof 也补 null。当前版本构造器明确设置 noticeClass，包括合法 null：`W/state/note-machine.ts:296–320`；当前 disposition writer 写 actor/proof，包括显式 null：`W/notes/note-service.ts:708–710,868,1542–1544`。未找到专门断言旧字段省略的测试。 | **change:要求 noticeClass、actor、proof 的键存在，删除省略字段的补 null。** 显式 null 仍有效；保留普通注记、非用户决定的 disposition 以及有 proof 的决定流程。 | `T/work-graph/S4C2-N1.test.ts:33–95::N1 %s: one g1 line with three members and one g2 line with one` 通过实际写注记、withdraw/review、读通知覆盖；显式 null 见 `T/work-graph/S4C2-notice-class.test.ts:103–106`。 | 25 | 否；未发现旧格式专门表项 | 高 |
| P2a-13 | old-data | `W/queries/query-record-codecs.ts:447–450`；`W/queries/query-execution.ts:334–336` | 允许 QueryJob 缺精确 submission locator；需要原提交身份时再返回 unsupported。当前提交与事件重放均写 locator：`W/queries/query-job-service.ts:731,498`。未找到固定缺 locator 行为的专门测试。 | **change:当前 QueryJob 必须携带 submission，删除旧记录缺 locator 的延迟 unsupported 路径。** `W/queries/query-record-codecs.ts:522` 的“旧事件 mirror 可选”注释不能直接当成另一个兼容实现；实际事件校验已经要求 identity/fingerprint，见 `:503–504`。 | `T/work-graph/R5b-query-job.test.ts:137–170::records QueryJob@1 + QueryRun@1 pending, locates the original actor, and replays the same receipt`，locator 断言在 `:152–155`。 | 8 | 否 | 高 |
| P2a-14 | c1-transfer | `W/views/track-read-model.ts:224–226`；`C1验收:82` | 明确接受旧游标没有 `ca`，当作 null。当前游标写入均包含 ca：`W/views/track-read-model.ts:908,920,976,988`。未找到省略 ca 的专门测试。 | **change:游标 ca 必须是 string 或 null，删除 undefined→null 容忍。** 只改这三行对应的兼容读取，不改当前 query/copy 分页状态机。 | 当前查询与副本读取：`T/work-graph/S2B-30-track-bars.test.ts:354`；`T/work-graph/S2B-r3-consultation-cap.test.ts:34–63::2B-r3 R3 limit 2 over many later readonly copies…` 验证首屏和非空 next，**未消费 next，不能算 ca 续页覆盖**。现有 run 分页测试也不能替代该断言。 | 3 | 否 | 高 |
| P2a-15 | old-data | `W/materials/applicability.ts:96–100` | `origin.kind === 'legacy'` 用历史 ownerRunRef 推导拥有者。旧 origin 来源在区外：`src/core/record-store/body-codec.ts:206–212`；当前新写入拒绝伪造 legacy：`:196`，保存正式 origin：`:239–247`。 | **delete**：本区 `:97` 的 legacy origin 分支，与区外旧 body 解码及联合类型一起收口。不是删除整个材料适用性检查；也不是删除当前 Plan 的 `legacyArtifactRef` 声明。 | D79；旧测试：`T/data/R3b-materials-contract.test.ts:63::reopens the original artifacts table and reads legacy first-owner provenance`、`:151::does not infer a Host-readable scope from a legacy record without an owner`。当前 scope 行为：`T/data/R3b-material-admission-boundaries.test.ts:31,98`。 | 1 | 否 | 高 |
| P2a-16 | old-data | `W/state/context-input.ts:225,374,381–383`；`W/tasks/execution-entry-service.ts:1040–1065,1129`。旧测试：`T/work-graph/S3-prepared-context-admission.test.ts:499–508::AD05`；`T/work-graph/WP1-goal-content-entry.test.ts:79–85::GE03`；`T/state/WP1-goal-content.test.ts:107–117::CG04` 的旧格式部分 | 缺 contextAssembly 的旧 manifest 直接通过；Goal digest 为 null 也跳过内容变更检查。当前 Work preparation 从 assembler 获取 binding：`src/core/agent-runtime/execution-preparation.ts:481–498`；当前 Goal source 写实际 digest：`src/core/agent-runtime/context-assembler.ts:1919–1923`。Query preparation 同样取 binding：`src/core/agent-runtime/query-preparation.ts:332,359`。 | **change:当前 prepared manifest 必须携带 assembly；Work 的匹配 Goal source 不再允许旧 null digest。** 删除缺 binding 放行及旧 null digest 放行。保留已有绑定的 rebinding 规则 `W/state/context-input.ts:375–376`，保留区分其他 Goal source 的条件。同步 `W/queries/query-execution.ts:1072–1088` 的缺 assembly 分支；不把 Work 的 Goal 条件无差别加给 Query。 | D79；实际当前准入：`T/work-graph/S3-prepared-context-admission.test.ts:438::AD01,531::AD07`；真实 Goal digest 与冲突：`T/work-graph/WP1-goal-content-entry.test.ts:55::GE01,63::GE02`；固定绑定重授权：`:99::GE05`。 | 25 | 是，AD05/GE03/CG04 | 中 |
| P2a-17 | legacy | `W/communication/mailbox-service.ts:2034,2049–2067,2095,2147`；`W/state/message-machine.ts:1202`。旧接口测试：`T/app/orchestration-mechanism.test.ts:181::normalizes the legacy replyMode=wait into the same single wait path` | `replyMode:'wait'` 仍是当前可调用入口，并规范化为 intent/needsReply/waitAfterSend。不是仅旧存储读取：模型工具 schema 仍暴露它，见 `src/core/agent-runtime/communication-tools.ts:319,417`；当前状态构造也仍保存它。 | **change:调用方统一 intent/needsReply/waitAfterSend 后，删除 replyMode=wait 的输入别名和存储冗余。** 必须同步模型工具及 UI/workflow 消费端，不能只删 mailbox 分支。保留“询问但不等待”与 fire-and-forget 的不同语义。本行只估本区改动。 | 同一路径的正式字段覆盖：`T/app/orchestration-mechanism.test.ts:169::persists explicit intent/needsReply/waitAfterSend and registers exactly one real wait`、`:208::persists and reads back…through the real service`；不等待通知：`:189`。 | 60 | 否 | 中 |
| P2a-18 | c1-transfer | `W/model/claim-contracts.ts:92–107`；`W/state/attempt-machine.ts:64–70`；`C1验收:86,93–94`。类型测试：`T/state/attempt-machine.test.ts:705–711::DispatchOutboxRecord is the TaskClaimOutbox record of claim-contracts.ts` | 两处重复声明相同 outbox 形状，另有 `TaskDispatchStateV1 = DispatchStateV1` 别名。检索并非“今天只剩测试引用”：该别名目前还参与重复形状及 `W/persistence/execution-entry-codecs.ts:39,45` 的导入/再导出。 | **change:TaskClaimOutbox 复用 DispatchOutboxRecord，删除随后无必要的 TaskDispatchStateV1 别名及再导出。** 更新类型测试引用；不改变持久化格式，**不删真实 DispatchStateV1**。 | 两个结构及现有类型互赋测试就是重复证据；运行态 V1/V2 writer 见 `W/state/attempt-machine.ts:327–353`，两者均需保留。 | 20 | 否 | 高 |
| P2a-19 | old-data | `W/sessions/session-record-codecs.ts:746–747`；`W/sessions/message-record-codecs.ts:879–893`；`W/communication/mailbox-service.ts:3299–3309`；`W/views/undelivered-reply-notices.ts:343–348`。旧测试：`T/work-graph/WP2-undelivered-notices.test.ts:221–273::M05 old data missing a position blocks only its Goal…` | 接受 unavailable Session 缺 unavailableSince，以及已回复 work_run 消息缺 responseSince；DTO 保持省略，通知源再给旧数据专用 incomplete。当前 unavailable 迁移写游标占位：`W/state/session-availability.ts:397,455–457`；当前回复写 responseSince：`W/state/message-machine.ts:1252,1313`，由 `W/communication/mailbox-service.ts:306–307` 绑定。 | **change:按状态要求当前记录携带对应游标，删除旧缺位 DTO 和专属 position_missing 分支。** available Session、尚无回复或非 work_run 原消息仍可无对应字段；提交前 null 占位保留。M05 只移除旧记录部分，不连带删损坏游标、跨源不一致及稳定性检查。 | D79；当前先退役后回复、先回复后退役：`T/work-graph/WP2-undelivered-notices.test.ts:113::F09,127::F09,147::F10`；恢复后再次不可用：`:166::F12`。 | 25 | 是，M05 | 高 |
| P2a-20 | old-data | `W/tasks/claim-record-codecs.ts:241–251`；`W/state/attempt-machine.ts:73–88`。旧断言：`T/state/attempt-machine.test.ts:696–700::project the nodes of §5.1` | 实际兼容的是 **ended Attempt 的 `endOutcome:null`**，不是字段省略：codec `:250–251` 已拒绝 undefined，但允许 null；node 投影把它当 ended_known。当前所有结束构造都写明确结果：`W/state/attempt-machine.ts:310–321`。注释“without endOutcome”与实际测试 `:700` 不一致。 | **change:ended Attempt 要求非 null endOutcome，移除旧 null 结果的投影契约及那一条断言。** claimed/started 的 null 仍保留，正常 known/unknown 状态投影也保留；不删除整个 §5.1 测试。 | D79；当前所有 known outcome 的结果写入：`T/state/attempt-machine.test.ts:568–576::ends with every known outcome and records it on the Attempt`；unknown 投影仍在 `:697–698`。 | 5 | 是，§5.1 投影项 | 高 |

以下 JSON 与上表逐项对应；`file` 为主定位文件，其余关联文件在 `evidence`、`tests`、`covered_by` 中。

```json
[
  {
    "id": "P2a-01",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/plan-record-codecs.ts",
    "lines": "804-818;1005-1020",
    "tests": [
      "tests/work-graph/S5-request-candidates.test.ts:305-341::RC11"
    ],
    "evidence": "旧 PlanProposal@1 被包装成 legacy_v1；当前创建器 src/core/work-graph/state/plan-machine.ts:132-135 只生成 candidate_v2。关联旧类型位于同文件:104-112，旧分支位于 src/core/work-graph/tasks/plan-service.ts:1349,2397,2852-2853,3287 和 tasks/plan-readers.ts:554,633。",
    "action": "delete",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/S5-request-candidates.test.ts:58::RC01",
      "tests/work-graph/S5-request-candidates.test.ts:146::RC04",
      "tests/work-graph/S5-request-candidates.test.ts:175::RC05"
    ],
    "est_lines": 80,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-02",
    "category": "legacy",
    "file": "src/core/work-graph/persistence/plan-record-codecs.ts",
    "lines": "518-522;569-583",
    "tests": [
      "tests/work-graph/W2-future-intent.test.ts:140-164::legacy full v1/v2 without executionIntent still adopts; empty/optional-only legacy shapes are rejected"
    ],
    "evidence": "当前公开入口仍接受 Plan 内容 v1，src/core/work-graph/tasks/plan-commit-compiler.ts:157-162 仍会据输入写 v1；不是没有写入端的死格式。initial-plan.ts:61,77 和 plan-commit-compiler.ts:412 已生成 v2。",
    "action": "change:公开计划入口和编译器统一 v2，再删除 v1 分支；混合测试仅删除 v1 采用部分",
    "covered_by": [
      "tests/work-graph/W2-future-intent.test.ts:116-129::codec: v2 accepts executionIntent; v1, gate and unknown values are rejected",
      "tests/work-graph/W2-future-intent.test.ts:198::initial required plan_only saves without assignment/acceptance/gate and survives a SQLite reopen",
      "tests/work-graph/W2-future-intent.test.ts:350::future refinement preserves the real source and may add explicit intent and a new role"
    ],
    "est_lines": 60,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "P2a-03",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/execution-entry-codecs.ts",
    "lines": "129-149",
    "tests": [
      "tests/work-graph/B2-execution-entry.test.ts:205-213::does not allow a legacy authorization to begin; malformed V2 is rejected by the real Run codec",
      "tests/state/run-machine.test.ts:444-452,1012,1409::旧授权部分"
    ],
    "evidence": "读取 V1 授权和 pre-B2 running Run，并保存 legacyV1 状态。当前授权 writer 为 src/core/work-graph/state/run-machine.ts:861-869 的 V2。删除 legacyV1 类型、投影及专属拒绝；保留新 claimed 和 D7 未入 Kernel 的无绑定状态；保留 B2 测试:214-219 的 malformed V2 部分。",
    "action": "delete",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/B2-execution-entry.test.ts:156-184::fresh begin and replay are distinct; entered uses the real newer binding and Run revisions",
      "tests/work-graph/B2-execution-entry.test.ts:117::SQLite identical authorization race restores the original receipt even after begin and reopen"
    ],
    "est_lines": 60,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-04",
    "category": "old-data",
    "file": "src/core/work-graph/tasks/session-provenance-facts.ts",
    "lines": "1-611",
    "tests": [
      "tests/work-graph/S1-provenance.test.ts:293::SV12",
      "tests/work-graph/S1-provenance.test.ts:338::SV13",
      "tests/work-graph/S1-provenance.test.ts:364::SV14，仅旧来源部分",
      "tests/work-graph/S1-provenance.test.ts:393::SV15",
      "tests/work-graph/S1-provenance.test.ts:415::SV45",
      "tests/work-graph/S1-provenance.test.ts:440::SV46",
      "tests/work-graph/S1-codecs-indexes.test.ts:275::SV01，仅旧 provenance 部分",
      "tests/state/S1-session-archive.test.ts:192::UT09",
      "tests/state/S1-session-archive.test.ts:209::UT10"
    ],
    "evidence": "当前创建操作在 src/core/work-graph/sessions/session-directory.ts:704-733,781-792 规范化并写 provenance；:966-977 仅为旧接受操作保留缺字段。删除整个旧来源推导、:1607-1789 补填实现、state/session-availability.ts:1003-1026 补填状态迁移、model 端口、claim-service.ts:762-775 和 queries/query-execution.ts:930-946 回退，以及 session-facts.ts:272-315、views/work-line-reader.ts:282-310 的旧来源扫描。外区 composition/workflow 接线需同步，未计入行数。",
    "action": "delete",
    "covered_by": [
      "旧补填支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/S1-codecs-indexes.test.ts:454::SV04",
      "tests/work-graph/S1-codecs-indexes.test.ts:485::SV05",
      "tests/work-graph/S1-dispatch-guards.test.ts:45::SV39"
    ],
    "est_lines": 1000,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-05",
    "category": "old-data",
    "file": "src/core/work-graph/tasks/session-facts.ts",
    "lines": "417-440;467-477",
    "tests": [
      "tests/work-graph/S1-session-facts.test.ts:172::SV53"
    ],
    "evidence": "以 lastExecutionRef 补入缺 executionState、没有 Session 索引的旧 QueryRun，并维护 pointerDone 游标。当前 claim 在 src/core/work-graph/queries/query-execution.ts:983-1002 同批保存带 executionState 的 QueryRun 和 Session。删除指针补充合并及例外；pending 未 claim QueryRun 的无 executionState 状态保留。",
    "action": "delete",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/S1-session-facts.test.ts:62::SV06 a real newer Query pointer does not hide the previous Work wait"
    ],
    "est_lines": 45,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-06",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/record-codecs.ts",
    "lines": "718-727;779-783;850-862",
    "tests": [
      "tests/work-graph/A2-step1-codecs.test.ts:557-561::decodes a record written before A.2 as desiredStateRevision 1 and desiredStateRequestedBy null",
      "tests/work-graph/A2-step1-codecs.test.ts:573-579::writes a never-changed Goal in its legacy shape, so a plan adoption keeps the pre-A.2 bytes"
    ],
    "evidence": "当前 encoder 仍主动省略未变化 Goal 的 desiredStateRevision/desiredStateRequestedBy，创建事件重建也省略，decoder 再补 1/null；必须同时修改 writer 和 reader。",
    "action": "change:当前 Goal 创建、重放和编码显式保存两个 desiredState 字段，再删除缺字段默认及 legacyShape 编码",
    "covered_by": [
      "旧字节保持要求由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/A2-step1-codecs.test.ts:564-572::round-trips the three desired states with and without a requester"
    ],
    "est_lines": 35,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2a-07",
    "category": "old-data",
    "file": "src/core/work-graph/views/automatic-rework-notices.ts",
    "lines": "118-174;205-211;255-262;422-434;526-533",
    "tests": [
      "tests/work-graph/S2A-notices-rework.test.ts:37-76::QA-11",
      "tests/work-graph/S5-notices.test.ts:195-212::NR05，仅 legacy 排序部分",
      "tests/work-graph/S5-notices.test.ts:271-283::NR08"
    ],
    "evidence": "接受缺 since 的旧通知及缺 cap 的自动 reverify，扫描 legacy 索引并生成 legacy position。当前 writers：communication/mailbox-service.ts:298-315、tasks/plan-service.ts:1425,3356、tasks/requeue-service.ts:1110-1116、evidence/evidence-service.ts:352-358,1697-1702。联动旧 origin codec、notice-position.ts:47-52、record-codecs.ts:240-245、decision-read-model.ts:1566,1818 和旧 requeue/reverify 索引。",
    "action": "change:通知统一提交位置，删除 legacy origin/position/索引扫描；仅自动 reverify successor 要求 cap，保留提交前 null 占位及合法非自动无 cap",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/S5-notices.test.ts:116-135::NR01",
      "tests/work-graph/S5-notices.test.ts:165-193::NR04",
      "tests/work-graph/S5-notices.test.ts:214::NR06"
    ],
    "est_lines": 200,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-08",
    "category": "old-data",
    "file": "src/core/work-graph/views/track-read-model.ts",
    "lines": "642-650;702;750;769-780",
    "tests": [
      "tests/work-graph/S2B-30-track-bars.test.ts:188-207::2B-30 legacy rounds without since and pre-2B finalized rounds without finalizedAt are only counted in unplaced.rounds"
    ],
    "evidence": "旧 round 缺 since 或已 finalized 却缺 finalizedAt 时只计 unplaced。当前 evidence/evidence-service.ts:352-358,1605 保存创建位置和终结时刻。删除 activity-read-model.ts:480-487 旧扫描和 evidence-record-codecs.ts:745-760 legacy 索引；保留:748,767-771 当前 open round 使用的 UNFINALIZED 索引及 gate unplaced。",
    "action": "change:删除缺时间旧 round 的扫描和计数，当前 finalized round 要求终结时间",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/S2B-30-track-bars.test.ts:154-185::2B-30 check bars carry start/end/result/ordinal/checksBegun and the attributed Session",
      "tests/work-graph/S2B-30-track-bars.test.ts:209::无负责 Session 的 gate round"
    ],
    "est_lines": 65,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-09",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/evidence-record-codecs.ts",
    "lines": "324-326",
    "tests": [
      "tests/work-graph/A2-step1-codecs.test.ts:380-384::a legacy round (no chain, no incompleteCause) still decodes unchanged",
      "tests/state/verification-machine.test.ts:1101,1111::legacy root 部分"
    ],
    "evidence": "缺 chain 的 round 被当作 root/ordinal 1；当前 state/verification-machine.ts:110-112,912-920 创建完整 root chain，:633-670 创建 successor chain。",
    "action": "change:当前 VerificationRound 必须携带 chain，删除缺 chain 当作 root 的分支；保留合法缺 incompleteCause",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/A2-step1-codecs.test.ts:387::a successor round (ordinal 2, Agent reverify) with incompleteCause and a chain root round-trip",
      "tests/work-graph/S5-notices.test.ts:116::NR01",
      "tests/work-graph/S5-notices.test.ts:262-269::NR07"
    ],
    "est_lines": 60,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-10",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/evidence-record-codecs.ts",
    "lines": "436",
    "tests": [
      "tests/work-graph/A2-verification-chain.test.ts:269::VR-10..12: no index row for zero evidence, a legacy @0 row repaired"
    ],
    "evidence": "接受已存 TaskEvidenceIndex@0；state/verification-machine.ts:1036-1059 明确支持后续修复。当前 writer 无新增时不写，有新增时产生正 revision。",
    "action": "change:存储索引要求正 revision，删除 legacy @0 修复契约与测试部分；保留 exists、缺记录 CAS 和零追加不写",
    "covered_by": [
      "旧 @0 修复由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/A2-verification-chain.test.ts:269::VR-10..12 的无记录、正常追加和 CAS 部分保留"
    ],
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-11",
    "category": "old-data",
    "file": "src/core/work-graph/architecture/catalog-record-codecs.ts",
    "lines": "398-409;576-578",
    "tests": [],
    "evidence": "旧 Catalog 可省略 since，解码补 null。当前 architecture/catalog-service.ts:525,707 提供 since，:322-327,756-760 绑定 receipt cursor。未找到专门固定省略 since 的独立断言。",
    "action": "change:Catalog 当前记录必须有 since 键，删除缺键校验分支和补 null；保留事件预绑定 null",
    "covered_by": [
      "tests/work-graph/S8A-catalog-version-time.test.ts:21::binds the revised record to its event cursor so the list shows that event time and reason",
      "tests/work-graph/S8A-catalog-version-time.test.ts:68::returns the bound cursor in the revision write result, equal to the current read"
    ],
    "est_lines": 20,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2a-12",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/note-record-codecs.ts",
    "lines": "120-123;387-390;612-633",
    "tests": [],
    "evidence": "省略 noticeClass、disposition actor/proof 的旧记录或事件被补 null。当前 state/note-machine.ts:296-320 写 noticeClass；notes/note-service.ts:708-710,868,1542-1544 显式写 actor/proof。未找到专门固定旧省略字段的测试。",
    "action": "change:要求 noticeClass、actor、proof 键存在，删除缺键补 null；保留显式 null",
    "covered_by": [
      "tests/work-graph/S4C2-N1.test.ts:33-95::N1 %s: one g1 line with three members and one g2 line with one",
      "tests/work-graph/S4C2-notice-class.test.ts:103-106::显式 null"
    ],
    "est_lines": 25,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2a-13",
    "category": "old-data",
    "file": "src/core/work-graph/queries/query-record-codecs.ts",
    "lines": "447-450",
    "tests": [],
    "evidence": "QueryJob 可缺 submission，queries/query-execution.ts:334-336 后续返回 unsupported。当前 query-job-service.ts:731 和重放:498 均写 submission。query-record-codecs.ts:522 的旧注释不代表事件仍有可选 identity/fingerprint，实际校验见:503-504。",
    "action": "change:当前 QueryJob 必须有 submission，删除旧缺 locator 的延迟 unsupported 分支",
    "covered_by": [
      "tests/work-graph/R5b-query-job.test.ts:137-170::records QueryJob@1 + QueryRun@1 pending, locates the original actor, and replays the same receipt",
      "tests/work-graph/R5b-query-job.test.ts:152-155::submission locator 断言"
    ],
    "est_lines": 8,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2a-14",
    "category": "c1-transfer",
    "file": "src/core/work-graph/views/track-read-model.ts",
    "lines": "224-226",
    "tests": [],
    "evidence": "明确容忍旧游标缺 ca，并转换为 null；当前同文件:908,920,976,988 均写 ca。C1 转交依据为 docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:82。",
    "action": "change:ca 必须为 string 或 null，删除 undefined 到 null 的兼容读取",
    "covered_by": [
      "tests/work-graph/S2B-30-track-bars.test.ts:354::当前 Query 和只读咨询读取",
      "tests/work-graph/S2B-r3-consultation-cap.test.ts:34-63::2B-r3 R3 limit 2 over many later readonly copies stays within the injected cap",
      "覆盖缺口：上述测试只证明首屏产生 next，未找到专门消费该 ca 游标的断言"
    ],
    "est_lines": 3,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2a-15",
    "category": "old-data",
    "file": "src/core/work-graph/materials/applicability.ts",
    "lines": "97",
    "tests": [
      "tests/data/R3b-materials-contract.test.ts:63::reopens the original artifacts table and reads legacy first-owner provenance",
      "tests/data/R3b-materials-contract.test.ts:151::does not infer a Host-readable scope from a legacy record without an owner"
    ],
    "evidence": "旧 origin 分支返回 ownerRunRef。区外 src/core/record-store/body-codec.ts:206-212 负责旧形状读取，:196 拒绝新写伪造 legacy，:239-247 保存当前正式 origin。删除本行须与外区 decoder/type 同步；不涉及当前 Plan legacyArtifactRef。",
    "action": "delete",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/data/R3b-material-admission-boundaries.test.ts:31::lets a Host read its own newly stored platform artifact but keeps project and workspace scope exact",
      "tests/data/R3b-material-admission-boundaries.test.ts:98::binds a Core work_run owner read to the canonical Run workspace as well as its full Run ref"
    ],
    "est_lines": 1,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2a-16",
    "category": "old-data",
    "file": "src/core/work-graph/state/context-input.ts",
    "lines": "225;374;381-383",
    "tests": [
      "tests/work-graph/S3-prepared-context-admission.test.ts:499-508::AD05",
      "tests/work-graph/WP1-goal-content-entry.test.ts:79-85::GE03",
      "tests/state/WP1-goal-content.test.ts:107-117::CG04，仅缺 binding/null digest 部分"
    ],
    "evidence": "旧 manifest 缺 assembly 或 Work Goal digest 为 null 时通过。当前 src/core/agent-runtime/execution-preparation.ts:481-498 获取 binding，context-assembler.ts:1919-1923 写 Goal digest，query-preparation.ts:332,359 获取 Query binding。同步 tasks/execution-entry-service.ts:1040-1065,1129 和 queries/query-execution.ts:1072-1088；保留 rebinding 和其他 Goal source 区分。",
    "action": "change:当前 manifest 必须携带 assembly，Work 匹配 Goal source 不再接受旧 null digest；不把 Work Goal 条件套给 Query",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/S3-prepared-context-admission.test.ts:438::AD01",
      "tests/work-graph/S3-prepared-context-admission.test.ts:531::AD07",
      "tests/work-graph/WP1-goal-content-entry.test.ts:55::GE01",
      "tests/work-graph/WP1-goal-content-entry.test.ts:63::GE02",
      "tests/work-graph/WP1-goal-content-entry.test.ts:99::GE05"
    ],
    "est_lines": 25,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "P2a-17",
    "category": "legacy",
    "file": "src/core/work-graph/communication/mailbox-service.ts",
    "lines": "2034;2049-2067;2095;2147",
    "tests": [
      "tests/app/orchestration-mechanism.test.ts:181::normalizes the legacy replyMode=wait into the same single wait path"
    ],
    "evidence": "replyMode=wait 仍是可调用输入并规范化为正式三个字段。src/core/agent-runtime/communication-tools.ts:319,417 仍暴露该输入；src/core/work-graph/state/message-machine.ts:1202 仍写该字段，不能单删 reader。",
    "action": "change:调用方统一 intent/needsReply/waitAfterSend 后删除 replyMode 别名和存储冗余，同步工具及 UI/workflow",
    "covered_by": [
      "tests/app/orchestration-mechanism.test.ts:169::persists explicit intent/needsReply/waitAfterSend and registers exactly one real wait",
      "tests/app/orchestration-mechanism.test.ts:208::persists and reads back intent/needsReply/waitAfterSend through the real service",
      "tests/app/orchestration-mechanism.test.ts:189::never registers a wait for a plain fire-and-forget notice"
    ],
    "est_lines": 60,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2a-18",
    "category": "c1-transfer",
    "file": "src/core/work-graph/model/claim-contracts.ts",
    "lines": "92-107",
    "tests": [
      "tests/state/attempt-machine.test.ts:705-711::DispatchOutboxRecord is the TaskClaimOutbox record of claim-contracts.ts"
    ],
    "evidence": "与 src/core/work-graph/state/attempt-machine.ts:64-70 重复声明 outbox。TaskDispatchStateV1 当前仍用于重复形状和 persistence/execution-entry-codecs.ts:39,45 的导入/再导出。C1 转交依据为 docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:86,93-94。",
    "action": "change:TaskClaimOutbox 复用 DispatchOutboxRecord，再删除多余 TaskDispatchStateV1 别名和再导出；保留真实 DispatchStateV1",
    "covered_by": [
      "tests/state/attempt-machine.test.ts:705-711::现有类型互赋测试",
      "src/core/work-graph/state/attempt-machine.ts:327-353::当前 V1/V2 dispatch 写入均保留"
    ],
    "est_lines": 20,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2a-19",
    "category": "old-data",
    "file": "src/core/work-graph/views/undelivered-reply-notices.ts",
    "lines": "343-348",
    "tests": [
      "tests/work-graph/WP2-undelivered-notices.test.ts:221-273::M05 old data missing a position blocks only its Goal; a damaged position is refused，仅旧数据部分"
    ],
    "evidence": "旧 unavailable Session 和已回复 work_run 消息可分别缺 unavailableSince/responseSince，mailbox-service.ts:3299-3309 保留缺位 DTO，通知源给专属 incomplete。当前 state/session-availability.ts:397,455-457 和 state/message-machine.ts:1252,1313 写占位，communication/mailbox-service.ts:306-307 绑定回复游标。",
    "action": "change:按状态要求当前游标，删除旧缺位 DTO 和 position_missing 分支；保留其他状态合法缺省、预绑定 null 和现有一致性检查",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/work-graph/WP2-undelivered-notices.test.ts:113::F09",
      "tests/work-graph/WP2-undelivered-notices.test.ts:127::F09",
      "tests/work-graph/WP2-undelivered-notices.test.ts:147::F10",
      "tests/work-graph/WP2-undelivered-notices.test.ts:166::F12"
    ],
    "est_lines": 25,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2a-20",
    "category": "old-data",
    "file": "src/core/work-graph/tasks/claim-record-codecs.ts",
    "lines": "241-251",
    "tests": [
      "tests/state/attempt-machine.test.ts:696-700::project the nodes of §5.1，仅 ended/null 断言"
    ],
    "evidence": "实际接受的是 ended Attempt 的 endOutcome:null；字段缺失已经被:250-251 拒绝。state/attempt-machine.ts:73-88 把旧 null 投影成 ended_known；当前结束构造:310-321 总写明确结果。",
    "action": "change:ended Attempt 要求非 null endOutcome，移除旧 null 投影契约和单条断言；保留 claimed/started 的 null",
    "covered_by": [
      "旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销",
      "tests/state/attempt-machine.test.ts:568-576::ends with every known outcome and records it on the Attempt",
      "tests/state/attempt-machine.test.ts:697-698::当前 known/unknown 节点投影"
    ],
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  }
]
```

**分类合计：**

| 类别 | 项数 | 预计涉及本区生产代码行数 |
|---|---:|---:|
| old-data | 16 | 1,659 |
| legacy | 2 | 120 |
| c1-transfer | 2 | 23 |
| allowlist-kept-for | 0 | 0 |
| allowlist-pre-batch | 0 | 0 |
| allowlist-wire-format | 0 | 0 |
| n0 | 0 | 0 |
| **合计** | **20** | **1,802** |

以下命中项经过写入端核对，**没有列为删除候选**：

- **`DispatchStateV1` 不是过时格式。** 当前 entered、正常 settled 仍写 V1，not-entered settled 写 V2，见 `src/core/work-graph/state/attempt-machine.ts:327–353`。P2a-18 只处理重复类型声明和别名。
- **新 Session 的若干缺省字段仍是当前格式。** 创建器不写 healthConclusion、archiveRequest，见 `src/core/work-graph/state/session-availability.ts:329–345`。因此不能把 `session-record-codecs.ts:714–719,741–744` 的对应可选性与旧 provenance 一起删。
- **未配置 Goal/Workspace 设置仍是当前合法状态。** 创建 Goal 快照没有 settings，见 `src/core/work-graph/persistence/record-codecs.ts:850–862`；读取默认值由 `:799–812` 提供。仅凭注释写“old record”不能判定这整套默认机制已经无当前用途。
- **`legacyArtifactRef` 目前仍参与正式输入声明。** 当前 context-input service 从 Plan inputRequirements 生成它，见 `src/core/work-graph/tasks/context-input-service.ts:364–377`；编译器也保留该输入结构，见 `src/core/work-graph/tasks/plan-commit-compiler.ts:157–162`。它与 P2a-15 的旧材料 origin 是两件事。
- **`legacy_template` 按任务明确排除。** 当前 Query claim 仍匹配该角色绑定，见 `src/core/work-graph/queries/query-execution.ts:970–975`，不能因名字含 legacy 删除。
- **授权事件缺 `activePlanRef` 是当前条件语义。** 仅 `carried_unchanged` 时写该字段，见 `src/core/work-graph/tasks/execution-entry-service.ts:1464–1468`；类型说明见 `src/core/work-graph/persistence/execution-entry-codecs.ts:653–659`。`tests/work-graph/A2-step1-codecs.test.ts:764–772` 两种形状仍有意义。
- **咨询缺 `derivation` 不全是旧 Query。** 当前 response 路径明确不使用派生 Session，并按条件构造 consultation，见 `src/business/workflow/consultation.ts:363–365,453–457`。因此不能直接删 `src/core/work-graph/queries/query-execution.ts:907–909` 的整个缺 derivation 分支。
- **receipt replay 的可选 identity 仍服务当前 Note 事件。** 原因及处理见 `src/core/work-graph/tasks/receipt-replay.ts:13–16,40–46,114–119`；当前 Note 事件形状见 `src/core/work-graph/persistence/note-record-codecs.ts:64–90`。没有把它当作只剩旧数据的兼容层。
- **ObservedArchitecture 的旧 chunk/body 兼容已经收紧。** 当前 chunk/body 检查见 `src/core/work-graph/architecture/architecture-record-codecs.ts:291,317,490`；metadata 的 schemaVersion 1 是另一层当前 envelope，见 `:541,566`，不是应统一改成 2 的旧分支。
- **N0、goal_cause、planning_question 不在这里顺手处理。** 本区未形成 N0 删除项；决定 85-4 明确保留两个手写业务形状，见 `docs/refactor/HANDOFF.md:683`。

**覆盖范围与未定事项：**

本区清单共 **215 个文件：214 个 TypeScript、1 个 README**。按目录计数为：根目录 2、architecture 10、communication 4、configuration 9、evidence 2、materials 5、model 23、notes 15、persistence 17、queries 4、sessions 12、state 29、tasks 65、views 18。

对这 215 个文件进行了逐文件头部/导出扫描，以及版本、旧格式、缺字段、legacy/compat/migration 等关键词扫描；对命中的生产调用链、writer、codec 和相关测试分段深入读取。**没有把这种扫描称为 215 个文件全部逐行通读。**

完整读过的本区文件是：

- `src/core/work-graph/tasks/session-provenance-facts.ts:1–611`
- `src/core/work-graph/tasks/receipt-replay.ts:1–123`
- `src/core/work-graph/materials/applicability.ts:1–105`
- `src/core/work-graph/views/notice-position.ts:1–80`
- `src/core/work-graph/model/claim-contracts.ts:1–169`
- `src/core/work-graph/model/task-contracts.ts:1–112`
- `src/core/work-graph/views/README.md:1–3`

其余 **208 个本区文件**属于扫描或分段阅读；重点深入范围就是表格中的 codec、状态迁移、owner 和 read-model 行段。区外文件用于核对 writer、接线或测试，没有将其视为完成了相邻区域盘点。另完整读过短测试 `tests/work-graph/S2B-r3-consultation-cap.test.ts:1–64`；其他测试主要按命中场景读取。

需要 lead 在收口时明确的事项：

1. **P2a-02、P2a-17 仍有当前调用入口，P2a-06 仍有当前旧形状 writer。** 它们必须成组修改，不适合先删 reader 再等调用方追上。
2. **P2a-14 的 Query/copy 游标续页覆盖未证实。** 现有首屏、非空 next 和 Run 分页不能冒充该覆盖；本次没有为此新增或运行测试。
3. **P2a-11、12、13 没找到专门固定缺字段旧形状的独立断言。** 这不等于相关夹具完全不依赖缺字段；实施时应由现有测试入口暴露需转换的夹具，不能预先宣称可整文件删除。
4. **P2a-16 的 Work/Query 要分别收紧。** 当前两者都有 assembly writer，但 Goal digest 判断属于 Work；rebinding 也不是旧数据兼容。
5. 只看到“旧 baseline 无 catalog”说明的 `src/core/work-graph/architecture/catalog-service.ts:586`，以及“旧 source 无 goalBases”的 `src/core/work-graph/views/decision-read-model.ts:1172`，本次没有充分证明其全部缺字段路径已没有当前用途，**未给出删除结论，也未计入合计**。
6. P2a-04 的 SV14、P2a-07 的 NR05、P2a-10 的 VR-10..12、P2a-19 的 M05、P2a-20 的 §5.1 都是混合测试。应仅移除被决定 79 废止的旧格式部分；冻结表项的其余业务断言继续保留。

**关于打开旧库时统一提示“请重建”：仅列方案，不代作决定。**

目前物理 schema 检查只验证表、列、主键及可插入性，见 `src/core/record-store/migrations.ts:102–139`；初始化先执行建表，再检查，见 `:147–153`。它不能统一识别“物理表一样，但 JSON 记录来自旧产品格式”的数据库。SQLite 打开后还会初始化 schema、调整 lookup 索引及 text scan，见 `src/core/record-store/sqlite-record-store.ts:132,157–166`。本次在该打开链及 `user_version/application_id` 检索中未发现产品级存储格式门槛。

| 方案 | 行为及落点 | 取舍 |
|---|---|---|
| 保持逐记录拒绝，不增加库级标记 | 各 owner/codec 只接受当前格式；首次读到不兼容记录时返回错误。 | 改动最少，但旧库可能先打开成功，直到某个功能读取才失败；也不能仅凭一个非法记录就可靠判断“这是旧版本库”，它可能是损坏。 |
| 增加产品级存储格式标记，打开时统一拒绝 | 使用独立格式整数，例如 `PRAGMA user_version` 或明确的元数据记录；新空库初始化标记，非空无标记或版本不兼容的库拒绝打开，提示重新建立开发数据。检查应位于连接建立后、schema/index/text-scan 初始化前，即 `src/core/record-store/sqlite-record-store.ts:132–158` 之间的初始化阶段，并沿现有 `:170–176` 关闭连接、传播错误。 | 提示最早、最明确，不需要保留逐版本 reader。需要定义“产品格式版本”与各记录 schemaVersion 的关系；不能把旧非空库在打开时直接盖成当前版本。 |
| 打开时扫描并校验现存记录 | 在启动阶段用当前 schema registry 检查已有数据，发现不兼容时阻止启动并给汇总提示。 | 无须单靠版本整数，但启动成本随数据量增加；仍难区分旧格式和损坏，也不能可靠表达未体现在某条记录上的格式变化。它是校验，不是迁移。 |

若选择库级方案，还要在平台组装层明确两份存储的对应关系：`ledger.sqlite` 与 `artifacts.sqlite` 分别在 `src/composition/create-platform.ts:678,685` 打开。不能只检查 ledger 就宣称整套存储兼容。

用户可见提示可沿启动失败出口呈现；目前 CLI 在 `src/app/main.ts:209–213` 将此类异常统称为 `workbench configuration rejected`。若需要专门的重建提示，应识别明确的“不兼容存储格式”错误，而不是把所有配置、I/O 或数据损坏错误都改写为旧库提示。以上三个方案均不需要自动删除、自动迁移或自动重建已有库。