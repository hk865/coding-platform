/**
 * 6A request rounds: the read projections, the secretary profile/scope ports,
 * spec §2's constants and ruling 7.8's bounds (book-6a §3.7, §3.12).
 *
 * Declarations only. `queries/` and `tasks/` receive the ports as injected
 * dependencies; nothing here reads a store or publishes a platform route.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { RoleBindingRefV1 } from '../../../contracts/dispatch.js';
import { defineShape, f, type InferShape } from '../../../contracts/data-format.js';
import { CurrentPointerRefShape, GoalRefShape, OperationRefShape, QueryJobRefShape, QueryRunRefShape, id } from '../../../contracts/data-format-refs.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  GoalCardDraftV1, QueryCloseDetailV1, QueryJobIntentV1, QueryJobRef, QueryRoundKind,
} from '../../../contracts/query-job.js';
import type { RuntimeBudget } from '../../../contracts/runtime-budget.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type { PlanProposalRef } from '../state/plan-machine.js';

// ------------------------------------------------------------------------ //
// Spec §2 constants and ruling 7.8 bounds                                   //
// ------------------------------------------------------------------------ //

export const SECRETARY_HANDOFF_INPUT_TOKENS = 500_000;
export const SECRETARY_IDLE_ARCHIVE_MS = 24 * 3600 * 1000;
/** 挑秘书并发重试上限. */
export const SECRETARY_PICK_RETRIES = 3;
/** request-tail 归属重试上限. */
export const SECRETARY_TAIL_RETRIES = 3;
export const IDEA_DETAIL_MAX_CODEPOINTS = 600;
/** A stored idea title is one line of at most this many code points. */
export const IDEA_TITLE_MAX_CODEPOINTS = 120;
/** How many finished rounds one preparation sees. */
export const SECRETARY_HISTORY_ROUNDS = 10;
/** Each history answer's byte cap. */
export const SECRETARY_HISTORY_ANSWER_BYTES = 2 * 1024;
/** Ruling 7.8: pages a queue handler may read per partition in one pass. */
export const REQUEST_PASS_PAGES = 5;
/** Ruling 7.8: one ordered traversal page. */
export const REQUEST_PAGE_SIZE = 200;
/** Ruling 7.8: advances launched per pass. */
export const REQUEST_ADVANCES_PER_PASS = 50;
/** Ruling 7.8: unassigned requests drained per pass. */
export const REQUEST_DRAINED_PER_PASS = 20;
/** Ruling 7.8: a failing queue backs off from 1 s doubling to 60 s. */
export const REQUEST_BACKOFF_INITIAL_MS = 1_000;
export const REQUEST_BACKOFF_MAX_MS = 60_000;

// ------------------------------------------------------------------------ //
// The request index names                                                   //
// ------------------------------------------------------------------------ //

export const QUERY_BY_REQUEST_INDEX = 's6-query-by-request';
export const QUERY_OPEN_BY_WORKSPACE_INDEX = 's6-query-open-by-workspace';
export const REQUEST_ROOTS_BY_GOAL_INDEX = 's6-request-roots-by-goal';
export const QUERY_RAN_BY_SESSION_GOAL_INDEX = 's6-query-ran-by-session-goal';

// ------------------------------------------------------------------------ //
// The one physical claim slots                                              //
// ------------------------------------------------------------------------ //

/** The one per-request tail slot: owner = the request's last round key. */
export const REQUEST_TAIL_PREFIX = 'request-tail:';
/** The one per-secretary intake slot: owner = the pending holder round key. */
export const SECRETARY_INTAKE_PREFIX = 'secretary-intake:';

export function requestTailKey(requestRoot: QueryJobRef): string {
  return REQUEST_TAIL_PREFIX + canonicalJson(requestRoot as unknown as JsonValue);
}

/** The Session aggregate key of the intake claim slot, not a record key; the Session is the physical owner. */
export function secretaryIntakeKey(session: SessionRef): string {
  return SECRETARY_INTAKE_PREFIX + canonicalJson({
    aggregateType: 'Session', projectId: session.projectId, sessionId: session.sessionId,
  } as unknown as JsonValue);
}

// ------------------------------------------------------------------------ //
// Read projections (§3.12)                                                  //
// ------------------------------------------------------------------------ //

export type RequestOwnerStateV1 = 'owned' | 'waiting' | 'owner_archived' | 'dropped';
export type RequestRoundStatus = 'queued' | 'running' | 'ended' | 'unknown';

export type RequestRoundViewV1 = {
  ref: QueryJobRef;
  kind: QueryRoundKind;
  status: RequestRoundStatus;
  input: string;
  answer: string | null;
  ideas: { title: string; detail: string }[];
  goalCardDrafts: { index: number; draft: GoalCardDraftV1 }[];
  selectedIdea: { round: QueryJobRef; index: number } | null;
  assignedSession: SessionRef | null;
  session: SessionRef | null;
  absorbedInto: QueryJobRef | null;
  closeCode: string | null;
  closeDetail: QueryCloseDetailV1 | null;
  since: CommitCursor;
};

export type RequestCoreViewV1 = {
  requestRoot: QueryJobRef;
  goalId: string | null;
  effectiveGoalId: string | null;
  owner: SessionRef | null;
  ownerState: RequestOwnerStateV1;
  processing: boolean;
  assignment: 'assigned' | 'unassigned';
  waitReason: 'secretary_open_cap' | 'owner_archived' | null;
  reasons: ('round' | 'reply' | 'release' | 'candidate')[];
  rounds: RequestRoundViewV1[];
  candidate: { proposalRef: PlanProposalRef; state: string; stale: boolean } | null;
};

// ------------------------------------------------------------------------ //
// Secretary profile / scope ports (§3.12)                                   //
// ------------------------------------------------------------------------ //

export type SecretaryProfileV1 = {
  profileId: string;
  sessionRole: RoleConfigurationRef;
  roleBinding: RoleBindingRefV1;
  runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget'];
  consumerId: string;
};

/** One admissible Session's candidate facts for the secretary pick (§3.12). */
export type SecretaryCandidateFactsV1 = {
  session: SessionRef;
  revision: number;
  scope: { kind: 'project' } | { kind: 'goal'; goalId: string };
  profile: SecretaryProfileV1;
  busy: boolean;
  ranGoal: boolean;
  lastInputTokens: number | null;
  tooLong: boolean;
  lastActivityAt: string;
};

export type SecretarySelectionFactsV1 = {
  candidates: SecretaryCandidateFactsV1[];
  guards: RecordGuard[];
  watermark: CommitCursor | null;
};

export interface SecretaryProfilePort {
  forSession(input: { workspace: WorkspaceScope; sessionRole: RoleConfigurationRef }): SecretaryProfileV1 | null;
  forNewLine(ctx: CoreCallContext, input: { workspace: WorkspaceScope }): Promise<ReadResult<SecretaryProfileV1 | null>>;
}

export interface SecretaryScopePort {
  scopeOf(ctx: CoreCallContext, input: { session: SessionRef }):
    Promise<ReadResult<{ kind: 'project' } | { kind: 'goal'; goalId: string }>>;
}

/**
 * The attempt phases that make a round live: a claim up to the Kernel entry.
 * `unknown` is deliberately absent: it keeps its occupancy for the operator,
 * but no queue advances it. The queue and the secretary pick read this one set.
 */
export const LIVE_ATTEMPT_PHASES: ReadonlySet<string> = new Set(['claimed', 'prepared', 'entering', 'entered']);

// ------------------------------------------------------------------------ //
// The request-root index's slot values                                      //
// ------------------------------------------------------------------------ //

/** The `rootMark` of a request's root round in `s6-request-roots-by-goal`. */
export const REQUEST_ROOT_MARK = 'root';

/** The goal slot of a request in `s6-request-roots-by-goal`: `g:<goalId>`, or `no-goal` for a request with none. */
export function requestGoalSlot(goalId: string | null): string {
  return goalId === null ? 'no-goal' : `g:${goalId}`;
}

// ------------------------------------------------------------------------ //
// The understanding command (the type only)                                //
// ------------------------------------------------------------------------ //

/** The goals are unique, and there is one pointer per goal, in the goals' order. */
export function understandingPointersProblem(value: unknown): string | null {
  const command = value as RequestUnderstandingCommandV1;
  const seen = new Set<string>();
  for (const goal of command.goals) {
    const key = canonicalJson(goal as unknown as JsonValue);
    if (seen.has(key)) return `RequestUnderstandingCommand.goals repeats ${goal.goalId}`;
    seen.add(key);
  }
  if (command.pointers.length !== command.goals.length) {
    return 'RequestUnderstandingCommand.pointers does not have one entry per goal';
  }
  for (let index = 0; index < command.goals.length; index += 1) {
    const goal = command.goals[index]!;
    const pointer = command.pointers[index]!.goalRef;
    if (pointer.projectId !== goal.projectId || pointer.goalId !== goal.goalId) {
      return `RequestUnderstandingCommand.pointers[${index}] is not goals[${index}]`;
    }
  }
  return null;
}

export const RequestUnderstandingCommandShape = defineShape({ name: 'RequestUnderstandingCommandV1', fields: {
  kind: f.literal('request_understanding'),
  operationId: id,
  operationRef: f.ref(OperationRefShape),
  requestRoot: f.ref(QueryJobRefShape),
  goals: f.array(f.ref(GoalRefShape), { min: 1 }),
  pointers: f.array(f.object({ goalRef: f.ref(GoalRefShape), pointer: f.ref(CurrentPointerRefShape), revision: f.integer({ min: 0 }) })),
  checkedRound: f.nullable(f.ref(QueryRunRefShape)),
  generation: f.integer({ min: 1 }),
  state: f.enumOf(['live', 'closed', 'consumed'] as const),
}, rules: [understandingPointersProblem] });
export type RequestUnderstandingCommandV1 = InferShape<(typeof RequestUnderstandingCommandShape)['fields']>;
