import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../src/gateway.mjs';
import { openAICompatible } from '../src/index.mjs';
import { fixture, listen, closeServer } from './helpers.mjs';

const token='boundary-test-token-not-a-real-secret';
async function setup(t,options={}){
  const f=await fixture();t.after(()=>f.close());
  const providers={local:openAICompatible({baseURL:f.url,model:'test-local'}),cloud:openAICompatible({baseURL:f.url,model:'test-cloud'})};
  const server=createGateway({token,providers,routes:{local:{allow:['local'],destinations:['local']},cloud:{allow:['cloud'],destinations:['cloud']}},...options});
  const url=await listen(server);t.after(()=>closeServer(server));
  const post=(path,body,headers={})=>fetch(`${url}${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const chat=(model='local',headers={},extra={})=>post('/v1/chat/completions',{model,messages:[{role:'user',content:'hello'}],...extra},headers);
  return{f,url,server,post,chat};
}
test('gateway runs an OpenAI-compatible request through real upstream HTTP',async t=>{
  const s=await setup(t);const r=await s.chat();assert.equal(r.status,200);
  const body=await r.json();assert.equal(body.model,'local');assert.equal(body.choices[0].message.content,'A complete answer.');
  assert.equal(s.f.requests[0].body.model,'test-local');assert.equal(r.headers.get('cache-control'),'no-store');
});
test('gateway API authentication and browser origin rejection',async t=>{
  const s=await setup(t);
  assert.equal((await fetch(`${s.url}/v1/models`)).status,401);
  assert.equal((await s.chat('local',{origin:'https://attacker.example'})).status,403);
  assert.equal(s.f.requests.length,0);
  const models=await fetch(`${s.url}/v1/models`,{headers:{authorization:`Bearer ${token}`}});
  assert.deepEqual((await models.json()).data.map(x=>x.id),['local','cloud']);
});
test('stateful sessions retain restrictions across model changes without storing chat history',async t=>{
  const s=await setup(t);const session=await(await s.post('/v1/boundary/sessions',{})).json();
  const headers={'x-boundary-session':session.id};
  assert.equal((await s.chat('local',headers)).status,200);
  const denied=await s.chat('cloud',headers);assert.equal(denied.status,403);
  assert.equal(s.f.requests.length,1);
});
test('new independent requests do not share policies or histories',async t=>{
  const s=await setup(t);
  assert.equal((await s.chat('local')).status,200);assert.equal((await s.chat('cloud')).status,200);
  assert.equal(s.f.requests.length,2);
});
test('missing, deleted and expired sessions are never silently recreated',async t=>{
  const s=await setup(t,{sessionTTL:20});
  assert.equal((await s.chat('local',{'x-boundary-session':'missing'})).status,410);
  const session=await(await s.post('/v1/boundary/sessions',{})).json();
  await new Promise(r=>setTimeout(r,25));
  assert.equal((await s.chat('local',{'x-boundary-session':session.id})).status,410);
});
test('session capacity is bounded and DELETE releases a slot',async t=>{
  const s=await setup(t,{maxSessions:1});const session=await(await s.post('/v1/boundary/sessions',{})).json();
  assert.equal((await s.post('/v1/boundary/sessions',{})).status,429);
  assert.equal((await fetch(`${s.url}/v1/boundary/sessions/${session.id}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`}})).status,200);
  assert.equal((await s.post('/v1/boundary/sessions',{})).status,201);
});
test('request policy overrides and unsupported multimodal payloads fail closed',async t=>{
  const s=await setup(t);
  for(const extra of [{allow:['*']},{routes:['cloud']},{messages:[{role:'user',content:[{type:'image_url',image_url:{url:'https://example.com'}}]}]}]){
    assert.equal((await s.chat('local',{},extra)).status,400);
  }
  assert.equal(s.f.requests.length,0);
});
test('buffered SSE is consumable as standard Chat Completions chunks',async t=>{
  const s=await setup(t);const r=await s.chat('local',{}, {stream:true});
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/event-stream/);
  const text=await r.text();assert.match(text,/chat.completion.chunk/);assert.match(text,/A complete answer/);assert.match(text,/data: \[DONE\]/);
});
test('concurrent session conflicts cannot unlock another active request',async t=>{
  let release,entered;
  const begun=new Promise(r=>entered=r);
  const provider={complete:async()=>{entered();return new Promise(r=>{release=()=>r({choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}]});});}};
  const s=await setup(t,{providers:{local:provider,cloud:provider}});
  const session=await(await s.post('/v1/boundary/sessions',{})).json(),headers={'x-boundary-session':session.id};
  const first=s.chat('local',headers);await begun;
  try {
    assert.equal((await s.chat('local',headers)).status,409);
    assert.equal((await s.chat('local',headers)).status,409);
  } finally {release();}
  assert.equal((await first).status,200);
});
test('server rejects malformed messages without raw content in error',async t=>{
  const s=await setup(t);const r=await s.chat('local',{}, {messages:[{role:'attacker-secret',content:'private'}]});
  assert.equal(r.status,400);assert.doesNotMatch(await r.text(),/attacker-secret|private/);
});
test('oversized request returns structured 413 and never reaches a provider',async t=>{
  const s=await setup(t,{maxBodyBytes:128});
  const r=await s.chat('local',{}, {messages:[{role:'user',content:'x'.repeat(1000)}]});
  assert.equal(r.status,413);assert.equal((await r.json()).error.code,'body_too_large');
  assert.equal(s.f.requests.length,0);
});
