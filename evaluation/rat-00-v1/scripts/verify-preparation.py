import hashlib, json, subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[3]
assets = root / "evaluation/rat-00-v1"
index = json.loads((assets / "asset-index.json").read_text())
errors = []
for item in index["files"]:
    file = assets / item["path"]
    if not file.is_file() or file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
        errors.append("Asset changed or missing: " + item["path"])
expected = {r["path"] for r in index["files"]} | {"asset-index.json"}
actual = {str(f.relative_to(assets)) for f in assets.rglob("*") if f.is_file() and "__pycache__" not in f.parts}
if actual != expected: errors.append("Asset file set changed")
source = json.loads((root / "evidence/rat-00/source-baseline.json").read_text())
baseline = Path(source["snapshotRoot"])
revision = subprocess.run(["git","rev-parse","HEAD"],cwd=baseline,capture_output=True,text=True)
status = subprocess.run(["git","status","--porcelain"],cwd=baseline,capture_output=True,text=True)
if revision.returncode or revision.stdout.strip()!=source["kernelSnapshotCommit"] or status.returncode or status.stdout.strip(): errors.append("Kernel baseline no longer matches clean frozen commit")
for item in source["kernelFiles"]:
    file = baseline/item["path"]
    if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest()!=item["sha256"]: errors.append("Kernel snapshot content changed: "+item["path"])
manifest=json.loads((assets/"benchmark-task-manifest.json").read_text())
modelBound=all(manifest["executionBinding"].get(k) is not None for k in ["provider","model","costCapUsd"])
report={"preparationIntegrity":"PASS" if not errors else "FAIL","checkedAssets":len(index["files"]),"kernelSnapshotCommit":source["kernelSnapshotCommit"],"realExecutionReady":False,"modelBindingPresent":modelBound,"realExecutionBlockers":manifest["executionBlockers"],"errors":errors}
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(1 if errors else 0)
