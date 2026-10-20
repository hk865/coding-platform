/**
 * Slice 5 §2.5/§2.8/§4.1: the ONE `NoticePositionV1` order and page point (F45).
 *
 * Ordering (spec §2.5): pairs order by ledger cursor then `itemKey`. This file
 * is the only ReadModelIndex comparison point: it is the only place allowed to
 * call `contracts/ledger.ts:seqOfCommitCursor`.
 * Other layers never parse a cursor; `state/` receives the service-computed
 * movement.
 */
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type {
  NoticeCategoryV1,
  NoticePositionV1,
} from '../../../contracts/goal-decisions.js';
import type {
  NoticeItemV1,
  NoticePositionComparatorPort,
} from '../model/decision-contracts.js';

/** One notice source's already-`after`-filtered items, awaiting the stable merge. */
export type NoticeSourceItemsV1 = {
  category: NoticeCategoryV1;
  items: readonly NoticeItemV1[];
};

/** The merged page: the first `limit` items and the exclusive watermark per category. */
export type NoticeMergedPageV1 = {
  items: NoticeItemV1[];
  nextAfter: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
};

function compareText(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The injected comparator; its `compare` is the only order the owners may use. */
export function createNoticePositionComparator(): NoticePositionComparatorPort {
  return { compare: compareNoticePositions };
}

/** The named comparison the factory delegates to; the unique cursor parse point. */
export function compareNoticePositions(
  a: NoticePositionV1,
  b: NoticePositionV1,
): -1 | 0 | 1 {
  // The one permitted cursor parse: compare by ledger sequence, then itemKey.
  const bySequence = seqOfCommitCursor(a.cursor) - seqOfCommitCursor(b.cursor);
  return bySequence !== 0 ? (bySequence < 0 ? -1 : 1) : compareText(a.itemKey, b.itemKey);
}

/**
 * §2.5: stably merge per-category pages, cap at `limit` and return the last
 * DISPLAYED position per category; items not displayed never advance it and an
 * unshown source item can never cross the page.
 */
export function mergeNoticePages(
  pages: readonly NoticeSourceItemsV1[],
  limit: number,
): NoticeMergedPageV1 {
  const ordered = pages.flatMap((page) => page.items.map((item, index) => ({ item, index })));
  ordered.sort((left, right) => {
    const byPosition = compareNoticePositions(left.item.position, right.item.position);
    return byPosition !== 0 ? byPosition : left.index - right.index;
  });
  const bounded = Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
  const items = ordered.slice(0, bounded).map((entry) => entry.item);
  const nextAfter: Partial<Record<NoticeCategoryV1, NoticePositionV1>> = {};
  for (const item of items) nextAfter[item.category] = item.position;
  return { items, nextAfter };
}
