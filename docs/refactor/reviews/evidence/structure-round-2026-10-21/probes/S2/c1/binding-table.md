# C1 binding table — where every identifier of a moved body comes from

Old = `s85-base` working layout (all four moved bodies lived in
`notes/note-read-model.ts` / `notes/note-service.ts`).
New = after C1 (`note-base-reader.ts` / `note-rendering.ts`).
"same module" means the identifier was/is a local declaration in the module
that holds the moved body.

## A. Identifiers used by each moved body

| Moved body | Identifier used | Old source module | New source module | Same name, different module? |
|---|---|---|---|---|
| `ReadFailureCode` | — (string-literal union) | `note-read-model.ts` (declaration) | `note-base-reader.ts` (declaration) | yes, the declaration moved |
| `ReadOutcome<T>` | `ReadFailureCode` | `note-read-model.ts` (same module) | `note-base-reader.ts` (same module) | no; same body, now `export`ed |
| `readAllRecords` | `RecordLookupPort` | `../../record-store/lookup-ports.js` | `../../record-store/lookup-ports.js` | no |
| `readAllRecords` | `EncodedRecord` | `../../record-store/ports.js` | `../../record-store/ports.js` | no |
| `readAllRecords` | `asOutcome` | `./store-failures.js` | `./store-failures.js` | no |
| `readAllRecords` | `ReadOutcome` | `note-read-model.ts` (same module) | `note-base-reader.ts` (same module) | no; moved with it |
| `readAllHeads` | `RecordLookupPort` | `../../record-store/lookup-ports.js` | `../../record-store/lookup-ports.js` | no |
| `readAllHeads` | `NoteHeadSnapshot` | `../../../contracts/note.js` | `../../../contracts/note.js` | no |
| `readAllHeads` | `ReadFailureCode` | `note-read-model.ts` (same module) | `note-base-reader.ts` (same module) | no; moved with it |
| `readAllHeads` | `readAllRecords` | `note-read-model.ts` (same module) | `note-base-reader.ts` (same module) | no; moved with it |
| `readAllHeads` | `decodeNoteHeadSnapshot` | `../persistence/note-record-codecs.js` | `../persistence/note-record-codecs.js` | no |
| `renderUnderstandingBody` | — (`sections` is a parameter; only its five fields are read) | `note-service.ts` (declaration) | `note-rendering.ts` (declaration) | yes, the declaration moved |

No moved body gained a new external dependency. The only visibility change is
`ReadOutcome`: it was a private `type` in `note-read-model.ts` and is now
`export type` in `note-base-reader.ts`, so the read model can keep using it.

## B. Same-named imports that now come from a different module (consumers)

| Consumer | Identifier | Old import module | New import module |
|---|---|---|---|
| `note-read-model.ts` | `readAllHeads`, `readAllRecords`, `ReadFailureCode` | local declaration (re-exported old surface) | `./note-base-reader.js` (re-exported old surface kept) |
| `note-read-model.ts` | `ReadOutcome` | local declaration | `./note-base-reader.js` |
| `note-read-model.ts` | `renderUnderstandingBody` | `./note-service.js` | `./note-rendering.js` |
| `note-service.ts` | `readAllHeads`, `ReadFailureCode` | `./note-read-model.js` | `./note-base-reader.js` |
| `note-service.ts` | `mapStoreFailure` | `./note-read-model.js` | `./store-failures.js` |
| `note-service.ts` | `renderUnderstandingBody` | local declaration | `./note-rendering.js` (also re-exported) |
| `scribe-scope.ts` | `readAllHeads`, `readAllRecords`, `ReadFailureCode` | `./note-read-model.js` | `./note-base-reader.js` |
| `scribe-scope.ts` | `mapStoreFailure` | `./note-read-model.js` | `./store-failures.js` |
| `note-decision-source.ts` | `readAllHeads` | `./note-read-model.js` | `./note-base-reader.js` |
| `note-scribe-todos.ts` | `readAllHeads` | `./note-read-model.js` | `./note-base-reader.js` |

`MappedReadCode` in `store-failures.ts` is the same failure-code union under a
different name; no moved body or consumer imports it.
