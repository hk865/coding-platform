阅读顺序（现有真源，宽读窄写）：先读 /home/hyh001/projects/coding-platform/docs/PRODUCT.md 的任务/Session相关语义；/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md 与 module-dag.md 的当前五模块边界；再读 docs/refactor/modules/core/ 的本模块与直接上下游相应章节（work-graph/record-store/agent-runtime），以及 docs/refactor/DSH-WORKFLOW.md §3。然后读下列实际接口、骨架、测试和本批约束；需要原意时定点查 docs/refactor/intent/ORIGINAL-DIALOGUE.md。只读依赖不等于不存在，不得用默认值代替未读取事实。沿用本批 scope，不能因阅读上下文扩大就扩大写范围。

主Agent独立审阅拒绝当前候选，须返修以下真实问题，不能以8绿自验收：
1. getSessionOperation须核对持久operation.workspace与ctx；recordSessionCreated早期replay也必须核对原事件中冻结workspace/原operation，不能同project其它workspace返回旧回执。ctx signal与Host actor身份完整检查。你的命令identity只project/requestId会使不同actor共享operation；identity/稳定ID/fingerprint都从可信Host actor+project+requestId确定（或保留project唯一键但异主体必须冲突，不能回放别人结果；本轮选前者）。
2. findSessions扫描上限1000时不能推进未处理的第1001行cursor；nextCursor指向最后确实处理过的键。readSessionLinks不得500条后静默完整；达到预算显式incomplete，或有界分页完整读取。target查询利用target+scope的注册lookup优先筛选，避免对最多1000个Session逐个扫links（N+1）。role/includeArchived可用Session注册lookup精确索引，输出卡片才读其必要links，不能先给每候选建完整卡片再筛。权限/主体验证应入cursor且canonical水位一致，空页不能隐藏后续候选。
3. 初始link不能对不存在目标生效。Task目标读真实Goal（workspace匹配）、activePlan成员并放相应CAS guards；不存在拒绝。Module/WorkContext当前缺canonical目录provider，明确unsupported，本批不写假关联，后续R3d关闭；不要造一个任意ID集合当provider。主测试已改为真实acceptedPlan/Task prerequisite验证since，另补不存在目标拒绝。不得为了旧未种目标的fixture放宽规则。
4. SessionWorkLink注册schema必须拒绝最终since:null。Store已经支持先机械预检绑定占位、取真实cursor后严格schema；编码占位可局部允许null，但最终validate必须严格，不能让直接PreparedCommit持久null。
5. 保留原Operation/Session事件用于重放、单事务claim映射，input clone beforeawait。候选1.7千行先完成正确性；不要另造空Repository或重复校验系统，已复用的纯helper保持单实现。
Store已独立通过，测试已经以readonly刷新。新的next-session-directory包含R4b-session-boundaries；补充反例由Sol完成，不能改。production工厂schema包含Plan/State等由root接入，不修改composition/sharedcontracts。
给出具体实测。旧stub断言obsolete由主Agent修成无授权拒绝，不能由你改独立测试。开始返修，scope仍仅2生产文件。

第三轮主审（第二轮仍未验收；只允许原2个生产文件）：
- role_spec注册lookup错用role.pin.ref.digest，实际是role.pin.digest。改为正确路径并过真实筛选反例。
- 必须合并主仓原codec已有scope约束：operation.ref.projectId == action.workspace.projectId == action.plannedSessionRef.projectId；SessionWorkLink的target project == link ref.projectId。正式records和事件内嵌同样验证，不能依赖某条写路径已校验。
- 接口补强：SessionCreationInput required kernelStore:{adapterId,storeKey}，内部Runtime按受信配置提供；持久action保存它。路由建议不参与业务指纹（同业务请求换default后需重放原pin）；业务字段/actor/expected等保持原指纹。首次受理验证非空pin；recordSessionCreated的adapter必须等于原pin。正式codec检查该pin，不能仅类型断言。
- 主审在集成前协调Plan provider刷新；测试不可写。不要把snapshot只读依赖视为你拥有写权限。
