# PC-2 R3 回信（2026-10-23 夜）

## 1. 未做与不适配（rule 6）

没有未做的行；A3-01～A3-05 全部适配。两处实现细节按审计口径处理，不算未做：

- **A3-02**：公开材料写入要求调用者是该 QueryRun 自己的 `query_run` 主体（`material-service.ts` 对 host 的 execution origin 会拒绝），因此保存反例时用该 Run 的公开 principal 和 `origin: {kind:'execution', ref:queryRunRef}`；读、绑定仍用 Host 上下文。测试用 `vi.spyOn` 捕获 composition 实际构造的**同一个** `QueryExecutionPort`，没有另造 owner，也没有 `commitRaw`。
- **A3-04**：实际 Query 输入不是 Work prelude，而是 Query prelude，并在 goal 槽内含 `## Question`；整文期望按冻结 pack 的 Query 文本手写，来源和 assistants 均未从请求或 manifest 复制。

## 2. 逐行

- **A3-01（J-06）**：新文件 `tests/runtime/PC2-joint-k3-history.test.ts`（141 行，1 例）。`openPCK3ReviewFixture({sourceHistory:'completed_turn'})` 经公开 prepare/start；源用户输入按 S5 冻结事实手写（`k3-20-a`、PLAN_B2、absent builder、Goal 未加载、Reminders 两行），assistant 为 `PC completed source history.`；整段两条 history 与手写字面 `toEqual`；`takesSessionHistory === true`；提醒恰 1 次且在 role 末尾；review item 为 fixture 的真实 `pc-pending-call`。变异 `src/core/agent-runtime/context-history-facts.ts:33`，`return input.sessionBasis?.throughPosition != null || input.hasCompletedCursor;` → `return false;`，RED 在整段 history `toEqual` 失败，undo 后 GREEN 1/1。
- **A3-02（G2-02）**：`tests/state/PC2-G-query-bind-order.test.ts`（191 行）。删除 `commitRaw` 的 Project/Workspace、手填 Session 创建和第二个 Query owner；改由 `openPCQueryFixture` 走真实 RL submit/createSession/claim/prepare 链，spy 捕获实际 `createQueryExecution`（断言只调用 1 次），manifest 经公开 `materials.openArtifact` 读、`materials.storeArtifact` 存，再调同一 port 的 `bindPreparedQuery`。变异 `src/core/work-graph/queries/query-execution.ts:1072`，`const sectionOrderProblem = frozenSectionOrderProblem({` → `const sectionOrderProblem = null; void ({`，RED 2/2（两例均变成 `idempotency_conflict` 而非 `invalid`），undo 后 GREEN 2/2。
- **A3-03（J2-03）**：`tests/runtime/PC2-joint-tools.test.ts`（405→417 行）。删 `startsWith`/`endsWith`/`toContain(briefText)`；start 后公开 `readContinuationBrief` 取 digest，拼 `[continuation-brief v1 sha256:${digest}]${brief}`，分别整段比较准备正文和最后一条请求消息的 continuation 段。变异 `src/contracts/continuation-brief.ts:307`，`sha256:` → `sha256-`，RED 在整段比较行失败（`...sha256:...` vs `...sha256-...`），undo 后 GREEN 1/1；整文件 8/8。
- **A3-04（J-04）**：`tests/runtime/PC2-joint-query-history.test.ts`（155→175 行）。新增三个独立整文字面：`SOURCE_INPUT`（1937 字符/1997 字节）、`DERIVED_CURRENT_INPUT`（928/984）、`REUSED_CURRENT_INPUT`（935/991）；`texts[0]` 与 `texts[2]` 均 `toBe` 整文；assistant、消息顺序、basis、section 名和提醒断言保留。变异 `src/core/agent-runtime/context-fact-text.ts:258`，任务标题后追加 `X`（`Implement A`→`Implement AX`），RED 在 `expect(texts[0]).toBe(SOURCE_INPUT)` 失败（前缀断言本可通过），undo 后 GREEN 1/1；整文件 2/2。
- **A3-05（J-08）**：`tests/runtime/PC2-joint-budget.test.ts`（434 行）。保留 `implement-a`；公开 `plans.queryTaskGraph` 读已采纳 Plan，`materials.storeArtifact` 存 29 字节材料（手算 digest `f6ec1d…`），追加 `pc2-j08-inputs`、assignment 和 `pc2-j08-input-1`，以新 planId `pc2-j08-input-plan@2`（同 planId 被生产拒绝）`proposePlan`/`applyPlanChange`；同 Session claim、prepare/start、结算、写 note、requeue、claim successor、prepare/start；断言 `selectedTaskInputs` 非空、`inputs` 整省 1 条、`footprint` 仍 `not_implemented`；当前输入改独立整文 `CURRENT_INPUT`，公开填 brief digest、previous run id、round id。变异 `src/core/agent-runtime/context-rendering.ts:270`，`if (count === 0) continue;` → `if (count === 0 || name === 'inputs') continue;`，RED 在 sections `toEqual` 缺 `inputs` 失败，undo 后 GREEN 1/1。

## 3. J-09 与 T2-03 变异记录

- **J-09**：`src/core/agent-runtime/execution-preparation.ts:419`，原 `tools: reviewPurpose !== undefined ? [...reviewToolNames] : intersectTools(hostConfig.tools, roleResolution),` 改为在结果上 `.filter(tool => tool !== 'write')`，删掉真实 write 授权；RED `expected 'ARSZ' to be 'ARESZ'`（测试第 127 行），undo 后 GREEN 1/1；整文件 8/8。上一轮只写“删 write+shell 授权”而无生产位置，本轮以此生产变异为准。
- **T2-03**：`src/contracts/continuation-brief.ts:307`，`[continuation-brief v1 sha256:${digest}]` 的 `v1 sha256:` 之间加一个空格；RED 1 failed/19 skipped（`PC2-T-render` 整文 marker 断言第 359 行），undo 后 GREEN 1 passed/19 skipped。测试与夹具未改。

## 4. 检查与测试

- `flock ./.dsh-scratch/tsc.lock npm run typecheck`：exit 0。
- `npm run check:architecture`：`next source boundaries: OK`，exit 0。
- 五个改动/新增文件：5 files / 14 tests passed。
- 全部 `tests/*/PC2-*.test.ts` 与 `tests/*/PC-*.test.ts`：74 files，8 批（每批 ≤10 文件、`--maxWorkers=2`、`timeout 900`），**409 passed，0 failed**。
- `tests/architecture`：4 files / 53 tests passed。
- 无 `ENOENT … bwrap` 或 sandbox `unsupported` 环境失败。
- 协调者只做了两处一行修正并在此报备：A3-05 的测试超时 90_000 恢复为 **60_000**（rule 3）；A3-02 为通过 typecheck 把闭包内的 `opened.value` 窄化为 `openedArtifact`（无行为变化）。

## 5. 提交

- 提交 `2efd8f8`：`PC-2 R3: A3-01, A3-02, A3-03, A3-04, A3-05`。
- `git status --porcelain` 空；`git diff --name-only 8f8a2f0 HEAD | grep -vE -f ./.dsh-ref/pc2-r3-whitelist.txt` 空；`git diff --name-only 8f8a2f0 HEAD -- src scripts resources runtime-assets.json tests/helpers` 空。
- `git diff --shortstat 8f8a2f0 HEAD`：**5 files changed, 576 insertions(+), 235 deletions(-)**。
