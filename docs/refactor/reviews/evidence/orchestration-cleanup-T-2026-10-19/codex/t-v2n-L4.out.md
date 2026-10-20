按**表项**计数：同一文件、同一来源和判定的调用合并，行号全部列出。`v2 允许`只裁定所列输入，不表示整份测试符合其他规则；依据 `.lead-ref/books/test-rule-sheet-v2.md:24`、`:30`、`:32`。普通输入、原有拒绝用例以及存储层以上手写记录不另列。

为缩短重复路径，下表使用这些简称：

- **P**：`plans.proposePlan`，随后需要应用时调用 `applyPlanChange`；路由绑定见 `src/app/core-routes.ts:388`、`:389`。
- **G**：完整计划草稿及公开 propose→apply，见 `tests/helpers/AG2b-collaboration-fixture.ts:372`、`:461`、`:464`。
- **T**：完整计划草稿及 propose→apply，见 `tests/helpers/task-claim-fixture.ts:323`、`:344`、`:350`；后续有非公开步骤，见该文件`:367`、`:370`。
- **B**：第二份完整计划及 propose→apply，见 `tests/helpers/B2-execution-fixture.ts:151`、`:160`、`:163`。
- **S**：A/B/C 初始计划及 U1/U2 候选，见 `tests/helpers/S5-decision-fixture.ts:723`、`:738`、`:744`、`:938`、`:946`、`:947`；后续非全公开，见该文件`:851`。
- **K**：完整扩展计划，见 `tests/helpers/K3-review-card-fixture.ts:108`、`:122`、`:128`。
- **E**：完整 R3e 计划，见 `tests/helpers/R3e-evidence-fixture.ts:194`、`:209`、`:216`。
- **活／轨／轴／线**：完整草稿及公开 propose→apply，分别见 `tests/helpers/S2B-activity-fixture.ts:354`、`:364`、`:372`；`tests/helpers/S2B-track-fixture.ts:271`、`:281`、`:288`；`tests/helpers/S2B-task-timeline-fixture.ts:284`、`:295`、`:302`；`tests/helpers/S2C-L-line-support.ts:315`、`:334`、`:341`。
- **N**：完整计划及公开 propose→apply，见 `tests/helpers/S4A-note-fixture.ts:204`、`:222`、`:225`；后续非全公开，见该文件`:239`、`:242`。

**1．A1 草稿及外部对象**

“完整；非全公开”表示该草稿满足真实入口契约、提案和应用走公开入口，但整个夹具或后续测试还有内部步骤。

| 编号 | 文件及行号 | owner、值、契约及后续 | 判定 |
|---|---|---|---|
| A01 | `tests/app/A2-automation-verdict.test.ts:99、:179、:198` | P；G；完整，继续公开 Workflow 和读取 | v2 允许 |
| A02 | `tests/app/A2-continuation-projection.test.ts:70、:73` | `send_session_message`；`:73`在执行前补入`:77`公开创建的 recipient；`:81`继续真实 Workflow | v2 允许 |
| A03 | `tests/app/A2-continuation-projection.test.ts:76` | P；G；完整，继续公开步骤 | v2 允许 |
| A04 | `tests/app/A2-requeue-route.test.ts:48` | P；G；完整，继续公开步骤 | v2 允许 |
| A05 | `tests/app/A2-reverify-route.test.ts:53` | P；G；完整，继续公开步骤 | v2 允许 |
| A06 | `tests/app/AG2-consultation.test.ts:309` | `project_source`；完整 read 参数；`:345`继续真实咨询链 | v2 允许 |
| A07 | `tests/app/AG2b-collaboration.test.ts:164、:165、:167、:169、:387、:388、:390、:484、:485、:487` | `find_related_sessions/read_session_card/send_session_message`；执行前补齐 target、sessionRef、recipient，例见`:185、:196、:206、:216`；真实工具和公开 driver 继续 | v2 允许 |
| A08 | `tests/app/AG2b-collaboration.test.ts:254、:418、:520` | P；G；完整，继续公开步骤 | v2 允许 |
| A09 | `tests/app/K3-15-review-routes.test.ts:74` | P；T+B+S+K；完整；非全公开 | v2 允许 |
| A10 | `tests/app/R6-host.test.ts:324` | P；`:186`完整 `planDraft()`；`:329`使用提案返回值应用，`:333`公开读取 | v2 允许 |
| A11 | `tests/app/R6-host.test.ts:673` | `project_source`；完整 read 参数；继续公开 Query/Workflow，见`:747、:780、:817` | v2 允许 |
| A12 | `tests/app/RL-34-wiring-resource-caps.test.ts:89、:130、:142、:205` | P；T，`:142`另经 B+E；完整；非全公开 | v2 允许 |
| A13 | `tests/app/RL-34-wiring-resource-caps.test.ts:119、:131` | `run_readonly_command`；完整 `{command:'ls'}`，由`:122、:134`进入工具；`:29`另有底层 sandbox 替身，不能据此豁免 F4 | v2 允许 |
| A14 | `tests/app/S0-attention-edge-label.test.ts:166` | P；`:138`完整草稿，`:174`公开应用 | v2 允许 |
| A15 | `tests/app/S1-session-routes.test.ts:187` | P；经 `tests/scenarios/harness.ts:1020`调用 G；完整；本文件`:262`读 ledger，后续非全公开 | v2 允许 |
| A16 | `tests/app/S2A-decision-routes.test.ts:52` | P；T+B+S；完整；非全公开 | v2 允许 |
| A17 | `tests/app/S2B-35-activity-routes.test.ts:125、:138、:140` | P；T+B+轨+轴；完整；非全公开 | v2 允许 |
| A18 | `tests/app/S2B-41-decision54-backfill-bound.test.ts:144` | P；T；完整；非全公开 | v2 允许 |
| A19 | `tests/app/S2B-backfill-host.test.ts:66、:133` | P；T+B+活；完整；非全公开 | v2 允许 |
| A20 | `tests/app/S2B-backfill-workflow.test.ts:107、:172、:222、:279、:321、:341` | P；T+B+活；完整；非全公开 | v2 允许 |
| A21 | `tests/app/S2B-be2-late-evidence-activity.test.ts:47` | P；T；完整；非全公开 | v2 允许 |
| A22 | `tests/app/S2B-be2-run09-activity.test.ts:38、:62` | P；T；完整；非全公开 | v2 允许 |
| A23 | `tests/app/S2B-be2-run18-activity.test.ts:35` | P；T；完整；非全公开 | v2 允许 |
| A24 | `tests/app/S2B-be2-run23-activity.test.ts:56` | P；T；完整；非全公开 | v2 允许 |
| A25 | `tests/app/S2B-be2-startup-reconcile-activity.test.ts:46、:81、:114、:149` | P；T；完整；非全公开 | v2 允许 |
| A26 | `tests/app/S2B-r2-backfill-done-cursor.test.ts:134` | P；T+B+活；完整；非全公开 | v2 允许 |
| A27 | `tests/app/S2B-r2-backfill-identity.test.ts:61` | P；T+B+活；完整；非全公开 | v2 允许 |
| A28 | `tests/app/S2B-r2-backfill-probe-first.test.ts:62` | P；T；完整；非全公开 | v2 允许 |
| A29 | `tests/app/S2B-r2-backfill-real-kernel.test.ts:77、:115` | P；T；完整；非全公开 | v2 允许 |
| A30 | `tests/app/S2B-r2-backfill-revision-race.test.ts:49、:84` | P；T+B+活；完整；非全公开 | v2 允许 |
| A31 | `tests/app/S2B-r2-r6-probe-verdicts.test.ts:36` | P；T；完整；非全公开 | v2 允许 |
| A32 | `tests/app/S2C-line-routes.test.ts:155、:182、:276、:277` | P；T；`:277`另经“线”创建计划；完整；非全公开 | v2 允许 |
| A33 | `tests/app/S4C-note-routes.test.ts:55、:90、:122、:156、:186` | P；N；完整；非全公开 | v2 允许 |
| A34 | `tests/app/S4C-note-routes.test.ts:65、:68、:126、:136、:159、:191` | `notes.writeNote`；`:28、:32、:37`构造完整 NoteDraft；`:71、:147、:196`公开读取；N 夹具非全公开 | v2 允许 |
| A35 | `tests/app/S4C-record-note-host.test.ts:132` | P；G；`:125`修改 assignment 后才发送，草稿仍完整；随后公开应用 | v2 允许 |
| A36 | `tests/app/S4C-record-note-host.test.ts:141、:204` | `record_note`；完整工具参数；`:175、:231`公开 notes/list | v2 允许 |
| A37 | `tests/app/S4C2-scribe-reminders.test.ts:62、:79、:81、:84、:87、:100、:102、:210、:256、:528、:574、:643、:753、:866` | `notes.writeNote`；`:47、:53`完整 general/understanding 草稿，经 `tests/helpers/S4A-note-fixture.ts:282`转发；本文件`:566`等后续非全公开 | v2 允许 |
| A38 | `tests/app/S4C2-scribe-reminders.test.ts:73、:96、:201、:244、:521、:720、:832、:858、:885` | P；N；完整；非全公开 | v2 允许 |
| A39 | `tests/app/S5-decision-routes.test.ts:137` | `plans.proposePlan`；`:135`为 `draft:{}`；`:132`替身给固定结果，`:138`继续；不满足真实完整契约 | F1 |
| A40 | `tests/app/S5-decision-routes.test.ts:168、:281` | P；`:168`为 T+B+S，`:281`为 G；完整；整文件非全公开 | v2 允许 |
| A41 | `tests/app/S5R2-driver-safe-point.test.ts:28` | P；T+B+S；完整；非全公开 | v2 允许 |
| A42 | `tests/app/exploration-tools.test.ts:31、:37、:43、:48、:53、:56、:60、:68、:75、:76` | `list_files/search/symbols`；完整分支参数；`:25`的 cast 在 ToolCall 包装上；继续真实工具返回 | v2 允许 |
| A43 | `tests/app/goal-fan-out-driver.test.ts:43` | P；T；完整；非全公开 | v2 允许 |
| A44 | `tests/app/orchestration-mechanism.test.ts:171、:183` | `send_session_message`；`:138`替身只记录参数，`:140`无条件返回手造 message；没有验证真实 recipient/发送契约 | F1 |
| A45 | `tests/app/orchestration-mechanism.test.ts:201、:286、:339、:414` | P；`:201`为 T，其余为 G；完整；整文件非全公开 | v2 允许 |
| A46 | `tests/app/orchestration-mechanism.test.ts:215、:417` | `send_session_message`；`:213`完整参数，`:221`公开读；`:417`执行前填真实 recipient；`:201`夹具非全公开 | v2 允许 |
| A47 | `tests/app/project-source-tool.test.ts:156、:164、:181、:183、:184、:189、:191、:193、:195、:196、:199、:200、:205、:228、:234、:235、:236、:238、:239、:256、:268、:285、:292、:301、:302、:308、:309、:322、:334` | `project_source`；capture/query/verify/release 参数；`:137`包装 cast 不代替分支校验。`:238、:239`为真实字段的错配拒绝；`:269`另查内部导出，非全公开 | v2 允许 |
| A48 | `tests/app/reviewer-source-tools.test.ts:44、:52、:55、:58、:65、:72` | `read_source/list_files/search/symbols`；完整参数，`:36`仅包装 cast；真实工具，`:65、:72`检查真实文件变化 | v2 允许 |
| A49 | `tests/state/invariants-fuzz.test.ts:78、:81、:95、:97` | P；G、T+B+E，以及 `tests/scenarios/support/fuzz.ts:1840、:2228、:2703、:2741`；草稿字段构造见该 helper`:2018`；完整，后续有内部 world 核对 | v2 允许 |
| A50 | `tests/state/invariants-fuzz.test.ts:81` | `send_session_message`；`tests/scenarios/support/fuzz.ts:695`完整参数；后续非全公开 | v2 允许 |
| A51 | `tests/state/invariants.test.ts:204、:379` | P；本文件`:134`完整草稿→`:204`提案→`:207`应用；`:379`另经 T；`:244`内部 world 核对，非全公开 | v2 允许 |

**2．A1 平台签发字段**

本表的共享来源：

- **策略 G/T/S/E/N**：均原样使用真实安装返回的 `contentDigest`，分别见 `tests/helpers/AG2b-collaboration-fixture.ts:446、:451`；`tests/helpers/task-claim-fixture.ts:252、:259`；`tests/helpers/S5-decision-fixture.ts:647`；`tests/helpers/R3e-evidence-fixture.ts:180、:182`；`tests/helpers/S4A-note-fixture.ts:187、:190`。接收 owner 为 `completionPolicies.activateCompletionPolicy`，见 `src/app/core-routes.ts:375`。
- **token G**：真实 Host 页面读取后原样转发，见 `tests/helpers/AG2b-collaboration-fixture.ts:263、:339、:354`。
- **token L**：真实 Host 页面返回值，见 `tests/app/support/S8A-L8-host.ts:150、:152、:161、:168`。
- **next A2**：公开 Workflow 返回的 next 原样推进，见 `tests/helpers/A2-restart-fixture.ts:89、:106`。
- **重算活／重算轨轴**：分别在 `tests/helpers/S2B-activity-fixture.ts:415`、`tests/helpers/S2B-runtime-steps-fixture.ts:184`重新调用 `completionPolicyContentDigest`；没有使用安装返回值。这两种均为 F1。

| 编号 | 文件及行号 | 字段、owner 与来源 | 判定 |
|---|---|---|---|
| B01 | `tests/app/A2-automation-verdict.test.ts:55、:62、:67、:73、:82、:89、:99、:179、:180、:198、:199、:240、:243` | 策略 G；Host token G；Workflow/startRun 的 prepared 经 next A2 原样推进 | v2 允许 |
| B02 | `tests/app/A2-continuation-projection.test.ts:49、:76、:77、:81` | 策略 G；Host token G；prepared 经 next A2 | v2 允许 |
| B03 | `tests/app/A2-requeue-route.test.ts:48、:51、:61、:65、:74、:88、:95、:98` | 策略 G；Host token G；prepared 经 next A2 | v2 允许 |
| B04 | `tests/app/A2-reverify-route.test.ts:53、:56、:71、:80、:93、:100、:108` | 策略 G；Host token G；prepared 经 next A2 | v2 允许 |
| B05 | `tests/app/A2-runtime-capabilities.test.ts:89` | Host token；来自本文件`:81`真实页面 | v2 允许 |
| B06 | `tests/app/AG2-consultation.test.ts:166、:172、:518、:591` | Host token G；`runtime.startQuery.prepared`来自`:513、:586`，在`:519、:592`原样使用 | v2 允许 |
| B07 | `tests/app/AG2b-collaboration.test.ts:102、:112、:123、:131、:250、:254、:256、:262、:264、:268、:269、:284、:286、:294、:300、:304、:336、:350、:365、:418、:420、:425、:426、:428、:436、:438、:444、:520、:522、:526、:541、:543、:549、:559、:561` | 策略 G；Host token G；`:294`经 `tests/helpers/AG2b-collaboration-fixture.ts:552、:558`原样转交真实 Query prepared | v2 允许 |
| B08 | `tests/app/K-R-runtime-capabilities.test.ts:66` | Host token；来自`:58`真实页面 | v2 允许 |
| B09 | `tests/app/K3-15-review-routes.test.ts:74、:128、:166` | 策略 T/S；startRun prepared 经 `tests/helpers/K3-35-continuation-fixture.ts:481、:491、:501`真实准备后原样使用 | v2 允许 |
| B10 | `tests/app/MVP-ui-entry.test.ts:98` | Host token；来自`:85`真实页面 | v2 允许 |
| B11 | `tests/app/MVP-workbench-tools.test.ts:91、:96、:112` | `workbench.saveFile.expectedRevision`；来自`:87、:111`直接调用 vendor `WorkspaceSandbox.read`，没有经过平台公开读取步骤；平台入口绑定见 `src/app/core-routes.ts:392` | F1 |
| B12 | `tests/app/R6-host.test.ts:141、:149、:308、:373、:753、:762、:770、:794、:817、:874、:905` | Host token 来自`:133、:400`及 token G；策略摘要`:306→:309、:791→:795`；source capture 指纹`:356→:374`；Query prepared`:747→:752`；材料 bodyRef 摘要`:766→:771`；Workflow next`:824→:817`；历史 cursor`:883→:874、:912→:905`，均原样使用 | v2 允许 |
| B13 | `tests/app/R6-host.test.ts:457、:478` | `runtime.createSession.role.pin.digest`；`:425`测试签发 `'a'.repeat(64)`，`:441`装入请求，`:460`期待 completed；并非真实角色安装返回 | F1 |
| B14 | `tests/app/RL-34-wiring-resource-caps.test.ts:89、:110、:122、:130、:134、:142、:196、:205、:222` | 策略 T/E；prepared 来自`:193、:218`及 `tests/helpers/S2B-be1-platform-fixture.ts:303、:305`的真实准备链，原样启动 | v2 允许 |
| B15 | `tests/app/RL-44-host-restart-resource-caps.test.ts:77` | Host token；`:71`读取真实页面后转发 | v2 允许 |
| B16 | `tests/app/S0-attention-edge-label.test.ts:111` | 策略摘要；`:102`安装→`:112`原样使用 `contentDigest` | v2 允许 |
| B17 | `tests/app/S1-session-routes.test.ts:187、:195` | 策略 G；`:193`返回 next→`:195`原样使用；Host token 为真实启动返回实例的 token，转发见 `tests/scenarios/harness.ts:1089` | v2 允许 |
| B18 | `tests/app/S2A-decision-routes.test.ts:52、:97` | 策略 T/S；`decisions.queryDecisionQueue.cursor`来自`:89`前页返回，`:107`更新 | v2 允许 |
| B19 | `tests/app/S2B-35-activity-routes.test.ts:97、:103` | Host TOKEN；`:52`测试常量，`:161、:170`注入 server，再由`:97、:103`发送 | F1 |
| B20 | `tests/app/S2B-35-activity-routes.test.ts:125、:138、:278、:290` | 基础策略 T；后两处 Host token 来自`:208`真实页面 | v2 允许 |
| B21 | `tests/app/S2B-35-activity-routes.test.ts:125、:138` | `activateCompletionPolicy.target.digest`；重算轨轴 | F1 |
| B22 | `tests/app/S2B-41-decision54-backfill-bound.test.ts:144、:181、:241` | 策略 T；startRun prepared 来自`:178、:238`真实准备，原样传入 | v2 允许 |
| B23 | `tests/app/S2B-backfill-host.test.ts:66、:133` | 基础策略 T 的返回摘要 | v2 允许 |
| B24 | `tests/app/S2B-backfill-host.test.ts:66、:133` | 活动策略 `target.digest`；重算活 | F1 |
| B25 | `tests/app/S2B-backfill-workflow.test.ts:107、:172、:197、:222、:273、:279、:321、:341` | 基础策略 T；回填 cursor 来自`:187→:197、:266→:273`的真实前页 next | v2 允许 |
| B26 | `tests/app/S2B-backfill-workflow.test.ts:107、:172、:222、:279、:321、:341` | 活动策略 `target.digest`；重算活 | F1 |
| B27 | `tests/app/S2B-be2-late-evidence-activity.test.ts:47、:60` | 策略 T；prepared 由`:59`调用真实 prepare，定义见 `tests/helpers/S2B-be2-reconcile-support.ts:94、:98、:100` | v2 允许 |
| B28 | `tests/app/S2B-be2-run09-activity.test.ts:38、:62、:71` | 策略 T；`:70`真实 prepare→`:71`原样 startRun | v2 允许 |
| B29 | `tests/app/S2B-be2-run18-activity.test.ts:35、:52` | 策略 T；`:51`真实 prepare→`:52`原样 startRun | v2 允许 |
| B30 | `tests/app/S2B-be2-run23-activity.test.ts:56、:71` | 策略 T；`:70`真实 prepare→`:71`原样 startRun | v2 允许 |
| B31 | `tests/app/S2B-be2-startup-reconcile-activity.test.ts:46、:60、:81、:95、:114、:127、:149、:163` | 策略 T；prepared 分别来自`:59、:94、:126、:161`，原样启动 | v2 允许 |
| B32 | `tests/app/S2B-r2-backfill-done-cursor.test.ts:114、:134、:204` | 策略 T；prepared 经 `tests/helpers/S2B-runtime-steps-fixture.ts:348、:357`；回填 cursor 来自本文件`:197`的 `first.value.next` | v2 允许 |
| B33 | `tests/app/S2B-r2-backfill-done-cursor.test.ts:134` | 活动策略 `target.digest`；重算活 | F1 |
| B34 | `tests/app/S2B-r2-backfill-identity.test.ts:61` | 基础策略 T 的返回摘要 | v2 允许 |
| B35 | `tests/app/S2B-r2-backfill-identity.test.ts:61` | 活动策略 `target.digest`；重算活 | F1 |
| B36 | `tests/app/S2B-r2-backfill-probe-first.test.ts:62、:73` | 策略 T；`:71`真实 prepare→`:73`原样 startRun | v2 允许 |
| B37 | `tests/app/S2B-r2-backfill-real-kernel.test.ts:68、:77、:115` | 策略 T；prepared 经 `tests/helpers/S2B-r2-backfill-kernel-support.ts:89、:92`；Host token 来自本文件`:131`真实页面 | v2 允许 |
| B38 | `tests/app/S2B-r2-backfill-revision-race.test.ts:49、:84` | 基础策略 T 的返回摘要 | v2 允许 |
| B39 | `tests/app/S2B-r2-backfill-revision-race.test.ts:49、:84` | 活动策略 `target.digest`；重算活 | F1 |
| B40 | `tests/app/S2B-r2-r6-probe-verdicts.test.ts:36、:47` | 策略 T；`:45`真实 prepare→`:47`原样 startRun | v2 允许 |
| B41 | `tests/app/S2C-line-routes.test.ts:155、:182、:276` | 策略 T 的返回摘要 | v2 允许 |
| B42 | `tests/app/S3-graph-routes.test.ts:226` | Host TOKEN；`:33`测试常量，`:210`注入 server，`:226`发送 | F1 |
| B43 | `tests/app/S4C-note-routes.test.ts:55、:90、:122、:156、:186` | 策略 N 的返回摘要 | v2 允许 |
| B44 | `tests/app/S4C-record-note-host.test.ts:132、:133、:153、:175、:216、:231` | 策略 G；Host token 来自`:113`真实页面；prepared 随`:164、:224`的真实 next 原样推进 | v2 允许 |
| B45 | `tests/app/S4C2-scribe-reminders.test.ts:73、:96、:201、:244、:302、:445、:521、:720、:832、:858、:885` | 策略 N；prepared`:443→:445`；`messages.readInbox.cursor`由`:302、:306`真实分页返回再使用 | v2 允许 |
| B46 | `tests/app/S5-decision-routes.test.ts:168、:255、:281` | 策略 T/S/G；displayToken、position 来自`:227、:231`真实队列读取，`:253`原样字段放入错误类别；这是错配拒绝，没有测试伪造 token | v2 允许 |
| B47 | `tests/app/S5R2-driver-safe-point.test.ts:28` | 策略 T/S 的返回摘要 | v2 允许 |
| B48 | `tests/app/S8A-L8-auto-capture-gate.test.ts:276` | `architecture.reviseArchitectureCatalog.basedOn.digest`；`:272`公开 read→`:279`原样使用 | v2 允许 |
| B49 | `tests/app/S8A-L8-auto-capture-host.test.ts:29、:43、:45、:62、:87、:103、:109、:114、:123、:140、:145、:150、:158、:173、:175、:180` | Host token L，原样转发 | v2 允许 |
| B50 | `tests/app/S8A-L8-host-close-restart.test.ts:38、:46、:75、:79、:123、:124、:157、:208、:257` | Host token L，原样转发 | v2 允许 |
| B51 | `tests/app/S8A-L8-host-restart.test.ts:28、:46、:76、:87、:92、:93、:107` | Host token L，原样转发 | v2 允许 |
| B52 | `tests/app/S8A-L8-http-watermark.test.ts:35、:41、:53、:65、:71、:76` | Host token L，原样转发 | v2 允许 |
| B53 | `tests/app/S8A-architecture-routes.test.ts:47` | Host TOKEN；`:29`测试常量，`:85、:157`注入 server，`:47`发送 | F1 |
| B54 | `tests/app/S8A-architecture-routes.test.ts:163` | `architecture.compareFormalObserved.catalog.baseline.digest`；`:140`真实 read→`:144`原样使用 | v2 允许 |
| B55 | `tests/app/change-commit-observer.test.ts:171、:175` | Host token；来自`:168`真实页面 | v2 允许 |
| B56 | `tests/app/change-emitters.test.ts:210、:249` | `collaboration.start`内 prepared；`:60、:61`仅造 `claim.runRef`并 cast；`:89`的 advanceWork 替身忽略真实契约 | F1 |
| B57 | `tests/app/change-stream.test.ts:55` | Host TOKEN；`:26`测试常量，`:42`注入 server，`:55`发送 | F1 |
| B58 | `tests/app/change-stream.test.ts:158、:159、:161、:177` | 变更流 `Last-Event-ID`；这些位置直接写 `c000…`，不是从真实公共流返回再使用 | F1 |
| B59 | `tests/app/goal-fan-out-driver.test.ts:43` | 策略 T 的返回摘要 | v2 允许 |
| B60 | `tests/app/host-settings.test.ts:151、:157、:163、:172` | Host token；来自`:141`真实页面，原样转发 | v2 允许 |
| B61 | `tests/app/orchestration-mechanism.test.ts:201、:270、:286、:339、:340、:359、:367、:380、:384、:414、:415、:416、:425、:433、:438、:452、:467、:473` | 策略 T/G、Host token G；`:201`经 `tests/helpers/C1-mailbox-fixture.ts:141、:146`及 `tests/helpers/S2B-runtime-steps-fixture.ts:348、:357`取得真实 prepared；本文件`:270、:425`原样推进 next | v2 允许 |
| B62 | `tests/app/project-source-tool.test.ts:164、:181、:183、:184、:191、:193、:195、:196、:199、:200、:228、:235、:238、:239、:285、:302、:305、:308、:309` | `project_source/workspace.querySource`的 capture 指纹和 cursor；capture 来自`:156、:189、:205、:234、:236、:268、:301`；cursor 来自`:165、:237、:304`真实查询返回；`:238、:239`为错配拒绝 | v2 允许 |
| B63 | `tests/app/support/S8A-L8-host.ts:161、:168、:181、:266、:270、:278` | Host token；来自`:150、:152`真实页面，原样转发 | v2 允许 |
| B64 | `tests/state/invariants-fuzz.test.ts:78、:81、:95` | 策略 G/T/E；Host token 经 `tests/scenarios/harness.ts:1089`使用真实启动返回值；正常 prepared 路径见 `tests/scenarios/support/fuzz.ts:1372`→`tests/scenarios/support/common.ts:784` | v2 允许 |
| B65 | `tests/state/invariants-fuzz.test.ts:81` | `runtime.startRun.prepared`；`tests/scenarios/support/fuzz.ts:1546`读取 execution 后，在`:1553、:1554`重拼 claim/envelope/inputBinding | F1 |
| B66 | `tests/state/invariants-fuzz.test.ts:95` | 策略 `target.digest`；`tests/scenarios/support/fuzz.ts:2235`从内部 world 找计划，在`:2243`重取 `effectiveCompletionPolicy` | F1 |
| B67 | `tests/state/invariants.test.ts:192、:256、:379、:388` | 策略摘要`:187→:194`及 T；prepared`:386→:388`；`:256`循环沿真实 Workflow next 推进 | v2 允许 |

**3．Record-store 自身测试**

| 范围 | 结果 |
|---|---|
| `.lead-ref/groups/L4-files.txt:1、:77、:122` | 无实例。L4 为 tests/app、tests/state；本题限定本节只列 L1。存储层以上手写记录的判定没有改变，不计入本次 F3；规则见 `.lead-ref/books/test-rule-sheet-v2.md:38、:43`。 |

**4．A7**

| 命名 helper | L4 结果 |
|---|---|
| `buildNoteTools` | 本组及其测试 helper 调用链无使用。边界是 `.lead-ref/books/test-rule-sheet-v2.md:45、:47`；本组实际注记路径见 `tests/app/S4C-note-routes.test.ts:65`、`tests/app/S4C2-scribe-reminders.test.ts:62`。 |
| `damageKernel` | 本组及调用链无使用。边界见 `.lead-ref/books/test-rule-sheet-v2.md:50`；`tests/app/S2B-41-decision54-backfill-bound.test.ts:216`调用的 `closeOpenTurn`不是该 helper。 |
| `process-sandbox-standin.ts` 的 `probe` | 本组及调用链无使用。边界见 `.lead-ref/books/test-rule-sheet-v2.md:59、:64`；`tests/app/RL-34-wiring-resource-caps.test.ts:29`使用的是另一份 RL sandbox double。 |

**无实例**：以下文件没有本题四类实例；清单范围见 `.lead-ref/groups/L4-files.txt:1、:122`。

- `tests/app/A2-host-instance-lease.test.ts:15`
- `tests/app/A2-settings-automation.test.ts:20`
- `tests/app/A2-startup-redrive-select.test.ts:20`
- `tests/app/AG6-agent-assembly.test.ts:177`
- `tests/app/K3-19-review-capability-host.test.ts:112`
- `tests/app/R6-workbench.test.ts:24`
- `tests/app/RL-33-workbench-resource-caps.test.ts:58`
- `tests/app/RL-40-43-resource-cap-settings.test.ts:15`
- `tests/app/S3-attention-context.test.ts:307`
- `tests/app/S8A-L8-capture-start.test.ts:101`
- `tests/app/change-feed.test.ts:8`
- `tests/app/goal-conversation-start.test.ts:24`
- `tests/app/session-rendering.test.ts:24`
- `tests/app/settings-ui.test.ts:25`
- `tests/app/ui-actions.test.ts:14`
- `tests/app/ui-change-refetch.test.ts:13`
- `tests/app/ui-live-wiring.test.ts:19`
- `tests/app/ui-live.test.ts:13`
- `tests/app/ui-refresh.test.ts:14`
- `tests/app/ui-sse.test.ts:9`
- `tests/app/ui-store.test.ts:17`
- `tests/state/K3-B3-crr-codec-rejects.test.ts:10`
- `tests/state/K3-B3-shared-rules-pure.test.ts:8`
- `tests/state/S1-anomaly.test.ts:25`
- `tests/state/S1-archive-rework.test.ts:15`
- `tests/state/S1-dispatch.test.ts:23`
- `tests/state/S1-message-routing.test.ts:16`
- `tests/state/S1-responsibility.test.ts:15`
- `tests/state/S1-session-archive.test.ts:20`
- `tests/state/S2C-line-status.test.ts:21`
- `tests/state/S5-decision-policy.test.ts:13`
- `tests/state/S5-goal-settings.test.ts:16`
- `tests/state/S5-message-decision.test.ts:12`
- `tests/state/S5-notice-settings.test.ts:15`
- `tests/state/S5-request-candidate.test.ts:18`
- `tests/state/S8A-L8-auto-capture-state.test.ts:21`
- `tests/state/WP1-goal-content.test.ts:13`
- `tests/state/WP2-positions.test.ts:19`
- `tests/state/attempt-machine.test.ts:25`
- `tests/state/command-normalization-pure.test.ts:11`
- `tests/state/command-normalization.test.ts:16`
- `tests/state/command-rerun-request-pure.test.ts:22`
- `tests/state/command-rerun-request-used-by.test.ts:17`
- `tests/state/command-rerun-request.test.ts:23`
- `tests/state/context-input.test.ts:14`
- `tests/state/control-intent-machine.test.ts:20`
- `tests/state/execution-entry-codecs-pure.test.ts:7`
- `tests/state/goal-machine.test.ts:22`
- `tests/state/invariants.ts:30`
- `tests/state/k3-failure-classification.test.ts:9`
- `tests/state/k3-review-claim.test.ts:11`
- `tests/state/k3-run-reconcile.test.ts:15`
- `tests/state/message-machine.test.ts:300`
- `tests/state/no-progress.test.ts:28`
- `tests/state/plan-machine.test.ts:19`
- `tests/state/query-run-recovery.test.ts:19`
- `tests/state/review-lease.test.ts:10`
- `tests/state/run-machine.test.ts:35`
- `tests/state/session-availability.test.ts:21`
- `tests/state/task-failure.test.ts:37`
- `tests/state/task-machine.test.ts:35`
- `tests/state/unknown-call-kinds.test.ts:15`
- `tests/state/unknown-call-review-streak.test.ts:10`
- `tests/state/unknown-call-review.test.ts:19`
- `tests/state/verification-machine.test.ts:30`

JSON 的 `note`对应上表同号条目的完整来源和理由；无实例节和空节不产生实例对象。

```json
[
  {"section":"A1草稿","file":"tests/app/A2-automation-verdict.test.ts","line":[99,179,198],"owner":"plans.proposePlan/applyPlanChange","value":"G完整草稿","verdict":"v2 允许","note":"A01"},
  {"section":"A1草稿","file":"tests/app/A2-continuation-projection.test.ts","line":[70,73],"owner":"send_session_message","value":"询问工具参数","verdict":"v2 允许","note":"A02"},
  {"section":"A1草稿","file":"tests/app/A2-continuation-projection.test.ts","line":[76],"owner":"plans.proposePlan/applyPlanChange","value":"G完整草稿","verdict":"v2 允许","note":"A03"},
  {"section":"A1草稿","file":"tests/app/A2-requeue-route.test.ts","line":[48],"owner":"plans.proposePlan/applyPlanChange","value":"G完整草稿","verdict":"v2 允许","note":"A04"},
  {"section":"A1草稿","file":"tests/app/A2-reverify-route.test.ts","line":[53],"owner":"plans.proposePlan/applyPlanChange","value":"G完整草稿","verdict":"v2 允许","note":"A05"},
  {"section":"A1草稿","file":"tests/app/AG2-consultation.test.ts","line":[309],"owner":"project_source","value":"read参数","verdict":"v2 允许","note":"A06"},
  {"section":"A1草稿","file":"tests/app/AG2b-collaboration.test.ts","line":[164,165,167,169,387,388,390,484,485,487],"owner":"find_related_sessions/read_session_card/send_session_message","value":"查找、卡片、消息工具参数","verdict":"v2 允许","note":"A07"},
  {"section":"A1草稿","file":"tests/app/AG2b-collaboration.test.ts","line":[254,418,520],"owner":"plans.proposePlan/applyPlanChange","value":"G完整草稿","verdict":"v2 允许","note":"A08"},
  {"section":"A1草稿","file":"tests/app/K3-15-review-routes.test.ts","line":[74],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+S+K完整草稿","verdict":"v2 允许","note":"A09"},
  {"section":"A1草稿","file":"tests/app/R6-host.test.ts","line":[324],"owner":"plans.proposePlan/applyPlanChange","value":"planDraft()","verdict":"v2 允许","note":"A10"},
  {"section":"A1草稿","file":"tests/app/R6-host.test.ts","line":[673],"owner":"project_source","value":"read参数","verdict":"v2 允许","note":"A11"},
  {"section":"A1草稿","file":"tests/app/RL-34-wiring-resource-caps.test.ts","line":[89,130,142,205],"owner":"plans.proposePlan/applyPlanChange","value":"T；142另有B+E","verdict":"v2 允许","note":"A12"},
  {"section":"A1草稿","file":"tests/app/RL-34-wiring-resource-caps.test.ts","line":[119,131],"owner":"run_readonly_command","value":"command: ls","verdict":"v2 允许","note":"A13"},
  {"section":"A1草稿","file":"tests/app/S0-attention-edge-label.test.ts","line":[166],"owner":"plans.proposePlan/applyPlanChange","value":"planDraft","verdict":"v2 允许","note":"A14"},
  {"section":"A1草稿","file":"tests/app/S1-session-routes.test.ts","line":[187],"owner":"plans.proposePlan/applyPlanChange","value":"G完整草稿","verdict":"v2 允许","note":"A15"},
  {"section":"A1草稿","file":"tests/app/S2A-decision-routes.test.ts","line":[52],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+S完整草稿","verdict":"v2 允许","note":"A16"},
  {"section":"A1草稿","file":"tests/app/S2B-35-activity-routes.test.ts","line":[125,138,140],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+轨+轴完整草稿","verdict":"v2 允许","note":"A17"},
  {"section":"A1草稿","file":"tests/app/S2B-41-decision54-backfill-bound.test.ts","line":[144],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A18"},
  {"section":"A1草稿","file":"tests/app/S2B-backfill-host.test.ts","line":[66,133],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+活完整草稿","verdict":"v2 允许","note":"A19"},
  {"section":"A1草稿","file":"tests/app/S2B-backfill-workflow.test.ts","line":[107,172,222,279,321,341],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+活完整草稿","verdict":"v2 允许","note":"A20"},
  {"section":"A1草稿","file":"tests/app/S2B-be2-late-evidence-activity.test.ts","line":[47],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A21"},
  {"section":"A1草稿","file":"tests/app/S2B-be2-run09-activity.test.ts","line":[38,62],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A22"},
  {"section":"A1草稿","file":"tests/app/S2B-be2-run18-activity.test.ts","line":[35],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A23"},
  {"section":"A1草稿","file":"tests/app/S2B-be2-run23-activity.test.ts","line":[56],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A24"},
  {"section":"A1草稿","file":"tests/app/S2B-be2-startup-reconcile-activity.test.ts","line":[46,81,114,149],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A25"},
  {"section":"A1草稿","file":"tests/app/S2B-r2-backfill-done-cursor.test.ts","line":[134],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+活完整草稿","verdict":"v2 允许","note":"A26"},
  {"section":"A1草稿","file":"tests/app/S2B-r2-backfill-identity.test.ts","line":[61],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+活完整草稿","verdict":"v2 允许","note":"A27"},
  {"section":"A1草稿","file":"tests/app/S2B-r2-backfill-probe-first.test.ts","line":[62],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A28"},
  {"section":"A1草稿","file":"tests/app/S2B-r2-backfill-real-kernel.test.ts","line":[77,115],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A29"},
  {"section":"A1草稿","file":"tests/app/S2B-r2-backfill-revision-race.test.ts","line":[49,84],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+活完整草稿","verdict":"v2 允许","note":"A30"},
  {"section":"A1草稿","file":"tests/app/S2B-r2-r6-probe-verdicts.test.ts","line":[36],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A31"},
  {"section":"A1草稿","file":"tests/app/S2C-line-routes.test.ts","line":[155,182,276,277],"owner":"plans.proposePlan/applyPlanChange","value":"T；277另有线","verdict":"v2 允许","note":"A32"},
  {"section":"A1草稿","file":"tests/app/S4C-note-routes.test.ts","line":[55,90,122,156,186],"owner":"plans.proposePlan/applyPlanChange","value":"N完整草稿","verdict":"v2 允许","note":"A33"},
  {"section":"A1草稿","file":"tests/app/S4C-note-routes.test.ts","line":[65,68,126,136,159,191],"owner":"notes.writeNote","value":"NoteDraftV1","verdict":"v2 允许","note":"A34"},
  {"section":"A1草稿","file":"tests/app/S4C-record-note-host.test.ts","line":[132],"owner":"plans.proposePlan/applyPlanChange","value":"修改assignment后的G草稿","verdict":"v2 允许","note":"A35"},
  {"section":"A1草稿","file":"tests/app/S4C-record-note-host.test.ts","line":[141,204],"owner":"record_note","value":"注记工具参数","verdict":"v2 允许","note":"A36"},
  {"section":"A1草稿","file":"tests/app/S4C2-scribe-reminders.test.ts","line":[62,79,81,84,87,100,102,210,256,528,574,643,753,866],"owner":"notes.writeNote","value":"general/understanding NoteDraftV1","verdict":"v2 允许","note":"A37"},
  {"section":"A1草稿","file":"tests/app/S4C2-scribe-reminders.test.ts","line":[73,96,201,244,521,720,832,858,885],"owner":"plans.proposePlan/applyPlanChange","value":"N完整草稿","verdict":"v2 允许","note":"A38"},
  {"section":"A1草稿","file":"tests/app/S5-decision-routes.test.ts","line":[137],"owner":"plans.proposePlan","value":"draft:{}","verdict":"F1","note":"A39"},
  {"section":"A1草稿","file":"tests/app/S5-decision-routes.test.ts","line":[168,281],"owner":"plans.proposePlan/applyPlanChange","value":"168为T+B+S；281为G","verdict":"v2 允许","note":"A40"},
  {"section":"A1草稿","file":"tests/app/S5R2-driver-safe-point.test.ts","line":[28],"owner":"plans.proposePlan/applyPlanChange","value":"T+B+S完整草稿","verdict":"v2 允许","note":"A41"},
  {"section":"A1草稿","file":"tests/app/exploration-tools.test.ts","line":[31,37,43,48,53,56,60,68,75,76],"owner":"list_files/search/symbols","value":"探索工具参数","verdict":"v2 允许","note":"A42"},
  {"section":"A1草稿","file":"tests/app/goal-fan-out-driver.test.ts","line":[43],"owner":"plans.proposePlan/applyPlanChange","value":"T完整草稿","verdict":"v2 允许","note":"A43"},
  {"section":"A1草稿","file":"tests/app/orchestration-mechanism.test.ts","line":[171,183],"owner":"send_session_message","value":"交给假mailbox的发送参数","verdict":"F1","note":"A44"},
  {"section":"A1草稿","file":"tests/app/orchestration-mechanism.test.ts","line":[201,286,339,414],"owner":"plans.proposePlan/applyPlanChange","value":"201为T；其余G","verdict":"v2 允许","note":"A45"},
  {"section":"A1草稿","file":"tests/app/orchestration-mechanism.test.ts","line":[215,417],"owner":"send_session_message","value":"真实mailbox发送参数","verdict":"v2 允许","note":"A46"},
  {"section":"A1草稿","file":"tests/app/project-source-tool.test.ts","line":[156,164,181,183,184,189,191,193,195,196,199,200,205,228,234,235,236,238,239,256,268,285,292,301,302,308,309,322,334],"owner":"project_source","value":"capture/query/verify/release参数","verdict":"v2 允许","note":"A47"},
  {"section":"A1草稿","file":"tests/app/reviewer-source-tools.test.ts","line":[44,52,55,58,65,72],"owner":"read_source/list_files/search/symbols","value":"源码工具参数","verdict":"v2 允许","note":"A48"},
  {"section":"A1草稿","file":"tests/state/invariants-fuzz.test.ts","line":[78,81,95,97],"owner":"plans.proposePlan/applyPlanChange","value":"G、T+B+E及fuzz修改草稿","verdict":"v2 允许","note":"A49"},
  {"section":"A1草稿","file":"tests/state/invariants-fuzz.test.ts","line":[81],"owner":"send_session_message","value":"询问参数","verdict":"v2 允许","note":"A50"},
  {"section":"A1草稿","file":"tests/state/invariants.test.ts","line":[204,379],"owner":"plans.proposePlan/applyPlanChange","value":"本文件完整草稿及T","verdict":"v2 允许","note":"A51"},
  {"section":"A1签发字段","file":"tests/app/A2-automation-verdict.test.ts","line":[55,62,67,73,82,89,99,179,180,198,199,240,243],"owner":"completionPolicies.activateCompletionPolicy/workflow.advanceWork/runtime.startRun/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B01"},
  {"section":"A1签发字段","file":"tests/app/A2-continuation-projection.test.ts","line":[49,76,77,81],"owner":"completionPolicies.activateCompletionPolicy/workflow.advanceWork/runtime.startRun/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B02"},
  {"section":"A1签发字段","file":"tests/app/A2-requeue-route.test.ts","line":[48,51,61,65,74,88,95,98],"owner":"completionPolicies.activateCompletionPolicy/workflow.advanceWork/runtime.startRun/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B03"},
  {"section":"A1签发字段","file":"tests/app/A2-reverify-route.test.ts","line":[53,56,71,80,93,100,108],"owner":"completionPolicies.activateCompletionPolicy/workflow.advanceWork/runtime.startRun/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B04"},
  {"section":"A1签发字段","file":"tests/app/A2-runtime-capabilities.test.ts","line":[89],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B05"},
  {"section":"A1签发字段","file":"tests/app/AG2-consultation.test.ts","line":[166,172,518,591],"owner":"runtime.startQuery/Host鉴权","value":"prepared、token","verdict":"v2 允许","note":"B06"},
  {"section":"A1签发字段","file":"tests/app/AG2b-collaboration.test.ts","line":[102,112,123,131,250,254,256,262,264,268,269,284,286,294,300,304,336,350,365,418,420,425,426,428,436,438,444,520,522,526,541,543,549,559,561],"owner":"completionPolicies.activateCompletionPolicy/runtime.startQuery/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B07"},
  {"section":"A1签发字段","file":"tests/app/K-R-runtime-capabilities.test.ts","line":[66],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B08"},
  {"section":"A1签发字段","file":"tests/app/K3-15-review-routes.test.ts","line":[74,128,166],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B09"},
  {"section":"A1签发字段","file":"tests/app/MVP-ui-entry.test.ts","line":[98],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B10"},
  {"section":"A1签发字段","file":"tests/app/MVP-workbench-tools.test.ts","line":[91,96,112],"owner":"workbench.saveFile","value":"expectedRevision指纹","verdict":"F1","note":"B11"},
  {"section":"A1签发字段","file":"tests/app/R6-host.test.ts","line":[141,149,308,373,753,762,770,794,817,874,905],"owner":"Host鉴权/completionPolicies/workspace/runtime/materials/workflow","value":"token、策略摘要、capture指纹、prepared、bodyRef.digest、history cursor","verdict":"v2 允许","note":"B12"},
  {"section":"A1签发字段","file":"tests/app/R6-host.test.ts","line":[457,478],"owner":"runtime.createSession","value":"role.pin.digest","verdict":"F1","note":"B13"},
  {"section":"A1签发字段","file":"tests/app/RL-34-wiring-resource-caps.test.ts","line":[89,110,122,130,134,142,196,205,222],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun/runtime.startQuery","value":"target.digest、prepared","verdict":"v2 允许","note":"B14"},
  {"section":"A1签发字段","file":"tests/app/RL-44-host-restart-resource-caps.test.ts","line":[77],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B15"},
  {"section":"A1签发字段","file":"tests/app/S0-attention-edge-label.test.ts","line":[111],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"B16"},
  {"section":"A1签发字段","file":"tests/app/S1-session-routes.test.ts","line":[187,195],"owner":"completionPolicies.activateCompletionPolicy/workflow.advanceWork/runtime.startRun/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B17"},
  {"section":"A1签发字段","file":"tests/app/S2A-decision-routes.test.ts","line":[52,97],"owner":"completionPolicies.activateCompletionPolicy/decisions.queryDecisionQueue","value":"target.digest、cursor","verdict":"v2 允许","note":"B18"},
  {"section":"A1签发字段","file":"tests/app/S2B-35-activity-routes.test.ts","line":[97,103],"owner":"Host鉴权","value":"TOKEN","verdict":"F1","note":"B19"},
  {"section":"A1签发字段","file":"tests/app/S2B-35-activity-routes.test.ts","line":[125,138,278,290],"owner":"completionPolicies.activateCompletionPolicy/Host鉴权","value":"target.digest、token","verdict":"v2 允许","note":"B20"},
  {"section":"A1签发字段","file":"tests/app/S2B-35-activity-routes.test.ts","line":[125,138],"owner":"completionPolicies.activateCompletionPolicy","value":"重算target.digest","verdict":"F1","note":"B21"},
  {"section":"A1签发字段","file":"tests/app/S2B-41-decision54-backfill-bound.test.ts","line":[144,181,241],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B22"},
  {"section":"A1签发字段","file":"tests/app/S2B-backfill-host.test.ts","line":[66,133],"owner":"completionPolicies.activateCompletionPolicy","value":"基础策略target.digest","verdict":"v2 允许","note":"B23"},
  {"section":"A1签发字段","file":"tests/app/S2B-backfill-host.test.ts","line":[66,133],"owner":"completionPolicies.activateCompletionPolicy","value":"重算活动策略target.digest","verdict":"F1","note":"B24"},
  {"section":"A1签发字段","file":"tests/app/S2B-backfill-workflow.test.ts","line":[107,172,197,222,273,279,321,341],"owner":"completionPolicies.activateCompletionPolicy/workflow.backfillActivityRange/workflow.backfillRecentActivity","value":"target.digest、cursor","verdict":"v2 允许","note":"B25"},
  {"section":"A1签发字段","file":"tests/app/S2B-backfill-workflow.test.ts","line":[107,172,222,279,321,341],"owner":"completionPolicies.activateCompletionPolicy","value":"重算活动策略target.digest","verdict":"F1","note":"B26"},
  {"section":"A1签发字段","file":"tests/app/S2B-be2-late-evidence-activity.test.ts","line":[47,60],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B27"},
  {"section":"A1签发字段","file":"tests/app/S2B-be2-run09-activity.test.ts","line":[38,62,71],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B28"},
  {"section":"A1签发字段","file":"tests/app/S2B-be2-run18-activity.test.ts","line":[35,52],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B29"},
  {"section":"A1签发字段","file":"tests/app/S2B-be2-run23-activity.test.ts","line":[56,71],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B30"},
  {"section":"A1签发字段","file":"tests/app/S2B-be2-startup-reconcile-activity.test.ts","line":[46,60,81,95,114,127,149,163],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B31"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-backfill-done-cursor.test.ts","line":[114,134,204],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun/workflow.backfillRecentActivity","value":"target.digest、prepared、cursor","verdict":"v2 允许","note":"B32"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-backfill-done-cursor.test.ts","line":[134],"owner":"completionPolicies.activateCompletionPolicy","value":"重算活动策略target.digest","verdict":"F1","note":"B33"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-backfill-identity.test.ts","line":[61],"owner":"completionPolicies.activateCompletionPolicy","value":"基础策略target.digest","verdict":"v2 允许","note":"B34"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-backfill-identity.test.ts","line":[61],"owner":"completionPolicies.activateCompletionPolicy","value":"重算活动策略target.digest","verdict":"F1","note":"B35"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-backfill-probe-first.test.ts","line":[62,73],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B36"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-backfill-real-kernel.test.ts","line":[68,77,115],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B37"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-backfill-revision-race.test.ts","line":[49,84],"owner":"completionPolicies.activateCompletionPolicy","value":"基础策略target.digest","verdict":"v2 允许","note":"B38"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-backfill-revision-race.test.ts","line":[49,84],"owner":"completionPolicies.activateCompletionPolicy","value":"重算活动策略target.digest","verdict":"F1","note":"B39"},
  {"section":"A1签发字段","file":"tests/app/S2B-r2-r6-probe-verdicts.test.ts","line":[36,47],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun","value":"target.digest、prepared","verdict":"v2 允许","note":"B40"},
  {"section":"A1签发字段","file":"tests/app/S2C-line-routes.test.ts","line":[155,182,276],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"B41"},
  {"section":"A1签发字段","file":"tests/app/S3-graph-routes.test.ts","line":[226],"owner":"Host鉴权","value":"TOKEN","verdict":"F1","note":"B42"},
  {"section":"A1签发字段","file":"tests/app/S4C-note-routes.test.ts","line":[55,90,122,156,186],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"B43"},
  {"section":"A1签发字段","file":"tests/app/S4C-record-note-host.test.ts","line":[132,133,153,175,216,231],"owner":"completionPolicies.activateCompletionPolicy/workflow.advanceWork/runtime.startRun/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B44"},
  {"section":"A1签发字段","file":"tests/app/S4C2-scribe-reminders.test.ts","line":[73,96,201,244,302,445,521,720,832,858,885],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun/messages.readInbox","value":"target.digest、prepared、cursor","verdict":"v2 允许","note":"B45"},
  {"section":"A1签发字段","file":"tests/app/S5-decision-routes.test.ts","line":[168,255,281],"owner":"completionPolicies.activateCompletionPolicy/workspaceDecisionSettings","value":"target.digest、displayToken、seenThrough.position","verdict":"v2 允许","note":"B46"},
  {"section":"A1签发字段","file":"tests/app/S5R2-driver-safe-point.test.ts","line":[28],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"B47"},
  {"section":"A1签发字段","file":"tests/app/S8A-L8-auto-capture-gate.test.ts","line":[276],"owner":"architecture.reviseArchitectureCatalog","value":"basedOn.digest","verdict":"v2 允许","note":"B48"},
  {"section":"A1签发字段","file":"tests/app/S8A-L8-auto-capture-host.test.ts","line":[29,43,45,62,87,103,109,114,123,140,145,150,158,173,175,180],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B49"},
  {"section":"A1签发字段","file":"tests/app/S8A-L8-host-close-restart.test.ts","line":[38,46,75,79,123,124,157,208,257],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B50"},
  {"section":"A1签发字段","file":"tests/app/S8A-L8-host-restart.test.ts","line":[28,46,76,87,92,93,107],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B51"},
  {"section":"A1签发字段","file":"tests/app/S8A-L8-http-watermark.test.ts","line":[35,41,53,65,71,76],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B52"},
  {"section":"A1签发字段","file":"tests/app/S8A-architecture-routes.test.ts","line":[47],"owner":"Host鉴权","value":"TOKEN","verdict":"F1","note":"B53"},
  {"section":"A1签发字段","file":"tests/app/S8A-architecture-routes.test.ts","line":[163],"owner":"architecture.compareFormalObserved","value":"catalog.baseline.digest","verdict":"v2 允许","note":"B54"},
  {"section":"A1签发字段","file":"tests/app/change-commit-observer.test.ts","line":[171,175],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B55"},
  {"section":"A1签发字段","file":"tests/app/change-emitters.test.ts","line":[210,249],"owner":"collaboration.start","value":"部分prepared","verdict":"F1","note":"B56"},
  {"section":"A1签发字段","file":"tests/app/change-stream.test.ts","line":[55],"owner":"Host鉴权","value":"TOKEN","verdict":"F1","note":"B57"},
  {"section":"A1签发字段","file":"tests/app/change-stream.test.ts","line":[158,159,161,177],"owner":"Host变更流","value":"Last-Event-ID cursor","verdict":"F1","note":"B58"},
  {"section":"A1签发字段","file":"tests/app/goal-fan-out-driver.test.ts","line":[43],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"B59"},
  {"section":"A1签发字段","file":"tests/app/host-settings.test.ts","line":[151,157,163,172],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B60"},
  {"section":"A1签发字段","file":"tests/app/orchestration-mechanism.test.ts","line":[201,270,286,339,340,359,367,380,384,414,415,416,425,433,438,452,467,473],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun/workflow.advanceWork/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B61"},
  {"section":"A1签发字段","file":"tests/app/project-source-tool.test.ts","line":[164,181,183,184,191,193,195,196,199,200,228,235,238,239,285,302,305,308,309],"owner":"project_source/workspace.querySource","value":"capture指纹、cursor","verdict":"v2 允许","note":"B62"},
  {"section":"A1签发字段","file":"tests/app/support/S8A-L8-host.ts","line":[161,168,181,266,270,278],"owner":"Host鉴权","value":"token","verdict":"v2 允许","note":"B63"},
  {"section":"A1签发字段","file":"tests/state/invariants-fuzz.test.ts","line":[78,81,95],"owner":"completionPolicies.activateCompletionPolicy/workflow.advanceWork/runtime.startRun/Host鉴权","value":"target.digest、prepared、token","verdict":"v2 允许","note":"B64"},
  {"section":"A1签发字段","file":"tests/state/invariants-fuzz.test.ts","line":[81],"owner":"runtime.startRun","value":"重拼prepared","verdict":"F1","note":"B65"},
  {"section":"A1签发字段","file":"tests/state/invariants-fuzz.test.ts","line":[95],"owner":"completionPolicies.activateCompletionPolicy","value":"从内部计划取target.digest","verdict":"F1","note":"B66"},
  {"section":"A1签发字段","file":"tests/state/invariants.test.ts","line":[192,256,379,388],"owner":"completionPolicies.activateCompletionPolicy/runtime.startRun/workflow.advanceWork","value":"target.digest、prepared","verdict":"v2 允许","note":"B67"}
]
```

v2 允许 100，F1 18，F3 0，A7 越界 0，文件 122/122，枚举完整