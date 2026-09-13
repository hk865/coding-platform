import pathlib,json,hashlib
root=pathlib.Path('/mnt/d/1.project/Software/agent_platform'); pack=root/'evidence/collaboration-memory/CM-M06-001/implementation/CMM06-001-snap-01'
origin=json.loads((pack/'build-origin.json').read_text('utf-8-sig')); errors=[]; fold=hashlib.sha256()
for p,h in sorted(origin['files'].items()):
 actual=hashlib.sha256((root/p).read_bytes()).hexdigest()
 if actual!=h:errors.append(p)
 fold.update((p+'\0'+actual+'\n').encode())
logs={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (pack/'logs').iterdir() if p.is_file()}
rc=(pack/'logs/full-regression.exit-code').read_text().strip()
print(json.dumps({'buildFiles':len(origin['files']),'buildFingerprint':fold.hexdigest(),'expected':origin['sha256'],'sourceFingerprint':origin['sourceFingerprintSha256'],'fullExit':rc,'logHashes':logs,'errors':errors},indent=2))
assert not errors and len(origin['files'])==650 and fold.hexdigest()==origin['sha256'] and rc=='0'
