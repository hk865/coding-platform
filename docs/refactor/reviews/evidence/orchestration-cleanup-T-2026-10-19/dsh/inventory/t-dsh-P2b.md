# Task: T-round inventory, area P2b (read-only; Chinese report)

You are in a copy of the repository. NEW session, headless: when your turn ends, the run ends. **Finish within 110 minutes** (the run stops at 120); when time runs short, finish the file you are on, write the report with what you have, and list the files not yet read.

Coordinator mode (`./.dsh-ref/coordinator-mode.md`): split your area into up to three parts for subagents; each subagent writes its rows into `./.dsh-scratch/P2b-partN.md`; you merge, check a sample of their evidence yourself, and remove duplicates. **Do not end your turn while a subagent has not reported back** (wait with `sleep 300`, then check). Nobody runs tests, builds or type checks.

Instructions: `./.dsh-ref/t-common.md` (binding). Your area **P2b**: described in `./.dsh-ref/t-area-P2b.txt`.

Write the report to `./t-P2b.md` (table, JSON block, totals, coverage note). Reply in under 120 words: the path, the counts per category, and what you could not finish.
