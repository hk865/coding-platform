# M 后结构整理执行记录

入口：[原始对话要求追踪表](original-conversation-traceability.md)、[原始对话](../2026-09-14-post-c-architecture-conversation.md)与[执行计划](../architecture-before-m/post-m-cleanup-plan.md)。原始对话是验收依据，计划和扫描只负责组织实施。状态：snap-07 已获 S01–S05 独立全 PASS，AC-S06-01 关闭；固定源码和构建均由独立方复算一致。I01–I04 尚未开始。

## 原始要求落实

- 行为—责任—公开接口审查已覆盖 12 Module、contracts、Host/composition、UI、storage、tests 和 scripts。118 个跨 Module 实现依赖逐项归类为正式 Module Interface 27、Host composition 84、test/fixture 7，待判定 0。详见 [behavior-interface-audit.md](behavior-interface-audit.md) 与 `interface-audit.json`。
- StateLedger 的提交校验按 21 个领域职责拆分；协调 records 按参与、定向请求、订阅、等待、intent lifecycle 和后继归组。Control 的受理检查与 Ledger 的事务提交复核继续存在，未合并为一层。
- `CoordinationEngineImpl` 的公开契约不变，内部按五类完整业务操作归组。各操作拥有自己的 canonical 读取、权限、版本条件、提交计划和结果映射；`coordination.ts` 只保留稳定 facade 和装配。详见 [coordination-domain-completion.md](coordination-domain-completion.md)。
- 两种 ReadModel adapter 共享已经证实相同的事件解释；Map/SQL 写入、索引、查询和事务仍由各自 adapter 负责。新增双 adapter 等价、SQLite 重开和整页事务回滚验证，并修正 SQLite 材料授权结果缺少稳定顺序的问题。详见 [read-model-convergence.md](read-model-convergence.md)。
- 所有生产 queue、wake、active map、in-flight map、恢复定时器、runtime observation journal 和 Verification journal 均回答了重启恢复、竞争唯一性、取消三态和保留/迁移决定。第二轮按所有 Promise Map、私有 Map／Set／数组复核，补入 ReadOnlyQueryRuntime 与 VerificationEngine 状态。未发现纯内存结构独占任务存在或合法启动权。详见 [queue-responsibility-audit.md](queue-responsibility-audit.md)。
- 正式产品装配要求显式提供 runtime、verification、handoff、continuation、lifecycle、query、workspace reader 和 capability。产品服务默认关闭 fixture execution；显式测试/演示入口仍可选择替身。详见 [production-composition-audit.md](production-composition-audit.md)。
- 全 `src` 的历史票号、lane、冻结、no-op、未实现和损坏注释候选已按语义复核。当前业务私有名称已换成职责名；持久幂等键、SQLite schema、fixtures 和来源 provenance 有依据保留。`/legacy` 明确为停止扩展的兼容界面。详见 [naming-comment-audit.md](naming-comment-audit.md)。

## 结构判断

本阶段没有用拆文件、减少行数或增加转发层代替接口收敛。每个大文件都记录了拆分或保留依据；小而清晰的模块没有被强制套用同一目录模板。共享函数只承载相同业务解释，权限、失败处理、存储事务和执行时点不同的逻辑继续分开。

读模型性能测量覆盖 64／256／1024 事件的两种 adapter 推进与查询、89 个事件类型的 lookup，以及纯投影等价算法。共享投影不读取整个 SQLite 数据集；当前证据不支持引入 Redis。`node:sqlite` 不暴露物理页读取计数，因此没有声称已测量数据库物理页。

## 中间验证

中间阶段只运行受影响定向测试与必要静态检查。主要报告分别为：

- 协调领域最终定向：32 suites、98 tests，全通过；类型 0 诊断，模块边界 issues 为空。
- ReadModel 最终定向：19 suites、38 tests，全通过；Query／ControlIntent 重启另有 11 suites、13 tests 全通过。
- 产品默认 fixture 关闭：1 suite、5 tests 全通过；显式测试 opt-in 保留。
- 命名相关受影响集：39 suites、106 tests 全通过。

这些报告覆盖集合有交叉，不能相加成一次全量 PASS。过程中的两组 sandbox 失败均发生在模型调用前：当前 WSL 环境缺少可用 bubblewrap。没有为通过测试而弱化隔离；同一非 sandbox 行为组合 36 suites、115 tests 全通过。原始失败和干净复验均保留在本目录。

## 过程中发现并修复的问题

- 初次读模型提取误删无关类成员，已从精确备份恢复，并以 AST 限定目标方法；非目标类成员差分重新核对。
- 初次共享投影从契约导入未导出的 helper，令跨进程加载失败；已改用完整 ref 的 canonical identity。
- SQLite 材料授权列表缺少稳定排序，数据增长后与内存 adapter 顺序可能不同；现按 `source_cursor` 排序，并以相同事件序列比较两边视图。
- 产品服务曾默认传入 `fixtureExecution: true`，且 runtime 分流只看角色；现改为产品默认关闭，并要求显式 fixture flag 与 fixture role 同时成立。
- 第一轮机械注释替换留下空标签和残句；第二轮处理已知候选，snap-03 又发现一处 `（ 的 triggerSourceIssues）`。第三轮修复后，snap-04 仍被独立方以重复标题、孤立 Authority、旧编号尾片和英文冠词错误证伪。第四轮不再依赖固定关键词结论，而是复读所有相关生产目录，清理施工编号和旧 handoff 权威，并修正后继 Run 生产接线、订阅范围和 UI 能力三类失实说明。

以上均保留了原失败记录，没有改写为通过证据。

## S05 当前边界

snap-03 的[独立报告](acceptance/snap-03/acceptance.md)关闭前期运行结构问题但指出审查遗漏；snap-04 的[独立报告](acceptance/snap-04/acceptance.md)确认 S01–S03 PASS，并以 AC-S04-01 否定注释收尾；snap-05 的[独立报告](acceptance/snap-05/acceptance.md)关闭该缺陷，但以 AC-S05-01 找到同类残留；snap-06 的[独立报告](acceptance/snap-06/acceptance.md)关闭 AC-S05-01，又以 AC-S06-01 找到重复规则名、缺失主体、空标题和机械空格，仍判 S04/S05 FAIL。

接纳输入为 `final-source-snapshot-07.json`：1368 条目、`094eb49537e667c46921074f3b15c4077dcef1c60a4bd13371857723b0b09954`。相对 snap-06 无新增/删除，共 59 个文件变化：主要为注释和术语补全；另把 SQLite ReadModel 一个带旧票号的私有常量改为业务名称，并补一处方法声明间换行。没有公开接口、依赖方向、持久 schema 或生产执行规则变化。ReadModel 受影响 4 个测试文件共 7 例通过。匹配构建为 475 文件、`60b47ef8ec30a4d6dc83d4a34a9870b9daccf978815dc064e36a456fc1db5a1e`，无新增/删除产物。根/UI 类型、边界、构建和构建后源码零漂移通过；独立方复算源码和构建均一致，并逐项判定 S01–S05 PASS，见 [snap-07 报告](acceptance/snap-07/acceptance.md)。下一阶段可从 I01 开始，但本轮没有把 S 结论外推到 I01–I04。
