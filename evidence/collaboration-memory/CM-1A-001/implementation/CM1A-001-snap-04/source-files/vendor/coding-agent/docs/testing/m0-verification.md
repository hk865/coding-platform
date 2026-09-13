# M0 测试与门禁

## 自动化覆盖

| 目标                  | 证据                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| build smoke           | `npm run build` 编译 `src/public-api.ts` 并生成 source map/declaration           |
| test discovery smoke  | `tests/smoke/engineering-baseline.test.ts` 被 Vitest 发现并执行                  |
| helper isolation      | `tests/unit/helpers.test.ts` 覆盖目录、环境、时钟、ID 和清理                     |
| architecture negative | `tests/architecture/architecture-check.test.ts` 构造非法依赖和循环并断言检查失败 |
| CI gate               | `.github/workflows/ci.yml` 在干净环境执行 `npm ci` 与 `npm run check`            |

## 如何理解负向测试

负向测试不是把失败代码留在主源码中，而是在临时 workspace 动态创建错误依赖，证明检查器确实会返回非零退出码。CI 中的 typecheck/test/build/architecture 任一步返回非零，工作流都会失败。

## 隔离约束

- 测试不得共享临时目录或确定性 ID 生成器。
- 修改环境变量必须在 `finally` 中恢复。
- 注册的资源按后注册先清理；多个清理失败不能吞掉前面的错误。
- M0 的 unit/contract/integration/e2e 空目录只表示边界存在，不代表业务覆盖。
