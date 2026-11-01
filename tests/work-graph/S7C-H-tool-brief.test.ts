/**
 * H-05 (book-7c.md:629/644/650; 7c2-start-rulings-v2.md:...): the tool accept's
 * brief carries the understanding version the accept admitted, not the version
 * current when the successor is prepared.
 *
 * A real source Run writes its understanding on a clean Goal's anchor and the
 * tool handoff is accepted with that version. While the approval is pending a
 * person replaces the note, so a fresh scan would find no current source-Run
 * understanding. The approved handoff still prepares its successor's manifest
 * with the admitted version.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { HandoffProgressV1 } from '../../src/core/work-graph/model/session-handoff-contracts.js';
import { agentActorOf } from '../../src/core/work-graph/model/tool-commit-arguments.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { understandingNote } from '../helpers/S4C2-note-card-fixture.js';
import { adoptS6BPlan, understandingPointer } from '../helpers/S6B1-fixture.js';
import { linkTask, openS7CHandoffWorld, type S7CHandoffWorld } from '../helpers/S7C-handoff-fixture.js';

let opened: S7CHandoffWorld | undefined;
afterAll(async () => { await opened?.close(); opened = undefined; });


/** One goal setting under its own commandId: two different settings must not share an identity. */
async function setAutonomy(target: S7CHandoffWorld, goal: { aggregateType: 'Goal'; projectId: string; goalId: string },
  autonomy: 'every_step' | 'after_plan_confirmation', suffix: string): Promise<void> {
  const read = ready<{ goal: { revision: number } }>(
    await target.world.post('goals/read', plain(S6A_SCOPE, goal)), 'goals/read');
  committed(await target.world.post('goals/settings/set', graphWrite(S6A_SCOPE, {
    goalRef: goal, autonomy, waitForGoalRef: null,
  }, `s7c-h-tool-brief-autonomy-${suffix}`, [{ ref: goal, revision: read.goal.revision }])),
  'goals/settings/set');
}

describe('H-tool-brief: the stored admission-time understanding', () => {
  it('a note replaced while the approval is pending does not change the successor brief', async () => {
    const target = await openS7CHandoffWorld();
    opened = target;
    // A fresh Goal with two Plan Tasks: the source Run writes its understanding on one, and the handoff hands the
    // other, so the successor's first Run never contends with the still-running source Run for the same Task.
    const main = s6aCardsWorkspace(target.world, S6A_SCOPE);
    const goal = (await main.createGoal('s7c-h-tool-brief-goal', 'S7C tool brief goal')).ref;
    const adopted = await adoptS6BPlan(main, goal, { label: 's7c-h-tool-brief',
      taskIds: ['s7c-h-tool-brief-a', 's7c-h-tool-brief-b'], role: S6A_WORK_ROLE.templateId });
    const taskA = adopted.tasks[0]!;
    const taskB = adopted.tasks[1]!;
    for (const [index, task] of [taskA, taskB].entries()) {
      await linkTask(target.world, await target.world.readSession(target.lines.source.ref), task, true,
        `s7c-h-tool-brief-link-${String(index)}`);
    }
    await setAutonomy(target, goal, 'after_plan_confirmation', 'source');
    const anchor = { kind: 'goal' as const, goalId: goal.goalId };
    const pointer = await understandingPointer(target.world, anchor);
    const draft = understandingNote({ anchor, topic: 's7c-h-tool-brief-understanding',
      conclusion: 'the source Run admitted this', structural: false,
      replaces: pointer.noteId === null ? [] : [pointer.noteId] });
    if (draft.kind !== 'understanding') throw new Error('H-tool-brief: the draft is not an understanding');
    await target.world.scripted.script(target.lines.source, [
      { kind: 'calls', calls: [{ callId: 's7c-h-tool-brief-note', name: 'record_note', args: {
        op: 'write', kind: draft.kind, topic: draft.topic, conclusion: draft.conclusion,
        anchor: draft.anchor, sections: draft.sections, structural: draft.structural, replaces: draft.replaces,
        expectedPointerRevision: pointer.revision } }] },
      { kind: 'text', text: 'S7C H-tool-brief source answer' },
    ]);
    const claim = await advanceUntil(target.world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 's7c-h-tool-brief-source-run', sessionHint: target.lines.source.ref,
      kind: 'select_work', taskId: taskA.taskId }, 'claim_task');
    await driveWorkflow(target.world.ag2b, claim, { stopBefore: 'open_checks' });
    const facts = ready<SessionFactsV1>(await target.world.post('sessions/facts', plain(S6A_SCOPE, target.lines.source.ref)),
      'the source line facts');
    if (facts.latestWork === null) throw new Error('H-tool-brief: the source Run has no claim');
    const sourceRun = facts.latestWork.runRef;
    const page = ready<{ items: NoteItemV1[] }>(await target.world.post('notes/list', plain(S6A_SCOPE, {
      goalId: goal.goalId, state: 'accepted', limit: 20, cursor: null,
    })), 'the new Goal notes');
    const note = page.items.find(item => item.kind === 'understanding'
      && item.source.kind === 'agent' && item.source.runRef?.runId === sourceRun.runId);
    if (note === undefined) throw new Error('H-tool-brief: the source Run wrote no understanding');
    await setAutonomy(target, goal, 'every_step', 'card');

    const entry = await target.handoffEntry.requestHandoff(target.world.systemContext(), {
      commandId: 's7c-h-tool-brief-accept',
      caller: { actor: agentActorOf(target.lines.source.ref, sourceRun),
        session: target.lines.source.ref, run: sourceRun, duty: 'executor' },
      source: target.lines.source.ref,
      assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: [taskB] }],
      reason: 'S7C H-tool-brief',
    });
    expect(entry).toMatchObject({ status: 'needs_decision' });
    if (entry.status !== 'needs_decision') return;

    // The person replaces the source Run's note while the card is still pending.
    const listed = await target.world.platform.notes.listByAnchor(target.world.humanContext(),
      { anchor, limit: 1, cursor: null });
    if (listed.status !== 'ready' || listed.value.pointer === null) throw new Error('H-tool-brief: no pointer');
    const written = await target.world.post('notes/write', plain(S6A_SCOPE, {
      commandId: 's7c-h-tool-brief-replace', goalId: goal.goalId,
      expectedPointerRevision: listed.value.pointer.revision,
      note: { kind: 'understanding', topic: 's7c-h-tool-brief-newer', conclusion: 'a person replaced it',
        anchor, extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [note.noteId],
        contradicts: [], coexistWith: [],
        sections: { status: 'ready', decided: 'newer', open: 'none', next: 'none', risks: 'none' } },
    }));
    expect(written.httpStatus).toBe(200);

    const decided = await target.world.platform.sessionHandoff.decideHandoff(target.world.humanContext(), {
      commandId: 's7c-h-tool-brief-approve', operation: entry.operation, verdict: 'approve' });
    expect(decided).toMatchObject({ status: 'committed' });
    // The card is answered; the successor's own Run may enter under the goal's normal autonomy.
    await setAutonomy(target, goal, 'after_plan_confirmation', 'successor');

    let progress: HandoffProgressV1 | null = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const advanced = await target.world.platform.workflow.sessionHandoff.advance(target.world.systemContext(),
        { operation: entry.operation });
      if (advanced.status !== 'ready') throw new Error(`H-tool-brief: the advance is ${advanced.status}`);
      progress = advanced.value;
      const operationRead = await target.world.platform.sessions.getSessionOperation(
        target.world.systemContext(), entry.operation);
      if (progress.successor !== null && operationRead.status === 'ready'
        && operationRead.value.action.kind === 'handoff'
        && operationRead.value.action.progress.assignments.every(assignment =>
          assignment.transfers.every(transfer => transfer.receipt !== null))) break;
    }
    if (progress === null || progress.successor === null) throw new Error('H-tool-brief: the handoff made no successor');
    const successor = { projectId: progress.successor.projectId, sessionId: progress.successor.sessionId };
    const card = await target.world.readSession(successor);
    const line = { label: 's7c-h-tool-brief-successor', ref: successor, aggregateRef: card.record.ref,
      role: card.record.role, createdAt: card.record.createdAt };
    await target.world.scripted.script(line, [{ kind: 'text', text: 'S7C H-tool-brief successor answer' }]);
    const start = await advanceUntil(target.world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 's7c-h-tool-brief-start', sessionHint: successor, kind: 'select_work',
      taskId: taskB.taskId }, 'start');
    if (start.kind !== 'perform' || start.operation.kind !== 'start') {
      throw new Error('H-tool-brief: the successor step is not a start');
    }
    const prepared = (start.operation.request as unknown as { prepared: { envelope: { bundleRef: unknown } } }).prepared;
    const material = ready<{ body: string }>(await target.world.post('materials/open', plain(S6A_SCOPE, {
      ref: prepared.envelope.bundleRef, usage: 'historical_explanation',
    })), 'materials/open');
    const manifest = JSON.parse(material.body) as PreparedTaskManifestV1;
    expect(manifest.handoffBrief?.material.understanding).toEqual(
      [{ noteId: note.noteId, version: note.version }]);
  }, 180_000);
});
