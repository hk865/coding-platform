/**
 * The `project_notice` read source: one item per `ProjectNotice@1` record, read only.
 *
 * The read follows the notice protocol: the watermark is read first and reported as `sourceCursor` (a later read
 * never advances it), the ordered `project-notices-by-project` index is read from the saved position inclusively to
 * the end, and a damaged record or one whose `since` is missing or below the saved position is `unavailable` — never
 * silently skipped. A Goal-filtered read keeps the notices whose stored subject is that Goal; the paging is the
 * same. There is no window, no merge and no summary record; grouping is `groupNotices`'s.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { PROJECT_NOTICES_BY_PROJECT_LOOKUP } from '../../../contracts/role-lines.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type {
  DecisionNoticeSourcePort, DecisionSourcePageV1, NoticeItemV1,
} from '../model/decision-contracts.js';
import { projectNoticeCodec } from '../sessions/role-line-record-codecs.js';
import { paginateAssembled, readOrderedToEnd, type ReadPageInput } from './automatic-rework-notices.js';
import { readWatermark, storeFailureToRejection } from './goal-conflicts.js';
import { compareNoticePositions } from './notice-position.js';

/**
 * The read-only RecordStore seam. The ordered port is part of the dependency TYPE (no runtime probe); `lookup` joins
 * it because `readWatermark` needs the ordinary lookup port.
 */
export type ProjectNoticeSourceDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany'> & RecordOrderedLookupPort & RecordLookupPort;
  /** The page width of the ordered read (default 200). */
  orderedPageLimit?: number;
};

const ORDERED_PAGE_LIMIT = 200;

/** Builds the `project_notice` notice source; the factory itself never throws. */
export function createProjectNoticeSource(deps: ProjectNoticeSourceDependencies): DecisionNoticeSourcePort {
  return {
    category: 'project_notice',
    async readPage(ctx, input): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
      return readProjectNoticePage(deps.records, ctx, input, deps.orderedPageLimit ?? ORDERED_PAGE_LIMIT);
    },
  };
}

async function readProjectNoticePage(
  records: ProjectNoticeSourceDependencies['records'],
  _ctx: CoreCallContext,
  input: ReadPageInput,
  orderedPageLimit: number,
): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
  const watermarkRead = await readWatermark(records);
  if (watermarkRead.status !== 'ready') return watermarkRead;
  const watermark = watermarkRead.value;
  const projectId = input.workspace.projectId;
  const seen: CommitCursor | null = input.after === undefined ? null : input.after.cursor;
  const recordsWindow: EncodedRecord[] = [];
  try {
    recordsWindow.push(...await readOrderedToEnd(records, PROJECT_NOTICES_BY_PROJECT_LOOKUP, [projectId],
      seen === null ? null : { value: seen, inclusive: true }, orderedPageLimit));
  } catch (error) {
    return storeFailureToRejection(error);
  }
  const items: NoticeItemV1[] = [];
  for (const record of recordsWindow) {
    const decoded = projectNoticeCodec.decode(record);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `project notice ${record.refKey}: ${decoded.reason}`);
    }
    const notice = decoded.value;
    const since = notice.since;
    if (typeof since !== 'string' || since.length === 0) {
      return rejected('unavailable', `project notice ${record.refKey} has no commit position`);
    }
    if (seen !== null && since < seen) {
      return rejected('unavailable', `project notice ${record.refKey} is outside the requested window`);
    }
    if (input.goalRef !== undefined && (notice.subject.kind !== 'goal'
      || notice.subject.goalRef.goalId !== input.goalRef.goalId)) continue;
    const itemKey = `project_notice:${notice.ref.noticeId}`;
    const noticeKind = notice.kind === 'knowledge_write_unconfirmed' || notice.kind === 'knowledge_reverted'
      || notice.kind === 'knowledge_conflict' ? notice.kind : null;
    items.push({ itemKey, category: 'project_notice', subject: notice.subject, summary: notice.summary,
      position: { kind: 'commit', cursor: since, itemKey }, objects: [], rework: null,
      ...(noticeKind === null ? {} : { noticeKind }) });
  }
  items.sort((left, right) => {
    const byPosition = compareNoticePositions(left.position, right.position);
    return byPosition !== 0 ? byPosition : (left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0);
  });
  const after = input.after;
  const remaining = after === undefined ? items : items.filter((item) => compareNoticePositions(item.position, after) > 0);
  return paginateAssembled({ watermark, remaining }, input);
}
