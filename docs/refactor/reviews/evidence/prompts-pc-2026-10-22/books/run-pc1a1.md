# PC-1, run PC-1a-1: step c1 only (lead, 2026-10-22, morning)

You are run **PC-1a-1**, a short morning run of about 20 minutes. k1 is done (commit `fdfc302`). Do **only step c1** of
the book `./.dsh-ref/pc1-book.md`: §3.2 **ruling 11** whole, and from ruling 13 only the new `origins` field of
`ResolvedPromptPackV1` (`src/contracts/prompts/prompt-pack.ts` ~22; book ~270–278). Nothing else. A new Session,
headless: **when your turn ends, the whole run ends.** Do it yourself; no subagent is needed.

## c1 (TDD: the pinned-digest test first, red, then the files)

1. New `tests/contracts/PC-platform-pack-v2.test.ts`: through the generated pack's public export, the six templates
   (`base` and the five Skills) exist with version 1, `mentionsTools: []`, empty slot tables, and their sha256 equal the
   six literals of ruling 11; `origins` gives `{ packId: "platform", version }` for every template. Run it: red.
2. Add `templates/base.txt` and `templates/skill-platform-<role>.txt` under `resources/prompts/platform/`, copied byte
   for byte as ruling 11 says (`base` from `CODING_AGENT_SYSTEM_PROMPT`, no trailing newline added; the Skills from the
   committed `resources/skills/platform-<role>/content.md`, final newline kept). Compare the bytes after copying.
3. `pack.json` lists the six; `slot-tables.ts` gives them empty tables.
4. `scripts/build-platform-prompts.mjs` also emits `origins`; `ResolvedPromptPackV1` gains
   `origins: Readonly<Record<string, { packId: string; version: number }>>`. Regenerate the module with the script.
5. `runtime-assets.json`: the six new files and the changed `pack.json` digest, as the existing entries are made.
   Do **not** delete `resources/skills/platform-*` (PC-1b does).
6. Green: the new test; `node scripts/build-platform-prompts.mjs --check`;
   `flock /home/han001/dsh-work/pc-scratch/tsc.lock npm run typecheck`; `npm run check:architecture`; and
   `npx vitest run --maxWorkers=2 <files>` (at most 10 files per command, under `timeout 900`) on the new test plus
   every existing test that imports `prompt-pack`, `slot-tables` or the generated module (`grep -rlE` in `tests`).
   The typecheck may fail only where an existing file builds a `ResolvedPromptPackV1` by hand: if that file is a test
   or a fixture, stop, undo, and report it; do not edit old tests.
7. Commit only your files:
   `git add -- resources/prompts/platform scripts/build-platform-prompts.mjs src/contracts/prompts runtime-assets.json tests/contracts/PC-platform-pack-v2.test.ts && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "PC-1a C: base and the platform Skills in the pack, origins (ruling 11)"`.
   `git status --porcelain` prints nothing afterwards.

Never edit `tests/helpers/PC-kernel-fixture.ts`. No network. Never run `npm test`, a scale test, or more than two
vitest workers.

## Reply (plain Chinese): `./.dsh-ref/pc1a1-reply.md`

Under 300 words: RED → GREEN with the test name; the byte comparison; the six digests you got; the checks with numbers;
the commit id; anything unexpected. If the runner stops you before the commit, undo every change (`git checkout -- .`,
then delete the new files you created) and say how far you got.
