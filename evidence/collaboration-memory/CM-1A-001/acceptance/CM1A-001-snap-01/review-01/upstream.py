import hashlib, json, pathlib, datetime
root=pathlib.Path.cwd()
docs=root.parent/'agent_learn/agent_dev/agent_platform'
manifest=docs/'dev_docs/planning/active/collaboration-memory/baseline/upstream-documents.json'
original=json.loads(manifest.read_text())
entries=[]
for e in original['entries']:
    p=(docs if e['repository']=='docs' else root)/e['path']
    actual=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else 'missing'
    entries.append({**e,'actualSha256':actual,'matches':actual==e['sha256']})
out=pathlib.Path(__file__).parent/'upstream-current.json'
out.write_text(json.dumps({'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'manifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest(),'entries':entries},indent=2),encoding='utf-8')
print(json.dumps([e for e in entries if not e['matches']],indent=2))
