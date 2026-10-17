# Task: slice 8A rework — the review's findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: report it under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), **at most 3 subagents at once — strictly** (do not start a fourth while three run),
every vitest command `--maxWorkers=2`. **Finish within 150 minutes** (the run stops at 160, with a handoff if needed).

## 1. What this copy is

- Tag `s8a-a` (HEAD) = your 8A build (`./.dsh-ref/s8a-impl.md`, your reply `./.dsh-ref/s8a-final-1.md`), normalized to
  LF line endings by the lead (the earlier copy had CRLF files by the lead's mistake; that is why
  `check:architecture` showed 21 runtime-asset hash lines — they are gone here). Lead check with bubblewrap on this
  copy: 100 files, 890 passed, 5 skipped; typecheck, `check:architecture`, build pass.
- Codex reviewed 8A read-only (`./.dsh-ref/s8a-review.out.md`, Chinese). A Claude subagent verified every item in the
  code (`./.dsh-ref/verify-s8a.md`, with file:line evidence, minimal examples and a recommended fix per item).
  **The verifier's recommended fixes are binding, with the lead's rulings in section 2 on top; where section 2 differs,
  section 2 wins.**

## 2. Lead rulings (binding)

1. **Items 1 and 2 (one frozen material set):** the verifier's design — keep `captureProjectSource` strict for its other
   callers; a tolerant one-pass observation reader (`captureObservationSource` / `projectSnapshotOf`) whose per-file
   skips go into the language `issues`; one observation capture mode that both the module-level TS analysis and the file
   graph consume; `verify` checks the full material digest; the TS provider gets the capture's explicit `configPath`;
   `architecture-service.ts` calls the observation capture. A binary/over-2-MiB/unreadable TS, JS or JSON file never
   fails the whole observation.
2. **Item 3, non-source files:** files of language `other` (docs, config, assets: no references by nature) never make a
   module's dependencies `unknown`. Only files in a source language without a working provider (unsupported, failed,
   not configured, partly parsed — e.g. C/C++ and Python until 8D, Rust, Go) do. Intra-module imports are never
   findings. The other corrected rules are the verifier's. A-02, A-02b and A-05 keep their exact arrays; if one would
   change, stop and report it.
3. **Item 5:** `pathOwnershipOf` also returns the winning prefix; delete both private prefix matchers
   (`views/graph-context-reader.ts`, `formal-comparison.ts`) and the `.` skip at `notes/note-related-scope.ts` ~335.
   Path search on a root-only catalog returns the root module for any non-empty path; two root modules are both
   returned (4C-1's tie rule for path search); other callers keep "a tie owns nothing".
4. **Item 6:** an observation record without `fileGraph` (written before 8A) is checked with the legacy any-prefix
   membership rule; new ones with the 8A rule. Test with the verifier's example (A=`src`, B=`src/b`, files `src/a.ts`,
   `src/b/x.ts`) written through the old rule, then read and used as `previous` for a new capture.
5. **Item 7:** `languages` is returned on the three file-graph pages (`listFiles`, `neighbors`, `impact`); that narrows
   book section 7 item 2's "capture result and reads" to those pages. The cursor-identity check goes before the
   old-observation branch.
6. **Item 8:** the verifier's fix — accept empty mappings and use the existing empty module snapshot, so a TS project
   without a catalog is captured with the file layer and an empty module layer. Test with a TS project, not a no-TS one.
7. **Item 4:** the verifier's fix — project scope and pin linkage checks, an exported `readRevisionByRef`, and the digest
   comparison; a pin from another project or with a wrong digest is `invalid` (or the code the existing version read
   returns), never `ready`. Fix S8A-07's made-up digest.
8. **Item 9, tests:**
   - A-01's capacity and `not_captured` parts go through the public `platform.architecture` entry: add a platform
     option for the file-graph caps (test injection, like 4C's `resultMaxBytes`) and assert both there.
   - No reading the database or artifacts to verify (A-01a and the chunk checks read through public reads).
   - Exercise more than one chunk (inject a smaller chunk size through the same option, or enough nodes) and keep the
     chunk builder linear (the verifier found it O(n²) near the caps).
   - Run AE1's service-level rows on memory **and** SQLite.
   - One successful `compare-formal` request through the route, asserting the findings.
   - The catalog version time: assert the reason literally and the time between timestamps taken just before and after
     the revise call (the catalog writer uses the wall clock); no database read.
9. **Item 10:** export one cycle-detection function from `architecture-delta.ts` and use it in the comparison (book §3
   already said "reuse"); delete the copy.
10. **Out of scope now:** the module-level body's 256 KiB cap (the verifier's estimate: about 900 TS/JSON files) is
    pre-8A; do not change it in this run. The lead measures it after the merge.

## 3. Checks (close-out subagent)

`--maxWorkers=2`: `tests/data/`, `tests/architecture/`, every `S8A-*` test, `tests/work-graph/S4B-*.test.ts`,
`tests/work-graph/S4C-*.test.ts`, `tests/work-graph/SP-*.test.ts`, `tests/work-graph/S3-graph-context.test.ts`,
`tests/work-graph/S2C-node-detail-*.test.ts`, `tests/work-graph/R3d-*.test.ts`, the conflict and catalog tests,
`tests/composition/platform.test.ts`, the route tests; then `npm run typecheck`, `npm run check:architecture`,
`npm run build`. No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
deleted. Any existing assertion that fails beyond what section 2 changes: do not edit it; report it.

## 4. Reply

Under 700 words: files changed (production net), each item RED → GREEN, checks with numbers, UNSPECIFIED, subagents
(most at once).
