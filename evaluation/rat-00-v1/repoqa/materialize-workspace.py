#!/usr/bin/env python3
"""Create a new, single-task input tree. This does not launch or sandbox an agent."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

PACK = Path(__file__).resolve().parent

def materialize(task_id, destination):
    manifest = json.loads((PACK/'manifest.json').read_text())
    task = next((r for r in manifest['tasks'] if r['task_id'] == task_id), None)
    if task is None:
        raise ValueError('Unknown task ID')
    destination = Path(destination).absolute()
    destination.mkdir(parents=True, exist_ok=False)
    source = PACK/'agent-input/source'
    for record in manifest['repository']['source_tree']['files']:
        path = source/record['path']
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != record['sha256']:
            raise ValueError('Source digest or file type mismatch')
        target = destination/record['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path,target)
    prompt = PACK/task['prompt']
    if prompt.is_symlink() or hashlib.sha256(prompt.read_bytes()).hexdigest() != task['prompt_sha256']:
        raise ValueError('Prompt digest or file type mismatch')
    shutil.copyfile(prompt,destination/'TASK.md')
    files=[str(p.relative_to(destination)) for p in sorted(destination.rglob('*')) if p.is_file()]
    allowed=sorted([r['path'] for r in manifest['repository']['source_tree']['files']]+['TASK.md'])
    assert files == allowed
    return {'task_id':task_id,'workspace':str(destination),'file_count':len(files),'files':files,
            'hidden_material_included':False,'os_sandbox_enforced':False}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task-id',required=True)
    parser.add_argument('--destination',required=True)
    args=parser.parse_args()
    print(json.dumps(materialize(args.task_id,args.destination),indent=2))
