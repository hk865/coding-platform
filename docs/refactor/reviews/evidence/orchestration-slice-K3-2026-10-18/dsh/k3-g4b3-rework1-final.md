**FILES / LINES.** Production: 41 modified + 4 new helpers, **+1,359/−828, net +531 vs B3**. Per item (gross; the CRR/UCR owners are shared by 1,2,3,4,7,8,12): 1 prepare +85, UCR service +26, assembler +15; 2 recognizer +103/−84, hook −26; 3 expansion +76/−47, normalizer +6; 4 plan-readers +63, card/read-model/facts +60; 5 card +33/−16, read-model +38/−14; 6 workflow +165/−88, contracts +31/−5, driver +13/−13; 7 service/codecs (shared, +165/+17); 8 tool +47/−11, model contract +16/−8; 9 continuation +28/−10; 10–11 tests only; 12 new helpers +268, note-service +75/−51, UCR codecs +4/−49, goal-settings +1/−10 = **+238 net**. Tests: 30 modified + 15 new (~4,980 added).

**ITEMS (RED → GREEN / checked).**
1. RED: task-form paging filtered before fixing the merged window, so the a201/z target was lost; silently capped at 32. GREEN: raw window/cursor fixed before the task filter (0-item page with an advancing cursor), cap gone, binding and blocked lines from one read. `B2-01-task-read`, B2-01 13/13.
2. RED on HEAD hook: 3/6 failed (later exact beat earlier action; local fallback blocked on read failure; missing recognizer). GREEN 6/6: one recognizer collects exact/action/current-expansion/stored declared forms, first by (createdAt, alias); package failure loses only that expansion. `B2-02`, B2-12-recognition 8/8.
3. RED normalizer 3/60. GREEN 60/60; pipeline-exit restores outer dirs; expansions keyed (directory, script), each level its own entry+basis; scriptText cut sets `truncated`; 16 KiB includes `reviewRunId`. B2-11 22/22, B2-17 3/3.
4. One `readTaskClosure` from canonical facts (satisfied/cancelled/superseded), shared by CRR list, card, tool, hook, consume, prepare; read failure `unavailable`; next owner op persists CRR-06. B2-09 closed 6/6, card-closed 4/4, one canonical read per task asserted.
5. Public card label is the full summary; earlier requests are strictly created-before, ≤5 newest-first. B2-07 4/4 with a literal public-card assertion.
6. Internal discriminated failed-card set, both kinds; ordinary advance skips both; later failure never overwrites; named-task keeps waiting; never public. `K3-UR7` 5/5 incl. real driver carry, K3-46 8/8, rows 31/31.
7. One physical page per `listRequests`; one `lookupAll` task set. **R=401 → exactly 3 pages [200,200,200]**; B2-18 3/3.
8. `CommandRerunRequestReplyV1`: no-write outcomes vs `WriteResult` with the real cursor; tool maps both. B2-03 4/4, B2-09 14/14.
9. Count line is its own last entry; removed first; every candidate measured with the note incl. early returns. 17-command case keeps all 16 lines; `K3-15-blocked-omission` 4/4.
10. 8 anchors from real interrupted runs archived through the public path with the capture made to fail; real requeue/claim/prepare readers; blocked fixtures from a real Work Run + §5.1 shell + Kernel; answers saved before applied.
11. B2-09b SQLite E2E: approval→consume commits→crash→restart shows `used`+`usedBy`, `outcome_unknown`, K3 review. B2-15 replay byte-identical after `package.json` change, no re-parse/read; no-write replay. Prefix ambiguity via injected id generator lists both full UUIDs. Whole required block restored as one literal.
12. One receipt replay, revision guard, codec fields, source-identity parse, contract index names; all CRR fields/events/indexes kept.

**TOTALS.** Before (B3): +4,155/−139, **net +4,016** vs `k3-g4b2-r1`. After: +4,941/−394, **net +4,547**. K3-35: direct **16,290** (was 16,369), prepared **16,332** (16,366); T=512 **16,381** (15,761); T=600 reachable **16,326**, prepare ready (was 16,396→capacity).

**FACT GREP.** 44 changed test files, 69 hits: no new hand-written platform facts. All are input fixtures, fault/counting wrappers, casts of public owner values, or pure-function inputs. Dead hand-built `runOf/recordOf/requeueOf` exports and an empty-index stand-in were removed. One pre-existing item (not added here): `S5-decision-fixture` directly encodes Project/Workspace/Goal/Plan rows; the rework only adds the SESSION_ANOMALY schema.

**CHECKS** (`--maxWorkers=2`). G1 153 files/849 tests: 834 pass, 15 baseline (K-readonly-sandbox, no bwrap). G2 103/779: 778 pass, 1 baseline (R5b). G3 79/4,021: 3,970 pass, 29 skip, 22 baseline. G4 66/612: 581 pass, 30 baseline; the 1 NEW (production-reach) was fixed → 4/4. G5 16 changed-only files/113 pass. Key re-run: 11 files/37 pass. `typecheck` 0; `check:architecture` OK; `build` OK.

**UNSPECIFIED.**
1. K3-35 (三): with the real reader the changed-file source is `unknown` (no 118-byte worktree line), so T=600 no longer overflows (mandatory 15,409, total 16,326). Capacity is asserted in the pure-renderer test with L20's worst case (item 10 allows extreme values there). Option: accept, or require a worktree+unavailable fact public steps cannot produce.
2. K3-35 scaffold briefs omit the anomaly section so the 8 anchors stay pending; alternative is 1 pending anchor (~7,000 bytes smaller).
3. B2-01 platform-only `skip_as_done` unreachable (only a shell stand-in exists); smallest option: a blocking non-process tool seam.
4. B2-09b: the second automatic RUN-25 is refused by G9, so the record is opened by the public operator attestation `executions/resolve-unknown` (K3-28). Option: accept.
5. Request-tool no-write pending/allowed does one point `readRequest` to name the waiting form (the frozen reply carries only `requestId`): 3 pages + 1 point read + 1 write. Option: add `command` to the reply.
6. `readTaskClosure` absent in an old direct caller is treated as open (composition always wires it); option: make it required.
7. Earlier-request tie on equal `createdAt` uses ref-key descending (spec silent).
8. A8-3n timeout remains the no-bwrap baseline.

Subagents: 10 tasks, max 8 at once; wall ~80 min. No `.dsh-scratch` remains.