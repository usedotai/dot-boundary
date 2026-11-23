import test from 'node:test';
import assert from 'node:assert/strict';
import { Boundary, openAICompatible } from '../src/index.mjs';
import { completion, fixture } from './helpers.mjs';

async function send(f,options={}){
  const b=new Boundary({providers:{a:openAICompatible({baseURL:`${f.url}/v1`,apiKey:'test-only-key',model:'selected-model',...options})}});
  return b.reveal((await b.complete({messages:[{role:'user',content:b.data('hello',{allow:['a']})}],routes:['a']})).value);
}
test('real HTTP Chat Completions contract sends configured bearer, model and parameters',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const r=await send(f);assert.equal(r.choices[0].message.content,'A complete answer.');
  assert.equal(f.requests[0].url,'/v1/chat/completions');
  assert.equal(f.requests[0].headers.authorization,'Bearer test-only-key');
  assert.equal(f.requests[0].body.model,'selected-model');
  assert.deepEqual(f.requests[0].body.messages,[{role:'user',content:'hello'}]);
});
test('tools, structured-output parameters and usage survive the adapter',async t=>{
  const f=await fixture((_,res)=>res.end(JSON.stringify(completion(null,{choices:[{index:0,message:{role:'assistant',content:null,
    tool_calls:[{id:'call_1',type:'function',function:{name:'search',arguments:'{"q":"hello"}'}}]},finish_reason:'tool_calls'}]}))));t.after(()=>f.close());
  const a=openAICompatible({baseURL:f.url,model:'model'});
  const r=await a.complete({messages:[],parameters:{tools:[{type:'function',function:{name:'search',parameters:{type:'object'}}}],response_format:{type:'json_object'}},signal:AbortSignal.timeout(1000)});
  assert.equal(r.choices[0].message.tool_calls[0].function.name,'search');
  assert.deepEqual(f.requests[0].body.response_format,{type:'json_object'});
});
test('SSE buffers complete multi-byte chunks until DONE and finish reason',async t=>{
  const f=await fixture((_,res)=>{
    res.setHeader('content-type','text/event-stream');
    const body=`data: ${JSON.stringify({choices:[{index:0,delta:{content:'Bonjour 🌍'},finish_reason:null}]})}\r\n\r\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const bytes=Buffer.from(body);for(let i=0;i<bytes.length;i+=3)res.write(bytes.subarray(i,i+3));res.end();
  });t.after(()=>f.close());
  assert.equal((await send(f,{stream:true})).choices[0].message.content,'Bonjour 🌍');
});
for(const variant of ['missing-done','missing-finish','error','malformed','extra-choice'])test(`rejects incomplete or corrupt stream: ${variant}`,async t=>{
  const f=await fixture((_,res)=>{
    res.setHeader('content-type','text/event-stream');
    const first=variant==='error'?{error:{message:'private secret'}}:{choices:[{index:variant==='extra-choice'?1:0,delta:{content:'partial'},finish_reason:variant==='missing-finish'?null:'stop'}]};
    res.end(`data: ${variant==='malformed'?'broken':JSON.stringify(first)}\n\n${variant==='missing-done'?'':'data: [DONE]\n\n'}`);
  });t.after(()=>f.close());
  await assert.rejects(send(f),e=>['incomplete_response','invalid_response'].includes(e.code)&&!e.message.includes('private secret'));
});
test('SSE reconstructs streamed tool-call arguments',async t=>{
  const f=await fixture((_,res)=>{
    res.setHeader('content-type','text/event-stream');
    for(const delta of [{tool_calls:[{index:0,id:'call_1',function:{name:'lookup',arguments:'{"x":'}}]},
      {tool_calls:[{index:0,function:{arguments:'1}'}}]}])res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
    res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);
  });t.after(()=>f.close());
  assert.equal((await send(f)).choices[0].message.tool_calls[0].function.arguments,'{"x":1}');
});
test('redirects never forward credentials or data to a new host',async t=>{
  const sink=await fixture();t.after(()=>sink.close());
  const f=await fixture((_,res)=>{res.writeHead(307,{location:`${sink.url}/stolen`});res.end();});t.after(()=>f.close());
  await assert.rejects(send(f),{code:'transport_error'});assert.equal(sink.requests.length,0);
});
test('bounded response size and upstream error sanitization',async t=>{
  const large=await fixture((_,r)=>r.end('x'.repeat(1000)));t.after(()=>large.close());
  await assert.rejects(send(large,{maxResponseBytes:100}),{code:'response_too_large'});
  const denied=await fixture((_,r)=>{r.statusCode=401;r.end('private-content token');});t.after(()=>denied.close());
  await assert.rejects(send(denied),e=>e.code==='upstream_401'&&!e.retryable&&!e.message.includes('private-content'));
});
test('request parameters cannot override endpoint/model/messages or bypass redirect policy',async t=>{
  const f=await fixture();t.after(()=>f.close());
  const a=openAICompatible({baseURL:f.url,model:'model'});
  for(const parameters of [{model:'other'},{messages:[]},{stream:true},{headers:{}}])await assert.rejects(a.complete({messages:[],parameters}),{code:'invalid_request'});
  assert.equal(f.requests.length,0);
});
test('only HTTPS or explicit loopback HTTP endpoints are accepted',()=>{
  for(const baseURL of ['http://example.com/v1','https://user:password@example.com/v1','https://example.com/v1?secret=x','file:///tmp/foo']){
    assert.throws(()=>openAICompatible({baseURL,model:'x'}));
  }
});
test('interrupted HTTP response recovers only to an authorized endpoint',async t=>{
  const broken=await fixture((_,r)=>{r.writeHead(200);r.write('{"partial":');r.destroy();});t.after(()=>broken.close());
  const good=await fixture();t.after(()=>good.close());
  const b=new Boundary({providers:{a:openAICompatible({baseURL:broken.url,model:'x'}),b:openAICompatible({baseURL:good.url,model:'x'})}});
  const r=await b.complete({messages:[{role:'user',content:b.data('hello',{allow:['a','b']})}],routes:['a','b']});
  assert.equal(r.destination,'b');assert.equal(good.requests.length,1);
});
test('arbitrary upstream metadata is removed from portable completions',async t=>{
  const f=await fixture((_,r)=>r.end(JSON.stringify(completion('ok',{
    provider:'hidden-routing-details',usage:{prompt_tokens:1,private_debug:'secret'},
    choices:[{index:0,logprobs:'secret',message:{role:'assistant',content:'ok',debug:'secret'},finish_reason:'stop'}],
  }))));t.after(()=>f.close());
  const result=await send(f);assert.doesNotMatch(JSON.stringify(result),/secret|hidden-routing|debug|logprobs/);
  assert.equal(result.usage.prompt_tokens,1);
});
