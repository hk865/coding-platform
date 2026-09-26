/**
 * R3e.1 evidence behaviour-test fixture.
 *
 * It composes the REAL B2 execution fixture (which itself uses
 * `createTaskClaimFixture(kind, additionalSchemas)` and the formal
 * claim/prepare/start/terminal path). On the SAME real RecordStore/body backend
 * it then builds its OWN R3e subject through public operations only:
 *
 *   1. register the R3e bootstrap/evidence event schemas (Project/Workspace and
 *      policy RECORDS keep their existing owners);
 *   2. create the real `createProjectBootstrapServices` and install + activate
 *      an independent `static` CompletionPolicy (the shared fixture policy and
 *      the original B2 Plan pin are never rewritten);
 *   3. create a new Goal and adopt a v2 Plan whose required requirement is
 *      `static` with a legal work assignment;
 *   4. map a new Session and claim the work task through the real claim service;
 *   5. prepare/enter/terminal that claim through the formal B2 path so the
 *      subject Run is genuinely ended (no seeded terminal state).
 *
 * The real material body/read-facts chain, a real temporary verification
 * workspace, a real `VerificationWorkspaceReader` and the real stage-1
 * `EvidencePort` are built over the same scope/records/body. The returned
 * `EvidencePort` is the production skeleton, so target assertions are expected
 * RED on its first `unsupported`.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { RuntimeEventV1, RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type {
    EffectivityAnchorV1, EvidenceCoverageV1, EvidenceKind, EvidenceOutcome, EvidenceV1,
} from '../../src/contracts/evidence.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type {
    CheckProcessObservation, RegisteredCommandCheck, RoundSnapshot, TrustedCheckConfiguration,
} from '../../src/contracts/verification.js';
import type { VerificationRoundSourcePort, VerificationRoundSourceResult } from '../../src/contracts/verification-context.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import type { EvidencePort } from '../../src/core/work-graph/evidence/contracts.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/evidence/evidence-record-codecs.js';
import { createRegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type { MaterialPort, MaterialReadFactsPort } from '../../src/core/work-graph/materials/contracts.js';
import { createMaterialReadFactsService } from '../../src/core/work-graph/materials/material-facts-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createMaterialSourceProvider } from '../../src/core/workspace/material-source-provider.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/tasks/claim-contracts.js';
import type { TaskResultObservation } from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import { createB2ExecutionFixture, B2_AT, type B2ExecutionFixture } from './B2-execution-fixture.js';
import type { ClaimFixtureKind, Records } from './task-claim-fixture.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';

export const R3E_HOST = { kind: 'human' as const, id: 'r3e-check-host' };
export const R3E_CONFIGURATION_REVISION = 'r3e-checks-config-1';
export const R3E_PERMISSION_REVISION = 'r3e-permission-1';
export const R3E_POLICY_ID = 'r3e-static-policy';
export const R3E_WORK_TASK_ID = 'r3e-work';
export const R3E_GATE_TASK_ID = 'r3e-gate';

/** Mutable trusted Host state the tests may revoke/change between operations.
 * It is not a production seam: it only models what the real Host bindings
 * would return next. */
export type R3eHostState = {
    /** The current Host permission revision `authorize` reports. */
    permissionRevision: string;
    /** Whether the Host still authorizes verification source reads. */
    allowSource: boolean;
    /** The current real workspace root `resolveRoot` reports. */
    root: string;
};

export type R3eOpenInput = {
    subjectRunRef: RunRef;
    subject: TaskTriple;
    planRef: PlanRevisionRef;
    gateSubject?: 'goal';
};

export type R3eEvidenceFixture = {
    kind: ClaimFixtureKind;
    b2: B2ExecutionFixture;
    ctx: CoreCallContext;
    scope: WorkspaceScope;
    projectRef: { aggregateType: 'Project'; projectId: string };
    workspaceRef: WorkspaceRef;
    goalRef: GoalRef;
    planRef: PlanRevisionRef;
    plan: PlanRevisionSnapshot;
    subjectRunRef: RunRef;
    subject: TaskTriple;
    workspaceRoot: string;
    hostState: R3eHostState;
    configuration: TrustedCheckConfiguration;
    passCheck: RegisteredCommandCheck;
    interruptCheck: RegisteredCommandCheck;
    materials: MaterialPort;
    materialFacts: MaterialReadFactsPort;
    workspaceHost: WorkspaceHostBindings;
    records: Records;
    evidence: EvidencePort;
    runner: RegisteredCheckRunner;
    openRequest(overrides?: Partial<R3eOpenInput>): GraphWrite<R3eOpenInput>;
    beginRequest(round: RoundSnapshot, checkId: string): GraphWrite<{ roundRef: RoundSnapshot['ref']; checkId: string }>;
    recordRequest(round: RoundSnapshot, checkId: string, invocationId: string,
        observation: CheckProcessObservation): GraphWrite<{
            roundRef: RoundSnapshot['ref']; checkId: string; invocationId: string; observation: CheckProcessObservation;
        }>;
    finalizeRequest(round: RoundSnapshot): GraphWrite<{ roundRef: RoundSnapshot['ref'] }>;
    anchorFor(plan?: PlanRevisionSnapshot, workspaceRevision?: number): EffectivityAnchorV1;
    makeEvidence(input: {
        evidenceId: string;
        outcome: EvidenceOutcome;
        coverage: EvidenceCoverageV1[];
        kind?: EvidenceKind;
        subject?: TaskTriple;
        plan?: PlanRevisionSnapshot;
    }): EvidenceV1;
    /** A real public-goal write used as an unrelated ledger append. */
    createUnrelatedGoal(requestId: string, goalId: string): Promise<void>;
    /** A real W1 future-only adoption that adds an unrelated future node. */
    adoptUnrelatedFutureEdit(planId: string, requestIdPrefix: string): Promise<PlanRevisionSnapshot>;
    captureSource(): Promise<VerificationRoundSourceResult>;
    sourceCaptures(): number;
    close(): Promise<void>;
};

let sequence = 0;

export async function createR3eEvidenceFixture(
    kind: ClaimFixtureKind = 'memory',
    additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
): Promise<R3eEvidenceFixture> {
    const schemas: RecordBackendSchemas = {
        records: [...EVIDENCE_RECORD_SCHEMAS.records, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.records, ...additionalSchemas.records],
        events: [...EVIDENCE_RECORD_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...additionalSchemas.events],
        lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(PROJECT_BOOTSTRAP_RECORD_SCHEMAS.lookups ?? []),
            ...(additionalSchemas.lookups ?? [])],
    };
    const b2 = await createB2ExecutionFixture(kind, schemas);
    let closeB2 = true;
    try {
        const projectId = b2.base.scope.projectId;
        const workspaceId = b2.base.scope.workspaceId;
        const scope: WorkspaceScope = { projectId, workspaceId };
        const projectRef = { aggregateType: 'Project' as const, projectId };
        const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId, workspaceId };
        const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'r3e-goal' };

        const actor = R3E_HOST;
        const ctx: CoreCallContext = {
            projectId, workspaceId, principal: { kind: 'host', actor },
            materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
        };
        const now = () => B2_AT;
        let eventSeq = 0;
        const eventId = () => `r3e-event-${++eventSeq}`;
        const newId = () => `r3e-id-${++sequence}`;
        const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };

        // ---- 2. independent static policy through the real bootstrap writer ---
        const bootstrap = createProjectBootstrapServices({ records: b2.base.records, now, eventId });
        const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
            meta: { requestId: 'r3e-install-policy', expected: [
                { ref: projectRef, revision: 1 },
                { ref: { aggregateType: 'CompletionPolicyRevision', projectId, policyId: R3E_POLICY_ID, revision: 1 }, revision: 0 },
            ] },
            input: { policyId: R3E_POLICY_ID, contentRevision: 1,
                content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } },
        });
        if (installed.status !== 'committed') throw new Error(`R3e policy install failed: ${JSON.stringify(installed)}`);
        const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
            meta: { requestId: 'r3e-activate-policy', expected: [{ ref: projectRef, revision: 1 }, { ref: activeRef, revision: 1 }] },
            input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
        });
        if (activated.status !== 'committed') throw new Error(`R3e policy activation failed: ${JSON.stringify(activated)}`);

        // ---- 3. new Goal + adopted v2 Plan -----------------------------------
        const createdGoal = await b2.base.goals.createGoal(ctx, {
            meta: { requestId: 'r3e-create-goal', expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
            input: { goalId: goalRef.goalId, workspace: scope, objective: 'R3e verification subject' },
        });
        if (createdGoal.status !== 'committed') throw new Error(`R3e Goal creation failed: ${JSON.stringify(createdGoal)}`);

        const planId = 'r3e-plan';
        const draft: PlanRevisionDraft = {
            schemaVersion: 2, planId, planRevision: 1, goalId: goalRef.goalId, stages: [],
            tasks: [
                { taskId: R3E_WORK_TASK_ID, title: 'Run the registered static check', requirementLevel: 'required',
                    taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
                { taskId: R3E_GATE_TASK_ID, title: 'R3e goal gate', requirementLevel: 'required',
                    taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
            ],
            assignments: [{ taskId: R3E_WORK_TASK_ID, role: 'builder', instruction: 'Run the registered static check' }],
            obligations: [{ obligationId: 'r3e-obligation', title: 'R3e static evidence', requirementLevel: 'required',
                taskIds: [R3E_WORK_TASK_ID, R3E_GATE_TASK_ID],
                verificationRequirements: [{ requirementId: 'r3e-static-requirement', requirementLevel: 'required',
                    kind: 'static', description: 'Registered static command check' }] }],
            taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
        };
        const proposed = await b2.base.plans.proposePlan(ctx, {
            meta: { requestId: 'r3e-propose-plan', expected: [{ ref: goalRef, revision: 1 }] },
            input: { goalRef, basedOn: null, draft, reason: { text: 'R3e static-check subject plan', sources: [] } },
        });
        if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
            throw new Error(`R3e Plan proposal failed: ${JSON.stringify(proposed)}`);
        }
        const applied = await b2.base.plans.applyPlanChange(ctx, {
            meta: { requestId: 'r3e-apply-plan', expected: [{ ref: goalRef, revision: 1 }] },
            input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
        });
        if (applied.status !== 'committed') throw new Error(`R3e Plan adoption failed: ${JSON.stringify(applied)}`);
        const plan = applied.value;
        if (plan.effectiveCompletionPolicy.ref.policyId !== R3E_POLICY_ID) {
            throw new Error(`R3e adopted Plan did not pin the static policy: ${JSON.stringify(plan.effectiveCompletionPolicy)}`);
        }
        const planRef = plan.ref;

        // ---- 4. new Session + claim through the real claim service -----------
        const session = await b2.base.createSession('r3e-session');
        const ready = await b2.base.plans.queryReadyTasks(ctx, { goalRef, includeBlocked: false, page: { limit: 50 } });
        if (ready.status !== 'ready') throw new Error(`R3e ready-task read failed: ${JSON.stringify(ready)}`);
        const readyTask = ready.value.items.find(item => item.task.ref.taskId === R3E_WORK_TASK_ID);
        if (readyTask === undefined) throw new Error('R3e work task is not in the ready set');
        const goalRead = await b2.base.plans.queryGoal(ctx, goalRef);
        if (goalRead.status !== 'ready') throw new Error(`R3e Goal read failed: ${JSON.stringify(goalRead)}`);
        const sessionCard = await b2.base.sessionsPort.readSession(ctx, session);
        if (sessionCard.status !== 'ready') throw new Error(`R3e Session read failed: ${JSON.stringify(sessionCard)}`);
        const claimRequest: GraphWrite<ClaimTaskInput> = {
            input: { goalRef, planRef: readyTask.planRef, taskId: R3E_WORK_TASK_ID, sessionRef: session,
                roleBinding: b2.base.roleBinding, budget: b2.base.budget },
            meta: { requestId: 'r3e-claim', expected: [
                { ref: goalRef, revision: goalRead.value.goal.revision },
                { ref: workspaceRef, revision: 1 },
                { ref: plainSessionRefToAggregate(session), revision: sessionCard.value.record.revision },
            ] },
        };
        const claimed = await b2.base.service.claimTask(ctx, claimRequest);
        if (claimed.status !== 'committed') throw new Error(`R3e claim failed: ${JSON.stringify(claimed)}`);
        const claim = claimed.value;

        // ---- 5. real prepare/enter/terminal subject Run -----------------------
        const prepared = await b2.buildPrepared({ claim });
        const admitted = await b2.enter({ prepared });
        const kernelBinding = await b2.kernelFor(claim);
        const completedEvent: RuntimeEventV1 = { eventType: 'run_completed', schemaVersion: 1,
            eventId: 'r3e-subject-completed', runRef: claim.runRef, sequence: 2, occurredAt: B2_AT,
            payload: { kind: 'completed', exitCode: 0 } };
        const terminalObservation: TaskResultObservation = {
            claim,
            entry: { consumerId: admitted.permit.consumerId, entryGeneration: admitted.permit.entryGeneration },
            event: completedEvent,
            kernelSource: { ...kernelBinding, position: 4 },
            completedHistoryBoundary: { source: { ...kernelBinding, position: 4 }, cursor: 'r3e-trusted-completed-boundary-4' },
            history: { kernel: kernelBinding, startPosition: 2, observedThroughPosition: 4, endPosition: 4 },
        };
        const terminal = await b2.entry.recordRunResult(b2.ctx, {
            input: terminalObservation,
            meta: { requestId: 'r3e-subject-terminal', expected: [await b2.pin(claim)] },
        });
        if (terminal.status !== 'committed' || terminal.value.status !== 'ended') {
            throw new Error(`R3e subject Run did not end: ${JSON.stringify(terminal)}`);
        }
        const subjectRunRef = claim.runRef;
        const subject = claim.task;

        // ---- real workspace + material chain over the same scope/records ------
        const workspaceRoot = await mkdtemp(join(tmpdir(), `next-r3e-${kind}-`));
        await mkdir(join(workspaceRoot, 'src'));
        await writeFile(join(workspaceRoot, 'src', 'input.txt'), 'r3e verification source v1\n');

        const hostState: R3eHostState = { permissionRevision: R3E_PERMISSION_REVISION, allowSource: true, root: workspaceRoot };
        const passCheck: RegisteredCommandCheck = {
            checkId: 'r3e-pass', kind: 'static', command: 'echo R3E_CHECK_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all',
        };
        const interruptCheck: RegisteredCommandCheck = {
            checkId: 'r3e-interrupt', kind: 'static', command: 'echo R3E_INTERRUPT_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all',
        };
        const configuration: TrustedCheckConfiguration = {
            configurationRevision: R3E_CONFIGURATION_REVISION,
            workspace: workspaceRef,
            executor: R3E_HOST,
            permissionRevision: R3E_PERMISSION_REVISION,
            sourceAccess: 'verification_workspace',
            processAccess: 'all_except_denied',
            deniedPrefixes: ['.git'],
            checks: [passCheck, interruptCheck],
        };

        const workspaceHost: WorkspaceHostBindings = {
            async resolveRoot(workspace) {
                if (workspace.projectId !== projectId || workspace.workspaceId !== workspaceId) {
                    return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'R3e fixture workspace is not registered' };
                }
                return { status: 'ready' as const, value: { root: hostState.root, workspaceRevision: 1 } };
            },
            async authorize(authCtx, workspace) {
                if (!hostState.allowSource || authCtx.principal.kind !== 'host'
                    || authCtx.projectId !== projectId || authCtx.workspaceId !== workspaceId
                    || workspace.projectId !== projectId || workspace.workspaceId !== workspaceId) {
                    return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'R3e fixture Host does not authorize verification source' };
                }
                return { status: 'ready' as const, value: {
                    subjectKey: 'host:r3e', permissionRevision: hostState.permissionRevision, allowsRead: () => true,
                } };
            },
        };

        const access = createWorkspaceAccessFactory(workspaceHost);
        const sourceProvider = createMaterialSourceProvider({
            access, contextForScope: (sourceScope, signal) => ({
                projectId: sourceScope.projectId, workspaceId: sourceScope.workspaceId,
                principal: { kind: 'host', actor },
                materialReader: { kind: 'host', projectId: sourceScope.projectId, workspaceId: sourceScope.workspaceId, actor },
                signal,
            }),
        });
        const { authority, index } = createMaterialRecordReaders(b2.base.records);
        const materials = createMaterialService({
            bodies: b2.bodies, authority, grants: createMaterialAccessResolver(authority, index, sourceProvider), now,
        });
        const materialFacts = createMaterialReadFactsService({
            authority, index, bodies: b2.bodies, sourceApplicability: sourceProvider, now,
        });
        const executions = createRunStateReader({ records: b2.base.records });
        const verificationSource = new VerificationWorkspaceReader();
        let sourceCaptures = 0;
        const countedSource: VerificationRoundSourcePort = {
            capture(root) { sourceCaptures += 1; return verificationSource.capture(root); },
        };
        const evidence = createEvidenceService({
            records: b2.base.records, materials, materialFacts, executions,
            workspaceHost, source: countedSource, configuration, now, newId,
        });
        const runner = createRegisteredCheckRunner({ evidence, workspaceHost, kernel, now });

        const fixture: R3eEvidenceFixture = {
            kind, b2, ctx, scope, projectRef, workspaceRef, goalRef, planRef, plan,
            subjectRunRef, subject, workspaceRoot, hostState, configuration,
            passCheck, interruptCheck, materials, materialFacts, workspaceHost,
            records: b2.base.records, evidence, runner,
            openRequest(overrides = {}) {
                return { input: {
                    subjectRunRef: overrides.subjectRunRef ?? subjectRunRef,
                    subject: overrides.subject ?? subject,
                    planRef: overrides.planRef ?? planRef,
                    ...(overrides.gateSubject === undefined ? {} : { gateSubject: overrides.gateSubject }),
                }, meta: { requestId: `r3e-open-${++sequence}`, expected: [] } };
            },
            beginRequest(round, checkId) {
                return { input: { roundRef: round.ref, checkId },
                    meta: { requestId: `r3e-begin-${++sequence}`, expected: [{ ref: round.ref, revision: round.revision }] } };
            },
            recordRequest(round, checkId, invocationId, observation) {
                return { input: { roundRef: round.ref, checkId, invocationId, observation },
                    meta: { requestId: `r3e-record-${++sequence}`, expected: [{ ref: round.ref, revision: round.revision }] } };
            },
            finalizeRequest(round) {
                return { input: { roundRef: round.ref },
                    meta: { requestId: `r3e-finalize-${++sequence}`, expected: [{ ref: round.ref, revision: round.revision }] } };
            },
            anchorFor(targetPlan = plan, workspaceRevision = 1) {
                return { schemaVersion: 1, planRef: targetPlan.ref, planRevision: targetPlan.planRevision,
                    workspaceRevision, pinnedCompletionPolicy: targetPlan.effectiveCompletionPolicy,
                    pinnedArchitectureBaseline: targetPlan.effectiveArchitectureBaseline };
            },
            makeEvidence(input) {
                const targetPlan = input.plan ?? plan;
                return {
                    schemaVersion: 1, evidenceId: input.evidenceId, kind: input.kind ?? 'observation', outcome: input.outcome,
                    source: { actor: R3E_HOST, runRef: null, checkId: passCheck.checkId },
                    subject: input.subject ?? subject, coverage: input.coverage.map(entry => ({ ...entry })),
                    anchor: fixture.anchorFor(targetPlan),
                    verificationPlanRef: { planId: 'r3e-plan', planDigest: 'r3e-plan-digest' },
                    summary: { text: `r3e ${input.outcome} ${input.evidenceId}`, artifactRef: null },
                };
            },
            async createUnrelatedGoal(requestId, goalId) {
                const created = await b2.base.goals.createGoal(ctx, {
                    meta: { requestId, expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
                    input: { goalId, workspace: scope, objective: 'R3e unrelated ledger append' },
                });
                if (created.status !== 'committed') throw new Error(`R3e unrelated Goal write failed: ${JSON.stringify(created)}`);
            },
            async adoptUnrelatedFutureEdit(futurePlanId, requestIdPrefix) {
                const goalNow = await b2.base.plans.queryGoal(ctx, goalRef);
                if (goalNow.status !== 'ready') throw new Error(`R3e future-edit Goal read failed: ${JSON.stringify(goalNow)}`);
                const futureDraft: PlanRevisionDraft = {
                    schemaVersion: 2, planId: futurePlanId, planRevision: plan.planRevision + 1, goalId: goalRef.goalId,
                    stages: structuredClone(plan.stages), tasks: [...structuredClone(plan.tasks), {
                        taskId: 'r3e-future-intent', title: 'Unrelated future intent', requirementLevel: 'optional',
                        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
                        executionIntent: 'plan_only',
                    }],
                    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
                    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
                    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
                    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [],
                };
                const futureProposed = await b2.base.plans.proposePlan(ctx, {
                    meta: { requestId: `${requestIdPrefix}-propose`, expected: [{ ref: goalRef, revision: goalNow.value.goal.revision }] },
                    input: { goalRef, basedOn: plan.ref, draft: futureDraft, reason: { text: 'R3e unrelated future-only edit', sources: [] } },
                });
                if (futureProposed.status !== 'committed' || futureProposed.value.issues.length > 0) {
                    throw new Error(`R3e future Plan proposal failed: ${JSON.stringify(futureProposed)}`);
                }
                const futureApplied = await b2.base.plans.applyPlanChange(ctx, {
                    meta: { requestId: `${requestIdPrefix}-apply`, expected: [{ ref: goalRef, revision: goalNow.value.goal.revision }] },
                    input: { proposalRef: futureProposed.value.ref, expectedProposalRevision: futureProposed.value.revision, decisionRefs: [] },
                });
                if (futureApplied.status !== 'committed') throw new Error(`R3e future Plan adoption failed: ${JSON.stringify(futureApplied)}`);
                return futureApplied.value;
            },
            captureSource() { return countedSource.capture(hostState.root); },
            sourceCaptures() { return sourceCaptures; },
            async close() {
                if (closeB2) await b2.close();
                await rm(workspaceRoot, { recursive: true, force: true });
            },
        };
        return fixture;
    } catch (error) {
        if (closeB2) await b2.close().catch(() => undefined);
        closeB2 = false;
        throw error;
    }
}
