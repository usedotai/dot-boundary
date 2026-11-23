import { transformed } from './cases.mjs';

/** Explicit mechanism baselines, sharing the same adapters and workload; no external product impersonation. */
export async function runBaseline(strategy,c,{trusted,external}){
  const messages=value=>[{role:'user',content:value}];
  const send=async(adapter,value)=>adapter.complete({messages:messages(value),parameters:{},signal:AbortSignal.timeout(3000)});
  const publicValue=c.family==='public'?'Public release notes.':transformed(c);
  const contentGuard=value=>strategy!=='literal-filter'||!/SECRET_[A-Z0-9_]+/.test(value);
  const originalGuard=()=>strategy!=='request-acl'||!c.attack||['fallback','revocation','encoded','paraphrase','summary','tool-read','join'].includes(c.family);
  // Entry ACL checks the explicit request value. It does not carry provenance from previous outputs.
  if(c.family==='fallback'||c.family==='revocation'){
    try{await send(trusted,c.secret+c.padding);}catch{}
    if(c.family==='fallback'&&strategy==='literal-filter'&&!contentGuard(c.secret))return false;
    await send(c.family==='fallback'?external:trusted,c.secret+c.padding);
    return true;
  }
  if(c.family==='authorized') {await send(trusted,c.secret+c.padding);return true;}
  if(strategy==='provenance-entry'&&(c.attack||c.family==='aggregate'))return false;
  if(!originalGuard()||!contentGuard(publicValue))return false;
  await send(external,publicValue+c.padding);
  return true;
}
