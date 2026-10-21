# A6 — activity replacement rule into `state/` (book §5.5)

## Result

The rule comment and the six-step decision moved from
`src/core/work-graph/tasks/run-activity-service.ts` into the new
`src/core/work-graph/state/activity-replacement.ts` as
`decideActivityOutcome(existing: RunActivityFactsV1 | null, incoming:
RunActivityFactsV1, endCommit: boolean): ActivityWriteOutcome`.

`run-activity-service.ts` keeps both existing exports:

- `RunActivityWriteOutcome = ActivityWriteOutcome` (line 77);
- `decideRunActivityOutcome(existing: RunActivitySnapshot | null, …)` as the
  wrapper (lines 146-152), still called by `planRunActivity` (line 173) with the
  identical argument list; the wrapper passes
  `existing === null ? null : existing.facts`.

No Query wiring, no contract/codec/end-commit-owner change.

## Old / new line numbers

| Piece | Base (`s85-base` = e94d7b9) | Result |
|---|---|---|
| rule comment | `run-activity-service.ts:138-150` | `state/activity-replacement.ts:10-22` |
| decision function | `run-activity-service.ts:151-167` | `state/activity-replacement.ts:23-39` |
| decision body (six steps) | `run-activity-service.ts:156-167` | `state/activity-replacement.ts:28-39` |
| type alias | `run-activity-service.ts:76` | `run-activity-service.ts:77` (now `= ActivityWriteOutcome`) |
| wrapper | — (old function was here) | `run-activity-service.ts:134-152` |
| `planRunActivity` call | `run-activity-service.ts:188` | `run-activity-service.ts:173` (text identical) |

## Static proof

1. `decision-diff.txt` — full old-vs-new diff, plus an expression-only proof:
   after normalizing ONLY `const old = existing.facts;` to
   `const old = existing;`, old body (base 156-167) and new body (module 28-39)
   are byte-identical: both SHA-256
   `e49eb47ac86bab62a6603fff2d35b7b4d821b5fbd5b12087f83177d8b1bf7780`,
   `cmp` exit 0. The comment is byte-identical in the full diff; the only other
   lines that differ are the mandated function/parameter/return-type names.
2. `wrapper.md` — wrapper text, the argument that the
   `existing === null ? null : existing.facts` ternary is the only new logic
   (and why `existing?.facts ?? null` is rejected), and the unchanged
   `planRunActivity` call site.

## Pure-function constraints

`state/activity-replacement.ts` reads only its two arguments, calls no clock and
writes nothing. Its only import is `import type { RunActivityFactsV1 } from
'../../../contracts/run-activity.js'` (book §4 import direction). The six-step
order, short-circuits, and absence of new checks/detail/totals comparisons are
shown by the expression-only byte proof.

`planRunActivity`, the end-commit helper (`planRunActivityForCommit`), and the
backfill path keep their reads, `now()`/event ids, receipts, guards, event JSON
and record ordering exactly (the tracked-file diff touches only the type alias,
the import, and the decision block).

## Scratch place

The run sheet's scratch root `/home/han001/dsh-work/s85-scratch/S2` does not
exist in this sandbox (`ls`: No such file or directory; `touch` under it:
No such file or directory). Artifacts therefore live under the writable
`/tmp/s85-scratch/S2/probes/a6/`, as the task instructed.

## Artifacts

- `/tmp/s85-scratch/S2/probes/a6/decision-diff.txt`
- `/tmp/s85-scratch/S2/probes/a6/wrapper.md`
- `/tmp/s85-scratch/S2/probes/a6/report.md`
- supporting extracts: `old-decision.txt`, `new-decision.txt`,
  `old-expression.txt`, `old-expression-normalized.txt`, `new-expression.txt`,
  `expression-normalized.diff` (empty)
