/**
 * The copy's two ports, implemented over the record store and the mailbox: one reads the source Goal's person
 * interventions by page, the other retracts one copied intervention through the withdraw owner.
 *
 * This adapter only reads records: `lookupAll` needs `lookup` and the page needs `lookupOrdered`; the message view and
 * the withdraw belong to the mailbox. The caller is trusted, so the source ref's shape, project and workspace are not
 * re-checked and neither is `page.limit` (the store's one ordered-request rule refuses a bad `limit` / `after`). The
 * project and workspace always come from the bound context, so no read leaves the caller's scope. A read failure is a
 * rejection, never an empty page (7a:597).
 */
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { CopyInterventionCandidateV1 } from '../../../contracts/goal-copy-retraction.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../contracts/keyset-cursor.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { SessionMessageCommandPort, SessionMessageReadV1 } from '../model/communication-contracts.js';
import type { CopyInterventionReadPort, CopyInterventionRetractionPort } from '../model/goal-copy-contracts.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { canonicalRefKey, decodeGoalSnapshot } from '../persistence/record-codecs.js';
import {
  S7A2_COPY_INTERVENTION_BY_GOAL_LOOKUP, decodeSessionMessageRecord,
} from '../sessions/message-record-codecs.js';
import type { CopyInterventionFactsV1 } from '../state/copy-intervention.js';
import { copyInterventionCandidateOf } from '../state/copy-intervention.js';
import { bindTrustedContext } from '../tasks/execution-entry-service.js';
import { asWriteRejection } from '../tasks/plan-result-helpers.js';
import { GOAL_BY_CONTINUED_FROM_INDEX } from '../tasks/plan-readers.js';

export type CopyInterventionPortsDependencies = {
  records: RecordLookupPort & RecordOrderedLookupPort;   // record-store/lookup-ports.ts:35, :67
  mailbox: Pick<SessionMessageCommandPort, 'withdrawMessage' | 'readMessageView'>;
};

/**
 * A store failure is not a `CoreRejection` (it has `corrupt` and `unique_conflict`); it keeps its own conversion.
 * Any other thrown value is `unavailable` (CR5.5 "Failures"; ER 04). `lookupAll` throws its failure, so it is caught
 * here rather than returned.
 */
function caughtRejection(error: unknown): CoreRejection {
  if (isRecord(error) && error['status'] === 'rejected'
    && typeof error['code'] === 'string' && typeof error['reason'] === 'string') {
    return ownerReadStoreFailureToRejection({ code: error['code'], reason: error['reason'] });
  }
  return rejected('unavailable', messageOf(error));
}

/** The ready view is the only source of the delivery fact and of the message facts; never a second derivation. */
function copyInterventionFactsOf(view: SessionMessageReadV1, copied: ReadonlySet<string>): CopyInterventionFactsV1 {
  return {
    message: view.message,
    delivered: view.delivery.delivery === 'delivered',
    copiedElsewhere: copied.has(canonicalRefKey(view.message.ref)),
  };
}

export function createCopyInterventionPorts(deps: CopyInterventionPortsDependencies):
  CopyInterventionReadPort & CopyInterventionRetractionPort {
  /**
   * The ref keys in `copiedInterventions` of every Goal born as a copy of this source (CR5.5 step 3). A copy is born
   * in the source's workspace, so the project/key pair matches every copy; nothing outside this workspace is read.
   */
  async function copiedKeys(scope: WorkspaceScope, sourceGoalId: string): Promise<Set<string>> {
    const copies = await lookupAll(deps.records, GOAL_BY_CONTINUED_FROM_INDEX, [scope.projectId, sourceGoalId]);
    const keys = new Set<string>();
    for (const record of copies.items) {
      const decoded = decodeGoalSnapshot(record);
      if (decoded.status !== 'decoded') {
        throw new Error(`the Goal copy ${record.refKey} is damaged: ${decoded.reason}`);
      }
      for (const ref of decoded.value.copiedInterventions) keys.add(canonicalRefKey(ref));
    }
    return keys;
  }

  const readCopyInterventions: CopyInterventionReadPort['readCopyInterventions'] = async (ctx, input) => {
    const owned = bindTrustedContext(ctx);
    if (!owned.ok) return owned.rejection;
    const { ctx: bound, scope } = owned;
    const sourceGoalId = input.sourceGoalRef.goalId;

    // The cursor binds only the Goal: a page of another source Goal is refused (7a:597–:598; lr7 2).
    let after: { order: string | number; refKey: string } | undefined;
    if (input.page.cursor !== undefined) {
      const decoded = decodeKeysetCursor(input.page.cursor, sourceGoalId);
      if (decoded === null) return rejected('invalid', 'the copy interventions cursor belongs to another source Goal');
      after = decoded;
    }

    try {
      const copied = await copiedKeys(scope, sourceGoalId);
      const page = await deps.records.lookupOrdered({
        index: S7A2_COPY_INTERVENTION_BY_GOAL_LOOKUP,
        values: [scope.projectId, scope.workspaceId, sourceGoalId, 'human'],
        direction: 'asc',
        ...(after === undefined ? {} : { after }),
        limit: input.page.limit,
      });
      if (page.status !== 'ready') return ownerReadStoreFailureToRejection(page);

      const candidates: CopyInterventionCandidateV1[] = [];
      for (const record of page.value.records) {
        const decoded = decodeSessionMessageRecord(record);
        if (decoded.status !== 'decoded') {
          return rejected('unavailable', `the intervention record ${record.refKey} is damaged: ${decoded.reason}`);
        }
        const view = await deps.mailbox.readMessageView(bound, decoded.value.ref);
        if (view.status !== 'ready') return view;
        const candidate = copyInterventionCandidateOf(input.sourceGoalRef, copyInterventionFactsOf(view.value, copied));
        if (candidate !== null) candidates.push(candidate);
      }

      return {
        status: 'ready',
        value: {
          candidates,
          // The page's own watermark, as it is: the type allows `null` (goal-copy-contracts.ts:20).
          readThrough: page.value.readThrough,
          nextCursor: page.value.next === null ? null : encodeKeysetCursor(sourceGoalId, page.value.next),
        },
      };
    } catch (error) {
      return caughtRejection(error);
    }
  };

  const retractCopiedIntervention: CopyInterventionRetractionPort['retractCopiedIntervention'] = async (ctx, input) => {
    const owned = bindTrustedContext(ctx);
    if (!owned.ok) return owned.rejection;
    const { ctx: bound, scope } = owned;

    try {
      const view = await deps.mailbox.readMessageView(bound, input.messageRef);
      if (view.status !== 'ready') return asWriteRejection(view, 'the copied intervention could not be read');
      const copied = await copiedKeys(scope, input.sourceGoalRef.goalId);
      const candidate = copyInterventionCandidateOf(input.sourceGoalRef, copyInterventionFactsOf(view.value, copied));

      // Another Goal's message, or not the person's: not a candidate (7a:597–:598).
      if (candidate === null) {
        return rejected('invalid', 'the message is not a person intervention of the source Goal');
      }

      const withdraw = async () => deps.mailbox.withdrawMessage(bound, {
        input: { messageRef: input.messageRef },
        meta: { requestId: input.commandId, expected: [] },
      });

      // Its own earlier withdraw whose settle was lost replays the receipt; another person's withdraw is refused by
      // the machine as `invalid` and becomes the definite `not_retractable 'withdrawn'` (V-01; 7a:605).
      if (candidate.state === 'withdrawn') {
        const result = await withdraw();
        if (result.status === 'committed') return { status: 'retracted', reason: null };
        if (result.code === 'invalid') return { status: 'not_retractable', reason: 'withdrawn' };
        return result;
      }

      // Every unselected candidate in a non-retractable state is refused here, without a withdraw: a copied one may
      // be the other copy's selection (N-4; 7a:606).
      if (!candidate.retractable) return { status: 'not_retractable', reason: candidate.retractReason };

      const result = await withdraw();
      // Any refusal, including the machine's `invalid` and an open execution's `unavailable`, leaves the item
      // unfinished for the same confirm's replay; there is no re-read after a refusal (7a:621–:626; list B).
      return result.status === 'committed' ? { status: 'retracted', reason: null } : result;
    } catch (error) {
      return caughtRejection(error);
    }
  };

  return { readCopyInterventions, retractCopiedIntervention };
}
