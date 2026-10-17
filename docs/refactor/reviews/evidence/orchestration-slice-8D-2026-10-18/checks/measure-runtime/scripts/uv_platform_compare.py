#!/usr/bin/env python3
"""Compare the platform-experiment edges with the real light scan.

Run only as:  python3 -I uv_platform_compare.py A-eval.json P-linux-eval.json P-win-eval.json P-darwin-eval.json OUT.json
"""
import collections
import json
import sys


def d(p):
    return p.rsplit('/', 1)[0] if '/' in p else '.'


def main():
    base = json.load(open(sys.argv[1], encoding='utf-8'))
    runs = {name: json.load(open(p, encoding='utf-8')) for name, p in zip(['linux', 'win', 'darwin'], sys.argv[2:5])}
    A = {tuple(e) for e in base['edge_list']}
    A_dirs = {(d(f), d(t)) for f, t in A}
    skipped = set(base['skipped_files'])
    out = {}
    union = set()
    for name, r in runs.items():
        E = {tuple(e) for e in r['edge_list']}
        new = E - A
        union |= new
        reached = {f for f in skipped if r['claimed_status'] and f not in r['skipped_files']}
        out[name] = {'edges': len(E), 'new_edges': len(new), 'new_dir_pairs': sorted({(d(f), d(t)) for f, t in new} - A_dirs),
                     'skipped_files_now_read': len(reached), 'skipped_files_still_unread': sorted(skipped - reached),
                     'failed': r['failed_files']}
    sets = {name: {tuple(e) for e in r['edge_list']} - A for name, r in runs.items()}
    out['union_new_edges'] = len(union)
    out['only_win'] = sorted(sets['win'] - sets['linux'] - sets['darwin'])
    out['only_darwin'] = sorted(sets['darwin'] - sets['linux'] - sets['win'])
    out['only_linux'] = sorted(sets['linux'] - sets['win'] - sets['darwin'])
    out['textual_estimate_pairs'] = base['never_compiled']['textual_edges_to_material']
    by_dir = collections.Counter(d(f) for f, t in union)
    out['union_new_edges_by_from_dir'] = dict(sorted(by_dir.items()))
    json.dump(out, open(sys.argv[5], 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    for name in runs:
        o = out[name]
        print(name, 'edges', o['edges'], 'new', o['new_edges'], 'skipped files now read', o['skipped_files_now_read'],
              'still unread', o['skipped_files_still_unread'], 'failed', o['failed'])
    print('union new edges', len(union), 'textual estimate', out['textual_estimate_pairs'])
    print('only win', out['only_win'])
    print('only darwin', out['only_darwin'])
    print('only linux', out['only_linux'])
    print('new edges by from-dir', out['union_new_edges_by_from_dir'])
    print('new dir pairs (win)', out['win']['new_dir_pairs'])


if __name__ == '__main__':
    main()
