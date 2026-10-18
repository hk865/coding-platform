You are a read-only code-facts checker for the lead of this repository. Do not modify files. You may run read-only commands (search, reading files). Do not run tests or builds. Write the report in plain Chinese, with file:line for every code fact.

The working directory is the lead branch after slices 8A and 4C-2 session A merged, with K3 groups 1–3 rebased on top (K3 is not merged yet; its groups are built in a separate copy). The K3 spec is `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (frozen, eighth draft). §7 lists four construction groups; groups 1–3 are done. What groups 1–3 built and left open is in `.lead-ref/k3-g2a-final.md` … `.lead-ref/k3-g3f-final.md` (DSH replies, in order). The lead's reuse rulings are `.lead-ref/reuse-rulings.md`: U3 (proof-event decoder table), U6 (application dispatch) and U7 (card-source paging adapter) are shared with slice 4C-2 session B, whose book is `.lead-ref/s4c2b-impl.md`; **4C-2 session B is building U3/U6/U7 now**, and K3 will add its rows on top after B merges.

The lead will write the group-4 construction books from your report, split in two sessions: **g4a** may start now and must not depend on U3/U6/U7; **g4b** comes after 4C-2 session B merges.

Group 4 (§7 item 4): K3-08, K3-09, K3-15..K3-18, K3-20, K3-35 (二)(三), K3-25..K3-29, K3-41, K3-43, K3-44, K3-46, K3-47 (二)..(四), K3-48 (三); M1's K3-15 (七), M2's K3-44 (三); L19a's request tool `request_command_rerun`, the `command_rerun_request` card source, answer application and CRR `closed`, and the `shell` `before_tool` seam (B2-01..B2-18). The rows are in §5.2; the rules in §1 (L-numbers), §2 (interfaces), §3 (state and flow rows, §3.4 Workflow), §4.

A known gap the lead found in group 3 (check it and say where it is now): a `needs_decision` record still lets a later advance requeue and claim — `workflow.ts` (~1239 in the old copy) returns `pass`, the claim service has no `reviewPending` producer, and plan-service's AV-2b input lacks the reviews.

Report:
1. **Per row:** what groups 1–3 already built for it (file:line), and what is missing. Group the rows by the spec part they exercise (Workflow gate and `selectNext`; hold/release, "我来处理" and the D3 race; recovery L29 and start-up 2b/6b; the proposal round; cards and their text; dispositions and answer application; the shell hook and the request tool; size admission).
2. **Split:** classify each row as **A** (no dependency on the card source, the decision application dispatch or the proof events, U3/U6/U7) or **B** (needs them). Where a row has an A part and a B part, say which assertions fall in each. Name every interface g4a must leave for g4b (and confirm g4a can be tested end to end through public owners without the cards — if a row cannot, say so).
3. **Gaps the spec does not settle** after groups 1–3 and the rebase (ports that do not exist, rows with no state-machine line, conflicts with the code of 4C-1, 4C-2 session A or 8A). For each: the question and the smallest options.
4. **Old tests that will change** (§5.3 rows of group 4, and any others), with file:line and why.
5. **Stale spec line references** in §1–§3 and §5.2 for group 4 (spec line → current file:line).
6. **Size:** a rough production-line estimate for g4a and g4b.

Keep it under about 5,000 Chinese characters. Do not propose design changes beyond the smallest options in item 3.
