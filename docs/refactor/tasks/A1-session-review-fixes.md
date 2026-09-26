# A1 Session 独立审阅返修

保持原 Session 和原五文件写 scope；契约、冻结测试、独立测试只读。两 lane 已导入主工程待审，合并专项 83 项通过，但以下独立反例真实失败，不可据自检通过放弃修复。主审将只读 catalog 实现、组合根、更新后的 R4b fixture 和独立测试刷新进本 lane，不改你的五个候选文件。

1. `A1-session-independent.test.ts`（目前6项）证明：lookupCommit(not_found) 后另一相同请求 archive/close 已提交，当前调用会在“已经归档/已经关闭”等验证处直接拒绝。需要精确回查原 identity 并恢复原 receipt/event；不同 fingerprint 仍冲突。覆盖所有这类事实变更拒绝路径，不每次无条件加查询、不复制当前状态冒充原结果。复用现有 replay 函数。
2. 同一文件证明：target 首个 head 读出 active 后，另一真实 writer 关闭关联，当前结果仍包含该 Session，但返回卡片的 link 已关闭。只检查首次水位不足；后续 lookup、Session 及卡片 links 必须属于同一已声明水位，变化明确 source_stale。复用现有读取，不反复扫描全部关联、不引入全局写锁。
3. Store 按 canonical JSON refKey 的 UTF8 字节排序，当前归并按 raw sessionId 比较不一致。合法ID `!` 与换行符可导致重复；比较 canonical JSON 编码的 ID，复用 RecordStore 的 `compareRefKeys` 或等价现有顺序，不能给既有有效 ID 加新限制。独立排序用例将由主审刷新到该文件。
4. codec 目前把完全相同 target+relation paths 用三个名字注册三次，导致每条关联重复写三份索引。每种 target 只需一个含 relation 的复合索引，三个有序流通过不同 relation 查询值获得。删除重复注册，保持有界游标、页间去重和现有目标发现行为；无需恢复 workspace 全扫。

`session-lifecycle.ts` 头注“唯一 SessionWorkLink writer”应修正为后续关联 writer：初始登记同样合法写关联，二者共享正式规则。

验收使用 next-graph-agent、next-session-directory、next-types、以及你已读取的独立 A1 测试（可 harness exec 固定 vitest 命令，不安装工具）。不能改测试失败为宽松成功；报告真实结果后停止交验。
