/**
 * E38-R9 (e38-spec.md §3.5 items 2 and 3, §7 R9; e38-start-rulings.md items 13 and 17): the module-overlap gate only
 * narrows on `plannedFiles`, through the real Workflow, and the task detail shows the file the narrowing let through.
 *
 * Each cell opens its own S7C world (`openS7C1World({ adviser: false })`; its catalog is adopted, `s6a-core` is
 * `['src']`). A new Goal's Plan goes through `plans/propose` + `plans/apply` (the S7C-member-fixture.ts:287–:294 way);
 * every work Task is module `s6a-core` and has a line of its own (`S7C1_CREATE_ROLE`, S7C-L1-overlap.test.ts:62). A
 * running Task is claimed and started through `workflow/advance` and held at its real model request (the
 * `holdPLTaskRequest` pattern, PL-workflow-fixture.ts:376–:394, written here because cell 1 edits a file before it
 * holds). Every later step is a `select_work` naming its Task (a named advance still meets the overlap gate,
 * workflow.ts:1700–:1703). Nothing is read from the store; the gate, the Run and the risks are public reads.
 *
 * Cell 1: `e38-r` ['src/e38-a.ts'] runs and really creates `src/e38-b.ts` (outside its own list, inside `e38-w1`'s
 * ['src/e38-b.ts']). The gate never reads a running Task's executed files (§3.5 item 2), so `e38-w1` is claimed with
 * no gate; once `e38-r`'s Run has ended, its risks show that file as `planned` (§3.5 item 3).
 * Cell 2: `e38-r` ['src/e38-a.ts'] and `e38-r2` ['src/e38-c.ts'] both run; `e38-w2` ['src/e38-a.ts'] opens the gate
 * and the gate's basis names only `e38-r` (the rule's conflict set, not every running Task of the module).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { NodeDetailV1, NodeRiskV1 } from '../../src/contracts/work-line.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { advanceUntil, driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AGate } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { openS7C1World, S7C1_CREATE_ROLE, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { waitFor } from '../scenarios/harness.js';

const STAGE = 'e38-r9-stage';
const EDIT_CALL = 'e38-r9-edit';

type PlannedFiles = Readonly<Record<string, readonly string[]>>;

/** The `moduleDraft` way from `ag2bPlanDraft` (S7C-member-fixture.ts:196–:207): one stage, every work Task module
 *  `s6a-core` with its `plannedFiles`; the gate and the obligation stay `ag2bPlanDraft`'s. */
function gatePlanDraft(goal: GoalRef, files: PlannedFiles): PlanRevisionDraft {
  const draft = ag2bPlanDraft(Object.keys(files));
  return {
    ...draft, planId: `${goal.goalId}-plan`, goalId: goal.goalId,
    stages: [{ stageId: STAGE, title: 'E38-R9 stage' }],
    tasks: draft.tasks.map(task => task.taskKind === 'work' ? { ...task,
      scope: { kind: 'module', stageId: STAGE, moduleRef: 's6a-core' }, plannedFiles: [...files[task.taskId]!] } : task),
    assignments: (draft.assignments ?? []).map(assignment => ({ ...assignment,
      role: S7C1_CREATE_ROLE.templateId, instruction: `E38-R9 ${assignment.taskId}` })),
  };
}

const taskOf = (goal: GoalRef, taskId: string) => ({ projectId: goal.projectId, goalId: goal.goalId, taskId });

/** A new Goal with its adopted Plan and one line per work Task (each line responsible for its Task). */
async function openGoal(target: S7C1World, label: string, files: PlannedFiles) {
  const goal = (await target.main.createGoal(`${label}-goal`, `E38-R9 ${label}`)).ref;
  const proposed = valueOf<{ ref: unknown; revision: number }>(await target.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft: gatePlanDraft(goal, files), reason: { text: `E38-R9 ${label}`, sources: [] },
  }, `${label}-propose`)), 'committed', `the ${label} Plan proposal`);
  valueOf(await target.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `${label}-apply`)), 'committed', `the ${label} Plan adoption`);
  const plan: PlanRevisionSnapshot | null = await target.main.activePlan(goal);
  if (plan === null) throw new Error(`E38-R9: ${label} has no adopted Plan`);
  const lines = new Map<string, S6ASession>();
  for (const taskId of Object.keys(files)) {
    lines.set(taskId, await sessionOf(target.world, await createS6BLine(target.main, {
      label: `${label}-${taskId}`, role: S7C1_CREATE_ROLE, tasks: [taskOf(goal, taskId)] })));
  }
  const line = (taskId: string): S6ASession => {
    const found = lines.get(taskId);
    if (found === undefined) throw new Error(`E38-R9: no line for ${taskId}`);
    return found;
  };
  return { goal, plan, line };
}

const selectOf = (goal: GoalRef, taskId: string, line: S6ASession): WorkflowAdvanceInput => ({
  schemaVersion: 1, goalRef: goal, flowId: `e38-r9-${goal.goalId}-${taskId}`, sessionHint: line.ref,
  kind: 'select_work', taskId,
});

/** One Task's claim and Run, its drive still pending at a held model request. */
type HeldRun = { readonly taskId: string; readonly receipts: WorkflowStepReceipt[];
  readonly gates: readonly S6AGate<ModelRequest>[]; readonly driving: Promise<unknown> };

/**
 * The `holdPLTaskRequest` steps with the claim already read (`advanceUntil(..., 'claim_task')`): `holds` model-request
 * gates on the line first, then the claim and the Run through `driveWorkflow(..., { stopBefore: 'open_checks' })`.
 * Each gate holds the line's next model request in turn (S6A-host-fixture.ts:469).
 */
async function startHeld(target: S7C1World, taskId: string, claim: WorkflowAdvanceInput, line: S6ASession,
  holds: number, all: HeldRun[]): Promise<HeldRun> {
  const gates: S6AGate<ModelRequest>[] = [];
  for (let index = 0; index < holds; index += 1) gates.push(await target.world.gates.modelRequest(line));
  const receipts: WorkflowStepReceipt[] = [];
  const held: HeldRun = { taskId, receipts, gates,
    driving: driveWorkflow(target.world.ag2b, claim, { stopBefore: 'open_checks', receipts }) };
  all.push(held);
  return held;
}

/** The gate's held request; a drive that settles before it (no model request reached) fails with its receipts. */
async function reach(held: HeldRun, gate: S6AGate<ModelRequest>, what: string): Promise<ModelRequest> {
  const ended = held.driving.then((): never => {
    throw new Error(`E38-R9: ${what} of ${held.taskId} was never reached: ${JSON.stringify(held.receipts)}`);
  });
  return await Promise.race([gate.reached, ended]);
}

/** The held Task is claimed and its Run is entered (PL-workflow-fixture.ts:386–:392). */
async function expectEntered(target: S7C1World, held: HeldRun): Promise<void> {
  const claim = held.receipts.find(receipt => receipt.kind === 'claim_task');
  if (claim === undefined || claim.result.status !== 'committed') {
    throw new Error(`E38-R9: ${held.taskId} was not claimed: ${JSON.stringify(held.receipts)}`);
  }
  const execution = await readExecution(target.world.ag2b, claim.result.value.runRef);
  if (execution.run.status !== 'running') throw new Error(`E38-R9: the ${held.taskId} Run is not entered`);
}

async function gatesOf(target: S7C1World, goal: GoalRef): Promise<ModuleOverlapGateV1[]> {
  return valueOf<{ gates: ModuleOverlapGateV1[] }>((await target.world.post('goals/overlap-gates', plain(S6A_SCOPE, {
    goalRef: goal, page: { limit: 10 } }))).body, 'ready', 'goals/overlap-gates').gates;
}

type RiskRow = { taskId: string; shared: NodeRiskV1['shared'] };

/** Every `risks` page of one Task (read to `nextCursor: null`), as `{ taskId, shared }` sorted by `taskId`. */
async function risksOf(target: S7C1World, goal: GoalRef, plan: PlanRevisionSnapshot, taskId: string): Promise<RiskRow[]> {
  const items: NodeRiskV1[] = [];
  let afterCursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const read: NodeDetailV1 = valueOf<NodeDetailV1>((await target.world.post('graph/detail', plain(S6A_SCOPE, {
      goalRef: goal, node: { kind: 'task', ref: taskOf(goal, taskId), planRef: plan.ref }, section: 'risks',
      page: { afterCursor, limit: 20 } }))).body, 'ready', `graph/detail risks of ${taskId}`);
    if (read.section !== 'risks') throw new Error(`E38-R9: graph/detail answered ${read.section}`);
    items.push(...read.items);
    if (read.nextCursor === null) {
      return items.map(item => ({ taskId: item.task.taskId, shared: item.shared }))
        .sort((left, right) => left.taskId.localeCompare(right.taskId));
    }
    afterCursor = read.nextCursor;
  }
  throw new Error(`E38-R9: the risks pages of ${taskId} did not end`);
}

/** Release every held request, let every drive settle, then close the world (PL-31's `finally`). */
async function closeAll(target: S7C1World, held: readonly HeldRun[]): Promise<void> {
  try {
    for (const run of held) for (const gate of run.gates) gate.release();
    await Promise.allSettled(held.map(run => run.driving));
  } finally {
    await target.close();
  }
}

describe('E38-R9: the module-overlap gate narrows on plannedFiles', () => {
  it('disjoint lists dispatch at once; a running edit inside the other list does not gate, and shows as a planned-file risk', async () => {
    /* Named mutation: the dispatch's overlap facts carry no plannedFiles — e38-w1 opens the gate: the claim_task
       expect, the no-open_overlap_gate expect and the `gates: []` expect go red.
       Named mutation: the detail compares neither planned nor executed files — e38-r never shows e38-w1: the
       `waitFor` on the risks times out. */
    // Cell 1's executor edits a file: `s7c-create-binding` gets the `write` grant (the Kernel maps it to `edit`).
    const target = await openS7C1World({ adviser: false, configure: (configuration) => {
      const binding = configuration.bindings.find((entry) => entry.id === 's7c-create-binding')!;
      binding.grant = { ...binding.grant, tools: [...(binding.grant.tools ?? []), 'write'] };
    } });
    const held: HeldRun[] = [];
    try {
      const { goal, plan, line } = await openGoal(target, 'e38-r9-c1', {
        'e38-r': ['src/e38-a.ts'], 'e38-w1': ['src/e38-b.ts'] });

      // (1)(2) e38-r edits src/e38-b.ts, outside its own list and inside e38-w1's; two holds on its line: the first
      // request is let go, the edit runs, the second request is held. e38-r is running and the file is changed.
      await target.world.scripted.script(line('e38-r'), [
        { kind: 'calls', calls: [{ callId: EDIT_CALL, name: 'edit',
          args: { mode: 'create', path: 'src/e38-b.ts', newText: 'export const e38B = 1;\n' } }] },
        { kind: 'text', text: 'E38-R9 e38-r answer' },
      ]);
      const claimR = await advanceUntil(target.world.ag2b, selectOf(goal, 'e38-r', line('e38-r')), 'claim_task');
      const r = await startHeld(target, 'e38-r', claimR, line('e38-r'), 2, held);
      await reach(r, r.gates[0]!, 'the first model request');
      r.gates[0]!.release();
      const second = await reach(r, r.gates[1]!, 'the second model request');
      const edited = second.messages.find(message => message.role === 'tool' && message.callId === EDIT_CALL);
      if (edited === undefined || edited.role !== 'tool' || edited.result.status !== 'success'
        || !existsSync(join(target.world.root, 'src/e38-b.ts'))) {
        throw new Error(`E38-R9: the e38-r edit did not create src/e38-b.ts: ${JSON.stringify(edited)}`);
      }
      await expectEntered(target, r);

      // (3) e38-w1: disjoint lists, so it is claimed with no gate, whatever e38-r really changed (§3.5 item 2).
      await target.world.scripted.script(line('e38-w1'), [{ kind: 'text', text: 'E38-R9 e38-w1 answer' }]);
      const w1: WorkflowStepReceipt[] = [];
      await driveWorkflow(target.world.ag2b, selectOf(goal, 'e38-w1', line('e38-w1')),
        { stopBefore: 'open_checks', receipts: w1 });
      expect(w1.find(receipt => receipt.kind === 'claim_task')).toMatchObject({ result: { status: 'committed' } });
      expect(w1.map(receipt => receipt.kind)).not.toContain('open_overlap_gate');
      expect(await gatesOf(target, goal)).toEqual([]);

      // (4) e38-r's Run ends (its executed files are recorded at the Run's end).
      r.gates[1]!.release();
      await r.driving;

      // (5) Hand count: both lists, so no module risk; e38-w1 changed no file, so no executed-to-executed step;
      // e38-w1's planned src/e38-b.ts is a file e38-r changed, so `planned`; e38-w1 stopped before open_checks,
      // not satisfied, still a candidate; the gate (goal scope, no list) is no risk.
      const risks = await waitFor(() => risksOf(target, goal, plan, 'e38-r'),
        rows => rows.some(row => row.taskId === 'e38-w1'), 'the e38-w1 risk of e38-r');
      expect(risks).toEqual([{ taskId: 'e38-w1', shared: { kind: 'file', path: 'src/e38-b.ts', certainty: 'planned' } }]);
    } finally {
      await closeAll(target, held);
    }
  });

  it('the gate basis names only the running Run whose list meets the waiting list', async () => {
    /* Named mutation: the gate basis is re-collected by module as before — `running` also names e38-r2: the
       `toEqual([{ moduleId: 's6a-core', running: ['e38-r'] }])` expect goes red. */
    const target = await openS7C1World({ adviser: false });
    const held: HeldRun[] = [];
    try {
      const { goal, line } = await openGoal(target, 'e38-r9-c2', {
        'e38-r': ['src/e38-a.ts'], 'e38-r2': ['src/e38-c.ts'], 'e38-w2': ['src/e38-a.ts'] });

      // e38-r and e38-r2 both run, each held at its first model request. Both claims are read before either
      // Task runs, so neither selection meets the other one running.
      const claimR = await advanceUntil(target.world.ag2b, selectOf(goal, 'e38-r', line('e38-r')), 'claim_task');
      const claimR2 = await advanceUntil(target.world.ag2b, selectOf(goal, 'e38-r2', line('e38-r2')), 'claim_task');
      for (const [taskId, claim] of [['e38-r', claimR], ['e38-r2', claimR2]] as const) {
        await target.world.scripted.script(line(taskId), [{ kind: 'text', text: `E38-R9 ${taskId} answer` }]);
        const run = await startHeld(target, taskId, claim, line(taskId), 1, held);
        await reach(run, run.gates[0]!, 'the first model request');
        await expectEntered(target, run);
      }

      // e38-w2 meets e38-r on src/e38-a.ts and opens the gate; stop before the note request (no note here).
      const w2: WorkflowStepReceipt[] = [];
      await driveWorkflow(target.world.ag2b, selectOf(goal, 'e38-w2', line('e38-w2')),
        { stopBefore: 'request_overlap_note', receipts: w2 });
      expect(w2.find(receipt => receipt.kind === 'open_overlap_gate')).toMatchObject({ result: { status: 'opened' } });
      // Hand count: e38-r2 and e38-w2 share the module, both have lists and the lists are disjoint, so e38-r2 is
      // not in the conflict set.
      const gates = await gatesOf(target, goal);
      expect(gates.map(gate => ({ moduleId: gate.moduleId, running: gate.running.map(entry => entry.task.taskId) })))
        .toEqual([{ moduleId: 's6a-core', running: ['e38-r'] }]);
    } finally {
      await closeAll(target, held);
    }
  });
});
