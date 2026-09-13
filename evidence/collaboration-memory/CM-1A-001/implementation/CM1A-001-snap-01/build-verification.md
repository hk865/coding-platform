# CM-1A-001 第 1 工作段构建验证记录（CM1A-001-snap-01）

- 记录时间：2026-09-13（本地时区 +08:00）
- 快照：`evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-01/`
- 性质：**只读产品源码、只写本证据目录**。本记录不修改 `src/` 与 `tests/`，不代表本票通过。
- 与 `verification.md` 的关系：本文件补上该文件 §7 当时标为"未运行"的构建与 UI 类型检查；`verification.md` 的实现结论（A01–A12 未验证、消费者未实现）不变。

## 1. 环境事实（本次失败的真实原因）

`~/.local/bin` 只链接了 `node`、`npx`、`pnpm`（均指向 `/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/`），**没有链接 `npm`**；该工具链目录内确实存在 `npm`（11.16.0），但不在 `PATH` 上。

后果：`package.json` 的 `kernel:build`（= `npm --prefix vendor/coding-agent run build`）与 `build`（第一步即 `npm run kernel:build`）在原始 PATH 下**立即失败**：

```text
$ npm --prefix vendor/coding-agent run build
sh: 1: npm: not found
[ELIFECYCLE] Command failed.
```

因此每个构建命令都记录了两次：**RUN 1 = 原始 PATH 下的字面命令**（如实保留失败），**RUN 2 = 同一命令、仅把上述工具链 bin 加入 PATH**。两次都是 `pnpm kernel:build` / `pnpm build` 本身，没有替换命令、没有跳过任何构建步骤（包括 `ui:build`）。

## 2. 逐条命令、退出码与关键输出

| # | 命令 | 退出码 | 关键输出 | 日志 |
| --- | --- | --- | --- | --- |
| 1a | `pnpm kernel:build`（原始 PATH） | **1** | `sh: 1: npm: not found` | `logs/kernel-build.log` |
| 1b | `pnpm kernel:build`（补 PATH） | **0** | `coding-agent-learning@0.0.0 build` → `tsc -p tsconfig.build.json` | `logs/kernel-build.log` |
| 2a | `pnpm build`（原始 PATH） | **1** | 同一 `npm: not found` | `logs/platform-build.log` |
| 2b | `pnpm build`（补 PATH） | **0** | kernel:build → `tsc -p tsconfig.app.json` → `node scripts/copy-ui.mjs` → `pnpm run ui:build`；`vite v8.2.2` `✓ 1055 modules transformed` `✓ built in 10.79s` | `logs/platform-build.log` |
| 3 | 产物事实采集 | 0 | `logs/build-artifacts.json` | 同左 |
| 4 | `pnpm ui:typecheck`（构建成功后按序执行） | **0** | `pnpm --dir src/ui exec tsc -p tsconfig.json --noEmit`，无诊断输出 | `logs/ui-typecheck.log` |
| 5 | `bash scripts/test-wsl.sh`（全量，构建之后） | **0** | `Test Files 303 passed (303)` / `Tests 1998 passed (1998)`，0 失败，耗时 203.78s | `logs/full-tests-after-build.log` |
| 6 | `node dev_docs/verification/validate-docs.mjs`（文档根） | **0** | `Documentation validation: 13/13 checks passed.` | `logs/docs-validation.log` |

未运行：`pnpm ui:test`（构建已成功，但该命令不在本次委托范围）、任何真实模型样例、任何浏览器验收。

## 3. 产物事实（`logs/build-artifacts.json`）

- `dist/` 顶层 10 项：`app、contracts、control、data、execution、fixtures、harness、interaction、storage、testing`；
- `vendor/coding-agent/dist/` 顶层 18 项：`app、core、m5-public-api.d.ts(.map)、m5-public-api.js(.map)、memory、model、observability、policy、public-api.d.ts(.map)、public-api.js(.map)、sandbox、skills、storage、tools`；
- `dist/app/server.js`：**存在**，13,338 字节，mtime `2026-09-12T16:40:02.955Z`（= 本地 2026-09-13 00:40:02，即本次 RUN 2 构建产出）；
- `dist/app/public/workbench/index.html`：存在，484 字节，mtime 本地 00:40:19（本次 UI 构建产出）。

## 4. 本次证据的边界（必须与结论一起读）

1. **构建通过与测试通过都不证明协作通信可用。** 全量回归通过只证明既有 1998 个用例未退化；A01–A12 仍未验证，Gate A 未成立。
2. **工作树在验证窗口内被并发修改。** 本工作段未写 `src/`、未写 `tests/`，但窗口内出现其它写入：`tests/coordination/_probe.test.ts`（00:38:01）、`src/contracts/modules.ts`（00:43:23）、`src/control/control-engine/control-engine.ts`（00:43:28）、`tests/contracts/module-ownership.test.ts`（00:43:32）、`src/control/control-engine/coordination.ts`（00:44:48）。其中后三项晚于本次 `pnpm build`（00:39:23–00:40:19）且落在全量回归（00:41:26–00:44:56）期间。
3. **用例数 303/1998 与 `verification.md` 的 302/1997 不同，原因是新增了并发写入者的 `tests/coordination/_probe.test.ts`（+1 文件 / +1 用例），不是构建造成的。** 该文件出现在本次回归日志中（`✓ tests/coordination/_probe.test.ts (1 test)`）。
4. 上述并发写入意味着本次构建/回归**不是在一个冻结快照上完成**的；若要归档为冻结证据，应在停止写入后重跑。

## 5. 重跑入口

```bash
cd /mnt/d/1.project/Software/agent_platform
export PATH="/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH"  # 本环境补 npm
pnpm kernel:build          # 期望退出码 0
pnpm build                 # 期望退出码 0（含 ui:build）
pnpm ui:typecheck          # 期望退出码 0、无诊断
bash scripts/test-wsl.sh   # 期望退出码 0；不要用 npx vitest run
```
