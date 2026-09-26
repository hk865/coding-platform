# R4.1 持久控制实现：中审冻结后的第二阶段

2026-09-26 中审已通过并导入九文件骨架。执行本第二阶段，唯一写范围见 `R4-control-intent-implementation-scope.json`；在主审新建的当前工作树快照 lane 中运行。详细契约以R4-control-recovery-skeleton.md §9为准；§10/11是其他批次，不在本次实现。

## 范围与复用

生产中审已确认仅control-service.ts、control-record-codecs.ts与execution-entry-service.ts三生产文件；接口、组合根、Run reader接缝和全部测试冻结只读。最终测试已冻结，不得自行扩大。旧工程/Kernel/Runtime/model-call service均只读。

- submit/read复用同一Run authority、Store身份、eventAt和局部guards；Host停止请求不重走模型Role/material/全计划准入。control intent与Run指针同事务，queued不等于已停止，不释放Session/Lease/Attempt。
- 原identity/fingerprint回执先恢复；fresh确切Run版本/status/desired-state判断，确定冲突保留code/current；提交失联同键恢复实际found才committed，无法确认时unavailable未知，不宣称提交前失败。读/提交合法await期间原signal取消须按原契约零新写，已提交事实不回滚。
- 中审已逐行审核保留 `runControlStateProblem` 窄 Run reader 形状接线；其余 controlState codec 保持旧无字段/合法running-steered可读；新的pause/cancel gate只在已审三处：authorize/begin及shared admitEnteredRun。四fresh事务保留精确Run guard，issue成功不意味着consume已获准；控制在issue后到达仍阻止新consume。
- entered/result/history/replay不加fresh控制gate；保留已发生来源及自然terminal。当前driver旧pin自动补entered仍归R4.3，不以领域测试冒充已经自动恢复。
- 不创建通用控制管理器/第二状态机/全账本或workspace锁，不添加Role热换或直接内部篡改校验。仅用既有唯一codec/helper，接口与schema注册不重复。

## 验收和停止

执行主审最终冻结的next-control-intent及next-execution-state/next-b2-composition；types与architecture单跑。测试不足先报告真实反例，由主审审阅刷新，不自行改测试。文件原地写入，不用同级临时rename，不安装依赖。目标与相邻检查通过后STOP交回hash/实际行为/范围审计；R4.3信号投递/ack/恢复和完整capability本批不声明。

## 已冻结基线

骨架与中审证据为 `reviews/evidence/next-b2-2026-09-26/control-intent-skeleton-import.json`，lane 内 evidence 不挂载；以下 hash 可直接核。目标测试 `tests/work-graph/R4-control-intent.test.ts` 为 `4fd322ebf815cfa78b4a1b0aa5b00c668018dac90327fa7887b6001f0befadc3`；`tests/composition/R4-control-platform.test.ts` 为 `6c3bb6a049f965541dd5ac6e71a95918c8d2472c06fd1e00bbda2a1c2d95463b`。两轮独立复验均为19个unsupported目标红、30个邻接通过，类型通过。接口/测试/组合根/Run reader 只读；主审已同步平台 keys 的 controls 一行。先读当前 HANDOFF/能力索引对应条目、质量规范 §2.1、原任务 §9 与上述返修语义，再读取实际三文件及相邻 Store/材料 authority 原实现。不要借新异常处理重造通用事务层。
