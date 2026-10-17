#!/usr/bin/env python3
"""Checker: collect the checker's own key numbers (from its own outputs) into one small JSON data file.
Usage: python3 -I check_slam_numbers.py <results/slam-check dir> <out.json>"""
import json, os, sys
d, outp = sys.argv[1:3]
inc = json.load(open(os.path.join(d, 'include-check.json')))
py = json.load(open(os.path.join(d, 'py-check.json')))
rt = json.load(open(os.path.join(d, 'runtime-check.json')))
out = {
    'files': inc['workspace_files'], 'cpp_files': inc['cpp_files'], 'tus': inc['tus'],
    'cpp_own_text_resolver': {k: inc['own'][k] for k in ('edges', 'unresolved', 'unresolved_ros_interface', 'cross_package', 'cpp_files_with_edge', 'cpp_files_reached')},
    'cpp_light_prototype': {k: inc['light'][k] for k in ('status', 'edges', 'unresolved', 'unresolved_ros_interface', 'cpp_files_with_edge', 'failure_rule_diagnostics')},
    'cpp_diff': {k: inc['diff'][k] for k in ('edges_only_own', 'edges_only_light', 'unres_only_own', 'unres_only_light')},
    'python_whole': {k: py['whole'][k] for k in ('py_files', 'import_statements', 'raw_refs_names', 'nested_imports', 'dynamic_import_calls', 'unresolved_count', 'unresolved_reasons', 'unresolved_stdlib', 'unresolved_other')},
    'python_whole_edges': len(py['whole']['edges']), 'python_vs_prototype': py['whole_cmp'],
    'python_per_package_root': {k: {kk: v[kk] for kk in ('py_files', 'unresolved_count', 'unresolved_reasons', 'unresolved_non_null')} for k, v in py.items() if k.startswith('pkg-') and not k.endswith('-cmp')},
    'runtime_site_counts': {'cpp': rt['cpp_counts'], 'py': rt['py_counts'], 'launch': rt['launch_counts'], 'bridge_entries': rt['bridge_entries'],
                            'ext_cfg_topic_keys': len(rt['ext_cfg_topics']), 'gz_plugins': len(rt['gz_plugins'])},
    'topic_site_pairs': rt['topic_site_pairs'], 'topic_code_code_file_pairs': rt['topic_code_code_file_pairs'],
    'runtime_pair_summary': rt['summary'], 'extra_pairs_not_in_the_35': rt['extra_not_in_35'], 'extra_new_vs_35': rt['extra_new_vs_35'],
    'package_relations': rt['package_relations'], 'missing_own_deps': rt['missing_own_deps'],
    'param_yaml_detail_project': {k: v for k, v in rt['param_yaml_detail'].items() if 'nav2' not in k and 'octomap' not in k},
    'zero_checks': rt['zero_checks'],
}
json.dump(out, open(outp, 'w'), indent=1, ensure_ascii=False)
print('written', outp, os.path.getsize(outp))
