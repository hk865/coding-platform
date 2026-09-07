# P1-02 Implementation evidence

```yaml
ticket: P1-02 (PlanRevision accepted → Plan/Task View)
date: 2026-09-05
status: implementation verified — acceptance evidence for P1-02 only
scope: 有限授权：仅 P1-02；不代表 P0/P1 已验收通过，不自动推进 P1-03
product_root: /home/han001/projects/agents/agent_platform
ticket: ../../planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md
handoff: <product root> IMPLEMENTATION-HANDOFF.md
```

## 结论

P1-02 落地并通过可执行验证：**Governance install/activation**（immutable CompletionPolicyRevision / ArchitectureBaselineRevision，Project per-kind active refs + CAS）、**ApplyPlanRevision**（schema→引用解析→非空 guard→结构/无环→原子接受，固定 pin）、**Plan Graph / Task Detail 双 Adapter 投影**（freshness not_ready≠not_found、重建等价、全键隔离）与 **SQLite 重启等价路径**（bootstrap→install×2→activate×2→CreateGoal→applyPlan→commit→close→reopen→canonical refs/pins/视图逐字段一致）。**本文件只证明 P1-02；P1 DAG 仍为 proposed，P0-06 仍为 in_review。**

## 已执行命令与结果（product_root，integrator 本人执行）

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS，0 errors（strict NodeNext + exactOptionalPropertyTypes） |
| `pnpm vitest run`（全量） | **29 files / 283 tests PASS**（P1-00/01 基线 158 零回归 + P1-02 新增 125：governance 套件 12×2 + plan 套件 17×2（InMemory+SQLite 双接线）、lane A 23、lane B 22、lane C 16、集成 4、重启路径+证据 2、…） |
| `pnpm vitest run tests/integration/p1-02.contract-suite.inmemory.test.ts` | 29 PASS（governance 12 + plan 17） |
| `pnpm vitest run tests/integration/p1-02.contract-suite.sqlite.test.ts` | 29 PASS（完全相同的套件定义；无单独调参） |
| `pnpm vitest run tests/integration/p1-02.integration.test.ts` | 4 PASS（真实 SQLite 全路径，无 fake） |
| `pnpm vitest run tests/restart/evidence/p1-02-evidence.test.ts` | 1 PASS，stdout 打印 `P1-02-EVIDENCE` 确定性 JSON 块（可重复命令） |
| `node dev_docs/verification/validate-docs.mjs` | 12/12 PASS |

静态证据（product_root/src）：
- 原始 SQL 写语句（INSERT/UPDATE/DELETE/CREATE TABLE）出现在 `src/sqlite-ledger/`、`src/sqlite-read-model/` 之外的文件数：**0**；
- `node:sqlite` 消费者排除两个 Adapter 目录后：**0** 个文件；
- `tests/contract-suite/state-ledger.contract.suite.ts`、`goal-view.contract.suite.ts` 自共享基线（7f72599）**零修改**——SQLite 与 InMemory 通过原来完全相同的既有套件；
- `package.json` / `pnpm-lock.yaml` / `tsconfig.json` / `vitest.config.ts` 与共享基线**零差异**（零新增依赖；node:sqlite 延续）。

## 重启证据块（可重复命令：`pnpm vitest run tests/restart/evidence/p1-02-evidence.test.ts`）

```json
{
  "commitCursors": { "bootstrap": "c0000000004", "installCompletionPolicy": "c0000000005", "installArchitectureBaseline": "c0000000006", "activateCompletionPolicy": "c0000000007", "activateArchitectureBaseline": "c0000000008", "createGoal": "c0000000009", "applyPlan": "c0000000010" },
  "pins": { "completionPolicy": { "ref": { "aggregateType": "CompletionPolicyRevision", "projectId": "proj-alpha", "policyId": "policy-completion-mvp", "revision": 1 }, "digest": "4680201b5cb8e4807db836eaaf8fbfc78ec565134e0a40cf20a5f813b309186e" }, "architectureBaseline": { "ref": { "aggregateType": "ArchitectureBaselineRevision", "projectId": "proj-alpha", "baselineId": "baseline-architecture-mvp", "revision": 1 }, "digest": "19a578923f4fc100e37ef3f907d23a4d945e8825c653b7c467cf8712d1db7a8b" } },
  "goalSnapshot": { "activePlanRevision": { "aggregateType": "PlanRevision", "projectId": "proj-alpha", "planId": "plan-mvp-1" }, "revision": 2 },
  "restart": { "observedCursor": { "before": "c0000000010", "after": "c0000000010" }, "canonicalMatches": true, "planGraphMatches": true, "taskDetailsMatch": true, "pinsMatch": true, "goalViewActivePlanMatches": true }
}
```

## Acceptance 逐项对照（P1-02；以票据 Acceptance 列表为准）

| # | Acceptance 项 | 证据（测试/产物） |
| --- | --- | --- |
| 1 | 两 fixture 显式 schema version/revision/identity/digest；缺失/无效拒绝且不用内置内容 | `COMPLETION_POLICY_FIXTURE_V1`/`ARCHITECTURE_BASELINE_FIXTURE_V1`（schemaVersion 1/identity/revision/content）；`governanceContentDigest`(JCS+SHA-256)；集成 A1（revision=0→invalid、digest mismatch→digest_mismatch 零写入）；契约套件 12 项 |
| 2 | install 持久化 digest/revision 精确匹配的 immutable revision；同 identity/revision 不可覆写；重启后内容与 ref 可解析 | 套件 install roundtrip（load deep-equal）、immutable（异命令→revision_conflict 零写入）、replay；集成 A1；重启证据 canonicalRefs/pins 一致；无内置内容（无 fallback 路径） |
| 3 | activation 只接受已安装精确 target；expected Project revision CAS；悬空/digest mismatch/竞争失败不移动 active ref | 套件（dangling→not_found、digest mismatch、stale CAS→revision_conflict+active 保持）；集成 A3（revBefore 不变断言）；lane A activate 10 项 |
| 4 | active ref 按 kind 独立；无 ArchitectureEvolutionPolicy active ref | 套件 per-kind independence（policy 激活后 baseline 仍 not_found）；`KNOWN_EVENT_TYPES` 无 ArchitectureEvolutionPolicy 事件；集成断言 |
| 5 | 满足全部非空 guard 的 PlanRevision 被原子接受并成为 Goal active revision | plan 套件 full path（goal snapshot revision 2 + activePlanRevision + 单 PlanRevisionAccepted 事件）；集成 A5…A13 |
| 6 | 只接受能从 canonical active refs 解析 identity/revision/digest 完整匹配的 effective refs，精确 pin 固定 | plan 套件（unresolved_governance_ref 零写入；pins deep-equal）；`resolveProjectCompletionPolicy/ArchitectureBaseline` 只读三元匹配；重启证据 pins |
| 7 | Project 默认 ref 移动不改变既有 pin；改 pin 只能新建 PlanRevision/PlanRebase | plan 套件 pin immutability（安装+激活 rev2 后 pin 仍 rev1）；集成 A4…A13（active 移到 rev2、pin 不变；无改 pin 命令） |
| 8 | 缺失/悬空/内容不匹配/CAS 窗口变化 → 零写入拒绝，无内置 fallback | 套件相应用例 + 集成（全部断言事件数不变）；handler 无任何默认值语义 |
| 9 | ≥1 required executable Task、active required GoalGateTask、required obligation；Task↔obligation 映射；obligation→required VR 非空 | plan 套件每个 guard 一测（含 VR kind ∈ policy.requirementKinds、policy minimum=1）；`applyPlanGuardIssues` |
| 10 | parent_of 只进 TaskHierarchy；depends_on 只进 RuntimeExecutionDAG；Stage 不自动生成依赖 | 契约类型隔离（两字段分属两类型）+ plan 套件（hierarchy/DAG 各自结构校验；无自动边逻辑） |
| 11 | 空 required、缺 active required GoalGateTask、悬空边、环被拒绝且无部分写入 | plan 套件 7 个拒测（全部 zero-write 断言）；DAG/hierarchy 环 + 自依赖 + 悬空 |
| 12 | 重复命令幂等；旧 expected revision CAS 拒绝 | 套件（install/activate/applyPlan replay→committed/replayed 原结果；异 fingerprint→conflict）；plan 套件 stale CAS→revision_conflict；集成 |
| 13 | 重启重放后 Plan Graph、Task Detail 与 active revision 一致 | 重启路径（reopen 后全新 ReadModel 重放持久 EventPage → graph/taskDetails/goalView 与重启前 toEqual）；证据块 matches=true |
| 14 | 不产生 dispatch outbox、TaskAttempt 或 AgentRun | `outboxIntents=[]` 全部 commit；集成 A14 事件流精确 10 项（无 TaskAttempt/AgentRun/outbox 字样）；契约套件事件类型集合断言 |

## 技术决策（记录于产品根 HANDOFF “P1-02 契约与存储语义”）

- LedgerCommit 扩展：新增 governance-install / governance-activate / plan-revision 三个 commitKind（沿用 P1-00 版本化记录先例，v1 语义不变）；Shared validator（ledger-validation.ts）供 InMemory+SQLite 共用，杜绝双 Adapter 语义漂移。
- Immutable revision：identity=(projectId, policyId|baselineId, revision)，contentDigest=JCS+SHA-256 全 fixture；ref 解析 identity/revision/digest 三元精确匹配；不可覆写由 CAS@0 + 幂等（同 identity+fingerprint 重放优先）实现。
- Activation：只接受已安装精确 pin；CAS = Project@expected + 按 kind active aggregate@expected（比纯 Project CAS 更强，防同类并发覆盖）；active ref 按 kind 独立；无 ArchitectureEvolutionPolicy。
- Plan：手写 hand-authored fixture；Guard 顺序 schema→refs→非空→结构/无环→原子提交；pin=接受时解析出的精确 ref+digest，后续 default 移动不改变；plan-revision batch 除 CAS 外由 event(携带完整 snapshot+goalAggregateRevision)/snapshot/expected 对齐校验（ReadModel 重放唯一来源）。
- 幂等键纪律：公共 fixture 的默认 idempotencyKey 不区分 command 种类；契约测试/重启路径对同一 Project 的【不同】命令一律显式传独立 key（与 P1-00 “同 identity 异 fingerprint=conflict”语义一致）——这不是契约缺陷，是 fixture 使用纪律；已在共享套件中三处修正。
- ReadModel：PlanRevisionAccepted → goal 行刷新 + planGraph 行 + 每 task 行；freshness 与 goal() 一致（not_ready≠not_found）；重建等价与全键隔离沿用 P1-01 语义；unsupported_event_type 保留为未来防线。

## 汇合方式（隔离 worktree 四路并行 → main 合并）

- lane A（install/activate）`p1-02-lane-a` @ 9700b75；lane B（ApplyPlanRevision）`p1-02-lane-b` @ 3512ae4；lane C（ReadModel 投影）`p1-02-lane-c` @ 6d50a47；lane D（重启证据）`p1-02-lane-d` @ e009f8b；integrator 依次 merge（36fcd05/1bff90c/a2f2d08/205ec44），随后接线双 Adapter 契约套件、编写真实 SQLite 集成测试。
- integrator 修复（并入主基线）：① plan.contract.suite freshness 断言对齐冻结语义（无 atLeastCursor+无行→not_ready；覆盖后缺失→not_found）；② 幂等键碰撞 3 处（governance 套件 CAS stale、plan 套件 setupHarness CP/AB 激活与 rev2 激活、重启 fixtures install×2/activate×2 改独立 key）；③ 空 requirementKinds 上移共享校验器（契约级 invalid）；④ verifyP102AfterRestart active-ref 语义修正（与激活前 ref 比较而非与 plan pin 比较——两者在 default 移动场景应不同）；⑤ plan 事件 payload 增加 goalAggregateRevision（视图刷新 + ledger 对齐校验）；⑥ plan 套件事件类型集合修正（bootstrap 每 project/entry 各发一事件，共 10 项）。

## 未解问题与后续

- 无阻断项。已知取舍：① `validatePlanRevisionCommit` 将 goalSnapshot.revision 固定为期望+1（=2），P1-02 单次接受语义成立；multi-plan/rebase 需放宽（P1-11 消费者处理）；② PlanRevisionReceipt 的 revision_conflict 未携带 currentRevision（契约类型未定义，如需由后续票扩展）；③ 幂等键纪律见上（默认 key 不区分 command 种类，fixture 使用者须显式给 key）。
- 推送／部署未发生；remote 已配置未推送（需用户授权）。
- **停止**：P1-02 完成（有限授权内）。不自动推进 P1-03；本文件不构成 P1 验收。