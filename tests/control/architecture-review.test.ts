import { afterEach, expect, it } from 'vitest';
import { createCoordinationDrive } from '../../src/control/dispatch-engine/coordination-drive.js';
import { architectureReviewView } from '../../src/data/read-model-index/architecture-review-view.js';
import { randomUUID, createHash } from 'node:crypto';
import { InMemoryLedger } from '../../src/data/state-ledger/in-memory-ledger.js';
import { SqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { createControlEngine } from '../../src/control/control-engine/control-engine.js';
import type { StateLedger, LedgerCommit } from '../../src/contracts/ledger.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import type { BaselineActivationV1 } from '../../src/contracts/baseline-evolution.js';
import { queryFactAssertionMatches } from '../../src/contracts/query-quality-facts.js';
import type { JsonValue } from '../../src/contracts/fingerprint.js';
import { architectureReviewRef, architectureReviewBody, type ArchitectureReviewCommand, type ArchitectureReviewSnapshot, type ArchitectureReviewCommit } from '../../src/contracts/architecture-review.js';
import { workContextRefFor } from '../../src/contracts/context-continuity.js';
import { runRefFor } from '../../src/contracts/dispatch.js';
import { buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { buildP112Brief, buildP112Proposal, buildP112ReportFinding, buildRecordArchitectureFindingCommand, buildRecordArchitectureDecisionBriefCommand, buildRecordCandidateBaselineProposalCommand } from '../../src/fixtures/architecture-fixtures.js';
import { candidateProposalDigest, architectureFindingRefFor, architectureDecisionBriefRefFor, architectureCandidateProposalRefFor } from '../../src/contracts/architecture-inspection.js';
import { candidateContentDigest } from '../../src/contracts/baseline-evolution.js';
import { buildP114MaterializeCommand } from '../contract-support/fixtures/baseline-evolution-fixtures.js';
import { setupP107Scenario } from '../coordination/runtime-concurrency-fixture.js';
import { P107_PROJECT as P, P107_WORKSPACE as W, P107_GOAL as G, P107_SCHEMA as AT, P107_TASK_READER_A, P107_TASK_READER_B, P107_ROLE_BINDING_READER_V1 as ROLE } from '../contract-support/fixtures/workspace-fixtures.js';
const closing: SqliteStateLedger[] = [];
afterEach(async () => {
    for (const ledger of closing.splice(0))
        await ledger.close();
});
async function world(adapter: 'memory' | 'sqlite') {
    const ledger: StateLedger = adapter === 'memory' ? new InMemoryLedger() : new SqliteStateLedger({ path: ':memory:' });
    if (ledger instanceof SqliteStateLedger)
        closing.push(ledger);
    const control = createControlEngine({ ledger, now: () => AT, eventId: randomUUID });
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
for (const adapter of ['memory', 'sqlite'] as const) {
    it(`observes only exact proposal-and-decision activations without changing selection authority (${adapter})`, async () => {
        const { ledger, control, open, decide } = await world(adapter);
        expect(await control.recordArchitectureReview(open)).toMatchObject({ status: 'committed' });
        expect(await control.recordArchitectureReview(decide('accept'))).toMatchObject({ status: 'committed' });
        const before = (await architectureReviewView(ledger, { projectId: P, workspaceId: W })).rows[0]!;
        const decision = before.decisionFacts!.acceptedProposal.record!;
        const activation: BaselineActivationV1 = { schemaVersion: 1, activationId: 'matching', projectId: P, workspaceId: W,
            proposalRef: before.review.proposalRef, decisionRef: before.review.decisionRef!,
            gateRef: { aggregateType: 'MigrationGateTask', projectId: P, workspaceId: W, gateId: 'gate' },
            fromPin: decision.authorizedTarget.fromPin,
            toPin: { ref: { ...decision.authorizedTarget.fromPin.ref, revision: decision.authorizedTarget.fromPin.ref.revision + 1 }, digest: before.proposal.expectedCandidateDigest }, activatedAt: AT };
        // Declared ledger event-read fixture: isolates exact filtering, not activation authorization.
        const source = await ledger.events({ afterCursor: null, limit: 1000 });
        expect(source.hasMore).toBe(false);
        const base = seqOfCommitCursor(source.events.at(-1)!.cursor);
        const variants = [activation, { ...activation, activationId: 'wrong-decision', decisionRef: { ...activation.decisionRef, decisionId: 'other' } },
            { ...activation, activationId: 'wrong-proposal', proposalRef: { ...activation.proposalRef, proposalId: 'other' } }];
        const page = { ...source, throughCursor: makeCommitCursor(base + variants.length), events: [...source.events, ...variants.map((a, i) => ({ cursor: makeCommitCursor(base + i + 1),
            event: { ...source.events[0]!.event, eventType: 'BaselineActivationRecorded' as const, projectId: P, workspaceId: W, payload: { activation: a, recordedAt: AT } } }))] };
        const readPort = { load: ledger.load.bind(ledger), events: async (q: Parameters<StateLedger['events']>[0]) => q.afterCursor === null ? page : { ...page, afterCursor: q.afterCursor, events: [] } } as Pick<StateLedger, 'load' | 'events'>;
        const after = (await architectureReviewView(readPort, { projectId: P, workspaceId: W })).rows[0]!.decisionFacts!;
        expect(after.activatedBaseline).toMatchObject({ status: 'ready', records: [activation] });
        expect(after.activatedBaseline.records).toHaveLength(1);
        expect(after.selectedCandidate.status).toBe('not_found');
        expect(after.version).not.toBe(before.decisionFacts!.version);
        expect(queryFactAssertionMatches(JSON.parse(JSON.stringify(activation)) as JsonValue, { kind: 'baseline_activation', expected: activation.toPin.digest })).toBe(true);
        expect(queryFactAssertionMatches(JSON.parse(JSON.stringify(activation)) as JsonValue, { kind: 'baseline_activation', expected: 'different-source' })).toBe(false);
    });
    it.each(['accept', 'reject', 'defer'] as const)(`records %s and every Work intent in one durable transition (${adapter})`, async (outcome) => {
        const { ledger, control, open, decide } = await world(adapter);
        expect(await control.recordArchitectureReview(open)).toMatchObject({ status: 'committed' });
        const activeRef = { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId: P };
        const before = await ledger.load(activeRef);
        const command = decide(outcome), receipt = await control.recordArchitectureReview(command);
        expect(receipt).toMatchObject({ status: 'committed', replayed: false });
        const result = await ledger.load(open.ref);
        if (result.status !== 'found')
            throw Error('review missing');
        const review = result.snapshot as ArchitectureReviewSnapshot;
        expect(review.targets.map(t => t.ref.workId)).toEqual(['a', 'b']);
        expect(review.status).toBe(outcome === 'accept' ? 'accepted' : outcome === 'reject' ? 'rejected' : 'deferred');
        const observed = await architectureReviewView(ledger, { projectId: P, workspaceId: W });
        const facts = observed.rows[0]!.decisionFacts;
        if (!facts) throw Error('decision facts missing');
        expect(facts).toMatchObject({
            object: 'architecture-review-decision', scope: { projectId: P, workspaceId: W, goalId: G },
            acceptedProposal: { status: 'ready', outcome, accepted: outcome === 'accept' },
            selectedCandidate: { status: 'not_found', coverage: 'explicit-human-option-choice-in-this-decision' },
            activatedBaseline: { status: 'not_found', records: [] },
        });
        expect(facts.acceptedProposal.decisionRef).toEqual(review.decisionRef);
        expect(facts.selectedCandidate.proposalSelection.optionId).toBe(observed.rows[0]!.proposal.selectedOptionId);
        expect(facts.version).toMatch(/^[a-f0-9]{64}$/);
        expect(await ledger.load(activeRef)).toEqual(before);
        const events = await ledger.events({ afterCursor: null, limit: 500 });
        const intents = events.events.filter(e => e.event.eventType === 'CommunicationIntentRecorded' && e.event.payload.intent.domain.kind === 'architecture_decision_delivery');
        expect(intents).toHaveLength(2);
        const drive = createCoordinationDrive({ ledger, control, now: () => AT });
        expect(await drive.drive(20)).toMatchObject({ deliveries: 2, failures: [] });
        expect(await drive.drive(20)).toMatchObject({ deliveries: 0, failures: [] });
        expect(await control.recordArchitectureReview({ ...command, submittedAt: '2026-09-07T12:00:00.000Z' })).toEqual({ ...receipt, replayed: true });
        expect(await control.recordArchitectureReview({ ...command, action: { ...command.action, summary: 'changed' } })).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    });
    it(`rejects public body substitution before a decision is recorded (${adapter})`, async () => {
        const { control, open, decide, ledger } = await world(adapter);
        expect(await control.recordArchitectureReview(open)).toMatchObject({ status: 'committed' });
        const rejected = decide('reject'), accepted = decide('accept');
        rejected.action.bodyRef = accepted.action.bodyRef;
        expect(await control.recordArchitectureReview(rejected)).toMatchObject({ status: 'rejected', code: 'invalid' });
        const loaded = await ledger.load(open.ref);
        expect(loaded.status === 'found' && loaded.snapshot.revision).toBe(1);
    });
    it(`refuses a changed complete Work set and never drops the new Work (${adapter})`, async () => {
        const { control, open, decide, bind, ledger } = await world(adapter);
        expect(await control.recordArchitectureReview(open)).toMatchObject({ status: 'committed' });
        expect(await bind('later', 'review-a')).toMatchObject({ status: 'committed' });
        expect(await control.recordArchitectureReview(decide('accept'))).toMatchObject({ status: 'rejected', code: 'stale' });
        const r = await ledger.load(open.ref);
        expect(r.status === 'found' && r.snapshot.revision).toBe(1);
    });
    it(`modification requires a new proposal; old displayed decisions become stale (${adapter})`, async () => {
        const { control, open, decide, propose, ledger, withBody } = await world(adapter);
        expect(await control.recordArchitectureReview(open)).toMatchObject({ status: 'committed' });
        const replacement = await propose('replacement');
        if (open.action.kind !== 'open')
            throw Error('fixture');
        const modify: ArchitectureReviewCommand = { ...open, commandId: 'modify', identity: { ...open.identity, idempotencyKey: 'modify' }, expectedRevision: 1, action: { kind: 'modify', proposalDigest: decide('accept').action.kind === 'decide' ? (decide('accept').action as Extract<ArchitectureReviewCommand['action'], {
                    kind: 'decide';
                }>).proposalDigest : '', proposalRef: replacement.proposalRef, candidateRef: replacement.candidateRef, targets: open.action.targets, bodyRef: open.action.bodyRef, summary: 'Revised option; requires a new choice' } };
        const downgraded = structuredClone(modify);
        if (downgraded.action.kind === 'modify')
            downgraded.action.targets = downgraded.action.targets.map(t => ({ ...t, mode: 'notify' }));
        expect(await control.recordArchitectureReview(withBody(downgraded, replacement))).toMatchObject({ status: 'rejected', code: 'invalid' });
        const load = ledger.load.bind(ledger);
        ledger.load = async (ref) => { const r = await load(ref); return ref.aggregateType === 'Workspace' && r.status === 'found' ? { ...r, snapshot: { ...(r.snapshot as import('../../src/contracts/ledger.js').WorkspaceSnapshot), revision: r.snapshot.revision + 1 } } : r; };
        expect(await control.recordArchitectureReview(withBody(modify, replacement))).toMatchObject({ status: 'rejected', code: 'stale' });
        ledger.load = load;
        expect(await control.recordArchitectureReview(withBody(modify, replacement))).toMatchObject({ status: 'committed' });
        expect(await control.recordArchitectureReview(decide('accept'))).toMatchObject({ status: 'rejected' });
        const current = await ledger.load(open.ref);
        expect(current.status === 'found' && (current.snapshot as ArchitectureReviewSnapshot).status).toBe('pending');
    });
    it(`rechecks the full set inside the final commit, after Control read it (${adapter})`, async () => {
        const { control, open, decide, bind, ledger } = await world(adapter);
        expect(await control.recordArchitectureReview(open)).toMatchObject({ status: 'committed' });
        const commit = ledger.commit.bind(ledger);
        let injected = false;
        ledger.commit = async (batch: LedgerCommit) => {
            if (batch.commitKind === 'architecture-review' && batch.command.action.kind === 'decide' && !injected) {
                injected = true;
                expect(await bind('racing', 'review-a')).toMatchObject({ status: 'committed' });
            }
            return commit(batch);
        };
        expect(await control.recordArchitectureReview(decide('accept'))).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    });
    it(`rejects an adapter-level forged target omission (${adapter})`, async () => {
        const { control, open, decide, ledger } = await world(adapter);
        expect(await control.recordArchitectureReview(open)).toMatchObject({ status: 'committed' });
        const commit = ledger.commit.bind(ledger);
        ledger.commit = async (batch: LedgerCommit) => {
            if (batch.commitKind === 'architecture-review' && batch.command.action.kind === 'decide') {
                const forged = structuredClone(batch) as ArchitectureReviewCommit;
                (forged.snapshots[0] as ArchitectureReviewSnapshot).targets.pop();
                return commit(forged);
            }
            return commit(batch);
        };
        expect(await control.recordArchitectureReview(decide('accept'))).toMatchObject({ status: 'rejected', code: 'invalid_commit' });
    });
}
