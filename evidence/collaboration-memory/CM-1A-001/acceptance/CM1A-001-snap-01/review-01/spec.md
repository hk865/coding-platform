# CM-1A-001 Spec 轴独立静态审阅

输入：CM1A-001-snap-01；产品 HEAD 声明 0eb02717d16412298c786166a75ca1a9d3e05ac7；范围为实施 source-snapshot 清单及父审阅者指定 coordination.ts。此文记录独立源码追踪及两条隔离动态反例，不替代父报告的指纹和全量回归。未修改实施源码。

依据：正式 CM-1A-001 §1/§4/§5 A01–A12、ACCEPTANCE-PROMPT、两根 AGENTS、runtime-collaboration（RoleBinding 有效性）及 implementation/ACCEPTANCE-HANDOFF。模块状态仍描述第一工作段无消费者，已落后当前实现，不能作 PASS 依据。

## 新发现

### SPEC-01 / P1：后继派发缺少真实 Runtime 的 RunSpec 准备入口（A05/A06，§1）

位置：src/control/dispatch-engine/coordination-drive.ts:872；src/control/dispatch-engine/dispatch-engine.ts:173；src/control/dispatch-engine/leased-worker-runtime.ts:29。
Control 创建 successor outbox 后 Dispatch 直接 runtime.start(envelope)，但 LeasedWorkerRuntime 只从 runtime.all() 找已登记的 exact runId spec，没有则抛“真实运行缺少已登记输入”。新 coordination-drive 不调用 prepare，整个产品 prepare 消费者是 planned/operator/reviewer 旧入口；没有根据 CommunicationAdmission 为新 Run 登记 spec 的生产者。
tests/coordination/delivery-into-input.test.ts:342 用测试手工 await runtime.prepare(specFor(root, successorRunId)) 补上缺失接线，因此通过不能证明产品后继能运行。
复现建议：隔离复制该测试，仅移除第 342 行手工 successor prepare，执行首用例。预期自动派发；静态推导实际 startRun 已提交、runtime_error、零 successor 模型请求。这是源码确定性缺口，运行结果以父报告为准。

### SPEC-02 / P1：换参与者后的等待不能经生产 drive 接续（A01/A05）

位置：src/control/dispatch-engine/coordination-drive.ts:846,855,907；src/control/control-engine/coordination.ts:1761。
等待保存 ownerParticipationRef；endWorkParticipation 保留等待不改（coordination.ts:615–618），新参与者开始后，drive 仍读取旧 participation 并把旧 ref 交给 admitWaitSuccessor；Control 明确要求该 participation.status === active，旧参与者已 ended 则拒绝。不会选择同 Work 的新参与者，故保留等待快照不等于责任可继续。
tests/coordination/control.test.ts:792 的换手用例只断言归属/状态不变，未把条件满足后实际派发。
复现：旧参与者登记 wait→end→同 Work 新参与者 start→满足条件且前驱 ended→drive，预期同 Work 后继，实际 invalid“参与关系不是 active”。

### SPEC-03 / P1：没有协调 Host 工具到正式受理的生产接线（§1/§4，A01/A02/A06）

位置：src/execution/worker-runtime/coding-agent-runtime.ts:227–235；src/control/control-engine/control-engine.ts:549–574。
全 src 的 sendDirectedRequest/respondDirectedRequest/createSubscription/registerWait/startWorkParticipation 消费者仅 Control 委派，没有 app、runtime 或 Host Adapter 调用。内核 runObservedModel 注入的 materialTools 仅 reviewer 路径。测试直接 h.control 调命令并在前驱结束后建立 participation（delivery-into-input.test.ts:264–277），绕开票要求“已受理 Work 的 Host 协调工具”生产者，不能支持真实 Agent 发请求/订阅/等待的交付结论。

## 已知缺口的独立定性

- A01 FAIL：coordination.ts:598 明确无 AgentInstance active 身份槽。票 §1 明确要求，不能用代码注释“收口”改成 N/A。
- A03 FAIL：coordination-drive.ts:34–36 承认不尾随，正式持续订阅生产者缺失（R2）；固定页本身可单独报告已验证范围。
- R7 仍是本票缺口：loadBinding:915 拒 binding.taskId=null；work-identity.ts 按 task 重解且要求 workKind=task。测试将 C 明确设 workKind=task（delivery-into-input:240–242）。应明确验证产品协调 Work 的身份策略，不能称其超范围。不能从静态资料断言所有协调 Work 都失败；task-backed C 分支是可行子集。
- A06 未完成 provider_call_authorized/attempted 是本票要求（R1），不能以 captured ModelRequest 替代。
- A07 取消生产者/运行取消竞争缺失（R4）；A08 无故障注入（R5）；A09 仅重开一条；A10 并行/冲突/公平未验证（R6）；A11 旧入口唯一推进未有充分回归；A12 正式 Interface 未同步（R8）。
- R3 retry_scheduled/退避不可达属于 A10，不是可直接排除的未来功能。
- 不因 1B/1C/M/I 尚未实施拒绝 1A；本票自身已存在阻断。

## A 项建议

A01 FAIL；A02 FAIL（生产 Host 未接线，权限读取面另 UNVERIFIED）；A03 FAIL；A04 UNVERIFIED（独立连接/跨进程）；A05 FAIL（SPEC-01/02）；A06 FAIL（SPEC-01/03、R1）；A07 UNVERIFIED/未完成生产者；A08 UNVERIFIED；A09 UNVERIFIED（仅局部可验证）；A10 UNVERIFIED；A11 UNVERIFIED；A12 FAIL（Interface 与当前状态陈旧，独立回归由父报告收集）。不对未实际运行项目使用 PASS。

## 独立运行补充（实测树，声明快照 STALE）

父审阅者独立算得当前源树 sha256:26529f1e926bc71220fdcaa128368ac5a168e96fc4f1e16b1104ef2ed5a44589，与交付声明不符；以下缺陷绑定当前实测树，不能把运行结果归给声明的391d快照。

SPEC-01 已运行复现。no-successor-prepare.test.ts 是原 delivery-into-input.test.ts 的隔离副本；仅将 import 映射回产品/原测试依赖，并移除测试手工 successor prepare，其他断言保持。使用 spec-test-wsl.sh（scripts/test-wsl.sh 的隔离副本，保持 bwrap preflight、Node24及Linux runner，只改固定root、include与config产物至evidence），在父审阅者pnpm build完成后执行。单用例1失败/2跳过；协调 admissions===1 已通过，ordinary drive 返回 runtime_error: Error: 真实运行缺少已登记输入。见 logs/no-successor-prepare.log、spec-run.sh、spec-commands.log。

第一次尝试使用原 test-wsl.sh 追加 --config 被 Vitest“重复config”拒绝（测试未开始），随后采用上述隔离脚本；此环境/命令尝试不是产品缺陷。
SPEC-02 已运行复现。handover-successor.test.ts 保留原后继 prepare，只在条件满足后的首次 drive 前，调用正式 endWorkParticipation 结束旧参与关系，再在同 Work 建立新 participation（同 AgentInstance 的新参与段）。两命令 committed 断言均通过，随后正式 drive 失败：后继受理被拒绝（invalid）：参与关系不是 active：ended。单用例1失败/2跳过。日志 logs/handover-successor.log，复跑入口 handover-run.sh；active 守卫 coordination.ts:1760，拒绝返回1761。换成另一个 AgentInstance 也不能修复 drive 固定引用旧 participation 的缺陷；此次动态证据严格限定同 AgentInstance 新参与段。