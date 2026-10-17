/**
 * Slice 4B L19/P8: the two version lists. `listPlanVersions` reads one Goal's
 * `PlanRevision` rows through the 2B index (`s2b-plan-revision-by-goal`, ordered
 * by `acceptedAt`) and attaches the accepted candidate's recorded reason when it
 * has one (an older legacy adoption has none, so it says so instead of
 * inventing one). `listCatalogVersions` reads the project's
 * `ArchitectureCatalog` rows through the new revision-ordered index.
 *
 * P2/R14, 8A: a catalog revision row binds the commit cursor of its
 * `ArchitectureCatalogRevised` event, so it carries the real `occurredAt` and
 * reason. A row written before 8A (and the initial adoption) has no binding and
 * keeps `at: null`, `reason: null` and the post-note label.
 * The list is newest first (revision descending), at most 50 per page, and a
 * cursor binds the request so a changed request is `cursor_mismatch`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { NoteErrorCode, VersionListPageV1 } from '../model/note-contracts.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { OrderedLookupValue, RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import {
  PLAN_PROPOSAL_LOOKUP_INDEX, S2B_PLAN_REVISION_BY_GOAL_LOOKUP, decodePlanProposalRecord, decodePlanRevisionSnapshot,
} from '../persistence/plan-record-codecs.js';
import { S4B_CATALOG_REVISION_BY_PROJECT_LOOKUP, decodeArchitectureCatalogRecord,
  decodeArchitectureCatalogRevisedEvent } from '../architecture/catalog-record-codecs.js';

export const VERSION_LIST_PAGE_MAX = 50;
export const CATALOG_REASON_LABEL = '原因记在目录修订里，第 8 片接上后显示';
export const PLAN_REASON_MISSING_LABEL = '没有记下原因';

export type VersionListDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
};

export type PlanVersionsInput = { goalId: string; limit: number; cursor: string | null };
export type CatalogVersionsInput = { limit: number; cursor: string | null };

type CursorState = { order: OrderedLookupValue; refKey: string };

function rejected(code: NoteErrorCode, reason: string): { status: 'rejected'; code: NoteErrorCode; reason: string } {
  return { status: 'rejected', code, reason };
}

function pageLimit(limit: number): number | null {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > VERSION_LIST_PAGE_MAX) return null;
  return limit;
}

function parseCursor(cursor: string | null, bind: Record<string, unknown>): CursorState | null | 'mismatch' {
  if (cursor === null) return null;
  try {
    const parsed = JSON.parse(cursor) as Record<string, unknown>;
    if (parsed['v'] !== 1) return 'mismatch';
    for (const [key, value] of Object.entries(bind)) {
      if (parsed[key] !== value) return 'mismatch';
    }
    const after = parsed['after'];
    if (typeof after !== 'object' || after === null) return 'mismatch';
    const order = (after as Record<string, unknown>)['order'];
    const refKey = (after as Record<string, unknown>)['refKey'];
    if ((typeof order !== 'string' && typeof order !== 'number') || typeof refKey !== 'string') return 'mismatch';
    return { order, refKey };
  } catch {
    return 'mismatch';
  }
}

function cursorOf(bind: Record<string, unknown>, state: CursorState): string {
  return JSON.stringify({ v: 1, ...bind, after: { order: state.order, refKey: state.refKey } });
}

export function createVersionLists(deps: VersionListDependencies): {
  listPlanVersions(ctx: CoreCallContext, input: PlanVersionsInput): Promise<ReadResult<VersionListPageV1>>;
  listCatalogVersions(ctx: CoreCallContext, input: CatalogVersionsInput): Promise<ReadResult<VersionListPageV1>>;
} {
  /** draft.planId -> change reason, from the accepted candidate proposals of one Goal. */
  async function planReasons(ctx: CoreCallContext, goalId: string): Promise<
  { ok: true; value: Map<string, string> } | { ok: false; code: NoteErrorCode; reason: string }> {
    const reasons = new Map<string, string>();
    let after: string | undefined;
    for (;;) {
      const page = await deps.records.lookup({ index: PLAN_PROPOSAL_LOOKUP_INDEX,
        values: [ctx.projectId, goalId], ...(after === undefined ? {} : { after }), limit: 200 });
      if (page.status !== 'ready') return { ok: false, code: 'unavailable', reason: page.reason };
      for (const record of page.value.records) {
        const decoded = decodePlanProposalRecord(record);
        // §9: a damaged proposal record is `unavailable`, never skipped silently.
        if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'a plan proposal record is damaged' };
        const proposal = decoded.value;
        if (proposal.kind !== 'candidate_v2' || proposal.status !== 'accepted') continue;
        // R14/L19: the reason is the candidate's recorded change reason; the
        // initial adoption records one too, so it is shown rather than hidden.
        const text = proposal.reason?.text;
        if (typeof text === 'string') reasons.set(proposal.draft.planId, text);
      }
      if (page.value.next === null) return { ok: true, value: reasons };
      after = page.value.next;
    }
  }

  return {
    async listPlanVersions(ctx, input) {
      const limit = pageLimit(input.limit);
      if (limit === null) return rejected('invalid', 'limit must be 1–50');
      if (typeof input.goalId !== 'string' || input.goalId.length === 0) return rejected('invalid', 'a goal id is required');
      const bind = { op: 'plan_versions', goalId: input.goalId, limit };
      const parsed = parseCursor(input.cursor, bind);
      if (parsed === 'mismatch') return rejected('invalid', 'cursor_mismatch');
      const reasons = await planReasons(ctx, input.goalId);
      if (!reasons.ok) return rejected(reasons.code, reasons.reason);
      const page = await deps.records.lookupOrdered({ index: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
        values: [ctx.projectId, input.goalId], direction: 'desc', ...(parsed === null ? {} : { after: parsed }), limit });
      if (page.status !== 'ready') return rejected('unavailable', page.reason);
      const items = page.value.records.map(record => {
        const decoded = decodePlanRevisionSnapshot(record);
        if (decoded.status !== 'decoded') return null;
        const plan = decoded.value;
        const reason = reasons.value.get(plan.ref.planId) ?? null;
        return { revision: plan.planRevision, at: plan.acceptedAt, reason,
          reasonLabel: reason ?? PLAN_REASON_MISSING_LABEL };
      });
      if (items.some(item => item === null)) return rejected('unavailable', 'a plan revision record is damaged');
      const next = page.value.next === null ? null : cursorOf(bind, page.value.next);
      return { status: 'ready', value: { items: items as VersionListPageV1['items'], next, complete: next === null } };
    },

    async listCatalogVersions(ctx, input) {
      const limit = pageLimit(input.limit);
      if (limit === null) return rejected('invalid', 'limit must be 1–50');
      const bind = { op: 'catalog_versions', limit };
      const parsed = parseCursor(input.cursor, bind);
      if (parsed === 'mismatch') return rejected('invalid', 'cursor_mismatch');
      const page = await deps.records.lookupOrdered({ index: S4B_CATALOG_REVISION_BY_PROJECT_LOOKUP,
        values: [ctx.projectId], direction: 'desc', ...(parsed === null ? {} : { after: parsed }), limit });
      if (page.status !== 'ready') return rejected('unavailable', page.reason);
      const items: VersionListPageV1['items'] = [];
      for (const record of page.value.records) {
        const decoded = decodeArchitectureCatalogRecord(record);
        if (decoded.status !== 'decoded') return rejected('unavailable', 'a catalog revision record is damaged');
        const since = decoded.value.since;
        // R14/P2: a row written before 8A (and the initial adoption) has no
        // binding, so there is no time to show; keep the post-note label.
        if (since === null) {
          items.push({ revision: decoded.value.ref.revision, at: null, reason: null,
            reasonLabel: CATALOG_REASON_LABEL });
          continue;
        }
        // 8A (decision 72 post-note 4B ①): the row binds the cursor of the commit
        // that wrote it; read that one event for the real time and reason. A
        // failed or damaged read is `unavailable`, never a silent null.
        const located = await deps.records.eventAt(since);
        if (located.status !== 'ready') return rejected('unavailable', located.reason);
        const revised = decodeArchitectureCatalogRevisedEvent(located.value.event);
        if (revised.status !== 'decoded') return rejected('unavailable', 'the catalog revised event is damaged');
        items.push({ revision: decoded.value.ref.revision, at: revised.value.occurredAt,
          reason: revised.value.reason, reasonLabel: revised.value.reason });
      }
      const next = page.value.next === null ? null : cursorOf(bind, page.value.next);
      return { status: 'ready', value: { items, next, complete: next === null } };
    },
  };
}
