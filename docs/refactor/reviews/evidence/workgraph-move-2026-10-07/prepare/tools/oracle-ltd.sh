# Oracle pair of LTd (task D at H, TASK-D-PLAN §2 step 9): the reference move must pass LTd/check.sh and a fresh copy
# must fail it. The reference copy is kept as $L/LTd-ref (TASK-D-PLAN §6 step 2 compares DSH's tree with it byte for
# byte); its patch is written to LTd-ref.patch in the scratchpad _results/. Run on a quiet machine (two full suites).
. "$(dirname "$0")/oracle-lib.sh"
O=$(oracle_dir LTd)
fresh $L/LTd-ref LTd
node $O/wg-move.mjs $L/LTd-ref $L/LTd/data/moves.json > $R/LTd-ref.wg-move.json
git -C $L/LTd-ref diff -M --binary HEAD > $R/LTd-ref.patch
git -C $L/LTd-ref status --short > $R/LTd-ref.status.txt
git -C $L/LTd-ref diff -M HEAD --numstat > $R/LTd-ref.numstat.txt
run_check LTd-oracle LTd $L/LTd-ref
fresh $L/LTd-fresh LTd
node $COMMON/canary-check.mjs $L/LTd-fresh $L/LTd > $R/LTd-canary.json
run_check LTd-fresh LTd $L/LTd-fresh
drop_copy $L/LTd-fresh
rm -rf "$(dirname $O)"
echo oracle-ltd-done
