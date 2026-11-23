import os,sys,subprocess,json,statistics,hashlib,platform,datetime
from pathlib import Path
root=Path(__file__).parent
boundary=root.parents[1]
reference=Path(os.environ.get('CAMEL_SOURCE',str(boundary/'.reference/camel'))).resolve()
output=Path(os.environ.get('REFERENCE_OUTPUT',str(root/'results'))).resolve();output.mkdir(parents=True,exist_ok=True)
expected_reference='f083b6b396399d3b3c7f2ddaf613a5945eaf32d8'
assert subprocess.check_output(['git','-C',str(reference),'rev-parse','HEAD'],text=True).strip()==expected_reference,'Unexpected reference revision'
assert not subprocess.check_output(['git','-C',str(reference),'diff','--name-only','HEAD'],text=True).strip(),'Reference source was modified'
env={'PATH':os.environ['PATH'],'PYTHONDONTWRITEBYTECODE':'1','PYTHONPATH':str(reference/'src')+os.pathsep+str(Path(os.environ.get('REFERENCE_DEPS',str(boundary/'.reference/deps'))).resolve()),'BOUNDARY_MODULE':str(boundary/'src/index.mjs')}
for engine,command in [('camel',[sys.executable,'-S',str(root/'reference_runner.py'),'correctness',str(root/'shared-cases.json')]),('boundary',['node',str(root/'boundary_runner.mjs'),'correctness',str(root/'shared-cases.json')])]:
 result=subprocess.run(command,env=env,capture_output=True,text=True,check=True,timeout=120)
 (output/f'{engine}-correctness.json').write_text(result.stdout)
for engine,command in [('camel',[sys.executable,'-S',str(root/'replay_reference.py')]),('boundary',['node',str(root/'replay_boundary.mjs')])]:
 result=subprocess.run(command,env=env,capture_output=True,text=True,check=True,timeout=120)
 (output/f'replay-{engine}.json').write_text(result.stdout)
assert json.loads((output/'camel-correctness.json').read_text())['rows']==json.loads((output/'boundary-correctness.json').read_text())['rows']
assert json.loads((output/'replay-camel.json').read_text())['rows']==json.loads((output/'replay-boundary.json').read_text())['rows']
if '--correctness-only' in sys.argv:
 print('PASS: 16,384 generated permission decisions and 19 published-trace decisions agree.');sys.exit(0)
runs=[]
for repetition in range(5):
 for engine in (['camel','boundary'] if repetition%2==0 else ['boundary','camel']):
  command=[sys.executable,'-S',str(root/'reference_runner.py'),'timing'] if engine=='camel' else ['node',str(root/'boundary_runner.mjs'),'timing']
  if '--aggregate' in sys.argv:
   r=json.loads((output/f'{engine}-timing-{repetition}.json').read_text())
  else:
   result=subprocess.run(command,env=env,capture_output=True,text=True,check=True,timeout=120)
   r=json.loads(result.stdout)
  r['repetition']=repetition;runs.append(r)
  (output/f'{engine}-timing-{repetition}.json').write_text(json.dumps(r,indent=2)+'\n')
  print('Measured',engine,'round',repetition+1,flush=True)
a=json.loads((output/'camel-correctness.json').read_text());b=json.loads((output/'boundary-correctness.json').read_text())
assert a['rows']==b['rows']
summary=[]
for depth in [0,1,8,32,128,256]:
 row={'depth':depth}
 for measure in ['build_us','query_us','build_20_queries_us']:
  medians={engine:[statistics.median(next(x for x in r['rows'] if x['depth']==depth)[measure]) for r in runs if r['engine']==engine] for engine in ['camel','boundary']}
  ratios=[x/y for x,y in zip(medians['camel'],medians['boundary'])]
  row[measure]={'camel':statistics.median(medians['camel']),'boundary':statistics.median(medians['boundary']),'paired_speedup_median':statistics.median(ratios),'paired_speedup_range':[min(ratios),max(ratios)],'per_process_medians':medians}
 summary.append(row)
hashes={}
for repo,label in [(reference,'camel'),(boundary,'boundary')]:
 out=subprocess.check_output(['git','-C',str(repo),'ls-files'],text=True).splitlines()
 for name in out:
  if name.startswith('src/') and name.endswith(('.py','.mjs')):hashes[label+'/'+name]=hashlib.sha256((repo/name).read_bytes()).hexdigest()
result={'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'reference_commit':subprocess.check_output(['git','-C',str(reference),'rev-parse','HEAD'],text=True).strip(),'boundary_source_identity':'Per-file SHA-256 hashes in source_hashes','runtimes':{'python':platform.python_version(),'node':subprocess.check_output(['node','--version'],text=True).strip()},'scope':'Capability reader-set resolution on explicit data dependencies.','protocol':{'correctness_cases':4096,'decisions_per_engine':16384,'independent_processes_per_engine':5,'samples_per_phase_per_depth':30,'warmup_per_phase':30,'global_warmup_cycles':500,'teardown':'result retained until after the timing stop; construction output validated outside timed region','checks_per_batch':20,'depths':[0,1,8,32,128,256],'reference_source_modified':False,'timing_excludes':'imports, process startup, LLM generation, network'},'source_hashes':hashes,'summary':summary}
(output/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
for row in summary:print(row['depth'], 'query speedup',round(row['query_us']['paired_speedup_median'],2),'build+20 speedup',round(row['build_20_queries_us']['paired_speedup_median'],2),flush=True)
