import {useEffect,useRef,useState} from 'react';
import type {Source} from './api';
import type {BookPage} from './study-book';

export type LearningSource = (Source & {kind:'uploaded';id:string}) | {kind:'web';id:string;title:string;url:string};
export type PracticeItem={id:string;prompt:string;sources?:readonly Source[];answerSource?:Source|null;answer?:string};
type Explanation={text:string;sources:LearningSource[];generated:boolean};
type Detail={value?:Explanation;pending?:boolean;error?:string};
type Batch={items:PracticeItem[];pending?:boolean;error?:string;requested?:boolean};
export type PracticeTopic={key:string;subject:string;page:BookPage;demo:boolean};
const emptyBatch:Batch={items:[]};
const keyText=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function historicalQuestions(page:BookPage):PracticeItem[]{
  return page.questions.filter(question=>question.historical).map(question=>({
    id:'pyq-'+question.id,prompt:question.prompt,sources:question.sources?.length?question.sources:[question.source],answerSource:question.answerSource
  }));
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
    setBatches(current=>({...current,[topic.key]:{items:old.items,pending:true,requested:true}}));
    try{
      let prompts:{prompt:string;answer?:string}[];
      if(topic.demo)prompts=topic.page.questions.filter(question=>!question.historical).map(({prompt,answer})=>({prompt,answer}));
      else{
        const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.any([operation.signal,AbortSignal.timeout(25000)]),
          body:JSON.stringify({task:'practiceBatch',subject:topic.subject,topic:topic.page.title,count:Math.min(count,60-old.items.length),
            format,exclude:[...historicalQuestions(topic.page),...old.items].map(item=>item.prompt)})});
        const data=await response.json() as {questions?:{prompt:string}[]};
        if(!response.ok||!Array.isArray(data.questions))throw new Error('Practice questions could not load. Try again.');
        prompts=data.questions;
      }
      const used=new Set([...historicalQuestions(topic.page),...old.items].map(item=>keyText(item.prompt)));
      const added=prompts.flatMap(item=>{
        if(typeof item?.prompt!=='string')return [];
        const prompt=item.prompt.trim(), normalized=keyText(prompt);
        if(!normalized||used.has(normalized))return [];
        used.add(normalized);
        return [{id:'practice-'+normalized,prompt,answer:item.answer}];
      });
      if(!added.length)throw new Error(topic.demo?'No further example questions are available.':'No new questions were returned. Try again.');
      if(!operation.signal.aborted)setBatches(current=>({...current,[topic.key]:{items:[...old.items,...added].slice(0,60),requested:true}}));
    }catch(error){
      if(!operation.signal.aborted)setBatches(current=>({...current,[topic.key]:{items:old.items,requested:true,
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
      if(topic.demo){
        value={text:task==='answer'&&item?.answer?item.answer:task==='hint'?'Start by identifying the concepts named in the question.':'Use the sample question to identify the concept, then apply its rules in order.',sources:[],generated:false};
      }else{
        const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.any([operation.signal,AbortSignal.timeout(50000)]),
          body:JSON.stringify({task,mode:'auto',practiceExample:task==='example',topic:topic.page.title,subject:topic.subject,
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
