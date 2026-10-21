# A6 static byte proof 2: the wrapper is the only new logic

## New wrapper (`src/core/work-graph/tasks/run-activity-service.ts:134-152`)

```ts
// --------------------------------------------------------------------------
// L4: RunActivitySnapshot adapter over the shared replacement rule
// --------------------------------------------------------------------------

/**
 * The rule itself lives in `state/activity-replacement.ts` and takes the two
 * facts values. This wrapper is the only adaptation: `existing === null ?
 * null : existing.facts` keeps "no record" distinct from a present record
 * (whose `facts` the type always has); `existing?.facts ?? null` would widen
 * "no record" to "no facts".
 */
export function decideRunActivityOutcome(
  existing: RunActivitySnapshot | null,
  incoming: RunActivityFactsV1,
  endCommit: boolean,
): RunActivityWriteOutcome {
  return decideActivityOutcome(existing === null ? null : existing.facts, incoming, endCommit);
}
```

`RunActivityWriteOutcome` is now `export type RunActivityWriteOutcome = ActivityWriteOutcome;`
(`run-activity-service.ts:77`), so both existing exports still name the same
three-value type.

## The only new logic

The moved function is called with `existing === null ? null : existing.facts`.
That ternary, plus the mechanical rename of the two signatures and the type
alias, is the entire new logic. It preserves the two distinct states the old
body distinguished:

- `existing === null` (no record) -> pass `null` -> `decideActivityOutcome` row 1 -> `created`;
- a present snapshot -> pass its `facts` -> the same six-step comparison on the same values.

`existing?.facts ?? null` is deliberately NOT used: it would collapse "a present
record whose facts were absent" into "no record", widening row 1 beyond its
meaning. `RunActivitySnapshot.facts` is non-optional, so the chosen expression
also stays total.

## Old call site unchanged

The base call site and the current one are textually identical:

```diff
base  run-activity-service.ts:188:    const outcome = decideRunActivityOutcome(input.existing, input.facts, input.endCommit);
now   run-activity-service.ts:173:    const outcome = decideRunActivityOutcome(input.existing, input.facts, input.endCommit);
```

`git diff` of `planRunActivity` and everything below it contains no change: the
wrapper is still called from `planRunActivity` exactly as before, with
`(input.existing, input.facts, input.endCommit)`; `planRunActivity` keeps its
reads, `unchanged` returning the old snapshot, the clock value it is given, and
the rest of the planned record. No Query caller was added.
