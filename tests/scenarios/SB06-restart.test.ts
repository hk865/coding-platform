/**
 * B06 witness checks, spec row W8: a Host restart around the witness commit. SQLite only (a Host restart, rule S3).
 * The SB06 world on SQLite with the S9 R8 restart recipe (`tests/scenarios/S9-review-restart.test.ts`): the commit
 * barrier holds the `b06-witness:` commit before it lands, or holds its answer after it landed; `world.crash()`
 * abandons that Host and starts a new one on the same database; the public `workflow/advance` goes on.
 * Plain root (`git: false`): the outcome is not this row's rule, an INCONCLUSIVE witness still folds into one finished
 * check and one verdict Evidence, and the fixture's Git baseline comes after the first Host start, which a SQLite
 * restart reads differently (KLS-1a; `E3DN-done-world.ts` restarts before its baseline for that reason).
 * Red today (bed5b343): no witness check, so the drive never stops at its `run_check` ("SB06: no run_check"). Green
 * when B06 G2 commits the witness through `recordWitness`.
 * Mutation: let the retry after the restart write a second witness result or verdict, or interrupt a pending witness
 * at startup.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { receiptOf } from '../helpers/S7A-fixture.js';
import {
  driveSB06, openSB06World, roundSB06, sb06Draft, sb06Reads, sb06Witness, witnessOf, SB06_PATHS, SB06_TASK,
  SB06_WITNESS, type SB06World,
} from '../helpers/SB06-witness-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: SB06World[] = [];
afterEach(async () => { commitBarrier.reset(); for (const sb of worlds.splice(0)) await sb.close(); });

describe('W8: the witness commit across a Host restart (SQLite only)', () => {
  it.each([
    { window: 'pending (held before the commit)', after: false, runChecks: 1 },
    { window: 'finished (the commit landed, its answer held)', after: true, runChecks: 0 },
  ])('$window → no executor rerun; one finished witness, one verdict; finalize follows', async ({ after, runChecks }) => {
    // The plain root (`writeAG2bWorkspace`) has no `README.md`; reading only its two files keeps the witness out of
    // the absent-path FAIL, so the non-Git gap gives INCONCLUSIVE.
    const plainPaths = SB06_PATHS.slice(0, 2);
    const sb = await openSB06World({ backend: 'sqlite', git: false,
      draft: goal => sb06Draft(goal, [sb06Witness(plainPaths)]) });
    worlds.push(sb);
    const line = sb.lines.get(SB06_TASK)!;
    const drive = await driveSB06(sb, { to: 'run_check', replies: sb06Reads(plainPaths, 'SB06 restart report') });
    const modelCalls = (await sb.world.scripted.requests(line)).length;
    const gate = (after ? commitBarrier.holdAfter : commitBarrier.hold).call(commitBarrier, byIdentityPrefix('b06-witness:'));
    void sb.world.post('workflow/advance', plain(S6A_SCOPE, drive.next)).catch(() => undefined);
    await gate.reached;
    await sb.world.crash();
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(sb.world.ag2b, { schemaVersion: 1, goalRef: sb.goal, flowId: `sb06-${SB06_TASK}`,
      sessionHint: line.ref, kind: 'select_work', taskId: SB06_TASK },
    { receipts, stopBefore: () => receipts.some(receipt => receipt.kind === 'finalize_checks') });
    expect(receipts.filter(receipt => receipt.kind === 'run_check')).toHaveLength(runChecks);
    expect(receiptOf(receipts, 'finalize_checks')?.result).toMatchObject({ status: 'committed' });
    expect(await sb.world.scripted.requests(line)).toHaveLength(modelCalls);
    const { round, evidence } = await roundSB06(sb, drive.roundRef, 'evidence');
    expect(witnessOf(round)).toMatchObject({ phase: 'finished', outcome: 'INCONCLUSIVE', invocationId: null });
    expect(evidence?.filter(item => item.source.checkId === SB06_WITNESS)).toHaveLength(1);
  }, 240_000);
});
