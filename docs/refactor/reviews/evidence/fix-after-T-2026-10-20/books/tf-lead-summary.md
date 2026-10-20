# Fix round after T (decision 86): the lead's summary (2026-10-21)

## The decisions (HANDOFF decision 86, 10-20 evening)

The user went through T's "留给用户" list and the coverage triage and decided item by item (86-1 … 86-6; the text is
at the top of `docs/refactor/HANDOFF.md`). In short: the small fix (triage deletions, the 7 wrongly deleted tests
restored, the null-provenance chain T missed, one stale comment; AD08 by changing production, not the spec; the 293
(DSH counted 290) unused names in their own commit; not the 55 extra A-group gaps); delete the old browser workbench
`src/ui` in its own group and commit, keeping the HTTP routes and types, the Host's static shell, dependencies and
lock files, after tagging the last commit with it; K3/L8 debts and hand-written state folded into later slices; item 3
and item 8 accepted as dated known limits; items 2 and 10 as the lead recommended; the rule "有能力、没入口" written into
the slices README and DSH-WORKFLOW; the memory and time of the tests measured, and a read-only inventory of the scale
tests by Codex, with the split proposal left for the user. Builder: "今晚可以dsh，如果没做完，或者返工较多，就你来吧。"

## Time line (2026-10-20 night to 10-21)

| time | who | what | result |
|---|---|---|---|
| 10-20 22:5x | lead | fix book `books/tf-book.md`; copy `s9tfix` = clone of the T merge copy at `e99b385` (the code of `0e381ce4`), tag `tf-base` | 375 TF1 rows (`tf-rows.tsv`: 368 D1/D2/U + NP-1…NP-6 + CP-1), 7 restorations (`tw/`) |
| 22:59–01:19 | DSH `tb-TF-1020` | the five groups, coordinator mode | 5 commits `d66c606` TF1, `a127c23` TF2, `54f4744` TF3, `92b7404` TF4, `d4140be` TF5 (DSH amended a type-only change of `src/app/core-routes.ts` into TF5); 372 files +1,594/−18,022; 8,416 s, 44,407,120 tokens, peak context 305,837 |
| 01:20–01:49 | lead | full suite on `d4140be` (WSL, bubblewrap, 8 workers, scope 12G) | 755/755 files, 9,668 passed, 3 skipped, 1,711 s; build, typecheck, check:architecture 0 (`checks/full-tf1.txt`) |
| 01:26–01:39 | Codex | audit in eight parts P1…P8 (read-only copy `D:/cxt/t-tf`) | 会出错 2, 违规 25, 不整洁 10, 建议 27 |
| 01:45 | lead | frozen table `books/tf-findings.md` | rulings R-TF-1…R-TF-5; 12 rows TFR-01…TFR-12; the rest not adopted, each with the reason |
| 01:46–02:32 | DSH `tb-TFR1-1021` | rework 1 in a new copy `s9tfr1` (the full suite still ran on `s9tfix`) | `8317081` (22 files +236/−162); 9 rows done, TFR-04, TFR-08, TFR-10 BLOCKED; 2,779 s, 10,734,105 tokens, peak 203,338 |
| 01:50 | lead | IN12 red and green with bubblewrap (`checks/in12-proof.txt`) | the guarded condition at `context-input-service.ts:592` disabled → 2 failed (memory, SQLite: expected `state: 'missing'`); restored → 2 passed |
| 02:34 | lead | rulings on rework 1 (`books/tf-r2-book.md` §1) | TFR-08: B-023 kept (DSH's reason, "RUN-23 has no authorization", was wrong per the rework audit R-07: RUN-23 carries a V2 authorization; it stays kept because the authorization is optional at that call and the narrowing is not established there, with the structure round 85-1). TFR-10: C2-039 stays BLOCKED; the four tests that need an observer without `controls` are T leftovers. TFR-04: redo, with a legal `healthConclusion` added to two test mutations |
| 02:35 | lead | `verify:isolated` smoke (the script with only its build step) | on `d4140be` it fails (`isolated workbench smoke failed`); on `8317081` it passes (`workbench smoke ok`) (`checks/verify-isolated-smoke-*.txt`) |
| 02:34–02:57 | DSH `tb-TFR2-1021` | rework 2 | `bd58f4a` (5 files +17/−14), TFR-04 done (`healthConclusion: 'missing'`); 1,418 s, 5,755,710 tokens, peak 109,561 |
| 02:58–03:07 | Codex | rework audit (`codex/R.prompt.md` → `codex/R.out.md`) | 会出错 1, 违规 3, 不整洁 3, 建议 0; TFR-01, -03, -06, -07, -09, -10, -12 OK |
| 03:10 | lead | rulings on the rework audit (`books/tf-findings.md` §4) | R-01, R-02, R-04, R-05, R-06 fixed by the lead (`fix/lead-fix.py`); R-03 not adopted (ruling R-TF-6); R-07 corrects the TFR-08 evidence |
| 02:59–03:28 | lead | full suite on `bd58f4a` (8 workers) | 755/755 files, 9,668 passed, 3 skipped, vitest 1,689 s; build, typecheck, check:architecture 0 (`checks/full-tfr2.txt`) |
| 03:03–03:12 | DSH `tb-TFdocs-1021` | docs draft (`books/tf-docs.md`) | 13 files changed and the evidence README; 508 s, 12,334,353 tokens, peak 244,041 |
| 03:28–03:29 | lead | lead fixes `20afbfa` (`checks/lead-fix.txt`) | typecheck 0, `--noUnusedLocals` 0, check:architecture 0, `A2-step1-codecs` 29 passed |
| 03:29 | lead | `verify:isolated` smoke on `20afbfa` (`checks/verify-isolated-smoke-final.txt`) | `workbench smoke ok` |
| 03:30 | lead | tag `old-ui-last` at `4679c7e3`; merged into the lead branch by objects (`checks/merge.txt`) | `aab1a8fd` TF1, `df0282c6` TF2, `7a5273f0` TF3, `0ecba599` TF4, `c95d741c` TF5, `4a8a1400` reworks and lead fixes; code equals the copy |
| 03:29–03:58 | lead | final full suite on `20afbfa` (8 workers) | 755/755 files, 9,668 passed, 3 skipped, vitest 1,678 s; build, typecheck, check:architecture 0 (`checks/full-final.txt`) |
| 03:34–03:42 | Codex | docs check (`codex/docs-check.*`) | 错 5, 误导 2, 漏 5, 不一致 2; all adopted by the lead (dated notes in UI-WORKBENCH, DESIGN and specs 6, 7, 8; STATUS gains the structure-round rows and the AD08 known limit) |

## Results per group (after the reworks)

- **TF1 (triage deletions):** 375 rows, final results (`dsh/tf1-rows-final.tsv`): deleted 112, simplified 83,
  kept 177, BLOCKED 3. BLOCKED: `C2-039` (making `controls` required needs four tests that build an observer without
  `controls`: S2B-36, S2B-38 (b), B2-runtime-execution :383, :483 — T leftovers), `C3-062`, `C3-063` (the deletion
  needs the slice-1 §2.2 readonly_copy creation check first, a new production behaviour). By class: U rows mostly kept
  as integrity guards (a check on a damaged or foreign record stays; a tolerance of an old shape is deleted, decision
  79). The null-provenance chain is gone: `legacyPending`, every `provenance === null` branch, the
  `provenance_unchecked` marker and its contract member; `legacyUnchecked` in the line list is always exact 0 (the
  field stays). Old-shape tolerances also deleted in the reworks: a proposal chain without `since` (A1-007, A1-043; the
  S5 fixture seed now writes the current shape), an unavailable Session without a conclusion (A1-013, A1-016;
  `retired_unrecorded` is no longer produced, the contract member stays), an interrupted check without its cause
  (A1-026, A1-027; the codec test's rounds now come from the evidence owner's own writes).
- **TF2 (seven restored tests):** IN04 and IN12 (`tests/work-graph/S3-context-inputs.test.ts`), scenario 9 of
  `W1-future-plan`, W-05 with a queued pause at a restart (`A2-reconcile-runtime`), M05 (`WP2-undelivered-notices`),
  2C-14/T5x (`S2C-lines-failure`), A-07 symlinks (`S8E-A07-git-inventory`), the non-wildcard tsconfig include
  (`typescript-source-query`). Each had a red-then-green proof; IN12's was done by the lead (DSH's sandbox has no
  bubblewrap). The 8th wrongly deleted test (the display preference's empty state) was in `src/ui` and went with it.
- **TF3 (AD08):** test first (real prepare, the real Session pin change @7→@8, the real entry: red `committed`, expected
  `rejected` / `revision_conflict`), then the least production change: the Work context binding names the Workspace
  record (`graph-context-reader.ts` `baseSources`), so the entry guard and the same-commit guards compare its revision.
  Behaviour change: a Workspace write between a Task's prepare and its entry now refuses the entry. The Workspace
  writers are the first registration, Session pins and notice read positions; none runs between prepare and entry in
  a normal flow (Codex P6). Also C4-113: the dependency `listExecutions` is required.
- **TF4 (old workbench):** deleted `src/ui/` (79 files), `scripts/build-workbench.mjs`, `tsconfig.ui.json`, 11 test
  files that tested only the old workbench; `package.json` `build` and `typecheck` lose one step each; the UI rules of
  `scripts/check-boundaries.mjs` and `tests/architecture/*` removed; the tests and helpers that borrowed from `src/ui`
  changed and keep their backend assertions (the list is in `dsh/tf-reply.md` §1; the Host tests write their own page
  with the new `tests/helpers/host-page.ts`). Kept for E3: every HTTP
  route and its request and response types; 48 of those types were reached only by `src/ui` and are now `wire-format`
  allowlist entries (164 → 212, ruling R-TF-1); the Host's static shell (`src/app/server.ts` answers `unavailable` when
  no page is built). `scripts/verify-isolated.mjs`'s Host smoke writes its own page (TFR-11). The last commit with the
  old workbench is tagged `old-ui-last` (`4679c7e3`).
- **TF5 (unused names):** `tsc --noUnusedLocals` 290 → 0 (158 files +171/−346); no export, parameter or `_` name
  removed; one dead test helper with an `expect` inside (`archiveLine`) went.

## Rulings (from `tf-findings.md` §0 and the rework rulings)

R-TF-1 the allowlist; R-TF-2 restored tests use their file's fixtures (the fixtures' hand-written state is T's
leftover, 86-3); R-TF-3 cascades of unused names; R-TF-4 the rows left to the lead (kept this round: catches on
tracked promises; what a spec, frozen contract or later slice needs; narrowings for the structure round 85-1; free
integrity mappings); R-TF-5 frozen contract members stay. Not adopted, each with a reason in §3; notably P2-05
(A2-028/029: `slice-2B-SPEC.md:171` L17 still says an old execution may have a null Session, and the contract type is
frozen; the sentence is obsolete under 79 and goes when 2B's files change next).

## Left open (where tracked)

- BLOCKED `C2-039`, `C3-062`, `C3-063` (above); the T leftovers R-TF-2 lists (W1-future-plan's memory-only set-up,
  WP2's memory default, the A2-reconcile-runtime polling, `S1-archive-service-fixture`, `S2C-L-line-support`,
  `S2C-L-runs-support`, `B2-runtime-fixture`'s governance seed, the S3-prepared-context-admission set-up), the four
  tests TFR-10 names, the L17 sentence: the fold-in list in STATUS (86-3).
- The 55 A-group test gaps (86-1: behaviour that happens but T's deleted test was not compliant): recorded as test gaps.
- The rows R-TF-4 leaves for the structure round before 6A (85-1): `C3-011`, `C3-012`, `C4-127`, `C4-128`, `C3-057`.

## Decision 86-6: memory, time and the scale tests

- **Measured** (`mem/`, the T merge tree, 5 workers, 24 CPUs): scope peak 5,884 MiB (~1.2 GB per worker); wall
  2,857 s; the files' durations sum to 13,520 s; the slowest 5 files take 33% of it, all scale tests, mostly in their
  SQLite pass (S2A-notices-overbound 1,381 s, S2A-queue-derived-cards 1,101 s, S2C-lines-scale 961 s,
  S2A-queue-bounds 582 s, B2-401-world 499 s); the largest JS heaps recorded after a file ends are production-reach (1,155 MB) and state-writes
  (796 MB). So on an idle WSL the full suite can run with 8 workers (~9.5 GB): measured 1,711 s on `d4140be`. The
  longest single file is the floor.
- **Codex's inventory** (`scale/t-scale.out.md`, read-only, the slowest 25 files): many scale tests prove an old cap is
  gone, and the frozen specs require both backends to really cross 5,001 and 201 (`slice-2A-SPEC.md:310`, `:329-342`;
  `slice-2C-SPEC.md:1289`, `:1323`; `slice-K3-SPEC.md:1500` B2-16(iii); R-22's 205 blocked Runs). Proposal: a daily
  small version of each on both backends with the same assertions (internal page widths passed in by the composition
  root, seams A–H, defaults are the spec values; H, the canonical task facts' Run lookup page width, crosses several signatures and is undecided), plus a scale-acceptance batch at chosen points; estimated daily work
  −41 to −42% (about 28–31 min at 5 workers). It needs spec post-notes on how often the scale batch runs, and the
  user's decision. B2-401 is one Task's 401 rerun requests, not 401 Tasks. Hand-written seeds remain in some scale
  fixtures (T leftovers).

## Usage

- DSH: `tb-TF-1020` 44,407,120 tokens (8,416 s), `tb-TFR1-1021` 10,734,105 (2,779 s), `tb-TFR2-1021` 5,755,710
  (1,418 s), docs `tb-TFdocs-1021` 12,334,353 (508 s); total 73,231,288 tokens, 13,121 s (`checks/dsh-runs.txt`).
- Codex: the scale inventory (00:06–00:35), 8 audit parts (01:26–01:39), the rework audit (02:58–03:07), the docs
  check (03:34–03:42) (`checks/codex-calls.txt`).
- Claude: the lead only; no subagents or workflows in this round (the user asked to save Claude quota on 10-20).
- No real model calls.
