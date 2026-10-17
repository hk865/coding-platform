# Verify: Codex's implementation review of slice 8D (Claude subagent, read-only on the product)

You verify a code review for the lead. Be adversarial: try to REFUTE each finding; confirm only what the code shows.
Reply in English, under 1,500 words, to the lead (not the user).

## Material

- Windows copy (read-only, the 8D build): `D:/cxt/s8d-review` (no `.git`). Production diff `.lead-ref/s8d-prod.diff`,
  all changed files `.lead-ref/s8d-stat.txt`, the book `.lead-ref/s8d-impl.md` (section 2 scope; its last section = the
  lead's binding answers), the DSH reply `.lead-ref/s8d-final-1.md`, code facts `.lead-ref/s8d-facts.md`.
- Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md` (L12, L13 from line 150; §2
  `LanguageCoverageV1`; §9).
- The review to verify: `D:/cc-lead-notes/codex2/s8d-review.out.md` (Chinese; 6 "必须改" + 1 "建议").
- If you need to run something (a probe, one test file): WSL, in **your own copy** — `git clone -q
  ~/dsh-work/slices/s8d ~/dsh-work/verify-s8d && cd ~/dsh-work/verify-s8d && git checkout -q s8d-1 && cp -al
  ~/dsh-work/slices/s8d/node_modules . && cp -al ~/dsh-work/slices/s8d/vendor/coding-agent/node_modules
  vendor/coding-agent/` (use `MSYS_NO_PATHCONV=1 wsl.exe -e bash -lc '...'`; node is at
  `~/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin`). Run inside `systemd-run --user --scope -q
  -p MemoryMax=4G`, vitest `--maxWorkers=2`, and only while `free -m` "available" is above 2,000 MB. Never touch
  `~/dsh-work/slices/s8d` itself, ports 3080/3099/44797, or any other running scope; no git writes outside your copy;
  no real model calls. Delete `~/dsh-work/verify-s8d` at the end (it is yours).

## For each of the 7 items

1. **Verdict:** holds / partly holds / does not hold — with file:line evidence from the 8D copy.
2. **Is it in 8D's scope?** (the book's section 2 and the answers; the spec L13). Flag anything that only matters to the
   later observation-scale fix (`D:/cc-lead-notes/specs/s8-scale-section-10.md`), so the lead can route it there.
3. **The fix:** is Codex's 修改思路 the smallest correct one? If you see a smaller or cleaner one, give it.
4. **Test:** the RED test that would prove it through a public entry (no database reads, no hand-written records;
   fault injection is fine), with the literal expectation.

Item-specific questions:
- Item 1: does the frozen material really drop a skipped config file so the provider falls back? Is "the chosen config
  failed to read → the language fails" what L13 / the answers already require?
- Item 2: did 8D change `symbols` (and other non-`imports` operations) of `cpp-source-query.py`, i.e. is there a
  behaviour change outside imports that existing callers (exploration tools) see?
- Item 3: confirm the script is spawned without the directory; what does the injected-missing-directory test prove?
- Item 4: how many entries can the cache hold in one tool group, and what holds a whole material? Is the
  `engineDigest`/`adapterDigest` staleness reachable in production (does anything replace the analyzer at run time)?
- Item 5: does the capture's language claim (lowercased extension) and the indexes' case-sensitive filters really
  disagree for `API.H` / `e.PY`? What do 8A's TS provider and L12's extension list do with upper case?
- Item 6: which process errors reach the provider, and how are they mapped today?
- Item 7: worth doing now (decision 69 cost) or note only?

End with a one-line summary: how many hold, which go into 8D's rework, which belong to the scale fix.
