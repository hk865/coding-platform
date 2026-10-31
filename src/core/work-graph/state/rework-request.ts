/**
 * The `ReworkRequest` record (record 3, `book-7c.md:1083–:1105`): one field table, the one format, the two pure later
 * revisions and the `rework-request-by-goal` lookup.
 *
 * The two request owners (`tasks/requeue-service.ts`, `evidence/evidence-service.ts`) build the input from their own
 * `RequeueTaskInput`/`ReverifyRoundInput`; this file derives its input from the field table instead of importing
 * `../model/` (a pure `state/` module has no dependencies, and the boundary check looks at type-only imports too).
 * `pins` is stored as JSON and read back as plain objects; the owners cast it to their `VersionPin[]` where they check
 * it. The Store binds `since` from the commit cursor, so every constructor returns the pre-bind form.
 */
import { defineRecord, f, type InferPending, type InferRecord } from '../../../contracts/data-format.js';
import {
  ReworkRequestRefShape, RunRefShape, SessionRefShape, TaskTripleShape, VerificationRoundRefShape,
} from '../../../contracts/data-format-refs.js';
import type { TaskRequeueRef } from '../../../contracts/task-requeue.js';
import type { VerificationRoundRef } from '../../../contracts/verification.js';

/** The requester's agent actor; the record and both replay events carry the same shape. */
export const REWORK_REQUEST_ACTOR_FIELDS = {
  kind: f.literal('agent'),
  id: f.string({ min: 1, unit: 'codePoints' }),
  runRef: f.ref(RunRefShape),
};

const REQUEUE_INPUT_FIELDS = {
  kind: f.literal('requeue'),
  value: f.json(),
};
const RECHECK_INPUT_FIELDS = {
  kind: f.literal('recheck'),
  value: f.json(),
};
const REQUESTER_FIELDS = {
  actor: f.object(REWORK_REQUEST_ACTOR_FIELDS),
  session: f.ref(SessionRefShape),
  run: f.ref(RunRefShape),
  duty: f.enumOf(['executor', 'adviser'] as const),
};
/** The record's and the close event's outcome; `applied` names the requeue or the successor round. */
export const REWORK_REQUEST_OUTCOME_FIELDS = {
  code: f.optional(f.string({ min: 1, unit: 'codePoints' })),
  reason: f.optional(f.string({ max: 2000, unit: 'utf8Bytes' })),
  applied: f.optional(f.json()),
};

export const REWORK_REQUEST_FIELDS = {
  ref: f.ref(ReworkRequestRefShape),
  revision: f.revision({ min: 1 }),
  workspaceId: f.string({ min: 1, unit: 'codePoints' }),
  kind: f.enumOf(['requeue', 'recheck'] as const),
  task: f.ref(TaskTripleShape),
  subject: f.union('kind', {
    run: { kind: f.literal('run'), run: f.ref(RunRefShape) },
    round: { kind: f.literal('round'), round: f.ref(VerificationRoundRefShape) },
  }),
  requester: f.object(REQUESTER_FIELDS),
  // The two owners' input checks stay authoritative: no second byte cap and no truncator here.
  reason: f.string(),
  requestedAt: f.isoTime(), // the card's `openedAt`; the owner's `now()`
  input: f.union('kind', { requeue: REQUEUE_INPUT_FIELDS, recheck: RECHECK_INPUT_FIELDS }),
  pins: f.array(f.json()),
  countedNext: f.nullable(f.integer({ min: 0 })),
  state: f.enumOf(['pending', 'applied', 'rejected', 'stale'] as const),
  outcome: f.nullable(f.object(REWORK_REQUEST_OUTCOME_FIELDS)),
  closedBy: f.nullable(f.object({ commandId: f.string({ min: 1, unit: 'codePoints' }), at: f.isoTime() })),
  since: f.boundCursor('since'),
};

/** The record as stored: `since` is the commit cursor the Store bound. */
export type ReworkRequestV1 = InferRecord<typeof REWORK_REQUEST_FIELDS>;
/**
 * The pre-bind form every writer hands to its commit (`PendingNoteVersionSnapshot` shape): `since` is `null` and the
 * commit's `commitCursorBindings` fills it. No constructor here writes a cursor of its own.
 */
export type PendingReworkRequestV1 = InferPending<typeof REWORK_REQUEST_FIELDS>;
/**
 * The creation input: the state-managed fields are absent, and `input`/`pins` keep the field-table types (the callers
 * pass their `RequeueTaskInput`/`ReverifyRoundInput`; the table stores them as JSON).
 */
export type NewReworkRequestInputV1 = Omit<ReworkRequestV1, 'revision' | 'state' | 'outcome' | 'closedBy' | 'since'>;

export const REWORK_REQUEST_FORMAT = defineRecord({
  name: 'ReworkRequest',
  schemaId: 'ReworkRequest@1',
  aggregateType: 'ReworkRequest',
  fields: REWORK_REQUEST_FIELDS,
  lookups: [{
    name: 'rework-request-by-goal',
    equal: ['ref.projectId', 'workspaceId', 'ref.goalId'],
    orderBy: { path: 'since', valueType: 'text' },
  }],
});

/** Builds `pending@1`; `since` stays `null` for the committing Store to bind. */
export function newReworkRequest(input: NewReworkRequestInputV1): PendingReworkRequestV1 {
  return { ...input, revision: 1, state: 'pending', outcome: null, closedBy: null, since: null };
}

/**
 * `applied` at revision + 1: the requeue or the successor round the owner committed. The next revision is a new record,
 * so its `since` is `null` again and the applied commit binds its own cursor.
 */
export function applyReworkRequest(
  record: PendingReworkRequestV1,
  applied: TaskRequeueRef | VerificationRoundRef,
  closedBy: { commandId: string; at: string },
): PendingReworkRequestV1 {
  return {
    ...record,
    revision: record.revision + 1,
    state: 'applied',
    outcome: { applied },
    closedBy,
    since: null,
  };
}

/**
 * Closes a pending request `rejected` (the policy refusal) or `stale` (the source moved) at revision + 1; `code` and
 * `reason` are the owner's, and the close commit binds the new `since`.
 */
export function closeReworkRequestRecord(
  record: PendingReworkRequestV1,
  outcome: 'rejected' | 'stale',
  code: string,
  reason: string,
  closedBy: { commandId: string; at: string },
): PendingReworkRequestV1 {
  return { ...record, revision: record.revision + 1, state: outcome, outcome: { code, reason }, closedBy, since: null };
}
