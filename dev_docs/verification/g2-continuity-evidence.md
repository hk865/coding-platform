# G2 Continuity 评价证据（Release Gate）

```yaml
status: evidence-record
evaluated: 2026-09-06
gate: G2-continuity
waits_for: P1-05 + P1-06 + P1-16（均已验收）
product_revision: 最新主链（P1-09 实现后；HANDOFF 记录）
verdict: PASS
```

## 评价范围（DAG G2）
G1 能力 + 同工作 Context 连续性（多次模型/工具反馈不新建工作身份）、关键理由增量留痕、A→B 接续（bounded handoff，无 transcript 回放），以及 Step 3 场景：Reader A 部分 Observation/Artifact 后 Context rollover/Run crash → 有界 HandoffPacket → 替换 Worker A2 接续；旧迟到结果不能覆盖新 Attempt；P1-16 增加同工作连续多轮、理由留痕与真实内核接续验证（缺最终总结可恢复、原会话不可恢复显式、未知副作用保留）。

## 实测（本次当日运行）
命令：pnpm vitest run <G2 集>（产品根）——**9 test files / 89 tests PASS（23.42s，0 失败 0 跳过）**。组成：P1-05 集成、P1-06 集成 + 双适配器契约套件 + restart、P1-16 双适配器契约套件 + restart + 真实 SQLite 集成。typecheck 0 errors（全量 135 files / 965 tests PASS 兜底）。

## 逐项映射
| 场景要求 | 证据 | 实测 |
| --- | --- | --- |
| A2 不回放完整 transcript；保留 objective/constraints/unresolved/refs/workspace revision | P1-06 契约套件（packet 有界组：HANDOFF_PACKET_MAX_BYTES、noFullTranscript 校验、未知字段拒绝） | ✅ |
| 旧迟到结果不能覆盖新 Attempt | P1-06 套件（A 迟到事实 after_terminal/stale/duplicate 拒绝；replacement CAS） | ✅ |
| 同工作连续多轮 + 理由增量留痕（P1-16） | P1-16 套件（same-work-multiturn / incremental-note-crash / continuation-fallback）+ 双适配器 | ✅ |
| 缺最终总结仍可恢复 | incremental-note-crash-test（已记录 note 可见、重放幂等） | ✅ |
| 原会话不可恢复 → 显式（took_over/unsupported），未知副作用保留 | continuation-capability-fallback-test（restored 0；unsupported 列 session_restore） | ✅ |
| 真实内核接续验证 + 能力降级证据 | tests/integration/p1-16.real-kernel.continuity.test.ts（1/1；真实 CLI run→中断→resume 同 session，session 持久化，映射 restored_original；模型端点本地替身=显式降级） | ✅ |

## 判定与边界
- **PASS**：G2 原始 05/06 证据 + P1-16 新增连续性证据全部成立（89/89 实测；全量 965 兜底）。旧 P1-06 PASS 只证明原换手范围——本评价分别引用 P1-06 与 P1-16 证据，未混用。
- 不越界：G2 不覆盖 G3（角色协作/唯一 Writer/返工闭环归 07+15）、G4（09+11）、G5（13+14）；本记录仅在"连续性/留痕/接续"能力集合内判定。

## 复现
```text
cd /home/han001/projects/agents/agent_platform && pnpm vitest run tests/integration/p1-05.integration.test.ts tests/integration/p1-06.integration.test.ts tests/restart/p1-06-restart.test.ts tests/integration/p1-06.contract-suite.inmemory.test.ts tests/integration/p1-06.contract-suite.sqlite.test.ts tests/integration/p1-16.contract-suite.inmemory.test.ts tests/integration/p1-16.contract-suite.sqlite.test.ts tests/restart/p1-16-restart.test.ts tests/integration/p1-16.integration.test.ts
# 预期：9 passed / 89 tests
```
