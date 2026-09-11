import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path
base = Path(__file__).resolve().parent
root = base.parents[3]
labels = json.loads((base / "labels.json").read_text())
output = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "evidence/rat-00/bug-discovery"
output.mkdir(parents=True, exist_ok=True)
results = []
for item in labels["samples"]:
    command = item["evaluator"]["command"]
    command = shutil.which("node") if command == "{node}" else command
    args = [arg.replace("{evaluatorRoot}", str(base)).replace("{workspace}", str(base.parent / "public" / item["id"] / "workspace")) for arg in item["evaluator"]["args"]]
    with tempfile.TemporaryDirectory(prefix="rat00-bug-evaluator-") as temp:
        r = subprocess.run([command, *args], cwd=temp, capture_output=True, text=True, timeout=30, env={**os.environ, "PYTHONDONTWRITEBYTECODE":"1"})
    status = "resolved" if r.returncode == 0 else "unresolved" if r.returncode == 1 else "evaluator_error"
    results.append({"sampleId":item["id"],"expected":item["expectedEvaluatorStatus"],"actual":status,"pass":status == item["expectedEvaluatorStatus"],"stdout":r.stdout,"stderr":r.stderr})
report = {"schemaVersion":1,"kind":"known-positive-negative-baseline-check","modelCalls":0,"passed":sum(r["pass"] for r in results),"total":len(results),"results":results}
(output / "preflight.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n")
print(json.dumps({"passed":report["passed"],"total":report["total"],"modelCalls":0}))
raise SystemExit(0 if all(r["pass"] for r in results) else 1)
