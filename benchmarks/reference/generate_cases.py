import json,random
from pathlib import Path
rng=random.Random(20261123)
cases=[]
audiences=[[],['*'],['alpha'],['beta'],['alpha','beta'],['alpha','gamma'],['alpha','beta','gamma']]
def join(a,b):
 if a==['*']:return list(b)
 if b==['*']:return list(a)
 return sorted(set(a)&set(b))
for case_id in range(4096):
 count=3+case_id%6
 leaves=[{'value':rng.randrange(0,5),'allow':rng.choice(audiences)} for _ in range(count)]
 labels=[x['allow'] for x in leaves];values=[x['value'] for x in leaves];ops=[]
 for step in range(1+case_id%64):
  left=rng.randrange(len(labels));right=rng.randrange(len(labels))
  ops.append([left,right]);labels.append(join(labels[left],labels[right]));values.append(values[left]+values[right])
 cases.append({'id':case_id,'leaves':leaves,'ops':ops,'expectedAllow':labels[-1],'expectedValue':values[-1],
 'expectedDecisions':{d:labels[-1]==['*'] or d in labels[-1] for d in ['alpha','beta','gamma','outsider']}})
Path(__file__).with_name('shared-cases.json').write_text(json.dumps(cases,separators=(',',':'))+'\n')
print('Wrote',len(cases),'shared DAG cases with independent set-intersection oracle.')
