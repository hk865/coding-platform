/**
 * PL-52: a Goal whose real workspace holds source files submits a complete first
 * Plan (not a skeleton) through `plans/propose` and the person adopts it through
 * the real `plans/apply` adoption (spec §15 PL-52, DR-P4-20, P4-15). The real
 * source file is read from disk, not a flag; the table's empty cell is PL-53's
 * workspace, so the same first-plan flow serves both rows.
 *
 * The review trigger ("已有代码首案审一次") and its `planreview:` are 6C L7:
 * this row neither asserts nor builds that probe. The first-case
 * `initialization/adopt` route is L's setup entry; its adoption is exercised
 * here through the same formal `plans/apply` that writes the accepted candidate,
 * and the Host close at the end waits out the export async work. The last case
 * is that route's wiring: its adoption exports the first Plan's taskbook, the
 * notice names the file, and a replay's export is waited for by Host close.
 */
import { readFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as goalFanOutModule from '../../src/app/goal-fan-out-driver.js';
import * as taskbookExport from '../../src/app/taskbook-export.js';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { advancePLGoal, openPLWorkflowWorld, plSingleStageDraft, type PLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';
import { configureS6B3SecondWorkspace, holdS6B3RequestAnswer, openS6B3World,
  releaseS6B3DraftAnswer } from '../helpers/S6B3-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

const FIRST_STAGE = 'pl-52-stage';
const FIRST_INSTRUCTION = 'PL-52 the first stage work';

/** One whole v2 `kind: 'plan'` answer: two card drafts, the legal setup, and one stage with one work Task. */
const firstPlanAnswer = (): string => JSON.stringify({
  schemaVersion: 2, kind: 'plan', summary: 'PL-52 first plan',
  plan: { schemaVersion: 2,
    stages: [{ stageId: FIRST_STAGE, title: 'PL-52 stage', description: 'The first stage.' }],
    tasks: [{ taskId: 'pl-52-work', stageId: FIRST_STAGE, title: 'PL-52 work', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: FIRST_STAGE },
      executionIntent: 'request_execution' }],
    assignments: [{ taskId: 'pl-52-work', role: 'local-workbench', instruction: FIRST_INSTRUCTION }],
    obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } },
  goalCardDrafts: [0, 1].map(index => ({ objective: `PL-52 draft ${String(index)}`,
    completion: [`PL-52 criterion ${String(index)}`], autonomy: 'every_step', screening: null })),
  planDraftIndex: 0,
  setup: { architecture: { baselineId: 'pl-52-baseline', description: 'PL-52 governance', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [] } },
  completionPolicy: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 },
  checks: [] },
});

const cells = [
  { cell: 'source', empty: false },
  { cell: 'empty', empty: true },
] as const;

it.each(cells)('PL-52: a complete first Plan is submitted and adopted ($cell workspace)', async ({ cell, empty }) => {
  const workflow = opened = await openPLWorkflowWorld({ label: `pl-52-${cell}` });
  if (empty) {
    await rm(join(workflow.world.root, 'src'), { recursive: true, force: true });
    await rm(join(workflow.world.root, 'tsconfig.json'), { force: true });
    await expect(readFile(join(workflow.world.root, 'src', 'module.ts'), 'utf8')).rejects.toThrow();
  } else {
    // The workspace is a real directory; the source file is real, not a flag.
    await expect(readFile(join(workflow.world.root, 'src', 'module.ts'), 'utf8'))
      .resolves.toContain('AG2B_ISOLATED_SOURCE');
  }

  // The first version is a complete single-stage plan: work A/B and the stage gate.
  const draft = plSingleStageDraft(workflow.goal, { label: `pl-52-${cell}`, taskIds: ['pl-a', 'pl-b'] });
  const proposed = (await workflow.main.post('plans/propose', graphWrite(workflow.main.scope, {
    goalRef: workflow.goal, basedOn: null, draft, reason: { text: `PL-52 ${cell} first complete plan`, sources: [] },
  }, `pl-52-${cell}-propose`))) as { status: string; value?: PlanProposal };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const candidate = proposed.value;
  if (candidate === undefined) throw new Error('PL-52: the first plan candidate was not written');
  expect(candidate.status).toBe('candidate');
  expect(candidate.basedOn).toBeNull();

  const adopted = (await workflow.main.post('plans/apply', graphWrite(workflow.main.scope, {
    proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [],
  }, `pl-52-${cell}-apply`))) as { status: string; value?: { ref?: unknown; planRevision?: number } };
  expect(adopted.status, JSON.stringify(adopted)).toBe('committed');
  const plan = await workflow.main.activePlan(workflow.goal);
  if (plan === null) throw new Error('PL-52: the first Plan is not active');
  expect(plan.ref.planId).toBe(`pl-plan-pl-52-${cell}`);
  expect(plan.planRevision).toBe(1);
  expect(plan.tasks.map(task => task.taskId)).toEqual(expect.arrayContaining(['pl-a', 'pl-b', 'pl-gate-pl-stage-1']));

  // The adoption consumed the candidate and the accepted record is the active revision.
  const accepted = await workflow.main.route('plans/proposal', candidate.ref);
  expect((accepted as { status: string }).status).toBe('ready');
  expect((accepted as { value?: { status?: string } }).value?.status).toBe('accepted');

  // The Goal loop consumes the adopted plan: one real selection, not the old seam.
  const advance = await advancePLGoal(workflow.world, workflow.goal, `pl-52-${cell}-loop`) as WorkflowAdvanceResult;
  expect(advance.status).toBe('ready');
  if (advance.status !== 'ready') return;
  expect(advance.value.next).not.toBeNull();

  // The Host close waits out its export async work; the row's world is done here.
  await workflow.close();
  opened = null;
});

it('PL-52: initialization/adopt exports the first Plan, the notice names the file, and close waits for a replay export', async () => {
  // A3: the fan-out's close is the last drain before the Host's export wait (PL-46's close case).
  const fanOutClosed = deferred();
  const realFanOut = goalFanOutModule.createGoalFanOutDriver;
  vi.spyOn(goalFanOutModule, 'createGoalFanOutDriver').mockImplementation((deps) => {
    const driver = realFanOut(deps);
    return { ...driver, close: async () => { await driver.close(); fanOutClosed.resolve(); } };
  });
  const world = await openS6B3World({ backend: 'memory' });
  try {
    const { scope } = await configureS6B3SecondWorkspace(world, { name: 'pl-52', goals: 2 });
    const held = await holdS6B3RequestAnswer(world, { scope, label: 'pl-52-first', goalId: null,
      executionKind: 'initial_coordination', reply: () => ({ kind: 'text', text: firstPlanAnswer() }) });
    const answer = await releaseS6B3DraftAnswer(world, held);
    const confirmed = await world.host.post('goals/confirm-draft', plain(scope, {
      commandId: 'pl-52-confirm', round: held.round, index: 0 }));
    expect(confirmed.body).toMatchObject({ status: 'committed' });
    const goal = (confirmed.body as { value: GoalConfirmDraftReceiptV1 }).value.goal.ref;
    const adopt = plain(scope, { commandId: 'pl-52-adopt', expectedAnswerDigest: sha256Hex(answer.answerText),
      source: { kind: 'binding', answerRef: answer.answerRef, draftIndex: 0 }, expectedGoal: { ref: goal, revision: 1 } });
    const first = (await world.host.post('initialization/adopt', adopt)).body;
    expect(first).toMatchObject({ status: 'committed', replayed: false });

    // The adoption's export lands in the §5.3.4 path, and the notice names that path.
    const read = (await world.host.post('goals/read', plain(scope, goal))).body as {
      value: { goal: { activePlanRevision: { planId: string } } } };
    const planId = read.value.goal.activePlanRevision.planId;
    const part = encodeURIComponent;
    const path = join(world.settingsDirectory, 'taskbooks', part(scope.projectId), part(scope.workspaceId), part(goal.goalId),
      `goal-${part(goal.goalId)}__plan-${part(planId)}__stage-${FIRST_STAGE}__rev-1.md`);
    expect(await vi.waitFor(() => readFile(path, 'utf8'), { timeout: 5_000 })).toContain(FIRST_INSTRUCTION);
    const main = (await world.host.post('main/read', plain(scope, { goalId: goal.goalId, cursor: null }))).body as {
      value: { notices: Array<{ category: string; summary: string }> } };
    expect(main.value.notices.find(notice => notice.category === 'plan_adoption')?.summary)
      .toContain(`任务书 ${FIRST_STAGE} 已导出（${path}）`);

    // §6.4.3: a replay is `committed`, so it exports again; that job is held across the close.
    const realExport = taskbookExport.exportTaskbooksForPlan;
    let finished = 0;
    vi.spyOn(taskbookExport, 'exportTaskbooksForPlan').mockImplementation(async (input) => {
      await fanOutClosed.promise;
      const results = await realExport(input);
      finished += 1;
      return results;
    });
    expect((await world.host.post('initialization/adopt', adopt)).body).toEqual(first);
    const platform = world.host.platform;
    const realClose = platform.close.bind(platform);
    let finishedAtStoreClose: number | undefined;
    platform.close = async () => { finishedAtStoreClose = finished; await realClose(); };
    await world.host.host.close();
    expect(finishedAtStoreClose).toBe(1);
  } finally {
    vi.restoreAllMocks();
    await world.close();
  }
});
