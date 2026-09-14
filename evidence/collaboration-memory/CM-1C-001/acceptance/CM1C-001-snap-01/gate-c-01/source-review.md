# 独立源码审查

只读输入锁定 CM1C-001-snap-01；source-files 原始副本与当前源码全部一致。未实施或修改源码。

- contracts/architecture-review-values.ts 的 shared fold 校验 Report Run/Plan/Workspace、原始 Finding 与 baseline、Candidate→Proposal→Brief 链、当前 human/agent principal；完整 Work directory 不截断。open至少两个resume，modify新proposal、同brief、保留既有mode，decide锁定displayed digest/revision。公开body由结构化提案/完整target/actor/outcome确定并校验摘要和字节数。
- Control 负责读/决策和命令幂等，Ledger在receipt lookup之后、事务写入前重算同fold，比较完整guards/snapshots/events；SQLite BEGIN IMMEDIATE内查询当前全Work集，防止只逐行CAS遗漏新Work。决定与所有固定目标intent同事务。
- ArchitectureReviewEntry绑定本地human actor，不接受客户端授权声明；修改新建提案/候选，最终Review仍须当前原始来源。提案/Vault可在最后Review拒绝前持久化，不构成授权或自动激活。旧机械Delta来源摘要保持兼容，Brief与Delta必须二选一，materialize真实Control路径新带active baseline CAS；旧Ledger兼容形状不是本次Control放宽。
- contracts/initial-work-assignment.ts和Dispatch入口只允许 untouched Work、唯一initialRun、starting且无envelope、ordinary pending outbox、精确role/plan/principal。参与关系最终Ledger重查；不得从grant失败补身份，不接管已有参与历史。先注册Agent中断可留未参与身份，重试确定性复用。
- 架构投递在领取的精确generation/owner/lease内重算review/decision/target/current Work。Delivery、可用真实predecessor Wait、intent done同事务；无参与/前驱留明确unavailable。canonical architecture Wait为all且仅一份精确决定Delivery，Control/finalLedger均拒绝删集/换料。
- 既有DeliveryMaterialCompiler负责当前grant、Vault正文digest/size、SourceApplicability capture/recheck以及每次provider边界复核，未由Control跨Module读取Vault。接续Reference正文明确不是新的权限或基线授权。
- service的人的决定、原Run结束和重启分别触发有界drive；持久intent/lease/CAS/模型执行许可处理并发。读侧逐Work派生Delivery/admission/InputBinding/ModelRequestEvidence；读取后检查事件frontier，有变化则有界重试，避免旧证据地平线混新Run终态。attempted只指provider尝试，未冒充回应或任务完成。
- UI呈现精确版本与原始reportSummary，修改后仍待决；未知网络结果保留原requestId/输入重试；项目/Workspace键隔离挂载。只读查询不自行调用模型。偏好维护与Review事实及工具权限权威分离。

未发现可复现的新增阻断缺陷。恢复证据是明确进程内故障注入后关闭/重开与并发drive，不夸称本票做了OS强杀实验；现有A通用强杀能力仅按未变范围引用。