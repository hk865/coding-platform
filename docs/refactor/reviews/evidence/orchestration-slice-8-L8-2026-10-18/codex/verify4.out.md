**P1、P2、D、R 已修，P3 部分完成。** 本次未写文件、未运行测试；回复中的 RED/GREEN 不作为证据。副本无 `.git`，标签无法独立验证；六个文件的 diff 均与当前内容吻合。

- **P1 fixed**：[architecture-service.ts:1096](D:/cxt/s8l8-review5/src/core/work-graph/architecture/architecture-service.ts:1096) 将 ready capture 的取消出口纳入清理。发表后的取消、业务拒绝、校验/容量失败、提交、恢复和 throw 均经过 `:1265` 释放调用；非 ready 在 `:1090–1093` 保留取消优先级。证明：[gate.test.ts:420](D:/cxt/s8l8-review5/tests/app/S8A-L8-auto-capture-gate.test.ts:420)，`:422、424` 检查释放一次及 current 不变，两后端齐全。
- **P2 fixed**：[architecture-service.ts:1260](D:/cxt/s8l8-review5/src/core/work-graph/architecture/architecture-service.ts:1260) 在 cleanup 前判定异常，`:1268` 不再二次改判。原 signal 已取消时仍返回 cancelled；仅清理期间取消，原 throw 保留。`:457` 保留独立清理 signal；`:1252` receipt 保证 committed、late restore 成功/失败/throw 均保持结果。证明：[gate.test.ts:449](D:/cxt/s8l8-review5/tests/app/S8A-L8-auto-capture-gate.test.ts:449)，`:450` 检查释放一次，两后端齐全。未发现新增错误出口。
- **P3 partly**：[session-anomaly-facts.ts:173](D:/cxt/s8l8-review5/src/core/agent-runtime/session-anomaly-facts.ts:173) 的执行读取及 catch、`:185` Turn、`:136` workspace await 已分别由 `:182/177、186、144` 检查；ready 出口 `:139/153/161/191/198` 均有同一同步段检查，invalid 和非 ready 分流保持。**`:204` 最后一个 await 仍只有 `:203` 前查**：helper 返回 ready 后、外层恢复前取消，仍可能返回 ready。`:123` 也未按书补局部后查，但 `:186` 能兜底。现有证明 [cancelled-reader.test.ts:140](D:/cxt/s8l8-review5/tests/runtime/S1-archive-cancelled-reader.test.ts:140)、`:146` 另有下述违规。
- **D fixed**：[capture-start.test.ts:390](D:/cxt/s8l8-review5/tests/app/S8A-L8-capture-start.test.ts:390) 已删除指定 15 例、三个 body helper 和误导注释；保留行无断言损失，旧 `:798/818` 现为 `:391/411`，断言在 `:407/427`。
- **R fixed**：[host.test.ts:55](D:/cxt/s8l8-review5/tests/app/S8A-L8-auto-capture-host.test.ts:55) 恢复 replay 后 `{requestSeq:1,pending:false}`；`:65` adoption 后 seq2 检查保留。

51 条账本逐条归属如下，均为 **D**。数字都是 `S8A-L8-capture-start.test.ts` 的旧行号；首列覆盖 15 条用例删除，次列覆盖 36 条断言删除：

| 用例行 | 断言行 |
|---|---|
| 416 | — |
| 437 | 454 |
| 458 | 478 |
| 482 | 507、510 |
| 514 | 526、528、529 |
| 533 | 545、553、556、557 |
| 561 | 578、580 |
| 584 | 606、609、611 |
| 615 | 627、629、631 |
| 636 | 654、657 |
| 662 | 678、681 |
| 686 | 702、703、704 |
| 708 | 720、722、732、734 |
| 738 | 755、766、768 |
| 772 | 784、790、793 |

`MOVED:1` 对应旧 `:433` 的相同 cancelled 断言，不表示旧用例保留。累计账本 15 条均属本轮未修改的 S8D/S8E，不重开。

已复扫 **251 行新增测试**。新增违规 **2 个 case**：上述 P3 两例共享 [helper:75](D:/cxt/s8l8-review5/tests/runtime/S1-archive-cancelled-reader.test.ts:75)，手造 `probe:{verdict:'missing',activeRunId:null}` 交内部健康 owner 写成 unavailable，命中 **F1/F3**；真实 owner 不使手造探测结论成为公共输入。沿 V3 口径，每例一个，共享 helper 不另计。

UNSPECIFIED 的事实属实：[fixture:159](D:/cxt/s8l8-review5/tests/helpers/S1-runtime-scenario-fixture.ts:159) 固定 SQLite，但这不是双后端豁免，两例仍缺 memory。未发现其他新增 F1–F12 实例、复制生产行为、定时证明非事件或生产常量 oracle；`DEFAULT_SESSION_ARCHIVE_POLICY` 是配置输入。

未发现本轮新引入生产缺陷；P3 最后 await 的取消漏口属于本轮未修净。

rows fixed / partly / not：4 / 1 / 0；ledger weakenings：0；new rule-sheet instances：2；production defects（本轮新引入）：0。