# Task: K slice part A — second session: fixes after the acceptance review

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The first session
implemented part A of the K slice in this copy (closing a dangling Kernel Turn as `run.interrupted` and continuing in
the same Session); the work is in the working tree (not committed). With real bubblewrap the lead ran the full suite:
everything passes (287 files, 6,020 tests), including the frozen old-test flips. Codex's acceptance review says "merge
after listed fixes": five production defects, one smaller one, and several test rows that do not yet prove their
behaviour. This session fixes exactly those.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 5 and the reply of section 6.

**Work with subagents.** You are the coordinator; keep your own context small. Do not read the spec, the code or the
tests yourself. Give each group of section 3 to its own subagent; run K first, then R and W (W uses R's behaviour), and
a read-only reviewer per group at the end.

## 1. Material (inside this copy, excluded from `git status`)

- `./.dsh-ref/kA-impl.md` — the first brief. Sections 1–3 and 5 (the copy, where the rules are, the frozen files, the
  rules for every group), section 4 (lead decisions) and section 8 (checks) still apply.
- `./.dsh-ref/r2/codex-review-1.md` — **the acceptance review. Its findings 1–6, the row table, and the UNSPECIFIED
  assessments are this session's work.**
- `./.dsh-ref/r2/report-1.md` — the first session's reply.
- `./.dsh-ref/tdd/` — the TDD skill.

Every subagent reads: the TDD skill; the first brief sections 1–5; this message's section 2; its group block; the
review items its block names; the spec lines those items cite; then the code and tests.

## 2. Lead decisions for this round (binding)

- **D1 — the brief finds the Turn with `readTurnBounds` (finding 1; UNSPECIFIED "L9 done differently" is not accepted).**
  The continuation brief locates the previous Turn by its exact Kernel identity through the injected `readTurnBounds`
  (read at call time, M2) and reads the window `[startPosition, endPosition]` it returns. Apply the interrupted-Turn
  handling only to a qualifying same-Session continuation (spec L9). Derive the reduced state and the accepted messages
  from the same window. When the Turn cannot be found or read, or the window would exceed the read limit, the brief
  says so (the existing unavailable/incomplete outcome), never `not_entered`, `running` or `paused` by fallback, and
  never with `lastAssistant` of an interrupted Turn.
- **D2 — facts source after an attested Run (finding 2).** Before choosing the facts source, distinguish a Run that never
  entered the Kernel from an attested Run that entered (no `executionHistory` because the position acknowledgement was
  lost). Use the stored facts that prove entry (entry authorization and its events, the reconciliation observation);
  an entered Run's own Turn is the facts source, found with `readTurnBounds`. Test: a public continuation after an
  entered, locator-less, attested Run that itself has a requeue ancestor reads the attested Run's facts.
- **D3 — concurrent closure (finding 3).** In the Kernel store, when the append of the deterministic `run.interrupted`
  collides (`idempotency_conflict` or a revision change), re-read the Turn bounds and the header: if the Turn is now
  closed by that same closure, return `already_closed` with the closure position and a revision read after the bounds
  (consistent pair, row 3); otherwise return `conflict` (retryable). Never `unreadable` for a collision. Test the real
  append race at the store boundary (two closures of the same open Turn, one commits first).
- **D4 — observers and a Kernel-closed live Run (finding 4).** Right after reduction, before confirming mailbox inputs or
  any other write, the Work and Query observers detect a Kernel Turn that ended `interrupted` while the platform Run is
  still live, write nothing, and report it as spec L1 says (`kernel_closed_without_platform_end`). Test without
  database corruption: close the open Turn through the public Kernel `closeOpenTurn` directly (bypassing the platform
  guards) while the platform Run is live, then observe: zero commits, the report, no mailbox confirmation.
- **D5 — both capabilities at call time (finding 5).** Runtime resolves `closeOpenTurn` and `readTurnBounds` from the
  injected kernel dependency at every call; if either is absent, `unsupported` and no write. Test each absence
  independently.
- **D6 — `host_config` probe (finding 6).** An available Session whose probe reports `host_config` maps to `transient`
  (retryable), not `unsupported`.
- **UNSPECIFIED items accepted as reported:** a missing Session makes `readTurnBounds` return `unreadable`; an unusable
  successor enumeration maps to `transient`; an interrupted Turn's brief keeps `stoppedAt.lastToolGroup` and
  `toolCalls` and drops `lastAssistant`. The lead records these as spec qualifications.
- **Tests (the review's row table; expected values from the spec or hand-written fixtures, never read back):**
  - KA-02: expected bounds and positions computed from the hand-written fixture, not from stored output.
  - KA-05: add the third refusal through the public path the review gives (close B, then `runCodingAgent` with a fresh
    run id, B's turn id, and a history cursor at B's closure).
  - KA-06: no checkpoint/store readback outside KE1; use boundary write instrumentation; the replay fixture contains
    tool work that must not execute.
  - KA-09: through KE3 and `executions/brief` only, no private assembly helpers or fabricated platform records; each
    required variant with known message, steer and tool ids; include D2's case.
  - KA-10: the successor, archive and provenance exclusions with closure enabled.
  - KA-11: a one-shot boundary fault on exactly the next read, and assert `waiting`.
  - KA-12: the four KE4 workflows, one reachable case per required cause: new Session, handover/archive, readable
    history or an honest refusal (row 5 stays exempt as defensive).
  - KA-13: re-enable closure before rebuilding the Host; the predecessor stays protected.
  - KA-14: the unknown-outcome call ids and statuses reach the public continuation brief through KE3.
  - KA-15: a concurrent append injected at the Kernel store boundary; assert `waiting`, no fallback or archive, then
    recovery (covers D3).
- **The frozen old-test flips and the frozen files of the first brief section 3 stay exactly as they are.**

## 3. Groups

**K — Kernel patch** (`vendor/coding-agent/patches/...`, generated files via `node scripts/build-kernel-patch.mjs
--write` then `--check`; `tests/kernel/K-*.test.ts`): D3; KA-02, KA-05, KA-06.

**R — Runtime** (`src/core/agent-runtime/*`, `src/contracts/continuation-brief.ts`; `tests/composition/K-R-*`,
`tests/scenarios/K-R-*`, `tests/app/K-R-*`, `tests/helpers/K-session-support.ts`): D1, D2, D4, D5, D6; KA-09.

**W — Workflow and maintenance** (`src/business/workflow/*`; `tests/scenarios/K-W-*`): KA-10 … KA-15 (KA-12 and KA-15
use R's and K's behaviour; start after both report).

## 4. Rules

Test-first for every behaviour change (a failing test first, then the smallest change). No git write commands; one
vitest command at a time; no real model calls; no network; do not touch ports 3080, 3099, 44797; probes only under
`./.dsh-scratch/`, deleted at the end. If the spec, the review and a test disagree: keep the test, stop that item,
report it under UNSPECIFIED with the spec line.

## 5. Checks

Run exactly the commands of the first brief section 8. Expected (no bubblewrap here): typecheck, check:architecture,
build and the kernel-patch check exit 0; every new K test passes; the 14 frozen files and the regression run fail only
as in `DSH-BASELINE.md` (no NEW failure); the frozen sha256 values hold; `git status --short` lists only L-scope paths;
`./.dsh-scratch/` deleted; no commit.

## 6. Reply

The first brief's reply format, plus **REVIEW:** for findings 1–6 and each row of the review's table marked "Must fix"
or "Should fix": fixed / not fixed (why), with the test names and file:symbol.
