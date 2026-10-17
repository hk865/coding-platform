"""Print diagnostics of one mode from a scan NDJSON (debug helper).
Run only as: python3 -I slam_peek.py NDJSON MODE [project|external|both] [max_per_tu]"""
import collections
import json
import sys

path, mode = sys.argv[1], sys.argv[2]
which = sys.argv[3] if len(sys.argv) > 3 else 'project'
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 15
ext_counter = collections.Counter()
rows = {}
for line in open(path, encoding='utf-8'):
    r = json.loads(line)
    if r.get('mode') == mode:
        rows[r['tu_index']] = r
for k in sorted(rows):
    r = rows[k]
    print('#', k, r.get('tu_rel'), r.get('status'))
    if which in ('project', 'both'):
        for d in r.get('diagnostics', [])[:limit]:
            print('   P %s:%d sev%d [%s] fnf=%s %s' % (d['file'].split('/src/')[-1] if d['file'] else None, d['line'], d['severity'], d['category'], d['file_not_found'], d['spelling'][:150]))
    for d in r.get('external_errors', []):
        ext_counter[(d['file'], d['spelling'][:100])] += 1
    if which in ('external', 'both'):
        for d in r.get('external_errors', [])[:limit]:
            print('   X %s:%d [%s] %s' % (d['file'], d['line'], d['category'], d['spelling'][:150]))
if which in ('external', 'both'):
    print('== external error (file, text) counted over TUs (only the first 20 listed per TU)')
    for (f, s), n in ext_counter.most_common(30):
        print('%4d %s %s' % (n, f, s))
