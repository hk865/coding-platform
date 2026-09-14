# S01–S05 M 后结构整理独立验收（snap-04）

验收日期：2026-09-14。

结论只适用于 `final-source-snapshot-04.json`：HEAD `ce043a650ecfabd72c55f02695204d58dd9c8b64`，1368 个源码条目，SHA-256 `d8b466e5662a6ffd054ea3aedacc7820e3048e4132bee5e8f4f07fa089e8d20f`；构建输入为 `final-build-snapshot-04.json`，475 个文件，指纹 `9520ebc9791956847a1fc1472f2dff14469690ae80282d7412e0fc5113d07659`。I01–I04 不在本次验收范围。

## 总结论

**FAIL，snap-04 不接纳。** snap-03 的 ArchitectureReview 行为漏审和 queue／journal 漏审已经补齐，原断裂注释也已修复；S01、S02、S03 达到原始要求。可是 snap-04 的注释清理又留下了可直接复现的机械替换损坏，证据中的“第三轮 0 命中”只证明所列正则没有命中，不能证明全范围注释审查完成。因此 S04 仍不通过，S05 不能接纳该固定候选。

| 项 | 结论 | 独立判断 |
| --- | --- | --- |
| S01 全范围行为—责任—公开接口 | **PASS** | 新增的 ArchitectureReview 行已把 Agent 报告、人工决定、逐 Work 投递、受影响 Work 等待／后继采用作为独立生产行为列出，覆盖触发主体、公开操作、输入与失败、权限差异、执行顺序、持久权威、重放／重启和真实消费者。12 Module 总表与 118 个跨 Module 实现导入的逐项处置仍完整，无 `pending`。 |
| S02 Control／Ledger／协调局部性 | **PASS** | snap-04 没有运行语义变化。源码仍以稳定的 `CoordinationEngineImpl` 入口承接 5 组完整协调操作，内部操作包含状态读取、权限、CAS 期望和单次提交；Ledger 仍按 21 类提交责任校验，两个 adapter 通过统一提交入口做事务态复核。Control 受理、Ledger 最终复核、参与者／Reviewer／换手权限和竞争差异均保留，没有用浅转发或拆文件冒充收敛。 |
| S03 双 ReadModel 共享解释 | **PASS** | snap-04 没有 ReadModel 变化。共享部分仍是无存储状态的共同事件解释；Map mutation、SQLite SQL／索引／事务／定点查询仍归各自 adapter。既有等价、SQLite 重开、事务回滚、顺序和 64／256／1024 事件性能证据适用于本次纯注释 delta；没有引入 Redis 的测量依据，也没有引入 Redis。 |
| S04 生产默认能力、队列、大文件、命名注释 | **FAIL** | 产品装配要求显式能力、fixture 默认关闭和大文件保留／拆分判断成立；补充审计也已覆盖 Query runtime、Verification 四类内存协调状态及完整 VerificationJournal，并逐项说明恢复、唯一性、取消／unknown。可是当前源码仍有重复标题、残缺历史标签、孤立 Authority 条目和英文语法错误，直接反驳“全源码命名与失实注释清理完成”。 |
| S05 固定源码、集中回归、独立验收 | **FAIL** | 固定源码和构建可精确复算，snap-03→04 的 13 文件 delta 及构建差分支持其为注释变更，既有失败—修复—delta 测试链仍适用；但集中验证的注释扫描未覆盖本报告反例。由于 S04 的必交付项未完成，固定候选不能接纳。 |

## snap-03 缺陷关闭复核

### AC-S03-01：CLOSED

`behavior-interface-audit.md:50` 已把 ArchitectureReview 报告→人决定→逐 Work 投递／等待／采用单列。该行明确：

- `reportArchitecture`、`ArchitectureReviewEntry.report/decide`、`recordArchitectureReview` 和 intent claim／settle 的责任链；
- 真实 Run、Plan／baseline／workspace、proposal digest 等输入约束，及只有人可决定的权限；
- 决定先落账、再产生 intent、claim 后投递、受影响 Work 再等待／后继采用的顺序；
- Review／Decision／Intent／Delivery／Wait 的持久权威、幂等重放、重启恢复、lease／CAS 和 unknown；
- `persistent-platform`、app service、`CoordinationDrive` 和 view 的真实消费者。

这不再与普通 ArchitectureInspection 基线检查合并为一句概述，达到原始对话要求。

### AC-S03-02：CLOSED

`queue-responsibility-audit.md:17`、`:24`–`:29` 已分别记录：

- `ReadOnlyQueryRuntime.starting/cancelled`；
- `VerificationRounds.starting/running`；
- `ReviewerVerification.operations`；
- `ReworkVerification.running`；
- `VerificationJournal.pending` 及 checks／rounds／reviews／candidates／attempts／`checkFiles`。

每一项都回答内存结构丢失后的持久恢复来源、竞争唯一性守卫，以及取消、完成、中断和 unknown 不能由 Map／Set 成员关系推断。独立广搜还复核了 `RuntimeDispatch.reconciliations`、Durable／Dispatch wake、Runtime observation 写队列、service queues 和 Runtime records；审计已经包含或明确排除不保存待执行工作的派生缓存／单次扫描 Promise。没有再找到与原缺陷同类的遗漏。

### AC-S03-03：CLOSED，但产生新的 S04 缺陷

原 `rework-plan-compiler.ts` 的 `（ 的 triggerSourceIssues）` 已改成 `（返工触发来源的 triggerSourceIssues）`，原缺陷关闭。关闭该精确残句不等于第三轮全范围清理通过；当前候选存在下面的新反例。

## 可复现缺陷

### AC-S04-01：第三轮注释清理漏掉机械替换损坏

当前 snap-04 至少有以下四类反例：

1. `src/contracts/architecture-inspection.ts:2` 为 `architecture inspection Architecture inspection contracts`，同一名称重复；
2. 同文件 `:37` 为 `facts for architecture evolution/14`，把业务名与旧编号尾部拼成无定义标签；其 `Authority:` 下 `:9` 只剩 `(7 verification groups, 10 Acceptance items ...)`，对应权威路径被移除，成为孤立说明；
3. `src/contracts/architecture-evolution-policy.ts:2` 为 `architecture evolution ArchitectureEvolutionPolicy contracts`，业务名和类型名机械叠加；
4. `src/contracts/modules.ts:256` 为 `from a architecture inspection proposal`，英文冠词错误。

复现：

```powershell
rg -n "architecture inspection Architecture inspection|architecture evolution/14|architecture evolution ArchitectureEvolutionPolicy|from a architecture inspection|Authority:|7 verification groups" src/contracts/architecture-inspection.ts src/contracts/architecture-evolution-policy.ts src/contracts/modules.ts
```

`naming-comment-third-pass-scan.txt` 的“0 matches”采用的是 `（\s*的`、`按\s*[，。]`、`沿用\s+之前`、`//\s*：` 和旧 freeze 标签等固定模式。这些模式没有覆盖重复业务名、被删来源后的孤立括号、`/14` 尾片和英文语法损坏。因此扫描本身可复现为 0 命中，但其范围不足以支持“全范围完成”的结论。

## 快照、构建与 delta 复核

- 重新运行 `node scripts/source-snapshot.mjs --diff evidence/collaboration-memory/batch/post-m-architecture/final-source-snapshot-04.json`，得到 `fingerprintChanged: false`，`added/removed/changed` 均为空。
- 独立逐文件比较当前 `dist` 与 `final-build-snapshot-04.json`：475／475，新增、删除和变化均为空。
- `snapshot-03-to-04-diff.json` 只有 13 个源码文件，均为 contracts 或 `rework-plan-compiler.ts` 的注释清理。独立比较 snap-03 与 snap-04 的构建 manifest，475 个路径不变，只有保留 JSDoc 的 `control/plan-compiler/rework-plan-compiler.js` 哈希变化；这与“无运行表达式、接口、测试或依赖变化”的 delta 说明一致。
- 重新运行 `node scripts/check-module-boundaries.mjs`：523 个解析源码文件、524 个 inventory 文件，`issues` 为空。
- snap-01 的 39 个失败文件与 bubblewrap 复验的 39 个文件精确相同，229／229 通过；snap-01→02 只改一个 ReadModel 白盒测试，snap-02→03 只恢复 UI lockfile integrity，snap-03→04 只改注释。该链足以把既有运行验证适用于 snap-04，但不能代替注释内容本身的全范围审查。

## 未覆盖与接纳边界

- 本次没有重跑全仓全量或 UI 全集；对纯注释 delta 采用固定快照、构建逐文件比较、边界检查和既有失败集闭环。UI 原有 1 条条件跳过仍未被改写为已验证。
- 本次没有对所有英文／中文注释运行自然语言语法证明；AC-S04-01 的直接反例已经足以否定“全范围清理完成”。修复时仍需人工复读 13 个变化文件，不能只扩大几个正则后宣称完成。
- 本报告没有把历史证据、持久 key／schema、fixtures 或 vendor 中为兼容／provenance 保留的旧名称误判为生产命名缺陷。
- I01–I04、真实外部项目上的模型自主质量、图像能力及其他尚未开始的产品集成不由本报告扩张。

修复 AC-S04-01 后必须生成新源码与构建快照，再由独立方检查精确 delta；snap-04 的 S01–S03 PASS 和总 FAIL 均只针对本固定快照，不能直接延伸到后续候选。
