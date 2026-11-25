/**
 * L8 PASS rows (book `l8-rework-1` §2 item 7; the assertions Codex set there).
 *
 * Three rows, each on BOTH stores:
 *
 * 1. the real Workflow's `finalize_checks` PASS;
 * 2. the public `platform.evidence.finalizeChecks` PASS, after the real
 *    registered check ran through `platform.checks.runRegisteredCheck`;
 * 3. the exact same finalize request sent again (same `meta.requestId`, same
 *    `input.roundRef`).
 *
 * Every fact is produced by the platform. The Project/Workspace, the policy,
 * the architecture baseline, the Goal and the Plan go through public writers;
 * a real Run is claimed and ended by the real Workflow/Kernel with the scripted
 * model; the registered static command check runs through the real Kernel
 * ProcessSandbox; and the automatic capture is the real
 * `createAutoCaptureDriver`, connected to `onArchitectureCaptureTrigger` the
 * way `S8A-L8-adoption-capture.test.ts` installs it. No observation, request,
 * round or check result is hand-written.
 * The world is the shared `tests/helpers/S8A-L8-pass-world.ts`.
 *
 * These rows need real bubblewrap (`/usr/bin/bwrap`). This sandbox does not have
 * it (`DSH-BASELINE.md` A2), so each row fails at the real registered check with
 * the Kernel's `ENOENT: ... '/usr/bin/bwrap'` reason; the lead runs them with
 * bubblewrap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import {
  L8_PASS_CHECK_ID as CHECK_ID, drive, l8Module, openL8PassWorld, performs, selectWork as select,
  type L8Driven as Driven, type L8PassWorld as Fixture, type L8Platform as Platform,
} from '../helpers/S8A-L8-pass-world.js';

type CheckResult = Awaited<ReturnType<Platform['checks']['runRegisteredCheck']>>;
type CurrentCaptureRef = NonNullable<ArchitectureObservationStateV1['current']>['captureRef'];

const BACKENDS = ['memory', 'sqlite'] as const;
type Backend = (typeof BACKENDS)[number];

const opened: Fixture[] = [];
const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

afterEach(async () => {
  for (const world of opened.splice(0)) await world.close();
});

/**
 * The shared L8 PASS world with the `src` module adopted BEFORE the driver's sink is connected, so the first
 * accepted request is the explicit real `workspaceRegistered` trigger below (`requestSeq` 1); then the Goal, the
 * Plan and the executor line.
 */
async function openEnvironment(backend: Backend, projectId: string): Promise<Fixture> {
  const world = await openL8PassWorld({ backend, projectId,
    adoptBeforeCapture: [l8Module(projectId, 'A', ['src'], 'The src subtree')] });
  opened.push(world);
  await world.seedGoal();
  return world;
}

/** Bounded public poll: the only way the rows wait for a capture. */
async function readState(fixture: Fixture): Promise<ArchitectureObservationStateV1> {
  const read = await fixture.platform.architecture.observationState(fixture.ctx, { workspace: fixture.scope });
  expect(read, 'architecture/observation-state must be ready').toMatchObject({ status: 'ready' });
  if (read.status !== 'ready') throw new Error('observationState was not ready');
  return read.value;
}

async function waitForCapture(fixture: Fixture, requestSeq: number): Promise<ArchitectureObservationStateV1> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const state = await readState(fixture);
    if (state.autoCapture !== null && state.autoCapture.requestSeq === requestSeq &&
        state.autoCapture.pending === false && state.current !== null) return state;
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for capture request ' + requestSeq + ': ' + JSON.stringify(state));
    }
    await sleep(10);
  }
}

/** The platform's own refusal is the failure text; nothing is wrapped or invented. */
function requireReadyCheck(result: CheckResult): Extract<CheckResult, { status: 'ready' }> {
  expect(result.status, result.status === 'rejected'
    ? result.reason
    : 'the real registered check must return a persisted round').toBe('ready');
  if (result.status !== 'ready') throw new Error('the registered check did not return a ready round');
  return result;
}

function roundFromOpen(receipts: readonly WorkflowStepReceipt[]): RoundSnapshot {
  const receipt = receipts.find(candidate => candidate.kind === 'open_checks');
  if (receipt === undefined || receipt.kind !== 'open_checks' || receipt.result.status !== 'committed') {
    throw new Error('the Workflow must commit the real round open');
  }
  return receipt.result.value;
}

/** Row 1's check ran inside the Workflow; surface its own refusal when it could not run. */
function requireWorkflowCheckRan(driven: Driven): void {
  const receipt = driven.receipts.find(candidate => candidate.kind === 'run_check');
  if (receipt === undefined || receipt.kind !== 'run_check') {
    throw new Error('the Workflow must perform the real registered check');
  }
  requireReadyCheck(receipt.result);
}

/** The shared post-PASS assertions: one new satisfied request, a new current and the old current as previous. */
async function assertPassCapture(fixture: Fixture, oldCurrent: CurrentCaptureRef,
  expectedSequence: number): Promise<ArchitectureObservationStateV1> {
  expect(expectedSequence).toBe(2);
  const state = await waitForCapture(fixture, expectedSequence);
  expect(state.autoCapture).toMatchObject({ requestSeq: expectedSequence, trigger: 'check_passed',
    pending: false, status: 'requested', failure: null });
  expect(state.current).not.toBeNull();
  expect(state.current!.captureRef.captureId).not.toBe(oldCurrent.captureId);
  expect(state.previous).toEqual(oldCurrent);
  expect(typeof state.current!.observedAt).toBe('string');
  return state;
}

describe.each(BACKENDS)('S8A L8 PASS capture [%s]', backend => {
  it('row 1: the real Workflow finalize PASS starts one automatic capture', async () => {
    const fixture = await openEnvironment(backend, `s8a-l8-pass-${backend}-row1`);
    // A real registration trigger: request 1 is satisfied before the PASS.
    fixture.driver.workspaceRegistered(fixture.scope);
    const before = await waitForCapture(fixture, 1);
    expect(before.autoCapture).toMatchObject({ requestSeq: 1, trigger: 'workspace_registered', pending: false });
    const oldCurrent = before.current!.captureRef;

    const driven = await drive(fixture, select(fixture, 's8a-l8-row1-flow'), performs('finalize_checks'));
    // The real registered check (`echo S8A_L8_PASS`) ran through the Workflow and the Kernel.
    requireWorkflowCheckRan(driven);
    if (driven.stopped === null || driven.stopped.operation.kind !== 'finalize_checks') {
      throw new Error('the Workflow must reach the finalize');
    }
    const finalized = await fixture.platform.workflow.advanceWork(fixture.ctx, driven.stopped);
    if (finalized.status !== 'ready') throw new Error(`the finalize was not ready: ${JSON.stringify(finalized)}`);
    expect(finalized.value.receipt).toMatchObject({ kind: 'finalize_checks', result: {
      status: 'committed', replayed: false, value: { outcome: 'PASS', applicable: true } } });

    await assertPassCapture(fixture, oldCurrent, 2);
  });

  it('rows 2 and 3: the public finalizeChecks PASS starts one automatic capture, and the same finalize request replays and changes no capture state', async () => {
    const fixture = await openEnvironment(backend, `s8a-l8-pass-${backend}-row3`);
    fixture.driver.workspaceRegistered(fixture.scope);
    const before = await waitForCapture(fixture, 1);
    const oldCurrent = before.current!.captureRef;

    const opened = await drive(fixture, select(fixture, 's8a-l8-row3-flow'), performs('run_check'));
    const round = roundFromOpen(opened.receipts);
    const run = requireReadyCheck(await fixture.platform.checks.runRegisteredCheck(fixture.ctx, {
      input: { roundRef: round.ref, checkId: CHECK_ID },
      meta: { requestId: fixture.projectId + '-replayed-run',
        expected: [{ ref: round.ref, revision: round.revision }] },
    }));
    const finalizeRequest = { input: { roundRef: run.value.ref }, meta: {
      requestId: fixture.projectId + '-replayed-finalize',
      expected: [{ ref: run.value.ref, revision: run.value.revision }] } };
    const notificationsBeforeFirst = fixture.notifications();
    const first = await fixture.platform.evidence.finalizeChecks(fixture.ctx, finalizeRequest);
    expect(first).toMatchObject({ status: 'committed', replayed: false,
      value: { outcome: 'PASS', applicable: true } });
    // Control: a non-replayed PASS fires exactly one real notification, so the
    // count below is the right measure for "this call fired no trigger".
    expect(fixture.notifications()).toBe(notificationsBeforeFirst + 1);
    const afterPass = await assertPassCapture(fixture, oldCurrent, 2);

    // The exact same request: same meta.requestId, same input.roundRef.
    const notificationsBeforeReplay = fixture.notifications();
    const replayed = await fixture.platform.evidence.finalizeChecks(fixture.ctx, finalizeRequest);
    expect(replayed).toMatchObject({ status: 'committed', replayed: true, value: { outcome: 'PASS' } });
    // The notification is fired synchronously inside the awaited call, so the
    // count after it is the completion boundary: the replay fired no trigger.
    expect(fixture.notifications()).toBe(notificationsBeforeReplay);
    const after = await readState(fixture);
    expect(after.autoCapture).toMatchObject({ requestSeq: afterPass.autoCapture!.requestSeq,
      trigger: 'check_passed', pending: false });
    expect(after.current!.captureRef.captureId).toBe(afterPass.current!.captureRef.captureId);
    expect(after.current!.captureRef).toEqual(afterPass.current!.captureRef);
    expect(after.previous).toEqual(afterPass.previous);
  });
});
