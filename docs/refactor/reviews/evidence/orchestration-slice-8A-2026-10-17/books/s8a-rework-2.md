# Task: slice 8A rework 2 — the re-review's findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: report it under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), **at most 3 subagents at once — strictly**, every vitest command `--maxWorkers=2`.
**Finish within 110 minutes** (the run stops at 120, with a handoff if needed).

## 1. What this copy is

- Tag `s8a-b` (HEAD) = 8A after rework 1 (books `./.dsh-ref/s8a-impl.md`, `./.dsh-ref/s8a-rework.md`; your reply
  `./.dsh-ref/s8a-rework1-final.md`).
- Codex re-reviewed it read-only (`./.dsh-ref/s8a-review2.out.md`, Chinese): items 2, 4, 6, 8, 10 fixed; 1, 3, 5, 9
  partly; one new problem. The lead checked items 1, 3, 5 (second part) and 7 in the code; section 2 is binding.

## 2. Items (binding)

1. **A skipped configuration file still fails the whole observation** (Codex 1): `workspace/capture.ts` ~544 calls the
   TS analysis unguarded in observation mode; a `tsconfig.json` with a NUL byte named as `configPath` throws in the
   analyzer and the capture is rejected (~630). Fix: in observation mode only, an analysis failure keeps the frozen
   files and the line counts, records the TS language coverage as failed (an issue on the config path), and builds the
   empty module layer; the strict capture keeps its behaviour; never switch to another configuration silently. Test:
   `good.ts` + a NUL `tsconfig.json` named explicitly → the observation is `ready`, the file layer has `good.ts` with its
   line count, the TS coverage is not complete and lists the config issue, the module layer is empty.
2. **Skipped/failed files on a tied path are dropped** (Codex 3): `architecture/formal-comparison.ts` ~135 takes only a
   unique owner for issues. Fix: use the `ownershipOf` result directly; on a tie every tied module gets `unknown`;
   `other` stays excluded. Test (Codex's example): A and P both map `src/dup`, A→B declared, the only source file
   `src/dup/bad.ts` skipped, B has a normal file → A→B is not `proven` (`unknown`).
3. **Path search for `.` returns every module** (Codex 5, first part; the verifier's item 5): the query `.` is the root
   directory, so every module lies under it (G-04's "位于查询目录下"). Fix in `views/graph-context-reader.ts`'s path
   search, reusing the existing all-modules semantics in the same file (~1422). Test: R=`.`, A=`src/a`, names and
   descriptions without a dot → searching `.` returns R and A.
4. **File-anchor queries decide ownership after dropping node-less mappings** (Codex 5, second part):
   `architecture/graph-index.ts` ~100 filters the mappings to those with nodes before `pathOwnershipOf`. Fix: decide
   ownership over **all** mappings (as at write time, `workspace/architecture-source.ts` ~38/46), then keep only the
   owners that are nodes. Test: A=`src`, B=`src/b` and C=`src/b` (B and C tie, neither has a node), file `src/b/x.ts` →
   the anchor resolves to no module (today it resolves to A).
5. **Coverage leaks paths after the grant narrows** (Codex 7): the common loader (`architecture-service.ts` ~593)
   rechecks the grant for node paths only, then returns `languages` with issue paths. Fix: in the same loader, also
   check every issue path; any path the current grant does not cover → `forbidden`, as for nodes (one place, not per
   page). Test: capture with `good.ts` and a skipped `private/bad.ts` allowed; narrow the grant to `good.ts`; each of
   the three pages → `forbidden`.
6. **One file-page helper** (Codex suggestion): the three pages (`architecture-service.ts` ~910, ~943, ~976) repeat
   "load → old-observation cursor check → page → attach languages → map failures". Extract one internal helper; each
   entry keeps its own argument checks and paging function. No rule changes; existing tests stay green unchanged.
7. **Lead rulings on the rest (no work):** the `not_captured` branch stays proven at the service level (the platform
   entry passes through the same service, and the platform reads of new observations prove the wiring; no binary old
   database fixture). The chunk-size seam on the service dependencies is accepted. A zero-node graph writing one empty
   chunk is accepted. Duplicate test ids across files: leave them.

## 3. Checks (close-out subagent)

The checks of `s8a-rework.md` section 3 with `--maxWorkers=2`, then `npm run typecheck`, `npm run check:architecture`,
`npm run build`. No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
deleted. Any existing assertion that fails beyond what section 2 changes: do not edit it; report it.

## 4. Reply

Under 500 words: files changed (production net), each item RED → GREEN, checks with numbers, UNSPECIFIED, subagents
(most at once).
