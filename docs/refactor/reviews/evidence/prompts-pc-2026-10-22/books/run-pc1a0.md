# PC-1, run PC-1a-0: step k1 only (lead, 2026-10-22, morning)

You are run **PC-1a-0**, a short morning run of about 20 minutes. Do **only step k1** of the book
`./.dsh-ref/pc1-book.md` (§3.1 ruling 1, its first two bullets). Nothing else from the book. A new Session, headless:
**when your turn ends, the whole run ends.** Do it yourself; no subagent is needed.

## k1

1. Restore `core/context/selection_policy/context-selection-policy.ts` into `vendor/coding-agent/patches/` from the
   frozen source map: `vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js.map`,
   `sourcesContent[0]`, byte for byte. Codex checked it: 225 lines, sha256 starting `291c3188` and ending `c527d`; the
   `.d.ts.map` holds the same text. Report the sha256 you got.
2. Add it to `relativeSources` in `scripts/build-kernel-patch.mjs` (~13), the way the other managed files are listed.
   Look at how the other managed files were restored and added (`git log -- vendor/coding-agent/patches`), and do it
   the same way.
3. `node scripts/build-kernel-patch.mjs --check` passes with the restored text unchanged. If `--check` reports a
   difference in `dist`, do **not** run `--write` and do not change `dist`: stop and report the exact output.
4. Commit only these files:
   `git add -- vendor/coding-agent/patches scripts/build-kernel-patch.mjs && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "PC-1a K: restore the managed context-selection-policy source (ruling 1)"`.
5. `git status --porcelain` prints nothing; `git diff --name-only pc1a-base HEAD` lists only those files.

No typecheck, no build, no tests: this step changes no behaviour and `--check` is the proof. Never edit
`tests/helpers/PC-kernel-fixture.ts`. No network.

## Reply (plain Chinese): `./.dsh-ref/pc1a0-reply.md`

Under 200 words: what you did, the sha256 and line count, the `--check` output, the commit id, anything unexpected.
If the runner stops you before the commit, undo every change (`git checkout -- .`, then delete the one new file under `vendor/coding-agent/patches/` you created)
and say how far you got.
