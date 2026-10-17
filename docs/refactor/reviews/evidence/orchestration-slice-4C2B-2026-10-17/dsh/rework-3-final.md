## FILES

**Production** (5 files, +56/−14, net **+42**): `model/decision-contracts.ts` +1/−1, `notes/note-anchors.ts` +10/−0, `notes/note-decision-source.ts` +4/−3, `notes/note-service.ts` +35/−6, `views/decision-read-model.ts` +6/−4. No new production file.
**Tests** (4 files, +161/−44): `S4C2-read-counts` +67/−32, `S4C2-U3` +83/−5, `S4C2-D-rows` +7/−7, `S4C2-U6-note-card-e2e` +4/−0.

## ITEMS (RED → GREEN)

1. **RED** (memory+SQLite, today's code): whole-queue catalog assertion got **3** — g1 `{plan:1,catalog:2,…}`, g2 `{plan:1,catalog:1,…}`. **GREEN**: catalog total **1** (g1 1, g2 0), plan **1 per goal**, note batches 3+3. Fix: `attempt` threaded `readPage → readCollection → readNoteDecisions → userReasonFacts`; only the per-project catalog-window map lives in `attempt.cache` (new attempt empty; write/dispose/scribe keep per-call caches). Candidate list is **not built** on the reason-facts path (`skipCandidates`), so the retired target reads no second catalog.
2. Test-only; no production change. Real structural note → real card → `decisions/answer` (`answerDecision`) → ordinary scribe `withdraw` before application → `recordDecisionApplication` rejected `incomplete` ("the formal event carries no decision change proof"); `readCard` and the queue's answered section stay `answered_pending_application` with `application:null`. **Mutation RED**: making the row return a fabricated non-null proof for the null `NoteDispositionChanged` proof fails the row (`unavailable`); restored byte-exact. **GREEN** U3 3/3.
3. D-rows' parameterized key helper replaced by the hand-written `AGENT_CARD_KEY` literal (`s4c2-note-2`/`s4a-scope-project`/v1); U6 D-01 asserts both object labels literally (`决定(目标 s4a-goal)：agent conclusion`, `坑(目标 s4a-goal)：user conclusion`). No production RED (expectation-only); focused 34/34.
**Mapping correction**: the pointer-move case is covered by `S4C2-U6-note-card-e2e.test.ts` ~211, not D17.

## CHECKS (`--maxWorkers=2`)

Business+architecture: 20 files / 200 tests (199 pass, 1 fail = baseline §A R5b). Remaining required groups (S4/S5 work-graph, scenarios S4C2, app S4C, WP2-wiring): 85 files / 996 tests (992 pass, 4 skip). Combined **105 files / 1196 tests: 1191 pass, 4 skip, 1 fail**, the fail being only `DSH-BASELINE.md` §A. Changed tests: read-counts 6, U3 3, D-rows 18, U6 16. `typecheck` 0; `check:architecture` 0 (`next source boundaries: OK`); `build` 0. Scratch deleted; no git writes.

## UNSPECIFIED

- Public catalog revision refuses module removal (`catalog-service.ts` "must not remove the existing module"; `S4B-note-anchor-status` marks it BLOCKED), so the retired target is interface `A/I1` removed by the same public revision; it reaches the identical `candidatesFor` catalog read. Options: accept, or add a public module-removal path (slice 6).
- Item 2's ordinary disposition is the scribe's `withdraw`: on a structural pending note `review` is unavailable and accept/reject are user-only; spec L17 counts withdraw as ordinary. Options: accept, or user-accept then scribe-review (two dispositions).