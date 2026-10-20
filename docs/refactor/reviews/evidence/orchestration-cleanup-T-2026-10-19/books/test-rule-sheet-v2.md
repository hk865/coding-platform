# Test rule sheet v2 (lead, frozen 2026-10-19 22:55)

v2 = v1 (`docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md`) with the changes
below. Everything else in v1 is unchanged.

**Why:** the T book check (Codex, 2026-10-19) found three questions that v1's text leaves open:

- three helpers that the inventory kept, which v1's empty A7 list forbids;
- where the record store's own tests get their public step;
- whether a plan proposal body counts as a "draft".

Codex's first instance list on the merged wave-1 tree (`codex2/t-v2-list.out.md`) added five wording fixes, all taken
below.

**When it applies:**

- From the T wave-1 rework 1. There it is used only for the rows the frozen finding table names
  (`impl/t/t-w1-findings.md` R-1).
- Codex's first list was a checked subset, not every instance. Before wave 2 is frozen, Codex lists every instance in
  full (v1 line 14), and v2 then binds wave 2 as a whole.

## Changes

- **A1, what a public input is.** A value that a public route or tool receives from outside is a public input, even
  when its type is called a draft.
  - Example: the `plans/propose` body (`src/app/core-http-types.ts`; the route hands it to `plans.proposePlan`), or
    the plan proposal tool's arguments.
  - A helper may take such a value and pass it to the public step that receives it. The test then goes on through the
    public steps (review, apply).
  - The value must meet the whole parameter contract of the real route or tool branch. A type cast does not make a
    value a valid public input. Neither does a stand-in that ignores the request. A1 does not lift F4.
  - **Values the platform issues.** A public input may carry fields that the platform itself issues or derives: a
    credential, display token, position, cursor, receipt, fingerprint or prepared value. Such a field may only be the
    value a real public step returned, used as it was returned. Rebuilding it from internal records or a captured
    commit, or issuing it in the test, is F1.
  - F1 still forbids handing an owner a value the platform derives itself: a review, a classification, an entered
    fact, a Run, a prepared value, a record.
- **A1, the record store's own tests.** For tests of `src/core/record-store` itself (`tests/record-store/*` and the
  helpers only they use), the store's ports are the public step. Building records and committing them through the
  port is allowed there, and nowhere else.
  - What the row verifies decides it, not the folder it is in. The row must check the store's own contract. When an
    upper owner drives the row, that does not allow the row to test the upper owner's business state.
  - Building and committing records by hand is F3 in any test of a module above the store.
- **A7, named helpers (3 of at most 10).**
  1. **The note tools adapter.** `tests/runtime/S4C-note-tools.test.ts`: `buildNoteTools` with a recording note
     write/check port.
     - Allowed only in that file, and only to test the adapter: its argument mapping, its defaults, and that it passes
       the result through.
     - Never used to reach an owner's state.
  2. **Kernel damage injection.** `damageKernel`, in two files only:
     - `tests/scenarios/S2C-K-unknown-outcome.test.ts` (definition `:41`, calls `:75`, `:157`, `:179`);
     - its moved form, `tests/scenarios/S2C-K-retired.test.ts` (definition `:196`, calls `:218`, `:248`, `:298`).

     It corrupts the record JSON in the test's own temporary Kernel store. Damaging the whole records table of that
     store is allowed. This lets the test check how the platform reacts to damaged Kernel history. It counts as a
     dependency failing at a named point (A2).

     It is never used to write or change WorkGraph facts, or any store other than that temporary Kernel store.
  3. **The process sandbox stand-in.** `tests/scenarios/support/process-sandbox-standin.ts` `probe`, with
     `executeChecks: false`.
     - It stands in for the operating-system sandbox (bwrap). It answers one question: whether the sandbox is
       available and can run checks. The test checks how the platform reacts.
     - It is never used to run checks or commands, or to return their results.
     - Uses that turn `executeChecks` on are outside A7. Codex's first list found two:
       `tests/scenarios/K3-29-disposition-recovery.test.ts:185` and
       `tests/scenarios/K3-44-recovery-answers.test.ts:267`. They are wave-2 instances.
