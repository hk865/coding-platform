#!/usr/bin/env python3
"""Standalone dirty-tree snapshots, narrow OS write scope and supervised import.

Existing DSH settings stay read-only; only lane-local state can be written.
This is development tooling, not a product service. No automatic import.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import subprocess
import sys
import time

WORKSPACE = Path(__file__).resolve().parents[2]
RUNS = WORKSPACE / '.toolchain/dsh-refactor-runs'
DEPENDENCIES = ('node_modules', 'vendor/coding-agent/node_modules')
STATE_DIRECTORIES = {'profiles', 'sessions', 'storages', 'cache', 'llm-deepseek', 'attachments'}
EXCLUDED_NAMES = {'.git', 'node_modules', '.toolchain', '.cache', '.vite',
                  '.vite-temp', '__pycache__', '.workbench-build', 'coverage'}
EXCLUDED_PATHS = {Path('docs/refactor/reviews/evidence')}


def resolve_node():
    configured = os.environ.get('CODING_PLATFORM_NODE', 'node')
    found = shutil.which(configured)
    if found is None:
        raise ValueError('Node 24 is required: set CODING_PLATFORM_NODE or add it to PATH')
    node = Path(found).resolve()
    version = subprocess.run([str(node), '--version'], check=True, capture_output=True, text=True).stdout.strip()
    match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)', version)
    if match is None or int(match[1]) != 24 or int(match[2]) < 15:
        raise ValueError('Node >=24.15.0 <25 is required; selected ' + version)
    return node


def dsh_paths(required=True):
    cli_value = os.environ.get('CODING_PLATFORM_DSH_CLI') or os.environ.get('DSH_CLI')
    home_value = os.environ.get('CODING_PLATFORM_DSH_HOME') or os.environ.get('DSH_HOME')
    cli = Path(cli_value).expanduser().resolve() if cli_value else None
    home = Path(home_value).expanduser().resolve() if home_value else None
    if required and (cli is None or not cli.is_file() or home is None or not home.is_dir()):
        raise ValueError('Set CODING_PLATFORM_DSH_CLI to the existing CLI file and DSH_HOME to the existing configuration directory')
    return cli, home


def snapshot_ignore(directory, children):
    # Only application root dist is generated; frozen vendor dist is required.
    return [name for name in children if name in EXCLUDED_NAMES or name.endswith('.tsbuildinfo')
            or (Path(directory) / name).relative_to(WORKSPACE) in EXCLUDED_PATHS
            or (Path(directory) == WORKSPACE and name == 'dist')]


def digest(path):
    if path.is_symlink():
        return 'symlink:' + hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def inventory(root):
    result = {}
    for directory, folders, files in os.walk(root, followlinks=False):
        for name in folders + files:
            path = Path(directory) / name
            if path.is_symlink() or path.is_file():
                result[str(path.relative_to(root))] = digest(path)
    return result


def lane_path(lane):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*', lane):
        raise ValueError('Lane must be one directory name containing letters, digits, _ or -')
    return RUNS / lane


def read_scope(scope_path):
    scope = json.loads(Path(scope_path).read_text())
    allowed = scope.get('writableFiles')
    if not isinstance(allowed, list) or not allowed or len(set(allowed)) != len(allowed):
        raise ValueError('writableFiles must be a nonempty list of unique existing files')
    for rel in allowed:
        if not isinstance(rel, str):
            raise ValueError('writableFiles entries must be relative strings')
        path = Path(rel)
        if path.is_absolute() or '..' in path.parts or path.as_posix() != rel:
            raise ValueError('Write scope must be relative to the standalone root: ' + rel)
        parts = [WORKSPACE.joinpath(*path.parts[:i]) for i in range(1, len(path.parts) + 1)]
        if not (WORKSPACE / path).is_file() or any(p.is_symlink() for p in parts):
            raise ValueError('Write scope must name an existing physical workspace file: ' + rel)
        if (any(part in EXCLUDED_NAMES for part in path.parts) or path.parts[0] == 'dist'
                or any(path.is_relative_to(excluded) for excluded in EXCLUDED_PATHS) or rel.endswith('.tsbuildinfo')):
            raise ValueError('Write scope cannot target excluded snapshot content: ' + rel)
    states = scope.get('dshStateDirectories', [])
    if not isinstance(states, list) or any(name not in STATE_DIRECTORIES for name in states):
        raise ValueError('Only the documented lane-local DSH state directories may be writable')
    return scope


def read_manifest(lane):
    dest = lane_path(lane)
    manifest = json.loads((dest / 'manifest.json').read_text())
    if manifest.get('workspaceRoot') != str(WORKSPACE):
        raise ValueError('Lane baseline is not from this standalone root; prepare a new lane')
    return dest, manifest


def prepare(lane, scope_path):
    scope = read_scope(scope_path)
    _, home = dsh_paths()
    resolve_node()
    for rel in DEPENDENCIES:
        path = WORKSPACE / rel
        if not path.is_dir() or not path.resolve().is_relative_to(WORKSPACE):
            raise ValueError('Install this repository dependency tree before prepare: ' + rel)
    if 'profiles' in scope.get('dshStateDirectories', []) and not (home / 'profiles').is_dir():
        raise ValueError('The existing DSH_HOME has no profiles directory')
    dest = lane_path(lane)
    dest.mkdir(parents=True, exist_ok=False)
    snapshot = dest / 'workspace'
    # Include tracked, dirty and untracked work; never copy an old HEAD or lane.
    shutil.copytree(WORKSPACE, snapshot, ignore=snapshot_ignore, symlinks=True)
    for rel in DEPENDENCIES:
        (snapshot / rel).mkdir(parents=True, exist_ok=True)
    for name in ('state', 'output'):
        (dest / name).mkdir()
    if 'profiles' in scope.get('dshStateDirectories', []):
        shutil.copytree(home / 'profiles', dest / 'state/profiles', symlinks=True)
    hashes = inventory(snapshot)
    manifest = {'lane': lane, 'workspaceRoot': str(WORKSPACE), 'created': time.time(), 'scope': scope,
                'readOnlyMounts': list(DEPENDENCIES), 'snapshotHashes': hashes,
                'originalAllowedHashes': {rel: digest(WORKSPACE / rel) for rel in scope['writableFiles']}}
    (dest / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'lane': lane, 'snapshotFiles': len(hashes), 'writableFiles': scope['writableFiles']}))


def command(lane, tail):
    dest, manifest = read_manifest(lane)
    _, home = dsh_paths()
    node = resolve_node()
    bwrap = shutil.which('bwrap')
    if bwrap is None:
        raise ValueError('bubblewrap is required; no weaker sandbox fallback is provided')
    args = [bwrap, '--die-with-parent', '--new-session', '--unshare-all', '--share-net', '--cap-drop', 'ALL',
            '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run',
            '--ro-bind', str(dest / 'workspace'), str(WORKSPACE)]
    resolver = Path('/etc/resolv.conf').resolve()
    if resolver.is_relative_to('/run') and resolver.is_file():
        args += ['--ro-bind', str(resolver), str(resolver)]
    for rel in manifest['readOnlyMounts']:
        args += ['--ro-bind', str(WORKSPACE / rel), str(WORKSPACE / rel)]
    # A configured Node under the excluded .toolchain still needs its own bin.
    if node.is_relative_to(WORKSPACE / '.toolchain'):
        args += ['--ro-bind', str(node.parent), str(node.parent)]
    for rel in manifest['scope']['writableFiles']:
        args += ['--bind', str(dest / 'workspace' / rel), str(WORKSPACE / rel)]
    # Existing global configuration remains read-only. Profile boot output and
    # selected runtime state are private copies, never original DSH directories.
    for rel in manifest['scope'].get('dshStateDirectories', []):
        source = dest / 'state' / rel
        source.mkdir(parents=True, exist_ok=True)
        args += ['--bind', str(source), str(home / rel)]
    args += ['--bind', str(dest / 'output'), '/tmp/dsh-output', '--chdir', str(WORKSPACE),
             '--setenv', 'DSH_HOME', str(home), '--setenv', 'DSH_TELEMETRY_MODE', 'DISABLED',
             '--setenv', 'CODING_PLATFORM_NODE', str(node),
             '--setenv', 'PATH', str(node.parent) + ':' + os.environ.get('PATH', ''),
             '--setenv', 'XDG_CACHE_HOME', '/tmp/dsh-cache', '--setenv', 'XDG_STATE_HOME', '/tmp/dsh-state',
             '--setenv', 'XDG_DATA_HOME', '/tmp/dsh-data', '--setenv', 'npm_config_cache', '/tmp/npm-cache',
             '--setenv', 'EVIDENCE_OUTPUT_DIR', '/tmp/dsh-output/test-evidence', '--', *tail]
    return args


def check_scope(lane):
    dest, manifest = read_manifest(lane)
    current = inventory(dest / 'workspace')
    before = manifest['snapshotHashes']
    changes = sorted(p for p in set(current) | set(before) if current.get(p) != before.get(p))
    forbidden = sorted(set(changes) - set(manifest['scope']['writableFiles']))
    stale = [p for p, h in manifest['originalAllowedHashes'].items() if digest(WORKSPACE / p) != h]
    result = {'changed': changes, 'outsideScope': forbidden, 'originalWorkspaceChanged': stale}
    (dest / 'scope-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    return not forbidden and not stale


def run(lane, prompt, session=None):
    dest, _ = read_manifest(lane)
    cli, _ = dsh_paths()
    tail = [str(resolve_node()), str(cli), '--profile', 'headless', '--json']
    if session:
        tail += ['--session-id', session]
    args = command(lane, [*tail, '-'])
    prompt_bytes = Path(prompt).read_bytes()
    attempt = dest / ('attempt-' + str(time.time_ns()))
    attempt.mkdir()
    proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (attempt / 'process.json').write_text(json.dumps({'pid': proc.pid, 'command': args, 'started': time.time()}, indent=2))
    proc.stdin.write(prompt_bytes)
    proc.stdin.close()
    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ, 'stdout')
    selector.register(proc.stderr, selectors.EVENT_READ, 'stderr')
    buffer = b''
    counts = {}
    with (attempt / 'events.jsonl').open('w') as events, (attempt / 'stderr.log').open('wb') as err:
        while selector.get_map():
            for key, _ in selector.select(timeout=5):
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                if key.data == 'stderr':
                    err.write(data); err.flush()
                    continue
                buffer += data
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    try:
                        event = json.loads(line)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    if not isinstance(event, dict):
                        continue
                    kind = event.get('type', 'unknown')
                    counts[kind] = counts.get(kind, 0) + 1
                    if kind == 'thinking':
                        continue
                    safe = {k: event[k] for k in ('type', 'sessionId', 'tool', 'status', 'reason') if k in event}
                    if kind == 'session':
                        session = event['sessionId']
                        (dest / 'session-id.txt').write_text(session + '\n')
                        print(json.dumps(safe), flush=True)
                    elif kind == 'final':
                        (attempt / 'final.md').write_text(event.get('text', ''))
                    elif kind == 'error':
                        (attempt / 'error.json').write_text(json.dumps(safe, indent=2))
                        print(json.dumps({'errorFile': str(attempt / 'error.json')}), flush=True)
                    events.write(json.dumps(safe) + '\n'); events.flush()
                    (dest / 'progress.json').write_text(json.dumps({'session': session, 'counts': counts,
                        'last': safe, 'updated': time.time(), 'attempt': str(attempt)}, indent=2))
    code = proc.wait()
    result = {'exitCode': code, 'session': session, 'counts': counts, 'finished': time.time(), 'attempt': str(attempt)}
    (attempt / 'result.json').write_text(json.dumps(result, indent=2))
    (dest / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)
    return code


def main():
    arguments = sys.argv[1:]
    if arguments == ['--show']:
        cli, home = dsh_paths(required=False)
        print(json.dumps({'workspaceRoot': str(WORKSPACE), 'runs': str(RUNS), 'node': str(resolve_node()),
            'cli': str(cli) if cli else None, 'cliExists': cli is not None and cli.is_file(),
            'dshHome': str(home) if home else None, 'dshHomeExists': home is not None and home.is_dir(),
            'bubblewrap': shutil.which('bwrap'), 'readOnlyDependencies': [str(WORKSPACE / p) for p in DEPENDENCIES],
            'excludedNames': sorted(EXCLUDED_NAMES), 'excludedPaths': sorted(map(str, EXCLUDED_PATHS)),
            'excludedRootOutput': 'dist',
            'preservedFrozenOutput': 'vendor/coding-agent/dist', 'createsState': False}))
        return 0
    if len(arguments) < 2:
        raise ValueError('Usage: harness.py --show | prepare LANE SCOPE | run LANE PROMPT [SESSION] | exec LANE COMMAND... | audit LANE')
    action, lane, *rest = arguments
    if action == 'prepare' and len(rest) == 1:
        prepare(lane, rest[0]); return 0
    if action == 'run' and len(rest) in (1, 2):
        return run(lane, *rest)
    if action == 'exec' and rest:
        return subprocess.run(command(lane, rest)).returncode
    if action == 'audit' and not rest:
        return 0 if check_scope(lane) else 1
    raise ValueError('Invalid action/arguments; import remains manual after review')


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
