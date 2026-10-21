# The structure round's night-1 probes: recovered and re-run by the lead (2026-10-21)

**Why.** The run sheets put the byte-proof scratch place at `/home/han001/dsh-work/s85-scratch/<run>`, which the DSH
sandbox could not write. S1 and S3 used the sandbox's private `/tmp`, which is gone after a run; S2 copied its probes
into `.dsh-ref/s85-probes-S2/`. Later run sheets put the scratch place inside the copy (`.dsh-scratch/`, excluded from
git).

**How the probes were recovered.** Each run's DSH sessions (coordinator and subagents) are kept as
`session.v4.jsonl.zstd` in `~/dsh-work/ladder/_runs/_state/slices-s9s85-<run>/sessions/`, a chain of Zstandard frames
(`dz.mjs` decodes them frame by frame, following DSH's own frame scan). `recover.mjs` replays, in time order, every
successful `write` and `edit` tool call and every `cat >`/`cat >>` heredoc on paths under `/tmp/s85-scratch/<run>/`,
and reruns the `cd <dir> && python3 - <<EOF … EOF` and `sed -i` patches the runs applied to those files (a patch that
also touched a scratch copy keeps the part that applies to the probe files; marked `-partial` in `manifest.json`).
Copies of the repository (`base*/`, `result*/`) and logs are not rebuilt. Output: `out-S1/files/probes/` (5 files),
`out-S3/files/` (50 files, the probe kits `probes/e1/` and `probes/e2/` among them), each with `manifest.json` (how each
file was made) and `review.json` (other commands that might have written, for reading).

**Re-runs** (`rerun-S1.sh`, `rerun-S3.sh`, `rerun-S3-e2b.sh`; copies under `~/dsh-work/s85-scratch/`, outputs in
`rerun-S1/`, `rerun-S3/`):

| Probe | Base vs base | Base vs result | Result |
| --- | --- | --- | --- |
| S1 D2: enabled / authorized lists, `additionalTools` return, model-client `tools` (Kernel's specs with descriptions and schemas) | 321 = 321 captures, 0 differences | base vs the night-1 merge `n1-merged`: 321 = 321, 0 differences | the merge carries S3's tool texts too, so this also shows the 31 tool descriptions and parameter texts reach the model byte-identical |
| S3 e1: renderer record and replay (13 probes) | the run's own determinism report: only random ids and real `startedAt` differ in the arguments; outputs equal | run 1's 1,968 recorded calls replayed on the base and on the merge: 0 differences each, and the two replay outputs byte-identical | |
| S3 e1: 308 edge inputs | — | base vs merge: 308 cases, 0 differences, 0 errors | the edge set lacked `phase: 'review', items: []` (Codex's P4-01) |
| S3 e2: guide, final Query input, tools at two points | 22 files, 405 records, all raw-byte-equal | base vs S3's own commit `6b8c80f` (the merge carries S1's rewrite of the probe's anchor file): 22 files, 405 records, all raw-byte-equal | one test batch exits 1 on both sides alike |

## S4 (D3b): re-run by the lead (2026-10-22)

S4 kept its probes inside its copy (`.dsh-scratch/S4/probes/`), so nothing had to be recovered. `rerun-S4.sh` builds
fresh copies of `s85-n2-base` and S4's commit `39fee06` under `~/dsh-work/s85-scratch/S4-rerun/`, installs S4's two
kits with their own installers and runs their commands (`COMMANDS.md`, `REPORT.md`); outputs in `rerun-S4/`, log
`rerun-S4.log`. `inner-diff.mjs` parses the JSON inside every differing string of two e-assembler capture dirs and
lists the leaves that differ inside it.

| Probe | Base vs base | Base vs result | Result |
| --- | --- | --- | --- |
| e-assembler: every `assembleTask` / `assembleQuery` / `readAttentionGraph` result, `bodies.put` with the manifests and digests, the `deps` calls with the clock (25 test files) | 613 = 613 records; differences only in dependency return values: 20 Kernel entry bodies (inside them only `.checksum` and `.payload.workspace.revision`) and 6 digests over them | the same 26, plus the copy root in the recorded `configuration.skills.resourceRoot` arguments (11 task, 1 query); results and stored bytes equal | the same counts and paths as S4's report; `inner-diff.mjs` on S4's own runs (all 613 records, including the logs over 1 MiB) gives the same |
| e-assembler replay of base run 1 through the result | — | 61 groups, 141 calls, the same 8 groups fail as in S4's run (cancellation signals and non-JSON brief values do not survive the recording; S4's report) | supplementary; the record comparison above is the proof |
| e-render: 16 probes, 2,156 calls (renderers, 13 fact formatters, `generalWarningLabel`) | 2,156 = 2,156; differences only through the arguments (temporary paths, random ids) | run 1's arguments replayed on the base and on the result: 0 differences each, and the two replay outputs byte-identical | |
| e-render: 140 edge inputs | twice on the base: byte-identical | 140 cases, 0 differences, 0 errors | Codex's Q3-01 found cases missing; rework 2 adds them |
