# 2C 片规格：状态词、左栏、工作线、置顶、悬停卡、节点详情

**后注（决定 86-6，lead 2026-10-21）：** 2C-25 的（1）–（4）（`tests/work-graph/S2C-lines-scale`）在规模批里核：原规模的用例原样挪进同名的 `.scale.test.ts`（两种后端、原数量、原断言、原超时，不注入页宽，所以也核了生产的默认页宽），`npm run test:scale` 每片合入前和全量一起跑；日常套件（`npm test`，CI 也只跑它）的同名文件里是同一组断言的小版本：测试经 owner 的依赖传入小页宽，每层读取至少跨两页，决定那一条在最后一页，每层的顺序和分页手算写在注释里。正文原样保留，只加此注。拆分经过见 证据（已归档：`docs/refactor/reviews/evidence/scale-split-sc-2026-10-21/README.md`）。读预算 `historyReadBudget` 不是页宽：小世界靠工作线读取的两个页宽（200 宽和 100 宽的读到底循环）和归档列表的公开 `page.limit` 跨页。

> **状态：已冻结（lead，2026-10-14 夜）。** 用户 2026-10-14 确认了测试入口 LE1–LE7（§5.1）。冻结时 lead 定了三处，见 §15：读预算改到施工以后量、合入以前定数；夹具由 DSH 写；和 2B 在两个副本里同时施工。Codex 审了七次（最后一次快速核对结论“改完后冻结”，两处措辞已改），按决定 56 的上限不再送审。下面原来的状态说明保留作记录。

> **状态：lead 起草（子任务代笔），2026-10-14；同日按审查意见（34 条）改了一轮，怎么处理的见 §9。lead 已逐行审过一遍（同日）：U1 按决定 54 写成已答（T0 加目标暂停的一种，§3.9、§3.10、2C-23 跟着改）；合入顺序改成 K 在 2C 之前，“K 合入前”的测试分支删去（2C-21、2C-22）。2026-10-14 又按 Codex 第二轮审查（`D:/cc-lead-notes/codex2/s2c-spec.review2.md`，14 条，结论“还不能冻结”）和 lead 当天对这 14 条的决定改了一轮（子任务代笔），怎么处理的见 §10。2026-10-14 lead 定了四处待定（L1a 两处、A2、L4 第 7 个索引）；lead 同日审过改动部分（L1–L5、§3 各表的改动）；交 Codex 第三轮审查。2026-10-14 按 Codex 第三轮审查（`D:/cc-lead-notes/codex2/s2c-spec.review3.md`）和 lead 的第三轮决定改了一轮，怎么处理的见 §11。2026-10-14 lead 定了第三轮留下的几处；交 Codex 第四轮审查。2026-10-14 按 Codex 第四轮审查（`D:/cc-lead-notes/codex2/s2c-spec.review4.md`）和 lead 的第四轮决定（拆开对话、去掉两个按时间的索引）改了一轮，怎么处理的见 §12；交 Codex 第五轮审查。2026-10-14 按 Codex 第五轮审查（`D:/cc-lead-notes/codex2/s2c-spec.review5.md`）和 lead 的第五轮决定改了一轮，怎么处理的见 §13；交 Codex 快速核对。2026-10-14 第六轮（Codex 快速核对，`D:/cc-lead-notes/codex2/s2c-spec.review6.md`）改完，怎么处理的见 §14；冻结前：lead 量读预算，用户确认测试入口。Codex 第七次快速核对（`s2c-spec.review7.md`）结论“改完后冻结”，两条措辞 lead 已改。** 测试入口待用户确认（§5.1）；之后再交 Codex 审，再冻结。
> - 代码基线：Codex 审查用的代码是 a7cafccc（第 5 片）。本轮重核行号用的工作树在 HEAD 5893c271，`src/`、`tests/` 在 a7cafccc 之后只多了 K 片 B 的只读命令（9881a2ae）；本片引用的文件行号和审查引用的对得上。第四轮审查对的是 bb924854，接线包 2 已在里面（§0.2 按它改了几条，第四轮第 8 条）；§0.2 其余行号还是按 a7cafccc 记的，接线包 2 改过的文件（例如 `session-availability.ts`）行号可能已移动。K 片 A、2A、K3 都还没合入。施工前要在“接线包 2、K 片 B、K 片 A、2A 合入以后”的基线上重核 §0.2（“自动维护、接续”那几条现在写的是 K 合入以后的样子，出自 K 规格）。
> - 2A 规格以 5893c271 那一版为准，加上 lead 同日正在改的几处：按顺序查找的等值只能是非空文字；索引登记 `orderBy: { path, valueType: 'text' | 'integer' }`，文字的候选是非空字符串，整数的候选是 JSON 整数；稳定窗口一共最多读 4 次。本片照这几处写。
> - 依据：
>   - HANDOFF 决定 17、25、26、30、33、38、42、43、45、47、48、49（第 01、02、11、28 项）、50、51、54；lead 2026-10-14 对 Codex 第二轮审查的 14 条决定（§10）；
>   - DESIGN §1.4“详情从事实打开”、§1.5（表 L268–277，“左栏显示的词”L287–289，“计数”L291–295）、§1.6（L323）、§1.10（L387–390）、§4.5（L861、L879–885）、§4.7、§4.8（L922–928）、§4.9（L930–942）、§6（L1114–1138）、§8.2 第 2、4 行、附录 C 设置第 5 项；
>   - MODEL O07、O09、O24、O27、O31、O32、O33、R02、R06、R07、R11，不变量 I03、I05，“技术推断与边界”；DIAGRAMS“Session 与工作线”（L124–145）；AMBIGUITIES AMB-1、AMB-2、AMB-44、AMB-45；
>   - E3-UI-ITEMS 5.1-7、5.2-3、5.6-3、5.6-5、5.6-8、5.6-10、5.10-3、D42-2、D45-1、D47-2、D49-01、D49-02、D49-11；
>   - 冻结原型 `data/WORKLINES.md` §1、§3.1、§3.3，设计说明 §21.3；UI-WORKBENCH §0 第 5、11、13 条（悬停信息卡那一行）和“冻结之后的修改”；
>   - 代码事实见 §0.2（子任务只读核对，未跑测试）。
> - 2C 是第 2 片拆出的第三小片（决定 50）：2A 决定队列、2B 执行计数和日历、2C 状态词和工作线。本片要 2A 先合入（§0.4）。

## 0. 冻结说明（lead）

### 0.1 要用户定的

- **为什么现在能写。** 10-10 你逐条答的第 01、02、11 项（决定 49），加上决定 25、30、33、38、42、45，已经把 2C 的行为定了：
  - 线名怎么起（01）；
  - 线自己的状态和最急的关注原因一起给，左栏、悬停卡、详情用同一份（02）；
  - 详情从真实对象打开，悬停只用已经读来的数据（11）；
  - 三个计数分开、已做完和已退役、归档后的标签。

  DESIGN §8.2 要 lead 在写任务书之前先写“状态词、左栏的词和计数的表，含边界情况”。这份表就是本规格 §3。写表时只多出一处要你定的地方（U1），10-14 你已答（决定 54，选 (a)），下面留着当时的问法作依据。第一稿还有一处 U2（“启动中”“待核对”算哪个计数），冻结原型已经给了答案，改成 lead 的读法 L24，你可以改。
- **已答（决定 54，10-14，用户：“a，按你建议”）：** 这种线不归档。左栏“已暂停 · 主机重启时已暂停，可继续”，只有“继续”；点“继续”，Workflow 关闭悬空 Turn，在原线接着做（K 片）。lead 按同一理由补的：目标暂停（扇出暂停）遇上重启的同类线同样不归档，恢复目标时接着做（GOAL-29）；本片对它写“主机重启时目标已暂停，恢复目标后接着做”（T0、§3.9、§3.10）。
  - **U1（当时的问法）你暂停的那次执行被主机重启打断，那条线归档不归档。**
    1. **你定过的（决定 42 第 2 条）。** 一条线退役了、又没有接续，手上还有“已暂停，可继续”的任务：平台马上归档它。左栏写“已归档 · 已退役”。任务放下，写一条异常锚点，任务显示“中断，待核对 · 等你点‘继续’”。
    2. **今天的做法和它不一样。** 平台的自动维护跳过这种线，不归档。K 片也照这个做：你暂停的线，维护不碰，等你点“继续”。所以这条线一直留在左栏，没有归档。
    3. **三个选项：**
       - (a) 照今天，不归档。左栏显示“已暂停”，原因“主机重启时已暂停，可继续”，只有“继续”一个按钮。退役这件事放在详情里。
       - (b) 照今天，不归档。左栏照决定 38 的字面显示“已退役”，原因写“主机重启时已暂停；点继续会接着做”。
       - (c) 改回决定 42 第 2 条：维护马上归档这条线。左栏显示“已归档 · 已退役”，关注“待核对”，任务显示“中断，待核对 · 等你点‘继续’”。这要另做一小块修改，不在 2C 里。
    - **lead 建议 (a)。**
      - 决定 42 是 10-08 定的。后来你在 10-10 选了 K 片的做法（决定 49 第 25 项）：你点“继续”时，平台关掉没结束的那一轮，接着在原来的 Session 里做，还是同一条线。
      - 选 (c) 会把这条线先归档。归档的线不再接活，你点“继续”以后，活会交给另一个 Session，成了另一条线（决定 43）。K 片对这种线的好处就没了。
      - (a) 让你看到的是“我暂停的东西还停着，点继续就行”。(b) 会让一条一直不归档、点了就能动的线叫“已退役”。
      - (a)、(b) 都算“待命”，计数一样。
    - 选 (a) 或 (b)，就是同意这一种线不照决定 42 第 2 条马上归档。lead 会把这一条写进 DESIGN §4.5。
    - 依据：DESIGN §4.5 L881、L883；DIAGRAMS L139；第 1 片 S1-AUTO-02、SV37；`session-maintenance.ts:527-529` 的 `platformCleanInterruption`；接线包 1 规格 L15；K 片规格 §0.1 lead 取舍第 1 条；E3 5.6-3；RUN-24。
- **告知，不用答：**
  - **K 片合入以后，还有几种退役线不归档（lead 2026-10-14 改写）。** 退役、没有接续、没有占用的线，K 片 A 的维护先试着关掉悬空的那一轮（KA1）：结论是 `kernel_turn_open`，最近一次工作执行是 Run，它是 RUN-19、干净 Turn 的 RUN-23 或经人认定的 RUN-22，来历已核清。KA1 **不看**有没有负责关系。关成功的线回到可用，不再是“已退役”。剩下不归档、一直显示“已退役”的有这几种（§0.2）：
    - **Query 线**（例如参谋或秘书回答问题那一轮被主机重启打断）。K 不关 Query 线；它又没有开着的负责关系，维护照今天的豁免跳过它。
    - **KA1 不满足、或关不掉的 Work 线：**
      - 来历没核清（工作区还有没补来历的旧 Session，或这条线自己没有来历）：KA1 不关；维护照今天的逻辑走，落在豁免里的跳过，不落的报 `incomplete`，都不归档。
      - 关闭确定失败（例如 Kernel 不支持关闭），或者根本不满足 KA1（例如最近那次 Run 的结束方式不是那三种）：走今天的逻辑。没有开着的负责关系、或不是平台证明的干净中断的，维护照今天的豁免跳过，不归档；有开着的负责关系、又是干净中断的，照今天按退役归档（“已归档 · 已退役”）。
      - 关闭可以重试的：这一轮跳过，下一轮再试。
    - 你暂停的线（决定 54）不在这里，它显示“已暂停”。在等回复的退役线不豁免，照今天归档。
    - 决定 38、42 说“平台马上归档”，这几种和它不一致。本片如实显示“已退役”；修不修，lead 另提。
  - **节点详情的“实际改过”和按文件的风险提示，2C 里先显示“还没有”。** 它们要等 2B 存下“执行改过的文件”。DESIGN 分片表把它们和用量放在第 2 片，决定 50 的 2B、2C 都没点名；放在 2B 是 lead 的安排（L15），你可以改。在那之前，界面写“还没有”，不写“没有改动”“没有风险”。
  - **agent 用“看”读节点详情，放到第 4 片接。** DESIGN 说节点详情“同一个读取也给 agent 的‘看’用”。第 4 片要给“看”加记忆分支（决定 49 Q2(A)），一起接，工具定义只改一次。这也是 lead 的安排（L14）。
  - **很旧的、已归档的 Session 可能各成一条线。** AMB-1 定的是：加“来历”之前的旧 Session，能从存下的事实可靠找到前任的，接成同一条线。读的时候去推前任太重（每个旧 Session 要扫一遍全工作区），所以本片只读存下的来历（L6）。活跃的旧 Session 平台维护会补上来历，补上以后就接上了；已归档的维护不补，要等“补来历也覆盖已归档的”那一小块修（§0.2 顺带发现）。在那之前它们各成一条线，行上标“来历未核对”，“已归档 n 条”显示一个范围。
  - **归档以后点“继续”，活去哪条线，文档和代码不一致。** DESIGN §4.5 L881、DIAGRAMS L139 写的是“同一条线回到左栏”。决定 43 和今天的代码是：归档的线不再接活，点“继续”以后由派工规则另挑或新建一个 Session，是另一条线。本片按存下的事实读，显示的是另一条线。lead 另把两处文档对齐到决定 43。
- **待确认：** §5.1 的测试入口（决定 50）。
- **以后再问，不在本片：**
  - 已归档的线被「问一问」时算哪一档。今天归档的线还不能问（`consultation.ts` 要求被问的 Session 是活跃的），第 7 片做“已退役线的问一问”时再问。本片的规则只覆盖没归档的线。
  - 审阅者的线审完以后叫什么。决定 38 只给执行者“已做完”；本片照字面，审阅者的线审完是“待命”。独立审阅在第 9 片，审阅者线多了以后会不会让左栏变长，到那时再问。

### 0.2 今天的代码事实

**Session 和线**
- `SessionRecord`（`src/contracts/core/session.ts:43-57`）有 lifecycle、health、healthConclusion、occupancy、lastExecutionRef、historyCursor、createdAt、archivedAt、provenance、archiveRequest。没有“最近活动时间”。来历四种：new / continuation{from, reason, task} / handoff{from} / readonly_copy{from, messageRef}（`:25-31`）；旧记录没有来历，读作 null。新建的 Session 没给来历时写 `new`（`sessions/session-directory.ts:796`）。
- **`unavailableSince`（接线包 2，已在 bb924854；lead 2026-10-14 第四轮第 8 条）。** 是**提交位置**，不是时刻（`src/contracts/core/session.ts:58-64`）：Session 从可用变成不可用的那一次提交写一个 null 占位，提交时绑成那次提交的位置（`state/session-availability.ts:380-383`、`:426-428`、`bindSessionUnavailableCursor` `:436-440`）；已经不可用时再变不留新位置，保留原来的；回到可用（SES-13）时整个字段去掉（`:418-422`）；接线包 2 以前的旧记录没有这个字段。所以“哪天退役的”只能写成那次提交的位置（要时刻得再用 `eventAt` 读那条事件），旧记录没有时不写（`LineRowV1.retired.since`）。
- `SessionWorkLink` 只有 `since`、`until`（`session.ts:58`），`until` 是提交位置（`c` 加 10 位数字的文字）。负责关系是怎么关的（transfer / drop / terminal）只记在 `SessionResponsibilityChanged` 事件上（`sessions/lifecycle-record-codecs.ts:101-110`：`mode`、`closed`（关掉的那条链接）、`archiveStep`、`taskBasis.terminalCause`），链接记录上读不到。
  - 负责关系的三个写法都在 `sessions/session-responsibility-service.ts`：转交 `mode: 'transfer'`、`archiveStep: null`（`:541`）；归档那一步放下或交出 `drop` / `transfer`，带 `archiveStep`（`:742`）；任务终结后关掉 `terminal`（`:914`，守卫要任务已终结）。
  - 每次提交只有这一条事件、只关一条链接，`until` 绑到这次提交的位置（`:276-289`；回执要恰好一条事件，`:306`）。提交位置就是这次提交最后一条事件的位置（`record-store/sqlite-record-store.ts:199-211`；内存后端同样），所以 `eventAt(link.until)` 读回的正是关掉这条链接的那条事件。维护已经这样读关闭方式（`business/workflow/session-maintenance.ts:174-190`）。
  - 另一条关链接的路：`sessions/link` 路由（`linkSessionWork`，`active: false`）也能关 `responsible` 链接，它写的是 `SessionWorkLinkChanged`，没有关闭方式（`sessions/session-lifecycle.ts:540-571`；`app/core-routes.ts:298`）。
- 归档守卫只要求先关掉 task、work 的负责关系（`state/session-availability.ts:762-787` 的 `archived`；`openResponsibleLinkOf` 只看 task、work，模块关系“不是没做完的工作，从不挡”，`:264-274`）。所以已归档的 Session 没有开着的 task、work 负责链接，模块的负责链接可以还开着。
- 归档请求在归档做完时清掉（`session.ts:55-56`），归档以后的 Session 上读不到它是因为什么被归档的。
- 归档时写 `archivedAt`（`archiveSessionRecord`，`session-availability.ts:383-390`）；但编解码允许任何记录的 `archivedAt` 为 null（`sessions/session-record-codecs.ts:746-747`）。
- `deriveAvailability`（`state/session-availability.ts:254-261`）给的是“可用性”（已归档或不可用 → unavailable；占用 → busy；recoverable；idle），不是活动状态（协作主图 §0.6）。
- `recoverable` 没有写入方（D-17，`session-availability.ts:412`、`:817`、`:830`）。`occupancy.kind === 'maintenance'` 有编解码（`session-record-codecs.ts:326`），但 `occupySessionRecord` 只写 execution（`session-availability.ts:338-352`），今天没有写入方。
- 占用和释放都把 `lastExecutionRef` 设成占用者（`session-availability.ts:349`、`:375`），Run 和 QueryRun 都会。所以它指向这个 Session 最近一次执行，不分 Work 和 Query。
- Work 的领取记录（`DispatchOutboxEntry`）上有 `claim.claimedAt`（文字）和 `claim.generation`（数字）（`src/contracts/core/task-claim.ts:15-26`）；已有索引 `work-execution-by-session` 按 Session 找它们，不排序（`model/session-facts-contracts.ts:45-46`）。
  - “最近一次工作执行”今天是 generation 最大的那次（`tasks/session-facts.ts:240`）。generation 是占用时 Session 的版本加 1（`tasks/claim-service.ts:1080-1089`），同一个 Session 上严格递增。
  - `claimedAt` 只是注入时钟给的合法时间（`claim-service.ts:1061-1063`），相等、倒退都可能，不能拿来排序。
- Query 按 Session 的已有索引 `query-run-by-session` 也不排序（`model/session-facts-contracts.ts:47-48`，登记在 `queries/query-record-codecs.ts:777`）。`QueryRunV1.startedAt` 在 `entering` 那一步由时钟写上，之前是 null（`state/query-run-recovery.ts:487`、`:557`）。收尾不改它（`:635-638` 只写 `status`、`outcome`、`endedAt`）：在 `entering` 之前就收尾的，`startedAt` 仍是 null；从 `entering` 被核对成 `not_entered` 的，留着 `entering` 时写上的那个时刻（lead 2026-10-14 第五轮第 7 条）。所以 `startedAt` 不是“进入过”的证据。

**自动维护、接续（K 片 A 合入以后的样子，出自 K 规格 L7、KA1；今天的代码还没有 KA1。施工前在合入后的基线上重核，lead 2026-10-14）**
- 退役、没有接续、没有占用的线，维护先看 KA1（K 规格 L7 的插入点，在今天判断 `kernel_turn_open` 豁免的那一处之前）。下面四条都成立才调 `closeOpenTurn`（不带 TaskRequeue）：
  1. 结论是 `kernel_turn_open`；
  2. 最近一次工作执行是 Run；
  3. 那次 Run 是 RUN-19、带干净 Turn 的 RUN-23（`platformCleanInterruption` 为真）或经人认定的 RUN-22（决定 51）；
  4. 来历已核清：`legacyPending` 为假，这条线自己的来历不为空。
  - KA1 **不要求**有开着的负责关系（K 规格 L7 第 145–149 行、表 KA1）。
  - 关成功：SES-13 回到可用，本次不归档。可以重试：本次跳过。确定失败或不满足四条：一字不改地走下面今天的逻辑。
  - 人暂停的线（RUN-24）不满足第 3 条，Query 线不满足第 2 条，处理和今天一样。
- 今天的逻辑（K 不改，`business/workflow/session-maintenance.ts:505-540`）：
  - 有接续的：做完交接的按 `handoff_complete` 归档；还有没交完的 task、work 负责关系就等着（HM02）。
  - 没有接续的，下面三条**同时**成立就跳过、不归档（`:527-529`）：结论是 `kernel_turn_open`；没有在等回复（`facts.wait === null`）；并且（没有任何开着的负责链接，这里连模块的也算，`openResponsibleLinks`，`:110-111`；或者不是平台证明的干净中断，`platformCleanInterruption` 要 `interrupted_clean` 且 `pausedIntentRef === null`，`:379-389`）。
  - 不跳过的，来历核不清报 `incomplete`（`:533-537`），否则按退役归档。
  - 所以在等回复的退役线不豁免（S1-AUTO-02）；人暂停被打断的线（RUN-24）落在豁免里，K 也不碰它（决定 54）。
  - 归档组合本身支持归档这种线（第 1 片 SV37：一条锚点、负责关系关上、Session 归档、任务仍是 `paused_interrupted`），只是维护不走它。
- K 以后不归档、一直“已退役”的线：Query 线；KA1 不满足或关闭确定失败、又落在豁免里的 Work 线；来历核不清的 Work 线（§0.1 告知）。
- 维护在做线的判断之前，先给这一页的活跃 Session 补来历（`session-maintenance.ts:447-458`）。
- 领取重新入队的任务时，原 Session 已归档、在归档中或不在本工作区，就按普通派工另挑或新建，新 Session 不带“接续”来历（`business/workflow/workflow.ts:722-748` 的 `continuationProvenanceFor`、`:1026-1028`）。所以归档以后点“继续”，接着做的是另一条线（决定 43）。
- 旧来历的推导 `deriveLegacySessionProvenance`（`tasks/session-provenance-facts.ts:549` 起）只读不写，但它每次扫全工作区的 Session，再扫每个 Session 的发信、收信两路消息（`:195-216`），各 25 页、每页 100 条为限。

**已有的读**
- `readSessionFacts`（`tasks/session-facts.ts:210-332`）读这个 Session 的全部 Work 执行、全部后继；后继里没有待补来历的旧 Session 时，还扫整个工作区的 Session 索引（`:306-322`）。每次扫描 100 条一页、最多 25 页（`:43-44`），超了报 `incomplete` 或把 `legacyPending` 设成 true。列表里每条线调一次，就是每条线扫一遍整个工作区。
- `findSessions`（`sessions/session-directory.ts:1528-1709`）一次最多扫 1,000 个候选（`:559`），按 refKey 排，游标绑水位，账本动了报 `source_stale`（`:1653`）；卡片带全部链接，单个 Session 超过 2,000 条链接报 `capacity`（`:560-561`、`:1202`）。
- 图读取（`views/graph-context-reader.ts`）的 Session 节点：名字是 sessionId（`:944-950`），状态只是 lifecycle（`:1230`）；任务的邻居是任何一条指向它的链接，开着的、关了的、什么关系都算，不分“现在负责”和“曾参与”（`:1115-1123`）。带 Session 的读把整个工作区的 Session 都读进来，含已归档，最多 50 页 × 200（`:88-91`、`:771`），超过 10,000 个报 `incomplete`。
- 已有索引：`session-by-workspace`、`session-by-workspace-lifecycle`、`session-work-links`（`[ref.projectId, ref.sessionId]`）、`session-links-by-task`（按 goal、task、relation）、`session-by-provenance`（`[projectId, workspaceId, provenance.from.sessionId]`，不分来历种类，副本、换手、接续混在一起）等（`sessions/session-record-codecs.ts:926-941`）。被问过几百次的参谋，它名下有几百个副本，要找“有没有接续”得翻完这些副本。
- 锚点只有按任务、按目标两个索引（`tasks/session-anomaly-codecs.ts:389-393`）；锚点记录上有写它的 `sessionRef` 和当时的 `lineHead`（`src/contracts/session-anomaly.ts:24`）。锚点有没有被接手，要读这个任务的**全部** Run（`RUN_BY_TASK_INDEX`），挑出带着这条锚点、真的进入了的（`tasks/session-anomaly-service.ts:294-315`）。所以算一条锚点的状态，读的量随这个任务的执行历史增长。
- `readUndeliveredReplies` 按发信 Session 把它发过的**全部**消息一页一页读出来，再在内存里挑出“退役线收到、还没被执行用上的回复”（`communication/mailbox-service.ts:3266-3269`、`:3303-3306`）。读的量随这个 Session 发过的消息增长，不随未送达的条数。接线包 2 以后（bb924854）这个扫法不变；每条未送达回复另带可选的 `unavailableSince`、`responseSince`（都是提交位置，旧数据没有，`model/communication-contracts.ts:180-190`）；接线包 2 还接上了未送达回复的请知悉来源，并记下被接受的回复（Codex 第四轮审查第 8 条，子任务没逐行核）。
- **上下文扩展（接线包 2 以后）。** `views/context-extensions.ts` 现在接上了目标的自主程度和待答的决定行（`:240` 起；组合根 `create-platform.ts:773`）；注记和足迹还没实现。接线包 2 在这里给待答卡提醒加的临时上限（每页 100、最多 50 页/5,000 张），照 2A 的安排撤掉（2A §0.4 的表、L10 后面那条“接线包 2 的两处临时防护撤掉”）；本片不另改。
- `RecordLookupPort` 只有等值查找、按 refKey 续页（`src/core/record-store/lookup-ports.ts:5-26`），没有计数；2A 另起 `RecordOrderedLookupPort` 加“按顺序查找”（2A 规格 §2）。缺字段按 null 进索引，复合值不是候选（`lookup-index.ts` 的 `resolvePath`，`:171-183`），所以可以用 `provenance.kind = null` 找出没核对来历的旧 Session。
  - 等值的编码分类型：null、`true`/`false`、数字、文字各不相同，数字按 `String(值)` 编（`1` 和 `1.0` 是同一个值）（`lookup-index.ts:185-193`）。
  - SQLite 每个登记的索引是一个表达式索引，每个路径存一对 `json_type`、`json_extract`，类型那一列让布尔和 1、0 分开（`sqlite-record-store.ts:81-99`）；数字的谓词是 `json_type IN ('integer','real')` 加值相等（`:111-116`）。
- **读预算的实测（lead 2026-10-15，L1b 第 2–4 步；替换“暂定 2,000”）。** 在 2C-25 的数据上，两个后端各用不设上限的预算跑一次 `lines/list`。受预算管的几部分的读次数：普通的行最多 m = 4，R 是 r = 78，W 是 w = 73（Z 是 1）。1,100 行受预算管的读合计 3,491 次；共享代价 10,699 次读，耗时内存 1.4 秒、SQLite 4.9 秒；不受预算管的读（含开着的工作）7,208 次。按第 3 步定 `LINE_HISTORY_READ_BUDGET = 100`：它是不小于 2 × m 的整百数，并且 ≥ max(r, w)，R、W 在这个预算下都读全。施工第 3、4 轮各量了一次，数相同。证据在 `reviews/evidence/orchestration-slice-2C-2026-10-15/`。
- 测试里有十几个夹具对象类型写成 `GoalRecordTransactionPort & RecordLookupPort`、只实现了 `lookup`（例如 `tests/helpers/graph-session-fixture.ts:80`、`:186`，`tests/helpers/S1-runtime-scenario-fixture.ts:101-103`，`tests/helpers/task-claim-fixture.ts:68`，`tests/runtime/S3-graph-tools.test.ts:664`）；`npm run typecheck` 包括 `tests/**/*.ts`。

**任务、关注、锚点、卡**
- `TaskRow`（`model/plan-contracts.ts:105-135`）有 effectivePhase、disposition、phaseCause、failure、rework、dispositionChange，没有显示用的词。没运行过的、被取消或替代的任务投影成 `pending`（P16）带着处置。`rework.entries` 每条重新入队带 `failureClass`、`automatic`、`autoCount`，`rework.cap` 是上限（`src/contracts/task-failure.ts:195-210`）。
- `TaskPhaseCauseCode`（`src/contracts/task-failure.ts:28-42`）十四种。对应的阶段见 STATE-MACHINES-SPEC P 表（L791–810）：`run_outcome_unknown` 是 blocked（P3）；`continuation_paused`、`paused_interrupted` 是 blocked（P18、P19）；`continuation_cancelled` 是 failed（P17）；`requeued` 是 pending（P4）；`verification_running`、`awaiting_verification`、`awaiting_completion` 是 verifying。
- 维护判断“任务已终结”用的是：`effectivePhase === 'satisfied'` 或处置为 `cancelled`、`superseded`（`business/workflow/session-maintenance.ts` 的 `closeTerminalResponsibilities`；`tasks/plan-readers.ts:1896` 起的 `readResponsibilityBasis` 同一口径）。
- `deriveTaskArchiveState`（`state/session-anomaly.ts:54-90`）：有没被接手的锚点时给“中断，待核对”，`next` 是 `goal_stopped`、`human_continue`、`rework_blocked`、`dispatch` 或 null。接手 = 别的 Session 里一个带着这条锚点的 Run 进入了。锚点读取：`listSessionAnomalies`（按目标，可带任务）、`readTaskArchiveState`（`tasks/session-anomaly-service.ts:58-70`）。后者一次只读一个任务：读目标、计划、规范任务事实、这个任务的锚点、进入了的后继，再用租约算能不能领取（`:685-735`）；没有按目标一次给出全部任务的版本。内部每页 100、最多 25 页。
- 决定卡 `DecisionCardV1`（`model/decision-contracts.ts:232-248`）带 `senderSessionRef`、`objects`、`source`、state，**没有原因码**。目标原因卡建卡时丢了 `cause.code`（`views/decision-read-model.ts:219-225`）；原因码只留在 `source.key` 里，那是 `decisionSourceKey` 写的规范 JSON（`src/contracts/goal-decisions.ts:184-188`）。`unknown_outcome` 也作为一种原因进队列（`tasks/goal-decision-reader.ts:74-79`）。
  - **目标原因卡的任务 pin 在 `source.pins` 里，不在 `objects` 里。** 建原因时，受影响的任务写成 `{ ref: { aggregateType: 'Task', projectId, goalId, taskId }, revision: 0 }`（`taskPin`，`goal-decision-reader.ts:157-160`），和目标的 pin 一起放进 `source.pins`（`:171-182`，`:175`）；`objects` 默认是空的（`:182`）。
  - 返工、自动返工、结果未知这几种原因都走这条路，带任务 pin，有失败的 Run 时再带那次 Run 的 pin（`:287-307`）；`required_task_deferred` 带的是延后任务的 pin（`:283-286`）；`initial_plan_pending`、`change_pending` 只带提案的 pin（`:275-281`）。
  - 成员发来的“请你决定”卡，`objects` 取自消息的决定元数据（`views/decision-read-model.ts:859`、`:876`）。
- 参谋转来的卡：消息的决定元数据里有 `forwardedFrom`，指向执行者原来那条消息（`src/contracts/core/session-message.ts:70`）。执行者、审阅者不能发“请你决定”，要经参谋转（DESIGN §1.4 L205–209）。
- `GoalExecutedFilesPort`（`model/decision-contracts.ts:55-65`）今天是桩：`not_available`、文件为空、`possiblyIncomplete: true`（`tasks/executed-files-stub.ts:16-27`；组合根 `create-platform.ts:660`）。

**控制、消息、职责、设置、组合**
- `RunSnapshot.status` 是 starting/running/ended，`controlState` 有 intentRef 和 desiredState（`src/contracts/dispatch.ts:203-256`）。`ControlIntentSnapshotV1` 状态 queued（没有观察）/ applied / superseded / outcome_unknown（`src/contracts/control-intent.ts:102-106`）。
- 控制提交的守卫（`state/control-intent-machine.ts`）：
  - `controlSubmitProblem`（`:197-206`）只看指针：排队的取消是终局；暂停不能重复；只有暂停着的能恢复。
  - 完整的检查是 `controlSubmissionProblem`（`:217-252`），CTL-01/02 和 Run 状态机都用这一份：让出的接续已被后继 Run 用掉（RD-8）就什么都不收；没让出、又有指针的 Run 要恢复，指针意图必须是已生效、观察到停下的暂停；恢复要目标是 `active`（D-9：目标暂停或取消时不单独恢复一次 Run）；最后才是 `controlSubmitProblem`。
  - 在它前面还有对目标 Run 的几行（`:470-481`）：QueryRun 不收控制（`invalid`）；Run 不存在；版本旧；Run 已结束（暂停中断的写“点继续”）→ `busy`。
  - “接续已被用掉”= Run 是 `YieldedWait`，任务租约的持有者不是这次 Run（`tasks/control-service.ts:256-258`）；租约在 `readExecution` 的结果里（`model/execution-read-contracts.ts:24-31`、`:90`）。
  - `runControlFence`、`isPausedInterrupted` 在 `state/run-machine.ts:187`、`:209`。
- 重新入队（“继续”也是它，TASK-27）要目标是 `active`，否则 `busy`“先恢复目标”（`state/task-machine.ts:1240`），不管当初是谁暂停的。请求者只能是人，或带 `goal_resume` 触发的目标恢复。
- GOAL-29（`state/goal-machine.ts:626-671`）：目标恢复以后，只替“被这个目标的扇出暂停、在主机重启时停下（RUN-24）、还没有 TaskRequeue 覆盖”的工作任务自动接着做；指针意图要是扇出的暂停（`stopRequesterOf(intent) === 'goal_fan_out'`，`state/task-failure.ts:102`），而且就是 Run 核对观察里的 `pausedIntentRef`。人单独暂停的从不选。目标不是 `active` 时一条也不给。
- P19 的原因带着它是哪次 Run：`paused_interrupted` 的 `detail` 是 `{ afterRunRef, pausedIntentRef, kernelPaused }`（`state/task-machine.ts:182-187`）。
- `executions/resolve-unknown` 只有持有 Host 实例租约的 Host 能提交，否则报 `busy`（`create-platform.ts:1314-1316`）。`sessions/archive-line` 的所有者是 Workflow（`app/core-routes.ts:344`）。
- QueryRun 的执行阶段 claimed/prepared/entering/entered/unknown/settled（`src/contracts/query-job.ts:375`）；`QueryRunV1` 有 startedAt、endedAt；QueryJob 有 `goalId`。
- `SessionMessage`（`model/communication-contracts.ts:98-172`）：status pending/read/responded；`acceptedInputs`（Kernel `run.input_accepted` 写的“哪一部分进了哪次执行”）；`replyHandler`；`archiveWaitDisposition`；`readUndeliveredReplies` 是可选成员（`:328-330`）。没有“已生效 / 被拒绝 / 已到期 / 已转交 / 已撤回 / 待放行 / 不发”的字段（第 7 片加）。按收信 Session 找消息的索引已有（`sessions/message-record-codecs.ts:97-100`）。
- Session 原历史由 AgentRuntime 读：`readSessionHistory({ sessionRef, afterCursor, throughCursor, limit })`，每条带 `recordedAt` 和游标（`core/agent-runtime/session-operations.ts:39-51`；路由 `sessions/history`）。views 引不到。
- 职责解析在组合根（`src/composition/session-duty.ts:57-94`），类型 `SessionDutyResolver` 在 `business/workflow/ports.ts:76`，WorkGraph 的 views 引不到。读角色配置失败、抛错、缺 ctx，一律给 `unknown`，从不报错（`session-duty.ts:9-10`、`:64-71`、`:90-92`）。
- `WorkspaceSnapshot` 只有可选的 `decisionSettings`（`src/contracts/ledger.ts:45-50`）。请知悉位置的写法是现成的样板：纯状态函数 `state/notice-settings-machine.ts`（记录由 `buildWorkspaceDecisionSettingsRecord` 产出，`:76-79`）+ 配置层服务 `configuration/decision-settings-service.ts` + `graph_write` 路由。三处会挡住一个新字段：
  - `decodeWorkspaceSnapshot` 只重建 ref、revision、decisionSettings，别的字段丢掉（`persistence/record-codecs.ts:724-739`）；
  - 写事件的值检查 `workspaceSnapshotValueProblem` 只认 ref、revision、可选的 decisionSettings，多一个键就拒（`record-codecs.ts:518-538`）；`WorkspaceNoticeSeenChanged` 事件的校验调它（`persistence/decision-record-codecs.ts:452-458`、`:497-500`），存储在提交时跑事件校验；
  - 请知悉的写入从存储读工作区、算下一版、整份写回（`decision-settings-service.ts:200-245`），重放靠解码自己的事件拿回原值（`:107-123`）。
- 状态写入检查（`tests/architecture/state-writes.test.ts`）把 `WorkspaceSnapshot` 列为受保护记录，字段只有 `decisionSettings`，产出者只有 `buildWorkspaceDecisionSettingsRecord`（`:80`、`:132-133`）；能产出受保护类型的解码函数有一张允许表（`:164-169`）。
- `views` 只读，可以依赖 model、state、persistence、configuration、materials、architecture、sessions、queries、tasks、evidence、communication（`docs/refactor/module-target.json:150-165`）。`configuration` 只能依赖 model、state、persistence（`:47-55`）；Session 的解码在 `sessions/session-record-codecs.ts:1021`，`configuration` 引不到。
- 组合根把内部的所有者组设成不可枚举（`create-platform.ts:1450-1453`）；`tests/composition/platform.test.ts:56` 断言平台可枚举键的完整列表。
- 界面路由标签表是 `Record<CoreRouteSuffix, string>`（`src/ui/api/routes.ts:13`），加路由必须加标签，否则类型检查不过。

**顺带发现、不在本片修（报给 lead）**
- 第 1 片的维护只给活跃的 Session 补来历（`session-maintenance.ts:434`、`:447-458`），`readSessionFacts` 的“还有没补来历的旧 Session”却连已归档的也算（`session-facts.ts:306-322`）。工作区里只要有一个第 1 片之前就归档的旧 Session，`legacyPending` 就一直是 true，没有接续的退役线就一直报 `incomplete`、不归档。工作区 Session 超过 2,500 个时扫描必然超页，结果一样。这会让左栏长期多出“已退役”的行。建议另开一小块修：补来历也覆盖已归档的 Session（分批、有上限）。修了它，L6 说的“旧的已归档 Session 各成一条线”也一起消失。本片只如实显示。
- K 合入以后仍有几种退役线维护不归档（Query 线；KA1 不满足或关不掉、又落在今天豁免里的 Work 线；来历核不清的 Work 线，见上“自动维护”），它们会一直显示“已退役”，和决定 38 的“马上归档”不一致（§0.1 告知）。
- 图读取带 Session 时读全工作区、10,000 个封顶（见上）。决定 25 说 Session 会上万。本片的节点详情不走这条路（L14）；`graph/look` 的修法留给第 4 片改“看”的时候。

### 0.3 lead 定的技术选择

**总的做法。** 新建一个读模型（`views/work-line-reader.ts`），入口：活跃线列表、归档线分页、单条线、单条线的分节。线的状态由一个纯函数算（`state/line-status.ts`），列表、悬停、详情都调它，所以结果一定相同（决定 49 · 02）。线的对话（原历史按线拼起来）在 Host 的组合里拼（L12）。置顶是本片唯一的写。悬停数据和节点详情另建一个读（`views/node-detail-reader.ts`），不改 `tasks/query` 和 `graph/look` 已有的结果。

- **L1 列表读什么。**【lead 定，待审】
  - 只读开着的工作：按 `session-by-workspace-lifecycle` 读这个工作区**全部活跃** Session，按页读到底。活跃的规模由正在干活的线决定，不由历史决定（DESIGN §6 开头）。
  - 历史只读固定条数，不读到底（L18）。不调用 `readSessionFacts`（它每次扫整个工作区）。
  - 每次列表读按下表读。每一项都走索引，或按引用批量读（`readMany`）：

    | 读什么 | 对谁 | 怎么读 |
    | --- | --- | --- |
    | 有没有接续后继（N2） | 每个活跃的、不是副本的 Session | `s2c-session-by-kind-from`，种类 `continuation`、`from` 是它，取 1 条 |
    | 前任；查环（N9） | 每个线头，和 N2 要去掉的每个 Session，沿 `from` 往回 | 每一步批量 `readMany`，最多 32 步（L2） |
    | 开着的负责链接 | 链上每个活跃的 Session（已归档的没有开着的 task、work 负责链接，§0.2；它们开着的模块链接不读） | `s2c-open-links-by-session`，关系 `responsible`、`until` 为 null，读到底。只读开着的负责关系；`participates`、`investigated` 这种历史关系不读 |
    | 做过的任务（完成证据，L1a） | 职责是执行者、现在负责的任务全终结或没有的线头 | `s2c-closed-task-links` 按关闭位置倒序取 21 条；总数用 `countLookup`；这 21 条每条 `eventAt(until)` 读关闭事件。**不往下翻** |
    | 占用者、它的控制意图 | 有占用的线头 | 批量 `readMany` |
    | 最近一次工作执行 | 没有占用的线头 | `lastExecutionRef` 是 Run：它就是 generation 最大的那次，批量 `readMany`；是 QueryRun：`s2c-work-claim-by-session-generation` 倒序取 1 条（generation 最大），再 `readMany` 那次 Run |
    | 控制要用的事实（L16） | 占用者 Run、最近一次工作执行 | 指针意图批量 `readMany`；Run 所属 Goal 的期望状态（同下面每个 Goal 一次）；Run 是 `YieldedWait` 时读任务租约（`readExecution`），算“接续已被用掉” |
    | 暂停中断的任务能不能继续（L16） | 现在负责的、原因是 `paused_interrupted` 的每个任务 | 读它 `afterRunRef` 那次 Run 和它的指针意图（`readMany`）；重新入队检查要的事实（选中的 Run、处置、依据能不能解析、检查链、Goal 状态）照 `tasks/requeue-service.ts:395-447` 的 `readRequeueWindow` 读，只读不写；其中按目标读的规范任务事实和下面“任务行”是同一次（共享代价，L1b） |
    | 最近一次 Query（L20） | 秘书的线头 | 占用者是 QueryRun 就用它；否则 `lastExecutionRef` 是 QueryRun 就用它；否则 `s2c-query-run-by-session-generation` 倒序取 1 条（L4） |
    | 等谁回复（T7） | 最近一次工作执行让出了的线头 | continuation 那条消息，批量 `readMany` |
    | 任务行 | 现在负责的任务所属的每个 Goal | 每个 Goal 一次 `queryTaskGraph`，加 Goal 记录 |
    | 任务上的锚点 | 同上的每个 Goal | §3.12 的“锚点怎么读” |
    | 线上 Session 写下的锚点和它们接手没有 | 链上每个 Session | `s2c-anomaly-by-session` 分页；每条锚点照 §3.12 算接手没有。**受这一行的读预算管（L1b）** |
    | 未送达的回复 | 不可用的线头 | `readUndeliveredReplies` 分页；端口没装时报 `unavailable`。**受读预算管（L1b）** |
    | 接手自哪条线 | 链最早那个 Session 的来历是 `handoff` 的线 | 从 `from` 沿 `s2c-session-by-kind-from`（`continuation`）往后找线头，最多 32 步 |
    | 职责 | 每个线头 | 注入的职责端口（L7），同一个角色引用只解析一次 |
    | 决定队列 | 整个工作区一次 | 2A 的读取 |
    | 计数 | 整个工作区 | L5、L6 的 `countLookup`，不读记录 |

  - **L1a 做过的任务只认完成证据（lead 2026-10-14）。** 证据说明这个任务是在这条线负责的时候结束的，有两种：
    - (a) 线上开着的 `responsible` task 链接，它的任务**现在已终结**（满足，或处置是取消、替代；§3 记号）。这条线还负责着，任务就结束了，维护还没来得及关负责关系。这种不用读历史，开着的负责链接本来就读（L1 的表）。所以任务一满足，这条线马上就是“已做完”，不用等维护（lead 2026-10-14）。
    - (b) H 一条关了的 task 负责链接，**关闭方式是 `terminal`**。
    - 关闭方式是 `transfer`（转走）、`drop`（归档时放下）的不算，哪怕那个任务后来在别处做完了。
    - 关闭方式这样读：对这 21 条，每条 `eventAt(link.until)` 读那个位置的事件。事件是 `SessionResponsibilityChanged`、能解码、`closed.ref` 就是这条链接、`source` 是 H，才读它的 `mode` 和 `archiveStep`。任一条不成立，这条的关闭方式记作“未知”。
      - 今天每次负责关系的提交只有一条事件、只关一条链接，`until` 就是那条事件的位置（§0.2），所以能对上。一次提交关几条链接的写法今天没有；以后有了，`eventAt` 只读回那次提交的最后一条事件，别的链接的 `closed.ref` 对不上，记作“未知”，不会认错。
      - 经 `sessions/link` 关掉的负责链接，事件是 `SessionWorkLinkChanged`，没有关闭方式，记作“未知”。
    - (b) 只读最新 21 条和总数，按关闭位置 `until` 从新到旧读，不往下翻。
    - **完成证据的真值表（lead 2026-10-14 第三轮第 3 条；A2 那一列按第五轮第 3 条、第六轮第 1 条改成保守的）。** T8、A2、`doneEvidence`、`LineDoneEvidenceV1` 和测试都照这一张表，别处不另写规则。

      | 行 | 读到的事实 | T8（活跃的 H） | A2（已归档的 H） | `doneEvidence` |
      | --- | --- | --- | --- | --- |
      | DE1 | 有 (a)：开着的负责链接，任务现在已终结 | 已做完 | 不会出现（归档的 H 没有开着的 task 负责链接） | `complete` |
      | DE2 | T8：读到的那几条里有 `terminal`。A2：**关了的负责链接一共不超过 21 条，全都读到了**、里面没有“未知”、至少一条 `terminal`、**没有一条带 `archiveStep`** | 已做完 | 已做完（“已归档 · 已做完”） | `complete` |
      | DE3 | 只有 A2：读到的那几条里有一条带 `archiveStep`（某次归档时放下或交出了任务） | —（T8 不看 `archiveStep`） | 不是已做完，只写“已归档”（A3） | `complete` |
      | DE4 | 没有正证据（读到的没有 `terminal`，T8 也没有 (a)），读全了：总数不超过 21、21 条里没有“未知”、读预算没在读完之前用完 | 不是已做完，普通的待命 | 不是已做完（A3） | `complete` |
      | DE5 | 其余：没有正证据又没读全（总数超过 21、21 条里有“未知”、读预算在 21 条读完之前用完）；A2 还包括（DE3 没命中时）：读到了 `terminal` 却不是 DE2，也就是**总数超过 21**（不论 21 条里有没有 `terminal`；先判 DE3，读到的 21 条里有 `archiveStep` 就是 DE3，lead 2026-10-14 第七轮）、有“未知”、或读预算用完 | 不是已做完，待命，原因 `done_unproven`（“做过的任务读不全”） | 不是已做完（A3），原因 `done_unproven` | `incomplete` |

      - A2 按 DE3 → DE2 → DE5 / DE4 的先后判：先看有没有带 `archiveStep` 的，有就只写“已归档”；再看是不是全读到了；总数超过 21 的已归档线**永远不是 DE2**，按 DE5（lead 2026-10-14 第六轮第 1 条）。
      - **A2 是保守的，从不把一次放下或交出了没做完任务的归档说成做完。** 只有关了的负责链接全都读到、里面一条带 `archiveStep` 的都没有，才写“已做完”。所以：一次归档里放下了没做完的 X、同时按终结关掉了早就做完的 Y（归档组合先处置 X、再关 Y，`business/workflow/session-archive.ts:496`、`:515`）→ 读得到 X 的 `archiveStep`，只写“已归档”；同样的归档、但早就做完的有 21 个（一共 22 条关闭）→ 总数超过 21，按 DE5（`done_unproven`），也不写“已做完”。第五轮的“只看最新 21 条”做不到这一点：X 的 `archiveStep` 会被后面那 21 条 `terminal` 挤出窗口（Codex 第六轮第 1 条）。
      - 代价是一种已知的错标：归档时放下过任务、后来重新启用、做完一个任务、再归档的线，旧的 `archiveStep` 还在读到的关闭里，就只写“已归档”，不写“已归档 · 已做完”；关闭超过 21 条的已归档执行者线，也只写“已归档”、标 `done_unproven`（§10 末尾）。它们只会少说“做完”。
      - T8 那一列不变：“正证据”= DE1 或 DE2，有正证据就是已做完；读预算用完不推翻 (a)，也不推翻已经读到的 `terminal`（只对 T8）。A2 那一列不用这一条，照 DE3、DE5。
      - “未知”算没读全：未知不是没有（规则 5；lead 2026-10-14 认可）。
    - 悬停“做过的任务”先列 (a) 的任务，再列读到的 `terminal` 的，合起来最多 20 项；`omitted` 见 §3.2 T8 的补充。
  - **L1b 读预算：历史部分每一行有一个上限（lead 2026-10-14）。**
    - 一行里有几部分没有索引能把读的量限在“待办”上，读的量随历史增长：
      - 线上 Session 写下的锚点：要读这些 Session 写过的全部锚点，每条再读它那个任务的全部 Run 才知道接手没有（§0.2）；
      - 未送达的回复：`readUndeliveredReplies` 要翻完发信 Session 发过的全部消息（§0.2）；本片按每页 100 条读（读口的上限，`mailbox-service.ts:3090`）；
      - 做过的任务：21 条（`lookupOrdered` 一页）加总数（`countLookup`）加 21 次 `eventAt`，再读这些任务的标题。
    - 这几部分合起来，每一行最多读 `LINE_HISTORY_READ_BUDGET` 次（**100 次**，lead 2026-10-15 照下面的做法量定，见 §0.2“读预算的实测”和 §16；原写“暂定 2,000 次”；这是冻结的前提：冻结前 lead 按下面的做法量，数和证据写进 §0.2，lead 2026-10-14 第五轮第 6 条）。读模型的工厂可以注入别的数，测试用小的数造“超了”。
    - **数的是真读了多少（lead 2026-10-14 第三轮第 1 条）。** 每一行的这几部分，都经这一行自己的一个**计数包装**读存储；它们调用的已有读口（未送达用的邮箱读、锚点用的锚点读）也用这个包装造出来，所以读口里面嵌套的读一样被数到。数法：
      - 每一页 `lookup` 算 1；每一页 `lookupOrdered` 也算 1（做过的任务就用它，lead 2026-10-14 第四轮第 5 条）；
      - 一次 `readMany` 里每要一条记录算 1（批量读 50 条算 50）；发出去之前，先拿整个请求的条数和剩下的额度比，不够就整个拒绝，不读一半；
      - 每次 `eventAt` 算 1；
      - 每次 `countLookup` 算 1。
      - 组合根注入的是这两个读口的工厂（给一个存储，造一个读口），不是现成的读口；每一行用自己的计数包装去造。
    - **先后固定（第四轮第 5 条）：** 这几部分按“写下的锚点 → 未送达的回复 → 做过的任务”的先后读，列表、详情、悬停都一样。所以同一行、同样的数据、同样的预算，在三处用完的地方一样，报的“没读全”也一样。
    - **用完了：** 包装对这一行再来的读一律拒绝。嵌套的读口因此失败，这一部分就停，排在它后面的部分也不再读，都照下面如实报“没读全”（`partialParts` 里写明哪一部分、`history_budget`），从不报 0，也不报“没有”；用完以前已经读到的照样算：
      - 写下的锚点：`writtenAnchorsPending` 报 `partial`（`atLeast` = 已确认没被接手的条数），关注 `attentionComplete: false`；
      - 未送达：报 `partial`（`atLeast` = 已读到的条数）；
      - 做过的任务：照 L1a 真值表。活跃的线（T8）：不推翻 (a) 和已经读到的 `terminal`，没有正证据就是 DE5。已归档的线（A2）：照 DE3、DE5，读到的 `terminal` 不够写“已做完”（lead 2026-10-14 第六轮第 5 条）。
    - **共享代价，不算进每行的预算**（一次列表读里每个目标、每个工作区只读一次，几行共用）：
      - 每个目标一次 `queryTaskGraph`（里面的规范任务事实读这个目标全部的 Run，`tasks/plan-readers.ts:1431-1436`；2A 已去掉它原来的上限）；
      - 决定队列（2A，整个工作区一次）；
      - 目标上的锚点（§3.12：`listSessionAnomalies` 按目标读，它先读出全部匹配的锚点再切页，`tasks/session-anomaly-service.ts:652-670`；再对有未接手锚点的任务调 `readTaskArchiveState`）；
      - 暂停中断任务的重新入队事实里，按目标读的那部分（和任务行同一次）。
      - **这是没有上限的共享工作**（第四轮第 5 条）：随目标做过的事增长，不随工作区增长；不在每行预算之内，本片也不给它们另设上限、不报 `partial`。2C-25 量它们的读次数和耗时，写进证据。
    - 别的部分（活跃 Session、开着的负责链接、占用者、最近一次执行）不受这个预算管：它们是开着的工作，或者只读 1 条。
    - **冻结前怎么定这个数（lead 做）：**
      1. 在 2C-25 的数据上（两个后端各一遍），用不设上限的预算跑一次 `lines/list`，记下每一行这几部分的读次数，和共享代价的读次数、耗时；
      2. 普通的行（1,100 条里除 R、W 以外的）取最大的读次数 m；R、W 各自的读次数 r、w；
      3. 定预算 = 不小于 2 × m 的整百数，并且要让 R、W 在这个预算下读全（预算 ≥ max(r, w)）；做不到就把 r、w 和耗时报给用户再定；
      4. 把这几个数和定下的预算写进证据，并写进 §0.2（“已有的读”末尾加一条“读预算的实测”），替换掉“暂定 2,000”。没量完不冻结。
  - DESIGN §4.8 提议“每个 Session 最多读 3 次”。上表按线头算多于 3 次。开着的工作照读；历史部分只读固定条数，或者受 L1b 的读预算管，不随历史无限增长。这个次数没实测，lead 验收时在 2C-25 上量（§5.2 末尾）。
  - 一次返回全部活跃线，已排好序，不分页。活跃线要整体排序，分页并不省读；返回的大小由活跃线的条数决定。这和 DESIGN §4.9“分页读活跃的 Session”不同，lead 在 DESIGN §4.9 加注（§6）。
- **L2 哪些 Session 算一条线，线头是谁。**【lead 定，待审】按 DESIGN §4.9、决定 35 · Q3、AMB-1、AMB-2（表 §3.1）。
  - 线的键是**线头 Session 的引用**，只在这次读里有意义，不存线的编号。
  - 线头 = 不是只读副本、也没有“接续”后继（不论后继活跃还是已归档）的 Session。
  - 往回找前任：沿 `provenance.kind === 'continuation'` 的 `from`，最多 32 个；超过时链上写“省略至少 1 个”（不往下数，`LineCountV1` 的 `partial`）。**链的上限只有这一个：线头加至多 32 个前任，一共至多 33 个 Session**（和 2B 的 `sessionRefs` 一样；lead 2026-10-14 第三轮第 9 条）。本规格凡说“链”“32 个以内”，都是这个意思。
  - **来历成环（数据坏了）先查，再按 N2 去掉非线头（lead 2026-10-14）。** 环上每个 Session 都有接续后继，先按 N2 去掉就一个都不剩，这一行就丢了。所以：
    - 线头和 N2 要去掉的每个 Session（活跃列表里有接续后继的活跃 Session；归档分页里有接续后继的已归档 Session），都沿 `from` 往回走（同上，批量 `readMany`，最多 32 步）。
    - 走到一个已经走过的 Session，就是环。环上 refKey 最小的那个 Session 出一行，带问题 `invalid`，原因写明环上的 Session（MODEL R02）；环上的 Session 不再按 N2 去掉，也不再各出一行。
    - 走到链头（来历不是 `continuation`）或走满 32 步，都不算环，照 N2、N8。
    - 读的代价：线头本来就要往回走；多走的只有 N2 要去掉的那些。活跃的这种 Session 只在交接没做完时有（E1），很少；归档分页每页最多多走 32 次批量读。
    - 今天的服务造不出环（来历在建 Session 时写上，只能指向已有的 Session）。这是防御，不写测试（AGENTS 第 4 条：不加只有改数据库才能触发的测试），由代码审查核对。
  - 换手的接任者另起一条线，标“接手自 <原线>”；副本挂在被问的那条线上。
- **L3 RecordStore 加计数端口 `RecordCountPort.countLookup`，两个后端行为一致。**【lead 定，待审】DESIGN §4.9“计数：存储层加一个计数方法”。
  - 单独一个端口，不加进 `RecordLookupPort`。测试里十几个只实现 `lookup` 的夹具对象（§0.2）就不用改；2C 的读要 `RecordLookupPort & RecordOrderedLookupPort & RecordCountPort`。
  - 请求 `{ index, values, distinctPath? }`：
    - 没有 `distinctPath`：校验和 `lookup` 完全相同（登记过、每个路径一个标量值、值可以是 null），只是没有 `limit`、`after`。返回匹配的行数。
    - 有 `distinctPath`：它必须是这个索引的最后一个路径，`values` 只给它前面的路径。返回这些行里 `distinctPath` 有几个不同的值。
    - 有排序路径的索引（2A 的登记）：`values` 给等值路径，每个都必须是非空文字（和 2A 的 `lookupOrdered` 一样）；只数排序值是候选的行：`valueType: 'text'` 是非空字符串，`valueType: 'integer'` 是 JSON 整数（和 2A 的候选规则相同）；不支持 `distinctPath`。
  - **“不同的值”怎么算（lead 2026-10-14）：** 分类型，数字的归一和今天等值查找的编码相同（`lookup-index.ts:185-193`）。
    - 文字、数字、`true`、`false` 是四类，不同类的值永远不同：`true` 不等于 `1`，`false` 不等于 `0`，`"1"` 不等于 `1`。
    - 数字之间按数值比：`1` 和 `1.0` 是同一个值（JSON 解析后本来就是同一个数）。
    - null 和缺字段不算；复合值本来就不是候选，也不算。
    - 手算例子：这个路径的值依次是 `true`、`1`、`"1"`、`false`、`0` → 5；再加一行 `1.0`、一行 null、一行缺这个字段 → 仍是 5。
    - SQLite 不能直接用 `COUNT(DISTINCT json_extract(…))`：它会把 `true` 和 `1`、`false` 和 `0` 当成一个值。要按（类型类，值）去重：类型类是 `json_type` 归成文字、数字（`integer`、`real` 合一）、`true`、`false` 四类。具体 SQL 施工时定，两个后端结果必须相同。
  - 返回 `{ count, readThrough }`。SQLite 用同一套等值谓词计数，走同一个表达式索引，不读快照；内存后端数同一组候选桶。
  - 代价：SQLite 要扫过索引里匹配的那一段，耗时随匹配的条数增长，但不读记录。规模用例记下耗时（2C-25）。
  - 索引不存在报 `unsupported`，请求不对报 `invalid`，不抛异常。
  - 验收时 lead 另用 `EXPLAIN QUERY PLAN` 确认 SQLite 走索引，不进单元测试。
  - 2A 已照同样的办法另起 `RecordOrderedLookupPort`（2A 规格 §2，lead 2026-10-14），这些夹具不受影响。
- **L4 新索引八个（数过：Session 三个、SessionWorkLink 两个、DispatchOutboxEntry 一个、QueryRun 一个、SessionAnomalyAnchor 一个）。**【lead 定，待审；lead 2026-10-14 改了两个；第三轮加过按时间的第 9、10 个，第四轮随“对话不再按时间合并”去掉了（lead 2026-10-14 第四轮第 1+2 条）】旧索引都不动（`session-by-provenance` 第 1 片在用）。
  - Session（登记在 `sessions/session-record-codecs.ts`）：
    1. `s2c-session-by-kind-from`：`ref.projectId`、`workspaceId`、`provenance.kind`、`provenance.from.sessionId`。“有没有接续”= 取 `continuation` 一条；“问过它的副本”= 取 `readonly_copy`；“它的接任者”= 取 `handoff`。不再翻副本。
    2. `s2c-session-by-lifecycle-kind`：`ref.projectId`、`workspaceId`、`lifecycle`、`provenance.kind`。给计数用；旧 Session 没有来历，`provenance.kind` 取 null。
    3. `s2c-session-archived-at`：`ref.projectId`、`workspaceId`、`lifecycle`，`orderBy { path: 'archivedAt', valueType: 'text' }`。给归档线分页用。
  - SessionWorkLink（同一个文件）：
    4. `s2c-open-links-by-session`：`ref.projectId`、`ref.sessionId`、`ref.relation`、`until`。取关系 `responsible`、`until` 为 null 的，就是开着的负责链接。比上一稿多了 `ref.relation`：一直开着的 `participates`、`investigated` 链接会随历史增长，不该每次读（L1b 的原则）。
    5. `s2c-closed-task-links`：`ref.projectId`、`ref.sessionId`、`ref.relation`、`ref.target.kind`，`orderBy { path: 'until', valueType: 'text' }`。开着的链接 `until` 为 null，不是候选，所以这个索引里只有关了的。`until` 是定长的提交位置，文字序就是先后序；同一个位置只关一条链接（§0.2），再按 refKey。
  - DispatchOutboxEntry（`tasks/claim-record-codecs.ts`）：
    6. `s2c-work-claim-by-session-generation`：`claim.task.projectId`、`claim.workspaceId`、`claim.sessionRef.sessionId`，`orderBy { path: 'claim.generation', valueType: 'integer' }`。倒序取 1 条就是“最近一次工作执行”，和今天 `session-facts.ts:240` 取 generation 最大的同一个意思；正序按页读，是 `executions` 分节里 Work 的那一路（L12）。不用 `claimedAt`：它是时钟给的，相等、倒退都可能（§0.2）。每次领取都有这条记录，没进入过的执行也是候选。
  - QueryRun（`queries/query-record-codecs.ts`）：
    7. `s2c-query-run-by-session-generation`：`ref.projectId`、`ref.workspaceId`、`run.executionState.sessionRef.sessionId`，`orderBy { path: 'run.executionState.sessionGeneration', valueType: 'integer' }`；同值按 refKey（lead 2026-10-14）。倒序取 1 条挑“最近一次 Query”（L20）；正序按页读，是 `executions` 分节里 Query 的那一路（L12；lead 2026-10-14 第四轮第 1+2 条）。本片自己建，不靠 2B 的那个“已结束的 Query”索引。
       - **先后是准的，不靠时钟。** `sessionGeneration` 是领取这次 Query 时 Session 的版本（`queries/query-execution.ts:958` 写 `nextSession.revision`），和 Work 领取的 `claim.generation` 是同一个计数（都是占用那一笔写后的 Session 版本，`claim-service.ts:1080-1089`），同一个 Session 上严格递增，不会相等。
       - **哪些 QueryRun 有它。** `executionState` 在领取（`claimed`）那一步才写上，`sessionRef` 和 `sessionGeneration` 一起写（`state/query-run-recovery.ts:517-533`）；解码要求有 `executionState` 就必须有正整数的 `sessionGeneration`（`queries/query-record-codecs.ts:373-385`）。所以凡是能算作某个 Session 的 Query 的，都有它，包括没进入就结束的（`not_entered`）。
       - **没有它的 QueryRun 怎么算。** 两种，都不是候选：
         - 还没领取的（`pending`）：还不属于任何 Session，不是谁的 Query，什么都不用报。
         - R5b.2 之前领取的旧记录：`executionState` 不在（`src/contracts/query-job.ts:61-65`：“historical claims”），连 Session 都没记下，今天的 `query-run-by-session` 也找不到它们。它们比同一个 Session 上任何有 `executionState` 的 Query 都早，所以索引找到的那一条一定是最近的。索引一条都没找到、`lastExecutionRef` 又不是 QueryRun 时，按旧数据的情况如实报：线头是来历为 null 的旧 Session（已经标“来历未核对”，M7）时，线名带 `complete: false`（“最近的 Query 可能是读不到的旧记录”）；不是旧 Session 的，没有就是没有。补过来历的旧 Session 认不出来，这是已知的缺口（§10 末尾）。`executions` 分节不按来历推全不全，只保证列出有索引的执行（`scope: 'indexed'`，L12；lead 2026-10-14 第五轮第 4 条）。
       - 能直接读到的地方不用它：占用者是 QueryRun、或 `lastExecutionRef` 是 QueryRun 时，那一个就是最近的 Query（L1 的表），旧记录也一样。
  - SessionAnomalyAnchor（`tasks/session-anomaly-codecs.ts`）：
    8. `s2c-anomaly-by-session`：`ref.projectId`、`workspaceId`、`sessionRef.sessionId`。
  - 按顺序的那四个索引（3、5、6、7），等值部分都是非空文字，符合 2A 的规则；6、7 的排序值是安全整数，3、5 是非空文字。
  - 第三轮加过的 `s2c-query-run-by-session-started`、`s2c-run-by-session-started` 去掉了（lead 2026-10-14 第四轮第 1+2 条）：对话不再按时间合并，没有地方再按时间翻执行和 Query（L12）。顺带也就没有了第四轮审查第 2 条说的问题（`startedAt` 在 `entering` 时就写上，`not_entered` 的 Query 也留着它，按它当“进入过”的证据不对）。
  - DESIGN 附录 C 原列 15 个新索引，本片多出这 8 个（§6 文档）。
- **L5 归档线：分页和计数。**【lead 定，待审】
  - **分页：** `s2c-session-archived-at` 倒序（最近归档的在前）。每页去掉副本和有接续后继的（它们不是线头），所以一页可能少于 `limit`，游标照样往后走，读到底 `next` 为 null。
  - **没有归档时间的：** 已归档却没有 `archivedAt` 的 Session 不进这个按顺序的索引（§0.2：写入方都写它，但编解码允许 null）。每次读第一页时用 `countLookup` 比一下：`session-by-workspace-lifecycle`（已归档）的数，减去 `s2c-session-archived-at` 的数。**这两次计数的 `readThrough` 必须相同**，否则 `withoutArchivedAt` 报 `unavailable`、原因 `source_moving`，不相减（lead 2026-10-14 第四轮第 6 条；两次之间有一笔归档就会减出负数）。相同而差不为 0 时，页上写明 `withoutArchivedAt`（“有 n 个已归档 Session 没有归档时间，不在这个列表里”）。已归档计数不受影响：S 按 `s2c-session-by-lifecycle-kind` 数，本来就数到它们。不另建索引读它们；lead 验收时核对今天的数据里没有这种 Session。
  - **计数（已归档 n 条）：** 只用 `countLookup`，不读记录。
    - S = 已归档、来历种类是 `new`、`continuation`、`handoff`、null 的 Session 个数之和（`s2c-session-by-lifecycle-kind` 数四次）；
    - F = 这个工作区里所有 `continuation` 种类的 Session，它们的 `from` 有几个不同的值（`s2c-session-by-kind-from`，`distinctPath: 'provenance.from.sessionId'`）。这就是“有接续后继的 Session”的个数，活跃和已归档都在内；
    - A = 这次读到的活跃 Session 里，有接续后继的个数（N2 那一列）；
    - U = 工作区里来历为 null 的 Session 数（L6 的 `legacyUnchecked`，活跃、已归档各数一次）；
    - C = S − (F − A)。
    - 前提：`from` 都指向本工作区的 Session（`continuationProvenanceFor` 只这样建，`workflow.ts:729-748`）。
  - **只认同一刻：要么准数，要么 `unavailable`（lead 2026-10-14 第三轮第 2 条）。** A 来自活跃列表的读，S、F、U 是之后的好几次计数（S 本身就是四次）。中间账本动了，这些数就拼不到一起，任何拼出来的范围都不可靠。例：活跃的 P 有活跃的接续 C，读列表时 A = 1；接着维护把 P 归档；再计数 S = 1、F = 1，C = 1 − (1 − 1) = 1，可 C 还活跃，已归档的线头其实是 0 条。所以：
    - **同一刻：** 活跃列表第一次读的 `readThrough`（`readWindow.from`），和**每一次**计数（S 的四次、F、U 的两次）回的 `readThrough` 全都相同，说明从读列表开始到最后一次计数，账本没动。只有这时才用 C。
    - **不是同一刻：** 报 `unavailable`，原因 `source_moving: …`，不给范围。不整窗重读（L11）。界面照旧显示上一次读到的数，标“更新中”（E3 落地）。
  - **同一刻时：**
    - C 必须在 0 到 S 之间。C < 0 或 C > S 说明数据对不上（例如 `from` 指到了别的工作区）：报 `unavailable`，原因写明三个数，不报成一个准数，也不报 0。
    - U = 0、C 在界内：报 `exact` C。
    - U > 0（L6）：报 `partial { atLeast: max(0, C − U), atMost: C }`，原因写明有 U 个没核对来历的旧 Session。每个旧 Session 至多让一条已归档的线不再算线（它可能是某条线的接续或副本）。这是唯一会报范围的情况。
  - 任何一步读失败，已归档计数报 `unavailable` 和原因，不报 0。
  - 手算例子（工作区里只有写到的这些 Session）：
    - D1（2C-14）：同一刻，S = 2、F = 1、A = 1，C = 2；U = 1 → `partial { atLeast: 1, atMost: 2 }`。
    - 上面的交错例子：不是同一刻 → `unavailable`，原因 `source_moving`；不交错再读一次：A = 0、S = 1、F = 1 → `exact` 0。
    - 2C-26 的旧 Session：见那一行。
  - 已归档计数放在 `lines/list` 里：左栏底部要一直显示“已归档 n 条”（决定 25），它只用索引计数，不读记录。
- **L6 旧 Session 的来历：只读存下的，不补，也不在读里推。**【lead 定，待审】
  - 读从不写，所以不触发第 1 片的补来历（它是写）。
  - 也不在读里调 `deriveLegacySessionProvenance`。它不写，但每个旧 Session 都要扫一遍全工作区的 Session 和两路消息（§0.2），列表每次读都调，比别的读重得多，违反 DESIGN §6。
  - 来历为 null 的 Session 自成一条线，行上标“来历未核对”。这和 AMB-1 不完全一致（§0.1 告知）：
    - 活跃的旧 Session，第 1 片的维护在下一次推进时补上来历（`session-maintenance.ts:447-458`）。补上以后按存下的来历读，能接上的就接成一条线。
    - 已归档的旧 Session 维护不补（§0.2 顺带发现），要等那一小块修。在那之前它们各成一条线，同一刻读到时已归档计数报范围（L5）。
  - `legacyUnchecked` = 工作区里来历为 null 的 Session 数（活跃、已归档各一次 `countLookup`，`s2c-session-by-lifecycle-kind`）。它大于 0，或读不到时，“已退役”的行同时标“来历未核对”：“没有接续”证明不了（和第 1 片维护的 `legacyPending` 同一个保守做法，但不写）。
- **L7 职责从注入的端口读。**【lead 定，待审】在 `model/work-line-contracts.ts` 定一个 WorkGraph 自己的类型 `SessionDutyReadPort`，形状和 `SessionDutyResolver` 一样。组合根把同一个 `createSessionDutyResolver` 的结果传进来。
  - 解析不了是 `unknown`，从不猜成执行者（第 3 片 §4.1）。
  - 这个 `unknown` 也包括读角色配置失败（§0.2：解析器把失败都变成 `unknown`）。所以“职责未知”只表示“没认出来”，不表示“确定没有职责”。界面的分组写“职责未知”，不写成一个数 0。
- **L8 关注从哪来、算到哪条线上。**【lead 定，待审】表 §3.4。
  - 任务的关注只看这条线**现在负责**的任务：链上任一 Session 开着的 `responsible` task 链接，去重（§3 记号）。交接因故障没做完时（决定 48；E3 D47-2），前任还开着的负责关系也算在这条线上。
  - “需要你决定”只认决定队列（2A）里 `waiting_answer` 的卡。一张卡落到这些线上，一条线只算一次：
    - 发卡的 Session（`senderSessionRef`）所在的线；
    - **目标原因卡**（`source.kind === 'goal_cause'`）：按 `source.pins` 里的任务 pin（`ref.aggregateType === 'Task'`）落到现在负责这个任务的线（lead 2026-10-14）。目标原因卡的 `objects` 一般是空的，任务 pin 只在 `source.pins` 里（§0.2，`goal-decision-reader.ts:171-182`、`:287-307`），所以不看它的 `objects`。返工、自动返工、结果未知的卡都这样落；
    - **其它卡**（成员的“请你决定”等）：`objects` 里 `kind: 'aggregate'`、pin 是任务的，落到现在负责这个任务的线；
    - 参谋转来的卡：读卡对应消息的 `forwardedFrom`（批量 `readMany`），原消息的发信 Session 所在的线（DESIGN §1.4；决定 49 · 11）。
    - 一张卡同时有几种落法、或 `source.pins` 里有几个任务都由同一条线负责，这条线也只算一次。
  - 目标原因卡的原因码从 `source.key` 里取：`source.kind === 'goal_cause'` 时，`source.key` 是规范 JSON（`decisionSourceKey`），解析出 `code`。解析不了，这张卡记作“读不全”（`attentionComplete: false`，原因写明），不猜它是哪一种。本片不给 `DecisionCardV1` 加字段。
  - `unknown_outcome` 原因卡算“待核对”，不算“需要你决定”（决定 45、49 · 02）。
  - 不落到任何线上的：只列延后任务的 `required_task_deferred`（它的 `source.pins` 里虽有任务 pin，也不按任务落）；没有任务的目标级原因（`initial_plan_pending`、`change_pending`，`source.pins` 里本来就只有目标和提案）；候选、规划问题、目标冲突。它们在队列和目标栏里。
  - K3 合入以后：`UnknownCallReviewV1` 的 `pending_review` 落到那次 Run 所在的线，算“待核对”；`needs_decision` 本来就是队列里的卡，按上面算“需要你决定”。K3 合入前没有这种记录，不用特别处理。
  - 决定队列读失败：每行关注标“读不全”，列表结果写明原因；不当作“没有要你决定的”。
- **L9 置顶。**【lead 定，待审】DESIGN 附录 C“工作区设置：置顶的工作线”；MODEL O07、“技术推断与边界”。
  - 存在 `WorkspaceSnapshot.lineSettings.pinned`，每项是 `{ sessionRef, pinnedAt }`。置顶时存这次读到的线头。
  - 匹配：一条线的链（线头加至多 32 个前任，L2）里有任何一个 Session 在置顶表里，这条线就是置顶的。所以线被接续、换了新线头，仍然置顶。共用同一个前任的两条分叉线，都算置顶（AMB-2）。
  - 行上给出 `pinnedBy`（命中的那几项）。取消置顶就删这几项，写入方不用懂线的规则。
  - **一次请求是一次原子的变更（lead 2026-10-14）。** 请求带 `add`、`remove` 两个列表，按最后的置顶集合算，只有一个状态行：
    - 最后的集合 = （现在的 − `remove`）∪ `add`。比较按 `sessionRef` 的规范键。
    - 同一个 Session 既在 `add` 又在 `remove`：`invalid`。`add` 或 `remove` 里自己有重复：`invalid`。
    - 已在表里、又在 `add` 里的：保留原来的 `pinnedAt`，位置不变。新加的：`pinnedAt` 是这次请求的时间（服务注入的时钟），按 `add` 里的顺序接在后面。`remove` 里不在表里的：忽略。
    - 容量按最后的集合算：超过 100 项报 `capacity`。所以表满 100 项时，“删一个、加一个”能一次做成。
    - 校验只对 `add` 里新加的 Session 做（在这个工作区、不是副本）；`remove` 里的不校验，Session 不在了也能删。
    - 版本只加 1，不论加了几项、删了几项。
    - 最后的集合和现在的完全相同（包括 `pinnedAt`）：不写记录，照样提交这条事件，供重放（同 `markNoticesSeen`，`decision-settings-service.ts:225-245`）。
  - **写入照请知悉位置的样板**，每一处都要有：
    - 纯状态函数 `state/line-pin-machine.ts`（新行 S2C-PIN-01：一次置顶变更，`add` 和 `remove` 一起），记录只由它导出的 `buildWorkspaceLineSettingsRecord` 产出（状态写入检查认它，§5.3）；
    - 配置层服务 `configuration/line-settings-service.ts`；
    - 一个持久的写事件 `WorkspaceLinePinsChanged@1`，信封和 `WorkspaceNoticeSeenChanged` 相同，载荷 `{ value: 写入后的整份 WorkspaceSnapshot, proof: null }`。编码、解码、校验和 `LINE_SETTINGS_RECORD_SCHEMAS` 放在新文件 `persistence/line-settings-codecs.ts`，组合根把它加进存储的事件登记表。`identityKey` 由工作区、操作者、requestId 算；`fingerprint` 由工作区、`add`、`remove`、`expected` 算。同一个 requestId 重放：`lookupCommit` 命中 → `eventAt` 读回这条事件 → 解码 → 返回原来的值（同 `decision-settings-service.ts:107-123`）；
    - `graph_write` 路由 `lines/pin`。只给操作者（人），带工作区版本，对不上 `revision_conflict`。
  - **工作区记录的读写要认这个新字段**（§0.2 的三处）：
    - `decodeWorkspaceSnapshot`、`validateWorkspaceSnapshot` 原样保留 `lineSettings`（有就逐字节带上，没有就不补默认值），有它时先校验形状；
    - `workspaceSnapshotValueProblem` 接受一个可选的、校验过的 `lineSettings`，所以请知悉的写事件带着它也能提交；
    - 置顶的写入和请知悉的写入都是“读整份工作区 → 改自己的字段 → 整份写回”，谁先谁后都不丢对方的字段。
  - **校验：** 新加的 Session 必须在这个工作区、不能是只读副本（副本不是线）。服务不能引 `sessions/` 的解码（`configuration` 只能依赖 model、state、persistence，§0.2），所以由组合根注入一个读，类型在 model：`SessionDirectoryPort['readSession']`（`model/session-contracts.ts:56`），由 sessions 的所有者实现。最后的集合最多 100 项，超过报 `capacity`。已归档的线也能置顶，只在归档列表里标出，不影响活跃列表。
- **L10 排序。**【lead 定，待审】决定 25。
  - 排序键：置顶在前 → 关注档（需要你决定 0、失败 1、受阻 2、待核对 3、**读不全 4**、没有 5）→ 最近活动时间倒序 → 线头 refKey。
  - “读不全”档：这一行没有已知的关注，但关注没读全（`attentionComplete: false`）。未知不是“没有”，所以它排在“待核对”后面、“没有”前面，并标出。已知有关注的行照已知的那一档排，同时标“读不全”。
  - 最近活动时间 = 下面几项里最晚的：线头的 `createdAt`；`lastExecutionRef` 指向的执行的 `endedAt`，没有就 `startedAt`，再没有就领取时间；活跃副本那一轮的 `startedAt`。
  - 每行给出排序键。“看的时候不跳”“顺序已变 · 重新排序”由界面拿排序键自己比（E3）；后端不存快照，读也不能写。
- **L11 读的一致性。**【lead 定，待审】
  - 一次列表读会调很多次存储，账本可能在中间前进。本片不做 2A 那样的“整窗重读”：忙的工作区几乎每秒都有提交，整窗重读会一直失败。
  - 做两件事：结果写明读窗口 `readWindow { from, to }`；一条线的事实互相对不上时（例如 Session 还记着占用者，那次 Run 却已经正常结束），重读这一条线一次，还对不上，这一行报 `source_moving`，不猜。
  - 活跃线的计数从同一批行里数，所以和显示的行一致。
  - 已归档计数是另几次读，结果里带它自己的 `asOf`（最后一次计数的 `readThrough`）。只有活跃列表第一次读和每一次计数的 `readThrough` 全都相同时，才报准数（或旧 Session 的范围）；否则报 `unavailable`、原因 `source_moving`，不给范围（L5；lead 2026-10-14 第三轮第 2 条）。这只是比几个位置，不重读。
- **L12 线的对话和线的执行分成两个分节，都不按时间合并。**【lead 定，待审；lead 2026-10-14 第四轮第 1+2 条：去掉第三轮的按时间合并，它的游标在时钟倒退时会重复给出已经给过的项】DESIGN §6“工作线的对话：已有的 Session 原历史，按线拼起来”；决定 49 · 02（后端处理干净，界面只显示）。
  - **两个分节的游标都绑着这条线的链（lead 2026-10-14 第五轮第 2 条）。** 游标里带分节名、线的键（线头）、第一页时链上各段 Session 的有序列表（或它的摘要）。后面的页先读一次链：链变了（例如旧 Session 补上来历以后多出前任，或链已满 33 个时又被接续，段的次序就全变了）→ 报 `source_stale`，界面从第一页重读。“第几段”只在同一条链里有意义。
  - **`conversation` 分节：只有原历史。** 链上的 Session 一段一段给，最早的那段在前。每段先出一行段开头（从哪天到哪天、原历史能不能读、Kernel 身份），再经 AgentRuntime 的 `readSessionHistory` 按 Kernel 的位置读这段的原历史。
    - 游标 =（上面绑链的部分，第几段，这一段的状态）。这一段的状态有三种（lead 2026-10-14 第六轮第 4 条加了第一种）：
      - `before_header`：这一段的段开头还没给出。一段读完（最后一条原历史已给出；Runtime 读回的那一页 `nextCursor` 为 null，就知道这段没有了），或一段读不到（只有段开头那一行）以后，页满了，游标就记“下一段，`before_header`”；下一页先给那一段的段开头。
      - `header_only`：段开头已给出、原历史还一条没给（例如 `limit: 1` 的一页只放得下段开头）。
      - 最后给出的那条原历史的 `SessionHistoryEntry.cursor`：用 Runtime 给的那个不透明的游标原样接着读（它带着 Runtime 冻结的历史边界），不只记 `source.position` 的数字。
      - “给出”指真的放进了页里，不是预先读进来的；下一页从这里接着读，读完这段再进下一段。所以不重不漏，也不用合并。
    - `missing`、`damaged` 的段只出段开头一行“原历史读不到”和原因（E3 5.6-8），不去读；给出这一行以后，游标进下一段的 `before_header`。
    - 段开头和段的读法由 WorkGraph 的 `readWorkLineConversationSource` 给（链、每段的 Kernel 身份、原历史能不能读）；Host 的组合（新文件 `src/composition/work-line-conversation.ts`）读原历史、分页，实现路由 `lines/page` 的 `conversation` 分节。读原历史是只读的；除此之外本片的读都不调 AgentRuntime 和 Kernel（规则 1）。
  - **`executions` 分节：这条线的 Work 执行和 Query，按 Session 里真实的先后。** WorkGraph 直接给。
    - 链上的 Session 一段一段给，最早的那段在前。每段里，Work 按 `s2c-work-claim-by-session-generation` 正序读（`claim.generation`，L4 第 6 个），Query 按 `s2c-query-run-by-session-generation` 正序读（`executionState.sessionGeneration`，L4 第 7 个），两路按 generation 合成一路。两个数是同一个 Session 上同一个严格递增的计数（L4 第 7 个），所以先后是准的，时钟倒退也不影响。
    - 游标 =（上面绑链的部分，第几段，这段最后给出的那一项的 generation，**每个已经走过的段各自见过的最大 generation**：Work、Query 两路各一个）。下一页两路都从当前段这个 generation 之后接着读（2A 按顺序查找的下界，不含）。
    - **走过的段也要再核（lead 2026-10-14 第六轮第 2 条）。** 交接没做完时前任还活跃（E1），翻到线头那一段以后，前任上还可能有新的执行。所以后面每一页，在同一个时刻里，对每个走过的段、每个索引各做一次按顺序查找（倒序、`limit: 1`），看有没有比游标记下的更大的 generation；有就报 `source_stale`，界面从第一页重读。一页最多多 2 × 32 次查找（链至多 33 段，走过的至多 32 段，两个索引）。
    - **一页只用一个时刻的数据（lead 2026-10-14 第五轮第 1 条）。** 一页要读 Work 的索引、Query 的索引、走过的段的再核，和它要用到的线的事实（链）；这些读回的 `readThrough` 必须全都相同。不同就从这一页的游标重读这一页，一共最多 4 次（同 2A L7）；4 次都对不上 → 这一页报 `unavailable`、原因 `source_moving`，一项都不给。否则可能漏：先读 Work，这时别人领取并做完 W、再领取 Query Q，再读 Query——Q 的 generation 更大，给出 Q 以后游标就越过了 W。这一页之后才提交的执行和 Query：落在当前段或后面的段上的，generation 比已给出的大，会出现在后面的页里；落在已经走过的段上的，让下一页报 `source_stale`（第六轮第 2 条）。
    - 每一项给出：Work 执行的 `status`、`outcome`，Query 的阶段（`phase`）和 `outcome`；显示的时间是记录上的 `startedAt`（可能为 null）。没进入过的执行、`not_entered` 的 Query 也列，照它们自己的阶段写，不说“进入过”。
    - 普通检查放在它的主体执行那一项里（`checks`，每轮带自己的显示时间 `eventAt(since)`），按执行走已有的 `VerificationRoundBySubject` 索引读（`VERIFICATION_ROUND_ORIGINAL_LOOKUP`，`persistence/evidence-record-codecs.ts:650`、`:674-675`；一次执行的轮次链有上限 `VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT`，`:656`）。Goal 门的检查不在这里，在单条线详情的 `gateChecks`（L23）。
    - **保证的是“有索引的执行”（lead 2026-10-14 第五轮第 4 条）。** 这一分节列出链上各 Session 的**每一个有索引的执行**：有派工记录（`DispatchOutboxEntry`）的 Work 执行、有 `executionState` 的 Query。更早的、没有这两样的执行不列，也不替它们编 generation。这是写明的限制（§10 末尾），分节上标 `scope: 'indexed'`；不再按来历去推“这一段全不全”（补来历不会补上这些执行记录，按来历推会在补完以后错标成全）。
  - 副本的一问一答不进这两个分节，在 `copies` 分节里（按 `s2c-session-by-kind-from` 分页）。
  - 其余分节（参与、消息、副本、执行）由 WorkGraph 直接给，Host 原样传出。
- **L13 路由七个。**【lead 定，待审】`lines/list`、`lines/archived`、`lines/read`、`lines/page`、`graph/hover`、`graph/detail` 是 plain 读；`lines/pin` 是 graph_write。界面路由表加七个标签，`GRAPH_WRITE_ROUTES` 加 `lines/pin`。
  - 新的所有者组 `workLines`、`workLineConversation`、`nodeDetail`、`lineSettings` 都是内部所有者，加进 `create-platform.ts:1450-1453` 那张不可枚举的表，所以 `tests/composition/platform.test.ts:56` 的公开键列表不变（第 3 片合入时出过这个回归，STATUS 记着）。
- **L14 悬停数据和节点详情另建读口，不改 `tasks/query`、`graph/look` 已有的结果。**【lead 定，待审】
  - DESIGN §6 写的是“改已有的任务图读取、架构图读取”（【提议】）。`queryTaskGraph` 是 Workflow、维护、决定队列共用的核心读；把锚点、线、风险塞进去，每次派工都要多读这些。所以另建 `graph/hover`：一次读回一个目标的全部节点的悬停数据（目标、阶段、任务、模块和子模块；文件见 §3.12），界面打开页面时读一次（决定 17：悬停只用已经读来的数据）。
  - 节点详情 `graph/detail` 按节点、分节、分页读，都走索引（按任务找链接、按任务和目标找锚点），不读全工作区的 Session。
  - DESIGN 说节点详情“同一个读取也给 agent 的‘看’用”。本片只建这个读口；agent 的 `look_graph` 在第 4 片加记忆分支时一起接上 `detail`（决定 49 · Q2(A)：“看”“找”各加一个分支），免得工具定义改两次（§0.1 告知）。
- **L15 “执行改过的文件”和“用量”归 2B。**【lead 定，待审】
  - DESIGN §8.2 第 2 行把它们列在第 2 片里，决定 50 的 2B、2C 都没点名（§0.1 告知）。它们和每小时计数一样，是 AgentRuntime 在执行结束时从 Kernel 历史取出、存到执行上的，放在 2B 一起做。2B 规格草稿已接下，包括换掉桩和翻转 `tests/scenarios/S5-goal-conflict-rework.test.ts:53-54`。
  - 本片读已有的 `GoalExecutedFilesPort`（接口不变，2B 只换实现）。2B 接上以前它是桩，节点详情的“实际改过”、按文件的风险提示、文件的悬停都如实报“还没有”和原因，不写“没有改动”“没有风险”。
  - **凡是要用“改过的文件”的字段，类型都是“有 / 没有”两种，映射现在就定死（lead 2026-10-14）。** 这样 2B 接上以后本片的代码和测试都不用改：
    - 类型 `FromExecutedFilesV1<T>`（§2）：`{ availability: 'available'; value: T; possiblyIncomplete; sourceCursor }` 或 `{ availability: 'unavailable'; cause: 'not_recorded' | 'read_failed'; reason }`。
    - 用到它的字段：任务详情的 `actualFiles`、模块悬停的 `files` 和 `changedByLines`、`GraphHoverReadV1.files`（文件“涉及它的任务”）、节点详情的 `fileRisks`。
    - 一次读（悬停或详情）对这个目标只调一次 `readGoalExecutedFiles({ goalRef })`，各字段从同一个结果映射：
      - 端口回 `rejected` 或别的非 `ready`：每个字段都是 `unavailable`、`cause: 'read_failed'`，原因带错误码和原文；
      - 端口回 `ready`、`availability: 'not_available'`（今天的桩）：`unavailable`、`cause: 'not_recorded'`，原因“执行改过的文件还没有记录（2B）”；
      - 端口回 `ready`、`availability: 'available'`：
        - 任务的 `actualFiles`：`files` 里 `runRef` 是这个任务的 Run 的那些（Run 和任务的对应用规范任务事实的 `runsByTaskId`），按路径、再按 Run 的 refKey 排；
        - 模块的 `files`（lead 2026-10-14 第三轮第 7 条）：路径落在这个模块或它声明的子模块的 `paths` 下的（按路径段比前缀），**按路径去重**，每个路径一项 `{ path, certainty, runs }`：`certainty` 是改过它的 Run 里只要有一个 `definite` 就是 `definite`，否则 `possible`；`runs` 是改过它的那几次 Run；按路径的 UTF-8 字节序排；
        - 模块的 `changedByLines`：改过这些文件的 Run，由它们领取的 Session 映射到线（同 §3.12 `participatedLines` 的映射），去重后的条数，`LineCountV1`；
        - `GraphHoverReadV1.files`：按路径分组，每个路径列出改过它的 Run 所属的任务；
        - `fileRisks`：按共用文件算出的风险条数（§3.12），`riskCount` 是 `LineCountV1`；
        - 这里的每个计数都是 `LineCountV1`。`possiblyIncomplete: true` 时，原样带上；由它算出的计数报 `partial`（`atLeast`），不报准数。
    - 测试现在就注入一个回 `available` 的端口（真实的文件列表，手写），证明映射对（2C-27、2C-30）；生产组合在 2B 之前接的仍是桩。
- **L16 线上能用的控制，用已有的守卫算。**【lead 定，待审】表 §3.10，E3 5.2-3。
  - 暂停、恢复、取消的可用性按那次 Run 自己的事实算，不看工作区级的能力声明。**用和提交时一模一样的检查（lead 2026-10-14）**，不只看指针：
    - 先是对目标 Run 的几行（`control-intent-machine.ts:470-481`）：QueryRun 不收控制；Run 已结束（不是 `YieldedWait`）不收，暂停中断的原因写“点继续”。
    - 再调 `controlSubmissionProblem`（`:227-252`），事实照提交时的给：指针、`yielded`（Run 是 `YieldedWait`）、接续是否已被用掉（RD-8，读任务租约，§0.2）、指针意图（已生效、观察到停下的暂停才能恢复）、Run 所属目标的期望状态（恢复要 `active`，D-9）。
    - 它回非空，这个控制就是 `unavailable`，`reasonCode` 是它的拒绝码，`reason` 用它的原文（`LineControlV1.reasonCode`，lead 2026-10-14 第四轮第 7 条）。
    - 版本旧不在这里算：控制带 `pins`，提交时版本对不上照常回 `revision_conflict`。
    - **还没进入就暂停的 Run（lead 2026-10-14 第三轮第 5 条）。** 对还没进入的 Run，暂停当场生效（CTL-02、RUN-10），意图是 `applied`、观察是 `paused`（`control-intent-machine.ts:705`），Run 的节点和 `status` 都不变，仍是 `starting`（`run-machine.ts:1701-1739`）。所以它是 T3 的 (d)：“已暂停”，控制给恢复（RUN-11，照上面完整的检查算）和取消。
  - **“继续”：每个暂停中断的任务一项（lead 2026-10-14 第三轮第 6 条）。** 现在负责的、原因是 `paused_interrupted` 的每个任务，都单独算一项“继续”（目标：这个任务和它原因里的 `afterRunRef`，带提交要的版本）。可不可用按重新入队的检查算，纯调用、不写：
    - 事实：`afterRunRef` 那次 Run、它的指针意图，和重新入队检查要的 `TaskState`、`TaskReworkFacts`（选中的 Run、`afterRunIsSelected`、检查链、依据能不能解析、Goal 的期望状态），照 `tasks/requeue-service.ts:395-447` 的 `readRequeueWindow` 读（L1 的表；那段读施工时做成 views 也能用的只读函数，不复制）。
    - 检查：先 `taskRequeueStateProblem(state, facts)`（`task-machine.ts:1135-1193`：选中的 Run、Run 已结束且结果已知、检查链、处置、依据、是否已有 TaskRequeue），再 Goal 必须是 `active`（`:1240`），不管当初是谁暂停的。提交的是人；人对 RUN-24 的“继续”在类别和请求者那几行（TASK-27）总是放行，这里不另算。
    - 回非空就是 `unavailable`，`reasonCode` 是它的拒绝码，`reason` 用它的原文。投影预报的是**状态不变时领域上能不能继续**：列为不可用的，提交会被拒、拒绝码和原因相同；列为可用的，状态没变时领域检查会放行。提交本身还会取来源材料、写存储（CAS），这些可能失败（`tasks/requeue-service.ts:1002`），读的时候不预报（lead 2026-10-14 第四轮第 9 条）。2C-39 验。
    - 这两步先这样定（lead 2026-10-14）。如果 2C-39 的一致性断言找到一种造得出的拒绝、而投影没有预先算出，投影就把那一道守卫也加进来（改规格，不放松测试）。
    - 原因的写法见 §3.10：只有 GOAL-29 会接着做的那一种（扇出的暂停，`pointerFromGoal`，§0.2）才写“恢复目标后自动接着做”；人暂停的、目标又暂停着，写“先恢复目标，再点继续”。
  - 这些都是纯函数（`state/line-status.ts` 的 `deriveLineControls`），只引用 `src/contracts/` 和 `state/` 里已有的纯守卫（`controlSubmissionProblem`、`taskRequeueStateProblem`、`isPausedInterrupted`、`stopRequesterOf`）；state 是纯子模块，同一子模块里互相引用不违反边界（`docs/refactor/module-target.json` 的 state 一节）。
  - 还没接上的能力如实报“还没有”和哪一片接：直接干预（第 7 片）；已归档、已退役（`missing`/`damaged`）的线的问一问（第 7 片）。不报成“没有这个按钮”，也不报成“能用”。
- **L17 消息状态只投影今天有的事实。**【lead 定，待审】表 §3.11，DESIGN §6“消息状态”。
  - 已排队 = 存下了，还没有 `acceptedInputs` 里 `part: 'message'` 的一条；已送达 = 有这一条（Kernel 接受了，带哪次执行、什么时候）。
  - `status` 的已读、已回复，`replyHandler`（回复改由谁接），`archiveWaitDisposition`（等待在归档时取消或转走），未送达，都作为另外的事实照样给。
  - 已生效 / 被拒绝 / 已到期 / 已转交 / 已撤回 / 待放行 / 不发：报 `not_available`，原因“第 7 片加处置字段”。
- **L18 按页读，但只读开着的工作；历史部分只读固定条数，或受读预算管。**【lead 定，待审；lead 2026-10-14 改】
  - 活跃 Session、开着的负责链接，按页读到底：它们是开着的工作，规模不随历史增长。不沿用 25 页、1,000、2,000 这些旧上限，也不报 `capacity`。
  - 历史只读固定条数：做过的任务取 21 条加总数（L1a），不往下翻；最近一次工作执行、最近一次 Query 各取 1 条；归档线只按页读。
  - 没有索引能限在“待办”上的历史部分（线上 Session 写下的锚点和它们接手没有、未送达的回复、做过的任务），每一行受 L1b 的读预算管，超了报“没读全”，不报 0、不报“没有”。
  - 节点详情的“曾参与”“锚点”“执行”分节按页读；悬停数据按目标读（§3.12），规模随这个目标做过的事增长，不随工作区增长。
  - 规模用例（§5.2 2C-25）跨过本片碰得到的旧上限（活跃 Session 超过 1,000 个；一个 Session 超过 2,000 条链接），再加一组“历史很长、待办很少”的数据，记下耗时和每行的读次数。
  - 复用已有的读口时（锚点、决定队列），它们自己的上限照旧报 `incomplete`，本片如实传出（计数报 `partial`，关注标“读不全”），不当作空。
- **L19 取消了的目标，压住它的“需要你决定 / 失败 / 受阻”，不压“待核对”。**【lead 定，待审】
  - 冻结原型 `WORKLINES.md` §3.1：取消目标以后，每个没做完的任务的线都显示“待命 · 目标已取消，记录保留”。决定 42 · 8：取消的目标上的卡变成只读历史。
  - 决定 45、49 · 02：结果未知不能被藏起来，所以“待核对”照样标。
  - 暂停的目标不压任何关注（决定 49 · 02：暂停不遮住待决事项）。
- **L20 秘书线的名字（第 6 片之前）。**【lead 定，待审】决定 49 · 01：秘书线用最近请求的目标，没有目标用短话题。“请求”的归属第 6 片才做。本片先用“这个 Session 最近一次 Query 所属 QueryJob 的 `goalId`”的目标名；没有目标写“秘书 · 未定话题”，名字来源标 `secretary_interim`。第 6 片换成按请求算。目标的悬停卡“负责”一栏的秘书线也用这个口径。
  - “最近一次 Query”：占用者是 QueryRun 就是它；否则 `lastExecutionRef` 是 QueryRun 就是它（都是准的）；否则（最近一次执行是 Work）按 `s2c-query-run-by-session-generation` 倒序取 1 条，也是准的（L4）。都没有：写“秘书 · 未定话题”；线头是来历为 null 的旧 Session 时，名字带 `complete: false`（最近的 Query 可能是读不到的旧记录，L4）。
- **L21 任务的显示事实，不改 `effectivePhase`。**【lead 定，待审】DESIGN §1.10 L390“读取的修法 提议”。
  - 投影出的阶段是 Workflow 用的正式事实，不改。另给 `neverRanTerminal`：处置是取消或替代、而且从没有过执行的任务，给 `cancelled` / `superseded`，界面显示“已取消 / 已替代”，不再像“待执行”。
  - 运行过、后来被取消或替代的任务照 E3 5.10-3：保留投影的阶段和原因，处置写在旁边。
  - “中断，待核对”后面的文字按 `next` 定（表 §3.9）。
- **L22 归档线的第三种标签。**【lead 定，待审】DESIGN 只定了“已归档 · 已做完”“已归档 · 已退役”两个标签。其余已归档的线（人归档时放下或交出了任务、参谋书记秘书的线、换手的前任）只写“已归档”，不另起新词。换手的前任另写“已交给 <线>”（按 L4 的索引找接任者）。
- **L23 “正式检查中”是线自己的一个词；“等正式检查”是待命的原因。**【lead 定，待审】
  - 决定 49 · 02“正式检查中如实显示”，冻结原型把它当一个词；MODEL O32 的枚举里漏了它，本片补上（`checking`）。
  - 冻结原型还有“等正式检查”（Run 做完、检查还没开）。DESIGN 的表里没有这个词，本片把它当“待命”的原因，不加新词。
  - Goal 门的检查：只落在负责这个门任务的线上；没有就不落到任何线，只在目标栏显示。
  - **门检查怎么给（lead 2026-10-14 第四轮第 4 条）。** 单条线详情（`lines/read`）多一个小列表 `gateChecks`：
    - 哪些门：这条线**现在**有开着的 `responsible` 链接的每个门任务（链上任一 Session 有就算；交接没做完时两个 Session 都开着，去重算一次，同 E1）。规则和 2B 一样：2B 的 `ownerSessionRefs` 是门任务上有开着的负责关系的每个 Session，一条线的链里有一个在其中，这一轮就显示在这条线上；一个都没有，不显示在任何线上（2B 规格 L12“检查的横条”）。
    - 读法：按门任务走已有的 `VerificationRoundByTask` 索引（`VERIFICATION_ROUND_BY_TASK_LOOKUP`，`persistence/evidence-record-codecs.ts:658`、`:676-677`；门只有一条轮次链，有上限）。按主体执行找（`VerificationRoundBySubject`）找不到门的轮次：那个索引要任务和执行两个都对上，门的主体执行是产出任务的。
    - 每一轮给：轮次引用和版本、`since` 的时刻（`eventAt(since)`）、状态、链上第几轮，和**另记的**产出执行引用（`producerRunRef`，轮次的主体执行，常在别的线上）。按 `since` 排，没有 `since` 的旧轮次排在最前、按 refKey。
    - `executions` 分节里不放门检查（L12）。
- **L24 “启动中”算工作中，“待核对”算待命。**【lead 定，待审】第一稿的 U2。
  - 冻结原型给了定义：工作中 = 这条线有一次执行、检查、问答或一轮对话**正跨着现在**（`WORKLINES.md` §1 第 4 条）；DESIGN §1.5“计数”同义。
  - “启动中”的执行已经派出、占着 Session，正跨着现在，所以算工作中。它自己的词仍是“启动中”，不冒充“工作中”（协作主图 §0.6）。
  - “待核对”的执行已经结束（`status: 'ended'`，结果未知），不跨着现在，所以算待命。它的词和关注都写“待核对”，不会被藏起来。
  - 副本也一样：副本的 QueryRun 在 `claimed`、`prepared`、`entering`、`entered` 时，被问的那条线算工作中；`unknown` 时不算。

### 0.4 和别的工作的接缝

- **2A（先合入）。** 关注要读全决定队列（今天 5,000 条就整个拒绝）；归档线分页和“做过的任务”“最近一次工作执行”要 2A 的“按顺序查找”。合入顺序：接线包 2 → K 片 B → K 片 A → 2A → 2C（lead 审时按 2026-10-14 的实际进度改）。2A 已把 `lookupOrdered` 放在单独的 `RecordOrderedLookupPort` 上（2A 规格 §2），测试里只实现 `lookup` 的夹具不受影响（L3）。本片照 2A 正在改的那一版用它：等值只能是非空文字；`orderBy` 带 `valueType`，本片用到 `text`（`archivedAt`、`until`）和 `integer`（`claim.generation`、`run.executionState.sessionGeneration`）两种（L4）。2A 已冻结（整数只认安全整数，2A L1），本片照它。
- **接线包 2（已合入，bb924854）。** 它给 `SessionRecord` 加了 `unavailableSince`、给消息加了 `responseSince`（都是提交位置，§0.2），也改了 `sessions/session-record-codecs.ts`；本片在同一个文件登记五个索引，施工时在它之上改。“已退役”的悬停卡给 `retired.since` = `unavailableSince`（提交位置），旧记录没有就不给。
- **2B（可以并行）。** 执行改过的文件、用量、每小时计数、日历、轨道上的横条都在 2B（L15）。本片给轨道提供“有哪些行”（线、分组、排序），2B 给“行上画什么”。2B 规格草稿已接下换桩和翻转 S5-goal-conflict-rework 那一处断言。
  - 本片的测试现在就注入“有”和“没有”两种执行改过的文件端口（L15），不靠生产组合里的桩。所以 2B 规格草稿里“2C 先合入时由 2B 翻转 2C-27 那几处断言”的条件行用不上了；lead 改 2B 草稿时删去（本片不改 2B 草稿）。
  - **一条线怎么对到 2B 的 `sessionRefs`（lead 2026-10-14 第三轮第 9 条）：**
    - 链的上限只有一个：线头加至多 32 个前任，一共至多 33 个 Session（L2），和 2B 的 `sessionRefs` 一样。
    - 一条线的 `sessionRefs` 就是它的链：列表的行给 `chainSessions`（线头在前，§2），详情给 `chain` 里的 `session`，两者相同。前任超过 32 个时，只给读到的 33 个，行上照样有“省略至少 1 个”。
    - 分叉（N3）：每条线用它自己的链。共用的前任出现在两条线的 `sessionRefs` 里，2B 的横条在两行各画一次。
    - 副本（N1）：不在任何线的链里。2B 把副本的查询画在被问的那个 Session（`askedSessionRef`）上；那个 Session 在哪条线的链里，就画在哪一行。被问的是共用的前任时，两行都有。
- **2B 的“已结束的 Query”索引。** 本片不靠它：最近一次 Query 和 `executions` 分节里的 Query 都用本片自己的 `s2c-query-run-by-session-generation`（L4、L12，lead 2026-10-14）。
- **K 片。** K 合入后，满足 KA1 的 Work 线（RUN-19、干净 Turn 的 RUN-23、经人认定的 RUN-22，来历已核清），不论有没有负责关系，都被维护关掉悬空的那一轮、回到可用。“已退役”剩下：Query 线（K 不关 Query 线）；KA1 不满足或关不掉、又落在今天豁免里的 Work 线；来历核不清的 Work 线（§0.1 告知、§0.2）。本片只读健康状态，不用跟着改。K 的 Kernel 终态 `interrupted` 不进平台 Run，本片看不到它。人暂停被打断的线（决定 54）在 K 合入前后都显示“已暂停”；K 合入以后点“继续”，悬空 Turn 被关掉、线回到可用，在原线接着做，T0 自然不再命中。合入顺序已变成接线包 2 → K 片 B → K 片 A → 2A → 2C，所以施工时 K 已在基线里。
- **K3。** 见 L8。
- **第 4 片。** 节点详情的“注记与当前理解”一栏、注记旁的锚点；agent 的“看”接上 `detail`（L14）；`graph/look` 读全工作区 Session 的问题（§0.2 顺带发现）。
- **第 6 片。** 秘书线按请求起名、秘书的“等回复”（它为请求发的“请回答”）、秘书线自动归档。
- **第 7 片。** 直接干预（含已做完的线）、已归档和已退役线的问一问、消息处置字段、转交未送达的回复。到时把本片 L16、L17 报“还没有”的几项改成真实结果。
- **第 8 片。** 模块维护的线按模块分组、模块的负责人；今天模块负责关系一直是空的，本片写“尚无负责关系”。
- **补来历覆盖已归档的 Session（另开的一小块，§0.2 顺带发现）。** 它合入以后，L5 的已归档计数不再是范围，L6 的“旧的已归档 Session 各成一条线”消失；本片代码不用改。
- **E3。** 所有界面：左栏、悬停卡、“顺序已变 · 重新排序”、节点详情的显示、中文文字的落地（本片 §3.9 给出建议用词）。

## 1. 范围

### 1.1 交付

1. RecordStore：计数端口 `RecordCountPort.countLookup`，两个后端（L3）。
2. 八个新索引（L4）：Session 三个、SessionWorkLink 两个、DispatchOutboxEntry 一个、QueryRun 一个、SessionAnomalyAnchor 一个。
3. 纯函数：线的状态、关注、档、归档标签、排序键、控制、任务显示事实（`state/line-status.ts`）；置顶状态函数和记录产出（`state/line-pin-machine.ts`）。
4. 读模型：活跃线列表（含三个计数、关注、分组数据、控制）、归档线分页、单条线和它的分节，线的对话的来源（`views/work-line-reader.ts`，含读预算 `LINE_HISTORY_READ_BUDGET`，L1b）。
5. 悬停数据和节点详情的读（`views/node-detail-reader.ts`）。
6. 置顶的写（`configuration/line-settings-service.ts`）、写事件和它的编解码（`persistence/line-settings-codecs.ts`）、`WorkspaceSnapshot.lineSettings` 和工作区记录的读写认它（L9）。
7. Host 组合：线的对话（`src/composition/work-line-conversation.ts`，L12）。
8. 七个路由、组合根接线、界面路由标签。

### 1.2 不在本片

- 执行改过的文件、用量、每小时计数、日历、补算、按时间读任务状态、轨道横条（2B）。
- 决定队列的读取范围和分页（2A）。
- 直接干预、已归档和已退役线的问一问、消息处置（第 7 片）。
- 秘书按请求起名、秘书的等回复（第 6 片）。
- 注记一栏、agent 的“看”接 `detail`（第 4 片）。
- 模块负责人（第 8 片）。
- 任何写状态、写健康、补来历、归档的动作；任何界面（E3）。
- 修 §0.2 的“顺带发现”。

## 2. 接口

```ts
// src/core/record-store/lookup-ports.ts（新加一个端口；RecordLookupPort 不变）
export type RecordCountRequest = {
  index: string;
  values: readonly LookupValue[];        // 校验同 lookup；有 distinctPath 时少给最后一项；
                                         // 有排序路径的索引：每个值都是非空文字（同 2A 的 lookupOrdered）
  distinctPath?: string;                 // 只能是这个索引的最后一个路径；有排序路径的索引不支持
};
export type RecordCountResult = { count: number; readThrough: CommitCursor | null };
export interface RecordCountPort {
  countLookup(request: RecordCountRequest): Promise<StoreResult<RecordCountResult>>;
}
//   两个后端都实现它；只有 2C 的读取拿 RecordLookupPort & RecordOrderedLookupPort & RecordCountPort。
//   distinctPath 的“不同”：文字、数字、true、false 四类各算各的，数字按数值（1 和 1.0 同一个）；null、缺字段不算（L3）。
//     [true, 1, "1", false, 0] → 5。SQLite 不能直接 COUNT(DISTINCT json_extract(...))。
//   有排序路径的索引只数候选：valueType 'text' 是非空字符串，'integer' 是安全整数范围内的 JSON 整数（同 2A L1）。

// src/core/work-graph/sessions/session-record-codecs.ts（新登记五个，L4 的 1–5）
export const S2C_SESSION_BY_KIND_FROM_LOOKUP = 's2c-session-by-kind-from';
//   Session: ['ref.projectId', 'workspaceId', 'provenance.kind', 'provenance.from.sessionId']
export const S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP = 's2c-session-by-lifecycle-kind';
//   Session: ['ref.projectId', 'workspaceId', 'lifecycle', 'provenance.kind']
export const S2C_SESSION_ARCHIVED_AT_LOOKUP = 's2c-session-archived-at';
//   Session: ['ref.projectId', 'workspaceId', 'lifecycle'], orderBy { path: 'archivedAt', valueType: 'text' }
export const S2C_OPEN_LINKS_BY_SESSION_LOOKUP = 's2c-open-links-by-session';
//   SessionWorkLink: ['ref.projectId', 'ref.sessionId', 'ref.relation', 'until']   // 取 ['…', '…', 'responsible', null]
export const S2C_CLOSED_TASK_LINKS_LOOKUP = 's2c-closed-task-links';
//   SessionWorkLink: ['ref.projectId', 'ref.sessionId', 'ref.relation', 'ref.target.kind'],
//   orderBy { path: 'until', valueType: 'text' }
// src/core/work-graph/tasks/claim-record-codecs.ts（L4 的 6）
export const S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP = 's2c-work-claim-by-session-generation';
//   DispatchOutboxEntry: ['claim.task.projectId', 'claim.workspaceId', 'claim.sessionRef.sessionId'],
//   orderBy { path: 'claim.generation', valueType: 'integer' }
// src/core/work-graph/queries/query-record-codecs.ts（L4 的 7）
export const S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP = 's2c-query-run-by-session-generation';
//   QueryRun: ['ref.projectId', 'ref.workspaceId', 'run.executionState.sessionRef.sessionId'],
//   orderBy { path: 'run.executionState.sessionGeneration', valueType: 'integer' }
//   // 和 claim.generation 同一个计数，准的；挑最近一次 Query（L20），也是 executions 分节里 Query 的那一路（L12）；
//   // 没有 executionState 的 QueryRun 不是候选（L4）
// src/core/work-graph/tasks/session-anomaly-codecs.ts（L4 的 8）
export const S2C_ANOMALY_BY_SESSION_LOOKUP = 's2c-anomaly-by-session';
//   SessionAnomalyAnchor: ['ref.projectId', 'workspaceId', 'sessionRef.sessionId']
//   第三轮的两个按时间的索引（s2c-query-run-by-session-started、s2c-run-by-session-started）第四轮去掉了（L4、L12）。

// src/contracts/ledger.ts（WorkspaceSnapshot 加一个可选字段）
export type WorkspaceLineSettingsV1 = { schemaVersion: 1; pinned: { sessionRef: SessionRef; pinnedAt: string }[] };
//   WorkspaceSnapshot.lineSettings?: WorkspaceLineSettingsV1   // 没有就读作 { schemaVersion: 1, pinned: [] }，读时不补存

// src/core/work-graph/persistence/record-codecs.ts（改）
//   WORKSPACE_VALUE_KEYS 加 'lineSettings'；workspaceSnapshotValueProblem 接受可选、校验过的 lineSettings；
//   validateWorkspaceSnapshot、decodeWorkspaceSnapshot 原样保留它；新的纯检查 workspaceLineSettingsProblem
//   （schemaVersion 1；pinned 每项恰好 sessionRef、pinnedAt；sessionRef 完整；不重复；不超过 100 项）。

// src/core/work-graph/persistence/line-settings-codecs.ts（新）
export const WORKSPACE_LINE_PINS_CHANGED_EVENT = 'WorkspaceLinePinsChanged';   // schemaVersion 1
export type WorkspaceLinePinsChangedEventV1 = {          // 信封同 WorkspaceNoticeSeenChanged
  eventId: string; eventType: 'WorkspaceLinePinsChanged'; schemaVersion: 1; occurredAt: string;
  identityKey: string; fingerprint: string; projectId: string; workspaceId: string;
  actor: ActorRef; requestId: string;
  payload: { value: WorkspaceSnapshot; proof: null };    // value 用 workspaceSnapshotValueProblem 校验
};
export function encodeWorkspaceLinePinsChangedEvent(event: WorkspaceLinePinsChangedEventV1): EncodedDomainEvent;
export function decodeWorkspaceLinePinsChangedEvent(event: EncodedDomainEvent): DecodeResult<WorkspaceLinePinsChangedEventV1>;
export const LINE_SETTINGS_RECORD_SCHEMAS: RecordBackendSchemas;   // records: []；events: 上面这一个
//   identityKey = 'workspace-line-pins:' + sha256(canonical{ projectId, workspaceId, operator, requestId })
//   fingerprint = sha256(canonical{ projectId, workspaceId, payload: { add, remove }, expected })
//   一次请求一条事件；add 和 remove 一起算（L9）。最后的集合和现在的相同时，照样提交这条事件，不写记录（同 markNoticesSeen）。
//   重放读回的是这条事件里的值（当时写入后的整份工作区），不是现在的工作区。

// src/core/work-graph/views/work-line-reader.ts（L1b）
export const LINE_HISTORY_READ_BUDGET = 100;     // lead 2026-10-15 量定（L1b、§0.2“读预算的实测”、§16）；原暂定 2_000
export function createWorkLineReader(deps: {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort & RecordCountPort;
  /* 其余端口：决定队列、任务图、目标锚点、执行读、职责……施工时按 L1 的表定 */
  undeliveredRepliesFor: (records: GoalRecordTransactionPort & RecordLookupPort) => SessionMailboxPort['readUndeliveredReplies'];
  sessionAnomaliesFor: (records: GoalRecordTransactionPort & RecordLookupPort) => SessionAnomalyPort;
                                                   // L1b：工厂，每一行用自己的计数包装造读口，嵌套的读也被数到
  historyReadBudget?: number;                      // 不给就用 LINE_HISTORY_READ_BUDGET；测试注入小的数
//   计数包装：每页 lookup 1、每页 lookupOrdered 1、readMany 每条记录 1（发出去之前整个请求比剩下的额度，不够整个拒绝）、
//   每次 eventAt 1、每次 countLookup 1；用完以后对这一行再来的读一律拒绝。先后固定：写下的锚点 → 未送达 → 做过的任务（L1b）。
}): WorkLineReadPort;
```

```ts
// src/contracts/work-line.ts（新，纯 DTO；WorkGraph、Host 路由和界面共用；state/ 引用这里、其它 contracts 和 state 里已有的纯守卫）
export type LineOwnStateV1 =
  | 'working' | 'checking' | 'starting' | 'waiting_reply' | 'paused'
  | 'unknown' | 'done' | 'retired' | 'standby';
export type LineAttentionCodeV1 = 'decide' | 'failed' | 'blocked' | 'unknown';
export type LineBucketV1 = 'working' | 'standby' | 'archived';
export type LineArchivedTagV1 = 'done' | 'retired' | 'plain';

export type LineCountV1 =
  | { status: 'exact'; value: number }
  | { status: 'partial'; atLeast: number; atMost?: number; reason: string }   // 局部数，不当总数
  | { status: 'unavailable'; reason: string };                                 // 读不到，不是 0

export type LineSourceRefV1 =
  | { kind: 'record'; pin: VersionPin }                                   // Session、Run、QueryRun、Task、Goal、锚点、消息、控制意图、检查轮次
  | { kind: 'card'; source: DecisionSourceV1; cardKey: string };
export type LineReasonV1 = { code: LineReasonCodeV1; params: Record<string, string | number>; refs: LineSourceRefV1[] };
export type LineReasonCodeV1 =                                            // 中文用词见 §3.9
  | 'running_task' | 'query_turn' | 'starting' | 'checking' | 'waiting_reply'
  | 'paused_by_you' | 'paused_by_goal' | 'paused_interrupted' | 'paused_yielded'
  | 'unknown_run' | 'unknown_query' | 'health_recoverable' | 'occupancy_unexplained'
  | 'done_tasks' | 'done_unproven' | 'retired_turn_open' | 'retired_missing' | 'retired_damaged' | 'retired_unrecorded'
  | 'goal_cancelled' | 'awaiting_check' | 'task_deferred' | 'waiting_dispatch' | 'idle'
  | 'card' | 'run_failed' | 'check_failed' | 'continuation_cancelled'
  | 'round_inconclusive' | 'check_interrupted' | 'round_ambiguous' | 'origin_unresolvable'
  | 'run_outcome_unknown' | 'anomaly_pending' | 'copy_unknown' | 'unknown_call_review'
  | 'archived' | 'handed_to' | 'reactivate_refused_retired';
//   run_failed / check_failed / round_inconclusive 在“自动重新入队之后”带 params { autoCount, cap }（AT2、AT3）。
//   paused_interrupted 带 params { by: 'you' | 'goal', goal: 'active' | 'paused' | 'cancelled' }（T0、T3c，§3.9）。
//   done_unproven = 做过的任务读不全（L1a、L1b）：不是已做完，也不是普通的待命。

export type LineMarkerV1 =
  | { kind: 'stop_pending'; intentRef: ControlIntentRef }
  | { kind: 'archiving'; archiveRequestId: string; waitingForStop: boolean }
  | { kind: 'undelivered'; count: LineCountV1 }
  | { kind: 'handoff_from'; from: SessionRef; fromLine: SessionRef | null }
  | { kind: 'omitted'; count: LineCountV1 }                               // 前任超过 32 个（链超过 33 个 Session）：partial atLeast 1
  | { kind: 'copy_answering'; copies: SessionRef[] }
  | { kind: 'provenance_unchecked' };

export type LineAttentionV1 = { code: LineAttentionCodeV1; reason: LineReasonV1 };
export type LineHistoryPartV1 = 'written_anchors' | 'undelivered' | 'done_evidence';
export type LineStatusV1 = {                                                // 列表、悬停、详情共用的一份（决定 49 · 02；lead 2026-10-14）
  own: LineOwnStateV1; ownReason: LineReasonV1;
  attention: LineAttentionV1 | null;                                       // 最急的一项
  attentionCounts: Record<LineAttentionCodeV1, number>;                    // attentionComplete 为 false 时是“至少”
  attentionComplete: boolean;                                               // 决定队列、卡的原因码、锚点读不全，或写下的锚点超读预算时为 false
  doneEvidence: 'complete' | 'incomplete' | 'not_applicable';               // L1a：incomplete → 做过的任务读不全，不给已做完
  partialParts: { part: LineHistoryPartV1; reason: string }[];             // L1b：哪几部分没读全（读预算、读口上限）
  markers: LineMarkerV1[];
  bucket: LineBucketV1 | null;                                              // 这一行带问题（读不全）时为 null，先于别的档（B4）
  archivedTag: LineArchivedTagV1 | null;                                    // 没归档时为 null
  readOnly: boolean;
};

export type LineNameV1 = {
  source: 'running_task' | 'open_tasks' | 'recent_task' | 'secretary_interim' | 'duty_only';
  primary: string; extraCount: number;                                     // “首项等 n 项”
  tasks: TaskTriple[]; goalRef: GoalRef | null;
  complete: boolean;                                                        // false：秘书线头是旧 Session，最近的 Query 可能是读不到的旧记录（L4）
};
export type LineTaskBriefV1 = {
  task: TaskTriple; title: string; phase: Phase; disposition: Disposition;
  phaseCause: TaskPhaseCauseV1 | null;                                      // 例如 paused_interrupted（lead 2026-10-14 第四轮第 7 条）
  attention: LineAttentionCodeV1 | null;
};
export type LineControlKindV1 =
  | 'pause' | 'resume' | 'cancel' | 'continue' | 'attest_unknown'
  | 'ask' | 'intervene' | 'archive' | 'reactivate';
export type LineControlV1 = {
  kind: LineControlKindV1;
  availability: 'available' | 'unavailable' | 'not_yet';                  // not_yet = 还没接上，写明哪一片
  reason: string | null;                                                    // 不可用或 not_yet 时必填
  reasonCode: string | null;                                                // 不可用时是守卫的拒绝码（如 busy、invalid），提交时被拒的码与它相同；
                                                                            // not_yet 时是 'not_yet'；可用时为 null（lead 2026-10-14 第四轮第 7 条）
  route: string;                                                            // 提交走哪个已有路由
  target: { runRef?: RunRef; queryRunRef?: QueryRunRef; task?: TaskTriple; sessionRef?: SessionRef };
  pins: VersionPin[];                                                       // 提交时要带的版本
};
export type LineRowV1 = {
  key: SessionRef;                                                          // 线头；本次读的键
  duty: PlatformDutyV1 | 'unknown';                                         // unknown 也包括读角色配置失败（L7）
  name: LineNameV1;
  status: LineStatusV1;
  responsibleNow: LineTaskBriefV1[];                                        // 链上全部开着的负责关系，去重（悬停“列全”）
  doneTasks: { tasks: LineTaskBriefV1[]; omitted: LineCountV1 } | null;     // 已做完的悬停卡：最新 21 条里 terminal 的前 20 项（L1a、T8 补充）
  retired: { conclusion: SessionHealthConclusion | null; history: 'readable' | 'not_readable';
    since: CommitCursor | null } | null;                                   // since = Session 的 unavailableSince（提交位置，不是时刻）；旧记录没有时为 null（§0.2）
  groups: { duty: PlatformDutyV1 | 'unknown'; module: ModuleRef | null; task: TaskTriple | null };
  sessionCount: LineCountV1;                                                // 前任超过 32 个时 partial（atLeast 34）
  chainSessions: SessionRef[];                                              // 线头在前，至多 33 个（L2）；给 2B 的 sessionRefs 用（§0.4）
  pinned: boolean; pinnedBy: SessionRef[];
  lastActivityAt: string; sortKey: string;
  controls: LineControlV1[];
  problem: { code: CoreError | 'source_moving'; reason: string } | null;
};
export type WorkLineListV1 = {
  rows: LineRowV1[];                                                        // 全部活跃线，已排序
  counts: { working: LineCountV1; standby: LineCountV1; archived: LineCountV1 & { asOf: CommitCursor | null } };
  legacyUnchecked: LineCountV1;
  attentionComplete: boolean; attentionProblem: string | null;
  readWindow: { from: CommitCursor; to: CommitCursor };
};
export type ArchivedLinePageV1 = {
  rows: LineRowV1[]; nextCursor: string | null; sourceCursor: CommitCursor;
  withoutArchivedAt: LineCountV1;                                           // 没有归档时间、不在这个列表里的已归档 Session（L5）
};

export type LineChainEntryV1 = {
  session: SessionRef; provenance: SessionProvenanceV1 | null;
  lifecycle: 'active' | 'archived'; health: 'available' | 'recoverable' | 'unavailable';
  healthConclusion: SessionHealthConclusion | null;
  createdAt: string; archivedAt: string | null;
  responsibleOpen: TaskTriple[];                                            // E1：两个 Session 同时“负责中”时各自列出
};
export type WorkLineDetailV1 = {
  kind: 'line';
  row: LineRowV1;
  chain: LineChainEntryV1[]; omitted: LineCountV1;                          // 线头在前
  attentionAll: (LineAttentionV1 & { source: LineSourceRefV1 })[];          // 全部关注，不只最急的
  responsibility: 'has_responsibility' | 'none';                            // none → 界面写“尚无负责关系”
  gateChecks: LineGateCheckV1[];                                            // 这条线现在负责的门任务的检查轮次（L23；第四轮第 4 条）
  sourceCursor: CommitCursor;
};
export type LineGateCheckV1 = {
  gateTask: TaskTriple;
  roundRef: VerificationRoundRef; revision: number;
  sinceAt: string | null;                                                   // eventAt(since) 的时刻；没有 since 的旧轮次为 null
  status: string; chainIndex: number;
  producerRunRef: RunRef;                                                   // 轮次的主体执行（产出执行），常在别的线上，另记
};
export type LineSegmentV1 = {
  session: SessionRef; kernel: { adapterId: string; kernelSessionId: string };
  from: string; to: string | null; history: 'readable' | 'not_readable'; reason: LineReasonV1 | null;
};                                                                          // 第五轮去掉了按来历推的 executionsComplete（L12）
export type LineExecutionItemV1 =                                           // executions 分节的一项（L12），按 generation 排
  | { kind: 'execution'; session: SessionRef; generation: number;           // claim.generation
      runRef: RunRef; revision: number; task: TaskTriple;
      startedAt: string | null;                                             // 显示的时间；没进入过的为 null
      status: 'starting' | 'running' | 'ended'; outcome: RunOutcome | null;
      checks: { roundRef: VerificationRoundRef; revision: number; at: string | null; status: string }[] }  // 普通检查，at = eventAt(since)
  | { kind: 'query'; session: SessionRef; generation: number;               // executionState.sessionGeneration
      queryRunRef: QueryRunRef; revision: number;
      startedAt: string | null;                                             // 显示的时间；记录上有就给，不据此说“进入过”
      phase: QueryExecutionStateV1['phase']; outcome: QueryRunV1['outcome'] };
//   副本的一问一答不在这里，在 copies 分节；Goal 门的检查在 WorkLineDetailV1.gateChecks（L12、L23）。
//   两个分节的游标都带：分节名、线的键、第一页时链上各段 Session 的有序列表（或摘要）；链变了 → source_stale（L12）。
//   conversation 的游标另带（第几段，这一段的状态：'before_header' 这一段的段开头还没给；'header_only' 段开头已给出、
//     原历史还没给；或最后给出的 SessionHistoryEntry.cursor，原样的不透明字符串）（第六轮第 4 条）。
//   executions 的游标另带（第几段，当前段最后给出的 generation，每个走过的段 Work、Query 各自见过的最大 generation）；
//     后面的页对走过的段再核，有更大的 generation 就 source_stale（第六轮第 2 条）。都编码进游标字符串。
export type LineConversationSourceV1 = {                                    // WorkGraph 给 Host 的（L12）：只有段
  segments: LineSegmentV1[];                                                // 链上每个 Session 一段，最早的在前
  sourceCursor: CommitCursor;
};
export type LineParticipationV1 = {
  target: WorkLinkTarget; relation: WorkLinkRelation | 'claimed';           // claimed = 只领取过它的执行
  session: SessionRef; since: string | null; until: string | null;
};
export type LineMessageStateV1 = {
  messageRef: SessionMessageRef; revision: number; createdAt: string;
  delivery: 'queued' | 'delivered';
  deliveredTo: { executionRef: RunRef | QueryRunRef; acceptedAt: string } | null;
  read: boolean; responded: boolean;
  replyHandler: SessionRef | null;
  waitDisposition: 'cancel' | 'transfer' | null;
  undelivered: boolean;
  disposition: { availability: 'not_available'; reason: 'slice_7' };      // 已生效、被拒绝、已到期、已转交、已撤回、待放行、不发
};
export type WorkLineSectionPageV1 =
  | { section: 'participation'; items: LineParticipationV1[]; nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'messages'; items: LineMessageStateV1[]; nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'copies'; items: { copy: SessionRef; messageRef: SessionMessageRef; lifecycle: 'active' | 'archived';
        phase: QueryExecutionStateV1['phase'] | null }[]; nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'executions'; segments: LineSegmentV1[];                    // 第四轮第 1+2 条（L12）
      scope: 'indexed';                                                     // 只列有索引的执行：有派工记录的 Work、有 executionState 的 Query；
                                                                            // 更早的不列，不编 generation（第五轮第 4 条，§10 末尾）
      items: LineExecutionItemV1[]; nextCursor: string | null;
      sourceCursor: CommitCursor };                                         // 这一页几次读（含走过的段的再核）共同的 readThrough（第五轮第 1 条、第六轮第 2 条）

// 悬停数据和节点详情
export type LineBriefV1 = {                                                 // 带全份状态（lead 2026-10-14），悬停、详情和列表逐字段相同
  key: SessionRef; duty: PlatformDutyV1 | 'unknown'; name: LineNameV1;
  status: LineStatusV1;                                                     // 和 LineRowV1.status 同一个类型、同一个函数算出
};
//   逐字段相同指：LineBriefV1 的 key、duty、name、status 四个字段，等于同一时刻 lines/list 里这条线的 LineRowV1 的同名字段；
//   status 比的是它的全部字段（own、ownReason、attention、attentionCounts、attentionComplete、doneEvidence、
//   partialParts、markers、bucket、archivedTag、readOnly）。lines/read 的 row 和 lines/list 的那一行比 LineRowV1 的全部字段。
export type NotYetV1 = { availability: 'not_available'; reason: string };    // 还没接上，写明哪一片（注记一栏等）
export type FromExecutedFilesV1<T> =                                        // 要用“执行改过的文件”的字段（L15）
  | { availability: 'available'; value: T; possiblyIncomplete: boolean; sourceCursor: CommitCursor | null }
  | { availability: 'unavailable'; cause: 'not_recorded' | 'read_failed'; reason: string };
//   not_recorded：GoalExecutedFilesPort 回 ready + availability 'not_available'（2B 之前的桩）；
//   read_failed：端口读失败，reason 带错误码和原文。映射见 L15。
export type ExecutedFileV1 = { runRef: RunRef; path: string; certainty: 'definite' | 'possible' };
export type ExecutedFilesViewV1 = FromExecutedFilesV1<ExecutedFileV1[]>;
export type TaskDisplayFactsV1 = {
  neverRanTerminal: 'cancelled' | 'superseded' | null;
  anomaly: { label: '中断，待核对'; next: LineReasonV1; pending: LineCountV1 } | null;
  attention: LineAttentionV1 | null;
};
export type TaskHoverV1 = {
  task: TaskTriple; planRef: PlanRevisionRef; title: string;
  phase: Phase; phaseCause: TaskPhaseCauseV1 | null; disposition: Disposition;
  display: TaskDisplayFactsV1; module: ModuleRef | null;
  owners: LineBriefV1[];                                                   // 现在负责的线
  participatedLines: LineCountV1;
};
export type GroupHoverV1 = {                                               // 目标、阶段（UI-WORKBENCH §0：分组还显示计数）
  node: { kind: 'goal'; ref: GoalRef } | { kind: 'stage'; planRef: PlanRevisionRef; stageId: string };
  tasks: LineCountV1;                                                       // 组里的任务（从没运行过的取消、替代不算，另计）
  neverRanTerminal: LineCountV1;
  participatedLines: LineCountV1;                                           // 做过这里的任务的线
  workingLines: LineCountV1; pausedLines: LineCountV1;
  owners: LineBriefV1[];                                                    // 目标：秘书线（L20 的口径）；阶段：空（原型：阶段没有单一的线）
};
export type ModuleHoverV1 = {                                              // 每个架构目录里的模块，含子模块
  module: ModuleRef; parent: ModuleRef | null; name: string; paths: string[]; responsibility: string;
  maintainer: { status: 'none' };                                           // 第 8 片之前都是 none
  unfinishedTasks: LineCountV1; workingLines: LineCountV1; lines: LineCountV1;   // 按计划：本模块和它声明的子模块
  changedByLines: FromExecutedFilesV1<LineCountV1>;                         // “n 条工作线改过这里的文件”（L15）
  files: FromExecutedFilesV1<ModuleFileV1[]>;                               // 按路径去重，按路径的 UTF-8 字节序（L15）
};
export type ModuleFileV1 = {
  path: string;
  certainty: 'definite' | 'possible';                                       // 改过它的 Run 里有一个 definite 就是 definite
  runs: RunRef[];                                                           // 改过它的那几次 Run
};
export type GraphHoverReadV1 = {
  goalRef: GoalRef; groups: GroupHoverV1[]; tasks: TaskHoverV1[]; modules: ModuleHoverV1[];
  files: FromExecutedFilesV1<{ path: string; tasks: TaskTriple[] }[]>;     // 文件“涉及它的任务”（L15）
  problems: { node: GraphNodeRefV1; code: CoreError; reason: string }[];
  sourceCursor: CommitCursor;
};
export type NodeDetailRequestV1 = {
  goalRef: GoalRef; node: GraphNodeRefV1;
  section: 'summary' | 'participants' | 'risks' | 'anomalies' | 'executions';
  page: { afterCursor: string | null; limit: number };                     // limit 1..100
};
export type NodeRiskV1 = {
  task: TaskTriple; title: string; phase: Phase;
  shared: { kind: 'module'; module: ModuleRef } | { kind: 'file'; path: string; certainty: 'definite' | 'possible' };
};
export type NodeDetailV1 =
  | { section: 'summary'; node: GraphNodeRefV1; pin: VersionPin;
      task: (TaskHoverV1 & { plannedModules: ModuleRef[]; actualFiles: ExecutedFilesViewV1;
        responsibleNow: LineBriefV1[]; responsibility: 'has_responsibility' | 'none' }) | null;
      group: GroupHoverV1 | null;                                           // 目标、阶段节点
      goal: { anomalyCount: LineCountV1; workingLines: LineCountV1 } | null;
      module: ModuleHoverV1 | null;
      line: LineBriefV1 | null;                                              // Session 节点 → 它所在的线
      notes: { availability: 'not_available'; reason: 'slice_4' };
      fileRisks: FromExecutedFilesV1<{ riskCount: LineCountV1 }>;         // 按共用文件算的风险；来源可能不全时 partial（L15、§3.12）
      sourceCursor: CommitCursor }
  | { section: 'participants'; items: (LineBriefV1 & { via: LineParticipationV1['relation'] })[];
      nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'risks'; items: NodeRiskV1[]; nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'anomalies'; items: (SessionAnomalyViewV1 & { line: LineBriefV1 | null; problem: string | null })[];
      nextCursor: string | null; sourceCursor: CommitCursor }
  | { section: 'executions'; items: { runRef: RunRef; revision: number | null; problem: string | null }[];
      nextCursor: string | null; sourceCursor: CommitCursor };
```

```ts
// src/core/work-graph/model/work-line-contracts.ts（新）
export type SessionDutyReadPort =
  (role: RoleConfigurationRef, ctx: CoreCallContext) => Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;
export type LineSettingsSessionRead = SessionDirectoryPort['readSession'];  // 组合根注入（L9）
export interface WorkLineReadPort {
  listWorkLines(ctx: CoreCallContext, input: { workspace: WorkspaceScope }): Promise<ReadResult<WorkLineListV1>>;
  listArchivedLines(ctx: CoreCallContext, input: { workspace: WorkspaceScope;
    page: { limit: number; cursor?: string } }): Promise<ReadResult<ArchivedLinePageV1>>;             // limit 1..100
  readWorkLine(ctx: CoreCallContext, input: { workspace: WorkspaceScope; key: SessionRef }):
    Promise<ReadResult<WorkLineDetailV1 | { kind: 'branched'; heads: SessionRef[] }>>;                // key 是线里任一 Session
  readWorkLinePage(ctx: CoreCallContext, input: { workspace: WorkspaceScope; key: SessionRef;
    section: WorkLineSectionPageV1['section']; page: { limit: number; cursor?: string } }):
    Promise<ReadResult<WorkLineSectionPageV1>>;
  readWorkLineConversationSource(ctx: CoreCallContext, input: { workspace: WorkspaceScope; key: SessionRef }):
    Promise<ReadResult<LineConversationSourceV1>>;                                                    // 只给段（L12）
}
export interface NodeDetailReadPort {
  readGraphHover(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GraphHoverReadV1>>;
  readNodeDetail(ctx: CoreCallContext, input: NodeDetailRequestV1): Promise<ReadResult<NodeDetailV1>>;
}
export interface WorkLineSettingsPort {
  setLinePins(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; add: SessionRef[]; remove: SessionRef[];
  }>): Promise<WriteResult<WorkspaceSnapshot>>;
}

// src/app/core-http-types.ts（Host 拼好的对话，L12）
export type WorkLineConversationPageV1 = {
  section: 'conversation';
  items: ( { kind: 'segment'; segment: LineSegmentV1 }                   // 每段开头一行；读不到原历史的段只有这一行
         | { kind: 'history'; session: SessionRef; entry: SessionHistoryEntry } )[];   // 只有原历史，一段一段按 Kernel 的位置（L12）
  nextCursor: string | null; sourceCursor: CommitCursor;                  // nextCursor 编码（绑链的部分，第几段，before_header / header_only / 最后给出的 SessionHistoryEntry.cursor）（L12）
};

// src/core/work-graph/state/line-status.ts（新，纯函数，只引用 contracts 和 state 里已有的纯守卫，L16）
export function deriveLineStatus(facts: LineFactsV1): LineStatusV1;
export function deriveLineControls(facts: LineFactsV1, status: LineStatusV1): LineControlV1[];   // §3.10
export function classifyTaskAttention(task: LineTaskFactV1): LineAttentionV1 | null;
export function deriveTaskDisplayFacts(task: LineTaskFactV1): TaskDisplayFactsV1;
export function archivedLineTag(facts: LineFactsV1): LineArchivedTagV1;
export function lineSortKey(input: { pinned: boolean; attention: LineAttentionCodeV1 | null;
  attentionComplete: boolean; lastActivityAt: string; headRefKey: string }): string;
export function cardLineKeys(card: LineCardInputV1, owners: LineOwnerIndexV1): SessionRef[];   // L8 的落法，一条线只算一次（2C-38）
//   纯函数里不读存储、不取时间；输入全部由 views 读好传入（下面的几个类型）。
//   第三轮起（lead 2026-10-14）这些输入类型放在 state/line-status.ts，不放 src/contracts：
//   LinePausedTaskFactsV1 要用 state/task-machine.ts 的 TaskState、TaskReworkFacts，contracts 引不到 state。
//   它们只是纯函数的输入，不出读口；读口给出去的 DTO 仍在 src/contracts/work-line.ts。

// src/core/work-graph/state/line-status.ts（续）：纯函数的输入，字段就是 §3 各表“条件”一列用到的事实
export type LineCardInputV1 = { senderSessionRef: SessionRef | null; forwardedFromSender: SessionRef | null;
  taskPins: TaskTriple[];                             // 目标原因卡取 source.pins 里的任务 pin，其它卡取 objects 里的（L8）
  excluded: boolean };                                // required_task_deferred 等不落到线上的（L8）
export type LineOwnerIndexV1 = { lineOfSession: Map<string, SessionRef[]>;   // Session 的规范键 → 它所在的线（前任可在几条线上）
  linesOfTask: Map<string, SessionRef[]> };          // 任务的规范键 → 现在负责它的线
export type LineTaskArchiveNextV1 = { kind: 'dispatch' } | { kind: 'human_continue' }
  | { kind: 'goal_stopped'; desiredState: 'paused' | 'cancelled' } | { kind: 'rework_blocked'; code: string };
export type LineCardFactV1 = { source: DecisionSourceV1; cardKey: string;
  code: string | null; codeReadable: boolean };                           // code：目标原因码；消息卡为 null；解析不了 codeReadable=false
export type LineTaskFactV1 = {
  task: TaskTriple; title: string; planOrder: number;
  goalDesiredState: GoalDesiredState;
  phase: Phase; phaseCause: TaskPhaseCauseV1 | null; disposition: Disposition;
  everRan: boolean;                                   // 这个任务有没有过 Run
  terminal: boolean;                                  // satisfied，或处置 cancelled/superseded
  lastRequeue: { automatic: boolean; failureClass: ReworkFailureClass; autoCount: number; cap: number } | null;
                                                      // phaseCause 是 requeued 时，盖住选中 Run 的那次重新入队（TaskRow.rework）
  module: ModuleRef | null;
  anomaly: { pending: LineCountV1; next: LineTaskArchiveNextV1 | null } | null;   // null = 没有未接手的锚点
  anomalyComplete: boolean;
  cards: LineCardFactV1[];                            // 落到这个任务上的 waiting_answer 卡
};
export type LineFactsV1 = {
  head: SessionRecord;
  chain: LineChainEntryV1[]; omitted: LineCountV1;    // 线头在前
  duty: PlatformDutyV1 | 'unknown';
  holder:
    | { kind: 'run'; run: LineRunFactsV1 }
    | { kind: 'query'; query: QueryRunSnapshot }
    | { kind: 'maintenance' }
    | null;
  latestWork: (LineRunFactsV1 & { waitRecipient: SessionRef | 'user' | null }) | null;   // 没有占用时才填；generation 最大的那次
  responsibleOpen: LineTaskFactV1[];                  // 链上开着的 task 负责链接，去重
  responsibleOpenOther: ('work' | 'module')[];        // 链上开着的 work、module 负责链接
  doneEvidence: LineDoneEvidenceV1;                   // L1a；不是执行者、或现在负责的任务没全终结时 not_applicable
  pausedTasks: LinePausedTaskFactsV1[];               // L16：每个暂停中断的任务一项，给“继续”和 T0、T3(c) 用
  lineCards: LineCardFactV1[];                        // 发卡 Session 在线上、或转来的原消息发信 Session 在线上的 waiting_answer 卡
  writtenAnchorsPending: LineCountV1;                 // 线上 Session 写下、还没被接手的锚点；超读预算时 partial（L1b）
  copies: { session: SessionRef; phase: QueryExecutionStateV1['phase'] | null }[];   // 活跃副本
  undelivered: { status: 'not_applicable' } | LineCountV1;   // 线头可用时 not_applicable；超读预算时 partial（L1b）
  partialParts: { part: LineHistoryPartV1; reason: string }[];   // L1b：原样进 LineStatusV1
  handoffFrom: SessionRef | null; handoffFromLine: SessionRef | null;
  handedTo: SessionRef | null;                        // 已归档线：它的换手接任者
  provenanceUnchecked: boolean; legacyUncheckedInWorkspace: LineCountV1;
  unknownCallReviewsPending: number;                  // K3 合入前恒为 0
  queueComplete: boolean;
  pinned: boolean;
  lastActivityAt: string;
};
export type LineRunFactsV1 = {                        // 控制和状态要用的一次 Run 的事实（L16）
  run: RunSnapshot;
  pointer: ControlIntentSnapshotV1 | null;            // controlState.intentRef 指的意图
  pointerFromGoal: boolean;                           // GOAL-29 的那一种：意图是目标扇出的暂停（stopRequesterOf = 'goal_fan_out'），
                                                      // 而且就是 Run 核对观察里的 pausedIntentRef
  continuationConsumed: boolean;                      // RD-8：YieldedWait 的接续已被后继 Run 用掉（任务租约的持有者不是它）
  goalDesiredState: GoalDesiredState;                 // 这次 Run 所属目标
};
export type LineClosureModeV1 = 'terminal' | 'transfer' | 'drop' | 'unknown';
export type LineDoneEvidenceV1 =                      // 纯函数照 L1a 的真值表（DE1–DE5）算结论；这里只放读到的事实
  | { status: 'not_applicable' }
  | { status: 'read';
      openTerminal: { task: TaskTriple; title: string }[];   // L1a (a)：线上开着的负责链接、任务现在已终结；不受预算管
      recent: { task: TaskTriple; title: string; closure: LineClosureModeV1; archiveStep: boolean }[];
      // L1a (b)：H 最新的关了的 task 负责链接，最新的在前，至多 21 条；closure 由 eventAt(until) 读出，对不上记 unknown；
      // 预算用完时只有用完以前读到的那几条
      total: LineCountV1;                             // 关了的 task 负责链接总数（countLookup）；预算用完、没数到时 unavailable；A2 只在它不超过 21 时才可能是 DE2（第六轮第 1 条）
      budgetExhausted: boolean };                     // L1b：读预算在 21 条读完之前用完了
export type LinePausedTaskFactsV1 = {                 // L16：现在负责的、原因是 paused_interrupted 的一个任务
  task: TaskTriple;
  afterRun: LineRunFactsV1;                           // 原因里 afterRunRef 那次 Run，和它的指针意图
  state: TaskState;                                   // 重新入队检查要的（task-machine.ts 的 TaskState）
  rework: TaskReworkFacts;                            // 选中的 Run、afterRunIsSelected、检查链、依据、Goal 状态（readRequeueWindow 读）
  pins: VersionPin[];                                 // 提交 tasks/requeue 要带的版本
};

// src/core/work-graph/state/line-pin-machine.ts（新，行 S2C-PIN-01；lead 2026-10-14 改成一次原子变更）
export type LinePinEventV1 = { type: 'line_pins_changed'; add: SessionRef[]; remove: SessionRef[]; at: string };
export type LinePinGuardV1 = { operator: boolean; pinMatches: boolean;
  noDuplicates: boolean;                              // add、remove 各自没有重复
  noOverlap: boolean;                                 // 没有 Session 同时在 add 和 remove 里
  addedInWorkspace: boolean; addedNotCopies: boolean; // 只对新加的查（L9）
  finalUnderCap: boolean };                           // 最后的集合不超过 100 项
export function transitionLinePins(state: WorkspaceSnapshot, event: LinePinEventV1, facts: LinePinGuardV1):
  Transition<WorkspaceSnapshot, LinePinEventV1, { type: 'workspace_line_pins_changed' }>;
export function buildWorkspaceLineSettingsRecord(workspace: WorkspaceSnapshot,
  settings: WorkspaceLineSettingsV1): WorkspaceSnapshot;   // { ...workspace, revision + 1, lineSettings }，唯一产出者
//   最后的集合 = （现在的 − remove）∪ add；已有的保留原 pinnedAt 和位置，新加的 pinnedAt = event.at，按 add 的顺序接在后面。
//   一次请求版本只加 1。最后的集合和现在的完全相同 → 不变（effects 为空），服务照样提交事件、不写记录。
//   拒绝先后：forbidden（不是操作者）→ invalid（重复、同一个 Session 既加又删、新加的不在工作区或是副本）
//   → capacity（最后的集合超过 100）→ revision_conflict（工作区版本对不上）。
```

路由（`src/app/core-routes.ts`）：

| 路由 | 种类 | 绑定 |
| --- | --- | --- |
| `lines/list` | plain | `workLines.listWorkLines` |
| `lines/archived` | plain | `workLines.listArchivedLines` |
| `lines/read` | plain | `workLines.readWorkLine` |
| `lines/page` | plain | `workLineConversation.readWorkLinePage`（`conversation` 分节在 Host 里拼，其余分节转给 `workLines.readWorkLinePage`） |
| `lines/pin` | graph_write | `lineSettings.setLinePins` |
| `graph/hover` | plain | `nodeDetail.readGraphHover` |
| `graph/detail` | plain | `nodeDetail.readNodeDetail` |

已有路由、`tasks/query`、`graph/look` 的输入输出都不变。

## 3. 读时怎么算：状态词、左栏的词和计数的表

记号：
- H = 线头 Session。“线上的 Session”= H 加往回找到的前任（L2）。
- “现在负责的任务”= 线上任一 Session 开着的 `responsible`、目标是 task 的链接指向的任务，去重。平常只有 H 有；交接因故障没做完时（决定 48），或前任只交出了一部分任务时（接线包 1 规格 L16），前任上开着的也算。
- “终结”= `effectivePhase === 'satisfied'` 或处置为 `cancelled`、`superseded`（§0.2，和维护同一口径）。

线自己的状态（§3.2）、标记（§3.3）、关注（§3.4）分开算，一起返回（决定 49 · 02）。

### 3.1 哪些 Session 是线

| 行 | Session 的情况 | 结果 | 依据 |
| --- | --- | --- | --- |
| N1 | 来历 `readonly_copy` | 不是线。挂在 `from` 所在的线上（`from` 是前任时，挂在包含它的每条线上）。不计数 | 决定 25；MODEL I03 |
| N2 | 有 `continuation` 后继（后继活跃或已归档都算） | 不是线头，是后继那条线的前任。不单独计数 | DESIGN §4.9；决定 35 · Q3 |
| N3 | 有两个 `continuation` 后继 | 两个后继各是一条线的线头，它的历史在两条线里都看得到 | AMB-2（决定 42 所列） |
| N4 | 来历 `handoff` | 自己是一条新线的开头；标“接手自 <原线>”（M4）。原线照常是一条线 | 决定 35 · Q3 |
| N5 | 来历为 null（第 1 片之前的旧 Session，还没补来历） | 自成一条线，标“来历未核对”（M7）。读不补来历，也不推来历（L6）。活跃的由维护补上以后按存下的来历读 | AMB-1（决定 42 所列，本片只部分做到，§0.1 告知）；L6 |
| N6 | 其余（来历 `new`、`continuation`，且没有接续后继，不是副本） | 是线头 | DESIGN §4.9 |
| N7 | 还在建（SessionOperation 已受理、还没有 SessionRecord） | 不是线。只有建好的 Session 才算（MODEL R01：完成前不是可派工的 Session） | MODEL O08、R01；L2 |
| N8 | 链超过 32 个前任 | 只往回找 32 个，标“省略至少 1 个”（M5） | DESIGN §4.9 |
| N9 | 来历成环（数据坏了） | **先于 N2 查**（L2）：环上 refKey 最小的那个 Session 出一行，带问题 `invalid`、原因写明环上的 Session，不丢；环上的 Session 不再按 N2 去掉 | MODEL R02；lead 2026-10-14 |

N9 先于 N2、N1 之后：副本照 N1 挂到被问的线上；其余 Session 先查环，再按 N2 去掉非线头。

### 3.2 线自己的状态（活跃的 H，从上往下第一条命中）

“占用者”= `H.occupancy` 指向的那次 Run 或 QueryRun。“最近一次工作执行”= 没有占用时，H 上 generation 最大的那次 Work 领取的 Run：`H.lastExecutionRef` 是 Run 就是它；是 QueryRun，就按 `s2c-work-claim-by-session-generation` 倒序取 1 条（L4）。

| 行 | 条件 | 自己的词（`own`） | 原因（§3.9） | 依据 |
| --- | --- | --- | --- | --- |
| T0 | `H.health === 'unavailable'`、结论 `kernel_turn_open`、没有接续；最近一次工作执行 R 是 RUN-24（`isPausedInterrupted`）；R 的任务是这条线现在负责的，它的原因是 `paused_interrupted`，而且 **`phaseCause.detail.afterRunRef` 就是 R**（`task-machine.ts:182-187`；有 TaskRequeue 覆盖 R 时原因已是 `requeued`，自然不命中） | 已暂停 `paused` | `paused_interrupted`，`params.by`：`pointerFromGoal`（GOAL-29 的那一种）时 `'goal'`，否则 `'you'`；`params.goal` 是 R 所属目标的期望状态 | 决定 54（U1 选 (a)）；E3 5.6-3、5.6-4、5.6-5；P19；GOAL-29；lead 2026-10-14 |
| T1 | `H.health === 'unavailable'`，没有接续 | 已退役 `retired`，只读 | 按结论：`retired_turn_open` / `retired_missing` / `retired_damaged` / 结论为 null 时 `retired_unrecorded` | 决定 38；DESIGN §1.5 L276、§4.8 L926；MODEL O32 |
| T2 | 占用者是 Run，`status === 'ended'`、`outcome === 'outcome_unknown'`；或占用者是 QueryRun，阶段 `unknown`；或 `H.health === 'recoverable'`（防御，今天没有写入方）；或占用种类是 `maintenance`（防御，今天没有写入方） | 待核对 `unknown` | `unknown_run` / `unknown_query` / `health_recoverable` / `occupancy_unexplained` | DESIGN §1.5 L272；协作主图 §0.6“状态待核对”；E3 5.1-7、5.6-10；决定 45 |
| T3 | 下面任一：(a) 占用者是 Run，`status === 'running'`，它的指针意图 `applied`、观察 `paused`（真的停在安全点）；(b) 没有占用，最近一次工作执行 `ended/yielded`、有 continuation、`controlState.desiredState === 'paused'`（P18）；(c) H 可用、**没有占用**，现在负责的任务里有 `paused_interrupted`（P19）；(d) 占用者是 Run，`status === 'starting'`（还没进入），它的指针意图是 `applied` 的暂停（CTL-02 当场生效，RUN-10） | 已暂停 `paused` | (a)、(d) 意图来自 Goal 扇出 → `paused_by_goal`，否则 `paused_by_you`；(b) `paused_yielded`；(c) `paused_interrupted`，`params` 同 T0（按那个任务的 `pausedTasks` 事实，L16） | DESIGN §1.5 L271、§1.6“你暂停了目标”；STATE-MACHINES-SPEC P18、P19、RUN-10、RUN-11；(c) 的“没有占用”lead 2026-10-14；(d) lead 2026-10-14 第三轮第 5 条 |
| T4 | 占用者是 Run，`status === 'starting'`；或 QueryRun 阶段 `claimed`、`prepared`、`entering` | 启动中 `starting` | `starting` | 决定 35 · Q4；DESIGN §1.5 L273；协作主图 §0.6 L222 |
| T5 | 占用者是 Run，`status === 'running'`（不是 T3a）；或 QueryRun 阶段 `entered` | 工作中 `working` | Run → `running_task`；Query → `query_turn` | DESIGN §1.5 L268 |
| T5x | 占用者是 Run、已正常结束（结果已知）却还占着；或 QueryRun 阶段 `settled` 还占着 | 先按 L11 重读这一条线一次；还这样 → 这一行带问题 `source_moving`，不猜 | — | L11（防御，不要求测试） |
| T6 | 没有占用；现在负责的任务里有 `phaseCause.code === 'verification_running'` | 正式检查中 `checking` | `checking` | 决定 49 · 02；DESIGN §1.5 L288、计数；L23 |
| T7 | 没有占用；最近一次工作执行 `ended/yielded`、有 continuation、指针不是 `cancelled` 也不是 `paused` | 等回复 `waiting_reply` | `waiting_reply`（等谁：continuation 那条消息的收信方） | DESIGN §1.5 L269、§4.2；MODEL O27；`session-facts.ts:265-271` |
| T8 | 职责 `executor`；没有占用；不在等（T7 不成立）；线上没有开着的 `work`、`module` 负责链接；现在负责的任务全部终结（没有也算）；**有正证据**：L1a 真值表的 DE1 或 DE2 | 已做完 `done`，不是只读 | `done_tasks`（做过的任务，最多 20 项 + 另有 n 项；“还能接新任务”） | 决定 38；DESIGN §1.5 L275、§4.8 L926；L22；完成证据 lead 2026-10-14 |
| T9 | 其余 | 待命 `standby` | 从上往下第一条（凡是“全……”的条件都要求那个集合**不是空的**）：现在负责的任务不是空的、全在已取消的目标里 → `goal_cancelled`；有任务 `awaiting_verification` → `awaiting_check`；现在负责、没终结的任务不是空的、全是延后的 → `task_deferred`；现在负责、没终结、没延后的任务不是空的、全在暂停的目标里 → `paused_by_goal`；有现在负责、没终结的任务 → `waiting_dispatch`；T8 除了证据都成立、证据读不全（`doneEvidence: 'incomplete'`）→ `done_unproven`；否则 `idle` | DESIGN §1.5 L270、§1.6 L323；原型 WORKLINES §3.1；L19、L23；“不是空的”和 `done_unproven` lead 2026-10-14 |

补充：
- T0 绑在那一次 Run 上（lead 2026-10-14）：只看原因是 `paused_interrupted` 不够，那个原因可能来自别的 Session 上更晚的一次 Run（H 仍负责这个任务，最近一次工作执行仍是 R1，任务的原因却指着别处的 R2）。这时 H 不是 T0，按 T1 是“已退役”。今天的流程造不出这种组合：任务被“继续”以后，Workflow 只会在原 Session 关掉悬空的那一轮接着做，关不掉就建接续（H 不再是线头）。所以它是防御，在 2C-01 用纯函数验。
- T0 还要求 R 的任务是这条线现在负责的：任务已经转给别的 Session 时，“继续”会交给那个 Session（K 规格 L7 的 E16），H 上悬空的那一轮没人关，H 是“已退役”，不是“已暂停，可继续”。
- T1 先于 T2：退役、结果又未知的线，自己的词是“已退役”，“待核对”由关注给出（决定 45：“保持‘已退役’……照今天显示‘待核对’”）。
- T3 先于 T4、T5：停在安全点的 Run 仍占着 Session、`status` 仍是 `running`；还没进入就暂停的 Run（T3d）仍占着 Session、`status` 仍是 `starting`（`run-machine.ts:1701-1739`），不能落到 T4 的“启动中”。T3(c) 要求没有占用：线手上另一个任务正在跑时，按 T4、T5 是启动中、工作中，不因为它负责的另一个任务停着就写“已暂停”（2C-35）。
- T8 里“职责”只认解析出的 `executor`，`unknown` 不给“已做完”（L7）。
- T8 的完成证据只看 L1a 的真值表：DE1、DE2 是已做完；DE4 是普通待命；DE5 是待命、原因 `done_unproven`（“做过的任务读不全”）、`doneEvidence: 'incomplete'`。所以任务一满足，这条线马上是“已做完”（DE1）。转走（换手、接续交接）的任务，后来在别处做完了，也不算这条线“做过”；已转走、自己不再负责的任务也不挡“已做完”。关注不受影响。
- `doneTasks` 的 `omitted`：(a) 的任务有 P 条（开着的负责链接都读了）；21 条（总数不到 21 时就是全部）里 `terminal` 的有 T 条、“未知”的有 K 条、其余（transfer、drop）有 N 条；列出的是 min(P + T, 20) 条，(a) 的在前。总数不超过 21 且 K = 0、预算没用完时报 `exact`（P + T − 列出的）；预算用完时报 `partial { atLeast: P + T − 列出的 }`（不给上界）；其余报 `partial { atLeast: P + T − 列出的, atMost: P + 总数 − 列出的 − N }`。
- T9 的“不是空的”（lead 2026-10-14）：一条一个任务都不负责的空闲线，不会因为“全在已取消的目标里”这类条件对空集合成立而写成“目标已取消”，它是 `idle`（2C-16）。
- T9 的 `paused_by_goal`：线自己的词仍是“待命”（原型：没在跑的线保持自己的词），原因写“你暂停了目标”，免得写成“等待推进”却其实不会动（DESIGN §1.6 L323）。
- “停下（失败）”“停下（受阻）”“等你决定”不是自己的词，是关注（§3.4）。界面要显示成冻结原型那样，由 E3 用“自己的词 + 关注”拼。

### 3.3 小标记（和自己的词一起显示，互不影响）

| 行 | 条件 | 标记 | 依据 |
| --- | --- | --- | --- |
| M1 | 占用者 Run 的指针意图是暂停或取消，状态 `queued`（还没看到停下） | ·停止中 | 决定 35 · Q4；DESIGN §1.5 L274；E3 5.1-7 |
| M2 | `H.archiveRequest` 不为空 | 归档中；请求里记着的那次执行还没停下时“归档中 · 停止中”（`waitingForStop: true`） | DESIGN §4.5；E3 D42-2 |
| M3 | H 不可用，`readUndeliveredReplies` 读到 n 条（n > 0），归档后也给；读不全（读口上限或 L1b 的读预算）报 `partial`，读不到报 `unavailable` | n 条未送达 | DESIGN §1.9、§4.5 |
| M4 | 链最早那个 Session 的来历是 `handoff` | 接手自 <原线>（找不到原线所在的线时给原 Session） | 决定 35 · Q3 |
| M5 | 前任超过 32 个（L2） | 省略至少 1 个 | DESIGN §4.9 |
| M6 | 线上有活跃副本，它的 QueryRun 阶段是 `claimed`、`prepared`、`entering`、`entered`（L24） | 副本回答中；这条线算“工作中”档（§3.5），自己的词不变 | DESIGN §1.5 计数；MODEL O32“副本活动不冒充原 Session 正在工作” |
| M7 | 链里有来历为 null 的 Session；或 H 是“已退役”而 `legacyUnchecked` 大于 0 或读不到 | 来历未核对 | AMB-1；L6 |

### 3.4 需要关注（只给最急的一项，其余计数）

先对“现在负责的任务”逐个分类，再加上线自己的几种来源，取等级最小的一项；同级取任务在计划里靠前的、再取卡键小的。

| 行 | 条件 | 关注 | 原因 | 依据 |
| --- | --- | --- | --- | --- |
| AT1 | 决定队列 `waiting_answer` 里有一张卡落到这条线上（L8 的落法：发卡 Session 在线上；目标原因卡 `source.pins` 里的任务是这条线现在负责的；其它卡 `objects` 里的任务是这条线现在负责的；转来的卡，原消息的发信 Session 在线上），`unknown_outcome` 原因卡除外 | 需要你决定（0） | `card`（带卡的来源和原因码） | 决定 25、37、49 · 02、49 · 11；DESIGN §1.4；L8；`source.pins` lead 2026-10-14 |
| AT2 | 现在负责的任务 `effectivePhase === 'failed'`（`run_failed`、`check_failed`、`continuation_cancelled`，Goal 门 FAIL）；或任务是 `pending/requeued`，盖住它的那次重新入队是自动的（系统或成员发起，算进上限），失败类别是 `run_failed` 或 `check_failed`（这个任务的新 Run 一领取，阶段就变，这一项自然消失） | 失败（1） | 同原因码；自动重新入队的带 `autoCount`、`cap` | 决定 25、49 · 11（lead 答复第 11 项“保留明显的失败提示”）；原型 WORKLINES §3.1“执行失败，系统自动重新入队（1/3），等待推进”；P4、P6、P7、P17、P20 |
| AT3 | 现在负责的任务 `effectivePhase === 'blocked'`，原因是 `round_inconclusive`、`check_interrupted`、`round_ambiguous`、`origin_unresolvable`，或 P14 的 `run_failed`；或 `pending/requeued`、自动重新入队、失败类别 `check_incomplete` | 受阻（2） | 同原因码；自动重新入队的写 `round_inconclusive` 带 `autoCount`、`cap` | 决定 25；P8、P9、P10、P14、P15 |
| AT4 | 下面任一：现在负责的任务原因 `run_outcome_unknown`（P3）；现在负责的任务有没被接手的锚点；线上的 Session 写下、还没被接手的锚点；H 是 T2 的前两种，或 H 退役且占用者结果未知；活跃副本 QueryRun 阶段 `unknown`；`unknown_outcome` 原因卡落到这条线上；K3 合入后，线上 Run 的 `UnknownCallReviewV1` 是 `pending_review` | 待核对（3） | `run_outcome_unknown` / `anomaly_pending`（带 `next`）/ `unknown_run` / `copy_unknown` / `unknown_call_review` | 决定 25、42、45、49 · 02；DESIGN §4.5 L859“排在待核对那一级” |
| AT0 | 其余：`continuation_paused`、`paused_interrupted`（给自己的词“已暂停”）；人发起的、或失败类别是 `interrupted`、`cancelled` 的 `requeued`；`awaiting_*`、`verification_running`、待执行 | 没有 | — | L19；DESIGN §1.5 |

- **取消的目标：** 这个目标的任务不产生 AT1、AT2、AT3；AT4 照样产生（L19）。
- **暂停的目标：** 什么都不压（决定 49 · 02）。
- **答了、待落实的卡** 不在 `waiting_answer` 里，不产生 AT1（决定 42 · 7）。
- **一张卡在一条线上只算一次**，不论它从几种落法落到这条线。
- **读不全：** 决定队列读失败、某张卡的原因码解析不了、某个任务的锚点读不全（锚点读口报 `incomplete`）、线上 Session 写下的锚点超了读预算（L1b）→ `attentionComplete: false`，这一项不算“没有”，排序按 L10 的“读不全”档。

### 3.5 档和计数

从上往下第一条命中（B4 先于 B1–B3，lead 2026-10-14）：

| 行 | 条件 | 档 | 依据 |
| --- | --- | --- | --- |
| B4 | 这一行事实读不全（带问题 `problem`），不论它已归档、在工作还是待命 | 不进任何一档（`bucket: null`） | 规则 5；lead 2026-10-14 |
| B1 | `H.lifecycle === 'archived'` | 已归档 | 决定 30、38 |
| B2 | 活跃；自己的词是工作中、正式检查中或启动中；或有 M6 | 工作中 | DESIGN §1.5 计数；原型 WORKLINES §1 第 4 条；L24 |
| B3 | 其余活跃的线（待核对、已暂停、等回复、已做完、已退役、待命，不论有什么关注） | 待命 | DESIGN §1.5 计数；决定 38；L24 |

- 只是某一部分没读全（`partialParts`、`attentionComplete: false`、`doneEvidence: 'incomplete'`）不算“带问题”，照 B1–B3 分档；带问题指这一行的状态本身算不出来（例如占用者那次 Run 读不到）。

- 三档互斥，按线数，不按 Session、角色配置或在跑的模型（决定 30；UI-WORKBENCH §0 第 11 条）。副本（N1）和接续的前任（N2）都不计。关注不让一条线多算一次（决定 49 · 02）。
- 工作中、待命：从这次读到的全部活跃行里数。有 B4 的行时，这两个数报 `partial`（`atLeast` = 已分好档的条数，原因写明几行没读全），不报成总数（决定 49 · 28）。
- 已归档：L5 的公式，带 `asOf`。只有同一刻才算：同一刻又没有旧 Session 时 `exact`；同一刻、有旧 Session 时 `partial`（唯一的范围）；不是同一刻（`source_moving`）、同一刻算出的数不在 0 到 S 之间（数据对不上）、读失败，都报 `unavailable`。
- 真的一条都没有时是 `exact` 0；读失败从不变成 0（“这个空白不能为 0”）。

### 3.6 已归档的线（H 已归档）

| 行 | 条件 | 标签 | 归档前的词（`own`） | 重新启用 | 依据 |
| --- | --- | --- | --- | --- | --- |
| A1 | `H.health === 'unavailable'` | 已归档 · 已退役；原因同 T1 | `retired` | 不给，原因 `reactivate_refused_retired`（写明退役原因） | 决定 38；SES-14；DESIGN §1.8 |
| A2 | H 可用，职责 `executor`；L1a 真值表 A2 那一列的 DE2：关了的负责链接**一共不超过 21 条、全都读到**、没有“未知”、至少一条 `terminal`，**而且没有一条带 `archiveStep`**。归档的 H 没有开着的 task 负责链接，DE1 不会出现。DE3（有一条带 `archiveStep`）只写“已归档”：DESIGN §4.8 要归档的线按同样的规则算出归档前的词；归档时放下或交出了任务，说明那一刻手上还有没做完的任务。总数超过 21 的永远不是 DE2，按 DE5。这是保守的，从不把放下或交出了没做完任务的归档说成做完；代价是重新启用、做完、再归档的线，和关闭超过 21 条的线，只写“已归档”（已知的错标，§10 末尾；lead 2026-10-14 第五轮第 3 条、第六轮第 1 条） | 已归档 · 已做完；悬停写做过的任务 | `done` | 给（提交时 SES-14 再核实际能力） | 决定 38；DESIGN §1.8、§4.8；证据和 `archiveStep` 一条 lead 2026-10-14 |
| A3 | 其余 | 已归档（L22）；换手的前任另写 `handed_to` | `standby` | 给（同上） | L22 |

- 三行都是 `bucket: 'archived'`、`readOnly: true`（DESIGN §4.8：归档的线按同样的规则算出归档前的词）；这一行带问题时照 B4 是 `bucket: null`。
- 不是 DE2 时照 L1a 真值表 A2 那一列：DE3、DE4 按 A3 显示；DE5 按 A3 显示，`doneEvidence: 'incomplete'`，原因 `done_unproven`（“做过的任务读不全”）。A2 读到了 `terminal`、但关闭总数超过 21、或没读完（预算用完）、或有“未知”，确认不了没有 `archiveStep`，也是 DE5（lead 2026-10-14 第六轮第 1 条）。
- 已归档的线也算关注，来源只有三种：它发出、还在 `waiting_answer` 的卡；转来的卡、原消息由它发出（AT1，决定 42 · 7：发卡的线归档了卡也留着）；它写下、还没被接手的锚点（AT4）。归档的线没有开着的 task 负责关系（§0.2），所以没有 AT2、AT3。
- 只读：已归档的线不能直接干预（决定 33、38）。问一问今天也不能（L16，第 7 片）。

### 3.7 边界情况

| 行 | 情况 | 怎么读 | 依据 |
| --- | --- | --- | --- |
| E1 | 接续已建、前任还没归档（交接没做完，HM02） | 前任不是线（N2），在详情的链里显示它的状态；两条负责关系同时开着时，两个 Session 都在详情里写“负责中”（`LineChainEntryV1.responsibleOpen`）；这条线的“现在负责”把它们去重算一次 | 决定 47、48；E3 D47-2 |
| E2 | 线头已归档、前任还活跃 | 这条线按线头算已归档；前任只在详情里 | B1；N2 |
| E3 | 退役的线正在建接续（操作已受理、记录还没有） | 仍是“已退役”，直到接续 Session 建好（N7） | N7 |
| E4 | 已做完的执行者线又领到新任务 | T4/T5 先命中，变回启动中、工作中 | 决定 38 |
| E5 | 已做完满一天、维护还没来 | 仍是“已做完”（不加定时器） | DESIGN §9.4 风险 12 |
| E6 | 执行者的任务被取消，从没运行过 | 已做完：取消也算终结，开着的负责链接指向已终结的任务就是证据（L1a (a)），不用等维护关掉；维护按终结关掉以后仍是已做完（L1a (b)） | 决定 38；L1a；lead 2026-10-14 |
| E6a | 执行者的任务转给了别的线，后来在那边做完了 | 这条线不算“做过”它（关闭方式是 `transfer`）；没有别的 `terminal` 关闭就是待命 | L1a；lead 2026-10-14 |
| E7 | 执行者的任务被延后 | 待命，原因 `task_deferred`；延后不算终结 | §0.2 终结口径 |
| E8 | 一条线现在负责两个任务，一个失败、一个有待答卡 | 关注是“需要你决定”，计数 decide 1、failed 1 | §3.4 |
| E9 | 退役线手上的任务“已暂停，可继续”，这条线已经归档、写了锚点（你经归档按钮归档的；决定 54 以后维护不归档这种线） | A1 已归档 · 已退役（重新启用不给）；关注 AT4 待核对（它写下、还没被接手的锚点）；任务词“中断，待核对 · 等你点‘继续’”。你点“继续”以后，活由派工规则另挑或新建一个 Session，是另一条线（决定 43；§0.2）；那次 Run 进入时锚点被接手，这条归档的线不再标待核对。归档组合做到一半（锚点已写、还没归档）时 H 仍活跃，带 M2“归档中” | DESIGN §4.5 L861、L883；第 1 片 S1-ANCHOR-02、SV37；§0.1 告知 |
| E10 | 被问的那个 Session 是前任 | 副本挂在包含它的每条线上 | N1 |
| E11 | 线头的职责解析不了（包括读角色配置失败） | 职责 `unknown`，分组“职责未知”；不给“已做完” | L7 |
| E12 | 工作区里一条活跃线都没有 | 工作中、待命都是 `exact` 0 | §3.5 |
| E13 | 一条线的 Run 记录坏了 | 这一行带问题 `unavailable`，其余行照常，计数 `partial` | B4 |
| E14 | 前任只交出了一部分任务，自己还负责别的任务 T2（接线包 1 规格 L16） | 前任仍是 N2，不单独成线；T2 算在后继这条线的“现在负责”里，悬停的 `owners` 指向这条线 | §3 记号 |

### 3.8 线名、分组、排序、置顶

- **线名**（决定 49 · 01、AMB-45；读时算，不存）：
  - 执行者：占用者 Run 的任务（`running_task`）→ 现在负责的任务，按链接 `since` 从早到晚，第一项起名，其余 `extraCount`（`open_tasks`，“首项等 n 项”）→ 最近一次工作执行的任务（`recent_task`）→ 只写职责（`duty_only`）。
  - 秘书：L20。
  - 参谋、书记、审阅者：有现在负责的任务时同执行者；没有时只写职责。
  - 名字里的任务名取计划里的标题；读不到标题时用 taskId，不阻塞。
  - 改名从不改变线的键、节点引用、参与事实或记忆锚点。找成员按图锚点和参与、负责事实，不按名字。
- **分组**（决定 25、DESIGN §4.9）：
  - 职责（默认）：五种职责 + “职责未知”。
  - 模块：线名所用任务的所属模块（任务的 `scope.kind === 'module'`），没有的进“未归模块”。模块维护的线要第 8 片。
  - 任务：线名所用的任务；没有任务的进“没有任务”。
- **排序**：L10。归档线另按归档时间倒序（L5）。
- **置顶**：L9。

### 3.9 原因码的中文（建议用词，E3 落地；冻结原型和 E3 已有固定说法的，用那个）

| 码 | 用词 | 来源 |
| --- | --- | --- |
| `running_task` | 在做 <任务> | 原型 |
| `query_turn` | 一轮对话进行中 | DESIGN §1.5 计数 |
| `starting` | 正在启动，还没开始干活 | DESIGN §1.5 L273 |
| `checking` | 正式检查进行中（第 n 轮） | 原型“正式检查第 1 轮进行中” |
| `waiting_reply` | 等 <收信方> 回复 | 原型 |
| `paused_by_you` / `paused_by_goal` | 你暂停了它 / 你暂停了目标 | DESIGN §1.6 |
| `paused_interrupted` | 按 `by` 和 `goal`（lead 2026-10-14）：`you` + 目标进行中：主机重启时已暂停，可继续；`you` + 目标已暂停：主机重启时已暂停；目标也暂停着，先恢复目标，再点继续；`goal` + 目标已暂停：主机重启时目标已暂停，恢复目标后接着做；`goal` + 目标进行中（已恢复、还没接着做）：主机重启时目标已暂停；目标已恢复，等待接着做；目标已取消（不论 `by`）：主机重启时已暂停；目标已取消 | 原型固定用语“已暂停，可继续”；决定 54；E3 5.6-4；GOAL-29 |
| `paused_yielded` | 在等回复时被暂停 | lead |
| `unknown_run` / `unknown_query` | 执行结果待核对 / 这一轮结果待核对 | 原型固定用语 |
| `health_recoverable` / `occupancy_unexplained` | 健康状态待核对 / 占用来源待核对 | lead（防御） |
| `done_tasks` | 做完了：<任务…>；还能接新任务 | 决定 38 |
| `done_unproven` | 做过的任务读不全，不能确定是不是都做完了 | lead 2026-10-14（L1a、L1b） |
| `retired_turn_open` | 上一轮没有正常结束；原历史可读，可以问一问 | 决定 38；E3 5.6-8。不写“谁都不能让它再跑”：K 片以后这种线多半能回来 |
| `retired_missing` / `retired_damaged` | 找不到它的记录 / 它的记录坏了；原历史读不到 | 决定 42 · 2；E3 5.6-8 |
| `retired_unrecorded` | 退役原因没有记录 | lead |
| `goal_cancelled` | 目标已取消，记录保留 | 原型；DESIGN §1.6 |
| `awaiting_check` | 等正式检查 | 原型 |
| `task_deferred` / `waiting_dispatch` / `idle` | 负责的任务已延后 / <任务> 等待推进 / 没有进行中的工作 | 原型“等待推进”“没有进行中的工作” |
| `card` | 用卡自己的原因，例如“自动返工已达上限（3/3），需要你决定” | 原型固定用语 |
| `run_failed` / `check_failed` / `continuation_cancelled` | 执行失败（<类别>）/ 验收未通过 / 接续被取消；自动重新入队以后：执行失败，系统自动重新入队（n/上限），等待推进 / 验收未通过，系统自动重新入队（n/上限），等待推进 | 原型 WORKLINES §3.1；E3 5.3 |
| `round_inconclusive` / `check_interrupted` / `round_ambiguous` / `origin_unresolvable` | 检查不完整 / 检查被打断 / 检查记录有歧义 / 来源计划读不到；自动重新入队以后：检查不完整，系统自动重新入队（n/上限），等待推进 | 原型；E3 5.3 |
| `run_outcome_unknown` | 执行结果待核对 | 原型 |
| `anomaly_pending` | 中断，待核对 · <next>：`dispatch` 等待派工；`human_continue` 等你点“继续”；`goal_stopped` 目标已暂停 / 目标已取消；`rework_blocked` 不能自动返工（<码>）；null 等待推进 | DESIGN §4.5 L859、L883；E3 D42-2 |
| `copy_unknown` | 问一问的结果待核对 | lead |
| `unknown_call_review` | 结果未知的调用待核对 | K3 |
| `archived` / `handed_to` / `reactivate_refused_retired` | 已归档 / 已交给 <线> / 已退役的线不能重新启用：<原因> | 决定 38；L22 |

### 3.10 线上能用的控制

可用性用和提交时一模一样的检查算（L16，lead 2026-10-14）。下表“按守卫”的意思：列出的这个控制是不是 `available`，由 `controlSubmissionProblem` 和它前面对目标 Run 的几行决定（指针、让出的接续是否已被用掉、恢复要已生效且观察到停下的暂停、恢复要目标 `active`），守卫拒绝就是 `unavailable`，原因用守卫的原文。表里没列的控制都是 `unavailable`，原因写明。

| 情况 | 控制 |
| --- | --- |
| 工作中（Work） | 暂停、取消（按守卫：已有排队的暂停就不能再暂停，已有排队的取消就都不能）；问一问；归档（会先停下，DESIGN §4.5）；直接干预 `not_yet`（第 7 片） |
| 工作中（Query，一轮对话） | 问一问；归档（等这一轮结束，DESIGN §4.5）；暂停、取消 `unavailable`：“Query 不能暂停或取消” |
| 启动中（Work：Run `starting`） | 暂停、取消（按守卫；还没进入的由平台当场生效，D-7）；归档 |
| 启动中（Query：`claimed`、`prepared`、`entering`） | 归档（等这一轮结束）；暂停、取消 `unavailable`：“Query 不能暂停或取消”（lead 2026-10-14） |
| 已暂停（T3a、T3b、T3d） | 恢复（按守卫：目标暂停或取消时 `unavailable`，原因“目标已暂停 / 已取消，先恢复目标”，D-9；T3b 让出的接续已被用掉时也不给；T3d 走 RUN-11，还没进入的恢复当场生效）；取消（按守卫）；问一问；归档 |
| 已暂停（T0、T3c，RUN-24） | 每个暂停中断的任务一项“继续”（`tasks/requeue`，人发起；目标是那个任务和它的 `afterRunRef`，带 `pins`）；暂停、恢复、取消都不给，原因“主机重启时已暂停；点继续”（E3 5.6-5）。每项“继续”按完整的重新入队检查算（L16：`taskRequeueStateProblem` 再加 Goal 必须 `active`），不可用时原因用检查的原文；目标不是 `active` 时，不论谁暂停的，都是 `unavailable`，原因写法：`by: 'goal'`（GOAL-29 会接着做的那一种）且目标暂停 → “恢复目标后自动接着做”；`by: 'you'` 且目标暂停 → “先恢复目标，再点继续”；目标已取消 → “目标已取消，不能继续”（E3 5.6-4） |
| 等回复 | 取消（取消等待）、暂停（按守卫；让出的接续已被用掉时都不给）；问一问；归档（要先选等待怎么办）；直接干预 `not_yet` |
| 正式检查中、待命、已做完 | 问一问；归档；直接干预 `not_yet`（已做完的线第 7 片可以干预，决定 38） |
| 待核对（占用者结果未知） | 认定（`executions/resolve-unknown` / `queries/resolve-unknown`；只有持有 Host 实例租约的 Host 能受理，§0.2）；问一问；归档（确认框写明“这次执行的结果未知，归档会把它认定为已停下”） |
| 已退役（`kernel_turn_open`） | 问一问（今天的派生副本路径要求被问的 Session 活跃）；认定（占用者结果未知时） |
| 已退役（`missing`/`damaged`） | 问一问 `not_yet`（只带平台事实的副本，第 7 片，决定 42 · 2） |
| 已归档 · 已做完、已归档 | 重新启用；问一问 `not_yet`（第 7 片） |
| 已归档 · 已退役 | 重新启用 `unavailable`（`reactivate_refused_retired`）；问一问 `not_yet` |

每个控制带它提交时要带的版本（`pins`）和走哪个已有路由（`route`）。本片不新加控制路由。

### 3.11 消息状态

单条线的 `messages` 分节：收信方是线上任一 Session 的消息（`session-message-by-recipient`，按页读），按 L17 投影。“未送达”= 这条消息在 `readUndeliveredReplies` 里。

### 3.12 悬停数据和节点详情

- **悬停数据**（`graph/hover`，一个目标一次读；规模随这个目标做过的事增长，不随工作区增长）：
  - **任务**：`TaskHoverV1`。`owners` 是现在负责它的线，每条是带全份状态的 `LineBriefV1`，和 `lines/list` 同一个函数、同一个结果（逐字段相同的范围见 §2 `LineBriefV1` 的注释）。`participatedLines` 按 `session-links-by-task`（全部关系、开和关）加领取过它的执行所在的 Session，映射到线（沿 `s2c-session-by-kind-from` 往后找到线头）再去重。
  - `display.neverRanTerminal`：处置 `cancelled`/`superseded`，而且这个任务从没有过 Run（`runsByTaskId` 为空）→ `cancelled`/`superseded`；运行过的照 E3 5.10-3，为 null。
  - **锚点怎么读**（悬停、列表、节点详情同一个办法，结果和已有的 `tasks/archive-state` 路由一致）：用 `listSessionAnomalies` 按目标分页读到底，得到每条锚点和它被没被接手；只对至少有一条未接手锚点的任务调 `readTaskArchiveState`，拿 `label` 和 `next`。不在 views 里自己重算 `claimable`、`reworkRefusal`。锚点读口报 `incomplete` 时，`pending` 和目标的 `anomalyCount` 报 `partial`。
  - **目标、阶段**（`GroupHoverV1`；UI-WORKBENCH §0：分组还显示计数；原型 WORKLINES §3.3）：组里的任务数、从没运行过的取消替代另计；做过这里的任务的线有几条，其中工作中、已暂停的各几条；目标的 `owners` 是秘书线（L20 的口径），阶段的 `owners` 为空。原型的文字“4 条工作线做过这里的任务，2 条在做”“秘书 · 待命，另有 3 条工作线工作中”由 E3 用这些数拼。
  - **模块和子模块**（当前采用的架构目录里的每一个模块，含有 `parent` 的子模块）：名字、路径、一句话职责；`maintainer` 恒为 none（第 8 片）；这个目标里计划在这个模块**或它声明的子模块**、没终结的任务数（按目录的包含关系，不按路径）；负责这些任务的线里在工作中的条数、总条数。原型的“n 条工作线改过这里的文件”是 `changedByLines`，`files` 是改过的文件（按路径去重，每个路径带确定程度和改过它的 Run），都是 `FromExecutedFilesV1`，按 L15 的映射；2B 之前是 `unavailable`（`not_recorded`）。
  - **文件**：悬停卡的名字、路径、所属模块由界面已经读来的架构图数据给；“涉及它的任务”是 `GraphHoverReadV1.files`，按 L15 的映射；2B 之前是 `unavailable`（`not_recorded`）。
- **节点详情**（`graph/detail`）：
  - 任务：计划要改（只到模块，DESIGN §1.10 L388）；实际改过（L15）；现在负责的线；`responsibility: 'none'` 时界面写“尚无负责关系”（决定 49 · 01，不猜）；`participants` 分页（曾参与，含只领取过的 Session，`via` 写明关系）；`anomalies` 分页（谁、在做什么、怎么断的、谁归档的、改过的文件分确定 / 可能 / 改动未知、结果没核对；被接手写“已由 <执行> 接手”）；`executions` 分页。
  - **风险**（`risks` 分页，决定 26；DESIGN §1.10 L389）：同一份计划里、没终结（处置 active、阶段不是 satisfied）的其它任务，和它之间**没有直接的依赖连线**（输入依赖、旧式依赖，两个方向都没有），又共用模块（按计划）或共用文件（按实际改过，L15 的映射；端口没有文件时 `fileRisks` 是 `unavailable`，只列按模块的）。只经别的任务间接连着的（A→B→C 里的 A 和 C）也列：连线表示“要上面任务的某个产出”，不表示等上面整个做完（决定 26），没有直接连线就可能同时改。
  - 目标：`group`（同悬停）；`anomalyCount`（“有 n 条异常锚点”，`LineCountV1`）；`anomalies` 分页；在工作中的线数。
  - 阶段：`group`（同悬停）；`participants` 是做过这个阶段的任务的线。
  - 模块：同悬停数据，`participants` 是负责计划在这里的任务的线。
  - Session 节点：给出它所在的线（`line`），界面转去 `lines/read`。
  - 注记一栏：`not_available`，原因 `slice_4`。
  - 任何一个条目的来源读不到（例如那次 Run 的记录坏了）：条目保留，带 `problem` 和原因，不当作“没有”（决定 49 · 11）。

### 3.13 流程行（只读，除了 LR4）

| 行 | 读什么 / 做什么 | 结果 |
| --- | --- | --- |
| LR1 | `lines/list`：活跃 Session 全集 → 分出副本；查环（N9）；再分出前任、线头（§3.1）→ 按 L1 的表读（历史部分受读预算管，L1b）→ 决定队列一次 → 按目标读任务行和锚点 → 纯函数算状态和控制（§3.2–§3.5、§3.10）→ 排序（L10）→ 数活跃两档；按 L5 数已归档，比一下是不是同一刻（L11） | `WorkLineListV1` |
| LR2 | `lines/archived`：按归档时间倒序分页 → 去掉副本；查环；去掉不是线头的 → 每个线头往回找链 → 链上每个 Session 写下的锚点（`s2c-anomaly-by-session`，受读预算管）→ 决定队列一次（它发出或转来的卡）→ 换手接任者（`s2c-session-by-kind-from`，`handoff`）→ 退役的读未送达（受读预算管）→ 执行者读关了的 task 链接（21 条、总数、21 次 `eventAt`，L1a）→ 每行算标签和归档前的词（§3.6）→ 第一页比一下没有归档时间的（L5） | `ArchivedLinePageV1` |
| LR3 | `lines/read`：键可以是线里任一 Session → 沿接续往后找到线头（两个线头 → `branched`）→ 链 → 和 LR1 同一个函数算这一行 → 全部关注 → 这条线现在负责的门任务按 `VerificationRoundByTask` 读检查轮次（`gateChecks`，L23） | `WorkLineDetailV1` |
| LR4 | `lines/pin`：读工作区、经注入的读核新加的 Session → 按最后的集合 `transitionLinePins`（一次请求一个事件，L9）→ 提交记录和 `WorkspaceLinePinsChanged` 事件；集合没变时只提交事件 | 新的 `WorkspaceSnapshot` |
| LR5 | `graph/hover`：目标的任务行 + 锚点（§3.12）+ 执行改过的文件（调一次端口，L15 映射）+ 活跃线的负责关系映射 + 做过这里的线 + 架构目录 | `GraphHoverReadV1` |
| LR6 | `graph/detail`：按节点和分节走索引，分页 | `NodeDetailV1` |
| LR7 | `lines/page` 的 `conversation`：Host 读 `readWorkLineConversationSource`（只有段），一段一段经 AgentRuntime 按 Kernel 的位置读原历史，分页；游标绑链（链变了 `source_stale`），另带（第几段，`before_header` / `header_only` / 最后给出的 `SessionHistoryEntry.cursor`）（L12） | `WorkLineConversationPageV1` |
| LR8 | `lines/page` 的 `executions`：先核链（变了 `source_stale`）；对每个走过的段、每个索引倒序取 1 条，有比游标记下的更大的 generation 就 `source_stale`（一页最多 2 × 32 次）；链上一段一段，每段 Work（第 6 个索引）和 Query（第 7 个索引）按 generation 合成一路；一页的几次读 `readThrough` 必须相同，不同就重读这一页，一共最多 4 次，还不同报 `unavailable`/`source_moving`；普通检查放在主体执行那一项里；游标绑链，另带（第几段，当前段最后给出的 generation，走过的段各自见过的最大 generation）（L12） | `WorkLineSectionPageV1`（`executions`） |

## 4. 规则

1. 读不写任何东西：不提交、不补来历、不推来历、不探测健康、不归档、不调用模型。除了 `lines/page` 的对话经 AgentRuntime 只读原历史（L12），不调 AgentRuntime 和 Kernel。唯一的写是置顶（LR4）。
2. 线自己的状态、最急的关注、标记、档，由同一个纯函数一次算出；列表、悬停、详情用同一个结果（决定 49 · 02）。界面只显示，不再推。
3. 暂停不遮住待决事项；退役不遮住待核对；正式检查中如实显示；停止中是独立的标记（决定 49 · 02）。
4. 计数按线：三档互斥；副本、接续前任不单独计；不按 Session、角色配置或在跑的模型数（决定 30）。
5. 读失败如实报：整个读失败报错误码；一行失败这一行带问题、计数报 `partial`；未知不是 0；局部计数不当总数（决定 49 · 28，“这个空白不能为 0”）。所有计数都用 `LineCountV1`。
6. 读有界：开着的工作（活跃 Session、开着的负责链接）读到底；历史只读固定条数（做过的任务 21 条加总数、最近一次执行 1 条），不往下翻；没有索引能限在待办上的历史部分（写下的锚点、未送达、做过的任务）每一行受读预算管，超了报“没读全”（L1、L1a、L1b、L18；lead 2026-10-14）；已归档的只分页和用索引计数；不扫全工作区的 Session，不调用 `readSessionFacts`、`deriveLegacySessionProvenance`。
7. 线名、标签、“已做完”“已退役”、计数都在读的时候算，不存；不存线的编号（DESIGN §4.8、§4.9）。
8. 每个详情条目带真实对象和版本；来源读不到保留条目和原因，不靠标题重搜（决定 49 · 11）。
9. 不从名字猜身份；查不到负责关系就写“尚无负责关系”（决定 49 · 01）。
10. 还没接上的能力报“还没有”和哪一片接，不报成没有，也不报成能用（L15–L17）。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同 2A、K 片 §5：
- 用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败测试，再写刚好通过的实现；
- 不读数据库核对；
- 期望值来自本规格的表或手算例子，不从被测系统读回来；
- 测试名以行号开头；一行里列了几种情况的，每种都要有断言；
- 服务层的例子在内存和 SQLite 两个后端各跑一次；规模用例两个后端都要跨过本片碰得到的旧上限：活跃 Session 超过 1,000 个（`findSessions` 的候选上限）、一个 Session 超过 2,000 条链接（卡片的链接上限），见 2C-25。
- 决定 50：“好的测试是针对业务流程”。所以行为尽量在 LE3、LE4、LE6 的流程里测；LE1 只留**经公开服务真造不出来**的情况（lead 2026-10-14），每行写明造不出来的原因。
- 不加只有改数据库才能触发的测试（AGENTS 第 4 条）。要让某一次读失败，用测试的存储包装在那一次调用上注入失败，不去改存下的记录。
- **旧 Session（来历为 null）从哪来（lead 2026-10-14 第三轮第 8 条）。** 今天的写者造不出来：建 Session 不给来历就写 `new`，明确给 null 会被拒（`sessions/session-directory.ts:782-800`）。所以 2C-14、2C-16、2C-18、2C-21、2C-26 里的旧 Session 由 Codex 写的存储边界兼容夹具造：经存储边界提交合法的历史记录（没有 `provenance`，今天的编解码读得出），断言只经公开读取，不读数据库。同 2A 的 QA-11（2A 规格 §5.2、§7）。

### 5.1 测试入口（用户 2026-10-14 确认）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| LE1 | 少量纯状态函数：`deriveLineStatus`、`classifyTaskAttention`、`cardLineKeys` 里经公开服务真造不出来的情况 | 防御分支（今天没有写入方的状态、只有旧数据才有的状态、流程走不到的组合、今天没有的卡形状） | 事实读得对不对、读得全不全 |
| LE2 | RecordStore 的公开 `countLookup`，两个后端各一份 | 计数和手算一致；不同值的计数（分类型）；null 值、缺字段、复合值；有排序路径的索引只数候选（文字、安全整数）；请求不合法；建在已有行上的新索引；两个后端相同 | 线的业务规则；SQLite 是否真走索引（lead 另查） |
| LE3 | 业务流程：用真实的 WorkGraph 服务造事实（建 Session、领取、Run 结果、控制、负责关系、消息、归档、来历），脚本 Kernel、注入时钟和编号；用公开的 `WorkLineReadPort`、`WorkLineSettingsPort`、`WorkspaceDecisionSettingsPort` 读和写；存储包装可以在指定的那次调用上注入失败或先提交一笔（2C-36） | 线的认定、事实拼装、关注和队列一致、三个计数、线名、分组、排序、控制里 WorkGraph 能受理的那些、消息状态、置顶（含几种错的先后）和请知悉互不丢字段、读预算、读不写 | 主机重启这类只有场景框架造得出的状态；要 Host 实例租约、Workflow 的维护、归档组合或目标扇出暂停的控制和状态；原历史拼接；路由序列化 |
| LE4 | 场景框架：Host 重启、暂停、认定、归档中断、维护、目标暂停的扇出（和 K 片 KE3 同一个框架），经 HostScenario 的真实路由层（`createPlatformCoreRouteBindings`，持有实例租约）读写 | 已退役、结果未知、人暂停或目标暂停被打断（决定 54）、归档中断和异常锚点一路显示的变化；维护归档以后的标签；目标暂停、取消以后各线的词和控制；认定、归档、重新启用、继续经真实路由受理或拒绝；线的对话拼原历史 | 规模 |
| LE5 | 规模：用真实 owner 造一个 5,000 个 Session 的工作区，跨过本片碰得到的旧上限，再加一组历史长、待办少的数据，经公开读口读计数、归档分页、活跃列表 | 已归档计数的公式、分页不重不漏、跨过旧上限、读预算；记下耗时、每行的读次数和共享代价的读次数 | 真实机器上的性能（只记不断言）；要跑维护的设置（放 LE4） |
| LE6 | 公开的 `NodeDetailReadPort`：真实服务造任务、执行、锚点、负责关系；执行改过的文件端口注入（“有”和“没有”两种） | 悬停数据和列表一致、分组和模块的计数、从没运行过的取消/替代、锚点、风险提示、读不到的条目、改过的文件的映射 | 界面怎么画 |
| LE7 | HTTP 路由（`CORE_ROUTE_SPECS` 里的七个），背后是真实的读写，不打桩 | 结果原样传出；故障报错误码不报空；置顶的重放 | 浏览器 |

### 5.2 验收行为

U1 已答（决定 54，选 (a)），2C-23、T0 按它写。K 片 A、B 在 2C 之前合入，所以凡是写了“K 合入前 / 合入后”的行，只测合入后的那一种（lead 审，2026-10-14）。

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| 2C-01 | LE1 | `deriveLineStatus` 经公开服务造不出来的三种：(1) T2 的两个防御分支（`health === 'recoverable'`、占用种类 `maintenance`）→ 待核对，原因各自的码。**造不出的原因：** 今天没有写入方（§0.2）。(2) T1 先于 T2，结论为 null、占用者结果未知 → 已退役（`retired_unrecorded`），关注待核对。**原因：** 写入方把 Session 写成不可用时一定带结论（`session-availability.ts:379`、`:419`、`:721`、`:844`），结论为 null 的退役只在第 1 片之前的旧数据里有。`kernel_turn_open`、`missing`、`damaged` 配结果未知的三种由 2C-22 在场景里造。(3) T0 绑那一次 Run：H 退役、`kernel_turn_open`、最近一次工作执行 R1 是 RUN-24，R1 的任务 H 仍负责，任务原因是 `paused_interrupted` 但 `afterRunRef` 是另一次 Run R2 → 不是 T0，是已退役（T1）；同样的事实把 `afterRunRef` 换成 R1 → T0 已暂停。**原因：** 见 §3.2 补充，今天的流程造不出“H 仍是线头、仍负责、任务却停在别处的 Run 上” | §3.2；手写事实 |
| 2C-02 | LE1 | `classifyTaskAttention`：`round_ambiguous`（P10）、`origin_unresolvable`（P15）→ 受阻。**造不出的原因：** P10、P15 只在检查记录有歧义或来源计划读不到时出现，经公开服务造要先改存下的记录（AGENTS 第 4 条不做）。同级的先后（两个失败的任务、两张待答卡）挪到 2C-12 在流程里验 | §3.4；P10、P15 |
| 2C-03 | LE3 | 排序（从 LE1 挪来，lead 2026-10-14）：一组线，六档各至少一条（需要你决定：一张待答卡；失败：Run 失败；受阻：检查不完整；待核对：Run 结果未知；**读不全**：这条线的 Session 经 WorkGraph 的归档步骤（`recordSessionAnomaly`，夹具直接调 WorkGraph 的端口）写下 3 条锚点，读预算注入成 2，写下的锚点读不全 → `attentionComplete: false`；没有：空闲参谋）；再置顶一条“没有”档的线 → 它排第一；其余按 0…5 档；同一档里两条线最近活动时间不同 → 晚的在前；注入时钟让两条线最近活动时间相同 → 按线头 refKey；一条已知“失败”、写下的锚点又读不全的线 → 排在失败那一档，同时 `attentionComplete: false` | L10；L1b |
| 2C-04 | LE3 | 已做完的边界：(1) 只被取消、从没运行的任务：负责关系还开着 → 已做完（L1a (a)）；经 `closeTerminalResponsibility` 按终结关掉以后 → 仍是已做完（L1a (b)）。(2) 延后的 → 待命 `task_deferred`。(3) 已转走、没终结的任务不挡已做完。(4) **转走、之后在别处做完**：H 把任务 X 转给 G（`transfer`），X 在 G 上满足、G 的负责关系按终结关掉；H 没有别的 `terminal` 关闭 → H 待命，`doneEvidence: 'complete'`、不是已做完（DE4）。(5) **超过 21 条**：H 有 22 条关了的负责链接，最早的 1 条是 `terminal`，最近 21 条都是 `transfer` → 待命，原因 `done_unproven`，`doneEvidence: 'incomplete'`（DE5）；同样的 21 条 `transfer`、总数正好 21 → 待命 `idle`，`doneEvidence: 'complete'`（DE4）；22 条里**最新的**一条是 `terminal` → 已做完（DE2，总数超过 21 不推翻它）。(6) 一条经 `sessions/link` 关掉的负责链接（关闭方式“未知”）、没有 `terminal` → `done_unproven`（DE5）。(7) **读预算**（注入成小的数）：H 还开着一条负责链接、任务已满足，预算在读关了的链接时用完 → 仍是已做完（DE1 不被预算推翻）；没有开着的、最新一条是 `terminal`、预算在读第 2 条时用完 → 已做完（DE2，已经读到的 `terminal` 不被推翻）；最新几条都是 `transfer`、预算在 21 条读完前用完 → `done_unproven`（DE5）。(8) **已归档**（lead 2026-10-14 第六轮第 1 条）：同 (5) 的“22 条、最新的是 `terminal`、21 条里没有带 `archiveStep` 的”，经 `archiveSession` 归档 → **只写“已归档”**、`doneEvidence: 'incomplete'`、原因 `done_unproven`（A2 只在全读到时算，总数超过 21 按 DE5）；对照：只有 21 条、全是 `terminal`，经 `archiveSession` 归档 → 已归档 · 已做完（DE2）；预算在读完 21 条之前用完 → `done_unproven`（DE5），读到的 `terminal` 不够。(9) 开着的模块负责链接挡；在等回复挡。(10) 职责解析不了（RoleSpec 读失败）→ 待命、分组“职责未知”，不是已做完 | §3.2 T8、T9；§3.6 A2；§3.7 E6、E6a、E7、E11；L1a 真值表；L1b；L7 |
| 2C-05 | LE4 | 归档的三种标签（从 LE3 挪来：要 Workflow 的维护和归档组合，lead 2026-10-14）：都经真实路由（`sessions/archive-line`、`sessions/reactivate`、领取和检查、维护的终结关闭、`sessions/archive`），期望按 L1a 真值表 A2 那一列（lead 2026-10-14 第五轮第 3 条）：(1) 已做完的执行者线用假时钟过一天，维护归档 → 已归档 · 已做完（DE2），归档前的词 `done`，重新启用可用。(2) 人经 `sessions/archive-line` 归档一条手上还有没做完任务的线，选“放下”（事件带 `archiveStep`）→ 已归档（DE3），`standby`。(3) **一次归档里放下 X、同时按终结关掉早已做完的 Y**：线负责没做完的 X 和已终结的 Y，归档请求只选 X 放下、不选 Y；归档组合先处置 X（带 `archiveStep`），再关 Y（`terminal`，更新）→ 已归档（DE3），不是已做完。(3′) **22 个任务的变体**（lead 2026-10-14 第六轮第 1 条）：线负责没做完的 X 和 21 个已终结的任务，归档选“放下” X；归档组合先处置 X、再关那 21 条（都是 `terminal`，比 X 的新，X 的 `archiveStep` 被挤出最新 21 条）→ 只写“已归档”，`doneEvidence: 'incomplete'`、原因 `done_unproven`（总数 22 超过 21，DE5），不是已做完。(4) **归档（放下）→ 重新启用 → 做完一个任务、按终结关掉 → 再归档** → 已归档（DE3：那条旧的 `archiveStep` 还在读到的关闭里），这是写明的已知错标（§10 末尾），断言照这个写。(5) 换手的前任 → 已归档 · 已交给 <线>。这几行都只读、`bucket: 'archived'` | §3.6 A2、A3；L22；L1a 真值表 |
| 2C-06 | — | （删去：任务显示事实并入 2C-28、2C-30） | — |
| 2C-07 | LE3 | 置顶的几种错同时出现，经 `setLinePins` 一次请求造出（从 LE1 挪来：这些组合经公开服务造得出，lead 2026-10-14）：Agent 身份调用 + `add` 里有副本 → `forbidden`；操作者 + `add` 里有副本 + 最后的集合超过 100 → `invalid`；最后的集合 101 项 + 工作区版本旧 → `capacity`；只有版本旧 → `revision_conflict`；同一个 Session 既在 `add` 又在 `remove` → `invalid`；`add` 里重复 → `invalid`。被拒的请求都不改工作区（再读版本不变）。没有变化的请求（加已在表里的、删不在表里的）→ 受理，工作区版本不变、`pinnedAt` 不变，同一 requestId 重放得同一个值 | L9 |
| 2C-08 | LE2 | 手写数据集（含路径为 null 的行、缺字段的行、该路径是对象的行、非 ASCII 值）：每组值的计数与手算一致，两个后端相同；`distinctPath` 的不同值按类型算：值依次是 `true`、`1`、`"1"`、`false`、`0` → 5，再加 `1.0`、null、缺字段各一行 → 仍是 5，两个后端相同；同值多行只算一次；有排序路径的索引只数候选：`text` 的只数非空字符串（空字符串、数字的行不算），`integer` 的只数安全整数范围内的 JSON 整数（`1.5`、`"3"`、null 的行不算；存的是不安全的整数 `9007199254740993` 的行也不算，`9007199254740991` 算；同 2A L1、QA-15）；请求不合法（`distinctPath` 不是最后一个路径、值的个数不对、在有排序路径的索引上用 `distinctPath`、有排序路径的索引等值给了 null 或非文字）`invalid`，索引不存在 `unsupported`；关库、用登记了新索引的定义重开，计数包括旧行 | L3；lead 2026-10-14 |
| 2C-09 | LE3 | 线的认定：中断后接续 → 同一条线，线头是新 Session，链两段；换手 → 新线 + 接手自；副本 → 挂在被问的线，不单独成线；一个 Session 两个接续 → 两条线，详情里都有它；33 个前任 → 省略至少 1 个，`sessionCount` 报 `partial`；前任只交出一部分、自己还负责 T2 → T2 在后继这条线的“现在负责”里（E14）；交接因故障没做完 → 两个 Session 在详情里都写负责中，这条线只算一次（E1）；副本和前任不计数 | §3.1；§3.7 E1、E14；决定 25、35 · Q3、48；AMB-2 |
| 2C-10 | LE3 | 执行者一条线走一遍。每一步都比：`lines/read` 的 `row` 和 `lines/list` 的那一行，比 `LineRowV1` 的全部字段（状态以 `lines/read` 为准，lead 2026-10-14 第三轮第 8 条）。这条线还负责着任务的那几步，再比 `graph/hover` 里这个任务的 `owners` 中这条线的 `LineBriefV1` 和列表那一行的 `key`、`duty`、`name`、`status`（`status` 的全部字段）；负责关系按终结关掉以后，这条线不再是任务的 `owners`，这一项不比。步骤：领取 → 启动中（算工作中）→ 工作中 → 排队的暂停 → 工作中 · 停止中 → 停在安全点 → 已暂停（你暂停了它）→ 恢复 → 工作中 → Run 完成 → 等正式检查（待命）→ 检查开始 → 正式检查中 → 满足、负责关系还开着 → 已做完（做过的任务、还能接新任务；证据是 L1a (a)，lead 2026-10-14）→ 按终结关掉负责关系（`closeTerminalResponsibility`，维护做的那一步）→ 仍是已做完（证据换成 L1a (b)，DE2；只比 `lines/read` 和列表）→ 派新任务、领取 → 工作中 | §3.2、§3.3 M1、§3.5、§3.9；决定 38、49 · 02；L1a；L24；比较范围 lead 2026-10-14 |
| 2C-11 | LE3 | 等回复：Run 让出 → 等回复（等谁）；回复到、同任务新 Run 接续 → 工作中；让出后被暂停 → 已暂停（在等回复时被暂停），`continuation_paused` 不产生关注；让出后取消 → 不再等回复，关注失败（接续被取消） | §3.2 T3b、T7；§3.4 AT0；P17、P18 |
| 2C-12 | LE3 | 关注和 2A 的队列一致，用真实的队列卡（不手写卡）：Run 失败 → 待命 + 失败；**自动重新入队以后（任务 `pending/requeued`）→ 仍是失败，原因带 1/3，新 Run 领取以后不再标**；人发起的重新入队 → 没有关注；检查不完整 → 受阻。**目标原因卡按 `source.pins` 落**（lead 2026-10-14）：自动返工到上限的目标原因卡（`auto_rework_cap_reached`；断言这张卡的 `objects` 是空的，任务 pin 只在 `source.pins` 里）→ 负责这个任务的线标需要你决定；自动返工将要进行的卡（`auto_rework_pending`：自动化判定要重新入队或重新检查，`state/goal-machine.ts:980-993`；同样 `objects` 为空）→ 同样落到负责的线；`required_task_deferred`（`source.pins` 里有延后任务）→ 不落到负责它的线；没有任务的目标级原因卡不落到任何线。同一条线一个任务失败、一个有待答卡 → 需要你决定，计数 decide 1、failed 1；**同级先后**（从 2C-02 挪来）：一条线负责的两个任务都失败 → 最急的是计划里靠前的那个；两张待答卡 → 卡键小的那张。成员发给你的请你决定（发信 Session 在线上）→ 需要你决定；执行者经参谋转来的卡 → 参谋线和执行者线都标需要你决定。**一张卡在一条线上只算一次**，用造得出的几种重叠验（lead 2026-10-14 第三轮第 8 条）：成员的卡，发信 Session 在线上、`objects` 里又是这条线负责的任务 → 这条线计数 decide 1；转来的卡，原消息发信 Session 在执行者线上、`objects` 里又是执行者线负责的任务 → 执行者线 decide 1；目标原因卡落到负责任务的线、同一条线另有一张发给你的卡 → 这条线 decide 2（两张卡各算一次）。今天的目标原因卡只带一个任务 pin（带几个的 `required_task_deferred` 不落到线上，`goal-decision-reader.ts:283-307`），“一张卡带几个任务 pin、落到同一条线”放在 2C-38 用纯函数验。答了以后（待落实）→ 不再是；让决定队列那次读失败（存储包装注入）→ 每行 `attentionComplete: false`、排在“读不全”档，不是“没有” | §3.4；L8、L10；决定 42 · 7、49 · 11；原型 WORKLINES §3.1 |
| 2C-13 | LE4 | 目标暂停（从 LE3 挪来：扇出暂停要 Host 的扇出驱动，lead 2026-10-14），经 `goals/control` 和场景里的扇出驱动：在跑的线 → 已暂停（你暂停了目标），它的待答卡仍是需要你决定；空闲、负责着这个目标没做完任务的线 → 待命（你暂停了目标），不写“等待推进”。目标取消：这些线 → 待命（目标已取消，记录保留），失败、受阻不再标；结果未知的那条仍标待核对 | §3.2 T3、T9；§3.4；L19；DESIGN §1.6 L323 |
| 2C-14 | LE3 | 计数，手写数据集 D1（14 个 Session，工作区里只有它们：Work 在跑 A；Run 启动中 B；让出等回复 C；已做完 D（它的任务满足、负责关系按终结关掉）；`kernel_turn_open` 退役没接续 E（维护没跑）；退役 F1（活跃，交接没做完）和它的接续 F2（空闲）；空闲参谋 G 和正在回答的副本 G′；停在安全点 H；归档已做完 I；归档已退役 J；归档副本 K；来历为 null 的空闲 L）：工作中 3（A、B、G）、待命 6（C、D、E、F2 的线、H、L）、已归档（同一刻）：S = 2（I、J；K 是副本不算），F = 1（F1），A = 1（F1 活跃），C = 2；U = 1（L）→ `partial { atLeast: 1, atMost: 2 }`；排序：置顶一条以后它排第一，其余按关注档、最近活动。再让 A 的 Run 那次读失败（存储包装注入）：A 这一行带问题、`bucket: null`，工作中、待命报 `partial`。**B4 先于 B1**：`lines/archived` 读 I 的关了的负责链接那次失败（注入）→ I 这一行带问题、`bucket: null`，不是已归档档。再让存储读失败：整个读报错误码，不返回 0 | §3.5；L5、L10、L24；决定 30；决定 49 · 28；B4 lead 2026-10-14 |
| 2C-15 | LE3 | 副本：空闲参谋线被问 → 自己的词仍是待命，标“副本回答中”，算工作中；答完、副本归档 → 算待命，副本不计数；副本那一轮结果未知 → 这条线关注待核对，算待命 | §3.3 M6；§3.4；DESIGN §1.5 计数；MODEL O32；L24 |
| 2C-16 | LE3 | 线名和分组：在跑的任务起名；两个现在负责的任务 → 首项等 1 项，行里列全两个；做完以后用最近的任务；秘书线用最近 Query 的目标，没有目标“秘书 · 未定话题”；时钟倒退时（第二次 Query 的 `startedAt` 早于第一次），秘书线名仍用第二次的目标（它是 `lastExecutionRef`，准的，L20）；秘书线头是来历为 null 的旧 Session、又读不到 Query 时，“秘书 · 未定话题”带 `complete: false`（L4）；按职责（含职责未知）、模块（含未归模块）、任务分组；详情“现在负责”和“曾参与”分开，没有负责关系 → `responsibility: 'none'`。**空集合**（lead 2026-10-14）：一个任务都不负责的空闲参谋线 → 待命 `idle`，不是 `goal_cancelled`、`task_deferred`、`paused_by_goal`；只负责一个任务、它所在的目标已取消的线 → 待命 `goal_cancelled` | §3.8；§3.2 T9；L20；决定 49 · 01 |
| 2C-17 | LE3 | 控制（WorkGraph 能直接受理的），列为 `available` 的都经 `controls/submit` 真去提交一次、被受理；列为 `unavailable` 的都提交一次、被拒，拒绝码和原因与列出的对得上：工作中（Work）的暂停、取消可用；排队的暂停之后（停止中）再暂停不可用（`busy`）；启动中（Work，Run 还没进入）的暂停、取消可用、当场生效；**还没进入就暂停**（lead 2026-10-14 第三轮第 5 条）：暂停受理以后再读 → 已暂停（T3d，你暂停了它），`status` 仍是 `starting`，控制是恢复、取消，都可用；提交恢复（RUN-11）被受理 → 再读是启动中（T4），控制是暂停、取消；**启动中（Query）**和工作中（Query）的暂停、取消不可用（“Query 不能暂停或取消”）；已暂停（T3a）的恢复、取消可用；**用 WorkGraph 的 `setGoalControl` 把目标设成暂停**（它只写目标；扇出是 Host 的驱动做的，`app/goal-fan-out-driver.ts`，LE3 不跑它）→ 同一个 T3a 的恢复不可用（目标已暂停，D-9）、取消仍可用；恢复目标 → 恢复又可用；**目标取消** → 恢复不可用；已暂停（T3b）的恢复、取消可用；等回复的暂停、取消可用；`not_yet` 的写明是第 7 片。RUN-24 的“继续”和它上面的暂停、恢复、取消挪到 2C-23（LE4） | §3.10；L16；E3 5.2-3；lead 2026-10-14 |
| 2C-18 | LE3 | 单条线详情：链按线头在前、来历原因写全、每个 Session 的 `responsibleOpen`。**`executions` 分节按 generation**（lead 2026-10-14 第四轮第 1+2 条）：线有两段，前任 P 和线头 H。在 P 上依次：执行 E1（`startedAt` 09:10，它的一轮普通检查）、Query Q1（09:30）。在 H 上依次：执行 E2（10:05）、Query Q2（10:30）、Query Q3（注入的时钟倒退，`startedAt` 10:15，比 Q2 早，但领取在 Q2 之后）、执行 E4（领取以后还没进入就被取消，`startedAt` 为 null）。编号让 refKey 和领取先后相反。`limit: 2` 翻到底，期望字面顺序（只看领取先后，不看时钟）：第 1 页 E1（`checks` 里有那一轮）、Q1；第 2 页 E2、Q2；第 3 页 Q3（显示 10:15）、E4（`status: 'ended'`、`startedAt: null`）。第 2 页的游标是（H 那一段，Q2 的 generation），第 3 页从它之后接着读，这就是段内的分页边界；不重不漏；每页 `scope: 'indexed'`。`entering → not_entered` 的 Query 要 Host 的租约，挪到 2C-41（LE4；lead 2026-10-14 第五轮第 5 条）。门检查不在这里（2C-40）。**一页只用一个时刻**（第五轮第 1 条）：用 2A QA-16 那种存储边界的提交替身，在一页读完 Work 索引、还没读 Query 索引时，经真实服务在 H 上领取并做完一次 Work W、再领取一次 Query Q——(一) 只在第 1 次尝试中途提交：这一页是第 2 次尝试的结果，W 和 Q 都在、按 generation 排，没有漏掉 W；(二) 4 次尝试都被打断：这一页 `unavailable`、`source_moving`，一项都不给；(三) 一页读完以后才在 H（当前段）上提交的 W、Q，出现在后面的页里（generation 更大）。**走过的段又有新执行**（第六轮第 2 条，E1 那种前任）：P 还活跃、可用、还负责一个任务（交接没做完或只交出一部分）；第 2 页已经翻到 H 那一段以后，经真实服务在 P 上领取一次 Work → 再用第 2 页的游标读第 3 页 → `source_stale`，一项都不给；从第一页重读，这次执行在 P 那一段里、按 generation 排在 Q1 后面。**链变了**（第五轮第 2 条）：第 1 页以后，H 被接续出一个新线头（链多了一段），再用旧游标读第 2 页 → `source_stale`；从第一页重读正常。**有索引的执行**（第五轮第 4 条）：一条线的旧 Session（来历为 null，由存储边界兼容夹具造）上，有一次有派工记录的执行、一次没有派工记录的旧执行、一次有 `executionState` 的 Query、一次没有的旧 Query → 只列有派工记录的那次和有 `executionState` 的那次，`scope: 'indexed'`（补来历以后再读不变，要跑维护，放在 2C-26）。`messages`：发出 → 已排队，Kernel 接受 → 已送达（带哪次执行），已读、已回复、回复改由谁接、等待已处置照事实，处置一栏 `not_available` | §3.11；L4、L12、L17 |
| 2C-19 | LE3 | 置顶：置顶一条线 → 排第一；它被接续、换了线头 → 仍置顶；两条分叉线共用置顶的前任 → 都置顶；用 `pinnedBy` 取消 → 都取消；不存在的 Session → `invalid`；副本 → `invalid`；第 101 项 → `capacity`。**表满 100 项时一次请求删一个、加一个**（lead 2026-10-14）→ 受理，版本只加 1，留下的 99 项 `pinnedAt` 不变、新加的是这次请求的时间。**重放比的是原回执：** 这次“删一加一”之后再标一次请知悉已看，再用同一 requestId 重放“删一加一” → 回的是当时的值（`lineSettings` 是它写的那一份，`decisionSettings` 是标已看之前的，版本是它当时的），不是现在的工作区。**和请知悉一起：** 先置顶、再标请知悉已看 → 请知悉的写被受理，`lineSettings` 还在；之后再置顶一次，再重放那次标已看 → 回的值里是标已看当时的 `lineSettings`，不含后来的置顶；反过来先标已看、再置顶 → `decisionSettings` 还在 | L9；§0.2 |
| 2C-20 | LE3 | 读不写：`lines/list`、`lines/archived`、`lines/read`、`lines/page`（参与、消息、副本、执行分节）、`graph/hover`、`graph/detail` 各连读两次，中间不做别的：第二次的读窗口终点和第一次相同；脚本模型调用 0 次；Runtime 读原历史 0 次 | 规则 1 |
| 2C-21 | LE4 | 已退役：(1) 参谋回答问题那一轮被 Host 重启打断，留下 `kernel_turn_open`、没有开着的负责关系、没有接续 → 已退役（上一轮没有正常结束；原历史可读，可以问一问），算待命；维护跳过它，K 合入前后都一样（K 不关 Query 线）。(2) `missing`、`damaged` 各一例，没有接续，它退役前在等回复：维护归档 → 已归档 · 已退役，重新启用不给、原因写明，原历史标读不到；之后回复到 → 2 条未送达；工作区有旧 Session 时叠加“来历未核对”。(3) Work 线被 Host 干净中断（RUN-19），**有开着的负责关系、没有开着的负责关系各一例**：维护都关掉没结束的那一轮（K 片 KA1 不看负责关系）→ 回到可用，按 §3.2 读（不再是已退役）；有负责关系的那条关闭失败（在 Kernel 存储边界注入）→ 照今天归档 → 已归档 · 已退役；没有负责关系的那条关闭失败 → 落在今天的豁免里，不归档，仍是已退役。(4) 工作区有一个第 1 片之前就归档的旧 Session（`legacyPending` 一直为真）时，RUN-19 的线：KA1 不关（来历没核清），维护报 `incomplete`、不归档 → 已退役 + 来历未核对（§0.1 告知） | §3.2 T1、§3.3 M3、M7、§3.6、§3.9；决定 38、42 · 2；E3 5.6-8；K 片 KA1；lead 2026-10-14 |
| 2C-22 | LE4 | 结果未知（决定 45）：重启后 Run 结果未知、占着、线头可用 → 待核对（自己）+ 待核对（关注）；退役又结果未知 → 已退役 + 待核对，维护没有归档它；**退役的三种结论各配一次结果未知**（从 2C-01 挪来，lead 2026-10-14）：`kernel_turn_open`；Kernel 存储删掉（`missing`）、弄坏（`damaged`）后重启，进行中的 Run 由核对记成结果未知（`run-reconcile.ts` 的 W-06、W-14）→ 都是已退役（各自的原因）+ 关注待核对；目标上的 `unknown_outcome` 原因卡（`objects` 为空，任务 pin 在 `source.pins` 里）→ 落到负责这个任务的线，关注待核对，不是需要你决定。**人认定以后按健康分开写**（lead 2026-10-14 第四轮第 7 条）：结论是 `kernel_turn_open` 的 → 认定（RUN-22）→ 维护关闭没结束的那一轮（KA1）→ 回到可用，按 §3.2 读（决定 51）；结论是 `missing`、`damaged` 的 → 认定以后不满足 KA1（KA1 只关 `kernel_turn_open`），照今天的逻辑维护按退役归档 → 已归档 · 已退役，重新启用不给（A1），不会回到可用 | §3.2 T1、T2；§3.4；§3.6 A1；L8；决定 45、49 · 02、51；E3 D45-1；K 片 KA1 |
| 2C-23 | LE4 | RUN-24（决定 54），控制都经真实路由提交：(1) 人暂停的执行被重启打断：已暂停（主机重启时已暂停，可继续），维护跑过也不归档；任务“已暂停，可继续”；控制只有继续；暂停、恢复、取消提交被拒（Run 已结束，原因写“点继续”）（从 2C-17 挪来）；点继续（`tasks/requeue`）以后 → 同一条线、原 Session 工作中（K 片关掉悬空的那一轮）。(2) 目标暂停（扇出）时被重启打断：已暂停（主机重启时目标已暂停，恢复目标后接着做），继续 `unavailable`、提交被拒（`busy`）；恢复目标 → 同一条线工作中（GOAL-29）。(3) **人暂停 + 目标暂停**（lead 2026-10-14）：人暂停的那次被重启打断以后，再把目标暂停 → 原因“主机重启时已暂停；目标也暂停着，先恢复目标，再点继续”，继续 `unavailable`、提交 `tasks/requeue` 被拒（`busy`）；恢复目标 → 不会自动接着做（GOAL-29 不选人暂停的），继续变成可用，点继续 → 工作中。(4) **目标取消**：人暂停被打断的线，目标取消 → 继续 `unavailable`（目标已取消，不能继续），提交被拒 | 决定 54；§3.2 T0；§3.9；§3.10；L16；E3 5.6-3、5.6-4、5.6-5；GOAL-29 |
| 2C-24 | LE4 | 归档中断（决定 42）：在跑的线点归档 → 工作中 · 归档中 · 停止中；停下、写锚点、归档 → 这条线在归档列表里，关注待核对（中断，待核对）；任务显示“中断，待核对 · 等待派工”；另一条线领取、带锚点的 Run 进入 → 锚点“已由 <执行> 接手”，两条线都不再因它标待核对 | §3.3、§3.4、§3.6；DESIGN §4.5；E3 D42-2 |
| 2C-25 | LE5 | 规模（lead 2026-10-14 改：跨过本片碰得到的每个旧上限，加长历史）。5,000 个 Session，构成手写，没有旧 Session，维护不跑：**活跃 1,250 个**（1,100 条活跃线、100 个活跃副本（都答完了，QueryRun `settled`）、50 个活跃的接续前任），超过 `findSessions` 的 1,000；已归档 3,750 个（2,750 条已归档的线、500 个已归档的接续前任、500 个已归档副本）。1,100 条活跃线里 100 条各有一次 `starting` 的 Run，其余 1,000 条空闲。**下面四条特别的线都在这 1,000 条空闲线里，不另外加**（lead 2026-10-14 第三轮第 8 条）：X 的线头带 2,100 条链接（2,099 条 `participates`、1 条开着的 task 负责链接），超过卡片的 2,000；R 的线头是 `missing` 退役的，发过 2,500 条消息，其中 2 条是没送达的回复，这 2 条的 refKey 排在最后（每行预算）；W 的线头写下过 30 条锚点，29 条已被接手，1 条没有，它的 refKey 排在最后（每行预算）；Z 负责一个任务 T*，T* 有 3,000 次 Run（造法：反复领取、失败、重新入队），Z 的线头只领取了最后一次（共享代价：`queryTaskGraph` 的规范任务事实读 T* 所在目标的全部 Run，L1b）。**期望：** 已归档计数（同一刻，S = 3,250、F = 550、A = 50）`exact` 2,750；`lines/archived` `limit: 50` 翻到底，2,750 行按归档时间倒序，不重不漏，`withoutArchivedAt` 是 `exact` 0；`lines/list` 1,100 行，工作中 `exact` 100、待命 `exact` 1,000；X 的 `responsibleNow` 1 项、不报 `capacity`。只断言公开的结果（lead 2026-10-14 第四轮第 7 条；`writtenAnchorsPending` 是纯函数的输入，不出读口）：默认读预算下，R 的 `markers` 里 `undelivered` 的 `count` 是 `exact` 2、`partialParts` 为空；W 的 `status.attention.code` 是 `unknown`（待核对）、`attentionCounts.unknown` 是 1、`attentionComplete: true`、`partialParts` 为空。**读预算注入成 10** 再读：R 的 `undelivered` 标记是 `partial { atLeast: 0 }`、`partialParts` 有 `undelivered`；W 的 `attentionComplete: false`、`partialParts` 有 `written_anchors`、`attention` 为 null（没有已知的关注）、排在“读不全”档。两行都不报 0、不报“没有”；Z 那一行不受影响（T* 的 Run 是共享代价，不算进每行的预算），状态和默认预算时相同；其余行不变。两个后端都跑；记下三项耗时、X、R、W、Z 四行各自的读次数（按 L1b 的计数包装数）和共享代价的读次数、耗时（给 L1b 定数），不设断言 | §3.5；L1、L1b、L4、L5、L18 |
| 2C-26 | LE4 | （设置要跑维护，放 LE4，lead 2026-10-14 第三轮第 8 条；旧 Session 由存储边界兼容夹具造，§5 开头）工作区里只有 7 个来历为 null 的旧 Session（4 个活跃、3 个已归档；其中一对是可靠找得到前任的：已归档的 P 和活跃的 C，C 由 P 接续）。**读之前：** `legacyUnchecked` 是 `exact` 7，P、C 各成一条线、都标来历未核对；已归档：S = 3、F = 0、A = 0，C = 3；U = 7 → `partial { atLeast: 0, atMost: 3 }`（lead 2026-10-14：下界取 `max(0, 3 − 7)`，不是 −4）；`lines/archived` 3 行。再读一次结果相同（读没有补来历）。**让维护跑一遍**（它给 4 个活跃的补来历：C 补成接续 P，另外 3 个补成 `new`）以后：`legacyUnchecked` 是 `exact` 3，C 接上 P 成一条线，链两段（P 是前任，不再单独成线）；另外 2 个已归档的旧 Session 仍各成一条线、标来历未核对；已归档：S = 3、F = 1、A = 0，C = 2；U = 3 → `partial { atLeast: 0, atMost: 2 }`；`lines/archived` 2 行。**执行的范围不随来历变**（lead 2026-10-14 第五轮第 4 条）：C 上另有一次没有派工记录的旧执行（同 2C-18 的兼容夹具）和一次有派工记录的执行；维护前后读 C 那条线的 `executions` 分节，都只列有派工记录的那一次，`scope: 'indexed'` | L5、L6；L12；§3.1 N5；§3.3 M7；AMB-1 |
| 2C-27 | LE6 | 任务详情：计划要改的模块；现在负责和曾参与分开（只领取过的 Session 也在曾参与里，`via: 'claimed'`）；风险：同模块、没有直接连线、没终结的任务列出；A→B→C、A 和 C 同模块 → 看 A 时列出 C；和它直接连着的、已满足的、已取消的不列。**改过的文件，三种注入的端口各跑一次**（lead 2026-10-14）：(a) 今天的桩 → `actualFiles`、`fileRisks` 都是 `unavailable`、`cause: 'not_recorded'`，不是空列表；(b) 端口回 `rejected` → `unavailable`、`cause: 'read_failed'`，原因带错误码；(c) 注入回 `available` 的端口，手写文件：这个任务的两次 Run 各改一个文件（`definite`、`possible` 各一），另一个任务 D 的 Run 改了其中一个文件、D 和它没有直接连线、模块不同 → `actualFiles` 只列这个任务的两个文件；风险里多出 D（共用文件）；`fileRisks.value.riskCount` 是 `{ status: 'exact', value: 1 }`（只有 D 共用文件；同模块的照模块那条另列）；再把 `possiblyIncomplete` 设成 true → 原样带上，`riskCount` 报 `{ status: 'partial', atLeast: 1 }` | §3.12；决定 26；DESIGN §1.10 L389；L15 |
| 2C-28 | LE6 | 异常锚点：任务详情的 `anomalies` 列出谁、在做什么、怎么断的、谁归档的、改过的文件（确定 / 可能 / 改动未知各一例）、结果没核对；被接手的写已由哪次执行接手；任务显示“中断，待核对”后面的 `next` 五种（等待派工、等你点“继续”、目标已暂停 / 已取消、不能自动返工、等待推进）各一例，和同一时刻 `tasks/archive-state` 的结果相同；目标详情 `anomalyCount` 与手数一致，分页列出；锚点读口报 `incomplete` 时 `anomalyCount` 报 `partial`、带原因，不是一个数 | DESIGN §4.5；E3 D42-2；§3.9；§3.12 |
| 2C-29 | LE6 | 注记一栏 `not_available`（第 4 片）；让一次执行的 Run 那次读失败（存储包装注入），`executions` 里这一条还在，带 `problem` 和原因 | 决定 49 · 11；DESIGN §1.4 |
| 2C-30 | LE6 | `graph/hover` 一次读回这个目标全部节点：从没运行过的取消、替代任务带 `neverRanTerminal`，运行过又取消的为 null、阶段和原因保留；有锚点的任务带“中断，待核对”和 `next`；`owners` 的每个 `LineBriefV1` 与同一时刻 `lines/list` 那一行的 `key`、`duty`、`name`、`status`（全部字段）相同；目标、阶段的任务数、做过这里的线数、其中工作中和已暂停的数与手算一致，目标的 `owners` 是秘书线；模块和子模块（父模块的数含声明的子模块）的未终结任务数、在工作中的线数与手算一致，维护者 none。**改过的文件**（lead 2026-10-14）：桩 → `changedByLines`、模块的 `files`、`GraphHoverReadV1.files` 都是 `unavailable`（`not_recorded`）；注入回 `available` 的端口（手写：线 L1 的 Run r1 改了 `m/a.ts`（`definite`）、`m/b.ts`（`possible`）；线 L2 的 Run r2 改了 `m/b.ts`（`definite`）、`m/c.ts`（`possible`）；都在模块 M 下）→ M 的 `changedByLines` `exact` 2；M 的 `files` 按路径去重是 3 项，字面是 `m/a.ts`（`definite`，runs [r1]）、`m/b.ts`（`definite`：r2 是确定的，runs [r1, r2]）、`m/c.ts`（`possible`，runs [r2]）（lead 2026-10-14 第三轮第 7 条）；`GraphHoverReadV1.files` 按路径列出改过它的任务，与手算一致。再把 `possiblyIncomplete` 设成 true → M 的 `files` 照样 3 项、`possiblyIncomplete: true`，`changedByLines` 报 `{ status: 'partial', atLeast: 2 }` | §3.12；L15、L21；决定 17、26；UI-WORKBENCH §0 悬停信息卡 |
| 2C-31 | LE7 | 七个路由都在 `CORE_ROUTE_SPECS`，种类和绑定照 §2 的表；经路由读 2C-14 的数据，结果与 LE3 相同；把存储设成读失败，路由报错误码，不返回空列表或 0；`lines/pin` 是 graph_write，同一 requestId 重放得原回执 | §2；规则 5 |
| 2C-32 | LE4 | 退役线手上的任务“已暂停，可继续”，你经 `sessions/archive-line` 归档它（放下任务）：归档组合写锚点 → 这条线在归档列表里，已归档 · 已退役、重新启用不给，关注待核对；任务显示“中断，待核对 · 等你点‘继续’”；你点“继续” → 另一个 Session 领取（另一条线），带锚点的 Run 进入以后，归档的那条线不再标待核对 | §3.7 E9；DESIGN §4.5 L861、L883；决定 43；第 1 片 S1-ANCHOR-02 |
| 2C-33 | LE4 | 线的对话只有原历史（lead 2026-10-14 第四轮第 1+2 条）：一条中断后接续的线，前任 P、线头 H。P 的 Kernel 原历史按位置是 h1、h2、h3；H 的是 h4、h5、h6、h7。注入时钟让 H 上一次 Query 的原历史 h6 的 `recordedAt` 比 h5 早（时钟倒退），它照样按位置排。经路由 `lines/page`（`conversation`）`limit: 3` 翻到底，期望字面顺序：第 1 页 段 P、h1、h2；第 2 页 h3、段 H、h4；第 3 页 h5、h6、h7。第 1 页的游标是（P 那一段，h2 的 `SessionHistoryEntry.cursor`），第 2 页从 h3 接着读，这就是段内的分页边界；时钟倒退不影响先后；不重不漏；每段和逐段读 `sessions/history` 得到的逐条相同。执行、Query、检查不在这一分节（2C-18）。**游标的几种边界**（lead 2026-10-14 第五轮第 2 条）：(1) `limit: 1` 时第 1 页只有段 P，游标是（P 那一段，`header_only`），第 2 页是 h1；(2) 停在一段里、这一段还没读完的那一页，游标带最后给出的那条原历史的 `SessionHistoryEntry.cursor`，原样接着读（`header_only`、`before_header` 的页和读到底、游标为 null 的最后一页除外，见 (1)、(3)、(3′)；lead 2026-10-14 第七轮）（断言下一页的第一条就是逐段读 `sessions/history` 时紧接在它后面的那一条）；(3) 另造一条前任 Kernel 存储 `missing` 的线：那一段只有段开头一行“原历史读不到”，不去读它；`limit: 1` 时第 1 页只有这一行，游标是（下一段，`before_header`），第 2 页是下一段的段开头，第 3 页是那一段的第一条原历史（lead 2026-10-14 第六轮第 4 条）；(3′) 同一条正常的线用 `limit: 4`：第 1 页是 段 P、h1、h2、h3，停在 P 的最后一条上，游标是（H 那一段，`before_header`），第 2 页先给段 H，再给 h4、h5、h6；(4) 第 1 页以后 H 被接续（链多了一段），再用旧游标读 → `source_stale`，从第一页重读正常 | L12；E3 5.6-8 |
| 2C-34 | LE4 | 控制（要 Host 的）：结果未知的线，“认定”经 `executions/resolve-unknown` 受理（场景持有实例租约）；Query 结果未知的经 `queries/resolve-unknown` 受理；工作中、待命、已做完的线“归档”经 `sessions/archive-line` 受理；已归档 · 已做完的“重新启用”受理；已归档 · 已退役的“重新启用”被拒，原因和 `reactivate_refused_retired` 对得上；已退役（`missing`）的问一问是 `not_yet` | §3.10；L16；§0.2 |
| 2C-35 | LE4 | 先后的重叠（lead 2026-10-14）：**T3(c) 要求没有占用。** 任务 X 在 G 上执行，你暂停，Host 重启（RUN-24，G 退役）；经 `sessions/transfer-responsibility` 把 X 的负责关系转给 H；H 领取另一个任务 Y、Y 的 Run 在跑 → H 是工作中（T5），不是已暂停；H 的 `responsibleNow` 里 X 那一项的 `phaseCause.code` 是 `paused_interrupted`、`phaseCause.detail.afterRunRef` 是 G 上那次 Run（`LineTaskBriefV1.phaseCause`，lead 2026-10-14 第四轮第 7 条）。Y 的 Run 结束、H 空闲 → H 是已暂停（T3c，主机重启时已暂停，可继续），继续可用；点继续 → 在 H 上领取 X（K 规格 E16），工作中 | §3.2 T3、T4、T5；§3.10；L16 |
| 2C-36 | LE3 | 已归档计数不是同一刻（lead 2026-10-14）：工作区里只有 P、C 两个 Session，P 来历 `new`、活跃，C 是 P 的接续、活跃，P 的 task 负责关系已交给 C。存储包装在这次 `lines/list` 第一次 `countLookup` 之前，先经 `archiveSession` 把 P 归档（真实服务提交）。期望：`counts.archived` 是 `{ status: 'unavailable' }`，`reason` 以 `source_moving` 开头，不给范围（lead 2026-10-14 第三轮第 2 条）；活跃行是 C 的那一条线。不插这一笔再读一次：`counts.archived` 是 `exact` 0（A = 0、S = 1、F = 1）。再造一组同一刻的读：P 还没归档时读 → `exact` 0（A = 1、S = 0、F = 1）。**计数之间插一笔**（lead 2026-10-14 第四轮第 7 条写明数据）：第二组数据，工作区里只有三个 Session：P（来历 `new`、活跃）、C（P 的接续、活跃）、Z（来历 `new`、活跃、空闲，和 P、C 无关）；P 一直没归档。存储包装在 S 的第二次计数之后、F 的计数之前，经 `archiveSession` 把 Z 归档 → `counts.archived` 是 `unavailable`、`source_moving`。不插这一笔再读：A = 1（P 有活跃的接续 C）、S = 1（Z）、F = 1，C = 1 − (1 − 1) = 1 → `exact` 1。**`withoutArchivedAt` 的两次计数之间插一笔**（第四轮第 6 条）：第三组数据，只有一个已归档、有 `archivedAt` 的 Session Y 和一个活跃、空闲的 Session V。读 `lines/archived` 第一页时，存储包装在“已归档的数”之后、“`s2c-session-archived-at` 的数”之前，经 `archiveSession` 把 V 归档 → `withoutArchivedAt` 是 `unavailable`、`source_moving`（不是 1 − 2 = −1）；不插再读 → `exact` 0 | L5、L11 |
| 2C-37 | LE3 | 最近一次工作执行按 generation（lead 2026-10-14）：同一个 Session 依次领取三次 Work（任务 T1、T2、T3），注入时钟让第一、二次的 `claimedAt` 相同、第三次比前两次早（时钟倒退），注入编号让三次的 refKey 和领取先后相反；三次都结束后这个 Session 再跑一次 Query（`lastExecutionRef` 成了 QueryRun，最近一次工作执行要走 `s2c-work-claim-by-session-generation`）。三个任务都已终结、负责关系都已关掉。期望：最近一次工作执行是 T3 那一次，看得到的地方是线名：`source: 'recent_task'`、`primary` 是 T3 的标题；不论时钟和编号怎么排。夹具要选一个职责解析为执行者、又能跑 Query 的角色；造不出时停下报 lead。**最近一次 Query 走索引**（lead 2026-10-14 第三轮第 8 条）：另一个职责解析为秘书、又能领取 Work 的 Session，先后跑 Query Q1（目标 G1）、Q2（目标 G2），时钟让 Q2 的 `startedAt` 早于 Q1、编号让 refKey 和先后相反；之后它领取一次 Work 并结束（`lastExecutionRef` 成了 Run，最近一次 Query 要走 `s2c-query-run-by-session-generation`）→ 秘书线名用 G2（`sessionGeneration` 最大的 Q2），`complete: true`；同样的角色造不出时停下报 lead | L4；L20；§3.2；§3.8 |
| 2C-38 | LE1 | `cardLineKeys`：一张卡带几个任务 pin、几个都由同一条线负责 → 这条线只出现一次；两个任务由两条线负责 → 两条线各一次；发信 Session 也在其中一条线上 → 那条线仍只一次；`excluded`（延后任务的卡）→ 一条线都不落。**造不出的原因：** 今天不落到线上之外的目标原因卡都只带一个任务 pin，带几个的只有 `required_task_deferred`，而它不落到线上（`goal-decision-reader.ts:283-307`）；这一行守的是以后出现多任务的卡时的规则（lead 2026-10-14 第三轮第 8 条） | L8；§3.4 |
| 2C-39 | LE4 | “继续”按每个暂停中断的任务算，列出的和提交的一致（lead 2026-10-14 第三轮第 6 条）。造法都经真实路由：(1) **人暂停、主机重启**（RUN-24），目标进行中 → 一项“继续”，`available`；经 `tasks/requeue` 提交 → 受理。(2) **另造一条全新的 RUN-24 线**（第 (1) 步继续以后原因已是 `requeued`，不能接着用；lead 2026-10-14 第四轮第 7 条），取消这个任务（处置 `cancelled`，目标仍进行中）→ “继续”`unavailable`，`reasonCode` 是 `invalid`，`reason` 是检查的原文（`task_not_active: …`）；提交 → 被拒，拒绝码等于 `reasonCode`、原因相同。(3) **负责关系转走**：任务 X 在 G 上 RUN-24，经 `sessions/transfer-responsibility` 转给空闲的 H → H 的“继续”一项，目标是 X 和 G 上那次 Run（`afterRunRef`），`available`；提交 → 受理，在 H 上接着做（K 规格 E16）。(4) **一条线两个暂停中断的任务**（在两个目标里，一个经转交得来）→ 两项“继续”，各带自己的任务和 `afterRunRef`；把其中一个目标暂停 → 那一项不可用（先恢复目标），另一项仍可用；两项各提交一次，结果与列出的一致。每一步都断言：状态没变时，列为可用的提交都被受理；列为不可用的提交都被拒，拒绝码等于 `LineControlV1.reasonCode`、原因相同（取材料或存储失败这类提交时才有的失败不在这里比，L16） | L16；§3.10；§3.2 T0、T3c |
| 2C-40 | LE4 | 门检查落在负责门任务的线上（lead 2026-10-14 第四轮第 4 条）：门的产出执行在 Session P 上跑完，门任务开着的负责关系在 Session G 上（P ≠ G，P、G 在两条线上）；门的一轮检查开始 → G 那条线的 `lines/read` 里 `gateChecks` 有这一轮，`producerRunRef` 是 P 上那次 Run；P 那条线的 `gateChecks` 没有它，P 那条线 `executions` 分节里那次执行的 `checks` 也没有它（门的轮次不按主体执行找）；交接没做完、门任务上 G 和 G2 都开着负责关系、两个在同一条线上 → 这条线只列一次；把门任务所有的负责关系关掉、没有新的 → 哪条线的 `gateChecks` 都没有它（同 2B 的“没有负责 Session 就不落到线上”） | L23；L12；2B 规格 L12“检查的横条” |
| 2C-41 | LE4 | `entering → not_entered` 的 Query 在 `executions` 分节里（从 2C-18 挪来，要 Host 的实例租约，`queries/query-execution.ts:1684`；lead 2026-10-14 第五轮第 5 条）：经真实的领取、准备、开始进入，在 `entering` 时让 Host 重启，再由核对把它记成 `not_entered`（不直接写这种终态的记录）→ 这一项照记录的阶段和 `outcome: 'not_entered'` 写，`startedAt` 是 `entering` 时写上的那个时刻（§0.2），不说“进入过”；它按 generation 排在同一段里该在的位置。对照：在 `entering` 之前就收尾的 Query，`startedAt` 为 null | L12；§0.2 |

另由 lead 在验收时核对，不进测试：
- 代码里列表读不调 `readSessionFacts`、`deriveLegacySessionProvenance`，没有按工作区扫全部 Session 的路径，历史只读 L1 表里的固定条数、其余历史部分经每行的计数包装读、受读预算管（L1a、L1b）；嵌套的读口是用这一行的包装造的，不是组合根的现成实例；
- N9 查环在 N2 之前（防御，不写测试，L2）；
- `countLookup`（含 `distinctPath`）和 L4 的八个索引里按顺序的四个（`s2c-session-archived-at`、`s2c-closed-task-links`、`s2c-work-claim-by-session-generation`、`s2c-query-run-by-session-generation`），以及 `s2c-open-links-by-session` 的 SQLite `EXPLAIN QUERY PLAN`；
- 今天的数据里没有已归档却没有 `archivedAt` 的 Session（L5）；
- **冻结前**照 L1b 写的做法，在 2C-25 的数据上量出每行的读次数和共享代价，定 `LINE_HISTORY_READ_BUDGET`（暂定 2,000），数和证据写进 §0.2（这一条是冻结的前提，第五轮第 6 条）；
- 纯函数只引用 `src/contracts/` 和 `state/` 里已有的纯守卫（模块边界检查会报）。

### 5.3 要改断言的旧测试

| 测试 | 怎么改 |
| --- | --- |
| `tests/architecture/state-writes.test.ts` 的受保护类型表（`:132-133`） | `WorkspaceSnapshot` 的字段从 `['decisionSettings']` 改成 `['decisionSettings', 'lineSettings']`；`WORKSPACE_USE`（`:80`）加上 `state/line-pin-machine.ts buildWorkspaceLineSettingsRecord`。STATE-MACHINES-SPEC §14.1 一起改 |
| 同文件的解码允许表（`:164-169`） | 加 `{ file: 'persistence/line-settings-codecs.ts', functions: ['decodeWorkspaceLinePinsChangedEvent'] }`。置顶改成一个事件（L9）以后仍只有这一个解码函数，这一行不变 |
| `tests/architecture/production-reach-allowlist.json` | 只在新导出的常量（例如事件的 schema id、`LINE_HISTORY_READ_BUDGET`）只被登记表或测试读到时，照第 5 片的 `WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID` 加条目；施工时按检查的报告定，不预先加 |

按这一轮的改动核过（lead 2026-10-14，Codex 第二轮第 14 条）：
- 置顶改成一次请求一个事件、按最后的集合算（L9）：受保护类型表、解码允许表要加的还是上面两行，没有新的存储字段要放行。
- `LineBriefV1` 带全份状态、“改过的文件”的字段改成“有 / 没有”两种（L15、§2）：都是新的 DTO，不碰旧测试。
- 2B 草稿 §5.3 里“2C 先合入时由 2B 翻转 2C-27 那几处断言”的条件行用不上了：2C 的测试自己注入端口（L15），2B 换实现不改 2C 的断言；这一行由 lead 改 2B 草稿时删去。翻转 `S5-goal-conflict-rework.test.ts:53-54` 仍归 2B。
- 重放和并存的测试（2C-19、2C-31）都经公开端口，比的是**原回执**：先写、再做别的写、再重放，回的是当时的值。

经核对，下面这些**不改**：
- `tasks/query`（`TaskRow` 不变，L14、L21）：`tests/work-graph/R3c-canonical-task-state.test.ts` 等不受影响。
- `graph/look`、`look_graph` 工具（关系枚举不变，L14）：`tests/runtime/S3-graph-tools.test.ts`、`tests/app/S3-graph-routes.test.ts`、`tests/work-graph/S3-graph-context.test.ts` 不受影响。
- 只实现 `lookup` 的测试夹具（§0.2 列的那些）：计数是单独的端口（L3），类型检查不受影响。
- `tests/composition/platform.test.ts:56` 的公开键列表：新所有者组都不可枚举（L13）。
- 新索引：`tests/work-graph/S1-codecs-indexes.test.ts` SV02 只核对第 1 片的六个索引名，加别的不影响；`tests/work-graph/A1-session-discovery.test.ts` 只数两个旧索引的调用。
- 路由：`tests/app/MVP-ui-entry.test.ts` 只核对点名的几个路由。新路由要加界面标签（类型强制），这不是改断言。
- 请知悉的测试（`tests/work-graph/S5-notices.test.ts` 等）：没有 `lineSettings` 的工作区，写入和重放的值和今天逐字节相同（L9 只是多接受一个可选字段）。DSH 跑一遍确认。
- `tests/scenarios/S5-goal-conflict-rework.test.ts:53-54` 断言执行改过的文件 `not_available`：本片不换掉桩，**不翻转**；2B 换桩时翻转（2B 规格草稿已写）。

DSH 施工中发现别的旧测试失败，先停下报 lead，不自行改断言。

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **RecordStore：** `src/core/record-store/lookup-ports.ts`（`RecordCountPort`）、`lookup-index.ts`、`in-memory-record-store.ts`、`sqlite-record-store.ts`。
- **契约：** 新 `src/contracts/work-line.ts`；`src/contracts/ledger.ts`（`lineSettings`）。
- **WorkGraph：**
  - `sessions/session-record-codecs.ts`（五个索引）；`tasks/claim-record-codecs.ts`（一个）；`queries/query-record-codecs.ts`（一个）；`tasks/session-anomaly-codecs.ts`（一个）；一共八个（L4）；
  - `persistence/record-codecs.ts`（`WORKSPACE_VALUE_KEYS`、`workspaceSnapshotValueProblem`、`validateWorkspaceSnapshot`、`decodeWorkspaceSnapshot` 认 `lineSettings`；新 `workspaceLineSettingsProblem`）；
  - 新 `persistence/line-settings-codecs.ts`（事件编解码、校验、`LINE_SETTINGS_RECORD_SCHEMAS`）；
  - 新 `state/line-status.ts`、`state/line-pin-machine.ts`（含 `buildWorkspaceLineSettingsRecord`）；
  - 新 `model/work-line-contracts.ts`；
  - 新 `views/work-line-reader.ts`（含 `LINE_HISTORY_READ_BUDGET`）、`views/node-detail-reader.ts`；
  - 新 `configuration/line-settings-service.ts`（Session 的读由组合根注入，L9）。
- **组合和 Host：**
  - `src/composition/create-platform.ts`：存储的事件登记表加 `LINE_SETTINGS_RECORD_SCHEMAS`；读口、写口、职责端口、执行改过的文件端口、置顶服务的 Session 读；四个新所有者组加进不可枚举表（`:1450-1453`）；
  - 新 `src/composition/work-line-conversation.ts`（L12）；
  - `src/app/core-routes.ts`、`src/app/core-http-types.ts`（`WorkLineConversationPageV1`）；`src/ui/api/routes.ts`（七个标签，`GRAPH_WRITE_ROUTES` 加 `lines/pin`）。
- **测试：** 新测试由 DSH 写；旧测试见 §5.3（`state-writes.test.ts` 两张表，按需的 allowlist 条目）。
- **文档（lead 写）：**
  - STATE-MACHINES-SPEC §14.1（`WorkspaceSnapshot` 加 `lineSettings` 和产出者）、§17（S2C-PIN-01，一次置顶变更）；
  - DESIGN：§4.9 加注“活跃线一次返回、不分页”（L1）；§6 那三行按 L12、L14、L15 加注；§8.2 第 2 行（执行改过的文件、用量移到 2B）、第 4 行（agent 的“看”接节点详情）；附录 C 索引表加本片的 8 个、设置第 5 项写明存法和写事件；§4.5 按 U1 的答复改的那处已随决定 54 提交（14bda5b2）；余下把“归档以后点继续回到同一条线”对齐到决定 43；
  - DIAGRAMS L139 对齐到决定 43；
  - `slices/README.md` 加 2C 一行；能力索引。
- 其余不碰。

## 7. 施工

- 前提：接线包 2、K 片 B、K 片 A、2A 已合入；在合入后的基线上 lead 重核 §0.2 的行号和 §5.3。§0.2“自动维护、接续”现在写的是 K 合入以后的样子（出自 K 规格），要对着合入后的代码核一遍。2A 改完以后核对本片用到的 `RecordOrderedLookupPort` 写法（L4、§0.4）。U1 已答（决定 54）。
- 一个副本、一个新的 DSH Session。按入口分组：LE2 → LE1 → LE3 → LE4 → LE6 → LE5 → LE7。
- **夹具由 Codex 写**，用真实服务造：D1 数据集（2C-14）、5,000 个 Session 的规模集（2C-25，含 X、R、W、Z 四条长历史的线，都在 1,000 条空闲线里）、Host 重启、`missing`/`damaged`、维护、目标扇出、归档中断和退役暂停线归档的场景（LE4，和 K 片 KE3 同一个框架）、交接没做完和部分交出的线（2C-09）、能在指定调用上注入失败或先提交一笔的存储包装（2C-12、2C-14、2C-18、2C-29、2C-36；中途提交用 2A QA-16 那种存储边界的提交替身，提交本身经真实服务）、执行改过的文件端口的三种注入（2C-27、2C-30）、执行分节和对话分节用的注入时钟和编号（2C-18、2C-33）、门检查的产出线和负责线不同的场景（2C-40）、归档—重新启用—再归档和“放下 X、同时关掉 Y”的归档场景（2C-05）、经真实领取、准备、开始进入、重启、核对造出的 `not_entered` Query（2C-41）。lead 核对后冻结。
- **一个例外，也由 Codex 写、lead 核对**（照 2A §7 的写法，lead 2026-10-14 第三轮第 8 条）：
  - 旧 Session（来历为 null）经存储边界提交合法的历史记录（今天的写者都会写来历，造不出没有它的 Session，`session-directory.ts:782-800`）；用在 2C-14、2C-16、2C-18、2C-21、2C-26（旧 Session 来历集，含一对可靠找得到前任的）。2C-18 还要同样经存储边界提交两种合法的旧执行记录：没有派工记录的 Work 执行、没有 `executionState` 的 Query（今天的写者也造不出）。断言只经公开读取，不读数据库。
- DSH 只在可用时段跑，重的放 18:00 以后（AGENTS 第 5 条；决定 53 的可用时段）。说明书带关键信息和“子任务没回报完之前不要结束回合”。
- 其余同 2A、K 片 §7：每组派一个只读复查子任务；之后 lead 核对、Codex 审；在有 bwrap 的环境跑全量；合入。

## 8. 不做的事

- 不存线的编号、线名、状态词、计数；
- 不改 `tasks/query`、`graph/look` 已有的结果，不改 `effectivePhase`，不给 `DecisionCardV1` 加字段；
- 不调 `readSessionFacts` 做列表；不在读里补来历、推来历、探测健康、归档；
- 不在读里用“整窗重读”；
- 不把读不到、还没接上的东西报成 0、空或“没有”；
- 不做执行改过的文件、用量、日历（2B）；不做直接干预和消息处置（第 7 片）；不做注记一栏（第 4 片）；
- 不改维护的归档规则（决定 54 维持今天对暂停中断线的做法）；
- 不改界面；
- 不调用真实模型。

## 9. 这一轮审查怎么处理的（2026-10-14）

审查意见 34 条，逐条对着源文档和代码核过。31 条照改（有几条换了更省的改法，下面写明）；3 条部分采纳，没采纳的部分写明原因。

| 意见 | 处理 |
| --- | --- |
| U1 漏了决定 42 第 2 条 | 采纳。U1 改成三步，加选项 (c)，依据挪到末尾一行。lead 仍建议 (a)，理由是决定 49 第 25 项（K 片在原 Session 接着做）比决定 42 晚 |
| E9 自相矛盾 | 采纳，但**不采纳**改法里“点继续后这条线回到活跃列表”：今天的代码（`workflow.ts:722-748`、`:1026-1028`）和决定 43 是另一条线接着做；DESIGN L881、DIAGRAMS L139 和它不一致，列进 §0.1 告知和 §6 文档。加 2C-32 |
| 风险把间接连着的也排除了 | 采纳。只排除直接连线；2C-27 加 A→B→C 的例子 |
| L5 的 D 要读全部接续 Session | 采纳。改成只用索引计数：`countLookup` 加 `distinctPath`，D = F − A |
| L1/L18 每个线头读全部链接、全部执行 | 采纳。开着的链接走新索引；做过的任务取 21 条加总数；最近一次工作执行取 1 条；不分页记成和 DESIGN §4.9 不同 |
| L6 应调 `deriveLegacySessionProvenance` | 部分采纳：已归档计数在有旧 Session 时报范围，2C-09/2C-26 加可靠接上的一对和找不到的一个，和 AMB-1 的差别写进 §0.1 告知。**不采纳**在每次读里调推导：它每次扫全工作区的 Session 和两路消息（`session-provenance-facts.ts:195-216`），比被指出的 D 扫描还重，违反 DESIGN §6；活跃的旧 Session 由维护补上以后自然接上，已归档的等补来历那一小块修 |
| 悬停只有任务和模块 | 采纳。加目标、阶段的 `GroupHoverV1`，模块含子模块，文件和“改过这里的线”报 `not_available`（2B） |
| 自动重新入队以后失败提示消失 | 采纳。AT2、AT3 加 `pending/requeued` 的自动重新入队；人发起的不标 |
| DTO 里的计数是普通数字 | 采纳。都改成 `LineCountV1`，`partial` 加可选的 `atMost`；2C-28 加锚点读不全的例子 |
| U2 原型已经回答 | 采纳。改成 L24 |
| 2B、第 4 片的安排没告诉用户；索引数、文档没列 | 采纳。§0.1 告知两条；§6 文档列全 |
| “现在负责”只看线头 | 采纳。改成整条链，去重；加 E14 和 2C-09 的例子 |
| 空闲线在暂停的目标里写“等待推进” | 采纳。T9 加 `paused_by_goal` |
| 转来的卡落不到执行者线 | 采纳。L8 加 `objects` 和 `forwardedFrom` 两种落法，一条线只算一次 |
| 对话留给界面拼 | 采纳。在 Host 组合里拼（L12、2C-33） |
| 2C-21 只在 K 之前成立 | 采纳。改成 Query 线、`missing`/`damaged`，Work 线分 K 前后 |
| 界面文字里有 Kernel、Turn 等 | 采纳。§3.9 三处改成白话；§0.1 的标识符挪到依据行 |
| 已归档行的 `own` 没定义 | 采纳。§3.6 加一列 |
| 读不全的行排成“没有” | 采纳。L10 加“读不全”档 |
| LE1 测得太多 | 采纳。LE1 只留四行，各写流程测不到的原因；其余并入流程行 |
| `lineSettings` 会被请知悉的写事件校验拒掉 | 采纳。L9、§2、§6 写明 `record-codecs.ts` 三处要改；2C-19 加两种先后 |
| 置顶没有持久事件，重放做不出来 | 采纳。加 `WorkspaceLinePinsChanged@1` 和新文件 `persistence/line-settings-codecs.ts` |
| `configuration` 引不到 Session 解码 | 采纳。注入 `SessionDirectoryPort['readSession']` |
| 2C-17 有几项在 LE3 受理不了 | 采纳。拆成 2C-17（LE3）和 2C-34（LE4） |
| D 的扫描违反已定的 DESIGN §6 | 问题采纳，改法用上面第 4 条的索引计数。**不采纳**把已归档计数移出 `lines/list`：改成索引计数以后不读记录，左栏底部要一直显示“已归档 n 条”（决定 25） |
| 状态写入检查不认 `lineSettings` | 采纳。§5.3 列出两张表的改动 |
| `countLookup` 加进 `RecordLookupPort` 会让夹具类型检查不过 | 采纳。单独的 `RecordCountPort`；2A 的同一问题列进 §0.4 |
| 新所有者组会让公开键列表变 | 采纳。L13 写明加进不可枚举表 |
| 卡上没有原因码 | 采纳。从 `source.key` 解析，解析不了算读不全 |
| `readTaskArchiveState` 只按任务 | 采纳第一种办法：按目标列锚点，只对有未接手锚点的任务调它 |
| 读的次数写少了；线上写下的锚点没有索引 | 采纳。L1 改成一张表；加 `s2c-anomaly-by-session` |
| 计数失败只能落成 0；职责失败读成 unknown | 采纳（和上面 DTO 一条合并）；L7、E11 写明 unknown 也包括读失败 |
| `archivedAt` 为 null 的已归档 Session | 采纳，改法换成不加索引：第一页用两个计数比出差额，报 `withoutArchivedAt` 和 `partial`；写入方都写它这件事记进 §0.2，lead 验收时核对数据 |
| §0.2 漏了维护跳过没有负责关系的退役线 | 采纳。§0.2 加上，§0.1 告知一条 |

## 10. Codex 第二轮审查怎么处理的（2026-10-14）

Codex 第二轮审查（`D:/cc-lead-notes/codex2/s2c-spec.review2.md`）14 条，结论“还不能冻结”。lead 当天逐条定了改法（下表“lead 2026-10-14”）。子任务照改，并对着代码重核了每一处引用的行号；改不动或要 lead 再定的写在末尾。

| 条 | 意见 | 处理 |
| --- | --- | --- |
| 1 | §0.1、§0.2 的归档和维护事实不对：模块链接不挡归档；豁免漏了 `facts.wait === null`；KA1 不要求负责关系 | 采纳。§0.2 改：归档守卫只看 task、work（模块链接可以还开着）；豁免写全三条（含 `wait === null`、连模块也算的 `openResponsibleLinks`）；“自动维护、接续”改写成 K 合入以后的样子，标明出自 K 规格、施工前在合入后的基线上重核。§0.1 告知改成“K 以后还有哪几种退役线不归档”：Query 线、KA1 不满足或关不掉又落在豁免里的 Work 线、来历核不清的 Work 线。L1 表、§3.6 跟着改；2C-21 加“没有负责关系的 RUN-19 也被 KA1 关掉”和“来历核不清时不关” |
| 2 | L8 从 `objects` 读任务 pin，目标原因卡的任务 pin 在 `source.pins` | 采纳。L8、AT1：目标原因卡按 `source.pins` 里的任务 pin 落；其它卡仍按 `objects`；延后、只有目标的原因照旧不落；一条线只算一次。§0.2 写明 `taskPin`、`source.pins`、`objects` 默认空。2C-12 用真实队列卡（断言 `objects` 为空），含自动返工的卡；2C-22 的 `unknown_outcome` 卡同样 |
| 3 | 最近一次 Work 应按 generation；Query 没有排序的读法；索引数写错 | 采纳。索引改名 `s2c-work-claim-by-session-generation`，整数排序（2A 的 `valueType: 'integer'`），倒序取 1 条。新加本片自己的 `s2c-query-run-by-session-generation`（按 `executionState.sessionGeneration`，整数，倒序，同值按 refKey；lead 2026-10-14 定了用它，不用 `startedAt`），没有 `executionState` 的 QueryRun 不是候选、旧 Session 如实报“读不全”、能直接读到的地方（占用者、`lastExecutionRef`）不用它。索引重新数过：八个（Session 三、链接二、领取一、Query 一、锚点一），§1.1、§2、§6 一致。测试：2C-37（相同、倒退的 `claimedAt`，编号打乱）、2C-18（Query 时间相同、倒退，编号打乱，仍按领取先后）、2C-16（时钟倒退时秘书线名仍准） |
| 4 | 列表读仍随历史增长 | 采纳。L1b：写下的锚点和接手状态、未送达、做过的任务受每行的读预算管（`LINE_HISTORY_READ_BUDGET`，暂定 2,000 次，可注入，冻结前实测），超了报 `partial` / `attentionComplete: false` / `doneEvidence: 'incomplete'`，不报 0、不报“没有”。做过的任务不往下翻。开着的链接索引加 `ref.relation`，只读开着的负责链接。2C-25 加长历史、少待办的三条线（X、R、W）和预算注入成 10 的一遍；2C-03 用小预算造“读不全”档 |
| 5 | `distinctPath` 的“不同”没有说清，SQLite 会把 `true` 和 1 当一个 | 采纳。L3 写明按类型算、数字的归一同今天的等值编码，`[true, 1, "1", false, 0]` → 5，null、缺字段不算；SQLite 不能直接 `COUNT(DISTINCT json_extract(...))`。2C-08 加这个例子和整数排序索引的候选规则 |
| 6 | 旧 Session 的下界会是负数 | 采纳。下界取 `max(0, 下界 − U)`；同一刻算出的数不在 0 到 S 之间报 `unavailable`（数据对不上），不报准数。2C-26 写明维护前 `partial {0, 3}`、维护后 `partial {0, 2}` 和每个数 |
| 7 | 已归档计数把两个时刻的数拼在一起 | 采纳。只有“活跃列表第一次读的 `readThrough` 等于最后一次计数的 `readThrough`”时报准数；否则报 `partial { atLeast: max(0, S − F), atMost: S, reason: 'source_moving: …' }`。L5、L11、§3.5 改；加 2C-36（P 有活跃的接续 C，读列表和计数之间 P 被归档 → `partial {0, 1}`；不插这一笔 → `exact` 0） |
| 8 | T0、T3(c)、T9、B4、N9 的先后不清 | 采纳。T0 绑 `phaseCause.detail.afterRunRef` 就是最近那次 Run，并要求那个任务是这条线现在负责的；T3(c) 要求没有占用；T9 每个“全……”要求集合不空；B4 先于 B1–B3；N9 在 N2 之前查（L2 写了走法和代价）。例子：T0 绑定造不出，放 2C-01 纯函数并写明原因；T3(c) 的重叠在 2C-35（LE4，经转交负责关系造出）；空集合在 2C-16；B4 在 2C-14（注入读失败）；N9 只能改数据库才触发，按 AGENTS 第 4 条不写测试 |
| 9 | 链接历史分不出“做完”和“转走” | 采纳。L1a：完成证据是开着的负责链接、任务现在已终结的（lead 2026-10-14 定），或关闭方式 `terminal` 的关了的负责链接；关闭方式用 `eventAt(link.until)` 读，事件类型、`closed.ref`、`source` 对不上记“未知”。只读最新 21 条和总数：有证据 → 已做完；没有、总数不超过 21、没有“未知” → 普通待命；没有、总数超过 21 或有“未知” → `done_unproven`（做过的任务读不全）。A2 用同一个证据，再排除归档那一步放下或交出的。2C-04 加“转走、在别处做完”“超过 21 条”“`sessions/link` 关的”；2C-10 写明满足以后马上是已做完 |
| 10 | 列出的控制会被真守卫拒 | 采纳。L16：可用性用提交时的完整检查（对目标 Run 的几行 + `controlSubmissionProblem`：指针、接续已被用掉、恢复要观察到停下、恢复要目标 `active`）；继续用重新入队的检查（目标 `active`，不管谁暂停的）。§3.10 启动中分 Work、Query；T3 的恢复在目标暂停或取消时不给；RUN-24 的继续在目标暂停或取消时不给，“恢复目标后自动接着做”只给 GOAL-29 的那一种，人暂停 + 目标暂停写“先恢复目标，再点继续”。`paused_interrupted` 带 `by` 和 `goal` 两个参数（§3.9）。2C-17（目标暂停、取消时的恢复，Query 启动中）、2C-23（人暂停 + 目标暂停、目标取消） |
| 11 | 置顶的加和删一起时没有定 | 采纳。L9、§2：一次请求一个事件 `{ add, remove, at }`，按最后的集合算；同一个 Session 既加又删 `invalid`；已有的保留 `pinnedAt`、新加的用请求时间；容量按最后的集合；版本只加 1；集合没变不写记录、照样提交事件。`LinePinEventV1` 换成一个事件。2C-19 加“满 100 时删一加一”和“之后标已看、再重放得原回执” |
| 12 | DTO 给不出承诺的结果 | 采纳。`LineBriefV1` 带全份 `LineStatusV1`（含原因、标记、`attentionComplete`、`doneEvidence`、`partialParts`），§2 写明逐字段相同比哪几个字段；2C-10、2C-30 照这个比。“改过的文件”的字段都改成 `FromExecutedFilesV1`（有 / 没有，没有分 `not_recorded`、`read_failed`），L15 定死从 `GoalExecutedFilesPort` 的映射；2C-27、2C-30 现在就注入回“有”的端口 |
| 13 | 有些测试在它的入口上做不出来 | 采纳。2C-05、2C-13、2C-17 里 RUN-24 的部分挪到 LE4；2C-25 跨过活跃 1,000 和单个 Session 2,000 条链接，加长历史，期望值都写成手算的数。LE1 只留经公开服务真造不出的：2C-01（没有写入方的、旧数据才有的、流程走不到的 T0 绑定）、2C-02（P10、P15）；2C-03 排序、2C-07 置顶的几种错挪到 LE3（含“版本旧 + 超容量”）；2C-02 的同级先后并进 2C-12；T1 配 `missing`/`damaged` 的结果未知挪到 2C-22。§5 写明不加改数据库才能触发的测试，读失败用存储包装注入（2C-14、2C-29 跟着改） |
| 14 | §5.3 大体对，验收覆盖要对一遍 | 保留 §5.3 原有两行；按置顶一个事件、新 DTO 核过，没有新的存储字段要放行；2B 草稿里翻转 2C-27 的条件行用不上了（由 lead 改 2B 草稿时删）；重放和并存的测试比原回执（2C-19、2C-31） |

**子任务留下的四处待定，lead 2026-10-14 已定：**
- L1a：开着的负责链接、任务现在已终结，**算**完成证据（L1a (a)）。任务一满足，这条线马上是“已做完”；T8、A2、E6、2C-04、2C-10 跟着改。
- L1a：“21 条里有关闭方式未知的”算读不全，不是普通待命，**认可**。
- A2：“21 条里没有归档那一步放下或交出的”**认可**，理由写进 A2（DESIGN §4.8；人归档时放下或交出任务，不是做完）。
- L4 第 7 个索引**改用** `executionState.sessionGeneration`（整数、准的），改名 `s2c-query-run-by-session-generation`，倒序、同值按 refKey；不再说“按时钟只是大致的先后”，对话里显示的时间仍是 `startedAt`。核过：凡是能算作某个 Session 的 Query 的都有它；还没领取的不属于任何 Session；R5b.2 之前的旧记录没有它，按旧数据的情况如实报（L4）。L1、L12、L20、§2、2C-16、2C-18 跟着改；2C-37 只测 Work 的 generation，不受影响。

**备查：**
- L1a 的事件对位（lead 要求核的）：今天每次负责关系的提交只有一条事件、只关一条链接（`session-responsibility-service.ts:276-289`、`:306`），提交位置就是那条事件的位置（两个后端都是，`sqlite-record-store.ts:199-211`、`in-memory-record-store.ts:137-153`），所以 `eventAt(until)` 认得出；维护今天就这样读（`session-maintenance.ts:174-190`）。经 `sessions/link` 关的链接是另一种事件、没有关闭方式，记“未知”。以后若有一次提交关几条链接，`eventAt` 只读回最后一条，别的链接 `closed.ref` 对不上，记“未知”，不会认错。所以认得出。
- L4 第 7 个索引的已知缺口：补过来历的旧 Session（维护补的，来历不再为 null）认不出它有没有 R5b.2 之前的 Query，线名不会标“读不全”。今天的 `query-run-by-session` 和 `readSessionFacts` 同样找不到这些旧记录。
- **已知限制（lead 2026-10-14 第五轮第 4 条）：`executions` 分节只列有索引的执行**（`scope: 'indexed'`）：有派工记录的 Work 执行、有 `executionState` 的 Query。更早的、没有这两样的旧执行不列，也不替它们编 generation；这一分节不按来历推“全不全”（补来历不会补上执行记录）。
- **已知错标（lead 2026-10-14 第五轮第 3 条、第六轮第 1 条）：** 两种已归档的执行者线只写“已归档”，不写“已归档 · 已做完”：(1) 归档时放下过任务、后来重新启用、做完一个任务、再归档的线（旧的带 `archiveStep` 的关闭还在读到的关闭里，2C-05 (4)）；(2) 关了的负责链接超过 21 条的线（读不全，标 `done_unproven`，2C-04 (8)、2C-05 (3′)）。这是保守的错标：它们只会少说“做完”。A2 只在关闭不超过 21 条、全都读到、没有一条带 `archiveStep` 时才写“已做完”，所以从不把一次放下或交出了没做完任务的归档说成做完。
- 2C-37 要一个职责解析为执行者、又能跑 Query 的角色，才能让“最近一次工作执行”走索引；子任务没有核实今天的角色配置能不能这样，夹具造不出时停下报 lead。

## 11. 第三轮审查怎么处理的（2026-10-14）

Codex 第三轮审查（`D:/cc-lead-notes/codex2/s2c-spec.review3.md`）9 条，结论“还不能冻结”。lead 当天定了第三轮的 9 条决定（下文写“lead 2026-10-14 第三轮第 n 条”），子任务照改，并对着代码核了新引用的行号。原则是合同越简单越好，不加决定以外的机制；加了的写在末尾。

| 条 | 意见 | 处理 |
| --- | --- | --- |
| 1 | 读预算只数一次读口调用，读口里面的扫描不算；任务行、目标锚点读全部 Run 却不受管 | 采纳（第三轮第 1 条）。L1b：每一行的历史部分经这一行自己的计数包装读存储，未送达和锚点的读口用这个包装造（组合根注入工厂），嵌套的读也被数到：每页 `lookup`、`readMany` 每条记录、每次 `eventAt`、每次 `countLookup` 各算 1；用完了包装拒绝再读，这一部分照旧报“没读全”。共享代价单列、不算进每行的预算：每个目标一次 `queryTaskGraph`（规范任务事实读全部 Run）、决定队列、目标上的锚点、暂停任务的重新入队事实里按目标读的部分。暂定 2,000 不变，写了冻结前 lead 定数的做法。2C-25 加 Z（一个任务 3,000 次 Run，共享代价，量）和保留 W（长锚点，每行预算） |
| 2 | 不是同一刻时给的范围也是拼出来的，不可靠 | 采纳（第三轮第 2 条）。已归档计数只有“活跃列表第一次读和每一次计数的 `readThrough` 全都相同”时才算：准数，或有旧 Session 时的范围（唯一的范围）；否则 `unavailable`、`source_moving`，不给范围，界面照旧显示上一次的数、标“更新中”（E3）。去掉了不是同一刻的范围。`withoutArchivedAt` 不再让计数报 `partial`（S 本来就数到它们）。2C-36 加“计数之间插一笔” |
| 3 | 完成证据在几处说法打架 | 采纳（第三轮第 3 条）。L1a 写成一张真值表（DE1–DE5）：正证据（(a) 或读到的 `terminal`）优先；A2 另要没有带 `archiveStep` 的；没有正证据时，没读全（总数超过 21、有未知、预算在读完 21 条之前用完）是 `done_unproven`，读全了是普通待命；预算用完不推翻 (a)，也不推翻已经读到的 `terminal`。T8、A2、§3.6、`LineDoneEvidenceV1`（去掉 `over_budget`，改成 `budgetExhausted`）、`omitted` 和 2C-04 都引这张表；2C-04 加最新一条是 `terminal` 的 22 条、预算用完的三种、已归档的一种 |
| 4 | 对话把按 generation 排的一路和按时间排的几路合在一起 | 采纳（第三轮第 4 条），有两处没照写（见末尾）。对话按显示的时间合成一路，相等时按固定的来源次序再按键，游标带（`at`，来源次序，键），标 `time_approximate`；generation 只用来挑“最近一次”。加了 Query 按 `run.startedAt` 的第 9 个索引；执行也要按时间，补了第 10 个索引（lead 2026-10-14 认可）。原历史只能按位置读，游标另带每段读到的位置。2C-18、2C-33 写成带时钟倒退的字面顺序 |
| 5 | 还没进入就暂停的 Run 没有“恢复” | 采纳（第三轮第 5 条）。T3 加 (d)：`starting`、指针意图是已生效的暂停 → 已暂停（`paused_by_you` / `paused_by_goal`），控制是恢复（RUN-11，走完整的检查）和取消。§3.10、L16 跟着改；2C-17 加“暂停 → 读状态和控制 → 恢复 → 再读” |
| 6 | “继续”的可用性和事实都不全 | 采纳（第三轮第 6 条）。每个暂停中断的任务一项“继续”（任务、`afterRunRef`、版本），可用性 = `taskRequeueStateProblem` 再加 Goal 必须 `active`，纯调用；事实照 `readRequeueWindow` 读。`LineFactsV1` 加 `pausedTasks`（`LinePausedTaskFactsV1`）。这些输入类型挪到 `state/line-status.ts`（要用 state 的 `TaskState`、`TaskReworkFacts`，contracts 引不到）。加 2C-39：取消了的任务（目标进行中）不可用、转交来的任务、两项各自的可用性，列出的和提交的一致 |
| 7 | 改过的文件：风险数是普通数字；模块的文件条数对不上 | 采纳（第三轮第 7 条）。`riskCount` 和那里的每个计数都是 `LineCountV1`。模块的 `files` 按路径去重：`{ path, certainty（有一个确定就确定）, runs }`，按路径的字节序，来源可能不全时计数 `partial`。2C-30 改成字面的三项（含一个两条线都改过、确定程度混合的路径）和不全的一例；2C-27 的 `riskCount` 写成字面值 |
| 8 | 几条验收造不出来，或断言了读不到的东西 | 采纳（第三轮第 8 条）。旧 Session 改由 Codex 的存储边界兼容夹具造，只经公开读取断言（照 2A QA-11 的写法列进 §5 开头和 §7）。2C-26 改到 LE4。2C-10 以 `lines/read` 为准，负责关系关掉以后不再比任务的 `owners`。2C-12 换成造得出的去重（发信、任务 pin、转来），多任务 pin 放进 LE1 的 2C-38（新的纯函数 `cardLineKeys`，写明造不出的原因）。2C-25 写明 X、R、W、Z 都在 1,000 条空闲线里。2C-37 加“之后又有一次 Work 时，最近一次 Query 走索引”。2C-08 加 2A 的安全整数规则 |
| 9 | 2B 的交接没收尾 | 采纳（第三轮第 9 条）。链的上限只有一个：线头加至多 32 个前任，共 33 个 Session（L2，M5、`omitted`、`sessionCount`、L9 的说法统一）。行上加 `chainSessions`；一条线的 `sessionRefs` 就是它的链，分叉各用各的，副本画在被问的那个 Session 上（§0.4）。2B 草稿不改，翻转那一行由 lead 删 |
| 后续 | 第三轮留下的几处（下面的列表） | lead 2026-10-14 定了：第 10 个索引认可，去掉待定，索引数都写十个；核过 `executionHistory` 只在进入以后才有，没进入过的执行在对话里不列（选简单的，L4 第 10 个、L12）。检查轮次放在执行这一项里、副本问答只在 `copies` 分节、游标带每段原历史的位置、`cardLineKeys` 和 2C-38、`LineFactsV1` 一组挪到 `state/line-status.ts`，都认可。“继续”的投影先只算 `taskRequeueStateProblem` 加 Goal `active`；2C-39 若找到造得出、投影没算到的拒绝，就把那道守卫加进投影（改规格，不放松测试），写进 L16。之后交 Codex 第四轮审查 |

**没照写的、子任务加的（lead 2026-10-14 都认可，见上表“后续”一行）：**
- **第 10 个索引** `s2c-run-by-session-started`。第三轮第 4 条写的是“加 Query 按时间的索引，一共九个”。可执行也要按显示的时间进同一个合并；第 6 个按 generation 排，时钟倒退时不是按时间排好的输入，就是审查第 4 条的毛病，今天也没有别的按 Session、按时间找执行的读法。所以补了第 10 个，索引数写成十个（L4、§1.1、§2、§6）。不要它的话，执行在对话里没有按时间的读法。
- **检查轮次没有单独按时间进合并**，放在它检查的那次执行这一项里（各自显示 `eventAt(since)`）。轮次记录上没有 Session，按 Session、按时间找不到它们；单独进合并要么加索引，要么翻页时往回找没有上限。
- **副本的一问一答不进对话**，只在 `copies` 分节。被问的副本可能有几百个，按 Session、按时间找它们没有读法；放进合并要再加一个索引。
- 原历史只能按位置读，游标除了（`at`，来源次序，键）还带每段原历史读到的位置。
- “继续”的检查只投影 `taskRequeueStateProblem` 和 Goal `active` 两步；类别和请求者那几行对人的 RUN-24“继续”总是放行（TASK-27），没有另外投影。2C-39 的“列出的和提交的一致”会抓出漏掉的情况。
- 新的纯函数 `cardLineKeys` 和它的两个输入类型，是为了 2C-38 这一行 LE1 的测试而加的。
- `LineFactsV1` 一组输入类型从 `src/contracts/work-line.ts` 挪到 `state/line-status.ts`（原因见第 6 条）。

## 12. 第四轮审查怎么处理的（2026-10-14）

Codex 第四轮审查（`D:/cc-lead-notes/codex2/s2c-spec.review4.md`，对的是 bb924854）8 条，结论“还不能冻结”。lead 当天定了第四轮的决定（下文写“lead 2026-10-14 第四轮第 n 条”），原则是：去掉惹麻烦的机制，不再加新的。子任务照改，新引用的行号对着 bb924854 核过。

| 条 | 意见 | 处理 |
| --- | --- | --- |
| 1 | 对话的游标在时钟倒退时会把已经给过的项再给一次 | 采纳（第四轮第 1+2 条）：不再按时间合并。`conversation` 分节只有原历史，一段一段按 Kernel 的位置读，游标（第几段，最后**给出**的位置），不重不漏。执行和 Query 挪到新的 `executions` 分节（见第 2 条）。去掉 `LineConversationCursorV1` 和 `time_approximate`；`LineConversationSourceV1` 只给段。2C-33 写成只有原历史的字面顺序（段内分页边界、时钟倒退的原历史照位置排、一段 `missing`） |
| 2 | 第 9 个索引证明不了 Query 进入过（`startedAt` 在 `entering` 就写上，`not_entered` 也留着） | 采纳（第四轮第 1+2 条）：去掉第 9、10 个按时间的索引，索引回到八个（L4、§1.1、§2、§6、验收核对）。新的 `executions` 分节按 Session 里真实的先后：Work 用第 6 个（`claim.generation`），Query 用第 7 个（`executionState.sessionGeneration`），同一个严格递增的计数，按 generation 合成一路，一段一段给，游标（第几段，最后给出的 generation）。每项给阶段或结果，`startedAt` 只作显示的时间；没进入过的、`not_entered` 的也列，照它们自己的阶段写，不说“进入过”。普通检查放在主体执行那一项里。2C-18 写成字面顺序（段内分页边界、时钟倒退的 Query 不影响先后、没进入的执行和 `not_entered` 的 Query） |
| 3 | DE3 把以前那次归档当成这一次 | 采纳（第四轮第 3 条）：A2 不追第几次归档，只看读到的那几条里“最新的相关关闭”（`terminal` 或带 `archiveStep` 的）：`terminal` → 已做完；带 `archiveStep` → 不是；没有相关关闭 → 照没有证据的两行（读全了是普通的不是已做完，没读全是 `done_unproven`）。L1a 真值表、A2 行改；2C-05 加“归档（放下）→ 重新启用 → 做完 → 再归档”（已做完）和“归档时放下”（不是） |
| 4 | 门的检查在对话里落不到负责的线上 | 采纳（第四轮第 4 条）：单条线详情加 `gateChecks`：这条线现在有开着的负责链接的门任务，按已有的 `VerificationRoundByTask` 读它的轮次，每轮另记产出执行（`producerRunRef`），按 `since` 排。归属规则同 2B 的 `ownerSessionRefs`：链里有一个负责的 Session 就显示；一个都没有就不显示在任何线上。L23、§2、LR3 改；`executions` 分节不放门检查；加 2C-40（产出 P ≠ 负责 G） |
| 5 | 计数包装没写完 | 采纳（第四轮第 5 条）：`lookupOrdered` 每页也算 1；`readMany` 发出去之前整个请求比剩下的额度，不够整个拒绝；三部分按“写下的锚点 → 未送达 → 做过的任务”的先后读，列表、详情、悬停一样；共享的目标读写成“没有上限的共享工作，不在每行预算之内”。定数的做法保留，冻结前定数 |
| 6 | `withoutArchivedAt` 用两个时刻的数相减 | 采纳（第四轮第 6 条）：两次计数的 `readThrough` 必须相同，否则 `unavailable`、`source_moving`。2C-36 加两次计数之间插一笔归档 |
| 7 | 几条验收的断言不对 | 采纳（第四轮第 7 条）：2C-25 只断言公开的 `attentionCounts`、`attentionComplete`、`partialParts` 和 `undelivered` 标记，不断言 `writtenAnchorsPending`；`LineTaskBriefV1` 加 `phaseCause`，2C-35 用它；2C-39 第 (2) 步另造一条全新的 RUN-24 线，`LineControlV1` 加 `reasonCode`，断言提交被拒的码等于它；2C-22 按健康分开（`kernel_turn_open` 认定以后由 KA1 关掉、回到可用；`missing`、`damaged` 照 K 的规则归档、不回到可用）；2C-36 写明 Z 和 P 的状态、改了算式 |
| 8 | 合入后的代码事实要更新（接线包 2 在 bb924854） | 采纳（第四轮第 8 条）：§0.2 改 `unavailableSince`（提交位置，可用→不可用那次提交记下，不可用期间保留，回到可用时去掉，旧记录没有）；未送达回复带可选的 `unavailableSince`、`responseSince`；上下文扩展接上了目标自主程度和待答的决定行（`views/context-extensions.ts:240`、`create-platform.ts:773`），注记和足迹没实现；2A 撤临时上限的安排照旧。`LineRowV1.retired.since`、§0.4 接线包 2 一条、头部的代码基线跟着改 |
| 继续 | “列为可用的提交都会被受理”说得太满 | 采纳（第四轮第 9 条）：L16 改成“投影预报的是状态不变时领域上能不能继续；提交时取来源材料、写存储可能失败（`tasks/requeue-service.ts:1002`），读的时候不预报”。2C-39 的断言照这个口径 |

**没照写的：** 没有。

**要 lead 知道的：**
- §0.2 只按第四轮第 8 条改了那几条；其余行号还是按 a7cafccc 记的。接线包 2 改过的文件（例如 `state/session-availability.ts`）行号已经移动，施工前在合入后的基线上重核（§7 本来就这样要求）。
- “接线包 2 接上了未送达回复的请知悉来源、记下被接受的回复”这一句照 Codex 第四轮审查写，子任务没逐行核。
- `executions` 分节里 Query 的 `startedAt` 照记录给，`not_entered` 的 Query 也可能有它（在 `entering` 时写上）；所以只作显示的时间，不作“进入过”的证据。

## 13. 第五轮审查怎么处理的（2026-10-14）

Codex 第五轮审查（`D:/cc-lead-notes/codex2/s2c-spec.review5.md`，对的是 bb924854）7 条，结论“还不能冻结”。lead 当天定了第五轮的决定（下文写“lead 2026-10-14 第五轮第 n 条”），原则是简单、保守。子任务照改。

| 条 | 意见 | 处理 |
| --- | --- | --- |
| 1 | `executions` 分节两路分开读，中间有提交时会漏一项 | 采纳（第五轮第 1 条）：一页读 Work 索引、Query 索引和要用的线的事实，`readThrough` 必须全都相同；不同就从这一页的游标重读，一共最多 4 次（同 2A L7），还不同报 `unavailable`/`source_moving`，一项都不给。这一页之后提交的，generation 更大，出现在后面的页。L12、LR8、§2 `executions` 分节的 `sourceCursor` 注释改；2C-18 加用 2A QA-16 那种提交替身在两次读之间插入真实提交的三种情况 |
| 2 | “第几段”不是稳定的游标；段开头之后还没有原历史的状态没写 | 采纳（第五轮第 2 条）：两个分节的游标都带分节名、线的键、第一页时链上各段 Session 的有序列表（或摘要），链变了报 `source_stale`，界面从头读。对话的游标另带“段开头已给出、原历史还没给”（`header_only`）或最后给出的 `SessionHistoryEntry.cursor`（原样的不透明游标，带 Runtime 冻结的边界），不再只记位置数字。L12、LR7、LR8、§2 改；2C-33 加 `limit: 1` 只有段开头、读不到的段、链在两页之间变了；2C-18 加链变了 |
| 3 | “最新的相关关闭”判断不了这一次归档放下了什么（放下 X、同时关掉 Y 的归档会被说成做完） | 采纳（第五轮第 3 条），改成保守的：已归档的线只在有正证据、**而且**最新 21 条里没有一条带 `archiveStep` 时才写“已归档 · 已做完”；有一条就只写“已归档”；21 条没读完或有“未知”、确认不了的，按 `done_unproven`。已知错标写进 §10 末尾：放下过任务、重新启用、做完、再归档的线，在旧的 `archiveStep` 还在最新 21 条里时只写“已归档”。L1a 真值表 A2 那一列、A2 行、§3.6 改；2C-05 写成四种：一天以后维护归档 → 已做完；放下 → 已归档；放下 X 同时关掉 Y → 已归档；重新启用以后再归档 → 已归档（写明的错标） |
| 4 | 按来历推“执行全不全”，补来历以后会错标成全 | 采纳（第五轮第 4 条）：去掉 `executionsComplete`。`executions` 分节保证的是“有索引的执行”：有派工记录的 Work、有 `executionState` 的 Query；更早的不列、不编 generation，分节上标 `scope: 'indexed'`，限制写进 §10 末尾。L4 第 7 个、L12、§2 改；2C-18 加两种旧执行记录（存储边界兼容夹具），2C-26 加“维护补来历前后列出的不变” |
| 5 | 2C-18 里 `entering → not_entered` 要 Host 的租约，LE3 做不了 | 采纳（第五轮第 5 条）：挪到新的 2C-41（LE4），经真实的领取、准备、开始进入、重启、核对造出来，不直接写终态记录 |
| 6 | 读预算这个冻结前提还没做 | 采纳（第五轮第 6 条）：仍是冻结前提，由 lead 量；做法保留，数和证据写进 §0.2，没量完不冻结（L1b、§2 常量注释、§5.2 验收核对） |
| 7 | §0.2 一句旧话说 `not_entered` 的 `startedAt` 一定是 null | 采纳（第五轮第 7 条）：改成“在 `entering` 之前就收尾的仍是 null；从 `entering` 被核对成 `not_entered` 的留着 `entering` 时写上的时刻”（`state/query-run-recovery.ts:557`、`:635-638`） |

**没照写的：** 没有。

**子任务的读法（请 lead 看一眼）：**
- 第五轮第 3 条说“有正证据、而且最新 21 条里没有 `archiveStep`”。子任务把“21 条没读完（读预算用完）或有‘未知’”也算作确认不了，A2 按 `done_unproven`，不写已做完。这和 T8 那一列“预算用完不推翻已经读到的 `terminal`”不同，是照“保守”写的。
- 2C-18 的旧执行记录（没有派工记录的 Work 执行、没有 `executionState` 的 Query）也由存储边界兼容夹具造，§7 那个例外里补了一句。

## 14. 第六轮（Codex 快速核对）怎么处理的（2026-10-14）

Codex 快速核对（`D:/cc-lead-notes/codex2/s2c-spec.review6.md`，对的是 bb924854）核了第五轮的 7 条：第 4、5、7 条已解决；第 1 条部分解决，第 2 条大体解决；第 3 条没解决，第 6 条还欠着。另提 5 处问题，结论“还不能冻结”。lead 当天定了第六轮的决定（下文写“lead 2026-10-14 第六轮第 n 条”）。子任务照改。

| 条 | 意见 | 处理 |
| --- | --- | --- |
| 1 | A2 还会把放下了没做完任务的归档说成做完：线负责没做完的 X 和 21 个早已终结的任务，归档先处置 X、再关那 21 条，最新 21 条全是 `terminal`、没有 `archiveStep`，DE2 就写“已做完”；交出也一样 | 采纳（第六轮第 1 条）：A2 只在读全时才算做完。关了的负责链接一共不超过 21 条、全都读到、没有“未知”、至少一条 `terminal`、没有一条带 `archiveStep` → DE2；总数超过 21 → DE5（`done_unproven`），永远不是 DE2。“从不错说做完”这一保证现在成立。已知错标保留重新启用那一种，再加关闭超过 21 条那一种（都只会少说“做完”）。L1a 真值表 A2 那一列和下面几条、§3.6 A2 行和它下面那条、§2 `LineDoneEvidenceV1.total` 的注释、§10 末尾改；2C-04 (8) 改成“22 条、最新的是 `terminal`、归档 → 只写‘已归档’、`done_unproven`”，对照“21 条全是 `terminal` → 已做完”；2C-05 加 (3′) 22 个任务的变体 |
| 2 | 翻过的段不受保护：E1 那种前任还活跃，翻到线头那一段以后前任上又有新执行，它的 generation 更大，但游标不回头，链也没变 | 采纳（第六轮第 2 条）：`executions` 的游标给每个走过的段记下见过的最大 generation（Work、Query 各一个）；后面每一页在同一个时刻里，对每个走过的段、每个索引做一次倒序 `limit: 1` 的按顺序查找，有更大的就报 `source_stale`，界面从第一页重读。一页最多多 2 × 32 次查找。“之后提交的会出现在后面的页里”改成：落在当前段或后面的段上的出现在后面的页里，落在走过的段上的让下一页 `source_stale`。L12、LR8、§2 游标注释改；2C-18 的 (三) 限定在当前段，另加“走过的段又有新执行”一例 |
| 3 | 读预算还没量 | 不变（第六轮第 3 条）：仍是冻结前提，由 lead 量，数和证据写进 §0.2，没量完不冻结 |
| 4 | 对话的游标没有“下一段的段开头还没给出”这一状态；读不到的段之后直接进下一段，下一段的段开头可能放不进这一页 | 采纳（第六轮第 4 条）：加 `before_header`。一段读完（Runtime 读回的页 `nextCursor` 为 null）或一段读不到以后页满了，游标记“下一段，`before_header`”，下一页先给那一段的段开头。L12、LR7、§2 游标注释和 `WorkLineConversationPageV1.nextCursor` 注释改；2C-33 第 1 页的游标写成 h2 的 `SessionHistoryEntry.cursor`，(3) 读不到的段 `limit: 1` → 第 1 页只有那一行、游标（下一段，`before_header`）、第 2 页是下一段的段开头、第 3 页是它的第一条原历史，加 (3′) `limit: 4` 停在 P 的最后一条上 → 游标（H，`before_header`） |
| 5 | L1b 还写着“预算用完不推翻已经读到的 `terminal`”，和改过的 A2 打架 | 采纳（第六轮第 5 条）：这一句只对 T8；A2 照 L1a 真值表的 DE3、DE5，读到的 `terminal` 不够写“已做完”。L1b“用完了”那一条和真值表下面那一条改 |

**没照写的：** 没有。

**子任务的读法（请 lead 看一眼）：**
- 第六轮第 2 条的再核只看“有没有更大的 generation”。走过的段上的执行如果只是状态变了（例如从工作中变成结束），generation 不变，不报 `source_stale`；这一页之前已给出的那一项显示的还是读它时的状态，界面重读第一页才更新。这和第五轮以前“已给出的项不回头改”一致。
- 再核的查找读同一个时刻，`readThrough` 和这一页别的读一起比（L12“一页只用一个时刻的数据”），不另算尝试次数。

## 15. 冻结时的限定（lead，2026-10-14 夜）

和 §0–§14 同等有效；有冲突时以本节为准。

- **读预算改到施工以后量（改 L1b“冻结前怎么定这个数”、§2 常量的注释、§5.2 末尾、§7）。** L1b 要在 2C-25 的数据上用不设上限的预算跑一次 `lines/list`；这个读要施工以后才有，冻结前量不了。所以：施工时 `LINE_HISTORY_READ_BUDGET` 保留暂定的 2,000（可注入）；2C-25 另外在两个后端各用不设上限的预算跑一次 `lines/list`，打印每一行受预算管的几部分的读次数、共享代价的读次数和耗时（只打印，不断言）；lead 在**合入以前**按 L1b 第 2–4 步定数，写进 §0.2 和证据。没定数不合入。
- **夹具由 DSH 写（改 §7“夹具由 Codex 写”“一个例外，也由 Codex 写”）。** 这一阶段 Codex 只能做只读审查，不能写文件。照 2A 的做法（2A 规格 §10）：DSH 按任务书的夹具规矩写，只经公开服务造数据，§7 的例外不变；lead 审，Codex 实现审查时一起看。
- **和 2B 同时施工（§0.4“2B（可以并行）”）。** 两个副本，同一个基线：79032271 加 lead 验过的 2A。合入先 2B 后 2C。两片都改的只有登记一类的文件（`create-platform.ts`、`core-routes.ts`、`core-http-types.ts`、`src/ui/api/routes.ts`、`src/contracts/ledger.ts`、`queries/query-record-codecs.ts`、生产可达允许表），各加各的，lead 合入时手工合。2C 的测试自己注入执行改过的文件端口（L15），2B 换掉桩不改 2C 的断言。
- **§0.2 的行号**按 a7cafccc、bb924854 记；K 片 A、2A 合入后有的已移动。施工时按符号找，DSH 施工前通读时报出不再成立的事实。
- **§14 末尾“子任务的读法”两条，lead 认可：** 再核只看有没有更大的 generation（状态变了、generation 没变，不报 `source_stale`）；再核的查找和这一页别的读用同一个时刻，不另算尝试次数。

## 16. 施工和验收中的限定（lead，2026-10-15）

施工六轮（第 1 轮被机器故障打断后接着做；第 4 轮一次服务出错后重开；第 6 轮上下文用满后接着做）、Codex 一次实现审查加一次快速核对、合入前测试失败的排查（lead 委托的子 agent 查、Codex 只读复核）和 lead 的验收里定下的读法，和 §0–§15 同等有效；有冲突时以本节为准。经过见证据目录 `reviews/evidence/orchestration-slice-2C-2026-10-15/`。

- **读预算定为 100**（§15 第 1 条要求合入以前定数）：数和定法见 §0.2“读预算的实测”。可注入，测试用小的数造“超了”。
- **2C-22 第 (2) 种：Kernel 存储删掉、弄坏的线怎么退役（新行 SES-19a，扩大范围，lead 2026-10-15）。** 人认定结果未知时，照 SES-07 写 `kernel_turn_open`（Kernel 读不了也一样，决定 51 和 K 片 KA-14 要求读得到时 KA1 能关）。之后 Workflow 的维护推进去关悬空 Turn：Runtime 的 `closeOpenTurn` 读不了 Kernel 时，用这次新的探针把结论码换成 `missing`/`damaged`（`caller='turn_closure'`，只有这一处能换；Host 启动的 reconcile 仍照 SES-19 不换）；下一次维护照今天按退役归档 → 已归档 · 已退役。2C-22 那一行“认定以后不满足 KA1，照今天的逻辑维护按退役归档”就是经这条路到的。第 3 轮试过在认定时保留 `missing`/`damaged`，会让存储重新读得到时 KA1 关不了，违反决定 51，已撤回。状态机的行见 STATE-MACHINES-SPEC §8（SES-19a）和 §17.5。
- **2C-32：人归档 RUN-24 退役的线时写异常锚点（扩大范围）。** `business/workflow/session-archive.ts` 照归档持有者原有的守卫（执行已结束、任务没终结）选锚点，补上“人归档、没有捕获的 Work 执行、也不是 `retired` 方式”的这一种；不这样做，归档的线和任务都少了 `anomaly_pending`。
- **复用的 Session 领取任务时开负责关系（lead 2026-10-15，第 6 轮第 10 项）。** lead 在 bwrap 下跑 2C-05 时查出：Workflow 让已有的 Session 领取新任务，只有新建 Session 时才开 `responsible` 链接（初始链接），复用的 Session 领了任务却不负责它，归档标签和线的状态跟着错。改成领取提交里开（STATE-MACHINES-SPEC SES-02 的表外说明）。第 6 轮为此改了 `tests/scenarios/S2C-K-archive-tags-checks.test.ts` 的 2C-05 (3)、(3′)：原来无条件提交 `sessions/transfer-responsibility` 并断言 `committed`；复用时 X 就是 S，同一来源的转移是被拒的空操作，所以改成只在 X ≠ S 时提交和断言。合入前的全量又查出 A8-3n 和这个文件的四例要跟着改，见下面两条。一条线对同一个任务只有一条负责链接记录（Session、目标、关系三者定一条，`claim-service.ts` 里确定的键）：同一条线再领同一个任务时重开这条记录，前一段的起止被新的一段换掉，L1a 读到的是新的一段。
- **A8-3n 跟着改：关不了悬空 Turn 的退役线照今天的维护马上归档（lead 2026-10-16，按决定 42 第 2 条、43 和 K 片 L7）。** `tests/scenarios/A8-host-restart-paused.test.ts` 的 A8-3n（关闭不支持）里，S1 是复用的线，上一条以后它负责被中断的任务。崩溃重启时，启动核对第 6c 步的维护去关悬空 Turn，得到 `unsupported`（确定失败），照 K L7“一字不改地走今天的逻辑”：S1 手上有开着的负责关系，中断是平台干净的那种，`kernel_turn_open` 的豁免不成立，于是按退役马上归档、放下任务、写异常锚点（决定 42 第 2 条）。之后的重新领取走普通选择（决定 43 的补充：“不是那条线的接续，而是一次新的领取”），复用了同职责的空闲 Session。它的游标为空、和 S1 在同一个 Kernel 适配器上，所以照 LA-1 (c) 仍用 S1 已完成的历史播种（`other_session_seeded`），接续说明带上 `retired_archive` 锚点。
  - 原来断言“新建 Session、不用空闲的”，只在第 10 项以前成立：那时复用的线不负责它领的任务，豁免成立，Workflow 走 K L8 的退路。Workflow 新建的线本来就带初始负责关系，一直走归档这条路。
  - 改的断言：S1 已归档；Run2 在那个空闲 Session；接续说明和 `anomalies/list` 都有这条锚点，`pickedUpBy` 是 Run2。
  - 所以 K L8 的退路（另建接续 Session）对仍负责被中断任务的 RUN-19、RUN-23 Work 线走不到，维护先归档了。暂停中重启、由人点继续的线照旧走 L8（同文件“LA-1 and contract (e)（closing unsupported）”一例）。
  - 没有采用的做法：维护对“关闭确定失败、仍负责被中断任务”的线零写入，等 Workflow 的退路接着做。它改 K L7 的“一字不改”，也改决定 54 的“马上归档”；用户可以改定。
- **2C-05 (3)–(5) 的造法改了（lead 2026-10-16，只改测试，期望值不变或照真值表）。** 这四例在 DSH 的沙箱里跑不了，lead 在 bwrap 下跑时失败，查下来都是测试的造法不对，产品代码不改：
  - (3)：后台的推进还在结束 X 的执行时就读 X 的卡，归档请求带的版本旧了（`revision_conflict`）。改成等那次推进结束再读。另外原来的造法测不到它要测的先后：每次推进提交一步以后都跑一页维护，Y 做完的那次推进里 Y 的负责链接就按终结关了，归档时线上已经没有开着的 Y。Codex 复核以后改成：X 停下以后，经公开路由 `sessions/link`（`active: true`，钉住当时的 Session 和链接版本）重开 Y 的负责链接，紧接着一次 `sessions/archive-line` 只选 X 放下；从回执断言先关 X（带 `archiveStep`）、再关 Y（`terminal`，更新），期望值照原样：plain、standby、`complete`，只写“已归档”（DE3）。
  - (3′)：§5 写的“归档组合先处置 X、再关那 21 条”经真实的 Workflow 造不出来：每次 `select_work` 先跑一页维护（`workflow.ts` 的维护调用、`session-maintenance.ts` 的终结关闭），做完的任务的负责链接在下一次领取时就关了，X 带 `archiveStep` 的关闭反而是 22 条里最新的，按真值表读成 DE3。改成：先归档放下 X、由维护做完，重新启用，再在 S 上做 21 个别的任务，两次维护再归档 S。最新的 21 条都是 `terminal`、X 的是第 22 条，期望值照原样：plain、standby、`incomplete`、`done_unproven`。
  - (4)：目标级的推进在 S 已归档时把放下的任务（决定 43）派给了另一条线并做完，后面归档的是那条线，显式归档被拒。另外，在 S 上做完**同一个**任务会重开同一条链接记录（上一条），`terminal` 的关闭换掉了放下的关闭，读成 DE2，这是对的。所以 §10 末尾已知错标 (1) 的“做完一个任务”指**另一个**任务。改成两个任务：第一个放下以后只由维护做完归档，第二个（`ag2b-work-2`）用 `sessionHint` 在 S 上做完，两次维护 → plain、standby、`doneEvidence: 'complete'`（DE3），另有 `attention` 为 `anomaly_pending`（AT4：放下留下的锚点还没人接，任务等派工）。
  - (5)：原来用崩溃造前任，但崩溃的前任一定是不可用，A1 只会读成 `retired`，`handed_to`（A3）走不到。改成真的换手：前任健康时停下，用 `sessions/create` 建带换手来历的后继，再经 `sessions/archive-line` 以 `transfer` 交出 → plain、standby、`handed_to`，`doneEvidence` 由交出的 `archiveStep` 读成 DE3。
- **§6 以外多出的文件**（上面三条和模块边界要求）：`src/core/agent-runtime/runtime.ts`、`agent-runtime/ports.ts`（Turn 关闭的调用方）、`sessions/session-health.ts`、`business/workflow/session-maintenance.ts`、`business/workflow/workflow.ts`（SES-19a 的调用方、复用领取）、`business/workflow/session-archive.ts`（2C-32）、`state/session-availability.ts`、`tasks/claim-service.ts`、`model/claim-contracts.ts`（复用领取）、`tasks/requeue-service.ts`（只转出重新入队窗口的读，暂停中断的任务行和它共用）。`WorkLineConversationPageV1` 定义在 `src/composition/work-line-conversation.ts`，`core-http-types.ts` 转出。
- **`NotYetV1` 用上了**：线详情消息一节的“处置”列（第 7 片的事），写 `{ availability: 'not_available', reason: 'slice_7' }`。
- **测试的例外**（§5 开头和 §7 以外，验收时接受）：
  - 2C-25 的规模夹具：5,000 个 Session 和 X、R、W 几条线经公开服务造；Z 线的 3,000 个 Run 和挑选器的记录在存储边界写（公开路径是平方级，同 2A 例外 3–4 的理由），写成今天的编解码认的形状，夹具里注明。
  - 2C-26：旧 Session 照 §5 开头在存储边界造。造数据时的领取和重新入队，用单独组装的真实服务写进 Host 的记录、用受控的时钟（Host 组合的时钟固定，而 `recordSessionCreated` 用墙上时钟，来历推导要的 `createdAt ≤ requeueAt ≤ claimedAt` 经 `platform.claims` 造不出）；被测的维护完全是 Host 的。Host 只有 SQLite，这一行不再分内存、SQLite 两遍。
  - 2C-28：各种归档状态都经真实服务造（领取、进入、暂停、中断、完成、崩溃、真实的锚点、目标控制、重新入队）；帮助函数里把节点夹具部分当作领取夹具用，重新入队的帮助函数带一个材料和消息的替身。
  - 节点详情的执行一节：结束的 Run 用真实的取消控制结束（没进入就取消），不进入 Kernel（这个夹具里重新入队的 Run 没有接续说明，进不了 Kernel）。
- **L2 跨页的环**只有代码，没有测试（L2 本身说不测）；`cycleRepresentativesByWalk` 从候选往回走 `continuation.from`，最多 32 步，读页外的记录。
- **2C-20 读不写**：经 Host 的脚本模型看到 `lines/*`、`graph/*` 的读一次模型调用都没有，Runtime 读原历史 0 次。
- **只能在 bwrap 下跑的**：`S2C-K-archive-tags-checks.test.ts`（真实检查）由 lead 合入前在 bwrap 下跑；DSH 的沙箱里它们照基线失败。
