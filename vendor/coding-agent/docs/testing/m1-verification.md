# M1 验证记录

```yaml
status: current
updated: 2026-08-20
scope: M1-01～M1-06 的确定性 unit/contract 验证范围和命令
```

## 测试文件

| 文件                                              | 覆盖                                                            |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `tests/contract/state-events.contract.test.ts`    | 初始 State、schema、阶段派生、身份/序号/终止转换                |
| `tests/contract/model-client.contract.test.ts`    | final/tool 流、usage、半截参数、终止协议、Request strict schema |
| `tests/contract/tool-executor.contract.test.ts`   | Call、三类 Result、effects、JSON、callId                        |
| `tests/contract/hook-event-sink.contract.test.ts` | Hook 五类结果、point/身份约束、after_tool 事实保护、sink 等级   |
| `tests/unit/context-builder.test.ts`              | 顺序、不可变性、确定性、重复工具、孤立结果                      |
| `tests/unit/fakes.test.ts`                        | 脚本重放、深拷贝、非法协议、gate、取消、副作用、sink 失败/阻塞  |
| `tests/smoke/engineering-baseline.test.ts`        | M1 完成但不宣称 Agent 能力                                      |
| M0 原测试                                         | helper 隔离和架构依赖检查                                       |

## 验证命令

```bash
npm run check
```

完整门禁依次执行 format check、ESLint、TypeScript typecheck、全部 Vitest、TypeScript
build 和 architecture check。最终通过数量以本文件下方“最近结果”为准。

## 最近结果

在 Node.js 24.18.0、Vitest 4.1.10 环境执行完整 `npm run check`：

```text
Test Files  9 passed (9)
Tests      39 passed (39)
Architecture check passed (9 source files).
```

format check、ESLint、TypeScript typecheck、全部 Vitest、TypeScript build 和 architecture
check 均通过。测试过程不访问网络或真实工作区。

## 测试边界

这些测试证明 Core 契约、纯组装行为和确定性测试替身，不证明已有 Agent
Loop、真实模型、read/edit/shell、安全链或持久化恢复。上述能力分别由 M2～M5 的集成/E2E 门禁证明。
