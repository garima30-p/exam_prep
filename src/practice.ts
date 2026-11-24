import {useEffect,useRef,useState} from 'react';
import type {Source} from './api';
import type {BookPage} from './study-book';

export type WebEvidence={kind:'web';id:string;title:string;url:string;publisher?:string;category?:'official-syllabus'|'official-pyq'|'academic-reference';
  excerpt?:string;supportingQuote?:string;status?:'page-inspected'|'provider-page-text'|'provider-excerpt';questions?:string[];scopeTopics?:string[];scopeOutline?:{title:string;group:string;excerpt:string}[]};
export type LearningSource=(Source & {kind:'uploaded';id:string})|WebEvidence;
export type AcademicResult={sources:WebEvidence[];scope:{requested:boolean;institution?:string;officialSyllabus:boolean;officialPyq:boolean};
  officialSearch?:{code:string;providerStatus?:number|null;cached?:boolean;attempted?:boolean}|null;webSearch?:{code:string}|null};

export type PracticeItem={id:string;prompt:string;sources?:readonly Source[];officialSource?:WebEvidence;answerSource?:Source|null;answer?:string};
type Explanation={text:string;sources:LearningSource[];generated:boolean};
type Detail={value?:Explanation;pending?:boolean;error?:string};
type Batch={items:PracticeItem[];pending?:boolean;error?:string;requested?:boolean;curriculum?:WebEvidence[]};
export type PracticeTopic={key:string;subject:string;page:BookPage;university:string;official:WebEvidence[]};
const emptyBatch:Batch={items:[]};
const keyText=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function historicalQuestions(topic:PracticeTopic):PracticeItem[]{
  const uploaded=topic.page.questions.filter(question=>question.historical).map(question=>({
    id:'pyq-'+question.id,prompt:question.prompt,sources:question.sources?.length?question.sources:[question.source],answerSource:question.answerSource
  }));
  const root=keyText(topic.page.title)===keyText(topic.subject);
  const terms=keyText(topic.page.title).split(' ').filter(word=>word.length>3);
  const seen=new Set(uploaded.map(item=>keyText(item.prompt)));
  const official=topic.official.filter(source=>source.category==='official-pyq').flatMap(source=>(source.questions??[]).flatMap(prompt=>{
    const key=keyText(prompt);
    if(seen.has(key)||(!root&&!terms.some(word=>key.includes(word))))return [];
    seen.add(key);return [{id:'official-'+JSON.stringify([source.url,key]),prompt,officialSource:source}];
  }));
  return [...official,...uploaded];
}

export function usePractice(){
  const [batches,setBatches]=useState<Record<string,Batch>>({});
  const [details,setDetails]=useState<Record<string,Detail>>({});
  const requests=useRef(new Map<string,AbortController>());
  useEffect(()=>()=>requests.current.forEach(operation=>operation.abort()),[]);

  function reset(){
    requests.current.forEach(operation=>operation.abort());
    requests.current.clear();
    setBatches({});setDetails({});
  }

  async function add(topic:PracticeTopic,count=6,format='',initial=false){
    const key='batch:'+topic.key, old=batches[topic.key]??emptyBatch;
    if(requests.current.has(key)||old.items.length>=60||(initial&&old.requested))return;
    const operation=new AbortController();
    requests.current.set(key,operation);
    setBatches(current=>({...current,[topic.key]:{...old,pending:true,error:undefined,requested:true}}));
    try{
      let prompts:{prompt:string;answer?:string}[];
      let curriculum:WebEvidence[]|undefined;
      {
        const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.any([operation.signal,AbortSignal.timeout(47000)]),
          body:JSON.stringify({task:'practiceBatch',subject:topic.subject,topic:topic.page.title,university:topic.university,academicGrounding:true,sources:topic.page.passages,count:Math.min(count,60-old.items.length),
            format,exclude:[...historicalQuestions(topic),...old.items].map(item=>item.prompt)})});
        const data=await response.json() as {questions?:{prompt:string}[];curriculum?:WebEvidence[]};
        if(!response.ok||!Array.isArray(data.questions))throw new Error('Practice questions could not load. Try again.');
        prompts=data.questions;
        curriculum=data.curriculum??old.curriculum;
      }
      const used=new Set([...historicalQuestions(topic),...old.items].map(item=>keyText(item.prompt)));
      const added=prompts.flatMap(item=>{
        if(typeof item?.prompt!=='string')return [];
        const prompt=item.prompt.trim(), normalized=keyText(prompt);
        if(!normalized||used.has(normalized))return [];
        used.add(normalized);
        return [{id:'practice-'+normalized,prompt,answer:item.answer}];
      });
      if(!added.length)throw new Error('No new questions were returned. Try again.');
      if(!operation.signal.aborted)setBatches(current=>({...current,[topic.key]:{items:[...old.items,...added].slice(0,60),requested:true,curriculum}}));
    }catch(error){
      if(!operation.signal.aborted)setBatches(current=>({...current,[topic.key]:{...old,pending:false,requested:true,
        error:error instanceof Error&&error.name==='Error'?error.message:'Practice questions could not load. Try again.'}}));
    }finally{if(requests.current.get(key)===operation)requests.current.delete(key);}
  }

  function detailKey(topic:PracticeTopic,task:string,item?:PracticeItem,hintNumber=1){
    return JSON.stringify([topic.key,task,item?.id,hintNumber]);
  }

  async function load(topic:PracticeTopic,task:'example'|'hint'|'answer',item?:PracticeItem,hintNumber=1){
    const key=detailKey(topic,task,item,hintNumber);
    if(requests.current.has(key)||details[key]?.value)return;
    const operation=new AbortController();
    requests.current.set(key,operation);
    setDetails(current=>({...current,[key]:{pending:true}}));
    try{
      let value:Explanation;
      {
        const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.any([operation.signal,AbortSignal.timeout(50000)]),
          body:JSON.stringify({task,mode:'auto',academicGrounding:true,university:topic.university,practiceExample:task==='example',topic:topic.page.title,subject:topic.subject,
            request:task==='example'?'Show one solved example of '+topic.page.title+'.':item?.prompt,
            activeQuestion:item?.prompt,hintNumber,sources:item?.answerSource?[item.answerSource]:topic.page.passages})});
        const data=await response.json() as {explanation?:string;sources?:LearningSource[];generated?:boolean};
        if(!response.ok||!data.explanation?.trim())throw new Error('This explanation could not load.');
        value={text:data.explanation,sources:data.sources??[],generated:data.generated!==false};
      }
      if(!operation.signal.aborted)setDetails(current=>({...current,[key]:{value}}));
    }catch{
      if(!operation.signal.aborted)setDetails(current=>({...current,[key]:{error:'This explanation could not load. Try again.'}}));
    }finally{if(requests.current.get(key)===operation)requests.current.delete(key);}
  }
  return {batches,details,add,load,detailKey,reset};
}
