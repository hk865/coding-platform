R2e.1 定点返修完成。以下为如实报告，等待主 Agent 独立验收。

## 改动范围

只写了 scope JSON 允许的两个生产文件；测试/接口/配置/其他文件均未动（`tests/data/R2e-text-boundaries.test.ts` mtime 07:34:53，早于两次写入 07:37），未安装依赖、未 git add/commit/reset 等，未改 Kernel。

### 1. `src/core/workspace/text-source-snapshot.ts`（73 → 81 行，-5/+13，净 +8）

在 `captureTextSource` 中把过滤顺序改为「先授权、先 prefix，再表示性检查」：

```ts
const selected = [...new Set(inventory.paths)]
  .filter(path => access.authorization.allowsRead(path))
  .filter(path => prefix === null || path === prefix || path.startsWith(prefix + '/'))
  .sort();
const unrepresentable = selected.find(path => !isSafeSourcePath(path));
if (unrepresentable !== undefined)
  throw new ProjectSourceFailure('unsupported', 'selected path cannot be represented as a normalized workspace path: ' + unrepresentable);
const paths = selected;
```

- 已授权 + prefix 命中 + `!isSafeSourcePath`（冒号/反斜杠/NUL/空段/`.`/`..`）→ 整次 `unsupported`，不再静默丢弃后发布 `complete=true`。
- prefix 外或未授权项在检查前已被过滤，不属于捕获域，不触发拒绝。
- 未增加链接跟随、未改 Kernel/路径规范（`isSafeSourcePath`、`safeRelative` 原样）。
- 捕获槽不泄漏：抛错发生在任何 `access.read` 之前，`captureOp` 的 `finally { releaseReservation(); ... }` 释放预留，`published=false` 不发布半份 capture。

### 2. `src/core/workspace/workspace-read.ts`（158 → 165 行，-1/+8，净 +7）

在 `compareCapturedFiles` 的 provider/indexVersion/scope 校验之后、`diffContent` 之前加容量短路：

```ts
const beforeManifest = manifestOf(before), afterManifest = manifestOf(after);
if (Math.abs(beforeManifest.size - afterManifest.size) > limits.maxQueryResults)
  return rejected('capacity', 'comparison exceeds the configured change capacity');
const changes = comparisonChanges(diffContent(beforeManifest, afterManifest));
```

- 下界可证明：最终 changes = `mod + add + del - rename`，且 `rename ≤ min(add,del)`，故 `changes ≥ max(del,add) ≥ |before.size - after.size|`；rename 只会减少总数，不会使计数差变小。因此 `|Δsize| > maxQueryResults` 必然超限。
- 只凭清单大小判定，不遍历、不分配 100 项差异；before 空 / after 100 / 上限 2 → 直接 capacity。
- 一般情况仍走原 `diffContent` 全清单扫描判定 digest 唯一性与 rename 配对；provider/scope/indexVersion 检查、`complete=true` 只给完整结果、8 MiB 序列化上限均保持。
- `previous summary` 未受影响：`capture.ts` 仍直接调用 `diffContent`/`summaryChanges`，未套比较上限。
- 未加缓存/抽象层/接口/依赖/全局状态。

## 实际检查（无 timeout 修改，标准未改）

| 命令 | 结果 |
|---|---|
| `check.py r2e1` 基线（改动前） | 16 passed / 2 failed（与 Sol 记录一致） |
| `check.py r2e1` 改动后 | **18 passed (3 files)**，exit 0 |
| `check.py platform-types` | pass，exit 0（tsc 无输出） |
| `check.py platform-architecture` | pass，exit 0（`issues: []`） |

两个新测试由 RED 转 GREEN，原 16 项保持通过。

## 未做 / 限制

- 未运行全量测试、未跑 build、未接外部模型；未覆盖 R3a/R4a（已验收，不动）。
- Git 版本、GUI Host、Python/C++ 统一查询、符号链接语义、混合文本/二进制均不在本返修范围。
- 两个文件是未跟踪的新文件（`git status` 显示 `??`），故 `git diff` 为空；行数变化如上按原文/新文人工核对（两文件经 `wc -l` 复核为 81 / 165）。
- 一般比较仍可能先全量扫描（如下界不足时），这是任务书允许的；本优化只保证可证明超限时不先分配完整差异。

请主 Agent 独立验收。