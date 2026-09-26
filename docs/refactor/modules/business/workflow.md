# Workflow：业务流程与策略的实现骨架

```yaml
status: implementation-blueprint
updated: 2026-09-26
target: coding-platform/next/src/business/workflow/
implementation: next 的 advanceWork 已独审接通真实已有Plan的Work Run→检查→Task完成→独立Goal gate→正式Goal完成；handleGoalInput 初始Plan消费者正在骨架阶段。复杂调度、Reviewer与完整Host消费者仍待接；§2–10 为完整目标而非全部现有 API
```

> **2026-09-24 纠偏：** 任务图是白板/监测/历史检索，Workflow/Agent 根据规范和事实决定并行。预期依赖、架构影响或未来范围未知不自动生成硬阻塞；具体已采用的输入条件在需要时检查。每次执行不必先做全量范围证明或资源预占，已完成结果仍须核对与局部整合；见[当前行为图](../../PARALLEL-COLLABORATION.md#3-当前运行时协作图模型编排工具操作结果反馈)。

## 1. 产品目的与已确定的决定

2026-09-25：共同范围见[完整 A/B/C/D 路径](../../IMPLEMENTATION-PLAN.md)。按图发现工作者、咨询、相关 Session 延续、拆分/并行、交接与归档是本模块及角色 Skill 的组织职责，不再缩写成一个 ready-task 调度循环。秘书/参谋/书记通过现有图与通信工具工作；查询候选不是执行授权，模块关联不是锁。需要在真实模型调用中验收 Skill 使用了哪些工具/版本，不能由模板文件存在宣称编排已完成。

Workflow 把人的目标、反馈、任务结果变成下一步工作意图，回答“为什么做、做什么、继续谁、何时并行、失败后怎么办”。核心负责数据结构维护、合法提交和实际执行。本模块没有第二套 Goal/Task 数据库，不直接写表，不实现图查询算法或 Kernel 循环。

接手者不需要再次询问以下问题：

- 人已授权“修复并验证”或“开始实施”时，范围内调查、任务细化和执行继续推进，不加同义审批。新增范围、改变验收和未授权外部副作用才生成具体待决方案。
- 连续相关工作优先延续已有 Session；Run 结束不表示 Session 结束。新 Run 不自动重建全量上下文。相同 Session ID 是否真实继承 Context，由 Runtime 的能力和实际输入证明。
- 角色是职责、Skill、工具和规范配置，不是永久人格；秘书、参谋、书记不固定为三个常驻模型。相同配置可用于独立会话。
- 已知文件、状态、结果用确定性工具直接读取；语义解释、方案形成或实际调查才建立模型执行。普通查询不强制创建 Task 或 Run。
- 硬任务依赖是 DAG，通信可以往返；返工新增 Attempt/Run，不制造任务互等。
- 状态、候选、决定和等待均由 WorkGraph 保存；没有新输入不重复调用模型，不新增监督监督者的层级。

完整共享类型见[公共契约](../../skeleton/CONTRACTS.md)，领域操作见[核心数据设计](../../CORE-DATA-OPERATIONS.md)，转换见[状态机](../../ORCHESTRATION-STATE-MACHINES.md)。本页重述实施所需身份、选择规则、接口和迁移路径。

## 2. 目标文件树及逐文件责任

```text
src/business/workflow/
  index.ts
  ports.ts
  contracts.ts
  workflow.ts
  goal-planning.ts
  architecture-workflow.ts
  session-policy.ts
  input-policy.ts
  verification-workflow.ts
  advancement.ts
  legacy-adapter.ts
```

| 文件 | 主要导出与责任 | 内部依赖 | 状态与 I/O |
| --- | --- | --- | --- |
| `index.ts` | 导出 `createWorkflow` 与公开类型 | workflow、ports | 无副作用，不导出内部实现 |
| `contracts.ts` | 下文请求、结果、策略产物 | 现有 contracts、共享 core contracts | 只读值对象 |
| `ports.ts` | `WorkflowPort/WorkflowDependencies` | contracts、依赖模块 Port 类型 | 无 I/O，不包装总门面 |
| `workflow.ts` | `createWorkflow`，组合五个入口 | 以下业务函数 | 只通过注入的 Port 读写 |
| `goal-planning.ts` | `handleGoalInput/consumePlanningAnswer`，解释、提案、采用 | input-policy | WorkGraph 目标/候选/决定；Runtime 规划执行 |
| `architecture-workflow.ts` | `handleArchitectureInput`，观测差异、方案和正式采用流程 | input-policy | ArchitecturePort；真实演进candidate/decision/gate链 |
| `session-policy.ts` | `chooseSession/rankSessionCandidates` | contracts | 纯筛选排序；不写 Session |
| `input-policy.ts` | `prepareInputRequest`，追加/初始化/交接需求 | contracts | 调核心取引用，不解析日志和文件 |
| `verification-workflow.ts` | `advanceVerification/chooseRework` | session-policy、input-policy | Evidence/Task Port；Runtime 检查和 Reviewer |
| `advancement.ts` | `advanceWork`，事件推进、ready 任务、无进展处理 | 上述策略函数 | 操作提交与结果读取，无私有数据库 |
| `legacy-adapter.ts` | 旧 Human/Plan 参数和回执兼容 | WorkflowPort | 不复制判据，最后消费者迁移后删除 |

内部方向为 `workflow → 业务函数 → 契约/纯策略`。函数可合并在同文件，不要求一动作一类。跨模块只依赖 WorkGraph、AgentRuntime、WorkspaceTools；核心不能通过注入回调反向依赖本模块。

## 3. 本地请求与结果类型

代码块按目标目录解析。共享 `CoreCallContext` 的字段为 `projectId/workspaceId?/principal/materialReader/signal`，由宿主绑定；实际能力在各使用点按principal与正式记录解析，不新增ctx.actor/ctx.capabilities。`CommandMeta` 含请求身份和实际依赖的 expected versions。不得把模型参数中的身份当作可信调用身份。

```ts
// contracts.ts：身份及既有实体直接引用准确来源。
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../contracts/plan.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { QueryJobAnswerRef, QueryJobRef } from '../../contracts/query-job.js';
import type { PlanProposalRef } from '../../core/work-graph/tasks/contracts.js';
import type { ArchitecturePort, ArchitectureDraftRef, ArchitectureRevision,
  ArchitectureSelection } from '../../core/work-graph/architecture/contracts.js';
import type { VerificationRoundScope } from '../../contracts/verification-context.js';
import type { VerificationRoundView } from '../../contracts/verification-round.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { TaskRef, ExecutionRef, SessionRef, CommandMeta, RoleConfigurationRef } from '../../contracts/core/identity.js';
import type { OperationRef } from '../../contracts/core/operations.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
type ProposalRef = PlanProposalRef;

export type GoalInput = {
  meta: CommandMeta;
  workspaceId: string;
  goalRef: GoalRef | null;
  requestBodyRef: ArtifactRef;
  text: string;
  action:
    | { kind: 'request_work'; executeWithinRequest: boolean }
    | { kind: 'explain'; proposalRef: ProposalRef }
    | { kind: 'revise'; proposalRef: ProposalRef }
    | { kind: 'confirm'; proposalRef: ProposalRef; expectedProposalRevision: number; proposalDigest: string };
};
export type HumanChoice = {
  question: string;
  alternatives: readonly { id: string; text: string; consequences: readonly string[] }[];
  recommendationId: string | null;
  sourceRefs: readonly ArtifactRef[];
};
export type WaitReason =
  | { kind: 'dependency'; taskRef: TaskRef; predecessors: readonly TaskRef[] }
  | { kind: 'session_busy'; sessionRef: SessionRef; owner: ExecutionRef | OperationRef }
  | { kind: 'execution'; executionRef: ExecutionRef }
  | { kind: 'source'; refs: readonly ArtifactRef[]; reason: string }
  | { kind: 'decision'; proposalRef: ProposalRef };
export type WorkflowOutcome =
  | { kind: 'explained'; bodyRef: ArtifactRef; proposalRef: ProposalRef | null }
  | { kind: 'proposed'; proposalRef: ProposalRef; withinAuthorization: boolean }
  | { kind: 'accepted'; operations: readonly OperationRef[]; executionRefs: readonly ExecutionRef[] }
  | { kind: 'waiting'; reasons: readonly WaitReason[] }
  | { kind: 'needs_decision'; choices: readonly HumanChoice[]; proposalRef: ProposalRef | null }
  | { kind: 'unchanged'; basis: string }
  | { kind: 'rejected'; code: 'invalid' | 'forbidden' | 'stale' | 'unavailable'; message: string };
export type AdvanceTrigger = {
  meta: CommandMeta;
  goalRef: GoalRef;
  cause:
    | { kind: 'plan_adopted'; planRef: PlanRevisionRef }
    | { kind: 'execution_observed'; executionRef: ExecutionRef }
    | { kind: 'check_recorded'; roundId: string }
    | { kind: 'dependency_changed'; taskRef: TaskRef }
    | { kind: 'planning_answer'; answerRef: QueryJobAnswerRef }
    | { kind: 'user_input'; requestBodyRef: ArtifactRef }
    | { kind: 'execution_recovery'; executionRef: ExecutionRef }
    | { kind: 'session_recovery'; operationRef: OperationRef };
};
export type ArchitectureWorkflowInput =
  | { kind: 'investigate'; meta: CommandMeta; workspaceId: string;
      before: ArchitectureSelection; after: ArchitectureSelection; question: string }
  | { kind: 'propose'; request: Parameters<ArchitecturePort['proposeArchitectureChange']>[1] }
  | { kind: 'apply'; request: Parameters<ArchitecturePort['applyArchitectureChange']>[1] };
export type ArchitectureWorkflowOutcome =
  | { kind: 'explained'; bodyRef: ArtifactRef }
  | { kind: 'investigating'; queryJobRef: QueryJobRef }
  | { kind: 'proposed'; draftRef: ArchitectureDraftRef; revision: number }
  | { kind: 'accepted'; architecture: ArchitectureRevision }
  | { kind: 'needs_decision'; choices: readonly HumanChoice[] }
  | { kind: 'rejected'; reason: string };
```

`executeWithinRequest` 是从原人类请求解析的明确意图，不是模型可自填的授权万能开关。Host 保存原消息，WorkGraph 在采用时检查已有授权。`withinAuthorization` 是候选解释，不直接授予能力。

```ts
export type SessionCandidate = {
  record: SessionRecord;
  relation: 'same_task' | 'same_work' | 'related_module' | 'none';
  sharedModules: readonly string[];
  roleCompatible: boolean;
  permissionCompatible: boolean;
  historyUsable: boolean;
};
export type ChooseSessionRequest = {
  taskRef: TaskRef | null;
  workspaceId: string;
  role: RoleConfigurationRef;
  intent: 'continue_work' | 'independent_investigation' | 'independent_review';
  explicitSessionRef: SessionRef | null;
  candidates: readonly SessionCandidate[];
  capacity: { mode: 'fits' | 'requires_compaction' | 'not_measured'; reason: string };
  capabilities: { continueHistory: boolean; nativeCompact: boolean; recoverRun: boolean };
};
export type SessionChoice =
  | { kind: 'continue'; sessionRef: SessionRef; reason: string }
  | { kind: 'create'; role: RoleConfigurationRef; reason: string }
  | { kind: 'wait'; sessionRef: SessionRef; owner: ExecutionRef | OperationRef; reason: string }
  | { kind: 'compact'; sessionRef: SessionRef; reason: string }
  | { kind: 'regroup'; sources: readonly SessionRef[]; role: RoleConfigurationRef; reason: string }
  | { kind: 'preflight'; sessionRef: SessionRef; reason: string }
  | { kind: 'rejected'; reason: string };
export type InputRequest = {
  executionRef: ExecutionRef;
  sessionRef: SessionRef;
  mode: 'append' | 'initial' | 'handoff';
  instruction: string;
  requiredRefs: readonly SourceRefV1[];
  suggestedModuleIds: readonly string[];
  unresolvedItems: readonly string[];
  budget: RuntimeBudget;
};
export type InputPreparation =
  | { kind: 'ready'; request: InputRequest; selectedRefs: readonly SourceRefV1[] }
  | { kind: 'missing'; required: readonly string[]; usableRefs: readonly SourceRefV1[] };
export type VerificationAdvance = {
  meta: CommandMeta;
  scope: VerificationRoundScope;
  round: VerificationRoundView | null;
  cause: 'output_ready' | 'check_observed' | 'review_observed' | 'recover';
};
```

SessionRecord 的 `occupancy` 为 null、`{kind:'execution',executionRef,generation}` 或 `{kind:'maintenance',operationRef,generation}`；压缩/重组同样占用会话。忙闲从 health 和 occupancy 派生，不另存一套“Agent 当前状态”。SessionCandidate 由 findSessions 返回的 SessionCard.record/links 和角色、权限、历史可用性核对结果生成；不读取未定义的 relevanceOrder，不由模型自由补 true。选择/创建用 RoleConfigurationRef；InputRequest不冗余传role。任务执行的RoleBindingRefV1来自claim，查询则读取其正式QueryJob和Session配置，不自行合成bindingId。

## 4. Port、依赖与宿主装配

```ts
// ports.ts：下面类型来自contracts.ts及对应模块ports.ts。
export interface WorkflowPort {
  handleGoalInput(ctx: CoreCallContext, input: GoalInput): Promise<WorkflowOutcome>;
  handleArchitectureInput(ctx: CoreCallContext, input: ArchitectureWorkflowInput): Promise<ArchitectureWorkflowOutcome>;
  advanceWork(ctx: CoreCallContext, trigger: AdvanceTrigger): Promise<WorkflowOutcome>;
  chooseSession(input: ChooseSessionRequest): SessionChoice;
  prepareInputRequest(ctx: CoreCallContext, input: InputRequest): Promise<InputPreparation>;
  advanceVerification(ctx: CoreCallContext, input: VerificationAdvance): Promise<WorkflowOutcome>;
}
export type WorkflowDependencies = {
  architecture: ArchitecturePort;
  tasks: TaskPort;
  sessions: SessionDirectoryPort;
  runs: RunStatePort;
  evidence: EvidencePort;
  materials: MaterialPort;
  roles: RoleMemoryPort;
  runtime: RuntimeExecutionPort;
  workspace: WorkspaceToolsPort;
  now: () => string;
};
export function createWorkflow(deps: WorkflowDependencies): WorkflowPort;
```

WorkGraph 七个 Port 从 `../../core/work-graph/ports.ts` 导入；Runtime 和 Workspace 分别从 `../../core/agent-runtime/ports.ts`、`../../core/workspace/ports.ts`。完整输入输出在各模块页定义，不在这里声明宽松影子接口。

| 依赖能力 | 用途 | 不由业务复制的逻辑 |
| --- | --- | --- |
| Architecture `queryArchitecture/queryImpact/compareArchitecture/proposeArchitectureChange/applyArchitectureChange/captureSourceChanges` | 架构调查、方案和采用流程 | 实际关系解析、正式DAG、版本/来源/演进链核对 |
| Task `queryGoal/readPlanProposal/queryTaskGraph/queryReadyTasks/proposePlan/applyPlanChange/claimTask/requeueTask/completeTask/completeGoal` | 读取目标，采用计划，安排执行和返工 | DAG合法性、版本、占用及完成归约 |
| Session `findSessions/readSession/admitSessionOperation/linkSessionWork` | 候选和交接 | Kernel创建是否成功、正式忙闲更新 |
| Run `submitQueryJob/beginQueryExecution/closeQueryJob/pendingDispatch/setRunControl` | 已受理查询/执行、控制期望 | Query身份与只读能力、真实Kernel ack，不把受理当已停 |
| Evidence `openVerification/recordCheckResult/finalizeChecks` | 检查安排与下一步选择 | 来源适用性、覆盖与结果汇合 |
| Material `openArtifact/resolveMaterials/searchHistory/storeArtifact` | 解释方案和补必要资料 | 解析、分页、去重和索引维护 |
| Runtime `createSession/prepareExecution/startRun/continueSession/driveAccepted/readSessionHistory/runCheck` | 真实执行及Kernel历史 | 模型/工具循环、原记录与恢复 |
| Workspace `readWorkspace/querySource/compareWorkspace` | 已知文件直接查询 | 路径边界、AST和文件一致性 |

Host 先建立共享依赖再创建 Workflow；用用户输入和结果事件调用应用入口。Runtime 返回事实或待决原因，Host 才选择调用 Workflow；不能在 Runtime 中注入 Workflow 实例形成隐含反向依赖。

## 5. 目标、规划与确认的完整顺序

1. 根据可信上下文及原请求建立目标意图，核对工作区引用。缺信息形成有来源的缺项，不自动换目录或扩范围。
2. `explain` 读取指定候选与来源；确定性事实足够则直接输出，需要语言解释时提交只读 QueryJob，复用交互Session，不生成新proposal。
3. `revise` 和初次规划先取已有图、材料和决定。没有baseline也可以探索；初始化目录等写入按当前授权进行，不能循环要求先有正式架构。
4. 需要模型时复用现有初始规划响应格式与边界解析，使用 QueryRun，不伪造编码Task。输出仅是候选，结构规范化/合法性由WorkGraph负责。
5. 比较候选变化与已保存授权：范围内细化可以采用；超范围则给具体 HumanChoice。模型说“需决定”不自动导致再审批，先看已有决定能否回答。
6. `confirm` 绑定 proposalRef/expectedProposalRevision/digest；过期确认不能自动批准新候选。正式applyPlanChange传expectedProposalRevision及已有decisionRefs，digest额外防止界面显示与确认对象错配。重复确认回放原结果，采用成功再触发推进。
7. 保存可检索决定、来源与未决项，不要求或保存模型隐含思维链。普通工具结果和状态记录不重新走确认。

当前 `parseInitialPlanningResponse` 存在2–16任务限制，QueryJob存在轮次限制；迁移先保留现有可观察约束，需调整时连同协议和验证显式修改。业务不新增用户未配置的累计Token、时长或调用预算。

`handleArchitectureInput`同样由已有Host入口进入：先精确读取正式/草案/观测版本，必要时captureSourceChanges并compareArchitecture。结构差异可直接解释；职责判断、方案比较有语义不确定性才发QueryJob。propose保存基于明确版本的catalog/legacyContent/reason；不得把观测imports自动采用为正式边界。apply初次baseline只在无既有正式baseline时使用initial；演进沿现有candidate、已接受decision、migration gate链提供真实引用。用户已授权的范围内决定复用原依据，不追加同义审批，也不能用业务判断省去已有正式演进依赖。图中未解析项进入待调查资料，不解释成“无依赖”。

## 6. Session 策略与增量输入

`rankSessionCandidates` 的首版规则是确定性字典序，不引入学习排序服务：

1. 过滤不同项目/工作区、不兼容角色/权限、不可恢复历史。归档会话只有显式重新启用才进入候选。独立审阅排除被审查的执行Session。
2. 显式指定Session时检查该对象，不适用返回原因，不能偷偷换成同名角色的新会话。
3. 连续工作按 `same_task → same_work → related_module → none` 排序，再比较可用性、共同模块数、稳定sessionId。首版不引入未定义的语义分数，不自行解析opaque游标。
4. 最合适相关Session正忙且要求连续，则wait；独立调查/审阅可create。不能为消除一次暂时等待复制整套Context。
5. 容量fits且continueHistory真实接通才continue。容量未测返回preflight；要求压缩但nativeCompact=false时，可以选择具备明确交接资料的regroup，不能声称压缩成功。
6. 无适用候选则create；创建映射完成后才能claim。claim失败不删除此前合法创建的闲置Session。

仅当任务语义关系不明确、拆分存在真实取舍、失败需要新方法时请求模型判断。给模型相关候选、差异和来源，不把全图放进Context；输出不能越过兼容过滤，最终占用仍由核心当前版本判断。

`prepareInputRequest` 只说明输入目的：append带新增要求/变化/未决项/必要引用；initial带角色和开始工作所需材料；handoff带原始来源、现行义务和接任说明。Workflow从图/历史结果构造有顺序的MaterialLocator候选，再调用resolveMaterials；缺失必需材料返回missing，不能把排除列表丢掉。检索、去重和版本定位交核心；原Session历史由Runtime/Kernel处理。推荐模块是线索，不变成新的隐藏读取白名单。

交给Runtime时转换为本模块消费者侧的`RuntimeInputIntent`：保留mode、instruction、requiredRefs、真实RuntimeBudget；handoffRef必须来自已保存交接材料，initial/append用null。任务RoleBinding从admission读取，查询从精确readExecution的QueryJob及Session配置读取。Runtime.prepareExecution完成真实工具/角色解析和合法正文格式，再形成WG可核对的PreparedExecution。

## 7. 执行推进、检查与返工

### 并行分工的选择与修正

同一工作区多 Agent 并行是产品要求。编排结合规范、架构、任务白板和实际工具结果选择分工，按需使用已有范围查询、来源比较和影响分析；`assessParallelism` 是尚未装配的目标能力，不是每次执行的必经前置。明确分工可以直接分别 `claimTask`，领取核对当前任务/Session 身份、授权、分配与局部版本，不认证全部未来范围无冲突。已采用的具体产物输入条件在需要消费时核对，不以生产者整个 Task 完成为替代。具体文件/命令操作处检查适用权限、版本及必要资源约束，返回真实冲突后由 Agent 调整共享步骤、协调、隔离或等待。尚未实现的隔离、排空或合并能力明确 unsupported。

注释：模块关联、计划排序和预测影响不是锁；同一 Session 的对话占用也不是全工作区单 writer。冲突只影响相关步骤，保留独立成果；普通协调不要求人审批，新的产品取舍才形成 HumanChoice。行为与验收见 [MVP B03–B05](../../../MVP-BEHAVIOR.md)，详细并行约束见 [PARALLEL-COLLABORATION](../../PARALLEL-COLLABORATION.md)。

`advanceWork` 的实现顺序固定如下：

1. 查询当前Goal、计划及触发所指结果；已处理的同依据事件返回unchanged。去重查询WorkGraph已有操作，不建立Workflow数据库。
2. 暂停/取消/尚缺决定时返回原因及唤醒条件。planning_answer进入规划接收，不再新开一次规划。
3. 查 ready 候选，并按触发读取相关未来意图和 required 未完成解释；为空时区分待细化、缺分配/执行说明、具体输入缺失、Session 忙、检查未决及未知执行。授权内可细化/分配的继续推进，否则记录明确唤醒条件；不能直接宣告目标完成或无变化地反复调用模型。
4. 为选定任务读取候选并chooseSession；必要时create/preflight/交接。模型研究与任务执行都经正式类型，QueryRun不取得写权限。
5. `claimTask`一次正式提交任务、Session占用、Attempt及待执行项。读取 ready 不等于拥有许可，最终提交核当前身份、授权、分配和局部版本；实际工具资源约束在适用操作处执行。
6. 新意图调`prepareExecution`后进入`startRun/continueSession`；持久pending调`driveAccepted`续办相同受理项。收集真实回执和拒绝。Kernel结果回流后再次推进，不能循环同步等待所有模型执行。
7. 并行通过独立 Session 和正式受理推进，实际冲突反馈给业务协调；按需使用真实可用的隔离能力，不强制 worktree。任务图独立不证明未来没有语义冲突。

`advanceVerification` 按已采用要求建立轮次，安排静态/动态检查与必要Reviewer。检查执行入口复用原命令生命周期，迁入Runtime；其选择属于本业务流程。缺乏独立审阅义务时不默认新增Reviewer。

- `finalizeChecks` 返回覆盖与适用结论；两个PASS不能掩盖第三项缺失。Workflow决定补哪项、返工或具体取舍，不重复实现coverage算法。
- 有具体修改/新证据时 `requeueTask`，同Task新Attempt；范围或验收改变走计划变更，不以返工名义抹除义务。
- 同问题、同版本、同动作及同失败无新依据时不再执行，返回原失败并换方法/等待。机械暂时故障沿已有配置重试。
- 副作用未知先reconcile；补报告不等于重新运行原命令。任务和目标完成通过核心归约，界面百分比不能代替。

## 8. 失败与重启时的业务职责

| 中断窗口 | 下一步 | 恢复来源 |
| --- | --- | --- |
| 候选已存、响应丢失 | 查原候选，不再调用模型生成 | 原requestId/proposalRef |
| 采用前依据改变 | 重读具体差异；范围内可自主修订 | 原授权、当前目标/计划 |
| Session创建成功、claim失败 | 不运行、不删除会话，等待或另选 | Session目录和claim拒绝 |
| claim后Host中断 | Runtime续办持久意图，不重规划 | ExecutionRef/outbox/pendingDispatch |
| 用户暂停或取消 | 提交控制范围，禁止新派发，分别展示期望/实际 | 正式ControlIntent和真实ack |
| 检查后提交冲突 | 重读相关依据，仍适用结果可复用 | 当前产物/轮次/来源 |
| Kernel能力unsupported | 明确该能力未接；采用已有授权替代方案 | 能力矩阵及拒绝 |

交互常驻是入口、持久记录和按需恢复可用，不是模型一直运行。恢复解释读取已有目标、方案、决定、结果，不要求人重新描述项目。

## 9. 旧实现到新文件与删除点

| 当前源码/符号 | 目标去向 | 删除前迁移的真实消费者 |
| --- | --- | --- |
| [HumanCollaborationImpl](../../../../coding-platform/src/interaction/human-collaboration/human-collaboration.ts) `createGoal/amend/decide/applyChange` | goal-planning应用语义；共同命令规则归WG；旧HTTP走legacy-adapter | app/service与人机入口；console纯查询直达核心 |
| [InitialPlanCompiler](../../../../coding-platform/src/control/plan-compiler/initial-plan-compiler.ts) `request/accept` | goal-planning；normalize/admission归WG | 初次规划真实宿主入口，不能仅替fixture |
| [PlanCompilerImpl](../../../../coding-platform/src/control/plan-compiler/plan-compiler.ts) | 提案/采用流程与初始响应解析复用 | 目标修改、执行反馈和返工 |
| 旧baseline-evolution的架构方案/采用应用流程 | architecture-workflow；候选/决定/gate验证归WG | 架构调查、初始baseline、正式演进Host入口 |
| [VerificationService](../../../../coding-platform/src/control/verification-engine/verification-service.ts) | verification-workflow选择推进；coverage归WG，执行归Runtime | UI/HTTP检查、Reviewer、返工和恢复 |
| [planned-task-dispatch](../../../../coding-platform/src/control/dispatch-engine/planned-task-dispatch.ts)、[rework-drive](../../../../coding-platform/src/control/dispatch-engine/rework-drive.ts) | advancement选择；纯执行归Runtime | 普通、返工与审阅宿主链 |
| 旧AgentLifecycle目标（未实现） | session-policy新增策略，不保留独立顶层模块 | 所有新的Session选择入口 |
| 旧ContextCompiler规划/反馈意图 | 仅目的和时机归input-policy，取材算法归WG/Workspace | planning/reviewer/handoff材料消费者 |

不能把所有assemble函数整体搬为Workflow私有代码。相同规则不保留新旧两套；旧适配在最后一个生产调用方迁移后删除。当前文档不代表迁入或删除已经完成。

## 10. 实施与验收

1. 接核心查询/候选/命令及错误映射，沿已有真实HTTP入口验证。
2. 表驱动验证纯Session策略：相关延续、独立审阅、忙闲、maintenance占用、能力缺失、稳定排序。
3. 接真实Runtime后验证同Session连续实现/检查/返工：身份、实际历史输入及增量读取都可核对，仅ID相同不算通过。
4. 验证范围内实施不重复确认、超范围不生效、解释不新建计划、过期确认不批准新版本。
5. 验证重复推进、无新依据失败、claim冲突、检查缺项及重启，无重复执行或遗漏义务。
6. UI显示期望/实际控制、阻塞、来源；普通状态/文件查询没有模型调用和全量Context编译。
7. 对比主路径跳转、重复判据、代码量和材料加载次数，清点消费者后删除legacy-adapter。性能结论以实际测量为准。

质量标准为CQ/RG共同规则；实际证据进入[实施方案](../../IMPLEMENTATION-PLAN.md)。不新增角色层级、审批系统或分布式协调器来实现本页骨架。


## 11. R5c.1 候选：已有正式 Plan 的首条推进闭环（2026-09-26）

状态：只读源码对账后的窄批建议，待主审冻结，未预建、未派发、未实现。精确派工候选见 [R5 首批任务](../../tasks/R5-workflow-advancement-skeleton.md)与其七文件 scope；上文 `TaskPort`、`driveAccepted`、`continueSession`、`runCheck` 等仍是目标名，不能直接照抄为当前调用。首条路径为已有 adopted Plan → 选择/正式创建 Session → claim → B2 prepare/start → 原 Run 结束 → 注册检查 → 正式 Task/gate/Goal 完成 → 选择下一工作。**不等待 Query 初始规划**；无 Plan 时返回实际缺口，未来 `handleGoalInput` 再消费 R5b，而不阻塞本条路径。

R3e.1五生产实现已独审导入；[R3e.3 §9](../../tasks/R3e-completion-skeleton.md#9-r3e3-首批派工冻结机械证据到正式-taskgoal-完成)已冻结正式完成接口/13路径 scope，骨架已派。Workflow 骨架可以基于这些准确接口准备；共享 composition 顺序由 root 安排，派发前必须导入 R3e.3 骨架并刷新，正常闭环验收须实际消费已验收的检查和完成 producer。前态若仍 unsupported，报告到达位置，不 seed PASS/Reduction，不迁旧引擎顶替。

### 11.1 当前真实 owner 与必须补的窄接缝

下列路径相对 `coding-platform/next/src`：

| 当前符号 | 本批调用与边界 |
| --- | --- |
| `business/workflow/workflow.ts::createWorkflow` / `ports.ts::N0WorkflowPort` | 目前只依赖 `GoalTaskPort`，`advanceWork` 的 trigger 为 never，两入口 unsupported。本批只接已有 Plan 的 advanceWork；保留 handleGoalInput 旧接口/明确缺能力，不顺带做初次规划。 |
| `work-graph/tasks/plan-contracts.ts::PlanTaskPort` | 直接调用 queryGoal/queryTaskGraph/queryReadyTasks。沿已采用 Plan 和原 `revisionAssignments` 取任务分配；ready 使用核心 eligibility，不在 Workflow 重做 DAG/材料/source 判定。future-only、缺验收与 required 未完成说明来自图。 |
| `work-graph/sessions/contracts.ts::SessionDirectoryPort` | findSessions/readSession 返回正式 SessionCard、occupancy 与 links；按同 task、可用性和稳定 sessionId 选择，同配置的既有 Session 优先。显式 Session 忙时等待，不偷偷创建替身。实际占用由 claim CAS 决定。 |
| `agent-runtime/session-operations.ts::CreateSessionRequest` / `RuntimeExecutionPort.createSession` | 正式创建映射，返回 OperationReceipt：只有 completed 才有 SessionRecord 可领取；accepted/unknown 保留原 operationRef，重发原 create 请求继续既有操作。initialLinks 指向真实 task，不自造 Kernel sessionId/store path。 |
| `work-graph/tasks/claim-contracts.ts::TaskClaimPort` | claim 输入为 goalRef/planRef/taskId/sessionRef/完整 roleBinding/TaskBudget；结果是正式 TaskClaim。claim 只支持 work 的首次 Run，gate 不 claim，已有失败 Run 不假借新请求触发返工。 |
| `work-graph/source-authority-ports.ts::SourceSnapshotReads` | **实际 pin 缺口**：queryReadyTasks.expected 仅 Goal+Plan；claim 却要求 Goal+Workspace+Session。组合根已有 `sourceAuthority = createSourceAuthorityReader({authority: reads.authority})`，作为内部依赖注入 Workflow，精确 load Goal.workspaceRef 取得 Workspace.revision；Session pin 来自正式 card/创建回执。只组装 claim 所需三 pin，不把 ready 的 Plan pin原样塞进去，不使用 Host permissionRevision 冒领域 revision，不新增 public reader。 |
| `agent-runtime/ports.ts::RuntimeExecutionPort` | prepareExecution({runRef,requestId}) → 原 PreparedTaskExecution → startRun({prepared,consumerId,requestId})；startRun 实际 await 原 Kernel 循环并观察，返回 TaskExecutionRecord，不存在独立 runCheck/driveAccepted 方法。observeRun 只对原 Run 读历史/归约，绝不重启。内部 work_run ctx 由 Runtime 生成，Workflow 不伪装 Run 主体。 |
| `work-graph/evidence/contracts.ts::EvidencePort` | openVerification/readVerification/finalizeChecks 使用正式 Round；计划、coverage、来源适用性和 Evidence fold 全归原 owner。Workflow 不提交自报 PASS，不直接调用 recordCheckResult 伪装执行观察。 |
| `agent-runtime/check-execution.ts::RegisteredCheckRunner` | 真实方法是 runRegisteredCheck(ctx, GraphWrite<{roundRef,checkId}>)，返回 ReadResult<RoundSnapshot>。按已持久化 round.checks 的固定 checkId 逐项执行，用每次原回执的实际 Round revision；命令、源码捕获与 ProcessSandbox 均由既有 owner 管理。 |
| R3e.3 `GoalTaskPort.completeTask/completeGoal` | 复用冻结的 GraphWrite：Task 为 taskRef/planRef/roundRef，Goal 为 goalRef；原 WriteResult 完整返回。completeTask 首次 expected 为 Goal+TaskReduction@0，completeGoal 为 Goal+GoalPhase@0，具体 ref 复用既有 contracts。既有 reduction/版本冲突按正式 current/图返回处理，不绕过核心重跑 fold。 |

**完整角色配置不能从任务角色名拼出。** 当前 assignment 只有 role 名，RoleBindingRefV1 另含 bindingId/templateRevision/bindingVersion/policyRevision，Session 的 RoleConfigurationRef 也不能凭 roleId 推断。首批在 `TargetPlatformOptions` 增加可选可信 `workflow` 配置，仅含固定 consumerId 与 workspace/role 对应的 `{sessionRole: RoleConfigurationRef, roleBinding: RoleBindingRefV1, budget: TaskBudgetV1}`；类型复用原 owner，不新增权限字段。Host 构造时快照纯数据。缺配置返回具体 unsupported；不能伪造默认绑定、预算或累积上限。已有 claim Role resolver 与 Runtime resolveConfiguration 仍核真实授权/Host容量交集；配置匹配只是选择策略，不能替代执行准入。无 workflow 配置时现平台其他端口继续可用。

### 11.2 最小公开推进接口：有限步骤与原请求

首批只把现 `advanceWork` 从 never 扩为明确联合；`WorkflowPort/WorkflowDependencies` 保留 N0 别名，`handleGoalInput` 保持原参数与明确 unsupported。确切 DTO 固定为以下有限形状，完整 Port 类型以 [派工任务 §2](../../tasks/R5-workflow-advancement-skeleton.md#2-有限接口与原请求-continuation) 为准：

- `WorkflowAdvanceInput = {schemaVersion:1; goalRef; flowId; sessionHint:SessionRef|null} & ({kind:'select_work'} | {kind:'perform'; operation:WorkflowOperation})`。flowId 仅关联一条 Host 推进链，不能作所有动作共享的 idempotency key；sessionHint 是延续建议，须从目录读取真实当前事实。
- `WorkflowOperation` 仅有 create_session、claim_task、prepare、start、observe、open_checks、run_check、finalize_checks、complete_task、complete_goal 十个显式分支；每分支 request 直接取原 Port 方法的第二参数。仅 create_session 额外携带 `taskRef/planRef` 用于创建后领取；其余对象从原请求/正式回执取得，不能另传 PASS、policy、command 或模型能力。
- `WorkflowStepReceipt` 是同一十种 kind 与对应 `Awaited<ReturnType<PortMethod>>` 的判别联合，保留原 cursor/replayed/current/失败码，不弱化为布尔值。
- `WorkflowAdvanceResult` 为 `CoreRejection | {status:'ready'; value:{state:'advance'|'waiting'|'completed'; receipt:WorkflowStepReceipt|null; next:WorkflowAdvanceInput|null; reason:string|null}}`。select 只读，receipt=null；有具体新步骤时 state=advance 且 next 非空；waiting/completed 的 next=null，不能由 Host 紧循环轮询。完成只能以正式 GoalPhase/completeGoal 回执为依据。

`select_work` 从已查询 TaskGraph 的 TaskRow.eligibility/effectivePhase 选择，不复制 eligibility；再用 queryGoal 的 Goal pin、WG13 的 Workspace pin与目录 Session pin组装实际下一请求。`perform` 最多调用一个正式副作用 owner，随后才从原回执和必要窄读构造 next；不能同步跑整图到结束，也不启动后台 Promise。可信 Host 消费者可以连续调用已经返回的 next，因此正常闭环无需每步向用户确认。

每个下一操作在发送前保存完整原请求。requestId 用 `wf:` 加原 fingerprint 的 SHA-256，材料为版本1、flowId、实际 Host actor、goalRef、operation kind及原 request 的 input/expected（不含待派生 requestId）；Runtime prepare/start 使用其既有字段，保持 consumerId 与 Prepared 引用。如此一个具体动作的 pins 不变则 key 不变，新的版本/任务是新操作，不按 route 固定复用。失联时原样重发正在进行的 `perform`，不刷新 pins，不重新选 Session；失败不自动给同 payload 换 key重试。核心 operation 原回执优先；Workflow 不先以当前计划/配置门禁挡住原 request。由回执形成的新 next 只表示尚未提交的建议，不冒称已经受理。具体 scope/身份仍由正式 owners 核对，continuation 不授新权限，不建步骤表或私有去重 Map。

本批不承诺 Host 完全丢失请求后的自动冷恢复：TaskRow.execution 能定位已有 Run，因而可返回对原 Run 的 observe/检查建议；没有可靠 Round/原 operation 引用时明确缺口，不扫描账本猜请求、不新建 Run/Session 伪装恢复。现原子 owner 回执恢复是首批已有路径，高级恢复另批。返回 next 的待执行请求不代表它已受理；Host 应保存正在发出的请求用于失联重试，不能从 Workflow 返回值推断 core 已提交。

### 11.3 首条真正闭环的策略

1. 读正式 Goal/TaskGraph；active Plan 缺失返回缺口，不启动 Query。从本次 TaskGraph 已有 eligibility 投影选择本批支持的 active work/request_execution（V1 使用原 eligibility），按 required 优先及 adopted task 顺序稳定选择。plan_only、deferred 与 required 缺项保留在图，不改分配/验收来使其可执行，也不因空 ready 推断 Goal 完成。
2. 从可信配置匹配 assignment，发现相关 Session；适用的闲置原 Session 优先，不以 `Runtime.capabilities.continueHistory=false` 这一尚未同步的宽能力标签否定 B2 已验收的同 Session 新 Turn 路径。真实 claim/prepare/start 仍是许可判据。创建、Session忙、Role不匹配均保留真实结果，创建完成后不因后续claim冲突删除会话。
3. 按实际 Goal/Workspace/Session pins claim；prepare 使用原 RunRef；start 传原 Prepared 与固定 consumerId。只依据正式 `status:'ended'`、outcome 与 reconciliation 等事实决定后续，Run ended 不等于工作完成。running/unknown/quarantined/paused 返回等待及原 ref，必要时只允许显式 observe，不自动再次 start 或新建 Attempt；failed/cancelled/budget_exhausted 不自动写成功或返工。
4. 对正常 ended Run 打开该 task 的 Round；按 round.checks 逐项调用唯一 registered runner，保留真实 sourceStatus/INCONCLUSIVE/unknown。executing/未知不重跑。finalize 使用最后实际 Round revision；只有正式可采用结论才提出 completeTask，请核心最终核证据、required reviewer 与副作用。缺 reviewer producer 时按核心 incomplete 返回，不合成 PASS、不要求政策未配置的 reviewer。
5. work 正式 satisfied 后返回下一次 select_work，复用同一 Session 的原历史。所有普通工作无需都先结束才可领取另一独立任务；首批串行是 Host 选择策略，不成为新增全工作区互斥门禁，也不把 DAG 前驱整体完成替代选中材料的实际准入。
6. 没有可继续的普通工作时，按采用 Plan 处理真实 goal gate：选同 Goal 已正式 ended 的普通 producer，`openVerification` 指定 gate 自身 subject 和 `gateSubject:'goal'`，为 gate 建独立 Round/Evidence，再 completeTask(gate)，不 claim gate、不制造 gate Run。最后 completeGoal；required plan_only/缺义务/reviewer 返回具体 incomplete，optional未来节点不阻塞但仍在图。正式 Goal COMPLETED 后停止，不再选任务。先完成一个 Task 才选下一 Task，Goal 完成是整个 Goal 的终点，不把“Goal 完成→同 Goal 下一任务”当合法自动转移。

### 11.4 精确候选 scope、装配和最少验收

建议 **5 个既有生产文件 + 2 个新测试文件**，相对 next：

1. `src/business/workflow/contracts.ts`：本批明确输入/步骤与结果联合，保留 N0GoalInput；不预建 Query/架构演进/恢复 DTO。
2. `src/business/workflow/ports.ts`：advanceWork 类型及准确依赖；依赖为 plans、sessions、claims、executions、runtime、evidence、checks、tasks（含 R3e.3 完成）、已有 sourceAuthority 和可信 policy。没有 Store、Kernel、材料库或 Workspace 全仓接口。
3. `src/business/workflow/workflow.ts`：本批小型选择/续步函数与显式分支；不预建 §2 的全部策略文件，不迁旧 dispatcher/engine。
4. `src/business/workflow/index.ts`：必要类型导出及兼容别名。
5. `src/composition/create-platform.ts`：可选纯数据 workflow 配置；注入同一原子 owner 和原 Runtime/Session operations、同一 evidence/check runner 与 sourceAuthority。对外 workflow.advanceWork 沿原 trackedCall 排空；内部依赖使用同实例的 raw ports，避免 close 已开始后嵌套 public trackedCall 误拒已受理编排的后续调用；Runtime 可由现 raw runtime.port 与原 sessionOperations 的薄对象组成，不新建 runtime。关闭时原 promises/Runtime清理机制共用，不启动脱离追踪的 Promise。
6. `tests/business/R5c-workflow.test.ts`（新）：只验一个正式 Plan 两个 work 的必要选择/正常推进与原 operation 重试；用真实 core writer，注入受控模型响应，不能 fake 领域 PASS 或以 mock Workflow 证明策略。
7. `tests/composition/R5c-workflow-platform.test.ts`（新）：空 SQLite 经公开 bootstrap/Plan → 真实 Session/Kernel（受控 ModelClient）→ 两 work 顺次正式结束/真实 ProcessSandbox 注册检查/Task完成 → 独立 goal gate/Goal完成 → 读取 TaskGraph。至少第二 work 复用同一 Session 且原历史新 Turn 可定位；required future/reviewer 缺口沿现完成测试能力复用，只保留一次公开 waiting 结果，不另铺矩阵。

首批只需目标两测试、types及实际变化涉及的边界检查；不为完整异常覆盖新增轮次。阶段一发布完整接口、组合根和最终行为测试，advanceWork 明确 unsupported 后 **STOP** 中审；阶段二仅必要 Workflow 实现文件，测试/接口冻结。测试后段必须真实到达；检查/完成 producer 未到位是前置状态，不把测试种子或类型通过记成闭环完成。

本批与 Query 后续的算法、DB、模型循环无写重叠；共享 composition 在各骨架导入点串行刷新。R3e.3 的 task-service/plan reader/codec 与 Workflow 实现不重叠。R6 当前六生产实施不含 composition，无须等待其 UI 完成；本批公开 `platform.workflow.advanceWork` 是可信 Host 消费入口，R6后续薄 UI 另接，不宣称当前浏览器已自动推进。完整并行策略、返工/requeue、初始规划/Query、Reviewer producer、Workflow冷恢复与R4控制仍是后续产品范围，不以首条串行正常链关闭。
