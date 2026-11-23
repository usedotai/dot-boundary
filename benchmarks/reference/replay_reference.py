import json,fnmatch
from pathlib import Path
from camel.capabilities import Capabilities,can_readers_read_value
from camel.capabilities.readers import Public
from camel.interpreter.value import CaMeLStr
from camel.security_policy import SecurityPolicyEngine,Allowed,Denied
READ_ONLY=['get_current_day','search_calendar_events','get_day_calendar_events','search_emails']
class ReadOnlyTaskPolicy(SecurityPolicyEngine):
 def __init__(self):
  self.no_side_effect_tools=set()
  self.policies=[('*',lambda name,args:Allowed() if can_readers_read_value({name},args['arguments']) else Denied('Read-only task does not authorize this tool.'))]
engine=ReadOnlyTaskPolicy();rows=[]
for trace in json.loads(Path(__file__).with_name('agentdojo-replay-input.json').read_text()):
 source=CaMeLStr.from_raw('Read-only calendar question',Capabilities(frozenset(),frozenset(READ_ONLY)),())
 for i,call in enumerate(trace['calls']):
  v=CaMeLStr.from_raw(json.dumps(call['args']),Capabilities(frozenset(),Public()),(source,))
  allowed=isinstance(engine.check_policy(call['function'],{'arguments':v},()),Allowed)
  assert allowed==(call['function'] in READ_ONLY)
  rows.append({'trace':trace['file'],'call':i,'tool':call['function'],'allowed':allowed})
print(json.dumps({'engine':'camel','policy':'Explicit read-only calendar task; identical symbolic tool audience for both engines. No real side effects.','rows':rows,'allowed':sum(x['allowed'] for x in rows),'blocked':sum(not x['allowed'] for x in rows)},indent=2))
