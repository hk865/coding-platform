/**
 * K3L-6 (121-110; the user's 11-13 answer 丙: no network condition; rulings Q1, Q3, Q4): a blocked command's rerun
 * request goes first to the Goal's adviser (`command_rerun` round), who allows, denies or escalates; no adviser and
 * every step confirmed go straight to the person (the streak is R7 in tests/contracts/K3L6-advice-pure.test.ts).
 * Real Host, SQLite only (the blocked record comes from a crash restart, and the adviser skips it); a failing check
 * sends a normally ended Work Run to its automatic rework. Requests are read through the CRR owner's list port (as
 * K3-44); a request is revision 1 when written and each owner write adds 1.
 * Red today (7c862a02): every request is `pending` with its card at once and no `crr:` round; each row says where.
 * R6 is green today and guards K3L-6's routing. Green when K3L-6 routes creation to the adviser and its gate sends
 * one round per request revision, applies or escalates. Each row names its draft §3 mutation; none can be shown on
 * today's tree (the code it breaks lands with K3L-6). R2's marker, R6b, R9's conflict receipt and the rows on a
 * satisfied Task and on a text answer each name a mutation that was shown red on a copy of the tree.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { commandRerunAdviceAnswerText, parseCommandRerunAdviceAnswer } from '../../src/contracts/command-rerun-advice.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { commandRerunAdviceSubjectOfText } from '../../src/contracts/plan-round.js';
import { unknownCallAdviceGoalBasisDigest } from '../../src/contracts/unknown-call-advice.js';
import { goalDecisionBasis } from '../../src/core/work-graph/tasks/goal-basis.js';
import * as responsibility from '../../src/core/work-graph/tasks/responsibility-recipient.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { listCommandRerunRequests } from '../helpers/B2-09b-crash.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  adviserRoundsOf, adviserToolResult, advanceK3L3, answerK3L3Round, continueK3L3Goal, crashK3L3Command, k3l3Queue,
  occupyK3L3Consumer, openK3L3World, reachK3L3, selectK3L3, type K3L3World,
} from '../helpers/K3L3-adviser-world.js';
import { installPLFailingCheck } from '../helpers/PL-consumption-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]):
    ToolDefinition => (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

/** A2 (R6b): while armed, the real responsibility resolver fails `unavailable` (a module Task's adviser read fails
 *  when its architecture read does); otherwise the real resolver answers. Installed per row before the world opens
 *  (the config restores mocks before each test). */
const adviserReadFault = { armed: false };
function installAdviserReadFault(): void {
  const realRecipient = responsibility.createResponsibilityRecipient;
  vi.spyOn(responsibility, 'createResponsibilityRecipient').mockImplementation(dependencies => {
    const real = realRecipient(dependencies);
    return { resolveResponsibilityRecipient: async (ctx, input) => adviserReadFault.armed
      ? { status: 'rejected', code: 'unavailable', reason: 'K3L6 R6b: the architecture read failed' }
      : await real.resolveResponsibilityRecipient(ctx, input) };
  });
}

const worlds: K3L3World[] = [];
afterEach(async () => {
  adviserReadFault.armed = false;
  shellSeam.release();
  commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(w => w.world.close()));
});

const call = (callId: string, name: string, args: Record<string, unknown>): S6AReply =>
  ({ kind: 'calls', calls: [{ callId, name, args }] });
const advise = (callId: string, args: Record<string, unknown>) => call(callId, 'submit_command_rerun_advice', args);
const performs = (kind: string) => (op: { kind: string }) => op.kind === kind;
const askRerun = (label: string, callId = `${label}-request`, extra: Record<string, unknown> = {}) =>
  call(callId, 'request_command_rerun', { command: `${label} runs a program`, reason: '迁移要真的跑一次', ...extra });
const requestsOf = async (w: K3L3World) => await listCommandRerunRequests(w.world.database, w.world.humanContext(),
  S6A_SCOPE, { goalId: w.goal.goalId, taskId: w.task.taskId });
const crrCards = async (w: K3L3World) => (await k3l3Queue(w, ['waiting_answer'])).waitingAnswer
  .filter(card => card.source.kind === 'command_rerun_request');
const goalPin = async (w: K3L3World) => [{ ref: w.goal, revision: ready<{ goal: { revision: number } }>(
  await w.world.post('goals/read', plain(S6A_SCOPE, w.goal)), 'the Goal').goal.revision }];

type RowOptions = { before?: (w: K3L3World) => Promise<unknown>; stop?: (op: { kind: string }) => boolean;
  /** The world's passing check instead of the failing one, and a second Task the Goal's selection goes on to (R11b). */
  checks?: true;
  /** The crashed (blocked) command; default `${label} runs a program`. */
  command?: string };

/** The adviser skips the crashed `shell` call (its record blocks the command); stops before the continuation start. */
async function blockedTask(label: string, options: RowOptions = {}) {
  installAdviserReadFault();
  const w = await openK3L3World(label, options.checks === true ? { checks: true, otherTask: true }
    : { checks: installPLFailingCheck() });
  worlds.push(w);
  const runRef = await crashK3L3Command(w, label, options.command);
  await advanceK3L3(w, selectK3L3(w, `${label}-a`));
  await answerK3L3Round(w, (await adviserRoundsOf(w))[0]!.message, [call(`${label}-skip`,
    'submit_unknown_call_advice', { choice: 'skip_as_done', rationale: 'r', plain: '已经跑过了' })]);
  const start = (await advanceK3L3(w, selectK3L3(w, `${label}-b`), performs('start'))).last.next;
  if (start?.kind !== 'perform') throw new Error(`${label}: the drive did not stop before the continuation start`);
  return { w, runRef, start };
}

/** The continuation Run asks for the rerun and ends; the drive goes on until it waits (or stops before `stop`). */
async function requested(label: string, options: RowOptions = {}) {
  const { w, start } = await blockedTask(label, options);
  await options.before?.(w);
  await w.world.scripted.script(w.workLine, [askRerun(label, undefined,
    options.command === undefined ? {} : { command: options.command }), { kind: 'text', text: `${label} waits for the rerun` }]);
  await advanceK3L3(w, start, options.stop);
  return { w, crr: (await requestsOf(w))[0]! };
}

/** The request is written for the adviser: `awaiting_advice` at revision 1, no answer yet, no card. */
async function awaitingAdvice(label: string, options: RowOptions = {}) {
  const asked = await requested(label, options);
  expect(asked.crr).toMatchObject({ state: 'awaiting_advice', revision: 1, advice: { answer: null } });
  expect(await crrCards(asked.w)).toEqual([]);
  return asked;
}

describe('R1/R2/R10 the adviser decides first; its allow lets one shell call through', () => {
  // Red today at `awaitingAdvice`. Mutations: creation routed to the person (red there, R1); no gate branch for the
  // waiting request (no round after the restart, the crash row); `allow_rerun` applied as `denied` (the marker, R2).
  // R2: the blocked command is a real harmless one; after the allow the seam stops holding new calls
  // (the crashed call stays held), so the rework Run's call is the real shell's, and the same command again is blocked.
  it('R1/R2/R10 SQLite only: a crash before the send, one crr: round, allow_rerun -> the command really runs once', async () => {
    const marker = 'k3l6r1-marker.txt';
    const command = `echo k3l6r1 >> ${marker}`;
    const { w } = await awaitingAdvice('k3l6r1', { stop: performs('send_system_round'), command });
    await occupyK3L3Consumer(w, 'k3l6r1-again');
    await w.world.crash();
    await advanceK3L3(w, selectK3L3(w, 'k3l6r1-c'));
    await advanceK3L3(w, selectK3L3(w, 'k3l6r1-d'));
    const rounds = await adviserRoundsOf(w, 'crr:');
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.message).toMatchObject({ intent: 'action_request', taskRef: w.task });
    expect(await crrCards(w)).toEqual([]);
    // The restart interrupted the Goal: the Host consumes the round only after the person continues it.
    await continueK3L3Goal(w, 'k3l6r1-again');
    expect(await adviserRoundsOf(w, 'crr:')).toHaveLength(1);
    await answerK3L3Round(w, rounds[0]!.message, [advise('r2-allow', { choice: 'allow_rerun', rationale: 'r', plain: '只改本机的库' })]);
    expect(() => readFileSync(join(w.world.root, marker), 'utf8')).toThrow();
    shellSeam.stopHolding();
    await w.world.scripted.script(w.workLine, [call('r2-shell', 'shell', { command }), call('r2-again', 'shell', { command }),
      { kind: 'text', text: 'k3l6r1 ran it' }]);
    await advanceK3L3(w, selectK3L3(w, 'k3l6r1-e'));
    // The command really ran once: one marker line, and the same command again was blocked.
    expect(readFileSync(join(w.world.root, marker), 'utf8')).toBe('k3l6r1\n');
    expect(await adviserToolResult(w, 'r2-shell', w.workLine)).toMatchObject({ status: 'success' });
    expect(JSON.stringify(await adviserToolResult(w, 'r2-again', w.workLine))).toContain('平台拦下了这条命令');
    expect((await requestsOf(w))[0]).toMatchObject({ state: 'used', revision: 3, answerMessageRef: null,
      advice: { answer: { choice: 'allow_rerun', plain: '只改本机的库' } }, usedBy: { callId: 'r2-shell' } });
  }, 240_000);
});

describe('R3 the adviser denies', () => {
  // Red today at `awaitingAdvice`. Mutation: `deny` applied as `denied_final` -> the rework Run is refused.
  it('R3 SQLite only: the request is denied; the rework Run may ask again', async () => {
    const { w, crr } = await awaitingAdvice('k3l6r3');
    await answerK3L3Round(w, (await adviserRoundsOf(w, 'crr:'))[0]!.message,
      [advise('r3-deny', { choice: 'deny', rationale: 'r', plain: '先别动库' })]);
    await w.world.scripted.script(w.workLine, [askRerun('k3l6r3', 'r3-again'), { kind: 'text', text: 'asked again' }]);
    await advanceK3L3(w, selectK3L3(w, 'k3l6r3-c'));
    expect((await requestsOf(w)).find(entry => entry.ref.requestId === crr.ref.requestId)).toMatchObject(
      { state: 'denied', revision: 2, answerMessageRef: null, advice: { answer: { choice: 'deny' } } });
    // The new request goes to the adviser again: the tool's two parts say so.
    expect((await adviserToolResult(w, 'r3-again', w.workLine)).output).toMatchObject([
      { kind: 'json', value: { status: 'requested' } },
      { kind: 'text', text: expect.stringMatching(/^已请求，等答复（参谋先看；拿不准会交给人）。/) }]);
  }, 240_000);
});

describe('R4 the adviser escalates to the person', () => {
  // Red today at `awaitingAdvice`. Mutation: the card's adviser line dropped.
  it('R4 SQLite only: one card with today\'s three options and the adviser\'s line; the person allows', async () => {
    const { w } = await awaitingAdvice('k3l6r4');
    await answerK3L3Round(w, (await adviserRoundsOf(w, 'crr:'))[0]!.message, [advise('r4-escalate',
      { choice: 'escalate', escalationKind: 'requirement', rationale: 'r', plain: '这条会写库，请你定' })]);
    await advanceK3L3(w, selectK3L3(w, 'k3l6r4-c'));
    expect((await requestsOf(w))[0]).toMatchObject({ state: 'pending', revision: 2,
      escalation: { cause: 'adviser_escalated', suggestion: { choice: 'escalate' } } });
    const cards = await crrCards(w);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.options.map(option => option.id)).toEqual(['allow_rerun', 'deny', 'deny_final']);
    expect(cards[0]!.objects[0]!.label.split('\n')).toContainEqual(expect.stringMatching(/^参谋(说|的建议)：这条会写库，请你定$/));
    ready(await w.world.post('decisions/answer', graphWrite(S6A_SCOPE, { source: cards[0]!.source,
      selection: { kind: 'option', optionId: 'allow_rerun' }, text: '', annotations: [] }, 'k3l6r4-answer',
    cards[0]!.source.pins)), 'R4: the person allows');
    expect((await requestsOf(w))[0]).toMatchObject({ state: 'allowed', revision: 3 });
  }, 240_000);
});

describe('R5/R6 straight to the person', () => {
  const archiveAdviser = async (w: K3L3World) => {
    const line = (await w.world.readSession(w.adviser)).record;
    committed(await w.world.post('sessions/archive', graphWrite(S6A_SCOPE, { sessionRef: w.adviser.ref,
      reason: 'K3L6 R5' }, 'k3l6r5-archive', [{ ref: line.ref, revision: line.revision }])), 'R5: archive');
  };
  // R5 (the coordinator's ruling 1: "no adviser" is decided at creation, so the card is there at revision 1; mutation:
  // the owner not reading its adviser -> `awaiting_advice`, no card); R6 green today (mutation: the owner not reading
  // the Goal's autonomy -> `awaiting_advice`, no card). R6b (mutation: the adviser read before the
  // every-step route -> the tool refused, no request): the adviser read fails meanwhile (A2) and is not needed.
  it.each([
    ['R5 no adviser line', 'k3l6r5', archiveAdviser, { state: 'pending', revision: 1,
      escalation: { cause: 'no_adviser', suggestion: null } }],
    ['R6 every step confirmed', 'k3l6r6', async (w: K3L3World) => await setS7AAutonomy(w.world, w.goal, 'every_step'),
      { state: 'pending', revision: 1 }],
    ['R6b every step confirmed while the adviser read fails', 'k3l6r6b', async (w: K3L3World) => {
      await setS7AAutonomy(w.world, w.goal, 'every_step');
      adviserReadFault.armed = true;
    }, { state: 'pending', revision: 1 }],
  ] as const)('%s SQLite only: one card, no crr: round', async (_cell, label, before, expected) => {
    const { w } = await requested(label, { before });
    expect((await requestsOf(w))[0]).toMatchObject(expected);
    expect(await crrCards(w)).toHaveLength(1);
    expect(await adviserRoundsOf(w, 'crr:')).toEqual([]);
  }, 240_000);
});

describe('R9 an adviser answer to an older revision', () => {
  // Red today at the one crr: round. Needs the gate to send while the requesting Run still runs (a named-Task pass).
  // Mutation: the owner's revision comparison dropped -> `allowed`.
  it('R9 SQLite only: a declared form added while the round is out; the old answer is a revision conflict', async () => {
    const { w, runRef, start } = await blockedTask('k3l6r9');
    await w.world.scripted.script(w.workLine, [askRerun('k3l6r9'), askRerun('k3l6r9 --again', 'r9-form',
      { rewriteOf: { review: runRef.runId, alias: 1 } }), { kind: 'text', text: 'two forms' }]);
    const asked = await w.world.gates.modelRequest(w.workLine);
    const again = await w.world.gates.modelRequest(w.workLine);
    const running = advanceK3L3(w, start).catch((error: unknown) => error);
    await reachK3L3(w, asked, 'R9: the first model request');
    asked.release();
    await reachK3L3(w, again, 'R9: the Run after its request');
    await advanceK3L3(w, selectK3L3(w, 'k3l6r9-a'));
    const rounds = await adviserRoundsOf(w, 'crr:');
    expect(rounds).toHaveLength(1);
    await answerK3L3Round(w, rounds[0]!.message, [advise('r9-allow', { choice: 'allow_rerun', rationale: 'r', plain: 'p' })]);
    const apply = (await advanceK3L3(w, selectK3L3(w, 'k3l6r9-b'), performs('apply_rerun_adviser_answer'))).last.next;
    if (apply?.kind !== 'perform') throw new Error('R9: the drive did not stop before applying the answer');
    again.release();
    await running;
    const [moved] = await requestsOf(w);
    expect(moved).toMatchObject({ state: 'awaiting_advice', revision: 2 });
    const applied = await advanceK3L3(w, apply);
    expect(applied.receipts[0]).toMatchObject({ kind: 'apply_rerun_adviser_answer', result: { status: 'rejected',
      code: 'revision_conflict', current: [{ ref: moved!.ref, revision: 2 }] } });
    expect((await requestsOf(w))[0]).toMatchObject({ state: 'awaiting_advice', revision: 2, advice: { answer: null } });
  }, 240_000);
});

describe('⑧ the answer subject is stale while the pin is current', () => {
  // The pin is the moved request's current revision, so the earlier `pinnedRevision` check passes and only the
  // subject-version branch can reject this answer. Mutation: the `subject.revision !== current.revision` clause
  // removed -> the stale answer is applied.
  it('⑧ SQLite only: a form added while the round is out; the current pin passes and the old answer subject is a conflict', async () => {
    const { w, runRef, start } = await blockedTask('k3l6r8');
    await w.world.scripted.script(w.workLine, [askRerun('k3l6r8'), askRerun('k3l6r8 --again', 'r8-form',
      { rewriteOf: { review: runRef.runId, alias: 1 } }), { kind: 'text', text: 'two forms' }]);
    const asked = await w.world.gates.modelRequest(w.workLine);
    const again = await w.world.gates.modelRequest(w.workLine);
    const running = advanceK3L3(w, start).catch((error: unknown) => error);
    await reachK3L3(w, asked, '⑧: the first model request');
    asked.release();
    await reachK3L3(w, again, '⑧: the Run after its request');
    await advanceK3L3(w, selectK3L3(w, 'k3l6r8-a'));
    const rounds = await adviserRoundsOf(w, 'crr:');
    expect(rounds).toHaveLength(1);
    await answerK3L3Round(w, rounds[0]!.message, [advise('r8-allow', { choice: 'allow_rerun', rationale: 'r', plain: 'p' })]);
    const step = (await advanceK3L3(w, selectK3L3(w, 'k3l6r8-b'), performs('apply_rerun_adviser_answer'))).last.next;
    if (step?.kind !== 'perform' || step.operation.kind !== 'apply_rerun_adviser_answer') {
      throw new Error('⑧: the drive did not stop before applying the answer');
    }
    again.release();
    await running;
    const [moved] = await requestsOf(w);
    expect(moved).toMatchObject({ state: 'awaiting_advice', revision: 2 });
    // The revision-1 round's own requestId, with the pin on the current revision: the stale subject is all the
    // owner can reject it on.
    const { requestId } = step.operation.request.input;
    const applied = await advanceK3L3(w, { schemaVersion: 1, goalRef: w.goal, flowId: 'k3l6r8-apply',
      sessionHint: w.workLine.ref, kind: 'perform', operation: { kind: 'apply_rerun_adviser_answer',
        request: { input: { requestRef: moved!.ref, requestId },
          meta: { requestId: 'k3l6r8-apply', expected: [{ ref: moved!.ref, revision: 2 }] } } } });
    expect(applied.receipts[0]).toMatchObject({ kind: 'apply_rerun_adviser_answer', result: { status: 'rejected',
      code: 'revision_conflict', reason: 'the request moved since the adviser was asked' } });
    expect((await requestsOf(w))[0]).toMatchObject({ state: 'awaiting_advice', revision: 2, advice: { answer: null } });
  });
});

describe('R11 the Task ends while the adviser decides', () => {
  // Red today at `awaitingAdvice`. Mutation: `closed` derived only from pending|allowed -> stays `awaiting_advice`.
  it('R11 SQLite only: a Plan change cancels the Task; the request reads closed and has no card', async () => {
    const { w } = await awaitingAdvice('k3l6r11');
    const plan = (await s6aCardsWorkspace(w.world, S6A_SCOPE).activePlan(w.goal))!;
    const draft = { ...structuredClone(plan), goalId: w.goal.goalId, planId: `${plan.planId}-end`,
      planRevision: plan.planRevision + 1, tasks: plan.tasks.map(task => task.taskId === w.task.taskId
        ? { ...task, disposition: 'cancelled' as const } : { ...task }) };
    const proposed = committed<{ ref: unknown; revision: number }>(await w.world.post('plans/propose', graphWrite(
      S6A_SCOPE, { goalRef: w.goal, basedOn: plan.ref, draft, reason: { text: 'K3L6 R11', sources: [],
        affectedTaskIds: [w.task.taskId] } }, 'k3l6r11-propose', await goalPin(w))), 'R11: the proposal');
    committed(await w.world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.ref,
      expectedProposalRevision: proposed.revision, decisionRefs: [] }, 'k3l6r11-apply', await goalPin(w))), 'R11: apply');
    expect((await requestsOf(w))[0]).toMatchObject({ state: 'closed' });
    expect(await crrCards(w)).toEqual([]);
  }, 240_000);

  // Mutation: the gate reads the Goal's stored `awaiting_advice` records (no Task closure) -> one crr:
  // round for the satisfied Task when the Goal's selection passes it.
  it('R11b SQLite only: the Run asks, ends and its check passes; the Goal\'s selection passes the satisfied Task without a round', async () => {
    const { w } = await requested('k3l6r11b', { checks: true });
    expect((await requestsOf(w))[0]).toMatchObject({ state: 'closed', revision: 1, advice: { answer: null } });
    // The Goal-level selection (no Task named) goes past the satisfied Task to the other one and stops before its claim.
    const other = await advanceK3L3(w, { schemaVersion: 1, goalRef: w.goal, flowId: 'k3l6r11b-goal', sessionHint: null,
      kind: 'select_work' }, op => op.kind === 'claim_task' || op.kind === 'start');
    expect(other.last.next?.kind).toBe('perform');
    expect(await adviserRoundsOf(w, 'crr:')).toEqual([]);
    expect(await crrCards(w)).toEqual([]);
  }, 240_000);
});

describe('R12 a text is not a submission', () => {
  // A text is not a submission. Mutation: the observer keeps a rerun advice round's final text -> `allowed`.
  it('R12 SQLite only: the adviser writes a valid allow_rerun answer as text, no tool call; the request goes to the person', async () => {
    const { w, crr } = await awaitingAdvice('k3l6r12');
    const goal = ready<{ goal: GoalSnapshot }>(await w.world.post('goals/read', plain(S6A_SCOPE, w.goal)), 'the Goal').goal;
    const subject = { requestRef: crr.ref, reviewRef: crr.reviewRef, revision: crr.revision,
      goalBasisDigest: unknownCallAdviceGoalBasisDigest(goalDecisionBasis(goal)) };
    const text = commandRerunAdviceAnswerText(subject,
      { choice: 'allow_rerun', escalationKind: null, rationale: 'r', plain: '只改本机的库' });
    expect(parseCommandRerunAdviceAnswer(text)).toMatchObject({ status: 'parsed', subject });
    const { query } = await answerK3L3Round(w, (await adviserRoundsOf(w, 'crr:'))[0]!.message, [{ kind: 'text', text }]);
    // The text answers exactly the round the Host asked.
    expect(commandRerunAdviceSubjectOfText(query.job.job.intent.question)).toEqual(subject);
    expect(query.job.job.answerRefs).toEqual([]);
    await advanceK3L3(w, selectK3L3(w, 'k3l6r12-c'));
    expect((await requestsOf(w))[0]).toMatchObject({ state: 'pending', revision: 2, advice: { answer: null },
      escalation: { cause: 'adviser_failed', suggestion: null } });
    expect(await crrCards(w)).toHaveLength(1);
  }, 240_000);
});
