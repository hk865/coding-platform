Read-only quick check for the lead (one pass, only the rework's change). Do not write any file, do not run tests. Answer in Chinese with file:line.

This copy is C1 group G4 after rework 1, tag `c1-g4-rw1`. Your earlier review of G4 is `./.lead-ref/c1-g4-review.out.md`. After it, the lead removed `scope` from run-state's success result and two review tags (tag `c1-g4-r1-lead`), and DSH did rework 1 (`./.lead-ref/c1-g4-rework-1.md`, reply `./.lead-ref/c1-g4-rw1-final.md`). Inputs:
- `./.lead-ref/c1-g4-rw1.diff`: the rework's change against `c1-g4-r1-lead` (16 files, +68/−87);
- `./.lead-ref/base/`: the `c1-g4-r1-lead` version of each file the rework changed;
- `./.lead-ref/g1base/`: the `c1-g1` version (before any G4 change) of the same files, so you can compare with the original code;
- `./.lead-ref/c1-g1-interfaces.md`: G1's shared helpers.

Check only:
1. **The signal check** (`tasks/trusted-context.ts` now takes `isSignal`): for each of claim, execution-history, run-state and execution-entry, is the accepted set of `signal` values, the rejection code and text, and the position of the check exactly as in the `c1-g1` original? In particular claim: DSH says its predicate accepts any non-null object including arrays — was claim's original check that, or did it also require the signal properties? Give a concrete `signal` value for any difference.
2. **The new switches** to G1 helpers (`canonicalOf`, `parseObject`, `isPos` / `isNonNeg`, `rejected` / `rejectedWithCurrent`, `plan-readers` `isSafeRevision`, `task-service` `refFromRefKey`): each replaced body identical to the shared one (null vs throw, safe-integer limits, `current` kept when passed vs only when non-empty, key order)?
3. Your earlier items 1–3 and 5: are they resolved, and did the rework add any new history tag, rename or file outside G4's whitelist? `terminalProposalOf` unchanged?

Output: a short table of findings (会出错 / 不整洁 / 建议, file:line, fix), then one line: 会出错 count, 不整洁 count.
