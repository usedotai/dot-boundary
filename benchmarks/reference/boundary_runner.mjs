import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const {Boundary}=await import(process.env.BOUNDARY_MODULE);
const build=depth=>{const b=new Boundary();let v=b.data(0,{allow:['alpha']});const one=b.data(1,{allow:['*']});for(let i=0;i<depth;i++)v=b.derive([v,one],(a,z)=>a+z);return{b,v};};
const decide=(b,v,d)=>{const a=b.policy(v).allow;return a.includes('*')||a.includes(d);};
const checks=({b,v})=>{let total=0;for(let i=0;i<20;i++)total+=Number(decide(b,v,i%2===0?'alpha':'beta'));assert.equal(total,10);};
const timed=fn=>{for(let i=0;i<30;i++)fn();const samples=[];for(let i=0;i<30;i++){const start=performance.now();const retained=fn();samples.push((performance.now()-start)*1000);if(retained)assert.ok(retained.b.reveal(retained.v)>=0);}return samples;};
if(process.argv[2]==='correctness'){
 const cases=JSON.parse(await readFile(process.argv[3],'utf8')),rows=[];
 for(const c of cases){const b=new Boundary(),vals=c.leaves.map(x=>b.data(x.value,{allow:x.allow}));for(const [a,z] of c.ops)vals.push(b.derive([vals[a],vals[z]],(x,y)=>x+y));const v=vals.at(-1),allow=b.policy(v).allow,value=b.reveal(v),decisions=Object.fromEntries(Object.keys(c.expectedDecisions).map(d=>[d,decide(b,v,d)]));assert.equal(value,c.expectedValue);assert.deepEqual(allow,c.expectedAllow);assert.deepEqual(decisions,c.expectedDecisions);rows.push({id:c.id,allow,value,decisions});}
 console.log(JSON.stringify({engine:'boundary',node:process.version,cases:rows.length,decisions:rows.length*4,rows}));
}else{
 for(let i=0;i<500;i++)checks(build(32));
 const rows=[];for(const depth of [0,1,8,32,128,256]){const prepared=build(depth);assert.equal(prepared.b.reveal(prepared.v),depth);rows.push({depth,build_us:timed(()=>build(depth)),query_us:timed(()=>checks(prepared)).map(x=>x/20),build_20_queries_us:timed(()=>{const state=build(depth);checks(state);return state;})});}
 console.log(JSON.stringify({engine:'boundary',node:process.version,rows}));
}
