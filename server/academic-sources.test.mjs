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
 const run=vi.fn(async()=>({response:'A deadlock is a circular wait among transactions for locks.'}));
 const response=await handle(post({task:'notes',mode:'auto',subject:'DBMS',topic:'deadlock',topics:['deadlock'],
  request:'Explain database deadlock',academicGrounding:true}),{STUDY_AI_ENABLED:'true',AI:{run}});
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({sourceVerified:false,evidenceSupplied:0,citationCount:0,sources:[],
  webSearch:{attempted:false,code:'web_not_configured'}});
});
 
it('fills a short practice batch once and excludes previously returned questions',async()=>{
 const first='Explain how a cycle in a wait-for graph indicates database deadlock.';
 const duplicate='Explain how a cycle in a wait-for graph indicates database deadlock.';
 const second='Compare the wait-die and wound-wait deadlock prevention policies.';
 const run=vi.fn()
  .mockResolvedValueOnce({response:{questions:[{question:first}]}})
  .mockResolvedValueOnce({response:{questions:[{question:duplicate},{question:second}]}});
 const response=await handle(post({task:'practiceBatch',subject:'DBMS',topic:'Deadlocks',count:5,
  academicGrounding:true}),{STUDY_AI_ENABLED:'true',AI:{run}});
 expect(response.status).toBe(200);
 expect((await response.json()).questions).toEqual([{prompt:first},{prompt:second}]);
 expect(run).toHaveBeenCalledTimes(2);
 expect(JSON.parse(run.mock.calls[1][1].messages[1].content).exclude).toContain(first);
});
