# Task: draft the documents for merging slice 8D and the §10 segment (docs only; Chinese)

You are working in a copy of the repository (the current directory): the lead branch with 8D and the §10 segment
applied. This is a NEW session. You write **document drafts only**: no code, no tests, no builds, no git writes, no
network, no real model calls. The lead reviews every line before anything is used. **Finish within 90 minutes** (the run
stops at 100). Work in coordinator mode (`./.dsh-ref/coordinator-mode.md`); files of running subagents disjoint; **do
not end your turn while a subagent has not reported back.**

**This run is headless. When your turn ends, the whole run ends.**

## 1. What happened (the material is in `./.dsh-ref/`)

Slice 8 (spec `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`). 8A merged earlier (evidence
`docs/refactor/reviews/evidence/orchestration-slice-8A-2026-10-17/`, spec §9). 8D (per-language observation: Python
and C/C++ providers; after decision 78 the light import scan of §11) and the §10 segment (the observation scale fix of
decision 77, the TS light scan of §11.2, and decision 79's removal of old-format reading) merge together now. Record,
in order:
- 8D read-through: Codex facts check `codex/facts.*`; book `books/s8d-preread.md`, reply `dsh/preread-final.md`;
- 8D build: book `books/s8d-impl.md`, reply `dsh/final-1.md`; Codex review `codex/review.*` (6 must + 1 suggestion);
  Claude subagent verification `books/verify-s8d.md` → `checks/verify-s8d.out.md` (5 hold, 1 partly, 1 more found);
- decision 78 (2026-10-17 afternoon) and spec §11 (frozen as draft 6, 13551ac9), with the C/C++ and runtime-dependency
  measurements `checks/measure-cpp/report.md`, `checks/measure-runtime/report.md`;
- 8D rework 1 (§11): read-through `books/s8d-rework-preread.md` → `dsh/rework-preread-final.md`; book
  `books/s8d-rework-impl.md` → `dsh/rework-1-final.md`; Codex `codex/review2.*`;
- rework 2: `books/s8d-rework2.md` → `dsh/rework-2-final.md`; Codex `codex/review3.*`;
- rework 3: `books/s8d-rework3.md` → `dsh/rework-3-final.md`; Codex `codex/review4.*` (one item left, moved into §10);
- §10 spec: the 8A measurement `checks/measure-8a-report.md`, the scale-cost measurement
  `checks/measure-8a-scale-cost.md`, Codex `codex/scale-recheck.*`, two spec reviews `codex/scale-spec-review.*`,
  `codex/scale-spec-review2.*` (committed as spec §10, f15f25a4);
- §10 segment: read-through `books/s8a-scale-preread.md` → `dsh/scale-preread-final.md`; build `books/s8a-scale-impl.md`
  (the run died on an invalid API key; resumed with `books/s8a-scale-impl-resume.md`, which carries the lead's A-06
  ruling and two bubblewrap failures) → `dsh/scale-final.md`; Codex review `codex/scale-review.*` (7 must + 1
  suggestion, incl. decision 79's removal list);
- §10 rework 1: `books/s8a-scale-rework-1.md` → `dsh/scale-rework-1-final.md`; Codex `codex/scale-review2.*`;
- §10 rework 2: `books/s8a-scale-rework-2.md` → `dsh/scale-rework-2-final.md`; Codex `codex/scale-review3.*`
  ("可以合入");
- decision 79 (no old-data compatibility before release): `checks/decision-79.md`;
- the lead's bubblewrap checks per round: `checks/round-checks.txt`; the merge tree's full suite:
  `checks/merge-full-suite-summary.txt` (if present; else a `【lead 填】` placeholder).

Run numbers (DSH main session; seconds / total tokens / context peak): 8D read-through 243 / 4.00M / 125,075; build
2,588 / 8.05M / 165,518; rework read-through 244 / 6.08M / 149,411; rework 1 1,834 / 6.63M / 192,821; rework 2 2,000 /
14.73M / 243,869; rework 3 1,372 / 2.91M / 105,935; §10 read-through 296 / 9.13M / 165,898; §10 build 5,314 / 23.05M /
310,550 plus resume 2,165 / 8.43M / 334,233; §10 rework 1 3,507 / 14.87M / 229,144; §10 rework 2 1,506 / 4.38M / 138,689.
Production lines (`src`, `scripts`, `runtime-assets.json`) per round: 8D build +355/−42; rework 1 +2,079/−442; rework 2
+580/−495; rework 3 +36/−23; §10 build +1,704/−348; §10 rework 1 +435/−630 (decision 79 −307 net); §10 rework 2
+16/−13. Total against the lead branch: 28 files +3,867/−655; tests 47 files +6,405/−180. Estimates (spec §11.7): 8D
rework 920–1,380 added; §10 segment 820–1,290 added, actual +1,757 (467 over; the reason is in
`dsh/scale-rework-2-final.md`, item 5). Measurement of this repository after §10 rework 1 (`dsh/scale-rework-1-final.md`):
4,287 files eligible → 4,202 nodes, TS 1,409 files, 10,759 edges, body 40,480 bytes, 6 chunks, 26.7 s, peak RSS 676 MB
(8A refused this repository at 2,196 files).

## 2. What to draft (edit the files in this copy)

Write Chinese in the style of the existing documents: short sentences, plain words, numbers exact, one idea per bullet,
like spec §9 and the 8A evidence. Follow the formats of the 8A counterparts exactly.

1. **Spec-8 §12 "8D 和 §10 段施工和验收中的限定（lead，2026-10-18）"** appended after §11, and one header post-note
   line (like the "后注（8A 验收…）" line). Collect every reading settled during the read-through answers, the rework
   rulings and the accepted UNSPECIFIED items, grouped by topic (inventory and git; the module snapshot and the chunked
   file layer; the TS light scan; Python; C/C++ and the runner; coverage and reasons; strict capture vs observation;
   decision 79; tests). Must include: A-06's expectation is `os（标准库）` (the reason stored by §11.5); strict capture
   is unchanged (export cap, full snapshot), only the observation mode compacts and the mapper's mode is required; the
   module layer is decided by the language status and the walked sources, not the parsed count; `noResolve` follows the
   TS program rule; the type-reference line is the type node's start; one chunk validator for write and read, the empty
   specifier is legal, a specifier over 4,096 characters makes the capture `invalid`, a single item over the chunk size
   is `capacity`; git's "不是 git 仓库" vs "git 不能用：<原因>" and "at least n" instead of a made-up count; decision 79's
   removals (v1 body and `previous`, the pre-8A reading and `notCaptured`, the defaults for missing `notes`/`reason`/
   `inventory`, A-16 and its fixture, **and the whole-`null` `inventory`**, which also drops the last clause of §10 item
   1 "没有这个字段的旧观测读作 `null`"); A-18's 300 edges checked on both layers (module edges, and each file's single
   `neighbors` target); A-27 through the public capture, cancellation proven on the failure branch (the abort queued
   with `setImmediate`); the accepted UNSPECIFIED items of each round as Codex listed them. Cite each item's source
   (book section, review item, reply item).
2. **Evidence README** `docs/refactor/reviews/evidence/orchestration-slice-8D-2026-10-18/README.md`: what 8D and the
   §10 segment are, the result line (merged, commit `【lead 填】`), the table of rounds (like 8A's), totals, the size
   against the estimates.
3. **`lead-acceptance.md`** in the same folder: the acceptance judgment per scope item and per review item (fixed,
   how), the measurement on this repository, known limits (spec §11.7's list, the runtime-dependency candidates for the
   user, A-27's one scan-level case and why, the `neighbors` page not carrying the queried file's edge, anything the
   replies list as untested and why).
4. **`docs/refactor/STATUS.md`**: an 8D bullet like the 8A one (8D and §10 merged), the "last check" line (placeholder
   for the suite numbers), the 8A known limit about this repository being refused rewritten as fixed by §10, known
   limits for 8D, and next steps (L8 next; K3 group 4 B3 in rework 4; cleanup C1 after K3 group 4 merges; then T in
   parallel with 6A, decision 79).
5. **`docs/refactor/IMPLEMENTED-CAPABILITIES.md`**: WG58 like WG57.
6. **`docs/refactor/design/orchestration-2026-10/slices/README.md`** and **`AGENTS.md`** status lines: 8D and the §10
   segment merged.

Do not copy the material files into the evidence folder (the lead does that); refer to them by the paths given in
section 1 relative to the evidence folder (`books/…`, `dsh/…`, `codex/…`, `checks/…`).

## 3. Reply

Under 300 words: the files you edited, anything you could not decide (with options), and any fact in the material that
contradicts another.
