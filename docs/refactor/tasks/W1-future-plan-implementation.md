# W1 实现：现有 Plan 白板的未来任务修订

此任务只在主 Agent 完成骨架/测试中审、冻结后派发。完整规范、源码复用位置和边界以同目录 `W1-future-plan-skeleton.md`、WorkGraph §5.1、当前冻结骨架与两份 W1 测试为准，不另做设计。只允许 scope 的七个生产文件，测试和相邻模块只读。

复用现有 propose/apply/queryTaskGraph/queryReadyTasks/readTaskInput、Plan codec、事务/幂等、定向 Run 索引与 TaskLease/Reduction 精确读取。实现 source/draft 纯差异与验收覆盖、compiler-only taskStateBasis、跨 Plan 原事实读取和局部 CAS。不能新增表/端口/服务/图，不能复制或改写旧 Run/Reduction/Session，不引入全账本水位或预先并发证明。提示关系与展示 parentOf 不是执行定义，不能借修改它们阻止无关运行。历史查询排除后续版本 Run 及其 Lease；当前 ready/claim 的 active Plan 边界保留。

同请求 lookup miss 后 peer 提交而导致读到 accepted proposal/新 Goal 的拒绝路径，应精确回查一次原 receipt；不在后续重放时返回最新 Plan，不无限重试。W1 仅 Host 的已授权 future-only 修订，角色授权变化、目标/验收语义变化、原 gate 变化仍明确不支持。本批不冒充 Agent 已自动规划推进。

复用与简洁性：纯 basis/helper 不拥有 Store/Port；compiler 不读库，reader 不编译写入，service 连接现有流程。不要为每项守卫建类或重新解析同一快照；origin Plan 按唯一 ref 批量读取，局部修改不扫描全 Session/事件。原初始 Plan 行为、旧 v1/v2 读取与原先后端语义保留。

中审补充：同一 Plan 的 task/assignment/input/obligation 可构造调用内 Map 一次复用，避免逐任务对整份计划反复 find/filter/序列化造成平方级扫描；它是现有纯 helper 的内部算法，不是新索引服务。历史 Lease 只在已知 holderRun 确实属于后续或不适用 Plan 时排除；Run 缺失/不可读不是 free，保持既有保守占用或 typed failure。basis 的定义来源也要核同 Goal 与语义，不能只核同 project。主审把测试改为在真正 commit 前追加无关历史，并用实际 graph reader 检验 shape-valid 的义务语义损坏；以当前冻结测试为准，不退回第一版错误断言。

实现后运行 W1 两文件、现有 R3c/Claim 的相关测试集合一次及类型检查；发现失败先定位契约还是实现，不可修改冻结测试使其变绿。禁止安装依赖、提交、修改旧源码、Kernel 或 B1。全部原地写入，额外临时文件仅测试临时目录。

交付真实调用链、复用/新增说明、实际检查输出与剩余限制，然后交主 Agent 独立审阅；最终物理隔离验收由主 Agent 完成。
