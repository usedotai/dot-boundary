import test from 'node:test';
import assert from 'node:assert/strict';
import { Boundary, BoundaryError } from '../src/index.mjs';
import { completion } from './helpers.mjs';

const good = { complete: async () => completion() };
const unavailable = { complete: async () => { throw new BoundaryError('upstream_503', 'Unavailable.', { retryable: true }); } };
const prompt = (b, allow = ['a']) => [{ role: 'user', content: b.data('secret-canary', { allow }) }];

test('private-by-default data cannot reach any provider', async () => {
  let called = false;
  const b = new Boundary({ providers: { a: { complete: async () => { called = true; } } } });
  await assert.rejects(b.complete({ messages: [{ role:'user', content: b.data('private') }], routes: ['a'] }), { code: 'policy_denied' });
  assert.equal(called, false);
});
test('public data and authorized calls work; outputs inherit input restrictions', async () => {
  const b = new Boundary({ providers: { a: good } });
  const r = await b.complete({ messages: prompt(b), routes: ['a'] });
  assert.deepEqual(b.policy(r.value).allow, ['a']);
  assert.equal(b.reveal(r.value).choices[0].message.content, 'A complete answer.');
  await b.complete({ messages: prompt(b, ['*']), routes: ['a'] });
});
test('derived values inherit intersection even after semantic or encoding transformation', () => {
  const b = new Boundary();
  const a = b.data('sensitive', { allow:['local','a'] }), c = b.data('other', { allow:['local','b'] });
  const d = b.derive([a,c], () => 'an inference containing none of the original bytes');
  assert.deepEqual(b.policy(d).allow, ['local']);
  assert.equal(b.policy(d).sources.length, 2);
  assert.deepEqual(b.policy(b.restrict(d, ['*'])).allow, ['local']);
});
test('source snapshots and handles cannot be mutated or forged', () => {
  const b = new Boundary(), input = { nested: { secret: 'original' } };
  const h = b.data(input, { allow:['a'] }); input.nested.secret = 'changed';
  assert.equal(b.reveal(h).nested.secret,'original');
  assert.throws(() => b.derive([h], x => { x.nested.secret='changed'; }), TypeError);
  assert.throws(() => b.reveal({ id:h.id }), { code:'invalid_handle' });
  assert.throws(() => new Boundary().reveal(h), { code:'invalid_handle' });
  assert.equal(JSON.stringify(h),'"[Boundary protected value]"');
});
test('private tool arguments are blocked and transformed results keep provenance', async () => {
  let calls=0;
  const b=new Boundary({ tools:{ local: async x => ({encoded:Buffer.from(x).toString('base64')}), publish:async()=>{calls++;} } });
  const result=await b.invoke('local',b.data('secret',{allow:['local']}));
  await assert.rejects(b.invoke('publish',result),{code:'policy_denied'});
  assert.equal(calls,0);
});
test('explicit owner release requires an approval ID and is auditable', async () => {
  const b = new Boundary({providers:{a:good}}), h=b.data('private');
  assert.throws(()=>b.release(h,{allow:['a']}),{code:'invalid_request'});
  const released=b.release(h,{allow:['a'],approvalId:'owner-approval-1'});
  await b.complete({messages:[{role:'user',content:released}],routes:['a']});
  assert.equal(b.receipt().events[0].type,'release');
});
test('fallback cannot broaden audience after primary failure', async () => {
  let backupCalls=0;
  const b=new Boundary({providers:{a:unavailable,b:{complete:async()=>{backupCalls++;return completion();}}}});
  await assert.rejects(b.complete({messages:prompt(b),routes:['a','b'],retries:1}),{code:'policy_denied'});
  assert.equal(backupCalls,0);
  assert.equal(b.receipt().events.filter(x=>x.type==='dispatch').length,2);
});
test('authorized fallback succeeds and records attempts', async () => {
  const b=new Boundary({providers:{a:unavailable,b:good}});
  const r=await b.complete({messages:prompt(b,['a','b']),routes:['a','b'],retries:1});
  assert.equal(r.destination,'b'); assert.equal(r.attempts,3);
});
test('retries cannot mutate history to widen content or restrictions', async () => {
  let n=0;
  const b=new Boundary({providers:{a:{complete:async ({messages})=>{
    assert.equal(messages[0].content,'secret-canary');
    messages[0].content='modified';
    if(n++===0) throw new BoundaryError('retry','retry',{retryable:true});
    return completion();
  }}}});
  await b.complete({messages:prompt(b),routes:['a'],retries:1});
});
test('revocation between attempts prevents another dispatch', async () => {
  let b;
  b=new Boundary({providers:{a:{complete:async()=>{b.revoke('a');throw new BoundaryError('retry','retry',{retryable:true});}}}});
  await assert.rejects(b.complete({messages:prompt(b),routes:['a'],retries:3}),{code:'policy_denied'});
  assert.equal(b.receipt().events.filter(e=>e.type==='dispatch').length,1);
});
test('revocation while in flight prevents output release', async () => {
  let b;
  b=new Boundary({providers:{a:{complete:async()=>{b.revoke('a');return completion();}}}});
  await assert.rejects(b.complete({messages:prompt(b),routes:['a']}),{code:'policy_denied'});
});
test('tool call metadata inherits its own policy and cannot bypass content policy',async()=>{
  const b=new Boundary({providers:{a:good}});
  await assert.rejects(b.complete({messages:[{role:'assistant',content:b.data('',{allow:['*']}),
    toolCalls:b.data([{id:'call_1',type:'function',function:{name:'send',arguments:'private'}}],{allow:['local']})}],routes:['a']}),{code:'policy_denied'});
});
test('arbitrary upstream errors never appear in receipts or thrown messages',async()=>{
  const b=new Boundary({providers:{a:{complete:async()=>{throw new Error('secret-canary Bearer credential');}}}});
  await assert.rejects(b.complete({messages:prompt(b),routes:['a']}),e=>e.message==='Execution failed.');
  assert.doesNotMatch(JSON.stringify(b.receipt()),/secret-canary|Bearer|credential/);
});
test('receipts are bounded, contain no content, and retain sequence count',async()=>{
  const b=new Boundary({providers:{a:good},maxEvents:3});
  for(let i=0;i<4;i++)await b.complete({messages:prompt(b),routes:['a']});
  assert.equal(b.receipt().eventCount,8);assert.equal(b.receipt().events.length,3);
  assert.doesNotMatch(JSON.stringify(b.receipt()),/secret-canary|complete answer/);
});
test('timeouts abort provider and forbid fallback after total deadline',async()=>{
  const b=new Boundary({providers:{a:{complete:({signal})=>new Promise(resolve=>{
    signal.addEventListener('abort',()=>resolve(completion()),{once:true});
  })},b:good}});
  const keepAlive=setTimeout(()=>{},100);
  try {await assert.rejects(b.complete({messages:prompt(b,['a','b']),routes:['a','b'],timeoutMs:10}),{code:'cancelled'});}
  finally{clearTimeout(keepAlive);}
  assert.equal(b.receipt().events.filter(x=>x.type==='dispatch').length,1);
});
test('concurrent workflows never inherit one another’s handles or policies',async()=>{
  const b=new Boundary({providers:{a:good,b:good}});
  const results=await Promise.all(Array.from({length:30},(_,i)=>b.complete({messages:prompt(b,[i%2?'a':'b']),routes:[i%2?'a':'b']})));
  results.forEach((r,i)=>assert.deepEqual(b.policy(r.value).allow,[i%2?'a':'b']));
});
test('invalid structures and unbounded budgets fail before dispatch',async()=>{
  const b=new Boundary({providers:{a:good}});
  for(const change of [{retries:4},{timeoutMs:0},{routes:['missing']},{messages:[{role:'user',content:'raw'}]}]){
    await assert.rejects(b.complete({messages:prompt(b),routes:['a'],...change}));
  }
  assert.throws(()=>b.data('x',{allow:['*','a']}));
  assert.throws(()=>b.derive([],()=>''));
  assert.throws(()=>b.derive([b.data('x')],async()=>''));
  assert.equal(b.receipt().events.length,0);
});
test('a public tool argument cannot make private file contents public',async()=>{
  const b=new Boundary({tools:{read:{execute:async()=>({secret:'file-canary'}),outputAllow:['local']},send:async()=>{}},providers:{cloud:good}});
  const file=await b.invoke('read',b.data({path:'fixture.txt'},{allow:['*']}));
  assert.deepEqual(b.policy(file).allow,['local']);
  const text=b.derive([file],v=>v.secret);
  await assert.rejects(b.complete({messages:[{role:'user',content:text}],routes:['cloud']}),{code:'policy_denied'});
});
test('tools without an explicit output policy produce private-by-default results',async()=>{
  const b=new Boundary({tools:{read:async()=> 'private'}});
  const value=await b.invoke('read',b.data('public args',{allow:['*']}));
  assert.deepEqual(b.policy(value).allow,[]);
});
test('already cancelled requests never dispatch',async()=>{
  const b=new Boundary({providers:{a:good}});
  await assert.rejects(b.complete({messages:prompt(b),routes:['a'],signal:AbortSignal.abort()}),{code:'cancelled'});
  assert.equal(b.receipt().events.length,0);
});
