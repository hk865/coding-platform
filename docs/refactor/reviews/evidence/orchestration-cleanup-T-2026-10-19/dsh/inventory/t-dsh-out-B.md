# T 轮测试清单审查：B 区（tests/scenarios 场景测试与夹具）

范围：`./.dsh-ref/t-area-B.txt` 列出的 117 个文件、39,413 行（102 个场景测试 + 15 个 `support/` 夹具）。只读审查；未修改仓库，未跑测试/构建。依据：`.dsh-ref/t-common.md`、HANDOFF 决定 79（79-1/79-4）与 85-4、根 `AGENTS.md` 第 3/4/9 条。

## 发现

| 编号 | 类别 | 位置 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B-01 | 手写事实 | `tests/scenarios/A8-host-restart-attestation.test.ts:74-83, 120-123, 151-158`<br>RUN-22 (LA-8) / QRR-06 (LA-8) | 测试自己 createSqliteRecordBackend + createSqliteRawArtifactStore 开第二个连接，手写 incompleteDraft/completeDraft（review 草稿），并向 owner 传任意 kernelTurnOpen/inputsConfirmed。公开 route executions/resolve-unknown（src/app/core-routes.ts:443）存在，但它在 src/composition/create-platform.ts:2156 自己读 Kernel 事实，无法表达同一身份、另一份 Kernel 事实。 | `keep-note` | —（无公开步骤：route 会重读 Kernel，只有 owner 能收任意事实） | 0 | 否 | 中 |
| B-02 | 过时 | `tests/scenarios/A8-host-restart-paused.test.ts:66-76, 841-956（另 A7-control-goal29.test.ts:35-43,116-181；WP1-wiring.test.ts:36-45,81-126）`<br>A8-host-restart-paused / LA-1 and contract (e) (closing unsupported)；A7-control-goal29 / A7-G4 with history (closing unsupported)；WP1-wiring / SC01 (closing unsupported) | 三处都用 vi.mock 从 frozen vendor 导出里删掉 closeOpenTurn（A8:70-75、A7g29:38-42、WP1:40-44）。但 vendor/coding-agent/dist/public-api.d.ts:59 与 .js:50 固定导出它，src/composition/create-platform.ts:1229 固定注入 turnClosure；src/core/agent-runtime/ports.ts:96-99 说明只有未注入 turnClosure 才 unsupported，runtime.ts:426-427 的 Kernel 不发布分支只能来自旧依赖/旧 store。79-1：产品从未真实运行，不留旧接口兼容分支。同一 mock 还门控 A8-host-restart-paused.test.ts:394-515（A8-3n closing unsupported，archive 分支），宜一并裁定。 | `delete` | 行为已不存在：79-1（vendor 固定发布 closeOpenTurn，turnClosure 生产固定注入）；K L8 回退 | 227 | 是 | 中 |
| B-03 | 手写事实 | `tests/scenarios/A8-host-restart-paused.test.ts:198-204`<br>A8-3l / LA-1 and contract (e) (closing supported) 的 Step 4b 反向对照 | forceTurnOnKernelSession（support/restart.ts:268-291）直接拿场景的 kernel.sqlite 跑 frozen Kernel 的 runCodingAgent，制造在已退休 Session 上强开 Turn。产品侧没有公开步骤能产生该状态（所有 Turn 都经 Host 的 start/executions/start）。 | `keep-note` | —（无公开步骤） | 0 | 否 | 中 |
| B-04 | 重复 | `tests/scenarios/C6-unrelated-adoption.test.ts:163-207`<br>C6 / an unrelated adoption after the claim does not stop the claimed Run ↔ C6 main path（54-161） | 同一场景同一组结论：claim on P1→无关 adoption P2→claim 不变→start 完成（planRef 仍 P1）→round 在 P2 下开→satisfied→无 TaskRequeue→key 不变。并排：172-175 与 111-116（run/session/lease 不变）；185-186 与 130-131（adoptedPlanRef=p2.ref）；190 与 148；192 与 142-143；199 与 156-157；203 与 145-147。差别只有 adoption 走 plans/apply 而非 Agent 的 W2 工具。 | `merge-into:tests/scenarios/C6-unrelated-adoption.test.ts::C6 main path` | tests/scenarios/C6-unrelated-adoption.test.ts::C6 main path | 45 | 是 | 中高 |
| B-05 | 重复 | `tests/scenarios/K3-06-mixed-batch.test.ts:174-240`<br>K3-06 (process, L9/L10-L16): one in-flight shell call, its own Run, is reviewed, settled and read back / K3-05 | 同一真实审阅轮链路与同一组断言：claim basis `review`（K3-06:197 / K3-05:148-150）、receipts `claim_task,prepare`（200 / 146）、轮次 `ended/completed`（203-205 / 168-170）、结论 `done/unlikely` 回读（207-209 / 172-180）、`settle_review` 且无 `open_checks`（216-225 / 183-190）、记录 `resolved`（222-225 / 192-196）、原 Run crashed 且租约由轮次释放（227-229 / 196-199）。K3-06 的 process 一例是 ruling 2 要求的三类对照之一，本身无新断言。 | `keep-note` | tests/scenarios/K3-05-review-round.test.ts:86-199 | 0 | 是 | 高 |
| B-06 | 辅助 | `tests/scenarios/K3-09-restart-between-calls.test.ts:108-135`<br>local crashShellRun helpers repeated across the K3 scenario files | 同一 “armed shell + 起 Run + waitForCall + crash + 收尾” 构造在 14 个文件各写一份：K3-10:122、K3-11:120、K3-13:83、K3-17:86、K3-18:113、K3-19-missing:114、K3-19-review-unavailable:102、K3-29-disposition:79、K3-29-maintenance:95、K3-29-recovery-continuation:100、K3-29-recovery-round:159、K3-37:120、K3-44-hold:80、K3-44-recovery:80、K3-45:130；而 `tests/scenarios/support/review-card-round.ts:143-163` 已有共享的 `crashOneCommand`。 | `merge-into:tests/scenarios/support/review-card-round.ts::crashOneCommand` | tests/scenarios/support/review-card-round.ts:143-163 (existing shared helper) | 200 | 否 | 高 |
| B-07 | 辅助 | `tests/scenarios/K3-16-proposal-round.test.ts:110-145`<br>inline proposal-round setup repeated in three files | 同一 “answer `safer_method` → `driveReviewUntil(..., performs('start'))` → 断言 L13 工具集 → startRun” 的提案轮准备写在 K3-16-proposal:110-145、K3-16-approval:112-150、K3-29-startup-variants:202-230 三处（工具集断言 129/131/218 行相同）；`support/review-card-round.ts` 已有 `needsDecisionCard`/`answerCard`，缺一个 `proposalRound` 构造。 | `merge-into:tests/scenarios/support/review-card-round.ts::proposalRound` | three inline copies; no shared helper exists | 80 | 否 | 中 |
| B-08 | 重复 | `tests/scenarios/K3-19-missing-read-no-round.test.ts:181-241`<br>K3-19 A1: a Host binding with run_readonly_command but no read answers reviewCapability unavailable / K3-19 (一): with the read-only command unusable the Workflow opens no round ... settles review_unavailable | 同一 K3-19 (一) 场景、同一组断言：不 claim/prepare/start（missing-read 208-210 / unavailable 142-144）、`settle_review{cause: review_unavailable}`（214 / 148）、`modelCalls()===0`（216/222 / 150/154）、`needs_decision` + item `undetermined`（229-232 / 159-163）、四选项卡（236-240 / 170-178）。缺 `read` 导致 capability 不可用已由 tests/app/K3-19-review-capability-host.test.ts:145 钉住（missing-read 文件头第 5 行自述）。 | `merge-into:tests/scenarios/K3-19-review-unavailable.test.ts::K3-19 (一): with the read-only command unusable the Workflow opens no round (zero model calls) and settles the pending_review record review_unavailable with every item undetermined` | tests/scenarios/K3-19-review-unavailable.test.ts:125-181 + tests/app/K3-19-review-capability-host.test.ts:145 | 180 | 是 | 高 |
| B-09 | 辅助 | `tests/scenarios/K3-29-disposition-recovery.test.ts:109-166`<br>local openMissingReadReviewRoot / createNeedsDecisionRecord helpers | `openMissingReadReviewRoot` 在 `K3-17-review-answer-shape.test.ts:108`、`K3-19-missing-read-no-round.test.ts:141`、`K3-29-disposition-recovery.test.ts:109`、`K3-44-recovery-answers.test.ts:110` 各写一份（约 35–55 行，仅 binding id/文案不同）；其上 `createNeedsDecisionRecord` 在 K3-29-disposition:143 与 K3-44-recovery:143 完全相同（crash → missing-read root → `settle_review` → needs_decision）。 | `merge-into:tests/scenarios/support/review-work-root.ts::openMissingReadReviewRoot` | four inline copies; no shared helper exists | 170 | 否 | 高 |
| B-10 | 重复 | `tests/scenarios/K3-29-startup-variants.test.ts:125-170`<br>K3-29 variant (b): a failed ③ leaves the held record equal; the redrive-on restart hands the answer over (kind 4) and records it / K3-44 (一) | 同一 “② 已提交、③ 失败 → 重启 6b (c) kind 4 按 `reviewRef` 交回 → UR7b 只补 ③” 骨架：注入 `SessionMessageDecisionApplied` 失败（variants:130 / K3-44:178），重启 `redriveGoals` 带 `answers[{kind:'unknown_call_review', reviewRef, answerMessageRef}]`（152-155 / 242-244），UR7b 写 application（159-161 / 245-250），记录逐字节不变且无 `TaskRequeued`（163-165 / 253-255）。但 hold 来源不同：本行是卡片答复 `handle_myself`（source card、answerMessageRef 非空），K3-44 (一) 是 direct hold（answerMessageRef null），走的是答案索引的另一分支，建议保留。 | `keep-note` | tests/scenarios/K3-44-recovery-answers.test.ts:219-263 + tests/scenarios/K3-29-startup-answers.test.ts:148-198 (kind 4 owner level) | 0 | 是 | 中 |
| B-11 | 重复 | `tests/scenarios/K3-37-stopped-review-round.test.ts:231-297`<br>K3-37 (二): a paused review round ended by the Host crash (RUN-24) settles needs_decision with review_stopped and opens no second round / K3-29 row 4b | 同一 “操作员暂停运行中的审阅轮 → crash RUN-24 → `settle_review` 记 `review_stopped`、不开第二轮”：pause（K3-37:243-247 / K3-29:703-704）、RUN-24 `interrupted_clean`+`pausedIntentRef`（269-275 / 718-723）、`needs_decision`+`activeRound:null`+`rounds[0].result='stopped'`（282-290 / 731-737），K3-29 4b 还断言无 `claim_task`（732）。K3-29 4b 另测 hold/release/接续，断言更全。 | `merge-into:tests/scenarios/K3-29-recovery-round.test.ts::K3-29 row 4b: a paused running round ends RUN-24, its fence is human_only, and settle_review finalizes review_stopped without a new round` | tests/scenarios/K3-29-recovery-round.test.ts:694-784 | 67 | 是 | 高 |
| B-12 | 重复 | `tests/scenarios/K3-37-stopped-review-round.test.ts:298-383`<br>K3-37 (三): a Goal-pause interrupted review round is recorded unfinished; only after the Goal resumes does a second round open / K3-45 (一) R2 round 1 | 同一 “Goal fan-out 暂停一轮 → crash → RUN-24 → settle unfinished → resume 后开第二轮” 链路：`goalControl pause`（K3-37:309 / K3-45:178）、RUN-24 `pausedIntentRef`（337-343 / 210-214）、`pending_review`+`rounds[0]={result:'unfinished',round:1,stateEntry:1}`（353-357 / 221-226）、resume 后第二轮 claim（369-383 / 233-260）。K3-45 文件头第 8 行自述 “using the K3-37 (三) pattern”；K3-45 还继续到 `review_incomplete`，应留它。 | `merge-into:tests/scenarios/K3-45-review-incomplete-r2.test.ts::K3-45 (一) R2: two rounds that each wrote every conclusion then were interrupted with no call in flight settle needs_decision with exactly review_incomplete` | tests/scenarios/K3-45-review-incomplete-r2.test.ts:153-285 (round 1 covers it fully) | 86 | 是 | 高 |
| B-13 | 手写事实 | `tests/scenarios/K3-r1-seams.test.ts:136-160`<br>K3 §5.2 crash point recipes: locks at ModelRequestEvidenceRecorded (K3-02) and at SessionMessageSent (K3-01) | `appendEvent`（137-143）新建只有 `events(id,event_json)` 的 `ledger.sqlite` 并插入 `{"eventType": …}` 裸 JSON，再断言 `lockLedgerAfter` 在这两条手写行上上锁（145-160）。这不是真实边界（不是 Kernel store、不是 route、不是模型输出），只是夹具自检；同一接缝在 162-182 的真实 K3-02 流以及 `K3-R1-restart-flows.test.ts:210-238` 已被真实使用。 | `delete` | tests/scenarios/K3-R1-restart-flows.test.ts:210-238 (real K3-02); same file 162-182 | 16 | 否 | 高 |
| B-14 | 重复 | `tests/scenarios/K3-r1-seams.test.ts:162-182`<br>K3-02 real flow: the evidence lock leaves the send model call but no message commit / K3-02 (tests/scenarios/K3-R1-restart-flows.test.ts:210) | 同一 crash point（`lockLedgerAfter('ModelRequestEvidenceRecorded')`）的真实流：模型调用发生、`SessionMessageSent` 未提交。seam 版断言 ledger 事件与无 `SessionMessage` 快照（177-181）；业务版用公开 outbox 为空（211-215）与 item `not_done`/“没做”（222-231）断言同一事实，并继续走 settle/接续。seam 版是 R1 前的探针，已被业务测试吸收。 | `delete` | tests/scenarios/K3-R1-restart-flows.test.ts:210-238 | 21 | 否 | 中 |
| B-15 | 琐碎 | `tests/scenarios/K3-store-wrapper-seam.test.ts:26-51`<br>K3 seam (a)/(b)/(c): normal public write commits; failNextLookupCommitOnce fails exactly the next lookupCommit; the boolean option arms the same one-shot | 整文件是测试夹具自检，不钉产品行为：(a) 28-29 断言普通 `goals/create` 提交，已由 `S3-query-graph.test.ts:283` 的 `committed('goals/create', …)` 覆盖；(b)/(c) 32-51 断言一次性 `lookupCommit` 失败及其重试，`K3-R1-restart-flows.test.ts:239-259`（K3-03）只有在该注入真的生效时才能得到 `lookup_failed`/`undetermined`。协调者核对：K3-03 只证明注入会生效，“一次性只失败一次、随后重试提交”的语义只有本文件断言，建议 keep-note。 | `keep-note` | tests/scenarios/S3-query-graph.test.ts:283; tests/scenarios/K3-R1-restart-flows.test.ts:239-259 | 0 | 否 | 中 |
| B-16 | 过时 | `tests/scenarios/S2C-K-legacy-provenance.test.ts:1-514`<br>2C-26 before maintenance / 2C-26 after one maintenance pass / 2C-26 the executions section stays indexed（:437、:462、:482） | 整文件只在造旧数据：:18-19 自述 seed 在存储边界；:100-410 用 commitRaw/encodeSessionRecord/encodeQueryRunSnapshotRecord 写来历为 null 的旧 Session 和没有 executionState 的旧 QueryRun。规格 slice-2C-SPEC.md:1279 与 :1405 明说这种记录今天的写者造不出、只能由存储边界兼容夹具造；来历补写只服务它（src/business/workflow/session-maintenance.ts:381）。决定 79-1：代码只读当前格式、不留旧版本解码分支、旧夹具可删。它是规格行 2C-26，只因 79-1 让该行为不再存在才建议删，请 lead 定。 | `delete` | 行为已不存在：决定 79-1；规格 slice-2C-SPEC.md:1279、:1405 | 514 | 是 | 中 |
| B-17 | 重复 | `tests/scenarios/S2C-K-retired.test.ts:242-295`<br>2C-21 (2) a missing Kernel leaves the line retired with an unreadable history（:297 的 missing 实例；对照 tests/scenarios/S2C-K-unknown-outcome.test.ts:105-150 的 2C-22 (2)） | 同一业务场景与几乎逐条相同的断言：retired 读法（retired:252-255 / unknown:88-92）、认证后 kernel_turn_open（retired:270-271 / unknown:122）、pass 1 后 conclusion（retired:277-278 / unknown:133）、归档后 tag/own/reactivate/session 卡（retired:284-293 / unknown:140-149）。2C-21 (2) 多出 history not_readable（retired:260-263），留它。 | `keep-note` | tests/scenarios/S2C-K-retired.test.ts::2C-21 (2) a missing Kernel leaves the line retired with an unreadable history | 30 | 是 | 中 |
| B-18 | 重复 | `tests/scenarios/S2C-K2-continue.test.ts:35-68`<br>2C-39 (1) a RUN-24 line gives one continue pinned to its Task and afterRun, and the submission is accepted（对照 tests/scenarios/S2C-K-paused-run24.test.ts:39-99 的 2C-23 (1)） | 同一 RUN-24 造法（reply 1 暂停 + crash 重启）与同一读法：paused/paused_interrupted（continue:51-52 / run24:60-61）、唯一 continue（continue:55-59 / run24:65-66）、tasks/requeue 提交并 requeued（continue:65-67 / run24:87-89）。2C-23 (1) 还断言维护不归档与同一 Session 续跑（run24:71-96），是业务流程那条。 | `keep-note` | tests/scenarios/S2C-K-paused-run24.test.ts::2C-23 (1) a human-paused Run interrupted by the restart… | 15 | 是 | 中 |
| B-19 | 重复 | `tests/scenarios/S2C-K2-controls.test.ts:45-73`<br>2C-34 (1) an outcome-unknown Work line lists attest_unknown…（对照 tests/scenarios/S2C-K-unknown-outcome.test.ts:83-151 的 2C-22 (1)(2)） | 同一造法（移走 Kernel + crash 重启）与同一读法：own retired、attention unknown（controls:63-64 / unknown:88-91），再 executions/resolve-unknown 提交并 committed（controls:69-71 / unknown:113-116）。2C-34 独有的是控件与 route 的投影（controls:66-67）；认证后的归档尾巴在 2C-22 (2)。 | `keep-note` | tests/scenarios/S2C-K-unknown-outcome.test.ts::2C-22 (1) / 2C-22 (2) | 15 | 是 | 中 |
| B-20 | 手写事实 | `tests/scenarios/S3-context-and-inputs.test.ts:197-204、310`<br>SC01 的 §5.1 夹具（同文副本 tests/scenarios/S3-query-graph.test.ts:205-214、317） | seedCompletedRun 绕过记录存储，直接开 ledger.sqlite 执行 INSERT INTO snapshots 造已完成 Run；:190-196 注释承认直接写 RunSnapshot。公开步骤存在：Workflow 的 claim/prepare/start 真跑 tA 会写出同一已完成 Run（runId 由产品生成）。 | `convert:走 Workflow claim/prepare/start 跑完 tA，用真实返回的 RunRef 替换常量 RUN_A` | —（convert 后由同一条业务流程覆盖） | 25 | 否 | 中 |
| B-21 | 辅助 | `tests/scenarios/S3-query-graph.test.ts:71-353`<br>调用方 S3-query-graph SC02 与 S3-context-and-inputs SC01 | 两个文件的夹具块（71-353）diff 只有 46 行差异：S3Host 类型、workspaceBindings、s3Checks、s3Runtime、s3Ctx、runACtx、seedCompletedRun、runASnapshot、planDraft、seedS3Graph、openS3Host，各约 280 行，却只服务各一个用例。建议抽到 tests/scenarios/support/ 后删其中一份。 | `delete` | tests/scenarios/S3-context-and-inputs.test.ts:71-353 同文夹具 | 270 | 否 | 高 |
| B-22 | 重复 | `tests/scenarios/S4C2-U6-note-card-e2e.test.ts:85-106、113-129`<br>D-01 %s supersede accepts v2… / D-01 %s coexist accepts v2…（对照 tests/work-graph/S4C2-D17.test.ts:51-88） | 同一 acceptance 夹具、同一协调器、同一效果断言：action {status:'done',version:2,state:'accepted'}、application committed、目标 superseded/accepted、cardOf 变 null（U6:97-112 / D17:60-73；U6:115-129 / D17:75-87）。U6 独有卡形状/三选项/历史不可变（:74-86、:118-124）与文案/重放/指针（:139-244）。 | `keep-note` | tests/work-graph/S4C2-D17.test.ts::D-17 %s supersede / coexist | 30 | 是 | 中 |
| B-23 | 重复 | `tests/scenarios/WP1-wiring.test.ts:47-79`<br>WP1-wiring / SC01 (closing supported) ↔ A8-host-restart-paused / LA-1 and contract (e) (closing supported; 723-839) | 同一业务场景：人工 pause→Host 重启→继续→close_open_turn→原 Session 新 Run→satisfied。并排：WP1:58 lineKinds 与 A8:791/819 相同；WP1:60 closed/available 与 A8:791-792；WP1:65 satisfied 与 A8:815；WP1:69-70 新 Run+同 Session 与 A8:795/819；WP1:73 active+available 与 A8:803。WP1 独有 anomaly 公共读（77）与 archive label（78），可并入 A8。 | `merge-into:tests/scenarios/A8-host-restart-paused.test.ts::LA-1 and contract (e) (closing supported; KA-07, KA-09, A8-3l step 5, A8-3r)` | tests/scenarios/A8-host-restart-paused.test.ts::LA-1 and contract (e) (closing supported; KA-07, KA-09, A8-3l step 5, A8-3r) | 33 | 是 | 中 |
| B-24 | 琐碎 | `tests/scenarios/harness.test.ts:191-212`<br>platform mode seams: a registered check is a new configuration revision; cap 0 stops the automatic rework | 用例断言大半被业务流程测试做掉：registerCheck 是新修订并冻结在轮次（harness.test.ts:200）↔ C5-reverify-guards.test.ts:81,107,123；cap 0 → stopped/auto_rework_cap_reached、0 写（203-211）↔ C8-auto-rework-cap.test.ts:62-80、A11-no-progress.test.ts:120-190。但 registerCheck 的 configurationRevision 断言与 setAutomation/automationPolicy 接缝只见于本用例，删除会丢接缝覆盖，建议 keep-note。 | `keep-note` | tests/scenarios/C8-auto-rework-cap.test.ts::C8 (§13.4 #15, AV-8, GOAL-30) + tests/scenarios/C5-reverify-guards.test.ts::(a)/(b) §13.7 / LA-4 | 0 | 否 | 低 |
| B-25 | 辅助 | `tests/scenarios/harness.ts:86, 717-720`<br>assertInvariantsAt（legacyFindings 拼接） | legacyFindings 只收集 tests/state/invariants.ts:2272 的 legacy 分类（旧数据、以前规则）；来源见同文件 :953 written before R3e.3、:1063 pre-D-8 data、:1156 before VD-4、:1275 V1 Run、:1504 legacy @0。79-1 之后没有真实旧库；若 tests/state 的 legacy 分类按 79-1 去掉，这里的 import 与拼接一并去掉。 | `keep-note` | —（依赖 tests/state 的裁定） | 2 | 否 | 中 |
| B-26 | 辅助 | `tests/scenarios/harness.ts:626-632`<br>ScenarioBase.kernelRecords() | 全仓 grep -rn "kernelRecords()" 只命中定义 tests/scenarios/harness.ts:627；计数一律走 fileCounts/counts()（harness.ts:385-405、654）。字段名 kernelRecords 的使用不算调用。 | `delete` | —（无测试使用） | 7 | 否 | 高 |
| B-27 | 辅助 | `tests/scenarios/harness.ts:1283-1287`<br>PlatformScenario.setTokenBudget() | 全仓 grep -rn setTokenBudget 只命中定义 tests/scenarios/harness.ts:1284；C8-budget 用自己的 openBudgetEnvironment 并在 C8-budget.test.ts:79-80 直接 registerWorkflowBinding，不经过此方法。 | `delete` | —（无测试使用） | 5 | 否 | 高 |
| B-28 | 辅助 | `tests/scenarios/support/S5-decisions.ts:384-394`<br>无调用方（两个 S5 场景与 tests/app/S5-decision-routes.test.ts 都不 import） | 全 tests/、src/、scripts/ 搜 \babandonCandidate\b 只命中定义本身；文件内也只此 1 处，没有任何测试走 abandonPlanProposal 的这个包装。 | `delete` | —（无测试使用） | 11 | 否 | 高 |
| B-29 | 手写事实 | `tests/scenarios/support/S5-decisions.ts:527-638`<br>调用方 tests/scenarios/S5-goal-conflict-rework.test.ts:113（SC02 的 Agent requeue） | 手写整条 Agent 准入：手拼 PreparedTaskManifestV1 JSON（:571-577）、bodies.put 放 manifest（:578-583）、手搭 PreparedTaskExecution（:584-590）、直接调 authorizeRuntimeEntry/beginRuntimeEntry/recordExecutionEntered/recordRunResult（:600-632），finally 补 run_completed。:520-526 注释承认不是模型驱动。公开步骤存在：requeue_task 是正式 Workflow perform，见 tests/scenarios/A4-duplicate-receipts.test.ts:167、tests/scenarios/K3-16-approval-round.test.ts:140。 | `convert:Workflow advanceWork 到 requeue_task perform（脚本化 Agent 工具调用）` | —（convert 后由同一条业务流程覆盖） | 112 | 否 | 中 |

## JSON

```json
[
  {
    "id": "B-01",
    "category": "handwritten",
    "file": "tests/scenarios/A8-host-restart-attestation.test.ts",
    "lines": "74-83, 120-123, 151-158",
    "tests": "RUN-22 (LA-8) / QRR-06 (LA-8)",
    "evidence": "测试自己 createSqliteRecordBackend + createSqliteRawArtifactStore 开第二个连接，手写 incompleteDraft/completeDraft（review 草稿），并向 owner 传任意 kernelTurnOpen/inputsConfirmed。公开 route executions/resolve-unknown（src/app/core-routes.ts:443）存在，但它在 src/composition/create-platform.ts:2156 自己读 Kernel 事实，无法表达同一身份、另一份 Kernel 事实。",
    "action": "keep-note",
    "covered_by": "—（无公开步骤：route 会重读 Kernel，只有 owner 能收任意事实）",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "B-02",
    "category": "stale",
    "file": "tests/scenarios/A8-host-restart-paused.test.ts",
    "lines": "66-76, 841-956（另 A7-control-goal29.test.ts:35-43,116-181；WP1-wiring.test.ts:36-45,81-126）",
    "tests": "A8-host-restart-paused / LA-1 and contract (e) (closing unsupported)；A7-control-goal29 / A7-G4 with history (closing unsupported)；WP1-wiring / SC01 (closing unsupported)",
    "evidence": "三处都用 vi.mock 从 frozen vendor 导出里删掉 closeOpenTurn（A8:70-75、A7g29:38-42、WP1:40-44）。但 vendor/coding-agent/dist/public-api.d.ts:59 与 .js:50 固定导出它，src/composition/create-platform.ts:1229 固定注入 turnClosure；src/core/agent-runtime/ports.ts:96-99 说明只有未注入 turnClosure 才 unsupported，runtime.ts:426-427 的 Kernel 不发布分支只能来自旧依赖/旧 store。79-1：产品从未真实运行，不留旧接口兼容分支。同一 mock 还门控 A8-host-restart-paused.test.ts:394-515（A8-3n closing unsupported，archive 分支），宜一并裁定。",
    "action": "delete",
    "covered_by": "行为已不存在：79-1（vendor 固定发布 closeOpenTurn，turnClosure 生产固定注入）；K L8 回退",
    "est_lines": 227,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-03",
    "category": "handwritten",
    "file": "tests/scenarios/A8-host-restart-paused.test.ts",
    "lines": "198-204",
    "tests": "A8-3l / LA-1 and contract (e) (closing supported) 的 Step 4b 反向对照",
    "evidence": "forceTurnOnKernelSession（support/restart.ts:268-291）直接拿场景的 kernel.sqlite 跑 frozen Kernel 的 runCodingAgent，制造在已退休 Session 上强开 Turn。产品侧没有公开步骤能产生该状态（所有 Turn 都经 Host 的 start/executions/start）。",
    "action": "keep-note",
    "covered_by": "—（无公开步骤）",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "B-04",
    "category": "duplicate",
    "file": "tests/scenarios/C6-unrelated-adoption.test.ts",
    "lines": "163-207",
    "tests": "C6 / an unrelated adoption after the claim does not stop the claimed Run ↔ C6 main path（54-161）",
    "evidence": "同一场景同一组结论：claim on P1→无关 adoption P2→claim 不变→start 完成（planRef 仍 P1）→round 在 P2 下开→satisfied→无 TaskRequeue→key 不变。并排：172-175 与 111-116（run/session/lease 不变）；185-186 与 130-131（adoptedPlanRef=p2.ref）；190 与 148；192 与 142-143；199 与 156-157；203 与 145-147。差别只有 adoption 走 plans/apply 而非 Agent 的 W2 工具。",
    "action": "merge-into:tests/scenarios/C6-unrelated-adoption.test.ts::C6 main path",
    "covered_by": "tests/scenarios/C6-unrelated-adoption.test.ts::C6 main path",
    "est_lines": 45,
    "spec_row": true,
    "confidence": "中高"
  },
  {
    "id": "B-05",
    "category": "duplicate",
    "file": "tests/scenarios/K3-06-mixed-batch.test.ts",
    "lines": "174-240",
    "tests": "K3-06 (process, L9/L10-L16): one in-flight shell call, its own Run, is reviewed, settled and read back / K3-05",
    "evidence": "同一真实审阅轮链路与同一组断言：claim basis `review`（K3-06:197 / K3-05:148-150）、receipts `claim_task,prepare`（200 / 146）、轮次 `ended/completed`（203-205 / 168-170）、结论 `done/unlikely` 回读（207-209 / 172-180）、`settle_review` 且无 `open_checks`（216-225 / 183-190）、记录 `resolved`（222-225 / 192-196）、原 Run crashed 且租约由轮次释放（227-229 / 196-199）。K3-06 的 process 一例是 ruling 2 要求的三类对照之一，本身无新断言。",
    "action": "keep-note",
    "covered_by": "tests/scenarios/K3-05-review-round.test.ts:86-199",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-06",
    "category": "helper",
    "file": "tests/scenarios/K3-09-restart-between-calls.test.ts",
    "lines": "108-135",
    "tests": "local crashShellRun helpers repeated across the K3 scenario files",
    "evidence": "同一 “armed shell + 起 Run + waitForCall + crash + 收尾” 构造在 14 个文件各写一份：K3-10:122、K3-11:120、K3-13:83、K3-17:86、K3-18:113、K3-19-missing:114、K3-19-review-unavailable:102、K3-29-disposition:79、K3-29-maintenance:95、K3-29-recovery-continuation:100、K3-29-recovery-round:159、K3-37:120、K3-44-hold:80、K3-44-recovery:80、K3-45:130；而 `tests/scenarios/support/review-card-round.ts:143-163` 已有共享的 `crashOneCommand`。",
    "action": "merge-into:tests/scenarios/support/review-card-round.ts::crashOneCommand",
    "covered_by": "tests/scenarios/support/review-card-round.ts:143-163 (existing shared helper)",
    "est_lines": 200,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-07",
    "category": "helper",
    "file": "tests/scenarios/K3-16-proposal-round.test.ts",
    "lines": "110-145",
    "tests": "inline proposal-round setup repeated in three files",
    "evidence": "同一 “answer `safer_method` → `driveReviewUntil(..., performs('start'))` → 断言 L13 工具集 → startRun” 的提案轮准备写在 K3-16-proposal:110-145、K3-16-approval:112-150、K3-29-startup-variants:202-230 三处（工具集断言 129/131/218 行相同）；`support/review-card-round.ts` 已有 `needsDecisionCard`/`answerCard`，缺一个 `proposalRound` 构造。",
    "action": "merge-into:tests/scenarios/support/review-card-round.ts::proposalRound",
    "covered_by": "three inline copies; no shared helper exists",
    "est_lines": 80,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "B-08",
    "category": "duplicate",
    "file": "tests/scenarios/K3-19-missing-read-no-round.test.ts",
    "lines": "181-241",
    "tests": "K3-19 A1: a Host binding with run_readonly_command but no read answers reviewCapability unavailable / K3-19 (一): with the read-only command unusable the Workflow opens no round ... settles review_unavailable",
    "evidence": "同一 K3-19 (一) 场景、同一组断言：不 claim/prepare/start（missing-read 208-210 / unavailable 142-144）、`settle_review{cause: review_unavailable}`（214 / 148）、`modelCalls()===0`（216/222 / 150/154）、`needs_decision` + item `undetermined`（229-232 / 159-163）、四选项卡（236-240 / 170-178）。缺 `read` 导致 capability 不可用已由 tests/app/K3-19-review-capability-host.test.ts:145 钉住（missing-read 文件头第 5 行自述）。",
    "action": "merge-into:tests/scenarios/K3-19-review-unavailable.test.ts::K3-19 (一): with the read-only command unusable the Workflow opens no round (zero model calls) and settles the pending_review record review_unavailable with every item undetermined",
    "covered_by": "tests/scenarios/K3-19-review-unavailable.test.ts:125-181 + tests/app/K3-19-review-capability-host.test.ts:145",
    "est_lines": 180,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-09",
    "category": "helper",
    "file": "tests/scenarios/K3-29-disposition-recovery.test.ts",
    "lines": "109-166",
    "tests": "local openMissingReadReviewRoot / createNeedsDecisionRecord helpers",
    "evidence": "`openMissingReadReviewRoot` 在 `K3-17-review-answer-shape.test.ts:108`、`K3-19-missing-read-no-round.test.ts:141`、`K3-29-disposition-recovery.test.ts:109`、`K3-44-recovery-answers.test.ts:110` 各写一份（约 35–55 行，仅 binding id/文案不同）；其上 `createNeedsDecisionRecord` 在 K3-29-disposition:143 与 K3-44-recovery:143 完全相同（crash → missing-read root → `settle_review` → needs_decision）。",
    "action": "merge-into:tests/scenarios/support/review-work-root.ts::openMissingReadReviewRoot",
    "covered_by": "four inline copies; no shared helper exists",
    "est_lines": 170,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-10",
    "category": "duplicate",
    "file": "tests/scenarios/K3-29-startup-variants.test.ts",
    "lines": "125-170",
    "tests": "K3-29 variant (b): a failed ③ leaves the held record equal; the redrive-on restart hands the answer over (kind 4) and records it / K3-44 (一)",
    "evidence": "同一 “② 已提交、③ 失败 → 重启 6b (c) kind 4 按 `reviewRef` 交回 → UR7b 只补 ③” 骨架：注入 `SessionMessageDecisionApplied` 失败（variants:130 / K3-44:178），重启 `redriveGoals` 带 `answers[{kind:'unknown_call_review', reviewRef, answerMessageRef}]`（152-155 / 242-244），UR7b 写 application（159-161 / 245-250），记录逐字节不变且无 `TaskRequeued`（163-165 / 253-255）。但 hold 来源不同：本行是卡片答复 `handle_myself`（source card、answerMessageRef 非空），K3-44 (一) 是 direct hold（answerMessageRef null），走的是答案索引的另一分支，建议保留。",
    "action": "keep-note",
    "covered_by": "tests/scenarios/K3-44-recovery-answers.test.ts:219-263 + tests/scenarios/K3-29-startup-answers.test.ts:148-198 (kind 4 owner level)",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-11",
    "category": "duplicate",
    "file": "tests/scenarios/K3-37-stopped-review-round.test.ts",
    "lines": "231-297",
    "tests": "K3-37 (二): a paused review round ended by the Host crash (RUN-24) settles needs_decision with review_stopped and opens no second round / K3-29 row 4b",
    "evidence": "同一 “操作员暂停运行中的审阅轮 → crash RUN-24 → `settle_review` 记 `review_stopped`、不开第二轮”：pause（K3-37:243-247 / K3-29:703-704）、RUN-24 `interrupted_clean`+`pausedIntentRef`（269-275 / 718-723）、`needs_decision`+`activeRound:null`+`rounds[0].result='stopped'`（282-290 / 731-737），K3-29 4b 还断言无 `claim_task`（732）。K3-29 4b 另测 hold/release/接续，断言更全。",
    "action": "merge-into:tests/scenarios/K3-29-recovery-round.test.ts::K3-29 row 4b: a paused running round ends RUN-24, its fence is human_only, and settle_review finalizes review_stopped without a new round",
    "covered_by": "tests/scenarios/K3-29-recovery-round.test.ts:694-784",
    "est_lines": 67,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-12",
    "category": "duplicate",
    "file": "tests/scenarios/K3-37-stopped-review-round.test.ts",
    "lines": "298-383",
    "tests": "K3-37 (三): a Goal-pause interrupted review round is recorded unfinished; only after the Goal resumes does a second round open / K3-45 (一) R2 round 1",
    "evidence": "同一 “Goal fan-out 暂停一轮 → crash → RUN-24 → settle unfinished → resume 后开第二轮” 链路：`goalControl pause`（K3-37:309 / K3-45:178）、RUN-24 `pausedIntentRef`（337-343 / 210-214）、`pending_review`+`rounds[0]={result:'unfinished',round:1,stateEntry:1}`（353-357 / 221-226）、resume 后第二轮 claim（369-383 / 233-260）。K3-45 文件头第 8 行自述 “using the K3-37 (三) pattern”；K3-45 还继续到 `review_incomplete`，应留它。",
    "action": "merge-into:tests/scenarios/K3-45-review-incomplete-r2.test.ts::K3-45 (一) R2: two rounds that each wrote every conclusion then were interrupted with no call in flight settle needs_decision with exactly review_incomplete",
    "covered_by": "tests/scenarios/K3-45-review-incomplete-r2.test.ts:153-285 (round 1 covers it fully)",
    "est_lines": 86,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-13",
    "category": "handwritten",
    "file": "tests/scenarios/K3-r1-seams.test.ts",
    "lines": "136-160",
    "tests": "K3 §5.2 crash point recipes: locks at ModelRequestEvidenceRecorded (K3-02) and at SessionMessageSent (K3-01)",
    "evidence": "`appendEvent`（137-143）新建只有 `events(id,event_json)` 的 `ledger.sqlite` 并插入 `{\"eventType\": …}` 裸 JSON，再断言 `lockLedgerAfter` 在这两条手写行上上锁（145-160）。这不是真实边界（不是 Kernel store、不是 route、不是模型输出），只是夹具自检；同一接缝在 162-182 的真实 K3-02 流以及 `K3-R1-restart-flows.test.ts:210-238` 已被真实使用。",
    "action": "delete",
    "covered_by": "tests/scenarios/K3-R1-restart-flows.test.ts:210-238 (real K3-02); same file 162-182",
    "est_lines": 16,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-14",
    "category": "duplicate",
    "file": "tests/scenarios/K3-r1-seams.test.ts",
    "lines": "162-182",
    "tests": "K3-02 real flow: the evidence lock leaves the send model call but no message commit / K3-02 (tests/scenarios/K3-R1-restart-flows.test.ts:210)",
    "evidence": "同一 crash point（`lockLedgerAfter('ModelRequestEvidenceRecorded')`）的真实流：模型调用发生、`SessionMessageSent` 未提交。seam 版断言 ledger 事件与无 `SessionMessage` 快照（177-181）；业务版用公开 outbox 为空（211-215）与 item `not_done`/“没做”（222-231）断言同一事实，并继续走 settle/接续。seam 版是 R1 前的探针，已被业务测试吸收。",
    "action": "delete",
    "covered_by": "tests/scenarios/K3-R1-restart-flows.test.ts:210-238",
    "est_lines": 21,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "B-15",
    "category": "trivial",
    "file": "tests/scenarios/K3-store-wrapper-seam.test.ts",
    "lines": "26-51",
    "tests": "K3 seam (a)/(b)/(c): normal public write commits; failNextLookupCommitOnce fails exactly the next lookupCommit; the boolean option arms the same one-shot",
    "evidence": "整文件是测试夹具自检，不钉产品行为：(a) 28-29 断言普通 `goals/create` 提交，已由 `S3-query-graph.test.ts:283` 的 `committed('goals/create', …)` 覆盖；(b)/(c) 32-51 断言一次性 `lookupCommit` 失败及其重试，`K3-R1-restart-flows.test.ts:239-259`（K3-03）只有在该注入真的生效时才能得到 `lookup_failed`/`undetermined`。协调者核对：K3-03 只证明注入会生效，“一次性只失败一次、随后重试提交”的语义只有本文件断言，建议 keep-note。",
    "action": "keep-note",
    "covered_by": "tests/scenarios/S3-query-graph.test.ts:283; tests/scenarios/K3-R1-restart-flows.test.ts:239-259",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "B-16",
    "category": "stale",
    "file": "tests/scenarios/S2C-K-legacy-provenance.test.ts",
    "lines": "1-514",
    "tests": "2C-26 before maintenance / 2C-26 after one maintenance pass / 2C-26 the executions section stays indexed（:437、:462、:482）",
    "evidence": "整文件只在造旧数据：:18-19 自述 seed 在存储边界；:100-410 用 commitRaw/encodeSessionRecord/encodeQueryRunSnapshotRecord 写来历为 null 的旧 Session 和没有 executionState 的旧 QueryRun。规格 slice-2C-SPEC.md:1279 与 :1405 明说这种记录今天的写者造不出、只能由存储边界兼容夹具造；来历补写只服务它（src/business/workflow/session-maintenance.ts:381）。决定 79-1：代码只读当前格式、不留旧版本解码分支、旧夹具可删。它是规格行 2C-26，只因 79-1 让该行为不再存在才建议删，请 lead 定。",
    "action": "delete",
    "covered_by": "行为已不存在：决定 79-1；规格 slice-2C-SPEC.md:1279、:1405",
    "est_lines": 514,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-17",
    "category": "duplicate",
    "file": "tests/scenarios/S2C-K-retired.test.ts",
    "lines": "242-295",
    "tests": "2C-21 (2) a missing Kernel leaves the line retired with an unreadable history（:297 的 missing 实例；对照 tests/scenarios/S2C-K-unknown-outcome.test.ts:105-150 的 2C-22 (2)）",
    "evidence": "同一业务场景与几乎逐条相同的断言：retired 读法（retired:252-255 / unknown:88-92）、认证后 kernel_turn_open（retired:270-271 / unknown:122）、pass 1 后 conclusion（retired:277-278 / unknown:133）、归档后 tag/own/reactivate/session 卡（retired:284-293 / unknown:140-149）。2C-21 (2) 多出 history not_readable（retired:260-263），留它。",
    "action": "keep-note",
    "covered_by": "tests/scenarios/S2C-K-retired.test.ts::2C-21 (2) a missing Kernel leaves the line retired with an unreadable history",
    "est_lines": 30,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-18",
    "category": "duplicate",
    "file": "tests/scenarios/S2C-K2-continue.test.ts",
    "lines": "35-68",
    "tests": "2C-39 (1) a RUN-24 line gives one continue pinned to its Task and afterRun, and the submission is accepted（对照 tests/scenarios/S2C-K-paused-run24.test.ts:39-99 的 2C-23 (1)）",
    "evidence": "同一 RUN-24 造法（reply 1 暂停 + crash 重启）与同一读法：paused/paused_interrupted（continue:51-52 / run24:60-61）、唯一 continue（continue:55-59 / run24:65-66）、tasks/requeue 提交并 requeued（continue:65-67 / run24:87-89）。2C-23 (1) 还断言维护不归档与同一 Session 续跑（run24:71-96），是业务流程那条。",
    "action": "keep-note",
    "covered_by": "tests/scenarios/S2C-K-paused-run24.test.ts::2C-23 (1) a human-paused Run interrupted by the restart…",
    "est_lines": 15,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-19",
    "category": "duplicate",
    "file": "tests/scenarios/S2C-K2-controls.test.ts",
    "lines": "45-73",
    "tests": "2C-34 (1) an outcome-unknown Work line lists attest_unknown…（对照 tests/scenarios/S2C-K-unknown-outcome.test.ts:83-151 的 2C-22 (1)(2)）",
    "evidence": "同一造法（移走 Kernel + crash 重启）与同一读法：own retired、attention unknown（controls:63-64 / unknown:88-91），再 executions/resolve-unknown 提交并 committed（controls:69-71 / unknown:113-116）。2C-34 独有的是控件与 route 的投影（controls:66-67）；认证后的归档尾巴在 2C-22 (2)。",
    "action": "keep-note",
    "covered_by": "tests/scenarios/S2C-K-unknown-outcome.test.ts::2C-22 (1) / 2C-22 (2)",
    "est_lines": 15,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-20",
    "category": "handwritten",
    "file": "tests/scenarios/S3-context-and-inputs.test.ts",
    "lines": "197-204、310",
    "tests": "SC01 的 §5.1 夹具（同文副本 tests/scenarios/S3-query-graph.test.ts:205-214、317）",
    "evidence": "seedCompletedRun 绕过记录存储，直接开 ledger.sqlite 执行 INSERT INTO snapshots 造已完成 Run；:190-196 注释承认直接写 RunSnapshot。公开步骤存在：Workflow 的 claim/prepare/start 真跑 tA 会写出同一已完成 Run（runId 由产品生成）。",
    "action": "convert:走 Workflow claim/prepare/start 跑完 tA，用真实返回的 RunRef 替换常量 RUN_A",
    "covered_by": "—（convert 后由同一条业务流程覆盖）",
    "est_lines": 25,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "B-21",
    "category": "helper",
    "file": "tests/scenarios/S3-query-graph.test.ts",
    "lines": "71-353",
    "tests": "调用方 S3-query-graph SC02 与 S3-context-and-inputs SC01",
    "evidence": "两个文件的夹具块（71-353）diff 只有 46 行差异：S3Host 类型、workspaceBindings、s3Checks、s3Runtime、s3Ctx、runACtx、seedCompletedRun、runASnapshot、planDraft、seedS3Graph、openS3Host，各约 280 行，却只服务各一个用例。建议抽到 tests/scenarios/support/ 后删其中一份。",
    "action": "delete",
    "covered_by": "tests/scenarios/S3-context-and-inputs.test.ts:71-353 同文夹具",
    "est_lines": 270,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-22",
    "category": "duplicate",
    "file": "tests/scenarios/S4C2-U6-note-card-e2e.test.ts",
    "lines": "85-106、113-129",
    "tests": "D-01 %s supersede accepts v2… / D-01 %s coexist accepts v2…（对照 tests/work-graph/S4C2-D17.test.ts:51-88）",
    "evidence": "同一 acceptance 夹具、同一协调器、同一效果断言：action {status:'done',version:2,state:'accepted'}、application committed、目标 superseded/accepted、cardOf 变 null（U6:97-112 / D17:60-73；U6:115-129 / D17:75-87）。U6 独有卡形状/三选项/历史不可变（:74-86、:118-124）与文案/重放/指针（:139-244）。",
    "action": "keep-note",
    "covered_by": "tests/work-graph/S4C2-D17.test.ts::D-17 %s supersede / coexist",
    "est_lines": 30,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-23",
    "category": "duplicate",
    "file": "tests/scenarios/WP1-wiring.test.ts",
    "lines": "47-79",
    "tests": "WP1-wiring / SC01 (closing supported) ↔ A8-host-restart-paused / LA-1 and contract (e) (closing supported; 723-839)",
    "evidence": "同一业务场景：人工 pause→Host 重启→继续→close_open_turn→原 Session 新 Run→satisfied。并排：WP1:58 lineKinds 与 A8:791/819 相同；WP1:60 closed/available 与 A8:791-792；WP1:65 satisfied 与 A8:815；WP1:69-70 新 Run+同 Session 与 A8:795/819；WP1:73 active+available 与 A8:803。WP1 独有 anomaly 公共读（77）与 archive label（78），可并入 A8。",
    "action": "merge-into:tests/scenarios/A8-host-restart-paused.test.ts::LA-1 and contract (e) (closing supported; KA-07, KA-09, A8-3l step 5, A8-3r)",
    "covered_by": "tests/scenarios/A8-host-restart-paused.test.ts::LA-1 and contract (e) (closing supported; KA-07, KA-09, A8-3l step 5, A8-3r)",
    "est_lines": 33,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-24",
    "category": "trivial",
    "file": "tests/scenarios/harness.test.ts",
    "lines": "191-212",
    "tests": "platform mode seams: a registered check is a new configuration revision; cap 0 stops the automatic rework",
    "evidence": "用例断言大半被业务流程测试做掉：registerCheck 是新修订并冻结在轮次（harness.test.ts:200）↔ C5-reverify-guards.test.ts:81,107,123；cap 0 → stopped/auto_rework_cap_reached、0 写（203-211）↔ C8-auto-rework-cap.test.ts:62-80、A11-no-progress.test.ts:120-190。但 registerCheck 的 configurationRevision 断言与 setAutomation/automationPolicy 接缝只见于本用例，删除会丢接缝覆盖，建议 keep-note。",
    "action": "keep-note",
    "covered_by": "tests/scenarios/C8-auto-rework-cap.test.ts::C8 (§13.4 #15, AV-8, GOAL-30) + tests/scenarios/C5-reverify-guards.test.ts::(a)/(b) §13.7 / LA-4",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "低"
  },
  {
    "id": "B-25",
    "category": "helper",
    "file": "tests/scenarios/harness.ts",
    "lines": "86, 717-720",
    "tests": "assertInvariantsAt（legacyFindings 拼接）",
    "evidence": "legacyFindings 只收集 tests/state/invariants.ts:2272 的 legacy 分类（旧数据、以前规则）；来源见同文件 :953 written before R3e.3、:1063 pre-D-8 data、:1156 before VD-4、:1275 V1 Run、:1504 legacy @0。79-1 之后没有真实旧库；若 tests/state 的 legacy 分类按 79-1 去掉，这里的 import 与拼接一并去掉。",
    "action": "keep-note",
    "covered_by": "—（依赖 tests/state 的裁定）",
    "est_lines": 2,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "B-26",
    "category": "helper",
    "file": "tests/scenarios/harness.ts",
    "lines": "626-632",
    "tests": "ScenarioBase.kernelRecords()",
    "evidence": "全仓 grep -rn \"kernelRecords()\" 只命中定义 tests/scenarios/harness.ts:627；计数一律走 fileCounts/counts()（harness.ts:385-405、654）。字段名 kernelRecords 的使用不算调用。",
    "action": "delete",
    "covered_by": "—（无测试使用）",
    "est_lines": 7,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-27",
    "category": "helper",
    "file": "tests/scenarios/harness.ts",
    "lines": "1283-1287",
    "tests": "PlatformScenario.setTokenBudget()",
    "evidence": "全仓 grep -rn setTokenBudget 只命中定义 tests/scenarios/harness.ts:1284；C8-budget 用自己的 openBudgetEnvironment 并在 C8-budget.test.ts:79-80 直接 registerWorkflowBinding，不经过此方法。",
    "action": "delete",
    "covered_by": "—（无测试使用）",
    "est_lines": 5,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-28",
    "category": "helper",
    "file": "tests/scenarios/support/S5-decisions.ts",
    "lines": "384-394",
    "tests": "无调用方（两个 S5 场景与 tests/app/S5-decision-routes.test.ts 都不 import）",
    "evidence": "全 tests/、src/、scripts/ 搜 \\babandonCandidate\\b 只命中定义本身；文件内也只此 1 处，没有任何测试走 abandonPlanProposal 的这个包装。",
    "action": "delete",
    "covered_by": "—（无测试使用）",
    "est_lines": 11,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-29",
    "category": "handwritten",
    "file": "tests/scenarios/support/S5-decisions.ts",
    "lines": "527-638",
    "tests": "调用方 tests/scenarios/S5-goal-conflict-rework.test.ts:113（SC02 的 Agent requeue）",
    "evidence": "手写整条 Agent 准入：手拼 PreparedTaskManifestV1 JSON（:571-577）、bodies.put 放 manifest（:578-583）、手搭 PreparedTaskExecution（:584-590）、直接调 authorizeRuntimeEntry/beginRuntimeEntry/recordExecutionEntered/recordRunResult（:600-632），finally 补 run_completed。:520-526 注释承认不是模型驱动。公开步骤存在：requeue_task 是正式 Workflow perform，见 tests/scenarios/A4-duplicate-receipts.test.ts:167、tests/scenarios/K3-16-approval-round.test.ts:140。",
    "action": "convert:Workflow advanceWork 到 requeue_task perform（脚本化 Agent 工具调用）",
    "covered_by": "—（convert 后由同一条业务流程覆盖）",
    "est_lines": 112,
    "spec_row": false,
    "confidence": "中"
  }
]
```

## 合计

| 类别 | 条数 | 估计行数 |
| --- | --- | --- |
| 过时（stale） | 2 | 741 |
| 重复（duplicate） | 12 | 522 |
| 琐碎（trivial） | 2 | 0 |
| 手写事实（handwritten） | 5 | 153 |
| 只为篡改（tamper） | 0 | 0 |
| 辅助（helper） | 8 | 745 |
| **合计** | **29** | **2161** |

按类分布：
- 过时：B-02 A8-host-restart-paused.test.ts:66-76, 841-956（另 A7-control-goal29.test.ts:35-43,116-181；WP1-wiring.test.ts:36-45,81-126）；B-16 S2C-K-legacy-provenance.test.ts:1-514
- 重复：B-04 C6-unrelated-adoption.test.ts:163-207；B-05 K3-06-mixed-batch.test.ts:174-240；B-08 K3-19-missing-read-no-round.test.ts:181-241；B-10 K3-29-startup-variants.test.ts:125-170；B-11 K3-37-stopped-review-round.test.ts:231-297；B-12 K3-37-stopped-review-round.test.ts:298-383；B-14 K3-r1-seams.test.ts:162-182；B-17 S2C-K-retired.test.ts:242-295；B-18 S2C-K2-continue.test.ts:35-68；B-19 S2C-K2-controls.test.ts:45-73；B-22 S4C2-U6-note-card-e2e.test.ts:85-106、113-129；B-23 WP1-wiring.test.ts:47-79
- 琐碎：B-15 K3-store-wrapper-seam.test.ts:26-51；B-24 harness.test.ts:191-212
- 手写事实：B-01 A8-host-restart-attestation.test.ts:74-83, 120-123, 151-158；B-03 A8-host-restart-paused.test.ts:198-204；B-13 K3-r1-seams.test.ts:136-160；B-20 S3-context-and-inputs.test.ts:197-204、310；B-29 S5-decisions.ts:527-638
- 辅助：B-06 K3-09-restart-between-calls.test.ts:108-135；B-07 K3-16-proposal-round.test.ts:110-145；B-09 K3-29-disposition-recovery.test.ts:109-166；B-21 S3-query-graph.test.ts:71-353；B-25 harness.ts:86, 717-720；B-26 harness.ts:626-632；B-27 harness.ts:1283-1287；B-28 S5-decisions.ts:384-394

## 覆盖说明

117 个文件全部过了一遍：全文读 51 个，浏览 66 个，未读 0 个。

**全文读完：**

`tests/scenarios/A1-rework-same-session.test.ts`、`tests/scenarios/A10-check-recovery.test.ts`、`tests/scenarios/A4-duplicate-receipts.test.ts`、`tests/scenarios/A7-control-goal29.test.ts`、`tests/scenarios/A8-host-restart-attestation.test.ts`、`tests/scenarios/A8-host-restart-rework.test.ts`、`tests/scenarios/B2-09b-allowance-crash.test.ts`、`tests/scenarios/C3-not-entered-chain.test.ts`、`tests/scenarios/C3-paused-continue-brief.test.ts`、`tests/scenarios/C3-workspace-changed.test.ts`、`tests/scenarios/C5-gate-fix-open.test.ts`、`tests/scenarios/C6-unrelated-adoption.test.ts`、`tests/scenarios/C8-auto-rework-cap.test.ts`、`tests/scenarios/C8-budget.test.ts`、`tests/scenarios/WP1-wiring.test.ts`、`tests/scenarios/harness.test.ts`、`tests/scenarios/harness.ts`、`tests/scenarios/S1-archive-restart.test.ts`、`tests/scenarios/S1-wait-copy-retirement.test.ts`、`tests/scenarios/S2C-K-archive-interruption.test.ts`、`tests/scenarios/S2C-K-archive-tags-checks.test.ts`、`tests/scenarios/S2C-K-archive-tags.test.ts`、`tests/scenarios/S2C-K-goal-pause.test.ts`、`tests/scenarios/S2C-K-paused-run24.test.ts`、`tests/scenarios/S2C-K-retired.test.ts`、`tests/scenarios/S2C-K-unknown-outcome.test.ts`、`tests/scenarios/S2C-K2-continue.test.ts`、`tests/scenarios/S2C-K2-controls.test.ts`、`tests/scenarios/S2C-K2-conversation.test.ts`、`tests/scenarios/S2C-K2-gate-checks.test.ts`、`tests/scenarios/S2C-K2-paused-archive.test.ts`、`tests/scenarios/S2C-K2-paused-transfer.test.ts`、`tests/scenarios/S2C-K2-query-not-entered.test.ts`、`tests/scenarios/S3-context-and-inputs.test.ts`、`tests/scenarios/S4C2-U6-note-card-e2e.test.ts`、`tests/scenarios/S5-goal-conflict-rework.test.ts`、`tests/scenarios/support/process-sandbox-standin.ts`、`tests/scenarios/support/review-work-root.ts`、`tests/scenarios/support/shell-work-root.ts`、`tests/scenarios/K3-05-review-round.test.ts`、`tests/scenarios/K3-19-missing-read-no-round.test.ts`、`tests/scenarios/K3-19-review-unavailable.test.ts`、`tests/scenarios/K3-29-startup-answers.test.ts`、`tests/scenarios/K3-29-startup-reconcile-2b.test.ts`、`tests/scenarios/K3-29-startup-variants.test.ts`、`tests/scenarios/K3-37-stopped-review-round.test.ts`、`tests/scenarios/K3-44-crr-kind4.test.ts`、`tests/scenarios/K3-44-recovery-answers.test.ts`、`tests/scenarios/K3-45-review-incomplete-r2.test.ts`、`tests/scenarios/K3-r1-seams.test.ts`、`tests/scenarios/K3-store-wrapper-seam.test.ts`

**只浏览（读了头注、用例标题和关键断言段）：**

`tests/scenarios/A11-no-progress.test.ts`、`tests/scenarios/A7-control.test.ts`、`tests/scenarios/A8-host-restart-entry.test.ts`、`tests/scenarios/A8-host-restart-lease.test.ts`、`tests/scenarios/A8-host-restart-paused.test.ts`、`tests/scenarios/A8-host-restart.test.ts`、`tests/scenarios/C3-brief-idempotency.test.ts`、`tests/scenarios/C3-reply-other-session.test.ts`、`tests/scenarios/C5-gate-fix.test.ts`、`tests/scenarios/C5-reverify-guards.test.ts`、`tests/scenarios/C7-defer-reactivate.test.ts`、`tests/scenarios/C7-supersede-failed-task.test.ts`、`tests/scenarios/C8-human-stop-respected.test.ts`、`tests/scenarios/WP2-wiring-scenario.test.ts`、`tests/scenarios/S2C-K-legacy-provenance.test.ts`、`tests/scenarios/S3-query-graph.test.ts`、`tests/scenarios/S5-two-request-decisions.test.ts`、`tests/scenarios/support/S5-decisions.ts`、`tests/scenarios/support/brief.ts`、`tests/scenarios/support/common.ts`、`tests/scenarios/support/control.ts`、`tests/scenarios/support/fuzz.ts`、`tests/scenarios/support/gate.ts`、`tests/scenarios/support/git-workspace.ts`、`tests/scenarios/support/plan.ts`、`tests/scenarios/support/receipts.ts`、`tests/scenarios/support/restart.ts`、`tests/scenarios/support/review-card-round.ts`、`tests/scenarios/support/rework.ts`、`tests/scenarios/K-R-attested-facts-source.test.ts`、`tests/scenarios/K-R-interrupted-brief.test.ts`、`tests/scenarios/K-W-fallback.test.ts`、`tests/scenarios/K-W-maintenance.test.ts`、`tests/scenarios/K-W-workflow-close.test.ts`、`tests/scenarios/K3-06-mixed-batch.test.ts`、`tests/scenarios/K3-07-real-host-kill.test.ts`、`tests/scenarios/K3-08-wait-reply.test.ts`、`tests/scenarios/K3-09-restart-between-calls.test.ts`、`tests/scenarios/K3-10-review-round-cells.test.ts`、`tests/scenarios/K3-11-review-reasons-r2.test.ts`、`tests/scenarios/K3-12-14-review-round.test.ts`、`tests/scenarios/K3-13-two-commands.test.ts`、`tests/scenarios/K3-15-card-hold.test.ts`、`tests/scenarios/K3-16-approval-round.test.ts`、`tests/scenarios/K3-16-proposal-round.test.ts`、`tests/scenarios/K3-17-review-answer-shape.test.ts`、`tests/scenarios/K3-18-one-card.test.ts`、`tests/scenarios/K3-20-review-card-paging.test.ts`、`tests/scenarios/K3-25-attestation-replay.test.ts`、`tests/scenarios/K3-26-inventory-scenarios.test.ts`、`tests/scenarios/K3-27-review-claim-close.test.ts`、`tests/scenarios/K3-28-attested-continuation.test.ts`、`tests/scenarios/K3-29-disposition-recovery.test.ts`、`tests/scenarios/K3-29-extras.test.ts`、`tests/scenarios/K3-29-maintenance-review-run.test.ts`、`tests/scenarios/K3-29-recovery-continuation.test.ts`、`tests/scenarios/K3-29-recovery-round.test.ts`、`tests/scenarios/K3-42-truncated-command.test.ts`、`tests/scenarios/K3-42-unexpanded-r2.test.ts`、`tests/scenarios/K3-44-hold-restart.test.ts`、`tests/scenarios/K3-R1-continuation-protection.test.ts`、`tests/scenarios/K3-R1-file-change.test.ts`、`tests/scenarios/K3-R1-restart-flows.test.ts`、`tests/scenarios/K3-R1-second-cleanup.test.ts`、`tests/scenarios/K3-R1-session-not-closable.test.ts`、`tests/scenarios/K3-R1-workspace-capture.test.ts`

浏览件中正文未逐行读的段落：`S2C-K-legacy-provenance.test.ts` 120-400、`S3-query-graph.test.ts` 71-353、`S5-two-request-decisions.test.ts` 90-182、`support/S5-decisions.ts` 1-60，以及多数 support 夹具的正文（只看导出清单与引用统计）。

三部分的分工：第 1 部分 31 个文件 12,494 行；第 2 部分 37 个文件 12,854 行；第 3 部分 49 个文件 14,065 行。

三部分由三个只读子任务分头做；协调者抽检了 18 条证据（行号、覆盖关系、动作），据此把 3 条 delete 改成 keep-note（K3-store-wrapper-seam、harness.test 接缝自检、K3-29 variant (b)），并否决 2 条 tamper 误报（见“未解决”第 4 条）。

## 未解决

1. **A8 "closing unsupported" 回退**（`A8-host-restart-paused.test.ts:66-76, 841-956`、`A7-control-goal29.test.ts:35-43, 116-181`、`WP1-wiring.test.ts:36-45, 81-126`）：三处都用 `vi.mock` 从 frozen vendor 导出里删掉 `closeOpenTurn`，但 vendor 固定导出它、生产固定注入 `turnClosure`。按 79-1 是旧接口兼容候选；L8 的回退和决定 42/43 是否仍要求这条降级路径，需 lead 与生产侧一并裁。

2. **规格行 2C-26 整文件**（`S2C-K-legacy-provenance.test.ts:1-514`）：只为“来历为 null 的旧 Session / 无 `executionState` 的旧 QueryRun”存在，规格 `slice-2C-SPEC.md:1279`、`:1405` 自述今天的写者造不出。按 79-1 建议删，但会连带 `src/business/workflow/session-maintenance.ts` 的来历补写，需生产侧一起定。

3. **`kernelStores.legacyEntries`**（`K-W-workflow-close.test.ts:487-583` 两条 KA-12）：只读 legacy Kernel locator，`src/app/main.ts:153` 读配置、`src/core/agent-runtime/kernel-store-locator.ts:26-131` 实现。它读的是旧 Kernel 存储位置，不是旧记录格式；按 79-1 可再议，本次未计入删除建议，留 lead 判断。

4. **已否决的两条 tamper**：第 2 部分原报 `S2C-K-unknown-outcome` / `S2C-K-retired` 的 `damageKernel`（UPDATE `session_records` 造坏记录）为“只为篡改”。复核后不采纳：平台读的是外部 Kernel store 的文件内容，解码损坏的存储内容属于 t-common 第 35 行明列的“真实边界”（文件内容），不是只有改数据库才能到达的防御分支；两条均未并入本表。

5. **重复条目之间互相依赖**：删 K3-19-missing-read 用例（`K3-19-missing-read-no-round.test.ts:181-241`）会让 `openMissingReadReviewRoot` 四副本和 `crashShellRun` 14 份副本各少一个；施工时先删该用例，再抽两个 helper，避免按旧行号改。同理 S3 两文件的夹具抽到 `support/` 与 `seedCompletedRun` 改公开步骤落在同一段夹具里，应先抽夹具再改。

6. **本区没有其它高把握的“过期”**：除上述 79-1 相关的两条，未发现“行为已被后续切片改掉、只在旧测试里还留着”的用例；A8 六个重启文件并不重复同一场景（各钉 W-/HL-/Q- 不同行），重复主要出现在同场景的 supported/unsupported 副本、返工轮 r2 与业务首轮之间。

