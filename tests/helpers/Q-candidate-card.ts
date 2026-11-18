/** Q W1/W2: the one candidate card of a queue page, found by the proposal id in its public source key. */
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';

export function candidateCardOf(queue: DecisionQueueReadV1, proposalId: string): DecisionCardV1 {
  const card = queue.waitingAnswer.find(entry => entry.source.kind === 'candidate'
    && JSON.stringify(entry).includes(proposalId));
  if (card === undefined) throw new Error(`the candidate ${proposalId} is not in the queue`);
  return card;
}
