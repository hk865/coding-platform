完成 B 区只读盘点：117 个文件均已检索并检查相关段落；其中 17 个全文阅读，100 个略读。未写文件，未运行测试或构建，未访问网络。

依据为 [.lead-ref/t-common.md](D:/cxt/t-inv/.lead-ref/t-common.md:1)、[决定 79](D:/cxt/t-inv/docs/refactor/HANDOFF.md:563) 和 [决定 85-4](D:/cxt/t-inv/docs/refactor/HANDOFF.md:683)。以下是供 lead 审核的 **16 项候选**。`merge-into` 均要求保留所列附加断言和规格行映射，不能直接删掉原用例。

估计行数按现有代码中拟删除或改造的行计算，不代表净减少量；共享夹具抽取后的新增行未计入，各项之间不重复计算。

| 编号 | 类别 | 位置、测试名 | 证据 | 建议 | 被谁覆盖／保留位置 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---:|---|---|
| B-01 | 过时 | `tests/scenarios/S2C-K-legacy-provenance.test.ts:1-514`；三个 `2C-26` 用例，分别始于 437、462、482 | 131–168 手写缺少 provenance 的旧记录；440、467 固定维护前后 `legacyUnchecked` 数量；484–490 构造没有当前执行状态的旧 QueryRun。`slice-2C-SPEC.md:1405` 明确这是旧记录夹具。决定 79-1 已取消开发期旧格式兼容。 | `delete`：删除该旧格式测试文件及其私有夹具；与生产区清理对应旧兼容路径协调。 | **行为已不在当前要求中**：`docs/refactor/HANDOFF.md:565-570`。不是声称旧实现已经移除，也不删除当前格式历史记录的读取测试。 | 514 | 是 | 高 |
| B-02 | 过时 | `tests/scenarios/K3-R1-file-change.test.ts:226-323`；`injection example (not R1): a read-only independent stand-in makes a two-entry review reachable` | 237–252 人为制造两个同时在途的 edit；269–275、322 固定双条目结果。最新 `slice-K3-SPEC.md:1780,1786` 要求真实链只保留单条，多条目只走无存储纯测试。但本例还包含有效的 ignored/protected 文件和 baseline 断言，不能整段无条件删除。 | `merge-into:tests/scenarios/K3-R1-file-change.test.ts::K3-04 (replace, L5/L6)`；将有效断言搬入真实单调用流程，再移除双调用注入例。 | 同文件 186–207 的 replace、209–224 的 create 用例。必须承接 277–282、304 的 ignored 可见性，310–312 的敏感文件名隐藏，以及 315–318 的 baseline Artifact 断言。 | 98 | 否 | 高 |
| B-03 | 重复 | `tests/scenarios/K-W-workflow-close.test.ts:259-285`；`KA-09 flow half` | 与同文件 287–312 的 `KA-11 (c)` 都是：关闭悬空 Turn，停在 claim 前，重启，再推进到 start；断言不再 close、不新建 Session、接续使用原 Session。KA-11(c) 另外检查 `healthConclusion:null`（297）。 | `merge-into:tests/scenarios/K-W-workflow-close.test.ts::KA-11 (c)`；保留 KA-09/KA-11(c) 双规格映射。 | 287–312。合并时承接 KA-09 的 `claim_task` 断言（277）及显式禁止启动自动推进的设置（270），保持故障点不变。 | 27 | 是 | 高 |
| B-04 | 重复 | `tests/scenarios/K-W-workflow-close.test.ts:233-257`；`KA-07 (KE3, L4/L7)` | 243–252 的关闭 Turn、没有 create/transfer/archive、同 Session 新 Run，已由 WP1 的完整 SC01 流程断言；后者还走到 Task satisfied。原例 253 的 **start 前 occupancy** 是需要迁移的差别。 | `merge-into:tests/scenarios/WP1-wiring.test.ts::SC01 (closing supported; KA-07)`；增加中间停点后合并。 | `tests/scenarios/WP1-wiring.test.ts:47-79`，对应断言 58–60、63–73、77–78。必须在 start 前承接 occupancy，不能只检查最终状态。 | 25 | 是 | 中 |
| B-05 | 重复 | `tests/scenarios/K3-06-mixed-batch.test.ts:174-239`；`K3-06 (process, L9/L10-L16)` | 与 K3-05 都是一个真实 shell 在途调用，经 RUN-25 形成 pending process，核对轮记录 done/unlikely，再 `settle_review`，不走 open_checks/finalize，最终 resolved 且 reasons 为空。K3-05 还检查 prepared tools、Run purpose 和原 Run 未完成。 | `merge-into:tests/scenarios/K3-05-review-round.test.ts::K3-05: RUN-25 leaves a process item pending`。保留 K3-06 的 file_edit、platform 分支。 | `tests/scenarios/K3-05-review-round.test.ts:86-198`，主要断言 113–118、135–149、155–194。承接来源 185 的 `contained/toolName` 和 229 附近的完整轮次结果断言。 | 66 | 是 | 高 |
| B-06 | 重复 | `tests/scenarios/K3-13-two-commands.test.ts:107-166`；`K3-13: the reachable single process item is concluded by the round and settles resolved with no reasons` | 当前夹具在 83–103 实际只运行一个 shell；111–120、138–162 的 pending → done/unlikely → resolved 流程与 K3-05 相同。多条目要求已被最新规格改为纯测试。 | `merge-into:tests/scenarios/K3-05-review-round.test.ts::K3-05: RUN-25 leaves a process item pending`；保留 K3-13 映射和独立的多条目纯测试。 | `tests/scenarios/K3-05-review-round.test.ts:86-198`；承接来源的 alias、精确 evidence、单条目和 `open:no` 断言。规格依据：`docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1786`。 | 60 | 是 | 高 |
| B-07 | 重复 | `tests/scenarios/K3-37-stopped-review-round.test.ts:231-296`；`K3-37 (二)` | 与 K3-29 row 4b 均为运行中的真实核对轮被人工暂停，Host 崩溃，RUN-24 收尾，settle 为 `review_stopped`，不再自动开轮。后者继续验证维护、hold/release 和一次接续。 | `merge-into:tests/scenarios/K3-29-recovery-round.test.ts::K3-29 row 4b`；保留 K3-37(二) 映射。 | `tests/scenarios/K3-29-recovery-round.test.ts:694-783`。承接来源 264 的暂停已生效断言、282 的无检查轮、287 的完整 reasons 数组和 292 的决定卡断言。K3-37(一)/(三) 保留。 | 66 | 是 | 高 |
| B-08 | 重复 | `tests/scenarios/S2C-K-unknown-outcome.test.ts:105-150,174-207`；`2C-22 (2)`、`2C-22 (4)` | 两例分别对 missing/damaged Kernel：人工 attestation 后写入 `kernel_turn_open`，第一遍维护记录探测结果，第二遍归档 retired，reactivate 被拒绝。2C-21(2) 已按同样两个参数跑同一流程，并额外检查 retired 和不可读历史。 | `merge-into:tests/scenarios/S2C-K-retired.test.ts::2C-21 (2) a ${name} Kernel leaves the line retired`；保留 2C-22(2)/(4) 映射。 | `tests/scenarios/S2C-K-retired.test.ts:243-294`，两种参数在 297–298。来源 83–103、152–172 的“尚未 attestation 时维护不得动 unknown holder”保留。 | 80 | 是 | 高 |
| B-09 | 手写事实 | `tests/scenarios/S3-context-and-inputs.test.ts:197-213,309-316`；SC01 的 `seedCompletedRun/runASnapshot` | 200–202 直接 INSERT/UPSERT snapshots；208–212 手拼一个 ended/completed Run，没有真实 claim、entry 和运行历史。 | `convert:platform.workflow.advanceWork → runtime.prepareExecution/startRun → materials.storeArtifact`。公开步骤今天已存在。先真实运行上游 tA，在检查轮前停下，再用所得 RunRef 存 old-A。 | 原 SC01 保留：`tests/scenarios/S3-context-and-inputs.test.ts:345-432`；同文件 358–377 已示范真实 claim/prepare/start，329 调用公开 Workflow。调整固定 RunRef 和 Session 数量基线，不能把 Run 完成改成 Task 已满足。 | 25 | 是 | 高 |
| B-10 | 手写事实 | `tests/scenarios/S3-query-graph.test.ts:205-221,317-323`；SC02 的同一上游 Run 夹具 | 与 B-09 相同的直接 SQL 快照；317 先注入 completed Run，再存 Artifact，随后才创建图。 | `convert:platform.workflow.advanceWork → runtime.prepareExecution/startRun → materials.storeArtifact`；与 B-09 共用真实上游准备流程。 | 原 SC02 保留：`tests/scenarios/S3-query-graph.test.ts:386-496`；公开 Workflow 入口在 336。保留只读图查询、Answer 保存及不产生额外业务写入的断言。 | 24 | 是 | 高 |
| B-11 | 手写事实 | `tests/scenarios/support/S5-decisions.ts:571-590`；`s5AgentRequeue` | 手拼 PreparedTaskManifest，579–582 直接存入 raw body，再于 584–590 手拼 PreparedTaskExecution。后面的 authorize/begin/entered 本身使用正式 owner，不作为删除对象。 | `convert:runtime.prepareExecution`。入口今天存在，但需为辅助 composition 配置相同的 `requeue_task` grant；不能直接调用当前 `h.direct()` 的空 Runtime。 | `src/core/agent-runtime/ports.ts:48`、`execution-preparation.ts:304,562-572`、`runtime.ts:730`。原业务用例 `tests/scenarios/S5-goal-conflict-rework.test.ts:37` 保留，113 调用该 helper。`tests/scenarios/harness.ts:848,1159-1162` 解释当前夹具为何尚不能直接 prepare。 | 20 | 否 | 中 |
| B-12 | 手写事实 | `tests/scenarios/K3-r1-seams.test.ts:137-160`；`locks at ModelRequestEvidenceRecorded ... and at SessionMessageSent ...` | 140–141 自建最小 events 表，只插入 `{eventType}`；149–150、156–157 人工调用 observer，并使用伪 cursor。真实运行已能到达两个提交点。 | `convert:runtime.startRun + lockLedgerAfter`；两个锁定点都保留，以正式提交触发 observer。 | 同文件 162–181 的 `K3-02 real flow`；`tests/scenarios/K3-R1-restart-flows.test.ts:84-101,144-208` 的真实 send/提交后崩溃流程。 | 24 | 否 | 高 |
| B-13 | 辅助 | `tests/scenarios/support/S5-decisions.ts:384-394`；`abandonCandidate` | 全 `tests/` TypeScript 文件检索 `\babandonCandidate\b`，仅命中 385 的声明，无调用或导入。该 helper 只是包装 389 的 `requestCandidates.abandonPlanProposal`。 | `delete`：只删未使用包装函数。 | 放弃候选的业务行为仍由 `tests/work-graph/S5-request-candidates.test.ts:201-225` 的 `RC06 abandon replays the original result and releases Q2 for a new first candidate` 覆盖。 | 11 | 否 | 高 |
| B-14 | 辅助 | `tests/scenarios/S3-query-graph.test.ts:121-186,223-292,294-316,324-348`；workspace/checks/runtime/graph/openS3Host 夹具 | 与 `S3-context-and-inputs.test.ts:113-178,215-284,286-308,318-340` 成组重复：同一 scope、权限、图、检查配置、composition 和推进循环。主要差别是临时目录前缀。SC01/SC02 的业务断言不同，不合并业务用例。 | `merge-into:tests/scenarios/S3-context-and-inputs.test.ts::openS3Host`：以该实现为来源抽出共享 support helper；不要从 `.test.ts` 直接导入。 | 两个现有 SC01/SC02 用例继续独立运行；共享夹具先按 B-09/B-10 改造。估计范围排除两项已计入的手写快照代码。 | 184 | 否 | 高 |
| B-15 | 辅助 | `tests/scenarios/K3-05-review-round.test.ts:45-58` 等 **28 处**相同 `KProcessSandbox`；完整位置见下方 JSON | 28 个 14 行类的构造、effectiveOptions、read-only probe 分支相同。现有 `support/process-sandbox-standin.ts:21-47` 已提供对应行为，`executeChecks:false` 时保持只探测模式。 | `merge-into:tests/scenarios/support/process-sandbox-standin.ts::createProcessSandboxStandin`；保留各文件的 `vi.hoisted` 状态隔离，明确传 `executeChecks:false`。 | `tests/scenarios/support/process-sandbox-standin.ts:21-50`；已有使用处包括 `K3-29-disposition-recovery.test.ts:49-50`、`K3-44-crr-kind4.test.ts:52-53`。不纳入具有额外执行行为的 `K3-12-14-review-round.test.ts:60-76`。 | 392 | 否 | 高 |
| B-16 | 辅助 | `tests/scenarios/S2C-K-unknown-outcome.test.ts:38-81`；`damageKernel/crashedMissingKernel/crashedDamagedKernel` | 两个 crash builder 除故障类型外相同；retired 文件已有参数化版本，包含相同 hold、推进、restart、读取和 outcome/health 断言。 | `merge-into:tests/scenarios/S2C-K-retired.test.ts::crashedUnknownKernel`：抽出共享 support helper，两个测试文件调用。 | `tests/scenarios/S2C-K-retired.test.ts:193-224`。仍保留 B-08 指明的两项未 attestation 场景；不删除 missing/damaged 边界覆盖。 | 44 | 否 | 高 |

以下 JSON 与表格为同一组发现。测试名称较长时使用其唯一前缀；所有行号均指本次读取的文件。

```json
[
  {
    "id": "B-01",
    "category": "stale",
    "file": "tests/scenarios/S2C-K-legacy-provenance.test.ts",
    "lines": "1-514",
    "tests": [
      "2C-26 before maintenance: seven unchecked",
      "2C-26 after one maintenance pass C joins P",
      "2C-26 the executions section stays indexed"
    ],
    "evidence": [
      "tests/scenarios/S2C-K-legacy-provenance.test.ts:131-168 手写缺少 provenance 的旧记录。",
      "tests/scenarios/S2C-K-legacy-provenance.test.ts:440,467 固定旧记录维护前后的 legacyUnchecked 数量。",
      "tests/scenarios/S2C-K-legacy-provenance.test.ts:484-490 构造旧 QueryRun。",
      "docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1405 明确该夹具针对旧记录。",
      "docs/refactor/HANDOFF.md:565-570 取消开发期旧格式兼容；此结论不表示生产兼容实现已经移除。"
    ],
    "action": "delete",
    "covered_by": [
      "行为已不在当前要求中：docs/refactor/HANDOFF.md:565-570（决定79-1）。",
      "只删除旧格式兼容测试，不删除当前格式产品历史记录的读取覆盖。"
    ],
    "est_lines": 514,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-02",
    "category": "stale",
    "file": "tests/scenarios/K3-R1-file-change.test.ts",
    "lines": "226-323",
    "tests": [
      "injection example (not R1): a read-only independent stand-in makes a two-entry review reachable"
    ],
    "evidence": [
      "tests/scenarios/K3-R1-file-change.test.ts:237-252 制造两个同时在途的 edit；269-275,322 断言两个条目。",
      "docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1780,1786 最新限定为真实单条链、多条目无存储纯测试。",
      "tests/scenarios/K3-R1-file-change.test.ts:277-282,304,310-318 仍含有效且必须迁移的可见性、敏感文件名和 baseline 断言。"
    ],
    "action": "merge-into:tests/scenarios/K3-R1-file-change.test.ts::K3-04 (replace, L5/L6)",
    "covered_by": [
      "tests/scenarios/K3-R1-file-change.test.ts:186-207::K3-04 (replace, L5/L6)",
      "tests/scenarios/K3-R1-file-change.test.ts:209-224::K3-04 (create, L5/L6)",
      "先把 ignored/protected 文件及 baseline Artifact 断言迁入真实单调用流程，再移除双调用注入例。"
    ],
    "est_lines": 98,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-03",
    "category": "duplicate",
    "file": "tests/scenarios/K-W-workflow-close.test.ts",
    "lines": "259-285",
    "tests": ["KA-09 flow half (KE3, L6/L7)"],
    "evidence": [
      "tests/scenarios/K-W-workflow-close.test.ts:264-280 与292-307 都在关闭 Turn 后、claim 前重启，再验证无第二次 close、无新 Session、原 Session 中的新 Run。",
      "tests/scenarios/K-W-workflow-close.test.ts:297 的 KA-11(c) 还检查 healthConclusion 为 null。",
      "合并时承接 tests/scenarios/K-W-workflow-close.test.ts:270 的 resumeOnStartup:false 和277的 claim_task 断言，保留两个规格行映射。"
    ],
    "action": "merge-into:tests/scenarios/K-W-workflow-close.test.ts::KA-11 (c)",
    "covered_by": [
      "tests/scenarios/K-W-workflow-close.test.ts:287-312::KA-11 (c)"
    ],
    "est_lines": 27,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-04",
    "category": "duplicate",
    "file": "tests/scenarios/K-W-workflow-close.test.ts",
    "lines": "233-257",
    "tests": ["KA-07 (KE3, L4/L7)"],
    "evidence": [
      "tests/scenarios/K-W-workflow-close.test.ts:243-252 与 tests/scenarios/WP1-wiring.test.ts:58-60,69-73 都验证关闭 Turn、无新 Session/transfer/archive、同 Session 新 Run。",
      "tests/scenarios/WP1-wiring.test.ts:63-65,77-78 还验证 Task satisfied、无异常锚和归档标签。",
      "来源 tests/scenarios/K-W-workflow-close.test.ts:253 的 start 前 occupancy 尚须在目标增加中间停点承接；不得用最终状态替代。"
    ],
    "action": "merge-into:tests/scenarios/WP1-wiring.test.ts::SC01 (closing supported; KA-07)",
    "covered_by": [
      "tests/scenarios/WP1-wiring.test.ts:47-79::SC01 (closing supported; KA-07)，补入 start 前 occupancy 后合并。"
    ],
    "est_lines": 25,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "B-05",
    "category": "duplicate",
    "file": "tests/scenarios/K3-06-mixed-batch.test.ts",
    "lines": "174-239",
    "tests": ["K3-06 (process, L9/L10-L16)"],
    "evidence": [
      "tests/scenarios/K3-06-mixed-batch.test.ts:174-239 与 tests/scenarios/K3-05-review-round.test.ts:86-198 都跑真实单 shell 在途调用、RUN-25、pending review、done/unlikely、settle_review、resolved 且 reasons 为空。",
      "tests/scenarios/K3-05-review-round.test.ts:135-149,187-194 还检查 prepared tools、Run purpose、原 Run 未完成和租约释放。",
      "承接来源 tests/scenarios/K3-06-mixed-batch.test.ts:185 的 contained/toolName 和229附近的完整轮次结果；241-288 的 file_edit/platform 分支保留。"
    ],
    "action": "merge-into:tests/scenarios/K3-05-review-round.test.ts::K3-05: RUN-25 leaves a process item pending",
    "covered_by": [
      "tests/scenarios/K3-05-review-round.test.ts:86-198::K3-05: RUN-25 leaves a process item pending"
    ],
    "est_lines": 66,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-06",
    "category": "duplicate",
    "file": "tests/scenarios/K3-13-two-commands.test.ts",
    "lines": "107-166",
    "tests": [
      "K3-13: the reachable single process item is concluded by the round and settles resolved with no reasons"
    ],
    "evidence": [
      "tests/scenarios/K3-13-two-commands.test.ts:83-103 当前只有一个 shell 调用。",
      "tests/scenarios/K3-13-two-commands.test.ts:111-120,138-162 与 tests/scenarios/K3-05-review-round.test.ts:113-118,155-181 重复 pending、done/unlikely、resolved 流程。",
      "合并时承接 alias、精确 evidence、单条目和 open:no 断言。",
      "docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1786 要求保留独立多条目纯测试。"
    ],
    "action": "merge-into:tests/scenarios/K3-05-review-round.test.ts::K3-05: RUN-25 leaves a process item pending",
    "covered_by": [
      "tests/scenarios/K3-05-review-round.test.ts:86-198::K3-05: RUN-25 leaves a process item pending",
      "保留 K3-13 规格映射及独立的多条目纯测试。"
    ],
    "est_lines": 60,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-07",
    "category": "duplicate",
    "file": "tests/scenarios/K3-37-stopped-review-round.test.ts",
    "lines": "231-296",
    "tests": ["K3-37 (二)"],
    "evidence": [
      "tests/scenarios/K3-37-stopped-review-round.test.ts:262-292 与 tests/scenarios/K3-29-recovery-round.test.ts:714-738 都覆盖运行中核对轮人工暂停、Host 崩溃、RUN-24、settle review_stopped、不自动再开轮。",
      "tests/scenarios/K3-29-recovery-round.test.ts:747-782 继续覆盖维护、hold/release、一次接续和最终安静状态。",
      "迁移来源 tests/scenarios/K3-37-stopped-review-round.test.ts:264,282,287,292 的暂停已生效、无检查轮、完整 reasons、决定卡断言。",
      "tests/scenarios/K3-37-stopped-review-round.test.ts:154,298 的 K3-37(一)/(三) 保留。"
    ],
    "action": "merge-into:tests/scenarios/K3-29-recovery-round.test.ts::K3-29 row 4b",
    "covered_by": [
      "tests/scenarios/K3-29-recovery-round.test.ts:694-783::K3-29 row 4b"
    ],
    "est_lines": 66,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-08",
    "category": "duplicate",
    "file": "tests/scenarios/S2C-K-unknown-outcome.test.ts",
    "lines": "105-150;174-207",
    "tests": ["2C-22 (2)", "2C-22 (4)"],
    "evidence": [
      "tests/scenarios/S2C-K-unknown-outcome.test.ts:105-150,174-207 对 missing/damaged 分别覆盖 attestation、kernel_turn_open、第一遍探测、第二遍归档 retired、拒绝 reactivate。",
      "tests/scenarios/S2C-K-retired.test.ts:243-294 覆盖同一流程，297-298 展开 missing/damaged 两种参数，并在258-263额外检查 retired 和不可读历史。",
      "tests/scenarios/S2C-K-unknown-outcome.test.ts:83-103,152-172 的未 attestation、unknown holder 不得被维护归档场景保留。"
    ],
    "action": "merge-into:tests/scenarios/S2C-K-retired.test.ts::2C-21 (2) a ${name} Kernel leaves the line retired",
    "covered_by": [
      "tests/scenarios/S2C-K-retired.test.ts:243-298::2C-21 (2) a ${name} Kernel leaves the line retired",
      "保留 2C-22(2)/(4) 规格映射。"
    ],
    "est_lines": 80,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-09",
    "category": "handwritten",
    "file": "tests/scenarios/S3-context-and-inputs.test.ts",
    "lines": "197-213;309-316",
    "tests": [
      "SC01: the real claim, prepare and start assemble the declared legacy input, and a repeated prepare keeps the original manifest"
    ],
    "evidence": [
      "tests/scenarios/S3-context-and-inputs.test.ts:200-202 直接 INSERT/UPSERT snapshots；208-212 手写 ended/completed Run。",
      "tests/scenarios/S3-context-and-inputs.test.ts:329 已调用公开 workflow.advanceWork；358-377 已有真实 claim/prepare/start 路径。",
      "公开步骤今天存在：先建立可运行上游计划并执行 tA，在检查轮前停下，用返回的实际 RunRef 调用 materials.storeArtifact，再建立消费 old-A 的图。",
      "修改固定 RunRef 和 Session 数量基线，保留 Run 完成不等于 Task 满足的语义。"
    ],
    "action": "convert:platform.workflow.advanceWork -> runtime.prepareExecution/startRun -> materials.storeArtifact",
    "covered_by": [
      "tests/scenarios/S3-context-and-inputs.test.ts:345-432::SC01，保留业务断言并更换前置事实的生成方式。"
    ],
    "est_lines": 25,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-10",
    "category": "handwritten",
    "file": "tests/scenarios/S3-query-graph.test.ts",
    "lines": "205-221;317-323",
    "tests": [
      "SC02: the old main-conversation Query answers through the read-only graph tools and the Answer is saved"
    ],
    "evidence": [
      "tests/scenarios/S3-query-graph.test.ts:205-221 手写 completed Run 快照，317 注入后再存 Artifact，323 才创建图。",
      "tests/scenarios/S3-query-graph.test.ts:336 已调用公开 workflow.advanceWork。",
      "与 B-09 共用真实上游执行步骤，公开步骤今天存在；保留只读图查询及 Answer 保存语义。"
    ],
    "action": "convert:platform.workflow.advanceWork -> runtime.prepareExecution/startRun -> materials.storeArtifact",
    "covered_by": [
      "tests/scenarios/S3-query-graph.test.ts:386-496::SC02，保留业务断言并更换前置事实的生成方式。"
    ],
    "est_lines": 24,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "B-11",
    "category": "handwritten",
    "file": "tests/scenarios/support/S5-decisions.ts",
    "lines": "571-590",
    "tests": ["s5AgentRequeue，服务 S5-goal-conflict-rework 的 SC02"],
    "evidence": [
      "tests/scenarios/support/S5-decisions.ts:571-590 手拼 manifest、直接 bodies.put、手拼 PreparedTaskExecution。",
      "src/core/agent-runtime/ports.ts:48 和 src/core/agent-runtime/runtime.ts:730 已有公开 prepareExecution；src/core/agent-runtime/execution-preparation.ts:304,562-572 实现准备及 manifest 存储。",
      "tests/scenarios/harness.ts:848,1159-1162 显示当前 h.direct() 没有配置执行 Runtime，不能原地直接调用 prepareExecution。",
      "需给辅助 composition 配置相同 requeue_task grant，再用公开准备入口；正式 authorize/begin/entered owner 调用不作为删除对象。"
    ],
    "action": "convert:runtime.prepareExecution",
    "covered_by": [
      "tests/scenarios/S5-goal-conflict-rework.test.ts:37::SC02 two Goals conflicting on module M",
      "tests/scenarios/S5-goal-conflict-rework.test.ts:113 调用 s5AgentRequeue；场景及 Agent requeue 断言保留。"
    ],
    "est_lines": 20,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "B-12",
    "category": "handwritten",
    "file": "tests/scenarios/K3-r1-seams.test.ts",
    "lines": "137-160",
    "tests": [
      "locks at ModelRequestEvidenceRecorded (K3-02, before the message) and at SessionMessageSent (K3-01)"
    ],
    "evidence": [
      "tests/scenarios/K3-r1-seams.test.ts:140-141 自建 events 表并只写入 eventType。",
      "tests/scenarios/K3-r1-seams.test.ts:149-150,156-157 手工调用 observer，使用伪 cursor。",
      "tests/scenarios/K3-r1-seams.test.ts:162-181 已通过真实 runtime.startRun 触发 evidence 提交后的锁。",
      "tests/scenarios/K3-R1-restart-flows.test.ts:84-101,144-208 已有 SessionMessageSent 提交后的真实锁定流程。"
    ],
    "action": "convert:runtime.startRun + lockLedgerAfter",
    "covered_by": [
      "tests/scenarios/K3-r1-seams.test.ts:162-181::K3-02 real flow",
      "tests/scenarios/K3-R1-restart-flows.test.ts:144-208::K3-01",
      "两个提交点及锁定断言均保留。"
    ],
    "est_lines": 24,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-13",
    "category": "helper",
    "file": "tests/scenarios/support/S5-decisions.ts",
    "lines": "384-394",
    "tests": ["abandonCandidate"],
    "evidence": [
      "全 tests/ TypeScript 文件检索 \\babandonCandidate\\b，仅命中 tests/scenarios/support/S5-decisions.ts:385 的声明，无调用或导入。",
      "tests/scenarios/support/S5-decisions.ts:389 包装 requestCandidates.abandonPlanProposal。",
      "rg 不在环境 PATH 中；使用 Get-ChildItem 和 Select-String 完成同范围符号检索。"
    ],
    "action": "delete",
    "covered_by": [
      "tests/work-graph/S5-request-candidates.test.ts:201-225::RC06 abandon replays the original result and releases Q2 for a new first candidate",
      "只删除未使用包装函数，保留放弃候选业务覆盖。"
    ],
    "est_lines": 11,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-14",
    "category": "helper",
    "file": "tests/scenarios/S3-query-graph.test.ts",
    "lines": "121-186;223-292;294-316;324-348",
    "tests": ["workspaceBindings", "s3Checks", "s3Runtime", "planDraft", "seedS3Graph", "openS3Host"],
    "evidence": [
      "tests/scenarios/S3-query-graph.test.ts:121-186,223-292,294-316,324-348 与 tests/scenarios/S3-context-and-inputs.test.ts:113-178,215-284,286-308,318-340 重复 scope、权限、图、检查配置、composition 和推进循环。",
      "主要差别为临时目录前缀；SC01 与 SC02 的业务断言不同，继续分别保留。",
      "以 context 文件中的实现为来源抽出共享 support helper，不从 .test.ts 直接导入。",
      "估计范围排除 B-09/B-10 已计入的快照构造和调用。"
    ],
    "action": "merge-into:tests/scenarios/S3-context-and-inputs.test.ts::openS3Host",
    "covered_by": [
      "tests/scenarios/S3-context-and-inputs.test.ts:345-432::SC01",
      "tests/scenarios/S3-query-graph.test.ts:386-496::SC02"
    ],
    "est_lines": 184,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-15",
    "category": "helper",
    "file": "tests/scenarios/K3-05-review-round.test.ts",
    "lines": "45-58；其余27处见 evidence",
    "tests": ["28处重复 KProcessSandbox 类"],
    "evidence": [
      "以下28个类各14行；构造、effectiveOptions 和 probe 分支相同。",
      "tests/scenarios/B2-09b-allowance-crash.test.ts:53-66",
      "tests/scenarios/K3-05-review-round.test.ts:45-58",
      "tests/scenarios/K3-06-mixed-batch.test.ts:48-61",
      "tests/scenarios/K3-08-wait-reply.test.ts:44-57",
      "tests/scenarios/K3-09-restart-between-calls.test.ts:42-55",
      "tests/scenarios/K3-10-review-round-cells.test.ts:41-54",
      "tests/scenarios/K3-11-review-reasons-r2.test.ts:53-66",
      "tests/scenarios/K3-13-two-commands.test.ts:37-50",
      "tests/scenarios/K3-15-card-hold.test.ts:34-47",
      "tests/scenarios/K3-16-approval-round.test.ts:46-59",
      "tests/scenarios/K3-16-proposal-round.test.ts:41-54",
      "tests/scenarios/K3-17-review-answer-shape.test.ts:47-60",
      "tests/scenarios/K3-18-one-card.test.ts:42-55",
      "tests/scenarios/K3-19-missing-read-no-round.test.ts:60-73",
      "tests/scenarios/K3-19-review-unavailable.test.ts:48-61",
      "tests/scenarios/K3-26-inventory-scenarios.test.ts:127-140",
      "tests/scenarios/K3-27-review-claim-close.test.ts:41-54",
      "tests/scenarios/K3-28-attested-continuation.test.ts:33-46",
      "tests/scenarios/K3-29-maintenance-review-run.test.ts:40-53",
      "tests/scenarios/K3-29-recovery-continuation.test.ts:40-53",
      "tests/scenarios/K3-29-recovery-round.test.ts:52-65",
      "tests/scenarios/K3-29-startup-variants.test.ts:47-60",
      "tests/scenarios/K3-37-stopped-review-round.test.ts:42-55",
      "tests/scenarios/K3-42-truncated-command.test.ts:48-61",
      "tests/scenarios/K3-42-unexpanded-r2.test.ts:48-61",
      "tests/scenarios/K3-44-hold-restart.test.ts:39-52",
      "tests/scenarios/K3-45-review-incomplete-r2.test.ts:55-68",
      "tests/scenarios/K3-R1-second-cleanup.test.ts:46-59",
      "tests/scenarios/support/process-sandbox-standin.ts:21-47 已提供对应构造和 probe 行为；明确传 executeChecks:false，并保留各文件 vi.hoisted 状态隔离。",
      "不合并 tests/scenarios/K3-12-14-review-round.test.ts:60-76 的额外执行行为。"
    ],
    "action": "merge-into:tests/scenarios/support/process-sandbox-standin.ts::createProcessSandboxStandin",
    "covered_by": [
      "tests/scenarios/support/process-sandbox-standin.ts:21-50::createProcessSandboxStandin",
      "tests/scenarios/K3-29-disposition-recovery.test.ts:49-50 已有使用",
      "tests/scenarios/K3-44-crr-kind4.test.ts:52-53 已有使用",
      "全部原业务用例保留，仅替换重复替身定义。"
    ],
    "est_lines": 392,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "B-16",
    "category": "helper",
    "file": "tests/scenarios/S2C-K-unknown-outcome.test.ts",
    "lines": "38-81",
    "tests": ["damageKernel", "crashedMissingKernel", "crashedDamagedKernel"],
    "evidence": [
      "tests/scenarios/S2C-K-unknown-outcome.test.ts:48-63,66-81 的流程只在故障类型和预期 healthConclusion 上不同。",
      "tests/scenarios/S2C-K-retired.test.ts:193-224 已有相同 damageKernel 和参数化 crashedUnknownKernel。",
      "抽出共享 support helper；不从 .test.ts 直接导入。",
      "保留 missing/damaged 文件边界与尚未 attestation 的 unknown holder 覆盖。"
    ],
    "action": "merge-into:tests/scenarios/S2C-K-retired.test.ts::crashedUnknownKernel",
    "covered_by": [
      "tests/scenarios/S2C-K-retired.test.ts:193-224::damageKernel/crashedUnknownKernel",
      "tests/scenarios/S2C-K-unknown-outcome.test.ts:83-103,152-172::2C-22 (1)/(3)"
    ],
    "est_lines": 44,
    "spec_row": false,
    "confidence": "高"
  }
]
```

**分类合计**

| 类别 | 项数 | 估计删除或改造行数 |
|---|---:|---:|
| stale／过时 | 2 | 612 |
| duplicate／重复 | 6 | 324 |
| trivial／琐碎 | 0 | 0 |
| handwritten／手写事实 | 4 | 93 |
| tamper／只为篡改 | 0 | 0 |
| helper／辅助 | 4 | 631 |
| **合计** | **16** | **1,660** |

按动作计算：`delete` 2 项、525 行；`merge-into` 10 项、1,042 行；`convert` 4 项、93 行。这里的 1,660 行包含改造，不能作为可直接删掉的行数。

**覆盖说明**

全文阅读的 17 个文件如下：

```text
tests/scenarios/K3-05-review-round.test.ts:1
tests/scenarios/K3-06-mixed-batch.test.ts:1
tests/scenarios/K3-13-two-commands.test.ts:1
tests/scenarios/K3-29-maintenance-review-run.test.ts:1
tests/scenarios/K3-R1-continuation-protection.test.ts:1
tests/scenarios/K3-R1-file-change.test.ts:1
tests/scenarios/K3-R1-restart-flows.test.ts:1
tests/scenarios/K3-r1-seams.test.ts:1
tests/scenarios/K3-store-wrapper-seam.test.ts:1
tests/scenarios/S2C-K-legacy-provenance.test.ts:1
tests/scenarios/S2C-K-retired.test.ts:1
tests/scenarios/S2C-K-unknown-outcome.test.ts:1
tests/scenarios/S3-context-and-inputs.test.ts:1
tests/scenarios/S3-query-graph.test.ts:1
tests/scenarios/WP1-wiring.test.ts:1
tests/scenarios/harness.test.ts:1
tests/scenarios/support/process-sandbox-standin.ts:1
```

其余 **100 个文件均为略读**：检查了测试声明、前置构造、关键断言、直接写入和 helper 定义；有候选的段落再展开核对，没有把这些文件记作全文阅读。它们精确对应清单中的以下行：

```text
.lead-ref/t-area-B.txt:1-32
.lead-ref/t-area-B.txt:35-40
.lead-ref/t-area-B.txt:42-55
.lead-ref/t-area-B.txt:57-68
.lead-ref/t-area-B.txt:72-74
.lead-ref/t-area-B.txt:77-82
.lead-ref/t-area-B.txt:84
.lead-ref/t-area-B.txt:87-93
.lead-ref/t-area-B.txt:96-98
.lead-ref/t-area-B.txt:100
.lead-ref/t-area-B.txt:102-110
.lead-ref/t-area-B.txt:112-117
```

重复项另外搜索了全 `tests/` 中相关 owner/tool、故障结果、helper 符号及覆盖断言。环境没有可用的 `rg`，使用 PowerShell `Get-ChildItem`／`Select-String` 替代。

以下边界已检查，但没有列为可删项：

- **claim 后重启与 prepare 后重启不同。** `tests/scenarios/K3-29-recovery-round.test.ts:312-376` 和 `tests/scenarios/K3-29-recovery-continuation.test.ts:450-505` 看起来接近，但后者在 463 已实际推进 prepare；不能凭相近名称合并掉一个故障点。
- **Kernel missing/damaged 保留。** `tests/scenarios/S2C-K-unknown-outcome.test.ts:38-81`、`tests/scenarios/S2C-K-retired.test.ts:193-224` 模拟的是 Kernel 存储文件不可读边界，不列入“只为触发数据库防御校验”的 tamper-only。
- **不能因 `legacy` 名称删除当前行为。** S3 的声明输入仍在当前规格内：`docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:807-808`。`legacy_template` 也被决定 79 明确保留：`docs/refactor/HANDOFF.md:597`。
- **只读旧 adapter 的归属仍待生产区裁定。** `tests/scenarios/K-W-workflow-close.test.ts:487-522` 测的是只有只读 reader、不能关闭 Turn 时的 fallback。仅凭该用例不足以认定它只服务开发期旧格式，因此没有建议删除。
- **B-04、B-11 的改造尚未运行验证。** B-04 必须保留 start 前占用状态；B-11 必须接好真实准备配置和 grant。这里给出已有公开入口及改造条件，不声称改完即可通过。
- **没有据此认定全部 117 个文件均无其他问题。** 特别是长文件 `tests/scenarios/harness.ts:1`、`tests/scenarios/support/fuzz.ts:1` 采用检索和局部阅读。本报告的确定结论以列出的具体段落为界。