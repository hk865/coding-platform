| 编号 | 类别 | 位置 | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| — | — | — | W2b-20 | 未发现既有审查意见之外、可证明的新增问题 | — |

核对结果：

- 第二 Goal 确实经过公开采用、带 `goalRef` 的领取、真实 Session 和 Runtime；两个后端恢复了 Goal 排除及跨 Goal open 断言。证据：`tests/helpers/S5-decision-fixture.ts:792`、`:803`、`:652`；`tests/helpers/K3-35-continuation-fixture.ts:452`、`:507`；`tests/work-graph/unknown-call-review-list.test.ts:95`、`:201`、`:218`、`:236`、`:255`。
- P2 的边界游标来自真实宽页，并原样传入后续查询。证据：`.lead-ref/parts/P2.diff:285`、`:292`。
- 规模测试单独使用 `600_000`，注明测量条件和耗时，保留 200＋5 条、顺序及末页无游标断言。证据：`.lead-ref/parts/P2.diff:180`、`:302`、`:333`；`tests/work-graph/unknown-call-review-list.test.ts:348`、`:350`、`:355`、`:357`。
- 排序推导正确：规范键顺序使 goalId 先于 runId；UTF-8 字节序使 A 在 B 前，固定宽度递增 Run id 保持 B 内先后顺序。证据：`src/contracts/fingerprint.ts:45`；`src/core/work-graph/tasks/unknown-call-review-codecs.ts:544`；`src/core/record-store/lookup-index.ts:574`；`tests/helpers/B2-crr-world.ts:56`。
- **R-15：实际改变行为的 importer 只有 `tests/work-graph/unknown-call-review-list.test.ts`**，它显式启用真实 Session、第二 Goal 授权和共享 harness（`:76`、`:94`、`:338`）。其余导入者保持默认路径，未改变原有 ID、位置或时间的产生步骤。证据：`tests/helpers/B2-crr-world.ts:138`、`:141`、`:197`；`tests/helpers/K3-35-runtime.ts:146`、`:195`。

W2b-20: OK

```json
[]
```

会出错 0，违规 0，不整洁 0，建议 0