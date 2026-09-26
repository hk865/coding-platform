# R4a 原 Session 最终返修：恢复版本检查与存储自污染

主 Agent 已实际复跑上轮14项、完整204项都通过，但不接受你新增的 paused requireWorkspaceRevision:false：恢复重新捕获baseline，后续consistency检查不能追回暂停期间的变化。禁止为旧测试放宽恢复不变量。

Sol 已补独立对照并给出第三个明确骨架：recovery-contract.ts/resolveRecoveryWorkspaceOptions(workspaceRoot,databasePath,options?)。现有两个函数实现保留；新增helper暂throw，等待你填实。写范围仍为原8文件。冻结新测试现在7项，总r4a17项；新的strict同root源码修改与数据库同目录user.txt修改必须拒绝，内置SQLite正常等值恢复并保持usage 1→2必须成功。独立测试、类型、getter仍不可写。

最小方案（不再自行替换策略）：
1. 删除 requireWorkspaceRevision:false 和相应可选分支，真正paused恢复与willContinue同样核对原config、workspace identity/reference/revision。Core recover无environment只投影paused的既有用法保留。
2. 在现有app recovery-contract填 resolveRecoveryWorkspaceOptions 纯机械helper；两个组合根在创建 WorkspaceSandbox 之前共用该helper。path.resolve/relative计算已配置databasePath相对workspaceRoot位置；只在严格位于root内且不是root本身时追加数据库文件、-wal、-shm、-journal四个精确相对路径。outside root不新增。复用WorkspaceSandbox导出的 DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PREFIXES，选择 caller.snapshotIgnoredPrefixes ?? DEFAULT，不改变调用方显式覆盖默认的语义，保留其余options，去重，不忽略任何父目录/整个data。不复制snapshot算法、默认常量，不新增文件/模块。consistencyMode仍按现有config装配顺序。
3. 新turn/checkpoint持久化构造后实际生效ignore值；run/resume必须一致。旧无原约束的继续执行仍拒绝，旧terminal/无字段checkpoint仍可读。不要改写历史正文，不在执行时跳过不一致约束。
4. 删除 INTEGRATION 与代码中“不检查暂停期间文件变化而后续边界会检查”的错误说明，记录仅精确配置SQLite文件不进入revision（不改变read/write权限），同目录普通文件仍核对。

执行 r4a、r4a-regression、kernel-types、kernel-architecture；不build。其他有效修复保持，遇到真实契约不足报告路径和失败原因，不能再以放宽检查取得通过。无需子agent。最终报告包含真实结果并直接给出；等待主 Agent验收。
