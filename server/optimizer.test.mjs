import { expect, it } from 'vitest';
import { coverageSelection, knapsack, makePlan, parseRules } from './optimizer.mjs';

const q=(id,minutes,priorityScore,topicIds=[],extra={})=>({id,minutes,priorityScore,topicIds,...extra});
const topic=(id,weight=1)=>({id,title:id,weight});
const ids=items=>items.map(item=>item.id);
const value=items=>items.reduce((sum,item)=>sum+item.priorityScore,0);

it('finds the optimal combination in the 60-minute counterexample',()=>{
  const result=knapsack([q(1,40,50),q(2,30,40),q(3,30,40)],60);
  expect(ids(result)).toEqual([2,3]);
  expect(value(result)).toBe(80);
});

it('matches exhaustive search over seeded small datasets and all tested budgets',()=>{
  let seed=337;
  const random=(limit)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
  for(let dataset=0;dataset<20;dataset++){
    const candidates=Array.from({length:8},(_,i)=>q(i+1,random(25)+1,random(40)+1));
    for(const budget of [0,7,15,30,43,62,100]){
      let optimum=0;
      for(let mask=0;mask<1<<candidates.length;mask++){
        const chosen=candidates.filter((_,i)=>mask&(1<<i));
        if(chosen.reduce((sum,item)=>sum+item.minutes,0)<=budget)optimum=Math.max(optimum,value(chosen));
      }
      const selected=knapsack(candidates,budget);
      expect(value(selected)).toBe(optimum);
      expect(selected.reduce((sum,item)=>sum+item.minutes,0)).toBeLessThanOrEqual(budget);
      expect(new Set(ids(selected)).size).toBe(selected.length);
    }
  }
});

it('handles duplicate IDs and resolves equal values deterministically',()=>{
  expect(ids(knapsack([q(1,15,20),q(1,15,20),q(2,15,20)],15))).toEqual([1]);
  expect(ids(knapsack([q(1,20,20),q(2,15,20)],20))).toEqual([2]);
  expect(ids(knapsack([q(1,15,20),q(1,15,20)],30))).toEqual([1]);
});

it('counts distinct topic weights once and can prefer coverage to additive value',()=>{
  const questions=[q(1,25,50,['a','a']),q(2,25,49,['a']),q(3,25,20,['b'])];
  const topics=[topic('a',3),topic('b',2)];
  expect(ids(coverageSelection(questions,50,topics))).toEqual([1,3]);
  const plan=makePlan(questions,topics,56);
  expect(plan.method).toBe('coverage');
  expect(plan.weightedCoverageScore).toBe(5);
  expect(plan.alternatives.knapsack.weightedCoverageScore).toBe(3);
});

it('improves greedy coverage with a feasible swap',()=>{
  const questions=[q(1,2,60,['a','b','c','d']),q(2,2,50,['a','b','e']),q(3,2,40,['c','d','f'])];
  const topics=['a','b','c','d','e','f'].map(id=>topic(id));
  expect(new Set(ids(coverageSelection(questions,4,topics)))).toEqual(new Set([2,3]));
});

it('prioritizes an explicit compulsory requirement and reports unmet rules',()=>{
  const questions=[q(1,30,100,['a'],{sections:['A']}),q(2,30,20,['b'],{sections:['B'],units:[2]})];
  const topics=[topic('a',3),topic('b')];
  expect(makePlan(questions,topics,34,'Section B is compulsory').selectedQuestionIds).toEqual([2]);
  const infeasible=makePlan(questions,topics,20,'Section B is compulsory; Unit III is required');
  expect(infeasible.warnings.join(' ')).toMatch(/Section B: 0\/1.*Unit 3: 0\/1.*No complete question/);
  expect(makePlan([],[],300,'Section C is compulsory').selectedQuestionIds).toEqual([]);
  expect(parseRules('Answer all questions; Unit III is not compulsory').groups).toEqual([]);
  expect(parseRules('Answer all questions').warnings).toHaveLength(1);
});

it('validates a group-specific mark floor under the explicit question choice',()=>{
  const questions=[q(1,20,30,[],{sections:['B'],marks:20,marksByGroup:{'section:B':5}}),
    q(2,20,20,[],{sections:['B'],marks:5,marksByGroup:{'section:B':5}})];
  expect(makePlan(questions,[],60,'Answer any 1 in Section B with at least 9 marks').warnings.join(' ')).toContain('5/9 evidenced marks');
  expect(makePlan(questions,[],60,'Answer any 2 in Section B with at least 9 marks').requirements[0].satisfied).toBe(true);
});

it('reserves revision time and replans from existing candidates without changing citations',()=>{
  const source={file:'paper.pdf',page:4,excerpt:'Explain joins.'};
  const candidates=[q(1,30,120,['join'],{source}),q(2,20,30,['keys'])];
  const topics=[topic('join'),topic('keys')];
  const full=makePlan(candidates,topics,300);
  expect(full).toMatchObject({preparationBudgetMinutes:270,revisionMinutes:30,estimatedPreparationMinutes:50});
  expect(makePlan(candidates,topics,30)).toMatchObject({selectedQuestionIds:[2],preparationBudgetMinutes:27,revisionMinutes:3});
  expect(candidates[0].source).toBe(source);
  expect(makePlan(candidates,topics,300)).toEqual(full);
});

it('flags a compulsory recommendation outside the first ten',()=>{
  const questions=Array.from({length:11},(_,i)=>q(i+1,10,100-i,[String(i)],{sections:i===10?['C']:[]}));
  const plan=makePlan(questions,[],150,'Section C is required');
  expect(plan.selectedQuestionIds).toHaveLength(11);
  expect(plan.warnings[0]).toMatch(/additional recommendations/i);
});

