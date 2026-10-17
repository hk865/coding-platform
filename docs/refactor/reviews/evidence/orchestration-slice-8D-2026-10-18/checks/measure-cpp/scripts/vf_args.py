#!/usr/bin/env python3
"""Verifier: argument inventory of a compile_commands.json, and what today's adapter (cpp-source-query.py:120-206,
re-implemented here from reading it) would raise first for each entry.

Run only as: python3 -I vf_args.py DB SRC_ROOT
"""
import collections, json, os, re, shlex, sys

db = json.load(open(sys.argv[1]))
root = os.path.realpath(sys.argv[2])
spell = collections.Counter(); tus_with = collections.defaultdict(set)
first_raise = collections.Counter(); first_raise_ex = {}
outside_I = 0; tus_outside = set(); dup = collections.defaultdict(list)
compiler_ext = collections.Counter()
for k, e in enumerate(db):
    raw = shlex.split(e['command']) if 'command' in e else e['arguments']
    d = e['directory']
    src = os.path.normpath(os.path.join(d, e['file']))
    comp = os.path.basename(raw[0]); ext = os.path.splitext(src)[1]
    compiler_ext[(comp, ext)] += 1
    i = 1
    raised = None
    args_identity = []
    while i < len(raw):
        a = raw[i]
        key = a
        if a in ('-o', '-MF', '-MT', '-MQ'):
            key = a + ' <1>'; i += 2; spell[key] += 1; tus_with[key].add(k); continue
        m = re.match(r'(-isystem|-iquote|-include|-imacros|-I|-D|-U)(.*)', a)
        if m and (m.group(2) or a in ('-isystem', '-iquote', '-include', '-imacros', '-I', '-D', '-U')) and (m.group(1) in ('-I', '-D', '-U') or not m.group(2)):
            opt = m.group(1)
            v = m.group(2) if m.group(2) else raw[i + 1]
            i += 1 if m.group(2) else 2
            if opt in ('-I', '-isystem', '-iquote', '-include', '-imacros'):
                p = os.path.normpath(os.path.join(d, v))
                inside = p == root or p.startswith(root + '/')
                key = '%s (%s)' % (opt, 'inside' if inside else 'outside')
                if not inside:
                    outside_I += 1; tus_outside.add(k)
                    if raised is None:
                        raised = 'External compilation paths (%s)' % opt
                args_identity += [opt, p]
            else:
                key = opt; args_identity += [opt, v]
            spell[key] += 1; tus_with[key].add(k); continue
        if not a.startswith('-'):
            i += 1; continue
        spell[a] += 1; tus_with[a].add(k)
        ok = a in ('-c', '-MMD', '-MD', '-MP', '-pipe') or re.fullmatch(r'-std=(?:c|gnu)(?:\+\+)?[0-9a-z]+', a) or re.fullmatch(r'-O[0-3szg]', a) \
            or re.fullmatch(r'-g(?:[0-3]|dwarf-[2-5])?', a) or re.fullmatch(r'-W(?:no-)?[A-Za-z0-9=-]+', a) \
            or a in ['-pthread', '-m32', '-m64', '-fshort-wchar', '-fno-exceptions', '-fexceptions', '-fno-rtti', '-frtti', '-fms-extensions',
                     '-fms-compatibility', '-fPIC', '-fpic', '-fPIE', '-fpie', '-fno-builtin', '-funsigned-char', '-fsigned-char', '-nostdinc', '-nostdinc++']
        if not ok and raised is None:
            raised = 'Unsupported compiler option: ' + a
        if a != '-c':
            args_identity.append(a)
        i += 1
    first_raise[raised] += 1
    first_raise_ex.setdefault(raised, src)
    dup[src].append(json.dumps(args_identity))
print('entries', len(db), '(adapter cap 512 -> whole query Unsupported:', len(db) > 512, ')')
print('compiler/extension', dict(compiler_ext))
print('flag spellings (occurrences / TUs):')
for s, n in spell.most_common():
    print('  %-28s %5d %5d' % (s, n, len(tus_with[s])))
print('outside-root path options', outside_I, 'in TUs', len(tus_outside))
print('adapter: first raise per entry', dict(first_raise))
d2 = {s: v for s, v in dup.items() if len(v) > 1}
print('sources with >1 entry', len(d2), 'with differing args', sum(1 for v in d2.values() if len(set(v)) > 1))
print('  examples', [(os.path.relpath(s, root) if s.startswith(root) else s, len(v)) for s, v in list(d2.items())[:8]])
