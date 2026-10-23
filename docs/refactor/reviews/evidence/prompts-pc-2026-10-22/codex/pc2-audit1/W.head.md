# PC-2 audit, part W: the ten tool factories take tool texts (rulings 20's fallback, 21; PC-24)

Your part is `W`: `./.lead-ref/parts/W.diff` and `W-files.txt`: the ten tool files of ruling 21
(`src/core/agent-runtime/{command-rerun-tools,communication-tools,exploration-tools,graph-tools,note-tool,
project-source-tool,readonly-command-tool,session-discovery-tools,unknown-call-review-tools,whiteboard-tools}.ts`) and
the ten `tests/runtime/PC2-W-*.test.ts`. **The diff is against `pc1-final`, so it includes W's first commit `99e15bc`
(built before the book was frozen, never audited; its reply is `replies/pc2w-reply.md`) and the rework in this run.**
Audit the result as a whole. The book §3.6 rulings 20 (the per-tool fallback) and 21, §5.2 PC-24, the lead's check
rulings 8 and 16 (`books/pc2-chk1-rulings.md`, `pc2-chk2-rulings.md`).

**Look hardest at:**

- **The per-tool fallback** in every factory: `texts?.[name] ?? PLATFORM_PROMPT_PACK_V1.tools[name]!` for each tool
  the factory builds, never a whole-object default; a factory never reads a pack or the disk. List every call site
  (there were ~10 whole-object defaults); one left is a finding.
- **Byte equality.** With no texts, and with `PLATFORM_PROMPT_PACK_V1.tools` passed explicitly, every tool's
  specification (name, description, the JSON schema with every parameter description) is byte-equal to `base/`'s.
  Compare each schema the old code built at import with the new one built inside the factory, field by field,
  including key order inside the schema objects (the request body is serialized; a reordered key changes the bytes
  sent). A difference is **会出错**.
- **Pass-through.** `exploration-tools.ts` hands `texts` to `createProjectSourceTool`; `readonly-command-tool.ts`'s
  `registerReadonlyCommandTool` input gains `texts?` and passes it to `createReadonlyCommandTool`. Any sub-factory or
  wrapper that drops it?
- **Whiteboard parameters:** `propose_future_plan` and `apply_future_plan` each read their own
  `parameters['expected[].ref']` / `['expected[].revision']` from their own entry, never from
  `PLATFORM_PROMPT_PACK_V1.strings` or the other tool's entry (D8). The platform v2 JSON holds them (T's files; read
  `resources/prompts/platform/tools/{propose,apply}_future_plan.json`), and the sent bytes are unchanged.
- **The `!` non-null assertion:** for a name with no platform entry the fallback is `undefined`. Can any factory be
  asked for a name the generated pack lacks? If yes, what happens (a crash at registration?), and should it be a
  typed error? Reply §2 mentions a "typed platform tool-text fallback" (commit `93fbeab`): read what it does.
- **PC-24's coverage:** all 31 tool descriptions and one parameter of each of the eight non-empty `parameters` tables
  (`apply_future_plan`, `list_files`, `propose_future_plan`, `propose_safer_method`, `record_unknown_call_review`,
  `request_command_rerun`, `run_readonly_command`, `search`), each a literal; the deep-equal cases without texts and
  with the platform tools passed explicitly. Count the descriptions the tests actually change and assert; a missing
  one is a finding. Would a test catch a factory that read `texts[name]` for one tool but the platform text for its
  sibling? Would it catch a parameter description still built at import?
