#!/usr/bin/env python3
"""Final coverage triage (decision 79-4): the two reviews plus the DSH judge run tb-Tjudge-1020.

usage: mk-triage-final.py TRIAGE_DIR
Reads TRIAGE_DIR/triage-merged.tsv, TRIAGE_DIR/judge/index.json and TRIAGE_DIR/judge-out/*.json.
Final class per row:
  agreed G/F (no skeptic)            -> the agreed class            (source agreed)
  agreed D1/D2/U, skeptic upheld     -> the agreed class            (source skeptic-upheld)
  agreed D1/D2/U, skeptic challenged -> the tiebreak judge's class  (source tiebreak)
  disagreeing or 待定                -> the judge's class           (source judge)
  both say T deleted wrongly         -> the verifier's class        (source verifier; upheld or not)
Action (from the class, and for D1/D2/U from the proposal wording; the lead reviews every delete row):
  D1/D2 -> delete, or keep when the proposal says keep / reserved; U -> delete-guard or keep-untested (or lead when
  the wording is mixed); G/F -> test-gap; N -> none; 待定 -> pending.
Writes TRIAGE_DIR/triage-final.tsv and TRIAGE_DIR/triage-final-summary.md.
"""
import csv, collections, json, os, re, sys
csv.field_size_limit(10**8)
T = sys.argv[1]
J, O = os.path.join(T, 'judge'), os.path.join(T, 'judge-out')
rows = {x['row']: x for x in csv.DictReader(open(os.path.join(T, 'triage-merged.tsv'), encoding='utf-8'), delimiter='\t')}
idx = json.load(open(os.path.join(J, 'index.json'), encoding='utf-8'))
load = lambda n: json.load(open(os.path.join(O, n + '.json'), encoding='utf-8'))
clean = lambda s: re.sub(r'\s+', ' ', s or '').strip()
final = {}
for b in idx['tw']:
    d = load(b['name'])
    for r in d['rows']:
        final[r['row']] = dict(cls=r['cls'], source='verifier', upheld=d['upheld'], reason=clean(d['t_reason_check']),
                               proposal=clean(d['restore']), note=clean(r['note']), batch=b['name'], cluster=b['title'])
for b in idx['dis']:
    for r in load(b['name'])['rows']:
        final[r['row']] = dict(cls=r['cls'], source='judge', winner=r['winner'], reason=clean(r['reason']),
                               proposal=clean(r['proposal']), t_wrong=r['t_reason_wrong'], note=clean(r['t_item']), batch=b['name'])
for b in idx['skep']:
    sk = {r['row']: r for r in load(b['name'])['rows']}
    tie_p = os.path.join(O, 'tie-' + b['name'] + '.json')
    tie = {r['row']: r for r in json.load(open(tie_p, encoding='utf-8'))['rows']} if os.path.exists(tie_p) else {}
    for rid in b['rows']:
        x, s = rows[rid], sk[rid]
        if rid in tie:
            t = tie[rid]
            final[rid] = dict(cls=t['cls'], source='tiebreak', winner=t['winner'], reason=clean(t['reason']), proposal=clean(t['proposal']),
                              note=clean(f"skeptic: refuted={s['refuted']} proposal_ok={s['proposal_ok']} {s['evidence']} {s['proposal_note']}"), batch=b['name'])
        else:
            final[rid] = dict(cls=x['codex'], source='skeptic-upheld', reason=clean(x['claude_reason']),
                              proposal=clean(x['claude_proposal'] + ' || codex: ' + x['codex_proposal']), note=clean(s['evidence']), batch=b['name'])
for rid, x in rows.items():
    if rid not in final:
        assert x['agree'] == 'yes' and x['codex'] in ('G', 'F'), (rid, x['agree'], x['codex'])
        final[rid] = dict(cls=x['codex'], source='agreed', reason=clean(x['claude_reason']),
                          proposal=clean(x['claude_proposal'] + ' || codex: ' + x['codex_proposal']), note='', batch='')
assert set(final) == set(rows)

KEEP = re.compile(r"do not delete|don't delete|keep (it|the|this|untested|as|both)|keep\b|reserv|不删|保留|留给第|暂不删", re.I)
DEL = re.compile(r'delete|remove|drop|删|去掉', re.I)
def action(f):
    c, p = f['cls'], f['proposal']
    if c in ('G', 'F'): return 'test-gap'
    if c == 'N': return 'none'
    if c == '待定': return 'pending'
    k, d = bool(KEEP.search(p)), bool(DEL.search(p))
    if c in ('D1', 'D2'): return 'keep?' if k and not re.search(r'^(delete|remove)', p, re.I) else 'delete'
    if c == 'U': return 'delete-guard' if d and not k else ('keep-untested' if k and not d else 'lead')
    return '?'
for f in final.values(): f['action'] = action(f)

with open(os.path.join(T, 'triage-final.tsv'), 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('row\twhere\tkind\twhat\tfinal\taction\tsource\tcodex\tclaude\treason\tproposal\tnote\tbatch\n')
    for rid in rows:
        x, f = rows[rid], final[rid]
        extra = f.get('winner', '') or ('upheld' if f.get('upheld') else '')
        fh.write('\t'.join([rid, x['where'], x['kind'], x['what'], f['cls'], f['action'], f['source'] + (f'/{extra}' if extra else ''),
                            x['codex'], x['claude'], f['reason'], f['proposal'], f['note'], f['batch']]) + '\n')

C = collections.Counter
by_cls = C(f['cls'] for f in final.values()); by_act = C(f['action'] for f in final.values())
by_src = C(f['source'] for f in final.values())
grp = lambda rid: rid.split('-')[0][0]
lines = ['# Coverage triage after T: final (decision 79-4)', '',
         f'795 rows (A 218 = lost their last test in T; B 100 = lines T added or rewrote; C 477 = functions never executed, outside src/ui).', '',
         '## By class', '', '| class | rows | A | B | C |', '|---|---|---|---|---|']
for c in ['D1', 'D2', 'U', 'F', 'G', 'N', '待定']:
    n = [f for r, f in final.items() if f['cls'] == c]
    lines.append(f"| {c} | {len(n)} | {sum(1 for r in final if final[r]['cls']==c and grp(r)=='A')} | {sum(1 for r in final if final[r]['cls']==c and grp(r)=='B')} | {sum(1 for r in final if final[r]['cls']==c and grp(r)=='C')} |")
lines += ['', '## By action', ''] + [f'- {a}: {n}' for a, n in by_act.most_common()]
lines += ['', '## By source', ''] + [f'- {s}: {n}' for s, n in by_src.most_common()]
w = C(f.get('winner') for f in final.values() if f['source'] == 'judge')
lines += ['', f"Judge winners (167 rows): {dict(w)}", '']
tie = [(r, f) for r, f in final.items() if f['source'] == 'tiebreak']
lines += [f"Tiebreak ({len(tie)} challenged agreed rows): agreed class stands {sum(1 for r, f in tie if f['cls'] == rows[r]['codex'])}, changed {sum(1 for r, f in tie if f['cls'] != rows[r]['codex'])}"]
for r, f in tie:
    if f['cls'] != rows[r]['codex']: lines.append(f"  - {r} {rows[r]['where']}: {rows[r]['codex']} -> {f['cls']}")
lines += ['', '## Findings against T (all 8 clusters upheld by the verifier)', '']
seen = set()
for r, f in final.items():
    if f['source'] == 'verifier' and f['cluster'] not in seen:
        seen.add(f['cluster']); ids = [k for k, v in final.items() if v.get('cluster') == f['cluster']]
        lines.append(f"- {f['cluster']}: {', '.join(ids)} ({', '.join(sorted({final[k]['cls'] for k in ids}))}); upheld {f['upheld']}")
lines += ['', '## Delete candidates by file (D1/D2 delete, U delete-guard)', '']
files = C(rows[r]['where'].rsplit(':', 1)[0] for r, f in final.items() if f['action'] in ('delete', 'delete-guard'))
lines += [f'- {p}: {n}' for p, n in files.most_common()]
lines += ['', f'{len(files)} files.', '', '## Rows to look at (keep?, lead, pending)', '']
for r, f in final.items():
    if f['action'] in ('keep?', 'lead', 'pending'):
        lines.append(f"- {r} {rows[r]['where']} [{f['cls']} {f['action']}]: {f['proposal'][:220]}")
open(os.path.join(T, 'triage-final-summary.md'), 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
print(f'classes {dict(by_cls)}\nactions {dict(by_act)}\nsources {dict(by_src)}\ndelete files {len(files)}')
