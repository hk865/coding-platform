R4a 返修已实现并自检完成。报告已写 `/tmp/dsh-output/implementation.md`。

## 自检结果（真实执行）

| 检查 | 结果 |
| --- | --- |
| `check.py r4a` | **10 passed / 10**（基线 4/10） |
| `check.py kernel-types` | **exit 0** |
| `check.py kernel-architecture` | **passed (69 source files)** |
| `check.py r4a-regression` | **198 passed / 1 skipped / 2 failed**，2 项为沙箱 EROFS 环境失败 |

## 实现要点（8 个授权文件，原地写入）

- **单一 Turn 选择算法**：`recovery-coordinator.ts` 命名导出纯函数 `selectRecoveryTurnRecords(records, target)`，`recover(sessionId, options, environment?, target?)` 直接使用；`recovery-contract.selectRecoveryTurn` 薄委托，`resume-composition` 也取同一结果。范围止于下一条 `turn.started`，`{runId,turnId}` 必须同时匹配；`target=null` 保持旧 CLI 最新 Turn。组合根身份命中分支改走内部入口 `resumeCodingAgentInternal(input, {runId,turnId})`，公开 `resumeCodingAgent` 签名与 public-api 不变。
- **有效约束核对**：`requireEffectiveRecoveryConstraints` 在 `recorded==null` 时抛 `conflict`；等值或只收紧可继续并返回 `supplied`，任何提高上限、丢失 denied/protected/read-only、新增宿主授权、改变 executablePath、降低 consistencyMode 均拒绝。组合层把该函数注入 `RecoveryEnvironment.assertEffectiveConstraints`，Core 在 `willContinue || paused` 时、**任何对账写入与继续动作之前**调用（这正是「legacy + 中断模型请求」也不会先写再拒的关键）。
- **持久化**：`turn.started.payload.recoveryConstraints` 与 checkpoint 同名字段（可选、strict、`version=1`），值直接读 `WorkspaceSandbox.maxFileBytes` / `ProcessSandbox.effectiveOptions` 等 getter，不复制默认常量、不写 secret。旧正文按原 checksum 读取，新正文含新字段；未知 version → `version_unsupported`。旧记录 terminal 回放兼容，继续执行一律 `conflict`（无 boolean 捷径）。
- 未改任何冻结测试/类型/getter；两份独立测试 hash 保持（报告 §7）。未实现 after_tool、block/modify/fail、compact（保持 unsupported）。

## 2 项回归失败的精确证据（环境，非语义）

- `tests/e2e/m4-cross-process.test.ts:261`、`tests/e2e/m4-stable-cross-process.test.ts:323`，均在 `runChild("create")` 的 vitest 启动阶段失败，测试正文未执行。
- 子进程 stderr：`EROFS: read-only file system, open '.../node_modules/.vite-temp/vitest.config.ts.timestamp-*.mjs'`（`prepareVitest`→`loadConfigFromBundledFile`）。
- 机制：`check.py` 顶层带 `--configLoader=native`，而这两个 e2e 用例自己 spawn 的子进程硬编码 `[vitestCli,"run",file,"--pool=forks","--maxWorkers=1"]`，需写 `node_modules/.vite-temp`；本隔离快照该路径只读。未改测试、未 skip、未调 timeout。建议主 Agent 在可写 `node_modules` 的集成环境重跑（预期 200 passed / 1 skipped）。

未运行 build、平台完整 suite、付费模型。待主 Agent 独立验收。