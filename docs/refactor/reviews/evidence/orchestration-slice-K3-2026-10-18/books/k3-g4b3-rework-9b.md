# Task: K3 group 4 session B3, rework 9b — the business rows left from rework 9; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books, the test rule sheet and the lead's rulings are binding; do not make design decisions; report anything
undetermined under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); the test rule sheet `./.dsh-ref/test-rule-sheet.md` (v3) binds every brief. Files
disjoint between subagents, every vitest command `--maxWorkers=2`, the close-out runs one vitest command at a time.
**Do not end your turn while a subagent has not reported back.** **Time: you have 240 minutes (the run stops at 255).
Do not end your turn while a row of §3 is still open and more than 20 minutes are left; the previous session ended
after 36 of 330 minutes with rows open, which this round does not accept.** An unfinished row at the end is reported,
not half-done. Delete `./.dsh-scratch/` before you end.

## 1. What this copy is

Tag `k3-g4b3-r9a` (HEAD) = the first session of rework 9 (book `./.dsh-ref/k3-g4b3-rework-9.md`, its reply
`./.dsh-ref/k3-g4b3-rework9a-final.md`). That book's rulings 1–21 still bind. The product owner then decided (2026-10-18)
that this round finishes only the rows that guard real business behavior; the rows that are about test form only
(including the shared-helper rework of `F-001`–`F-007`, `F-009`–`F-013`, and `T-020`–`T-035`, `T-021`, `T-043`) move
to the later test-cleanup round (T) and are **not** done here. The classification behind this is
`./.dsh-ref/k3-business-classification.md`. Codex checked this book (`./.dsh-ref/k3-book9b.out.md`, Chinese); its six
open points are closed in §2 and §3 below, whose wording is final.

## 2. Rulings for this session

1. **No shared-helper rework.** Keep `K3-review-card-fixture.ts`, `K3-tool-seams.ts`, `K3-35-continuation-fixture.ts`
   and the other helpers as they are, except a narrow addition a row below needs (a real-mailbox exit, a real file
   reader option, a commit wrapper on the old Host). Such an addition takes only public inputs (rule sheet A1, A8) and
   changes no existing consumer.
   Named exceptions (Codex's check of this book, `./.dsh-ref/k3-book9b.out.md` §4): for `F-054`, remove the
   SQLite-only guard of `K3-35-continuation-fixture.ts:791–794`; for `F-066`, add a step entry that returns the real
   prepare result (the existing `prepareWorstCase` reads back only a prepared value); optional recognizer, clock, id
   and real-reader wiring (`F-031`, `F-021`, `F-097`) counts as a narrow addition. Existing call shapes stay.
2. **Rework 9a's open questions.** `F-101`'s page-cap and stall branches have no public entry: no test; the lead puts
   them on the T list. `F-082` needs no behavioral test. `F-050`'s `pins: []` for a closed card is accepted. `F-064`
   (512 ASCII characters = bytes) is accepted. `F-055`: the three `K3-16-approval-application` rows that rework 9a set
   to the default (r8 lines 240, 334, 387) go back to 120,000: before B3 (`git show k3-g4b3^`) they carried
   120,000 (lines 243, 313, 368); `k3-book9.out.md:281–292` was wrong to call them default rows.
3. **New production row `F-102`** (`./.dsh-ref/k3-business-classification.md`, M06): `rewriteOf` is accepted when it
   names any of the blocked commands the command hits, not only the first (spec `slice-K3-SPEC.md:539`; at r9a the
   first-hit return is `TG/command-recognition.ts:129` and the `rewrite_of_mismatch` is
   `TG/command-rerun-request-service.ts:773`). **Interface (frozen):** the recognizer takes an optional, already
   resolved `preferred: { reviewRunId, alias }`; in the same parse and expansion it returns that hit when the command
   hits it, otherwise the first hit as today. The owner passes the resolved `rewriteOf`; the shell hook passes nothing
   (it still blocks on the first hit and shows that record's disposition). The persisted `match` stays one hit; do not
   copy the matching into the owner or expand once per record. Downstream (`k3-book9b.out.md` §1): the owner saves the
   chosen hit's `reviewRef`/alias/`match`, and pending/deny/allow follow it; the card shows the chosen record; the
   continuation brief keeps joining by record and alias (two `#1` from two records stay two lines); the allowance
   keeps matching the whole command's digest. Rows (public, both backends): Task runs `node a.js` (unknown outcome,
   reviewed, skipped), is requeued, runs `node b.js` (unknown, reviewed, skipped); two real records, each with alias
   `1`; a later request for `node a.js && node b.js` with `rewriteOf` naming the B record is accepted and the card
   names B. `rejects:` a command that hits only A, with `rewriteOf` naming the valid B record →
   `rewrite_of_mismatch`. (A command that hits nothing, with a valid `rewriteOf`, is `declared` per spec and is not a
   refusal row.)

## 3. The rows (do every row)

Each row: the disposition in `./.dsh-ref/k3-merge.out.md` §4 (M§4), with rework 9's rulings and §2 above; the business
behavior each guards is in `./.dsh-ref/k3-business-classification.md`. Test first, RED then GREEN, memory and SQLite
for service rows.

| Rows | Note |
| --- | --- |
| `F-102` | §2 ruling 3. |
| `F-031` | Rework 9a BLOCKED it. Use the `F-102` path (two real records from two runs, an increasing A8 clock, Run ids deliberately in the reverse order): the combined command hits both, and the earlier record wins. The failing row is `B2-02-recognition-unified.test.ts:122` (it fails at `:134` creating the second record: `K3-blocked-command-fixture.ts:316–333` does not wire `commandRecognizer`, the hook blocks at `:528`, the fixture throws "Run ended before the tool call" at `:352`). Wiring the recognizer is not enough: the second `migrate` is then blocked by the first record's `migrate && cleanup`; if the row keeps "an earlier action beats a later exact", the second run passes through a real one-time CRR allowance first. |
| `F-008`, `F-021`, `F-033`, `F-097` | `F-008`: the request comes from the continuation Run, and the card names the reviewed Run. `F-021`: script expansion through real workspace files and the real reader. `F-033`: the admission refusal rows of prepare/start (`rejects:`), each keeping the configuration version unchanged so the version check does not mask the refusal. `F-097` (back in: rework 9a's row counts reads on a separate owner's recognizer, `B2-07-crr-card.test.ts:127`, while the card is read through the world's own source, `:170`): share `F-021`'s counting wrapper around the real workspace reader; a real request, then change `package.json`, then read the card publicly; the original hit is shown and the reader count does not rise. |
| `F-020`, `F-035` | The saved CRR answer handed back to the Workflow after a restart, through the real startup path and the Workflow's ② and ③ (both the success and the failure). |
| `F-040`, `F-041`, `F-042`, `F-044`, `F-045` | As M§4: the control request really sent; one injected failure on RUN-25's single commit; requeue then claim against the review gate; `F-044` with a commit wrapper on the old Host (rework 9 ruling 7); the "no double apply" baseline taken before the first apply. |
| `F-026`, `F-032` | `F-026`: expected texts written out in the test, never imported production constants. Frozen here: the hook's unconfirmed-recognition text `平台暂时确认不了这条命令有没有被拦，这次先不跑；稍后再试。`; the allowance text `暂时确认不了允许，稍后再试` (spec `:531`, `:537`). Any other text a site of `F-026` checks: the spec's wording where the spec gives it; otherwise the r9a text written out as a literal, each listed in the reply. `F-032`: 401 requests where the last page decides the answer (a record on the last page that really changes the result). |
| `F-054` | Service rows that run on one backend only: both backends, except a row that needs a Host restart (ruling 1's exception for the `K3-35` guard). |
| `F-066`, `F-067` | Rework 9 ruling 8. `F-067`: fixed budget, the long rationale refused, the record unchanged, the short rationale accepted, the full read-back; `156,720 + 6,000 > 158,720` is only a lower bound, so hand-compute the whole increment. `F-066`: first write down the public steps that form the eight anchors the prepare under test has **not yet** picked up, and the arithmetic, stopping before that prepare (ruling 1's step entry); never re-pick anchors already picked up (your 9a reply did; its 16,396 does not prove the case reachable). If it cannot be reached, BLOCKED with the arithmetic. |

## 4. Close-out

Detectors, both: `python3 -I .dsh-ref/d1-ledger.py . k3-g4b3^ WORKTREE` and `python3 -I .dsh-ref/d1-ledger.py .
k3-g4b3-r9a WORKTREE`; every round line cites a row; D3 0 hits. Checks: the changed and new test files, then
typecheck, check:architecture, build. No real model calls, no git writes, never ports 3080/3099/44797.

Reply under 900 words: per row done (RED → GREEN) or BLOCKED with the exact refusal; the narrow helper additions;
production lines added and removed; the round D1 with an id per line; checks with numbers; FOUND and UNSPECIFIED.
