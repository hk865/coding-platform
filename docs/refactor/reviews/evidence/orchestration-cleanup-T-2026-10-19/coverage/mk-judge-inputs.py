#!/usr/bin/env python3
"""Build the judge inputs for the coverage triage (decision 79-4).

usage: mk-judge-inputs.py TRIAGE_DIR
Reads TRIAGE_DIR/triage-merged.tsv; writes TRIAGE_DIR/judge/:
  dis-NN.json     disagreeing or 待定 rows (both answers), grouped by file, at most 7 rows per batch
  skep-NN.json    agreed D1/D2/U rows (both answers), grouped by file, at most 12 rows per batch
  tw-NN.json      rows both sides call a wrong T deletion, one cluster per T item
  index.json      the batch names and their row ids
"""
import csv, json, os, sys, collections
csv.field_size_limit(10**8)
tdir = sys.argv[1]
out = os.path.join(tdir, 'judge'); os.makedirs(out, exist_ok=True)
rows = list(csv.DictReader(open(os.path.join(tdir, 'triage-merged.tsv'), encoding='utf-8'), delimiter='\t'))

def entry(x):
    return {'row': x['row'], 'where': x['where'], 'kind': x['kind'], 'what': x['what'],
            'codex': {'cls': x['codex'], 'reason': x['codex_reason'], 'proposal': x['codex_proposal'], 'group_A_info': x['codex_A']},
            'claude': {'cls': x['claude'], 'reason': x['claude_reason'], 'proposal': x['claude_proposal'],
                       'before_test': x['claude_before_test'], 't_reason_wrong': x['claude_t_reason_wrong'] == 'True'}}

def batches(xs, cap):
    byfile = collections.OrderedDict()
    for x in xs: byfile.setdefault(x['where'].rsplit(':', 1)[0], []).append(x)
    cur, res = [], []
    for f, items in byfile.items():
        for i in range(0, len(items), cap):
            chunk = items[i:i + cap]
            if cur and len(cur) + len(chunk) > cap: res.append(cur); cur = []
            cur.extend(chunk)
    if cur: res.append(cur)
    return res

tw_rows = [x for x in rows if x['claude_t_reason_wrong'] == 'True']
tw_ids = {x['row'] for x in tw_rows}
dis = [x for x in rows if x['agree'] != 'yes' and x['row'] not in tw_ids]
skep = [x for x in rows if x['agree'] == 'yes' and x['codex'] in ('D1', 'D2', 'U') and x['row'] not in tw_ids]
CLUSTERS = [
    ('TQ-114 B-12 IN04 + TQ-115 B-13 IN12', ['A1-032', 'A1-034', 'A1-035', 'A1-036']),
    ('T1-062 changed-lease / added-lease', ['A1-059', 'A1-061']),
    ('TP-109 RUN-16 pause variant', ['A1-077']),
    ('TP-172 M05 otherGoal read', ['A2-054', 'A2-055']),
    ('T1-038 T5x source_moving', ['A2-059', 'A2-060', 'A2-061', 'A2-062', 'A2-063']),
    ('T3-063 symlink in the A-07 merge', ['A3-038']),
    ('TP-026 tsconfig include assertion', ['A3-039']),
    ('TQ-093 display-preference empty state', ['A3-040', 'A3-041', 'A3-042']),
]
byid = {x['row']: x for x in rows}
assert {r for _, ids in CLUSTERS for r in ids} == tw_ids, sorted(tw_ids)
index = {'dis': [], 'skep': [], 'tw': []}
for kind, groups in (('dis', batches(dis, 7)), ('skep', batches(skep, 12))):
    for i, g in enumerate(groups, 1):
        name = f'{kind}-{i:02d}'
        json.dump([entry(x) for x in g], open(os.path.join(out, name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        index[kind].append({'name': name, 'rows': [x['row'] for x in g]})
for i, (title, ids) in enumerate(CLUSTERS, 1):
    name = f'tw-{i:02d}'
    json.dump({'cluster': title, 'rows': [entry(byid[r]) for r in ids]}, open(os.path.join(out, name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    index['tw'].append({'name': name, 'title': title, 'rows': ids})
json.dump(index, open(os.path.join(out, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"dis {len(dis)} rows in {len(index['dis'])} batches; skep {len(skep)} rows in {len(index['skep'])} batches; tw {len(tw_ids)} rows in {len(CLUSTERS)} clusters")
