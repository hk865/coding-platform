/**
 * One round's material in the secretary input with the card refs an `ask`
 * stored (slice-6 spec L6; the round material is rendered the same way for
 * the round this Session runs, a batched round and an earlier one): after the
 * input line and the selected idea, `## Cards` and one line per ref,
 * `- <aggregateType> <the ref's other fields as canonical JSON> @<pinned
 * revision>`, then ` (now @<current>)` when the object's revision moved or
 * ` (not found)` when the object does not exist. A round without card refs
 * renders exactly as before.
 *
 * Called with hand-built round material and the platform pack's texts; every
 * expected text is written out here.
 */
import { describe, expect, it } from 'vitest';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { QueryJobRef, QueryRunRef, SecretaryRoundMaterialV1 } from '../../src/contracts/query-job.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { roundMaterial } from '../../src/core/agent-runtime/context-secretary-recipe.js';

const P = 's6a-cards-pure-project';
const W = 's6a-cards-pure-ws';
const ROUND: QueryJobRef = { aggregateType: 'QueryJob', projectId: P, workspaceId: W, queryJobId: 'round-7' };
const RUN: QueryRunRef = { aggregateType: 'QueryRun', projectId: P, workspaceId: W, queryJobId: 'round-7', runId: 'run-round-7' };

function material(over: Partial<SecretaryRoundMaterialV1> = {}): SecretaryRoundMaterialV1 {
  return { ref: ROUND, revision: 1, runRef: RUN, runRevision: 1, since: makeCommitCursor(42), text: 'why this plan?',
    selectedIdea: null, relatedCards: [], command: null, ...over };
}

const GOAL_CARD = { ref: { aggregateType: 'Goal' as const, projectId: P, goalId: 'g1' }, revision: 3 };
const PROPOSAL_CARD = {
  ref: { aggregateType: 'PlanProposal' as const, projectId: P, workspaceId: W, proposalId: 'proposal-1' }, revision: 1,
};
const MISSING_CARD = { ref: { aggregateType: 'Goal' as const, projectId: P, goalId: 'g-gone' }, revision: 2 };

describe('one round material with card refs', () => {
  it('a round without card refs renders the input line alone, as before', () => {
    expect(roundMaterial(material(), PLATFORM_PROMPT_PACK_V1)).toBe('- [c0000000042] why this plan?');
  });

  it('lists each ref with its pinned revision; a moved one shows the current, a missing one says so', () => {
    const text = roundMaterial(material({ relatedCards: [
      { ref: GOAL_CARD, current: 5 },
      { ref: PROPOSAL_CARD, current: 1 },
      { ref: MISSING_CARD, current: null },
    ] }), PLATFORM_PROMPT_PACK_V1);
    expect(text).toBe([
      '- [c0000000042] why this plan?',
      '## Cards',
      '- Goal {"goalId":"g1","projectId":"s6a-cards-pure-project"} @3 (now @5)',
      '- PlanProposal {"projectId":"s6a-cards-pure-project","proposalId":"proposal-1","workspaceId":"s6a-cards-pure-ws"} @1',
      '- Goal {"goalId":"g-gone","projectId":"s6a-cards-pure-project"} @2 (not found)',
    ].join('\n'));
  });

  it('the cards follow the selected idea', () => {
    const text = roundMaterial(material({
      text: '选了第 2 个思路：Split the work',
      selectedIdea: { round: ROUND, index: 1, title: 'Split the work', detail: 'Two smaller tasks.' },
      relatedCards: [{ ref: GOAL_CARD, current: 3 }],
    }), PLATFORM_PROMPT_PACK_V1);
    expect(text).toBe([
      '- [c0000000042] 选了第 2 个思路：Split the work',
      'Selected idea:',
      'Split the work: Two smaller tasks.',
      '## Cards',
      '- Goal {"goalId":"g1","projectId":"s6a-cards-pure-project"} @3',
    ].join('\n'));
  });
});
