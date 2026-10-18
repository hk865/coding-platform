Read-only verify of rework 4 (the last) of slice 8 L8 in this repository copy (HEAD = tag `s8l8-r4`; previous round `s8l8-r3`). Answer in Chinese, at most about 900 words. Do not write any file, do not run tests (the bubblewrap run is the lead's).

Inputs under `./.lead-ref/`: the book `l8-rework-4.md` (rows P1, P2, P3, D, R; the product owner limited this round to these rows, so do not re-open the others); your verification of rework 3 `l8-verify3.out.md` (`V3§n`) and your check of this book `l8-book6.out.md`; this round's diff `l8-rework4.diff` and `l8-rework4-stat.txt`; the round ledger `d1-round.txt` (`s8l8-r3..s8l8-r4`) and `d1-cumulative.txt`; the reply `l8-rework4-final.md` (claims, not evidence); `test-rule-sheet.md`.

1. Per row P1, P2, P3, D, R: fixed (file:line of the fix, the proving test file:line) / partly (what is missing) / not. For P1 and P2 trace every exit of `captureSourceChanges` after the capture is published: is the capture released on each, does a committed receipt keep its result, does a non-cancel throw stay a throw when the signal is set only during the cleanup, and did the change open any new exit that returns ready, cancelled or a throw wrongly? For P3, every await and exit of `readArchiveChangedFiles`.
2. Per line of `d1-round.txt` (51 lines): belongs to row D (one of the 15 deleted cases or their helpers) / something else (a weakening). Check that no kept row of `S8A-L8-capture-start.test.ts` lost a check.
3. Every ADDED test line: new instances of rule-sheet F1–F12 (hand-built platform values, copied production behavior, timed polls proving a non-event, expected values from `src` constants). The reply's UNSPECIFIED: P3 runs SQLite only because `tests/helpers/S1-runtime-scenario-fixture.ts:159` fixes the backend; is that true?
4. Production defects this round introduced, if any.

End with one line: rows fixed / partly / not; ledger weakenings; new rule-sheet instances; production defects.
