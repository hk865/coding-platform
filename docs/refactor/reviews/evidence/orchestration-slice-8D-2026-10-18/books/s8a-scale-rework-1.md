# Task: slice-8 §10 segment, rework 1 — Codex's review (items 1–8) and decision 79; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`; **read its sections "How tests reach their state: no hand-written facts" and
"Before you build: what the reworks were about" first; both bind every brief**). No fixed limit on subagents at once
(decision 76), files disjoint, every vitest command `--maxWorkers=2`. **Do not end your turn while a subagent has not
reported back.** **Finish within 200 minutes** (the run stops at 210). Finish whole items; an unfinished item is
reported, not half-done. Delete `./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is

Tag `s8a-scale` (HEAD) = the §10 segment (book `./.dsh-ref/s8a-scale-impl.md`, your reply
`./.dsh-ref/s8a-scale-final.md`). The lead's bubblewrap check of it is in `./.dsh-ref/s8a-scale-check.txt` when
present. Codex's review: `./.dsh-ref/s8ascale-review.out.md` (Chinese; items 1–9 with file:line and the fix approach;
**W/** = `src/core/workspace/`, **A/** = `src/core/work-graph/architecture/`, **T/** = `tests/data/`, **C/** =
`src/contracts/`). The lead checked item 1 in the code; it holds. The spec in this copy is older than the lead's:
read `./.dsh-ref/slice-8-SPEC-current.md` (§10, §11, and the header post-note of decision 79) and
`./.dsh-ref/decision-79.md`. Everything the earlier book says still holds unless an item below changes it.

## 2. Items (binding; Codex's numbering)

1. **Strict capture stays as it was.** The non-observation path keeps its export capacity check (`W/capture.ts` ~233)
   and its full snapshot (`indexedSources`, uncut unresolved list). `mapArchitectureSource` takes an explicit
   observation mode and compacts only in it; in that mode the compaction stays before the 240 KiB check
   (`W/architecture-source.ts` ~79–80). Restore the strict-capture assertions (`T/workspace-capture-architecture.test.ts`
   ~159, ~174) to their values at `s8d-rw3`.
2. **The module layer comes from the sources walked, not the files parsed.** `A/architecture-service.ts` ~883 decides by
   the language status and the walked sources (reuse the capture's source count, `W/capture.ts` ~643–654), never by
   `parsed > 0`. Test (public entry, memory and SQLite): the only TS file fails through the scan's fault hook → the
   module keeps its sources, coverage `complete: false` with the failure; no empty module layer.
3. **TS scan.**
   - `noResolve` follows the TS program rule (§11.2 "照 TS 程序的规则"): references still resolve to files already in
     the root set; only new targets are not enqueued (`W/typescript-light-scan.ts` ~249, ~272, ~336). Test: roots
     `a.ts`, `b.ts`, `a.ts` imports `./b`, `noResolve: true` → the edge a→b exists; an import of a non-root file is
     unresolved and that file is not analyzed.
   - The ~50 ms yield and the cancellation check sit where every loop branch passes, including the failure and JSON
     `continue`s (~295, ~311, ~370). Test: a cancel during a run of failing files ends the capture as `cancelled`
     promptly (fault hook; no timing literal beyond "before the next file").
   - A type reference's line comes from the type node's `getStart(sourceFile)` (~118). Test:
     `type T = import(\n"./missing"\n).T` → line 1.
4. **Chunks: one contract for write and read.** Every rule the chunk decoder checks is checked once before commit by
   the same function (one validator, used by the writer and the decoder). The empty specifier that real syntax produces
   (`import "";`) is legal on both sides; long specifiers have one limit on both sides. One item whose encoded size
   with its envelope exceeds the chunk size → `capacity` (`A/architecture-service.ts` ~289). A-12 uses a chunk size
   that fits one node; re-compute the over-64-chunks example by hand and show it in the test comment.
5. **Git: true classification and true numbers.** Tell "not a git repository" from "git cannot be used" with a bounded
   diagnostic (exit status plus a cut of stderr; `W/git-read.ts` ~202–205). When the output limit cuts the listing,
   report the count of complete records read as "at least n" — never a made-up 60,001 (~244). Cancel and capacity
   still end the inventory with no fallback.
6. **Decision 79: delete every path that only reads earlier formats** — exactly Codex's item 6 list: v1 bodies and their
   use as `previous` with the consumers in the service; the pre-8A member rule, records without a file layer, the
   empty-graph special case and `notCaptured` (contract field included); old manifest and chunk shapes (node summaries
   filled in, path edges, version merge); the defaults for a missing `notes`, `reason`, `inventory` (the current format
   requires them; an explicit `reason: null` written by the current format stays); the old-format tests and the whole
   `tests/fixtures/s8-observation-v1/` with its generator and its `.gitignore`, `tsconfig.json`, `vitest.config.ts`
   entries. Afterwards a record in an older shape is rejected by the decoder and handled as today's unreadable records
   are: no migration, no empty success page, never a `previous`. Do not touch outer record versions still written
   today or the strict-capture contract. One test: a record in the old body shape (a codec input, a pure function) is
   rejected by the decoder.
7. **Rows through the public entry, on both backends.** A-17, A-18 and A-19 run through the shared platform fixture's
   public capture and pages (not the scan function), memory and SQLite, with the spec's literals; A-09's two cases and
   A-23's binary-database case also on SQLite. A direct scan or codec test stays only for input the public path cannot
   reach.
8. **Second copies (decision 75; Codex's suggestion, done here).** Report the production line count before and after.
   - Group, pick the reason for, and sort unresolved references once, in the capture; the store only maps edges to
     indices (`W/capture.ts` ~353, ~438; `A/architecture-service.ts` ~336).
   - Compact the snapshot once, before validation on the observation path; the service uses the result and the
     Chinese-summary regex that guards against compacting twice goes (`A/architecture-service.ts` ~266).
   - `loadObservation` hands the record it already read and decoded, and its access, to the chunk helper; the page entry
     does the first read (`A/architecture-service.ts` ~572–689).
   - Build one path set per language and look nodes up in it (`W/capture.ts` ~424–428).
   Then explain the remaining gap against the estimate (§10 600–900 plus §11's part; you reported +1,703/−347).

Codex's item 9 on your UNSPECIFIED list is accepted as written there: the listed choices stand; the capacity and git
texts stand with item 5's classification and numbers; the A-16 points go with item 6.

## 3. Checks (close-out subagent)

`--maxWorkers=2`: `tests/data/`, `tests/architecture/` (production reach included), `tests/work-graph/`,
`tests/composition/`, every `tests/**/S8*.test.ts` and `tests/**/R3d-*.test.ts`, the changed files; `npm run
typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected (no
bwrap). Repeat the measurement of the last session on this copy's own tree (same command and exclusions) and report
the same numbers. The close-out greps the new and changed tests for hand-written facts and lists **each hit with why
it is allowed**. No real model calls, no git writes, never ports 3080/3099/44797.

## 4. Reply

Under 900 words: production net per item, the segment total against `s8d-rw3` (before: +1,703/−347), each item
RED → GREEN or how it was checked, the measurement, the fact-grep list, checks with numbers, UNSPECIFIED.
