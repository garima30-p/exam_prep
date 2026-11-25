import {expect,it,vi} from 'vitest';
import {checkNumericalAnswer} from './answer-verification.mjs';
import {checkStudyAnswer} from './study-citations.mjs';
import {handle} from './engine.mjs';

const scheduling='Calculate average waiting time and average turnaround time with FCFS.\nProcess | Arrival | Burst\nP1 | 0 | 5\nP2 | 2 | 3\nP3 | 6 | 2';
const correct='Average waiting time: 1.67 ms.\nAverage turnaround time: 5 ms.';
const incorrect='Average waiting time: 2 ms.\nAverage turnaround time: 5 ms.';
const env=response=>({STUDY_AI_ENABLED:'true',AI:{run:vi.fn(async()=>({response}))}});
const request=body=>new Request('https://test.example/api/coach',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
});

it('recomputes FCFS metrics and rejects a numerically incorrect answer at the endpoint',async()=>{
 expect(checkNumericalAnswer(scheduling,correct)).toMatchObject({validationStatus:'deterministically_checked'});
 expect(checkNumericalAnswer(scheduling,incorrect)).toMatchObject({validationStatus:'check_failed',failedMetric:'Average waiting time'});
 const response=await handle(request({task:'answer',mode:'auto',request:scheduling}),env(incorrect));
 expect(response.status).toBe(502);
 expect(await response.json()).toMatchObject({code:'calculation_check_failed',evidenceStatus:'no_supporting_source',validationStatus:'check_failed'});
});

it('checks FIFO and LRU separately and leaves ambiguous inputs unchecked',()=>{
 const input='Calculate page faults for ALGORITHM with 2 frames initially empty. Reference string: 1, 2, 1, 3, 1';
 expect(checkNumericalAnswer(input.replace('ALGORITHM','FIFO'),'Page faults: 4')).toMatchObject({validationStatus:'deterministically_checked'});
 expect(checkNumericalAnswer(input.replace('ALGORITHM','LRU'),'Page faults: 3')).toMatchObject({validationStatus:'deterministically_checked'});
 expect(checkNumericalAnswer(input.replace('ALGORITHM','FIFO and LRU'),'Page faults: 3')).toMatchObject({validationStatus:'not_independently_checked'});
});

it('flags a known theoretical contradiction despite an authentic citation',async()=>{
 const quote='Only one process at a time can be executing in the critical section.';
 const wrong='Mutual exclusion allows multiple processes to execute in the critical section at the same time.';
 const response=await handle(request({task:'answer',mode:'auto',request:'Explain mutual exclusion in the critical section.',academicGrounding:true,
  sources:[{file:'OS notes.pdf',page:2,excerpt:quote}]}),env({insufficientEvidence:false,sections:[{text:wrong,citations:[{id:'N1',quote}]}]}));
 expect(response.status).toBe(502);
 expect(await response.json()).toMatchObject({code:'theory_check_failed',validationStatus:'check_failed'});
});

it('associates accepted citations with their specific section and reports partial evidence',()=>{
 const quote='Only one process at a time can execute its critical section.';
 const registry=new Map([['N1',{id:'N1',excerpt:quote,file:'OS notes.pdf',page:2}]]);
 const data=checkStudyAnswer(JSON.stringify({insufficientEvidence:false,sections:[
  {text:quote,citations:[{id:'N1',quote}]},
  {text:'Some systems use kernel scheduling features.',citations:[]},
 ]}),registry,false,true);
 expect(data).toMatchObject({evidenceStatus:'partially_source_backed',validationStatus:'not_independently_checked',
  citationMap:[{section:1,sourceIds:['N1']}]});
});

it('checks Banker safety and validates a claimed sequence against released resources',()=>{
 const question="Use Banker's Algorithm to determine the safety and state a safe sequence.\nAllocation: [[1,0],[0,1]]\nMax: [[1,1],[2,1]]\nAvailable: [0,1]";
 expect(checkNumericalAnswer(question,'Safety: safe\nSafe sequence: P0, P1')).toMatchObject({validationStatus:'check_failed',failedMetric:'Safety state'});
 const safe=question.replace('Available: [0,1]','Available: [1,1]');
 expect(checkNumericalAnswer(safe,'Safety: safe\nSafe sequence: P0, P1')).toMatchObject({validationStatus:'deterministically_checked'});
 expect(checkNumericalAnswer(safe,'Safety: safe\nSafe sequence: P1, P0')).toMatchObject({validationStatus:'check_failed',failedMetric:'Safe sequence'});
});

it('checks a worked example from its stated inputs and rejects unsupported assumptions',async()=>{
 const example=scheduling+'\n\n'+incorrect;
 const response=await handle(request({task:'example',mode:'auto',practiceExample:true,topic:'CPU scheduling',
  request:'Show one solved example of CPU scheduling.'}),env(example));
 expect(response.status).toBe(502);
 expect(await response.json()).toMatchObject({code:'calculation_check_failed'});
 expect(checkNumericalAnswer(scheduling+' with a context-switch overhead of 2 ms',correct)).toMatchObject({validationStatus:'not_independently_checked'});
});

it('calculates both scenario totals and verifies the required percentage independently',async()=>{
 const question='Scenario A:\n10,000 operations × 5 ns\nScenario B:\n10,000 operations × 30 ns\nFind both total times and the percentage increase.';
 const run=vi.fn();
 const request=new Request('https://example.com/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({task:'answer',mode:'auto',request:question})});
 const response=await handle(request,{STUDY_AI_ENABLED:'true',AI:{run}});
 const result=await response.json();
 expect(result.explanation).toContain('Scenario A total: 50,000 ns');
 expect(result.explanation).toContain('Scenario B total: 300,000 ns');
 expect(result.explanation).toContain('Percentage increase: 500%');
 expect(result.validationStatus).toBe('deterministically_checked');
 expect(checkNumericalAnswer(question,result.explanation).validationStatus).toBe('deterministically_checked');
 expect(checkNumericalAnswer(question,result.explanation.replace('500%','600%'))).toMatchObject({validationStatus:'check_failed',failedMetric:'Percentage increase'});
 expect(checkNumericalAnswer(question,result.explanation.replace('Percentage increase: 500%','Six times as long'))).toMatchObject({validationStatus:'check_failed',missingMetric:'Percentage increase'});
 expect(run).not.toHaveBeenCalled();
});
