/**
 * H-entry (book-7c.md:1377; 7c2-start-rulings-v2.md:1161): the handoff tool entry's understanding and caller
 * rules, over FH-1's real world and source Run. Every state is a public step (the fixture's real claims, the
 * real `record_note`, `sessions/link`); the entry is the platform's own closure, captured from the real factory
 * call during the world's construction, with the world's own trusted context and no hand-made operation or record.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { agentActorOf } from '../../src/core/work-graph/model/tool-commit-arguments.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { openS7CHandoffWorld, type S7CHandoffWorld } from '../helpers/S7C-handoff-fixture.js';

let opened: S7CHandoffWorld | undefined;
afterAll(async () => { await opened?.close(); opened = undefined; });

function inputOf(target: S7CHandoffWorld, change: {
  source?: SessionRef; caller?: SessionRef; run?: S7CHandoffWorld['sourceRun']; duty?: 'executor' | 'adviser';
  tasks?: readonly TaskTriple[];
  target?: { kind: 'create'; duty: 'executor' | 'adviser' } | { kind: 'existing'; session: SessionRef };
}, label: string) {
  const source = change.source ?? target.lines.source.ref;
  return {
    commandId: `s7c-h-entry-${label}`,
    caller: {
      actor: agentActorOf(change.caller ?? target.lines.source.ref, change.run ?? target.sourceRun),
      session: change.caller ?? target.lines.source.ref,
      run: change.run ?? target.sourceRun,
      duty: change.duty ?? 'executor' as const,
    },
    source,
    assignments: [{ target: change.target ?? { kind: 'create' as const, duty: 'executor' as const },
      tasks: [...(change.tasks ?? target.tasks.slice(0, 3))] }],
    reason: `S7C H-entry ${label}`,
  };
}

describe('H-entry: the understanding is the source Run\'s own', () => {
  it('opens FH-1 and calls the handoff entry on the source Run\'s own line', async () => {
    opened = await openS7CHandoffWorld();
    const { requestHandoff } = opened.handoffEntry;
    const result = await requestHandoff(opened.world.systemContext(), inputOf(opened, {
      source: opened.lines.source.ref, tasks: opened.tasks.slice(0, 1),
    }, 'own-line'));
    expect(result).toMatchObject({ status: 'accepted' });
  });

  const understanding = [
    { name: 'missing: the handed Goal has no understanding', task: 'clean' },
    { name: 'foreign: a person\'s note is not a Run\'s', task: 'clean', userNote: true },
    { name: 'other Run: another Run\'s note is not the source Run\'s', task: 'other' },
  ] as const;

  it.each(understanding)('$name', async row => {
    const target = opened!;
    let handed = row.task === 'other' ? target.other : target.clean;
    let run: RunRef = target.sourceRun;
    if (row.task === 'other') {
      // A real foreign note: the source Run's understanding on the main Goal, with a SECOND real Run of the
      // same Session as the caller. The note exists (proved below through notes/list) and belongs to the
      // source Run, not to the caller Run; only comparing the Run keeps this `incomplete`.
      const second = target.tasks[1]!;
      await advanceUntil(target.world.ag2b, { schemaVersion: 1, goalRef: target.goal,
        flowId: 's7c-h-entry-other-run', sessionHint: target.lines.source.ref, kind: 'select_work',
        taskId: second.taskId }, 'start');
      const facts = await target.world.post('sessions/facts', plain(S6A_SCOPE, target.lines.source.ref));
      const factsBody = facts.body as { status: string; value: { latestWork: { runRef: RunRef } | null } };
      if (factsBody.status !== 'ready' || factsBody.value.latestWork === null) {
        throw new Error('H-entry: the second claim has no Run');
      }
      run = factsBody.value.latestWork.runRef;
      expect(run.runId).not.toBe(target.sourceRun.runId);
      handed = { goal: target.goal, task: target.tasks[0]! };
      const notes = await target.world.post('notes/list', plain(S6A_SCOPE, {
        goalId: target.goal.goalId, state: 'accepted', limit: 20, cursor: null,
      }));
      const notesBody = notes.body as { status: string; value: { items: { kind: string;
        source: { kind: string; runRef: RunRef | null } }[] } };
      const note = notesBody.status === 'ready'
        ? notesBody.value.items.find(item => item.kind === 'understanding' && item.source.kind === 'agent'
          && item.source.runRef?.runId === target.sourceRun.runId)
        : undefined;
      if (note === undefined) throw new Error('H-entry: the source Run wrote no understanding on its Goal');
      expect(note.source.runRef?.runId).toBe(target.sourceRun.runId);
      expect(run.runId).not.toBe(note.source.runRef?.runId);
    }
    if ('userNote' in row && row.userNote) {
      // A real person's understanding on the handed Goal, through the public `notes/write` route.
      const pointer = await target.world.platform.notes.listByAnchor(target.world.humanContext(),
        { anchor: { kind: 'goal', goalId: handed.goal.goalId }, limit: 1, cursor: null });
      if (pointer.status !== 'ready' || pointer.value.pointer === null) throw new Error('H-entry: no pointer');
      const written = await target.world.post('notes/write', plain(S6A_SCOPE, {
        commandId: 's7c-h-entry-user-note', goalId: handed.goal.goalId,
        expectedPointerRevision: pointer.value.pointer.revision,
        note: { kind: 'understanding', topic: 's7c-h-entry-foreign', conclusion: 'a person wrote this',
          anchor: { kind: 'goal', goalId: handed.goal.goalId }, extraAnchors: [], facts: [], basisFiles: [],
          structural: false, replaces: [], contradicts: [], coexistWith: [],
          sections: { status: 'ready', decided: 'foreign', open: 'none', next: 'none', risks: 'none' } },
      }));
      expect(written.httpStatus).toBe(200);
    }
    const { requestHandoff } = target.handoffEntry;
    const result = await requestHandoff(target.world.systemContext(), inputOf(target, {
      source: target.lines.source.ref, run, tasks: [handed.task],
    }, row.name));
    expect(result).toMatchObject({ status: 'incomplete' });
    if (result.status === 'incomplete') expect(result.text.length).toBeGreaterThan(0);
  });

});

describe('H-entry: the caller and the source line', () => {
  it('normalizes a create target\'s duty to the source line\'s duty', async () => {
    const target = opened!;
    const card = await target.world.readSession(target.lines.creator);
    const link = card.links.find(candidate => candidate.ref.relation === 'responsible'
      && candidate.until === null && candidate.ref.target.kind === 'task');
    if (link === undefined || link.ref.target.kind !== 'task') throw new Error('H-entry: the creator holds no Task');
    const facts = await target.world.post('sessions/facts', plain(S6A_SCOPE, target.lines.creator.ref));
    const body = facts.body as { status: string; value: { latestWork: { runRef: S7CHandoffWorld['sourceRun'] } | null } };
    expect(body.status).toBe('ready');
    const run = body.value.latestWork?.runRef;
    if (run === undefined) throw new Error('H-entry: the creator has no Work Run');
    const { requestHandoff } = target.handoffEntry;
    const result = await requestHandoff(target.world.systemContext(), inputOf(target, {
      source: target.lines.creator.ref, caller: target.lines.creator.ref, run,
      tasks: [link.ref.target.ref], target: { kind: 'create', duty: 'adviser' },
    }, 'duty-normalized'));
    expect(result).toMatchObject({ status: 'accepted' });
  });

  it('refuses an adviser tool handoff whose existing target is another adviser', async () => {
    if (opened === undefined) opened = await openS7CHandoffWorld();
    const target = opened;
    const main = s6aCardsWorkspace(target.world, S6A_SCOPE);
    const adviserCard = await target.world.readSession(target.lines.adviser.ref);
    const second = await createS6BLine(main, { label: 's7c-h-entry-second-adviser', role: adviserCard.record.role });
    expect(second.ref.sessionId).not.toBe(target.lines.adviser.ref.sessionId);
    const { requestHandoff } = target.handoffEntry;
    const result = await requestHandoff(target.world.systemContext(), inputOf(target, {
      source: target.lines.adviser.ref, caller: target.lines.adviser.ref, run: target.lines.adviserRun,
      duty: 'adviser', tasks: [], target: { kind: 'existing', session: second.ref },
    }, 'adviser-existing'));
    // The tool handoff may only hand to an active executor line; the source adviser has no unfinished operation.
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('an adviser hands its own line with no tasks', async () => {
    const target = opened!;
    const { requestHandoff } = target.handoffEntry;
    const result = await requestHandoff(target.world.systemContext(), inputOf(target, {
      source: target.lines.adviser.ref, caller: target.lines.adviser.ref, run: target.lines.adviserRun,
      duty: 'adviser', tasks: [],
    }, 'adviser-own'));
    expect(result).toMatchObject({ status: 'needs_decision' });
    if (result.status !== 'needs_decision') return;
    const operation = await target.world.post('sessions/operation', plain(S6A_SCOPE, result.operation));
    expect(operation.httpStatus).toBe(200);
    const body = operation.body as { status: string;
      value: { action: { progress: { approval: { required: string } } } } };
    expect(body.status).toBe('ready');
    expect(body.value.action.progress.approval.required).toBe('long');
  });

  it('refuses a secretary line as the source', async () => {
    const target = opened!;
    const secretary = await target.world.createSecretary('s7c-h-entry-secretary');
    const { requestHandoff } = target.handoffEntry;
    const result = await requestHandoff(target.world.systemContext(), inputOf(target, {
      source: secretary.ref, tasks: target.tasks.slice(0, 1),
    }, 'secretary'));
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('refuses a task the source does not hold', async () => {
    const target = opened!;
    const { requestHandoff } = target.handoffEntry;
    const result = await requestHandoff(target.world.systemContext(), inputOf(target, {
      source: target.lines.source.ref, tasks: [target.tasks[3]!],
    }, 'foreign-task'));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
  });
});

describe('H-entry: the current understanding', () => {
  it('a superseded source-Run note is not a current understanding', async () => {
    const target = opened!;
    const pointer = await target.world.platform.notes.listByAnchor(target.world.humanContext(),
      { anchor: { kind: 'goal', goalId: target.goal.goalId }, limit: 1, cursor: null });
    if (pointer.status !== 'ready' || pointer.value.pointer === null) throw new Error('H-entry: no pointer');
    // A person's newer understanding replaces the source Run's note, so that note is no longer current.
    const written = await target.world.post('notes/write', plain(S6A_SCOPE, {
      commandId: 's7c-h-entry-supersede', goalId: target.goal.goalId,
      expectedPointerRevision: pointer.value.pointer.revision,
      note: { kind: 'understanding', topic: 's7c-h-entry-supersede', conclusion: 'a person replaced it',
        anchor: { kind: 'goal', goalId: target.goal.goalId }, extraAnchors: [], facts: [], basisFiles: [],
        structural: false, replaces: [target.note.noteId], contradicts: [], coexistWith: [],
        sections: { status: 'ready', decided: 'newer', open: 'none', next: 'none', risks: 'none' } },
    }));
    expect(written.httpStatus).toBe(200);
    const { requestHandoff } = target.handoffEntry;
    const result = await requestHandoff(target.world.systemContext(), inputOf(target, {
      source: target.lines.source.ref, run: target.sourceRun, tasks: [target.tasks[0]!],
    }, 'superseded'));
    expect(result).toMatchObject({ status: 'incomplete' });
  });
});
