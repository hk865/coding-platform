# S3 rest consumer handoff (book rows 5, 9, 22, 23, 27, 29, 45, 46)

Moved the fixed texts of eight consumer files byte-for-byte. Code keeps
interpolation, loops, sorting, thresholds, enum-to-text choice, the parsed
scribe marker lookup, JSON field names and error messages.

## Templates (no trailing newline; no block markers are needed)

- `initial-planning-answer` — no slots; code reads the template directly from
  `PLATFORM_PROMPT_PACK_V1.templates[...]` (no render call).
- `consultation-received-input` — required `messageId` / `sourceJson`
  (`JSON.stringify(sourceRef)` stays in code).
- `user-decision-response` — required `bodyJson` (`canonicalJson` stays in code).
- `scribe-reminder` — required `marker` / `pendingCount` / `updateDueCount`,
  optional bare `anchors`. Empty anchors render nothing, so `锚点：` stays.

## Strings (48 keys, namespaces role/architecture/note/contextExtension/scribe)

- `role.*`: 5 labels + 5 purposes.
- `architecture.*`: 4 kind labels, 4 relative-time strings (`minutesAgo`,
  `hoursAgo`, `daysAgo` have a leading space), uncertainty suffix,
  `observationSuffix`, unobserved line, omission prefix/suffix.
- `note.*`: 8 kind labels, 8 anchor prefixes/suffixes.
- `contextExtension.*`: both decision prefixes (including the fixed `；source=`
  separator), both interruption phrases, and the anchor prefix / run separator /
  suffix.
- `scribe.marker` = `书记提醒：`, read by both the reminder and the recovery
  check (`host.ts:1342` uses the same `SCRIBE_REMINDER_MARKER` constant).

## UNSPECIFIED / decisions

- No key table was published when this consumer started, so these key names
  were defined by the consumer. The pack owner must adopt them literally or
  send replacements before generation; the texts are final.
- Late key added after scope review: `contextExtension.sourceSeparator` =
  `；source=` (base `context-extensions.ts:124`), so the whole named
  `待决定：…；source=…` phrase is in `strings.json`; strings count is 48.
- The architecture time strings and omission suffix deliberately include their
  leading space so the rendered bytes keep the original single spaces.
- Every key listed in `strings.json` is referenced by exactly the files in
  `MANIFEST.json`; no key is unused.

No tests or `tsc` were run (generated module absent).
