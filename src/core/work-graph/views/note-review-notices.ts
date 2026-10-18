/**
 * Slice 4C-2 U9: the note-review "please be aware" projector.
 *
 * One `DecisionNoticeSourcePort` for category `note_review`. It reads the three
 * classified `NoteVersion` streams (`user_affected`, `structural`,
 * `scribe_result`) through the ordered `s4c2-note-version-notice` index, from the
 * saved seen commit position (inclusive), and projects one `NoticeItemV1` per
 * version with the note header and the disposition verb.
 *
 * It reads only: it never writes a disposition, wakes an owner or fabricates a
 * count. `goalId === null` versions carry no goal and are never a notice (7D2);
 * versions whose Goal is outside the requested Workspace are skipped too.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { renderNoteHeader, type NoteVersionSnapshot } from '../../../contracts/note.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type {
  DecisionNoticeSourcePort,
  DecisionSourceAttempt,
  DecisionSourcePageV1,
  NoticeItemV1,
} from '../model/decision-contracts.js';
import {
  decodeNoteVersionSnapshot,
  noteVersionRefKey,
  S4C2_NOTE_VERSION_NOTICE_LOOKUP,
} from '../persistence/note-record-codecs.js';
import { compareNoticePositions } from './notice-position.js';
import { listWorkspaceGoals, readWatermark, storeFailureToRejection, type DecisionReadRecordsPort } from './goal-conflicts.js';
import { readOrderedToEnd } from './automatic-rework-notices.js';

/** The three registered notice classes, in read order. */
const NOTE_NOTICE_CLASSES = ['user_affected', 'structural', 'scribe_result'] as const;

/**
 * The read-only RecordStore seam. The ordered port is part of the dependency
 * type, so the ordered read never probes or casts at runtime.
 */
export type NoteReviewNoticeSourceDependencies = {
  records: DecisionReadRecordsPort & RecordOrderedLookupPort;
};

/** Builds the `note_review` notice source; the factory itself never throws. */
export function createNoteReviewNoticeSource(
  deps: NoteReviewNoticeSourceDependencies,
): DecisionNoticeSourcePort {
  return {
    category: 'note_review',
    async readPage(ctx, input): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
      return readNoteReviewPage(deps.records, ctx, input);
    },
  };
}

type ReadPageInput = {
  workspace: { projectId: string; workspaceId: string };
  goalRef?: { aggregateType: 'Goal'; projectId: string; goalId: string };
  after?: NoticeItemV1['position'];
  page: { limit: number; cursor?: string; atLeastCursor?: unknown; attempt?: DecisionSourceAttempt };
};

/** §11.6: the disposition verb shown in the notice summary, by change kind. */
function noteChangeAction(kind: NoteVersionSnapshot['change']['kind']): string {
  switch (kind) {
    case 'write': return '写入';
    case 'review': return '审阅';
    case 'accept': return '收下';
    case 'reject': return '拒绝';
    case 'withdraw': return '撤下';
    case 'supersede': return '取代';
    case 'coexist': return '并存';
    case 'merge': return '合并';
  }
}

/** The `note_review` page: the saved seen position decides the window. */
async function readNoteReviewPage(
  records: NoteReviewNoticeSourceDependencies['records'],
  _ctx: CoreCallContext,
  input: ReadPageInput,
): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
  // L11: one assembly per window attempt, keyed by workspace + goal.
  const cache = input.page.attempt?.cache;
  const cacheKey = canonicalJson({ category: 'note_review', projectId: input.workspace.projectId,
    workspaceId: input.workspace.workspaceId, goalId: input.goalRef?.goalId ?? null } as unknown as JsonValue);
  const cached = cache?.get(cacheKey) as AssembledNoteReviewPage | undefined;
  if (cached !== undefined) return paginateAssembled(cached, input);

  const watermarkRead = await readWatermark(records);
  if (watermarkRead.status !== 'ready') return watermarkRead;
  const after = input.after;
  // A saved commit position reads the ordered part with the inclusive lower
  // bound; a legacy position (or none) reads from the start.
  const seenCursor = after !== undefined && after.kind === 'commit' ? after.cursor : null;

  const items: NoticeItemV1[] = [];
  try {
    // "Only goals of the workspace": resolve the Workspace's Goal ids once.
    const listed = await listWorkspaceGoals(records, input.workspace);
    const goalIds = new Set(listed.goals.map((goal) => goal.ref.goalId));
    for (const noticeClass of NOTE_NOTICE_CLASSES) {
      const recordsOfClass = await readOrderedToEnd(records, S4C2_NOTE_VERSION_NOTICE_LOOKUP, [input.workspace.projectId, noticeClass],
        seenCursor === null ? null : { value: seenCursor, inclusive: true });
      for (const record of recordsOfClass) {
        const decoded = decodeNoteVersionSnapshot(record);
        if (decoded.status !== 'decoded') {
          return rejected('unavailable', `note review version: ${decoded.reason}`);
        }
        const version = decoded.value;
        // `since` is `c` + zero-padded digits, so text order is commit order.
        if (typeof version.since !== 'string' || version.since.length === 0) {
          return rejected('unavailable', `note review version ${record.refKey} has no commit position`);
        }
        if (seenCursor !== null && version.since < seenCursor) {
          return rejected('unavailable', `note review version ${record.refKey} is outside the requested window`);
        }
        // 7D2: a version with no Goal is never a notice.
        if (version.goalId === null) continue;
        if (!goalIds.has(version.goalId)) continue;
        if (input.goalRef !== undefined && version.goalId !== input.goalRef.goalId) continue;
        const itemKey = `note_review:${noteVersionRefKey(version.ref)}`;
        const versionClass = version.noticeClass ?? noticeClass;
        items.push({
          itemKey, category: 'note_review',
          goalRef: { aggregateType: 'Goal', projectId: version.ref.projectId, goalId: version.goalId },
          position: { kind: 'commit', cursor: version.since, itemKey },
          summary: `注记 · ${noteChangeAction(version.change.kind)} · ${renderNoteHeader(version)}`,
          objects: [], rework: null, noteClass: versionClass,
        });
      }
    }
  } catch (error) {
    return storeFailureToRejection(error as { code: string; reason: string });
  }

  items.sort((left, right) => {
    const byPosition = compareNoticePositions(left.position, right.position);
    return byPosition !== 0 ? byPosition : (left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0);
  });
  const remaining = after === undefined ? items : items.filter((item) => compareNoticePositions(item.position, after) > 0);
  const assembled: AssembledNoteReviewPage = { watermark: watermarkRead.value, remaining };
  cache?.set(cacheKey, assembled);
  return paginateAssembled(assembled, input);
}

/** L11: what one window attempt assembled, shared by its internal pages. */
type AssembledNoteReviewPage = { watermark: CommitCursor | null; remaining: NoticeItemV1[] };

/** Serves one page of an already-assembled (and `after`-filtered) collection. */
function paginateAssembled(assembled: AssembledNoteReviewPage, input: ReadPageInput): {
  status: 'ready'; value: DecisionSourcePageV1<NoticeItemV1>;
} {
  const offset = input.page.cursor === undefined ? 0 : Number(input.page.cursor);
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const limit = Number.isSafeInteger(input.page.limit) && input.page.limit > 0 ? input.page.limit : 50;
  const end = Math.min(assembled.remaining.length, start + limit);
  return { status: 'ready', value: {
    availability: 'available',
    items: assembled.remaining.slice(start, end),
    nextCursor: end < assembled.remaining.length ? String(end) : null,
    sourceCursor: assembled.watermark,
  } };
}
