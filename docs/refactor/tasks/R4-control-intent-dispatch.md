# R4.1 持久控制意图：只交骨架与测试

状态：2026-09-26，R5a/R4.2完整隔离102文件1007项已通过。主审已预建本批新文件、注册检查项并批准隔离骨架阶段派发；本轮仅执行下文Stage1，不得继续实现。

本轮只执行 [R4 主任务 §9](R4-control-recovery-skeleton.md#9-r41-第一阶段施工契约durable-intent-与四个-fresh-屏障)。§1–8 是生命周期背景，不是当前写授权；七生产、两测试唯一范围见 [scope](R4-control-intent-skeleton-scope.json)。§9.5 为最终文件清单，不采用 §7 的旧候选范围。R4.1 与 R4.2 的强制先后依赖已解除：R4.2 可独立补 Kernel 工具组屏障，本批不修改其代码或产物；§7/§9 开头的旧串行措辞不得扩大或阻塞本批。R4.3–R4.5 的投递、ack、owner 证明、预算恢复和原 Run resume 均不做。

先读 docs/AGENTS.md、当前 HANDOFF、IMPLEMENTED-CAPABILITIES 的 B2/M2/Run 与组合根条目、CODE-QUALITY-GUIDELINES §2.1、DSH-WORKFLOW/DSH-EXECUTION-HARNESS，并沿 §9 所列实码核对提供者与消费者。原工程只读，next Runtime/Kernel、model-call service/contracts/codecs、dispatch 和 shared fixtures 均只读。原地写入，不用同级临时文件 rename；不安装依赖、不改检查注册或文档。

## 阶段一生产边界

声明 §9.2 的完整 DTO、RunControlPort 与依赖；submitControl/readControl 明确返回 unsupported，不提前实现提交、回执恢复、状态归约或权限判据。新 codec 导出完整签名/schema 名，注册集合按 §9.5 为空占位，不提前实现 validator/reducer；不重注册 RunSnapshot。旧无 controlState 的 Run 必须保持可读，新字段校验接缝不能把缺字段旧路径变成 unsupported。

复用现有 Run.controlState、唯一 MaterialAuthorityReads 的精确 Run load、RecordStore CAS/receipt/eventAt；不新增 ExecutionEntryDependencies.controls、状态表、全局 horizon、缓存或授权管理器。freshRunControlProblem 只在 authorize/begin 的 receipt miss 后及 admitEnteredRun 三个位置预置：无 controlState 保持旧行为，有 controlState 在骨架阶段明确 unsupported。model issue/consume 原本共用 admitEnteredRun，不添加重复分支。不把 gate 放进 readAdmissionFacts，不改 entered/result/history/普通读和原回执重放。

组合根复用同一 records/reads.authority 构造 raw control service，只注册本批 schema 集合一次；公开 platform.controls.submitControl/readControl 均纳入原 trackedCall/close，无 Runtime Host 也可调用。骨架不投递信号、不启动后台 Promise，不改变 safePointPause/cancel/recoverRun capabilities。目标结果是 queued 受理，绝不是物理暂停或取消完成；完整实现只在中审冻结后的下一阶段发生。

## 两份目标测试

只在 scope 两文件内写最终行为断言，不以期待 unsupported、跳过或 raw seed 制造绿。复用 createB2ExecutionFixture(kind, additionalSchemas) 及 CONTROL_RECORD_SCHEMAS，真实 claim → authorize → begin → entered → model issue/consume 前态通过公开领域 writer 产生；允许沿已有夹具治理种子，不可直接写 Run/auth/permit/terminal 或伪造 Kernel 停止。门闩只在正式前置完成后启用，首红与门闩进入竞争，错误早退必须能释放并排空，不能等待尚未到达的事件直至超时。

六组目标严格沿 §9.6：持久回执与 pause→cancel；控制已有时四 fresh 操作受阻；真实最后读后/commit 前控制竞争；原回执和已发生 entered/自然 completed 不被新 intent 抹去；Host 执行配置撤权后仍能停止请求及身份/原子性；无 Runtime Host 的真实组合重开和 close 排空。不扩 Memory/SQLite 全矩阵或运行中 Role rebind/tamper 场景。

四屏障竞争用原 records.commit 外薄包装，在原 batch 提交前调用原 backend 上的真实 control writer；禁止递归拦截或直接篡改 Run。核 control intent 与 Run 同事务、目标授权/permit 未变化。model issue 不等于 consume，已 consume 后的新控制不能倒推本次 provider 未获准。已发生 entered/terminal 可用当前 Run pin 按原身份事实写入，但必须如实说明这只验领域入口，现 driver 的旧 pin entered 自动重试不在本批。

组合测试在真实 SQLite/正式 Run 上调用 platform.controls；close 反例用测试内薄包装挂起真实 authority/records 的必要异步调用，再验证 close 等当前调用结束、重开可读、关闭后新调用拒绝。包装必须转发真实提供者/结果，不新增生产测试接口，不用固定 sleep 或未跟踪 Promise 冒充排空。新骨架的后段测试不能到达时，在报告中逐项标为未到达，不能把首个 unsupported 归纳成后半链已验证。

## 检查、交付与停止

主审已注册`next-control-intent`（上述两新测试）；相邻直接复用`next-execution-state next-b2-composition`，前者已覆盖entry/result/model三文件，不新增重复别名。运行`python3 tools/dsh-refactor/check.py next-control-intent next-execution-state next-b2-composition`；`next-types`和`next-architecture`分别单跑。DSH不得自行改check.py或检查集合。

完成骨架与目标测试后立即 STOP，不进入生产实现。交付精确文件 hash、types/邻接旧绿、各新 case 的真实首红位置/code、被前置首红遮挡的后段和未达门闩；注册集合占位时不得声称 codec/schema 行为已通过。中审冻结后下一阶段测试只读。最终隔离与能力声明由主审完成，本轮不宣称实际 pause/cancel/resume 产品闭环。
