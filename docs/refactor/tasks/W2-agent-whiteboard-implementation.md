# W2 领域委托实现返修

本轮返修沿原 DSH Session 进行。主审刷新只读测试与本任务后再执行；只写 implementation-scope.json 已批准的生产文件。测试、fixture、工具、共享 B2/M1/C1/Runtime 与文档只读，不写主工程、不刷新 lane、不新增框架。旧 25/25 不能覆盖本轮新增断言；以主审冻结的新文件与独立检查为准。

本轮以正常 API 输入和已实现公开生命周期为依据。撤掉仅靠篡改历史记录才能制造的 receipt actor/submittedBy/goalRef 跨字段错配验收，不增加这类恢复校验或损坏数据测试；不新增尚无生产者的运行中 Role rebind 机制。主审已删除本批 7 个旧 case：直接改写 revoked V2、maintenance occupancy、recoverable health、manifest binding 的 4 项，以及由真实 finishRun 新用例替代的人工 Lease release、Session revision、Run revision 3 项。正式 recordRunResult 后的新写拒绝与提交竞争覆盖保留；fixture 专用改写方法一并移除。此裁决仅收窄本批测试，不要求删除已有共享 B2 身份/codec 检查或真实约束；fixture 种子本身不等于无效，其他正式候选与 codec 夹具继续保留。

1. **Agent propose 的真实范围。** 原 identity/fingerprint receipt miss 后，要求 draft.schemaVersion=2、basedOn 非 null，读取真实 source，确认同 Goal 且正是当前 activePlan。null 返回 forbidden，v1 返回 unsupported，异 Goal source 返回 not_found，已被合法采用操作替换的旧 source 返回 revision_conflict；均不提交候选。保持 proposal 的 issues 诊断语义，不把 apply 的全部执行规则前移为提案门槛。加入实际 source 与 Goal 的局部 guards；原 Run/claim.planRef 仍可指旧执行定义，同一 Run 在新 activePlan 上继续提案合法。
2. **准确 pins 与调用快照。** Agent propose 调用现有 normalizeCallerPlanPins 时给出真实 goalId；其他 Goal 的 pin 即使 revision 相同也 invalid。五类完整 pins 仍进入 Agent fingerprint，Host 历史指纹不变。propose/apply 在首 await 前复用现有 ownCallContext 隔离完整 ctx，保留原 AbortSignal，后续 identify/fresh/commit 使用这一份快照。调用者替换 ctx.signal 不能抹去原 signal 的取消；预提交取消零写，commit 已成功则保留 committed。
3. **复用 W1 编排。** 将当前 Host 与 Agent 重复的 future-adoption 读取/规则校验/编译编排收敛为私有共享路径，传入实际 actor、命令身份/指纹与已有 admission guards；使用现有 readFutureChangeTaskFacts、deriveFuturePlanDelta、validateFutureObligationCoverage、compileFuturePlanAdoption，不再复制算法。Host 原 initial/future 行为、错误语义、旧 ID/回执保持；Agent 不伪装 Host。共享路径只做本次需要的读取和局部 CAS，不引入 manager、第二套 validator、全账本 horizon 或新的准入协议。

保留稳定 identify → 原 receipt → miss 后 fresh Host/Role/Run/Session/Lease → 原 W1 局部编译与单次 commit。已有 B2 readStoredManifest/recheckHostRoleAdmission 继续复用；不调用模型预算/材料准入。fresh 失败重查同 identity/fingerprint 已发生回执的并发行为不变。外部 Host 配置按已冻结决策点复核，不增加跨系统全局租约。

本轮新增/加强测试仅覆盖：null/异 Goal/v1 提案；正式采用后旧 source 拒绝且同 Run 新 source 可继续；相同 revision 的异 Goal pin；propose/apply 首次真实读取期间原取消信号；正式 recordRunResult 后拒绝新写，以及 recordRunResult 与提案 commit 竞争的局部 CAS。复用当前 B2 entered fixture，不新建 Store 矩阵，不扩大产品范围。

检查 next-types；next-agent-whiteboard、next-future-plan、next-whiteboard-tools 验证共享路径兼容。只报告实际执行结果、实际文件变化和共享路径复用位置，交付后停止等待独审。future intent 字段/验收诊断仍属后批。
