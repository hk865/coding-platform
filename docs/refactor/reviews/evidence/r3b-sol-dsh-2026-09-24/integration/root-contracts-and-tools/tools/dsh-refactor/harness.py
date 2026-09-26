#!/usr/bin/env python3
"""Local R3a/R4a runner: dirty-tree snapshots, OS write scope, supervised import.

No credentials are parsed or printed. Existing DSH configuration stays read-only.
This is task tooling, not a product module or general-purpose sandbox service.
"""
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import time

WORKSPACE = Path('/home/hyh001/projects/coding-platform')
CODE = WORKSPACE / 'coding-platform'
NODE = WORKSPACE / '.toolchain/node-v24.21.0-linux-x64/bin/node'
CLI = Path('/home/hyh001/projects/deepseek-harness/deepseek-harness-master/apps/cli/lib/bin.js')
DSH_HOME_PATH = Path('/home/hyh001/projects/deepseek-harness/.dsh-vanilla')
RUNS = WORKSPACE / '.toolchain/dsh-refactor-runs'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(lane, scope_path):
    dest = RUNS / lane
    dest.mkdir(parents=True, exist_ok=False)
    scope = json.loads(Path(scope_path).read_text())
    allowed = scope['writableFiles']
    for rel in allowed:
        p = Path(rel)
        if p.is_absolute() or '..' in p.parts or not (WORKSPACE / p).is_file():
            raise ValueError('Write scope must name an existing workspace file: ' + rel)
    snapshot = dest / 'workspace'
    snapshot.mkdir()
    # Capture the current working files, including untracked implementation.
    # Large dependencies, generated output and preserved evidence stay read-only.
    for folder in ['coding-platform', 'docs', 'tools/dsh-refactor']:
        target = snapshot / folder
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(['rsync', '-a', '--exclude=node_modules', '--exclude=.git',
            '--exclude=dist', '--exclude=evidence', '--exclude=references',
            '--exclude=.cache', '--exclude=.vite', '--exclude=*.tsbuildinfo', '--exclude=__pycache__',
            str(WORKSPACE / folder) + '/', str(target) + '/'], check=True)
    mounts = ['.toolchain', 'coding-platform/.git', 'coding-platform/node_modules',
        'coding-platform/vendor/coding-agent/node_modules',
        'coding-platform/.local/linux-test-tools/node_modules',
        'coding-platform/src/ui/node_modules', 'coding-platform/evidence',
        'coding-platform/vendor/coding-agent/dist', 'coding-platform/dist']
    mounts = [rel for rel in mounts if (WORKSPACE / rel).exists()]
    for rel in mounts:
        (snapshot / rel).mkdir(parents=True, exist_ok=True)
    for name in ['state', 'output']:
        (dest / name).mkdir()
    # DSH rewrites generated profile boot files on startup. Only this lane's
    # profile copy is writable; credentials/settings and original profiles stay RO.
    if 'profiles' in scope.get('dshStateDirectories', []):
        shutil.copytree(DSH_HOME_PATH / 'profiles', dest / 'state/profiles', symlinks=True)
    hashes = {str(p.relative_to(snapshot)): digest(p) for p in snapshot.rglob('*') if p.is_file() and not p.is_symlink()}
    manifest = {'lane': lane, 'created': time.time(), 'scope': scope,
        'readOnlyMounts': mounts, 'snapshotHashes': hashes,
        'originalAllowedHashes': {rel: digest(WORKSPACE / rel) for rel in allowed}}
    (dest / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'lane': lane, 'snapshotFiles': len(hashes), 'writableFiles': allowed}))


def command(lane, tail):
    dest = RUNS / lane
    m = json.loads((dest / 'manifest.json').read_text())
    args = ['/usr/bin/bwrap', '--die-with-parent', '--new-session', '--unshare-all', '--share-net', '--cap-drop', 'ALL',
        '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run',
        '--ro-bind', str(dest / 'workspace'), str(WORKSPACE)]
    for rel in m['readOnlyMounts']:
        args += ['--ro-bind', str(WORKSPACE / rel), str(WORKSPACE / rel)]
    # Cross-process Vitest fixtures bundle their config under node_modules.
    # Only generated config cache is writable, privately per lane; dependencies stay RO.
    cache_rel = 'coding-platform/vendor/coding-agent/node_modules/.vite-temp'
    if (WORKSPACE / cache_rel).is_dir():
        cache = dest / 'state/test-vite-temp'
        cache.mkdir(parents=True, exist_ok=True)
        args += ['--bind', str(cache), str(WORKSPACE / cache_rel)]
    for rel in m['scope']['writableFiles']:
        args += ['--bind', str(dest / 'workspace' / rel), str(WORKSPACE / rel)]
    # State bindings are supplied only after auditing the actual DSH paths.
    for rel in m['scope'].get('dshStateDirectories', []):
        source = dest / 'state' / rel
        source.mkdir(parents=True, exist_ok=True)
        args += ['--bind', str(source), str(DSH_HOME_PATH / rel)]
    args += ['--bind', str(dest / 'output'), '/tmp/dsh-output', '--chdir', str(WORKSPACE)]
    args += ['--setenv', 'DSH_HOME', str(DSH_HOME_PATH),
        '--setenv', 'DSH_TELEMETRY_MODE', 'DISABLED',
        '--setenv', 'PATH', str(NODE.parent) + ':' + str(WORKSPACE / '.toolchain/bin') + ':' + os.environ.get('PATH', ''),
        '--setenv', 'XDG_CACHE_HOME', '/tmp/dsh-cache',
        '--setenv', 'XDG_STATE_HOME', '/tmp/dsh-state',
        '--setenv', 'XDG_DATA_HOME', '/tmp/dsh-data',
        '--setenv', 'npm_config_cache', '/tmp/npm-cache',
        '--setenv', 'EVIDENCE_OUTPUT_DIR', '/tmp/dsh-output/test-evidence', '--', *tail]
    return args


def check_scope(lane):
    dest = RUNS / lane
    m = json.loads((dest / 'manifest.json').read_text())
    root = dest / 'workspace'
    current = {str(p.relative_to(root)): digest(p) for p in root.rglob('*') if p.is_file() and not p.is_symlink()}
    changes = sorted(p for p in set(current) | set(m['snapshotHashes']) if current.get(p) != m['snapshotHashes'].get(p))
    forbidden = sorted(set(changes) - set(m['scope']['writableFiles']))
    stale = [p for p, h in m['originalAllowedHashes'].items() if digest(WORKSPACE / p) != h]
    result = {'changed': changes, 'outsideScope': forbidden, 'originalWorkspaceChanged': stale}
    (dest / 'scope-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
    return not forbidden and not stale


def run(lane, prompt, session=None):
    dest = RUNS / lane
    attempt = dest / ('attempt-' + str(time.time_ns()))
    attempt.mkdir()
    tail = [str(NODE), str(CLI), '--profile', 'headless', '--json']
    if session:
        tail += ['--session-id', session]
    tail += ['-']
    args = command(lane, tail)
    proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (attempt / 'process.json').write_text(json.dumps({'pid': proc.pid, 'command': args, 'started': time.time()}, indent=2))
    proc.stdin.write(Path(prompt).read_bytes())
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
                    err.write(data); err.flush(); continue
                buffer += data
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    try:
                        event = json.loads(line)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    kind = event.get('type', 'unknown')
                    counts[kind] = counts.get(kind, 0) + 1
                    if kind == 'thinking':
                        continue
                    safe = {k: event[k] for k in ('type','sessionId','tool','status','reason') if k in event}
                    if kind == 'session':
                        session = event['sessionId']
                        (dest / 'session-id.txt').write_text(session + '\n')
                        print(json.dumps(safe), flush=True)
                    elif kind == 'final':
                        (attempt / 'final.md').write_text(event.get('text', ''))
                    elif kind == 'error':
                        (attempt / 'error.json').write_text(json.dumps(event, indent=2))
                        print(json.dumps({'errorFile': str(attempt / 'error.json')}), flush=True)
                    events.write(json.dumps(safe) + '\n'); events.flush()
                    (dest / 'progress.json').write_text(json.dumps({'session': session, 'counts': counts, 'last': safe, 'updated': time.time(), 'attempt': str(attempt)}, indent=2))
    code = proc.wait()
    result = {'exitCode': code, 'session': session, 'counts': counts, 'finished': time.time(), 'attempt': str(attempt)}
    (attempt / 'result.json').write_text(json.dumps(result, indent=2))
    (dest / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)
    return code


if __name__ == '__main__':
    action, lane, *rest = sys.argv[1:]
    if action == 'prepare':
        prepare(lane, rest[0])
    elif action == 'exec':
        raise SystemExit(subprocess.run(command(lane, rest)).returncode)
    elif action == 'run':
        raise SystemExit(run(lane, *rest))
    elif action == 'audit':
        raise SystemExit(0 if check_scope(lane) else 1)
    else:
        raise SystemExit('Actions: prepare, exec, run, audit. Import is deliberately manual after review.')
