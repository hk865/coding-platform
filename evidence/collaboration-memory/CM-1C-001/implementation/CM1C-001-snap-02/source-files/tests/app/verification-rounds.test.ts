import { afterEach, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { VerificationRegisteredCheck, VerificationRoundResult, VerificationRoundView } from '../../src/contracts/verification-round.js';
import type { VerificationRequestV1, VerificationResultV1 } from '../../src/contracts/verification.js';
import { verificationRoundFixture as createRoundFixture } from './verification-round-fixture.js';
import { createGuiServer } from '../../src/app/server.js';

const cleanup: Array<() => Promise<void>> = [];
const verificationRoundFixture = (disposers: typeof cleanup, reviewerRequired = false) => createRoundFixture(disposers, reviewerRequired, createGuiServer);
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type Fixture = Awaited<ReturnType<typeof verificationRoundFixture>>;
const scopeFor = (fixture: Fixture) => ({ ...fixture.scope, runId: fixture.runId, taskId: fixture.taskId });
const check = (fixture: Fixture, checkId: string, command: string): VerificationRegisteredCheck => ({
  checkId, kind: 'dynamic', command, cwd: '.', timeoutMs: 3000,
  appliesTo: { workspaceId: fixture.scope.workspaceId, taskIds: [fixture.taskId] },
});
const start = (fixture: Fixture, requestId: string, checks: VerificationRegisteredCheck[]) => fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', {
  ...scopeFor(fixture), requestId, allowExecute: true, configuration: { checks },
});
const read = (fixture: Fixture, requestId: string) => fixture.post<VerificationRoundView>('/api/real/verifications/rounds/read', { ...scopeFor(fixture), requestId });

it('real HTTP executes each registered check once and a later PASS cannot erase the same requirement FAIL; reopens exact reports', async () => {
  const fixture = await verificationRoundFixture(cleanup);
  const definitions = [
    check(fixture, 'a-fail', "mkdir -p .cache; printf 'failed\\n' >> .cache/check-runs; exit 1"),
    check(fixture, 'b-pass', "printf 'passed\\n' >> .cache/check-runs; test \"$(cat subject.txt)\" = expected"),
  ];
  const first = await start(fixture, 'fail-then-pass', definitions);
  expect(first.status).toBe(200);
  expect(first.body.round.outcome).toBe('FAIL');
  expect(first.body.round.checks).toHaveLength(2);
  expect(first.body.round.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reviewer', result: null })]));
  expect(first.body.round.coverage.filter(value => value.kind === 'dynamic')).toEqual(expect.arrayContaining([
    expect.objectContaining({ checkIds: ['a-fail', 'b-pass'], result: 'FAIL' }),
  ]));
  expect(first.body.round.aggregate?.admissions).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'admitted', coverage: expect.objectContaining({ result: 'FAIL' }) })]));
  expect(first.body.round.control.taskPhase).not.toBe('satisfied');
  const commandsBefore = await readFile(join(fixture.root, '.cache/check-runs'), 'utf8');
  expect(commandsBefore).toBe('failed\npassed\n');
  const callsBefore = fixture.modelRequests();
  await fixture.restart();
  const replay = await start(fixture, 'fail-then-pass', definitions);
  expect(replay.status).toBe(200);
  expect(replay.body).toMatchObject({ replayed: true, round: { roundId: first.body.round.roundId, outcome: 'FAIL' } });
  expect(await readFile(join(fixture.root, '.cache/check-runs'), 'utf8')).toBe(commandsBefore);
  expect(fixture.modelRequests()).toBe(callsBefore);
  expect((await start(fixture, 'fail-then-pass', [check(fixture, 'a-fail', 'exit 0')])).status).toBe(400);
  const child = first.body.round.checks[0]!;
  const digest = child.record?.progress?.phase === 'report_stored' ? child.record.progress.artifactRef.digest : '';
  expect(digest).not.toBe('');
  expect((await fixture.post('/api/real/verifications/check-evidence', { ...scopeFor(fixture), requestId: child.requestId, reportDigest: digest })).status).toBe(400);
  const report = await fixture.post<{ reports: unknown[] }>('/api/real/verifications/check-report', { ...scopeFor(fixture), requestId: child.requestId });
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  expect(report.body.reports).toEqual(expect.arrayContaining([expect.objectContaining({ result: 'FAIL', effects: 'known' })]));
}, 60000);

it('rejects a corrupted original SQLite report through HTTP after restart without replacing historical Evidence', async () => {
  const fixture = await verificationRoundFixture(cleanup);
  const definitions = [check(fixture, 'stored-report', "mkdir -p .cache; printf 'once\\n' >> .cache/corruption-runs; exit 1")];
  const original = (await start(fixture, 'corruption-history', definitions)).body.round;
  expect(original.status).toBe('completed');
  const child = original.checks[0]!;
  const progress = child.record?.progress;
  if (progress?.phase !== 'report_stored') throw Error('Expected a real stored command report');
  const database = new DatabaseSync(join(fixture.data, 'projects', encodeURIComponent(fixture.scope.projectId), 'artifacts.sqlite'));
  try {
    const changed = database.prepare("UPDATE artifacts SET record = json_set(record, '$.body', 'corrupted original command body') WHERE json_extract(record, '$.ref.digest') = ?").run(progress.artifactRef.digest);
    expect(changed.changes).toBe(1);
  } finally { database.close(); }
  await fixture.restart();
  expect((await fixture.post('/api/real/verifications/check-report', { ...scopeFor(fixture), requestId: child.requestId })).status).toBe(400);
  const replay = await start(fixture, 'corruption-history', definitions);
  expect(replay.status).toBe(200);
  expect(replay.body.replayed).toBe(true);
  expect(replay.body.round.current.status).toBe('stale');
  expect(replay.body.round.current.issues.join(' ')).toContain('报告不可读取');
  expect(replay.body.round.aggregate).toEqual(original.aggregate);
  expect(replay.body.round.outcome).toBe('FAIL');
  expect(await readFile(join(fixture.root, '.cache/corruption-runs'), 'utf8')).toBe('once\n');
}, 60000);

it('serves persisted progress and receipts while a real check is still executing', async () => {
  const fixture = await verificationRoundFixture(cleanup);
  await mkdir(join(fixture.root, '.cache'));
  const definition = { ...check(fixture, 'waiting-tool', 'touch .cache/started; while ! test -f .cache/release; do sleep 0.05; done'), timeoutMs: 20000 };
  const pending = start(fixture, 'visible-progress', [definition]);
  let reopening: Promise<void> | undefined;
  try {
    await expect.poll(() => readFile(join(fixture.root, '.cache/started'), 'utf8').then(() => true, () => false), { timeout: 10000 }).toBe(true);
    const responses = Promise.all([
      fixture.post('/api/receipts', { ...fixture.scope, requestId: 'visible-progress', kind: 'verification-round' }),
      read(fixture, 'visible-progress'), fixture.state(),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([responses, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Progress reads waited for command completion')), 5000); })]).finally(() => clearTimeout(timer));
    expect(result[0]).toMatchObject({ status: 200, body: { found: true, round: { status: 'running' } } });
    expect(result[1].body.checks[0]?.record?.progress?.phase).toBe('executing');
    expect(result[2].liveRuns[0]?.rounds).toEqual(expect.arrayContaining([expect.objectContaining({ requestId: 'visible-progress', status: 'running' })]));
    // Closing an active host must await the command/report lifecycle. The next
    // host reads the completed record, rather than an abandoned SQLite write.
    reopening = fixture.restart();
  } finally {
    await writeFile(join(fixture.root, '.cache/release'), 'release');
    await pending;
    await reopening;
  }
  expect((await read(fixture, 'visible-progress')).body.status).toBe('completed');
}, 60000);

it('the formal VerificationPort executes the same durable round and cannot trust caller no-change claims or complete a new manual Plan', async () => {
  const fixture = await verificationRoundFixture(cleanup);
  const state = await fixture.state();
  if (state.graph.status !== 'ready') throw Error('Expected a real accepted Plan');
  const request: VerificationRequestV1 = {
    schemaVersion: 1, requestId: 'formal-verification', projectId: fixture.scope.projectId,
    goalId: fixture.scope.goalId, taskId: fixture.taskId,
    planRef: { aggregateType: 'PlanRevision', projectId: fixture.scope.projectId, planId: state.graph.graph.planRef.planId },
    changeScope: { diffClass: 'docs-only', changedFiles: [], writeSummary: 'Untrusted caller claims no changes.' },
    semanticChange: 'none', risks: [],
  };
  const endpoint = '/api/real/verifications/verify';
  expect(await fixture.post(endpoint, { ...fixture.scope, ...request })).toMatchObject({ status: 200, body: { status: 'incomplete' } });
  const configuration = { checks: [check(fixture, 'formal-tool', "mkdir -p .cache; printf 'executed\\n' >> .cache/formal-runs; test \"$(cat subject.txt)\" = expected")] };
  const input = { ...fixture.scope, ...request, round: { workspaceId: fixture.scope.workspaceId, runId: fixture.runId, configuration, allowExecute: true } };
  expect(await fixture.post(endpoint, { ...input, maxChecks: 0 })).toMatchObject({ status: 200, body: { status: 'rejected', code: 'budget_exhausted' } });
  const result = await fixture.post<VerificationResultV1>(endpoint, input);
  expect(result).toMatchObject({ status: 200, body: { status: 'ready', observations: [expect.objectContaining({ result: 'PASS' })] } });
  const round = (await read(fixture, request.requestId)).body;
  expect(round.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reviewer', result: null })]));
  expect(round.outcome).toBe('INCONCLUSIVE');
  expect(round.control.taskPhase).not.toBe('satisfied');
  expect(round.control.goalPhase).not.toBe('COMPLETED');
  expect(round.plan?.semanticChange).toBe('semantic');
  await fixture.restart();
  expect((await fixture.post(endpoint, input)).body).toEqual(result.body);
  expect(await readFile(join(fixture.root, '.cache/formal-runs'), 'utf8')).toBe('executed\n');
}, 60000);

it('accepted Reviewer obligations remain unmet after all tools PASS, and source edits make the old round stale without deleting reports', async () => {
  const fixture = await verificationRoundFixture(cleanup, true);
  const definitions = [check(fixture, 'behavior', 'test "$(cat subject.txt)" = expected')];
  const result = await start(fixture, 'review-required', definitions);
  expect(result.status).toBe(200);
  expect(result.body.round.checks[0]?.record?.result).toMatchObject({ status: 'ready', observations: [expect.objectContaining({ result: 'PASS' })] });
  expect(result.body.round.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reviewer', result: null })]));
  expect(result.body.round.gaps.length).toBeGreaterThan(0);
  expect(result.body.round.control.taskPhase).not.toBe('satisfied');
  expect(result.body.round.control.goalPhase).not.toBe('COMPLETED');
  const receipt = await fixture.post<{ found: boolean; round: { runId: string; taskId: string } }>('/api/receipts', { ...fixture.scope, requestId: 'review-required', kind: 'verification-round' });
  expect(receipt).toMatchObject({ status: 200, body: { found: true, round: { runId: fixture.runId, taskId: fixture.taskId } } });
  await writeFile(join(fixture.root, 'subject.txt'), 'changed externally\n');
  const stale = await read(fixture, 'review-required');
  expect(stale.status).toBe(200);
  expect(stale.body.current.status).toBe('stale');
  expect(stale.body.aggregate?.artifactRef).toEqual(result.body.round.aggregate?.artifactRef);
  const newer = await start(fixture, 'changed-source', definitions);
  expect(newer.status).toBe(200);
  expect(newer.body.round.status, JSON.stringify(newer.body.round.gaps)).toBe('completed');
  expect(newer.body.round.materialIdentity?.sourceDigest).not.toBe(result.body.round.materialIdentity?.sourceDigest);
  expect(newer.body.round.outcome).toBe('FAIL');
  expect((await read(fixture, 'review-required')).body.roundId).toBe(result.body.round.roundId);
}, 60000);

it('persists explicit missing/invalid configuration and enforces full HTTP Task/Run scope and execution permission', async () => {
  const fixture = await verificationRoundFixture(cleanup);
  const missing = await fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', { ...scopeFor(fixture), requestId: 'missing-config', allowExecute: true });
  expect(missing).toMatchObject({ status: 200, body: { round: { status: 'incomplete', checks: [] } } });
  expect(missing.body.round.gaps.length).toBeGreaterThan(0);
  const invalid = await start(fixture, 'duplicate-id', [check(fixture, 'same', 'exit 0'), check(fixture, 'same', 'exit 1')]);
  expect(invalid).toMatchObject({ status: 200, body: { round: { status: 'rejected', checks: [] } } });
  expect((await fixture.post('/api/real/verifications/rounds/start', { ...scopeFor(fixture), requestId: 'no-permission', allowExecute: false, configuration: { checks: [check(fixture, 'one', 'exit 0')] } })).status).toBe(400);
  const wrong = await fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', { ...scopeFor(fixture), taskId: 'not-the-task', requestId: 'wrong-task', allowExecute: true, configuration: { checks: [check(fixture, 'one', 'exit 0')] } });
  expect(wrong.body.round.status).toBe('rejected');
  expect((await read(fixture, 'missing-config')).body.configuration).toBeNull();
  const state = await fixture.state();
  expect(state.liveRuns[0]?.commandChecks ?? []).toHaveLength(0);
}, 60000);
