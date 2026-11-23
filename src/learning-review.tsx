import {useState} from 'react';
import type {Source} from './api';
import type {BookPage} from './study-book';
import {sourceLabel} from './study-pack';

export type ReviewItem = {id:string;topic:string;prompt:string;answer:string;explanation:string;sources?:readonly Source[]};

export function reviewItems(page:BookPage,notes:string,includePyq:boolean):ReviewItem[] {
  const lines=notes.split(/\n+/).filter(line=>!/^\s*(?:#|\||```)/.test(line))
    .flatMap(line=>line.replace(/^\s*(?:[-*+] |\d+[.)]\s+)/,'').replace(/[*_`]/g,'').split(/(?<=[.!?])\s+/))
    .map(line=>line.trim()).filter(line=>line.length>=28&&line.length<=250&&!line.endsWith('?'));
  const recall:ReviewItem[]=[];
  for(const line of lines){
    const fact=line.match(/^(.{3,55}?)\s+(is|are|means|refers to|uses|allows|occurs|happens|stores|keeps|helps|manages|decides|allocates|prevents|evicts|reduces|determines)\s+(.{10,})$/i);
    if(!fact||!/^\p{L}/u.test(fact[1])||/^(?:it|they|this|these|there|what|which|that|you|we|a system|the system)\b/i.test(fact[1]))continue;
    const answer=fact[1].replace(/^(?:an?|the)\s+/i,'');
    if(!recall.some(item=>item.answer.toLowerCase()===answer.toLowerCase()))
      recall.push({id:page.id+'-recall-'+recall.length,topic:page.title,prompt:'Fill in the blank: ___ '+fact[2]+' '+fact[3],answer,explanation:line});
    if(recall.length===3)break;
  }
  if(!recall.length&&lines[0])recall.push({id:page.id+'-review',topic:page.title,prompt:'In your own words, explain one key idea from '+page.title+'.',answer:'',explanation:lines[0]});
  const historical=includePyq?page.questions.filter(question=>question.historical).slice(0,1)
    .map(question=>({id:page.id+'-pyq-'+question.id,topic:page.title,prompt:question.prompt,answer:'',
      explanation:question.answerSource?.excerpt||'',sources:question.sources?.length?question.sources:[question.source]})):[];
  return [...historical,...recall];
}

const normalize=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu,'').trim().replace(/^(?:a|an|the)\s+/,'').replace(/\s+/g,' ');

export function ReviewForm({items,openSource}:{items:readonly ReviewItem[];openSource:(source:Source)=>void}){
  const [responses,setResponses]=useState<Record<string,string>>({});
  const [submitted,setSubmitted]=useState(false);
  const misses=items.filter(item=>item.answer&&normalize(responses[item.id]??'')!==normalize(item.answer));
  if(!items.length)return <p>Read a topic to unlock practice from its notes.</p>;
  return <form onSubmit={event=>{event.preventDefault();setSubmitted(true);}}>
    <ol className="learning-quiz">
      {items.map(item=>{
        const missed=misses.includes(item);
        return <li key={item.id}>
          <small>{item.sources?'Previous-year question':'Notes-based practice'} · {item.topic}</small>
          <label>{item.prompt}<textarea rows={2} value={responses[item.id]??''} readOnly={submitted}
            onChange={event=>setResponses(current=>({...current,[item.id]:event.target.value}))}/></label>
          {item.sources?.map((source,index)=><button type="button" key={index} className="link source" onClick={()=>openSource(source)}>{sourceLabel(source)}</button>)}
          {submitted&&<div className="quiz-feedback">
            <strong>{item.answer?(missed?'Review this idea':'Correct'):'Self-check'}</strong>
            {missed&&<p>Expected: {item.answer}</p>}
            <p>{item.explanation||(item.sources?'This paper does not include a verified answer. Use your notes to review the topic.':'Compare your answer with the notes.')}</p>
          </div>}
        </li>;
      })}
    </ol>
    {submitted?<div role="status">{misses.length>0&&<><strong>Topics to revisit</strong><ul>
      {[...new Set(misses.map(item=>item.topic))].map(topic=><li key={topic}>{topic}</li>)}
    </ul></>}<button type="button" className="link" onClick={()=>setSubmitted(false)}>Edit answers</button></div>
      :<button className="primary" disabled={!Object.values(responses).some(value=>value.trim())}>Check answers</button>}
  </form>;
}
