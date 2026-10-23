# PC-2, run PC-2-B2: edit the PC-2 task book to v2 (lead, 2026-10-22, noon)

You are run **PC-2-B2**, a documentation run. Edit the PC-2 task book from v1 to v2 by the lead's rulings. You change
**no** code and commit nothing: the only file you write is `./.dsh-ref/pc2-book-v2.md` (start by copying
`./.dsh-ref/pc2-book.md`), plus your reply. A new Session, headless: **when your turn ends, the whole run ends.**

| | |
| --- | --- |
| Tree | this copy: lead `dc462a95` plus W's commit `87f16ba` (the ten tool factories take `texts?`) |
| Time limit | @MINUTES@ min |
| Reply | `./.dsh-ref/pc2-book2-reply.md`, plain Chinese |

## Read

- The book v1 `./.dsh-ref/pc2-book.md`.
- Codex's review `./.dsh-ref/pc2chk1.out.md` (Chinese, 17 findings) and the lead's rulings
  `./.dsh-ref/pc2-chk1-rulings.md`. **The rulings bind**; where a ruling says "as Codex proposes", use Codex's text as
  the content and write it in the book's style.
- PC-1's frozen book `./.dsh-ref/pc1-book.md` (§3.2, §4) and PC-1a's interface table `./.dsh-ref/pc1a-am-reply.md`
  §4 for the names PC-2 builds on (two notes: `promptSelectionOf` takes a structural parameter; `skills` on the Kernel
  inputs is `readonly SkillContext[]`).
- Codex's inventory `./.dsh-ref/inv-pc2.out.md` and the code, to fill in signatures and `file:line` the rulings ask
  for (rulings 3, 8, 9, 11, 13).

## How to edit

- Apply all 17 rulings. Ruling 1 changes the structure: one run, no PC-2a/PC-2b; W's commit is in the base and W
  returns as a small rework group (rulings 8, 16).
- Where a ruling asks the book to freeze a signature or a DTO (rulings 3, 9, 11, 13), write it as a TypeScript block
  from the code as it is, with `file:line` for each input you name. Mark anything you had to choose with
  `[DSH choice: …]` so the lead sees it.
- Ruling 15: recompute every number by hand in the book and show the sums.
- Keep the book's style: plain English, short sentences, rulings numbered, no construction history. Keep what no
  ruling touches as it is.
- You may use subagents for the code lookups (one per ruling group); you write the book yourself.

## Reply (plain Chinese)

Per ruling: what you changed (section and ruling numbers), and each `[DSH choice]` with its reason; anything in a
ruling you could not apply, and why; the line count of v2.
