继续当前 R3b WG Session；范围仍仅 applicability.ts / material-service.ts，已通过的7+6项不得回归。主 Agent/Sol 冻结新增 tests/data/R3b-material-await-boundaries.test.ts 两项，check.py r3b-await-boundaries 能运行。主 Agent 已在你的候选复现：

1. work_run storeArtifact 在 await canonical scope 查询时，原 signal 已取消仍继续 raw.put。请固定保留受理时 signal，查询完成后且写入副作用开始前再检查 aborted，返回 cancelled、不写正文。不要声称可回滚已开始的 raw.put。
2. Host owner authority.load 返回 found 后没有对 snapshot.ref 做完整等值核对。必须 full canonical Run/QueryRun ref 对应原 owner 才可相信其 workspace，与 Core work_run 已有做法一致。

只补这两处，不扩接口或引入新层。运行 r3b-await-boundaries、r3b-work-graph、r3b-admission-boundaries、platform-types/architecture。类型/tests/config仍只读。文件单绑需原地写，不能rename。输出实际结果和边界。
