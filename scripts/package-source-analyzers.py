"""Bundle local pure-Python dependencies for fast isolated startup on mounted workspaces."""
import hashlib
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent / '.local' / 'source-analyzers'
target = root / 'analyzers.zip'
with zipfile.ZipFile(target.with_suffix('.tmp'), 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for source in sorted((root / 'packages').rglob('*')):
        if source.is_file() and not source.is_symlink() and '__pycache__' not in source.parts:
            archive.write(source, source.relative_to(root / 'packages').as_posix())
target.with_suffix('.tmp').replace(target)
digest = hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix('.sha256').write_text(digest + '\n')
print('analyzer bundle sha256=' + digest)
