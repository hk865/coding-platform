"""Install pinned pure-Python analyzer wheels under .local; no system packages."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

root = Path(__file__).resolve().parent.parent / '.local' / 'source-analyzers' / 'packages'
root.mkdir(parents=True, exist_ok=True)
manifest = []
for name, version in [('jedi', '0.19.2'), ('parso', '0.8.4')]:
    with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json', timeout=30) as response:
        metadata = json.load(response)
    wheel = next(item for item in metadata['urls'] if item['filename'].endswith('py2.py3-none-any.whl'))
    with urllib.request.urlopen(wheel['url'], timeout=60) as response:
        data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != wheel['digests']['sha256']:
        raise ValueError('wheel checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            target = (root / info.filename).resolve()
            if not target.is_relative_to(root.resolve()) or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('unsafe wheel path')
        archive.extractall(root)
    manifest.append({'name': name, 'version': version, 'filename': wheel['filename'], 'sha256': digest})
(root.parent / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
import runpy
runpy.run_path(str(Path(__file__).with_name('package-source-analyzers.py')), run_name='__main__')
