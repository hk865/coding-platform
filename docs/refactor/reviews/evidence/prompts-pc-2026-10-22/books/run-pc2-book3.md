# PC-2, run PC-2-B3: edit the PC-2 task book to v3 (lead, 2026-10-22, noon)

You are run **PC-2-B3**, a documentation run. Edit the PC-2 task book from v2 to v3 by the lead's rulings. You change
**no** code and commit nothing: the only file you write is `./.dsh-ref/pc2-book-v3.md` (start by copying
`./.dsh-ref/pc2-book-v2.md`), plus your reply. A new Session, headless: **when your turn ends, the whole run ends.**

| | |
| --- | --- |
| Tree | this copy: lead `dc462a95` plus W's commit `87f16ba` (the ten tool factories take `texts?`) |
| Time limit | @MINUTES@ min |
| Reply | `./.dsh-ref/pc2-book3-reply.md`, plain Chinese |

## Read

- The book v2 `./.dsh-ref/pc2-book-v2.md` (written this noon from v1).
- Codex's second review `./.dsh-ref/pc2chk2.out.md` (Chinese) and the lead's rulings `./.dsh-ref/pc2-chk2-rulings.md`.
  **The rulings bind**: four from the lead's own line review (L1–L4), nine on Codex's findings (C1–C9) and one on DSH
  choice 8 (D8). Where a ruling says "as Codex proposes", use Codex's text as the content, in the book's style.
- PC-1's frozen book `./.dsh-ref/pc1-book.md` (§3.2, §4) and PC-1a's interface table `./.dsh-ref/pc1a-am-reply.md` §4.
- The code, to fill in signatures and `file:line` the rulings ask for (L2, C1, C3–C7).

## How to edit

- Apply all fourteen rulings. Where a ruling freezes a signature, a DTO or an interface seam (L2, C1, C2, C3, C4, C5,
  C6, C7), write it as a TypeScript block from the code as it is, with `file:line` for each input you name. Mark
  anything you had to choose with `[DSH choice: …]` so the lead sees it.
- Update the rows the rulings name (PC-18, PC-20, PC-21), §4's hand-over order (C6) and the owner table (C8).
- The first line under the title says: v3, for Codex's quick check; frozen when it passes.
- Keep the book's style: plain English, short sentences, rulings numbered, no construction history. Keep what no
  ruling touches as it is.
- You may use subagents for the code lookups; you write the book yourself.

## Reply (plain Chinese)

Per ruling (L1–L4, C1–C9, D8): what you changed (section and ruling numbers), and each `[DSH choice]` with its reason;
anything you could not apply, and why; the line count of v3.
