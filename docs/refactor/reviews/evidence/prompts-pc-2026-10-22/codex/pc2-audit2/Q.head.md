# PC-2 audit 2, part Q: F1, F2 and preparation to request (rework 1)

Your part is `Q`: `./.lead-ref/parts/Q.diff` and `Q-files.txt` (`context-history-facts.ts`, `context-types.ts`, the
two recipes, the two preparations, the two executions, `observed-model-run.ts`, `prompt-set-texts.ts`, `runtime.ts`,
`tool-group-assembly.ts`, and Q's tests). **F1, F2** and rows Q-01 … Q-11 (Q-02 rejected, Q-05 same as F1,
Q-06/Q-08/Q-09 same as J rows, Q-07 split).

**Look hardest at:**
- **F1** exactly as §1 says: `takesSessionHistoryOf` the one mode rule, `sessionHistoryDecision` calling it with its
  signature and start use unchanged; the recipes' input `hasCompletedCursor`; `AssembledContextV1.takesSessionHistory`;
  no Kernel read left anywhere in preparation (search every preparation call path); `af84802`'s conversion gone; start
  as in `pc1-final` (reads the real boundary; a frozen `false` forces `current_turn`; an undecodable cursor `invalid`).
- **F2:** one exported known-name set used by both the unknown-name check and the preparation's filter; preparation
  passes the filtered selection and the capability owners; start the real ones, rejection first. Is the exported set
  exactly the names the start can register (builtins, exploration, coordination, extensions)? A name the start can
  register but the set lacks would be dropped at preparation and then make the start `forbidden`: check.
- **Q-01 and DSH reply §1.1:** Query preparation now authorizes the workspace to read `allowsRead('.')`, so
  `tests/runtime/K-readonly-command.test.ts` KB-08 and KB-10 see two `authorize` calls where they counted one. Read
  both tests: is the second read a harmless consequence (DSH proposes `read <= 2` at ~734 and ~1069), or does it change
  what those tests prove (KB-08: a Host read permission that changes during execution → `forbidden`, nothing started)?
  Give the exact change you would rule, or a production alternative that keeps one read. Is preparation's read made
  only when `run_readonly_command` is requested?
- Q-03, Q-04, Q-10, Q-11.
