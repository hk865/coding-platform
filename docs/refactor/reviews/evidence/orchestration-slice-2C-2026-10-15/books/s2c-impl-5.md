# Task: slice 2C, round 5 — item 3 (2C-22(2)): let a confirmed unreadable Turn closure record missing/damaged; test-driven

You are working in the slice-2C copy (the current directory). The earlier rounds' work is **uncommitted in the working
tree — keep it**. This is a NEW session. No git write commands, no network, no real model calls. Throw-away files under
`./.dsh-scratch/` (delete at the end). Finish within 60 minutes. **Headless: when your turn ends the run ends.** At most
2 subagents (you probably need none). Memory: every vitest command `--maxWorkers=4`; one at a time; full suite
`--maxWorkers=8`.

Read first: your last report `./.dsh-ref/final-4.md` (section ITEM 3: the health owner returns `unchanged` because of
SES-19), `docs/refactor/STATE-MACHINES-SPEC.md` rows SES-12, SES-13, SES-19 (around line 2609) and the test row near
line 2818, and `src/core/work-graph/state/session-availability.ts` around line 845.

## Lead ruling (2026-10-15 evening)

SES-19 stays for every probe the reconcile path makes: a `missing`/`damaged` probe on an `unavailable/kernel_turn_open`
Session is still an empty transition there. **One new, narrow transition (call it SES-19a):** when the caller is the
Turn closure (the `closeOpenTurn` closure in `src/core/agent-runtime/runtime.ts` — your `recordUnreadableProbe`), the
Session is `active / unavailable / kernel_turn_open`, the closure has just answered `unreadable`, and the fresh probe
verdict is `missing` or `damaged` → the Session becomes `active / unavailable / <verdict>`: rev+1, effects
`observe_health` + `SessionHealthObserved`, occupancy and lifecycle unchanged, same Host-lease guard as SES-12.

1. `state/session-availability.ts`: add a caller kind for this path (e.g. `caller: 'turn_closure'`) and the SES-19a branch
   before the SES-19 return. Nothing else in the machine changes; `reconcile` keeps SES-19 exactly.
2. `sessions/session-health.ts` and the `recordSessionHealth` path the closure calls: carry the caller through so the
   closure's write uses `turn_closure`; every other caller stays `reconcile`.
3. Maintenance: no change expected — pass 2 reads `missing`/`damaged` and today's retirement rule archives the line as
   retired. If it does not, change the smallest thing and say why.
4. Tests (test-first): a unit test on `transitionSession` for SES-19a (turn_closure + missing → missing; + damaged →
   damaged; reconcile + missing on kernel_turn_open → still empty, SES-19); flip `2C-22 (2)` and `2C-22 (4)` and
   `2C-21 (2)` from pinning the refusal to the ruled outcome (pass 1 → `missing`/`damaged`; pass 2 → archived · retired;
   never returns to available or "re-enable"). The 9 tests (A8 host restart ×4, K-R attested facts ×3, K-W maintenance
   ×2) must still pass **unchanged** — run them alone and report. Existing SES-19 tests must still pass unchanged.
5. Do not edit specs; the lead adds SES-19a to STATE-MACHINES-SPEC and the 2C addendum.

## Checks and reply

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`;
targeted vitest; the full suite (`--maxWorkers=8`) compared with `DSH-BASELINE.md` §A (list every failure outside it;
`tests/scenarios/S2C-K-archive-tags-checks.test.ts` is expected red here). Reply: FILES CHANGED, SES-19a (what and where),
TESTS (names and results, the 9 tests, the SES-19 tests), CHECKS, NOTES.
