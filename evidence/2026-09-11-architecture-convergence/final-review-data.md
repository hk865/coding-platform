# AC-DATA 独立责任与可读性复核

复核者为 AC-VIEW 实现者，未参与 AC-DATA 实现；只读复核当前四处源码与三个新测试，未运行测试。依据 PRODUCT 状态真实性、连续执行及 ARCHITECTURE 数据/Control 责任；不是复述实现者测试结果。

结论：当前代码未发现阻断本次收口的责任或实现回归。三项修复落在现有 Module 内，没有新增存储权威或依赖方向。主Agent须结合实际运行日志完成验收，以下明确证据界限。

| 检查 | 独立推理与当前结论 | 证据边界 |
| --- | --- | --- |
| 旧 SQLite 无 identity_claims | sqlite-ledger.ts 的公开 commit 先 BEGIN IMMEDIATE，commitGeneric 在幂等与CAS之后、beforeWrite和appendEvents之前查询索引；空槽时 legacyIdentityConflict 扫 canonical WorkContextBinding 并使用同一 taskWorkIdentityClaimKey。另一 owner 即零写拒绝。索引与事实写入在同事务内，不存在两连接分别先读到空槽再都提交的读写间隙。 | identity-upgrade.test 只直接证明单连接旧表缺失/单旧身份；未直接运行证明多连接竞争。同步事务机制支持上述判断，但不能把此新test称为多进程实测。 |
| 历史已有重复 | legacyIdentityConflict 对所有旧binding找任何不同owner，不选择胜者。新第三owner被任一旧owner拦下；旧合法幂等重放在该扫描前返回历史回执，不删/改旧事实。不回填假定唯一的赢家，因此历史重复仍可继续由上层解析显式拒绝。 | 新测试没有直接构造两份旧重复；建议补双重复旧库与两连接反例，保留历史事件/回执并证第三绑定零写。现有源码逻辑未见放行。 |
| 内存账本输入/出口别名 | in-memory-ledger.ts:commit 在调用 commitOwned 前 structuredClone(batch)，位于首个await之前；提交回执再clone。load返回快照clone；events返回嵌套事件clone；pendingDispatchIntents对筛选结果clone。调用方不再能经后改输入、读取值或replay receipt改变持久事实，内部CAS与原子写入顺序未改。not_found 的ref引用只关联调用者输入，不暴露已存事实。 | snapshot-isolation.test 覆盖提交未resolve前输入、snapshot/event/receipt/replay/outbox，失败注入仍零写。须由主运行日志确认，不将测试源码当PASS。 |
| 源码读取边界 | WorkspaceSourceIndexReader 仍只读既有WorkspaceSandbox；权限先于I/O。保存选中正文后再读比较revision和content，随后比较同上限目录与truncated；Context selectCodeMaterial 在成功I/O后重读canonical Workspace。实际源码变化责任在WorkspaceReader，canonical适用性在Context，没有把账本读取下沉源码适配。 | 双读只能发现观察到的变动，不是多文件原子快照，也不保证第二次读取之后磁盘再无改动。实现注释/data-changes 已明确，未对未选文件正文做稳定性承诺。新tests用受控实际文件变更覆盖选中正文变化/删除、目录变化及canonical revision推进。 |

可读性：legacyIdentityConflict 是具名旧库兼容步骤，输入clone/输出clone集中公开边界而未散布到每个commit分支；源码稳定性检查集中在返回sourced前，能直接看出检查对象。无机械转发文件、无新增框架。原 role-source-reader/context 文件头仍有较长历史施工注释；不影响当前核心流程，本次可在文档收敛时缩短，不能为此扩大实现范围或删历史证据。

来源：data-changes.md；src/data/state-ledger/{sqlite-ledger,in-memory-ledger}.ts；src/data/workspace-reader/role-source-reader.ts；src/data/context-compiler/role-source-index.ts；tests/ledger/{identity-upgrade,snapshot-isolation}.test.ts；tests/context/role-source-stability.test.ts。读取命令为 Get-Content 与 rg 定位事务、身份槽、structuredClone 和I/O复核点；没有修改以上文件。最终源码身份与实际命令日志由主Agent汇总。

后续证据补齐：独立复核已再次读取更新的 identity-upgrade.test.ts，新增两连接 Promise 调用旧身份冲突，以及两份历史重复身份的完整 snapshot/event/idempotency 保留并拒第三身份反例。上述表中的“新test未覆盖”描述首次复核时点，现已补测试源码。两个连接仍在同线程调用同步 SQLite 事务，不能称为多进程实测竞争；实际执行通过与否继续以主验证日志为准。
