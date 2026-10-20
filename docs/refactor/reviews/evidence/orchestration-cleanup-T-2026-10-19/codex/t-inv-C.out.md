C 区清单共 **116 个文件、33,888 行**。本次列出 **39 项候选，涉及约 1,345 行删除或改写**。这是静态盘点：26 个文件逐行读完，90 个文件定向略读并追查候选上下文；不把略读文件标为“已全审、无问题”。未写文件，未运行测试、构建或网络请求。

表中的共同依据：

- **D79**：[HANDOFF.md:565–570](/D:/cxt/t-inv/docs/refactor/HANDOFF.md:565)，只保留当前格式；产品历史不等于开发旧格式。下文“行为已不存在”指支持义务已被此决定取消，**不表示对应生产分支已经删除**。
- **G4**：[AGENTS.md:33](/D:/cxt/t-inv/AGENTS.md:33)，不恢复只有篡改数据库才能触发的防御校验和测试。
- 冻结规格行按 [t-common.md:39–48](/D:/cxt/t-inv/.lead-ref/t-common.md:39) 保护；重复项合并时保留独有断言及原有后端。
- “估计行数”统计现有测试中拟删除或改写的行，**不是净减行数**，不含新增公开流程的代码。`keep-note` 暂计 0 行。

已确认存在的公开步骤，供表中转换项引用：

| 代号 | 已有公开步骤及代码证据 |
|---|---|
| P0 | `projects.createProject`、`registerWorkspace`；接口在 `src/core/work-graph/configuration/project-bootstrap-contracts.ts:38–45`，现成使用在 `tests/helpers/S4A-note-fixture.ts:178–181`。策略安装、激活及初始架构采用在该夹具 `:182–200`。 |
| P1 | `claimTask → runtime.prepareExecution → startRun`；同一 Session 完成第一项任务后领取第二项任务的完整实例在 `tests/runtime/B2-runtime-execution.test.ts:225–246`。 |
| P2 | 当前 Kernel 写入路径 `runObservedModel`；已有 `runTurn` 封装在 `tests/runtime/R4c-execution-history.test.ts:99–112`。 |
| P3 | `queries.submitQueryJob → runtime.createSession → queries.claimQuery → runtime.prepareQuery → startQuery`；实例在 `tests/runtime/R5b-query-session-loop.test.ts:170–195`。 |
| P4 | 真实绑定后重放：`startRun` 在入口授权提交后取消，再公开写入新注记、重新准备；实例在 `tests/runtime/S4C2-assembly.test.ts:275–322`。 |

**候选表**

| 编号 | 类别 | 位置；测试名 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---:|---|---|
| C01 | 过时 | `tests/kernel/R4a-frozen-public.test.ts:423–437,627–649`；`reads a legacy schemaVersion=1 Turn…`、`still accepts a legacy checkpoint without recovery constraints` | 前者经旧 writer 直插 Turn；后者删除 `recoveryConstraints` 并重算 checksum，专门要求旧格式继续可读。D79 已取消此义务。不能单凭缺少 `contextBasis` 判旧格式。 | `delete` | 行为已不存在：D79。当前格式恢复保留同文件 `:245` 的 unchanged limits/denied paths 用例及 `:575` 的 preserved usage 用例。 | 38 | 否 | 高 |
| C02 | 过时 | `tests/runtime/A2-reconcile-runtime.test.ts:521–602`；`seedPreD7Intent`、`A8-1d (W-04, CI-01, CI-02…)` | `:522–525` 明说当前 writer 不会留下这种 pre-D7 状态；`:538–540` 手写 queued intent 和 Run 指针。现行状态机 `src/core/work-graph/state/control-intent-machine.ts:484–505` 要求未进入的 pause/cancel/resume 当次应用。 | `delete` | 行为已不存在：D79 加 D7。当前行为由 `tests/scenarios/A7-control.test.ts:110–175::D-7: controls on a claimed Run apply at once…` 覆盖；保留本文件 `:232–273` 的真实 W-05 路径。 | 82 | 是；行为已替换 | 高 |
| C03 | 过时 | `tests/runtime/R4b-session-skeleton.test.ts:54–64`；`requires an explicit trusted legacy locator and matching original Kernel Session ID` | 专测 `legacyEntries`、`legacy()`、`withLegacyReader()` 的旧 per-Run 库定位；旧用途见 `docs/refactor/tasks/R4b-next-session-skeleton.md:9,23`。应与旧定位生产路径同步清理。 | `delete` | 行为已不存在：D79。当前注册库隔离保留同文件 `:66–81::keeps identical Kernel Session IDs in separate registered databases distinct`。 | 11 | 否 | 高 |
| C04 | 过时 | `tests/runtime/S1-archive-files-brief.test.ts:204–228,248–253`；`IT04 loading a frozen old manifest…` 及 `OLD_*` 常量 | `:207` 写入冻结 pre-S1 manifest；`:219–227` 要求缺少 anomalies 的旧正文、marker、digest 原样保留。冻结行在 `docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md:1025`，已受 D79 覆盖。 | `delete` | 行为已不存在：D79。当前 manifest 重放由同文件 `:189–202::IT03 repeated prepare keeps r0 anchor refs…` 覆盖；保留 IT05。 | 31 | 是；旧格式义务取消 | 高 |
| C05 | 重复 | `tests/kernel/R4a-frozen-public.test.ts:396–404`；`a paused Turn cannot resume with a larger model budget after restart` | 与同文件 `:192–212::rejects a paused recovery that raises the persisted model-request budget before any model call` 相同：预算 1→4、拒绝 conflict、零模型请求、记录不变；后者还明确断言暂停前请求数。 | `delete` | `tests/kernel/R4a-frozen-public.test.ts:192–212::rejects a paused recovery that raises the persisted model-request budget before any model call` | 9 | 否 | 高 |
| C06 | 重复 | `tests/kernel/R4a-frozen-public.test.ts:213–244`；`does not expose a previously denied path when paused recovery omits workspace options` | 与 `:406–421` 均测恢复时省略 denied prefix 后不能泄漏私有文件。前者独有“恰好一个工具结果”；后者独有成功终态和拒绝后记录不变。 | `merge-into:tests/kernel/R4a-frozen-public.test.ts::a paused Turn does not lose an explicit denied prefix when the resume call omits it`；保留双方独有断言 | 同文件 `:406–421` 的上述用例 | 32 | 否 | 高 |
| C07 | 重复 | `tests/runtime/B2-04-allowance.test.ts:72–85`；`B2-04: a failed consumeAllowance commit blocks the call and keeps the allowance allowed` | `B2-09a` 的 `:52–57` 已断言同一失败提交、固定阻断文字、allowed/revision 2/usedAt null；另断言 usedBy null 及随后重试成功。 | `merge-into:tests/runtime/B2-09-allowance-crash.test.ts::B2-09a`；保留 B2-04 行号映射 | `tests/runtime/B2-09-allowance-crash.test.ts:41–63::B2-09a: a rejected consumeAllowance commit blocks the call, keeps allowed, then the retry runs` | 14 | 是 | 高 |
| C08 | 重复 | `tests/runtime/B2-09-allowance-crash.test.ts:65–92`；`B2-09b (owner part)…` | 与 `B2-04` 的 `:41–70` 都是一次额度消费、usedBy、再次阻断。这里独有 usedAt 非空、请求数仍为 1、阻断理由及 revision 不变，须迁移。它不等于真实 crash 场景。 | `merge-into:tests/runtime/B2-04-allowance.test.ts::B2-04: allow_rerun lets exactly the card form run once, records usedBy, then blocks again` | `tests/runtime/B2-04-allowance.test.ts:41–70`；真实 `tests/scenarios/B2-09b-allowance-crash.test.ts` 保留 | 28 | 是 | 高 |
| C09 | 重复 | `tests/runtime/C1-communication-tools.test.ts:115–120,187–196`；固定六名称、读写 effect 两项 | `C2-runtime-platform-tools.test.ts:82–94` 已逐项断言相同名称和 effect，另检查 capabilities、independentReadOnly。C1 的真实收发闭环不是删除对象。 | `delete` | `tests/runtime/C2-runtime-platform-tools.test.ts:70–99::publishes the six frozen mailbox names and the workspace_read read-only registration label` | 16 | 否 | 高 |
| C10 | 重复 | `tests/runtime/K3-12-review-round-tools.test.ts:129–149`；`K3-12 prepares a review-purpose Run…` | 与 `K3-review-preparation.test.ts:168–212` 使用同类真实 review world、公开 claim/prepare，均断言 L13 工具和空 writeScope。前者独有返回 envelope 的同值断言，须迁移；两个后端均保留。 | `merge-into:tests/runtime/K3-review-preparation.test.ts::K3-L13-5` | `tests/runtime/K3-review-preparation.test.ts:168–212::K3-L13-5 prepares with the L13 tools, empty write scope, sessionBasis and the review section` | 21 | 是 | 高 |
| C11 | 重复 | `tests/runtime/K3-19-review-admission-pure.test.ts:1–122`；`reviewRoundAdmissionProblem` 两组 | 其中 10 项输入/结果与 `tests/contracts/review-admission.test.ts:80–177` 重叠。普通 manifest、proposal 缺工具、proposal 多工具三项不是现成重复，须移入保留表。纯拒绝组合仍有规格价值，不改成造库。 | `merge-into:tests/contracts/review-admission.test.ts::reviewRoundAdmissionProblem` | `tests/contracts/review-admission.test.ts:80–177`，加迁入三项独有输入 | 122 | 是；按 U5/R4/L13/L20 保护 | 高 |
| C12 | 重复 | `tests/runtime/S4C-note-tools.test.ts:265–313`；RW-14 的 write、understanding、review、withdraw 四项 | 字段映射已分别在 GTN02 `:133–141`、GTN03 `:158–160`、GTN06 `:193–200` 经 handler 检查。RW-14 独有空列表、null/default 和 strict shape，不能直接丢弃。 | `merge-into:tests/runtime/S4C-note-tools.test.ts::GTN02/GTN03/GTN06`；保留默认值子例 | 同文件 `:123–202` 的 GTN02、GTN03、GTN06 | 49 | 是；保守按编号保护 | 中 |
| C13 | 只为篡改 | `tests/kernel/R4a-frozen-public.test.ts:596–625`；`ignores a checksum-valid checkpoint with unsupported recovery constraint version…` | `:609–616` 把当前 checkpoint 改成 version 2、重算 checksum，再 SQL UPDATE；不是从实际外部输入产生的坏正文。 | `delete` | 不再要求此篡改专用行为：G4；正常暂停恢复保留同文件 `:575–585`。 | 30 | 否 | 高 |
| C14 | 只为篡改 | `tests/runtime/R4b-session-operations.test.ts:144–160`；`fails closed when the original Kernel session.created record is damaged` | `:154–155` 将已正常生成的首记录正文改成 `{}`。 | `delete` | 不再要求此篡改专用行为：G4。正常创建、分页、跨工作区检查保留同文件 `:71–142`。 | 17 | 否 | 高 |
| C15 | 只为篡改 | `tests/runtime/R4b-session-recovery.test.ts:204–220`；`rejects missing original Kernel history without returning an empty success page` | `:214–215` 直接删除正常 Session 的第一条记录；这是删库内记录，不是实际存储文件不可用。 | `delete` | 不再要求此篡改专用行为：G4。实际文件缺失仍由 `tests/runtime/R4c-execution-history.test.ts:330–332` 覆盖并保留。 | 17 | 否 | 高 |
| C16 | 只为篡改 | `tests/runtime/R4c-execution-history.test.ts:322–328`；`passes the original boundary through…` 中的 SQL 损坏段 | 仅此段 UPDATE 首记录为 `{}`。同一测试还测原边界、跨工作区、文件缺失、not_ready，这些不能一起删。 | `delete`；仅删所列 7 行 | 不再要求此篡改专用行为：G4；同测试 `:308–320,330–341` 保留。 | 7 | 否 | 高 |
| C17 | 只为篡改 | `tests/runtime/R4c-graph-history.test.ts:897–904,907–938`；空终页用例后半、`rejects continuation after the frozen Session tail is truncated…` | 两处均直接 DELETE 已冻结的尾记录。第一个测试的正常空终页断言 `:867–895` 有独立价值。 | `delete`；保留正常空终页部分 | 不再要求删尾记录后的防御行为：G4；正常增长期间冻结上界由同文件 `:400` 用例覆盖，空终页 `:894–895` 保留。 | 40 | 否 | 高 |
| C18 | 只为篡改 | `tests/runtime/R4c-kernel-history-range.test.ts:420–586,594–598`；范围外损坏、坏尾键、坏正文、缺口、键/正文矛盾、损坏后的 append/replay | 八项测试通过 SQL 修改正文、位置或 Session 键、删除记录；另隔离测试有 5 行损坏注入。保留范围读取、快照、分页和正常隔离断言；不删除存储公开 `create/append` 夹具。 | `delete`；仅上述损坏场景及注入段 | 不再要求篡改专用行为：G4。正常 range/read 检查在同文件 `:247–418`，隔离 `:600–608`，重开一致性 `:611–624`。 | 172 | 否 | 中 |
| C19 | 只为篡改 | `tests/runtime/R4c-source-authority-guards.test.ts:264–304`；`rejects unreadable consumed envelope identity from a real stored Run…` | `:277–281` 把只有 permissions、缺身份的 envelope 直写为 running Run；当前 claim/prepare/start 不生成此组合。 | `delete` | 不再要求此篡改专用行为：G4。正常 starting/running 权限链保留同文件 `:321–394`，按 C28 转换。 | 41 | 否 | 高 |
| C20 | 只为篡改 | `tests/runtime/R4c-source-authority-guards.test.ts:383–388`；`uses real SQLite facts through both readers…` 的“revocation”段 | 通过 `seedRun` 原地改已接受 envelope 的 tools；这不是当前 Host 撤权，也不是公开运行中 Role 生命周期。 | `delete`；仅删该段 | 不再要求此数据库改写行为：G4。当前 Host 权限变化测试保留 `tests/runtime/B2-runtime-execution.test.ts:416–447`；不将两种行为混称同一覆盖。 | 6 | 否 | 高 |
| C21 | 手写事实 | `tests/runtime/R4b-session-input-boundaries.test.ts:45–54`；`open()` | 手造 Project/Workspace、`TrustedScopeSeeded`，直接 commit。P0 已存在。 | `convert:projects.createProject → projects.registerWorkspace` | 原文件两项边界测试保留；公开步骤实例 `tests/helpers/S4A-note-fixture.ts:178–181`。 | 10 | 否 | 高 |
| C22 | 手写事实 | `tests/runtime/R4b-session-operations.test.ts:50–60`；`open()` | 同样手写注册事实和专用事件；不必删除 Session 行为测试。 | `convert:projects.createProject → projects.registerWorkspace` | 原文件 `:71–142` 用例保留；P0。 | 11 | 否 | 高 |
| C23 | 手写事实 | `tests/runtime/R4b-session-recovery.test.ts:51–61`；`open()` | 同样绕过注册 owner 写入 Project/Workspace。 | `convert:projects.createProject → projects.registerWorkspace` | 原文件 `:72–202` 恢复与游标用例保留；P0。 | 11 | 否 | 高 |
| C24 | 手写事实 | `tests/runtime/R4c-execution-history.test.ts:52–62`；`open()` | encode 注册快照、手写事件后 `backend.records.commit`。 | `convert:projects.createProject → projects.registerWorkspace` | 原文件执行历史用例保留；P0。 | 11 | 否 | 高 |
| C25 | 手写事实 | `tests/runtime/R4b-session-input-boundaries.test.ts:119–120`；`rejects history limit outside 1..200 and a continuation cursor from another principal` | 测当前游标授权，却用旧 `buildRawTurn/rawInsertRecords` 写历史；被测行为不是旧格式兼容。 | `convert:runObservedModel`，通过 P2 生成当前 Turn | 原用例 `:106–133` 保留；当前写入实例 `tests/runtime/R4c-execution-history.test.ts:99–112`。 | 2 | 否 | 高 |
| C26 | 手写事实 | `tests/runtime/R4b-session-recovery.test.ts:184–185,192–193,197`；`binds raw history continuation to its original adapter, Session and upper record position` | 两次直插旧 Turn，且把第一轮尾位置写死为 6。应实际运行两轮，从公开历史结果取得第一轮边界。 | `convert:runObservedModel → readSessionHistory → runObservedModel → readSessionHistory` | 原用例 `:174–202` 保留；P2。 | 5 | 否 | 高 |
| C27 | 手写事实 | `tests/runtime/R4c-graph-history.test.ts:139–171`；`seedLinkedRun`，被 `:374,412,530,604,716` 调用 | 注释明确同一 Session 不能同时被领取两次；helper 却造第二个 starting Run、Attempt/outbox，并复用原 generation。**没有公开步骤生成该原样状态。** | `keep-note`；不声称能直接转换 | 原测试暂留待 lead 重定前提。合法“完成第一 Run 后续领第二 Run”实例是 `tests/runtime/B2-runtime-execution.test.ts:225–246`，不能冒充原双占用状态的等价生成器。 | 0 | 否 | 高 |
| C28 | 手写事实 | `tests/runtime/R4c-source-authority-guards.test.ts:98–126,144–145,358–376`；合法 Work 前提及真实 SQLite 用例的 `seedRun` | `runningRun/validEnvelope` 手造成功事实；`:374–375` 承认没有 entry/authorization 迁移。合法 starting→running 可由 P1 生成。错误返回注入与不可生成的损坏组合另行保留判断，不承诺转换。 | `convert:claimTask → prepareExecution → startRun → 真实 Run/SourceAuthority reader` | 原合法授权用例保留；P1。 | 50 | 否 | 中 |
| C29 | 手写事实 | `tests/runtime/S3-graph-tools.test.ts:866–904`；`openInputFixture` 的注册及治理 seed | 手算并编码 CompletionPolicy、ArchitectureBaseline、活动指针及工作区事实。公开配置 owner 已存在，见 P0。 | `convert:createProject/registerWorkspace → installCompletionPolicy/activateCompletionPolicy → adoptInitialArchitecture` | 原 GT08/GT09/GT13 保留；`tests/helpers/S4A-note-fixture.ts:178–200` 有现成步骤。 | 39 | 是 | 高 |
| C30 | 手写事实 | `tests/runtime/S3-graph-tools.test.ts:832–839,967–983`；`fxRunSnapshot/commitRaw` | 为输入分页造 ended Run A、starting Run B；Run A 甚至 `startedAt/endedAt` 均为 null。可以实际完成 A、再公开领取 B。 | `convert:claimTask → prepareExecution/startRun 完成 A → claimTask 领取 B` | 原 GT08 `:490`、GT09 `:515`、GT13 `:604` 保留；P1。 | 25 | 是 | 高 |
| C31 | 手写事实 | `tests/runtime/S5-user-message-tools.test.ts:247–300`；`preparePumpRun`，服务 TU07 | 从 RA manifest 换 claim 得 RB manifest，手造 Prepared；随后用虚构 Kernel run/turn/position 调入口 owner。调用了 owner，并未使这些 Kernel 事实变真。 | `convert:runtime.prepareExecution → runtime.startRun`；在真实运行的受控接缝测试用户决定等待 | 原 `:400::TU07 keeps a user decision wait out of the real Session consultation consumer and pump` 保留；P1。 | 54 | 是 | 高 |
| C32 | 手写事实 | `tests/runtime/source-binding-migration.test.ts:78–109`；`workFixture` | 将手造 running Run/envelope 放进 Map，作为可信 source authority。合法 Work 绑定及正常结束可以由 P1 生成；原地改 envelope 的反例不能据此宣称可转换。 | `convert:claimTask → prepareExecution → startRun → 真实 SourceAuthority reader` | 原 `:112` Work 绑定、`:126` root/scope、`:152` 取消关闭用例保留；P1。 | 32 | 否 | 中 |
| C33 | 手写事实 | `tests/runtime/source-binding-migration.test.ts:190–218`；`queryFixture` | 手造 QueryJob、QueryRun 和 `QueryJobSubmitted`，直接 push 到伪历史。提交、领取、运行的公开路径已有 P3。计数可包裹真实历史 reader。 | `convert:submitQueryJob → createSession → claimQuery → prepareQuery/startQuery` | 原 `:221::resolves Query source authority from the original submission with one shared history scan` 保留；P3。 | 29 | 否 | 高 |
| C34 | 手写事实 | `tests/runtime/source-binding-migration.test.ts:164–188`；`limits a bound Reviewer to candidate source and rechecks the accepted ReviewWork` | `:174–178` 手造 ReviewWork 及关联 Run。查到契约、读取和校验，未找到当前能生成此 accepted ReviewWork 的公开提交步骤；不能用 UnknownCallReview 的 owner 替代另一种对象。 | `keep-note`；无已确认公开生成步骤，不转换 | 原测试暂留；读取校验在 `src/core/agent-runtime/source-capture-access.ts:409,499–501`。 | 0 | 否 | 中 |
| C35 | 手写事实 | `tests/runtime/K3-35-workspace-baseline-prepare.test.ts:84–117,165–166`；`executionRecord`、K3-35（四） | 虽打开真实 world，prepare 的 executions/roles 仍返回手造 Run、Session、Attempt、outbox、Role 事实。该测试的真实 2,001 文件输入应保留。 | `convert:公开配置/Session/claim → 真实 executions/roles reader → prepareExecution` | 原 `:189::K3-35 (四) prepare succeeds…` 保留；真实 review prepare 接线可参照 `tests/runtime/K3-review-preparation.test.ts:76–122`。 | 36 | 是 | 中 |
| C36 | 手写事实 | `tests/runtime/S3-context-assembler.test.ts:384–434,660–661`；`preparationHarness`、CA03/CA04/CA15 | reader 返回手造执行事实；CA04 在 `:661` 直接给 Run 填 inputBinding/envelope，注释称 entry 已绑定但没有执行 entry。P4 已实现真实绑定后重放。纯 renderer 输入不在转换范围。 | `convert:真实 claim/prepareExecution → startRun 入口提交后取消 → prepareExecution`；reader 计数改委托包装 | 原 CA03 `:646`、CA04 `:657`、CA15 `:854` 保留；`tests/runtime/S4C2-assembly.test.ts:275–322::C-03` 提供公开绑定实例。 | 53 | 是 | 高 |
| C37 | 手写事实 | `tests/runtime/S4C-note-run-task-resolver.test.ts:33–51`；`runJson/recordsReturning/RUN_RECORD`，服务 GTN20 | JSON 中 roleBinding/budget/workspaceSnapshot 为 `{}`，running 却无 entry/envelope；GTN20 的正常归属解析可从真实 claim 读取，并委托包装一次 readMany。 | `convert:claimTask → 真实 RecordStore 的委托 readMany → createNoteRunTaskResolver` | GTN20 `:54–62` 保留；真实工作 Run 的 related-find 路径见 `tests/runtime/S4C-note-related-find.test.ts:40–61`。GTN21 的损坏子例另见待定说明。 | 19 | 是 | 中 |
| C38 | 辅助 | `tests/kernel/R4a-legacy-fixtures.ts:18–29,52–214`；旧 checksum、旧 Turn 构造和 raw writer | 全 `tests/` 引用检索仅找到 `R4a-frozen-public.test.ts:19`、`R4b-session-input-boundaries.test.ts:6`、`R4b-session-recovery.test.ts:8`。**目前仍被使用**；C01/C13 删除、C25/C26 转换后，旧 writer 才失去用途。 | `delete`；以前述四项完成为前提。保留 `TempWorkspace/createTempWorkspace` 的 `:31–50` | 旧格式行为由 D79 取消；当前历史生成由 C25/C26 改走 P2。 | 175 | 否 | 高 |
| C39 | 过时候选 | `tests/runtime/source-tool-lifecycle.test.ts:226–258,304–322`；legacy language services、disposal failure、search prefix 三项 | 显式使用 `legacy_live`。生产接口注释 `src/core/agent-runtime/observed-model-run.ts:79–88` 明说保留旧调用方兼容语义；但本次未证明所有现行调用方都已切换，生命周期和路径行为本身仍需要。 | `keep-note`；待生产区确认旧模式去留后同步处理，不直接删三项业务断言 | 尚无完整等价覆盖证明；同文件 `:215–224,260–301` 的 frozen 模式只覆盖部分生命周期。 | 0 | 否 | 中 |

**同一清单的 JSON**

```json
[
  {
    "id": "C01",
    "category": "stale",
    "file": "tests/kernel/R4a-frozen-public.test.ts",
    "lines": ["423-437", "627-649"],
    "tests": [
      "reads a legacy schemaVersion=1 Turn without new constraint fields or rewriting its checksum",
      "still accepts a legacy checkpoint without recovery constraints"
    ],
    "evidence": "423-437 经 buildRawTurn/rawInsertRecords 验证旧 Turn；636-640 删除 checkpoint.recoveryConstraints 并重算 checksum。docs/refactor/HANDOFF.md:565-570 已取消开发旧格式兼容义务；不能仅凭缺少 contextBasis 判旧。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-570。当前恢复保留 tests/kernel/R4a-frozen-public.test.ts:245::resumes the same paused Turn with unchanged limits and denied paths and preserves durable pause evidence，以及 :575::resumes with preserved usage when only its SQLite files changed inside a strict workspace。",
    "est_lines": 38,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C02",
    "category": "stale",
    "file": "tests/runtime/A2-reconcile-runtime.test.ts",
    "lines": ["521-602"],
    "tests": [
      "seedPreD7Intent",
      "A8-1d (W-04, CI-01, CI-02, CTL-08(a), RUN-09..11 (R)): a Run that never entered still holds a pre-D-7 queued intent at the restart; a cancel ends it and releases the claim, a pause is applied in place, a resume waits while the Goal is paused"
    ],
    "evidence": "522-525 明说当前 writer 不产生此状态；538-540 直写 queued intent/Run 指针。src/core/work-graph/state/control-intent-machine.ts:484-505 的 D7 要求未进入 Run 的 pause/cancel/resume 当次应用。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-570 与现行 D7。tests/scenarios/A7-control.test.ts:110-175::D-7: controls on a claimed Run apply at once and a cancel ends the Run and its claim in one commit。A2-reconcile-runtime.test.ts:232-273 的 W-05 保留。",
    "est_lines": 82,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C03",
    "category": "stale",
    "file": "tests/runtime/R4b-session-skeleton.test.ts",
    "lines": ["54-64"],
    "tests": [
      "requires an explicit trusted legacy locator and matching original Kernel Session ID"
    ],
    "evidence": "56-63 专测 legacyEntries/legacy/withLegacyReader；旧 per-Run 库用途见 docs/refactor/tasks/R4b-next-session-skeleton.md:9,23。应与生产旧定位路径同步清理。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-570。当前注册库隔离保留 tests/runtime/R4b-session-skeleton.test.ts:66-81::keeps identical Kernel Session IDs in separate registered databases distinct。",
    "est_lines": 11,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C04",
    "category": "stale",
    "file": "tests/runtime/S1-archive-files-brief.test.ts",
    "lines": ["204-228", "248-253"],
    "tests": [
      "IT04 loading a frozen old manifest keeps the exact marker, digest and text with no new section",
      "OLD_DIGEST/OLD_MARKER/OLD_TEXT/OLD_INPUT/OLD_MANIFEST_JSON"
    ],
    "evidence": "207 写入 pre-S1 manifest；219-227 要求缺 anomalies 的旧正文、marker、digest 原样保留。原冻结行是 docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md:1025，旧格式义务被决定 79-1 取消。",
    "action": "delete",
    "covered_by": "行为已不存在：docs/refactor/HANDOFF.md:565-570。当前重放保留 tests/runtime/S1-archive-files-brief.test.ts:189-202::IT03 repeated prepare keeps r0 anchor refs and the saved digest with one capture；IT05 亦保留。",
    "est_lines": 31,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C05",
    "category": "duplicate",
    "file": "tests/kernel/R4a-frozen-public.test.ts",
    "lines": ["396-404"],
    "tests": [
      "a paused Turn cannot resume with a larger model budget after restart"
    ],
    "evidence": "与同文件 192-212 都是暂停预算 1、恢复预算 4，断言 conflict、零模型请求、记录不变；192-212 还明确检查暂停前请求数。",
    "action": "delete",
    "covered_by": "tests/kernel/R4a-frozen-public.test.ts:192-212::rejects a paused recovery that raises the persisted model-request budget before any model call",
    "est_lines": 9,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C06",
    "category": "duplicate",
    "file": "tests/kernel/R4a-frozen-public.test.ts",
    "lines": ["213-244"],
    "tests": [
      "does not expose a previously denied path when paused recovery omits workspace options"
    ],
    "evidence": "与 406-421 同测恢复省略 denied prefix 时不泄漏私有文件。合并须保留 238 的结果数量断言，以及 414、419 的成功终态和拒绝后记录不变断言。",
    "action": "merge-into:tests/kernel/R4a-frozen-public.test.ts::a paused Turn does not lose an explicit denied prefix when the resume call omits it",
    "covered_by": "tests/kernel/R4a-frozen-public.test.ts:406-421::a paused Turn does not lose an explicit denied prefix when the resume call omits it",
    "est_lines": 32,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C07",
    "category": "duplicate",
    "file": "tests/runtime/B2-04-allowance.test.ts",
    "lines": ["72-85"],
    "tests": [
      "B2-04: a failed consumeAllowance commit blocks the call and keeps the allowance allowed"
    ],
    "evidence": "tests/runtime/B2-09-allowance-crash.test.ts:52-57 已断言相同失败提交、固定阻断文字和 allowed/revision 2/usedAt null，并增加 usedBy null、60-62 重试成功。保留规格行映射和两个后端。",
    "action": "merge-into:tests/runtime/B2-09-allowance-crash.test.ts::B2-09a",
    "covered_by": "tests/runtime/B2-09-allowance-crash.test.ts:41-63::B2-09a: a rejected consumeAllowance commit blocks the call, keeps allowed, then the retry runs",
    "est_lines": 14,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C08",
    "category": "duplicate",
    "file": "tests/runtime/B2-09-allowance-crash.test.ts",
    "lines": ["65-92"],
    "tests": [
      "B2-09b (owner part): the committed consume leaves the request used with usedBy, and the same command is blocked again"
    ],
    "evidence": "与 tests/runtime/B2-04-allowance.test.ts:41-70 同测一次额度、usedBy 和再次阻断。须迁移本项 82、84、90-91 的 usedAt、数量、理由和 revision 断言；真实 crash 场景不在删除范围。",
    "action": "merge-into:tests/runtime/B2-04-allowance.test.ts::B2-04: allow_rerun lets exactly the card form run once, records usedBy, then blocks again",
    "covered_by": "tests/runtime/B2-04-allowance.test.ts:41-70::B2-04: allow_rerun lets exactly the card form run once, records usedBy, then blocks again；保留 tests/scenarios/B2-09b-allowance-crash.test.ts。",
    "est_lines": 28,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C09",
    "category": "duplicate",
    "file": "tests/runtime/C1-communication-tools.test.ts",
    "lines": ["115-120", "187-196"],
    "tests": [
      "publishes exactly the six fixed names and matching definitions",
      "declares read_only for reads and a real platform side effect for writes"
    ],
    "evidence": "tests/runtime/C2-runtime-platform-tools.test.ts:82-94 已检查相同工具名称和 effectClass，另检查 requiredCapabilities、independentReadOnly。C1 真实收发闭环不动。",
    "action": "delete",
    "covered_by": "tests/runtime/C2-runtime-platform-tools.test.ts:70-99::publishes the six frozen mailbox names and the workspace_read read-only registration label",
    "est_lines": 16,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C10",
    "category": "duplicate",
    "file": "tests/runtime/K3-12-review-round-tools.test.ts",
    "lines": ["129-149"],
    "tests": [
      "(%s) K3-12 prepares a review-purpose Run with exactly the L13 tools and an empty write scope"
    ],
    "evidence": "与 tests/runtime/K3-review-preparation.test.ts:168-212 使用真实 review world/claim/prepare，重复断言 L13 tools 和空 writeScope。须迁移本项 141-145 的 envelope 与 instruction 断言；memory/sqlite 均保留。",
    "action": "merge-into:tests/runtime/K3-review-preparation.test.ts::K3-L13-5",
    "covered_by": "tests/runtime/K3-review-preparation.test.ts:168-212::(%s) K3-L13-5 prepares with the L13 tools, empty write scope, sessionBasis and the review section",
    "est_lines": 21,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C11",
    "category": "duplicate",
    "file": "tests/runtime/K3-19-review-admission-pure.test.ts",
    "lines": ["1-122"],
    "tests": [
      "reviewRoundAdmissionProblem: real review/proposal facts (positive half)",
      "reviewRoundAdmissionProblem: combinations the real path cannot produce"
    ],
    "evidence": "47-53、65-81、89-93、101-121 的十项与 tests/contracts/review-admission.test.ts:80-177 重叠。57-63 普通 manifest、83-87 proposal 缺工具、95-99 proposal 多工具三项须迁入保留表；保持纯规则测试。",
    "action": "merge-into:tests/contracts/review-admission.test.ts::reviewRoundAdmissionProblem",
    "covered_by": "tests/contracts/review-admission.test.ts:80-177::reviewRoundAdmissionProblem，加迁入三项独有输入；按 K3 U5/R4/L13/L20 保护。",
    "est_lines": 122,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C12",
    "category": "duplicate",
    "file": "tests/runtime/S4C-note-tools.test.ts",
    "lines": ["265-313"],
    "tests": [
      "RW-14 write: maps the model args to the writeNote request with the trusted commandId and defaults",
      "RW-14 write: an understanding carries sections and no body; absent lists default to empty",
      "RW-14 review: maps verdict/resolution/defaults with the trusted commandId",
      "RW-14 withdraw: maps the withdrawNote request with the trusted commandId"
    ],
    "evidence": "相同字段映射经 handler 在 GTN02:133-141、GTN03:158-160、GTN06:193-200 已检查。RW-14 独有 facts/空列表/null/default/strict shape 必须迁移，不能直接删掉。",
    "action": "merge-into:tests/runtime/S4C-note-tools.test.ts::GTN02/GTN03/GTN06",
    "covered_by": "tests/runtime/S4C-note-tools.test.ts:123-202::GTN02、GTN03、GTN06，加保留的默认值子例。",
    "est_lines": 49,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C13",
    "category": "tamper",
    "file": "tests/kernel/R4a-frozen-public.test.ts",
    "lines": ["596-625"],
    "tests": [
      "ignores a checksum-valid checkpoint with unsupported recovery constraint version and replays Session events"
    ],
    "evidence": "609-616 把当前 checkpoint 的 recoveryConstraints.version 改为 2，重算 checksum，再 SQL UPDATE；没有实际外部输入路径。",
    "action": "delete",
    "covered_by": "不再要求此篡改专用行为：AGENTS.md:33。正常恢复保留 tests/kernel/R4a-frozen-public.test.ts:575-585::resumes with preserved usage when only its SQLite files changed inside a strict workspace。",
    "est_lines": 30,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C14",
    "category": "tamper",
    "file": "tests/runtime/R4b-session-operations.test.ts",
    "lines": ["144-160"],
    "tests": [
      "fails closed when the original Kernel session.created record is damaged"
    ],
    "evidence": "154-155 将已正常生成的 session.created 正文直接 UPDATE 为 {}。",
    "action": "delete",
    "covered_by": "不再要求此篡改专用行为：AGENTS.md:33。tests/runtime/R4b-session-operations.test.ts:71-142 的正常创建、分页、重试和跨工作区用例保留。",
    "est_lines": 17,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C15",
    "category": "tamper",
    "file": "tests/runtime/R4b-session-recovery.test.ts",
    "lines": ["204-220"],
    "tests": [
      "rejects missing original Kernel history without returning an empty success page"
    ],
    "evidence": "214-215 直接 DELETE 已创建 Session 的第一条记录，区别于真实存储文件缺失。",
    "action": "delete",
    "covered_by": "不再要求此篡改专用行为：AGENTS.md:33。真实文件缺失保留 tests/runtime/R4c-execution-history.test.ts:330-332::passes the original boundary through and propagates owner rejections instead of an empty page。",
    "est_lines": 17,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C16",
    "category": "tamper",
    "file": "tests/runtime/R4c-execution-history.test.ts",
    "lines": ["322-328"],
    "tests": [
      "passes the original boundary through and propagates owner rejections instead of an empty page"
    ],
    "evidence": "仅 322-328 将首记录 UPDATE 为 {} 并检查 unavailable；同测试其他段验证正常边界、跨工作区、文件缺失和 not_ready。",
    "action": "delete",
    "covered_by": "不再要求此篡改专用行为：AGENTS.md:33。原测试 308-320、330-341 保留。",
    "est_lines": 7,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C17",
    "category": "tamper",
    "file": "tests/runtime/R4c-graph-history.test.ts",
    "lines": ["897-904", "907-938"],
    "tests": [
      "preserves an empty terminal page at the real upper cursor while still detecting a truncated source",
      "rejects continuation after the frozen Session tail is truncated instead of shrinking its range"
    ],
    "evidence": "899-900、931-932 直接 DELETE 冻结范围的尾记录。第一项 867-895 的正常空终页部分不能一起删。",
    "action": "delete",
    "covered_by": "不再要求删库内尾记录后的防御行为：AGENTS.md:33。正常空终页保留同文件 894-895；增长时冻结上界保留 :400::keeps the frozen upper bound while the Session grows and never widens a continuation page。",
    "est_lines": 40,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C18",
    "category": "tamper",
    "file": "tests/runtime/R4c-kernel-history-range.test.ts",
    "lines": ["420-586", "594-598"],
    "tests": [
      "reads a back page even when a front record payload is damaged outside the range",
      "still reports the tail position when the tail payload is damaged outside the range",
      "rejects a %s tail key as corrupt and cleans up the read snapshot",
      "rejects damaged, schema-invalid and checksum-invalid records inside the requested page",
      "rejects a gap in the middle of the requested range",
      "rejects a database position that contradicts the record payload position",
      "rejects a database Session key that contradicts the record payload Session",
      "keeps append/replay full-history validation after a reopen even though read is ranged",
      "isolates Sessions so damage and tails never leak across them（仅损坏注入段）"
    ],
    "evidence": "426、442、462、490-506、525、540-542、561、577、596 的 SQL 修改正文、主键或删除记录。保留正常范围读取、快照、分页、Session 隔离及公开 create/append 夹具。",
    "action": "delete",
    "covered_by": "不再要求此篡改专用行为：AGENTS.md:33。正常 range/read 在同文件 247-418；隔离断言 600-608；:611-624::returns the same page and tail after reopening the database。",
    "est_lines": 172,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C19",
    "category": "tamper",
    "file": "tests/runtime/R4c-source-authority-guards.test.ts",
    "lines": ["264-304"],
    "tests": [
      "rejects unreadable consumed envelope identity from a real stored Run without throwing or file I/O"
    ],
    "evidence": "277-281 将仅含 permissions、缺身份的 envelope 直写成 running Run；正常 claim/prepare/start 不生成该组合。",
    "action": "delete",
    "covered_by": "不再要求此篡改专用行为：AGENTS.md:33。正常 starting/running 授权链保留同文件 321-394，并按 C28 转换前提。",
    "est_lines": 41,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C20",
    "category": "tamper",
    "file": "tests/runtime/R4c-source-authority-guards.test.ts",
    "lines": ["383-388"],
    "tests": [
      "uses real SQLite facts through both readers: a starting claim is denied, a trusted running seed can read, and revocation is fresh（仅改写 envelope 的段落）"
    ],
    "evidence": "383-384 通过 seedRun 原地清空已经接受的 envelope.permissions.tools；不是当前 Host 撤权，也没有公开运行中 Role 热切换路径。",
    "action": "delete",
    "covered_by": "不再要求此数据库改写行为：AGENTS.md:33。当前 Host 权限变化用例 tests/runtime/B2-runtime-execution.test.ts:416-447 保留，但不声称与改写 envelope 是同一行为。",
    "est_lines": 6,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C21",
    "category": "handwritten",
    "file": "tests/runtime/R4b-session-input-boundaries.test.ts",
    "lines": ["45-54"],
    "tests": [
      "open()：文件内两项输入及游标边界用例"
    ],
    "evidence": "手造 Project/Workspace、TrustedScopeSeeded 后 commit。公开接口已存在于 src/core/work-graph/configuration/project-bootstrap-contracts.ts:38-45。",
    "action": "convert:projects.createProject → projects.registerWorkspace",
    "covered_by": "原测试保留；公开步骤实例 tests/helpers/S4A-note-fixture.ts:178-181。",
    "est_lines": 10,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C22",
    "category": "handwritten",
    "file": "tests/runtime/R4b-session-operations.test.ts",
    "lines": ["50-60"],
    "tests": [
      "open()：Session 创建、分页、重试及 scope 用例"
    ],
    "evidence": "手写注册快照和 TrustedScopeSeeded，再直接 backend.records.commit；当前公开注册 owner 已存在。",
    "action": "convert:projects.createProject → projects.registerWorkspace",
    "covered_by": "原文件 71-142 用例保留；公开步骤实例 tests/helpers/S4A-note-fixture.ts:178-181。",
    "est_lines": 11,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C23",
    "category": "handwritten",
    "file": "tests/runtime/R4b-session-recovery.test.ts",
    "lines": ["51-61"],
    "tests": [
      "open()：恢复和游标用例"
    ],
    "evidence": "直接编码 Project/Workspace 并写入专用 seed 事件；当前公开注册 owner 已存在。",
    "action": "convert:projects.createProject → projects.registerWorkspace",
    "covered_by": "原文件 72-202 用例保留；公开步骤实例 tests/helpers/S4A-note-fixture.ts:178-181。",
    "est_lines": 11,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C24",
    "category": "handwritten",
    "file": "tests/runtime/R4c-execution-history.test.ts",
    "lines": ["52-62"],
    "tests": [
      "open()：执行历史读取用例"
    ],
    "evidence": "encodeProjectSnapshot/encodeWorkspaceSnapshot 加手写事件后 commit；当前公开注册接口能生成所需事实。",
    "action": "convert:projects.createProject → projects.registerWorkspace",
    "covered_by": "原执行历史测试保留；公开步骤实例 tests/helpers/S4A-note-fixture.ts:178-181。",
    "est_lines": 11,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C25",
    "category": "handwritten",
    "file": "tests/runtime/R4b-session-input-boundaries.test.ts",
    "lines": ["119-120"],
    "tests": [
      "rejects history limit outside 1..200 and a continuation cursor from another principal"
    ],
    "evidence": "当前游标授权测试使用旧 buildRawTurn/rawInsertRecords；被测业务仍有效，不能随旧 writer 删除。",
    "action": "convert:runObservedModel",
    "covered_by": "原 tests/runtime/R4b-session-input-boundaries.test.ts:106-133 用例保留；现成当前写入封装 tests/runtime/R4c-execution-history.test.ts:99-112::runTurn。",
    "est_lines": 2,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C26",
    "category": "handwritten",
    "file": "tests/runtime/R4b-session-recovery.test.ts",
    "lines": ["184-185", "192-193", "197"],
    "tests": [
      "binds raw history continuation to its original adapter, Session and upper record position"
    ],
    "evidence": "两次直插旧 Turn，并将第一轮上界写死为 6。当前公开 runner 能产生两轮历史；边界应从第一轮公开历史结果取得。",
    "action": "convert:runObservedModel → readSessionHistory → runObservedModel → readSessionHistory",
    "covered_by": "原 tests/runtime/R4b-session-recovery.test.ts:174-202 用例保留；当前写入实例 tests/runtime/R4c-execution-history.test.ts:99-112::runTurn。",
    "est_lines": 5,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C27",
    "category": "handwritten",
    "file": "tests/runtime/R4c-graph-history.test.ts",
    "lines": ["139-171"],
    "tests": [
      "seedLinkedRun；调用位置 374、412、530、604、716"
    ],
    "evidence": "140-144 承认 claim loop 不能产生同一 Session 双占用；147、153-168 仍手写第二个 starting Run、Attempt/outbox 并复用原 generation。不存在生成原样状态的公开步骤。",
    "action": "keep-note",
    "covered_by": "原用例暂留，待 lead 重定前提。tests/runtime/B2-runtime-execution.test.ts:225-246::continues the same Session for a second Task using the real completed history boundary 是合法顺序流程，但不是原双占用状态的公开生成器。",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C28",
    "category": "handwritten",
    "file": "tests/runtime/R4c-source-authority-guards.test.ts",
    "lines": ["98-126", "144-145", "358-376"],
    "tests": [
      "validEnvelope/runningRun/factsWithRun 的合法 Work 前提",
      "uses real SQLite facts through both readers: a starting claim is denied, a trusted running seed can read, and revocation is fresh（正常 starting/running 部分）"
    ],
    "evidence": "手造 running Run/envelope；374-375 明说没有执行 entry、authorization 或 claim-to-running 迁移。正常状态可通过现有 Runtime 产生；错误返回注入和损坏组合不纳入转换承诺。",
    "action": "convert:claimTask → prepareExecution → startRun → 真实 Run/SourceAuthority reader",
    "covered_by": "原合法授权用例保留；公开流程实例 tests/runtime/B2-runtime-execution.test.ts:225-246。",
    "est_lines": 50,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C29",
    "category": "handwritten",
    "file": "tests/runtime/S3-graph-tools.test.ts",
    "lines": ["866-904"],
    "tests": [
      "openInputFixture：GT08、GT09、GT13"
    ],
    "evidence": "手算并编码 CompletionPolicyRevision、ArchitectureBaselineRevision、活动指针及 Project/Workspace；已有公开配置步骤见 tests/helpers/S4A-note-fixture.ts:178-200。",
    "action": "convert:createProject/registerWorkspace → installCompletionPolicy/activateCompletionPolicy → adoptInitialArchitecture",
    "covered_by": "原 GT08、GT09、GT13 保留；tests/helpers/S4A-note-fixture.ts:178-200 提供实际公开调用。",
    "est_lines": 39,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C30",
    "category": "handwritten",
    "file": "tests/runtime/S3-graph-tools.test.ts",
    "lines": ["832-839", "967-983"],
    "tests": [
      "fxRunSnapshot/commitRaw：GT08、GT09、GT13"
    ],
    "evidence": "直写 ended Run A、starting Run B；结束的 A 仍有 null startedAt/endedAt。可公开完成 A，再公开领取 B。",
    "action": "convert:claimTask → prepareExecution/startRun 完成 A → claimTask 领取 B",
    "covered_by": "tests/runtime/S3-graph-tools.test.ts:490::GT08、:515::GT09、:604::GT13 原断言保留；公开顺序流程见 tests/runtime/B2-runtime-execution.test.ts:225-246。",
    "est_lines": 25,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C31",
    "category": "handwritten",
    "file": "tests/runtime/S5-user-message-tools.test.ts",
    "lines": ["247-300"],
    "tests": [
      "preparePumpRun",
      "TU07 keeps a user decision wait out of the real Session consultation consumer and pump"
    ],
    "evidence": "254-266 从 RA manifest 替换 claim 并手造 Prepared；286-297 向入口 owner 提交虚构 Kernel run/turn/position。调用 owner 没有生成真实 Kernel 历史。",
    "action": "convert:runtime.prepareExecution → runtime.startRun；在真实运行的受控接缝测试用户决定等待",
    "covered_by": "原 tests/runtime/S5-user-message-tools.test.ts:400::TU07 保留；公开 Runtime 流程实例 tests/runtime/B2-runtime-execution.test.ts:225-246。",
    "est_lines": 54,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C32",
    "category": "handwritten",
    "file": "tests/runtime/source-binding-migration.test.ts",
    "lines": ["78-109"],
    "tests": [
      "workFixture",
      "binds one accepted Work Run to real source bytes and isolates caller mutations",
      "refuses same-root workspace substitution and a changed registered root",
      "closes the owned tools and honors Host and call cancellation"
    ],
    "evidence": "83-97 将手造 envelope/running Run 放入 Map 作为可信 source authority。正常 Work 事实可公开生成；139-149 的原地改 envelope/授权反例不能自动视为可转换。",
    "action": "convert:claimTask → prepareExecution → startRun → 真实 SourceAuthority reader",
    "covered_by": "原文件 112、126、152 的业务用例保留；公开流程实例 tests/runtime/B2-runtime-execution.test.ts:225-246。",
    "est_lines": 32,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C33",
    "category": "handwritten",
    "file": "tests/runtime/source-binding-migration.test.ts",
    "lines": ["190-218"],
    "tests": [
      "queryFixture",
      "resolves Query source authority from the original submission with one shared history scan"
    ],
    "evidence": "201-214 手造 QueryJob、QueryRun、QueryJobSubmitted 并 push 到伪历史。已有公开提交/领取/运行流程；扫描次数可以委托包装真实 reader 统计。",
    "action": "convert:submitQueryJob → createSession → claimQuery → prepareQuery/startQuery",
    "covered_by": "原 tests/runtime/source-binding-migration.test.ts:221-230 用例保留；公开路径 tests/runtime/R5b-query-session-loop.test.ts:170-195。",
    "est_lines": 29,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C34",
    "category": "handwritten",
    "file": "tests/runtime/source-binding-migration.test.ts",
    "lines": ["164-188"],
    "tests": [
      "limits a bound Reviewer to candidate source and rechecks the accepted ReviewWork"
    ],
    "evidence": "174-178 手造 ReviewWork 及关联 Run。查到契约和 src/core/agent-runtime/source-capture-access.ts:409,499-501 的读取校验，未找到当前生成此 accepted ReviewWork 的公开提交步骤；UnknownCallReview 是不同对象。",
    "action": "keep-note",
    "covered_by": "原 tests/runtime/source-binding-migration.test.ts:164-188 用例暂留；没有已确认的公开生成路径，不提出转换。",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "C35",
    "category": "handwritten",
    "file": "tests/runtime/K3-35-workspace-baseline-prepare.test.ts",
    "lines": ["84-117", "165-166"],
    "tests": [
      "executionRecord",
      "(%s) K3-35 (四) prepare succeeds and records an unavailable too_many_changes baseline for a >2000-change workspace"
    ],
    "evidence": "executionRecord 手造 Run/Session/Attempt/outbox；165-166 的 executions/roles 返回构造事实。保留真实 2001 文件输入及 too_many_changes 断言。",
    "action": "convert:公开配置/Session/claim → 真实 executions/roles reader → prepareExecution",
    "covered_by": "原 tests/runtime/K3-35-workspace-baseline-prepare.test.ts:189 用例保留；真实 prepare 接线实例 tests/runtime/K3-review-preparation.test.ts:76-122。",
    "est_lines": 36,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C36",
    "category": "handwritten",
    "file": "tests/runtime/S3-context-assembler.test.ts",
    "lines": ["384-434", "660-661"],
    "tests": [
      "preparationHarness",
      "CA03 two unbound preparations of the same facts share bytes and ArtifactRefs",
      "CA04 a bound context ignores changed Goal/notes and never rereads graph or inputs",
      "CA15 a throwing extension reader rejects unavailable instead of an empty array"
    ],
    "evidence": "419 返回构造执行事实；661 直接向 Run 填入 inputBinding/envelope，未执行注释所说的 entry。真实绑定后重放已有 tests/runtime/S4C2-assembly.test.ts:275-322 的 C-03；纯 renderer 输入不改。",
    "action": "convert:真实 claim/prepareExecution → startRun 入口提交后取消 → prepareExecution；reader 计数改委托包装",
    "covered_by": "原 CA03/CA04/CA15 保留；tests/runtime/S4C2-assembly.test.ts:275-322::C-03 (%s) a publicly bound execution replays the saved input and never re-assembles 提供公开绑定实例。",
    "est_lines": 53,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "C37",
    "category": "handwritten",
    "file": "tests/runtime/S4C-note-run-task-resolver.test.ts",
    "lines": ["33-51"],
    "tests": [
      "runJson/recordsReturning/RUN_RECORD",
      "GTN20 resolves a work Run in one readMany and returns goalId/taskId/planRef"
    ],
    "evidence": "36-38 的 roleBinding/budget/workspaceSnapshot 为空对象，running 却无 entry/envelope。正常归属解析可使用真实 claim，再委托包装真实 RecordStore 保留一次 readMany 断言。",
    "action": "convert:claimTask → 真实 RecordStore 的委托 readMany → createNoteRunTaskResolver",
    "covered_by": "原 tests/runtime/S4C-note-run-task-resolver.test.ts:54-62::GTN20 保留；真实工作 Run 实例 tests/runtime/S4C-note-related-find.test.ts:40-61。GTN21 损坏子例不纳入转换承诺。",
    "est_lines": 19,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "C38",
    "category": "helper",
    "file": "tests/kernel/R4a-legacy-fixtures.ts",
    "lines": ["18-29", "52-214"],
    "tests": [
      "canonicalJson/checksum/computeSessionRecordChecksum",
      "FIXTURE_CONFIG/FIXTURE_WORKSPACE/makeSessionRecord/buildRawTurn/rawInsertRecords"
    ],
    "evidence": "全 tests 引用检索仅找到 tests/kernel/R4a-frozen-public.test.ts:19、tests/runtime/R4b-session-input-boundaries.test.ts:6、tests/runtime/R4b-session-recovery.test.ts:8。目前仍使用；仅在 C01/C13 删除及 C25/C26 转换后旧 writer 才无用途。31-50 的 TempWorkspace/createTempWorkspace 仍需保留。",
    "action": "delete",
    "covered_by": "前提：完成 C01、C13、C25、C26。旧格式义务由 docs/refactor/HANDOFF.md:565-570 取消；当前历史生成转用 tests/runtime/R4c-execution-history.test.ts:99-112::runTurn。",
    "est_lines": 175,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "C39",
    "category": "stale",
    "file": "tests/runtime/source-tool-lifecycle.test.ts",
    "lines": ["226-258", "304-322"],
    "tests": [
      "closes legacy language services once and refuses new handlers after the tool group closes",
      "reports actual index disposal failure, attempts the other index and keeps close idempotent",
      "classifies a file used as search prefix and still searches it through explicit paths"
    ],
    "evidence": "231、252、308 显式选择 legacy_live。src/core/agent-runtime/observed-model-run.ts:79-88 称此模式为旧调用方兼容语义；本次未证明全部当前调用方都已迁出。生命周期和搜索路径行为本身仍有价值。",
    "action": "keep-note",
    "covered_by": "尚无完整等价覆盖证明。tests/runtime/source-tool-lifecycle.test.ts:215-224、260-301 的 frozen 模式仅覆盖部分生命周期；待生产区确认旧模式去留。",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  }
]
```

**总计**

| 类别 | 项数 | 估计删除或改写行数 |
|---|---:|---:|
| 过时 `stale` | 5 | 162 |
| 重复 `duplicate` | 8 | 291 |
| 琐碎 `trivial` | 0 | 0 |
| 手写事实 `handwritten` | 17 | 387 |
| 只为篡改 `tamper` | 8 | 330 |
| 辅助 `helper` | 1 | 175 |
| **合计** | **39** | **1,345** |

按建议动作计：`delete` 15 项、`merge-into` 6 项、`convert` 15 项、`keep-note` 3 项。C38 的删除有明确前置依赖，不能先删共享夹具。

没有把 K3/RL 等冻结纯规则表归为“琐碎”。例如 `tests/runtime/K3-26-unknown-call-review-pure.test.ts:1–18` 明确区分实际串行 Kernel 无法产生的组合与纯输入规则；`tests/runtime/K3-34-tool-name-constants.test.ts:1–10` 则固定工具分类表。这些不因测试短或构造输入而删除。

**阅读覆盖**

逐行读完的 **26 个文件**：

```text
tests/kernel/R4a-legacy-fixtures.ts
tests/runtime/B2-04-allowance.test.ts
tests/runtime/B2-09-allowance-crash.test.ts
tests/runtime/C1-communication-tools.test.ts
tests/runtime/C2-runtime-platform-tools.test.ts
tests/runtime/K3-12-review-round-tools.test.ts
tests/runtime/K3-15-blocked-sentence-pure.test.ts
tests/runtime/K3-15-blocked-sentence.test.ts
tests/runtime/K3-18-requeue-confirmed-pure.test.ts
tests/runtime/K3-18-review-card-pure.test.ts
tests/runtime/K3-19-review-admission-pure.test.ts
tests/runtime/K3-26-unknown-call-review-codec-pure.test.ts
tests/runtime/K3-26-unknown-call-review-pure.test.ts
tests/runtime/K3-34-tool-name-constants.test.ts
tests/runtime/K3-35-T-by-hand.test.ts
tests/runtime/K3-35-workspace-baseline-prepare.test.ts
tests/runtime/R4b-session-input-boundaries.test.ts
tests/runtime/R4b-session-operations.test.ts
tests/runtime/R4b-session-recovery.test.ts
tests/runtime/R4b-session-skeleton.test.ts
tests/runtime/R4c-source-authority-guards.test.ts
tests/runtime/S4C-note-related-find.test.ts
tests/runtime/S4C-note-run-task-resolver.test.ts
tests/runtime/WP1-context-assembly.test.ts
tests/runtime/orchestration-boundaries.test.ts
tests/runtime/source-binding-migration.test.ts
```

定向略读的 **90 个文件**：逐文件检查测试名称、导入、相关断言和事实写入／兼容／篡改模式；候选进一步展开阅读。这里的“略读”也包括读了较大部分但没有逐行读完整个文件的情况。

```text
tests/kernel/B2-history-public-export.test.ts
tests/kernel/K-close-open-turn.test.ts
tests/kernel/K-interrupted-history.test.ts
tests/kernel/K-readonly-sandbox.test.ts
tests/kernel/R4-terminal-history.test.ts
tests/kernel/R4-tool-group-barrier.test.ts
tests/kernel/R4a-frozen-public.test.ts
tests/kernel/RL-01-02-caps-effect.test.ts
tests/kernel/RL-03-05-oom-pids.test.ts
tests/kernel/RL-06-11-stop.test.ts
tests/kernel/RL-12-15-conditions.test.ts
tests/kernel/RL-15c-gate-stream-error.test.ts
tests/kernel/RL-20-resource-cap-attribution.test.ts
tests/kernel/RL-22-settlement.test.ts
tests/runtime/A2-reconcile-runtime.test.ts
tests/runtime/B1-kernel-assembly.test.ts
tests/runtime/B2-01-shell-hook.test.ts
tests/runtime/B2-02-approved-method.test.ts
tests/runtime/B2-02-recognition-unified.test.ts
tests/runtime/B2-03-request-tool.test.ts
tests/runtime/B2-05-06-denial.test.ts
tests/runtime/B2-13-allow-one-form.test.ts
tests/runtime/B2-15-replay.test.ts
tests/runtime/B2-16-hook-closure.test.ts
tests/runtime/B2-16-hook-reads.test.ts
tests/runtime/B2-401-world.test.ts
tests/runtime/B2-runtime-execution.test.ts
tests/runtime/C3-brief-timeline.test.ts
tests/runtime/K-readonly-command.test.ts
tests/runtime/K3-06-mixed-kinds-pure.test.ts
tests/runtime/K3-14-record-unknown-call-review-tool.test.ts
tests/runtime/K3-15-blocked-omission.test.ts
tests/runtime/K3-15-disposition-effects-pure.test.ts
tests/runtime/K3-16-approved-method-lines.test.ts
tests/runtime/K3-16-proposal-input.test.ts
tests/runtime/K3-16-proposal-tool.test.ts
tests/runtime/K3-16-proposals-pure.test.ts
tests/runtime/K3-16-review-extremes-pure.test.ts
tests/runtime/K3-16-targets-pure.test.ts
tests/runtime/K3-19-review-admission.test.ts
tests/runtime/K3-19-review-capability.test.ts
tests/runtime/K3-24-unknown-outcome-stability.test.ts
tests/runtime/K3-35-approved-methods-brief.test.ts
tests/runtime/K3-35-manifest-trim-pure.test.ts
tests/runtime/K3-35-renderer-boundary-pure.test.ts
tests/runtime/K3-35-review-input-size.test.ts
tests/runtime/K3-40-ignored-at-capture.test.ts
tests/runtime/K3-40-workspace-change-capture.test.ts
tests/runtime/K3-48-2-proposal-budget-pure.test.ts
tests/runtime/K3-48-3-extremes-pure.test.ts
tests/runtime/K3-B3-cancellation-cancelled.test.ts
tests/runtime/K3-B3-newest-request-order.test.ts
tests/runtime/K3-B3-runtime-fail-closed.test.ts
tests/runtime/K3-continuation-review-note.test.ts
tests/runtime/K3-merge-cancel-propagation.test.ts
tests/runtime/K3-review-input-pure.test.ts
tests/runtime/K3-review-preparation.test.ts
tests/runtime/K3-unknown-call-review-section.test.ts
tests/runtime/R2e-git-source-loop.test.ts
tests/runtime/R4-control-runtime.test.ts
tests/runtime/R4c-execution-history.test.ts
tests/runtime/R4c-graph-history.test.ts
tests/runtime/R4c-kernel-history-range.test.ts
tests/runtime/R4c-session-continuity.test.ts
tests/runtime/R5b-query-session-loop.test.ts
tests/runtime/RL-30-shell-resource-caps.test.ts
tests/runtime/RL-31-readonly-resource-caps.test.ts
tests/runtime/RL-32-check-resource-caps.test.ts
tests/runtime/RL-35-36-sandbox-and-retry.test.ts
tests/runtime/S1-archive-cancelled-reader.test.ts
tests/runtime/S1-archive-files-brief.test.ts
tests/runtime/S1-routed-replies.test.ts
tests/runtime/S2B-15-end-retry-activity.test.ts
tests/runtime/S2B-36-observer-cancel-reread.test.ts
tests/runtime/S2B-37-observer-reread-failure.test.ts
tests/runtime/S2B-38-run08-unknown-activity.test.ts
tests/runtime/S2B-44-backfill-late-evidence-race.test.ts
tests/runtime/S2B-45-inprocess-run21-activity.test.ts
tests/runtime/S2B-r2-run08-current-revision.test.ts
tests/runtime/S2B-tally.test.ts
tests/runtime/S3-context-assembler.test.ts
tests/runtime/S3-graph-tools.test.ts
tests/runtime/S4C-note-tools.test.ts
tests/runtime/S4C2-assembly.test.ts
tests/runtime/S5-user-message-tools.test.ts
tests/runtime/S5R2-agent-application.test.ts
tests/runtime/W2-role-skills.test.ts
tests/runtime/W2-whiteboard-tools.test.ts
tests/runtime/source-text-loop-migration.test.ts
tests/runtime/source-tool-lifecycle.test.ts
```

跨区检索覆盖整个 `tests/` 树，重点查了相同 owner、工具、规则函数、拒绝码和夹具引用；`rg` 不可用后使用只读 Node 文本扫描。跨区命中用于证明覆盖或公开步骤，未扩展成其他区域的完整盘点。

**尚未定下的边界**

- **原样不可生成的事实**：C27 的同 Session 双占用、C34 的 accepted ReviewWork 没有已确认的公开生成路径，均暂留。不能把“存在一个相近业务流程”写成“当前夹具状态可公开生成”。
- **伪 reader 的坏事实是否仍作为契约输入保留**：`tests/runtime/R4c-source-authority-guards.test.ts:178–220` 的损坏 permissions、`tests/runtime/source-binding-migration.test.ts:139–149,186–187,232–239` 的已接受事实改写，以及 `tests/runtime/S4C-note-run-task-resolver.test.ts:69–71` 的坏 JSON，未实际篡改真实数据库。本次没有把它们自动并入 SQL 篡改删除项，也没有声称有公开步骤产生这些状态。
- **CA04 的 Goal 变更前提**：`tests/runtime/S3-context-assembler.test.ts:663–672` 直接替换 Goal objective 和注记投影。C36 已确认的是公开绑定与重放路径；注记有公开写入示例，尚未确认可原样修改已接受 Goal objective 的公开步骤，因此这部分不列入转换承诺。
- **旧模式生产依赖**：C39 需与生产区盘点对齐。文件名含 `migration`、角色名含 `legacy_template`，都不足以判过时；后者明确仍在使用，见 `docs/refactor/HANDOFF.md:597`。
- **既有 T 待办不混进删除清单**：`tests/kernel/RL-12-15-conditions.test.ts:360,403` 的 RL-15b 时间下界问题已由 `docs/refactor/STATUS.md:349` 转入 T，本次未运行计时、未提出未经验证的新阈值。N0 的 Workflow 目标输入去留按 `docs/refactor/HANDOFF.md:683` 交生产区核对，未仅凭测试里的 legacy 输入名称删用例。
- **双后端继续保留**：所有合并、转换建议都保留原有 memory/sqlite 范围；决定 85-4 已明确两后端行为不能等同，见 `docs/refactor/HANDOFF.md:683`。