# PC-2 audit 2, part H: Host, packs on disk and routes (rework 1)

Your part is `H`: `./.lead-ref/parts/H.diff` and `H-files.txt` (`src/app/**`, `create-platform.ts`,
`tests/app/PC2-H-*`). Rows H-01 … H-13 (H-09 same as J-01/J-02).

**Look hardest at:** H-01 (a configured root without a real path is a configuration error at start, naming both
paths; no other start behaviour changed for existing roots); H-02 (all restored roots checked before the restore
loop); H-03 (request validation errors carry `problems`; the HTTP bad-JSON branch keeps it; other settings routes'
bad-JSON answers unchanged — compare `server.ts` with `base/`); H-04 (save reads the chain, compares the effective
version or digest first, then validates the pack after the replacement; an invalid old pack no longer blocks a valid
save; a save that leaves the pack invalid is still `invalid` with every file byte-equal); H-05 (exclusive create; an
identical existing file reused; a different one `unavailable`; nothing overwritten, also on the tool path); H-06, H-07,
H-08, H-10, H-11, H-12, H-13 as the rows say. Any behaviour change outside the prompts routes is **会出错**.
## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is **PC-2 after rework 1** (HEAD `2dae25f`; commits in `.lead-ref/commits.txt`). You audited PC-2 at
`af84802` (audit 1, your reports in `.lead-ref/audit1/`); the lead froze the findings in
`.lead-ref/books/pc2-findings.md` and DSH did rework 1 from it, by the run sheet `books/run-pc2-r1.md` and the
whitelist `books/pc2-r1-whitelist.txt` (regular expressions on paths). This is **audit 2** (decision 80): your findings
become the frozen table for rework 2; at most three reworks. Report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The frozen findings table** `books/pc2-findings.md`: binding. §1 holds the lead's rulings F1 (preparation reads no
  Kernel history; one mode rule `takesSessionHistoryOf`), F2 (registration rejections stay at start) and F3 (old tests
  the book missed, with their exact changes). §2: each row's ruling; **fix** rows are done as your audit-1 row's
  "唯一改法" says plus the lead's note; **rejected** and **deferred** rows stay untouched; **same as** rows are done
  under the row they name.
- **The book** `books/pc2-book.md` (v4) for the rulings the rows cite; the frozen spec in the tree
  `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`.
- **Your audit-1 reports** `audit1/<P>.out.md` (each row's evidence, input, fix and the mutation you named).
- **Your part:** `parts/<P>.diff` (rework 1's change: `af84802` → `2dae25f`) and `parts/<P>-files.txt`. The `af84802`
  version of every changed file is at the same relative path under `base/`; a new file has no base. The whole result
  tree is the current directory.
- **DSH's rework reply** (claims, not evidence): `replies/pc2-r1-reply.md`. §1 its open points and rows that did not
  fit; §2 F1–F3 with its hand sums; §3 each row's test, mutation, RED and GREEN. Its PC-2 reply `replies/pc2-reply.md`
  only to look up what PC-2 built.
- **The lead's full suite before the rework** `checks/full-pc2.txt` (21 files failed; the families F1–F3 explain
  them). The lead is running the full suite on `2dae25f` now; you do not need its result.

## What to check (every part)

1. **Each fix row of your part, one by one** (and F1–F3 where your part holds them): done exactly as the table says?
   Cite the row and the code or test line. A row done differently, partly, or not at all is a finding unless the table
   allowed the choice.
2. **The test bar (decision 80):** each test row goes through the public step the row names; expected values are
   literals or hand-computed, never from production code, the generated pack, `preparedTexts()`, a manifest or a
   captured request; whole texts compared whole; no database or private-module read to check a fact. **Check DSH's
   mutation claim by reading:** would the test as written fail under the mutation it names? If a test passes under it,
   or under an equally simple mutation of the same rule, name that mutation.
3. **Nothing new broken:** a production hunk that changes behaviour beyond what its row asks is **会出错** (give the
   input, the old and the new output). With the platform pack and no new input, prompts, manifests and requests stay
   byte-equal to `af84802` except where a row asks for a change.
4. **Scope:** every hunk is asked for by a row of your part or by F1–F3, or is an import or type the change needs;
   otherwise **违规**. No file outside the whitelist; the four frozen fixtures (`tests/helpers/PC-platform-fixture.ts`,
   `PC-kernel-fixture.ts`, `PC2-pack-fixture.ts`, `PC2-host-fixture.ts`) unchanged; old tests changed only where a row
   or F3 says so, and only as it says; no timeout raised, none above `60_000`.
5. **No test-only paths in production:** a branch, option or export that exists only so a test passes is **违规**.
6. **Comments:** rules and "why" kept with the code; no construction history ("R1 did …", row ids, "PC-2") in
   production code; in tests a row id in a test name or comment is fine.

## Answer

1. **Findings table:** 编号 (`<P>2-01` …) | 类别 | 位置 (`file:line`) | 依据 (row of the frozen table, F1–F3, ruling, spec
   item) | 问题 | 唯一改法. Classes: **会出错**, **违规**, **不整洁**, **建议**. One fix per finding: if the right fix
   needs a lead ruling (e.g. a change outside the whitelist), say so and give the fix you would rule.
2. **Per row:** one line each, every row of your part including rejected, deferred and same-as rows:
   `<row>: OK` / `<row>: <P>2-nn, …` / `<row>: rejected, untouched` (or `touched: …`).
3. **DSH's own items** that touch your part (reply §1 and any "UNSPECIFIED"): one line each, `成立` / `不成立` and why.
4. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "basis",
   "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
