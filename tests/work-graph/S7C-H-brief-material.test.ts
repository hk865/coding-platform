/**
 * H-brief-material (book-7c.md:1382; 7c2-start-rulings-v2.md:1166): the brief's material collection over the real
 * reads of FH-1's world. The row calls B1's `assembleHandoffBrief` with the world's own real owners: the Session
 * history owner over the world's Kernel registry, the one record backend, the note read model, the decision read
 * port and the Query execution read. No record, context or Query is fabricated.
 *
 * The last block is H-08's stored-brief read: a failed page is `unavailable`, and only a successful empty page is
 * the old path (no brief).
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { RoleScopeV1 } from '../../src/contracts/role-lines.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { assembleHandoffBrief, type HandoffBriefAssemblyDeps } from '../../src/core/agent-runtime/handoff-brief-assembly.js';
import { createWorkHandoffBriefRead } from '../../src/core/agent-runtime/execution-preparation.js';
import { WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP } from '../../src/core/work-graph/state/work-handoff-brief.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { claimQueryOn } from '../helpers/A2-restart-fixture.js';
import { ag2bPlanDraft, graphWrite, plain, startBusyQuery } from '../helpers/AG2b-collaboration-fixture.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { generalNote } from '../helpers/S4C2-note-card-fixture.js';
import { agentActorOf } from '../../src/core/work-graph/model/tool-commit-arguments.js';
import { committed, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { openS7CHandoffWorld, s7cAdviserRoleBinding, type S7CHandoffWorld } from '../helpers/S7C-handoff-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

let opened: S7CHandoffWorld | undefined;

afterEach(() => { commitBarrier.reset(); });

afterAll(async () => {
  commitBarrier.reset();
  await opened?.close();
  opened = undefined;
});

async function world(): Promise<S7CHandoffWorld> {
  if (opened === undefined) opened = await openS7CHandoffWorld();
  return opened;
}

/**
 * The assembly's dependencies as the composition hands them: the world's own Kernel registry and the real owners
 * published on its platform. `disconnect.records` is the one `backend.records` instance the platform built (the
 * only published reference to it); the service needs the wider port the assembler declares.
 */
function depsOf(target: S7CHandoffWorld): HandoffBriefAssemblyDeps {
  const platform = target.world.platform;
  return {
    history: createSessionHistoryCursorOwner({ kernelStores: platform.kernelStores }),
    records: platform.disconnect.records as unknown as HandoffBriefAssemblyDeps['records'],
    notes: platform.notes,
    decisions: platform.decisions,
    queryExecution: platform.reconcile,
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

/** BRIEFQ: the adviser assembly now takes the operation's handed scope; the type gains the field in production. */
type AdviserAssemblyInputV1 = Parameters<typeof assembleHandoffBrief>[2] & { handedScope: RoleScopeV1[] };


async function sourceRecordOf(target: S7CHandoffWorld, run: { projectId: string; goalId: string; runId: string }):
Promise<TaskExecutionRecord> {
  return ready<TaskExecutionRecord>(await target.world.post('executions/read', plain(S6A_SCOPE, run)),
    'the source Run record');
}

const WAIT_GOAL_ID = 's7b-goal-s7b2-consume-wait-24';
/** The two Task ids of the wait Goal's adopted Plan (the consume seed's own literals). */
const WAIT_TASK_IDS = ['s7b-s7b2-consume-wait-24-send', 's7b-s7b2-consume-wait-24-reply'];

describe('H-brief-material: the adviser brief', () => {
  it('covers the whole project, the note index, the open decisions and the last three Query answers', async () => {
    const target = await world();
    const source = target.lines.adviser;
    // Four real ended Query rounds on the adviser Session; only the last three are material, each cut to 2 KiB.
    const answers = [
      'the first answer is dropped',
      'A'.repeat(3000),
      'the third answer',
      '中'.repeat(1000),
    ];
    const runs: string[] = [];
    for (const [index, answer] of answers.entries()) {
      target.world.clock.advance(1_000);
      const suffix = `s7c-h-material-query-${index + 1}`;
      const cardNow = await target.world.readSession(source);
      const claimed = await claimQueryOn(target.world.ag2b,
        { ref: cardNow.record.ref, revision: cardNow.record.revision }, suffix, s7cAdviserRoleBinding());
      await target.world.scripted.script(source, [{ kind: 'text', text: answer }]);
      const started = await startBusyQuery(target.world.ag2b,
        { queryJobRef: claimed.queryJobRef, queryRunRef: claimed.queryRunRef }, suffix);
      expect(started.answer).not.toBeNull();
      runs.push(claimed.queryRunRef.runId);
    }

    const main = s6aCardsWorkspace(target.world, S6A_SCOPE);
    const moduleId = 's6a-core';
    const moduleGoal = (await main.createGoal('s7c-h-material-module-goal', 'S7C handoff material module goal')).ref;
    // A real Plan with a module-scoped Task, the public plan step; the module note is the public person's write.
    const moduleTaskId = 's7c-h-material-module-task';
    const draft = ag2bPlanDraft([moduleTaskId]);
    draft.planId = 's7c-h-material-module-plan';
    draft.goalId = moduleGoal.goalId;
    draft.tasks = draft.tasks.map(task => task.taskId === moduleTaskId
      ? { ...task, scope: { kind: 'module' as const, stageId: 's7c-h-material-stage', moduleRef: moduleId } }
      : task);
    draft.assignments = [{ taskId: moduleTaskId, role: S6A_WORK_ROLE.templateId,
      instruction: 'S7C handoff material module work' }];
    const proposed = committed<{ ref: unknown; revision: number }>(await main.post('plans/propose',
      graphWrite(S6A_SCOPE, { goalRef: moduleGoal, basedOn: null, draft,
        reason: { text: 'S7C handoff material module plan', sources: [] } }, 's7c-h-material-module-propose')),
    'the module Plan proposal');
    committed(await main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
    }, 's7c-h-material-module-apply')), 'the module Plan adoption');
    const modulePointer = await target.world.platform.notes.listByAnchor(target.world.systemContext(),
      { anchor: { kind: 'module', moduleId }, limit: 1, cursor: null });
    if (modulePointer.status !== 'ready') throw new Error('the module note pointer is not readable');
    const written = await target.world.post('notes/write', plain(S6A_SCOPE, {
      commandId: 's7c-h-material-module-note', goalId: null,
      expectedPointerRevision: modulePointer.value.pointer?.revision ?? null,
      note: generalNote({ anchor: { kind: 'module', moduleId }, topic: 's7c-h-material-module',
        conclusion: 'the person wrote the module note' }),
    }));
    const writeBody = written.body as { write?: { status?: string; reason?: string } };
    if (writeBody.write?.status !== 'accepted') throw new Error(`the module note write: ${JSON.stringify(writeBody)}`);
    const moduleNotes = ready<{ items: NoteItemV1[] }>(await target.world.post('notes/list', plain(S6A_SCOPE, {
      anchor: { kind: 'module', moduleId }, state: 'accepted', limit: 20, cursor: null,
    })), 'the module notes');
    const moduleNote = moduleNotes.items.find(item => item.conclusion === 'the person wrote the module note');
    if (moduleNote === undefined) throw new Error('the module note is not listed');

    // A real open decision: a tool handoff at every_step opens its approval card on the main Goal.
    await setS7AAutonomy(target.world, target.goal, 'every_step');
    const accepted = await target.world.platform.sessionHandoff.acceptHandoff(target.world.systemContext(), {
      commandId: 's7c-h-material-approval', workspace: { ...S6A_SCOPE }, source: target.lines.source.ref,
      trigger: 'tool',
      assignments: [{ target: { kind: 'existing', session: target.lines.existing.ref }, tasks: [target.tasks[0]!] }],
      tool: { caller: { actor: agentActorOf(target.lines.source.ref, target.sourceRun),
        session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' },
      reason: 'S7C H-brief-material', understanding: [{ noteId: target.note.noteId, version: target.note.version }] },
    });
    expect(accepted).toMatchObject({ status: 'committed', value: { approval: { state: 'pending' } } });
    const cards = await main.readCards();
    const approval = cards.find(candidate => candidate.source.kind === 'handoff_approval');
    if (approval === undefined) throw new Error('the approval card is not in the queue');
    // The open card does not move with the Goal's autonomy: restore the fixture's tier for the later rows.
    await setS7AAutonomy(target.world, target.goal, 'after_plan_confirmation');

    // The fixture's adviser Run wrote this current understanding on the Goal it owns; the source Run's
    // note is not used here.
    const page = ready<{ items: NoteItemV1[] }>(await target.world.post('notes/list', plain(S6A_SCOPE, {
      goalId: 's7c-handoff-adviser-goal', state: 'accepted', limit: 20, cursor: null,
    })), 'the adviser Goal notes');
    const adviserNote = page.items.find(item => item.kind === 'understanding'
      && item.source.kind === 'agent' && item.source.runRef?.runId === target.lines.adviserRun.runId);
    if (adviserNote === undefined) throw new Error('the adviser Run wrote no understanding on its own Goal');
    const input: AdviserAssemblyInputV1 = {
      duty: 'adviser', source: source.ref, sourceRun: target.lines.adviserRun,
      workspaceId: S6A_SCOPE.workspaceId, signal: signal(), understanding: null,
      handedScope: [{ kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId,
        goalId: 's7c-handoff-adviser-goal' } }],
    };
    const result = await assembleHandoffBrief(depsOf(target), target.world.systemContext(), input);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.value.duty !== 'adviser') return;
    const material = result.value as typeof result.value & { handedScope: RoleScopeV1[] };

    // The adviser's Run served only its own Goal; the wait Goal's adopted Plan is still covered.
    const own = material.goals.find(entry => entry.goalRef.goalId === 's7c-handoff-adviser-goal');
    expect(own?.tasks.map(entry => entry.task.taskId)).toEqual(['s7c-handoff-adviser-task', 'ag2b-gate']);
    const wait = material.goals.find(entry => entry.goalRef.goalId === WAIT_GOAL_ID);
    expect(wait?.tasks.map(entry => entry.task.taskId)).toEqual([...WAIT_TASK_IDS, 'ag2b-gate']);
    // The module Task's note index is non-empty; every other Goal declares no module.
    const moduleEntry = material.goals.find(entry => entry.goalRef.goalId === moduleGoal.goalId);
    expect(moduleEntry?.noteIndex).toEqual([{ moduleId, notes: [{ noteRef: moduleNote.noteId, version: 1 }] }]);
    for (const entry of material.goals) {
      if (entry.goalRef.goalId !== moduleGoal.goalId) expect(entry.noteIndex).toEqual([]);
    }
    // The open handoff approval is the main Goal's one waiting decision, as the public queue reads it.
    const mainEntry = material.goals.find(entry => entry.goalRef.goalId === target.goal.goalId);
    expect(mainEntry?.openDecisions).toContainEqual({ source: 'handoff_approval', key: approval.source.key });
    // The last three ended Query answers in natural order; the first is dropped and both 2 KiB cuts are literal.
    expect(material.queryAnswers.map(answer => answer.run.runId)).toEqual(runs.slice(1));
    expect(material.queryAnswers.map(answer => answer.body))
      .toEqual(['A'.repeat(2048), 'the third answer', '中'.repeat(682)]);

    expect(material.understanding).toEqual([{ noteId: adviserNote.noteId, version: adviserNote.version }]);
    expect(material.oldLine).toEqual(source.ref);
    // BRIEFQ: the assembly returns the operation's handed scope unchanged.
    expect(material.handedScope).toEqual([{ kind: 'goal', goalRef: { aggregateType: 'Goal',
      projectId: S6A_SCOPE.projectId, goalId: 's7c-handoff-adviser-goal' } }]);
  }, 180_000);

  it('answers unavailable, never an empty material, when the ended-query lookup fails', async () => {
    const target = await world();
    const fault = commitBarrier.failReads(S2B_QUERY_RUN_BY_SESSION_ENDED_LOOKUP, 'throw-once');
    const input: AdviserAssemblyInputV1 = {
      duty: 'adviser', source: target.lines.adviser.ref, sourceRun: target.lines.adviserRun,
      workspaceId: S6A_SCOPE.workspaceId, signal: signal(), understanding: null,
      handedScope: [{ kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId,
        goalId: 's7c-handoff-adviser-goal' } }],
    };
    const result = await assembleHandoffBrief(depsOf(target), target.world.systemContext(), input);
    expect(fault.calls()).toBe(1);
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
  }, 120_000);
});

describe('H-brief-material: the executor brief', () => {
  it('reads the handed tasks and the source Run\'s formal final answer', async () => {
    const target = await world();
    const handed: TaskTriple[] = target.tasks.slice(0, 3);
    const result = await assembleHandoffBrief(depsOf(target), target.world.systemContext(), {
      duty: 'executor', source: target.lines.source.ref, sourceRun: target.sourceRun,
      sourceRecord: await sourceRecordOf(target, target.sourceRun), tasks: handed,
      workspaceId: S6A_SCOPE.workspaceId, signal: signal(), understanding: null,
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.value.duty !== 'executor') return;
    const material = result.value;
    expect(material.tasks.map(entry => entry.task.taskId)).toEqual(handed.map(task => task.taskId));
    // The handed Task's own current phase after the source Run advanced t1 to a ended completed Run with no round
    // yet (projectTaskPhase P11), never the adopted Plan's phase.
    expect(material.tasks.map(entry => entry.phase)).toEqual(['verifying', 'pending', 'pending']);
    expect(material.tasks.map(entry => entry.lastResult)).toEqual(['completed', null, null]);
    expect(material.conclusion).toMatchObject({
      run: target.sourceRun, body: 'S7C handoff source answer',
    });
    if ('absent' in material.conclusion) throw new Error('the source Run has a formal answer');
    expect(material.conclusion.finalMessageId.length).toBeGreaterThan(0);
    // Every Task of this plan is goal-scoped, so no module is declared and the index is the empty literal.
    expect(material.noteIndex).toEqual([]);
    expect(material.understanding).toEqual([{ noteId: target.note.noteId, version: target.note.version }]);
    expect(material.oldLine).toEqual(target.lines.source.ref);
  }, 120_000);
});

describe('H-brief-material: the absent conclusion', () => {
  it('reports the named absence for a source Run that never entered', async () => {
    const target = await world();
    const second = target.tasks[1]!;
    const claimed = await import('../helpers/A2-restart-fixture.js').then(module =>
      module.advanceUntil(target.world.ag2b, { schemaVersion: 1, goalRef: target.goal,
        flowId: 's7c-h-brief-material-not-entered', sessionHint: target.lines.source.ref,
        kind: 'select_work', taskId: second.taskId }, 'start'));
    const facts = ready<{ latestWork: { runRef: RunRef } | null }>(
      await target.world.post('sessions/facts', plain(S6A_SCOPE, target.lines.source.ref)),
      'the source facts');
    if (facts.latestWork === null) throw new Error('the second claim has no Run');
    const result = await assembleHandoffBrief(depsOf(target), target.world.systemContext(), {
      duty: 'executor', source: target.lines.source.ref, sourceRun: facts.latestWork.runRef,
      sourceRecord: await sourceRecordOf(target, facts.latestWork.runRef), tasks: [second],
      workspaceId: S6A_SCOPE.workspaceId, signal: signal(), understanding: null,
    });
    expect(claimed.kind).toBe('perform');
    expect(result.status).toBe('ready');
    if (result.status !== 'ready' || result.value.duty !== 'executor') return;
    expect(result.value.conclusion).toEqual({ absent: 'no_formal_final_answer' });
  }, 120_000);
});

describe('H-brief-read: a failed stored-brief read is not "no brief"', () => {
  it('answers unavailable on a failed page and the old path null on a real empty page', async () => {
    const target = await world();
    const read = createWorkHandoffBriefRead({
      records: depsOf(target).records, operations: target.world.platform.sessions,
    });
    const input = { session: target.lines.scribe.ref, workspaceId: S6A_SCOPE.workspaceId };
    const fault = commitBarrier.failReads(WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP, 'throw-once');
    const failed = await read.readForSuccessor(target.world.systemContext(), input);
    expect(fault.calls()).toBe(1);
    expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
    // The same successful read with no record is the old path, not a failure.
    expect(await read.readForSuccessor(target.world.systemContext(), input))
      .toEqual({ status: 'ready', value: null });
  }, 120_000);
});
