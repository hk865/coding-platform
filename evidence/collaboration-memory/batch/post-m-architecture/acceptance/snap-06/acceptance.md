# S01–S05 M 后结构整理独立验收（snap-06）

验收日期：2026-09-14。

结论只适用于 `final-source-snapshot-06.json`：HEAD `ce043a650ecfabd72c55f02695204d58dd9c8b64`，1368 个源码条目，SHA-256 `0e327e6ea6e26015c1dea2928a7a79617e1199af99f65de0f23e38ded9e7b582`；构建输入为 `final-build-snapshot-06.json`，475 个文件，指纹 `0d79b3d982cab78747efe0f0043de326262e032acaccd6e42edeaf2fa6614128`。I01–I04 不在本次验收范围。

## 总结论

**FAIL，snap-06 不接纳。** AC-S05-01 报告的原六组字符串已经清理，P112／P113 稳定 fixture API、持久 key／schema 和 provenance 的保留边界也成立；S01、S02、S03 继续通过。然而第五轮清理在 StateLedger、ReadModel 和协调代码中仍留下重复规则名、缺失主体与多余空格，且 `control-intents.ts` 保留一个与文件内容不符的空 Context-continuity 标题。它们直接反驳 `naming-comment-fifth-pass-scan.txt` 的“0 actionable matches”，所以 S04 仍不通过，S05 不能接纳本固定候选。

| 项 | 结论 | 独立判断 |
| --- | --- | --- |
| S01 全范围行为—责任—公开接口 | **PASS** | ArchitectureReview 报告→人决定→逐 Work 投递／等待／采用仍作为独立生产行为，触发者、公开操作、失败、权限、顺序、持久权威、恢复和消费者均完整。12 Module 与 118 个跨 Module 实现导入的处置无 `pending`。 |
| S02 Control／Ledger／协调局部性 | **PASS** | 本次没有生产执行规则或接口变化。协调仍以稳定入口承接 5 组完整操作；Ledger 21 类提交责任、Control 受理与 Ledger 提交复核、不同主体权限及竞争差异均保留，没有用浅转发或文件拆分冒充收敛。 |
| S03 双 ReadModel 共享解释 | **PASS** | 本次没有 ReadModel 行为变化。共同事件解释仍无存储状态，Map mutation 与 SQLite 查询、索引和事务仍归各 adapter；等价、重启、回滚、顺序与性能证据继续适用，没有引入 Redis 的依据。 |
| S04 生产默认能力、队列、大文件、命名注释 | **FAIL** | 生产能力显式注入、fixture opt-in、queue／in-flight／wake／journal 审计和大文件判断仍成立；fixture 展示标题也已去掉不必要票号。但是当前生产注释仍有可复现的机械残句与失实标题，全范围语义清理没有完成。 |
| S05 固定源码、集中回归、独立验收 | **FAIL** | 源码、构建及构建后源码可精确复算；28 文件 delta、17 个构建变化和受影响 8 文件 93 测试形成合理的限定验证链。第五轮注释扫描仍被当前源码反例证伪，S04 必交付项尚未完成。 |

## AC-S05-01 关闭复核

**AC-S05-01：CLOSED。** snap-05 报告中的六组精确缺陷均已消失：

- `console projection console` 与 `query/15`；
- `versioned contract 6/8/9/12`；
- `Acceptance 5/6/8` 与 `Acceptance 1`；
- `ADR D1`；
- `small P1 scale`。

复现：

```powershell
rg -n "console projection console|query/15|versioned contract 6/8/9/12|Acceptance 5/6/8|Acceptance 1|ADR D1|small P1" src
```

命令无命中。该精确缺陷关闭，但同类清理仍有新的反例。

## StateLedger、fixture 与保留边界抽查

### StateLedger 职责未被改坏，但注释清理不完整

内存和 SQLite adapter 仍从同一组 `validation/*` 责任函数做提交校验；CAS、幂等、identity claim、route intent materialization 和事务边界没有因本轮注释变更迁移。`validation/governance.ts` 等文件的说明也正确区分 Control 内容准入与 Ledger 事件／快照一致性复核。

不过 StateLedger 当前注释存在 AC-S06-01 的重复词和缺词，`validation/control-intents.ts` 还保留了一个没有任何对应实现的 Context-continuity 标题。因此实现职责成立，命名／注释完成条件不成立。

### fixture 展示文案：符合边界

`dispatch-fixtures.ts`、`plan-fixtures.ts` 和 architecture fixture 的用户可见 title／summary 已改为“派发验收路径”“计划验收路径”“架构职责冲突”等业务文本，不再要求用户理解票号。受影响 fixture/control 测试 8 文件、93 例通过，可覆盖本轮三处运行值变化。

### P112／P113：保留合理

`P112_*`、`buildP112*` 和 `P113_*`、`buildP113*` 是大量契约／重启场景消费的稳定 fixture 导出和测试数据身份。`FakeWorkspaceReaderAdapter` 对 `buildP112BaselineGraph/buildP112CurrentGraph` 的导入只存在于测试／演示 adapter；真实产品入口要求显式 `WorkspaceReader`，app service 使用真实 source reader。`P113` 也只在 architecture-evolution fixture API 和其稳定数据值中出现。它们没有成为生产职责名称，普通改名反而会破坏测试 API 与历史数据定位，因此保留符合审计边界。

## 可复现缺陷

### AC-S06-01：第五轮仍遗漏替换造成的重复词、缺失主体和失实标题

当前源码至少有以下直接反例：

1. `src/data/state-ledger/in-memory-ledger.ts:140`：`任务工作身份唯一性规则 任务身份槽`，规则名和被说明对象机械叠加；
2. `src/data/state-ledger/sqlite-ledger.ts:286`：`任务工作身份唯一性规则 之前形成`，缺少“生效”等连接成分；
3. `src/data/state-ledger/validation/control-intents.ts:9`：空的 `Context-continuity commit validators` 标题后没有任何 validator，紧接着才是本文件真实的 Control-intent 标题；
4. `src/data/read-model-index/sqlite-read-model-index.ts:983`：`Work-context detail-view projection work-context continuation projection`，两个投影标题机械拼接；
5. 同文件 `:3063`：`不重算  的选择规则`，双空格处缺失被限定主体；
6. `src/data/read-model-index/completed-work-merge.ts:34`：`不在  归并结果里的那些`，缺失归并结果名称；
7. `src/control/control-engine/work-identity-resolution.ts:18`：`。 之前可能留下两条`，缺失“规则生效”等时间锚；
8. `src/contracts/dispatch.ts:208` 的 `那正是 工作身份规则`、`src/control/dispatch-engine/work-identity.ts:32` 的 `规则 把唯一性`、`src/control/dispatch-engine/coordination-drive.ts:249` 的 `后继触发规则 的第二个触发点` 均有机械替换留下的多余空格。

复现：

```powershell
rg -n -C 2 "任务工作身份唯一性规则 任务身份槽|任务工作身份唯一性规则 之前|Context-continuity commit validators|Work-context detail-view projection work-context continuation projection|不重算  的选择规则|不在  归并结果|。 之前可能留下|那正是 工作身份规则|规则 把|后继触发规则 的" `
  src/data/state-ledger `
  src/data/read-model-index `
  src/control `
  src/contracts/dispatch.ts
```

这些文件属于当前生产 contracts／Module／adapter，不在 fixtures、testing、持久 key/schema 或 provenance 的允许保留范围。第五轮扫描称其 Broken-connection scan 为“0 actionable matches”，说明固定模式和人工复读仍未覆盖替换后产生的空主体与非相邻重复词。

## 快照、构建与 delta 复核

- 重新运行 `node scripts/source-snapshot.mjs --diff evidence/collaboration-memory/batch/post-m-architecture/final-source-snapshot-06.json`，得到 `fingerprintChanged: false`，`added/removed/changed` 均为空。
- `snapshot-05-to-06-diff.json`：HEAD 不变，无新增／删除，28 个源码文件变化；列表不含 tests、依赖或 lockfile。
- `source-after-build-06-diff.json`：构建后源码相对 snap-06 仍为零差异。
- `build-snapshot-05-to-06-diff.json`：475 个产物路径不变，17 个 JavaScript 文件变化。独立逐文件比较当前 `dist` 与 `final-build-snapshot-06.json`：475／475，新增、删除和变化均为空。
- `boundaries-snap-06.json` 为 523 个解析源码、524 个 inventory 文件、`issues: []`。根／UI typecheck、完整构建、UI build 与冻结锁结果未显示结构回归。
- 本轮 3 个 fixture 文件的用户可见字符串变化已由 8 个受影响测试文件、93 个测试覆盖。其余为说明性 delta；无需把整套回归机械重跑，但限定验证不能替代注释语义验收。
- snap-01 的失败集、bubblewrap 精确复验、后续快照 delta 与 UI 证据链继续适用；没有把历史失败报告拼写为 snap-06 单次全量零失败。

## 未覆盖与接纳边界

- 本次没有重跑全仓全量或 UI 全集；依据固定快照、逐文件构建比较、边界结果、受影响 fixture 测试和源码语义抽查判断。UI 原有 1 条条件跳过仍未被改写为已验证。
- 本次没有把协议约束 1.x／2.x、逐函数 Guard 序号、P112／P113 fixture API、持久 idempotency key、SQLite 表名或 notices provenance 当成注释缺陷。
- 自然语言全目录完备性不能靠几个正则证明。AC-S06-01 已足以判 FAIL；后续修复需以句子和所指实现为单位复读，不能只把这些精确字符串加入下一轮扫描。
- I01–I04、真实外部项目上的模型自主质量、图像能力及其他后续产品集成不由本报告扩张。

修复 AC-S06-01 后必须生成新的源码与构建快照，再做独立复验。snap-06 的 S01–S03 PASS 和总 FAIL 均只适用于本固定候选。
