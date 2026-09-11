import { composeReworkDrive } from '../harness/rework-composition.js';
import { ExecutionFeedbackContext } from '../data/context-compiler/execution-feedback-context.js';
import { FeedbackMaterialCompiler } from '../data/context-compiler/feedback-materials.js';
import { ExecutionFeedbackCompiler } from '../control/plan-compiler/execution-feedback-compiler.js';
import { GovernanceReadModel } from '../data/read-model-index/governance-view.js';
import { evaluateRoleSpecPinReadiness } from '../control/control-engine/policies/role-binding-admission.js';
import { ControlReworkDisposition } from '../control/control-engine/rework-disposition.js';
import { LeasedWorkerRuntime } from '../control/dispatch-engine/leased-worker-runtime.js';
import { WorkMaterialDrive } from '../control/dispatch-engine/work-material-drive.js';
import { LedgerRoleSpecRead } from '../control/dispatch-engine/role-spec-read.js';
import { WorkRunMaterialCompiler } from '../data/context-compiler/work-run-materials.js';
import { WorkspaceSourceIndexReader } from '../data/workspace-reader/role-source-reader.js';
import { RuntimeDispatch } from '../control/dispatch-engine/runtime-dispatch.js';
import { OperatorPlanCompiler } from '../control/plan-compiler/operator-plan-compiler.js';
import { OPERATOR_ENTRY_ROLES, OperatorTaskDispatch } from '../control/dispatch-engine/operator-task-dispatch.js';
import { OperatorPlanningContext } from '../data/context-compiler/operator-planning-context.js';
import { LedgerScopeCatalog } from '../data/state-ledger/ledger-scope-catalog.js';
import { InitialPlanningView } from '../data/read-model-index/initial-planning-view.js';
import { PlanCompilerImpl } from '../control/plan-compiler/plan-compiler.js';
import { CoordinationContextCompiler } from '../data/context-compiler/coordination-context-compiler.js';
import { QueryExecutionContextCompiler, QuerySourceContextCompiler } from '../data/context-compiler/query-execution-context.js';
import { PlannedTaskDispatch } from '../control/dispatch-engine/planned-task-dispatch.js';
import { ExplorationSourceApplicability } from '../data/workspace-reader/exploration-source.js';
import { VerificationSourceApplicability } from '../data/workspace-reader/verification-source-applicability.js';
import type { SourceApplicabilityPort } from '../contracts/material-access.js';
import { ExplorationContextCompiler } from '../data/context-compiler/exploration-context-compiler.js';
import { ExplorationContextDrive } from '../control/dispatch-engine/exploration-context-drive.js';
import { ExplorationMaterialReader } from '../data/artifact-vault/exploration-material-reader.js';
import { QueryWorkspaceSourceReader } from '../data/workspace-reader/query-workspace-source-reader.js';
import { ExplorationSession } from '../interaction/human-collaboration/exploration-session.js';
import { ExplorationSessionContextCompiler } from '../data/context-compiler/exploration-session-context.js';
import { ExplorationReportVerifier } from '../control/verification-engine/exploration-report-verifier.js';
import { ExplorationStartupReconciler } from '../control/control-engine/exploration-startup-reconciliation.js';
import { VerificationService } from '../control/verification-engine/verification-service.js';
import { ReworkDriveEngine } from '../control/dispatch-engine/rework-drive.js';
import type { ReworkDriveRequestV1, ReworkDriveResultV1 } from '../contracts/rework/drive.js';
import { FeedbackDecisionCompiler } from '../control/plan-compiler/feedback-decision-compiler.js';
import { FeedbackDecisionContext } from '../data/context-compiler/feedback-decision-context.js';
import { VerificationContextCompiler } from '../data/context-compiler/verification-context.js';
import { ReviewerContextCompiler } from '../data/context-compiler/reviewer-context.js';
import { ReviewerProfileCompiler } from '../data/context-compiler/reviewer-profile.js';
import { createReviewControlPorts } from '../control/control-engine/reviewer-work.js';
import { ReviewerDispatch } from '../control/dispatch-engine/reviewer-dispatch.js';
import type { ReviewRequestView } from '../contracts/reviewer-verification.js';
import { CandidateWorkspaceReader } from '../data/workspace-reader/candidate-workspace-reader.js';
import { VerificationWorkspaceReader } from '../data/workspace-reader/verification-workspace-reader.js';
import { GitCandidatePatchCheck } from '../control/verification-engine/candidate-patch-check.js';
import { unconfiguredRuntimeCapabilities } from '../execution/worker-runtime/unconfigured-capabilities.js';
import { HistoryMaterials } from '../interaction/human-collaboration/history-materials.js';
import { HistoryMaterialsContext } from '../data/context-compiler/history-materials-context.js';
import type { HistoryMaterialPort } from '../contracts/history-materials.js';
import { ReadOnlyQueryRuntime } from '../execution/worker-runtime/read-only-query-runtime.js';
import { InitialPlanning } from './initial-planning.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import { CodingAgentRuntime } from '../execution/worker-runtime/coding-agent-runtime.js';
import { validateRuntimeBudget } from '../execution/worker-runtime/model-budget.js';
import type { RunPort } from '../contracts/ports.js';
import type { RunSnapshot } from '../contracts/dispatch.js';
import { ConfiguredWorkspaceCapabilityPolicy } from '../control/control-engine/policies/workspace-capability.js';
type RealOptions = {
    reviewerModelMetadata?: import('../contracts/reviewer-context.js').ReviewerModelMetadataPort;
    explorationContextOnlyRoots?: string[];
    clock?: () => string;
    resolveReferences?: (scope: {
        projectId: string;
        workspaceId: string;
    }, refs: unknown) => Promise<string>;
    contextOnlyTask?: {
        root: string;
        requestId: string;
    };
    runtime: CodingAgentRuntime;
    /** Explicitly enable the fixture executor alongside a configured runtime.
     * The fixture path is never inferred from a planId/runId shape. */
    fixtureExecution?: boolean;
    rootFor: (projectId: string, workspaceId: string) => string;
};
import { randomUUID } from 'node:crypto';
import { ProjectArchitectureSourceReader } from '../data/workspace-reader/source-workspace-reader.js';
import { SourceGraphContextCompiler } from '../data/context-compiler/source-graph-context.js';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPersistentSqliteHarness } from '../harness/persistent-harness.js';
import { buildBootstrapCommand } from '../contracts/bootstrap.js';
import { buildInstallCommand, buildActivateCommand } from '../contracts/commands/governance.js';
import { completionPolicyPinFor, architectureBaselinePinFor } from '../contracts/governance.js';
import { COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1 } from '../fixtures/governance-fixtures.js';
import { ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1 } from '../fixtures/architecture-evolution-policy-fixtures.js';
import { ROLE_SPEC_SOURCES_V1 } from '../fixtures/role-spec-fixtures.js';
import { GovernanceEntry } from './governance.js';
import { PlanChangesEntry } from './plan-changes.js';
import { buildApplyPlanCommand } from '../contracts/commands/plan.js';
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1 } from '../fixtures/plan-fixtures.js';
import { FakeReadOnlyQueryAdapter } from '../execution/worker-runtime/read-only-query-adapter.js';
import { FakeRuntimeAdapter } from '../execution/worker-runtime/fake-runtime-adapter.js';
import { buildDispatchClaimCommand } from '../contracts/commands/dispatch.js';
import type { ExecutionCapabilityV1 } from '../contracts/execution-capability.js';
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from '../fixtures/dispatch-fixtures.js';
import type { CommitCursor } from '../contracts/command-event.js';
type Scope = {
    projectId: string;
    workspaceId: string;
};
async function createScopedGuiService(dir: string, scopes: Scope[], seedGoals: boolean, real?: RealOptions) {
    await mkdir(dir, { recursive: true });
    const now = real?.clock ?? (() => new Date().toISOString());
    const executionCapability: ExecutionCapabilityV1 = real
        ? { executor: 'coding-agent', source: 'configured-runtime', fixtureEnabled: real.fixtureExecution === true }
        : { executor: 'fixture', source: 'explicit-fixture-service', fixtureEnabled: true };
    const fakeRuntime = new FakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, { scriptFor: () => ({ schemaVersion: 1, items: FAKE_RUNTIME_SCRIPT_COMPLETED_V1.items.map(item => ({ ...item, occurredAt: now() })) }) });
    let h: Awaited<ReturnType<typeof createPersistentSqliteHarness>>;
    let verifications: VerificationService | undefined;
    const background = new Set<Promise<unknown>>();
    let projectionQueue: Promise<unknown> = Promise.resolve();
    const project = () => { const next = projectionQueue.then(() => h.advanceProjection()); projectionQueue = next.catch(() => { }); return next; };
    // 普通真实运行的工作身份与历史材料。两条材料通道各自独立、都在派发准备阶段运行：
    //   - 探索运行走既有 ExplorationContextDrive；
    //   - 普通开发运行走 WorkMaterialDrive（取材在 ContextCompiler，身份规则在 DispatchEngine）。
    // 二者都只在 runtime.start 之前调用一次，不新增运行期读取路径。
    // 注意：这两个驱动都必须在 harness 建好之后才能构造，因此只在回调里解引用（闭包延迟求值）。
    let workMaterialDrive: WorkMaterialDrive | undefined;
    const leasedRuntime = real ? new LeasedWorkerRuntime({ runtime: real.runtime, lease: () => h.workspaceLease, vault: () => h.vault,
        materials: (spec, envelope) => spec.mode === 'explore' ? explorationDrive!.assembleRun(spec, envelope) : workMaterialDrive!.assembleRun(spec, envelope),
        reviewerMaterials: (spec, envelope) => {
            if (!reviewerContext || !spec.review) throw Error('独立审阅材料入口未配置');
            return reviewerContext.runtime(spec.review.workRef, envelope);
        }, now }) : undefined;
    const runtime: RunPort = leasedRuntime ? {
        capabilities: () => leasedRuntime.capabilities(),
        start: envelope => envelope.roleBinding.templateId === 'gui-fixture' && envelope.roleBinding.policyRevision === 'fixture-only-v1'
            ? fakeRuntime.start(envelope) : leasedRuntime.start(envelope),
    } : fakeRuntime;
    const workspaceCapability = new ConfiguredWorkspaceCapabilityPolicy({ workspaceRead: true, workspaceWrite: true, maxWriteScope: null });
    const queryFixture = new FakeReadOnlyQueryAdapter();
    const realQueries = real ? new ReadOnlyQueryRuntime(resolve(dir, 'query-runs'), { materials: new QueryExecutionContextCompiler({ ledger: () => h.ledger, vault: () => h.vault }), rootFor: real.rootFor, bind: runId => real.runtime.bindModel(runId) }) : undefined;
    const querySources = realQueries && real ? new QuerySourceContextCompiler({ ledger: () => h.ledger, observations: realQueries.observations, source: new QueryWorkspaceSourceReader(real.rootFor) }) : undefined;
    await realQueries?.init();
    const readOnlyQuery = { capabilities: (request: Parameters<FakeReadOnlyQueryAdapter['capabilities']>[0]) => realQueries?.capabilities() ?? queryFixture.capabilities(request),
        startQuery: async (request: Parameters<FakeReadOnlyQueryAdapter['startQuery']>[0]) => {
            const job = await h.ledger.load({ aggregateType: 'QueryJob', projectId: request.runRef.projectId, workspaceId: request.runRef.workspaceId, queryJobId: request.runRef.queryJobId });
            if (job.status !== 'found')
                throw Error('查询缺少正式执行描述');
            const execution = (job.snapshot as import('../contracts/query-job.js').QueryJobSnapshot).job.intent.execution;
            if (execution) {
                if (!realQueries)
                    throw Error('真实查询能力未配置');
                return realQueries.startQuery(request);
            }
            return { ...await queryFixture.startQuery(request), endedAt: now() };
        } };
    const sourceReader = real ? new SourceGraphContextCompiler({ ledger: () => h.ledger, vault: () => h.vault, source: new ProjectArchitectureSourceReader(real.rootFor), now }) : undefined;
    const explorationSource = real ? new ExplorationSourceApplicability(real.rootFor) : undefined;
    const verificationSource = real ? new VerificationSourceApplicability(real.rootFor) : undefined;
    const sourceApplicability: SourceApplicabilityPort | undefined = real ? {
        capture: (query, signal) => query.sourceSet.kind === 'verification_workspace'
            ? verificationSource!.capture(query, signal) : explorationSource!.capture(query, signal),
    } : undefined;
    h = await createPersistentSqliteHarness({ dir, runtime, readOnlyQuery, workspaceCapability, ...(sourceApplicability ? { sourceApplicability } : {}),
        ...(real ? { checkPorts: [], ...unconfiguredRuntimeCapabilities(now),
            verification: { verify: async request => {
                if (!verifications) throw Error('验证服务尚未完成初始化');
                return verifications.verify(request);
            } },
            workspaceReader: sourceReader!,
            codeGraph: { codeGraph: async (query) => {
                    const result = await sourceReader!.read({ ...query, requestedKinds: ['module', 'interface'], maxNodes: 512, maxEdges: 1024 });
                    return result.status === 'sourced' ? { status: 'supported' as const, snapshotRef: result.snapshot.bodyRef, capabilityNote: 'TS/JS semantic imports with explicit source mapping' } : result.status === 'rejected' ? { status: 'rejected' as const, code: 'unavailable' as const, issues: result.issues } : result;
                } } } : {}),
        deps: { clock: now, commandId: randomUUID, correlationId: randomUUID, eventId: randomUUID } });
    const deps = (projectId: string, idempotencyKey: string = randomUUID()) => ({ projectId, actor: { kind: 'human' as const, id: 'user-1' }, idempotencyKey, commandId: randomUUID(), correlationId: randomUUID(), submittedAt: now() });
    const check = <T extends {
        status: string;
    }>(receipt: T): T => {
        if (receipt.status === 'rejected')
            throw new Error(JSON.stringify(receipt));
        return receipt;
    };
    // Seed via public commands, with stable payloads and keys so restart is a replay.
    const boot = buildBootstrapCommand({ schemaVersion: 1, entries: scopes }, { commandId: 'gui-bootstrap-v1', correlationId: 'gui-bootstrap-v1', submittedAt: '2026-09-07T00:00:00.000Z' });
    check(await h.bootstrap(boot));
    for (const scope of scopes) {
        await installGovernance(scope.projectId);
        if (seedGoals)
            check(await h.collaboration.createGoal({ ...scope, goalId: 'acceptance-demo', objective: scope.projectId.endsWith('alpha') ? '验收核心流程：计划、运行、查询与持久化' : '隔离对照项目：相同本地标识，独立数据', actor: { kind: 'human', id: 'local-gui' }, idempotencyKey: 'gui-demo-goal' }));
    }
    const runtimeDispatch = real ? new RuntimeDispatch({ ledger: h.ledger, control: h, outbox: { drive: h.drive }, runtime: real.runtime, now }) : undefined;
    const recovery = await runtimeDispatch?.recover(scopes);
    if (recovery?.rejected.length)
        throw Error('运行恢复事实尚未被接纳：' + JSON.stringify(recovery.rejected));
    const verificationContext = new VerificationContextCompiler({ ledger: h.ledger, vault: h.vault, ...(real ? { runtime: real.runtime.observations, rootFor: real.rootFor, workspaceSource: new CandidateWorkspaceReader(), roundSource: new VerificationWorkspaceReader() } : {}) });
    const reviewerProfiles = real ? new ReviewerProfileCompiler({ ledger: h.ledger, observations: real.runtime.observations,
        modelMetadata: real.reviewerModelMetadata ?? { current: async () => null } }) : undefined;
    const reviewerContext = real ? new ReviewerContextCompiler({ ledger: h.ledger, vault: h.vault, roundContext: verificationContext,
        profiles: reviewerProfiles!, source: verificationSource!, observations: real.runtime.observations }) : undefined;
    const reviewControl = real ? createReviewControlPorts({ ledger: h.ledger, now, eventId: randomUUID }) : undefined;
    const reviewerDispatch = real ? new ReviewerDispatch({ ledger: h.ledger, control: h, reviewControl: reviewControl!.dispatch,
        context: reviewerContext!, runtime: real.runtime, execution: leasedRuntime!, observations: real.runtime.observations,
        vault: h.vault, now }) : undefined;
    verifications = real ? new VerificationService({ directory: resolve(dir, 'verifications'), disposition: new ControlReworkDisposition(h.ledger as never), context: verificationContext, control: h, vault: h.vault,
        workspaceLease: h.workspaceLease, candidatePatchCheck: new GitCandidatePatchCheck(),
        // 轮次核对角色必产出时用的是**同一份** ControlEngine 受理判据（与派发时取材的那一份
        // 是同一个只读实现）。组合根只做注入，不在这里复制矩阵 pin／revision／权限的判定规则。
        roleSpec: new LedgerRoleSpecRead({ ledger: h.ledger }),
        review: { context: reviewerContext!, profiles: reviewerProfiles!, control: reviewControl!.lifecycle } }) : undefined;
    await verifications?.init();
    // 返工触发驱动。未处置问题用的是 VerificationEngine **自己的**只读出口
    // （VerificationService.openIssues），没有第二条读取路径；写入只经 ControlEngine 的既有
    // 自动受理入口，组合根不直接 commit。因此 DispatchEngine 与 VerificationEngine 之间
    // 没有源码依赖，ModuleDependencyDAG 的 VerificationEngine → ControlEngine 方向不被破坏。
    const reworkDrive = composeReworkDrive({
        coordination:{validate:row=>feedbackCompiler?.validate(row)??Promise.resolve(false)},
        ledger: h.ledger,
        control: h.control,
        issues: request => verifications
            ? verifications.openIssues(request)
            : Promise.resolve({ status: 'unavailable' as const, code: 'unavailable' as const, message: '真实验收未配置：没有未处置问题的只读出口。' }),
    });
    const history: HistoryMaterialPort = new HistoryMaterials({ materials: new HistoryMaterialsContext({ ledger: h.ledger, vault: h.vault }), catalog: () => verifications?.checkReportMaterials() ?? [], control: h, grants: h, now });
    const operatorPlans = real ? new OperatorPlanCompiler({ directory: resolve(dir, 'explorations'), context: new OperatorPlanningContext({ ledger: h.ledger, rootFor: real.rootFor }), control: h, now }) : undefined;
    const operatorDispatch = real ? new OperatorTaskDispatch({ ledger: h.ledger, control: h, runtime: real.runtime, planning: operatorPlans!, launch: (scope, runId) => launchRealDrive(scope, scope.goalId, runId), now }) : undefined;
    const explorationContext = real ? new ExplorationSessionContextCompiler({ ledger: h.ledger, runtime: real.runtime.observations, rootFor: real.rootFor }) : undefined;
    const explorationDrive = real ? new ExplorationContextDrive({ context: new ExplorationContextCompiler({ ledger: h.ledger, vault: h.vault, source: sourceApplicability! }), control: { grantMaterialAccess: h.grantMaterialAccess }, vault: h.vault, materials: new ExplorationMaterialReader({ directory: resolve(dir, 'explorations') }) }) : undefined;
    // 普通真实运行的材料通道。取材（选什么、缺什么）在 ContextCompiler；
    // 身份规则与时机在 DispatchEngine，两边都复用既有端口，不新增 Module 或平行路径。
    const catalog = new LedgerScopeCatalog(h.ledger);
    workMaterialDrive = real ? new WorkMaterialDrive({
        ledger: h.ledger,
        feedback: new FeedbackMaterialCompiler({ledger:h.ledger,vault:h.vault,catalog,source:new QueryWorkspaceSourceReader(real.rootFor),applicability:sourceApplicability!}),
        // 这次运行的工作身份由 ControlEngine 的权威解析面给出（派发面不重算第二份）。
        control: {resolveTaskWorkIdentity:query=>h.control.resolveTaskWorkIdentity(query),grantMaterialAccess:command=>h.grantMaterialAccess(command)},
        compiler: new WorkRunMaterialCompiler({
            ledger: h.ledger, vault: h.vault, workContext: h.workContext, completedWork: h.completedWork,
            // 角色规格的解析判据来自 ControlEngine 自己的受理策略；组合根只做注入，
            // 不在这里复制矩阵 pin／revision／权限的判定规则。
            roleSpec: new LedgerRoleSpecRead({ ledger: h.ledger }),
            // 角色必读材料「code」的取材通道。检出根只有组合根知道，因此宿主在这里绑定
            // rootFor；读取本身归 WorkspaceReader（role-source-reader.ts），复用本 Module 与内核
            // 既有的工作区读取能力（拒绝前缀只有 workspace-reader/denied-prefixes.ts 一个来源，
            // 逐文件 revision 由内核给出）。组合根不新开第二条读取路径，也不在这里做权限判定
            // （权限与工作区版本由 ContextCompiler 按 claim 时的信封核对）。
            sourceIndex: new WorkspaceSourceIndexReader({ rootFor: real.rootFor }),
        }),
    }) : undefined;
    const explorations = real ? new ExplorationSession({
        directory: resolve(dir, 'explorations'), planning: operatorPlans!, context: explorationContext!,
        verification: new ExplorationReportVerifier({ context: explorationContext!, vault: h.vault }),
        recordedVerification: verifications!.recorded,
        contextDrive: explorationDrive!,
        startup: new ExplorationStartupReconciler({ ledger: h.ledger, control: h }), vault: h.vault, control: h,
    }) : undefined;
    await explorations?.init();
    const planningMaterials = new CoordinationContextCompiler({ ledger: h.ledger, catalog, ...(querySources ? { sources: querySources } : {}) });
    const feedbackCompiler = real ? new ExecutionFeedbackCompiler({control:h.control,now,
      materials:new ExecutionFeedbackContext({ledger:h.ledger,vault:h.vault,catalog,observations:real.runtime.observations,source:sourceApplicability!,querySource:new QueryWorkspaceSourceReader(real.rootFor)})}) : undefined;
    const feedbackDecisionMaterials=new FeedbackDecisionContext(h.ledger,real?new QueryWorkspaceSourceReader(real.rootFor):undefined,catalog);
    const feedbackDecisions=new FeedbackDecisionCompiler({materials:feedbackDecisionMaterials,planning:h.planProposal,control:h.control,now});
    const initialPlanning = real && realQueries ? new InitialPlanning(new PlanCompilerImpl({ workIdentity: h.control, materials: planningMaterials, control: h, now }), new PlannedTaskDispatch(h, real.runtime, real.rootFor, (scope, runId) => launchRealDrive(scope, scope.goalId, runId), planningMaterials, now), new InitialPlanningView(h, catalog, realQueries), () => h.driveQuery({ reason: 'initial-coordination' })) : undefined;
    let planningQueue: Promise<unknown> = Promise.resolve();
    let closing = false;
    function advancePlanning() {
        if (!initialPlanning || closing)
            return;
        const work = planningQueue.then(() => initialPlanning.advance()).then(() => project());
        planningQueue = work.catch(() => { });
        background.add(work);
        void work.finally(() => background.delete(work)).catch(() => { });
    }
    await project();
    async function installGovernance(projectId: string) {
        for (const [index, fixture] of [COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1].entries()) {
            const key = `gui-governance-${index}`;
            const install = buildInstallCommand(fixture, { ...deps(projectId, key), submittedAt: '2026-09-07T00:00:00.000Z' });
            check(await h.install(install));
            const pin = install.commandType === 'InstallCompletionPolicyRevision' ? completionPolicyPinFor(install) : architectureBaselinePinFor(install);
            check(await h.activate(buildActivateCommand(pin, { ...deps(projectId, `${key}-activate`), expectedRevision: 1, submittedAt: '2026-09-07T00:00:00.000Z' })));
        }
    }
    // 治理安装/激活的产品入口。五个种类都走**既有** ControlEngine 命令面（h.install /
    // h.activate / installCoordinationPolicy / activateCoordinationPolicy /
    // installArchitectureEvolutionPolicy / activateArchitectureEvolutionPolicy /
    // h.control.installRoleSpec + activateRoleSpec），本组合根只负责
    // 把 HTTP 输入翻译成那些命令，并提供"当前生效的是哪一份、谁在什么时候装的"的读侧。
    // 内置 fixture 只在这里注入（module-map 只允许组合根引用 fixtures）；CoordinationPolicy
    // 没有内置来源——自动化返工预算必须由人显式提交，不能被默认值授予。
    const governanceRoleSources = ROLE_SPEC_SOURCES_V1.map(source => ({ roleId: source.roleId, content: source.content }));
    const governanceEntryRoles = [
      { roleId: OPERATOR_ENTRY_ROLES.develop, purpose: '人工授权的真实运行（/api/real/tasks）' },
      { roleId: OPERATOR_ENTRY_ROLES.explore, purpose: '只读探索运行（/api/real/explorations/run）' },
    ];
    const governance = new GovernanceEntry({
        views: new GovernanceReadModel({ ledger: () => h.ledger, defaults: { RoleSpecs: governanceRoleSources }, entryRoles: governanceEntryRoles,
          policyExplanation: { roleSpecPinReadiness: evaluateRoleSpecPinReadiness } }),
        ledger: () => h.ledger,
        install: command => h.install(command),
        activate: command => h.activate(command),
        installCoordinationPolicy: command => h.installCoordinationPolicy(command),
        activateCoordinationPolicy: command => h.activateCoordinationPolicy(command),
        installArchitectureEvolutionPolicy: command => h.installArchitectureEvolutionPolicy(command),
        activateArchitectureEvolutionPolicy: command => h.activateArchitectureEvolutionPolicy(command),
        // 第五个种类复用 ControlEngine **既有**的角色规格入口（RoleSpecPort），不新增写入路径。
        // harness 面没有单列这两个方法，因此经 h.control 直接取同一实现（组合根只做注入）。
        installRoleSpec: command => h.control.installRoleSpec(command),
        activateRoleSpec: command => h.control.activateRoleSpec(command),
        defaults: {
            CompletionPolicy: COMPLETION_POLICY_FIXTURE_V1,
            ArchitectureBaseline: ARCHITECTURE_BASELINE_FIXTURE_V1,
            ArchitectureEvolutionPolicy: ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1,
            // 内置角色规格 source（与上面三条同一定位：它是 source 内容，本身不产生授权，
            // 必须经 install + activate 才生效）。
            RoleSpecs: governanceRoleSources,
        },
        // 产品自带的人工派发入口绑定、并会被角色矩阵校验的角色。逐个写明它属于哪条入口，
        // 视图据此回答「装这份矩阵会不会把这些入口一起打断」。
        entryRoles: governanceEntryRoles,
        actor: { kind: 'human', id: 'user-1' },
        now,
        commandId: randomUUID,
    });
    // 计划变更只读入口。数据只有一处来源——既有投影 h.planChangeView；本入口只负责把
    // 投影的 not_found 说清楚（确实没有变更 / 投影尚未推进），不重算、不复制业务规则，也不写任何状态。
    const planChanges = new PlanChangesEntry({
        advance: async () => { await project(); },
        view: query => h.planChangeView(query),
        observedCursor: () => h.observedCursor(),
    });
    let queue: Promise<unknown> = Promise.resolve();
    function serial<T>(fn: () => Promise<T>): Promise<T> { const next = queue.then(fn); queue = next.catch(() => { }); return next; }
    function scopeOf(input: Record<string, unknown>) {
        const scope = scopes.find(s => s.projectId === input['projectId'] && s.workspaceId === input['workspaceId']);
        if (!scope)
            throw new Error('未知项目或工作区');
        // Preserve legacy request fingerprints that include mount metadata.
        // Module boundaries must select exact fields for canonical references.
        return scope;
    }
    function required(input: Record<string, unknown>, key: string): string {
        const value = input[key];
        if (typeof value !== 'string' || !value.trim() || value.length > 4096)
            throw new Error(`无效字段：${key}`);
        return value.trim();
    }
    async function state(input: Record<string, unknown>) {
        const scope = scopeOf(input);
        await project();
        const goalIds = new Set(await catalog.goals(scope));
        const queryIds = new Set((await catalog.jobs(scope)).map(snapshot => snapshot.job.queryJobId));
        const goals = await Promise.all([...goalIds].map(goalId => h.collaboration.goalView({ ...scope, goalId })));
        const goalId = typeof input['goalId'] === 'string' && input['goalId'] ? input['goalId'] : [...goalIds][0] ?? '';
        if (!goalId) {
            const empty = { status: 'not_found' as const, observedCursor: h.observedCursor() };
            return { scope, goalId, goals, summary: await h.consoleSummary(scope), matrix: empty, agents: empty, timeline: await h.consoleTimeline(scope), graph: empty, evidence: [], queries: [], goalStatus: empty, observedCursor: h.observedCursor(), executor: executionCapability.executor, executionCapability, storage: 'SQLite' };
        }
        if (!goalIds.has(goalId))
            throw new Error('该工作区中不存在此目标');
        const query = { ...scope, goalId };
        const [summary, matrix, agents, timeline, graph, queries, goalStatus] = await Promise.all([
            h.consoleSummary(scope), h.consolePlanMatrix(query), h.consoleActiveAgents(query), h.consoleTimeline({ ...query, maxEntries: 80 }), h.planGraph({ projectId: scope.projectId, goalId }),
            Promise.all([...queryIds].map(queryJobId => h.queryJobView({ ...scope, queryJobId }))), h.goalStatus({ projectId: scope.projectId, goalId })
        ]);
        const evidence = matrix.status === 'ready' ? await Promise.all(matrix.matrix.rows.map(row => h.consoleTaskEvidence({ ...query, taskId: row.taskId }))) : [];
        const queryCurrentness = await querySources?.currentness(scope.projectId, scope.workspaceId);
        for (const view of queries)
            if (view.status === 'ready' && view.currentAnswer && queryCurrentness?.get(view.job.queryJobId) === false) {
                view.stale = true;
                view.currentAnswer = { ...view.currentAnswer, stale: true, staleReason: 'current_goal_workspace_or_source_changed' };
            }
        return { scope, goalId, goals, summary, matrix, agents, timeline, graph, evidence, queries, goalStatus, exploration: await explorations?.view({ ...scope, goalId }) ?? null, planning: await initialPlanning?.view({ ...scope, goalId }) ?? [], liveRuns: real?.runtime.all().filter(r => r.spec.projectId === scope.projectId && r.spec.goalId === goalId && agents.status === 'ready' && agents.agents.rows.some(row => row.runRef.runId === r.spec.runId)).map(r => ({ ...r, ...verifications?.forRun({ projectId: r.spec.projectId, workspaceId: r.spec.workspaceId, goalId: r.spec.goalId, runId: r.spec.runId }) })) ?? [], observedCursor: h.observedCursor(), executor: executionCapability.executor, executionCapability, storage: 'SQLite' };
    }
    function launchRealDrive(scope: Scope, goalId: string, runId: string) {
        if (!runtimeDispatch)
            throw Error('真实执行未配置');
        const drive = runtimeDispatch.drive({ reason: 'gui-real-task', runRef: { aggregateType: 'Run', projectId: scope.projectId, goalId, runId } }).then(async () => {
            await continueEndedRun(scope,goalId,runId);
            await project();
            advancePlanning();
        });
        background.add(drive);
        void drive.finally(() => background.delete(drive)).catch(() => { });
    }
    async function continueEndedRun(scope:Scope,goalId:string,runId:string) {
        const record=real?.runtime.all().find(r=>r.spec.projectId===scope.projectId && r.spec.workspaceId===scope.workspaceId && r.spec.goalId===goalId && r.spec.runId===runId);
        if(!record || record.spec.mode || ['prepared','running','outcome_unknown'].includes(record.status)) return;
        await feedbackCompiler?.request({aggregateType:'Run',projectId:scope.projectId,goalId,runId});
        await h.driveQuery({reason:'execution-feedback'});
        const result=await verifications?.reverifyRework({projectId:scope.projectId,workspaceId:scope.workspaceId,goalId,runId,taskId:record.spec.taskId});
        if(result && !('status' in result)) {
          const review=await verifications?.prepareReworkReview({projectId:scope.projectId,workspaceId:scope.workspaceId,goalId,runId,taskId:record.spec.taskId},result.round.requestId);
          if(review) launchReview(review.review);
          await triggerRework(scope,goalId);
        }
    }
    /**
     * 本进程最近一次自动触发的返工结果（Host 会话状态）。它**不是**权威事实：受理结果由
     * 账本重建（见 reworkView），这里只是让刚发生的触发结论可被查询。重启后为空，不冒充历史。
     */
    const lastReworkDrives = new Map<string, ReworkDriveResultV1>();
    const reworkKey = (scope: Scope, goalId: string) => scope.projectId + '|' + scope.workspaceId + '|' + goalId;
    /**
     * RW-06 触发点：验证结论被接纳并归约**之后**由组合根调用返工驱动。
     *
     * 为什么在这里而不是 VerificationEngine 内部：让 VerificationEngine 反向调用 DispatchEngine
     * 会在 ModuleDependencyDAG 上形成环（scripts/module-map.mjs 会直接判为违规）。验证的职责是
     * 产出并提交结论，"接下来谁去做返工"属于派发面。
     *
     * 失败隔离：驱动自身的异常只记录在结果/日志里，不改变原有动作的返回值；驱动幂等，
     * 重复触发不会产生第二份提案或第二个 revision。
     */
    let semanticReworkQueue:Promise<unknown> = Promise.resolve();
    function triggerRework(scope: Scope, goalId: string): Promise<void> {
        const request: ReworkDriveRequestV1 = { schemaVersion: 1, projectId: scope.projectId, workspaceId: scope.workspaceId, goalId };
        const work = semanticReworkQueue.then(async () => {
          const accepted:ReworkDriveResultV1['acceptedPlanRefs'] = [];
          for (;;) {
            if (feedbackCompiler && verifications) {
                request.issueMaterials = await verifications.openIssues({...request,taskIds:[]});
                const refs = await feedbackCompiler.requestFailures(request.issueMaterials);
                if(refs.length) await feedbackCompiler.renew({...scope,goalId});
                await h.driveQuery({reason:'verification-feedback'});
                request.coordination = [];
                for (const ref of refs) {
                    const result = await feedbackCompiler.failureResolution(ref.queryJobId);
                    if (result) request.coordination.push(result);
                }
            }
            const result=await reworkDrive.driveRework(request);
            accepted.push(...result.acceptedPlanRefs);
            // Each successful acceptance changes canonical plan identity. Re-capture
            // remaining failures before dispatching workers against that new plan.
            if(!feedbackCompiler || !result.acceptedPlanRefs.length) return {...result,acceptedPlanRefs:accepted};
          }
        }).then(async result => {
            lastReworkDrives.set(reworkKey(scope, goalId), result);
            // 受理会推进 plan revision；新 revision 的任务继续走既有派发收口。
            if (result.acceptedPlanRefs.length > 0)
                advancePlanning();
            await serial(project);
        }).catch(error => {
            // 自动返工是原有动作之后的收尾步骤：它失败不能让验证动作看起来失败。
            console.error('自动返工触发失败：' + String(error));
        }).finally(() => {
            // A committed acceptance may have lost its reply or be followed by
            // another group's failure. Dispatch reconciles canonical pending work.
            advancePlanning();
        });
        semanticReworkQueue=work;
        background.add(work);
        void work.finally(() => background.delete(work)).catch(() => { });
        return work;
    }
    const reviewDrives = new Map<string, Promise<unknown>>();
    function launchReview(view: ReviewRequestView) {
        if (!reviewerDispatch || !verifications || !view.work || view.work.resultRef || view.phase === 'work_rejected') return;
        const key = canonicalJson(view.work.ref);
        if (reviewDrives.has(key)) return;
        const workRef = view.work.ref;
        const work = reviewerDispatch.drive(workRef)
            .then(() => verifications!.resumeReview(view.scope, { requestId: view.requestId }))
            // 独立审阅交付正式结论（并已归约）之后，才轮到组合根触发自动返工。
            .then(async () => { await triggerRework(view.scope, view.scope.goalId); })
            .finally(project);
        reviewDrives.set(key, work);
        background.add(work);
        void work.finally(() => { reviewDrives.delete(key); background.delete(work); }).catch(() => { });
    }
    /**
     * Formal-receipt lookup for one logical request.
     *
     * A browser whose response was lost must ask what the server actually recorded
     * instead of guessing or blindly retrying. Every answer comes from canonical
     * facts: the Goal read model, the Run aggregate plus the runtime record, or the
     * persisted command-check record. "found: false" means the request never
     * reached the server, so retrying with the same requestId cannot duplicate it.
     */
    async function receipt(scope: Scope, input: Record<string, unknown>) {
        const requestId = required(input, 'requestId');
        const kind = input['kind'];
        if (kind !== 'goal' && kind !== 'real-task' && kind !== 'command-check' && kind !== 'verification-round' && kind !== 'independent-review')
            throw Error('未知的回执查询类型');
        const observedAt = now();
        if (kind === 'goal') {
            await project();
            const view = await h.collaboration.goalView({ ...scope, goalId: requestId });
            return { requestId, kind, found: view.status === 'ready', goalStatus: view.status === 'ready' ? view.goal.goalId : null, runId: null, runStatus: null, runtimeStatus: null, check: null, observedAt };
        }
        if (kind === 'real-task') {
            const runId = `real-${requestId}`;
            const loaded = await h.ledger.load({ aggregateType: 'Run', projectId: scope.projectId, goalId: required(input, 'goalId'), runId });
            const record = real?.runtime.all().find(r => r.spec.projectId === scope.projectId && r.spec.goalId === required(input, 'goalId') && r.spec.runId === runId) ?? null;
            const planning = (await initialPlanning?.view({ ...scope, goalId: required(input, 'goalId') }))?.find(row => row.requestId === requestId);
            return { requestId, kind, found: loaded.status === 'found' || !!planning, goalStatus: null, runId, runStatus: loaded.status === 'found' ? (loaded.snapshot as RunSnapshot).status : planning?.status ?? null, runtimeStatus: record?.status ?? null, check: null, observedAt };
        }
        if (!verifications)
            throw Error('真实验收未配置');
        if (kind === 'independent-review') {
            const review = await verifications.reviewReceipt({ projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: required(input, 'goalId') }, requestId);
            return { requestId, kind, found: !!review, goalStatus: null, runId: review?.scope.runId ?? null, runStatus: null, runtimeStatus: null, check: null, review, observedAt };
        }
        if (kind === 'verification-round') {
            const round = await verifications.roundReceipt({ ...scope, goalId: required(input, 'goalId') }, requestId);
            return { requestId, kind, found: !!round, goalStatus: null, runId: round?.runId ?? null, runStatus: null, runtimeStatus: null, check: null, round, observedAt };
        }
        const check = await verifications.checkReceipt({ ...scope, goalId: required(input, 'goalId') }, requestId);
        return { requestId, kind, found: !!check, goalStatus: null, runId: check?.runId ?? null, runStatus: null, runtimeStatus: null, check, observedAt };
    }
    async function action(path: string, input: Record<string, unknown>) {
        const scope = scopeOf(input);
        if (path === '/api/receipts')
            return receipt(scope, input);
        if (path === '/api/goals') {
            const goalId = required(input, 'requestId');
            check(await h.collaboration.createGoal({ ...scope, goalId, objective: required(input, 'objective'), actor: { kind: 'human', id: 'local-gui' }, idempotencyKey: `gui-create-${goalId}` }));
            await project();
            return { goalId };
        }
        // 治理入口是**项目级**的，与 Goal 无关，因此放在 goalId 必填检查之前。
        if (path === '/api/real/governance/view')
            return governance.view(scope);
        if (path === '/api/real/governance/install')
            return governance.install(scope, input);
        if (path === '/api/real/governance/activate')
            return governance.activate(scope, input);
        const goalId = required(input, 'goalId');
        const view = await h.collaboration.goalView({ ...scope, goalId });
        if (view.status !== 'ready')
            throw new Error('目标不存在');
        if (path === '/api/real/work') {
            if (!real || !initialPlanning)
                throw Error('真实协调尚未配置');
            if (input['references'] !== undefined && !real.resolveReferences)
                throw Error('文件引用读取未配置');
            const referenceContext = real.resolveReferences ? await real.resolveReferences(scope, input['references']) : '';
            const result = await initialPlanning.submit({ ...scope, goalId }, input, referenceContext);
            advancePlanning();
            return result;
        }
        if (path === '/api/real/planning')
            return { rows: await initialPlanning?.view({ ...scope, goalId }) ?? [] };
        if (path === '/api/real/queries') {
            if (!real || !realQueries)
                throw Error('真实查询未配置');
            const id = required(input, 'requestId'), budget = validateRuntimeBudget(input['budget']);
            const queryJobId = 'real-query-' + id, runId = queryJobId;
            const original = await h.ledger.load({ aggregateType: 'QueryJob', ...scope, queryJobId });
            const submittedAt = original.status === 'found' ? (original.snapshot as import('../contracts/query-job.js').QueryJobSnapshot).job.submittedAt : now();
            const result = check(await h.submitQueryJob({ schemaVersion: 1, commandType: 'SubmitQueryJob', commandId: queryJobId, identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'local-gui' }, idempotencyKey: queryJobId }, aggregateId: queryJobId, expectedRevision: 0, correlationId: queryJobId, submittedAt,
                payload: { runId, intent: { schemaVersion: 1, intentId: queryJobId, ...scope, goalId, question: required(input, 'question'), focusTaskRefs: [],
                        budget: { maxTokens: budget.contextWindowTokens, deadline: budget.timeoutMs === null ? null : new Date(Date.parse(submittedAt) + budget.timeoutMs).toISOString() }, multiTurn: { maxRounds: 1 }, correlationId: queryJobId,
                        execution: { kind: 'semantic_query', runtimeBudget: budget, roleBinding: { schemaVersion: 1, bindingId: queryJobId, bindingVersion: 1, templateId: 'query-reader', templateRevision: '1', policyRevision: 'read-only-v1' } } } } }));
            if (result.status === 'committed' && !result.replayed) {
                const work = h.driveQuery({ reason: 'human-semantic-query' }).then(() => project());
                background.add(work);
                void work.finally(() => background.delete(work)).catch(() => { });
            }
            return { queryJobId, runId, receipt: result };
        }
        if (path === '/api/real/queries/runs')
            return { runs: realQueries?.all().filter(run => run.runRef.projectId === scope.projectId && run.runRef.workspaceId === scope.workspaceId && run.goalId === goalId) ?? [] };
        if (path === '/api/real/history/view')
            return history.view({ ...scope, goalId });
        if (path === '/api/real/history/grant')
            return history.grant({ ...scope, goalId }, input);
        if (path === '/api/real/history/revoke')
            return history.revoke({ ...scope, goalId }, input);
        if (path === '/api/real/history/read')
            return history.read({ ...scope, goalId }, input);
        if (path === '/api/real/plan-changes/view') {
            // 受理结果的可见性。直接复用既有投影（ReadModelIndex.planChangeView）：
            // 提案／人的决定／Goal revision／任务处置行四类事实一次取回，界面据此回答
            // "谁受理了什么、为什么"。这里没有任何重算，也不存在第二条读取路径。
            return planChanges.view({ projectId: scope.projectId, workspaceId: scope.workspaceId, goalId });
        }
        if(path==='/api/real/feedback/choose') {
            if(!feedbackCompiler) throw Error('真实协调未配置');
            const result=await feedbackDecisions.choose({...scope,goalId},input['answerRef'] as import('../contracts/query-job.js').QueryJobAnswerRef,required(input,'optionId'));
            const queryJobRef=await feedbackCompiler.requestDecision(result.sourceJob,result.decisionRef);
            await h.driveQuery({reason:'human-feedback-decision'});
            await triggerRework(scope,goalId);
            await project();
            return {status:result.status,decisionRef:result.decisionRef,planRef:result.planRef,queryJobRef};
        }
        if (path === '/api/real/rework/issues') {
            // 只读问题出口：让界面与返工提案拿到同一份带来源的未处置问题。
            if (!verifications)
                throw Error('真实验收未配置');
            return verifications.openIssues({
                schemaVersion: 1, projectId: scope.projectId, workspaceId: scope.workspaceId, goalId,
                taskIds: Array.isArray(input['taskIds']) ? input['taskIds'].filter((value): value is string => typeof value === 'string') : [],
            });
        }
        if (path === '/api/real/rework/status') {
            // 只读入口：未处置问题 + 提案 + 受理事实（全部由 canonical 事实重建），
            // 外加本进程最近一次自动触发的结果。不触发任何写入。
            const request: ReworkDriveRequestV1 = { schemaVersion: 1, projectId: scope.projectId, workspaceId: scope.workspaceId, goalId };
            return { view: await reworkDrive.reworkView(request), lastDrive: lastReworkDrives.get(reworkKey(scope, goalId)) ?? null };
        }
        if (path === '/api/real/verifications/verify') {
            if (!verifications) throw Error('真实验收未配置');
            const result = await h.verification.verify(input as import('../contracts/verification.js').VerificationRequestV1);
            return result;
        }
        if (path.startsWith('/api/real/verifications/reviews/')) {
            if (!verifications || !reviewerProfiles || !reviewerContext) throw Error('独立审阅未配置');
            const reviewScope = { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId, runId: required(input, 'runId'), taskId: required(input, 'taskId') };
            if (path.endsWith('/profile')) return reviewerProfiles.current(reviewScope);
            if (path.endsWith('/material')) return verifications.reviewMaterial(reviewScope, required(input, 'roundRequestId'));
            if (path.endsWith('/read')) return verifications.review(reviewScope, required(input, 'requestId'));
            if (path.endsWith('/report')) {
                const review = await verifications.review(reviewScope, required(input, 'requestId'));
                if (!review.work?.output) throw Error('原始审阅报告尚未绑定');
                const opened = await reviewerContext.openHistoricalReport(review.work.ref);
                if (opened.status !== 'ready') throw Error('原始审阅报告当前不可读取');
                return { ref: opened.record.ref, body: opened.record.body, applicability: 'historical_explanation' as const };
            }
            if (path.endsWith('/recover')) {
                if (input['allowExecute'] !== true) throw Error('需要明确授权重新受理 Reviewer');
                const allowed = new Set(['projectId', 'workspaceId', 'goalId', 'runId', 'taskId', 'requestId', 'previousRequestId', 'allowExecute', 'reason']);
                if (Object.keys(input).some(key => !allowed.has(key))) throw Error('恢复请求仅接受作用域、原请求、授权标识及原因');
            }
            const result = path.endsWith('/recover')
                ? await verifications.recoverReview(reviewScope, {
                    requestId: required(input, 'requestId'), previousRequestId: required(input, 'previousRequestId'),
                    allowExecute: true, reason: required(input, 'reason'),
                })
                : path.endsWith('/start')
                ? await verifications.startReview(reviewScope, input as import('../contracts/reviewer-verification.js').ReviewStartInput)
                : path.endsWith('/resume') ? await verifications.resumeReview(reviewScope, { requestId: required(input, 'requestId') }) : null;
            if (!result) throw Error('未知独立审阅操作');
            launchReview(result.review);
            return result;
        }
        if (path.startsWith('/api/real/verifications/rounds/')) {
            if (!verifications) throw Error('真实验收未配置');
            const roundScope = { projectId: scope.projectId, workspaceId: scope.workspaceId, goalId, runId: required(input, 'runId'), taskId: required(input, 'taskId') };
            if (path.endsWith('/read')) return verifications.round(roundScope, required(input, 'requestId'));
            const result = path.endsWith('/start')
                ? await verifications.startRound(roundScope, input as import('../contracts/verification-round.js').VerificationRoundStartInput)
                : path.endsWith('/resume')
                    ? await verifications.resumeRound(roundScope, input as import('../contracts/verification-round.js').VerificationRoundResumeInput)
                    : null;
            if (!result) throw Error('未知验证轮次操作');
            return result;
        }
        if (path === '/api/real/verifications/run-check') {
            if (!verifications)
                throw Error('真实验收未配置');
            return verifications.runChecks({ ...scope, goalId, runId: required(input, 'runId') }, input);
        }
        if (path === '/api/real/verifications/check-report') {
            if (!verifications)
                throw Error('真实验收未配置');
            return verifications.checkReports({ ...scope, goalId, runId: required(input, 'runId') }, required(input, 'requestId'));
        }
        if (path === '/api/real/verifications/check-evidence') {
            if (!verifications)
                throw Error('真实验收未配置');
            return verifications.admitCheckEvidence({ ...scope, goalId, runId: required(input, 'runId') }, input);
        }
        if (path === '/api/real/verifications/reconcile-check') {
            if (!verifications)
                throw Error('真实验收未配置');
            return verifications.reconcileCheck({ ...scope, goalId, runId: required(input, 'runId') }, required(input, 'requestId'));
        }
        if (path === '/api/real/verifications/candidates' || path === '/api/real/verifications/import') {
            if (!verifications)
                throw Error('真实验收未配置');
            const runScope = { ...scope, goalId, runId: required(input, 'runId') };
            return path.endsWith('/candidates') ? verifications.register(runScope, input) : verifications.import(runScope, input);
        }
        if (path.startsWith('/api/real/explorations/')) {
            if (!real || !explorations)
                throw Error('真实探索未配置');
            const explorationScope = { ...scope, goalId };
            if (path === '/api/real/explorations/plan')
                return explorations.install(explorationScope, input);
            if (path === '/api/real/explorations/review')
                return explorations.review(explorationScope, input);
            if (path === '/api/real/explorations/run') {
                const contextOnly = real.explorationContextOnlyRoots?.includes(real.rootFor(scope.projectId, scope.workspaceId)) ?? false;
                const selectedBudget = input['budget'] ?? (contextOnly ? { contextWindowTokens: 1000000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 } : undefined);
                const prepared = await explorations.prepareRun(explorationScope, input, validateRuntimeBudget(selectedBudget, contextOnly));
                return operatorDispatch!.dispatch({ spec: prepared.spec, requestId: prepared.requestId });
            }
            throw Error('未知探索操作');
        }
        if (path === '/api/real/tasks') {
            if (!real)
                throw Error('真实执行未配置');
            const id = required(input, 'requestId');
            if (!/^[a-zA-Z0-9-]{1,100}$/.test(id))
                throw Error('请求标识无效');
            if (input['allowWrite'] !== true)
                throw Error('请明确允许在当前项目内修改文件');
            const runId = `real-${id}`, originalInstruction = required(input, 'instruction'), taskId = 'coding-task';
            if (input['references'] !== undefined && !real.resolveReferences)
                throw Error('当前服务未配置文件引用解析');
            const instruction = originalInstruction + (real.resolveReferences ? await real.resolveReferences(scope, input['references']) : '');
            const spec = { ...scope, goalId, runId, taskId, root: real.rootFor(scope.projectId, scope.workspaceId), instruction, budget: validateRuntimeBudget(input['budget'], real.contextOnlyTask?.requestId === id && real.contextOnlyTask.root === real.rootFor(scope.projectId, scope.workspaceId)) };
            return operatorDispatch!.dispatch({ spec, requestId: id });
        }
        if (path === '/api/real/cancel') {
            if (!real)
                throw Error('真实执行未配置');
            const runId = required(input, 'runId');
            return operatorDispatch!.cancel({ ...scope, goalId }, runId);
        }
        if (path === '/api/plans/sample') {
            if (view.goal.activePlanRevision)
                return { status: 'already_installed' };
            const plan = structuredClone(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1);
            plan.goalId = goalId;
            plan.planId = `gui-plan-${goalId}`;
            return check(await h.applyPlan(buildApplyPlanCommand(plan, { ...deps(scope.projectId, `gui-plan-${goalId}`), goalId, expectedRevision: view.goal.aggregateRevision })));
        }
        if (path === '/api/tasks/run') {
            if (!executionCapability.fixtureEnabled)
                throw Error('真实任务请使用真实执行入口');
            const taskId = required(input, 'taskId');
            const claim = check(await h.claimTask(buildDispatchClaimCommand({ ...deps(scope.projectId, `gui-claim-${goalId}-${taskId}`), goalId, taskId, attemptId: `gui-attempt-${taskId}`, runId: `gui-run-${taskId}`, roleBinding: { schemaVersion: 1, bindingId: `gui-fixture-${taskId}`, templateId: 'gui-fixture', templateRevision: '1', bindingVersion: 1, policyRevision: 'fixture-only-v1' }, declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { tokenBudget: 10000, deadline: '2099-01-01T00:00:00.000Z' } })));
            return { claim, drive: await h.drive({ reason: 'local-gui' }) };
        }
        if (path === '/api/queries') {
            if (!executionCapability.fixtureEnabled)
                throw Error('此真实任务请查看运行记录；带来源的交互查询将在后续探索阶段接入，不返回测试回答');
            const id = required(input, 'requestId');
            const graph = await h.planGraph({ projectId: scope.projectId, goalId });
            if (graph.status !== 'ready')
                throw new Error('请先安装计划，为查询提供任务来源');
            const focusTaskId = input['focusTaskId'];
            if (focusTaskId !== undefined && (typeof focusTaskId !== 'string' || !graph.graph.tasks.some(task => task.taskId === focusTaskId)))
                throw new Error('查询的任务不属于当前目标');
            const focusTaskRefs = graph.graph.tasks.filter(task => focusTaskId === undefined || task.taskId === focusTaskId).map(task => ({ aggregateType: 'Task' as const, projectId: scope.projectId, goalId, taskId: task.taskId }));
            const result = check(await h.submitQueryJob({ schemaVersion: 1, commandType: 'SubmitQueryJob', ...deps(scope.projectId, id), identity: { projectId: scope.projectId, actor: { kind: 'human' as const, id: 'local-gui' }, idempotencyKey: id }, aggregateId: id, expectedRevision: 0, payload: { runId: 'run-' + id, intent: { schemaVersion: 1, intentId: id, ...scope, goalId, question: required(input, 'question'), focusTaskRefs, budget: { maxTokens: 1000, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: id } } }));
            return { result, drive: await h.driveQuery({ reason: 'local-gui' }) };
        }
        throw new Error('未知操作');
    }
    if (real && verifications) {
        const restored = new Set<string>();
        for (const record of real.runtime.observations.all()) {
            if (!scopes.some(scope => scope.projectId === record.spec.projectId && scope.workspaceId === record.spec.workspaceId))
                continue;
            for (const review of verifications.forRun(record.spec).reviews) {
                const key = canonicalJson([review.scope, review.requestId]);
                if (restored.has(key) || ['settled', 'assessment_rejected', 'work_rejected'].includes(review.phase))
                    continue;
                restored.add(key);
                const work = verifications.resumeReview(review.scope, { requestId: review.requestId })
                    .then(result => launchReview(result.review))
                    // 恢复路径同样是"审阅结论已归约"的收口，触发条件与在线路径一致。
                    .then(async () => { await triggerRework(review.scope, review.scope.goalId); })
                    .finally(project);
                background.add(work);
                void work.finally(() => background.delete(work)).catch(() => { });
            }
        }
    }
    // Reconstruct post-Run work from durable observations. Existing Query/round
    // identities replay; uncertain runtime/tool outcomes are never restarted.
    if(real) {
      const recovery=(async()=>{
        for(const choice of await feedbackDecisionMaterials.recordedChoices()) {
          try {
            const applied=await feedbackDecisions.choose(choice.scope,choice.answerRef,choice.optionId);
            await feedbackCompiler?.requestDecision(applied.sourceJob,applied.decisionRef);
          }
          catch(error) {console.error('人的决定投递待处理：'+choice.decisionRef.decisionId+': '+String(error));}
        }
        const recoveredGoals=new Map<string,{scope:Scope;goalId:string}>();
        for(const record of real.runtime.observations.all()) {
          if(record.spec.mode || ['prepared','running','outcome_unknown'].includes(record.status)) continue;
          recoveredGoals.set(canonicalJson([record.spec.projectId,record.spec.workspaceId,record.spec.goalId]),{scope:record.spec,goalId:record.spec.goalId});
          try {await continueEndedRun(record.spec,record.spec.goalId,record.spec.runId);}
          catch(error) {console.error('运行后续对账待处理：'+record.spec.runId+': '+String(error));}
        }
        for(const item of recoveredGoals.values()) await triggerRework(item.scope,item.goalId);
        await project();
        advancePlanning();
      })();
      background.add(recovery);void recovery.finally(()=>background.delete(recovery)).catch(()=>{});
    } else advancePlanning();
    return { scopes, registerScope: (scope: Scope & { bindingDigest?: string }) => serial(async () => {
            if (!scopes.some(item => item.projectId === scope.projectId))
                throw Error('项目尚未登记');
            const loaded = await h.ledger.load({ aggregateType: 'Project', projectId: scope.projectId });
            if (loaded.status !== 'found')
                throw Error('项目不存在');
            const id = 'workspace-register-' + scope.workspaceId;
            check(await h.control.registerWorkspace({ schemaVersion: 1, commandType: 'RegisterWorkspace', commandId: id, identity: { projectId: scope.projectId, actor: { kind: 'human' as const, id: 'local-gui' }, idempotencyKey: id }, workspaceId: scope.workspaceId, bindingDigest: scope.bindingDigest!, expectedProjectRevision: loaded.snapshot.revision, correlationId: id, submittedAt: now() }));
            if (!scopes.some(item => item.projectId === scope.projectId && item.workspaceId === scope.workspaceId))
                scopes.push({ projectId: scope.projectId, workspaceId: scope.workspaceId });
            await project();
        }), state: (input: Record<string, unknown>) => serial(() => state(input)),
        action: (path: string, input: Record<string, unknown>) => {
            if (closing)
                return Promise.reject(Error('服务正在关闭'));
            if (['/api/real/verifications/rounds/start', '/api/real/verifications/rounds/resume', '/api/real/verifications/verify', '/api/real/feedback/choose'].includes(path)) {
                // Verification owns request/round concurrency and Control owns leases.
                // Keep reads available while tools run; shutdown still waits for them.
                const work = action(path, input).then(async (result) => {
                    await serial(project);
                    // 验证结论被接纳并归约之后，由组合根（不是 VerificationEngine）触发自动返工。
                    try {
                        await triggerRework(scopeOf(input), required(input, 'goalId'));
                    }
                    catch (error) {
                        console.error('自动返工触发前置检查失败：' + String(error));
                    }
                    return result;
                });
                background.add(work);
                void work.finally(() => background.delete(work)).catch(() => { });
                return work;
            }
            return serial(async () => { const result = await action(path, input); await project(); return result; });
        },
        close: async () => {
            closing = true;
            // Accepted queued actions can still register work. Drain them first,
            // then await derived work without holding the projection queue.
            await serial(async () => { });
            await realQueries?.close();
            while (background.size)
                await Promise.allSettled([...background]);
            await serial(() => h.close());
        } };
}
// Preserve the original two-project ledger. Each added project gets its own store:
// WorkspaceBootstrap is intentionally an only-if-empty command, not a registry API.
export async function createGuiService(dir: string, initialScopes: Scope[] = [], real?: RealOptions) {
    const scopes: Scope[] = ['acceptance-alpha', 'acceptance-beta'].map(projectId => ({ projectId, workspaceId: 'workspace-main' }));
    const primary = await createScopedGuiService(dir, [...scopes], true, real);
    const services = new Map<string, Awaited<ReturnType<typeof createScopedGuiService>>>(scopes.map(scope => [scope.projectId, primary]));
    let queue: Promise<unknown> = Promise.resolve();
    async function addProject(scope: Scope & { bindingDigest?: string }) {
        if (scopes.some(item => item.projectId === scope.projectId && item.workspaceId === scope.workspaceId))
            return;
        const existing = services.get(scope.projectId);
        if (existing) {
            if (!scope.bindingDigest)
                throw Error('新增工作区需要实际目录绑定');
            await existing.registerScope({ ...scope, bindingDigest: scope.bindingDigest });
            scopes.push({ projectId: scope.projectId, workspaceId: scope.workspaceId });
            return;
        }
        const service = await createScopedGuiService(resolve(dir, 'projects', encodeURIComponent(scope.projectId)), [scope], false, real);
        services.set(scope.projectId, service);
        scopes.push({ ...scope });
    }
    function serviceFor(input: Record<string, unknown>) {
        if (!scopes.some(s => s.projectId === input['projectId'] && s.workspaceId === input['workspaceId']))
            throw Error('未知项目或工作区');
        return services.get(String(input['projectId']))!;
    }
    try {
        for (const scope of initialScopes)
            await addProject(scope);
    }
    catch (error) {
        for (const service of new Set(services.values()))
            await service.close();
        throw error;
    }
    return { scopes, addProject: (scope: Scope & { bindingDigest?: string }) => { const result = queue.then(() => addProject(scope)); queue = result.catch(() => { }); return result; },
        /** The host's explicit execution capability, derived once at the
         * composition root. `server.ts` serves this instead of a literal. */
        capability: () => real
            ? { executor: 'coding-agent', source: 'configured-runtime', fixtureEnabled: real.fixtureExecution === true }
            : { executor: 'fixture', source: 'explicit-fixture-service', fixtureEnabled: true },
        state: (input: Record<string, unknown>) => serviceFor(input).state(input),
        action: (path: string, input: Record<string, unknown>) => serviceFor(input).action(path, input),
        close: async () => {
            await queue;
            for (const service of new Set(services.values()))
                await service.close();
        } };
}
