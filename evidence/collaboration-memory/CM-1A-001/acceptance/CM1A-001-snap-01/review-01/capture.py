import hashlib, json, pathlib, subprocess, sys, datetime
root = pathlib.Path.cwd()
out = pathlib.Path(__file__).parent
def git(*args, cwd=root):
    return subprocess.check_output(['git', *args], cwd=cwd)
paths = set(git('ls-files','-z').decode().split('\0') + git('ls-files','--others','--exclude-standard','-z').decode().split('\0'))
items = []
for p in sorted(paths):
    parts = pathlib.PurePosixPath(p).parts
    if not parts or any(x in parts for x in ['node_modules','dist','coverage','.local','.git']): continue
    if not (p.startswith(('src/','tests/','scripts/','vendor/coding-agent/')) or (len(parts)==1 and (pathlib.Path(p).suffix in ['.json','.yaml','.yml','.mjs','.ts'] or p in ['.gitignore','.gitattributes']))): continue
    h = hashlib.sha256((root/p).read_bytes()).hexdigest() if (root/p).is_file() else 'deleted'
    items.append({'path':p,'sha256':h})
digest = hashlib.sha256(''.join(x['path']+'\0'+x['sha256']+'\n' for x in items).encode()).hexdigest()
docs=root.parent/'agent_learn/agent_dev/agent_platform'
data={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':git('rev-parse','HEAD').decode().strip(),'docsHead':git('rev-parse','HEAD',cwd=docs).decode().strip(),'sourceFileCount':len(items),'sourceFingerprintSha256':digest,'files':items}
(out/('snapshot-'+sys.argv[1]+'.json')).write_text(json.dumps(data,indent=2),encoding='utf-8')
(out/('status-'+sys.argv[1]+'.txt')).write_bytes(git('status','--short','--untracked-files=all'))
print(json.dumps({k:v for k,v in data.items() if k!='files'},indent=2))
