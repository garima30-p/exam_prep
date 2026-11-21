const MAX_CANDIDATES = 100;
const MAX_QUESTION_MINUTES = 240;
const MAX_BUDGET = 525600;

function eligible(questions) {
  const seen = new Set();
  return questions.filter(question=>{
    if (seen.has(question.id) || !Number.isInteger(question.minutes) ||
        question.minutes<1 || question.minutes>MAX_QUESTION_MINUTES ||
        !Number.isSafeInteger(question.priorityScore) || question.priorityScore<=0) return false;
    seen.add(question.id);
    return true;
  }).slice(0,MAX_CANDIDATES);
}

/** Exact for eligible candidates. Stable ties favor lower time, then earlier input. */
export function knapsack(questions,budget) {
  const items=eligible(questions);
  const capacity=Math.max(0,Math.min(Math.floor(budget)||0,items.reduce((sum,q)=>sum+q.minutes,0)));
  const values=new Float64Array(capacity+1);
  const choices=items.map(()=>new Uint8Array(capacity+1));
  for (const [i,q] of items.entries()) {
    for (let time=capacity;time>=q.minutes;time--) {
      const next=values[time-q.minutes]+q.priorityScore;
      if (next>values[time]) {values[time]=next;choices[i][time]=1;}
    }
  }
  let time=values.findIndex(value=>value===values[capacity]);
  const selected=[];
  for (let i=items.length-1;i>=0;i--) {
    if (choices[i][time]) { selected.push(items[i]);time-=items[i].minutes; }
  }
  return selected.reverse();
}

const unitValue = value => Number(value) || ['I','II','III','IV','V','VI','VII','VIII','IX','X'].indexOf(value.toUpperCase())+1;
const ruleLabel = rule => (rule.kind==='unit'?'Unit ':'Section ')+rule.key;

export function parseRules(value='') {
  const groups=new Map();
  const warnings=[];
  const clauses=value.slice(0,600).split(/[;.!?\n]+/).map(part=>part.trim()).filter(Boolean);
  for (const clause of clauses) {
    const mandatory=/\b(compulsory|mandatory|required|must)\b/i.test(clause);
    const matches=[...clause.matchAll(/\b(unit|section)\s+([0-9]+|[ivx]+|[a-z])\b/gi)];
    const choose=clause.match(/\b(?:answer|attempt|choose|pick)\s+(?:any\s+)?(\d+)\b/i);
    const marks=clause.match(/\b(?:at least|minimum(?: of)?)\s+(\d+)\s+marks?\b/i);
    const unsupported=/\b(each|except|or|all|not|optional|either)\b|(?:\band\b|,)\s+(?:[ivx]+|\d+|[a-z])\b/i.test(clause);
    if (!matches.length || (!mandatory && !choose && !marks) || unsupported ||
      (choose && Number(choose[1])<1) || (matches.length>1 && (choose||marks))) {
      warnings.push('Could not verify paper rule: '+clause+'.');
      continue;
    }
    for (const [,rawKind,rawKey] of matches) {
      const kind=rawKind.toLowerCase();
      const key=kind==='unit'?String(unitValue(rawKey)):rawKey.toUpperCase();
      if (key==='0') {warnings.push('Could not identify the unit in: '+clause+'.');continue;}
      const id=kind+':'+key;
      const previous=groups.get(id);
      groups.set(id,{kind,key,count:Math.max(previous?.count??0,choose?Number(choose[1]):1),
        minMarks:Math.max(previous?.minMarks??0,marks?Number(marks[1]):0),
        choiceLimit:choose?Number(choose[1]):previous?.choiceLimit,
        coverageOnly:!choose&&!previous?.choiceLimit});
    }
  }
  if(groups.size>12) warnings.push('Only the first 12 explicit paper requirements were checked.');
  return {groups:[...groups.values()].slice(0,12),warnings};
}

function matchesRule(question,rule) {
  return rule.kind==='unit'
    ? (question.units??[question.unit]).some(unit=>String(unit)===rule.key)
    : (question.sections??[]).includes(rule.key);
}

function measurements(questions,groups) {
  return groups.map(rule=>{
    const matches=questions.filter(q=>matchesRule(q,rule));
    const marks=rule.minMarks ? matches.map(q=>q.marksByGroup?.[rule.kind+':'+rule.key]??0)
      .sort((a,b)=>b-a).slice(0,rule.choiceLimit).reduce((sum,n)=>sum+n,0) : 0;
    return {...rule,preparedCount:matches.length,preparedMarks:marks,
      satisfied:matches.length>=rule.count && marks>=rule.minMarks};
  });
}

function metrics(questions,weights,groups) {
  const coveredTopicIds=[...new Set(questions.flatMap(q=>q.topicIds??[]))].sort();
  const requirements=measurements(questions,groups);
  return {
    coveredTopicIds,requirements,
    requirementsSatisfied:requirements.filter(rule=>rule.satisfied).length,
    requirementProgress:requirements.reduce((sum,rule)=>sum+Math.min(1,rule.preparedCount/rule.count)
      +(rule.minMarks?Math.min(1,rule.preparedMarks/rule.minMarks):0),0),
    weightedCoverageScore:coveredTopicIds.reduce((sum,id)=>sum+(weights.get(id)??0),0),
    totalPriorityValue:questions.reduce((sum,q)=>sum+q.priorityScore,0),
    estimatedPreparationMinutes:questions.reduce((sum,q)=>sum+q.minutes,0)
  };
}

function compare(a,b) {
  return a.requirementsSatisfied-b.requirementsSatisfied || a.requirementProgress-b.requirementProgress
    || a.weightedCoverageScore-b.weightedCoverageScore || a.totalPriorityValue-b.totalPriorityValue
    || b.estimatedPreparationMinutes-a.estimatedPreparationMinutes;
}

/** Greedy marginal weighted gain per minute, followed by bounded 1-for-1 swaps. */
export function coverageSelection(questions,budget,topics,groups=[],prepared=[]) {
  const pool=eligible(questions);
  budget=Math.max(0,Math.floor(budget)||0);
  if(pool.reduce((sum,question)=>sum+question.minutes,0)<=budget)return pool;
  const weights=new Map(topics.map(topic=>[topic.id,topic.weight]));
  let selection=[];
  const chosen=new Set();
  let current=metrics(prepared,weights,groups);
  function fill() {
    while(true) {
      let best=null;
      for(const question of pool) {
        if(chosen.has(question.id)||current.estimatedPreparationMinutes+question.minutes>budget)continue;
        const gain=(question.topicIds??[]).reduce((sum,id,index,ids)=>sum+
          (!current.coveredTopicIds.includes(id)&&ids.indexOf(id)===index?(weights.get(id)??0):0),0);
        const requirement=groups.length?metrics([...prepared,...selection,question],weights,groups):current;
        const choice={question,complete:requirement.requirementsSatisfied-current.requirementsSatisfied,
          progress:requirement.requirementProgress-current.requirementProgress,gain:gain/question.minutes};
        if(!best || (choice.complete-best.complete || choice.progress-best.progress || choice.gain-best.gain
          || question.priorityScore/ question.minutes-best.question.priorityScore/best.question.minutes)>0)best=choice;
      }
      if(!best)break;
      selection.push(best.question);
      chosen.add(best.question.id);
      current=metrics([...prepared,...selection],weights,groups);
    }
  }
  fill();
  for(let pass=0;pass<2;pass++) {
    let best=null;
    for(const [index,removed] of selection.entries()) {
      for(const added of pool) {
        if(chosen.has(added.id)||current.estimatedPreparationMinutes-removed.minutes+added.minutes>budget)continue;
        const next=selection.slice();
        next[index]=added;
        const evaluated=metrics([...prepared,...next],weights,groups);
        if(compare(evaluated,best?.evaluated??current)>0)best={next,evaluated,removed,added};
      }
    }
    if(!best)break;
    selection=best.next;
    current=best.evaluated;
    chosen.delete(best.removed.id);chosen.add(best.added.id);
    fill();
  }
  return selection;
}

export function makePlan(questions,topics,minutes,pattern='',prepared=[]) {
  const totalAvailableMinutes=Number.isFinite(minutes)?Math.max(0,Math.min(MAX_BUDGET,Math.floor(minutes))):0;
  const preparationBudgetMinutes=Math.floor(totalAvailableMinutes*.9);
  const revisionMinutes=totalAvailableMinutes-preparationBudgetMinutes;
  const {groups,warnings}=parseRules(pattern);
  const weights=new Map(topics.map(topic=>[topic.id,topic.weight]));
  const additive=knapsack(questions,preparationBudgetMinutes);
  const coverage=coverageSelection(questions,preparationBudgetMinutes,topics,groups,prepared);
  const additiveScore=metrics([...prepared,...additive],weights,groups);
  const coverageScore=metrics([...prepared,...coverage],weights,groups);
  const method=compare(coverageScore,additiveScore)>0?'coverage':'knapsack';
  const selected=method==='coverage'?coverage:additive;
  const scored=method==='coverage'?coverageScore:additiveScore;
  const ordered=selected.slice().sort((a,b)=>b.priorityScore-a.priorityScore);
  for(const rule of scored.requirements.filter(rule=>!rule.satisfied)) {
    const available=[...prepared,...questions].filter(q=>matchesRule(q,rule));
    const count=rule.preparedCount+'/'+rule.count+' required questions';
    const marks=rule.minMarks?', '+rule.preparedMarks+'/'+rule.minMarks+' evidenced marks under the stated choice rule':'';
    warnings.push(ruleLabel(rule)+': '+count+marks+'. '+(!available.length?'No matching question evidence was found.':'The current plan does not meet this requirement within the available evidence and study budget.'));
  }
  if(!selected.length && questions.length) warnings.push('No complete question fits the available preparation time.');
  const firstTen=ordered.length>10?measurements([...prepared,...ordered.slice(0,10)],groups):scored.requirements;
  if(ordered.length>10 && scored.requirements.some((rule,i)=>rule.satisfied&&!firstTen[i].satisfied))
    warnings.push('Open the additional recommendations. The first ten alone do not cover all requirements met by the full plan.');
  for(const rule of scored.requirements.filter(rule=>rule.coverageOnly && rule.satisfied))
    warnings.push(ruleLabel(rule)+' is represented. The rule did not specify how many questions must be answered.');
  return {...scored,method,totalAvailableMinutes,preparationBudgetMinutes,revisionMinutes,
    selectedQuestionIds:ordered.map(q=>q.id),uncoveredTopicIds:topics.map(topic=>topic.id).filter(id=>!scored.coveredTopicIds.includes(id)),warnings,
    alternatives:{knapsack:additiveScore,coverage:coverageScore}};
}

