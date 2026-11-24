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
