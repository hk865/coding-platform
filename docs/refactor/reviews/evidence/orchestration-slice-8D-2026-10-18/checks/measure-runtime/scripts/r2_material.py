#!/usr/bin/env python3
"""Frozen-material lists for the libuv measurement (draft 4 sections 11.4 / 11.5 and section 10 rule 1).

Run only as:  python3 -I uv_material.py ROOT GIT_LIST_Z OUT_PREFIX
  ROOT        workspace root (data only; nothing in it is executed or imported)
  GIT_LIST_Z  NUL-separated paths relative to ROOT that git does NOT ignore (git ls-files --others --exclude-standard -z)
  OUT_PREFIX  writes OUT_PREFIX.vfs.txt (scanner VFS: claimed C/C++ files + include-only text files: .def and
              extension-less), OUT_PREFIX.claimed.txt (claimed C/C++ files, L12 extensions case-insensitive),
              OUT_PREFIX.stats.json
Material rules: regular files only (symlinks are 'absent'), at most 2 MiB, no NUL byte.
"""
import collections
import json
import os
import sys

CLAIMED = {'.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc'}  # architecture-language-provider.ts:60
MAX = 2 * 1024 * 1024


def main():
    root, git_list, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(git_list, 'rb') as handle:
        paths = sorted(p.decode('utf-8', 'surrogateescape') for p in handle.read().split(b'\0') if p)
    stats = collections.Counter()
    vfs, claimed, skipped = [], [], []
    for rel in paths:
        full = os.path.join(root, rel)
        name = rel.rsplit('/', 1)[-1]
        ext = os.path.splitext(name)[1].lower()
        is_claimed = ext in CLAIMED
        include_only = (ext == '.def') or ('.' not in name)
        if not (is_claimed or include_only):
            stats['other_files'] += 1
            continue
        if os.path.islink(full) or not os.path.isfile(full):
            stats['not_regular'] += 1
            continue
        size = os.path.getsize(full)
        with open(full, 'rb') as handle:
            data = handle.read()
        if size > MAX or b'\0' in data:
            stats['skipped_size_or_binary'] += 1
            if is_claimed:
                skipped.append(rel)
            continue
        vfs.append(rel)
        if is_claimed:
            claimed.append(rel)
            stats['claimed'] += 1
            stats['claimed_lines'] += data.count(b'\n')
        else:
            stats['include_only'] += 1
    with open(prefix + '.vfs.txt', 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(vfs) + '\n')
    with open(prefix + '.claimed.txt', 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(claimed) + '\n')
    stats['git_not_ignored_files'] = len(paths)
    by_dir = collections.Counter(p.split('/')[0] if '/' in p else '.' for p in claimed)
    by_ext = collections.Counter(os.path.splitext(p)[1].lower() for p in claimed)
    out = dict(stats, claimed_by_top_dir=dict(by_dir), claimed_by_ext=dict(by_ext), skipped_claimed=skipped)
    with open(prefix + '.stats.json', 'w', encoding='utf-8') as handle:
        json.dump(out, handle, indent=1)
    print(json.dumps(out))


if __name__ == '__main__':
    main()
