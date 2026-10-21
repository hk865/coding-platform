# S3 brief-k3 handoff (rows 10–21)

Moved the fixed texts of `continuation-brief.ts` (rows 10–18) and
`core/prepared-execution.ts` (rows 19–21) into the platform pack: 294 string
keys (`brief.*`, `k3.*`) and three templates.

## Files

- `strings.json` — 294 flat `key: text` entries.
- `templates/continuation-brief.txt` — title, marker slot, optional
  body/blockedOmission/bodyOmission/anomalies/review/blocked parts, fixed tail.
- `templates/unknown-call-review.txt` — header, workspace/written headings, item
  block, two questions.
- `templates/unknown-call-proposal.txt` — header, workspace/written headings,
  proposal guide, optional target/person/annotation/platform parts.
- `MANIFEST.json` — base file:line per key and template.

Templates end at their last rendered byte (no trailing LF) and use no block
markers: optional slots are plain `{{slot}}` tokens, empty values render nothing.

## One source for the fixed tail

The **template is the source**. The closing block lives after the template's last
blank line; `CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1` is sliced from it at module
load, and `## 接续说明` is the template's first line. The array keeps its shape
and still enters the budget as `['', ...array]`; there is no second copy.

## Layout notes

- Brief: a non-empty slot value carries the leading LF the old join supplied.
  `bodyOmission`/`blockedOmission` share the pre-anomaly position and never
  co-occur; in the blocked-first phase the removal note stays inside `blocked`
  (after the section, before the tail) — the frozen table has no post-block slot.
- K3: `workspaceLines`/`writtenLines` are content lines without headings;
  `items` is the item block; proposal parts carry their leading LF.

## UNSPECIFIED

- Slot tables and the generated pack are the owner's; plain optional slots are
  assumed to render nothing when empty (confirmed by `render-template.ts`).
- The `bodyOmission` vs `blockedOmission` assignment above is internal; bytes match.
