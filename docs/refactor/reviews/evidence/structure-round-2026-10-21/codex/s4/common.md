## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is run S4 of the structure round before slice 6A (HANDOFF decisions 84-1, 85-1): **D3b**, the split of
`src/core/agent-runtime/context-assembler.ts` into eleven `context-*` modules and the move of its own texts into the
platform prompt pack. Commit `39fee06` on the base tag `s85-n2-base` (`b35e077` = the night-1 merge of S1–S3 plus
rework 1, already audited). The round promises **behaviour byte-identical to the base, tests unchanged** (book §2).
This is the first audit of S4: your findings become the frozen table for its rework 1 (at most three reworks,
decision 80). Report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The book** `books/s85-book.md` (binding): §1–§4, §5.0, and in §5.1 the rulings 1–11, "S4 = D3b" and "Byte proof,
  S4". The run sheet `books/run-S4.md` (whitelist, frozen interfaces, lessons). The night-1 findings
  `books/n1-findings.md` (what went wrong last night, for example P4-01: an optional slot alone on a template line
  leaves its newline when empty).
- **The inventory** `books/inv-d3.out.md` (Codex's, Chinese, written on the round's first base; the book binds where
  they differ; its line numbers are older): §1 rows 1–4, 6–8, 24–26, 28; §2 (the three main input templates and the
  seven adaptation rules); §3 (the modules and recipes; its recipe table binds); §4 (proof ideas and edge inputs).
- **The frozen spec** in the tree: `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`
  (P1, P10, §2).
- **Your part:** `parts/<P>.diff` and `parts/<P>-files.txt`. The base version of every modified file is under
  `base/` (most moved code comes from `base/src/core/agent-runtime/context-assembler.ts`, 2,037 lines;
  `parts/context-assembler.diff` is that file's whole diff). New files have no base. The whole result tree is the
  current directory.
- **DSH's reply** (claims, not evidence): `replies/s85-reply-S4.md` (§3 interface table with each module's base
  lines, §4 key table, §5 byte proofs), `replies/INTERFACES.md`, `replies/keys-P.md` (each new string's exact value
  and base location). S3's reply `replies/s85-reply-S3.md` for the renderer and S3's keys.
- **S4's probes** `probes-S4/` (`e-render/`: record and replay of the renderers and fact formatters, the 140 edge
  inputs; `e-assembler/`: the whole assembler result, `bodies.put`, the deps proxy with the clock, the read points).
  Logs over 1 MB are left out (`probes-S4/LEFT-OUT-over-1MB.txt`); scripts, reports and small logs are there.
- **Tests:** the lead runs the bubblewrap full suite and the scale batch separately. No file under `tests/` changed.

## What to check (every part)

1. **Byte-identical behaviour** (book §2 rule 1): for every input, the new code returns, stores or sends the same
   bytes as the base: texts (prefixes, suffixes, punctuation, full- vs half-width, `……` vs `…`, `(none)` vs `（无）`
   vs `(未声明)`, newlines, indents, trailing spaces), section ranges and counts, error codes and texts, the order of
   checks, field presence (an omitted field stays omitted, no explicit `undefined`), list order, the number, order
   and arguments of store reads, and the number and timing of clock calls. Where text moved into
   `resources/prompts/platform/`, rebuild the output from the template, the strings and the code for each branch and
   compare it with the base literal byte for byte. A difference for some input is **会出错**: give the input, the
   base output and the new output.
2. **Moved code** is the base text of the function (diff it against its base lines; the reply's §3 gives them),
   changed only where a text now comes from the pack or an import/export is needed. A changed condition, order,
   default or truthiness test is a finding.
3. **Exports keep working** (rule 3): the 25 names the base `context-assembler.ts` exported are still exported there
   with the same names, signatures, literal types and identities; the public `ContextAssembler.assembleTask` keeps its
   shape (no `taskReviews`). No run-time import cycle among the new modules and the assembler (`import type` where
   only types are needed). One source for each helper: no function copied into two modules.
4. **Nothing new** (rule 4): no new behaviour, error path, validation, store read or public name. **Scope:** every
   hunk is asked for by "S4 = D3b" or is an import the change needs; S3's templates, strings and tool files are not
   edited or renamed; in `slot-tables.ts` only the three main input tables may change (S4 changed none).
5. **Comments** (rule 6): every rule and every "why" of the base kept with the code it explains; no construction
   history.
6. **The proofs** in your area: what does the probe record, and would it catch a difference of the kind your part
   could have (a changed byte, an order, a missing read, a clock call moved)? An area the probes and the tests leave
   unproven is a finding (**违规**, book §5.0 rule 3 / "Byte proof, S4"), with what is missing.

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 依据 (book section and rule, inventory row, spec
   item) | 问题 | 唯一改法. Classes: **会出错** (a byte, an order, a read, a clock call or a behaviour differs from the
   base for some input: give the input and both outputs), **违规** (against the book, the run sheet or the spec, or a
   proof gap), **不整洁** (stale comment, dead code or import, a helper or text in two places), **建议** (optional).
2. **Per file:** one line per file of your part: `<file>: OK` or `<file>: <P>-nn, …`.
3. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "basis",
   "problem", "fix"}]`.
4. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
