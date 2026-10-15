/**
 * Slice 2B BE3 "counting off" double (spec §7/F34): a test-only `vi.mock` of
 * `src/core/agent-runtime/run-activity-tally.ts` and
 * `.../run-activity-reader.ts`.
 *
 * While `off.off` is true:
 *   - `tallyTurnActivity` answers `undefined`, so an end commit built from the
 *     decoded window carries no `activity` and writes no `RunActivity`;
 *   - `readRunActivityFacts` answers `{ kind: 'retry_later' }`, so the automatic
 *     backfill writes nothing.
 *
 * Every other export is the real one. Production code is never changed. The
 * factories are called from an async `vi.mock` factory through a lazy `import`,
 * so the double itself is never hoisted.
 */
export function countingOffTallyModule<T extends Record<string, unknown>>(actual: T, off: { off: boolean }): T {
  return { ...actual, tallyTurnActivity: (...args: unknown[]) =>
    off.off ? undefined : (actual['tallyTurnActivity'] as (...a: unknown[]) => unknown)(...args) } as T;
}

export function countingOffReaderModule<T extends Record<string, unknown>>(actual: T, off: { off: boolean }): T {
  return { ...actual, readRunActivityFacts: (...args: unknown[]) =>
    off.off ? { kind: 'retry_later', reason: 'S2B counting off' }
      : (actual['readRunActivityFacts'] as (...a: unknown[]) => unknown)(...args) } as T;
}
