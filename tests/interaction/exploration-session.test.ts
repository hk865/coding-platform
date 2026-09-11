import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExplorationSession } from '../../src/interaction/human-collaboration/exploration-session.js';
import { ExplorationSessionContextCompiler } from '../../src/data/context-compiler/exploration-session-context.js';
import { ArtifactVault } from '../../src/data/artifact-vault/artifact-vault.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { ExplorationSessionDeps, ExplorationRunObservation } from '../../src/contracts/exploration-session.js';
import type { ExplorationPlan, ExplorationReport } from '../../src/contracts/exploration.js';
import type { StateLedger } from '../../src/contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const scope = { projectId: 'project', workspaceId: 'workspace', goalId: 'goal' };
const planRef = { aggregateType: 'PlanRevision' as const, projectId: scope.projectId, planId: 'plan' };
// These ports read only the accepted plan reference, not its graph or proposal command.
const plan = { ref: planRef } as PlanRevisionSnapshot;
const manifest = {
  ...scope,
  planOrigin: 'operator',
  planId: 'plan',
  requestId: 'plan-request',
  tasks: [{ taskId: 'inventory', title: 'Inventory', instruction: 'Read source', dependsOn: [] }],
  gateTaskId: 'gate-goal',
  sourceDigest: 'a'.repeat(64),
  createdAt: '2026-09-09T00:00:00.000Z',
  fingerprint: 'manifest',
  status: 'accepted'
} as unknown as ExplorationPlan;
const spec = {
  ...scope,
  runId: 'real-explore-request',
  taskId: 'inventory',
  root: '/source',
  instruction: 'the original immutable instruction',
  budget: DEFAULT_RUNTIME_BUDGET,
  mode: 'explore' as const
};
const record: ExplorationRunObservation = { spec, status: 'completed', trace: [], events: [] };
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'exploration-session-'));
  directories.push(directory);
  const vault = new ArtifactVault();
  const stored = await vault.put({
    body: 'qualified report',
    contentType: 'text/plain',
    ownerRef: { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: spec.runId },
    sourceRefs: [{ kind: 'workspace', refId: scope.workspaceId, revision: '1', digest: manifest.sourceDigest }],
    requestedAt: manifest.createdAt
  });
  if (stored.status !== 'stored')
    throw Error('test artifact storage failed');
  const report: ExplorationReport = {
    ...scope,
    runId: spec.runId,
    taskId: spec.taskId,
    report: 'qualified report',
    reportDigest: 'b'.repeat(64),
    sourceDigest: manifest.sourceDigest,
    workspaceRevision: 1,
    planRef,
    completedAt: manifest.createdAt,
    artifactRef: stored.ref,
    sourceReads: [{ path: 'README.md', startLine: 1, endLine: 2, revision: 'c'.repeat(64), callId: 'read-1' }]
  };
  const unavailable = vi.fn(async (): Promise<never> => {
    throw Error('unexpected operation');
  });
  const assertSource = vi.fn(async () => { });
  const capture = vi.fn(async () => report);
  const applyReview = vi.fn(async () => ({
    status: 'applied' as const,
    taskPhase: 'satisfied',
    goalPhase: 'READY',
    evidenceIds: ['evidence']
  }));
  const deps: ExplorationSessionDeps = {
    directory,
    vault,
    planning: {
      init: async () => { },
      plan: () => manifest,
      acceptedPlans: () => [manifest],
      exploration: unavailable,
      ensureTaskPlan: unavailable
    },
    context: {
      current: async () => ({ manifest, plan, workspaceRevision: 1, root: '/source' }),
      compileRunSpec: () => ({ ...spec, instruction: 'new current material that must not replace a replayed spec' }),
      assertSource,
      run: unavailable,
      record: () => record,
      completedRuns: async () => [],
      replaySpec: async () => null,
      taskPhase: unavailable
    },
    verification: { capture, reportArtifact: async () => stored.ref, satisfiedReports: unavailable },
    recordedVerification: { exploration: applyReview, benchmark: unavailable },
    contextDrive: { prerequisites: () => [] },
    startup: { reconcile: async () => { } },
    control: { dispatchReadiness: unavailable }
  };
  return { deps, report, capture, applyReview, assertSource, unavailable };
}
it(
  'returns the original recorded spec on replay without preparing or checking current dispatch readiness',
  async () => {
    const fixture = await setup();
    fixture.deps.context.replaySpec = async () => ({ spec: structuredClone(spec), existing: 'ended' });
    const session = new ExplorationSession(fixture.deps);
    await session.init();
    expect(await session.prepareRun(scope, { requestId: 'request', taskId: 'inventory' }, DEFAULT_RUNTIME_BUDGET))
      .toEqual({ spec, existing: 'ended', requestId: 'request' });
    expect(fixture.assertSource).not.toHaveBeenCalled();
    expect(fixture.unavailable).not.toHaveBeenCalled();
  }
);
it(
  'recovers a pending human review from the existing JSON identity and never recaptures or replaces its report',
  async () => {
    const fixture = await setup();
    fixture.applyReview.mockRejectedValueOnce(Error('control unavailable after durable review'));
    const session = new ExplorationSession(fixture.deps);
    await session.init();
    const input = {
      requestId: 'review-request',
      taskId: 'inventory',
      runId: spec.runId,
      reviewVerdict: 'PASS',
      reviewOrigin: 'operator',
      reviewText: 'Checked the cited source lines'
    };
    await expect(session.review(scope, input)).rejects.toThrow('control unavailable');
    const names = await readdir(fixture.deps.directory);
    const reviewFile = names.find(name => name.startsWith('review-'))!;
    const saved = JSON.parse(await readFile(join(fixture.deps.directory, reviewFile), 'utf8'));
    expect(saved.control.status).toBe('pending');
    const restored = new ExplorationSession(fixture.deps);
    await restored.init();
    const replay = await restored.review(scope, input);
    expect(replay).toMatchObject({
      replayed: true,
      review: { reviewId: saved.reviewId, fingerprint: saved.fingerprint, control: { status: 'applied' } }
    });
    expect(fixture.capture).toHaveBeenCalledTimes(1);
    expect(fixture.applyReview).toHaveBeenCalledTimes(2);
    expect((await readdir(fixture.deps.directory)).sort()).toEqual(names.sort());
    await expect(restored.review(scope, { ...input, reviewVerdict: 'FAIL' })).rejects.toThrow('同一审阅请求材料已改变');
  }
);
it(
  'rejects a foreign exploration manifest before reading canonical state',
  async () => {
    const load = vi.fn(async (): Promise<never> => {
      throw Error('unexpected ledger read');
    });
    const context = new ExplorationSessionContextCompiler({
      ledger: { load } as unknown as StateLedger,
      runtime: { all: () => [] },
      rootFor: () => '/source'
    });
    await expect(context.current(scope, { ...manifest, goalId: 'foreign' })).rejects.toThrow('清单作用域不匹配');
    expect(load).not.toHaveBeenCalled();
  }
);
