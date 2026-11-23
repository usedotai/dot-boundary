import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Boundary, openAICompatible } from '../src/index.mjs';
import { cases, families, transformed } from './cases.mjs';
import { runBaseline } from './baselines.mjs';
import { fixture, completion } from '../test/helpers.mjs';

const strategies=['direct','literal-filter','request-acl','provenance-entry','boundary'];
const names={'direct':'Direct dispatch','literal-filter':'Literal secret filter','request-acl':'Per-request ACL','provenance-entry':'Provenance, entry-only','boundary':'Dot Boundary'};
const rows=[];
let activeCase, trustedCalls=0, externalCalls=0;
const trusted=await fixture((_,res)=>{
  trustedCalls++;
  if(['fallback','revocation'].includes(activeCase?.family)&&trustedCalls===1){res.statusCode=503;res.end('{"error":"injected failure"}');}
  else res.end(JSON.stringify(completion()));
});
const external=await fixture((_,res)=>{externalCalls++;res.end(JSON.stringify(completion()));});
const adapters={trusted:openAICompatible({baseURL:trusted.url,model:'controlled-worker'}),external:openAICompatible({baseURL:external.url,model:'controlled-worker'})};

async function boundaryRun(c){
  let b;
  const localAdapter={complete:async args=>{
    try{return await adapters.trusted.complete(args);}catch(e){if(c.family==='revocation')b.revoke('trusted');throw e;}
  }};
  b=new Boundary({providers:{trusted:localAdapter,external:adapters.external},
    tools:{read:{execute:async()=>c.secret,outputAllow:['trusted']}}});
  let source=b.data(c.secret,{allow:['trusted']});
  let value;
  if(c.family==='public')value=b.data('Public release notes.',{allow:['*']});
  else if(c.family==='tool-read')value=await b.invoke('read',b.data('public file selector',{allow:['*']}));
  else if(c.family==='join')value=b.derive([source,b.data('public text',{allow:['*']})],(a,z)=>`${a} ${z}`);
  else value=b.derive([source],()=>transformed(c));
  if(c.family==='released')value=b.release(value,{allow:['external'],approvalId:'benchmark-owner-release'});
  value=b.derive([value],text=>text+c.padding);
  const routes=c.family==='fallback'?['trusted','external']:['authorized','revocation'].includes(c.family)?['trusted']:['external'];
  try{
    await b.complete({messages:[{role:'user',content:value}],routes,retries:c.family==='revocation'?1:0,timeoutMs:3000});
    return true;
  }catch(e){if(!['policy_denied','upstream_503'].includes(e.code))throw e;return false;}
}

try{
  const dataset=cases();
  // Rotate order across three repetitions to reduce fixed-order warmup bias.
  for(let repetition=0;repetition<3;repetition++){
    const order=[...strategies.slice(repetition),...strategies.slice(0,repetition)];
    for(const c of dataset){
      for(const strategy of order){
        activeCase=c;trustedCalls=0;externalCalls=0;
        const begin=performance.now();
        const completed=strategy==='boundary'?await boundaryRun(c):await runBaseline(strategy,c,adapters);
        const elapsedMs=performance.now()-begin;
        const forbidden=c.attack&&(c.family==='revocation'?trustedCalls>1:externalCalls>0);
        rows.push({id:c.id,family:c.family,attack:c.attack,repetition,strategy,completed,forbidden,
          trustedCalls,externalCalls,elapsedMs});
        // Request payloads are observed for counters, then discarded between episodes.
        trusted.requests.length=0;external.requests.length=0;
      }
    }
  }
}finally{await trusted.close();await external.close();}

const quantile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(p*xs.length))];
function wilson(k,n){const z=1.96,d=1+z*z/n,m=(k/n+z*z/(2*n))/d,r=z*Math.sqrt(k/n*(1-k/n)/n+z*z/(4*n*n))/d;return[Math.max(0,m-r),Math.min(1,m+r)];}
const summary=strategies.map(strategy=>{
  const all=rows.filter(r=>r.strategy===strategy),unique=all.filter(r=>r.repetition===0);
  const attacks=unique.filter(r=>r.attack),benign=unique.filter(r=>!r.attack),forbidden=attacks.filter(r=>r.forbidden).length,completed=benign.filter(r=>r.completed).length;
  return{strategy,name:names[strategy],attackCases:attacks.length,forbidden,forbiddenRate:forbidden/attacks.length,
    forbidden95CI:wilson(forbidden,attacks.length),benignCases:benign.length,benignCompleted:completed,benignCompletionRate:completed/benign.length,
    benign95CI:wilson(completed,benign.length),medianEpisodeMs:quantile(all.map(r=>r.elapsedMs),.5),p95EpisodeMs:quantile(all.map(r=>r.elapsedMs),.95)};
});
const byFamily=families.map(([family,label,attack])=>({family,label,attack,results:Object.fromEntries(strategies.map(strategy=>{
  const rs=rows.filter(r=>r.family===family&&r.strategy===strategy&&r.repetition===0);
  return[strategy,{cases:rs.length,forbidden:rs.filter(r=>r.forbidden).length,completed:rs.filter(r=>r.completed).length}];
}))}));

// Matched pure-runtime overhead: identical authorized request/response, no HTTP or model time.
const latency=[];
for(const bytes of [128,1024,8192,65536]){
  const answer=completion('ok'),adapter={complete:async()=>structuredClone(answer)};
  const b=new Boundary({providers:{trusted:adapter},maxEvents:10});
  const text='a'.repeat(bytes),handle=b.data(text,{allow:['trusted']});
  const direct=()=>adapter.complete({messages:[{role:'user',content:text}],parameters:{}});
  const guarded=()=>b.complete({messages:[{role:'user',content:handle}],routes:['trusted']});
  for(let warm=0;warm<50;warm++){await direct();await guarded();}
  const samples={direct:[],boundary:[]};
  for(let i=0;i<300;i++)for(const [name,fn] of i%2?[['boundary',guarded],['direct',direct]]:[['direct',direct],['boundary',guarded]]){
    const start=performance.now();await fn();samples[name].push((performance.now()-start)*1000);
  }
  latency.push({inputBytes:bytes,unit:'microseconds',samples,
    direct:{median:quantile(samples.direct,.5),p95:quantile(samples.direct,.95)},
    boundary:{median:quantile(samples.boundary,.5),p95:quantile(samples.boundary,.95)}});
}

const sourceHashes={};
for(const dir of ['src','benchmarks'])for(const file of (await readdir(new URL(`../${dir}/`,import.meta.url))).filter(f=>f.endsWith('.mjs')).sort()){
  sourceHashes[`${dir}/${file}`]=createHash('sha256').update(await readFile(new URL(`../${dir}/${file}`,import.meta.url))).digest('hex');
}
const result={version:1,generatedAt:new Date().toISOString(),environment:{node:process.version},
  methodology:{cases:300,attackCases:200,benignCases:100,repetitions:3,episodes:rows.length,
    transport:'loopback HTTP / OpenAI Chat Completions fixtures',worker:'deterministic adversarial transformations',
    confidenceIntervals:'Wilson 95% across 200 attack or 100 benign cases, using repetition zero; fixed-template descriptive intervals',
    comparison:'In-repository mechanism baselines; no external product benchmark',providerSpendUSD:0},sourceHashes,summary,byFamily,latency};
await mkdir(new URL('./results/',import.meta.url),{recursive:true});
await writeFile(new URL('./results/latest.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
await writeFile(new URL('./results/episodes.jsonl',import.meta.url),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
await writeFile(new URL('./results/summary.csv',import.meta.url),'strategy,attack_cases,forbidden,forbidden_rate,benign_cases,benign_completed,benign_completion_rate\n'+summary.map(r=>[r.strategy,r.attackCases,r.forbidden,r.forbiddenRate,r.benignCases,r.benignCompleted,r.benignCompletionRate].join(',')).join('\n')+'\n');
console.table(summary.map(({name,forbidden,attackCases,benignCompleted,benignCases})=>({strategy:name,forbidden:`${forbidden}/${attackCases}`,completed:`${benignCompleted}/${benignCases}`})));
console.log(`Wrote ${rows.length} episode receipts and ${latency.length} matched runtime sweeps. No external model calls.`);
