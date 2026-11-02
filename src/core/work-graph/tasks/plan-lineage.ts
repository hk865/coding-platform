/**
 * The one source-lineage walk behind `planfix:` and `planresume:` (slice-PL-SPEC
 * §6.3.1). A candidate's `sourceMessageRef` can be a repair round or a resumed
 * round; both continue the same chain. The walk reads only the first line's
 * system-round head and follows records that point to earlier commits, so it
 * needs no cycle guard.
 *
 * Every read failure is returned as-is; the walk never guesses a root. The
 * `messages` dependency is the existing mailbox port (both members), but the
 * walk needs only the saved body: a message's first line decides the next hop.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { queryJobRefFor } from '../../../contracts/query-job.js';
import { systemRoundOfText } from '../../../contracts/plan-round.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import type { PlanProposal, PlanTaskPort } from '../model/plan-contracts.js';
import type { QueryJobPort } from '../queries/contracts.js';

export type PlanSourceLineageV1 = {
  /** The earliest source message on the chain: the executor's M or the first system R. */
  rootMessage: SessionMessageRef;
  /** The nearest `planfix:` round crossed on the chain, or null. */
  fixRound: SessionMessageRef | null;
  /** The candidate that round had to repair; null when there is no fixRound. */
  fixBase: PlanProposal | null;
};

export type PlanSourceLineageDeps = {
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>;
  queries: Pick<QueryJobPort, 'readQueryJob'>;
  plans: Pick<PlanTaskPort, 'readPlanProposal'>;
};

/**
 * Walk from a candidate's `sourceMessageRef` (or a `planresume:` message) to the
 * earliest source. `planfix:` reads the parent candidate and continues from its
 * source message; `planresume:` reads the original QueryJob and continues from
 * its `execution.sourceMessageRef`. Any other first line ends the walk with the
 * current message as `rootMessage`.
 */
export async function planSourceLineageOf(
  ctx: CoreCallContext,
  deps: PlanSourceLineageDeps,
  source: SessionMessageRef,
): Promise<ReadResult<PlanSourceLineageV1>> {
  let current = source;
  let fixRound: SessionMessageRef | null = null;
  let fixBase: PlanProposal | null = null;

  for (;;) {
    const body = await deps.messages.readMessageBody(ctx, { messageRef: current, part: 'message' });
    if (body.status !== 'ready') return body;

    const head = systemRoundOfText(body.value.text);
    if (head === null || (head.kind !== 'planfix' && head.kind !== 'planresume')) {
      return { status: 'ready', value: { rootMessage: current, fixRound, fixBase } };
    }

    if (head.kind === 'planfix') {
      const parentRead = await deps.plans.readPlanProposal(ctx, {
        aggregateType: 'PlanProposal',
        projectId: current.projectId,
        workspaceId: current.workspaceId,
        proposalId: head.proposalId,
      });
      if (parentRead.status !== 'ready') return parentRead;
      const parent = parentRead.value;
      // The nearest fix is the first one met walking backwards; later hops never
      // replace it.
      if (fixRound === null) {
        fixRound = current;
        fixBase = parent;
      }
      // A Work Run candidate has no source message, so the fix round is the root.
      if (parent.sourceMessageRef === null) {
        return { status: 'ready', value: { rootMessage: current, fixRound, fixBase } };
      }
      current = parent.sourceMessageRef;
      continue;
    }

    const jobRead = await deps.queries.readQueryJob(
      ctx,
      queryJobRefFor(current.projectId, current.workspaceId, head.queryJobId),
    );
    if (jobRead.status !== 'ready') return jobRead;
    current = jobRead.value.job.job.intent.execution.sourceMessageRef!;
  }
}
