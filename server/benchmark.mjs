import { fitQuestions } from '../src/api.ts';
import { coverageSelection, knapsack, makePlan, parseRules } from './optimizer.mjs';
import { describeLearning, makeLearningPlan } from './learning.mjs';

const q=(id,minutes,priorityScore,topicIds,sections=[])=>({id,minutes,priorityScore,topicIds,sections});
const t=(id,weight)=>({id,title:id,weight});
const fixtures=[
  {name:'Additive counterexample',minutes:67,pattern:'',topics:[t('a',1),t('b',1),t('c',1)],
    questions:[q(1,40,50,['a']),q(2,30,40,['b']),q(3,30,40,['c'])]},
  {name:'Overlapping topics and compulsory section',minutes:60,pattern:'Section B is compulsory',
    topics:[t('joins',3),t('recovery',2)],
    questions:[q(1,25,50,['joins'],['A']),q(2,25,49,['joins'],['A']),q(3,25,20,['recovery'],['B'])]}
];

for(const {name,minutes,pattern,topics,questions} of fixtures) {
  const plan=makePlan(questions,topics,minutes,pattern);
  const {groups}=parseRules(pattern);
  const budget=plan.preparationBudgetMinutes;
  const summarize=selection=>{
    const covered=new Set(selection.flatMap(question=>question.topicIds));
    return [selection.reduce((sum,q)=>sum+q.priorityScore,0),
      selection.reduce((sum,q)=>sum+q.minutes,0),
      covered.size,
      topics.filter(topic=>covered.has(topic.id)).reduce((sum,topic)=>sum+topic.weight,0),
      groups.length?groups.filter(rule=>selection.some(q=>q.sections.includes(rule.key))).length+'/'+groups.length:'n/a'];
  };
  const scores=[fitQuestions(questions,minutes),knapsack(questions,budget),coverageSelection(questions,budget,topics,groups)].map(summarize);
  console.log('\n### '+name+' ('+budget+' preparation minutes)');
  console.log('| Metric | Old | Knapsack | Coverage-aware |\n|---|---:|---:|---:|');
  ['Total priority value','Study time (minutes)','Distinct topics covered','Weighted topic coverage','Compulsory requirements satisfied'].forEach((metric,i)=>{
    console.log('| '+[metric,...scores.map(row=>row[i])].join(' | ')+' |');
  });
  console.log('\nChosen by NEO v2: '+plan.method+'.');
}

const learningFixture=[
  {...q(1,15,90,['derivation'],['B']),prompt:'Derive the throughput expression.',marks:0},
  {...q(2,15,30,['definition']),prompt:'Define throughput.',marks:0}
].map(question=>({...question,learning:describeLearning(question)}));
console.log('\n### Familiarity comparison (50 minutes total, 45 preparation minutes)');
console.log('| Familiarity | Estimated candidate times | Selected | Preparation minutes | Compulsory section covered |');
console.log('|---|---|---|---:|---|');
for(const familiarity of ['scratch','revising']) {
  const plan=makeLearningPlan(learningFixture,[t('derivation',1),t('definition',1)],50,'Section B is compulsory',familiarity);
  const times=learningFixture.map(question=>'Q'+question.id+': '+plan.efforts[question.id].minutes+' min').join(', ');
  console.log('| '+[familiarity,times,plan.selectedQuestionIds.map(id=>'Q'+id).join(', '),
    plan.estimatedPreparationMinutes,plan.requirements[0].satisfied?'yes':'no'].join(' | ')+' |');
}

