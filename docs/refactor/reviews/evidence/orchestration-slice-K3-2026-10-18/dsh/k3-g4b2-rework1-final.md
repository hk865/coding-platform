All seven items are complete and checked. Final reply:

## Files changed

**Production (net):** item 1 `state/unknown-call-review.ts` +6 (`settleAwaitingProposal`: `!second && every` → `awaiting_approval`; otherwise `needs_decision` with `reviewIncomplete: second`, `proposalMissing: !every`). Item 2 `context-assembler.ts` +6, `contracts/core/prepared-execution.ts` +12 (proposal-only `summaryCommand`; `unexpanded` renders the record summary + `（只是摘要：全文太长，没有放进这一轮的说明）`). Item 3 `contracts/continuation-brief.ts` +5/−3 (cwd newlines indented in the same function). Item 4 `unknown-call-review-tools.ts` +2/−2 (`.nullable()` dropped). Item 7 `unknown-call-review-card.ts` −5, `decision-read-model.ts` −1/+1 (`b1Unavailable` gone). Items 5–6 test-only.

**Tests:** new `helpers/K3-proposal-round.ts` (1046), `K3-16-proposal-round-fixture` (196), `K3-16-second-unfinished-proposal` (180), `K3-16-approved-method-lines` (50), `K3-35-renderer-boundary` (62); rewritten `K3-16-approval-application` 544→447, `K3-16-proposal-write` 337→217, `K3-48-2` 329→308; extended `K3-16-proposal-input` 183→246, `K3-16-proposal-tool`, K3-35 fixture/prepare/test, `S5-decision-fixture` +7/−2.

## Items

1. RED `expected 'awaiting_approval' to be 'needs_decision'`, reasons `[]`; GREEN reasons exactly `['review_incomplete']`, missing variant `['review_incomplete','proposal_missing']`, new `stateEntry` re-counts. Memory+SQLite through public owners.
2. RED proposal unexpanded rendered `（无）`; GREEN summary+sentence, truncated/full unchanged, review phase byte-identical test passes (7/7).
3. RED cwd literal unindented and 5,118≠5,120; GREEN (cwd `a\nb` indented; 5,120 counts the two bytes).
4. Test replaced: explicit `cwd: null` was `success` + owner write; now `error.invalid_arguments`, zero writes; absent still owner `null`.
5. `K3-16-approval-application` no longer calls `approvedMethodLinesZh` (local literal formatter); all three files reach state via the shared public fixture (real claim/tool/Run end/settle, memory+SQLite): 10/10, 7/7, 5/5. Pre-B2 injection only in `K3-48-2`'s `fixture()` (review half), left untouched.
6. RED old fixture 15,743 vs hand 15,681. Totals below.
7. No test change; 72/72 card tests before/after, no `b1Unavailable` remains.

## K3-35 hand totals

Header 110; anomaly 9,090 (16 + 8×1,117 [761+238+118] + 51 `另有 10 条` + 87); review 961 (43+128+314+200+232+44); methods 5,120 (25 prefix + 3 + 3,892 command + 600×2 indentation); tail 357; joins 43 → **15,681** at T=512 (whole rendered 15,750 with the 68-byte body note + join). T=600 = 15,681+704 = **16,385** → `capacity` (1 over). Codex 15,710/16,414; ours −29: table 15,778 −15 (real `itemsOmitted` 0, one digit vs 16) −14 (anomaly omitted 10, two digits vs 16) −5 (31 platform aliases 232 vs 32=237) −62 −1 (B3 sentence+join absent). With 8 omitted anchors it was 15,680/16,384 — exactly the limit, so the renderer returns a note-less 16,384-byte brief instead of throwing; the fixture therefore carries 18 anchors (8 carried + 10 omitted), a consistent L20 fact, making (三) strictly over. Reported as UNSPECIFIED.

## Checks

K3 glob: 97 files/494 tests pass (0 fail). K excl. K3: 14 files 97P/15F; S5*/S4C2*: 49 files 495P/1F; business+state+composition+architecture+runtime: 168 files 4703P/23F/29S; scenarios/app: 10 files 48P/24F; brief glob 14P/5F. Every failure is DSH-BASELINE §A (no bwrap), no new ones. S5-fixture consumers 31 files/302 pass. `typecheck` 0, `check:architecture` OK, `build` OK. No git writes; scratch deleted.

## UNSPECIFIED

K3-35 anchor-omitted choice above. Fixture seams: settlement owner wired `full` (world's owner lacks the D6 reader); the helper builds the real review manifest because S5 `enterClaim` cannot; exact-size setup executes 2 of 4 attempts (5 K3 tasks); attempt-1's 163,285-byte post-chain record is a mandatory settlement write, not optional text. Item 2's `summaryCommand` rides every proposal item; a null summary renders empty+sentence. Approval "7 rounds" = 1 review + 6 proposal = 7 total (one free slot).