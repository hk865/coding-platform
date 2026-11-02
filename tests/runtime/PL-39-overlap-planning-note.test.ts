/**
 * PL-39: a planning-round module convention predates A's start; dispatching the
 * second same-module Task B opens N's gate, the note is too old, the Host sends
 * the one `overlap-note:` system `action_request`, and the adviser's text round
 * writes the newer current note so the gate rechecks satisfied and B starts.
 *
 * Every step is the real F4 Host: `openPLOverlapWorld`, `workflow/advance`,
 * `goals/overlap-gates`, the Host consume loop, the scripted model's real
 * `record_note` call and `notes/list` / the note owner's current-version read.
 * No hand-made ctx and no direct handler. The older convention is written by a
 * real planning round before A: the person's `action_request` reaches the idle
 * adviser, the Host opens the intervention planning Query and the scripted
 * model calls `record_note`.
 *
 * It never falls back to a person `notes/write`, a direct handler or a hand-built context.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { compareCursors } from '../../src/contracts/ledger.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { awaitPlanningAnswer, heartbeatUntil, readBody, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import {
  currentVersions, gatesOf, notesOnModule, openPLOverlapWorld, select, type PLOverlapWorld,
} from '../helpers/PL-forms-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { S7C1_CREATE_ROLE } from '../helpers/S7C-member-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';

const MODULE = 's6a-core';
const SEED_TOPIC = 'pl39-interface';
const SEED_CONCLUSION = 'the module interface agreed before A started';
const NEW_CONCLUSION = 'the module interface agreed after A started';

let opened: PLOverlapWorld | undefined;
afterEach(async () => { await opened?.close(); opened = undefined; });

describe('PL-39: the planning note is older than A, so the adviser updates it', () => {
  it('opens not_satisfied, sends one overlap-note request, writes the newer note and starts B', async () => {
    opened = await openPLOverlapWorld({ firstRun: 'deferred' });
    const target = opened;

    // The older convention is written by a real planning round before A: the person's action_request
    // reaches the idle adviser, the Host opens the intervention planning Query and the scripted model
    // calls `record_note` (never a hand-built Query or a person `notes/write`).
    await target.script(target.adviser, [
      { kind: 'calls', calls: [{ callId: 'pl39-seed-note', name: 'record_note', args: {
        op: 'write', kind: 'convention', topic: SEED_TOPIC, conclusion: SEED_CONCLUSION,
        anchor: { kind: 'module', moduleId: MODULE }, extraAnchors: [], facts: [], basisFiles: [],
        replaces: [], contradicts: [], coexistWith: [], structural: false,
        body: 'PL-39 older interface note',
      } }] },
      { kind: 'text', text: 'PL-39 older interface note written' },
    ]);
    const seedMessage = await sendS7A2PersonMessage(target.world.world, {
      label: 'pl39-planning-note', recipient: target.adviser.ref, goal: target.world.goal,
    });
    const seedQuery = await heartbeatUntil(target.world.world,
      () => readPlanningQuery(target.world.world, seedMessage.ref), read => read !== null, 16);
    expect(seedQuery, 'the Host offers no planning Query for the person action_request, so no '
      + 'planning round can write the older module convention. Stop point: offerKindOf / handleIntervention. '
      + 'Missing owner: P2.').not.toBeNull();
    if (seedQuery === null) throw new Error('PL-39: the planning seed Query is missing');
    expect(seedQuery.job.job.intent.execution).toMatchObject({
      kind: 'intervention_planning', sourceMessageRef: seedMessage.ref,
    });
    // The planning Query's `record_note` reaches the one note owner; the composition gap is L's
    // `NoteServiceDependencies.queryRun` (the owner requires it, the composition passes `secretaryQueryRun`).
    const seedNotes = await heartbeatUntil(target.world.world, () => notesOnModule(target),
      notes => notes.some(item => item.conclusion === SEED_CONCLUSION), 16);
    const seedNote = seedNotes.find(item => item.conclusion === SEED_CONCLUSION);
    expect(seedNote, 'the planning Query carries record_note but the note owner cannot resolve '
      + 'it because the composition root passes `secretaryQueryRun` while NoteServiceDependencies.queryRun is '
      + 'required. Stop point: create-platform.ts:2419 / note-service.ts:98. Missing owner: L.').toBeDefined();
    if (seedNote === undefined) throw new Error('PL-39: the older planning note is not listed');
    const seedNoteId = seedNote.noteId;

    // A (m1) starts after the note, so its Run's start cursor is later than the note's `since`.
    await target.world.holdFirst();
    const firstRun = target.world.run;
    expect(firstRun.started).toBe(true);
    const firstStart = (await target.world.world.post('executions/read', plain(S6A_SCOPE, firstRun.runRef)))
      .body as { status: string; value?: { run: { startedSince: CommitCursor | null } } };
    expect(firstStart.status).toBe('ready');
    const startCursor = firstStart.value?.run.startedSince;
    if (startCursor === null || startCursor === undefined) throw new Error('PL-39: A has no start cursor');

    // B is the second same-module Task.
    await createS6BLine(target.world.main, {
      label: 'pl39-b', role: S7C1_CREATE_ROLE, tasks: [target.world.tasks[1]!],
    });
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(target.world.world.ag2b,
      select(target, 'pl39-b-dispatch', target.world.tasks[1]!.taskId), { receipts });

    // The gate opens, finds the older note not satisfying, and sends the one note request.
    const openedGate = receipts.find(receipt => receipt.kind === 'open_overlap_gate');
    expect(openedGate).toMatchObject({ kind: 'open_overlap_gate',
      result: { status: 'opened', noteRequest: 'sent' } });

    const firstGates = await gatesOf(target);
    const gate = firstGates.find(candidate => candidate.ref.taskId === target.world.tasks[1]!.taskId);
    if (gate === undefined) throw new Error('PL-39: the B overlap gate is missing');
    expect(gate.release).toBeNull();
    expect(gate.running).toHaveLength(1);
    expect(gate.running[0]).toMatchObject({
      task: { taskId: target.world.tasks[0]!.taskId }, startCursor,
    });
    const firstCheck = await target.world.world.platform.overlapGates.checkOverlapGate(
      target.world.world.systemContext(), { gate: gate.ref });
    expect(firstCheck, 'the gate with only the older note is not satisfied').toEqual({
      status: 'ready', value: { status: 'not_satisfied' },
    });

    // Exactly one Host system `overlap-note:` action_request reaches the adviser line.
    const inbox = await listed(target.world.world, 'inbox', target.adviser);
    const noteRequests = inbox.filter(message => message.intent === 'action_request'
      && message.sender.kind === 'host' && message.sender.actor.kind === 'system');
    expect(noteRequests).toHaveLength(1);
    const request = noteRequests[0]!;
    expect(request.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'workflow:auto-rework' } });
    expect(gate.noteRequest).toMatchObject({
      recipient: { projectId: S6A_SCOPE.projectId, sessionId: target.adviser.ref.sessionId },
      duty: 'adviser', messageRef: request.ref,
    });
    expect(await readBody(target.world.world, request.ref, 'message'))
      .toBe('模块被占用，请为这个模块写一条接口注记：s6a-core');

    // The adviser's real text round writes the newer note through the scripted model.
    await target.script(target.adviser, [
      { kind: 'calls', calls: [{ callId: 'pl39-note', name: 'record_note', args: {
        op: 'write', kind: 'convention', topic: SEED_TOPIC, conclusion: NEW_CONCLUSION,
        anchor: { kind: 'module', moduleId: MODULE }, extraAnchors: [], facts: [], basisFiles: [],
        replaces: [seedNoteId], contradicts: [], coexistWith: [], structural: false,
        body: 'PL-39 newer interface note',
      } }] },
      { kind: 'text', text: 'PL-39 interface note updated' },
    ]);
    // The N round's Query is located by N's own source message, through the existing planning-Query read.
    const nQuery = await awaitPlanningAnswer(target.world.world, request.ref);
    expect(nQuery, 'the Host offers no host-system action_request Query to the adviser, so the '
      + 'adviser cannot write the overlap note. Stop point: offerKindOf / handleIntervention. '
      + 'Missing owner: P2.').not.toBeNull();
    if (nQuery === null) throw new Error('PL-39: no overlap-note Query');
    const runRef = nQuery.run.ref;

    // The frozen round is a text round: manifest answerShape null (the `text` default), no request.
    const execution = nQuery.job.job.intent.execution;
    expect(execution).toMatchObject({ kind: 'intervention_planning', sourceMessageRef: request.ref });
    const answerShape = 'answerShape' in execution ? execution.answerShape : undefined;
    expect(['plan_round', 'plan_review']).not.toContain(answerShape);
    const prepared = nQuery.run.run.executionState?.prepared;
    expect(prepared).not.toBeNull();
    if (prepared === null || prepared === undefined) throw new Error('PL-39: the Query has no frozen manifest');
    const manifestBody = (await target.world.world.post('materials/open', plain(S6A_SCOPE, {
      ref: prepared.bundleRef, usage: 'historical_explanation',
    }))).body as { status: string; value?: { body: string } };
    expect(manifestBody.status).toBe('ready');
    if (manifestBody.status !== 'ready' || manifestBody.value === undefined) {
      throw new Error('PL-39: the frozen manifest is not readable');
    }
    const manifest = JSON.parse(manifestBody.value.body) as PreparedQueryManifestV1;
    expect(manifest.answerShape).toBeNull();
    expect(manifest.request).toBeNull();

    // The tool table is the planning text table: record_note, no submit/mail/member tools.
    const turns = await target.world.world.scripted.requests(target.adviser);
    const noteTurn = turns.find(turn => turn.tools.some(tool => tool.name === 'record_note')
      && !turn.tools.some(tool => tool.name === 'submit_plan_round'));
    const tools = noteTurn?.tools.map(tool => tool.name) ?? [];
    expect(tools).toContain('record_note');
    expect(tools).not.toContain('submit_plan_round');
    expect(tools).not.toContain('submit_plan_review');
    expect(tools).not.toContain('send_session_message');
    expect(tools).not.toContain('respond_session_message');
    expect(tools).not.toContain('create_member');

    // The note owner dispatched the text round to the planning resolver: duty adviser, this QueryRun.
    const notes = await notesOnModule(target);
    const written = notes.find(item => item.conclusion === NEW_CONCLUSION);
    expect(written, 'the overlap-note Query is a text round with record_note, but the note owner '
      + 'cannot resolve it because the composition root passes `secretaryQueryRun` while '
      + 'NoteServiceDependencies.queryRun is required. Stop point: create-platform.ts:2419 / note-service.ts:98. '
      + 'Missing owner: L.').toBeDefined();
    if (written === undefined) throw new Error('PL-39: the adviser note is not listed');
    expect(written).toMatchObject({ kind: 'convention', anchor: { kind: 'module', moduleId: MODULE },
      storedState: 'accepted', currentEligible: true,
      source: { kind: 'agent', duty: 'adviser', queryRunRef: runRef } });
    expect(notes.some(item => item.noteId === seedNoteId && item.currentEligible)).toBe(false);

    // The new current version's `since` is strictly later than A's start cursor.
    const currents = await currentVersions(target);
    const current = currents.find(version => version.noteId === written.noteId);
    expect(current).toBeDefined();
    if (current === undefined) throw new Error('PL-39: the new note has no current version');
    expect(compareCursors(current.since, startCursor)).toBe(1);

    // Recheck satisfied by the note; B then claims and starts its own Run.
    const after = await target.world.world.platform.overlapGates.checkOverlapGate(
      target.world.world.systemContext(), { gate: gate.ref });
    expect(after).toEqual({ status: 'ready', value: { status: 'satisfied', by: 'note' } });
    const runReceipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(target.world.world.ag2b,
      select(target, 'pl39-b-start', target.world.tasks[1]!.taskId),
      { stopBefore: 'open_checks', receipts: runReceipts });
    const claim = runReceipts.find(receipt => receipt.kind === 'claim_task');
    expect(claim).toMatchObject({ kind: 'claim_task', result: { status: 'committed' } });
    // The claim alone does not prove B started: read the claimed Run and require its start cursor.
    if (claim === undefined || claim.kind !== 'claim_task' || claim.result.status !== 'committed') {
      throw new Error('PL-39: B was not claimed');
    }
    const startedB = await readExecution(target.world.world.ag2b, claim.result.value.runRef);
    expect(startedB.run.startedSince).not.toBeNull();

    // No `goals/overlap-release` bypass: the gate's release stayed null throughout.
    const finalGates = await gatesOf(target);
    const finalGate = finalGates.find(candidate => candidate.ref.taskId === target.world.tasks[1]!.taskId);
    expect(finalGate?.release).toBeNull();
  });
});
