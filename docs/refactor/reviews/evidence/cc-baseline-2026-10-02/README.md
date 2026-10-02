# Linux 测试基线（2026-10-02，Claude Code 批次起点）

本页记录 `feat/reliability-and-structure` 批次开工前、在**未修改的基线提交 `790d970`** 上的首次完整运行结果。之后任何测试失败都先与本页对照，确认是否由本批引入。逐文件计数与失败原文见同目录 [test-summary.json](test-summary.json)。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 | WSL2 Ubuntu 24.04.4 LTS（内核 6.18.33.1-microsoft-standard-WSL2），仓库副本位于 WSL 自身文件系统 |
| Node / npm | v24.18.0 / 11.16.0（用户目录工具链，未装入 `/usr/bin`） |
| bubblewrap | 0.9.0（`apt-get download bubblewrap` 解包到用户目录，无 root；经 `CODING_AGENT_BWRAP_PATH` 指定）；`unshare --user` 可用，本机内核无 `apparmor_restrict_unprivileged_userns` 限制 |
| Python | 3.12.3，`/usr/bin/python3`（源码分析器硬编码该路径，需 ≥ 3.11 的 `tomllib`） |
| libclang | `libclang1-18` 1:18.1.3-1ubuntu1，`/usr/lib/llvm-18/lib/libclang.so.1`（`tests/data/cpp-source-index.test.ts` 依赖它并固定版本 18.1.3） |
| git | `/usr/bin/git`（Kernel WorkspaceSandbox 硬编码该路径；测试用到 sha256 仓库与 `worktree add`） |
| 模型密钥 | `DEEPSEEK_API_KEY` 等均未设置；全程不调用真实模型 |
| 依赖安装 | `npm ci --ignore-scripts`；`npm ci --prefix vendor/coding-agent --omit=dev --ignore-scripts` |

Windows 工作树使用 `core.autocrlf=true`（CRLF）。为避免把 CRLF 带进 Linux 测试，副本经 git 快照（临时 index + 悬空提交）同步，内容与真正提交后的 LF 文本一致。

## 结果

| 步骤 | 结果 |
| --- | --- |
| `node --run typecheck` | 通过（约 9 s） |
| `node --run check:architecture` | 通过；5 模块，观察到 7/8 条允许边 |
| `node --run build` | 通过（约 4 s） |
| `node --run test` | **137 个文件中 5 个失败；1199 项中 1192 通过、7 失败**，0 跳过；约 407 s |

在同一基线上隔离重跑失败文件两轮，7 项均稳定失败（不是偶发）。

## 7 项失败的归类

| 测试 | 现象 | 根因 | 验证 |
| --- | --- | --- | --- |
| `tests/app/AG2b-collaboration.test.ts` › releases a busy B, runs two wait rounds… | 5 s 超时；放宽到 60 s 后报 “collaboration driver did not reach the expected state” | **环境**：fixture 的正式检查命令是 `node -e …`，在 Kernel ProcessSandbox 里执行；沙箱只挂载 `/usr`、`/bin`、`/lib`、`/lib64`，`PATH=/usr/bin:/bin`。本机 `node` 不在 `/usr/bin`，检查进程起不来，检查 FAIL | 用用户命名空间 overlay 把 `node` 加进 `/usr/bin`（不改系统、权限语义不变）后通过，4.5 s |
| 同文件 › reopens read-only over the original messages… | 同上 | 同上 | 同上，2.4 s |
| `tests/app/orchestration-mechanism.test.ts` › runs two explicitly selected same-Goal Tasks… | 检查轮 finalized INCONCLUSIVE（检查 FAIL） | 同上（检查命令 `node -e …`） | 同上，3.9 s |
| `tests/work-graph/A1-independent-review.test.ts` › sqlite › paginates distributed relations… | 5 s 超时 | **耗时**：sqlite 变体在本机需 5.1–7.4 s，超过 Vitest 默认 5 s | `--testTimeout=60000` 下通过 |
| `tests/composition/platform.test.ts` › memory / sqlite: public composition wires… | 公开组合键多出 `kernelStores`、`registerCheckConfiguration`、`registerWorkflowBinding` | **断言过期**：`c7df257` 有意新增这三个组合入口，未同步本断言 | 代码与提交说明一致 |
| `tests/runtime/R5b-query-session-loop.test.ts` › keeps the local workbench budget… | 期望 `perResponseTokens: 4096`，实际 16384 | **断言过期**：`c7df257` 有意把本地工作台单次响应上限设为 16384（源码注释：结构化规划需要至多 16384 输出 token），未同步本断言 | 同上 |

结论：基线没有由本批引入的问题；7 项分属“沙箱内缺 `/usr/bin/node`”“默认超时偏短”和“过期断言”三类。任务 B 的 CI 会显式处理前两类（把 setup-node 的 `node` 安装到 `/usr/bin/node`，并放宽 Vitest 超时），过期断言在任务 B 中按 `c7df257` 的有意行为更新，并在最终报告中列出。
