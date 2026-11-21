import { expect, it, vi } from 'vitest';
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

it('requires explicit AI opt-in and a request limiter before using a model',async()=>{
  const run=vi.fn().mockResolvedValue({response:'Mutual exclusion means one process can use the resource at a time.'});
  const limit=vi.fn().mockResolvedValueOnce({success:false}).mockResolvedValueOnce({success:true});
  const env={STUDY_AI_ENABLED:'true',AI:{run},STUDY_AI_LIMIT:{limit}};
  const body={request:'Explain',question:'Define mutual exclusion.'};
  expect((await handle(post('coach',body))).status).toBe(503);
  expect((await handle(post('coach',body),env)).status).toBe(429);
  expect(run).not.toHaveBeenCalled();
  expect((await handle(post('coach',body),env)).status).toBe(200);
  expect(run).toHaveBeenCalledOnce();
});
