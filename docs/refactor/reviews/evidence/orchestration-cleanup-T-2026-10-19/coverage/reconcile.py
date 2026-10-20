#!/usr/bin/env python3
"""Reconcile the Codex and Claude coverage triage (decision 79-4).

usage: reconcile.py JOURNAL CODEX_DIR LISTS_DIR OUT_DIR
Codex: codex2/t-cov-<G>.out.md tables (row id in column 1, 'class' column found from the header).
Claude: the workflow journal's result lines ({"rows": [...]}).
Writes OUT_DIR/triage-merged.tsv (row, path:line, codex class, claude class, agree, codex reason, claude reason,
codex proposal, claude proposal), triage-disagree.json (rows to judge) and prints the counts.
"""
import collections, json, os, re, sys
journal, cdir, ldir, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
GROUPS = ['A1', 'A2', 'A3', 'B', 'C1', 'C2', 'C3', 'C4']
CLASSES = {'D1', 'D2', 'U', 'F', 'G', 'N', '待定'}
rows = {}
for g in GROUPS:
    for l in open(os.path.join(ldir, f'list-{g}.tsv'), encoding='utf-8').read().splitlines()[1:]:
        f = l.split('\t'); rows[f[0]] = {'where': f'{f[2]}:{f[3]}', 'kind': f[5], 'what': f[6] + (f' arm {f[7]}/{f[8]}' if f[5] == 'branch' else '')}
codex, missing_codex = {}, []
for g in GROUPS:
    p = os.path.join(cdir, f't-cov-{g}.out.md')
    if not os.path.exists(p): missing_codex.append(g); continue
    hdr = None
    for line in open(p, encoding='utf-8'):
        if not line.startswith('|'): continue
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if cells and cells[0].lower().startswith('row'):
            hdr = [c.lower() for c in cells]; continue
        m = re.match(r'`?([A-C][1-4]?-\d{3})`?$', cells[0]) if cells else None
        if not m or hdr is None: continue
        rid = m.group(1)
        ci = next((i for i, h in enumerate(hdr) if h.startswith('class') or h == '类别'), 3)
        cls = cells[ci].strip('*` ') if ci < len(cells) else '?'
        cls = '待定' if '待定' in cls else cls
        codex[rid] = {'cls': cls, 'reason': cells[ci + 1] if ci + 1 < len(cells) else '', 'proposal': cells[ci + 2] if ci + 2 < len(cells) else '',
                      'extra': ' | '.join(cells[ci + 3:])}
claude = {}
for line in open(journal, encoding='utf-8'):
    if '"type":"result"' not in line: continue
    o = json.loads(line); r = o.get('result')
    if isinstance(r, dict) and isinstance(r.get('rows'), list):
        for x in r['rows']: claude[x['row']] = x
agree = collections.Counter(); dis = []
with open(os.path.join(out, 'triage-merged.tsv'), 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('row\twhere\tkind\twhat\tcodex\tclaude\tagree\tcodex_reason\tclaude_reason\tcodex_proposal\tclaude_proposal\tcodex_A\tclaude_before_test\tclaude_t_reason_wrong\n')
    for rid, r in rows.items():
        c = codex.get(rid); a = claude.get(rid)
        cc = c['cls'] if c else '-'; ac = a['cls'] if a else '-'
        ok = cc == ac and cc in CLASSES and cc != '待定'
        if c and a: agree[(cc, ac)] += 1
        if c and a and not ok: dis.append({'row': rid, **r, 'codex': c, 'claude': a})
        clean = lambda s: (s or '').replace('\t', ' ').replace('\n', ' ')
        fh.write('\t'.join([rid, r['where'], r['kind'], r['what'], cc, ac, 'yes' if ok else ('no' if c and a else 'pending'),
                            clean(c and c['reason']), clean(a and a['reason']), clean(c and c['proposal']), clean(a and a['proposal']),
                            clean(c and c['extra']), clean(a and a.get('before_test')), str(a.get('t_reason_wrong')) if a else '']) + '\n')
json.dump(dis, open(os.path.join(out, 'triage-disagree.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
both = sum(agree.values())
same = sum(n for (x, y), n in agree.items() if x == y and x != '待定')
print(f'rows {len(rows)}; codex {len(codex)} (missing groups {missing_codex}); claude {len(claude)}; both {both}; agree {same}; to judge {len(dis)}')
cnt = collections.Counter(v['cls'] for v in codex.values()); print('codex classes', dict(cnt))
cnt = collections.Counter(v['cls'] for v in claude.values()); print('claude classes', dict(cnt))
print('agreed by class', dict(collections.Counter(x for (x, y), n in agree.items() for _ in range(n) if x == y)))
