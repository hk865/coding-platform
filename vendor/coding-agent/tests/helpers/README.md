# Test Helpers

Helpers 提供与业务无关的确定性测试基础设施：

- `deterministic-id.ts`、`manual-clock.ts`：替代随机 ID 与真实时间。
- `temp-workspace.ts`：创建受控临时工作区。
- `environment.ts`：隔离和恢复环境变量。
- `resource-scope.ts`：按逆序清理测试资源。
- `test-helpers.ts`：统一导出入口。

业务 Port 替身属于 `tests/fakes`。Helper 不应依赖真实 Adapter、网络或用户工作区。
