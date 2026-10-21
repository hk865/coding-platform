# tools-1 handoff (S3 / D3a)

Moved every final tool `description` and every `.describe(...)` string of `whiteboard-tools.ts`, `note-tool.ts`,
`project-source-tool.ts`, `exploration-tools.ts`, `readonly-command-tool.ts` and `command-rerun-tools.ts` into
`tools/<name>.json` (`{ description, parameters }`). Text is byte-identical to the base values (extracted with the
TypeScript AST, then compared against the real `ToolDefinition`s and `toJSONSchema()` of the base copy: 16 tools,
zero differences). All texts came from `/tmp/s85-scratch/S3/base` (the run sheet's scratch path is not writable).

## Tool table

| Tool | Resource key | Base location |
| --- | --- | --- |
| query_task_graph | tools/query_task_graph.json | whiteboard-tools.ts:434 |
| query_ready_tasks | tools/query_ready_tasks.json | whiteboard-tools.ts:435 |
| propose_future_plan | tools/propose_future_plan.json | whiteboard-tools.ts:436 |
| apply_future_plan | tools/apply_future_plan.json | whiteboard-tools.ts:437 |
| record_note | tools/record_note.json | note-tool.ts:187 |
| project_source | tools/project_source.json | project-source-tool.ts:237 |
| read_source | tools/read_source.json | exploration-tools.ts:167 |
| cpp_index | tools/cpp_index.json | exploration-tools.ts:174 |
| python_index | tools/python_index.json | exploration-tools.ts:175 |
| code_index | tools/code_index.json | exploration-tools.ts:177 |
| source_excerpt | tools/source_excerpt.json | exploration-tools.ts:178 |
| list_files | tools/list_files.json | exploration-tools.ts:179 |
| search | tools/search.json | exploration-tools.ts:186 |
| symbols | tools/symbols.json | exploration-tools.ts:209 |
| run_readonly_command | tools/run_readonly_command.json | readonly-command-tool.ts:354 |
| request_command_rerun | tools/request_command_rerun.json | command-rerun-tools.ts:206 |

Parameter paths in `MANIFEST.json` notes. Only these tools have parameters (four source files): `propose_future_plan`
(`basedOn`, `draft`, `reason`, `expected`), `apply_future_plan` (`proposalRef`, `expectedProposalRevision`,
`expected`, `acknowledgementRef`), `list_files`/`search` (`prefix`), `run_readonly_command`
(`command`, `cwd`, `timeoutMs`), `request_command_rerun` (`command`, `reason`, `rewriteOf`,
`rewriteOf.review`, `rewriteOf.alias`).

## strings.json

`toolSchema.whiteboardPin.ref` and `toolSchema.whiteboardPin.revision`: the shared `versionPinSchema`
(used by `propose_future_plan.expected` and `apply_future_plan.expected`), so they are not in either tool file.
No other strings were needed; the `whiteboard.*` namespace is unused by this handoff.

## UNSPECIFIED

None. Zod chains, defaults, field order, tool generation conditions and every non-description string stay in code.
