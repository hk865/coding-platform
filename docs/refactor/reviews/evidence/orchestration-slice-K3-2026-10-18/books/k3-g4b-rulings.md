# K3 group 4 session B — lead rulings on the gaps Codex found (2026-10-17, draft for the g4b books)

Source: `codex2/k3g4-facts.out.md` §3. g4b starts after 4C-2 session B merges (U3/U6/U7 exist then). **Update 11:45: split in THREE (lead): g4b1 = cards, dispositions, application, UR7/UR7b, start-up kinds 3–4, earlier card parts (book `k3-g4b1-impl.md`, draft); g4b2 = the proposal round (L20, K3-16, 35 (二)(三), 46, 48 (二)) incl. the `awaiting_approval` card options and approval application; g4b3 = L19a. Each about 1,000–1,400 lines (decision 69).** Original two-way text:
books: **g4b1** = the review cards (UCR source registered through U7's `createCollectionCardSource`), dispositions and
answer application (U6 adapter `unknown_call_review`, U3 proof row `UnknownCallReviewChanged`), UR7/UR7b, start-up
6b (c) kinds 3–4, the proposal round (K3-16), K3-15 (一)(二)(三), K3-17, K3-18 (一) and (四)'s card, K3-20, K3-35
(二)(三), K3-41 (一), K3-44 (一)(三), K3-46, K3-48 (二)'s proposal half, the group-3 card assertions left over
(K3-03, 10, 11, 13, 19, 37, 42, 45 card parts); **g4b2** = L19a (CRR owner, the request tool, the `shell` hook,
script expansion, the CRR card source, B2-01..B2-18 except B2-10).

1. **M2's goal-level read of unapplied answers.** `listUnappliedAnswers` takes `{ reviewRef } | { goalRef }` — one
   internal reader over the `k3-decision-answer-by-source-goal` index (L28), the `goalRef` form returning each answer
   with its own `reviewRef`. Start-up 6b (c) kind 4 calls the `goalRef` form per active goal; UR7b drives each answer
   by its own `reviewRef` (M2). No second scanning port.
2. **CRR consumption and proof.** `consumeAllowance` takes the consuming call (`{ runId, callId }`); the record
   persists `usedBy: { runId, callId }` next to `usedAt` (CRR-03 "记下这次调用的 callId"). The request tool's result
   union is exactly L19a's: `requested | pending | allowed` (each with `requestId`), `refused` (`denied_final` |
   `denied_in_this_run`), `not_blocked`. The answer application's proof rides on the CRR changed event
   (`proof: DecisionChangeProofV1 | null`, null for every change that is not a card application), the same shape as
   4C-2 B's `NoteDispositionChanged`; U3 gets a `CommandRerunRequestChanged` row.
3. **No-write branches and replay.** The branches that write nothing (`not_blocked`, `pending`, `allowed`, `refused`)
   replay through the Kernel's recorded tool result (L14's "同一个工具调用重放回原结果" is the Kernel replay); no
   receipt record is written for them (B2-18 stands). After a crash mid-call the platform lookup for
   `request_command_rerun` answers `not_committed` when no CRR write carries the request id — correct, since nothing
   happened.
4. **Closing CRRs at task end, and recovery.**
   - **Closed is derived on read** when the task is no longer active (satisfied, cancelled, superseded): the CRR read,
     the card source (card to history) and the hook (no Run of an ended task) all treat it as `closed`, and an unused
     allowance is void. The persisted CRR-06 transition is written by the next owner operation that touches the
     request (an answer application, a new request for the same alias). No task-ending owner is edited.
   - **Answers while the goal is paused, and a crash between ② and ③:** one Workflow step applies answered, unapplied
     cards of the goal's tasks for both kinds (`unknown_call_review`, `command_rerun_request`) through U6's one advance
     function (UR7 generalised; ② replays by the answer-derived identity); start-up 6b (c) kind 4 lists both kinds by
     goal through the same index. A repeated `decisions/answer` replays too.
5. **The static `cd` for script expansion.** One parser: its parsed result carries, per action, `dirs` = the static
   `cd` paths before it in the same command, in order, or `null` when a `cd` before it is not static (`cd -`, bare
   `cd`, a non-static argument). `parseShellActions` keeps its public `{ words, text }` projection unchanged (B2-10's
   cases stay); the expansion uses `cwd` (or `"."` for the request tool) plus `dirs`; `null` → that action is not
   expanded.
6. **The blocked-commands section of the continuation brief.** A required part (it tells the agent what is blocked):
   one line per blocked command, at most 16 lines, then one count line ("另有 N 条被拦的命令；跑之前先用
   `request_command_rerun`"); each declared form shown truncated to 160 bytes, at most 3 per line ("等 N 种写法" for
   more). It counts in L20's required budget like the other required parts (capacity rejection as they do). With no
   blocked command the section is absent and the brief is byte-identical.

Post-notes to write at the K3 merge: the same six, plus `k3-merge-postnotes.md`.

**Update 2026-10-17 evening (lead, writing the B3 book): item 6 is replaced.** L20's budget table leaves about 600
bytes after the required parts at T = 512, C = 5,120; per-command lines as a required part (16 lines with request
states and declared forms) can exceed that and turn a later continuation into `capacity`. New rule (B3 book section 2
item 7): the 62-byte sentence "- 平台拦下原命令；要再跑先请求并得到允许。" in the K3 required part is the required signal,
present exactly when the record's `blockedCommands` is non-empty; the per-command lines (`### 被拦的命令`, one line per
blocked command with the newest request state and up to 3 declared forms of 160 bytes, at most 16 lines plus a count
line) are optional, omitted first from the section's last line when over budget, counted in today's omission note.
Post-note at the K3 merge.
