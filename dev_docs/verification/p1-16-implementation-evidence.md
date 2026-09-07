# P1-16 Implementation Evidence：同工作 Continuity、理由留痕与接续

```yaml
ticket: P1-16
status: verified (limited authorization, 2026-09-06 continuous window — P1-09..P1-17 + G1..G5)
product_revision: fa9389d (P1-16 lane A+B merged)
shared_baseline: a597eaf
verdict: PASS
```

## 结论

P1-16（同工作多轮连续性 + 关键理由增量留痕 + 显式接续能力/结果）已按共享基线→并行 lanes→integrator 合并的流程完成并全量验收：
**typecheck 0 errors；全量 852 tests PASS / 23 skip（23 = P1-12 骨架按 isP112Ready 探针自动跳过，属预期）；P1-16 契约套件双适配器 16+16 PASS；restart 1/1；真实 SQLite 集成 3/3；真实内核接续证据 1/1；validate-docs 13/13。**

## 验收映射（Ticket 7 项 Acceptance）

| # | Acceptance | 验证（文件/断言 + 实测） |
| --- | --- | --- |
| 1 | 多次模型/工具反馈不逐次新建工作身份；Run/工作关联/ContextBundle 区分 | tests/contract-suite/context.continuity.contract.suite.ts same-work-multiturn-test（绑定一次；W1 单 run 多事实；W2 coordination 跨双 run：binding.linkedRunRefs=[aWork, laterRun]）+ tests/control/work-record.test.ts（14）——✅ |
| 2 | 理由在关键检查点增量保存、正文先落库引用后登记；重复提交幂等；缺总结仍可恢复 | incremental-note-crash-test（note1/note2 可见、重放 replayed、异身份 CAS 拒绝）+ bounded-note-tests（bodyRef/无 transcript/大小上限/未知字段拒绝）+ tests/read-model/p1-16-work-context.test.ts（顺序/重建等价/隔离）——✅ |
| 3 | 原会话继续/恢复能力显式声明；能力不足的新 Run 接续或拒绝可观察；不伪装原进程存在 | continuation-capability-fallback-test（capabilities sessionRestore=false 诚实；took_over+unsupported(["session_restore"]) 均可见；restored_original 数量=0）+ tests/runtime/context-continuation-adapter.test.ts（6）——✅ |
| 4 | Context 组装保留约束/理由/未解项/来源；材料缺口显式；大小有界 | tests/context/work-context-compiler.test.ts（10：ready/needs_material/rejected/bounded/无模型调用）+ tests/contract-suite/…stale-lease-and-context-test（run_not_in_work/already_linked）——✅ |
| 5 | 旧 lease/授权/版本/迟到反馈沿既有 guards；不改变 CompletionPolicy | stale-lease-and-context-test + 既有 P1-03/06 套件零回归（full 852）；work-record 守卫零改动 Goal/phase——✅ |
| 6 | P1-03/06 兼容映射；P1-04 评审隔离不被覆盖 | 上游全量零回归（852 含 p1-03/04/05/06/07/08 全套）；boundary——✅ |
| 7 | 真实 coding-agent 适配路径多轮+接续验证 + 能力降级证据 | tests/integration/p1-16.real-kernel.continuity.test.ts（真实 CLI run→中断→resume 同 session→完成；真实会话持久化 77824B；映射 restored_original；模型端点为本地 SSE 替身，证据见输出块）——✅ |

## 集成裁决记录（integrator）

1. validator 缺陷（baseline）：`validateBindWorkContextCommand` 校验 `payload.roleBinding` 而非 `roleBindingRef`（lane A 报告；共享面缺陷归 integrator）→ 已修（validation.ts，与消费者同通知）。此前该缺陷使绑定路径全 invalid，套件按探针 skip 掩盖——修复后探针转 true 并全绿。
2. 合并统一：workContext() 组合视图（lane A binding/notes + lane B continuations，recent-first、WORK_CONTEXT_VIEW_MAX_CONTINUATIONS 有界）、isHandledEventType 并集（4 事件）、存储命名统一（p116Bindings/p116Notes/p116ContinuationRows；sqlite 三表）。
3. continuation 投影 scopeKey 修正：必须与 binding/notes 同键（canonicalJson(完整 ref)）——lane B 初版用非 ref 键导致组合视图查不到；已统一。
4. harness readModel 注入 WorkContextCompilerImpl（lane B deps 可选 readModel；共享面接线归 integrator）——assembly 从 ReadModelIndex 选材，永不启动模型。
5. restart 骨架 runtime 修正：P1-16 场景依赖 P1-08 runtime（createP108ScenarioRuntime）——探针自动启用。
6. 真实内核证据设计（见 HANDOFF 注释）：测试内启动真实 CLI + 本地 SSE 端点；turn1 中断（SIGKILL 留 open turn）→ resume 同 session → 完成；**这是"模型端点替身 + 真实内核应用路径"的显式降级证据**（无 provider 凭证时；真实密钥路径记录为能力差异，不伪装）。

## 命令与复现

```text
cd /home/han001/projects/agents/agent_platform && git checkout fa9389d
pnpm typecheck                          # 0 errors
pnpm vitest run                         # 852 passed | 23 skipped (P1-12 骨架 isP112Ready=false)
pnpm vitest run tests/integration/p1-16.real-kernel.continuity.test.ts   # 真实内核证据 1/1
node ../doc_root/dev_docs/verification/validate-docs.mjs   # 13/13（于 doc_root）
```

## 边界

- 本票不完成 P1-16 之外任何票；P1-09/10/17 的窗口已解锁（首次同时满足 blocked_by），按 DAG 下一窗口推进。
- Ticket 状态保持 proposed（开发流程依据本 Evidence 更新）；本地 main 未推送 GitHub（需用户授权）。
- 无 Findings；无隐藏 control/QueryJob/Planner side effect；无新增 Module；不改 P1-00..P1-08 冻结形状（git diff 7664d91..fa9389d -- src/contracts/{command-event,bootstrap,governance,plan,dispatch,evidence,reduction,goal-phase,handoff,workspace-lease,integration,patch}.ts 为空）。
