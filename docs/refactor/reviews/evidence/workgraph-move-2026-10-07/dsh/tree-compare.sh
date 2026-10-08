#!/usr/bin/env bash
# tree-compare.sh <out-dir>: TASK-D-PLAN §6.2/§6.6 — read-only comparison of DSH's copy LTd-1 with the reference copy
# LTd-ref: setup trees, sha256 of every file outside .git and node_modules, frozen test files.
set -uo pipefail
L=~/dsh-work/ladder; OUT=$1
for c in LTd-1 LTd-ref; do echo "$c setup tree $(git -C $L/$c rev-parse 'ladder-setup^{tree}') head $(git -C $L/$c rev-parse HEAD)"; done > $OUT/tree-compare.txt
for c in LTd-1 LTd-ref; do (cd $L/$c && find . -path ./.git -prune -o -path ./node_modules -prune -o -path ./vendor/coding-agent/node_modules -prune -o -type f -print0 | sort -z | xargs -0 sha256sum) > $OUT/files-$c.sha256; done
wc -l $OUT/files-LTd-1.sha256 $OUT/files-LTd-ref.sha256 >> $OUT/tree-compare.txt
if cmp -s $OUT/files-LTd-1.sha256 $OUT/files-LTd-ref.sha256; then echo "ALL FILES IDENTICAL (outside .git/node_modules)" >> $OUT/tree-compare.txt; else echo "FILES DIFFER" >> $OUT/tree-compare.txt; diff $OUT/files-LTd-1.sha256 $OUT/files-LTd-ref.sha256 | head -40 >> $OUT/tree-compare.txt; fi
# test files that the move must not touch: every tests/ file not in expected.json keeps the blob of the setup commit
node -e '
const fs=require("fs"),cp=require("child_process");
const exp=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const touched=new Set(exp.files.map(f=>f.path).concat(exp.files.map(f=>f.from).filter(Boolean)));
const C=process.argv[2];
const setup=cp.execSync("git -C "+C+" ls-tree -r ladder-setup -- tests",{encoding:"utf8"}).trim().split("\n").map(l=>{const [m,t,h]=l.split(/\s+/);return [l.split("\t")[1],h];});
let same=0,diff=[];
for(const [p,h] of setup){ if(touched.has(p)) continue; const now=cp.execSync("git -C "+C+" hash-object "+p,{encoding:"utf8"}).trim(); if(now===h) same++; else diff.push(p); }
console.log("untouched tests/ files with the setup blob: "+same+"; changed: "+diff.length+(diff.length?" "+diff.join(" "):""));
' $L/LTd/data/expected.json $L/LTd-1 >> $OUT/tree-compare.txt
git -C $L/LTd-1 status --porcelain --ignored --untracked-files=all | grep -v '^!! node_modules/$' | grep -v '^!! vendor/coding-agent/node_modules/$' | grep -c . | sed 's/^/status entries other than the two node_modules: /' >> $OUT/tree-compare.txt
cat $OUT/tree-compare.txt
