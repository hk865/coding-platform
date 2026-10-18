# Task: read-through before K3 group 4 session B3 (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 30 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/k3-g4b3-impl.md`: the construction book a new session (coordinator mode, `./.dsh-ref/coordinator-mode.md`,
  no fixed limit on subagents, decision 76) will build from right after this. Its section 1 lists what group 1 already
  built; `./.dsh-ref/k3-g4b-rulings.md` items 2–6 (item 6 replaced, see its last paragraph and the book's item 7).
- What sessions B1 and B2 built: `./.dsh-ref/k3-g4b2-impl.md` (section 8), `./.dsh-ref/k3-g4b2-final.md`,
  `./.dsh-ref/k3-g4b1-impl.md` (section 8), the B1 rework books and replies.
- The spec lines the book names in `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (L19a whole,
  L19, L20, §2's CRR contracts and request tool, §3.2b, §5.2 B2-01..B2-18, K3-15, K3-35).
- The code those touch: `state/command-normalization.ts`, `state/command-rerun-request.ts`,
  `model/command-rerun-request-contracts.ts`, `src/contracts/command-rerun-request.ts`, `goal-decisions.ts`,
  `unknown-call-review.ts` (contract and state), `unknown-call-review-service.ts` (② for `skip_as_done` and
  `approve`), `unknown-call-review-card.ts`, `unknown-call-review-answers.ts`, `decision-read-model.ts`,
  `decision-source-facts.ts`, `decision-actions.ts`, `workflow.ts` (UR7), the Host start-up (6b), the `before_tool`
  hook seam in `execution-driver.ts` and the Runtime's tool hooks, `execution-preparation.ts`,
  `prepared-execution.ts`, `context-assembler.ts`, `continuation-brief.ts` and its assembly, `WorkspaceToolsPort`,
  `create-platform.ts`, the stand-in `shell` and the crash fixtures of §5.1 under `tests/`.

## Report (under 1,000 words)

1. **Unclear:** every rule or row you could not implement without guessing; the question and the smallest options.
   In particular: whether `parseShellActions` already gives what ruling 5 needs; whether the CRR state table and
   contracts match §3.2b and ruling 2 (`usedBy`, the result union, the proof on the changed event); where the
   `before_tool` hook can read the task's records and CRRs and the workspace read port; how today's renderer omits
   optional lines and whether item 7's "blocked lines first" order fits it.
2. **Book or spec differs from the code:** a name, file, function, field or line that is different.
3. **K3-35 by hand:** compute (二)'s worst-case bytes with the 62-byte sentence and the blocked lines of item 7 for 32
   approved targets with no requests (each line's bytes, the heading, the count line, the joins), say how many blocked
   lines fit and the omission count, and (三)'s overflow with T = 600.
4. **Tests that will break:** existing tests you expect to fail after this work beyond the K3-16 approve flip, with
   file:line and why.
5. **Plan:** your split into subagents (disjoint files; as many at once as the work allows), a time estimate per item,
   and the production line estimate.
