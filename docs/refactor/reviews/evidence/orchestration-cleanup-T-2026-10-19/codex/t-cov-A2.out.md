已完成只读核查；未写文件，未运行测试或构建。

**76 行全部列出：75 行可定类，A2-049 待定。** 另有 A2-006、021、022、034 的“具体哪项 T 改动导致覆盖消失”尚未闭环，已在 A 栏明确标出，不据此判 T 误删。

为压缩重复路径，下文使用这些明确的路径别名：

- `S/`＝`D:/cxt/t-docs/tree/src/core/work-graph/`
- `T/`＝`D:/cxt/t-docs/tree/tests/`
- `B/`＝`D:/cxt/t-inv/tests/`
- `E/`＝`D:/cxt/t-docs/evidence/books/`
- `EP`＝`E/t-items-TP.md`；`EQ`＝`E/t-items-TQ.md`；`E1`＝`E/t-items-T1-w2.md`；`E2`＝`E/t-items-T2-w2.md`；`E3`＝`E/t-items-T3-w2.md`
- `SC`＝`S/sessions/session-record-codecs.ts`；`WL`＝`S/views/work-line-reader.ts`；`ND`＝`S/views/node-detail-reader.ts`；`TR`＝`S/views/track-read-model.ts`；`EV`＝`S/evidence/evidence-service.ts`

表中的 **P01—P12** 是表后给出的具体补测步骤。`if/0` 等保留清单的分支类型和 arm 编号。

| row | path:line_after | kind | class | reason（file:line） | proposal | T 前测试及 T 条目 |
|---|---|---|---|---|---|---|
| A2-001 | S/architecture/catalog-record-codecs.ts:223 | if/0 | U | 摘要与正文不符；正常采用由同一写者计算摘要并提交目录、基线和指针（S/architecture/catalog-service.ts:518、547）。 | 保留当前格式完整性校验，不补篡改测试。 | `B/work-graph/A1-session-lifecycle.test.ts:112`，digest-inconsistent；TQ-110 删除，TQ-105 删除专用夹具（EQ:711、674）。 |
| A2-002 | S/architecture/catalog-service.ts:393 | if/0 | U | 读到不可解码的基线；正常采用原子写入合法基线及指针（S/architecture/catalog-service.ts:520、547）。 | 保留存储解码失败出口，不测篡改。 | `B/work-graph/A1-architecture-catalog.test.ts:179`，missing/digest/readable 中的损坏子段；TQ-110（EQ:712）。 |
| A2-003 | S/architecture/catalog-service.ts:804 | if/0 | G | 此处涵盖正常的“尚未采用目录”；没有 active 指针直接返回 not_found（S/architecture/catalog-service.ts:373、804）。 | P01：补未采用目录时关联模块。 | `B/work-graph/A1-session-lifecycle.test.ts:112`；TQ-110 删除的是损坏目录测试，删除理由成立，但同一出口还承载正常缺目录行为（EQ:712）。 |
| A2-004 | S/communication/mailbox-service.ts:1338 | if/0 | U | running Run 配上缺失或其他持有者的 Lease；读取使用同一个最终窗口，真实结束先被 running 检查挡住（S/tasks/run-state-service.ts:485；S/communication/mailbox-service.ts:1329）。 | 删除此重复身份防御；保留上游完整执行链校验。 | `B/work-graph/C1-session-mailbox.test.ts:355`，formal lease successor；T1-015，手改 Lease 持有者（E1:114）。 |
| A2-005 | S/communication/mailbox-service.ts:1344 | if/0 | U | running 且同持有者 Lease 已释放，需破坏真实结束的原子写入；正常结束连同 Lease/Session 更新提交（S/state/attempt-machine.ts:719、804；S/tasks/execution-entry-service.ts:1940）。 | 删除 released Lease 的重复防御，不恢复手改 Lease 测试。 | `B/work-graph/C1-session-mailbox.test.ts:467`，released same-owner Lease；T1-014（E1:106）。 |
| A2-006 | S/communication/mailbox-service.ts:3262 | if/0 | F | 真实 retired Session 会查询接续索引，后端可返回失败（S/communication/mailbox-service.ts:3249、3254、3262）。 | P02：退役后读未送达回复，注入该索引失败。 | **归因待定**。已定位低预算测量候选 `B/work-graph/S2C-lines-scale.test.ts:146`／T1-039（E1:259），但尚不能证明它命中此 lookup；需原始逐测试覆盖或调用记录。 |
| A2-007 | S/configuration/role-memory-service.ts:92 | if/0 | U | 回放事件 actor 与命令身份不符；安装、激活均用命令身份构造幂等键（S/configuration/role-memory-service.ts:132、135）。 | 保留事件回放的身份完整性检查，不补篡改测试。 | `B/work-graph/R3g-role-spec.test.ts:506`，另一 actor 的回放；T1-028（E1:166）。 |
| A2-008 | S/configuration/role-memory-service.ts:253 | if/0 | U | 安装回放的 actor 不一致，是同一事件篡改路径（S/configuration/role-memory-service.ts:92、132、253）。 | 保留回放拒绝出口，不测篡改。 | `B/work-graph/R3g-role-spec.test.ts:527` 的 eventAt 改写及安装调用；T1-028（E1:169）。 |
| A2-009 | S/configuration/role-memory-service.ts:289 | if/0 | U | 激活回放的 actor 不一致，同上；与 running Role 热切换无关（S/configuration/role-memory-service.ts:92、135、289）。 | 保留回放拒绝出口，不新增热切换生命周期测试。 | `B/work-graph/R3g-role-spec.test.ts:539`；T1-028（E1:169）。 |
| A2-010 | S/configuration/role-memory-service.ts:669 | if/0 | U | active policy 指针内容不可解码；旧测试用宽松 schema 手造损坏治理记录（B/work-graph/R3g-role-spec.test.ts:346；S/configuration/role-memory-service.ts:668）。 | 保留治理记录解码拒绝，不补改库测试。 | `B/work-graph/R3g-role-spec.test.ts:341`，absence vs corrupt governance；T1-028（E1:169）。 |
| A2-011 | S/configuration/role-memory-service.ts:680 | if/0 | U | 指针指向不存在的 policy；跨读取窗口已先检查水位一致，不把真实并发误当缺记录（S/configuration/role-memory-service.ts:675、678、680）。 | 保留悬空引用拒绝，不测篡改。 | 同一测试的 dangling pointer 子段，`B/work-graph/R3g-role-spec.test.ts:381`；T1-028（E1:169）。 |
| A2-012 | S/configuration/role-record-codecs.ts:115 | if/0 | U | 持久化 CoordinationPolicy 引用形状错误；由治理记录解码调用该检查（S/configuration/role-record-codecs.ts:114、208、260）。 | 保留当前格式校验，不补篡改测试。 | `B/work-graph/R3g-role-spec.test.ts:381`，损坏治理引用；T1-028（E1:169）。 |
| A2-013 | S/configuration/role-record-codecs.ts:261 | if/0 | U | activeRevision 非合法 policy 引用；旧例直接写 null（B/work-graph/R3g-role-spec.test.ts:395；S/configuration/role-record-codecs.ts:260）。 | 保留当前格式校验，不测篡改。 | `B/work-graph/R3g-role-spec.test.ts:395`；T1-028（E1:169）。 |
| A2-014 | S/configuration/role-record-codecs.ts:286 | if/0 | U | 向调用方传播上述治理记录解码失败（S/configuration/role-record-codecs.ts:286）。 | 保留解码失败传播，不测篡改。 | `B/work-graph/R3g-role-spec.test.ts:341`；T1-028（E1:169）。 |
| A2-015 | S/evidence/evidence-service.ts:142 | function/incomplete | U | 用于非法轮次链或超界链；当前根轮次抢占唯一 slot，后继也受链上限约束（S/state/verification-machine.ts:637、1545；EV:585、1200）。 | 保留非法链的失败出口，不恢复无 slot 的旧链测试。 | `B/work-graph/A2-verification-chain.test.ts:170`，legacy slot-less second root；TP-140（EP:1030）。 |
| A2-016 | S/evidence/evidence-service.ts:310 | if/1 | U | 缺 since 是旧形状；新轮次写 since 占位并绑定提交游标，更新保留它（EV:310、347、352、358）。 | 删除缺 since 兼容，并统一要求当前轮次来源有 since。 | `B/work-graph/S2B-activity-calendar.test.ts:215` 的 openLegacyRound 子段（:235）；TP-157（EP:1158）。 |
| A2-017 | S/evidence/evidence-service.ts:625 | cond-expr/1 | U | 正常已有链返回 busy 且附 head pin；不附 pin 的 invalid-chain 路径来自损坏链（S/state/verification-machine.ts:1220；EV:1104、625）。 | 若保留非法链拒绝，则保留此无 pin 出口、不补篡改测试。 | `B/work-graph/A2-verification-chain.test.ts:180`；TP-140（EP:1030）。 |
| A2-018 | S/evidence/evidence-service.ts:1200 | switch/1 | U | queryRoundChainHead 的 invalid 分支；当前 slot 写者防止双根、分叉（S/state/verification-machine.ts:1535、1545）。 | 保留非法链拒绝，不恢复旧链夹具。 | `B/work-graph/A2-verification-chain.test.ts:180`；TP-140（EP:1030）。 |
| A2-019 | S/materials/applicability.ts:59 | if/0 | U | 当前 owner 写 Run/QueryRun 或 platform_operation；**不能声称类型已排除**：底层仍接受 TaskAttempt 来源（S/materials/material-service.ts:151；`D:/cxt/t-docs/tree/src/core/record-store/body-codec.ts:160`）。 | 清除无人写入的 TaskAttempt/无可用 owner 兼容后删此 guard；不恢复旧正文。 | `B/data/R3b-materials-contract.test.ts:151`，legacy ownerless body；TQ-098（EQ:622、624）。 |
| A2-020 | S/materials/record-readers.ts:202 | if/0 | U | 已存 executionHistory 定位器非法；旧例把 observedThroughPosition 改为 0（B/work-graph/R4c-execution-history-index.test.ts:768）。 | 保留定位器解码失败边界，不补改库测试。 | `B/work-graph/R4c-execution-history-index.test.ts:763`；T1-032，写者与 codec 拒绝非法值（E1:204、207）。 |
| A2-021 | S/notes/note-service.ts:633 | if/1 | G | 同锚点、同 topic 的多个 current note 可共存；遍历到更旧记录时不替换当前最新值（S/notes/note-service.ts:622、628、633）。 | P03：固定 ID/遍历顺序，补“旧记录后被读到”。 | **归因待定**：`B/work-graph/S4A-note-history.test.ts:396` 的 N18 此部分仍在；T1-042/043 删除的是其他用例（E1:286、294）。需逐测试覆盖确认，不能硬归给删除项。 |
| A2-022 | S/notes/note-service.ts:634 | binary-expr/1 | G | 左侧“时间更晚”为假时，正常进入时间相等比较；不是异常状态（S/notes/note-service.ts:633、634）。 | P03。 | 同 A2-021：N18 `B/work-graph/S4A-note-history.test.ts:396` 保留；T 归因待定。 |
| A2-023 | S/sessions/session-record-codecs.ts:785 | if/0 | U | 已存记录 schemaId 非当前 SessionWorkLink schema；旧例改返回记录的 schema（B/work-graph/S2C-lines-failure.test.ts:178；SC:785）。 | 保留当前 schema 边界，不补篡改测试。 | `B/work-graph/S2C-lines-failure.test.ts:173`，undecodable responsible link；T1-038 的 B4 部分（E1:250）。 |
| A2-024 | S/sessions/session-record-codecs.ts:1032 | if/0 | U | 向上层传播同一 work-link 解码失败（SC:1032）。 | 保留失败传播，不测篡改。 | 同一 B4 测试，`B/work-graph/S2C-lines-failure.test.ts:173`；T1-038（E1:250）。 |
| A2-025 | S/sessions/session-targets.ts:141 | if/1 | F | 模块事实读取可返回 rejected，既不是 ready 也不是 not_found（S/sessions/session-targets.ts:139、141、147）。 | P01：目录记录读取失败。 | `B/work-graph/A1-session-lifecycle.test.ts:112`；TQ-110 原来通过损坏目录命中，删篡改理由成立（EQ:712）。 |
| A2-026 | S/sessions/session-targets.ts:144 | if/1 | F | 同一 rejected 结果继续穿过 not_ready 判断并传播（S/sessions/session-targets.ts:144、147）。 | P01：同一故障例覆盖。 | 同 A2-025，`B/work-graph/A1-session-lifecycle.test.ts:112`；TQ-110（EQ:712）。 |
| A2-027 | S/views/activity-read-helpers.ts:182 | if/1 | G | claim 后、prepare/进入前没有 executionHistory；可从派工记录取得 Session，日历 openRuns 路径会调用它（S/views/activity-read-helpers.ts:182、183；S/views/activity-read-model.ts:429、431）。 | P04：真实 claim 后直接读日历。 | `B/work-graph/S2B-activity-calendar-tasks.test.ts:171` 的无 history/位置读取；TP-156 删旧 Run 子段、保留真实 Run（EP:1151、1153）。 |
| A2-028 | S/views/activity-read-model.ts:345 | if/0 | U | RunActivity 的 sessionRef 缺失；当前结束写者从 history 或 claim 写入 Session（S/tasks/execution-entry-service.ts:1926）。 | 删除旧活动“Session 不可归属”兼容计数。 | `B/work-graph/S2B-activity-calendar-tasks.test.ts:146`，unknown claiming Session；TP-156（EP:1151）。 |
| A2-029 | S/views/activity-read-model.ts:367 | if/1 | U | counted 活动缺 Session，同一旧活动来源；当前结束提交带 Session 归属（S/tasks/execution-entry-service.ts:1926、1942）。 | 同 A2-028，简化为有归属的计数。 | `B/work-graph/S2B-activity-calendar-tasks.test.ts:146`；TP-156（EP:1153）。 |
| A2-030 | S/views/activity-read-model.ts:402 | if/0 | D2 | claimingSessionOf 已不返回 null：history、派工成功时返回 Session，否则抛失败（S/views/activity-read-helpers.ts:182、187、190）。 | 删除 null 臂并收窄返回类型；保留失败传播。 | `B/work-graph/S2B-activity-calendar-tasks.test.ts:171`；TP-156，加 T1-036 将缺派工改为失败（EP:1154；E1:231、237）。 |
| A2-031 | S/views/activity-read-model.ts:496 | if/0 | U | 活动所指 Session 属于别的 workspace；真实 claim 先拒绝跨 workspace Session（S/tasks/claim-service.ts:998），结束沿 claim 写归属（S/tasks/execution-entry-service.ts:1926）。 | 保留跨域拒绝边界，不补改库测试。 | `B/work-graph/S2B-r4-session-workspace.test.ts:63`，calendar foreign Session；T3-089（E3:746）。 |
| A2-032 | S/views/goal-conflicts.ts:267 | cond-expr/1 | D2 | 当前 executed-files owner 的 ready 结果只返回 available；失败直接返回拒绝（S/tasks/goal-executed-files-reader.ts:203、206）。 | 收窄该 ready 结果，删除 not_available 臂。 | `B/work-graph/S5-decision-queue.test.ts:43、91`，DQ01 的 not_available 替身；T3-103（E2:532、535）。 |
| A2-033 | S/views/goal-conflicts.ts:413 | function/anonymous_30 | D2 | 无目录却已有执行文件；当前 Plan 采用先要求治理/架构，缺架构先拒绝（S/tasks/plan-service.ts:1679；S/tasks/plan-readers.ts:817）。 | 删除 architecture=null 下对非空 files 的映射；保留无目录、无执行的正常空结果。 | `B/work-graph/S2B-34-executed-files.test.ts:194`，“no catalog adopted”；TP-108 将共享 fixture 改为真实 adopt（EP:791、794）。 |
| A2-034 | S/views/graph-context-reader.ts:1367 | if/0 | F | 图中有执行引用后，独立 readExecution 可遇到存储失败（S/views/graph-context-reader.ts:1363、1366）。 | P05：在 execution read seam 注入拒绝。 | **归因待定**：旧执行包装见 `B/work-graph/S3-graph-context.test.ts:689`；TP-163 改共享世界（EP:1201），但尚未定位具体命中此臂的旧测试，不能把 GR14 直接认作答案。 |
| A2-035 | S/views/node-detail-reader.ts:1387 | if/1 | U | 异常锚点指向不存在的 Session，成功装配得到空 brief；旧替身硬填 `s1`，并未创建该 Session（B/work-graph/S2C-node-detail-anomalies.test.ts:30、100）。 | 保留缺引用防御，不恢复伪造锚点。 | `B/work-graph/S2C-node-detail-anomalies.test.ts:97`，task anomaly facts；T1-040 改真实锚点（E1:268、276）。 |
| A2-036 | S/views/node-detail-reader.ts:1393 | binary-expr/1 | F | 解析/装配线失败时 map 为空，正常保留异常项并返回 line:null（ND:1383、1389、1393）。 | P06：真实锚点＋Session/接续读取失败。 | 旧 `B/work-graph/S2C-node-detail-anomalies.test.ts:112` 通过缺 Session 命中；T1-040 改真实事实（E1:276），删除伪造理由成立。 |
| A2-037 | S/views/node-detail-reader.ts:1394 | cond-expr/0 | F | 上述 line:null 需要携带读失败原因（ND:1389、1394）。 | P06：同时断言项保留及 problem。 | 同 A2-036，`B/work-graph/S2C-node-detail-anomalies.test.ts:112`；T1-040（E1:276）。 |
| A2-038 | S/views/task-state-timeline.ts:330 | cond-expr/0 | U | 缺 since 只来自旧轮次；新建轮次必绑定 since（EV:352、358）。 | 删除缺 since 回退，并与来源 codec 约束一起收紧。 | `B/work-graph/S2B-33-task-timeline-pagination.test.ts:98`；TP-155（EP:1144）。 |
| A2-039 | S/views/task-state-timeline.ts:331 | cond-expr/0 | G | **open 轮次合法地没有 finalizedAt**；codec 区分 open 与 finalized（S/persistence/evidence-record-codecs.ts:318、334）。 | P07：开轮次后不定案读 timeline。 | `B/work-graph/S2B-33-task-timeline-pagination.test.ts:109` 的 open round；TP-155 将“无 finalizedAt”一概按旧形状解释，理由范围错误（EP:1145、1147）。 |
| A2-040 | S/views/task-state-timeline.ts:402 | if/1 | G | open 轮次应只有 check_start，没有 check_end（S/views/task-state-timeline.ts:401、402）。 | P07：断言 open 轮次没有 check_end。 | 同一 open round，`B/work-graph/S2B-33-task-timeline-pagination.test.ts:109`；TP-155（EP:1147）。 |
| A2-041 | S/views/track-read-model.ts:157 | function/constructor | U | ForbiddenError 用于内部归属冲突；真实 claim 拒绝跨 workspace Session（S/tasks/claim-service.ts:998；TR:1078、1180）。 | 保留跨域拒绝及专用错误类型，不补篡改测试。 | `B/work-graph/S2B-r4-session-workspace.test.ts:44`，track foreign Session；T3-089（E3:746）。 |
| A2-042 | S/views/track-read-model.ts:293 | if/1 | G | ActivityRecording 已存在是正常状态，公开 ensureActivityRecording 可创建（T/helpers/S2B-track-fixture.ts:436）。 | P08：先开启 recording，再读 track。 | `B/work-graph/S2B-r2-r5-not-entered.test.ts:54、56`；最终整删依据 W2b-57／T1-036（E/t-w2b-findings.md:132）。 |
| A2-043 | S/views/track-read-model.ts:295 | if/1 | G | 正常 ActivityRecording 可以成功解码（TR:294、296；T/helpers/S2B-track-fixture.ts:438）。 | P08。 | 同一有 recording 例，`B/work-graph/S2B-r2-r5-not-entered.test.ts:54`；W2b-57／T1-036（E/t-w2b-findings.md:132）。 |
| A2-044 | S/views/track-read-model.ts:319 | binary-expr/0 | U | 已结束、不能证明未进入，却没有活动记录；正常 Runtime/重启收敛产生活动并随结束提交（`D:/cxt/t-docs/tree/src/core/agent-runtime/run-reconcile.ts:303`；S/tasks/run-reconcile-service.ts:725、734）。 | 删除旧“已结束但无活动”的回退；保留当前 in_progress/not_entered 路径。 | `B/work-graph/S2B-r2-r5-not-entered.test.ts:54、70` 的 raw Run；W2b-57／T1-036（E/t-w2b-findings.md:132）。 |
| A2-045 | S/views/track-read-model.ts:319 | binary-expr/1 | U | 同一缺活动旧状态，进入 endedAt 与 recording epoch 比较（TR:303、312、319）。 | 同 A2-044。 | `B/work-graph/S2B-r2-r5-not-entered.test.ts:54、70`；W2b-57（E/t-w2b-findings.md:132）。 |
| A2-046 | S/views/track-read-model.ts:319 | cond-expr/0 | U | 同一旧状态的 not_recorded 结果；不是正常 recording 创建行为（TR:318、319；S/tasks/run-reconcile-service.ts:734）。 | 同 A2-044。 | `B/work-graph/S2B-r2-r5-not-entered.test.ts:54`；W2b-57（E/t-w2b-findings.md:132）。 |
| A2-047 | S/views/track-read-model.ts:319 | cond-expr/1 | U | 同行条件表达式仍依赖“已结束而缺活动”的旧前提（TR:303、309、312、319）。 | 同 A2-044。 | `B/work-graph/S2B-r2-r5-not-entered.test.ts:54、70`；W2b-57（E/t-w2b-findings.md:132）。 |
| A2-048 | S/views/track-read-model.ts:319 | cond-expr/1 | U | 虽清单未给同列条件表达式的 column，但此处两种定位都处于相同旧数据回退内（TR:318、319）。 | 同 A2-044；无需为区分此行的表达式恢复测试。 | `B/work-graph/S2B-r2-r5-not-entered.test.ts:54、70`；W2b-57（E/t-w2b-findings.md:132）。 |
| A2-049 | S/views/track-read-model.ts:647 | binary-expr/1 | **待定** | 同行有 `since ?? null` 和 `finalizedAt ?? null`；前者 U，后者 open 轮次为 G。清单没有 column/branch ID（TR:647；lists/list-A2.tsv:50）。 | 提供该行原始 coverage branchMap 的 loc/column 后定类；暂不删。 | 缺字段旧例 `B/work-graph/S2B-30-track-bars.test.ts:188` 被 TP-154 删除；但当前 open 轮次例 :154 仍在（EP:1137、1139），不足以唯一定位。 |
| A2-050 | S/views/track-read-model.ts:1078 | if/0 | U | 读取的 Session 与 workspace 冲突；真实 claim 前置拒绝此绑定（S/tasks/claim-service.ts:998）。 | 保留跨域拒绝，不测篡改。 | `B/work-graph/S2B-r4-session-workspace.test.ts:44、46`；T3-089（E3:746）。 |
| A2-051 | S/views/track-read-model.ts:1111 | cond-expr/1 | G | 非空 recording epoch 可由公开 owner 创建（T/helpers/S2B-track-fixture.ts:436；TR:1111）。 | P08。 | `B/work-graph/S2B-r2-r5-not-entered.test.ts:54、56`；W2b-57／T1-036（E/t-w2b-findings.md:132）。 |
| A2-052 | S/views/track-read-model.ts:1176 | if/1 | F | catch 中非 Capacity 错误也包括真实 Store 读取失败，并继续映射拒绝（TR:1176、1181）。 | P08 的故障变体：recording/Run 读取失败。 | `B/work-graph/S2B-r4-session-workspace.test.ts:44` 原以 ForbiddenError 命中；T3-089 删篡改正确，IO 路径另补（E3:746）。 |
| A2-053 | S/views/track-read-model.ts:1180 | if/0 | U | 特指内部跨域记录导致的 ForbiddenError，不等于上一行所有非容量失败（TR:1078、1180）。 | 保留权限失败映射，不补改库测试。 | `B/work-graph/S2B-r4-session-workspace.test.ts:44`；T3-089（E3:746）。 |
| A2-054 | S/views/undelivered-reply-notices.ts:271 | if/0 | G | 合法通知属于其他 Goal 时 project 返回 null，外层跳过（S/views/undelivered-reply-notices.ts:330、271）。 | P09：当前格式通知的跨 Goal 过滤。 | `B/work-graph/WP2-undelivered-notices.test.ts:257`，M05 otherGoal；TP-172 连这一段删除，范围过大（EP:1270）。 |
| A2-055 | S/views/undelivered-reply-notices.ts:330 | if/0 | G | Goal 过滤不依赖旧数据缺位置，当前合法消息也会被过滤（S/views/undelivered-reply-notices.ts:330）。 | P09。 | 同一 M05 otherGoal 子段，`B/work-graph/WP2-undelivered-notices.test.ts:257`；TP-172（EP:1270）。 |
| A2-056 | S/views/undelivered-reply-notices.ts:473 | if/0 | G | kind 非 commit 已被前置挡住，但**合法 commit 形状＋错误 itemKey 前缀**仍由公开输入到达该 if（S/views/undelivered-reply-notices.ts:461、473、483）。 | P10：保留前缀检查，删重复 kind 判断；补错误前缀 cursor。 | `B/work-graph/WP2-undelivered-notices.test.ts:442、446`，M08 legacy cursor；TP-063 改为 kind:unknown，正确迁掉旧格式，但新输入被更早拒绝（EP:457、462）。 |
| A2-057 | S/views/work-line-reader.ts:300 | if/1 | G | node summary 接受额外 Session 引用；不存在的引用可装配为 not_found 而被跳过（ND:1199、1200；WL:346）。 | P11：公开请求不存在的 Session 节点。 | `B/work-graph/S2C-node-detail-anomalies.test.ts:30、112` 的不存在 `s1`；T1-040 改真实锚点（E1:276）。 |
| A2-058 | S/views/work-line-reader.ts:346 | if/0 | G | 与上一行同一路径：调用方提供不存在的 Session，readSession 正常返回 null（WL:632；ND:1199）。 | P11。 | `B/work-graph/S2C-node-detail-anomalies.test.ts:30、112`；T1-040（E1:276）。 |
| A2-059 | S/views/work-line-reader.ts:367 | binary-expr/1 | F | Session 读取与 holder Run 读取分开；真实结束可夹在其中，产生临时不一致（WL:344、361、1071）。 | P12：门控读窗口，真实结束后触发一次重读。 | `B/work-graph/S2C-lines-failure.test.ts:186`，T5x；T1-038 称只能改读回内容，理由错误（E1:252）。 |
| A2-060 | S/views/work-line-reader.ts:367 | if/0 | F | 上述真实竞态满足 inconsistentOccupancy 且尚未重读（WL:364、367）。 | P12：验证重读恢复。 | 同一 T5x，`B/work-graph/S2C-lines-failure.test.ts:186`；T1-038（E1:250、252）。 |
| A2-061 | S/views/work-line-reader.ts:368 | binary-expr/0 | F | 进入真实重读路径便求值 historyReadBudget（WL:367、368）。 | P12：使用现有 reader budget 配置。 | 同一 T5x，`B/work-graph/S2C-lines-failure.test.ts:186`；T1-038（E1:250）。 |
| A2-062 | S/views/work-line-reader.ts:368 | binary-expr/1 | F | 重读时未显式配置预算就取默认值；依赖定义本就可选（WL:102、368）。 | P12：不传 historyReadBudget 的变体。 | 同一 T5x，`B/work-graph/S2C-lines-failure.test.ts:186`；T1-038（E1:250）。 |
| A2-063 | S/views/work-line-reader.ts:493 | cond-expr/0 | F | 一次重读仍可能再次撞上真实结束；代码只重读一次，随后报告 source_moving（WL:367、369、493）。 | P12：同 Session 两个不同任务的 Run，分别在两次读窗口内结束。 | 同一 T5x，`B/work-graph/S2C-lines-failure.test.ts:186、195`；T1-038（E1:252）。 |
| A2-064 | S/views/work-line-reader.ts:621 | cond-expr/1 | U | 已存 link schema/正文无法解码，返回 null（WL:619、621；SC:785）。 | 保留失败桥接，不恢复坏 schema 测试。 | `B/work-graph/S2C-lines-failure.test.ts:173、178`，B4；T1-038（E1:250）。 |
| A2-065 | S/views/work-line-reader.ts:632 | if/0 | G | 对不存在的 Session 作公开读取会得到明确缺失；readWorkLine 返回 not_found（WL:628、632、3064、3067）。 | P11：不存在的 Session 详情/节点。 | `B/work-graph/S2C-node-detail-anomalies.test.ts:30、112` 的缺失引用；T1-040（E1:276）。 |
| A2-066 | S/views/work-line-reader.ts:649 | binary-expr/1 | D2 | current 先经 Session 解码；codec 已拒绝缺失/null provenance（WL:633、657；SC:736）。 | 删 `?? null` 及相应 null 分支，直接判断 kind。 | `B/work-graph/S2C-lines-d1.test.ts:32` 的旧 L；TP-161、TP-062 收紧非空 provenance（EP:1187、454）。 |
| A2-067 | S/views/work-line-reader.ts:683 | binary-expr/1 | D2 | chainEntry 输入同样来自已解码 Session（WL:642、657、667；SC:736）。 | 直接写 session.provenance，收窄 DTO。 | 同旧 L，`B/work-graph/S2C-lines-d1.test.ts:32`；TP-161／TP-062（EP:1187、454）。 |
| A2-068 | S/views/work-line-reader.ts:721 | if/0 | U | 当前 schema 的损坏 link 被 decodeLink 拒绝，须防止静默丢责任（WL:619、721、724）。 | 保留 B4 失败报告，不补篡改测试。 | `B/work-graph/S2C-lines-failure.test.ts:173`；T1-038 的 B4 部分（E1:250）。 |
| A2-069 | S/views/work-line-reader.ts:1299 | binary-expr/1 | D2 | active Session 输入经解码；null provenance 先被拒绝（WL:1593、1594；SC:736）。 | 删除 null 回退及多余可选访问。 | `B/work-graph/S2C-lines-d1.test.ts:32` 的旧 L；TP-161／TP-062（EP:1187、454）。 |
| A2-070 | S/views/work-line-reader.ts:1517 | binary-expr/1 | D2 | cycle walk 的 candidates 和读入前驱都经 Session 解码（WL:1490、1524；SC:736）。 | 删除 provenance 缺省分支，保留真正的环检测。 | `B/scenarios/S2C-K-legacy-provenance.test.ts:437`，before maintenance；TP-122／TP-062（EP:896、454）。 |
| A2-071 | S/views/work-line-reader.ts:1601 | binary-expr/1 | D2 | active 数组只加入 decoded Session（WL:1593、1594；SC:736）。 | 直接判断 provenance.kind。 | `B/work-graph/S2C-lines-d1.test.ts:32`；TP-161／TP-062（EP:1187、454）。 |
| A2-072 | S/views/work-line-reader.ts:1616 | binary-expr/1 | D2 | listActiveHeads 消费同一已解码 active window（WL:1610、1615；SC:736）。 | 直接判断 provenance.kind。 | `B/work-graph/S2C-lines-d1.test.ts:32`；TP-161／TP-062（EP:1187、454）。 |
| A2-073 | S/views/work-line-reader.ts:1627 | binary-expr/1 | D2 | nonCopies 过滤的也是同一已解码 window.sessions（WL:1612、1627；SC:736）。 | 删除 null 回退，保留非 copy 过滤。 | `B/work-graph/S2C-lines-d1.test.ts:32`；TP-161／TP-062（EP:1187、454）。 |
| A2-074 | S/views/work-line-reader.ts:1663 | binary-expr/1 | D2 | archived 页在该行前已成功 decodeSessionRecord（WL:1660、1661；SC:736）。 | 直接判断 provenance.kind。 | `B/scenarios/S2C-K-legacy-provenance.test.ts:437` 的 archived rows；TP-122／TP-062（EP:896、454）。 |
| A2-075 | S/views/work-line-reader.ts:1774 | if/1 | U | 此处直接统计缺 provenance 的存储索引，**未经过 Session 解码**；当前创建者总生成或验证 provenance（WL:1751、1752、1768；S/sessions/session-directory.ts:704、708、710）。 | 删除 null-kind 两次统计及 legacy partial 返回，简化 archived 计数。 | `B/work-graph/S2C-lines-d1.test.ts:38` 的 legacy partial；TP-161 改为 exact（EP:1188）。 |
| A2-076 | S/views/work-line-reader.ts:2322 | binary-expr/1 | D2 | 执行列表链从已解码 head/前驱读取；codec 拒绝缺 provenance（WL:2309、2330；SC:736）。 | 删除 null 回退，保留链长度上限和读取失败。 | `B/work-graph/S2C-lines-page.test.ts:394` 的 legacy Session executions；TP-162 改当前 Session，保留索引语义（EP:1194、1197）。 |

补测方案中的公开步骤和已有 seam 如下；这些是改法，**本次没有执行**：

| 方案 | 公开步骤、故障注入及归属测试 |
|---|---|
| **P01：目录正常缺失／读取失败** | G：创建 Session，尚未 adopt 架构时调用 `linkSessionWork(module)`，验证 not_found 映射。F：先正常 adopt，再仅让目录记录读取返回 unavailable。沿现有生命周期调用补入 `T/work-graph/A1-session-lifecycle.test.ts`；复用按 key 匹配的 `failingReadMany`，不改返回记录正文（S/sessions/session-targets.ts:139；T/helpers/S2C-L-line-support.ts:552；B/work-graph/A1-session-lifecycle.test.ts:116）。 |
| **P02：未送达回复索引故障** | 真实发送、等待、退役来源 Session、接收回复，再调用 mailbox 的未送达回复读取；仅令 `SESSION_BY_PROVENANCE_LOOKUP` 返回 unavailable。现有步骤在 `T/work-graph/WP2-undelivered-notices.test.ts:39、48`；现有 `failingLookup` 在 `T/helpers/S2C-L-line-support.ts:522`；目标查询在 S/communication/mailbox-service.ts:3254。 |
| **P03：同 topic 的记录顺序** | 同锚点依次创建 Alpha、允许共存的 alpha，再创建另一个 topic 触发 existingTopics；用 fixture 的 `noteNewId` 固定索引顺序，使较旧记录后被遍历，断言最新显示名称不回退。补入 N18 所在 `T/work-graph/S4A-note-history.test.ts:396`；注入入口已有 `T/helpers/S4A-note-fixture.ts:107、156`，无需改库。 |
| **P04：已领取、尚未进入的活动归属** | 创建 Goal/Plan/Session，真实 claimTask，暂不 prepare/start，调用日历读取；验证从派工记录归属 Session。补入 `T/work-graph/S2B-activity-calendar-tasks.test.ts` 的 2B-26；实际读取路径是 S/views/activity-read-model.ts:429、431，派工回退在 S/views/activity-read-helpers.ts:183。 |
| **P05：图上下文执行读取失败** | 真实采用计划、claim 出图中执行引用，调用 `readContextFacts(focusTaskIds)`；仅在它调用 execution reader 时返回 unavailable。补入 `T/work-graph/S3-graph-context.test.ts`；已有独立 `executions.readExecution` 包装可作为 seam（:747、750），目标传播在 S/views/graph-context-reader.ts:1366。 |
| **P06：异常列表的线读取失败** | 沿真实暂停→重启收敛→归档产生锚点，再读 `readNodeDetail(section:'anomalies')`；只对 Session key 的读取注入失败，断言异常项仍在、line:null、problem 有原因。真实转换案例在 `T/work-graph/S2C-node-detail-anomalies.test.ts:90`；records 注入口在 `T/helpers/S2C-D-node-support.ts:702、707`，故障 wrapper 在 `T/helpers/S2C-L-line-support.ts:552`。 |
| **P07：尚未定案的轮次** | 真实 claim→Runtime start/finish→openVerification，**不调用 finalizeChecks**，随后读 timeline；断言 check_start、verifying 状态以及没有 check_end。补入 `T/work-graph/S2B-31-task-timeline-main.test.ts:20`；真实 Runtime gate/start/finish 已有 `T/helpers/S2B-runtime-steps-fixture.ts:367、424`；目标分流在 S/views/task-state-timeline.ts:401、402。 |
| **P08：recording 与 track 故障** | G：调用 `ensureActivityRecording` 后读 `readTrackBars`，覆盖存在且解码成功的 epoch。F：同一公开读取，仅对 ActivityRecording/Run key 注入 unavailable，验证非 Capacity 错误传播。归入 `T/work-graph/S2B-30-track-bars.test.ts`；公开 recording helper 在 `T/helpers/S2B-track-fixture.ts:436`，故障 wrapper 在 `T/helpers/S2C-L-line-support.ts:552`，catch 在 TR:1176。 |
| **P09：当前通知的 Goal 过滤** | 创建 Goal A/B；用真实 wait→退役→回复为 A 产生带完整位置的通知；以 B 过滤读取应为空，不过滤应包含 A。补入 `T/work-graph/WP2-undelivered-notices.test.ts`，复用 :39、48 的当前步骤；过滤位置在 S/views/undelivered-reply-notices.ts:330。 |
| **P10：错误 cursor 前缀** | 取得合法提交位置，构造 scope/envelope 合法、kind=commit、itemKey 前缀错误的输入 cursor；调用 readPage，断言 invalid。补到现有 M08，`T/work-graph/WP2-undelivered-notices.test.ts:395`；目标检查在 S/views/undelivered-reply-notices.ts:473。这是公开输入校验，不是改库。 |
| **P11：不存在的 Session 引用** | 创建合法 Goal，向 node summary 提交本 workspace 中不存在的 SessionRef；另直接调用 readWorkLine 同一引用。前者经过 extraSessions 装配，后者返回 not_found。补入现有 node detail 测试 `T/work-graph/S2C-node-detail-task.test.ts:21`；生产调用路径 ND:1199、1200，WL:3064、3067。 |
| **P12：真实结束跨读窗口** | 使用现有 A3 wrapper：先保存真实 Session 读取结果，在返回该结果前通过 Runtime gate 完成 Run，再原样返回旧快照；下一次 Run 读取看到 ended，触发重读。A2-063 再用同 Session 的另一任务 Run，在第二次 Session/Run 读取之间完成，得到 source_moving。归入 `T/work-graph/S2C-lines-failure.test.ts`；现有“读取后执行真实提交、原样返回”模式在 :198、204、216；真实 start/finish 在 `T/helpers/S2B-runtime-steps-fixture.ts:367、424`；两次独立读取在 WL:344、1071。 |

分类计数如下，合计与清单 76 行一致（`lists/list-A2.tsv:2` 至 `:77`；逐行分类见上表）：

| class | 数量 |
|---|---:|
| D1 走不到 | 0 |
| D2 不会发生 | 12 |
| U 只有篡改才会发生 | 36 |
| F 外部故障 | 12 |
| G 公开步骤能到、没测 | 15 |
| N 不适用 | 0 |
| 待定 | 1 |
| **合计** | **76** |

**针对 T 的发现有三项，共涉及 9 行。**

1. **T1-038：把真实读窗口竞态误判成只能篡改触发。** 涉及 **A2-059—063**。原理由明确说 T5x 只能改读回内容到达，但 reader 先读 Session、后读 Run，真实结束能夹在两者之间；一次重读也不能排除第二次真实结束。因此应执行 **P12**，用真实 Runtime 结束替换旧 `endedRunRead`，保留重读和持续移动两种断言。依据：E1:250、252；WL:344、367、493、1071；旧测试 `B/work-graph/S2C-lines-failure.test.ts:186`。

2. **TP-155：“总写 finalizedAt”的理由覆盖了合法 open 轮次。** 涉及 **A2-039、040**。无 since 的旧轮次应删除，但 open 轮次本来没有 finalizedAt；原测试还包含一个 open round，整删后这一当前状态的 timeline 分支失去覆盖。恢复方式是 **P07**：真实结束 Run→openVerification→不定案→读 timeline，不能恢复 seedRoundRaw。依据：EP:1145、1147；`B/work-graph/S2B-33-task-timeline-pagination.test.ts:109`；S/persistence/evidence-record-codecs.ts:318、334；S/views/task-state-timeline.ts:402。

3. **TP-172：删除范围连带移除了当前 Goal 过滤行为。** 涉及 **A2-054、055**。缺位置旧数据的删除理由成立，但 `otherGoal` 过滤并不依赖缺位置；应把这个断言迁到当前格式事实，执行 **P09**。这属于删改范围错误，不要求恢复 M05 的旧记录。依据：EP:1270、1272；`B/work-graph/WP2-undelivered-notices.test.ts:257`；S/views/undelivered-reply-notices.ts:330。

其他 F/G 行没有仅凭“旧测试删后失去覆盖”就判 T 理由错误。例如 TQ-110 删除损坏目录测试、T3-089 删除跨 workspace 改库测试，各自理由仍成立；需要补的是这些出口另有的真实 IO/正常公开路径（EQ:712、714；E3:746、748；表中 A2-003、025、026、052）。

**L-2 与本清单没有直接命中的 guard 行。** `ref/t-end-list.md:22—25` 列的是 `provenNotEnteredKernel`、plan-readers 过滤、T1-061/062 guards、physical-removal 检查及 B-03 后置复查。本组唯一 activity-read-helpers 行是 **A2-027，G**，它是 `claimingSessionOf` 的 history 缺失分支；`provenNotEnteredKernel` 实际定义在 `D:/cxt/t-docs/tree/src/contracts/run-activity.ts:91`，本组没有该定义或 TR:312 的调用行。**A2-044—048 为 U**，是该调用之后的旧活动缺失回退，不能算作 L-2 那个 guard 已经完成裁定（`lists/list-A2.tsv:28`；S/views/activity-read-helpers.ts:182；TR:312、319）。