报告已写入 `./t-F.md`（755 行，含表格、JSON、合计与覆盖说明）。

各类条数：stale 5、duplicate 8、trivial 0、handwritten 6、tamper 1、helper 30，共 50 条，预计删除/改动约 3,083 行（S5 四份 fixture 合并约 1,800 行为上限）。最大发现是 S5 四份复制、S1 第二份 claim+B2、A2 死重复 helper，以及 325 个无人 import 的 export。

未完成：5 个 helper 未逐行读——`S2A-planning-fixture.ts`、`S2B-activity-fixture.ts`（590 行，仅 grep）、`S2B-be1r2-support.ts`、`S2B-r3-r4-support.ts`、`S2B-runtime-tools-support.ts`。另有 4 类决定 79-1 旧格式项只给 keep-note，待生产侧先清。