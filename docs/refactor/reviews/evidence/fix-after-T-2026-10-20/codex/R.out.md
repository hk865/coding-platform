| 编号 | 类别 | 位置（file:line） | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| R-01 | 会出错 | `scripts/verify-isolated.mjs:50` | TFR-11 | 运行隔离验证时，若临时页面写入因磁盘满等原因失败，尚未进入 `:51` 的 try，因而不会执行 `:64` 的目录删除；`:69` 只删除另一处隔离副本。 | 将页面写入放进现有外层 try，置于创建 Host 之前。 |
| R-02 | 违规 | `src/core/work-graph/persistence/plan-record-codecs.ts:993` | TFR-02 | 新增了 `noticeAutomationCap` 透传；基线只返回 `since`（`.lead-ref/base/src/core/work-graph/persistence/plan-record-codecs.ts:990`），冻结条目仅授权 since、排序和 seed 绑定调整（`.lead-ref/tf-findings.md:42`）。 | 删除 cap 的条件展开，保留 since 必需化；纠正回复中的“保留 noticeAutomationCap”（`.lead-ref/replies/tf-r1-reply.md:10`）。 |
| R-03 | 违规 | `tests/work-graph/A2-step1-codecs.test.ts:434` | TFR-05 | 转换仍接受手造事实：前置夹具手造完成事件并提交（`tests/helpers/R3e-evidence-fixture.ts:254`、`:265`）；新增测试手造成功进程观测（`tests/work-graph/A2-step1-codecs.test.ts:406`），并直接报告 `host_restart`（`:441`）。不满足规则表 F3/F6 的真实流程要求（`docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md:64`、`:73`）。 | 完整改用真实 Runtime、检查执行和具名故障后的启动核对流程；不能完成则按冻结条目整行恢复、记 BLOCKED（`.lead-ref/tf-findings.md:45`）。 |
| R-04 | 违规 | `tests/work-graph/A2-step1-codecs.test.ts:482` | TFR-05 | 新增期望调用生产函数 `chainEvidenceIds(root)`；生产后继轮也调用同一函数（`src/core/work-graph/state/verification-machine.ts:647`）。函数漏算时两边同错仍通过，违反独立手算期望要求（`.lead-ref/books/tf-book.md:152`）。 | 根据固定场景手算证据 ID，写独立期望及推导注释，删除该生产函数的测试导入。 |
| R-05 | 不整洁 | `src/core/work-graph/sessions/session-record-codecs.ts:715` | TFR-04 | 新注释称只有 available 可以保留 null，但实际非 unavailable 分支也接受 recoverable/null（`:721`）。这是注释错误，未发现因此改变当前写入行为。 | 改为“unavailable 必须携带认可结论；available 保留合法 null”，删除“only”。 |
| R-06 | 不整洁 | `src/core/work-graph/persistence/evidence-record-codecs.ts:185`；`tests/work-graph/A2-step1-codecs.test.ts:531` | TFR-05 | 注释称缺失 cause 会读成 null；解码实际只解析 JSON 并删除顶层通知字段，check 的缺失字段仍缺失（`src/core/work-graph/persistence/evidence-record-codecs.ts:348`、`:375`）。 | 改为“非 interrupted 的 cause 可缺失或为 null”，删除归一化承诺。 |
| R-07 | 不整洁 | `.lead-ref/replies/tf-r1-reply.md:16`；`.lead-ref/books/tf-r2-book.md:12` | TFR-08 | “RUN-23 没有 authorization”的证据不成立：该路径先要求正式 V2 授权（`src/core/work-graph/state/run-machine.ts:2126`、`:1166`），结束记录仍写入授权（`:1025`、`:994`）。 | 由 lead 修正证据说明，保留冻结裁定和现有代码；不要继续把 RUN-23 写成无授权 fallback 的可达证明。 |

逐行结论：

- TFR-01: OK（固定 exact 0，秘书名称 complete 固定 true：`src/core/work-graph/views/work-line-reader.ts:305`、`:1783`）。
- TFR-02: R-02；其余 since 校验、排序收紧和 seed 绑定符合条目（`src/core/work-graph/persistence/plan-record-codecs.ts:120`、`:988`；`tests/helpers/S5-decision-fixture.ts:1236`）。
- TFR-03: OK（`src/core/work-graph/tasks/unknown-call-review-service.ts:1496`）。
- TFR-04: R-05；功能修改和两处 mutation 符合重做要求（`src/core/work-graph/sessions/session-record-codecs.ts:717`；`tests/work-graph/R4c-task-claim-boundaries.test.ts:96`；`tests/work-graph/R4c-task-claim.test.ts:249`）。
- TFR-05: R-03、R-04、R-06。
- TFR-06: OK（`src/core/work-graph/state/session-availability.ts:603`；`src/core/work-graph/state/transition.ts:53`）。
- TFR-07: OK，就恢复映射及四处调用而言；与 tf-base 逐字相等未独立核实（`src/core/work-graph/evidence/evidence-service.ts:180`、`:924`、`:926`、`:1279`、`:1281`）。
- TFR-08: R-07；保留代码的裁定已遵守，但回复中的 RUN-23 可达性证据不成立（`src/core/agent-runtime/runtime.ts:304`）。
- TFR-09: OK（`src/business/workflow/session-maintenance.ts:338`、`:590`）。
- TFR-10: OK，就 BLOCKED 的静态依据及撤线而言：跨 Runtime 观察者缺清理证明时，有 controls 会阻止终态写入；两个 K3 helper 的新增接线已撤销（`src/core/agent-runtime/execution-observation.ts:768`；`tests/runtime/B2-runtime-execution.test.ts:374`、`:483`；`.lead-ref/parts/R.diff:597`、`:625`）。
- TFR-11: R-01；真实占位符、三项检查和 publicDir 接线正确（`scripts/verify-isolated.mjs:46`、`:52`、`:57`、`:60`、`:62`；`src/app/host.ts:1593`；`src/app/server.ts:202`、`:204`）。
- TFR-12: OK（各项修改见 `.lead-ref/parts/R.diff:54`、`:144`、`:353`、`:376`、`:430`、`:439`、`:468`、`:507`、`:537`、`:712`）。

TFR-04 的 unavailable 记录构造点均带结论：`releaseSessionRecord` 写 `kernel_turn_open`（`src/core/work-graph/state/session-availability.ts:389`），调用者为 `src/core/work-graph/tasks/execution-entry-service.ts:914`、`src/core/work-graph/queries/query-execution.ts:649`、`:1615`；`observeSessionHealthRecord` 校验并写入 `missing/damaged`（`src/core/work-graph/state/session-availability.ts:443`、`:447`、`:451`），调用者为 `src/core/work-graph/sessions/session-health.ts:121`。对应状态迁移也携带结论（`src/core/work-graph/state/session-availability.ts:769`、`:895`、`:909`）。冻结成员 `retired_unrecorded` 保留（`src/contracts/work-line.ts:46`）。

TFR-05 的 ledger 七条旧断言均有对应保留：两条完整往返和五条查找，双后端仍在；未发现这些替换本身弱化（`.lead-ref/replies/ledger-r1.txt:4`；`tests/work-graph/A2-step1-codecs.test.ts:470`、`:487`、`:497`）。新增缺失/null cause 拒绝例针对正确检查，pending 缺 cause 接受例也与 codec 一致（`tests/work-graph/A2-step1-codecs.test.ts:528`、`:529`、`:532`；`src/core/work-graph/persistence/evidence-record-codecs.ts:186`、`:189`）。

TFR-10 的 tf-base 相等声明仍未独立验证：所给 base 含有待撤销的 controls 接线，不能直接充当 tf-base 原件；已确认的是这些接线被删除（`.lead-ref/base/tests/helpers/K3-35-runtime.ts:177`；`.lead-ref/base/tests/helpers/K3-blocked-command-fixture.ts:284`；`.lead-ref/parts/R.diff:613`、`:641`）。DSH 的“git diff 为空”仍只是回复声明（`.lead-ref/replies/tf-r1-reply.md:24`）。

```json
[
  {
    "id": "R-01",
    "class": "会出错",
    "file": "scripts/verify-isolated.mjs",
    "line": 50,
    "row": "TFR-11",
    "problem": "隔离验证中，临时页面写入失败发生在:51的try之前，跳过:64的publicDir清理；:69只删除另一处隔离副本。",
    "fix": "将页面写入放进现有外层try，置于创建Host之前。"
  },
  {
    "id": "R-02",
    "class": "违规",
    "file": "src/core/work-graph/persistence/plan-record-codecs.ts",
    "line": 993,
    "row": "TFR-02",
    "problem": "新增noticeAutomationCap透传；基线.lead-ref/base/src/core/work-graph/persistence/plan-record-codecs.ts:990只返回since，冻结条目.lead-ref/tf-findings.md:42未授权此扩展。",
    "fix": "删除cap条件展开，保留since必需化，并纠正.lead-ref/replies/tf-r1-reply.md:10的保留cap说明。"
  },
  {
    "id": "R-03",
    "class": "违规",
    "file": "tests/work-graph/A2-step1-codecs.test.ts",
    "line": 434,
    "row": "TFR-05",
    "problem": "转换仍依赖手造事实：tests/helpers/R3e-evidence-fixture.ts:254、:265手造并提交Run完成事实；测试:406手造成功观测，:441直接报告host_restart，违反规则表F3/F6。",
    "fix": "完整改用真实Runtime、检查执行和具名故障后的启动核对流程；不能完成则按.lead-ref/tf-findings.md:45整行恢复并记BLOCKED。"
  },
  {
    "id": "R-04",
    "class": "违规",
    "file": "tests/work-graph/A2-step1-codecs.test.ts",
    "line": 482,
    "row": "TFR-05",
    "problem": "期望调用生产chainEvidenceIds；src/core/work-graph/state/verification-machine.ts:647也调用该函数，漏算可使两边同错仍通过，违反.lead-ref/books/tf-book.md:152的独立期望要求。",
    "fix": "根据固定场景手算证据ID，写独立期望及推导注释，删除该生产函数的测试导入。"
  },
  {
    "id": "R-05",
    "class": "不整洁",
    "file": "src/core/work-graph/sessions/session-record-codecs.ts",
    "line": 715,
    "row": "TFR-04",
    "problem": "注释称只有available可以保留null，但:721的非unavailable分支也接受recoverable/null。",
    "fix": "改为unavailable必须携带认可结论、available保留合法null，删除only限定。"
  },
  {
    "id": "R-06",
    "class": "不整洁",
    "file": "src/core/work-graph/persistence/evidence-record-codecs.ts",
    "line": 185,
    "row": "TFR-05",
    "problem": "此处及tests/work-graph/A2-step1-codecs.test.ts:531称缺失cause读成null，但解码:348、:375未补字段，缺失仍缺失。",
    "fix": "两处均改为非interrupted的cause可缺失或为null，删除归一化承诺。"
  },
  {
    "id": "R-07",
    "class": "不整洁",
    "file": ".lead-ref/replies/tf-r1-reply.md",
    "line": 16,
    "row": "TFR-08",
    "problem": "此处及.lead-ref/books/tf-r2-book.md:12称RUN-23无authorization；实际src/core/work-graph/state/run-machine.ts:2126、:1166要求V2授权，:1025、:994在结束记录中保留授权。",
    "fix": "由lead修正证据说明，保留冻结裁定和现有代码，不再把RUN-23列为无授权fallback的可达证明。"
  }
]
```

会出错 1，违规 3，不整洁 3，建议 0