import { expect, it } from 'vitest';
import { createQueryFactTool } from '../../src/execution/worker-runtime/query-fact-tool.js';
import type { QueryApplicabilityAuthority } from '../../src/contracts/query-quality-facts.js';

it.each(['recordVersion', 'observationVersion'] as const)('rejects publication when applicability %s changes even though its status does not', async field => {
  const authority: QueryApplicabilityAuthority = {
    family: 'verification-applicability', scope: { projectId: 'p', workspaceId: 'w', goalId: 'g' },
    observationVersion: '3'.repeat(64), observedAt: '2026-09-16T00:00:00Z',
    recordPointer: '/material/verificationStages/rounds/0', recordKind: 'tool-round',
    recordId: 'round-1', recordVersion: 'revision-1', recordedAt: '2026-09-16T00:00:00Z',
  };
  const pointer = '/material/verificationStages/rounds/0/applicability';
  const port = createQueryFactTool(async () => ({ status: 'ready', inputDigest: '1'.repeat(64), pointer,
    observation: 'captured_query_input', sourceBundle: { digest: '2'.repeat(64) },
    value: { status: 'stale', identity: null, issues: ['Source changed'] }, applicabilityAuthority: structuredClone(authority),
  }), { requireAssertions: true });
  const result = await port.tool.handler.execute({ callId: 'read', arguments: { pointer,
    assertion: { kind: 'source_applicability', expected: 'stale' } } } as never, { signal: new AbortController().signal } as never);
  expect(result.status).toBe('success');
  const stable = await port.sources('该轮次的源码适用性已过期。[F1]');
  expect(JSON.parse(stable[0]!.refKey).applicabilityAuthority).toEqual(authority);
  authority[field] = field === 'observationVersion' ? '4'.repeat(64) : 'revision-2';
  await expect(port.sources('该轮次的源码适用性已过期。[F1]')).rejects.toThrow('no longer available');
});

async function check(value: unknown, assertion?: { kind: string; expected: string }, pointer = '/material/architectureReviews') {
  const fact = { status: 'ready' as const, inputDigest: '1'.repeat(64), pointer, observation: 'captured_query_input' as const, sourceBundle: { digest: '2'.repeat(64) }, value };
  const port = (createQueryFactTool as any)(async () => structuredClone(fact), { requireAssertions: true });
  const result = await port.tool.handler.execute({ callId: 'read', arguments: { pointer, ...(assertion ? { assertion } : {}) } }, { signal: new AbortController().signal });
  return { port, result };
}

const runFact = (status = 'running', outcome: string | null = null) => ({
  ref: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' }, revision: 2,
  status, outcome, startedAt: '2026-09-16T00:00:00Z', endedAt: status === 'ended' ? '2026-09-16T00:01:00Z' : null,
  planRef: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan' }, matchesCurrentPlan: true,
});

it('cannot publish human-action availability as source applicability', async () => {
  const value = { object: 'pending-human-items', status: 'unavailable', scope: { projectId: 'p', workspaceId: 'w', goalId: 'g' },
    applicabilityAuthority: { family: 'verification-applicability', recordId: 'forged-in-value' },
    version: '3'.repeat(64), observedAt: '2026-09-16T00:00:00Z', pendingCount: null, domains: [], issues: ['Rework observation unavailable'] };
  const { port, result } = await check(value, { kind: 'source_applicability', expected: 'unavailable' }, '/material/humanActions');
  expect(result.status).toBe('error');
  expect(result.output[0].value.marker).toBeUndefined();
  expect(result.output[0].value.supportedAssertions).toContainEqual({ kind: 'observation_status', expected: 'unavailable' });
  await expect(port.sources('Current source applicability is unavailable [F1]')).rejects.toThrow('not read');
});

it.each([['starting', null], ['running', null], ['ended', 'completed'], ['ended', 'outcome_unknown']] as const)('can cite an actual Run %s/%s without claiming Task acceptance', async (status, outcome) => {
  const { port, result } = await check(runFact(status, outcome), { kind: 'run_status', expected: status }, '/material/collaborationWork/0/latestRun');
  expect(result.status).toBe('success');
  expect(JSON.parse((await port.sources('Recorded Run status [F1]'))[0].refKey).assertion).toEqual({ kind: 'run_status', expected: status });
  if (outcome) {
    const terminal = await check(runFact(status, outcome), { kind: 'run_outcome', expected: outcome }, '/material/collaborationWork/0/latestRun');
    expect(terminal.result.status).toBe('success');
    expect(JSON.parse((await terminal.port.sources('Recorded Run outcome [F1]'))[0].refKey).assertion).toEqual({ kind: 'run_outcome', expected: outcome });
  }
  expect((await check(runFact(status, outcome), { kind: 'task_phase', expected: 'satisfied' })).result.status).toBe('error');
});

it.each([
  [runFact('ended', 'outcome_unknown'), { kind: 'run_outcome', expected: 'completed' }],
  [runFact('running', 'completed'), { kind: 'run_outcome', expected: 'completed' }],
  [{ ...runFact(), ref: { aggregateType: 'TaskReduction', projectId: 'p', goalId: 'g', taskId: 't' } }, { kind: 'run_status', expected: 'running' }],
  [{ ...runFact(), revision: -1 }, { kind: 'run_status', expected: 'running' }],
] as const)('rejects a mismatched or unbound Run assertion: %j', async (value, assertion) => {
  expect((await check(value, assertion, '/material/collaborationWork/0/latestRun')).result.status).toBe('error');
});

it('offers supported assertions without assigning a publishable marker to an unchecked high-risk read', async () => {
  const { port, result } = await check(runFact(), undefined, '/material/collaborationWork/0/latestRun');
  const value = result.output[0].value;
  expect(value).toMatchObject({ status: 'ready', assertionRequired: true, supportedAssertions: [{ kind: 'run_status', expected: 'running' }] });
  expect(value.marker).toBeUndefined();
  await expect(port.sources('Invented marker [F1]')).rejects.toThrow('not read');
  const checked = await port.tool.handler.execute({ callId: 'declare', arguments: { pointer: value.pointer, assertion: value.supportedAssertions[0] } }, { signal: new AbortController().signal });
  expect(checked.output[0].value.marker).toBe('F1');
  expect(await port.sources('Recorded Run status [F1]')).toHaveLength(1);
});

it('still rejects revoked material that was read without receiving a citation marker', async () => {
  let revoked = false;
  const port = createQueryFactTool(async pointer => revoked ? { status: 'stale', message: 'Permission changed' } : {
    status: 'ready', inputDigest: '1'.repeat(64), pointer, observation: 'captured_query_input', sourceBundle: { digest: '2'.repeat(64) }, value: runFact(),
  }, { requireAssertions: true });
  const result = await port.tool.handler.execute({ callId: 'read', arguments: { pointer: '/material/collaborationWork/0/latestRun' } } as never, { signal: new AbortController().signal } as never);
  expect((result.output[0] as any).value.marker).toBeUndefined();
  revoked = true;
  await expect(port.sources('A response omitting all fact markers.')).rejects.toThrow('no longer available');
});

it.each([
  [{ status: 'unavailable' }, { kind: 'observation_status', expected: 'ready-empty' }],
  [{ status: 'ready', rows: [] }, { kind: 'observation_status', expected: 'ready-empty' }],
  [{ ref: { aggregateType: 'GoalPhase' }, phase: 'COMPLETED' }, { kind: 'goal_phase', expected: 'COMPLETED' }],
  [{ ref: { aggregateType: 'GoalPhase' }, phase: 'BLOCKED' }, { kind: 'goal_phase', expected: 'COMPLETED' }],
  [{ status: 'ready', outcome: 'accept', record: { outcome: 'accept' } }, { kind: 'selected_option', expected: 'A' }],
  [{ proposalRef: { aggregateType: 'InitialDesignProposal' }, outcome: 'accept', authorizedTarget: { optionId: 'A' } }, { kind: 'selected_option', expected: 'A' }],
  [{ status: 'ready', applicability: { status: 'stale', identity: { sourceDigest: 'old' } } }, { kind: 'source_applicability', expected: 'ready' }],
  [{ status: 'ready', pendingHumanAction: true }, { kind: 'pending_human_action', expected: 'true' }],
  [{ status: 'unavailable', pendingHumanAction: null }, { kind: 'pending_human_action', expected: 'false' }],
] as const)('checks the declared structured assertion against the actual record: %j %j', async (value, assertion) => {
  const { result } = await check(value, assertion);
  const valid = (assertion.kind === 'observation_status' && 'rows' in value)
    || (assertion.kind === 'goal_phase' && 'phase' in value && value.phase === 'COMPLETED')
    || (assertion.kind === 'selected_option' && 'authorizedTarget' in value)
    || (assertion.kind === 'pending_human_action' && 'pendingHumanAction' in value && value.pendingHumanAction === true);
  expect(result.status).toBe(valid ? 'success' : 'error');
});

it('refuses to publish an unchecked high-risk citation in the new protocol', async () => {
  const { port, result } = await check({ status: 'unavailable' });
  expect(result.status).toBe('success');
  expect(result.output[0].value.marker).toBeUndefined();
  await expect(port.sources('There are no decisions. [F1]')).rejects.toThrow('not read');
});

it('persists the validated assertion while explicitly limiting it to structured state', async () => {
  const { port } = await check({ status: 'unavailable' }, { kind: 'observation_status', expected: 'unavailable' });
  const sources = await port.sources('Decision records cannot currently be read. [F1]');
  expect(JSON.parse(sources[0].refKey)).toMatchObject({ assertion: { kind: 'observation_status', expected: 'unavailable' }, check: 'structured-state-only' });
});

it.each([
  ['/material/architectureReviews/rows/0/decisionFacts', { acceptedProposal: {}, selectedCandidate: {}, activatedBaseline: {} }],
  ['/material/verificationStages/reviews/0/formal', { taskPhase: 'failed', goalPhase: null, evidenceRefs: [] }],
  ['/material/architectureReviews/rows/0/decisionFacts/selectedCandidate/proposalSelection', { authority: 'proposal-author', optionId: 'A' }],
] as const)('requires a checked assertion for the known high-risk location %s', async (pointer, value) => {
  const { port } = await check(value, undefined, pointer);
  await expect(port.sources('A claim about this state. [F1]')).rejects.toThrow('not read');
});
