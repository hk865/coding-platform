# R3e.1：接通已冻结 Goal gate 的正常入口

沿原 lane `r3e-evidence-implementation-20260926` / Session `session-19b904b6-cd27-4afa-bddb-568be54cc538`，最新五项窄返修已 STOP。只补主任务 §5 与 §9 已冻结、下一正式完成链必经的一处接口实现遗漏，不新增测试或扩大矩阵。

现 `evidence-service.ts::openVerification` 无条件要求 `run.task.taskId === input.subject.taskId`，而 `gateSubject:'goal'` 仅保存到 identity，导致不能 claim 的 Goal gate 永远无法以同 Goal 已结束普通 producer Run 开独立 round。此为实际正常路径阻断，不是内部篡改防御。

仅在原五文件最大 scope 内修改 `evidence-service.ts`：
- 普通无 gateSubject 路径保持原 subject/task 精确匹配。
- 显式 gateSubject 时，核请求 subject 是正式采用 Plan 上 `taskKind:'gate'`、`scope.kind:'goal'` 的节点；producer 为同 project/Goal/workspace 的正式 ended 普通 work Run，使用已有正式 Run/Plan 事实，不造 gate Run。
- Round/VerificationPlan/taskBasis/Evidence 的 subject 保持 gate；subjectRunRef 和真实 producer 身份保持原 work Run。按实际读取补已有局部 guard；不用新 owner、全局扫描或接口。
- 已完成的 receipt-first、真实读集、source/basis applicability、root/ticket一致、执行后cleanup记录全部保留。

所有其它文件包括 tests/fixtures/contracts/composition/tools 只读。只运行固定 `next-evidence` 与 `next-types`（原10测试，不加case），给出实际单文件变更/hash，完成 STOP。主审将用随后 R3e.3 两个已规划正常链测试真正走 gate→Task/Goal 完成，不另加一组局部测试。
