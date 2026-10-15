/**
 * RL slice row RL-32 (RE2): the registered check's observation record carries
 * the Kernel `resourceCaps` report verbatim, and a `launch_failed` double is a
 * proven non-start recorded as `not_started` (spec §5.2 RL-32, L10, L11).
 *
 * Builds: the real R3e evidence fixture + `createTargetPlatform` with the
 * Kernel `ProcessSandbox` swapped by the RL double; the report body is read
 * through the public material owner.
 * Rows: RL-32.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { CheckProcessObservation } from '../../src/contracts/verification.js';
import { ProcessSandboxError } from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { createR3eEvidenceFixture, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';
import { defaultRLSandboxResult, rlSandbox } from '../helpers/RL-kernel-sandbox-double.js';

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const { mockRLKernelSandboxModule } = await import('../helpers/RL-kernel-sandbox-double.js');
  return await mockRLKernelSandboxModule(importOriginal as never);
});

const MIB = 1_048_576;
const APPLIED_MEMORY_HIT = { status: 'applied', memoryMaxBytes: 268435456, tasksMax: 64,
  memory: 'cap_hit', processes: 'none_observed', observationComplete: true };
/** The 6144 MiB cap of MF-6's malformed cases (spec L13: whole MiB >= 16 MiB). */
const CAP_HIT = { status: 'applied', memoryMaxBytes: 6144 * MIB, tasksMax: 512,
  memory: 'cap_hit', processes: 'none_observed', observationComplete: true };
const NO_HIT = { status: 'applied', memoryMaxBytes: 6144 * MIB, tasksMax: 512,
  memory: 'none_observed', processes: 'none_observed', observationComplete: true };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  rlSandbox.reset();
  vi.restoreAllMocks();
});

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

async function platformWithCheck(): Promise<{ fixture: R3eEvidenceFixture; platform: Platform }> {
  const fixture = await createR3eEvidenceFixture('sqlite');
  cleanups.push(() => fixture.close());
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost,
    checks: fixture.configuration,
    now: () => B2_AT,
  });
  cleanups.push(() => platform.close());
  return { fixture, platform };
}

function checkRequest(round: { ref: Parameters<Platform['checks']['runRegisteredCheck']>[1]['input']['roundRef']; revision: number }, checkId: string, requestId: string) {
  return { input: { roundRef: round.ref, checkId },
    meta: { requestId, expected: [{ ref: round.ref, revision: round.revision }] } };
}

async function readObservation(
  fixture: R3eEvidenceFixture, platform: Platform, checkId: string,
): Promise<CheckProcessObservation> {
  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  expect(opened).toMatchObject({ status: 'committed' });
  if (opened.status !== 'committed') throw new Error('RL-32 open did not commit');
  const run = await platform.checks.runRegisteredCheck(fixture.ctx,
    checkRequest(opened.value, checkId, `rl32-run-${checkId}`));
  expect(run).toMatchObject({ status: 'ready' });
  if (run.status !== 'ready') throw new Error(`RL-32 check ${checkId} did not finish`);
  const check = run.value.checks.find(candidate => candidate.checkId === checkId);
  const reportRef = check?.reportRef ?? null;
  if (reportRef === null || reportRef === undefined) throw new Error('RL-32 run must persist a report body');
  const report = await platform.materials.openArtifact(fixture.ctx, { ref: reportRef, usage: 'historical_explanation' });
  if (report.status !== 'ready') throw new Error('RL-32 report read failed');
  const body = JSON.parse(report.value.body) as { observation?: CheckProcessObservation };
  if (body.observation === undefined) throw new Error('RL-32 report carries no observation');
  return body.observation;
}

it('RL-32 (a) a cap-hit execution copies the resourceCaps report into the observation and still fails the check', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 137, resourceCaps: APPLIED_MEMORY_HIT, effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: 'rl32-rev', artifactRefs: [] } });
  const { fixture, platform } = await platformWithCheck();
  const observation = await readObservation(fixture, platform, fixture.passCheck.checkId);
  expect(observation).toMatchObject({ kind: 'executed', exitCode: 137, resourceCaps: APPLIED_MEMORY_HIT });
  expect(rlSandbox.commands).toEqual([fixture.passCheck.command]);
});

it('RL-32 (a) the finished check is a failure in the committed round', async () => {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 137, resourceCaps: APPLIED_MEMORY_HIT, effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: 'rl32-rev', artifactRefs: [] } });
  const { fixture, platform } = await platformWithCheck();
  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error('RL-32 open did not commit');
  const run = await platform.checks.runRegisteredCheck(fixture.ctx, checkRequest(opened.value, fixture.passCheck.checkId, 'rl32-fail'));
  if (run.status !== 'ready') throw new Error('RL-32 check did not finish');
  expect(run.value.checks.find(check => check.checkId === fixture.passCheck.checkId)).toMatchObject({
    phase: 'finished', outcome: 'FAIL',
  });
});

/**
 * MF-6 (RE2): a malformed `resourceCaps` report is refused at admission, before
 * any report is stored; the begun check stays `executing` with no reportRef.
 */
async function runMalformedReport(resourceCaps: unknown) {
  rlSandbox.next = () => defaultRLSandboxResult({ exitCode: 137, resourceCaps,
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: 'rl32-rev', artifactRefs: [] } });
  const { fixture, platform } = await platformWithCheck();
  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error('RL-32 open did not commit');
  const run = await platform.checks.runRegisteredCheck(fixture.ctx,
    checkRequest(opened.value, fixture.passCheck.checkId, 'rl32-malformed'));
  const round = await platform.evidence.readVerification(fixture.ctx, opened.value.ref);
  if (round.status !== 'ready') throw new Error('RL-32 round read failed');
  const check = round.value.checks.find(candidate => candidate.checkId === fixture.passCheck.checkId);
  return { run, check };
}

it.each([
  ['RL-32 (c1) resourceCaps null', null],
  ['RL-32 (c2) an applied memoryMaxBytes off the MiB grid', { ...CAP_HIT, memoryMaxBytes: 6144 * MIB + 1 }],
  ['RL-32 (c3) an applied processes value outside the closed union', { ...NO_HIT, processes: 'maybe' }],
])('%s is refused as invalid before any report is stored', async (_label, resourceCaps) => {
  const { run, check } = await runMalformedReport(resourceCaps);
  expect(run).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(check).toMatchObject({ phase: 'executing', reportRef: null });
});

it('RL-32 (b) a launch_failed double is a not_started observation and execute runs exactly once', async () => {
  rlSandbox.next = () => { throw new ProcessSandboxError('launch_failed', 'launch_failed: rl32 stub'); };
  const { fixture, platform } = await platformWithCheck();
  const observation = await readObservation(fixture, platform, fixture.passCheck.checkId);
  expect(observation).toMatchObject({ kind: 'not_started', reason: 'launch_failed' });
  expect(rlSandbox.commands).toEqual([fixture.passCheck.command]);
});
