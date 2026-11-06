/**
 * 7D2 C1: the cold start's two reads. The cold start lives in `sessions/`, which cannot read the request-root index
 * or the answers batch, so the composition root binds these two into its `initial` and `adoption` ports. Both write
 * nothing; a failed read or a damaged record is `unavailable`, never "none".
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { InitializationBindingReadPort } from '../model/goal-card-contracts.js';
import { REQUEST_ROOT_MARK, REQUEST_ROOTS_BY_GOAL_INDEX, requestGoalSlot } from '../model/request-contracts.js';
import { goalRefFor } from '../persistence/commit-compiler.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import type { QueryJobPort } from '../queries/contracts.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import { readAnswers } from './request-facts.js';
import type { RequestFactsReader } from './request-service.js';

export type ColdStartReadsDependencies = {
  ordered: RecordOrderedLookupPort;
  records: Pick<GoalRecordTransactionPort, 'readMany'>;
  facts: Pick<RequestFactsReader, 'readFacts'>;
  answers: Pick<QueryJobPort, 'readQueryAnswer'>;
  bindings: Pick<InitializationBindingReadPort, 'readBindingByAnswerDraft'>;
};

/** One descending page of the workspace's no-goal requests; the candidate is never looked for past it. */
const CANDIDATE_PAGE_LIMIT = 20;

function unavailableRead(what: string, read: { status: string; code?: string; reason?: string }) {
  return rejected('unavailable', read.status === 'rejected' ? `${what} failed: ${read.code}: ${read.reason}`
    : `${what} is ${read.status}`);
}

/**
 * The cold-start candidate: the newest initial-format plan answer (`planDraftIndex !== null`, which only the initial
 * plan answer carries) among the workspace's newest no-goal requests, newest request and newest round first. Only
 * its Query run and answer refs are returned; `null` until such an answer exists.
 */
export async function readColdStartCandidate(deps: ColdStartReadsDependencies, ctx: CoreCallContext,
  input: { workspace: WorkspaceScope }): Promise<ReadResult<{ queryRunRef: QueryRunRef; answerRef: QueryJobAnswerRef } | null>> {
  let page: Awaited<ReturnType<RecordOrderedLookupPort['lookupOrdered']>>;
  try {
    page = await deps.ordered.lookupOrdered({ index: REQUEST_ROOTS_BY_GOAL_INDEX, direction: 'desc',
      limit: CANDIDATE_PAGE_LIMIT,
      values: [input.workspace.projectId, input.workspace.workspaceId, REQUEST_ROOT_MARK, requestGoalSlot(null)] });
  } catch (error) {
    return rejected('unavailable', `the no-goal request roots could not be read: ${messageOf(error)}`);
  }
  if (page.status !== 'ready') {
    return rejected('unavailable', `the no-goal request roots read failed: ${page.code}: ${page.reason}`);
  }
  for (const record of page.value.records) {
    const root = decodeQueryJobSnapshot(record);
    if (root.status !== 'decoded') return rejected('unavailable', `a request root is damaged: ${root.reason}`);
    const facts = await deps.facts.readFacts(ctx, { requestRoot: root.value.ref });
    if (facts.status !== 'ready') return unavailableRead('the request rounds read', facts);
    const answers = await readAnswers(deps, facts.value.rounds);
    if (answers.status !== 'ready') return answers;
    const byRef = new Map(answers.value.map((answer) => [canonicalKey(answer.ref), answer]));
    for (const round of [...facts.value.rounds].reverse()) {
      const latest = round.job.answerRefs.at(-1);
      const answer = latest === undefined ? undefined : byRef.get(canonicalKey(latest));
      if (answer !== undefined && answer.answer.planDraftIndex !== null) {
        return { status: 'ready', value: { queryRunRef: { ...answer.answer.runRef }, answerRef: { ...answer.ref } } };
      }
    }
  }
  return { status: 'ready', value: null };
}

/**
 * Whether the candidate's draft was adopted: its one initialization binding names a Goal whose first plan is active
 * (`initialization/adopt` adopts it last). No binding yet is `false`.
 */
export async function readColdStartAdoption(deps: ColdStartReadsDependencies, ctx: CoreCallContext,
  input: { answerRef: QueryJobAnswerRef }): Promise<ReadResult<boolean>> {
  const answer = await deps.answers.readQueryAnswer(ctx, input.answerRef);
  if (answer.status !== 'ready') return unavailableRead('the candidate answer read', answer);
  // The candidate was chosen by its non-null `planDraftIndex`; a stored answer never changes.
  const draftIndex = answer.value.answer.planDraftIndex!;
  const binding = await deps.bindings.readBindingByAnswerDraft(ctx, { answerRef: input.answerRef, draftIndex });
  if (binding.status === 'not_found') return { status: 'ready', value: false };
  if (binding.status !== 'ready') return unavailableRead('the candidate draft binding read', binding);
  const goalRef = goalRefFor(binding.value.goalRef.projectId, binding.value.goalRef.goalId);
  const goal = await readOwnerRecord({ store: deps.records, refKey: canonicalKey(goalRef), decode: decodeGoalSnapshot,
    readError: (message) => rejected('unavailable', `the adopted draft's Goal could not be read: ${message}`) });
  if (!goal.ok) {
    return rejected('unavailable', 'notFound' in goal ? "the candidate draft's binding names a missing Goal"
      : goal.rejection.reason);
  }
  return { status: 'ready', value: goal.value.activePlanRevision !== null };
}
