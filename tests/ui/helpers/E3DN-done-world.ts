/**
 * E3 Done worlds (test sheet `e3done-tests.frozen.md` §1.2): the delivery
 * state of one Goal reached only through public routes and the public
 * Workflow on a real Host with the scripted model.
 *
 * The main world is the PL workflow world (`openPLWorkflowWorld`) with the
 * two-stage skeleton (`done-a`, `done-b`, no stage-2 placeholder, the goal
 * gate). The workspace root is first made a git work tree with one baseline
 * commit (the K3 git-workspace precedent, `initGitWorkspace`); the Runs then
 * change the files through the Kernel's real `edit` tool. The checks are the
 * Host's own startup check configuration (a Host input, like S8C's
 * `repairChecks`). Every registered check runs in EVERY round and covers every
 * required requirement of the Plan (`compileVerificationCoverage` reads all
 * obligations; a check's `taskIds` selects nothing), so a fixed FAIL check
 * would fail every Task. Instead `done-lint` always passes and `done-unit`
 * fails while the flag file `done-unit.fail` exists in the workspace (S8C's
 * flag precedent): the flag is up for `done-b`'s first Run (its round fails,
 * the Workflow's own `requeue_task` is the automatic rework and opens the
 * third Run after the flag is down) and for the goal gate's first round; the
 * person's `verification/reverify` takes it down for round 2. The flag is a
 * real check input written into the workspace, as E3C writes
 * `chain-unit.pass`. Usage is what the scripted replies report
 * (`usageOf`): `done-a` 500 + 125, `done-b` 1000 + 250, the rework Run 3750.
 *
 * Nothing here writes a record, reads the database or calls an owner as the
 * Runtime or the Host.
 */
import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionRef } from '../../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../../src/contracts/query-job.js';
import { findClass, findElement, type BootedPage } from './boot-page.js';
import { FakeElement } from './dom.js';
import { press, settle } from './E3M-world.js';
import { bootE3N, descendants, hasClass, textOf, type PageLog } from './E3N-page.js';
import { answerRound } from './E3D-world.js';
import type { WorkbenchRuntimeBinding } from '../../../src/app/runtime-configuration.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../../src/business/workflow/contracts.js';
import type { ArtifactRef } from '../../../src/contracts/artifact.js';
import type { RunRef, TaskTriple } from '../../../src/contracts/dispatch.js';
import type { GoalRef } from '../../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../../src/contracts/plan.js';
import { initGitWorkspace } from '../../scenarios/support/git-workspace.js';
import { cancelGoal, openW4 } from './E3N-world.js';
import { dlElement, goalRevisionOf } from './E3C-world.js';
import { driveWorkflow, readExecution, submitControl } from '../../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../../helpers/AG2b-collaboration-fixture.js';
import {
  adoptPLPlanDraft, openPLWorkflowWorld, plPlanChangeDraft, plSkeletonDraft, type PLWorkflowWorld,
} from '../../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, usageOf, type S6AHostWorld, type S6AReply } from '../../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../../helpers/S6B1-fixture.js';
import { checkConfiguration, claimedRunOf, committed, ready, sessionOf, setS7AAutonomy } from '../../helpers/S7A-fixture.js';

export const DONE_TASK_A = 'done-a';
export const DONE_TASK_B = 'done-b';
export const DONE_GOAL_GATE = 'pl-gate-goal';
export const DONE_PASS_CHECK = 'done-lint';
export const DONE_FAIL_CHECK = 'done-unit';
/** While this file exists in the workspace, `done-unit` fails (in every round). */
export const DONE_FAIL_FLAG = 'done-unit.fail';
/** The baseline commit's files (sheet §1.2 step 3). */
export const DONE_BASELINE: Readonly<Record<string, string>> = {
  'src/a.ts': 'a1\na2\na3\n', 'src/ui/x.ts': 'x1\n', 'docs/x.md': 'd1\n',
};
/** In `done-a`'s `plannedFiles` only; no Run changes it (D07). */
export const DONE_PLANNED_ONLY = 'src/planned-only.ts';

export type DoneWorldInput = {
  /** Default true: the Workflow performs `complete_goal`; false stops before it (the Goal stays active). */
  completed?: boolean;
  /** Default true: `verification/reverify` opens the goal gate's second round, which passes; false leaves round 1 (FAIL). */
  reverify?: boolean;
  /** `'pending'`: the goal gate's round is opened (`open_checks`) and no check has run (D04④). */
  checksStop?: 'pending';
  /**
   * D10: `done-b`'s automatic rework Run fails its check again, the Workflow is stopped before a second
   * automatic requeue and the person requeues through `tasks/requeue`; `done-b` stays unsatisfied, so the
   * stage and goal gates never open (no gate round).
   */
  humanRework?: boolean;
  /**
   * D11: `done-a`'s first Run is paused by the person during its model request (`controls/submit`), the
   * Host is crashed and restarted (SQLite), and the person continues it (`tasks/requeue`); the continuation
   * Run carries a `resume_after_interruption` brief. Needs the SQLite backend (set by this option).
   */
  interrupted?: boolean;
  /**
   * READS-1: the automatic rework Run of `done-b` changes `src/a.ts` again (a
   * rework touching the same file as the failed Run), so the file row's tasks
   * must be deduplicated by path. Off by default: the main world's D07 counts
   * stay unchanged.
   */
  sameFileRework?: boolean;
  /**
   * READS-8 (D08c), with `humanRework`: after the person's requeue, the person's plan change supersedes
   * `done-b` (Runs 2 and 3, `src/a.ts` changed) by a new `done-b2` (`supersedeDoneB`).
   */
  supersedeB?: boolean;
};

export type DoneDeliveryWorld = {
  readonly world: S6AHostWorld;
  readonly goal: GoalRef;
  /** The goal-scope gate (`pl-gate-goal`). */
  readonly gate: TaskTriple;
  close(): Promise<void>;
};

const triple = (goal: GoalRef, taskId: string): TaskTriple => ({ projectId: goal.projectId, goalId: goal.goalId, taskId });

/** The Host's startup check configuration (executor: the human operator). */
function doneChecks() {
  const base = checkConfiguration({ kind: 'human', id: OPERATOR.id });
  const shape = { kind: 'static' as const, cwd: '.', timeoutMs: 60_000, taskIds: 'all' as const };
  return { ...base, configurationRevision: 'e3dn-done-checks@1', checks: [
    { ...shape, checkId: DONE_PASS_CHECK, command: 'node -e "process.exit(0)"' },
    { ...shape, checkId: DONE_FAIL_CHECK,
      command: `node -e "process.exit(require('node:fs').existsSync('${DONE_FAIL_FLAG}')?1:0)"` },
  ] };
}

/** Put the `done-unit` flag up (`true`) or down. */
async function failFlag(world: S6AHostWorld, up: boolean): Promise<void> {
  if (up) await writeFile(join(world.root, DONE_FAIL_FLAG), '');
  else await rm(join(world.root, DONE_FAIL_FLAG), { force: true });
}

/** The fixture Work binding with the Kernel's `edit` (the `write` grant) over the whole root. */
const WRITE_TOOLS = { binding: { id: 's6a-work-binding' } as WorkbenchRuntimeBinding,
  mergeTools: ['write'], mergeWriteScope: ['.'] };

/** The `edit` tool's `expectedRevision`: the sha256 of the file's text before the edit. */
const revisionOf = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/** One `replace` edit of `path`, whose text before the edit is `before`. */
const replace = (callId: string, path: string, before: string, oldText: string, newText: string) =>
  ({ callId, name: 'edit', args: { mode: 'replace', path, oldText, newText, expectedRevision: revisionOf(before) } });

const DONE_A_EDITS: S6AReply = { kind: 'calls', usage: usageOf(500), calls: [
  replace('e3dn-a-src', 'src/a.ts', DONE_BASELINE['src/a.ts']!, 'a3', 'a3\na4'),
  replace('e3dn-a-ui', 'src/ui/x.ts', DONE_BASELINE['src/ui/x.ts']!, 'x1', 'x1\nx2'),
  replace('e3dn-a-docs', 'docs/x.md', DONE_BASELINE['docs/x.md']!, 'd1', 'd1\nd2'),
] };
const DONE_B_EDIT: S6AReply = { kind: 'calls', usage: usageOf(1000), calls: [
  replace('e3dn-b-src', 'src/a.ts', 'a1\na2\na3\na4\n', 'a2\na3\na4', 'a2b\na3\na4\na5'),
] };
/** READS-1: the rework Run edits the same file again (`done-b`'s second actual file record). */
const DONE_REWORK_EDIT: S6AReply = { kind: 'calls', usage: usageOf(3750), calls: [
  replace('e3dn-rework-src', 'src/a.ts', 'a1\na2b\na3\na4\na5\n', 'a5', 'a5\na6'),
] };

type StopBefore = string | ((operation: { kind: string }) => boolean);

/**
 * Advances the Workflow until it settles or stops right before `stopBefore`; returns the next input in the
 * latter case (left unperformed) and null in the former.
 */
async function proceed(world: S6AHostWorld, input: WorkflowAdvanceInput, stopBefore: StopBefore | undefined,
  receipts: WorkflowStepReceipt[]): Promise<WorkflowAdvanceInput | null> {
  return (await driveWorkflow(world.ag2b, input,
    { ...(stopBefore === undefined ? {} : { stopBefore }), receipts })).at(-1)!.next;
}

const select = (goal: GoalRef, flowId: string, taskId?: string, sessionHint: S6ASession | null = null): WorkflowAdvanceInput =>
  ({ schemaVersion: 1, goalRef: goal, flowId, sessionHint: sessionHint === null ? null : sessionHint.ref,
    kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) }) as WorkflowAdvanceInput;

/** The goal gate's `verification/round` as the route answers it (`not_found` is no round yet). */
export type DoneGateRound = {
  chain: { rounds: Array<{ roundRef: Record<string, unknown>; revision: number }> };
  delivery: { requirements: Array<{ description: string; state: string; checks: Array<{ reportRef: ArtifactRef | null }> }> };
};

export async function gateRound(world: S6AHostWorld, gate: TaskTriple): Promise<DoneGateRound | null> {
  const body = (await world.post('verification/round', plain(S6A_SCOPE, { taskRef: gate }))).body as
    { status?: string; value?: DoneGateRound };
  if (body.status === 'not_found') return null;
  return ready<DoneGateRound>(body, 'E3DN verification/round');
}

/** The person's `tasks/requeue` of `afterRun` (TASK-16/27), pinned to the Goal and the Run as read now. */
async function personRequeue(world: S6AHostWorld, goal: GoalRef, task: TaskTriple, afterRun: RunRef,
  requestId: string, reason: string): Promise<void> {
  const run = (await readExecution(world.ag2b, afterRun)).run;
  const outcome = committed<{ kind: string }>(await world.post('tasks/requeue', graphWrite(S6A_SCOPE,
    { taskRef: task, afterRunRef: afterRun, reason }, requestId,
    [{ ref: goal, revision: await goalRevisionOf(world, goal) }, { ref: afterRun, revision: run.revision }])),
  `E3DN tasks/requeue ${requestId}`);
  if (outcome.kind !== 'requeued') throw new Error(`E3DN: tasks/requeue ${requestId} answered ${JSON.stringify(outcome)}`);
}

/**
 * D11's first half: `done-a`'s first Run is held at its model request (one `read` call), the person pauses it
 * (`controls/submit`), the request is let go and the Run pauses at its safe point before the call runs; the
 * SQLite Host is crashed (W-20 ends the Run paused-interrupted). Only then is the root made the git work tree
 * (the restarted Host placed its store while the root was not one, KLS-1a). The person continues the Task
 * (`tasks/requeue`); the continuation Run makes `done-a`'s three edits and passes its round.
 */
async function interruptDoneA(world: S6AHostWorld, goal: GoalRef, line: S6ASession,
  receipts: WorkflowStepReceipt[]): Promise<{ interrupted: RunRef; resumed: RunRef }> {
  await world.scripted.script(line, [{ kind: 'calls', calls: [
    { callId: 'e3dn-a-look', name: 'read', args: { path: 'tsconfig.json' } }] }]);
  const hold = await world.gates.modelRequest(line);
  const from = receipts.length;
  const driving = proceed(world, select(goal, 'e3dn-a-paused', DONE_TASK_A, line), undefined, receipts);
  await hold.reached;
  const [interrupted] = receipts.slice(from).flatMap(receipt =>
    receipt.kind === 'claim_task' && receipt.result.status === 'committed' ? [receipt.result.value.runRef] : []);
  if (interrupted === undefined) throw new Error('E3DN: done-a was not claimed before its model request');
  await submitControl(world.ag2b, interrupted, 'pause', 'E3DN: the person pauses done-a', 'e3dn-a-pause');
  hold.release();
  await driving;
  await world.crash();
  await initGitWorkspace(world.root, { files: { ...DONE_BASELINE }, message: 'E3DN baseline' });
  await personRequeue(world, goal, triple(goal, DONE_TASK_A), interrupted, 'e3dn-a-continue', 'E3DN: continue done-a');
  await world.scripted.script(line, [DONE_A_EDITS, { kind: 'text', text: 'E3DN done-a continued', usage: usageOf(125) }]);
  const resumedFrom = receipts.length;
  await proceed(world, select(goal, 'e3dn-a-resumed', DONE_TASK_A, line), undefined, receipts);
  const resumed = claimedRunOf(receipts.slice(resumedFrom), 'the continuation of done-a').run;
  return { interrupted, resumed };
}

/**
 * READS-8 (D08c): the person's plan change supersedes `done-b` by a new `done-b2` of the same stage through
 * `plans/propose` + `plans/apply`, in `plSupersedeDraft`'s disposition-only shape (PL-37): `done-b` keeps its
 * definition, its Runs and its `src/a.ts` record, and stays a carrier of its obligation beside `done-b2`.
 * `reason.affectedTaskIds` names the traced `done-b`; without it `plans/apply` answers `invalid`.
 */
async function supersedeDoneB(workflow: PLWorkflowWorld, goal: GoalRef): Promise<void> {
  const plan = await workflow.main.activePlan(goal);
  if (plan === null) throw new Error('E3DN: no adopted Plan to change');
  const b2 = 'done-b2';
  const draft = plPlanChangeDraft(plan, goal, {
    planId: 'pl-plan-done-v2',
    tasks: [...plan.tasks.map((task) => task.taskId === DONE_TASK_B
      ? { ...task, disposition: 'superseded' as const, replacedByTaskId: b2 } : task),
    { taskId: b2, stageId: 'pl-stage-1', title: 'E3DN replacement done-b2', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'pl-stage-1' },
      executionIntent: 'request_execution', sizeClass: 'small' }],
    assignments: [...(plan.assignments ?? []), { taskId: b2, role: S6A_WORK_ROLE.templateId, instruction: 'E3DN done-b2' }],
    obligations: plan.obligations.map((obligation) => obligation.taskIds.includes(DONE_TASK_B)
      ? { ...obligation, taskIds: [...obligation.taskIds, b2] } : obligation),
  });
  const proposed = committed<{ ref: unknown; revision: number }>(await workflow.main.post('plans/propose',
    graphWrite(workflow.main.scope, { goalRef: goal, basedOn: plan.ref, draft,
      reason: { text: 'E3DN: done-b is replaced by done-b2', sources: [], affectedTaskIds: [DONE_TASK_B] } },
    'e3dn-supersede-b-propose')), 'E3DN plans/propose');
  committed(await workflow.main.post('plans/apply', graphWrite(workflow.main.scope, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, 'e3dn-supersede-b-apply')), 'E3DN plans/apply');
}

/**
 * The main Done world (sheet §1.2). The caller closes it (`close`, or `world.close()`); every option is a
 * public step of the same chain, see `DoneWorldInput`.
 */
export async function openDoneDeliveryWorld(input: DoneWorldInput = {}): Promise<DoneDeliveryWorld> {
  const completed = input.completed ?? true;
  const reverify = input.reverify ?? true;
  const workflow = await openPLWorkflowWorld({ label: 'done', ...(input.interrupted === true ? { backend: 'sqlite' as const } : {}),
    extraBindings: [WRITE_TOOLS], extraHostOptions: { checks: doneChecks() } });
  const world = workflow.world;
  try {
    // D11 restarts the SQLite Host, which places the project store by the root's git state (KLS-1a): the root
    // must not turn into a git work tree before that restart, so its baseline commit waits until after it.
    if (input.interrupted !== true) await initGitWorkspace(world.root, { files: { ...DONE_BASELINE }, message: 'E3DN baseline' });
    const goal = workflow.goal;
    // D07's named break reads `plannedFiles`: `done-a`'s Plan lists one file no Run ever changes.
    const draft = plSkeletonDraft(goal, {
      label: 'done', stageOneTaskIds: [DONE_TASK_A, DONE_TASK_B], omitStagePlaceholder: true, goalGate: true });
    await adoptPLPlanDraft(workflow.main, goal, { ...draft, tasks: draft.tasks.map((task) => task.taskId === DONE_TASK_A
      ? { ...task, plannedFiles: ['src/a.ts', DONE_PLANNED_ONLY] } : task) }, 'done');
    await setS7AAutonomy(world, goal, 'after_plan_confirmation');
    const line = await sessionOf(world, await createS6BLine(workflow.main, { label: 'e3dn-line', role: S6A_WORK_ROLE,
      tasks: [triple(goal, DONE_TASK_A), triple(goal, DONE_TASK_B)] }));
    const receipts: WorkflowStepReceipt[] = [];

    // done-a: one Run edits the three files and passes (625); D11 pauses it first and continues it.
    if (input.interrupted === true) {
      await interruptDoneA(world, goal, line, receipts);
    } else {
      await world.scripted.script(line, [DONE_A_EDITS, { kind: 'text', text: 'E3DN done-a finished', usage: usageOf(125) }]);
      await proceed(world, select(goal, 'e3dn-a', DONE_TASK_A, line), undefined, receipts);
    }

    // done-b: Run 2 edits src/a.ts (1250) and fails `done-unit` (flag up); the Workflow's automatic requeue
    // opens Run 3 (3750), which passes once the flag is down (D10 keeps it up: Run 3 fails too).
    const reworkReplies: S6AReply[] = input.sameFileRework === true
      ? [DONE_REWORK_EDIT, { kind: 'text', text: 'E3DN done-b reworked', usage: usageOf(3750) }]
      : [{ kind: 'text', text: 'E3DN done-b reworked', usage: usageOf(3750) }];
    await world.scripted.script(line, [DONE_B_EDIT, { kind: 'text', text: 'E3DN done-b finished', usage: usageOf(250) },
      ...reworkReplies]);
    await failFlag(world, true);
    const failedB = await proceed(world, select(goal, 'e3dn-b', DONE_TASK_B, line), 'requeue_task', receipts);
    if (failedB === null) throw new Error('E3DN: done-b did not stop before its automatic requeue');
    if (input.humanRework !== true) await failFlag(world, false);
    const fromRework = receipts.length;
    const reworked = await proceed(world, failedB, 'requeue_task', receipts);
    const rework = claimedRunOf(receipts.slice(fromRework), 'the automatic rework of done-b').run;
    const base = { world, goal, gate: triple(goal, DONE_GOAL_GATE), close: async () => { await workflow.close(); } };

    if (input.humanRework === true) {
      // D10: Run 3 failed again; the person takes the flag down (a requeue with no new basis is refused,
      // `no_new_basis`) and requeues instead of the second automatic requeue. No Run takes it yet.
      if (reworked === null) throw new Error('E3DN: the rework did not stop before a requeue');
      await failFlag(world, false);
      await personRequeue(world, goal, triple(goal, DONE_TASK_B), rework, 'e3dn-b-person-rework', 'E3DN: the person reworks done-b');
      if (input.supersedeB === true) await supersedeDoneB(workflow, goal);
      return base;
    }

    // The stage gate's round passes (flag down); the goal gate's round 1 has `done-unit` FAIL (flag up).
    // The gates are selected at Goal level (a `taskId` selection of a gate is "not executable right now"),
    // so the one selection is stopped right before the goal gate's `open_checks`.
    const gateStops = ['reverify_round', 'requeue_task', 'complete_goal'];
    const gateStop = (operation: { kind: string }) => gateStops.includes(operation.kind);
    const goalGateOpens = (operation: { kind: string }) => operation.kind === 'open_checks'
      && JSON.stringify(operation).includes(`"${DONE_GOAL_GATE}"`);
    const stage = await proceed(world, select(goal, 'e3dn-gates'),
      operation => gateStop(operation) || goalGateOpens(operation), receipts);
    if (stage === null || !goalGateOpens((stage as { operation: { kind: string } }).operation)) {
      throw new Error('E3DN: the goal gate did not come up for its round');
    }
    if (input.checksStop === 'pending') {
      await proceed(world, stage, 'run_check', receipts);
      return base;
    }
    await failFlag(world, true);
    await proceed(world, stage, gateStop, receipts);
    if (reverify) {
      const head = (await gateRound(world, base.gate))?.chain.rounds.at(-1);
      if (head === undefined) throw new Error('E3DN: the goal gate has no round 1');
      await failFlag(world, false);
      const ref = head.roundRef as { projectId: string; goalId: string; taskId: string; roundId: string };
      const refusal = { aggregateType: 'TaskReworkRefusal', projectId: ref.projectId, goalId: ref.goalId, taskId: ref.taskId,
        operation: 'reverify', subjectId: ref.roundId };
      committed(await world.post('verification/reverify', graphWrite(S6A_SCOPE, {
        predecessorRoundRef: head.roundRef, reason: 'E3DN: the unit check is fixed',
      }, `e3dn-reverify-${ref.roundId}`, [{ ref: head.roundRef, revision: head.revision }, { ref: refusal, revision: 0 }])),
      'E3DN verification/reverify');
      await proceed(world, select(goal, 'e3dn-goal-gate-2'), gateStop, receipts);
      if (completed) await proceed(world, select(goal, 'e3dn-complete'), undefined, receipts);
    }
    return base;
  } catch (error) {
    await workflow.close().catch(() => undefined);
    throw error;
  }
}

/* ------------------------------------------- the empty-state worlds (sheet §1.2 ①–⑥, D09) */

/** One empty-state world: the Goal a row opens with `?goal=` (null in ①, which has none). */
export type DoneEmptyWorld = {
  readonly world: S6AHostWorld;
  readonly goal: GoalRef | null;
  close(): Promise<void>;
};

/** A world whose Goal and adopted Plan the row reads. */
export type DonePlanWorld = DoneEmptyWorld & { readonly goal: GoalRef };

/** The Goal ③ creates through `goals/create` and never adopts a Plan for. */
export const DONE_NO_PLAN_GOAL_ID = 'e3dn-no-plan';
export const DONE_NO_PLAN_OBJECTIVE = 'E3DN goal without a plan';
/** ⑦'s two placeholders: the deferred stage-2 one and the goal-level `plan_only` one. */
export const DONE_GOAL_PLACEHOLDER = 'pl-goal-placeholder';

/** Close `world` when `build` throws. */
async function builtOn<T>(close: () => Promise<void>, build: () => Promise<T>): Promise<T> {
  try {
    return await build();
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

/** A PL workflow world (governance seeded) whose goal 1 adopts `draft`. */
async function planWorld(label: string, draft: (goal: GoalRef) => PlanRevisionDraft): Promise<DonePlanWorld> {
  const workflow: PLWorkflowWorld = await openPLWorkflowWorld({ label });
  return await builtOn(workflow.close, async () => {
    await adoptPLPlanDraft(workflow.main, workflow.goal, draft(workflow.goal), label);
    return { world: workflow.world, goal: workflow.goal, close: workflow.close };
  });
}

/**
 * ④/⑥'s Plan: stage 1's `done-a` and `done-b` (`request_execution`, so no gate is required, `plan-validation.ts:92`)
 * and no stage gate; `goalGate` adds the goal-scope gate `pl-gate-goal` with its own required obligation.
 */
function doneWorkOnlyDraft(goal: GoalRef, label: string, goalGate: boolean): PlanRevisionDraft {
  const base = plSkeletonDraft(goal, { label, stageOneTaskIds: [DONE_TASK_A, DONE_TASK_B], omitStagePlaceholder: true, goalGate });
  return { ...base,
    tasks: base.tasks.filter(task => task.taskKind !== 'gate' || task.scope.kind === 'goal'),
    obligations: (base.obligations ?? []).filter(obligation => obligation.obligationId === 'pl-obligation-goal') };
}

/** ① No Goal at all: the seed's project and workspace only (`defaultGoals: false`, no `goals/create`). */
export async function openDoneNoGoalWorld(): Promise<DoneEmptyWorld> {
  const world = await openS6AHostWorld({ backend: 'memory', defaultGoals: false });
  return { world, goal: null, close: async () => { await world.close(); } };
}

/**
 * ② Only finished Goals: goal 1 completed as W4 completes it (`adoptS6BPlan`, the public Workflow and
 * `completeS7BGoal`) but WITHOUT W4's next Plan (after it W4's goal 1 reads `RUNNING` again), and goal 2
 * cancelled through the public `goals/control`. `goal` is null: the row opens the page without `?goal=`.
 */
export async function openDoneTerminalOnlyWorld(): Promise<DoneEmptyWorld & {
  readonly completed: GoalRef; readonly cancelled: GoalRef;
}> {
  const w4 = await openW4({ nextPlan: false });
  const close = async () => { await w4.world.close(); };
  return await builtOn(close, async () => {
    await cancelGoal(w4.world, w4.world.goals.second);
    return { world: w4.world, goal: null, completed: w4.goal, cancelled: w4.world.goals.second, close };
  });
}

/** ③ A Goal with no adopted Plan: a new Goal through the public `goals/create`, never adopted for. */
export async function openDoneNoPlanWorld(): Promise<DoneEmptyWorld & { readonly goal: GoalRef }> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  const close = async () => { await world.close(); };
  return await builtOn(close, async () => {
    const created = await s6aCardsWorkspace(world, S6A_SCOPE).createGoal(DONE_NO_PLAN_GOAL_ID, DONE_NO_PLAN_OBJECTIVE);
    return { world, goal: created.ref, close };
  });
}

/** ④ An adopted Plan with no gate (only `done-a` and `done-b`), through `plans/propose`/`plans/apply`. */
export async function openDoneNoGateWorld(): Promise<DonePlanWorld> {
  return await planWorld('done4', goal => doneWorkOnlyDraft(goal, 'done4', false));
}

/** ⑤ Two stage gates (`pl-gate-pl-stage-1`, `pl-gate-pl-stage-2`) and no goal gate: the two-stage skeleton. */
export async function openDoneTwoStageGateWorld(): Promise<DonePlanWorld> {
  return await planWorld('done5', goal => plSkeletonDraft(goal,
    { label: 'done5', stageOneTaskIds: [DONE_TASK_A, DONE_TASK_B], omitStagePlaceholder: false, goalGate: false }));
}

/** ⑥ ④'s Plan plus the goal gate `pl-gate-goal`, never driven: the gate has no round. */
export async function openDoneUndrivenGateWorld(): Promise<DonePlanWorld & { readonly gate: TaskTriple }> {
  const opened = await planWorld('done6', goal => doneWorkOnlyDraft(goal, 'done6', true));
  return { ...opened, gate: triple(opened.goal, DONE_GOAL_GATE) };
}

/**
 * D09: the two-stage skeleton with the stage-2 `plan_only` placeholder deferred and a goal-level `plan_only`
 * placeholder (`future`), the goal gate as in the main world; nothing is driven.
 */
export async function openDonePlaceholderWorld(): Promise<DonePlanWorld> {
  return await planWorld('done9', goal => plSkeletonDraft(goal, { label: 'done9', stageOneTaskIds: [DONE_TASK_A, DONE_TASK_B],
    omitStagePlaceholder: false, placeholderDisposition: 'deferred', goalPlaceholderTaskId: DONE_GOAL_PLACEHOLDER, goalGate: true }));
}

/* ================================================================ the page */

export type DonePage = { page: BootedPage; log: PageLog };

/**
 * The Done page on a real Host (sheet §1.1): the page text through `bootPage`,
 * every request forwarded to the Host as is and logged, the change stream held
 * (so the counts are the page's own first read and a click's reread). `before`
 * runs before a named route is forwarded (D14/D19 answer the round there
 * first, because the page reads the request exactly once).
 */
export const bootDone = (target: { readonly base: string; readonly token: string }, goalId: string | null,
  options: { failOnce?: string; before?: Record<string, (log: PageLog) => Promise<void>> } = {}): Promise<DonePage> =>
  bootE3N(target, 'Done', { search: goalId === null ? '' : '?goal=' + goalId, mode: 'controlled', gate: true, ...options });

/**
 * Answer the request the page's last `requests/submit` queued: the Host picked
 * (or made) the secretary line; its round is claimed, prepared and started
 * through the public Query routes with `body` scripted as the secretary's
 * answer (the request driver is off in this world, so nothing else runs it).
 */
export async function answerDoneAsk(world: S6AHostWorld, log: PageLog, label: string, body: string): Promise<void> {
  const submitted = log.submits.at(-1) as { requestRoot?: QueryJobRef; round?: QueryJobRef; secretary?: SessionRef } | undefined;
  if (submitted?.requestRoot === undefined || submitted.round === undefined || submitted.secretary === undefined) {
    throw new Error(`E3DN: the page's requests/submit queued nothing: ${JSON.stringify(submitted)}`);
  }
  const { requestRoot, round, secretary } = submitted;
  const card = await world.readSession(secretary);
  const session: S6ASession = { label: `${label}-secretary`, ref: secretary, aggregateRef: card.record.ref,
    role: structuredClone(card.record.role), createdAt: card.record.createdAt };
  await answerRound(world, { requestRoot, round }, session, body, label);
}

/* --------------------------------------------------------------- DOM reads */

/** The delivery view (`section#delivery`). */
export function deliveryOf(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('id') === 'delivery');
}

/** The element whose children hold `child` (the fake DOM has no `parentNode`). */
function parentOf(root: FakeElement, child: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.childNodes.includes(child));
}

/** The first element sibling after `element`: an open row's detail (`dv-more`, `dv-files`, `dv-fmore`, `dv-body`). */
export function detailAfter(root: FakeElement, element: FakeElement | undefined, className: string): FakeElement | undefined {
  if (element === undefined) return undefined;
  const parent = parentOf(root, element);
  if (parent === undefined) return undefined;
  const siblings = parent.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  const next = siblings[siblings.indexOf(element) + 1];
  return next === undefined ? undefined : findClass(next, className);
}

/** One of the five section heads (`.dv-nm` 验收要求与证据 / 改动的文件 / 没有做的 / 返工与接续 / 用量). */
export function sectionHead(root: FakeElement, name: string): FakeElement | undefined {
  return descendants(root).find((element) => element.tagName.toLowerCase() === 'button'
    && textOf(findClass(element, 'dv-nm')) === name);
}

/** The head's `.dv-sum` (the section's one-line summary). */
export function sectionSum(root: FakeElement, name: string): string {
  const head = sectionHead(root, name);
  return head === undefined ? '' : textOf(findClass(head, 'dv-sum'));
}

/** The open section's body (`.dv-body` beside its head). */
export function sectionBody(root: FakeElement, name: string): FakeElement | undefined {
  return detailAfter(root, sectionHead(root, name), 'dv-body');
}

/** Open a section by its head and wait for its body. */
export async function openSection(root: FakeElement, name: string): Promise<FakeElement | undefined> {
  press(sectionHead(root, name), name);
  await settle(() => sectionBody(root, name) !== undefined);
  return sectionBody(root, name);
}

/** Press a row and wait for its detail (`className`) beside it. */
export async function openRow(root: FakeElement, row: FakeElement | undefined, className: string, what: string): Promise<FakeElement | undefined> {
  press(row, what);
  await settle(() => detailAfter(root, row, className) !== undefined);
  return detailAfter(root, row, className);
}

/** The row buttons of a section body (requirement, module, rework rows), in order; not the rows inside an open detail. */
export function bodyRows(body: FakeElement | undefined): FakeElement[] {
  if (body === undefined) return [];
  const nested = new Set(descendants(body).filter((element) => hasClass(element, 'dv-files') || hasClass(element, 'dv-more'))
    .flatMap((element) => [element, ...descendants(element)]));
  return descendants(body).filter((element) => element.tagName.toLowerCase() === 'button'
    && findClass(element, 'dv-main') !== undefined && !nested.has(element));
}

/** A row's own text (`.dv-main`, without a module's `.dv-path`). */
export function rowMain(row: FakeElement | undefined): string {
  const main = row === undefined ? undefined : findClass(row, 'dv-main');
  if (main === undefined) return '';
  const path = textOf(findClass(main, 'dv-path'));
  const text = textOf(main);
  return path !== '' && text.endsWith(path) ? text.slice(0, text.length - path.length).trim() : text;
}

/** A row's evidence text (`.dv-ev`). */
export function rowEv(row: FakeElement | undefined): string {
  return row === undefined ? '' : textOf(findClass(row, 'dv-ev'));
}

/** The question composer's input (`#composer-input`). */
export function composerBox(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('id') === 'composer-input');
}

/** The `.dv-lines` spans of an open row's detail. */
export function detailLines(more: FakeElement | undefined): string[] {
  const lines = more === undefined ? undefined : findClass(more, 'dv-lines');
  return lines === undefined ? [] : lines.childNodes.filter((child): child is FakeElement => child instanceof FakeElement)
    .map((span) => textOf(span));
}

/** The frozen board's own goal-1 sample literals; none may show on a real page (D16). */
export const DONE_SAMPLE_TEXTS = ['10-06 16:33', '状态机可靠性改造', '6/6 通过'] as const;

/** `materials/open` of a report as the route answers it (a public read). */
export async function doneReportBody(world: S6AHostWorld, ref: ArtifactRef): Promise<unknown> {
  return (ready(await world.post('materials/open', plain(S6A_SCOPE, { ref, usage: 'historical_explanation' })),
    'materials/open') as { body: unknown }).body;
}
