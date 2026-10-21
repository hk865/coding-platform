# S85 S4 第一次返工（R2）回复 — 提交 `239395d`

## 0. 问题与说明

1. **无阻塞问题。** 三处生产修改都是注释；失败表里的 Q1-03、Q4-02 按裁定不做。
2. 加宽后的 11 个文件把实时 SQLite 工作区的字节带进了组装结果（base1/base2 也会不同）。按书 §5.0 规则 3，我在两份 scratch 副本里加了同一组确定化编辑（不进入仓库）：`workspace-sandbox.js` 的 `#pathMetadataRevision` **和** `#walk` 两处都把 size/mtime/ctime 固定为 `'0'`；`candidate-workspace-reader.ts` 跳过 SQLite 的 `-shm/-wal/-journal` 边车文件。正因如此，依赖返回值现在是 **0 差异**（比“只允许六条路径”更强），不是掩盖：主库 `kernel.sqlite` 的内容仍参与 capture digest，测试的“新 basis”语义未变（先前失败的两个文件 `K3-35-T-by-hand`、`K3-35-approved-methods-brief` 在加边车过滤后全部通过）。
3. `unknown` 桶：208 条来自 `beforeAll` fixture 调用（`K3-35-prepare` / `K3-35-continuation-fixture`），异步栈上没有测试文件帧，无法逐文件归属；单列，base/result 计数与内容相同。

## 1. 摘要（不到 200 字）

三处注释已恢复/改写，提交 `239395d`，只动两个文件、纯注释行。11 个文件并入 capture（36 文件、6 批），base 两次与 result 各 2,140 条；结果、stored 字节与依赖返回值均 0 差异（仅 12 条 `skills.resourceRoot` 元数据是副本根路径）。Q1-01 新增 `withStore` 与直接导出函数探针（191 direct + 322 kernel），Q2-02 改为逐调用点计数，Q3-01 矩阵 140→158 且 base 两次逐字节相同、base/result 0 差异，Q4-01 修复 `undefined` 标记并用 2,156 条参数重放 base/result 均 0 差异。typecheck、架构、build 与 8 个测试文件（100 项）全过。

## 2. 逐条 Fix 行

| 行 | 结果 | 文件:行 | 证明 |
|---|---|---|---|
| Q1-04 | 已做 | `src/core/agent-runtime/context-history-facts.ts:14`（常量 `:15`） | 注释与 `s85-n2-base:src/core/agent-runtime/context-assembler.ts:958` 逐字相同 |
| Q1-01 | 已做（证明） | `e-assembler/probe-hook.ts` + `apply-probes.mjs` | `withStore` 回调的 store/reader 记录为 `kernel`（322 条），直接导出函数记录为 `direct`（191 条）；见 §4 |
| Q1-02 | 已做（并入 Q2-02） | 每调用点表 | `bodies.read` 4 条全在 capture changes；baseline bundle/artifact 为零，单列 |
| Q2-01 | 已做（加宽） | `e-assembler/run-capture.sh` E/F 两批 | 11 个文件全部有 capture；见 §3 |
| Q2-02 | 已做（证明） | `read-points-per-site.md` | 25 个到达点 + 零调用点逐条旧/新对照；见 §5 |
| Q3-01 | 已做（证明） | `e-render/payload/edge-cases.ts` | 140→158 例；base 两次 `cmp` 相同；base/result 0 差异 |
| Q3-02 | 已做 | `src/core/agent-runtime/context-rendering.ts:171–175`、`:226–227` | 两段注释逐字按任务书 |
| Q3-03 | 已做 | `src/core/agent-runtime/context-rendering.ts:1–10` | 文件头逐字按任务书，不再提 S4/base |
| Q4-01 | 已做（证明） | `e-render/replay.mjs`、`revive.mjs`、`sample-revive.mjs` | 2,156 条重放，base/result 均 0 差异；样例见 §7 |

## 3. 第 4 项：加宽 capture（e-assembler）

命令见 `.dsh-scratch/R2/COMMANDS-R2.md`。36 个测试文件、6 批；每次 2,140 条记录，27 个 jsonl（26 个真实测试文件 + `unknown`）。三次运行所有批次 `status=0`。

**每个 probe 的调用数（base1 / result）：**

| probe | base1 | result | 差异 |
|---|---:|---:|---:|
| `assembler:task` | 314 | 314 | 0 |
| `assembler:query` | 10 | 10 | 0 |
| `assembler:attention` | 1 | 1 | 0 |
| `deps` | 720 | 720 | 0（返回/参数/顺序） |
| `direct`（Q1-01） | 191 | 191 | 0 |
| `kernel`（Q1-01） | 322 | 322 | 0 |
| `stored:task` / `:put` | 285 / 285 | 285 / 285 | 0 |
| `stored:query` / `:put` | 6 / 6 | 6 / 6 | 0 |
| 合计 | 2,140 | 2,140 | 0（除下列 12 条元数据） |

**每个文件的 capture 数（base1 / result；括号内为该文件 base1 的 probe 分布）：**

| 文件 | 条数 |
|---|---:|
| `tests/business/S1-archive-flow` | 50 / 50（task8 query2 deps8 direct8 kernel4 stored 20） |
| `tests/business/WP1-start-refusal` | 4 / 4（task2 deps2） |
| `tests/composition/WP1-session-duty` | 6 / 6（task2 stored4） |
| `tests/runtime/K3-35-T-by-hand` | 460 / 460（task52 deps159 direct57 kernel90 stored102） |
| `tests/runtime/K3-35-approved-methods-brief` | 178 / 178（task26 deps53 direct19 kernel30 stored50） |
| `tests/runtime/K3-35-workspace-baseline-prepare` | 12 / 12（task4 stored8） |
| `tests/runtime/K3-B3-cancellation-cancelled` | 56 / 56（task10 deps16 direct4 kernel10 stored16） |
| `tests/runtime/K3-B3-newest-request-order` | 104 / 104（task6 deps38 direct16 kernel32 stored12） |
| `tests/runtime/K3-B3-runtime-fail-closed` | 3 / 3（deps1 direct2） |
| `tests/runtime/K3-merge-cancel-propagation` | 124 / 124（task26 deps42 direct4 kernel16 stored36） |
| `tests/runtime/K3-review-preparation` | 174 / 174（task26 deps50 direct10 kernel36 stored52） |
| `tests/runtime/S1-archive-files-brief` | 231 / 231（task15 deps119 direct31 kernel36 stored30） |
| `tests/runtime/S3-context-assembler` | 30 / 30（task8 query1 deps15 stored6） |
| `tests/runtime/S4C2-assembly` | 56 / 56（task12 query2 deps18 stored24） |
| `tests/runtime/WP1-context-assembly` | 6 / 6（task2 query1 deps3） |
| `tests/scenarios/S3-context-and-inputs` | 22 / 22（task3 deps13 stored6） |
| `tests/scenarios/S3-query-graph` | 20 / 20（task2 query1 attention1 deps10 stored4） |
| `tests/work-graph/K3-35-owner-manifest-trim` | 38 / 38（task6 deps12 kernel8 stored12） |
| `tests/work-graph/K3-47-continuation-gate` | 18 / 18（task6 stored12） |
| `tests/work-graph/R3c-plan-adoption` | 12 / 12（task4 stored8） |
| `tests/work-graph/R5b-initial-plan` | 4 / 4（query1 deps1 stored2） |
| `tests/work-graph/S3-prepared-context-admission` | 156 / 156（task36 query2 deps42 stored76） |
| `tests/work-graph/S3-role-profiles` | 10 / 10（task10） |
| `tests/work-graph/S5-goal-settings` | 102 / 102（task34 stored68） |
| `tests/work-graph/WP1-context-anomalies` | 8 / 8（task2 direct2 stored4） |
| `tests/work-graph/WP1-goal-content-entry` | 48 / 48（task12 deps12 stored24） |
| `unknown`（beforeAll fixture） | 208 / 208（deps106 direct38 kernel60 stored4） |

**零 capture 文件（10 个，单列）：** `tests/app/S3-attention-context.test.ts`、
`tests/contracts/A2-rework-contract-helpers.test.ts`、
`tests/runtime/K3-16-proposal-input.test.ts`、
`tests/runtime/K3-16-review-extremes-pure.test.ts`、
`tests/runtime/K3-35-manifest-trim-pure.test.ts`、
`tests/runtime/K3-review-input-pure.test.ts`、
`tests/runtime/K3-unknown-call-review-section.test.ts`、
`tests/work-graph/S4C2-memory-material.test.ts`、
`tests/work-graph/S4C2-project-set-shared.test.ts`、
`tests/work-graph/S4C2-read-counts.test.ts`。

**比较结果：**

- `base1/base2`：2,140/2,140 条，`RESULT: equal`，payload 差异 **0**，26/27 个文件 raw-byte-equal；`unknown` 只是追加顺序不同（payload 0 差异）。
- `base1/result`：`compare.mjs` 打 `RESULT: different`，共 **12** 条 payload 差异，全部是 `assembler:*.args[].configuration.skills.resourceRoot`（11 条 task + 1 条 query，base-a 与 result-a 的副本根路径），在返回对象之外；`--result-only` 为 `RESULT: equal`（0 差异）。
- 结果与 stored 字节：**0 差异**（`assembler:*` result-only 0；`stored:*` 全等）。
- 依赖返回值（另列，不等于整个 payload 0 差异）：`inner-diff.mjs` base1/base2 **0 条**、base1/result **12 条**，且 12 条全是上面 `skills.resourceRoot` 元数据，不是依赖返回值；依赖/内核返回值本身 **0 差异**（原 S4 的六条路径已被确定化编辑钉住）。日志：`inner-base12.txt`、`inner-baseresult.txt`。

## 4. 第 5 项：Q1-01 探针扩展

- `withStore` 回调收到的 store/reader（含读方法）用同一 recording proxy 包裹，每条 `kernel` 记录带 `method`、`args`、`seq`、`parent`（= 打开它的 `withStore` 调用序号）和 `outcome`；`kernel.read` 共 322 条（head 162、page 160），base/result 0 差异。
- 直接导出函数在**各自定义处**包裹：base 在 `context-assembler.ts`，result 在 `context-workspace-facts.ts` / `context-history-facts.ts` / `context-continuation-recipe.ts`。依赖参数同样经 `probeDeps`；若成员已是 factory 代理（成员级检查）则跳过，避免同一调用包两次。`direct` 共 191 条：`readKernelCommandFacts` 30、`briefWorkspaceFactsFor` 17、`runEnteredKernel` 72、`archiveOriginSkipsHistorySeed` 72；base/result 0 差异。
- 这些记录并入第 4 项的比较（同一 bar）。

## 5. 第 6 项：逐调用点读取点

完整表与旧/新代码对照在 `.dsh-scratch/R2/probes/e-assembler/read-points-per-site.md`。计数由独立的 `*.sites` 日志给出（不进比较 payload），靠**栈帧**区分同一方法的不同调用点。

| base 行（帧） | result 文件:行 | 方法 | 次数 base/result |
|---|---|---|---:|
| `:989`(`:991`) | `context-workspace-facts.ts:46` | `workspaceHost.resolveRoot` | 23 / 23 |
| `:1000`(`:1002`) | `context-workspace-facts.ts:57` | `workspaceSource.captureDigest` | 23 / 23 |
| `:1006`(`:1008`) | `context-workspace-facts.ts:63` | `workspaceSource.capture` | 23 / 23 |
| `:1061`(`:1063`) | `context-workspace-facts.ts:115` | `bodies.read`（capture changes） | 4 / 4 |
| `:1083`(`:1085`) | `context-workspace-facts.ts:137` | `workspaceHost.resolveRoot` | 2 / 2 |
| `:1179`（读 `:1189`） | `context-history-facts.ts:81`（读 `:90`） | `kernelStores.byAdapterId`/`withStore` | 20 / 20 |
| `:1238`（读 `:1139`） | `context-history-facts.ts:140`（读 `:40`） | 同上 | 24 / 24 |
| `:1279`+`:1358`（读 `:1288`） | `context-history-facts.ts:181`（读 `:189`） | 同上 | 49 / 48 |
| `:1582`（读 `:1600`） | `context-continuation-recipe.ts:139`（读 `:155/:164`） | 同上 | 72 / 72 |
| `:1389`/`:1394` | `context-review-recipe.ts:65`/`:70` | `unknownCallReviews.readReview` | 24 / 24 |
| `:1406`(`:1408`) | `context-review-recipe.ts:82` | `executions.readExecution` | 24 / 24 |
| `:1508`(`:1520`) | `context-continuation-recipe.ts:65`(`:76`) | `commandRerunRequests.listRequests` | 8 / 8 |
| `:1568`(`:1575`) | `context-continuation-recipe.ts:125`(`:131`) | `executions.readContinuationBasis` | 72 / 72 |
| `:1612` | `context-continuation-recipe.ts:170` | `briefWorkspaceFactsFor` | 72 / 72 |
| `:1619` | `context-continuation-recipe.ts:176` | `archiveOriginSkipsHistorySeed` | 72 / 72 |
| `:1643` | `context-continuation-recipe.ts:200` | `readTaskBlockedCommands` | 8 / 8 |
| `:1696`(`:1698`) | `context-work-recipe.ts:68` | `graphContext.readContextFacts` | 61 / 61 |
| `:1753`(`:1755`) | `context-work-recipe.ts:125` | `architectureReminders.read` | 10 / 10 |
| `:1793`(`:1795`) | `context-work-recipe.ts:165` | `graphContext.readContextFacts` | 14 / 14 |
| `:1823`(`:1825`) | `context-work-recipe.ts:195` | `taskInputs.readTaskInputPage` | 14 / 14 |
| `:1981`(`:1983`) | `context-query-recipe.ts:53` | `graphContext.readContextFacts` | 6 / 6 |
| `:2033`(`:2035`) | `context-assembler.ts:37` | `graphContext.readAttentionFacts` | 1 / 1 |
| `:1768`(`:1770`) | `context-work-recipe.ts:140` | `now` | 10 / 10 |
| `:975`(`:977`) | `context-workspace-facts.ts:32` | `now` | 72 / 72 |
| `session-operations.ts:960`/`:973` | 同（未移动） | `kernel.read` | 162 / 160 |

**零调用点（逐条旧/新对照见 artifact）：** `unknownCallReviews.listReviews`（base `:1503` → result `context-continuation-recipe.ts:60`，0 次，全部路径都传了 `input.reviews`）；`kernel.readTurnBounds`（base `:1598`、`:1607` → result `:155`、`:164`；owner 调用两边同为 `continuation-brief-assembly.ts:564`，0 次）；baseline bundle/artifact 的 `bodies.read`（base `:1053`、`:1092` → result `context-workspace-facts.ts:106`、`:145`，0 次）；`workspaceSource.readBaselineBlob`/`readCurrentFile`（base `:1111`、`:1112` → result `:164`、`:165`，0 次）；`kernelStores.forWorkspace`（owner 入口 base `:1179`、`:1238`、`:1279`、`:1358` → result `context-history-facts.ts:81`、`:140`、`:181`、`context-continuation-recipe.ts:139`，owner 只用 `byAdapterId`/`withStore`）；`roles.resolveRoleBindingFacts`、`materials.storeArtifact`、`materials.openArtifact`、`plans`、`sessions`（base deps 类型 `:113–120` → `context-types.ts:33–39`，两边都只携带不读）。S4 表里仍零调用的上述行状态不变；唯一变化是 `commandRerunRequests.listRequests` 由加宽的 11 个文件带到 8 次（base `:1520` → result `context-continuation-recipe.ts:76`）。

## 6. 第 7 项：Q3-01 边界矩阵

`edge-cases.ts` 140 → **158** 例，新增 18 例：(a) `goal:null`+`task:null`+可选行、budget 0 与 −1；(b) budget −1 且 `optional:{}` 与四个可选段全空数组，各配 goal/task 四种有无（8 例）；(c) 两个 Query 模板的 `prelude:''`、`goal:null`、`task:null`，planning 有/无 footprint 行、planning budget 0（有/无 footprint）。

| 项 | 结果 |
|---|---|
| 用例数 | 158（base `edge-base.jsonl` 158 行） |
| base 两次 | `cmp` **逐字节相同**；`compare-edge` cases=158 differences=0 errors=0 |
| base vs result | cases=158 **differences=0 errors=0**（完整返回对象：`input` UTF-8、`sections` 每段 range/count、`residentBytes`、`totalBytes`、key 顺序） |
| 抛错 | 0 例 |

日志：`edge-base.jsonl`、`edge-base2.jsonl`、`edge-result.jsonl`、`edge-base-determinism.json`、`edge-base-vs-result.json`。

## 7. 第 8 项：Q4-01 重放

- `replay.mjs` 不再用 reviver；`JSON.parse` 后用 `reviveUndefined` 原地走：对象 key 保留且值为 `undefined`，数组下标保留，key 顺序不变。
- 三行样例（`sample-revive.txt`）：第 1 行 `'k' in o=false`；第 2 行 `'k' in o=true, o.k===undefined`，数组 `length=2, 0 in a=true, a[0]===undefined, 1 in a=true, a[1]===null`；第 3 行 `'k' in o=true, o.k===null`。三种状态可区分。
- 用 S4 的 `base-run1.jsonl` 参数在 base-e / result-e 重放：各 **2,156/2,156** 条，**0 差异**；16 个 probe 的 calls 与 S4 完全一致（renderContext 236、attention 12、effectiveDuty 251、rolePayload 248、goalPayload 141、taskPayload 222、queryFocusLines 14、queryPlanSummary 1、notImplementedExtensions 109、noteSourcesOf 228、declarationsForTask 222、missingInputReminder 7、optionalRowsFromExtensions 232、annotations 228、topLevelModuleCards 2、generalWarningLabel 3）。这里的计数按录音里的 probe 名；result 适配器把其中 16 条 Query prelude 调用转给 `renderQueryContext`，对应 S4 §5.1 的 220+16。
- 保留 S4 的结论：两份录音只通过参数不同（临时 skills 路径、随机 id）；并加一句：**把同一份录音的参数分别送进 base 与 result 重放，就是本证明满足书 §5.0 规则 3 的方式（lead 对 Q4-02 的裁定）**。
- `replayed-r2-base.jsonl` 与 `replayed-r2-result.jsonl` **逐字节相同**。

## 8. 路径与命令

- kits：`.dsh-scratch/R2/probes/e-assembler/`、`.dsh-scratch/R2/probes/e-render/`
- e-assembler 日志/结果：`r2-base1/`、`r2-base2/`、`r2-result/`、`*.sites/`、`r2-*.jsonl`、`r2-base-vs-*.txt`、`inner-*.txt`、`capture-summary.txt`、`call-sites-*.txt`、`read-points-per-site.md`、`capture-all-r2.log`
- e-render：`edge-*.jsonl`、`edge-*.json`、`replayed-r2-*.jsonl`、`replay-r2-*-report.json`、`sample-revive.txt`、`revive.mjs`
- 全部命令：`.dsh-scratch/R2/COMMANDS-R2.md`
- 副本：`.dsh-scratch/R2/base-a`、`result-a`（e-assembler）；`base-e`、`result-e`（e-render）

## 9. 测试与检查

| 项 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | 通过 |
| 架构 | `npm run check:architecture` | `next source boundaries: OK` |
| build | `npm run build` | `platform prompt pack: OK` + tsc 通过 |
| 测试（8 文件） | `timeout 900 npx vitest run --maxWorkers=2 tests/runtime/S3-context-assembler.test.ts tests/runtime/K3-review-preparation.test.ts tests/runtime/K3-merge-cancel-propagation.test.ts tests/runtime/S4C2-assembly.test.ts tests/architecture` | **8/8 文件，100/100 项通过，0 失败**；无 `ENOENT … bwrap` 环境失败（带 run-capture 的固定 `GIT_*` 环境重跑一次，同样 100/100） |

## 10. Scope 检查

- `git diff --name-only 39fee06 HEAD`：只有 `src/core/agent-runtime/context-history-facts.ts`、`src/core/agent-runtime/context-rendering.ts`。
- `git diff 39fee06 HEAD`：1 行新增注释 + 11 行新增/6 行删除，全部是注释行；无代码、无测试、无 allowlist。
- `git status --porcelain`：空。
- 未改 `tests/`、`runtime-assets.json`、`package.json`、lock 文件或 `vendor/…/dist`；导出未变；没有新增生产符号。
