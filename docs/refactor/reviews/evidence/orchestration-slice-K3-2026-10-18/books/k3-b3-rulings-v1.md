# K3 group 4 session B3: scope and rulings for the audit and the last reworks (lead, 2026-10-18, decision 80)

Binding together with `test-rule-sheet.md` v1. Frozen for the audit; changed only as the rule sheet says.

## 1. Scope (the user chose this, 2026-10-18)

- **In scope:** every test and helper that B3 changed (`k3-g4b3^..k3-g4b3-r8`: 91 test files and 24 helpers), plus
  every other test file that calls a helper the audit finds forbidden.
- **Not in scope (T list):** the rest of K3 groups 1–3 that B3 did not touch, and the T list of `k3-g4b3-rework-7.md` §3
  (`B2-execution-fixture.ts`, `B2-model-request.test.ts`, `B2-execution-result.test.ts`, `B2-runtime-fixture.ts`;
  K3-11, K3-14, K3-45, the non-proposal part of K3-48-2, K-R-close-open-turn, B2-execution-entry). The audit still
  lists their hits once, under T, so that the T round has them.
- **Production code** is in scope only for P1 (silent defaults) and P4 (leftovers, one rule in one place); it has had
  no finding since rework 2.

## 2. Withdrawn ruling

`k3-g3-impl-4.md` §2 ruling 2 is **withdrawn**. It had the multi-item part of K3-06, K3-13 and K3-35 (一) proven at
the owner level, by committing built multi-item records through the owner's public writes. That is F1 of the rule
sheet. Now:
- the reachable single-item part through the real chain stays as it is;
- the multi-item part becomes a pure test (A5) of the function that handles several items (codec, renderer, fit,
  ordering), in a `*-pure.test.ts` file; where no such function exists, the row is deleted (AGENTS rule 4: no tests for
  states only tampering can make). `K3-06-mixed-kinds-owner.test.ts` and `K3-13-two-items-owner.test.ts` are the
  instances known today.

## 3. Rework 8's UNSPECIFIED

1. **Accepted:** the replay row proves the replay by an equal second report and unchanged revisions, if the revisions
   are read through public reads (otherwise F7).
2. **Open** (the audit answers it): can RUN-25 run on both backends through the shared harness, which initialises a git
   work tree in the world's temp directory? Give the public call sequence, or "unreachable because file:line".
3. **Decided:** the shared helper gets a real-mailbox option (A1); `K3-47-continuation-gate.test.ts` uses it instead
   of assembling the production pieces itself.
4. **Decided:** the literal source-digest ports (`captureDigest()` returning `'a'.repeat(64)`) are F4. Use the real
   capture of the world's work tree (A1). Known instances: `K3-15-review-routes.test.ts:81`, `K3-crr-fixture.ts:157`,
   `K3-prefix-claim.ts:96`.
5. **Decided:** K3-19's rows run on memory and SQLite.
6. **Accepted.**
7. **Accepted** (not K3: a baseline timeout without the sandbox).

## 4. Known instances at `k3-g4b3-r8` (the audit's canaries; each must appear in the group that holds it)

- F4 `tests/business/K3-review-workflow-rows.test.ts:736` `performWorld` and its callers (~811, ~822).
- F1 (§2) `tests/work-graph/K3-06-mixed-kinds-owner.test.ts`, `tests/work-graph/K3-13-two-items-owner.test.ts`.
- F4 (§3 item 4) `tests/app/K3-15-review-routes.test.ts:81`.
- F12 `tests/work-graph/K3-16-approval-application.test.ts:238` (`toBe` of the whole summary became `toContain`);
  `tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:388` (`toBe(B - 2_000)` became
  `toBeLessThan`); the same file `:374` (SQLite only); seven raised timeouts (D1 ledger).
