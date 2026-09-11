# Testing

测试按风险和边界分层：纯逻辑使用 unit，Port 一致性使用 contract，真实模块组合使用 integration，进程/CLI/Sandbox 使用 e2e，静态依赖使用 architecture，真实业务闭环使用 scenarios，模型联合能力使用 benchmarks。

## 验证记录

- [工程基线](m0-verification.md)
- [Core 契约](m1-verification.md)
- [Runtime、工具、Storage 与恢复](m2-m4-verification.md)
- [App、Provider、CLI 与扩展](m5-verification.md)
- [Benchmark 与发布验收](m6-verification.md)
- [Web UI 与长会话业务验证](web-ui-business-verification.md)

文件名保留历史阶段编号，正文是对应模块的证据索引，不代表当前架构仍按里程碑切分。

## 常用门禁

```bash
npm run check
npm run test:e2e
npm run test:e2e:bwrap
npm run check:scenarios
npm run benchmark:baseline:replay
```

`test:e2e:bwrap` 要求真实隔离能力。Replay 只验证 Harness；真实 Provider
Benchmark 需要单独凭据、固定模型与可追溯 commit。
