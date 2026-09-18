import { architectureReviewView } from '../../src/data/read-model-index/architecture-review-view.js';
import { afterEach, expect, it } from 'vitest';
import { createCoordinationDrive } from '../../src/control/dispatch-engine/coordination-drive.js';
import { createHash } from 'node:crypto';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { QueryExecutionContextCompiler, QuerySourceContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { QuerySourceObservationPort } from '../../src/contracts/query-execution-context.js';
import type { SubmitQueryJobCommand } from '../../src/contracts/query-job.js';
import { architectureReviewRef, architectureReviewBody, type ArchitectureReviewCommand, type ArchitectureReviewSnapshot, type ArchitectureReviewCommit } from '../../src/contracts/architecture-review.js';
import { runRefFor } from '../../src/contracts/dispatch.js';
import { buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { buildP112Brief, buildP112Proposal, buildP112ReportFinding, buildRecordArchitectureFindingCommand, buildRecordArchitectureDecisionBriefCommand, buildRecordCandidateBaselineProposalCommand } from '../../src/fixtures/architecture-fixtures.js';
import { candidateProposalDigest, architectureFindingRefFor, architectureDecisionBriefRefFor, architectureCandidateProposalRefFor } from '../../src/contracts/architecture-inspection.js';
import { candidateContentDigest } from '../../src/contracts/baseline-evolution.js';
import { buildP114MaterializeCommand } from '../contract-support/fixtures/baseline-evolution-fixtures.js';
import { setupP107Scenario } from '../coordination/runtime-concurrency-fixture.js';
import { P107_PROJECT as P, P107_WORKSPACE as W, P107_GOAL as G, P107_SCHEMA as AT, P107_TASK_READER_A, P107_TASK_READER_B, P107_ROLE_BINDING_READER_V1 as ROLE } from '../contract-support/fixtures/workspace-fixtures.js';
async function architectureWorld(h: Awaited<ReturnType<typeof createPersistentPlatform>>) {
    const { ledger, control } = h;
    const setup = await setupP107Scenario({ ledger, control, bootstrap: c => control.bootstrap(c), install: c => control.install(c), activate: c => control.activate(c), applyPlan: c => control.applyPlan(c) });
    const bind = async (id: string, runId: string) => control.bindWorkContext({ commandType: 'BindWorkContext', commandId: 'bind-' + id, schemaVersion: 1, aggregateId: id, expectedRevision: 0, correlationId: 'review', submittedAt: AT, identity: { projectId: P, actor: { kind: 'system', id: 'host' }, idempotencyKey: 'bind-' + id }, payload: { workspaceId: W, workKind: 'coordination', goalId: G, taskId: null, planRef: setup.planRef, planRevision: setup.planSnapshot.revision, roleBindingRef: ROLE, initialRunRef: runRefFor(P, G, runId) } });
    for (const [id, taskId] of [['a', P107_TASK_READER_A], ['b', P107_TASK_READER_B]] as const) {
        expect(await control.claimTask(buildDispatchClaimCommand({ projectId: P, goalId: G, taskId, runId: 'review-' + id, attemptId: 'review-attempt-' + id, commandId: 'claim-' + id, correlationId: 'review', idempotencyKey: 'claim-' + id, submittedAt: AT, roleBinding: ROLE, declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { tokenBudget: 100000, deadline: null } }))).toMatchObject({ status: 'committed' });
        expect(await bind(id, 'review-' + id)).toMatchObject({ status: 'committed' });
    }
    const finding = { ...buildP112ReportFinding(), projectId: P, workspaceId: W, planRef: setup.planRef, baselinePin: setup.pinnedArchitectureBaseline, workspaceRevision: setup.workspaceRevision };
    expect(await control.recordArchitectureFinding(buildRecordArchitectureFindingCommand(finding, { commandId: "finding" }))).toMatchObject({ status: "committed" });
    const brief = { ...buildP112Brief(), projectId: P, workspaceId: W, planRef: setup.planRef, baselinePin: setup.pinnedArchitectureBaseline, findingRefs: [architectureFindingRefFor(P, W, finding.findingId)] };
    expect(await control.recordArchitectureDecisionBrief(buildRecordArchitectureDecisionBriefCommand(brief, { commandId: 'brief' }))).toMatchObject({ status: 'committed' });
    const propose = async (id: string) => {
        const proposal = { ...buildP112Proposal(), proposalId: id, projectId: P, workspaceId: W, planRef: setup.planRef, sourceBaselinePin: setup.pinnedArchitectureBaseline, selectedDeltaRef: null, selectedBriefRef: architectureDecisionBriefRefFor(P, W, brief.briefId), selectedOptionId: brief.options[0]!.optionId };
        proposal.expectedCandidateDigest = candidateContentDigest(proposal.normalizedContent);
        proposal.proposalDigest = candidateProposalDigest(proposal);
        expect(await control.recordCandidateBaselineProposal(buildRecordCandidateBaselineProposalCommand(proposal, { commandId: 'proposal-' + id }))).toMatchObject({ status: 'committed' });
        const proposalRef = architectureCandidateProposalRefFor(P, W, id);
        const materialize = buildP114MaterializeCommand(proposalRef, { commandId: 'materialize-' + id });
        materialize.aggregateId = 'candidate-' + id;
        const receipt = await control.materializeCandidateBaseline(materialize);
        expect(receipt).toMatchObject({ status: 'committed' });
        if (receipt.status !== 'committed')
            throw Error('candidate rejected');
        return { proposal, proposalRef, candidateRef: receipt.candidateRef };
    };
    const source = await propose('original');
    const directory = await ledger.workDirectory!(P, W);
    if (directory.status !== 'ready')
        throw Error('directory unavailable');
    const open: ArchitectureReviewCommand = { schemaVersion: 1, commandId: 'open', correlationId: 'review', submittedAt: AT, ref: architectureReviewRef(P, W, 'interface-conflict'), expectedRevision: 0, identity: { projectId: P, actor: { kind: 'human', id: 'user' }, idempotencyKey: 'open' }, action: { kind: 'open', reporterRunRef: runRefFor(P, G, 'review-a'), proposalRef: source.proposalRef, candidateRef: source.candidateRef, targets: directory.bindings.map(b => ({ ref: b.ref, revision: b.revision, mode: 'resume', reason: 'The shared interface affects this Work' })), bodyRef: brief.bodyRef, summary: 'Two packages disagree about the interface' } };
    const withBody = (c: ArchitectureReviewCommand, selected = source) => {
        const targets = c.action.kind === 'decide' ? (open.action as Extract<ArchitectureReviewCommand['action'], {
            kind: 'open';
        }>).targets : c.action.targets;
        const body = architectureReviewBody({ ref: c.ref, revision: c.expectedRevision + 1, proposalRef: selected.proposalRef, candidateRef: selected.candidateRef, proposalDigest: selected.proposal.proposalDigest, proposalContent: selected.proposal.normalizedContent, targets, status: c.action.kind === 'decide' ? c.action.outcome === 'accept' ? 'accepted' : c.action.outcome === 'reject' ? 'rejected' : 'deferred' : 'pending', summary: c.action.summary }, c.identity.actor);
        c.action.bodyRef = { ...brief.bodyRef, digest: createHash('sha256').update(body).digest('hex'), sizeBytes: Buffer.byteLength(body) };
        return c;
    };
    withBody(open);
    const decide = (outcome: 'accept' | 'reject' | 'defer'): ArchitectureReviewCommand => withBody({ ...open, commandId: 'decide', expectedRevision: 1, identity: { ...open.identity, idempotencyKey: 'decide' }, action: { kind: 'decide', proposalDigest: source.proposal.proposalDigest, outcome, bodyRef: brief.bodyRef, summary: 'Human choice: ' + outcome } });
    return { ledger, control, open, decide, bind, propose, withBody };
}

// Real SQLite, Control claims, Vault authorization and production Query input;
// only model execution and the unchanged native source revision are deterministic.
const platforms: Awaited<ReturnType<typeof createPersistentPlatform>>[] = [];
afterEach(async () => { for (const h of platforms.splice(0)) await h.cleanup(); });
async function queryWorld() {
    const records: ReturnType<QuerySourceObservationPort['all']> = [];
    const h = await createPersistentPlatform({ deps: { clock: () => AT }, readOnlyQuery: {
        capabilities: () => ({ supported: true, readOnly: true, maxQuestionBytes: 4096, maxAnswerBytes: 16384 }),
        startQuery: async request => {
            const result = await new QueryExecutionContextCompiler({ ledger: () => h.ledger, vault: () => h.vault }).assemble(request);
            expect(result.status).toBe('ready');
            if (result.status !== 'ready') throw Error(result.message);
            records.push({ runRef: request.runRef, status: 'completed', input: result.input, sourceAfter: 'fixed-source' });
            return { schemaVersion: 1, runRef: request.runRef, outcome: 'answered', answer: 'Public facts read.', sources: [], message: null, endedAt: AT };
        },
    } });
    platforms.push(h);
    const currentness = new QuerySourceContextCompiler({ ledger: () => h.ledger, observations: { all: () => records }, source: { sourceRevision: async () => 'fixed-source' }, architectureReviews: scope => architectureReviewView(h.ledger, scope) });
    const query = async (id: string) => {
        const command: SubmitQueryJobCommand = { schemaVersion: 1, commandType: 'SubmitQueryJob', commandId: id, aggregateId: id, expectedRevision: 0, correlationId: id, submittedAt: AT,
            identity: { projectId: P, actor: { kind: 'human', id: 'user' }, idempotencyKey: id },
            payload: { runId: 'run-' + id, intent: { schemaVersion: 1, intentId: id, projectId: P, workspaceId: W, goalId: G, question: 'What ran and what architecture decisions were delivered?', focusTaskRefs: [],
                budget: { maxTokens: 128000, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: id,
                execution: { kind: 'semantic_query', roleBinding: ROLE, runtimeBudget: DEFAULT_RUNTIME_BUDGET } } } };
        expect(await h.submitQueryJob(command)).toMatchObject({ status: 'committed' });
        expect(await h.driveQuery({ reason: id })).toMatchObject({ started: 1, answered: 1, failures: [] });
        const record = records.find(r => r.runRef.queryJobId === id)!;
        expect(record).toBeDefined();
        return JSON.parse(record.input).material;
    };
    const current = async (id: string) => (await currentness.currentness(P, W)).get(id);
    return { h, query, current };
}

it('does not invalidate factual answers merely because another Query committed', async () => {
    const { h, query, current } = await queryWorld();
    await setupP107Scenario(h);
    const first = await query('before');
    // The production compiler must carry the recorded-state index to model input;
    // the accepted plan alone cannot manufacture prerequisite acceptance.
    expect(first.prerequisiteAcceptance.find((row: { taskId: string }) => row.taskId === 'task-p107-integrate')).toEqual({
        taskId: 'task-p107-integrate', prerequisiteTaskIds: [P107_TASK_READER_A, P107_TASK_READER_B],
        recordedSatisfiedTaskIds: [], unknownAcceptanceTaskIds: [P107_TASK_READER_A, P107_TASK_READER_B],
        historicalAcceptanceTaskIds: [], unobservedTaskIds: [], otherRecordedPhases: [], currentSourceReadiness: 'not_assessed',
    });
    expect(await current('before')).toBe(true);
    const second = await query('unrelated-query');
    expect(second.goalContext).toEqual(first.goalContext);
    expect(second.collaborationWork).toEqual(first.collaborationWork);
    expect(await current('before')).toBe(true);
});

it('invalidates an answer with no prior Run when the first Task claim appears', async () => {
    const { h, query, current } = await queryWorld();
    await setupP107Scenario(h);
    const first = await query('before');
    expect(first.collaborationWork.find((t: { taskId: string }) => t.taskId === P107_TASK_READER_A).latestRun).toBeNull();
    expect(await current('before')).toBe(true);
    expect(await h.control.claimTask(buildDispatchClaimCommand({ projectId: P, goalId: G, taskId: P107_TASK_READER_A, runId: 'first-run', attemptId: 'first-attempt', commandId: 'claim-first', correlationId: 'claim-first', idempotencyKey: 'claim-first', submittedAt: AT, roleBinding: ROLE, declaredPermissions: { tools: ['read'], writeScope: [] }, budget: { tokenBudget: 100000, deadline: null } }))).toMatchObject({ status: 'committed' });
    const next = await query('after');
    expect(next.goalContext).toEqual(first.goalContext);
    expect(next.collaborationWork.find((t: { taskId: string }) => t.taskId === P107_TASK_READER_A).latestRun.ref.runId).toBe('first-run');
    expect(await current('after')).toBe(true);
    expect(await current('before')).toBe(false);
});

it('invalidates an answer when the first ArchitectureReview is recorded', async () => {
    const { h, query, current } = await queryWorld();
    const arch = await architectureWorld(h);
    const first = await query('before');
    expect(first.architectureReviews.rows).toHaveLength(0);
    expect(await current('before')).toBe(true);
    expect(await arch.control.recordArchitectureReview(arch.open)).toMatchObject({ status: 'committed' });
    const next = await query('after');
    expect(next.goalContext).toEqual(first.goalContext);
    expect(next.collaborationWork).toEqual(first.collaborationWork);
    expect(next.architectureReviews.rows).toHaveLength(1);
    expect(await current('after')).toBe(true);
    expect(await current('before')).toBe(false);
});

it('invalidates an answer after Delivery progress without a new review revision', async () => {
    const { h, query, current } = await queryWorld();
    const arch = await architectureWorld(h);
    expect(await arch.control.recordArchitectureReview(arch.open)).toMatchObject({ status: 'committed' });
    expect(await arch.control.recordArchitectureReview(arch.decide('accept'))).toMatchObject({ status: 'committed' });
    const first = await query('before');
    expect(first.architectureReviews.rows[0].allNotified).toBe(false);
    expect(await current('before')).toBe(true);
    expect(await createCoordinationDrive({ ledger: h.ledger, control: h.control, now: () => AT }).drive(20)).toMatchObject({ deliveries: 2, failures: [] });
    const next = await query('after');
    expect(next.goalContext).toEqual(first.goalContext);
    expect(next.dynamicFactVersions).toEqual(first.dynamicFactVersions);
    expect(next.architectureReviews.rows[0].allNotified).toBe(true);
    expect(next.architectureReviews.rows[0].targets).not.toEqual(first.architectureReviews.rows[0].targets);
    expect(await current('after')).toBe(true);
    expect(await current('before')).toBe(false);
});

