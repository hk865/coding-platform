# PC-2 audit, part A: pack resolution and validation, the frozen tool form (rulings 4, 5, 9's checks, 19)

Your part is `A`: `./.lead-ref/parts/A.diff` and `A-files.txt`: `src/contracts/prompts/**` except the generated module
(`prompt-pack.ts`, `prompt-set.ts`, `render-template.ts`, `slot-tables.ts`, the new `resolve-pack.ts`),
`src/contracts/graph-context.ts` (the `sectionOrder` type), and A's tests (`tests/contracts/PC2-resolve-pack`,
`PC2-tool-blocks`, the old `PC-prompt-set-v1`). The book §3.1 rulings 4 and 5, §3.3 ruling 9 (the template checks,
illegal order), §3.6 ruling 19 (types, canonical body), §4 (A's row), §5.2 PC-01, PC-02, PC-03 (resolution), PC-22
(load), PC-25 (resolution).

**Look hardest at:**

- **Ruling 4, every check.** Identity (schemaVersion 1, packId equals the entry, `extends` rules, chain once, ends at
  `platform`, no cycle); strings (unknown key, fixed keys of ruling 5, merge child over parent); templates (file,
  positive integer version, `mentionsTools` array; nearest pack; `origins` all three values from the **supplying**
  pack's manifest entry); tools (whole entry from the nearest pack; `toolOrigins`; "has no platform text" for a
  Kernel tool such as `shell`; empty description; non-string parameter; key set differs from the platform entry's);
  the template checks (unknown slot, slot twice, required missing, stray `{{`, input-template section slots top-level,
  none missing, none extra, illegal order). Validation collects every problem and never throws. For each check, name
  the test case that would fail if the check were deleted, or say none does.
- **Reply §8.1:** `renderTemplate` throws `PromptRenderError` for `template_invalid` / `illegal_section_order` but an
  undeclared template or call slot is still a plain `Error` — does any of those reach preparation with a person's pack
  and become `unavailable` instead of `invalid` (ruling 4's last bullet)? The input templates' section sets come from
  the slot table because contracts cannot import `state/context-input` — can the two tables drift, and does a test pin
  them equal? Canonical tool-body order by `localeCompare(…, 'en')` (ruling 19 says the parameters' keys sorted "the
  same way"; check both the `tools` array order and the key order, and the route digest uses the same function); a
  cycle reported as adjacency/missing-parent problems; a blank (whitespace) description rejected — the book says
  "empty"; is rejecting whitespace a change a person would notice, and is it stated?
- **Reply §1.4:** the fixture's `section-extra` pack is rejected by the parser's "undeclared slot" before the
  resolver's "section not in the template" branch. Is that resolver branch reachable by any input? If not, it is dead
  code (**不整洁**) or the parser's message is the one the book wants; say which.
- **Ruling 19 and L2 in `decodePromptSetV1`:** `toolNames` an array of distinct non-empty strings, never sorted;
  `tools` sorted by name, each `{ name, packId, digest, ref }` checked strictly; both inside the manifest digest. Does
  the decoder reject a sorted-but-wrong or duplicate `toolNames`, a `tools` out of order, an extra key?
- **`PromptRenderError`** carries `code`, `templateId`, `slot`; the empty required-slot check (`render-template.ts`
  ~207) uses it.
- **Tests:** PC2-resolve-pack's 50 bad packs — are the expected reasons literals, is each problem's pack and template
  asserted, and is there one case per reason the book lists? PC-01's two tool sets and whole-line marker removal;
  PC-25's resolution cases (`record_note` override, `toolOrigins` for the child alone, `shell`, empty description,
  `list_files.prefix` missing and extra). Name a mutation each would miss.
