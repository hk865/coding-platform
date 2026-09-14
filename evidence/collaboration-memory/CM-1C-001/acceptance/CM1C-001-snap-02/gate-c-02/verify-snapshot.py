import json,hashlib,pathlib,subprocess,re
root=pathlib.Path('/mnt/d/1.project/Software/agent_platform')
pack=root/'evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-02'
snapshot=json.loads((pack/'source-snapshot.json').read_text('utf-8-sig'))
errors=[]
files=set(subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')+subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z'],cwd=root).decode().split('\0'))
def included(p):
 return bool(p) and not re.search(r'(^|/)(node_modules|dist|coverage|\.local|\.git)(/|$)',p) and not p.startswith('evidence/') and (re.match(r'^(src|tests|scripts|vendor/coding-agent)/',p) or re.match(r'^[^/]+\.(json|ya?ml|mjs|ts)$',p) or p in ['.gitignore','.gitattributes'])
actual=sorted(p for p in files if included(p));fold=hashlib.sha256()
if actual!=sorted(snapshot['fileHashes']):errors.append('file-set mismatch')
for p in actual:
 h=hashlib.sha256((root/p).read_bytes()).hexdigest() if (root/p).exists() else 'deleted'
 fold.update((p+'\0'+h+'\n').encode())
 if h!=snapshot['fileHashes'].get(p):errors.append('working '+p)
 saved=pack/'source-files'/p
 if h!='deleted' and (not saved.exists() or hashlib.sha256(saved.read_bytes()).hexdigest()!=h):errors.append('saved '+p)
doc=json.loads((pack/'documents.json').read_text('utf-8-sig'))
for p,h in doc.items():
 if hashlib.sha256((pack/'documents'/p).read_bytes()).hexdigest()!=h:errors.append('document '+p)
print(json.dumps({'files':len(actual),'fingerprint':fold.hexdigest(),'expected':snapshot['sourceFingerprintSha256'],'documents':len(doc),'productHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),'docsHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd='/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform').decode().strip(),'errors':errors},indent=2))
assert not errors and len(actual)==1289 and fold.hexdigest()==snapshot['sourceFingerprintSha256']

