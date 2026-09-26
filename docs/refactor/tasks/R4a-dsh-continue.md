继续原R4a任务。上一轮由主Agent主动暂停以补齐骨架，不是模型失败。无需重新调查，进入实现。

主Agent已审定并同步：
1. WorkspaceSandbox.maxFileBytes getter 和 ProcessSandbox.effectiveOptions getter 已由Sol实现、类型检查通过并冻结只读。读取实际生效值构造EffectiveRecoveryConstraints，不复制默认值/路径过滤算法。精确8个实现文件写权限不变。
2. 唯一Turn选择算法放在现有core/runtime/recovery/recovery-coordinator.ts命名导出纯函数（结构型target），recover直接使用；app/composition/recovery-contract.ts的selectRecoveryTurn薄委托该函数，app不得让Core反向import app。type文件固定。resume和Coordinator都用同一选择，不复制算法。
3. 更新说明已在docs/refactor/tasks/R4a-sol-skeleton.md，其他原任务要求继续有效。

按原提示用Python/Node原地写允许文件；check.py r4a / r4a-regression / kernel-types / kernel-architecture 是现成验收能力。完成真实修复并运行；不要只返回建议。新语义与旧回归有具体矛盾时给精确测试/路径，不能改冻结标准。
