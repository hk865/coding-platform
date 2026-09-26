# 独立目标工程：N0 干净迁移与 R3c reader/index 验收

日期：2026-09-24。结论：**首批干净迁移通过，并继续完成 R3c 的材料事实/候选索引子项。完整平台重构尚未完成。**

用户明确要求先迁入新项目/文件夹，再继续任务；原话与方向见[实施纠偏](../intent/2026-09-24-TARGET-PROJECT.md)。当前目标工程是 [`coding-platform/next`](../../../coding-platform/next/README.md)，与旧工程同属一个 Git 仓，构建和运行依赖边界独立。没有提交或推送。

## 1. 已交付与未交付

| 领域 | 本次真实状态 |
| --- | --- |
| 工程骨架 | 五个模块目录、共享契约、组合根、独立配置/构建/测试与可执行边界检查已经存在 |
| WorkspaceTools | 迁入 capture/read/query/compare/verify 与文本/TypeScript 能力；通过实际临时工作区和冻结 Kernel 的文件访问调用 |
| Goal | 目标 GoalTaskPort → 领域编译 → GraphRepository → 目标 RecordStore；无旧 Control/StateLedger 委托入口 |
| 材料 | 目标 MaterialService → 精确事实/候选 reader → 目标 RecordStore；保留准入、来源、撤权、正文与 Host 无 Run 读取行为 |
| RecordStore | Memory/SQLite、正文存取、CAS/幂等/回滚、注册候选索引；backend 仅公开 `records/close` |
| AgentRuntime / Workflow | **窄 N0 源码边界骨架**；对应操作明确返回 unsupported。不是完整文档协议已实现，不能启动连续 Session 或完整业务 |
| Kernel | 冻结已验收 R4a 构建的公共依赖；未在本批修改其源码，不等于平台 R4b/c/p 已完成 |
| UI / 产品切换 | 未迁入，原产品仍走原应用；没有宣称可以用新目录启动完整 GUI |

新工厂 `createTargetPlatform` 自行创建目标存储、材料 reader 和 Workspace 工具，仅接收存储选项与可信 Host 工作区定位/授权。它不接受旧 Ledger、Index、Vault 实例。Goal 操作仍需已受理的 Project/Workspace；新工程完整 bootstrap/计划受理尚未交付，测试用领域记录夹具不能冒充产品写入口。

## 2. “干净”具体指什么

1. 目标生产代码不 import、链接或通过别名访问原平台 `src`，没有把旧源码藏进复制的 `legacy/` 目录。仅迁入必要实现和当前使用的契约声明/纯判据。
2. `legacyAccess`、LegacyRecordMechanics、旧 Goal command/commit 适配器、旧 ArtifactPort 适配器均未保留在目标公共实现。内存存储不再依赖整个领域 Snapshot/Event 类型联合；保留的是物理 JSON 记录及原数据编码。
3. WorkGraph 的材料 fact/candidate reader 由目标 Store 提供。原工程 R3b 那两条旧 reader 注入边在 **next** 已退出；原参考工程未改，不能把这个结论写回原 map。
4. 新工程拥有物理复制的 Kernel 运行产物及声明，禁止链接回原 Kernel 源码；只复用已安装的第三方依赖目录。产物保留哈希与来源，源映射内嵌对应 Kernel 文本供调试。
5. 本批前后核对旧 `src`、`tests`、Kernel `src` 共 **1313 个文件，变动为 0**。既有未提交实现未被重置、删除或覆盖。没有接触用户真实业务数据库。

物理 SQLite 四表格式继续兼容；这不宣称任意旧数据库中所有业务 kind 均支持。新 schema 注册范围仅覆盖已迁操作和材料读取所需事实，未迁能力必须拒绝。原 writer 写入的 JSON 值格式兼容；绕开 Store 任意写 SQL、重复 JSON 键或超出 JS 数值表达语义的外部编码不是已支持的数据生产协议。

## 3. 真实协作与独立审查

按用户要求执行 **GPT‑6 Sol 骨架/测试 → 主 Agent 冻结 → 两个本地 DSH session 并行实现 → 主 Agent 独立复现与验收**。

| Lane | 允许写入 | 约束与结果 |
| --- | --- | --- |
| `next-store-01` | lookup-index、Memory backend、SQLite backend，共 3 文件 | 独立写挂载，接口/测试/原源码只读；scope audit 无越界 |
| `next-material-readers-01` | WorkGraph `materials/record-readers.ts`，1 文件 | 与 Store 同时实现；待提供者验收后由主审更新只读依赖，再验真实接线；scope audit 无越界 |

主审发现并修正的缺陷均先由独立测试复现：

- UTF‑16 字符串比较与 SQLite UTF‑8 排序不一致，修正排序和 exclusive cursor 比较。
- 原始 JSON 重复字段/数字字面量被 JS 与 SQLite 不同解释，统一将已验证的解析值重新编码后写 snapshot；保留逻辑值，不改变事件和正文精确字节语义。无新表、UDF 或额外连接，不增加启动全库扫描。
- reader 只拒绝重复游标、未拒绝下降，补严格前进检查。
- Agent 撤权 actor 缺少必需的 RunRef 仍被接受，补与现有 ActorRef 一致的形状校验。

静态检查另覆盖本地包链接、配置继承/别名、动态加载、源码和 Kernel 符号链接等反例。最后隔离验证发现一项架构测试夹具依赖旧目录存在，已改为测试自建外部目录，未放宽断言。

Runner 曾将所有 `dist` 当生成物排除，遗漏目标自有的冻结 Kernel 依赖；已修为实体复制，并记录现有两个 lane 的主审更新。主审的依赖刷新与实现者允许改动分别记录，不将二者混为越权实现。

## 4. 验收结果

在无旧平台源码的临时副本运行 `node --run verify:isolated`，结果：

| 检查 | 主审结果 |
| --- | --- |
| 目标边界 | PASS；5 个源码 owner，3 条实际 import 边均在 8 条目标允许边内 |
| 类型检查与目标构建 | PASS |
| 迁入核心行为 | 11 文件 / 81 项 PASS |
| Store + Goal 独立检查 | 2 文件 / 11 项 PASS |
| 材料 reader | 1 文件 / 11 项 PASS（其中 8 项真实两后端集成） |
| 平台公开装配 | 1 文件 / 2 项 PASS：真实材料存取、SQLite 重开、Workspace capture/query |
| 架构反例 | 1 文件 / 10 项 PASS |
| 全部目标测试 | **16 文件 / 115 项 PASS；0 失败、0 跳过** |
| 构建产物加载 | 实际导入 dist 工厂，创建/关闭 Memory 平台成功 |
| 原工程保存 | 1313 文件哈希与迁移前完全相同 |

这证明当前迁入子集的独立构建与实际接线，不证明所有 R 系列或完整产品行为已经完成。静态门禁不是抵抗任意恶意文件读取的安全沙箱；DSH 文件写隔离由 runner 执行，生产装配另由真实测试证明。

证据：[隔离运行日志](evidence/next-clean-migration-2026-09-24/isolated-verification.log)、[原文件核对](evidence/next-clean-migration-2026-09-24/reference-preservation.json)、[Store 导入](evidence/next-clean-migration-2026-09-24/store-import.json)、[reader 导入](evidence/next-clean-migration-2026-09-24/reader-import.json)。同目录保留初次迁入清单、测试来源、候选审计、各次 DSH 报告、独立 RED 复现及最终目标哈希。

## 5. 代码量与性能边界

按物理行统计，含空行/注释；[机器统计](evidence/next-clean-migration-2026-09-24/metrics.json)。

| 范围 | 文件 | 行数 |
| --- | ---: | ---: |
| 目标生产源码（含共享契约） | 86 | 9,639 |
| 其中共享契约 | 40 | 1,864 |
| 目标测试 | 16 | 3,112 |
| 工程脚本 | 2 | 260 |
| 冻结 Kernel JS + 声明（单独列） | 138 | 19,762 |

初始未经裁剪的必要文件闭包是 105 文件 / 23,549 行；删除旧服务专用接口和无引用声明后，即使加入新索引/reader/装配，当前目标生产源码为 9,639 行。这证明迁入闭包得到压缩，**不能把部分目标与原完整产品相比而宣称整体等功能复杂度已下降**。原工程物理存在，故仓库总量暂时增加。

已去掉材料路径对旧服务的绕行和跨模块双向依赖；SQLite 候选走表达式索引，Memory 走 reader 字段桶，不再扫描所有 snapshots。写入只更新变化行；单页读取与 readThrough 处于同一读取事务，跨页不伪称冻结快照。

仍有明确限制：候选会扫描该 reader 的所有匹配授权页，精确 material 再过滤；Memory 对匹配桶分页仍排序，未改为有序索引；编码/领域边界仍有多次 JSON 解码。当前没有端到端性能或模型费用对照，因此不作量化提速承诺。后续优化应依据这条真实路径的测量，保持撤权、身份与来源守卫。

## 6. 后续任务与退出规则

- **接着做 R3c 剩余内容**：计划受理、任务资格及任务读模型；先实现对应骨架/协议测试，再由 DSH 并行填入真实 Store 上的操作。这次只关闭材料 reader/index 前置，不把 R3c 全部标完成。
- R3d 架构、R3e 验收结构、R3f 通信、R3g 角色，以及 R2e 余项继续按各自契约实施。
- R4b–e/R4p 实现平台 Session、唯一占用、连续执行、控制恢复、维护与同工作区范围并行；Kernel R4a 的冻结能力只是前置。
- R5 实现业务流程；R6 接入新 Host/UI，核查全部消费者后完成产品切换和旧代码退役。当前不删除仍服务旧产品的参考实现，不要求新能力接回旧控制/存储链。

以上均默认在 `coding-platform/next` 开发。历史验收说明旧实现曾经具备的行为，后续批次仍须验证迁入后的真实调用链与删除范围。
