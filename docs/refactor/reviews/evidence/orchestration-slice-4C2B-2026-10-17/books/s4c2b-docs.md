# Task: draft the documents for merging slice 4C-2 session B (docs only; Chinese)

You are working in a copy of a repository's documents (the current directory). This is a NEW session. You write
**document drafts only**: no code, no tests, no builds, no git writes, no network, no real model calls. The lead reviews
every line before anything is used. **Finish within 90 minutes** (the run stops at 100). Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); files of running subagents disjoint; **do not end your turn while a subagent has not
reported back.**

**This run is headless. When your turn ends, the whole run ends.**

## 1. What happened (the material is in `./.dsh-ref/`)

Slice 4C-2 (spec `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` §11, split in two sessions) —
session A merged earlier (evidence `docs/refactor/reviews/evidence/orchestration-slice-4C2A-2026-10-17/`, spec §13).
Session B (note cards and their application, proof events, "请知悉", and the shared U3/U6/U7 that K3 group 4 reuses)
is now accepted and merges. Its record, in order:
- read-through: book `books/s4c2b-preread.md`, reply `dsh/preread-final.md`; lead answers = section 7 of `books/s4c2b-impl.md`;
- build: book `books/s4c2b-impl.md`, reply `dsh/final-1.md`;
- Codex implementation review `codex/review.prompt.md` / `codex/review.out.md` (9 items, 8 must-fix + 1 test expectation);
  verification by a Claude subagent `books/verify-s4c2b.md`; lead rulings in `books/s4c2b-rework.md`;
- rework 1: book `books/s4c2b-rework.md`, reply `dsh/rework-1-final.md`; Codex recheck `codex/review2.*`;
- rework 2: `books/s4c2b-rework-2.md`, `dsh/rework-2-final.md`; Codex quick check `codex/review3.*`;
- rework 3: `books/s4c2b-rework-3.md`, `dsh/rework-3-final.md`; Codex quick check `codex/review4.*` ("可以合入");
- the merge tree passed the full suite (535 files; 8,211 passed, 5 skipped; 2C-26 fixed);
- the 20,000-note measurement (spec line 918): `checks/measure-4c2-investigation.md` (Claude subagent), Codex recheck
  `codex/measure-recheck.*`, four Claude verifiers `books/verify-measure-fixes.md`, rework 4 book
  `books/s4c2b-rework-4.md` (lead rulings A and B), reply `dsh/rework-4-final.md`, Codex quick check `codex/review5.*`
  ("可以合入"); measurement numbers before/after in `checks/measure-4c2-smoke.out.json`, `checks/measure-4c2-after.out.json`
  (the measuring script `checks/measure-4c2.mjs`);
- the merge tree of rework 4: full suite result in `checks/merge-full-suite-summary.txt` (if present; else leave a
  `【lead 填】` placeholder).

Run numbers (DSH main session): preread 291 s / 7.70M tokens; build 4,698 s / 31.92M / context peak 302,657; rework 1
2,481 s / 8.01M; rework 2 1,464 s / 6.24M; rework 3 733 s / 7.89M; rework 4 1,022 s / 4.34M / peak 151,293.
Production lines (`src/`) per round: build +1,462/−119; rework 1 +502/−389; rework 2 +93/−21; rework 3 +56/−14;
rework 4 +137/−118; total vs the lead branch: 24 files +1,946/−357 (net about 1,589); tests 30 files +4,132/−31.
Measurement (counts are exact; times were taken with three DSH runs and a full suite on the machine, load 7–10):
heartbeat `readScribeTodos` over 101 goals 2,254 calls → 627 (budget 610 + 15 stage plan lookups + 2 catalog), about
0.85 s → 0.19 s; Goal-card memory material 43 → 36 calls; find first page unsegmented 209 → 202, segmented 222 → 215,
about 126–200 ms (over the 100 ms ruler; see the investigation and "Item 4" of the verifiers for the reason and the
draft paragraph); lookup and stale within their rulers.

## 2. What to draft (edit the files in this copy)

Write Chinese in the style of the existing documents: short sentences, plain words, numbers exact, one idea per bullet,
like spec §13 and the 4C-2A evidence. Follow the formats of the 4C-2A counterparts exactly.

1. **Spec-4 §14 "4C-2 B 段施工和验收中的限定（lead，2026-10-17）"** appended after §13, and one header post-note line
   (like the "后注（4C-2 A 段验收…）" line). Collect every reading settled during B's read-through answers, the rework
   rulings and the accepted UNSPECIFIED items, grouped by topic (card source U7, application dispatch U6, proof decoder
   U3, dispositions and the gate order §11.6, "请知悉", the read budget and the measurement fixes). Must include: M3
   `seenThrough` counts earlier pages; the target batch is one per goal; `source_stale` as a code with the pin-set
   compare; the card's goal tie; proof changes per head (`NoteHead@v → @v+1`); `createCollectionCardSource`; U6's
   default `goal_conflict` adapter; all note options `effect: 'apply'`; `AGGREGATE_REF_RULES`; the 2C-26 test fix (fake
   `Date`); rework 4's rulings A (`symbol_missing` is a file reason; the non-file reasons) and B (another workspace of the
   same project on the reason path); the scribe to-dos use `userReasonFacts` (this replaces §13 item 2's "读到的触发交给
   核对"); §11.7's lines 910/912 reworded (the project anchor set read once and shared with the check; give the
   arithmetic `Σ max(1, ⌈n_s/200⌉)`); the find-ruler explanation. Cite each item's source (book section, review item).
2. **Evidence README** `docs/refactor/reviews/evidence/orchestration-slice-4C2B-2026-10-17/README.md`: what B is, the
   result line (merged, commit `【lead 填】`), the table of rounds (like 4C-2A's), totals.
3. **`lead-acceptance.md`** in the same folder: the acceptance judgment per scope item and per review item (fixed, how),
   the measurement result with the ruler paragraph, known limits (e.g. the find first page over 100 ms and why; K3's
   use of U3/U6/U7 comes in K3 group 4 session B1; anything the replies list as untested and why).
4. **`docs/refactor/STATUS.md`**: a 4C-2B bullet like the 4C-2A one, the "last check" line (placeholder for the suite
   numbers), known limits for 4C-2B, and next steps (K3 group 4 B1 next; 8D building; the 8A observation-scale fix after
   8D, decision 77).
5. **`docs/refactor/IMPLEMENTED-CAPABILITIES.md`**: WG57 like WG56.
6. **`docs/refactor/design/orchestration-2026-10/slices/README.md`** and **`AGENTS.md`** status lines: 4C-2 B merged.

Do not copy the material files into the evidence folder (the lead does that); refer to them by the paths given in
section 1 relative to the evidence folder (`books/…`, `dsh/…`, `codex/…`, `checks/…`).

## 3. Reply

Under 300 words: the files you edited, anything you could not decide (with options), and any fact in the material that
contradicts another.
