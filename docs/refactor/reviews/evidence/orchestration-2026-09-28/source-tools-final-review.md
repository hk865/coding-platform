# Source tools 最终窄修复核（2026-09-28）

本报告记录独立复核代理在主仓库完成的两个真实模型验收问题修复，以及最终验证。没有修改 Kernel、扩大路径权限或新增验收场景。`final-types.log` 中早先的失败保留，不以本报告覆盖。

## 原因与修复

1. **文件被当作目录 prefix。** 第二轮的 `search` 调用传入 `prefix: "contract.md"`。`WorkspaceSandbox.listFiles` 按目录能力逐段以 `O_DIRECTORY` 打开，文件因此返回 `ENOTDIR`；错误中的 `/proc/self/fd/36/contract.md` 是目录句柄路径，不是并发关闭 FD 的证据。`search` / `list_files` 的 prefix schema 现明确要求目录。只有这两个工具实际目录枚举产生的 `ENOTDIR` 转为 `invalid_arguments`，并提示单文件搜索使用 `search.paths`。其它读取、权限检查及异常仍保留原处理。没有增加路径存在预检查。
2. **合法根目录 `.` 被当成文件路径拒绝。** 第三轮的 `prefix: "."` 通过工具 schema，却在工具 summary 中被放入文件 `paths`，通用权限策略拒绝空文件路径；直接传入枚举也会遇到相同规范化问题。现只对 `search` / `list_files` 将精确的 `.` 与省略 prefix 等同：summary 不声明虚构文件路径，执行前移除该 prefix，走原有有界枚举及逐文件可见性过滤。`..`、绝对路径与受拒文件的权限没有放宽。空字符串仍为非法参数。

## 文件 SHA-256

| 文件 | 首次窄修前 | 目录根修复前（首项修复后） | 最终 |
| --- | --- | --- | --- |
| `src/core/agent-runtime/exploration-tools.ts` | `0f44e2623cd2a62772e5f916e64eda2e86c302f7fb0965dc4a2f5c5b0adcbb3c` | `3cbd3f177c87b2591a4a95bdd50fe6f01ec86d87730dc30f89b2f8389b24fa02` | `6d66f3e402ae07dd9638cca6a22c799cc97336cbd8fce5cef9ca75ebb279076e` |
| `tests/runtime/source-tool-lifecycle.test.ts` | `264ff7ff67f6eabdbe8d5a7fe5d3794e7510770ec5c3e51711ef073c77a6b874` | `26cbd76548a98bbbce2893198b0a8a4471bc0e32e079ecb5f093366dfef5018a` | `38c717bd5ff6e65c05f9ad8c7a7c6e38dfadab1a12978f3649fc84e587c47831` |

## 最终验证

工作目录为本独立仓库根，Node 为 `/home/hyh001/projects/coding-platform/.toolchain/node-v24.21.0-linux-x64/bin/node`（24.21.0）。

- `node node_modules/vitest/vitest.mjs run --configLoader runner tests/runtime/source-tool-lifecycle.test.ts -t 'treats explicit root prefixes|classifies a file used as search prefix'`：**2 passed / 14 skipped**，613 ms。验证文件 prefix 明确参数错误、不透出 `/proc/self/fd` 路径、显式 paths 同文件搜索成功；验证根目录 summary 经真实权限策略允许、两个工具成功、受拒文件不显示、`..` 仍拒绝。
- 使用上述 Node 所在目录置于 PATH 前运行 `npm run typecheck`：**exit 0**，包含主 TypeScript 与 UI TypeScript 检查。先前测试辅助函数的 `Record<string, unknown>` / `JsonObject` 类型错误已修复；旧失败日志仍保留。
- 相同 PATH 下 `npm run build`：**exit 0**，工作台发布到本仓库 `dist/app/public/workbench`。

本代理未在此修复任务中发起真实模型请求。主审随后报告最终真实验收 14 次模型请求、正式链路通过，tool/provider/transport errors 均为 0，浏览器复验完成且 Host 关闭后 test exit 0；这些运行事实以主审保存的最终 live 证据为准。
