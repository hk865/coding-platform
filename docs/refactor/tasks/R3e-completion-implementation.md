# R3e.1 注册检查与正式证据：第二阶段实现

状态：2026-09-26，骨架、接口、组合根及全部测试已中审导入冻结；现在执行五生产文件实现。按用户最新纠偏优先真实正常路径与消费者接线，不为测试完备度增加返修轮次。仅阻断错误契约、正常路径失败和实际权限/副作用错误，更多边界证明后置到完整 E2E 后。

唯一行为依据为 [主任务 §4–5](R3e-completion-skeleton.md)及 [中审返修](R3e-completion-middle-repair.md)。最终已审核接口/测试与其真实提供者决定调用形状，不据旧工程猜测接口；本说明只收敛实现范围，不另建设计。原工程只读复用。先读 docs/AGENTS.md、当前 HANDOFF、IMPLEMENTED-CAPABILITIES、CODE-QUALITY-GUIDELINES §2.1 及 DSH-WORKFLOW/DSH-EXECUTION-HARNESS。

## 唯一五文件写范围

相对 `coding-platform/next`，完整机器白名单见 [scope](R3e-completion-implementation-scope.json)：

1. `src/core/work-graph/evidence/evidence-service.ts`：唯一 open/begin/record/finalize/claim/read 服务；沿既有 Store、Material 与 source 依赖实际落账。
2. `src/core/work-graph/evidence/evidence-record-codecs.ts`：已冻结记录/判别事件的编码、校验与唯一 schema 集合。
3. `src/core/work-graph/evidence/verification-plan.ts`：从真实固定配置和精确 Plan/治理 pins 编译检查方案；复用现有 policy reader。
4. `src/core/work-graph/evidence/coverage.ts`：唯一 applicability/binding/coverage 汇合，消费中审冻结的 basis 判断。
5. `src/core/agent-runtime/check-execution.ts`：薄注册命令执行器，调用同一 EvidencePort 和真实 Kernel ProcessSandbox。

五路径均已在 main 预建；本次准备未改动它们。其余全部只读，尤其 contracts、evidence/contracts.ts、composition/create-platform.ts、所有测试/fixtures、`plan-readers.ts`、Kernel patches/dist、Workspace/Material/W1/W2 与检查脚本。`plan-readers.ts` 已公开 `readPinnedCompletionPolicy`，不重复政策读取链，不因先前候选范围而将它加入白名单。ArchitectureBaseline 直接复用 A1 owner `src/core/work-graph/architecture/catalog-record-codecs.ts` 已公开的 `readArchitectureBaselineSnapshot` 与 `architectureBaselineDigest`：沿 adopted Plan 固定 baseline ref 读实际 record/body，以该 validator/digest 核内容，比较正式 ref/content revision/digest 与 adopted pin，并核 outer record revision 与 snapshot.revision，使用实际 record revision 形成局部 guard。不得跟随当前 active pointer；不另导出 plan-readers 的 private 副本，也不扩五文件 scope。不得修改测试、安装依赖、增加文件、另建 journal/engine/状态库或全局 horizon；原地写入，不用同级临时 rename。若冻结接口确实不足，报告准确缺口给主审，不能扩大 scope。

## 必须实现的既定边界

- 同一 records backend 承担 Round/检查生命周期/Evidence/index/事件及 receipt；同一 MaterialPort 保存并读回正文，沿已接的 source provider 与 Kernel public API。报告正文属于原 Host actor 的 platform_operation 历史来源，不借 subject Run 身份或新 grant 把报告伪装成执行产物。
- fresh open/begin 核当前可信配置的完整 executor、workspace、Host materialReader、source/process 授权及确切来源。subject 是已正式结束的真实 Run，不要求重新占 Session，不造新 Run/Attempt/Lease。begin 用 Round revision CAS 取得唯一 invocation；只有 fresh committed begin 能执行，replayed ticket 不是重新执行许可。
- 原 request 的 identity/fingerprint/expected 保持不变；各操作先恢复不可变事件里的原 result/cursor，不从当前 Round 拼原回执。沿中审冻结的 eventType 判别 result 联合，包括完整 EvidenceSnapshot。runner 的原重放不被后来 root/probe、当前配置或源码故障挡住；另一新 request 的竞争按真实 CAS 返回，不保证双方成功。
- record 接受原 round/ticket/executor/check/invocation 的已发生观察，不重做 fresh 执行准入。begin 后合法撤权、换配置、源码变化或不可读仍保留真实 executed 的 exit/signal/stdout/stderr/effects/时间和 reportRef，sourceStatus/gap 明示，结果 INCONCLUSIVE；不能改称 not_started，也不能仅因当前 source 不可读而省略历史事实。只有存储确实不可用等无法落账故障才诚实返回 unavailable。无运行中 Role rebind 或原始持久层篡改场景。
- 真执行只用既有 WorkspaceSandbox.create、ProcessSandbox.probe 和 ProcessSandbox.execute；probe 本身不运行注册检查命令。必须走真实隔离，禁止 unavailable 时退回无隔离 shell、模拟 PASS 或自动 skip 正例。stdout/stderr 各固定 32 KiB，保留真实 totalBytes/truncated；captureWorkspaceEffects 保持默认开启，effects 不伪造。两个 sandbox 没有 close/release，不编造方法；原资源沿其实际 finally 路径清理。
- 只有明确未启动的 sandbox_unavailable/launch_failed 可映射 not_started；其余 execute 抛错、未取得完整过程结果或未知执行窗口保留 executing/unknown，不伪造 observation，不自动 rerun。取得真实结果后的晚取消沿受信收尾 signal 保存事实，不撤销已提交记录、不再启动进程。
- finalize 按固定 VerificationPlan.checkId＋coverage 逐项核全部必要检查，另一 check 的 PASS 不能补缺项或覆盖 FAIL。executing/未对账未知窗口返回 incomplete，不 finalized；允许按已冻结规则把 pending 缺项汇合为 INCONCLUSIVE。record/finalize 同 Round revision CAS；finalized 后 fresh begin 拒绝，原 receipt 仍恢复。body-first 后 Round/Evidence/TaskEvidenceIndex/事件一次 commit；不调用 completeTask/completeGoal，不释放或推进 Task/Run/Session。
- 首批 **无 supersession**：当前 policy 和 VerificationPlan 没有明确版本化替代规则。claim 中立，所有适用 FAIL/INCONCLUSIVE 均保留 blocker；同 check 新 round 或不同 check 的后来 PASS 都不能抹掉它。effectiveEvidenceIds 保留全部贡献项，coverageByRequirement 只作稳定代表。W1 无关未来变化沿已有 basis/frozen definition 证明复用；真实 stale/out_of_scope 是 applicability，不是替代授权。后续 versioned supersession 与正式完成另批，不在本次猜规则或添人审流程。

## 检查、交付和停止

目标使用已注册 `next-evidence`；邻接复用 `next-plan next-future-intent next-b2-composition next-execution-state next-bootstrap`，按现有工具合并运行即可。`next-types`、`next-architecture` 分别执行，不改 selector、不跑原 Kernel 全矩阵。真实 ProcessSandbox 成功链须实际到达；环境不可用准确报告，不能以类型检查或 probe.available 布尔替代真实注册命令执行。

冻结测试只读。交付五文件精确 hash、各检查真实结果、已到达的 command/body/结果/重放链和仍未到达或失败的后段。只有原 request 原返回值、真实输出正文、并发唯一执行和未知不重跑均实际被消费，才可报告对应行为通过；不能由前置首红推断后段。完成后 STOP 交主审独立审核与整体验收，不自行导入 main、不实施 R3e.2/3 或 Task/Gate/Goal 正式完成。
