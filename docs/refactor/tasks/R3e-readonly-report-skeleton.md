# R3e.2a：只读报告的真实来源见证与原 Evidence 消费

状态：2026-09-26，Astra 下一批草稿，尚未建占位、prepare 或派发。依据 [原 R3e producer 方案](R3e-completion-skeleton.md) 的 readonly producer 范围；在 R6 execution 与 R3g 的 composition 骨架窗口之后重新核对共享快照。不是独立 Reviewer，也不把报告非空当成内容正确。

## 1. 只补现有 owner 之间的缺口

当前真实 Work Run 已能生成原 Kernel read/tool/assistant 历史、正式 ended Run 与固定历史 locator；`graphHistory.readTaskExecutionHistory` 提供固定原窗口分页。Workspace 的 `ReadonlyReadWitnessReader` 已能按实际 revision 和行范围判断完整读取。Evidence 已有 Round、Material 正文、coverage、finalize 与正式 Task/Goal 完成。缺的是把这些真实事实接到注册的 readonly-report 检查。

不迁回旧 ContextCompiler、VerificationJournal、全 observations 扫描或全工作区 idle 门槛。旧 `src/data/context-compiler/readonly-report-materials.ts` 和 `src/control/verification-engine/readonly-report-check.ts` 只作已确认语义参考；原工程只读。模型循环、执行入口、材料库、事务与 Task 完成均复用，不增加管理层。

## 2. 最小类型与入口

在 `contracts/verification.ts` 保留旧 `RegisteredCommandCheck` 的所有字段及无 execution 的历史内容，可窄增 `execution?: 'command'`；新增 `RegisteredReadonlyReportCheck`：`execution:'readonly-report'`、`kind:'static'`、原 checkId/taskIds、`requiredReadPaths:readonly string[]`。它没有 command/cwd/timeout。`RegisteredCheck` 为两者联合，TrustedCheckConfiguration.checks 与 RoundCheckSnapshot.definition 使用此联合；CheckExecutionTicket.definition 继续只接受 command。旧配置/正文摘要不得因补默认字段而改变。

同一 EvidencePort 增：

```ts
evaluateReadonlyReport(ctx: CoreCallContext,
  request: GraphWrite<{ roundRef: VerificationRoundRef; checkId: string }>
): Promise<WriteResult<RoundSnapshot>>;
```

请求没有 report、verdict、source digest、witness 或模拟 process observation。此入口读取既存事实并做机械判定，不启动模型/进程；无需把 command 的 begin/executing/ticket 套过来。合法 pending 直接变 finished，invocationId 保持 null，使用原 Round revision 的局部 CAS。原 runner `checks.runRegisteredCheck` 读到 readonly definition 后，在原 `phase !== pending` 早退及 ProcessSandbox 创建/probe之前分派到此入口，由 evaluate 保证 receipt-first，committed 映射原 ready Round；command 路径和未决进程窗口不变。对 readonly definition 调 command begin/record 明确拒绝类型不符，不伪造 ticket。

`verification-context.ts` 声明窄 `ReadonlyReportFactsPort` 与结构化 facts。输入完整 RunRef；返回原 terminal outcome、原固定 locator（或精确来源位置）、final report、`ReadonlySourceRead[]`、completeReadPaths、observedTools、workspaceEffects (`none|changed|unknown`) 及仅为该事实束计算的 digest。端口接收 CoreCallContext，不能由模型或 HTTP 上传。事实缺失/容量不足/来源拒绝沿 ReadResult 明确表达，不把读取失败变成空报告或 PASS。

以下是上述窄 facts 的冻结候选形状；RunOutcome、RunRef、RunExecutionHistoryV1、ReadonlySourceRead、ReadResult、CoreCallContext 均 import 原类型，不另定义身份：

```ts
type ReadonlyReportFacts = {
  runRef: RunRef;
  runRevision: number;
  history: RunExecutionHistoryV1;
  terminalOutcome: RunOutcome | null;
  report: string | null;
  sourceReads: readonly ReadonlySourceRead[];
  completeReadPaths: readonly string[];
  observedTools: readonly string[];
  workspaceEffects: 'none' | 'changed' | 'unknown';
  witnessStatus: 'matched' | 'changed' | 'unavailable' | 'permission_changed';
  issues: readonly string[];
  observationDigest: string;
};
interface ReadonlyReportFactsPort {
  readReadonlyReport(ctx: CoreCallContext, input: { runRef: RunRef }): Promise<ReadResult<ReadonlyReportFacts>>;
}
```

EvidenceServiceDependencies 窄增 optional `readonlyReports?:ReadonlyReportFactsPort`，未提供只使新 evaluate unsupported；原工厂必须返回完整 EvidencePort。真实组合根总是注入本实例的 facts，不以 optional 掩盖漏装。Run 的 workspace 由 `run.ref.projectId` 与 `run.workspaceSnapshot.workspaceId` 构造原 WorkspaceRef，不能使用UI当前选择。observationDigest只对固定原事实束计算，不把当前 witness 查询的波动当作历史身份。

## 3. 唯一原历史与来源实现

在 Runtime 增 `readonly-report.ts` 的薄工厂，依赖现 ExecutionReadPort、GraphExecutionHistoryReadPort 与同一 WorkspaceAccessFactory。先精确读正式 Run 和其 executionHistory；仅已正式 ended 且固定 endPosition 的 producer 可受理，不因 Session 后来已有另一个 Run 而拒绝历史。无 locator 或未结束返回真实缺口，不扫描 Session 头、不启动新 Run。

用原 graphHistory 分页（每页 ≤200，最多64页），固定第一份原 Run/Kernel/Session/窗口；读取完整窗口后从原 sessionRecordSchema 解码实际记录。原 WG/Kernel 已有正式 terminal 才产生报告事实，不发明 turn.finished 事件。原 assistant 的无 toolCalls 完成正文为 report；工具 callId、started/completed、实际 result/effects 和精确读取范围提供 witness。只支持当前可证明的 native `read` 与已有 `read_source` 格式；遇到未确认工具/结果/缺失 effects 保留 unknown，不猜零写入。取实际 path/revision/startLine/endLine/callId，保留原文本；不把模型自述“读过”或未配对结果当见证。沿原只读报告语义，报告/reads 有界；不重做 execution ownership/Role/全图一致性校验。

Workspace 在现 `readonly-read-witness-reader.ts` 提取原 revision/行覆盖纯算法为可由受权 read 函数调用的 helper；旧 class 接口和行为保留并委托同一 helper，不复制算法。Runtime 用现 WorkspaceAccessFactory.open(ctx,真实workspace) 获得 root/path/permission 受控 read，调用此 helper，并 finally release；不另外创建不受 Host allowsRead 约束的 root reader。历史 report 和 reads 与当前 witness 可用性分开：当前来源拒绝/改变不能抹去过去的原文与读取事实，已解码的 facts ready 值显式携带 witnessStatus（matched/changed/unavailable/permission_changed）供 Evidence 判定；仅原历史自身缺失/不可解码返回整体缺口，不伪造 completeReadPaths。

组合根在已存在 graphHistory 之后装配 facts，注入同一个 rawEvidence；不第二次创建 KernelStore/Workspace owner。WG 只依赖 contracts 的窄事实 port，不 import Runtime。新入口沿原 platform.evidence trackedCall 发布，runner 用 raw service，close 排空不变。

## 4. 原 Evidence 的局部事实入账

同原 trusted Host/scope 和 round.executor 身份；在首 await 前隔离输入与 expected，fingerprint 覆盖完整原请求。先查原 identity/event receipt，再读当前 Round，不因后来来源/配置变化拒绝已提交请求重放。当前 round 必须 open、该 check 为 readonly-report/pending，expected 恰为该 Round 当前版本；不扫描全库或要求全部 Run 空闲。

读取 round.subjectRunRef 的事实并核其原绑定，复用原 evaluateSource 与 sourceStatus。机械判据仅为原 producer terminal outcome=completed、非空实际 final report、至少一条成功源读取、配置 requiredReadPaths 全覆盖，以及真实 workspace effects=none。已知缺项可 FAIL，来源不适用/unknown/gap 为 INCONCLUSIVE；只有全部机械条件成立且 sourceStatus matched 才 PASS。不增加语义 Reviewer，也不将无验收未来 Task 移除或强变 ready。

沿原 MaterialPort body-first 存带原 provenance 的结构化报告；同一 PreparedCommit 保存 Round finished/reportRef/outcome/sourceStatus、原 check-result event 与幂等 receipt。复用现 codec/事件结构，区分 identity 前缀即可，不另造结果表。保存后 Round 冲突按原 exact receipt recovery，不做全局循环重采样；未确认结果不宣称未提交。原 finalized checks/coverage 与 completeTask 直接消费该 finished 行，保留原 source applicability，不重写覆盖归约。

readonly 不需要 command invocation。原 `recordCheckResult` 继续仅接实际 process observation；不要把只读判据伪装为 exit=0、shell 或尚未发生的执行。required reviewer 条件仍不足，非空 reviewerEvidence 的 unsupported 边界不在本批解除。

## 5. 精确范围与一条正常链

拟9生产：verification.ts、verification-context.ts、evidence/contracts.ts、evidence/evidence-record-codecs.ts、evidence/evidence-service.ts、新 Runtime readonly-report.ts、Runtime check-execution.ts、Workspace readonly-read-witness-reader.ts、composition/create-platform.ts。另2测试：新 `tests/composition/R3e-readonly-report-platform.test.ts` 一条正常链；既有 `tests/business/R5c-workflow.test.ts` 仅在 EvidencePort literal 补新方法的明确 unsupported，不改该文件案例/断言。机器 scope 在派发前依据 R6/R3g 冻结快照再列；此草稿不是可直接开工的范围授权。

新正常链复用公开 bootstrap/Plan/legacy Role 和真实 Kernel fixture：一个只读普通 Task → 正式 claim/prepare/start → 实际 native read 完整读一文件并产生 final report → 正式 ended 原 locator → 注册 readonly-report → 原 runner/evaluate → report/Evidence → finalize/completeTask。断言 report 原文、实际 callId/revision/行覆盖、无 ProcessSandbox probe/execute、无二次模型调用；重开同 SQLite/Kernel 后，对 evaluate 的原 request replay 断言原 value/cursor；runner 只有 ReadResult，验证其返回原 Round，不虚构 cursor。源码根与数据库输出分离；不得 seed terminal/witness/Evidence，不新增异常矩阵。未来意图语义复用既有验收，不重复其测试。

Stage1 只交 typed接口、同owner装配与明确 unsupported；原 command 检查不回退。第一首红应在 readonly 事实/评估新增接缝，之前真实 Work 已成功。新 witness helper 在骨架仅保留旧 class 原行为，对新增受权调用接缝显式 unsupported，不提前完成新算法。types/固定新正常链首红后 STOP；中审冻结后另派必要生产实现。最终只跑新链、实际受影响原 evidence/check/Workflow 集合和 types，整合后完整隔离，不增加覆盖打磨轮次。
