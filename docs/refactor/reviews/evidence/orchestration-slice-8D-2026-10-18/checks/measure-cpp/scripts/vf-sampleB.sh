#!/bin/bash
# verifier: scenario B (source + build tree visible) on the 20-TU sample plus the two TUs the agent names (42, 765)
set -euo pipefail
W=$HOME/dsh-work/measure-cpp
S=/mnt/d/cc-lead-notes/impl/s8d/measure-cpp/scripts
DB=$W/build/cmake-3.30.5/compile_commands.json
R=$W/results/verify-cmsrc
AVAIL=$(free -m | awk '/Mem:/{print $7}'); echo "available MB $AVAIL"
if [ "$AVAIL" -lt 2000 ]; then echo STOP; exit 3; fi
IDX="$(cat $R/sample-indices.txt),42,765"
for MODE in light ref; do
  systemd-run --user --scope -q --unit=vf-sampleB-$MODE-$$ -p MemoryMax=4G \
    timeout 540 python3 -I $S/vf_scan.py --db "$DB" --root "$W" --file-list "$W/results/cmake-src/vfs-files-B.txt" \
    --mode $MODE --out "$R/sampleB-$MODE.ndjson" --indices "$IDX" --tag sampleB
done
python3 -I - "$R/sampleB-light.ndjson" "$R/sampleB-ref.ndjson" <<'PY'
import json, sys, collections
L = {r['i']: r for r in map(json.loads, open(sys.argv[1]))}
F = {r['i']: r for r in map(json.loads, open(sys.argv[2]))}
def edges(r):
    return {(d[0], d[1], d[4]) for d in r.get('directives', []) if d[0] and d[4] and not d[4].startswith('EXT:')}
tot = collections.Counter()
for i in sorted(L):
    l, f = L[i], F[i]
    if l['status'] != 'ok':
        print(i, l['status']); continue
    le, fe = edges(l), edges(f)
    ang = {(a[2], a[3]) for a in l['angled']}
    only_l = le - fe; only_f = fe - le
    only_l_ang = {e for e in only_l if (e[0], e[1]) in ang}
    tot['light'] += len(le); tot['ref'] += len(fe); tot['only_light'] += len(only_l); tot['only_ref'] += len(only_f); tot['only_light_angled'] += len(only_l_ang)
    mk = [m[0] for m in l['missing'] if m[0] is not None]; fk = min(mk) if mk else None
    before = [(fl, pf['first']) for fl, pf in l['per_file'].items() if pf['min_key'] is not None and (fk is None or pf['min_key'] < fk)]
    other = sorted(map(str, (only_l - only_l_ang) | only_f))[:3]
    print(i, l['tu'][-60:], 'edges L/R', len(le), len(fe), 'onlyL', len(only_l), '(angled', len(only_l_ang), ') onlyR', len(only_f),
          'first_missing_rank', l.get('first_missing_rank'), 'n_missing', l['n_missing'], 'n_angled', l['n_angled'], 'err_before_first_missing', before[:2], 'other', other)
print(dict(tot))
PY
