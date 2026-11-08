/**
 * The `adviser_creation` decision source: the second (and each later) counted automatic rework of one Task becomes a
 * card when the Goal has no adviser. It is a pure projection of the automatic-rework notices — no adviser
 * operation, no stored card and no second rework filter.
 *
 * The source's canonical identity is `{ kind: 'adviser_creation', trigger }`, where `trigger` is the triggering
 * requeue or reverify round (`decisionSourceKey` keys it by that trigger arm). The item is kept only when it is a
 * counted rework (`counted`) and the Task's counted total across both arms is at least two (`taskCount >= 2`); an
 * automatic recovery on either arm never becomes a new trigger. Once an adviser exists the item is stamped
 * `closedReason: 'source_resolved'`; the shared read model's answer/application overlay still wins for an answered or
 * applied card.
 */
import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../../contracts/core/identity.js';
import type { ReadResult } from '../../../../contracts/core/results.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type {
  DecisionOptionV1, DecisionSourceIdentityV1, DecisionSourceV1, DecisionSubjectV1,
} from '../../../../contracts/goal-decisions.js';
import { decisionSourceKey, decisionSubjectKey } from '../../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import type { TaskRequeueRef } from '../../../../contracts/task-requeue.js';
import type { VerificationRoundRef } from '../../../../contracts/verification.js';
import type {
  DecisionCardV1, DecisionNoticeSourcePort, NoticeItemV1,
} from '../../model/decision-contracts.js';
import type { ResponsibilityRecipientPort } from '../../tasks/responsibility-recipient.js';
import { goalBasis } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/**
 * The notice item plus the read-only closure stamp: `'source_resolved'` once an adviser exists, `null` while none
 * does (the shared answer overlay already reads `applied`/`answered` on top of this stamp).
 */
export type AdviserCreationNoticeItemV1 = NoticeItemV1 & {
  readonly closedReason: 'source_resolved' | null;
};

export type AdviserCreationSourceDependencies = {
  /** the automatic-rework projection (`createAutomaticReworkNoticeSource`). */
  notices: Pick<DecisionNoticeSourcePort, 'readPage'>;
  /** The one adviser resolver; an existing adviser closes the item as `source_resolved`. */
  resolveDutyRecipient(ctx: CoreCallContext, input: { workspace: WorkspaceScope; duty: 'adviser' }):
    Promise<ReadResult<SessionRef | null>>;
  /** o4b2 ruling 2 (b): the one L35 resolver's Goal step (`asker: null`); absent keeps the workspace duty read of a narrow double */
  responsibleAdviser?: Pick<ResponsibilityRecipientPort, 'resolveResponsibilityRecipient'>;
};

/** One projection page width; the walk is paged to its end with no `after`. */
const PAGE_LIMIT = 100;

/** The card's open options; the application row answers `approve` with `role_line_action_unavailable`. */
export function adviserCreationOptions(): DecisionOptionV1[] {
  return [{ id: 'approve', label: '同意', effect: 'apply' }, { id: 'reject', label: '拒绝', effect: 'reject' }];
}

/** The one identity both the by-key read and the registration's `keyOf` use, through `decisionSourceKey`. */
export function adviserCreationIdentityOf(
  item: AdviserCreationNoticeItemV1,
): Extract<DecisionSourceIdentityV1, { kind: 'adviser_creation' }> {
  const rework = item.rework!;
  return rework.operation === 'requeue'
    ? { kind: 'adviser_creation', trigger: { kind: 'requeue', ref: rework.sourceRef as TaskRequeueRef } }
    : { kind: 'adviser_creation', trigger: { kind: 'round', ref: rework.sourceRef as VerificationRoundRef } };
}

/** The one identity string; the registration's `keyOf` and the by-key read compare exactly this. */
export function adviserCreationKeyOf(item: NoticeItemV1): string {
  return decisionSourceKey(adviserCreationIdentityOf(item as AdviserCreationNoticeItemV1));
}

/** True only for a counted item whose Task has at least two counted reworks across both arms. */
function isSecondCountedRework(item: NoticeItemV1): boolean {
  return item.rework !== null && item.rework.counted && item.rework.taskCount >= 2;
}

/** Pages the projection to its end (no `after`) and keeps the requested subject's second-or-later counted reworks. */
async function readAdviserCreationItems(
  deps: AdviserCreationSourceDependencies, ctx: CoreCallContext,
  input: { workspace: WorkspaceScope; subject: DecisionSubjectV1 },
): Promise<ReadResult<AdviserCreationNoticeItemV1[]>> {
  const goalRef = input.subject.kind === 'goal' ? input.subject.goalRef : undefined;
  const items: AdviserCreationNoticeItemV1[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await deps.notices.readPage(ctx, {
      workspace: input.workspace,
      ...(goalRef === undefined ? {} : { goalRef }),
      page: { limit: PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
    });
    if (page.status !== 'ready') return page;
    for (const item of page.value.items) {
      if (item.subject.kind !== input.subject.kind) continue;
      if (decisionSubjectKey(item.subject) !== decisionSubjectKey(input.subject)) continue;
      if (!isSecondCountedRework(item)) continue;
      items.push(item as AdviserCreationNoticeItemV1);
    }
    const next = page.value.nextCursor;
    if (next === null) break;
    cursor = next;
  }
  // No second counted rework on this subject: there is no card to close, so the adviser is never resolved (the one
  // projection walk is the whole cost of a read with no candidate).
  if (items.length === 0) return { status: 'ready', value: [] };
  // One resolver read per read: the Goal's own adviser (o4b2 ruling 2 (b)) closes every listed item; a narrow
  // double without the resolver keeps the workspace duty read.
  let hasAdviser: boolean;
  if (deps.responsibleAdviser !== undefined) {
    const resolved = await deps.responsibleAdviser.resolveResponsibilityRecipient(ctx, {
      projectId: input.workspace.projectId, goalRef: goalRef ?? null, moduleRef: null, kind: 'general', asker: null });
    if (resolved.status !== 'ready') return resolved;
    hasAdviser = resolved.value.kind === 'session';
  } else {
    const adviser = await deps.resolveDutyRecipient(ctx, { workspace: input.workspace, duty: 'adviser' });
    if (adviser.status !== 'ready') return adviser;
    hasAdviser = adviser.value !== null;
  }
  const closedReason = hasAdviser ? 'source_resolved' as const : null;
  return { status: 'ready', value: items.map((item) => ({ ...item, closedReason })) };
}

/**
 * The C3 facts handler: page the automatic-rework projection to the end with no `after`, keep this subject's second-or-later
 * counted reworks, and stamp each item's read-only `closedReason` from the one adviser read. A non-ready page or
 * resolver read is returned unchanged.
 */
export async function readAdviserCreationCollection(
  deps: AdviserCreationSourceDependencies, ctx: CoreCallContext,
  input: { workspace: WorkspaceScope; subject: DecisionSubjectV1 },
): Promise<ReadResult<readonly AdviserCreationNoticeItemV1[]>> {
  return readAdviserCreationItems(deps, ctx, input);
}

/**
 * One item by its canonical `source.key`. A found item with an adviser answers `{ closed: 'source_resolved' }` with
 * the item's own `rework.requestedAt`; `null` only means the projection has no such second rework.
 */
export async function readAdviserCreationCardByKey(
  deps: AdviserCreationSourceDependencies, ctx: CoreCallContext,
  input: { workspace: WorkspaceScope; source: DecisionSourceV1 },
): Promise<ReadResult<{ item: AdviserCreationNoticeItemV1 } | { closed: 'source_resolved'; openedAt: string | null } | null>> {
  const items = await readAdviserCreationItems(deps, ctx, { workspace: input.workspace, subject: input.source.subject });
  if (items.status !== 'ready') return items;
  const item = items.value.find((candidate) => adviserCreationKeyOf(candidate) === input.source.key);
  if (item === undefined) return { status: 'ready', value: null };
  if (item.closedReason === null) return { status: 'ready', value: { item } };
  return { status: 'ready', value: { closed: 'source_resolved', openedAt: item.rework?.requestedAt ?? null } };
}

/** The one card projection; the generic card source owns the answer and terminal-state overlay. */
export function adviserCreationCard(item: AdviserCreationNoticeItemV1, subject: DecisionSubjectV1,
  goal: GoalSnapshot | null): DecisionCardV1 {
  const identity = adviserCreationIdentityOf(item);
  const key = decisionSourceKey(identity);
  const open = item.closedReason === null;
  const source: DecisionSourceV1 = {
    kind: 'adviser_creation',
    key,
    subject: structuredClone(subject),
    pins: [],
    ...(goal === null ? {} : { goalBases: [goalBasis(goal)] }),
  };
  return {
    cardKey: key, source,
    state: open ? 'waiting_answer' : 'closed',
    subject: structuredClone(subject), senderSessionRef: null, requestRef: null,
    objects: [], options: open ? adviserCreationOptions() : [],
    answerMessageRef: null, answer: null, application: null,
    candidateStatus: null, staleReason: null, closedReason: item.closedReason,
    openedAt: item.rework?.requestedAt ?? null, readOnly: !open, actions: open ? ['answer'] : [],
    taskRef: null, runRef: null,
  };
}

/**
 * The answerability branch: re-derive the same identity from the projection and return the one item's branch facts.
 * A missing item is `not_found`; a non-ready projection or adviser read is returned exactly as the collection.
 */
export async function readAdviserCreationSource(
  support: SourceReadSupport, ctx: CoreCallContext, source: DecisionSourceV1,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'adviser_creation' }>,
  deps: AdviserCreationSourceDependencies, goalRef: GoalRef,
): Promise<SourceReadResult> {
  const listed = await readAdviserCreationCollection(deps, ctx, { workspace: support.scope, subject: source.subject });
  if (listed.status !== 'ready') return listed;
  // The identity arm is the trigger the key names; the item's own trigger must key to the same string.
  const key = decisionSourceKey(identity);
  const item = listed.value.find((candidate) => adviserCreationKeyOf(candidate) === key);
  if (item === undefined) return rejectedWithCurrent('not_found', 'the adviser creation source names no second rework');
  const goalRead = await support.readGoal(goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  const goal = goalRead.value;
  const open = item.closedReason === null;
  return { status: 'ready', value: {
    goal,
    objects: [],
    options: open ? adviserCreationOptions() : [],
    pins: [],
    goalBases: [goalBasis(goal)],
    closed: !open,
    allowedReaderSessionRefs: [],
  } };
}
