import {useState} from 'react';
import type {ReactNode} from 'react';
import type {Source} from './api';
import {historicalQuestions} from './practice';
import type {AnswerVerification,LearningSource,PracticeItem,PracticeTopic,usePractice} from './practice';
import {sourceLabel} from './study-pack';

type Practice=ReturnType<typeof usePractice>;
type Shared={topic:PracticeTopic;practice:Practice;renderText:(text:string)=>ReactNode;
  renderSources:(sources:readonly LearningSource[],generated:boolean,verification?:AnswerVerification)=>ReactNode};
type Props=Shared&{selected?:string;openSource:(source:Source)=>void;askCoach:(item:PracticeItem)=>void;selectQuestion:(item:PracticeItem)=>void};

function DetailResult({detail,retry,renderText,renderSources}:{
  detail:Practice['details'][string]|undefined;retry:()=>void;renderText:Shared['renderText'];renderSources:Shared['renderSources']
}){
  if(detail?.pending)return <p role="status">Loading explanation…</p>;
  if(detail?.error)return <p role="alert">{detail.error} <button type="button" className="link accent" onClick={retry}>Retry</button></p>;
  if(!detail?.value)return null;
  const {text,sources,generated,verification}=detail.value;
  return <>{renderText(text)}{renderSources(sources,generated,verification)}</>;
}

export function SolvedExample({topic,practice,renderText,renderSources,askCoach}:Shared&{askCoach?:(text:string)=>void}){
  const [expanded,setExpanded]=useState(false);
  const detail=practice.details[practice.detailKey(topic,'example')];
  const load=()=>void practice.load(topic,'example');
  return <div className="worked-example">
    <button type="button" className="link accent" aria-expanded={expanded} onClick={()=>{
      setExpanded(!expanded);
      if(!expanded&&!detail)load();
    }}>{expanded?'Hide example':'Show example'}</button>
    {expanded&&<section aria-label="Solved example" className="coach-selectable">
      <h3>Solved example</h3>
      <DetailResult detail={detail} retry={load} renderText={renderText} renderSources={renderSources}/>
      {detail?.value&&askCoach&&<button type="button" className="link accent" onPointerDown={event=>event.preventDefault()}
        onClick={()=>askCoach(detail.value!.text)}>Ask Coach about this example</button>}
    </section>}
  </div>;
}

export function PracticeQuestions({topic,practice,selected,openSource,askCoach,selectQuestion,renderText,renderSources}:Props){
  const [pyqOnly,setPyqOnly]=useState(false);
  const [format,setFormat]=useState('');
  const [count,setCount]=useState(6);
  const historical=historicalQuestions(topic);
  const batch=practice.batches[topic.key];
  const questions=pyqOnly?historical:[...historical.slice(0,4),...(batch?.items??[])];
  return <section className="practice-section" aria-label="Practice questions">
    <div className="practice-heading">
      <h3>Practice questions</h3>
      <label><input type="checkbox" checked={pyqOnly} onChange={event=>setPyqOnly(event.target.checked)}/> PYQs only</label>
    </div>
    {pyqOnly&&!historical.length&&<p>No official or uploaded previous-year questions were found for this topic.</p>}
    <ol className="practice-list">
      {questions.map((item,index)=><PracticeCard key={item.id} {...{item,index,topic,practice,openSource,askCoach,selectQuestion,renderText,renderSources}}
        selected={item.id===selected}/>)}
    </ol>
    {!pyqOnly&&<>
      {batch?.curriculum?.length?<details><summary>References used for practice scope</summary>{renderSources(batch.curriculum,false)}</details>:null}
      {batch?.pending&&<p role="status">Preparing practice questions…</p>}
      {batch?.error&&<p role="alert">{batch.error}</p>}
      <button type="button" className="secondary" disabled={batch?.pending||(batch?.items.length??0)>=60}
        onClick={()=>void practice.add(topic,count,format)}>{batch?.error&&!batch.items.length?'Retry practice questions':'More Questions ↓'}</button>
      <details className="practice-options"><summary>Question options</summary>
        <label>Number of questions<input type="number" min={1} max={10} value={count}
          onChange={event=>setCount(Math.min(10,Math.max(1,Number(event.target.value)||1)))}/></label>
        <label>Format<input value={format} maxLength={80} placeholder="e.g. numerical problems" onChange={event=>setFormat(event.target.value)}/></label>
      </details>
    </>}
  </section>;
}

function PracticeCard({item,index,topic,practice,selected,openSource,askCoach,selectQuestion,renderText,renderSources}:
  Omit<Props,'selected'>&{item:PracticeItem;index:number;selected:boolean}){
  const [showHint,setShowHint]=useState(false);
  const [hintNumber,setHintNumber]=useState(1);
  const [showAnswer,setShowAnswer]=useState(false);
  const hint=practice.details[practice.detailKey(topic,'hint',item,hintNumber)];
  const answer=practice.details[practice.detailKey(topic,'answer',item)];
  const loadHint=(number=hintNumber)=>void practice.load(topic,'hint',item,number);
  const loadAnswer=()=>void practice.load(topic,'answer',item);
  return <li className="practice-card" data-selected={selected||undefined}>
    <small>{index+1}. · {item.officialSource?'Official university PYQ':item.sources?'Uploaded PYQ':'AI-generated practice'}</small>
    {renderText(item.prompt)}
    {item.officialSource&&renderSources([{...item.officialSource,supportingQuote:item.prompt}],false)}
    {item.sources&&<details><summary>Sources ↗ ({item.sources.length})</summary>
      <small>Student-uploaded paper</small>
      {item.sources.map((source,index)=><button type="button" key={index} className="link source" onClick={()=>openSource(source)}>{sourceLabel(source)}</button>)}
    </details>}
    <div className="lesson-actions">
      <button type="button" className="link accent" aria-expanded={showHint} onClick={()=>{setShowHint(!showHint);if(!showHint){selectQuestion(item);if(!hint)loadHint();}}}>{showHint?'Hide hint':'Hint'}</button>
      <button type="button" className="link accent" aria-expanded={showAnswer} onClick={()=>{setShowAnswer(!showAnswer);if(!showAnswer){selectQuestion(item);if(!answer)loadAnswer();}}}>{showAnswer?'Hide Answer':'Show Answer'}</button>
      <button type="button" className="link accent" aria-pressed={selected} onClick={()=>askCoach(item)}>Ask Coach</button>
    </div>
    {showHint&&<div className="practice-explanation">
      <DetailResult detail={hint} retry={loadHint} renderText={renderText} renderSources={renderSources}/>
      {hint?.value&&hintNumber===1&&<button type="button" className="link" onClick={()=>{setHintNumber(2);loadHint(2);}}>Another hint</button>}
    </div>}
    {showAnswer&&<div className="practice-explanation"><DetailResult detail={answer} retry={loadAnswer} renderText={renderText} renderSources={renderSources}/></div>}
  </li>;
}
