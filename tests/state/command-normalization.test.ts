/**
 * B2-10 (spec §5.2, L19a): `state/command-normalization.ts` pure functions.
 *
 * This file is a pure unit test of `parseShellActions` (it reports only the
 * actions it finds, possibly none) plus the two normalisation helpers. The
 * rule "parse found no action (or every segment is trivial) -> ② saves the
 * whole normalised text as the only action" lives in B2-01 (R4), not here.
 *
 * Expected digests are computed here from the literal inputs with
 * `node:crypto`, never with the product's own helpers.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  commandSha256, normalizeCommandText, parseShellActionsDetailed,
} from '../../src/core/work-graph/state/command-normalization.js';

// ------------------------------------------------------------------------ //
// Independent expectations                                                  //
// ------------------------------------------------------------------------ //
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
/** L19a rule 4: the comparison key of an action is the digest of its word array. */
const keyOf = (words: string[]): string => sha(JSON.stringify(words));

describe('B2-10 normalizeCommandText', () => {
  it('B2-10 strips leading/trailing whitespace and collapses every run of whitespace', () => {
    expect(normalizeCommandText('  a\t\tb\r\n c  ')).toBe('a b c');
    expect(normalizeCommandText('\n\techo   hi\r\n')).toBe('echo hi');
    expect(normalizeCommandText('')).toBe('');
    expect(normalizeCommandText('   ')).toBe('');
  });

  it('B2-10 leaves a text without whitespace untouched', () => {
    expect(normalizeCommandText('tool')).toBe('tool');
    expect(normalizeCommandText('tool --flag=1')).toBe('tool --flag=1');
  });
});

describe('B2-10 commandSha256', () => {
  it('B2-10 hashes the UTF-8 bytes of the normalised text, lowercase hex', () => {
    expect(commandSha256('  tool   a\tb  ')).toBe(sha('tool a b'));
    expect(commandSha256('tool a b')).toBe(sha('tool a b'));
    expect(commandSha256('   ')).toBe(sha(''));
  });

  it('B2-10 hashes UTF-8 bytes, not UTF-16 code units', () => {
    expect(commandSha256('  tool \u65e5\u672c\u8a9e  ')).toBe(sha('tool \u65e5\u672c\u8a9e'));
  });
});

const parsed = (command: string): Array<{ words: string[]; text: string }> => {
  const result = parseShellActionsDetailed(command);
  if (result.status !== 'parsed') {
    throw new Error(`expected parsed, got unparsed: ${result.reason}`);
  }
  return result.actions.map(({ words, text }) => ({ words, text }));
};
const wordsOf = (command: string): string[][] => parsed(command).map((action) => action.words);

describe('B2-10 parseShellActions words and quotes', () => {
  it('B2-10 splits a simple segment into words and joins them for display', () => {
    const result = parseShellActionsDetailed('tool a b');
    expect(result.status).toBe('parsed');
    if (result.status === 'parsed') {
      expect({ status: result.status, actions: result.actions.map(({ words, text }) => ({ words, text })) }).toEqual({
        status: 'parsed',
        actions: [{ words: ['tool', 'a', 'b'], text: 'tool a b' }],
      });
    }
  });

  it('B2-10 removes the quotes of a pure literal word (single, double, backslash)', () => {
    expect(wordsOf("tool 'a b'")).toEqual([['tool', 'a b']]);
    expect(wordsOf('tool "c d"')).toEqual([['tool', 'c d']]);
    expect(wordsOf('tool e\\ f')).toEqual([['tool', 'e f']]);
  });

  it('B2-10 joins adjacent quoted and unquoted parts into one word', () => {
    expect(wordsOf(`tool "a"'b'c`)).toEqual([['tool', 'abc']]);
    expect(wordsOf('tool "a\\"b"')).toEqual([['tool', 'a"b']]);
    expect(wordsOf("tool ''")).toEqual([['tool', '']]);
  });

  it('B2-10 keeps a separator inside quotes as literal text', () => {
    expect(wordsOf("tool 'a && b' ; c")).toEqual([['tool', 'a && b'], ['c']]);
  });

  it('B2-10 keeps argument boundaries: `tool \'a b\'` and `tool a b` are different actions', () => {
    const quoted = parsed("tool 'a b'")[0]!;
    const split = parsed('tool a b')[0]!;
    expect(quoted.words).toEqual(['tool', 'a b']);
    expect(split.words).toEqual(['tool', 'a', 'b']);
    expect(keyOf(quoted.words)).toBe(sha(JSON.stringify(['tool', 'a b'])));
    expect(keyOf(split.words)).toBe(sha(JSON.stringify(['tool', 'a', 'b'])));
    expect(keyOf(quoted.words)).not.toBe(keyOf(split.words));
  });
});

describe('B2-10 parseShellActions separators', () => {
  it('B2-10 splits on && and ||', () => {
    expect(wordsOf('a && b')).toEqual([['a'], ['b']]);
    expect(wordsOf('a || b')).toEqual([['a'], ['b']]);
  });

  it('B2-10 splits on ; | |& lone & and newline', () => {
    expect(wordsOf('a ; b')).toEqual([['a'], ['b']]);
    expect(wordsOf('a | b')).toEqual([['a'], ['b']]);
    expect(wordsOf('a |& b')).toEqual([['a'], ['b']]);
    expect(wordsOf('a & b')).toEqual([['a'], ['b']]);
    expect(wordsOf('a\nb')).toEqual([['a'], ['b']]);
  });

  it('B2-10 splits a chain of every separator in order', () => {
    expect(wordsOf('a && b || c ; d | e |& f & g\nh'))
      .toEqual([['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h']]);
  });

  it('B2-10 ignores empty segments and surrounding whitespace', () => {
    expect(wordsOf('  a ;;  b  ')).toEqual([['a'], ['b']]);
    expect(parseShellActionsDetailed('   ')).toEqual({ status: 'parsed', actions: [] });
  });
});

describe('B2-10 parseShellActions prefix stripping (rule 3)', () => {
  it('B2-10 strips leading static environment assignments', () => {
    expect(wordsOf('FOO=bar tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('A=1 B="two words" tool x')).toEqual([['tool', 'x']]);
  });

  it('B2-10 strips env with its assignments and the command prefixes', () => {
    expect(wordsOf('env FOO=bar tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('command tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('exec tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('time tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('nohup tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('nice tool x')).toEqual([['tool', 'x']]);
  });

  it('B2-10 strips the package-manager local-run prefixes', () => {
    expect(wordsOf('npx tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('npx -y tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('npx --yes tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('npx --no-install tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('npm exec -- tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('pnpm exec tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('yarn exec tool x')).toEqual([['tool', 'x']]);
  });

  it('B2-10 strips the node_modules/.bin program prefix', () => {
    expect(wordsOf('./node_modules/.bin/tool x')).toEqual([['tool', 'x']]);
    expect(wordsOf('node_modules/.bin/tool x')).toEqual([['tool', 'x']]);
  });

  it('B2-10 strips a chain of prefixes and assignments', () => {
    expect(wordsOf('FOO=bar env BAZ=qux npx -y command exec ./node_modules/.bin/tool x'))
      .toEqual([['tool', 'x']]);
  });

  it('B2-10 does not strip a prefix word in argument position', () => {
    expect(wordsOf('tool npx x')).toEqual([['tool', 'npx', 'x']]);
  });

  it('B2-10 leaves script runners unexpanded (B2-11 owns expansion)', () => {
    expect(wordsOf('npm run build')).toEqual([['npm', 'run', 'build']]);
    expect(wordsOf('pnpm run build')).toEqual([['pnpm', 'run', 'build']]);
    expect(wordsOf('yarn run build')).toEqual([['yarn', 'run', 'build']]);
  });
});

describe('B2-10 parseShellActions redirections (rule 4)', () => {
  it('B2-10 removes > >> < and their targets', () => {
    expect(wordsOf('tool a > out.txt')).toEqual([['tool', 'a']]);
    expect(wordsOf('tool a >> out.txt')).toEqual([['tool', 'a']]);
    expect(wordsOf('tool a < in.txt')).toEqual([['tool', 'a']]);
  });

  it('B2-10 removes fd redirections and 2>&1', () => {
    expect(wordsOf('tool a 2>&1')).toEqual([['tool', 'a']]);
    expect(wordsOf('tool a 2> err.txt')).toEqual([['tool', 'a']]);
    expect(wordsOf('tool a > out.txt 2>&1 < in.txt')).toEqual([['tool', 'a']]);
  });

  it('B2-10 removes a redirection attached to a word', () => {
    expect(wordsOf('tool a>out.txt')).toEqual([['tool', 'a']]);
    expect(wordsOf('tool > out.txt')).toEqual([['tool']]);
  });
});

describe('B2-10 parseShellActions irrelevant segments (rule 5)', () => {
  it('B2-10 drops navigation and no-op segments', () => {
    expect(wordsOf('cd /tmp')).toEqual([]);
    expect(wordsOf('pushd /tmp')).toEqual([]);
    expect(wordsOf('popd')).toEqual([]);
    expect(wordsOf('export FOO=bar')).toEqual([]);
    expect(wordsOf('set -e')).toEqual([]);
    expect(wordsOf('unset FOO')).toEqual([]);
    expect(wordsOf('true')).toEqual([]);
    expect(wordsOf('false')).toEqual([]);
    expect(wordsOf(':')).toEqual([]);
  });

  it('B2-10 drops output segments', () => {
    expect(wordsOf('echo hi')).toEqual([]);
    expect(wordsOf('printf %s hi')).toEqual([]);
  });

  it('B2-10 drops the known read-only view commands', () => {
    for (const command of ['ls -la', 'cat a', 'head a', 'tail a', 'wc a', 'pwd', 'which a',
      'test -f a', '[ -f a ]', 'grep x a', 'rg x', 'git status', 'git diff', 'git log', 'git show']) {
      expect(wordsOf(command), command).toEqual([]);
    }
  });

  it('B2-10 keeps commands that are not in the fixed list', () => {
    expect(wordsOf('git commit -m x')).toEqual([['git', 'commit', '-m', 'x']]);
    expect(wordsOf('rm a')).toEqual([['rm', 'a']]);
  });

  it('B2-10 drops a read-only find but keeps find with -exec or -delete', () => {
    expect(wordsOf('find . -name x')).toEqual([]);
    expect(wordsOf('find . -delete')).toEqual([['find', '.', '-delete']]);
    expect(wordsOf('find . -exec rm {} \\;')).toEqual([['find', '.', '-exec', 'rm', '{}', ';']]);
  });

  it('B2-10 returns parsed with no actions when every segment is irrelevant', () => {
    expect(parseShellActionsDetailed('cd /tmp && echo hi && ls -la && git status'))
      .toEqual({ status: 'parsed', actions: [] });
  });

  it('B2-10 keeps the actions around irrelevant segments', () => {
    expect(wordsOf('cd /tmp && echo hi && tool x && git status')).toEqual([['tool', 'x']]);
  });
});

/** Wraps `inner` in `levels` nested `bash -c` invocations (JSON string quoting is valid shell here). */
const nestShell = (levels: number, inner: string): string => {
  let script = inner;
  for (let depth = 0; depth < levels; depth += 1) script = `bash -c ${JSON.stringify(script)}`;
  return script;
};

describe('B2-10 parseShellActions group recursion (rule 1)', () => {
  it('B2-10 recurses inside ( … )', () => {
    expect(wordsOf('(tool a)')).toEqual([['tool', 'a']]);
    expect(wordsOf('(a; b)')).toEqual([['a'], ['b']]);
    expect(wordsOf('(cd /tmp; tool a)')).toEqual([['tool', 'a']]);
  });

  it('B2-10 recurses inside { …; }', () => {
    expect(wordsOf('{ tool a; }')).toEqual([['tool', 'a']]);
    expect(wordsOf('{ tool a; tool b; }')).toEqual([['tool', 'a'], ['tool', 'b']]);
  });

  it('B2-10 keeps the surrounding segment order and nests groups', () => {
    expect(wordsOf('(a; (b; c)) && d')).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(wordsOf('{ cd /tmp; tool a; } && tool b')).toEqual([['tool', 'a'], ['tool', 'b']]);
  });
});

describe('B2-10 parseShellActions shell -c recursion (rule 2)', () => {
  it('B2-10 recurses for bash/sh/zsh/dash with -c, -lc or -ic and a static string', () => {
    expect(wordsOf("bash -c 'tool a'")).toEqual([['tool', 'a']]);
    expect(wordsOf("sh -c 'tool a'")).toEqual([['tool', 'a']]);
    expect(wordsOf("zsh -lc 'tool a'")).toEqual([['tool', 'a']]);
    expect(wordsOf("dash -ic 'tool a'")).toEqual([['tool', 'a']]);
  });

  it('B2-10 recurses three levels', () => {
    expect(wordsOf(nestShell(3, 'tool a'))).toEqual([['tool', 'a']]);
  });

  it('B2-10 keeps the actions around a shell segment and drops irrelevant inner segments', () => {
    expect(wordsOf("tool x && bash -c 'cd /tmp && tool a' && tool y"))
      .toEqual([['tool', 'x'], ['tool', 'a'], ['tool', 'y']]);
    expect(wordsOf("bash -c 'cd /tmp'")).toEqual([]);
  });
});

describe('B2-10 parseShellActions unparsed forms (rule 6)', () => {
  const unparsedFor = (command: string): void => {
    const result = parseShellActionsDetailed(command);
    expect(result.status, command).toBe('unparsed');
    if (result.status === 'unparsed') expect(result.reason.length).toBeGreaterThan(0);
  };

  it('B2-10 returns unparsed for an unmatched quote or backtick', () => {
    unparsedFor("tool 'abc");
    unparsedFor('tool "abc');
    unparsedFor('tool `abc');
  });

  it('B2-10 returns unparsed for a here-doc', () => {
    unparsedFor('cat <<EOF');
    unparsedFor('tool x << EOF');
  });

  it('B2-10 returns unparsed for command substitution or a backtick in executable position', () => {
    unparsedFor('$(evil) arg');
    unparsedFor('tool a && $(evil)');
    unparsedFor('`evil` arg');
  });

  it('B2-10 returns unparsed for eval, source and . executables', () => {
    unparsedFor('eval "echo hi"');
    unparsedFor('source ./x.sh');
    unparsedFor('. ./x.sh');
  });

  it('B2-10 returns unparsed for process substitution', () => {
    unparsedFor('diff <(a) <(b)');
    unparsedFor('tool >(cat)');
  });

  it('B2-10 returns unparsed for a function definition', () => {
    unparsedFor('foo() { echo hi; }');
    unparsedFor('foo () { echo hi; }');
    unparsedFor('function foo { echo hi; }');
  });

  it('B2-10 returns unparsed for alias', () => {
    unparsedFor('alias x=y');
  });

  it('B2-10 returns unparsed beyond three nested shell -c levels', () => {
    unparsedFor(nestShell(4, 'tool a'));
  });

  it('B2-10 parses command substitution in argument position (not executable)', () => {
    expect(wordsOf('tool a $(date)')).toEqual([['tool', 'a', '$(date)']]);
    expect(parseShellActionsDetailed('echo $(date)')).toEqual({ status: 'parsed', actions: [] });
  });

  it('B2-10 makes the whole command unparsed when any segment is unparsed (U8)', () => {
    unparsedFor('tool a && eval b');
    unparsedFor('tool a; source x');
    unparsedFor('tool a && (b; eval c)');
    unparsedFor("bash -c 'tool a; alias x=y'");
  });
});

// ------------------------------------------------------------------------ //
// L19a ruling 5: the detailed parse carries per-action `dirs`               //
// ------------------------------------------------------------------------ //
const detailed = (command: string): Array<{ text: string; dirs: string[] | null }> => {
  const result = parseShellActionsDetailed(command);
  if (result.status !== 'parsed') throw new Error(`expected parsed, got unparsed: ${result.reason}`);
  return result.actions.map(action => ({ text: action.text, dirs: action.dirs }));
};
const dirsOf = (command: string): Array<string[] | null> => detailed(command).map(action => action.dirs);

describe('L19a ruling 5 parseShellActionsDetailed dirs', () => {
  it('carries the static cds before an action in order', () => {
    expect(dirsOf('tool a')).toEqual([[]]);
    expect(dirsOf('cd app && tool a')).toEqual([['app']]);
    expect(dirsOf('cd a && cd b && tool a')).toEqual([['a', 'b']]);
    expect(dirsOf('cd a; tool a')).toEqual([['a']]);
    expect(dirsOf('cd a || tool a')).toEqual([['a']]);
    expect(dirsOf('cd a\ntool a')).toEqual([['a']]);
    expect(dirsOf("cd 'my app' && tool a")).toEqual([['my app']]);
  });

  it('carries dirs across a { …; } group (same shell) and into it', () => {
    expect(dirsOf('{ cd app; tool a; }')).toEqual([['app']]);
    expect(dirsOf('{ cd app; tool a; } && tool b')).toEqual([['app'], ['app']]);
    expect(dirsOf('{ { cd app; tool a; } }')).toEqual([['app']]);
  });

  it('keeps a ( … ) subshell cd inside the subshell only', () => {
    expect(dirsOf('(cd app; tool a)')).toEqual([['app']]);
    expect(dirsOf('(cd app; tool a) && tool b')).toEqual([['app'], []]);
  });

  it('keeps a pipeline element cd and a backgrounded cd from changing later actions', () => {
    expect(dirsOf('cd app | tool a')).toEqual([[]]);
    expect(dirsOf('tool a | cd app')).toEqual([[]]);
    expect(dirsOf('cd app | tool a | tool b')).toEqual([[], []]);
    expect(dirsOf('cd app & tool a')).toEqual([[]]);
    expect(dirsOf('tool a & cd app')).toEqual([[]]);
    expect(dirsOf('cd app && tool a & tool b')).toEqual([['app'], []]);
  });

  it('carries outer dirs into a bash -c string and adds its cds', () => {
    expect(dirsOf("bash -c 'cd app && tool a'")).toEqual([['app']]);
    expect(dirsOf("cd outer && bash -c 'cd inner && tool a'")).toEqual([['outer', 'inner']]);
    expect(dirsOf("cd outer && bash -c 'cd inner && tool a' && tool b")).toEqual([['outer', 'inner'], ['outer']]);
  });

  it('makes dirs null after a non-static cd, pushd or popd', () => {
    expect(dirsOf('cd - && tool a')).toEqual([null]);
    expect(dirsOf('cd && tool a')).toEqual([null]);
    expect(dirsOf('cd $X && tool a')).toEqual([null]);
    expect(dirsOf('cd `pwd` && tool a')).toEqual([null]);
    expect(dirsOf('cd ~/app && tool a')).toEqual([null]);
    expect(dirsOf('pushd app && tool a')).toEqual([null]);
    expect(dirsOf('popd && tool a')).toEqual([null]);
    expect(dirsOf('cd app && cd - && tool a')).toEqual([null]);
  });

  it('keeps the public projection as { text, dirs } for a directory-changing command', () => {
    expect(detailed('cd app && tool a')).toEqual([{ text: 'tool a', dirs: ['app'] }]);
  });
});

// ------------------------------------------------------------------------ //
// Rework 1 item 3: leaving a pipeline element restores the outer directory  //
// ------------------------------------------------------------------------ //
describe('rework 1 item 3: pipeline exit restores the outer directory', () => {
  it('restores the outer dirs when a pipeline ends at ;', () => {
    expect(dirsOf('echo x | cd app; npm run x')).toEqual([[]]);
    expect(dirsOf('cd outer && echo x | cd app; npm run x')).toEqual([['outer']]);
  });

  it('restores the outer dirs when a pipeline ends at && or ||', () => {
    expect(dirsOf('echo x | cd app && npm run x')).toEqual([[]]);
    expect(dirsOf('echo x | cd app || npm run x')).toEqual([[]]);
    expect(dirsOf('cd outer && echo x | cd app && npm run x')).toEqual([['outer']]);
  });

  it('keeps every pipeline element in the outer dirs and restores after the last', () => {
    expect(dirsOf('echo x | cd app | cd inner; npm run x')).toEqual([[]]);
    expect(dirsOf('{ cd outer; echo x | cd app; npm run x; }')).toEqual([['outer']]);
  });

  it('keeps the single & background rule and the group rules unchanged', () => {
    expect(dirsOf('cd app | tool a & tool b')).toEqual([[], []]);
    expect(dirsOf('(cd app; tool a) && tool b')).toEqual([['app'], []]);
    expect(dirsOf('echo x | (cd app); tool b')).toEqual([[]]);
    expect(dirsOf('echo x | (cd app); tool b')).not.toContainEqual(['app']);
  });
});
