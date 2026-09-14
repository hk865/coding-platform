# 原始对话要求追踪表

权威输入：[2026-09-14 原始对话](../2026-09-14-post-c-architecture-conversation.md)。本表是 S01–S05 的主验收清单；结构计划只负责安排顺序，静态扫描只负责提供代码线索。状态为 `未完成` 时不能以工作包、文件移动、行数下降或测试通过替代。

| 原始对话要求 | 要解决的实际问题 | 完成判据 | 当前证据与状态 |
| --- | --- | --- | --- |
| 从架构图开始：业务行为 → 负责 Module → 对外 Interface → 内部 Implementation | 目录归属不等于行为归属；调用方可能直接拼版本检查、材料选择、事件构造和提交步骤 | 全部生产行为记录触发者、责任 Module、Interface 的输入/结果/失败/权限/顺序、持久权威、恢复规则和真实调用方；跨 Module 实现导入逐项判定为正式 Interface、组合根装配或需要收口 | **snap-04 待独立复验。** snap-03 独立方发现 ArchitectureReview 链漏项；[behavior-interface-audit.md](behavior-interface-audit.md) 已把报告→人决定→逐 Work 投递／等待／采用单列为完整生产行为。118 个静态导入裁决仍无 pending |
| 十二 Module 内按共同维护的业务职责归组 | 平铺文件与巨型文件使修改等待、通信或投影规则时必须理解无关代码 | 协调至少按参与、请求、订阅/投递、等待/后继组织；账本校验按提交职责；小而清楚的 Module 可说明后保留平铺 | **S02 已实施，snap-03 独立 PASS。** Ledger 21 个职责文件；coordination records 6 组；Control 的纯 admission 与 mailbox 已形成内部边界；drive 保留单一状态机的依据见 [large-file-responsibility-audit.md](large-file-responsibility-audit.md)。snap-04 无对应运行语义变化 |
| 提取真正重复的行为，提高复用、降低模型理解负担 | 两处必须同步修改的规则会漂移；相似文本可能承担不同权限或事务责任 | 每个提取点说明“同一规则”的依据；调用方少了解步骤；两个 Adapter 同类事件解释一致。Control 受理与 Ledger 事务复核、各运行类型权限差异保留 | **S03 已实施，snap-03 独立 PASS。** handled events、Work Context、Console、Verification、Architecture Inspection 及既有 reviewer/baseline/completed-work 规则共享；存储 mutation 保留理由见 [read-model-convergence.md](read-model-convergence.md)。snap-04 无 ReadModel 变化 |
| 边审查集成边优化结构 | 结构改动必须经真实调用、并发和恢复场景验证，且验收针对固定源码 | 每组按完整行为修改并定向验证；组织与语义差分可区分；计划结束后再冻结集中回归 | 已按 Ledger、coordination、ReadModel、composition 分组定向验证并完成集中验证；snap-03 FAIL 保留，当前冻结 snap-04，不能把前序报告拼成单次全量零失败 |
| 队列按业务逻辑判断，不因名字或数量决定 | 内存队列可能保存局部互斥，也可能错误掌握任务存在/执行权威 | 每个生产队列回答：重启后从哪恢复、竞争时谁保证唯一、取消请求/确认/未知如何区分；旧启动入口有明确去向 | **snap-04 待独立复验。** snap-03 独立方发现 Query/Verification 状态漏审；现按 Promise Map、全部私有 Map／Set／数组二次扫描，在[队列责任审查](queue-responsibility-audit.md)中补齐 ReadOnlyQueryRuntime、VerificationRounds、Reviewer/ReworkVerification 和完整 VerificationJournal |
| 读模型收敛要考虑性能，Redis 只在测量证明后评估 | 共享规则可能让 SQLite 全库载入或增加扫描，缓存也会引入失效/撤权问题 | 两 Adapter 等价；SQLite 保留查询、索引和事务；固定夹具记录投影/查询耗时、读取范围和内存前后；若提出缓存，说明失效、来源变化、撤权和不可用 | **S03 已测量。** 覆盖 64／256／1024 事件的 adapter 推进与查询、89 event types／100 万次 lookup 和纯投影等价算法；共享规则不全库读取，SQLite 查询／索引／事务保留；没有引入 Redis 的证据需求 |
| 目录和抽象必须有可执行的软件工程判断规则 | 为统一外形拆文件、增加转发层或万能函数不会降低复杂度 | 以 Locality、Interface Depth、删除测试、真实第二 Adapter 判断：规则更集中、调用方知识更少、Interface 可直接测试；不设统一目录模板或行数目标 | 已逐个大文件给出拆分或保留依据；没有为 12 Module 强制同构，也没有把 coordination drive 拆成转发层 |
| 注释清理与术语统一必须完成 | 运行代码仍有 P108/LaneA、冻结、未支持等历史措辞，可能与实现不符 | 全源码和当前文档逐项检查；业务名称替换历史分工名；失实注释修正；解释不变量/失败原因的注释保留；历史证据不改 | **snap-04 待独立复验。** snap-03 独立方发现一处损坏残句；第三轮已修复并清理生产 contracts 的旧 interface-freeze 标签，扩大损坏语法扫描 0 命中；兼容 key/schema、fixture 与 provenance 按理由保留，见 [naming-comment-audit.md](naming-comment-audit.md) |
| 生产 harness 命名和职责整理 | 正式产品装配与测试默认 Fake 能力混在同一实现，名称虽迁移但职责未完全隔离 | 真实 Host 走要求显式能力的产品装配 Interface；测试/演示默认值留在明确测试装配；缺能力必须显式 unsupported/rejected，不能产生假成功 | **已实施并在 snap-03 独立审查中成立。** `createProductPlatform` 要求显式产品能力，真实 service 使用该入口；测试／演示 defaults 留在 `createPersistentPlatform`，见 [production-composition-audit.md](production-composition-audit.md) |
| 真实已有复用必须保留 | 角色绑定、Work 身份、材料授权和账本校验已有共用规则 | 不复制这些规则；变更后模块依赖仍符合 12 Module DAG；拒绝和并发反例继续通过 | snap-04 根/UI typecheck 零诊断、module boundary issues 为空；coordination／Ledger／双 ReadModel 定向与集中 delta 链适用。最终结论等 snap-04 独立复验 |

## 执行顺序

1. 先完成全范围行为—责任—Interface 表，并把观察到的跨 Module 实现导入逐项归类。
2. 按“等待/后继、通信路由、参与/请求”等完整行为推进协调 Control、records 和 drive 的内部归组；每组保留 Ledger 最终复核。
3. 逐类比较双读模型的事件解释，只有确认相同的规则才共享；同步完成等价和性能验证。
4. 收口生产装配与队列说明，完成全范围业务命名和失实注释检查。
5. 所有行均有完成证据后才进入固定源码、构建、集中回归和独立验收；I01–I04 不在本阶段执行。
