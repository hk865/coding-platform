**0 会出错。** 原问题已修复，未发现新增问题。

- LAST 直接取 `seedCommit([])` 的成功回执 `receipt.cursor`，不再来自存储或读取器。[测试:20](D:/cxt/fix85-recheck/tests/work-graph/S5-goal-cause-at-least-cursor.test.ts:20)；[夹具:517](D:/cxt/fix85-recheck/tests/helpers/S5-decision-fixture.ts:517)。
- 新提交只追加种子事件并推进水位，不改业务记录。用例1仍要求 `LAST+1`；静态推断，基线仍会返回 `ready`，因此仍因忽略水位要求而失败。[夹具:525](D:/cxt/fix85-recheck/tests/helpers/S5-decision-fixture.ts:525)；[用例1:27](D:/cxt/fix85-recheck/tests/work-graph/S5-goal-cause-at-least-cursor.test.ts:27)。
- 用例2、3仍分别验证等于、早于 LAST 时结果不变；用例4仍验证 `forbidden`、`not_found` 优先于 `not_ready`。新增提交不改变这些条件。[测试:38](D:/cxt/fix85-recheck/tests/work-graph/S5-goal-cause-at-least-cursor.test.ts:38)（另见同文件:46、:55）。

仅静态核对；未写文件、未运行测试或构建、未联网。