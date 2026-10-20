# T2 回复（wave 2，第一段）

提交：`26cde07 T T2 wave 2`（w2-base = `d4c4cea`）。最终 shortstat：`92 files changed, 3246 insertions(+), 4752 deletions(-)`。
说明：本段在 runner 暂停前只来得及跑最后一次 `typecheck` 与 `check:architecture`（均绿）；**最后统一的全量改动测试矩阵没有跑**，各任务自己的测试批次见 §4。下一段第一件事见 §6。

## 1. 逐项结果

| 编号 | 结果 | 改了哪些文件 | 覆盖 | 备注 |
|---|---|---|---|---|
| T1-002 | done | K3-37-stopped-review-round.test.ts, K3-45-review-incomplete-r2.test.ts | K3-45 R2（+迁入的暂停期不开第二轮断言） | 删 K3-37 (三) |
| T1-016 | done | K3-11-review-reasons.test.ts, helpers/K3-proposal-round.ts | 真实 K3 链 + 真实 manifest display | settlementOwner 改为 737-748 同款接线 |
| T1-017 | done | K3-14-unknown-call-review-tool.test.ts | 同文件 310-351 适配器三例 | owner 层重复三例删除 |
| T1-018 | done | K3-14-unknown-call-review-tool.test.ts, 新 tests/state/K3-14-conclusion-pure.test.ts | 适配器/真实链；alias 9 rejects | 非 process 分支迁纯状态 |
| T1-021 | done | K3-47-reader-facts.test.ts, K3-26-unknown-call-review-storage.test.ts | K3-47 (二) 完整投影 | 坏 JSON 半段不迁，按条目删 |
| T1-022 | done | 删 tests/work-graph/K3-45-review-incomplete.test.ts | K3-45-r2:268-280 + 纯状态 403-413 | 补 `open:'yes'` |
| T1-023 | done | K3-48-2-...budget.test.ts | 真实 near-budget pending → claim → recordConclusion | 3,078 path bytes；1,500 拒、100 过 |
| T1-061 | done | UCR-settle-review.test.ts | UCR-06/07/08b + D6 + K3-10 全矩阵 | outcome_unknown/truncated/unreadable 均真实路径；多 process 计数例按刷新删 |
| T1-067 | done | WP2-context-extensions.test.ts | F07 | 100 次真实 propose，按返回 id 排序 |
| T1-070 | partial | unknown-call-review-list.test.ts + 4 helpers 的可选 goalRef/planRef | 分页/过滤/游标/watermark/双后端/205 例 | **仅“第二个 Goal 的记录”子例 BLOCKED**（见 §2） |
| T2-004 | done | helpers/S4B-text-search-support.ts | — | 只撤 at/event/SearchRequest export；change 保留 |
| T2-010 | done | R3a-transaction-boundaries.test.ts | AGENTS 第4条 / MVP-BEHAVIOR:201 | 删篡改用例 |
| T2-011 | done | R3a-transaction-boundaries.test.ts | project-bootstrap-contracts:37-45 | createProject+registerWorkspace |
| T2-012 | done | helpers/S4B-text-search-support.ts, S2A-ordered-lookup.test.ts | 共享 helper | +Lookup/OrderedLookup/Count port、真实 dir；S2A 保留三索引/unknown/分页 |
| T2-013 | done | helper 同上, S2C-count-lookup.test.ts | 共享 helper | +Count port；S2C 保留五索引/countOf |
| T2-014 | done | S4B-text-search.test.ts | T-05 %s（361-378） | 删双后端 agree 例 |
| T2-015 | done | S4B-text-search.test.ts | T-05 both（675） | 三例并一，refs/next/complete 全留 |
| T2-016 | done | 新 helpers/SP-record-store-support.ts, SP-literal-type, SP-lookup-index-migration | 新共享 helper | typed 可选默认体；open 各自保留 |
| T2-017 | done | lookup.test.ts | AGENTS:33 / MVP:201 | 删篡改段，索引重开段保留 |
| T2-018 | done | B2-04-allowance.test.ts | B2-09a（41-63） | 删重复失败提交例 |
| T2-019 | done | B2-04-allowance.test.ts, B2-09-allowance-crash.test.ts | B2-04:41-70 + B2-09b 场景 | 四条独有断言先迁入再删 owner 半段 |
| T2-020 | done | C1-communication-tools.test.ts | C2:70-99 | 删两重复例 + 无用 import |
| T2-023 | done | K3-15-blocked-sentence-pure.test.ts, K3-continuation-review-note.test.ts | K3-15:17-56（补断言后） | 摘要真实计算钉 a3a97065…；null/缺席等价 |
| T2-026 | done | R4b-session-operations.test.ts | AGENTS:33 | 删损坏 session.created 例 + DatabaseSync import |
| T2-027 | done | R4b-session-operations.test.ts | project-bootstrap-service:1125 | scope seed → 公开注册 |
| T2-034 | 未开始 | — | — | 留给下一段，见 §6 |
| T2-035 | done | S3-graph-tools.test.ts | GT07/08/09/13 | 公开 bootstrap/policy/catalog，Workspace revision 1 |
| T2-036 | done | S3-graph-tools.test.ts | 同四条 GT | 真实 Answer 计划、两个 Runtime Session、claim tA/tB、materials.storeArtifact、真实 declarationId |
| T2-037 | done | S4C-note-run-task-resolver.test.ts | GTN20/GTN21 | 真实 Run + 计数委托；GTN21 两 rejects |
| T2-038 | done | S4C-note-tools.test.ts | GTN02/03/06 + RW-14 | 严格 toEqual，默认值全迁；buildNoteTools 仅本文件 A7 |
| T2-039 | done | C6-unrelated-adoption.test.ts | C6 main path 54-160 | 变体删除前逐条核对主路径 |
| T2-040 | done | 26 个 scenario + support/process-sandbox-standin.ts | 26 份逐字相同类 | executeChecks:false；K3-12-14 不动；K3-13/19-missing-read 不迁 |
| T2-041 | done | K3-05, K3-06 | K3-05:86-198 | 迁 toolName/contained、purpose、rounds[1]、concluded/resolved items 长度 1 |
| T2-042 | done | support/review-card-round.ts + 14 调用方（含 K3-19-review-unavailable） | 共享 crashOneCommand | 身份/参数/真实 report/幂等 release；延后释放保持 |
| T2-043 | done | K3-05，删 K3-13-two-commands.test.ts | K3-05 目标 | alias/observed/open/evidence/items 长度 1 |
| T2-044 | done | support/review-card-round.ts, K3-16-proposal, K3-16-approval, K3-29-startup-variants | 三处提案轮 | prepare/start 拆开，中间 manifest/writeScope 检查保留 |
| T2-046 | done | support/review-work-root.ts + K3-17/K3-29-disposition/K3-44-recovery/K3-18-queue | 五份副本 | 延后 release 由调用方原位置执行 |
| T2-047 | done | K3-R1-file-change.test.ts | K3-04 replace/create | open 后首次 advance 前的钩子；manifest 返回；toolName/kind |
| T2-048 | done | K3-r1-seams.test.ts | K3-R1-restart-flows:84-101 | 删 137-160 与 162-182 + 头注 + 无用 import |
| T2-053 | done | harness.test.ts | C5/C8/A11/A2-automation-verdict | 删 191-212 + 头注 17-18 |
| T2-054 | done | harness.ts | 无调用 | 删 kernelRecords() |
| T2-055 | done | harness.ts | 无调用 | 删 setTokenBudget() |
| T2-056 | done | S1-anomaly.test.ts | UT19 | UT21 并入，名称保留两编号 |
| T2-060 | done | command-rerun-request-pure.test.ts | CRR-02 实文件 164-167 | 删纯例 |
| T2-061 | done | command-rerun-request-pure.test.ts, K3-B3-shared-rules-pure.test.ts | K3-B3:89-117 | 满八条迁入 + reason:'guard_failed'；构造器上限留 |
| T2-062 | done | control-intent-machine.test.ts | 决定 79-4 / AGENTS 第4条 | 只删 602-605/853-857/859-876，保留外层括号 |
| T2-063 | done | k3-review-claim.test.ts | :79 已有同断言 | 删 :92-98 空输入例 |
| T3-028 | done | helpers/K3-review-card-fixture.ts, K3-17-goal-guard, K3-46, K3-UR7 | 五份 disposition_applied 谓词 | 共用包装，保留 K3-46 的 pause/onConflict |
| T3-030 | done | helper + K3-46 + K3-UR7 | 三份内联 | wait 改 onChange 通知，无 sleep |
| T3-031 | done | K3-46, K3-UR7 | K3-46:626-659 | failedReviewRefs/failedCardRefs 双字段 + next 检查 |
| T3-032 | done | K3-15-ur3h.test.ts, K3-review-workflow-rows.test.ts | K3-15 (六) 203-248 | 源例删除，双后端 |
| T3-033 | done | K3-review-workflow-rows.test.ts | 原 settle_review 行 | 真实 claim/end/perform；独立 expectedOwnerResult + receipt.result + next |
| T3-034 | done | K3-review-workflow-rows.test.ts, helpers/K3-review-card-fixture.ts（lead 加 mailbox） | 三处 createWorkflow | 真 settings + 真 mailbox，删除 Map 替身 |
| T3-044 | done | WP2-wiring.test.ts | F09-F15 原业务断言 | 11 处 probe 全真实；missing 用 move/read/probe/restore，restore 在下一 Kernel 步前 |
| T3-077 | done | helpers/B2-401-world.ts | openK3BlockedCommandWorld | 一次调用，无新选项 |
| T3-078 | done | helpers/B2-crr-world.ts | 无消费者 | 删 runSnapshotOf + RunSnapshot import |
| T3-079 | done | K3-proposal-round.ts, K3-35-continuation-fixture.ts | runK3ReviewRound | 加 planRef 透传，K3-35 改调 |
| T3-080 | partial | K3-35-continuation-fixture.ts | 无外部消费者的 6 处 | **:157 K3_35_TASK_ID 仍有外部 importer，见 §2** |
| T3-084 | done | K3-proposal-round.ts | 无消费者 | 整删 dead function/type；18 处去 export；头注更新 |
| T3-102 | done | helpers/WP2-platform-support.ts | 无消费者 | 删 WP2_AT/goalSettingsWith + import + 4 处 export |
| T3-103 | partial | helpers/executed-files-stub.ts（保留）+ S5 各 helper/10 调用点 | 10/13 已接真 reader | **3 个调用方不在白名单，stub 不能删**，见 §2 |
| T3-105 | done | S5-user-message-tools.test.ts, helpers/WP2-platform-support.ts | TU07 | 真实 Runtime/Workflow/闸门；TU07 完成尾在无 bwrap 环境失败（见 §2/§4） |

**合计：58 done，3 partial，1 未开始（T2-034）。**

## 2. BLOCKED / partial 证据

- **T1-070 partial（第二个 Goal 子例）**：`tests/helpers/K3-35-runtime.ts:113` 的 `k3_35AuthorizeConfiguration` 拒绝 `input.run.ref.goalId !== GOAL_B.goalId`（Goal A → `forbidden / the K3-35 Host does not authorize this configuration`）。这是 unreachable（Host 授权被收窄），且该文件不在白名单；按 lead 裁定不拓宽。Goal B 的 pending/needs_decision/resolved、205 条真实任务（memory 18.1s / sqlite 20.7s）、真实 watermark+A3 全部完成；仅“第二 Goal 的记录/跨 Goal 过滤”未做。
- **T3-080 partial**：`tests/helpers/K3-35-continuation-fixture.ts:157` `K3_35_TASK_ID` 仍被 `tests/runtime/K3-35-workspace-baseline-prepare.test.ts:16` import、`:40` 使用；条目“无外部消费者”与代码不符，去 export 会破坏编译。其余 6 处已去 export，re-export 收成 3 项。
- **T3-103 partial**：stub 保留在 `tests/helpers/executed-files-stub.ts:21`。已接真 `createGoalExecutedFilesReader` 的 10 处；剩余 3 个调用方不在 T2 白名单：`tests/app/S5-decision-routes.test.ts:223`、`tests/helpers/K3-review-card-fixture.ts:335`、`tests/helpers/S2A-window-fixture.ts:48`。S5 fixture 已注册 `RUN_ACTIVITY_RECORD_SCHEMAS` 并真实转发 `lookupOrdered`；`S5-goal-settings-support.ts` 在 HEAD 已不存在。
- **T3-105（done，但 TU07 尾段环境失败）**：`tests/runtime/S5-user-message-tools.test.ts:436` 的 `run_check` 被 `ENOENT: no such file or directory, access '/usr/bin/bwrap'` 拒绝（本沙箱无 bwrap）。其余 pump/consumer/零变化断言通过；按书规则 11 属环境失败，需在有 bwrap 的环境复跑。
- **T2-034 未开始**：留给下一段（S3-context-assembler 的 harness 整体真实化，见 §6）。

## 3. 白名单外文件 / FORMAT

- `tests/scenarios/K3-19-review-unavailable.test.ts`：T2-040（sandbox 替身）和 T2-042（第 14 个 crashOneCommand 调用方）都改了它。T2-042 动作明确把它列为“六份逐字相同”之一，T2-040 的书面核对 `files_add` 也列了它，但 `t-files-T2.txt` 漏列。按要求报告。
- 其余改动均在白名单内。
- FORMAT 适配：无。
- 共享 helper 增加（均为可选、默认路径不变）：`K3ReviewCardWorld.mailbox`（lead 加）、`asS5OrderedRecords`（S5-decision-fixture）、`WP2PlatformOptions.checkRequirementKind`、`K3-proposal-round` 的 `goalRef/planRef` 可选参数、`B2-crr-world` 的 `goalRef/planRef`、`K3-35-continuation-fixture.claimRun` 的 `goalRef`。

## 4. 检查

- `flock ./.typecheck.lock npm run typecheck`：**通过**（最后提交后跑，tsc ×2 无输出）。
- `npm run check:architecture`：**通过**（`next source boundaries: OK`）。
- 各任务测试（均 `timeout 900 npx vitest run --maxWorkers=2`，≤10 文件/批）：
  - record-store/state 批：9+8 文件，161+514 通过。
  - S3/allowance 批：5 文件 28 通过。
  - scenario 合并批：7 文件 36 项中 29 过、7 个仅 bwrap 环境失败（C6 4、harness.test 3；w2-base 同样失败）；23 个 harness importer 分 3 批，A11 7 项仅 bwrap。
  - helper cleanup：61 文件 572 通过。
  - review-card fixture：37 文件 344 通过。
  - K3-37/K3-45：2 文件 3 通过。
  - K3-05/sandbox：2+26 文件 74+3 通过。
  - T1-016：K3-11 10 通过；30 个 importer 387 通过。
  - T1 转换/unify：5 文件 118 通过。
  - T2-042/044/046：3 批 38+20+2，清理后 16 通过。
  - T1-067/T3-103：83 importer 762 通过、1 失败（TU07 超时，HEAD 版同 helper 下 7/7 过；并发 T3-105 改写所致）。
  - T3-044：WP2-wiring 36 通过；WP2 消费 47 通过、1 失败（TU07 bwrap）。
  - T3-105：S5-user-message-tools 6 过、TU07 仅 bwrap；WP2 importer 84 项 83 过。
  - T1-023：1 文件 6 通过。
  - T1-070：目标 11 通过（41.7s）；65 importer 601 通过。
- **未跑**：最后统一的全量改动测试矩阵（runner 暂停）。下一段必须先跑（见 §6）。
- Ledger：`python3 -I ./.dsh-ref/d1-ledger.py . w2-base HEAD` → `257 lines to justify, plus 2 deleted files`。按文件映射（无未映射行）：

| 文件（去 tests/ 前缀） | REMOVED/LOOSENED 行 | 编号 |
|---|---|---|
| business/K3-15-ur3h | 1 | T3-032 |
| business/K3-46-review-advance-failures | 1 | T3-028/030/031 |
| business/K3-UR7-crr-failed-set | 5 | T3-028/030/031 |
| business/K3-review-workflow-rows | 6 | T3-032/033/034 |
| record-store/R3a-transaction-boundaries | 7 | T2-010/011 |
| record-store/S2A-ordered-lookup | 1 | T2-012 |
| record-store/S2C-count-lookup | 1 | T2-013 |
| record-store/S4B-text-search | 4 | T2-014/015 |
| record-store/SP-literal-type | 6 | T2-016 |
| record-store/lookup | 2 | T2-017 |
| runtime/B2-04-allowance | 4 | T2-018/019 |
| runtime/B2-09-allowance-crash | 6 | T2-019 |
| runtime/C1-communication-tools | 8 | T2-020 |
| runtime/K3-continuation-review-note | 3 | T2-023 |
| runtime/R4b-session-operations | 3 | T2-026/027 |
| runtime/S4C-note-run-task-resolver | 5 | T2-037 |
| runtime/S4C-note-tools | 16 | T2-038 |
| runtime/S5-user-message-tools | 8 | T3-105 |
| scenarios/C6-unrelated-adoption | 14 | T2-039 |
| scenarios/K3-05-review-round | 3 | T2-041/043 |
| scenarios/K3-06-mixed-batch | 12 | T2-041 |
| scenarios/K3-09-restart-between-calls | 1 | T2-042 |
| scenarios/K3-13-two-commands（整文件删） | 1 | T2-043 |
| scenarios/K3-16-proposal-round | 2 | T2-044 |
| scenarios/K3-29-maintenance/recovery-cont/recovery-round/startup | 各 1 | T2-042/044/046 |
| scenarios/K3-37-stopped-review-round | 18 | T1-002/T2-040/042 |
| scenarios/K3-44-hold-restart / K3-44-recovery-answers | 1 / 3 | T2-042/046 |
| scenarios/K3-45-review-incomplete-r2 | 1 | T1-002/T1-022/T2-040/042 |
| scenarios/K3-R1-file-change | 16 | T2-047 |
| scenarios/K3-r1-seams | 10 | T2-048 |
| scenarios/harness.test | 9 | T2-053 |
| state/S1-anomaly | 5 | T2-056 |
| state/command-rerun-request-pure | 8 | T2-060/061 |
| state/control-intent-machine | 11 | T2-062 |
| state/k3-review-claim | 2 | T2-063 |
| work-graph/K3-11-review-reasons | 8 | T1-016 |
| work-graph/K3-14-unknown-call-review-tool | 18 | T1-017/018 |
| work-graph/K3-26-unknown-call-review-storage | 6 | T1-021/T3-103 |
| work-graph/K3-45-review-incomplete（整文件删） | 1 | T1-022 |
| work-graph/K3-47-reader-facts | 1 | T1-021 |
| work-graph/K3-48-2-...budget | 1 | T1-023 |
| work-graph/UCR-settle-review | 10 | T1-061 |
| work-graph/unknown-call-review-list | 7 | T1-070 |

（另有 K3-20-review-card-paging、K3-B3-cancellation-cancelled、K3-29-* 等 sandbox 迁移，ledger 未列 REMOVED 行，属 T2-040；无 LOOSENED 单列。）

## 5. 疑似任务书错误

- T2-042 / T2-040 的条目明确点名 `K3-19-review-unavailable.test.ts`，但 `t-files-T2.txt` 未列它；已按条目施工并在 §3 报告。
- T3-080 声称 `K3_35_TASK_ID` 无外部消费者，实际 `K3-35-workspace-baseline-prepare.test.ts:16/40` 在用。
- T3-103 的 `S5-goal-settings-support.ts` 在 HEAD 已不存在；`S5R2-c/d` 也已无 records 工厂，条目行号过时。
- T2-037 的 `planId:'pl'` 与真实 `proposeInitialPlanFromAnswer` 不相容（平台签发 `initial-plan-…`）；已用采用返回的真实 planRef。
- T1-070 的“第二 Goal”路径被 `K3-35-runtime.ts:113` 的收窄授权挡住，条目未注明。

## 6. HANDOFF（第一段结束，下一段继续）

**已完成**：上面 58 项（含 T3-105；TU07 尾段需有 bwrap 的环境复跑）。**半成品/缺口**：T1-070（仅第二 Goal 子例）、T3-080（K3_35_TASK_ID export 保留）、T3-103（stub 保留）。**未开始**：T2-034。

**下一段第一件事**（本段没时间跑）：按书 §3.2 跑最终测试矩阵——`git diff --name-only w2-base HEAD` 里所有 `.test.ts`（约 90 个，减去 2 个已删除），每批 ≤10 文件、`timeout 900 npx vitest run --maxWorkers=2`；重点复跑 `tests/runtime/S5-user-message-tools.test.ts`（需要 `/usr/bin/bwrap`）、`tests/work-graph/K3-48-2-...budget.test.ts`（约 20s）、`tests/work-graph/unknown-call-review-list.test.ts`（41.7s）、`tests/composition/WP2-wiring.test.ts`（36 项）。绿后再 `flock ./.typecheck.lock npm run typecheck`、`npm run check:architecture`，按需补提交并重跑 ledger。

**本段新增的名字/接口（下一段别重复实现）**：`K3ReviewCardWorld.mailbox`；`asS5OrderedRecords`；`WP2PlatformOptions.checkRequirementKind`；`K3-proposal-round` 的 `goalRef/planRef` 可选参数；`B2-crr-world` 的 `goalRef/planRef`；`K3-35-continuation-fixture.claimRun({goalRef})`。

**坑**：
- `K3-35-runtime.ts:113` 把 Host 授权收窄到 GOAL_B；T1-070 第二 Goal 要拓宽它（不在白名单，需 lead 先裁）。
- `executed-files-stub.ts` 仍被 `tests/app/S5-decision-routes.test.ts:223`、`tests/helpers/K3-review-card-fixture.ts:335`、`tests/helpers/S2A-window-fixture.ts:48` 使用；接完才能删。
- `K3_35_TASK_ID` 的 export 不能去掉（外部测试 import）。
- T2-034 的现状：`tests/runtime/S3-context-assembler.test.ts` 的 harness 仍手造 TaskExecutionRecord/roles/Host/body store/扩展读取；按 T2-034 的书面改正整体真实化（真实 init→Session→claim→prepare→start→入口提交后取消；CA04 真实后继计划采用 + 真实 note；CA03 body-store 委托计数=1；CA15 真扩展依赖抛错）。
- `.dsh-ref/ledger-T2.txt` 已生成；提交未含 `.dsh-ref/`。
