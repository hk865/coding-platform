# StateLedger

保存正式事实，提供版本冲突与幂等提交语义。内存与 SQLite 两种实现在同一 Module 目录下。

## 源码入口

- 内存实现：[README.in-memory.md](README.in-memory.md)、[in-memory-ledger.ts](in-memory-ledger.ts)
- SQLite 实现：[README.sqlite.md](README.sqlite.md)、[sqlite-ledger.ts](sqlite-ledger.ts)
- [dispatch-selection.ts](dispatch-selection.ts)：两种存储共用待办筛选与公平排序；scope 在 limit 前作用，SQLite 先过滤派发记录再解析。
- [ledger-validation.ts](ledger-validation.ts)：保留现有消费入口；实现按提交职责放入 `validation/`，两种适配器仍共用全部规则。
- [governance-records.ts](governance-records.ts)：只读记录解析（精确 ref/revision/digest，不能更改治理状态）
- [ledger-scope-catalog.ts](ledger-scope-catalog.ts)：canonical 目录（ScopeCatalogPort）

## 边界与接线

原子提交、CAS、幂等、完整性校验、事件/outbox 保存与重开。业务状态变化由 Control 命令驱动；两种实现共享同一状态语义，SQLite 版本支持重开读取。

`governance-records.ts` 是模块公开的治理记录读取入口：调用方取得已提交记录的精确引用、版本和摘要，不导入 Ledger 的存储内部结构，也不能通过该入口改写状态。

`validation/` 是模块内部实现。参与关系看 `participation.ts`，通信分页看 `communication-routing.ts`，等待后继看 `successor-claim.ts`，派发和运行事实分别看 `dispatch.ts`、`run-facts.ts`，身份槽看 `work-identity.ts`。其余文件按治理、计划、证据归约、工作 Context、授权、租约等提交职责命名。修改事务时的约束应在这里维护，不能因为 Control 已做受理检查而省去提交时检查。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/state-ledger.md)。完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/ledger](../../../tests/ledger)（内存）与 [tests/sqlite-ledger](../../../tests/sqlite-ledger)（SQLite）。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。
