#!/usr/bin/env python3
"""Check fixture boundaries and, when dependencies exist, run the unmodified official scorer."""
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import platform
import sys
from pathlib import Path

sys.dont_write_bytecode = True
PACK = Path(__file__).resolve().parent
ROOT = PACK.parents[2]
PRIVATE = ROOT/'.local/evaluation/rat-00/repoqa/evaluator-only'
EVIDENCE = ROOT/'evidence/rat-00/repoqa'
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HOME']=str(PRIVATE/'hf-cache')

def main():
    manifest=json.loads((PACK/'manifest.json').read_text())
    hidden=json.loads((PRIVATE/'needle-manifest.json').read_text())
    controls=json.loads((PRIVATE/'official-scorer-controls.json').read_text())
    dataset=json.loads((PRIVATE/'express-dataset.json').read_text())
    repo=dataset['typescript'][0]
    checks=[]
    def check(name,condition):
        checks.append({'name':name,'status':'PASS' if condition else 'FAIL'})
    check('dependency_lock_digest',hashlib.sha256((PACK/'scorer-requirements.lock').read_bytes()).hexdigest()==manifest['tool']['dependency_lock_sha256'])
    check('repository_commit_matches_manifest',repo['commit_sha']==manifest['repository']['commit'])
    check('all_ten_needles_in_release_order',[r['needle'] for r in hidden['tasks']]==repo['needles'] and len(repo['needles'])==10)
    check('all_ten_public_ids_match_private_order',[r['task_id'] for r in manifest['tasks']]==[r['task_id'] for r in hidden['tasks']])
    check('private_manifest_digest',hashlib.sha256((PRIVATE/'needle-manifest.json').read_bytes()).hexdigest()==manifest['private_manifest_sha256'])
    check('all_private_controls_present',len(controls)==10 and all(set(['positive','repeat_positive','negative']).issubset(c) for c in controls))
    source=PACK/'agent-input/source'
    for file in manifest['repository']['source_tree']['files']:
        path=source/file['path']
        check('source_digest:'+file['path'],path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==file['sha256'])
    for task, answer in zip(manifest['tasks'],hidden['tasks']):
        path=PACK/task['prompt']
        check('prompt_digest:'+task['task_id'],path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest()==task['prompt_sha256'])
        check('description_matches_official:'+task['task_id'],answer['needle']['description'].rstrip() in path.read_text())
    permitted={source/r['path'] for r in manifest['repository']['source_tree']['files']} | {PACK/t['prompt'] for t in manifest['tasks']}
    actual={p for p in (PACK/'agent-input').rglob('*') if p.is_file() or p.is_symlink()}
    check('agent_input_exact_allowlist',actual==permitted)
    check('agent_input_no_symlinks',not any(p.is_symlink() for p in (PACK/'agent-input').rglob('*')))
    check('evaluator_root_outside_agent_input',not PRIVATE.is_relative_to(PACK/'agent-input'))
    # Import upstream source exactly as frozen; no fallback algorithm or dependency stubs.
    source_records=json.loads((PRIVATE/'upstream/downloads.json').read_text())
    scorer_files=['repoqa/compute_score.py','repoqa/metric.py','repoqa/utility.py','repoqa/data.py','repoqa/__init__.py']
    for name in scorer_files:
        record=next(r for r in source_records if r['file']=='tool/'+name)
        check('official_source_digest:'+name,hashlib.sha256((PRIVATE/'upstream/tool'/name).read_bytes()).hexdigest()==record['sha256'])
    modules={'numpy':'numpy','tempdir':'tempdir','rich':'rich','transformers':'transformers',
             'tree_sitter_languages':'tree-sitter-languages','tree_sitter':'tree-sitter',
             'nltk':'nltk','appdirs':'appdirs','wget':'wget'}
    dependencies=[]
    for module, distribution in modules.items():
        available=importlib.util.find_spec(module) is not None
        try: version=importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError: version=None
        dependencies.append({'module':module,'available':available,'version':version})
    missing=[d['module'] for d in dependencies if not d['available']]
    scoring={'status':'BLOCKED','official_calls':0,'controls_planned':30,'results':[],
             'reason':'Missing required official scorer dependencies: '+', '.join(missing)}
    if not missing:
        sys.path.insert(0,str(PRIVATE/'upstream/tool'))
        try:
            from repoqa.compute_score import needle_evaluator, Result
            scoring={'status':'PASS','official_calls':0,'controls_planned':30,'results':[]}
            for control in controls:
                row={'task_id':control['task_id']}
                for variant in ['positive','repeat_positive','negative']:
                    verdict, best_target, similarity=needle_evaluator(control[variant],control['target_name'],repo,'typescript',False)
                    passed=verdict==Result.BEST_MATCH and similarity>=0.8
                    expected=variant!='negative'
                    row[variant]={'status':'PASS' if passed==expected else 'FAIL',
                                  'official_threshold_pass':passed,'similarity':similarity}
                    scoring['official_calls']+=1
                    if passed!=expected: scoring['status']='FAIL'
                scoring['results'].append(row)
        except Exception as exc:
            scoring.update({'status':'BLOCKED','reason':type(exc).__name__+': '+str(exc)})
    report={'ticket_id':'RAT-00','fixture_version':'rat-00-v1','python':platform.python_version(),
            'model_calls':0,'python_executable':sys.executable,'hf_hub_offline':True,'transformers_offline':True,
            'dependency_lock_sha256':manifest['tool']['dependency_lock_sha256'],'fixture_preflight':{'status':'PASS' if all(c['status']=='PASS' for c in checks) else 'FAIL','checks':checks},
            'dependencies':dependencies,'official_scorer':scoring,
            'official_snf_prompt':{'status':'BLOCKED','reason':'Frozen-source tokenizer codellama/CodeLlama-7b-Instruct-hf has no frozen revision or local assets; 16384-token contexts were not generated.'},
            'runtime_boundary':{'status':'NOT_RUN','reason':'Static input allowlist passed separately. Sandbox must prove evaluator, parent paths, credentials and other trials unreadable before any model call.'},
            'agent_score':None}
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    (EVIDENCE/'preflight.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'fixture_preflight':report['fixture_preflight']['status'],
                      'fixture_checks':len(checks),'official_scorer':scoring['status'],
                      'official_calls':scoring['official_calls'],'missing_dependencies':missing,'model_calls':0}))
    return 1 if report['fixture_preflight']['status']=='FAIL' or scoring['status']=='FAIL' else 0

if __name__=='__main__':
    raise SystemExit(main())
