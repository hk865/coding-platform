# 测试脚手架清单（CM-1A-001 端到端测试与 I01/I02 复用依据）

来源：本批第 3 次有界只读调查。用途：避免每写一个测试就重新发明 harness 接线。
**本文件不是 Ticket，也不是通过证据。**

## 1. 三条最关键的结论

1. **全仓没有「持久 SQLite harness + 真实内核 Runtime」的组合**（对同时含 CodingAgentRuntime 与
   createPersistentSqliteHarness 的文件做全量扫描，零命中）。CM-1A-001 若要断言「真实 Control + 真实
   SQLite + 真实内核 + 确定性 ModelClient」的端到端链，需要**新写这个夹具**（骨架见 §2 路线 B）。
2. **全仓没有在 ModelClientPort 层注入 error/truncated/cancelled 事件的替身**
   （model-client-port.d.ts 的 error:{code,message,retryable} 变体从未被测试产出）。provider 失败目前
   只能靠 HTTP 桩（tests/app/model-settings.test.ts 覆盖 7 类分类码）。I01/I02 若要覆盖「模型报错 → 宿主终局」，
   需要新增可编程 client 替身。
3. **跨进程竞争有现成配方**：tests/control/work-identity-uniqueness.test.ts:278-326 的
   RC-03 场景 3（同一 SQLite 文件两条独立连接、两个引擎实例、零共享进程内状态）。A04 应直接照抄。

## 2. 三条装配路线（按断言对象选）

| 路线 | 组成 | 现成骨架 | 适合断言 |
| --- | --- | --- | --- |
| A 全产品 HTTP 路径 | 真实 HTTP 宿主 + 真实 SQLite + 真实内核 + 确定性 ModelClientPort | tests/app/semantic-collaboration-fixture.ts、tests/app/semantic-query.test.ts、tests/app/verification-round-fixture.ts | HTTP 契约、真实工具副作用、会话恢复、重启后账本重放 |
| B 不起 HTTP | 真实 Control + 真实 SQLite harness + 真实内核 Runtime + 确定性 ModelClientPort | **不存在，需新写**；90% 可从 tests/control/work-material-gate.test.ts:68-133 抄 | 治理→claim→派发→材料投递→模型首请求的细粒度中间态 |
| C 脚本化 runtime | 真实 Control/Dispatch + 真实 SQLite + P108ScenarioRuntime（脚本化 fake） | tests/contract-suite/p1-08-harness.ts:112-131；167 处用例在用 | 状态机、重启、故障注入（**不是**真实内核证据） |

## 3. 重启 / 重开 / 隔离的现成 helper

| 用途 | 位置 |
| --- | --- |
| persistent harness 的 close() / reopen(options?) / cleanup() | src/harness/persistent-harness.ts:399-406（声明）、:751-768（实现） |
| 同一 SQLite 文件两条独立连接 | tests/control/work-identity-uniqueness.test.ts:278-326 |
| 原始连接重开 + 旧实例拒用 | tests/sqlite-ledger/sqlite-ledger.restart.test.ts:101-109 |
| HTTP 宿主重启（同 data 目录重建） | tests/app/real-runtime.test.ts:45、tests/app/verification-round-fixture.ts:105、tests/app/semantic-collaboration-fixture.ts:164,212 |
| harness 层重启 | tests/control/rework-drive-harness.test.ts:235-244、tests/control/role-spec.test.ts:462-465、tests/control/source-architecture.test.ts:66 |
| 真跨进程宿主 | tests/restart/material-source-process.mjs:22-34 |
| 直读 canonical 账本（绕过读模型） | tests/app/semantic-collaboration-fixture.ts:111-116（node:sqlite readOnly + json_extract） |

## 4. 故障注入现成手段

| 手段 | 位置 | 用法 |
| --- | --- | --- |
| InMemoryLedger({beforeWrite}) | src/data/state-ledger/in-memory-ledger.ts:101-104 | 原子写前抛错 = 模拟崩溃；验证零写与回滚 |
| SqliteStateLedger({beforeWrite}) | src/data/state-ledger/sqlite-ledger.ts:128-139 | 事务内第一次 SQL 写前抛错 → 整事务 ROLLBACK 且 commit() reject |
| runtime outcome_unknown 注入 | src/execution/worker-runtime/coding-agent-runtime.ts:88 | 直接写一份 status:'running' 的 journal 记录再 init()；范例 tests/runtime/runtime-observation-journal.test.ts:73-93 |
| 契约面 outcome_unknown 事实 | src/fixtures/dispatch-fixtures.ts:399-448 | 不走 runtime 直接落账 RunFact |
| lease 过期 | tests/control/workspace-lease.test.ts:56-57,110-114 | 固定时钟 + expiresAt < NOW |
| 真实租约冲突（活宿主同库第二连接） | tests/app/reviewer-recovery-fixture.ts:28-70（holdConflict() / releaseConflict()） | 真实 WorkspaceLeaseEngineImpl 抢写租约 |
| provider HTTP 失败分类 | tests/app/model-settings.test.ts:11-43,66-72 | 401/404/429/503/html/无终止/超时 → 7 类产品分类码 |
| provider 挂起 / 401 | tests/app/real-runtime.test.ts:17-18 | model==='hang' 不响应；'bad-key' 回 401 |
| 一次性持久边界中断 | tests/app/semantic-collaboration.test.ts:13-26 | vi.spyOn(ControlEngineImpl.prototype,'applyPlanChange') 抛错 |
| 提交内容被篡改 | tests/control/reviewer-work.test.ts:72-76 | 包装 ledger.commit 剔除快照/事件 → 断言 invalid_commit 且零部分写 |
| 确定性运行终局 | src/fixtures/dispatch-fixtures.ts:466-488 | FAKE_RUNTIME_SCRIPT_COMPLETED/CRASHED/BUDGET_EXHAUSTED_V1 |

## 5. 禁止进入生产路径的测试替身

tests/contract-support/testing/ 的 4 个（ScriptedControlEngine、ScriptedReadModelIndex、
ScriptedStateLedger、FakeHandoffControlPort）与 tests/support/legacy-work-context-seed.ts 的
seedLegacyWorkContextBinding **全部禁止**进入生产：它们绕过真实守卫、CAS 与事务边界，进入生产等于删掉
唯一性／幂等／零写的判定点。依据 tests/contract-support/README.md:1-5；已核实 src/ 零引用。

**必须如实声明的另一类**：src/testing/check-providers.double.ts（DETERMINISTIC_CHECK_PROVIDERS、
FAKE_REVIEWER_PORT）与 src/testing/sequences.ts（createDeterministicDeps）**仍在生产组合根上**
（两个 harness 未注入时就用它们）。写结论时必须写清「默认检查/评审是确定性替身，不等于真实工具或模型验证」
（src/testing/README.md:3-5）。

## 6. 状态

**只读调查结论，未实施、未验证。**
