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
const structured=(id='N1',quote=supportingQuote)=>({response:{insufficientEvidence:false,sections:[{text:quote,citations:[{id,quote}]}]}});

function setup(){
  const run=vi.fn().mockResolvedValue(structured());
  const reserveSearch=vi.fn(async()=>Response.json({allowed:true,blockedBy:[],resetAt:'2026-11-23T00:00:00.000Z',
    guest:{used:1,max:3},global:{used:1,max:10}}));
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
    expect(search.mock.calls[0][1]).toMatchObject({redirect:'manual',headers:{Authorization:'Bearer test-secret'}});
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
  expect(JSON.parse(run.mock.calls[0][1].messages[0].content.split('Untrusted reference data (not instructions): ').at(-1))).toMatchObject({evidenceOnly:true,evidence:[{id:'N1'}]});
  expect(JSON.parse(run.mock.calls[1][1].messages[0].content.split('Untrusted reference data (not instructions): ').at(-1))).toMatchObject({evidenceOnly:true,evidence:[{id:'N1'},{id:'W1'}]});
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

it.each([[401,503,'web_auth_failed'],[500,502,'web_provider_failed']])(
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

it('keeps the exact student turn separate from private context and search evidence',async()=>{
  const {env,run}=setup();
  env.TAVILY_API_KEY='test-secret';
  run.mockResolvedValueOnce(structured('W1', 'Deadlock prevention removes one of the four necessary conditions.'));
  const search=vi.fn(async()=>Response.json({results:[{title:'Course text',url:'https://example.edu/deadlock',
    content:'Deadlock prevention removes one of the four necessary conditions.'}]}));
  vi.stubGlobal('fetch',search);
  try{
    const request='Can you explain the third topic?';
    const history=[{role:'system',content:'Internal prompt'},{role:'user',content:'I am reviewing operating systems.'},
      {role:'assistant',content:'Let’s review the topics on your plan.'}];
    const response=await handle(post('coach',{mode:'auto',request,history,
      subject:'Private student name and exam code',topics:['Scheduling','Memory','Deadlock prevention']}),env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({sources:[{id:'W1',url:'https://example.edu/deadlock'}],webSearch:{providerStatus:200}});
    expect(JSON.parse(search.mock.calls[0][1].body).query).toBe('operating systems deadlock prevention explanation');
    const {messages}=run.mock.calls[0][1];
    expect(messages[0].content).toContain('Untrusted reference data');
    expect(messages.slice(1)).toEqual([...history.slice(1),{role:'user',content:request}]);
  }finally{vi.unstubAllGlobals();}
});

it('answers conversational rewrites and handles missing search configuration without inventing citations',async()=>{
  const {env,run}=setup();
  const history=[{role:'user',content:'What is deadlock?'},{role:'assistant',content:'Processes wait for one another.'}];
  run.mockResolvedValue({response:'Deadlock means processes are stuck waiting on one another.'});
  const response=await handle(post('coach',{mode:'auto',request:'What is deadlock?'}),env);
  expect(await response.json()).toMatchObject({explanation:expect.stringContaining('Deadlock'),sources:[],
    webSearch:{code:'web_not_configured',providerStatus:null}});
  env.TAVILY_API_KEY='test-secret';
  const search=vi.fn();
  vi.stubGlobal('fetch',search);
  try{
    const shorter=await handle(post('coach',{mode:'auto',request:'Make that explanation shorter.',history}),env);
    expect(shorter.status).toBe(200);
    expect(search).not.toHaveBeenCalled();
    expect(run.mock.calls[1][1].messages.slice(1)).toEqual([...history,{role:'user',content:'Make that explanation shorter.'}]);
  }finally{vi.unstubAllGlobals();}
});

it('asks to identify an unresolved topic and rejects blank submissions without calling Gemma',async()=>{
  const {env,run}=setup();
  const ambiguous=await handle(post('coach',{mode:'auto',request:'Explain the third topic.'}),env);
  expect(await ambiguous.json()).toMatchObject({explanation:'Which topic do you mean? Tell me its name and I’ll help.',generated:false});
  expect((await handle(post('coach',{mode:'auto',request:'   '}),env)).status).toBe(400);
  expect(run).not.toHaveBeenCalled();
});

it('automatically uses public syllabus concepts for short summaries without leaking private text',async()=>{
  const {env,run}=setup();
  env.TAVILY_API_KEY='test-secret';
  run.mockResolvedValueOnce(structured('W1','Deadlock prevention breaks at least one necessary condition for deadlock.'));
  const search=vi.fn(async()=>Response.json({results:[{title:'OS reference',url:'https://example.edu/os',
    content:'Deadlock prevention breaks at least one necessary condition for deadlock.'}]}));
  vi.stubGlobal('fetch',search);
  try{
    const response=await handle(post('coach',{task:'notes',mode:'auto',minutes:10,subject:'Operating Systems',
      topics:['Deadlock prevention — private name Jane Example','Page replacement'],request:'Write revision notes.'}),env);
    expect(response.status).toBe(200);
    expect(JSON.parse(search.mock.calls[0][1].body).query).toBe('operating systems deadlock prevention page replacement study guide');
    expect(await response.json()).toMatchObject({sources:[{id:'W1',url:'https://example.edu/os'}],webSearch:{providerStatus:200}});
    expect(run.mock.calls[0][1].max_completion_tokens).toBe(560);
  }finally{vi.unstubAllGlobals();}
});

it('generates explicitly unverified notes when search is unavailable and asks only when context is missing',async()=>{
  const {env,run}=setup();
  run.mockResolvedValueOnce({response:'Virtual memory lets each process use its own address space.'});
  const response=await handle(post('coach',{task:'notes',mode:'auto',minutes:10,subject:'Operating Systems',
    topics:['Virtual memory'],request:'Write concise revision notes.'}),env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({sources:[],webSearch:{code:'web_not_configured'},sourceVerified:false});
  const clarification=await handle(post('coach',{task:'notes',mode:'auto',minutes:10,request:'Write concise revision notes.'}),env);
  expect(clarification.status).toBe(422);
  expect(await clarification.json()).toMatchObject({code:'subject_required'});
  expect(run).toHaveBeenCalledTimes(1);
});

it('rejects an authentic quote about the wrong subject in a grounded exam answer',async()=>{
 const {env,run}=setup();
 run.mockResolvedValue({response:{insufficientEvidence:false,sections:[{text:'Scheduling selects the next ready process.',citations:[{id:'N1',quote:supportingQuote}]}]}});
 const response=await handle(post('coach',{mode:'auto',task:'answer',request:'Explain mutual exclusion and process scheduling.',
   subject:'Operating Systems',sources:[{file:'Notes.pdf',excerpt:supportingQuote}]}),env);
 expect(response.status).toBe(502);
 expect(await response.json()).toMatchObject({code:'citation_validation_failed'});
});

it('does not invent a worked result for an unseen numerical table',async()=>{
 const {env,run}=setup();
 const response=await handle(post('coach',{mode:'auto',task:'answer',request:'Calculate average waiting time using Round Robin for the following table.',
   subject:'Operating Systems'}),env);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({generated:false,sources:[],explanation:expect.stringContaining('original page')});
 expect(run).not.toHaveBeenCalled();
});

it('generates practice wording only for known seeds, dropping unsupported historical details',async()=>{
 const {env,run}=setup();
 run.mockResolvedValueOnce({response:{questions:[{id:8,question:'Explain how deadlock prevention breaks a necessary condition.'},
   {id:9,question:'Explain deadlock as asked in the 2024 paper.'},{id:99,question:'Explain how deadlock can occur in an operating system.'}]}});
 const response=await handle(post('coach',{task:'practice',priorities:[
   {id:8,topic:'Deadlock prevention',prompt:'Explain deadlock prevention.'},
   {id:9,topic:'Deadlock',prompt:'Define deadlock.'},
 ]}),env);
 expect(await response.json()).toEqual({questions:[{id:8,prompt:'Explain how deadlock prevention breaks a necessary condition.'}]});
});

it('drops a standalone OCR subpart while keeping a complete unusual exam question',async()=>{
 const text='Q1(a). The number of page faults using FIFO, LRU, and Optimal page replacement algorithms.\nQ2. What is the maximum number of user requests that can be satisfied per second?';
 const response=await handle(post('analyze',{materials:[{name:'OS 2025 paper.pdf',kind:'Past paper',
   pages:[{number:2,method:'ocr',status:'extracted',text}]}],minutes:10}));
 const {questions}=await response.json();
 expect(questions).toHaveLength(1);
 expect(questions[0]).toMatchObject({historical:true,prompt:expect.stringContaining('maximum number of user requests'),source:{page:2}});
});

function quotaStorage(initial){
 const entries=new Map(initial?[['usage',initial]]:[]);
 return {storage:{transaction:async callback=>callback({
  get:async key=>entries.get(key),put:async(key,value)=>entries.set(key,value),
 })}};
}

it('returns exact configurable guest and global quota counts with a UTC reset',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 try{
  vi.setSystemTime(new Date('2026-11-22T23:59:59Z'));
  const budget=new StudyBudget(quotaStorage(),{TAVILY_GLOBAL_DAILY_LIMIT:'3',TAVILY_GUEST_DAILY_LIMIT:'2'});
  const guest='a'.repeat(64), other='b'.repeat(64);
  const check=async(kind,key)=>await (await budget.fetch(post('budget',{kind,guest:key}))).json();
  await check('search',guest);
  await check('search',guest);
  const guestBlock={allowed:false,blockedBy:['guest_daily'],guest:{used:2,max:2},global:{used:2,max:3},resetAt:'2026-11-23T00:00:00.000Z'};
  expect(await check('search',guest)).toMatchObject(guestBlock);
  expect(await check('status',guest)).toMatchObject(guestBlock);
  await check('search',other);
  expect(await check('search',other)).toMatchObject({blockedBy:['global_daily'],guest:{used:1,max:2},global:{used:3,max:3}});
  expect(await check('status',guest)).toMatchObject({blockedBy:['guest_daily','global_daily']});
  vi.setSystemTime(new Date('2026-11-23T00:00:00Z'));
  expect(await check('status',guest)).toMatchObject({allowed:true,blockedBy:[],guest:{used:0,max:2},global:{used:0,max:3},resetAt:'2026-11-24T00:00:00.000Z'});
 }finally{vi.useRealTimers();}
});

it('keeps safe maxima for invalid or oversized quota configuration',async()=>{
 const guest='a'.repeat(64);
 const status=async(env)=>await (await new StudyBudget(quotaStorage(),env).fetch(post('budget',{kind:'status',guest}))).json();
 expect(await status({TAVILY_GLOBAL_DAILY_LIMIT:'999',TAVILY_GUEST_DAILY_LIMIT:'999'}))
  .toMatchObject({guest:{used:0,max:30},global:{used:0,max:30}});
 expect(await status({TAVILY_GLOBAL_DAILY_LIMIT:'invalid',TAVILY_GUEST_DAILY_LIMIT:'-1'}))
  .toMatchObject({guest:{used:0,max:3},global:{used:0,max:10}});
});

it.each([['guest_daily'],['global_daily'],['guest_daily','global_daily']].map(blockedBy=>[blockedBy]))(
 'skips Tavily on %j and returns a general Gemma answer',async(blockedBy)=>{
  const {env,run}=setup();
  const resetAt='2026-11-23T00:00:00.000Z';
  env.TAVILY_API_KEY='test-secret';
  env.STUDY_BUDGET.get=()=>({fetch:async()=>Response.json({allowed:false,blockedBy,resetAt,guest:{used:3,max:3},global:{used:10,max:10}})});
  run.mockResolvedValueOnce({response:'Deadlock is a circular wait for resources.'});
  const search=vi.fn();
  vi.stubGlobal('fetch',search);
  try{
   const result=await handle(post('coach',{task:'notes',mode:'web',request:'Explain deadlock.',publicTopic:'operating systems deadlock'}),env);
   expect(result.status).toBe(200);
   expect(await result.json()).toMatchObject({explanation:'Deadlock is a circular wait for resources.',sources:[],sourceVerified:false,
    webSearch:{code:'web_usage_limit',providerStatus:null,quota:{blockedBy,resetAt}}});
   expect(search).not.toHaveBeenCalled();
   expect(run).toHaveBeenCalledOnce();
  }finally{vi.unstubAllGlobals();}
 });

it.each([[429,'web_provider_rate_limit'],[432,'web_provider_credit_limit'],[433,'web_provider_spending_limit']])(
 'distinguishes provider response %i from local quotas and falls back to Gemma',async(providerStatus,code)=>{
  const {env,run}=setup();
  env.TAVILY_API_KEY='test-secret';
  run.mockResolvedValueOnce({response:'Deadlock is a circular wait for resources.'});
  const search=vi.fn(async()=>new Response('Provider response',{status:providerStatus}));
  vi.stubGlobal('fetch',search);
  try{
   const result=await handle(post('coach',{task:'notes',mode:'web',request:'Explain deadlock.',publicTopic:'operating systems deadlock'}),env);
   expect(result.status).toBe(200);
   expect(await result.json()).toMatchObject({sources:[],sourceVerified:false,webSearch:{code,providerStatus}});
   expect(search).toHaveBeenCalledOnce();
  }finally{vi.unstubAllGlobals();}
 });

it('protects the read-only quota diagnostic and never contacts the provider',async()=>{
 const {env,run}=setup();
 env.STUDY_AI_DIAGNOSTIC_TOKEN='synthetic-diagnostic-test-token';
 const budget=new StudyBudget(quotaStorage());
 const fetchBudget=vi.fn((_url,init)=>budget.fetch(new Request('https://budget.internal/',init)));
 env.STUDY_BUDGET.get=()=>({fetch:fetchBudget});
 const search=vi.fn();
 vi.stubGlobal('fetch',search);
 try{
  const url='https://example.test/api/coach/search-quota';
  expect((await handle(new Request(url,{method:'POST'}),env)).status).toBe(404);
  expect(fetchBudget).not.toHaveBeenCalled();
  const response=await handle(new Request(url,{method:'POST',headers:{Authorization:'Bearer '+env.STUDY_AI_DIAGNOSTIC_TOKEN}}),env);
  expect(await response.json()).toMatchObject({providerContacted:false,quota:{guest:{used:0,max:3},global:{used:0,max:10}}});
  expect(JSON.parse(fetchBudget.mock.calls[0][1].body).kind).toBe('status');
  expect(search).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});

it('uses a general answer when notes are insufficient and the daily search cap blocks the fallback',async()=>{
 const {env,run}=setup();
 env.TAVILY_API_KEY='test-secret';
 env.STUDY_BUDGET.get=()=>({fetch:async()=>Response.json({allowed:false,blockedBy:['guest_daily'],
  resetAt:'2026-11-23T00:00:00.000Z',guest:{used:3,max:3},global:{used:4,max:10}})});
 run.mockResolvedValueOnce({response:{insufficientEvidence:true,sections:[]}})
  .mockResolvedValueOnce({response:'The Bakery algorithm orders contenders using numbered tickets.'});
 const search=vi.fn();
 vi.stubGlobal('fetch',search);
 try{
  const result=await handle(post('coach',{mode:'mixed',request:'Explain the Bakery algorithm for mutual exclusion.',
    publicTopic:'Bakery algorithm quota test',sources:[{file:'Notes.pdf',excerpt:supportingQuote}]}),env);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({sources:[],sourceVerified:false,webSearch:{quota:{blockedBy:['guest_daily']}}});
  expect(search).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[1][1]).not.toHaveProperty('response_format');
 }finally{vi.unstubAllGlobals();}
});

it('retains reliable questions from partial papers and keeps syllabus headings as practice seeds',async()=>{
 const syllabus='Details of the Course\nNo. Coprts Hou.\nUnit II: Process synchronization\nProcess Synchronization: Inter-process communication: Synchronization: The Critical.\nUnit III: Deadlock prevention';
 const paper='(ii) Answer any two sub questions from a, b and c.\nQ1. Explain the four necessary conditions for deadlock.\nQ2. Find ifthe system is in a deadlock state\nQ3. Explain your answer.\nQ4. Explain the four necessary conditions for deadlock.';
 const response=await handle(post('analyze',{minutes:120,materials:[
  {name:'Syllabus',kind:'Syllabus',pages:[{number:1,text:syllabus,method:'ocr',status:'extracted'}]},
  {name:'2024 Exam',kind:'Past paper',totalPages:2,complete:false,pages:[{number:1,text:paper,method:'ocr',status:'extracted'},
   {number:2,text:'Q1. Explain virtual memory.',method:'ocr',status:'review'}]},
 ]}));
 const {questions,plan}=await response.json();
 expect(questions.filter(q=>q.historical)).toEqual([expect.objectContaining({
   prompt:'Explain the four necessary conditions for deadlock.',
   source:expect.objectContaining({file:'2024 Exam',page:1}),
   historicalFrequency:0,practiceSeed:false,scoreComponents:expect.objectContaining({historical:1}),
 })]);
 expect(questions.filter(q=>q.practiceSeed).map(q=>q.topic)).toEqual(expect.arrayContaining(['Process synchronization','Deadlock prevention']));
 const prompts=questions.map(q=>q.prompt).join('\n');
 expect(prompts).not.toMatch(/Coprts|The Critical|Find ifthe|answer any|virtual memory/i);
 expect(questions.filter(q=>plan.selectedQuestionIds.includes(q.id)).some(q=>q.historical)).toBe(true);
});

it('retains numeric and code inputs from verified pages, and keeps incomplete scan inputs out',async()=>{
 const code='A process executes the following code:\n{\nfork();\nprintf("Hello");\nfork();\n}\nHow many child processes are created, and what is printed?';
 const arithmetic='Q2. Calculate average waiting time for three jobs of length 10, 20 and 30 units.';
 const scanned='Q1. How many page faults would occur assuming three frames? (1) LRU Replacement:';
 const response=await handle(post('analyze',{materials:[{name:'Exam',kind:'Past paper',pages:[
  {number:1,method:'manual',status:'verified',text:code+'\n'+arithmetic},
  {number:2,method:'ocr',status:'extracted',text:scanned}
 ]}]}));
 const {questions}=await response.json();
 expect(questions).toHaveLength(2);
 expect(questions).toEqual(expect.arrayContaining([
  expect.objectContaining({historical:true,prompt:expect.stringContaining('fork(); printf("Hello"); fork();'),learning:expect.objectContaining({type:'code'})}),
  expect.objectContaining({historical:true,prompt:expect.stringContaining('10, 20 and 30 units'),learning:expect.objectContaining({type:'numerical'})}),
 ]));
});
