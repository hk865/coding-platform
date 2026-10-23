# 2B 片规格：执行计数、补算、活动日历、按时间读任务状态

> **已合入（2026-10-15）。** 施工三轮，经过和验收见证据目录（已归档：`docs/refactor/reviews/evidence/orchestration-slice-2B-2026-10-15/README.md`）；冻结时的限定和实测见 §10，施工和验收中定下的读法见 §11，和正文同等有效，有冲突时以 §10、§11 为准。下面的状态说明保留作记录。

**后注（决定 64-2）：** 用户 2026-10-15 晚定查询也记活动，替代 §0.1 告知 3 的“只数执行（Run）里的工具调用；秘书回合、问一问的只读副本是查询，不计数”（这是授权变更，不是需求冲突）。由第 6 片 6A 做（[第 6 片规格](slice-6-SPEC.md) L16、R-15–R-17）：秘书的一轮、`intervention_planning`、问一问的副本、角色线探索都记 `QueryActivity`；L1 的算法不变。扩展的是：L7 加独立的 `querySince`（不改原来的 `since`）；L8 补算加查询那一支；L9 日历的范围扩成“目标或工作区”（工作区范围含没有目标的查询），每格的步骤含查询，覆盖情况另加查询一栏；L10 旁加 `readQueryActivities` 和路由 `activity/queries`；L12 的查询横条加 `activity`，问一问的副本按被问的线归属、不按查询的目标过滤。正文原样保留，只加此注。

> **状态：已冻结（lead，2026-10-15 0 点）。** 用户 2026-10-14 确认了测试入口 BE0–BE5（§5.1）。冻结前 lead 在 2A 合入后的代码上量了 §7 要量的存储读，结果和冻结时定的几处见 §10：“全部”日历远低于 2 秒，不加按天汇总的记录；`ACTIVITY_READ_RECORD_CAP` 定为 20,000；补算每批的数改到验收时量；夹具由 DSH 写；和 2C 同时施工。Codex 审了三次（最后一次复核结论“列出的几处改完就可以冻结”，已改），按决定 56 的上限不再送审。下面原来的状态说明保留作记录。

> **状态：2026-10-14 按 Codex 第三次复核改完；冻结前还要：用户确认测试入口，lead 按 §7 量两样。**
> - 同日的三轮：Codex 第三次复核（`D:/cc-lead-notes/codex2/s2b-spec.review3.md`）和 lead 的决定（下文写“第三次复核第 n 条”）；在它之前按 Codex 第二轮审查（`D:/cc-lead-notes/codex2/s2b-spec.review2.md`）和 lead 的第二轮决定改了一轮。
> - 再往前（同日）：按 Codex 第一轮审查（`D:/cc-lead-notes/codex2/s2b-spec.review1.md`，14 条）和 lead 的 14 条决定（下文写“lead 2026-10-14 第 n 条”）改了一轮；lead 又定了第 5 条（甲）和 L1 的先后，逐行审过改动部分（L1、L4–L6、L10–L14），补了 L5 的 RUN-21 进程内一路。两轮审查怎么处理的见文末 §9。下文写“第二轮第 n 条”的是 lead 2026-10-14 第二轮的决定。
> - 这一轮以前：lead 起草第二稿（子任务代笔），同日逐行审过一遍，改了四处（合入顺序、补算窗口的上界用 K 片 A 的 `readTurnBounds`、观察者重读时的取消信号、只读命令和决定 54 的测试例子）；第一稿的审阅意见 31 条，27 条照改，4 条改了做法（第 3、5、7、24 条，理由写在用到的地方）。
> - §0.1 没有要你定的行为；§5.1 的测试入口待你确认（这一轮加了 BE1r）。lead 审过、你确认入口以后，冻结前 lead 还要量一次读取的代价（§7），再冻结。
> - 代码基线：bb924854 的工作树（接线包 2、K 片 B 已合入；Codex 第三次复核对的就是它）。§0.2 的事实原先对的是 a7cafccc；第三次复核核过，接线包 2 的合入没有推翻 §0.2 的哪一条，和本片相接的只有一处：核对的提交现在带接线包 2 的 `unavailableSince` 提交位置绑定，本片加计数记录时要留着（L5、§0.4）。2A 规格已冻结、没施工；K 片 A 在施工。施工前要在“K 片 A、2A 合入以后”的基线上重核 §0.2。
> - 依据：
>   - HANDOFF 决定 17、20、25、26、30、35 · Q5、38、42、49（第 03 项）、50（第 2 片的计数口径；2A/2B/2C 的拆分）；
>   - DESIGN §1.10（L385–396）；§6 表“左栏工作线、轨道、计数”（L1120：轨道“按 Session 找执行和查询”，第 2 片）、“悬停信息卡”“时间竖条”“活动日历”（L1136、L1139、L1140）；§7；§8.2 第 2 行（L1244）；§9.2（L1331、L1352）；§9.3（L1398、L1401）；§9.4 风险 2（L1408）；附录 C 第 14、15、17 个字段（L1583–1585）和第 3、8、13 个索引（L1604、L1609、L1614）；
>   - MODEL O47、O48、O49（L695–735）、R58（L1875–1889）、`RunFact`（L186）；AMBIGUITIES AMB-46；
>   - [lead 答复页第 03 项](../model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md)（L81–91）和你的原话（[用户回复](../model/REVIEW-SLICES-2-4-6-7-USER-REPLIES.md) L112：“这个空白不能为0……日志记录才是真正要做好的……这只是一个兜底”；同页 lead 附加建议 3：“不要改成读时现算”）；
>   - 冻结原型 `docs/ui-reference/workbench-2026-10/DESIGN.md` §18.1–§18.2（L807–841：`.tl-mark` 的“已暂停”、日历、轨道、横条、悬停卡）；UI-WORKBENCH §0 L35（“暂停和中断是带标记的空隙”）和第 12 条（时间竖条）；E3-UI-ITEMS D49-03；
>   - 代码事实：§0.2，lead 逐条对过文件和行号，没跑测试，没调用模型；这一轮改动和新加的事实由子任务对过 a7cafccc 的 `src/`、`vendor/`（和 Codex 审的 `D:/cxt/s2b-spec` 只差换行符）；
>   - lead 2026-10-14 的 14 条决定（Codex 第一轮审查之后）。
> - 要 2A 先合入：本片的时间索引都用 2A 的“按顺序查找”（`lookupOrdered`，slice-2A-SPEC L1），读取用 2A 的稳定窗口（L7）。
> - 2C 草稿（`slice-2C-SPEC.md` §0.4、L15）把“改过的文件、用量、轨道上的横条”交给 2B；本片照此接下（§0.1 告知 4、L12）。

## 0. 冻结说明（lead）

### 0.1 要你定的

**为什么现在能写。** 本片的行为已经定了：
- 决定 49 第 03 项：日志先做好，补算只兜底；近期自动、远期你点；空白不能为 0。
- 决定 50 的计数口径：一次工具调用算一步；真的改了文件的操作算一次编辑；存 UTC、按你的时区显示、记在开始的那个小时；最近 14 天自动补，更早的你点。
- 决定 25（轨道的画法，只读咨询画在被问的那条线上）、决定 26 和 35 · Q5（时间竖条用已存的时间点近似）、决定 30（工作中、待命、已归档分开数）。

10-10 你逐条答的就是这些。第一稿把其中三处又写成了问题，这一稿改回按决定的读法（下面告知 1–3）。

**没有要你定的行为，只请确认 §5.1 的测试入口。**

- **需要你知道的安排（lead 按决定读的，或 lead 定的；你可以改）：**
  1. **失败了、但文件确实变了的操作，算一次编辑。** 决定 50 原话：“一次真的改了文件的操作算一次编辑：用编辑或写入工具改文件，或命令执行后确实有文件变了；失败的、什么都没改的不算。” lead 读作：看文件是不是真的变了；“失败的、什么都没改的”指失败了、也没改动文件的那种。例如命令退出码不为 0、超时或被取消，但前后快照看到文件变了，算 1 次编辑。这样改过的文件清单和编辑数对得上（L1）。
  2. **执行还在跑的时候，日历上这段时间写“进行中，结束后计入”，读日历时不现算。** DESIGN §1.10 写的是计数“在每次执行结束时”计入（L392），未算的显示“未知”和原因（L396）；lead 答复 03 的附加建议也写了“不要改成读时现算”。轨道上那根横条照样实时显示在跑。
  3. **只数执行（Run）里的工具调用。** 决定 49“新 Run 结束时保存”、DESIGN §6“活动日历”一行（L1140“执行上的每小时计数”）和附录 C 第 15 个字段（L1584）写的都是执行。秘书回合、「问一问」的只读副本是查询，不计数，横条照画（第 10 条）。独立审阅是执行，会算。
  4. **改过的文件、用量、轨道上的横条放在 2B。** 决定 50 列的 2B、2C 都没写这几样；DESIGN 分片表第 2 行有前两样，2C 草稿把横条交给 2B。它们和计数来自同一次 Kernel 读取或同一批时间索引，放在一起只读一遍。用量第 6、7、9 片和 K2 要用；改过的文件第 5 片的冲突提示和 2C 的节点详情要用。
  5. **检查项按这一轮检查开始的那个小时计。** 做完的检查，自己的开始和结束时刻存在它的检查报告里（F20）；按它分，要每项多读一次报告，而且读一个窗口时要往前多读不知道多长的一段轮次（一轮可能跑很久）。所以按轮次开始计。一轮里的检查接连跑，多数在同一个小时；跨了小时的，会记早一个小时。日历上写明“检查按轮次开始的时刻”。
  6. **时间竖条多用几个已存的时间点：检查结束（这一轮定案的时刻）、暂停和继续、异常锚点。** Q5 A 列的是执行开始和结束、检查开始、重新入队、采用计划。不用检查结束，已满足的任务会一直显示“正式检查中”；不用暂停和继续，你暂停的那段会画成“在跑”，和原型“暂停是带标记的空隙”对不上；不用异常锚点，被归档中断的任务画不出“中断，待核对”（决定 42）。“等待”“受阻”仍不准（Q5 A）。
     - 检查结束取定案的时刻，不取证据收下的时刻：检查都被中断时，一轮可以一条证据都不收就定案（F20a）。今天定案的时刻没存在轮次上，本片在轮次记录顶层加一个 `finalizedAt`（lead 2026-10-14 选甲，L14 末尾）。
  7. **已归档的线的活动照样算进日历。** 活动确实发生过；执行者的线做完满一天就归档（决定 38），不算的话上周的日历几乎是空的。这里只数活动，不数线，和决定 30 不冲突。
  8. **最近 14 天自动补算，每次 Host 启动都做；开始记录以后才结束、却没记下计数的也补，补好了照样标出来。** “最近 14 天”从现在往前算。你说补算是兜底（“理论上不需要补算，这只是一个兜底”），指的是日志没记下时的兜底：开始记录以后的执行，本该结束时就记下；结束时没记下，或记成了可以重试的“未知”（读 Kernel 失败、Kernel 读不到），Host 启动时自动补。补好以后标“补记（结束时没记下）”，算错误，不藏起来（决定 49“缺失算错误”）。更早的由你点选时间段。
  9. **按 15 分钟一格存（UTC）。** 这样 +5:30（印度）、+5:45（尼泊尔）这类时区也能准确地按本地小时显示。你在 UTC+8，看到的没有区别。
     - 所以日历和横条的时间窗，起止都要落在 UTC 的整刻上（每小时的 00、15、30、45 分，秒和毫秒为 0），别的报“不合法”（lead 2026-10-14 第 8 条）。一格存的是 15 分钟的总数，窗口切在一格中间就分不清这一格里哪几次在窗口里。现行时区的偏移都是 15 分钟的整数倍，所以本地的整点、零点都落在整刻上，界面照常按本地小时、本地日取窗口。
  10. **查询的横条也在本片：秘书回合画在秘书线上，只读咨询画在被问的那条线上（决定 25）。** 按 Session 找查询（附录 C 第 3 个索引“查询按 Session”，已有），不等第 6 片。
  11. **“全部”时间窗太大时报“范围太大”，不截断。** 一次读取有读的上限，超了报失败，界面把窗口拆小（按年读）。上限的数和要不要加“按天汇总”的记录（风险 2 的后半句），冻结前 lead 量过再定（§7）。
     - 决定队列里冲突提示要的“执行改过的文件”不设这个上限，读到底（lead 2026-10-14 第 9 条）：2A 已经定了队列不因数量多而拒绝（2A L8），它也没法按年拆。它的代价进 §7 的量法。
- **以后再问（不挡本片）：**
  1. 第 6 片给秘书回合加了工具（看、找、记、只读命令）以后，秘书回合的工具调用要不要也算步骤、日历上和执行分开显示。到时候按那时的工具再问你。
- **测试入口待你确认**（§5.1）。

### 0.2 代码事实

**先回答 DESIGN §9.4 风险 2：冻结的 Kernel 记下的东西，能不能按小时分出步骤和编辑？能。**
- 凡是 Run 上有位置记录、Kernel 记录读得到而且连续的执行，都能按“开始的时刻”分出步骤和编辑。规则是固定的，不用模型。
- 必须读原始的 `agent.event` 记录：归约后的状态里没有时间（F12）。
- 分不出来的几种情况见 F11。
- 风险 2 的后半句（“全部”时间窗要读每个执行，可能要按天汇总）：本片的读法数出来要做多少次存储读，见 F37；冻结前 lead 在基准规模上量这些存储读（§7）。量出来太慢，冻结前加按天汇总的记录；不慢就不加。

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 | 每个 Kernel 事件都带 `meta.occurredAt`，格式必须是 UTC、以 `Z` 结尾 | `vendor/coding-agent/dist/core/runtime/events/agent-events.js:12-21`；`…/core/context/types/context-types.js:19-22` |
| F2 | 每个事件都经必需的 sink 存成一条 Session 记录（`recordType: 'agent.event'`），记录的 `recordedAt` 就是事件的 `occurredAt` | `…/storage/session_event_sink/session-event-sink.js:36-48`；`…/core/ports/session_store/session-store-port.js:82-125` |
| F3 | 每次工具调用在执行前先提交 `tool.started`（只带调用本身：callId、名字、参数），提交成功才开始有副作用。Kernel 自己的工具调用数就是 `tool.started` 的个数 | `…/core/runtime/loop/runtime-runner.js:635-641`；`agent-events.js:44`；`…/core/runtime/reducer/run-state-reducer.js:137-151` |
| F4 | 结果事件四种，都带同一个 callId 和 `effects { sideEffect: none/possible/confirmed, changedPaths }`：`tool.completed`（只能是成功）、`tool.failed`（`phase` 为 `pre_execution` 或 `execution`）、`tool.cancelled`、`tool.outcome_unknown`（带 `toolName`、`effectClass`） | `agent-events.js:44-98` |
| F5 | Hook 拦下的调用只有一条 `tool.failed`（`pre_execution`），没有 `tool.started`；平台的读权限 Hook 会这样拦。强制取消时，过了排空时限还没返回结果的调用记 `tool.outcome_unknown`（`cancelled_while_running`）；返回了取消结果的记 `tool.cancelled`，带工具自己的 effects。Kernel 崩溃恢复时记 `process_interrupted`。合成结果的 effects：`effectClass` 是只读的为 `none`，其它为 `possible`、路径为空。声明了但没开始的调用（`abandoned`）没有事件 | `runtime-runner.js:585-603,643-708`；`…/core/runtime/tool-outcome-unknown.js:5-27`；`…/core/runtime/recovery/recovery-coordinator.js:119-139`；`src/core/agent-runtime/execution-driver.ts:762-775` |
| F6 | 开始以后被分派器拒绝的调用（`unknown_tool`、`invalid_arguments`、`permission_denied`、`sandbox_unavailable`、`approval_denied`）有 `tool.started`，结果 effects 是 `none`。分派器把工具处理函数返回的 effects 原样带出：处理函数返回时调用方已取消，换成 `cancelled`、保留 effects；超时了，换成 `timeout` 错误、保留 effects。处理函数抛错时：`workspace_write` 类（`edit`）报 `possible` 加它声明的路径，`process` 类（`shell`）报 `possible`、路径为空，两种的 `workspaceRevision` 都是 `null` | `…/tools/dispatcher/tool-dispatcher.js:23-118,121-171`（取消、超时 `:140-143`；抛错 `:147-169`） |
| F7 | 编辑工具成功：effects `confirmed`、路径就是这个文件，输出的 JSON 带 `oldRevision`、`newRevision`。新旧文本相同的替换不拒绝，照样 `confirmed`，两个版本相同。写进去以后确认失败报 `possible`；建好文件以后出错是“失败”，effects 却是 `confirmed`。写完以后才看到取消，返回 `cancelled`、带写入的 effects。`tool.started` 记的是真正执行的那次调用（Hook 改过的记改后的），`edit` 的参数是 `{ mode: 'replace', path, oldText, newText, expectedRevision }` 或 `{ mode: 'create', path, newText }`，`oldText` 非空；`replace` 时 `oldText` 等于 `newText`，写回去的内容就是原来的内容，不论最后结果是什么 | `…/tools/builtin/edit/edit-tool.js:9-31,47-95`（取消 `:58-59`）；`…/sandbox/workspace/workspace-sandbox.js:242-265,296-309,600-640,769-776`；`…/core/runtime/loop/runtime-runner.js:620,638` |
| F8 | 命令：进程沙箱在命令前后各拍一次工作区快照再比。有变化是 `confirmed` 加排好序的路径；HEAD 或分支变了，路径里第一个是 `.`；没变化是 `possible`、路径为空。两次快照都拍完、比完、接受了改动，effects 才带快照的版本 `workspaceRevision`（非空）。`shell` 在成功、退出码不为 0、超时、取消时都把这份 effects 原样带出，所以失败的命令也可能 `confirmed`。命令开始前就取消的是 `none`。拍快照、接受改动这些步骤意外抛错时，`shell` 走异常分支：`possible`、路径为空、`workspaceRevision: null`。这时命令可能已经跑完、文件可能已经变了（例如命令后的那次快照读工作区失败）。工具结果的 `workspaceRevision` 可以为空 | `…/sandbox/process/process-sandbox.js:143-153,233-261,355-365`；`workspace-sandbox.js:39-47,555-560`；`…/tools/builtin/shell/shell-tool.js:41-111`（异常分支 `:101-110`）；`…/core/ports/tool_executor/tool-executor-port.js:28-33` |
| F9 | 快照看不到：git 忽略的文件（`--ignored=no`）、受保护的前缀、默认忽略的 `.git` `.tooling` `node_modules` `dist` `coverage` `test-results` `.cache`。快照只比前后，同时在写的别的写者的改动也会算进这条命令。工作台的命令页关掉了快照，agent 的执行都开着 | `workspace-sandbox.js:27-35,381-480`；`src/app/workbench-tools.ts:501` |
| F10 | 平台执行开放的工具：Kernel 的 `read`、`edit`（平台的 `write` 在 Kernel 里叫 `edit`）、`shell`，读和探索工具，协作工具（图、通信、白板等）。平台工具成功时 effects 总是 `none`；但通信、白板里会写东西的工具 `effectClass` 是 `workspace_write`，它们结果未知时合成 `possible`，抛错时分派器报 `possible` | `src/core/agent-runtime/observed-model-run.ts:230-244`；`execution-driver.ts:96`；`graph-tools.ts:67,343`；`communication-tools.ts:98,391,501`；`whiteboard-tools.ts:96,450`；`tool-dispatcher.js:160-170` |
| F11 | 分不出来的：(a) Run 上没有位置记录（`executionHistory`）的旧执行——图的历史读取明确拒绝，不许去扫 Session 头；(b) Kernel 存储读不到、记录坏、位置不连续；(c) 结果未知、或读到窗口末尾还没结果的调用改没改文件；(d) F9 说的快照看不到的路径；(e) 命令走了异常分支（F8）时改没改文件 | `src/core/agent-runtime/graph-execution-history.ts:11-36`；`kernel-turn-facts.ts:28-37` |
| F12 | 归约后的 `RunState` 和 transcript 没有时间。今天算改过的文件的 `selfChangedFactsOf` 在它上面算（还限 5,000 条记录）：规则可以借，按小时分不行 | `src/core/agent-runtime/continuation-brief-assembly.ts:163-198,225-328` |
| F13 | 用量：提供方报了用量时，Kernel 记 `model.usage_recorded { requestId, delta { inputTokens, outputTokens, cachedInputTokens, costUsdMicros|null } }`。工作执行今天不存用量（“用量只在这次执行的内存里”）；查询每次请求存一行 | `agent-events.js:32`；`runtime-runner.js:454`；`execution-driver.ts:779-780`；`src/contracts/query-job.ts:351-366` |
| F14 | Kernel 用系统时钟（`new Date()`），平台调 `runCodingAgent` 时注入不了时钟：测试里 Kernel 的时刻是 `Date` 给的。场景测试的平台时钟是固定的字符串 | `runtime-runner.js:22-26,106,193-208`；`…/app/composition/composition-root.js:333-346`；`tests/scenarios/harness.ts:665` |

**其它代码事实：**

| # | 事实 | 出处 |
| --- | --- | --- |
| F15 | Run 上的位置记录 `RunExecutionHistoryV1` 带领取它的 Session（`sessionRef`）、Kernel 身份（`adapterId`、`kernelSessionId`、`runId`、`turnId`）、起点、观察到的位置、终点（可空）。没有它表示“没建索引”，不表示“没执行”。`RunSnapshot` 自己没有 Session 字段，也没有计数、用量、改过的文件。没进入 Kernel 的执行，领取它的 Session 只在派工记录上（`DispatchOutboxEntry.claim.sessionRef`，键是 `{projectId, goalId, taskId, attemptId}`），旧执行上这条记录可能没有 | `src/contracts/core/execution-history.ts:7-15`；`src/contracts/dispatch.ts:203-257`；`src/contracts/task-failure.ts:132-133`；`src/core/work-graph/tasks/claim-record-codecs.ts:197`；`src/core/work-graph/communication/decision-service.ts:319-332` |
| F16 | 读窗口、解码、只取本 Turn 事件的现成函数：`decodeKernelEntry`、`reduceTurnFromStart`、`applyTurnEvents`（跳过别的 Turn 的事件）。观察者和核对各有一份分页读：每页 200 条，最多 64 页，超出报 `capacity` | `kernel-turn-facts.ts:28-72`；`src/core/agent-runtime/execution-observation.ts:49,496-528`；`src/core/agent-runtime/run-reconcile.ts:62-64,85-112` |
| F17 | 观察者缓存归约后的状态和读到的位置（`CachedTurn`），以后只读尾部。归约缓存在判断终态以前就推进到读到的最后一条，含终态那一条（`:556`）。已知的结束（RUN-07）经一次 `recordRunResult` 原子提交：要提交的内容（边界、请求号、事件的 id 和时刻）先存在 `pendingTerminals`，重试原样再用；下一次观察读不到新记录时，靠这里存的边界接着提交（`:644-651`）。**只有 RUN-07 这样存。** 结果未知的结束（RUN-08）经 `recordUnknownEnd`：每次调用都重读执行，用 `deps.newId()`、`deps.now()` 新造事件，什么都不存；重试靠缓存里的终态状态再走一遍（`:600-606`）。L6 给 RUN-08 加一份同样的待提交项（lead 2026-10-14 第 3 条） | `execution-observation.ts:60-70,556,600-606,640-694,720-739` |
| F18 | 其它结束路径：启动核对读窗口后，Kernel 有终态的经 `recordRunResult`（RUN-17/18；迟到证据 RUN-21），其余经 `reconcileRun`（RUN-19/24、RUN-20、RUN-23；RUN-16 不结束 Run）。进程内的 RUN-23 是 `stopPausedRunInProcess`，同样先读窗口。没进入就取消的 RUN-09 有两条路：进程内 `submitControl`；启动核对第 5 步的 `reconcileRunControls`（CTL-08(a)，RUN-09 (R)）。RUN-22 是人的认定 | `run-reconcile.ts:1-21,261-373,384-414,553-580`；`src/core/work-graph/tasks/run-reconcile-contracts.ts:42-97`；`src/core/work-graph/model/execution-entry-contracts.ts:54-83`；STATE-MACHINES-SPEC RUN-07…RUN-24 |
| F19 | Run 的 `startedAt`、`endedAt` 用平台时钟：进入的时刻、结束提交的时刻；启动核对补进入时用 `turn.started` 的记录时间；有几条路径 `startedAt` 为空 | `execution-driver.ts:682-685`；`src/core/work-graph/state/run-machine.ts:407-411,819-831`；`run-reconcile.ts:306` |
| F20 | 检查轮次、检查项、执行票据上没有时间字段（`RoundSnapshot`、`RoundCheckSnapshot`、`CheckExecutionTicket`）。有时间的：检查轮次在记录顶层带建立它的提交位置 `since`，`eventAt(cursor)` 读那一条事件的 `occurredAt`；**做完的检查项**，自己的开始和结束时刻（`CheckProcessObservation.startedAt/finishedAt`）存在检查报告这份材料的正文里，`RoundCheckSnapshot.reportRef` 指向它；证据有 `admittedAt`。只有开始了、还没做完的检查项没有自己的时刻 | `src/contracts/verification.ts:74-94,96-146,211-233`；`src/core/work-graph/evidence/evidence-service.ts:790-825`；`src/core/work-graph/persistence/rework-codecs.ts:53-67`；`src/core/record-store/ports.ts:181-191`；`src/contracts/evidence.ts:94-100` |
| F20a | **检查轮次定案的时刻今天按键读不到。** 定案（VR-07）只改轮次的 `status`、`outcome`、`gaps`、`evidenceRefs`，不存定案的时刻或提交位置；轮次记录登记的提交位置字段只有 `since`。定案的时刻只在同一次提交的 `VerificationRoundFinalized` 事件的 `occurredAt` 上；收下了证据时，每条证据的 `admittedAt` 也是它（同一个 `deps.now()`）。这个事件按键找不到：记录库不记“每条记录最后一次提交的位置”，事件表也没有按聚合的索引。一轮可以一条证据都不收就定案：检查都被中断或没开始时只有缺口，没有可收的证据，结果是 INCONCLUSIVE。记录库已经能把一次提交的位置绑到记录顶层的 `until` 上（会话工作链接就这样用），轮次今天只登记了 `since` | `state/verification-machine.ts:807-881,1010-1023`；`evidence/evidence-service.ts:1549-1572`；`persistence/evidence-record-codecs.ts:663-667`；`src/core/record-store/migrations.ts:18-21`；`record-store/commit-extensions.ts:20,120-130`；`sessions/session-record-codecs.ts:901-904`；`sessions/session-responsibility-service.ts:276` |
| F21 | 时间竖条能用的已存时间：Run 的起止和结果；`TaskRequeue.requestedAt`，它的键就是“接在哪个 Run 之后”（`afterRunId`）；`PlanRevisionSnapshot.acceptedAt`；检查轮次的开始（F20）和存下的结果 `outcome`；暂停和继续（F30）；异常锚点的 `recordedAt`（F33）。检查轮次定案的时刻今天没有（F20a）。人暂停后被重启打断的判断是 `isPausedInterrupted`。归档时先写异常锚点、再请求重新入队，所以重新入队的时刻在异常锚点之后 | `src/contracts/task-requeue.ts:120-126,193`；`src/contracts/plan.ts:243-262`；`run-machine.ts:209`；`src/business/workflow/session-archive.ts:473-494,650-680` |
| F22 | 已有的索引：Run 按目标、按任务、按“工作区 + 状态”、按“工作区 + 结果”；检查轮次按主体、按任务、按状态；控制意图只按“工作区 + 状态”；计划版本没有按目标的索引。没有按时间排序的索引；RecordStore 今天只有等值的 `lookup`，按顺序查找是 2A 加的 | `src/core/work-graph/tasks/plan-readers.ts:87-91,300-315`；`src/core/work-graph/persistence/evidence-record-codecs.ts:650-681`；`src/core/work-graph/persistence/control-record-codecs.ts:564,582`；`src/core/record-store/lookup-ports.ts:25` |
| F23 | 第 5 片的“执行改过的文件”今天是桩：恒报 `not_available`、文件为空、`possiblyIncomplete: true`，注释写第 2 片只换实现、不换接口。生产组合接的就是这个桩 | `src/core/work-graph/tasks/executed-files-stub.ts:1-28`；`src/core/work-graph/model/decision-contracts.ts:55-65`；`src/composition/create-platform.ts:26,660` |
| F24 | `state-writes` 检查保护的 Run 字段是一张固定的表（状态、结果、授权、控制、核对、接续、起止时间、位置记录等），只许 `state/` 写。新的独立记录不在表里 | `tests/architecture/state-writes.test.ts:68-70` |
| F25 | 每次显式推进跑一页 Session 维护；Host 启动时跑启动核对和重驱。一次执行的工具调用和模型请求上限：预算设了用预算的值（可设的最大值 256 次调用、128 次请求）；没设用 Kernel 的默认值 128 次调用、64 次请求 | `src/business/workflow/workflow.ts:1890-1910`；`src/contracts/runtime-budget.ts:19,33`；`observed-model-run.ts:250`；`vendor/coding-agent/dist/app/composition/app-config.js:47-48` |
| F26 | 观察者提交结束时，Run 上存着的位置记录还没有终点（`endPosition` 为空）。观察到的位置分两种：**RUN-07** 那一次不推进位置记录，`observedThroughPosition` 只到最后一次非终态的推进，甚至只是进入时写的 `turn.started` 位置；**RUN-08** 先用 `advanceLocator` 推进到 `reducedThrough`（含终态那一条），再记未知的结束，结束时写的位置记录 `observedThroughPosition` 就是终态的位置，`endPosition` 仍为空。终态的位置只在正要提交的那份输入里：RUN-07 是 `submission.endPosition`，RUN-08 是传给 `recordUnknownEnd` 的 `endPosition`。L6 照样由调用的一方给明确的窗口，不读位置记录 | `execution-observation.ts:576,600,606,645-658,720-733,744-761`；`execution-driver.ts:674-677` |
| F27 | 从 Running 核对出来的结束（RUN-19/20/23/24，进程内或重启时）不写位置记录：`enteredFactsOf` 在 `fromEntering` 为假时 `history: null`，所以 Run 上的 `endPosition` 一直为空，观察到的位置可能停在崩溃前。读到哪儿记在核对记录上：`interrupted_clean` 的 `lastPosition`，`unresolved` 的 `observedThroughPosition`（RUN-08 也写这一种） | `run-machine.ts:1902-1925`；`dispatch.ts:157-196`；`run-reconcile.ts:295-299,321,333,360,373` |
| F28 | 平台 Runtime 没有加测试工具的口子：Run 选了它不认识的工具名，`selectCoordinationTools` 报 `unsupported`；内置名字固定是 `read`、`write`、`shell`；协作工具是一个封闭的集合；组合根直接 import Kernel 模块 | `execution-driver.ts:94-100,205-208`；`src/composition/create-platform.ts:4` |
| F29 | 进程沙箱的探测不收平台传的选项：`ProcessSandbox.probe(root, workspace)` 不带第三个参数，bwrap 的路径取环境变量 `CODING_AGENT_BWRAP_PATH`，没有就是 `/usr/bin/bwrap`。平台的 `processSandboxOptions` 只有 `readOnlyPaths`、`executablePath` | `…/sandbox/process/process-sandbox.js:99-104`；`composition-root.js:60`；`src/core/agent-runtime/execution-contracts.ts:134` |
| F30 | 暂停、继续是控制意图：请求时刻 `requestedAt`，生效以后 `status: 'applied'`、`observation.kind` 为 `paused` 或 `resumed`、带 `observedAt`。Run 只指向当前那一条（`controlState.intentRef`）；`Run.controlInputs` 只列插话（steer），不列暂停和继续。所以一个执行过去的暂停、继续，要按执行找控制意图，今天没有这个索引 | `src/contracts/control-intent.ts:21,43-76,83-110`；`run-machine.ts:763`；`control-record-codecs.ts:582` |
| F31 | 现行计划的 `taskStateBasis` 记的是“现在这个任务的定义归哪一版”，不是“第一次出现在哪一版”；没有这个字段时，所有任务都算现行这一版。`dispositionRecord` 每个任务只留最近一次处置变化；更早的变化留在当时那一版计划自己的 `dispositionRecord` 里 | `src/contracts/plan.ts:82-131` |
| F32 | 查询：`QueryRun` 有 `startedAt`、`endedAt`，执行它的 Session 在 `run.executionState.sessionRef`；属于哪个目标在 `QueryJob.goalId`（可空）。只读咨询副本是 `provenance.kind: 'readonly_copy'`、`from` 指向被问的 Session 的 Session。已有索引：Session 按来历（`provenance.from.sessionId`）、查询按 Session。一个 Session 同一时刻最多被一个执行或查询占着（`occupancy.executionRef`） | `src/contracts/query-job.ts:58-82,290,375-376`；`src/contracts/core/session.ts:25-31,43-55`；`src/contracts/core/identity.ts:43`；`src/core/work-graph/model/session-facts-contracts.ts:27-47` |
| F33 | 异常锚点：一个执行一条，带任务、执行、`cause`（被归档中断 / 退役后归档）、`recordedAt`；已有按任务、按目标的索引 | `src/contracts/session-anomaly.ts:11-30`；`session-facts-contracts.ts:30-31,46-49` |
| F34 | 生产可达检查：`src/` 里生产路径到不了的代码要列进允许表，只给测试用的代码应该放 `tests/`。新路由的 Body/Response 类型别名要在允许表里登记成 `wire-format`。组合测试断言平台对象可枚举的键是一张固定的表；第 1、3、5 片新加的路由拥有者都设成不可枚举 | `tests/architecture/production-reach.test.ts:1-22`；`tests/architecture/production-reach-allowlist.json:784-842`；`tests/composition/platform.test.ts:56`；`create-platform.ts:1441-1455` |
| F35 | 没有实例租约的 Host 保留读和拥有者的写，但进 Kernel 或开执行的入口、人的认定都报 `busy`（`leaseGated`）。RUN-22 的“操作者”是任何非自动化的 Host 身份（`reworkActorClassOf` 得 `human`），包括用 `kind:'system'` 身份启动的 Host | `src/app/host.ts:1125-1143`；`src/contracts/task-requeue.ts:75`；`dispatch.ts:186-193` |
| F36 | 场景测试的预算 `AG2B_RUNTIME_BUDGET`：`timeoutMs: 60000`、`maxToolCalls: 16`、`maxRequests: 16`。Kernel 用时钟算已过的时间，和 `deadlineMs` 比：把 `Date` 拨几个小时，执行会以 `limit_exceeded` 结束。平台也有直接 `new Date()` 的地方 | `tests/helpers/AG2b-collaboration-fixture.ts:84-87`；`…/core/runtime/limits/limit-guard.js:51-56`；`runtime-runner.js:190-191`；`src/core/work-graph/sessions/session-lifecycle.ts:321,549`；`session-directory.ts:858`；`src/app/host.ts:362` |

**F37 读法的代价（按 L9–L13 的读法数出来的存储读次数；冻结前在基准规模上量过，结果见 §10“冻结前的实测”）：**

| 读取 | 基准（DESIGN §9.3 L1398 的 50,000 个执行；一个目标 2,000 个执行、1,000 轮检查、600 个任务是 lead 定的量法） | 次数（约） |
| --- | --- | --- |
| 日历“全部” | `RunActivity` 索引 2,000 行；结束的执行索引 2,000 行 + 每个按键读一次 `RunActivity` 2,000；还在跑的（开着的工作）；检查轮次 1,000 行 + `eventAt` 1,000 | 8,000 + 开着的 |
| 日历“今天” | 只读今天结束的执行和今天以后建的轮次 | 和当天的工作量成正比 |
| 日历、横条读一个很早的窄窗口（例如 300 天前的一天） | 结束的执行、`RunActivity`、定案的轮次都是从窗口开始往后读到底再筛（L9 第 1、2、4 步；L12 第 1、3 步），轮次的 `eventAt` 也是每轮一次 | 和窗口开始以后的全部历史成正比，不和窗口长度成正比 |
| 横条“全部” | 同日历，再加：定案的轮次索引 1,000 行 + 开始的 `eventAt`；每页按任务读一次执行（画连线，L12）；每个执行的控制意图 | 12,000 左右 |
| 一个任务很多次尝试（例如 200 次） | 时间竖条、横条每页每个任务的执行只读一次，在内存里排前后（L11、L12），不按执行重读 | 和这个任务的执行数成正比 |
| 时间竖条一页（200 个任务） | 计划各版；每个任务的执行、检查轮次、异常锚点；每个执行的重新入队、控制意图；每轮一次 `eventAt` | 和这 200 个任务的执行、轮次数成正比 |
| 冲突提示读一个目标（不受读上限，L13） | 执行 2,000 行；`RunActivity` 2,000 行（每条最多 1,000 个路径） | 4,000 行，路径最多 200 万个 |
| 决定队列的冲突提示（工作区里所有目标，2A L3） | 每个目标照上一行读一遍；路径在内存里按模块归（`mapExecutedFilesToModules`），两两比 | 工作区全部执行数 × 2 行，加上全部路径的归类和比较 |

### 0.3 lead 定的技术选择

**总的做法：** 计数在执行结束时从 Kernel 的原始记录算好，在结束执行的同一次提交里存成一条独立记录；旧的、结束时没记下的，由补算写同一种记录；日历、横条、时间竖条都只读这些记录和已有的时间点，读的时候不写、不算 Kernel。

- **L1 计数口径。**【lead 定，待审】
  - 一步 = 这次执行的 Kernel Turn 里的一条 `tool.started`（决定 50“一次工具调用算一步”）。和 Kernel 自己的调用数、预算的 `maxToolCalls` 是同一个数（F3）。
  - **只有能改文件的工具算编辑：** Kernel 名字是 `edit`、`shell` 的调用（平台的 `write` 在 Kernel 里记成 `edit`）。按名字认，因为 `tool.started` 不带 `effectClass`（F3），而通信、白板的写工具 `effectClass` 也是 `workspace_write`，结果未知时会合成 `possible`（F10），它们改不了文件。其它工具（读、探索、平台的协作工具、K 片 B 部分的只读命令）不论结果、不论 effects，编辑 0、未知编辑 0、不进改过的文件。
  - `edit`、`shell` 的每一次调用（窗口里有它的 `tool.started`），按下表**从上往下第一条命中的**定它的编辑状态（lead 2026-10-14 第 1、2 条）。“结果”指同一个 callId 的 `tool.completed`、`tool.failed`（`execution`）、`tool.cancelled`，effects 取结果里的：

    | 顺序 | 情况 | 步骤 | 编辑 | 未知编辑 | 依据 |
    | --- | --- | --- | --- | --- | --- |
    | 1 | `edit`，`tool.started` 的参数证明新旧文本相同：`mode` 是 `'replace'`，`oldText`、`newText` 都是文字而且相等。不论结果是什么：成功、失败（含超时）、取消、`tool.outcome_unknown`，还是到窗口末尾没结果 | 1 | 0 | 0 | 写回去的就是原来的内容，什么都不可能变（lead 2026-10-14 定的先后）；F7 |
    | 2 | `tool.outcome_unknown`。它合成的 effects（`possible`、路径为空）不看 | 1 | 0 | 1 | 结果不知道就是未知（lead 第 2 条）；F5 |
    | 3 | 读到窗口末尾还没有结果 | 1 | 0 | 1 | 同上 |
    | 4 | `edit`，结果是 `tool.completed`，输出里那份 JSON 的 `oldRevision`、`newRevision` 都是文字而且相等。只有有结果时才有这份输出 | 1 | 0 | 0 | “什么都没改的不算”（lead 第 1 条）；F7 |
    | 5 | effects `confirmed`，`changedPaths` 里有 `.` 以外的路径 | 1 | 1 | 0 | 决定 50；§0.1 告知 1 |
    | 6 | effects `confirmed`，`changedPaths` 只有 `.`（只有 HEAD 或分支变了） | 1 | 0 | 0 | 同第 4 行；F8 |
    | 7 | effects `possible`，`changedPaths` 不为空（写了但确认不了；处理函数抛错） | 1 | 0 | 1 | 未知不是 0；F6、F7 |
    | 8 | `shell`，effects `possible`，`changedPaths` 为空，`workspaceRevision` 不为空：命令前后两次快照都拍完、比完，没看到变化 | 1 | 0 | 0 | 同第 4 行；看不到的路径见 F9 |
    | 9 | effects `possible`，`changedPaths` 为空，其余情况（`workspaceRevision` 为空：`shell` 的异常分支，例如命令后的快照读工作区失败；分派器在处理函数抛错时给的） | 1 | 0 | 1 | 比较没做完，空路径证明不了没改（lead 第 2 条）；F6、F8 |
    | 10 | effects `none`（含开始后被分派器拒绝的，F6） | 1 | 0 | 0 | Kernel 也算它一次调用 |

    - 没开始的不进表：Hook 拦下（只有一条 `tool.failed`，`pre_execution`，没有 `tool.started`）、声明了没开始（`abandoned`，没有事件），步骤、编辑、未知编辑都是 0。
    - 第 1 行在最前（lead 2026-10-14 定的先后）：参数已经证明这次调用写回去的就是原来的内容，结果是什么、知不知道，都不可能改了文件，所以编辑 0、未知编辑 0，路径也不进改过的文件。取消、超时的结果里没有版本号，effects 却是 `confirmed`（F6、F7），也靠这一行。第 4 行（输出证明的）只在有结果时才有；真实的 `edit` 里它和第 1 行同时成立（F7），留着是为了不靠参数也认得出。
    - 第 2 条决定的“`tool.outcome_unknown` 一律算未知编辑”管的是第 1 行以外的调用。
  - 一次命令改了 10 个文件，算 1 次编辑（“一次操作”）。
  - 另数一个 `unresolvedCalls`：窗口里有 `tool.started`、到窗口末尾没有结果事件，或结果是 `tool.outcome_unknown` 的调用个数，任何工具都算，L1 第 1 行的 `edit` 也算（和 `unresolvedToolCallIds` 对同一个窗口给的个数相同，`kernel-turn-facts.ts:74-92`）。它说的是 Turn 有没有算完，不是编辑。L4 用它判断这条计数是不是算完了。
  - 只看本 Turn 的事件：`meta.runId`、`meta.turnId` 等于 Run 绑定的 Kernel 身份，位置在 `turn.started` 之后、窗口上界之内（同 `applyTurnEvents`）。
- **L2 时间。**【lead 定，待审】
  - 一次调用记在它的 `tool.started` 的 `meta.occurredAt` 那一格；它的编辑、未知编辑跟着记在同一格，不看结果什么时候到（决定 50“记在它开始的那个小时”）。
  - 一格 = UTC 的 15 分钟（`:00`、`:15`、`:30`、`:45`），记这一格的开始时刻（ISO，`Z` 结尾）。只存有活动的格。
  - 读的时候按请求带的时区（IANA 名字）把格并成本地小时或本地日。现行时区的偏移都是 15 分钟的整数倍，所以本地小时是准的；夏令时那天 23 或 25 小时也准（§0.1 告知 9）。
  - 一个执行最多存 1,000 格；更多的并成 `overflow`（只有总数和起止时刻），读的时候算进“时间不明”。按今天的上限（一次执行最多 256 次调用，F25）到不了。这是可配置的上限，不是实测的性能数字。
- **L3 改过的文件和用量（附录 C 第 14、17 个）。**【lead 定，待审】
  - 和计数同一次读取、同一个函数里收集。只看 `edit`、`shell`（L1）。
  - 改过的文件（按 L1 的表，一次调用只进一种）：
    - `definite`：L1 第 5 行那些调用的 effects 路径，去掉 `.`。失败、取消但 `confirmed` 的也在这里（§0.1 告知 1）。L1 第 1、4 行（能证明什么都没改的 `edit`）的路径不进任何一边，取消、超时、结果未知、没结果的也一样。
    - `possible`：L1 第 7 行的 effects 路径；第 2、3 行里 `edit` 调用的参数请求的那个 `path`（同 `selfChangedFactsOf`，F12）。
    - `possiblyIncomplete` 为真时写明原因：跑过 `shell`（`command_ran`：快照看不到 F9 的路径，也分不出别的写者）、有未知编辑的调用（`edits_unknown`：L1 第 2、3、7、9 行）、超过上限（`cap`）。
    - 各最多 500 条，按字节序，另给略去的条数。
  - 用量：每个 `model.request_started` 一条：`requestId`、开始时刻、它的 `model.usage_recorded` 增量之和（输入、输出、命中缓存的 token；费用可空）。没有用量事件的请求标 `unknown`、token 为空，总数标“不全”，不当 0。最多 256 条，另给略去数。字段和查询的 `QueryModelUsageV1` 对得上（F13）。
- **L4 存在哪：一条独立的 `RunActivity` 记录，不加 Run 字段。**【lead 定，待审】
  - 一个执行一条，键由 `RunRef` 定：`{ aggregateType: 'RunActivity', projectId, goalId, runId }`。放在 WorkGraph `tasks`（DESIGN §7.2“执行改过的文件、每小时计数、用量：tasks”）。
  - 不加 Run 字段的理由：
    - 补算要写已经结束的执行；写 Run 会让 Run 的版本号变，和迟到的控制回执、核对按 Run 版本做的检查抢；
    - 计数不是执行状态，不该经状态机（决定 20），也不用进 `state-writes` 的保护表（F24）；
    - Run 记录不变，旧测试少动。
  - 内容：`runRef`、`taskId`、`workspaceId`、`sessionRef`（领取它的 Session，取法见 L17；旧执行可能为 `null`）、`runEndedAt`（执行的 `endedAt`，写的时候抄下，读的时候不用再读执行）、`recordedBy`（`run_end` 或 `backfill`）、`recordedAt`、`facts`（`counted` 或 `unknown`，含规则版本）、`span`（`firstAt`、`lastAt`、`basis`）。
    - `counted`：`firstAt` 是 `turn.started` 记录的时刻，`lastAt` 是窗口里最后一条本 Turn 记录的时刻；两个都不为空，没有工具调用也一样；`basis: 'kernel'`。`facts.window` 另记两样：`turnTerminal`（窗口里归约出的本 Turn 已经是终态，同 `run-reconcile.ts` 的 `TERMINAL_STATUSES`，K 片 A 以后含 `interrupted`）、`unresolvedCalls`（L1 末尾）。
    - `unknown`：用平台的 `startedAt`、`endedAt`，`basis: 'run_times'`；`startedAt` 为空时 `firstAt` 为 `null`（读的时候算“时间不明”）。
    - 所以 `lastAt` 总是文字，每条记录都是 L14 按顺序索引的候选（2A L1：排序值为空的行不是候选）。
  - **已经有一条记录时怎么办**，按下表从上往下第一条命中的（lead 2026-10-14 第 4 条）。“旧的”是已有的记录，“新的”是这次要写的 `facts`：

    | 顺序 | 情况 | 结果 |
    | --- | --- | --- |
    | 1 | 还没有记录 | 建（`created`） |
    | 2 | 旧的规则版本比现在旧 | 换（`replaced`） |
    | 3 | 旧的是 `counted`；这次是 RUN-21 的结束提交；新的是 `counted`、`turnTerminal` 为真、`throughPosition` 比旧的大；旧的没算完：`turnTerminal` 为假，或 `unresolvedCalls` 大于 0 | 在同一次提交里换，`recordedBy: 'run_end'` |
    | 4 | 旧的是 `counted`，其余 | 不动（`unchanged`）。补算从不换它；同一个算完的窗口不重算；`unknown` 不盖 `counted` |
    | 5 | 旧的是 `unknown`，新的是 `counted` | 换 |
    | 6 | 旧的是 `unknown`，新的是原因不同的 `unknown` | 换 |
    | 7 | 旧的是 `unknown`，新的是原因相同的 `unknown` | 不动，不写 |

    - 第 3 行为什么要有：RUN-20(i)、RUN-08 结束时有调用没结果，那时算出来的是 `counted`，但带着没结果的调用（F27、L5）；RUN-21 要求迟到的证据把这些调用都定了，终态位置在原来的窗口之后（`run-machine.ts:2228-2264`）。不换的话，改过的文件、用量、最后那段活动永远缺一块。
    - 重复补算、重启、结束提交的重试都落在第 4、7 行，不会多算。
- **L5 什么时候写：结束执行的同一次提交。**【lead 定，待审】
  - 你说“日志记录才是真正要做好的”，所以正常路径不靠补算：Runtime 先读整个 Turn 算好 `facts`，放进结束提交的输入；WorkGraph 在同一次提交里建这条记录。结束提交不多一个账本事件。
  - 算不出来（读不到、记录坏）不挡结束：照样结束，记录写 `unknown` 和原因。
  - 带了 `activity` 的结束提交，把它算进这次提交的指纹：`recordRunResult` 在 `execution-entry-service.ts:1839-1849` 那张字段表里照 `basis`、`enteredAt` 那几项的写法加一项（带了才加），`reconcileRun` 同样；不带的照今天，旧调用的指纹不变。所以同一个请求号带两份不同的计数会报 `idempotency_conflict`，L6 第 3 步的“只挂一次”就是为了不撞上它。
  - `reconcileRun` 的提交（`run-reconcile-service.ts` 的 `commitDecided`）在接线包 2 以后带 `unavailableSince` 的提交位置绑定（`sessionCursorBindings(written)`，`:415-418`）。本片把 `RunActivity` 加进同一个提交的 `written` 时，这些绑定照今天从 `written` 里的 Session 记录算出、原样带上；`RunActivity` 没有要绑的提交位置字段，加进来不能让这些绑定丢掉（第三次复核第 4 条；§0.4）。
  - 各结束方式（STATE-MACHINES-SPEC 的 RUN 表）：

    | 行 | 谁写结束 | 计数 |
    | --- | --- | --- |
    | RUN-07 | 观察者 → `recordRunResult` | 窗口 `[locator.startPosition, submission.endPosition]`（L6） |
    | RUN-08 | 观察者的待提交未知结束项（L6）→ `recordUnknownEnd` → `recordRunResult` | 窗口 `[locator.startPosition, 这一项的 endPosition]`；`counted`、`turnTerminal` 为真，没结果的调用记进 `unresolvedCalls`，其中 `edit`、`shell` 记未知编辑 |
    | RUN-17、RUN-18 | 启动核对 → `recordRunResult` | 用核对已读的窗口算 |
    | RUN-19、RUN-24 | 启动核对 → `reconcileRun(interrupted_clean)` | 同上，到核对读到的最后一条为止 |
    | RUN-20 (i)、(iii) | 启动核对 → `reconcileRun(unknown)` | 同上 |
    | RUN-20 (ii) | 同上，探测说 Kernel 读不到 | `unknown('kernel_unreadable')` |
    | RUN-23（进程内） | `stopPausedRunInProcess` → `reconcileRun(paused_stop)` | 用它已读的窗口算 |
    | RUN-23（重启时） | 启动核对 | 用已读的窗口算 |
    | RUN-09 | `submitControl`，没进入 Kernel | 不写记录；读的时候算“没进入，0”（L7） |
    | RUN-09 (R) | 启动核对第 5 步 `reconcileRunControls`（CTL-08(a)），没进入 Kernel | 同上 |
    | RUN-21 | 读到迟到证据 → `recordRunResult`：启动核对，或进程内的核对（依据 `live_clean`，`run-reconcile.ts:18、211、248`，`runtime.ts:187`）；两条路用同一个核对函数、读同一个窗口（lead 2026-10-14 补） | 用核对已读的窗口算（到 Turn 的终态）。原记录是 `unknown`，在同一次提交里换成新算的（`recordedBy: 'run_end'`）；原来是没算完的 `counted`，按 L4 第 3 行换；原来是算完的 `counted`、或同一个窗口，不动（L4 第 4 行） |
    | RUN-22 | 人的认定 | 不动记录 |
    | RUN-16 | 不结束 Run | 不写；输入里带了计数报 `invalid` |

  - K 片 A 以后，Kernel 的 `run.interrupted` 只是对已结束执行的收尾，不带工具事件，不改计数。
  - 以后加的结束方式（K3、重启后自动收尾那一小片）照这张表补一行。
- **L6 怎么数：一个纯函数，一个读窗口的函数。**【lead 定，待审】
  - 纯函数 `tallyTurnActivity`：输入一个 Turn 的已解码记录、Kernel 身份和窗口，输出 `RunActivityFactsV1`。同样的记录得同样的结果，不调用模型（决定 49 的确定规则；lead 答复 03）。
  - 读窗口的函数 `readRunActivityFacts`：**由调用的一方给明确的窗口** `{ kernel, fromPosition, through }`，不读 Run 上存着的位置记录（F26、F27）。`through` 是一个位置加它的来历（`end_position`、`turn_bounds`、`reconcile_observation`），或者 `'kernel_tail'`：读到 Kernel 现在的最后一条，按 Turn 身份过滤。`turnTerminal` 一律按 L4 的定义看窗口里归约出的状态，不看用了哪种上界。每页 200 条，最多 64 页（`RUN_ACTIVITY_MAX_PAGES`；测试里可以注入，同 L17 的读上限），逐条解码，位置要连续（同 F16）。
    - 先探测（`owner.probe`）时：`missing`、`damaged` → `unknown('kernel_unreadable')`；`transient`、`host_config`、`cancelled` → `retry_later`（不写）。
    - 读被拒、码是 `unavailable` 或 `cancelled` → `retry_later`（同 `continuation-brief-assembly.ts:179-181`）；别的读失败 → `unknown('history_read_failed')`；超出页数 → `unknown('capacity')`；记录坏或不连续 → `unknown('history_damaged')`；找不到这个身份的 `turn.started` → `unknown('turn_not_found')`。
    - 没有位置记录：`unknown('no_history_locator')`。不扫 Session 头，也不用 `readTurnBounds` 去找（F11）。
  - **观察者**：它只缓存归约后的状态和尾部（F17），没有时间。提交结束之前，用 `readRunActivityFacts` 把整个 Turn 重读一遍，不探测。窗口：
    - RUN-07：`fromPosition = locator.startPosition`，`through` 是 `submission.endPosition`（`end_position`，放进 `submission` 的同一个数）；
    - RUN-08：`through` 是待提交未知结束项的 `endPosition`（`end_position`）。
    - 这次观察本来就从 Turn 开头读起时（缓存为空），直接用已读的记录算，不重读，下面第 3 步就没有能被取消的读。
  - **观察者的先后（lead 2026-10-14 第 3 条）。** 原则：先把这次结束的边界存好，再做能被取消的事；算出来的计数挂到存好的那一项上，只挂一次，以后每次重试都提交同一份输入，指纹不变。
    1. 照今天读尾部、归约，再推进归约缓存（`execution-observation.ts:556`）。推进以后，下一次观察读不到这次已读的记录了（F17），所以第 2 步必须在任何能被取消的读之前做完。
    2. 判断出终态以后，先存待提交项，再做第 3 步：
       - RUN-07：照今天在 `:644-676` 建或沿用 `pendingTerminals` 的那一项（边界、游标、请求号、事件的 id 和时刻）。**从推进归约缓存（`:556`）到存好这一项，中间不 await**：今天这一段没有 await，保持这样。这条“不 await”只管 RUN-07（第二轮第 8 条）。
       - RUN-08 是明说的例外：新加 `pendingUnknownEnds`，键同 `pendingTerminals`。在今天调 `recordUnknownEnd` 的条件下（`:605`）：已有一项、`endPosition` 相同，原样沿用；没有或不同，先读一次执行（照今天 `:720-726`，已结束就不提交；这是一次 await），再造事件（`deps.newId()`、`deps.now()`、`lastEventSeq + 1`），连同 `endPosition`、请求号 `b2-result-unknown:…`、`history`、`unresolvedToolCallIds`、`claim`、`entry` 存进这一项。这次读执行可以被取消，取消了也能恢复：什么都没存，下一次观察即使读不到新记录，也靠缓存里的终态状态照样走到这里（`:600-606`，F17），不会卡住。所以 RUN-08 不要求“推进缓存到存好这一项之间不 await”，只要求重读整个 Turn（第 3 步）在存好这一项之后。
       - 观察到执行已结束（`:470-473`）、回到非终态（`:570`），两种待提交项一起删；进了 RUN-07 的分支，删掉 RUN-08 那一项。
    3. 这一项上还没有 `activity` 时才重读整个 Turn：RUN-07 在 `:686` 的证明闸门之后、`recordRunResult` 之前；RUN-08 在建好（或沿用）这一项之后、提交之前。读用这次观察的 `signal`（`observe` 调用方的）。
       - 读成了：把 `facts` 挂到这一项上。
       - 读本身失败（含 `retry_later` 的那两种码）：把 `unknown('history_read_failed')` 挂上，结束照常；Host 启动时的自动补算会再试（L8）。
       - `signal` 已取消：什么都不挂，不提交，`observe` 报 `cancelled`，不写 `unknown`。
         - **RUN-08 这里是有意改的行为**（lead 2026-10-14 接受）：今天 RUN-08 这条路不论 `recordUnknownEnd` 成没成都报 `ready`（`execution-observation.ts:605-614`）。改成报 `cancelled`，因为这时结束确实没提交，报 `ready` 会让调用方以为这次观察做完了；和 RUN-07 取消时一样，调用方据此知道要再观察一次。没找到钉住今天 `ready` 的旧测试：`R4-control-runtime.test.ts:239`、`A2-reconcile-runtime.test.ts:296-318,558`、`B2-runtime-execution.test.ts` 里的 `observeRun` 都不在 RUN-08 这条路上取消观察的 `signal`。
         - 待提交项留着；下一次观察哪怕 Kernel 没有新记录，也照 `:644-651`（RUN-07）或第 2 步（RUN-08）找到它，接着重读。（取消的规矩 lead 审，2026-10-14）
       - 挂上以后不再改。第一次挂上的是 `unknown`，以后的重试也提交 `unknown`，由补算去补；不因为后来读得到了就换成 `counted`，换了就是同一个请求号两份内容。
    4. 提交：`input` 用这一项上的原样（含 `activity`）；`meta.expected` 照今天按读到的执行版本给（RUN-07 今天也是这样）。提交成功，删掉这一项。
  - **启动核对和 `stopPausedRunInProcess`** 已经读了窗口（`run-reconcile.ts:276,566`），直接用 `read.decoded` 算，窗口是 `[turn.started 的位置, 读到的最后一条]`（`reconcile_observation`；有 Kernel 终态的 RUN-17、RUN-18、RUN-21 是 `end_position`），不再读。
  - **补算**（`countRunActivity`）先探测，窗口这样定：
    - `fromPosition`：位置记录的 `startPosition`；
    - `through`，按顺序取第一个有的：
      1. 位置记录的 `endPosition`（`end_position`）；
      2. K 片 A 的 `readTurnBounds`（按位置记录上的 `kernelSessionId`、`runId` 找）：`found` 且 `endPosition` 不为空，用它（`turn_bounds`）；
      3. 核对记录上的位置：`interrupted_clean` 的 `lastPosition`，`unresolved` 的 `observedThroughPosition`（`reconcile_observation`）；
      4. `readTurnBounds` 是 `found` 但还没结束：`'kernel_tail'`。还没结束的 Turn 就是 Session 头上的活动 Run（K 片 A L2 第 5 行），后面不会有别的 Turn。
      - `readTurnBounds` 是 `not_found` → `unknown('turn_not_found')`；`unreadable` → `unknown('kernel_unreadable')`。
    - 不用位置记录上的 `observedThroughPosition`：从 Running 核对出来的结束不更新它（F27），按它读会把尾巴截掉，少算了还当成完整的数。
    - `readTurnBounds` 排在核对记录前面（这一轮改的）：它给的是 Turn 真正的终点。核对记录可能没有（RUN-22 的认定会换掉原来的 `unresolved` 观察），也可能停在 Turn 以后又长出的记录之前（RUN-20 时旧进程没证明已退出）。决定 54 的线（暂停着被重启打断，你点继续以后 K 片 A 追加 `run.interrupted` 关掉它）在这里取到的就是 `run.interrupted` 的位置。
    - 为什么不直接读到尾（lead 审，2026-10-14）：决定 54 以后，暂停着被重启打断的线会在同一个 Session 里接着做（K 片 A 先关掉悬着的 Turn）；决定 51 认定以后的线也一样。那样 Session 后面接着别的 Turn，读到尾会把后来的记录也读进来，算进页数，容易超上限变成 `capacity`。K 片 A 在 2B 之前合入，这个函数已经有了。
- **L7 开始记录的时刻和“缺失算错误”。**【lead 定，待审】
  - 每个工作区一条 `ActivityRecording` 记录，只有 `since`（开始记录的时刻）。
  - Host 拿到实例租约以后、跑启动核对之前，为它服务的每个工作区确保有这条记录（没有就建，`since = now`）；经 Host 新登记的工作区也一样。没有租约不写（A8 的“没有租约的 Host 什么都不写”）。不经 Host 的平台模式不建这条记录，读的时候是 `no_recording_epoch`。
  - 读的时候，一个已结束的执行这样分：
    - **有 `counted` 记录，`recordedBy: 'run_end'`，或 `runEndedAt < since`：** 正常。
    - **有 `counted` 记录，`recordedBy: 'backfill'`，`runEndedAt ≥ since`：** 数照常计入，另标 `recorded_late`、`error: true`，显示“补记（结束时没记下）”。决定 49 的“缺失算错误”补好以后也看得见。
    - **有 `unknown` 记录：** 未知和原因。
    - **没有记录，没进入过 Kernel，算 0：** 没有位置记录，并且 V2 授权是 `authorized` 或 `revoked`；或者没有任何授权、`endedAt ≥ since`（只可能是 RUN-09 从 `Claimed` 结束）。没有时间格。
    - **没有记录，`not_recorded`，错误：** `endedAt ≥ since`。显示“未知：计数缺失（错误）”；下次 Host 启动的自动补算会补（两周以内），人点补算也能补。
    - **没有记录，`not_backfilled`：** `endedAt < since`。“未知：旧记录，待补算”。
    - **`no_recording_epoch`：** 这个工作区还没有 `ActivityRecording`。
  - 打开日历从不补算（lead 答复 03：“不能长期靠打开日历时补救”）。
- **L8 补算。**【lead 定，待审】
  - 共同的：
    - 用 L6 同一个函数，写 `recordRunActivity`（建，或按 L4 替换）；
    - 不调用模型；不改 Run、Task、Attempt 的任何字段（决定 20）；
    - 补算从不换当前规则的 `counted`（L4 第 4 行；lead 2026-10-14 第 4 条）：它不是候选；挑候选以后、写之前别人（例如 RUN-21 的结束提交）先写了，这次写按版本冲突，报 `skipped`、原因 `record_changed`，不覆盖，下次按新记录重新判断；
    - 一个执行一次提交，各自核对版本；
    - **`retry_later`**：探测是 `transient`、`host_config`、`cancelled`，或读被拒、码是 `unavailable`、`cancelled`。什么都不写；这一批停在这个执行，返回的游标指向它，下一次从它接着试。
  - **自动：** 每次 Host 启动核对以后在后台跑，范围是 `[now − 14 天, now)`，按 `endedAt`（决定 50 的“最近 14 天”，从现在往前算；§0.1 告知 8）。启动核对在它前面，所以同一次启动里核对按 RUN-21 记下的计数，自动补算不会再碰。
    - 候选：范围里已结束的执行，没有记录（L7 里没进入过 Kernel 的那种除外）；或记录是 `unknown`、原因是可以重试的 `history_read_failed`、`kernel_unreadable`；或规则版本旧。
    - 其它 `unknown` 原因（`no_history_locator`、`history_damaged`、`turn_not_found`、`capacity`）不自动重试：同样的记录、同样的规则，算出来还是一样，每次启动都重读 Kernel 只是白花。人点补算会重试所有 `unknown`。
    - 每次调 Workflow 的 `backfillRecentActivity` 做一批，直到做完、遇到 `retry_later` 或 Host 关闭。游标只在内存里，不存：记录本身就是进度，补好的下次不再是候选。
    - 没有要补的执行时什么都不写。所以没缺计数的工作区，Host 重启不多一个账本事件。
    - 第一次启动时 `since = now`，范围正好是“开始记录前 14 天”。第一次没补完、过了几天才重启的，掉出 14 天的那几个变成人点的范围。
  - **人点：** `activity/backfill` 路由，只有人能调：`reworkActorClassOf(principal, actor) === 'human'`（同 RUN-22，F35），所以用 `kind:'system'` 身份启动的 Host 的操作者可以，成员和平台自动化身份报 `forbidden`。没有实例租约的 Host 上报 `busy`（它要读 Kernel，加进 `leaseGated`）。
    - 请求带 `from`、`to`（按 `endedAt`）和上一次返回的游标；每次做一批，返回做了哪些、下一批的游标。候选：没有记录（没进入过 Kernel 的除外）、任何 `unknown`、规则版本旧。
    - 界面一批一批地调。停下就是中断，再调就接着。同一区间再跑一遍，已经算过的不是候选，`processed` 是空的，数不变（DESIGN §1.10“可重做”）。
  - 每批多少个执行：冻结前 lead 实测（DESIGN §9.3），目标是一批一秒左右做完，Host 关闭和界面的一次调用都不用久等。测法见 §7。测试里每批的数可以注入。
  - 选执行：用新索引 `s2b-run-by-workspace-ended`，从范围的上界往前倒着读；每个候选按键读它的 `RunActivity` 判断要不要做。
- **L9 日历读取 `readActivityCalendar`。**【lead 定，待审】
  - **输入：** 目标、`from`、`to`（UTC 时刻，左闭右开）、`granularity`（`hour` 或 `day`）、`timeZone`（IANA），可选 `sessionRefs`。
    - 按目标读，和冻结原型一样：画板把 `goal: s.goal` 传给时间视图，“全部”从这个目标开始算（原型 DESIGN.md L825、L830）。
    - `sessionRefs`（最多 33 个，一条线最多 32 个前任加线头，DESIGN §4.9）：只算这些 Session 领取的执行，以及落在这些 Session 上的检查：普通检查看主体执行的领取 Session；Goal 门的检查看它的负责 Session（`ownerSessionRefs`，门任务上有开着的负责关系的每一个 Session），有一个在 `sessionRefs` 里就算，规则同 L12“检查的横条”（lead 2026-10-14，日历和横条统一；第三次复核第 3 条），不看产出执行的 Session（见第 4 步）。2C 和界面用它得到“一条线的按小时计数”；本片不知道线是什么，也不把归档和活跃的线合在一起数（决定 30）。领取的 Session 读不出来（`null`，L17）的执行不算进去，覆盖情况里另记个数。
    - `hour`：跨度不超过 15 天（决定 25：超过 14 天换成年历式；多留一天给时区和夏令时）。`day`：不超过 400 天；更长的目标，界面按年分几次读。
    - **`from`、`to` 必须落在 UTC 的整刻上**：分钟是 00、15、30、45，秒和毫秒为 0（lead 2026-10-14 第 8 条）。一格只存 15 分钟的总数（L2），窗口切在一格中间就分不出这一格里哪几次在窗口里。现行时区的偏移都是 15 分钟的整数倍，本地的整点、零点都落在整刻上，所以本地小时、本地日照样准。
    - 不合法（时刻不是 `Z`、不在整刻上、`from ≥ to`、跨度超、时区不认识、`sessionRefs` 超过 33 个）→ `invalid`。
    - 窗口不必对齐本地小时或本地日：一格是本地小时（或本地日）和窗口的交，`startAt`、`endAt` 是交的两头。所以相邻的两个窗口把一个本地小时分成两半读，两边的数加起来正好是整个小时的，不丢不重。
  - **读哪些**（都按 L17 的规矩：稳定窗口、读的上限、读失败报失败）：
    1. 有记录的：`s2b-run-activity-by-goal-last` 正序、下界 `from`（含），留下 `span.firstAt < to` 的，和 `firstAt` 为空而 `lastAt < to` 的。`counted` 的按格计入（`recorded_late` 的照样计入，覆盖情况另记）；`unknown` 的在 `[firstAt, lastAt]` 覆盖到的小时记“有未计数的执行”；`firstAt` 为空的不占格，记进“时间不明”（`runsUnplaced`）。
    2. 没有记录的已结束执行：`s2b-run-by-goal-ended` 正序、下界 `from`，留下 `startedAt < to` 的，和 `startedAt` 为空而 `endedAt < to` 的（第二轮第 3 条：没进入就取消的执行 `startedAt` 一直为空，`run-machine.ts:698,786`）。**每个用键读它的 `RunActivity`**，有记录的跳过（不靠第 1 步读到的集合判断）；没有的按 L7 分类：证明没进入的记进 `runsNotEntered`，不占格；未知的有 `startedAt` 时在 `[startedAt, endedAt]` 覆盖到的小时记“有未计数的执行”，`startedAt` 为空时不占格、不编时段，记进“时间不明”（`runsUnplaced`），窗口总数的 `complete` 为假。
    3. 还在跑的：已有的 `RUN_BY_WORKSPACE_STATUS_INDEX`（`starting`、`running`）读这个工作区的，取本目标的；在 `[startedAt, 现在)` 覆盖到的小时记“进行中”（§0.1 告知 2）。`startedAt` 为空（还没进入）的不占格，覆盖情况里记进行中。
    4. 检查：`s2b-round-by-goal` 按 `since` 倒着读，每一轮用 `eventAt(since)` 取开始时刻。读到开始时刻早于 `from − 1 小时` 的一轮就停（提交顺序和时刻可能在毫秒级颠倒，留一小时余量；Host 的时钟往回跳超过一小时会漏，写进已知限制）。开始时刻在窗口里的，这一轮已开始的检查项（`invocationId` 不为空）都记在这一轮开始的那个小时（§0.1 告知 5）。没有 `since` 的旧轮次用 `s2b-round-by-goal-legacy` 读，记进“检查时间不明”。
       - 这一步读的量：这个目标里从窗口开始到现在建的全部轮次，和窗口本身多长无关。窗口越早读得越多，算进 L17 的读上限。
       - 日历按开始的时刻计数，所以留着这个停的规则（lead 2026-10-14 第 6 条）。横条画的是区间，不用这个规则，另按定案的时刻读（L12）。
       - 带 `sessionRefs` 时每一轮落在哪个 Session（lead 2026-10-14，和横条统一；第三次复核第 3 条）：普通检查是主体执行的领取 Session，在 `sessionRefs` 里就计入。Goal 门的检查按 L12“检查的横条”的规则取 `ownerSessionRefs`：读日历这一刻在门任务上有开着的负责关系的每一个 Session（交接没做完时可能有两个，2C E1）；其中有一个在 `sessionRefs` 里就计入，这一格“涉及的 Session”列的是这些负责的 Session，不是产出执行的。一个负责的 Session 都没有的门检查，检查项不进带筛选的格子，只记进覆盖情况的 `checksGateUnplaced`（数的是这一轮已开始的检查项，同格子里的检查项口径）；有负责的 Session、但都不在 `sessionRefs` 里的，是别的线的，不计入也不数。不带 `sessionRefs` 时照旧全部按开始的那个小时计入，`checksGateUnplaced` 为 `null`。
  - **每一格返回：**
    - 步骤、编辑、未知编辑、检查项；
    - 有未计数的执行几个、进行中的几个；`complete` 为真当且仅当这两个都是 0；
    - `future`：整格在现在之后（界面写“还没到这个时间”）；
    - 涉及的任务：按“步骤 + 编辑 + 检查项”从多到少取前 3 个，同数按 taskId 的字节序，另给其余个数（原型的格子悬停卡）；
    - 涉及的 Session：按 sessionId 的字节序取前 10 个，另给其余个数；名字由 2C 的工作线读取对上。
  - **整个窗口返回：** 四个总数，`complete`（有未计数、进行中或时间不明的就为假，界面不能把它当全部）；覆盖情况：计入的执行数、其中补记的（`recorded_late`）、没进入的、进行中的、各种未知（按原因分）、时间不明的执行、时间不明的检查项、领取 Session 不明的执行（只在带 `sessionRefs` 时）、一个负责的 Session 都没有的 Goal 门检查项（`checksGateUnplaced`，只在带 `sessionRefs` 时；第 4 步）；开始记录的时刻（`recordingSince`，没有为 `null`）；检查的归属方式（`round_start`）。
  - **本地时间：** 用 `Intl.DateTimeFormat` 按 `timeZone` 把格换成本地日期和小时。夏令时多出的那一小时并进同一格；少掉的那一小时不出格子。
- **L10 每个执行的活动 `readRunActivities`。**【lead 定，待审】
  - 输入 1–200 个 `RunRef`（本工作区）。每个返回：状态（`counted`、`not_entered`、`in_progress`、`unknown`）、原因（`unknown` 时是 L7 的原因；`counted` 补记时是 `recorded_late`）、是不是错误（`not_recorded`、`recorded_late` 时为真）、步骤编辑未知编辑的总数、改过的文件条数和 `possiblyIncomplete`、用量总数和是否齐全、`recordedBy`、`recordedAt`（这条记录写下的时刻）、`countedThroughTurnEnd`（`counted` 时就是 L4 的 `turnTerminal`：算到了 Turn 的终态；别的状态为 `null`）、`unresolvedCalls`（`counted` 时就是 L1 末尾那个数；别的状态为 `null`）。
  - `recordedAt`、`countedThroughTurnEnd`、`unresolvedCalls` 是公开的事实（lead 2026-10-14 第 12 条；`unresolvedCalls` 是第二轮第 2 条加的）：测试看“补算重跑没有重写”“迟到证据把没算完的换成算完的”都靠它们，不读数据库，也不断言私有字段。
  - 给 2C 点击打开的节点详情用。横条的悬停卡用 `TrackBarV1.activity`，悬停时不调用（决定 17：悬停只用已经读来的数据）。
- **L11 时间竖条 `readTaskStateTimeline`（按时间读任务状态）。**【lead 定，待审】
  - 返回每个任务的一串“段”：从哪个时刻到哪个时刻、是什么状态、由哪个时间点开始。界面拖到哪一刻，就取那一刻所在的段；状态是后端算的，界面只挑（决定 49 第 02 项“后端算清，界面显示”）。一次读一个目标，按任务分页，拖动时不用再请求。
  - 时间点（状态怎么变，见下面的折叠规则）：

    | 时间点 | 从哪来 | 时刻 |
    | --- | --- | --- |
    | `plan_appear` | 目标的计划各版（新索引 `s2b-plan-revision-by-goal`），`tasks` 里有这个任务的最早一版。不用 `taskStateBasis`：它记的是定义现在归哪一版（F31） | 那一版的 `acceptedAt`；如果这个任务更早就有执行，取最早的执行开始 |
    | `disposition` | 每一版计划的 `dispositionRecord` 里这个任务的条目，按 `setIn` 去重（F31：现行计划只留最近一次）；没有任何条目、现行计划里又不是 active 的，用现行这一版 | `setIn` 那一版的 `acceptedAt` |
    | `requeue` | 每个已结束执行的 `TaskRequeue`（键是 `afterRunId`） | `requestedAt` |
    | `run_start` | 执行（按任务的索引） | `startedAt` |
    | `pause` | 这个执行的控制意图（新索引 `s2b-control-by-run`），`applied`、观察到 `paused` 的（Kernel 的观察和平台证明的都算） | `observation.observedAt` |
    | `resume` | 同上，观察到 `resumed` 的 | 同上 |
    | `run_end` | 执行 | `endedAt` |
    | `anomaly` | 这个任务的异常锚点（已有的按任务索引，F33） | `recordedAt` |
    | `check_start` | 检查轮次（按任务的索引） | `eventAt(since)` 的 `occurredAt` |
    | `check_end` | 这一轮定案（`status: 'finalized'`），不论收没收下证据（F20a） | 轮次记录顶层的 `finalizedAt`（L14 末尾）；2B 以前定案的没有它，见下面的 `untimedPoints` |

    - `applied` 的控制意图一定带观察，观察一定带 `observedAt`（`control-record-codecs.ts:240-243,267-270,363-377`）。所以没有“用 `requestedAt` 顶替”这回事，上一稿的 `fallback` 删掉。
  - **折叠：按时刻从早到晚，同一时刻按固定顺序，一个点一个点地改三样东西，再得出这一刻显示的状态**（lead 2026-10-14 第 7 条）。三样东西：`base`（最近的点给的状态）、`anomalyOpen`（有没有还没核对的异常）、`disposition`（计划里的处置，起初是 active）。
    - 各点改什么：

      | 点 | 改什么 |
      | --- | --- |
      | `plan_appear` | `base = pending` |
      | `disposition` | `disposition` = 那一版的处置；变回 active 时 `base = pending` |
      | `requeue` | `base = pending`；`anomalyOpen` 不动 |
      | `run_start` | `base = running`；`anomalyOpen = false` |
      | `pause` | 看它那个执行这一刻进入了没有：在 `[startedAt, endedAt)` 里 → `base = paused`；在 `startedAt` 以前，或执行从没进入（`startedAt` 为空）→ `base = paused`；在 `endedAt` 或以后 → 不改 |
      | `resume` | 在 `[startedAt, endedAt)` 里 → `base = running`；在 `startedAt` 以前或从没进入 → `base = pending`（没进入的执行接着等进入，不是在跑；RUN-11）；在 `endedAt` 或以后 → 不改 |
      | `run_end` | `base` 按结果：completed → `awaiting_check`；failed、budget_exhausted → `run_failed`；cancelled → `run_cancelled`；crashed 且 `isPausedInterrupted` → `paused`；其它 crashed → `interrupted`；outcome_unknown → `outcome_unknown`；yielded → `waiting_reply` |
      | `anomaly` | `anomalyOpen = true` |
      | `check_start` | `base = verifying` |
      | `check_end` | `base` 按这一轮存下的 `outcome`：PASS → `satisfied`；FAIL → `check_failed`；INCONCLUSIVE → `check_incomplete` |

    - 显示的状态，按顺序取第一条成立的：
      1. `disposition` 不是 active → `deferred`、`cancelled`、`superseded`；
      2. `anomalyOpen` → `interrupted_pending_check`（决定 42 的“中断，待核对”）；
      3. 其余 → `base`。
    - 所以：被归档中断的任务，先写异常锚点、再重新入队（F21），重新入队以后仍显示“中断，待核对”，到下一次 `run_start` 才变；没进入就继续的执行显示 `pending`，不显示 `running`。
    - 显示的状态变了才开新段，段的 `point` 是让它变的那个点。不改显示状态的点（例如异常以后的重新入队、执行结束以后才到的暂停观察）不开段，也不进 `untimedPoints`。
  - 第一个时间点之前是 `not_in_plan`（UI-WORKBENCH §0 第 12 条“那时不在计划里的任务画淡”）。计划的某一版读出来是坏的、因而定不了最早出现在哪一版时，`plan_appear` 放进 `untimedPoints`，第一段的状态是 `unknown`，不写 `not_in_plan`。
  - 同一时刻的几个点按固定顺序：`plan_appear`、`requeue`、`run_start`、`pause`、`resume`、`run_end`、`anomaly`、`check_start`、`check_end`、`disposition`。
  - 没有时刻的点（`startedAt` 为空、轮次没有 `since`）放进 `untimedPoints`，不进段，不编时刻。定案时刻没存的旧轮次（2B 以前定案的），`check_start` 和 `check_end` 两个点都放进 `untimedPoints`，不开 `verifying` 段，不然这一轮看起来一直没做完。
  - 一律标 `approximate: true`；不会出现“受阻”“等待别的任务”这类没有存时间的状态（Q5 A）。“回到现在”用 2C 和已有读取的当前状态，不用这里的最后一段。
  - 例子（UTC，手写）：计划 09:00 采用；执行 1 10:00–10:30 完成；检查 10:31 开始，10:40 定案 FAIL；系统重新入队 10:41；执行 2 11:00–11:20 完成；检查 11:21 开始，11:30 定案 PASS。段落是：`[空, 09:00) not_in_plan`、`[09:00, 10:00) pending`、`[10:00, 10:30) running`、`[10:30, 10:31) awaiting_check`、`[10:31, 10:40) verifying`、`[10:40, 10:41) check_failed`、`[10:41, 11:00) pending`、`[11:00, 11:20) running`、`[11:20, 11:21) awaiting_check`、`[11:21, 11:30) verifying`、`[11:30, 空) satisfied`。
  - 分页：任务按现行计划 `tasks` 的顺序；游标带现行计划的版本，翻页时现行计划换了报 `source_stale`，界面从头读。每页 1–200 个任务。目标没有现行计划：任务为空。已结束、已取消的目标照样读（“老目标也能看”）。只出现在旧版计划里、现行计划里没有的任务不列。
  - 每页读：目标的计划各版（一次）；每个任务的执行（按任务的索引，读到底，只读一次：`run_start`、`run_end`、暂停和继续看的进入区间都用这一次读到的）、检查轮次（按任务的索引）、异常锚点（按任务的索引）；每个执行的重新入队（按键读）、控制意图（按执行的索引）；每一轮一次 `eventAt`（开始），定案的时刻从轮次记录上读。不读证据。读失败报失败；按 L17。
- **L12 轨道上的横条 `readTrackBars`。**【lead 定，待审】
  - 2C 给轨道“有哪些行”（线、分组、排序），本片给“行上画什么”（2C 草稿 §0.4）。横条按 Session 给出，界面按 2C 的线把 Session 归到行上。
  - 输入：目标、`from`、`to`、游标、`limit`（1–500），可选 `sessionRefs`（最多 33 个，同 L9）。
    - `from`、`to` 同 L9：UTC 的整刻，否则 `invalid`（lead 2026-10-14 第 8 条）。
    - 带 `sessionRefs`：执行、检查只出这些 Session 的（检查按它的 `sessionRef` 筛，Goal 门的检查见下面“检查的横条”）；查询的横条也读（见下）。
    - 不带：执行、检查是整个目标的；查询不读，返回 `queriesIncluded: false`。这表示“没读”，不表示“没有查询”。
  - **横条是区间，按“和窗口有重叠”读**（lead 2026-10-14 第 6 条）：结束在 `from` 或以后、开始在 `to` 以前的，加上还没结束的。分段按索引读，游标记着读到哪一段、哪一条；不在内存里对整个窗口排序：
    1. `runs_ended`：`s2b-run-by-goal-ended` 正序、下界 `from`（所以 `endedAt ≥ from`）。`startedAt` 不为空且 `startedAt < to` 的画成横条；`startedAt` 为空而 `endedAt < to` 的不画，只数进 `unplaced.runs`（第二轮第 3 条：没进入就取消的执行没有开始的时刻，不能在读到计数以前就丢掉）；其余不要；
    2. `runs_open`：`RUN_BY_WORKSPACE_STATUS_INDEX`（`starting`、`running`），取本目标的；
    3. `rounds_ended`：新索引 `s2b-round-by-goal-finalized` 正序、下界 `from`（按定案的时刻），取开始（`eventAt(since)`）早于 `to` 的。周一开始、周三定案的一轮，读周二的窗口也在这里。没有 `since` 的跳过（第 5 段数它）；
    4. `rounds_open`：已有的 `VERIFICATION_ROUND_BY_STATUS_LOOKUP` 里还开着的轮次，取本目标的、开始早于 `to` 的；没有 `since` 的跳过（第 5 段数它）；
    5. `rounds_unplaced`：不画、只数，记进 `unplaced.rounds`：
       - 没有 `since` 的旧轮次，用 `s2b-round-by-goal-legacy` 读（开着的、定案的都在这里）；
       - 有 `since`、2B 以前就定案、没存定案时刻的轮次，用 `s2b-round-by-goal-unfinalized` 读（等值、定案时刻取 `null`），留下 `status: 'finalized'` 的。它们的区间不知道，不画，也不当成还开着。
    6. `queries`（只在带 `sessionRefs` 时）：对每个 Session——
       - 它自己的查询（秘书回合等）：新索引 `s2b-query-run-by-session-ended` 正序、下界 `from`，取 `startedAt < to` 的；再加它现在的占用者，如果那是一个还没结束的查询（F32）；只留 `QueryJob.goalId` 等于本目标的。
       - 问它的只读咨询：已有的“Session 按来历”索引找 `from` 是它、`kind` 是 `readonly_copy` 的副本，每个副本的查询照上面读，不看目标；横条画在被问的这个 Session 上（`askedSessionRef`，决定 25）。
    - 一页里的横条按段的顺序排，不按开始时刻；界面按时刻摆。翻页之间没有快照（同 2A L7）：两页之间结束的执行、定案的轮次可能在两段里各出一次或都不出，界面按引用去重。
    - 没有 `startedAt` 的执行（没进入）不画，记在 `unplaced.runs`：已结束的按第 1 段的条件数，还开着的（`starting`、还没进入）按第 2 段数。
  - **执行的横条：** 每根带：执行和任务的引用、领取的 Session（L17，可空）、起止（没结束为空）、结果的种类和原因（`terminalPayload` 等已存的文字，有上限）、暂停的空隙（`pauses`：每段 `from`、`to`；只取执行进入以后、结束以前观察到的暂停，`to` 是下一次继续的时刻、执行结束的时刻或空；时刻取法同 L11 的 `pause`、`resume`）、第几次尝试和怎么来的（同一次尝试的接续、按 `requeueRef` 重新入队、按 `consumedWait` 接着让出等）、重新入队的发起类别和自动次数、前一根的引用、活动（L10 的结果）。
    - **前一根怎么找**（lead 2026-10-14 第 10 条）：一页里出现的每个任务，用按任务的索引把它的执行读一次（读到底），在内存里按 `startedAt` 排（相同的按 runId 的字节序；`startedAt` 为空的不当前一根），每根的前一根是同一任务里开始比它早的最近一次。同一页里同一个任务的几根共用这一次读，不按执行重读。
  - **检查的横条：** 每根带：轮次和任务的引用、它落在哪个 Session（`sessionRef`；Goal 门的检查另带 `ownerSessionRefs`，见下）、开始（`eventAt(since)`）、结束（定案的时刻；还开着为空）、结果（还开着是 `open`，定案的取轮次存下的 `outcome`；一条证据都没收下的轮次也有结束和结果）、链上第几轮、已开始的检查项数、前一轮的引用。
    - **落在哪个 Session**（第二轮第 4 条；第三次复核第 3 条改了门检查有几个负责 Session 时的规则）：
      - 普通的检查：`sessionRef` 是主体执行（`subjectRunRef`）的领取 Session（L17）；`ownerSessionRefs` 为 `null`。
      - Goal 门的检查（轮次的 `adoptedPlanRef` 那一版计划里，主体任务的 `taskKind` 是 `gate`）：它的主体执行是被锚定的产出执行，不是门自己的执行（`verification.ts:161`），所以不用它的 Session。`ownerSessionRefs` 是**读横条的这一刻**在门任务上有开着的负责关系（`until` 为空、`relation: 'responsible'`）的每一个 Session，用已有的按任务找关系的索引 `session-links-by-task` 读（`sessions/session-record-codecs.ts:958`），按 Session 的规范 refKey 排好；没有就是空数组。`sessionRef`：正好一个负责的 Session 时就是它，零个或不止一个时为 `null`。
      - 不止一个负责的 Session 是做得到的情况，不是数据坏：交接没做完时，门任务上会有两条开着的负责关系（2C E1，2C 把它们去重成一条负责的线）。所以本片不替 2C 挑一个，把它们都交出去（`ownerSessionRefs`），由 2C 按它自己的规则放到负责的那条线上；2C L23 说的“落在负责门任务的那条线上”，交接没做完时就是 2C E1 去重以后的那一条。
      - L9 日历带 `sessionRefs` 时用同一条规则（L9 第 4 步）。
    - **带 `sessionRefs` 时检查怎么筛**：普通检查照旧按 `sessionRef`（主体执行的 Session）筛。门检查只要 `ownerSessionRefs` 里有一个在 `sessionRefs` 里就出现。一个负责的 Session 都没有的门检查不出现，只数进 `unplaced.gateRounds`；有负责的 Session、但都不在 `sessionRefs` 里的，是落在别的线上，不出现也不数。不带 `sessionRefs`（整个目标）时门检查都照常出现；没有负责 Session 的 `sessionRef: null`、`ownerSessionRefs: []`，界面放在目标栏（2C L23）。
  - **查询的横条：** 每根带：查询的引用、执行它的 Session、被问的 Session（咨询才有）、种类（`turn` 或 `consultation`）、起止、结果。
  - **Host 重启线：** 本页读到的执行上，`reconciliation.basis` 是 `host_instance_takeover` 的那些 `recordedAt`，去重。只含碰到这个目标的重启，写明是近似。
- **L13 “执行改过的文件”换掉第 5 片的桩。**【lead 定，待审】
  - 新建 `createGoalExecutedFilesReader`，实现已有的 `GoalExecutedFilesPort`，接口和 DTO 一字不改（F23 的注释）。
  - **读到底，不设读的上限**（lead 2026-10-14 第 9 条）：`ACTIVITY_READ_RECORD_CAP` 不管它，L17 的读上限只管 L9–L12。端口没有时间窗，也没法拆；它的失败会经冲突提示传进整个决定队列（`goal-conflicts.ts:475`、`decision-read-model.ts:446`），而 2A L8 定了队列不因数量多而拒绝。存储读失败照常报失败。
  - 读法：这个目标的执行用已有的按目标索引按页读到底（为了找出没记录的、还在跑的）；`RunActivity` 用 `s2b-run-activity-by-goal-last` 按页读到底；这个工作区的 `ActivityRecording` 读一次。在内存里按执行对上，不对每个执行做按键读。
  - 每个执行按 L7 分类，再决定它给什么（lead 2026-10-14 第 11 条）：
    - `counted`（含补记）：`definite`、`possible` 照抄；记录自己标了不全，`possiblyIncomplete` 为真；
    - 证明没进入过 Kernel（L7 的“没有记录，没进入过 Kernel，算 0”，例如 RUN-09）：不给文件，也不算不全；
    - 还在跑的（`starting`、`running`）、`unknown`、`not_recorded`、`not_backfilled`、`no_recording_epoch`：不给文件，`possiblyIncomplete` 为真。开始记录以前结束、既没有位置记录也没有任何授权的执行属于 `not_backfilled`，不当没进入（L7）。
  - `files` 的顺序：按 runId 的字节序，同一个执行里 `definite` 在前、`possible` 在后，各按路径的字节序。`availability: 'available'`。`guards`、`sourceCursor`、`atLeastCursor` 照端口今天的约定。
  - 生产组合换成它。桩文件从 `src/` 搬到 `tests/helpers/`，第 5 片的测试从新位置注入它（F34：只给测试用的代码放 `tests/`；§5.3）。
  - 冲突提示每次读决定队列都要对所有目标算（2A L3），这个读的代价进 §7 的量法。
- **L14 新索引，都登记在各自的 codec 里。**【lead 定，待审】

  | 名字 | 记录 | 等值部分 | 排序（2A 的按顺序查找） |
  | --- | --- | --- | --- |
  | `s2b-run-activity-by-goal-last` | `RunActivity` | `ref.projectId`、`ref.goalId` | `span.lastAt` |
  | `s2b-run-by-goal-ended` | `Run` | `ref.projectId`、`ref.goalId` | `endedAt` |
  | `s2b-run-by-workspace-ended` | `Run` | `ref.projectId`、`workspaceSnapshot.workspaceId` | `endedAt` |
  | `s2b-round-by-goal` | `VerificationRound` | `ref.projectId`、`ref.workspaceId`、`ref.goalId` | `since` |
  | `s2b-round-by-goal-legacy` | `VerificationRound` | 同上，再加 `since`（读 `null`，同 2A L4 的旧式组） | 无（等值） |
  | `s2b-round-by-goal-finalized` | `VerificationRound` | `ref.projectId`、`ref.workspaceId`、`ref.goalId` | `finalizedAt`（见下） |
  | `s2b-round-by-goal-unfinalized` | `VerificationRound` | 同上，再加 `finalizedAt`（读 `null`：还开着的，和 2B 以前定案的） | 无（等值） |
  | `s2b-plan-revision-by-goal` | `PlanRevision` | `goalRef.projectId`、`goalRef.goalId` | `acceptedAt` |
  | `s2b-control-by-run` | `ControlIntent` | `ref.projectId`、`ref.workspaceId`、`runRef.goalId`、`runRef.runId` | 无（等值） |
  | `s2b-query-run-by-session-ended` | `QueryRun` | `ref.projectId`、`ref.workspaceId`、`run.executionState.sessionRef.sessionId` | `run.endedAt` |

  - 一共十个。按顺序的那六个，等值部分都是文字（2A L1 只许非空文字），排序值都是文字（2A L1 缺省的 `text`）。两个等值的旧式组用普通 `lookup`，路径末位取 `null`：没有这个字段的记录也算 `null`，两个后端一样（`sqlite-record-store.ts:104` 的 `IS NULL`；内存后端 `lookup-index.ts:202-207`），同 2A L4。
  - 附录 C 第 8 个原写“执行按‘工作区 + 开始日期’”。改按结束时刻，并加按目标的：一个执行在窗口开始以前开始、在窗口里结束，按开始排找不到它；按结束排、从窗口开始往后读，正好是“结束在窗口开始以后”的那些。还在跑的执行 `endedAt` 为空，不是候选，另从已有的状态索引读。查询同理，还在跑的从 Session 的占用者读。检查轮次同理（L12）：按定案的时刻排，还开着的另从状态索引读。
  - 没有 `executionState` 的旧查询不是 `s2b-query-run-by-session-ended` 的候选，不画（§1.2）。
  - lead 验收时用 `EXPLAIN QUERY PLAN` 确认 SQLite 走的是这些索引（同 2A）。
  - **检查轮次定案的时刻：轮次记录顶层加 `finalizedAt`**（lead 2026-10-14 选甲（简单；可以按时刻建排序索引），第 5 条）。今天按键读不到（F20a），证据的 `admittedAt` 不能当结束（一条证据都没收下的轮次没有它）。
    - 值：VR-07 定案的那次提交用的同一个 `deps.now()`，也就是同一次提交的 `VerificationRoundFinalized` 事件的 `occurredAt`（`evidence-service.ts:1551,1571-1572`）。今天代码里证据的 `admittedAt` 也取这个值，但写不写 `finalizedAt` 和收没收下证据无关。ISO 时刻，`Z` 结尾。
    - 在哪：和 `since` 一样只在记录顶层，不进 `RoundSnapshot`。解码给出的 `RoundSnapshot` 里没有它（同 `withoutNoticeOrigin` 去掉 `since` 的做法，`evidence-record-codecs.ts:343-348`）；要读它的地方（L11、L12、两个新索引）读记录顶层。
    - 谁写：只有 VR-07 定案的那次提交写。以后每次改写轮次记录都原样保留它，同 `since`：经 `preservedRoundNoticeOrigin`（`evidence-service.ts:278-298`）带过去。校验：有它时必须是合法的 ISO 时刻、轮次必须是 `finalized`；开着的轮次带它报 `invalid`。
    - 2B 以前定案的轮次没有它，也不补（不做迁移）：它们经 `s2b-round-by-goal-unfinalized` 读，在横条上只数进 `unplaced.rounds`（L12 第 5 段），在时间竖条上两个点都进 `untimedPoints`（L11）。
    - `s2b-round-by-goal-finalized` 直接按它排，下界取窗口的 `from`，横条第 3 段（L12）这样读；时间竖条（L11）从记录上读，不多读。
    - 改的文件：`src/core/work-graph/persistence/evidence-record-codecs.ts`（轮次记录的校验、编码的 `origin` 参数带上它、解码时去掉它、两个新索引的登记）、`src/core/work-graph/persistence/decision-record-codecs.ts`（`decodeNoticeOrigin` 读轮次顶层时把它也读出来，或旁边另加一个只给轮次用的读法）、`src/core/work-graph/persistence/rework-codecs.ts`（顶层字段的形状检查 `noticeOriginFieldsProblem`；它三种记录共用，`finalizedAt` 只许轮次有）、`src/core/work-graph/evidence/evidence-service.ts`（VR-07 的提交 `:1549-1572` 写它，`preservedRoundNoticeOrigin` 保留它）。不改 `state/verification-machine.ts`、`src/contracts/verification.ts`。
    - `state-writes` 的保护表不变：轮次那一行保护的是 `RoundSnapshot` 的 `status`、`outcome`、`gaps`、`evidenceRefs`、`checks`、`chain`（`tests/architecture/state-writes.test.ts:118-119`），`finalizedAt` 不在 `RoundSnapshot` 里，同 `since`（§5.3）。
    - 没选的乙（把定案提交的位置绑到 `until`）：读时刻要每轮多一次 `eventAt`，索引不能直接拿时刻作下界。
- **L15 路由五个。**【lead 定，待审】`activity/calendar`、`activity/runs`、`activity/track`、`tasks/timeline` 是 plain 读；`activity/backfill` 是写，只认人（L8：`reworkActorClassOf` 得 `human`），其余 `forbidden`；没有租约的 Host 上 `busy`。界面路由标签表一并加上。新的路由拥有者 `activity`、`timeline` 在组合根里设成不可枚举，同第 1、3、5 片（F34），所以组合测试的键表不变。
- **L16 不改的。**【lead 定，待审】
  - Run、Task、Attempt 的状态机和保护字段；
  - 观察者的增量读法（只在结束前多一次整读）；
  - Kernel（不打补丁）；
  - 已有的读取和它们的结果。
- **L17 读取的共同规矩（L9–L13；读的上限只管 L9–L12）。**【lead 定，待审】
  - 不写任何东西，不读 Kernel，不补算。
  - L13 照端口今天的约定交 `guards`、`sourceCursor`，稳定窗口由调它的冲突提示管（`goal-conflicts.ts:270-280,320-324`），自己不另重读；也不受下面的读上限（L13）。
  - **稳定窗口，照 2A L7：** 读的中途账本有新提交，整个读取从头重读；一共读 4 次（含第一次，同今天 `decision-read-model.ts:244-251`），4 次都被打断报 `unavailable`。不这样的话，第 1 步和第 2 步之间刚结束的执行，会被读成“结束了、没有记录”，错报“计数缺失（错误）”。翻页之间没有快照（横条、时间竖条）。
  - **读的上限（L9–L12）：** 一次调用最多做 `ACTIVITY_READ_RECORD_CAP`（暂定 20,000）次存储读：索引的一行、按键读的一条记录、一次 `eventAt` 各算一次。超了报 `capacity`，原因写明是哪个窗口、上限多少；界面把窗口拆小（“全部”按年读）。不截断，不返回部分当全部。这个数冻结前按 §7 量过再定；测试里可以注入。
  - **执行的 Session：** 位置记录上的 `sessionRef`；没有（没进入）就按 `dispatchOutboxRefKey({...run.task, attemptId: run.attemptId})` 读派工记录的 `claim.sessionRef`；派工记录也没有（旧执行）就是 `null`（F15）。
  - 任何一步读失败，整个读取报失败（`unavailable` 或底层的码），不返回空，不返回 0。

### 0.4 和别的工作的接缝

- **2A（先合入）。** 本片的按顺序索引用它的按顺序查找；旧式组的读法、稳定窗口也照它。合入顺序：接线包 2 → K 片 B → K 片 A → 2A → 2B（lead 审时按 2026-10-14 的实际进度改）。
- **接线包 2（已合入，bb924854）。** 它改了 `tasks/run-reconcile-service.ts` 的 `commitDecided`：核对的提交现在按写下的 Session 记录带 `unavailableSince` 的提交位置绑定（`sessionCursorBindings(written)`，`run-reconcile-service.ts:415-418`）。本片在同一个提交里把 `RunActivity` 加进 `written` 时，这些绑定照留（L5）；`RunActivity` 自己没有要绑的提交位置字段。
- **K 片 A（在做）。** 它改 `run-reconcile.ts`、`kernel-turn-facts.ts` 的终态集合，加 `run.interrupted`、`closeOpenTurn`、`readTurnBounds`。本片的数法不认 `run.interrupted` 为工具事件（它也不是）；K 先合，本片在它之上改同两个文件。补算用 `readTurnBounds` 定窗口的上界（L6）；没有位置记录的执行，本片不用它去找 Turn。
- **K 片 B（先合入）。** 只读命令 `run_readonly_command`：算步骤，不算编辑，不进改过的文件（L1 按名字认）。2B-06 里有它的例子。
- **K3。** 以后把“结果未知”的调用定成“做了 / 没做”，本片的计数不跟着改：记的是结束时 Kernel 记录能证明的。K3 的核对轮如果是查询，今天不计数（§0.1 告知 3）；是执行，照常计数。K3 加的结束方式照 L5 的表补一行。
- **2C（可以并行，接口要先对齐）。** 2C 给线、分组、排序、悬停卡的其余字段；本片给日历、横条（执行、检查、查询）、每个执行的活动、改过的文件。2C 的“实际改过”在本片合入前报 `not_available`，合入后读本片的结果。2C 的测试自己注入“有”和“没有”两种执行改过的文件端口（2C 规格 L15、2C-27），本片换掉生产组合里的桩时不改 2C 的断言；本片只改第 5 片的生产组合那一处（§5.3 第一行）。Goal 门的检查落在哪条线，本片和 2C L23 一致（L12）。
- **第 5 片（已合入）。** 冲突提示经 `GoalExecutedFilesPort` 读到真实的改过的文件（L13）。
- **第 6 片。** 秘书回合加工具以后，再问查询的工具调用要不要计数（§0.1 以后再问 1）。按目标找查询的索引（附录 C 第 9 个）是主对话用的，本片的横条不用它。
- **第 6、7、9 片和 K2。** 读本片存的用量（“太长”、按上次输入量挑秘书、量线有多长、命中多少）。
- **E3。** 所有界面：日历和年历、按本地时区显示、未知的原因文字、“计数缺失（错误）”和“补记”的样子、“范围太大”时拆窗口、人点补算的按钮和进度、横条（含暂停的空隙、查询）和悬停卡、时间竖条。

## 1. 范围

### 1.1 交付

1. 契约：`RunActivity`、`ActivityRecording` 两种新记录，和计数事实的类型（`src/contracts/run-activity.ts`）；`AggregateRef` 加两种引用。
2. AgentRuntime：纯函数 `tallyTurnActivity`、读窗口的 `readRunActivityFacts`；观察者、启动核对、进程内暂停停止在结束提交里带上计数；观察者 RUN-08 的待提交项（L6）；`countRunActivity` 给补算用。
3. WorkGraph `tasks`：两种记录的编解码、索引、写入（结束提交里建、RUN-21 按 L4 换、补算建或替换、开始记录）；补算候选的读取；`createGoalExecutedFilesReader`。
4. WorkGraph `views`：日历、每个执行的活动、横条、时间竖条四个读取。
5. 索引登记：检查轮次四个（`evidence`）、计划版本一个、控制意图一个、查询一个（各自的 codec）。
5a. 检查轮次定案的时刻 `finalizedAt`（L14 末尾，lead 2026-10-14 选甲）：VR-07 的提交写它，以后的改写保留它，轮次记录的编解码认它、解码时不放进 `RoundSnapshot`。
6. Workflow：自动补算一批、人点补算一批。
7. Host：开始记录、启动后的后台自动补算、五个路由、`leaseGated` 加人点补算。
8. 组合根接线：计数、读取、换掉桩、新拥有者不可枚举。

### 1.2 不在本片

- 线、分组、排序、状态词、悬停卡的其余字段、节点详情（2C）。
- 查询里工具调用的计数（§0.1 以后再问）。
- 读日历时现算还在跑的执行（§0.1 告知 2）。
- 按工作区或跨目标的日历；按线跨目标的汇总。
- 按天汇总的记录（冻结前量过再定，§7）。
- 没有 `executionState` 的旧查询的横条。
- “未排期 n”（来自任务图读取，不是本片）。
- K3 定了“做了 / 没做”以后重算；用 `readTurnBounds` 找没有位置记录的 Turn。
- 给 2B 以前定案的检查轮次补定案的时刻。
- 压缩（K2）。
- 界面（E3）。

## 2. 接口（新名字以此为准）

```ts
// src/contracts/run-activity.ts（新）
export const RUN_ACTIVITY_RULE_VERSION = 1 as const;
export const ACTIVITY_QUARTER_CAP = 1000;          // L2
export const RUN_CHANGED_FILES_CAP = 500;          // L3，definite、possible 各自
export const RUN_USAGE_REQUESTS_CAP = 256;         // L3
export const ACTIVITY_RECENT_WINDOW_DAYS = 14;     // 决定 50；L8
export const ACTIVITY_READ_RECORD_CAP = 20000;     // L17，只管 L9–L12；冻结前量过再定
export const RUN_ACTIVITY_MAX_PAGES = 64;          // L6，每页 200 条；测试里可以注入
/** Kernel tool names whose effects can count as edits (L1); the platform `write` is recorded as `edit`. */
export const FILE_EDIT_TOOL_NAMES = ['edit', 'shell'] as const;
/** Unknown reasons the automatic backfill retries (L8). */
export const ACTIVITY_AUTO_RETRY_REASONS = ['history_read_failed', 'kernel_unreadable'] as const;

export type RunActivityRef = { aggregateType: 'RunActivity'; projectId: string; goalId: string; runId: string };
export type ActivityTotalsV1 = { steps: number; edits: number; editsUnknown: number };
export type ActivityQuarterV1 = ActivityTotalsV1 & { at: string };   // UTC 15 分钟格的开始，ISO，Z
export type RunChangedFilesV1 = {
  definite: string[]; possible: string[]; definiteOmitted: number; possibleOmitted: number;
  possiblyIncomplete: boolean; incompleteBecause: ('command_ran' | 'edits_unknown' | 'cap')[];
};
export type RunModelUsageRequestV1 = {
  requestId: string; startedAt: string; usageStatus: 'reported' | 'unknown';
  inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; costUsdMicros: number | null;
};
export type RunModelUsageV1 = {
  requests: RunModelUsageRequestV1[]; omitted: number;
  totals: { inputTokens: number; outputTokens: number; cachedInputTokens: number }; complete: boolean;
};
export type RunActivityUnknownReason =
  | 'no_history_locator' | 'kernel_unreadable' | 'history_read_failed' | 'history_damaged' | 'turn_not_found' | 'capacity';
/** Where the window's upper bound came from (L6). */
export type RunActivityBound = 'end_position' | 'turn_bounds' | 'reconcile_observation' | 'kernel_tail';
export type RunActivityFactsV1 =
  | { status: 'counted'; ruleVersion: number;
      window: { kernelRunId: string; kernelTurnId: string; fromPosition: number; throughPosition: number;
        bound: RunActivityBound; turnTerminal: boolean;                // L4：窗口里归约出的 Turn 是终态
        unresolvedCalls: number;                                        // L1 末尾；L4 第 3 行用
        turnStartedAt: string; lastRecordAt: string };                 // L4 的 span 取这两个
      quarters: ActivityQuarterV1[];                                    // 按 at 排序，只有非空格，≤ ACTIVITY_QUARTER_CAP
      overflow: (ActivityTotalsV1 & { firstAt: string; lastAt: string }) | null;
      totals: ActivityTotalsV1; changedFiles: RunChangedFilesV1; usage: RunModelUsageV1 }
  | { status: 'unknown'; ruleVersion: number; reason: RunActivityUnknownReason; detail: string };   // detail ≤ 500 字符
export type RunActivitySnapshot = {
  ref: RunActivityRef; revision: number; schemaVersion: 1;
  runRef: RunRef; taskId: string; workspaceId: string; sessionRef: SessionRef | null;   // L17
  runEndedAt: string;
  recordedBy: 'run_end' | 'backfill'; recordedAt: string;
  facts: RunActivityFactsV1;
  span: { firstAt: string | null; lastAt: string; basis: 'kernel' | 'run_times' };       // L4：lastAt 总是文字
};
export type ActivityRecordingRef = { aggregateType: 'ActivityRecording'; projectId: string; workspaceId: string };
export type ActivityRecordingSnapshot = { ref: ActivityRecordingRef; revision: number; schemaVersion: 1; since: string };
```

```ts
// 结束提交的输入（可选字段；不带就不写记录，读的时候按 L7 算）
// src/core/work-graph/model/execution-entry-contracts.ts
export type TaskResultObservation = { /* 原有字段 */ activity?: RunActivityFactsV1 };
// src/core/work-graph/tasks/run-reconcile-contracts.ts（result 为 not_entered 时带了报 invalid）
export type ReconcileRunInput = { /* 原有字段 */ activity?: RunActivityFactsV1 };
```

```ts
// AgentRuntime
// src/core/agent-runtime/run-activity-tally.ts（新，纯函数）
export function tallyTurnActivity(records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding,
  window: { fromPosition: number; throughPosition: number; bound: RunActivityBound }):
  RunActivityFactsV1;
// src/core/agent-runtime/run-activity-reader.ts（新）
export type RunActivityRead = { kind: 'facts'; facts: RunActivityFactsV1 } | { kind: 'retry_later'; reason: string };
export function readRunActivityFacts(owner: SessionHistoryCursorOwner, input: {            // 它已有 probe 和 readPositionWindow
  session: SessionRecord; kernel: KernelExecutionBinding; fromPosition: number;
  through: { position: number; bound: Exclude<RunActivityBound, 'kernel_tail'> } | 'kernel_tail';
  probeFirst: boolean; signal: AbortSignal; maxPages?: number }): Promise<RunActivityRead>;   // L6；maxPages 缺省 RUN_ACTIVITY_MAX_PAGES
// src/core/agent-runtime/execution-observation.ts（内部，不导出；L6 的先后）
type PendingTerminal = { endPosition: number; requestId: string; observation: TaskResultObservation };   // 原有；activity 挂在 observation 上，只挂一次
type PendingUnknownEnd = { endPosition: number; requestId: string;                                       // 新；RUN-08
  input: TaskResultObservation & { unresolvedToolCallIds: string[] } };                                 // 事件的 id、时刻在 input.event 上，建好就不变
// src/core/agent-runtime/ports.ts（RuntimeExecutionPort 新增，可选；补算用，只读）
countRunActivity?(ctx: CoreCallContext, input: { runRef: RunRef }):
  Promise<ReadResult<RunActivityRead | { kind: 'not_entered' }>>;
```

```ts
// WorkGraph tasks：src/core/work-graph/tasks/run-activity-service.ts（新）
export interface RunActivityPort {
  recordRunActivity(ctx: CoreCallContext, request: GraphWrite<{ runRef: RunRef; facts: RunActivityFactsV1 }>):
    Promise<WriteResult<{ outcome: 'created' | 'replaced' | 'unchanged'; snapshot: RunActivitySnapshot }>>;   // recordedBy: 'backfill'
  ensureActivityRecording(ctx: CoreCallContext, request: GraphWrite<{ workspace: WorkspaceScope }>):
    Promise<WriteResult<ActivityRecordingSnapshot>>;                                                        // 只认 Host
  listActivityBackfillCandidates(ctx: CoreCallContext, input: { workspace: WorkspaceScope; mode: 'recent' | 'range';
    from: string; to: string; after: { order: string; refKey: string } | null; limit: number }):
    Promise<ReadResult<{ runRefs: RunRef[]; next: { order: string; refKey: string } | null }>>;   // 按 endedAt 倒序；L8 的候选规则
}
// src/core/work-graph/tasks/goal-executed-files-reader.ts（新；接口是已有的 GoalExecutedFilesPort）
export function createGoalExecutedFilesReader(deps: {
  records: Pick<GoalRecordTransactionPort, 'readMany'> & RecordLookupPort & RecordOrderedLookupPort }): GoalExecutedFilesPort;
// 用到按顺序索引（L14）的读取和服务，依赖都带上 2A 冻结的 RecordOrderedLookupPort（2A §2；第二轮第 1 条）：
//   createGoalExecutedFilesReader（上一行）；run-activity-service.ts 的工厂（RunActivityPort，挑补算候选用 s2b-run-by-workspace-ended）；
//   views 的 activity-read-model.ts、track-read-model.ts、task-state-timeline.ts 的工厂。
//   它们的存储依赖写成  GoalRecordTransactionPort 里要用的那几个方法 & RecordLookupPort & RecordOrderedLookupPort。
// 组合根（create-platform.ts）给它们传同一个存储 backend.records：它同时实现这三个端口（两个后端都实现 lookupOrdered，2A §2）。
```

```ts
// WorkGraph views
// src/core/work-graph/views/activity-read-model.ts（新）
export type ActivityUncountedReason = RunActivityUnknownReason | 'not_backfilled' | 'not_recorded' | 'no_recording_epoch';
export type ActivityCellV1 = {
  localDate: string; localHour: number | null;            // day 粒度时 localHour 为 null
  startAt: string; endAt: string; future: boolean;
  steps: number; edits: number; editsUnknown: number; checks: number;
  uncountedRuns: number; inProgressRuns: number; complete: boolean;
  tasks: { taskId: string; steps: number; edits: number; checks: number }[]; moreTasks: number;   // ≤ 3
  sessions: SessionRef[]; moreSessions: number;                                                    // ≤ 10
};
export type ActivityCalendarV1 = {
  goalRef: GoalRef; from: string; to: string; granularity: 'hour' | 'day'; timeZone: string; now: string;
  cells: ActivityCellV1[];
  totals: { steps: number; edits: number; editsUnknown: number; checks: number; complete: boolean };
  coverage: { runsCounted: number; runsRecordedLate: number; runsNotEntered: number; runsInProgress: number;
    runsUncounted: { reason: ActivityUncountedReason; count: number }[]; runsUnplaced: number; checksUnplaced: number;
    runsSessionUnknown: number | null;                     // 只在带 sessionRefs 时是数
    checksGateUnplaced: number | null };                   // 只在带 sessionRefs 时是数：一个负责的 Session 都没有的 Goal 门检查项（L9 第 4 步）
  recordingSince: string | null;
  checksAttribution: 'round_start';                        // §0.1 告知 5
};
export type RunActivityViewV1 = {
  runRef: RunRef; status: 'counted' | 'not_entered' | 'in_progress' | 'unknown';
  reason: ActivityUncountedReason | 'recorded_late' | null; error: boolean;
  totals: ActivityTotalsV1 | null;
  changedFiles: { definite: number; possible: number; possiblyIncomplete: boolean } | null;
  usage: (RunModelUsageV1['totals'] & { complete: boolean }) | null;
  recordedBy: 'run_end' | 'backfill' | null;
  recordedAt: string | null;                                // L10：这条记录写下的时刻；没有记录为 null
  countedThroughTurnEnd: boolean | null;                    // L10：counted 时是 facts.window.turnTerminal，别的为 null
  unresolvedCalls: number | null;                           // L10：counted 时是 facts.window.unresolvedCalls，别的为 null（第二轮第 2 条）
};
export type TrackBarV1 =
  | { kind: 'run'; runRef: RunRef; taskId: string; sessionRef: SessionRef | null; startAt: string; endAt: string | null;
      result: 'running' | 'completed' | 'failed' | 'budget_exhausted' | 'cancelled' | 'paused' | 'interrupted' | 'outcome_unknown' | 'yielded';
      reason: string | null;                                      // 已存的文字，≤ 500 字符
      pauses: { from: string; to: string | null; intentRef: ControlIntentRef }[];   // 只取进入以后、结束以前的（L12）
      attempt: { attemptId: string; via: 'first' | 'same_attempt' | 'requeue' | 'wait_continuation';
                 requeue: { actorClass: string; automaticCount: number | null; reason: string } | null };
      previous: RunRef | null; activity: RunActivityViewV1 }
  | { kind: 'check'; roundRef: VerificationRoundRef; taskId: string;
      sessionRef: SessionRef | null;                              // 普通检查：主体执行的领取 Session；门检查：正好一个负责的 Session 时是它，否则 null（L12）
      ownerSessionRefs: SessionRef[] | null;                      // 门检查：读的这一刻门任务上有开着的负责关系的每个 Session，按 refKey 排；普通检查为 null（第三次复核第 3 条）
      startAt: string; endAt: string | null;                      // endAt：定案的时刻（L14 末尾）；还开着为 null
      result: 'open' | 'PASS' | 'FAIL' | 'INCONCLUSIVE';          // 定案的取轮次存下的 outcome
      ordinal: number; checksBegun: number; previous: VerificationRoundRef | null }
  | { kind: 'query'; queryRunRef: QueryRunRef; sessionRef: SessionRef; askedSessionRef: SessionRef | null;
      via: 'turn' | 'consultation'; startAt: string; endAt: string | null;
      result: 'running' | NonNullable<QueryRunV1['outcome']> | 'unknown' };
export type TrackBarsPageV1 = { goalRef: GoalRef; from: string; to: string; bars: TrackBarV1[]; next: string | null;
  hostRestarts: { at: string; approximate: true }[]; queriesIncluded: boolean;
  unplaced: { runs: number; rounds: number; gateRounds: number } };
  // rounds：没有 since 的，和 2B 以前定案、没存定案时刻的（L12 第 5 段）
  // gateRounds：带 sessionRefs 时，一个负责的 Session 都没有（ownerSessionRefs 为空）的门检查（L12；第二轮第 4 条、第三次复核第 3 条）；不带 sessionRefs 时为 0
export interface ActivityReadPort {
  readActivityCalendar(ctx: CoreCallContext, input: { goalRef: GoalRef; from: string; to: string;
    granularity: 'hour' | 'day'; timeZone: string; sessionRefs?: SessionRef[] }): Promise<ReadResult<ActivityCalendarV1>>;
  readRunActivities(ctx: CoreCallContext, input: { runRefs: RunRef[] }): Promise<ReadResult<RunActivityViewV1[]>>;   // 1..200
  readTrackBars(ctx: CoreCallContext, input: { goalRef: GoalRef; from: string; to: string;
    cursor: string | null; limit: number; sessionRefs?: SessionRef[] }): Promise<ReadResult<TrackBarsPageV1>>;      // 1..500；≤ 33
}

// src/core/work-graph/views/task-state-timeline.ts（新）
export type HistoricalTaskStateV1 =
  | 'not_in_plan' | 'unknown' | 'pending' | 'running' | 'awaiting_check' | 'verifying' | 'satisfied' | 'check_failed'
  | 'check_incomplete' | 'run_failed' | 'run_cancelled' | 'interrupted' | 'interrupted_pending_check' | 'paused'
  | 'waiting_reply' | 'outcome_unknown' | 'deferred' | 'cancelled' | 'superseded';
export type TaskStatePointKindV1 = 'plan_appear' | 'disposition' | 'requeue' | 'run_start' | 'pause' | 'resume'
  | 'run_end' | 'anomaly' | 'check_start' | 'check_end';
export type TaskStateSegmentV1 = { from: string | null; to: string | null; state: HistoricalTaskStateV1;
  point: { kind: TaskStatePointKindV1; at: string; source: AggregateRef } | null };   // 让显示状态变了的那个点（L11）
export type TaskStateTimelinePageV1 = {
  goalRef: GoalRef; approximate: true;
  tasks: { taskId: string; segments: TaskStateSegmentV1[]; untimedPoints: { kind: TaskStatePointKindV1; source: AggregateRef }[] }[];
  next: string | null;
};
export interface TaskTimelineReadPort {
  readTaskStateTimeline(ctx: CoreCallContext, input: { goalRef: GoalRef; cursor: string | null; limit: number }):
    Promise<ReadResult<TaskStateTimelinePageV1>>;                                                               // 1..200
}
```

```ts
// 检查轮次定案的时刻（L14 末尾；lead 2026-10-14 选甲（简单；可以按时刻建排序索引））
// src/core/work-graph/persistence/evidence-record-codecs.ts：VerificationRound 记录顶层，和 since 一样不进 RoundSnapshot
type RoundFinalizationWireV1 = { finalizedAt?: string };   // ISO，Z 结尾；只有 VR-07 定案的那次提交写，改写时保留；开着的、2B 以前定案的没有
```

```ts
// Workflow：src/business/workflow/contracts.ts（新增）
export type ActivityBackfillBatchV1 = {
  processed: { runRef: RunRef; outcome: 'counted' | 'unknown' | 'unchanged' | 'skipped' | 'not_entered' | 'retry_later'; reason: string | null }[];
  // skipped：挑候选以后、写之前记录被别人写了（L8），原因 record_changed；不是候选的执行不出现在这里
  next: string | null;     // 不透明游标；null = 做完了。遇到 retry_later 时指向那个执行
  done: boolean;
};
backfillRecentActivity(ctx: CoreCallContext, input: { workspace: WorkspaceScope; cursor: string | null }):
  Promise<ReadResult<ActivityBackfillBatchV1>>;                                    // Host 后台；范围 [now − 14 天, now)
backfillActivityRange(ctx: CoreCallContext, input: { workspace: WorkspaceScope; from: string; to: string;
  cursor: string | null }): Promise<ReadResult<ActivityBackfillBatchV1>>;          // 只认人；没有租约的 Host 上 busy
```

```ts
// 路由（CORE_ROUTE_SPECS 新增；拥有者 activity、timeline 在组合根里不可枚举）
'activity/calendar': { kind: 'plain', binding: 'readActivityCalendar', owner: 'activity.readActivityCalendar' },
'activity/runs':     { kind: 'plain', binding: 'readRunActivities',   owner: 'activity.readRunActivities' },
'activity/track':    { kind: 'plain', binding: 'readTrackBars',       owner: 'activity.readTrackBars' },
'tasks/timeline':    { kind: 'plain', binding: 'readTaskStateTimeline', owner: 'timeline.readTaskStateTimeline' },
'activity/backfill': { kind: 'plain', binding: 'backfillActivityRange', owner: 'workflow.backfillActivityRange' },   // 只认人
```

账本事件：补算的一次写入 `RunActivityRecorded`；开始记录 `ActivityRecordingStarted`。结束提交里写的 `RunActivity` 不加事件。

## 3. 流程行（不新增状态机的行）

| 行 | 何时 | 做什么 | 结果 |
| --- | --- | --- | --- |
| B1 | 执行结束（L5 表各行） | Runtime 读 Turn 算 `facts`，放进结束提交 | 同一次提交建 `RunActivity`；算不出来写 `unknown` |
| B2 | Host 启动，有租约 | 确保每个工作区有 `ActivityRecording`；启动核对以后后台一批一批补最近 14 天里缺的、可以重试的 | 缺的补上（开始记录以后的标“补记”）；没有要补的不写 |
| B3 | 人点补算 | 按区间一批一批 | 返回做了哪些、下一批游标；可中断、可重做 |
| B4 | 读日历 | L9 | 每格的数、未计数、进行中；读失败报失败；太大报 `capacity` |
| B5 | 读每个执行的活动、横条 | L10、L12 | 同上 |
| B6 | 读时间竖条 | L11 | 每个任务的段，近似 |
| B7 | 冲突提示读改过的文件 | L13 | 真实的文件和 `possiblyIncomplete` |

## 4. 规则

1. 计数只从 Kernel 的原始记录按 L1、L2 算；同样的记录得同样的数；不调用模型。只有 `edit`、`shell` 算编辑。
2. 0 只表示“确实算过，没有活动”。没算、算不了、读不到、还在跑，都不是 0，各有原因。
3. 未知的编辑单独给出，从不并进编辑数，也不当 0。
4. 计数写在结束执行的同一次提交里。算不出来不挡结束。计数从不改 Run、Task、Attempt 的状态（决定 20）。
5. 一个执行只有一条计数。补算重做、重启、结束提交的重试都不会多算；结束提交的重试提交同一份计数。迟到证据（RUN-21）只把没算完的那条换成算完的（L4）。
6. 读取不写任何东西，不读 Kernel，不补算。读失败报失败，不报空，不报 0。部分的数不当总数（`complete`）。超了读的上限报 `capacity`，不截断。
7. 补算不调用模型，只写 `RunActivity`。自动的每次 Host 启动做最近 14 天（从现在往前）里缺计数的、可以重试的“未知”；更早的由人点。开始记录以后才补上的标“补记”，算错误（决定 49“缺失算错误”）。
8. 时间竖条只用已存的时间点，标“近似”，不编时刻。还没进入的执行，继续以后回到“待开始”，不是“在跑”；执行结束以后才到的暂停、继续不改状态；“中断，待核对”到下一次开始才消，中间的重新入队不消它（L11）。
9. 日历按目标读；归档线的活动照算；本片不数线（决定 30 不受影响）。横条里的查询按 Session 读，只读咨询画在被问的那条线上（决定 25）。
10. 参数证明新旧文本相同的编辑不算编辑，也不算未知编辑，不论结果是什么、知不知道；别的结果未知的一律算未知编辑；命令前后的比较没做完，空路径不当“没改”（L1）。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同 K 片 §5、2A §5：
- 用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败的测试，再写刚好通过的实现；
- 不读数据库核对；期望值来自规格或手算的例子，不从被测系统读回来；
- 测试名以行号开头；一行里列了几种情况的，每种都要有断言；
- 时刻：`Date` 和平台的 `now` 由夹具一起拨（F14、F36），预算的 `timeoutMs` 为 `null`（§7）。

### 5.1 测试入口（用户 2026-10-14 确认）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| BE0 | **计数规则。** 纯函数 `tallyTurnActivity`，输入手写的 Kernel 记录序列：夹具用 Kernel 自己的事件结构（`agentEventSchema`）逐条校验，再包成 `agent.event` 记录。只这一个入口是纯函数：L1 的表有 10 行，有几种真实工具按不出来（`possible` 带路径、结果未知、下一个小时才有结果、写工具的结果未知、取消、超时、结果未知或没结果的新旧相同编辑、命令后的快照读失败），在别的入口上造不出来 | L1 每一行和先后；L2 的分格、跨小时、上限和 overflow；L3 的文件和用量 | 真实工具会不会发出这些事件；结束提交的接线 |
| BE1 | **执行结束就记下。** 平台模式的业务流程：真实 Runtime、真实冻结 Kernel、脚本模型；工具用真实的 `edit`、`read` 和平台的协作工具，不用 `shell`；执行经观察者正常结束；用公开的 `readRunActivities`、`readActivityCalendar` 看计数；改过的文件看公开的冲突读取 `decisions.queryGoalConflicts`：夹具的目标不采用架构目录，执行改过的文件就全在这个目标的 `footprintCompleteness[].unmappedFiles` 里（`goal-conflicts.ts:331-336,477-479`），哪些是确定、哪些是可能看 `readRunActivities` 的条数（lead 2026-10-14 第 12 条） | 真实 `edit` 的编辑和改过的文件；跨小时（脚本模型的回复之间拨钟）；用量；被拒的调用；算不出来不挡结束；Run 和 Task 的状态不受影响 | 真实 `shell` 的快照（BE1s）；真实模型；单个文件是确定还是可能（BE0 管） |
| BE1s | **真实命令。** 同 BE1，但用真实 `shell`，在有 bwrap 的环境由 lead 在外面跑（同 K 片的沙箱入口） | 命令改了文件、只动了 HEAD、什么都没改、失败但改了文件、取消时已改了文件、取消和超时时什么都没改 | 快照看不到的路径（F9）；命令走异常分支（BE0 管） |
| BE1r | **Runtime 级的结束和重试（这一轮新加，待用户确认，同这张表的其它入口）。** 沿用 `tests/runtime/B2-runtime-execution.test.ts`、`A2-reconcile-runtime.test.ts`、`R4-control-runtime.test.ts` 的夹具：真实 Runtime、真实冻结 Kernel、真实 WorkGraph 存储、脚本模型；可以挂一个能卡住、不理取消的测试工具（`blockingTool`、`controlledTool`），在 WorkGraph 端口外包一层让某次提交失败（同 B2 `:553`），在 Kernel 存储外包一层数读、让某次读失败或在某次读时取消（同 B2 `:339`）；用 `restartedHost` 模拟重启。看结果仍用公开的 `readRunActivities`。为什么要它：RUN-08、RUN-20(i)、RUN-21 要一个调用一直没结果，平台的真实工具做不到（F28）；观察者的“取消重读、重试结束提交”（L6）要在一次观察里精确地插进故障 | 观察者先存边界再重读、取消后没有新记录也能结束、第一次挂上的计数不变、RUN-08 的待提交项、迟到证据换掉没算完的计数 | 平台组合本身的接线（BE1、BE2 管）；这些测试工具不是 `edit`、`shell`，只算步骤和没结果的调用，不算编辑 |
| BE2 | **重启和各种结束方式。** 主机模式场景：Host 崩溃重启后的启动核对（RUN-18、19、20(i)(ii)、23、24）、进程内暂停后取消（RUN-23）、没进入就取消（RUN-09、RUN-09 (R)）、迟到证据（RUN-21）、人的认定（RUN-22）；Kernel 存储读不到的故障在 Kernel 存储边界注入 | 每种结束都有计数或写明未知；重启、重试不多算；读不到写未知，不写 0 | 没跑到的并发；要一直没结果的调用的那几种（BE1r）；RUN-17、RUN-20(iii)（BE2c） |
| BE2c | **核对函数这一层（第二轮第 2 条新加，待用户确认，同这张表的其它入口）。** 照 `tests/composition/A2-reconcile-classifier-platform.test.ts` 的做法：生产组合（`createTargetPlatform`，C2 的 Runtime 平台夹具）、真实 Kernel、脚本模型先跑出一个真实的 Turn；再把执行记录在内存里改回核对要看的样子（不碰存下的东西，同那份测试的 `unbooked`、改领取代际），直接调启动核对的 `reconcileRunAtStartup`；它的两个写入方换成只记下“要提交什么”的替身。断言的是**核对交给结束提交的 `activity`**（`recordRunResult` 或 `reconcileRun` 的输入里那一份），**不是**重启以后存下、读出来的东西。为什么要它：RUN-17（重启时还在 Entering、Kernel 的 Turn 已有终态）和 RUN-20(iii)（让出的终态、续上的等待重建不出）在主机模式里造不出来：进入的写入失败时驱动让 Kernel 停在暂停（`execution-driver.ts` 的进入钩子），不是终态，不能拿它冒充 RUN-17；第二种那份测试也是在内存里改代际造的 | 核对按这两种结束交出的计数：步骤、`turnTerminal`、`unresolvedCalls`、窗口 | 存下来、重启以后读出来（这一段和别的结束共用，由 BE2 管）；Host 真的走到这两种结束 |
| BE3 | **补算。** 主机模式场景。“旧执行”和“开始记录以后缺计数”的执行，用只在测试里的“计数关闭”开关造（§7：模块替身，让结束提交不带计数）；再开着计数启动 Host；自动补算，和经路由的人点补算 | 最近 14 天自动、更早的不动；开始记录以后缺的会补、补好标“补记”；可以重试的未知会再试；人点的区间、分批、中断后接着、重做不多算；不调模型；不改执行和任务的状态；谁能补 | 真实规模的耗时（lead 另量）；“计数关闭”开关本身是替身 |
| BE4 | **读取。** 公开的 `readActivityCalendar`、`readRunActivities`、`readTrackBars`、`readTaskStateTimeline`；数据由 BE1–BE3 的流程和真实的检查、控制、归档流程造出 | 本地时区（含 +5:30、夏令时）、时间窗、0 和未知分开、进行中、补记、检查项、任务和 Session、横条（含暂停的空隙、查询）、时间竖条的映射、分页、稳定窗口、读的上限、读取故障如实报 | 界面怎么画 |
| BE5 | **接到别处。** 第 5 片的公开 `queryGoalConflicts`；HTTP 路由（`CORE_ROUTE_SPECS` 里的五个），背后是真实的读写，不打桩 | 冲突提示读到真实的改过的文件；没进入的执行不算不全、分不清的算不全；读到底不报 `capacity`；路由原样传出；只认人；没有租约报 `busy`；故障如实传出 | 浏览器 |

### 5.2 验收行为

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| 2B-01 | BE0 | L1 表每一行至少一个例子，按第一条命中的算，每个都写出编辑、未知编辑和改过的文件：第 1 行：参数是新旧文本相同的 `edit`（`c.ts`），五种结果：成功；写完才看到取消（`tool.cancelled`，effects `confirmed` 带 `c.ts`）；分派器超时（`tool.failed`，`execution`，`timeout`，effects `confirmed` 带 `c.ts`）；`tool.outcome_unknown`；到窗口末尾没结果 → 五种都是编辑 0、未知编辑 0，`definite`、`possible` 都没有 `c.ts`，也不因它标不全。第 2 行：`shell` 的 `tool.outcome_unknown`（合成的 effects 是 `possible`、路径空）→ 未知编辑 1；参数新旧文本不同的 `edit`（`d.ts`）结果未知 → 未知编辑 1，`possible` 有 `d.ts`。第 3 行：到窗口末尾没结果 → 未知编辑 1。第 4 行（防御性的覆盖：真实的 `edit` 不会产生这种组合，版本相等时参数一定也相同，`workspace-sandbox.js:262`；留着是为了规则不只靠参数，第二轮第 9 条）：手写一条成功的 `edit`，输出的 `oldRevision` 等于 `newRevision`、参数不能证明 → 0，路径不进改过的文件。第 5 行：成功改文件 → 1；`tool.failed`（`execution`）和 `tool.cancelled` 带 `confirmed` 两个文件 → 编辑 1，两个都在 `definite`；`mode: 'create'` 建文件 → 1。第 6 行：只有 `.` → 0，`definite` 没有 `.`。第 7 行：`possible` 一个路径 → 未知编辑 1，路径在 `possible`。第 8 行：`shell` 的 `possible` 空路径、`workspaceRevision` 不为空，成功和退出码 3 各一个 → 0。第 9 行：`shell` 的 `possible` 空路径、`workspaceRevision` 为 `null`，两个：异常分支（写成命令后的快照读工作区失败时 `shell` 给的那样：`execution_failed`“shell 执行失败”）、分派器在处理函数抛错时给的 → 未知编辑 1。第 10 行：`none` → 0；分派器拒绝 → 步骤 1、编辑 0。没开始的：Hook 拦下、`abandoned` → 步骤 0。不是 `edit`、`shell` 的：通信工具的结果未知（合成 `possible`）和 `read` 的结果未知 → 步骤 1、编辑 0、未知编辑 0。另外：第 1 行里结果未知、没结果的那两次，第 2、3 行的调用，通信工具、`read` 的结果未知，都算进 `unresolvedCalls`；有终态事件的窗口 `turnTerminal` 为真，读到还没结束的为假 | L1；lead 2026-10-14 第 1、2 条和定的先后；手写例子 |
| 2B-02 | BE0 | 时间：一次调用 10:59:50 开始、11:00:20 有结果 → 记在 10:45 那格；10:44 和 10:46 的两次在 10:30、10:45 两格；1,001 个不同的格 → 存 1,000 格加 `overflow`（总数、起止对）；`span` 用的 `turnStartedAt`、`lastRecordAt` 等于手写记录的时刻，没有工具调用的 Turn 也不为空 | L2、L4 |
| 2B-03 | BE0 | 改过的文件和用量：`definite` 是 L1 第 5 行的路径去掉 `.`、不含新旧相同的；`possible` 有结果未知的 `edit` 请求的路径；跑过 `shell` → `possiblyIncomplete`，原因 `command_ran`；有未知编辑 → 原因 `edits_unknown`；501 个路径 → 500 条、略去 1；4 次请求 3 次报了用量 → 总数是 3 次之和、`complete: false`，没报的那次 `unknown`、token 为空 | L3 |
| 2B-04 | BE1 | 一个执行在 UTC 10:00–10:59 里调了 5 次工具：`edit` 改 `a.ts`；`edit` 建 `b.ts`；`edit` 新旧文本相同（`c.ts`）；`read` 一次；图工具 `look` 一次。`observe` 返回时 `readRunActivities` 已读得到：步骤 5、编辑 2、未知编辑 0、`changedFiles` 确定 2、可能 0、`recordedBy: 'run_end'`、`recordedAt` 等于结束提交时夹具的平台时刻、`countedThroughTurnEnd: true`；日历（UTC、`hour`）10 点那格 5/2/0、`complete`；冲突读取里这个目标的 `unmappedFiles` 正好是 `a.ts`、`b.ts`，没有 `c.ts`。真实 `edit` 很快，造不出取消、超时、结果未知的新旧相同编辑，这几种只在 2B-01 | L1、L3、L10；手写例子 |
| 2B-05 | BE1 | 跨小时：一个执行 10:40–12:10（脚本模型的回复之间拨钟），调用在 10:44、10:46、11:20、12:05 → 按小时读 10 点 2、11 点 1、12 点 1；按 15 分钟存的 10:30、10:45 两格并成 10 点一格 | L2；决定 50 |
| 2B-06 | BE1 | 算不算步骤的边界：读权限 Hook 拦下的读（没有 `tool.started`）→ 不算；调用数用尽以后剩下没开始的 → 不算；开始后被拒（`shell` 在沙箱不可用时 → `sandbox_unavailable`，夹具把 `CODING_AGENT_BWRAP_PATH` 设成不存在的绝对路径，每台机器上都一样；参数不对 → `invalid_arguments`）→ 步骤 1、编辑 0；发消息的通信工具 → 步骤 1、编辑 0 | L1；F5、F6、F10、F29 |
| 2B-07 | BE1 | 用量：脚本模型 4 次请求，3 次报了用量（手写的数）、1 次没报 → `readRunActivities` 的用量总数是 3 次之和，`complete: false` | L3 |
| 2B-08 | BE1 | 结束不受计数影响：同一份脚本，执行和任务的状态、结果与手写的期望一样；在算计数的那次重读上注入一次 Kernel 读失败（夹具先在执行中途观察一次，让结束那次观察要单独重读，L6）→ 执行照样结束，计数 `unknown('history_read_failed')`，日历上它覆盖的小时有 1 个未计数的执行 | L5、L6；规则 4 |
| 2B-09 | BE1s | 真实 `shell`，每种一个：`touch d.ts e.ts` → 编辑 1、`definite` 有 `d.ts e.ts`；`git checkout -b x` → 只有 `.`，编辑 0；`ls` → 编辑 0（L1 第 8 行）；`echo x > f.ts; exit 3` → 失败、编辑 1、`definite` 有 `f.ts`；`echo y > g.ts; sleep 30` 时取消执行 → `tool.cancelled`、编辑 1、`definite` 有 `g.ts`；什么都没改的取消（`sleep 30` 时取消）→ `tool.cancelled`、编辑 0、未知编辑 0；什么都没改的超时（`sleep 200`，参数 `timeoutMs: 100`）→ `tool.failed`（`timeout`）、编辑 0、未知编辑 0；都 `possiblyIncomplete`（`command_ran`）。改过的文件照 2B-04 的读法：`unmappedFiles` 正好是 `d.ts e.ts f.ts g.ts`，没有 `.`，两个没改的不添文件。另一个只读的 Work（写范围为空、开着只读命令）用 K 片 B 的 `run_readonly_command` 跑 `ls` → 步骤 1、编辑 0、不进改过的文件 | L1、L3；F8；§0.1 告知 1；lead 2026-10-14 第 1、2 条；K 片 B |
| 2B-10 | BE2 | Kernel 写下了终态、结果没记账（同 A8-3a：最后一次模型调用时锁住账本，观察者的 `recordRunResult` 失败），重启后启动核对按 RUN-18 记下结束：计数和 2B-04 同一份工具序列的手写期望一样；再重启一次，计数不变 | L5；规则 5 |
| 2B-11 | BE2、BE1r | 启动核对的其它结束，每种一个例子：Host 在一次模型调用中崩溃（Kernel 没有终态、没有在跑的调用）→ RUN-19，`counted`、`countedThroughTurnEnd: false`；RUN-24（人暂停后重启）→ `counted`、`countedThroughTurnEnd: false`；RUN-20(i)（有在跑的调用；BE1r 的卡住的测试工具，同 `A2-reconcile-runtime.test.ts:230`）→ `counted`、`countedThroughTurnEnd: false`，那次调用算步骤；RUN-20(ii)（探测说 Kernel 读不到）→ `unknown('kernel_unreadable')`，日历上它从开始到结束的每个小时 `uncountedRuns: 1`，不是 0 | L5、L7；F27 |
| 2B-12 | BE2 | 进程内暂停以后取消（RUN-23）→ `counted`；重启时的 RUN-23 → `counted` | L5 |
| 2B-13 | BE2 | 没进入就取消：进程内（RUN-09）、重启时（RUN-09 (R)）→ `readRunActivities` 是 `not_entered`、步骤 0；日历上没有它的格，也不算未计数 | L5、L7 |
| 2B-14 | BE2、BE1r | 迟到证据（RUN-21），两种：(a) RUN-20(ii) 以后 Kernel 又读得到，下次启动的核对按 RUN-21 记下 → `unknown` 换成 `counted`（`recordedBy: 'run_end'`）；同一次启动的自动补算在核对以后跑，`processed` 里没有它。(b) `counted`、没算完 → `counted`、算完（BE1r，同 `A2-reconcile-runtime.test.ts:230` 的造法）：工具还在跑时重启 → RUN-20(i)，`counted`、`countedThroughTurnEnd: false`、`unresolvedCalls: 1`、步骤 1；放开工具，Kernel 记下它的结果和终态；下次启动以前人点补算一次，区间盖住它 → `processed` 是空的，它的 `recordedAt` 不变（补算不换当前规则的 `counted`）；下次启动的核对按 RUN-21 记下 → `counted`、`countedThroughTurnEnd: true`、`unresolvedCalls: 0`、`recordedBy: 'run_end'`、`recordedAt` 是这次提交的时刻、步骤和手算一样（多了终态以前的那次模型回复里的调用就照手算）。两种都再启动一次（W-15，没有新证据）→ 记录不变（`recordedAt` 不变）。人认定（RUN-22）的执行 → 计数和认定前一样 | L4、L5、L8；lead 2026-10-14 第 4 条 |
| 2B-15 | BE2 | 观察者的结束提交回执丢了、重试 → 只有一条计数，数不变 | L6；规则 5 |
| 2B-16 | BE3 | “计数关闭”跑出 4 个执行，结束在 Host 第一次启动前 2 天、13 天、15 天、30 天；开着计数启动 Host → 自动补算做完前两个（`counted`、`recordedBy: 'backfill'`、不是补记），后两个读出来 `not_backfilled`；模型调用 0；执行和任务的状态与补算前一样（经公开读取）；再重启一次，前两条的 `recordedAt` 不变（`readRunActivities`），后两个仍 `not_backfilled` | L7、L8；决定 50 |
| 2B-17 | BE3 | 人点补算，区间盖住后两个，每批 1 个：第一次做 1 个、返回游标；停下不调，另一个仍 `not_backfilled`；用游标再调，做完，`next: null`；同一区间整个再跑一遍 → `processed: []`、`next: null`、`done: true`（算过的不是候选，L8），两个的数和 `recordedAt` 都不变 | L8；规则 5；lead 2026-10-14 第 12 条 |
| 2B-18 | BE3 | 补算写未知和重试：没有位置记录的旧执行 → `unknown('no_history_locator')`；Kernel 读不到（探测 `missing`）的、结束在 3 天前的 → 自动补算写 `unknown('kernel_unreadable')`；Kernel 恢复后再启动 → 自动换成 `counted`；读 Kernel 被拒一次（`unavailable`）→ 这一批这个执行 `retry_later`、什么都没写、游标指向它，下一批算好 | L4、L6、L8 |
| 2B-19 | BE3 | 开始记录以后结束、却没有计数的执行（“计数关闭”结束，2 天前）→ `not_recorded`、`error: true`，日历上记未计数、不是 0；读几次日历都不会自己补；下次 Host 启动 → `counted`、`recordedBy: 'backfill'`，读出来 `reason: 'recorded_late'`、`error: true`，日历计入它的步骤，覆盖情况 `runsRecordedLate: 1`。结束时记成 `unknown('history_read_failed')` 的（同 2B-08）→ 下次启动同样补好、标补记 | L7、L8；决定 49“缺失算错误” |
| 2B-20 | BE3 | 谁能补：成员身份、平台自动化身份调人点补算 → `forbidden`；用 `kind:'system'` 身份启动的 Host 的操作者 → 可以；没有实例租约的 Host：人点补算 → `busy`，不建开始记录，不自动补算，什么都不写 | L7、L8、L15；F35 |
| 2B-21 | BE4 | 今天、`Asia/Shanghai`、`hour`：UTC 02:10 的活动在本地 10 点那格；现在以后的格 `future: true`；总数是各格之和（手算） | L9 |
| 2B-22 | BE4 | 时区：`Asia/Kolkata` 下 UTC 10:20 的一步在本地 15 点、10:40 的一步在本地 16 点；`America/New_York` 2026-11-01（夏令时结束）UTC 05:30 和 06:30 的两步都在本地 1 点那一格，这一天 24 格；`day` 粒度按本地日期分 | L2、L9 |
| 2B-23 | BE4 | 0 和未知分开，同一个窗口里：算过、没有工具调用的执行 → 那几格 0 且 `complete`；`unknown` 的执行覆盖的格 → `uncountedRuns: 1`、`complete: false`；还在跑的执行 → 从开始到现在的格 `inProgressRuns: 1`；`not_backfilled` 的执行 → 未计数；窗口总数 `complete: false`，覆盖情况按原因各 1 | L7、L9；规则 2 |
| 2B-24 | BE4 | 检查：一轮 10:05 开始，4 项开始了 3 项 → 10 点那格检查 3；同一任务的重新检查一轮 11:10 开始、2 项 → 11 点那格 2；涉及的任务里有这个任务；没有 `since` 的旧轮次 → `checksUnplaced` 加上它开始了的项数；`checksAttribution: 'round_start'` | L9；§0.1 告知 5 |
| 2B-25 | BE4 | 不合法各报 `invalid`：`hour` 跨度 16 天；`day` 跨度 401 天；时刻不是 `Z`；`from` 是 10:10（不在整刻上）；`to` 是 11:00:30（带秒）；`from ≥ to`；时区不认识；`sessionRefs` 34 个。横条的 `from`、`to` 不在整刻上也报 `invalid` | L9、L12；lead 2026-10-14 第 8 条 |
| 2B-26 | BE4 | 一格里 5 个任务：取“步骤 + 编辑 + 检查项”最多的 3 个（同数按 taskId），`moreTasks: 2`；Session 照列；带一条线的 `sessionRefs` 时，只剩这条线的执行和它们的检查；领取 Session 读不出来的旧执行（派工记录缺）不算进去，`runsSessionUnknown: 1`。Goal 门的检查（同 2B-30 的造法：门的产出执行在 Session P 上，门任务开着的负责关系在 Session G 上，P ≠ G；一轮 10:05 开始、已开始 2 项）：带 `[G]` 时 10 点那格检查 2，带 `[P]` 时这 2 项不在任何格里，P 上的普通检查照旧按主体执行计入；交接没做完，门任务上同时有 G 和 G2 两条开着的负责关系（2C E1）：带 `[G]`、带 `[G2]` 时 10 点那格都有这 2 项，“涉及的 Session”列 G 和 G2，`checksGateUnplaced: 0`，带 `[P]` 时仍不在格里；关掉门任务所有的负责关系、没有新的，再读：带 `[G]` 或 `[P]` 时这 2 项都不在格里，`checksGateUnplaced: 2`；不带 `sessionRefs` 时 10 点那格照旧有这 2 项，`checksGateUnplaced` 为 `null` | L9、L12、L17；lead 2026-10-14（日历和横条统一）；第三次复核第 3 条 |
| 2B-27 | BE4 | 读取故障和规矩：在 RecordStore 边界让日历的某一步读失败（索引、记录、`eventAt` 各一个例子）→ 整个读取报失败，不返回空日历、不返回 0；`readRunActivities`、`readTrackBars`、`readTaskStateTimeline` 各一个例子；读的中途账本前进一次 → 重读，结果和手算一样；一直前进 → 一共读 4 次，都被打断，报 `unavailable`，不返回混合的数；注入读上限 10、窗口要读 11 次 → `capacity`，原因里有窗口和上限 | 规则 6；L17；决定 49 第 28 项 |
| 2B-28 | BE4 | 一个执行做完以后它的线被归档：它的活动照样在日历里 | L9；§0.1 告知 7 |
| 2B-29 | BE4 | `readRunActivities`：一次传 `counted`、补记、`not_entered`、进行中、`unknown`、`not_backfilled`、`not_recorded` 各一个，各自的状态、原因、`error`、`recordedBy`、`recordedAt`（没有记录的为 `null`）、`countedThroughTurnEnd`（只有 `counted` 的不为 `null`）对；传 201 个 → `invalid` | L7、L10 |
| 2B-30 | BE4 | 横条：窗口里两次尝试（第二次是系统重新入队）和两轮检查 → 四根，`previous` 连对；执行的横条带活动（同 L10）；一个执行在窗口前开始、窗口里结束也有；还在跑的执行 `endAt` 为空；一个执行 10:20 被你暂停（观察到 10:20:05）、10:50 继续（10:50:03）→ `pauses` 是 `[10:20:05, 10:50:03)`；一次 Host 重启出现在 `hostRestarts`；带秘书线的 `sessionRefs`：本目标的秘书回合有一根 `turn`，别的目标的没有；问了执行者线一次的只读咨询，横条在执行者线上（`askedSessionRef`）；不带 `sessionRefs` → `queriesIncluded: false`；`limit: 2` 翻 5 根 → 三页，不重不漏；`limit` 0 或 501 → `invalid`。检查的横条（lead 2026-10-14 第 5、6 条）：一轮周一开始、周三定案，读周二一整天的窗口 → 这一根在，起止是周一的开始和周三的定案；一轮的检查都被 Host 重启打断、一条证据都没收下就定案（INCONCLUSIVE）→ 这一根有结束（定案的时刻）、结果 `INCONCLUSIVE`，不是 `open`；没有 `since` 的旧轮次 → 不画，`unplaced.rounds` 加 1；2B 以前定案、没存定案时刻的轮次 → 不画，也不当开着，`unplaced.rounds` 加 1。Goal 门的检查（第二轮第 4 条）：门的产出执行在 Session P 上跑，门任务开着的负责关系在 Session G 上（P ≠ G）→ 不带 `sessionRefs` 时这一根的 `sessionRef` 是 G、`ownerSessionRefs: [G]`；带 `[G]` 时出现，带 `[P]` 时不出现；交接没做完，门任务上同时有 G 和 G2 两条开着的负责关系（2C E1）→ `sessionRef: null`、`ownerSessionRefs` 是 G、G2（按 refKey 排），带 `[G]`、带 `[G2]` 时都出现，带 `[P]` 时不出现，`unplaced.gateRounds: 0`；把门任务所有的负责关系关掉、没有新的，再读 → 不带 `sessionRefs` 时出现、`sessionRef: null`、`ownerSessionRefs: []`，带 `[G]` 或 `[P]` 时都不出现、`unplaced.gateRounds: 1`；同一窗口里 P 上的普通检查照旧按主体执行落在 P 上，`ownerSessionRefs: null` | L12；L14 末尾；2C L23、E1；第三次复核第 3 条 |
| 2B-31 | BE4 | 时间竖条的主例子：段落逐段等于 L11 的手写例子 | L11 |
| 2B-32 | BE4 | 时间竖条的其它结果，每种一个例子：让出 → `waiting_reply` 到下一次开始；2B-30 的暂停 → `[10:20:05, 10:50:03) paused`，前后 `running`；人暂停后重启（RUN-24）→ `paused`，你点继续（决定 54：同一条线、同一个 Session）那一刻的重新入队起 `pending`，下一次 `run_start` 起 `running`；结果未知 → `outcome_unknown`；取消的执行 → `run_cancelled`；计划改成延后、取消、替代 → 在那一版的采用时刻变成 `deferred`、`cancelled`、`superseded`；v1 就有、v4 改了定义的任务 → 从 v1 的采用时刻起 `pending`，不是从 v4；v3 延后、v5 恢复的任务 → v3 起 `deferred`、v5 起 `pending`；从没执行过的任务 → `not_in_plan` 然后 `pending`；一轮一条证据都没收下就定案（同 2B-30）→ 定案那一刻起 `check_incomplete`，不再是 `verifying`。折叠的先后，时刻各不相同（lead 2026-10-14 第 7 条）：(a) 执行 09:05 领取、没进入；09:10 你暂停（没进入，平台证明的 `paused`）→ `paused`；09:20 继续 → `pending`，不是 `running`；09:30 进入 → `running`。(b) 线被归档中断：执行 10:00 结束（中断）→ `interrupted`；异常锚点 10:01 → `interrupted_pending_check`；重新入队 10:02 → 仍是 `interrupted_pending_check`，不开新段；下一次进入 10:30 → `running`。归档在一次调用里结束执行、写异常锚点、请求重新入队，夹具让平台时钟每读一次往前走（或在这几步之间拨），三个时刻才各不相同 | L11；F21、F31、F33 |
| 2B-33 | BE4 | 时间竖条的分页和如实：5 个任务、`limit: 2` → 三页，按现行计划的顺序，每个任务出现一次；`limit` 0 或 201 → `invalid`；读第二页前现行计划换了 → `source_stale`；已经结束和已取消的目标照样读得到；结果标 `approximate: true`；没有 `since` 的轮次、`startedAt` 为空的执行进 `untimedPoints`，不编时刻；2B 以前定案、没存定案时刻的轮次 → `check_start`、`check_end` 都进 `untimedPoints`，没有 `verifying` 段。（上一稿的“暂停意图没有观察时刻”这个夹具删了：已存的控制意图 `applied` 时一定有 `observedAt`，造不出来，F30、L11） | L11；Q5 A |
| 2B-34 | BE5 | 冲突提示：目标 A 的执行用 `edit` 改了模块 M 里的文件 F，目标 B 计划改模块 M → 冲突卡的 `filePaths` 有 F，`executedFiles: 'available'`，A 的 `possiblyIncomplete: false`；A 再有一个没进入就取消的执行（RUN-09）→ 仍是 `false`，不添文件；A 再有一个计数 `unknown` 的执行 → `true`；另一个目标 C 只有一个开始记录以前结束、计数没补的执行（`not_backfilled`）→ C 的 `possiblyIncomplete: true`。注入读上限 10，A 的执行和记录加起来要读 20 次以上 → 照样 `available`，不报 `capacity`（L13 不受读上限） | L13；DESIGN §1.10“先按已经改过的文件比”；lead 2026-10-14 第 9、11 条 |
| 2B-35 | BE5 | 路由：`activity/calendar`、`activity/runs`、`activity/track`、`tasks/timeline` 返回的和公开读取一样；`activity/backfill` 只认人，成员 `forbidden`，没有租约的 Host 上 `busy`；把存储设成读失败，读的路由报故障，不报空 | L15 |
| 2B-36 | BE1r | 观察者取消重读（RUN-07）：执行中途先观察一次（缓存不空）；结束那次观察在重读整个 Turn 的第一页时取消它的 `signal` → `observe` 报 `cancelled`，执行没结束；Kernel 不再有新记录，再观察一次 → 执行结束，`readRunActivities` 是 `counted`，数和手算一样；模型调用次数没变 | L6 第 1–3 步；lead 2026-10-14 第 3 条 |
| 2B-37 | BE1r | 重读失败以后重试（RUN-07）：结束那次重读注入一次 Kernel 读失败（`unavailable`），同一次的 `recordRunResult` 也失败一次（同 B2 `:553` 在端口外包一层）→ 执行没结束；下一次观察不再重读，提交同一份输入 → 提交成功，没有 `idempotency_conflict`，`recordRunResult` 一共调了 2 次；计数是 `unknown('history_read_failed')`（第一次挂上的为准，虽然这次读得到）。以后由补算补（2B-19 已测） | L6 第 3、4 步；L8；lead 2026-10-14 第 3 条 |
| 2B-38 | BE1r | 结果未知的结束（RUN-08），三种：(a) 不理取消的工具被 Kernel 的排空超时定成结果未知（同 `R4-control-runtime.test.ts:239`）→ 执行 `outcome_unknown`，计数 `counted`、`countedThroughTurnEnd: true`、步骤和手算一样（那次调用算步骤；它不是 `edit`、`shell`，不算未知编辑）；(b) 同 (a)，结束那次重读时取消 `signal` → `observe` 报 `cancelled`，执行没结束；不再有新记录，再观察一次 → 执行结束，计数同 (a)；(c) 同 (a)，重读注入一次 Kernel 读失败，同一次记未知结束的 `recordRunResult` 也失败一次 → 下一次观察提交同一份输入（同一个事件，没有 `idempotency_conflict`），执行 `outcome_unknown`，计数 `unknown('history_read_failed')` | L5、L6；lead 2026-10-14 第 3、13 条 |
| 2B-39 | BE2c | RUN-17：一个真实跑到终态的执行，把交给核对的那份记录在内存里改回进入以前的样子，存下的都不动（同 A2 那份测试的 `unbooked`）：执行改回还在 Entering（`status: 'starting'`、授权 `entering`、没有 `startedAt` 和位置记录）；Session 用夹具在这个执行进入以前留下的那份快照，把它的 `historyCursor` 放回去（第三次复核第 1 条）。要放回去，是因为没有位置记录时核对从 Session 上最后一个已完成的边界往后找 Turn（`run-reconcile.ts:268-272`），而正常结束已经把这个边界推过了这个 Turn（`run-machine.ts:1536`）；不放回去，核对找不到它的 `turn.started`，会走 RUN-16。改好以后交给 `reconcileRunAtStartup` → 它交给 `recordRunResult` 的输入里，`activity` 是 `counted`、`turnTerminal: true`、`unresolvedCalls: 0`、步骤和手算一样、窗口从 `turn.started` 到终态（`end_position`），输入里同时带补记进入的 `enteredAt`。只断言交出的这一份，不断言存下、重启以后读出来的东西（BE2c）。不能用“让进入的写入失败”来造：那样驱动会让 Kernel 停在暂停，不是终态（第二轮第 2 条） | L5、L6；lead 2026-10-14 第 13 条；第二轮第 2 条 |
| 2B-40 | BE2c | RUN-20(iii)：同 `tests/composition/A2-reconcile-classifier-platform.test.ts:102` 的造法（真实的让出 Turn，在内存里把领取代际加 1）→ 它交给 `reconcileRun`（`unknown`、`continuation_unrebuildable`）的输入里，`activity` 是 `counted`、`turnTerminal: true`、`unresolvedCalls: 0`、步骤和手算一样（那次 `send_session_message` 算一步，不是编辑）。只断言交出的这一份（BE2c）；存下以后“迟到证据不换算完的计数”由 L4 第 4 行和 2B-14 的“再启动一次不变”管 | L4、L5；lead 2026-10-14 第 13 条；第二轮第 2 条 |
| 2B-41 | BE3 | 决定 54 的线补算，后面同一个 Session 里还有别的 Turn：执行 A 被你暂停时 Host 重启（RUN-24），“计数关闭”让这次结束不带计数；你点继续，K 片 A 追加 `run.interrupted` 关掉 A 的 Turn，同一个 Session 里接着跑执行 B（计数开着），B 调了 5 次工具；夹具把 Kernel 读窗口的页数上限注入成 1 页（200 条），A 的 Turn 不到 200 条，A 加 B 超过 200 条。下次 Host 启动的自动补算 → A 是 `counted`（补记），步骤是 A 自己的（手算），不含 B 的 5 次；不是 `capacity`；`countedThroughTurnEnd: true`（上界是 `readTurnBounds` 给的 A 的终点，L6 补算第 2 条）；B 的计数不变 | L6；决定 54；lead 2026-10-14 第 13 条 |
| 2B-42 | BE3、BE5 | 开始记录以前结束、既没有位置记录也没有任何授权的执行（平台模式里领取以后、授权以前就取消，RUN-09 从 Claimed；然后才起 Host）→ `readRunActivities` 是 `unknown`、原因 `not_backfilled`，不是 `not_entered`，不是 0；它的 `startedAt` 为空，所以盖住它结束时刻的日历窗口里：覆盖情况 `runsUnplaced: 1`，窗口总数 `complete: false`，没有哪一格因它记未计数（不编时段）；同一窗口的横条 `unplaced.runs: 1`、不画；冲突读取里它的目标 `possiblyIncomplete: true`；人点补算 → `unknown('no_history_locator')`（分不出它和没有位置记录的旧执行），日历上仍是 `runsUnplaced: 1`。同样的执行在开始记录以后结束 → `not_entered`、步骤 0、覆盖情况 `runsNotEntered: 1`、不算未计数也不算时间不明，冲突读取不因它标不全 | L7、L9、L12、L13；lead 2026-10-14 第 11、13 条；第二轮第 3 条 |
| 2B-43 | BE4 | 相邻的整刻窗口不丢不重：调用在 UTC 10:01、10:14、10:16、10:29；`hour`、UTC 读 `[10:00, 10:15)` 和 `[10:15, 10:30)` → 两次 10 点那格分别是 2 和 2，格的 `startAt`、`endAt` 分别是 10:00–10:15、10:15–10:30；读 `[10:00, 10:30)` → 4，等于两次之和；`Asia/Kolkata`（+5:30）读本地 15:30–15:45 和 15:45–16:00 两个窗口，加起来等于本地 15 点后半小时的数 | L2、L9；lead 2026-10-14 第 8 条 |
| 2B-44 | BE1r | 补算和迟到证据抢同一条记录（第二轮第 5 条）：工具还在跑时重启，重启的核对在 Kernel 存储边界注入探测 `missing` → RUN-20(ii)，计数 `unknown('kernel_unreadable')`；放开 Kernel 存储。人点补算一批（夹具在同一个存储上建 Workflow 的 `backfillActivityRange` 和它要的两个端口），区间盖住它、每批 1 个：它被选中（人点的候选含任何 `unknown`），补算写 `RunActivity` 的那次提交在 RecordStore 边界被夹具停住。这时放开工具（旧进程的工具晚到地返回，它下一次要模型调用时被拒，Turn 以这个失败结束，旧进程自己什么都不记），迟到证据按 RUN-21 提交：在新建的 Runtime 上明确观察一次，由这次观察在进程内记下（同 `A2-reconcile-runtime.test.ts:268-318`）；或下一次 `restartedHost` 的核对记下；夹具挑造得出的那种（第三次复核第 2 条）→ 记录换成 `counted`、`recordedBy: 'run_end'`。再放开补算 → 这一批 `processed` 是 `[{ outcome: 'skipped', reason: 'record_changed' }]`；`readRunActivities` 仍是 RUN-21 那一条：`counted`、`recordedBy: 'run_end'`、`countedThroughTurnEnd: true`、`unresolvedCalls: 0`、`recordedAt` 是 RUN-21 那次提交的时刻 | L4、L8；第二轮第 5 条 |
| 2B-45 | BE1r | 进程内的 RUN-21 把没算完的计数换成算完的（第二轮第 5 条；L5 RUN-21 行的第二条路）：照 `A2-reconcile-runtime.test.ts:268-318`（用例“RUN-21 in process”）：工具还在跑时重启 → RUN-20(i)：`counted`、`countedThroughTurnEnd: false`、`unresolvedCalls: 1`、步骤 1；在新建的 Runtime 上观察一次，结果未知的结束照旧不动。放开工具：旧进程的工具晚到地返回；执行已经结束，旧进程下一次要模型调用时被拒，它的 Turn 就以这个失败结束，旧进程自己什么都不记。再在新建的 Runtime 上明确观察一次 → 这次观察按 RUN-21 在进程内记下（核对记录 `basis.kind: 'live_clean'`）→ `readRunActivities`：`counted`、`countedThroughTurnEnd: true`、`unresolvedCalls: 0`、`recordedBy: 'run_end'`、步骤仍是 1；窗口到了 Turn 的终态，公开出来就是 `countedThroughTurnEnd: true`（只断言这些做得到的替换，第三次复核第 2 条：旧进程拿不到第二次模型回复，所以不断言多出来的用量，也不断言用量 `complete: true`） | L4、L5；第二轮第 5 条；第三次复核第 2 条 |

另由 lead 在验收时核对，不进测试：
- 结束提交和 `RunActivity` 在同一次提交里（看代码）；读取里没有 Kernel 读取、没有写入、没有模型调用（看代码）；
- 十个新索引的 `EXPLAIN QUERY PLAN`；
- 观察者的先后（L6）：RUN-07 从推进归约缓存到存好待提交项之间没有 await；RUN-08 是 L6 第 2 步写明的例外，存这一项之前可以读一次执行（取消了能恢复），但重读整个 Turn 一定在存好这一项之后；两种都只在待提交项上还没有 `activity` 时重读，挂上以后不再改（看代码；第二轮第 8 条）；
- 规模：在 DESIGN §9.3 的基准规模上，再量一次真实的读取：一个目标 2,000 个执行、1,000 轮检查时“全部”窗口的日历、横条，600 个任务的时间竖条，2,000 个执行的目标的冲突读取，加上 §7 新加的三种（很早的窄窗口、一个任务很多次尝试、整个工作区的决定队列）；记耗时进证据，不设断言。和冻结前量的存储读（§7）对一对；
- 补算每批的数（§7 的测法）。

### 5.3 要改断言的旧测试（lead 写出前后断言，DSH 不自行翻转）

| 测试 | 怎么改 |
| --- | --- |
| `tests/scenarios/S5-goal-conflict-rework.test.ts` SC02 第 52–54 行 | 生产组合换成真实实现（L13）。读冲突时两个目标都还没有执行：改成 `executedFiles: 'available'`、`possiblyIncomplete: false`。第 7 行的注释改成新的来源。SC02 其余断言不翻转；DSH 跑完整个 SC02，有别的出入停下报 lead |
| 注入桩的第 5 片测试：`tests/app/S5-decision-routes.test.ts:25`、`tests/work-graph/S5-decision-queue.test.ts:17`、`S5-goal-settings.test.ts:38`、`S5-notices.test.ts:13`、`tests/helpers/S5-application-support.ts:22`、`S5R2-b-support.ts:27`、`S5R2-c-support.ts:109` | 桩搬到 `tests/helpers/executed-files-stub.ts`（L13）：只改这几行 import 的路径。断言不翻转 |
| `tests/architecture/production-reach-allowlist.json` | 加五个新路由的 Body、Response 类型别名，每个一条 `wire-format`，照 784–842 行的写法（F34） |
| `tests/composition/platform.test.ts:56` | **不翻转**：`activity`、`timeline` 不可枚举（L15）。DSH 跑一遍确认 |
| 直接调 `recordRunResult`、`reconcileRun` 的测试，例如 `tests/work-graph/B2-execution-result.test.ts`、`tests/runtime/A2-reconcile-runtime.test.ts`、`tests/composition/A2-reconcile-classifier-platform.test.ts` | **不翻转**：`activity` 是可选输入 |
| 观察者的增量读和重试（请 lead 确认，lead 2026-10-14 第 13 条）：`tests/runtime/B2-runtime-execution.test.ts:339`（增量读，量的是 Turn 还没结束的那次观察）、`:372`（结束提交一直失败）、`:467`（撤销以后重放开始）、`:553`（同一个观察者不靠新记录重试结束提交）；`tests/composition/B2-runtime-platform.test.ts` 里调 `observeRun` 的用例 | **不翻转**。`:339` 量的那次观察没到终态，不重读；`:553` 第二次提交用挂在待提交项上的同一份计数，`attempts` 仍是 2，模型调用仍是 1；`:372`、`:467` 只看结束和占用。DSH 跑一遍确认，有出入停下报 lead |
| 控制和结果未知（请 lead 确认）：`tests/runtime/R4-control-runtime.test.ts:239`（真实 Kernel 的排空超时造出结果未知，RUN-08）和同文件其它用例；`tests/runtime/A2-reconcile-runtime.test.ts:230`（RUN-20(i) 以后 RUN-21）、`:558`（A8-3k，进程内 RUN-08 以后重启）；`tests/scenarios/A7-control.test.ts` | **不翻转**。RUN-08 改成先存待提交项、再重读、再提交（L6），这些用例断言的结束、核对记录、占用、意图的结果都不变；结束那次观察不再报 `ready` 而报 `cancelled` 只在 `signal` 已取消时，这些用例不取消观察。DSH 跑一遍确认，有出入停下报 lead |
| `tests/architecture/state-writes.test.ts:118-119`（轮次那一行保护 `RoundSnapshot` 的 `status`、`outcome`、`gaps`、`evidenceRefs`、`checks`、`chain`） | **不翻转，这一行不改**：`finalizedAt` 只在记录顶层、不在 `RoundSnapshot` 里，同 `since`（L14 末尾）。DSH 跑一遍确认 |
| 编码、解码、校验检查轮次记录或经过 VR-07 定案的测试：哪几条会读或数轮次记录的顶层字段，子任务没法逐条钉死 | **规矩：DSH 把它们都跑一遍，有任何一条断了就停下报 lead，不自行翻转。** 范围按引用找：引用了 `encodeVerificationRoundSnapshot`、`decodeVerificationRoundSnapshot`、`VERIFICATION_ROUND_SNAPSHOT_SCHEMA_ID` 或 `EVIDENCE_RECORD_SCHEMAS` 的测试和夹具（2026-10-14 在 a7cafccc 上搜到：`tests/work-graph/A2-step1-codecs.test.ts`、`A2-verification-chain.test.ts`、`A2-gate-chain-facts.test.ts`、`R3e-reverify.test.ts`、`S3-context-inputs.test.ts`、`S3-graph-context.test.ts`、`tests/state/invariants.ts` 和用它的 `invariants.test.ts`、`invariants-fuzz.test.ts`；夹具 `tests/helpers/R3e-evidence-fixture.ts`、`S1-session-facts-fixture.ts`、`S1-workflow-archive-fixture.ts`、`S5-decision-fixture.ts`、`S5-goal-settings-support.ts`、`S5-queue-support.ts`、`S5R2-c-support.ts`、`S5R2-d-support.ts`、`WP1-entry-fixture.ts`、`WP1-units-fixture.ts` 的使用者），加上 `tests/state/verification-machine.test.ts`。施工时在合入后的基线上重搜一次 |
| 数账本事件的场景：`tests/scenarios/A8-host-restart-lease.test.ts`、`A8-host-restart-attestation.test.ts`、`C3-brief-idempotency.test.ts`、`C7-defer-reactivate.test.ts`、`A7-control.test.ts:1115` | **不翻转**：结束提交里多一条记录、不多事件；开始记录只在第一次有租约的启动写一次；自动补算只在有缺的时才写，原因相同的未知不重写；不变量检查跳过它不认识的记录和事件（`tests/state/invariants.ts:376-377,489`）。DSH 跑一遍确认，有出入停下报 lead |
| 自己登记一套固定的记录、事件、索引的 Runtime 和平台夹具（第二轮第 6 条）：`tests/helpers/B2-runtime-fixture.ts:173-174`（BE1r 用它）、`B2-execution-fixture.ts:108-113`、`S1-runtime-scenario-fixture.ts:157`、`S1-session-facts-fixture.ts:65-66`、`S1-workflow-archive-fixture.ts:540-545`、`tests/state/invariants.ts:291-292`、`tests/work-graph/S3-prepared-context-admission.test.ts:200`；生产组合 `src/composition/create-platform.ts:448-470` | **不改这些夹具的登记，断言不翻转；新的登记靠继承拿到：** `RunActivity`、`ActivityRecording` 两种记录、两种事件和 `s2b-run-activity-by-goal-last`，由 `run-activity-codecs.ts` 导出成一组，并入 `EXECUTION_ENTRY_RECORD_SCHEMAS`（`persistence/execution-entry-codecs.ts:841`）。会提交结束的存储都已经登记了这一组（结束提交、核对提交的事件校验在里面），上面这些夹具和生产组合都是把它的 `records`、`events`、`lookups` 整组展开，所以自动带上。这一组今天的 `records` 是空的，注释说别的模块已登记的聚合不能再登记一次；`RunActivity`、`ActivityRecording` 没有别的登记处，不冲突。生产组合不再单独登记这一组（重复登记是冲突）。其余新索引登记在已有记录的所有者那一组里（Run 的两个在 `tasks/plan-readers.ts`，轮次的四个在 `EVIDENCE_RECORD_SCHEMAS`，其余在各自的 codec，L14），登记了这些组的夹具同样自动带上。BE1r 另外在同一个存储上建 activity 的读取和执行改过的文件读取（views 的工厂、`createGoalExecutedFilesReader`），存储当 `RecordOrderedLookupPort` 传进去（两个后端都实现它，2A §2）；这是给夹具加东西，不改已有用例。DSH 跑一遍这些夹具的使用者，有出入停下报 lead |

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **契约：** 新建 `src/contracts/run-activity.ts`；`src/contracts/ledger.ts`（`AggregateRef` 加两种引用）。
- **AgentRuntime：**
  - 新建 `run-activity-tally.ts`、`run-activity-reader.ts`；
  - 改 `execution-observation.ts`（先存待提交项再整读、提交带计数、RUN-08 的待提交项 `pendingUnknownEnds`、`recordUnknownEnd`）、`run-reconcile.ts`（启动核对和 `stopPausedRunInProcess` 带计数）、`ports.ts`、`runtime.ts`（`countRunActivity`，补算用 K 片 A 的 `readTurnBounds`）。
- **WorkGraph：**
  - `tasks`：新建 `run-activity-codecs.ts`（两种记录、两种事件、`s2b-run-activity-by-goal-last`）、`run-activity-service.ts`、`goal-executed-files-reader.ts`；改 `execution-entry-service.ts`（`recordRunResult` 同提交建记录、RUN-21 替换）、`run-reconcile-service.ts`（`reconcileRun` 同提交建记录）、`plan-readers.ts`（两个 Run 索引）、`run-reconcile-contracts.ts`；`executed-files-stub.ts` 搬到 `tests/helpers/`；
  - `model/execution-entry-contracts.ts`；
  - `persistence/evidence-record-codecs.ts`（四个检查轮次索引）、`persistence/control-record-codecs.ts`（`s2b-control-by-run`）、`persistence/plan-record-codecs.ts`（`s2b-plan-revision-by-goal`）；
  - 检查轮次定案的时刻 `finalizedAt`（L14 末尾，lead 2026-10-14 选甲）：`persistence/evidence-record-codecs.ts`、`persistence/decision-record-codecs.ts`、`persistence/rework-codecs.ts`、`evidence/evidence-service.ts`；不改 `state/verification-machine.ts`、`src/contracts/verification.ts`；
  - `queries/query-record-codecs.ts`（`s2b-query-run-by-session-ended`）；
  - `views`：新建 `activity-read-model.ts`、`track-read-model.ts`、`task-state-timeline.ts`。
  - 不改 `run-state-service.ts`（它是 `readExecution` 的读取，`createRunStateReader`），除非 `readExecution` 要变。
- **Workflow：** `contracts.ts`、`ports.ts`，新建 `activity-backfill.ts`。
- **Host：** `src/app/host.ts`（开始记录、后台自动补算、`leaseGated` 加 `backfillActivityRange`）、`core-routes.ts`、`core-http-types.ts`、界面路由标签表 `src/ui/api/routes.ts`。
- **组合：** `src/composition/create-platform.ts`（计数、读取、换掉桩、`activity` 和 `timeline` 加进不可枚举的拥有者表；用到按顺序索引的读取和服务都传 `backend.records`，它同时实现三个端口，§2；新记录随 `EXECUTION_ENTRY_RECORD_SCHEMAS` 登记，不另登记一次，§5.3）。
- **测试：** 新测试由 DSH 写；旧测试按 §5.3；`tests/helpers/executed-files-stub.ts`；`tests/architecture/production-reach-allowlist.json`。

## 7. 施工

- **前提：** 2A 合入；接线包 2、K 片 A 合入以后在新基线上开工（都改 `run-reconcile` 一带），并重核 §0.2。
- **冻结前 lead 量这几样（DESIGN §9.3“冻结前测定，本次不编造数字”）：**
  - **读取的代价：** 读取本身还没写，所以量 F37 数出来的那些存储读：在基准规模的合成库上（DESIGN §9.3 的 50,000 个执行；其中一个目标 2,000 个执行、1,000 轮检查、600 个任务；每条 `RunActivity` 带满 1,000 个路径的占一成），量按顺序索引的扫、按键读、`eventAt` 各做 F37 那么多次的耗时（2A 的按顺序查找合入以后量；合入前用等值索引加排序估，写明是估）。结果写进 §0.2，定 `ACTIVITY_READ_RECORD_CAP`。“全部”日历的存储读超过 2 秒，冻结前加按天汇总的记录（风险 2 的后半句），本规格改一轮再冻结；不超过就不加。
  - **再量三种会长大的情况**（lead 2026-10-14 第 10 条；冻结前量完、结果写进 §0.2，再冻结）：
    - **很早的窄窗口：** 同一个库，读 300 天前一天的日历和横条，窗口以后还有 1,800 个执行、900 轮检查。量存储读的次数和耗时，看它是不是和窗口以后的历史成正比（F37）。超过读上限的，记下要多大的上限，或者要不要给这几步加一个“结束得太晚就停”的条件。
    - **一个任务很多次尝试：** 一个任务 200 次执行，读时间竖条的一页（含这个任务）和覆盖这些执行的横条。量的是“每页每个任务的执行只读一次”（L11、L12）以后的读数和耗时，确认没有按执行重读。
    - **整个工作区的决定队列：** 工作区 300 个目标（同 2A 的计时数据集），其中 20 个目标各有 500 个执行、每条 `RunActivity` 带满 1,000 个路径的占一成。量一次读决定队列里冲突提示那一段：存储读的耗时，加上路径按模块归、两两比的耗时，分开记。不只量存储读。
  - **补算每批的数：** 在有真实数据的库上，用今天核对的读窗口函数（`run-reconcile.ts` 的 `readTurnWindow`）加归约，一批取 1、5、20、50 个执行各跑三次，记每批耗时的中位数；取耗时在一秒左右的那个数作默认，写进 DESIGN §9.3。
- **夹具由 Codex 先写，lead 核对后冻结：**
  - BE0 的 Kernel 记录构造器：按 `agentEventSchema` 逐条校验，包成 `agent.event` 记录，位置连续；
  - 时钟：用 `Date` 的替身（只替 `Date`），在脚本模型的回复之间拨；平台的 `now` 读同一个 `Date`，所以平台里直接 `new Date()` 的地方（F36）一起动；场景预算 `timeoutMs: null`，`maxToolCalls`、`maxRequests` 够用到行里最多的那一个；脚本模型能报用量；
  - “计数关闭”开关：只在测试里，用 vitest 的模块替身换掉 `run-activity-tally.ts` 和 `run-activity-reader.ts`，开关打开时让结束提交不带 `activity`（不写记录）。只给 BE3 造“旧执行”和“开始记录以后缺计数”的执行。生产代码里没有这个开关（F34）。“旧执行”在平台模式里跑（不起 Host，所以还没有开始记录），时钟拨到那几天，再拨到第 0 天起 Host；
  - 沙箱不可用：把 `CODING_AGENT_BWRAP_PATH` 设成不存在的绝对路径，测完恢复（F29）；
  - Kernel 存储边界的故障注入：探测 `missing`；读被拒一次 `unavailable`；读失败（K 片已有的可以复用）；某次读时取消调用方的 `signal`（BE1r，认出“结束前那次整读”的办法写在夹具里）；Kernel 读窗口页数上限的注入（2B-41）。RecordStore 边界的读失败注入、账本前进注入（稳定窗口）、读上限和每批数的注入；WorkGraph 端口外包一层让某次提交失败一次（同 B2 `:553`）；
  - BE1r 沿用的测试工具和重启替身（`blockingTool`、`controlledTool`、`restartedHost`），不另造；BE1r 另在同一个存储上建 activity 的读取、执行改过的文件读取和补算那一批（2B-44），并能在 RecordStore 边界停住某一次提交（§5.3 固定登记那一行）；
  - BE2c 沿用 `tests/composition/A2-reconcile-classifier-platform.test.ts` 的做法（C2 的 Runtime 平台夹具、内存里改执行记录、记下“要提交什么”的写入替身），不另造；
  - 没有 `since` 的旧检查轮次；2B 以前定案、没存定案时刻的轮次（写一条没有这个字段的定案轮次）；周一开始、周三定案的一轮；检查都被重启打断、一条证据都没收下就定案的一轮；带几版计划（改定义、延后后恢复、取消、替代）的目标；没进入时的暂停和继续、进入以后的暂停和继续；归档中断写下的异常锚点和随后的重新入队（时刻各不相同）；决定 54 的线（暂停时重启、继续以后同一个 Session 里接着跑）；开始记录以前领取、授权以前就取消的执行；Goal 门的产出执行和负责门任务的线在不同 Session 上，以及交接没做完、门任务上同时有两条开着的负责关系（2B-26、2B-30）；RUN-17 要的、执行进入以前的那份 Session 快照（2B-39）；秘书回合和只读咨询的查询。
- **DSH 分四组，各一个新 Session（决定 46），说明书带“子任务没回报完之前不要结束回合”：**
  - G1 计数规则和结束时写入（BE0、BE1、BE1r、BE2、BE2c：2B-01…2B-08、2B-10…2B-15、2B-36…2B-40、2B-45）；2B-09（BE1s）由 lead 在有 bwrap 的环境跑；
  - G2 补算（BE3、BE1r：2B-16…2B-20、2B-41、2B-42、2B-44）；
  - G3 日历、每个执行的活动、横条、换掉桩、路由（BE4、BE5：2B-21…2B-30、2B-34、2B-35、2B-43）；
  - G4 时间竖条（2B-31…2B-33）。
  - 顺序 G1 → G2 → G3、G4（G3、G4 可以并行）。每组派一个只读复查子任务。
  - 按 AGENTS.md 第 5 条，DSH 只在 18:00 以后跑；某天另有可用时段时按当天的说法（例如决定 53 记的 10-14）。
- **冻结时 lead 同步改文档：** MODEL O47、O48（去掉 `checks`，检查按轮次算）、O49、R58（读取不带 `backfill`，补算是单独的写）；DIAGRAMS；AMBIGUITIES AMB-46（关掉）；DESIGN §6“时间竖条”“活动日历”两行（暂停、异常锚点、查询的横条）、§9.2（时间竖条的映射，写成本稿 L11）、§9.3（每批数、读上限、量的结果）、§9.4 风险 2（关掉，写结论）、附录 C 第 8 个索引（改成本稿 L14 的十个）、第 14、15、17 个字段（改成独立记录），检查轮次定案时刻的字段 `finalizedAt`（L14 末尾）；E3-UI-ITEMS（进行中、未知的原因文字、“计数缺失（错误）”和“补记”、“范围太大”时拆窗口、横条上的暂停和查询、人点补算的按钮和进度）；STATUS。
- 其余同 K 片 §7：lead 核对、Codex 审；在有 bwrap 的环境跑全量；合入。记 DSH 和 lead 的用量。

## 8. 不做的事

- 不改 Kernel，不打补丁；
- 不改 Run、Task、Attempt 的状态机和保护字段，不给 Run 加字段；
- 不在读取时补算，也不现算还在跑的执行（§0.1 告知 2）；
- 不扫 Session 头找没有位置记录的 Turn；
- 不数查询里的工具调用（§0.1 以后再问）；
- 不数线，不做按工作区、跨目标的日历；
- 读取超了上限不截断，报 `capacity`（决定队列要的“执行改过的文件”不设上限，L13）；
- 不给 2B 以前定案的检查轮次补定案的时刻；
- 不做界面；
- 不调用真实模型。

## 9. Codex 审查怎么处理的

### 9.1 Codex 第一轮审查怎么处理的

审查：`D:/cc-lead-notes/codex2/s2b-spec.review1.md`（结论“还不能冻结”，14 条）。每条都按 lead 2026-10-14 同号的决定改。

| # | 审查说的 | 怎么处理的 | 改了哪里 |
| --- | --- | --- | --- |
| 1 | 新旧文本相同的编辑被取消、超时时，effects 仍是 `confirmed`，会被算成一次编辑 | 照改（lead 第 1 条）。L1 改成从上往下第一条命中的表；能证明什么都没改的 `edit` 不论结果都算 0。能证明的两种写死了：`tool.started` 的参数是 `replace` 且 `oldText` 等于 `newText`；或 `tool.completed` 输出里两个版本相等；`create` 从不算。先后由 lead 2026-10-14 定：参数证明的排在最前，结果未知、没结果的也算 0 编辑、0 未知编辑、不进文件（什么都不可能变）；输出证明的只在有结果时才有 | F6、F7；L1 第 1、4 行；L3；§4 规则 10；2B-01；2B-04（真实 `edit` 造不出取消、超时、结果未知，写明只在 BE0）；2B-09（命令没改文件时的取消、超时） |
| 2 | `possible`、空路径证明不了没改：命令后的快照或接受改动抛错时也是这个样子 | 照改（lead 第 2 条）。只有 `shell` 的 `possible`、空路径、`workspaceRevision` 不为空才算 0（两次快照比完才有这个版本）；其余空路径算未知编辑 1。`tool.outcome_unknown` 排在参数证明的新旧相同编辑之后、所有 effects 之前，不看它合成的 effects | F8；F11 (e)；L1 第 2、8、9 行；2B-01 加了命令后快照读失败、分派器抛错两个手写例子 |
| 3 | 观察者的重试、取消没写清：重读先失败后成功会换指纹；RUN-08 每次新造事件；缓存先推进、边界后存，取消在中间会卡住 | 照改（lead 第 3 条）。L6 写了四步：推进缓存 → 马上存待提交项（RUN-07 照旧，RUN-08 新加一项，存事件的 id 和时刻）→ 这一项还没有计数才重读，读成或读败都只挂一次，取消就不挂、不提交 → 提交这一项上的原样输入 | F17；L5 RUN-08 行；L6；§2 内部类型；2B-36、2B-37、2B-38 |
| 4 | RUN-21 换不掉没算完的 `counted`，文件、用量、尾巴永远缺 | 照改（lead 第 4 条）。L4 改成按顺序的表：RUN-21 的新窗口到 Turn 终态、比原来长，原来的没到终态或有没结果的调用，就换；同一个窗口不重算；补算从不换当前规则的 `counted`。`facts.window` 加 `unresolvedCalls` | L1 末尾；L4；L5 RUN-21 行；L8；§2；2B-14（加了“没算完 → 算完”和补算同时来的情况） |
| 5 | 检查定案可以一条证据都没有，结束时刻不能取证据的 `admittedAt` | 照改（lead 第 5 条）。核了代码：轮次上没存定案的时刻或位置，事件按键找不到（F20a）。结束取定案的时刻，结果取轮次存下的 `outcome`。存法：lead 2026-10-14 选甲（简单；可以按时刻建排序索引）：轮次记录顶层加 `finalizedAt`，VR-07 的提交写、以后的改写保留，不进 `RoundSnapshot`；2B 以前定案的没有它，只数进 `unplaced.rounds` 和 `untimedPoints`。`state-writes` 的保护表不变 | §0.1 告知 6；F20a、F21；L11 `check_end`；L12 检查的横条；L14 末尾；§1.1 5a；§2；§5.3；§6；2B-30、2B-32 |
| 6 | 横条借日历的“开始早于 from − 1 小时就停”，跨天的检查会消失；没有 `since` 的旧轮次没读 | 照改（lead 第 6 条）。横条改成按重叠读：新的按定案时刻排的索引从 `from` 往后读、开始早于 `to` 的，加上还开着的；没有 `since` 的用 `s2b-round-by-goal-legacy` 读、只数；2B 以前定案、没存定案时刻的也只数（子任务补的，不然它们会悄悄消失）。日历按开始计，留着原来的停法 | L9 第 4 步注；L12 第 3–5 段；L14 加两个索引；2B-30 |
| 7 | 时间竖条的点不能一律照表赋值：没进入时的继续会被画成在跑；归档先写异常、再重新入队，重新入队会把“中断，待核对”抹掉 | 照改（lead 第 7 条）。L11 改成有先后的折叠：三样状态（`base`、`anomalyOpen`、处置），暂停、继续看它的执行进入没有；异常到下一次进入才消；显示状态的取法有先后 | F21；L11；§4 规则 8；2B-32（时刻各不相同的两组例子） |
| 8 | 15 分钟一格存，任意窗口答不准 | 照改（lead 第 8 条）。日历和横条的 `from`、`to` 必须是 UTC 的整刻，否则 `invalid`；一格是本地小时和窗口的交 | §0.1 告知 9；L9；L12；2B-25；2B-43 |
| 9 | 新的读上限会让整个决定队列报 `capacity` | 照改（lead 第 9 条）。`createGoalExecutedFilesReader` 读到底，不受 `ACTIVITY_READ_RECORD_CAP`；代价进 §7 | §0.1 告知 11；F37；L13；L17；§8；2B-34 |
| 10 | 量法漏了几种会长大的情况；找前一根没说怎么复用 | 照改（lead 第 10 条）。§7 加三种：很早的窄窗口、一个任务很多次尝试、整个工作区的决定队列（存储读和路径归类分开量）；冻结前量完记下。L12 写明每页每个任务的执行只读一次、在内存里连前后 | F37；L11 每页读；L12 前一根；§5.2 验收核对；§7 |
| 11 | 没进入的执行本来就不写记录，L13 却当它不全 | 照改（lead 第 11 条）。L13 按 L7 分：证明没进入的不给文件、不算不全；分不清的旧执行仍算不全 | L13；2B-34；2B-42 |
| 12 | 几处断言看不到（文件路径、`turnTerminal`、`recordedAt`）；2B-17 的重跑和 L8 对不上 | 照改（lead 第 12 条）。`RunActivityViewV1` 加 `recordedAt`、`countedThroughTurnEnd`；文件路径经公开的冲突读取看（夹具不采用架构目录，文件都在 `unmappedFiles` 里），确定和可能看条数；2B-17 重跑期望 `processed: []`、数不变。不读数据库 | L10；§2；§5.1 BE1；2B-04、2B-09、2B-11、2B-16、2B-17、2B-29 |
| 13 | 缺 RUN-08、RUN-17、RUN-20(iii) 的验收行；缺重试、决定 54 补算、开始记录以前没有位置也没有授权的执行；2B-33 的夹具造不出来；§5.3 漏了观察者和控制的旧测试 | 照改（lead 第 13 条）。加 2B-36…2B-43 和入口 BE1r（这些要一个一直没结果的调用，平台的真实工具做不到）。补算的上界改成 `readTurnBounds` 在核对记录前面，决定 54 的那条线由它定界；2B-41 用注入的页数上限证明后面的 Turn 不进窗口、不报 `capacity`。`fallback` 整个删掉：`applied` 的意图一定有 `observedAt`（`control-record-codecs.ts:240-243,267-270,363-377`）。§5.3 列了 B2、R4、A2、A7 那几组，请 lead 确认不翻转 | L6 补算；L11；L12；§2；§5.1；§5.2；§5.3；§7 |
| 14 | F26、F17 说得太满：RUN-08 会先推进位置记录；待提交项只有 RUN-07 有 | 照改（lead 第 14 条） | F17、F26 |

### 9.2 Codex 第二轮审查怎么处理的

审查：`D:/cc-lead-notes/codex2/s2b-spec.review2.md`（结论“列出的几处改完就可以冻结”，9 条）。每条都按 lead 2026-10-14 第二轮同号的决定改。

| # | 审查说的 | 怎么处理的 | 改了哪里 |
| --- | --- | --- | --- |
| 1 | `createGoalExecutedFilesReader` 的依赖里没有按顺序查找 | 照改。它和别的用到按顺序索引的读取、服务，依赖都带上 2A 冻结的 `RecordOrderedLookupPort`；组合根传同一个实现了三个端口的 `backend.records` | §2；§6 组合 |
| 2 | 2B-40 的造法不是主机场景；`unresolvedCalls` 是私有字段；RUN-17 的夹具没定 | 照改。简单查过，主机模式造不出 RUN-17（进入写失败时 Kernel 停在暂停，不能冒充）和 RUN-20(iii)。新加入口 BE2c（核对函数这一层，待用户确认），明说它断言的是交给结束提交的计数，不是重启以后存下的东西。`RunActivityViewV1` 加公开的 `unresolvedCalls` | L10；§2；§5.1 BE2、BE2c；2B-14、2B-39、2B-40；§7 |
| 3 | 授权以前就取消的执行没有开始的时刻，2B-42 却编了小时；横条的筛法把它丢了 | 照改。2B-42 期望 `runsUnplaced: 1`、窗口不全、没有哪一格记未计数。L12 写明：开始为空、结束在窗口里的执行留下来，只数进 `unplaced.runs`。L9 第 1、2 步用同样的条件（子任务顺手对齐） | L9；L12；2B-42 |
| 4 | Goal 门检查的横条落在哪个 Session、怎么筛，没说清 | 照改。门检查落在读横条这一刻门任务开着的负责关系所在的 Session（按 `session-links-by-task` 读）；没有就是 `null`，只在整个目标的读取里出现，带 `sessionRefs` 时数进新的 `unplaced.gateRounds`；普通检查照旧。和 2C L23 一致 | L12；§2 `TrackBarsPageV1`；2B-30 |
| 5 | RUN-21 的验收没有真的抢写，也没有进程内那一路 | 照改。新加 2B-44（补算选中、停在存储边界、RUN-21 先提交、补算报 `skipped`/`record_changed`、留下 RUN-21 的那条）和 2B-45（进程内 RUN-21，换了以后才有的用量） | 2B-44、2B-45；2B-14 加 `unresolvedCalls` |
| 6 | §5.3 漏了自己登记一套固定记录的 Runtime 夹具 | 照改。列了这些夹具和生产组合；新记录并进 `EXECUTION_ENTRY_RECORD_SCHEMAS`，它们整组展开，所以自动带上；不改它们的断言 | §5.3；§6；§7 |
| 7 | 删掉翻转 2C 断言的条件指示 | 照改。§0.4 的 2C 那一条和 §5.3 的条件行删了；第 5 片生产组合那一处照旧 | §0.4；§5.3 |
| 8 | 验收核对里的“中间不 await”和 RUN-08 的例外自相矛盾 | 照改。“不 await”只管 RUN-07；RUN-08 存这一项之前可以读一次执行，写成明说的例外，理由是取消了能恢复 | L6 第 2 步；§5.2 后面 lead 的验收核对 |
| 9 | BE0 里有一条真实工具造不出的组合 | 照留，标成防御性的覆盖 | 2B-01 |
| 补 | 第二轮改完以后子任务提的三处（lead 2026-10-14 定） | ① L9 第 1、2 步的对齐照收：开始为空的执行只算结束在窗口里的，证明没进入的记 `runsNotEntered`，不算时间不明。② 门任务读到不止一条开着的负责关系：当时定成 `sessionRef: null`、写成防御、数进 `unplaced.gateRounds`；**已被第三次复核第 3 条换掉**（多条是做得到的情况，改成交出 `ownerSessionRefs`，只有一条都没有的才数进 `gateRounds`，见 §9.3）。③ 日历和横条统一：日历带 `sessionRefs` 时，门检查按 L12 的同一条规则落在门任务负责的 Session，不看产出执行；一个负责 Session 都没有的不进带筛选的格子，记进新的覆盖字段 `checksGateUnplaced`；普通检查照旧 | L9 输入和第 4 步、整个窗口返回；L12 检查的横条；§2 `ActivityCalendarV1.coverage`；2B-26 |

### 9.3 Codex 第三次复核怎么处理的

复核：`D:/cc-lead-notes/codex2/s2b-spec.review3.md`（结论“列出的几处改完就可以冻结”）。每条按 lead 2026-10-14 第三次复核同号的决定改。

| # | 复核说的 | 怎么处理的 | 改了哪里 |
| --- | --- | --- | --- |
| 1 | RUN-17 的造法里没有位置记录，核对从 Session 上最后一个已完成的边界往后找，正常结束已经把边界推过了这个 Turn，会走 RUN-16 | 照改。交给核对的那份记录里，Session 用执行进入以前留下的快照、放回它的 `historyCursor`，和改回 Entering 的执行字段一起；存下的都不动 | 2B-39；§7 夹具 |
| 2 | 2B-45 期望旧进程拿到第二次模型回复，可执行结束以后它的模型调用会被拒；进程内的 RUN-21 是在新建的 Runtime 上明确观察一次记下的 | 照改。写明在新建的 Runtime 上观察一次；只断言做得到的替换（到了 Turn 的终态、`unresolvedCalls` 变 0、`countedThroughTurnEnd: true`），删掉多出来的用量和 `complete: true`。2B-44 的“旧 Runtime 记下”同样改 | 2B-44、2B-45 |
| 3 | 门任务上有多条开着的负责关系是做得到的情况（交接没做完，2C E1），不是防御 | 照改。门检查交出 `ownerSessionRefs`（读的这一刻在门任务上有开着的负责关系的每个 Session，按 refKey 排）；正好一个时 `sessionRef` 是它，否则为 `null`；带 `sessionRefs` 时有一个负责 Session 在里面就算；只有一个都没有的才数进 `unplaced.gateRounds`、`checksGateUnplaced`。写明 2C L23 在交接没做完时指的是 2C E1 去重以后的那条线 | L9 输入和第 4 步、整个窗口返回；L12 检查的横条；§2 `TrackBarV1`、`TrackBarsPageV1`、`ActivityCalendarV1.coverage`；2B-26、2B-30；§9.2 补行 |
| 4 | 接线包 2 已合入：核对的提交现在带 `unavailableSince` 的提交位置绑定 | 照改。L5、§0.4 写明加计数记录时这些绑定照留（`run-reconcile-service.ts:415-418`）；更新了顶部的代码基线和 §0.4 接线包 2 那一条 | 状态行；代码基线；L5；§0.4 |

## 10. 冻结时的限定（lead，2026-10-14 夜）

和 §0–§9 同等有效；有冲突时以本节为准。

- **测试入口：** 用户 2026-10-14 确认了 BE0–BE5（含 BE1s、BE1r、BE2c）。
- **冻结前的实测（§7 第一项、“再量三种”；结果也写在 §0.2 F37 下面）。** 2A 合入以后的代码，真实的 SQLite RecordStore，量 F37 数出来的那些存储读。合成库是基准规模：50,000 个执行，其中一个目标 2,000 个执行（分在 600 个任务上）、1,000 轮检查；每个执行一条 `RunActivity`，一成带满 1,000 个路径；记录按形状造、直接写进存储（读取还没写，量的是存储读，不是读取本身），每条读回来的记录都解析一次 JSON 代替解码；三次取中位数。脚本和输出在 2B 证据目录的 `checks/`。
  - 每次读：按顺序索引一行 0.023 毫秒（执行这样的小记录）到 0.060 毫秒（`RunActivity`，一成带 1,000 个路径），按键读一条 0.044 毫秒，一次 `eventAt` 0.012 毫秒。
  - “全部”日历（约 8,000 次读）：280 毫秒；“全部”横条（约 12,000 次读）：456 毫秒。**都远低于 2 秒，不加按天汇总的记录**（风险 2 的后半句关掉）。
  - **`ACTIVITY_READ_RECORD_CAP` 定为 20,000**（不变）：按量出的每次读的代价，2 万次读约 0.5–1.2 秒；一个目标的“全部”日历要读大约每个执行 4 次，到约 5,000 个执行才碰到上限，那时报 `capacity`、界面按年拆（L17）。
  - 很早的窄窗口（窗口以后还有 1,800 个执行、900 轮检查，约 5,400 次读）：111 毫秒。和窗口以后的历史成正比（F37），在上限以内；不加“结束得太晚就停”的条件。
  - 一个任务很多次尝试（200 次）：每页每个任务只读一次执行，一页 200 行，按量出的每行代价约 5 毫秒；没有按执行重读。
  - 整个工作区的决定队列：20 个目标各 500 个执行，一成带满 1,000 个路径（共约 101 万个路径）。存储读 871 毫秒，路径按 60 个模块归 1,870 毫秒，两两比只有 190 对、可以不计。**路径归类是这一段的大头**；这一段读到底、不设上限（L13），本片不改，记进 §9.4 风险 2 的结论，以后要快可以把执行改过的文件按模块存（第 8 片再看）。
- **补算每批的数改到验收时量（改 L8“冻结前 lead 实测”、§7 最后一项）。** 要用补算的归约，它是本片要写的，冻结前没有。施工时缺省 `ACTIVITY_BACKFILL_BATCH_RUNS = 5`（Workflow 的 `activity-backfill.ts` 导出，可注入）：按上面量的存储读，一个执行的读窗口和一次提交在几十毫秒，5 个约在半秒内。lead 验收时照 §7 的测法（1、5、20、50 个执行各三次，取中位数）量一次，取一秒左右的那个数改缺省值，写进 DESIGN §9.3。
- **夹具由 DSH 写（改 §7“夹具由 Codex 先写，lead 核对后冻结”）。** 这一阶段 Codex 只能做只读审查，不能写文件。照 2A 的做法（2A 规格 §10）：DSH 按任务书的夹具规矩写，只经公开服务和真实 Runtime、脚本模型造数据，§7 列的替身和旧形状不变；lead 审，Codex 实现审查时一起看。
- **§5.3 由 DSH 照写（§5.3 标题“lead 写出前后断言，DSH 不自行翻转”）。** 表里写出的改动（SC02 第 52–54 行和第 7 行的注释、桩的使用者的 import 路径、允许表的五条）由 DSH 照写，别的旧测试一律只跑、不改，断了停下报 lead。
- **和 2C 同时施工（§0.4“2C（可以并行）”）。** 两个副本，同一个基线：79032271 加 lead 验过的 2A。合入先 2B 后 2C。两片都改的只有登记一类的文件（`create-platform.ts`、`core-routes.ts`、`core-http-types.ts`、`src/ui/api/routes.ts`、`src/contracts/ledger.ts`、`queries/query-record-codecs.ts`、生产可达允许表），各加各的，lead 合入时手工合。
- **§0.2 的行号**按 a7cafccc、bb924854 记；K 片 A、2A 合入后有的已移动。施工时按符号找，DSH 施工前通读时报出不再成立的事实。

## 11. 施工和验收中的限定（lead，2026-10-15）

施工三轮、Codex 一次实现审查加一次快速核对和 lead 的验收里定下的读法，和 §0–§10 同等有效；有冲突时以本节为准。经过见证据目录 `reviews/evidence/orchestration-slice-2B-2026-10-15/`。

- **2B-34 的“计划对执行”。** 第 5 片冻结的冲突算法把冲突文件定义成两个目标**执行过的**文件的交集（`state/goal-settings-machine.ts:276-286`），读取也不给“归到模块的文件”列表，所以“B 只计划了模块 M、A 执行改过 M 下的文件 F → 冲突列出 F”造不出来，要改冻结的接口。验收接受第 1 轮的替代：两个目标都执行改过 F，经公开的冲突读取看到 F（`S2B-34-executed-files.test.ts`），它验的是本片的执行改过的文件读取喂进冲突读取。计划对执行的列法留给以后改第 5 片的冲突算法时再做。
- **§6 以外多出的文件**（模块边界检查要求）：`persistence/run-activity-codecs.ts`（编解码放在 persistence，`tasks/run-activity-codecs.ts` 只转出，保留 §6 的路径）、`persistence/read-result-failures.ts`、`views/goal-conflicts.ts` 的转出（让 `tasks/goal-executed-files-reader.ts` 不 import `views`）。
- **“没进入过”的判定**只有一处（`src/contracts/run-activity.ts`），照 L7：没有位置记录、没有 Kernel 身份、授权状态在 L7 列的几种里；只用于已结束的执行；还在开始、在跑的执行让执行改过的文件读取报 `possiblyIncomplete: true`（实现审查第 5 条、快速核对第 3 条）。
- **补算请求的编号**：`s2b-backfill:<执行键>:<选中记录的版本和事实摘要>`，Host 重启以后不撞，同一次提交的重试复用（实现审查第 1 条）。
- **读取核对调用方的工作区**：返回的目标、执行、Session（含被引用的 Session）都核对调用方绑定的工作区；同项目另一个工作区的不返回（实现审查第 4 条、快速核对第 2 条）。
- **测试的例外**（§7 以外，验收时接受）：
  - S 组时间竖条的两种情况（让出的执行和它的后继、进入以前的暂停和继续）在第 2 轮补了经公开服务的测试；第 1 轮直接写存储的版本保留作补充。
  - V 组读取：2B-21、2B-26、2B-29、2B-30 在第 2 轮补了经真实 Runtime 和脚本模型的测试；其余行的数据经公开写入口造（`recordRunActivity`），保留作补充。
  - B 组补算：2B-16、2B-17 在第 2 轮补了经真 Host、真 Kernel 历史和“计数关闭”模块替身的测试；按 Host 走时每批只能用 1 个执行（生产的每批数没法经路由注入），按游标分批的流程留在 Workflow 层的测试里。
- **补算每批的数（§10）：** 缺省仍是 5；按 §7 的测法量一次、改缺省值，验收时没量（时间），记进 STATUS 的缺口，下一次合入前量。
- **2B-09（真实 `shell`）。** 进程沙箱把 `.git` 设为只读，“只改了 HEAD”（L1 第 6 行）经真实 `shell` 造不出，由纯函数的 2B-01 覆盖；验收时 lead 在 bwrap 下跑，夹具的工作区挪出平台存储所在的目录（见证据 `lead-acceptance.md`）。
