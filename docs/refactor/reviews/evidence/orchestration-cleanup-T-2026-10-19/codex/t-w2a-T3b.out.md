已完成 T3b 的只读静态审查，未运行测试或构建。以下行号默认指合并树；标注“w2-base”的位置对应 `.lead-ref/base/` 中的原文件。

**1. 发现表**

| 编号 | 类别 | 位置 | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| T3b-01 | 会出错 | `tests/app/host-settings.test.ts:904` | T3-021 | 命令授权拒绝例同时带了不存在的 Answer：只为 a、b 保存了真实 Answer（`:891`、`:892`），locked 却使用自造引用（`:905`），且只断言 `rejected`。具体反例：删除 `src/app/host-settings.ts:773` 的授权检查后，`src/app/host.ts:983`、`:986` 仍因 Answer 不存在返回 `rejected/not_found`，该例仍过，命令授权守卫失去覆盖。 | 在 locked scope 中经同一真实 Query 路径保存携带 checks 的 Answer，使用返回的引用，使唯一错误为 `commandsAllowed:false`；精确断言 `forbidden`，并通过 settings snapshot 验证拒绝未改变设置。 |
| T3b-02 | 会出错 | `tests/app/session-rendering.test.ts:427` | T3-006 | 来源原始记录块的两条正向断言被丢掉：保存的 reasoning 正文和 `reasoningContent` 字段（w2-base `tests/app/R6-workbench.test.ts:359`、`:360`）。目标只检查 `savedRaw` 不含 `open`，且匹配失败回退为空串（`:427`、`:428`）；`:424` 检查的是可见正文，`:435` 起的原始正文检查不包含 assistant。具体反例：assistant 可见推理正常，但原始展开块为空，现有断言仍过。 | 在目标的 assistant `savedRaw` 上恢复两条正向断言：包含 `reasoningContent` 和本例固定原文 `**已保存的判断**`，再保留默认收起断言。 |
| T3b-03 | 会出错 | w2-base `tests/data/S8D-platform-fixture.test.ts:29` | T3-067 | 删除例在首次采集后写入 `h.py`，再断言新增 `h.py → g.py` 边及 Python 文件数为 3（`:32`、`:33`）。指定覆盖中，A15 第二次采集只核对文件节点及 inventory（`tests/data/S8E-A15-previous-observation.test.ts:42`、`:44`、`:51`）；A20 只核对首次图的边和计数（`tests/data/S8D-A20-python-imports.test.ts:140`、`:143`、`:146`）。具体反例：再次采集更新节点，却沿用旧 Python 边和语言计数，两处指定覆盖仍过，来源例会失败。 | 恢复该删除例，将 T3-067 标为 BLOCKED，按 `.lead-ref/books/t-book.md:31` 交 lead 冻结这两条再次采集断言的归宿；迁入前不得删除。 |
| T3b-04 | 违规 | `tests/data/S8E-A08-skip-list.test.ts:39` | T3-064 | 改正行明确要求“所有 language issues 合并后为空”（`.lead-ref/books/t-items-T3.md:590`）；实现却改为三个指定路径不出现在 issues，随后删除来源。回复承认这一替代（`.lead-ref/replies/t-reply-T3.md:123`、`:125`）。这不是等强断言，也违反遇阻保留、不得自行放宽的规则（`.lead-ref/books/t-book.md:29`、`:116`）。 | 将新增 `a/keep.ts` 的一行内容设为 `/// <reference path="../dist/z.ts" />`，保留原有三个节点和每个文件的行数断言，恢复所有 issues 精确等于 `[]`。该公开文件输入可让扫描器走到 dist，依据见下方 BLOCKED 核对。 |
| T3b-05 | 违规 | `tests/app/S2B-41-decision54-backfill-bound.test.ts:205` | T3-011 | 新建 requeue owner 时接入了恒返手造 `not_found` 的 `messages.readMessage` 替身，没有调用真实依赖。属于 F4 禁止形状（`.lead-ref/books/test-rule-sheet-v1.md:68`），不在 v2 A7 三个例外中（`.lead-ref/books/test-rule-sheet-v2.md:44`）。 | 用同一测试世界的真实依赖构造 `createSessionMailbox`，把其真实读取端口传给 requeue；构造入口为 `src/core/work-graph/communication/mailbox-service.ts:1045`。 |
| T3b-06 | 违规 | `tests/runtime/R4b-session-input-boundaries.test.ts:110`；`tests/app/host-settings.test.ts:901` | T2-025、T3-021 | 转换后的拒绝例仍不在 `describe('rejects: …')` 中，也未按拒绝行用公开读取核对前后状态不变。R4b 的非法 limit 和异主体 cursor 检查见 `:114`、`:128`；Host 两条拒绝见 `:901`、`:904`。A6 明确要求该结构及不变性检查（`.lead-ref/books/test-rule-sheet-v1.md:45`），T2-025 刷新还明确重申按 A6 保留（`.lead-ref/books/t-items-T3.md:90`）。 | 将这些拒绝行放入 `rejects:` 分组，每行仅保留一个错误；分别通过公开 history 读取或 settings snapshot 比较拒绝前后状态。locked 行同时按 T3b-01 修正前置状态。 |
| T3b-07 | 不整洁 | `tests/app/R6-workbench.test.ts:295` | T3-006 | 历史子块移走后，注释仍声称该例验证真实历史顺序、会先在历史占位器处失败（`:295`—`:298`），测试名也仍包含历史投影（`:299`）；保留主体已从任务计划开始（`:302`）。 | 将名称和注释改为保留的任务层级、执行依赖及工作链接行为，删除历史与占位器失败的描述。 |
| T3b-08 | 不整洁 | `tests/runtime/R4c-kernel-history-range.test.ts:406` | T2-033 | 测试名仍声称隔离 `damage`，但损坏注入已删除，现有输入是两个正常 Session（`:409`、`:410`），断言仅覆盖分页、尾位置和 Session 隔离（`:413`、`:418`）。 | 删除测试名中的 damage，准确描述正常 Session 的分页及尾位置隔离。 |

**2. 逐条结论**

以下仅评价各条目涉及 T3b 的部分。

- T2-005: OK（`tests/kernel/R4a-frozen-public.test.ts:318`、`:449`）
- T2-006: OK（`tests/kernel/R4a-frozen-public.test.ts:188`）
- T2-007: OK（`tests/kernel/R4a-frozen-public.test.ts:149`、`:230`）
- T2-008: OK（`tests/kernel/R4a-frozen-public.test.ts:449`）
- T2-009: OK（导入清理：`tests/kernel/R4a-frozen-public.test.ts:16`、`tests/runtime/R4b-session-input-boundaries.test.ts:17`）
- T2-024: OK（`tests/runtime/R4b-session-input-boundaries.test.ts:46`）
- T2-025: T3b-06（`tests/runtime/R4b-session-input-boundaries.test.ts:110`）
- T2-033: T3b-08（`tests/runtime/R4c-kernel-history-range.test.ts:406`）
- T3-001: OK（`tests/app/A2-host-instance-lease.test.ts:65`、`:114`）
- T3-006: T3b-02、T3b-07（`tests/app/session-rendering.test.ts:427`；`tests/app/R6-workbench.test.ts:295`）
- T3-007: OK（`tests/app/RL-34-wiring-resource-caps.test.ts:140`）
- T3-008: OK（`tests/app/RL-44-host-restart-resource-caps.test.ts:132`）
- T3-010: OK（`tests/app/S2B-35-activity-routes.test.ts:197`）
- T3-011: T3b-05（`tests/app/S2B-41-decision54-backfill-bound.test.ts:205`）
- T3-012: OK（`tests/app/S2B-41-decision54-backfill-bound.test.ts:47`）
- T3-013: OK（`tests/app/S2B-backfill-host.test.ts:140`）
- T3-017: OK（`tests/app/S8A-L8-auto-capture-host.test.ts:168`）
- T3-018: OK（`tests/work-graph/S8A-L8-observation-state.test.ts:713`、`:755`）
- T3-019: OK（`tests/work-graph/S8A-L8-observation-state.test.ts:803`、`:857`、`:909`）
- T3-020: OK（`tests/app/S8A-L8-capture-start.test.ts:114`、`:144`）
- T3-021: T3b-01、T3b-06（`tests/app/host-settings.test.ts:901`、`:904`）
- T3-024: OK（`tests/app/support/S8A-L8-host.ts:32`、`:58`、`:177`、`:295`）
- T3-029: OK（`tests/business/K3-41-release-hold.test.ts:315`、`:371`）
- T3-037: OK（`tests/composition/R3c-R4b-platform.test.ts:78`）
- T3-039: OK（`tests/composition/S8A-L8-adoption-capture.test.ts:164`）
- T3-040: OK（`tests/composition/S8A-L8-pass-capture.test.ts:380`）
- T3-041: OK（`tests/composition/W1-future-plan-platform.test.ts:107`）
- T3-042: OK（`tests/composition/W1-future-plan-platform.test.ts:167`）
- T3-043: OK（`tests/composition/W2-future-intent-platform.test.ts:97`）
- T3-061: OK（`tests/data/S8D-A22-cpp-imports.test.ts:59`、`:114`；`tests/composition/S8D-A06-multilingual.test.ts:119`；`tests/composition/S8A-AE1-formal-comparison.test.ts:156`）
- T3-062: OK（`tests/helpers/workspace-tools-fixture.ts:61`；`tests/data/S8E-A25-strict-capture.test.ts:10`）
- T3-063: OK（`tests/data/S8E-A07-git-inventory.test.ts:44`、`:54`）
- T3-064: T3b-04（`tests/data/S8E-A08-skip-list.test.ts:39`）
- T3-065: OK（`tests/data/S8E-A23-ignored-databases.test.ts:24`、`:50`）
- T3-067: T3b-03（w2-base `tests/data/S8D-platform-fixture.test.ts:29`）
- T3-069: OK（`tests/data/S8D-A21-python-config.test.ts:191`）
- T3-070: OK（`tests/data/S8D-A21-python-config.test.ts:64`）
- T3-071: OK（涉及的合并目标：`tests/data/S8D-A21-python-config.test.ts:64`、`:110`、`:157`、`:172`、`:191`）
- T3-072: OK（`tests/data/S8D-A21-python-config.test.ts:122`）
- T3-073: OK（`tests/data/S8D-A21-python-config.test.ts:157`）
- T3-074: OK（`tests/data/S8D-A21-python-config.test.ts:172`）
- T3-076: OK（`tests/helpers/observation-source-fixture.ts:66`、`:94`、`:101`）
- T3-081: OK（`tests/runtime/K3-35-approved-methods-brief.test.ts:23`）
- T3-083: OK（`tests/helpers/K3-padded-review-record.ts:29`、`:58`）
- T3-085: OK（`tests/helpers/RL-query-fixture.ts:19`、`:54`）
- T3-086: OK（`tests/helpers/RL-resource-caps-support.ts:30`、`:227`）
- T3-087: OK（`tests/helpers/S2B-be2-reconcile-support.ts:68`、`:188`）
- T3-088: OK（`tests/helpers/S2B-r2-calendar-reverify-support.ts:143`）
- T3-089: OK（批准删除范围：w2-base `tests/helpers/S2B-r3-r4-support.ts:21`；w2-base `tests/work-graph/S2B-r4-session-workspace.test.ts:44`）
- T3-091: OK（`tests/helpers/S2C-K2-scenario-support.ts:29`）
- T3-092: OK（`tests/helpers/S4C2-note-card-fixture.ts:42`）
- T3-097: OK（`tests/helpers/WP1-entry-fixture.ts:18`、`:140`、`:325`）
- T3-099: OK（`tests/helpers/WP1-scenario-fixture.ts:76`、`:122`、`:132`）
- T3-104: OK（`tests/helpers/orchestration-fixture.ts:142`）

**3. partial / BLOCKED 核对**

| 条目 | 部分 | DSH 的理由及类别是否属实 | 能否经公开步骤到达 |
|---|---|---|---|
| T2-025 | observer-down 子例；共享转换关联部分 | 属实。回复列为 `missing entry point`（`.lead-ref/replies/t-reply-T3.md:118`）；Work 和 Query 驱动分别把 `publish` 固定为无操作函数（`src/core/agent-runtime/execution-driver.ts:1253`；`src/core/agent-runtime/query-execution.ts:542`）。保留子例仍直接设置失败 observer（`tests/runtime/R4c-execution-history.test.ts:408`、`:416`）。 | 不可达：当前公开 Runtime 步骤没有可注入失败 observer sink 的入口。该 BLOCKED 理由本身不列发现。 |
| T3-064 | A08 所有 language issues 为空 | 对当前无引用的输入，dist 被排除为默认扫描根的解释属实（`tests/data/S8E-A08-skip-list.test.ts:17`、`:20`；`src/core/workspace/typescript-source-query.ts:112`）。但“不可成立、必须丢掉 dist”的结论不属实（`.lead-ref/replies/t-reply-T3.md:124`）。实现已自行改弱断言，见 T3b-04。 | 可达：真实文件 `a/keep.ts` 写入一行 triple-slash path 引用，再走 `architecture.captureSourceChanges → listFiles`（`tests/helpers/S8D-platform-fixture.ts:233`、`:250`）。扫描器接受已有 `.ts` 引用目标（`src/core/workspace/typescript-light-scan.ts:268`、`:280`），解析 path 引用并把目标加入扫描队列（`:353`、`:398`）；已经扫描的 dist 不会进入 skipped issues（`:418`）。 |

**4. JSON**

```json
[
  {
    "id": "T3b-01",
    "class": "会出错",
    "file": "tests/app/host-settings.test.ts",
    "line": 904,
    "item": "T3-021",
    "problem": "locked 工作区没有真实已保存 Answer，却以自造引用检查命令授权拒绝，且只断言 rejected。删除 src/app/host-settings.ts:773 的授权检查后，src/app/host.ts:983、:986 仍因 Answer 不存在返回 rejected/not_found，因此该例仍过。",
    "fix": "在 locked scope 经真实 Query 保存携带 checks 的 Answer，使用返回的引用，使唯一错误为 commandsAllowed:false；精确断言 forbidden，并通过 settings snapshot 验证拒绝未改变设置。"
  },
  {
    "id": "T3b-02",
    "class": "会出错",
    "file": "tests/app/session-rendering.test.ts",
    "line": 427,
    "item": "T3-006",
    "problem": "来源 w2-base tests/app/R6-workbench.test.ts:359、:360 对原始记录中 reasoning 正文及 reasoningContent 字段的正向断言未迁入。目标仅断言 savedRaw 不含 open，匹配失败还回退为空串。assistant 可见推理正常但原始展开块为空时，该例仍过。",
    "fix": "在 assistant savedRaw 上恢复包含 reasoningContent 和固定原文 **已保存的判断** 的正向断言，再保留默认收起断言。"
  },
  {
    "id": "T3b-03",
    "class": "会出错",
    "file": "tests/data/S8D-platform-fixture.test.ts",
    "line": 29,
    "item": "T3-067",
    "problem": "位置为 w2-base 删除前源码。原例第二次采集断言新增 h.py 到 g.py 的边及 Python 文件数为 3。指定覆盖 tests/data/S8E-A15-previous-observation.test.ts:42、:44、:51 只核对第二次文件节点及 inventory，tests/data/S8D-A20-python-imports.test.ts:140、:143、:146 只核对首次边和计数。再次采集更新节点却沿用旧 Python 边和计数时，两处指定覆盖仍过。",
    "fix": "恢复删除例，将 T3-067 标为 BLOCKED，按 .lead-ref/books/t-book.md:31 交 lead 冻结再次采集的边和计数断言归宿；迁入前不得删除。"
  },
  {
    "id": "T3b-04",
    "class": "违规",
    "file": "tests/data/S8E-A08-skip-list.test.ts",
    "line": 39,
    "item": "T3-064",
    "problem": ".lead-ref/books/t-items-T3.md:590 要求所有 language issues 合并后为空，实现改成三个指定路径不出现在 issues，并删除来源。回复 .lead-ref/replies/t-reply-T3.md:124 的不可达结论过强：真实 path 引用可使扫描器加载 dist，见 src/core/workspace/typescript-light-scan.ts:353、:398、:418。",
    "fix": "将新增 a/keep.ts 的一行内容设为 /// <reference path=\"../dist/z.ts\" />，保留三个节点及行数断言，恢复所有 language issues 精确等于 []。"
  },
  {
    "id": "T3b-05",
    "class": "违规",
    "file": "tests/app/S2B-41-decision54-backfill-bound.test.ts",
    "line": 205,
    "item": "T3-011",
    "problem": "新增 messages.readMessage 恒返手造 not_found，没有委托真实依赖，属于 .lead-ref/books/test-rule-sheet-v1.md:68 的 F4，且不在 v2 A7 三个例外中。",
    "fix": "使用同一测试世界的真实依赖构造 createSessionMailbox，将其真实读取端口传给 requeue；入口为 src/core/work-graph/communication/mailbox-service.ts:1045。"
  },
  {
    "id": "T3b-06",
    "class": "违规",
    "file": "tests/runtime/R4b-session-input-boundaries.test.ts",
    "line": 110,
    "item": "T2-025、T3-021",
    "problem": "本文件 :114、:128 及 tests/app/host-settings.test.ts:901、:904 的转换后拒绝例未放入 rejects: 分组，也未按行通过公开读取核对前后状态不变，违反 .lead-ref/books/test-rule-sheet-v1.md:45；T2-025 刷新 .lead-ref/books/t-items-T3.md:90 明确要求按 A6 保留。",
    "fix": "把拒绝行放入 rejects: 分组，每行仅保留一个错误，并分别通过公开 history 读取或 settings snapshot 比较拒绝前后状态；locked 行同时按 T3b-01 修正。"
  },
  {
    "id": "T3b-07",
    "class": "不整洁",
    "file": "tests/app/R6-workbench.test.ts",
    "line": 295,
    "item": "T3-006",
    "problem": "历史子块已移走，但 :295 至 :299 的注释和名称仍声称验证历史顺序及历史占位器处的首次失败；保留主体已从 :302 的任务计划开始。",
    "fix": "将名称和注释改为保留的任务层级、执行依赖及工作链接行为，删除历史与占位器失败描述。"
  },
  {
    "id": "T3b-08",
    "class": "不整洁",
    "file": "tests/runtime/R4c-kernel-history-range.test.ts",
    "line": 406,
    "item": "T2-033",
    "problem": "名称仍声称隔离 damage，但损坏注入已删除；:409、:410 仅建立两个正常 Session，:413、:418 起仅验证分页、尾位置和 Session 隔离。",
    "fix": "删除测试名中的 damage，准确描述正常 Session 的分页及尾位置隔离。"
  }
]
```

会出错 3，违规 3，不整洁 2，建议 0