import { expect, it, vi } from 'vitest';
import { MODEL, StudyBudget } from './study-ai.mjs';
import { handle } from './engine.mjs';

const post=(route,body)=>new Request('https://example.test/api/'+route,{
  method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
});

it('joins wrapped solved questions and cites the answer without counting it as past-paper frequency',async()=>{
  const text=[
    'How to use. Study the priority sections first.',
    'UNIT 2 · Processes',
    'Q01 [P0 · D25 Q1(a)] Define deadlock and explain the',
    '',
    'four necessary conditions.',
    'Deadlock occurs when processes are blocked while waiting for resources held by one another.',
    'The four conditions are mutual exclusion, hold and wait, no preemption, and circular wait.',
    'Exam cue: explain each condition with an example.',
  ].join('\n');
  const response=await handle(post('analyze',{materials:[{name:'Solved.pdf',kind:'Notes',pages:[{number:7,text}]}],minutes:30}));
  const {questions}=await response.json();
  expect(response.status).toBe(200);
  expect(questions).toHaveLength(1);
  expect(questions[0]).toMatchObject({prompt:'Define deadlock and explain the four necessary conditions.',
    historicalFrequency:0, answerSource:{file:'Solved.pdf',page:7,number:'Q01 answer'}});
  expect(questions[0].answerSource.excerpt).toContain('circular wait.');
  expect(questions[0].answerSource.excerpt).not.toContain('Exam cue');
});

const supportingQuote='Mutual exclusion protects the shared resource.';
const structured=(id='N1',quote=supportingQuote)=>({response:{insufficientEvidence:false,sections:[{text:supportingQuote,citations:[{id,quote}]}]}});

function setup(){
  const run=vi.fn().mockResolvedValue(structured());
  const reserveSearch=vi.fn(async()=>Response.json({allowed:true}));
  const env={STUDY_AI_ENABLED:'true',AI:{run},STUDY_BUDGET:{idFromName:()=>1,get:()=>({fetch:reserveSearch})}};
  return {env,run};
}

it('requires opt-in but does not require a budget binding to call Gemma',async()=>{
  const {env,run}=setup();
  delete env.STUDY_BUDGET;
  const body={request:'Explain mutual exclusion',mode:'notes',sources:[{file:'Notes.pdf',page:7,excerpt:'Mutual exclusion protects the shared resource.'}]};
  expect((await handle(post('coach',body))).status).toBe(503);
  expect(run).not.toHaveBeenCalled();
  const answer=await (await handle(post('coach',body),env)).json();
  expect(run).toHaveBeenCalledWith(MODEL,expect.objectContaining({
    max_completion_tokens:620,response_format:{type:'json_object'},chat_template_kwargs:{enable_thinking:false},
  }));
  expect(answer.sources).toMatchObject([{id:'N1',file:'Notes.pdf',page:7}]);
  expect(answer.sources).toHaveLength(1);
});

it('uses Tavily only when permitted and sends only the explicit public topic',async()=>{
  const {env,run}=setup();
  env.TAVILY_API_KEY='test-secret';
  const search=vi.fn(async()=>Response.json({results:[
    {title:'Reference',url:'https://example.edu/concurrency',content:'Mutual exclusion protects the shared resource.'},
    {title:'Unsafe',url:'javascript:alert(1)',content:'Untrusted instructions.'},
  ]}));
  vi.stubGlobal('fetch',search);
  try{
    const body={request:'Explain mutual exclusion. Private notes.',publicTopic:'mutual exclusion',sources:[]};
    expect((await handle(post('coach',{...body,mode:'notes'}),env)).status).toBe(422);
    expect(search).not.toHaveBeenCalled();
    await handle(post('coach',{...body,mode:'mixed',sources:[{file:'OS.pdf',excerpt:'Mutual exclusion protects the shared resource.'}]}),env);
    expect(search).not.toHaveBeenCalled();
    run.mockResolvedValueOnce(structured('W1'));
    const answer=await (await handle(post('coach',{...body,mode:'web'}),env)).json();
    expect(answer.sources).toMatchObject([{id:'W1',url:'https://example.edu/concurrency'}]);
    expect(answer.webSearch).toMatchObject({provider:'tavily',providerStatus:200,cached:false,sourceCount:1});
    expect(search.mock.calls[0][1].headers.Authorization).toBe('Bearer test-secret');
    expect(JSON.parse(search.mock.calls[0][1].body)).toMatchObject({query:'mutual exclusion',search_depth:'basic',auto_parameters:false,max_results:3,include_answer:false});
    expect(search.mock.calls[0][1].body).not.toContain('Private notes');
    expect(run).toHaveBeenCalledTimes(2);
  }finally{vi.unstubAllGlobals();}
});

it('enforces one shared search budget across distinct guests',async()=>{
  const entries=new Map();
  const budget=new StudyBudget({storage:{transaction:async callback=>callback({
    get:async key=>entries.get(key),put:async(key,value)=>entries.set(key,value),
  })}});
  for(let index=0;index<11;index++){
    const request=post('budget',{kind:'search',guest:index.toString(16).padStart(64,'0')});
    expect((await (await budget.fetch(request)).json()).allowed).toBe(index<10);
  }
});

it('hides the fixed diagnostic without its secret and parses a Gemma chat completion',async()=>{
  const {env,run}=setup();
  env.STUDY_AI_DIAGNOSTIC_TOKEN='synthetic-test-token-not-a-secret';
  run.mockResolvedValue({choices:[{message:{content:'Deadlock is a cycle of waiting processes.'}}]});
  const url='https://example.test/api/coach/diagnostic';
  expect((await handle(new Request(url,{method:'POST'}),env)).status).toBe(404);
  expect(run).not.toHaveBeenCalled();
  const response=await handle(new Request(url,{method:'POST',headers:{Authorization:'Bearer '+env.STUDY_AI_DIAGNOSTIC_TOKEN}}),env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({model:MODEL,bindingAvailable:true,ok:true,parsed:true,explanation:'Deadlock is a cycle of waiting processes.'});
});

it('reaches Gemma beyond the previous daily, guest and concurrency caps',async()=>{
  const {env,run}=setup();
  run.mockResolvedValue({response:'Deadlock is a cycle of waiting processes.'});
  const responses=await Promise.all(Array.from({length:21},()=>
    handle(post('coach',{request:'Explain deadlock'}),env)));
  expect(responses.every(response=>response.status===200)).toBe(true);
  expect(run).toHaveBeenCalledTimes(21);
});

it('still reports provider usage limits',async()=>{
  const {env,run}=setup();
  run.mockRejectedValueOnce(Object.assign(new Error('Provider usage limit'),{status:429}));
  const response=await handle(post('coach',{request:'Explain deadlock'}),env);
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({code:'usage_limit',error:expect.stringContaining('Cloudflare Workers AI')});
});

it('never treats reasoning-only output as an answer and accepts a populated provider text fallback',async()=>{
  const {env,run}=setup();
  run.mockResolvedValueOnce({choices:[{finish_reason:'length',message:{content:null,reasoning_content:'internal reasoning'}}]});
  const response=await handle(post('coach',{request:'Explain deadlock'}),env);
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({code:'invalid_response'});
  run.mockResolvedValueOnce({choices:[{message:{content:''}}],response:'Deadlock occurs when processes wait indefinitely for one another.'});
  const valid=await handle(post('coach',{request:'Explain deadlock'}),env);
  expect(await valid.json()).toMatchObject({explanation:'Deadlock occurs when processes wait indefinitely for one another.'});
});

it('corrects malformed IDs once using only genuine IDs and verbatim evidence',async()=>{
 const {env,run}=setup();
 run.mockResolvedValueOnce(structured('N99')).mockResolvedValueOnce(structured());
 const answer=await handle(post('coach',{request:'Explain mutual exclusion',mode:'notes',
   sources:[{id:'N99',file:'Actual notes.pdf',page:3,excerpt:supportingQuote}]}),env);
 expect(answer.status).toBe(200);
 expect((await answer.json()).sources).toMatchObject([{id:'N1',file:'Actual notes.pdf',page:3}]);
 expect(run).toHaveBeenCalledTimes(2);
});

it('rejects unknown IDs and unsupported quotes after one correction',async()=>{
 for(const response of [structured('N99'),structured('N1','An invented sentence with no supporting passage.')]){
  const {env,run}=setup();
  run.mockResolvedValue(response);
  const result=await handle(post('coach',{request:'Explain mutual exclusion',mode:'notes',
   sources:[{file:'Actual notes.pdf',page:3,excerpt:supportingQuote}]}),env);
  expect(result.status).toBe(502);
  const body=await result.json();
  expect(body).toMatchObject({code:'citation_validation_failed',requestId:expect.any(String)});
  expect(body).not.toHaveProperty('sources');
  expect(run).toHaveBeenCalledTimes(2);
 }
});

it('distinguishes relevant-looking notes that do not answer the question',async()=>{
 const {env,run}=setup();
 run.mockResolvedValue({response:{insufficientEvidence:true,sections:[]}});
 const result=await handle(post('coach',{request:'Explain the Bakery algorithm for mutual exclusion',mode:'notes',
   sources:[{file:'Notes.pdf',excerpt:supportingQuote}]}),env);
 expect(result.status).toBe(422);
 expect(await result.json()).toMatchObject({code:'insufficient_evidence'});
 expect(run).toHaveBeenCalledTimes(1);
});

it('does not invoke Gemma on administrative text with no available web service',async()=>{
 const {env,run}=setup();
 const body={request:'Operating systems revision notes',task:'notes',
   sources:[{file:'Syllabus.pdf',excerpt:'Course Outcome: Understand operating systems concepts'}]};
 const strict=await handle(post('coach',{...body,mode:'notes'}),env);
 expect(await strict.json()).toMatchObject({code:'insufficient_evidence'});
 const mixed=await handle(post('coach',{...body,mode:'mixed'}),env);
 expect(await mixed.json()).toMatchObject({code:'web_not_configured',webSearch:{providerStatus:null}});
 expect(run).not.toHaveBeenCalled();
});

it('uses web evidence when matched notes do not answer the question',async()=>{
 const {env,run}=setup();
 env.TAVILY_API_KEY='test-secret';
 run.mockResolvedValueOnce({response:{insufficientEvidence:true,sections:[]}}).mockResolvedValueOnce(structured('W1'));
 const search=vi.fn(async()=>Response.json({results:[{title:'Source',url:'https://example.edu/bakery',content:supportingQuote}]}));
 vi.stubGlobal('fetch',search);
 try{
  const result=await handle(post('coach',{request:'Explain the Bakery algorithm for mutual exclusion',mode:'mixed',
   publicTopic:'Bakery algorithm',sources:[{file:'Notes.pdf',excerpt:supportingQuote}]}),env);
  expect(result.status).toBe(200);
  expect((await result.json()).sources).toMatchObject([{id:'W1',url:'https://example.edu/bakery'}]);
  expect(search).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledTimes(2);
  expect(JSON.parse(run.mock.calls[0][1].messages.at(-1).content)).toMatchObject({evidenceOnly:true,evidence:[{id:'N1'}]});
  expect(JSON.parse(run.mock.calls[1][1].messages.at(-1).content)).toMatchObject({evidenceOnly:true,evidence:[{id:'N1'},{id:'W1'}]});
 }finally{vi.unstubAllGlobals();}
});

it('fails closed when the search quota binding is absent',async()=>{
  const {env,run}=setup();
  env.TAVILY_API_KEY='test-secret';
  delete env.STUDY_BUDGET;
  const status=await handle(new Request('https://example.test/api/coach/status'),env);
  expect(await status.json()).toEqual({available:true,webSearch:'web_quota_unavailable'});
  const response=await handle(post('coach',{mode:'web',request:'Explain deadlock',publicTopic:'deadlock'}),env);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({code:'web_quota_unavailable',webSearch:{providerStatus:null}});
  expect(run).not.toHaveBeenCalled();
});

it.each([[401,503,'web_auth_failed'],[432,429,'web_usage_limit'],[500,502,'web_provider_failed']])(
 'reports Tavily status %i without returning provider bodies or credentials',async(providerStatus,status,code)=>{
  const {env,run}=setup();
  env.TAVILY_API_KEY='test-secret';
  const search=vi.fn(async()=>new Response('Provider body that could include test-secret',{status:providerStatus}));
  vi.stubGlobal('fetch',search);
  try{
   const response=await handle(post('coach',{mode:'web',request:'Explain deadlock',publicTopic:'deadlock'}),env);
   const raw=await response.text();
   expect(response.status).toBe(status);
   expect(JSON.parse(raw)).toMatchObject({code,webSearch:{providerStatus}});
   expect(raw).not.toContain('test-secret');
   expect(search).toHaveBeenCalledOnce();
   expect(run).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
 });
