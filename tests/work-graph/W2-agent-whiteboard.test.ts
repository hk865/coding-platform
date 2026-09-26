/**
 * W2 Agent whiteboard domain tests — Stage 1 skeleton.
 *
 * Scope: the four production files in W2 §8 and this one domain test file. These
 * tests freeze the target behaviour BEFORE implementation. Every Agent write is
 * driven through the real public `PlanTaskPort` with a genuine `work_run`
 * context whose Run/claim/Session/Lease were produced by the formal B2 entry
 * writer; no admitted receipt or admission is faked.
 *
 * RED baseline (Stage 1): the new Agent branch in `plan-service.ts` reaches the
 * frozen `plan-write-admission.ts` seam, whose `identifyPlanWriter` /
 * `authorizePlanWrite` are pure `unsupported` stubs. Every "TARGET RED" test
 * below therefore fails with `code: 'unsupported'` at that seam, never because a
 * fixture precondition failed. Each test asserts its real preconditions first
 * (or the fixture asserts the entered Run), then the final target outcome.
 *
 * Specification: docs/refactor/tasks/W2-agent-whiteboard-skeleton.md §6, §8.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createW2WhiteboardFixture,
  type W2PlanDraftV2, type W2WhiteboardFixture,
} from '../helpers/W2-whiteboard-fixture.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  decodePlanProposalRecord, encodePlanProposal,
} from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import type {
  PlanProposal, PlanWriteProvenanceV1,
} from '../../src/core/work-graph/tasks/plan-contracts.js';

const fixtures: W2WhiteboardFixture[] = [];
async function make(kind: 'memory' | 'sqlite' = 'memory'): Promise<W2WhiteboardFixture> {
  const fixture = await createW2WhiteboardFixture(kind);
  fixtures.push(fixture);
  return fixture;
}
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()));
});

function editedDraft(fixture: W2WhiteboardFixture, planId: string, taskId: string, title: string): W2PlanDraftV2 {
  return fixture.futureDraft(planId, draft => ({
    ...draft,
    tasks: draft.tasks.map(task => task.taskId === taskId ? { ...task, title } : task),
    assignments: (draft.assignments ?? []).map(assignment =>
      assignment.taskId === taskId ? { ...assignment, instruction: title } : assignment),
  }));
}

// --------------------------------------------------------------------------
// Frozen contract: versioned submittedBy codec (green; no Agent admission)
// --------------------------------------------------------------------------

const CODEC_PROJECT = 'w2-codec';
const codecDraft: PlanRevisionDraft = {
  schemaVersion: 2, planId: 'w2-codec-plan-2', planRevision: 2, goalId: 'w2-codec-goal', stages: [],
  tasks: [
    { taskId: 'work-1', title: 'Work 1', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    { taskId: 'gate-1', title: 'Gate 1', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
  ],
  assignments: [{ taskId: 'work-1', role: 'builder', instruction: 'Run work 1' }],
  obligations: [{ obligationId: 'o-1', title: 'Deliver', requirementLevel: 'required', taskIds: ['work-1', 'gate-1'],
    verificationRequirements: [{ requirementId: 'check-1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
};
const codecProvenance: PlanWriteProvenanceV1 = {
  schemaVersion: 1,
  runRef: { aggregateType: 'Run', projectId: CODEC_PROJECT, goalId: 'w2-codec-goal', runId: 'run-1' },
  sessionRef: { projectId: CODEC_PROJECT, sessionId: 'session-1' },
  roleBinding: { schemaVersion: 1, bindingId: 'binding-1', templateId: 'builder', templateRevision: '1',
    bindingVersion: 1, policyRevision: 'legacy-template' },
  sessionGeneration: 2, entryGeneration: 1, authorizationRevision: 3, configurationRevision: 'cfg-1',
};
function codecCandidate(overrides: { submittedBy?: unknown } = {}): PlanProposal {
  const base = {
    kind: 'candidate_v2' as const,
    ref: { aggregateType: 'PlanProposal' as const, projectId: CODEC_PROJECT, workspaceId: 'w2-codec-ws', proposalId: 'w2-codec-proposal' },
    revision: 1, schemaVersion: 2 as const,
    goalRef: { aggregateType: 'Goal' as const, projectId: CODEC_PROJECT, goalId: 'w2-codec-goal' },
    basedOn: { aggregateType: 'PlanRevision' as const, projectId: CODEC_PROJECT, planId: 'w2-codec-plan' },
    draft: codecDraft, reason: { text: 'codec', sources: [] }, status: 'candidate' as const, issues: [],
  };
  if (overrides.submittedBy === undefined) return base;
  return { ...base, submittedBy: overrides.submittedBy } as unknown as PlanProposal;
}

describe('W2 submittedBy codec (frozen contract)', () => {
  it('round-trips a complete Agent submission source', () => {
    const decoded = decodePlanProposalRecord(encodePlanProposal(codecCandidate({ submittedBy: codecProvenance })));
    expect(decoded, 'valid submittedBy decodes').toMatchObject({ status: 'decoded' });
    if (decoded.status !== 'decoded' || decoded.value.kind !== 'candidate_v2') throw Error('codec did not decode the candidate');
    expect(decoded.value.submittedBy).toEqual(codecProvenance);
  });
  it('rejects a foreign-project/Goal source and malformed generations', () => {
    const foreign = codecCandidate({ submittedBy: { ...codecProvenance,
      runRef: { aggregateType: 'Run', projectId: CODEC_PROJECT, goalId: 'another-goal', runId: 'run-1' } } });
    expect(decodePlanProposalRecord(encodePlanProposal(foreign))).toMatchObject({ status: 'invalid' });
    const zeroGeneration = codecCandidate({ submittedBy: { ...codecProvenance, sessionGeneration: 0 } });
    expect(decodePlanProposalRecord(encodePlanProposal(zeroGeneration))).toMatchObject({ status: 'invalid' });
    const brokenRole = codecCandidate({ submittedBy: { ...codecProvenance, roleBinding: { schemaVersion: 1 } } });
    expect(decodePlanProposalRecord(encodePlanProposal(brokenRole))).toMatchObject({ status: 'invalid' });
  });
  it('keeps a legacy candidate without submittedBy readable as a Host candidate', () => {
    const decoded = decodePlanProposalRecord(encodePlanProposal(codecCandidate()));
    expect(decoded, 'absent submittedBy stays decodable').toMatchObject({ status: 'decoded' });
    if (decoded.status !== 'decoded' || decoded.value.kind !== 'candidate_v2') throw Error('codec did not decode the candidate');
    expect(decoded.value.submittedBy).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// Host compatibility and pre-commit cancellation (green)
// --------------------------------------------------------------------------

describe('W2 Host compatibility', () => {
  it('Host future-plan propose/apply is unchanged when delegatedWrites is configured', async () => {
    const f = await make();
    const draft = editedDraft(f, 'w2-host-plan-2', 'implement-b', 'Host edited B');
    const proposed = await f.proposeAsHost(draft, f.planRef, { requestId: 'w2-host-propose-1' });
    expect(proposed, 'Host propose stays committed').toMatchObject({ status: 'committed', replayed: false });
    if (proposed.status !== 'committed') throw Error(`Host propose broken: ${JSON.stringify(proposed)}`);
    const applied = await f.applyAsHost(proposed.value.ref, proposed.value.revision, { requestId: 'w2-host-apply-1' });
    expect(applied, 'Host apply stays committed').toMatchObject({ status: 'committed', replayed: false });
    if (applied.status !== 'committed') throw Error(`Host apply broken: ${JSON.stringify(applied)}`);
    expect(applied.value.schemaVersion).toBe(2);
    if (applied.value.schemaVersion !== 2) throw Error('Host apply did not produce a v2 revision');
    expect(applied.value.taskStateBasis?.entries.length).toBeGreaterThan(0);
  });

  it('a work_run write without delegatedWrites keeps the original Host-only rejection', async () => {
    const f = await make();
    const draft = f.futureDraft('w2-no-delegation-plan');
    const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef, draft, f.planRef, { requestId: 'w2-no-delegation' });
    const result = await f.base.plans.proposePlan(f.ctxWork, request);
    expect(result, 'absent delegatedWrites keeps the legacy forbidden path').toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('ordinary graph reads remain available after a formal terminal and Host write revocation', async () => {
    const f = await make();
    await f.finishRun();
    f.host.enabled = false;
    const calls = f.host.calls;
    const graph = await f.plans.queryTaskGraph(f.ctxWork, { goalRef: f.goalRef });
    const ready = await f.plans.queryReadyTasks(f.ctxWork, { goalRef: f.goalRef, includeBlocked: true, page: { limit: 20 } });
    expect(graph, JSON.stringify(graph)).toMatchObject({ status: 'ready' });
    expect(ready, JSON.stringify(ready)).toMatchObject({ status: 'ready' });
    expect(f.host.calls, 'queries do not invoke delegated write admission').toBe(calls);
  });

  it('an aborted signal before admission writes nothing', async () => {
    const f = await make();
    const draft = f.futureDraft('w2-aborted-plan');
    const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef, draft, f.planRef, { requestId: 'w2-aborted' });
    const aborted: CoreCallContext = { ...f.ctxWork, signal: AbortSignal.abort() };
    const result = await f.plans.proposePlan(aborted, request);
    expect(result, 'pre-admission cancel is a zero-write rejection').toMatchObject({ status: 'rejected', code: 'cancelled' });
  });
});

// --------------------------------------------------------------------------
// TARGET RED: real Agent success chain
// --------------------------------------------------------------------------

describe('W2 Agent success chain', () => {
  it('real claim -> B2 entered -> Agent propose commits a sourced candidate', async () => {
    const f = await make();
    const draft = editedDraft(f, 'w2-agent-plan-2', 'implement-b', 'Agent edited B');
    const proposed = await f.proposeAsWorkRun(draft, f.planRef, { requestId: 'w2-agent-propose-1' });
    // TARGET RED: Stage 1 stops at the unsupported admission seam.
    expect(proposed, 'W2 Agent propose must commit through the frozen admission seam')
      .toMatchObject({ status: 'committed', replayed: false });
    if (proposed.status !== 'committed') throw Error(`W2 Agent propose not implemented at the admission seam: ${JSON.stringify(proposed)}`);
    if (proposed.value.kind !== 'candidate_v2') throw Error('Agent propose did not return a candidate_v2');
    expect(proposed.value.submittedBy, 'candidate carries the runtime provenance').toEqual(await f.provenanceFor());
    expect(proposed.value.goalRef).toEqual(f.goalRef);
    const event = await f.records.eventAt(proposed.cursor);
    expect(event, 'real proposal event exists').toMatchObject({ status: 'ready' });
    if (event.status !== 'ready') throw Error('proposal event unavailable');
    expect(JSON.parse(event.value.event.json).actor).toEqual({ kind: 'agent',
      id: 'session:' + sha256Hex(canonicalJson(f.claim.sessionRef)), runRef: f.claim.runRef });
  });

  it('Agent apply adopts its own sourced candidate and preserves unchanged task basis', async () => {
    const f = await make();
    const draft = editedDraft(f, 'w2-agent-plan-apply', 'implement-b', 'Agent apply B');
    const candidate = await f.seedAgentCandidate({ draft, basedOn: f.planRef, proposalId: 'w2-agent-candidate-apply' });
    const applied = await f.applyAsWorkRun(candidate.ref, candidate.revision, { requestId: 'w2-agent-apply-own' });
    // TARGET RED: Stage 1 stops at the unsupported admission seam.
    expect(applied, 'W2 Agent apply must commit its own candidate').toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw Error(`W2 Agent apply not implemented: ${JSON.stringify(applied)}`);
    expect(applied.value.schemaVersion).toBe(2);
    if (applied.value.schemaVersion !== 2) throw Error('Agent apply did not produce a v2 revision');
    expect(applied.value.taskStateBasis?.entries.map(entry => entry.taskId)).toContain('implement-a');
  });
});

// --------------------------------------------------------------------------
// TARGET RED: authorization and provenance rejections
// --------------------------------------------------------------------------

describe('W2 Agent authorization rejects', () => {
  it('a candidate sourced from another Run cannot be adopted by this Run', async () => {
    const f = await make();
    const plan2 = await f.readPlanSnapshot(f.plan2Ref);
    const draft2 = f.futureDraftFor(plan2, 'w2-second-plan-foreign',
      d => ({ ...d, tasks: d.tasks.map(t => t.taskId === 'b2-second-task' ? { ...t, title: 'Second edited' } : t) }));
    const foreign = await f.seedAgentCandidate({ claim: f.secondClaim, goalRef: f.goal2Ref,
      draft: draft2, basedOn: f.plan2Ref, proposalId: 'w2-agent-candidate-foreign' });
    const applied = await f.applyAsWorkRun(foreign.ref, foreign.revision,
      { requestId: 'w2-agent-apply-foreign', expected: [] });
    // TARGET RED: the second Run's candidate must be forbidden, not adopted.
    expect(applied, 'another Run candidate must be forbidden').toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('current Host revocation denies a fresh Agent write even though the original entry was valid', async () => {
    const f = await make();
    f.host.enabled = false;
    const result = await f.proposeAsWorkRun(f.futureDraft('w2-host-revoked-plan'), f.planRef,
      { requestId: 'w2-current-host-revoked' });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('a formally ended Run cannot submit a new Agent proposal', async () => {
    const f = await make();
    await f.finishRun();
    expect((await f.readRun()).status).toBe('ended');
    expect((await f.readLease())?.release).toBeDefined();
    const result = await f.proposeAsWorkRun(f.futureDraft('w2-after-terminal-plan'), f.planRef,
      { requestId: 'w2-after-terminal' });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it.each(['initial', 'foreign-source', 'v1'] as const)(
    'Agent propose rejects a %s candidate before any Plan commit', async variant => {
      const f = await make();
      const draft = f.futureDraft(`w2-outside-scope-${variant}`);
      const basedOn = variant === 'initial' ? null : variant === 'foreign-source' ? f.plan2Ref : f.planRef;
      const { taskRelations: _relations, inputRequirements: _inputs, ...legacyDraft } = draft;
      const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef,
        variant === 'v1' ? { ...legacyDraft, schemaVersion: 1 } : draft, basedOn,
        { requestId: `w2-outside-scope-${variant}` });
      let commits = 0;
      const records: typeof f.records = { ...f.records, async commit(prepared) {
        commits++;
        return f.records.commit(prepared);
      } };
      const plans = createPlanService({ records, delegatedWrites: f.delegatedWrites,
        now: () => '2026-09-26T00:00:00.000Z', eventId: () => `w2-outside-scope-${variant}-event` });
      const result = await plans.proposePlan(f.ctxWork, request);
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'rejected',
        code: variant === 'initial' ? 'forbidden' : variant === 'foreign-source' ? 'not_found' : 'unsupported' });
      expect(commits, 'out-of-scope candidates never reach Store commit').toBe(0);
    });

  it('a Goal pin for another real Goal cannot stand in for the target Goal revision', async () => {
    const f = await make();
    const targetPin = await f.goalPin();
    const foreignPin = await f.goalPin(f.goal2Ref);
    expect(foreignPin.revision, 'both real Goals happen to have the same aggregate revision').toBe(targetPin.revision);
    const expected = (await f.callerPins()).map(pin => pin.ref.aggregateType === 'Goal' ? foreignPin : pin);
    const result = await f.proposeAsWorkRun(f.futureDraft('w2-foreign-goal-pin-plan'), f.planRef,
      { requestId: 'w2-foreign-goal-pin', expected });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

});

// --------------------------------------------------------------------------
// TARGET RED: identity, concurrency, replay and late cancel
// --------------------------------------------------------------------------

describe('W2 Agent identity and replay', () => {
  it('the same Run can propose two successive future plan versions', async () => {
    const f = await make();
    const draft2 = f.futureDraftFor(f.plan, 'w2-agent-two-versions-2',
      d => ({ ...d, tasks: d.tasks.map(t => t.taskId === 'implement-b' ? { ...t, title: 'Version 2 B' } : t),
        assignments: (d.assignments ?? []).map(a => a.taskId === 'implement-b' ? { ...a, instruction: 'Version 2 B' } : a) }));
    const first = await f.proposeAsWorkRun(draft2, f.planRef, { requestId: 'w2-agent-version-2' });
    // TARGET RED: first version commits and is adopted, then the SAME Run proposes v3.
    expect(first, 'first future version commits').toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') throw Error(`first Agent version not implemented: ${JSON.stringify(first)}`);
    const applied = await f.applyAsWorkRun(first.value.ref, first.value.revision, { requestId: 'w2-agent-version-2-apply' });
    expect(applied, 'first future version adopted').toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') throw Error(`first Agent version apply not implemented: ${JSON.stringify(applied)}`);
    if (applied.value.schemaVersion !== 2) throw Error('first Agent version did not produce a v2 plan');
    const draft3 = f.futureDraftFor(applied.value, 'w2-agent-two-versions-3',
      d => ({ ...d, tasks: d.tasks.map(t => t.taskId === 'implement-b' ? { ...t, title: 'Version 3 B' } : t),
        assignments: (d.assignments ?? []).map(a => a.taskId === 'implement-b' ? { ...a, instruction: 'Version 3 B' } : a) }));
    const stale = await f.proposeAsWorkRun(draft3, f.planRef,
      { requestId: 'w2-agent-version-3-stale-source', expected: await f.callerPins(f.goalRef, applied.value.ref) });
    expect(stale, 'a real older accepted source cannot create a new proposal after activePlan advances')
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const second = await f.proposeAsWorkRun(draft3, applied.value.ref, { requestId: 'w2-agent-version-3' });
    expect(second, 'second future version commits from the same Run').toMatchObject({ status: 'committed' });
  });

  it('two Runs with the same callId derive different Agent proposal identities', async () => {
    const f = await make();
    const first = await f.proposeAsWorkRun(f.futureDraft('w2-same-call-a'), f.planRef,
      { requestId: 'w2-shared-call', expected: [] });
    const plan2 = await f.readPlanSnapshot(f.plan2Ref);
    const draft2 = f.futureDraftFor(plan2, 'w2-same-call-b',
      d => ({ ...d, tasks: d.tasks.map(t => t.taskId === 'b2-second-task' ? { ...t, title: 'Second same call' } : t) }));
    const second = await f.proposeAsSecondWorkRun(draft2, f.plan2Ref, { requestId: 'w2-shared-call', expected: [] });
    // TARGET RED: the shared callId must not collide across Runs.
    expect(first, 'first Run propose commits').toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') throw Error(`first same-callId propose not implemented: ${JSON.stringify(first)}`);
    expect(second, 'second Run propose commits').toMatchObject({ status: 'committed' });
    if (second.status !== 'committed') throw Error(`second same-callId propose not implemented: ${JSON.stringify(second)}`);
    expect(first.value.ref.proposalId).not.toBe(second.value.ref.proposalId);
  });

  it('an unrelated real commit between admission and commit does not globally lock an Agent proposal', async () => {
    const f = await make();
    let injected = false;
    const records: typeof f.records = { ...f.records, async commit(prepared) {
      if (!injected && prepared.identityKey.startsWith('plan-propose:')) {
        injected = true;
        const extra = await f.base.commitRaw([]);
        expect(extra, 'real unrelated ledger advance').toMatchObject({ status: 'committed' });
      }
      return f.records.commit(prepared);
    } };
    const plans = createPlanService({ records, delegatedWrites: f.delegatedWrites,
      now: () => '2026-09-26T00:00:00.000Z', eventId: () => 'w2-unrelated-proposal-event' });
    const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef,
      f.futureDraft('w2-agent-plan-unrelated'), f.planRef, { requestId: 'w2-agent-unrelated' });
    const result = await plans.proposePlan(f.ctxWork, request);
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
    expect(injected).toBe(true);
  });

  it('formal Run completion between admission and commit prevents the Agent write', async () => {
    const f = await make();
    let finished = false;
    const records: typeof f.records = { ...f.records, async commit(prepared) {
      if (!finished && prepared.identityKey.startsWith('plan-propose:')) {
        finished = true;
        await f.finishRun();
      }
      return f.records.commit(prepared);
    } };
    const plans = createPlanService({ records, delegatedWrites: f.delegatedWrites,
      now: () => '2026-09-26T00:00:00.000Z', eventId: () => 'w2-terminal-cas-event' });
    const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef,
      f.futureDraft('w2-terminal-cas-plan'), f.planRef, { requestId: 'w2-terminal-cas-propose' });
    const result = await plans.proposePlan(f.ctxWork, request);
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(finished).toBe(true);
    expect((await f.readRun()).status).toBe('ended');
  });

  it('after an initial receipt miss a concurrently committed proposal still replays after Host revocation', async () => {
    const f = await make();
    const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef,
      f.futureDraft('w2-miss-replay-plan'), f.planRef, { requestId: 'w2-miss-replay' });
    let injected = false;
    let winner: Awaited<ReturnType<typeof f.plans.proposePlan>> | undefined;
    const records: typeof f.records = { ...f.records, async lookupCommit(query) {
      const receipt = await f.records.lookupCommit(query);
      if (!injected && query.identityKey.startsWith('plan-propose:') && receipt.status !== 'ready' && receipt.code === 'not_found') {
        injected = true;
        winner = await f.plans.proposePlan(f.ctxWork, request);
        expect(winner, JSON.stringify(winner)).toMatchObject({ status: 'committed', replayed: false });
        f.host.enabled = false;
      }
      return receipt;
    } };
    const plans = createPlanService({ records, delegatedWrites: f.delegatedWrites,
      now: () => '2026-09-26T00:00:00.000Z', eventId: () => 'w2-loser-unused-event' });
    const result = await plans.proposePlan(f.ctxWork, request);
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', replayed: true });
    expect(injected).toBe(true);
    expect(result).toEqual({ ...winner, replayed: true });
  });

  it('exact apply replays its original receipt after terminal/revocation; changed Plan/Proposal pins conflict', async () => {
    const f = await make();
    const candidate = await f.seedAgentCandidate({
      draft: editedDraft(f, 'w2-agent-plan-replay', 'implement-b', 'Replay B'),
      basedOn: f.planRef, proposalId: 'w2-agent-candidate-replay',
    });
    const expected: VersionPin[] = [...await f.callerPins(), { ref: candidate.ref, revision: candidate.revision }];
    const options = { requestId: 'w2-agent-replay', expected };
    const first = await f.applyAsWorkRun(candidate.ref, candidate.revision, options);
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') throw Error('first Agent apply failed');
    await f.finishRun();
    f.host.enabled = false;
    const calls = f.host.calls;
    const replay = await f.applyAsWorkRun(candidate.ref, candidate.revision, options);
    expect(replay, JSON.stringify(replay)).toEqual({ ...first, replayed: true });
    expect(f.host.calls, 'historical replay does not consult current Host permission').toBe(calls);
    for (const ref of [f.planRef, candidate.ref]) {
      const changed = expected.map(pin => canonicalJson(pin.ref) === canonicalJson(ref) ? { ...pin, revision: pin.revision + 1 } : pin);
      const conflict = await f.applyAsWorkRun(candidate.ref, candidate.revision, { requestId: options.requestId, expected: changed });
      expect(conflict, 'all five pin kinds survive fingerprint normalization').toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    }
  });

  it.each(['propose', 'apply'] as const)(
    '%s keeps the original AbortSignal when the caller replaces ctx.signal during a read', async operation => {
      const f = await make();
      const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef,
        editedDraft(f, `w2-context-${operation}-plan`, 'implement-b', 'Context snapshot B'), f.planRef,
        { requestId: `w2-context-${operation}-propose` });
      const proposed = operation === 'apply' ? await f.plans.proposePlan(f.ctxWork, request) : null;
      if (operation === 'apply' && proposed?.status !== 'committed') {
        throw Error(`formal proposal prerequisite failed: ${JSON.stringify(proposed)}`);
      }
      const controller = new AbortController();
      const ctx: CoreCallContext = { ...f.ctxWork, signal: controller.signal };
      let readStarted!: () => void;
      let resumeRead!: () => void;
      const started = new Promise<void>(resolve => { readStarted = resolve; });
      const resume = new Promise<void>(resolve => { resumeRead = resolve; });
      let paused = false;
      const delegatedWrites: typeof f.delegatedWrites = { ...f.delegatedWrites,
        reads: { ...f.delegatedWrites.reads, async readExecution(readCtx, runRef) {
          const result = await f.delegatedWrites.reads.readExecution(readCtx, runRef);
          if (!paused) {
            paused = true;
            readStarted();
            await resume;
          }
          return result;
        } } };
      let commits = 0;
      const records: typeof f.records = { ...f.records, async commit(prepared) {
        commits++;
        return f.records.commit(prepared);
      } };
      const plans = createPlanService({ records, delegatedWrites,
        now: () => '2026-09-26T00:00:00.000Z', eventId: () => `w2-context-${operation}-event` });
      const expected = await f.callerPins();
      const pending = operation === 'apply' && proposed?.status === 'committed'
        ? plans.applyPlanChange(ctx, {
          input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
          meta: { requestId: 'w2-context-apply', expected },
        })
        : plans.proposePlan(ctx, request);
      const reachedRead = await Promise.race([started.then(() => true), pending.then(() => false)]);
      if (!reachedRead) throw Error(`the real identity read was not reached: ${JSON.stringify(await pending)}`);
      try {
        ctx.signal = new AbortController().signal;
        controller.abort();
      } finally {
        resumeRead();
      }
      const result = await pending;
      expect(result, JSON.stringify(result)).toMatchObject({ status: 'rejected', code: 'cancelled' });
      expect(ctx.signal.aborted).toBe(false);
      expect(controller.signal.aborted).toBe(true);
      expect(commits, 'cancellation of the invocation original signal reaches no Store commit').toBe(0);
    });

  it('a signal aborted after the actual commit preserves that invocation committed result', async () => {
    const f = await make();
    const candidate = await f.seedAgentCandidate({
      draft: editedDraft(f, 'w2-agent-plan-late-cancel', 'implement-b', 'Late cancel B'),
      basedOn: f.planRef, proposalId: 'w2-agent-candidate-late',
    });
    const controller = new AbortController();
    let committed = false;
    const records: typeof f.records = { ...f.records, async commit(prepared) {
      const receipt = await f.records.commit(prepared);
      if (receipt.status === 'committed' && prepared.identityKey.startsWith('plan-apply:')) {
        committed = true; controller.abort();
      }
      return receipt;
    } };
    const plans = createPlanService({ records, delegatedWrites: f.delegatedWrites,
      now: () => '2026-09-26T00:00:00.000Z', eventId: () => 'w2-late-apply-event' });
    const result = await plans.applyPlanChange({ ...f.ctxWork, signal: controller.signal }, {
      input: { proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [] },
      meta: { requestId: 'w2-agent-late', expected: await f.callerPins() },
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', replayed: false });
    expect(committed).toBe(true); expect(controller.signal.aborted).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Persistence target: formal Agent receipt over real SQLite
// --------------------------------------------------------------------------

describe('W2 persistence', () => {
  it('SQLite reopen restores a real Agent proposal receipt despite later Host revocation', async () => {
    const f = await make('sqlite');
    const request = await f.buildAgentProposeRequest(f.goalRef, f.planRef,
      editedDraft(f, 'w2-agent-plan-sqlite', 'implement-b', 'SQLite B'), f.planRef,
      { requestId: 'w2-sqlite-proposal' });
    const first = await f.plans.proposePlan(f.ctxWork, request);
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') throw Error('formal Agent proposal prerequisite');
    await f.base.closeBackend();
    const reopened = await f.base.reopenService();
    f.host.enabled = false;
    const calls = f.host.calls;
    try {
      const plans = createPlanService({ records: reopened.records,
        delegatedWrites: { ...f.delegatedWrites, reads: createRunStateReader({ records: reopened.records }) },
        now: () => '2026-09-26T00:00:00.000Z', eventId: () => 'w2-reopened-unused-event',
      });
      const replay = await plans.proposePlan(f.ctxWork, request);
      expect(replay, JSON.stringify(replay)).toEqual({ ...first, replayed: true });
      expect(f.host.calls).toBe(calls);
    } finally { await reopened.close(); }
  });
});
