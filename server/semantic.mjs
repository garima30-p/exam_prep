import { describeLearning } from './learning.mjs';
import { initialMinutes, scorePriority } from './evidence.mjs';

export const MODEL_ID='Xenova/all-MiniLM-L6-v2';
export const MODEL_REVISION='6fa4bf687ce79106377b66d10009c0e513715e24';
export const EMBEDDING_LIMIT=100;
const REVIEW_THRESHOLD=.75;
const COMMAND=/^(?:(?:explain|describe|discuss|elaborate on|define|state|compare|contrast|differentiate(?: between)?|distinguish(?: between)?|what is|what are|what does|write (?:a )?short note (?:about|on))\s+)+/i;
const STOP=new Set(['a','an','the','of','for','in','with','is','are','between']);
const SYNONYMS=new Map(Object.entries({benefits:'advantage',advantages:'advantage',drawbacks:'disadvantage',disadvantages:'disadvantage',
  role:'purpose',functions:'function',differences:'difference',types:'type',properties:'property',characteristics:'property'}));
const SAFE_TYPES=new Set(['definition','explanation','comparison']);

export function exactQuestionKey(text) {
  return text.normalize('NFC').toLowerCase().trim().replace(/[.?!]+$/,'').replace(/\s+/g,' ');
}

function content(text) {
  return (text.normalize('NFC').toLowerCase().replace(COMMAND,'').match(/[\p{L}\p{N}]+|[()[\]{}+*/^%<>=−-]/gu)??[])
    .filter(token=>!STOP.has(token)).map(token=>SYNONYMS.get(token)??token);
}

export function cosine(a,b) {
  if(!a?.length||a.length!==b?.length)return null;
  let dot=0,left=0,right=0;
  for(let i=0;i<a.length;i++){
    const x=a[i],y=b[i];
    dot+=x*y;left+=x*x;right+=y*y;
  }
  const value=dot/Math.sqrt(left*right);
  return Number.isFinite(value)?Math.max(-1,Math.min(1,value)):null;
}

function decide(a,b,similarity) {
  const type=a.learning.type;
  if(type!==b.learning.type||!SAFE_TYPES.has(type))return 'question-type';
  if(a.units?.length&&b.units?.length&&!a.units.some(unit=>b.units.includes(unit)))return 'different-units';
  const core=content(a.prompt),other=content(b.prompt);
  if(core.length<2||core.join(' ')!==other.join(' '))return 'different-wording-scope';
  const knownA=a.topicIds.filter(id=>id.startsWith('syllabus:'));
  const knownB=b.topicIds.filter(id=>id.startsWith('syllabus:'));
  const shared=knownA.some(id=>knownB.includes(id));
  if(knownA.length&&knownB.length&&!shared)return 'different-syllabus-topics';
  if(similarity<(shared?.83:.88))return 'below-threshold';
  return 'eligible';
}

const unique=items=>[...new Set(items)];

function combine(members,topics) {
  if(members.length===1)return members[0];
  const first=members[0];
  const representative=members.find(question=>question.historical)??first;
  const sources=[...new Map(members.flatMap(question=>question.sources??[question.source]).map(source=>[source.id??JSON.stringify(source),source])).values()];
  const paperIds=unique(members.flatMap(question=>question.paperIds??[]));
  const known=unique(members.flatMap(question=>question.topicIds).filter(id=>id.startsWith('syllabus:')));
  const topicIds=known.length?known:first.topicIds;
  const marks=representative.historical?representative.marks:Math.max(...members.map(question=>question.marks));
  const marksByGroup={};
  for(const question of members)for(const [key,value] of Object.entries(question.marksByGroup??{}))
    marksByGroup[key]=Math.max(marksByGroup[key]??0,value);
  const historicalPaperCount=first.historicalPaperCount;
  const recurrence=historicalPaperCount?paperIds.length/historicalPaperCount:null;
  const strongest=key=>{
    const available=members.map(question=>question.scoreComponents[key]).filter(value=>value!==null&&value!==undefined);
    return available.length?Math.max(...available):null;
  };
  const minutes=initialMinutes(marks);
  const scoreComponents={historical:strongest('historical'),recurrence,marks:strongest('marks'),syllabus:strongest('syllabus'),
    breadth:known.length?Math.min(known.length,4)/4:null,recency:strongest('recency'),preparationTime:members.every(question=>question.scoreComponents?.preparationTime===null)?null:(30-minutes)/15};
  const withNotes=members.find(question=>question.answerSource)??first;
  const merged={...representative,id:first.id,sources,paperIds,topicIds,marks,minutes,marksByGroup,scoreComponents,priorityScore:scorePriority(scoreComponents),
    historicalFrequency:paperIds.length,sections:unique(members.flatMap(q=>q.sections??[])),units:unique(members.flatMap(q=>q.units??[])),
    examYears:unique(members.flatMap(q=>q.examYears??[])).sort((a,b)=>a-b),
    variants:members.map(q=>({id:q.id,prompt:q.prompt,sources:q.sources??[q.source]})),
    reason:paperIds.length?'Equivalent wording found in '+paperIds.length+' of '+historicalPaperCount+' distinct uploaded past papers':first.reason,
    answer:withNotes.answer,answerSource:withNotes.answerSource};
  const prerequisites=unique(members.flatMap(question=>question.learning.prerequisites)).slice(0,4);
  return {...merged,learning:describeLearning({...merged,prerequisites},topics)};
}

/** Complete-link families: a bridge cannot merge two variants that fail the pair gate. */
export function groupQuestions(questions,topics,vectors,collectReview=true) {
  if(!vectors)return {questions,topics,review:[],mode:'exact'};
  const bounded=questions.slice(0,EMBEDDING_LIMIT);
  const compatible=new Set();
  const pairs=[];
  const key=(a,b)=>a<b?a+':'+b:b+':'+a;
  for(let i=0;i<bounded.length;i++)for(let j=i+1;j<bounded.length;j++){
    const a=bounded[i],b=bounded[j];
    const similarity=cosine(vectors.get(a.prompt),vectors.get(b.prompt));
    if(similarity===null)continue;
    const decision=decide(a,b,similarity);
    if(decision==='eligible')compatible.add(key(a.id,b.id));
    if(collectReview&&similarity>=REVIEW_THRESHOLD)pairs.push({a,b,similarity,decision});
  }
  const families=[];
  const assigned=new Map();
  for(const question of questions){
    let family=families.find(members=>members.every(other=>compatible.has(key(question.id,other.id))));
    if(!family){family=[];families.push(family);}
    family.push(question);assigned.set(question.id,family[0].id);
  }
  const merged=families.map(family=>combine(family,topics)).sort((a,b)=>b.priorityScore-a.priorityScore||a.id-b.id);
  const activeTopics=new Map();
  for(const question of merged)for(const id of question.topicIds){
    const weight=1+(question.scoreComponents.recurrence??0);
    activeTopics.set(id,Math.max(weight,activeTopics.get(id)??0));
  }
  const familyTopics=topics.filter(topic=>topic.id.startsWith('syllabus:')||activeTopics.has(topic.id))
    .map(topic=>({...topic,weight:Math.max(topic.weight,activeTopics.get(topic.id)??0)}));
  const review=pairs.map(({a,b,similarity,decision})=>({
    left:{id:a.id,question:a.prompt,type:a.learning.type,sources:a.sources??[a.source]},
    right:{id:b.id,question:b.prompt,type:b.learning.type,sources:b.sources??[b.source]},
    similarity,decision,familyId:assigned.get(a.id)===assigned.get(b.id)?assigned.get(a.id):null
  }));
  return {questions:merged,topics:familyTopics,review,mode:'semantic'};
}

