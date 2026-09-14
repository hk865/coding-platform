import type { DispatchBacklog, DispatchOutboxEntrySnapshot } from './dispatch.js';

/** One interpretation of the durable pending window for drive results and UI. */
export function dispatchBacklog(entries: readonly DispatchOutboxEntrySnapshot[], now: string): DispatchBacklog {
  const oldestPendingAt = entries.map(e => e.pendingAt).sort()[0] ?? null;
  return {
    pending: entries.length,
    due: entries.filter(e => !e.schedule?.quarantined && (!e.schedule || e.schedule.availableAt <= now)).length,
    delayed: entries.filter(e => !e.schedule?.quarantined && e.schedule && e.schedule.availableAt > now).length,
    quarantined: entries.filter(e => e.schedule?.quarantined).length,
    oldestPendingAt, oldestPendingAgeMs: oldestPendingAt ? Math.max(0, Date.parse(now) - Date.parse(oldestPendingAt)) : null,
    nextAvailableAt: entries.filter(e => !e.schedule?.quarantined).map(e => e.schedule?.availableAt ?? e.pendingAt).sort()[0] ?? null,
    blocked: entries.filter(e => e.schedule).slice(0, 32).map(e => ({ intentId: e.intent.intentId,
      reason: e.schedule!.lastFailure, availableAt: e.schedule!.availableAt, quarantined: e.schedule!.quarantined })),
  };
}

export type DispatchBacklogView =
  | { status: 'ready'; observedAt: string; backlog: DispatchBacklog }
  | { status: 'unavailable'; observedAt: string; reason: string };
