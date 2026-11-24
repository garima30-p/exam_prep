import {useRef,useState} from 'react';
import type {Source} from './api';
import type {BookPage} from './study-book';
import type {LearningSource,PracticeItem} from './practice';
import {sourceLabel} from './study-pack';
import {browserTiming,now} from '../server/performance.mjs';
import {gradeChoice,gradeVerifiedCalculation,recallFact,verifiedAnswer} from '../server/quiz-evaluation.mjs';
import type {ReviewGrade} from '../server/quiz-evaluation.mjs';

type ReviewRule=
  | {kind:'choice'|'boolean';options:{id:string;label:string}[];key:string;expected:string}
  | {kind:'numeric';expected:string}
  | {kind:'descriptive';referenceAnswer:string;rubric:string[];evidence:string[]};

export type ReviewItem={id:string;topic:string;prompt:string;rule:ReviewRule;historical?:boolean;sources?:readonly Source[];references?:readonly LearningSource[]};
type Lesson={text:string;references:readonly LearningSource[]};

const sentences=(text:string)=>text.split(/\n+/).filter(line=>!/^\s*(?:#|\||\x60{3})/.test(line))
  .flatMap(line=>line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/,'').split(/(?<=[.!?])\s+/))
  .map(line=>line.replace(/\*\*|__|\x60/g,'').trim()).filter(line=>line.length>=28&&line.length<=360&&!line.endsWith('?'));
const termKey=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const quoteFor=(source:LearningSource)=>source.supportingQuotes?.join('\n')||source.supportingQuote||source.excerpt||'';

const cachedRecall=new WeakMap<Lesson,WeakMap<BookPage,ReviewItem[]>>();
const topicTerms=(value:string)=>termKey(value).split(' ').filter(word=>!['intro','introduction','overview','basics','fundamentals','and','the','of','to'].includes(word))
  .map(word=>word.length>=4?word.replace(/s$/,''):word);
const relevant=(statement:string,topic:string)=>{
  const terms=topicTerms(topic);
  const seen=new Set(topicTerms(statement));
  return terms.length>0&&terms.filter(term=>seen.has(term)).length>=Math.min(terms.length,2);
};
const reviewItem=(page:BookPage,id:string,prompt:string,rule:ReviewRule,reference?:LearningSource):ReviewItem=>
  ({id:page.id+'-'+id,topic:page.title,prompt,rule,references:reference?[reference]:undefined});

function recallItems(page:BookPage,lesson:Lesson):ReviewItem[]{
  const byPage=cachedRecall.get(lesson)??new WeakMap<BookPage,ReviewItem[]>();
  const cached=byPage.get(page);
  if(cached)return cached;

  const notes:LearningSource[]=page.passages.filter(source=>['Notes','Pasted notes'].includes(source.documentType??''))
    .map((source,index)=>({...source,kind:'uploaded',id:'quiz-notes-'+index}));
  const cited=lesson.references.filter(source=>source.kind==='web'
    ?source.category!=='official-syllabus'&&source.category!=='official-pyq'&&!source.scopeOutline?.length
    :!['Past paper','Syllabus','Administrative'].includes(source.documentType??''));
  const seen=new Set<string>();
  function facts(text:string,source?:LearningSource){
    return sentences(text).slice(0,32).flatMap(statement=>{
      const fact=recallFact(statement);
      if(!fact)return [];
      const key=termKey(fact.term);
      if(seen.has(key))return [];
      seen.add(key);
      return [{...fact,source}];
    });
  }
  const documented=[...cited,...notes].flatMap(source=>facts(quoteFor(source),source));
  const fromLesson=facts(lesson.text);
  const matches=(fact:typeof documented[number])=>relevant(fact.referenceAnswer,page.title);
  const fact=documented.find(matches)??fromLesson.find(matches);
  const items:ReviewItem[]=[];
  if(fact){
    const {prompt,term,referenceAnswer,rubric,evidence,source}=fact;
    items.push(reviewItem(page,'fact-'+termKey(term),prompt,{kind:'descriptive',referenceAnswer,rubric,evidence},source));
  }

  // Closed questions use an exact statement in the cited material or uploaded notes.
  const keyed=documented.find(candidate=>candidate!==fact&&matches(candidate))??documented.find(matches);
  if(keyed&&(keyed.verb==='is'||keyed.verb==='are')){
    const alternatives=documented.filter(other=>other!==keyed&&termKey(other.body)!==termKey(keyed.body)&&
      !termKey(other.term).includes(termKey(keyed.term))&&!termKey(keyed.term).includes(termKey(other.term))&&
      !termKey(other.referenceAnswer).includes(termKey(keyed.term))).slice(0,3);
    const choices=[...alternatives.map(({term})=>term),keyed.term].sort((a,b)=>a.localeCompare(b));
    if(choices.length>1){
      items.push(reviewItem(page,'choice-'+termKey(keyed.term),'Which term completes this statement from the study source? ___ '+keyed.verb+' '+keyed.body,
        {kind:'choice',options:choices.map((label,index)=>({id:String(index),label})),key:String(choices.indexOf(keyed.term)),expected:keyed.referenceAnswer},keyed.source));
    }
  }
  const statement=documented.find(candidate=>candidate!==keyed&&candidate!==fact&&matches(candidate));
  if(statement){
    items.push(reviewItem(page,'true-false-'+termKey(statement.term),'True or false? '+statement.referenceAnswer,
      {kind:'boolean',options:[{id:'true',label:'True'},{id:'false',label:'False'}],key:'true',expected:statement.referenceAnswer},statement.source));
  }
  byPage.set(page,items);
  cachedRecall.set(lesson,byPage);
  return items;
}

export function uniqueReviewItems(items:readonly ReviewItem[],limit=8){
  const seen=new Set<string>();
  return items.filter(item=>{
    const key=termKey(item.prompt);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  }).slice(0,limit);
}

export function reviewItems(page:BookPage,lesson:Lesson,includePyq:boolean,practice:readonly PracticeItem[]=[]):ReviewItem[]{
  const recall=recallItems(page,lesson);
  if(!includePyq)return recall;
  const historical=page.questions.filter(question=>question.historical).map(question=>({
    id:'pyq-'+question.id,prompt:question.prompt,sources:question.sources?.length?question.sources:[question.source],historical:true
  }));
  const numerical=[...historical,...practice.map(question=>({...question,historical:false}))].flatMap(question=>{
    const solved=verifiedAnswer(question.prompt);
    if(!solved)return [];
    const item=reviewItem(page,question.id,question.prompt,{kind:'numeric',expected:solved.solution.explanation});
    return [{...item,historical:question.historical,sources:question.sources}];
  });
  return uniqueReviewItems([...recall,...uniqueReviewItems(numerical,2)]);
}

const gradeLabels={correct:'✅ Correct!',partial:'🟡 Partially correct',incorrect:'❌ Incorrect',needs_review:'Needs review'};

type Evaluation={response:string;grade?:ReviewGrade;error?:string};
type ItemAttempt={response:string;evaluations:Evaluation[]};
export type ReviewAttempt=Record<string,ItemAttempt>;
const emptyItem:ItemAttempt={response:'',evaluations:[]};
type ChangeAttempt=(update:(prev:ReviewAttempt)=>ReviewAttempt)=>void;

export function ReviewForm({items,openSource,attempt,onAttempt,revisit}:{items:readonly ReviewItem[];openSource:(source:Source)=>void;
  attempt?:ReviewAttempt;onAttempt?:ChangeAttempt;revisit?:(topic:string)=>void}){
  const [local,setLocal]=useState<ReviewAttempt>({});
  const [index,setIndex]=useState(0);
  const [pending,setPending]=useState<ReadonlySet<string>>(new Set());
  const busy=useRef(new Set<string>());
  const focus=useRef<HTMLLegendElement>(null);
  const results=attempt??local;
  const update=onAttempt??setLocal;
  const item=items[Math.min(index,items.length-1)];
  if(!item)return <p>No graded questions are available for these notes.</p>;
  // Include the evidence and prompt so an edited lesson cannot reuse an unrelated grade.
  const key=JSON.stringify([item.id,item.prompt,item.rule]);
  const current=results[key]??emptyItem;
  const answer=current.response.trim();
  const evaluation=current.evaluations.find(entry=>entry.response===answer);
  const grade=evaluation?.grade;
  const rule=item.rule;
  const expected=grade?.expectedAnswer;
  const change=(updater:(entry:ItemAttempt)=>ItemAttempt)=>update(previous=>({...previous,[key]:updater(previous[key]??emptyItem)}));

  async function evaluate(){
    if(!answer||busy.current.has(key)||grade)return;
    const started=now();
    busy.current.add(key);
    setPending(new Set(busy.current));
    let result:ReviewGrade|undefined;
    let error='Your answer was saved. It could not be evaluated. Try again.';
    try{
      if(rule.kind==='choice'||rule.kind==='boolean')result=gradeChoice(item.id,answer,rule.key,rule.options.map(option=>option.id),rule.expected);
      else if(rule.kind==='numeric')result=gradeVerifiedCalculation(item.id,item.prompt,answer);
      else if(rule.kind==='descriptive'){
        const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(24000),
          body:JSON.stringify({task:'grade',questionId:item.id,question:item.prompt,studentAnswer:answer,referenceAnswer:rule.referenceAnswer,rubric:rule.rubric,evidence:rule.evidence})});
        const data=await response.json() as ReviewGrade;
        if(!response.ok||data.questionId!==item.id||!Object.hasOwn(gradeLabels,data.status)||data.validationMethod!=='ai_assisted'||
           typeof data.feedback!=='string'||!Array.isArray(data.missingPoints))throw new Error('Invalid evaluation');
        result=data;
      }
      if(result?.status==='needs_review'){
        if(result.validationMethod==='independent_calculation')error=result.feedback;
        result=undefined;
      }
    }catch{/* Keep the response available for retry. */}
    finally{
      change(previous=>({...previous,evaluations:[{response:answer,grade:result,error:result?undefined:error},
        ...previous.evaluations.filter(entry=>entry.response!==answer)].slice(0,16)}));
      busy.current.delete(key);
      setPending(new Set(busy.current));
      requestAnimationFrame(()=>browserTiming('study:quiz-evaluation',started));
    }
  }

  const navigate=(position:number)=>{
    setIndex(position);
    requestAnimationFrame(()=>focus.current?.focus());
  };
  const isPending=pending.has(key);
  const choice=rule.kind==='choice'||rule.kind==='boolean';
  return <form onSubmit={event=>{event.preventDefault();void evaluate();}}>
    <ol className="learning-quiz" start={index+1}><li>
      <small>{items.length>1?'Question '+(index+1)+' of '+items.length+' · ':''}
        {item.historical?'Previous-year question':rule.kind==='numeric'?'Numerical practice':'Notes-based practice'} · {item.topic}</small>
      <fieldset>
        <legend ref={focus} tabIndex={-1} style={{whiteSpace:'pre-wrap'}}>{item.prompt}</legend>
        {choice?rule.options.map(option=><label key={option.id} className="quiz-choice">
          <input type="radio" name={'answer-'+item.id} value={option.id} checked={current.response===option.id} disabled={isPending}
            onChange={()=>change(previous=>({...previous,response:option.id}))}/> {option.label}</label>):
          <textarea aria-label="Your answer" rows={3} value={current.response} maxLength={1800} readOnly={isPending}
            onChange={event=>{const response=event.target.value;change(previous=>({...previous,response}));}}/>}
      </fieldset>
      {item.sources?.map((source,index)=><button type="button" key={index} className="link source" onClick={()=>openSource(source)}>{sourceLabel(source)}</button>)}
      {isPending&&<p role="status">Checking answer…</p>}
      {evaluation?.error&&!isPending&&<p role="alert" className="quiz-feedback"><strong>Unable to evaluate.</strong> {evaluation.error}</p>}
      {grade&&<div className={'quiz-feedback quiz-'+grade.status} role="status">
        <strong>{gradeLabels[grade.status]}</strong>
        {grade.validationMethod==='ai_assisted'&&<small>AI-assisted evaluation · {item.references?.length?'based on source material':'based on this lesson'}</small>}
        <p>{grade.feedback}</p>
        {!!grade.missingPoints.length&&<ul>{grade.missingPoints.map((point,index)=><li key={index}>{point}</li>)}</ul>}
        {grade.status!=='correct'&&revisit&&<button type="button" className="link accent" onClick={()=>revisit(item.topic)}>Revisit {item.topic}</button>}
      </div>}
      {expected&&<div className="quiz-feedback">
        <strong>Expected answer</strong>
        <p className="quiz-expected">{expected.replace(/\*\*/g,'')}</p>
        {item.references?.map(reference=>reference.kind==='web'
          ?<a key={reference.id} className="link source" href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a>
          :<button type="button" key={reference.id} className="link source" onClick={()=>openSource(reference)}>{sourceLabel(reference)}</button>)}
      </div>}
    </li></ol>
    <div className="quiz-actions">
      {!grade&&<button className="primary" disabled={!answer||isPending}>{evaluation?.error?'Retry':'Check answer'}</button>}
      {items.length>1&&<>
        <button type="button" className="link" disabled={index===0} onClick={()=>navigate(index-1)}>Previous question</button>
        <button type="button" className="link" disabled={index>=items.length-1} onClick={()=>navigate(index+1)}>Next question</button>
      </>}
    </div>
  </form>;
}
