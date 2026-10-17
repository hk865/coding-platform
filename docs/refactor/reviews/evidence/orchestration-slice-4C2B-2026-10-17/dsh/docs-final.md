Done — docs only; no code, tests, builds, git writes or network.

**Files edited**
1. `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` — B post-note, new §14 (10 topic groups with sources), and §11.7's two project-anchor lines reworded with `Σ max(1, ⌈n_s/200⌉)`.
2. `docs/refactor/reviews/evidence/orchestration-slice-4C2B-2026-10-17/README.md` (new, 49 lines).
3. `docs/refactor/reviews/evidence/orchestration-slice-4C2B-2026-10-17/lead-acceptance.md` (new, 88 lines).
4. `docs/refactor/STATUS.md` — B bullet, last-check line, B limits, next steps.
5. `docs/refactor/IMPLEMENTED-CAPABILITIES.md` — B header + WG57.
6. `docs/refactor/design/orchestration-2026-10/slices/README.md`.
7. `AGENTS.md`.

**Left open / placeholders**
- B commit, merge-tree/patch sha256, run time, memory peak: `【lead 填】`. The B evidence `checks/` folder is absent, so the suite numbers 535 / 8,211 / 5 and “2C-26 fixed” come from your brief.
- Heartbeat catalog: investigation writes 627 = 610 + 15 + 1 catalog (arithmetic 626); your brief and Codex say +2. I used +2.
- Load: investigation says 7–8; your brief says 7–10. I used 7–10.
- Find times vary by run; I wrote the before/after ranges and the 126–200 ms overall range.

**Contradictions found**
- `books/s4c2b-impl.md` §7.14 calls F06 (“另有 3 条”) a session-A regression; review item 9 and `books/verify-s4c2b.md` §9 show 2 is correct after B registers `note_review`. Drafts use 2.
- The investigation says neither 4C-2 session touches `note-read-model.ts` / `note-views.ts`; verifier Item 4(3) says session A changed them by +464/+177.
- §13's “读到的触发交给核对” is about update-due triggers, while the B change is about relation-target reasons. I recorded both separately: relation reasons now use `userReasonFacts`; update-due triggers are unchanged.

WG57's source/test links resolve only when the B code tree is present in this copy.