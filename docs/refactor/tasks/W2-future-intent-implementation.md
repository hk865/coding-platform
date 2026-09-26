# W2 未来意图：中审冻结后的实现

仅在主审完成骨架/测试导入并创建本次 implementation lane 后执行本任务。原 `W2-future-intent-skeleton.md` 是唯一详细契约；以其中§9.5政策读取决定和本文件为最新阶段指令。本次是第二阶段，不重写骨架/测试，不再执行旧§9回退指令。

## 阅读与目标

先读原任务书、CODE-QUALITY-GUIDELINES §2.1、DSH-WORKFLOW/DSH-EXECUTION-HARNESS、当前HANDOFF及相关Plan/claim源码。真实基础意图可先采用，assignment/acceptance未齐仍在图中；plan_only不领取，显式request_execution有合法分配后可调查，完成仍未被证明。两个新增测试按真实writer/SQLite/factory产生事实；它们冻结，只读。旧R3c-task-graph缺assignment的纯夹具已由主审补齐，不能为旧坏fixture发明declaresAssignments豁免。

## 唯一生产写范围

按 `W2-future-intent-implementation-scope.json` 仅五文件：plan-validation、plan-service、eligibility、claim-service、plan-readers。类型/codec/工具说明已中审，默认只读；不写所有测试、composition、Kernel/vendor、旧工程、工具配置。全部原地写，不用同级临时文件/rename。若冻结接口有具体不足，报符号与最小原因，不能自行扩scope或放宽测试。

1. 用同一validator支持显式意图分支；基础形状、已有承诺与future-only规则保持。初始仅plan_only Plan合法；合法request_execution无验收也可采用。完全未标新字段的legacy空/optional-only非法形状不借新分支放行。
2. 同一资格函数判断plan_only及缺唯一assignment，query与claim共用，claim在写Run/Attempt/Lease/outbox前拒绝。角色权限仍由原真实Role/Session边界核，不在只读候选里加Host/完整执行链读取。
3. 首次分配、显式激活、新节点/新义务/新gate复用原future delta、受影响task facts与唯一compiler/commit。保留旧义务、旧gate和已分配角色；已执行定义不改。删字段不能静默激活。
4. future apply删除原tryPolicyContent的active读取；新增obligationId才读取source.effectiveCompletionPolicy精确ref+digest并合入局部guard；无新增义务只结构与原义务保护，不重读政策。propose机会性诊断保留。pinnedreader复用现有解析/digest，不复制治理管理层。
5. Task/Goal planning诊断从本次已读Plan+canonical facts内存投影；required且active/deferred无义务/无Run节点仍解释unfinished。空诊断不等于可完成，普通图读不新增材料/Host/政策I/O。
6. 原请求receipt先行、fresh失败/CAS后回查、输入隔离、同Task局部竞争沿既有W1/W2实现；不得多建事务或全图/全账本锁。

## 自检与交回

`python3 tools/dsh-refactor/check.py next-future-intent next-future-plan next-plan next-task-relations next-task-claim next-whiteboard-tools next-agent-whiteboard`；next-types、next-architecture各自单独运行。仅本批风险，不跑全仓通用矩阵；其它并行批次的明确红测不作为本批失败或修改理由。

报告实际差异/复用、每个目标是否真实达到、尚存限制、检查与scope hash，完成即交回主审。代码量与性能只报实测；不能宣称Workflow自动推进/整个R3c/最终产品已完成。已删除的运行中Role热切换、内部篡改防御或未知状态假成功不得恢复。

## 独审窄返修：显式意图与 required/active 数量正交

初版实现已STOP，原冻结10项及邻接148项通过，但plan-validation仍无条件要求至少一个required+active work，违反原任务§3已冻结的显式意图数量豁免。正常公开输入的 optional+active plan_only、required+deferred plan_only 应可保存/采用；唯一active意图节点通过future apply改deferred也应可行。

本次仅改 plan-validation.ts 的旧missing_required_executable_task触发条件：缺required+active work且没有v2显式意图work时才保留旧拒绝。保持legacyRequiredWork分支的原gate/obligation/mapping、所有既有输入结构和future-only/CAS；不放开legacy空/optional-only，不添加任何Hot Role逻辑。其它四生产文件保持已审字节。主审补的真实公开采用/未来修订测试已冻结只读，先确认本次红因，不修改测试或接口。

自检 next-future-intent next-future-plan next-plan，单独next-types；完成即STOP，报告最小diff/hash。此改动仅允许记录和推迟意图，不让optional成为必做、deferred可领取或任何节点自动完成。
