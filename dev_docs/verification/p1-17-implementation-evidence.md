# P1-17 Implementation Evidence

```yaml
ticket: P1-17
status: verified (limited authorization, 2026-09-06 continuous window)
product_revision: ee53869
shared_baseline: cd754a4
verdict: PASS
```

## 结论
P1-17（完成工作 → 重启/相关新任务继承选材）已验收：**typecheck 0 errors；全量 130 files / 947 tests PASS / 0 skip；契约套件双适配器 6+6；restart 1/1；真实 SQLite 集成 2/2；validate-docs（上轮记录 13/13）。**

## 验收映射（Ticket 6 项 Acceptance）
| # | Acceptance | 验证 | 实测 |
| --- | --- | --- | --- |
| 1 | 正常完成路径产生历史；重启后按 Project/Workspace/工作/模块/接口/版本选材；作者身份不限制接手 | completedWorkView（双适配器；p116 stores 重建）+ runP117SelectionScenario（world 即完成路径）+ restart 等价 | ✅ |
| 2 | 复用 P1-16 记录与 Context 编译；文本/精确引用；不等图索引/无独立 MemoryStore | assembleCompletedWorkContext 从 workContext 视图选材（无新表/无图依赖） | ✅ |
| 3 | 版本化来源提供当前规范/代码快照；缺材料显式 | request.applicableVersions + needs_material(gaps) 分支 | ✅ |
| 4 | 旧前提变化 → 历史/gap 标注；不继承旧授权/旧 phase/旧 Evidence 有效性 | applicability 三态+changedPremises（workspaceRevision 变化→historical_explanation）+ 零写入断言（不写 Task/Goal/Evidence） | ✅ |
| 5 | 缺记录/超预算/跨 scope/权限不足显式；保留原始来源 | no_records/missing_body/over_budget/cross_scope(按 scope 无行)/forbidden_tool_or_scope（writeScope 非空拒绝） | ✅ |
| 6 | P1-05 required 集合与完成规则原样；历史检索不写完成状态 | 零 ledger 写入（selection 前后 observedCursor 不变；无 record 命令调用） | ✅ |

## 边界
本票不完成其他票；P1-09/10 已并行验收推进；Ticket 状态保持 proposed；本地 main 未推送。
