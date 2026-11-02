/**
 * G-05: the planning answer boundary is `>` not `>=` (exactly 262,144 bytes
 * passes, 262,145 is capacity), the text fallback is 16 KiB (not 256 KiB), the
 * reply text is `planningReplyTextOf`'s, the planning `convention` note succeeds
 * while the same Query's goal `understanding` is `forbidden`, and a secretary
 * request round still succeeds without the mail tools.
 *
 * This row starts the real goal driver (`startGoalDriver`, the Host route the
 * production loop runs).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryJobAnswerSnapshot } from '../../src/contracts/query-job.js';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  awaitPlanningAnswer, awaitProposal, heartbeatUntil, heartbeatUntilModel, proposalRefOf, readBody,
  readPlanningQuery, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld, openPLOverlapWorld, select } from '../helpers/PL-forms-fixture.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { initializeProject } from '../helpers/S6A-history-fixture.js';
import { holdS6BRequestRound, createS6BLine } from '../helpers/S6B1-fixture.js';
import { S7C1_CREATE_ROLE } from '../helpers/S7C-member-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { captureQueryContexts } from '../helpers/query-context-capture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { toolOutputJson } from '../scenarios/support/common.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { systemRoundMessageRef, systemRoundRequestId, type SystemRoundV1 } from '../../src/contracts/plan-round.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

afterEach(() => {
  expect(commitBarrier.reset()).toEqual([]);
});

const WORK_TASK_ID = 'g05-work';
const SUMMARY = 'the G-05 planning summary';
const SHORT_TEXT = 'G-05 short text fallback, kept verbatim';
const FIXED_TEXT = 'G-05 overlap note written; no plan change';
const OVER_LONG = 'x'.repeat(16 * 1024 + 1);
const INSTRUCTION_100K = `G05-${'i'.repeat(102_400 - 8)}-END`;
const CONVENTION = 'G-05 module convention conclusion';
const UNDERSTANDING = 'G-05 goal understanding';

const PLAN = {
  stages: [{ stageId: 'g05-stage', title: 'G-05 next segment' }],
  tasks: [{
    taskId: WORK_TASK_ID, stageId: 'g05-stage', title: 'G-05 refine the next segment',
    requirementLevel: 'required' as const, taskKind: 'work' as const, disposition: 'active' as const,
    scope: { kind: 'stage' as const, stageId: 'g05-stage' }, executionIntent: 'request_execution' as const,
  }],
  assignments: [{ taskId: WORK_TASK_ID, role: S6A_WORK_ROLE.templateId, instruction: INSTRUCTION_100K }],
  obligations: [{
    obligationId: 'g05-delivery', title: 'G-05 delivery', requirementLevel: 'required' as const,
    taskIds: [WORK_TASK_ID], verificationRequirements: [{
      requirementId: 'g05-check', requirementLevel: 'required' as const, kind: 'test',
      description: 'G-05 checks the refined segment',
    }],
  }],
  taskHierarchy: { parentOf: [] as { parentTaskId: string; childTaskId: string }[] },
  executionDag: { dependsOn: [] as { taskId: string; dependsOnId: string; requires: { kind: 'gate-result'; label: string } }[] },
  taskRelations: [] as { fromTaskId: string; toTaskId: string; kind: 'coordination'; note: string }[],
};

type PlanLiteral = typeof PLAN;
type PlanRoundLiteral = { answerKind: 'plan'; summary: string; plan: PlanLiteral; reason: { text: string; affectedTaskIds: string[] } };

// The test's own complete v2 protocol literal: the fixed byte overhead is
// computed from this text, never from the production builder.
function v2AnswerText(form: PlanRoundLiteral): string {
  const plan = { ...form.plan, schemaVersion: 2,
    tasks: form.plan.tasks.map(task => ({ ...task, phase: 'pending' as const })) };
  return JSON.stringify({ schemaVersion: 2, kind: 'plan', summary: form.summary, plan, reason: form.reason });
}

const UNDERSTANDING_NOTE = {
  kind: 'understanding' as const, topic: 'g05-understanding', conclusion: UNDERSTANDING,
  anchor: { kind: 'goal' as const, goalId: '' }, extraAnchors: [], facts: [], basisFiles: [],
  replaces: [], contradicts: [], coexistWith: [], structural: false,
  sections: { status: 'active', decided: 'keep', open: 'none', next: 'refine', risks: 'none' },
};

const CONVENTION_NOTE = {
  kind: 'convention' as const, topic: 'g05-interface', conclusion: CONVENTION,
  anchor: { kind: 'stage' as const, goalId: '', stageId: '' }, extraAnchors: [], facts: [], basisFiles: [],
  replaces: [], contradicts: [], coexistWith: [], structural: false, body: 'G-05 convention body',
};

describe('G-05: the planning bounds and the note variants through the real Host', () => {
  it('proves the 262,144/262,145 bounds, the 100 KiB instruction, the text fallback and the notes', async () => {
    // 1. Exactly 262,144 bytes passes and 262,145 is refused. The filler is ASCII
    // and the target is the hand-computed 256 × 1024 bytes.
    // A 262,144-byte form is about 131,072 tokens, so this needs the 1M window's output reserve.
    const bounds = await openPlanOnlyWorld('g05', { contextWindowTokens: 1_000_000 });
    try {
      const exactPlan = structuredClone(PLAN);
      exactPlan.stages[0]!.stageId = bounds.stageId;
      exactPlan.tasks[0]!.stageId = bounds.stageId;
      exactPlan.tasks[0]!.scope = { kind: 'stage', stageId: bounds.stageId };
      const baseForm: PlanRoundLiteral = { answerKind: 'plan', summary: SUMMARY, plan: exactPlan,
        reason: { text: 'G-05 boundary', affectedTaskIds: [WORK_TASK_ID] } };
      const with100k = v2AnswerText(baseForm);
      const exactInstruction = INSTRUCTION_100K + 'y'.repeat(262_144 - Buffer.byteLength(with100k, 'utf8'));
      exactPlan.assignments[0]!.instruction = exactInstruction;
      const exactForm: PlanRoundLiteral = { ...baseForm, plan: exactPlan };
      expect(Buffer.byteLength(v2AnswerText(exactForm), 'utf8')).toBe(262_144);

      const overPlan = structuredClone(exactPlan);
      overPlan.assignments[0]!.instruction = `${exactInstruction}z`;
      const overForm: PlanRoundLiteral = { ...baseForm, plan: overPlan };
      expect(Buffer.byteLength(v2AnswerText(overForm), 'utf8')).toBe(262_145);

      const round: SystemRoundV1 = { kind: 'refine', goalRef: bounds.goal,
        target: { kind: 'stage', stageId: bounds.stageId }, planRevision: 1 };
      const requestId = systemRoundRequestId(round);
      if (requestId.status !== 'ready') throw new Error('G-05: the refine has no request id');
      const refineRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      if (refineRef.status !== 'ready') throw new Error('G-05: the refine has no message ref');
      await startGoalDriver(bounds.world, bounds.goal, 'g05-bounds');
      const snapshot = ready<CollaborationSnapshot>(await driverRead(bounds.world, bounds.goal),
        'the G-05 driver read');
      expect(snapshot.last).toMatchObject({
        status: 'ready',
        value: { state: 'waiting', reason: expect.stringContaining('plan_refine_pending') },
      });
      await bounds.world.scripted.script(bounds.adviser, [
        { kind: 'calls', calls: [{ callId: 'g05-over', name: 'submit_plan_round', args: overForm }] },
        { kind: 'calls', calls: [{ callId: 'g05-exact', name: 'submit_plan_round', args: exactForm }] },
      ]);

      const planning = await awaitPlanningAnswer(bounds.world, refineRef.value);
      expect(planning, 'G-05: the boundary round produced no answered planning Query').not.toBeNull();
      if (planning === null) throw new Error('G-05: no planning Query');
      expect(planning.job.job.answerRefs.length).toBeGreaterThan(0);
      const overResult = toolOutputJson((await bounds.world.scripted.requests(bounds.adviser))[1], 'g05-over');
      expect(overResult, 'G-05: the 262,145-byte answer never reached a tool result').toBeDefined();
      expect(overResult).toMatchObject({
        status: 'rejected', code: 'capacity',
        reason: 'the answer over the 256 KiB answer bound; shorten the body or the plan',
      });
      const answerRef = planning.job.job.answerRefs.at(-1);
      if (answerRef === undefined) throw new Error('G-05: the exact round saved no answer');
      const answer = readyAnswer((await bounds.world.post('queries/answer',
        plain(S6A_SCOPE, answerRef))).body);
      expect(Buffer.byteLength(answer.answer.answer, 'utf8')).toBe(262_144);
      expect(Buffer.byteLength(INSTRUCTION_100K, 'utf8')).toBe(102_400);
      expect(answer.answer.answer).toContain(INSTRUCTION_100K);
      expect(answer.answer.bodyRef.digest).toBe(sha256Hex(answer.answer.answer));
      const candidate = readyProposal(await awaitProposal(bounds.world,
        proposalRefOf(refineRef.value, bounds.goal)));
      expect(candidate.status).toBe('candidate');
      expect(candidate.draft.assignments?.find(entry => entry.taskId === WORK_TASK_ID)?.instruction)
        .toBe(exactInstruction);
      const replied = await waitForResponse(bounds.world, refineRef.value);
      expect(replied.response).not.toBeNull();
      expect(await readBody(bounds.world, refineRef.value, 'response')).toBe(SUMMARY);
    } finally {
      await bounds.close();
    }

    // 2. An independent run whose only unusual input is the ~100 KiB instruction.
    const hundred = await openPlanOnlyWorld('g05-100k');
    try {
      const plan = structuredClone(PLAN);
      plan.stages[0]!.stageId = hundred.stageId;
      plan.tasks[0]!.stageId = hundred.stageId;
      plan.tasks[0]!.scope = { kind: 'stage', stageId: hundred.stageId };
      const form: PlanRoundLiteral = { answerKind: 'plan', summary: SUMMARY, plan,
        reason: { text: 'G-05 100 KiB', affectedTaskIds: [WORK_TASK_ID] } };
      const round: SystemRoundV1 = { kind: 'refine', goalRef: hundred.goal,
        target: { kind: 'stage', stageId: hundred.stageId }, planRevision: 1 };
      const requestId = systemRoundRequestId(round);
      if (requestId.status !== 'ready') throw new Error('G-05: the refine has no request id');
      const refineRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      if (refineRef.status !== 'ready') throw new Error('G-05: the refine has no message ref');
      await startGoalDriver(hundred.world, hundred.goal, 'g05-100k');
      await hundred.world.scripted.script(hundred.adviser, [
        { kind: 'calls', calls: [{ callId: 'g05-100k', name: 'submit_plan_round', args: form }] },
      ]);
      const planning = await awaitPlanningAnswer(hundred.world, refineRef.value);
      expect(planning).not.toBeNull();
      if (planning === null) throw new Error('G-05: no 100 KiB Query');
      const ref = planning.job.job.answerRefs.at(-1);
      if (ref === undefined) throw new Error('G-05: the 100 KiB answer is missing');
      const answer = readyAnswer((await hundred.world.post('queries/answer', plain(S6A_SCOPE, ref))).body);
      const expected = v2AnswerText(form);
      expect(Buffer.byteLength(answer.answer.answer, 'utf8')).toBe(Buffer.byteLength(expected, 'utf8'));
      expect(answer.answer.answer).toContain(INSTRUCTION_100K);
      const candidate = readyProposal(await awaitProposal(hundred.world,
        proposalRefOf(refineRef.value, hundred.goal)));
      expect(candidate.status).toBe('candidate');
    } finally {
      await hundred.close();
    }

    // 3. The planning round writes a stage convention, refuses the same Query's
    // goal understanding, then takes the short text fallback verbatim.
    const notes = await openPlanOnlyWorld('g05-notes');
    const capture = captureQueryContexts();
    try {
      const round: SystemRoundV1 = { kind: 'refine', goalRef: notes.goal,
        target: { kind: 'stage', stageId: notes.stageId }, planRevision: 1 };
      const requestId = systemRoundRequestId(round);
      if (requestId.status !== 'ready') throw new Error('G-05: the refine has no request id');
      const refineRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      if (refineRef.status !== 'ready') throw new Error('G-05: the refine has no message ref');
      await startGoalDriver(notes.world, notes.goal, 'g05-notes');
      const snapshot = ready<CollaborationSnapshot>(await driverRead(notes.world, notes.goal),
        'the G-05 notes driver read');
      expect(snapshot.last).toMatchObject({
        status: 'ready',
        value: { state: 'waiting', reason: expect.stringContaining('plan_refine_pending') },
      });
      const noteGate = await notes.world.gates.modelRequest(notes.adviser);
      await notes.world.scripted.script(notes.adviser, [
        { kind: 'calls', calls: [{ callId: 'g05-convention', name: 'record_note', args: {
          op: 'write', ...CONVENTION_NOTE,
          anchor: { kind: 'stage', goalId: notes.goal.goalId, stageId: notes.stageId },
        } }] },
        { kind: 'text', text: SHORT_TEXT },
      ]);
      await heartbeatUntilModel(notes.world, noteGate);
      const ctx = capture.latest();
      expect(ctx.principal.kind).toBe('query_run');
      if (ctx.principal.kind !== 'query_run') throw new Error('G-05: the note context is not a QueryRun');

      // The first record read of the note resolver fails once: the owner reports
      // `unavailable` instead of treating the missing round as a normal write.
      const queryRunFault = commitBarrier.failReads(canonicalRefKey(ctx.principal.queryRunRef), 'throw-once');
      const firstRead = await notes.world.platform.notes.writeNote(ctx, {
        commandId: 'g05-understanding-first-read',
        note: { ...UNDERSTANDING_NOTE, anchor: { kind: 'goal', goalId: notes.goal.goalId } },
        expectedPointerRevision: null, goalId: null,
      });
      expect(firstRead.status).toBe('rejected');
      if (firstRead.status === 'rejected') expect(firstRead.code).toBe('unavailable');
      expect(queryRunFault.calls()).toBeGreaterThan(0);
      queryRunFault.release();

      const understanding = await notes.world.platform.notes.writeNote(ctx, {
        commandId: 'g05-understanding',
        note: { ...UNDERSTANDING_NOTE, anchor: { kind: 'goal', goalId: notes.goal.goalId } },
        expectedPointerRevision: null, goalId: null,
      });
      expect(understanding).toMatchObject({ status: 'rejected', code: 'forbidden' });
      noteGate.release();

      const planning = await awaitPlanningAnswer(notes.world, refineRef.value);
      expect(planning).not.toBeNull();
      if (planning === null) throw new Error('G-05: no notes Query');
      const turns = await notes.world.scripted.requests(notes.adviser);
      const conventionResult = toolOutputJson(turns[1], 'g05-convention');
      expect(conventionResult).toMatchObject({ write: { status: 'accepted' } });
      const tools = turns[0]?.tools.map(tool => tool.name) ?? [];
      expect(tools).toContain('record_note');
      expect(tools).toContain('submit_plan_round');
      expect(tools).not.toContain('send_session_message');
      expect(tools).not.toContain('respond_session_message');
      expect(tools).not.toContain('create_member');
      const notesBody = (await notes.world.post('notes/list', plain(S6A_SCOPE, {
        anchor: { kind: 'stage', goalId: notes.goal.goalId, planRevision: 1, stageId: notes.stageId },
        limit: 100, cursor: null,
      }))).body as { status: string; value?: { items: { kind: string; conclusion: string;
        storedState: string; source: { kind: string; duty?: string; queryRunRef?: unknown } }[] } };
      expect(notesBody.status).toBe('ready');
      const note = notesBody.value?.items.find(item => item.conclusion === CONVENTION);
      expect(note).toMatchObject({ kind: 'convention', storedState: 'accepted',
        source: { kind: 'agent', duty: 'adviser' } });
      expect(note?.source.queryRunRef).toBeDefined();
      const replied = await waitForResponse(notes.world, refineRef.value);
      expect(replied.response).not.toBeNull();
      expect(await readBody(notes.world, refineRef.value, 'response')).toBe(SHORT_TEXT);

      // The secretary request round still succeeds, keeps its shape and has no
      // mail tools; the planning note admission did not widen its tool table.
      await initializeProject(notes.world);
      const held = await holdS6BRequestRound(notes.world,
        { label: 'g05-secretary', goalId: null },
        async ({ manifest, request, secretary }) => ({ manifest, request, secretary }));
      expect(held.value.manifest.answerShape).toBe('secretary');
      const roundRecord = readyQuery((await notes.world.post('queries/read',
        plain(S6A_SCOPE, { aggregateType: 'QueryJob', projectId: S6A_SCOPE.projectId,
          workspaceId: S6A_SCOPE.workspaceId, queryJobId: held.value.request.round.queryJobId }))).body);
      expect(roundRecord.job.job.status).toBe('answered');
      expect(roundRecord.job.job.answerRefs).toHaveLength(1);
      const secretaryRequests = await notes.world.scripted.requests(held.value.secretary);
      const secretaryTools = secretaryRequests[0]?.tools.map(tool => tool.name) ?? [];
      expect(secretaryTools).not.toContain('send_session_message');
      expect(secretaryTools).not.toContain('respond_session_message');
      expect(secretaryTools).not.toContain('create_member');
    } finally {
      capture.restore();
      await notes.close();
    }

    // 4. The fallback is 16 KiB, not 256 KiB: the over-long text is a gap and
    // no answer is booked.
    const overlong = await openPlanOnlyWorld('g05-long');
    try {
      const round: SystemRoundV1 = { kind: 'refine', goalRef: overlong.goal,
        target: { kind: 'stage', stageId: overlong.stageId }, planRevision: 1 };
      const requestId = systemRoundRequestId(round);
      if (requestId.status !== 'ready') throw new Error('G-05: the refine has no request id');
      const refineRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      if (refineRef.status !== 'ready') throw new Error('G-05: the refine has no message ref');
      await startGoalDriver(overlong.world, overlong.goal, 'g05-long');
      await overlong.world.scripted.script(overlong.adviser, [{ kind: 'text', text: OVER_LONG }]);
      const fallback = await heartbeatUntil(overlong.world,
        () => readPlanningQuery(overlong.world, refineRef.value),
        record => record?.job.job.status === 'closed', 16);
      expect(fallback?.job.job).toMatchObject({
        status: 'closed', answerRefs: [], closeReason: { code: 'gap', detail: null },
      });
      expect(fallback?.run.run.outcome).toBe('gap');
    } finally {
      await overlong.close();
    }

    // 5. N's text round: the Host system action_request gets a text-shaped Query;
    // a failed source-message read is `unavailable`, and after release its reply
    // is the original text (not a planning summary).
    const overlap = await openPLOverlapWorld({ firstRun: 'held' });
    const overlapCapture = captureQueryContexts();
    try {
      const gate = await overlap.world.world.gates.modelRequest(overlap.adviser);
      await createS6BLine(overlap.world.main, {
        label: 'g05-overlap-b', role: S7C1_CREATE_ROLE, tasks: [overlap.world.tasks[1]!],
      });
      const receipts: WorkflowStepReceipt[] = [];
      await driveWorkflow(overlap.world.world.ag2b,
        select(overlap, 'g05-overlap-b-start', overlap.world.tasks[1]!.taskId), { receipts });
      await overlap.script(overlap.adviser, [{ kind: 'text', text: FIXED_TEXT }]);
      await heartbeatUntilModel(overlap.world.world, gate);
      const request = (await listed(overlap.world.world, 'inbox', overlap.adviser))
        .find(message => message.intent === 'action_request');
      expect(request).toBeDefined();
      if (request === undefined) throw new Error('G-05: the overlap request is missing');
      const ctx = overlapCapture.latest();
      const sourceFault = commitBarrier.failReads(canonicalRefKey(request.ref), 'throw-once');
      const unavailable = await overlap.world.world.platform.notes.writeNote(ctx, {
        commandId: 'g05-overlap-source-read',
        note: { ...CONVENTION_NOTE, anchor: { kind: 'goal', goalId: overlap.world.goal.goalId } },
        expectedPointerRevision: null, goalId: null,
      });
      expect(unavailable).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(sourceFault.calls()).toBeGreaterThan(0);
      sourceFault.release();
      gate.release();
      const replied = await waitForResponse(overlap.world.world, request.ref);
      expect(replied.response).not.toBeNull();
      expect(await readBody(overlap.world.world, request.ref, 'response')).toBe(FIXED_TEXT);
    } finally {
      overlapCapture.restore();
      await overlap.close();
    }
  }, 120_000);

  it.each([
    ['a summary member alone', '{"summary":"G-05 not a planning answer"}'],
    ['a v2 plan head with no plan', '{"schemaVersion":2,"kind":"plan","summary":"G-05 no plan here"}'],
  ])('a short saved text with %s is replied verbatim, never its summary', async (_name, text) => {
    const opened = await openPlanOnlyWorld('g05-verbatim');
    try {
      const requestId = systemRoundRequestId({ kind: 'refine', goalRef: opened.goal,
        target: { kind: 'stage', stageId: opened.stageId }, planRevision: 1 });
      if (requestId.status !== 'ready') throw new Error('G-05: the refine has no request id');
      const refineRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      if (refineRef.status !== 'ready') throw new Error('G-05: the refine has no message ref');
      await startGoalDriver(opened.world, opened.goal, 'g05-verbatim');
      await opened.world.scripted.script(opened.adviser, [{ kind: 'text', text }]);
      const replied = await waitForResponse(opened.world, refineRef.value);
      expect(replied.response).not.toBeNull();
      expect(await readBody(opened.world, refineRef.value, 'response')).toBe(text);
    } finally {
      await opened.close();
    }
  }, 120_000);
});

function readyAnswer(body: unknown): QueryJobAnswerSnapshot {
  const read = body as { status: string; value?: QueryJobAnswerSnapshot };
  if (read.status !== 'ready' || read.value === undefined) {
    throw new Error(`G-05: the answer read is not ready: ${JSON.stringify(body)}`);
  }
  return read.value;
}

function readyQuery(body: unknown): QueryJobRecord {
  const read = body as { status: string; value?: QueryJobRecord };
  if (read.status !== 'ready' || read.value === undefined) {
    throw new Error(`G-05: the Query read is not ready: ${JSON.stringify(body)}`);
  }
  return read.value;
}

function readyProposal(read: { status: string; value?: PlanProposal }): PlanProposal {
  if (read.status !== 'ready' || read.value === undefined) {
    throw new Error(`G-05: the candidate read is not ready: ${JSON.stringify(read)}`);
  }
  return read.value;
}
