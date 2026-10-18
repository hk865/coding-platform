You are a read-only reviewer for the lead of this repository. Do not modify files. You may run read-only commands (search, reading files). Do not run tests or builds. Write the report in plain Chinese, with file:line for every code fact.

The working directory is the code after K3 group 4 session B1, reworks 1–3 (no `.git`). Your third quick check: `.lead-ref/k3g4b1-review3.out.md` (item 1 half done; one suggestion). The lead's rework-3 book: `.lead-ref/k3-g4b1-rework-3.md` (items 1–2). The builder's reply: `.lead-ref/k3-g4b1-rework3-final.md` (its UNSPECIFIED). The rework-3 diff: `.lead-ref/rework3.diff`. The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`.

Quick check (decision 75: the bar is finished, clean, readable, correct):
1. Item 1: within one continuous selection driven by the Host driver, can two persistently failing cards still alternate, or is the carried set complete (every failure path, including UR7b, adds to it; it is dropped when the continuous selection ends; a designated task still answers `waiting`)? Does the new test really go through the Host driver's continuous advance (not one step), without fact injection? Is the carried field validated (shape, project) so a caller cannot use it to skip arbitrary cards?
2. Item 2: one helper, both tests use it, no assertion changes.
3. New problems introduced by rework 3.
4. The builder's UNSPECIFIED (field name, empty set omitted, dedup by canonical JSON, foreign-project ref → forbidden, several UR7b failures keep the first text): acceptable, or what to do.

For each problem: what, evidence (file:line), consequence, the fix approach (修改思路), "必须改" or "建议". End with one line: "可以合入" or "先改完列出的几处". Keep it under about 1,200 Chinese characters.
