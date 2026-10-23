# PC-2 audit, part H: packs on disk, the editing routes and the settings model (rulings 1–3, 6–8)

Your part is `H`: `./.lead-ref/parts/H.diff` and `H-files.txt`: `src/app/host-settings-types.ts`, `host-settings.ts`,
`host.ts`, the new `prompt-packs.ts` (and `server.ts`, `runtime-configuration.ts` if changed),
`src/composition/create-platform.ts` (the disk pack source), H's tests (`tests/app/PC2-H-*`) and the old tests
`tests/app/S2B-backfill-host`, `S2B-35-activity-routes`, `tests/helpers/S2B-r2-backfill-kernel-support.ts`. The book
§3.1 rulings 1, 2, 3, 6, §3.2 rulings 7, 8, §4 (H's row), §5.1 (the Host fixture), §5.2 PC-04, PC-05, PC-22 (save),
PC-23, PC-25 (routes), §5.3 (the S2B lines).

**Look hardest at:**

- **Ruling 2, the directory checks.** Real paths compared by path segments (`path.relative` neither `..`-prefixed nor
  absolute), never by string prefix, never through `canonicalExisting`. At start: `prompts/` created and its real path
  taken; each configured root and, after the settings file is parsed, each restored root compared; equal or
  containing → the Host fails to start naming both. On opening a workspace: after its realpath and directory check,
  **before** the existing-root shortcut and any registration; a root equal to or containing the prompts directory →
  `invalid`. Each pack's and each parent's real directory inside the real `prompts/`. **Reply §8.3:** "a configured
  root that does not exist skips the overlap check" — trace what the Host does with such a root (does
  `validateWorkspaces` already reject it, or can it be created later and then cover `prompts/`?). "The save target's
  parent must be inside the pack and inside prompts" is stricter than the book: harmless?
- **Ruling 3, reading.** Asynchronous at every preparation, no cache across preparations; every manifest file a
  relative path without a `..` **segment** (but `..name` legal), not absolute, real path inside the pack's real path;
  `platform` from the generated module. The Host's port wiring replaces PC-1's platform-only source: reply §8.3 says
  the Host builds the disk source and passes it as `TargetPlatformOptions.promptPacks`. Is there any production path
  (another `createPlatform` caller, a Host without a settings directory) that silently ends with the platform-only
  source when a settings directory exists? A Host without a settings directory: platform only, and no editing routes.
- **Ruling 6, the routes.** The six route names, DTO shapes, codes (`not_found`, `invalid` with `problems`,
  `forbidden`, `revision_conflict`, `unsupported` without a settings port). `list` ready with a broken pack, its
  problems kept, an unreadable manifest → `templates: []`, `platform` first then by id (reply §8.3: "a broken pack's
  list shows the readable chain declarations" — is that what the book says?). `create`. **Save in order:** `platform`
  forbidden first; version (or tool digest) against the **effective** entry (inherited → the parent's); whole-pack
  validation after the save, failure leaves every file unchanged; new file `templates/<id>@<v>.txt` or
  `tools/<name>@<16 hex>.json`; `pack.json` replaced atomically (temp and rename); old version files stay; saves
  serialized like settings saves. A crash between the new file and the rename leaves the visible version as it was.
  The tool digest is ruling 19's canonical body (A's function, not a second copy).
- **Ruling 7 and 8.** `promptPack` / `reasoningReplay` in the public type, the save DTO, the stored model, parse,
  initial and save; save checks syntax only; the read projection shows a field only when set; **a save without the
  field clears it**; the startup catalog never restores a pack or policy over a later save (a restart after such a
  save still resolves the defaults). `settingsModelBinding` passes both into the trusted model configuration.
- **Access.** The routes sit in the settings branch with the settings gate (token and same origin); no new principal.
- **The S2B tests:** only the settings directory separated from the workspace; no backfill assertion loosened.
- **Tests:** PC-23's cases (inside a configured root, inside a restored root, equal path, symlink out of `prompts/`,
  an ancestor opened → `invalid`, an unrelated directory opens); PC-04 (7 → 8, files byte-equal after an `invalid`
  save, each code); PC-25's routes (digest hand-computed from the literal canonical body, the new file name). Are the
  expected digests and bytes literals? Name a mutation each would miss (e.g. string-prefix comparison, check after the
  existing-root shortcut, a non-atomic write, a cache across preparations).
## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is run **PC-2** of the prompts-and-context construction (decision 83-4, 83-5): groups **A** (pack, pure),
**W** (tool texts as input), **H** (Host), **T** (texts and rendering), **G** (guard and entry), **Q** (preparation to
request) and the **joint step** of the frozen book `./.lead-ref/books/pc2-book.md` (v4). DSH built it in one run on
base `pc2-base` = PC-1 as accepted (`pc1-final`, `68dfb10`) plus W's earlier commit `99e15bc` (the ten tool
factories take `texts?`) plus one commit with the two frozen fixtures `tests/helpers/PC2-pack-fixture.ts` and
`PC2-host-fixture.ts`. Commits are in `.lead-ref/commits.txt`. This is the **first audit** (decision 80): your
findings become the frozen table for rework 1 (at most three reworks). Report everything you can prove, and nothing
you cannot. Slice 6A builds on this tree; a wrong or missing interface is a finding.

Inputs in `./.lead-ref/`:

- **The book** `books/pc2-book.md` (v4, binding): §1, §2 (rules for all groups), §3 (rulings 1–21), §4 (groups,
  owners, order), §5 (fixtures, rows PC-01…PC-05, PC-18…PC-26, old tests §5.3), §6. The run sheet `books/run-pc2.md`
  and the whitelist `books/pc2-whitelist.txt` (regular expressions on paths). The lead's rulings on Codex's book
  checks: `books/pc2-chk1-rulings.md`, `books/pc2-chk2-rulings.md` ("check ruling N" in the book).
- **The frozen spec** in the tree: `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`
  (the post-note, P1, P2, P5, P8, P9, P10, §2, §3).
- **PC-1 as built:** `books/pc1-book.md` §3.2, `replies/pc1a-interfaces.md` §4, and the "Book corrections" sections
  of `books/pc1b-findings.md` and `books/pc1b-r2-findings.md`.
- **Codex's inventory and book checks** (Chinese): `books/inv-pc2.out.md`, `books/pc2chk1.out.md`, `pc2chk2.out.md`,
  `pc2chk3.out.md`.
- **Your part:** `parts/<P>.diff` (against `pc1-final`) and `parts/<P>-files.txt`. The `pc1-final` version of every
  changed file is at the same relative path under `base/`; a new file has no base. The whole result tree is the
  current directory.
- **DSH's reply** (claims, not evidence): `replies/pc2-reply.md`. Its §1 (questions and what it says the book
  missed), §3 (each row's test and the mutation it claims), §5, §7 and §8 (seams coded differently, UNSPECIFIED) are
  DSH's own account; check each item that touches your part against the book and the code, and say whether DSH's
  way holds. W's earlier reply `replies/pc2w-reply.md` for W's first commit.
- **Tests:** the lead runs them separately (the full suite with bubblewrap); you do not need results.

## What to check (every part)

1. **The rulings of your part**, one by one: built exactly as the book says? Cite the book line and the code line.
   Where the book leaves a choice (`[DSH choice: …]`), is the choice reasonable and stated in the reply?
2. **Behaviour where the book promises none changes** (§2 rule 1): with the platform pack and no new input, the
   prompts, manifests, requests and records are as before, byte for byte, apart from the changes §2 rule 1 lists. A
   difference for some input is **会出错**: give the input, the old output and the new output. A behaviour change
   outside prompts (a Run that used to start and now does not, or the reverse) is **会出错** unless a ruling asks for
   it; then name the ruling and the old tests it breaks.
3. **Tests (decision 80 bar):** every row of your part is tested through the public step the book names; expected
   values are literals or hand-computed, never taken from production code, the generated pack, `preparedTexts()`, a
   manifest or a captured request; no test reads the database or a private module to check a fact; a whole text is
   compared whole, not by a prefix or a regular expression; a test would fail if the rule it guards were broken
   (name a simple mutation it would miss). Old tests: only those §5.3 (and §3.3's PC-2 bullets) name may change, only
   for the reason given, and their other assertions stay. Per-test limits: none unless needed, never above `60_000`,
   no old limit raised.
4. **Scope:** every hunk is asked for by the book for your group, or is an import or type the change needs;
   otherwise **违规**. No file outside the whitelist; no group edited a file another group owns (book §4) except as
   the reply admits; the four frozen fixtures (`tests/helpers/PC-platform-fixture.ts`, `PC-kernel-fixture.ts`,
   `PC2-pack-fixture.ts`, `PC2-host-fixture.ts`) unchanged.
5. **No test-only paths in production:** a branch, option or export that exists only so a test passes is **违规**.
   An unreachable branch (dead code) is **不整洁**, with the reason it cannot be reached.
6. **Comments:** rules and "why" kept with the code; no construction history ("PC-2 did …", "moved from …", group
   or row ids) in production code; in tests a row id in a test name or comment is fine.
7. **Fixture defects:** where DSH says a frozen fixture cannot carry a row, check it. If the fixture is at fault,
   say so and give the smallest fixture patch (Codex writes fixtures; the lead freezes them). If the row can be
   carried another way within the rules, say how.

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 依据 (book ruling or row, spec item) | 问题 |
   唯一改法. Classes: **会出错** (a behaviour differs from the book or the spec for some input, or an interface 6A
   relies on is wrong: give the input and both outputs), **违规** (against the book, the run sheet or the spec,
   including a test below the bar), **不整洁** (stale comment, dead code or import), **建议** (optional). One fix per
   finding: if the right fix needs a lead ruling (e.g. a change outside the whitelist, or a book correction), say so
   and give the fix you would rule.
2. **Per ruling and row:** one line each: `<ruling or row>: OK` or `<…>: <P>-nn, …`.
3. **DSH's own items** that touch your part (reply §1, §8, and any UNSPECIFIED): one line each, `成立` / `不成立`
   and why.
4. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "basis",
   "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
