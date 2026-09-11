# Fixtures

本目录预留跨测试共享的静态输入。当前多数 fixture 与被测场景放在各自测试文件或
`tests/review/fixtures`、`tests/scenarios` 下，因此这里不承载生产配置。

新增 fixture 必须确定、无密钥、尺寸受控，并明确属于协议输入、workspace 样本还是期望输出。不可重复的真实模型响应和 Benchmark 运行结果不应放在此目录。
