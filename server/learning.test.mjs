import { expect, it } from 'vitest';
import { describeLearning, familiarityFrom, learningEffort, makeLearningPlan } from './learning.mjs';

const topic=(id,title,weight=1)=>({id,title,weight});
function question(id,prompt,settings={}) {
  const base={id,prompt,minutes:15,marks:0,priorityScore:45,topicIds:['topic:'+id],...settings};
  return {...base,learning:describeLearning(base,settings.topics)};
}

it('estimates additional practice for calculation and derivation, with a safe familiarity default',()=>{
  const definition=question(1,'Define a relational key.');
  const calculation=question(2,'Calculate the average waiting time.');
  const derivation=question(3,'Derive the response time expression.');
  expect(calculation.learning.type).toBe('numerical');
  expect(derivation.learning.type).toBe('derivation');
  expect(learningEffort(calculation).remaining.practice).toBeGreaterThan(learningEffort(definition).remaining.practice);
  expect(learningEffort(calculation)).toEqual(learningEffort(calculation,'unknown'));
  expect(learningEffort(calculation,'missing')).toEqual(learningEffort(calculation,'unknown'));
  expect(learningEffort(calculation,'revising').minutes).toBeLessThan(learningEffort(calculation,'scratch').minutes);
  expect(familiarityFrom('I am somewhat familiar')).toBe('familiar');
});

it('uses type-specific generic checkpoints and only names grounded concepts when supplied',()=>{
  const generic=question(1,'Calculate the unknown value.');
  expect(generic.learning.checkpoints.map(step=>step.label)).toEqual(Array(4).fill('Type guide'));
  const text=generic.learning.checkpoints.map(step=>step.text).join(' ');
  expect(text).toMatch(/givens.*formula.*calculation.*result/i);
  expect(text).not.toMatch(/Little's Law|round robin|FCFS/i);
  const answerSource={file:'notes.pdf',page:3,number:'Line 5',excerpt:'A definition from the notes.'};
  const settings={topicIds:['syllabus:database normalization'],topics:[topic('syllabus:database normalization','Database normalization')],answerSource,prerequisites:['Functional dependencies']};
  const grounded=question(2,'Explain database normalization.',settings);
  expect(grounded.learning.checkpoints).toHaveLength(5);
  expect(grounded.learning.checkpoints[0]).toMatchObject({label:'Syllabus-linked',text:expect.stringContaining('Database normalization')});
  expect(grounded.learning.checkpoints[1].source).toBe(answerSource);
  expect(learningEffort(grounded).estimated.understanding).toBeGreaterThan(learningEffort(question(2,grounded.prompt,{...settings,prerequisites:[]})).estimated.understanding);
});

it('reduces remaining effort after completion and restores some effort for revision',()=>{
  const candidate=question(1,'Compare process and thread.');
  const initial=learningEffort(candidate);
  const attempted=learningEffort(candidate,'unknown',{'1':'completed'});
  const revisit=learningEffort(candidate,'unknown',{'1':'revision'});
  expect(attempted.status).toBe('in-progress');
  expect(attempted.minutes).toBeLessThan(initial.minutes);
  expect(revisit.status).toBe('revision');
  expect(revisit.minutes).toBeGreaterThan(attempted.minutes);
  expect(revisit.minutes).toBeLessThan(initial.minutes);
  expect(revisit.remaining.recall).toBe(initial.remaining.recall);
});

it('excludes prepared work, retains citations and credits distinct compulsory coverage',()=>{
  const source={file:'past.pdf',page:2,number:'Q1',excerpt:'Derive the expression.'};
  const difficult=question(1,source.excerpt,{sections:['B'],source});
  const alternative=question(2,'Define a normal form.');
  const topics=[topic('topic:1','Derivation'),topic('topic:2','Definition')];
  const warning=makeLearningPlan([difficult,alternative],topics,20,'Section B is compulsory','scratch');
  expect(warning.warnings.join(' ')).toContain('Section B: 0/1');
  const progress={1:Object.fromEntries(difficult.learning.checkpoints.map(step=>[step.id,'completed']))};
  const outcome=makeLearningPlan([difficult,alternative],topics,35,'Section B is compulsory','scratch',progress);
  expect(outcome.selectedQuestionIds).toEqual([2]);
  expect(outcome.preparedQuestionIds).toEqual([1]);
  expect(outcome.requirements[0].satisfied).toBe(true);
  expect(outcome.coveredTopicIds).toEqual(['topic:1','topic:2']);
  expect(outcome.estimatedPreparationMinutes).toBeLessThanOrEqual(outcome.preparationBudgetMinutes);
  expect(difficult.source).toBe(source);
});

it('selects more evidence under the same budget when the student is mostly revising',()=>{
  const questions=[question(1,'Derive the throughput expression.',{priorityScore:90,sections:['B']}),question(2,'Define throughput.',{priorityScore:30})];
  const topics=[topic('topic:1','Derivation'),topic('topic:2','Definition')];
  const scratch=makeLearningPlan(questions,topics,50,'Section B is compulsory','scratch');
  const revising=makeLearningPlan(questions,topics,50,'Section B is compulsory','revising');
  expect(scratch.selectedQuestionIds).toEqual([2]);
  expect(revising.selectedQuestionIds).toEqual([1,2]);
  expect(scratch.requirements[0].satisfied).toBe(false);
  expect(revising.requirements[0].satisfied).toBe(true);
  expect(revising.estimatedPreparationMinutes).toBeLessThanOrEqual(45);
});

it('uses domain-specific checkpoints for deadlock theory and Round Robin calculations',()=>{
  const deadlock=describeLearning({prompt:'Explain the four necessary conditions for deadlock.',marks:5,topicIds:[]});
  expect(deadlock.checkpoints.map(step=>step.text).join(' ')).toContain('mutual exclusion, hold and wait, no preemption, and circular wait');
  const robin=describeLearning({prompt:'Calculate average waiting time using Round Robin.',marks:10,topicIds:[]});
  expect(robin.checkpoints.map(step=>step.text).join(' ')).toContain('Gantt chart');
  expect(robin.checkpoints.map(step=>step.text).join(' ')).toContain('time quantum');
});
