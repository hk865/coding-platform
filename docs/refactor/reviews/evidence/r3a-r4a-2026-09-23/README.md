# R3a / R4a 独立验收证据

日期：2026-09-23。结论见[验收报告](../../R3a-R4a-independent-acceptance.md)；执行者接手见[返修任务](../../../tasks/R3a-R4a-acceptance-fixes.md)。这些是失败待修的证据，不是已验收标记。

- [manifest.json](manifest.json)：实际运行计数、源码前后指纹、冻结测试 SHA256、检查结果。源码指纹覆盖本次审阅的文件，不把脏工作树的 HEAD 当成全部实现基线。
- [r3a-independent.json](r3a-independent.json)：原独立 12 项通过；[r3a-final.log](r3a-final.log) / [JSON](r3a-final.json)：加入事务内身份校验反例后 12 通过、2 失败。
- [r3a-input-isolation.log](r3a-input-isolation.log) / [JSON](r3a-input-isolation.json)：额外的非 JSON 程序化输入隔离，Node 24 下 1 项失败。
- [kernel-final.log](kernel-final.log) / [JSON](kernel-final.json)：44 文件，193 通过、3 失败、1 跳过；包含新独立套件 3 通过 / 3 失败。
- [platform-scoped.json](platform-scoped.json)：91 文件 / 822 项首跑，810 通过、12 失败；[第一次定点复跑](failure-repro.log) 10 通过，[其余失败文件复跑](timeout-rechecks.log) 35 通过。不是完整 822 项重跑通过。
- [transaction-trace.json](transaction-trace.json) / [运行日志](transaction-trace.log)：真实 p1-02 四场景的 exec 事务追踪；30 BEGIN / 30 COMMIT，无嵌套或 SAVEPOINT。[临时配置](trace/vitest.config.ts)、[临时测点](trace/setup.ts)供核对，含本机路径，重跑需在临时目录调整输出位置及依赖解析，不直接替换生产测试配置。
- [构建](build.log)、[平台架构检查](architecture.log)、[Kernel 架构检查](kernel-architecture.log)；类型检查日志成功时为空，退出码结论记录于 manifest。
- [环境与生产装配核对](environment-and-composition.md)：已确认的缺失材料、未经确认的原失败归因，以及真实 Host 窄测试。

冻结文件备份保存在 `frozen-tests/`。返修只改实现及自己的回归，不能改主 Agent 测试或其 hash 来获得通过。`pre-implementation-R3a-goal-record-store.test.ts` 是原临时 12 项草稿，用于证明该套件的来源，不是第四个应安装执行的文件；当前执行文件与 hash 以 manifest 为准。

运行环境：仓库现有依赖、W/.toolchain 的 Node v24.21.0。本地合成模型与临时 SQLite / 工作目录，不访问真实凭据或外部模型。平台全量 413 文件和 Kernel lint 的 dsh 自报没有在此转换成主 Agent 的独立结果。
