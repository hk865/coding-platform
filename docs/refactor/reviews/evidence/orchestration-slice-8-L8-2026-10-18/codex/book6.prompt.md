Quick read-only check of a rework book before the build: `./.lead-ref/l8-rework-4.md` (slice 8 L8, the last rework; this copy is tag `s8l8-r3`). Answer in Chinese, at most about 900 words. Do not write any file, do not run tests.

Inputs: the book; your verification of rework 3 `./.lead-ref/l8-verify3.out.md` (`V3§n`); `./.lead-ref/l8-rework-3.md` (its rulings 2–4 bind); `./.lead-ref/test-rule-sheet.md`; the code.

The product owner decided this round does only the rows in the book; the other partly rows go to a later round by decision. Do not argue for them. Answer only:

1. Rows P1 and P2 (`src/core/work-graph/architecture/architecture-service.ts`): are the cited lines right; does the stated behavior fully close defects 1 and 2 without breaking rework 3 ruling 2 (committed receipt kept; non-cancel throws kept; cleanup never overrides the main result); is each test reachable as written (the public `architecture/capture` body without `requestSeq` on a real platform; A3 gate on the real `captureObservation` return; A2 throw on `verifyCapture`; A3 gate and count on `releaseCapture`)? Name the existing test file and helper that already builds such a platform with workspace wrappers, if any.
2. Row P3 (`session-anomaly-facts.ts`): the exact awaits and exits to change; whether a public archive step can set the original signal while the real execution read is held (which signal: whose controller, file:line), or BLOCKED is the honest outcome.
3. Row D: is the list of 15 cases complete and exact (start lines), and are `:798`, `:818` and the other kept rows independent of the helpers at `:391–403`?
4. Row R: is the immediate public read after the replayed registration's reply a valid check (can it fail when the replay wrongly creates a request), and is it stable (no race with the trigger)?
5. Anything in the book that leaves a design decision to the implementer: OPEN with the smallest closing sentence.

End with one line: OPEN count.
