import argparse, hashlib, json, shutil
from pathlib import Path
p = argparse.ArgumentParser(description="Copy only one task prompt and its allowed source; no model execution")
p.add_argument("group", choices=["canary", "bug-discovery"])
p.add_argument("task_id")
p.add_argument("destination", type=Path)
args = p.parse_args()
root = Path(__file__).resolve().parents[3]
if args.destination.exists(): raise SystemExit("Destination already exists; each trial needs a fresh directory")
if args.group == "canary":
    tasks = root / ".local/evaluation/rat-00/kernel-baseline/benchmarks/tasks"
    allowed = {"node-bearer-auth","python-slug-normalization","recovery-exactly-once","ts-nullish-timeout"}
    if args.task_id not in allowed: raise SystemExit("Unknown task")
    task = tasks / args.task_id
    source = task / "workspace/base"
    prompt = task / "instruction.md"
else:
    task = root / "evaluation/rat-00-v1/bug-discovery/public" / args.task_id
    if args.task_id not in {f"BD-{i:02d}" for i in range(1,9)}: raise SystemExit("Unknown sample")
    source = task / "workspace"
    prompt = task / "instruction.md"
for file in source.rglob("*"):
    if file.is_symlink(): raise SystemExit("Source symlinks are not allowed")
    if file.is_file() and any(part in {"oracle","hidden_tests","evaluator-only","private",".git"} for part in file.relative_to(source).parts): raise SystemExit("Unexpected hidden source path")
shutil.copytree(source, args.destination)
shutil.copy2(prompt, args.destination / "TASK.md")
entries = [{"path":str(f.relative_to(args.destination)),"sha256":hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(args.destination.rglob("*")) if f.is_file()]
print(json.dumps({"group":args.group,"taskId":args.task_id,"destination":str(args.destination),"visibleFiles":entries,"modelCalls":0},ensure_ascii=False))
