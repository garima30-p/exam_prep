import {afterEach,expect,it,vi} from 'vitest';
import {academicResult,academicScope} from './academic-sources.mjs';
import {handle} from './engine.mjs';

afterEach(()=>vi.unstubAllGlobals());

const budget=()=>Response.json({allowed:true,blockedBy:[],resetAt:'2026-11-24T00:00:00.000Z',guest:{used:1,max:3},global:{used:1,max:10}});

const post=body=>new Request('https://example.test/api/coach',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
});

it('restricts the first search to the requested institution and sends only public academic metadata',async()=>{
 const didSearch=vi.fn(async()=>Response.json({results:[]}));
 vi.stubGlobal('fetch',didSearch);
 const env={STUDY_AI_ENABLED:'true',AI:{run:vi.fn()},TAVILY_API_KEY:'runtime-secret',
  STUDY_BUDGET:{idFromName:()=>1,get:()=>({fetch:async()=>budget()})}};
 const response=await handle(post({task:'academic',subject:'Operating Systems',
  university:'Graphic Era Hill University TCS502 2024 endsem. Jane Doe, roll number 5799.',
  sources:[{excerpt:'Private student notes'}]}),env);
 expect(response.status).toBe(200);
 const request=JSON.parse(didSearch.mock.calls[0][1].body);
 expect(request.include_domains).toEqual(['gehu.ac.in']);
 expect(request.query).toContain('Operating Systems'.toLowerCase()+' TCS502 2024 endsem');
 expect(request.query).not.toMatch(/Jane|5799|Private/);
 expect((await response.json()).officialSearch).toMatchObject({attempted:true,providerStatus:200,relevantCount:0});
});

it('requires the institution and matching exam metadata before calling a paper official',()=>{
 const scope=academicScope('IIT Kanpur CS330 endsem 2024');
 const policy={scope,subject:'Operating Systems',course:true};
 const paper={url:'https://cse.iitk.ac.in/exams/cs330-2024.pdf',title:'Operating Systems CS330 endsem 2024',content:'Operating Systems semester exam questions.',
  raw_content:'Operating Systems CS330 endsem 2024\nQ1. Explain the four necessary conditions for deadlock.'};
 expect(academicResult(paper,policy)).toMatchObject({category:'official-pyq',publisher:'IIT Kanpur',
  questions:['Explain the four necessary conditions for deadlock.']});
 expect(academicResult({...paper,url:'https://iitd.ac.in/exams/cs330-2024.pdf'},policy)).toBeNull();
 expect(academicResult({...paper,url:'https://cse.iitk.ac.in/gate/cs330-2024.pdf'},policy)).toBeNull();
 expect(academicResult({...paper,title:paper.title.replace('2024','2023'),raw_content:paper.raw_content.replace('2024','2023')},policy)).toBeNull();
});

it('returns the exact source link and supporting quote only after citation validation',async()=>{
 const quote='A database deadlock occurs when transactions wait in a cycle for locks held by one another.';
 const url='https://cs.stanford.edu/courses/database-locking.html';
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({results:[{url,title:'Database Management Systems: Deadlocks and locks',content:quote}]})));
 const run=vi.fn(async()=>({response:{insufficientEvidence:false,sections:[{text:quote,citations:[{id:'W1',quote}]}]}}));
 const env={STUDY_AI_ENABLED:'true',AI:{run},TAVILY_API_KEY:'runtime-secret',
  STUDY_BUDGET:{idFromName:()=>1,get:()=>({fetch:async()=>budget()})}};
 const response=await handle(post({task:'notes',mode:'auto',subject:'DBMS',topic:'deadlock',topics:['deadlock'],
  request:'Explain database deadlock',academicGrounding:true}),env);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({evidenceSupplied:1,citationCount:1,
  webSearch:{attempted:true,providerStatus:200,relevantCount:1},
  sources:[{url,publisher:'Stanford University',category:'academic-reference',supportingQuote:quote}]});
 expect(run).toHaveBeenCalledOnce();
});

it('falls back explicitly without inventing a source when web retrieval is unavailable',async()=>{
 const run=vi.fn(async()=>({response:'Serializability means matching the outcome of a serial schedule.'}));
 const response=await handle(post({task:'notes',mode:'auto',subject:'DBMS',topic:'serializability',topics:['serializability'],
  request:'Explain serializability',academicGrounding:true}),{STUDY_AI_ENABLED:'true',AI:{run}});
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({sourceVerified:false,evidenceSupplied:0,citationCount:0,sources:[],
  webSearch:{attempted:false,code:'web_not_configured'}});
});
 
it('fills a short practice batch once and excludes previously returned questions',async()=>{
 const first='Explain how a cycle in a wait-for graph indicates database deadlock.';
 const duplicate='Explain how a cycle in a wait-for graph indicates database deadlock.';
 const second='Compare the wait-die and wound-wait deadlock prevention policies.';
 const run=vi.fn()
  .mockResolvedValueOnce({response:{questions:[{question:first},{question:'Explain how photosynthesis converts light into chemical energy.'},{question:'Calculate the average waiting time from the table below.'}]}})
  .mockResolvedValueOnce({response:{questions:[{question:duplicate},{question:second}]}});
 const response=await handle(post({task:'practiceBatch',subject:'DBMS',topic:'Deadlocks',count:5,
  academicGrounding:true}),{STUDY_AI_ENABLED:'true',AI:{run}});
 expect(response.status).toBe(200);
 expect((await response.json()).questions).toEqual([{prompt:first},{prompt:second}]);
 expect(run).toHaveBeenCalledTimes(2);
 expect(JSON.parse(run.mock.calls[1][1].messages[1].content).exclude).toContain(first);
});

it('coalesces simultaneous equivalent public searches and reuses them without reserving extra quota',async()=>{
 const provider=vi.fn(async()=>Response.json({results:[{
  url:'https://cs.stanford.edu/concurrency/dbms-locks.html',title:'Database Management Systems: Database deadlock',
  content:'Database deadlock can occur when transactions wait in a cycle for locks.',
 }]}));
 vi.stubGlobal('fetch',provider);
 const reserve=vi.fn(async()=>budget());
 const run=vi.fn(async()=>({response:{insufficientEvidence:false,sections:[{
  text:'Database deadlock can occur when transactions wait in a cycle for locks.',
  citations:[{id:'W1',quote:'Database deadlock can occur when transactions wait in a cycle for locks.'}]
 }]}}));
 const env={STUDY_AI_ENABLED:'true',AI:{run},TAVILY_API_KEY:'runtime-secret',
  STUDY_BUDGET:{idFromName:()=>1,get:()=>({fetch:reserve})}};
 const input={task:'notes',mode:'auto',subject:'DBMS',topic:'database deadlock',topics:['deadlock'],
  request:'Explain database deadlock',academicGrounding:true};
 const replies=await Promise.all([handle(post(input),env),handle(post(input),env),handle(post(input),env)]);
 expect(replies.every(response=>response.ok)).toBe(true);
 expect(provider).toHaveBeenCalledOnce();
 expect(reserve).toHaveBeenCalledOnce();
 expect((await (await handle(post(input),env)).json()).webSearch).toMatchObject({cached:true,attempted:false});
});

it('builds a general topic map from an inspected curriculum without a model call',async()=>{
 const run=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(
  '<h2>Course Contents:</h2><ol><li>Introduction: system calls.</li><li>Process Synchronization: semaphores and race conditions.</li></ol>',
  {headers:{'content-type':'text/html'}}
 )));
 try{
  const response=await handle(post({task:'outline',subject:'Operating Systems',academicGrounding:true}),{STUDY_AI_ENABLED:'true',AI:{run}});
  expect(response.status).toBe(200);
  const payload=await response.json();
  expect(payload.topics).toEqual(expect.arrayContaining([
   expect.objectContaining({title:'System calls',reference:expect.objectContaining({url:'https://cse.iitk.ac.in/pages/CS330.html',category:'academic-reference'})}),
   expect.objectContaining({title:'Process Synchronization',validation:'published-curriculum'}),
  ]));
  expect(run).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});

it('infers an explicitly provisional hierarchy when published material is unavailable',async()=>{
 const response=JSON.stringify({topics:[
  {title:'Linear systems',group:''},
  {title:'Gaussian elimination',group:'Linear systems'},
  {title:'gaussian elimination',group:'Missing parent'},
  {title:'Suggested textbooks',group:''},
 ]});
 const run=vi.fn(async()=>({response}));
 const result=await handle(post({task:'outline',subject:'Linear algebra',academicGrounding:true}),{STUDY_AI_ENABLED:'true',AI:{run}});
 expect(result.status).toBe(200);
 expect((await result.json()).topics).toEqual([
  {title:'Linear systems',group:'',validation:'inferred'},
  {title:'Gaussian elimination',group:'Linear systems',validation:'inferred'},
 ]);
 expect(run).toHaveBeenCalledTimes(1);
});
const synchronizationUrl='https://www.cs.uic.edu/~jbell/CourseNotes/OperatingSystems/5_Synchronization.html';
const passage='Mutual exclusion ensures that only one process at a time can execute in a critical section.';
const unrelated='This course syllabus lists operating systems and critical section topics.';
const synchronizeInput={task:'chat',mode:'auto',subject:'Operating Systems',academicGrounding:true,
 request:'Explain why mutual exclusion is necessary.'};

it('retrieves relevant conceptual evidence on a fresh session and preserves the exact web citation',async()=>{
 const provider=vi.fn(async()=>Response.json({results:[
  {url:'https://example.com/operating-systems',title:'Operating Systems',content:passage},
  {url:'https://www.cs.uic.edu/syllabus-test',title:'Critical Section Syllabus',content:unrelated.replace('lists','lists and schedules')},
  {url:synchronizationUrl,title:'Operating Systems: Process Synchronization',content:passage},
 ]}));
 vi.stubGlobal('fetch',provider);
 const run=vi.fn(async()=>({response:{insufficientEvidence:false,sections:[
  {text:passage,citations:[{id:'W1',quote:passage}]},
  {text:'Every mutex always guarantees fairness and a fixed execution time.',citations:[]},
 ]}}));
 const env={STUDY_AI_ENABLED:'true',AI:{run},TAVILY_API_KEY:'test-key',
  STUDY_BUDGET:{idFromName:()=>1,get:()=>({fetch:async()=>budget()})}};
 const response=await handle(post(synchronizeInput),env);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({evidenceStatus:'partially_source_backed',sourceVerified:false,
  citationMap:[{section:1,sourceIds:['W1']}],webSearch:{attempted:true,providerStatus:200,providerResultCount:3,relevantCount:1},
  retrievalDiagnostics:{webEvidenceUsed:1},sources:[{url:synchronizationUrl,retrievedBy:'tavily',publisher:'University of Illinois Chicago',supportingQuote:passage}]});
 const model=run.mock.calls[0][1].messages[0].content;
 expect(model).toContain(passage);
 expect(model).not.toContain(unrelated);
});

it('uses explicit web evidence alongside notes without querying unrelated institutional scope',async()=>{
 const provider=vi.fn(async()=>Response.json({results:[
  {url:synchronizationUrl,title:'Operating Systems: Process Synchronization',content:passage},
 ]}));
 vi.stubGlobal('fetch',provider);
 const note='A critical section protects code that accesses shared state. Mutual exclusion ensures one process enters at a time.';
 const run=vi.fn(async()=>({response:{insufficientEvidence:false,sections:[
  {text:passage,citations:[{id:'W1',quote:passage}]},
  {text:note,citations:[{id:'N1',quote:note}]},
 ]}}));
 const env={STUDY_AI_ENABLED:'true',AI:{run},TAVILY_API_KEY:'test-key',
  STUDY_BUDGET:{idFromName:()=>1,get:()=>({fetch:async()=>budget()})}};
 const response=await handle(post({...synchronizeInput,request:'Explain critical section rules with academic web sources.',
  university:'Graphic Era Hill University',sources:[{file:'Course notes.pdf',page:2,excerpt:note,documentType:'Notes'}]}),env);
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({retrievalDiagnostics:{webEvidenceUsed:1},sources:[
  {kind:'web',url:synchronizationUrl},{kind:'uploaded',file:'Course notes.pdf',page:2},
 ]});
 const [url,request]=provider.mock.calls[0];
 expect(url).toBe('https://api.tavily.com/search');
 expect(JSON.parse(request.body).query).toContain('critical section');
 expect(JSON.parse(request.body)).not.toHaveProperty('include_domains');
 expect(provider).toHaveBeenCalledOnce();
});

it('keeps Coffman conditions in deadlock practice even when its framing mentions synchronization',async()=>{
 const run=vi.fn(async()=>({response:{questions:[
  {question:'Describe deadlock as it relates to process synchronization. What four necessary conditions must hold?'},
  {question:'Explain how semaphores help enforce mutual exclusion during process synchronization.'},
 ]}}));
 const response=await handle(post({task:'practiceBatch',topic:'Process Synchronization',subject:'Operating Systems',count:1}),
  {STUDY_AI_ENABLED:'true',AI:{run}});
 expect(response.status).toBe(200);
 expect((await response.json()).questions).toEqual([{prompt:'Explain how semaphores help enforce mutual exclusion during process synchronization.'}]);
});

it('allows one authenticated fresh Tavily probe within the global budget and reuses only its matching evidence',async()=>{
 const key='test-credential-holder-only-123456789';
 const guest='198.51.100.7';
 const quote='Process synchronization protects shared data. Mutual exclusion ensures only one process enters the critical section at a time.';
 const url='https://www.cs.uic.edu/~jbell/CourseNotes/OperatingSystems/5_Synchronization.html';
 const env={STUDY_AI_ENABLED:'true',TAVILY_API_KEY:'test-tavily-secret',
  STUDY_AI_DIAGNOSTIC_TOKEN:key,AI:{run:vi.fn(async()=>({response:{insufficientEvidence:false,sections:[{text:quote,citations:[{id:'W1',quote}]}]}}))}};
 const {StudyBudget}=await import('./study-ai.mjs');
 const entries=new Map();
 const budget=new StudyBudget({storage:{transaction:fn=>fn({get:async k=>entries.get(k),put:async(k,v)=>entries.set(k,v)})}});
 env.STUDY_BUDGET={idFromName:()=>1,get:()=>({fetch:(url,init)=>budget.fetch(new Request(url,init))})};
 const request=(route,body,auth)=>new Request('https://example.test/api/coach'+route,{method:'POST',
  headers:{'Content-Type':'application/json','CF-Connecting-IP':guest,...(auth?{Authorization:'Bearer '+auth}:{})},body:body&&JSON.stringify(body)});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(guest));
 const guestId=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
 for(let i=0;i<3;i++)await budget.fetch(new Request('https://budget.internal/',{method:'POST',body:JSON.stringify({guest:guestId,kind:'search'})}));
 const fetcher=vi.fn(async(input,init)=>{
  expect(input).toBe('https://api.tavily.com/search');
  expect(JSON.parse(init.body).query).toMatch(/operating systems.*process synchronization/);
  return Response.json({results:[{url,title:'Operating Systems: Process Synchronization',content:quote}]});
 });
 vi.stubGlobal('fetch',fetcher);
 const noAuth=await handle(request('/search-diagnostic'),env);
 expect(noAuth.status).toBe(404);
 expect(fetcher).not.toHaveBeenCalled();
 const result=await handle(request('/search-diagnostic',undefined,key),env);
 expect(result.status).toBe(200);
 expect(await result.json()).toMatchObject({ok:true,configuration:{runtimeKeyPresent:true,budgetBindingPresent:true},
  webSearch:{attempted:true,providerStatus:200,quota:{guest:{used:3,max:3},global:{used:4,max:10},diagnostic:{used:1,max:1}}},
  retrievalDiagnostics:{tavilyEvidenceUsed:1},sources:[{url,supportingQuote:quote,retrievedBy:'tavily'}]});
 expect(env.AI.run.mock.calls[0][1].messages[0].content).toContain(quote);
 const repeat=await handle(request('/search-diagnostic',undefined,key),env);
 expect(repeat.status).toBe(429);
 expect(await repeat.json()).toMatchObject({ok:false,webSearch:{attempted:false,providerStatus:null,quota:{blockedBy:['diagnostic_daily']}}});
 const ordinary=await handle(request('',{mode:'auto',task:'chat',academicGrounding:true,subject:'Operating Systems',
  request:'Explain process synchronization and mutual exclusion in operating systems.'}),env);
 expect(await ordinary.json()).toMatchObject({webSearch:{cached:true,attempted:false},sources:[{url,supportingQuote:quote}]});
 const status=await handle(request('/search-quota',undefined,key),env);
 expect(await status.json()).toMatchObject({quota:{blockedBy:['guest_daily'],guest:{used:3,max:3},global:{used:4,max:10},diagnostic:{used:1,max:1}}});
 expect(fetcher).toHaveBeenCalledOnce();
});
