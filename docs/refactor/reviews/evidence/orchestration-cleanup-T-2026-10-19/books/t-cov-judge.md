# Task: judge the coverage triage of the T round (read-only; output files only)

You are working in a copy of the repository (the current directory): the lead branch with T applied. This is a NEW
session. **This run is read-only on the repository:** no edits under `src/`, `tests/` or `docs/`, no tests, no builds,
no installs, no git writes, no network, no real model calls. The only files anyone writes are the output files under
`./.dsh-ref/out/` (and `./.dsh-scratch/` for your own notes). **Finish within 170 minutes** (the run stops at 190).

**This run is headless. When your turn ends, the whole run ends.** Do not end your turn while a subagent has not
reported back: wait with `sleep 300`, then `list_agents`.

## 1. What this is

After T, 795 code locations are not executed by any test. Two reviewers, Codex and Claude, classified every one
independently into D1 / D2 / U / F / G / N / 待定 (`./.dsh-ref/judge-common.md` defines them). They agree on 628. This
run is the third, deciding look, in three kinds of batches (`./.dsh-ref/judge/index.json` lists every batch and its
row ids):

| kind | batches | rows | role (see `judge-common.md`) |
|---|---|---|---|
| `tw-01` … `tw-08` | 8 | 19 | VERIFIER: both reviewers say T deleted the only test of reachable behaviour for a wrong reason; try to refute it |
| `dis-01` … `dis-29` | 29 | 167 | JUDGE: the reviewers disagree, or one said 待定 |
| `skep-01` … `skep-28` | 28 | 276 | SKEPTIC: both put the row in D1, D2 or U (delete, or keep untested); try to refute it |

Then pass 2, which pass 1 decides: `vt-dis-NN` (VERIFIER, for judge rows marked `t_reason_wrong`) and `tie-skep-NN`
(TIEBREAK JUDGE, for skeptic rows marked `refuted` or `proposal_ok: false`).

## 2. How to work: you coordinate, subagents judge

- **You do not judge rows yourself and do not read the batch files, the code or the output files.** You brief
  subagents, read their short reports, and run the checker.
- **One subagent per batch.** At most **12 subagents at a time** (none of them runs tests, so memory is not the
  limit). Each writes only its own output file; no two running subagents share a batch.
- **Order:** the 8 `tw` batches first, then the 29 `dis`, then the 28 `skep`. Start the next batch as soon as a slot
  frees.
- **The brief** (copy it, fill the role, the name and the row ids from `index.json`):

  > Read `./.dsh-ref/judge-common.md` in full; it has the background, the paths, the classes and the output format.
  > Your role: **ROLE**. Your batch: `./.dsh-ref/judge/NAME.json`, rows ROW-IDS. Write `./.dsh-ref/out/NAME.json`
  > in the format for your role, then run `python3 -I ./.dsh-ref/check-out.py NAME` and fix the file until it says
  > `ok`. Do not edit any other file, do not run tests, builds or git writes, do not start subagents. Report in under
  > 120 words: the counts per class (or upheld / not upheld), the rows you flagged, anything you could not settle.

  ROLE is `VERIFIER OF A FINDING AGAINST T` for `tw-NN`, `JUDGE` for `dis-NN`, `SKEPTIC` for `skep-NN`.
- **Pass 2.** When every `dis` and `skep` batch has reported, run `python3 -I ./.dsh-ref/check-out.py --pass2`. It
  prints one line per pass-2 batch with its rows. Brief one NEW subagent per line (never the one that wrote the
  pass-1 file), with the same brief and:
  - for `vt-dis-NN`: role `VERIFIER OF A FINDING AGAINST T`; "your rows are the entries with `t_reason_wrong: true`
    in `./.dsh-ref/out/dis-NN.json` (a judge's answers); the reviewers' answers are in `./.dsh-ref/judge/dis-NN.json`";
  - for `tie-skep-NN`: role `TIEBREAK JUDGE`; "your rows are the entries with `refuted: true` or
    `proposal_ok: false` in `./.dsh-ref/out/skep-NN.json` (a skeptic's answers); the reviewers' answers are in
    `./.dsh-ref/judge/skep-NN.json`".
- **If a report says the file is not `ok`, or a subagent ends without a file:** brief a new subagent for that batch
  once. If it fails again, list the batch in the summary and move on.
- **Time.** At minute 150, brief nothing new; wait for the running subagents, then close out. Batches not done are
  listed in the summary; that is acceptable.

## 3. Close-out

1. Run `python3 -I ./.dsh-ref/check-out.py --all` and keep the last 15 lines of its output.
2. Write `./.dsh-ref/out/SUMMARY.md` (at most 40 lines): the batches done per kind (pass 1 and pass 2), the batches
   not done or not `ok` and why, the checker's last line, and, from the reports only, the rows subagents could not
   settle. Do not restate their findings; the lead reads the files.
3. Delete `./.dsh-scratch/`, the directory itself too.
4. Your final reply: under 150 words, the same facts as the summary's first lines.
