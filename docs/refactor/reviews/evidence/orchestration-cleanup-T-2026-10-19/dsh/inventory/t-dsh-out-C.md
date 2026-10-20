# T 轮 C 区盘点（116 个测试文件，33,888 行）

只读盘点。范围是 `.dsh-ref/t-area-C.txt` 的 116 个文件（`tests/kernel` 15 个、`tests/runtime` 101 个），按 `t-common.md` 的六类找：过时、重复、琐碎、手写事实、只为篡改、辅助。没有运行测试、构建、类型检查或 git 写操作。

总体判断：这批测试大多以冻结规格行命名，文件头和注释经常主动说明“为什么这条纯函数测试不是重复”“真实路径造不出这个组合”，整体质量比预期高。可动的集中在三处：**旧格式/旧兼容夹具**（R4a、S1 旧 manifest、R4b 旧 Kernel locator 与 raw history）、**只有改 SQLite 才能触发的防御测试**（R4b/R4c 共 6 条）、**手写快照或 manifest 再喂给生产读取器/服务**（A2、R4c、S3、S5、source-binding 等 6 条）。重复大多是“片验收测试”和“规格行测试”各测一遍，按规则只记 keep-note，不删。

## 发现

| 编号 | 类别 | 位置 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---|---|
| C-01 | helper | `tests/kernel/R4a-legacy-fixtures.ts:1-214`（`buildRawTurn` :108-181，`rawInsertRecords` :183-210） | 文件头 :1-4 自述 “Test-only legacy writer … raw SQLite writes intentionally bypass the new writer”；:178-182 说明按「旧二进制」直写以验证新读取器的向后兼容；:190-207 直接 `INSERT INTO session_records`。全树导入方只有 `tests/kernel/R4a-frozen-public.test.ts:17-19`、`tests/runtime/R4b-session-input-boundaries.test.ts:6`、`tests/runtime/R4b-session-recovery.test.ts:8`。HANDOFF:565-570（79-1）把旧格式夹具列为删除候选。 | delete | 行为已不存在：79-1（旧格式夹具）；同批先做 C-02/C-03/C-10/C-11 | 214 | false | 中 |
| C-02 | stale | `tests/kernel/R4a-frozen-public.test.ts:423-442`（`reads a legacy schemaVersion=1 Turn without new constraint fields or rewriting its checksum`） | :428-429 用 `buildRawTurn`/`rawInsertRecords` 造一个缺 `recoveryConstraints`、无 `contextBasis` 的旧 Turn；:431-434 断言这两个字段不存在；:436-439 要求 recovery 照常 `terminal`。当前写入方无条件写 `recoveryConstraints`（`vendor/coding-agent/dist/app/composition/composition-root.js:259-271`），79-2（HANDOFF:571-580）要求删掉只为读之前格式写的分支。当前格式“recovery 不重写记录”由同文件 :245-284、:396-422 覆盖。 | delete | 行为已不存在：79-1 + 79-2（schemaVersion=1 旧 Turn 容忍） | 20 | false | 中 |
| C-03 | tamper | `tests/kernel/R4a-frozen-public.test.ts:627-653`（`still accepts a legacy checkpoint without recovery constraints`） | :634-644 用 `new DatabaseSync` 直接 `UPDATE checkpoints SET checkpoint_json=?`，删掉 `recoveryConstraints` 再用测试自带 `checksum` 重算；:646-651 要求 `RecoveryCoordinator` 仍采用该 checkpoint。当前写入方每次都写 constraints（`composition-root.js:259-271`），正常公开步骤造不出这个状态；只有改库能触发旧 checkpoint 兼容分支。AGENTS 第 4 条 + 79-1。 | delete | 行为已不存在：79-1（旧 checkpoint 兼容分支）+ AGENTS 第 4 条 | 27 | false | 中 |
| C-04 | duplicate | `tests/kernel/R4a-frozen-public.test.ts:382-422` 对 :152-244（三条：`stable identity replay selects the middle completed Run…`、`a paused Turn cannot resume with a larger model budget after restart`、`a paused Turn does not lose an explicit denied prefix…`） | 三对同场景同断言：身份重放 :382-395 对 :152-177（runId/turnId/transcript 相等、请求数不变、记录不变）；预算拒绝 :396-405 对 :192-212（`limits(1)` 暂停后 `limits(4)` resume 得 `conflict`、0 次模型调用）；省略 deniedPrefix :406-422 对 :213-244（只允许拒绝或沿用原约束，不得泄漏私有内容）。前者是更完整的独立验收流，后者迁自另一份 vendor review；`tests/kernel/README.md:10-11` 说明两组来源不同。 | merge-into:`tests/kernel/R4a-frozen-public.test.ts::independent R4a execution identity and paused recovery` | `tests/kernel/R4a-frozen-public.test.ts::replays the requested old identity after a newer completed Turn`（:152）/ `rejects a paused recovery that raises the persisted model-request budget`（:192）/ `does not expose a previously denied path…`（:213） | 41 | false | 中 |
| C-05 | duplicate | `tests/kernel/RL-12-15-conditions.test.ts:165-320`（RL-14 的 KB-01、KB-03、KB-04、KB-05）对 `tests/kernel/K-readonly-sandbox.test.ts:207-416` | 四条只读沙箱行为逐句相同：KB-01 的七条写尝试与 sentinel :165-200 对 K:207-240；KB-03 的本地端口 blocked(exit 4)/git log 0/`diff --cached` :201-242 对 K:262-321；KB-04 的 `..`、`/etc`、`.evaluator` 拒绝与父环境隐藏 :243-274 对 K:322-365；KB-05 的 timeout/cancel 前输出与 32 KiB 截断 :275-320 对 K:366-416。RL-14 只多断言 `result.resourceCaps` 已应用（如 :186-188）。两条都是冻结规格行，不删。 | keep-note | `tests/kernel/K-readonly-sandbox.test.ts::KB-01`（:207）/ `KB-03`（:262）/ `KB-04`（:322）/ `KB-05`（:366） | 0 | true | 中 |
| C-06 | stale | `tests/runtime/A2-reconcile-runtime.test.ts:522-603`（`seedPreD7Intent` 与 `A8-1d …`） | :522-529 注释自述 “No current writer leaves this state (D-7; RUN-16 settles a queued pause or cancel in its own commit, W-05), so the two records are seeded as that ledger holds them”；:534 用 `newQueuedControlIntentRecord` 造记录，:538-541 用 `commitRaw` + `encodeControlIntentSnapshot` 直写 ControlIntent 与 `RunSnapshot@1`。今天没有公开步骤能产出“未进入 Run 上残留 queued intent”这一状态，只有 D-7 之前写出的旧账本才有；产品从未真实运行（79-1），该场景已不存在。 | delete | 行为已不存在：D-7（RUN-16/W-05）+ 79-1 | 82 | true | 中 |
| C-07 | duplicate | `tests/runtime/B2-13-allow-one-form.test.ts:43-60` 对 `tests/runtime/B2-04-allowance.test.ts:41-71` | 同一 `allow_rerun` 流程：B2-04 已断言卡上的写法执行一次后 `used`/`revision 3`/`usedBy`（:55-56）、下一条相同命令再次 blocked（:65）、解析动作相同但整串不同的写法仍 blocked（:67-69）。B2-13 重复这三段（:46-47、:51-54、:56-58），只多断言 blocked 的写法没有消耗 allowance（:48-49）。两条都是规格行，按规则记注。 | keep-note | `tests/runtime/B2-04-allowance.test.ts::B2-04: allow_rerun lets exactly the card form run once…` | 0 | true | 中 |
| C-08 | duplicate | `tests/runtime/B2-09-allowance-crash.test.ts:65-96`（B2-09b）对 `tests/runtime/B2-04-allowance.test.ts:41-71` | B2-09b 先真实 `allow_rerun`，再断言 `used`/`revision 3`/`usedBy`（:77-81），然后相同命令再次 blocked（:88-91）；这三段与 B2-04 :55-56、:65 相同。新增的只有 `usedAt`、没有第二条 request、固定拒绝文字。 | keep-note | `tests/runtime/B2-04-allowance.test.ts::B2-04: allow_rerun lets exactly the card form run once…` | 0 | true | 中 |
| C-09 | duplicate | `tests/runtime/RL-31-readonly-resource-caps.test.ts:229-267`（Work 臂 a-d）对 :65-103（Query 臂 a-d） | 两臂断言同一工具 `run_readonly_command`、同一 handler（`src/core/agent-runtime/readonly-command-tool.ts` 是唯一实现）的四条映射，期望值逐条相同：内存上限命中都是 `命令退出码 N（超出内存上限）` + `execution_failed` + `resourceCaps`；进程上限命中都仍是 success；none 都是同一句 `没有资源上限：内存和进程数的控制没有下放给当前用户`。差别只在入口夹具（Query 对 empty-write Work）。:224 注释自认 “same mapping”。RL-31 是冻结规格行。 | keep-note | `tests/runtime/RL-31-readonly-resource-caps.test.ts::RL-31 (a) an applied report copies into the successful Query JSON verbatim`（及 b-d） | 0 | true | 中 |
| C-10 | stale | `tests/runtime/R4b-session-input-boundaries.test.ts:6,119-121`（`rejects history limit outside 1..200 and a continuation cursor from another principal`） | 用 `rawInsertRecords(buildRawTurn(...))` 直写 Kernel 表；夹具自述按「旧二进制」写入、用于验证新读取器向后兼容（`tests/kernel/R4a-legacy-fixtures.ts:178-182`）。79-1 后只读当前格式；真实 Turn 写法已存在（`tests/runtime/R4c-execution-history.test.ts:99` 的 `runTurn` 走 `runObservedModel`）。该测试真正要测的 limit 与跨 principal cursor 不依赖旧格式。 | convert:`runObservedModel` 真实 Turn | — | 12 | false | 中 |
| C-11 | stale | `tests/runtime/R4b-session-recovery.test.ts:8,183-202`（`binds raw history continuation to its original adapter, Session and upper record position`） | 同一旧二进制夹具在 :184、:192 两次 `rawInsertRecords`，造两段 raw history 再测续读上界。79-1 后旧 raw history 不再存在；真实 `runObservedModel` Turn 可以产出相同的位置/游标。 | convert:`runObservedModel` 真实 Turn | — | 10 | false | 中 |
| C-12 | stale | `tests/runtime/R4b-session-skeleton.test.ts:54-64`（`requires an explicit trusted legacy locator and matching original Kernel Session ID`） | 固定 `legacyEntries` / `registry.legacy()` / `withLegacyReader`；`src/core/agent-runtime/kernel-store-locator.ts:26-31,59` 自述 “Explicit, read-only legacy locator”，只服务旧 Kernel 库。79-1 说产品从未真实运行、旧版本写的库重建、不留旧版本兼容；这个 locator 及其测试都属于旧库路径。 | delete | 行为已不存在：79-1（旧 Kernel 库 locator） | 11 | false | 中 |
| C-13 | duplicate | `tests/runtime/K3-continuation-review-note.test.ts:160-179,321-327`（`leaves a brief without unknownCallReview byte-identical to the pre-K3 bytes`）对 `tests/runtime/K3-15-blocked-sentence-pure.test.ts:17-56` | `BASE_RENDER`（:160-179）与 K3-15 pure 的整段 pre-K3 字面量逐字相同（同一 digest `a3a97065…`），两处都从 `baseBrief()` 渲染再比较；:324 再做同一次全文比较。合并时保留 :322-326 的“显式 null 与缺席等价”断言即可。 | merge-into:`tests/runtime/K3-15-blocked-sentence-pure.test.ts::renders the fixed pre-B3 text, including the marker and the ending` | `tests/runtime/K3-15-blocked-sentence-pure.test.ts::renders the fixed pre-B3 text`（:17-56） | 20 | true | 高 |
| C-14 | duplicate | `tests/runtime/K3-12-review-round-tools.test.ts:66-105,129-146` 对 `tests/runtime/K3-review-preparation.test.ts:97-118,168-207` | 两文件各有一份近乎相同的 `prepareReviewRun`（真实 Run/Role 读取 + review owner + body store + Kernel registry），都通过同一个 `openK3ReviewCardWorld` 的 `createK3PendingReview`→真实 review claim→`prepare`，都断言 `tools=['read','run_readonly_command','record_unknown_call_review']`、`writeScope=[]`。后者还多断言 sessionBasis、最后 section 与 inputDigest。两条都是规格行，不删。 | keep-note | `tests/runtime/K3-review-preparation.test.ts::K3-L13-5`（更全） | 0 | true | 中 |
| C-15 | handwritten | `tests/runtime/K3-35-workspace-baseline-prepare.test.ts:84-186`（`executionRecord`、`assemblerDouble`、`preparation`；测试 :189） | `executionRecord()` 手写整份 `TaskExecutionRecord`（Run/attempt/outbox/plan/session）；`preparation()` 用 `executions:{readExecution:async()=>executionRecord()}`、假 roles 与 `assemblerDouble` 直接喂生产 `createExecutionPreparation.prepare`（:158-186）。真实公开链 claim→prepare 已存在（`openK3ReviewCardWorld`，`tests/runtime/K3-12-review-round-tools.test.ts:130-146` 就在用）。 | convert:公开 TaskClaim + 生产 prepare（`openK3ReviewCardWorld`） | — | 103 | true | 中 |
| C-16 | duplicate | `tests/runtime/K3-35-approved-methods-brief.test.ts:87-180` 对 `tests/runtime/K3-35-T-by-hand.test.ts:105-148` | 两文件都 `openK3_35PublicRecord` + `prepareWorstCase`，都经同一真实 helper 断言 `requiredReviewBlock(suffix)===K3_35_REQUIRED_REVIEW_BLOCK_ONE`（:167 与 :141）、没有 `### 异常锚点`、保留 `### 被拦的命令`、≤16,384；第一段同样断言 1 个 process item、1 条 blocked command、8 个 anchor、changedFiles unavailable/unknown。差异主要在 taskId 字节数与 T 总数（12,171 对 12,676/12,764）。两条都是规格行。 | keep-note | `tests/runtime/K3-35-T-by-hand.test.ts::prepare succeeds within 16,384… T = 512`（:134） | 0 | true | 中 |
| C-17 | tamper | `tests/runtime/R4b-session-operations.test.ts:144-159`（`fails closed when the original Kernel session.created record is damaged`） | 真实 `createSession` 后用 `new DatabaseSync(...)` 执行 `UPDATE session_records SET record_json='{}'`（:154-155），只为触发读取器的解码失败分支；正常公开步骤不会产生该状态。AGENTS 第 4 条：不保留只有篡改数据库才能触发的防御测试。 | delete | 行为已不存在：AGENTS 第 4 条 | 16 | false | 高 |
| C-18 | tamper | `tests/runtime/R4b-session-recovery.test.ts:204-220`（`rejects missing original Kernel history without returning an empty success page`） | 真实建 Session 后 `DELETE FROM session_records WHERE position=1`（:214-215）删掉 `session.created`，只为让读取返回非 ready；只能由库篡改造成。AGENTS 第 4 条。 | delete | 行为已不存在：AGENTS 第 4 条 | 17 | false | 高 |
| C-19 | tamper | `tests/runtime/R4c-kernel-history-range.test.ts:456-586`（tail key、damaged/schema/checksum、gap、position、session key、append 重开；不含 :420-454 与 :588-609 的“损坏在范围外仍可读”读范围用例） | 这些用例先 `seedSession` 真实写入，再 `mutateDatabase` 直接 `UPDATE/DELETE session_records`：`record_json='{}'`/`not-json`、改 `position` 为 0/-1/2^53、交换两行 position、把 B 的合法记录搬到 A、删中间 position（:460-470、:490-505、:525、:540-542、:561、:577）。只有手改 SQLite 能触发这些 `corrupt` 防御分支。读范围测试（损坏在页外仍能读）不是防御测试，保留。 | delete（只删上述防御用例） | 行为已不存在：AGENTS 第 4 条 | 125 | false | 中 |
| C-20 | tamper | `tests/runtime/R4c-graph-history.test.ts:897-902,929-935`（`preserves an empty terminal page…` 与 `rejects continuation after the frozen Session tail is truncated…` 的篡改块） | 合法读取后用 `new DatabaseSync` + `DELETE FROM session_records … position=?`（:899-900、:931-932）删真实记录，再断言 `unavailable`；只测库被外部截断的防御分支。两个测试的前半段（真实游标、真实范围）保留。 | delete（仅删篡改块） | 行为已不存在：AGENTS 第 4 条 | 12 | false | 中 |
| C-21 | handwritten | `tests/runtime/R4c-source-authority-guards.test.ts:321-394`，核心 :358-376（`uses real SQLite facts through both readers…`） | `seedRun` 直接 `fixture.commitRaw` 写 `RunSnapshot@1` JSON，把 `status:'running'` 与整份 envelope 一次写库（:376）；:374-375 注释自认 “No entry service, execution authorization or claim-to-running transition is claimed here”。公开步骤存在：真实 claim→prepare→`startRun`（`tests/runtime/K3-19-review-admission.test.ts:155` 已在用）。 | convert:公开 claim→prepare→startRun | — | 60 | false | 中 |
| C-22 | tamper | `tests/runtime/R4c-source-authority-guards.test.ts:264-304`（`rejects unreadable consumed envelope identity from a real stored Run…`） | 先真实 claim，再用 `fixture.commitRaw` 写入 `damaged` RunSnapshot（envelope 只有 permissions，:278-281），绕过 schema 制造“消费时身份不可读”，只为命中 `unavailable` 防御分支；公开写入不会产生该快照。AGENTS 第 4 条。 | delete | 行为已不存在：AGENTS 第 4 条 | 35 | false | 中 |
| C-23 | handwritten | `tests/runtime/R4b-session-input-boundaries.test.ts:48-53`；另三处 `R4b-session-operations.test.ts:52-60`、`R4b-session-recovery.test.ts:53-60`、`R4c-execution-history.test.ts:54-61` | 四处都用同一手写 `PreparedCommit`（`encodeProjectSnapshot`/`encodeWorkspaceSnapshot` + `TrustedScopeSeeded` 事件）直接 `backend.records.commit` 建 Project/Workspace。公开步骤存在：`createProjectBootstrapServices().createProject/registerWorkspace`（`src/core/work-graph/configuration/project-bootstrap-service.ts:1129-1130`，composition 在 `src/composition/create-platform.ts:711` 接线）。 | convert:`createProjectBootstrapServices().createProject/registerWorkspace` | — | 40 | false | 中 |
| C-24 | stale | `tests/runtime/S1-archive-files-brief.test.ts:204-228`（IT04 `loading a frozen old manifest keeps the exact marker, digest and text with no new section`），常量 :249-253 | 测试用手写 `OLD_MANIFEST_JSON`（:253，含 `"policyRevision":"legacy-template"`、`"old legacy binding"`）直接 `bodies.put`（:207），再断言 pre-S1 的 `OLD_DIGEST`/`OLD_TEXT`（:249、:251）和「没有 anomalies」（:227）；:248 注释自认 “Frozen pre-S1 encodings: no current encoder/renderer constructs the oracle”。当前 `loadPreparedManifest`（`src/core/agent-runtime/execution-preparation.ts:641-700`）没有版本分派，只校验当前格式；这属于 79-1 点名要删的旧版本 fixture。当前格式的装载/渲染由 IT01、IT03、IT05 与 `tests/runtime/C3-brief-timeline.test.ts` 覆盖。 | delete | 行为已不存在：79-1（旧版本 tolerance 与 legacy fixture）；当前装载 `S1-archive-files-brief.test.ts::IT03`，时间线 `C3-brief-timeline.test.ts` | 30 | true | 中 |
| C-25 | stale | `tests/runtime/source-tool-lifecycle.test.ts:226-244,246-258`（`closes legacy language services once…`、`reports actual index disposal failure…`） | 两个测试都在 :231/:252 用 `projectSource:{mode:'legacy_live'}` 构造只为兼容保留的 `ProjectSourceIndex`，断言其 `dispose` 次数/抛错和 `project_index` 关闭后拒绝。生产只在有 `read` 时同时建 sourceTools 与 frozen factory（`src/core/agent-runtime/execution-driver.ts:1136-1155`，`query-execution.ts:533-543`），`exploration-tools.ts:77` 注释称 `legacy_live` 是 “the default for existing direct callers”，frozen 模式根本不建 `ProjectSourceIndex`（:113-117）。79-1 要重看的旧接口。frozen 模式的 close/幂等由同文件 :117 覆盖。 | delete | 行为已不存在：79-1（只为兼容保留的 `project_index`/`legacy_live` 路径）；frozen close 见 `source-tool-lifecycle.test.ts:117` | 32 | false | 中 |
| C-26 | handwritten | `tests/runtime/S5-user-message-tools.test.ts:246-299`（`preparePumpRun`，TU07 使用） | 读已存的 RA manifest body，替换 claim 后 `JSON.stringify` 再 `bodies.put`（:254-259），并手工拼 `PreparedTaskExecution`（:260-266），随后才走 authorize/begin/recordExecutionEntered。公开步骤存在：`platform.runtime.prepareExecution` 已能产出同一 prepared/manifest（`tests/app/S4C2-scribe-reminders.test.ts:443` 在用）。 | convert:`platform.runtime.prepareExecution` | — | 45 | true | 中 |
| C-27 | handwritten | `tests/runtime/S3-graph-tools.test.ts:846-903,967-985`（`openInputFixture` 的 scope seed、`commitRaw` 写 RunSnapshot） | :895-903 直接 `backend.records.commit(scopeSeed)` 写手拼的 Project/Workspace/governance 快照；:854、:892、:969 用生产不存在的测试专用事件 `TrustedScopeSeeded` 作种子；:978-984 用 `fxRunSnapshot` 手写 `RunSnapshot@1` JSON。公开步骤存在：Project/Workspace 走 `platform.projects.createProject/registerWorkspace`（`tests/runtime/R5b-query-session-loop.test.ts:107-115`），Run 走 `runtime.prepareExecution/startRun`。至少删掉测试专用事件。 | convert:`platform.projects.createProject` / `runtime.prepareExecution` | — | 60 | true | 中 |
| C-28 | duplicate | `tests/runtime/K-readonly-command.test.ts:1132-1158`（KB-11 external change）对 `tests/runtime/RL-31-readonly-resource-caps.test.ts:112-128` | 同一业务场景：命令执行期间别的写者改了工作区，只报路径、不算本命令效果。两处都断言固定消息 `workspace_changed_during_readonly_command: …`（K:1149、RL:123）、`reason` 判别值（RL:125、K:1152-1155 的 json）和 `externalChangedPaths:['src/racy.txt']`（K:1155、RL:126）。K 多断言 retryable:false/effects，RL 多断言内存上限命中时不加尾注。两条都是规格行。 | keep-note | `tests/runtime/RL-31-readonly-resource-caps.test.ts::RL-31 an external change with a memory cap hit keeps the fixed M10 message without a tail note` | 0 | true | 中 |
| C-29 | handwritten | `tests/runtime/source-binding-migration.test.ts:59-77,78-118,190-216` | `facts()` 用内存 Map 做假 authority；`workFixture` 手拼 `RunSnapshot`/envelope；`queryFixture` 手拼 `QueryJobSnapshot`/`QueryRunSnapshot` 并把 `QueryJobSubmitted` 事件直接 push 进假 history（:214）。这是“stand-in fed pre-built state”。公开步骤存在：Work 由真实 runtime 的 `createRuntimeSourceCaptureFactory` 创建（`execution-driver.ts:1148`，`B2-runtime-execution.test.ts` 已走真实路径），Query 由 `platform.queries.submitQueryJob`/`claimQuery` 产出（`R5b-query-session-loop.test.ts:178-205`）。 | convert:`platform.runtime.prepareExecution` / `platform.queries.submitQueryJob+claimQuery` | — | 60 | false | 中 |

## JSON

```json
[
  {
    "id": "C-01",
    "category": "helper",
    "file": "tests/kernel/R4a-legacy-fixtures.ts",
    "lines": "1-214（buildRawTurn 108-181，rawInsertRecords 183-210）",
    "tests": "buildRawTurn / rawInsertRecords / TempWorkspace 旧 writer",
    "evidence": "文件头 :1-4 自述 Test-only legacy writer，raw SQLite writes intentionally bypass the new writer；:178-182 说明按「旧二进制」直写以验证新读取器的向后兼容；:190-207 直接 INSERT INTO session_records。全树导入方只有 R4a-frozen-public.test.ts:17-19、R4b-session-input-boundaries.test.ts:6、R4b-session-recovery.test.ts:8。HANDOFF:565-570（79-1）把旧格式夹具列为删除候选。",
    "action": "delete",
    "covered_by": "行为已不存在：79-1（旧格式夹具）；同批先做 C-02/C-03/C-10/C-11",
    "est_lines": 214,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-02",
    "category": "stale",
    "file": "tests/kernel/R4a-frozen-public.test.ts",
    "lines": "423-442",
    "tests": "reads a legacy schemaVersion=1 Turn without new constraint fields or rewriting its checksum",
    "evidence": ":428-429 用 buildRawTurn/rawInsertRecords 造缺 recoveryConstraints、无 contextBasis 的旧 Turn；:431-434 断言两字段不存在；:436-439 要求照常 recover 成 terminal。当前写入方无条件写 recoveryConstraints（vendor/coding-agent/dist/app/composition/composition-root.js:259-271）；79-2（HANDOFF:571-580）要求删旧正文分支。当前格式的不重写由同文件 :245-284、:396-422 覆盖。",
    "action": "delete",
    "covered_by": "行为已不存在：79-1 + 79-2（schemaVersion=1 旧 Turn 容忍）",
    "est_lines": 20,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-03",
    "category": "tamper",
    "file": "tests/kernel/R4a-frozen-public.test.ts",
    "lines": "627-653",
    "tests": "still accepts a legacy checkpoint without recovery constraints",
    "evidence": ":634-644 用 DatabaseSync 直接 UPDATE checkpoints 删掉 recoveryConstraints 并重算 checksum；:646-651 要求 RecoveryCoordinator 仍采用该 checkpoint。当前写入方每次都写 constraints（composition-root.js:259-271），正常步骤造不出这个状态；只有改库能触发旧 checkpoint 兼容分支。AGENTS 第 4 条 + 79-1。",
    "action": "delete",
    "covered_by": "行为已不存在：79-1（旧 checkpoint 兼容分支）+ AGENTS 第 4 条",
    "est_lines": 27,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-04",
    "category": "duplicate",
    "file": "tests/kernel/R4a-frozen-public.test.ts",
    "lines": "382-422 对 152-244",
    "tests": "stable identity replay selects the middle completed Run… / a paused Turn cannot resume with a larger model budget after restart / a paused Turn does not lose an explicit denied prefix…",
    "evidence": "三对同场景同断言：身份重放 :382-395 对 :152-177；预算拒绝 :396-405 对 :192-212；省略 deniedPrefix :406-422 对 :213-244。前者是更完整的独立验收流，后者迁自另一份 vendor review；tests/kernel/README.md:10-11 说明两组来源不同。",
    "action": "merge-into:tests/kernel/R4a-frozen-public.test.ts::independent R4a execution identity and paused recovery",
    "covered_by": "tests/kernel/R4a-frozen-public.test.ts::replays the requested old identity after a newer completed Turn（:152）/ rejects a paused recovery that raises the persisted model-request budget（:192）/ does not expose a previously denied path…（:213）",
    "est_lines": 41,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-05",
    "category": "duplicate",
    "file": "tests/kernel/RL-12-15-conditions.test.ts",
    "lines": "165-320 对 tests/kernel/K-readonly-sandbox.test.ts:207-416",
    "tests": "RL-14 KB-01 read_only refuses every workspace write… / KB-03 blocks the local port… / KB-04 rejects escaping cwd… / KB-05 keeps pre-timeout/cancel output…",
    "evidence": "四条只读沙箱行为逐句相同：KB-01 :165-200 对 K:207-240；KB-03 :201-242 对 K:262-321；KB-04 :243-274 对 K:322-365；KB-05 :275-320 对 K:366-416。RL-14 只多断言 result.resourceCaps 已应用（如 :186-188）。两条都是冻结规格行。",
    "action": "keep-note",
    "covered_by": "tests/kernel/K-readonly-sandbox.test.ts::KB-01（:207）/ KB-03（:262）/ KB-04（:322）/ KB-05（:366）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-06",
    "category": "stale",
    "file": "tests/runtime/A2-reconcile-runtime.test.ts",
    "lines": "522-603",
    "tests": "seedPreD7Intent / A8-1d (W-04, CI-01, CI-02, CTL-08(a), RUN-09..11 (R))",
    "evidence": ":522-529 注释自述 No current writer leaves this state (D-7; RUN-16 settles a queued pause or cancel in its own commit, W-05), so the two records are seeded as that ledger holds them；:534 用 newQueuedControlIntentRecord 造记录，:538-541 用 commitRaw + encodeControlIntentSnapshot 直写 ControlIntent 与 RunSnapshot@1。今天没有公开步骤能产出这个状态；只有 D-7 之前写出的旧账本才有，产品从未真实运行（79-1）。",
    "action": "delete",
    "covered_by": "行为已不存在：D-7（RUN-16/W-05）+ 79-1",
    "est_lines": 82,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-07",
    "category": "duplicate",
    "file": "tests/runtime/B2-13-allow-one-form.test.ts",
    "lines": "43-60 对 tests/runtime/B2-04-allowance.test.ts:41-71",
    "tests": "B2-13: another form with the same parsed actions is still blocked while the card form is allowed",
    "evidence": "B2-04 已断言卡上的写法执行一次后 used/revision 3/usedBy（:55-56）、下一条相同命令再次 blocked（:65）、解析动作相同的整串仍 blocked（:67-69）。B2-13 重复这三段（:46-47、:51-54、:56-58），只多断言 blocked 的写法没有消耗 allowance（:48-49）。两条都是规格行。",
    "action": "keep-note",
    "covered_by": "tests/runtime/B2-04-allowance.test.ts::B2-04: allow_rerun lets exactly the card form run once…",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-08",
    "category": "duplicate",
    "file": "tests/runtime/B2-09-allowance-crash.test.ts",
    "lines": "65-96 对 tests/runtime/B2-04-allowance.test.ts:41-71",
    "tests": "B2-09b (owner part): the committed consume leaves the request used with usedBy, and the same command is blocked again",
    "evidence": "B2-09b 先真实 allow_rerun，再断言 used/revision 3/usedBy（:77-81），然后相同命令再次 blocked（:88-91）；这三段与 B2-04 :55-56、:65 相同。新增只有 usedAt、没有第二条 request、固定拒绝文字。",
    "action": "keep-note",
    "covered_by": "tests/runtime/B2-04-allowance.test.ts::B2-04: allow_rerun lets exactly the card form run once…",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-09",
    "category": "duplicate",
    "file": "tests/runtime/RL-31-readonly-resource-caps.test.ts",
    "lines": "229-267 对 65-103",
    "tests": "RL-31 (a)-(d) the empty-write Work maps the same applied report / adds the same tail note / keeps a process cap hit / copies the none report text",
    "evidence": "Work 臂与 Query 臂断言同一工具 run_readonly_command、同一 handler（src/core/agent-runtime/readonly-command-tool.ts 唯一实现）的四条相同映射与相同期望值：内存上限命中都是 命令退出码 N（超出内存上限）+ execution_failed + resourceCaps；进程上限命中仍 success；none 都是同一句 没有资源上限…。差别只在入口夹具（Query 对 empty-write Work）；:224 注释自认 same mapping。RL-31 是冻结规格行。",
    "action": "keep-note",
    "covered_by": "tests/runtime/RL-31-readonly-resource-caps.test.ts::RL-31 (a) an applied report copies into the successful Query JSON verbatim（及 b-d）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-10",
    "category": "stale",
    "file": "tests/runtime/R4b-session-input-boundaries.test.ts",
    "lines": "6,119-121",
    "tests": "rejects history limit outside 1..200 and a continuation cursor from another principal",
    "evidence": "用 rawInsertRecords(buildRawTurn(...)) 直写 Kernel 表；夹具自述按「旧二进制」写入、用于验证新读取器向后兼容（tests/kernel/R4a-legacy-fixtures.ts:178-182）。79-1 后只读当前格式；真实 Turn 写法已存在（R4c-execution-history.test.ts:99 的 runTurn 走 runObservedModel），该测试真正要测的 limit 与跨 principal cursor 不依赖旧格式。",
    "action": "convert:runObservedModel 真实 Turn",
    "covered_by": "—",
    "est_lines": 12,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-11",
    "category": "stale",
    "file": "tests/runtime/R4b-session-recovery.test.ts",
    "lines": "8,183-202",
    "tests": "binds raw history continuation to its original adapter, Session and upper record position",
    "evidence": "同一旧二进制夹具在 :184、:192 两次 rawInsertRecords，造两段 raw history 再测续读上界。79-1 后旧 raw history 不再存在；真实 runObservedModel Turn 可以产出相同的位置/游标。",
    "action": "convert:runObservedModel 真实 Turn",
    "covered_by": "—",
    "est_lines": 10,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-12",
    "category": "stale",
    "file": "tests/runtime/R4b-session-skeleton.test.ts",
    "lines": "54-64",
    "tests": "requires an explicit trusted legacy locator and matching original Kernel Session ID",
    "evidence": "固定 legacyEntries / registry.legacy() / withLegacyReader；src/core/agent-runtime/kernel-store-locator.ts:26-31,59 自述 Explicit, read-only legacy locator，只服务旧 Kernel 库。79-1 说产品从未真实运行、旧版本写的库重建、不留旧版本兼容；这个 locator 及其测试都属于旧库路径。",
    "action": "delete",
    "covered_by": "行为已不存在：79-1（旧 Kernel 库 locator）",
    "est_lines": 11,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-13",
    "category": "duplicate",
    "file": "tests/runtime/K3-continuation-review-note.test.ts",
    "lines": "160-179,321-327 对 tests/runtime/K3-15-blocked-sentence-pure.test.ts:17-56",
    "tests": "leaves a brief without unknownCallReview byte-identical to the pre-K3 bytes",
    "evidence": "BASE_RENDER（:160-179）与 K3-15 pure 的整段 pre-K3 字面量逐字相同（同一 digest a3a97065…），两处都从 baseBrief() 渲染再比较；:324 再做同一次全文比较。合并时保留 :322-326 的显式 null 与缺席等价断言。",
    "action": "merge-into:tests/runtime/K3-15-blocked-sentence-pure.test.ts::renders the fixed pre-B3 text, including the marker and the ending",
    "covered_by": "tests/runtime/K3-15-blocked-sentence-pure.test.ts::renders the fixed pre-B3 text（:17-56）",
    "est_lines": 20,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C-14",
    "category": "duplicate",
    "file": "tests/runtime/K3-12-review-round-tools.test.ts",
    "lines": "66-105,129-146 对 tests/runtime/K3-review-preparation.test.ts:97-118,168-207",
    "tests": "K3-12 prepares a review-purpose Run with exactly the L13 tools and an empty write scope",
    "evidence": "两文件各有一份近乎相同的 prepareReviewRun（真实 Run/Role 读取 + review owner + body store + Kernel registry），都通过同一 openK3ReviewCardWorld 的 createK3PendingReview→真实 review claim→prepare，都断言 tools=['read','run_readonly_command','record_unknown_call_review']、writeScope=[]。后者还多断言 sessionBasis、最后 section 与 inputDigest。两条都是规格行。",
    "action": "keep-note",
    "covered_by": "tests/runtime/K3-review-preparation.test.ts::K3-L13-5（更全）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-15",
    "category": "handwritten",
    "file": "tests/runtime/K3-35-workspace-baseline-prepare.test.ts",
    "lines": "84-186",
    "tests": "K3-35 (四) prepare succeeds and records an unavailable too_many_changes baseline",
    "evidence": "executionRecord() 手写整份 TaskExecutionRecord（Run/attempt/outbox/plan/session）；preparation() 用 executions:{readExecution:async()=>executionRecord()}、假 roles 与 assemblerDouble 直接喂生产 createExecutionPreparation.prepare（:158-186）。真实公开链 claim→prepare 已存在（openK3ReviewCardWorld，K3-12-review-round-tools.test.ts:130-146 就在用）。",
    "action": "convert:公开 TaskClaim + 生产 prepare（openK3ReviewCardWorld）",
    "covered_by": "—",
    "est_lines": 103,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-16",
    "category": "duplicate",
    "file": "tests/runtime/K3-35-approved-methods-brief.test.ts",
    "lines": "87-180 对 tests/runtime/K3-35-T-by-hand.test.ts:105-148",
    "tests": "uses the public record facts: one process method, one target, one blocked command / K3-35 (二): prepare succeeds on the same Task…",
    "evidence": "两文件都 openK3_35PublicRecord + prepareWorstCase，都断言 requiredReviewBlock(suffix)===K3_35_REQUIRED_REVIEW_BLOCK_ONE（:167 与 :141）、没有 ### 异常锚点、保留 ### 被拦的命令、≤16,384；第一段同样断言 1 个 process item、1 条 blocked command、8 个 anchor、changedFiles unavailable/unknown。差异主要在 taskId 字节数与 T 总数（12,171 对 12,676/12,764）。两条都是规格行。",
    "action": "keep-note",
    "covered_by": "tests/runtime/K3-35-T-by-hand.test.ts::prepare succeeds within 16,384… T = 512（:134）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-17",
    "category": "tamper",
    "file": "tests/runtime/R4b-session-operations.test.ts",
    "lines": "144-159",
    "tests": "fails closed when the original Kernel session.created record is damaged",
    "evidence": "真实 createSession 后用 new DatabaseSync(...) 执行 UPDATE session_records SET record_json='{}'（:154-155），只为触发读取器的解码失败分支；正常公开步骤不会产生该状态。AGENTS 第 4 条。",
    "action": "delete",
    "covered_by": "行为已不存在：AGENTS 第 4 条",
    "est_lines": 16,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C-18",
    "category": "tamper",
    "file": "tests/runtime/R4b-session-recovery.test.ts",
    "lines": "204-220",
    "tests": "rejects missing original Kernel history without returning an empty success page",
    "evidence": "真实建 Session 后 DELETE FROM session_records WHERE position=1（:214-215）删掉 session.created，只为让读取返回非 ready；只能由库篡改造成。AGENTS 第 4 条。",
    "action": "delete",
    "covered_by": "行为已不存在：AGENTS 第 4 条",
    "est_lines": 17,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C-19",
    "category": "tamper",
    "file": "tests/runtime/R4c-kernel-history-range.test.ts",
    "lines": "456-586（不含 420-454、588-609）",
    "tests": "rejects a %s tail key as corrupt… / rejects damaged, schema-invalid and checksum-invalid records… / rejects a gap… / rejects a database position… / rejects a database Session key… / keeps append/replay full-history validation…",
    "evidence": "先 seedSession 真实写入，再 mutateDatabase 直接 UPDATE/DELETE session_records：record_json='{}'/not-json、position 改 0/-1/2^53、交换两行 position、把 B 的合法记录搬到 A、删中间 position（:460-470、:490-505、:525、:540-542、:561、:577）。只有手改 SQLite 能触发这些 corrupt 防御分支。读范围测试（损坏在页外仍能读，:420-454 与 :588-609）不是防御测试，保留。",
    "action": "delete（只删上述防御用例）",
    "covered_by": "行为已不存在：AGENTS 第 4 条",
    "est_lines": 125,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-20",
    "category": "tamper",
    "file": "tests/runtime/R4c-graph-history.test.ts",
    "lines": "897-902,929-935",
    "tests": "preserves an empty terminal page… / rejects continuation after the frozen Session tail is truncated…",
    "evidence": "合法读取后用 new DatabaseSync + DELETE FROM session_records … position=?（:899-900、:931-932）删真实记录，再断言 unavailable；只测库被外部截断的防御分支。两个测试的前半段（真实游标、真实范围）保留。",
    "action": "delete（仅删篡改块）",
    "covered_by": "行为已不存在：AGENTS 第 4 条",
    "est_lines": 12,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-21",
    "category": "handwritten",
    "file": "tests/runtime/R4c-source-authority-guards.test.ts",
    "lines": "321-394（核心 358-376）",
    "tests": "uses real SQLite facts through both readers: a starting claim is denied, a trusted running seed can read, and revocation is fresh",
    "evidence": "seedRun 直接 fixture.commitRaw 写 RunSnapshot@1 JSON，把 status:'running' 与整份 envelope 一次写库（:376）；:374-375 注释自认 No entry service, execution authorization or claim-to-running transition is claimed here。公开步骤存在：真实 claim→prepare→startRun（K3-19-review-admission.test.ts:155 已在用）。",
    "action": "convert:公开 claim→prepare→startRun",
    "covered_by": "—",
    "est_lines": 60,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-22",
    "category": "tamper",
    "file": "tests/runtime/R4c-source-authority-guards.test.ts",
    "lines": "264-304",
    "tests": "rejects unreadable consumed envelope identity from a real stored Run without throwing or file I/O",
    "evidence": "先真实 claim，再用 fixture.commitRaw 写入 damaged RunSnapshot（envelope 只有 permissions，:278-281），绕过 schema 制造消费时身份不可读，只为命中 unavailable 防御分支；公开写入不会产生该快照。AGENTS 第 4 条。",
    "action": "delete",
    "covered_by": "行为已不存在：AGENTS 第 4 条",
    "est_lines": 35,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-23",
    "category": "handwritten",
    "file": "tests/runtime/R4b-session-input-boundaries.test.ts",
    "lines": "48-53；另见 R4b-session-operations.test.ts:52-60、R4b-session-recovery.test.ts:53-60、R4c-execution-history.test.ts:54-61",
    "tests": "四个文件的 open() scope seed",
    "evidence": "四处都用同一手写 PreparedCommit（encodeProjectSnapshot/encodeWorkspaceSnapshot + TrustedScopeSeeded 事件）直接 backend.records.commit 建 Project/Workspace。公开步骤存在：createProjectBootstrapServices().createProject/registerWorkspace（src/core/work-graph/configuration/project-bootstrap-service.ts:1129-1130，composition 在 src/composition/create-platform.ts:711 接线）。",
    "action": "convert:createProjectBootstrapServices().createProject/registerWorkspace",
    "covered_by": "—",
    "est_lines": 40,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-24",
    "category": "stale",
    "file": "tests/runtime/S1-archive-files-brief.test.ts",
    "lines": "204-228,249-253",
    "tests": "IT04 loading a frozen old manifest keeps the exact marker, digest and text with no new section",
    "evidence": "测试用手写 OLD_MANIFEST_JSON（:253，含 policyRevision legacy-template、old legacy binding）直接 bodies.put（:207），再断言 pre-S1 的 OLD_DIGEST/OLD_TEXT（:249、:251）和没有 anomalies（:227）；:248 注释自认 Frozen pre-S1 encodings: no current encoder/renderer constructs the oracle。当前 loadPreparedManifest（execution-preparation.ts:641-700）没有版本分派，只校验当前格式；属 79-1 要删的旧版本 fixture。当前格式装载由 IT01/IT03/IT05 与 C3-brief-timeline 覆盖。",
    "action": "delete",
    "covered_by": "行为已不存在：79-1（旧版本 tolerance 与 legacy fixture）；当前装载 S1-archive-files-brief.test.ts::IT03，时间线 C3-brief-timeline.test.ts",
    "est_lines": 30,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-25",
    "category": "stale",
    "file": "tests/runtime/source-tool-lifecycle.test.ts",
    "lines": "226-244,246-258",
    "tests": "closes legacy language services once and refuses new handlers after the tool group closes / reports actual index disposal failure…",
    "evidence": ":231/:252 用 projectSource:{mode:'legacy_live'} 构造只为兼容保留的 ProjectSourceIndex，断言其 dispose 次数/抛错和 project_index 关闭后拒绝。生产只在有 read 时同时建 sourceTools 与 frozen factory（execution-driver.ts:1136-1155、query-execution.ts:533-543），exploration-tools.ts:77 注释称 legacy_live 是 the default for existing direct callers，frozen 模式根本不建 ProjectSourceIndex（:113-117）。79-1 要重看的旧接口。frozen close/幂等由同文件 :117 覆盖。",
    "action": "delete",
    "covered_by": "行为已不存在：79-1（只为兼容保留的 project_index/legacy_live 路径）；frozen close 见 source-tool-lifecycle.test.ts:117",
    "est_lines": 32,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C-26",
    "category": "handwritten",
    "file": "tests/runtime/S5-user-message-tools.test.ts",
    "lines": "246-299",
    "tests": "preparePumpRun（TU07 的入口准备）",
    "evidence": "读已存的 RA manifest body，替换 claim 后 JSON.stringify 再 bodies.put（:254-259），并手工拼 PreparedTaskExecution（:260-266），随后才走 authorize/begin/recordExecutionEntered。公开步骤存在：platform.runtime.prepareExecution 已能产出同一 prepared/manifest（tests/app/S4C2-scribe-reminders.test.ts:443 在用）。",
    "action": "convert:platform.runtime.prepareExecution",
    "covered_by": "—",
    "est_lines": 45,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-27",
    "category": "handwritten",
    "file": "tests/runtime/S3-graph-tools.test.ts",
    "lines": "846-903,967-985",
    "tests": "openInputFixture scope seed / commitRaw（供 GT08、GT09、GT13 等使用）",
    "evidence": ":895-903 直接 backend.records.commit(scopeSeed) 写手拼 Project/Workspace/governance 快照；:854、:892、:969 用生产不存在的测试专用事件 TrustedScopeSeeded；:978-984 用 fxRunSnapshot 手写 RunSnapshot@1 JSON。公开步骤存在：projects.createProject/registerWorkspace（R5b-query-session-loop.test.ts:107-115）、runtime.prepareExecution/startRun。至少删掉测试专用事件。",
    "action": "convert:platform.projects.createProject / runtime.prepareExecution",
    "covered_by": "—",
    "est_lines": 60,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-28",
    "category": "duplicate",
    "file": "tests/runtime/K-readonly-command.test.ts",
    "lines": "1132-1158 对 tests/runtime/RL-31-readonly-resource-caps.test.ts:112-128",
    "tests": "KB-11 (KE6) an external change during the command is reported as a path, never as this command's effect",
    "evidence": "同一场景：命令执行期间别的写者改了工作区，只报路径、不算本命令效果。两处都断言固定消息 workspace_changed_during_readonly_command…（K:1149、RL:123）、reason 判别值（RL:125、K:1152-1155 的 json）和 externalChangedPaths:['src/racy.txt']（K:1155、RL:126）。K 多断言 retryable:false/effects，RL 多断言内存上限命中时不加尾注。两条都是规格行。",
    "action": "keep-note",
    "covered_by": "tests/runtime/RL-31-readonly-resource-caps.test.ts::RL-31 an external change with a memory cap hit keeps the fixed M10 message without a tail note",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C-29",
    "category": "handwritten",
    "file": "tests/runtime/source-binding-migration.test.ts",
    "lines": "59-77,78-118,190-216",
    "tests": "binds one accepted Work Run… / refuses same-root workspace substitution… / rechecks Run termination… / closes the owned tools… / limits a bound Reviewer… / resolves Query source authority… / rejects a conflicting original Query submission…",
    "evidence": "facts() 用内存 Map 做假 authority；workFixture 手拼 RunSnapshot/envelope；queryFixture 手拼 QueryJobSnapshot/QueryRunSnapshot 并把 QueryJobSubmitted 事件直接 push 进假 history（:214）。这是 stand-in fed pre-built state。公开步骤存在：Work 由真实 runtime 的 createRuntimeSourceCaptureFactory 创建（execution-driver.ts:1148，B2-runtime-execution.test.ts 已走真实路径），Query 由 platform.queries.submitQueryJob/claimQuery 产出（R5b-query-session-loop.test.ts:178-205）。",
    "action": "convert:platform.runtime.prepareExecution / platform.queries.submitQueryJob+claimQuery",
    "covered_by": "—",
    "est_lines": 60,
    "spec_row": false,
    "confidence": "中"
  }
]
```

## 小计

| 类别 | 条数 | 估计行数 |
|---|---:|---:|
| stale（过时） | 7 | 197 |
| duplicate（重复） | 9 | 61 |
| trivial（琐碎） | 0 | 0 |
| handwritten（手写事实） | 6 | 368 |
| tamper（只为篡改） | 6 | 232 |
| helper（辅助） | 1 | 214 |
| **合计** | **29** | **1,072** |

说明：`est_lines` 是建议删除或改写会动的测试行数；keep-note 记 0。重复里只有 C-04（41 行）和 C-13（20 行）建议真正合并，其余六条是两条冻结规格行各测一遍，只留注。手写事实里 C-15（103 行）、C-21/C-27/C-29（各 60 行）是主要改写量；C-23 是四个文件的同一段 scope seed。

## 覆盖

- **总数：** 116 个文件、33,888 行；全部至少打开并读过测试名与关键断言，**没有整份未读的文件**。其中完整读过测试体/断言的约 70 个，只略读的约 46 个（下面列出）。
- **part 1（32 个，11,583 行）：** 完整读过 `K-close-open-turn`、`B2-history-public-export`、`R4a-legacy-fixtures`、`R4a-frozen-public` 的测试体，以及 `B2-01`、`B2-02-approved-method`、`B2-04`、`B2-05-06`、`B2-09`、`B2-13`、`B2-runtime-execution` 的主要部分；另补读 `A2` 210-340、`K-readonly-sandbox` 660-800。其余 21 个文件略读（测试名 + 相关断言段 + 直写/legacy grep）：`K-interrupted-history`、`K-readonly-sandbox` 其余、`R4-terminal-history`、`R4-tool-group-barrier`、`RL-01-02`、`RL-03-05`、`RL-06-11`、`RL-12-15`、`RL-15c`、`RL-20`、`RL-22`、`A2` 其余、`B1-kernel-assembly`、`B2-02-recognition-unified`、`B2-03`、`B2-15`、`B2-16-hook-closure`、`B2-16-hook-reads`、`B2-401`、`C1-communication-tools`、`C2-runtime-platform-tools`。
- **part 2（51 个，12,021 行）：** 37 个完整读过；14 个略读：`K3-19-review-admission-pure`（组合表）、`K3-35-manifest-trim-pure`、`K3-35-renderer-boundary-pure`、`K3-35-review-input-size`、`K3-B3-cancellation-cancelled` 尾部、`K3-B3-newest-request-order` 尾部、`K3-continuation-review-note` 120-180、`K3-merge-cancel-propagation` 尾部、`K3-review-preparation` 170-284、`R2e-git-source-loop` 尾部、`R4-control-runtime` 240 以后、`R4c-execution-history` 部分、`R4c-graph-history` 220-760、`R4c-kernel-history-range` 180-380。未逐行区段没有用于结论。
- **part 3（33 个，10,284 行）：** 22 个完整读过；11 个略读：`K-readonly-command` 150-480/760-830、`R5b-query-session-loop` 270-380、`S1-routed-replies` 130-230、`S2B-tally`（只读 describe/it 名，确认是 2B-01/02/03 纯规格表，按规则不算琐碎）、`S3-context-assembler` 中段（CA01-CA15 规格行）、`S3-graph-tools` 除 336-420/640-740/780-1010 外、`S5R2-agent-application` 120-240、`W2-whiteboard-tools` 1-160、`source-text-loop-migration` 200-323、`source-tool-lifecycle` 60-100。
- **抽查：** 我本人复核了 C-01/C-02/C-03、C-05、C-06、C-09/C-28、C-13、C-14、C-15、C-17/C-18/C-19/C-20/C-22、C-24、C-25、C-26、C-27、C-29 的 `file:line` 与源码行为（共 18 条），并删掉了两处证据不足的候选（K3-15 的 `no blocked commands…` 与 K3-26/K3-18 的四选项数组：两者输入不同或只是同一常量的附带断言，不足以判琐碎/重复）。
- **没定下来的：**
  1. C-02/C-03/C-04 都在 vendor 冻结公开 API 的迁入验收文件里；删测试是否与“冻结公开面”冲突、旧兼容分支是否要 kernel patch，需 lead 定。
  2. C-19 是冻结 Kernel range-read 合同的损坏防御用例；我按 AGENTS 第 4 条报 tamper，但“损坏在页外仍能读”的读范围用例已明确排除，只删纯防御用例。
  3. C-24 的 `anomalies` 在当前 brief 里是可选字段，所以“无 anomalies 的旧 manifest”与当前“无 anomalies 的新 manifest”字节相同；如果 lead 认为这仍属当前格式覆盖，可改 keep-note 而不是 delete。
  4. C-25 的 `legacy_live` 在 `runObservedModel` 里仍是省略 `projectSource` 时的兜底；本仓库两个生产调用点在 `hasRead` 时都会传 frozen，但“所有生产调用点都如此”这一点建议 lead 在 T 的生产清理里再核一次。
  5. C-14、C-16 是两条冻结规格行重叠，删哪条要按规格表归属定；本报告只给 keep-note 和“保留更全的一条”的建议。
- 按要求没有运行任何测试、构建、类型检查、git 写操作；所有结论来自静态阅读。
