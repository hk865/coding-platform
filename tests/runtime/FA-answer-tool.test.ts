/**
 * The secretary's form-filled answer (decision 97-3): the round's model calls a
 * submit tool, the tool builds today's protocol text and the observer books it.
 *
 * Steps, all public: the S6A memory Host with the request driver, the project's
 * two pointers (`initializeProject`), a goal-less request (`requests/submit`
 * with `goalId: null`), the Host's own request driver and the Session's
 * scripted model, then the owner read `requestFacts.readRequest`. Expected
 * values are the hand-written forms and stored values in `FA-forms.ts`.
 *
 * Rows here: FA-1 (a semantic submit ends the round at the accepted call),
 * FA-2 (one error names every content problem, then the fixed form answers),
 * FA-3 (the same in the S6B3 adoption world, then the adopted catalog refs),
 * and FA-5 (a cold-start questions submit is today's `needs_decision` answer).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  FA_BAD_SEMANTIC_FORM, FA_INITIAL_QUESTIONS_FORM, FA_S6B3_BAD_FORM, FA_S6B3_FIXED_FORM, FA_S6B3_MODULE_ID,
  FA_S6B3_SERVED_ROLE, FA_S6B3_UNSERVED_ROLE, FA_SEMANTIC_FORM, faInitialQuestionsStored, faSemanticStored, roundOf,
} from '../helpers/FA-forms.js';
import { initializeProject, secretaryAnswer, submitRound, waitForRound } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { promptRecordOf } from '../helpers/S6A-prompt-samples.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import {
  configureS6B3SecondWorkspace, holdS6B3RequestAnswer, openS6B3World, releaseS6B3DraftAnswer,
} from '../helpers/S6B3-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';

// FA-3 holds a real start commit, so the file owns the two backend mocks (S6B3-adoption's pattern).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

/** One world the rows close in `afterEach`. */
async function openWorld(): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  return world;
}

describe('FA-1: an accepted semantic submit answers the round', () => {
  it('books the form and makes no closing model request', async () => {
    const world = await openWorld();
    await initializeProject(world);
    const session: S6ASession = await world.createSecretary('fa-1');
    await world.scripted.script(session, [{
      kind: 'calls',
      calls: [{ callId: 'fa-1-submit', name: 'submit_secretary_answer', args: FA_SEMANTIC_FORM }],
    }]);
    const round = await submitRound(world, {
      commandId: 'fa-1', goalId: null, text: 'FA-1 goal-less question', continues: null, recipient: session,
    });
    const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
    const ended = roundOf(view, round.round);
    // The barrier ends the Turn at the accepted submit: the Session's queue
    // served exactly the round's one model request and no closing request.
    const requests = await world.scripted.requests(session);
    expect(requests).toHaveLength(1);
    const stored = faSemanticStored(S6A_SCOPE.projectId);
    expect(ended.answer).toBe(stored.body);
    expect(ended.ideas).toEqual(stored.ideas);
    expect(ended.goalCardDrafts.map(entry => entry.draft)).toEqual(stored.goalCardDrafts);
    // FA-8 (semantic kind): the frozen list ends with its submit tool.
    expect((await promptRecordOf(world, round.round)).set.toolNames.slice(-1)).toEqual(['submit_secretary_answer']);
  }, 120_000);
});

describe('FA-2: one error names every content problem, then the fixed form answers the same round', () => {
  it('names the one idea, the empty draft objective and the unknown module, then accepts the second submit', async () => {
    const world = await openWorld();
    await initializeProject(world);
    const session: S6ASession = await world.createSecretary('fa-2');
    await world.scripted.script(session, [
      { kind: 'calls', calls: [{ callId: 'fa-2-bad', name: 'submit_secretary_answer', args: FA_BAD_SEMANTIC_FORM }] },
      { kind: 'calls', calls: [{ callId: 'fa-2-fixed', name: 'submit_secretary_answer', args: FA_SEMANTIC_FORM }] },
    ]);
    const round = await submitRound(world, {
      commandId: 'fa-2', goalId: null, text: 'FA-2 goal-less question', continues: null, recipient: session,
    });
    const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
    const requests = await world.scripted.requests(session);
    // One Query round served two model requests: the refused call, then the fixed one.
    expect(requests).toHaveLength(2);
    expect(view.rounds).toHaveLength(1);
    const rejected = toolOutputJson(requests[1], 'fa-2-bad') as
      { status: string; problems: { section: string; reason: string }[] };
    expect(rejected.status).toBe('rejected');
    expect(rejected.problems).toHaveLength(3);
    expect(rejected.problems.some(problem => /0, 2 or 3 ideas/.test(problem.reason))).toBe(true);
    expect(rejected.problems.some(problem => /non-empty objective/.test(problem.reason))).toBe(true);
    expect(rejected.problems.some(problem => problem.reason.includes('fa2-no-such-module')
      && problem.reason.includes('s6a-core'))).toBe(true);
    // The fixed form was accepted in the same round: the stored answer is the hand-written body.
    expect(roundOf(view, round.round).answer).toBe(faSemanticStored(S6A_SCOPE.projectId).body);
  }, 120_000);
});

describe('FA-3: a cold-start form is checked against its own setup, then adopted', () => {
  it('reports the unknown module, the unserved role, the duplicate id and the missing gate, then adopts', async () => {
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const second = await configureS6B3SecondWorkspace(world, { name: 'fa3', goals: 2 });
      const scope = second.scope;
      const held = await holdS6B3RequestAnswer(world, {
        scope, label: 'fa3', goalId: null, executionKind: 'initial_coordination',
        reply: () => ({ kind: 'calls', calls: [{ callId: 'fa3-bad', name: 'submit_initial_plan', args: FA_S6B3_BAD_FORM }] }),
      });
      world.host.scriptReplies([{
        kind: 'calls', calls: [{ callId: 'fa3-fixed', name: 'submit_initial_plan', args: FA_S6B3_FIXED_FORM }],
      }]);
      const answer = await releaseS6B3DraftAnswer(world, held);
      expect(JSON.parse(answer.answerText).plan.tasks.map((task: { phase: string }) => task.phase)).toEqual(['pending']);
      expect(world.host.model.requests).toHaveLength(2);
      const badRequest = world.host.model.requests.find(request =>
        request.messages.some(entry => entry.role === 'tool' && entry.callId === 'fa3-bad'));
      const rejected = toolOutputJson(badRequest, 'fa3-bad') as
        { status: string; problems: { section: string; reason: string }[] };
      expect(rejected.status).toBe('rejected');
      const problems = rejected.problems.map(problem => problem.reason);
      expect(problems.some(reason => reason.includes('fa3-missing') && reason.includes(FA_S6B3_MODULE_ID))).toBe(true);
      expect(problems.some(reason => reason.includes(FA_S6B3_UNSERVED_ROLE)
        && reason.includes(FA_S6B3_SERVED_ROLE))).toBe(true);
      expect(problems.some(reason => /not unique/.test(reason) && reason.includes('fa3-work'))).toBe(true);
      expect(problems.some(reason => /GoalGate/.test(reason))).toBe(true);

      const route = async (suffix: string, input: unknown) => (await world.host.post(suffix, plain(scope, input))).body;
      const confirmed = await route('goals/confirm-draft', { commandId: 'fa3-confirm', round: held.round, index: 0 }) as
        { value: { goal: { ref: GoalRef; revision: number } } };
      const adopted = await route('initialization/adopt', {
        commandId: 'fa3-adopt',
        source: { kind: 'binding', answerRef: answer.answerRef, draftIndex: 0 },
        expectedAnswerDigest: sha256Hex(answer.answerText),
        expectedGoal: { ref: confirmed.value.goal.ref, revision: confirmed.value.goal.revision },
      });
      expect(adopted).toMatchObject({ status: 'committed' });
      const read = await route('architecture/read', { selection: { kind: 'current' } }) as
        { value: { catalog: { catalog: AdoptedArchitecture } } };
      // The stored catalog's every ref carries the project the answer was submitted in.
      expect(read.value.catalog.catalog.modules.map(module => module.ref))
        .toEqual([{ projectId: scope.projectId, moduleId: FA_S6B3_MODULE_ID }]);
    } finally {
      await world.close();
    }
  }, 120_000);
});

describe('FA-5: a cold-start questions submit is today\'s needs_decision answer', () => {
  it('books the v2 needs_decision text the builder filled', async () => {
    const world = await openWorld();
    const session: S6ASession = await world.createSecretary('fa-5');
    await world.scripted.script(session, [{
      kind: 'calls',
      calls: [{ callId: 'fa-5-submit', name: 'submit_initial_questions', args: FA_INITIAL_QUESTIONS_FORM }],
    }]);
    const round = await submitRound(world, {
      commandId: 'fa-5', goalId: null, text: 'FA-5 cold-start question', continues: null, recipient: session,
    });
    const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
    const ended = roundOf(view, round.round);
    if (ended.answer === null) throw new Error('FA-5: the round ended without a stored answer');
    expect(JSON.parse(ended.answer)).toEqual(faInitialQuestionsStored());

    // FA-8 (initial kind): the frozen list ends with its two submit tools, in order.
    expect((await promptRecordOf(world, round.round)).set.toolNames.slice(-2))
      .toEqual(['submit_initial_plan', 'submit_initial_questions']);
  }, 120_000);
});

describe('FA-4: a text-only reply keeps today\'s old reading', () => {
  it('answers the valid JSON text and closes a prose reply invalid_answer/protocol', async () => {
    const world = await openWorld();
    await initializeProject(world);
    const session: S6ASession = await world.createSecretary('fa-4');
    const body = 'FA-4 text-only answer';
    const ideas = [
      { title: 'FA-4 idea one', detail: 'FA-4 detail of idea one' },
      { title: 'FA-4 idea two', detail: 'FA-4 detail of idea two' },
    ];
    await world.scripted.script(session, [{ kind: 'text', text: secretaryAnswer({ body, ideas }) }]);
    const json = await submitRound(world, {
      commandId: 'fa-4-json', goalId: null, text: 'FA-4 text question', continues: null, recipient: session,
    });
    const jsonView = await waitForRound(world, json.requestRoot, json.round, 'ended');
    // The round freezes the submit tool, yet no call was made: the final text is the answer.
    expect((await promptRecordOf(world, json.round)).set.toolNames.slice(-1)).toEqual(['submit_secretary_answer']);
    expect(roundOf(jsonView, json.round)).toMatchObject({ status: 'ended', answer: body, ideas, closeCode: null });

    await world.scripted.script(session, [{ kind: 'text', text: 'FA-4 prose, not the secretary JSON' }]);
    const prose = await submitRound(world, {
      commandId: 'fa-4-prose', goalId: null, text: 'FA-4 prose question', continues: null, recipient: session,
    });
    const proseView = await waitForRound(world, prose.requestRoot, prose.round, 'ended');
    expect(roundOf(proseView, prose.round)).toMatchObject({
      status: 'ended', answer: null, closeCode: 'invalid_answer', closeDetail: 'protocol',
    });
  }, 120_000);
});

describe('FA-01: a gate carrying executionIntent is refused by the form schema', () => {
  it('refuses the field at the structure layer and answers the fixed form', async () => {
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const second = await configureS6B3SecondWorkspace(world, { name: 'fa1', goals: 2 });
      const gate = { ...FA_S6B3_FIXED_FORM.plan.tasks[0], taskId: 'fa1-gate', title: 'FA-1 gate',
        taskKind: 'gate', scope: { kind: 'goal' } };
      const bad = { ...FA_S6B3_FIXED_FORM, plan: { ...FA_S6B3_FIXED_FORM.plan,
        tasks: [...FA_S6B3_FIXED_FORM.plan.tasks, gate] } };
      const held = await holdS6B3RequestAnswer(world, { scope: second.scope, label: 'fa1',
        goalId: null, executionKind: 'initial_coordination',
        reply: () => ({ kind: 'calls', calls: [{ callId: 'fa1-bad', name: 'submit_initial_plan', args: bad }] }) });
      world.host.scriptReplies([{ kind: 'calls', calls: [{ callId: 'fa1-fixed', name: 'submit_initial_plan',
        args: FA_S6B3_FIXED_FORM }] }]);
      const answer = await releaseS6B3DraftAnswer(world, held);
      const refused = world.host.model.requests[1]?.messages.find(entry => entry.role === 'tool' && entry.callId === 'fa1-bad');
      expect(refused?.role === 'tool' && refused.result.status === 'error'
        ? refused.result.error.code : undefined).toBe('invalid_arguments');
      expect(JSON.parse(answer.answerText).plan.tasks.map((task: { taskId: string }) => task.taskId))
        .toEqual(['fa3-work']);
    } finally { await world.close(); }
  }, 120_000);
});

describe('FA-6: an accepted submit answers even when a later call fails the Turn', () => {
  it('fails the Run on the pending read and still books the submit answer', async () => {
    const world = await openWorld();
    await initializeProject(world);
    const session: S6ASession = await world.createSecretary('fa-6');
    await world.scripted.script(session, [{
      kind: 'calls',
      calls: [
        { callId: 'fa-6-submit', name: 'submit_secretary_answer', args: FA_SEMANTIC_FORM },
        { callId: 'fa-6-read', name: 'read', args: { path: 'src/module.ts' } },
      ],
    }]);
    const round = await submitRound(world, {
      commandId: 'fa-6', goalId: null, text: 'FA-6 two-group question', continues: null, recipient: session,
    });
    const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
    const stored = faSemanticStored(S6A_SCOPE.projectId);
    const ended = roundOf(view, round.round);
    expect(ended).toMatchObject({ status: 'ended', answer: stored.body, closeCode: null });
    expect(ended.ideas).toEqual(stored.ideas);
    expect(ended.goalCardDrafts.map(entry => entry.draft)).toEqual(stored.goalCardDrafts);
    // The barrier ended the Turn at the submit group, so no second model request was served.
    expect(await world.scripted.requests(session)).toHaveLength(1);
  }, 120_000);
});
