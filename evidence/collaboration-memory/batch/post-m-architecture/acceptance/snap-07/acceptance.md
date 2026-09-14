# S01–S05 M 后结构整理独立验收（snap-07）

验收日期：2026-09-14。

本报告只适用于固定的 snap-07 输入，不外推到 I01–I04 或其他源码版本。验收优先依据原始架构对话，其次依据 `original-conversation-traceability.md`、结构计划、`progress.md`、`S05-HANDOFF.md` 及其引用的实施证据。

## 固定输入复核

| 项 | 独立复核结果 |
| --- | --- |
| HEAD | `ce043a650ecfabd72c55f02695204d58dd9c8b64`，与交接一致 |
| 源码快照 | `final-source-snapshot-07.json`，1368 条目，指纹 `094eb49537e667c46921074f3b15c4077dcef1c60a4bd13371857723b0b09954` |
| 构建快照 | `final-build-snapshot-07.json`，475 文件，指纹 `60b47ef8ec30a4d6dc83d4a34a9870b9daccf978815dc064e36a456fc1db5a1e` |
| 当前源码与快照 | 重新运行源码快照算法：条目数、逐文件哈希、总指纹和 HEAD 均一致，变化 0 |
| 当前 `dist` 与快照 | 475/475 路径一致，逐文件哈希变化 0，总指纹一致 |
| snap-06 → snap-07 delta | 源码新增 0、删除 0、变化 59；构建新增 0、删除 0、变化 38 |
| 构建后源码 | `source-after-build-07-diff.json`：`fingerprintChanged: false`，变化 0 |
| 模块边界 | 当前复核 523 个解析源码、524 个 inventory，`issues: []`；与 `boundaries-snap-07.json` 的边和计数一致 |

本次还直接运行了根 `tsc --noEmit --pretty false`、UI `tsc -p src/ui/tsconfig.json --noEmit`、`node --check src/app/public/app.js` 和模块边界检查，均通过。`pnpm` 包装命令在当前无 TTY 环境中于依赖目录清理前退出，未进入类型检查；直接使用已安装编译器复核通过，这属于运行环境限制，不是产品缺陷。

## AC-S06-01 关闭状态

**CLOSED。** snap-06 报告中的九类具体反例全部复核为零命中：重复的任务身份规则标题、缺失主体、空 `Context-continuity` 标题、拼接的 Work-context 投影标题、双空格缺词、缺失归并对象、缺失时间锚、`规则 把` 和 `后继触发规则 的`。扩大后的“与  的”“不重算  的”“不在  归并结果”“。 之前”“规则 把/的”等机械连接模式也为零命中。

抽查没有只依赖这九个字符串：相同类别的重复中英文业务标题、孤立施工编号、旧 handoff 权威、文件头职责、跨 Module 依赖说明、生产消费者和私有旧票号均按源码语义复读。`ReadModelIndexImpl` 与 SQLite ReadModel 文件头明确投影职责，SQLite ReadModel 的 `dedupeTaskWorks` 依赖说明指向 ControlEngine 的公开纯规则；SQLite StateLedger 文件头描述持久原子命令／事件账本；`CodeGraphPort` 同时说明测试 registry seam 与产品 source-backed 消费者。SQLite ReadModel 的私有 `LEASE_P1_07_PLACEHOLDER_BINDING` 已改为业务名 `LEASE_VIEW_PLACEHOLDER_BINDING`，内存与 SQLite 两个适配器一致。

合法内容未被误判为缺陷：`P112`／`P113` fixture builder 与稳定 fixture API、协议序号、持久幂等 key、SQLite `p111_`／`p114_`／`p115_` schema、`CM-1B-001` notices provenance 仍按兼容或来源理由保留；协议中准确表示“本页无状态变化”的 `no-op` 说明也保留。生产源码没有 `P108`、`P116`、`P118`、Lane A/B/C、旧 handoff、旧 Acceptance/ADR 或 `LEASE_P1_07...` 命名命中。

## 逐项结论

| 工作包 | 结论 | 独立判断与证据 |
| --- | --- | --- |
| S01 全范围归类与接口基线 | **PASS** | 行为—责任—公开接口审查覆盖 12 Module、contracts、Host/composition、UI、storage、tests、scripts 和 vendor 边界。`interface-audit.json` 记录 118 个跨 Module 实现文件，27 个正式 Module interface、84 个 Host composition、7 个 test/fixture，`pending` 为 0。架构检查链明确包含 Agent 报告 → `ArchitectureReview` → 人决定 → 逐 Work 投递／等待／采用；Verification 的 `VerificationService.openIssues`、Reviewer/Verification ports 和真实产品注入点也可由源码反查。目录归属没有被当作行为证据。 |
| S02 Control／Ledger／Dispatch 领域拆分 | **PASS** | CoordinationEngineImpl 对外方法、命令／回执形状和调用顺序稳定；五组完整协调操作各自保留状态读取、权限、版本、提交计划和回执映射。Ledger 89 个声明已按 21 类提交职责组织。Control 的当前状态准入与 Ledger 的提交时 CAS、幂等、形状和竞争复核均存在，Agent、scheduler/system、订阅 owner、响应者和 successor 的权限差异没有合并成万能执行器。协调定向证据为 32 suites／98 tests 全通过，且 snap-07 delta 未改变运行规则。 |
| S03 双 ReadModel 共享规则 | **PASS** | 两个 adapter 共享已证实相同的事件解释；Map mutation、SQL 查询／索引／事务仍各自负责。等价序列与 SQLite 重开、整页事务回滚的 2 例通过，ReadModel 汇总为 19 suites／38 tests 全通过。固定规模覆盖 64／256／1024 事件；共享纯投影不读 SQLite 全库，性能资料明确记录 `DatabaseSync.prepare` 计数和未测物理页的限制。现有测量没有引入 Redis 的依据，未凭技术替换掩盖失效、撤权或不可用语义。 |
| S04 生产能力、队列、大文件、命名注释 | **PASS** | `createProductPlatform` 的 runtime、verification、handoff、continuation、lifecycle、query、workspace reader/capability 均要求显式能力；fixture execution 需显式 opt-in，真实服务走 source-backed reader、真实 runtime 或明确 unsupported/rejected 能力。队列审查逐一覆盖 planning/rework/review、dispatch、execution slots、ordinary/handoff/reviewer in-flight、query、verification、runtime journal、projection/action/background/timer 等结构，重启来源、竞争唯一性和取消三态均指向持久 Ledger/outbox/observation/journal，未发现纯内存结构独占任务权威。大文件保留／拆分依据按业务局部性、接口深度、事务和存储边界说明，没有用减行数或浅转发冒充收敛。规则族复读关闭 AC-S06-01，指定文件头、CodeGraphPort 生产消费者和私有名称抽查通过。 |
| S05 固定版本结构审查与收尾 | **PASS** | 当前源码和 dist 均精确匹配 snap-07；source/build delta 无增删，构建后源码零漂移。snap-07 的 59 个源码变化与 38 个产物变化属于说明性注释、术语补全、一个私有常量业务改名及格式换行；受影响 ReadModel 4 个测试文件 7 例通过，类型、边界和构建证据适用。集中回归没有被重新拼贴为本快照单次全量 PASS；此前全量／sandbox 失败及复验链保持原记录，限定 delta 未要求机械重跑全仓和 UI。 |

## 可复现缺陷

未发现可复现的产品缺陷。AC-S06-01 的旧反例及扩大检查模式均为零命中；当前源码、构建产物、模块边界和定向验证与固定输入一致。

## 未覆盖与接纳边界

- I01–I04 尚未开始；本报告不宣称完整用户流程、跨入口集成或最终产品 UI 全集已在 snap-07 重新执行。
- 本轮未重跑全仓全量和浏览器全集，依据是注释／私有命名限定 delta、逐文件快照复核、构建后零漂移、受影响定向测试及既有失败／复验链。UI 既有条件跳过仍不改写成已覆盖。
- `node:sqlite` 不提供物理页读取计数；性能结论限于已有固定规模推进、查询、算法对照和 prepare 计数。Runtime observation journal 的单 writer 条件仍是已知运行边界。
- 外部真实项目的模型自主质量、图像能力和其他后续产品集成不属于 S01–S05 本次范围。

## 总结

**snap-07：S01 PASS，S02 PASS，S03 PASS，S04 PASS，S05 PASS；总 PASS。** 结论只适用于 HEAD `ce043a650ecfabd72c55f02695204d58dd9c8b64` 与上述源码／构建快照，不替代 I01–I04 验收。
