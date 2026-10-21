R2-01 已完成。

## 改动

只改了 `tests/work-graph/S2C-lines-scale.test.ts`，夹具未改（因此没有新增 `S2C-X-scale-fixture.ts` 选项，`readerWith` 的默认路径原样不变）：

- `tests/work-graph/S2C-lines-scale.test.ts:47`：新增 A3 允许的原样转发计数包装 `recordingRunByTask`。它把所有 `readMany`、`lookupCommit`、`commit`、`eventAt`、`lookup`、`lookupOrdered`、`countLookup` 原样转给真实记录端口，只在 `index === 'r4c-run-by-task' && limit === 1` 时记录请求；请求对象、值、结果都不改，`lookup` 仍以同一个 `request` 调真实端口。
- `tests/work-graph/S2C-lines-scale.test.ts:168-169`：例（3）改用 `fixture.readerWith(recordingRunByTask(fixture.deps.records, runLookups))` 走一次 `listWorkLines`，预算保持缺省（仍为 100）；原有断言全部保留。
- `tests/work-graph/S2C-lines-scale.test.ts:193-212`：追加字面断言：四个锚定任务按读取顺序分别为 2、2、2、1 页；前三个任务的续页请求（带 `after` 的请求）各 1 个，最后一个 0 个；Run-by-task 请求共 7 个。

## 手算（宽 `listPageLimit: 1`）

W 有 4 个锚定任务 `w-00`～`w-03`，每个任务一条 Run-by-task 索引读取循环：

- 前三个任务各被 picker 接手：原 Run + 带 `anomalyAnchorRefs` 的 picker Run，共 2 条；宽 1 时第 1 页 1 条、`next` 非空，发出带 `after` 的第 2 页请求，第 2 页 1 条、`next` 为空，共 **2 页**，续页请求 **1 个**。
- 第 4 个任务（按 refKey 排序最后、未被接手）只有原 Run 1 条：第 1 页 1 条、`next` 为空，共 **1 页**，无续页请求。

所以页数 `2, 2, 2, 1`，续页请求数 `1, 1, 1, 0`，合计 `2+2+2+1 = 7` 次 lookup。预算仍是锚点层 4 页 ×1 + 前三个任务各 2 页 ×2 + 末任务 1 页 ×2 = `4 + 3*4 + 2 = 18`，低于 100。

## 一次性副本验证

按任务书建 `.dsh-scratch/r2-1`（`git ls-files` 解包，`node_modules` 与 `vendor/coding-agent/node_modules` 硬链接）。在副本的 `src/core/work-graph/views/work-line-reader.ts:2038` 把

```ts
if (page.value.next === null) break;
```

改成无条件的 `break;`，即 `readEnteredAnchors` 读完第一页就停。运行

`npx vitest run --maxWorkers=2 tests/work-graph/S2C-lines-scale.test.ts -t '8 messages'`

memory 与 sqlite 两个后端都失败在新增断言 `tests/work-graph/S2C-lines-scale.test.ts:210`：

```
AssertionError: expected [ 1, 1, 1, 1 ] to deeply equal [ 2, 2, 2, 1 ]
```

（原有 `attentionCounts.unknown === 1` 仍通过，正说明旧断言检不出只读首页。）验证后已删除 `.dsh-scratch/`。

## 检查

- `flock ./.typecheck.lock npm run typecheck`：exit 0。
- `npm run check:architecture`：exit 0，`next source boundaries: OK`；observed module edges 7/8，submodule edges 56。
- `npx vitest run --maxWorkers=2 tests/work-graph/S2C-lines-scale.test.ts`：1 个测试文件通过，8 项通过（memory/sqlite × 4 个用例）。未改夹具，故没有额外的每日夹具导入文件需要跑；未运行任何 `.scale.test.ts`。
- `node ./.dsh-ref/scale-move-check.mjs sc-base HEAD > ./.dsh-ref/out/move-check-r2.txt`：exit 0；12 对文件，sc-base 67 个用例，0 个未逐字找到，scale 文件 0 个新增，0 项待复核，`OK`。
- `git diff --stat sc-r2-base HEAD -- 'tests/**/*.scale.test.ts'`：空。

## 提交

提交 `8f94ede` `SC rework 2`（只含 `tests/work-graph/S2C-lines-scale.test.ts`）。

`git diff --shortstat sc-r2-base HEAD`：

```
 1 file changed, 47 insertions(+), 1 deletion(-)
```
