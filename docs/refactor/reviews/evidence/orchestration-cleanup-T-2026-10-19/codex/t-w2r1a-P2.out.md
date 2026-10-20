只读核对完成；未运行测试、构建或网络请求。发现一处新增注释失准，未发现可证的行为漏测或规则违规。

| 编号 | 类别 | 位置 | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| P2-01 | 不整洁 | `tests/helpers/K3-review-card-fixture.ts:337` | W2b-26 | 新增注释仍引用 S5 的旧行号 `471/497/515`：当前分别是空行、快照索引注释、B2 夹具创建；实际 schema 注册和两层转发在 `tests/helpers/S5-decision-fixture.ts:491`、`:536`、`:281`。 | 将括号内引用改为 `S5-decision-fixture.ts` 的符号名 `additionalSchemas`、`forwarded`、`observeRecords`。 |

重点核对结果：

- **W2b-21：默认路径保留。** `realRuntime` 默认 `false`；新路径的 Session、进入和结束分别走生产 Session owner、共享 Runtime，没有继续调用旧的手写进入/结束函数；`decisionMessages` 原样透传真实 owner，未传选项时不绑定。证据：`tests/helpers/S5-decision-fixture.ts:514`、`:651`、`:950`、`:978`、`:992`、`:1234`；`tests/helpers/S2B-runtime-steps-fixture.ts:349`。
- **422/341 的计算成立。** 新 Kernel Session ID 是 `session-` 加 64 位摘要，共 72 字节；旧值 37 字节，增加 35。两组计算分别为 `156024 + 274 + 422 = 156720`、`156105 + 274 + 341 = 156720`，长短理由总量分别是 162720、157020。证据：`src/core/work-graph/sessions/session-directory.ts:140`；`src/core/agent-runtime/session-operations.ts:272`；`tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:375`、`:416`、`:439`。
- **W2b-23：三项 R-6 理由成立。** origin 来自真实 RUN-22 人工确认输入；startedAt 来自 Kernel `tool.started` 记录时间；规格只限制 detail 的类型和长度，没有固定文案。完整 owner 结果和 receipt 均使用 `toEqual`。证据：`tests/helpers/K3-35-continuation-fixture.ts:678`；`src/core/agent-runtime/run-reconcile.ts:502`；`docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:976`；`tests/business/K3-review-workflow-rows.test.ts:1005`、`:1007`。
- **W2b-26：默认读取行为的变化是本行明确要求的。** 实际进入新冲突读取路径、行为可能变化的 importer 为 `tests/work-graph/K3-13-two-items-owner.test.ts:99`、`tests/work-graph/K3-16-approval-application.test.ts:201`、`tests/work-graph/S2A-queue-window.test.ts:20`。S2A 的内部读取仍使用 `f.records`，未改变外层重试计数边界（`tests/helpers/S2A-window-fixture.ts:38`、`:51`）。
- **W2b-27：`'pass'` 是允许的成功检查命令适配。** 它实际执行 `node -e "process.exit(0)"`，不是返回伪造 PASS；也没有改变被拒请求。真实模式原样转交 sandbox 的 probe 和构造参数，旧执行分支已删除。证据：`tests/scenarios/harness.ts:288`；`tests/scenarios/support/process-sandbox-standin.ts:47`、`:71`、`:74`；`.lead-ref/t-w2b-findings.md:188`。
- **W2b-35：三个断言仍证明指定范围。** CA03 按纠正要求统计不同 manifest 正文，期望 1；CA04 先验证计数器活跃，再真实绑定、采用后继计划、写注记，核对整个 prepared 和三个零读取；CA15 在真实扩展依赖注入故障，并检查全部正文 put 为零。证据：`.lead-ref/books/t-items-T2.md:227`；`tests/runtime/S3-context-assembler.test.ts:641`、`:662`、`:674`、`:677`、`:685`、`:874`；`tests/helpers/WP2-platform-support.ts:244`、`:466`。

逐行结论：

- W2b-19: OK（`tests/work-graph/UCR-settle-review.test.ts:160`、`:184`、`:209`、`:237`、`:295`）
- W2b-21: OK（`tests/helpers/S5-decision-fixture.ts:651`、`:978`、`:992`）
- W2b-22: OK（`tests/work-graph/WP2-context-extensions.test.ts:344`、`:425`、`:461`）
- W2b-23: OK（`tests/business/K3-review-workflow-rows.test.ts:902`、`:1005`、`:1007`）
- W2b-24: OK（`tests/runtime/S4C-note-tools.test.ts:134`、`:157`、`:195`、`:204`、`:211`、`:216`）
- W2b-25: OK（`tests/work-graph/K3-14-unknown-call-review-tool.test.ts:78`、`:84`）
- W2b-26: P2-01
- W2b-27: OK（`tests/scenarios/support/process-sandbox-standin.ts:47`、`:71`）
- W2b-28: OK（`tests/business/K3-46-review-advance-failures.test.ts:551`）
- W2b-29: OK；三个摘要独立重算一致（`tests/runtime/S3-graph-tools.test.ts:115`、`:802`）
- W2b-30: OK（`tests/runtime/S3-graph-tools.test.ts:449`、`:475`、`:500`、`:589`；`tests/runtime/S4C-note-run-task-resolver.test.ts:313`）
- W2b-31: OK（`tests/runtime/S4C-note-run-task-resolver.test.ts:335`、`:341`、`:348`、`:354`、`:356`）
- W2b-32: OK（`tests/scenarios/K3-45-review-incomplete-r2.test.ts:230`）
- W2b-33: OK（`tests/runtime/B2-04-allowance.test.ts:39`；`tests/scenarios/K3-45-review-incomplete-r2.test.ts:118`）
- W2b-34: OK（`tests/work-graph/K3-14-unknown-call-review-tool.test.ts:51`；`tests/helpers/K3-35-continuation-fixture.ts:254`；`tests/work-graph/K3-11-review-reasons.test.ts:22`）
- W2b-35: OK（`tests/runtime/S3-context-assembler.test.ts:628`、`:649`、`:866`）

R-20 核对：

| 行 | 子部分 | 分类是否成立 | 公开步骤可达性 |
|---|---|---|---|
| W2b-23 | settle_review | 未触发 R-20，已完成真实转换（`.lead-ref/t-w2b-findings.md:185`） | 可达：真实 claim/end 后 `select_work`，执行其返回的 `settle_review`（`tests/business/K3-review-workflow-rows.test.ts:889`、`:902`、`:909`） |
| 其余 P2 行 | 无 §6 保留的 R-20 子部分 | 不适用（`.lead-ref/t-w2b-findings.md:181`、`:183`、`:186`、`:190`） | 不适用 |

```json
[
  {
    "id": "P2-01",
    "class": "不整洁",
    "file": "tests/helpers/K3-review-card-fixture.ts",
    "line": 337,
    "row": "W2b-26",
    "problem": "新增注释引用 S5-decision-fixture.ts 的旧行号 471/497/515，当前分别是空行、快照索引注释、B2 夹具创建；实际 schema 注册及转发位于该文件 491、536、281 行。",
    "fix": "将括号内引用改为 S5-decision-fixture.ts 的符号名 additionalSchemas、forwarded、observeRecords。"
  }
]
```

会出错 0，违规 0，不整洁 1，建议 0