#!/usr/bin/env python3
"""Offline extraction of the frozen official Express subset; never calls a model."""
import gzip
import hashlib
import json
from pathlib import Path

PACK = Path(__file__).resolve().parent
ROOT = PACK.parents[2]
PRIVATE = ROOT / '.local/evaluation/rat-00/repoqa/evaluator-only'
UPSTREAM = PRIVATE / 'upstream'
EVIDENCE = ROOT / 'evidence/rat-00/repoqa'
TOOL_COMMIT = 'ae876deb1365dbf5a15b0533723c8ed123eee586'
RELEASE_COMMIT = 'e3a571033de99d0b9dcaccd25577a75d4b1c70b1'
EXPRESS_COMMIT = '815f799310a5627c000d4a5156c1c958e4947b4c'
ASSET_SHA256 = 'c050a2ad90a7df89d9dc1f1c3b3b20683edd20a56293b35fcaae43dec115d681'

def sha(body):
    return hashlib.sha256(body).hexdigest()

def emit(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != body:
        raise ValueError(f'Frozen artifact differs; use a new fixture version: {path}')
    path.write_bytes(body)

def dump(path, value):
    emit(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())

def digest_tree(path):
    entries = [{'path':str(p.relative_to(path)), 'sha256':sha(p.read_bytes()), 'bytes':p.stat().st_size}
               for p in sorted(path.rglob('*')) if p.is_file()]
    return {'files':entries, 'sha256':sha(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode())}

def main():
    raw = (UPSTREAM / 'repoqa-2024-06-23.json.gz').read_bytes()
    assert sha(raw) == ASSET_SHA256, 'Frozen release digest mismatch'
    data = json.loads(gzip.decompress(raw))
    candidates = [(lang, i, r) for lang, repos in data.items() for i, r in enumerate(repos)
                  if r['repo'] == 'expressjs/express']
    assert len(candidates) == 1
    language, repo_index, repo = candidates[0]
    selection = json.loads((UPSTREAM/'tool/scripts/cherrypick/lists.json').read_text())
    chosen = next(r for r in selection['typescript'] if r['repo'] == 'expressjs/express')
    assert language == 'typescript' and repo['commit_sha'] == chosen['commit_sha'] == EXPRESS_COMMIT
    assert repo['entrypoint_path'] == chosen['entrypoint_path'] == 'lib'
    assert len(repo['needles']) == 10 and len(repo['content']) == 11
    verification = json.loads((UPSTREAM/'express-source-verification.json').read_text())
    assert len(verification) == 11 and all(r['matches_release'] for r in verification)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    PRIVATE.chmod(0o700)
    dump(PRIVATE/'express-dataset.json', {language:[repo]})
    source = PACK/'agent-input/source'
    for path, content in repo['content'].items():
        relative = Path(path)
        assert not relative.is_absolute() and '..' not in relative.parts
        emit(source/relative, content.encode())
    emit(source/'LICENSE', (UPSTREAM/'express-LICENSE').read_bytes())
    emit(PACK/'licenses/RepoQA-Data-Apache-2.0.txt', (UPSTREAM/'release-LICENSE').read_bytes())
    emit(PACK/'licenses/RepoQA-Tool-Apache-2.0.txt', (UPSTREAM/'tool/LICENSE').read_bytes())
    public_tasks, hidden_tasks, controls = [], [], []
    for index, needle in enumerate(repo['needles']):
        task_id = f'repoqa-express-{index+1:02d}'
        description = needle['description']
        prompt = ('# Read-only function location task\n\n'
                  'Find the function matching the description in the provided source repository. '
                  'Return its repository-relative file path, copy the complete function in a code block, '
                  'and briefly explain the match using source evidence. Do not edit any files.\n\n'
                  '## Function description\n' + description.rstrip() + '\n')
        prompt_path = PACK/f'agent-input/prompts/{task_id}.md'
        emit(prompt_path, prompt.encode())
        answer = '\n'.join(repo['content'][needle['path']].split('\n')[needle['start_line']:needle['end_line']])
        assert answer.strip()
        public_tasks.append({'task_id':task_id,'ordinal':index+1,
                             'prompt':str(prompt_path.relative_to(PACK)),
                             'prompt_sha256':sha(prompt.encode()),
                             'description_sha256':sha(description.encode())})
        hidden_tasks.append({'task_id':task_id,'ordinal':index+1,
                             'official_task_id':f"{language}::{repo['repo']}::{needle['name']}",
                             'official_position_ratio':(index+0.5)/len(repo['needles']),
                             'needle':needle,'official_scorer_reference':answer,
                             'reference_sha256':sha(answer.encode())})
    assert len({r['reference_sha256'] for r in hidden_tasks}) == 10
    for index, hidden in enumerate(hidden_tasks):
        controls.append({'task_id':hidden['task_id'], 'target_name':hidden['needle']['name'],
                         'positive':hidden['official_scorer_reference'],
                         'repeat_positive':hidden['official_scorer_reference'],
                         'negative':hidden_tasks[(index+1)%len(hidden_tasks)]['official_scorer_reference'],
                         'negative_source_task_id':hidden_tasks[(index+1)%len(hidden_tasks)]['task_id']})
    dump(PRIVATE/'needle-manifest.json', {'language':language,'repo':repo['repo'],
                                        'upstream_repository_index_zero_based':repo_index,
                                        'ordering':'all needles in original released array order','tasks':hidden_tasks})
    dump(PRIVATE/'official-scorer-controls.json',controls)
    source_tree = digest_tree(source)
    downloads = json.loads((UPSTREAM/'downloads.json').read_text())
    manifest = {'schema_version':1,'fixture_version':'rat-00-v1','ticket_id':'RAT-00',
                'preparation_status':'MATERIALIZED','model_calls':0,
                'dataset':{'name':'RepoQA','tag':'2024-06-23','release_commit':RELEASE_COMMIT,
                           'published_at':'2024-10-07T19:18:17Z','asset_bytes':len(raw),
                           'asset_sha256':sha(raw),'release_url':'https://github.com/evalplus/repoqa_release/releases/tag/2024-06-23',
                           'selection':'all 10 Express needles, original array order; no result-based selection'},
                'repository':{'name':'expressjs/express','commit':EXPRESS_COMMIT,'group':language,
                              'entrypoint':'lib','source_files':11,'source_tree':source_tree},
                'tool':{'name':'evalplus/repoqa','commit':TOOL_COMMIT,
                        'scorer':'repoqa.compute_score.needle_evaluator','threshold':0.8,'ignore_comments':False,
                        'dependency_lock':'scorer-requirements.lock',
                        'dependency_lock_sha256':sha((PACK/'scorer-requirements.lock').read_bytes())},
                'protocols':{'official_snf':{'status':'BLOCKED','reason':'Tokenizer revision and assets are not frozen. Official 16384-token prompt preprocessing is not materialized; the official function scorer passed separately.',
                                            'code_context_size':16384,'max_new_tokens':1024,'clean_ctx_comments':'none',
                                            'tokenizer_name_in_frozen_source':'codellama/CodeLlama-7b-Instruct-hf','tokenizer_revision':None,
                                            'metric':'official best-match and BLEU similarity >= 0.8'},
                             'platform_derived_navigation':{'input_status':'READY','execution_status':'NOT_RUN',
                                                            'label':'RepoQA-derived Express tool navigation acceptance',
                                                            'requires':'isolated read-only workspace; real worker adapter; separate official scorer or explicitly labeled derived metric',
                                                            'report_separately':['official function-match evaluation when available','path citation accuracy','tool bytes read','latency']}},
                'task_count':len(public_tasks),'tasks':public_tasks,
                'private_material_root':str(PRIVATE.relative_to(ROOT)),
                'private_manifest_sha256':sha((PRIVATE/'needle-manifest.json').read_bytes()),
                'boundary':{'allow_source_root':str(source.relative_to(ROOT)),
                            'allow_task_prompt':'exactly one selected agent-input/prompts/<task_id>.md copied to TASK.md',
                            'never_mount':['platform root','.local','evidence','evaluator-only','other task prompts','upstream dataset','credentials'],
                            'enforcement':'Separate task input trees are prepared; actual OS sandbox deny-read check is required before model runs. Directory placement or chmod alone is not isolation.'},
                'license':{'dataset':'Apache-2.0','repoqa_tool':'Apache-2.0','express_source':'MIT','preserved_notices':'licenses/ and agent-input/source/LICENSE'},
                'scoring_preflight':'evidence/rat-00/repoqa/preflight.json'}
    dump(PACK/'manifest.json',manifest)
    dump(EVIDENCE/'provenance.json',{'source_downloads':downloads,'express_source_verification':verification,
                                   'subset_dataset_sha256':sha((PRIVATE/'express-dataset.json').read_bytes()),
                                   'manifest_sha256':sha((PACK/'manifest.json').read_bytes()),
                                   'upstream_full_dataset_location':str((UPSTREAM/'repoqa-2024-06-23.json.gz').relative_to(ROOT)),
                                   'network_limit_bytes':13000000,'no_full_repository_clone':True})
    print(json.dumps({'status':'MATERIALIZED','task_count':10,'source_files':11,
                      'manifest':str(PACK/'manifest.json'),'source_tree_sha256':source_tree['sha256']}))

if __name__ == '__main__':
    main()
