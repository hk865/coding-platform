#!/usr/bin/env python3
"""Checker: print the pair lists from runtime-check.json (own output) for the write-up.
Usage: python3 -I check_slam_view.py <runtime-check.json>"""
import json, sys
d = json.load(open(sys.argv[1]))
print('endpoints', d['topic_endpoints'], 'site pairs', d['topic_site_pairs'])
for t in d['topic_site_pair_list']: print('  S', t)
for k, v in d['topic_file_pairs'].items(): print('T', k, v)
print('code-code', d['topic_code_code_file_pairs'])
for k, v in d['launch_pairs'].items(): print('L', k, v)
for k, v in d['param_pairs'].items(): print('P', k, v)
for k, v in d['tf_dup_pairs'].items(): print('TF', k, v)
print(json.dumps(d['summary'], indent=0))
for k, v in d['extra_not_in_35'].items(): print('X', k, v)
print('extra new', d['extra_new_vs_35'])
for k, v in d['package_relations'].items(): print('PK', k, v)
print('PK total', len(d['package_relations']), 'with light edge', sum(1 for v in d['package_relations'].values() if any(x.startswith('light') for x in v)))
print('package.xml own-dep pairs (directed)', sum(1 for v in d['package_relations'].values() for x in v if x.startswith('package.xml')))
print(d['missing_own_deps'])
print({k: d['param_yaml_detail'][k] for k in d['param_yaml_detail'] if 'nav2' not in k and 'octomap' not in k})
for r in d['cpp_sites']['create_subscription']: print('CSUB', r['file'], r['line'], r.get('how'), r.get('values_in_yaml'))
for r in d['tf']: print('TFsite', r)
for k in ('create_publisher', 'create_subscription', 'create_client', 'ActionClient', 'open'):
    for r in d['py_sites'].get(k, []): print('PY', k, r)
