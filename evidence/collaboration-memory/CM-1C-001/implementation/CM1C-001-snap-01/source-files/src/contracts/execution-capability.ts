/**
 * B-1: the host's explicit execution capability, as one shared fact.
 *
 * The real/fixture decision must never be inferred from an identifier shape
 * (a `planId` prefix, a run-id format, "this does not look real"). The
 * composition root states it once here, the HTTP layer serves that value, and
 * the UI renders from it. `fixtureEnabled` is true only when the host
 * explicitly enables the fixture executor.
 */
export type ExecutionCapabilityV1 = {
  executor: 'coding-agent' | 'fixture';
  /** Where the declaration came from; `source=runtime` facts never mean a run
   *  executed. This is a configuration statement, not an observation. */
  source: 'configured-runtime' | 'explicit-fixture-service';
  /** True only when the host explicitly enabled fixture execution. A host that
   *  merely lacks a configured runtime must not silently fall back to fixtures. */
  fixtureEnabled: boolean;
};
