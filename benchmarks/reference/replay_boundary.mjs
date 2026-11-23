import{readFile}from'node:fs/promises';import assert from'node:assert/strict';
const{Boundary}=await import(process.env.BOUNDARY_MODULE);
const allowed=['get_current_day','search_calendar_events','get_day_calendar_events','search_emails'];
const traces=JSON.parse(await readFile(new URL('./agentdojo-replay-input.json',import.meta.url),'utf8')),rows=[];
let executed=0;
for(const trace of traces){
 const names=[...new Set(trace.calls.map(c=>c.function))];
 const b=new Boundary({tools:Object.fromEntries(names.map(name=>[name,{execute:async()=>{executed++;return null;},outputAllow:allowed}]))});
 const source=b.data('Read-only calendar question',{allow:allowed});
 for(const[i,c]of trace.calls.entries()){
  const args=b.derive([source],()=>c.args);let passed=true;
  try{await b.invoke(c.function,args);}catch(e){if(e.code!=='policy_denied')throw e;passed=false;}
  assert.equal(passed,allowed.includes(c.function));rows.push({trace:trace.file,call:i,tool:c.function,allowed:passed});
 }
}
assert.equal(executed,rows.filter(r=>r.allowed).length);
console.log(JSON.stringify({engine:'boundary',policy:'Explicit read-only calendar task; identical symbolic tool audience for both engines. No real side effects.',rows,allowed:executed,blocked:rows.length-executed},null,2));
