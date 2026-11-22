import { makePlan } from './optimizer.mjs';

const profiles={
  definition:{minutes:[4,2,2],steps:['State the definition in one or two sentences.','Distinguish the term from a closely related term.','Recall the definition and an example without notes.']},
  explanation:{minutes:[6,4,3],steps:['State the central idea in your own words.','Explain the key steps or relationships in order.','Work through an example if the question calls for one.','Reproduce the explanation without notes.']},
  comparison:{minutes:[6,5,3],steps:['Define the items being compared.','Choose consistent criteria and compare both items against each criterion.','Reconstruct the comparison from memory.']},
  numerical:{minutes:[12,13,5],steps:['Identify the givens, unknowns and applicable method.','Recall the relevant formula or algorithm and when it applies.','Work a representative calculation without following a solved example.','Check units, assumptions and the result.']},
  code:{minutes:[9,12,5],steps:['Read the program, inputs and execution assumptions.','Trace the control flow and track program state or output.','Check the result on the specified case.','Reproduce the trace without notes.']},
  derivation:{minutes:[14,12,6],steps:['Identify the starting assumptions and target result.','Reproduce the derivation step by step and justify each transition.','Redo the derivation from memory and check the final expression.']},
  diagram:{minutes:[9,10,5],steps:['Identify the components and their relationships.','Draw and label the diagram without copying.','Check that the labels and connections explain the requested process.']},
  application:{minutes:[12,12,6],steps:['Identify the problem requirements and constraints.','Select a method and justify why it fits.','Apply the method to the scenario without referring to a worked solution.','Check the result against the original requirements.']}
};

export function familiarityFrom(text) {
  if(/\b(mostly revising|just revis(?:ing|ion)|only revis(?:ing|ion)|already know (?:this|the material))\b/i.test(text))return 'revising';
  if(/\b(starting from scratch|from scratch|new to (?:this|the subject)|never studied)\b/i.test(text))return 'scratch';
  if(/\b(somewhat familiar|partly familiar|know the basics)\b/i.test(text))return 'familiar';
  return 'unknown';
}

function questionType(prompt) {
  if(/\b(derive|prove|deduce)\b/i.test(prompt))return 'derivation';
  if(/\b(calculate|compute|solve|numerical|evaluate the value)\b/i.test(prompt))return 'numerical';
  if(/\b(?:code|program|pseudocode)\b/i.test(prompt)&&/\b(?:write|trace|correct|output|debug|execut(?:e|es))\b/i.test(prompt))return 'code';
  if(/\b(draw|sketch|diagram|plot|label the)\b/i.test(prompt))return 'diagram';
  if(/\b(compare|contrast|differentiate|distinguish)\b/i.test(prompt))return 'comparison';
  if(/\b(design|implement|apply|construct|demonstrate)\b/i.test(prompt))return 'application';
  if(/^(define|what is|state the definition)\b/i.test(prompt))return 'definition';
  return 'explanation';
}

export function describeLearning(question,topics=[]) {
  const type=questionType(question.prompt);
  const profile=profiles[type];
  const linked=topics.filter(topic=>question.topicIds.includes(topic.id)&&topic.id.startsWith('syllabus:')).slice(0,3);
  const steps=/\bround[ -]robin\b/i.test(question.prompt)&&type==='numerical'
    ?['Read the arrival times, burst times, and time quantum.','Build the Gantt chart and record each completion time.','Subtract arrival time from completion time, then subtract burst time to find waiting time.','Recalculate the average and verify every process ran for its full burst.']
    :/\bdeadlocks?\b/i.test(question.prompt)&&/\b(?:conditions|coffman)\b/i.test(question.prompt)
    ?['Define deadlock in terms of processes waiting for resources.','Name mutual exclusion, hold and wait, no preemption, and circular wait.','Explain why breaking any one condition prevents deadlock.','Reproduce the four conditions without notes.']
    :profile.steps;
  const specialized=steps!==profile.steps;
  const checkpoints=steps.map((text,index)=>({
    id:String(index+1),text,label:'Type guide',
    phase:index===0?'understanding':index===steps.length-1?'recall':'practice'
  }));
  if(!specialized&&linked.length){
    checkpoints[0]={...checkpoints[0],text:'Using the syllabus, explain how '+linked.map(topic=>topic.title).join(', ')+' relates to the question.',
      label:'Syllabus-linked'};
  } else if(!specialized) {
    const target=question.prompt.match(/^(?:define|explain|describe|compare|contrast|derive|draw|sketch)\s+([^\n?!]{5,100})[.?!]?$/i)?.[1]?.replace(/\.$/,'');
    if(target){
      const action=type==='comparison'?'Identify what the question asks you to compare'
        :type==='derivation'?'State the result you need to derive'
        :type==='diagram'?'Name the system or process you need to draw'
        :'Restate the concept or task from memory';
      checkpoints[0]={...checkpoints[0],text:action+': “'+target+'”.',label:'Question wording'};
    }
  }
  if(question.answerSource&&checkpoints.length<5){
    checkpoints.splice(1,0,{id:'source',text:'Use the cited notes excerpt to identify a relevant idea. Explain its connection to this question from memory.',
      phase:'understanding',label:'Notes-linked',source:question.answerSource});
  }
  const prereqs=question.prerequisites??[];
  const followupTasks=question.prompt.match(/[?.;]\s*(?:what|how|why|explain|discuss|compare|find|calculate|show|provide|draw|write)\b/gi)?.length??0;
  const extra=Math.min(4,followupTasks+Math.max(0,linked.length-1));
  const baseMinutes=profile.minutes.map((minutes,index)=>minutes+(index===0?extra:index===1?extra*2:Math.ceil(extra/2)));
  return {type,checkpoints,prerequisites:prereqs,
    difficulty:type==='derivation'||type==='numerical'||type==='code'||question.marks>=10||extra>=3?'higher':'standard',
    material:question.answerSource?'notes':linked.length?'syllabus':'question-only',baseMinutes};
}

export function learningEffort(question,familiarity='unknown',progress={}) {
  const learning=question.learning;
  const multipliers={scratch:[1.45,1.2,1],familiar:[.85,.9,1],revising:[.5,.7,1],unknown:[1.2,1.05,1]};
  const factors=Object.hasOwn(multipliers,familiarity)?multipliers[familiarity]:multipliers.unknown;
  const markFactor=question.marks>=10?1.25:1;
  const complexity=learning.difficulty==='higher'?1.12:1;
  const phases=['understanding','practice','recall'];
  const remaining={understanding:0,practice:0,recall:0};
  const estimated={...remaining};
  let completed=0,revision=0;
  for(const [i,phase] of phases.entries()){
    const steps=learning.checkpoints.filter(checkpoint=>checkpoint.phase===phase);
    const support=phase==='understanding'&&learning.material==='notes'?.9:1;
    const prerequisiteCost=phase==='understanding'?Math.min(8,learning.prerequisites.length*2):0;
    const total=Math.max(steps.length,Math.ceil(learning.baseMinutes[i]*factors[i]*markFactor*complexity*support)+prerequisiteCost);
    estimated[phase]=total;
    for(const [index,step] of steps.entries()){
      const part=Math.floor(total/steps.length)+Number(index<total%steps.length);
      const status=progress[step.id];
      if(status==='completed'){completed++;continue;}
      if(status==='revision')revision++;
      remaining[phase]+=status==='revision'?Math.max(1,Math.ceil(part*.55)):part;
    }
  }
  const minutes=Object.values(remaining).reduce((sum,value)=>sum+value,0);
  const status=completed===learning.checkpoints.length?'completed':revision?'revision':completed?'in-progress':'not-started';
  return {estimated,remaining,minutes,completed,status,total:learning.checkpoints.length};
}

export function makeLearningPlan(questions,topics,minutes,pattern,familiarity,progress={}) {
  const efforts={};
  const prepared=[];
  const pending=[];
  const preparationBudget=Math.floor(Math.max(0,Math.min(525600,minutes||0))*.9);
  for(const question of questions){
    const effort=learningEffort(question,familiarity,progress[question.id]);
    efforts[question.id]=effort;
    if(!effort.minutes) {
      prepared.push({...question,minutes:0});
      continue;
    }
    const effortShare=preparationBudget?Math.min(1,effort.minutes/preparationBudget):1;
    pending.push({...question,minutes:effort.minutes,
      priorityScore:Math.max(1,Math.round(question.priorityScore*(1-.12*effortShare)))});
  }
  const plan=makePlan(pending,topics,minutes,pattern,prepared);
  const selected=new Set(plan.selectedQuestionIds);
  const deferredReviews=pending.filter(question=>efforts[question.id].status==='revision'&&!selected.has(question.id)).length;
  if(deferredReviews)plan.warnings.push(deferredReviews+' question(s) marked for revision are outside the current shortlist. Find them under Revisit checkpoint progress.');
  return {...plan,efforts,preparedQuestionIds:prepared.map(q=>q.id)};
}

