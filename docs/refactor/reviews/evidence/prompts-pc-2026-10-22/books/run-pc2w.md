# PC-2, run PC-2-W: group W only (lead, 2026-10-22, morning)

You are run **PC-2-W**, a short morning run of about 14 minutes. Do **only group W** of the draft book
`./.dsh-ref/pc2-book.md`: **ruling 21** (in §3.6) and **row PC-24** (§5.2). Nothing else from that book; it is a draft
and its other parts wait for PC-1. A new Session, headless: **when your turn ends, the whole run ends.** Use subagents
if you want, each on its own files.

## The work

- Each of the ten tool files of ruling 21 takes the tool texts as input: the factory input gains
  `texts?: Readonly<Record<string, ToolTextV1>>` (`ToolTextV1` from `src/contracts/prompts/prompt-pack.ts` ~19),
  defaulting to `PLATFORM_PROMPT_PACK_V1.tools`.
- Parameter descriptions that are module-level schema constants today are built inside the factory from the given
  texts. Nothing else changes. With the default texts every tool's specification stays byte-equal to today's.
- Do not touch `tool-group-assembly.ts` or any caller: they keep calling without `texts`.
- **TDD, row PC-24**, in new files `tests/runtime/PC2-W-*.test.ts`: for each file, given texts with one literal
  changed description and one literal changed parameter description, the tool's specification carries both literals
  (red first); without texts and with `PLATFORM_PROMPT_PACK_V1.tools` passed explicitly, the specifications are
  deep-equal. Reach the specifications the way the existing tests of each tool do (`grep -rl` the factory name in
  `tests`).

## Rules

- Change only the ten tool files and new `tests/runtime/PC2-W-*.test.ts` files.
- `tsc` only as `flock ./.dsh-scratch/tsc.lock npm run typecheck`, one at a time. Tests only as
  `npx vitest run --maxWorkers=2 <files>`, at most 10 files per command, under `timeout 900`; at most two test
  commands at once. Never `npm test`, a scale test, or a bare `npx vitest run`.
- Green before commit: typecheck, `npm run check:architecture`, the new tests, and the existing tests of the ten
  files (the importers found with `grep -rlE`). Old tests are not edited.
- Commit what is green, per file group if you like:
  `git add -- src/core/agent-runtime tests/runtime && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "PC-2 W: <what>"`.
  A file not green when the runner stops you: undo it (`git checkout -- <file>`), and say so.

## Reply (plain Chinese): `./.dsh-ref/pc2w-reply.md`

Under 300 words: per file RED → GREEN with the test name; the checks with numbers; the commits; the files not done;
anything in ruling 21 that did not fit the code.
