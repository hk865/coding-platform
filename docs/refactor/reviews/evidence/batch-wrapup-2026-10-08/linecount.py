#!/usr/bin/env python3
"""Decision-31 line count (STATUS "简化后的行数"): wc -l of every file under src/,
grouped by area; service files = src/ minus work-graph/state and ui.
Paths of older commits are mapped through the task-D move (0cd45508) so that
the areas are the post-move directories. Usage: linecount.py <label=commit>..."""
import subprocess, sys, json, collections

def git(*args):
    return subprocess.run(['git', *args], check=True, capture_output=True, text=True).stdout

# Task D rename map (old -> new), from the move commit itself.
moves = {}
for line in git('diff', '-M', '--name-status', '0cd45508^', '0cd45508').splitlines():
    parts = line.split('\t')
    if parts[0].startswith('R'):
        moves[parts[1]] = parts[2]

def area(path):
    p = path[len('src/'):]
    if p.startswith('ui/'): return 'ui (not counted)'
    if p.startswith('core/work-graph/state/'): return 'work-graph/state (not counted)'
    if p.startswith('core/work-graph/'):
        rest = p[len('core/work-graph/'):]
        return 'work-graph/' + rest.split('/')[0] if '/' in rest else 'work-graph (root files)'
    if p.startswith('core/'):
        rest = p[len('core/'):]
        return rest.split('/')[0] if '/' in rest else 'core (root files)'
    return p.split('/')[0] if '/' in p else '(src root files)'

def count(commit, remap):
    files = [f for f in git('ls-tree', '-r', '--name-only', commit, '--', 'src').splitlines()]
    proc = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    out = {}
    for f in files:
        proc.stdin.write(f'{commit}:{f}\n'.encode()); proc.stdin.flush()
        header = proc.stdout.readline().split()
        size = int(header[2]); data = proc.stdout.read(size); proc.stdout.read(1)
        path = moves.get(f, f) if remap else f
        out[path] = data.count(b'\n')
    proc.stdin.close(); proc.wait()
    return out

result = {}
for arg in sys.argv[1:]:
    label, commit = arg.split('=', 1)
    sha = git('rev-parse', '--short=8', commit).strip()
    per_file = count(commit, remap=True)
    areas = collections.Counter()
    for path, n in per_file.items(): areas[area(path)] += n
    service = sum(n for a, n in areas.items() if '(not counted)' not in a)
    result[label] = {'commit': sha, 'files': len(per_file), 'areas': dict(areas), 'service': service,
                     'per_file': per_file}
json.dump(result, open(sys.argv[0].rsplit('/', 1)[0] + '/linecount.json', 'w'), indent=1, sort_keys=True)
labels = list(result)
all_areas = sorted({a for r in result.values() for a in r['areas']})
print('area\t' + '\t'.join(f'{l} {result[l]["commit"]}' for l in labels))
for a in all_areas:
    print(a + '\t' + '\t'.join(str(result[l]['areas'].get(a, 0)) for l in labels))
print('SERVICE\t' + '\t'.join(str(result[l]['service']) for l in labels))
print('FILES\t' + '\t'.join(str(result[l]['files']) for l in labels))
