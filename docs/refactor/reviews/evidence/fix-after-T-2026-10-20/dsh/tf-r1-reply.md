# TF rework 1 回复（2026-10-21 夜）

提交：`8317081 TF rework 1`，`git diff --shortstat d4140be HEAD` = 22 files changed, 236 insertions(+), 162 deletions(-)。

## 1. 逐行结果

| 行 | 结果 | 文件（diff 行数） | 改了什么 |
|---|---|---|---|
| TFR-01 | 完成 | `src/core/work-graph/views/work-line-reader.ts` (+4/−16) | 删除 `readLegacyUnchecked` 及其调用和 L6/M7 旧注释（即 TFR-12 的 `:283` 注释）；`legacyUnchecked` 冻结字段保留，固定 `{ status:'exact', value:0 }`；秘书分支 `complete: true`；`countKinds` 保留（`countArchived` 仍用）。`S2C-lines-scale` 8/8 通过，含 exact 0。 |
| TFR-02 | 完成 | `persistence/plan-record-codecs.ts` (+20/−19)、`tasks/plan-readers.ts` (+11/−10)、`views/decision-read-model.ts` (+2/−2)、`tests/helpers/S5-decision-fixture.ts` (+9/−5) | 按 A1-007/A1-043：`decodePlanProposalOrigin` 拒绝缺 `since`（保留 `noticeAutomationCap`），返回 `since: CommitCursor`；`compareProposalChainPositions` 删两个 null 分支；两处 positions 改为 `Map<string, CommitCursor>`、直接用 `.since`、`get(...)!`；`seedCommit` 接受并转发 `commitCursorBindings`，`seedCandidateProposal` 用 `encodePlanProposal(proposal,{since:null})` + `planProposalRefKey(proposal.ref)` 的 `since` 绑定，与 `plan-service.ts:1419-1432` 同形；seed 未改成公开步骤（R-TF-2）。 |
| TFR-03 | 完成 | `tasks/unknown-call-review-service.ts` (+1/−1) | `readThrough = watermarks[0]!;`，水位一致性逻辑未动。 |
| TFR-04 | **BLOCKED（已撤销）** | 无（`session-record-codecs.ts`、`state/line-status.ts` 已还原到 `d4140be`） | codec 规则本身可用，但两个测试只靠手写记录到达状态：`tests/work-graph/R4c-task-claim-boundaries.test.ts:96`、`tests/work-graph/R4c-task-claim.test.ts:265` 经 `tests/helpers/task-claim-fixture.ts:471 overwriteSession` 把 Session 改成 `health:'unavailable'` 且保留 null conclusion 后提交；新校验以 `Error: fixture Session rewrite failed: {... "reason":"… session healthConclusion is required when health is unavailable"}` 拒绝。按“手写记录 → 停止该行、不转换未点名测试”的规则撤销。规格依据本身成立（`slice-2C-SPEC.md:1299`：null conclusion 只在第 1 片之前的旧数据里）。 |
| TFR-05 | 完成 | `tests/work-graph/A2-step1-codecs.test.ts` (+136/−34)、`persistence/evidence-record-codecs.ts` (+7/−2)、`state/verification-machine.ts` (+3/−3) | 转换后的用例：`publicInterruptedChain`（测试 :420-470）在真实 `createR3eEvidenceFixture`（memory+SQLite）上用 `createEvidenceService` 走 `openVerification` → `beginCheck`/`recordCheckResult`（真实 PASS）→ `beginCheck`/`interruptCheck(host_restart)` → `finalizeChecks` → 公开 `reverifyRound` 后继；保留五条 chain lookup 和 codec round-trip 断言（新 :487-502）。随后：codec 拒绝 `phase:'interrupted'` 且无有效 `incompleteCause` 的 check；fold 直接使用 `step.check.incompleteCause` 并总把 `(cause)` 写进 gap 文本。红证：临时去掉规则 `1 failed | 28 passed`（`expected 'decoded' to be 'invalid'`），还原后 `29 passed`。说明：公开写入方总写 cause，所以转换后的集成行本身不会因去掉 codec 规则而红；该红证来自同文件的拒绝用例（:519-533），这一点已如实列出。 |
| TFR-06 | 完成 | `state/session-availability.ts` (+3/−0) | `switch` 之后保留编译期穷尽：`return unreachable(event, 'Session event');`。 |
| TFR-07 | 完成（kept，note: proposal premise false） | `evidence/evidence-service.ts` (+9/−19，本行 hunk；该文件其他行 hunk 未动) | 按 `tf-base` 原样恢复 `mapWorkspaceRejection`（:180），四处调用（:924/:926/:1279/:1281）指回它，删除不再用的 `WorkspaceResult` import。前提为假：`src/core/workspace/ports.ts:12` 的 `WorkspaceError` 含非 `CoreError` 码。 |
| TFR-08 | **BLOCKED（未改代码）** | 无 | 命题不成立：`RunSnapshot.executionAuthorization` 是可选（`src/contracts/dispatch.ts:217`）；`history ?? authorization.kernel` 直接给出 TS18048，`!` 会在真实 RUN-23（cancelled + interrupted_clean，`src/contracts/run-activity.ts:91-103`，`runtime.ts:263` 允许）上抛错，显式拒绝会改变当前行为。按原样保留 fallback。 |
| TFR-09 | 完成 | `src/business/workflow/session-maintenance.ts` (+2/−2) | :338 删 `provenance === null || undefined` 分支，保留 `kind !== 'readonly_copy'`；:590 改 `record.provenance.kind`。 |
| TFR-10 | **BLOCKED（全部撤销）** | `tests/helpers/K3-35-runtime.ts` (0/−3)、`tests/helpers/K3-blocked-command-fixture.ts` (+1/−3)，均回到 `tf-base` | 曾把 S2B-36、S2B-38(b) 改成同一 Runtime（真实 `controls`、真实 exit/cleanup proof、A3 门控 `executions.readExecution`、entry 首次写拒绝后委托），转换本身 4/4 绿；但 `controls` 必需化会让本行未点名的 `tests/runtime/B2-runtime-execution.test.ts:383`、`:483` 变红（不同 Runtime 的后续 observe/replay 无 live proof，得到 `running` + occupancy 而非 `ended` + null）。按“一行全有或全无、不转换未点名测试”撤销全部 TFR-10 编辑（两个 S2B 测试、runtime/execution-contracts/execution-control/execution-observation、B2 fixture），并按本行把 TF1 加进两个 K3 helper 的 controls 接线撤掉。 |
| TFR-11 | 完成 | `scripts/verify-isolated.mjs` (+13/−7) | 在临时 public 目录写含 `PLATFORM_TOKEN_PLACEHOLDER`（`__PLATFORM_TOKEN__`）的 `index.html`，以 `publicDir` 传给 Host，保留三项检查（页面 token、带 token bootstrap 200、无 token 403），外层 `finally` 删除目录，修好 :36 注释。**未运行该脚本**（按任务书留给 lead）。 |
| TFR-12 | 完成 | 见下 | `plan-readers.ts:154`（completion 必需）、`:1317`（删 unlike readReworkRecords）、`owner-record-read.ts:7`（无 decode 消息参数）、`run-reconcile-service.ts:406`（删 unchecked legacy predecessor）、`work-line-reader.ts:283`（随 TFR-01）、`activity-read-model.ts:399`（Session 解析失败按读取失败传播）、`undelivered-reply-notices.ts:328`（只留 unavailableSince/进入位置检查）、`materials/applicability.ts:95`（run 分支 `return origin.owner`）、`S2C-K-retired.test.ts:277-293`（删旧场景说明）、`attention-observer.ts:373-376`（`sameDetails` 两参数必需，删缺失分支）。后 5 项由 E 做，前 4 项由 B/A 做。 |

## 2. 表外文件

无。所有改动都在任务书表格列出的文件内；`src/core/work-graph/persistence/evidence-record-codecs.ts` 是 TFR-05 明写的“and its codec”。TFR-10 撤销时改了 `tests/helpers/K3-35-runtime.ts`、`tests/helpers/K3-blocked-command-fixture.ts`（均在 D 的清单里），改动是**移除** TF1 加的 controls 接线，使二者与 `tf-base` 完全一致（`git diff tf-base --` 为空）。

## 3. 检查

- `flock ./.typecheck.lock npm run typecheck` → 0。
- `npm run check:architecture` → 0（`next source boundaries: OK`）。
- `npm run build` → 0。
- `npx tsc --noEmit -p tsconfig.json --noUnusedLocals 2>&1 | grep "TS6133\|TS6196\|TS6192\|TS6198"` → 0 行。
- Close-out（一个 subagent，无别人跑测试）：164 个 importer 测试文件，17 批，每批 ≤10、`timeout 900 npx vitest run --maxWorkers=2`，一次一条。**3131 passed / 20 failed / 29 skipped**（156 个文件全绿，8 个文件有失败）。20 个失败全部是 `ENOENT … /usr/bin/bwrap`，且对应文件 stem 均在 `.dsh-ref/env-failures.txt`；`state/invariants:297` 也是间接 bwrap（其检查命令 `test -f fixed.txt` 需 bwrap，round 停在 open，随后 `finalize_first`）。**不在 env-failures.txt 的环境失败：无，因此不逐条列。** 本轮改过的两个测试：`S2C-K-retired` 5/5、`A2-step1-codecs` 29/29。
- 分任务测试（支持性）：A 47 个 importer 文件 850 passed/10 bwrap；B 186 文件 1801 项 1760 passed/41 bwrap；C 23 个 importer 文件非环境全绿（目标 29 passed，红证见 TFR-05）；D 撤销后 4 文件/41 项 + 11 个 K3 helper importer/125 项全绿；E 16 文件 87/88，1 个 bwrap（`orchestration-mechanism:298`）。
- Ledger：`python3 -I ./.dsh-ref/d1-ledger.py . d4140be HEAD > ./.dsh-ref/out/ledger-r1.txt`，输出 21 行：REMOVED assertion 7、REMOVED test/describe 2、LOOSENED 0、删除测试文件 0、D3 hit 0。9 行全部在 `tests/work-graph/A2-step1-codecs.test.ts`，全部映射 **TFR-05**：
  - `:395`、`:396` 两条 readBack 断言 → TFR-05，等价断言在新 :487-488（store 换成真实 fixture，round 换成公开路径产出的 root/successor）；
  - `:403`…`:407` 五条 chain lookup 断言 → TFR-05，等价断言在新 :497-502（字面量换成 fixture 返回的 ids/scope）；
  - `:389` 旧 `.each` 测试名 → TFR-05，换成新 :470 的公开路径 `.each` 行；
  - `:420` 旧拒绝测试 → TFR-05，换成新 :519-533 的“rejects other malformed chains and an interrupted check without a cause”，仍覆盖未知 cause（`power_cut`）；新增了 interrupted 无 cause / cause null 的拒绝。
  无未映射行。

## 4. 怀疑表格有误 / HANDOFF

**怀疑表格有误：**
1. **TFR-08**：`executionAuthorization` 确实是可选的，且 RUN-23 真实路径没有 authorization；“narrowed authorization”前提不成立。按原样保留 fallback 才是当前行为；请 lead 裁定 B-023 是记 `kept` 还是换写法。
2. **TFR-04**：删旧形状的规则符合规格，但会红两个 R4c 测试（它们经 `task-claim-fixture.ts:471 overwriteSession` 手写 `unavailable` + null conclusion）。按任务书的 RED-TEST 规则未转换、未改 helper，整行撤销；若 lead 允许改这个测试 helper 补一个合法 conclusion（如 `missing`），可重做。
3. **TFR-10**：`controls` 必需化本身可行，但会红 `B2-runtime-execution.test.ts:383/:483` 的两个跨 Runtime 恢复用例（它们依赖“不同 Runtime 无 live proof”的旧路径）。本行未点名这两个测试，故按“全有或全无”撤销并撤回 K3 helper 接线；若 lead 允许把这两例改成同 Runtime 重试或交给启动 reconcile，可重做（转换后的两个 S2B 用例已验证为绿）。

HANDOFF：无，本轮已收尾；仅上述三行 BLOCKED，待 lead 裁定。
