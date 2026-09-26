# 已完成能力补迁证据

- `isolated-verification.log`：主审无旧源码副本的边界/类型/构建/250项测试/编译入口结果。
- `transfer.json`：43 个直接补迁文件的旧来源与目标哈希；契约声明单独列，不混入逐字复制。
- `*-contract-additions.json` / `contract-additions.json`：机械声明闭包提取记录。提取后的旧 ReadOnlyQueryPort/结果类型再次裁掉；最终源码以 `final-target-hashes.json` 为准。
- `reference-before.json` / `reference-preservation.json`：同一排除 node_modules/dist/.git 的原源码、测试、Kernel 源码 1313 文件前后核对。
- `metrics.json`：生产 TypeScript、测试辅助、脚本与冻结 Kernel 分开计数。
- `independent-review.md`：独立只读差异审阅与能力边界。

Kernel 验收测试的来源对应表位于目标 tests/kernel/README.md；其余新增 Sol 测试显式使用目标 Store 或窄事实夹具，不作为旧完整产品链已切换的证明。
