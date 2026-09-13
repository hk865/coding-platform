# 1B 开工前技术收敛

M06 源码仍冻结，当前仅只读准备；不得将本页视为已实现。委托范围沿用 CM-1B-001、PLAN 5.4.1/5.5/B01–B05。

## 持久 scope 和唯一权威

采用同一 StateLedger 模块内的小记忆专用接口；内存与 SQLite 适配器共享纯校验/折叠。profile 使用安装目录 profile/ 下的独立 Ledger 实例，项目记忆使用真实项目 Ledger，Control 为唯一写入口。禁止伪造 Project/Goal/Run，禁止将旧 CommandIdentity.projectId 放宽为 optional。

安装级 createGuiService 初始化一次稳定 profile，追加项目共用此实例；singleton 初始化 CAS 输家重读获胜记录。专用记忆事件不混入旧 DomainEvent 流，避免破坏空库 bootstrap 和现有投影。SQLite 同连接事务、幂等先于 CAS、快照和审计回执原子保存，故障不报成功。

每 scope 一个有界 collection，collection revision + entry revision；正文只在当前有效条目，删除保留标识/来源/摘要的 tombstone，旧日志不得复活删除条目。更新使用 exact revision，自动重试不能覆盖其他人的新版本。容量限制是存储/每次输入容量，不是新增累计预算。

## 真实消费者

- profile 维护路由在安装级 serviceFor 项目守卫之前，项目维护在 scoped action 的 goalId 守卫之前。人类 adapter 构造正式 Control 命令；只读 Query 不获得记忆写权限。
- 现有 MemoryView 占位与 workbench memory panel 直接成为查看/纠正/删除入口，不要求新建开发 Task。
- QueryExecutionContextCompiler 每次 assemble 读取当前 profile/project 有界快照，按接话/架构解释/进度用途选材；input 内记录精确来源及 revision。当前指令高于偏好，不改旧 Runtime 记录。
- 普通同 Task 后继 Run 的 WorkRunMaterialCompiler 也读当前快照，结合真实 work/task/source 选材，经既有 input manifest 固定。偏好变化不触发 permission revocation，不取消在途 Run；不承诺同 Run 热刷新。
- 既有 initial_coordination / execution_coordination 继续承担规划/反馈职责，不用 UI 状态轮询启动模型。任务关联必须核对 canonical focusTaskRefs/Work，不能靠界面标签声称同 Task。
- 公开经验从实际 ExecutionNote 的精确当前版本经正式维护入口导入，保留来源/条件；删除、source 失效、正式规范冲突均不能由历史原话重新激活。

## 开源复用单位

固定输入下载在 upstream/，保留原许可。Hermes 53c57871…：适配唯一子串匹配、精确重复无操作、工作副本批量容量校验和读失败不视为空的反例。OpenClaw 9e267031…：适配每次回应重读、比较正文与来源身份后才复用快照的模式。采用本产品 entry/source/revision 与 StateLedger 事务，不引入上游文件目录为第二存储权威，不复制两套调度。

实施时必须保存具体移植差异、许可通知和可执行失败用例；仅本页或下载源码不算 B05 完成。
