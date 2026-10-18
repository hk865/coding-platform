# Task: draft the documents for merging slice 8 L8 (docs only; Chinese)

You are working in a copy of the repository (the current directory): the lead branch with L8 applied. This is a NEW
session. You write **document drafts only**: no code, no tests, no builds, no git writes, no network, no real model
calls. The lead reviews every line before anything is used. **Finish within 80 minutes** (the run stops at 90). Work in
coordinator mode (`./.dsh-ref/coordinator-mode.md`); files of running subagents disjoint; **do not end your turn while
a subagent has not reported back.**

**This run is headless. When your turn ends, the whole run ends.**

## 1. What happened (the material is in `./.dsh-ref/`)

Slice 8 (spec `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`). 8A merged earlier (spec §9, evidence
`orchestration-slice-8A-2026-10-17`); 8D and the §10 segment merged on 2026-10-18 (spec §12, evidence
`orchestration-slice-8D-2026-10-18`). **L8** (the automatic capture after registration, adoption and PASS; the request
record with its failure and the retry at Host start; the observation-state read; the stale-architecture reminder) now
merges. Record, in order:
- read-through: book `books/l8-preread.md` → `dsh/preread-final.md` (reuse map, 11 questions, estimate 850–1,100 lines);
- build book `books/l8-impl.md` (rulings 1–12); Codex checks of the book `codex/book1.*` (7 must) and `codex/book2.*`
  (3 must), applied before the build;
- build → `dsh/impl-final.md`; Codex review `codex/review1.*` (7 must); the lead's bubblewrap check (2 failures, added
  as items 8–9);
- rework 1: `books/l8-rework-1.md` (+ resumes `books/l8-rework-1-resume.md`, `books/l8-rework-1-resume2.md`: the
  sessions died on transport errors three times) → `dsh/rework1-final.md`; Codex `codex/review2.*` (its UNSPECIFIED 6
  was a production defect: chunk bodies without the workspace scope);
- **decision 80** (2026-10-18, HANDOFF): one uncapped Codex audit, a frozen finding table, the ledger script every round,
  at most three reworks. The full audit `codex/audit.*` (33/33 files; KNOWN 1–5, T01–T71, P01–P16, S01–S12, Q1–Q6) and
  the book check `codex/book3.*`; the test rule sheet (`checks/test-rule-sheet-v1.md`, `-v2.md`, `-v3.md`) and the
  ledger script `checks/d1-ledger.py`;
- rework 2 (decision 80's rework 1, the frozen table): `books/l8-rework-2.md` (rulings 1–9) with its check
  `codex/book4.*` → `dsh/rework2-final.md`; Codex `codex/verify2.*` (90 ids: 61 fixed, 27 partly, 2 not; four
  production defects B-1, B-2, B-3, C-1);
- rework 3: `books/l8-rework-3.md` (rulings 1–7) with its check `codex/book5.*` → `dsh/rework3-final.md`; Codex
  `codex/verify3.*` (20 fixed, 13 partly; 1 ledger weakening; 17 new rule instances; 3 production defects);
- **the product owner's decisions of 2026-10-18** (`checks/user-decisions-1018.md`): Codex's findings were classified
  by business consequence (`checks/l8-business-classification.md`); the last rework does only the rows that matter to
  the business, and the rows about test form go to the cleanup round T;
- rework 4 (the last): `books/l8-rework-4.md` with its check `codex/book6.*` → `dsh/rework4-final.md`; Codex
  `codex/verify4.*` (4 of 5 rows fixed; P3 partly). Under decision 80-4 the lead then fixed P3's last await directly
  (`checks/lead-fix.diff`);
- the D1 ledgers per round `checks/d1-*.txt`; the lead's bubblewrap checks per round `checks/round-checks.txt`; the
  merge tree's full suite `checks/merge-full-suite-summary.txt` (if present; else a `【lead 填】` placeholder).

Run numbers (DSH main session; seconds / total tokens / context peak): read-through 485 / 12.30M / 196,629; build
4,423 / 20.85M / 272,228; rework 1 in four sessions 327 / 1.65M / 85,170, 3,220 / 7.22M / 183,489, 81 / 0 / 0 (failed at
the first call), 376 / 4.61M / 200,473; rework 2 2,171 / 24.93M / 290,226; rework 3 1,958 / 18.47M / 266,407; rework 4
471 / 10.28M / 156,491. Production lines (`src`, `scripts`, `runtime-assets.json`) per round: build +1,505/−30; rework 1
+249/−97; rework 2 +286/−106; rework 3 +199/−41; rework 4 +29/−4; the lead's fix +3/−1. Total against the lead branch:
`checks/merge-stat.txt` (production 21 files about +2,111/−119; the lead fills the exact line).

## 2. What to draft (edit the files in this copy)

Write Chinese in the style of the existing documents: short sentences, plain words, numbers exact, one idea per bullet,
like spec §9 and §12 and the 8D evidence. Follow the formats of the 8D counterparts exactly.

1. **Spec-8 §13 "L8 施工和验收中的限定（lead，2026-10-18）"** appended after §12, and one header post-note line (like
   the "后注（8D…）" line). Collect every reading settled in the book rulings (l8-impl 1–12, rework 2 rulings 1–9,
   rework 3 rulings 1–7, rework 4 rulings 1–2 and rows P1–P3), the applied book checks and the accepted UNSPECIFIED
   items, grouped by topic (triggers and the driver; the request record, failure and retry; Host close and restart;
   mappings, latest and previous; the observation-state read; the chunk format and workspace scope; the reminder and
   the preparation; cancellation and commits; read counts; tests). Must include:
   - detached triggers only after a non-replayed commit; one serial, coalescing driver per Host; the driver's own key
     with an unambiguous tuple encoding (`P12`); the request record and its revision; the failure write belongs to the
     running round; retry at Host start; Host close stops and aborts the automatic capture first;
   - the chunk format (B R2-1, R2-2): every chunk carries its workspace scope, including the empty chunk; same-scope
     reuse; only the new shape is read (decision 79);
   - one precedence for commits and cancellation (rework 3 ruling 2, all six points), the reads (ruling 3), cancellation
     through the preparation (ruling 4: ports with no cancelled result are judged by the signal only);
   - read counts: one public `runtime.prepareExecution` reads 12 (5 records + 7 bodies) without a previous observation
     and 21 (6 + 15) with one, counted per call;
   - rework 4: a ready capture cancelled at its return is still released; the cleanup never rewrites an earlier error;
     the archive changed-files reader keeps the archive call's own cancellation (and the lead's fix after the workspace
     fallback);
   - **known limits**: `P01`–`P04`, `P10`, `S09`–`S11` (rework 2 ruling 3: background failures that cannot be recorded
     stay silent until the next trigger or restart); the archive itself still turns a cancelled facts read into
     unavailable facts (`session-archive.ts:244–248`);
   - **moved to the cleanup round T** (one bullet each, with its source): the replay branches of `requestAutoCapture`,
     `failAutoCapture` and the automatic capture (no public step re-sends a command); the cancellation branches of
     `requestAutoCapture` and `failAutoCapture` (the driver never aborts the acceptance signal,
     `auto-capture-driver.ts:109`); rework 3's partly rows A (per-await cancellation rows through a requeue), B (the
     trigger through the real composition callback; the test copies the wrapper) and J (`input = null`); rework 3's
     UNSPECIFIED 4; the P3 rows' hand-built health probe, their own archive composition and SQLite-only backend
     (`S1-runtime-scenario-fixture.ts:159`); the old WP2 debt `K4-25`–`K4-53`, `T33`–`T69`, Q6; `host.ts:183`'s key;
     `Pub:332`'s written body not read back.
   Cite each item's source (book and ruling or row, review item, reply item).
2. **Evidence README** `docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/README.md`: what L8 is, the
   result line (merged, commit `【lead 填】`), the table of rounds (like 8D's), totals, the size against the estimate,
   and how decision 80 and the product owner's decisions changed the rounds.
3. **`lead-acceptance.md`** in the same folder: the acceptance judgment per scope item of spec 8's L8 part and per
   review item (fixed, how), the known limits and the T list of item 1, anything the replies list as untested and why.
4. **`docs/refactor/STATUS.md`**: an L8 bullet like the 8D one (L8 merged), the "last check" line (placeholder for
   the suite numbers), known limits for L8, and next steps (K3 group 4 B3 rework 9b running, then its merge; cleanup C1
   after K3; then T in parallel with 6A).
5. **`docs/refactor/IMPLEMENTED-CAPABILITIES.md`**: WG59 like WG58.
6. **`docs/refactor/design/orchestration-2026-10/slices/README.md`** and **`AGENTS.md`** status lines: L8 merged.

Do not edit `docs/refactor/HANDOFF.md` (the lead writes the decision record). Do not copy the material files into the
evidence folder (the lead does that); refer to them by the paths given in section 1 relative to the evidence folder
(`books/…`, `dsh/…`, `codex/…`, `checks/…`).

## 3. Reply

Under 300 words: the files you edited, anything you could not decide (with options), and any fact in the material that
contradicts another.
