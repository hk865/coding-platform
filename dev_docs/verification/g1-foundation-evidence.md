# G1 Foundation 评价证据（Release Gate）

```yaml
status: evidence-record
evaluated: 2026-09-06
gate: G1-foundation
waits_for: P1-05（已验收；产品根 7664d91）
evaluation_scope: MVP 场景 Step 1 + Plan/Task fixture + Fake Run + Evidence/Goal reducer 与基础重启查询（DAG 门禁定义）
product_revision: 80bc683（P1-16/P1-12 并行窗口基线期间；G1 所覆盖能力自 7664d91 起零改动——见下"适用性"）
verdict: PASS
```

## 评价范围（与 DAG G1 定义一致）

G1 Foundation：Goal/Plan/Run/Evidence/Goal reducer 的持久化重启闭环 = MVP 场景 Step 1（两个隔离 Project/Workspace bootstrap + 同本地 id 复用 + 无隐式 Plan/Task/Run）+ 计划 fixture 接受（TaskHierarchy/RuntimeExecutionDAG/obligations/GateTask）+ Fake Run（唯一 lease + 事件 + 期望）+ Evidence 驱动 Task/Gate 满足 + required 归约 Goal phase + 基础重启查询。

## 证据采集（本记录当日实测；命令与数字）

命令：pnpm vitest run <G1 集：见清单>（product root，commit 80bc683；typecheck 0 errors——基线 97 files/768 tests 已在 7664d91/a597eaf/e150447 三次全量实测）

**实测数字：19 test files / 167 tests PASS（30.04s；零失败零跳过——本集无探针依赖）**；包含 14 个集成文件（p1-00/01/02/03/04/05 的 integration + 双适配器契约套件）与 5 个重启文件（persistent-restart + p1-02/03/04/05-restart）。

## 逐项映射

| 场景要求 | 证据（测试文件 + 断言） | 实测 |
| --- | --- | --- |
| Step 1 空库 bootstrap：版本化 manifest、source digest/revision、≥2 隔离 Project/Workspace、禁止直接插表 | tests/integration/p1-00.integration.test.ts、tests/integration/p1-00-assertions.ts；tests/contract-suite/state-ledger.contract.suite.ts（bootstrap 组；只空库成功/重放/not_empty） | ✅（p1-00 集成 17 项断言 + 套件） |
| Step 1 两个 Project 复用同一本地 workspaceId/goalId，不串范围 | p1-00-assertions（isolation assertions；跨 Project 相同 id 不判重）+ tests/contract-suite/goal-view.contract.suite.ts（isolation 组） | ✅ |
| ControlEngine 原子提交 Goal snapshot/Event；activePlanRevision=null；无隐式 Plan/Task/Run/outbox | tests/control/control-engine.test.ts、tests/integration/p1-01.integration.test.ts；goal-view.contract.suite.ts（no-hidden-plan/run/outbox 组） | ✅ |
| 故障注入：重复 idempotency key + 重启 | goal-view.contract.suite.ts（same-idempotency 组；跨 Project 同 key 互不判重、同 scope 重放幂等）；tests/restart/persistent-restart.test.ts + p1-02/03/04/05-restart.test.ts（close→reopen 逐字段一致） | ✅ |
| 重启后 snapshot load + EventPage 重建一致；查询不越界 | 上述 restart 套件 + tests/read-model/*（goal/plan/run/evidence/goal-phase 投影）+ tests/sqlite-read-model/*（双适配器逐字段一致）+ sqlite-read-model-index.restart.test.ts | ✅ |
| Plan/Task fixture 接受（非空守卫、pins 固定、DAG 合法） | tests/control/plan-acceptance.test.ts、tests/integration/p1-02.integration.test.ts、p1-02.contract-suite.inmemory|sqlite（plan-revision 组：install/activate/pin immutability/guards 全套） | ✅（29+29 tests in sqlite/inmemory suites） |
| Fake Run：唯一 claim（outbox 先行）→ 驱动 → 事实；崩溃≠outcome_unknown | tests/integration/p1-03.integration.test.ts（T1/T2 含真实 SQLite 双 dispatcher 竞争）、tests/control/dispatch-*.test.ts、run.contract.suite.ts、fake-runtime-adapter.test.ts | ✅ |
| Evidence 驱动 Task/Gate 满足；claim 不冒充 PASS；FAIL/STALE 保留 | tests/integration/p1-04.integration.test.ts、evidence.contract.suite.ts（completion claim INCONCLUSIVE 等）、tests/control/evidence-intake.test.ts、tests/read-model/p1-04-verification-projection.test.ts | ✅ |
| required 归约 Goal phase（P1-05 reducer） | tests/integration/p1-05.integration.test.ts、goal-phase.contract.suite.ts（非空/确定性/副作用对账）、tests/control/goal-reducer.test.ts、tests/read-model/p1-05-goal-phase-projection.test.ts | ✅ |
| 基础重启查询（P1-05 前置） | tests/restart/p1-05-restart.test.ts + p1-05.integration.test.ts（重启后 goal phase 逐字段一致） | ✅ |

## 判定与边界

- **PASS**：G1 正式评价 = P1-05 验收产物（7664d91）+ 上述今日实测（80bc683；该集 19 files/167 tests 全通过；所覆盖规格自 7664d91 起零冻结形状变化——P1-16/12 基线仅新增契约，非改动既有；git diff 7664d91..80bc683 -- src/contracts/{command-event,bootstrap,governance,plan,dispatch,evidence,reduction,goal-phase}.ts 为空已核对）。
- **不越界声明**：G1 只证明"持久化重启闭环"基础集。Step 2 的 Reader 并行/Gate 检查属 G3（P1-07+15）；Step 3 换手属 G2（05+06+16）；Step 5 唯一 Writer 属 G3；PASS 门禁第 8/9 条（required 集合 + FAIL/STALE/BLOCKED 不伪装）在本基础集内可证（P1-04/05 套件覆盖），其余门禁条目由后续 Gate 承担——G1 不宣称整体 MVP PASS。
- **适用性**：本记录引用 revision = 80bc683（测试运行日）；若后续产品改动 affected 文件，需要按 MVP 规则重新判断 applicability（revision change → 重新运行本集）。

## 复现

```text
cd /home/han001/projects/agents/agent_platform   # 产品根（workspace）
git rev-parse HEAD                                # 80bc683
pnpm typecheck                                    # 0 errors
pnpm vitest run tests/integration/p1-00.integration.test.ts tests/integration/p1-01.integration.test.ts tests/integration/p1-02.integration.test.ts tests/integration/p1-02.contract-suite.inmemory.test.ts tests/integration/p1-02.contract-suite.sqlite.test.ts tests/integration/p1-03.integration.test.ts tests/integration/p1-03.contract-suite.inmemory.test.ts tests/integration/p1-03.contract-suite.sqlite.test.ts tests/integration/p1-04.integration.test.ts tests/integration/p1-04.contract-suite.inmemory.test.ts tests/integration/p1-04.contract-suite.sqlite.test.ts tests/integration/p1-05.integration.test.ts tests/integration/p1-05.contract-suite.inmemory.test.ts tests/integration/p1-05.contract-suite.sqlite.test.ts tests/restart/persistent-restart.test.ts tests/restart/p1-02-restart.test.ts tests/restart/p1-03-restart.test.ts tests/restart/p1-04-restart.test.ts tests/restart/p1-05-restart.test.ts
# 预期：19 passed / 167 tests；SKIP 0；FAIL 0
```
