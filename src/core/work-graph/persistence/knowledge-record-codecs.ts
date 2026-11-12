/**
 * The knowledge write log (`KnowledgeWrite@1`) and its two state events (`KnowledgeWritesCompleted@1`,
 * `KnowledgeWritesUnconfirmed@1`): one field table each, the record store registration and the lookup the
 * reconciliation and 2c-1d's in-flight checks read (one line's logs in one state).
 *
 * A knowledge write commits one log per file change in the same commit as the write point's records (`pending`),
 * its `since` bound to the event that carries the file's content; once the file landed a second commit marks the
 * log `completed`. A log the reconciliation found not landed is `unconfirmed`: it was handed to the person as a
 * recovery item, and the file rules from then on.
 */
import { defineEvent, defineRecord, defineShape, f, type InferRecord } from '../../../contracts/data-format.js';
import { id } from '../../../contracts/data-format-refs.js';
import { createEventCodec, createRecordCodec, formatSchemas } from './field-table-codec.js';

const KNOWLEDGE_WRITE_STATES = ['pending', 'unconfirmed', 'completed'] as const;
/** equal: [ref.projectId, lineRef, state] — one line's logs in one state. */
export const KNOWLEDGE_WRITES_BY_LINE_STATE_LOOKUP = 'knowledge-writes-by-line-state';

const KnowledgeWriteRefShape = defineShape({
  name: 'KnowledgeWriteRef', fields: { aggregateType: f.literal('KnowledgeWrite'), projectId: id, writeId: id },
});

const KnowledgeWriteFormat = defineRecord({
  name: 'KnowledgeWrite', schemaId: 'KnowledgeWrite@1', aggregateType: 'KnowledgeWrite',
  fields: {
    ref: f.ref(KnowledgeWriteRefShape),
    revision: f.revision({ min: 1 }),
    /** `lineRefKey(scope, line)`: the workspace and the branch. */
    lineRef: id,
    /** Relative to the line's folder, starting with `.workbench/`. */
    path: id,
    kind: f.enumOf(['architecture', 'module', 'note'] as const),
    /** The module of a module file (project view), read from the file's bytes; null for the other kinds. */
    moduleId: f.nullable(id),
    /** The git blob id of the file before the commit; null when it did not exist. */
    beforeBlob: f.nullable(id),
    /** The git blob id of the bytes to write; null when the change deletes the file. */
    afterBlob: f.nullable(id),
    state: f.enumOf(KNOWLEDGE_WRITE_STATES),
    /** The cursor of the event that carries this file's content (bound by the Store at the commit). */
    since: f.boundCursor('since'),
  },
  lookups: [
    { name: KNOWLEDGE_WRITES_BY_LINE_STATE_LOOKUP, equal: ['ref.projectId', 'lineRef', 'state'] },
  ],
});

/** One knowledge file change's write log. */
export type KnowledgeWriteV1 = InferRecord<(typeof KnowledgeWriteFormat)['fields']>;
export const knowledgeWriteCodec = createRecordCodec(KnowledgeWriteFormat);

const KnowledgeWritesCompletedFormat = defineEvent({
  name: 'KnowledgeWritesCompleted', eventType: 'KnowledgeWritesCompleted', schemaVersion: 1,
  fields: { projectId: id, writeIds: f.array(id, { min: 1 }) },
});
export const knowledgeWritesCompletedCodec = createEventCodec(KnowledgeWritesCompletedFormat);

/** The logs a reconciliation handed to the person as recovery items (`pending` to `unconfirmed`). */
const KnowledgeWritesUnconfirmedFormat = defineEvent({
  name: 'KnowledgeWritesUnconfirmed', eventType: 'KnowledgeWritesUnconfirmed', schemaVersion: 1,
  fields: { projectId: id, writeIds: f.array(id, { min: 1 }) },
});
export const knowledgeWritesUnconfirmedCodec = createEventCodec(KnowledgeWritesUnconfirmedFormat);

/** The write log and its two state events, registered by both backends. */
export const KNOWLEDGE_RECORD_SCHEMAS = formatSchemas([knowledgeWriteCodec, knowledgeWritesCompletedCodec,
  knowledgeWritesUnconfirmedCodec]);
