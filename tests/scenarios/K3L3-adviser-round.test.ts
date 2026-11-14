/**
 * K3L-3 (decisions 121-109/110; trade-off 009): the Workflow's adviser round on an unknown-outcome record, end to end
 * on the real Host (SQLite only: the record comes from a crash restart). World: tests/helpers/K3L3-adviser-world.ts.
 * Expected values are the rulings' literals or hand-worked: the record is revision 1 when written, and each owner
 * write adds 1; the `ucr:` head is `ucr:<runId>:<revision>:<phase>:<Goal digest>`.
 *
 * Red today (613ef28d = K3L-2 without K3L-3): every row, because the settlement still sends the record to the person
 * (`needs_decision`, no adviser round): R1 at ① `awaiting_advice`; R3 at the named advance's wait reason; R4 at the
 * `escalate_review` step; R11 at the held model request (no round); the others at `sentRound` (no round). Green when
 * K3L-3 lands: the settlement carries the adviser, the gate sends one round per record revision, reads it back and
 * applies or escalates it, and the platform closes the round's source.
 * Each named mutation was shown red against a local reading of the K3L-3 contract (never committed):
 * - R1: the gate passes `awaiting_advice` (① no stop before the send); the settlement leaves the adviser out (①);
 *   the send drops `taskRef` (②); `graph-tools` gives the shape no history tool, or the observation closed set leaves
 *   it out (③, K3L-2's E1); intervention's planning-answer arm not widened (⑦ "not a plan" notice); K3L-4's pin
 *   always `[]`, the technical label, the record read by the requeue's taskId (⑨). ③'s `create_member` is green today
 *   (ADVQ is not in 613ef28d); it guards "ADVQ's rule also admits the unknown_call_advice shape".
 * - R2: `requeueConfirmedByReview` takes the adviser's disposition as the person's (V9). R3 (E5, ruling Q1 A): K3L-2's
 *   prepare-time version refusal back (the Query stays claimed and the line busy). R4: "not sent, no line" waits.
 * - R5: (a) `closed` waits; (b) an escalation answer read as `closed`. Also red until the planning question reader
 *   stops reading the withdrawn round of (a): `decisions/queue` answers `source_stale` (reply, Q1).
 * - R6: the request id without the Goal's content; the owner not comparing it (A applied at T02). R7: the owner not
 *   reading the autonomy again; ruling Q2 A, the count of rounds is not asserted. R8: `priorAdvised` not written; the
 *   second layer without its suggestion. R9: the run-end settlement without the adviser; the phase fixed to
 *   `disposition`. R11: intervention :158 or :231 not widened (a paused Goal's round never closes).
 * R10 (XWR #24) is not here: the public path did not work (reply, Q5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, readBody, readPlanningQuery, readQueryAnswer } from '../helpers/IV-host-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  adviserManifestOf, adviserNoticesOf, adviserRoundsOf, adviserToolResult, advanceK3L3, answerK3L3Round,
  controlK3L3Goal, crashK3L3Command, k3l3CardOf, k3l3Queue, openK3L3World, reachK3L3, readK3L3Review, selectK3L3,
  type K3L3World,
} from '../helpers/K3L3-adviser-world.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { unknownCallAdviceAnswerText } from '../../src/contracts/unknown-call-advice.js';
import { unknownCallAdviceSubjectOfText } from '../../src/contracts/plan-round.js';

// R9's read-only command: the K3-19 stand-in (rule sheet A7-1); its probe answers as the switch says.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});
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

const worlds: K3L3World[] = [];
afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(w => w.world.close()));
});

const RERUN = { choice: 'rerun_as_is', rationale: '只读命令', plain: '只读命令，重跑没有副作用' };
const submit = (callId: string, args: Record<string, unknown>): S6AReply =>
  ({ kind: 'calls', calls: [{ callId, name: 'submit_unknown_call_advice', args }] });
const performs = (kind: string) => (op: { kind: string }) => op.kind === kind;
const kinds = (receipts: ReadonlyArray<{ kind: string }>) => receipts.map(receipt => receipt.kind);

/** A world, its crashed `shell` call and the record (`pending_review`, revision 1). */
async function crashed(label: string, options: { readonlyCommands?: boolean } = {}) {
  const w = await openK3L3World(label, options);
  worlds.push(w);
  const runRef = await crashK3L3Command(w, label);
  expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'pending_review', revision: 1 });
  return { w, runRef };
}

/** Drives the Task until it waits and returns the adviser round still open, `count` rounds in all. */
async function sentRound(w: K3L3World, label: string, count = 1) {
  const waited = await advanceK3L3(w, selectK3L3(w, label));
  const rounds = await adviserRoundsOf(w);
  expect(rounds, `${label}: the adviser rounds (${String(waited.last.reason)})`).toHaveLength(count);
  const open = rounds.filter(round => round.message.response === null && round.message.withdrawnAt === null);
  expect(open, `${label}: one open round`).toHaveLength(1);
  return open[0]!;
}

describe('R1 the adviser round end to end (E1-E4, N3)', () => {
  it('R1 SQLite only: to the adviser, one ucr: round, the answer applied, the notice names it', async () => {
    const { w, runRef } = await crashed('k3l3r1');
    // ① the settlement routes to the adviser: no card, and the named Task waits on the adviser.
    const toSend = await advanceK3L3(w, selectK3L3(w, 'k3l3r1-a'), performs('send_system_round'));
    const awaiting = await readK3L3Review(w, runRef);
    expect(awaiting).toMatchObject({ status: 'awaiting_advice', revision: 2, advice: { phase: 'disposition', answer: null } });
    expect(await k3l3CardOf(w, awaiting)).toBeUndefined();
    const send = toSend.last.next;
    if (send?.kind !== 'perform') throw new Error('R1: the drive did not stop before the send');
    expect((send.operation.request as { taskRef?: unknown }).taskRef).toEqual(w.task);
    const waited = await advanceK3L3(w, send);
    expect(waited.last).toMatchObject({ state: 'waiting', reason: expect.stringMatching(/^unknown_call_review_awaiting_advice/) });
    // ② one round, action_request, on the Task, head `ucr:<runId>:2:disposition:<digest>`.
    const rounds = await adviserRoundsOf(w);
    expect(rounds).toHaveLength(1);
    const { message: round, text } = rounds[0]!;
    expect(round).toMatchObject({ intent: 'action_request', taskRef: w.task });
    const head = text.split('\n')[0]!;
    expect(head).toMatch(new RegExp(`^ucr:${runRef.runId}:2:disposition:[0-9a-f]{64}$`));
    const { source } = await answerK3L3Round(w, round, [
      { kind: 'calls', calls: [{ callId: 'r1-history', name: 'read_execution_history', args: {} }] },
      { kind: 'calls', calls: [{ callId: 'r1-history-run', name: 'read_execution_history', args: { runRef } }] },
      submit('r1-phase', { ...RERUN, phase: 'approval' }),
      submit('r1-approve', { choice: 'approve', rationale: 'r', plain: 'p' }),
      submit('r1-rerun', RERUN),
    ]);
    // ③ E1 and ④ E4: the frozen tools and the prepared question.
    const manifest = await adviserManifestOf(w, round);
    expect(manifest.promptSet.toolNames).toEqual(expect.arrayContaining(['submit_unknown_call_advice', 'read_execution_history']));
    for (const name of ['edit', 'shell', 'write', 'record_note', 'submit_plan_round', 'send_session_message', 'create_member']) {
      expect(manifest.promptSet.toolNames).not.toContain(name);
    }
    expect(manifest.input).toContain('## 结果未知的调用：请你定怎么继续');
    expect(manifest.input).toContain(`"runId":"${runRef.runId}"`);
    expect(manifest.input).toContain('"status":"awaiting_advice"');
    // ⑤ E3: the record's own Run history; a `runRef` argument is refused.
    const history = await adviserToolResult(w, 'r1-history');
    expect(history).toMatchObject({ status: 'success', output: [{ kind: 'json', value: { status: 'ready' } }] });
    expect(JSON.stringify(history)).toContain(awaiting.items[0]!.kernel.turnId);
    expect(await adviserToolResult(w, 'r1-history-run')).toMatchObject({ status: 'error' });
    // ⑥ E2: a `phase` member is refused, `approve` in the disposition phase has problems, one answer is stored.
    expect(await adviserToolResult(w, 'r1-phase')).toMatchObject({ status: 'error' });
    expect(await adviserToolResult(w, 'r1-approve')).toMatchObject({ status: 'error',
      output: [{ kind: 'json', value: { status: 'rejected', problems: [{ section: 'answer' }] } }] });
    expect(await readQueryAnswer(w.world, interventionPlanningQueryRefs(round.ref).queryJobRef)).toBe(JSON.stringify({
      schemaVersion: 1, kind: 'unknown_call_advice', reviewRef: { aggregateType: 'UnknownCallReview',
        projectId: w.goal.projectId, goalId: w.goal.goalId, runId: runRef.runId }, revision: 2, phase: 'disposition',
      goalBasisDigest: head.split(':')[4], choice: 'rerun_as_is', escalationKind: null, rationale: '只读命令',
      plain: '只读命令，重跑没有副作用' }));
    // ⑦ the platform closed the source with the adviser's sentence; no "not a plan" notice.
    expect(source.response).not.toBeNull();
    expect(await readBody(w.world, round.ref, 'response')).toBe('参谋已答复：只读命令，重跑没有副作用');
    expect(await adviserNoticesOf(w)).toEqual(['这次规划已有结论，模型的回答在回复里。']);
    // ⑧ applied as the adviser's disposition, then the continuation is claimed.
    const toStart = await advanceK3L3(w, selectK3L3(w, 'k3l3r1-b'), performs('start'));
    expect(kinds(toStart.receipts)).toEqual(expect.arrayContaining(['apply_adviser_answer', 'requeue_task', 'claim_task']));
    expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'resolved', revision: 3,
      disposition: { choice: 'rerun_as_is', source: 'adviser', answerMessageRef: null },
      advice: { answer: { plain: '只读命令，重跑没有副作用' } } });
    // ⑨ N3: the recovery notice names the adviser's choice and pins the record.
    const notices = (await k3l3Queue(w, ['notices'], ['automatic_rework'])).notices;
    expect(notices.map(notice => ({ summary: notice.summary, objects: notice.objects }))).toEqual([{
      summary: `自动恢复 · ${w.task.taskId}（不计次） · 中断时有 1 步操作不知道做完没有，参谋定为“照原样重跑”：只读命令，重跑没有副作用`,
      objects: [{ kind: 'aggregate', pin: { ref: awaiting.ref, revision: 3 }, label: `核对记录 ${runRef.runId.slice(0, 8)}` }],
    }]);
  }, 240_000);
});

const runRefIds = (runRef: RunRef) => ({ projectId: runRef.projectId, goalId: runRef.goalId, runId: runRef.runId });

describe('R2 the adviser\'s disposition is not the person\'s confirmation (V9)', () => {
  it('R2 SQLite only: every step confirmed after the answer: the requeue waits on its card', async () => {
    const { w, runRef } = await crashed('k3l3r2');
    const { message: round } = await sentRound(w, 'k3l3r2-a');
    await answerK3L3Round(w, round, [submit('r2-rerun', RERUN)]);
    const stopped = await advanceK3L3(w, selectK3L3(w, 'k3l3r2-b'), performs('requeue_task'));
    expect(kinds(stopped.receipts)).toContain('apply_adviser_answer');
    expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'resolved', disposition: { source: 'adviser' } });
    await setS7AAutonomy(w.world, w.goal, 'every_step');
    const gated = await advanceK3L3(w, selectK3L3(w, 'k3l3r2-c'));
    expect(gated.last.state).toBe('waiting');
    expect(kinds(gated.receipts)).not.toContain('requeue_task');
    // The automatic requeue's confirmation card (`system_requeue`, Goal cause `auto_rework_pending`) names the Task.
    const confirms = (await k3l3Queue(w, ['waiting_answer'])).waitingAnswer.filter(card => card.source.kind === 'goal_cause'
      && (JSON.parse(card.source.key) as { code?: string }).code === 'auto_rework_pending');
    expect(confirms).toHaveLength(1);
    expect(confirms[0]!.source.pins.map(pin => pin.ref)).toContainEqual({ aggregateType: 'Task', ...w.task });
  }, 240_000);
});

describe('R3 the person takes the record over during the adviser round (E5, ruling Q1 A)', () => {
  it('R3 SQLite only: the round still prepares, answers and closes; the answer is not applied; the line is free', async () => {
    const { w, runRef } = await crashed('k3l3r3');
    const claim = w.world.gates.beforeClaim(w.adviser);
    const waited = await advanceK3L3(w, selectK3L3(w, 'k3l3r3-a'));
    expect(waited.last.reason).toMatch(/^unknown_call_review_awaiting_advice/);
    await reachK3L3(w, claim, 'R3: the adviser Query at its claim');
    const reviewRef = { aggregateType: 'UnknownCallReview' as const, ...runRefIds(runRef) };
    const held = committed<UnknownCallReviewV1>(await w.world.post('unknown-call-reviews/hold', graphWrite(S6A_SCOPE,
      { reviewRef, text: null }, 'k3l3r3-hold', [{ ref: reviewRef, revision: 2 }])), 'R3: the hold');
    expect(held).toMatchObject({ status: 'resolved', revision: 3, disposition: { choice: 'handle_myself', hold: 'held' } });
    await w.world.scripted.script(w.adviser, [submit('r3-rerun', RERUN)]);
    claim.release();
    const round = (await adviserRoundsOf(w))[0]!.message;
    await answerK3L3Round(w, round, []);
    expect(await readBody(w.world, round.ref, 'response')).toBe('参谋已答复：只读命令，重跑没有副作用');
    expect((await w.world.readSession(w.adviser)).availability).toBe('idle');
    expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'resolved', revision: 3,
      disposition: { choice: 'handle_myself', hold: 'held' } });
    const after = await advanceK3L3(w, selectK3L3(w, 'k3l3r3-b'));
    expect(after.last).toMatchObject({ state: 'waiting', reason: expect.stringMatching(/^unknown_call_review_held/) });
  }, 240_000);
});

describe('R4 the adviser line is gone before the send', () => {
  it('R4 SQLite only: the record escalates no_adviser with today\'s card and no round', async () => {
    const { w, runRef } = await crashed('k3l3r4');
    await advanceK3L3(w, selectK3L3(w, 'k3l3r4-a'), performs('send_system_round'));
    // The person archives the Goal's only adviser line before the round goes out.
    const card = await w.world.readSession(w.adviser);
    committed(await w.world.post('sessions/archive', graphWrite(S6A_SCOPE, { sessionRef: w.adviser.ref,
      reason: 'K3L3 R4' }, 'k3l3r4-archive', [{ ref: card.record.ref, revision: card.record.revision }])), 'R4: archive');
    const toEscalate = await advanceK3L3(w, selectK3L3(w, 'k3l3r4-b'), performs('escalate_review'));
    const step = toEscalate.last.next;
    expect(step?.kind === 'perform' ? step.operation : null).toMatchObject({ kind: 'escalate_review',
      request: { input: { cause: 'no_adviser', suggestion: null } } });
    await advanceK3L3(w, step!);
    const record = await readK3L3Review(w, runRef);
    expect(record).toMatchObject({ status: 'needs_decision', escalation: { cause: 'no_adviser', suggestion: null } });
    const escalated = await k3l3CardOf(w, record);
    expect(escalated?.objects.find(object => object.kind === 'aggregate')?.label.split('\n')[0])
      .toBe('任务中断时有一步操作不知道做完没有，没有参谋可以帮着判断，要你来定怎么继续。');
    expect(escalated?.options.find(option => option.id === 'handle_myself')?.label).toBe('先暂停这项任务');
    expect(escalated?.options.map(option => option.id)).not.toContain('follow_suggestion');
    expect(await adviserRoundsOf(w)).toEqual([]);
  }, 240_000);
});

describe('R5 the adviser round fails, or the adviser escalates', () => {
  // FSUB-2 adds cell `c`: this shape's Answer is only an accepted `submit_unknown_call_advice` call; model text never
  // stands in for it.
  // (a) Red today: the observer's `submitted === null` branch reads the last text for `unknown_call_advice`, so the
  //     Query ends `answered` with this parseable text as its Answer (①), the gate applies it through
  //     `apply_adviser_answer` and the record resolves with that advice (②), and the source is replied to, not
  //     withdrawn (③). The first failing assertion is ① `expect(ended.query.job.job.answerRefs).toEqual([])`: the
  //     text was accepted as the answer at `answerK3L3Round` (the Query ended `answered`), before `advanceK3L3` runs.
  // (b) Green once the package lands: `unknown_call_advice` is in the observer's one four-shape set, so no accepted
  //     submit gives `final = { kind: 'empty' }` -> `gap`, no Answer (①); the gate escalates `adviser_failed` (②); the
  //     source has no answer, so the Host takes the `no_answer` path and withdraws it (③).
  // (c) Named mutation (draft §3): delete `'unknown_call_advice'` from the set -> an Answer appears (①) and the text is
  //     parsed and applied again (②: the record no longer carries `adviser_failed`).
  it.each([
    ['a', [{ kind: 'text', text: 'R5 a plain text, no answer' }] as S6AReply[]],
    ['b', [submit('r5-escalate', { choice: 'escalate', escalationKind: 'architecture', rationale: 'r',
      plain: '要不要换数据库得你定' })]],
    ['c', [] as S6AReply[]],
  ] as const)('R5 (%s) SQLite only: the person gets the second layer', async (cell, replies) => {
    const { w, runRef } = await crashed(`k3l3r5${cell}`);
    const { message: round } = await sentRound(w, `k3l3r5${cell}-a`);
    let scripted: readonly S6AReply[] = replies;
    if (cell === 'c') {
      expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'awaiting_advice' });
      // The subject is the platform's frozen second line of the round's question, not a value the test invents.
      const query = await heartbeatUntil(w.world, () => readPlanningQuery(w.world, round.ref),
        value => value !== null && unknownCallAdviceSubjectOfText(value.job.job.intent.question) !== null, 32);
      const subject = query === null ? null : unknownCallAdviceSubjectOfText(query.job.job.intent.question);
      if (subject === null) throw new Error('R5 (c): the frozen question carries no advice subject');
      const choice = subject.phase === 'disposition' ? 'rerun_as_is' : 'approve';
      const text = unknownCallAdviceAnswerText(subject, { phase: subject.phase, choice, escalationKind: null,
        rationale: 'r', plain: '只改本机的库' });
      scripted = [{ kind: 'text', text }];
    }
    const ended = await answerK3L3Round(w, round, scripted);
    const { source } = ended;
    const applied = await advanceK3L3(w, selectK3L3(w, `k3l3r5${cell}-b`));
    const record = await readK3L3Review(w, runRef);
    if (cell === 'a') {
      expect(source.withdrawnAt).not.toBeNull();
      expect(kinds(applied.receipts)).toContain('escalate_review');
      expect(record).toMatchObject({ status: 'needs_decision', escalation: { cause: 'adviser_failed' } });
    } else if (cell === 'c') {
      // ① The text stayed in the history: the round has no Answer.
      expect(ended.query.job.job.answerRefs).toEqual([]);
      // ② No advice was applied: the gate escalates the record to the person.
      expect(record).toMatchObject({ status: 'needs_decision', escalation: { cause: 'adviser_failed' } });
      // ③ The source is withdrawn (the Host's `no_answer` path).
      expect(source.withdrawnAt).not.toBeNull();
    } else {
      expect(await readBody(w.world, round.ref, 'response')).toBe('参谋已答复：要不要换数据库得你定');
      expect(record).toMatchObject({ status: 'needs_decision', escalation: { cause: 'adviser_escalated',
        suggestion: { escalationKind: 'architecture' } } });
    }
    if (cell !== 'c') {
      const card = await k3l3CardOf(w, record);
      expect(card?.options.map(option => option.id)).not.toContain('follow_suggestion');
      expect(card?.objects.find(object => object.kind === 'aggregate')?.label.split('\n').slice(0, cell === 'a' ? 1 : 2))
        .toEqual(cell === 'a' ? ['任务中断时有一步操作不知道做完没有，参谋没能给出判断，要你来定怎么继续。']
          : ['任务中断时有一步操作不知道做完没有，参谋认为这件事要你来定。', '参谋说（架构选择）：要不要换数据库得你定']);
    }
  }, 240_000);
});

describe('R6/R7 the Goal changes while the adviser round is out', () => {
  it('R6 SQLite only: the Goal reordered before the answer is applied: T02, a new round, the second answer', async () => {
    const { w, runRef } = await crashed('k3l3r6');
    const first = await sentRound(w, 'k3l3r6-a');
    await answerK3L3Round(w, first.message, [submit('r6-a', { ...RERUN, plain: 'A' })]);
    // The Workflow has read answer A and stands before applying it when the person reorders the Goals.
    const toApply = await advanceK3L3(w, selectK3L3(w, 'k3l3r6-b'), performs('apply_adviser_answer'));
    const apply = toApply.last.next;
    if (apply?.kind !== 'perform') throw new Error('R6: the drive did not stop before applying the answer');
    const list = ready<{ goals: Array<{ ref: GoalRef; revision: number }> }>(await w.world.post('goals/list',
      plain(S6A_SCOPE, { workspace: S6A_SCOPE })), 'R6: the Goal list');
    committed(await w.world.post('goals/reorder', graphWrite(S6A_SCOPE, { workspace: S6A_SCOPE,
      goalOrder: list.goals.map(row => row.ref).reverse() }, 'k3l3r6-reorder',
    list.goals.map(row => ({ ref: row.ref, revision: row.revision })))), 'R6: the reorder');
    await advanceK3L3(w, apply);
    const second = await sentRound(w, 'k3l3r6-c', 2);
    expect(second.text.split('\n')[0]!.split(':').slice(0, 4)).toEqual(first.text.split('\n')[0]!.split(':').slice(0, 4));
    expect(second.text.split('\n')[0]!.split(':')[4]).not.toBe(first.text.split('\n')[0]!.split(':')[4]);
    await answerK3L3Round(w, second.message, [submit('r6-b', { ...RERUN, plain: 'B' })]);
    await advanceK3L3(w, selectK3L3(w, 'k3l3r6-d'), performs('requeue_task'));
    expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'resolved', advice: { answer: { plain: 'B' } } });
  }, 240_000);

  it('R7 SQLite only: every step confirmed meanwhile puts today\'s card before the person', async () => {
    const { w, runRef } = await crashed('k3l3r7');
    const first = await sentRound(w, 'k3l3r7-a');
    await answerK3L3Round(w, first.message, [submit('r7-a', RERUN)]);
    await setS7AAutonomy(w.world, w.goal, 'every_step');
    // Ruling Q2 A: the changed Goal content may send one more round (not asserted either way); it is answered too.
    await advanceK3L3(w, selectK3L3(w, 'k3l3r7-b'));
    const open = (await adviserRoundsOf(w)).filter(round => round.message.response === null && round.message.withdrawnAt === null);
    for (const round of open) await answerK3L3Round(w, round.message, [submit('r7-b', RERUN)]);
    await advanceK3L3(w, selectK3L3(w, 'k3l3r7-c'));
    const record = await readK3L3Review(w, runRef);
    expect(record).toMatchObject({ status: 'needs_decision', disposition: null });
    expect(record.decisionReasons).toContain('confirm_each_step');
    expect(record).not.toHaveProperty('escalation');
    const options = (await k3l3CardOf(w, record))?.options;
    expect(options?.map(option => option.id)).toEqual(['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself']);
    expect(options?.at(-1)?.label).toBe('我来处理');
  }, 240_000);
});

describe('R8 the adviser\'s disposition is interrupted again (priorAdvised)', () => {
  it('R8 SQLite only: the second record asks the adviser, then the person with its suggestion', async () => {
    const { w } = await crashed('k3l3r8');
    const first = await sentRound(w, 'k3l3r8-a');
    await answerK3L3Round(w, first.message, [submit('r8-a', RERUN)]);
    // The continuation of the adviser's rerun is interrupted again; its takeover leaves it unknown (the second
    // cleanup in a row is blocked), and the person attests it, which writes the second record.
    const runB = await crashK3L3Command(w, 'k3l3r8b');
    const run = ready<{ run: { revision: number } }>(await w.world.post('executions/read', plain(S6A_SCOPE, runB)), 'R8: B');
    committed(await w.world.post('executions/resolve-unknown', graphWrite(S6A_SCOPE, { runRef: runB,
      reason: 'R8 the person attests the second interruption' }, 'k3l3r8-attest', [{ ref: runB, revision: run.run.revision }])),
    'R8: the attestation');
    const second = await sentRound(w, 'k3l3r8-c', 2);
    await answerK3L3Round(w, second.message, [submit('r8-c', { choice: 'skip_as_done', rationale: 'r', plain: 'C' })]);
    await advanceK3L3(w, selectK3L3(w, 'k3l3r8-d'));
    const record = await readK3L3Review(w, runB);
    expect(record).toMatchObject({ status: 'needs_decision',
      escalation: { cause: 'advised_failed_again', suggestion: { choice: 'skip_as_done' } } });
    const card = await k3l3CardOf(w, record);
    expect(card?.options[0]).toMatchObject({ id: 'follow_suggestion', label: '照建议（推荐）' });
    expect(card?.options.find(option => option.id === 'handle_myself')?.label).toBe('先暂停这项任务');
    expect(card?.objects.find(object => object.kind === 'aggregate')?.label.split('\n').slice(0, 2))
      .toEqual(['照参谋定的处理接着做以后，这项任务又中断了，要你来定怎么继续。', '参谋的建议：C']);
    ready(await w.world.post('decisions/answer', graphWrite(S6A_SCOPE, { source: card!.source,
      selection: { kind: 'option', optionId: 'follow_suggestion' }, text: '', annotations: [] }, 'k3l3r8-answer',
    card!.source.pins)), 'R8: the answer');
    await advanceK3L3(w, selectK3L3(w, 'k3l3r8-e'), performs('requeue_task'));
    expect(await readK3L3Review(w, runB)).toMatchObject({ status: 'resolved',
      disposition: { choice: 'skip_as_done', source: 'card' } });
  }, 300_000);
});

describe('R11 window 3: the adviser round\'s close-out fails once', () => {
  it('R11 SQLite only: the Goal paused meanwhile, the next pass still closes the source; resumed, the answer applies', async () => {
    const { w, runRef } = await crashed('k3l3r11');
    // The round's model request is held while the person pauses the Goal; its first close-out commit then fails, so
    // only window 3 can close it (a paused Goal's message is otherwise only queued).
    const model = await w.world.gates.modelRequest(w.adviser);
    await w.world.scripted.script(w.adviser, [submit('r11-rerun', RERUN)]);
    await advanceK3L3(w, selectK3L3(w, 'k3l3r11-a'));
    await reachK3L3(w, model, 'R11: the adviser round at its model request');
    commitBarrier.failCommitOnce(byIdentityPrefix('session-message-respond_from_query_answer:'));
    await controlK3L3Goal(w, 'pause', 'k3l3r11-round-pause');
    model.release();
    const round = (await adviserRoundsOf(w))[0]!.message;
    await answerK3L3Round(w, round, []);
    expect(await readBody(w.world, round.ref, 'response')).toBe('参谋已答复：只读命令，重跑没有副作用');
    await controlK3L3Goal(w, 'resume', 'k3l3r11-round-resume');
    await advanceK3L3(w, selectK3L3(w, 'k3l3r11-b'), performs('requeue_task'));
    expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'resolved', disposition: { source: 'adviser' } });
  }, 240_000);
});

describe('R9 the adviser approves the safer method', () => {
  it('R9 SQLite only: the proposal round settles to the adviser\'s approval phase; the approval is applied', async () => {
    sandbox.available = false;
    const { w, runRef } = await crashed('k3l3r9', { readonlyCommands: true });
    expect((await readK3L3Review(w, runRef)).proposalTargets?.length).toBeGreaterThan(0);
    const disposition = await sentRound(w, 'k3l3r9-a');
    await answerK3L3Round(w, disposition.message, [submit('r9-safer', { choice: 'safer_method', rationale: 'r', plain: 'p' })]);
    sandbox.available = true;
    await advanceK3L3(w, selectK3L3(w, 'k3l3r9-b'), op => ['claim_task', 'close_open_turn', 'create_session'].includes(op.kind));
    expect(await readK3L3Review(w, runRef)).toMatchObject({ status: 'awaiting_proposal' });
    await w.world.scripted.script(w.workLine, [
      { kind: 'calls', calls: [{ callId: 'r9-propose', name: 'propose_safer_method',
        args: { item: 1, command: 'npm test', cwd: '.', rationale: 'R9 run the tests instead' } }] },
      { kind: 'text', text: 'R9 the proposal is in' }]);
    const approval = await sentRound(w, 'k3l3r9-c', 2);
    expect(approval.text.split('\n')[0]!.split(':')[3]).toBe('approval');
    await answerK3L3Round(w, approval.message, [submit('r9-approve', { choice: 'approve', rationale: 'r', plain: 'p' })]);
    await advanceK3L3(w, selectK3L3(w, 'k3l3r9-d'), performs('requeue_task'));
    const record = await readK3L3Review(w, runRef);
    expect(record).toMatchObject({ status: 'resolved', disposition: { choice: 'safer_method', source: 'adviser',
      approval: { decision: 'approve', answerMessageRef: null } } });
    expect(record.disposition?.approvedMethods?.[0]?.command).toBe('npm test');
  }, 300_000);
});
