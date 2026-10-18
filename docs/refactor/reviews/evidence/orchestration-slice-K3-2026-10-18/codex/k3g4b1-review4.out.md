仅静态核对，未修改文件、未运行测试或构建。

1. 必须改：失败集合仍可由调用方伪造。`workflow.ts:666`、`workflow.ts:671` 只校验引用形状和项目，没有证明卡在本次连续选择中失败过；公开入口原样转交输入（`core-routes.ts:1083`），命中集合便跳过任务（`workflow.ts:1309`）。因此调用方填入同项目真实卡的引用，就能跳过尚未尝试落实的答复。修改思路：保留内部续传，但把集合限定为本轮可信推进上下文；公开请求不能任意填写，结束后失效。补同项目伪造引用的回归，不能只测坏形状和外项目。

2. 第1项的连续推进修复成立。普通②失败合并旧集合，UR7b 两种②失败也收集引用后统一合并（`workflow.ts:2494`、`workflow.ts:2649`、`workflow.ts:2656`、`workflow.ts:2677`）。只向续选和继续落实步骤携带，其他下一步不带；驱动退出清空当前步骤（`workflow.ts:418`、`workflow.ts:425`；`collaboration-driver.ts:898`）。指定任务失败仍回 `waiting`（`workflow.ts:2493`、`workflow.ts:2676`）。

   新测试确实启动 Host 连续驱动，调用真实推进，并断言 C 已领取、A/B 各一次、两个失败原因及五次调用（`K3-46-review-advance-failures.test.ts:492`、`:512`、`:535`、`:540`、`:545`、`:551`）。卡由正式认定创建、答复走公开入口，故障来自存储包装，没有注入成功事实（`K3-review-card-fixture.ts:272`；`K3-46-review-advance-failures.test.ts:87`、`:263`）。

3. 第2项完成：共用工厂在 `process-sandbox-standin.ts:21`，两例分别调用（`K3-29-disposition-recovery.test.ts:49`；`K3-44-recovery-answers.test.ts:50`）；差异没有改断言（`.lead-ref/rework3.diff:470`、`.lead-ref/rework3.diff:545`）。除第1条外，未发现返工3新增的必须改问题。

4. UNSPECIFIED 均可接受：字段名、空集合省略、规范 JSON 去重、外项目回 `forbidden`、UR7b 收齐失败引用而保留首错（`contracts.ts:205`；`workflow.ts:425`、`workflow.ts:439`、`workflow.ts:672`、`workflow.ts:2649`、`workflow.ts:2656`）。但这些选择不能替代第1条的可信来源校验。

先改完列出的几处