# C1 run: group G1 公共基础

- **Book:** `./.dsh-ref/c1-book.md` (v2). Do group **G1** only. Not split: Codex estimates 1,000–1,200 added + deleted lines; if your own count while working heads clearly above 1,200, finish G1a's files (book §4) first, stop, and report — the lead then runs G1b.
- **Working root:** this copy. **Base:** tag `c1-base` (= lead commit `5e83681b`, the lead branch with K3 merged). Count lines against `c1-base`.
- **Earlier groups:** none. You create the cross-group shared modules; later groups import them.
- **File whitelist (only these may change or be created):**
  - `src/contracts/validation/common.ts`, `src/contracts/fingerprint.ts`;
  - new `src/contracts/core/rejections.ts`, new `src/contracts/input-declaration-id.ts`;
  - `src/core/work-graph/persistence/**` **except** `persistence/note-record-codecs.ts` (G3); new `persistence/event-envelope.ts`, new `persistence/event-validation.ts`;
  - `src/core/work-graph/materials/**`, `src/core/work-graph/evidence/**`;
  - `src/core/work-graph/tasks/codec-fields.ts`, `src/core/work-graph/tasks/codec-shape-checks.ts`.
- **Hand-over you must produce** (book §5, §6): the interface table (every shared export you create: module, name, signature, return shape, source implementation, consumer groups), and the list of declarations whose consumers are all in later groups (path + symbol) with the production-reach failures you saw matched one-to-one to it.
- **Inputs in `./.dsh-ref/`:** `c1-book.md`, `c1-book.out.md`, `c1-book2.out.md`, `c1-refresh.out.md`, `c1-delta.out.md`, `2026-10-16-cleanup-list.md`, `*.clean.md`, `common.md`, `verify.json`, `decisions-35-70.md`, `coordinator-mode.md`.
