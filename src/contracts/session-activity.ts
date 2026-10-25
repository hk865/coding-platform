/**
 * The one activity record of a Session (slice-6-SPEC L15): when the Session last received input or ended an entered
 * round, and which committed fact did it. It is a field-table format (`data-format.ts`) keyed by its own tagged ref;
 * the plain `SessionRef` in `session` is an association, never the key. A missing record reads as the Session's
 * creation time at revision 0 (the owner's absent default, never written).
 *
 * The record is written as a companion fragment inside the commit of the fact that caused it, never by its own
 * command and with no event of its own. `source` is that fact's ref: input lands through a QueryJob round or a
 * released SessionMessage, and a round ends through its QueryRun.
 */
import { defineRecord, defineShape, f, type InferRecord, type InferShape } from './data-format.js';
import { id, QueryJobRefShape, QueryRunRefShape, SessionMessageRefShape, SessionRefShape } from './data-format-refs.js';

/** The source branches each kind admits. */
const SOURCES_BY_KIND: Readonly<Record<SessionActivityKindV1, readonly SessionActivitySourceV1['aggregateType'][]>> = {
  input: ['QueryJob', 'SessionMessage'],
  round_ended: ['QueryRun'],
};

/** `session` names the Session the ref keys, and the source fact is in the ref's project. */
function activitySessionProblem(value: unknown): string | null {
  const activity = value as SessionActivityV1;
  if (activity.session.projectId !== activity.ref.projectId || activity.session.sessionId !== activity.ref.sessionId) {
    return 'SessionActivity.session is not the Session its ref names';
  }
  return activity.source.projectId === activity.ref.projectId ? null
    : 'SessionActivity.source belongs to another project';
}

/** `input` comes from a QueryJob round or a SessionMessage; `round_ended` from a QueryRun. */
function activitySourceKindProblem(value: unknown): string | null {
  const activity = value as SessionActivityV1;
  return SOURCES_BY_KIND[activity.kind].includes(activity.source.aggregateType) ? null
    : `SessionActivity.source ${activity.source.aggregateType} is not a source of ${activity.kind}`;
}

export const SessionActivityRefShape = defineShape({
  name: 'SessionActivityRef', fields: { aggregateType: f.literal('SessionActivity'), projectId: id, sessionId: id },
});
export const SessionActivityFormat = defineRecord({
  name: 'SessionActivity', schemaId: 'SessionActivity@1', aggregateType: 'SessionActivity',
  fields: {
    ref: f.ref(SessionActivityRefShape),
    // A stored record starts at revision 1; the absent default is revision 0.
    revision: f.revision({ min: 1 }),
    // An association only, never the key.
    session: f.ref(SessionRefShape),
    lastActivityAt: f.isoTime(),
    kind: f.enumOf(['input', 'round_ended'] as const),
    // The committing fact's ref.
    source: f.union('aggregateType', {
      QueryJob: QueryJobRefShape.fields,
      QueryRun: QueryRunRefShape.fields,
      SessionMessage: SessionMessageRefShape.fields,
    }),
  },
  rules: [activitySessionProblem, activitySourceKindProblem],
  // No lookups: the record is read by its ref (key = canonicalJson(ref)).
});
export type SessionActivityRef = InferShape<(typeof SessionActivityRefShape)['fields']>;
export type SessionActivityV1 = InferRecord<(typeof SessionActivityFormat)['fields']>;
export type SessionActivityKindV1 = SessionActivityV1['kind'];
/** `QueryJobRef | QueryRunRef | SessionMessageRef`. */
export type SessionActivitySourceV1 = SessionActivityV1['source'];
