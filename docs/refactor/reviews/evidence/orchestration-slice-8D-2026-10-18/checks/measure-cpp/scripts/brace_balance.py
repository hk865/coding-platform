#!/usr/bin/env python3
"""Exploratory check (not a candidate from the draft): is each file's raw '{' / '}' count balanced?

Run only as: python3 -I brace_balance.py --root ROOT [--inject-dir DIR]
A small lexer drops // and /* */ comments, "..." strings, '...' character literals and R"d(...)d" raw strings,
then counts braces over the whole file text (inactive #if branches included, so a file whose branches carry
different braces would show as unbalanced).  Prints the unbalanced claimed files under ROOT, and with
--inject-dir the balance of every injected target file (manifest.json).
"""
import argparse
import json
import os
import re

EXTS = {'.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx', '.h++', '.inl', '.ipp', '.tcc', '.txx', '.inc', '.def'}
RAW_RE = re.compile(r'R"([^ ()\\\t\n]{0,16})\(')


def balance(text):
    i, n, depth, low = 0, len(text), 0, 0
    while i < n:
        c = text[i]
        if text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
            continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        m = RAW_RE.match(text, i) if c == 'R' else None
        if m and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] == '_')):
            end = text.find(')' + m.group(1) + '"', m.end())
            i = n if end < 0 else end + len(m.group(1)) + 2
            continue
        if c == '"' or (c == "'" and not (i > 0 and text[i - 1].isalnum())):  # 1'000 digit separators are not literals
            j = i + 1
            while j < n and text[j] != c and text[j] != '\n':
                j += 2 if text[j] == '\\' else 1
            i = j + 1
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            low = min(low, depth)
        i += 1
    return depth, low


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--inject-dir')
    a = ap.parse_args()
    root = os.path.realpath(a.root)
    total, bad = 0, []
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d != '.git']
        for f in files:
            if os.path.splitext(f)[1].lower() in EXTS:
                total += 1
                path = os.path.join(current, f)
                depth, low = balance(open(path, encoding='utf-8', errors='replace').read())
                if depth or low < 0:
                    bad.append((os.path.relpath(path, root), depth, low))
    print(json.dumps({'claimed_files': total, 'unbalanced': bad}))
    if a.inject_dir:
        manifest = json.load(open(os.path.join(a.inject_dir, 'manifest.json'), encoding='utf-8'))
        for t in manifest['targets']:
            path = os.path.join(t['ws'], t['file'])
            depth, low = balance(open(path, encoding='utf-8', errors='replace').read())
            print('%s %-6s %-40s final_depth=%d min_depth=%d -> %s' % (t['id'], t['role'], t['file'].split('/')[-1], depth, low,
                                                                       'unbalanced' if depth or low < 0 else 'balanced'))


if __name__ == '__main__':
    main()
