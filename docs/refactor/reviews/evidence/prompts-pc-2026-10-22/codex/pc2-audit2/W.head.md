# PC-2 audit 2, part W: the tool-factory tests (rework 1)

Your part is `W`: `./.lead-ref/parts/W.diff` and `W-files.txt` (the ten `tests/runtime/PC2-W-*`). Rows W-01, W-02.

**Look hardest at:** W-01 — each default case now compares against a hand-written JSON literal of the complete
specification. W's production code did not change in rework 1, and your audit 1 established that the default specs at
`af84802` equal `pc1-final`'s. So compare the literals **by reading** with the schemas and texts in
`src/core/agent-runtime/*-tools.ts` and `src/contracts/prompts/platform-pack.generated.ts`, field by field and in key
order, and report any literal that does not match what the factory produces (a mismatch means the test is wrong or not
run). Are the literals hand-written rather than built at test time (no production import used to build them)? W-02:
the six missing-tool cases now assert whole literal specs.
