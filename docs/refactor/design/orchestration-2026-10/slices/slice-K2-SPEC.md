# K2 片规格：压缩（先清旧工具结果，不够再写摘要）和计量

> **状态：已冻结（2026-11-03 晚，lead；决定 113-7）。** 起草方第四稿，按 lead 裁定三、四、五、六改过，见文末“lead 审阅备忘”；Codex 两轮完整审查（`K2R1a/b/c`、`K2R2a/b/c`）加一次快速核对（`codex2/egrp/K2R3q.out.md`：无问题，可冻结）；冻结时 lead 并入裁定七（`impl/k2/lead-rulings-7.md`，只改 §3 :778 一行和文末备忘）。第三稿留在 `impl/k2/slice-K2-SPEC.v3.md`，第二稿在 `impl/k2/slice-K2-SPEC.draft.md`。
> - 代码基线：`df7c3e1e`。它和第三稿的 `3fc8d247` 之间只改了文档（`AGENTS.md`、`docs/AGENTS.md`、`docs/refactor/` 下的 `DECISIONS.md`、`DSH-WORKFLOW.md`、`HANDOFF.md`、`IMPLEMENTED-CAPABILITIES.md`、`STATUS.md`；`git diff --stat 3fc8d247 df7c3e1e` 核过），本稿引用的代码、`DESIGN.md` 行号都不变。
> - 依据：
>   - DESIGN §4.11（`DESIGN.md:1008-1064`），以及 :86、:1220、:1222、:1305、:1406、:1654、:1689；
>   - HANDOFF 决定 49（第 27 项 (a)，及“压缩与换手条件分开配置”）、113-7（整片进 MVP，两步都进）；
>   - `REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md` 第 27 项“写进规格的规则”1–6（下称“答复 27 第 n 条”）；
>   - lead 裁定 `impl/k2/lead-rulings-1.md`（下称“裁定 n”）；
>   - lead 裁定 `impl/k2/lead-rulings-2.md`（下称“裁定二第 n 条”），其中“用户的答复”一节下称“用户答复”；
>   - lead 裁定 `impl/k2/lead-rulings-3.md`、`lead-rulings-4.md`、`lead-rulings-5.md`、`lead-rulings-6.md`、`lead-rulings-7.md`（下称“裁定三第 n 条”…“裁定七第 n 条”；后一份压过前面冲突的地方）；裁定六依据的 Codex 第二轮审查 `codex2/egrp/K2R2a/b/c.out.md` 和 lead 的审查 `impl/k2/v4-review-digest.txt`；裁定四依据的 Codex 第一轮审查 `codex2/egrp/K2R1a/b/c.out.md` 和核对摘要 `impl/k2/r1-verify-digest.txt`；
>   - 前期调查 `impl/k2/groundwork.md`（下称 GW）和三份分报告；
>   - 裁定 12 要求的追查（下称“追查”），脚本在 `impl/k2/work/r12_*.py`；K2-M 的量在 `impl/k2/work/k2m_ratio.py`。都只打印计数；
>   - 7D2、6C、第 9 片、B06 的冻结起始裁定（`impl/sgl/book/*-start-rulings.frozen.md`），只用来定共用文件的先后（§3）。
> - 分四部分，三组施工（裁定三第 4、6 条，裁定四第 12 条，§3）：
>   - **K2-M**：计量，只改平台。不依赖 K2-K；
>   - **K2-K**：Kernel 补丁。K2-M 和 K2-K 是一组，可以先开，和 8E-2、7D2 并行（裁定二第 2 条）；
>   - **K2-P1**：平台第一步，接在 6C 之后（裁定二第 1 条）；
>   - **K2-P2**：摘要，接在 K2-P1 之后、第 9 片 G6 之前（裁定二第 1 条）。
> - 测试入口 KE1–KE5 用户已确认（11-03 晚，“可以，就按这五个入口”），不另加入口。
> - **冻结前还要 lead 定的：** 没有了。Work 的摘要调用怎么发许可，裁定五第 1 条选了 (A)，写在 L18（§6）。

## 0. 一页说明

**要解决什么。**
- 线越跑越长，每次请求都把整段历史重发一遍。
- 平台今天按“字节”估输入，比真实 token 多算约 3.6 倍（F4）。所以 100 万的窗口，到约 27 万 token 时，Kernel 就在每次请求里悄悄丢旧内容：先把旧工具结果换成一句占位，再从最早开始整段丢对话，不留记录，可能丢掉你的原话（F3、F5）。
- 也因为这样，秘书“太长就换手”（50 万）今天永远够不着（F5）。
- DESIGN §4.11 要的是：
  - 在两轮之间、同一个 Session 里把旧历史变短；
  - 原记录不动，线上多一行“已压缩”；
  - 先清旧工具结果，不够再写摘要；
  - 失败或不支持时才换手。

**你定了的。**
- Q1 你选 B：按真实 token 算。平台拿模型服务上一次报的 token 数和那次请求的字节数换算，留 10% 余量。还没有可换算的数时（例如 Host 刚启动），照今天按字节算。不装分词器。
- Q2 你确认了五个测试入口（KE1–KE5）。

**分四部分做。**
- **K2-M 计量：** 就是上面那条换算。做完以后，Kernel 要到约 89 万 token 才开始裁。压缩（40 万）和换手（50 万）都在它之前。
- **K2-K Kernel：** 会话记录里加一种“压缩记录”。恢复历史时按最新的一条拼：
  - 旧工具结果换成一行桩，写明工具、调用、参数摘要、原结果的位置和大小、怎么读回；
  - 更早的对话换成一条摘要消息；
  - 最近 3 个完成的轮原样保留；
  - 原记录不动。
- **K2-P1 平台第一步：** 下一轮开始前，看上一轮最后一次请求的 token 数。到 40 万，先算只换桩能不能降到 20 万；能，就只写桩。
- **K2-P2 摘要：** 不够时，这条线用同样的模型和设置多做一次调用，写六段固定格式的摘要。平台核段落、长度和来源。失败时记一条“压缩失败”：有“太长就换手”的线（秘书；7D2 以后还有参谋、书记）照规则换手，执行者照今天继续。
  - 执行者线的这次调用发生在本轮正式进入之前，今天的模型准入不收。准入多收这一种情况（L18，裁定五第 1 条）。

**不改什么。**
- 原记录；
- `look_graph` 和原历史读取，它们永远读原记录；
- 工具调用的参数；
- 每轮的平台输入（第一步不碰，交给摘要）；
- 执行者线照旧没有自动换手；
- 换手阈值的数（0.8，最多 50 万）。

**改完你能看到什么。**
- 长的线上多一行“已压缩”或“压缩失败”。Session 和线都不变，回复照常送达，原历史照旧可读。
- 不到 40 万的线不压；只有 3 个完成的轮或更少的线也不压（裁定 1）。今天绝大多数线是这样，第 9 片的场景一般也到不了 40 万。
- 代价：27 万到 89 万之间的请求不再被悄悄删，所以比今天大、贵一些（你选 B 时已知）。
- Host 刚启动或刚保存过设置时，第一次请求还没有可换算的数，照今天按字节算。27 万以上的线这一次会被裁，挑选报告里记着（裁定三第 4 条接受）。
- 第 9 片 G6 单留一个场景，用它自己的 Host，调低压缩触发，在真实模型下看一次压缩（含摘要）。压缩后第一次请求的缓存命中只量，不承诺（裁定 13）。

### 0.1 要你定的

没有。

## 1. 事实（代码基线 `df7c3e1e`）

Kernel 路径都在 `vendor/coding-agent/patches/` 下（`dist` 的另写 `vendor/coding-agent/dist/`），平台路径相对仓库根。

**F1 Kernel 怎么存记录。**
- 存储是只追加的 SQLite，`record_type` 是自由文本（`storage/adapters/sqlite/sqlite-stores.ts:470-481`）。
- zod 定义的记录只认 `session.created`、`turn.started`、`agent.event` 三种，草稿只认后两种（`core/ports/session_store/session-store-port.ts:114-159`）。每条记录已带 `schemaVersion: z.literal(1)`（`:95`、`:140`）。
- 追加时，每个草稿都要过 `applySessionDraft`；别的类型一律 `invalid_record`（`session-projection.ts:34-47`）。重放时跳过不认识的类型（`:13-32`）。
- 同一批 recordId 都已存在、内容相同时，存储原样返回原来那几条，不看 revision（`sqlite-stores.ts:205-216`）；否则先比 revision（`:220-221`）。新记录的位置由存储定：`已有条数 + 序号 + 1`（`:234`）。头上的活动 Run 只在重放出的状态没终止时才有（`:246-256`）。
- 一个 Turn 的记录范围，是它的 `turn.started` 到下一个 `turn.started` 之前（`sqlite-stores.ts:751-763`）；`readTurnBounds` 拿范围里最后一条当结束（`:772-797`）。
- `session-projection.ts` 不在补丁构建清单里（`scripts/build-kernel-patch.mjs:13-36`）。它和冻结 map 里的源文一致（CRLF 换成 LF 以后）。worktree 是 CRLF，所以 `--check` 要在 LF 副本里跑（GW §6 第 15 条）。

**F2 Kernel 怎么恢复历史。**
- `restoreSessionHistory`（`core/ports/session_store/session-history.ts:281-422`）：
  - `throughPosition` 必须是终止的 `agent.event`（`:308-317`，`conflict`；终止事件的集合在 `:21-30`）；
  - 逐个 Turn 重放、投影；最后一个 Turn 没终止时报 `conflict`（`:335-340`）；前缀里一个 Turn 都没有时报 `not_found`（`:383-388`）；
  - `interrupted` 的 Turn 记进 `turns`，不进 transcript（`:345-353`，K 片 L3）。这是“把一个 Turn 排除在模型历史外”的先例；
  - 每个 Turn 和整个前缀都做调用和结果的成对检查（`:370-373`、`:409`）；当前 Turn 和前缀里某个 Turn 的 runId 或 turnId 相同，报 `conflict`“历史前缀包含当前 Turn”（`:390-399`）。
- 它不是公开函数（`public-api.ts` 只从这个文件导出 `assertTranscriptExchangeIntegrity`、`projectTerminalTranscript`，`:229-232`）。两个调用者只用返回值的 `.transcript`（`app/composition/composition-root.ts:323`、`resume-composition.ts:239`）。
- 新 Run 在 `composition-root.ts:302-324` 调它。同一个执行身份再进来时（恢复暂停的 Turn 也是），Kernel 先按 runId 找已有的 `turn.started`（`:327-333`），再核对这次给的 `contextBasis` 和记录里的一样，`throughPosition` 不同就报 `idempotency_conflict`（`:595-603`）。恢复执行时用 `turn.started` 里存的 `contextBasis` 再调一次（`resume-composition.ts:220-240`），所以边界相同、视图相同。
- 派生基线：带 `sessionContext.sourceSessionId` 时，Kernel 读源 Session 的记录，恢复到其中一个终止位置（`composition-root.ts:271-284, 311-321`）。源 Session 和新 Session 在同一个存储里。
- `session_history` 要求目标 Session 已经存在：这个分支先 `store.get(sessionId)`（`composition-root.ts:275-277`，`:276` 的注释写明不为它新建空会话），不存在就抛 `not_found`。只有 `current_turn` 分支在 `not_found` 时自动建（`:285-299`）。
- `contextBasis` 的形状：strict 的 zod 对象，只有 `version`、`mode`、`throughPosition`、可选的 `sourceSessionId`（`core/ports/session_store/session-store-port.ts:81-89`；类型 `:197-202`；`turn.started` 的载荷带它，`:110`）。它在这几处建、读、比：`composition-root.ts:302-311`（建）、`:313-324`（恢复）、`:582-604`（`assertSameExecutionContent`，比 `throughPosition`、`mode`、`sourceSessionId`）；`session-history.ts:67-89`（`parseContextBasis`）；`resume-composition.ts:222-239`（恢复时按它重建）。

**F3 Kernel 每次请求的裁剪。**
- `selectContext`（公开，`public-api.ts:125`）只在超预算时动手，按这个顺序删：记忆、技能引用、附加说明、历史工具结果正文、历史整段交换、历史结论、当前交换（`core/context/selection_policy/context-selection-policy.ts:207-307`）。
  - 第 5 步“历史整段交换”把历史里的每条用户消息、每个成对的工具交换各算一个单位（`:268-286`）；第 6 步“历史结论”是不带工具调用的助手消息（`:288-292`）；第 7 步是当前这一轮的成对交换（`:294-306`）。
- 第 4 步把历史里成功的结果换成 `内容因长度省略（工具 X，调用 Y），需要时重新读`（`:95`），从最旧的开始。只换 `output`，保留调用和结果成对；换完字节数严格更短才换（`:238-254`）。
- 只保护最新的用户消息和任务输入（`:256-264`），什么都不存。每次请求留一份挑选报告：`inputTokens`、`budget` 和七种删除的条数（`:43-48`）。平台把它存进请求记录的 `prompt.selection`（Query：`src/core/work-graph/queries/query-record-codecs.ts:629-632`；Work 同形状：`src/core/work-graph/tasks/model-request-codecs.ts:86-87`）。
- 所以 DESIGN.md:1019（“只会丢”）和 :1020（“很少丢到对话”）都已过时。自 PC-1（`20f20ae2`）起就是这样。

**F4 预算按字节算（追查第 1 节）。**
- 平台没有接 `inputCounter`，它只是一个可选字段（`src/core/agent-runtime/source-tool-ports.ts:21`）。所以 `ModelBudget.measure` 把请求的 UTF-8 字节数加 4,096 当作 token 数（`src/core/agent-runtime/model-budget.ts:107-117`，`:113`，方法名 `conservative_utf8_estimate`）。
- Kernel 挑选上下文用的就是这个计量（`src/core/agent-runtime/observed-model-run.ts:390, 400` → `model-budget.ts:123-126`），Work 也一样（`execution-driver.ts:948-949`）。
- 113 次请求实测：（计量值 − 4,096）÷ 模型服务报的 token 数，平均 3.65，即大约 3.65 字节算一个 token（F13 有分布）。
- 冒烟（10-28、29）在 SF1 之前：
  - 窗口用默认的 128,000（`src/contracts/runtime-budget.ts:19`），扣掉 16,384 的输出预留（`src/app/runtime-configuration.ts:122`）；
  - 117 次请求的挑选预算全是 111,616 个计量单位，约等于 2.8–3 万个 token。
- SF1 以后（`src/app/host.ts:349-354`，100 万的清单在 `:351-352`）：
  - 挑选预算 983,616，约 26.8 万 token，是窗口的 0.27；
  - 规划轮预留 131,072 输出（`runtime-budget.ts:26-28`，`host.ts:2038`），约是窗口的 0.24。

**F5 秘书轮带着历史，裁剪来自 Kernel（追查第 1 节）。**
- 怎么带上历史：
  - 准备时，有游标就取历史（`src/core/agent-runtime/query-preparation.ts:679-686`）；
  - 结算的 QueryRun 把 Session 游标推到它的终止位置（`src/core/work-graph/state/query-run-recovery.ts:438-442` → `src/core/work-graph/state/session-availability.ts:403-413`，同时写 `lastExecutionRef`）；
  - 开始时，这变成同一个 Kernel Session 上的 `session_history`（`query-execution.ts:812-834`）。
  - 强制改成 `current_turn` 的分支（`:828-830`；Work 是 `execution-driver.ts:790-792`）只在准备时没有游标、开始时有游标时走到，冒烟里没有走到。
- 冒烟库里的证据（smoke-g9 是 g5 的副本，不计）：
  - 共 70 条 `turn.started`：35 条是第一轮，35 条在同一个 Session 上恢复历史；没有一条带 `sourceSessionId`。
  - smoke-g5 的 Session `a41525ea`：第 2–9 轮依次恢复到位置 21、32、45、51、55、70、76、82，每个都是上一轮的终止。
- 同一个 Session 的挑选报告：
  - 第 1、2 轮没删东西；
  - 第 3 轮删了 5 个结果正文、1 段交换；第 6 轮是 7 个和 8 段；第 8–9 轮是 10 个和 12 段；
  - 117 次请求里有 18 次删了东西。
  - 删的集合一变，缓存命中就落回系统说明加工具定义那一段，14,336 token；集合不变时又涨回去（第 8 轮 20,480，第 9 轮 25,344）。
- 秘书的换手阈值是 `min(500,000, floor(0.8 × 窗口))`，比的是最近一次请求的 `inputTokens`（`src/core/work-graph/tasks/secretary-handoff-basis.ts:31-47`，式子在 `:36-37`，从后往前找的循环在 `:78-85`；常数在 `request-contracts.ts:27`）。Host 在一轮结束后判断（`src/app/host.ts:1062-1085`，判断在 `:1073`；`src/business/workflow/session-handoff.ts:341`）。
- 这个数被 F4 的裁剪压住了：SF1 以前约 3 万，阈值 102,400；SF1 以后约 26.8 万，阈值 50 万。所以永不触发。

**F6 每种线的下一轮拿到什么历史（追查第 1、2 节）。**

| 线 | 下一轮的历史 |
|---|---|
| 秘书的 Query 轮 | 自己的 Kernel Session，恢复到上一轮的终止（F5）。换手后的新秘书 Session 没有游标：`current_turn` 加平台的交接文字（`src/core/agent-runtime/context-secretary-recipe.ts:330-332`） |
| 参谋、审阅者线，以及任何线上的 Host 系统轮 | 只走 `intervention_planning` Query，只带消息自己的 `taskRef`（`src/business/workflow/intervention.ts:95-97`、`:103-105`），在收件线自己的 Session 上领取（`:302-369`），历史规则和秘书一样 |
| 书记线和没有职责的线 | 消息点名的任务，或这条线最近 Work 的任务，还 active、没满足时，走 Work 领取（`intervention.ts:104-106`、`:137-151`）；否则也走规划 Query |
| “问一问”副本 | 新开一个子 Session，从收件线种到它的游标位置（`src/business/workflow/consultation.ts:420-456`），只跑一轮，带 `sourceSessionId`。`platform_facts` 副本用 `current_turn` |
| Work Run | 有游标：读自己的历史，到边界为止（`src/core/agent-runtime/execution-preparation.ts:614-616`；`context-history-facts.ts:49-83`；`execution-driver.ts:769-796`） |
| 接续 | 只有第一个 Run 从源 Session 种历史（`context-continuation-recipe.ts:178-181` → `context-history-facts.ts:125-179`）；从第二个 Run 起只看自己 Session 的 Turn（DESIGN:1025） |
| 审阅轮 | 第一个 Run 从原 Run 的 Session 种历史（`context-history-facts.ts:189-213`，`context-review-recipe.ts:91`） |

- 以下情况不种：没有源；源就是自己；领取的 Session 已经有游标；适配器不同；归档来的（`context-history-facts.ts:134-139`、`:318-322`）。所以有游标的 Session 从不被种（`:136`）。
- 种的时候，扫描源窗口，找源位置及以前最后一个终止 `agent.event`（`:96-123, :151-177`）。解码用 Kernel 公开的 `sessionRecordSchema`（`kernel-turn-facts.ts:25-35`）；解不出来就静默不种（`:114, :170`）。

**F7 一轮从哪里开始。**
- Work：`beginRuntimeEntry`（`execution-driver.ts:756`）之后，读完成边界（失败时返回 `unavailable`，`:775`），按 `sessionHistoryDecision` 建 `sessionContext`（`:785-795`）。
- 恢复暂停的 Turn（`resumeEntered`，`:399`）跳过 begin（`:746`），但同样走读边界、建 `sessionContext` 这一段，并用原来的执行身份进 Kernel（`:1064`）。
- begin 之后的开始失败，再开始只会观察（`:406`）；Run 停在 Entering，由启动核对 W-05 证明没进入（`run-reconcile.ts:312-314`），或进程内的 RUN-16（只在 Kernel 调过、资源都关了以后，`execution-driver.ts:1121-1125`）。
- Query：`query-execution.ts:812-834`，失败同理（`:822`；启动核对 Q-02，`run-reconcile.ts:613-615`）。拦截工具调用的先例是这里的 `before_tool` Hook（`:792-809`）。
- 到这一步时，Session 已经被这一轮领取，上一轮已经入账：游标只在释放时推进（`session-availability.ts:392-413`）。

**F8 对账和观察的四处（追查第 3 节，裁定 11）。** 这四处都把“窗口里最后一条解得出的记录”当成某种结束：
- `run-reconcile.ts:302-337`，Work 的启动核对：
  - 窗口从 `locator.startPosition − 1` 或完成边界之后，读到最后；
  - `turnLast` 只取本 Turn 的 `turn.started` 及以后的记录。
- `run-reconcile.ts:609-626`，Query 的启动核对：`turnLast = decoded.at(-1)`，不限于本 Turn。
- `execution-observation.ts:537-569, 725-751`，Work 的进程内观察：
  - 活着的 Run 从 `startPosition − 1` 之后读到最后；
  - `endPosition = decoded.at(-1)`，它会成为游标、`history.endPosition`、`kernelSource` 和请求 ID。
- `query-observation.ts:321, 342-351`：从游标读到最后，把最后一条当结束和游标。
- 只要有一条记录解不出来，整个窗口就失败：`run-reconcile.ts:119`、`execution-observation.ts:559-560`、`query-observation.ts:310-311`、`session-operations.ts:371`（`sessionRecordSchema.parse`，历史分页也会断）。
- `completedBoundary` 只核对游标指的那条记录还在（`session-operations.ts:940-968`）。
- 平台用 Kernel 的 `SessionRecord` 类型读记录。除了一处，都先判 `recordType === 'agent.event'` 再读 `payload.event`；只有 `observation-recovery.ts:231-237` 是排除 `session.created`、`turn.started` 以后直接读 `payload.event`。`tsconfig.json:16` 连 `tests` 一起查类型。

**F9 平台现有的口子。**
- 能力上报：
  - `nativeCompact: { supported: false }`（`src/composition/create-platform.ts:695`）；旧测试钉着它（`tests/app/A2-runtime-capabilities.test.ts:125`），并要求各项理由互不相同（`:186-190`）；
  - 平台类型是 `kernelSessionApiVersion: 1 | 2 | 3`（`src/core/agent-runtime/contracts.ts:5`），Kernel 现在是 3（`app/composition/composition-contracts.ts:43`）；
  - K 片把它从 2 升到 3，是先例（`slice-K-SPEC.md` L1）。
- 端口先例：`closeOpenTurn?`、`turnClosureSupport?`（`src/core/agent-runtime/ports.ts:113-138`）；`turnClosureSupport` 只看有没有装、Kernel 有没有公开那两个函数、存储是不是本适配器，不看版本号（`runtime.ts:522-547`）；注入在 `create-platform.ts:2157`。
- 历史条目只有三类，不认识的记成 `agent_event`（`session-operations.ts:68, 372-373`；`observation-recovery.ts:175-176`）。
- 原历史读回：`look_graph` 的 `history` 只收 Work 的 `RunRef`，而且要有受信的 Goal（`graph-tools.ts:69, 361-370`；`graph-execution-history.ts:175-185`）。**Query 轮（秘书、参谋的轮）没有模型能用的读回入口。**
- Host 设置的先例：`planLoopLimits`（`src/app/host-settings-types.ts:69, 76`；`host-settings.ts:409-413, 528-558, 1371-1385`；契约在 `src/contracts/plan-loop-limits.ts`）。

**F10 量过的数（GW §1；只作参考，裁定 14）。**
- DSH 的建造会话共 5,203 个，只有 43 个多于 3 轮。多于 3 轮的那些，第一步约能省上下文的 43%（中位数）。
- 平台冒烟：
  - 多轮的秘书类 Session：每轮的平台输入占存下历史的 44–76%，工具结果占 5–21%，第一步最多省 9%；
  - 单轮的工作 Session：工具结果占 44–72%。
- 桩大约是原结果的 1/30。平台给每条结果另包一层对象，大约多 252 个字。

**F11 挑秘书和换手用同一个“太长”。**
- 挑秘书先滤掉忙的和太长的（`src/core/work-graph/tasks/secretary-selection.ts:126`，`!candidate.tooLong`）；`tooLong` 来自同一个 `readSecretaryHandoffBasis`（同文件 `:526-551`）。
- 所以一条“太长”的秘书线，下一次请求轮不会选它。
- 模块依赖：WorkGraph 不能依赖 AgentRuntime，AgentRuntime 和 Workflow 能依赖 WorkGraph（`docs/refactor/module-target.json`）。挑秘书已经靠注入的端口拿 WorkGraph 读不到的事实（`profiles`、`scope`、`duty`，`secretary-selection.ts:68-77`）。

**F12 7D2 落地后的“太长”（7D2 冻结起始裁定 §3.1.3，`impl/sgl/book/7d2-start-rulings.frozen.md:2420-2560`）。**
- `secretaryHandoffBasis` 的表不变，读法加宽成 `roleLineInputBasis`：QueryRun 的请求加上这条线 Work Run 的 `RunActivity`，取最新的一次 `inputTokens`。`readSecretaryHandoffBasis` 留作它的包装。
- 新的角色线维护（`W/sessions/role-line-maintenance.ts`）对参谋、书记线：能拆就拆；否则 `tooLong` 就走同一个 `handoff.startHandoff`。
- 所以 7D2 以后，参谋和书记也有“太长就换手”，用的是秘书那张表。执行者、审阅者仍然没有。
- 7D2 还改 `secretary-selection.ts` 的 `orderCandidates`（`:119-124`）和 `session-handoff.ts` 的 `startHandoff`（`:344-350`）。K2-P1 在它们之上改。

**F13 计量的口子和量过的比例（K2-M）。**
- 类型：`InputTokenMeasurement` 的 `method` 只有 `model_tokenizer`、`conservative_utf8_estimate` 两种（`model-budget.ts:5`）；`ModelInputCounter` 只有 `count(request)`（`:6`）。
- `measure` 先算字节 `inputBytes = Buffer.byteLength(JSON.stringify(outgoing), 'utf8')`（`:112`），有计数器用计数器，没有就字节 + 4,096（`:113`），再核数和方法名，不合就抛错、不调模型（`:114`）；`fits` = 计量值 + 输出预留 ≤ 窗口（`:116`）；不 fits 时调模型前就报 `ContextCapacityExceeded`（`:155`）。
- 每次请求的计量记一行 `MeterEntry`，带这次的 `inputBytes`（`:157`）；模型服务报了用量以后，同一行写进 `inputTokens`（`:163`、`:169-173`）。
- 计数器按引用一路传下去（`execution-preparation.ts:831-842`），进 Work 和 Query 的计量（`execution-driver.ts:948-949`、`query-execution.ts:698-714`）。Host 建的 BoundModel 没有计数器（`runtime-configuration.ts:503-511`）；一个绑定一个 BoundModel，Host 活着时一直用（`:456-458`、`:512`）；保存 Host 设置会重建绑定（`host.ts:1457-1459`）。程序传入的 runtime（`host.ts:627-628`）和测试夹具自己带计数器（例如 `tests/scenarios/support/S3-host.ts:123`，每次 256）。
- 模型服务报的 `inputTokens`：DeepSeek 是 `prompt_tokens`，含缓存命中；缺这个字段时报 0（`vendor/coding-agent/dist/model/providers/deepseek/deepseek-model-client.js:64-66`）。
- 存下来的记录里没有“字节和 token 成对”的数：
  - Query 的请求行有 `reservedInput`（计量值）和 `inputTokens`，没有字节和方法名（`query-execution.ts:197-216`）。`reservedInput − 4,096` 只在按字节计时才等于字节数，按哪种计的没存；
  - Work 的计量不存盘（`execution-driver.ts:948` 的 persist 是空的）；
  - Kernel 的 `model.request_started`、`model.usage_recorded` 不带字节（`vendor/coding-agent/dist/core/runtime/events/agent-events.d.ts:31-64`）。
  - 所以不加新字段，Host 重启后读不回一个可换算的数。
- 带状态码的 4xx 里，除 401（`authentication_failed`）、403（`permission_denied`）、429（`rate_limited`，可重试）以外，Kernel 都分成 `provider_request_failed`、不可重试（`vendor/coding-agent/dist/model/providers/provider-support.js:19-27`、`:37`）；分类只看状态码，分不出是不是因为太长。平台把 `provider_request_failed` 当“模型服务中断”（`src/contracts/dispatch.ts:74-77`；`execution-observation.ts:135`）。
- 量过的比例（`impl/k2/work/k2m_ratio.py`，冒烟 8 个库、113 次请求，请求 59–107 KB，一个模型，SF1 以前）：
  - 每字节的 token 数：最小 0.260，p50 0.275，p90 0.281，最大 0.287；
  - 用同一个 QueryRun 里上一次请求的比例估下一次：63 对，最差低估 1.4%；
  - 用同一个库里任意上一次请求的比例估下一次（跨 QueryRun）：105 对，最差低估 7.6%，p99 4.7%。
  - 请求小、样本少，G7 重量。

**F14 上一轮的输入量和挑选报告在哪里，什么时候写好（裁定二第 15 条）。**
- **Query：** 请求记录是 QueryRun 的 `executionState.requests`，每行有 `inputTokens` 和 `prompt.selection`（`query-execution.ts:197-216`）。
  - 写的时机：计量的 persist 在预留时写一次（`model-budget.ts:158`），模型服务报了用量以后、在这次请求的流的 `finally` 里再写一次（`:169-173`）→ `recordQueryUsage`（`query-execution.ts:698-714`）。
  - Kernel 调的就是这个包过的流（`observed-model-run.ts:334`），流连同 `finally` 结束以后 Kernel 才往下走，所以这一行在这个 Turn 的终止事件之前就写好了。
  - 之后才有结算、释放、推游标（`query-run-recovery.ts:438-442` → `session-availability.ts:403-413`），下一轮要等释放才能领取（F7）。
- **Work：** 请求记录是模型请求许可（`src/core/work-graph/tasks/model-call-contracts.ts:51-68`），带 `prompt.selection`，**没有 `inputTokens`**。
  - 许可在调模型之前的 `beforeCall` 里提交（`src/core/agent-runtime/model-call-access.ts:60-99`，调用在 `observed-model-run.ts:320`），许可的 `requestId` 就是 Kernel 的请求 ID。
  - 模型服务报的 `inputTokens` 在两处：
    - `RunActivity.usage.requests`（`src/contracts/run-activity.ts:42-49`）。它和 Session 的释放（游标推进）在同一个结束提交里写（`src/core/work-graph/tasks/execution-entry-service.ts:2162-2165` 释放，`:2170-2186` 活动记录，`:2203-2211` 提交；推游标的效果来自 `run-machine.ts:1742`、`:2294`、`:2533`）。但它只留前 256 次请求（`run-activity.ts:18`；`run-activity-tally.ts:302`）；读不到 Kernel 窗口时没有用量（`execution-observation.ts:770-777`）。
    - Kernel 记录：每次请求的用量是一条 `model.usage_recorded`，带 `requestId` 和 `delta.inputTokens`（`agent-events.d.ts:46-64`；平台已经在读，`run-activity-tally.ts:177-197`）。它写在这个 Turn 的终止事件之前，终止事件就是游标。
  - 裁定三第 1 条：Work 读 Kernel 的 `model.usage_recorded`（L10）；Query 照裁定二第 15 条读请求记录。
- **怎么找到“上一轮”是哪个执行（裁定四第 5 条）。**
  - Session 的 `lastExecutionRef` 找不到：下一轮领取时，`occupySessionRecord` 就把它改成这一轮（`src/core/work-graph/state/session-availability.ts:375-388`，`:386`；Work 领取经 `claim-service.ts:472`，Query 经 `work-graph/queries/query-execution.ts:902`），而压缩点在领取之后（F7）。
  - 游标那条 Kernel 终止记录的 `payload.event.meta.runId` 是上一轮的 Kernel runId（`eventMetaSchema`，`agent-events.d.ts:9-17`）。`completedBoundary` 已经读了这一条（`session-operations.ts:958-966`），今天只返回位置。
  - 平台从 Kernel runId 没有现成的反查：Work 的 runId 是 RunRef 的单向哈希（`execution-driver.ts:383-387`），也没有按 Kernel runId 的索引。现成的是两个按 generation 排序的索引：`S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP`（索引项是 `DispatchOutboxEntry`，`claim-record-codecs.ts:879-881`）和 `S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP`（索引项是 `QueryRun`，`query-record-codecs.ts:1391-1393`）。按 `desc` 读的用法见 `work-line-reader.ts:2680-2701`。
  - 平台记下的 Kernel runId：Run 是 `executionHistory.kernel.runId`；QueryRun 是 `run.executionState.entry.kernel.runId`（`src/contracts/query-job.ts:609-616`）。

**F15 来源链接今天能用的读（裁定二第 11 条）。**
- 当前文件：`readContinuationCurrentFile(root, path)`（`src/core/workspace/continuation-diff-reads.ts:117-140`），超过 1 MiB 回 `too_large`（`:30`）。Runtime 依赖是 `workspaceSource.readCurrentFile`（`src/core/agent-runtime/execution-contracts.ts:404`、`:448`），接线在 `create-platform.ts:1819`。
- 文件在某个提交里的版本：`readContinuationBaselineBlob(root, '<提交>:<路径>')`，用 `git cat-file`（`continuation-diff-reads.ts:87-105`；对象引用的格式在 `:73-79`）。Runtime 依赖是 `workspaceSource.readBaselineBlob`（`execution-contracts.ts:446`），接线在 `create-platform.ts:1818`。
- 单独的提交：上面这个读也收一个光秃的十六进制 ID（`:74`），但它用 `cat-file blob` 读，对提交对象读不出来。src 里没找到按提交号打开提交的读。所以单独的提交不当来源（裁定三第 3 条）。
- 消息：`SessionMailboxPort.readMessage(ctx, ref)`（`src/core/work-graph/model/communication-contracts.ts:383-384`；`SessionMessageCommandPort` 继承它，`:483`）。Runtime 依赖是 `messages`（`execution-contracts.ts:242`），已有用法在 `execution-inputs.ts:259`。
- 检查结果：`GraphContextReadPort.lookGraph`（`src/core/work-graph/model/graph-context-contracts.ts:95`），目标 `{ kind: 'round', ref }`（`graph-tools.ts:217`，调用形状在 `:391-399`）。Runtime 依赖是 `graphContext`（`execution-contracts.ts:332`）。
- 读工作区要先解出根目录，先例是接续说明（`src/core/agent-runtime/context-workspace-facts.ts:40-60`）。

**F16 摘要调用要用的口子（裁定二第 9 条，裁定四第 1、6、14 条）。**
- 临时 Session：带新 sessionId 和 `sourceSessionId` 调 Kernel，Kernel 不会替它建 Session（F2：`session_history` 分支先 `store.get`）。平台要先在这条线的 Kernel 存储里建它：`deps.kernelStores.withStore(adapterId, store => store.create(...))`，`withStore` 给的是 `SqliteStores`（`src/core/agent-runtime/kernel-store-locator.ts:20`），`create` 写 `session.created`（`vendor/coding-agent/patches/storage/adapters/sqlite/sqlite-stores.ts:139-160`）。平台已有的先例是 `session-operations.ts:689-694`。之后的 `turn.started` 和事件由 Kernel 写。源 Session 要在同一个存储里才读得到，所以临时 Session 的记录只能留在这个存储里。
- 没有平台 Session 指向它，`sessions/history`、`executions/history`、`look_graph` 都读不到它（裁定三第 2 条：接受）。
- 发送层的两个绑定摘要：`contextInputDigest` 是对这次调用的 `input` 求哈希（`observed-model-run.ts:320-323`），`manifestDigest` 是调用方传的。准入拿它们和本轮冻结的比：Query 比 `state.prepared.inputDigest`、`bundleRef.digest`（`work-graph/queries/query-execution.ts:2067-2068`）；Work 比 Run 的 `inputBinding`（`model-call-service.ts:195-200`、`:306`）。摘要调用的 `input` 是摘要提示，求出的哈希和冻结的不同。
- Work 的计量和许可绑定在建 `sessionContext` 之后才建（`execution-driver.ts:948-958`；`sessionContext` 在 `:785-795`；`refreshedPermit` 在 `:765` 定下）。Query 的计量在前面（`query-execution.ts:698-757`；`sessionContext` 在 `:812-834`）。
- **Work 在压缩点发不出许可（裁定四第 14 条）。** 压缩点（`execution-driver.ts:775` 和 `:793` 之间）在 begin 之后，这时 Run 是 Entering：授权 `entering`、状态 `starting`（`run-machine.ts:892-896`）。发许可（`model-call-service.ts:192`）和消费许可（`:303`）都经 `admitEnteredRun`，它要 `auth.phase === 'entered'` 且 `run.status === 'running'`（`execution-entry-service.ts:703-704`），否则回 `busy`。这两样只在线自己的 Kernel Turn 第一次 `before_model` 时，由 entered 钩子写下（`execution-driver.ts:836-909`，`:861` 调 `recordExecutionEntered` → `run-machine.ts:903-908`）。
  - Query 没有这个问题：开始后就是 `entering`（`work-graph/queries/query-execution.ts:1815-1816`），准入收 `entering`（`:2054-2055`），记用量只拒 `settled`（`:1951`）。
  - 许可只加一条许可记录，Run 只做守卫、不写（`model-call-service.ts:141-152`、`:237-247`）。读许可的只有请求记录（`runtime.ts:757`）和下一个序号（`model-call-service.ts:211-216`）；启动核对和结算不读许可。

## 2. 规则

M1–M5 是计量，属 K2-M；L1–L7 是 Kernel，属 K2-K；L8–L17 是平台第一步，属 K2-P1；L18–L21 是摘要，属 K2-P2。

“进模型历史的 Turn”在下文都指：已终止、终态不是 `interrupted` 的 Turn（K 片 L3）。

### 2.1 计量（K2-M）

**M1 计数器。**
依据：用户答复（Q1 = B）；F4、F13。
- 在 `model-budget.ts` 加一个工厂 `createObservedInputCounter()`，返回一个 `ModelInputCounter`。它只在内存里存一个数 r：这个绑定最近一次可用的“模型服务报的输入 token ÷ 那次请求的字节数”。
- `count(request)`：先算 B = `Buffer.byteLength(JSON.stringify(request), 'utf8')`。它和 `model-budget.ts:112` 是同一个算法、同一个对象，所以 B 就是这次的 `inputBytes`。
  - 还没有 r：返回 `{ tokens: B + 4096, method: 'conservative_utf8_estimate', tokenizer: 'unavailable; UTF-8 reservation only' }`，和今天 `:113` 逐字相同。
  - 有 r：`tokens = min(B + 4096, ceil(B × r × 1.1))`。取后一项时 `method` 是新值 `provider_ratio_estimate`，`tokenizer` 是 `provider-reported tokens per byte × 1.1`；取前一项时和上一条一样。
- 新的 `method` 值要进类型（`:5`）和核对的集合（`:114`）。不能借用旧的两个：这个数不是分词器数的，也不保守。
- 余量 10%：F13 量到的最差低估是 7.6%。它是常数，不进 Host 设置（裁定没要求）。G7 量完再看。
- `min(B + 4096, …)` 的用意：K2-M 只会让计量变小，不会比今天大。所以 r 再怪（例如脚本模型报的数和字节无关），也不会比今天裁得多，也不会多出 `ContextCapacityExceeded`。

**M2 观察从哪里来。**
依据：用户答复；F13。
- `ModelInputCounter` 加一个可选成员 `observe?(inputBytes: number, inputTokens: number | null): void`（`model-budget.ts:6`）。没有这个成员的计数器（测试夹具的）不受影响。
- `ModelBudget.wrap` 在每次请求的流结束时（`finally`，`:169-173`）调它，按下面第一条命中的：
  - 模型服务报了用量，且 `usage.inputTokens > 0`：`observe(inputBytes, usage.inputTokens)`。`inputBytes` 是这次请求自己的（`:112`、`:157`），`inputTokens` 是 `usage_snapshot` 里的（`:163`、`:170`）。
  - 没报用量，而且流里有一条 `retryable: false`、码为 `provider_request_failed` 的错误：`observe(inputBytes, null)`。
  - 别的情况（取消、可重试的错误、缺终止、报 0）：不调。
- 报 0 不算：DeepSeek 缺字段时报 0（F13）。拿 0 算出 r = 0，Kernel 会什么都不裁、直接超窗。
- 计数器收到数：`r = inputTokens ÷ inputBytes`；收到 `null`：r 清空。
- 不存盘。Host 重启后没有 r，照今天按字节计（F13：不加新字段读不回）。

**M3 接到哪里。**
依据：F13。
- `runtime-configuration.ts:503-511` 建的 BoundModel 加 `inputCounter: createObservedInputCounter()`。一个绑定一个计数器，跟着 BoundModel 活。
- 保存 Host 设置会重建绑定（`host.ts:1457-1459`），计数器换新、r 清空，和重启一样。
- `src/app/host.ts` 不改：窗口照旧由 `localWorkbenchBudget` 给（`host.ts:349-354`）。
- 程序传入的 runtime 和测试夹具自己带的计数器不变。

**M4 超窗和模型服务仍然拒绝。**
依据：用户答复（“留余量防超窗”）；F3、F13。
- 有了 r 以后，Kernel 开始裁的线：
  - 普通轮挑选预算 983,616（100 万窗口减 16,384），约 983,616 ÷ 1.1 = 894,196 个真实 token，是窗口的 0.89；
  - 规划轮挑选预算 868,928（减 131,072），约 789,934 个真实 token，0.79。
  - 都在压缩触发（40 万）和换手（50 万）之上。
- 发出去的请求不超窗的条件：这次请求每字节的真实 token 数不超过 1.1 × r。F13 量到的最差低估是 7.6%。
- 仍然超了：模型服务回一个被分成 `provider_request_failed` 的 4xx（比如 400，F13），Kernel 不重试。这一轮照今天按“模型服务中断”收（SMK3b：只有人能继续）。计数器同时丢掉 r（M2），所以人继续以后，第一次请求按字节计，Kernel 照今天裁，不会再撞同一个拒绝。
- 平台分不出 4xx 是不是因为太长（F13），所以任何不可重试的 `provider_request_failed` 都丢 r。代价最多是下一次请求按字节计一次。

**M5 跟着变的（不另改代码）。**
- Query 请求行的 `reservedInput` 和挑选报告的 `inputTokens` 变成估算值（`query-execution.ts:209`；`observed-model-run.ts:344`）。
- Work Run 的累计上限（RC）在调模型前的预留检查用估算值（`model-budget.ts:73-84`、`:147`）。预留从约 3.6 倍真实 token 变成约 1.1 倍。
- K2-M 以后，秘书 50 万的换手阈值够得着了（在 0.89 窗口之前）。

### 2.2 Kernel（K2-K）

**L1 压缩记录。**
依据：DESIGN:1052；协作主图 S4“保存原记录引用和压缩版本”（DESIGN:1023）；裁定 5 要“压缩失败”的历史行；DESIGN:1406、1689 说平台不另存，“已压缩”从 Kernel 读。

```ts
// session-store-port.ts：记录和草稿的 discriminatedUnion 各加一支，payload 用 strict
recordType: 'context.compacted'
payload: {
  basedOnPosition: number;          // 紧挨在前面的那条，必须是终止的 agent.event
  outcome: 'compacted' | 'failed';
  stubs: { throughPosition: number; readBack: Record<string, string> } | null;  // 键是 Kernel runId
  summary: { throughPosition: number; text: string } | null;
  failure: { reason: string } | null;
}
// compacted：stubs、summary 至少一个不是 null，failure 是 null
// failed：stubs、summary 都是 null，failure 不是 null
```
- 版本跟记录本身的 `schemaVersion: 1` 走（F1），载荷不另带版本。
- 每条 `compacted` 记录自带完整的视图，恢复时只看最新的一条（L5）。
- `failed` 记录不改视图。它只是“压缩失败”那一行，也是平台判断换手的依据（L16）。

**L2 投影：一轮没结束就不收。**
依据：DESIGN:1037（只在两轮之间压）；DESIGN:1053 和答复 27 第 6 条（“运行中收到压缩请求要明确未执行”）；GW 变更点 3。
- 先把 `core/ports/session_store/session-projection.ts` 加进 `relativeSources`，在 LF 副本里跑 `--check` 通过，然后再改。
- `applySessionDraft` 收到压缩草稿时：
  - 最后一个 Turn 已经终止：原样返回状态，什么都不改；
  - 没有 Turn，或最后一个 Turn 还没终止：返回 `invalid_record`，消息是“本轮未结束，未执行”。
- `replaySessionRecords` 照旧跳过这种记录，不改。

**L3 追加函数。**
依据：裁定 2；K 片 L2 的先例。
- 新的公开函数 `appendCompactionRecord(store, { sessionId, expectedRevision, at, basedOnPosition, outcome, stubs, summary, failure })`。
- 按下表从上往下，返回第一条命中的结果。除了最后一行，都不写任何东西：

  | 顺序 | 情况 | 返回 |
  |---|---|---|
  | 1 | 存储读不了，或 Session 不存在 | `unreadable { reason }` |
  | 2 | 头的 revision 不等于 `expectedRevision` | `conflict { currentRevision }` |
  | 3 | `basedOnPosition` 不是 Session 的最后一条，或最后一条不是终止的 `agent.event` | `not_idle { reason }`：最后一个 Turn 还没终止时，reason 是“本轮未结束，未执行”；其余是“压缩只接在已完成轮次的终止事件后面” |
  | 4 | 载荷不合 L1；`stubs.throughPosition` 或 `summary.throughPosition` 不是 `basedOnPosition` 及以前、某个进模型历史的 Turn 的终止位置；`stubs` 范围里（摘要之后）有进模型历史的 Turn，它的 runId 不在 `readBack` 里 | `invalid { reason }` |
  | 5 | 其余情况 | 追加一条，返回 `appended { position, revision }` |

- 第 3 行不单列“头上有活动 Run”：有活动 Run，最后一个 Turn 就没终止，尾就不是终止事件（F1，`sqlite-stores.ts:246-256`）。
- `summary` 传 `null`、而前一条 `compacted` 记录有摘要时，Kernel 把那段摘要原样带进新记录。这样每条记录都自带完整视图（L1）。
- recordId 由 `(sessionId, basedOnPosition)` 决定：`context-compacted:<sessionId>:<basedOnPosition>`。
  - 用同一个 ID、不同内容追加，存储报 `idempotency_conflict`，这里映射成 `conflict`。
  - 两个调用同时过了第 2、3 行、内容相同：后到的那个，存储按 recordId 原样返回已有的那条（F1），这里照样返回 `appended`，位置是已有那条的。
  - 提交以后、回复丢了，再用同样内容调一次，会命中第 2 行（revision 已变）或第 3 行（尾已是这条压缩记录），不保证返回原记录。和 K 片 L2 一样，确定的 recordId 只是第二道防重复；平台的重做靠 L12 的复用。

**L4 一个 Turn 的记录范围不含压缩记录。**
依据：裁定 11；追查第 3 节，`readTurnBounds` 的结束位置要停在终止事件上。
- `turnRecordRange`（`sqlite-stores.ts:751-763`）去掉 `context.compacted` 记录。这样，`readTurnBounds.endPosition` 仍然是这个 Turn 的终止事件。
- 恢复内部的 `turns[].endPosition` 不提要求（裁定二第 7 条）。裁定 11 要防的“尾部压缩记录变成 Run 的结束位置”，由 L7 最后一条（`observation-recovery.ts`）和 L12（只写在本轮持有的 Session 上）管住。

**L5 恢复时按最新一条压缩记录拼。**
依据：DESIGN:1047-1049、1052；决定 49；裁定 10；GW 变更点 5；裁定二第 16 条；裁定四第 7 条。
- **边界：** `throughPosition` 可以是一条压缩记录。按 L3，它的 `basedOnPosition` 就是前一条，必是终止事件。别的非终止记录照旧拒绝。
- **用哪一条：** 用 `viewPosition` 及以前最新的一条 `compacted` 记录，跳过 `failed` 的。没给 `viewPosition` 时它就是 `throughPosition`。一条都没有，就和今天一样。`viewPosition` 之后的压缩记录不用。
- **`viewPosition`（裁定四第 7 条）：**
  - 派生的 `session_history` 加一个可选的 `viewPosition`（`SessionContextMode`，`app/composition/composition-contracts.ts:51-61`），默认等于 `throughPosition`。
  - 选压缩记录按 `viewPosition`；截前缀照旧按 `throughPosition`（`session-history.ts:296`）。摘要和桩只作用在前缀里的 Turn。
  - 存进 `contextBasis`：`contextBasisSchema` 加一个可选键，形状同 `throughPosition`；`ContextBasis` 类型和 `parseContextBasis` 照 `sourceSessionId` 的样子带上它（F2）。`SessionHistoryRestoreInput`（`session-history.ts:44-51`）加同名的可选字段。
  - `assertSameExecutionContent` 多比它（`composition-root.ts:595-603`），所以下面“恢复执行时……逐字节相同”继续成立。这就是裁定四第 7 条说的“进比较”（裁定五第 6 条确认）。
  - `composition-root.ts` 的入口先把入参交给 `resolveSessionContextMode`（`:135`，定义 `:535`），它的 `session_history` 分支重建返回对象（`:554-559`），只留旧字段。要在这个返回对象里带上它：`...(viewPosition === undefined ? {} : { viewPosition })`，值取入参的，入参有才带（裁定六第 1 条）。不加校验。
  - `composition-root.ts` 建 `contextBasis`（`:302-311`）、恢复（`:313-324`）时带上它；`resume-composition.ts:230-239` 照 `turn.started` 里存的 `contextBasis` 透传。
  - 不加别的校验（不核它和 `throughPosition` 谁大、不核旧摘要的范围），不加新的 mode 值，不升 `contextBasis.version`（§5）。
  - 今天的调用者都不传它，行为不变。只有 L18 的摘要调用传。
- **摘要：**
  - `summary.throughPosition` 及以前的 Turn 不进 transcript；但照常重放，照常记进 `turns`，所以身份重叠检查继续有效（同 K 片 L3）。
  - 在 transcript 最前面加一条用户消息（Kernel 已有的 `user_message`，不加新角色）：
    - `messageId` 是 `context-summary:<压缩记录所在的 sessionId>:<压缩记录的 position>`（派生基线时是源 Session 的 ID）；
    - 正文是 `<前言>\n\n<摘要原文>`。前言第一稿：`以下是本线更早对话的压缩摘要（压缩记录 <position>，覆盖到位置 <throughPosition>）。原记录没有删除。`
  - 摘要消息和后面第一个保留轮的用户消息之间不插东西，两条用户消息相连。DeepSeek 收不收由 G6 看（L21）；第 9 片的真实运行报错再改（裁定二第 16 条）。
- **桩：**
  - 范围：摘要之后、到 `stubs.throughPosition` 为止的 Turn。
  - 只换 `status: 'success'` 的工具结果：`output` 换成 `[{ kind: 'text', text: <L6 的桩> }]`。换完 `output` 的 UTF-8 JSON 严格更短才换（同 `context-selection-policy.ts:248-251`）。
  - 调用、`callId`、状态、`effects` 都不动，调用和结果仍成对；失败的结果不换（裁定 1 的参数）。
- 最近的轮原样保留。范围由平台按 L11 算，Kernel 只照记录做。工具调用的参数不动（裁定 7）；每轮的用户输入不动（裁定 6）。
- `:409` 对整个前缀的成对检查照旧。
- 返回值的形状不变（不加字段；两个调用者只用 `.transcript`，F2）。
- 恢复执行时，按 `contextBasis` 再调一次，得到逐字节相同的视图（F2）。
- 派生基线（接续、审阅、问一问副本、摘要调用）也走这同一个函数。
  - 接续、审阅、问一问副本不传 `viewPosition`。所以源 Session 里种子终止位置以前的压缩记录自然生效，之后的不生效（裁定 10，追查第 2 节）。
  - 摘要调用传 `viewPosition` = 本轮游标（L18）。所以保留边界之后、游标及以前的那条旧 `compacted`，它的旧摘要和旧桩在摘要调用的历史里也生效（裁定四第 7 条）。

**L6 桩的文字。**
依据：DESIGN:1046、1064；裁定 4；答复 27 第 4 条（“能定位原执行、原输出和版本”）。
- 格式：`旧工具结果已清（工具 <name>，调用 <callId>，参数 <参数摘要>，位置 <p>，原 <N> 字节）。要原文：<readBack[runId]>`
  - `<p>` 是记下这个结果的那条 `tool.completed` 事件记录的 Kernel 位置。Kernel 记录不会改，所以位置就是这份输出的版本；
  - `<N>` 是原 `output` 的 UTF-8 JSON 字节数（`Buffer.byteLength(JSON.stringify(output), 'utf8')`），十进制、不加分隔符；
  - 参数摘要：`JSON.stringify(call.arguments)`（记录读回后的键序）的前 80 个码点；超过 80 个码点时，取前 80 个再加 `…`。恢复仍是纯函数，不要工具表；
  - `<readBack[runId]>` 是平台给的文字，Kernel 原样写进去。
- 同样的记录，给出同样的字节。

**L7 摘要消息受保护；版本号。**
依据：裁定 9；K 片 L1 的先例。
- `selectContext` 的保护集合（`context-selection-policy.ts:256-264`）加上：历史里 `messageId` 以 `context-summary:` 开头的用户消息。
- 摘要加最新输入就已超预算时，照旧报 `required_content_over_budget`。
- 超预算时，Kernel 的第 4 步照旧会把 K2 的桩（约 300 字）再换成它自己更短的占位（`:95`、`:238-254`），读回文字就看不到了。接受，不改代码：K2-M 以后这只在一次请求超过约 0.89 窗口时发生（M4），压缩和换手都在那之前。
- `public-api.ts` 导出 `appendCompactionRecord` 和它的输入、结果类型。
- `kernelSessionApiVersion` 从 3 改为 4（`composition-contracts.ts:43`）；平台类型 `src/core/agent-runtime/contracts.ts:5` 改为 `1 | 2 | 3 | 4`。
- `runtime-runner.ts` 不改。`composition-root.ts`、`resume-composition.ts` 只改 L5 的 `viewPosition` 透传（裁定四第 7 条）。
- 平台的类型窄化（F8 最后一条）：`observation-recovery.ts:236-237` 改成只在 `recordType === 'agent.event'` 时读 `payload.event`，其余返回 `matches: false`。这是 K2-K 合入时类型检查要的，行为不变（组一落地时没有压缩记录）。

### 2.3 平台第一步（K2-P1）

**L8 端口和能力。**
依据：DESIGN:1222（压缩说明由 AgentRuntime 写）；MVP 行为第 23 行（做好以前按真实能力显示 unsupported）；K 片的端口先例（F9）。
- `RuntimeExecutionPort` 加两个可选成员 `compactSession?` 和 `compactionSupport?`，放在 `ports.ts:113-138` 旁边。实现照 `closeProvedTurn`（`runtime.ts:342-482`），注入照 `turnClosure`（`create-platform.ts:2157`）。
- `compactionSupport` 在这些情况下报不支持：Runtime 没装；只有 legacy 读取器；适配器不同；Kernel 没有 `appendCompactionRecord`。不看版本号（`dist` 和补丁源一起生成，不会混用，§5；先例 `runtime.ts:522-547`）。
- 每次调用时从注入的 `kernel` 依赖读 `appendCompactionRecord`，不在构造时缓存；测试照 K 片 M2 的做法，用 `vi.hoisted` 加 `vi.mock` 把它换成可开关的 getter。
- `nativeCompact`（`create-platform.ts:695`）按它报：
  - 支持时，reason 写“两轮之间在同一 Session 里压缩：先清旧工具结果，不够再写摘要；原记录不动”；
  - 不支持时，写原因。

**L9 Host 设置 `compaction`。**
依据：裁定 1 的参数段；决定 49 第 27 项“压缩与换手条件分开配置”；照 `planLoopLimits` 的做法。DESIGN:1654 写成“项目设置”，裁定定为 Host 设置，按裁定；DESIGN 要改（§7）。

```ts
// src/contracts/compaction-settings.ts（新文件）
export type CompactionSettingsV1 = {
  schemaVersion: 1;
  triggerRatio: number;      // 0.4
  targetRatio: number;       // 0.2
  keepRecentTurns: number;   // 3
  tokensPerChar: number;     // 0.29
  summaryMaxTokens: number;  // 8192
};
```
- 读出 `saved`、`effective`、`defaults` 三份。保存时存整张表；传 `null` 删掉存的值、回到默认（照 `host-settings.ts:1371-1385`）。
- 校验只管形状：两个比例在 (0, 1) 之间；`keepRecentTurns`、`summaryMaxTokens` 是不小于 1 的整数；`tokensPerChar` 大于 0。
- 换手阈值不放在这里，照旧是 `min(500,000, floor(0.8 × 窗口))`（F5）。
- 每次开始只读一次设置。
- 终值等 G7 量完再定（113-7）。测试要别的数时，在测试里经 KE4 改设置；默认值不为测试改（裁定二第 8 条）。

**L10 什么时候压：一个纯函数 `compactionBasis`。**
依据：裁定 1、2、5 的参数段（防抖）、8、10；决定 49“只在线确实太长时压”（DESIGN:1036）；裁定二第 15 条；裁定三第 1 条；裁定四第 5 条。
- **放在哪里。** DESIGN:1220 把“什么时候压缩”归 Workflow，:1305 写“Workflow 在两轮之间按输入量触发”。本规格把这个纯判断放在 `src/core/work-graph/tasks/compaction-basis.ts`：
  - 和 `secretaryHandoffBasis`、挑秘书在同一个子模块，这是现有的先例（它们按 DESIGN:1220 也该在 Workflow）；
  - AgentRuntime（开始时，L12）、WorkGraph（挑秘书，L16）、Workflow 都能引用它；放在 AgentRuntime 的话 WorkGraph 引用不了（F11）。
  - 这是和 DESIGN 的偏差，DESIGN 那两行要改（§7）。
- 只在 L12 的入口条件成立时算（这一轮的历史决定是本 Session 自己的 `session_history`）。
- 按下面的顺序判断，第一条不成立就停，后面的不再读：
  1. `compactionSupport` 报支持。
  2. **触发：** 上一轮最后一次报了 `inputTokens` 的请求，达到 `triggerRatio × 窗口`。
     - 上一轮指游标所在的那个 Turn 对应的 Run 或 QueryRun，按下面“上一轮怎么找”；
     - 窗口是这条线所绑模型的 `contextWindowTokens`；
     - 没有报数的不压（同 `secretary-handoff-basis.ts:40`）。
  3. **不是防抖：** 上一轮“用压缩后的历史开始”，而且它最后一次请求达到换手阈值，就不压（L16）。
     - 先看第 2 条用到的那个数：没到换手阈值，这一条就成立，不读 Kernel；
     - 到了，再读 Kernel：上一轮的 `throughPosition` 及以前，本 Session 有没有一条 `compacted` 记录。
  4. **够长：** 当前视图里，进模型历史的完成 Turn 多于 `keepRecentTurns`（裁定 1）。只数上一条 `compacted` 记录的摘要之后的 Turn。
- **上一轮怎么找（裁定四第 5 条，F14）。** 开始时（L12）、一轮结束时（L16）、挑秘书时（L16）都用这一条；L13 也引用它。
  ```
  上一轮(session):
    rid = 游标那条 Kernel 终止记录的 payload.event.meta.runId
    for e in 按 generation 从大到小合并(
          S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP,    // 项是 DispatchOutboxEntry：经 claim.runRef 读 Run，取 executionHistory.kernel.runId
          S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP):    // 项是 QueryRun：读存盘字段 run.executionState.entry.kernel.runId（query-job.ts:609-616）
      if 它的 Kernel runId == rid: return e
    return null   // 就是上面第 2 条的“没有报数，不压”，不是新加的分支
  ```
  - “它的 Kernel runId”不是现成的函数，就按上面两行注释读，不加 helper（裁定五第 6 条）。
  - 读法照 `work-line-reader.ts:2680-2701` 的 `lookupOrdered`（`direction: 'desc'`）。
  - 开始时排在最前的是本轮自己，它的 runId 对不上，自然跳过，不用第二种找法。
  - 不建按 Kernel runId 的索引，不加“上一次执行”字段，不改领取时写 `lastExecutionRef` 的规矩，找不到不加专门的错误码（§5）。
- **上一轮的数从哪里读（裁定二第 15 条，裁定三第 1 条，F14）：**
  - Query：这个 QueryRun 的 `executionState.requests`，从后往前第一条 `inputTokens` 不是 `null` 的（同 `secretary-handoff-basis.ts:78-85`）；挑选报告是同一行的 `prompt.selection`。在这个 Turn 的终止之前就写好了（F14）。
  - Work：请求记录里没有 `inputTokens`（F14），读 Kernel 记录：上一轮 Turn 里最后一条 `model.usage_recorded` 的 `delta.inputTokens`，从游标往前按页读，到这个 Turn 的 `turn.started` 为止；挑选报告是同一个 `requestId` 的许可里的 `prompt.selection`（许可按上一轮的 RunRef 读，`model-call-service.ts:370-389`）。两者都在游标（这个 Turn 的终止）之前写好（F14）。不从 `RunActivity` 读：它只留前 256 次请求（`run-activity-tally.ts:302`）。
- 不加“至少省多少才压”（裁定 8）。
- 触发、目标、换手都按模型服务报的真实 token（用户答复）。K2-M 落地以后 Kernel 到约 0.89 窗口才裁（M4），所以这里的 0.4 和 0.5 都在它之前。

**L11 第一步：算桩。**
依据：DESIGN:1046-1049；裁定 1、6、7。
- **保留边界：** 当前视图里最新的 `keepRecentTurns` 个进模型历史的完成 Turn，它们前面最近的那个进模型历史的完成 Turn 的终止位置。中间夹着被中断的 Turn 时跳过它：它的终止是 `run.interrupted`，不能当桩的边界（L3 第 4 行）。`stubs.throughPosition` 取保留边界。
- **新换掉的字数：** 只算这次新进入桩范围、按 L5 会被换掉的结果。每个结果算“原 `output` 的 JSON 码点数减去桩的 JSON 码点数”，再加总。以前的记录已经换过的不算，因为上一轮的请求里它们已经是桩了。
- **上一轮最后那次请求被 Kernel 裁过，就算不够。** 它的挑选报告（L10 读到的那份）里 `toolResultBody` 或 `historyExchange` 大于 0 时，第一步算“不够”。原因：Kernel 先换的正是最旧的结果（`context-selection-policy.ts:238-254`），也就是这次要换桩的范围，`inputTokens` 里已经扣过；再减一遍，会把不够算成够。
- **估算** = 上一轮最后一次请求的 `inputTokens` − 新换掉的字数 × `tokensPerChar`。
- 估算不超过 `targetRatio × 窗口`：写一条 `compacted`，只带桩，不写摘要。有旧摘要时，Kernel 按 L3 带过来。
- 估算超过，或按上一条算不够：走第二步（L18）。P2 还没落地时，写一条 `failed`，`reason: 'summary_unsupported'`，桩也不用（裁定二第 12 条；和 L16 的失败一样）。

**L12 在哪里写，`throughPosition` 用什么。**
依据：裁定 2；追查第 2、3 节；裁定二第 3 条。
- **入口条件。** 只有这一轮开始时的历史决定（Work：`execution-driver.ts:785-795`；Query：`query-execution.ts:812-834`）是本 Session 自己的 `session_history`（没有 `sourceSessionId`）时，才进入下面这些步骤。其余照今天，不读、不写：
  - 种子轮（接续和审阅的第一个 Run、问一问副本）。这些 Session 没有游标（F6，`context-history-facts.ts:136`），压缩从不写进种子的源 Session；
  - `current_turn`，包括准备时没有游标、开始时有游标的那种竞态（`execution-driver.ts:790-792`、`query-execution.ts:828-830`）。这种 Session 有游标，L10 第 2 条挡不住它；它这一轮没有 `throughPosition`，写了记录也当不了边界。
- **写的位置：**
  - Work：读完成边界、建 `sessionContext` 之前，即 `execution-driver.ts:775` 和 `:793` 之间。新开始的在 `beginRuntimeEntry` 之后；恢复暂停的 Turn（`resumeEntered`）跳过 begin，也走这一段（F7）；
  - Query：`query-execution.ts:812-834` 建 `sessionContext` 之前。
- **先读游标之后的记录：**
  - **这次读失败：** 和 `execution-driver.ts:775` 读完成边界失败一样，这一轮开始返回可重试的 `unavailable`，什么都不写（裁定六第 4 条；收尾同下面“读头失败”）。L10、L11 的读不另补。
  - **什么都没有：** 按 L10 判断（上一轮按 L10 的找法）。要压，就按 L11（和 L18）算，探测头的 revision，然后调 `appendCompactionRecord`。
  - **第一条是一条压缩记录（`compacted` 或 `failed`），它的 `basedOnPosition` 就是游标：** 直接复用它，不管后面还有什么，不再判断，也不再写。包括：
    - 上一次开始时写了记录，但 `turn.started` 没写成（崩溃，或下面说的冲突）；
    - 恢复暂停的 Turn：它的 `turn.started` 记的就是这条记录，Kernel 要求同一个 `throughPosition`，否则报 `idempotency_conflict`（F2）；
    - K 片关掉了在这条记录之后开始的 Turn：接续仍从这条记录开始，被中断的 Turn 不进历史（同 K 片 L3 的“关后第一次接续游标不动”）。
  - **别的情况**（例如游标后面直接是被中断的 Turn）：这一轮不压，照今天用游标。
- 写成或复用的那条记录，它的 `position` 就是这一轮的 `sessionContext.throughPosition`。没压的话，照今天用游标。
- **Kernel 返回 `conflict` 或读头失败：** 这一轮开始返回可重试的 `unavailable`，这次什么都没写。
  - Run 停在 Entering（Query 停在 begun），和今天读完成边界失败一样（`execution-driver.ts:775`、`query-execution.ts:822`）。
  - 收尾也和那时一样：启动核对判 W-05（窗口里没有本 Turn 的 `turn.started`，`run-reconcile.ts:312-314`；Query 判 Q-02，`:613-615`），之后同一个领取重新授权（RUN-03）再开始；那次开始按上面的复用规则，用已经写下的那条（如果有）。
  - 不加进程内的撤销（裁定二第 3 条）。
- Kernel 返回 `unreadable`、`not_idle`、`invalid`，或报不支持：这一轮不压，照今天开始。
- 平台不另存压缩的事实。“已压缩”、失败、防抖都从 Kernel 的记录读（DESIGN:1406、1689）。

**L13 读回引用。**
依据：裁定 4；答复 27 第 4 条；裁定二第 6 条；裁定四第 5 条。
- 平台给 `stubs` 范围里每个进模型历史的 Turn 的 Kernel runId 配一条读回文字，所以 L3 第 4 行不会因为缺读回而拒绝：
  - **Work 轮：** 用 L10“上一轮怎么找”的同一个找法，只查 Work 的索引（`S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP`），拿这个 Turn 的 Kernel runId 找到对应的 `RunRef`，读回文字是 `look_graph {"mode":"history","runRef":<RunRef 的 canonicalJson>}`（键按字典序，`src/contracts/fingerprint.ts:24`）。例：`look_graph {"mode":"history","runRef":{"aggregateType":"Run","goalId":"g1","projectId":"p1","runId":"r1"}}`。
  - **别的**（Query 轮，或找不到对应 Run 的）：固定文字 `原文在本线的会话历史里，本线现在没有读回入口`。
- `look_graph` 不加按 Kernel 位置的查找。

**L14 历史行和原记录。**
依据：DESIGN:1010、1047；裁定 10。
- 历史条目加一类 `context_compacted`（`session-operations.ts:68, 372-373`；`observation-recovery.ts:175-176`），正文就是这条记录。`outcome` 决定显示“已压缩”还是“压缩失败”；界面怎么画归 E3。
- 原记录逐条不变。`sessions/history`、`executions/history`、`look_graph` 的 `history` 永远读原记录，不套压缩。

**L15 对账和观察。**
依据：裁定 11；追查第 3 节。
- F8 的四处只需要 L1 的记录能解码。`sessionRecordSchema` 来自 Kernel 的公开接口，K2-K 落地就有了，所以这四处的代码不改：
  - `run-reconcile.ts:337`：`turnLast` 只取本 Turn 的 `turn.started` 及以后。压缩记录在它前面，取不到。如果开始时写了记录、`turn.started` 没写成，照旧判 W-05 没进入（`:311-314`）；记录留着，下一次开始按 L12 复用。
  - `run-reconcile.ts:621`：窗口从游标或 `startPosition − 1` 起，压缩记录只可能在本 Turn 之前。没有 Turn 时照旧判 Q-02（`:613-615`）。
  - `execution-observation.ts:725`：从 `startPosition − 1` 之后读，压缩记录在它前面。这一轮没结束时，按 L2、L3，Kernel 不收新的压缩记录，所以 `decoded.at(-1)` 不会是压缩记录。
  - `query-observation.ts:342-351`：从游标读起，压缩记录在 `turn.started` 之前，最后一条仍是本轮的记录。
- 压缩记录要跟在一个还没入账的 Run 后面，只有一种可能：在那一轮还占着 Session 时写。L12 只在下一轮已领取、上一轮已入账之后写（F7），入口条件又不让种子轮写源 Session。所以这几处不加检查（§5）。

**L16 失败、防抖、换手的先后。**
依据：裁定 1 的参数、裁定 5；DESIGN:1053-1054；答复 27 第 5 条；裁定二第 4、5、13 条。
- **失败**时写一条 `failed` 记录（L11、L19），视图不变：前一条 `compacted` 照旧生效，其余照今天（靠 Kernel 每次请求的占位）。这条记录本身就是“压缩失败”那一行（裁定 5）。不存别的状态：下一轮条件还成立就再试（裁定二第 13 条）。
- **防抖**（L10 第 3 条）。“用压缩后的历史开始的一轮”照裁定原文的宽读法：这一轮的 `throughPosition` 及以前，本 Session 有一条 `compacted` 记录。不只是 `turn.started` 紧挨在压缩记录后面的那一轮（裁定二第 5 条）。
  - 换手阈值对每条线都是 `min(500,000, floor(0.8 × 窗口))`，同 `secretary-handoff-basis.ts:36-37` 的式子。执行者线没有换手，这个数对它只用来防抖。
  - 后果：压过一次以后，任何一轮结束时到了换手阈值，下一轮开始时都不再压。有换手规则的线换手；执行者线照旧靠 Kernel 每次请求的占位。只到触发值、没到换手阈值的，下一轮照样再压（裁定 9）。
- **有“太长就换手”的线什么时候换手。** 今天只有秘书（`host.ts:1073`、`session-handoff.ts:341`）；7D2 以后参谋、书记也有（F12），照秘书的规则（裁定二第 4 条）。它们都用 `secretaryHandoffBasis` 这一张表。K2-P1 在这张表里加一个输入 `compactionDefers`：`tooLong = 到了阈值 && !compactionDefers`。
  - `compactionDefers` 为真，要两条都成立：
    - 用 L10 同一个函数，按这条线自己的 Session 算“下一轮开始时会不会压”，结果是会。上一轮按 L10 的找法，就是刚结束的这一轮（结算后游标已在它的终止）；
    - 这一轮开始时没有压缩失败：它的 `turn.started` 记下的 `contextBasis.throughPosition` 指的那条（L12 写成或复用的那条）不是 `failed` 记录（裁定六第 2 条）。不看物理上的前一条：复用 `failed` 时，中间可能隔着 K 片关掉的 Turn（L12 的复用规则）。不加新读法，`contextBasis` 本来就在 `turn.started` 里（F2）。
  - 所以不支持、完成的轮不够多、防抖、这一轮开始时压缩失败，都照今天换手。
  - 用这同一个 `tooLong` 的地方，都跟着变：Host 的一轮结束（`host.ts:1073`）、`startHandoff`（`session-handoff.ts:341`）、7D2 的角色线维护（F12）、挑秘书（`secretary-selection.ts:126`）。挑秘书这一处是必须的：不然等着压缩的线下一次请求轮选不上，既不压也不换手。
  - Kernel 记录的事实由 AgentRuntime 读，经一个注入的端口交给读“太长”的那个函数，和挑秘书的 `profiles`、`scope`、`duty` 一样（F11）。没接端口时 `compactionDefers = false`，今天的夹具和测试不变。
- **别的线。** 执行者、审阅者照执行者线：不加换手，失败只留“压缩失败”那一行（裁定 5）。
- “这一轮开始时用的那条记录”“这一轮用的历史”都由 Runtime 读 Kernel 记录得出，不存平台记录。

**L17 接续和审阅轮。**
依据：裁定 10；追查第 2 节。
- 平台不改。它们的种子按 L5 自然用上源 Session 在种子终止位置以前的压缩视图，之后的不用。
- 它们自己的第一个 Run 不压（L12 的入口条件）。
- 接续 Session 从第二个 Run 起看不到种子（DESIGN:1025），之后按一般规则算它自己的 Session。

### 2.4 平台第二步：摘要（K2-P2）

**L18 摘要调用。**
依据：裁定 3、9；DESIGN:1032；裁定二第 9 条；裁定三第 2 条；裁定四第 1、6、7、14 条；裁定五第 1、3 条。
- 第一步不够时，这条线做一次派生调用：
  - 同模型、同设置、同系统说明、同工具列表；
  - 历史是这次压缩之前的视图，截到保留边界为止。有旧摘要时，旧摘要就在最前面，所以新摘要 = 旧摘要 + 之后的轮（裁定 9）；旧桩也照旧生效（L5 的 `viewPosition`）；
  - 摘要提示放在最后（裁定五第 3 条，裁定六第 7 条）：
    - 它是提示词包里的模板 `context-summary-request`，文件 `resources/prompts/platform/templates/context-summary-request.txt`，`version: 1`，`mentionsTools: []`，没有槽位。和别的较长的固定提示一样放在 `templates/` 下，不放 `strings.json`。
    - id 在 `src`、`resources`、`tests`、`vendor/coding-agent/patches` 里 grep 过，没有重名。不用 `context-summary`：L5 已经把 `context-summary:` 用作摘要消息的 ID 前缀，分开好认。
    - 从本轮冻结的提示词渲染，不读当前包（决定 83；同 `execution-inputs.ts:64-71` 的做法）。冻结的文字在压缩点之前就读好了（Work `execution-driver.ts:506`，Query `query-execution.ts:270`）。为此它进投递集合：`prompt-set-texts.ts:386` 的 `DELIVERY_SET_TEMPLATE_IDS` 加这个 id，准备时就冻结（`templatesToFreeze`，`:389-391`）。（8E-2 冻结注，2026-11-04：8E-2 R 照这个做法在末尾加 `link-breaks-input`；R 先落时这个 id 排在它后面，是第九个，见 §3 :778 的注。）
    - 第一稿正文（第一稿；提示词包定稿时可改，测试跟着改）。正文是下面框里的文字，每行去掉框的 6 格缩进，结尾不带换行：
      ```
      请把上面这段对话写成一份压缩摘要。之后这条线只看这份摘要和最近几轮的原文，更早的原文不再交给你；原记录不会删除。

      只回答摘要正文，不要调用工具。摘要按顺序分成下面六段，每段用给定的标题，一段都不能少；某段没有内容就写“无”。

      ## 目标和验收义务
      ## 用户原话和要求
      ## 做过的决定和依据
      ## 没解决的事
      ## 试过什么、结果如何
      ## 来源

      写的时候：
      - 用户的原话照抄，不改写；你推测的，标“推测”。
      - “没解决的事”写待处理的请求、在等的回复、待放行的事和未决问题。
      - “试过什么、结果如何”也写失败的和排除的路。
      - 注记和当前理解只写链接，不抄内容。
      - 计划和派工只写引用和版本；下一轮照旧重读正式事实。
      - 还在等批准的，不能写成已批准。
      - 已经撤下的结论，不要从旧摘要里再写回来。
      - “来源”一行一条，只用下面四种写法：
        - 文件 <工作区相对路径>
        - 文件 <路径> 提交 <40–64 位小写十六进制>
        - 消息 <messageId>
        - 检查 <goalId>/<taskId>/<runId>/<roundId>
        提交只能写成“文件在某个提交里的版本”，不要单写提交号。
      ```
  - 所有工具调用都被 `before_tool` Hook 拦下，理由固定为 `摘要调用不执行工具`（先例 `query-execution.ts:792-809`）。摘要调用只挂这一个 Hook，不挂线自己的 entered 钩子。
- **Session：只在 Kernel 里开一个临时 Session**（裁定二第 9 条，裁定三第 2 条）。
  - 先建，再调（裁定四第 1 条，F16）：
    ```
    const tmp = 新的 Kernel sessionId;   // 每次调用一个
    await deps.kernelStores.withStore(线的 kernel.adapterId, store =>
      store.create({ sessionId: tmp, recordId: `session:${tmp}`, createdAt: now }, { signal }));
    runObservedModel({ sessionId: tmp,
      sessionContext: { version: 1, mode: 'session_history', sourceSessionId: 线的 kernelSessionId,
                        throughPosition: 保留边界, viewPosition: 本轮游标 },
      … });
    ```
    `session.created` 由平台这次 `create` 写，`turn.started` 和之后的事件由 Kernel 写（做法照 `session-operations.ts:689-694`）。本轮游标就是不压缩时这一轮本来要用的位置（L12）。
  - 不传 `executionIdentity`（裁定六第 8 条）：runId 和 turnId 由 Kernel 自己生成（`composition-root.ts:189`、`:196`）。传了本轮的 `krun-…`（`execution-driver.ts:383-387`、`:1064`；Query `query-execution.ts:867`），线自己的 Turn 写事件时会撞 `session_records` 的 `UNIQUE(run_id, event_sequence)`（`sqlite-stores.ts:480`）。
  - 不加 `already_exists` 的恢复：每次都是新 id，崩溃后下一次开始按 L12 重新算、重新调。Kernel 不在 `session_history` 分支替它建 Session（`composition-root.ts:276`，L7）。
  - 不建平台 Session，不进成员和生命周期，从不往这条线的 Session 里写 Turn。
  - 临时 Session 的记录留在 Kernel 存储里，平台读不到（F16）。接受（裁定三第 2 条）。
- **两个绑定摘要（裁定四第 6 条，F16）。** 摘要调用的请求带这一轮冻结的两个：`contextInputDigest` = 本轮 inputDigest（Work：Run 的 `inputBinding.inputDigest`，同 `execution-driver.ts:953`；Query：`manifest.inputDigest`，同 `query-execution.ts:751`），`manifestDigest` = 本轮 bundle digest（发送层本来就从本轮取）。`requestDigest` 照今天对实际的摘要请求算（`observed-model-run.ts:321`）。只在调用处包一层：
  ```
  summaryCalls = { ...modelCalls,
    beforeCall: i => modelCalls.beforeCall({ ...i, contextInputDigest: 本轮 inputDigest }) }
  ```
  准入比对、许可和请求行的字段都不动。
- **用量记到被压缩那条线的这一轮上**（裁定二第 9 条）：摘要调用用这一轮同一个计量和请求记账，所以它算进这一轮的累计上限。
  - Query：进这一轮 QueryRun 的 `executionState.requests`（`query-execution.ts:698-714`）。Query 这时是 `entering`，准入和记用量都收（F16）。
  - Work：进这一轮 Run 的模型请求许可（`model-call-access.ts:60-99`），也就是这个 Run 的请求记录（`readPromptRecord` 按 Run 列许可，`runtime.ts:741-766`）。许可里没有 token 数（`model-call-contracts.ts:51-68`）；token 数只在这一轮内存里的计量上（`execution-driver.ts:948-949`），算进这一轮的累计上限。两处改动（裁定三第 2 条，裁定四第 14 条，裁定五第 1 条）：
    1. 计量和许可的绑定（`execution-driver.ts:948-958`）挪到压缩点之前、`:765` 之后。`refreshedPermit` 在 `:765` 定下；用到的 `hostConfig`（`:444`）、`prepared`（`:332-337`）、`manifest` 和 `bundleRef`（`:348`）都在这之前就有。
    2. 准入：`admitEnteredRun` 的两行（`execution-entry-service.ts:703-704`）从“只收 `entered` 且 `running`”改成“`entered` 且 `running`，或 `entering` 且 `starting`”。发许可（`model-call-service.ts:192`）和消费许可（`:303`）都经它，一起放开。只有这两处调它（grep 过）。这是裁定四第 14 条的 (A) 路，裁定五第 1 条选定。
       - 今天为什么只收 `entered`：驱动的约定是线的 Kernel Turn 写下、entered 落库以后才调模型（`execution-driver.ts:8-10`）。
       - 不加标记、不加第二条准入：线自己的 Kernel Turn 第一次请求之前，`before_model` 的 entered 钩子先写 entered（`execution-driver.ts:836-909`，`:861` 调 `recordExecutionEntered`），之后才轮到发许可（`observed-model-run.ts:320`）。所以 Entering 时来要许可的，只会是摘要调用。
       - 不动 Run 的状态机、启动核对和观察：许可只写许可记录，Run 只做守卫（F16）。`run-machine.ts` 不改；RUN-04、RUN-05、RUN-16 和启动核对 W-05、W-11 的行都不变。
       - 旧测试：按拒绝文字 `the Run entry is not entered` grep `tests`，0 处。
     - **代价（裁定五第 1 条）：**
       - 摘要调用做了、压缩记录还没写时崩溃：Run 还是 Entering，线的 Session 里没有本轮的 Turn，启动核对照今天判 W-05（`run-reconcile.ts:313-314`，RUN-16 撤销授权）。重新授权后再开始，L12 什么都没读到，再做一次摘要调用：多花一次调用，多留一个临时 Session。
       - 丢掉的那次调用，请求记下了，token 数没记进平台：
         - 它的许可在调模型之前就提交、消费了（`model-call-access.ts:60-96`）。RUN-16 不动许可，所以它还在这个 Run 的请求记录里；重来以后新的许可接着排序号（`model-call-service.ts:211-216`，按 Run 列，`:370-389`）。
         - 它的 token 数只在内存的计量里（`execution-driver.ts:948-949`），崩溃就丢。重来以后新建的计量从零算（`model-budget.ts:56-59`，`totals()` 只加这一次的记录），所以这次调用不算进这一轮的累计上限。
         - Kernel 在临时 Session 里记的 `model.usage_recorded` 还在 Kernel 存储里，平台不读（F16，裁定三第 2 条）。
         - 不加补记。
       - W-05 的依据“Kernel 先写 Turn 再执行”（`docs/refactor/STATE-MACHINES-SPEC.md:4315`）对摘要调用不再成立。判定和结算不变，那一行加注（§7）。
       - 压缩记录写了以后崩溃：按 L12 复用，不再调。
       - W-11（关 Host）不受影响：关闭中的 Host 只在线自己 Turn 的安全点暂停（`execution-control.ts:213-216`，由 entered 钩子之后的 `control.decide` 调，`execution-driver.ts:923`）。摘要调用不是安全点，做完照常写记录、开 Turn，Turn 在第一次 `before_model` 暂停，下次启动照今天结算（`run-reconcile.ts:424`）。结算只读线的 Session，`turnLast` 从本轮 `turn.started` 读起（`:336-337`），读不到压缩记录（L15）。进程内的 RUN-16（`execution-driver.ts:1123-1126`、`:1143-1176`）也只看线的 Session。
  - 读“上一轮最后一次请求”时（L10）：Query 的请求行里有摘要调用的行，但这一轮自己的请求在它后面，读到的是这一轮自己的；这一轮在摘要调用以后一次请求都没发时，读到的是摘要调用的（它约等于压缩前的长度，下一轮最多再判一次，防抖照常）。Work 读的是这条线 Kernel Turn 里的记录，看不到临时 Session 的。
- 不开隐藏的线内 Turn。

**L19 摘要的检查。**
依据：决定 49；DESIGN:1028-1031、1064；裁定 1 的参数、裁定 6；答复 27 第 1、3 条；裁定二第 10、14 条。
- 六个固定段，每段一个固定标题（第一稿；提示词包定稿时可改，测试跟着改）：
  1. `## 目标和验收义务`
  2. `## 用户原话和要求`（原话照抄，不改写；agent 推测的标“推测”）
  3. `## 做过的决定和依据`
  4. `## 没解决的事`（待处理的请求、在等的回复、待放行的事、未决问题）
  5. `## 试过什么、结果如何`（包括失败的和排除的路）
  6. `## 来源`（格式见 L19a）
- 下面几条靠提示词做到，平台不判内容（DESIGN:1029、1064；答复 27 第 1、3 条）：
  - 注记和当前理解只放链接，不抄；
  - 计划和派工只写引用和版本，下一轮照旧重读正式事实；
  - 摘要不能把“待批准”写成“已批准”；
  - 已经撤下的结论，不能从旧摘要里再写回来（新摘要 = 旧摘要 + 之后的轮时尤其要注意）。
- 摘要调用的许可被拒成 `busy` 时（`beforeCall` 抛 `RuntimeModelCallRejected`，code 是 `busy`，`model-call-access.ts:80`；例如 Run 带着排队的暂停或取消，`execution-entry-service.ts:695-696` → `run-machine.ts:187-196`）：不写记录，这一轮不压，照今天开始，同 L12 的“不压”（裁定六第 3 条）。这不是压缩失败，是人的控制，所以不记成“压缩失败”。signal 中止不另写，L12 的“读头失败”已经管住。
- 失败时写 `failed`，`reason` 取下面第一个命中的：
  - 调用报错、没有最后的正文，或最后一次请求没报 `outputTokens`：`summary_call_failed`；
  - 摘要调用的任何一次请求，挑选报告里 `historyExchange` 大于 0：`summary_trimmed`（裁定二第 14 条）。第 6 步“历史结论”只在第 5 步的单位都删完以后才动（`context-selection-policy.ts:268-292`），所以只看 `historyExchange` 就够；
  - 缺任何一段：`section_missing:<段号>`；
  - 最后一次请求报的 `outputTokens` 超过 `summaryMaxTokens`：`over_cap`（裁定二第 10 条；思考的 token 算在里面就算在里面）。
- 来源打不开的，在原处标“来源不可用”，不算失败（DESIGN:1032、1053；L19a）。

**L19a 来源段的格式和核对。**
依据：DESIGN:1028、1032；裁定二第 11 条；F15。
- `## 来源` 段一行一条，只认下表四种。核对在写记录之前做，读用这一轮开始时的 Host 调用上下文；工作区的根目录照接续说明的解法（`context-workspace-facts.ts:40-60`）。

  | 来源 | 摘要里写成 | 平台怎么核 | 算“能打开” |
  |---|---|---|---|
  | 文件（当前版本） | `- 文件 <工作区相对路径>` | `workspaceSource.readCurrentFile(root, path)`（F15） | `ready`；或原因是 `too_large`（文件在，只是超过 1 MiB） |
  | 文件在某个提交里的版本 | `- 文件 <路径> 提交 <40–64 位小写十六进制>` | `workspaceSource.readBaselineBlob(root, '<提交>:<路径>')`（F15） | 同上 |
  | 消息 | `- 消息 <messageId>` | `messages.readMessage(ctx, { aggregateType: 'SessionMessage', projectId, workspaceId, messageId })`，项目和工作区取这条线的（F15） | `ready` |
  | 检查结果 | `- 检查 <goalId>/<taskId>/<runId>/<roundId>` | `graphContext.lookGraph(ctx, { goalRef, target: { kind: 'node', node: { kind: 'round', ref } }, relation: 'card', page: { afterCursor: null, limit: 1 } })`，`ref` 的项目和工作区取这条线的（F15） | `ready` |

- 打不开的行，和 `## 来源` 段里不合上表任何一种格式的行，一样处理：行末加 `（来源不可用）`。
- 对应的 Runtime 依赖没装（`workspaceSource`、`readCurrentFile`、`readBaselineBlob`、`messages`、`graphContext` 都是可选的）：那一种的行一律标“来源不可用”。
- 写进压缩记录的是标过的正文。
- 单独的提交（不带路径）没有读入口（F15），不在表里。提示词要求把提交写成“文件在提交里的版本”。正文里可以提到提交号，但它不算来源链接，平台核对时不认。这是对决定 49 第 27 项“提交”的收窄（裁定三第 3 条），lead 冻结时在 HANDOFF 记一笔（§7）。

**L20 写入。**
依据：DESIGN:1049、1052；裁定 3、9。
- 检查通过：写一条 `compacted`。`stubs.throughPosition` 和 `summary.throughPosition` 都取保留边界，摘要用检查、标过的正文。

**L21 缓存和消息相连只量，不承诺。**
依据：裁定 13；DESIGN:1035、1038；裁定二第 16 条。
- G6、G7 量压缩后第一次请求命中缓存的 token 数。规格不写承诺，测试也不断言命中。
- G6 顺带看 DeepSeek 收不收“摘要消息 + 用户消息”相连（L5）。

## 3. 怎么施工

**三组（裁定三第 4、6 条，裁定四第 12 条）。** 四部分分三组，每组都由 Opus 5.5 按 TDD 写测试和实现，Codex 审查，lead 核对和裁定；合入前在有 bwrap 的环境跑全量和规模批。书和开工裁定冻结时再定细节（裁定三第 6 条）。
- **组一：K2-M + K2-K。** 一起施工、一起落地，测试预算合在一起算（裁定三第 4 条）。
- **组二：K2-P1。**
- **组三：K2-P2。**

**顺序（裁定二第 1、2 条，裁定四第 10 条）。**
- 总顺序：7D2 → 6C → K2-P1 → K2-P2 → 第 9 片 G6。
- 组一：入口已确认，可以先开，和 8E-2、7D2 并行。
- 组二（K2-P1）：7D2 → 6C → K2-P1。K2-P1 的各行都要组一已落地（§4 的共用数：Work、秘书、参谋行都走真实 Host 的绑定，用 K2-M 的计数器）。
- 组三（K2-P2）：K2-P1 之后，第 9 片 G6 之前。决定 113-7 整片进 MVP，第 9 片是整套验收，验收要看到摘要。
- 第 9 片 G1–G5 不等 K2。在共用文件上，K2-P1、K2-P2 和第 9 片 G1、G3、G7 按实际落地先后串行。
- **README**（裁定四第 10 条）：照 `9-start-rulings.frozen.md:143` 的例外，和第 9 片按实际落地先后串行改。K2 新建的文件都要登记：`compaction-facts.ts`（`src/core/agent-runtime/README.md`）、`compaction-basis.ts`（`src/core/work-graph/tasks/README.md`）、`compaction-settings.ts`（`src/contracts/README.md`）、摘要模板（`src/contracts/prompts/README.md`）。这四个 README 在第 9 片的表里是 `9-start-rulings.frozen.md:179`、`:177`、`:175`、`:176`，起点都是 `base → S9 Gx`。
- K2-P1、K2-P2 冻结时，起草方把第 9 片、B06 起始裁定里受影响的行重新对一遍，列成清单给 lead：下面两张表，以及 `9-start-rulings.frozen.md:161, 163, 168-171, 173, 210, 211` 和 `b06-start-rulings.frozen.md:63`。

**K2-M（计量，M1–M5；组一）。**
- 要改的文件：
  - `src/core/agent-runtime/model-budget.ts`（工厂、`observe`、新的 `method` 值）；
  - `src/app/runtime-configuration.ts`（BoundModel 接计数器，一行）。
  - 这两个文件在 7D2、6C、第 9 片、B06 的冻结起始裁定里都没有出现（逐份 grep 过）。8E-2 的书还没冻结，冻结时核一遍。
- 要跑、可能变的旧测试：走真实 Host 绑定的文件（`grep -lE "runtimeProvider|createWorkbenchRuntimeHostBindings" tests`，今天 20 个，含 helper）以及引用这些 helper 的测试。脚本模型报的数换算以后，挑选结果可能和今天不同。有断言变了报 lead，施工方不自行改。
- 自带计数器的夹具（例如 `tests/scenarios/support/S3-host.ts:123`）不受影响。
- 落地是安全的：计量只会比今天小（M1 的 `min`）。
- 测试预算：K2-M 生产约 30 行，§4 的两行 KE3 会超过 1 倍；和 K2-K 合在一起算（裁定三第 4 条）。

**K2-K（Kernel 补丁，L1–L7；组一）。**
- 要改的文件：
  - `vendor/coding-agent/patches/` 下的补丁源：`core/ports/session_store/session-store-port.ts`、`session-projection.ts`（先进构建清单）、`session-history.ts`、`storage/adapters/sqlite/sqlite-stores.ts`、`core/context/selection_policy/context-selection-policy.ts`、`public-api.ts`、`app/composition/composition-contracts.ts`，以及 L5 的 `viewPosition` 要改的 `app/composition/composition-root.ts`、`app/composition/resume-composition.ts`（这两个已在构建清单里，`scripts/build-kernel-patch.mjs:14`）；
  - 用 `scripts/build-kernel-patch.mjs --write` 生成 `dist`，不手改（AGENTS.md 第 6 条）；
  - `scripts/build-kernel-patch.mjs` 的清单；
  - `src/core/agent-runtime/contracts.ts:5`；
  - `src/core/agent-runtime/observation-recovery.ts:236-237`（L7 最后一条）。这个文件在 7D2、6C、第 9 片、B06 的冻结书和起始裁定里都没有出现。
- `npm run typecheck`（连 `tests`）要过。施工时类型检查找出别处还有“排除两种类型后直接读 `payload.event`”的，报 lead，不自行扩大改动。
- 要改的旧测试：
  - 版本号：`tests/kernel/R4a-frozen-public.test.ts:636`、`tests/app/A2-runtime-capabilities.test.ts:128`、`tests/app/K-R-runtime-capabilities.test.ts:67`，3 改成 4；
  - 导出清单：`tests/kernel/B2-history-public-export.test.ts:243-255` 加 `appendCompactionRecord`；
  - lead 写出改前、改后的断言后冻结，施工方不自行改。
- 组一落地时，K2-K 这一半在平台上没有效果：
  - 平台不调，就不会有压缩记录；
  - 没有 `context-summary:` 消息，保护集合不起作用；
  - 没有调用者传 `viewPosition`，恢复和今天一样；
  - `nativeCompact` 仍报不支持；
  - `observation-recovery.ts` 的改动在没有压缩记录时行为不变。
- 合入前：在 LF 副本里 `--check` 通过；`tests/kernel` 全部通过；类型检查通过。

**K2-P1（第一步，L8–L17；组二）。** P0 并进这一部分。
- 要改的文件：
  - `src/core/agent-runtime/`：`ports.ts`、`runtime.ts`、`execution-driver.ts`、`query-execution.ts`、`session-operations.ts`、`observation-recovery.ts`；新文件 `compaction-facts.ts`（读 Kernel 记录：视图里完成的轮数、保留边界、新进桩范围的结果、一轮 `turn.started` 记下的 `contextBasis.throughPosition` 指的那条记录（L16）、一轮用的历史里有没有 `compacted`、Work 上一轮最后一条 `model.usage_recorded`；也实现 L16 的注入端口）；
  - `src/core/agent-runtime/execution-contracts.ts`（裁定六第 5 条）：`RuntimeExecutionDependencies`（`:221`）上只加一个可选键，带两样：压缩设置的读取函数（照 `planLoopLimits?: () => …` 的写法，`create-platform.ts:448`、`host.ts:781`）；L10 要用的两个 generation 索引的 `lookupOrdered` 和 Run、QueryRun 的读。L16 的端口由 Runtime 实现、交给 WorkGraph，不放进这个键。先例是同一个类型上的 `turnClosure?`（`:419`）。7D2 在这个文件上是 A1b → O2，每包加一个可选键（`7d2-start-rulings.frozen.md:102`、`:654`）；
  - `src/core/work-graph/tasks/`：新文件 `compaction-basis.ts`（L10、L11、L16 的纯判断）；`secretary-handoff-basis.ts`（7D2 加宽后的版本上加 `compactionDefers`）；`secretary-selection.ts`（接端口）；
  - 7D2 的 `src/core/work-graph/sessions/role-line-maintenance.ts`（接端口）；
  - `src/contracts/compaction-settings.ts`（新）；
  - `src/app/host-settings-types.ts`、`host-settings.ts`、`host.ts`；
  - `src/composition/create-platform.ts`；
  - `src/business/workflow/session-handoff.ts`（只在 `tooLong` 的读法需要接端口时改）。
- 要改的旧测试：
  - `tests/app/A2-runtime-capabilities.test.ts:125` 的 `nativeCompact: { supported: false }` 改成支持，`:186-190` 的“各项理由互不相同”随新理由核一遍；
  - `tests/app/A2-settings-automation.test.ts:69-73`（`snapshot`）和 `:151-154`（`automation/save` 的回包）（裁定六第 6 条）。两处对整个快照做 `toEqual`，L9 加了 `compaction` 以后都会红：
    - 改前：快照的键是 `models`、`workspaces`、`automation`、`resourceCaps`、`workRunTokenBudget`、`planLoopLimits`；
    - 改后：两处的期望都多一个 `compaction: { saved: null, effective: D, defaults: D }`，D = `{ schemaVersion: 1, triggerRatio: 0.4, targetRatio: 0.2, keepRecentTurns: 3, tokensPerChar: 0.29, summaryMaxTokens: 8192 }`（L9 的默认值）；
  - lead 写出改前、改后的断言后冻结，施工方不自行改；
  - 没接 L16 端口的夹具（今天挑秘书、换手、7D2 角色线维护的测试）行为不变，不改。
- 可以单独落地：第一步够的线写桩；不够的写 `failed`（`summary_unsupported`），有换手规则的线按 L16 换手。P1 和 P2 中间不会有真实用户（裁定二第 12 条）。
- 新的纯函数要有生产调用者，不进 `tests/architecture/production-reach-allowlist.json`。所以 P0 不单独落地（GW §5）。
- **和别的片共用的文件**（按四份冻结起始裁定里的文件表和逐文件串行链核过；“改”指那片的书要改这个文件，只引用行号的不算）：

  | 文件 | 7D2 | 6C | 第 9 片 | B06 |
  |---|---|---|---|---|
  | `src/core/agent-runtime/query-execution.ts` | A1b、C1 | G1（装配点透传） | G1 | — |
  | `src/core/agent-runtime/execution-driver.ts` | A1b → O2 | G1（装配点透传） | G1（零 diff） | — |
  | `src/core/agent-runtime/execution-contracts.ts` | A1b → O2（每包一个可选键） | — | — | — |
  | `src/app/host.ts` | 改 | G3 | G3 | 改 |
  | `src/composition/create-platform.ts` | 改 | G3 | G3 → G7 | G2 |
  | `src/app/host-settings.ts` | — | — | 只引用 | G1 |
  | `src/core/work-graph/tasks/secretary-handoff-basis.ts` | O2（加宽成 `roleLineInputBasis`） | — | 只引用 | — |
  | `src/core/work-graph/tasks/secretary-selection.ts` | 改 `orderCandidates` | — | — | — |
  | `src/business/workflow/session-handoff.ts` | O2 改 `startHandoff` | — | — | — |
  | `src/core/agent-runtime/session-operations.ts` | O1b → C1（另一处写“只核对不改”，以 7D2 施工为准） | — | — | — |

  - 6C 起始裁定里的 `ports.ts`（36 处）是 `src/business/workflow/ports.ts`，不是 K2-P1 改的 `src/core/agent-runtime/ports.ts`。
  - 第 9 片只引用 `host-settings.ts`、`host-settings-types.ts`，不改；改 `host-settings.ts` 的是 B06 G1。
  - 第 9 片现在的串行链：`query-execution.ts` 是 `7D2 A1b → 7D2 C1 → 6C G1 → S9 G1`，`execution-driver.ts` 是 `8C G4 → 7D2 A1b → 6C G1 → S9 G1`，`create-platform.ts` 是 `… → 6C G3 → S9 G3 → S9 G7`（`9-start-rulings.frozen.md:161, 163, 211`）。B06 在第 9 片之后。
  - 113-7 说 G7 量的线长用来定 K2 的阈值。G7 的 `readLineUsage` 读逐条请求报的 `inputTokens`（`9-start-rulings.frozen.md:479`；线长 = 头 Session 最后一次请求的输入，`:677`）。默认触发 0.4 在其余场景里到不了，压缩场景用自己的 Host（下面的补充），所以不影响线长报告；阈值的终值仍等 G7（L9）。

**K2-P2（摘要，L18–L21；组三）。** K2-P1 之后做，要提示词包和摘要模板（6C 之后）。
- 要做的：摘要调用（先建临时 Kernel Session、拦工具、两个绑定摘要、用量记账）；段落检查（照 `src/contracts/continuation-brief.ts` 的做法）；L19a 的来源核对；提示词包条目（摘要提示是模板 `context-summary-request`，裁定五第 3 条、裁定六第 7 条；来源格式写在它里面）；重算 `runtime-assets.json`。
- 要改的文件另加 `src/core/agent-runtime/prompt-set-texts.ts`（裁定六第 7 条）：`DELIVERY_SET_TEMPLATE_IDS`（`:386`）加 `context-summary-request`。它不在 7D2、6C、第 9 片、B06 冻结起始裁定的文件表里（6C 只引用 `:184`）。（8E-2 冻结注，2026-11-04：8E-2 R 也在这里末尾加 `link-breaks-input`；R 先落时 `context-summary-request` 是第九个，加在它后面。）
- Work 的两处改动见 L18：计量和许可的绑定挪到压缩点之前；`admitEnteredRun` 多收一种（`src/core/work-graph/tasks/execution-entry-service.ts:703-704`，裁定五第 1 条）。`execution-entry-service.ts` 不在 7D2、6C、第 9 片、B06 冻结起始裁定的文件表里（`.lead-ref/*-start-rulings.frozen.md` 逐份 grep 过，只有行号引用）。
- Query 在 `entering` 时准入和记用量都收（F16），不用改。
- 落地以后，L11 第一步不够时改走 L18，不再写 `summary_unsupported`。
- **K2-P2 的串行块**（裁定三第 2 条，裁定四第 10 条；总顺序 7D2 → 6C → K2-P1 → K2-P2 → G6）：

  | 文件 | 先于 K2-P2 | 和第 9 片 |
  |---|---|---|
  | `src/core/agent-runtime/execution-driver.ts`（把 `:948-958` 挪到压缩点之前，L18） | 7D2 A1b/O2 → 6C G1 → K2-P1 | S9 G1（零 diff，`9-start-rulings.frozen.md:163`）按实际落地先后 |
  | `src/core/agent-runtime/query-execution.ts`（摘要调用用 `:698` 的计量记账） | 7D2 A1b/C1 → 6C G1 → K2-P1 | S9 G1（`9-start-rulings.frozen.md:161`）按实际落地先后 |
  | 摘要提示的模板文件（新，`resources/prompts/platform/templates/` 下）、`resources/prompts/platform/pack.json`（`templates` 加这一条）、`src/contracts/prompts/slot-tables.ts`（照包的规矩，见下）、`src/contracts/prompts/platform-pack.generated.ts`（脚本重生成）、`runtime-assets.json` | 8C G1 → 8E L3/F1 → 7D2 O5b/C1 → 6C G1 | S9 G1（`9-start-rulings.frozen.md:165-171`）按实际落地先后；B06 G1 在第 9 片之后（`b06-start-rulings.frozen.md:25`） |

  - `slot-tables.ts` 照包的规矩（裁定五第 3 条）：包里的每个模板都要在 `TEMPLATE_SLOTS` 里有一条，没登记的模板解包时报错（`src/contracts/prompts/resolve-pack.ts:246-247`；`render-template.ts:282-284`、`:395-397` 当成未知模板）。没有槽位的模板登记成 `{}`，先例是 `stale-files-reminder`（`slot-tables.ts:162`）。摘要提示是固定文字、没有槽位，所以加一条 `{}`。

- **要改的旧测试**（lead 写出改前、改后的断言后冻结，施工方不自行改）：
  - `tests/contracts/PC-platform-pack-v2.test.ts:101-136`：`PACK.origins` 无条件加摘要模板一行（裁定五第 3 条；同 K2-K 旧测试的做法；S9 G1 也改它，`9-start-rulings.frozen.md:173`）。改后多的那一行（裁定六第 7 条）：`'context-summary-request': { packId: 'platform', version: 1, mentionsTools: [] },`。
  - `tests/runtime/S7B-preparation-freeze.test.ts:24-27`（裁定六第 7 条）：手抄的 `DELIVERY_IDS` 末尾加 `'context-summary-request'`（`DELIVERY_SET_TEMPLATE_IDS` 的顺序，`prompt-set-texts.ts:386`）；`:71`、`:113` 展开它，跟着变。（8E-2 冻结注，2026-11-04：8E-2 R 先落时末尾已有 `'link-breaks-input'`，`'context-summary-request'` 加在它后面，是第九个。）
  - 同一份清单在 helper 里还有一份手抄：`tests/helpers/S7B-delivery-samples.ts:12-20` 的 `DELIVERY_SET_IDS`，以及它的 `DELIVERY_SET_TEXTS`（`:23` 起，逐字抄模板文件）。用它的 `tests/runtime/PC-prepare-prompt-freeze.test.ts:151`、`PC-joint-record-and-failure.test.ts:27-28`、`PC-joint-prepare-freeze.test.ts:33`、`PC2-joint-packs.test.ts:79`、`tests/scenarios/S6A-secretary-context-input.test.ts:123` 都比冻结的模板清单，加了 id 会一起红。lead 冻结时定（裁定七第 2 条）：改，和 `S7B-preparation-freeze.test.ts` 同一个理由。改前、改后：`DELIVERY_SET_IDS` 在 `'user-decision-response',` 之后加一行 `'context-summary-request',`（`DELIVERY_SET_TEMPLATE_IDS` 的顺序，加在末尾）；`:11` 的注释改成 “The six delivery templates in the platform pack's order, then the decision response, then the context-summary request (K2).”；`DELIVERY_SET_TEXTS` 末尾加 `'context-summary-request': <模板文件逐字，不带结尾换行>`，字面照 L18 的第一稿正文，提示词包定稿改正文时跟着改；文件头注释里的三处 “seven” 改成 “eight”；摘要提示没有槽位，不加格式函数，“one formatter per delivery template” 不改。用它的 5 个文件展开 helper，不另改，施工后照常绿。（8E-2 冻结注，2026-11-04：8E-2 R 先落时，`DELIVERY_SET_TEMPLATE_IDS` 和 `S7B-delivery-samples.ts` 里已经有 `link-breaks-input`（第八个），K2-P2 的 `context-summary-request` 是第九个：加在 `'link-breaks-input',` 之后，`:11` 的注释跟着带上它，文件头注释的 “seven → eight” 改成 “eight → nine”。见 slice-8E2-SPEC R12。）
  - K2-P1 的三行（裁定四第 9 条）：

    | 行 | 改前（K2-P1 落地时） | 改后（K2-P2 落地时） |
    |---|---|---|
    | K2P1-04 | 秘书线第一步不够，Q6 开始前写 `failed`（`summary_unsupported`），Q6 结束报 500,000 换手、499,999 不换手 | 删去。P2 落地后第一步不够就做摘要调用，这一行就是 K2P2-02 (a)，不另留 |
    | K2P1-10 | R7 开始时写 `failed`（`summary_unsupported`）；R7 的视图仍是 R6 的那个 | R7 开始时做摘要调用，脚本让这次调用报错，写 `failed`（`summary_call_failed`）；R7 的视图仍是 R6 的那个（R1、R2 是桩，R3 原样）。期望值来源加 L18、L19。改坏方式不变 |
    | K2P1-09 | 列出的 `failed` 取 K2P1-10 改前的那条（`summary_unsupported`） | 取 K2P1-10 改后的那条（`summary_call_failed`），场景脚本跟着 K2P1-10 改；别的断言不变 |

**给第 9 片起始裁定修订记录的补充（用户答复，裁定四第 15 条；这是对第 9 片冻结开工裁定 G6 的修订，K2 冻结时由 lead 写进 `9-start-rulings` 的修订记录，不改第 9 片的冻结文件）。**
- 第 9 片的场景一般到不了 40 万，G6 照常跑，不为 K2 改。
- G6 单留一个场景看一次真实模型下的压缩：
  - 这个场景照 `WA`/`WB` 的先例，用自己的 Host 和 ledger（`9-start-rulings.frozen.md:554`、`:654`），不在共用的 `W-accept` Host 上跑。原因：调低的触发会压到同一个 Host 上别的线（`:666-667` 的 A-int、A-wait 有在跑和在等的工作），这些线之后请求的 `inputTokens` 会进 G7 的线长报告（`:220-221`），而决定 113-7 要用这份报告定 K2 的阈值。
  - 开跑前，driver 经 Host 设置的公开写入口改 `compaction`，把 `triggerRatio`、`targetRatio` 调低（建议 0.02、0.01，100 万窗口时是 2 万和 1 万），让一条多于 3 轮的线在第一步不够时走到摘要；
  - 量：线上出现“已压缩”；摘要六段齐全；压缩后第一次请求的缓存命中（L21，只量）；“摘要消息 + 用户消息”相连 DeepSeek 收不收（L21）。
- 这个场景要 K2-P2 已落地（上面的顺序）。G6 的 out（不加生产代码和测试行）不变：改设置走公开入口。

## 4. 验收行为

做法同 K 片 §5：
- 用 TDD（`mattpocock/skills` 的 `engineering/tdd`），一条一条先写失败的测试，再写实现；
- 只走公开入口，不读 `kernel.sqlite`、`ledger.sqlite`；
- 期望值来自本规格或手算，不从被测系统读回；每行的“期望值来源”写出用到的规则、手算的数和字面文字；
- 测试名以行号开头；一行里列了几种情况的，每种都要有断言；
- 每行给一个具名的改坏方式，在这个改坏下测试必须变红；
- 测试行数不超过生产行数（K2-M 见 §3）。

**入口（用户 11-03 晚已确认，不另加）**

| 入口 | 是什么 | 能抓到 | 抓不到 |
|---|---|---|---|
| KE1 | Kernel 公开的 `appendCompactionRecord`、`readTurnBounds`；用 `SqliteStores.get/read/append` 造前提 | 追加表的各行、记录和 revision、Turn 的范围 | 恢复的视图 |
| KE2 | Kernel 公开的 `runCodingAgent`、`resumeCodingAgent`，配脚本模型，看交给模型的输入；以及公开的 `selectContext`（同 `tests/kernel/PC-13-instruction-skill-protected.test.ts` 的字节计量） | 恢复的视图、桩和摘要的字面、边界、身份、派生基线、保护集合 | 平台什么时候压 |
| KE3 | 平台业务流程（场景框架）：Work 走 `workflow.advanceWork`，秘书和参谋走 Host 的请求轮或消息，7D2 的角色线维护走它的维护入口；脚本模型按需报 `inputTokens`、看它收到的请求；Kernel 存储是系统边界，故障在这里注入。K2-M 也在这里测：秘书请求轮走真实 Host 的绑定（`createLocalWorkbenchHost` 加 `runtimeProvider.registry`，先例 `tests/helpers/S6A-request-fixture.ts:547-582`） | 计量、什么时候压、写什么、换手的先后、对账、读回、历史行 | 真实模型的效果和缓存 |
| KE4 | Host 设置的公开读写入口 | 默认值、保存、校验、回到默认 | 设置怎么被用 |
| KE5 | 同 KE3，摘要调用也用脚本模型 | 摘要调用的输入、检查、失败、再次压缩、来源核对 | 摘要写得好不好 |

**各个测试世界共用的预算（裁定四第 11 条）**

K2-M、K2-P1、K2-P2 各行的世界都用这一份预算。它就是 Host 设置内置绑定的预算（`src/app/host.ts:350-354`、`:1298-1299`；`LOCAL_WORKBENCH_BUDGET`，`src/app/runtime-configuration.ts:122`）：

| 字段 | 值 |
|---|---|
| `contextWindowTokens` | 1,000,000 |
| `perResponseTokens` | 16,384 |
| `inputTokens`、`outputTokens`、`maxRequests`、`maxToolCalls`、`timeoutMs` | `null`（例外：K2P2-05 的 Work 行 `outputTokens` 是 8,193，见那一行） |
| Query 的 `budget.maxTokens` | `null` |
| Work Run 的累计上限 `tokenBudget` | 400,000,000：Host 设置的默认值（`src/app/host-settings-types.ts:17`）。启用设置后，Host 用它覆盖启动绑定的 `tokenBudget`（`host.ts:1443`） |

- 共用世界都启用 Host 设置（裁定六第 11 条）：经 S6A 现成的 `extraHostOptions`（`tests/helpers/S6A-request-fixture.ts:338`）传 `settings: { settingsDirectory }`。memory 存储默认不开设置（`host.ts:480-485`）。启用以后，S6A 夹具自己写的 Run 上限 1,000,000（`S6A-request-fixture.ts:242`）被上表的 400,000,000 覆盖；启动绑定的 grant（含 `workBudget`）照旧保留（`host.ts:1338-1353`）。不改 helper。

- 为什么要定：今天这些世界用的是 `AG2B_RUNTIME_BUDGET`，窗口 200,000、每次回复 512、`maxRequests` 16、`maxToolCalls` 16、`timeoutMs` 60,000，Query 的 `maxTokens` 200,000（`tests/helpers/AG2b-collaboration-fixture.ts:85-89`；S6A 用在 `S6A-request-fixture.ts:190`、`:199`，S3 用在 `tests/scenarios/support/S3-host.ts:124`）。不改的话，K2P1-02、-10、-13 等行的“够不够”会翻转，K2-M 的 983,616 也不成立；K2M-01 的 17 次请求、K2P1-13 的 257 次请求还会先被调用次数上限截住（`model-budget.ts:139`）。
- 每个世界怎么拿到它：
  - Work 行：S6A 现成的 `workBudget` 选项（`tests/helpers/S6A-request-fixture.ts:231-235`），传上表的各字段。
  - 秘书行（含 K2-M 两行）：在 S6A 的 Host 上，经 Host 设置的公开入口打开一个目录（`workspaces/open`），保存并选一个 `deepseek` 的 `deepseek-v4.1-flash` 模型（`models/save`、`models/select`）。Host 给这个目录发布的本地秘书 profile 就是上表。先例 `tests/app/PL-wiring.test.ts:219-228`。脚本模型照旧由 `runtimeProvider.registry` 给（`S6A-request-fixture.ts:547-551`）。
  - 参谋行：同秘书，走 Host 设置里保存的 1M 模型。7D2 还没落地，参谋线在这样的目录里能不能开，7D2 落地后在落地树上核（裁定五第 4 条）。核不过时用 S6A 现成的 `extraBindings`：加一个新的 binding id，带上表的 `grant.budget` 和它自己的 `queryProfile`（`tests/helpers/S6A-request-fixture.ts:212-229`，类型 `:319-329`），不改 helper。
- 现成入口做不到的：`S6A_SCOPE` 里秘书 profile 的预算（`S6A-request-fixture.ts:190`、`:199`）和 `S3-host.ts:124` 都写死、没有覆盖入口。本片的行都不用这两处，所以不改 helper，白名单不加。
- 不逐行写 Host 输入配方，不另起世界。

**K2-M 各行共用的数（手算）**
- 秘书绑定的预算是上表。所以普通轮的挑选预算是 1,000,000 − 16,384 = 983,616。
- 按字节计时：请求的 UTF-8 JSON 字节数 B 满足 B + 4,096 > 983,616，即 B > 979,520，Kernel 就裁。
- 报数用固定的数（裁定六第 9 条）：脚本模型的用量在排队时就定了（`S6A-request-fixture.ts:716` 原样复制回复，`B2-runtime-fixture.ts:90-92` 原样吐出），不能按收到的请求现算。没写的每次请求报 `inputTokens: 1,000`，行里另说的除外。
- 所以 r = 1,000 ÷ B′，B′ 是上一次请求的字节数。估算 = min(B + 4,096, ceil(1.1 × 1,000 × B ÷ B′)) ≤ ceil(1,100 × B ÷ B′)。B ÷ B′ ≤ 894 时不裁（983,616 ÷ 1,100 = 894.2）。
- 一轮里相邻两次请求，后一次只多一次 `read` 的调用和结果。f 文件的结果是 64,000 + 27 字节，连调用不到 65,000 字节。
- 文件 f1–f16：每个是单行、64,000 字节的 ASCII 文件（在 `read` 的 64 KiB 输出上限内，`vendor/coding-agent/dist/tools/builtin/read/read-tool.js:35`）。
- 占位文字是 `内容因长度省略（工具 read，调用 <callId>），需要时重新读`（`context-selection-policy.ts:95`）。

**K2-M**

| 行 | 入口 | 行为 | 期望值来源 | 改坏方式 |
|---|---|---|---|---|
| K2M-01 | KE3 | 秘书一轮：第 k 次请求（k = 1…16）调 `read` 读 f_k，第 17 次回答。第 17 次请求里 16 个 `read` 的调用和结果都在，结果正文是 f1–f16 的原文 | M1–M3。B₁₇ ≥ 16 × 64,000 = 1,024,000 > 979,520，按字节会裁。不到 979,520 字节的请求走 `min`，不裁。超过的，r 来自上一次报的 1,000；上一次只少一次读，至少 979,520 − 65,000 = 914,520 字节：B ÷ B′ < 1 + 65,000 ÷ 914,520 < 1.072，估算 ≤ ceil(1,100 × 1.072) = 1,180 ≤ 983,616，不裁 | BoundModel 不接计数器（第 17 次请求少了最早的几次 `read` 交换） |
| K2M-02 | KE3 | 每种一例：(a) K2M-01 之后，在同一份存储上重建 Host；下一轮第一次请求里，f1 的结果是占位；这一轮第一次回复调 `read` 读一个 100 字节的文件，第二次请求里 f1–f16 的原文都在。(b) 脚本对每次请求都报 `inputTokens: 0`，照 K2M-01 跑：第 17 次请求少了最早的 `read` 交换。(c) K2M-01 之后同一个 Host：下一轮第一次请求，脚本回 `{ kind: 'error', code: 'provider_request_failed', retryable: false }`、不报用量，这一轮按模型服务中断结束；再下一轮的第一次请求里，f1 的结果是占位。(d) 脚本对每次请求报固定的 `inputTokens: 4,000,000`，照 K2M-01 跑到第 6 次请求：它里面 5 个 `read` 都在 | M1（`min`）、M2（不存盘；报 0 不算；不可重试的 `provider_request_failed` 丢 r）。(a)(c)：历史 ≥ 1,024,000 字节，没有 r，按字节 > 979,520，第 4 步从最旧的结果换起，换到装下为止（`context-selection-policy.ts:238-254`）。(a) 第二次请求：r = 1,000 ÷ B′，B′ 是裁后发出的第一次请求，换一个结果省不到 64,027 字节，所以 B′ > 979,520 − 64,027 = 915,493；第二次请求是裁前的第一次加一次 100 字节的读，不到 1,830,000 字节（16 个结果约 1,024,432 字节，平台输入和系统说明另算，远小于 800,000），B ÷ B′ < 2，估算 < 2,200，不裁。(d)：r = 4,000,000 ÷ B₅，B₆ > B₅；不取 `min` 时估算 = ceil(1.1 × 4,000,000 × B₆ ÷ B₅) > 4,400,000 > 983,616，会裁；取 `min` 是 B₆ + 4,096，B₆ 是 5 个结果约 320,135 字节加平台输入，远不到 979,520，不裁（第 2–5 次更小，同理） | (a) r 存盘、启动时读回；(b) 报 0 也算；(c) 错误不丢 r；(d) 去掉 `min` |

**K2-K 各行共用的夹具（手算）**
- Session `s1`。每个脚本 Turn 用一个测试工具 `fixture_read`（`additionalTools`），它直接返回 `[{ kind: 'text', text: <给定正文> }]`。只有 K2K-03 的 `c1f` 例外：`fixture_read` 对它返回 `status: 'error'` 的结果（`error.code` 是 `execution_failed`，`retryable: false`；结果的形状见 `vendor/coding-agent/dist/core/ports/tool_executor/tool-executor-port.js:50-76`），`output` 正文是 2,000 个 ASCII `z`。
- 各记录的位置按脚本 Turn 的事件序列手算（`session.created` 是位置 1）。下文 `T_k` 是第 k 个 Turn 的终止位置，`c`、`A`、`B`、`C` 是压缩记录的位置（= 追加前的尾 + 1）。
- 原 output 的 JSON：`[{"kind":"text","text":"` 是 24 个字符，`"}]` 是 3 个，所以正文 n 个 ASCII 字符时是 n + 27 字节。

**K2-K**

| 行 | 入口 | 行为 | 期望值来源 | 改坏方式 |
|---|---|---|---|---|
| K2K-01 | KE1 | 两个完成的 Turn 之后追加：位置接在尾后，revision 加 1；之前的记录逐条不变（ID、位置、校验和）；读回的载荷和手写的一样；recordId 是 `context-compacted:s1:<T2>` | L3 第 5 行。位置 = `T2 + 1`；revision = 追加前读到的 + 1；载荷 `{ basedOnPosition: T2, outcome: 'compacted', stubs: { throughPosition: T1, readBack: { <T1 的 runId>: 'RB-1' } }, summary: null, failure: null }` | 返回 `basedOnPosition`，而不是新记录的位置 |
| K2K-02 | KE1 | 下列每例都不写：记录条数和 revision 都不变。第 1 行：Session 不存在 → `unreadable`。第 2 行：`expectedRevision` 少 1 → `conflict`，带现在的 revision。第 3 行：(a) T3 还开着 → `not_idle`，reason 是“本轮未结束，未执行”；(b) `basedOnPosition = T1`、尾是 `T2` → `not_idle`；(c) 尾是一条已有的压缩记录 `c`、`basedOnPosition = c` → `not_idle`。第 4 行：(a) `stubs.throughPosition` 是 T2 里一个非终止事件的位置；(b) `readBack` 缺 T2 的 runId；(c) `outcome: 'failed'` 却带 `stubs` → 都是 `invalid` | L3 表；手写的记录序列 | 去掉“尾必须是终止事件”的检查（3(c) 变成 `appended`） |
| K2K-03 | KE2 | 5 个完成的 Turn。T1：调用 `c1`（参数 `{"path":"a.txt"}`，正文 2,000 个 `x`），另有一个失败的调用 `c1f`（`status: 'error'`，正文 2,000 个 `z`，见上）。T2：调用 `c2`（参数 `{"q":"<95 个 a>"}`，正文 2,000 个 `y`），另有一个短结果 `c2s`（正文 `ok`）。T3–T5 各一个调用。压缩记录 `c` 的桩到 `T2`，`readBack` 是 `{ <T1 的 runId>: 'RB-1', <T2 的 runId>: 'RB-2' }`。恢复到 `c`：交给模型的输入里 `c1`、`c2` 的结果是右边的桩；`c1f`、`c2s` 原样；T3–T5 原样；调用和结果成对 | L5、L6。`c1` 的桩：`旧工具结果已清（工具 fixture_read，调用 c1，参数 {"path":"a.txt"}，位置 <c1 的 tool.completed 位置>，原 2027 字节）。要原文：RB-1`。`c2` 的参数 JSON 是 103 个码点，摘要是 `{"q":"` 加 74 个 `a` 再加 `…`；原 2027 字节；要原文：RB-2。`c2s` 原 29 字节，比桩短，不换。`c1f` 原 2027 字节，比桩长，只因不是 success 才不换 | 失败的结果也换 |
| K2K-04 | KE2 | T1–T4 完成；`c` 的摘要到 `T2`，正文 `摘要正文`，不带桩。恢复到 `c`：输入第一条是摘要消息；T1、T2 不在输入里；T3、T4 原样。再用新的 runId `run-new`、T1 的 turnId 开新 Turn，被拒 | L5。第一条：ID `context-summary:s1:<c>`，正文 `以下是本线更早对话的压缩摘要（压缩记录 <c>，覆盖到位置 <T2>）。原记录没有删除。\n\n摘要正文`。拒绝：`conflict`，消息含“历史前缀包含当前 Turn”（`session-history.ts:397`） | 被摘要的 Turn 不进 `turns` |
| K2K-05 | KE2 | 顺序：T1–T4，A（基于 `T4`：摘要到 `T2`，正文 `SA`；桩到 `T3`），T5，B（基于 `T5`：只传桩到 `T4`，摘要传 `null`），T6，C（基于 `T6`：`failed`）。恢复到 C：用 B 的视图；恢复到 `T5`：用 A 的视图；恢复到 `T4`：原样 | L3（摘要带过来）、L5。恢复到 C：第一条 ID `context-summary:s1:<B>`，前言写“压缩记录 <B>，覆盖到位置 <T2>”，正文 `SA`；T3、T4 的结果是桩；T5、T6 原样。恢复到 `T5`：第一条 ID `context-summary:s1:<A>`；T3 是桩；T4、T5 原样 | 恢复时用了 `failed` 的那条（恢复到 C 得到原样） |
| K2K-06 | KE2 | `throughPosition` 是一条压缩记录：接受。是 T3 的 `turn.started`、T3 里一个非终止事件、位置 1（`session.created`）：都拒绝 | L5 的边界；F2。三种拒绝都是 `conflict`（`session-history.ts:315`） | 任何记录都当边界（位置 1 变成 `not_found`，`:386`） |
| K2K-07 | KE2 | 用压缩视图开始的 Turn（`throughPosition = c`）跑到检查点暂停，再用 `resumeCodingAgent` 恢复：交给模型的输入和第一次逐字节相同。下一轮恢复到它的终止，仍是压缩视图 | F2、L5。两次的输入都 = K2K-04 的视图加这一轮的输入；下一轮 = 同样的摘要消息 + T3、T4 + 这一轮 | 只在 `throughPosition` 恰好是压缩记录时才套用 |
| K2K-08 | KE1 | 压缩记录 `c` 前面那个 Turn：`readTurnBounds.endPosition` 是它的终止事件 | L4。`endPosition = T2`，不是 `c = T2 + 1` | `turnRecordRange` 不去掉压缩记录 |
| K2K-09 | KE2（`selectContext`） | 历史里有一条 ID 为 `context-summary:s1:9` 的用户消息、两段历史交换、最新输入。预算刚好装下“系统说明 + 摘要消息 + 最新输入”：两段历史交换都删，摘要消息留着。预算再少 1：报 `required_content_over_budget` | L7。预算 B₁ = 只剩系统说明、摘要消息、最新输入时请求的 UTF-8 字节数 + 4,096 + `maxOutputTokens`（PC-13 的 `bytePreview` 算法）；第二例用 B₁ − 1 | 去掉对 `context-summary:` 的保护 |
| K2K-10 | KE2 | 派生基线：源 `s1` 有 T1–T3，A（基于 `T3`，摘要到 `T2`，正文 `SA`），T4。子 Session `s2` 带 `sourceSessionId: 's1'`：恢复到 `T4`，用 A 的视图；恢复到 `T3`，原样 | L5 最后一条。到 `T4`：第一条 ID `context-summary:s1:<A>`（是源 Session 的 ID），正文 `SA`；然后 T3、T4 原样。到 `T3`：T1–T3 原样 | 派生基线绕开压缩 |
| K2K-11 | KE2 | 摘要调用的历史：保留边界之后有一条旧 `compacted`，每种一例。T1、T2 各一个调用 `c1`、`c2`（参数和正文同 K2K-03），T3 一个短调用。(a) 源 `s1`：T1–T4，A（基于 `T4`：摘要到 `T1`，正文 `SA`；桩到 `T2`，`readBack` 是 `{ <T2 的 runId>: 'RB-2' }`），T5。(b) 源 `s3`：T1–T4，B（基于 `T4`：只有桩，到 `T2`，`readBack` 是 `{ <T1 的 runId>: 'RB-1', <T2 的 runId>: 'RB-2' }`），T5。子 Session（`s2`、`s4`）先建好，再带 `sourceSessionId`、`throughPosition = T3` 开 Turn：给 `viewPosition = T5` 时，(a) 输入第一条是 A 的摘要消息，T1 不在输入里，`c2` 的结果是桩，T3 原样；(b) `c1`、`c2` 的结果是桩，T3 原样。不给 `viewPosition` 时，两例都是 T1–T3 原样 | L5（`viewPosition`）、L6。A、B 都在 `T3` 之后、`T5` 之前。(a) 第一条 ID `context-summary:s1:<A>`，前言写“压缩记录 <A>，覆盖到位置 <T1>”，正文 `SA`；`c2` 的桩同 K2K-03（要原文：RB-2）。(b) `c1`、`c2` 的桩同 K2K-03。两例的输入里都没有 T4、T5（前缀截到 T3） | 选压缩记录仍按 `throughPosition`（给了 `viewPosition` 也得到原样） |

**K2-P1、K2-P2 各行共用的数（手算）**
- 窗口 W = 1,000,000。Host 设置 `compaction` 用默认值，不存（K2P1-01 单测 KE4；裁定二第 8 条）。
- 所以：触发值 0.4 × W = 400,000；目标 0.2 × W = 200,000；换手阈值 `min(500,000, floor(0.8 × 1,000,000))` = 500,000；`tokensPerChar` 0.29。
- **大结果轮**：12 次 `read`，每次读一个单行、60,000 字节的 ASCII 文件（在 64 KiB 的输出上限内）；每个结果的原 output JSON 不少于 60,000 码点。
- **小结果轮**：1 次 `read`，读一个单行、2,000 字节的 ASCII 文件；原 output JSON 不超过 2,600 码点（平台另包一层，F10）。
- 桩的 output JSON（L6 的格式，读回文字是 L13 的那种，测试里的 ID 都短）不超过 600 码点。
- 由此：
  - 一个大结果轮新换掉 ≥ 12 × (60,000 − 600) = 712,800 码点，× 0.29 = 206,712；
  - 两个大结果轮 ≥ 1,425,600 码点，× 0.29 = 413,424；
  - 一个小结果轮新换掉 ≤ 2,600 码点，× 0.29 ≤ 754。
- 脚本模型报的数都是固定的（裁定六第 9 条，理由同 K2-M）：行里写了的照写；没写的每次请求报 `inputTokens: 1,000`（同 K2-M）。1,000 远小于触发值 400,000 和换手阈值 500,000，所以没写数的轮不会触发压缩或换手。
- 前提：每次请求 Kernel 都不裁（挑选报告的 `removed` 全为 0；否则 L11 直接算不够）。
  - Work、秘书、参谋行都走真实 Host 的绑定（上面的共用预算），用 K2-M 的计数器，所以 K2-P1、K2-P2 的行都要组一已落地。Work 行不再用 S3 的固定计数器，下面按 K2-M 的计数器论证（裁定四第 11 条）。逐类算过：
    - 请求不到 979,520 字节时，估算 ≤ B + 4,096 ≤ 983,616，不裁（M1 的 `min`），和 r 是多少无关。只有小结果轮的线、只有一个大结果轮的线（720,000 字节的结果加平台输入，约 0.85 MB）都是这样，Work 各行的请求大多在这里。
    - 超过 979,520 字节的请求：K2P1-11、K2P1-12（两个大结果轮，最大约 1.7 MB），以及 K2P1-13 的 R5 可能到（一个大结果轮之后又有 256 次小交换）。r 来自上一次请求（B′ 是它的字节数）：
      - 上一次在同一轮里：报的是 1,000（没写数的，或 K2P1-13 写的 1,000）。后一次只多一次读（大结果的读不到 65,000 字节），B′ > 979,520 − 65,000 = 914,520，B ÷ B′ < 1.072，估算 ≤ ceil(1,100 × 1.072) = 1,180。
      - 上一次是上一轮的最后一次：K2P1-11、-12 的 Q1–Q4 写的是 100,000。一轮第一次请求只比它多上一轮的回答和这一轮的平台输入；B′ 至少有一个大结果轮，不少于 720,000 字节，按平台输入和回答加起来不到 216,000 字节算，B ÷ B′ < 1.3，估算 ≤ 1.1 × 100,000 × 1.3 = 143,000。K2P1-13 的 R4 最后一次没写数，报 1,000，更小。
      - 比 100,000 大的报数（Q5 的 500,000、R5 的 400,000）只在一轮的最后一次请求上，下一次请求是压缩过的下一轮，不到 979,520 字节，走 `min`。
      - 所以估算都 ≤ 143,000 < 983,616，不裁。
    - 重建 Host 以后的第一次请求还没有 r，按字节计（M2）。K2P1-07 各例重建后的第一次请求都是压缩后的视图，不到 979,520 字节。
    - K2P2-02 (d) 是故意让 Kernel 裁的，不在此列。
    - 施工时如果平台输入大到让这些界线不成立，按比例缩小结果，由 lead 重算这些数。
- 读回文字：Work 轮 `look_graph {"mode":"history","runRef":{"aggregateType":"Run","goalId":"<g>","projectId":"<p>","runId":"<r>"}}`；Query 轮 `原文在本线的会话历史里，本线现在没有读回入口`（L13）。

**K2-P1**

| 行 | 入口 | 行为 | 期望值来源 | 改坏方式 |
|---|---|---|---|---|
| K2P1-01 | KE4 | 默认值是 0.4、0.2、3、0.29、8192；存一张合法的表后，读出的 `saved`、`effective` 就是它；形状不对的拒绝（比例是 0 或 1、`keepRecentTurns` 是 0 或 2.5、`tokensPerChar` 是 0、`summaryMaxTokens` 是 0）；存 `null` 回到默认 | L9。默认值和裁定 1 的参数段一样 | 存 `null` 时不删存的值 |
| K2P1-02 | KE3 | 执行者线 R1 是大结果轮，R2–R5 是小结果轮；R5 最后一次请求报 400,000。R6 开始前多一条 `context_compacted`（`outcome: compacted`，只有桩，桩到 R2 的终止）；R6 的模型输入里，R1 的 12 个结果和 R2 的 1 个结果是桩，桩里的读回文字是它们的 `RunRef`；R3–R5 原样；Session、线、负责关系都不变；`nativeCompact` 报支持 | L10–L13。400,000 ≥ 400,000；5 > 3；保留 R3–R5，桩到 R2；估算 ≤ 400,000 − 206,712 = 193,288 ≤ 200,000，够。R1 第一个结果的桩：`旧工具结果已清（工具 read，调用 <callId>，参数 <参数 JSON 前 80 码点>，位置 <p>，原 <N> 字节）。要原文：look_graph {"mode":"history","runRef":{"aggregateType":"Run","goalId":"<g>","projectId":"<p>","runId":"<R1>"}}` | 读回文字用 Kernel runId，不是 `RunRef` |
| K2P1-03 | KE3 | 下面每种一例，都不写记录，输入和今天一样：(a) 只有 3 个完成的 Run，上一轮报 400,000；(b) 5 个完成的 Run，上一轮报 399,999；(c) 上一轮没报 `inputTokens`；(d) 接续的第一个 Run，源 Session 有 5 个完成的 Run、最后报 400,000（源 Session 也没有新记录）；(e) `current_turn` 的第一轮；(f) K 片关闭后游标后面是被中断的 Turn，5 个完成的 Run、上一轮报 400,000 | L10 第 2、4 条；L12 的入口条件和“别的情况” | 种子轮也进 L10，把种子源的上一轮当上一轮（(d) 写出记录） |
| K2P1-04 | KE3 | （K2-P2 落地时删去，§3）秘书线 Q1–Q5 都是小结果轮；Q5 最后一次请求报 400,000；第一步不够：Q6 开始前写 `failed`（`summary_unsupported`），Q6 照常跑、视图不变。Q6 结束时：(a) 最后一次请求报 500,000 → 开始换手；(b) 报 499,999 → 不换手 | L11、L16。保留 Q3–Q5，桩到 Q2；新换掉 ≤ 2 × 754 = 1,508；估算 ≥ 400,000 − 1,508 = 398,492 > 200,000，不够。(a) Q6 的 `turn.started` 里 `contextBasis.throughPosition` 指的是那条 `failed`（L16）→ `compactionDefers` 假 → 500,000 ≥ 500,000 换手；(b) 没到阈值 | 失败时仍套用桩 |
| K2P1-05 | KE3 | 秘书一轮结束、最后一次请求报 500,000，每种一例：(a) Kernel 不支持（M2 的开关）→ 换手；(b) Q1 是大结果轮、Q2–Q5 是小结果轮，Q5 最后一次请求报 400,000，Q6 开始时压成 `compacted`（数同 K2P1-02），Q6 结束 → 换手（防抖）；(c) Q3 结束（只有 3 个完成的轮）→ 换手 | L16。(a) 第 1 条不成立；(b) Q6 用压缩后的历史开始且到了 500,000，第 3 条不成立；(c) 3 不多于 3，第 4 条不成立 | 判换手时不看这一轮开始时用的历史（(b) 不换手） |
| K2P1-06 | KE3 | 执行者线，按 K2P1-02 在 R6 开始时压成 `compacted`。(a) R6 结束报 500,000 → R7 开始时不写记录，也不换手；(b) 另一例：R6 结束报 300,000（R7 开始时不压），R7 结束报 500,000 → R8 开始时不写记录，也不换手 | L10 第 3 条、L16 的防抖。(b) 300,000 < 400,000，R7 开始不压。(a)(b) 中上一轮的 `throughPosition` 及以前都有那条 `compacted`，且到了换手阈值 500,000 | 只认 `turn.started` 紧挨在压缩记录后面的那一轮（(b) 写出记录） |
| K2P1-07 | KE3 | 故障，每种一例，都按 K2P1-02 的数：(a) 追加已提交、`turn.started` 还没写时崩溃：启动核对判 W-05（Query 判 Q-02）；下一次开始复用这一条，全程只有一条，`throughPosition` 就是它。(b) 在存储边界的包装上：平台为这次开始探测 revision 的那次读头返回之后、`appendCompactionRecord` 自己读头（L3 第 1、2 行）之前，提交一次同 recordId、同内容的压缩记录：这一轮开始返回可重试的 `unavailable`，这次没有再写；重建 Host，启动核对判 W-05，重新授权后再开始，复用那一条，全程只有一条。(c) 压缩后的一轮跑完，重建 Host，下一轮仍是压缩视图。(d) R6 用压缩视图开始，跑到安全点被人暂停，再由同一个 Host 恢复：Kernel 接受重新进入，模型输入和第一次逐字节相同，全程只有一条 | L3（`conflict`）、L12（复用、冲突、恢复）、L15。(d) 恢复时的 `throughPosition` 等于那条压缩记录的位置（F2 的身份核对） | 复用只认“游标后只有这一条记录”（(d) 被 Kernel 以 `idempotency_conflict` 拒绝） |
| K2P1-09 | KE3 | （K2-P2 落地时跟着改，§3）`sessions/history` 列出 `context_compacted` 的两种结果（K2P1-02 的 `compacted`、K2P1-10 的 `failed`）；原记录的 ID、位置和压缩前逐条相同，只多出压缩记录；用 `executions/history` 和 `look_graph` `history` 读 R1，拿到原结果全文 | L14。R1 的每个结果正文是那 12 个 60,000 字节文件的原文 | 历史读取套用了压缩 |
| K2P1-10 | KE3 | （K2-P2 落地时改，§3）第二次压缩、新换掉的不够：按 K2P1-02 在 R6 开始时压成 `compacted`（桩到 R2）；R6 是小结果轮，结束报 400,000。R7 开始时写 `failed`（`summary_unsupported`）；R7 的视图仍是 R6 的那个（R1、R2 是桩，R3 原样） | L11。保留 R4–R6，桩到 R3 的终止；新换掉的只有 R3：≤ 754，估算 ≥ 400,000 − 754 = 399,246 > 200,000，不够 | 估算把以前已换过的结果也按原大小算（估算 ≤ 193,288，变成 `compacted`） |
| K2P1-11 | KE3 | 等着压缩的秘书线照样被选中：Q1、Q2 是大结果轮，Q3–Q5 是小结果轮；Q1–Q4 最后一次请求报 100,000，Q5 报 500,000。Q5 结束：不换手。下一个请求来了：挑秘书选中这条线；Q6 开始前写 `compacted`（桩到 Q2） | L16、F11。Q5 结束时：没用压缩历史开始、5 > 3、500,000 ≥ 400,000 → 下一轮会压 → `compactionDefers` 真 → 不算太长。Q6：估算 ≤ 500,000 − 413,424 = 86,576 ≤ 200,000，够 | 挑秘书仍按到没到阈值滤（Q6 不在这条线上，或新建了秘书） |
| K2P1-12 | KE3 | 7D2 的角色线维护，参谋线（`intervention_planning` 轮）：(a) 同 K2P1-11 的数，最近一轮报 500,000、下一轮会压 → 维护不换手；下一条消息的那一轮开始前写 `compacted`。(b) 那一轮用压缩后的历史开始、结束报 500,000 → 维护换手 | L16、F12 | 角色线维护不看 `compactionDefers`（(a) 换手） |
| K2P1-13 | KE3 | 执行者线 R1 是大结果轮、R2–R5 是小结果轮；R5 有 257 次模型请求，前 256 次报 1,000，最后一次报 400,000。R6 开始前写 `compacted`（同 K2P1-02） | L10（Work 读 Kernel 记录）。`RunActivity` 只留前 256 次（`run-activity-tally.ts:302`），从那里读到的是 1,000 | 从 `RunActivity` 读（R6 开始不写记录） |

- K2P1-08 删去（裁定六第 12 条），行号不重排。照它的改坏（`decodeKernelEntry` 不认 `context.compacted`），它声称的断言都还是绿的：在跑的 Run 的窗口在结构上不含压缩记录（L15：核对和观察都从 `startPosition − 1` 之后读）。另两种情形别的行已走到：Query 观察窗口含压缩记录，K2P1-04(a)、K2P2-02(a) 的 Q6 结束；`decodeKernelEntry` 遇到压缩记录，K2P1-07(a)。

**K2-P2**

| 行 | 入口 | 行为 | 期望值来源 | 改坏方式 |
|---|---|---|---|---|
| K2P2-01 | KE5 | 按 K2P1-04 的数（第一步不够）→ Q6 开始前做摘要调用：脚本模型收到的摘要请求，系统说明和工具定义与 Q5 最后一次请求逐字节相同，历史到 Q2 的终止为止，最后一条用户消息逐字等于 L18 写的 `context-summary-request` 第一稿正文（裁定六第 7 条）；它发出的一个工具调用被拦下；脚本给的摘要含六个标题，最后一次请求报 `outputTokens: 8192`。之后：写 `compacted`（桩和摘要都到 Q2 的终止）；Q6 的输入 = 摘要消息 + Q3–Q5 原样 + Q6；这条线的 Kernel Session 里没有多出 Turn；Q6 的请求记录（`readQueryExecution`，`create-platform.ts:3489-3491`）里有摘要调用的请求 | L18–L20。保留边界 = Q2 的终止（Q3–Q5 是最近 3 轮）；拦工具的理由 `摘要调用不执行工具`；8,192 不超过 8,192；摘要消息正文按 L5 的前言加脚本给的正文 | 摘要调用写进了线的 Session（Q6 的历史里多一轮） |
| K2P2-02 | KE5 | 失败，每种一例，都写 `failed`、视图不变，Q6 结束时秘书换手（(a)–(c) 报 500,000，(d) 报 2,000,000）：(a) 摘要调用报错 → `summary_call_failed`；(b) 摘要缺第 2 段 → `section_missing:2`；(c) 最后一次请求报 `outputTokens: 8193` → `over_cap`；(d) 摘要调用被 Kernel 裁过 → `summary_trimmed`。(d) 的线：Q1、Q2 各有一次回复是 600,000 字节的 ASCII 文字加一个 `read` 调用（读 100 字节的文件），之后简短回答；Q3–Q5 是小结果轮。(d) 的报数（裁定六第 9 条）：Q1–Q4 每轮最后一次请求报 100,000，别的照共用的 1,000；从 Q5 的第一次请求起，每次报 2,000,000 | L19、L16。(a)–(c) 按 K2P1-04 的数；(c) 8,193 > 8,192。(d) 逐轮算：① Q1–Q4 结束报 100,000，< 400,000 不压，< 500,000 不换手。② Q1–Q4 和 Q5 第一次请求都不被裁：不到 979,520 字节的走 `min`；超过的，同一轮上一次报 1,000 时，后一次最多多出一段 600,000 字节的文字加一次读（不到 601,000 字节），上一次至少 979,520 − 601,000 = 378,520 字节，B ÷ B′ < 1 + 601,000 ÷ 378,520 < 2.59，估算 ≤ ceil(1,100 × 2.59) = 2,849；上一次是上一轮最后一次（报 100,000）时，同共用数里的算法，估算 ≤ 143,000。③ Q5 起的请求都不到 2,000,000 字节（两段 600,000 加小轮和平台输入），所以 r = 2,000,000 ÷ B′ ≥ 1，K2-M 取 B + 4,096。Q5 最后一次请求 ≥ 1,200,000 字节，B + 4,096 > 983,616，被裁：带调用的那次回复连同结果是第 5 步的一个单位，第 4 步缩不了它的文字，删到第 5 步（`context-selection-policy.ts:268-286`）。④ Q5 结束报 2,000,000 ≥ 500,000，但 `compactionDefers` 真（支持；2,000,000 ≥ 400,000；没压过；5 > 3；Q5 开始时用的是游标，不是 `failed`），不换手。⑤ Q6 开始：上一轮最后一次请求被裁过，L11 算不够 → 摘要调用。保留 Q3–Q5，边界是 Q2 的终止，摘要调用的历史是 Q1、Q2 原样，≥ 1,200,000 字节；r 来自 Q5 最后一次（≥ 1），估算 = B + 4,096 > 983,616，Kernel 删到第 5 步，`historyExchange` ≥ 1 → `summary_trimmed`。⑥ Q6 视图不变，结束报 2,000,000 ≥ 500,000；Q6 开始时用的是那条 `failed`（L16）→ `compactionDefers` 假 → 换手 | 缺段时仍写 `compacted` |
| K2P2-03 | KE5 | 第二次压缩：K2P2-01 之后 Q6 是小结果轮，结束报 400,000；Q7 开始时摘要调用的历史第一条是旧摘要消息，接着是 Q3；新记录的摘要到 Q3 的终止；Q7 的输入里只有新摘要这一条摘要消息 | L18（裁定 9）、L5。新换掉的只有 Q3，≤ 754，不够。旧摘要消息的 ID 是 `context-summary:<sid>:<旧记录位置>`；Q7 第一条的 ID 换成新记录的位置 | 摘要调用从原记录重建（看不到旧摘要） |
| K2P2-04 | KE5 | 来源核对：工作区是 git 仓库（`tests/scenarios/support/git-workspace.ts`）。脚本摘要的 `## 来源` 段有六行：`- 文件 a.txt`（在）、`- 文件 gone.txt`（不在）、`- 文件 a.txt 提交 <HEAD 的 40 位>`（在）、`- 消息 <一条在的消息 ID>`、`- 检查 <g>/<t>/<r>/nope`（不在）、`- 见上一轮的讨论`（不合格式）。写进记录的摘要里，第 2、5、6 行末尾多 `（来源不可用）`，其余逐字不变；压缩照样 `compacted` | L19a；DESIGN:1032、1053 | 坏链接算成失败；或不核、原样照抄 |
| K2P2-05 | KE5 | Work 线的摘要调用拿到许可，用量记在本轮（裁定五第 2 条，裁定六第 10 条）：按 K2P1-10 的数。这一行的 Work 预算用现成的 `workBudget` 另把 `outputTokens` 设成 8,193（共用预算表的例外）；除摘要那次以外，每次请求报 `outputTokens: 1`。R7 开始时第一步不够，做摘要调用：它只发一次请求，脚本给的摘要含六个标题（同 K2P2-01），报 `outputTokens: 8,192`。之后：写 `compacted`（桩和摘要都到 R3 的终止）；R7 的输入 = 摘要消息 + R4–R6 原样 + R7；R7 只发一次请求就回答。R7 这个 Run 的请求记录（`readPromptRecord`，`src/core/agent-runtime/ports.ts:93`）有两条：第一条是摘要调用的请求（`requestId` 就是脚本模型收到的、最后一条用户消息是摘要提示的那次），第二条是 R7 的那次请求，它的 `maxOutputTokens === 1` | L18（Work 的两处改动、用量记在这一轮的计量上）、L19、L20。保留边界 = R3 的终止（R4–R6 是最近 3 轮）。摘要调用在 R7 的 Kernel Turn 之前，它的许可排第一（`model-call-service.ts:211-216`）。输出上限按这个计量剩下的算（`model-budget.ts:108`），请求记录的 `maxOutputTokens` 就是它（`observed-model-run.ts:343`、`runtime.ts:762-763`）：摘要那次 = min(16,384, 16,384, 8,193 − 0) = 8,193，报 8,192（不超 `summaryMaxTokens` 8,192，不是 `over_cap`）；R7 那次 = min(16,384, 16,384, 8,193 − 8,192) = 1。摘要若另用一个计量，R7 那次会是 8,193。R1–R6 每个 Run 的计量各自从零算（`execution-driver.ts:948`），每次只报 1，碰不到 8,193 | 准入退回只收 `entered`（摘要调用的许可被拒成 `busy`，按 L19 不写记录，R7 的视图仍是 R6 的） |

## 5. 不做的事

**不做：**
- 删除或改写原记录；
- `look_graph` 按 Kernel 位置查找；
- 清旧工具调用的参数（裁定 7）；
- 第一步动每轮的平台输入（裁定 6）；
- “至少省多少才压”的门槛（裁定 8）；
- 执行者线、审阅者线的自动换手（裁定 5）；
- 在一轮结束时压，或新加 Session 状态（裁定 2）；
- 隐藏的线内 Turn（裁定 3）；
- 摘要调用建平台 Session（裁定二第 9 条）；
- 给临时 Session 加 `already_exists` 的恢复；让 Kernel 在 `session_history` 分支自动建 Session（裁定四第 1 条）；
- 给摘要调用加“摘要调用”标记、单开一条准入、另建一份 manifest，或放宽准入的摘要比对（裁定四第 6、14 条）；
- 按 Kernel runId 的索引、“上一次执行”字段、改领取时写 `lastExecutionRef` 的规矩、找不到上一轮时的专门错误码（裁定四第 5 条）；
- `viewPosition` 以外的新派生模式或 mode 值；升 `contextBasis.version`；改种子、接续、审阅的规则（裁定四第 7 条）；
- 开始时冲突的进程内撤销（裁定二第 3 条）；
- 执行者线失败或防抖以后存“以后都不压”的状态（裁定二第 13 条）；
- 改换手阈值的数；
- 装分词器；把 K2-M 的观察存盘；把 10% 余量做成设置（用户答复；裁定三第 4 条）；
- 承诺缓存命中（裁定 13）；
- 界面（E3）；
- 调用真实模型的测试。

**平台造不出来的情况：不加守卫，也不加测试（清单 B）。**
- **一轮还在跑时平台来压。** L12 只在下一轮领取 Session 之后、开始时写。Kernel 的拒绝（L2、L3 第 3 行）是公开函数本身的规则，只在 KE1 测。
- **压缩记录跟在一个还没入账的 Run 后面。** 领取要等上一轮释放，而释放在入账之后（F7）。所以 F8 的四处不加检查（L15）。
- **同一个终止位置上有两条压缩记录。** L12 先读尾部；L3 第 3 行要求 base 就是尾，尾是压缩记录时拒绝（K2K-02 的 3(c)）。不另加去重。
- **种子的源 Session 被写进压缩记录。** L12 的入口条件不让种子轮判断，所以种子扫描不加检查。
- **版本 3 的 Kernel 读到版本 4 的记录。** `dist` 一起重新生成，不会混用，不做兼容，平台也不看版本号判支持（L8）。
- **`failed` 记录后面紧跟另一条压缩记录。** 下一次压缩只在下一轮开始时发生，中间必有一个 `turn.started` 和它的终止。
- **一轮开始到一半时设置被改。** 每次开始只读一次设置。
- **`summary.throughPosition` 大于 `stubs.throughPosition`。** 平台不这样传（L11、L20 让桩不早于摘要），Kernel 不另查；真传了，桩的范围就是空的。
- **`viewPosition` 选到的旧摘要盖过了新保留边界。** L10 第 4 条要求旧摘要之后多于 `keepRecentTurns` 轮，所以旧摘要的范围一定在新边界之前；旧桩超过截断点的部分随前缀自然落掉。Kernel 不核 `viewPosition` 和 `throughPosition` 的大小，也不核旧摘要的范围（裁定四第 7 条）。
- **K2-M 的 r 来自另一个模型。** 一个绑定一个计数器，一个绑定只有一个模型（`runtime-configuration.ts:503-512`）。两个 Run 同时用同一个计数器，只是后报的覆盖先报的，仍是同一个模型的比例，不加锁。

**走公开入口造不出来、由代码审查核对的：**
- L12 入口条件里“准备时没有游标、开始时有游标”的 `current_turn` 竞态。追查说它可能发生，但冒烟里没走到，场景框架也没有办法在准备和开始之间插进一轮。

## 6. 留给 lead 的问题

没有了。
- 第三稿 §6 的四条已由裁定三定下：Work 读 Kernel 的 `model.usage_recorded`，K2P1-13 留（第 1 条）；接受临时 Session 的记录（第 2 条）；单独的提交不当来源（第 3 条）；K2-M 照第三稿，和 K2-K 同组（第 4 条）。7D2 的 `roleLineInputBasis` 的 256 问题记进 7D2 收尾清单，K2 不替 7D2 改（第 1 条）。
- 第四稿 §6 第 1 条（Work 的摘要调用怎么发许可）已由裁定五定下：选 (A)，写在 L18（第 1 条）；(B) 不选，不进规格（第 7 条）。两条路的追查留在 `impl/k2/k2-v4-reply.md` 第三节。
- 第四稿“另请 lead 看”的那一处（没有一行能证明 Work 的摘要调用拿到了许可），裁定五第 2 条补了 K2P2-05。

## 7. 要改的文档（裁定二第 17 条，K2 冻结时 lead 一起改）

- DESIGN.md:1019-1020（F3、F4）。:1020 的“所以很少丢到对话”今天不对；K2-M 以后才对，改写时写进 K2-M 的计量。
- DESIGN.md:1010 的“在一轮结束后”，按裁定 2 改成“下一轮开始前”。
- DESIGN.md:1012 和 MVP 行为第 23 行的“秘书太长就换手”，今天其实够不着（F5），K2-M 以后够得着。DESIGN:1012 里写的“MVP 行为第 22 行”也已错位，现在是第 23 行。
- DESIGN.md:1220 把“什么时候压缩”归 Workflow、:1305 写“Workflow 在两轮之间按输入量触发”：本规格把纯判断放在 `work-graph/tasks`，由 AgentRuntime 在开始时调（L10）。
- DESIGN.md:1654 写“项目设置：独立的压缩条件”：按裁定是 Host 设置（L9）。
- DESIGN.md:86 和 §4.11 里换手只给秘书：7D2 以后参谋、书记也有（F12），压缩和它们的先后按 L16。
- HANDOFF：记下对决定 49 第 27 项“提交来源”的收窄，只收“文件在某个提交里的版本”（裁定三第 3 条，裁定四第 13 条；L19a）。
- 第 9 片起始裁定的修订记录：§3 末尾那条补充，是对第 9 片冻结开工裁定 G6 的修订（压缩场景用自己的 Host 和 ledger，不再“场景结束后存 `null`”；裁定四第 15 条）。
- `docs/refactor/STATE-MACHINES-SPEC.md:4315`（W-05）加注（裁定五第 1 条）：依据栏的“Kernel 先写 Turn 再执行”，对 Work 的摘要调用不再成立。它在线的 Turn 之前就调模型，所以“没有 Turn”不等于“没调过模型”。判定和结算不变，代价照 L18 写：
  - 多一次摘要调用；
  - 丢掉的那次调用，请求在这个 Run 的请求记录里，token 数没记进平台，也不算进重来以后的累计上限。

---

## lead 审阅备忘（第四稿，含裁定五、六）

下面的行号都是本稿现在的行号。裁定五、六直接改在第四稿里，所以前面各份裁定的行号也按改完以后的写。

**照裁定六改的（12 条，逐条）。**
1. **`viewPosition` 的入口透传（K2R2-a-01）。** L5 :358：`resolveSessionContextMode`（`composition-root.ts:135` 调，`:535` 定义，`:554-559` 重建返回对象）在 `session_history` 的返回对象里带上 `viewPosition`，入参有才带，不加校验。K2K-11 :872 照用。
2. **“以压缩失败开始”的判断（K2R2-b-01 = CR-02）。**
   - L16 :530：改成看这一轮 `turn.started` 记下的 `contextBasis.throughPosition` 指的那条，不看物理上的前一条。:535 的措辞跟着改。
   - 跟着改的地方：§3 :722 里 `compaction-facts.ts` 读的东西；K2P1-04 :905 的期望值。
3. **摘要调用的许可被拒成 `busy`（CR-01）。**
   - L19 :641：不写记录，这一轮不压，照今天开始。signal 中止不另写。
   - K2P2-05 :925 的改坏列跟着改。
4. **游标之后那一次读失败（CR-03）。** L12 :485：返回可重试的 `unavailable`，什么都不写。L10、L11 的读不补。
5. **Runtime 的依赖（CS-01，含 CS-07）。**
   - K2-P1 的文件清单 :723 加 `execution-contracts.ts`：一个可选键，带设置读取和 L10 的两个索引读；L16 端口不放进去。
   - 共用文件表 :745 加一行；:744 的 7D2 栏改成 A1b → O2。
6. **设置快照的旧测试（CS-02）。** K2-P1 的“要改的旧测试” :732-734：`A2-settings-automation.test.ts:69-73`、`:151-154`，写了改前、改后，D 照 L9 写全。
7. **摘要提示从哪取、是什么（CS-03 + T-07）。**
   - L18 :550-581：
     - 模板 id `context-summary-request`，文件 `templates/context-summary-request.txt`，version 1，`mentionsTools: []`，没有槽位（:551）；
     - grep 过不重名（:552）；
     - 从本轮冻结的提示词渲染，进 `DELIVERY_SET_TEMPLATE_IDS`（:553）；
     - 第一稿正文照 L19 的六段写（:554-581）。
   - §3 :760、:761：K2-P2 加 `prompt-set-texts.ts`。
   - :776：`PACK.origins` 改后的那一行。
   - :777：`S7B-preparation-freeze.test.ts:24-27`（`:71`、`:113` 跟着）。
   - :778：helper 里另一份手抄（见下面“裁定和代码对不上的”）。
   - K2P2-01 :921 按这段字面断言。
8. **摘要调用的执行身份（CS-04）。** L18 :595：不传 `executionIdentity`，runId、turnId 由 Kernel 生成。
9. **报数改成固定的数（T-05 + K2R2-b-02 + T-01）。**
   - K2-M 共用数 :840-842：没写的报 1,000，r = 1,000 ÷ B′，B ÷ B′ ≤ 894 时不裁。
   - K2M-01 :850、K2M-02 :851 的 (a)(d) 重算；(d) 改成每次报 4,000,000。
   - K2-P1/P2 共用数 :884、“前提” :885-895 重算。
   - K2P2-02 :922 的 (d) 改报数，按 ①–⑥ 逐轮写全。
   - 别的行重算后不变，见回复第七节。
10. **K2P2-05 证明用量记在本轮（K2R2-b-03 = K2R2-c-02）。**
    - 在代码上核过：输出上限确实按这个计量剩下的算（`model-budget.ts:108`），请求记录的 `maxOutputTokens` 就是它（`observed-model-run.ts:343`、`runtime.ts:762-763`）。所以写的是 b-03 的做法，没写 c-02 的。
    - K2P2-05 :925：`outputTokens` 8,193，摘要报 8,192，R7 那次的 `maxOutputTokens === 1`。
    - 预算表 :823 注明这一行例外。
11. **共用测试世界开 Host 设置（K2R2-c-01）。**
    - 预算表 :825 加 Work Run 上限 400,000,000。
    - :827：经 `extraHostOptions.settings.settingsDirectory` 启用设置，启动 grant 照旧保留，不改 helper。
12. **删 K2P1-08（T-02）。** 行删去，:915 写了理由，行号不重排。

驳回的 9 条（CS-05、CS-06、CS-07 只改措辞、CS-08、T-03、T-04、T-06、T-08、T-09）没动。

**照裁定五改的（逐条）。**
1. 选 (A)，写清代价：头部 :21、§0 :48；L18 :607、:609-623（丢掉的那次调用 :616-620，W-05 的依据 :621，W-11 :623）；§3 :762；§6 :970；§7 :983-985。
2. 补一行测试：K2P2-05 :925；§6 :971。
3. 模板文件：L18 :550-553；§3 :760、:771、:773、:776。
4. 参谋行的世界：§4 :833。
5. README：不改（§3 :687）。
6. 五处对不上的：:677 在 §3 :757；`:861` 在 F16 :239、L18 :611；伪代码注释 :452-453，:457 写不加 helper；QueryRun 字段 F14 :224；L5 :357。
7. (B) 不进规格：§6 :966-971。

**照裁定四改的（逐条）。**
1. 临时 Session 先建再调：F2 :90；F16 :235；L18 :583-598（伪代码 :585-593，不加 `already_exists` 的恢复 :596）；§5 :939。
2. c1f：共用夹具 :854；K2K-03 :864。
3. F6：:133、:134。
4. 4xx：F13 :202；M4 :286；M2（:261）没改。
5. 上一轮怎么找：F14 :220-224；L10 :440、:447-460、:463；L12 :486；L13 :503；L16 :529；依据 :431、:501；§5 :941。
6. 两个绑定摘要：F16 :237；L18 :599-604；§5 :940。
7. `viewPosition`：F2 :91；L5 :350、:352、:353-361、:377-378；L7 :396；L18 :549、:591；§3 :702、:715；K2K-11 :872；§5 :942、:960。
8. K2P1-07(b)：:908。
9. P1 旧行：§3 :779-785；K2P1-04 :905、-09 :909、-10 :910。
10. 串行块和 README：总顺序 :682；README :687；复核清单 :688；串行块 :765-773；旧测试 :776。
11. 共用预算：§4 :815-835；K2-M 共用数 :838；“前提” :885-895；K2P1-13 :913；不改 helper 的理由 :834。
12. 三组：头部 :15-19；§3 :676-679，各组标签 :690、:700、:720、:759。
13. HANDOFF 收窄：§7 :981；L19a :663。
14. Work 的许可：F16 :239-241；L18 :605-623；§3 :762-763；头部 :21；§0 :48。
15. G6：§3 :757、:787-793；§7 :982；§0 :63。

**裁定三怎么并进来的。** 第 1 条 F14 :219、L10 :461-463、K2P1-13 :913；第 2 条 F16 :236、L18 :598、:608、§3 :769；第 3 条 F15 :229、L19a :663、§7 :981；第 4 条 §0 :62、§3 :677、:698、§5 :946；第 5 条 F16 :239、:240；第 6 条 头部 :15、§3 :676；第三稿 §6 的交代 :969。

**还没定下的。** 没有。§3 :778 那一条 lead 冻结时定了（裁定七第 2 条，写在 :778）。

**裁定和代码对不上的（照报，没有悄悄偏离）。**
- 裁定五第 3 条说 `slot-tables.ts`“模板没有槽位就不加条目”。代码要求每个模板都登记（`resolve-pack.ts:246-247`），没有槽位的登记成 `{}`（`slot-tables.ts:162` 等）。本稿写成加一条 `{}`（§3 :773）。
- 裁定六第 7 条只点名了 `S7B-preparation-freeze.test.ts:24-27`。投递集合在 `tests/helpers/S7B-delivery-samples.ts:12-20` 还有一份手抄（连同 `DELIVERY_SET_TEXTS`），五个测试文件拿它比冻结的模板。加了 id 它们会一起红。本稿在 §3 :778 列出；lead 冻结时定：改，改前、改后写在 :778（裁定七第 2 条）。
- 裁定六第 7 条举例的 id 是 `context-summary`。本稿用 `context-summary-request`：`context-summary` 在代码里没有重名，但 L5 已经把 `context-summary:` 用作摘要消息的 ID 前缀，分开好认（L18 :552）。lead 收下（裁定七第 1 条）。
