## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is the first night of the structure round before slice 6A (HANDOFF decisions 84-1 and 85-1): three DSH
runs on the same base, merged by the lead, files disjoint. Base `s85-base` = the lead branch `20f64821` (SC merged).
Commits: S1 `0d47938` (D2, book §5.2), S2 `65891b8` (C2, C1, A6, B1, §5.3–5.6), S3 `36f79b8` (D3a, §5.1). The round
promises **behaviour byte-identical to the base, tests unchanged** (book §2). This is the first audit: your findings
become the frozen table for rework 1 (at most three reworks, decision 80). Report everything you can prove, and
nothing you cannot. Slice S4 (D3b, the context assembler) starts from this tree tomorrow and codes against the
interfaces and keys of S1–S3; a wrong interface or key here is a finding.

Inputs in `./.lead-ref/`:

- **The book** `books/s85-book.md` (binding; read §1–§4, §5.0 and the sections of your part in full) and the run
  sheet of your run `books/run-S<n>.md` (whitelist, test list, interfaces).
- **The inventories** (Codex's, Chinese, written on the base; the book binds where they differ):
  `books/inv-d3.out.md` (D3), `books/inv-rest.out.md` (D2, C2, C1, A6), `books/inv-b1.out.md` (B1).
- **The frozen spec** for D3's pack format is in the tree:
  `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md` (§0.4 first bullet, §1 first bullet,
  P1, P10, §2 renderer signature).
- **Your part:** `parts/<P>.diff` and `parts/<P>-files.txt`. The base version of every changed file is at the same
  relative path under `base/`; a new file has no base. The whole result tree is the current directory.
- **DSH's replies** (claims, not evidence): `replies/s85-reply-S1.md`, `-S2.md`, `-S3.md`. S2's probes and static
  proofs are in `replies/s85-probes-S2/`. **The S1 and S3 probes are lost** (they were written in the DSH sandbox's
  private `/tmp`), so the byte-proof numbers in those two replies are unchecked claims: prove identity by reading.
- **Tests:** the lead runs the bubblewrap full suite separately; you do not need test results. No file under `tests/`
  changed in any run (check `parts/*-files.txt`).

## What to check (every part)

1. **Byte-identical behaviour** (book §2 rule 1): for every input, the new code returns or sends the same bytes as
   the base: the same texts (prefixes, suffixes, punctuation, full- vs half-width, `……` vs `…`, newlines, indents,
   a trailing newline or none), the same error codes and texts, the same order of checks, the same field presence
   (an omitted field stays omitted, no explicit `undefined`), the same list order, the same number and order of store
   reads and clock calls, the same stored bytes and digests. Where text moved into `resources/prompts/platform/`,
   rebuild the output from the template, the strings and the code for each branch and compare it with the base
   literal byte for byte (escapes in a base template literal, `\``, `\\`, `${…}`, count). A difference for some input
   is **会出错**: give the input, the base output and the new output.
2. **Exports keep working** (rule 3): every export of the base keeps its name, signature, literal type, return shape
   and behaviour; a moved symbol stays importable from its old module whenever a test or another module imports it
   from there (search `src/` and `tests/`).
3. **Nothing new** (rule 4): no new behaviour, error path, validation, store read or public name (the renderer's
   code-bug throws of §5.1 ruling 3 are asked for). **Not widened** (rule 5 and each item's "not this round").
4. **Comments** (rule 6): every rule and every "why" of the base kept with the code it explains; no construction
   history ("S3 did …", "moved from …" is history).
5. **Scope:** every hunk is asked for by the book for this run, or is an import the change needs; otherwise **违规**.
   Rules 7 (state transitions, `vendor/`, `docs/`, lock files) and the import directions of §4.
6. **Production reach:** every new export is reached from a production path or is a type.

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 依据 (book section and rule, inventory row, spec
   item) | 问题 | 唯一改法. Classes: **会出错** (a byte, an order, a read or a behaviour differs from the base for some
   input; or an interface S4 relies on is wrong: give the input and both outputs), **违规** (against the book, the
   run sheet or the spec), **不整洁** (stale comment, dead code or import, a text left in two places), **建议**
   (optional).
2. **Per file:** one line per file of your part: `<file>: OK` or `<file>: <P>-nn, …`.
3. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "basis",
   "problem", "fix"}]`.
4. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
