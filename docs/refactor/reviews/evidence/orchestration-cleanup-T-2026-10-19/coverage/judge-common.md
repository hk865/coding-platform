# Coverage triage: judging the two reviews (decision 79-4) — common rules for every subagent

Read-only work for the lead. **Do not edit anything under `src/`, `tests/` or `docs/`; do not run tests, builds,
installs or git commands that write; no network.** Write only your own output file(s) under `./.dsh-ref/out/`.
Answer in English.

## Background

The T round (HANDOFF decision 79-4) cleaned up the test suite and removed production code kept only for old data.
Decision 79-4 says, for the coverage runs before and after T: "测试没执行到的分支只是候选：真不会发生的才删，会发生但
没测的记成测试缺口，不删。" Also binding: decision 79 (no old-data compatibility: code reads only the current format;
old development databases are rebuilt) and `AGENTS.md` rule 4 (there is no running-Role hot-switch lifecycle;
defensive checks or tests that only tampering with the database can trigger are not restored).

795 code locations (a branch arm or a function) are not executed by any test after T. Two reviewers, Codex and
Claude, classified every one independently. Your job is the third, deciding look: you do not classify from scratch
for nothing; you check each side's evidence in the code and decide what the evidence supports.

## Where things are (inside this copy)

| path | what |
|---|---|
| `./` (`src/`, `tests/`, `docs/`) | the code after T: every `path:line` of a row points here |
| `./.dsh-ref/before/` (`src/`, `tests/`) | the code before T (the tag `t-base`) |
| `./.dsh-ref/evidence/books/` | T's items and their reasons (`t-items-TP.md`, `t-items-TQ.md`, `t-items-T1-w2.md`, `t-items-T2-w2.md`, `t-items-T3-w2.md`), the per-row verdicts `t-final.json`, the rule sheets (`t-common.md`, `test-rule-sheet-v2.md`), the finding tables with the rulings in their §0 (`t-w1-findings.md`, `t-w1r1-findings.md`, `t-w1r2-findings.md`, `t-w2b-findings.md`, `t-w2r2-findings.md`, `t-w2r3-findings.md`) |
| `./.dsh-ref/cov/lists/list-<G>.tsv` | the rows (`row, group, path, line_after, line_before, kind, name_or_type, arm, arms`) |
| `./.dsh-ref/cov/ref/` | `mapped-summary.txt`, `compare-summary.txt` (how the rows were found), `t-src-U0.diff` (T's diff of `src`), `t-files-deleted-added.txt`, `t-end-list.md` (what the lead already holds for the user) |
| `./.dsh-ref/codex/t-cov-<G>.out.md` | Codex's full answer for group G; `t-cov-common.md` is the task both reviewers got |
| `./.dsh-ref/judge/<name>.json` | your batch: per row both answers (`codex` and `claude`: class, reason, proposal; for group A also the before-T test and the T item) |

**Path translation.** The two reviews were written outside this copy. Read their paths this way:
`D:/cxt/t-docs/tree/` = `./`; `D:/cxt/t-inv/` = `./.dsh-ref/before/`; `D:/cxt/t-docs/evidence/` =
`./.dsh-ref/evidence/` (so `D:/cxt/t-docs/evidence/books/` = `./.dsh-ref/evidence/books/`); `D:/cxt/t-cov/` =
`./.dsh-ref/cov/`; `D:/cc-lead-notes/codex2/` = `./.dsh-ref/codex/`. **Codex used short prefixes** (`W/`, `S/`, `T/`,
`B/`, `E/`, `EP`, `E1`, `前/`, `后/`, `现/`, `证/`, …) and named fault seams and step lists by letter or number
(`R`, `C`, `K`, `P5`, `P01`, …): each group's prefixes are defined at the top of `./.dsh-ref/codex/t-cov-<G>.out.md`
and the step lists follow its table. Open that file when a Codex cell uses one. Group A and B rows are
`A1-…`, `A2-…`, `A3-…`, `B-…`; group C rows are `C1-…` to `C4-…`.

**Groups.** A: covered before T, not after, on a line T did not change (T deleted or changed the last test that
executed it). B: not covered, on a line T added or rewrote. C: a function not covered before T and still not after.
For a branch, `arm` is the 0-based arm index (`if` arm 0 = then, arm 1 = else/fall-through; `cond-expr`,
`binary-expr` (`&&`, `||`, `??`), `switch` (one arm per case), `default-arg`).

## The classes (exactly as both reviewers had them)

- **D1 走不到:** no production caller path reaches the code at all (dead export, a constant condition, a function only
  tests use). Proposal: what to delete.
- **D2 不会发生:** callers exist, but the state that takes this arm cannot arise: an upstream check refuses it first,
  the type or the codec guarantees it, or the only writer never writes it. Proposal: what to delete and what then
  simplifies.
- **U 只有篡改才会发生:** only a record written outside the platform's owners (a hand-edited or corrupted store, a
  foreign writer, an old-format record) reaches it. Proposal: delete the guard, or keep it untested (no new test that
  tampers), and why.
- **F 外部故障:** reachable through a real external event: an IO, disk or store failure, a process crash or restart,
  a timeout, a cancellation, a concurrent writer, a model or provider error. Test gap. Proposal: the public steps
  plus the seam that injects the fault (one the tests already use, with `file:line`).
- **G 公开步骤能到、没测:** reachable through public steps without any fault. Test gap. Proposal: the public steps
  in order and the existing test file it belongs in.
- **N 不适用:** a log or debug line, a type-only artefact, or code whose test belongs elsewhere (say where).
- **待定:** the evidence does not settle it; say exactly what would.

**When it is close.**
- U vs D2: U when the arm is reached only by reading a stored record (or input from a foreign writer) in a shape no
  platform writer produces today; D2 when the arm sits in live computation or on validated input and an upstream
  check, the type, the codec or the only writer guarantees the state never arises.
- F vs G: F when reaching the arm needs a real external event injected through a seam (including a concurrent writer
  racing between two reads); G when plain public steps in order reach it with no fault.
- D1 vs D2: D1 when no production caller path reaches the code at all; D2 when callers exist but the state cannot
  arise.
- A spec line that reserves a member or path for a later slice is a reason to keep the code (say so in the proposal),
  not a reason to call it reachable.

**Evidence.** Every claim needs `file:line` in this copy (after T), or in `./.dsh-ref/before/` for group A history.
Open the code yourself; do not trust either reviewer's citation without checking it. Use `grep -rn` and
`sed -n 'a,bp'`; never print whole files. Prefer 待定 (with what would settle it) over a guess.

## Your role (the brief tells you which)

### JUDGE (batch `dis-NN`)

The two reviewers disagree on these rows, or at least one said 待定. For each row open the code, check each side's
cited evidence, and decide the class the evidence supports. Do not split the difference; if both are wrong, give the
right class. For group A rows also decide whether T removed the only test of reachable behaviour for a wrong reason
(`t_reason_wrong`), naming the T item. Write `./.dsh-ref/out/dis-NN.json`:

```json
{"rows": [{"row": "A1-004", "cls": "U", "winner": "codex", "reason": "… file:line …", "proposal": "…",
  "t_reason_wrong": false, "t_item": ""}]}
```

`cls` one of `D1 D2 U F G N 待定`; `winner` one of `codex claude both neither` (whose class the evidence supports);
`proposal` as the class asks; `t_item` for group A: the T item and the before-T test `file:line`, else `""`. Exactly
one entry per row of the batch.

### VERIFIER OF A FINDING AGAINST T (batch `tw-NN`, and pass-2 batch `vt-dis-NN`)

Both reviewers (or a judge) say T deleted or changed the only test of this reachable behaviour for a wrong reason.
Try to refute it: (a) search the after-T tests (`./tests`) for a test that still executes these lines and asserts
the behaviour (by the function, the error code, the state); (b) check that public steps (or a real fault through an
existing seam) reach the lines without tampering, and that the proposed steps are possible with the current code;
(c) read the T item and its ruling in `./.dsh-ref/evidence/books/` and check whether T's reason holds for these
lines. Uphold only if all three survive. If upheld, give concrete restore steps with existing helpers and the spec
line that requires the behaviour. Write `./.dsh-ref/out/<name>.json`:

```json
{"upheld": true, "still_covered_by": "", "t_reason_check": "… file:line …",
 "rows": [{"row": "A1-032", "cls": "G", "note": "…"}],
 "restore": "public steps in order, helpers with file:line, target test file, assertions with expected values",
 "spec_basis": "the spec or MVP behaviour line, file:line"}
```

One `rows` entry per row of the cluster.

### SKEPTIC (batch `skep-NN`)

Both reviewers independently put these rows in the same class (D1, D2 or U); agreement is not proof. For each row try
to refute the class: search for a production caller path (routes in `src/app`, tools, the runtime, recovery after a
restart, the CLI in `src/main.ts`, `src/ui`), a platform writer that produces the record shape, or public steps or a
real fault that reach the arm. `refuted` is true only with a concrete path and `file:line`. Also check the agreed
proposal: for a deletion, that nothing else calls it, that no exhaustive switch or type depends on it, and that no
spec line reserves it for a later slice; for U, that no platform writer produces the record shape today. Write
`./.dsh-ref/out/skep-NN.json`:

```json
{"rows": [{"row": "A1-002", "refuted": false, "cls": "U", "evidence": "… file:line, or what you searched …",
  "proposal_ok": true, "proposal_note": ""}]}
```

Exactly one entry per row of the batch.

### TIEBREAK JUDGE (pass-2 batch `tie-skep-NN`)

Both reviewers agreed on a class for these rows; a skeptic then challenged some of them (`./.dsh-ref/out/skep-NN.json`,
the entries with `refuted: true` or `proposal_ok: false`). For each challenged row open the code and decide: does the
skeptic's path really reach the arm without tampering, or is the agreed class right? Is the objection to the proposal
right? Write `./.dsh-ref/out/tie-skep-NN.json` in the JUDGE format (`winner`: `codex`/`claude`/`both` when the
agreed class stands, `neither` when the skeptic is right), one entry per challenged row only.

## Check your file before you report

`python3 -I ./.dsh-ref/check-out.py <name>` validates one output file (JSON, the row ids, the fields). Fix it until it
says `ok`. Then report in under 120 words: the counts per class (or upheld / not upheld), the rows you flagged
(`t_reason_wrong`, `refuted`, `proposal_ok: false`), and anything you could not settle.
