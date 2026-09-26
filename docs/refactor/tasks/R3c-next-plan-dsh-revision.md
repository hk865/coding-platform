阅读顺序（现有真源，宽读窄写）：先读 /home/hyh001/projects/coding-platform/docs/PRODUCT.md 的任务/Session相关语义；/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md 与 module-dag.md 的当前五模块边界；再读 docs/refactor/modules/core/ 的本模块与直接上下游相应章节（work-graph/record-store/agent-runtime），以及 docs/refactor/DSH-WORKFLOW.md §3。然后读下列实际接口、骨架、测试和本批约束；需要原意时定点查 docs/refactor/intent/ORIGINAL-DIALOGUE.md。只读依赖不等于不存在，不得用默认值代替未读取事实。沿用本批 scope，不能因阅读上下文扩大就扩大写范围。

本候选未验收，不能导入。已独立确认须修复：
1. effectivePhase一律pending、lease一律free违反核心事实工具设计，即使eligibilityScope=task_state也不可忽略真实Run/TaskLease/TaskReduction。主Agent/Sol新增三个具体私有骨架：plan-readers.ts读取canonical、plan-validation.ts接纳纯规则、plan-commit-compiler.ts纯编译。新增允许这三文件，原四文件继续可写；禁止另一套同义实现。把现有函数提取过去并实际调用，不是导出空文件。两千行大文件应拆成清楚的职责，不新增服务层。
2. PlanReader批量read所有任务精确Lease/Reduction keys，Run-by-goal注册lookup分页+canonical复读；匹配本Plan/ref/任务，不全库扫描，不每task全表扫。没有registeredschema/index或不可解码就incomplete/unavailable，不能算free/pending。真实task没有这些记录时才可以默认pending/free；有running/leased/blocked/reduction不得当ready。schema注册PLAN_STATE_RECORD_SCHEMAS已由Sol给出，Run codec复用materialRecordSchemas（root/test组合）。需要治理read codecs同步供生产工厂注册，不能只在测试fixture有schema。
3. 治理pin.ref.revision是内容revision，底层immutable Snapshot聚合revision固定1，Store guard必须用读取的记录revision；请覆盖contentrevision>1。
4. queryGoal pending lookup不能把unsupported当null，需分页直到正确停止条件，不能只前200。所有读窗口Goal→Plan→状态必须相同readThrough或重读/拒绝；不能给旧Goal指针贴上较新水位。正式写完整guards+最早read horizon。
5. ctx.workspaceId缺省只允许真实host project-scope只读；非host必须核对其实际scope/授权，不能以project字符串任意枚举。页cursor绑定可信principal以及scope/filter/version/watermark。同主体重放不能受当前最新状态影响。
6. v2变更仍按已冻结§6明确拒绝，不凭决定refs伪授权。legacy_v1如实可读，不伪draft。来源origin缺provider可unsupported，不假成功。
独立反例已加R3c-canonical-task-state；next-plan能力将包含它；tests/contracts/ports仍只读。共享必要旧TaskLease/Attempt/Reduction类型已机械迁入，Store扩展已主审验收提供；不改这些文件。如果新骨架签名确实错误/依赖缺失，给精确问题，不私自逃过测试。
完成后跑 next-plan/next-types/next-architecture，给出全部固定检查的结果及真余项。不要自行写horizon-shim假backend当验收证据；仅真实Store可过本批验收。开始返修。

第三轮主审（第二轮仍未验收；仍只允许原7个生产文件）：
- 主审承认 R3c-plan-adoption 数组 toMatchObject 原断言不严谨，Sol 已改为显式完整3任务。删除 materializedTaskIds 的图过滤：任务图全部Plan任务一直存在，Run/Lease/Reduction只更新其状态，不能为了过错误断言改变产品语义。
- `readLookupKeys` 候选集合和后续canonical readMany必须同readThrough；新Run可能在lookup结束后出现，复核Goal指针不够。水位变化重试完整读窗口或明确not_ready/rejected，绝不漏Run但标新水位。queryGoal的pending候选同理。
- 已存在ended Run（尤其outcome_unknown/failed/completed）且尚无相应TaskReduction/正式requeue时，不是从未执行，不能退为pending/free而入ready；本批没有requeue实现，不伪造。可incomplete或保守阻塞，但不要隐藏整个TaskGraph。
- 新增真实Store反例由Sol/主审冻结，next-plan必须运行；禁止修改测试。返回修复后的实际检查结果，不自行宣告验收。

第四轮精确返修：前三项已独立复测通过，但 queryGoal 仍会混合新Goal与旧basedOn候选。service读旧Goal→findPendingProposal用旧activePin过滤→读窗口变化后只复读并替换Goal，不能保证返回pair一致。请让findPendingProposal同batch实际解码Goal并核对传入revision/activePlan；发生变化返回source_stale/revision_conflict或完整重试。service尾部复读也只能在Goal revision/pointer一致时沿用pending，不能用freshGoal与旧pending拼接。新真实双后端反例只读提供；不改接口、不新增层，仍原7个文件。生产返回明确读冲突是允许的，不需为并发读强制成功循环。next-plan/next-types必须实跑，不全量无关套件重复跑。
