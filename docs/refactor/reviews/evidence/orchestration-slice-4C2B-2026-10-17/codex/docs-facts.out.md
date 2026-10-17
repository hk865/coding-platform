简称：S＝slice-4-SPEC.md；R/E＝B段证据README.md/lead-acceptance.md；I＝.dsh-ref/checks/measure-4c2-investigation.md。

1. S:1083“不在任何清单”：应为仅无卡源；decision-read-model.ts:99仍列message_release，WP2-wiring.test.ts:543确认F06＝2。
2. S:1088“write不是通知”：应仅限scribe_result；note-machine.ts:283允许已接受的结构性write发通知。
3. S:1069回执引“答复1”：该条只讲reason；应引books/s4c2b-impl.md:85、94。
4. S:1110“只有U3允许故障注入”：应为仅U3获准伪造证明；普通读故障仍允许（S:1039）。
5. R:33、E:30“8项是”：应为9项是、2项部分；review2.out.md第11项也是“是”，仅探针未复跑。
6. STATUS.md:232、E:80删掉待审桶失败限制：应恢复。note-scribe-todos.ts:143先读全部桶，:163才筛取消／无计划；失败仍整次unavailable。
7. E:7、STATUS.md:63、AGENTS.md:3的“最终535/8211”：出处仅证明返工3后；返工4后汇总缺失，应待填（s4c2b-docs.md§1）；R:38所引汇总也未提供。
8. I:62“A未改两个文件”：错；verify-measure-fixes.md:360记A改note-read-model.ts +464、note-views.ts +177。
9. I:39目录“1次”：应区分一次目录窗口与两次底层读取；measure-4c2-after.out.json支持627＝610＋15＋2。

事实核对完