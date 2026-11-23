import json,sys,time,platform
from pathlib import Path
from camel.capabilities import Capabilities,get_all_readers,can_readers_read_value
from camel.capabilities.readers import Public
from camel.interpreter.value import CaMeLInt

def wrap(n,allow):return CaMeLInt(n,Capabilities(frozenset(),Public() if allow==['*'] else frozenset(allow)),())
def decide(v,d):return can_readers_read_value({d},v)
def build(depth):
 v=wrap(0,['alpha']);one=wrap(1,['*'])
 for _ in range(depth):v=v.add(one)
 return v

def checks(v):
 total=0
 for i in range(20):total+=decide(v,'alpha' if i%2==0 else 'beta')
 assert total==10

def timed(fn,n=30):
 for _ in range(30):fn()
 out=[]
 for _ in range(n):
  retained=None
  start=time.perf_counter_ns();retained=fn();out.append((time.perf_counter_ns()-start)/1000)
  if retained is not None:assert retained.raw>=0
 return out

mode=sys.argv[1]
if mode=='correctness':
 rows=[]
 for c in json.loads(Path(sys.argv[2]).read_text()):
  vals=[wrap(x['value'],x['allow']) for x in c['leaves']]
  for left,right in c['ops']:vals.append(vals[left].add(vals[right]))
  v=vals[-1];a=get_all_readers(v)[0];allow=['*'] if isinstance(a,Public) else sorted(a)
  decisions={d:decide(v,d) for d in c['expectedDecisions']}
  assert v.raw==c['expectedValue'] and allow==c['expectedAllow'] and decisions==c['expectedDecisions'],c['id']
  rows.append({'id':c['id'],'allow':allow,'value':v.raw,'decisions':decisions})
 print(json.dumps({'engine':'camel','python':platform.python_version(),'cases':len(rows),'decisions':4*len(rows),'rows':rows}))
else:
 for _ in range(500):checks(build(32))
 rows=[]
 for depth in [0,1,8,32,128,256]:
  v=build(depth);assert v.raw==depth
  def build_only():return build(depth)
  def queries():checks(v)
  def cycle():
   v=build(depth);checks(v);return v
  rows.append({'depth':depth,'build_us':timed(build_only),'query_us':[x/20 for x in timed(queries)],'build_20_queries_us':timed(cycle)})
 print(json.dumps({'engine':'camel','python':platform.python_version(),'rows':rows}))
