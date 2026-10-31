/**
 * §5 D-deleted: the whiteboard group and the platform pack no longer offer
 * `apply_future_plan`; an Agent proposes only, while the Host still adopts.
 */
import { describe, expect, it } from 'vitest';
import { createWhiteboardTools } from '../../src/core/agent-runtime/whiteboard-tools.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { owners } from '../helpers/S5-application-support.js';
import { openS5DecisionFixture } from '../helpers/S5-decision-fixture.js';

describe('D-deleted: apply_future_plan is removed', () => {
  it('publishes three tools, no pack row, and still lets the Host adopt a candidate', async () => {
    const f = await openS5DecisionFixture('memory');
    try {
      const plans = owners(f).plans;
      const tools = createWhiteboardTools({ plans, context: f.ctx, goalRef: f.goals.B.ref,
        requestIdForCall: () => 'p7c-d-apply-removed' });

      expect(tools.names).toEqual(['query_task_graph', 'query_ready_tasks', 'propose_future_plan']);
      // The pack drops the adoption tool but keeps the Agent proposal.
      expect(PLATFORM_PROMPT_PACK_V1.tools).not.toHaveProperty('apply_future_plan');
      expect(PLATFORM_PROMPT_PACK_V1.toolOrigins).not.toHaveProperty('apply_future_plan');
      expect(PLATFORM_PROMPT_PACK_V1.tools).toHaveProperty('propose_future_plan');

      const adopted = await plans.applyPlanChange(f.ctx, {
        input: { proposalRef: f.candidates.U1.ref, expectedProposalRevision: 1, decisionRefs: [] },
        meta: { requestId: 'p7c-d-apply-removed', expected: [] },
      });
      expect(adopted.status, JSON.stringify(adopted)).toBe('committed');
      if (adopted.status !== 'committed') throw new Error(JSON.stringify(adopted));
      expect(adopted.replayed).toBe(false);
      expect(adopted.value).toMatchObject({ ref: { aggregateType: 'PlanRevision', planId: 'PB2' },
        revision: 1, planId: 'PB2', planRevision: 2 });
    } finally {
      await f.close();
    }
  });
});
