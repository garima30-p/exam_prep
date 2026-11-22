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

function setup(responses=[true]){
  const run=vi.fn().mockResolvedValue({response:'SOURCES: N1 W1 N99\nMutual exclusion protects the shared resource.'});
  const charge=vi.fn(async()=>Response.json({allowed:responses.shift()??true}));
  const env={STUDY_AI_ENABLED:'true',AI:{run},STUDY_BUDGET:{idFromName:()=>1,get:()=>({fetch:charge})}};
  return {env,run,charge};
}

it('requires opt-in and refuses exhausted global allowances before calling Gemma',async()=>{
  const {env,run}=setup([false,true]);
  const body={request:'Explain mutual exclusion',mode:'notes',sources:[{file:'Notes.pdf',page:7,excerpt:'Mutual exclusion protects the shared resource.'}]};
  expect((await handle(post('coach',body))).status).toBe(503);
  expect((await handle(post('coach',body),env)).status).toBe(429);
  expect(run).not.toHaveBeenCalled();
  const answer=await (await handle(post('coach',body),env)).json();
  expect(run).toHaveBeenCalledWith(MODEL,expect.objectContaining({
    max_completion_tokens:300,chat_template_kwargs:{enable_thinking:false},
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
    const answer=await (await handle(post('coach',{...body,mode:'web'}),env)).json();
    expect(answer.sources).toMatchObject([{id:'W1',url:'https://example.edu/concurrency'}]);
    expect(JSON.parse(search.mock.calls[0][1].body)).toMatchObject({query:'mutual exclusion',search_depth:'basic',max_results:3,include_answer:false});
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

it('limits concurrent inference globally and releases only the matching lease',async()=>{
  const entries=new Map();
  const budget=new StudyBudget({storage:{transaction:async callback=>callback({
    get:async key=>entries.get(key),put:async(key,value)=>entries.set(key,value),
  })}});
  const ask=async(index,kind='ai',lease='lease-'+index)=>{
    const response=await budget.fetch(post('budget',{kind,lease,guest:index.toString(16).padStart(64,'0')}));
    return (await response.json()).allowed;
  };
  expect(await ask(1)).toBe(true);
  expect(await ask(2)).toBe(true);
  expect(await ask(3)).toBe(false);
  await ask(1,'release','wrong lease');
  expect(await ask(3)).toBe(false);
  await ask(1,'release');
  expect(await ask(3)).toBe(true);
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
