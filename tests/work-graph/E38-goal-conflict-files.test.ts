/**
 * E38-R7 (E3-8 spec §3.5 第 1 条, with its "答卡前的来源核对" bullets; rulings 2, 7, 11, 16, 17; write-tests brief
 * `e38-tests-brief.md` "E38-R7"): the Goal conflict cards meet on planned files, and a card that only planned files
 * or only executed files raised is answerable (the source check reads the same footprint as the conflict read).
 *
 * Each cell opens its own world (as `tests/scenarios/S7D2-RL-13.test.ts:67–:80`, `:246`):
 * `openS7C1World({ adviser: false })`, memory (S3). Its catalog is adopted (ruling 11): `s6a-core` paths ['src'],
 * `s6a-ui` paths ['src/ui'] (`tests/helpers/S6A-memory-fixture.ts:118–:129`). The world's Goal `s7c-goal` (S) has
 * three work tasks without a list (two `s6a-core`, one `s6a-ui`), so its module statements are `s6a-core` and
 * `s6a-ui`; its first Run only answered text, so it has no executed file (`tests/helpers/S7C-member-fixture.ts:314`).
 * Every new Goal comes from `main.createGoal`; its first Plan is the public `plans/propose` body (one work task plus
 * `ag2bPlanDraft`'s gate and obligation) through `plans/propose` + `plans/apply` (`S7C-member-fixture.ts:287–:294`).
 *
 * Cards are read from `goals/conflicts` (workspace scope) and named by their pair: the two goalIds of
 * `source.goalBases`, sorted and joined. Only the pairs among this cell's Goals are compared (the world's other
 * Goals are filtered out). A card is answered through `decisions/answer` (as `tests/app/S8B-assign-maintainer.test.ts:576–:580`)
 * with `{ kind: 'conflict_parallel', earlier, later }` (`tests/scenarios/support/S5-decisions.ts:536–:541`),
 * `earlier`/`later` the two `goalRef`s of `source.goalBases` in order.
 *
 * Not here (ruling 16): G3 (a module Goal without a list) and the whole module-fallback combination; the module
 * statement's meeting rule is R6's and GS11's.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import type { DecisionCardV1, GoalConflictReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { ag2bPlanDraft, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { openS7C1World, S7C1_CREATE_ROLE, type S7C1World } from '../helpers/S7C-member-fixture.js';

const worlds: S7C1World[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(target => target.close())); });

async function openWorld(configure?: (configuration: WorkbenchRuntimeConfiguration) => void): Promise<S7C1World> {
  const target = await openS7C1World({ adviser: false, ...(configure === undefined ? {} : { configure }) });
  worlds.push(target);
  return target;
}

type OneTask = { taskId: string; moduleRef?: string; plannedFiles?: readonly string[] };

/** One work task plus `ag2bPlanDraft`'s gate and obligation; no `moduleRef` keeps `ag2bPlanDraft`'s goal scope. */
function oneTaskDraft(goal: GoalRef, work: OneTask): PlanRevisionDraft {
  const draft = ag2bPlanDraft([work.taskId]);
  const stageId = `${goal.goalId}-stage`;
  return {
    ...draft, planId: `${goal.goalId}-plan`, goalId: goal.goalId,
    stages: work.moduleRef === undefined ? [] : [{ stageId, title: `${goal.goalId} stage` }],
    tasks: draft.tasks.map((task): RuntimeTask => task.taskKind !== 'work' ? task : {
      ...task,
      scope: work.moduleRef === undefined ? task.scope : { kind: 'module', stageId, moduleRef: work.moduleRef },
      ...(work.plannedFiles === undefined ? {} : { plannedFiles: [...work.plannedFiles] }),
    }),
    assignments: (draft.assignments ?? []).map(assignment => ({ ...assignment,
      role: S7C1_CREATE_ROLE.templateId, instruction: `E38 ${assignment.taskId}` })),
  };
}

/** `main.createGoal` and the Goal's first Plan through the real `plans/propose` + `plans/apply`. */
async function goalWithPlan(target: S7C1World, goalId: string, work: OneTask): Promise<GoalRef> {
  const goal = (await target.main.createGoal(goalId, `E38 conflict goal ${goalId}`)).ref;
  const proposed = valueOf<{ ref: unknown; revision: number }>(await target.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft: oneTaskDraft(goal, work), reason: { text: `E38 ${goalId} plan`, sources: [] },
  }, `${goalId}-propose`)), 'committed', `the ${goalId} Plan proposal`);
  valueOf(await target.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `${goalId}-apply`)), 'committed', `the ${goalId} Plan adoption`);
  return goal;
}

async function conflictsOf(target: S7C1World): Promise<GoalConflictReadV1> {
  return valueOf<GoalConflictReadV1>(await target.main.route('goals/conflicts', { workspace: S6A_SCOPE }),
    'ready', 'goals/conflicts');
}

/** A card's pair: the two goalIds of `source.goalBases`, sorted, joined. */
function pairOf(card: DecisionCardV1): string {
  return (card.source.goalBases ?? []).map(basis => basis.goalRef.goalId).sort().join(' + ');
}

/** The pairs of the cards whose two Goals are both among `goalIds`, sorted. */
function pairsAmong(read: GoalConflictReadV1, goalIds: readonly string[]): string[] {
  return read.cards
    .filter(card => (card.source.goalBases ?? []).length === 2
      && (card.source.goalBases ?? []).every(basis => goalIds.includes(basis.goalRef.goalId)))
    .map(pairOf).sort();
}

function cardOf(read: GoalConflictReadV1, pair: string): DecisionCardV1 {
  const card = read.cards.find(candidate => pairOf(candidate) === pair);
  if (card === undefined) throw new Error(`E38-R7: no ${pair} card: ${JSON.stringify(read.cards.map(pairOf))}`);
  return card;
}

/** `decisions/answer` with `conflict_parallel`, `earlier`/`later` from the card's `source.goalBases` in order. */
async function acceptParallel(target: S7C1World, card: DecisionCardV1, requestId: string): Promise<unknown> {
  const bases = card.source.goalBases;
  if (bases === undefined || bases.length !== 2) throw new Error(`E38-R7: the card has no Goal pair: ${JSON.stringify(card.source)}`);
  return await target.main.post('decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
    selection: { kind: 'conflict_parallel', earlier: bases[0]!.goalRef, later: bases[1]!.goalRef },
    text: '', annotations: [] }, requestId, card.source.pins));
}

/** Bounded polling of `goals/conflicts` until `pair` has a card (F9); the timeout names the last read pairs. */
async function untilPair(target: S7C1World, goalIds: readonly string[], pair: string): Promise<GoalConflictReadV1> {
  let last: string[] = [];
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const read = await conflictsOf(target);
    last = pairsAmong(read, goalIds);
    if (last.includes(pair)) return read;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`E38-R7: no ${pair} card after 400 reads; the last read pairs: ${JSON.stringify(last)}`);
}

const ANSWERED = { status: 'ready', value: { answer: { status: 'committed' }, state: 'applied' } };

describe('E38-R7: Goal conflict cards on planned and executed files', () => {
  it('E38-R7 cell 1: cards by planned file and module statement; the planned-files-only card is answerable', async () => {
    /* Named mutation: (1) the conflict read also gives a listed task's module as a module statement: one more pair
     * `e38-g1 + e38-g2`, the first `toEqual` (the three pairs) goes red; (2) the source check ignores planned files:
     * the `e38-g1 + e38-g4` answer is not `applied` (the old check reads only modules), the `toMatchObject` goes red. */
    const target = await openWorld();
    await goalWithPlan(target, 'e38-g1', { taskId: 'e38-g1-work', moduleRef: 's6a-core', plannedFiles: ['src/core/a.ts'] });
    await goalWithPlan(target, 'e38-g2', { taskId: 'e38-g2-work', moduleRef: 's6a-core', plannedFiles: ['src/core/b.ts'] });
    await goalWithPlan(target, 'e38-g4', { taskId: 'e38-g4-work', plannedFiles: ['src/core/a.ts'] });
    const goalIds = [target.goal.goalId, 'e38-g1', 'e38-g2', 'e38-g4'];

    // By hand (spec §3.5 第 1 条): S's module statement s6a-core meets the module of G1's and G2's listed tasks;
    // G1 and G4 share the planned path src/core/a.ts; G1–G2 same module, different files: none; G2–G4 different
    // files, G4 has no module: none; S–G4: G4's planned file carries no module (goal scope), S's statements miss it.
    const read = await conflictsOf(target);
    expect(pairsAmong(read, goalIds)).toEqual(['e38-g1 + e38-g4', 'e38-g1 + s7c-goal', 'e38-g2 + s7c-goal']);

    const answered = await acceptParallel(target, cardOf(read, 'e38-g1 + e38-g4'), 'e38-r7-answer-g1-g4');
    expect(answered, JSON.stringify(answered)).toMatchObject(ANSWERED);
    expect(pairsAmong(await conflictsOf(target), goalIds)).not.toContain('e38-g1 + e38-g4');
  });

  it('E38-R7 cell 2: a card only executed files raised is answerable', async () => {
    /* Named mutation: the source check ignores executed files (the composition root does not pass
     * `goalFootprints`, only the planned footprint is read): G6 has no module and no file there, the answer is not
     * `applied`, the `toMatchObject` goes red. */
    // The executor's binding may call edit: the authorization name is `write` (the Kernel maps it to `edit`).
    const target = await openWorld((configuration) => {
      const binding = configuration.bindings.find((entry) => entry.id === 's7c-create-binding')!;
      binding.grant = { ...binding.grant, tools: [...(binding.grant.tools ?? []), 'write'] };
    });
    const g6 = await goalWithPlan(target, 'e38-g6', { taskId: 'e38-g6-work' });
    const task: TaskTriple = { projectId: g6.projectId, goalId: g6.goalId, taskId: 'e38-g6-work' };
    const line = await sessionOf(target.world, await createS6BLine(target.main, {
      label: 'e38-g6-line', role: S7C1_CREATE_ROLE, tasks: [task] }));
    await target.world.scripted.script(line, [
      { kind: 'calls', calls: [{ callId: 'e38-g6-edit', name: 'edit',
        args: { mode: 'create', path: 'src/e38-g6.ts', newText: 'export const e38G6 = "E38 G6";\n' } }] },
      { kind: 'text', text: 'E38 G6 done' },
    ]);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(target.world.ag2b, { schemaVersion: 1, goalRef: g6, flowId: 'e38-g6-run',
      sessionHint: line.ref, kind: 'select_work', taskId: task.taskId }, { stopBefore: 'open_checks', receipts });
    const claim = receipts.find(receipt => receipt.kind === 'claim_task');
    if (claim === undefined || claim.result.status !== 'committed') {
      throw new Error(`E38-R7: e38-g6-work was not claimed: ${JSON.stringify(receipts)}`);
    }
    if (!existsSync(join(target.world.root, 'src', 'e38-g6.ts'))) {
      const served = (await target.world.scripted.requests(line)).flatMap(request => request.messages)
        .find(message => message.role === 'tool' && message.callId === 'e38-g6-edit');
      throw new Error(`E38-R7: the scripted edit did not create src/e38-g6.ts: ${JSON.stringify(served ?? null)}`);
    }

    // By hand: G6's executed file src/e38-g6.ts maps to s6a-core (paths ['src']; not under src/ui) and meets S's
    // module statement s6a-core. The executed files are recorded when the Run ends: poll until the card is there.
    const goalIds = [target.goal.goalId, 'e38-g6'];
    const read = await untilPair(target, goalIds, 'e38-g6 + s7c-goal');
    const answered = await acceptParallel(target, cardOf(read, 'e38-g6 + s7c-goal'), 'e38-r7-answer-s-g6');
    expect(answered, JSON.stringify(answered)).toMatchObject(ANSWERED);
    expect(pairsAmong(await conflictsOf(target), goalIds)).not.toContain('e38-g6 + s7c-goal');
  });
});
