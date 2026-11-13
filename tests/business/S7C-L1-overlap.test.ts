/**
 * S-02 (`book-7c.md:1372`; §3.3): FX-01's two `s6a-core` Tasks overlap on the same module while
 * the `s6a-ui` Task does not. The Goal-scope pass tries the non-overlapping segment first, the
 * overlapping Task opens its module gate and waits, the person releases the gate through the real
 * `goals/overlap-release` route, and the overlapping Task then starts.
 *
 * The gate and its release are read only through `goals/overlap-gates` / `goals/overlap-release`;
 * the Runs are real Host Steps. No note is written here: the note path is N-owner's.
 *
 * X2 (XWR-ON draft §3; MVP-BEHAVIOR:331): a Goal with no responsible adviser asks the project's
 * secretary line for the overlap note, not the first adviser line of the workspace. The note request's
 * recipient is read from the gate, never written.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { advance } from '../scenarios/support/common.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
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
    // ADVQ Q1: the text names the Task's project and Goal; red today (workflow.ts:1685), green when ADVQ lands.
    expect(first.next).toMatchObject({ kind: 'perform', operation: { kind: 'suggest_member', request: {
      input: { text: 'Task s7c-n1 has no suitable member; create one executor line for this task '
        + '(projectId ag2b-collab-project, goalId s7c-goal).' },
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

/**
 * X2 (XWR-ON draft §3; MVP-BEHAVIOR:331): a Goal with no responsible adviser asks the project's secretary, not
 * the first adviser line of the workspace. The world opens without an adviser (`openS7C1World({ adviser: false })`)
 * and then opens one adviser line that is never assigned to this Goal; today the overlap gate's workspace duty read
 * (`create-platform.ts:3637-3639`) picks that line and saves `duty: 'adviser'`.
 * Red today at (a): the gate's `noteRequest` names the unassigned adviser line with `duty: 'adviser'`, not the
 * secretary. After the package the adviser branch is the Goal's L35 read (no link -> `human` -> null), so the
 * secretary branch reads the project's secretary line (`duty-recipient.ts:38-41`) and saves `duty: 'secretary'`.
 * Named mutation ⑤: read the project's first adviser line in the adviser branch (§9 Q1 甲) -> (a) red.
 */
describe('X2: no responsible adviser means the project secretary', () => {
  it('sends the overlap note to the secretary, not to an unassigned adviser line', async () => {
    world = await openS7C1World({ adviser: false, firstRun: 'held' });
    const target = world;
    // One adviser line exists in the workspace but is never assigned to this Goal.
    valueOf((await target.world.post('role-lines/open',
      graphWrite(S6A_SCOPE, { duty: 'adviser', scope: [] }, 'xwron-x2-adviser'))).body, 'committed',
    'the unassigned adviser line');
    // m1 is running and held, so selecting the second s6a-core Task opens its module gate.
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(target.world.ag2b, select(target, 'xwron-x2-m2', target.tasks[1]!.taskId),
      { stopBefore: 'request_overlap_note', receipts });
    const openedGate = receipts.find(receipt => receipt.kind === 'open_overlap_gate');
    expect(openedGate).toMatchObject({ kind: 'open_overlap_gate',
      result: { status: 'opened', noteRequest: 'sent' } });
    if (openedGate === undefined || openedGate.kind !== 'open_overlap_gate'
      || openedGate.result.status !== 'opened') throw new Error('X2: the second module gate did not open');
    expect(openedGate.result.gate.noteRequest).toMatchObject({
      recipient: { projectId: target.secretary.ref.projectId, sessionId: target.secretary.ref.sessionId },
      duty: 'secretary',
      messageRef: expect.objectContaining({ aggregateType: 'SessionMessage' }),
    });
  });
});
