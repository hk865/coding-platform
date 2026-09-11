# ERR-02：测试可信度与变异证据

状态：active；角色：实现。范围为 R-2/R-3/R-4、RD-5 与 E-1/EU-1，不修改 Reviewer 生产恢复逻辑。

## 写入范围

外审 R-2 三个 contract suite、R-3 remediation writer-chain 测试、R-4 restart fixture/probe 与其直接测试、`src/contracts/testing/state-ledger.double.ts` 及本票专属 evidence。不得修改 `src/control/leased-worker-runtime.ts`、`src/control/reviewer-dispatch.ts`、`src/app/**`、`src/harness/**`、权威共享文档。

## 验收

1. 三处占位断言与一处永真断言改为真实行为断言，或删除虚假用例并说明覆盖由何处承担；真实错误必须 FAIL。
2. restart 就绪探针只把明确“能力未实现”哨兵转为 SKIP；其他异常传播为 FAIL。用有界故障注入证明回归不会被转为 SKIP，并保持正常套件有效。
3. StateLedger double 的 `pendingDispatchIntents(limit, selection)` 与两套生产 Ledger 的 selection/limit 顺序一致，并有专项断言。
4. 搜索 E-1 历史测试字节的可验证备份；找不到则保留证据缺口，不能重建或声称恢复。冻结本批修改前测试字节及修后 diff。
5. 在隔离副本执行 EU-1 变异：移除/破坏探索来源 pin 修复机制，`tests/app/explorations.test.ts` 的相关回归必须 FAIL；恢复原工作树不靠 reset/checkout，产品源码最终不得保留变异。
6. 报告命令、退出码、测试数/skip 变化、原始日志与改动文件。
