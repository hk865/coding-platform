只读核对完成，未写文件、未跑测试。**未发现本次返工的代码行为差异；上轮 1–3 已解决，5 部分解决。**

- **Signal：四处均与 G1 一致。** [claim:495](D:/cxt/c1-g4-review2/src/core/work-graph/tasks/claim-service.ts:495) 允许数组，但仍要求 `aborted:boolean`、`addEventListener:function`；[history:114](D:/cxt/c1-g4-review2/src/core/work-graph/tasks/execution-history-service.ts:114)、[run-state:188](D:/cxt/c1-g4-review2/src/core/work-graph/tasks/run-state-service.ts:188)、[entry:198](D:/cxt/c1-g4-review2/src/core/work-graph/tasks/execution-entry-service.ts:198) 另排除数组。四者的 `forbidden`、各自拒绝全文及检查位置均保持：scope 后、身份克隆前（[trusted-context:43](D:/cxt/c1-g4-review2/src/core/work-graph/tasks/trusted-context.ts:43)）。
- **新增 helper 接线均等价。** canonical 失败仍返回 `null`；parse 仍拒绝坏 JSON、数组、null 和标量；整数仍检查安全整数及原来的 ≥0／≥1 边界，包括 plan-readers。六处 `rejectedWithCurrent` 保留传入的空数组，其余八处不带 `current`，键序保持。task-service 的 [refFromRefKey:106](D:/cxt/c1-g4-review2/src/core/work-graph/tasks/task-service.ts:106) 仍仅检查 JSON 对象形状。
- **范围保持。** 所给 diff 确为 16 文件、+68/−87，均为既有 G4 文件，无新增历史标签、重命名或白名单外文件；[terminalProposalOf:751](D:/cxt/c1-g4-review2/src/core/work-graph/tasks/plan-readers.ts:751) 的签名和函数体与 base 完全相同。run-state 成功结果保持 `ok,ctx,actor`。

| 分类 | 文件:行 | 发现及修法 |
|---|---|---|
| 建议 | [c1-g4-rw1-final.md:9](D:/cxt/c1-g4-review2/.lead-ref/c1-g4-rw1-final.md:9) | “接受任意非 null 对象”表述错误，**代码正确**。G1 [claim:533](D:/cxt/c1-g4-review2/.lead-ref/g1base/src/core/work-graph/tasks/claim-service.ts:533) 已要求两个 signal 属性。反例：`{}`、`[]` 新旧都拒绝；`Object.assign([], {aborted:false, addEventListener(){}})` 新旧 claim 都接受，另外三处都拒绝。修正回报即可。 |
| 不整洁 | [c1-g4-rw1-final.md:25](D:/cxt/c1-g4-review2/.lead-ref/c1-g4-rw1-final.md:25) | “完整接口表”仍漏掉 `waitPredecessorWalk`，上轮第 5 项未完全解决。按 [goal-settings-service.ts:105](D:/cxt/c1-g4-review2/src/core/work-graph/tasks/goal-settings-service.ts:105) 补上 `(records: GoalRecordTransactionPort, startRef: GoalRef, start: GoalSnapshot): Promise<{ waitingCycle: boolean } \| CoreRejection>`。其余参数、六字段顺序、G3 前提和成功字段说明已补正。 |

会出错 0 项，不整洁 1 项。