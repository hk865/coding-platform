# Architecture Tests

`architecture-check.test.ts` 在临时仓库中验证 `scripts/check-architecture.mjs`
的正向与负向行为，包括 Core 反向依赖、Adapter 越权导入、无法解析的内部路径和循环依赖。

故意错误只写入测试临时 workspace，不污染真实源码。该层验证“谁可以依赖谁”，不替代运行时功能测试。
