# S01–S05 M 后结构整理独立验收（snap-05）

验收日期：2026-09-14。

结论只适用于 `final-source-snapshot-05.json`：HEAD `ce043a650ecfabd72c55f02695204d58dd9c8b64`，1368 个源码条目，SHA-256 `91da6320532dccca4d8c6f15d363dd5a1f8c1eee57d1df96ed0d82ae943d88e2`；构建输入为 `final-build-snapshot-05.json`，475 个文件，指纹 `0ab997acc254eccb8fad016a8e4fda9de35b7e73bd9dfc5bce606421ca0cb0ba`。I01–I04 不在本次验收范围。

## 总结论

**FAIL，snap-05 不接纳。** snap-04 报告的 AC-S04-01 四类反例已经修复，后继 Run 生产接线、订阅范围固定和 UI 能力说明也与实现一致；S01、S02、S03 继续通过。然而全目录反查仍能在生产源码中找到重复业务词、机械编号尾片和以旧 Acceptance／ADR 编号代替当前规则名的注释，直接反驳第四轮证据所称“重复词、施工编号无生产命中”。因此 S04 仍不通过，S05 不能接纳本候选。

| 项 | 结论 | 独立判断 |
| --- | --- | --- |
| S01 全范围行为—责任—公开接口 | **PASS** | ArchitectureReview 报告→人决定→逐 Work 投递／等待／采用仍作为独立行为，触发者、公开操作、失败、权限、顺序、持久权威、恢复和消费者均完整。12 Module 总表与 118 个跨 Module 实现导入仍有明确处置，无 `pending`。 |
| S02 Control／Ledger／协调局部性 | **PASS** | 本次没有运行表达式或接口变化。`CoordinationEngineImpl` 的稳定入口仍由 5 组完整操作实现，Ledger 仍按 21 类提交责任校验；Control 受理、Ledger 提交时复核、参与者／Reviewer／换手权限和竞争差异没有被浅转发或拆文件抹平。 |
| S03 双 ReadModel 共享解释 | **PASS** | 本次没有 ReadModel 行为变化。共享部分仍是无存储状态的共同事件解释，Map mutation、SQLite SQL／索引／事务／定点查询留在各自 adapter；等价、重开、回滚、顺序和 64／256／1024 事件性能证据继续适用，没有引入 Redis 的依据。 |
| S04 生产默认能力、队列、大文件、命名注释 | **FAIL** | 产品装配、fixture opt-in、全部 queue／in-flight／wake／journal 和大文件判断仍成立；三项点名的内容性注释也已核实。但生产源码仍有明确的机械替换残片和旧施工编号，说明“全范围语义复读完成”不成立。 |
| S05 固定源码、集中回归、独立验收 | **FAIL** | 源码、构建和构建后源码可精确复算，95 文件源码 delta 没有测试／依赖路径，38 个构建变化与保留注释的 JavaScript 相符；既有失败—修复—delta 链可继承。但第四轮注释扫描被当前源码反例证伪，S04 必交付项尚未完成。 |

## AC-S04-01 关闭复核

**AC-S04-01：CLOSED。** snap-04 报告中的四类精确反例均已消失：

- `Architecture inspection Architecture inspection` 已改为单一标题；
- `architecture evolution/14` 已改成实际的 architecture evolution；
- ArchitectureInspection 的孤立验收计数已删除，`Authority` 现在指向 Module 文档和 `ARCHITECTURE.md`；
- `from a architecture inspection proposal` 已改成语法完整的说明。

复现：

```powershell
rg -n "architecture inspection Architecture inspection|architecture evolution/14|architecture evolution ArchitectureEvolutionPolicy|from a architecture inspection" src/contracts
```

命令无命中。该精确缺陷关闭，但新的全目录反例见 AC-S05-01。

## 三项内容性抽查

### 后继 Run 生产接线：符合实现

- `src/app/service.ts:175`–`:191` 在真实 Host 路径把 `real.runtime` 作为 `runtimePreparation`，并提供 `workspaceRootFor`，随后调用 `createProductPlatform`；
- `src/composition/persistent-platform.ts:577`–`:583` 只有两项能力同时存在时才注入 `successorPreparation`；
- `src/control/dispatch-engine/dispatch-engine.ts` 在 Context 与 Work identity 成功后、`authorizeRuntimeEntry` 和 `runtime.start` 之前调用该准备入口；`unavailable`／`not_restartable` 均零启动并形成可见失败；
- `successor-run-preparation.ts` 从 admission、前驱持久 RunSpec、精确权限和宿主 workspace root 重建输入，并拒绝重启 running／terminal／unknown Run。

因此当前注释所述“真实后继先准备、无法诚实重建则不启动”与生产代码一致。

### 订阅范围固定：符合实现

- 新 route intent 以 `scopeMode: "canonical_active"` 请求账本事务固定当前 canonical 活跃订阅集合；旧空范围 intent 的兼容边界仍明确保留；
- `CoordinationDrive` 首页提案给出整轮候选 `subscriptionScope`，续页复用 intent 已固定范围，不重新按当前扫描另选；
- `subscription-routing-operations.ts` 在首页把声明范围固定下来，续页要求逐字节回声，并逐项复核成员、revision、分页前进和 `hasMore`；
- Ledger validation 再复核 scope、分页位置和同事务下一页 intent。

因此“首页固定、翻页不变、旧空范围单独兼容”的说明与实现一致。

### UI 能力说明：符合实现

`src/ui/README.md` 已不再声称架构、独立 Reviewer、返工、记忆、续跑和语义查询均未接通，而是要求以当前模块状态和固定验收为准。UI client 和 feature 代码中可找到对应 architecture review、reviewer verification、rework、memory、continuation、semantic query 和 exploration 入口；当前 README 没有把这些现有能力写成未实现。

## 可复现缺陷

### AC-S05-01：全目录语义复读仍漏掉机械残片和施工编号

当前生产源码至少有以下反例：

1. `src/contracts/console-views.ts:74` 写成 `console projection console is a PASSIVE deterministic face`，同一业务名重复；下一行 `:76` 的 `they belong to query/15` 是与 snap-04 `architecture evolution/14` 同类的旧编号尾片；
2. `src/interaction/human-collaboration/human-collaboration.ts:81` 再次出现 `console projection console query group`，`:85` 用无来源的 `versioned contract 6/8/9/12` 代替当前只读边界名称；
3. `src/control/control-engine/run-facts.ts:6` 仍写 `Acceptance 5/6/8`；
4. `src/control/control-engine/policies/task-eligibility.ts:8` 仍写 `Acceptance 1`；
5. `src/control/dispatch-engine/work-identity.ts:63` 仍以 `ADR D1` 指代当前返工身份规则；
6. `src/control/control-engine/remediation.ts:51` 仍以 `small P1 scale` 描述当前扫描规模。

其中 1–2 是直接的机械替换损坏，3–6 是证据明确声称已清除的运行代码施工编号。它们均位于生产 contracts／Module 实现，不属于允许保留的 fixtures、持久 idempotency key、SQLite schema 或 `contracts/notices` provenance。

复现：

```powershell
rg -n -C 2 "console projection console|query/15|versioned contract 6/8/9/12|Acceptance 5/6/8|Acceptance 1|ADR D1|small P1" `
  src/contracts/console-views.ts `
  src/interaction/human-collaboration/human-collaboration.ts `
  src/control/control-engine/run-facts.ts `
  src/control/control-engine/policies/task-eligibility.ts `
  src/control/dispatch-engine/work-identity.ts `
  src/control/control-engine/remediation.ts
```

`naming-comment-fourth-pass-scan.txt` 仍报告 0 matches，说明其扫描／人工复读覆盖不足。最明显的 `console projection console` 和 `query/15` 已足以否定“重复业务标题与施工编号无生产命中”，无需把合法的协议约束 1.x／2.x、Guard 顺序、持久 key 或表名计作缺陷。

## 快照、构建与 delta 复核

- 重新运行 `node scripts/source-snapshot.mjs --diff evidence/collaboration-memory/batch/post-m-architecture/final-source-snapshot-05.json`，得到 `fingerprintChanged: false`，`added/removed/changed` 均为空。
- `snapshot-04-to-05-diff.json`：HEAD 不变，无新增／删除，95 个源码文件变化；列表不含 tests、依赖或 lockfile。
- `source-after-build-05-diff.json`：构建后相对 snap-05 仍为零差异。
- `build-snapshot-04-to-05-diff.json`：475 个产物路径不变，38 个保留注释的 JavaScript 文件变化；独立逐文件比较当前 `dist` 与 `final-build-snapshot-05.json`，475／475，新增、删除和变化均为空。
- 既有根／UI typecheck、冻结锁安装、完整构建、UI build 六步和模块边界证据与纯说明性 delta 相符；本次未发现 delta 中混入接口、测试或依赖路径。
- snap-01 的 39 个失败文件与 bubblewrap 复验的 39 个文件精确相同，229／229 通过；snap-01→02、02→03、03→04、04→05 的差分链均保留。该链足以继承运行验证，但不能代替当前注释内容审查。

## 未覆盖与接纳边界

- 本次没有重跑全仓全量或 UI 全集；对说明性 delta 采用固定快照、逐文件构建比对、现有静态结果和定向源码核对。UI 原有 1 条条件跳过仍未被改写为已验证。
- 本次没有把协议约束 1.x／2.x、逐函数 Guard 序号、持久 idempotency key、SQLite 表名、fixtures 或 notices provenance 当成旧施工编号；它们有当前规则或兼容意义。
- 全目录自然语言没有可机械证明的完备性。AC-S05-01 的直接反例已经足以判 FAIL；后续修复仍需按目录人工复读，不能仅把这七个搜索串加入正则后宣称完成。
- I01–I04、真实外部项目上的模型自主质量、图像能力和其他后续产品集成不由本报告扩张。

修复 AC-S05-01 后必须生成新的源码与构建快照，再做独立复验。snap-05 的 S01–S03 PASS 和总 FAIL 均只适用于本固定候选。
