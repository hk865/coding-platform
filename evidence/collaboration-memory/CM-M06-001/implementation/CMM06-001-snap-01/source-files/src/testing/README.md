# 显式测试依赖

两个宿主仍消费 sequences 的可注入时钟/ID 与确定性默认值，以及 check-providers.double 的默认检查和 Reviewer 能力替身。它们属于原 TestDoubles 非 Module 表面，不属于公共 contracts，也不等于真实工具或模型验证。

替换宿主默认依赖并迁移全部生产消费者后才可移入 tests。仅测试使用的控制、账本、读模型和 Handoff 替身已经位于 tests/contract-support/testing。
