Read-only quick recheck for the lead. Do not write any file, do not run tests. Answer in Chinese with file:line.

You checked DSH's first K3 document draft and listed 40 problems (`./.dsh-ref/k3-docs-facts.out.md`). DSH has now revised the drafts per `./.dsh-ref/k3-docs-fix.md` (the revision is `./.dsh-ref/dsh-docs-fix.diff`; the files in place are the revised ones; the whole docs change against the merged code tree is `./.dsh-ref/dsh-docs-all.diff`). The material is under `./.dsh-ref/evidence/` (`books/`, `dsh/`, `codex/`, `checks/`), now also with `codex/k3-merge-check.out.md`, `checks/k3-merge-fix.diff`, `codex/k3-mfix-tests.out.md`, `checks/k3-mfix-check.txt` and `books/k3-x07-book.md`.

This is the last check before the lead's line review (review cap), so be precise and short:
1. For each of your 40 items: fixed / not fixed / fixed wrongly (one line each; file:line for the last two with the right text).
2. Section 2 of `k3-docs-fix.md` (A: the merge check and the merge fix with its tests and mutation check; B: K3-07 and K3-49 not built, make-up running; C: the two corrections): placed correctly and stated exactly as the material says? List only errors.
3. New errors the revision introduced (numbers, sources, contradictions between the six files), especially in the new per-row table in `lead-acceptance.md` (F-001–F-102, N-01–N-04: class and ending against `checks/k3-business-classification.md`, `checks/k3-final-freeze.md`, the books 9/9b/10 and `codex/k3-verify9.out.md`, `codex/k3-final-list.out.md`) and in the T count.

End with: remaining problem count.
