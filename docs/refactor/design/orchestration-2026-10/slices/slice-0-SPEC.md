# 第 0 片冻结规格：注意力观察把依赖条件写进边的字符串

状态：lead 冻结，2026-10-08。代码基线 9b94fc55（src 与 676a7a7b 相同；收尾的全量测试在 676a7a7b 上是 215 个测试文件、5234 项全部通过）。依据：[DESIGN §8.2](../DESIGN.md#82-分片表) 第 0 行，STATUS“缺口”。本片没有要用户定的事（OPEN：无）。

## 1. 范围

**做什么。** 注意力观察（Host 的机械通知）读任务图时，把每条执行依赖记成一个边字符串。今天的写法是

```ts
// src/app/attention-observer.ts:504（createAttentionScanner → scan）
for (const edge of plan.executionDag.dependsOn) edges.push('depends:' + edge.dependsOnId + '->' + edge.taskId + ':' + edge.requires);
```

`edge.requires` 是对象 `DependencyRequirement = { kind: "output-contract" | "artifact" | "decision" | "environment-revision" | "gate-result"; label: string }`（`src/contracts/plan.ts:172`），字符串拼接得到 `[object Object]`。所以：
- 通知里的依赖条件读不出来；
- 依赖条件变了（换 kind 或 label），边字符串不变，`graphChangedElements` 看不到变化。

**改成：** 依赖条件按“种类:标签”写，即 `edge.requires.kind + ':' + edge.requires.label`。例：从 t1 到 t2、要 `{kind:'artifact', label:'schema.json'}` 的依赖，边写成 `depends:t1->t2:artifact:schema.json`。

**不做（lead 定）：**
- 其余边的写法不动：`parent:`、`relation:`、`arch-depends:`、`arch-parent:` 四种原样。
- 标签里有冒号时不转义（例如 label `a:b` 得到 `depends:t1->t2:artifact:a:b`）。边字符串只用于“同一份快照前后比对”和通知正文，不被解析回对象；label 的冒号不会让两条不同的依赖得到同一个字符串，除非 kind 和 label 拼起来恰好相同，这在五个固定 kind 下不会发生（kind 本身不含冒号）。
- `graphChangedElements`、通知的格式、阈值都不动。只发变化、详细的变化行是第 3 片（`graphChanges`、`[attention s3-v1]`），第 3 片在本片之后接着用这个签名。

**用户能看到的：** 没有新东西；注意力通知里的依赖条件能读了，依赖条件变了也算图变了。

## 2. 数据与兼容

没有新记录、字段、索引。`GraphAttentionStamp` 是 Host 内存里的值：每次 Host 启动时 `createAttentionObserver` 重新建，第一次扫描只做基线（prime），不持久化（`src/app/host.ts:1018–1089`）。所以没有旧数据要兼容；升级后第一次扫描就是新格式。

## 3. 状态行

无。这不是状态迁移，不进 STATE-MACHINES-SPEC。

## 4. 接口

不变。`createAttentionScanner(deps: AttentionScannerDependencies): AttentionScanner` 签名、返回形状照旧。

## 5. 测试

新文件 `tests/app/S0-attention-edge-label.test.ts`，3 个用例，都直接调用真实的 `createAttentionScanner(...).scan(ctx, scope)`，依赖用最小的假对象（不碰数据库、不调模型）：

**共用夹具（精确值）：**
- `scope`：`{ scope: { projectId: 'p', workspaceId: 'w' }, paths: [], maxBytes: 1024, goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, targetSession: null, config: attentionConfig() }`；`attentionConfig` 来自 `tests/helpers/orchestration-fixture.ts:178`。
- `deps.workspace.readWorkspace`：不会被调用（`paths` 为空）；被调用就抛错。
- `deps.messages.readInbox`：不会被调用（`targetSession` 为 null）；被调用就抛错。
- `deps.architecture.readArchitectureRevision`：返回 `{ status: 'not_found' }`（`ReadResult` 的未找到分支，`src/contracts/core/results.ts:30`）。【审查改】原写的 `{ status: 'rejected', code: 'not_found' }` 是拒绝，scan 会把它当“图读不到”（`attention-observer.ts:531`，`arch.status !== 'not_found'` → `graphUnreadable = true`），S0-01 的 `graphUnreadable === false` 就永远不成立。
- `deps.plans.queryTaskGraph`：返回 `{ status: 'ready', value: G(req) }`，其中 `G(req)` 的 `plan` 是 `{ ref: { planId: 'p1' }, executionDag: { dependsOn: [{ taskId: 't2', dependsOnId: 't1', requires: req }] }, taskHierarchy: { parentOf: [] } }`，`tasks` 是 `[{ ref: { taskId: 't1' }, effectivePhase: 'satisfied', relations: [] }, { ref: { taskId: 't2' }, effectivePhase: 'ready', relations: [] }]`。只给 scan 读到的字段；用类型断言（`as never`）交给 `Pick<PlanTaskPort, 'queryTaskGraph'>`。
- `ctx`：scan 只把它转交给依赖，假依赖不读它；用类型断言给一个空对象。

| id | 给定 / 动作 | 精确预期 |
| --- | --- | --- |
| S0-01 | `req = { kind: 'artifact', label: 'schema.json' }`，扫描一次 | `snapshot.graph.edges` 恰为 `['depends:t1->t2:artifact:schema.json']`；`snapshot.graph.revision === 'plan:p1'`；`snapshot.graphUnreadable === false`；没有一条边包含 `[object Object]` |
| S0-02 | 两次扫描，只换 label：`schema.json` → `schema-v2.json` | `graphChangedElements(first.graph, second.graph)` 等于 `{ changedElements: 2, nodes: 0, edges: 2, statuses: 0 }` |
| S0-03 | 两次扫描，只换 kind：`artifact` → `decision`（label 都是 `schema.json`） | `graphChangedElements(first.graph, second.graph)` 等于 `{ changedElements: 2, nodes: 0, edges: 2, statuses: 0 }` |

改之前三个用例都失败（S0-01 得到 `depends:t1->t2:[object Object]`；S0-02、S0-03 两次的边相同，`changedElements` 为 0）；改之后都通过。

**保持通过、预期不改：** `tests/app/orchestration-mechanism.test.ts`（它的图用 `graphStamp` 直接给边字符串，不走 scan）。

## 6. 文件

| 动作 | 文件 | 子模块 |
| --- | --- | --- |
| 改 | `src/app/attention-observer.ts`（只改第 504 行这一处） | Host |
| 新建 | `tests/app/S0-attention-edge-label.test.ts` | tests/app |

共 2 个文件。第 3 片也改 `src/app/attention-observer.ts`（加 `graphChanges` 等），所以第 0 片先合入，第 3 片的副本从合入后的提交开始（见 [README](README.md)）。

## 7. 技术选择

无（只有一种写法：设计书 §8.2 已给出字符串格式）。

## 8. 大小与检查

生产代码 1 行；测试约 60–90 行。检查：`npm run typecheck`、`npm run check:architecture`、`npx vitest run tests/app/S0-attention-edge-label.test.ts tests/app/orchestration-mechanism.test.ts`。任务书是 [第一段](slice-0-book-part1.md)（写 3 个用例，看它们失败，停下）和 [第二段](slice-0-book-part2.md)（改那一行）。【审查改】原来写的是“一段完成，太小，不分两段”；决定 43 要第 0 片也走两段（DSH 写测试后停下 → lead 审、冻结 → DSH 实现）。第一段的失败来自现有代码本身，不是桩。
