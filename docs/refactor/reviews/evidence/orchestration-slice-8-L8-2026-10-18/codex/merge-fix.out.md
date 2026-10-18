静态复核完成，未写文件、未运行测试。**租约修复、settle 改动和 P3 可接受；启动开关的范围需先裁定。**

1. **无租约路径已封住。** [host.ts](/D:/cxt/s8l8-merge/src/app/host.ts:537) 屏蔽正式触发，共用登记函数同时保护设置与路由登记，启动重试另查租约。`accept` 自身虽不查租约，但生产环境只有这一处 driver，三个入口均受保护；`requestAutoCapture`、`failAutoCapture` 没有其他生产发起方或 HTTP 入口。其余 `captureSourceChanges` 调用属于人工 owner 操作或源码快照，不会绕过门禁产生自动请求／失败。HL-07 仍允许人工 owner 写入，不能理解为禁止所有写入。

2. **策略读取时机正确，扩展语义尚无充分依据。** [启动判断](/D:/cxt/s8l8-merge/src/app/host.ts:1067) 位于设置恢复、`registerAutomationPolicy` 和核对之后，读到的是恢复后的策略。但 [§12.1](/D:/cxt/s8l8-merge/docs/refactor/STATE-MACHINES-SPEC.md:4033) 约束的是 Workflow／Goal 重驱；§12.10 第 5 步为隔离其新执行计数而关闭开关，并未明确关闭架构重试。[L8](/D:/cxt/s8l8-merge/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:141) 仍承诺下次启动重试。现有 L8 重启测试使用默认 `true`，所以不冲突，也不能证明 `false` 的新行为获准。**需要产品负责人确认开关是否覆盖架构重试，并统一规格。** 此副本规格止于 §12，缺少所指 §13，无法据它消除歧义。

3. **settle 未削弱现有断言。** [helper](/D:/cxt/s8l8-merge/tests/helpers/AG2b-collaboration-fixture.ts:350) 只读公开状态；等待发生在播种／检查定案之后，未放进 restart，也没有删改计数和回执断言。重启后的额外写入仍会超过此前基线，等待不会抹掉它；回放错误触发捕获也仍增加计数。三个退出条件适合作为“本轮已停稳”：无请求、请求已满足、失败已落账。`failed` 仍可 `pending`，不保证以后重启零写入。未发现使用该 seed 后断言捕获仍 pending／running 的测试；相关 L8 用例使用独立夹具。A8-L5、HL-04 保留原时序，但 opt-out 本身不保证一定留下 pending；所报 mutation 结果未独立复跑。

4. **P3 正确。** [fallback 返回后的检查](/D:/cxt/s8l8-merge/src/core/agent-runtime/session-anomaly-facts.ts:204) 补上外层 `await` 的取消窗口，避免内部返回后发生的取消被错误报告为 ready。

必须修复数：1（启动开关范围的产品裁定与规格一致性）。