# 8A capture cost near the L12 limits (Claude subagent a0f0bfe8, 2026-10-17 ~13:20; probe build in WSL)

Outputs: `~/dsh-work/measure-8a/scale/{out,logs,storage}`, scripts `scale/mk-scale.sh`, `scale/run-scale.sh`,
`measure-scale.mjs` (derived from `measure-8a.mjs`; timing wrappers on CaptureRegistry, TypeScriptSourceAnalyzer, the
language service; stored sizes; step-3 sizing). Each run: available > 2 GB check, `systemd-run --scope -p MemoryMax=6G`.

## Synthetic (7 module mappings; each file imports 5 lower-numbered files, no cycles; path 47–50 B; body ~350 B)

| files / imports | capture | wall | peak RSS | TS analysis (2 passes) | read passes | module body | file layer |
|---|---|---|---|---|---|---|---|
| 2k / 9,980 | 14.6 s | 16 s | 436 MiB | 1.0 + 0.7 s | 12.6 s | 714 KB | 1.33 MB, 6 chunks |
| 5k / 24,980 | 26.2 s | 27 s | 800 MiB | 1.5 + 1.4 s | 22.9 s | 1.79 MB | 3.40 MB, 14 |
| 10k / 49,980 | 63.8 s | 70 s | 1,212 MiB | 3.6 + 3.3 s | 56.1 s | 3.56 MB | 6.80 MB, 27 |
| 20k / 99,980 | 143 s | 163 s | 1,697 MiB | 10.6 + 7.5 s | 123 s | 7.20 MB | 13.9 MB, 54 of 64 |

- 20k: first analysis 10.6 s (program 6.1, semantic check 2.5, import walk 1.6); the second analysis builds a second
  program from scratch (7.5 s); body assembly + decode check + writes 1.0 s.
- **~86% of the time is three full sandbox read passes**: the capture's read (71 s, faster than linear 10k→20k) and two
  verifications (29 s, 24 s).
- Module snapshot 2.76 MB at 20k. `listFiles`/`neighbors`/`impact` load all chunks each call: 265 ms per call at 54 chunks.
- `maxQueryResults` set to 200,000 at run time (the probe's 50,000 would cut the 20k run).

## Real code (the important calibration)

- 1× target (`../target`, 2,196 files): 1,099 program files, 12,181 imports, ~20 MB TS → 46.8 s, peak 2.14 GB; each
  analysis ~9 s (program 2.9, semantic check 5.5).
- 3× src+tests (`scale/r3x`): 3,126 program files, 35,889 imports, 62.5 MB:
  - default Node heap (2,240 MiB on this machine): **out of memory in the first analysis**;
  - `--max-old-space-size=5632`: committed in 65.6 s, peak 4.73 GB (2.45 GB after the first program, 4.49 after the second).
- ~0.65 MB per program file per program; **both TS programs stay in memory until the capture is released.**
- The app passes no heap flag (`package.json`, `scripts/`, `src/app` grepped).

## File layer encoding at 20k / 100k edges (p = 49.5 B)

- Today 13.9 MB = 54 of 64 chunks: node `{"path","nonBlankLines","language"}` p+54 B (2.07 MB); edge `{"from","to"}`
  2p+20 ≈ 118 B (11.8 MB). Fits only while p ≤ ~60 B; at this repo's 68.8 B → ~70 chunks, rejected.
- Edges as index pairs `[i,j]` ≈ 12.9 B → 1.29 MB (object form `{"from":i,"to":j}` 24.9 B → 2.49 MB).
- Rich nodes (path, 64-hex digest, sizeBytes, language, nonBlankLines) ≈ p+146 B → 3.91 MB (4.30 at p=68.8); an indexed
  flag +15 B/node.
- **Rich nodes + pair edges ≈ 5.2 MB ≈ 20–22 chunks**, room left for 8D's edges.

## Is 100,000 imports practical?

- Small files: yes (2:43, 1.7 GB). Real code: no — the import walk is cheap (1.6 s at 100k); the cost is the source in
  each TS program, and the capture builds two and keeps both. At this repo's ~11.5 imports/file, 100k imports ≈ 8,700
  files ≈ 11 GB with two programs.
- Practical caps today: default heap ≈ 12–15k imports; raised heap + 6G scope ≈ 35–40k (measured 35,889 at 4.7 GB).
- 100k within 6 GB only with **one program** (the file layer reusing the capture's analysis; ≈ halves time and memory,
  ~7–8k real files, estimated) plus a raised heap.
- **The import count is a weak proxy**; a bound on program file count or TS source size (≈ 3,000 files / 60 MB with two
  programs) tracks the real cost.

## Side finding (a correctness issue)

On a 2,000-file target **with import cycles** (`c2000`), the second analysis hit "Maximum call stack size exceeded"
inside TypeScript (`parseSourceFileWorker`). **The capture still committed, with 0 file edges and an empty module
layer** — a failure recorded as an empty success.

## Lead reading (for the 8A-scale follow-up; to settle in the post-note)

1. One TS program per capture (the file layer reuses the capture's analysis) and release it after the analysis.
2. The analysis cap by program file count / TS source bytes (not imports); over the cap → a reported coverage state, not
   an out-of-memory crash. The numbers come from these measurements.
3. An analysis that throws (stack overflow, OOM guard) must surface as a failed/unknown analysis in coverage, never an
   empty committed layer — check what 8A's spec says (§9, L12 coverage) and whether this is a bug in 8A's merged code.
4. Edges as index pairs + rich nodes (≈ 20–22 chunks at 20k).
5. Read passes: three full sandbox reads dominate; whether the two verifications can use digests is a design question,
   not for this follow-up unless the spec already allows it.
6. Reads load every chunk per call (265 ms at 54 chunks) — note as a known limit.
