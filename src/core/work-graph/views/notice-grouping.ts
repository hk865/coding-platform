/**
 * Slice 4C-2 U9: the ONE pure notice grouping and the lead ruling 8 seenThrough
 * advance. It performs no I/O and owns no position comparison: `compareNoticePositions`
 * is the only order it uses. Input to `groupNotices` must already be position-sorted.
 */
import type { NoticeCategoryV1, NoticePositionV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { NoticeItemV1 } from '../model/decision-contracts.js';
import { compareNoticePositions } from './notice-position.js';

/**
 * `main_conversation` is the main read's grouping (slice-6-SPEC L6): everything
 * `user_affected_per_goal` does, and every Goal's automatic-rework notices fold
 * into one "n 条自动返工" line. The decision queue keeps them one by one.
 */
export type NoticeGroupingStrategyV1 = 'pass_through' | 'user_affected_per_goal' | 'main_conversation';

/**
 * One shown notice line. A folded automatic-rework line of the main read also
 * carries its members' own views, so opening it needs no second read.
 */
export type NoticeLineV1 = NoticeItemV1 & { memberViews?: NoticeItemV1[] };

type NoticeMember = { itemKey: string; position: NoticePositionV1 };

/** A line's member set: its `members` when folded, else the item itself. */
function membersOf(item: NoticeItemV1): NoticeMember[] {
  return item.members ?? [{ itemKey: item.itemKey, position: item.position }];
}

/** Canonical key so two equal GoalRefs always fold together. */
function goalKey(goalRef: GoalRef): string {
  return canonicalJson(goalRef as unknown as JsonValue);
}

/**
 * U9: raw items + strategy -> shown lines. `pass_through` returns the items
 * unchanged. `user_affected_per_goal` keeps every non-`note_review` item and
 * every own-line note (`user_affected`, `structural` or an absent class), and
 * folds the `scribe_result` notes into one line per Goal. `main_conversation`
 * also folds each Goal's `automatic_rework` notices into one line that lists
 * its members and carries their views.
 */
export function groupNotices(items: readonly NoticeItemV1[], strategy: NoticeGroupingStrategyV1): NoticeLineV1[] {
  if (strategy === 'pass_through') return items.slice();

  type Line = { item: NoticeLineV1; order: number };
  type FoldKind = 'scribe' | 'rework';
  type Folded = { kind: FoldKind; goalRef: GoalRef; members: NoticeMember[]; views: NoticeItemV1[];
    objects: NoticeItemV1['objects']; newest: NoticePositionV1; order: number };
  const lines: Line[] = [];
  const folded = new Map<string, Folded>();

  items.forEach((source, index) => {
    const kind: FoldKind | null = source.category === 'note_review' && source.noteClass === 'scribe_result' ? 'scribe'
      : strategy === 'main_conversation' && source.category === 'automatic_rework' ? 'rework' : null;
    if (kind === null) {
      lines.push({ item: source, order: index });
      return;
    }
    const key = `${kind}|${goalKey(source.goalRef)}`;
    const member: NoticeMember = { itemKey: source.itemKey, position: source.position };
    const existing = folded.get(key);
    if (existing === undefined) {
      folded.set(key, { kind, goalRef: source.goalRef, members: [member], views: [source], objects: [...source.objects],
        newest: source.position, order: index });
      return;
    }
    existing.members.push(member);
    existing.views.push(source);
    // Verifier §7: never spread an unbounded folded group into call arguments
    // (a folded line can hold every unseen scribe result for its Goal).
    for (const object of source.objects) existing.objects.push(object);
    // Items arrive position-sorted, but compare explicitly so the representative
    // position (and its order tiebreak) is always the newest member's.
    if (compareNoticePositions(source.position, existing.newest) >= 0) {
      existing.newest = source.position;
      existing.order = index;
    }
  });

  for (const entry of folded.values()) {
    const goal = `${entry.goalRef.projectId}/${entry.goalRef.goalId}`;
    lines.push({ order: entry.order, item: entry.kind === 'scribe' ? {
      itemKey: `note_review_scribe:${goal}`,
      category: 'note_review', goalRef: entry.goalRef, position: entry.newest,
      summary: `书记整理 · ${entry.members.length} 条注记`, objects: entry.objects,
      rework: null, members: entry.members,
    } : {
      itemKey: `automatic_rework_group:${goal}`,
      category: 'automatic_rework', goalRef: entry.goalRef, position: entry.newest,
      summary: `${entry.members.length} 条自动返工`, objects: entry.objects,
      rework: null, members: entry.members, memberViews: entry.views,
    } });
  }

  lines.sort((left, right) => {
    const byPosition = compareNoticePositions(left.item.position, right.item.position);
    return byPosition !== 0 ? byPosition : left.order - right.order;
  });
  return lines.map((line) => line.item);
}

/**
 * Lead ruling 8: advance seen positions only over the members actually shown.
 * For each category, take its ordered member list from `all`; walk it from the
 * lowest position while every member is shown by a `displayed` line, and report
 * the highest fully-covered position. A category with no shown member is absent;
 * a category whose lines carry no `members` reduces to the last displayed item.
 */
export function seenThroughOfNotices(all: readonly NoticeItemV1[],
  displayed: readonly NoticeItemV1[]): Partial<Record<NoticeCategoryV1, NoticePositionV1>> {
  const shownKeys = new Set<string>();
  for (const line of displayed) {
    for (const member of membersOf(line)) shownKeys.add(member.itemKey);
  }

  const byCategory = new Map<NoticeCategoryV1, NoticeMember[]>();
  for (const item of all) {
    const list = byCategory.get(item.category) ?? [];
    // Verifier §7: same unbounded-spread fix as the folded `objects` above.
    for (const member of membersOf(item)) list.push(member);
    byCategory.set(item.category, list);
  }

  const seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>> = {};
  for (const [category, list] of byCategory) {
    list.sort((left, right) => compareNoticePositions(left.position, right.position));
    let highest: NoticePositionV1 | undefined;
    for (const member of list) {
      if (!shownKeys.has(member.itemKey)) break;
      highest = member.position;
    }
    if (highest !== undefined) seenThrough[category] = highest;
  }
  return seenThrough;
}

/**
 * One Goal's notice lines out of `all`, the full ordered line set of the
 * workspace (every category read, after the seen positions, before any Goal
 * filter), and the advance those lines allow. The advance walks the full member
 * set, so a member of another Goal between two shown members stops it there: a
 * mark of this page never passes a member it did not show.
 */
export function goalNoticePage(all: readonly NoticeLineV1[], goalRef: GoalRef): {
  lines: NoticeLineV1[]; seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
} {
  const key = goalKey(goalRef);
  const lines = all.filter((line) => goalKey(line.goalRef) === key);
  return { lines, seenThrough: seenThroughOfNotices(all, lines) };
}
