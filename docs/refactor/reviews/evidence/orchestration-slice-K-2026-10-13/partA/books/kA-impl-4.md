# Task: K slice part A — fourth session: last fixes after the re-review

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Three earlier
sessions implemented part A of the K slice; the work is in the working tree (not committed). With real bubblewrap the
lead ran the full suite after round three: everything passes (291 files, 6,035 tests). Codex's re-review says "merge
after listed fixes": two production gaps and several tests that bypass the required public entries. This session
fixes exactly those. **You must finish before 13:55 local time** (the run limit is set to 85 minutes).

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 300`), then check with `list_agents`; repeat.

**Work with subagents:** group R (production + its tests) first, then group T (test-entry rewrites), each its own
subagent; you coordinate and run the checks.

## 1. Material (inside this copy, excluded from `git status`)
- `./.dsh-ref/kA-impl.md` — the first brief (sections 1–5 and 8 still apply).
- `./.dsh-ref/r2/` — round two's review and report; `./.dsh-ref/r4/codex-review-2.md` — **this re-review; its problems
  1–5 are this session's work.**
- `./.dsh-ref/tdd/` — the TDD skill.

## 2. Lead decisions (binding)

- **D11 (problem 1) — expand the window only for the same Session.** In `continuation-brief-assembly.ts` (around
  243–258) the ordinary platform-window path keeps `endPosition ?? observedThroughPosition`. Only the qualifying
  same-Session case (spec L9) uses the identity-derived interrupted window from `readTurnBounds`. State and accepted
  messages come from the selected window. Test-first through the public path: a cross-Session continuation after an
  interrupted Run whose recorded window is readable gets the recorded window, not records appended later.
- **D12 (problem 2) — choose the facts source nearest-first.** In `context-assembler.ts` (around 743) walk the facts
  chain from the nearest ancestor outward and pick the first Run that entered (an entered locator-less attested Run is
  entered, as D2); never jump to an older ancestor past an entered one. Compute `sameSession` against the selected
  Run's Session. Test-first through the public KE3 flow: R1 entered → R2 entered without a saved locator, then attested
  → R3 never entered and requeued → R4 prepares: R4's brief takes R2's facts.
- **D13 (problem 3) — public entries only.** Rewrite `tests/composition/K-R-previous-turn-bounds.test.ts`,
  `tests/composition/K-R-observers-kernel-closed.test.ts`, and the fabricated-record parts of
  `tests/composition/K-R-close-open-turn-health.test.ts` and `tests/composition/K-R-close-open-turn.test.ts` (around 221
  onward): create platform state through public flows (Host/Workflow routes, Runtime preparation and observation); for
  D4, close the real live Turn through the public Kernel `closeOpenTurn`, then observe through the Runtime. Keep boundary
  instrumentation only for zero-write assertions. No private assembly helpers, no fabricated Session/Run/requeue records.
  Where a capability toggle is needed (D5), toggle the injected kernel dependency of a real Runtime.
- **D14 (problem 4) — KA-05's third refusal asserts the specific history-prefix/current-Turn conflict** raised at
  `vendor/coding-agent/patches/core/ports/session_store/session-history.ts` (around 395), not a generic throw.
- **D15 (problem 5) — fallback and exclusion assertions.** The archive-request case asserts through public reads (and
  `closeOpenTurn` boundary instrumentation) that no closure happened before the archive. Each KA-12 cause case also
  asserts the predecessor's archival (public Session reads). The provenance-null exclusion is not reachable through
  today's creation (it normalizes provenance and rejects explicit null): no test; the lead records it as a spec
  qualification.
- Every new or rewritten scenario that drives the Workflow asserts where the drive stopped (as D10), and stops before
  checks, so no test depends on whether bubblewrap exists.

## 3. Rules
Test-first for D11 and D12. No git write commands; one vitest command at a time; no real model calls; no network; do
not touch ports 3080, 3099, 44797; probes only under `./.dsh-scratch/`, deleted at the end. No edits to the frozen files.

## 4. Checks
Run exactly the commands of the first brief section 8. Expected (no bubblewrap here): typecheck, architecture, build and
kernel-patch check exit 0; every new K test passes; the 14 frozen files and the regression run fail only as in
`DSH-BASELINE.md` (NEW = 0); frozen sha256 values hold.

## 5. Reply
The first brief's reply format, plus **REVIEW:** problems 1–5: fixed / not fixed (why), with test names and file:symbol.
