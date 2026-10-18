Read-only facts check of document drafts in this repository copy (the lead branch with slice 8 L8 applied; the drafts are uncommitted edits, listed in `./.lead-ref/docs.diff`; the book that asked for them is `./.lead-ref/s8l8-docs.md`; the material is under `./.dsh-ref/`: `books/`, `dsh/`, `codex/`, `checks/`). Answer in Chinese. Do not write any file, do not run tests.

Check every factual sentence the drafts add (spec-8 §13 and its header post-note, the evidence README and `lead-acceptance.md` under `docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/`, STATUS, WG59, the slices README, AGENTS) against the code and the material:
1. Behavior claims (triggers and which commits fire them; the driver; the request record and failure; retry; Host close; the observation-state read; the reminder kinds, wording and limits; chunk scope; cancellation; read counts): true at the code (file:line) or wrong (the right statement).
2. Every number (runs, tokens, lines, ids, counts) against the material; every cited ruling, row or review item against its source.
3. The known limits and the T list against the books (`l8-rework-2.md` ruling 3, `l8-rework-3.md`, `l8-rework-4.md`), `codex/verify3.out.md`, `codex/verify4.out.md` and `checks/user-decisions-1018.md`: anything missing or overstated.
4. Anything the drafts state as fixed or tested that the material says is partly, untested or moved to T.
5. Wording that a reader would misread (one line each, with a better sentence).

List must-fix items first (wrong facts), then suggestions. End with one line: must-fix count, suggestion count.
