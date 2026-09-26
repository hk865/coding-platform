# R3b 材料迁移：Sol 骨架、dsh 并行实现与主审

日期：2026-09-24。**材料功能与真实装配已独立验收并导入；模块依赖收口部分完成，仍有两条已登记的临时反向依赖。** 本页只对 R3b 材料切片负责，不代表 R3 全部迁移或目标模块图收敛。失败及返修证据保留，功能验收不消除下文架构欠账。

## 实施分工

GPT‑6 Sol 按已审协议交付窄接口、明确失败的实现骨架和独立测试；主 Agent 审阅后冻结。两个本地 dsh Session 从同一工作树快照同时实现：Raw lane 只写正文 codec / memory / SQLite 三文件，WorkGraph lane 只写 material-service / applicability 两文件。共享 Port、类型、测试、配置和其他模块由操作系统只读。组件通过主审后另用集成 Session 修改七个既有入口，不扩大实施者权限。

任务书：[Sol 骨架](../tasks/R3b-sol-skeleton.md)、[Raw](../tasks/R3b-raw-dsh-execution.md)、[WorkGraph](../tasks/R3b-work-graph-dsh-execution.md)、[真实装配](../tasks/R3b-integration-dsh-execution.md)。方法和固定测试能力见 [Harness](../DSH-EXECUTION-HARNESS.md)。

| lane | dsh Session | 范围 |
| --- | --- | --- |
| `r3b-raw-sol-01` | `session-6519d62d-2ab8-4a27-bdba-5018b347a7d0` | 三个正文实现文件 |
| `r3b-wg-sol-01` | `session-a078c91e-68a4-44a9-ab54-bd6f5d12b153` | 两个材料领域实现文件 |
| `r3b-integration-sol-01` | `session-3b2e882d-7a24-4ce9-8f3c-b3bad270b137` | Vault 薄适配、组合根、HistoryMaterialsContext、GUI |

## 主审发现与返修

基础十项通过没有终止审阅。Raw 首版存在一次新写三次正文摘要、合法 JSON 放错内容键仍被接纳、新 origin 与兼容 owner 字段冲突、SQLite 初始化失败连接未关闭。主审/Sol 增加四项独立边界并在候选复现四项失败，dsh 原 Session 修复后四项全部通过；新写摘要一次，重放需另校验已存行。

WG 首版无法读取自身写入的 platform_operation 材料，读取期间会受调用方修改 reader 对象影响，取消后仍返回正文，Core 损坏映射不符，Core work_run 未校验 canonical workspace。追加六项在候选中五失败一通过，修复后六项通过。随后两项独立测试再发现等待 canonical 查询期间取消仍会开始正文写入，以及 Host 信任不匹配的 snapshot.ref；同 Session 再修，八项补测及原七项 WG 契约通过。取消保证只覆盖尚未开始的写副作用，不宣称能回滚已开始的存储操作。

真实 GUI 独立测试通过公共持久平台种子、SQLite 关闭重开与公共 GUI service 路由观察真实材料 Port，旧入口能读正文但未进入新 Host 接口，因此初始失败。另有 HistoryMaterialsContext 测试以失败探针禁止借 owner/reader Run 读普通页面。两者需最终装配通过，不能拿组件 fake 当 UI 接线成功。

正文先保存、正式引用后受理的故障测试使用真实 Dispatch claim/drive 与 ContextCompiler。仅故障注入 RunStarted 提交或正文 put，分别验证孤儿正文可读但无成功 Run 引用，以及正文失败根本不调用正式启动；不把两个数据库描述成一个事务。

## 兼容边界与退役

保留原 ArtifactRef、首 owner/来源、SQLite `artifacts(key,record)`、旧 usage 缺省与 includeOwner 返回形状。TaskAttempt 不因能作写入来源而获得 Run 读取资格；旧 owner=null 正文可物理解码，但不能猜出 Host 授权。Host 历史读取用可信项目范围及来源；当前使用缺少可核验来源时明确 source_stale。GUI 页面自身的已记录 grant、显式跨工作区历史授权、basis 与撤权仍需核对。

迁移完成后，旧 Vault 的正文验证与访问规则应只保留薄适配，源码中同义规则只存在于 RecordStore/WG。其他普通读与模型输入消费者的逐项退出见 [消费者清单](R3b-material-consumer-inventory.md)，不能称全部普通读取或全部 ContextCompiler 已退役。

## 尚未关闭的架构依赖

**不能报告完整逻辑 DAG 无环。** WG 材料规则仍注入旧 StateLedger.load 和 ReadModelIndex.materialAccessCandidates；旧 Ledger 的 Goal 写入反向委托 WG，模块图有迁移期反馈关系。已查的精确读取直接读取同后端 snapshot/投影，没有材料读递归或嵌套写事务，但这是调用路径性质，不消除模块依赖。

源 import/允许边检查和这两项迁移依赖分别披露，见 [真实图](../module-dag.md#r3b-集成期的真实注入关系2026-09-24)。下一数据/索引小批把精确 snapshot reader 与候选查询的机械实现归 RecordStore，旧入口薄委托，共用连接和状态后删除临时边。R6c 必须确认退出；不以换端口名或加一层 wrapper 宣称无环。

## 证据与最终检查

组件证据目录：[Raw](evidence/r3b-sol-dsh-2026-09-24/raw/accepted-hashes.json)、[WorkGraph](evidence/r3b-sol-dsh-2026-09-24/work-graph/accepted-hashes.json)。各目录保存派发 manifest、失败/成功检查、每次 Session 结果、修改前后源码和导入哈希；组件核对时无范围外修改，主工作树批准文件仍与派发基线一致后才逐文件导入。原未提交修改保留，未 stage/commit/push。

最终独立检查：

| 范围 | 结果 |
| --- | --- |
| 新增契约、异步边界、body-first、Host与真实GUI | 8文件31项通过 |
| 旧Vault、真实Run bundle、授权/撤权、SQLite重开/首写竞争 | 11文件68项通过 |
| 真实Query context材料链 | 5项通过 |
| 导入主工作树后的合并回归 | **47文件297项通过**：上述相关集合、完整 tests/context、R3a独立用例、历史Ledger/Host兼容及跨进程来源检查 |
| 平台typecheck、Kernel→平台→UI构建 | 通过 |
| import/所有权/已声明允许边检查 | issues=[]；同时明确输出 fullDependencyDagVerified=false 与两条临时DI边 |

上述集合重叠，不相加为全仓总数。本轮未跑平台全量测试、完整Kernel测试、lint或端到端性能实验；Kernel生产文件本批未改。主树导入与 [accepted-hashes](evidence/r3b-sol-dsh-2026-09-24/integration/accepted-hashes.json)一致。

集成首版还发现三项：缺 currentBasisValid 能力却静默跳过；未使用的 InMemoryHarness.materials 会与自定义 vault 指向不同库；Host 页遗漏旧历史grant的签发者/用途规则。前者以新增反例复现，后者由独立只读审阅发现并补三项反例；最终复用WG原判据，不复制规则。已删无消费者的 Harness 新API和第二默认库，以及重复的 SQLite wrapper close 状态。PersistentPlatform.materials保留真实GUI消费者所需只读入口。GUI公共 action 明确返回 Promise，未知scope按异步拒绝返回。

跨进程首轮失败源于隔离快照漏挂已存在的 `.local/linux-test-tools/node_modules`；主Agent只读挂回后同一冻结夹具通过，未安装、改断言或抬timeout。旧SQLite竞态夹具此前仅由Sol/主审将等待点从SELECT未命中换成真实INSERT之前，保留并发首写语义，避免测试强迫多余预读；修改前后hash见Sol任务书。

代码变化：三份旧Vault正文/权限实现共339行，最终165行（含注释），减少174行；Core新增编码校验、可信Host语义与兼容转换，所以全项目生产行数仍上升。不能将旧文件变短等同整体复杂度下降。最终同口径统计见[最新测量](code-size-and-complexity-2026-09-24-final.md)。

原输入、接口、测试、脚本及其他模块对DSH保持只读；后补测试/既有判据导出/依赖挂载均由主Agent登记 manifest.rootUpdates。三个lane的完整范围审计没有DSH越界写入。未提交Git。
