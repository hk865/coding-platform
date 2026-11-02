/**
 * PL-53: the same first complete Plan path on an empty real workspace (spec
 * §15 PL-53, DR-P4-20, P4-15). PL-52's table shares the flow; this row keeps the
 * empty-workspace facts: the registered root has no source files, the complete
 * first Plan is still submitted and adopted, and the Goal consumes it.
 *
 * The review trigger ("空工程不审") is 6C L7: this row does not assert zero
 * `planreview:` and does not build the L7 probe. The Host close at the end waits
 * out the export async work.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { advancePLGoal, openPLWorkflowWorld, plSingleStageDraft, type PLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-53: a complete first Plan is submitted and adopted in an empty workspace', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-53' });
  // F0: make the registered real directory empty (the fixture's own seed files
  // are the only content). No probe of the workspace is added.
  await rm(join(workflow.world.root, 'src'), { recursive: true, force: true });
  await rm(join(workflow.world.root, 'tsconfig.json'), { force: true });

  const draft = plSingleStageDraft(workflow.goal, { label: 'pl-53', taskIds: ['pl-a', 'pl-b'] });
  const proposed = (await workflow.main.post('plans/propose', graphWrite(workflow.main.scope, {
    goalRef: workflow.goal, basedOn: null, draft, reason: { text: 'PL-53 first complete plan', sources: [] },
  }, 'pl-53-propose'))) as { status: string; value?: PlanProposal };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const candidate = proposed.value;
  if (candidate === undefined) throw new Error('PL-53: the first plan candidate was not written');

  const adopted = (await workflow.main.post('plans/apply', graphWrite(workflow.main.scope, {
    proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [],
  }, 'pl-53-apply'))) as { status: string; value?: { ref?: unknown; planRevision?: number } };
  expect(adopted.status, JSON.stringify(adopted)).toBe('committed');
  const plan = await workflow.main.activePlan(workflow.goal);
  if (plan === null) throw new Error('PL-53: the first Plan is not active');
  expect(plan.ref.planId).toBe('pl-plan-pl-53');
  expect(plan.planRevision).toBe(1);
  expect((await workflow.main.route('plans/proposal', candidate.ref) as { value?: { status?: string } })
    .value?.status).toBe('accepted');

  // The Goal loop consumes the adopted plan without the old unsupported seam.
  const advance = await advancePLGoal(workflow.world, workflow.goal, 'pl-53-loop') as WorkflowAdvanceResult;
  expect(advance.status).toBe('ready');

  await workflow.close();
  opened = null;
});
