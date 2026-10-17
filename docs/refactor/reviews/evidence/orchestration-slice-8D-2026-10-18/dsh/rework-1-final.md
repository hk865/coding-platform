All work is complete and verified. Final reply:

# 8D rework — final report

## FILES CHANGED

**Production** (`git diff --numstat` + new file):
- `scripts/python-source-query.py` +635/−165 (≈440 genuinely new; the rest is re-indented kept `python_index` body)
- `scripts/cpp-source-query.py` +686/−52 (≈140 verbatim §11.4 tables, ≈110 ctypes/NDJSON plumbing)
- `src/core/workspace/analysis-runner.ts` 455 new
- `architecture-language-provider.ts` +199/−145 (TS reshape + C++/Python rewrite)
- seam 8 files (`architecture-inspection`, codec, service, access, capture, workspace-tools, exploration-tools, execution-contracts) +78/−26
- indexes `cpp-source-index` +18/−35, `python-source-index` +6/−17
- **Total +2,077/−440** (net +1,637) vs §11.7's 920–1,380/≈200: over, mostly script re-indentation, the verbatim argument table and runner shape/backpressure validation. Report, not hidden.

**Tests:** tracked +82/−212; 11 new files, 2,866 lines.

## SCOPE ITEMS (all 〔8D 返工〕 only)

1. **§11.1 take-out/keep — done.** Import cache, `MissingAnalyzers`, per-file coverage, per-TU tolerance and provider paging removed; `python_index` has exactly argv[1] analyzers dir, `-S`, missing-Jedi literal; `sourceAnalyzers.directory` reaches only exploration.
2. **§11.3 Python `import_graph` — done** (argv routing, JSONC, config literals/roots/notes, CPython lookup incl. namespace/stdlib/relative, specifiers).
3. **§11.4 C/C++ `import_graph` — done** (aggregate-alone, merge, hints, argument table, VFS/libclang walk, fallbacks, R2lex, notes, whole-unit failures). Ignored databases are §10, not built.
4. **§11.5 common — done** (`notes` contract/decode/default, provider `skipped`/empty `configOnly`, capture copies `edges`, all literals, config-by-existence, claimed-file completion, self-edge, zero-read, cancel/capacity, runner, timeouts).
5. **`runtime-assets.json` — done**; both digests match (`sha256sum` verified).

## ROWS (RED → GREEN)

- **A-06** (both backends) — done, 8/8; situation 3 now invalid `pythonPath`, `f.py` reason `SyntaxError: invalid syntax`, empty-`directory` rerun.
- **S8D-PROV-03** — done like A-06; **PROV-05** `-I /etc` now parses with the two notes.
- **A-11(2)** — 1/1.
- **A-20** — 1/1, exact 12 edges + 11 specifiers.
- **A-21** — 10/10 incl. JSONC, root order, all configuration-error literals, python_index limbs and the no-read/counter case.
- **A-22 (a)–(n)** — 14/14, whole coverage/notes/statuses/edges.
- **A-23 〔8D 返工〕** — 19/19 incl. merge, aggregate, hints, `-Xclang`, `-march`, default target, NUL database.
- **A-24 (1)–(4)** — 4/4; launches 3/1/2/1.
- **Exploration regressions** — 3 rows green (1,500-file `python_index`, `cpp_index` unsupported message, empty-zip directory message + no-directory `sourced`).
- **8D test fate** — CPP-01/02 → A-22(k)/(l); CPP-03/PY-01 deleted; PY-03/PROV-06 moved; CPP-04/PY-02/PY-04/PROV-01/02/04 kept; PROV-05 rewritten; all whole-object assertions gained `notes`.
- Memory+SQLite: A-06 both; A-24 memory only; other rows workspace-tool rows.

## CHECKS

`--maxWorkers=2`, one process at a time, 845 test runs in 125.7 s:
- `tests/data/` 30 files, 274 pass
- `tests/composition/` 34 files, 129 pass / **21 fail, all DSH-BASELINE §A** (no bwrap: A2-requeue 5, reverify 1, verification-chain 6, R3e 3, R5c 3, S2B 3); no new failure
- `tests/architecture/` 4/53 pass
- `tests/**/S8*.test.ts` 21 files/186 pass
- mention-files 8/65 pass; new files 11/117 pass
- `npm run typecheck` 0; `npm run check:architecture` 0; `npm run build` 0. `boundaries.test.ts` re-verified green by me.

**Measured:** A-22 1,023 ms (14 tests; sum 811 ms); A-24 6,454 ms (1,225/5,023/98/109 ms). My independent rerun: A-22 830 ms, A-24 6,410 ms.

## UNSPECIFIED

1. `ready.engine/engineVersion`: Python `python-ast`/`1`, C++ `libclang`/version — not asserted. Smallest: leave.
2. C++ provider selects a nested-`B` merge that the script's own re-check (one subdirectory level) rejects; no test/spec case. Smallest: tighten provider to one level.
3. Runner: non-ENOENT/EACCES spawn errors → `分析器不可用`; trailing stdout line without newline and a duplicate identical `ready` are accepted. Smallest: leave.
4. Capture note normalisation dedupes→sorts→cuts→takes 10 and does not re-dedupe after the cut (provider notes are short). Smallest: leave.
5. AE6 wording: this copy had no literal “跨分页 / 本机分析器” assertion, only header wording was updated.

## SUBAGENTS

10 tasks: S0 seam, S1 Python script, S2 C++ script, S3 runner+A-24, S4a index take-out, S4b providers, S5 Python rows, S6 C++ rows, S7 fate/notes/regressions, close-out. **7 at once at launch** (decision 76), then 4. Wall time per task 6–25 min; run start 11:56, close-out report 12:23.

## SURPRISING

- Production-line overrun as above.
- `拼写纠正后才找到` is implemented but no libclang-18 fixture could trigger it (spec anticipated no fixture).
- An unguarded self-`#include` dies with `#include nested too deeply`; the self-edge fixture needs a guard.
- `build` created gitignored `dist/`, absent before.