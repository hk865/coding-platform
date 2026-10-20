# T 波次 1 返工 3 回复（DSH，2026-10-20）

基线：`w1r2` = `1c31c27`。本回复提交：`254617d`（`T W1 rework 3`，只含 `tests/`）。以下结果均指该提交。

## 1. 逐行结果

| 编号 | 结果 | 改了哪些文件 | 备注 |
|---|---|---|---|
| W3-01 | done | `tests/work-graph/S3-context-inputs.test.ts` | IN05 恢复为同一 Task 的 `runA2 → runA` 别名。fixture 真正造出 runA2：runA 完成后开真实验证轮、注册检查真实 FAIL（`check_failed`）、公开 `createTaskRequeueService` requeue、带返回的 `requeueRef` 二次 claim、R-7 真实 start/finish。`forbidden` 断言保留。本地 R-10 环境失败（见 §6）。 |
| W3-02 | done | 同上 | 公开 `createProject` + `registerWorkspace`（w、w2）；两个 Workspace 各自用真实 Session + 六次公开 `setLinePins` 从 @1 到 @7。删除三处 `commitRaw` 原始快照。 |
| W3-03 | done | 同上 | old-A/new-A 改走真实 `materials.storeArtifact`：执行材料用 work-run context + execution origin；平台材料用 Host context + `platform_operation` origin；缺 body 分支仍不写 old-A。 |
| W3-04 | done | 同上 | 回复、版本 pin、mailbox 读取全部使用 `sent.value.ref`；字面量只用于 Plan label 和 `expect(sent.value.ref.messageId).toBe(DECISION_MESSAGE_ID)`。 |
| W3-05 | done | 同上 | 每个验证根都真实写入 `check-b.js`，用 `createRegisteredCheckRunner(...).runRegisteredCheck` 在真实 Kernel sandbox 上跑，再 `finalizeChecks`；删除手写 observation 和直接 begin/record。本地 R-10 环境失败（见 §6）。 |
| W3-06 | done | 同上 | IN11 保留真实 report ref 比较，并新增字面量断言 `contentType === application/vnd.coding-platform.verification-check-report+json;version=1`，注释说明由 registered-check-report 写入产生，未 import 生产常量。该断言在 IN11 内，和 W3-05 一起受本地 R-10 环境影响。 |
| W3-07 | done | `tests/work-graph/S3-graph-context.test.ts` | 删除 `derivedSessionId`，三个 Session id 写成手算字面量（注释含 canonical JSON 输入）；公开 create 返回值逐个与字面量比较，保留 no-`b` 检查，后续步骤继续用返回 ref。 |
| W3-08 | done | `tests/work-graph/R4c-execution-read.test.ts` | 删除 `retire()` 和 BLOCKED 注释。把 fixture 的 `kernel.sqlite` 临时移开，用真实 probe owner 取 `missing`，原样交给 `healthOn().recordSessionHealth`，`finally` 放回数据库，再 archive。Session/Lease 断言未动。 |
| W3-09 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` | 保留 Kernel 破坏注入与恢复；删除测试自己读 Kernel store 和手写 `probe/result/basis` 判决。改为公开 `readExecution` + 真实 `createSessionHistoryCursorOwner` probe + `reconcileRunAtStartup`，断言真实报告 `{status:'reconciled', row:'W-05'}`；拒绝与 unchanged 断言保留。 |
| W3-10 | done | `tests/scenarios/S2C-K-legacy-provenance.test.ts` | P 创建后用公开 `readSession` 严格断言 `{schemaVersion:1, kind:'new'}`；C 的 continuation 与两段断言全部保留。 |
| W3-11 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` | 只改文字：`basePrepare` 注释改为“AD08 的 BLOCKED base 路径，和 AD06 的那一个被拒输入”。 |
| W3-12 | done | 无（仅本回复） | 已在 §6 写明更正。无测试改动。 |

## 2. BLOCKED / partial 部分

无 BLOCKED、无 partial。W3-01/W3-05/W3-06 的代码已完成，但本 DSH 环境没有 bwrap，四个沙箱测试只能按 R-10 记为环境失败，需 lead 在有 bwrap 的全量环境确认。证据见 §6。

## 3. R-6

没有发现表中事实与代码不符的行。补充一处实现路径说明（不是 R-6）：W3-08 写“真实 Kernel owner 的 `probe`”，实际公开 probe 在 `createSessionHistoryCursorOwner`（`src/core/agent-runtime/session-operations.ts:885`、`:1020`）；`createSessionOperations`（同文件 `:53-56`）只暴露 `createSession`/`readSessionHistory`，没有 `probe`。因此 W3-08 用 `createSessionHistoryCursorOwner({kernelStores})`，这正是 composition 里真实 probe 的 owner。

## 4. 删除的行/文件

本轮没有删除测试文件，也没有删除整行测试。只按行删除断言，见 §6 ledger 表：两条均归 W3-09（表中明确要求删除测试自己的 store 读取和手写判决）。

## 5. 行外文件与共享 helper

- 行外文件：无。改动仅限五个行内测试文件。
- 共享 helper 新增项：无。`S2B-runtime-steps-fixture.ts`、`S1-archive-service-fixture.ts`、`task-claim-fixture.ts`、`S5-decision-fixture.ts` 均未改。
- 因此“imports a changed helper”的补跑清单为空。

## 6. 检查

### 命令与结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `flock ./.typecheck.lock npm run typecheck` | 通过（两个 tsc 均无输出） |
| 架构检查 | `npm run check:architecture` | 通过，`next source boundaries: OK`，D3 hits 0 |
| 改动测试 | `CODING_AGENT_BWRAP_PATH=$HOME/.local/opt/bubblewrap/usr/bin/bwrap npx vitest run --maxWorkers=2 tests/work-graph/S3-context-inputs.test.ts tests/work-graph/S3-prepared-context-admission.test.ts tests/work-graph/S3-graph-context.test.ts tests/work-graph/R4c-execution-read.test.ts tests/scenarios/S2C-K-legacy-provenance.test.ts` | 5 个文件；144 项，140 过、4 失败（全部为 R-10 环境失败） |

分文件：`S3-context-inputs` 28 过/4 失败（32 项）；`S3-prepared-context-admission` 14/14；`S3-graph-context` 60/60；`R4c-execution-read` 37/37；`S2C-K-legacy-provenance` 1/1。四个非沙箱文件提交后单独重跑：`4 passed (4)`，`112 passed (112)`。

### R-10 沙箱环境失败

本机 `$HOME/.local/opt/bubblewrap/usr/bin/bwrap`、`/usr/bin/bwrap` 及全局搜索均不存在 bwrap。失败测试（memory 与 sqlite 各一份，共 4 项）：

- `S3-context-inputs.test.ts > IN05 an owner ref that resolves to a different Run is forbidden`
  `Error: S3 fixture FAIL check run failed: {"status":"rejected","code":"unsupported","reason":"ENOENT: no such file or directory, access '/home/han001/.local/opt/bubblewrap/usr/bin/bwrap'"}`
  位置：`tests/work-graph/S3-context-inputs.test.ts:623`。
- `S3-context-inputs.test.ts > IN11 a gate-result declaration selects the applicable chain head`
  `Error: S3 fixture gate check run failed: {"status":"rejected","code":"unsupported","reason":"ENOENT: no such file or directory, access '/home/han001/.local/opt/bubblewrap/usr/bin/bwrap'"}`
  位置：`tests/work-graph/S3-context-inputs.test.ts:779`。

未用替代 runner、未改 timeout、未 skip。

### Ledger 映射

`python3 -I ./.dsh-ref/d1-ledger.py . w1r2 HEAD > ./.dsh-ref/ledger-W1R3.txt`：3 条待说明，0 个删除文件，D3 hits 0。

| 文件 | REMOVED/LOOSENED 行 | 编号 |
|---|---|---|
| `tests/work-graph/S3-prepared-context-admission.test.ts` | 基线 `:666` 删除 `expect(kernelHistory.records.some(row => row.recordType === 'turn.started')).toBe(false)` | W3-09 |
| `tests/work-graph/S3-prepared-context-admission.test.ts` | 基线 `:674` 删除 `expect(committedRevoke).toMatchObject({ status: 'committed' })` | W3-09 |
| `tests/work-graph/S3-context-inputs.test.ts` | HEAD `:593` 新增常量期望 `expect(sent.value.ref.messageId).toBe(DECISION_MESSAGE_ID)`（ledger 的 ADDED 检测，不是 REMOVED/LOOSENED） | W3-04 |

两条删除都是 W3-09 明文要求“删除测试自己读 Kernel store 和手写判决”的组成部分：store 读取本身及手写 `reconcileRun(live_clean)` 的 committed 断言随该判决一起删除；W3-09 用真实 `reconcileRunAtStartup` 的 `{status:'reconciled', row:'W-05'}` 断言替换。`DECISION_MESSAGE_ID` 是文件内手算字面量（输入与步骤在 `:129-153` 注释），W3-04 明确要求保留这一条断言。

### Shortstat

`git diff --shortstat w1r2 HEAD` → `5 files changed, 357 insertions(+), 168 deletions(-)`。

### W3-12 更正

返工 2 台账里那条 LOOSENED 的错配更正为：它在 `tests/work-graph/S3-graph-context.test.ts:917`（W2-24），不在 `tests/runtime/R4c-graph-history.test.ts`（W2-17）。本轮不改测试；此处仅作台账更正。

## 7. 疑似错误

未发现需要阻断的表内事实错误。两处措辞可记录：

1. W3-08 的“真实 Kernel owner 的 `probe`”没有点名端口；`createSessionOperations` 并不暴露 `probe`，真正 owner 是 `createSessionHistoryCursorOwner`（`session-operations.ts:885`、`:1020`）。本轮按真实 owner 实现，W3-08 测试已通过。
2. W3-09 的“真实分类器对这个输入会答 `left`”指的是手写 `basis:'live_clean'` 的那组输入（`run-reconcile.ts:273`）；改用 `reconcileRunAtStartup` 的 `host_instance_takeover` 后会走 W-05（`:318-322`），与修法一致。

## 8. HANDOFF

不适用：本轮已收尾，未中途停止。唯一待确认项是 §6 的四个 R-10 沙箱测试，需 lead 在带 bwrap 的全量环境跑 `S3-context-inputs.test.ts`。
