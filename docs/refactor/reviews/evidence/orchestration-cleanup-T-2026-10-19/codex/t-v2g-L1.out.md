这份答复仍不能标为“枚举完整”：文件检索已覆盖全部 133 个文件，但部分共享 helper 的全部传递调用者，以及透传参数在组外的来源和后续路径，尚未逐条核完。下面区分已定位的接收点和仍欠缺的调用链证据，不把检索覆盖率当成枚举完成率。范围依据：`.lead-ref/groups/L1-files.txt:1`。

为控制重复，路径前缀如下：`H/`＝`tests/helpers/`，`W/`＝`tests/work-graph/`，`R/`＝`tests/runtime/`，`B/`＝`tests/business/`，`C/`＝`tests/composition/`，`S/`＝`tests/scenarios/`，`D/`＝`tests/record-store/`。表中同文件后续行号沿用该文件路径；JSON 使用完整路径。

计数按列出的静态接收点／写入点计算，循环和后端参数化不展开；记录存储测试按静态测试行计算。**“v2 允许”只判输入形式，不表示整个夹具通过规则审查**；A1 不豁免 F4，依据 `.lead-ref/books/test-rule-sheet-v2.md:24`、`.lead-ref/books/test-rule-sheet-v2.md:30`。

### 1．A1 公开输入

“手写”包括测试参数、固定 ID、请求选项和模型工具参数；“公开”表示真实公开步骤返回值；“存储”包括内部记录读取。下表的“待核”表示没有完成全部组外调用链核对，不能据此宣称后续只走公开步骤。

| 文件与接收点 | owner／输入、来源及平台字段 | 后续是否只公开 | 判定 |
|---|---|---|---|
| `tests/core/work-graph/MVP-execution-list.test.ts:45,48,68,74,92,96,101` | `listExecutions`；手写 Goal、分页、作用域变体。`:74,92,96,101` 使用 `:68` 返回的 `nextCursor`，未重签；来源见 `:67,75,91` | 分页读取是；前置 claim 使用 `:59` 的 claim owner | v2 允许，A1；拒绝输入没有被接纳为派生事实 |
| `H/A2-restart-fixture.ts:94,110,122,137,158,171,182,250,255` | Workflow、Plan、Control、GoalControl、Query owner；手写选择、Goal 引用、控制理由、Query intent。Workflow 后续输入取真实 `next`（`:99,114`）；版本取公开读（`:157,170`）；HTTP token 原样透传（`:65`） | 本 helper 的这些步骤是；全部调用方待核 | v2 允许，A1 |
| `H/AG2b-collaboration-fixture.ts:418,442,444,446,450,453,458,461,464,477,488,514,526,537,553,557,566` | Architecture、Project、Policy、Goal、Plan、Runtime、Session、Query、Mailbox；手写初始化、draft、查询及消息。激活 digest＝真实 install 返回（`:451`）；apply 引用＝propose 返回（`:465`）；prepared＝公开 prepare 返回（`:555,558`）；token＝真实页面读取（`:339`） | 本 helper 是；全部调用方待核 | v2 允许，A1 |
| `H/B2-401-world.ts:248,331` | Review list、Workflow decision；手写分页、选项与文本；游标续接列表结果；decision source/pins 取 `:330` 的真实 card | 否，夹具还检查内部请求状态（`:340`） | v2 允许，A1 输入 |
| `H/B2-blocked-runtime.ts:169,281,343,360,424` | Control、Review、Workflow decision、`request_command_rerun` 工具；手写控制、分页、选择及工具参数；Run 版本取公开读，source/pins 取真实 card（`:342`）；工具 call 见 `:422` | 否，另有内部记录路径及 stand-in（`:260`） | v2 允许，A1 输入；不豁免 F4 |
| `H/B2-crr-world.ts:123,137,150,308` | `shell`、Review read、Decision answer、`request_command_rerun`；手写命令／理由；answer 的 source/pins 来自真实 card（`:149`） | 否，随后直接 `applyDisposition`（`:156`） | v2 允许，A1 输入 |
| `H/B2-execution-fixture.ts:145,160,163,167` | Goal、Plan；手写第二 Goal 和 draft（`:151`）；apply 使用真实 proposal（`:163`） | 否，随后进入 entry 夹具路径（`:279`） | v2 允许，A1 输入 |
| `H/B2-runtime-fixture.ts:209` | Runtime SessionOperations；手写 Session 请求，role pin 取安装结果（`:197`） | 否；同一夹具有直接策略提交（`:204`）及内部 claim | v2 允许，A1 输入 |
| `H/K-t1-support.ts:64,76` | 组外 `pausedRunOnClosedHostChecked`、`operatorRequeue`；helper 位于 `tests/scenarios/support/common.ts`（导入 `:30`）。手写模式、requestId、reason；Run 来自真实恢复流程（`:70`） | 本路径使用真实 Host／公开 requeue；组外完整链待核 | v2 允许，A1 |
| `H/K3-35-continuation-fixture.ts:432,501,675,681,686,708,738,746,843,899` | Plan、Runtime、公开 attestation、Review、Requeue、Anomaly、shell 工具；手写选择／理由／命令。`:501` 的 prepared 来自真实 prepare（`:481,491`）；`:675,681` 复用同一公开 attestation 请求（`:671`），没有手写 review | 否，读取 manifest、Kernel 历史等内部证据（`:487,787`） | v2 允许，A1 输入 |
| `H/K3-blocked-command-fixture.ts:197,266,340,370,503,563` | Plan、真实工具分支、Runtime、Review、Workflow；手写工具参数（`:266`）；`:340` prepared 来自 `:336`；`:503` 使用真实 card。`:563` 参数由调用方提供；已核调用是 `R/K3-review-preparation.test.ts:397` 的真实 prepared | 部分路径有内部读取；全部调用方待核 | v2 允许，A1 输入 |
| `H/K3-crr-fixture.ts:111,163,167` | Review list、Plan read、Requeue；手写页／理由；游标取列表结果，Goal/Run 版本取公开读（`:163,165`） | 否，后续仍直接 claim（`:178` 后的流程） | v2 允许，A1 输入 |
| `H/K3-prefix-claim.ts:106,111` | Plan、Requeue；手写理由，Goal/Run 版本来自 `:106,108` | 否，随后内部 claim 流程 | v2 允许，A1 输入 |
| `H/K3-proposal-round.ts:177,203,211,281,436,659,708` | Plan、Review、Runtime、Workflow、`propose_safer_method`；draft 从内部 plan window（`:172`）复制并手工修改（`:186`）；apply 用真实 proposal；prepared 用真实 preparation（`:436`）；工具参数手写（`:705`） | 否，使用内部 plan window 及运行证据 | v2 允许，A1 输入；draft 的存储来源不等于伪造 receipt |
| `H/K3-review-card-fixture.ts:120,122,128,230,360,377,383,450` | Plan、Review list、read 工具；首个 draft 基于已采用 plan，第二个基于内部 window（`:357`）并手改；apply 均取真实 proposal；分页 cursor 续接列表结果 | 否；另有下面列出的回执重建（`:294`） | v2 允许，A1 输入 |
| `H/R3e-evidence-fixture.ts:171,180,187,209,216,233,373,380,394,401` | Policy、Goal、Plan；手写 policy／Goal／draft；激活引用和 digest 取 install 返回（`:182`）；apply 取 proposal 返回；后一个 draft 由原计划加手写 future task（`:386`） | 否，内部 entry/result 写入见 `:261` | v2 允许，A1 输入 |
| `H/RL-query-fixture.ts:131,132,136,155,159,163,167,169,171` | Project、Goal、Query、Runtime；手写初始化和 Query intent；Session 取真实 create；prepared 直接从 `:167` 传到 `:169` | 该运行链是；全部调用方待核 | v2 允许，A1 |
| `H/RL-re2-support.ts:33,68,75,80` | Runtime history/start/deliver、Control；手写分页和取消理由；prepared 来自 `:66`；intentRef 来自 `:75`；没有重建 cursor | 该局部链是 | v2 允许，A1 |
| `H/S1-archive-service-fixture.ts:216,225,252,295,309,335,369,371` | Mailbox、Control、Lifecycle、Requeue、read 工具；手写消息、回复、关联、控制和文件路径。回复版本取公开 `readMessage`（`:224`）；取消参数来自 archive request | 否，手写 entered/terminal/history 见 `:193,208,209` | v2 允许，A1 输入 |
| `H/S1-public-anchor.ts:98` | Workflow archive；`publicArchiveWrite` 在 `:64` 构造公开归档请求，无新签发字段 | helper 返回结果；完整调用方后续待核 | v2 允许，A1 输入；不豁免依赖替身 |
| `H/S1-runtime-scenario-fixture.ts:257,266,271,278` | Runtime、Lifecycle、Requeue；手写关联、Session、requeue；prepared 来自 `:254` 的真实 prepare | 含内部 claim／准备路径；调用方后续待核 | v2 允许，A1 输入 |
| `H/S1-session-facts-fixture.ts:269,274,284,304,316,325,365` | Mailbox、Goal、Query、Control；手写消息／回复／Query；咨询正文取公开 body read（`:316`）；控制取 archive request | 否，直接 entered/terminal 写入见 `:245,261` | v2 允许，A1 输入 |
| `H/S1-workflow-archive-fixture.ts:389,450,460,468` | Mailbox、Plan、Query；手写咨询及 intent，消息／版本取公开读；不重建令牌 | 否，直接 answer body 和 observation（`:522,531`） | v2 允许，A1 输入 |
| `H/S2A-notices-overbound-fixture.ts:92,95,116` | Mailbox、UserMessage；手写 inquiry、response、notify；版本来自现有消息／pin | 否，夹具读取内部 pin（`:97`） | v2 允许，A1 输入 |
| `H/S2A-notices-support.ts:83,88,136,145,152,158,175,178,220` | DecisionQueue、NoticeSettings、Project、Policy、Goal、Plan、Requeue。手写分页／draft；digest 取 install 返回（`:153`）；mark 的 token/seenThrough 原样透传。已核来源：`W/S2A-notices-counts.test.ts:109,112`、`W/S2A-notices-rework.test.ts:61`、`W/S2A-notices-since.test.ts:104`，均来自真实 page | 否，mark/requeue 的 pin 取内部 records（`:89,222`） | v2 允许，A1 输入 |
| `H/S2A-planning-fixture.ts:37,59,67` | Goal、Query；手写 planning Goal／intent，claim 使用已创建 Session | 否，直接写 answer body（`:91`） | v2 允许，A1 输入 |
| `H/S2A-queue-fixture.ts:60,73,95,107,117` | Mailbox、UserMessage、Decision answer、DecisionQueue；手写消息／分页；decision options/objects 复制真实消息内容（`:70`）；answer 使用已有 decision source | helper 外围有内部运行准备；完整后续待核 | v2 允许，A1 输入 |
| `H/S2B-activity-fixture.ts:268,296,309,346,364,372,401,425,524,561,577` | Plan、Lifecycle、Policy、Control、Goal、Activity；手写 draft、关联、归档、控制和读取请求；apply 用真实 proposal。激活 digest 的例外另列 `:414` | 否，entered/result 由内部 owner 写入（`:464,494`） | v2 允许，A1 输入 |
| `H/S2B-be1-platform-fixture.ts:305,328,333` | Runtime、Activity；手写启动 envelope／读取范围；prepared 来自 `:303`；Run refs 来自运行结果 | 运行与读取局部是；前置策略直接提交（`:208`） | v2 允许，A1 输入 |
| `H/S2B-be2-reconcile-support.ts:114,160,171` | Control、Activity；手写控制和查询 envelope；Run 版本取公开 execution（`:104`） | 后续含 reconcile 内部路径；全部调用方待核 | v2 允许，A1 输入 |
| `H/S2B-r2-activity-support.ts:51,84` | Plan read；使用夹具 Goal 引用，无签发字段 | 否，同文件直接写 Run（`:69`） | v2 允许，A1 输入 |
| `H/S2B-r2-backfill-kernel-support.ts:78,92` | read 工具、Runtime start；手写文件路径；prepared 来自 `:89` | 局部真实 Runtime；全部后续待核 | v2 允许，A1 |
| `H/S2B-r2-calendar-reverify-support.ts:75,136` | Plan、Evidence reverify；手写请求 envelope，predecessor 引用来自 earlier round，未伪造 receipt | 否，直接调用 check result/finalize（`:120,126`） | v2 允许，A1 输入 |
| `H/S2B-r2-timeline-public-flows.ts:76,132` | Plan、Control；手写控制请求，使用公开 Run 版本 | 否，entered fact 在 `:121` 写入 | v2 允许，A1 输入 |
| `H/S2B-runtime-steps-fixture.ts:170,357,383,391` | Policy、Runtime、Control；手写 install／控制；prepared 取真实 preparation（`:348`）；deliver 使用 `:383` 返回的 intentRef；digest 例外另列 `:183` | 局部运行链是；整体仍有内部准备／记录读取 | v2 允许，A1 输入 |
| `H/S2B-task-timeline-fixture.ts:241,271,293,295,302,311,317,331,333,343,356,376,400,411,516,537,570,579,692` | Goal、Plan、Control、Requeue、Timeline、read/send/respond 工具；手写 Goal／draft／控制／分页。后版 draft 从公开 graph plan（`:326`）修改；apply 使用真实 proposal；reply 版本取真实 message（`:530`）。cursor 在 `:692` 原样透传调用参数 | 否，Goal-control pins 取存储（`:359`）；完整 cursor 调用链待核 | v2 允许，A1 输入 |
| `H/S2B-track-fixture.ts:263,281,288,298,312,450,469,500,504,566,578,638,709,750,771` | Plan、Goal、Control、Lifecycle、Requeue、Query、Track；手写请求／draft；apply 取真实 proposal；控制版本取公开 execution；track cursor 原样透传（`:773`） | 否，直接 answer body／terminal（`:613,623`）；cursor 调用链待核 | v2 允许，A1 输入 |
| `H/S2C-D-node-support.ts:201,205,211,218,241,249,281,284,317,325,362,370,421,442,457,476,482` | Project、Policy、Architecture、Goal、Plan、Lifecycle、Requeue、Query；手写初始化、catalog、draft、链接／控制／intent；digest 取 install 返回（`:219`），apply 取 proposal | 否，直接创建 Kernel Session（`:297`）和内部状态步骤 | v2 允许，A1 输入 |
| `H/S2C-K-scenario-support.ts:44,49,55,61,67,158` | WorkLine／Host conversation／Workflow；手写查询 envelope、section、limit；cursor 原样取调用参数；maintenance 初始选择在 `:143` 手写，后续 next 取 `:162`。组外 Host helper 位于 `tests/scenarios/harness.ts`（`:26`） | maintenance 局部是；所有分页调用方待核 | v2 允许，A1 输入 |
| `H/S2C-K2-scenario-support.ts:18,19,24` | read 工具、Graph hover；手写路径及 Goal 查询。Host helper 位于 `tests/scenarios/harness.ts`（`:14`） | 组外运行／后续待核 | v2 允许，A1 输入 |
| `H/S2C-L-check-support.ts:139,147,214` | Policy、Plan；手写 policy；激活 ref/digest 取 install 返回（`:150`） | 否，后续 Evidence 内部步骤 | v2 允许，A1 输入 |
| `H/S2C-L-line-support.ts:263,275,290,330,334,341,355,385,407,415,423` | Lifecycle、Responsibility、Goal、Plan、LineSettings；手写链接／转交／归档／draft／pins 请求；apply 用真实 proposal；工作区版本取读取 | 否，Session 通过内部 `recordSessionCreated` 登记（`:245`） | v2 允许，A1 输入 |
| `H/S2C-L-runs-support.ts:182,217,225,250,263,285,289,309,344,352,357` | Control、Goal、Plan、Query、Mailbox；手写控制／Goal／intent／咨询，引用来自已建对象 | 否，直接 answer body（`:420`）和 observation（`:428`） | v2 允许，A1 输入 |
| `H/S2C-X-scale-fixture.ts:357,365` | Mailbox send/respond；手写正文；Run role 来自 execution 读取（`:352,353`），response 对应真实 message | 否，随后直接写 Run（`:405,427`） | v2 允许，A1 输入 |
| `H/S4A-note-fixture.ts:178,180,182,187,191,201,222,225,252,282` | Project、Policy、Architecture、Goal、Plan、Note；手写 catalog／draft／note envelope；policy digest、proposal 取真实返回；`:282` 的 note draft 和 expectedPointerRevision 取调用参数 | 初始化后有 Kernel 直接写（`:239`）；note 调用方全部后续待核 | v2 允许，A1 输入 |
| `H/S4A-note-scope-fixture.ts:156,158,160,165,184,191,212,215,220,234,237,263,302,325,329` | 同上，加 Lifecycle／Note review；手写 scope、draft、关联、review 请求；digest 取 install（`:168`）；apply 取 proposal。这里 review 是公开 note-review 请求，不是平台生成的 UnknownCallReview | 否，Kernel 创建在 `:250`；末端 note 调用方待核 | v2 允许，A1 输入 |
| `H/S4B-memory-fixture.ts:58,61,79,82,111` | Project read、Goal、Plan；手写 Goal／draft，apply 使用真实 proposal | 否，Kernel 创建在 `:102` | v2 允许，A1 输入 |
| `H/S4B-note-multi-scope-fixture.ts:92,105,108,115,118,121,126,130,140,151,154,171,195,206,211,213` | Project、Policy、Architecture、Goal、Plan；手写第二作用域及 draft；policy digest 取 `:121` 返回；修订 draft 的基线取已采用 plan map（`:162`） | 使用共享 Session helper；完整后续待核 | v2 允许，A1 输入 |
| `H/S4C-node-notes-fixture.ts:50` | Control；手写 cancel，Run 版本取 `:48` 公开 execution | 否，前后仍有内部 Session／claim 路径（`:44,56`） | v2 允许，A1 输入 |
| `H/S4C2-note-card-fixture.ts:200,221,244,249,251,261,299,308,314,320,330,338,348,354,356,360,370,377,387,389` | Plan、Note、DecisionQueue/Card、Workflow、GoalControl、memory history、NoticeSettings。draft 从传入已采用 plan 修改（`:217`）；card lookup source/key 手写（`:129,136`）；resolve 使用真实 card.source（`:349`）；mark 的 token/seenThrough 原样取真实 page（`:390`）；history cursor=null（`:371`） | 含 Kernel 直接写（`:182`）；组外 page/card 参数来源与全部后续待核 | v2 允许，A1 输入；card lookup key 是查询标识，未列作已签发回执 |
| `H/S5-application-support.ts:119` | DecisionQueue；手写 workspace／sections／page 请求 | 否，夹具有内部读取及提交观察（`:126,140`） | v2 允许，A1 输入 |
| `H/S5-decision-fixture.ts:566,572,621,626,638,646,652,674,686,705,738,744,751,928,938,985,999` | Project、LineSettings、Policy、Architecture、GoalSettings、Plan、Query、UserMessage、Decision answer；手写初始化、settings、draft、intent、消息；digest 取 install 返回；apply 取 proposal；answer source/pins 来自真实发送消息的 decision（`:997`） | 否，内部 entry/result、raw seed、snapshot probe 均保留（`:853,876,544,1079`） | v2 允许，A1 输入 |
| `H/S5-queue-support.ts:181,198,209,278,280,284,300,305,313,326,329,376,408` | Goal、Query、Project、Policy、Plan、Requeue、Evidence；手写请求／draft；digest、proposal 使用真实返回；reverify 使用已有 round 引用 | 否，answer body 在 `:237` 直接写入 | v2 允许，A1 输入 |
| `H/S5-user-message-support.ts:95` | UserMessage；手写消息请求，options/objects 从真实 decision message 复制（`:82,88`）；不是新签发 token/receipt | 否，依赖里仍有替身；A1 不豁免 F4 | v2 允许，A1 输入 |
| `H/S5R2-a-support.ts:36,41,82,98,113,133,172` | RequestCandidate、Plan、DecisionQueue/Card、Goal；手写 lookup／abandon／Goal；draft 从内部 plan 读取修改（`:68`）；apply 取 proposal；`:133` source 是手写查询标识（`:132`） | 否，storeSnapshot／内部 Goal 读取（`:40,125,134`） | v2 允许，A1 输入 |
| `H/S5R2-b-support.ts:153,189,200,235,253,260,264,305` | GoalSettings、Plan、DecisionQueue；手写 settings；draft 从公开 graph plan（`:235`）修改；apply 使用真实 proposal | 否，另有内部快照断言（`:279`） | v2 允许，A1 输入 |
| `H/S5R2-c-support.ts:157,279,284` | Decision conflicts、Plan；手写查询／新增 future task；draft 基于已有已采用 plan（`:268`）；apply 用真实 proposal | 否，内部记录断言（`:289`）；回执重建另列 `:98` | v2 允许，A1 输入 |
| `H/S5R2-d-support.ts:63,72,134` | GoalSettings、CollaborationDriver；手写 Goal 顺序／查询；无签发字段 | 否，后续 Workflow/Runtime 替身见 `:74` | v2 允许，A1 输入；不豁免 F4 |
| `H/S8A-L8-prepare.ts:45` | Material；artifact 引用来自真实 prepare（`:40`），手写打开请求；未改 prepared/bundle digest | 局部是 | v2 允许，A1 |
| `H/S8A-L8-reminder-world.ts:377,379,389,394,403,413,445,449,454,462,464,484,510,514,560` | Project、Policy、Architecture、Goal、Plan、Runtime；手写初始化、draft、capture 请求；digest/proposal 使用真实返回；capture 基于真实文件变化（`:481`） | 这些局部步骤是；完整测试后续待核 | v2 允许，A1 |
| `H/S8D-platform-fixture.ts:184,189,210,223,234,251,264,267` | Project、Architecture；手写项目、catalog、capture、分页／比较请求；capture/catalog 引用来自真实 owner 返回；cursor=null | 这些局部步骤是 | v2 允许，A1 |
| `H/W2-whiteboard-fixture.ts:258,294,298,303,309,313` | Plan；手写或调用方提供的 draft、basedOn、reason；请求由 `:285` 构造；apply 引用／revision 由调用方传入，未生成 opaque 字段 | 否，同文件有 raw proposal 写入（`:352`）；全部传入值来源待核 | v2 允许，A1 输入 |
| `H/WP1-entry-fixture.ts:224,299,310,314,392,397,418,434` | Plan、Lifecycle、Workflow archive、Anomaly；draft 从公开 graph（`:299`）修改；apply 用真实 proposal；手写 drop disposition／archive 请求 | 否，内部授权流程与 manifest 改写（`:242,289`） | v2 允许，A1 输入 |
| `H/WP1-handover-fixture.ts:272,280,287,290,298,320,323,411,414,417,445,464,469,473,547` | Lifecycle、Responsibility、Plan、Requeue、Workflow、SessionFacts/Directory、Review、Goal、Runtime SessionOperations；手写关联／转交／归档／draft／provenance；hold/release 使用真实 review（`:411`）；provenance 是真实 CreateSessionRequest 字段 | 否，手写 terminal fact（`:360`），attestation review 例外另列 `:379` | v2 允许，A1 输入 |
| `H/WP1-scenario-fixture.ts:182,202,203,210,255,271,293,294,323,332` | Workflow、Host scenario、read 工具、Anomaly、archive-state、Requeue、archive。组外 helper：`tests/scenarios/harness.ts`（`:69`）、`tests/scenarios/support/common.ts`（`:71`）；手写脚本／请求，Workflow next 来自真实结果；分页 cursor 来自 `:259`；requeue body 取公开读取 helper（`:293`） | 否，还读 SQL archive request（`:227`）和内部 manifest（`:343`） | v2 允许，A1 输入 |
| `H/WP1-units-fixture.ts:168,176,182,199,204,243,249,283,327` | Policy、Goal、Plan、Lifecycle；手写 policy／draft／link；激活 digest 用真实 install；apply 用真实 proposal | 否，其他 fixture 部分包含构造的 Runtime/Workflow 值（`:448,530,559`） | v2 允许，A1 输入 |
| `H/WP2-duties-fixture.ts:192` | UserMessage；手写 notify／decision_request 请求，由本文件 request builder 构造 | 否，前置策略 raw seed（`:122`）及 entered fact（`:168`） | v2 允许，A1 输入 |
| `H/WP2-notices-fixture.ts:116,121,126,162,185,186,193` | DecisionQueue、NoticeSettings、Mailbox、UserMessage、Query；手写消息／intent；mark token/seenThrough 直接取 page（`:117,122`）；咨询正文取公开 body read（`:185`） | 否，直接 answer body/observation（`:211,215`） | v2 允许，A1 输入 |
| `H/WP2-platform-support.ts:261,263,265,269,272,286,298,302,306,309,311,617,635,641,646,671,691,697,893,895,919` | Project、Policy、Architecture、Goal、Plan、Runtime、Material；手写初始化／draft／Session；digest/proposal 用真实返回；artifact 引用来自真实 prepare（`:917`） | 内存公开初始化链与 SQLite raw-policy 分支不同；后者直接提交见 `:579` | v2 允许，A1 输入 |
| `H/graph-session-fixture.ts:314,319,325,335,403,425,433,458,464` | Project、Policy、Goal、Plan、Architecture；手写初始化／draft／catalog；激活用真实安装快照的 digest（`:333`）；apply 用真实 proposal（`:435`） | `seedAcceptedTask` 的 propose/read/apply 是；其他 Session/raw helper 非公开（`:366,380`） | v2 允许，A1 输入 |
| `H/task-claim-fixture.ts:241,245,252,258,271,317,344,350,423,447,655` | Project、Policy、Architecture、Goal、Plan、Material；手写初始化／draft；digest/proposal 用真实返回；Query artifact 引用来自真实 preparation（`:650` 后） | 否，Kernel/raw helper 保留（`:311,367,461,471`） | v2 允许，A1 输入 |
| `H/K3-review-card-fixture.ts:294` | `recordDecisionApplication` 的 receipt：从 `decisionRecords.eventAt(cursor)`（`:288`）解析 identity/fingerprint（`:291`），在测试中重建 `{identityKey,fingerprint,cursor}`；经 `:315` 注入 decision actions | 否；重建回执随后交 owner | **F1：v2 A1“平台签发字段”** |
| `H/S2B-activity-fixture.ts:414` | `activateCompletionPolicy`：digest 在 `:415` 重新调用 digest 函数计算，没有直接使用 `:401` 的 install 返回字段 | 否 | **F1：v2 A1“平台签发字段”** |
| `H/S2B-runtime-steps-fixture.ts:183` | `activateCompletionPolicy`：digest 在 `:184` 重新计算，而不是直接用 `:170` 的 install 返回字段 | 随后继续真实运行 | **F1：v2 A1“平台签发字段”** |
| `H/S5R2-c-support.ts:98` | `recordDecisionApplication` receipt：从 records event（`:92`）解析 fingerprint（`:95`），测试重新组装 receipt 后注入 Workflow（`:147`） | 否 | **F1：v2 A1“平台签发字段”** |
| `H/WP1-handover-fixture.ts:379` | `resolveUnknownRun`：测试手写 `kernelTurnOpen`、`inputsConfirmed` 和 review inventory/workspace（`:380,381,382`），交内部 reconcile owner 接受 | 否，随后继续 handover | **F1：平台派生 review／分类，不是公开 attestation DTO** |
| `H/WP2-notices-fixture.ts:229` | 同类内部 `resolveUnknownRun`，手写 review 和 Kernel 判断（`:229,230,231`） | 否 | **F1：平台派生 review／分类** |
| `H/WP2-notices-fixture.ts:240` | `resolveUnknownQueryRun`：手写 `kernelTurnOpen:true`、`inputsConfirmed:null`，交 Query recovery owner | 否 | **F1：平台派生分类** |

回执最终进入 owner 的生产调用位置是 `src/business/workflow/decision-actions.ts:449`、`src/business/workflow/decision-actions.ts:459`；因此不能以“复制了生产 composition 的写法”豁免上述两个测试回执 builder。

### 2．记录存储自身测试

以下 109 个静态测试行及两个专用 helper 接收点，检查的是存储自己的契约，没有发现其中以手写存储状态检验上层业务结论的行。

| 文件与全部测试行／helper 行 | 实际检查对象 | 判定 |
|---|---|---|
| `D/R3a-transaction-boundaries.test.ts:46,76,103` | beforeWrite 次数、提交重放及返回值隔离；SQLite 多表事务回滚；同版本但损坏 canonical identity 的拒绝及零部分写入。Goal owner 是驱动器，断言对象是提交／存储边界（`:56,68,70,95,99,127,129`） | v2 允许，A1 存储自身契约 |
| `D/R3b-body-concurrency.test.ts:60` | 两个真实 SQLite 进程竞争相同 body 的首写 owner/source 与 content ref（`:90`）。组外 helper 是 `tests/record-store/sqlite-body-race-worker.mjs`，入口构造在 `:18,19`，两次启动在 `:74,75` | v2 允许，A1 存储自身契约 |
| `D/S2A-ordered-lookup.test.ts:152,192,228,263,293,338,362,414,441,499,540,613` | ordered lookup 的次序、边界、分页、过滤、注册、重开及查询约束 | v2 允许，A1 存储自身契约 |
| `D/S2C-count-lookup.test.ts:124,142,188,222,248,284,325` | count lookup 注册、计数、过滤、上限和重开建索引 | v2 允许，A1 存储自身契约 |
| `D/S4B-text-search.test.ts:33,47,61,75,94,108,122,136,150,164,183,196,209,222,236,249,269,284,299,313,361,380,400,418,441,455,469,489,504,525,539,558,571,584,597,610,624,639,652,675,692,709` | 文本匹配、规范化、模式／参数拒绝、更新、分页、候选上限、索引失效及重建、两后端一致性 | v2 允许，A1 存储自身契约 |
| `D/SP-literal-type.test.ts:65,76,142` | aggregateType 的注册安全、合法字面类型及类型隔离 | v2 允许，A1 存储自身契约 |
| `D/SP-lookup-index-migration.test.ts:107,154,188,223` | 部分／完整注册、连接间索引迁移，以及完整平台 schema 注册可用性；没有检验上层 Goal/Run 业务状态 | v2 允许，A1 存储自身契约 |
| `D/SP-record-store-limits.test.ts:113,130,167,194` | lookup／ordered lookup 的 limit、边界、next、after | v2 允许，A1 存储自身契约 |
| `D/SP-text-scan-undo.test.ts:14` | 存储文本索引纯函数的 bucket 回滚 | v2 允许，A5／存储自身契约 |
| `D/SP-text-scan.test.ts:72,87,109,131,173,198,215,245,270,290,313,330,347,371,402,428` | scan 次序、分页、匹配、复合键移动、跨连接追平／失效／重建、Unicode 处理 | v2 允许，A1 存储自身契约 |
| `D/WP2-notice-cursors.test.ts:61,78` | 注册的 cursor 字段白名单和 commit binding 校验；不是通知是否已读的业务结论 | v2 允许，A1 存储自身契约 |
| `D/lookup.test.ts:55,72,94,137,174` | 解码字段、UTF-8 次序、keyset 分页、提交／重放／失败原子性、重建和损坏行拒绝 | v2 允许，A1 存储自身契约 |
| `D/transaction-extensions.test.ts:46,57,75,92,116,132,154,174,196` | horizon、unique CAS、cursor binding、回滚、输入隔离、白名单冻结、跨连接竞争及重开 | v2 允许，A1 存储自身契约 |
| `H/S4B-text-search-support.ts:155,168` | 专供上述存储测试的 `seed`／`seedBatch`；构造 EncodedRecord、commit、fingerprint。调用见 `D/S4B-text-search.test.ts:38,679`、`D/SP-record-store-limits.test.ts:55`、`D/SP-text-scan.test.ts:77` | v2 允许，A1 的存储专用 helper 条款 |

### 3．存储之上的 F3

此表完整列出了本次已定位的 46 个静态写入点。调用列只写已经核到的路径，**不是全部传递调用者的完成声明**。透传真实 batch 的计数／门控 wrapper 没有作为新构造记录重复计数，例如 `H/B2-execution-fixture.ts:353`、`H/S5-application-support.ts:140`、`H/graph-session-fixture.ts:180`。

| 写入点 | 写入内容 | 已核调用／尚欠范围 | 判定 |
|---|---|---|---|
| `H/B2-execution-fixture.ts:233` | 篡改真实 manifest 后直接 body put；重组 prepared 的 bundleRef/digest（`:238`） | `W/B2-execution-entry.test.ts:149,150`。调用行位于普通 `it`，不是 A6 要求的 `describe('rejects: …')`，见该文件 `:143` | F3；不能仅凭 `:228` 的 A6 注释放行 |
| `H/B2-runtime-fixture.ts:204` | 手写 CoordinationPolicyRevision、ProjectCoordinationPolicyActive | 直接入口见 `C/B2-runtime-platform.test.ts:26`、`R/B2-runtime-execution.test.ts:36`；另经 `H/K-readonly-work-support.ts:64`、`H/S2B-runtime-store-fixture.ts:75`，全部传递调用清单未展开 | F3 |
| `H/C1-mailbox-fixture.ts:186,199` | 覆写 RunSnapshot；从 Session 读结果 mutate 后重新 commit SessionRecord | `W/C1-session-mailbox.test.ts:134,139,145,150,161,166,347,371` | F3 |
| `H/C2-runtime-platform-fixture.ts:106` | 手写策略修订与 active pointer | `C/A2-reconcile-classifier-platform.test.ts:57`、`C/AG1-session-discovery.test.ts:66`、`C/C2-runtime-platform.test.ts:43`、`C/S2B-39-run17-activity.test.ts:70`、`C/S2B-40-run20iii-activity.test.ts:52`、`R/C2-runtime-platform-tools.test.ts:138`、`tests/state/invariants.test.ts:379` | F3 |
| `H/K-boundary-facts-support.ts:79` | 向 Kernel store append 手写 resumed/input_accepted 事件 | `S/K-R-attested-facts-source.test.ts:171` | F3；不是 A7 damageKernel |
| `H/K-boundary-facts-support.ts:118` | 向 Kernel append 手写 assistant.message_completed、tool.started | `S/K-R-attested-facts-source.test.ts:309,377` | F3；不是 A7 damageKernel |
| `H/K-readonly-work-support.ts:80` | 新策略修订及 active pointer，移除 role catalog | `R/K-readonly-command.test.ts:548`；构造内容见 helper `:71` | F3 |
| `H/K-session-support.ts:119,151,194` | Kernel Session header、turn.started、手写 agent.event | `tests/kernel/K-close-open-turn.test.ts:36`、`tests/kernel/K-interrupted-history.test.ts:347`、`C/K-R-close-open-turn.test.ts:62`、`C/K3-R1-close-open-turn.test.ts:41`；各方法的完整调用分布尚未展开 | F3；v2 的存储例外限于 `src/core/record-store` |
| `H/S1-workflow-archive-fixture.ts:522` | 手写查询回答正文，随后写 terminal observation（`:531`） | `B/S1-archive-flow.test.ts:508,558`、`B/S1-session-maintenance.test.ts:331` 进入 consultation helper；answer 的全部具体调用点待展开 | F3 |
| `H/S2A-notices-workspace2-fixture.ts:109` | 直接 Kernel Session create | `W/S2A-notices-workspace.test.ts:28` → `openW2World`（helper `:190`） | F3 |
| `H/S2A-planning-fixture.ts:91` | planning answer 正文直接 body put | `W/S2A-queue-derived-cards.test.ts:21` | F3 |
| `H/S2B-be1-platform-fixture.ts:208` | 手写策略修订及 active pointer | 入口包括 `tests/app/RL-34-wiring-resource-caps.test.ts:89`、`C/S2B-be1-counting-failure.test.ts:79`、`C/S2B-be1-cross-hour.test.ts:17`、`C/S2B-be1-five-tools.test.ts:24`、`C/S2B-be1-step-boundaries.test.ts:17`、`C/S2B-be1-usage.test.ts:17`、`C/S2B-be1s-shell.test.ts:34`、`R/RL-30-shell-resource-caps.test.ts:36`、`R/RL-31-readonly-resource-caps.test.ts:226`、`R/RL-35-36-sandbox-and-retry.test.ts:40`、`W/S2B-r2-v-real-runs.test.ts:64` | F3 |
| `H/S2B-r2-activity-support.ts:69` | 手写 RunSnapshot | `W/S2B-r2-keyed-cap.test.ts:68`、`W/S2B-r2-never-entered.test.ts:32`、`W/S2B-r4-session-workspace.test.ts:68` | F3 |
| `H/S2B-r2-track-support.ts:75` | 从现有 Run 记录复制、改写后 commit | `W/S2B-r2-r5-not-entered.test.ts:39,54`、`W/S2B-r4-session-workspace.test.ts:48` | F3 |
| `H/S2B-r3-r4-support.ts:39` | 从 store Session 复制并改 workspace 后 commit | `W/S2B-r4-session-workspace.test.ts:46,66` | F3 |
| `H/S2B-track-fixture.ts:613` | 查询回答正文直接 body put | `W/S2B-30-track-bars.test.ts:337,339,342`、`W/S2B-r3-consultation-cap.test.ts:46` | F3 |
| `H/S2C-D-node-support.ts:297` | Kernel Session create | 入口包括 `W/S2C-node-detail-hover.test.ts:21`、`W/S2C-node-detail-task.test.ts:22`、`W/S2C-node-detail-executions.test.ts:20`、`W/S2C-node-detail-bounded.test.ts:78`、`W/S2C-node-detail-anomalies.test.ts:98`、`W/S2C-node-detail-next-kinds.test.ts:130`、`W/S2C-lines-read-only.test.ts:147`、`W/S4C-node-notes.test.ts:107`、`W/S4C-path-ownership-callers.test.ts:88`；逐方法全部调用尚未展开 | F3 |
| `H/S2C-L-runs-support.ts:420` | answered consultation 正文直接 body put；非 answered 分支不走此点 | `W/S2C-lines-copies.test.ts:56,102`、`W/S2C-lines-latest-generation.test.ts:50,64,66`、`W/S2C-lines-page.test.ts:66,75,77,145,165,191`；另经 `H/S2C-X-scale-fixture.ts:440` → `W/S2C-lines-scale.test.ts:43` | F3 |
| `H/S2C-X-scale-fixture.ts:405,427` | 改写 picker Run；复制现有 Run 形成批量 Run records | `W/S2C-lines-scale.test.ts:43` | F3 |
| `H/S4A-note-fixture.ts:239` | Kernel Session create，由 `createSession`／`claimRun` 到达（`:231,270`） | 已核入口包括 `W/S4A-note-write.test.ts:32`、`W/S4A-note-history.test.ts:37`、`W/S4A-note-symbol.test.ts:84`、`R/S4C-note-related-find.test.ts:41`；共享 note/check/memory helper 的全部方法调用未展开 | F3 |
| `H/S4A-note-scope-fixture.ts:250` | Kernel Session create；初始化多名 scribe/executor（`:277`） | `W/S4A-note-scope.test.ts:92`、`W/S4A-note-history.test.ts:52`、`W/S4A-note-failures.test.ts:152`；另经 `H/S4A-note-fault-fixture.ts:123`、`H/S4C2-note-card-fixture.ts:271`，全部传递调用未展开 | F3 |
| `H/S4B-memory-fixture.ts:102` | extra Goal 的 Kernel Session create | `W/S4B-memory-current-filter.test.ts:35`、`W/S4B-memory-l12-bounds.test.ts:176`、`W/S4B-memory-paging.test.ts:111`、`W/S4C-default-states.test.ts:60`、`W/S4C-project-understanding.test.ts:47` | F3 |
| `H/S4C2-note-card-fixture.ts:182` | `createAuxSession` 直接 Kernel create | `W/S4C2-D-rows.test.ts:231`、`W/S4C2-scribe-user-reason.test.ts:108` | F3 |
| `H/S5-decision-fixture.ts:544,1117,1118,1119` | 通用 seed commit；GoalSnapshot、PlanRevisionSnapshot、PlanProposal 编码包装 | proposal 调用：`W/S2A-queue-request-candidates.test.ts:72`、`W/WP2-context-extensions.test.ts:319`；通用 seed 调用：`W/S2A-queue-goal-runs.test.ts:47`、`W/S5-goal-cause-at-least-cursor.test.ts:20`、`W/WP2-message-duties.test.ts:94`、`H/WP2-duties-fixture.ts:122`。两个 snapshot 包装未找到方法调用，定义仍保留 | F3 |
| `H/S5-decision-fixture.ts:604` | Kernel Session create；初始化在 `:612,613` 调用 | `openS5DecisionFixture` 及 K3/notice 包装调用广泛，例如 `W/S5-decision-queue.test.ts:52`、`H/K3-review-card-fixture.ts:149`、`H/S2A-notices-support.ts:44`；完整传递调用清单未展开 | F3 |
| `H/S5-decision-fixture.ts:1079` | 手写空 records commit，利用故意冲突的 unique claim 探测存储 owner | `storeSnapshot` 在 `:1031` 定义；例如 `H/S5R2-a-support.ts:125,134` 使用。该 probe 预期拒绝，仍是上层测试直接调用存储 commit；不是存储自身契约测试 | F3 |
| `H/S5-queue-support.ts:237` | planning answer 正文直接 body put | `W/S5-decision-queue.test.ts:93,228` | F3 |
| `H/W2-whiteboard-fixture.ts:352` | 手写 agent PlanProposal 和 seed event | `W/W2-agent-whiteboard.test.ts:192,213,384,464`、`W/A2-disposition-change.test.ts:599` | F3 |
| `H/WP1-entry-fixture.ts:289` | 改写 manifest/context binding，存新 body 后重组 prepared（`:292`） | `W/WP1-goal-content-entry.test.ts:66,106`；普通 describe 在 `:46`，GE06 同时改 Goal digest 与 Workspace revision（`:106`），不满足完整 A6 条件 | F3 |
| `H/WP2-duties-fixture.ts:122` | 手写 coordination policy 和 active pointer | `openWP2DutiesFixture` 在 `:98`；尚未确认实际调用该 builder 的测试路径，不能把仅导入 `wp2RoleContent` 的测试算作调用 | F3 写入定义；调用待核 |
| `H/WP2-notices-fixture.ts:211,265` | 查询回答 body；空 records 的 unique-claim probe commit | `W/WP2-undelivered-notices.test.ts:33` 进入夹具；分别由 answer（helper `:209`）和 storeSnapshot（`:245`）到达，全部具体测试行待展开 | F3 |
| `H/WP2-platform-support.ts:579` | SQLite／非 memory 分支直接提交策略及 active pointer | `C/WP2-wiring.test.ts:29`、`S/WP2-wiring-scenario.test.ts:76`、`R/S4C2-assembly.test.ts:283`、`W/S4C2-update-due.test.ts:141`；各 options 分支仍需逐项核对，不把 memory 分支自动算入 | F3 |
| `H/graph-session-fixture.ts:366,380` | 通用 raw records commit；Kernel Session create | raw 调用 `W/A1-session-independent.test.ts:127`；Session helper 的调用见 `W/A1-session-discovery.test.ts:24`、`W/A1-session-lifecycle.test.ts:29`，完整逐方法调用未展开 | F3 |
| `H/task-claim-fixture.ts:311,367,461,471` | 通用 raw commit；Kernel Session create；手写 Run；改写 SessionRecord | raw／overwrite 已核 `W/R4c-task-claim-boundaries.test.ts:56,96`、`W/R4c-task-claim.test.ts:265,334`、`W/R4c-execution-read.test.ts:452,472,474`、`W/B2-execution-result.test.ts:98,105,137`、`R/A2-reconcile-runtime.test.ts:965`。Kernel create 在初始化 `:376,377` 必经，传递调用范围很大；`:461` 的实际调用者尚未确认 | F3 |

### 4．A7

| 命名 helper | L1 结果 | 边界依据 |
|---|---|---|
| `buildNoteTools` | 本组未检出使用；不能把其他 note helper 当成此项豁免 | `.lead-ref/books/test-rule-sheet-v2.md:44` |
| `damageKernel` | 本组未检出使用。`H/K-boundary-facts-support.ts:79,118` 是新增 Kernel 事实，不是该命名损坏注入 | `.lead-ref/books/test-rule-sheet-v2.md:49` |
| `process-sandbox-standin`／`executeChecks` | 本组未检出使用；`H/RL-kernel-sandbox-double.ts:1` 是另一个 helper，不能因此取得 A7 豁免 | `.lead-ref/books/test-rule-sheet-v2.md:59` |

### 无独立实例

这里的“无独立实例”仅指本次四类目标：不把同组 helper 的原样转发再算一次，也不表示这些文件通过 F4 等其他规则审查。

- `tests/architecture/boundaries.test.ts:1`
- `tests/architecture/production-reach.test.ts:1`
- `tests/architecture/production-reach.ts:1`
- `tests/architecture/record-store-literal-type.test.ts:1`
- `tests/architecture/state-writes.test.ts:1`
- `tests/context/verification-workspace-reader.test.ts:1`
- `tests/contracts/A2-rework-contract-helpers.test.ts:1`
- `tests/contracts/RL-21-default-resource-cap-settings.test.ts:1`
- `tests/contracts/ledger-cursor.test.ts:1`
- `tests/contracts/review-admission.test.ts:1`
- `H/B2-09b-crash.ts:1`
- `H/K-legacy-reader-support.ts:1`
- `H/K-readonly-host-support.ts:1`
- `H/K3-07-support.ts:1`
- `H/K3-35-prepare.ts:119`
- `H/K3-35-required-review-block.ts:1`
- `H/K3-35-runtime.ts:157`
- `H/K3-continuation-pure-fixture.ts:1`
- `H/K3-mailbox-seam.ts:53`
- `H/K3-mixed-seams.ts:55`
- `H/K3-padded-review-record.ts:1`
- `H/K3-real-workspace.ts:91`
- `H/K3-tool-seams.ts:59`
- `H/RL-kernel-sandbox-double.ts:1`
- `H/RL-resource-caps-support.ts:93`
- `H/S2A-route-storage-support.ts:1`
- `H/S2A-window-fixture.ts:98`
- `H/S2B-be1r-kernel-faults-support.ts:41`
- `H/S2B-be1r2-support.ts:111`
- `H/S2B-counting-off-support.ts:17`
- `H/S2B-kernel-records-fixture.ts:202`（只加入内存数组，未提交 store）
- `H/S2B-runtime-store-fixture.ts:75`
- `H/S2B-runtime-tools-support.ts:72`
- `H/S2C-P-pins-fixture.ts:174`
- `H/S4A-note-fault-fixture.ts:102`
- `H/S4A-note-interleave-fixture.ts:76`
- `H/S4B-note-check-fixture.ts:156`
- `H/change-stream-reader.ts:70`
- `H/executed-files-stub.ts:1`
- `H/orchestration-fixture.ts:151`

JSON 中 `line` 为同一分组的全部静态行号；`note` 所称“同名表行”包含该组的字段来源、后续路径和未完成项。

```json
[
  {"section":"A1","file":"tests/core/work-graph/MVP-execution-list.test.ts","line":[45,48,68,74,92,96,101],"owner":"ExecutionReadPort.listExecutions","value":"手写分页与作用域；cursor取真实page1.nextCursor","verdict":"v2 允许","note":"A1；拒绝变体未被接受为派生事实；见同名表行"},
  {"section":"A1","file":"tests/helpers/A2-restart-fixture.ts","line":[94,110,122,137,158,171,182,250,255],"owner":"Workflow/Plan/Control/GoalControl/Query","value":"手写公开请求；next与版本取公开返回","verdict":"v2 允许","note":"本helper局部公开；全部调用方待核"},
  {"section":"A1","file":"tests/helpers/AG2b-collaboration-fixture.ts","line":[418,442,444,446,450,453,458,461,464,477,488,514,526,537,553,557,566],"owner":"Project/Policy/Architecture/Goal/Plan/Runtime/Session/Query/Mailbox","value":"手写公开请求；token、digest、proposal、prepared取真实公开步骤","verdict":"v2 允许","note":"来源见同名表行"},
  {"section":"A1","file":"tests/helpers/B2-401-world.ts","line":[248,331],"owner":"Review/Workflow.resolveDecision","value":"手写分页与选择；cursor/card来自公开读","verdict":"v2 允许","note":"输入允许；后续含内部读取"},
  {"section":"A1","file":"tests/helpers/B2-blocked-runtime.ts","line":[169,281,343,360,424],"owner":"Control/Review/Workflow/request_command_rerun","value":"手写请求；版本和card取真实读","verdict":"v2 允许","note":"不豁免F4；后续非纯公开"},
  {"section":"A1","file":"tests/helpers/B2-crr-world.ts","line":[123,137,150,308],"owner":"shell/Review/Decision/request_command_rerun","value":"手写命令与选择；source/pins取card","verdict":"v2 允许","note":"后续直接applyDisposition"},
  {"section":"A1","file":"tests/helpers/B2-execution-fixture.ts","line":[145,160,163,167],"owner":"Goal/Plan","value":"手写Goal与draft；apply取真实proposal","verdict":"v2 允许","note":"后续进入内部entry夹具"},
  {"section":"A1","file":"tests/helpers/B2-runtime-fixture.ts","line":[209],"owner":"Runtime.createSession","value":"手写Session请求；role pin取安装结果","verdict":"v2 允许","note":"同夹具有F3策略提交"},
  {"section":"A1","file":"tests/helpers/K-t1-support.ts","line":[64,76],"owner":"组外common helper/Host/Requeue","value":"手写模式、requestId、reason；Run取恢复结果","verdict":"v2 允许","note":"helper文件tests/scenarios/support/common.ts；全部组外链待核"},
  {"section":"A1","file":"tests/helpers/K3-35-continuation-fixture.ts","line":[432,501,675,681,686,708,738,746,843,899],"owner":"Plan/Runtime/Attestation/Review/Requeue/Anomaly/shell","value":"手写公开请求；prepared取真实prepare；公开attestation不含手写review","verdict":"v2 允许","note":"后续含manifest与Kernel内部读取"},
  {"section":"A1","file":"tests/helpers/K3-blocked-command-fixture.ts","line":[197,266,340,370,503,563],"owner":"Plan/工具/Runtime/Review/Workflow","value":"手写工具请求；prepared与card取真实步骤","verdict":"v2 允许","note":"563的已核调用为tests/runtime/K3-review-preparation.test.ts:397；全部调用方待核"},
  {"section":"A1","file":"tests/helpers/K3-crr-fixture.ts","line":[111,163,167],"owner":"Review/Plan/Requeue","value":"手写分页与requeue；cursor和版本来自公开读","verdict":"v2 允许","note":"后续含内部claim"},
  {"section":"A1","file":"tests/helpers/K3-prefix-claim.ts","line":[106,111],"owner":"Plan/Requeue","value":"手写理由；版本来自公开Goal和Run","verdict":"v2 允许","note":"后续含内部claim"},
  {"section":"A1","file":"tests/helpers/K3-proposal-round.ts","line":[177,203,211,281,436,659,708],"owner":"Plan/Review/Runtime/Workflow/propose_safer_method","value":"draft从内部plan window修改；proposal、prepared、card取真实步骤；工具参数手写","verdict":"v2 允许","note":"输入允许；后续非纯公开"},
  {"section":"A1","file":"tests/helpers/K3-review-card-fixture.ts","line":[120,122,128,230,360,377,383,450],"owner":"Plan/Review/read工具","value":"draft从已采用plan或内部window修改；apply取真实proposal","verdict":"v2 允许","note":"回执重建另列F1"},
  {"section":"A1","file":"tests/helpers/R3e-evidence-fixture.ts","line":[171,180,187,209,216,233,373,380,394,401],"owner":"Policy/Goal/Plan","value":"手写policy、Goal、draft；digest和proposal取真实返回","verdict":"v2 允许","note":"后续含内部entry/result"},
  {"section":"A1","file":"tests/helpers/RL-query-fixture.ts","line":[131,132,136,155,159,163,167,169,171],"owner":"Project/Goal/Query/Runtime","value":"手写公开请求；Session、prepared取真实返回","verdict":"v2 允许","note":"局部运行链公开"},
  {"section":"A1","file":"tests/helpers/RL-re2-support.ts","line":[33,68,75,80],"owner":"Runtime/Control","value":"手写history/start/cancel；prepared和intentRef原样取真实返回","verdict":"v2 允许","note":"局部链公开"},
  {"section":"A1","file":"tests/helpers/S1-archive-service-fixture.ts","line":[216,225,252,295,309,335,369,371],"owner":"Mailbox/Control/Lifecycle/Requeue/read工具","value":"手写消息、回复、控制、关联和工具参数","verdict":"v2 允许","note":"后续含手写entered/terminal/history"},
  {"section":"A1","file":"tests/helpers/S1-public-anchor.ts","line":[98],"owner":"Workflow.archiveLine","value":"手写公开archive请求","verdict":"v2 允许","note":"完整调用方后续待核；不豁免替身"},
  {"section":"A1","file":"tests/helpers/S1-runtime-scenario-fixture.ts","line":[257,266,271,278],"owner":"Runtime/Lifecycle/Requeue","value":"手写请求；prepared取真实prepare","verdict":"v2 允许","note":"含内部claim准备路径"},
  {"section":"A1","file":"tests/helpers/S1-session-facts-fixture.ts","line":[269,274,284,304,316,325,365],"owner":"Mailbox/Goal/Query/Control","value":"手写请求；咨询正文取公开body read","verdict":"v2 允许","note":"后续含内部事实写入"},
  {"section":"A1","file":"tests/helpers/S1-workflow-archive-fixture.ts","line":[389,450,460,468],"owner":"Mailbox/Plan/Query","value":"手写咨询和intent；版本来自读结果","verdict":"v2 允许","note":"后续body直接写入另列F3"},
  {"section":"A1","file":"tests/helpers/S2A-notices-overbound-fixture.ts","line":[92,95,116],"owner":"Mailbox/UserMessage","value":"手写inquiry、response、notify","verdict":"v2 允许","note":"含内部pin读取"},
  {"section":"A1","file":"tests/helpers/S2A-notices-support.ts","line":[83,88,136,145,152,158,175,178,220],"owner":"DecisionQueue/NoticeSettings/Project/Policy/Goal/Plan/Requeue","value":"手写公开请求；digest、proposal取真实返回；token/seenThrough取真实page","verdict":"v2 允许","note":"mark已核调用与来源见同名表行；内部pin读取仍存在"},
  {"section":"A1","file":"tests/helpers/S2A-planning-fixture.ts","line":[37,59,67],"owner":"Goal/Query","value":"手写Goal与intent","verdict":"v2 允许","note":"后续answer body直接写入"},
  {"section":"A1","file":"tests/helpers/S2A-queue-fixture.ts","line":[60,73,95,107,117],"owner":"Mailbox/UserMessage/Decision/DecisionQueue","value":"手写消息和分页；options/objects/source来自真实消息","verdict":"v2 允许","note":"全部后续待核"},
  {"section":"A1","file":"tests/helpers/S2B-activity-fixture.ts","line":[268,296,309,346,364,372,401,425,524,561,577],"owner":"Plan/Lifecycle/Policy/Control/Goal/Activity","value":"手写公开请求；apply取真实proposal","verdict":"v2 允许","note":"后续内部事实写入；414的digest另列F1"},
  {"section":"A1","file":"tests/helpers/S2B-be1-platform-fixture.ts","line":[305,328,333],"owner":"Runtime/Activity","value":"手写启动与查询；prepared取真实prepare","verdict":"v2 允许","note":"前置raw policy另列F3"},
  {"section":"A1","file":"tests/helpers/S2B-be2-reconcile-support.ts","line":[114,160,171],"owner":"Control/Activity","value":"手写控制与读取请求；版本取公开execution","verdict":"v2 允许","note":"全部后续待核"},
  {"section":"A1","file":"tests/helpers/S2B-r2-activity-support.ts","line":[51,84],"owner":"Plan.queryGoal","value":"夹具Goal引用","verdict":"v2 允许","note":"同文件Run直接写入另列F3"},
  {"section":"A1","file":"tests/helpers/S2B-r2-backfill-kernel-support.ts","line":[78,92],"owner":"read工具/Runtime.startRun","value":"手写路径；prepared取真实prepare","verdict":"v2 允许","note":"局部真实Runtime；全部后续待核"},
  {"section":"A1","file":"tests/helpers/S2B-r2-calendar-reverify-support.ts","line":[75,136],"owner":"Plan/Evidence.reverifyRound","value":"手写请求；predecessor取已有round","verdict":"v2 允许","note":"含内部check result/finalize"},
  {"section":"A1","file":"tests/helpers/S2B-r2-timeline-public-flows.ts","line":[76,132],"owner":"Plan/Control","value":"手写控制；版本取公开Run","verdict":"v2 允许","note":"entered fact另经内部owner"},
  {"section":"A1","file":"tests/helpers/S2B-runtime-steps-fixture.ts","line":[170,357,383,391],"owner":"Policy/Runtime/Control","value":"手写请求；prepared与intentRef取真实返回","verdict":"v2 允许","note":"183的digest另列F1"},
  {"section":"A1","file":"tests/helpers/S2B-task-timeline-fixture.ts","line":[241,271,293,295,302,311,317,331,333,343,356,376,400,411,516,537,570,579,692],"owner":"Goal/Plan/Control/Requeue/Timeline/平台工具","value":"手写请求；修订draft取公开plan；proposal/message取真实返回；cursor透传","verdict":"v2 允许","note":"内部pin读取；全部cursor调用链待核"},
  {"section":"A1","file":"tests/helpers/S2B-track-fixture.ts","line":[263,281,288,298,312,450,469,500,504,566,578,638,709,750,771],"owner":"Plan/Goal/Control/Lifecycle/Requeue/Query/Track","value":"手写公开请求；proposal取真实返回；cursor透传","verdict":"v2 允许","note":"后续直接body/terminal；cursor调用链待核"},
  {"section":"A1","file":"tests/helpers/S2C-D-node-support.ts","line":[201,205,211,218,241,249,281,284,317,325,362,370,421,442,457,476,482],"owner":"Project/Policy/Architecture/Goal/Plan/Lifecycle/Requeue/Query","value":"手写初始化、draft、控制和intent；digest/proposal取真实返回","verdict":"v2 允许","note":"Kernel直接创建另列F3"},
  {"section":"A1","file":"tests/helpers/S2C-K-scenario-support.ts","line":[44,49,55,61,67,158],"owner":"WorkLine/HostConversation/Workflow","value":"手写查询和初始maintenance选择；next取真实返回；cursor透传","verdict":"v2 允许","note":"组外helper为tests/scenarios/harness.ts；分页调用方待核"},
  {"section":"A1","file":"tests/helpers/S2C-K2-scenario-support.ts","line":[18,19,24],"owner":"read工具/GraphHover","value":"手写路径和Goal请求","verdict":"v2 允许","note":"组外Host helper为tests/scenarios/harness.ts；后续待核"},
  {"section":"A1","file":"tests/helpers/S2C-L-check-support.ts","line":[139,147,214],"owner":"Policy/Plan","value":"手写policy；digest取真实install返回","verdict":"v2 允许","note":"含Evidence内部步骤"},
  {"section":"A1","file":"tests/helpers/S2C-L-line-support.ts","line":[263,275,290,330,334,341,355,385,407,415,423],"owner":"Lifecycle/Responsibility/Goal/Plan/LineSettings","value":"手写公开请求；proposal取真实返回","verdict":"v2 允许","note":"Session通过内部recordSessionCreated登记"},
  {"section":"A1","file":"tests/helpers/S2C-L-runs-support.ts","line":[182,217,225,250,263,285,289,309,344,352,357],"owner":"Control/Goal/Plan/Query/Mailbox","value":"手写控制、Goal、intent与咨询","verdict":"v2 允许","note":"后续answer body与observation直接写入"},
  {"section":"A1","file":"tests/helpers/S2C-X-scale-fixture.ts","line":[357,365],"owner":"Mailbox","value":"手写消息与回复；Run信息来自execution读","verdict":"v2 允许","note":"后续Run直接提交"},
  {"section":"A1","file":"tests/helpers/S4A-note-fixture.ts","line":[178,180,182,187,191,201,222,225,252,282],"owner":"Project/Policy/Architecture/Goal/Plan/Note","value":"手写初始化、draft与note；digest/proposal取真实返回","verdict":"v2 允许","note":"Kernel直接创建；note调用方全部后续待核"},
  {"section":"A1","file":"tests/helpers/S4A-note-scope-fixture.ts","line":[156,158,160,165,184,191,212,215,220,234,237,263,302,325,329],"owner":"Project/Policy/Architecture/Goal/Plan/Lifecycle/Note","value":"手写公开请求；digest/proposal取真实返回；review为公开note请求","verdict":"v2 允许","note":"Kernel直接创建；末端调用方待核"},
  {"section":"A1","file":"tests/helpers/S4B-memory-fixture.ts","line":[58,61,79,82,111],"owner":"Project/Goal/Plan","value":"手写Goal与draft；apply取真实proposal","verdict":"v2 允许","note":"后续Kernel直接创建"},
  {"section":"A1","file":"tests/helpers/S4B-note-multi-scope-fixture.ts","line":[92,105,108,115,118,121,126,130,140,151,154,171,195,206,211,213],"owner":"Project/Policy/Architecture/Goal/Plan","value":"手写作用域与draft；修改基线取已采用plan；digest/proposal取真实返回","verdict":"v2 允许","note":"全部后续待核"},
  {"section":"A1","file":"tests/helpers/S4C-node-notes-fixture.ts","line":[50],"owner":"Control.submitControl","value":"手写cancel；版本取公开execution","verdict":"v2 允许","note":"外围有内部Session/claim"},
  {"section":"A1","file":"tests/helpers/S4C2-note-card-fixture.ts","line":[200,221,244,249,251,261,299,308,314,320,330,338,348,354,356,360,370,377,387,389],"owner":"Plan/Note/Decision/Workflow/GoalControl/NoticeSettings","value":"手写公开请求；card lookup key手写；resolve取card.source；mark取真实page token/seenThrough","verdict":"v2 允许","note":"全部组外page/card来源与后续待核；182另列F3"},
  {"section":"A1","file":"tests/helpers/S5-application-support.ts","line":[119],"owner":"DecisionQueue","value":"手写workspace、sections、page","verdict":"v2 允许","note":"夹具有内部读取和提交观察"},
  {"section":"A1","file":"tests/helpers/S5-decision-fixture.ts","line":[566,572,621,626,638,646,652,674,686,705,738,744,751,928,938,985,999],"owner":"Project/LineSettings/Policy/Architecture/GoalSettings/Plan/Query/UserMessage/Decision","value":"手写公开请求；digest/proposal/decision source取真实返回","verdict":"v2 允许","note":"内部事实、raw seed与probe另见表"},
  {"section":"A1","file":"tests/helpers/S5-queue-support.ts","line":[181,198,209,278,280,284,300,305,313,326,329,376,408],"owner":"Goal/Query/Project/Policy/Plan/Requeue/Evidence","value":"手写公开请求；digest/proposal/round取已有真实值","verdict":"v2 允许","note":"answer body直接写入"},
  {"section":"A1","file":"tests/helpers/S5-user-message-support.ts","line":[95],"owner":"UserMessage.sendUserMessage","value":"手写消息；options/objects复制真实消息","verdict":"v2 允许","note":"不豁免F4"},
  {"section":"A1","file":"tests/helpers/S5R2-a-support.ts","line":[36,41,82,98,113,133,172],"owner":"RequestCandidate/Plan/Decision/Goal","value":"手写请求；draft由内部plan修改；apply取真实proposal；card source为查询标识","verdict":"v2 允许","note":"后续内部storeSnapshot"},
  {"section":"A1","file":"tests/helpers/S5R2-b-support.ts","line":[153,189,200,235,253,260,264,305],"owner":"GoalSettings/Plan/DecisionQueue","value":"手写settings；draft由公开graph plan修改；apply取proposal","verdict":"v2 允许","note":"后续内部快照断言"},
  {"section":"A1","file":"tests/helpers/S5R2-c-support.ts","line":[157,279,284],"owner":"DecisionConflicts/Plan","value":"手写查询与future task；draft基于已采用plan","verdict":"v2 允许","note":"回执重建另列F1"},
  {"section":"A1","file":"tests/helpers/S5R2-d-support.ts","line":[63,72,134],"owner":"GoalSettings/CollaborationDriver","value":"手写顺序与查询","verdict":"v2 允许","note":"不豁免后续Workflow/Runtime替身"},
  {"section":"A1","file":"tests/helpers/S8A-L8-prepare.ts","line":[45],"owner":"Material.openArtifact","value":"手写打开请求；artifact取真实prepare","verdict":"v2 允许","note":"局部公开"},
  {"section":"A1","file":"tests/helpers/S8A-L8-reminder-world.ts","line":[377,379,389,394,403,413,445,449,454,462,464,484,510,514,560],"owner":"Project/Policy/Architecture/Goal/Plan/Runtime","value":"手写初始化、draft、capture；digest/proposal取真实返回","verdict":"v2 允许","note":"局部公开；全部测试后续待核"},
  {"section":"A1","file":"tests/helpers/S8D-platform-fixture.ts","line":[184,189,210,223,234,251,264,267],"owner":"Project/Architecture","value":"手写catalog、capture、查询和比较；引用取真实返回；cursor为null","verdict":"v2 允许","note":"局部公开"},
  {"section":"A1","file":"tests/helpers/W2-whiteboard-fixture.ts","line":[258,294,298,303,309,313],"owner":"Plan","value":"手写或调用方提供draft、basedOn、reason、proposal引用","verdict":"v2 允许","note":"全部传入值来源与后续待核；352另列F3"},
  {"section":"A1","file":"tests/helpers/WP1-entry-fixture.ts","line":[224,299,310,314,392,397,418,434],"owner":"Plan/Lifecycle/Workflow/Anomaly","value":"draft由公开graph修改；手写归档与drop请求","verdict":"v2 允许","note":"内部授权和manifest改写另见表"},
  {"section":"A1","file":"tests/helpers/WP1-handover-fixture.ts","line":[272,280,287,290,298,320,323,411,414,417,445,464,469,473,547],"owner":"Lifecycle/Responsibility/Plan/Requeue/Workflow/Session/Review/Goal/Runtime","value":"手写公开请求与Session provenance；hold/release取真实review","verdict":"v2 允许","note":"379的手写review另列F1"},
  {"section":"A1","file":"tests/helpers/WP1-scenario-fixture.ts","line":[182,202,203,210,255,271,293,294,323,332],"owner":"Workflow/Host/read工具/Anomaly/Requeue/Archive","value":"手写脚本与请求；next/cursor取真实返回；requeue body取组外公开读取helper","verdict":"v2 允许","note":"组外helper在tests/scenarios/harness.ts及support/common.ts；后续有SQL/manifest读取"},
  {"section":"A1","file":"tests/helpers/WP1-units-fixture.ts","line":[168,176,182,199,204,243,249,283,327],"owner":"Policy/Goal/Plan/Lifecycle","value":"手写policy、draft、link；digest/proposal取真实返回","verdict":"v2 允许","note":"不豁免该文件其他构造Runtime/Workflow值"},
  {"section":"A1","file":"tests/helpers/WP2-duties-fixture.ts","line":[192],"owner":"UserMessage","value":"手写notify/decision_request","verdict":"v2 允许","note":"前置raw policy与entered fact"},
  {"section":"A1","file":"tests/helpers/WP2-notices-fixture.ts","line":[116,121,126,162,185,186,193],"owner":"DecisionQueue/NoticeSettings/Mailbox/UserMessage/Query","value":"手写公开请求；token/seenThrough取真实page；正文取公开body read","verdict":"v2 允许","note":"后续body/observation直接写入"},
  {"section":"A1","file":"tests/helpers/WP2-platform-support.ts","line":[261,263,265,269,272,286,298,302,306,309,311,617,635,641,646,671,691,697,893,895,919],"owner":"Project/Policy/Architecture/Goal/Plan/Runtime/Material","value":"手写公开请求；digest/proposal/prepared artifact取真实返回","verdict":"v2 允许","note":"memory和SQLite分支须区分；579另列F3"},
  {"section":"A1","file":"tests/helpers/graph-session-fixture.ts","line":[314,319,325,335,403,425,433,458,464],"owner":"Project/Policy/Goal/Plan/Architecture","value":"手写初始化、draft、catalog；digest/proposal取真实返回","verdict":"v2 允许","note":"seedAcceptedTask公开；其他raw/Kernel路径另列F3"},
  {"section":"A1","file":"tests/helpers/task-claim-fixture.ts","line":[241,245,252,258,271,317,344,350,423,447,655],"owner":"Project/Policy/Architecture/Goal/Plan/Material","value":"手写初始化和draft；digest/proposal/artifact取真实返回","verdict":"v2 允许","note":"raw/Kernel路径另列F3"},

  {"section":"A1","file":"tests/helpers/K3-review-card-fixture.ts","line":[294],"owner":"DecisionMessage.recordDecisionApplication","value":"从records.eventAt重建identityKey、fingerprint、cursor receipt","verdict":"F1","note":"v2 A1平台签发字段；来源288、291；注入315"},
  {"section":"A1","file":"tests/helpers/S2B-activity-fixture.ts","line":[414],"owner":"CompletionPolicy.activateCompletionPolicy","value":"重新计算digest","verdict":"F1","note":"v2 A1平台签发字段；计算415，真实install401"},
  {"section":"A1","file":"tests/helpers/S2B-runtime-steps-fixture.ts","line":[183],"owner":"CompletionPolicy.activateCompletionPolicy","value":"重新计算digest","verdict":"F1","note":"v2 A1平台签发字段；计算184，真实install170"},
  {"section":"A1","file":"tests/helpers/S5R2-c-support.ts","line":[98],"owner":"DecisionMessage.recordDecisionApplication","value":"从eventAt重建receipt/fingerprint","verdict":"F1","note":"v2 A1平台签发字段；来源92、95；注入147"},
  {"section":"A1","file":"tests/helpers/WP1-handover-fixture.ts","line":[379],"owner":"RunReconcile.resolveUnknownRun","value":"手写Kernel判断及review inventory/workspace","verdict":"F1","note":"平台派生review/分类；构造380至382"},
  {"section":"A1","file":"tests/helpers/WP2-notices-fixture.ts","line":[229,240],"owner":"RunReconcile.resolveUnknownRun/Query.resolveUnknownQueryRun","value":"手写review或kernelTurnOpen/inputsConfirmed","verdict":"F1","note":"平台派生review/分类"},

  {"section":"record-store","file":"tests/record-store/R3a-transaction-boundaries.test.ts","line":[46,76,103],"owner":"RecordStore","value":"beforeWrite、隔离、重放、回滚、canonical identity校验","verdict":"v2 允许","note":"上层Goal仅驱动存储契约"},
  {"section":"record-store","file":"tests/record-store/R3b-body-concurrency.test.ts","line":[60],"owner":"RawArtifactStore","value":"并发put的首写元数据与内容引用","verdict":"v2 允许","note":"组外worker为tests/record-store/sqlite-body-race-worker.mjs；调用74、75"},
  {"section":"record-store","file":"tests/record-store/S2A-ordered-lookup.test.ts","line":[152,192,228,263,293,338,362,414,441,499,540,613],"owner":"RecordStore.lookupOrdered","value":"次序、边界、分页、注册、重开、限制","verdict":"v2 允许","note":"存储自身契约"},
  {"section":"record-store","file":"tests/record-store/S2C-count-lookup.test.ts","line":[124,142,188,222,248,284,325],"owner":"RecordStore.countLookup","value":"注册、计数、过滤、上限、重开","verdict":"v2 允许","note":"存储自身契约"},
  {"section":"record-store","file":"tests/record-store/S4B-text-search.test.ts","line":[33,47,61,75,94,108,122,136,150,164,183,196,209,222,236,249,269,284,299,313,361,380,400,418,441,455,469,489,504,525,539,558,571,584,597,610,624,639,652,675,692,709],"owner":"RecordStore.textSearch","value":"匹配、规范化、校验、更新、分页、失效重建、后端一致性","verdict":"v2 允许","note":"存储自身契约"},
  {"section":"record-store","file":"tests/record-store/SP-literal-type.test.ts","line":[65,76,142],"owner":"RecordStore","value":"aggregateType注册与隔离","verdict":"v2 允许","note":"存储自身契约"},
  {"section":"record-store","file":"tests/record-store/SP-lookup-index-migration.test.ts","line":[107,154,188,223],"owner":"RecordStore","value":"部分/完整注册和索引迁移","verdict":"v2 允许","note":"不检验上层业务状态"},
  {"section":"record-store","file":"tests/record-store/SP-record-store-limits.test.ts","line":[113,130,167,194],"owner":"RecordStore.lookup/lookupOrdered","value":"limit、next、after边界","verdict":"v2 允许","note":"存储自身契约"},
  {"section":"record-store","file":"tests/record-store/SP-text-scan-undo.test.ts","line":[14],"owner":"RecordStore文本索引纯函数","value":"bucket回滚","verdict":"v2 允许","note":"A5"},
  {"section":"record-store","file":"tests/record-store/SP-text-scan.test.ts","line":[72,87,109,131,173,198,215,245,270,290,313,330,347,371,402,428],"owner":"RecordStore.textScan","value":"扫描、分页、键移动、跨连接追平/失效/重建、Unicode","verdict":"v2 允许","note":"存储自身契约"},
  {"section":"record-store","file":"tests/record-store/WP2-notice-cursors.test.ts","line":[61,78],"owner":"RecordStore","value":"cursor字段注册与binding校验","verdict":"v2 允许","note":"不是通知已读业务状态"},
  {"section":"record-store","file":"tests/record-store/lookup.test.ts","line":[55,72,94,137,174],"owner":"RecordStore.lookup","value":"解码、排序、分页、原子性、重放、损坏行拒绝","verdict":"v2 允许","note":"存储自身契约"},
  {"section":"record-store","file":"tests/record-store/transaction-extensions.test.ts","line":[46,57,75,92,116,132,154,174,196],"owner":"RecordStore.commit","value":"horizon、unique CAS、cursor binding、回滚、隔离、重开","verdict":"v2 允许","note":"存储自身契约"},
  {"section":"record-store","file":"tests/helpers/S4B-text-search-support.ts","line":[155,168],"owner":"RecordStore.commit","value":"专用seed/seedBatch","verdict":"v2 允许","note":"仅供record-store测试使用；调用证据见表"},

  {"section":"F3","file":"tests/helpers/B2-execution-fixture.ts","line":[233],"owner":"RawArtifactStore.put","value":"篡改后的manifest body","verdict":"F3","note":"调用tests/work-graph/B2-execution-entry.test.ts:149,150；完整A6条件不成立"},
  {"section":"F3","file":"tests/helpers/B2-runtime-fixture.ts","line":[204],"owner":"commitRaw","value":"CoordinationPolicyRevision与active pointer","verdict":"F3","note":"已核直接及间接入口见表；完整传递调用未展开"},
  {"section":"F3","file":"tests/helpers/C1-mailbox-fixture.ts","line":[186,199],"owner":"RecordStore.commit","value":"RunSnapshot/SessionRecord改写","verdict":"F3","note":"调用tests/work-graph/C1-session-mailbox.test.ts:134,139,145,150,161,166,347,371"},
  {"section":"F3","file":"tests/helpers/C2-runtime-platform-fixture.ts","line":[106],"owner":"commitRaw","value":"策略修订与active pointer","verdict":"F3","note":"七个已核测试入口见表"},
  {"section":"F3","file":"tests/helpers/K-boundary-facts-support.ts","line":[79,118],"owner":"KernelStore.append","value":"input_accepted/resumed/assistant.message_completed/tool.started","verdict":"F3","note":"调用tests/scenarios/K-R-attested-facts-source.test.ts:171,309,377；不是A7"},
  {"section":"F3","file":"tests/helpers/K-readonly-work-support.ts","line":[80],"owner":"commitRaw","value":"移除role catalog的新策略及active pointer","verdict":"F3","note":"调用tests/runtime/K-readonly-command.test.ts:548"},
  {"section":"F3","file":"tests/helpers/K-session-support.ts","line":[119,151,194],"owner":"KernelStore.create/append","value":"Session header、turn.started、agent.event","verdict":"F3","note":"已核Kernel/composition测试见表；逐方法全部调用未展开"},
  {"section":"F3","file":"tests/helpers/S1-workflow-archive-fixture.ts","line":[522],"owner":"RawArtifactStore.put","value":"查询回答正文","verdict":"F3","note":"consultation调用见表；answer具体调用未全部展开"},
  {"section":"F3","file":"tests/helpers/S2A-notices-workspace2-fixture.ts","line":[109],"owner":"KernelStore.create","value":"Kernel Session","verdict":"F3","note":"调用tests/work-graph/S2A-notices-workspace.test.ts:28"},
  {"section":"F3","file":"tests/helpers/S2A-planning-fixture.ts","line":[91],"owner":"RawArtifactStore.put","value":"planning answer正文","verdict":"F3","note":"调用tests/work-graph/S2A-queue-derived-cards.test.ts:21"},
  {"section":"F3","file":"tests/helpers/S2B-be1-platform-fixture.ts","line":[208],"owner":"commitRaw","value":"策略修订与active pointer","verdict":"F3","note":"十一组已核测试入口见表"},
  {"section":"F3","file":"tests/helpers/S2B-r2-activity-support.ts","line":[69],"owner":"commitRaw","value":"手写RunSnapshot","verdict":"F3","note":"调用tests/work-graph/S2B-r2-keyed-cap.test.ts:68、S2B-r2-never-entered.test.ts:32、S2B-r4-session-workspace.test.ts:68"},
  {"section":"F3","file":"tests/helpers/S2B-r2-track-support.ts","line":[75],"owner":"commitRaw","value":"从存储Run复制改写","verdict":"F3","note":"调用tests/work-graph/S2B-r2-r5-not-entered.test.ts:39,54、S2B-r4-session-workspace.test.ts:48"},
  {"section":"F3","file":"tests/helpers/S2B-r3-r4-support.ts","line":[39],"owner":"commitRaw","value":"Session改workspace","verdict":"F3","note":"调用tests/work-graph/S2B-r4-session-workspace.test.ts:46,66"},
  {"section":"F3","file":"tests/helpers/S2B-track-fixture.ts","line":[613],"owner":"RawArtifactStore.put","value":"查询回答正文","verdict":"F3","note":"调用tests/work-graph/S2B-30-track-bars.test.ts:337,339,342、S2B-r3-consultation-cap.test.ts:46"},
  {"section":"F3","file":"tests/helpers/S2C-D-node-support.ts","line":[297],"owner":"KernelStore.create","value":"Kernel Session","verdict":"F3","note":"已核测试入口见表；逐方法全部调用未展开"},
  {"section":"F3","file":"tests/helpers/S2C-L-runs-support.ts","line":[420],"owner":"RawArtifactStore.put","value":"answered consultation正文","verdict":"F3","note":"answered分支调用见表；unknown/entered分支不计入此写点"},
  {"section":"F3","file":"tests/helpers/S2C-X-scale-fixture.ts","line":[405,427],"owner":"commitRaw","value":"picker Run改写及批量复制Run","verdict":"F3","note":"调用tests/work-graph/S2C-lines-scale.test.ts:43"},
  {"section":"F3","file":"tests/helpers/S4A-note-fixture.ts","line":[239],"owner":"KernelStore.create","value":"Kernel Session","verdict":"F3","note":"createSession/claimRun调用及传递调用清单未全部展开"},
  {"section":"F3","file":"tests/helpers/S4A-note-scope-fixture.ts","line":[250],"owner":"KernelStore.create","value":"Kernel Session","verdict":"F3","note":"初始化scribe/executor必经；全部传递调用清单未展开"},
  {"section":"F3","file":"tests/helpers/S4B-memory-fixture.ts","line":[102],"owner":"KernelStore.create","value":"extra Goal的Kernel Session","verdict":"F3","note":"五个已核测试文件见表"},
  {"section":"F3","file":"tests/helpers/S4C2-note-card-fixture.ts","line":[182],"owner":"KernelStore.create","value":"aux Session","verdict":"F3","note":"调用tests/work-graph/S4C2-D-rows.test.ts:231、S4C2-scribe-user-reason.test.ts:108"},
  {"section":"F3","file":"tests/helpers/S5-decision-fixture.ts","line":[544,604,1079,1117,1118,1119],"owner":"RecordStore.commit/KernelStore.create/seedCommit","value":"raw records、Kernel Session、unique probe、Goal/Plan/Proposal编码包装","verdict":"F3","note":"逐项调用证据及未确认调用见表；全部传递调用未展开"},
  {"section":"F3","file":"tests/helpers/S5-queue-support.ts","line":[237],"owner":"RawArtifactStore.put","value":"planning answer正文","verdict":"F3","note":"调用tests/work-graph/S5-decision-queue.test.ts:93,228"},
  {"section":"F3","file":"tests/helpers/W2-whiteboard-fixture.ts","line":[352],"owner":"RecordStore.commit","value":"agent PlanProposal与seed event","verdict":"F3","note":"调用tests/work-graph/W2-agent-whiteboard.test.ts:192,213,384,464、A2-disposition-change.test.ts:599"},
  {"section":"F3","file":"tests/helpers/WP1-entry-fixture.ts","line":[289],"owner":"RawArtifactStore.put","value":"改写的manifest/context binding","verdict":"F3","note":"调用tests/work-graph/WP1-goal-content-entry.test.ts:66,106；不满足完整A6"},
  {"section":"F3","file":"tests/helpers/WP2-duties-fixture.ts","line":[122],"owner":"seedCommit","value":"coordination policy及active pointer","verdict":"F3","note":"写入定义保留；实际builder调用尚未确认"},
  {"section":"F3","file":"tests/helpers/WP2-notices-fixture.ts","line":[211,265],"owner":"RawArtifactStore.put/RecordStore.commit","value":"查询回答正文；unique-claim probe","verdict":"F3","note":"tests/work-graph/WP2-undelivered-notices.test.ts:33进入夹具；全部具体调用待展开"},
  {"section":"F3","file":"tests/helpers/WP2-platform-support.ts","line":[579],"owner":"commitRaw","value":"非memory分支策略修订及active pointer","verdict":"F3","note":"已核入口见表；各options分支待逐项核对"},
  {"section":"F3","file":"tests/helpers/graph-session-fixture.ts","line":[366,380],"owner":"RecordStore.commit/KernelStore.create","value":"raw records；Kernel Session","verdict":"F3","note":"raw调用tests/work-graph/A1-session-independent.test.ts:127；全部Session方法调用未展开"},
  {"section":"F3","file":"tests/helpers/task-claim-fixture.ts","line":[311,367,461,471],"owner":"RecordStore.commit/KernelStore.create/commitRaw","value":"raw records、Kernel Session、手写Run、Session改写","verdict":"F3","note":"已核调用见表；Kernel全部传递调用及seedRun实际调用待核"}
]
```

v2 允许 622，F1 7，F3 46，A7 越界 0，文件 133/133；枚举不完整：A1 的部分组外透传参数来源及全部后续路径、F3 共享夹具的全部传递调用文件和条件分支尚未逐条核完。