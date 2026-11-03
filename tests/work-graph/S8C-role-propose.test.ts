/**
 * The G5 role row: a real `role_spec` adviser line, opened by the public role and
 * Session owners and run as a real Work Run, calls `propose_architecture_revision`
 * once and succeeds. The proposal owner reads the pinned RoleSpec's duty under the
 * Host (`trialContext`); the named mutation replaces that with the Work Run context.
 */
import { afterEach, expect, it } from 'vitest';
import { openProposalWorld, type ProposalWorld } from '../helpers/S8C-proposal-world.js';
import type { ProposalResult } from '../../src/contracts/architecture-proposal.js';

const worlds: ProposalWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

function addModule(projectId: string, moduleId: string, path: string) {
  return { op: 'add_module' as const, module: { ref: { projectId, moduleId },
    name: moduleId, responsibility: `Own ${moduleId}`, paths: [path], interfaces: [] } };
}

function needsDecision(result: ProposalResult): Extract<ProposalResult, { status: 'needs_decision' }> {
  if (result.status !== 'needs_decision') throw new Error(`expected needs_decision: ${JSON.stringify(result)}`);
  return result;
}

it('a real role_spec staff line proposes once and succeeds', async () => {
  const target = await openProposalWorld({ backend: 'memory', roleSpecLine: true });
  worlds.push(target);
  const results = await target.proposeAsRoleSpec([{
    baseCatalogPin: target.pin,
    ops: [addModule(target.projectId, 's8c-role-spec-a', 'src/role-spec/a')],
    reason: 'G5 role_spec proposal',
  }]);
  expect(results).toHaveLength(1);
  const result = needsDecision(results[0]!);
  // The real single-member path answers a card key and no forbidden refusal.
  expect(result.cardKey.length).toBeGreaterThan(0);
  const read = await target.read(result.proposalRef);
  expect(read.batchRef).not.toBeNull();
  expect(read.cardKey).toBe(result.cardKey);
});
