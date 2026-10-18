只读核对完成，未修改文件，未运行测试或构建。四项修改均已落实，但还有一处生产缺口。

1. **是。** K3-13 已经走 `reconcileRun → resolveUnknownRun → claimTask(review)`；摘要为真实 SHA-256，覆盖 memory/SQLite，并保留第二项 `undetermined/settlement/核对轮没有给出结论` 的断言（[K3-13-two-items-owner.test.ts:59、94、152、159、184、248](/D:/cxt/k3g3e-review/tests/work-graph/K3-13-two-items-owner.test.ts:59)）。

2. **是。** 长任务说明经公开 `plans/propose/apply` 写入（[plan.ts:195、199](/D:/cxt/k3g3e-review/tests/scenarios/support/plan.ts:195)）；真实 prepare 产出 `unexpanded`，脚本模型经真实 Runtime 调用工具写结论，再由 Workflow 清算、HTTP 回读；两种 `undetermined`、无 `crash_possible`、保留模型原文均有断言（[K3-42-unexpanded-r2.test.ts:109、147、155、164、170、181、185、189](/D:/cxt/k3g3e-review/tests/scenarios/K3-42-unexpanded-r2.test.ts:109)）。

3. **是。** prepare 使用公开领取后读回的 Run（[K3-large-review-input.ts:426、431、483](/D:/cxt/k3g3e-review/tests/helpers/K3-large-review-input.ts:426)），并断言它与 owner 的 `activeRound` 一致（[K3-35-owner-manifest-trim.test.ts:179](/D:/cxt/k3g3e-review/tests/work-graph/K3-35-owner-manifest-trim.test.ts:179)）。

4. **是。** A1 已只锁定 `unavailable`、原因非空，以及无领取、准备、启动和模型调用，不再锁死原因措辞（[K3-19-missing-read-no-round.test.ts:185、187、193、201](/D:/cxt/k3g3e-review/tests/scenarios/K3-19-missing-read-no-round.test.ts:185)）。

**建议：验收材料注明仍有替身。** K3-13 仍手补空 `items` 的准备清单，并替代显示映射读取（[K3-13-two-items-owner.test.ts:86、125](/D:/cxt/k3g3e-review/tests/work-graph/K3-13-two-items-owner.test.ts:86)）；K3-35 仍手造原 Run 的读取结果及 Kernel 历史读取替身（[K3-large-review-input.ts:340、450、473](/D:/cxt/k3g3e-review/tests/helpers/K3-large-review-input.ts:450)）。这些是 owner／容量层的隔离夹具，本轮要求已满足；证据应保留这层限定。

**必须改：`unexpanded` 缺完整 D6 提示。** 实际位置是 [prepared-execution.ts:109、117](/D:/cxt/k3g3e-review/src/contracts/core/prepared-execution.ts:109)，不是回复所写的 `execution-preparation.ts`。未展开分支提前 `continue`，完整句只给截断项。

规格 [slice-K3-SPEC.md:358、1667](/D:/cxt/k3g3e-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:358)明确覆盖两种显示，要求：

> 这条命令没有全文，两个结论（做没做完、会不会是崩溃的原因）一律按判断不了处理；你看到的痕迹照样写进依据。

这是**第 3 组的核对轮输入缺口**；分组明确把核对轮和 K3-42 放在第 3 组，卡片才在第 4 组（SPEC:1568、1569）。不能延后到第 4 组。

修法：保留 SPEC:363 的短底线行，在相邻说明中补全上述提示并明确覆盖未展开项，计入原有容量预算；将目前只检查短句的断言补为检查完整提示（[K3-42-unexpanded-r2.test.ts:168](/D:/cxt/k3g3e-review/tests/scenarios/K3-42-unexpanded-r2.test.ts:168)）。

先改完列出的几处