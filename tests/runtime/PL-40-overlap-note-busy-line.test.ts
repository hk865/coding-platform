/**
 * PL-40 (busy line): the module gate's note request stays the note round's, even when the recipient line is busy.
 *
 * Design 5.1 (`design-frozen.md:203`, `:255`, `:559`): the gate's saved `noteRequest.messageRef` names the one
 * message that only the dedicated text round settles; a platform system-round source is not supplied to another
 * round, and the generic reply tool cannot fill its slot. Proven on the real F4 Host: the gate sends the note to the
 * adviser while the person's message is also queued, so the person's round opens first on the same line. That round
 * tries the real `respond_session_message` on the note; the note stays unanswered, and once the line is free the
 * Host opens the note's own text round, which writes the convention and lets the gate recheck satisfied.
 *
 * The adviser's grant adds the reply tool (a Host input, A8), so the busy round could answer if the slot allowed it.
 * No hand-made ctx and no direct handler.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { awaitPlanningAnswer, heartbeatUntil, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { notesOnModule, openPLOverlapWorld, select, type PLOverlapWorld } from '../helpers/PL-forms-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { S7C1_CREATE_ROLE } from '../helpers/S7C-member-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';

const MODULE = 's6a-core';
const NOTE_CONCLUSION = 'the module interface agreed after the busy round';

let opened: PLOverlapWorld | undefined;
afterEach(async () => { await opened?.close(); opened = undefined; });

describe('PL-40 (busy line): another round on the line cannot take the gate note', () => {
  it('refuses the busy round\'s reply to the note, then the note round writes the note and the gate is satisfied', async () => {
    opened = await openPLOverlapWorld({ firstRun: 'held', adviserTools: ['respond_session_message'] });
    const target = opened;
    await createS6BLine(target.world.main, {
      label: 'pl-busy-b', role: S7C1_CREATE_ROLE, tasks: [target.world.tasks[1]!],
    });
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(target.world.world.ag2b, select(target, 'pl-busy-b-dispatch', target.world.tasks[1]!.taskId),
      { receipts });
    const gateReceipt = receipts.find(receipt => receipt.kind === 'open_overlap_gate');
    if (gateReceipt === undefined || gateReceipt.kind !== 'open_overlap_gate'
      || gateReceipt.result.status !== 'opened') throw new Error('PL-40 busy: the B gate did not open');
    const gate = gateReceipt.result.gate;
    const note = (await listed(target.world.world, 'inbox', target.adviser)).find(message =>
      message.needsReply === true && message.sender.kind === 'host' && message.sender.actor.kind === 'system');
    if (note === undefined) throw new Error('PL-40 busy: the gate sent no note request');

    // The person's message to the same line is offered first, so its round runs while the note waits. That round
    // tries the generic reply on the note; the note's own text round follows and writes the convention.
    const person = await sendS7A2PersonMessage(target.world.world, {
      label: 'pl-busy-person', recipient: target.adviser.ref, goal: target.world.goal,
    });
    await target.script(target.adviser, [
      { kind: 'calls', calls: [{ callId: 'pl-busy-reply', name: 'respond_session_message',
        args: { messageRef: note.ref, expectedRevision: note.revision, text: 'answered from the busy round' } }] },
      { kind: 'text', text: 'PL-40 busy: the person round ends' },
      { kind: 'calls', calls: [{ callId: 'pl-busy-note', name: 'record_note', args: {
        op: 'write', kind: 'convention', topic: 'pl-busy-interface', conclusion: NOTE_CONCLUSION,
        anchor: { kind: 'module', moduleId: MODULE }, extraAnchors: [], facts: [], basisFiles: [],
        replaces: [], contradicts: [], coexistWith: [], structural: false, body: 'PL-40 busy interface note',
      } }] },
      { kind: 'text', text: 'PL-40 busy: interface note written' },
    ]);
    const personRound = await awaitPlanningAnswer(target.world.world, person.ref);
    expect(personRound?.job.job.status).toBe('answered');

    // The note's own text round opens on the free line, writes the note and is the one reply the note got (the
    // busy round's reply would have taken the slot first); the gate rechecks satisfied.
    const noteRound = await heartbeatUntil(target.world.world, () => readPlanningQuery(target.world.world, note.ref),
      query => query?.job.job.status === 'answered', 16);
    expect(noteRound?.job.job.intent.execution).toMatchObject({ kind: 'intervention_planning', sourceMessageRef: note.ref });
    if (noteRound === null) throw new Error('PL-40 busy: the note round did not open');
    const replied = (await listed(target.world.world, 'inbox', target.adviser))
      .find(message => message.ref.messageId === note.ref.messageId);
    expect(replied?.response?.sender).toMatchObject({ kind: 'query_run', queryRunRef: noteRound.run.ref });
    expect((await notesOnModule(target)).some(item => item.conclusion === NOTE_CONCLUSION)).toBe(true);
    const after = await target.world.world.platform.overlapGates.checkOverlapGate(
      target.world.world.systemContext(), { gate: gate.ref });
    expect(after).toEqual({ status: 'ready', value: { status: 'satisfied', by: 'note' } });
  });
});
