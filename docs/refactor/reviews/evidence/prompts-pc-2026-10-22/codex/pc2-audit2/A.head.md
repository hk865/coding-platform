# PC-2 audit 2, part A: pack resolution and validation (rework 1)

Your part is `A`: `./.lead-ref/parts/A.diff` and `A-files.txt` (`src/contracts/prompts/**`,
`tests/contracts/PC-prompt-set-v1`, `PC2-resolve-pack`). Rows A-01 … A-13 of the frozen table (A-09 same as Q-10, A-10
rejected).

**Look hardest at:** A-01 (every independently decidable problem collected; the renderer still throws one
`PromptRenderError` when it must throw — which one, and is that stable?); A-02 (only `''` rejected; a whitespace
description kept byte for byte); A-03 (the branch deleted and nothing else); A-04…A-08, A-11 (each new case's
expected value a literal; check each named mutation by reading); A-12 comments.
