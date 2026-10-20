# T 后修复轮（TF1–TF5）回复

日期 2026-10-20 夜；本副本基线 `tf-base` = `e99b385`（T merged）。本轮 HEAD = `d4140be`。
五个提交，按任务书顺序：

| 组 | 提交 | 文件 | +/− |
|---|---|---|---|
| TF1 | `d66c606 TF1 triage deletions` | 120 | +629 / −1057 |
| TF2 | `a127c23 TF2 restored tests` | 7 | +346 / −48 |
| TF3 | `54f4744 TF3 AD08` | 2 | +36 / −30 |
| TF4 | `92b7404 TF4 old workbench removed` | 123 | +412 / −16541 |
| TF5 | `d4140be TF5 unused names`（含 close-out 的 `core-routes.ts` 类型锚点，amend） | 158 | +171 / −346 |

各组完整文件清单：`git show --stat <commit>`；TF1 每行的 `files` 列在 `.dsh-ref/out/tf1-rows.tsv`。

`git diff --shortstat tf-base HEAD`：**372 files changed, 1594 insertions(+), 18022 deletions(-)**。
`.dsh-ref/`、`.dsh-scratch/`、`.typecheck.lock` 均未入库；`docs/`、`vendor/coding-agent/dist`、lock 文件未改。

环境：本机没有 `/usr/bin/bwrap`。所有只因此失败的测试在下面单列，未改测试、未放宽断言。

## 1. 各组做了什么

### TF1（triage 删除）
按 `.dsh-ref/tf-rows.tsv` 的 375 行，分五个文件组（tasks / views+state+persistence / 其余 work-graph /
agent-runtime+workspace+record-store+business+contracts / composition+app）并行执行。每行一条结果，
最终表格 `.dsh-ref/out/tf1-rows.tsv`（375 行，无缺行/重复）。NP-1…NP-6 的 null-provenance 链和
`provenance_unchecked` 标记/成员、CP-1 的过期注释均已处理。删除或简化后，对每个被改文件的测试导入者
分批跑了 `--maxWorkers=2`（flock 串行）；凡因删除变红的行按规则回退并记 `BLOCKED`。

**计数（375 行）**：`deleted` 111、`simplified` 81、`kept` 178、`BLOCKED` 5。

按组：

| 组 | 文件 | deleted | simplified | kept | BLOCKED |
|---|---|---|---|---|---|
| A `src/core/work-graph/tasks` | 24（+ `model/session-facts-contracts.ts`） | 51 | 0 | 41 | 0 |
| B `views`/`state`/`persistence` | 28 | 7 | 33 | 41 | 2 |
| C 其余 `src/core/work-graph` | 22 | 8 | 9 | 37 | 0 |
| D `agent-runtime`/`workspace`/`record-store`/`business`/`contracts` | 35 | 27 | 30 | 36 | 3 |
| E `composition`/`app` | 10 | 18 | 8 | 23 | 0 |
| Z `graph-context-reader.ts`（C4-113，TF3 执行） | 1 | 0 | 1 | 0 | 0 |

**BLOCKED（5 行，全部已回退到原状）**：

- `A1-026` — `tests/work-graph/A2-step1-codecs.test.ts:393`：测试把“interrupted check 缺
  `incompleteCause` 的 current chain-root round”当当前格式提交；新 codec 规则
  “a round check interrupted requires its incompleteCause”拒绝该提交，测试红。行已回退，codec/machine 未改。
- `A1-027` — 与 A1-026 同一处回退：没有 codec 拒绝时，`verification-machine.ts:823` 的
  `(${cause})` 会打出 `undefined`，因此不能单独删。
- `C2-039` — 把 `controls` 设为必需、删掉 controls-undefined 闭包/守卫后，
  `tests/runtime/S2B-36-observer-cancel-reread.test.ts:93` 期望 `rejected/cancelled` 实际 `ready`，
  `tests/runtime/S2B-38-run08-unknown-activity.test.ts` (b) 同样；这两条测试依赖
  controls-undefined / 无 cleanProof gate 的 observer 路径。已回退到 `e99b385` 形状，两条测试恢复绿。
- `C3-062` — 提案要求先在 `src/core/work-graph/sessions/session-directory.ts:710-712` 实现 slice-1
  §2.2 的 readonly_copy 创建检查（消息存在且 `consultationDerivation.childSessionRef`/本次固定派生吻合），
  才能删 `src/business/workflow/session-maintenance.ts:356-360` 的 ordinary-input 分支。该检查是新增生产行为、
  不在本行文件内，未实现；分支保留。
- `C3-063` — 与 C3-062 同一前置条件（`session-maintenance.ts:359` 的内层回调），同样保留。

**每个 `kept` 行的理由**：


### TF1-A tasks

- `A1-028` — integrity guard: the decoder stays total on a corrupt stored row (claim-record-codecs.ts:216)
- `A1-029` — integrity guard: the decoder stays total on a corrupt outbox row (claim-record-codecs.ts:281)
- `A1-041` — replay cross-check; only an edited event row disagrees (execution-history-service.ts:266)
- `A1-046` — conservative missing-holder lease; only a hand-written Lease (plan-readers.ts:1201)
- `A1-047` — range consistency guard against a corrupt index row (plan-readers.ts:1283)
- `A1-050` — phase filter guards the four-valued TaskReductionPhase contract (plan-readers.ts:1390)
- `A1-053` — fail-closed unavailable mapping kept as the single return (plan-readers.ts:1526)
- `A1-055` — hard-dependency missing-basis refusal; no tamper test (plan-readers.ts:1716)
- `A1-057` — basis consistency refusal; no tamper test (plan-readers.ts:1790)
- `A1-058` — unresolvable-origin conservative trace (plan-readers.ts:1803)
- `A1-062` — untraced-reduction branch kept; foreign reduction still refused (plan-readers.ts:2081)
- `A1-063` — fall-through of A1-062 kept (plan-readers.ts:2083)
- `A1-075` — basis range refusal on a rewritten Plan; no test (plan-task-basis.ts:282)
- `A1-076` — proposal offers at most an assertion; nothing deleted (reconcile-intents.ts:139)
- `A1-080` — optional assertion only; nothing to delete (run-reconcile-service.ts:592)
- `A1-081` — cross-reference refusal kept; tamper-only (run-state-service.ts:233)
- `A1-082` — cross-reference refusal kept; tamper-only (run-state-service.ts:242)
- `A1-083` — broken Plan link refusal kept; tamper-only (run-state-service.ts:256)
- `A1-084` — broken Session link refusal kept; tamper-only (run-state-service.ts:264)
- `A1-088` — single return of the chain checks kept (run-state-service.ts:564)
- `A1-095` — corrupt/unavailable mapping kept; tamper-only (task-service.ts:264)
- `A1-096` — final unavailable mapping kept; tamper-only (task-service.ts:267)
- `A1-098` — not_found rejection kept; tamper-only (unknown-call-review-service.ts:805)
- `B-071` — codec rejects illegal ended status/outcome; bad record only (claim-record-codecs.ts:245)
- `B-072` — second operand only for a hand-edited active Attempt (claim-record-codecs.ts:247)
- `B-073` — same check as B-071; concrete damage reason kept (claim-record-codecs.ts:248)
- `B-074` — same check as B-071; concrete damage reason kept (claim-record-codecs.ts:248)
- `B-075` — permit read boundary; old/tampered permit only (model-request-codecs.ts:92)
- `B-076` — persisted digest format check; no tamper test (model-request-codecs.ts:93)
- `B-077` — incomplete-permit refusal kept (model-request-codecs.ts:94)
- `B-078` — incomplete-permit refusal kept (model-request-codecs.ts:95)
- `B-086` — index/canonical recheck; corrupt index only (session-facts.ts:442)
- `C1-026` — matrix phases reserved for the named CoordinationPolicy writer (claim-service.ts:684)
- `C1-034` — not_found refusals kept; tamper-only (completion.ts:98)
- `C1-043` — not_found refusals kept; tamper-only (control-service.ts:112)
- `C1-045` — missingDefinition fallback kept; tamper-only (evidence-coverage.ts:50)
- `C1-048` — proposal offers two ways; kept the declared field and untested guard (execution-entry-service.ts:391)
- `C1-049` — proposal offers two ways; kept the declared field and untested guard (execution-entry-service.ts:399)
- `C1-050` — inadmissible arm reserved for the planned policy writer (execution-entry-service.ts:521)
- `C1-060` — decoder narrowing keeps a corrupt record from reading as empty (goal-executed-files-reader.ts:48)
- `C1-067` — lead decides on Delivery pins; member reserved (model-request-codecs.ts:73)

### TF1-B views/state/persistence

- `A1-003` — graph-repository.ts:335 corrupt->unavailable boundary mapping kept; no tamper test (rule 4)
- `A1-005` — note-record-codecs.ts:197 platform-source note branch; slice-4-SPEC.md:344 reserves it for slice 8
- `A1-006` — note-record-codecs.ts:197 same location/condition as A1-005; the slice-4-SPEC.md:344 reservation keeps the arm and the contract member
- `A1-007` — plan-record-codecs.ts:126 tolerance needs tests/helpers/S5-decision-fixture.ts changes (not in my row files); decoder stays lenient per proposal
- `A1-009` — plan-record-codecs.ts:740 unknown-kind rejection kept, untested (rule 4)
- `A1-013` — line-status.ts:289/353/824 needs sessions/session-record-codecs.ts:714-720 (group C file) to require the conclusion; today the codec still decodes null, so dropping the fallback would emit an undefined reason
- `A1-016` — line-status.ts:824 depends on A1-013 codec tightening at sessions/session-record-codecs.ts:714-720
- `A1-020` — run-machine.ts:1310 damaged phase/status combination rejection over the V2 union; no tamper test
- `A1-021` — run-machine.ts:1311 same exhaustive V2 phase rejection; no tamper test
- `A1-022` — run-machine.ts:1312 same exhaustive V2 phase rejection; no tamper test
- `A1-025` — task-failure.ts:1115 invalid-chain diagnostic kept; no tamper test; GAP-52 anchorRun note passed to lead
- `A2-028` — activity-read-model.ts:345 needs contracts/run-activity.ts, run-activity-codecs.ts and run-activity-service.ts (outside my rows) and L17 sign-off
- `A2-029` — activity-read-model.ts:367 same prerequisite as A2-028; the null arm stays
- `A2-031` — activity-read-model.ts:486 R4 cross-workspace recheck kept; the lead's call and no tamper test (rule 4)
- `A2-032` — goal-conflicts.ts:267 not_available kept: narrowing the slice-5 port DTO would break frozen 2C L15 and its tests
- `A2-035` — node-detail-reader.ts:1387 missing-Session guard kept untested; no forged-anchor test (rule 4)
- `A2-050` — track-read-model.ts:1078 workspace check kept (T3-089 R-3); the reachable project check is a separate public-input test
- `A2-064` — work-line-reader.ts:621 damaged-link bridge kept (2C B4); no tamper test
- `A2-068` — work-line-reader.ts:721 B4 problem marking kept; no tamper test
- `B-053` — evidence-record-codecs.ts:334 finalizedAt current-format check kept, untested (rule 4)
- `B-054` — evidence-record-codecs.ts:436 index revision==count check kept, untested (rule 4)
- `B-055` — note-record-codecs.ts:364 noticeClass key check kept, untested (rule 4)
- `B-056` — note-record-codecs.ts:387 notice-class enum check kept, untested (rule 4)
- `B-057` — note-record-codecs.ts:608 actor key check kept, untested (rule 4)
- `B-058` — note-record-codecs.ts:609 proof key check kept, untested (rule 4)
- `B-087` — activity-read-helpers.ts:187 missing dispatch -> unavailable with key; W2b-57 ruling, no tamper test
- `B-089` — automatic-rework-notices.ts:194 incomplete automation cap kept untested (shared cap type)
- `B-090` — automatic-rework-notices.ts:383 missing cap -> unavailable kept (TP-063), no tamper test
- `C1-007` — decision-record-codecs.ts:203 SessionWorkLink pin shape required by spec §3.3; no hand-written record test
- `C1-008` — decision-record-codecs.ts:213 callback of C1-007; same keep reason
- `C1-009` — execution-entry-codecs.ts:140 materialAccessRefs guard + declared field kept (rule 4)
- `C1-010` — execution-entry-codecs.ts:148 deliveryRefs guard + declared field kept (rule 4)
- `C1-020` — no-progress.ts:348 duplicate-checkId tie-break kept untested (proposal offers delete or keep)
- `C4-098` — decision-read-model.ts:1683 'rejected' is declared but un-writable (STATE-MACHINES-SPEC PLAN-07/D-17), so the fallback is kept
- `C4-123` — undelivered-reply-notices.ts:325 conflicting-Goal rejection kept; no record-doctoring test
- `C4-127` — work-line-reader.ts:144 pass-through needs WorkLineStore port narrowing, a structural change the lead decides
- `C4-128` — work-line-reader.ts:145 same as C4-127: commit forwarder kept until the port is narrowed
- `C4-131` — work-line-reader.ts:1542 N9 cycle repair; slice-2C-SPEC.md:1343 says defensive/no test
- `C4-132` — work-line-reader.ts:1556 N9-only filter; deletion needs dropping N9, the lead's call
- `C4-135` — work-line-reader.ts:2354 cycleRepresentativeOf; 2C N9 spec change required
- `C4-136` — work-line-reader.ts:2355 callback inside C4-135; same N9 reason

### TF1-C other work-graph

- `A2-001` — catalog-record-codecs.ts:219-223 read-side digest integrity check; no tamper test (rule 4)
- `A2-002` — catalog-service.ts:391-393 current-pointer read refuses corrupt baseline; integrity guard
- `A2-007` — role-memory-service.ts:92 replay identity guard on corrupt event; no tamper test (rule 4)
- `A2-008` — role-memory-service.ts:253 replay refusal, actor in identity key; no tamper test
- `A2-009` — role-memory-service.ts:289 replay refusal, actor in identity key; no tamper test
- `A2-010` — role-memory-service.ts:669 policy decoder refusal; no production policy writer (flagged, not this row)
- `A2-011` — role-memory-service.ts:680 dangling revision refusal for unwritten policy pointer; rule 4
- `A2-012` — role-record-codecs.ts:115 commit-time policy snapshot-ref validation; rule 4
- `A2-013` — role-record-codecs.ts:261 commit-time activeRevision check; rule 4
- `A2-014` — role-record-codecs.ts:286 decode-failure propagation for stored policy rows; rule 4
- `A2-017` — evidence-service.ts:625 invalid-chain refusal; :1117 effectively dead but harmless, no tamper test
- `A2-018` — evidence-service.ts:1200 invalid-chain arm of exhaustive switch; rule 4
- `A2-020` — record-readers.ts:202 commit-time Run locator schema validation; no tamper test
- `A2-023` — session-record-codecs.ts:785 registered schema boundary; no tamper test
- `A2-024` — session-record-codecs.ts:1032 link decode failure propagation; no tamper test
- `B-038` — catalog-record-codecs.ts:402 registered validator; since is null or a real bound cursor
- `B-040` — catalog-record-codecs.ts:458-460 non-null embedded since reject retained (condition simplified with B-039); no tamper test
- `B-041` — catalog-service.ts:394-397 missing catalog maps to explicit unavailable; rule 4
- `B-043` — catalog-service.ts:417 missing catalog beside baseline -> unavailable instead of TypeError; rule 4
- `B-044` — mailbox-service.ts:198 missing creation position refused on update; old-format/damaged record only
- `B-051` — mailbox-service.ts:3300 missing retirement position -> unavailable; damaged record only
- `B-052` — mailbox-service.ts:3303 missing reply position -> unavailable; damaged record only
- `B-059` — query-execution.ts:1065 G-CTX re-check; slice-3-SPEC.md:271 still requires it, so kept untested (no forged-manifest test)
- `B-060` — query-execution.ts:1068 G-CTX callKind re-check; same slice-3-SPEC.md:271 caveat, kept untested
- `B-065` — query-record-codecs.ts:237 stored QueryJob execution format check; rule 4
- `B-066` — query-record-codecs.ts:238 codec shape check, also run on write; rule 4
- `B-067` — query-record-codecs.ts:446 submission locator required; old-format/tampered snapshot only
- `B-068` — session-record-codecs.ts:661 operation provenance required; registered format check; rule 4
- `B-069` — session-record-codecs.ts:664 stored-operation provenance decode boundary; rule 4
- `B-070` — session-record-codecs.ts:736 Session provenance required; replaced the deleted backfill; rule 4
- `C1-005` — material-service.ts:300 exhaustive StoreFailure map; optional fromStoreFailure reuse not taken
- `C4-022` — decision-application.ts:96 explicit slice-6 placeholder; spec reserves it, no fabricated receipt
- `C4-023` — decision-application.ts:98 slice-6 placeholder kept with C4-022; no public receipt path
- `C4-025` — decision-source-facts.ts:201 damaged mapping for foreign source ref; no tamper test
- `C4-026` — decision-source-facts.ts:209 damaged mapping for hand-edited saved-answer key; no tamper test
- `C4-048` — note-anchors.ts:677 one-line not_ready guard is behaviour-neutral; proposal offers keep or widen refactor with no pick
- `C4-090` — session-record-codecs.ts:332 stored-record failure guard kept untested; proposal offers keep or delete with no pick; operation-failure lifecycle may be reserved

### TF1-D runtime/workspace/record-store/business/contracts

- `A3-002` — proposal keeps null-endedAt arm untested (optional 79 narrowing); src/contracts/continuation-brief.ts:604
- `A3-003` — proposal keeps null-reason arm untested (optional 79 narrowing); src/contracts/continuation-brief.ts:687
- `A3-015` — rule 4: truncated Kernel log only; src/core/agent-runtime/session-operations.ts:470
- `A3-016` — rule 4: damaged envelope leaves only; src/core/agent-runtime/source-capture-access.ts:71
- `A3-017` — rule 4, one decision with A3-016; src/core/agent-runtime/source-capture-access.ts:94
- `A3-020` — rule 4, one decision with A3-016; src/core/agent-runtime/source-capture-access.ts:440
- `A3-021` — retained slice-9 Reviewer groundwork per proposal; src/core/agent-runtime/source-capture-access.ts:455-459
- `A3-022` — two-way proposal (delete with A3-021 or keep); kept with A3-021; source-capture-access.ts:509
- `A3-026` — rule 4: terminal unknown-kind rejection; src/core/record-store/body-codec.ts:165
- `A3-027` — rule 4: content-address integrity guard; src/core/record-store/body-codec.ts:254
- `A3-028` — proposal leaves catch to lead ('low value either way'); src/core/record-store/body-store.ts:29-34
- `A3-029` — rule 4: wrong-key row only; src/core/record-store/body-store.ts:43
- `A3-030` — rule 4: key consistency; src/core/record-store/body-store.ts:55
- `A3-031` — rule 4: damaged stored row; src/core/record-store/guarded-revision.ts:20
- `A3-032` — rule 4: codec identity check; src/core/record-store/record-codec.ts:296
- `A3-033` — rule 4: corrupt-not-conflict plumbing; src/core/record-store/sqlite-record-store.ts:333
- `A3-034` — rule 4: damaged guard row; src/core/record-store/sqlite-record-store.ts:345
- `A3-035` — rule 4: read corrupt diagnosis; src/core/record-store/sqlite-record-store.ts:381
- `A3-036` — rule 4: corrupt propagation; src/core/record-store/sqlite-record-store.ts:413
- `A3-037` — rule 4: lookup integrity; src/core/record-store/sqlite-record-store.ts:583
- `B-034` — rule 4: hand-edited job/event only; proposal keeps untested; src/core/agent-runtime/source-capture-access.ts:650
- `B-035` — two-way proposal (delete after codec narrowing, or keep); kept as type narrowing; source-capture-access.ts:651
- `C2-003` — proposal offers delete or keep-untested; kept; src/contracts/core/prepared-execution.ts:149
- `C2-010` — 'Do not delete now', slice-6 decision; src/contracts/query-job.ts:262
- `C2-022` — proposal keeps for now pending slice-3-SPEC.md:502; src/core/agent-runtime/context-assembler.ts:916
- `C2-023` — with C2-022; src/core/agent-runtime/context-assembler.ts:917
- `C2-024` — with C2-022; src/core/agent-runtime/context-assembler.ts:918
- `C2-030` — proposal leaves generic sort vs spec narrowing to lead; src/core/agent-runtime/context-assembler.ts:1429
- `C2-031` — frozen K3-46 mixed card; keep projection untested; src/core/agent-runtime/context-assembler.ts:1439
- `C2-050` — proposal leaves zero-cost guard to lead; src/core/agent-runtime/exploration-tools.ts:239
- `C2-094` — proposal keeps rejection untested (optional sort drop); src/core/record-store/migrations.ts:113
- `C3-057` — two-way proposal (delete narrowly or keep untested); kept; src/business/workflow/decision-actions.ts:142
- `C3-070` — slice-1-SPEC.md:600 keeps the clock fallback; src/business/workflow/workflow.ts:2924
- `C3-104` — proposal leaves the catch to the lead; src/core/workspace/analysis-runner.ts:340
- `C3-105` — slice-8-SPEC.md:316/323 keeps the frozen accessor; src/core/workspace/capture.ts:341
- `C3-107` — proposal leaves the crash guard to the lead; src/core/workspace/capture.ts:590

### TF1-E composition/app

- `C3-001` — src/app/auto-capture-driver.ts:99 - proposal says keep untested; deletion only if the lead wants it gone; guards future throws
- `C3-004` — src/app/collaboration-driver.ts:556 - proposal either delete or keep untested; kept
- `C3-006` — src/app/collaboration-driver.ts:763 - either delete or keep untested; kept
- `C3-007` — src/app/collaboration-driver.ts:880 - either delete or keep untested; kept
- `C3-008` — src/app/collaboration-driver.ts:1007 - either delete or keep untested; kept
- `C3-009` — src/app/collaboration-driver.ts:1114 - either delete or keep untested; kept
- `C3-011` — src/app/core-routes.ts:627,728-730 - proposal offers a stub driver or a separate narrow builder; 33 calls in 12 test files; kept
- `C3-012` — src/app/core-routes.ts:634 - kept as test-only scaffolding only if the lead accepts the churn; decision-79 drop is not an instruction
- `C3-016` — src/app/goal-fan-out-driver.ts:218 - either delete or keep untested; kept
- `C3-017` — src/app/goal-fan-out-driver.ts:514 - either delete or keep untested; kept
- `C3-018` — src/app/goal-fan-out-driver.ts:525 - either delete or keep untested; kept
- `C3-026` — src/app/host-settings.ts:523-526 - proposal recommends keeping it with no test
- `C3-048` — src/app/main.ts:222 - proposal says replace or keep as cheap vendor guard, the lead decides; kept
- `C3-049` — src/app/runtime-configuration.ts:361 - proposal says keep; R6 documented default
- `C3-073` — src/composition/create-platform.ts:1142-1148 - proposal says keep both handlers; no test
- `C3-080` — src/composition/create-platform.ts:1276 - decision 6 / allowlist kept-for; fallback cannot go alone
- `C3-081` — src/composition/create-platform.ts:1278 - same as C3-080 (decision 6 / allowlist kept-for)
- `C3-082` — src/composition/create-platform.ts:1281 - decision 6 / allowlist kept-for; delete only if entry dropped
- `C3-083` — src/composition/create-platform.ts:1281 inner callback - keep with C3-082
- `C3-099` — src/composition/create-platform.ts:1999 - trackedCall requires the whenClosed arg; proposal says keep untested
- `C3-100` — src/composition/create-platform.ts:2015 - trackedCall requires the whenClosed arg; proposal says keep untested
- `C3-101` — src/composition/create-platform.ts:2025 - trackedCall requires the whenClosed arg; proposal says keep it
- `C3-102` — src/composition/create-platform.ts:2031 - same as C3-101; keep it

### BLOCKED（5）

- `A1-026` — tests/work-graph/A2-step1-codecs.test.ts:393: committing a "current chain-root round" whose interrupted check omits incompleteCause is rejected by the new codec rule ("a round check interrupted requires its incompleteCause"); row reverted, codec/machine unchanged
- `A1-027` — verification-machine.ts:823 reverted with A1-026; without the codec refusal the (${cause}) message would print undefined for a decodable interrupted check
- `C2-039` — tests/runtime/S2B-36-observer-cancel-reread.test.ts:93 expects rejected/cancelled, got ready; tests/runtime/S2B-38-run08-unknown-activity.test.ts (b) same. Making controls required removes the controls-undefined/no-cleanProof-gate observer path; row reverted to e99b385 shape, both tests green. C2-078 separately simplified.
- `C3-062` — precondition not implemented: the slice-1 §2.2 readonly_copy creation check belongs in src/core/work-graph/sessions/session-directory.ts:710-712 (message exists + consultationDerivation child matches); without it the branch at src/business/workflow/session-maintenance.ts:356-360 is kept. Adding the check is a new production behaviour outside this row's files, so the deletion was not applied.
- `C3-063` — precondition not implemented: the slice-1 §2.2 readonly_copy creation check belongs in src/core/work-graph/sessions/session-directory.ts:710-712 (message exists + consultationDerivation child matches); without it the branch at src/business/workflow/session-maintenance.ts:356-360 is kept. Adding the check is a new production behaviour outside this row's files, so the deletion was not applied.


### TF2（恢复七个测试）
按 `.dsh-ref/tw/tw-01.json` … `tw-07.json` 的 `restore`/`spec_basis`，在七个测试文件内恢复；没有改 `src/`
（红证明的临时破坏都已逐字恢复）。每个恢复都做了“破坏被守护行 → 红 → 恢复 → 绿”的证明；唯一例外是 tw-01 的 IN12，它的红/绿被本机缺少 bwrap 挡住（见第 2 节第 6 条）。

### TF3（AD08，test first）
先把 AD08 改成真实路径（`fixture.prepare()` 真 `prepareTaskForReal` → `fixture.changePins([sessionRef], [], 7,
'ad08-pin')` 真 `setLinePins` 把 Workspace @7→@8 → 真 entry）。红：两块后端都
`AssertionError: expected { status: 'committed', …(3) } to match object { status: 'rejected', …(1) }`，
期望 `revision_conflict`、实际 committed。最小生产改动：`baseSources`
（`src/core/work-graph/views/graph-context-reader.ts:1010-1022`）加入 Workspace record 的 ref+revision；
entry guard（`execution-entry-service.ts:1073-1079`）和 `contextConsumptionGuards` 本来就会比较/同提交守它。
绿：`S3-prepared-context-admission` 14/14（memory/sqlite），`S3-graph-context` 60/60。同时执行
C4-113（删 `listExecutions` 死回退、把依赖类型改为 `Required<Pick<…,'listExecutions'>>`）。

### TF4（删除旧 browser workbench）
删除 `src/ui/`（79 个文件）、`scripts/build-workbench.mjs`、`tsconfig.ui.json`；`package.json` 只改
`build`、`typecheck` 两行；`scripts/check-boundaries.mjs` 去掉 UI 前缀/owner/`tsconfig.ui` 要求/browser
import 规则；`tests/architecture/production-reach.ts` 改成单一 `tsconfig.json` Program、无 bundle entries；
`tests/architecture/*` 去掉 UI fixtures/期望。`tsconfig.json`/`tsconfig.build.json` 里只用于 `src/ui` 的
`exclude` 也顺手删除（任务书未逐条列，已在这里报告）。HTTP route、请求/响应 DTO、`src/app/server.ts`
静态 shell、`esbuild`/`marked` 依赖与 lock 文件都保留。

**删除的 11 个测试文件（每个一行）**：
- `tests/app/R6-workbench.test.ts` — workbench 构建/静态资源 + DTO renderer。
- `tests/app/goal-conversation-start.test.ts` — `src/ui/main.ts` 的启动 seam。
- `tests/app/session-rendering.test.ts` — history markdown/timeline 渲染。
- `tests/app/settings-ui.test.ts` — settings 控制器/对话框。
- `tests/app/ui-actions.test.ts` — action 表。
- `tests/app/ui-change-refetch.test.ts` — record-notice refetch。
- `tests/app/ui-live-wiring.test.ts` — `main.ts` live wiring/poll。
- `tests/app/ui-live.test.ts` — change-stream client。
- `tests/app/ui-refresh.test.ts` — refresh hub。
- `tests/app/ui-sse.test.ts` — SSE parser。
- `tests/app/ui-store.test.ts` — store/scope 状态。

**改动的测试/辅助文件（每个一行）**：
- `tests/app/A2-continuation-projection.test.ts` — Host 续接投影；只把借用的 UI token meta 常量换成 `host-page` helper。
- `tests/app/A2-runtime-capabilities.test.ts` — Host runtime capabilities；同上 token 常量。
- `tests/app/K-R-runtime-capabilities.test.ts` — Host 只读 runtime capabilities；同上 token 常量。
- `tests/app/RL-44-host-restart-resource-caps.test.ts` — Host 重启资源上限；同上 token 常量。
- `tests/app/S2B-35-activity-routes.test.ts` — activity routes；同上 token 常量。
- `tests/app/S4C-record-note-host.test.ts` — record/note Host routes；同上 token 常量。
- `tests/app/change-commit-observer.test.ts` — change commit observer；同上 token 常量。
- `tests/runtime/K-readonly-command.test.ts` — 只读命令；同上 token 常量。
- `tests/helpers/A2-restart-fixture.ts` — 重启 fixture；同上 token 常量。
- `tests/helpers/AG2b-collaboration-fixture.ts` — collaboration fixture；同上 token 常量。
- `tests/helpers/K-readonly-host-support.ts` — 只读 Host support；同上 token 常量。
- `tests/helpers/S2B-r2-backfill-kernel-support.ts` — backfill Kernel support；同上 token 常量。
- `tests/helpers/runtime-capabilities-fixture.ts` — runtime capabilities fixture；同上 token 常量。
- `tests/app/support/S8A-L8-host.ts` — L8 Host；`SETTINGS_API_PREFIX` 改从 Host DTO 取。
- `tests/app/R6-host.test.ts` — Host HTTP/静态/SQLite；改为自己写页面，后端断言保留。
- `tests/app/host-settings.test.ts` — Host settings 后端；自己写页面，后端断言保留。
- `tests/app/AG2-consultation.test.ts` — consultation 后端；自己写页面，后端断言保留。
- `tests/app/AG2b-collaboration.test.ts` — collaboration 后端；自己写页面，后端断言保留。
- `tests/app/orchestration-mechanism.test.ts` — Host orchestration 机制；自己写页面，后端断言保留。
- `tests/app/MVP-ui-entry.test.ts` — 保留 Host route-table/HTTP boundary/cold-start；删掉 UI-only containment、scope display、directory inventory 行。
- `tests/app/S2C-line-routes.test.ts` — 保留 Host `CORE_ROUTE_SPECS` 行；删掉 UI route-label/graph_write 行。
- `tests/architecture/boundaries.test.ts` — boundary checker 测试；UI 规则/文案移除。
- `tests/architecture/production-reach.test.ts` — reach 分析测试；UI fixture 与 bundle-entry 用例移除。
- `tests/architecture/production-reach.ts` — reach helper；单 Program、无 `UI_DIRECTORY`/build-workbench。
- `tests/architecture/state-writes.test.ts` — state-write 规则；仅注释。
- `tests/helpers/host-page.ts` — 新增 24 行 helper，提供页面/meta-name token。
- `scripts/check-boundaries.mjs` — UI 专属规则移除，其它规则保留。
- `package.json` — 只改 `build`、`typecheck` 两行。
- `tsconfig.json`、`tsconfig.build.json` — 删除已不存在的 `src/ui` exclude。
- `tsconfig.ui.json`、`scripts/build-workbench.mjs` — 删除。

**Phase 2（allowlist + §5 step 5）**：`production-reach.test.ts` 绿（4/4）。phase 1 删除的声明原本不在
allowlist，故移除 0 条。`src/ui` 删除后只有 48 个 `src/app/core-http-types.ts` 的 HTTP 请求/响应 DTO 变成
unreached；它们都是 wire-format/HTTP 路由类型，全部保留，并按 allowlist 的 `wire-format` 机制补 48 条
（note 写明路由边界与 E3 新工作台），报告为 **kept for E3**。phase 2 没有删除任何声明。最终 allowlist 212 条
（164 + 48）。48 个 kept for E3 名字：

`ProjectsCreateResponse; WorkspacesRegisterResponse; CompletionPoliciesInstallResponse; CompletionPoliciesActivateResponse; GoalsCreateResponse; ArchitectureAdoptInitialResponse; ArchitectureReadBody; PlansProposeResponse; PlansApplyResponse; FilesReadResponse; SourceCaptureResponse; SourceQueryResponse; SessionsFindResponse; SessionsReadResponse; SessionsOperationResponse; RuntimeCapabilitiesResponse; SessionsCreateResponse; SessionsHistoryResponse; MessagesSendResponse; MessagesInboxResponse; MessagesReadResponse; MessagesBodyResponse; WorkspacesRegistrationResponse; QueriesSubmitBody; QueriesSubmitResponse; QueriesReadResponse; QueriesPrepareResponse; QueriesStartResponse; QueriesAnswerBody; QueriesAnswerResponse; MaterialsOpenResponse; WorkflowGoalInputBody; WorkflowAdvanceBody; WorkflowConsultationBody; WorkflowConsultationResponse; WorkflowDriverStartBody; WorkflowDriverStartResponse; WorkflowDriverReadResponse; WorkflowDriverStopResponse; ExecutionsReadResponse; ExecutionsHistoryResponse; ExecutionsListResponse; ProjectsReadResponse; FilesSaveResponse; FilesCompareResponse; CommandsStartResponse; CommandsReadResponse; CommandsStopResponse`。

**close-out 的集成修复**：TF5 删掉 `core-routes.ts` 里三个只做类型锚点的 `*CoreRouteDto` import 后，
`Slice1CoreRouteDto`/`Slice2CCoreRouteDto`/`K3CoreRouteDto` 及其 52 个成员变成 unreached。close-out 没有改行为，
只把这三个 DTO 重新 import，并把 `CORE_ROUTE_SPECS` 的类型写成
`Record<CoreRouteSuffix | keyof Slice1CoreRouteDto | keyof Slice2CCoreRouteDto | keyof K3CoreRouteDto, CoreRouteSpec>`
（`src/app/core-routes.ts:76-83, 362-370`，+13/−2，type-only）。这让它们重新 reachable，allowlist 的 48 条
`wire-format` 条目不 stale（它们不在三个 assembly 内），`production-reach` 仍 4/4。该修复 amend 进 TF5 提交。

### TF5（未使用的本地名）
`tf5-before.txt` 290 条（TS6133/TS6196/TS6192/TS6198），逐条删除；`tf5-after.txt` 最终 **0 条**，同一次
`--noUnusedLocals` 运行 0 个 tsc error。158 个文件 +171/−346。没有删导出声明、参数或 `_` 前缀名；
删除 binding 但保留有副作用的调用（如 `await reply(...)`）。81 个改动的测试文件跑了 9 批：893 通过、1 skip；
5 个文件失败均为 bwrap 环境（同一批文件在干净树上同样失败）。其中 `tests/work-graph/S2C-K-archive-tags-checks.test.ts`
的 `archiveLine` 是死 helper（含一个不可达的 `expect`），作为未使用本地函数删除；这是 ledger 里唯一由 TF5 解释的
removed assertion。

## 2. TF2：逐个恢复与红/绿证明

1. **tw-04 / A2-054、A2-055** — `tests/work-graph/WP2-undelivered-notices.test.ts`
   “M05 a Goal-filtered read excludes another Goal reply before requiring its positions”。
   破坏 `undelivered-reply-notices.ts:331` 的 `goalRef.goalId !== input.goalRef.goalId`（改成 `===`）。
   红：期望 `[]`，实际收到 1 条 `undelivered_reply`。恢复后绿：24/24。
2. **tw-05 / A2-059…A2-063** — `tests/work-graph/S2C-lines-failure.test.ts`
   “2C-14/T5x a real Run end between the head and occupancy reads rereads once and heals” 与
   “a second real Run end on the reread leaves the row source_moving with no bucket”。
   破坏 `work-line-reader.ts:366` 的 `if (inconsistentOccupancy && !reread)`（改成 `reread`）。
   红：4 failed/16 passed，两块后端 `expected 1 to be 2`（:253、:287）。恢复后绿：20/20。
3. **tw-06 / A3-038** — `tests/data/S8E-A07-git-inventory.test.ts`（A-07 repo root + subdirectory，memory/sqlite）。
   破坏 `project-source-snapshot.ts:176` 的 `if (!metadata.isFile()) continue`（反过来）。
   红：4/4 failed，:73 期望 3 个 node、实际 `[]`。恢复后绿：4/4。
4. **tw-07 / A3-039** — `tests/data/typescript-source-query.test.ts`
   “honors a non-wildcard tsconfig include without indexing sibling files”。
   破坏 `typescript-source-query.ts:104` 右操作数（去掉 `&& name.startsWith(...)`）。
   红：1 failed/7，:226 期望 true、实际 false（兄弟文件被索引）。恢复后绿：8/8。
5. **tw-01 / A1-032、A1-034、A1-036** — `tests/work-graph/S3-context-inputs.test.ts`
   “IN04 a canonical owner in another workspace is forbidden and returns no body”。三次破坏：
   `context-input-service.ts:455-456` 的 workspace 操作数、`:507` 的 `return scope`、`:988` 的 `return result`→`continue`。
   红：openArtifactCalls 期望 0 实际 1；期望 rejected/forbidden 实际 ready/missingSelection；期望 rejected 实际 ready `[]`。
   各自恢复后绿：2 passed（memory/sqlite）。
6. **tw-01 / A1-035（IN12）** — 同文件 “IN12 a newer finalized FAIL gate head is missing with no applicable round”。
   恢复体按 `restore` 写好（`seedRounds:'fail'`、真实 `openVerification`→`runRegisteredCheck('process.exit(1);')`→
   `finalizeChecks` FAIL→断言 missing/no_applicable_round/source:null）。**红/绿证明被环境挡住**：fixture 的
   `runRegisteredCheck` 在进入测试体前就 `ENOENT … /usr/bin/bwrap`（与 IN05/IN11 相同）。不是 BLOCKED，是环境失败；
   代码形状按 restore 落地，lead 在有 bwrap 的环境跑。
7. **tw-02 / A1-059、A1-061** — `tests/work-graph/W1-future-plan.test.ts`
   “scenario 9: a claim landing between the Run index page and the Lease batch…”。
   破坏 `plan-readers.ts:2052` 的 then-arm（`&& leaseRecord.refKey === '__w1_never__'`）和 `:2054` 的 `entry.lease = null`。
   红：期望 “task B already holds a TaskLease…”，实际 “record version changed”。恢复后绿：1 passed。
8. **tw-03 / A1-077** — `tests/runtime/A2-reconcile-runtime.test.ts`
   “W-05 with a queued pause at a restart…”。破坏 `reconcile-intents.ts:169`（`intent.kind === 'pause' && false`）。
   红：reconcile failed “a cancelled observation must belong to a cancel intent”。恢复后绿：1 passed。

TF2 只改上述 7 个测试文件；临时破坏的 3 个 src 行都已恢复，无 src 改动残留。

## 3. TF3：AD08 红/绿与回归

- 红（memory 与 sqlite 相同）：
  `AssertionError: expected { status: 'committed', …(3) } to match object { status: 'rejected', …(1) }`
  —— 期望 `revision_conflict`，实际 `committed`（真实 prepare 的 binding 没有 Workspace source，entry guard 不比它）。
- 生产改动：`src/core/work-graph/views/graph-context-reader.ts:1010-1022` 的 `baseSources` 加
  `{ kind: 'record', ref: universe.workspace.ref, revision: universe.workspace.revision, digest: null }`；
  canonical 排序/去重仍由 `context-assembler.ts:215-225` 的 `sortedSources` 一处负责。guard 代码未改。
- 绿：`S3-prepared-context-admission.test.ts` 14/14（两块后端），`S3-graph-context.test.ts` 60/60。
- 回归：`grep -rln "prepareExecution\|enterTaskExecution\|prepareTaskForReal" tests | grep '\.test\.ts$'` 的 50 个
  `.test.ts`，分 5 个/批、`--maxWorkers=2`、flock。最终 **44/50 通过**；6 个失败全部是
  `ENOENT … /usr/bin/bwrap`/`sandbox_unavailable`（A2-requeue-platform、S2B-be1s-shell、S5-user-message-tools、
  A7-control、A2-verification-chain、state/invariants）。**没有一个文件因 Workspace revision 在 prepare 与 entry
  之间变化而失败**，所以没有需要列的“新行为”文件，也没有改任何回归测试。

## 4. TF4：phase 2 声明删除与 kept for E3
- 删除的声明：**0**（48 个 unreached 全是 HTTP 路由 DTO，保留）。
- kept for E3：上面 48 个 `src/app/core-http-types.ts` 名字。
- allowlist：212 条（164+48）；`production-reach.test.ts` 4/4；`check:architecture` 0。

## 5. 检查（close-out，最终树）

- `flock ./.typecheck.lock npm run typecheck`：**0**（我跑，最后一次在 amend 后）。
- `npx tsc --noEmit -p tsconfig.json --noUnusedLocals`：**0**，无 TS6133/6196/6192/6198（`tf5-after.txt` 为空）。
- `npm run check:architecture`：**0**，尾部 `next source boundaries: OK`（模块边 7/8，子模块边 56）。
- `npm run build`：**0**（只有 `tsc -p tsconfig.build.json`）。
- `tests/architecture/{boundaries,production-reach,state-writes}.test.ts`：**3 files / 52 tests 全过**。
- 改/删文件的 importer 测试：441 个文件（195 个改/删 src 的 import 解析 + 124 个改动的 `.test.ts`；
  11 个删除测试不计），45 批（每批 ≤10，`--maxWorkers=2`，flock，`timeout 900`）：
  **411 文件通过，30 文件失败，6604 tests passed / 86 failed / 30 skipped**。30 个失败全部是
  bwrap `ENOENT` / `ProcessSandbox profile is not available` / `run_check unsupported`，**零个非环境失败**。
  补充 98 个 changed-helper 的 importer（10 批）：24 个失败文件同样全是环境。
  失败文件与“known env list” 见 close-out 报告（A2-requeue-platform、S5-user-message-tools、A7-control(+goal29)、
  A2-verification-chain(+platform)、state/invariants、R6-host、R5c-workflow-platform、S2C-K-archive-tags-checks、
  K3-44-recovery-answers、AG2b-collaboration、A2-disposition-change、A2-reverify-platform、A2-automation-verdict、
  A8-host-restart(-lease/-paused)、C8-human-stop-respected、K3-07-real-host-kill、K3-29-disposition-recovery、
  R5b-initial-planning-workflow、R3e-command-check/-completion-platform、S8A-L8-pass-capture、S3-context-inputs、
  S4C2-goal-triggers、W1-future-plan、orchestration-mechanism、change-emitters）。
  AG2b 的 2 个 30s timeout 在干净 `e99b385` 树上同样失败（TF4a 已复核），不是本轮引入。
- Ledger `.dsh-ref/out/ledger.txt`：`# lines to justify (excluding MOVED): 66, plus 11 deleted files`；
  `# D3 hits: 0`；无 LOOSENED。映射：
  - 11 个删除的测试文件 → TF4（每个文件一行，见上）。
  - `MVP-ui-entry` 44 条 assertion + 7 个 test/describe → TF4（UI-only containment/scope display/directory inventory）。
  - `R6-host:201,210` → TF4（真 built page/静态资源/token 用例改写）。
  - `S2C-line-routes:122,124,126,128` → TF4（UI route-label/graph_write 行删除）。
  - `orchestration-mechanism:327,398` → TF4（workbench build 断言改为自己写页面）。
  - `production-reach.test.ts:247` → TF4（browser bundle/CLI entry 用例随 `build-workbench.mjs` 删除）。
  - `A2-reconcile-runtime:685`、`K3-26-unknown-call-review-storage:170,182` → TF1 `C1-108`/`C1-109`
    （`now`/`eventId` 改为必需；调用参数补上，断言本身未弱化）。
  - `control-intent-machine:906` → TF1 `A1-010`（删 `'malformed'` locator 行/类型）。
  - `S2C-K-archive-tags-checks:72` → TF5 未使用本地函数 `archiveLine`（死 helper 内的 expect）。
  - `A2-reconcile-runtime:304` 的 `90_000` → TF2 tw-03：新测试，与同文件相邻 restart 变体同样的 90s；
    不是抬高既有测试的 timeout，也不改断言。
  - 无未映射行。

## 6. 疑似任务书错误 / 需要 lead 知道的事

1. **NP 行的 `where` 目录过期**：NP-1/2/4/5 写的是 `src/core/work-graph/sessions/*` 或 `views/line-status.ts`，
   本副本实际是 `src/core/work-graph/tasks/session-facts.ts`、`src/business/workflow/session-maintenance.ts`、
   `src/core/work-graph/tasks/session-anomaly-service.ts`、`src/core/work-graph/state/line-status.ts`。已按实际文件处理。
2. **“graph-context-reader.ts 没有 TF1 行”不对**：它有一行 `C4-113`（`:1328`）。为避免与 TF3 同文件冲突，
   把该行交给 TF3 执行（结果 `simplified`），其余 views 组不碰该文件。
3. **`src/ui` 文件数**：任务书写 35 个测试/脚本引用 `src/ui`，实际 `grep -rln "src/ui" tests scripts` 是 34 个。
4. **“then add nothing” 与 allowlist**：§5 step 5 对 HTTP route/wire-format 说 “add nothing; report kept for E3”。
   但 `production-reach.test.ts` 要求每个 unreached 声明要么删除要么在 allowlist；48 个 HTTP DTO 只能以
   `wire-format` 条目保留。我的解读是“不加生产代码”，allowlist 的 wire-format 条目是该机制本身；已按此做，
   未改任何 route/DTO。若 lead 的原意是连 allowlist 也不加，需要另给存放机制。
5. **`tsconfig.json`/`tsconfig.build.json` 的 `src/ui` exclude**：任务书只列 package.json 两行；
   TF4 顺手删掉了这两个已无对象的 exclude（不改变行为）。已在上面列出。
6. **`package.json`**：确认只改 `build`/`typecheck` 两行；依赖与 lock 未动。

## 7. HANDOFF

**done**。五个组各自提交、检查全绿、ledger 映射完成；工作树干净。
留给 lead 在有 `/usr/bin/bwrap` 的环境重跑的是：TF2 的 `IN12` 红/绿证明，以及 close-out 列出的 30 个
bwrap 环境失败文件（它们不是本轮改动引入；AG2b 的 2 个 timeout 在 `e99b385` 上同样失败）。
没有未完成的组；没有未映射的 ledger 行；没有未解释的 `tf5-after.txt` 行。
