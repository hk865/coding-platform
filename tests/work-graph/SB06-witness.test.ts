/**
 * B06 witness checks, owner level (spec rows W5b, W6b, W8b and the refusals; owner level only where no public step
 * reaches the case). Each starts from the SB06 world driven to its first `run_check`, then one named fault (rule A2) on
 * the public `workflow/advance`, or the published `platform.evidence` owner called as the Host, the round executor.
 * Memory, Git root.
 * Red today (bed5b343): no witness check exists, so the drive never stops at a witness `run_check` ("SB06: no
 * run_check"); in the refusal row only the command check exists, so `beginCheck` answers with another reason; and
 * `recordWitness` is not published. Green when B06 G2 synthesizes, dispatches and publishes the witness check.
 * - W5b: the stored RunActivity read fails (`commitBarrier.failReads`) → effects unknown → INCONCLUSIVE. Mutation: drop
 *   `effects==='unknown'` from `hasGap` (`witness-check.ts`).
 * - W6b: the completed Turn's final message is not found (`finalAssistantMessageOf` → null) → report absent → FAIL, no
 *   body. Mutation: map the missing message to `unknown` in `readWitnessFacts`.
 * - W8b: the same request replays the first answer without a capture; another pin under it conflicts. Mutation: move
 *   `lookupReceipt` after the pin and state checks in `recordWitness`.
 * - W14: a final text over the 256 KiB artifact limit makes the store answer `size_exceeded`; the witness keeps its
 *   matched source and present reads but gets `reportRef:null`, so the would-be PASS becomes INCONCLUSIVE. Mutation:
 *   `const outcome = verdict.outcome;` in `recordWitness` (direct PASS).
 * - Refusals, all coordination (121-111): a witness check has one result writer, `recordWitness`; a command check keeps
 *   its ticket path. `beginCheck`, `recordCheckResult` and both cross-kind events are `invalid` before any capture and
 *   leave the round unchanged. Mutation: delete either owner refusal, or either kind test of the admission's witness arm.
 * W1b (the `successfulReadPathsOf` pure table) is here.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { successfulReadPathsOf } from '../../src/core/agent-runtime/witness-facts.js';
import { checkEventAdmission } from '../../src/core/work-graph/state/verification-machine.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { failedResult, kernelToolCall, KernelTurnRecords, successResult, type KernelToolResult } from '../helpers/S2B-kernel-records-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_AT } from '../helpers/S6A-request-fixture.js';
import {
  driveSB06, openSB06World, roundSB06, sb06Draft, sb06Reads, sb06Witness, witnessOf, SB06_PATHS, SB06_TASK,
  SB06_WITNESS, type SB06Drive, type SB06Obligation, type SB06World,
} from '../helpers/SB06-witness-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
const lost = vi.hoisted(() => ({ message: false }));
vi.mock('../../src/core/agent-runtime/kernel-turn-facts.js', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/core/agent-runtime/kernel-turn-facts.js')>();
  return { ...real, finalAssistantMessageOf: (...args: Parameters<typeof real.finalAssistantMessageOf>) =>
    lost.message ? null : real.finalAssistantMessageOf(...args) };
});

const worlds: SB06World[] = [];
afterEach(async () => {
  lost.message = false; commitBarrier.reset(); vi.restoreAllMocks();
  for (const sb of worlds.splice(0)) await sb.close();
});
const REPORT = 'SB06 owner-row report';
/** W14: 300,000 UTF-8 bytes, over `ARTIFACT_MAX_SIZE_BYTES` (256 KiB) before the `{roundRef, subjectRunRef,
 * reportText}` JSON envelope is even counted. */
const OVERSIZED_REPORT = 'x'.repeat(300_000);
const atCheck = async (obligations: readonly SB06Obligation[] = [sb06Witness([...SB06_PATHS])],
  report: string = REPORT) => {
  const sb = await openSB06World({ draft: goal => sb06Draft(goal, obligations) });
  worlds.push(sb);
  return { sb, drive: await driveSB06(sb, { to: 'run_check', replies: sb06Reads(SB06_PATHS, report) }) };
};
/** Performs only the pending `run_check` on the public Workflow; answers the drive at the step after it. */
const runCheck = async (sb: SB06World, drive: SB06Drive): Promise<SB06Drive> =>
  ({ ...drive, next: (await driveWorkflow(sb.world.ag2b, drive.next!, { stopBefore: () => true })).at(-1)?.next ?? null });

describe('W5b/W6b: what the platform cannot read is never a PASS', () => {
  it('W5b: the stored RunActivity read fails → INCONCLUSIVE (report kept); finalize admits no PASS verdict', async () => {
    const { sb, drive } = await atCheck();
    const { projectId, goalId, runId } = drive.runRef;
    const fault = commitBarrier.failReads(canonicalKey({ aggregateType: 'RunActivity', projectId, goalId, runId }),
      'throw-always');
    const checked = await runCheck(sb, drive);
    expect(fault.calls()).toBeGreaterThan(0);
    fault.release();
    const witness = witnessOf((await roundSB06(sb, drive.roundRef)).round);
    expect(witness).toMatchObject({ phase: 'finished', outcome: 'INCONCLUSIVE', sourceStatus: 'matched' });
    expect(witness?.reportRef).not.toBeNull();
    const finalized = await driveSB06(sb, { to: 'finalized', from: checked });
    expect((await roundSB06(sb, finalized.roundRef, 'evidence')).evidence?.map(item => item.outcome)).not.toContain('PASS');
  }, 180_000);

  it('W6b: the completed Turn names a final message the transcript lacks → FAIL with no report body', async () => {
    const { sb, drive } = await atCheck();
    lost.message = true;
    await runCheck(sb, drive);
    lost.message = false;
    expect(witnessOf((await roundSB06(sb, drive.roundRef)).round))
      .toMatchObject({ phase: 'finished', outcome: 'FAIL', reportRef: null });
  }, 180_000);
});

describe('W14: a report over the size limit cannot PASS', () => {
  it('W14: a size_exceeded witness body (final text over 256 KiB) → reportRef null and the would-be PASS is INCONCLUSIVE',
    async () => {
      const { sb, drive } = await atCheck([sb06Witness([...SB06_PATHS])], OVERSIZED_REPORT);
      await runCheck(sb, drive);
      expect(witnessOf((await roundSB06(sb, drive.roundRef)).round))
        .toMatchObject({ phase: 'finished', outcome: 'INCONCLUSIVE', reportRef: null, sourceStatus: 'matched' });
    });
});

describe('W8b: recordWitness is receipt-first', () => {
  it('the same request replays the first answer without a capture; another pin under its requestId conflicts', async () => {
    const { sb, drive } = await atCheck();
    const { revision } = (await roundSB06(sb, drive.roundRef)).round;
    const witnessOnce = (pin: number) => sb.world.platform.evidence.recordWitness(sb.world.humanContext(), {
      input: { roundRef: drive.roundRef, checkId: SB06_WITNESS },
      meta: { requestId: 'sb06-w8b', expected: [{ ref: drive.roundRef, revision: pin }] } });
    const first = await witnessOnce(revision);
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: { revision: revision + 1 } });
    await writeFile(join(sb.world.root, 'README.md'), '# changed after the witness was recorded\n');
    const capture = vi.spyOn(VerificationWorkspaceReader.prototype, 'capture');
    expect(await witnessOnce(revision)).toEqual({ ...first, replayed: true });
    expect(capture).not.toHaveBeenCalled();
    expect(await witnessOnce(revision + 1)).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  }, 180_000);
});

describe('rejects: a witness check is finished only by recordWitness (coordination)', () => {
  it('beginCheck, recordCheckResult and both cross-kind events are invalid before any capture; the round is unchanged',
    async () => {
      const { sb, drive } = await atCheck([sb06Witness([...SB06_PATHS]), { id: 'sb06-cmd', taskIds: [SB06_TASK],
        kind: 'static' }]);
      const { round } = await roundSB06(sb, drive.roundRef);
      const { evidence } = sb.world.platform;
      const ctx = sb.world.humanContext();
      const meta = (requestId: string) => ({ requestId, expected: [{ ref: round.ref, revision: round.revision }] });
      const capture = vi.spyOn(VerificationWorkspaceReader.prototype, 'capture');
      expect(await evidence.beginCheck(ctx, { input: { roundRef: round.ref, checkId: SB06_WITNESS },
        meta: meta('sb06-r-begin') })).toMatchObject({ status: 'rejected', code: 'invalid',
        reason: 'a witness check has no process to begin' });
      expect(await evidence.recordCheckResult(ctx, { input: { roundRef: round.ref, checkId: SB06_WITNESS,
        invocationId: 'sb06-r-invocation', observation: { kind: 'not_started', reason: 'launch_failed', startedAt: S6A_AT,
          finishedAt: S6A_AT } }, meta: meta('sb06-r-record') })).toMatchObject({ status: 'rejected', code: 'invalid',
        reason: 'a witness check records through recordWitness' });
      expect(await evidence.recordWitness(ctx, { input: { roundRef: round.ref, checkId: 's7a-static-check' },
        meta: meta('sb06-r-cross') })).toMatchObject({ status: 'rejected', code: 'invalid',
        reason: 'the check s7a-static-check is not a witness check; a witness event cannot finish it' });
      expect(checkEventAdmission(round, { kind: 'check_result_recorded', checkId: SB06_WITNESS,
        invocationId: 'sb06-r-invocation' }, { callerIsExecutor: true, expectedRevision: round.revision,
        instanceLeaseHeld: false })).toEqual({ ok: false, reason: 'illegal', code: 'invalid',
        detail: 'the check platform:witness is a witness check; a command event cannot finish it' });
      expect(capture).not.toHaveBeenCalled();
      expect((await roundSB06(sb, drive.roundRef)).round).toEqual(round);
    }, 180_000);
});

describe('W1b: successful read paths are only success on the recorded path', () => {
  const recordsFor = (call: ReturnType<typeof kernelToolCall>, result: KernelToolResult) => {
    const turn = new KernelTurnRecords();
    turn.runStarted().modelRequestStarted('w1b-request').assistantMessage('w1b-message', [call]).toolStarted(call);
    if (result.status === 'success') turn.toolCompleted(call.callId, result);
    else turn.toolFailed(call.callId, 'execution', result);
    return turn.records();
  };
  it.each([
    { label: 'read_source success naming a.ts', call: kernelToolCall('w1b-1', 'read_source', { path: 'a.ts' }),
      result: successResult('w1b-1', { output: [{ kind: 'json', value: { path: 'a.ts' } }] }), paths: ['a.ts'] },
    { label: 'read_source success naming b.ts', call: kernelToolCall('w1b-2', 'read_source', { path: 'a.ts' }),
      result: successResult('w1b-2', { output: [{ kind: 'json', value: { path: 'b.ts' } }] }), paths: [] },
    { label: 'read_source failure', call: kernelToolCall('w1b-3', 'read_source', { path: 'a.ts' }),
      result: failedResult('w1b-3', { code: 'execution_failed' }), paths: [] },
    { label: 'native read failure', call: kernelToolCall('w1b-4', 'read', { path: 'a.ts' }),
      result: failedResult('w1b-4', { code: 'execution_failed' }), paths: [] },
  ] as Array<{ label: string; call: ReturnType<typeof kernelToolCall>; result: KernelToolResult; paths: string[] }>)
    ('$label → $paths', ({ call, result, paths }) => {
      expect(successfulReadPathsOf(recordsFor(call, result))).toEqual(paths);
    });
});
