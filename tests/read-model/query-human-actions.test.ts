import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryLedger } from '../../src/data/state-ledger/in-memory-ledger.js';
import { createControlEngine } from '../../src/control/control-engine/control-engine.js';
import { humanActionCaptureCursor, queryHumanActions } from '../../src/data/read-model-index/query-human-actions.js';
import { p111BootstrapGoalGovernance } from '../contract-suite/p1-11-harness.js';
import { buildP115Proposal, buildP115Decision, buildP115ProposalCommand, buildP115DecisionCommand } from '../contract-support/fixtures/human-role-collaboration-fixtures.js';
import { planningScenario, planningScope, planningAt } from '../control/planning-fixture.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import { queryFactAssertionMatches } from '../../src/contracts/query-quality-facts.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ReworkDriveViewV1 } from '../../src/contracts/rework/drive.js';

function emptyRework(scope: ReworkDriveViewV1['scope'], activePlanRef: ReworkDriveViewV1['acceptance']['activePlanRef']): ReworkDriveViewV1 {
  return { schemaVersion: 1, scope, issues: { status: 'none', gaps: [] }, gaps: [],
    proposal: { status: 'not_compiled', proposalId: null, planId: null, message: null, diagnostics: [] },
    acceptance: { activePlanRef, proposalId: null, proposalRecorded: false, proposalRef: null, recordedAt: null,
      digestMatches: null, applied: false, appliedBasis: 'none', appliedProposalId: null, note: 'Declared complete read-port fixture' } };
}

it.each(['accept', 'reject', 'defer'] as const)('observes a persisted initial-design question and exact %s without assuming baseline activation', async outcome => {
  const ledger = new InMemoryLedger();
  const control = createControlEngine({ ledger, now: () => '2026-09-15T00:00:00.000Z', eventId: randomUUID });
  await p111BootstrapGoalGovernance(ledger, 'proj-alpha');
  const proposal = buildP115Proposal({ planRef: null });
  const scope = { projectId: proposal.projectId, workspaceId: proposal.workspaceId, goalId: proposal.goalRef.goalId };
  expect(await control.recordInitialDesignProposal(buildP115ProposalCommand(proposal, { commandId: 'proposal' }))).toMatchObject({ status: 'committed' });
  const pending = await queryHumanActions({ ledger }, scope);
  const before = pending.domains.find(d => d.domain === 'initial-design')!;
  expect(before).toMatchObject({ status: 'ready', records: [{ pendingHumanAction: true, status: 'ready' }] });
  // An unobserved domain prevents a universal "no pending matters" conclusion.
  expect(pending.domains.find(d => d.domain === 'rework')).toMatchObject({ status: 'unavailable' });
  expect(pending.pendingCount).toBeNull();
  const decision = buildP115Decision(proposal, { outcome });
  expect(await control.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: 'decision' }))).toMatchObject({ status: 'committed' });
  const after = await queryHumanActions({ ledger }, scope);
  const recorded = after.domains.find(d => d.domain === 'initial-design')!.records[0]!;
  expect(recorded.pendingHumanAction).toBe(false);
  expect(recorded.value).toMatchObject({ decisions: [{ outcome, authorizedTarget: { optionId: decision.authorizedTarget.optionId } }] });
  const observedDecision = (recorded.value as { decisions: JsonValue[] }).decisions[0]!;
  expect(queryFactAssertionMatches(observedDecision, { kind: 'decision_outcome', expected: outcome })).toBe(true);
  expect(queryFactAssertionMatches(observedDecision, { kind: 'selected_option', expected: decision.authorizedTarget.optionId })).toBe(outcome === 'accept');
  expect(after.version).not.toBe(pending.version);
  expect((await queryHumanActions({ ledger }, scope)).version).toBe(after.version);
});

it('does not turn an unknown Goal or a failed event read into an empty result', async () => {
  const ledger = new InMemoryLedger();
  const scope = { projectId: 'missing', workspaceId: 'workspace', goalId: 'goal' };
  expect(await queryHumanActions({ ledger }, scope)).toMatchObject({ status: 'not_found', pendingCount: null });
  await p111BootstrapGoalGovernance(ledger, 'proj-alpha');
  const failed = { load: ledger.load.bind(ledger), events: async () => { throw Error('storage offline'); } };
  expect(await queryHumanActions({ ledger: failed }, { projectId: 'proj-alpha', workspaceId: 'ws-shared', goalId: 'goal-1' })).toMatchObject({ status: 'failed', pendingCount: null });
});

it('does not publish an empty rework view captured against a different Plan', async () => {
  const ledger = new InMemoryLedger();
  await p111BootstrapGoalGovernance(ledger, 'proj-alpha');
  const scope = { projectId: 'proj-alpha', workspaceId: 'ws-shared', goalId: 'goal-1' };
  // Declared public read-port capture: the Goal has no active Plan; this view is old.
  const rework = emptyRework(scope, { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: 'old' });
  const result = await queryHumanActions({ ledger, rework, reworkWitness: { cursor: await humanActionCaptureCursor(ledger), verificationStable: true } }, scope);
  expect(result.domains.find(d => d.domain === 'rework')!.status).toBe('unavailable');
  expect(result.pendingCount).toBeNull();
});

it.each(['stable', 'commit-before-scan', 'verification-changed'] as const)('binds an empty rework capture across the producer/consumer boundary: %s', async mode => {
  const ledger = new InMemoryLedger();
  await p111BootstrapGoalGovernance(ledger, 'proj-alpha');
  const scope = { projectId: 'proj-alpha', workspaceId: 'ws-shared', goalId: 'goal-1' };
  const cursor = await humanActionCaptureCursor(ledger);
  const rework = emptyRework(scope, null);
  if (mode === 'commit-before-scan') {
    // Explicit boundary injection: the Plan stays null while canonical facts change.
    const control = createControlEngine({ ledger, now: () => planningAt, eventId: randomUUID });
    expect(await control.recordInitialDesignProposal(buildP115ProposalCommand(buildP115Proposal({ planRef: null }), { commandId: 'between-capture-and-scan' }))).toMatchObject({ status: 'committed' });
  }
  const result = await queryHumanActions({ ledger, rework, reworkWitness: { cursor, verificationStable: mode !== 'verification-changed' } }, scope);
  expect(result.domains.find(d => d.domain === 'rework')!.status).toBe(mode === 'stable' ? 'ready-empty' : 'unavailable');
  expect(result.pendingCount).toBe(mode === 'stable' ? 0 : null);
});

it('excludes a closed planning question instead of reviving its retained needs_decision answer', async () => {
  const s = await planningScenario(JSON.stringify({ kind: 'needs_decision', summary: 'Choose the supported interface.', questions: ['Which public interface is required?'] }));
  expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
  expect(await s.h.driveQuery({ reason: 'human-action-fixture' })).toMatchObject({ answered: 1 });
  const before = await queryHumanActions({ ledger: s.h.ledger }, planningScope);
  expect(before.domains.find(d => d.domain === 'initial-planning')!.records).toHaveLength(1);
  const snapshot = (await s.catalog.jobs(planningScope))[0]!;
  expect(await s.h.control.closeQueryJob({ commandType: 'CloseQueryJob', schemaVersion: 1, commandId: 'close', correlationId: 'close',
    submittedAt: planningAt, aggregateId: snapshot.ref.queryJobId, expectedRevision: snapshot.revision,
    identity: { projectId: planningScope.projectId, actor: { kind: 'human', id: 'user' }, idempotencyKey: 'close' },
    payload: { jobRef: snapshot.ref, runRef: snapshot.job.runRef!, reason: { code: 'cancelled', message: 'No longer requested' } } })).toMatchObject({ status: 'committed' });
  const after = await queryHumanActions({ ledger: s.h.ledger }, planningScope);
  expect(after.domains.find(d => d.domain === 'initial-planning')).toMatchObject({ status: 'ready-empty', records: [] });
  expect(after.version).not.toBe(before.version);
});

it('marks a feedback question stale when Workspace revision changes despite identical source and Plan', async () => {
  // Declared read-port fixture: isolates the revision condition from source hashing.
  const scope = { projectId: 'p', workspaceId: 'w', goalId: 'g' };
  const planRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan' };
  const goalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
  const jobRef = { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'w', queryJobId: 'q' };
  const runRef = { ...jobRef, aggregateType: 'QueryRun', runId: 'run' };
  const answerRef = { ...jobRef, aggregateType: 'QueryJobAnswer', answerId: 'a' };
  const job = { ...scope, queryJobId: 'q', status: 'answered', runRef, answerRefs: [answerRef], intent: { execution: {
    kind: 'execution_coordination', feedback: { planRef, workspaceRevision: 1 } } } };
  const answer = { queryJobRef: jobRef, runRef, stale: false, answeredAt: planningAt,
    answer: JSON.stringify({ kind: 'feedback_resolution', action: 'needs_decision', availability: 'available', summary: 'Choose behavior', material: 'The interface needs a choice', sourcePaths: ['rule.md'] }),
    sources: [{ kind: 'workspace_source', version: 'unchanged-source' }] };
  let workspaceRevision = 1;
  const ledger = { load: async (ref: { aggregateType: string }) => {
    const snapshot = ref.aggregateType === 'Goal' ? { ref: goalRef, revision: 1, workspaceRef: { workspaceId: 'w' }, activePlanRevision: planRef }
      : ref.aggregateType === 'Workspace' ? { ref: { aggregateType: 'Workspace', projectId: 'p', workspaceId: 'w' }, revision: workspaceRevision }
      : ref.aggregateType === 'QueryJob' ? { ref: jobRef, revision: 3, job }
      : ref.aggregateType === 'QueryJobAnswer' ? { ref: answerRef, revision: 1, answer } : null;
    return snapshot ? { status: 'found', snapshot } : { status: 'not_found' };
  }, events: async (request: { afterCursor: unknown }) => ({ hasMore: false, events: request.afterCursor ? [] : [{ cursor: makeCommitCursor(1), event: {
    eventType: 'QueryJobSubmitted', projectId: 'p', workspaceId: 'w', payload: { job } } }] }) };
  const read = () => queryHumanActions({ ledger: ledger as never, source: { sourceRevision: async () => 'unchanged-source' } }, scope);
  expect((await read()).domains.find(d => d.domain === 'execution-feedback')!.records[0]).toMatchObject({ status: 'ready', pendingHumanAction: true });
  workspaceRevision = 2;
  expect((await read()).domains.find(d => d.domain === 'execution-feedback')!.records[0]).toMatchObject({ status: 'stale', pendingHumanAction: null });
});

function feedbackQuestionObservation() {
  // Declared canonical read-port fixture. Admission/renewal authorization is
  // tested by its owners; this fixture exercises the human-action projection.
  const scope = { projectId: 'p', workspaceId: 'w', goalId: 'g' };
  const goalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
  const planRef = { aggregateType: 'PlanRevision' as const, projectId: 'p', planId: 'plan' };
  const snapshots = new Map<string, unknown>();
  const events: unknown[] = [];
  const question = (id: string, supersedesQueryJobId?: string, status = 'answered') => {
    const ref = { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'w', queryJobId: id };
    const runRef = { ...ref, aggregateType: 'QueryRun', runId: id };
    const answerRef = { ...ref, aggregateType: 'QueryJobAnswer', answerId: id + '-answer' };
    const job = { ...scope, queryJobId: id, status, runRef, answerRefs: status === 'answered' ? [answerRef] : [], intent: { execution: {
      kind: 'execution_coordination', feedback: { planRef, workspaceRevision: 1, supersedesQueryJobId,
        runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'producer' }, taskId: 'work' } } } };
    const answer = { queryJobRef: ref, runRef, stale: false, answeredAt: planningAt,
      answer: JSON.stringify({ kind: 'feedback_resolution', action: 'needs_decision', availability: 'available', summary: id + ' choice', material: 'Choose the supported interface', sourcePaths: ['rule.md'] }),
      sources: [{ kind: 'workspace_source', version: 'current-source' }] };
    snapshots.set(canonicalJson(ref), { ref, revision: 3, job });
    snapshots.set(canonicalJson(answerRef), { ref: answerRef, revision: 1, answer });
    events.push({ eventType: 'QueryJobSubmitted', projectId: 'p', workspaceId: 'w', payload: { job } });
    return { ref, job, answerRef, answer };
  };
  snapshots.set(canonicalJson(goalRef), { ref: goalRef, revision: 1, workspaceRef: { workspaceId: 'w' }, activePlanRevision: planRef });
  const workspaceRef = { aggregateType: 'Workspace', projectId: 'p', workspaceId: 'w' };
  snapshots.set(canonicalJson(workspaceRef), { ref: workspaceRef, revision: 1 });
  const ledger = { load: async (ref: JsonValue) => {
    const snapshot = snapshots.get(canonicalJson(ref)); return snapshot ? { status: 'found', snapshot } : { status: 'not_found' };
  }, events: async (request: { afterCursor: unknown }) => ({ hasMore: false,
    events: request.afterCursor ? [] : events.map((event, i) => ({ event, cursor: makeCommitCursor(i + 1) })) }) };
  const read = async () => queryHumanActions({ ledger: ledger as never,
    source: { sourceRevision: async () => 'current-source' }, rework: emptyRework(scope, planRef),
    reworkWitness: { cursor: await humanActionCaptureCursor(ledger as never), verificationStable: true } }, scope);
  return { question, read, events, goalRef };
}

it.each(['pending', 'answered'])('excludes a superseded feedback question while retaining unrelated questions and the %s replacement', async status => {
  const f = feedbackQuestionObservation();
  const old = f.question('old'), unrelated = f.question('unrelated');
  const before = await f.read();
  expect(before.pendingCount).toBe(2);
  const oldBytes = JSON.stringify(old);
  const replacement = f.question('replacement', 'old', status);
  const after = await f.read();
  const rows = after.domains.find(d => d.domain === 'execution-feedback')!.records;
  expect(rows.map(row => row.ref)).toEqual(status === 'answered' ? [replacement.answerRef, unrelated.answerRef] : [unrelated.answerRef]);
  expect(rows.every(row => row.status === 'ready' && row.pendingHumanAction === true)).toBe(true);
  expect(after.pendingCount).toBe(status === 'answered' ? 2 : 1);
  expect(after.version).not.toBe(before.version);
  expect((await f.read()).version).toBe(after.version);
  expect(JSON.stringify(old)).toBe(oldBytes);
});

it.each(['matching-id', 'other-id', 'other-goal'])('does not infer resolved feedback from an unverified human decision: %s', async mode => {
  const f = feedbackQuestionObservation(), q = f.question('question');
  const before = await f.read();
  expect(before.pendingCount).toBe(1);
  const decision = { decisionId: mode === 'other-id' ? 'unrelated-decision' : 'feedback-choice-' + sha256Hex(canonicalJson(q.answerRef)).slice(0, 32) + '-decision',
    subject: { goalRef: mode === 'other-goal' ? { ...f.goalRef, goalId: 'other' } : f.goalRef },
    outcome: 'accept', summary: 'Accepted, but no exact question/option binding is supplied.' };
  f.events.push({ eventType: 'UserDecisionRecorded', projectId: 'p', workspaceId: 'w', payload: { decision } });
  const after = await f.read(), rows = after.domains.find(d => d.domain === 'execution-feedback')!.records;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ ref: q.answerRef, status: mode === 'matching-id' ? 'unavailable' : 'ready',
    pendingHumanAction: mode === 'matching-id' ? null : true,
    value: { decisions: mode === 'matching-id' ? [decision] : [] } });
  expect(after.pendingCount).toBe(mode === 'matching-id' ? null : 1);
  expect(after.status).toBe(mode === 'matching-id' ? 'unavailable' : 'ready');
  if (mode === 'matching-id') expect(after.version).not.toBe(before.version);
  else expect(after.version).toBe(before.version);
});
