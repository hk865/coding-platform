/**
 * Record 5 (H): the Work handoff brief's record, its two replay events and the one non-committing
 * consumption contribution.
 *
 * The record is not 6B's secretary `HandoffBriefV1`; the ref, material and binding come from
 * `contracts/handoff-brief.ts` (F2) and are imported, never re-declared. This module stays the pure
 * `state/` half: the field tables, the cross-field rule and the state transition. The Store envelope
 * codecs and the one `HANDOFF_BRIEF_RECORD_SCHEMAS` registration bundle live in
 * `sessions/session-record-codecs.ts`, because only that layer may name the Store's encoded records.
 *
 * Readiness is deliberately not a field: whether the successor may be offered the brief is read from
 * the stored handoff operation's phase progress after its responsibility transfer completed.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import {
  defineEvent, defineRecord, f, type InferEvent,
} from '../../../contracts/data-format.js';
import {
  HandoffBriefRefShape, OperationRefShape, RunRefShape, SessionRefShape, TaskTripleShape,
} from '../../../contracts/data-format-refs.js';
import { canonicalKey, canonicalOf } from '../../../contracts/fingerprint.js';
import type {
  HandoffBriefBindingV1, HandoffBriefMaterialV1, HandoffBriefRef,
} from '../../../contracts/handoff-brief.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isRecord } from '../../../contracts/validation/common.js';

export const WORK_HANDOFF_BRIEF_SCHEMA_ID = 'HandoffBrief@1';
export const WORK_HANDOFF_BRIEF_RECORDED_EVENT_TYPE = 'HandoffBriefRecorded';
export const WORK_HANDOFF_BRIEF_CONSUMED_EVENT_TYPE = 'HandoffBriefConsumed';
export const WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP = 'work-handoff-brief-by-session';

/**
 * Record 5 as stored. `digest` is `handoffBriefDigest(material)` only — never the rendered bytes, a
 * template id or a tool table; `consumedBy` is the one CAS field and `since` is the Store-bound cursor.
 */
export type WorkHandoffBriefV1 = {
  ref: HandoffBriefRef;
  revision: number;
  workspaceId: string;
  operation: OperationRef;
  source: SessionRef;
  duty: 'executor' | 'adviser';
  tasks: TaskTriple[];
  binding: HandoffBriefBindingV1;
  digest: string;
  material: HandoffBriefMaterialV1;
  consumedBy: RunRef | null;
  since: CommitCursor;
};

const DUTIES = ['executor', 'adviser'] as const;

export const WORK_HANDOFF_BRIEF_FIELDS = {
  ref: f.ref(HandoffBriefRefShape),
  revision: f.revision({ min: 1 }),
  workspaceId: f.string({ min: 1, unit: 'codePoints' }),
  operation: f.ref(OperationRefShape),
  source: f.ref(SessionRefShape),
  duty: f.enumOf(DUTIES),
  tasks: f.array(f.ref(TaskTripleShape)),
  // The independent binding's fields are checked here; the record-level rule compares them below.
  binding: f.object({
    operation: f.ref(OperationRefShape),
    source: f.ref(SessionRefShape),
    successor: f.ref(SessionRefShape),
    duty: f.enumOf(DUTIES),
    digest: f.sha256(),
  }),
  digest: f.sha256(),
  // The material is F2's normalized union; it is stored as the canonical JSON object and checked by
  // the assembly and preparation paths that own its facts. The record does not re-declare the union.
  material: f.json(),
  consumedBy: f.nullable(f.ref(RunRefShape)),
  since: f.boundCursor('since'),
};

/**
 * The one cross-field rule: `operation`, `source`, `duty` and `digest` are the binding's. A record that
 * names a different operation or line, or claims another duty/digest, is refused rather than trusted.
 */
export function workHandoffBriefBindingProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the handoff brief record is not an object';
  const binding = value['binding'];
  if (!isRecord(binding)) return 'the handoff brief record requires its binding';
  const differences: readonly [string, string][] = [
    ['operation', 'operation'],
    ['source', 'source'],
    ['duty', 'duty'],
    ['digest', 'digest'],
  ];
  for (const [recordField, bindingField] of differences) {
    const recordValue = canonicalOf(value[recordField]);
    const bindingValue = canonicalOf(binding[bindingField]);
    if (recordValue === null || bindingValue === null || recordValue !== bindingValue) {
      return `the handoff brief ${recordField} disagrees with its binding`;
    }
  }
  return null;
}

export const WORK_HANDOFF_BRIEF_FORMAT = defineRecord({
  name: 'WorkHandoffBrief',
  schemaId: WORK_HANDOFF_BRIEF_SCHEMA_ID,
  aggregateType: 'HandoffBrief',
  fields: WORK_HANDOFF_BRIEF_FIELDS,
  rules: [workHandoffBriefBindingProblem],
  lookups: [{
    name: WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP,
    equal: ['ref.projectId', 'workspaceId', 'ref.sessionId'],
    orderBy: { path: 'since', valueType: 'text' },
  }],
});

const HANDOFF_BRIEF_EVENT_FIELDS = { handoffBrief: f.json() };

/**
 * Both replay events carry the whole record they wrote, so an idempotent replay restores the exact
 * record (including its material and `consumedBy`) instead of re-deriving it from current state.
 */
function recordedBriefProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the handoff brief event is not an object';
  const brief = value['handoffBrief'];
  if (!isRecord(brief)) return 'the handoff brief event requires the recorded brief';
  // The event may be written in the same commit that binds the record's `since`, so it accepts the
  // pending form too; the record's own registration still requires the stored cursor.
  const problem = checkShape(WORK_HANDOFF_BRIEF_FORMAT, brief, 'pending');
  return problem === null ? null : `the recorded handoff brief is invalid: ${problem}`;
}

export const WORK_HANDOFF_BRIEF_RECORDED_FORMAT = defineEvent({
  name: WORK_HANDOFF_BRIEF_RECORDED_EVENT_TYPE,
  eventType: WORK_HANDOFF_BRIEF_RECORDED_EVENT_TYPE,
  schemaVersion: 1,
  fields: HANDOFF_BRIEF_EVENT_FIELDS,
  rules: [recordedBriefProblem],
});

export const WORK_HANDOFF_BRIEF_CONSUMED_FORMAT = defineEvent({
  name: WORK_HANDOFF_BRIEF_CONSUMED_EVENT_TYPE,
  eventType: WORK_HANDOFF_BRIEF_CONSUMED_EVENT_TYPE,
  schemaVersion: 1,
  fields: HANDOFF_BRIEF_EVENT_FIELDS,
  rules: [recordedBriefProblem],
});

/**
 * The stored handoff operation facts readiness reads. Structurally typed so this
 * pure module does not import the operation model (the model imports state).
 */
export type HandoffTransferFactsV1 = {
  ref: OperationRef;
  action: {
    kind: string;
    progress: {
      assignments: readonly {
        successor: SessionRef | null;
        transfers: readonly { task: TaskTriple; receipt: { cursor: CommitCursor } | null }[];
      }[];
    };
  };
};

/**
 * B-02 readiness: the successor may be offered record 5 only after the matching
 * assignment's responsibility transfer has completed. The evidence is the stored
 * operation's own phase progress — the assignment whose successor is this
 * Session, with every one of its named transfers carrying a receipt — never a
 * second state. A record that names another operation, another successor, or
 * another task set is not ready.
 */
export function workHandoffBriefTransferComplete(
  record: WorkHandoffBriefV1, operation: HandoffTransferFactsV1,
): boolean {
  if (operation.action.kind !== 'handoff') return false;
  if (canonicalKey(operation.ref) !== canonicalKey(record.binding.operation)) return false;
  const assignment = operation.action.progress.assignments.find(entry => entry.successor !== null
    && canonicalKey(entry.successor) === canonicalKey(record.binding.successor));
  if (assignment === undefined) return false;
  if (assignment.transfers.length !== record.tasks.length) return false;
  const tasks = new Set(record.tasks.map(task => canonicalKey(task)));
  return assignment.transfers.every(transfer =>
    transfer.receipt !== null && tasks.has(canonicalKey(transfer.task)));
}

/**
 * The entered confirmation's one consumption contribution: the record with `consumedBy` set to the
 * successor Run and the guard that pins the revision it was read at. It commits nothing, writes no
 * event and invents no time field; every entry-recording commit merges both halves, so a recovery that
 * repeats the commit lands once. There is no `no_binding` arm: a caller without a handoff binding does
 * not read record 5 and does not call this function.
 */
export function workHandoffBriefConsumption(
  record: WorkHandoffBriefV1, run: RunRef, at: string,
): { record: WorkHandoffBriefV1; guard: { refKey: string; expectedRevision: number } } {
  // Record 5 stores no update time; `at` is accepted for the callers' shared commit shape and is not a
  // new record field.
  void at;
  return {
    record: { ...record, revision: record.revision + 1, consumedBy: run },
    guard: { refKey: canonicalKey(record.ref), expectedRevision: record.revision },
  };
}
