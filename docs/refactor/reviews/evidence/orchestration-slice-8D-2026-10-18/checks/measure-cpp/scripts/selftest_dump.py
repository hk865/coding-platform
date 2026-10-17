"""Dump selected self-test records compactly.  python3 -I selftest_dump.py NDJSON MODE TU_SUBSTRING..."""
import json
import sys

path, mode, subs = sys.argv[1], sys.argv[2], sys.argv[3:]
for line in open(path):
    r = json.loads(line)
    if r['mode'] != mode or not any(s in (r.get('tu') or '') for s in subs):
        continue
    print('##', r['tu_rel'], r['status'], 'parse_ms', r.get('parse_ms'), 'rss', r.get('peak_rss_kb'), 'reset', r.get('peak_reset'))
    for x in r.get('inclusions', []):
        print('  inc', x['file'].split('selftest/')[-1], x['line'], x['kind'], repr(x['spelled']), x['delim'], 'macro' if x['via_macro'] else '',
              '->', (x['resolved'] or 'NULL').split('selftest/')[-1], 'body=%s' % x['in_function_body'], 'pos', x['pos'])
    for d in r.get('diagnostics', []):
        print('  diag emit=%d' % d['emit'], (d['file'] or '-').split('selftest/')[-1], d['line'], d['severity'], d['category'], '|', d['spelling'][:70],
              '| fnf=%s' % d['file_not_found'], 'pos', d['pos'])
    if r.get('skipped_ranges'):
        print('  skipped', [(s['file'].split('selftest/')[-1], s['start_line'], s['end_line']) for s in r['skipped_ranges']])
    if r.get('unresolved_positions'):
        print('  unresolved_positions', r['unresolved_positions'])
    print('  entered', [p.split('selftest/')[-1] for p in r.get('entered_project', [])], 'external', r.get('entered_external_count'),
          'extents', r.get('function_extents'), 'cursors', r.get('cursor_counts'), 'sev', r.get('severity_counts'))
    af = r.get('arg_filter', {})
    if af.get('dropped') or af.get('unknown'):
        print('  kept', af.get('kept'))
        print('  dropped', [(d['flag'], d['values'], d['affects']) for d in af['dropped']])
        print('  unknown', [(d['flag'], d['values'], d['reason']) for d in af['unknown']])
