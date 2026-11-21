import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildPlan } from './engine.mjs';
import { cosine, exactQuestionKey, groupQuestions } from './semantic.mjs';
import { evaluateHistorical, gradeSections } from './evaluate.mjs';

const data=()=>JSON.parse(readFileSync(new URL('./fixtures/synthetic-history.json',import.meta.url),'utf8'));
const training=()=>data().papers.slice(0,2).map((paper,id)=>({...paper.material,kind:'Past paper',id}));
const similar=prompts=>new Map(prompts.map(prompt=>[prompt,[1,0]]));
const concepts=group=>group.questions.find(question=>question.variants?.length===2);

it('considers question type, wording, numeric scope and syllabus despite identical synthetic embeddings',()=>{
  const materials=training();
  materials[0].pages[0].text+='\nQ4. Compare the role of virtual memory. [5]\nQ5. Calculate 2 + 3. [5]\nQ6. Calculate 2 - 3. [5]';
  const {questions,topics}=buildPlan(materials);
  const grouped=groupQuestions(questions,topics,similar(questions.map(q=>q.prompt)));
  expect(grouped.questions).toHaveLength(questions.length-1);
  expect(grouped.review.some(pair=>pair.decision==='question-type')).toBe(true);
  expect(grouped.review.some(pair=>pair.decision==='different-wording-scope')).toBe(true);
  expect(exactQuestionKey('Calculate 2 + 3.')).not.toBe(exactQuestionKey('Calculate 2 - 3.'));
  expect(cosine([1,0],[0,1])).toBe(0);
  expect(cosine([0,0],[1,0])).toBeNull();
});

it('keeps every original reference and counts distinct papers across paraphrases',()=>{
  const {questions,topics}=buildPlan(training());
  const grouped=groupQuestions(questions,topics,similar(questions.map(q=>q.prompt)));
  const family=concepts(grouped);
  expect(family).toMatchObject({historicalFrequency:2,historicalPaperCount:2});
  expect(family.sources.map(source=>source.file)).toEqual(expect.arrayContaining(['os-2021.pdf','os-2022.pdf']));
  expect(family.sources).toHaveLength(3);
  expect(family.variants.map(variant=>variant.prompt)).toEqual(expect.arrayContaining([
    'Explain the role of virtual memory.','Describe the purpose of virtual memory.']));
  expect(grouped.review.filter(pair=>pair.familyId!==null)).toHaveLength(1);
  expect(groupQuestions(questions,topics,null)).toEqual({questions,topics,mode:'exact',review:[]});
});

it('avoids transitive merging where the two endpoints are below threshold',()=>{
  const {questions,topics}=buildPlan(training());
  const first=questions.find(q=>q.prompt.includes('role of virtual memory'));
  const bridge={...first,id:100,prompt:'Describe the purpose of virtual memory.'};
  const last={...first,id:101,prompt:'Discuss the role of virtual memory.'};
  const vectors=new Map([[first.prompt,[1,0]],[bridge.prompt,[.93,.36756]],[last.prompt,[.73,.68345]]]);
  expect(groupQuestions([first,bridge,last],topics,vectors).questions).toHaveLength(2);
});

it('keeps future papers, holdout wording, and a future syllabus out of fitting and selection',async()=>{
  const dataset=data();
  const seen=[];
  const embed=prompts=>{seen.push(...prompts);return similar(prompts);};
  const initial=(await evaluateHistorical(dataset,embed)).reports[0];
  const exam=dataset.papers.find(paper=>paper.id==='os-2023');
  exam.material.pages[0].text='Explain future syllabus leakage marker.';
  exam.items[0].question='Explain a completely different held-out question.';
  exam.items[0].concept='unknown';
  dataset.planningRules=[{availableOn:'2024-01-01',pattern:'Section Y compulsory'}];
  const changed=(await evaluateHistorical(dataset,embed)).reports[0];
  expect(initial.training).toEqual(['os-2021','os-2022']);
  expect(initial.syllabus).toBe('syllabus-2020.pdf');
  expect(seen.join(' ')).not.toMatch(/future|replacement|used for|completely different/i);
  for(const key of Object.keys(initial.plans))expect(changed.plans[key].questions).toEqual(initial.plans[key].questions);
  expect(initial.grouping).toMatchObject({tp:1,fp:0,fn:0,precision:1,recall:1});
  expect(initial.plans.semanticOptimized.citations.accuracy).toBe(1);
});

it('counts mandatory items and caps marks by the declared question choices',()=>{
  const required={section:'A',marks:8,required:true};
  const option1={section:'A',marks:4},option2={section:'A',marks:5};
  const exam=[required,option1,option2];
  const absent=gradeSections(exam,[option1,option2],[{id:'A',answer:2}]);
  expect(absent).toMatchObject({knownMarksCovered:5,knownMarksAvailable:13,compulsorySections:{covered:0,total:1}});
  expect(gradeSections(exam,exam,[{id:'A',answer:2}])).toMatchObject({knownMarksCovered:13,marksCoverage:1});
  expect(gradeSections([{...required,marks:null}],[],[{id:'A',answer:1}]).marksCoverage).toBeNull();
  expect(gradeSections(exam,exam,[]).marksCoverage).toBeNull();
});

it('handles missing syllabus and deterministic fallback when model loading fails',async()=>{
  const dataset=data();
  delete dataset.syllabi;
  delete dataset.papers[0].items;
  const unavailable=async()=>{throw new Error('offline');};
  const one=await evaluateHistorical(dataset,unavailable);
  const two=await evaluateHistorical(dataset,unavailable);
  expect(one).toEqual(two);
  expect(one.reports[0]).toMatchObject({mode:'exact',syllabus:null,grouping:{precision:null}});
  expect(one.reports[0].plans.semanticRanking).toEqual(one.reports[0].plans.exactRanking);
});
