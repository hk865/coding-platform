# PC-2 R2 回信（2026-10-23 夜）

## 1. 未做与不适配（rule 6）

- **J2-03 未做**：整段 marker 无法独立手算。冻结夹具的 successor `runId` 是随机 UUID（两次 `11d67286…`、`52dcbb88…`），brief 的工作区 checkpoint 又对活动 SQLite 文件取 sourceDigest（`a8a8e3…`、`2e7768…`）；没有公开确定性入口。按“不要弯”保留原 `startsWith`/`endsWith`（与 `197b4ad` 字节相同），不声称完成。
- **J-06 未做**：`openPCK3ReviewFixture({sourceHistory:'completed_turn'})` 在断言前抛出 `the requeue failed: {"status":"rejected","code":"busy","reason":"the selected Run is verifying; finalize its round first"}`（`K3-35-continuation-fixture.ts:717`，经 `PC-platform-fixture.ts:587`）。该冻结分支完成源 Turn 后没有先走公开的 `registerCheckConfiguration → openVerification → finalizeChecks`；夹具不改，无法得到 RED/GREEN，也未新增 skip 文件。
- **J-08 只完成可达部分**：真实 Work 接续、`contextResidentBytes: 0` 下，`notes`（1 行）和 `reminders`（3 行）整体省略，`residentBytes === 0`，提醒在角色段末恰好一次并真实启动。`footprint` 在 `optionalRowsFromExtensions` 中硬编码为 `[]`（`context-fact-text.ts:316`）；`inputs` 在本夹具 Plan 无 inputRequirements，且公开 Plan 采纳拒绝已领取 Run 的 Task（“task implement-a already has a Run…”）。这两段不可达，未伪造。
- **J-04 措辞更正**：任务书写复用 Query 为 false/0；冻结链的源 Session 已有完成边界，按 PC-18“无 basis 的 Query 读真实边界”实际为 `takesSessionHistory:true`、无 `sessionBasis`、提醒 1。测试按实际值断言，空基线 0/0 例保留；这是更正，不是放宽。
- 无其他问题。

## 2. 逐行

- **A2-01..08 全 fix**：A2-01 unknown-slot 改回 `throw`，RED 1 failed；A2-02 未知模板后 `continue`，RED 1；A2-03 未知工具后 `continue`，RED 1；A2-04 恢复旧描述/值守卫，RED 1；A2-05 identity 改 `else if`，RED 1，原 id-syntax 清单已更新；A2-06 路径早返回，RED 1；A2-07 补 7 个冻结输入，删 `supplied.file !== file`，RED 1，其余六个变异各 RED 1；A2-08 仅注释。
- **H2-01..05**：H2-01 非 prompts 坏 JSON 测试，恢复“所有路由加 problems”变异 RED 1；H2-02 null templates/tools 两例，`|| true` 变异 RED 500≠400；H2-03 cycle+version 0+缺文件，恢复 cycle 早返回 RED 1；H2-04 same as J2-01；H2-05 仅删五处 `PC-2 ruling N` 前缀。
- **T2-01..06**：T2-01“refuses capacity instead of hiding…”用审计模板，合并 anomaly/review 变异 RED 1、GREEN 20/20；T2-02 两例嵌套工具块，删递归 RED 2；T2-03 64 位字面 digest，变异用生产 digest RED 1；T2-04 rejected（四处 `hasCompletedCursor` 原样）；T2-05 PU-03，生产变异 general note→reminders，RED 2、GREEN；T2-06 仅注释（30 行 `1418+29`、尾部 301/43、删 `tail 357`，数值不变）。
- **G2-01..06**：G2-01 null/missing binding 两例，`if(false && briefManifest.ok)` 变异 RED 2；G2-02 两条公开 `bindPreparedQuery` 反例，只绕过 Query 检查 RED 2；G2-03 新证据文件（独立 brief/摘要/模板/字符串/工具表/全文 147 字节），生产变异 toolNames→`[]` RED 1，checker 的 `[]`/平台字符串/删边界各 RED，GREEN 2；G2-04 撤掉 `invariants.test.ts` import+29 行，`diff af84802` 为空；G2-05 仅删注释行号；G2-06 `parts` 改 `[ROLE,GOAL,TASK]`，删逐元素比较 RED 1。
- **Q2-01..05**：Q2-01 rejected 未动；Q2-02 read/no-read 完整 `manifest.input` `toBe`，重复拼接变异 RED 1；Q2-03 same as J2-02；Q2-04 same as J2-04；Q2-05 仅注释。
- **J2-01（含 H2-04）** fix：三个设置场景全部改在 `host.live.platform` 上公开建 Goal/Plan/Session/claim，再 `prepareExecution/startRun/readPromptRecord`；删 `host.ts` 磁盘包注入变异 RED 3 failed/1 passed、GREEN 4。**J2-02（含 Q2-03）** fix：LA-1 新 Session 请求前两条消息手写字面比较；`execution-driver.ts:781` 传 `sessionBasis:undefined` 变异 RED 1、GREEN。**J2-03 未做**（§1）。**J2-04（含 Q2-04）** fix：Work 10 工具 19,602 字节 SHA `5e640e…`、Query 9 工具 14,751 字节 SHA `a0a912…`；删 `search` 变异 RED 1 failed/7 skipped、GREEN。
- **J-04** fix：新 `PC2-joint-query-history` derived/reused 两例，真实 `start()`；`query-execution.ts:584` 丢 `sessionBasis` 变异 RED 1 failed/1 passed、GREEN 2/2。**J-06 未做**（§1）。**J-08** 部分（§1）；`contextResidentBytes >= 0` → `> 0` 变异 RED 1、GREEN。**J-09（含 T-08）** fix：真实 `openPCWorkFixture({writable:true, tools:['read','write','shell']})`，`systemPrompt==='ARESZ'`；删 write+shell 授权变异 RED `ARZ`、GREEN。
- **F4** fix：`revisionFor: read <= 2` 两处 + RL-31 一处，其余未动；删准备期授权读取变异 RED 4 failed/45 passed、GREEN 53。

## 3. 检查与测试

- 静态：`build-kernel-patch --check` 16 sources、artifact 全部 `matches:true`；`build-platform-prompts --check` OK；`typecheck` exit 0；`check:architecture` `next source boundaries: OK`；`build` exit 0。
- 改动/新增：C1 10 文件/195 passed；C2 10 文件/56 passed、29 skipped、`invariants.test.ts` 环境失败；`PC2-G-query-bind-order` 在 PC2 批通过。
- `tests/app`：71 文件（70 执行，1 个 `*.scale` 被配置排除），410 passed、10 failed（8 文件；在 `197b4ad` worktree 同样失败）。
- `tests/architecture` 4/53 passed；`K-readonly-command` 33；`RL-31` 25；十个 `PC2-W-*` 10/28 passed。
- 所有 `tests/*/PC2-*` 与 `tests/*/PC-*`：73 文件/408 passed、0 failed。
- 非 scenarios importer：73 文件/568 passed、24 failed（23 tests + invariants suite）、29 skipped；9 个失败文件在 base 上 23 failed/1 passed/29 skipped，失败集合与文本相同。
- 环境失败文本：`ENOENT: no such file or directory, access '/usr/bin/bwrap'`；`the Kernel ProcessSandbox profile is not available; no host shell fallback`；`finalize_first: round ... is open`；AG2b 两例 `Test timed out in 30000ms`。`MVP-workbench-tools` 的“expected red until stage two”在 base 也失败。
- 未运行的 `tests/scenarios` importer：`A1-rework-same-session`、`A8-host-restart-{attestation,entry,paused}`、`C3-{brief-idempotency,not-entered-chain,reply-other-session,workspace-changed}`、`K-W-workflow-close`、`K3-16-approval-round`、`K3-17-review-answer-shape`、`K3-R1-{continuation-protection,file-change,restart-flows}`、`S3-query-graph`。

## 4. 提交

- `9e984e1`；`git status --porcelain` 空；白名单 diff 空；四个冻结夹具与 `WP2-platform-support.ts` 相对 `pc2-r2-base` diff 空。
- `git diff --shortstat 197b4ad HEAD` = **34 files changed, 1866 insertions(+), 448 deletions(-)**。
