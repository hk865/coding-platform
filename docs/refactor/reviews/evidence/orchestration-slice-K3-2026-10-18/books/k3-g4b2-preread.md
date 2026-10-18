# Task: read-through before K3 group 4 session B2 (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/k3-g4b2-impl.md`: the construction book a new session (coordinator mode, `./.dsh-ref/coordinator-mode.md`,
  no fixed limit on subagents, decision 76) will build from right after this.
- What session B1 built: `./.dsh-ref/k3-g4b1-impl.md` (section 8 = the lead's answers), `./.dsh-ref/k3-g4b1-final.md`,
  the rework books `./.dsh-ref/k3-g4b1-rework-1.md` … `-4.md` (their rulings are binding) and their replies
  `./.dsh-ref/k3-g4b1-rework1-final.md` … `rework4-final.md`.
- The spec lines the book names in `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (L13–L20, §2's
  `propose_safer_method`, §3.2 UCR-03..15, §3.4 UR1–UR7, §5.2 K3-16, K3-19, K3-35, K3-46, K3-48).
- The code those touch: `src/contracts/review-admission.ts`, `src/core/agent-runtime/unknown-call-review-tools.ts`,
  `context-assembler.ts` (the review round's input), `execution-driver.ts` / `execution-contracts.ts` (tool
  registration), `unknown-call-review-service.ts`, `state/unknown-call-review.ts`, the UCR codecs,
  `unknown-call-review-card.ts`, `decision-read-model.ts`, `decision-source-facts.ts`, `decision-actions.ts`,
  `workflow.ts` (UR1/UR2/UR4/UR6/UR7 for the proposal phase), `src/contracts/continuation-brief.ts` and
  `continuation-brief-assembly.ts` (the required part and `approvedMethods`), `create-platform.ts`.

## Report (under 900 words)

1. **Unclear:** every rule or row you could not implement without guessing; the question and the smallest options.
   In particular: the approval card's option labels (does the spec give them?), where the proposal round's input is
   assembled and what it shows today for the review phase, and how the brief's required part is measured today.
2. **Book or spec differs from the code:** a name, file, function, field or line that is different.
3. **Tests that will break:** existing tests you expect to fail after this work beyond the two the book names, with
   file:line and why.
4. **B2/B3 split:** any row assertion in book section 3 that needs L19a (B3), and any B3 piece you think B2 cannot
   avoid.
5. **Plan:** your split into subagents (disjoint files; as many at once as the work allows), a time estimate per item,
   and the production line estimate.
