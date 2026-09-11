import { expect, it } from 'vitest';
import { LeasedWorkerRuntime } from '/mnt/d/1.project/Software/agent_platform/src/control/leased-worker-runtime.js';
import { buildEnvelopeFixture } from '/mnt/d/1.project/Software/agent_platform/src/contracts/fixtures/dispatch-fixtures.js';

const scope = { projectId: 'p1', workspaceId: 'w1', goalId: 'g1' };
const runId = 'review-run-1', attemptId = 'review-attempt-1';

function envelopeFor() {
  const base = buildEnvelopeFixture({ ...scope, envelopeId: 'env-1', runId, attemptId, workspaceRevision: 1,
    planRef: { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: 'plan-1' },
    bundleRef: { kind: 'artifact', contentType: 'application/json', digest: 'a'.repeat(64), sizeBytes: 2 },
    budget: { tokenBudget: 1000, deadline: null } });
  return { ...base, permissions: { policyRevision: base.roleBinding.policyRevision, tools: ['read'], writeScope: [] },
    work: { kind: 'review' as const, reviewWorkRef: { aggregateType: 'ReviewWork' as const, projectId: scope.projectId, goalId: scope.goalId, taskId: 't1', planId: 'plan-1', reviewId: 'review-1' } },
    reviewInput: { packetRef: { kind: 'artifact' as const, contentType: 'application/json', digest: 'b'.repeat(64), sizeBytes: 2 }, packetDigest: 'b'.repeat(64), inputDigest: 'c'.repeat(64), descriptorDigest: 'd'.repeat(64), grantRefs: [] } };
}

function build(options: { leaseOutcome: 'committed' | 'rejected'; materialsThrow?: boolean }) {
  const calls: string[] = [];
  const spec = { ...scope, runId, taskId: 't1', root: '/tmp/x', mode: 'review' as const,
    review: { workRef: envelopeFor().work.reviewWorkRef, profile: { profileId: 'x' } }, instruction: 'i',
    budget: { contextWindowTokens: 1000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 100 } };
  const runtime = {
    all: () => [{ spec, status: 'prepared' }],
    capabilities: async () => ({ replayable: false, supportsSnapshot: false, maxEnvelopeBytes: 65536 }),
    start: async () => { calls.push('runtime.start'); return { runRef: { aggregateType: 'Run', ...scope, runId }, pollFreshEvents: async () => [] }; },
    rejectBeforeStart: async () => { calls.push('rejectBeforeStart'); return { runRef: { aggregateType: 'Run', ...scope, runId }, pollFreshEvents: async () => [] }; },
  };
  const lease = { acquireReadLease: async () => options.leaseOutcome === 'committed' ? { status: 'committed' } : { status: 'rejected', code: 'read_lease_conflict' },
    acquireWriteLease: async () => ({ status: 'rejected', code: 'write_lease_conflict' }),
    releaseLease: async () => { calls.push('releaseLease'); return { status: 'committed' }; } };
  const leased = new LeasedWorkerRuntime({ runtime: runtime as never, lease: () => lease as never,
    vault: () => ({}) as never, materials: async () => undefined,
    reviewerMaterials: async () => { calls.push('reviewerMaterials'); if (options.materialsThrow) throw Error('材料组装失败'); return {} as never; },
    now: () => '2026-09-10T00:00:00.000Z' });
  return { leased, calls };
}

it('LEASE-REFUSAL (product defect evidence): refused read lease throws and never calls rejectBeforeStart', async () => {
  const { leased, calls } = build({ leaseOutcome: 'rejected' });
  await expect(leased.start(envelopeFor() as never)).rejects.toThrow(/租约被拒绝/);
  expect(calls).toEqual([]);
  console.log('LEASE-REFUSAL calls=' + JSON.stringify(calls));
});

it('CONTRAST (mechanism exists): material assembly failure does use rejectBeforeStart', async () => {
  const { leased, calls } = build({ leaseOutcome: 'committed', materialsThrow: true });
  await leased.start(envelopeFor() as never);
  expect(calls).toEqual(['reviewerMaterials', 'releaseLease', 'rejectBeforeStart']);
  console.log('CONTRAST calls=' + JSON.stringify(calls));
});
