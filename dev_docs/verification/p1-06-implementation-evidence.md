# P1-06 Implementation Evidence — Handoff A → B

```yaml
ticket: P1-06
status: implementation verified (limited authorization, 2026-09-06 — P1-06 only); 3 lanes merged; DAG 06 edges satisfied; G2 (Continuity) waits P1-05 + P1-06 evidence
baseline: P1-05 commit d1c6595 (64 files/539 tests); P1-06 shared baseline commit ca5c65d; final product-root merge commit a9070e5
doc_authority: /mnt/d/1.project/software/agent_learn/agent_dev/agent_platform
conflict_log: ../logs/conflict-reports/2026-09-06-p105-p106-merge.md (P1-05 × P1-06 并发追加冲突记录；control-plane 教训)
git: local main = a9070e5 (NOT pushed to GitHub origin main — push 需用户授权，P1-04/05 先例)
```

## 1. 验收对照（ticket 06 Acceptance，6/6 满足）

| # | Acceptance | 证据 |
| --- | --- | --- |
| 1 | HandoffPacket 硬大小上限并包含 objective/constraints/completed/unresolved/Evidence/Artifact refs/Workspace revision/来源 | `HANDOFF_PACKET_MAX_BYTES=64KiB`（canonical JSON 字节判 size_exceeded）；字段齐备（src/contracts/handoff.ts）；套件"HandoffPacket bounded shape"5 用例（valid/超 cap/summary cap）；记录层 run_not_ended/stale_source/not_found 零写入测试 |
| 2 | B 不读 A 的隐藏思维链或完整 transcript | packet 无 transcript 字段 + `validateHandoffPacket` 严格未知字段拒绝（transcript → unknown_field）；`noFullTranscript: true` 必填；HandoffContext 只取 packet 白名单字段，bundle body-first（owner=B runRef）；套件断言 envelope/manifest/bundle body 无 transcript 子串且 manifest.noFullTranscript=true；`HandoffControlPublicRuntimeReport.noHiddenContextRead=true` |
| 3 | source revision 不匹配 → 显式 stale 并重新投影 | recordHandoff：packet.workspaceRevision ≠ canonical → stale_source（零写入），重投影（新鲜 packet）→ committed；HandoffContextPort：request.workspaceRevision ≠ canonical → stale_workspace_snapshot（显式），重投影 → ready；packet 级 stale_packet 在纯函数 `evaluateReplacementEligibility` 与 assemble 中显式（绝不静默用旧）；套件 stale-source/stale-assemble 用例 + lane B stale_packet 单测 |
| 4 | A 的过期 lease 与迟到结果不能覆盖 B 的新 Attempt | `TaskLease CAS @N→N+1` 唯一写者；replacement 仅在 A 已 ended 或 lease 过期（lease_active 零写入，含纯函数 EXPIRED 用例）；A 迟到 fact → 其已 ended Run 的 after_terminal/stale_event（P1-03 per-run sequence，零写入）；套件 late-result 组断言 A late fact rejected 且 B run（starting/0 facts）与 lease holder=B 不受影响 |
| 5 | outcome_unknown 在交接与 View 中保留，不自动重试不可逆动作 | packet unresolved kind=outcome_unknown（fixture 默认 + 套件）；A outcome_unknown → record → replacement(reason=outcome_unknown)；provenance.outcomeUnknownPreserved=true；套件断言 timeline 恰 1 条 replacement（无自动重领）；无 retry/cancel 机制（P1-10） |
| 6 | B 提交后续结果可追溯到 A/B 两 Run 与同一 Task revision 的合法演进；不依赖 Goal reducer | A 证据 source.runRef=run-a-13、B 证据 source.runRef=run-b-13，anchor.planRef+planRevision 完全相同（套件 traceability 组，双适配器）；provenance timeline 含 packet_recorded/replacement_claimed/evidence_admitted（≥2）；本票不触碰 GoalPhase/reduceGoal（与 P1-05 零 diff 证明）；P1-05 的 GoalPhaseUpdated 在其会话验收，本票不以 Goal reducer 为前置（DAG Frontier：05/06 并行成立） |

## 2. 四组 verification 对照

| verification | 对应套件/测试 |
| --- | --- |
| forced-context-rollover-test | "HandoffContextPort assembly"组：stale_workspace_snapshot 显式 → 重投影 ready；forbidden/packet_not_found；bundle body-first + 无 transcript；run-crash recovery 中 driveHandoff 经 HandoffContext 组装（默认接线） |
| run-crash-recovery-test | "run-crash recovery path"组 + tests/restart/p1-06-*（探针自动启用）：A crash → record → B claim → driveHandoff(started=1, failures=[]) → B run ended/completed → provenance timeline；重启后 packet/replacement/lease/B-run 逐字段一致 + 视图重建一致 |
| stale-packet-test | "HandoffPacket bounded shape"/“recordHandoff registration” stale_source 用例 → 重投影；"evaluateReplacementEligibility" stale_packet 用例；assemble stale_workspace_snapshot 用例；claimReplacement stale 守卫（lane A 单测 + 纯函数） |
| late-result-rejection-test | "late-result rejection"组：A late completed → after_terminal（用 A 当前 run revision 使 after_terminal 守卫而非 CAS 决定）且 B 未被触碰；A 自身重复/陈旧序列仍拒绝；P1-04/05 双套件 36+16 零回归（per-run sequence 未回归） |

## 3. 已执行命令及结果（product root，提交 a9070e5）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS 0 errors |
| `pnpm vitest run`（全量） | **76 files / 641 tests PASS**（P1-00…05 基线 539 零回归 + P1-06 新增 102：lane A 20 + lane B 15 + lane C 14 + 套件 50 + 集成/重启/证据 3 …；明细见下） |
| tests/integration/p1-06.contract-suite.inmemory.test.ts | **25/25 PASS** |
| tests/integration/p1-06.contract-suite.sqlite.test.ts | **25/25 PASS**（同一套件定义，无调参） |
| tests/integration/p1-06.integration.test.ts | **1/1 PASS**（真实 SQLite 全路径 + 重启等价） |
| tests/restart/p1-06-restart.test.ts | **1/1 PASS**（探针 isP106Ready() 自动启用；逐字段一致） |
| tests/restart/evidence/p1-06-evidence.test.ts | **1/1 PASS**（P1-06-EVIDENCE JSON 证据块，可重复） |
| P1-04 双套件（回归） | **36/36 PASS** |
| P1-05 双套件（回归） | **16/16 PASS** |
| `node dev_docs/verification/validate-docs.mjs` | **12/12 PASS** |
| P1-05 专属文件只读比对 | `git diff d1c6595 a9070e5 -- src/contracts/goal-phase.ts src/contracts/goal-phase-view.ts src/control/goal-reducer.ts` = **0 行** |

## 4. 三路实现与合并

| Lane | commit | 内容 | 验证 |
| --- | --- | --- | --- |
| A Control/Process 面 | 090c3b5 | recordHandoff（run_not_ended/stale_source/not_found/invalid/CAS/幂等）、claimReplacement（lease_active/packet_*/ineligible/CAS 唯一成功/幂等）、HandoffDriveEngineImpl.driveHandoff（not_a_replacement/context_rejected/runtime_error/started） | 20 单测 PASS |
| B Context + Control | ee4405c | HandoffContextCompilerImpl（守卫序/body-first/无 transcript/manifest）、FakeHandoffControlRuntimeAdapter（pause/stop/snapshot/noHiddenContextRead） | 15 单测 PASS |
| C provenance + 重启 | ebe844c | handoffProvenance 双适配器（重建等价/全键隔离/freshness/持久化）+ isHandledEventType 同 commit | 14 单测 PASS |

integrator 修正（基线/套件）：①buildP106ArtifactRef digest 归一为 sha256 hex（尊重严格校验器，不放松）；②runP106ClaimedRun 以 P106 binding 领取（start-run 守卫 4 一致）；③套件纯函数用例补最小 plan snapshot；④late-result 用 A 当前 run revision（after_terminal 守卫决定）；⑤evidence verificationPlanRef.planDigest 合规；⑥B-run 断言语义（starting = claim 后未 start）；⑦控制面套件改用共享替身（与 lane B 单测分离）；⑧normal drive 替换意图在扫描前跳过（scanned 语义）。

## 5. integrator 裁决记录

- **契约与存储语义 7 项**已在 `IMPLEMENTATION-HANDOFF.md`「P1-06 契约与存储语义（冻结）」完整记录（packet 有界/无 transcript 显式；ReplacementAttempt 前提与迟到的 per-run 拒绝；HandoffContext stale 显式与重投影；HandoffControl 最小形状与公开快照；可追溯 reference 链；事件/视图；重启单事务等价）。
- **packet stale 的边界**：v1 无 workspace 推进命令，故"登记后 workspace 变化→packet 变 stale"的端到端无法在真实路由触发；冻结语义以 record(拒绝登记过期包) + assemble(显式 stale_workspace_snapshot/stale_packet) + 纯函数（replacement stale_packet 守卫）三层覆盖；登记后 stale 的完整路径是 P1-10/后续 workspace 演进消费。
- **控制面 lastEventSeq**：RunPort 无 registry/snapshot 访问器；FakeHandoffControlRuntimeAdapter 以 noteRun/注入事件数实现（冻结语义允许），公开报告仍 noHiddenContextRead。
- **冻结复用提醒**：本票不改 P1-03 冻结的 DispatchIntentV1；replacement 的 outbox intent 为 DispatchIntentV1（新 attemptId/runId），packet 引用由 ReplacementAttempt 聚合承载。
- **推送**：local main = a9070e5；**未推送** GitHub origin main（origin 仍在 d1c6595）——按先例需用户授权（P1-04/05 均推过；本票交付后由用户/流程决定）。

## 6. 依赖/下一步

- DAG：T04→T06→T15、T06→G2 均满足（本票完成边）；**G2（Continuity）等待 P1-05 + P1-06 双验收**——已具备。
- 本票不自动开始 P1-15/其他票；P1-07/08 窗口属于 P1-05 之后（本票与 05 并行窗口已结束）。
- 已知取舍：①替换意图经 `pendingDispatchIntents` 与 normal drive 共享扫描（守卫跳过，不计 scanned——语义在 HANDOFF 记录）；②replacement-claim 的 outbox intent 复用 P1-03 形状（无 v2 intent），packet 引用经 ReplacementAttempt 聚合；③outcome_unknown 的"不可逆动作"判定在本票为**保留+不自动重试**（不判定是否可逆——P1-10/后续处置）。
- 冲突日志：`dev_docs/logs/conflict-reports/2026-09-06-p105-p106-merge.md`（含并行流程 5 条教训）。

## 7. 2026-09-06 DAG 注记（追加）

按 [P1 DAG](../planning/proposed/P1-foundation/DAG.md)「2026-09-06 增量规划」，G2（Continuity）= P1-05 + P1-06 + **P1-16**；本票完成 06 侧证据（05 侧由 P1-05 交付，16 侧为新增后置边界）。
