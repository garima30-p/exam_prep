import { buildPlan } from './engine.mjs';
import { makeLearningPlan } from './learning.mjs';
import { exactQuestionKey, groupQuestions } from './semantic.mjs';

const isoDate=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&
  Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const ref=(file,page,number)=>JSON.stringify([file,page,String(number)]);
const normalizeWhitespace=text=>text.replace(/\s+/g,' ').trim();
const refs=q=>q.sources??[q.source];
const unique=array=>[...new Set(array)];
const sum=array=>array.reduce((a,b)=>a+b,0);

function materialize(papers,syllabus) {
  return [...papers.map(paper=>({...paper.material,kind:'Past paper'})),
    ...(syllabus?[{...syllabus.material,kind:'Syllabus'}]:[])].map((material,id)=>({...material,id}));
}

function labelsFor(papers) {
  return new Map(papers.flatMap(paper=>(paper.items??[]).map(item=>
    [ref(paper.material.name,item.page,item.number),item.concept])));
}

function concepts(q,labels) {
  return unique(refs(q).map(source=>labels.get(ref(source.file,source.page,source.number))).filter(Boolean));
}

function groupingMetrics(original,grouped,labels) {
  const family=new Map(grouped.flatMap(q=>q.variants?.map(variant=>[variant.id,q.id])??[[q.id,q.id]]));
  const annotated=original.map(q=>({id:q.id,labels:concepts(q,labels)})).filter(q=>q.labels.length===1);
  let tp=0,fp=0,fn=0,tn=0;
  for(let i=0;i<annotated.length;i++)for(let j=i+1;j<annotated.length;j++){
    const a=annotated[i],b=annotated[j];
    const equivalent=a.labels[0]===b.labels[0];
    const predicted=family.get(a.id)===family.get(b.id);
    if(equivalent){if(predicted)tp++;else fn++;}
    else if(predicted)fp++;else tn++;
  }
  return {tp,fp,fn,tn,labeledCandidates:annotated.length,
    precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null};
}

export function gradeSections(items,matched,sections) {
  if(!items.length)return {sections:[],knownMarksCovered:null,knownMarksAvailable:null,marksCoverage:null};
  const matches=new Set(matched);
  const reports=unique([...items.map(item=>item.section),...(sections??[]).map(rule=>rule.id)]).map(section=>{
    const group=items.filter(item=>item.section===section);
    const rule=sections?.find(rule=>rule.id===section);
    const required=group.filter(item=>item.required);
    const optional=group.filter(item=>!item.required);
    const valid=Number.isSafeInteger(rule?.answer)&&rule.answer>=required.length&&rule.answer<=group.length;
    const choose=valid?rule.answer-required.length:0;
    const maxMarks=questions=>sum(questions.map(item=>item.marks??0).sort((a,b)=>b-a).slice(0,choose));
    const allMarksKnown=group.every(item=>Number.isFinite(item.marks)&&item.marks>=0);
    const requiredMatched=required.filter(item=>matches.has(item)).length;
    const optionalMatched=optional.filter(item=>matches.has(item));
    return {section,compulsory:rule?.compulsory===true||required.length>0,answer:valid?rule.answer:null,required:required.length,requiredMatched,
      coveredQuestions:group.filter(item=>matches.has(item)).length,
      satisfied:valid?requiredMatched===required.length&&optionalMatched.length>=choose:null,
      knownMarksCovered:valid?sum(required.filter(item=>matches.has(item)).map(item=>item.marks??0))+maxMarks(optionalMatched):null,
      knownMarksAvailable:valid?sum(required.map(item=>item.marks??0))+maxMarks(optional):null,allMarksKnown};
  });
  const declared=sections?.every(section=>reports.some(report=>report.section===section.id))??false;
  const structureKnown=declared&&reports.every(section=>section.answer!==null);
  const knownMarksCovered=structureKnown?sum(reports.map(section=>section.knownMarksCovered)):null;
  const knownMarksAvailable=structureKnown?sum(reports.map(section=>section.knownMarksAvailable)):null;
  const marksCoverage=structureKnown&&reports.every(section=>section.allMarksKnown)&&knownMarksAvailable>0
    ?knownMarksCovered/knownMarksAvailable:null;
  const compulsory=reports.filter(section=>section.compulsory);
  return {sections:reports,knownMarksCovered,knownMarksAvailable,marksCoverage,
    compulsorySections:{covered:compulsory.filter(section=>section.satisfied===true).length,total:compulsory.length}};
}

function citationAccuracy(questions,materials) {
  const documents=new Map(materials.map(material=>[material.name,material]));
  const citations=[...new Map(questions.flatMap(q=>[...refs(q),...(q.answerSource?[q.answerSource]:[])])
    .map(source=>[source.id??JSON.stringify(source),source])).values()];
  let valid=0;
  for(const source of citations) {
    const material=documents.get(source.file);
    const page=material?.pages.find(page=>page.number===source.page);
    const index=Number(source.id?.split(':').at(-1)??source.number.match(/^Line (\d+)$/)?.[1]);
    const text=page?.text.split(/\r?\n/)[index-1];
    if(text&&normalizeWhitespace(text).startsWith(source.excerpt)&&
      (!source.id||source.id.split(':')[0]===String(material.id)))valid++;
  }
  return {valid,total:citations.length,accuracy:citations.length?valid/citations.length:null};
}

function rankedQueue(questions,minutes,familiarity) {
  const plan=makeLearningPlan(questions,[],minutes,'',familiarity);
  let remaining=plan.preparationBudgetMinutes;
  const selected=questions.filter(q=>{
    const cost=plan.efforts[q.id].minutes;
    if(cost>remaining)return false;
    remaining-=cost;
    return true;
  });
  return {selected,estimatedPreparationMinutes:plan.preparationBudgetMinutes-remaining};
}

function evaluatePlan(selected,time,topics,materials,heldOut,labels) {
  const prepared=selected.map(question=>{
    const variants=question.variants??[question];
    const allLabels=concepts(question,labels);
    const representative=concepts(variants[0],labels);
    if(allLabels.length<=1)return {variants,labels:allLabels};
    const admissible=variants.filter((variant,index)=>index===0||
      (representative.length===1&&concepts(variant,labels).includes(representative[0])));
    return {variants:admissible,labels:representative.length===1?representative:[]};
  });
  const exact=new Set(prepared.flatMap(question=>question.variants.map(variant=>exactQuestionKey(variant.prompt))));
  const coveredConcepts=new Set(prepared.flatMap(question=>question.labels));
  const selectedTopics=new Set(selected.flatMap(q=>q.topicIds));
  const syllabusTopics=topics.filter(topic=>topic.id.startsWith('syllabus:'));
  const exactItems=heldOut.items.filter(item=>exact.has(exactQuestionKey(item.question)));
  const exactSet=new Set(exactItems);
  const equivalentItems=heldOut.items.filter(item=>!exactSet.has(item)&&item.concept&&coveredConcepts.has(item.concept));
  const matched=[...exactItems,...equivalentItems];
  const matchedSet=new Set(matched);
  return {questions:selected.map(q=>({id:q.id,question:q.prompt,sources:refs(q)})),
    exactMatches:exactItems.length,equivalentMatches:equivalentItems.length,heldOutQuestions:heldOut.items.length,
    annotatedHeldOutQuestions:heldOut.items.filter(item=>item.concept).length,
    weightedSyllabusCovered:sum(syllabusTopics.filter(topic=>selectedTopics.has(topic.id)).map(topic=>topic.weight)),
    weightedSyllabusAvailable:sum(syllabusTopics.map(topic=>topic.weight)),
    estimatedPreparationMinutes:time,citations:citationAccuracy(selected,materials),
    ...gradeSections(heldOut.items,matched,heldOut.sections),
    uncovered:heldOut.items.filter(item=>!matchedSet.has(item)).map(({number,section,concept,question})=>({number,section,concept,question}))};
}

/** Ground-truth annotations are read only after building and selecting the plans. */
export async function evaluateHistorical(dataset,embed) {
  if(!Array.isArray(dataset.papers)||!Array.isArray(dataset.holdouts))throw new Error('Provide papers and holdouts arrays.');
  const ids=new Set(),names=new Set();
  for(const paper of dataset.papers){
    if(!paper.id||!isoDate(paper.date)||!paper.material?.name||!Array.isArray(paper.material.pages)||
      ids.has(paper.id)||names.has(paper.material.name))throw new Error('Each paper needs a unique ID and filename, an ISO date, and pages.');
    ids.add(paper.id);names.add(paper.material.name);
  }
  const reports=[];
  const orderedHoldouts=dataset.holdouts.map(id=>{
    const paper=dataset.papers.find(candidate=>candidate.id===id);
    if(!paper)throw new Error('Unknown holdout: '+id);
    return paper;
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  for(const heldOut of orderedHoldouts){
    const holdoutId=heldOut.id;
    if(!heldOut||!Array.isArray(heldOut.items))throw new Error('Label the held-out paper items: '+holdoutId);
    const cutoff=heldOut.planningDate??heldOut.date;
    if(!isoDate(cutoff)||cutoff>heldOut.date)throw new Error('Invalid planning cutoff: '+holdoutId);
    const training=dataset.papers.filter(paper=>paper.date<cutoff&&paper.id!==holdoutId)
      .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
    const syllabus=(dataset.syllabi??[]).filter(version=>isoDate(version.availableOn)&&version.availableOn<cutoff&&
      (!version.effectiveOn||(isoDate(version.effectiveOn)&&version.effectiveOn<=heldOut.date)))
      .sort((a,b)=>b.availableOn.localeCompare(a.availableOn))[0];
    const materials=materialize(training,syllabus);
    const {questions,topics}=buildPlan(materials);
    let vectors=null;
    let fallback=null;
    if(embed&&questions.length>1){
      try {vectors=await embed(questions.map(q=>q.prompt));}
      catch {fallback='Model unavailable. Exact grouping used.';}
    }
    const semantic=groupQuestions(questions,topics,vectors);
    const minutes=dataset.minutes??120, familiarity=dataset.familiarity??'unknown';
    const pattern=(dataset.planningRules??[]).filter(rule=>isoDate(rule.availableOn)&&rule.availableOn<cutoff)
      .sort((a,b)=>b.availableOn.localeCompare(a.availableOn))[0]?.pattern??'';
    const optimized=makeLearningPlan(semantic.questions,semantic.topics,minutes,pattern,familiarity);
    const exactQueue=rankedQueue(questions,minutes,familiarity);
    const repeatQueue=rankedQueue(questions.slice().sort((a,b)=>b.historicalFrequency-a.historicalFrequency),minutes,familiarity);
    const semanticQueue=rankedQueue(semantic.questions,minutes,familiarity);
    const selected=new Set(optimized.selectedQuestionIds);
    const labels=labelsFor(training);
    const review=semantic.review.map(pair=>{
      const a=concepts(questions.find(q=>q.id===pair.left.id),labels);
      const b=concepts(questions.find(q=>q.id===pair.right.id),labels);
      return {...pair,label:a.length===1&&b.length===1?(a[0]===b[0]?'equivalent':'different'):'unlabeled'};
    });
    reports.push({holdout:heldOut.id,cutoff,training:training.map(paper=>paper.id),syllabus:syllabus?.material.name??null,
      mode:semantic.mode,fallback,grouping:groupingMetrics(questions,semantic.questions,labels),review,
      plans:{
        exactRanking:evaluatePlan(exactQueue.selected,exactQueue.estimatedPreparationMinutes,topics,materials,heldOut,labels),
        semanticRanking:evaluatePlan(semanticQueue.selected,semanticQueue.estimatedPreparationMinutes,topics,materials,heldOut,labels),
        semanticOptimized:{...evaluatePlan(semantic.questions.filter(q=>selected.has(q.id)),
          optimized.estimatedPreparationMinutes,topics,materials,heldOut,labels),warnings:optimized.warnings},
        repeatedOnly:evaluatePlan(repeatQueue.selected,repeatQueue.estimatedPreparationMinutes,topics,materials,heldOut,labels)
      }});
  }
  return {dataset:dataset.name??'Unnamed dataset',synthetic:dataset.synthetic===true,reports};
}

