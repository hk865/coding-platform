# A1 / R3d + R4b：沿架构图发现工作 Session

本批属于 docs/AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md 的 A，不能据此宣布 B/C/D 或 AT-01–14 全部完成。只做骨架和行为测试，主审中间审核后才允许实现。W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next；N=W/docs/refactor。禁止修改白名单外文件、安装依赖、提交、调用额外模型、复制旧平台服务。使用原地写入（文件分别挂载，不能 rename）。

## 阅读与复用

按顺序阅读 W/docs/AGENTS.md、PRODUCT.md、上述对齐稿 §3–11、agent-platform-user-replies-numbered.md 第01/03/09/12/14段；N/ARCHITECTURE.md、IMPLEMENTATION-PLAN.md、IMPLEMENTED-CAPABILITIES.md、modules/core/work-graph.md §4/6、intent/2026-09-24-DSH-HARNESS.md、DSH-WORKFLOW.md。

再读 T/src/core/work-graph/sessions/{contracts,session-directory,session-record-codecs}.ts、architecture/{contracts,graph-index}.ts、tasks/plan-readers.ts、configuration/role-memory-service.ts、contracts/{governance,core/identity,core/session,core/results}.ts、RecordStore ports/lookup-ports 与已有 tests/work-graph/R4b-*、tests/helpers/task-claim-fixture.ts。可只读原工程 src/contracts/governance.ts 以理解原 baseline payload/digest，不能导入它。

用户的 Agent 工作实体用现有 SessionRecord + RoleConfigurationRef 表达；Role 是可复用配置，不增加永久 Agent 表、第二个成员目录或新模块。busy/idle 来自 occupancy/health/lifecycle，不能再存 working/standby 副本。架构关联不是权限、锁或长期专家证明。

## 本批接口及数据路径

### 1. 初始正式架构目录

新增 architecture/catalog-contracts.ts、catalog-record-codecs.ts、catalog-service.ts，导出 createArchitectureCatalogService({records}) 与 ARCHITECTURE_CATALOG_SCHEMAS（只注册新 catalog/event，已有 baseline/active schema 复用 PLAN_GOVERNANCE_RECORD_SCHEMAS）。

复用模块文档的 ModuleDefinition/AdoptedArchitecture/ArchitectureCatalogRecord 类型。Catalog 与 baseline 使用同 baselineId/revision 的不同 aggregateType；不可变，不另存当前 catalog 指针。现有 current 指针是 ProjectArchitectureBaselineActive。

首批窄端口：
- adoptInitialArchitecture(ctx, GraphWrite<{baselineId:string; catalog:AdoptedArchitecture; description:string; constraints:{name:string;scope:string}[]}>): WriteResult<ArchitectureRevision>。constraints 沿用既有 ArchitectureBaselineContentV1，不改为 string[]。
- readArchitectureRevision(ctx, {selection:{kind:'current'}|{kind:'revision';ref:ArchitectureBaselineRevisionRef}}): ReadResult<ArchitectureRevision>。

这是已有目标 propose/apply 初始受理的薄 Host 入口，无模型提案/演进/decision/gate 的虚假实现。只允许可信 Host human/system、有效 project/workspace；项目已有 active 时新请求拒绝，不绕过后续演进协议。当前只能首次采用，明确写注释。

adopt 在同一 RecordStore 提交写 baseline + catalog + active pointer + event/idempotency；读取 Project/Workspace 并 guard，active/baseline/catalog absent CAS。复用旧 baseline canonical digest 算法，使真实 Plan reader 能读；content schema 不凭空加 catalog 字段导致 digest 改义。catalog 额外包含模块职责/路径/接口与依赖，验证完整 scope、唯一 ID、端点存在、正式依赖 DAG（requireDag=false 拒绝）。复用已有图算法适用部分，不能因 observed 允许环就放宽正式模块 DAG。不得扫描文件猜职责。

同 actor/requestId 相同输入重放恢复原 receipt/result；不同输入冲突；首次请求结构在 await 前复制。历史 baseline 无 catalog 返回 catalog:null，不能猜一个空 catalog。坏记录/读失败与缺失区分。读取 current 用相关 pointer 复核或同窗 readMany，不能混版本。

提供一个模块内部只读 helper，供 Session writer 验证 module 属于当前正式 catalog，并返回该次相关 record guards。不要新增独立通用 provider 框架。helper 的导出/签名在骨架中确定供主审冻结。

### 2. 复用 SessionWorkLink 与 Session lifecycle

新增 sessions/session-lifecycle.ts + lifecycle-contracts.ts + lifecycle-record-codecs.ts。createSessionLifecycleService({records,lookups}) 返回独立 SessionLifecyclePort：
- linkSessionWork(ctx, GraphWrite<{sessionRef;target;relation;active:boolean}>): WriteResult<SessionWorkLink>
- archiveSession(ctx, GraphWrite<{sessionRef;reason:string}>): WriteResult<SessionRecord>
- reactivateSession(ctx, GraphWrite<{sessionRef;reason:string}>): WriteResult<SessionRecord>

此子端口由组合根与既有 sessions 合并；不能新建 Agent 状态。复用 SESSION_RECORD_SCHEMAS 与 codec，新增 schema 仅用于事件重放。

link 写入现有 SessionWorkLink；Session+link 精确 CAS，Session revision 也递增，使同一预期版本的 claim/archive/link 竞争只有一次成功。使用 meta.expected 的既有准确字段（先读 CommandMeta），不得自行另造预期版本信封；新 link 的公共 pin revision=0 转换为 Store expectedRevision=null，旧 link 为当前revision。模块目标经上述正式 catalog helper，Task 经现有 Goal/active Plan 真实成员验证；WorkContext 仍 unsupported。active=false 允许结束失效目标的旧 link，保留 since/until；提交 cursor 由已有 binding 原子填入，不猜水位。重新 active 保存原事件历史，当前link开始新有效区间，不删除记录。archived Session 不允许新激活关联，允许查询历史。

archive 要求无 occupancy，且无仍有效的 responsible Task/Work 责任；module 关联保留不删（不是未交接任务），否则无法历史查找/解除归档。没有实现的 Mailbox 不伪造等待查询；本批明确 future mailbox writer 必须与此 Session CAS 协调。不得修改 Kernel 或“取消”运行来归档。reactivate 只改 lifecycle/archivedAt，不把 health 设 available、不启动模型；其仍有的当前模块关联重新可发现。重复请求恢复原结果，不按当前 lifecycle 重算重放。所有操作同现有 Host 作用域规则并校验 reason 和完整 refs，坏状态不猜默认。

不必先改 SessionDirectoryPort 必选方法（避免破坏真实窄消费者）；组合根稍后由主审集成独立端口。现有 initialLinks 的 Module 注册路径随后复用同一个正式目标校验，不能另写模块权威；本骨架阶段不要改既有实现。

### 3. 按目标索引发现

现有 findSessions 已有 module/task 反向索引但仍扫描 workspace；实现阶段需在现有 session-directory.ts 改为 target 索引驱动候选与分页，只批读相关 Session。关闭 until!=null 的 link 不进入当前目标发现；includeArchived 控制归档 Session，不能把它当 includeEndedLinks。历史通过 readSession.links 与事件保留，明确注释。

target 查询不得枚举全部 workspace session，不得扫描全部 Kernel 历史；多 relation 指向相同 Session 要去重、页边界不可漏/重复；稳定页 token 绑定作用域、actor、target/role/includeArchived。未知/损坏返回类型化失败，不静默跳过。不要为此引入常驻全局缓存。非 target 原语义保留。

## 骨架和测试交付（本阶段）

生产新文件只写公开契约、依赖、短职责注释、unsupported 方法；codec 可声明空 schema 占位（报告，实现阶段填），禁止提前实现业务。不修改现有生产实现求绿。骨架的类型检查应通过，新成功路径因 unsupported 真实失败，而非导入错误。

测试：
1. tests/work-graph/A1-architecture-catalog.test.ts：真实 Memory/SQLite 初次提交、重放、不同输入冲突、非法 scope/重复节点/悬空边/环、已有 baseline不覆盖、故障回滚/并发首次采用、重启精确读取、旧 baseline 无catalog。证明已有Plan治理读取能消费该 baseline（使用已有reader/fixture）。
2. tests/work-graph/A1-session-lifecycle.test.ts：真实Store创建Session，真实catalog为module来源，Module/Task link 激活/关闭/重开；未知module不写、跨scope、坏记录；archive责任/occupancy拒绝，idle module绑定可archive/reactivate且health/history不变；同Session archive/claim或link的CAS竞争、重放/输入隔离、失败不半写；不能用测试直接种成功archive记录证明操作。
3. tests/work-graph/A1-session-discovery.test.ts：真实目标写入→findSessions、standby仍见、archived默认消失但历史可读、reactivate重现、关闭link消失、多relation分页不重复/不漏；挂真实Store读取计数，加入大量无关Session后不得转workspace枚举，查询记录量随目标候选而非所有Session增长。骨架现阶段只保留新服务调用作为红测，不修改旧directory。后续组合根/真实Kernel场景由主审补验。

测试准备复用已有fixture，小的公用helper可放 tests/helpers/graph-session-fixture.ts。不复制整套平台/生成几千行镜像断言。只允许固定 check.py next-graph-agent 与 next-types；新接口导致fixture适配点先报告，不碰白名单外代码。

最后报告：需求→复用符号→新接缝；各文件职责、测试数量、实际红测原因、待主审的问题；然后停止，不能直接进入实现阶段。
