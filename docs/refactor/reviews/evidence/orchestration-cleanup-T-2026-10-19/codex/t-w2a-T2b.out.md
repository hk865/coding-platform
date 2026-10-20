本次只读审查发现 8 项；未运行测试、构建或网络操作，未修改文件。以下 `OK` 仅表示本分片涉及的改动通过静态审查。

**1. 发现表**

| 编号 | 类别 | 位置 | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| T2b-01 | 会出错 | `tests/work-graph/unknown-call-review-list.test.ts:173`、`:205` | T1-070 | 两例现在只生成 Goal B 的记录，workspace 查询也只期望 B 的两条记录（`:176`、`:211`）。基线原有第二 Goal 和跨 Goal 排除、汇总断言（`.lead-ref/base/tests/work-graph/unknown-call-review-list.test.ts:85`、`:115`）。具体漏检：A、B 各有一条 pending 时，漏掉 Goal 筛选的实现会在查询 A 时错误返回两条；当前全是 B，漏掉该筛选仍能通过这两例。条目明确要求保留 Goal/open 过滤（`.lead-ref/books/t-items-T2.md:88`），BLOCKED 也不允许删除覆盖（`.lead-ref/books/t-book.md:87`）。 | 经共享真实 Runtime 为第二 Goal 产生记录，补回指定 Goal 排除另一 Goal、workspace 包含两 Goal 的原有断言及双后端覆盖。 |
| T2b-02 | 违规 | `tests/helpers/S5-decision-fixture.ts:620`、`:859`、`:908` | T1-016、T1-018、T1-023、T1-061、T1-067、T1-070 | 转换仍继承手造 Session/Run：自选 Kernel Session 身份并直接写入、报告创建（`:620`）；自选 Run/Turn、position/history 并报告 entered（`:859`）。初始化无条件调用该路径（`:908`），K3 世界又无条件调用此初始化（`tests/helpers/K3-review-card-fixture.ts:156`）。这些条目的公共初始化要求尚未完成，尤其刷新明确要求补真实 Session/Run（`.lead-ref/books/t-items-T2.md:66`、`:84`）。违反平台生成值规则；旧 fixture 没有豁免（`.lead-ref/books/t-book.md:71`、`:80`）。 | 在共享 S5 fixture 中，以真实 `createSessionOperations(...).createSession` 创建 Session；以共享 `createS2BRuntimeSteps` 完成 Run 的进入、结束，保存真实返回值并公开读回。同步替换 `settleRun` 的手造结束事实（`tests/helpers/S5-decision-fixture.ts:877`），保留调用方业务断言。 |
| T2b-03 | 违规 | `tests/work-graph/unknown-call-review-list.test.ts:240` | T1-070 | 用生产函数 `unknownCallReviewRefKey` 从记录重建 cursor，再作为查询输入（`:246`），没有使用公开分页返回的 cursor。违反 `.lead-ref/books/test-rule-sheet-v2.md:32`；真实 cursor 由列表服务返回（`src/core/work-graph/tasks/unknown-call-review-service.ts:1538`）。 | 增加后续真实记录，先通过较宽过滤条件分页取得位于目标边界的 `nextCursor`，原样传入 pending-only 查询；保留空列表和 `nextCursor: null` 断言。 |
| T2b-04 | 违规 | `tests/helpers/K3-review-card-fixture.ts:336` | T3-103 | 仍注入固定假 reader。回复把此调用及 `tests/helpers/S2A-window-fixture.ts:48` 都称为白名单外（`.lead-ref/replies/t-reply-T2.md:79`），但二者明确在白名单（`.lead-ref/books/t-files-T2.txt:13`、`:14`）。真实 schema、索引和转发已具备（`tests/helpers/S5-decision-fixture.ts:471`、`:497`、`:515`），条目要求接真实 reader（`.lead-ref/books/t-items-T2.md:538`）。 | 将两处分别接入 `createGoalExecutedFilesReader({ records })` 和 `createGoalExecutedFilesReader({ records: inner })`，更正 BLOCKED 说明；仅为确实在白名单外的 app 调用保留共享 stub。 |
| T2b-05 | 违规 | `tests/scenarios/K3-29-disposition-recovery.test.ts:95`；`tests/scenarios/K3-44-recovery-answers.test.ts:180` | T2-040、T2-046 | 两处仍开启 `sandbox.executeChecks = true`，由 stand-in 执行并拼装检查结果（`tests/scenarios/support/process-sandbox-standin.ts:48`）。A7 只允许 `executeChecks: false` 的 probe，且明确点名这两个文件为 wave-2 待处理实例（`.lead-ref/books/test-rule-sheet-v2.md:59`、`:64`）。 | 两例的正式检查改走真实 ProcessSandbox，移除执行检查的 stand-in 路径，保留业务断言；由已有 bwrap 全量入口验证。 |
| T2b-06 | 违规 | `tests/runtime/B2-04-allowance.test.ts:39` | T2-019 | 合并目标名称只有 B2-04，遗漏来源名称中的 `B2-09b (owner part)`（`.lead-ref/base/tests/runtime/B2-09-allowance-crash.test.ts:65`），违反合并后保留规格行编号规则（`.lead-ref/books/t-book.md:62`）。四条独有断言已迁入（`tests/runtime/B2-04-allowance.test.ts:58`、`:59`、`:70`、`:71`）。 | 仅将目标测试名称补为同时包含 `B2-04 / B2-09b (owner part)`，断言不动。 |
| T2b-07 | 不整洁 | `tests/scenarios/C6-unrelated-adoption.test.ts:11`、`:21` | T2-039 | 文件头仍把已删除的 Host `plans/apply` 变体列为现存 case 2，并描述它附加的断言；该独立变体已由本次删除（`.lead-ref/parts/T2b.diff:1911`）。 | 更新当前用例列表，将 case 2 标明已合并入主路径；保留历史迁移事实，去掉它仍作为独立用例存在的表述。 |
| T2b-08 | 不整洁 | `tests/scenarios/K3-18-one-card.test.ts:100` | T2-042 | 删除本地 `crashOneCommand` 后，其“返回 original RunRef”注释遗留在 `needsDecisionCard` 自身注释前；后者实际返回包含 RunRef、record、card 的对象（`:101`、`:102`）。 | 删除第 100 行遗留注释，保留 `needsDecisionCard` 自身说明。 |

**2. 逐条结论**

- T1-002: OK（`tests/scenarios/K3-45-review-incomplete-r2.test.ts:201`）
- T1-016: T2b-02
- T1-017: OK（`.lead-ref/parts/T2b.diff:4209`）
- T1-018: T2b-02
- T1-021: OK（`tests/work-graph/K3-47-reader-facts.test.ts:208`）
- T1-023: T2b-02
- T1-061: T2b-02
- T1-067: T2b-02（本分片的共享 S5 前置）
- T1-070: T2b-01、T2b-02、T2b-03
- T2-010: OK（`.lead-ref/parts/T2b.diff:1333`）
- T2-011: OK（`tests/record-store/R3a-transaction-boundaries.test.ts:43`）
- T2-012: OK（`tests/record-store/S2A-ordered-lookup.test.ts:40`）
- T2-016: OK（`tests/record-store/SP-literal-type.test.ts:30`；`.lead-ref/parts/T2b.diff:1125`）
- T2-017: OK（`tests/record-store/lookup.test.ts:174`）
- T2-018: OK（`.lead-ref/parts/T2b.diff:1699`）
- T2-019: T2b-06
- T2-026: OK（`.lead-ref/parts/T2b.diff:1776`）
- T2-027: OK（`tests/runtime/R4b-session-operations.test.ts:51`）
- T2-039: T2b-07
- T2-040: T2b-05
- T2-041: OK（`tests/scenarios/K3-05-review-round.test.ts:80`、`:154`、`:179`）
- T2-042: T2b-08
- T2-043: OK（`tests/scenarios/K3-05-review-round.test.ts:109`、`:160`、`:179`）
- T2-044: OK（`.lead-ref/parts/T2b.diff:2340`、`:2917`）
- T2-046: T2b-05
- T2-048: OK（`tests/scenarios/K3-R1-restart-flows.test.ts:84`；`.lead-ref/parts/T2b.diff:3542`）
- T2-054: OK（`.lead-ref/parts/T2b.diff:3653`）
- T2-055: OK（`.lead-ref/parts/T2b.diff:3653`）
- T2-063: OK（`tests/state/k3-review-claim.test.ts:79`、`:92`）
- T3-028: OK（`tests/helpers/K3-review-card-fixture.ts:499`）
- T3-030: OK（`tests/helpers/K3-review-card-fixture.ts:597`）
- T3-034: OK（`tests/helpers/K3-review-card-fixture.ts:562`）
- T3-044: OK（`.lead-ref/parts/T2b.diff:45`）
- T3-077: OK（`tests/helpers/B2-401-world.ts:185`）
- T3-079: OK（`tests/helpers/K3-proposal-round.ts:836`）
- T3-084: OK（`.lead-ref/parts/T2b.diff:386`）
- T3-102: OK（`.lead-ref/parts/T2b.diff:1196`）
- T3-103: T2b-04
- T3-105: OK（本分片可选参数及默认值：`tests/helpers/WP2-platform-support.ts:106`、`:467`）

**3. Partial 和 BLOCKED 核对**

| 条目 | 部分 | DSH 理由是否真实 | 是否存在公开步骤 |
|---|---|---|---|
| T1-070 | 第二 Goal 的记录与跨 Goal 过滤 | **限制真实，unreachable 分类不成立。** K3-35 helper 确实限定 Goal B（`tests/helpers/K3-35-runtime.ts:113`）；这只能证明该 helper 拒绝。且声明阻塞后仍删减覆盖，见 T2b-01。回复位置：`.lead-ref/replies/t-reply-T2.md:77`。 | **存在。** 公开创建 Session、claim 后使用共享 Runtime 的 prepare/start，再经真实中断与 reconcile 产生记录。共享授权按 Run 配置核对，没有固定 Goal B 限制（`tests/helpers/S2B-runtime-steps-fixture.ts:232`、`:338`、`:367`）。需要的可选能力可以按共享 Runtime 例外补充（`.lead-ref/books/t-book.md:44`）。 |
| T3-103 | K3-review-card、S2A-window 两个 helper | **不真实。** 回复称白名单外（`.lead-ref/replies/t-reply-T2.md:79`），白名单却明确包含二者（`.lead-ref/books/t-files-T2.txt:13`、`:14`）。见 T2b-04。 | **存在。** 使用 `createGoalExecutedFilesReader`；真实注册及 ordered lookup 转发已在 `tests/helpers/S5-decision-fixture.ts:471`、`:497`、`:515`。 |
| T3-103 | app 调用使共享 stub 暂不能删除 | **真实的范围阻塞。** `tests/app/S5-decision-routes.test.ts:223` 仍调用 stub，且不在本组白名单；范围规则见 `.lead-ref/books/t-book.md:48`，回复见 `.lead-ref/replies/t-reply-T2.md:79`。不是平台状态不可达。 | **真实 reader 已存在。** 阻塞的是该调用方的修改范围；本组应保留共享 stub，完成白名单内转换。真实 reader 的已接入例见 `tests/helpers/S5-application-support.ts:1` 对应改动（`.lead-ref/parts/T2b.diff:974`）。 |

**4. 同表 JSON**

```json
[
  {
    "id": "T2b-01",
    "class": "会出错",
    "file": "tests/work-graph/unknown-call-review-list.test.ts",
    "line": 173,
    "item": "T1-070",
    "problem": "Goal/status 与 workspace/open 两例只生成 Goal B 的记录，并删减了第二 Goal 的期望（当前文件:176、:205、:211；基线 .lead-ref/base/tests/work-graph/unknown-call-review-list.test.ts:85、:115）。具体漏检：A、B 各有一条 pending 时，漏掉 Goal 筛选的实现查询 A 会错误返回两条；当前全是 B，该错误仍能通过这两例。违反保留过滤覆盖要求（.lead-ref/books/t-items-T2.md:88），BLOCKED 不允许删除覆盖（.lead-ref/books/t-book.md:87）。",
    "fix": "经共享真实 Runtime 为第二 Goal 产生记录，补回指定 Goal 排除另一 Goal、workspace 包含两 Goal 的原有断言及双后端覆盖。"
  },
  {
    "id": "T2b-02",
    "class": "违规",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "line": 620,
    "item": "T1-016、T1-018、T1-023、T1-061、T1-067、T1-070",
    "problem": "共享初始化仍自选 Kernel Session 身份并写入、报告创建（:620），自选 Run/Turn、position/history 并报告 entered（:859），初始化无条件执行（:908）；K3 世界无条件继承该前置（tests/helpers/K3-review-card-fixture.ts:156）。真实 Session/Run 前置要求未完成（.lead-ref/books/t-items-T2.md:66、:84），违反平台生成值规则且旧 fixture 无豁免（.lead-ref/books/t-book.md:71、:80）。",
    "fix": "在共享 S5 fixture 中以真实 createSessionOperations(...).createSession 创建 Session，以 createS2BRuntimeSteps 完成 Run 进入、结束，保存真实返回值并公开读回；同步替换 :877 的手造结束事实，保留调用方业务断言。"
  },
  {
    "id": "T2b-03",
    "class": "违规",
    "file": "tests/work-graph/unknown-call-review-list.test.ts",
    "line": 240,
    "item": "T1-070",
    "problem": "以生产函数 unknownCallReviewRefKey 从记录重建 cursor，并在 :246 作为查询输入；没有使用公开分页返回值，违反 .lead-ref/books/test-rule-sheet-v2.md:32。真实 cursor 返回位置为 src/core/work-graph/tasks/unknown-call-review-service.ts:1538。",
    "fix": "增加后续真实记录，通过较宽过滤条件分页取得目标边界 nextCursor，原样传入 pending-only 查询，保留空列表和 nextCursor:null 断言。"
  },
  {
    "id": "T2b-04",
    "class": "违规",
    "file": "tests/helpers/K3-review-card-fixture.ts",
    "line": 336,
    "item": "T3-103",
    "problem": "此处及 tests/helpers/S2A-window-fixture.ts:48 仍用假 reader。回复以白名单外阻塞（.lead-ref/replies/t-reply-T2.md:79），但白名单明确包含二者（.lead-ref/books/t-files-T2.txt:13、:14）；真实注册和转发已具备（tests/helpers/S5-decision-fixture.ts:471、:497、:515），未完成条目要求（.lead-ref/books/t-items-T2.md:538）。",
    "fix": "两处分别接入 createGoalExecutedFilesReader({ records }) 和 createGoalExecutedFilesReader({ records: inner })，更正 BLOCKED 说明；仅为白名单外的 app 调用保留共享 stub。"
  },
  {
    "id": "T2b-05",
    "class": "违规",
    "file": "tests/scenarios/K3-29-disposition-recovery.test.ts",
    "line": 95,
    "item": "T2-040、T2-046",
    "problem": "此处及 tests/scenarios/K3-44-recovery-answers.test.ts:180 仍开启 sandbox.executeChecks=true，由 stand-in 执行并拼装结果（tests/scenarios/support/process-sandbox-standin.ts:48）。A7 只允许 executeChecks:false 的 probe，并明确点名这两处为 wave-2 实例（.lead-ref/books/test-rule-sheet-v2.md:59、:64）。",
    "fix": "两例正式检查改走真实 ProcessSandbox，移除执行检查的 stand-in 路径，保留业务断言，由已有 bwrap 全量入口验证。"
  },
  {
    "id": "T2b-06",
    "class": "违规",
    "file": "tests/runtime/B2-04-allowance.test.ts",
    "line": 39,
    "item": "T2-019",
    "problem": "合并目标名称遗漏来源的 B2-09b (owner part)（.lead-ref/base/tests/runtime/B2-09-allowance-crash.test.ts:65），违反 .lead-ref/books/t-book.md:62；四条独有断言已迁入当前文件 :58、:59、:70、:71。",
    "fix": "仅将目标测试名称补为同时包含 B2-04 / B2-09b (owner part)，断言不动。"
  },
  {
    "id": "T2b-07",
    "class": "不整洁",
    "file": "tests/scenarios/C6-unrelated-adoption.test.ts",
    "line": 11,
    "item": "T2-039",
    "problem": "文件头 :11、:21 仍将 Host plans/apply 变体描述为现存独立 case 2，但该变体已删除（.lead-ref/parts/T2b.diff:1911）。",
    "fix": "更新当前用例列表，将 case 2 标明已合并入主路径；保留历史迁移事实，去掉它仍作为独立用例存在的表述。"
  },
  {
    "id": "T2b-08",
    "class": "不整洁",
    "file": "tests/scenarios/K3-18-one-card.test.ts",
    "line": 100,
    "item": "T2-042",
    "problem": "本地 crashOneCommand 删除后，其返回 original RunRef 的注释残留在 needsDecisionCard 自身注释前；后者返回包含 RunRef、record、card 的对象（:101、:102）。",
    "fix": "删除第 100 行遗留注释，保留 needsDecisionCard 自身说明。"
  }
]
```

会出错 1，违规 5，不整洁 2，建议 0