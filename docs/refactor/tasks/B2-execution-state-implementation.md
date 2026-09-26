# B2 执行状态第二阶段：实现冻结接口与中审测试

Astra已中审骨架和修订测试；本任务授权第二阶段实现。先读同目录 B2-execution-state-skeleton.md、DSH-WORKFLOW.md、CODE-QUALITY-GUIDELINES.md 和真实上下游。中审记录见 reviews/next-b2-c1-middle-review-2026-09-26.md。实现仅本scope JSON的12个文件；全部测试/共享contracts/接口只读。旧src/tests仅参考；只在next实现。使用Python/Node原地写文件，禁止rename/probe/扩大scope/修改全局配置。

复用原RecordStore事务/幂等、WG11、WG12、Role/Material判据，不创建第二执行引擎/数据库/Context总管。新增service内部可导出窄的共享准入helper供model-call复用，不能复制一套授权算法。源码保持可读，函数按真实职责拆分，避免巨型函数和类型强转绕过检查。已有outer @1兼容；新增V2/inputBinding/envelope/Lease.release/dispatchState严格校验，旧事实可读不意味着可运行。

中审18条测试在正式初始化后红于unsupported，类型通过。现使用正式claim→持久manifest→authorize→begin→entered回执；permit.authorizationRevision是binding自身版本，阶段变化递增，不能当Run revision，也不能猜。每次写仅接受冻结的exact expected pins，原request replay先恢复旧receipt，不用后来状态冒充。begin slot必须与WG12同源，同Run可继续持有，其他Run不可占；只fresh begin授权Kernel，未知不能再begin。

Host配置callback是独立固定且可撤权的可信提供者。authorize/begin/actual-model issue和consume重新核当前Host/Role/Session/Lease/material/deadline；后续旧owner terminal历史补写不要误套新动作占用规则。Host外部回调没有跨系统原子性，正式记录用局部guards；不造全工作区门禁。选中材料必须走原current授权，不能用metadata存在代替正文/来源。若原MaterialPort不能返回必要grant guards，给主审准确最小接口缺口，不复制材料规则或默默跳过。

WG12现有pure compile提取到冻结helper，entered/result共用并一次commit，无嵌套公开writer事务。Run terminal不等于Task satisfied；缺complete Turn边界拒绝释放。同代Session/Lease/outbox/Attempt一次更新，保留Lease release版本和links/discovery。迟到旧代仅改自己的正式执行事实，不动继任占用/cursor。event去重必须含来源/历史/boundary。

模型permit保持issue和一次消费，Run及permit pin精确，permit持久1→2且回执重开可重放。replayed不允许provider，Runtime负责实际消费。不要伪造ack或另建meter。

自检 python3 tools/dsh-refactor/check.py next-types、next-architecture、next-execution-state；回归适当合并next-task-claim、next-execution-history、next-execution-read、next-future-plan，先查check.py实际键名。测试不足由主审据真实反例修订并明确刷新，不允许实现者修改测试。报告真实失败与复用、records/events注册依赖及scope缺口。交付后停止等待独立审阅，不能宣称整批产品闭合。
