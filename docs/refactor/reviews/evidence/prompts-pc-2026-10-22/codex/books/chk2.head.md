# Check the PC-1 task book, v2 (second and last full review)

You are reviewing, read only, the lead's task book for PC-1, version 2 (below). The tree at `D:\cxt\pc` is the lead
branch at `dc462a95`. The frozen spec is `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`.
Your first review of v1 is `D:\cc-lead-notes\codex2\pc\chk1.out.md` (16 findings); your inventory is
`D:\cc-lead-notes\codex2\pc\inv-pc1.out.md`. Do not change any file. No tests, builds, git or network.

## What to check

1. **Each of your 16 findings:** fixed, partly fixed (what is missing), or not fixed. One line each unless more is
   needed.
2. **New problems v2 introduced:** a ruling that contradicts the spec or the code, a wrong file:line, a seam in §4
   that does not compile or leaves two groups editing one file in one run, a row that cannot be written with the
   listed fixture capabilities, an old test that will break and is not in §5.3, or a place where two careful
   implementers would build different things.
3. **PC-1a alone** (groups K and C): after it, does the tree typecheck, build, pass `check:architecture`
   (including production-reach with the allowlist entries of ruling 13) and keep every existing test green?
4. Only real problems; do not repeat style remarks.

## Answer

Chinese is fine. First the 16-line status table, then new findings numbered, each with severity (阻塞 / 应改 /
可选), the ruling or row, the evidence (file:line), and the change you propose to the book text. End with one line:
`结论：可冻结` or `结论：改后再核`.

---

# The book (v2)
