# Rule sheet v2: instances not allowed (F1, F3, A7 out of bounds), merged from codex2/t-v2n-*.out.md

Rows: 148 of 1417 listed; files: 126. Verdicts: F1 145, A7 越界 3

## B2-01-blocked-commands.test.ts (2)

- `[125]` [L7a §1] F1: send_user_message — 工具参数; 缺真实必填字段；H/K3-tool-seams.ts:136宽松替身接收
- `[70, 104, 105, 141, 151, 166, 175]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R；H/K3-blocked-command-fixture.ts:503转交

## B2-03-crr-request.test.ts (1)

- `[66, 79, 100, 114, 124, 147, 161]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R；构造链H/K3-crr-fixture.ts:63

## B2-07-crr-card-closed.test.ts (1)

- `[120]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R

## B2-08-crr-answer.test.ts (1)

- `[35]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R；成功应用分支

## B2-08-crr-cancel.test.ts (1)

- `[36]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R

## B2-09-answer-replay.test.ts (1)

- `[35]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R

## B2-09-crr-owner.test.ts (1)

- `[103, 259]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R；本地接线同文件:172

## B2-12-recognition.test.ts (1)

- `[140]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R

## B2-12-rewrite-prefix.test.ts (1)

- `[53, 57, 139]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R；H/K3-prefix-claim.ts:80转交

## B2-14-crr-forms.test.ts (1)

- `[55, 68, 83, 100, 120, 137, 153]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R；构造链H/K3-crr-fixture.ts:63

## B2-17-disposition-reads.test.ts (1)

- `[31]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R

## B2-18-request-reads.test.ts (1)

- `[86, 196]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R

## B2-UR7-crr-answer.test.ts (1)

- `[127, 144, 164]` [L7a §2] F1: decisionMessages.recordDecisionApplication — receipt; R；Workflow也接入回调，同文件:92

## C1-session-mailbox.test.ts (1)

- `[333]` [L7a §2] F1: messages.readInbox — atLeastCursor; 同文件:332加1000重造

## K3-15-disposition-effects.test.ts (1)

- `[134, 162, 279]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F：helper从事件JSON重建

## K3-16-approval-application.test.ts (1)

- `[72, 137, 174, 179, 181]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F；72记成功分支

## K3-16-proposal-round-fixture.test.ts (1)

- `[77, 124, 153, 173, 223]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F；reach helper含answer步骤

## K3-16-proposal-write.test.ts (1)

- `[66]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F：helper从事件JSON重建

## K3-16-second-unfinished-proposal.test.ts (1)

- `[89, 169]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F：helper从事件JSON重建

## K3-17-disposition-replay.test.ts (1)

- `[68, 76, 89, 96, 104, 115, 122]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F；包括重放和登记失败重试

## K3-18-requeue-confirmed.test.ts (1)

- `[122]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F：helper从事件JSON重建

## K3-41-disposition-proof.test.ts (1)

- `[51, 112]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F；112的receiptA来源60的重建helper

## K3-48-2-unknown-call-review-model-text-budget.test.ts (1)

- `[293, 358]` [L6 §2] F1: decisionMessages.recordDecisionApplication — receipt; F：helper从事件JSON重建

## R3b-material-applicability.test.ts (1)

- `[93, 95, 97, 98]` [L7a §2] F1: materials.openArtifact — ref.digest; 内部body store直接产生；同文件:65、69

## R3c-plan-adoption.test.ts (1)

- `[152]` [L7a §2] F1: plans.queryTaskGraph — atLeastCursor; 同文件:153加1000重造

## R3c-task-relations.test.ts (3)

- `[128, 151, 158]` [L7a §2] F1: plans.proposePlan — artifactRef.digest; 同文件:53手造；74放入草稿；142畸形摘要
- `[128, 158]` [L7a §1] F1: plans.proposePlan — 带自造artifact指纹的草稿; 同文件:53、74；公开采用后还有内部读189
- `[151]` [L7a §1] F1: plans.proposePlan — 畸形草稿; 同文件:137、142、153；强转不满足契约，拒绝后不采用

## R3d-observed-boundaries.test.ts (1)

- `[104]` [L7a §2] F1: architecture.queryArchitecture — sourceDigest/configDigest/material.digest; 同文件:98、99、101改写返回值

## R3g-role-spec.test.ts (3)

- `[217, 374, 379, 488, 491]` [L7a §2] F1: roles.readRoleSpec — pin.digest; 217改写；373手造；480、487保留测试安装命令的自算摘要
- `[221, 495]` [L7a §2] F1: roles.activateRoleSpec — target.digest; 221改写；495使用同文件:480、487的测试自算摘要
- `[379]` [L7a §2] F1: roles.readRoleSpec — atLeastCursor; 内部readThrough加1000；同文件:375、378

## R4b-session-boundaries.test.ts (1)

- `[145]` [L7a §2] F1: sessions.findSessions — role.pin.digest; 同文件:116、118、119测试签发

## R4c-execution-read.test.ts (2)

- `[325, 339]` [L7a §2] F1: executions.readExecution — atLeastCursor; 同文件:324、338加25重造
- `[536]` [L7a §2] F1: executions.readExecution — atLeastCursor; 同文件:535测试签发畸形值后强转

## R4c-task-claim-boundaries.test.ts (1)

- `[67]` [L7a §2] F1: sessions.admitSessionCreation — role.pin.digest; 测试改成f.repeat(64)

## R5a-project-bootstrap.test.ts (1)

- `[253, 256, 261]` [L7a §2] F1: completionPolicies.activateCompletionPolicy — target.digest; 测试签发f/a重复摘要

## S2A-queue-card-semantics.test.ts (1)

- `[78]` [L7b §2] F1: decisionMessages.recordDecisionApplication — receipt; 同文件:60、63从截获提交重建；:79转交

## S2B-30-track-bars.test.ts (1)

- `[18]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-31-task-timeline-main.test.ts (1)

- `[21]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-32-task-timeline-fold.test.ts (1)

- `[41]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-33-task-timeline-pagination.test.ts (1)

- `[21, 45, 56, 70, 83, 99]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-34-executed-files.test.ts (1)

- `[22]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-activity-calendar-tasks.test.ts (1)

- `[21]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA

## S2B-activity-calendar.test.ts (1)

- `[18]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA

## S2B-activity-read-faults.test.ts (1)

- `[21]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA

## S2B-r2-27-moving-window.test.ts (1)

- `[76, 94, 113, 157]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-r2-activity-run-ended-at.test.ts (1)

- `[55]` [L7b §1] F1: s2b-r10-late-tool — 空工具参数; helpers/S2B-runtime-tools-support.ts:36、39、42；替身忽略参数并返回自造结果

## S2B-r2-calendar-boundaries.test.ts (1)

- `[16]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA

## S2B-r2-calendar-same-task.test.ts (1)

- `[22]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA；经日历夹具

## S2B-r2-keyed-cap.test.ts (1)

- `[15]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA

## S2B-r2-never-entered.test.ts (1)

- `[17]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA

## S2B-r2-r3-track-pagination.test.ts (1)

- `[23]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-r2-r4-bound-workspace.test.ts (1)

- `[27, 43]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-r2-r5-not-entered.test.ts (1)

- `[19]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-r2-r7-keyed-read-cap.test.ts (1)

- `[19, 50]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-r2-s-preentry-control.test.ts (1)

- `[24]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT；经时间线夹具

## S2B-r2-workspace-binding.test.ts (1)

- `[24]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA

## S2B-r3-consultation-cap.test.ts (1)

- `[23]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FT

## S2B-r4-session-workspace.test.ts (1)

- `[32, 38]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; :32为FT，:38为FA

## S2B-run-activity-read.test.ts (1)

- `[18]` [L7b §2] F1: completionPolicies.activateCompletionPolicy — 静态策略target.digest; FA

## S2C-lines-counts.test.ts (1)

- `[137]` [L7b §2] F1: lines.listArchivedLines — cursor; 自造not-a-real-cursor；拒绝不自动满足A6

## S2C-node-detail-bounded.test.ts (1)

- `[249, 254, 258]` [L7b §2] F1: nodeDetail.readNodeDetail — afterCursor; 同文件:249字面量、:252自行base64url编码

## S2C-pins.test.ts (1)

- `[216, 227, 244, 254]` [L7b §2] F1: workspaceDecisionSettings.markNoticesSeen — displayToken/seenThrough; 同文件:51手造position、:52直接issue、:58转交

## S3-context-inputs.test.ts (3)

- `[459]` [L7b §1] F1: plans.proposePlan — 带自造artifact指纹的草稿; 同文件:116、119；后续真实apply在:465不修复来源
- `[459]` [L7b §2] F1: plans.proposePlan — artifactRef.digest; 同文件:116、119测试计算
- `[914, 985]` [L7b §2] F1: taskInputs.readTaskInputs — candidateKey指纹; 同文件:128自行hash；:912、983组装来源后重算

## S3-prepared-context-admission.test.ts (2)

- `[315]` [L7b §1] F1: plans.proposePlan — 带自造artifact指纹的草稿; 同文件:91手造OLD_A，:313放入草稿
- `[315]` [L7b §2] F1: plans.proposePlan — artifactRef.digest; 同文件:91手造，:313放入草稿

## S4B-note-facts.test.ts (2)

- `[104, 110]` [L6 §2] F1: notes.writeNote — fromPosition/throughPosition; 101、103及调用处手填12、15、25
- `[78]` [L6 §2] F1: notes.writeNote — artifact.ref.digest; 77改成全零

## S4C-related-scope.test.ts (1)

- `[438]` [L6 §2] F1: notes.memoryFind — cursor; 解析后改rule并重建

## S5-decision-application.test.ts (1)

- `[198, 221, 241, 263, 273, 286, 297, 355, 377, 389, 402, 411, 417, 429, 437, 451]` [L7b §2] F1: decisionMessages.recordDecisionApplication — receipt; 同文件:34、39从捕获commit重建；:389又替换cursor；:53统一转交

## S5-goal-cause-at-least-cursor.test.ts (1)

- `[30, 41, 50, 59, 62]` [L7b §2] F1: causes.readGoalDecisionCauses — atLeastCursor; 同文件:20、22取手造commit回执；:29、50、57另行构造

## S5-notices.test.ts (1)

- `[189]` [L7b §2] F1: workspaceDecisionSettings.markNoticesSeen — seenThrough; 同文件:33构造pos；调用自造pos(12,r12)，拒绝不自动满足A6

## S8A-file-layer.test.ts (1)

- `[454]` [L6 §2] F1: architecture.compareFormalObserved — catalog.digest; 453使用测试生成的hex('d')

## SP-memory-scoped-find.test.ts (1)

- `[302, 310]` [L6 §2] F1: notes.memoryFind — cursor; 299、300、301、309解析修改后重建

## W1-future-plan.test.ts (1)

- `[604, 606]` [L7b §1] F1: plans.proposePlan — 强转非契约草稿; 同文件:602、603、605；taskStateBasis/schemaVersion=3；不满足A6

## WP2-undelivered-notices.test.ts (1)

- `[407, 427, 434, 455]` [L7b §2] F1: undeliveredReplyNotices.readPage — cursor/atLeastCursor; 同文件:397、398、399、426测试编码；:434字面量；:455自造水位

## tests/app/MVP-workbench-tools.test.ts (1)

- `[91, 96, 112]` [L4 §A1签发字段] F1: workbench.saveFile — expectedRevision指纹; B11

## tests/app/R6-host.test.ts (1)

- `[457, 478]` [L4 §A1签发字段] F1: runtime.createSession — role.pin.digest; B13

## tests/app/S2B-35-activity-routes.test.ts (2)

- `[125, 138]` [L4 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — 重算target.digest; B21
- `[97, 103]` [L4 §A1签发字段] F1: Host鉴权 — TOKEN; B19

## tests/app/S2B-backfill-host.test.ts (1)

- `[66, 133]` [L4 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — 重算活动策略target.digest; B24

## tests/app/S2B-backfill-workflow.test.ts (1)

- `[107, 172, 222, 279, 321, 341]` [L4 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — 重算活动策略target.digest; B26

## tests/app/S2B-r2-backfill-done-cursor.test.ts (1)

- `[134]` [L4 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — 重算活动策略target.digest; B33

## tests/app/S2B-r2-backfill-identity.test.ts (1)

- `[61]` [L4 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — 重算活动策略target.digest; B35

## tests/app/S2B-r2-backfill-revision-race.test.ts (1)

- `[49, 84]` [L4 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — 重算活动策略target.digest; B39

## tests/app/S3-graph-routes.test.ts (1)

- `[226]` [L4 §A1签发字段] F1: Host鉴权 — TOKEN; B42

## tests/app/S5-decision-routes.test.ts (1)

- `[137]` [L4 §A1草稿] F1: plans.proposePlan — draft:{}; A39

## tests/app/S8A-architecture-routes.test.ts (1)

- `[47]` [L4 §A1签发字段] F1: Host鉴权 — TOKEN; B53

## tests/app/change-emitters.test.ts (1)

- `[210, 249]` [L4 §A1签发字段] F1: collaboration.start — 部分prepared; B56

## tests/app/change-stream.test.ts (2)

- `[158, 159, 161, 177]` [L4 §A1签发字段] F1: Host变更流 — Last-Event-ID cursor; B58
- `[55]` [L4 §A1签发字段] F1: Host鉴权 — TOKEN; B57

## tests/app/orchestration-mechanism.test.ts (1)

- `[171, 183]` [L4 §A1草稿] F1: send_session_message — 交给假mailbox的发送参数; A44

## tests/business/A2-workflow-result-mapping.test.ts (1)

- `[84, 100, 110]` [L3 §A1草稿] F1: workflow.advanceWork — 只有meta的start/observe/finalize请求; 71—73强转；62,63,65替身忽略请求；非完整合同

## tests/business/K3-review-workflow-rows.test.ts (1)

- `[869, 887, 926]` [L3 §A1草稿] F1: workflow.advanceWork — 只有meta的start/observe请求; 810—813强转；803,804替身忽略请求

## tests/business/WP1-start-refusal.test.ts (1)

- `[18, 43]` [L3 §A1签发字段] F1: Workflow.advanceWork→Runtime.startRun — prepared; tests/helpers/WP1-units-fixture.ts:515,530手造；559替身忽略

## tests/composition/A2-requeue-platform.test.ts (1)

- `[421]` [L5 §A1签发字段] F1: claims.requeueTask — newInputRefs内digest、sizeBytes; 422测试签发；402、403转交；非A6块

## tests/composition/S2B-be1-five-tools.test.ts (1)

- `[31, 34]` [L5 §A1签发字段] F1: edit — expectedRevision; 18 revOf从测试正文计算；32、35填入；无公开read签发

## tests/composition/S8A-L8-adoption-capture.test.ts (1)

- `[174, 180]` [L5 §A1签发字段] F1: architecture.captureSourceChanges、queryArchitecture — requestSeq、selection.capture; 175测试签发；路由573禁止；180使用driver专用重放结果

## tests/data/R2e-git-operations.test.ts (2)

- `[373, 375, 378, 380, 409]` [L5 §A1签发字段] F1: workspace.compareWorkspace、project_source — sourceDigest、configDigest; 356、357、402、403测试签发；非A6块
- `[409]` [L5 §A1草稿] F1: project_source — compare参数; capture/capture分支混入prefix并强转；实际拒绝；非A6块

## tests/data/R3b-material-admission-boundaries.test.ts (1)

- `[46, 48, 50, 59, 71, 83, 93, 114, 116]` [L5 §A1签发字段] F1: materials.openArtifact — ArtifactRef.digest、sizeBytes; 12计算、29包装；记录替身提供；无真实公开签发

## tests/data/R3b-material-await-boundaries.test.ts (1)

- `[52, 54]` [L5 §A1签发字段] F1: materials.openArtifact — ArtifactRef.digest、sizeBytes; 14测试计算；45替身返回记录

## tests/data/R3b-materials-contract.test.ts (1)

- `[85, 86, 88, 90, 96]` [L5 §A1签发字段] F1: materials.openArtifact — ArtifactRef.digest、sizeBytes; 28、32 readyBody测试计算并制造返回记录

## tests/data/workspace-capture.test.ts (1)

- `[237]` [L5 §A1签发字段] F1: workspace.exportCapture — sourceDigest、configDigest; 233改成零摘要；非A6块

## tests/data/workspace-text-operations.test.ts (1)

- `[432]` [L5 §A1签发字段] F1: workspace.compareWorkspace — sourceDigest; 测试改成全零；非A6块

## tests/helpers/K3-blocked-command-fixture.ts (1)

- `[266]` [L1 §A1草稿] F1: send_user_message替身 — recipient/text; tests/work-graph/B2-01-blocked-commands.test.ts:125传入；缺真实分支字段；tests/helpers/K3-tool-seams.ts:136、143忽略请求

## tests/helpers/K3-review-card-fixture.ts (1)

- `[294]` [L1 §A1签发字段] F1: decisionMessages.recordDecisionApplication — applicationReceipt; 288 eventAt、291解析内部记录重建；313、315接入decision action

## tests/helpers/S2B-activity-fixture.ts (1)

- `[414]` [L1 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — target.digest; 415自行重算，未使用401安装返回摘要

## tests/helpers/S2B-runtime-steps-fixture.ts (1)

- `[183]` [L1 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — target.digest; 184自行重算，未使用170安装返回摘要

## tests/helpers/S5R2-c-support.ts (1)

- `[98]` [L1 §A1签发字段] F1: decisionMessages.recordDecisionApplication — applicationReceipt; 92 eventAt、95解析内部记录重建；147接入Workflow

## tests/helpers/WP1-units-fixture.ts (1)

- `[566]` [L1 §A1签发字段] F1: workflow.advanceWork/runtime.startRun — prepared; 530手建；559替身忽略请求；tests/business/WP1-start-refusal.test.ts:18、43消费

## tests/helpers/change-stream-reader.ts (2)

- `[107]` [L1 §A1签发字段] F1: GET core/changes — platform token; tests/app/change-stream.test.ts:26测试签发，42配置服务器，55传入
- `[108]` [L1 §A1签发字段] F1: GET core/changes — Last-Event-ID; tests/app/change-stream.test.ts:158、159、161、177为测试文字cursor

## tests/kernel/R4a-frozen-public.test.ts (1)

- `[300, 310, 854]` [L3 §A1签发字段] F1: Kernel.runCodingAgent — throughPosition; 295,842,848从内部records提取

## tests/runtime/B2-02-recognition-unified.test.ts (1)

- `[222, 274]` [L3 §A1签发字段] F1: request_command_rerun — rewriteOf.alias; 223,276手写1

## tests/runtime/B2-03-request-tool.test.ts (2)

- `[120]` [L3 §A1草稿] F1: request_command_rerun — 含手造rewriteOf.alias的工具参数; 122手写1
- `[120]` [L3 §A1签发字段] F1: request_command_rerun — rewriteOf.alias; 122手写1

## tests/runtime/K3-14-record-unknown-call-review-tool.test.ts (2)

- `[94, 113, 119, 128]` [L3 §A1草稿] F1: record_unknown_call_review — 含手造item的工具参数; 81,128手写编号；65录制端口
- `[94, 113, 119, 128]` [L3 §A1签发字段] F1: record_unknown_call_review — item展示编号; 81,128测试签发

## tests/runtime/K3-16-proposal-tool.test.ts (2)

- `[103, 120, 136, 143, 151, 155]` [L3 §A1草稿] F1: propose_safer_method — 含手造item的工具参数; 68,120手写编号；43录制端口
- `[103, 120, 136, 143, 151, 155]` [L3 §A1签发字段] F1: propose_safer_method — item展示编号; 68,120测试签发

## tests/runtime/K3-35-review-input-size.test.ts (1)

- `[174]` [L3 §A1签发字段] F1: record_unknown_call_review — item展示编号; 174脚本手写1；195未把返回alias用于参数

## tests/runtime/R4c-graph-history.test.ts (1)

- `[786, 802, 824, 849, 860, 880, 894]` [L3 §A1签发字段] F1: Runtime.readSessionHistory — range位置；802另含改写cursor; 779,817,843,874内部records重建；801改写cursor；852上界加5

## tests/runtime/R4c-session-continuity.test.ts (1)

- `[72, 79, 87, 102, 122, 139]` [L3 §A1签发字段] F1: runObservedModel→Kernel.runCodingAgent — throughPosition; 39,55从store records取值；121另作算术改造

## tests/runtime/S3-graph-tools.test.ts (2)

- `[702, 718, 721, 955]` [L3 §A1草稿] F1: look_graph/find_graph；plans.proposePlan — 手造cursor@702,718,721；手造artifact草稿@955; 703,719,722写cursor；810,813算digest；952装入草稿
- `[702, 718, 721, 955]` [L3 §A1签发字段] F1: look_graph/find_graph；plans.proposePlan — cursor@702,718,721；artifact指纹@955; 703,719,722手写cursor；810,813自算artifact；952装入草稿

## tests/runtime/S4C-note-tools.test.ts (1)

- `[114, 215]` [L3 §A7] A7 越界: buildNoteTools — 元数据检查；schema拒绝检查; 115—120及216—230超出.lead-ref/books/test-rule-sheet-v2.md:47—48明列用途

## tests/runtime/S5-user-message-tools.test.ts (1)

- `[410, 449]` [L3 §A1签发字段] F1: driver.start→Workflow.advanceWork — prepared; 250读manifest、255改写、265重组、380传入

## tests/runtime/S5R2-agent-application.test.ts (1)

- `[241, 282, 374]` [L3 §A1签发字段] F1: decisionMessages.recordDecisionApplication — receipt; 187读内部事件；208,217,224重建

## tests/runtime/W2-role-skills.test.ts (1)

- `[188]` [L3 §A1签发字段] F1: query_ready_tasks — page.cursor; 188手写prior-page；172替身

## tests/runtime/W2-whiteboard-tools.test.ts (2)

- `[268, 322, 338, 396]` [L3 §A1草稿] F1: propose_future_plan — 带手造artifact指纹的草稿; 94测试签发digest；117—123录制替身
- `[268, 322, 338, 396]` [L3 §A1签发字段] F1: propose_future_plan — artifact指纹; 94测试签发；117,123替身不验证来源

## tests/scenarios/K3-29-disposition-recovery.test.ts (1)

- `[185]` [L2 §4] A7 越界: createProcessSandboxStandin.execute — executeChecks:true; 实际执行命令并返回结果；support/process-sandbox-standin.ts:59、64

## tests/scenarios/K3-44-recovery-answers.test.ts (1)

- `[267]` [L2 §4] A7 越界: createProcessSandboxStandin.execute — executeChecks:true; 实际执行命令并返回结果；support/process-sandbox-standin.ts:59、64

## tests/scenarios/S3-context-and-inputs.test.ts (2)

- `[261]` [L2 §1] F1: plans.proposePlan — 含测试预算 artifact 摘要的草稿; 结构完整但字段来源不合；与第二节同一 F1，不重复计数
- `[261]` [L2 §2] F1: plans.proposePlan — artifact digest、size; 194测试预算；329才真实存储；与第一节同一来源，不重复计数

## tests/scenarios/support/S5-decisions.ts (1)

- `[434]` [L2 §2] F1: recordDecisionApplication — receipt.identityKey、fingerprint、cursor; 148、151、154从 SQLite idempotency 重建；S5-two-request-decisions.test.ts:141取值、163消费

## tests/scenarios/support/common.ts (1)

- `[712]` [L2 §2] F1: HTTP core 路由 — credential; 704测试自行指定 token，705配置服务器；C7-supersede-failed-task.test.ts:133调用

## tests/scenarios/support/control.ts (1)

- `[170]` [L2 §2] F1: runtime.startRun — prepared; 165读取 execution，171由 claim/envelope/inputBinding 重拼；调用方 A7-control.test.ts:287

## tests/scenarios/support/fuzz.ts (2)

- `[1553]` [L2 §2] F1: runtime.startRun — prepared; 1546读取 execution，1554重拼
- `[2241]` [L2 §2] F1: activateCompletionPolicy — target.digest; 2235内部 world 的 Plan，2243复制 effectiveCompletionPolicy，非 install 返回

## tests/state/invariants-fuzz.test.ts (2)

- `[81]` [L4 §A1签发字段] F1: runtime.startRun — 重拼prepared; B65
- `[95]` [L4 §A1签发字段] F1: completionPolicies.activateCompletionPolicy — 从内部计划取target.digest; B66

## unknown-call-review-list.test.ts (1)

- `[157]` [L7b §2] F1: unknownCallReviews.listReviews — cursor; 同文件:152、154、159；手造记录refKey充当游标

