# CM-1B-001 source adaptations

`../memory-values.ts` adapts Hermes MemoryStore's unique-match correction and working-copy batch/final-capacity approach from `tools/memory_tool.py` at commit `53c57871d67ee7d2202861aacc4ea0ef6ef93112`. This implementation uses typed identities, canonical compare-and-swap, versioned tombstones and atomic Ledger receipts instead of the upstream file store. Matching two identity-bearing entries is ambiguous even if their text is identical. The corresponding MIT license is in `Hermes-MIT.txt`.

`../../data/context-compiler/memory-context.ts` adapts the refresh-before-reuse and bounded-cache approach of OpenClaw's bootstrap cache at commit `9e267031cd9d73aea91332f9245570ddd5bebef0`. It reloads both canonical scopes and checks applicability before reusing a selection; the identity includes source references and revisions as well as content. The corresponding MIT license is in `OpenClaw-MIT.txt`.

Pinned source files, origin URLs and digests are retained under `evidence/collaboration-memory/CM-1B-001/preparation/upstream-files.json` and `preparation/upstream/`. These adaptations provide neither a second memory store nor automatic inference or tool permissions.
