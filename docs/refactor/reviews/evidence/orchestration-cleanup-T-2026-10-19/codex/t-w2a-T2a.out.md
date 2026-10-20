只读审计完成，未修改文件、运行测试或构建、执行 Git 写操作或访问网络。以下 `OK` 仅指 T2a 涉及的改动及其覆盖关系，不代表其他分片通过。

| 编号 | 类别 | 位置（file:line） | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| T2a-01 | 会出错 | `tests/runtime/S4C-note-tools.test.ts:134`、`:162`、`:199`、`:207`、`:214`、`:219` | T2-038 | 原整份请求的严格比较没有完整迁入，源断言见 `.lead-ref/base/tests/runtime/S4C-note-tools.test.ts:272`、`:286`、`:296`、`:308`。具体反例：处理 `convention/auth flow/use jwt` 时漏掉自有的 `body: undefined` 键，当前 `toEqual` 加 `.body.toBeUndefined()` 仍通过；原 `toStrictEqual` 会失败。分项比较也遗漏了请求顶层的完整形状。 | GTN02、GTN03、GTN06 对完整捕获请求使用 `toStrictEqual`，保留全部默认值和结果透传断言。 |
| T2a-02 | 会出错 | `tests/business/K3-46-review-advance-failures.test.ts:545` | T3-031 | 源例对两个字段都传过空数组，见 `.lead-ref/base/tests/business/K3-UR7-crr-failed-set.test.ts:544`；目标只补了 `failedCardRefs: []`，遗漏 `failedReviewRefs: []`。若实现错误地接受空的 `failedReviewRefs`、仍拒绝非空值，现有矩阵仍通过。 | 在目标矩阵补回 `{ key: 'failedReviewRefs', value: [] }`，沿用相同拒绝及不变断言。 |
| T2a-03 | 会出错 | `tests/work-graph/unknown-call-review-list.test.ts:173`、`:205`；`.lead-ref/replies/t-reply-T2.md:77` | T1-070 | 报告 BLOCKED 的第二 Goal 部分实际被删了：基线另一 Goal 的记录在 `.lead-ref/base/tests/work-graph/unknown-call-review-list.test.ts:88`、`:118`，跨 Goal 的 open 返回项在 `:125`。当前两例只有 Goal B。若 Goal 查询泄漏其他 Goal 的 pending 记录，或 workspace-open 错误地只查一个 Goal，当前数据都无法检出。条目要求保留过滤覆盖，见 `.lead-ref/books/t-items-T2.md:88`；BLOCKED 不得删除原例，见 `.lead-ref/books/t-book.md:87`。 | 恢复两处第二 Goal 记录及对应 Goal 过滤、跨 Goal open 断言；公开转换完成前，将这部分按 BLOCKED 原样保留。 |
| T2a-04 | 违规 | `tests/helpers/S5-decision-fixture.ts:615`、`:857`、`:910` | T1-067、T1-070、T3-033 | 共享前置仍自选 Kernel Session 身份、写 Session 创建事实，再手造 Kernel Run/Turn、位置及 entered 事实。F07 从 `tests/work-graph/WP2-context-extensions.test.ts:269` 进入此初始化；K3 世界从 `tests/helpers/K3-review-card-fixture.ts:156` 进入；T1-070 又在 `tests/helpers/B2-crr-world.ts:127` 调用该 Session helper。与明确要求补真实 Session/entered 的刷新及改正不符，见 `.lead-ref/books/t-items-T2.md:84`、`:92`；也违反 v2 A1，见 `.lead-ref/books/test-rule-sheet-v2.md:32`。 | 完成共享 S5 前置转换：Session 由真实 Runtime 创建，entered/ended 由共享真实 Runtime 的 prepare/start/finish 产生；删除这些手造身份、进入事实及对应手写结束路径。 |
| T2a-05 | 违规 | `tests/business/K3-review-workflow-rows.test.ts:886`、`:895` | T3-033 | 新 settle_review 例仍接 `savedRunRuntime`。其 `startRun` 忽略请求，见 `:747`；`performRun('start')` 只提供 meta，缺真实 start 所需参数，再强转类型，见 `:754`。这正是 v2 A1 禁止的“不完整请求靠忽略参数的替身通过”，见 `.lead-ref/books/test-rule-sheet-v2.md:30`。 | 本例保留真实 claim/end，随后从真实 `select_work` 取得并执行 `settle_review`；结束轮次已有此选择分支，见 `src/business/workflow/workflow.ts:1390`。移除本例的 Runtime 替身接线。 |
| T2a-06 | 违规 | `tests/business/K3-review-workflow-rows.test.ts:911`、`:967`、`:971` | T3-033 | 所谓独立完整期望仍从 `before` 复制 schemaVersion、workspace、inventory、streak、stateEntry、proposals 等普通字段；两次比较使用 `toMatchObject`，最终又以捕获的 owner 输出作 receipt 期望，见 `:973`。没有完成书面改正要求的独立完整 `expectedOwnerResult`，见 `.lead-ref/books/t-items-T2.md:460`。 | 普通字段按固定输入和调用序列写独立字面量并注明推导，分别严格比较 owner 结果和 receipt.result；仅平台签发身份、cursor 原样使用真实公开返回值。 |
| T2a-07 | 违规 | `tests/runtime/S3-graph-tools.test.ts:456`、`:464`、`:465`、`:490`、`:798`、`:801` | T2-036 | 转换行仍用生产哈希函数生成摘要期望及 ArtifactRef；`H = sha256Hex` 见 `:100`，生产导入见 `:15`。条目明确要求固定正文手算 ArtifactRef，见 `.lead-ref/books/t-items-T2.md:247`；禁止生产函数生成期望，见 `.lead-ref/books/t-book.md:83`。 | 将这些摘要、ArtifactRef 摘要和长度改为固定正文对应的独立字面量，注释写明输入及推导；断言不再调用 `H`。 |
| T2a-08 | 违规 | `tests/work-graph/WP2-context-extensions.test.ts:435`、`:444`、`:446` | T1-067 | F07 用生产 `decisionSourceKey` 生成 goal-cause 和 candidate 的期望行键，再与生产输出比较，见 `:455`。这违反独立期望规则，见 `.lead-ref/books/t-book.md:83`。 | 保留公开返回的 proposalId 及排序，按规格独立写出行键格式和推导，不调用生产行键函数生成期望。 |
| T2a-09 | 违规 | `tests/runtime/S3-graph-tools.test.ts:920`；`tests/runtime/S4C-note-run-task-resolver.test.ts:146`、`:263`；`tests/work-graph/WP2-context-extensions.test.ts:269` | T1-067、T2-035、T2-036、T2-037 | 转换后的 GT07/08/09/13、GTN20/21 仍只有 SQLite，F07 只有 memory；这些行没有 Host 重启豁免。服务行双后端要求见 `.lead-ref/books/test-rule-sheet-v1.md:94`。S3 还把原 memory 后端换掉了，基线见 `.lead-ref/base/tests/runtime/S3-graph-tools.test.ts:858`。 | 将上述行参数化为 memory、SQLite 两后端；需要平台共享 backend 时使用 A4 的真实工厂接缝，保持同一后端和现有断言。 |
| T2a-10 | 违规 | `tests/work-graph/WP2-context-extensions.test.ts:415` | T1-067 | F07 仍把 `anomalyDouble()` 接给真实 reader；它返回手造 ready、空页及 cursor，见 `:90`。该依赖实际会被调用，见 `src/core/work-graph/views/context-extensions.ts:225`，属于 F4，见 `.lead-ref/books/test-rule-sheet-v1.md:68`。 | 仅将 F07 的 anomalies 接到同一公开初始化环境上的真实 SessionAnomaly reader；不扩大到其他未要求转换的兄弟用例。 |
| T2a-11 | 违规 | `tests/runtime/S4C-note-run-task-resolver.test.ts:309`、`:322` | T2-037 | 两个 GTN21 拒绝例只证明原 Run ref 仍存在，没有证明状态未变。刷新明确要求公开核对未变，见 `.lead-ref/books/t-items-T2.md:259`；A6 同样要求拒绝前后不变，见 `.lead-ref/books/test-rule-sheet-v1.md:45`。 | 拒绝前公开读取真实执行状态，拒绝后再次读取并完整比较；缺失 Run 的 `not_found` 断言继续保留。 |
| T2a-12 | 违规 | `.lead-ref/replies/t-reply-T2.md:79`；`tests/helpers/K3-review-card-fixture.ts:336`；`tests/helpers/S2A-window-fixture.ts:48` | T3-103 | “三个调用方都不在白名单”不实。两份 helper 明列于 `.lead-ref/books/t-files-T2.txt:13`、`:14`，却仍接旧 stub。 | 完成这两份白名单内 helper 的真实 reader 接线及真实 `lookupOrdered` 转发；仅将真正范围外的 app 调用方保留为 BLOCKED，stub 待全部消费者完成后再删。 |
| T2a-13 | 违规 | `tests/scenarios/K3-19-review-unavailable.test.ts:25`、`:44`；`.lead-ref/replies/t-reply-T2.md:85` | T2-040、T2-042 | 此文件不在实际白名单，回复也承认漏列后仍施工。条目虽点名它，见 `.lead-ref/books/t-items-T2.md:284`、`:297`，但任务书明确规定白名单是编辑边界，范围外依赖应 BLOCKED，见 `.lead-ref/books/t-book.md:38`、`:48`。本次不是删除符号后的编译清理例外。 | 撤回该文件本轮的替身及 helper 迁移改动，登记白名单冲突为 BLOCKED，待 lead 修正白名单后再迁移。 |
| T2a-14 | 违规 | `tests/scenarios/K3-45-review-incomplete-r2.test.ts:119`；`tests/runtime/B2-04-allowance.test.ts:39` | T1-002、T2-019 | 合并后目标测试名遗漏来源规格编号：分别缺 K3-37（三）、B2-09b。来源及迁移要求见 `.lead-ref/books/t-items-T2.md:8`、`:181`；目标名必须保留来源规格编号，见 `.lead-ref/books/t-book.md:62`。 | 在两个目标测试名分别补入 K3-37（三）、B2-09b，保留现有目标编号。 |
| T2a-15 | 不整洁 | `tests/scenarios/K3-11-review-reasons-r2.test.ts:108`；`tests/scenarios/K3-45-review-incomplete-r2.test.ts:117` | T2-042 | 被抽走的 crash helper 注释仍留在原处，描述“返回原 RunRef”，现在却紧贴 `describe`。 | 删除这两条悬空 helper 注释。 |
| T2a-16 | 不整洁 | `tests/helpers/K3-35-continuation-fixture.ts:252` | T1-070 | 导出的 `claimRun` 参数类型漏了实现已支持的 `goalRef`，实现见 `:445`。当前调用通过 spread 确实传入，见 `tests/helpers/B2-crr-world.ts:128`，因此不能据此宣称运行时丢失 Goal；但直接对象字面量调用无法声明该选项。 | 在导出参数类型补 `goalRef?: GoalRef`，与实现保持一致。 |

逐项结论如下；T1-034、T2-045 仅核对本分片承担的覆盖关系。

- T1-002: T2a-14
- T1-016: OK（`tests/scenarios/K3-11-review-reasons-r2.test.ts:376`）
- T1-022: OK（`tests/scenarios/K3-45-review-incomplete-r2.test.ts:247`；`tests/state/unknown-call-review.test.ts:403`）
- T1-034: OK（`tests/record-store/S2C-count-lookup.test.ts:74`；`tests/record-store/SP-lookup-index-migration.test.ts:182`）
- T1-067: T2a-04, T2a-08, T2a-09, T2a-10
- T1-070: T2a-03, T2a-04, T2a-16
- T2-004: OK（`tests/helpers/S4B-text-search-support.ts:26`、`:96`、`:186`）
- T2-012: OK（`tests/helpers/S4B-text-search-support.ts:71`、`:128`）
- T2-013: OK（`tests/record-store/S2C-count-lookup.test.ts:51`、`:64`）
- T2-014: OK（`tests/record-store/S4B-text-search.test.ts:361`）
- T2-015: OK（`tests/record-store/S4B-text-search.test.ts:660`）
- T2-016: OK（`tests/record-store/SP-lookup-index-migration.test.ts:35`、`:66`）
- T2-018: OK（`tests/runtime/B2-09-allowance-crash.test.ts:41`）
- T2-019: T2a-14
- T2-020: OK（`tests/runtime/C1-communication-tools.test.ts:115`、`:180`）
- T2-023: OK（`tests/runtime/K3-15-blocked-sentence-pure.test.ts:17`）
- T2-035: T2a-09
- T2-036: T2a-07, T2a-09
- T2-037: T2a-09, T2a-11
- T2-038: T2a-01
- T2-040: T2a-13
- T2-042: T2a-13, T2a-15
- T2-043: OK（`tests/scenarios/K3-05-review-round.test.ts:80`）
- T2-044: OK（`tests/scenarios/support/review-card-round.ts:143`）
- T2-045: OK（覆盖关系：`tests/scenarios/K3-19-review-unavailable.test.ts:106`、`:123`）
- T2-046: OK（`tests/scenarios/support/review-work-root.ts:48`、`:135`、`:162`）
- T2-047: OK（`tests/scenarios/K3-R1-file-change.test.ts:188`、`:241`）
- T2-053: OK（`tests/scenarios/harness.test.ts:150`、`:171`）
- T2-056: OK（`tests/state/S1-anomaly.test.ts:106`）
- T2-060: OK（`tests/state/command-rerun-request.test.ts:164`）
- T2-061: OK（`tests/state/K3-B3-shared-rules-pure.test.ts:89`、`:115`）
- T2-062: OK（删除范围依据：`.lead-ref/books/t-items-T2.md:399`）
- T3-028: OK（`tests/helpers/K3-review-card-fixture.ts:499`；`tests/business/K3-46-review-advance-failures.test.ts:123`）
- T3-030: OK（`tests/helpers/K3-review-card-fixture.ts:523`、`:597`；`tests/business/K3-UR7-crr-failed-set.test.ts:441`）
- T3-031: T2a-02
- T3-032: OK（`tests/business/K3-15-ur3h.test.ts:215`）
- T3-033: T2a-04, T2a-05, T2a-06
- T3-034: OK（`tests/business/K3-review-workflow-rows.test.ts:1076`、`:1146`、`:1269`）
- T3-078: OK（`tests/helpers/B2-crr-world.ts:119`）
- T3-079: OK（`tests/helpers/K3-35-continuation-fixture.ts:928`）
- T3-080: OK（部分保留成立，证据见下表）
- T3-103: T2a-12
- T3-105: OK（静态转换核对；环境失败未独立复现，见下表）

部分完成及阻塞项：

| 条目 | 部分 | DSH 的理由及类别是否成立 | 公开步骤是否可达 |
|---|---|---|---|
| T1-070 | 第二 Goal 记录、Goal 过滤及跨 Goal open | **局部拒绝属实，平台 unreachable 结论不成立。** K3 helper 限定 Goal B，见 `tests/helpers/K3-35-runtime.ts:113`；但共享 Runtime 按 Run 授权，没有固定 Goal 条件，见 `tests/helpers/S2B-runtime-steps-fixture.ts:232`。而且被阻塞部分没有原样保留，见 T2a-03。 | 可使用另一 Goal 的 `claimTask`，经共享 Runtime 真实 prepare/start，再走 reconcile、`platform.resolveUnknownRun`。启动入口见 `tests/helpers/S2B-runtime-steps-fixture.ts:366`；公开核对记录链见 `tests/helpers/K3-35-continuation-fixture.ts:673`、`:679`；记录 Goal 来自实际 Run，见 `src/core/work-graph/tasks/run-reconcile-service.ts:951`。 |
| T3-080 | 保留 `K3_35_TASK_ID` 导出 | **成立，属于条目“无消费者”前提与代码不符，不是状态不可达。** 导出仍在 `tests/helpers/K3-35-continuation-fixture.ts:158`；实际导入、使用在 `tests/runtime/K3-35-workspace-baseline-prepare.test.ts:16`、`:40`。 | 不涉及达态；必须保留仍被使用的导出。 |
| T3-103 | 两份 helper 仍接 stub | **不成立。** `tests/helpers/K3-review-card-fixture.ts:336`、`tests/helpers/S2A-window-fixture.ts:48` 的消费者都在白名单，见 `.lead-ref/books/t-files-T2.txt:13`、`:14`。 | 可直接接 `createGoalExecutedFilesReader` 并转发真实有序查询；本轮已有接线实例，见 `tests/helpers/S5R2-c-support.ts:147`。 |
| T3-103 | app 调用方及 stub 删除 | **范围阻塞成立。** 剩余 app 消费者在 `tests/app/S5-decision-routes.test.ts:223`，不在本组白名单；范围规则见 `.lead-ref/books/t-book.md:48`。 | reader 本身可用；阻塞来自编辑归属，不是缺公开入口。此消费者接线前不能删除 stub。 |
| T3-105 | TU07 完成尾段的 bwrap 失败 | `.lead-ref/replies/t-reply-T2.md:80` 是 DSH 的环境失败声明。本次禁止运行，**无法独立确认该 ENOENT**。代码确实释放模型并等待真实 driver 完成，见 `tests/runtime/S5-user-message-tools.test.ts:435`。 | 已接真实 Workflow 调用及完成等待，见 `tests/runtime/S5-user-message-tools.test.ts:425`、`:436`；由 lead 在指定环境验证。 |

同一发现表的 JSON：

```json
[
  {
    "id": "T2a-01",
    "class": "会出错",
    "file": "tests/runtime/S4C-note-tools.test.ts",
    "line": 134,
    "item": "T2-038",
    "problem": "原整份请求的严格形状断言未完整迁入，源见 .lead-ref/base/tests/runtime/S4C-note-tools.test.ts:272、286、296、308。convention/auth flow/use jwt 请求漏掉自有 body:undefined 键时，现 :137 的 toEqual 和 :141 的 toBeUndefined 仍通过；:162、199、207、214、219 也未保留原严格比较。",
    "fix": "GTN02、GTN03、GTN06 对完整捕获请求使用 toStrictEqual，保留全部默认值和结果透传断言。"
  },
  {
    "id": "T2a-02",
    "class": "会出错",
    "file": "tests/business/K3-46-review-advance-failures.test.ts",
    "line": 545,
    "item": "T3-031",
    "problem": "遗漏源 .lead-ref/base/tests/business/K3-UR7-crr-failed-set.test.ts:544 的 failedReviewRefs:[] 输入，只迁入 failedCardRefs:[]。错误接受空 failedReviewRefs、仍拒绝非空值的实现会通过现有矩阵。",
    "fix": "补回 {key:'failedReviewRefs',value:[]}，沿用相同拒绝及不变断言。"
  },
  {
    "id": "T2a-03",
    "class": "会出错",
    "file": "tests/work-graph/unknown-call-review-list.test.ts",
    "line": 173,
    "item": "T1-070",
    "problem": "回复 .lead-ref/replies/t-reply-T2.md:77 报第二 Goal BLOCKED，但现 :173、205 两例都删除了另一 Goal；源记录见 .lead-ref/base/tests/work-graph/unknown-call-review-list.test.ts:88、118，跨 Goal open 返回项见 :125。当前无法检出 Goal 查询泄漏另一 Goal，或 workspace-open 错误限于一个 Goal；违反条目 .lead-ref/books/t-items-T2.md:88 及 BLOCKED 保留规则 .lead-ref/books/t-book.md:87。",
    "fix": "恢复两处第二 Goal 记录及对应 Goal 过滤、跨 Goal open 断言；公开转换完成前按 BLOCKED 原样保留。"
  },
  {
    "id": "T2a-04",
    "class": "违规",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "line": 615,
    "item": "T1-067,T1-070,T3-033",
    "problem": "共享前置仍手选 Kernel Session 身份并写创建事实，:857 手造 Kernel Run/Turn、位置及 entered，:910 无条件执行。F07 经 tests/work-graph/WP2-context-extensions.test.ts:269 使用；K3 世界经 tests/helpers/K3-review-card-fixture.ts:156 使用；T1-070 在 tests/helpers/B2-crr-world.ts:127 再调用手造 Session。未完成 .lead-ref/books/t-items-T2.md:84、92 要求的真实前置，违反 .lead-ref/books/test-rule-sheet-v2.md:32。",
    "fix": "Session 改由真实 Runtime 创建，entered/ended 改由共享真实 Runtime prepare/start/finish 产生，删除手造身份、进入事实及对应手写结束路径。"
  },
  {
    "id": "T2a-05",
    "class": "违规",
    "file": "tests/business/K3-review-workflow-rows.test.ts",
    "line": 886,
    "item": "T3-033",
    "problem": "新 settle_review 例仍用 savedRunRuntime；:747 忽略 start 请求，:754 构造缺少真实 start 参数的请求并强转，:895 执行它。违反 .lead-ref/books/test-rule-sheet-v2.md:30 的完整参数契约和禁止忽略请求替身规则。",
    "fix": "本例保留真实 claim/end，改由真实 select_work 取得并执行 settle_review，移除本例 Runtime 替身接线；真实选择分支见 src/business/workflow/workflow.ts:1390。"
  },
  {
    "id": "T2a-06",
    "class": "违规",
    "file": "tests/business/K3-review-workflow-rows.test.ts",
    "line": 911,
    "item": "T3-033",
    "problem": "expectedValue 从 before 复制普通状态字段，:967、971 只做部分比较，:973 又以 owner 输出作 receipt 期望，未完成 .lead-ref/books/t-items-T2.md:460 要求的独立完整 expectedOwnerResult。",
    "fix": "普通字段按固定输入和调用序列列独立字面量并注释推导，分别严格比较 owner 和 receipt.result；仅签发身份、cursor 原样取真实公开返回值。"
  },
  {
    "id": "T2a-07",
    "class": "违规",
    "file": "tests/runtime/S3-graph-tools.test.ts",
    "line": 456,
    "item": "T2-036",
    "problem": ":456、464、465、490 的摘要期望及 :798、801 的 ArtifactRef 仍调用生产 H；:100 定义 H=sha256Hex，生产导入在 :15。违反 .lead-ref/books/t-items-T2.md:247 的固定正文手算要求及 .lead-ref/books/t-book.md:83 的独立期望规则。",
    "fix": "将上述摘要、ArtifactRef 摘要和长度改为固定正文对应的独立字面量，注释输入和推导，断言不再调用 H。"
  },
  {
    "id": "T2a-08",
    "class": "违规",
    "file": "tests/work-graph/WP2-context-extensions.test.ts",
    "line": 435,
    "item": "T1-067",
    "problem": ":435、444、446 用生产 decisionSourceKey 生成 F07 期望行键，再在 :455 与生产输出比较，违反 .lead-ref/books/t-book.md:83。",
    "fix": "保留公开返回的 proposalId 和排序，按规格独立写出行键格式及推导，不调用生产行键函数生成期望。"
  },
  {
    "id": "T2a-09",
    "class": "违规",
    "file": "tests/runtime/S3-graph-tools.test.ts",
    "line": 920,
    "item": "T1-067,T2-035,T2-036,T2-037",
    "problem": "S3 转换行固定 SQLite；tests/runtime/S4C-note-run-task-resolver.test.ts:146、263 也固定 SQLite；tests/work-graph/WP2-context-extensions.test.ts:269 的 F07 固定 memory。没有 Host 重启豁免，不符合 .lead-ref/books/test-rule-sheet-v1.md:94；S3 基线 memory 后端见 .lead-ref/base/tests/runtime/S3-graph-tools.test.ts:858。",
    "fix": "GT07/08/09/13、GTN20/21、F07 参数化为 memory 和 SQLite；平台共享 backend 使用 A4 真实工厂接缝，保持原断言。"
  },
  {
    "id": "T2a-10",
    "class": "违规",
    "file": "tests/work-graph/WP2-context-extensions.test.ts",
    "line": 415,
    "item": "T1-067",
    "problem": "F07 仍接 anomalyDouble；:90 返回手造 ready、空页及 cursor，src/core/work-graph/views/context-extensions.ts:225 实际调用它，违反 .lead-ref/books/test-rule-sheet-v1.md:68 的 F4。",
    "fix": "仅将 F07 的 anomalies 接到同一公开初始化环境的真实 SessionAnomaly reader，不扩大其他兄弟用例。"
  },
  {
    "id": "T2a-11",
    "class": "违规",
    "file": "tests/runtime/S4C-note-run-task-resolver.test.ts",
    "line": 309,
    "item": "T2-037",
    "problem": ":309、322 仅断言真实 Run ref 仍存在，不能证明拒绝后未变；未满足 .lead-ref/books/t-items-T2.md:259 和 .lead-ref/books/test-rule-sheet-v1.md:45。",
    "fix": "拒绝前后公开读取同一真实执行状态并完整比较，保留缺失 Run 的 not_found 断言。"
  },
  {
    "id": "T2a-12",
    "class": "违规",
    "file": ".lead-ref/replies/t-reply-T2.md",
    "line": 79,
    "item": "T3-103",
    "problem": "三个剩余调用方都不在白名单的理由不实：tests/helpers/K3-review-card-fixture.ts:336、tests/helpers/S2A-window-fixture.ts:48 仍用 stub，但两文件明列于 .lead-ref/books/t-files-T2.txt:13、14。",
    "fix": "完成这两份 helper 的真实 reader 接线及真实 lookupOrdered 转发；仅保留范围外 app 消费者的 BLOCKED，全部消费者完成后才删 stub。"
  },
  {
    "id": "T2a-13",
    "class": "违规",
    "file": "tests/scenarios/K3-19-review-unavailable.test.ts",
    "line": 44,
    "item": "T2-040,T2-042",
    "problem": "文件不在实际白名单，仍在 :25、44 迁移 helper 和替身；.lead-ref/replies/t-reply-T2.md:85 承认漏列后施工。条目虽在 .lead-ref/books/t-items-T2.md:284、297 点名，但 .lead-ref/books/t-book.md:38、48 明确以白名单为编辑边界并要求范围外依赖 BLOCKED。",
    "fix": "撤回该文件本轮替身及 helper 迁移改动，登记白名单冲突为 BLOCKED，待 lead 修正白名单后再迁移。"
  },
  {
    "id": "T2a-14",
    "class": "违规",
    "file": "tests/scenarios/K3-45-review-incomplete-r2.test.ts",
    "line": 119,
    "item": "T1-002,T2-019",
    "problem": "此目标名遗漏 K3-37（三）；tests/runtime/B2-04-allowance.test.ts:39 遗漏 B2-09b。来源迁移见 .lead-ref/books/t-items-T2.md:8、181，违反 .lead-ref/books/t-book.md:62 的目标名保留来源规格编号要求。",
    "fix": "两个目标测试名分别补入 K3-37（三）、B2-09b，保留现有目标编号。"
  },
  {
    "id": "T2a-15",
    "class": "不整洁",
    "file": "tests/scenarios/K3-11-review-reasons-r2.test.ts",
    "line": 108,
    "item": "T2-042",
    "problem": "此处及 tests/scenarios/K3-45-review-incomplete-r2.test.ts:117 留下被抽走 crash helper 的返回 RunRef 注释，现在紧贴 describe。",
    "fix": "删除两条悬空 helper 注释。"
  },
  {
    "id": "T2a-16",
    "class": "不整洁",
    "file": "tests/helpers/K3-35-continuation-fixture.ts",
    "line": 252,
    "item": "T1-070",
    "problem": "导出 claimRun 输入类型遗漏实现 :445 已支持的 goalRef。tests/helpers/B2-crr-world.ts:128 通过 spread 实际传入，所以当前运行时透传有效，但直接对象字面量调用不能声明该选项。",
    "fix": "在导出输入类型补 goalRef?: GoalRef，与实现一致。"
  }
]
```

会出错 3，违规 11，不整洁 2，建议 0