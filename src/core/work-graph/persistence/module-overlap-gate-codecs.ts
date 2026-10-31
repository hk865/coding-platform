// src/core/work-graph/persistence/module-overlap-gate-codecs.ts (new; one field table, rule, codec, registration)
import { defineEvent, defineRecord, f, type InferEvent, type InferRecord } from '../../../contracts/data-format.js';
import {
  ModuleOverlapGateRefShape, RunRefShape, SessionMessageRefShape, SessionRefShape, TaskTripleShape, id,
} from '../../../contracts/data-format-refs.js';
import { ActorRefField } from '../model/session-operation-arms.js';
import { createEventCodec, createRecordCodec, formatSchemas } from './field-table-codec.js';

/** The one `noteRequest` field object: the two arms stay one shared field table for the record and its event. */
export const NOTE_REQUEST_FIELDS = {
  recipient: f.nullable(f.ref(SessionRefShape)),
  duty: f.optional(f.enumOf(['adviser', 'secretary'] as const)),
  messageRef: f.optional(f.ref(SessionMessageRefShape)),
  reason: f.optional(f.literal('no_adviser_or_secretary')),
};

/** The book's two `noteRequest` arms: recipient present ⇒ duty and messageRef; recipient null ⇒ reason. */
function moduleOverlapGateProblem(value: unknown): string | null {
  const request = (value as { noteRequest: Record<string, unknown> | null }).noteRequest;
  if (request === null) return null;
  const sent = request['recipient'] !== null;
  const wellFormed = sent
    ? request['duty'] !== undefined && request['messageRef'] !== undefined && request['reason'] === undefined
    : request['reason'] === 'no_adviser_or_secretary'
      && request['duty'] === undefined && request['messageRef'] === undefined;
  return wellFormed ? null : 'ModuleOverlapGate.noteRequest must be one of its two arms';
}

const ModuleOverlapGateFormat = defineRecord({
  name: 'ModuleOverlapGate', schemaId: 'ModuleOverlapGate@1', aggregateType: 'ModuleOverlapGate',
  fields: {
    ref: f.ref(ModuleOverlapGateRefShape),
    revision: f.revision({ min: 1 }),
    workspaceId: id,
    waiting: f.ref(TaskTripleShape),
    waitingAttempt: id,
    moduleId: id,
    running: f.array(f.object({
      task: f.ref(TaskTripleShape),
      run: f.ref(RunRefShape),
      startCursor: f.nullable(f.cursor('ledgerNonZero')),
    }), { min: 1 }),
    planRevision: f.integer({ min: 1 }),
    basisDigest: f.sha256(),
    incomplete: f.array(f.literal('start_cursor')),
    noteRequest: f.nullable(f.object(NOTE_REQUEST_FIELDS)),
    release: f.nullable(f.object({
      by: ActorRefField,
      at: f.isoTime(),
      reason: f.string(),
      commandId: id,
      revision: f.revision({ min: 1 }),
    })),
    since: f.boundCursor('since'),
  },
  rules: [moduleOverlapGateProblem],
  lookups: [{
    name: 'overlap-gate-by-goal',
    equal: ['ref.projectId', 'workspaceId', 'ref.goalId'],
    orderBy: { path: 'since', valueType: 'text' },
  }],
});

/** The one value type, from the one field table (R1; `C/README.md:107`). */
export type ModuleOverlapGateV1 = InferRecord<(typeof ModuleOverlapGateFormat)['fields']>;

export const moduleOverlapGateCodec = createRecordCodec(ModuleOverlapGateFormat);

const OPENED = defineEvent({ name: 'ModuleOverlapGateOpened', eventType: 'ModuleOverlapGateOpened', schemaVersion: 1,
  fields: { gate: f.ref(ModuleOverlapGateRefShape), revision: f.revision({ min: 1 }), basisDigest: f.sha256(),
    planRevision: f.integer({ min: 1 }), waitingAttempt: id } });
const NOTE_REQUESTED = defineEvent({ name: 'ModuleOverlapNoteRequested', eventType: 'ModuleOverlapNoteRequested',
  schemaVersion: 1, fields: { gate: f.ref(ModuleOverlapGateRefShape), revision: f.revision({ min: 1 }),
    basisDigest: f.sha256(), noteRequest: f.nullable(f.object(NOTE_REQUEST_FIELDS)) } });
const RELEASED = defineEvent({ name: 'ModuleOverlapGateReleased', eventType: 'ModuleOverlapGateReleased', schemaVersion: 1,
  fields: { gate: f.ref(ModuleOverlapGateRefShape), revision: f.revision({ min: 1 }), basisDigest: f.sha256(),
    reason: f.string(), commandId: id } });
export type ModuleOverlapGateOpenedEventV1 = InferEvent<'ModuleOverlapGateOpened', typeof OPENED.fields>;
export type ModuleOverlapNoteRequestedEventV1 = InferEvent<'ModuleOverlapNoteRequested', typeof NOTE_REQUESTED.fields>;
export type ModuleOverlapGateReleasedEventV1 = InferEvent<'ModuleOverlapGateReleased', typeof RELEASED.fields>;
export const moduleOverlapGateOpenedCodec = createEventCodec(OPENED);
export const moduleOverlapNoteRequestedCodec = createEventCodec(NOTE_REQUESTED);
export const moduleOverlapGateReleasedCodec = createEventCodec(RELEASED);
/** Record 4 with its three events: the gate opens, the note request lands and a person releases it. */
export const MODULE_OVERLAP_GATE_SCHEMAS = formatSchemas([moduleOverlapGateCodec,
  moduleOverlapGateOpenedCodec, moduleOverlapNoteRequestedCodec, moduleOverlapGateReleasedCodec]);
