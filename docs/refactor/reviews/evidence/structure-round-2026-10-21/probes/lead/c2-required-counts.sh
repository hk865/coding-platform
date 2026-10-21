#!/bin/bash
# R1-01 (rework 1's C2 probe): count each REQUIRED probe, declared here independently of what base-run1 captured,
# over the seven proof files of each round (base-run1, base-run2, result-run1). Any zero fails. (lead, 2026-10-21)
# Required, from book §5.3 and rework 1's table: the four wrapped record ports (activity, track, timeline; the
# calendar and the Run list share the activity port), the calendar clock, and the four loops' results.
P=/home/han001/dsh-work/slices/s9s85r1/.dsh-scratch/R1/probes/c2/logs
REQ="activity calendar track timeline calendar-result run-result track-result timeline-result"
fail=0
printf '%-16s %10s %10s %10s\n' tag base-run1 base-run2 result-run1
for t in $REQ; do
  row=$(printf '%-16s' "$t")
  for r in base-run1 base-run2 result-run1; do
    n=$(cat $(ls $P/$r/*.log | grep -v /_combined.log) | awk -F'\t' -v t="$t" '$2 == t' | wc -l)
    row="$row $(printf '%10s' "$n")"; [ "$n" -gt 0 ] || fail=1
  done
  echo "$row"
done
echo "tags present but not declared:"; cat $(ls $P/*/*.log | grep -v /_combined.log) | awk -F'\t' '{print $2}' | sort -u | grep -vxF -f <(echo $REQ | tr ' ' '\n') || echo "  (none)"
[ $fail = 0 ] && echo "RESULT: every required probe captured on every round" || { echo "RESULT: a required probe captured nothing"; exit 1; }
