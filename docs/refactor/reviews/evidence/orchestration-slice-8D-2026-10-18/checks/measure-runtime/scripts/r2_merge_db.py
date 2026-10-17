"""Merge per-package CMake compile databases into one workspace database.

Usage: python3 -I merge_db.py <out.json> <in1.json> [<in2.json> ...]
CMake's Makefiles generator writes "command"; each entry is rewritten as
{"directory", "arguments", "file", "output"} with arguments = shlex.split(command).
Nothing else changes (order of entries and of arguments is kept).
"""
import json
import shlex
import sys


def main(argv):
    out, inputs = argv[1], argv[2:]
    merged = []
    for path in inputs:
        with open(path, encoding='utf-8') as fh:
            entries = json.load(fh)
        for entry in entries:
            args = entry.get('arguments')
            if args is None:
                args = shlex.split(entry['command'], posix=True)
            row = {'directory': entry['directory'], 'arguments': args, 'file': entry['file']}
            if 'output' in entry:
                row['output'] = entry['output']
            merged.append(row)
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(merged, fh, indent=2)
        fh.write('\n')
    files = [e['file'] for e in merged]
    print('entries', len(merged), 'distinct files', len(set(files)))


if __name__ == '__main__':
    main(sys.argv)
