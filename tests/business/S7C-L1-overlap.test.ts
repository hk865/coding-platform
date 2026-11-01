/**
 * S-02 (`book-7c.md:1372`; §3.3): FX-01's two `s6a-core` Tasks overlap on the same module while
 * the `s6a-ui` Task does not. The Goal-scope pass tries the non-overlapping segment first, the
 * overlapping Task opens its module gate and waits, the person releases the gate through the real
 * `goals/overlap-release` route, and the overlapping Task then starts.
 *
 * The gate and its release are read only through `goals/overlap-gates` / `goals/overlap-release`;
 * the Runs are real Host Steps. No note is written here: the note path is N-owner's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { advance } from '../scenarios/support/common.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { openS7C1World, S7C1_CREATE_ROLE, type S7C1World } from '../helpers/S7C-member-fixture.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import type {
  WorkflowAdvanceInput, WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

const select = (target: S7C1World, flowId: string, taskId: string | null): WorkflowAdvanceInput => ({
  schemaVersion: 1, goalRef: target.goal, flowId, sessionHint: null, kind: 'select_work',
  ...(taskId === null ? {} : { taskId }),
});

describe('S-02: the non-overlapping segment first and the module gate', () => {
  it('tries s6a-ui first, opens the s6a-core gate, releases it and starts the overlapping Task', async () => {
    // m1's Run is running and held at its model request, so the Goal-scope pass sees the real conflict set.
    world = await openS7C1World({ firstRun: 'held' });
    const first = await advance(world.world.ag2b, select(world, 's7c-l1-s02', null));
    expect(first.next).toMatchObject({ kind: 'perform', operation: { kind: 'suggest_member', request: {
      input: { text: 'Task s7c-n1 has no suitable member; create one executor line for this task.' },
      meta: { requestId: expect.stringMatching(/^pick-suggest:s7c-n1:/) },
    } } });

    const receipts: WorkflowStepReceipt[] = [];
    if (first.next === null) throw new Error('S-02: the non-overlapping Task produced no step');
    // Stop before the note request: that path belongs to N, and this row releases the gate itself.
    await driveWorkflow(world.world.ag2b, first.next, { stopBefore: 'request_overlap_note', receipts });
    const opened = receipts.find(receipt => receipt.kind === 'open_overlap_gate');
    expect(opened).toMatchObject({ kind: 'open_overlap_gate', result: { status: 'opened' } });
    const gate = (opened as { result?: { gate?: ModuleOverlapGateV1 } } | undefined)?.result?.gate;
    if (gate === undefined) throw new Error(`S-02: the gate step returned no gate: ${JSON.stringify(opened)}`);

    const read = await world.world.post('goals/overlap-gates', plain(S6A_SCOPE, {
      goalRef: world.goal, page: { limit: 10 },
    }));
    expect(read.body).toMatchObject({ status: 'ready', value: { gates: [
      expect.objectContaining({ ref: gate.ref, revision: gate.revision, basisDigest: gate.basisDigest }),
    ] } });

    const released = await world.world.post('goals/overlap-release', plain(S6A_SCOPE, {
      commandId: 's7c-l1-s02-release', gate: gate.ref, revision: gate.revision, reason: 'S7C person release',
    }));
    expect(released.body).toMatchObject({ status: 'released' });

    // m2's own executor line: the module line carries m1's creator role and cannot serve m2's assignment.
    await createS6BLine(world.main, { label: 's7c-l1-s02-m2', role: S7C1_CREATE_ROLE, tasks: [world.tasks[1]!] });
    const after: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.world.ag2b, select(world, 's7c-l1-s02-after', world.tasks[1]!.taskId),
      { stopBefore: 'open_checks', receipts: after });
    const claim = after.find(receipt => receipt.kind === 'claim_task');
    if (claim === undefined || claim.result.status !== 'committed') {
      throw new Error(`S-02: the released overlapping Task did not start: ${JSON.stringify(after)}`);
    }
    expect(claim.result.value.runRef.goalId).toBe(world.goal.goalId);
  });
});
