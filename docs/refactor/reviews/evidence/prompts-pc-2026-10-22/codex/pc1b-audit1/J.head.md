# PC-1b audit, part J: the joint step and the allowlist (rows PC-06…PC-10, PC-15's platform case)

Your part is `J`: `./.lead-ref/parts/J.diff` and `J-files.txt`: `tests/architecture/production-reach-allowlist.json`
and the new `tests/runtime/PC-joint-*.test.ts`. You may read the whole tree to judge them. The book §4 (J's row and the
last paragraph), §5.1 (the platform fixture), §5.2 (PC-06…PC-10, PC-15).

**Look hardest at:**

- **Each joint row against §5.2, line by line.**
  - PC-06: after preparation, the injected pack (`base` text and a string label) and the custom Skill file change; the
    model still receives the prepared system and input, Work and Query; the entry's brief and review checks still
    pass; the set's digests equal `sha256` of literal texts.
  - PC-07: a formal pause, the pack and Skill file changed, resume; the system received is byte-equal to the first.
  - PC-08: a Host returning a binding with another `promptPack` on its second resolution → Work start `forbidden`,
    model called zero times; through the real Host registry, a new binding installed after preparation leaves the
    execution on the old one.
  - PC-09: Work and Query, each a tool call then a final answer; `readPromptRecord` read afresh: two requests in
    `sequence` order, both digests, the removal counts, the cap; the same `toolSpecsRef` twice; `sha256` of each text
    equals its digest; the system rebuilt by hand from the returned base and Skill texts, the sections written
    literally as `context-builder.js` ~20 writes them, has the recorded `systemDigest`; the captured Work authorization
    and Query reservation replayed with one changed fact → `idempotency_conflict`.
  - PC-10: the body store fails only `PROMPT_TOOL_SPECS_CONTENT_TYPE`; Work and Query fail `unavailable`, model called
    zero times; preparation had succeeded.
  For each: is every expected value a literal or hand-computed? Does the test go through the public steps and the
  frozen fixture only? Name a mutation of the production code that the row would miss.
- **PC-15's platform case is missing** (reply §8). Say what it would take within §5.1's fixture, and whether the
  missing row hides an untested rule of rulings 20–21 that no other test covers.
- **The allowlist.** DSH removed all 13 PC-1b `kept-for` entries PC-1a added and added 18 `wire-format` entries (reply
  §7): 9 for types and optional port members the reach walker cannot follow, 4 for `readPromptRecord`'s helpers
  (`messageOf`, `rejected`, `sameQueryRunRef`, `readQueryPromptSet`), `completeRunRef`, and 4 compatibility constants
  still referenced by old contract tests plus `INITIAL_COORDINATION_RESPONSE_GUIDE`. Read the allowlist's own rules
  (the test under `tests/architecture/` that reads it, and the existing entries' categories and note forms). For each
  new entry: is the category right, is the declaration really used by production, and should it be exported at all?
  An export that exists only for an allowlist entry, or a helper exported only to be listed, is a finding. Is any
  production export left unreached and unlisted?
