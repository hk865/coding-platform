# Wave-2 items dropped by the 10-20 refresh (DONE/GONE)

- T1-006 DONE: tests/work-graph/A2-gate-chain-facts.test.ts:213; src/core/work-graph/state/verification-machine.ts:913 — 旧无链根用例已删除，不能按旧行号删除当前 FIX 路径。
- T1-027 DONE: tests/work-graph/R3e-reverify.test.ts:442; tests/work-graph/R3e-reverify.test.ts:466 — 旧无链根重验例已删除。
- T1-035 DONE: tests/work-graph/S1-provenance.test.ts:2; tests/work-graph/S1-provenance.test.ts:97 — 指定五例及旧前置已删除，当前只剩 SV14。
- T2-057 DONE: tests/state/S1-session-archive.test.ts:166; tests/state/S1-session-archive.test.ts:185 — UT08后直接接UT49，UT09和UT10已删除。
- T2-058 DONE: tests/state/S1-session-archive.test.ts:12; tests/state/S1-session-archive.test.ts:31 — S_PLAIN及相关SessionRef导入已删除。
- T3-005 DONE: tests/app/AG2b-collaboration.test.ts:167,169,390,487 — 四处均已使用显式通信字段。
- T3-015 DONE: tests/app/S5-decision-routes.test.ts:271 — RT07已使用显式通信字段。
- T3-022 GONE: tests/app/orchestration-mechanism.test.ts:169,181; src/contracts/core/session-message.ts:38 — 旧兼容行已消失；现在181行的通知用例不能删。
