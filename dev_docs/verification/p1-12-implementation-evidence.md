# P1-12 Implementation Evidence：CodeGraph Delta → Finding → DecisionBrief / CandidateProposal

```yaml
ticket: P1-12
status: verified (limited authorization, 2026-09-06 continuous window — P1-09..P1-17 + G1..G5)
product_revision: 4ecc517 (P1-12 lane A + B merged; LANE-A 投影由 integrator 补齐)
shared_baseline: e150447
verdict: PASS
```

## 结论

P1-12（WorkspaceReader.ReadPort / ArchitectureReconciler.InspectionPort / VerificationEngine.CodeGraphPort 首冻结 + inspection/delta/finding/brief/proposal 全链）已验收：
**typecheck 0 errors；全量 121 files / 914 tests PASS / 0 skip（全部探针转 true）；契约套件双适配器 9+9；restart 1/1；真实 SQLite 集成 3/3；validate-docs 13/13。**

## 验收映射（Ticket 10 项 Acceptance + 2026-09-06 扩展）

| Acceptance | 验证 | 实测 |
| --- | --- | --- |
| 报告型 finding 无 raw Delta 合法；禁止伪造 | tests/contract-suite/architecture.contract.suite.ts reported-conflict-without-delta-test（deltaRef null、source=interface_report、material/ambiguous）+ tests/control/architecture-reconciler.test.ts（8） | ✅ |
| CodeGraphSnapshot/Delta/Finding 绑定 Workspace/Plan/baseline revision | applyP112（reconciler 守卫）+ fixtures；view 组合按 scopeKey+planRef | ✅ |
| pin 缺失/悬空/digest 不匹配 → fail closed + 诊断，无伪 Delta/Finding | architecture-reconciler.test.ts（plan_pin_missing / baseline_unresolved / baseline_digest_mismatch） | ✅ |
| Delta 只含机械差异，无裁决 | raw-delta-purity-tests（noVerdict:true；added/removed/modified 仅） | ✅ |
| Finding 分类/风险/置信度/来源/建议；结构/性能/权限/运行证据来源 | finding-classification-tests + validateArchitectureFinding 校验器 | ✅ |
| 无 raw Delta 也可形成 Finding | reported-conflict-without-delta-test | ✅ |
| material/ambiguous → DecisionBrief（原始理由/影响/选项/风险/延后） | fixtures brief + record 命令测试 + 套件 brief 断言 | ✅ |
| candidate 从精确 source baseline + 选中 delta/option + 规范化内容确定性派生；digest 记录 | candidate-proposal-derivation-test（proposalDigest 64hex + sourceBaselinePin 精确）+ candidateProposalDigest 纯函数 + record digest_mismatch 拒绝 | ✅ |
| 相同输入产生相同 raw Delta | deterministic-codegraph-fixtures（computeArchitectureDelta 同输入同 JSON） | ✅ |
| 无 RemediationTask/migration Gate/BaselineActivation 副作用 | 集成裁决：inspect 仅经 record commands；tests/control/architecture-reconciler.test.ts 断言零 install/activate/commit | ✅ |

## 集成裁决（integrator）

1. lane B v2 实现 record commands + brief/proposal 投影；LANE-A read-model 区域（inspection+finding 投影 + isHandledEventType）由 integrator 在合并时按 lane B 声明的组合契约补齐（p112InspectionRows/p112FindingRows + architecture_inspection_rows/finding_rows；与事件注册同 commit）。
2. scopeKey：architecture 视图键 = consoleWorkspaceKey(canonicalJson({projectId, workspaceId}))——与 lane B 视图/cursor 契约一致；planId 过滤按 intent.planRef；无引用 brief/proposal 以 synthetic 展示条目呈现（只展示不判定）。
3. 视图 freshness：observedCursor null → not_ready；无行 → not_found；有行 → ready（lane B 设计、积分裁决确认）。
4. lane A 建议记录：①reconciler 的 deltaRef 使用 fixture 引用（未 body-first 计算 delta）——**登记欠账**：P1-13/14 物化前复核是否需真实 vault delta（下游消费按 ref 读取，语义一致；欠账不阻塞本票）；②codeGraph 端口未被 inspect 消费（fail-closed 经 workspaceReader）——等价性成立（共享注册表），登记说明；③默认机械 fixture 的 finding 非 material → 机械路径不产 brief/proposal（报告路径产出 brief）——套件条款由 record 命令路径覆盖，登记说明。

## 命令与复现

```text
cd /home/han001/projects/agents/agent_platform && git checkout 4ecc517
pnpm typecheck              # 0 errors
pnpm vitest run             # 121 files / 914 tests PASS（0 skip；P1-12 探针全启用）
node <doc_root>/dev_docs/verification/validate-docs.mjs   # 13/13
```

## 边界

- 本票不完成 P1-13（remediation）或 P1-14（activation）；二者消费本票产物（classified-architecture-finding / decision brief / candidate proposal），P1-13 已解锁（blocked_by=12）。
- Ticket 状态保持 proposed；本地 main 未推送 GitHub（需用户授权）；无旧验收记录改动。