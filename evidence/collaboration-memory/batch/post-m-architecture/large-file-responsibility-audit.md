# S02/S04 大文件与职责归组审查

本表落实[原始对话](../2026-09-14-post-c-architecture-conversation.md)中“不要用拆文件和行数冒充整理”的要求。行数只帮助定位；决定依据是规则是否共同维护、公开入口是否够深、调用方是否还需拼内部步骤，以及拆分是否会破坏事务或存储局部性。

| 原目标 | 当前结构与决定 | 为什么这样处理 |
| --- | --- | --- |
| `data/state-ledger/ledger-validation.ts`，原约 3519 行 | 已成为稳定入口；89 个声明按 21 个提交职责进入 `validation/` | 每个文件维护一类提交不变量，两种 Ledger 仍调用同一入口；Control 的受理检查没有取代事务复核 |
| `control/control-engine/records/coordination.ts`，原约 1251 行 | 已成为稳定内部入口；构造器按 participation、directed request、subscription、waiting、intent lifecycle、successor 分组 | 调用方只请求完整提交，不知道事件、快照和版本数组的组装次序；移动检查证明 32 个声明无缺失 |
| `control/control-engine/coordination.ts`，原约 3100 行 | 保留一个 `CoordinationControl` 完整准入面；纯形状／归因／回执映射进入 `coordination/admission-support.ts`，邮箱重建进入 `coordination/mailbox-view.ts` | 主类仍负责必须一起判断的当前状态、权限、CAS 预期和唯一提交。将每个公开方法再包一层服务只会增加转发；纯校验与读模型则可独立测试、无状态、形成真实边界 |
| `control/dispatch-engine/coordination-drive.ts`，约 1200 行 | 保留单一持久扫描和恢复编排器；已有 `coordination-admission-read.ts`、`coordination-admission-deliveries.ts`、`successor-run-preparation.ts`、`alternative-report-preparation.ts` 承担可独立的读取／材料准备 | 路由公平性、预算、claim、settle、恢复顺序共同决定一次 drive 的结果。继续按行数拆会把同一个状态机分散；生产只有 `DispatchEngine.drive` 启动权，未新增第二循环 |
| 两个 ReadModel adapter，当前约 3123／4132 行 | 保留 Map 与 SQL 两种存储编排；事件集合、Work Context、Console 纯计算、Architecture Inspection 占位及已有 reviewer／baseline／completed-work 规则共享 | SQL 事务、索引和定点查询不能为了复用改成全量内存投影。共同业务解释进入职责文件；具体 upsert 与 Map 变更留在适配器 |
| `contracts/coordination.ts`，约 1704 行 | 保留版本化公开协议；实现归组没有搬动事件、字段或 ref | 这是外部兼容面，按文件长度搬家会扩大导入和持久兼容风险。内部构造和校验已经回归 Control／Ledger |
| `contracts/ledger.ts`，约 986 行 | 保留 `StateLedger`、commit/event/page/ref 的版本化协议 | 协议共同描述一次原子提交。按事件类型拆协议会迫使调用方跨文件拼一个事务概念；实现校验已分离 |
| `sqlite-ledger.ts`／`in-memory-ledger.ts`，约 1090／937 行 | 保留不同存储实现；共享 validation、dispatch selection、scope catalog 规则 | 两者的事务机制和索引不同。抽取存储流程会产生布尔开关式万能 adapter；共同业务不变量已有唯一维护位置 |
| `app/service.ts`，约 969 行 | 保留 `createScopedGuiService` 作为一个 scope 的 Host 生命周期与 action／projection 排序边界；HTTP 领域操作继续位于 `governance.ts`、`plan-changes.ts`、`scheduling/` 等职责文件 | 此文件的共同责任是把同一 scope 的模块实例、关闭顺序和 read-after-write 语义组合成应用服务。把每个方法再包成 service 类会新增转发层；领域准入、持久规则和队列选择已由对应 Module 或 scheduling 文件负责。后续若新增与 scope 生命周期无关的产品流程，应进入独立应用职责文件，而不是继续扩张组合函数 |
| `composition/persistent-platform.ts`，约 879 行 | 保留产品／测试组合根及 `PersistentPlatform` 显式能力面；`createProductPlatform` 必须注入真实或明确 unsupported 的运行能力，`createPersistentPlatform` 才允许测试／演示默认 | 文件较长主要来自 12 Module 的显式 import、接口方法和 close/reopen 接线。它隐藏的是实例构造、依赖图、投影推进和资源生命周期，具有真实组合深度；业务判断仍归各 Module。拆成多个只转发 façade 会增加调用路径，却不会减少调用方需要理解的业务规则 |

`src/contracts`、12 Module、Host/composition、UI、storage、fixtures/testing、scripts 和 vendor 的全范围责任见 [behavior-interface-audit.md](behavior-interface-audit.md)。小而清楚的模块经审查后保留平铺；未强制套用相同目录模板。

这轮结构收益可以直接观察：修改协调命令形状只需进入 `admission-support.ts`；修改某类协调提交只进入相应 records 文件；新增 ReadModel 支持事件只改一个 handled-event 集；同一 Console 计算不再在两种 adapter 各维护一份。主事务与 SQL 局部性没有因拆分丢失。
