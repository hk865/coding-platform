# S01–S04 定向验证汇总

本文件汇总固定源码前的定向验证。报告之间存在重叠，不相加为全量通过数；最终全量只在 S05 的精确源码快照上执行。

| 范围 | 原始报告 | 结论 |
| --- | --- | --- |
| StateLedger 拆分与首批共享投影 | `stable-retest.json` | 9 suites、69 tests 全通过 |
| 协调完整业务操作归组 | `coordination-domain-targeted-final.json` | 32 suites、98 tests 全通过 |
| 协调与产品装配组合 | `coordination-and-composition-clean-retest.json` | 36 suites、115 tests 全通过 |
| ReadModel 共享投影与双 adapter 详情 | `read-model-final-targeted-retest.json` | 19 suites、38 tests 全通过 |
| Query／ControlIntent 重启 | `query-control-restart-retest.json` | 11 suites、13 tests 全通过 |
| 产品默认 fixture 关闭 | `product-fixture-default-retest.json` | 1 suite、5 tests 全通过 |
| 命名调整受影响行为 | `remaining-names-targeted-retest.json` | 39 suites、106 tests 全通过 |
| ReadModel 性能与等价复验 | `read-model-adapter-benchmark-retest.json`、`read-model-adapter-equivalence-retest.json` | 性能证据测试与双 adapter 等价测试通过 |

`structure-and-composition-retest.json` 与 `coordination-structure-retest.json` 保留了模型调用前的 sandbox 环境失败：当前 WSL 没有可用 bubblewrap。实现没有为消除这些失败而关闭或弱化生产隔离；同一非 sandbox 行为组合的干净复验见 `coordination-and-composition-clean-retest.json`。

静态检查包括 TypeScript 0 诊断、模块边界 `issues: []`、legacy JavaScript 语法通过和 `git diff --check` 无空白错误。最终数值及固定源码复算写入 S05 交接，不把本文件当成独立验收结论。
