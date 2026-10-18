/**
 * L19a (B2-11): the ONE pure script-expansion helper used by ② and the
 * `shell` hook.
 *
 * The caller hands in the detailed parse of the ORIGINAL command (`dirs` per
 * action) and a bounded `readFile`; this module recognises the eight runner
 * forms, reads each action's `package.json` at most once (at most `maxFiles`
 * distinct files), parses the script body with the same parser and flattens a
 * second `npm run Y`-like level into the same expansion. Nothing here talks to
 * a clock, crypto or the process; the digest comes from the injected read
 * result and the comparison keys come from the untruncated body.
 */
import { posix } from 'node:path';
import { truncateUtf8 } from '../../../contracts/utf8.js';
import { commandActionKey, parseShellActionsDetailed } from '../state/command-normalization.js';

export type ScriptExpansionBasisV1 =
  | { path: string; digest: string }
  | { status: 'unavailable'; reason: string };

export type ShellScriptExpansionV1 = {
  action: string;
  scriptName: string;
  scriptText: string;
  actions: Array<{ text: string; sha256: string }>;
  basis: ScriptExpansionBasisV1;
};

/** L19a K8-6: the one workspace read bound ② and the hook pass to `readWorkspace`. */
export const BLOCKED_COMMAND_MAX_FILE_BYTES = 262_144;

/** L19a: `scriptText` is display only and is cut to this many UTF-8 bytes. */
const SCRIPT_TEXT_MAX_BYTES = 2_048;

type DetailedAction = { words: string[]; text: string; dirs: string[] | null };
type PackageRead =
  | { status: 'ready'; content: string; digest: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'skipped' };

const comparisonOf = (words: string[]): { text: string; sha256: string } =>
  ({ text: words.join(' '), sha256: commandActionKey(words) });

/** L19a: the directory after applying `cwd` and each static `cd` left to right. */
function joinDirs(cwd: string, dirs: readonly string[]): string {
  let current = cwd.length === 0 ? '.' : cwd;
  for (const dir of dirs) {
    current = dir.startsWith('/') ? posix.normalize(dir) : posix.normalize(posix.join(current, dir));
  }
  return current;
}

/**
 * L19a: the eight runner forms. `npm run X`, `npm run-script X`, the four fixed
 * npm scripts, `pnpm run X`, `yarn run X`. Never bare `pnpm X`/`yarn X`.
 */
function scriptRunnerOf(words: readonly string[]): string | null {
  const [head, second, third] = words;
  if (head === 'npm') {
    if ((second === 'run' || second === 'run-script') && words.length === 3) return third ?? null;
    if ((second === 'test' || second === 'start' || second === 'stop' || second === 'restart')
      && words.length === 2) return second;
    return null;
  }
  if ((head === 'pnpm' || head === 'yarn') && second === 'run' && words.length === 3) return third ?? null;
  return null;
}

function clipUtf8(text: string, maxBytes: number): string {
  return truncateUtf8(text, maxBytes);
}

function scriptOf(content: string, scriptName: string): { text: string } | { invalid: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { invalid: 'package.json is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { invalid: 'package.json is not an object' };
  }
  const scripts = (parsed as Record<string, unknown>)['scripts'];
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return null;
  const body = (scripts as Record<string, unknown>)[scriptName];
  return typeof body === 'string' ? { text: body } : null;
}

/**
 * L19a: expand the recognised runner actions of one parsed command. `actions`
 * holds the ORIGINAL command's actions; `expansions` holds one entry per
 * distinct expanded action text. A static read/parse failure only makes that
 * expansion's basis `unavailable`; it never throws.
 */
export async function expandShellScripts(input: {
  actions: ReadonlyArray<DetailedAction>;
  cwd: string;
  maxFiles: number;
  readFile: (path: string) =>
    Promise<{ content: string; digest: string } | { status: 'unavailable'; reason: string }>;
}): Promise<{
  expansions: ShellScriptExpansionV1[];
  truncated: boolean;
}> {
  const expansions: ShellScriptExpansionV1[] = [];
  // Rework 1 item 3: a script is identified by (directory, script name), never by
  // its action text, so two directories' same-named script each expand.
  const seenScripts = new Set<string>();
  const reads = new Map<string, PackageRead>();
  let readFiles = 0;
  let truncated = false;

  const clipped = (text: string): string => {
    const cut = clipUtf8(text, SCRIPT_TEXT_MAX_BYTES);
    if (cut !== text) truncated = true;
    return cut;
  };

  const readPackage = async (path: string): Promise<PackageRead> => {
    const cached = reads.get(path);
    if (cached !== undefined) return cached;
    if (readFiles >= input.maxFiles) {
      // The existing behavior: an over-budget file is NOT read and the action
      // relying on it is not expanded (no entry); the record is truncated.
      truncated = true;
      return { status: 'skipped' };
    }
    readFiles += 1;
    let result: PackageRead;
    try {
      const read = await input.readFile(path);
      result = 'status' in read ? read : { status: 'ready', content: read.content, digest: read.digest };
    } catch (error) {
      result = { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
    }
    reads.set(path, result);
    return result;
  };

  /** One expansion entry; a read/parse failure is a per-entry `basis: unavailable`. */
  const pushEntry = (
    action: string, scriptName: string, scriptText: string,
    entries: Array<{ text: string; sha256: string }>,
    basis: ScriptExpansionBasisV1,
  ): void => {
    expansions.push({ action, scriptName, scriptText, actions: entries, basis });
  };

  /** Read+parse one script and return its body actions, or the per-entry failure. */
  const scriptBody = async (directory: string, scriptName: string):
  Promise<
    | { ok: true; path: string; digest: string; scriptText: string;
        actions: Array<{ text: string; sha256: string }>;
        nested: Array<{ text: string; words: string[]; dirs: string[] | null }> }
    | { ok: false; basis: ScriptExpansionBasisV1; scriptText: string }
    | { ok: 'no-script' }
  > => {
    const path = posix.join(directory, 'package.json');
    const read = await readPackage(path);
    if (read.status === 'unavailable') {
      return { ok: false, basis: { status: 'unavailable', reason: read.reason }, scriptText: '' };
    }
    if (read.status === 'skipped') return { ok: 'no-script' };
    const script = scriptOf(read.content, scriptName);
    if (script === null) return { ok: 'no-script' };
    if ('invalid' in script) {
      return { ok: false, basis: { status: 'unavailable', reason: script.invalid }, scriptText: '' };
    }
    const scriptText = clipped(script.text);
    const parsed = parseShellActionsDetailed(script.text);
    if (parsed.status !== 'parsed') {
      return { ok: false, basis: { status: 'unavailable',
        reason: `the script body is not statically parseable: ${parsed.reason}` }, scriptText };
    }
    return { ok: true, path, digest: read.digest, scriptText,
      actions: parsed.actions.map(bodyAction => comparisonOf(bodyAction.words)),
      nested: parsed.actions.map(bodyAction => ({ text: bodyAction.text, words: bodyAction.words, dirs: bodyAction.dirs })) };
  };

  for (const action of input.actions) {
    if (action.dirs === null) continue;
    const scriptName = scriptRunnerOf(action.words);
    if (scriptName === null) continue;
    const directory = joinDirs(input.cwd, action.dirs);
    const key = `${directory}\u0000${scriptName}`;
    if (seenScripts.has(key)) continue;
    seenScripts.add(key);
    const outer = await scriptBody(directory, scriptName);
    if (outer.ok === 'no-script') continue;
    if (!outer.ok) {
      pushEntry(action.text, scriptName, outer.scriptText, [], outer.basis);
      continue;
    }
    // The outer entry carries ONLY its own body's actions (`npm run Y` included).
    pushEntry(action.text, scriptName, outer.scriptText, outer.actions,
      { path: outer.path, digest: outer.digest });
    // Level 2: each nested runner is its OWN entry, keyed by its directory and
    // name, with its own basis. Its actions are never folded into the outer one.
    for (const bodyAction of outer.nested) {
      if (bodyAction.dirs === null) continue;
      const nestedName = scriptRunnerOf(bodyAction.words);
      if (nestedName === null) continue;
      const nestedDirectory = joinDirs(directory, bodyAction.dirs);
      const nestedKey = `${nestedDirectory}\u0000${nestedName}`;
      if (seenScripts.has(nestedKey)) continue;
      seenScripts.add(nestedKey);
      const inner = await scriptBody(nestedDirectory, nestedName);
      if (inner.ok === 'no-script') continue;
      if (!inner.ok) {
        pushEntry(bodyAction.text, nestedName, inner.scriptText, [], inner.basis);
        continue;
      }
      pushEntry(bodyAction.text, nestedName, inner.scriptText, inner.actions,
        { path: inner.path, digest: inner.digest });
    }
  }
  return { expansions, truncated };
}
