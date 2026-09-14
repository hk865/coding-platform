import type { DispatchOutboxEntrySnapshot } from '../../contracts/dispatch.js';
import type { PendingDispatchSelection } from '../../contracts/ledger.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

/** Storage-independent selection. Apply before limiting the pending window. */
export function matchesDispatchSelection(entry: DispatchOutboxEntrySnapshot, selection?: PendingDispatchSelection, replacement = false): boolean {
  return entry.status === 'pending' &&
    (selection?.includeQuarantined === true || !entry.schedule?.quarantined) &&
    (!selection?.dueAt || !entry.schedule || entry.schedule.availableAt <= selection.dueAt) &&
    (!selection?.workKind || (entry.intent.work?.kind === 'review' ? 'review' : replacement ? 'replacement' : 'ordinary') === selection.workKind) &&
    (!selection?.scope || (entry.intent.projectId === selection.scope.projectId && entry.intent.goalId === selection.scope.goalId));
}

export function comparePendingDispatch(a: DispatchOutboxEntrySnapshot, b: DispatchOutboxEntrySnapshot): number {
  return (a.schedule?.availableAt ?? a.pendingAt).localeCompare(b.schedule?.availableAt ?? b.pendingAt) ||
    a.pendingAt.localeCompare(b.pendingAt) || canonicalJson(a.ref).localeCompare(canonicalJson(b.ref));
}
