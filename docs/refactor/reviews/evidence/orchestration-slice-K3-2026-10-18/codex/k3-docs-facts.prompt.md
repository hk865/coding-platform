Read-only facts check for the lead. Do not write any file, do not run tests. Answer in Chinese with file:line.

This copy is the K3 merge tree with DSH's DRAFT documents for K3 (`./.dsh-ref/dsh-docs.diff` is the whole draft as a diff; the drafted files are in place): `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (header post-note and §10), `docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md` and `lead-acceptance.md`, `docs/refactor/STATUS.md`, `docs/refactor/IMPLEMENTED-CAPABILITIES.md` (WG60), `docs/refactor/design/orchestration-2026-10/slices/README.md`, `AGENTS.md`. The material the drafts cite is under `./.dsh-ref/evidence/` (`books/`, `dsh/`, `codex/`, `checks/`; the evidence paths in the drafts are relative to that folder). The DSH task is `./.dsh-ref/k3-docs.md`; the lead's post-notes list is `./.dsh-ref/k3-merge-postnotes.md`.

Check every factual sentence of the drafts against the cited material and the code:
1. **Numbers**: run seconds/tokens/peaks against `checks/dsh-runs.txt`, totals, sizes against `checks/merge-stat.txt`, full-suite numbers against `checks/r9b-full-suite.txt` / `checks/r10-full-suite.txt` (the spec §10.8 and the README's round-10 row state different round-10 results — which is right?), counts of must-fix items per review, F-row counts (production 25 = 5+20, tests 76 = 20+56: does that total 102 with F-102?).
2. **Citations**: does each cited book/ruling/row/review item say what the sentence claims? Flag wrong section numbers and claims the source does not make.
3. **Code facts** in spec §10 (file:line, names like `toolCommitRequestId`, `reviewBlocker`, `consumeAllowance`, `CommandRerunRequestReplyV1`, `preferred`): do they hold in this tree?
4. **Internal consistency** across the seven files (e.g. §10.1 says group 4 was split "into three, not two" and then lists four parts g4a/g4b1/g4b2/g4b3).
5. **Completeness against the task**: every item of `k3-merge-postnotes.md` present in §10; every T item the task lists present in §10.10; STATUS next steps as the task says.
6. The five "contradictions" DSH reported at the end of `./.dsh-ref/../` reply (they are repeated in the README section "材料里的更正"): is each resolution right?

Output: a numbered list of problems (file:line of the draft, what is wrong, the correct text or fact with its source). Skip style. End with: problem count.
