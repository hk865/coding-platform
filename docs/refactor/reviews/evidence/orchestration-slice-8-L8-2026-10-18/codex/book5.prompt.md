Read-only quick check of a rework book before the build: `./.lead-ref/l8-rework-3.md` (slice 8 L8, rework 3; this copy is tag `s8l8-r2`). Answer in Chinese. Do not write any file, do not run tests. Your own verification of rework 2 is `./.lead-ref/l8-verify2.out.md` (the book cites it as `V§n`); the earlier book and rulings are `./.lead-ref/l8-rework-2.md`, the rule sheet `./.lead-ref/test-rule-sheet.md`.

Answer only for the book's §2 rulings 1–7 and its row table:
1. Every file:line the book cites: ok / wrong (the right place).
2. Each ruling: the functions it changes, ALL callers, ALL downstream readers of its value.
4. Reachability, STATIC: ruling 5 — after a real Host restart or a new driver round, does the driver retry a pending request with the same request identity, so that the early replay and the late restore of `requestAutoCapture`, `failAutoCapture` and `capture` are reachable without the test building the command? Give the public call sequence per branch, or "unreachable because file:line". Ruling 6 — counting record-store read calls and body read calls inside one `runtime.prepareExecution`, what are the numbers with no previous observation at 6 chunks and with one at 7 + 6 chunks (hand trace, file:line per call)? Ruling 7 — does `materials.openArtifact` with the Host context and `usage: 'historical_explanation'` open the prepared material, or where does it refuse? Row D — can a memory Host be reopened on the same backend through the A4 seam the repo already has (file:line)?
5. Rulings 2–4: each await × resolve / reject / throw / abort → the required outcome, and whether the wording leaves any branch to the implementer.
7. Conflicts with rework 2's rulings, the spec, the rule sheet, or between the rulings.

End with "buildable" or the exact clauses to fix, each with the wording you propose.
