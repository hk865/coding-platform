W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。本阶段只交骨架和行为测试，交 Astra 中间审核后停止，不实现业务。后续另阶段仅生产文件可写。原 src/vendor 源码只读参考，不提交、不安装、不访问模型网络、不读取凭据。单文件挂载要求原地写，不能 rename。

先读 docs/PRODUCT.md §3/5.4；docs/refactor/intent/ORIGINAL-DIALOGUE.md:975-985；ARCHITECTURE.md §2/3；IMPLEMENTED-CAPABILITIES.md WG5/WG6/WG11/RT7/RS1；modules/core/work-graph.md §6 与 agent-runtime.md §7/9；本批冻结 src/contracts/core/execution-history.ts、tasks/execution-history-contracts.ts。图是可操作数据结构，结果维护定位以避免后续重复寻找；不另建图、日志、Manager、Repository。宽读上下游，窄写scope。报告“需求→已有符号→最小接线→测试”，不新建解释文件。

本批将 locator 保存为现有 RunSnapshot.executionHistory 可选字段。旧Run缺字段=未索引，不等于未执行。工厂 createExecutionHistoryService(deps:ExecutionHistoryWriteDependencies):ExecutionHistoryWritePort，写在 tasks/execution-history-service.ts。persistence/execution-history-codecs.ts 供共享纯校验和事件codec，必须导出 isRunExecutionHistoryV1(value:unknown):value is RunExecutionHistoryV1 与 EXECUTION_HISTORY_RECORD_SCHEMAS（records为空，events注册ExecutionHistoryRecorded@1）。当前 material Run validator已导入前者，fixture已注册后者；不要复制/再注册Run schema，不改冻结文件。

recordExecutionHistory只接可信Host human/system，ctx project/workspace/principal/materialReader actor均绑定；query/work_run不能调用。同步隔离ctx/request，signal原样，取消后不提交。GraphWrite.meta.expected精确一个目标Run的正整数revision pin；不替换调用方expected。身份/指纹复用canonicalJson/sha256，与project/workspace/actor/requestId作用域绑定。先lookupCommit，重放用原事件eventAt恢复原runRevision/history，即使后来水位增长也返回原结果；同requestId不同内容idempotency_conflict；新requestId相同内容按正常CAS新提交，不能冒充replayed。

首次调用用既有createRunStateReader.readExecution核Run/Attempt/outbox/Plan/Session关联和scope；SessionRef从claim取，不由请求指定。kernel.adapterId/kernelSessionId须与Session映射一致；Kernel runId/turnId不为空。起点/水位/非null终点都为安全正整数，start<=observedThrough，start<=end<=observedThrough。observedThroughPosition是已连续检查的原Session位置水位，非模型完成信号。首次绑定固定完整kernel身份、Session和start；后续不换身份/起点，observed不能回退，end首次写入后不可清空/改变。读取端用end??observed上界，仍检验run/turn归属。

一笔PreparedCommit：完整保留所有Run原字段、revision+1、executionHistory；一个ExecutionHistoryRecorded事件保存原返回值与身份/指纹/actor；existing unique claim slot约束Kernel(adapter,session,run,turn)永久只归此完整RunRef。首次null→owner，推进owner→sameOwner。guards核所使用Run/Attempt/outbox/Plan/Session版本，不guard当前Lease、不ledgerHorizon、不要求当前Session占用仍属旧Run。只更改Run locator/event/unique slot/幂等行，不变Run.status/Attempt/Lease/Session/historyCursor；starting可保存实际历史事实，不能捏造entered/完成。WG不反调Kernel，调用方负责提供已核验原始证据，后续Runtime entry复用该维护能力；本批主集成会用真实Kernel来源验证完整查询链。

错误：输入非法invalid；跨scope/Session映射不符forbidden；CAS/已固定绑定冲突revision_conflict；唯一槽抢占busy；Run缺失not_found，关联缺失incomplete；损坏/未交代key/unexpected存储失败unavailable。前者ReadResult不能直接当WriteResult，显式映射，保留错误含义。复用readMany/Store commit/events，不能全量扫事件/所有Run，不新增表/索引系统。codec严格验证存在的嵌套字段、project一致、范围与事件外壳一致；形状validator与写规则共用，不复制另一套。

本阶段骨架工厂真实返回unsupported；共享validator可暂时return false、事件decoder明确invalid，并留下文件内职责注释；测试因此失败而非加载/类型错误。类型检查必须通过。测试只写 tests/work-graph/R4c-execution-history-index.test.ts，复用tests/helpers/task-claim-fixture.ts真实Memory/SQLite和claim（不要拷贝整fixture）；fixture已增加事件schema。覆盖首次/增长/完成/不可回退/不可换身份，重放原结果、CAS竞争、不同Run抢同Kernel身份、SQLite重开、旧Run/当前占用变化/starting语义、scope/输入突变/取消、损坏codec、失败提交全回滚。验证WG11读出locator且查询规模不随无关Run增长，不直接mock成功结果。重放恢复事件需真实Store。

运行 python3 tools/dsh-refactor/check.py next-types 与 next-history-index。返回复用说明、红测原因与测试数，停止等待主审。禁止直接实现以求绿。
