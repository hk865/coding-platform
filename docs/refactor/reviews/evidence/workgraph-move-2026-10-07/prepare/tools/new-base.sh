#!/usr/bin/env bash
# new-base.sh <H full sha>   (WSL; TASK-D-PLAN §2 step 2)
# Keeps the ladder's old base as ~/dsh-work/base-bfb6075 (read-only) and builds ~/dsh-work/base from H the way the old
# one was built: git archive of H (from the WSL slot s1 clone, which has H), node_modules (copied from the old base;
# package-lock.json and vendor/coding-agent/package-lock.json are identical at bfb6075 and H), and one commit
# "baseline <H>" by base <base@localhost>. Its tree must equal H's tree. sync.sh locks it read-only afterwards.
set -euo pipefail
. "$HOME/dsh-work/ladder/_common/env.sh"
H=$1
SLOTGIT=$HOME/cc-work/slot-s1
OLD=$HOME/dsh-work/base-bfb6075
[ "$(git -C "$BASE" log -1 --format=%s)" = "baseline bfb607599e3cafb9cd8706977fcc80a251746c1c" ] || { echo "base is not the bfb6075 base" >&2; exit 2; }
[ -e "$OLD" ] && { echo "$OLD exists" >&2; exit 2; }
want=$(git -C "$SLOTGIT" rev-parse "$H^{tree}")
chmod u+w "$BASE"
mv "$BASE" "$OLD"
chmod a-w "$OLD"
mkdir "$BASE"
git -C "$SLOTGIT" archive "$H" | tar -x -C "$BASE"
cp -a "$OLD/node_modules" "$BASE/"
chmod -R u+w "$BASE/node_modules"
cd "$BASE"
git init -q
git add -A
git -c user.name=base -c user.email=base@localhost commit -q -m "baseline $H"
got=$(git rev-parse HEAD^{tree})
echo "old base: $OLD (tree $(git -C "$OLD" rev-parse HEAD^{tree}))"
echo "new base: $BASE commit $(git rev-parse HEAD) tree $got; H tree $want"
[ "$got" = "$want" ] || { echo "TREE MISMATCH" >&2; exit 3; }
echo "ignored at base (without node_modules): $(git status --porcelain --ignored | grep -v node_modules | wc -l)"
du -sh "$BASE" "$OLD"
