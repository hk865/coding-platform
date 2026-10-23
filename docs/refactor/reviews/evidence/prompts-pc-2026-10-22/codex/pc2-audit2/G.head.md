# PC-2 audit 2, part G: guard, entry and I-19 (rework 1)

Your part is `G`: `./.lead-ref/parts/G.diff` and `G-files.txt` (`state/context-input.ts`,
`execution-entry-service.ts`, the WorkGraph `queries/query-execution.ts`, `tests/state/**` including `invariants.ts`
and `invariants.test.ts`, `WP1-units-fixture.ts`, `K3-35-owner-manifest-trim`, `PC2-G-entry-guard`). Rows G-01 … G-09
(G-09 same as J-11).

**Look hardest at:** G-01 (the binding's order compared element for element with the frozen set's order for its call
kind, in Work and Query entries; a missing frozen order rejected); G-02 (two LF before the range); G-03 (raw byte
equality); G-04 (structure checked before the continuation verdict reads a range; `invalid` kept); G-05, G-06 (I-19
reads the frozen texts and tool list; range bounds); G-07; G-08. `tests/state/invariants.test.ts` gained 29 lines: is
that change asked for by a row and within §5.3's owner rules? DSH reply §1.6 says `invariants.test`'s beforeAll fails
with `finalize_first: round … open` on clean `af84802` too: read the test and say whether that is an environment
effect (no bubblewrap) or a real failure.
