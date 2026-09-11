# AC-DATA 修复记录

依据 tickets.md AC-DATA 与主 Agent 恢复后明确独占范围。恢复时先读当前源码；未覆盖暂停期修改的 role-source-index.ts、tests/control/work-identity-uniqueness.test.ts。角色/技术选型/公开依赖未改变。

## 实际修复

- WorkspaceReader 的 role-source-reader 在返回 sourced 前重读实际选中的有界正文，比较内容及 revision，再比较同容量的有界目录清单与 truncated。删除、变更或不可读返回现有 unavailable 分支，原因明确 stale。没有添加新的协议分支，也没有对未返回文件声称内容稳定。该算法检测可观察变动，不提供多文件原子快照；原路径拒绝规则、正文容量和历史来源算法保留。
- SqliteStateLedger 在已持有 BEGIN IMMEDIATE 的提交中，若身份槽缺失，则从 canonical WorkContextBinding 检查同一权威身份key是否有另一owner。拒绝发生在 beforeWrite 和任何事实写入之前。不选择旧冲突的胜者，不删除历史，不把创建空索引当作迁移完成。命令重放仍优先返回原幂等回执；现有槽继续走原快速查询。
- InMemoryLedger 在公开 commit 入口复制输入，在回执出口复制结果；load/events/pendingDispatchIntents 返回独立值。复制在首个 await 之前捕获提交内容，原私有提交校验、CAS、beforeWrite、追加顺序不变。快照、事件、幂等回执与outbox不再透出可修改的内部引用。
- Context I/O 后 canonical Workspace 复核由主 Agent 协调写入 role-source-index.ts；本 Agent 提供相关行为测试但不覆盖共享修改。

## 新测试

| 文件 | 行为 |
| --- | --- |
| tests/context/role-source-stability.test.ts | 稳定读取、正文改动、删除、无正文目录变动、I/O期间canonical revision推进 |
| tests/ledger/identity-upgrade.test.ts | 模拟旧schema无identity_claims表，重开后第二身份零写拒绝，旧快照/事件/幂等不变，不相关任务仍可建立；两连接竞争提交均拒绝；既有两条旧身份完整行保留和重放，第三身份拒绝 |
| tests/ledger/snapshot-isolation.test.ts | 在提交Promise返回前修改输入；修改读出的快照/事件/receipt/replay/outbox；故障注入仍零写 |

未运行安装、pnpm或全仓测试。主首次 targeted-tests.log 暴露旧库测试导入名错误（identityKeyFor并非导出），已改用SQLite Adapter同一 ledgerIdentityKeyFor；原失败日志保留。随后按主明确授权用现有WSL执行 `node node_modules/vitest/vitest.mjs run tests/context/role-source-stability.test.ts tests/ledger/identity-upgrade.test.ts tests/ledger/snapshot-isolation.test.ts`，实际 **3文件/11测试通过**（15.30s），原始日志 data-tests.log。默认沙箱WSL曾E_ACCESSDENIED，使用require_escalated经自动审批后运行，未改环境。类型检查与原唯一身份/角色材料/账本契约回归由主统一记录。早期pnpm环境失败原文保留 audit-data-tests.log，不能当测试通过。

## 写入身份

写前 SHA256：role-source-reader.ts=6eab75c3c1e8539d0ce4873c80014dcb7c11fabdc7dd591fcaeb79977c8ffa3b；sqlite-ledger.ts=c1660e9ff4fd75c2b39f2c858cc28cab3ca32b36602c23eb1b0557e2dceaffb2；in-memory-ledger.ts=4ce7f81cd3ab1cee8031184bcd5d4f7fbd1d7b009ffbb36b093dfd273b5f3876。

初次提交验证时 SHA256：role-source-reader.ts=d360e5a9298955404cf9b68d8b92174045324e84a73a55d7f3d198b14560dd70；sqlite-ledger.ts=c874c528f17f0a01fe129a050c3c60da63aafa8bb03a7c7b9e53347d0e10f02b；in-memory-ledger.ts=7066364b2484008141996f27888a4b4e39d263683c0aa5ba1d6dacd98332fc87。完整最终身份由主汇总。

独立复核仍待其他执行者完成。本记录是实现说明，不自行宣告验收。
