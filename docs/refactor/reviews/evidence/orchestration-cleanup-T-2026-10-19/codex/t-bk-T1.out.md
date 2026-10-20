改完再施工

已逐项检查 T1-001—T1-070。全程只读，未修改文件，未运行测试、构建、Git 写操作或网络请求。以下行号均按本次提供的施工底稿。

**1. 需要修改的条目**

同一条目中的独立问题分别写明改法；没有重新裁决条目的业务取舍。

| 编号 | 问题 | 证据（`file:line`） | 改法 |
|---|---|---|---|
| T1-001 | “涉及测试”仍写“8 个名字”，与实际出口及本条核实理由不一致。 | `tests/helpers/S2C-X-scale-fixture.ts:523`；`.lead-ref/books/t-items-T1.md:9` | 将“这 8 个名字”改为“这 7 个名字”。删除动作不变。 |
| T1-002 | 标题定位和“涉及测试”指向（二），动作实际删除（三）。这会让按标题分工的人拿错删除范围。 | `.lead-ref/books/t-items-T1.md:12`、`:13`、`:16`；`tests/scenarios/K3-37-stopped-review-round.test.ts:298`、`:359` | 标题范围统一改为 `298–383`，“涉及测试”改为 `K3-37（三）`；保留现有迁移暂停期间断言的动作。 |
| T1-003 | 转换仍以当前 B2 夹具为前置；底层初始化原始提交治理记录，并自行创建 Kernel Session、调用登记事实写口。TP-107 只负责前一部分，不会修复 Session 创建部分。 | `tests/work-graph/A2-control-service.test.ts:40`；`tests/helpers/B2-execution-fixture.ts:108`；`tests/helpers/task-claim-fixture.ts:227`、`:318`、`:324`、`:327`；`.lead-ref/books/t-items-TP.md:717` | 增加明确前置：`task-claim-fixture` 的治理初始化采用 TP-107；其 `createSession` 改由 `createSessionOperations({sessions, kernelStores}).createSession` 完成。该前置合入后再执行本条两个独立 fixture 的转换。 |
| T1-004 | 删除范围还包含“未消费等待时 cancel 的 intent 为 queued”。点名的 A7 覆盖只提交 pause；本文件 281–282 同样只提交 pause，且会被 T1-005 删除。另一个真实取消等待场景确认取消成功，但未断言 queued。 | `tests/work-graph/A2-control-service.test.ts:310`；`tests/scenarios/A7-control.test.ts:488`；`tests/work-graph/A2-control-service.test.ts:281`；`tests/app/A2-continuation-projection.test.ts:128`；其 `control` 返回值见同文件 `:73` | 删除前，将真实等待取消场景 `A2-continuation-projection.test.ts:128` 的调用结果保存下来，断言 `intent.status === 'queued'`；把这处加入覆盖依据，然后执行原删除。 |
| T1-009 | 合并目标将被 T1-010 整文件删除，两条动作给出相反的迁移方向。 | `.lead-ref/books/t-items-T1.md:62`、`:69` | 改为：与 T1-010 同批，将 `B2-11-expansion-levels.test.ts:105–116` 迁入 `B2-11-script-expansion.test.ts`，替换其 `241–249`；最终只保留后者。 |
| T1-010 | 整文件删除遗漏 `maxFiles: 1` 的用例。该用例断言只读第一个目录、只产生一条展开及其 basis；四文件上限用例并不包含这些输入与断言，且后者还会被 T1-011 删除。 | `tests/work-graph/B2-11-expansion-levels.test.ts:147`、`:154`、`:156`；`.lead-ref/books/t-items-T1.md:69`、`:76` | 在现有四处迁移之外，明确增加第五处：把 levels 的 `147–160` 整条迁入 script-expansion，保留 `maxFiles: 1`、读取路径、展开数量、basis.path 和 truncated 五项内容，然后才能删 levels 文件。 |
| T1-012 | 两个必改文件未获白名单授权；新 helper 也没有确定文件名。 | `.lead-ref/books/t-items-T1.md:83`；`tests/work-graph/B2-12-recognition-pure.test.ts:29`；`.lead-ref/books/t-files-T1.txt:13` | 将共享模块定名为 `tests/helpers/B2-12-recognition-fixture.ts`；把它和 `tests/work-graph/B2-12-recognition-pure.test.ts` 加入白名单。模块只保留构造器所需的纯依赖。 |
| T1-013 | 只替换链接种子，无法让该用例符合规则表：前置 `enter()` 手写进入事实；后续成功终态仍来自手造 observation 调用 `recordRunResult`。F3 还直接点名否定了这个 `enter()`。 | `tests/work-graph/B2-execution-result.test.ts:25`、`:35`、`:36`；`tests/helpers/B2-execution-fixture.ts:297`；规则表 `:64`、`:66` | 增补转换范围：前置使用真实 `prepareExecution/startRun`，以脚本模型的门控停在 entered；此时调用 `linkSessionWork`，再放行模型产生完整 Turn 的真实结束。重放使用 Runtime 实际提交的原请求，不再调用 `terminalObservation` 构造成功事实。共享 B2 改造及 T1-003 的初始化前置先落地。 |
| T1-016 | ①点名的结算 helper 在有核对结论时返回手造的全量 display map，违反 F4。②“仅 review_unavailable”不能从尚无结论的 pending 记录直接结算，否则不能保持原来仅一个原因的断言。③K3 世界仍继承手写 S5 初始化，见本表 T1-023。 | `tests/helpers/K3-proposal-round.ts:566`、`:571`、`:591`；`tests/work-graph/K3-11-review-reasons.test.ts:341`；已有正确前半链见 `tests/work-graph/K3-16-second-unfinished-proposal.test.ts:66` | ①先把 `settlementOwner` 的 display 读取改为读取真实核对轮 envelope 对应的 manifest，按生产接线取得 display。②该单原因用例固定为：pending → 核对轮写 done/unlikely → unfinished 结束 → round_ended 结算回 pending → review_unavailable；保留 `['review_unavailable']`。③加入 S5 公开初始化前置。 |
| T1-018 | “另放纯状态层”没有目标文件；194–204 同时包含缺失 alias 和非 process alias，不能把两种检查一起移走。缺失 alias 本身可在真实单 process 记录上测试。结算 helper 还存在 T1-016 的问题。 | `tests/work-graph/K3-14-unknown-call-review-tool.test.ts:194`、`:197`、`:200`；`src/core/work-graph/state/unknown-call-review.ts:299`、`:301`；`.lead-ref/books/t-items-T1.md:126` | 保留服务层的缺失 alias 用例：真实 pending/claim 后，以 alias 9 调用，断言 invalid 和公开读不变，放入 `describe('rejects: …')`。仅将非 process alias 分支移入新文件 `tests/state/K3-14-conclusion-pure.test.ts`，直接测试纯状态迁移。补白名单，并依赖 T1-016 的真实 display 读取及 S5 初始化修复。 |
| T1-023 | 指定的 K3 路径仍从 S5 的原始初始化检查点开始。TP-099 明确保留该手写检查点；规则表 A7 却为空，因此不能把“依赖 TP-099”当作已经满足 A1。 | `tests/helpers/K3-review-card-fixture.ts:149`；`tests/helpers/S5-decision-fixture.ts:543`、`:568`、`:574`；`.lead-ref/books/t-items-TP.md:662`；规则表 `:21`、`:52` | 为 T1 使用的 K3 世界补上公开初始化模式：Project、Workspace、治理、Goal 及设置均经公开入口产生，版本从实际前置步骤取得；不使用固定 Workspace@3、Goal@6 的原始检查点。冻结这项共享前置后，再执行本条预算转换。此要求同时适用于 T1-016、018、061、067、070。 |
| T1-024 | 所列步骤缺少采用 Plan 所需的治理激活，以及 claim 所需的 Session 前置；`bodyFor`“也可改用”还留下直接写 body store 与公开写入口两种实施方式。 | `src/core/work-graph/tasks/plan-readers.ts:812`、`:824`；`tests/work-graph/R3b-material-applicability.test.ts:62`、`:86`；`.lead-ref/books/t-items-T1.md:167`、`:168` | 将动作补全为：创建两个 Workspace 和对应 Goal；公开安装、激活 CompletionPolicy 并采用初始架构；采用可领取 Plan；通过 Session Runtime 创建 Session 后 claim；QueryRun 经 submitQueryJob。正文统一改为在真实 owner Run 上下文中调用 `materials.storeArtifact`，删除“也可”。补齐这些入口的 records/events/lookups schemas。 |
| T1-025 | ①标题只列 R3d，理由实际列五个文件，四个未入白名单。②Project 升到 revision 2 的处理仍有“留手写／改 Workspace”两个方案。③R3a 保留的断言还直接读取事件存储。 | `.lead-ref/books/t-items-T1.md:174`、`:175`、`:176`；`tests/work-graph/R3a-goal-replay-boundaries.test.ts:50`、`:54`；`tests/work-graph/R3c-task-relations.test.ts:89` | ①动作明确列出五个文件并补白名单。②固定采用 Workspace 升版：真实创建一个 Session，再以 `setLinePins` 加入该 Session，使 Workspace 升版；Project 保持公开创建的版本，原请求继续带旧 Workspace pin。③将 R3a 的原始事件检查子段单独标为 BLOCKED；在冻结可保留该事件断言的合规入口之前，不删除或声称已转换。 |
| T1-026 | `completeGoal` 没有 planRef 输入。源用例是在结果中检查 planRef，并在显式 Plan 图读中使用它。按条目字面给 completeGoal 传 planRef 不符合接口。 | `src/core/work-graph/model/task-contracts.ts:78`；`tests/work-graph/R3e-completion.test.ts:136`、`:144`、`:147`；`.lead-ref/books/t-items-T1.md:181` | 改为：新 planRef 传给两轮 `openRequest`、两次 `completeTask` 及显式 `queryTaskGraph`；`completeGoal.input` 保持 `{goalRef}`，把其结果断言补为 `{phase:'COMPLETED', planRef}`。采用仍在 closeBackend 前进行，未来节点两条断言照迁。 |
| T1-029 | `admitSessionCreation → recordSessionCreated` 仍由测试提供 Kernel 身份和登记事实，不符合 F3；现有同文件示例不能证明该测试形式获准。 | `tests/work-graph/R4b-session-boundaries.test.ts:83`、`:87`；`src/core/agent-runtime/session-operations.ts:518`、`:542`、`:559`；规则表 `:64` | 将 Session 创建步骤固定替换为 `createSessionOperations({sessions, kernelStores}).createSession`，使用真实返回的 Session ref。初始化 Project、Workspace、架构也经公开入口；之后按原条目建立目标链接及 601 个模块链接。 |
| T1-030 | 与 T1-029 相同，直接登记 Session 仍是 Runtime 事实写入；返回身份的比较要求应跟随 Runtime 返回结果。 | `tests/work-graph/R4b-session-boundaries.test.ts:113`；`src/core/agent-runtime/session-operations.ts:542`、`:559`；`.lead-ref/books/t-items-T1.md:209` | 两种 role 分别经 `createSessionOperations(...).createSession` 创建，断言匹配查询只返回第一份完成回执中的 Session ref；不再手调 `recordSessionCreated`。与 T1-029 共用本文件的公开初始化。 |
| T1-031 | “同样的治理种子下”仍保留 Project、Workspace、治理记录的原始提交，不能作为本次转换的 A1 前置。 | `tests/work-graph/R4b-session-directory.test.ts:81`、`:85`、`:92`；`.lead-ref/books/t-items-T1.md:218` | 将本文件 `open()` 的 scope/governance 初始化一并改为 createProject、registerWorkspace、install/activateCompletionPolicy、adoptInitialArchitecture；然后执行 createGoal/proposePlan/applyPlanChange。Session 创建也统一经 Session Runtime；schemas 同时补公开初始化及 Plan 所需项。 |
| T1-036 | 只删 182 行会把 `EncodedRecord \| undefined` 传给只接收 `EncodedRecord` 的解码器，严格类型检查下不成立。调用链详情见下表。 | `src/core/work-graph/views/activity-read-helpers.ts:112`、`:176`、`:181`、`:182`、`:183`；`src/core/work-graph/tasks/claim-record-codecs.ts:279`；`tsconfig.json:8` | 把缺记录的成功回落明确改为失败：`record === undefined` 时抛出 `rejected('unavailable', 'dispatch claim … is missing')`，其中省略处使用实际 dispatch ref key；其余解码和返回流程不变。保持现有函数签名及下游接口，按条目删除旧执行测试和头注。 |
| T1-038 | RD-8 仍写“convert，或由 lead 定按琐碎删”，没有冻结成一个动作。原前置还手造等待消息和 yielded 结果，仅换 Lease 竞态不够。 | `.lead-ref/books/t-items-T1.md:265`；`tests/work-graph/S2C-lines-failure.test.ts:205`、`:206`、`:208`、`:212` | 固定为 convert：脚本模型调用真实 wait 消息工具并产生 yielded；经真实回复取得 consumedWait 所需引用；A3 包装器在读完 Session 后、读 Lease 前阻塞，调用真实接续 claim，再返回原读结果。保留 waiting_reply、pause/cancel unavailable/busy 断言，删除“按琐碎删”的分支及全部旧伪造读。 |
| T1-040 | ①给出的“真实链”仍手写进入、暂停／接管事实及 anomaly 文件观察；同任务再 claim 还缺公开继续／requeue 步骤。②142–160 不全是失败注入：成功第一页、第二页及游标都是手造值。131–139 也继承手造成功读口。③固定 runId 断言未说明如何随真实身份转换。 | `tests/helpers/S2C-D-node-support.ts:350`、`:381`、`:391`；`tests/helpers/S2C-L-runs-support.ts:167`、`:239`、`:260`；`tests/work-graph/S2C-node-detail-anomalies.test.ts:68`、`:83`、`:86`、`:117`、`:131`、`:147` | 改为整项 BLOCKED，撤销“这些替身可保留”的结论。先冻结真实 Runtime 暂停、Host 接管、归档和继续路径，再改共享 helper；分页前置必须由真实流程产生 101 个锚点，成功页原样委托真实读取，仅第二页注入失败。runId 断言改为对应真实 claim 的身份，计数及 partial 期望保持。该路径冻结前保留现有测试，不执行部分删除。 |
| T1-049 | “迁不迁成参数都行”仍给出两种实施结果，没有冻结是否保留原文件锚／注记类型组合。 | `.lead-ref/books/t-items-T1.md:344`；`tests/work-graph/S4C-note-protection.test.ts:259`、`:262`；`tests/work-graph/S4C2-D-rows.test.ts:274` | 固定为参数化合并：目标保留现有目标锚组合，新增源用例的文件锚组合，两组均执行 accepted、reasons、原注记状态及 coexistWith 断言；随后删除源用例。 |
| T1-050 | 目标只有拒绝断言，没有源用例的状态不变断言；目标 review 的 subject 还是 pending，源 review 的 subject 是 accepted，不能直接给现有目标补一句 accepted。 | `tests/work-graph/S4C-note-protection.test.ts:290`、`:295`、`:301`、`:308`；`tests/work-graph/S4C-resolution-order.test.ts:65`、`:73`、`:80`、`:90` | 明确把源 accepted-review 和 pending-reject 两组输入、拒绝断言及公开读状态不变断言迁入目标文件；原来封锁 target 读取的两组顺序检查保留。迁移完成后再删除源段，删除“状态不变是必然结果”这一覆盖理由。 |
| T1-053 | 两张真实卡及跨回执拒绝的方向成立，但指定卡夹具的 Session 前置仍自行写 Kernel store 并调用 `recordSessionCreated`，不满足 F3。 | `tests/helpers/S4C2-note-card-fixture.ts:271`；`tests/helpers/S4A-note-scope-fixture.ts:242`、`:250`、`:253`；规则表 `:64` | 增加前置改造：`S4A-note-scope-fixture` 的 Session 创建统一经 `platform.runtime.createSession` 对应的真实 Session Runtime 入口，取消测试自行写 Kernel Session 和登记事实。此前置完成后执行原两卡方案，保留 A 的公开读不变检查。 |
| T1-054 | ①保留 3a/b/c/e/h 为“读者测试”不能豁免假 lookup 和手造快照，A7 为空。②删除 3d 会失去“archiveOrigin 替代 rework、不会同时产生两种键”的检查；点名覆盖只确认 archive 存在及认领过滤。该生产规则仍存在。 | `tests/work-graph/S4C2-goal-triggers.test.ts:118`、`:131`、`:149`、`:173`、`:183`、`:192`；`tests/app/S4C2-scribe-reminders.test.ts:827`、`:842`、`:915`；`src/core/work-graph/tasks/plan-readers.ts:1417`；规则表 `:52`、`:68` | 改为 BLOCKED，保留全部现有子例，取消 3d 删除。冻结替代动作时必须逐项列出 3a 的真实完成链、3c 的连续采用链，以及 archive/rework 互斥断言的真实覆盖；3b/e/h 未给出合规路径前继续单列 BLOCKED，不得以“读者测试”保留假端口并标完成。 |
| T1-061 | ①普通转换仍受假 display reader 和 S5 手写前置阻塞。②遗漏 outcome_unknown 子例的真实形成步骤。③truncated 用例只写真实结论仍不能得到真实 truncated manifest；unreadable 也须针对真实依赖注入。④多条目“同一轮只读一次”不能由只产一个条目的 helper 实现。⑤K3-10 矩阵去留未定。 | `tests/work-graph/UCR-settle-review.test.ts:218`、`:245`、`:250`、`:269`、`:278`、`:333`；`tests/helpers/K3-proposal-round.ts:266`、`:571`；`.lead-ref/books/t-items-T1.md:427` | ①先完成真实 display 读取和公开 S5 初始化。②outcome_unknown 子例单列 BLOCKED，等待冻结真实 Host 接管路径。③truncated 用真实长命令经 prepare 产生截断，再写结论；unreadable 只包装真实 manifest/body 读取使其失败。④多条目计数子例单列 BLOCKED，不删、不改成单条目计数。⑤固定保留本文件全部 K3-10 单元及双后端，逐格经真实结论和结算转换；删除“可交 lead 定是否只留一处”。 |
| T1-062 | ①`beginCheck→recordCheckResult` 仍可由测试写检查结果，B2 enter 也被 F3 明确禁止。②scenario 9 的独立 Lease、无 Run 的 Reduction、新增 Task 痕迹尚未裁定，“留给 lead”不是施工动作。③正常场景仍原始提交空事件推进水位，并通过存储 JSON 断言不变。 | `.lead-ref/books/t-items-T1.md:433`；`tests/work-graph/W1-future-plan.test.ts:368`、`:382`、`:443`、`:481`、`:687`、`:698`、`:702`、`:706`；规则表 `:64`、`:76` | ①C 的完成链固定为真实 Runtime 结束 → openVerification → `runRegisteredCheck` 执行真实注册检查 → finalizeChecks → completeTask；A 的 running 由真实 Runtime 门控保持。②scenario 9 无法按原期望到达的子例逐条标 BLOCKED，暂不删除其 seed helper。③正常场景的并发写改为公开命令；Run/Lease/Task 不变通过 execution 和 task graph 公开读检查；零写入通过 A3 委托 commit 计数检查。原始事件／字节级断言没有等价公开读的部分单列 BLOCKED，不能直接删。 |
| T1-066 | ①与 T3-096 正面冲突：T1 要留 helper，T3 要改同四处调用并删除 helper。②所谓真实 propose 前置仍手写两个 Run 的 entered 事实。 | `.lead-ref/books/t-items-T1.md:462`；`.lead-ref/books/t-items-T3.md:671`、`:672`；`tests/helpers/W2-whiteboard-fixture.ts:174`、`:185`、`:197` | 分工固定为：T1 只转换本文件四处；T3 只转换 A2-disposition-change 的第五处，并在收到 T1 完成提交后删除 helper。共享 W2 夹具的两个 Run 先改为真实 prepare/start、由门控保持 entered，完成流程也由 Runtime 产生；此前置未完成，本条不得标 done。 |
| T1-067 | 100 次 propose 本身可做，但新路径仍从手写 S5 检查点开始，不能满足“所有前置来自 A1”。 | `tests/work-graph/WP2-context-extensions.test.ts:268`、`:269`；`tests/helpers/S5-decision-fixture.ts:543`、`:574` | 明确依赖 T1-023 所述公开 S5 初始化模式；随后循环真实 propose，按返回 proposalId 排序，保留原分页及尾卡断言。不得复用 TP-099 保留的原始检查点作为本条完成依据。 |
| T1-068 | 明令保留的 50–68 范围中，63–67 直接读取记录和事件存储，与 F7 冲突。只改初始化不能完成本条规定的转换。 | `tests/work-graph/goal-independent.test.ts:63`、`:66`；`.lead-ref/books/t-items-T1.md:476`；规则表 `:76` | Goal 存在及 revision 断言改由 `plans.queryGoal` 检查。原 `GoalCreated` 事件类型／事件 ID 子段单列 BLOCKED，在冻结能够保留这些断言的合规入口前保留原段，不得删掉或标转换完成。 |
| T1-069 | “期望快照改为 owner 返回值”直接违反书中和规则表对期望来源的限制，不能用写入结果整体作为读取器的正确答案。 | `.lead-ref/books/t-items-T1.md:483`；`.lead-ref/books/t-book.md:50`；规则表 `:78`；`tests/work-graph/material-readers.test.ts:75` | 改为：完整期望快照按公开请求、固定时钟及实际执行步骤手算；动态身份只引用创建命令返回的 ref，不把 owner 返回的整个 snapshot 用作期望。保留全部完整 ref 区分、not_found 和副本隔离断言。Session 一律由真实 Session Runtime 创建。 |
| T1-070 | ①`reachK3AwaitingProposal` 最终持久化的是 awaiting_proposal，不是 needs_decision；返回早先对象不能改变存储状态。②裸 pending 默认 settle 也不是 resolved 路径。③另一 Goal 的路径被 helper 内硬编码 GOAL_B 阻断。④“五个任务所以 205 条没有公开步骤”的理由不成立，已有公开追加 Task 的采用函数。⑤两条 watermark 用例仍改写真实返回值。⑥同样受 S5 初始化阻塞。 | `tests/helpers/K3-proposal-round.ts:169`、`:390`、`:595`、`:874`、`:879`、`:894`；`tests/helpers/B2-crr-world.ts:119`；`tests/helpers/K3-35-continuation-fixture.ts:447`；`tests/work-graph/unknown-call-review-list.test.ts:213`、`:243` | ①needs_decision 固定为 pending → `settleReview(review_unavailable)`，到此停止。②resolved 固定为真实核对轮写 done/unlikely、正常结束、结算。③将 goalRef/planRef 从公开输入贯穿 pending、blockedRecord、harness claim 和 review claim。④公开采用含 205 个唯一 Task 的计划后逐个产生记录，取消 keep-note 和 seed 保留。⑤用 A3 门控在真实 lookup 之间插入公开设置写入制造水位变化，原 lookup 结果原样返回；保留四次／六次读取和 ready/not_ready 断言，固定游标 3 改为该公开写入的真实游标。⑥先完成公开 S5 初始化。 |

上述规则表均指：

`docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md`

**2. T1-036 的生产调用链核对**

这是 T1 唯一列入动作的生产代码修改，入口见 `.lead-ref/books/t-run-T1.md:5`、`.lead-ref/books/t-items-T1.md:251`。

全树文本检索找到 `claimingSessionOf` 六处直接调用。环境中 `rg` 不可用，使用了递归文本检索替代。

| 调用／下游读取 | 证据 | 是否在 T1 白名单；动作是否覆盖 |
|---|---|---|
| 活动日历：缺活动记录的 ended Run 按 claiming Session 归属 | `src/core/work-graph/views/activity-read-model.ts:402` | 不在；归 TP，见 `.lead-ref/books/t-files-TP.txt:104`。按上表保持签名后不需要改调用方。 |
| 活动日历：open Run 按 Session 筛选 | `src/core/work-graph/views/activity-read-model.ts:432` | 同上。 |
| 活动日历：验证轮 subject Session 缓存 | `src/core/work-graph/views/activity-read-model.ts:644`、`:679` | 同上。缺失 Run 的独立 null 情况仍存在，不应顺手删除缓存的 nullable 处理。 |
| 轨道：ended Run 横条归属 | `src/core/work-graph/views/track-read-model.ts:512`、`:514` | 不在；归 TP，见 `.lead-ref/books/t-files-TP.txt:109`。按上表修法无需修改。 |
| 轨道：open Run 横条归属 | `src/core/work-graph/views/track-read-model.ts:568`、`:570` | 同上。 |
| 轨道：检查轮 subject Session 读取 | `src/core/work-graph/views/track-read-model.ts:604`、`:660` | 同上。缺失 subject Run 的 null 不属于本条删除范围。 |
| 平台装配两个读模型 | `src/composition/create-platform.ts:1109`、`:1112` | 不在；归 TP，见 `.lead-ref/books/t-files-TP.txt:19`。接口不变，无需修改。 |
| HTTP 路由绑定及分派 | `src/app/core-routes.ts:868`、`:872`、`:1153`、`:1155` | 不在；归 TQ，见 `.lead-ref/books/t-files-TQ.txt:4`。接口不变，无需修改。 |
| HTTP 输入／输出类型 | `src/app/core-http-types.ts:426`、`:430` | 不在；归 TQ，见 `.lead-ref/books/t-files-TQ.txt:3`。无需修改。 |

读模型的测试装配消费者也已核对：`tests/app/S2B-35-activity-routes.test.ts:158`、`:159`、`:178`、`:179`；`tests/app/S2B-backfill-host.test.ts:55`；`tests/helpers/S2B-activity-fixture.ts:560`；`tests/helpers/S2B-runtime-store-fixture.ts:218`；`tests/helpers/S2B-track-fixture.ts:853`；`tests/runtime/S2B-15-end-retry-activity.test.ts:55`；`tests/work-graph/S2B-r2-workspace-binding.test.ts:115`。这些文件均不在 T1 白名单；按上表修法不要求改动它们。

当前 claim 的同一次状态迁移同时产生 Run 和 outbox，依据是 `src/core/work-graph/state/task-machine.ts:930`、`:931`，对应编译处理在 `src/core/work-graph/tasks/claim-service.ts:458`、`:464`。因此本条应删除缺派工记录的成功兼容行为，不能把类型错误留给 DSH 猜测，也不需要扩大到下游接口调整。

**3. 白名单遗漏**

以下包括明确缺失的编辑文件，以及上表修复所需的共享前置文件。已有其他组归属的必须先统一责任和提交顺序，不能直接加入两个并行组，也不能套用“删除符号后的 import 清理”例外；该例外仅见 `.lead-ref/books/t-book.md:31`。

| 文件 | 对应条目 | 已在其他组白名单？ |
|---|---|---|
| `tests/app/A2-continuation-projection.test.ts` | T1-004 | 是，TP：`.lead-ref/books/t-files-TP.txt:116` |
| `tests/work-graph/B2-12-recognition-pure.test.ts` | T1-012 | 否 |
| `tests/helpers/B2-12-recognition-fixture.ts`，拟新增 | T1-012 | 否 |
| `tests/state/K3-14-conclusion-pure.test.ts`，拟新增 | T1-018 | 否 |
| `tests/work-graph/R3a-goal-replay-boundaries.test.ts` | T1-025 | 否 |
| `tests/work-graph/R3c-plan-entry.test.ts` | T1-025 | 是，TP：`.lead-ref/books/t-files-TP.txt:196` |
| `tests/work-graph/R3c-plan-adoption.test.ts` | T1-025 | 是，TP：`.lead-ref/books/t-files-TP.txt:195` |
| `tests/work-graph/R3c-task-relations.test.ts` | T1-025 | 否 |
| `tests/helpers/task-claim-fixture.ts` | T1-003、013、062、066 的公开初始化前置 | 是，TP：`.lead-ref/books/t-files-TP.txt:156` |
| `tests/helpers/B2-execution-fixture.ts` | T1-013、062 的真实执行前置 | 是，TP：`.lead-ref/books/t-files-TP.txt:135` |
| `tests/helpers/K3-proposal-round.ts` | T1-016、018、061、070 | 是，T3：`.lead-ref/books/t-files-T3.txt:66` |
| `tests/helpers/S5-decision-fixture.ts` | T1-016、018、023、061、067、070 | 是，TP：`.lead-ref/books/t-files-TP.txt:150` |
| `tests/helpers/S2C-D-node-support.ts` | T1-040 路径冻结后的共享前置改造 | 是，T3：`.lead-ref/books/t-files-T3.txt:73` |
| `tests/helpers/S2C-L-runs-support.ts` | T1-040 路径冻结后的真实执行改造 | 否 |
| `tests/helpers/S4A-note-scope-fixture.ts` | T1-053 | 否 |
| `tests/helpers/W2-whiteboard-fixture.ts` | T1-066 | 是，T3：`.lead-ref/books/t-files-T3.txt:78` |
| `tests/helpers/K3-review-card-fixture.ts` | T1-070 的任务数量及世界输入 | 是，T3：`.lead-ref/books/t-files-T3.txt:67` |
| `tests/helpers/B2-crr-world.ts` | T1-070 的 goalRef/planRef 传递 | 是，T3：`.lead-ref/books/t-files-T3.txt:60` |
| `tests/helpers/K3-35-continuation-fixture.ts` | T1-070 的真实 claim 作用域 | 是，T3：`.lead-ref/books/t-files-T3.txt:61` |

T1-036 按本次给出的修法，不需要把两个读模型、平台装配或路由文件加入 T1。

**4. 必须同批或按顺序落地的条目**

| 条目／批次 | 必须采用的顺序 | 依据 |
|---|---|---|
| T1-001、039 | 由同一文件负责人完成。删除测量用例和仪器后，再清理最后的出口及导入。 | `tests/helpers/S2C-X-scale-fixture.ts:237`、`:296`、`:523`；`tests/work-graph/S2C-lines-scale.test.ts:150` |
| T1-002、022 | 先把暂停期间不开新核对轮的断言及 K3-45 保留断言迁入 R2 目标，再删两个来源段／文件。 | `.lead-ref/books/t-items-T1.md:13`、`:153` |
| T1-003、004、005 | 同一负责人处理 A2-control；先迁移 RUN-14 和等待取消 queued 断言，再删除 yieldedRun 及其两条用例；D-9 转换单独保留。 | `tests/work-graph/A2-control-service.test.ts:262`、`:277`、`:290`、`:320` |
| T1-008、009、010、011 | 同一批完成；先完成最终 script-expansion 文件的全部迁移，再删 levels 文件和已被公开流程覆盖的四文件上限用例。 | `.lead-ref/books/t-items-T1.md:55`、`:62`、`:69`、`:76` |
| T1-017、018 | 合并与转换作为一个单元，不能先删来源后把转换标 BLOCKED。缺失 alias 与非 process alias 先拆清。 | `.lead-ref/books/t-items-T1.md:118`、`:126` |
| T1-016、018、023、061、067、070 | 先冻结并落地公开 S5 初始化；需要核对结算的条目还须先完成真实 manifest display 读取。 | `tests/helpers/K3-review-card-fixture.ts:149`；`tests/helpers/K3-proposal-round.ts:591`；`tests/work-graph/WP2-context-extensions.test.ts:269` |
| T1-026 | 先在目标 prepared 的 closeBackend 前采用新 Plan，完成输入、结果和图读迁移，再删来源流程。 | `tests/composition/R3e-completion-platform.test.ts:35`；`tests/work-graph/R3e-completion.test.ts:94`、`:144` |
| T1-029、030 | 共用同一份公开 scope、架构及 Session Runtime 初始化；不能分配给同时修改该文件的两个执行者。 | `tests/work-graph/R4b-session-boundaries.test.ts:113`、`:190`、`:235` |
| T1-033、034 | 同一负责人分别按实际剩余引用清理辅助函数和 imports，避免一条提前删掉另一条尚用的基础设施。 | `.lead-ref/books/t-items-T1.md:232`、`:239` |
| T1-036 | 生产缺记录分支修复与旧执行测试删除同批。 | `.lead-ref/books/t-items-T1.md:251` |
| T1-049、050、052 | S4C-note-protection 的两个迁出段由同一负责人处理；D-rows 接收 D-16 后，再完成 D-06 supersede 尾段向 D17 的迁移。 | `tests/work-graph/S4C-note-protection.test.ts:257`、`:287`；`.lead-ref/books/t-items-T1.md:363` |
| T1-062、063、064、065 | 同一负责人处理 W1。先精确删除三个已批准的篡改范围，再转换正常可达部分；scenario 9 的 BLOCKED 子例仍需其 helper，不得连带清除。 | `tests/work-graph/W1-future-plan.test.ts:417`、`:634`、`:669`、`:706` |
| T1-066、T3-096 | T1 改四处，T3 改第五处；五处完成后 T3 才删除 helper。两组不得各自修改同四处。 | `.lead-ref/books/t-items-T3.md:671`、`:672` |
| T1-070、T3-079、T3-084 | K3 helper 输入扩展、runK3ReviewRound 的 planRef 传递及出口清理由一个负责人整合；最后按最终消费者重新核对出口。 | `.lead-ref/books/t-items-T3.md:552`、`:587`；`tests/helpers/K3-proposal-round.ts:810` |

另有两处必须登记的跨组接触：

- TP 的 contextAssembly 改造明确涉及 T1 的 `S2C-X-scale-fixture`；不能在 T1-001/039 修改同一文件时独立落入。依据：`.lead-ref/books/t-items-TP.md:61`。
- TP 对旧 UnknownCallReview 事件类型的修改涉及将被 T1-022 删除的文件。应先整合删除，再让 TP 按最终剩余引用清理，避免复活该文件。依据：`.lead-ref/books/t-items-TP.md:377`。

**5. book／run-file 的规则问题**

| 编号 | 问题 | 改法 |
|---|---|---|
| BOOK-01 | “动作已定”与多处尚未定案的动作冲突：T1-025 的两种升版方式、038 的转换或删除、049 的是否参数化、061 的矩阵去留、062 的“留给 lead”。依据：`.lead-ref/books/t-book.md:22`；`.lead-ref/books/t-items-T1.md:175`、`:265`、`:344`、`:427`、`:433`。 | 按本答复逐条收成唯一动作；没有合规路径的明确写 BLOCKED，不再把选择权交给施工者。 |
| BOOK-02 | “转换遵守 v1”与保留手写种子／假端口的动作冲突，尤其 T1-054、070；共享 S5 前置又依赖 TP-099 所称“点名例外”，但 v1 的例外表为空。依据：`.lead-ref/books/t-book.md:48`、`:52`；规则表 `:52`；`.lead-ref/books/t-items-T1.md:377`、`:489`；`.lead-ref/books/t-items-TP.md:662`。 | 明确 v1 在本轮没有旧夹具豁免。删除条目中的豁免说法，公共前置先转换；不能到达的子例标 BLOCKED。 |
| BOOK-03 | 期望不得取程序输出，与 T1-069 的明确指令相反。依据：`.lead-ref/books/t-book.md:50`；`.lead-ref/books/t-items-T1.md:483`。 | 按 T1-069 的改法固定为手算期望；不得整体复制写 owner 的返回 snapshot。 |
| RUN-01 | “白名单不重叠”没有覆盖动作实际跨文件的情况。现成例子是 T3-096 指定修改 T1 的四处调用；共享 helper 前置也不在 T1 白名单。依据：`.lead-ref/books/t-run-T1.md:5`；`.lead-ref/books/t-items-T3.md:672`。 | run file 增加逐文件负责人和前置提交表；明确 T1-066 的分工及上述共享文件归属，重新生成白名单后派发。 |
| RUN-02 | “删除和合并先做，转换最后做”不能覆盖 T1-017/018 这种必须一起完成的单元。依据：`.lead-ref/books/t-run-T1.md:6`；`.lead-ref/books/t-items-T1.md:126`。 | 改为“按依赖单元施工；合并的目标和转换前置必须完成后才删除来源。仅无依赖的删除先做”。 |
| RUN-03 | 多组同时运行，而“只有协调者运行 typecheck、不能同时两次”的协调范围没有定义，可能被每组分别执行。依据：`.lead-ref/books/t-run-T1.md:5`、`:7`；`.lead-ref/books/t-book.md:71`。 | 明确 typecheck 排他范围是整个 T 轮，由 lead 统一安排；执行期间所有组暂停测试，不由各组独立判断机器空闲。 |

**6. 对应 JSON**

```json
[
  {
    "id": "T1-001",
    "problem": "涉及测试仍写8个名字，实际出口为7个（tests/helpers/S2C-X-scale-fixture.ts:523；.lead-ref/books/t-items-T1.md:9）。",
    "fix": "将涉及测试中的8改为7；删除动作不变。",
    "files_add": []
  },
  {
    "id": "T1-002",
    "problem": "标题及涉及测试指向（二），实际动作删除（三）（.lead-ref/books/t-items-T1.md:12、:13、:16）。",
    "fix": "标题范围改为298–383，涉及测试改为K3-37（三）；保留现有迁移359–366断言的动作。",
    "files_add": []
  },
  {
    "id": "T1-003",
    "problem": "B2前置仍原始提交治理并自行创建、登记Kernel Session；TP-107只处理治理（tests/helpers/task-claim-fixture.ts:227、:324、:327；.lead-ref/books/t-items-TP.md:717）。",
    "fix": "先完成TP-107，并将task-claim-fixture的createSession改为createSessionOperations的真实createSession；前置合入后再转换两个独立的Goal控制fixture。",
    "files_add": ["tests/helpers/task-claim-fixture.ts"]
  },
  {
    "id": "T1-004",
    "problem": "删除会丢失未消费等待时cancel的intent为queued的断言，点名覆盖只检查pause（tests/work-graph/A2-control-service.test.ts:310；tests/scenarios/A7-control.test.ts:488）。",
    "fix": "先在A2-continuation-projection.test.ts:128保存真实cancel结果并断言intent.status为queued，将其列入覆盖，再删除原用例。",
    "files_add": ["tests/app/A2-continuation-projection.test.ts"]
  },
  {
    "id": "T1-009",
    "problem": "合并目标被T1-010整文件删除（.lead-ref/books/t-items-T1.md:62、:69）。",
    "fix": "与T1-010同批，将levels的105–116迁入script-expansion并替换241–249，最终只保留script-expansion。",
    "files_add": []
  },
  {
    "id": "T1-010",
    "problem": "整文件删除遗漏maxFiles为1的独立输入及路径、数量、basis断言（tests/work-graph/B2-11-expansion-levels.test.ts:147、:154、:156）。",
    "fix": "增加第五处迁移：把levels的147–160整条迁入script-expansion，保留全部输入及断言后再删levels文件。",
    "files_add": []
  },
  {
    "id": "T1-012",
    "problem": "pure调用方和新共享helper均不在白名单，新helper未命名（.lead-ref/books/t-items-T1.md:83；.lead-ref/books/t-files-T1.txt:13）。",
    "fix": "共享模块定名B2-12-recognition-fixture.ts；将该模块及B2-12-recognition-pure.test.ts加入白名单；共享模块只用纯依赖。",
    "files_add": [
      "tests/helpers/B2-12-recognition-fixture.ts",
      "tests/work-graph/B2-12-recognition-pure.test.ts"
    ]
  },
  {
    "id": "T1-013",
    "problem": "只换链接种子仍保留手造entered和成功终态事实（tests/work-graph/B2-execution-result.test.ts:25、:35、:36；tests/helpers/B2-execution-fixture.ts:297）。",
    "fix": "前置改为真实prepareExecution/startRun并门控在entered；此时linkSessionWork，再放行模型产生真实结束；重放使用Runtime实际提交的原请求。先完成共享B2及task-claim初始化改造。",
    "files_add": [
      "tests/helpers/B2-execution-fixture.ts",
      "tests/helpers/task-claim-fixture.ts"
    ]
  },
  {
    "id": "T1-016",
    "problem": "结算helper返回手造display map；仅review_unavailable所需的已写结论前置未写明；K3世界继承手写S5初始化（tests/helpers/K3-proposal-round.ts:571、:591；tests/work-graph/K3-11-review-reasons.test.ts:341）。",
    "fix": "结算读取真实核对轮manifest；单原因用例固定为pending、写done/unlikely、unfinished结束、round_ended回pending、review_unavailable；先完成公开S5初始化。",
    "files_add": [
      "tests/helpers/K3-proposal-round.ts",
      "tests/helpers/S5-decision-fixture.ts"
    ]
  },
  {
    "id": "T1-018",
    "problem": "纯状态目标未命名，且把可公开测试的缺失alias与非process组合混在一起（tests/work-graph/K3-14-unknown-call-review-tool.test.ts:194、:197、:200）。",
    "fix": "服务层保留真实记录上的alias 9拒绝及公开读不变；仅非process分支迁到K3-14-conclusion-pure.test.ts；同时依赖真实display读取和公开S5初始化。",
    "files_add": [
      "tests/state/K3-14-conclusion-pure.test.ts",
      "tests/helpers/K3-proposal-round.ts",
      "tests/helpers/S5-decision-fixture.ts"
    ]
  },
  {
    "id": "T1-023",
    "problem": "K3世界依赖手写S5检查点，TP-099仍保留该例外，而规则表A7为空（tests/helpers/K3-review-card-fixture.ts:149；tests/helpers/S5-decision-fixture.ts:543、:574；.lead-ref/books/t-items-TP.md:662）。",
    "fix": "先冻结并完成T1使用的公开S5初始化模式，Project、Workspace、治理、Goal及设置均经公开入口产生，不使用固定版本的原始检查点，再执行预算转换。",
    "files_add": ["tests/helpers/S5-decision-fixture.ts"]
  },
  {
    "id": "T1-024",
    "problem": "采用Plan和claim的治理、Session前置缺失，bodyFor仍有两种实施方式（src/core/work-graph/tasks/plan-readers.ts:824；tests/work-graph/R3b-material-applicability.test.ts:62；.lead-ref/books/t-items-T1.md:168）。",
    "fix": "补公开治理激活、初始架构、可领取Plan及真实Session Runtime创建；补schemas；正文统一由真实owner Run上下文调用materials.storeArtifact，删除也可措辞。",
    "files_add": []
  },
  {
    "id": "T1-025",
    "problem": "五文件范围不明且缺四份白名单；Project升版处理有两个方案；R3a保留事件存储断言（.lead-ref/books/t-items-T1.md:175、:176；tests/work-graph/R3a-goal-replay-boundaries.test.ts:50、:54）。",
    "fix": "明确五文件范围；真实创建Session后setLinePins使Workspace升版，Project保持原版本；原始事件断言子段单列BLOCKED，合规入口冻结前不删除。",
    "files_add": [
      "tests/work-graph/R3a-goal-replay-boundaries.test.ts",
      "tests/work-graph/R3c-plan-entry.test.ts",
      "tests/work-graph/R3c-plan-adoption.test.ts",
      "tests/work-graph/R3c-task-relations.test.ts"
    ]
  },
  {
    "id": "T1-026",
    "problem": "completeGoal不接受planRef输入，源用例是在结果和显式图读中检查它（src/core/work-graph/model/task-contracts.ts:78；tests/work-graph/R3e-completion.test.ts:144、:147）。",
    "fix": "planRef传给openRequest、completeTask和queryTaskGraph；completeGoal仅传goalRef，在其结果断言中检查planRef；采用仍置于closeBackend之前。",
    "files_add": []
  },
  {
    "id": "T1-029",
    "problem": "直接recordSessionCreated仍由测试写入Runtime登记事实（tests/work-graph/R4b-session-boundaries.test.ts:83、:87；src/core/agent-runtime/session-operations.ts:542）。",
    "fix": "公开初始化scope和架构后，由createSessionOperations的createSession创建真实Session，再以返回身份建立链接。",
    "files_add": []
  },
  {
    "id": "T1-030",
    "problem": "直接登记Session不符合F3（.lead-ref/books/t-items-T1.md:209；src/core/agent-runtime/session-operations.ts:542）。",
    "fix": "两种role分别通过Session Runtime创建，按完成回执中的真实Session ref断言过滤结果；与T1-029共用公开初始化。",
    "files_add": []
  },
  {
    "id": "T1-031",
    "problem": "原治理种子仍为原始提交，不能作为A1前置（tests/work-graph/R4b-session-directory.test.ts:85、:92）。",
    "fix": "open中的scope和治理一并改为公开bootstrap、policy激活及初始架构；Session由真实Runtime创建；随后执行Goal和Plan转换并补齐schemas。",
    "files_add": []
  },
  {
    "id": "T1-036",
    "problem": "只删缺记录return null会向解码器传undefined（src/core/work-graph/views/activity-read-helpers.ts:116、:182、:183；src/core/work-graph/tasks/claim-record-codecs.ts:279）。",
    "fix": "缺记录时明确抛出unavailable并包含dispatch ref key；保持签名、解码和下游接口，其余按条目删除旧执行测试及头注。",
    "files_add": []
  },
  {
    "id": "T1-038",
    "problem": "转换或删除尚未定案，前置还手造等待消息和yielded结果（.lead-ref/books/t-items-T1.md:265；tests/work-graph/S2C-lines-failure.test.ts:206、:208）。",
    "fix": "固定convert：真实wait工具、真实回复、A3门控Session读与Lease读之间的真实接续claim；保留waiting_reply和pause/cancel busy断言；删除原伪造读及删除选项。",
    "files_add": []
  },
  {
    "id": "T1-040",
    "problem": "指定helper仍写Runtime/Host事实；pickedUpBy缺继续步骤；分页成功值及游标也是手造，不能归为失败注入（tests/helpers/S2C-D-node-support.ts:391；tests/helpers/S2C-L-runs-support.ts:167、:260；tests/work-graph/S2C-node-detail-anomalies.test.ts:83、:86、:117）。",
    "fix": "整项标BLOCKED，先冻结真实暂停、接管、归档及继续路径；真实产生101个锚点，成功页原样委托，仅第二页注入失败；runId改用真实claim身份。冻结前不执行部分删除。",
    "files_add": [
      "tests/helpers/S2C-D-node-support.ts",
      "tests/helpers/S2C-L-runs-support.ts"
    ]
  },
  {
    "id": "T1-049",
    "problem": "是否参数化仍未定案（.lead-ref/books/t-items-T1.md:344）。",
    "fix": "固定参数化合并，保留目标现有组合及源文件锚组合，两组都执行全部保留断言后删除源用例。",
    "files_add": []
  },
  {
    "id": "T1-050",
    "problem": "目标缺状态不变断言，且review前置为pending而源为accepted（tests/work-graph/S4C-resolution-order.test.ts:73、:83；tests/work-graph/S4C-note-protection.test.ts:295、:308）。",
    "fix": "把源accepted-review和pending-reject两组输入及状态不变断言完整迁入目标文件，保留目标原顺序检查，再删除源段。",
    "files_add": []
  },
  {
    "id": "T1-053",
    "problem": "卡夹具的Session前置自行写Kernel store并登记事实（tests/helpers/S4C2-note-card-fixture.ts:271；tests/helpers/S4A-note-scope-fixture.ts:250、:253）。",
    "fix": "先将S4A-note-scope-fixture的Session创建改为真实Session Runtime入口，再执行两卡跨回执拒绝方案并检查A公开读不变。",
    "files_add": ["tests/helpers/S4A-note-scope-fixture.ts"]
  },
  {
    "id": "T1-054",
    "problem": "读者测试名称不能豁免手造事实；删除3d会失去archive/rework互斥断言，而生产规则仍存在（tests/work-graph/S4C2-goal-triggers.test.ts:173、:183、:192；src/core/work-graph/tasks/plan-readers.ts:1417）。",
    "fix": "整项标BLOCKED并保留全部现有子例，取消3d删除；先冻结3a、3c及archive/rework互斥的真实替代流程；3b/e/h未有合规路径前单列BLOCKED。",
    "files_add": []
  },
  {
    "id": "T1-061",
    "problem": "缺真实display和S5前置、outcome_unknown路径、真实truncated及manifest失败路径；单条目helper不能覆盖多条目计数；矩阵去留未定（tests/work-graph/UCR-settle-review.test.ts:218、:250、:269、:278、:333；tests/helpers/K3-proposal-round.ts:266、:571）。",
    "fix": "先修共享前置；truncated由真实长命令prepare产生，manifest失败包装真实依赖；outcome_unknown和多条目计数子例单列BLOCKED；固定保留并转换全部K3-10矩阵及双后端。",
    "files_add": [
      "tests/helpers/K3-proposal-round.ts",
      "tests/helpers/S5-decision-fixture.ts"
    ]
  },
  {
    "id": "T1-062",
    "problem": "转换仍写检查/运行事实，scenario9未定案，正常场景仍原始写事件并读存储断言（.lead-ref/books/t-items-T1.md:433；tests/work-graph/W1-future-plan.test.ts:382、:443、:687、:706）。",
    "fix": "使用真实Runtime、runRegisteredCheck和完成链；scenario9不可达子例及其helper暂留并标BLOCKED；并发写改公开命令，状态不变改公开读，零写入用A3委托计数；无等价公开读的字节/事件断言单列BLOCKED。",
    "files_add": [
      "tests/helpers/B2-execution-fixture.ts",
      "tests/helpers/task-claim-fixture.ts"
    ]
  },
  {
    "id": "T1-066",
    "problem": "与T3-096重复修改四处且对helper去留相反；两个Run前置仍手写entered（.lead-ref/books/t-items-T3.md:671、:672；tests/helpers/W2-whiteboard-fixture.ts:175、:197）。",
    "fix": "T1只改四处，T3只改第五处并等待T1提交后删helper；共享W2前置先改真实prepare/start及Runtime结束，门控保持entered。",
    "files_add": [
      "tests/helpers/W2-whiteboard-fixture.ts",
      "tests/helpers/task-claim-fixture.ts"
    ]
  },
  {
    "id": "T1-067",
    "problem": "循环propose仍从手写S5检查点开始（tests/work-graph/WP2-context-extensions.test.ts:269；tests/helpers/S5-decision-fixture.ts:543、:574）。",
    "fix": "先使用T1-023要求的公开S5初始化，再执行100次真实propose、按返回proposalId排序并保留分页断言。",
    "files_add": ["tests/helpers/S5-decision-fixture.ts"]
  },
  {
    "id": "T1-068",
    "problem": "要求保留的范围包含直接记录和事件存储断言（tests/work-graph/goal-independent.test.ts:63、:66）。",
    "fix": "Goal存在和revision改由queryGoal检查；原事件类型及ID检查子段标BLOCKED，合规入口冻结前不删除或标完成。",
    "files_add": []
  },
  {
    "id": "T1-069",
    "problem": "期望快照取owner返回值与禁止复制程序输出的规则冲突（.lead-ref/books/t-items-T1.md:483；.lead-ref/books/t-book.md:50）。",
    "fix": "期望按公开请求、固定时钟及步骤手算，仅动态ref引用创建返回身份；不复制整个返回snapshot；保留完整ref区分、not_found及副本隔离，Session经真实Runtime创建。",
    "files_add": []
  },
  {
    "id": "T1-070",
    "problem": "needs_decision和resolved路径写错，Goal/Plan硬编码，五任务不是不可扩展限制，watermark仍覆盖真实结果，且继承手写S5初始化（tests/helpers/K3-proposal-round.ts:169、:390、:879；tests/helpers/B2-crr-world.ts:119；tests/helpers/K3-35-continuation-fixture.ts:447；tests/work-graph/unknown-call-review-list.test.ts:213、:243）。",
    "fix": "needs_decision在review_unavailable后停止；resolved经真实done/unlikely核对轮正常结束并结算；贯穿goalRef/planRef；公开采用205任务并逐个产生记录；用真实公开写入和A3门控制造水位变化，保持4/6次及ready/not_ready断言；先完成公开S5初始化。",
    "files_add": [
      "tests/helpers/K3-proposal-round.ts",
      "tests/helpers/K3-review-card-fixture.ts",
      "tests/helpers/B2-crr-world.ts",
      "tests/helpers/K3-35-continuation-fixture.ts",
      "tests/helpers/S5-decision-fixture.ts"
    ]
  },
  {
    "id": "BOOK-01",
    "problem": "动作已定与条目中的多个未决选项冲突（.lead-ref/books/t-book.md:22；.lead-ref/books/t-items-T1.md:175、:265、:344、:427、:433）。",
    "fix": "逐条收成唯一动作；无合规路径的明确BLOCKED，不交施工者选择。",
    "files_add": []
  },
  {
    "id": "BOOK-02",
    "problem": "遵守v1与保留假端口、手写种子和空A7之外的例外冲突（.lead-ref/books/t-book.md:48；.lead-ref/books/t-items-T1.md:377、:489；.lead-ref/books/t-items-TP.md:662）。",
    "fix": "明确本轮没有旧夹具豁免；公开前置先转换，不可达子例标BLOCKED。",
    "files_add": []
  },
  {
    "id": "BOOK-03",
    "problem": "期望来源规则与T1-069相反（.lead-ref/books/t-book.md:50；.lead-ref/books/t-items-T1.md:483）。",
    "fix": "T1-069固定使用手算期望，不整体复制owner返回snapshot。",
    "files_add": []
  },
  {
    "id": "RUN-01",
    "problem": "白名单不重叠的声明没有覆盖实际跨组动作（.lead-ref/books/t-run-T1.md:5；.lead-ref/books/t-items-T3.md:672）。",
    "fix": "增加逐文件负责人和前置提交表，落实T1-066分工及共享文件归属，重新生成白名单。",
    "files_add": []
  },
  {
    "id": "RUN-02",
    "problem": "删除合并先做、转换最后做不适用于必须同批的T1-017/018（.lead-ref/books/t-run-T1.md:6；.lead-ref/books/t-items-T1.md:126）。",
    "fix": "按依赖单元施工；目标和转换前置完成后才删来源；仅无依赖删除先做。",
    "files_add": []
  },
  {
    "id": "RUN-03",
    "problem": "并行组下typecheck唯一协调者的范围未定义（.lead-ref/books/t-run-T1.md:5、:7；.lead-ref/books/t-book.md:71）。",
    "fix": "typecheck按整个T轮排他，由lead统一安排，期间所有组暂停测试。",
    "files_add": []
  }
]
```

**7. 检查覆盖情况**

- **完整检查：T1-001—T1-070，全部 70 条。** 检查包括来源定位、删除覆盖、合并目标、转换路径、组内依赖和白名单；T1-036 另外完成了生产符号调用链核对。
- **仅略读：无。未检查：无。**
- 表中标为 BLOCKED 的部分也已检查；结论是给定动作尚不足以施工，不是将其视为干净条目。
- 这是静态书审结论。按你的限制，没有执行路径探针或测试，因此没有把拟议转换描述为已经跑通。