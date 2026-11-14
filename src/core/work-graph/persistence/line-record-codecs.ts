/**
 * The line record's RecordStore codecs (`Line@1`, `src/contracts/line.ts`), its two result events, `LineRegistered@1`
 * (a registration or a branch switch) and `LineChanged@1` (its end), each carrying the line the write answered with so
 * a replay rebuilds it from the event alone, the schemas both backends register, and the one read of a project's
 * lines. Only `state/line-machine.ts` builds the record.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { defineEvent, f, type InferEvent } from '../../../contracts/data-format.js';
import { id } from '../../../contracts/data-format-refs.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import {
  LINE_BY_PROJECT_LOOKUP, LineFormat, lineKeyOf, lineRefOf, type LineRef, type LineSnapshot,
} from '../../../contracts/line.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { createEventCodec, createRecordCodec, formatSchemas } from './field-table-codec.js';
import { lookupAll } from './lookup-all.js';
import { storeFailureToRejection } from './read-result-failures.js';

export const lineCodec = createRecordCodec(LineFormat);

const LINE_REGISTERED_FORMAT = defineEvent({
  name: 'LineRegistered', eventType: 'LineRegistered', schemaVersion: 1,
  fields: { projectId: id, workspaceId: id, line: f.object(LineFormat.fields) },
});

export type LineRegisteredEventV1 = InferEvent<'LineRegistered', typeof LINE_REGISTERED_FORMAT.fields>;

export const lineRegisteredCodec = createEventCodec(LINE_REGISTERED_FORMAT);

/** KLS-3b: a line's end (`settleLine`), carrying the closed line as `LineRegistered` carries a registered one. */
const LINE_CHANGED_FORMAT = defineEvent({
  name: 'LineChanged', eventType: 'LineChanged', schemaVersion: 1,
  fields: { projectId: id, workspaceId: id, line: f.object(LineFormat.fields) },
});

export type LineChangedEventV1 = InferEvent<'LineChanged', typeof LINE_CHANGED_FORMAT.fields>;

export const lineChangedCodec = createEventCodec(LINE_CHANGED_FORMAT);

export const LINE_RECORD_SCHEMAS = formatSchemas([lineCodec, lineRegisteredCodec, lineChangedCodec]);

/** The refKey of a workspace's line in one folder. */
export function lineRecordKey(projectId: string, workspaceId: string, folder: string): string {
  return canonicalJson({ aggregateType: 'Line', projectId, workspaceId, lineRef: lineKeyOf(workspaceId, folder) });
}

/**
 * The project's lines (of one workspace when it is named), oldest first: the first line of a workspace is its main
 * line. Lines made in the same instant keep the order of their keys. `watermark` is the read's ledger position (a
 * writer that judged the set CASes on it).
 */
export async function readProjectLines(records: Pick<RecordLookupPort, 'lookup'>, projectId: string,
  workspaceId?: string): Promise<{ status: 'ready'; value: LineSnapshot[]; watermark: CommitCursor | null } | CoreRejection> {
  let batch;
  try {
    batch = await lookupAll(records, LINE_BY_PROJECT_LOOKUP, [projectId]);
  } catch (error) {
    return storeFailureToRejection(error);
  }
  const items = batch.items;
  const lines: LineSnapshot[] = [];
  for (const record of items) {
    const decoded = lineCodec.decode(record);
    if (decoded.status !== 'decoded') return rejected('unavailable', `the line record ${record.refKey} is damaged: ${decoded.reason}`);
    if (workspaceId === undefined || decoded.value.ref.workspaceId === workspaceId) lines.push(decoded.value);
  }
  lines.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.ref.lineRef.localeCompare(b.ref.lineRef));
  return { status: 'ready', value: lines, watermark: batch.watermark };
}

/** One workspace's line in one folder; `not_found` when the folder is no line of it. */
export async function readLineRecord(records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string,
  workspaceId: string, folder: string,
): Promise<{ status: 'ready'; value: LineSnapshot } | { status: 'not_found' } | CoreRejection> {
  const key = lineRecordKey(projectId, workspaceId, folder);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return storeFailureToRejection(read);
  const record = read.value.records.find(entry => entry.refKey === key);
  if (record === undefined) return { status: 'not_found' };
  const decoded = lineCodec.decode(record);
  return decoded.status === 'decoded' ? { status: 'ready', value: decoded.value }
    : rejected('unavailable', `the line record ${key} is damaged: ${decoded.reason}`);
}

/**
 * The line a new Goal or Session is born on (kls-design §2.3.1; lead ruling KLS-3a 1): the named folder's line of
 * this workspace, or the workspace's main line. A workspace no Host has opened has no line (`null`); with several
 * lines and no folder named the main line is taken, never a refusal. A named folder that is no line of this workspace
 * is refused (product rule: a line is the workspace's own checkout, and guessing one would put the work in the
 * wrong folder). A merged or removed line is taken too: the platform's own creations for existing work (the next
 * Task's Session, a consultation copy, a handoff successor, a member line) go on (KLS-3b ruling 2, lead 11-14 Q3);
 * new work named on it is refused by the owners, after their replay lookup (`closedLineRefusal`).
 */
export async function lineForWrite(
  records: Pick<GoalRecordTransactionPort, 'readMany'> & Pick<RecordLookupPort, 'lookup'>,
  scope: { projectId: string; workspaceId: string }, lineFolder: string | undefined,
): Promise<{ status: 'ready'; value: LineRef | null } | CoreRejection> {
  if (lineFolder !== undefined) {
    const line = await readLineRecord(records, scope.projectId, scope.workspaceId, lineFolder);
    if (line.status === 'not_found') return rejected('not_found', `the folder ${lineFolder} is not a line of this workspace`);
    return line.status === 'ready' ? { status: 'ready', value: lineRefOf(line.value) } : line;
  }
  const lines = await readProjectLines(records, scope.projectId, scope.workspaceId);
  if (lines.status !== 'ready') return lines;
  const main = lines.value[0];
  return { status: 'ready', value: main === undefined ? null : lineRefOf(main) };
}

/**
 * KLS-3b ruling 2 (lead 11-14 Q3): new work named on a merged or removed line (a Goal, a Session with no predecessor,
 * line intent or Task link) is refused. Product rule: a closed line takes no new work; its Goals, Sessions and Runs
 * stay readable and its Goals keep claiming. The Goal and Session owners call it after their receipt lookup, so an
 * earlier creation replays. `null`: the named folder is an open line, or no line this read can tell (the owner's own
 * read answers that).
 */
export async function closedLineRefusal(records: Pick<GoalRecordTransactionPort, 'readMany'>,
  scope: { projectId: string; workspaceId: string }, lineFolder: string): Promise<CoreRejection | null> {
  const line = await readLineRecord(records, scope.projectId, scope.workspaceId, lineFolder);
  return line.status === 'ready' && line.value.status !== 'open'
    ? rejected('invalid', 'a closed line does not take new work') : null;
}
