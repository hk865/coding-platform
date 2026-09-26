# R3e.1 骨架中审返修

状态：2026-09-26，仅返修第一阶段接口、骨架与最终行为测试，交付后 **STOP**。沿原 DSH Session 继续；本文件不授权生产实现或新建文件。唯一设计依据为 [主任务](R3e-completion-skeleton.md) §4–5、§8；派工和环境前置沿 [原 dispatch](R3e-completion-dispatch.md)。本次纠正原交付 `attempt-1790399771780341275` 中已确认的问题，不扩状态矩阵。

## 1. 写范围与阶段边界

仍为 [原 scope](R3e-completion-skeleton-scope.json) 的 **11 个生产文件、4 个测试文件**。生产仅修改必要 DTO、函数签名、注释和 schema/组合根接线；service/runner 保持明确 unsupported，纯算法及 codec 保持明确未实现，不预做 writer、覆盖算法或进程执行。`plan-readers.ts` 无真实新增需要则保持字节不变。

测试修改只在 `R3e-evidence.test.ts`、`R3e-evidence-coverage.test.ts`、`R3e-command-check-platform.test.ts`、`R3e-evidence-fixture.ts`。共享 B2/task-claim fixture、Kernel、Workspace、W1/W2、检查脚本、此任务书及其他文档均只读。不安装、不增 scope、不改 selector。

## 2. 固定原始操作返回值，才能恢复原回执

`evidence-record-codecs.ts` 当前 `VerificationRoundEvent` 只有身份/roundRef/fingerprint，不能在 Round 后续变化后恢复原始返回值。此处现在就冻结 discriminated payload，不能留为“第二阶段自行决定”：

| eventType | 必须保存的 `result` 类型 |
| --- | --- |
| `VerificationRoundOpened` | `RoundSnapshot` |
| `VerificationCheckBegun` | `CheckExecutionTicket` |
| `VerificationCheckResultRecorded` | `RoundSnapshot` |
| `VerificationRoundFinalized` | `FinalizedChecks` |
| `EvidenceAdmitted` | `EvidenceSnapshot` |

复用现有事件公共身份字段，使用以 `eventType` 为判别项的联合；禁止一个不区分 eventType 的宽泛 result 联合。Evidence admission 只保存裸 `EvidenceV1` 不足以重放 Snapshot，采用完整 result；不另建 receipt 表、重复结果 owner 或从当前 Round 猜原结果。cursor 继续由原 Store receipt 所有，不把变化后的当前值代替原值。编码/解码函数签名随联合对齐，实现仍占位。

保留同身份同 fingerprint 的 receipt-first：open、begin、record、finalize/submit 的原返回值独立于后来 Round 状态、当前配置/源码。回归复用原 request 对象（含原 requestId、expected、input），比较原 value/cursor；重放仅 replayed 标记改变。新的 requestId 不等于原 begin 重放。

## 3. 先修真实 fixture 前态，不修改已执行的原 Plan

原 B2 Plan 与固定政策要求 `test`，当前注册命令只有 `static`；不能靠 capabilities 临时声明 static 覆盖 test，或改写旧已执行 Plan 消除冲突。在 **同一真实 records/body/backend** 上，R3e helper 使用以下公开链建立自己的 subject：

1. `createB2ExecutionFixture(kind, additionalSchemas)` 继续复用现有入口。additionalSchemas 合入 `EVIDENCE_RECORD_SCHEMAS` 和 `PROJECT_BOOTSTRAP_RECORD_SCHEMAS` 的 records/events/lookups。后者仅拥有 bootstrap events，Project/Workspace/policy records 继续复用既有 schemas，不能重复注册。Evidence 集合阶段一可仍为空占位，但 helper 与组合根必须已经接入它，不能等实现后才发现 fixture 未注册。
2. 以 `b2.base.records` 创建现有 `createProjectBootstrapServices`，使用 `completionPolicies.installCompletionPolicy` 安装独立 static 政策，再 `activateCompletionPolicy`。使用真实返回 pin 与当前 active pointer 的 expected；不覆盖共享 fixture 原 policy revision/原 Plan pin。
3. 通过 `base.goals.createGoal` 创建独立 Goal；复用正式已有 architecture/policy 读取，以 `base.plans.proposePlan` → `applyPlanChange` 正式采用 **v2** Plan，required verification requirement 为 static，工作任务具备合法 assignment。核 proposal 无阻断 issues、adopted pin 指向新政策；不 raw seed Goal/Plan/basis。
4. `base.createSession` 创建新 Session；用新 Goal/Plan 的 `queryReadyTasks`/`queryTaskGraph` 与真实 Session 版本构造 claim，交 `base.service.claimTask`。共享 `base.buildRequest` 默认读取原 Goal，不能只替换 task 字段而沿用其 expected。
5. 复用 `b2.buildPrepared({claim: newClaim})` 与 `b2.enter({prepared})`，再 `entry.recordRunResult` 形成真实 ended subject。`b2.terminalObservation`/`terminalEvent`/history boundary 默认引用原 claim/kernel；R3e helper 必须以 `b2.kernelFor(newClaim)`、实际 permit 和 `b2.pin(newClaim)` 绑定全部 Run/Session/history 字段，不把原 B2 subject 混入新记录。不修改共享 helper，可在 R3e helper 内明确构造这组领域 observation。

上述 B2 observation 是正式领域 writer 的受信输入，证明正式生命周期，不冒称真实模型运行。真实机械进程证据由组合测试的 ProcessSandbox 另行提供。原 B2 fixture 已有 Run/Plan 无需改写；其存在不等于 R3e subject。新的初始化链每步必须断言成功，不能因失败跳过到 unsupported。

Host 配置、workspace/source provider、MaterialPort/MaterialFacts 均沿同一 scope/records/body，固定 checks 与 adopted requirements 一致。组合根重开同一 SQLite 后消费相同记录，不复制账本。当前合法治理变化只有安装/激活政策，不新增运行中 Role 切换。

## 4. 将 basis 判断真实接到唯一 coverage fold

冻结两个最小签名，使用已有 `EvidenceBindingV1`，不新增 binding 协议或 sourcePlans 集合：

```ts
evidenceBindingFor(evidence: EvidenceV1, applicability: EvidenceApplicability): EvidenceBindingV1;
selectEffectiveEvidenceSet(
  evidenceList: readonly EvidenceV1[],
  bindings: readonly EvidenceBindingV1[],
): EffectiveEvidenceSet;
```

service 按已有精确 Plan owner 读取 evidence 原 Plan/current adopted Plan，调用 `evidenceApplicabilityWithBasis` 并结合真实 source/policy 判定，随后 `evidenceBindingFor(evidence, decision.applicability)` → fold。binding 保留原 evidence 的 subject/coverage/anchor；不能将原 anchor 改成当前 Plan 以制造适用性。fold 仅消费逐 evidence 对应 binding，不再按旧 planRef/anchor 规则重算、覆盖 W1 判定；调用方须提供完整一一对应 binding，缺项不能默认 APPLICABLE。无需为此新增内部损坏矩阵。

首批没有已经定义并持久化的 supersession 规则：**所有 applicable FAIL/INCONCLUSIVE 保守留在 blockingByRequirement，后来的 PASS 不得抹掉它们**；claim 仍中立，不成为 PASS 或 blocker。PASS 覆盖槽的选取不授予删除 blocker 的权限。同步删改 contracts/coverage 注释与“后来 PASS 自动取代 FAIL”的现有测试断言。精确 versioned supersession 是 R3e 后续必须补齐的能力，本批不按列表顺序、时间或相同 coverage 猜替代关系。

纯覆盖测试可显式提供 binding；空要求例由 compiler 的非空规则与真实适用性判定说明，不能因为 fold 不再收 Plan 就给无目标证据一个假的 APPLICABLE。W1 例通过 `proposePlan`（basedOn 为原 PlanRef）→ `applyPlanChange`（现有 future-only 分支）在真实已采用 v2 Plan 上新增无关 future 节点，得到不同 PlanRef 与继承 basis，再将实际 `evidenceApplicabilityWithBasis` 输出送入上述 fold，断言旧证据保留、原 anchor 不变。定义变化的纯反例可以使用明确标注的纯输入，不宣称 W1 允许改写已执行任务。

## 5. 修复现有测试的后段，不另铺矩阵

- **Round revision：** begin 会改变 Round；后续 record、另一 check 的 begin、finalize 都取真实 `readVerification`/上次返回值的当前 revision。helper 不默认所有操作 revision=1。通过 `find(checkId)` 或逐项比较断言固定 checks，不能把多项数组误写成单项 `toMatchObject`。
- **固定 check 收口：** PASS finalize 前运行/记录该 Round 的全部 fixed checks，不能只完成 passCheck 就断整个 Round PASS。按 checkId 分别汇合；任何 executing/未知窗口的 fresh finalize 返回 incomplete、保持 open，不能 finalized。finalized 后 fresh begin 用当前 revision 验证拒绝；原 begin request 仍回原 ticket。
- **真实 CAS：** 删除当前 `records.commit` 将 Round 外层 revision+1、正文不变的注入。复用 begin/record 等公开 writer 推进同一 Round，再提交事先保留的旧 expected，证明真正 revision_conflict；需要竞态时只拦截现有 commit 窗口并让另一公开 writer 提交，不篡改 record。无关追加可沿已存在公开 Goal writer 完成，证明不会因全局账本推进失效。
- **重开未知窗口：** 保存真实 begin 后留下 executing，关闭并重开 SQLite。随后实际调用 `reopened.checks.runRegisteredCheck` 对同一 check，断言返回持久窗口且 probe/execute 计数不增加，再 fresh finalize 断 incomplete。仅重开后 read 再检查旧计数，不能证明 runner 不重跑。
- **真实进程与独立 spy：** 每个组合用例初始化自身 probes/executes/观察结果，包装仍调用真实 `ProcessSandbox.probe/execute`。命令 stdout 留痕，不写候选源码当计数器。按真实返回值断 stdout、exitCode/signal、timedOut/cancelled、effects/workspaceRevision 与检查结果；正文断实际 Host actor、`source.runRef=null` 及真正 subjectRunRef。probe canary 与注册检查 execute 分别计数，不宣称 probe 零进程。
- **事实保留：** 错 executor/ticket/check/invocation 的调用拒绝；原 ticket 的真实执行结果在后来撤权、source 不可读/变化时仍落观察及报告，适用结果为 INCONCLUSIVE 并带正确 sourceStatus/gap，不能改成 not_started。record 后继续撤权/源码变化，再以原 request 恢复 exact receipt，不能重读源或重算原值。沿现有用例补断言，不增加 Role 热换或持久层篡改。

每个门闩都与操作结果竞争并在 finally 解除/关闭；骨架早退须立即得到明确首红，不能挂住等尚未到达的进程/commit。并发 runner 的结果按真实 begin CAS/观察语义断言，不能无依据要求两个 fresh 请求都 ready；核心是至多一次真实执行及可解释的持久窗口。

## 6. 检查与交付

运行原固定 `next-types`、`next-architecture`、`next-evidence`，以及原邻接 `next-plan next-future-intent next-b2-composition next-execution-state next-bootstrap`；不跑全量、不改检查入口。新 fixture 的公开初始化必须可完成，R3e target 仍只能在未实现新入口/纯算法首红。不得为变绿实现 production、弱化断言或将 unsupported 当成功。

报告原 15 文件最终 hash、实际修改名单、每个 case 首红及后段未到达点、types/邻接结果；真实 ProcessSandbox 环境与业务 unsupported 分开报告。交付后 **STOP**，主审冻结后才可另派实现。R3e.2/3、versioned supersession、Task/Gate/Goal 正式完成仍待后续批次，不能据本轮接口宣称交付。

## 7. 第二次中审：仅两个入口测试的后段修正

2026-09-26，attempt-1790402092251938067 的生产骨架与真实 static 初始化链已复审接受，独立 10 首红 / 71 邻接通过、types 通过。本轮沿同 session **仅改 tests/work-graph/R3e-evidence.test.ts 和 tests/composition/R3e-command-check-platform.test.ts**；其余13文件包括fixture工厂与全部生产现在冻结，只读。以下都是前次明确要求但尚未真正修正的后段，不新增场景或矩阵：

1. WG 第三 case 第一次 begin 前保存完整 request 对象，后段 replayBegin 原对象原 expected 原requestId复用。第四case的completeCheck循环也局部保留实际已提交的begin request/ticket，末尾用该原对象比对原value/cursor与replayed。当前再次调用beginRequest会生成新ID，不能声称重放；不要把factory改成缓存来掩盖错误。
2. 撤权 case 在 record 成功后，用已有materialFacts historical_explanation读真实report正文；解析并断 observation 等于原recordRequest.input.observation（包括executed、真实领域输出），Host source actor/runRef与subjectRunRef正确。只truthy reportRef不证明事实保留。原receipt继续零新capture且原value；未发生“进一步source变化”则修正误导性注释，不增加无关故障。
3. composition观察包装保存并原样返回真实 super.execute 结果，绑定其请求command（或顺序与实际check），每case重置。报告的exitCode/signal/timedOut/cancelled/stdout/stderr/effects.workspaceRevision/changedPaths/sandboxProfileVersion与真实返回对应字段逐项一致；effects字段必须实际存在，不能not.toBeNull让undefined过关。不伪造result、不增加production注入接口。报告checkId/invocation与该check绑定，Host作者与subjectRunRef沿原断言。
4. 并发case Promise.all结束后，从platform.evidence.readVerification定向读当前Round，再用它的revision begin第二check；两个ready中的第一个可能只是旧executing观察，不能find首个ready当最新值。仍保留至少一个ready和至多一次真实execute。
5. 重启前保存probes与executes，调用reopened.checks.runRegisteredCheck后两者均不增长；不能只证明没第二次execute而容许fresh probe。

只跑next-evidence和next-types（必要时原局部邻接），无需重跑全部71邻接。10个首红应仍落在新入口/算法unsupported，不能提前实现让后段变绿。交付两个文件hash及未修改生产/fixture说明后立即STOP。本节优先于前面较宽的修订范围。
