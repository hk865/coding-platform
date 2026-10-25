/**
 * The one activity record of a Session (`../../../contracts/session-activity.ts`):
 * when the Session last received input or ended an entered round, and which
 * committed fact did it.
 *
 * `nextSessionActivity` builds the record that the causing fact writes as a
 * companion fragment in its own commit. Its revision advances once per
 * activity, so two activities in one millisecond each advance it. Its
 * `lastActivityAt` never moves backwards. Its `kind` and `source` are the
 * committing fact's while the fact is not older than the instant it replaces,
 * so a fact that arrives late cannot rewrite what happened later.
 *
 * Pure: imports only `src/contracts` and this directory (§14.4).
 */
import type { SessionRef } from '../../../contracts/core/identity.js';
import type {
  SessionActivityKindV1, SessionActivityRef, SessionActivitySourceV1, SessionActivityV1,
} from '../../../contracts/session-activity.js';

/**
 * The line card's clock (L10): the latest of the Session's creation, the
 * caller's instants and nothing else. ISO instants compare as UTC strings; an
 * absent instant is ignored, and an empty/earlier set falls back to `createdAt`.
 */
export function latestActivityAt(createdAt: string, instants: readonly (string | null | undefined)[]): string {
  let latest = createdAt;
  for (const instant of instants) {
    if (instant === null || instant === undefined) continue;
    if (instant > latest) latest = instant;
  }
  return latest;
}

/**
 * The activity record after one committing fact: one revision further, the
 * latest activity instant, and the fact's kind and source when the fact is not
 * older than the record it replaces (an absent record counts as the Session's
 * creation time). A fact older than the record therefore keeps the kind and
 * source the record already reported.
 */
export function nextSessionActivity(input: {
  current: SessionActivityV1 | null; ref: SessionActivityRef; session: SessionRef; sessionCreatedAt: string;
  at: string; kind: SessionActivityKindV1; source: SessionActivitySourceV1;
}): SessionActivityV1 {
  const previous = input.current;
  const previousAt = previous?.lastActivityAt ?? input.sessionCreatedAt;
  // The record the new fact does not replace: older than the recorded instant, the fact keeps it.
  const kept = previous !== null && input.at < previousAt ? previous : null;
  return {
    ref: input.ref,
    revision: (previous?.revision ?? 0) + 1,
    session: input.session,
    lastActivityAt: latestActivityAt(previousAt, [input.at]),
    kind: kept === null ? input.kind : kept.kind,
    source: kept === null ? input.source : kept.source,
  };
}
