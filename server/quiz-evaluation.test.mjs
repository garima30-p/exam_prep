import {expect,it,vi} from 'vitest';
import {handle} from './engine.mjs';
import {gradeChoice,gradeVerifiedCalculation,parseReviewGrade,recallFact} from './quiz-evaluation.mjs';

const scheduling='Using FCFS, calculate the average waiting time in milliseconds.\nProcess | Arrival | Burst\nP1 | 0 | 4\nP2 | 1 | 2\nP3 | 2 | 3';
const rubric='Deadlock occurs when processes cannot proceed because each waits for a resource held by another.';
const fact=recallFact(rubric);
const payload={task:'grade',questionId:'deadlock',question:fact.prompt,referenceAnswer:fact.referenceAnswer,rubric:fact.rubric,evidence:fact.evidence,
 studentAnswer:'Processes get stuck waiting for one another’s resources.'};
const request=body=>new Request('https://app.in-nocent.workers.dev/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify(body)});

it('grades option identifiers and boolean choices deterministically',()=>{
 expect(gradeChoice('mcq','2','2',['1','2'],'The verified answer').status).toBe('correct');
 expect(gradeChoice('tf','false','true',['false','true'],'The verified answer').status).toBe('incorrect');
 expect(gradeChoice('tf','missing','true',['false','true'],'The verified answer').status).toBe('needs_review');
});

it('recomputes an FCFS metric and handles fractions, units and stated rounding',()=>{
 expect(gradeVerifiedCalculation('os',scheduling,'7/3 ms').status).toBe('correct');
 expect(gradeVerifiedCalculation('os',scheduling,'7/3000 seconds').status).toBe('correct');
 expect(gradeVerifiedCalculation('os',scheduling,'2.33 ms').status).toBe('incorrect');
 expect(gradeVerifiedCalculation('os','Round to 2 decimal places. '+scheduling,'2.33 ms').status).toBe('correct');
 expect(gradeVerifiedCalculation('os',scheduling,'3 ms').status).toBe('incorrect');
 expect(gradeVerifiedCalculation('os',scheduling,'3%').status).toBe('needs_review');
 expect(gradeVerifiedCalculation('os',scheduling.replace('FCFS','SJF'),'7/3 ms').status).toBe('needs_review');
});

it('sends only the question, answer and rubric to Gemma and reports structured grading',async()=>{
 const answer={status:'partial',feedback:'You identified that the processes are stuck.',missingPoints:['Each waits for resources held by another.']};
 const run=vi.fn(async()=>({response:answer}));
 const env={STUDY_AI_ENABLED:'true',AI:{run}};
 const response=await handle(request({...payload,topics:['Unrelated syllabus topic'],university:'GEHU'}),env);
 expect(response.status).toBe(200);
 expect(response.headers.get('server-timing')).toMatch(/gemma.*quiz-evaluation.*request/);
 expect(await response.json()).toEqual({...answer,questionId:'deadlock',expectedAnswer:rubric,validationMethod:'ai_assisted'});
 expect(run).toHaveBeenCalledOnce();
 expect(run.mock.calls[0][1]).toEqual(expect.objectContaining({response_format:{type:'json_object'}}));
 expect(JSON.parse(run.mock.calls[0][1].messages[1].content)).toEqual({question:payload.question,studentAnswer:payload.studentAnswer,
  referenceAnswer:rubric,rubric:fact.rubric,evidence:[rubric]});
 const invalid=await handle(request({...payload,rubric:['A statement without evidence.']}),env);
 expect(invalid.status).toBe(422);
 const vague=await handle(request({...payload,question:'Explain one key idea from Operating Systems.'}),env);
 expect(vague.status).toBe(422);
 const noAnswer=await handle(request({...payload,referenceAnswer:undefined}),env);
 expect(noAnswer.status).toBe(422);
 expect(run).toHaveBeenCalledOnce();
});

it('rejects malformed grades and exposes an inference error without a verdict',async()=>{
 expect(parseReviewGrade('{"status":"correct","feedback":"OK","missingPoints":["something"]}','id',rubric)).toBeNull();
 expect(parseReviewGrade('{"status":"partial","feedback":"OK","missingPoints":[]}','id',rubric)).toBeNull();
 expect(parseReviewGrade('{"status":"correct"}','id',rubric)).toBeNull();
 const response=await handle(request(payload),{STUDY_AI_ENABLED:'true',AI:{run:async()=>{throw new Error('unavailable');}}});
 expect(response.status).toBe(502);
 expect(await response.json()).toMatchObject({code:'model_unavailable'});
});

it('compiles a question and reference together from other subjects without guessing at missing material',()=>{
 const statement='Photosynthesis converts light energy into chemical energy stored in sugars.';
 expect(recallFact(statement)).toMatchObject({prompt:'What does photosynthesis convert?',referenceAnswer:statement,rubric:['light energy into chemical energy stored in sugars']});
 expect(recallFact('Middleware acts as a bridge between an application and a database.')).toMatchObject({prompt:'What role does middleware play between an application and a database?'});
 expect(recallFact('Photosynthesis is a key idea.')).toBeNull();
});
