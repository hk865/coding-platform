#!/usr/bin/env python3
"""Summarize the memory profile of the full suite (mk-memprof.sh). usage: analyze.py MEMDIR"""
import bisect, json, os, re, statistics, sys
M = sys.argv[1]
ansi = re.compile(r'\x1b\[[0-9;]*m')
FILE = re.compile(r'^ [✓×↓] (tests/\S+) \((\d+) tests?(?:[^)]*)\) (?:(\d+)ms )?(\d+) MB heap used')
heap, dur_txt = {}, {}
for line in open(os.path.join(M, 'memprof-run.txt'), encoding='utf-8', errors='replace'):
    m = FILE.match(ansi.sub('', line.rstrip('\n')))
    if m:
        heap[m.group(1)] = int(m.group(4)); dur_txt[m.group(1)] = int(m.group(3) or 0)
d = json.load(open(os.path.join(M, 'memprof.json'), encoding='utf-8'))
root = os.path.commonpath([t['name'] for t in d['testResults']])
files = []
for t in d['testResults']:
    rel = os.path.relpath(t['name'], os.path.dirname(root) if root.endswith('tests') else root)
    rel = rel[rel.index('tests/'):] if 'tests/' in rel else rel
    files.append({'file': rel, 'start': t['startTime'], 'end': t['endTime'], 'dur': (t['endTime'] - t['startTime']) / 1000,
                  'tests': len(t['assertionResults']), 'heap': heap.get(rel)})
S = [x for x in (l.rstrip('\n').split('\t') for l in open(os.path.join(M, 'samples.tsv'), encoding='utf-8')) if len(x) == 5][1:]
S = [(int(a), int(b), int(c) if c != '-' else 0, int(e), int(w) if w.isdigit() else 0) for a, b, c, e, w in S]
ts = [s[0] for s in S]
def mem_during(f):
    i, j = bisect.bisect_left(ts, f['start']), bisect.bisect_right(ts, f['end'])
    seg = S[i:j] or S[max(0, i - 1):i + 1]
    return max(s[1] for s in seg) / 2**20 if seg else None
for f in files: f['scope_mib'] = mem_during(f)
t0 = min(f['start'] for f in files); t1 = max(f['end'] for f in files)
tot = sum(f['dur'] for f in files)
out = []
P = out.append
P(f'files {len(files)}; with heap line {sum(1 for f in files if f["heap"] is not None)}; wall {(t1 - t0) / 1000:.0f} s; '
  f'sum of file durations {tot:.0f} s (= {tot / ((t1 - t0) / 1000):.2f} files running on average)')
cur = [s[1] / 2**20 for s in S if s[1] > 0]
P(f'scope memory (MiB): peak {max(s[2] for s in S) / 2**20:.0f}; current max {max(cur):.0f}, p95 {sorted(cur)[int(len(cur) * .95)]:.0f}, '
  f'median {statistics.median(cur):.0f}; machine available min {min(s[3] for s in S)} MB')
hs = sorted(f['heap'] for f in files if f['heap'] is not None)
P(f'heap per file (MB, JS heap after the file): median {statistics.median(hs)}, p90 {hs[int(len(hs) * .9)]}, p99 {hs[int(len(hs) * .99)]}, max {hs[-1]}')
ds = sorted(f['dur'] for f in files)
P(f'duration per file (s): median {statistics.median(ds):.1f}, p90 {ds[int(len(ds) * .9)]:.1f}, p99 {ds[int(len(ds) * .99)]:.1f}, max {ds[-1]:.0f}')
big = sorted(files, key=lambda f: -f['dur'])
share = 0
for k in (5, 10, 20, 50):
    s = sum(f['dur'] for f in big[:k]); P(f'  slowest {k} files: {s:.0f} s = {100 * s / tot:.0f}% of the summed time')
P('\nslowest 30 files: seconds | heap MB | tests | scope MiB while it ran | file')
for f in big[:30]:
    P(f"  {f['dur']:7.0f} | {f['heap'] or '-':>5} | {f['tests']:4} | {f['scope_mib'] or 0:6.0f} | {f['file']}")
P('\nlargest heap 20 files: heap MB | seconds | file')
for f in sorted(files, key=lambda f: -(f['heap'] or 0))[:20]:
    P(f"  {f['heap']:5} | {f['dur']:7.0f} | {f['file']}")
P('\nby folder: files | summed seconds | max heap MB')
by = {}
for f in files:
    k = '/'.join(f['file'].split('/')[:2]); b = by.setdefault(k, [0, 0.0, 0]); b[0] += 1; b[1] += f['dur']; b[2] = max(b[2], f['heap'] or 0)
for k, (n, s, h) in sorted(by.items(), key=lambda kv: -kv[1][1]):
    P(f'  {n:4} | {s:7.0f} | {h:4} | {k}')
# lower bound of the wall time for W workers: max(longest file, sum / W)
P('\nwall-time lower bound for W workers = max(longest file, summed time / W) (same machine, no other load):')
for w in (5, 8, 10, 12, 16):
    P(f'  W={w:2}: {max(ds[-1], tot / w):6.0f} s')
open(os.path.join(M, 'summary.txt'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
with open(os.path.join(M, 'per-file.tsv'), 'w', encoding='utf-8') as fh:
    fh.write('file\tseconds\theap_mb\ttests\tscope_mib_while_running\n')
    for f in big: fh.write(f"{f['file']}\t{f['dur']:.1f}\t{f['heap'] if f['heap'] is not None else ''}\t{f['tests']}\t{f['scope_mib'] or 0:.0f}\n")
print('\n'.join(out))
