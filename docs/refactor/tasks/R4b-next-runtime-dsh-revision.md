阅读顺序（现有真源，宽读窄写）：先读 /home/hyh001/projects/coding-platform/docs/PRODUCT.md 的任务/Session相关语义；/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md 与 module-dag.md 的当前五模块边界；再读 docs/refactor/modules/core/ 的本模块与直接上下游相应章节（work-graph/record-store/agent-runtime），以及 docs/refactor/DSH-WORKFLOW.md §3。然后读下列实际接口、骨架、测试和本批约束；需要原意时定点查 docs/refactor/intent/ORIGINAL-DIALOGUE.md。只读依赖不等于不存在，不得用默认值代替未读取事实。沿用本批 scope，不能因阅读上下文扩大就扩大写范围。

Runtime候选仍未验收。下一轮接入已刷新WG provider后修正并运行全部真实测试（next-session-runtime + tests/runtime/R4b-session-recovery.test.ts）：
1. createSession / readSessionHistory 必须在首await前复制并验证请求；目前register还用外部可变request.meta，历史读也在await后用原cursor/limit。必须避免调用中修改影响已受理操作/水位。不要clone AbortSignal，只clone请求value。
2. history basis.ref 必须是平台SessionRef（来自request/card），不能填KernelSessionId；legacy映射两者可能不同。cursor绑定platformRef+kernel adapter/session+可信主体+上界/位置。公开limit范围1..200，异常与超限返回invalid；数据缺失/损坏fail closed。
3. await databaseFileExists 在try外，EACCES等会reject Promise，应映射unavailable。create持久受理后任何Kernel side effect不确定仍可按原Operation恢复，错误不生成替代Session。
4. 保留首次一次full capture复用避免循环每页重复全量取材，继续如实记录冻结Kernel每页物理全量成本；本轮不改Kernel私SQL，也不声称性能已经有界。read with explicit throughCursor或continuation也须检验真实位置1存在且原Session身份一致，不能删除首记录后仍返回看似有效后页。
5. root新增完整工厂close会排空Session操作。保持withStore finally关闭，不主动新建缺失legacy库。再跑真实两Store+Kernel+故障注入，stub只能辅助debug不能验收。禁止测试/共享types/WG修改。

第三轮主审（第二轮未导入；仍只允许原2文件）：
- WG内部SessionCreationInput增加kernelStore:{adapterId,storeKey}，公众CreateSessionRequest不增加。Runtime首次admit提供受信forWorkspace定位的pin；收到admitted后只用operation.action.kernelStore解析原adapter，核对storeKey、workspace、current注册，不能再根据默认选择目标。若default变化但原pin未注册，拒绝且不创建新库；恢复原配置后同request可成功。
- WG会使路由建议不进入业务幂等指纹，重试按原action。若无当前默认且需要查已有操作，禁止随意编造pin，给出明确unsupported；可以后续专项扩展该配置场景，当前至少不制造第二Session。
- 原cursor为内部查询书签而不是授权token，主审不要求添加MAC/secret/cache。每次仍核对真实Session和可信scope，不弱化已有upper/binding/position检查。
- 新增真实SQLite恢复反例只读提供。依赖WG候选仍由主审刷新，不能自改WG或测试。测试通过仍待主审验收。
