未完成你要求的“每一处”枚举，因此这份结果**不能作为 v2 的冻结清单**。下面是已经核实的子集；末行按 JSON 条目计数，不是整棵树的总数。冻结前必须完成枚举，依据是 `.lead-ref/books/test-rule-sheet-v1.md:14`、`.lead-ref/books/test-rule-sheet-v1.md:15`。

本次只读检查没有修改文件、运行测试或构建、执行 git 写操作或访问网络。

1．A1：计划提案输入

`plans/propose` 的 `request` 直接采用绑定方法的第二参数类型，并非另外一种更宽的 HTTP 草稿：`src/app/core-http-types.ts:289`、`src/app/core-http-types.ts:293`、`src/app/core-http-types.ts:329`。其中 `draft: PlanRevisionDraft` 就是公开请求字段：`src/core/work-graph/model/plan-contracts.ts:38`。因此，类型名字带 `Draft` 本身不能构成 F1。

| 位置 | 值及来源 | 后续是否只走公开步骤 | 请求形状 | 判定 |
|---|---|---|---|---|
| `tests/helpers/task-claim-fixture.ts:343` | 手写初始计划定义，连同 `goalRef`、`basedOn`、理由提交 | 提案后调用公开 apply：`tests/helpers/task-claim-fixture.ts:349`。夹具另有直写，见第3节 | 与路由的 `request` 同形；外层 HTTP `scope` 不属于 owner 参数 | v2 允许这一笔输入 |
| `tests/business/K3-46-review-advance-failures.test.ts:143` | 从公开任务图读取计划，再重排任务；读取在 `tests/business/K3-46-review-advance-failures.test.ts:128`，组装在 `tests/business/K3-46-review-advance-failures.test.ts:133` | 是，随后公开 apply：`tests/business/K3-46-review-advance-failures.test.ts:149` | 与路由的 `request` 同形 | v2 允许 |
| `tests/helpers/S5R2-a-support.ts:82` | 从记录仓库解码活动计划，再投影为新的计划定义；来源在 `tests/helpers/S5R2-a-support.ts:66`、`tests/helpers/S5R2-a-support.ts:68` | 否。后续采用仍从仓库取得 pin，并直接读仓库断言：`tests/helpers/S5R2-a-support.ts:97`、`tests/helpers/S5R2-a-support.ts:105` | 提交的是公开 `PlanRevisionDraft`，不是整个 `PlanRevisionSnapshot` | v2 允许这一笔输入；不能据此放行整条测试链 |
| `tests/runtime/S5R2-agent-application.test.ts:143` | `propose_future_plan` 的计划定义、理由和 expected pins | 提案后经公开 owner 读取：`tests/runtime/S5R2-agent-application.test.ts:155` | 工具参数形状；工具负责补足 owner 请求上下文，不能称为更窄的内部草稿 | v2 允许 |

2．A1：其他公开输入

| 位置 | 值及来源 | 后续是否只走公开步骤 | 请求形状 | 判定 |
|---|---|---|---|---|
| `tests/helpers/S4A-note-fixture.ts:282` | 调用者提供的注记正文，包装为 `commandId/note/expectedPointerRevision/goalId` | 此 helper 调用真实 note owner 后返回；没有替造写入结果：`tests/helpers/S4A-note-fixture.ts:281` | note owner 的公开参数形状；HTTP 另有人类调用者限制：`src/app/core-routes.ts:651` | v2 允许这一笔输入 |
| `tests/work-graph/S5-goal-settings.test.ts:398` | 手写目标设置请求：`every_step` 等调用者选项 | owner 接受后继续检查设置结果；不能因此豁免该文件其他仓库读取 | 与绑定的设置请求同形：`src/app/core-routes.ts:473` | v2 允许这一笔输入 |
| `tests/helpers/S5-queue-support.ts:366` | `taskRef/afterRunRef/reason` 的 requeue 请求 | 否。前一步手造 `run_crashed` 事件：`tests/helpers/S5-queue-support.ts:365`；另有返回手造 digest 的 source 替身：`tests/helpers/S5-queue-support.ts:360` | 与公开 requeue 请求同形：`src/app/core-routes.ts:437` | v2 允许这一笔请求；前置状态不能随之放行 |
| `tests/work-graph/S2C-pins.test.ts:58` | 手造 commit position，再自行签发 display token；构造在 `tests/work-graph/S2C-pins.test.ts:51`、`tests/work-graph/S2C-pins.test.ts:52` | 否，绕过公开队列读取对展示范围的产生 | 字段形状与公开请求相同，但 `displayToken/seenThrough` 是伪造的派生值 | **仍是 F1** |
| `tests/work-graph/S5-decision-application.test.ts:53` | 根据截获的 store commit 拼出 `identityKey/fingerprint/cursor`；构造在 `tests/work-graph/S5-decision-application.test.ts:34`、`tests/work-graph/S5-decision-application.test.ts:39` | 否，公开动作之后从内部提交信息制造 application receipt | 与公开 application 请求同形；来源不是公开步骤交付的 receipt | **仍是 F1：application receipt** |
| `tests/work-graph/S2A-queue-card-semantics.test.ts:78` | 从截获提交中拼出的 receipt；构造在 `tests/work-graph/S2A-queue-card-semantics.test.ts:60`、`tests/work-graph/S2A-queue-card-semantics.test.ts:63` | 否；接受后继续读取队列，读取在 `tests/work-graph/S2A-queue-card-semantics.test.ts:83` | 与公开 application 请求同形 | **仍是 F1：application receipt** |
| `tests/scenarios/support/S5-decisions.ts:434` | helper 接收 receipt；实际调用者从数据库 ledger 取得它：`tests/scenarios/S5-two-request-decisions.test.ts:141`，交给 helper：`tests/scenarios/S5-two-request-decisions.test.ts:163` | 否；从内部 ledger 获取后交回 owner，再继续读取应用后的卡片：`tests/scenarios/S5-two-request-decisions.test.ts:169` | 与公开 application 请求同形 | **仍是 F1：内部 ledger 派生的 application receipt** |

3．A1：记录仓库自身的测试

下表覆盖已找到的 `tests/record-store/` 文件及其专用文本检索 helper；上层 F3 这里只列已核实的三个共享入口，**不是上层使用点的完整清单**。

| 文件位置 | 构造及提交方式 | 判定 |
|---|---|---|
| `tests/record-store/lookup.test.ts:62` | 构造记录后经 records port 提交 | v2 允许 |
| `tests/record-store/R3a-transaction-boundaries.test.ts:50` | 提交手写 `scopeSeed`；其内容见 `tests/record-store/R3a-transaction-boundaries.test.ts:25` | 按 v2 的目录说明允许；测试对象边界存在歧义，见第5节 |
| `tests/record-store/R3b-body-concurrency.test.ts:74` | 通过子进程测试 body store 并发；worker 入口见 `tests/record-store/R3b-body-concurrency.test.ts:18` | v2 允许 |
| `tests/record-store/S2A-ordered-lookup.test.ts:143` | 构造记录和索引批次，经 store port 提交 | v2 允许 |
| `tests/record-store/S2C-count-lookup.test.ts:108` | 构造记录和索引批次，经 store port 提交 | v2 允许 |
| `tests/record-store/S4B-text-search.test.ts:38` | 经专用 seed helper 建立检索记录 | v2 允许 |
| `tests/record-store/SP-literal-type.test.ts:93` | 经 store port 提交检索测试记录 | v2 允许 |
| `tests/record-store/SP-lookup-index-migration.test.ts:73` | 经 store port 建立迁移前记录 | v2 允许 |
| `tests/record-store/SP-record-store-limits.test.ts:55` | 经 `seedBatch` 建立资源上限测试记录 | v2 允许 |
| `tests/record-store/SP-text-scan-undo.test.ts:18` | 直接测试扫描桶及撤销辅助函数；不是 records port 提交案例，相关操作在 `tests/record-store/SP-text-scan-undo.test.ts:22`、`tests/record-store/SP-text-scan-undo.test.ts:24` | v2 允许，沿用 A5；不应算成新增 store 提交豁免 |
| `tests/record-store/SP-text-scan.test.ts:79` | 经专用 seed helper 建立扫描记录 | v2 允许 |
| `tests/record-store/sqlite-body-race-worker.mjs:18` | 调用真实 body store 的 `put` | v2 允许 |
| `tests/record-store/transaction-extensions.test.ts:50` | 构造事务批次并调用 records port | v2 允许 |
| `tests/record-store/WP2-notice-cursors.test.ts:87` | 构造通知游标相关存储批次并提交 | v2 允许 |
| `tests/helpers/S4B-text-search-support.ts:155` | 单条 seed；批量入口在 `tests/helpers/S4B-text-search-support.ts:168`。专用调用方包括 `tests/record-store/S4B-text-search.test.ts:11`、`tests/record-store/SP-record-store-limits.test.ts:13`、`tests/record-store/SP-text-scan.test.ts:15` | v2 允许 |
| `tests/helpers/task-claim-fixture.ts:310` | 上层任务夹具的 `commitRaw`；手造 Run、改写 Session 的调用在 `tests/helpers/task-claim-fixture.ts:460`、`tests/helpers/task-claim-fixture.ts:470` | **F3** |
| `tests/helpers/graph-session-fixture.ts:365` | 上层图与 Session 夹具直提 records；调用包括 `tests/helpers/graph-session-fixture.ts:398`、`tests/helpers/graph-session-fixture.ts:423`、`tests/helpers/graph-session-fixture.ts:437` | **F3** |
| `tests/helpers/S5-decision-fixture.ts:547` | 上层决定夹具的 `seedCommit`；手造初始状态的调用包括 `tests/helpers/S5-decision-fixture.ts:560`、`tests/helpers/S5-decision-fixture.ts:599` | **F3** |

4．A7：三个指定 helper

| helper 使用点 | 边界核对 | 判定 |
|---|---|---|
| `tests/runtime/S4C-note-tools.test.ts:114` | 同文件；构建并检查工具适配器 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:124` | 同文件；参数映射及默认值 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:151` | 同文件；记录 write 参数 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:165` | 同文件；check 失败结果透传 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:177` | 同文件；write 拒绝结果透传 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:188` | 同文件；review/withdraw 适配 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:206` | 同文件；review 拒绝结果透传 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:215` | 同文件；取消路径及调用记录 | v2 允许 |
| `tests/runtime/S4C-note-tools.test.ts:240` | 同文件；write 拒绝后不继续 check | v2 允许 |
| `tests/scenarios/S2C-K-unknown-outcome.test.ts:75` | 只损坏临时 `kernel.sqlite`；SQL 在 `tests/scenarios/S2C-K-unknown-outcome.test.ts:41`。外层使用在 `tests/scenarios/S2C-K-unknown-outcome.test.ts:157`、`tests/scenarios/S2C-K-unknown-outcome.test.ts:179` | v2 允许；损坏范围措辞见第5节 |
| `tests/scenarios/S2C-K-retired.test.ts:218` | 移动后的损坏调用；SQL 在 `tests/scenarios/S2C-K-retired.test.ts:196`。外层调用在 `tests/scenarios/S2C-K-retired.test.ts:248`，损坏情形在 `tests/scenarios/S2C-K-retired.test.ts:298` | v2 允许；应在白名单中写明此文件 |
| `tests/scenarios/K3-44-crr-kind4.test.ts:53` | 沙箱替身保持 `executeChecks: false`；初始化在 `tests/scenarios/K3-44-crr-kind4.test.ts:49`，复位在 `tests/scenarios/K3-44-crr-kind4.test.ts:74` | v2 允许 |
| `tests/scenarios/K3-29-disposition-recovery.test.ts:50` | 使用同一替身，但在 `tests/scenarios/K3-29-disposition-recovery.test.ts:185` 打开执行；进入 `spawnSync` 和结果返回路径：`tests/scenarios/support/process-sandbox-standin.ts:59`、`tests/scenarios/support/process-sandbox-standin.ts:64` | **A7 越界** |
| `tests/scenarios/K3-44-recovery-answers.test.ts:51` | 在 `tests/scenarios/K3-44-recovery-answers.test.ts:267` 打开执行，越过仅 probe 的豁免 | **A7 越界** |

这里的两个越界不是“凭空返回 PASS”：替身确实调用命令，但它承担了 v2 明确禁止其承担的执行及结果返回职责。依据是 `tests/scenarios/support/process-sandbox-standin.ts:59`、`tests/scenarios/support/process-sandbox-standin.ts:64`，以及 `.lead-ref/books/test-rule-sheet-v2-draft.md:37`、`.lead-ref/books/test-rule-sheet-v2-draft.md:41`。

5．v2 本身的措辞问题

| 位置及案例 | 问题 | 最小文字修改 |
|---|---|---|
| `.lead-ref/books/test-rule-sheet-v2-draft.md:1`、`.lead-ref/books/test-rule-sheet-v2-draft.md:12` | 标题及生效说明只写 wave 2，未表达本次要求的 wave-1 返工冻结 | 改为：“本清单枚举完成后，v2 从 wave-1 返工的下一次冻结起生效，并约束 wave 2。” |
| `.lead-ref/books/test-rule-sheet-v2-draft.md:16`、`.lead-ref/books/test-rule-sheet-v2-draft.md:21`；案例 `tests/work-graph/S5-decision-application.test.ts:53` | “公开入口接收”与“平台自己派生”可能同时成立。仅比较请求字段形状会放过自制 receipt、token | 增加：“公开输入中含平台签发或派生的凭据、位置、回执、prepared 等字段时，只允许原样使用真实公开生产步骤返回的值；不得从内部记录重建或自行签发。” |
| `.lead-ref/books/test-rule-sheet-v2-draft.md:23`；案例 `tests/record-store/R3a-transaction-boundaries.test.ts:50`、`tests/record-store/R3a-transaction-boundaries.test.ts:53` | 目录内的测试同时构造记录并调用 Goal owner；“按目录允许”和“上层模块禁止”不够一致 | 增加：“以该测试行实际验证的 store 契约判定，目录位置不单独构成豁免；使用上层 owner 作为驱动不等于允许测试上层业务状态。” |
| `.lead-ref/books/test-rule-sheet-v2-draft.md:32`、`.lead-ref/books/test-rule-sheet-v2-draft.md:34` | “moved form”没有明确位置；实际 SQL 损坏全部 `session_records`，不是只改一个事件：`tests/scenarios/S2C-K-unknown-outcome.test.ts:41`、`tests/scenarios/S2C-K-retired.test.ts:196` | 明列两个文件及调用行；把“一个事件的 JSON”改为与批准范围一致的“该临时 Kernel 库的记录 JSON”，并注明是否允许全表损坏。 |
| `.lead-ref/books/test-rule-sheet-v2-draft.md:16`；案例 `tests/business/K3-review-workflow-rows.test.ts:813` | 测试把缺少实际执行参数的对象强转成 `WorkflowOperation`，而替身 `startRun/observeRun` 忽略请求、直接返回保存的 Run：`tests/business/K3-review-workflow-rows.test.ts:803`、`tests/business/K3-review-workflow-rows.test.ts:804`。宽泛的“入口收到”会掩盖生产调用缺口 | 增加：“须满足真实路由或工具对应分支的完整参数契约；类型强转和忽略参数的替身不能证明其为有效公开输入。A1 不豁免 F4。” |

```json
[
  {"section":1,"file":"tests/helpers/task-claim-fixture.ts","line":343,"value":"手写初始计划定义","verdict":"v2 允许","note":"公开请求形状；随后 apply 在349；夹具直写另计"},
  {"section":1,"file":"tests/business/K3-46-review-advance-failures.test.ts","line":143,"value":"从公开任务图组装的重排计划","verdict":"v2 允许","note":"公开读128；组装133；公开 apply149"},
  {"section":1,"file":"tests/helpers/S5R2-a-support.ts","line":82,"value":"从存储记录投影出的计划定义","verdict":"v2 允许","note":"仅输入放行；记录来源68；后续仓库读取97、105不放行"},
  {"section":1,"file":"tests/runtime/S5R2-agent-application.test.ts","line":143,"value":"propose_future_plan 工具参数","verdict":"v2 允许","note":"真实工具参数形状；随后公开读取155"},

  {"section":2,"file":"tests/helpers/S4A-note-fixture.ts","line":282,"value":"note、commandId、expectedPointerRevision、goalId","verdict":"v2 允许","note":"真实 note owner 的公开参数；HTTP另有调用者限制"},
  {"section":2,"file":"tests/work-graph/S5-goal-settings.test.ts","line":398,"value":"手写目标设置请求","verdict":"v2 允许","note":"设置输入允许，不豁免其他仓库读取"},
  {"section":2,"file":"tests/helpers/S5-queue-support.ts","line":366,"value":"taskRef、afterRunRef、reason","verdict":"v2 允许","note":"仅 requeue 输入；手造结束事件365和source替身360不放行"},
  {"section":2,"file":"tests/work-graph/S2C-pins.test.ts","line":58,"value":"自行签发的 displayToken 和手造 seenThrough","verdict":"仍是 F1","note":"构造51、52；字段形状公开不等于来源合法"},
  {"section":2,"file":"tests/work-graph/S5-decision-application.test.ts","line":53,"value":"从截获 store commit 拼出的 application receipt","verdict":"仍是 F1","note":"构造34、39"},
  {"section":2,"file":"tests/work-graph/S2A-queue-card-semantics.test.ts","line":78,"value":"从截获提交拼出的 application receipt","verdict":"仍是 F1","note":"构造60、63；接受后继续查询队列83"},
  {"section":2,"file":"tests/scenarios/support/S5-decisions.ts","line":434,"value":"从内部 ledger 取得的 application receipt","verdict":"仍是 F1","note":"来源 tests/scenarios/S5-two-request-decisions.test.ts:141；调用163；后续读取169"},

  {"section":3,"file":"tests/record-store/lookup.test.ts","line":62,"value":"store 测试记录","verdict":"v2 允许","note":"store 自身契约"},
  {"section":3,"file":"tests/record-store/R3a-transaction-boundaries.test.ts","line":50,"value":"scopeSeed","verdict":"v2 允许","note":"按目录说明允许；上层 owner 驱动边界见措辞问题"},
  {"section":3,"file":"tests/record-store/R3b-body-concurrency.test.ts","line":74,"value":"并发 body store 输入","verdict":"v2 允许","note":"通过专用 worker"},
  {"section":3,"file":"tests/record-store/S2A-ordered-lookup.test.ts","line":143,"value":"有序索引测试批次","verdict":"v2 允许","note":"store 自身契约"},
  {"section":3,"file":"tests/record-store/S2C-count-lookup.test.ts","line":108,"value":"计数索引测试批次","verdict":"v2 允许","note":"store 自身契约"},
  {"section":3,"file":"tests/record-store/S4B-text-search.test.ts","line":38,"value":"文本检索 seed","verdict":"v2 允许","note":"专用 store helper"},
  {"section":3,"file":"tests/record-store/SP-literal-type.test.ts","line":93,"value":"检索测试记录","verdict":"v2 允许","note":"store 自身契约"},
  {"section":3,"file":"tests/record-store/SP-lookup-index-migration.test.ts","line":73,"value":"迁移测试记录","verdict":"v2 允许","note":"store 自身契约"},
  {"section":3,"file":"tests/record-store/SP-record-store-limits.test.ts","line":55,"value":"资源上限 seedBatch","verdict":"v2 允许","note":"专用 store helper"},
  {"section":3,"file":"tests/record-store/SP-text-scan-undo.test.ts","line":18,"value":"扫描桶及撤销函数输入","verdict":"v2 允许","note":"沿用 A5；不是新增 records port 提交豁免"},
  {"section":3,"file":"tests/record-store/SP-text-scan.test.ts","line":79,"value":"扫描测试 seed","verdict":"v2 允许","note":"专用 store helper"},
  {"section":3,"file":"tests/record-store/sqlite-body-race-worker.mjs","line":18,"value":"body store put 输入","verdict":"v2 允许","note":"store 自身契约"},
  {"section":3,"file":"tests/record-store/transaction-extensions.test.ts","line":50,"value":"事务测试批次","verdict":"v2 允许","note":"store 自身契约"},
  {"section":3,"file":"tests/record-store/WP2-notice-cursors.test.ts","line":87,"value":"通知游标存储批次","verdict":"v2 允许","note":"store 自身契约"},
  {"section":3,"file":"tests/helpers/S4B-text-search-support.ts","line":155,"value":"单条和批量文本记录 seed","verdict":"v2 允许","note":"批量入口168；仅供 record-store 测试使用"},
  {"section":3,"file":"tests/helpers/task-claim-fixture.ts","line":310,"value":"上层夹具 commitRaw","verdict":"F3","note":"手造 Run460；改写 Session470"},
  {"section":3,"file":"tests/helpers/graph-session-fixture.ts","line":365,"value":"上层夹具记录批次","verdict":"F3","note":"调用398、423、437"},
  {"section":3,"file":"tests/helpers/S5-decision-fixture.ts","line":547,"value":"上层决定夹具 seedCommit","verdict":"F3","note":"初始状态调用560、599"},

  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":114,"value":"buildNoteTools","verdict":"v2 允许","note":"同文件，仅适配器"},
  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":124,"value":"buildNoteTools","verdict":"v2 允许","note":"参数映射及默认值"},
  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":151,"value":"buildNoteTools","verdict":"v2 允许","note":"记录 write 参数"},
  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":165,"value":"buildNoteTools","verdict":"v2 允许","note":"check 失败透传"},
  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":177,"value":"buildNoteTools","verdict":"v2 允许","note":"write 拒绝透传"},
  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":188,"value":"buildNoteTools","verdict":"v2 允许","note":"review/withdraw 适配"},
  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":206,"value":"buildNoteTools","verdict":"v2 允许","note":"review 拒绝透传"},
  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":215,"value":"buildNoteTools","verdict":"v2 允许","note":"取消路径及调用记录"},
  {"section":4,"file":"tests/runtime/S4C-note-tools.test.ts","line":240,"value":"buildNoteTools","verdict":"v2 允许","note":"write 拒绝后不 check"},
  {"section":4,"file":"tests/scenarios/S2C-K-unknown-outcome.test.ts","line":75,"value":"damageKernel","verdict":"v2 允许","note":"临时 Kernel 库；SQL41；外层调用157、179"},
  {"section":4,"file":"tests/scenarios/S2C-K-retired.test.ts","line":218,"value":"damageKernel 移动形式","verdict":"v2 允许","note":"临时 Kernel 库；SQL196；外层调用248；损坏情形298"},
  {"section":4,"file":"tests/scenarios/K3-44-crr-kind4.test.ts","line":53,"value":"process sandbox stand-in","verdict":"v2 允许","note":"executeChecks:false；初始化49、复位74"},
  {"section":4,"file":"tests/scenarios/K3-29-disposition-recovery.test.ts","line":50,"value":"process sandbox stand-in","verdict":"A7 越界","note":"185行打开 executeChecks；替身执行命令并返回结果"},
  {"section":4,"file":"tests/scenarios/K3-44-recovery-answers.test.ts","line":51,"value":"process sandbox stand-in","verdict":"A7 越界","note":"267行打开 executeChecks"},

  {"section":5,"file":".lead-ref/books/test-rule-sheet-v2-draft.md","line":12,"value":"生效范围只写 wave 2","verdict":"措辞问题","note":"明确从 wave-1 返工的下一次冻结起生效，并约束 wave 2"},
  {"section":5,"file":".lead-ref/books/test-rule-sheet-v2-draft.md","line":16,"value":"公开参数形状与派生值来源冲突","verdict":"措辞问题","note":"凭据、位置、回执和 prepared 只许使用真实公开生产步骤返回的值，不得从内部记录重建"},
  {"section":5,"file":".lead-ref/books/test-rule-sheet-v2-draft.md","line":23,"value":"目录豁免与被测模块边界冲突","verdict":"措辞问题","note":"按本测试行验证的 store 契约判定，目录本身不构成豁免"},
  {"section":5,"file":".lead-ref/books/test-rule-sheet-v2-draft.md","line":32,"value":"moved form 未定位且损坏范围不准确","verdict":"措辞问题","note":"写明两个文件及调用行，并明确是否允许全表记录 JSON 损坏"},
  {"section":5,"file":".lead-ref/books/test-rule-sheet-v2-draft.md","line":16,"value":"强转缺字段请求配合忽略参数的替身","verdict":"措辞问题","note":"要求满足真实分支的完整参数契约；A1 不豁免 F4；案例 tests/business/K3-review-workflow-rows.test.ts:803、804、813"}
]
```

v2 允许 34，仍是 F1 4，F3 3，A7 越界 2，措辞问题 5