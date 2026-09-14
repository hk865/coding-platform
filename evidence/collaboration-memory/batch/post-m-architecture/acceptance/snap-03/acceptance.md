# S01–S05 M 后结构整理独立验收（snap-03）

验收日期：2026-09-14。

结论只适用于 `final-source-snapshot-03.json`：HEAD `ce043a650ecfabd72c55f02695204d58dd9c8b64`，1368 个源码条目，SHA-256 `f62404c2ca4fb77d05874b503eb9a8dbe64b20e60781b9ca15ebabbba8d16a9e`。I01–I04 不在本次验收范围。

## 总结论

**FAIL，snap-03 不接纳。** S02 和 S03 达到原始要求，但 S01 没有覆盖已存在的完整生产行为，S04 的队列／in-flight／wake／journal 审查与命名注释清理都有可复现反例。S05 的测试失败—修复—delta 链足以继承到 snap-03，但测试链不能代替漏做的全范围架构审查。

| 项 | 结论 | 独立判断 |
| --- | --- | --- |
| S01 全范围行为—责任—公开接口 | **FAIL** | 12 Module 总表与 118 个跨归属实现文件都有静态归类，但生产行为表漏掉 `ArchitectureReview` 报告→人工决定→按目标投递→等待／后继采用链。因此没有对该链的触发者、公开操作、失败、权限、顺序、持久权威和恢复规则作出原始对话要求的完整判断。 |
| S02 Control／Ledger／协调局部性 | **PASS** | `CoordinationEngineImpl` 的稳定入口后面是 5 组具有状态读取、权限、CAS 期望和单次提交的完整操作，不只是浅转发。Ledger 的 21 个 validation 文件以 commit 责任分组，两个 adapter 仍经统一 commit 入口执行事务态复核。Control 的受理检查、Ledger 的提交时竞争复核及参与者／Reviewer／换手权限差异均保留。 |
| S03 双 ReadModel 共享解释 | **PASS** | 共享文件是无存储的事件解释；Map 更新、SQLite SQL／索引／事务／定点查询仍在各 adapter。独立复验通过 adapter 等价、SQLite 重开、同页写入回滚和 64／256／1024 事件性能检查。证据不支持引入 Redis，实施也未引入。 |
| S04 生产默认能力、队列、大文件、命名注释 | **FAIL** | 生产 `createProductPlatform` 的显式能力注入、fixture 默认关闭及大文件保留／拆分理由成立；但队列审查漏了多个生产内存协调结构和整个 `VerificationJournal`，源码中也仍有机械改名造成的断裂注释。“全部”和“全范围清理完成”均不成立。 |
| S05 固定源码、集中回归、独立验收 | **FAIL** | 源码与构建产物都能精确复算；失败集和两个 delta 的适用性成立。但 S01／S04 仍有必交付缺口，因此固定候选不能接纳。 |

## 可复现缺陷

### AC-S03-01：全行为表漏掉 ArchitectureReview 业务链

`behavior-interface-audit.md` 的生产行为表只有“架构检查与决定；InspectionPort → Control architecture decision”，没有记录当前源码的另一条完整行为：

- `ArchitectureReviewEntry.report/decide`；
- `ControlEngine.recordArchitectureReview`；
- `architecture-review-delivery` 与按受影响 Work 建立的 Delivery／Wait／Successor；
- `/api/real/architecture-reviews/view|decide` 真实消费者。

复现：

```powershell
rg -n "ArchitectureReview|architecture-reviews|recordArchitectureReview" src/app src/composition src/control src/data src/interaction
rg -n "ArchitectureReview|architecture review" evidence/collaboration-memory/batch/post-m-architecture/behavior-interface-audit.md
```

第一条命令会显示生产入口、Control／Ledger／ReadModel 与真实 Host 消费者；第二条没有对应行为映射。`interface-audit.json` 只把 `ArchitectureReviewEntry` 和 `architectureReviewView` 的 Host 导入自动归为 composition，不会回答这条业务链的权限、顺序、持久权威和恢复规则。

### AC-S03-02：“所有 queue/in-flight/wake/journal”审查不完整

`queue-responsibility-audit.md` 没有覆盖以下生产结构：

- `ReadOnlyQueryRuntime.starting`；
- `VerificationRounds.starting` 和 `VerificationRounds.running`；
- `ReviewerVerification.operations`；
- `ReworkVerification.running`；
- `VerificationJournal`，包括从 `pending-*.json` 恢复的 `pending` Map。

复现：

```powershell
rg -n "starting = new Map|running = new (Map|Set)|operations = new Map|readonly pending = new Map" src/execution/worker-runtime src/control/verification-engine
rg -n "ReadOnlyQueryRuntime|VerificationRounds|ReviewerVerification|ReworkVerification|VerificationJournal" evidence/collaboration-memory/batch/post-m-architecture/queue-responsibility-audit.md
```

第一条命令可见上述实现；第二条不会找到相应审查行。这些结构不一定是行为缺陷，但在补齐“丢失后恢复来源、竞争唯一性、取消／unknown”三问之前，S04 不能以全范围审查通过。

### AC-S03-03：机械术语清理遗留断裂注释

`src/control/plan-compiler/rework-plan-compiler.ts:388` 当前文本为：

```text
（ 的 triggerSourceIssues），下面逐条核对还会再确认……
```

它丢失了被限定的主体，与 `naming-comment-audit.md` 宣称的“第二轮逐项复核已完成、负责范围剩余命中为空”矛盾。

复现：

```powershell
rg -n "（\\s*的" src
```

## 快照与集中验证复核

- 运行 `node scripts/source-snapshot.mjs --diff .../final-source-snapshot-03.json`，得到 `fingerprintChanged: false`，`added/removed/changed` 均为空。
- 逐文件比对当前 `dist` 与 `final-build-snapshot.json`：475／475，新增、删除、变化均为空。
- `snapshot-01-to-02-diff.json` 仅改一个 ReadModel 白盒测试；`snapshot-02-to-03-diff.json` 仅恢复 `src/ui/pnpm-lock.yaml`。
- 独立解析 `full-regression.json` 得到 39 个失败文件；`full-failures-bwrap-retest.json` 精确包含同一组 39 个文件，无缺失、无额外，229／229 通过。因此原 181 个失败断言的重验集闭合。
- 独立定向运行开始时源码与 snap-03 一致，但运行期间外部修复者已开始写入下一候选源码；因此该次 9 文件运行不用作 snap-03 的接纳证据。其中未配置 bubblewrap 的首轮在 3 文件上出现 38 个 sandbox 失败，指定真实 bubblewrap 后同 3 文件 42／42 通过；这只作为对实施证据中环境归因的辅助印证，不扩大固定测试集。
- 实施没有把 snap-01 的失败全量写成“snap-03 单次全量全绿”，这个口径正确。UI 的唯一失败 DOM 已出现 `TERM_OK`，原断言不变的单项重跑通过；在 snap-02→03 只有 lockfile integrity 精确恢复的前提下，此证据可用于本轮结构验证。

## 未覆盖与接纳边界

- 本次没有重跑整个全仓全量；依据精确差分和全失败文件复验判断适用性。
- UI 仍有 1 个既有条件跳过场景；本报告没有将其改写为已验证。
- ArchitectureReview 链和上述队列／journal 结构的行为并非已判定错误；未覆盖本身就违反本阶段的“全范围”完成条件。
- I01–I04、真实外部项目上的模型自主质量、图像能力与未在本范围开始的产品集成结论均不由本报告扩张。

修复 AC-S03-01–03 后必须生成新源码快照，并由独立验收重新核对差分；本 snap-03 的 FAIL 不能延伸成后续快照结论。
