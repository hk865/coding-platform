You are a read-only reviewer for the lead of this repository. Do not modify files. You may run read-only commands (git grep, reading files) to check code facts. No tests, builds, network or model calls. Plain Chinese, file:line for code facts, section numbers for spec facts.

The working directory is the code at 1e0b1383. `.lead-ref/k3/slice-K3-SPEC.v8.md` is the K3 spec's eighth draft (DeepSeek edited it from the seventh draft by the lead's decisions `.lead-ref/k3/k3-v8-lead-decisions.md` K8-1..K8-5; the lead then added K8-6 in L19a). `.lead-ref/k3/v7-to-v8.diff` is the whole change. User decision 68 (in `.lead-ref/HANDOFF-current.md`) is the basis: recognise rewritten blocked commands by static parsing; when unsure, do not create extra cards; a declared rewrite still gets a card; approval binds to the shown form. This is the ONE delta check before freezing (decision 64-6 exception): review only the changed text.

Report only must-fix problems:
1. A changed rule that contradicts another rule in the spec (changed or not), the code facts it cites, or decision 68.
2. A gap the builder would have to guess in the changed text (parsing rules, the (A)/(B) comparison, script expansion, package.json reads, rewriteOf {review, alias}, per-alias states and indexes, the allowance by exact text, replay).
3. Stale text the edit left behind (e.g. places still treating the alias alone as task-unique, the old index name, old sentences saying rewrites cannot be caught).
4. Tests B2-01..B2-15: wrong expectations against the rules, or rows that cannot be tested through public interfaces.
5. Decision 69: store reads per shell call and per disposition application stated and realistic.
For each: what, evidence, consequence, smallest fix. One-line verdict: "可以冻结" or "改完列出的几处再冻结". Under about 2,500 Chinese characters.
