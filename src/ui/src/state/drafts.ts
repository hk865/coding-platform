/**
 * Per-goal drafts and file references. Display-layer state: a draft is never a
 * committed task, and a reference is only a claim until the server re-validates
 * the path and digest on submit.
 */
import type { GoalScope, RequestReference, Scope } from '../api/types';

export const DRAFT_KEY_PREFIX = 'agent-platform.workbench.drafts.v2';

export function goalKey(scope: GoalScope): string { return [scope.projectId, scope.workspaceId, scope.goalId].map(encodeURIComponent).join('::'); }
export function scopeKey(scope: Scope): string { return [scope.projectId, scope.workspaceId].map(encodeURIComponent).join('::'); }

export type DraftState = { instruction: string; references: RequestReference[]; allowWrite: boolean };
export type DraftMap = Record<string, DraftState>;

export function readDrafts(storage: Storage): DraftMap {
  try {
    const raw = storage.getItem(DRAFT_KEY_PREFIX);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: DraftMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const draft = value as Partial<DraftState>;
      result[key] = {
        instruction: typeof draft.instruction === 'string' ? draft.instruction : '',
        allowWrite: draft.allowWrite === true,
        references: Array.isArray(draft.references)
          ? draft.references.filter((ref): ref is RequestReference => !!ref && typeof ref === 'object' && typeof (ref as RequestReference).path === 'string' && typeof (ref as RequestReference).sha256 === 'string').slice(0, 8)
          : [],
      };
    }
    return result;
  } catch { return {}; }
}

export function writeDrafts(storage: Storage, drafts: DraftMap): void {
  try { storage.setItem(DRAFT_KEY_PREFIX, JSON.stringify(drafts)); } catch { /* storage may be unavailable; drafts stay in memory */ }
}

export function emptyDraft(): DraftState { return { instruction: '', references: [], allowWrite: false }; }

export function upsertReference(references: RequestReference[], reference: RequestReference): { references: RequestReference[]; replaced: boolean; overflow: boolean } {
  const index = references.findIndex(item => item.path === reference.path);
  if (index >= 0) {
    const next = [...references];
    next[index] = reference;
    return { references: next, replaced: true, overflow: false };
  }
  if (references.length >= 8) return { references, replaced: false, overflow: true };
  return { references: [...references, reference], replaced: false, overflow: false };
}

/** A reference is stale when the digest we captured no longer matches the file. */
export function referenceState(reference: RequestReference, currentDigest: string | null): 'current' | 'stale' | 'unknown' {
  if (!currentDigest) return 'unknown';
  return currentDigest === reference.sha256 ? 'current' : 'stale';
}

export function formatLines(lines: { start: number; end: number } | undefined): string {
  if (!lines) return '';
  return lines.start === lines.end ? `L${lines.start}` : `L${lines.start}-${lines.end}`;
}
