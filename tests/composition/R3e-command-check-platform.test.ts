/**
 * R3e.1 composition-root command-check behaviour tests (stage-1 skeleton).
 *
 * A real ended subject Run (independent R3e Goal/Plan/Session/claim, static
 * requirement) is placed on a real SQLite ledger, then the public
 * `createTargetPlatform` composition root publishes `platform.evidence` AND the
 * trusted Host `platform.checks.runRegisteredCheck`. The runner must execute
 * the registered command through the REAL Kernel ProcessSandbox. These are
 * FINAL behaviour assertions: until stage 2 lands, `openVerification` returns
 * `unsupported`, so each test stops there and the real-process/reopen tails are
 * NOT reached. The process counter is a `vi.mock` wrapper that forwards to the
 * real ProcessSandbox/WorkspaceSandbox; it is a test observation only.
 *
 * Specification: docs/refactor/tasks/R3e-completion-skeleton.md §4.4, §8 and the
 * R3e.1 mid-review repair §5.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTargetPlatform, type TargetPlatformOptions } from '../../src/composition/create-platform.js';
import type { CheckProcessObservation } from '../../src/contracts/verification.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { createR3eEvidenceFixture, R3E_HOST, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';

const processSpy = vi.hoisted(() => ({ probes: 0, executes: 0,
  executions: [] as Array<{ command: string; result: unknown }> }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/public-api.js')>();
  class CountingProcessSandbox extends actual.ProcessSandbox {
    static async probe(...args: Parameters<typeof actual.ProcessSandbox.probe>) {
      processSpy.probes += 1;
      return actual.ProcessSandbox.probe(...args);
    }
    async execute(request: Parameters<InstanceType<typeof actual.ProcessSandbox>['execute']>[0]) {
      processSpy.executes += 1;
      // Save and return the REAL result unchanged; no fabricated execution data.
      const result = await super.execute(request);
      processSpy.executions.push({ command: request.command, result });
      return result;
    }
  }
  return { ...actual, ProcessSandbox: CountingProcessSandbox };
});

/** Structural projection of the real Kernel `ProcessExecutionResult` fields
 * this test compares (the type itself is not re-exported by the public API). */
type RealExecutionResult = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: { text: string; totalBytes: number; truncated: boolean };
  stderr: { text: string; totalBytes: number; truncated: boolean };
  effects: { workspaceRevision: string | null; changedPaths: readonly string[] };
  sandboxProfileVersion: string;
};

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { processSpy.probes = 0; processSpy.executes = 0; processSpy.executions = []; });
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function prepared(): Promise<{ fixture: R3eEvidenceFixture; options: TargetPlatformOptions; platform: Platform }> {
  const fixture = await createR3eEvidenceFixture('sqlite');
  cleanups.push(() => fixture.close());
  await fixture.b2.base.closeBackend();
  const options: TargetPlatformOptions = {
    storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost,
    checks: fixture.configuration,
    now: () => B2_AT,
  };
  const platform = await createTargetPlatform(options);
  cleanups.push(() => platform.close());
  return { fixture, options, platform };
}

function checkRequest(round: { ref: Parameters<Platform['checks']['runRegisteredCheck']>[1]['input']['roundRef']; revision: number }, checkId: string, requestId: string) {
  return { input: { roundRef: round.ref, checkId },
    meta: { requestId, expected: [{ ref: round.ref, revision: round.revision }] } };
}

it('executes the fixed commands through the real sandbox and admits mechanical Evidence without completing the Task', async () => {
  const { fixture, platform } = await prepared();
  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  expect(opened, 'formal open must commit').toMatchObject({ status: 'committed', value: { status: 'open' } });
  if (opened.status !== 'committed') throw Error('open did not commit');

  let latest = opened.value;
  for (const check of opened.value.checks) {
    const run = await platform.checks.runRegisteredCheck(fixture.ctx, checkRequest(latest, check.checkId, `r3e-run-${check.checkId}`));
    expect(run, `registered check ${check.checkId} must return the persisted view`).toMatchObject({ status: 'ready' });
    if (run.status !== 'ready') throw Error(`registered check ${check.checkId} did not commit`);
    latest = run.value;
  }
  expect(processSpy.executes, 'one real process per fixed check').toBe(2);
  expect(processSpy.probes, 'each fresh check probes the real sandbox').toBeGreaterThanOrEqual(1);
  for (const check of latest.checks) {
    expect(check, `check ${check.checkId} finished`).toMatchObject({ phase: 'finished', outcome: 'PASS' });
  }
  const passCheck = latest.checks.find(check => check.checkId === fixture.passCheck.checkId);
  const reportRef = passCheck?.reportRef ?? null;
  if (reportRef === null || reportRef === undefined) throw Error('the run must persist a report body');
  const report = await platform.materials.openArtifact(fixture.ctx, { ref: reportRef, usage: 'historical_explanation' });
  expect(report, 'the check report is a real body-first material').toMatchObject({ status: 'ready' });
  if (report.status !== 'ready') throw Error('report body read failed');
  expect(report.value.body).toContain('R3E_CHECK_OK');
  const body = JSON.parse(report.value.body) as {
    source?: { actor?: unknown; runRef?: unknown };
    subjectRunRef?: unknown;
    observation?: CheckProcessObservation;
  };
  expect(body.source, 'the report is authored by the real Host, not the subject Run').toMatchObject({
    actor: { kind: R3E_HOST.kind, id: R3E_HOST.id }, runRef: null,
  });
  expect(body.subjectRunRef, 'the report still names the real subject Run').toEqual(fixture.subjectRunRef);

  // The persisted observation must equal the REAL ProcessSandbox result field by
  // field; effects must actually exist (no `not.toBeNull` on an optional field).
  const realExecution = processSpy.executions.find(entry => entry.command === fixture.passCheck.command);
  if (realExecution === undefined) throw Error('no real execution was recorded for the pass check');
  const real = realExecution.result as RealExecutionResult;
  const observation = body.observation;
  expect(observation, 'the report persists an executed observation').toMatchObject({ kind: 'executed' });
  if (observation === undefined || observation.kind !== 'executed') throw Error('the report must persist an executed observation');
  expect(observation.effects, 'the real effects record must actually be present').toBeDefined();
  expect(observation, 'the persisted observation matches the real process result').toMatchObject({
    exitCode: real.exitCode,
    signal: real.signal,
    timedOut: real.timedOut,
    cancelled: real.cancelled,
    stdout: { text: real.stdout.text, totalBytes: real.stdout.totalBytes, truncated: real.stdout.truncated },
    stderr: { text: real.stderr.text, totalBytes: real.stderr.totalBytes, truncated: real.stderr.truncated },
    effects: { workspaceRevision: real.effects.workspaceRevision, changedPaths: [...real.effects.changedPaths] },
    sandboxProfileVersion: real.sandboxProfileVersion,
  });

  const finalized = await platform.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(latest));
  expect(finalized, 'the mechanical checks finalize into evidence').toMatchObject({ status: 'committed', value: { applicable: true, outcome: 'PASS' } });

  // Check finalization preserves the ended Run; formal completion is a separate operation.
  const subject = await platform.executions.readExecution(fixture.ctx, fixture.subjectRunRef);
  expect(subject, 'the subject Run remains its real ended fact').toMatchObject({ status: 'ready', value: { run: { status: 'ended' } } });
});

it('collapses a concurrent fresh run into one real process and never re-runs an unknown executing window across restart', async () => {
  const { fixture, options, platform } = await prepared();
  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  expect(opened, 'formal open must commit').toMatchObject({ status: 'committed' });
  if (opened.status !== 'committed') throw Error('open did not commit');
  const round = opened.value;

  // Two fresh requests for the SAME check race on the same begin CAS. Exactly
  // one real process may run; the loser either sees the persistent view or is
  // rejected by the CAS, so we do not require both to be ready.
  const [left, right] = await Promise.all([
    platform.checks.runRegisteredCheck(fixture.ctx, checkRequest(round, fixture.passCheck.checkId, 'r3e-concurrent-a')),
    platform.checks.runRegisteredCheck(fixture.ctx, checkRequest(round, fixture.passCheck.checkId, 'r3e-concurrent-b')),
  ]);
  const outcomes = [left, right];
  expect(outcomes.some(outcome => outcome.status === 'ready'), 'at least one request observes the run').toBe(true);
  expect(processSpy.executes, 'a concurrent fresh begin runs one real process only').toBe(1);

  // Read the CURRENT Round after the race (the first ready result may be a stale
  // executing observation), then begin the second check with its revision.
  const current = await platform.evidence.readVerification(fixture.ctx, round.ref);
  expect(current, 'the current Round is readable after the race').toMatchObject({ status: 'ready' });
  if (current.status !== 'ready') throw Error('current Round read after the race failed');
  const begin = await platform.evidence.beginCheck(fixture.ctx,
    fixture.beginRequest(current.value, fixture.interruptCheck.checkId));
  expect(begin, 'the second check begins and is left executing').toMatchObject({ status: 'committed' });
  if (begin.status !== 'committed') throw Error('begin did not commit');
  const executing = await platform.evidence.readVerification(fixture.ctx, round.ref);
  expect(executing, 'the unknown window is persisted').toMatchObject({ status: 'ready' });
  if (executing.status !== 'ready') throw Error('the executing window must be readable');
  expect(executing.value.checks.find(check => check.checkId === fixture.interruptCheck.checkId))
    .toMatchObject({ phase: 'executing', invocationId: begin.value.invocationId });
  const beforeRestartProbes = processSpy.probes;
  const beforeRestartExecutes = processSpy.executes;

  await platform.close();
  const reopened = await createTargetPlatform(options);
  cleanups.push(() => reopened.close());
  // The runner itself must observe the persistent window and NOT re-execute.
  const afterRestart = await reopened.checks.runRegisteredCheck(fixture.ctx,
    checkRequest(executing.value, fixture.interruptCheck.checkId, 'r3e-after-restart'));
  expect(afterRestart, 'the runner returns the persistent unknown window').toMatchObject({ status: 'ready' });
  if (afterRestart.status !== 'ready') throw Error('the restarted runner must return the persistent window');
  expect(afterRestart.value.checks.find(check => check.checkId === fixture.interruptCheck.checkId))
    .toMatchObject({ phase: 'executing', invocationId: begin.value.invocationId });
  expect(processSpy.probes, 'restart never probes the sandbox').toBe(beforeRestartProbes);
  expect(processSpy.executes, 'restart never re-runs an unknown executing window').toBe(beforeRestartExecutes);

  const incomplete = await reopened.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(afterRestart.value));
  expect(incomplete, 'a fresh finalize with an executing window is incomplete, not finalized').toMatchObject({ status: 'rejected', code: 'incomplete' });
});
