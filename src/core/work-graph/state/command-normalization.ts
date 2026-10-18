// L19a (spec §2, lines 1134-1139): pure command normalisation and shell parsing.
// state/ is a pure directory: never import `node:crypto` here; the digest
// helper comes from the fingerprint contract.
import { sha256Hex } from '../../../contracts/fingerprint.js';

/** An action found by `parseShellActions`: the words keep their boundaries; `text` is display only. */
export interface ShellAction {
  words: string[];
  text: string;
}

export type ShellActionsResult =
  | { status: 'parsed'; actions: ShellAction[] }
  | { status: 'unparsed'; reason: string };

/**
 * L19a ruling 5: the detailed parse carries, per action, the static `cd <path>`
 * paths before it at the same level (in order), or `null` once a `cd` before it
 * was not static. The public `parseShellActions` returns today's projection.
 */
export interface ShellActionDetailed extends ShellAction {
  dirs: string[] | null;
}

export type ShellActionsDetailedResult =
  | { status: 'parsed'; actions: ShellActionDetailed[] }
  | { status: 'unparsed'; reason: string };

/**
 * L19a: strip leading/trailing whitespace and collapse every run of
 * consecutive whitespace (space, tab, CR, LF) to one space.
 */
export function normalizeCommandText(command: string): string {
  return command.replace(/[ \t\r\n]+/g, ' ').replace(/^ | $/g, '');
}

/** L19a: sha256 of the UTF-8 bytes of the normalised text (lowercase hex). */
export function commandSha256(command: string): string {
  return sha256Hex(normalizeCommandText(command));
}

/**
 * F-088: the ONE action comparison key: sha256 of the JSON-encoded words array.
 * The expansion helper, the recognizer and the ② whole-text fallback all use
 * this function, so the same hand-computed command gets the same key.
 */
export function commandActionKey(words: readonly string[]): string {
  return sha256Hex(JSON.stringify(words));
}

// ------------------------------------------------------------------------ //
// Tokenizer (L19a rule 1: quotes, separators; rules 4-5 use the words)      //
// ------------------------------------------------------------------------ //

interface ParsedWord {
  /** The literal word after quote removal. */
  value: string;
  /** `$(` seen while reading the word (L19a rule 6, executable position only). */
  hasCmdSub: boolean;
  /** A backtick seen while reading the word. */
  hasBacktick: boolean;
}

type Token =
  | { kind: 'word'; word: ParsedWord }
  | { kind: 'redir'; needsTarget: boolean }
  | { kind: 'group'; inner: string; brace: boolean }
  | { kind: 'sep'; sep: 'andor' | 'list' | 'pipeline' | 'background' };

type TokenizeResult =
  | { ok: true; tokens: Token[] }
  | { ok: false; reason: string };

const isBlank = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '\r';

/**
 * L19a rule 1: captures the balanced body of `( … )` or `{ …; }`, skipping
 * quoted spans and nested groups of the same kind.
 */
function captureGroup(input: string, start: number, open: string, close: string): { inner: string; end: number } | null {
  let depth = 0;
  let i = start;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "'") {
      const closeQuote = input.indexOf("'", i + 1);
      if (closeQuote < 0) return null;
      i = closeQuote + 1;
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\') i += 1;
        i += 1;
      }
      if (i >= input.length) return null;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === open) {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return { inner: input.slice(start + 1, i), end: i };
      i += 1;
      continue;
    }
    i += 1;
  }
  return null;
}

/**
 * Reads one word starting at `start`, honouring `'…'`, `"…"` and `\` escapes.
 * Stops at unquoted blanks, separators and redirection operators; `(`/`)` are
 * plain word characters here so `cmd(a)` stays one word and `(` at a token
 * boundary is handled as a group by `tokenize`.
 */
function readWord(input: string, start: number): { word: ParsedWord; end: number } | { error: string } {
  let i = start;
  let value = '';
  let hasCmdSub = false;
  let hasBacktick = false;
  while (i < input.length) {
    const ch = input[i]!;
    if (isBlank(ch) || ch === '\n' || ch === '&' || ch === '|' || ch === ';' || ch === '<' || ch === '>') {
      break;
    }
    if (ch === "'") {
      const close = input.indexOf("'", i + 1);
      if (close < 0) return { error: 'unmatched single quote' };
      value += input.slice(i + 1, close);
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      i += 1;
      let closed = false;
      while (i < input.length) {
        const inner = input[i]!;
        if (inner === '\\' && i + 1 < input.length) {
          const next = input[i + 1]!;
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            value += next;
          } else {
            value += `\\${next}`;
          }
          i += 2;
          continue;
        }
        if (inner === '"') {
          closed = true;
          i += 1;
          break;
        }
        if (inner === '`') hasBacktick = true;
        if (inner === '$' && input[i + 1] === '(') hasCmdSub = true;
        value += inner;
        i += 1;
      }
      if (!closed) return { error: 'unmatched double quote' };
      continue;
    }
    if (ch === '\\') {
      if (i + 1 >= input.length) {
        value += '\\';
        i += 1;
      } else {
        value += input[i + 1]!;
        i += 2;
      }
      continue;
    }
    if (ch === '`') {
      hasBacktick = true;
      const close = input.indexOf('`', i + 1);
      if (close < 0) return { error: 'unmatched backtick' };
      value += input.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    if (ch === '$' && input[i + 1] === '(') {
      hasCmdSub = true;
      value += '$';
      i += 1;
      continue;
    }
    value += ch;
    i += 1;
  }
  return { word: { value, hasCmdSub, hasBacktick }, end: i };
}

function tokenize(input: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (isBlank(ch)) {
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === ';') {
      tokens.push({ kind: 'sep', sep: 'list' });
      i += 1;
      continue;
    }
    if (ch === '&') {
      tokens.push({ kind: 'sep', sep: input[i + 1] === '&' ? 'andor' : 'background' });
      i += input[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (ch === '|') {
      tokens.push({ kind: 'sep', sep: input[i + 1] === '|' ? 'andor' : 'pipeline' });
      i += input[i + 1] === '|' || input[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if ((ch === '<' || ch === '>') && input[i + 1] === '(') {
      return { ok: false, reason: 'process substitution' };
    }
    if (ch === '<' && input[i + 1] === '<') {
      return { ok: false, reason: 'here-doc' };
    }
    if (ch === '<' || ch === '>') {
      i += 1;
      if (ch === '>' && input[i] === '>') i += 1;
      let needsTarget = true;
      if (input[i] === '&') {
        needsTarget = false;
        i += 1;
        while (i < input.length && input[i]! >= '0' && input[i]! <= '9') i += 1;
      }
      tokens.push({ kind: 'redir', needsTarget });
      continue;
    }
    if (ch === '(') {
      const previous = tokens[tokens.length - 1];
      if (previous?.kind === 'word' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(previous.word.value)) {
        return { ok: false, reason: 'function definition' };
      }
      const group = captureGroup(input, i, '(', ')');
      if (!group) return { ok: false, reason: 'unmatched (' };
      tokens.push({ kind: 'group', inner: group.inner, brace: false });
      i = group.end + 1;
      continue;
    }
    if (ch === '{' && (isBlank(input[i + 1] ?? '') || input[i + 1] === '\n' || input[i + 1] === ';')) {
      const group = captureGroup(input, i, '{', '}');
      if (!group) return { ok: false, reason: 'unmatched {' };
      tokens.push({ kind: 'group', inner: group.inner, brace: true });
      i = group.end + 1;
      continue;
    }
    const read = readWord(input, i);
    if ('error' in read) return { ok: false, reason: read.error };
    if (read.end === i) {
      i += 1;
      continue;
    }
    // An all-digit word immediately before a redirection is a file descriptor.
    if (/^[0-9]+$/.test(read.word.value) && (input[read.end] === '>' || input[read.end] === '<')) {
      i = read.end;
      continue;
    }
    tokens.push({ kind: 'word', word: read.word });
    i = read.end;
  }
  return { ok: true, tokens };
}

// ------------------------------------------------------------------------ //
// Parsing (L19a rules 1-6)                                                  //
// ------------------------------------------------------------------------ //

type LevelResult =
  | { ok: true; actions: ShellActionDetailed[]; dirs: string[] | null }
  | { ok: false; reason: string };

const unparsed = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** L19a rule 5: navigation/no-op segments. */
const NAVIGATION = new Set(['cd', 'pushd', 'popd', 'export', 'set', 'unset', 'true', 'false', ':']);
/** L19a rule 5: output-only segments. */
const OUTPUT = new Set(['echo', 'printf']);
/** L19a rule 5: the fixed allow-list of read-only view commands. */
const VIEW = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'which', 'test', '[', 'grep', 'rg']);
/** L19a rule 5: the read-only git subcommands. */
const GIT_VIEW = new Set(['status', 'diff', 'log', 'show']);
/** L19a rule 3: prefixes stripped only to align the comparison key. */
const STRIPPED_PREFIXES = new Set(['command', 'exec', 'time', 'nohup', 'nice']);
/** L19a rule 3: npx flags that precede the program. */
const NPX_FLAGS = new Set(['-y', '--yes', '--no-install']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const NODE_BIN = /^(?:\.\/)?node_modules\/\.bin\//;

const isStaticAssignment = (word: ParsedWord): boolean =>
  ASSIGNMENT.test(word.value) && !word.value.includes('$') && !word.value.includes('`');

/** L19a rule 3: strip leading env assignments and the fixed prefix list. */
function stripPrefixes(words: ParsedWord[]): ParsedWord[] {
  const out = words.slice();
  let changed = true;
  while (changed && out.length > 0) {
    changed = false;
    const head = out[0]!;
    if (isStaticAssignment(head)) {
      out.shift();
      changed = true;
      continue;
    }
    if (head.value === 'env') {
      out.shift();
      while (out.length > 0 && isStaticAssignment(out[0]!)) out.shift();
      changed = true;
      continue;
    }
    if (STRIPPED_PREFIXES.has(head.value)) {
      out.shift();
      changed = true;
      continue;
    }
    if (head.value === 'npx') {
      out.shift();
      while (out.length > 0 && NPX_FLAGS.has(out[0]!.value)) out.shift();
      changed = true;
      continue;
    }
    if (head.value === 'npm' && out[1]?.value === 'exec' && out[2]?.value === '--') {
      out.splice(0, 3);
      changed = true;
      continue;
    }
    if ((head.value === 'pnpm' || head.value === 'yarn') && out[1]?.value === 'exec') {
      out.splice(0, 2);
      changed = true;
      continue;
    }
    const nodeBin = NODE_BIN.exec(head.value);
    if (nodeBin) {
      out[0] = { ...head, value: head.value.slice(nodeBin[0].length) };
      changed = true;
      continue;
    }
  }
  return out;
}

/** L19a rule 2: shells whose `-c` string is recursively parsed. */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
/** L19a rule 2: the accepted shell flags. */
const SHELL_FLAGS = new Set(['-c', '-lc', '-ic']);
/** L19a rule 2 / rule 6: recursion is allowed up to 3 levels deep. */
const MAX_SHELL_DEPTH = 3;

/** L19a rule 5: segments that are not actions at all. */
function isIrrelevant(words: ParsedWord[]): boolean {
  const exe = words[0]!.value;
  if (NAVIGATION.has(exe) || OUTPUT.has(exe) || VIEW.has(exe)) return true;
  if (exe === 'git' && GIT_VIEW.has(words[1]?.value ?? '')) return true;
  if (exe === 'find') return !words.some((word) => word.value === '-exec' || word.value === '-delete');
  return false;
}

/**
 * L19a ruling 5: the directory state after this segment. `cd <static>` appends
 * its path; `cd`, `cd -`, a non-static argument, `pushd` and `popd` make every
 * later action at this level unexpandable (`null`). Any other segment leaves
 * the state unchanged.
 */
function dirsAfterSegment(words: ParsedWord[], dirs: string[] | null): string[] | null {
  const exe = words[0]?.value;
  if (exe === 'pushd' || exe === 'popd') return null;
  if (exe !== 'cd') return dirs;
  if (dirs === null) return null;
  const arg = words[1];
  if (words.length !== 2 || arg === undefined || arg.value === '-') return null;
  if (arg.value.includes('$') || arg.value.includes('`') || arg.value.includes('~')) return null;
  return [...dirs, arg.value];
}

/** L19a rule 6: executables the parser refuses to attribute to an action. */
const UNSUPPORTED_EXECUTABLES = new Set(['eval', 'source', '.', 'alias', 'function']);
const FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_]*\(\)$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Turns one segment's words into zero or more actions plus the next directory state. */
function processSegment(words: ParsedWord[], depth: number, dirs: string[] | null): LevelResult {
  const significant = stripPrefixes(words);
  if (significant.length === 0) return { ok: true, actions: [], dirs };
  const exe = significant[0]!;
  if (exe.hasCmdSub || exe.hasBacktick) {
    return unparsed('command substitution in executable position');
  }
  if (UNSUPPORTED_EXECUTABLES.has(exe.value)) return unparsed(`unsupported executable: ${exe.value}`);
  if (FUNCTION_NAME.test(exe.value)) return unparsed('function definition');
  if (IDENTIFIER.test(exe.value) && significant[1]?.value === '()') return unparsed('function definition');
  if (SHELLS.has(exe.value)) {
    const flagIndex = significant.findIndex((word, index) => index > 0 && SHELL_FLAGS.has(word.value));
    const script = flagIndex >= 0 ? significant[flagIndex + 1] : undefined;
    if (script !== undefined && !script.value.includes('$') && !script.value.includes('`')) {
      if (depth >= MAX_SHELL_DEPTH) return unparsed('shell nesting exceeds 3 levels');
      // A child shell inherits the outer dirs; its own cds never change them.
      const inner = parseLevel(script.value, depth + 1, dirs);
      if (!inner.ok) return inner;
      return { ok: true, actions: inner.actions, dirs };
    }
  }
  const nextDirs = dirsAfterSegment(significant, dirs);
  if (isIrrelevant(significant)) return { ok: true, actions: [], dirs: nextDirs };
  const rendered = significant.map((word) => word.value);
  return { ok: true, actions: [{ words: rendered, text: rendered.join(' '), dirs }], dirs: nextDirs };
}

/**
 * Parses one segment level (top level, a parenthesised/braced group, or a
 * `bash -c` body). `inherited` is the directory state at entry; the returned
 * `dirs` is the state after the level, which only a `{ …; }` group applies back
 * to its parent (same shell). A `( … )` group and a pipeline element run in a
 * subshell, so their cds stay inside.
 */
function parseLevel(input: string, depth: number, inherited: string[] | null): LevelResult {
  const tokenized = tokenize(input);
  if (!tokenized.ok) return unparsed(tokenized.reason);
  const actions: ShellActionDetailed[] = [];
  let current: ParsedWord[] = [];
  let expectTarget = false;
  let dirsState = inherited;
  let segmentDirs = inherited;
  let elementStartDirs = inherited;
  let listStartDirs = inherited;
  let inPipeline = false;
  let pipelineDirs = inherited;
  const flush = (): LevelResult => {
    if (current.length === 0) return { ok: true, actions: [], dirs: dirsState };
    const result = processSegment(current, depth, segmentDirs);
    current = [];
    if (!result.ok) return result;
    segmentDirs = result.dirs;
    dirsState = result.dirs;
    return result;
  };
  for (const token of tokenized.tokens) {
    if (token.kind === 'redir') {
      expectTarget = token.needsTarget;
      continue;
    }
    if (token.kind === 'sep') {
      expectTarget = false;
      const elementStart = elementStartDirs;
      const result = flush();
      if (!result.ok) return result;
      actions.push(...result.actions);
      if (token.sep === 'andor') {
        // Rework 1 item 3: every pipeline element runs in a subshell, so leaving
        // the pipeline at &&/|| restores the dirs in effect before it.
        if (inPipeline) dirsState = pipelineDirs;
        inPipeline = false;
        segmentDirs = dirsState;
        elementStartDirs = dirsState;
      } else if (token.sep === 'list') {
        // Rework 1 item 3: `echo x | cd app; npm run x` reads the OUTER
        // package.json; `;` ends the pipeline back in the parent shell.
        if (inPipeline) dirsState = pipelineDirs;
        inPipeline = false;
        segmentDirs = dirsState;
        elementStartDirs = dirsState;
        listStartDirs = dirsState;
      } else if (token.sep === 'pipeline') {
        if (!inPipeline) {
          pipelineDirs = elementStart;
          inPipeline = true;
        }
        dirsState = pipelineDirs;
        segmentDirs = pipelineDirs;
        elementStartDirs = pipelineDirs;
      } else {
        // A single `&` backgrounds the whole AND-OR list: its cds never
        // change the directory outside it.
        dirsState = listStartDirs;
        segmentDirs = dirsState;
        elementStartDirs = dirsState;
        inPipeline = false;
      }
      continue;
    }
    if (token.kind === 'group') {
      const head = flush();
      if (!head.ok) return head;
      actions.push(...head.actions);
      const inner = parseLevel(token.inner, depth, dirsState);
      if (!inner.ok) return inner;
      actions.push(...inner.actions);
      if (token.brace) {
        // `{ …; }` runs in the current shell: its final cds carry to later actions.
        dirsState = inner.dirs;
        segmentDirs = inner.dirs;
      }
      continue;
    }
    if (expectTarget) {
      expectTarget = false;
      continue;
    }
    current.push(token.word);
  }
  const tail = flush();
  if (!tail.ok) return tail;
  actions.push(...tail.actions);
  return { ok: true, actions, dirs: dirsState };
}

/**
 * L19a rules 1-6. Static parse; never expands scripts (that is B2-11/R4).
 * Returns only the actions found; the whole-text fallback is B2-01's.
 */
export function parseShellActions(command: string): ShellActionsResult {
  const result = parseLevel(command, 0, []);
  return result.ok
    ? { status: 'parsed', actions: result.actions.map(({ words, text }) => ({ words, text })) }
    : { status: 'unparsed', reason: result.reason };
}

/**
 * L19a ruling 5: the same parse plus each action's `dirs` (the static `cd`
 * paths before it, or `null` once one was not static). The public
 * `parseShellActions` projection above stays exactly as it was (B2-10).
 */
export function parseShellActionsDetailed(command: string): ShellActionsDetailedResult {
  const result = parseLevel(command, 0, []);
  return result.ok ? { status: 'parsed', actions: result.actions } : { status: 'unparsed', reason: result.reason };
}
