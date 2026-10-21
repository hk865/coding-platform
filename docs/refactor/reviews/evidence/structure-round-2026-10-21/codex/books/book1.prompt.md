# Check of a DSH task book: the structure round before 6A (decision 85-1)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git, no network. Answer in plain
Chinese, with `file:line` for every fact about the code.

This tree is the lead branch at `6d637d56`. The lead wrote the task book `./.lead-ref/s85-book.md` from your three
inventories (`./.lead-ref/inv-d3.out.md`, `inv-rest.out.md`, `inv-b1.out.md`). DSH will apply it literally, in four
runs (book §6), after the scale-test split SC (`./.lead-ref/sc-book.md`) has merged. The frozen spec D3 must follow is
`docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`; the format example of an earlier
behaviour-identical round is `./.lead-ref/c1-book-format-example.md`.

## Check

1. **Would a literal implementer change behaviour or be forced to change a test?** Name each place in the book
   (section) where following it as written changes bytes, order, reads, error texts, exports or types, or breaks
   `tests/architecture` (production reach, state writes, boundaries), and say how to fix the wording.
2. **Contradictions:** between the book and your inventories (where the book overrides an inventory, is the override
   sound?), between the book and the frozen spec, and inside the book.
3. **File ownership:** do S1, S2 and S3 really edit disjoint files? Does S4 need any file the book does not list, or
   does any run need a file outside its list? Check the import graph for new modules (contracts must not import
   runtime; `scripts/check-boundaries.mjs`).
4. **The lead's rulings in §5.1 and §5.6:** the static generated pack, the renderer throwing plain errors, the tool
   JSON shape, design 2 for B1. Can they be built on this tree as written? What is missing for DSH to do it without
   asking?
5. **Byte proofs:** can each one be carried out as written (scratch copies, record and replay, the tool schema
   comparison, the assembler capture)? Where would it miss a difference it claims to catch?
6. **Sizes and order:** are the run sizes and the night order realistic; anything that should move between runs?

A table with columns `编号 | 类别（会出错/冲突/事实错/不清楚/建议） | 书的位置 | 问题 | 依据（file:line） | 改法`, numbered
B-01, B-02, … Then the last line exactly: `会出错 N，冲突 N，事实错 N，不清楚 N，建议 N`
