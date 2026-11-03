import { createHostClient } from '../../../src/ui/host-client.js';
import { readTaskMap } from '../../../src/ui/boot.js';
import type { TaskMapData } from '../../../src/ui/adapters/task-map.js';
import { graphWrite } from '../../helpers/AG2b-collaboration-fixture.js';
import type { S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';

/** One `plans/propose` + `plans/apply` through the public routes (the E32-1 path). */
export async function adoptE34Plan(
  world: S6ARequestWorld, scope: Parameters<typeof graphWrite>[0],
  goal: { aggregateType: 'Goal'; projectId: string; goalId: string },
  draft: unknown, label: string,
): Promise<void> {
  const proposed = await world.post('plans/propose', graphWrite(scope, {
    goalRef: goal, basedOn: null, draft, reason: { text: `E34 ${label} plan`, sources: [] },
  }, `e34-${label}-propose`));
  const proposal = proposed.body as { status?: string; value?: { ref?: unknown; revision?: number } };
  if (proposal.status !== 'committed') throw new Error(`E34: propose ${label} did not commit: ${JSON.stringify(proposal)}`);
  const applied = await world.post('plans/apply', graphWrite(scope, {
    proposalRef: proposal.value?.ref, expectedProposalRevision: proposal.value?.revision, decisionRefs: [],
  }, `e34-${label}-apply`));
  if ((applied.body as { status?: string }).status !== 'committed') {
    throw new Error(`E34: apply ${label} did not commit: ${JSON.stringify(applied.body)}`);
  }
}

/** The page's own read path: six route reads, no database access. */
export async function readE34Map(world: S6ARequestWorld, goalId: string): Promise<TaskMapData> {
  const { data } = await readTaskMap(createHostClient(world.token, new URL(world.base).origin), goalId);
  if (data === null) throw new Error('E34: the Goal has no readable map');
  return data;
}
