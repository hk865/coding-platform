W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。Astra已完成骨架/测试中间审核并冻结，现在进入DSH生产实现阶段。完整设计已在 docs/refactor/tasks/R4c2b-index-skeleton-prompt.md 中，必须重新定向阅读其意图、已有能力、文件和不变量；该页“本阶段不实现”现在由本指令替换，其他契约保持。读当前测试 tests/work-graph/R4c-execution-history-index.test.ts，其中主审已补真正提交并发barrier、故障回滚、历史占用变化与codec反例。

只改 tasks/execution-history-service.ts 和 persistence/execution-history-codecs.ts；测试、contracts、其他实现、原工程均OS只读。使用现有createRunStateReader+RecordStore，不另建Run schema/表/图/ledger接口，不扫描所有Run/事件。调用方expected一个Run revision不替换；所有用到的关联guards来自WG11完整快照，但不guard Lease/current occupancy/全局horizon。history只有起点固定/水位前进/终点固定；唯一Kernel完整身份永久绑定Run。新请求即使内容相同也正常CAS提交，新旧重放不要混淆；已提交相同requestId返回原事件结果，并验证事件/receipt/输入身份一致。停止/错误不产生状态残留。

复用源码codec/主体快照/输入隔离模式。不要把大量设计注释原封堆入实现、不要引入多余服务层；保留解释不变量的必要注释。该实现不负责证明Kernel事实已经发生，不得反向导入Runtime；真实端到端来源由集成测试核验，后续观察调用复用此原子维护。严禁直接访问SQLite绕过Store、修改frozen测试、提交/安装/凭据/外网模型。单文件原地写不rename。

运行 python3 tools/dsh-refactor/check.py next-types 与 next-history-index，并回归相关next-execution-reads/next-task-claim等check.py实际存在能力；不得捏造检查名。真实错误向Astra报告，不放宽标准。完成给出复用映射、实现变化、测试结果、未完成，然后等待独立审阅。
