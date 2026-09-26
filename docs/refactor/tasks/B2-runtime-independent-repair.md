# B2 Runtime 独审返修

原 implementation 任务和冻结契约继续有效，测试已由 Astra 修订并显式刷新。主审实际检查 26 项：22 通过，4 失败，日志 `docs/refactor/reviews/evidence/next-b2-2026-09-26/runtime-counterexamples-before-repair.log`。这不是自检结论。不要修改测试/fixture或 WorkGraph。

必须修复的实测问题：

1. **Host 授权收窄。** driver 当前把 Host 原始 tools/writeScope 与 manifest 全等比较。Host 许可更宽、Role/正式 Run 已收窄是合法情形；核对 manifest 的权限确实仍在当前 Host 上限且与原正式 Run/Role 约束一致，不要求原始集合全等，也不把新 Host 许可添回本 Run。配置版本/template仍严格。fixture已修正同样的错误投影，禁止照搬固定 template/digest。
2. **重放只观察。** 已 begun/entered/settled 的同一 consumer 重试只核正式身份、固定 Run/claim/Kernel 关联后观察原事实，不先要求当前 Role/Host/root仍能授权新动作。现测试在首个真实 Kernel 执行后撤销 Host，start重放应补记终态且不再次调用provider。另consumer不可接管；伪造Prepared/身份不应变观察旁路。authorize/begin fresh仍按原正式边界。
3. **同实例终态写失败后的恢复。** observer在正式terminal提交前推进reducedThrough，下一调用无新记录就不再生成terminal。保留可重试的原终态来源/边界及稳定提交内容，或在未成功提交时不推进相应缓存；不能依赖新observer或新Kernel事件。重试仍核原Kernel事实，失败不释放，成功才由WorkGraph释放。需要考虑响应丢失和同一请求指纹，不能每次生成新eventId破坏幂等。无需建立第二历史库或无限缓存。原nonterminal尾读应仍增量。
4. **真实 builtin read 拒绝可返回模型。** 冻结Kernel runner已支持 before_tool block→hook_blocked 工具错误，但宿主control Hook adapter只允许continue/pause。主审已从该冻结map精确提取 `vendor/coding-agent/patches/app/composition/control-hooks.ts`，12产物基线逐字再生通过。本次明确扩展scope仅该源+四份对应dist产物。只允许before_tool透传已有block，before_model仍仅continue/pause；after_tool、modify/fail继续unsupported。直接复用原HookExecutor/runner，不暴露raw hook、改调度器或放宽路径授权。更新相应注释/私有包装器命名即可。用既有 `node scripts/build-kernel-patch.mjs --write` 生成，再 `--check`；脚本已只写发生变化的产物，其他8项必须不变。

最终快照已修正长Session boundary、sourceTools.allowedPath/assertCurrent、取消后的reconcileSignal。新增长历史与source搜索反例已通过，保留即可，不能再次宣称这些是当前未修问题。

另落实原冻结输入所有权：prepare/start/observe的调用参数在首await前隔离；可信Host配置的可变数据字段固定成该次调用快照（模型client/函数等能力保持引用，不能structuredClone整个client）；原signal保持。主审尚未为这项报告实测失败，不要误写成已复现。

检查 `next-types`、`next-runtime-driver` 及受影响 `next-kernel-assembly`/history/session集合；组合根仍待接线，两个composition红测不在此scope修。报告真实结果和所有未闭合项后停止。只原地写更新后的scope，禁止测试/共享WG/旧Kernel/全局DSH配置改动。
