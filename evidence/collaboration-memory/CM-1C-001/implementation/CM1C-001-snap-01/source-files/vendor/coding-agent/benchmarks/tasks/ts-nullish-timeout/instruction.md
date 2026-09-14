# 保留显式的零超时

`src/timeout.mjs` 会把配置中的 `timeoutMs: 0`
错误地替换成默认值。修复这个问题：只有值缺失时才使用 fallback，同时保持现有导出和其他数值行为不变。

运行 `node test.mjs` 可执行公开测试。不要修改测试文件。
