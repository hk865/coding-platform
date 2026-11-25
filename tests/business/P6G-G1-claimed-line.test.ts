/**
 * P6G G1 (lead start ruling `p6g-rulings.md` §G1, its supplementary ruling, and code-review ruling `p6gcr-rulings.md`
 * T1/T2): two Tasks without a dependency go to two different lines when two are free and their Runs overlap; with one
 * line the second waits for the first. G1-1/G1-2 guard what the start tree already does (the claim commit occupies
 * the line, `claim-service.ts:1552`). G1-3/G1-4 are the supplementary ruling's row: both selections read the lines
 * before A's claim commits, so both name X; B's claim then meets A's and is refused `busy`, and in that same step B is
 * picked once more with the occupancy visible: the free Y when there is one (the result's `pick` is that re-pick),
 * else the path of a line already taken at the pick (B19). B's claim is one public `workflow/advance` call.
 *
 * World: the S6A Host world on memory (business rows, RULES S3) with S7A's trusted static check, so a Task's node can
 * end through its own checks. Two goal-scoped work Tasks of the AG2b plan (`executionDag.dependsOn: []`, no module, so
 * no overlap gate); line X answers for both Tasks (an open responsible link to each), so X is either Task's first key
 * while it is free; Y is a plain idle line of the same Role. Every action is a public route (`workflow/advance`,
 * `sessions/create`, `decisions/answer`); every fact is read through `workflow/advance` results, `executions/read`,
 * `tasks/query` and `decisions/queue`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { driveWorkflow, type AdvanceValue } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { advance } from '../scenarios/support/common.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

type G1World = { world: S6AHostWorld; main: S6ACardsWorkspace; goal: GoalRef; a: TaskTriple; b: TaskTriple;
  x: S6ASession; y: S6ASession | null };

/** Two goal-scoped Tasks without a dependency, line X answering for both, and (unless `one`) a plain line Y. */
async function openG1World(label: string, options: { one: boolean }): Promise<G1World> {
  const world = await openS6AHostWorld({ backend: 'memory',
    extraHostOptions: { checks: checkConfiguration({ ...OPERATOR, kind: 'human' }) } });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = (await main.createGoal(`${label}-goal`, 'P6G G1 goal')).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label, taskIds: [`${label}-a`, `${label}-b`],
    role: S6A_WORK_ROLE.templateId });
  const x = await sessionOf(world, await createS6BLine(main, { label: `${label}-x`, role: S6A_WORK_ROLE,
    tasks: [...tasks] }));
  const y = options.one ? null : await sessionOf(world, await createS6BLine(main, { label: `${label}-y`,
    role: S6A_WORK_ROLE }));
  // X may run both Tasks (one line); Y runs at most B. Each Run answers once.
  await world.scripted.script(x, [{ kind: 'text', text: `${label}: X answers` }, { kind: 'text', text: `${label}: X again` }]);
  if (y !== null) await world.scripted.script(y, [{ kind: 'text', text: `${label}: Y answers` }]);
  return { world, main, goal, a: tasks[0]!, b: tasks[1]!, x, y };
}

const selectTask = (target: G1World, flowId: string, task: TaskTriple): WorkflowAdvanceInput => ({
  schemaVersion: 1, goalRef: target.goal, flowId, sessionHint: null, kind: 'select_work', taskId: task.taskId });

/** Drives through public advances up to (not performing) the first `stop` step; returns the steps, receipts and it. */
async function driveTo(target: G1World, input: WorkflowAdvanceInput, stop: string):
Promise<{ steps: AdvanceValue[]; receipts: WorkflowStepReceipt[]; next: WorkflowAdvanceInput }> {
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(target.world.ag2b, input, { stopBefore: stop, receipts });
  const next = steps.at(-1)?.next ?? null;
  if (next === null || next.kind !== 'perform' || next.operation.kind !== stop) {
    throw new Error(`the drive did not stop before ${stop}: ${JSON.stringify(steps.at(-1))}`);
  }
  return { steps, receipts, next };
}

/** The committed claim among receipts (its line and Run). */
function committedClaim(receipts: readonly (WorkflowStepReceipt | null)[], what: string): { line: SessionRef; run: RunRef } {
  for (const receipt of receipts) {
    if (receipt === null || receipt.kind !== 'claim_task' || receipt.result.status !== 'committed') continue;
    const { projectId, sessionId } = receipt.result.value.sessionRef;
    return { line: { projectId, sessionId }, run: receipt.result.value.runRef };
  }
  throw new Error(`${what}: no committed claim: ${JSON.stringify(receipts.map(receipt => receipt?.kind ?? null))}`);
}

/** The line a stopped `claim_task` perform names: the selection's pick, not committed yet. */
function pickedLineOf(next: WorkflowAdvanceInput): SessionRef {
  if (next.kind !== 'perform' || next.operation.kind !== 'claim_task') {
    throw new Error(`the stopped step is not a claim: ${JSON.stringify(next)}`);
  }
  const { projectId, sessionId } = (next.operation.request as { input: { sessionRef: SessionRef } }).input.sessionRef;
  return { projectId, sessionId };
}

const plainRef = (session: S6ASession): SessionRef => ({ projectId: session.ref.projectId,
  sessionId: session.ref.sessionId });

async function runStatus(world: S6AHostWorld, run: RunRef): Promise<{ status: string; outcome: string | null }> {
  const read = ready<{ run: { status: string; outcome?: string | null } }>(
    await world.post('executions/read', plain(S6A_SCOPE, run)), 'executions/read');
  return { status: read.run.status, outcome: read.run.outcome ?? null };
}

/** A's and B's claimed Runs start; each is held at its own line's model request, so both run at the same time. */
async function runBothAtOnce(target: G1World, start: { a: WorkflowAdvanceInput; aRun: RunRef; aLine: S6ASession;
  b: WorkflowAdvanceInput; bRun: RunRef; bLine: S6ASession }): Promise<void> {
  const { world } = target;
  const heldA = await world.gates.modelRequest(start.aLine);
  const driveA = driveWorkflow(world.ag2b, start.a, { stopBefore: 'open_checks' });
  await heldA.reached;
  const heldB = await world.gates.modelRequest(start.bLine);
  const driveB = driveWorkflow(world.ag2b, start.b, { stopBefore: 'open_checks' });
  await heldB.reached;
  expect(await runStatus(world, start.aRun)).toEqual({ status: 'running', outcome: null });
  expect(await runStatus(world, start.bRun)).toEqual({ status: 'running', outcome: null });
  heldA.release();
  heldB.release();
  await Promise.all([driveA, driveB]);
  expect(await runStatus(world, start.aRun)).toEqual({ status: 'ended', outcome: 'completed' });
  expect(await runStatus(world, start.bRun)).toEqual({ status: 'ended', outcome: 'completed' });
}

/** Both selections run before A's claim commits: A's and B's passes each stop at their own `claim_task`. */
async function bothPickX(target: G1World, label: string): Promise<{ a: WorkflowAdvanceInput; b: WorkflowAdvanceInput }> {
  const a = await driveTo(target, selectTask(target, `${label}-a`, target.a), 'claim_task');
  const b = await driveTo(target, selectTask(target, `${label}-b`, target.b), 'claim_task');
  return { a: a.next, b: b.next };
}

describe('G1: a claimed line is occupied', () => {
  it('G1-1: with two free lines, B goes to the other line while A is claimed and not entered, and the Runs overlap',
    async () => {
      const target = await openG1World('p6g-g1-1', { one: false });
      // A is claimed on X (its responsible line) and stopped before its prepare: claimed, not entered.
      const a = await driveTo(target, selectTask(target, 'p6g-g1-1-a', target.a), 'prepare');
      const claimA = committedClaim(a.receipts, 'A');
      expect(claimA.line).toEqual(plainRef(target.x));
      // B's pass in that window: X answers for B too, but X is taken, so B is claimed on Y.
      const b = await driveTo(target, selectTask(target, 'p6g-g1-1-b', target.b), 'prepare');
      const claimB = committedClaim(b.receipts, 'B');
      expect(claimB.line).toEqual(plainRef(target.y!));
      await runBothAtOnce(target, { a: a.next, aRun: claimA.run, aLine: target.x,
        b: b.next, bRun: claimB.run, bLine: target.y! });
    }, 180_000);

  it('G1-2: with one line, B is not put on X while A holds it; it runs on X after A ends', async () => {
    const target = await openG1World('p6g-g1-2', { one: true });
    const { world, main, goal } = target;
    const a = await driveTo(target, selectTask(target, 'p6g-g1-2-a', target.a), 'prepare');
    expect(committedClaim(a.receipts, 'A').line).toEqual(plainRef(target.x));

    // A claimed, not entered: B gets no claim and no Run; with no other line it asks the person for a member
    // (B19, `MVP-BEHAVIOR.md:366`), and waits.
    const receipts: WorkflowStepReceipt[] = [];
    const b = await driveWorkflow(world.ag2b, selectTask(target, 'p6g-g1-2-b', target.b), { stopBefore: 'prepare', receipts });
    expect(receipts.map(receipt => receipt.kind)).toEqual(['host_pick_member']);
    expect(b.at(-1)).toMatchObject({ state: 'waiting', reason: 'member_creation_pending' });
    expect(await main.taskRun(goal, target.b.taskId)).toBeNull();

    // The person declines a new member: B still has no line of its own.
    const card = (await main.readCards(goal)).find(item => item.source.kind === 'member_creation'
      && item.state === 'waiting_answer');
    if (card === undefined) throw new Error('G1-2: B asked for no member');
    expect((await world.post('decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
      selection: { kind: 'option', optionId: 'reject' }, text: 'G1-2: no new member', annotations: [] },
    'p6g-g1-2-reject', card.source.pins))).body).toMatchObject({ status: 'ready', value: { answer: { status: 'committed' } } });

    // A runs to its end on X (through its own check); only then is B claimed, on X.
    const ended = await driveWorkflow(world.ag2b, a.next);
    expect(ended.at(-1)?.state).toBe('completed');
    expect(await runStatus(world, committedClaim(a.receipts, 'A').run)).toEqual({ status: 'ended', outcome: 'completed' });
    const after = await driveTo(target, selectTask(target, 'p6g-g1-2-b-after', target.b), 'prepare');
    expect(committedClaim(after.receipts, 'B after A').line).toEqual(plainRef(target.x));
  }, 180_000);

  it('G1-3: both picks name X before A\'s claim commits; B\'s one advance is refused on X, picks once more and claims '
    + 'Y, and the Runs overlap', async () => {
    const target = await openG1World('p6g-g1-3', { one: false });
    const { a, b } = await bothPickX(target, 'p6g-g1-3');
    expect(pickedLineOf(a)).toEqual(plainRef(target.x));
    expect(pickedLineOf(b)).toEqual(plainRef(target.x));
    const claimedA = await driveTo(target, a, 'prepare');
    const claimA = committedClaim(claimedA.receipts, 'A');
    expect(claimA.line).toEqual(plainRef(target.x));

    // One public advance for B: its claim on X meets A's and is refused `busy`; the same step picks again and claims
    // Y. Hand count of that re-pick: X is occupied, so Y is the only candidate (`rank: 'none'` below two).
    const one = await advance(target.world.ag2b, b);
    const claimB = committedClaim([one.receipt], 'B');
    expect(claimB.line).toEqual(plainRef(target.y!));
    expect(one.pick).toEqual({ rank: 'none', incomplete: [], candidates: 1 });
    expect(one.next).toMatchObject({ kind: 'perform', operation: { kind: 'prepare' } });
    await runBothAtOnce(target, { a: claimedA.next, aRun: claimA.run, aLine: target.x,
      b: one.next!, bRun: claimB.run, bLine: target.y! });
  }, 180_000);

  it('G1-4: with one line, B\'s one advance is refused on X and takes the path of a line already taken at the pick',
    async () => {
      const target = await openG1World('p6g-g1-4', { one: true });
      const { a, b } = await bothPickX(target, 'p6g-g1-4');
      expect(pickedLineOf(b)).toEqual(plainRef(target.x));
      const claimedA = await driveTo(target, a, 'prepare');
      expect(committedClaim(claimedA.receipts, 'A').line).toEqual(plainRef(target.x));

      // One public advance for B: refused `busy` on X, picked once more there is no free line, so this same step
      // names the person's member request (as G1-2's pass); the re-pick saw no candidate. No claim of B commits.
      const one = await advance(target.world.ag2b, b);
      expect(one.next).toMatchObject({ kind: 'perform', operation: { kind: 'host_pick_member' } });
      expect(one.pick).toEqual({ rank: 'none', incomplete: [], candidates: 0 });
      expect(one.receipt?.kind === 'claim_task' && one.receipt.result.status === 'committed').toBe(false);
      expect(await target.main.taskRun(target.goal, target.b.taskId)).toBeNull();
    }, 180_000);
});
