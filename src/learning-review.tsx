import {useRef,useState} from 'react';
import type {Source} from './api';
import type {BookPage} from './study-book';
import type {LearningSource,PracticeItem} from './practice';
import {sourceLabel} from './study-pack';
import {browserTiming,now} from '../server/performance.mjs';
import {gradeChoice,gradeVerifiedCalculation,reviewUnavailable,verifiedAnswer} from '../server/quiz-evaluation.mjs';
import type {ReviewGrade} from '../server/quiz-evaluation.mjs';

type ReviewRule=
  | {kind:'choice'|'boolean';options:{id:string;label:string}[];key:string;expected:string}
  | {kind:'numeric';expected:string}
  | {kind:'descriptive';rubric:string[];evidence:string[]}
  | {kind:'unverified'};

export type ReviewItem={id:string;topic:string;prompt:string;rule:ReviewRule;historical?:boolean;sources?:readonly Source[];references?:readonly LearningSource[]};
type Lesson={text:string;references:readonly LearningSource[]};

const sentences=(text:string)=>text.split(/\n+/).filter(line=>!/^\s*(?:#|\||\x60{3})/.test(line))
  .flatMap(line=>line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/,'').split(/(?<=[.!?])\s+/))
  .map(line=>line.trim()).filter(line=>line.length>=28&&line.length<=360&&!line.endsWith('?'));
const termKey=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const quoteFor=(source:LearningSource)=>source.supportingQuotes?.join('\n')||source.supportingQuote||source.excerpt||'';

export function reviewItems(page:BookPage,lesson:Lesson,includePyq:boolean,practice:readonly PracticeItem[]=[]):ReviewItem[]{
  const notes:LearningSource[]=page.passages.filter(source=>['Notes','Pasted notes'].includes(source.documentType??''))
    .map((source,index)=>({...source,kind:'uploaded',id:'quiz-notes-'+index}));
  const cited=lesson.references.filter(source=>source.kind==='web'
    ?source.category!=='official-syllabus'&&source.category!=='official-pyq'&&!source.scopeOutline?.length
    :!['Past paper','Syllabus','Administrative'].includes(source.documentType??''));
  const sources=[...cited,...notes];
  const seen=new Set<string>();
  const definitions=sources.flatMap(source=>sentences(quoteFor(source)).flatMap(evidence=>{
    const match=evidence.match(/^(.{3,50}?)\s+(is|are|means|refers to)\s+(.{12,})$/i);
    if(!match)return [];
    const term=match[1].replace(/^(?:an?|the)\s+/i,'');
    const key=termKey(term);
    if(seen.has(key)||!/^[\p{L}][\p{L}\p{N} /()’-]+$/u.test(term)||
      /^(?:it|they|this|these|there|what|which|that|you|we|system|following|set of|group of|number of)\b/i.test(term))return [];
    seen.add(key);
    return [{term,verb:match[2],body:match[3],evidence,source}];
  }));
  const deadlockReference=sources.flatMap(source=>sentences(quoteFor(source)).map(evidence=>({source,evidence})))
    .find(({evidence})=>/\bdeadlock(?:ed)?\b/i.test(evidence)&&/\bwait(?:s|ing)?\b/i.test(evidence)&&/\b(?:each other|another process|one another|circular|held by)\b/i.test(evidence));
  const asksDeadlock=/\bdeadlocks?\b/i.test(page.title)||definitions.some(item=>/^deadlock$/i.test(item.term));
  const fact=definitions.find(item=>termKey(page.title)===termKey(item.term))??definitions[0];
  const factRule=(points:string[]):ReviewRule=>({kind:'descriptive',rubric:points,evidence:points});
  const item=(id:string,prompt:string,rule:ReviewRule,reference?:LearningSource):ReviewItem=>
    ({id:page.id+'-'+id,topic:page.title,prompt,rule,references:reference?[reference]:undefined});
  const recall:ReviewItem[]=[];
  if(deadlockReference&&asksDeadlock){
    recall.push(item('definition-deadlock','What is deadlock?',factRule([deadlockReference.evidence]),deadlockReference.source));
  }else if(fact){
    recall.push(item('definition-'+termKey(fact.term),'Explain '+fact.term+' in your own words.',factRule([fact.evidence]),fact.source));
  }
  if(fact){
    const alternatives=definitions.filter(other=>other!==fact&&termKey(other.body)!==termKey(fact.body)&&
      !termKey(other.term).includes(termKey(fact.term))&&!termKey(fact.term).includes(termKey(other.term))&&
      !termKey(other.evidence).includes(termKey(fact.term))).slice(0,3);
    const choices=[...alternatives.map(({term})=>term),fact.term].sort((a,b)=>a.localeCompare(b));
    if(choices.length>1){
      recall.push(item('choice-'+termKey(fact.term),'Which term completes this statement from the study source? ___ '+fact.verb+' '+fact.body,
        {kind:'choice',options:choices.map((label,index)=>({id:String(index),label})),key:String(choices.indexOf(fact.term)),expected:fact.evidence},fact.source));
    }
    const statement=definitions[1]??fact;
    recall.push(item('true-false-'+termKey(statement.term),'True or false? '+statement.evidence,
      {kind:'boolean',options:[{id:'true',label:'True'},{id:'false',label:'False'}],key:'true',expected:statement.evidence},statement.source));
  }
  if(!recall.length&&sentences(lesson.text).length)
    recall.push(item('review','Explain one key idea from '+page.title+'.',{kind:'unverified'}));

  const historical=includePyq?page.questions.filter(question=>question.historical).map(question=>({
    id:'pyq-'+question.id,prompt:question.prompt,sources:question.sources?.length?question.sources:[question.source],historical:true,
    answerSource:question.answerSource
  })):[];
  const fromQuestions=[...historical,...practice.map(question=>({...question,historical:false}))].flatMap(question=>{
    const solved=verifiedAnswer(question.prompt);
    let rule:ReviewRule={kind:'unverified'};
    if(solved)rule={kind:'numeric',expected:solved.solution.explanation};
    else if(question.historical&&question.answerSource&&question.answerSource.documentType==='Notes'&&
      /^\s*(?:what (?:is|are)|define|explain|describe|compare|contrast|discuss)\b/i.test(question.prompt)){
      const points=sentences(question.answerSource.supportingQuote||question.answerSource.excerpt).slice(0,3);
      if(points.length)rule=factRule(points);
    }
    if(!question.historical&&rule.kind==='unverified')return [];
    return [{...item(question.id,question.prompt,rule),historical:question.historical,sources:question.sources}];
  });
  return [...recall,...fromQuestions.filter(question=>question.rule.kind==='numeric').slice(0,2),
    ...fromQuestions.filter(question=>question.rule.kind!=='numeric').slice(0,1)];
}

const gradeLabels={correct:'✅ Correct!',partial:'🟡 Partially correct',incorrect:'❌ Incorrect',needs_review:'Needs review'};

type Evaluation={response:string;grade?:ReviewGrade;error?:boolean};
type ItemAttempt={response:string;evaluations:Evaluation[];revealed?:boolean};
export type ReviewAttempt=Record<string,ItemAttempt>;
const emptyItem:ItemAttempt={response:'',evaluations:[]};
type ChangeAttempt=(update:(prev:ReviewAttempt)=>ReviewAttempt)=>void;

function expectedFor(rule:ReviewRule){
  if(rule.kind==='descriptive')return rule.rubric.join('\n\n');
  return 'expected' in rule?rule.expected:null;
}

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
  if(!item)return <p>Read a topic to unlock practice from its notes.</p>;
  // Include the evidence and prompt so an edited lesson cannot reuse an unrelated grade.
  const key=JSON.stringify([item.id,item.prompt,item.rule]);
  const current=results[key]??emptyItem;
  const answer=current.response.trim();
  const evaluation=current.evaluations.find(entry=>entry.response===answer);
  const grade=evaluation?.grade;
  const rule=item.rule;
  const expected=current.revealed?expectedFor(rule):grade?.status!=='needs_review'?grade?.expectedAnswer:null;
  const change=(updater:(entry:ItemAttempt)=>ItemAttempt)=>update(previous=>({...previous,[key]:updater(previous[key]??emptyItem)}));

  async function evaluate(){
    if(!answer||busy.current.has(key)||grade)return;
    const started=now();
    busy.current.add(key);
    setPending(new Set(busy.current));
    let result:ReviewGrade|undefined;
    try{
      if(rule.kind==='choice'||rule.kind==='boolean')result=gradeChoice(item.id,answer,rule.key,rule.options.map(option=>option.id),rule.expected);
      else if(rule.kind==='numeric')result=gradeVerifiedCalculation(item.id,item.prompt,answer);
      else if(rule.kind==='descriptive'){
        const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(24000),
          body:JSON.stringify({task:'grade',questionId:item.id,question:item.prompt,studentAnswer:answer,rubric:rule.rubric,evidence:rule.evidence})});
        const data=await response.json() as ReviewGrade;
        if(!response.ok||data.questionId!==item.id||!Object.hasOwn(gradeLabels,data.status)||data.validationMethod!=='ai_assisted'||
           typeof data.feedback!=='string'||!Array.isArray(data.missingPoints))throw new Error('Invalid evaluation');
        result=data;
      }else result=reviewUnavailable(item.id);
    }catch{/* Keep the response available for retry. */}
    finally{
      change(previous=>({...previous,evaluations:[{response:answer,grade:result,error:!result},
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
      {evaluation?.error&&!isPending&&<p role="alert">Your answer was saved. It could not be evaluated. Try again.</p>}
      {grade&&<div className={'quiz-feedback quiz-'+grade.status} role="status">
        <strong>{gradeLabels[grade.status]}</strong>
        {grade.validationMethod==='ai_assisted'&&<small>AI-assisted evaluation</small>}
        <p>{grade.feedback}</p>
        {!!grade.missingPoints.length&&<ul>{grade.missingPoints.map((point,index)=><li key={index}>{point}</li>)}</ul>}
        {grade.status!=='correct'&&revisit&&<button type="button" className="link accent" onClick={()=>revisit(item.topic)}>Revisit {item.topic}</button>}
      </div>}
      {expected&&(!evaluation?.error||current.revealed)&&<div className="quiz-feedback">
        <strong>Expected answer</strong>
        <p className="quiz-expected">{expected.replace(/\*\*/g,'')}</p>
        {item.references?.map(reference=>reference.kind==='web'
          ?<a key={reference.id} className="link source" href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a>
          :<button type="button" key={reference.id} className="link source" onClick={()=>openSource(reference)}>{sourceLabel(reference)}</button>)}
      </div>}
    </li></ol>
    <div className="quiz-actions">
      {!grade&&<button className="primary" disabled={!answer||isPending}>{evaluation?.error?'Retry':'Check answer'}</button>}
      {!expected&&!evaluation?.error&&!isPending&&expectedFor(rule)&&<button type="button" className="link"
        onClick={()=>change(previous=>({...previous,revealed:true}))}>Reveal answer</button>}
      {items.length>1&&<>
        <button type="button" className="link" disabled={index===0} onClick={()=>navigate(index-1)}>Previous question</button>
        <button type="button" className="link" disabled={index>=items.length-1} onClick={()=>navigate(index+1)}>Next question</button>
      </>}
    </div>
  </form>;
}
