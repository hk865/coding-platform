# R2e.1 Sol 独立边界补测与受限返修范围

日期：2026-09-24。状态：新增两项独立测试 RED；生产实现待主 Agent 审阅。工作区 W=`/home/hyh001/projects/coding-platform`，代码仓 C=`W/coding-platform`。所有 `src/`、`tests/` 路径相对 C。

## 契约核对与定点结果

任务书 §1、§5.2 规定 text 域为指定 prefix 内许可的普通 UTF-8/no-NUL 文件；`paths` 不包含符号链接。故先前把显式 symlink prefix 空捕获判为缺陷的测试**已撤销**，不要求跟随或拒绝符号链接。比较需要全清单的 digest 数量来证明重命名唯一性；先前泛化的“最多遍历四项”要求也不成立。现仅在 **before 为空**、无重命名可能时测试可证明的容量短路。

现有冻结测试 `tests/data/workspace-text-operations.test.ts` 与 `tests/runtime/runtime-workspace-text-tools.test.ts` 共 16 项通过。新增 `tests/data/R2e-text-boundaries.test.ts` 两项按预期 RED；Node 24、单 worker，未安装依赖、未跑全量或 build。命令：

```bash
PATH=/home/hyh001/projects/coding-platform/.toolchain/node-v24.21.0-linux-x64/bin:/home/hyh001/projects/coding-platform/.toolchain/bin:$PATH pnpm test --maxWorkers=1 tests/data/workspace-text-operations.test.ts tests/runtime/runtime-workspace-text-tools.test.ts tests/data/R2e-text-boundaries.test.ts
```

1. **许可普通文件被静默过滤。** Linux 普通文件 `foo:bar.txt` 在真实 Kernel `WorkspaceSandbox.listFiles` 清单中，真实 `WorkspaceReadAccess.authorization.allowsRead` 为 true 且 `read` 成功返回其 UTF-8 正文。但 `src/core/workspace/text-source-snapshot.ts` 的 `isSafeSourcePath` 对任意冒号返回 false，直接过滤后仍发布 `complete=true`，只含 `normal.txt`。Core 公开 path 校验也拒绝冒号；本批不要求放宽跨平台路径输入。最小符合契约的修法是在已授权、已选中的 text inventory 中发现无法表示的普通文件时，整次返回 `unsupported`，不发布漏项或占住捕获槽；prefix 外的文件不应导致失败。新增测试以根范围证明此项，并在移除该文件后验证容量槽可重新使用。
2. **可证明超容量的比较仍先构造完整差异。** `src/core/workspace/workspace-read.ts` 的 `compareCapturedFiles` 先执行 `diffContent` 和 `comparisonChanges`，然后才检查 `maxQueryResults`/8 MiB。新增测试只构造 before 空、after 100 个新增文件、变化上限 2 的场景；这里不存在 rename 候选，`after.size` 已证明至少 100 个变化，完全无需遍历并分配全部变化。受控清单在读取远超此上限时抛错，现代码在 `diffContent` 中抛出而未返回 `capacity`。这个测试**不约束**一般比较所需的全局 inventory 扫描、digest 唯一性统计或排序策略。

## DSH 写文件范围与修法边界（待主 Agent 核准）

- `src/core/workspace/text-source-snapshot.ts`：把 inventory 中已授权、prefix 命中的不支持路径明确拒绝；继续忽略不在已声明域的符号链接、无权限项和 prefix 外路径。不要放宽 `capture.ts`/`ports.ts`/`workspace-read.ts` 的路径规范，不改 Kernel 清单或跟随链接。保留两次 capture 校验和原容量/取消/释放行为。
- `src/core/workspace/workspace-read.ts`：在可证明的空 before 等场景及其他安全下界出现时提前返回 `capacity`，避免先分配全量差异。一般比较仍可扫描完整清单以判定 rename 的全局唯一性，保留同 provider/indexVersion/scope、唯一同内容配对、排序及 `complete=true` 只给完整结果。若共享 `diffContent` 被改，`capture.ts` 的 `previous` summary 须保持原格式与完整正确性，不套比较上限。
- `tests/data/R2e-text-boundaries.test.ts` 是 Sol 冻结测试，不得由 DSH 修改或弱化。原两份 16 项冻结测试亦不修改；需要机械夹具变更先报主 Agent。

本轮 Sol 仅写新增测试和本文，未改生产。验收重跑原 16 项、新 2 项及受影响的 Workspace capture 定点回归。GUI Host、Git 版本、Python/C++ 统一查询均不在本次返修范围。
