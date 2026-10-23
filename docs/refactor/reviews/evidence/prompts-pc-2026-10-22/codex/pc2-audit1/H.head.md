# PC-2 audit, part H: packs on disk, the editing routes and the settings model (rulings 1–3, 6–8)

Your part is `H`: `./.lead-ref/parts/H.diff` and `H-files.txt`: `src/app/host-settings-types.ts`, `host-settings.ts`,
`host.ts`, the new `prompt-packs.ts` (and `server.ts`, `runtime-configuration.ts` if changed),
`src/composition/create-platform.ts` (the disk pack source), H's tests (`tests/app/PC2-H-*`) and the old tests
`tests/app/S2B-backfill-host`, `S2B-35-activity-routes`, `tests/helpers/S2B-r2-backfill-kernel-support.ts`. The book
§3.1 rulings 1, 2, 3, 6, §3.2 rulings 7, 8, §4 (H's row), §5.1 (the Host fixture), §5.2 PC-04, PC-05, PC-22 (save),
PC-23, PC-25 (routes), §5.3 (the S2B lines).

**Look hardest at:**

- **Ruling 2, the directory checks.** Real paths compared by path segments (`path.relative` neither `..`-prefixed nor
  absolute), never by string prefix, never through `canonicalExisting`. At start: `prompts/` created and its real path
  taken; each configured root and, after the settings file is parsed, each restored root compared; equal or
  containing → the Host fails to start naming both. On opening a workspace: after its realpath and directory check,
  **before** the existing-root shortcut and any registration; a root equal to or containing the prompts directory →
  `invalid`. Each pack's and each parent's real directory inside the real `prompts/`. **Reply §8.3:** "a configured
  root that does not exist skips the overlap check" — trace what the Host does with such a root (does
  `validateWorkspaces` already reject it, or can it be created later and then cover `prompts/`?). "The save target's
  parent must be inside the pack and inside prompts" is stricter than the book: harmless?
- **Ruling 3, reading.** Asynchronous at every preparation, no cache across preparations; every manifest file a
  relative path without a `..` **segment** (but `..name` legal), not absolute, real path inside the pack's real path;
  `platform` from the generated module. The Host's port wiring replaces PC-1's platform-only source: reply §8.3 says
  the Host builds the disk source and passes it as `TargetPlatformOptions.promptPacks`. Is there any production path
  (another `createPlatform` caller, a Host without a settings directory) that silently ends with the platform-only
  source when a settings directory exists? A Host without a settings directory: platform only, and no editing routes.
- **Ruling 6, the routes.** The six route names, DTO shapes, codes (`not_found`, `invalid` with `problems`,
  `forbidden`, `revision_conflict`, `unsupported` without a settings port). `list` ready with a broken pack, its
  problems kept, an unreadable manifest → `templates: []`, `platform` first then by id (reply §8.3: "a broken pack's
  list shows the readable chain declarations" — is that what the book says?). `create`. **Save in order:** `platform`
  forbidden first; version (or tool digest) against the **effective** entry (inherited → the parent's); whole-pack
  validation after the save, failure leaves every file unchanged; new file `templates/<id>@<v>.txt` or
  `tools/<name>@<16 hex>.json`; `pack.json` replaced atomically (temp and rename); old version files stay; saves
  serialized like settings saves. A crash between the new file and the rename leaves the visible version as it was.
  The tool digest is ruling 19's canonical body (A's function, not a second copy).
- **Ruling 7 and 8.** `promptPack` / `reasoningReplay` in the public type, the save DTO, the stored model, parse,
  initial and save; save checks syntax only; the read projection shows a field only when set; **a save without the
  field clears it**; the startup catalog never restores a pack or policy over a later save (a restart after such a
  save still resolves the defaults). `settingsModelBinding` passes both into the trusted model configuration.
- **Access.** The routes sit in the settings branch with the settings gate (token and same origin); no new principal.
- **The S2B tests:** only the settings directory separated from the workspace; no backfill assertion loosened.
- **Tests:** PC-23's cases (inside a configured root, inside a restored root, equal path, symlink out of `prompts/`,
  an ancestor opened → `invalid`, an unrelated directory opens); PC-04 (7 → 8, files byte-equal after an `invalid`
  save, each code); PC-25's routes (digest hand-computed from the literal canonical body, the new file name). Are the
  expected digests and bytes literals? Name a mutation each would miss (e.g. string-prefix comparison, check after the
  existing-root shortcut, a non-atomic write, a cache across preparations).
