# Read-only review: wiring package 1, implementation (part 2) against the frozen spec

You review, you do not edit. Node is not available: do not run node, npm, npx or tests; reason from the files with
read / grep / git only.

This checkout = branch commit 67dfee7a (it contains the spec) + one uncommitted patch that brings the whole state of the
implementer's copy: `DSH-BASELINE.md` (lead's baseline numbers, ignore), four frozen fixture helpers
`tests/helpers/WP1-*.ts` (lead-checked), 8 new frozen test files `tests/**/WP1-*.test.ts`, and the source changes.
See it with `git status` and `git diff` (modified) plus the untracked files. The tests and helpers are frozen: review
them only to understand what a row requires. Review the NON-test files.

The lead already measured, in a Linux copy: typecheck, check:architecture, the 8 new test files (63 runs) and a
34-file regression set. You do not need to re-measure. Your job is to find what the tests do not catch.

## What the change must be

- `docs/refactor/design/orchestration-2026-10/slices/wiring-1-SPEC.md` (Chinese), the frozen spec. §0 (lead notes
  L1–L17) WINS over the body. §2 interfaces, §3 state rows W1-CTX-01, W1-WF-01, W1-HO-01…04, W1-AUTO-01, W1-DUTY-01,
  W1-ANOM-01; §4 rules (4.1 duty resolver order; 4.2 provider order and exact texts/reasons; 4.3 G; 4.4 E15 items
  1–9); §6 write scope (11 source files + `src/business/workflow/index.ts` only for an export; nothing else);
  §7 rules 1–11 (all binding); §8.
- `docs/refactor/HANDOFF.md` top: decisions 38, 42, 43, 45 (U1 option (a): a retired line whose Run has an unknown
  outcome is skipped by maintenance with `busy` / `archive_unknown_confirmation_required:` and zero commits), 47.
- Earlier slice specs for the code this touches: `slice-1-SPEC.md` §2.2–§2.4, §2.8, §3.2, §4.1 (around line 799), §4.2;
  `slice-3-SPEC.md` §2.2, §2.5, §3.2 (CTX-01/02), §4.2, §4.3.
- C6 / U-11: `tests/scenarios/C6-unrelated-adoption.test.ts` must still pass unchanged — an unrelated plan adoption
  after preparation must NOT block entry. No Goal version pin may come back (e48218a5 removed it on purpose).
- AGENTS.md rule 9: every state transition goes through `src/core/work-graph/state/`; `state/` imports only
  `src/contracts/`. `docs/refactor/module-target.json` for module / submodule imports.

## Focus

1. §7 rules 1–9, each one, with file:line evidence: (1) handover result mapping exactly per W1-HO-02 / W1-HO-03 (done →
   claim; `revision_conflict`, or an archive `pending`/`partial` whose transfer did not happen → `select_work`; other
   refusals → transfer or claim; never the same request again, never `waiting`); (2) the claim's Session revision read
   after the handover step, never from the `create_session` receipt; (3) one `archive_predecessor` step with the
   transfer choice only when P is live, idle, not waiting, and its ONLY open responsible link (modules included) is T;
   retired P only transfers; (4) no anomaly anchor, no requeue, no message from the handover; `session-archive.ts:drive`
   unchanged; (5) U1 skip first, the new maintenance branch after it; (6) no Goal pin back; `contextConsumptionGuards`
   still skips the Goal; (7) `goalPayload` bytes unchanged, digest only in the binding; `assembleQuery` unchanged;
   (8) duty resolver: no default `executor` from `effectivePlatformDuty`, never the Host grant's duty, every failure →
   `'unknown'`, never throws; (9) provider: read failure → the read fails (never empty rows), installed only into
   `createGraphContextReader` in `create-platform.ts`.
2. §4.4 item 2–7 details: which reads (readSession for P and C, readSessionFacts for P's wait), the four exact pins of
   the transfer (including revision 0 for a missing C link), request ids via `automaticGraphWrite`, contexts via
   `automationContext(owned)`, the claim after a handover built the same way as after `create_session` (requeue carried,
   sessionHint C), the wording of the `waiting` reasons, the W1-HO-04 recovery in `claimRequeued` for BOTH reuse
   sources, and §4.4 item 8 (no `deps.responsibilities` → exactly the old behaviour).
3. W1-CTX-01 placement: after the Workspace revision loop, before the input-declaration check; `rebinding` skips; the
   original receipt is still replayed before any new check; the current Goal used is the one `authorizeRuntimeEntry`
   already read (no second read, no new pin).
4. Idempotency / replay: a replayed handover receipt; a replayed `create_session` receipt recomputes the next step from
   current facts; reads create no record, receipt or model call.
5. Error branches: each refusal code and reason text of §4.2 (forbidden, cancelled, not_found, incomplete ×2,
   unavailable) and §2.2; nothing turned green.
6. Both storage backends (memory and SQLite): anything that only works with one.
7. Anything changed beyond what the spec asks (existing behaviour rewritten, exports removed, comments now false), any
   file outside the write scope, `tests/architecture/production-reach-allowlist.json` changed.
8. Tests that pass for the wrong reason: a production path that special-cases test fixtures or test ids.
9. Existing tests that may change because of E15 / I-3 / G (spec §5.3 items 2–4): name any assertion in
   `tests/scenarios/A7-*.test.ts`, `A8-host-restart*.test.ts`, `tests/composition/A2-requeue-platform.test.ts`,
   `tests/scenarios/harness.test.ts` or a production-composition test that the change will now break, with file:line
   and why (the lead runs them with the real sandbox; this tells the lead what to look for).

## Output

English. A list of findings, each: file:line, severity (must-fix / should-fix / nit), the spec row / rule it violates,
evidence (quote the code briefly), the correct direction (no code). Most severe first. Then one line per §7 rule and
per state row you checked and found satisfied, with the file:line that satisfies it. Verify every claim in the code
before you report it; do not report style.

## Points to confirm or refute (with evidence)

A. The implementer found that `tests/architecture/production-reach.test.ts` failed only because two `kept-for` entries of
   `tests/architecture/production-reach-allowlist.json` (`configuration-contracts.ts#RoleReadOptions` and
   `#RoleConfigurationPort.readRoleSpec`) are now reached through the new duty resolver; the lead removed exactly these
   two entries (that is the allowlist diff in this checkout). Are both really reached now from production? Is any OTHER
   allowlist entry now reached by this change (for example something of `listSessionAnomalies`, the anomaly codecs,
   `effectivePlatformDuty`, `platformRoleProfile`, the archive or responsibility ports) and should have been removed too?
B. The implementer says SC01 and SC02 fail in its sandbox only at the registered check (no /usr/bin/bwrap) and every
   assertion before that passes. Read the two scenarios and the implementation: is there anything after the check
   (task completion, P archived with mode handoff_complete, until = transfer cursor, no anchors, archive-state label
   null; SC02: rows empty after completion) that the implementation would NOT produce?
