import type { Analysis, Question, RankedQuestion, Source } from './api';
import { duration } from './api';
import { studySubject } from '../server/coach-topics.mjs';

export type BookPage = {
  id: string;
  title: string;
  group: string;
  questions: readonly Question[];
  passages: Source[];
};

export function studyTopic(prompt: string) {
  return prompt.trim().match(/^(?:could you |can you |please )?(?:help me (?:study|revise|prepare for)|teach me(?: about)?|explain|study|revise|learn(?: about)?)\s+([^.!?\n]{3,90})[.?!]?$/i)?.[1]?.trim() ?? '';
}

const normalize=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const osGroups=[
  {title:'Process Management',topics:['CPU Scheduling','Process Synchronization','Deadlock'],match:/process|schedul|synchron|deadlock|semaphore|mutex|critical section|banker/},
  {title:'Memory Management',topics:['Paging','Segmentation','Page Replacement'],match:/memory|paging|segmentation|replacement|fifo|lru|thrashing/},
  {title:'Storage and I/O',topics:[],match:/file system|disk|storage|device|input output/}
];

export function learningSubject(text:string,fallback='') {
  const subject=studySubject(text);
  if(subject==='operating systems')return 'Operating Systems';
  return fallback||subject.replace(/\b\w/g,letter=>letter.toUpperCase());
}

export function bookOutline(analysis:Analysis,subject:string,focus:string,passages:readonly Source[], outline:readonly {title:string;group:string}[]=[]) {
  const os=studySubject(subject)==='operating systems';
  const evidence=new Map<string,{title:string;questions:Question[];score:number}>();
  const candidates=analysis.optimization?.candidates??analysis.questions;
  for(const question of candidates){
    const id=normalize(question.topic);
    if(!id)continue;
    const record=evidence.get(id)??{title:question.topic,questions:[],score:0};
    record.questions.push(question);
    record.score=Math.max(record.score,'priorityScore' in question?(question as RankedQuestion).priorityScore:1);
    evidence.set(id,record);
  }
  const ranked=[...evidence.values()].sort((a,b)=>b.score-a.score);
  const titles=[focus||subject];
  const outlineGroups=new Map(outline.map(item=>[normalize(item.title),item.group]));
  if(os&&!focus){
    for(const group of osGroups){
      const related=[...ranked,...outline].filter(entry=>group.match.test(normalize(entry.title)));
      const children=related.length?related.map(entry=>entry.title):outline.length?[]:group.topics;
      if(children.length)titles.push(group.title,...children);
    }
  }
  titles.push(...outline.map(entry=>entry.title),...ranked.map(entry=>entry.title));
  const used=new Set<string>();
  return titles.flatMap(title=>{
    const id=normalize(title);
    if(!id||used.has(id))return [];
    used.add(id);
    const group=osGroups.find(entry=>os&&entry.match.test(id));
    const questions=evidence.get(id)?.questions??[];
    const first=questions[0];
    const words=id.split(' ').filter(word=>word.length>3);
    const relevant=passages.filter(source=>words.some(word=>normalize(source.excerpt).includes(word)));
    const sources=[...questions.flatMap(question=>question.answerSource?[question.answerSource]:[]),
      ...(id===normalize(focus||subject)&&!relevant.length?passages:relevant)];
    const identity=JSON.stringify([normalize(subject),id,...(first&&'topicIds' in first?(first as RankedQuestion).topicIds.slice().sort():[])]);
    const page:BookPage={id:identity,title,group:group?.title??outlineGroups.get(id)??'',questions,passages:[...new Map(sources.map(source=>[source.excerpt,source])).values()].slice(0,8)};
    return [page];
  }).slice(0,16);
}

export function studySessionPrompt(prompt:string) {
  return prompt.replace(/\b(?:i (?:only )?have|only have|i can study for|replan for)\s+(?:(?:only|just)\s+)?(?:\d+(?:\.\d+)?|[a-z]+(?:[- ][a-z]+)?)\s*(?:minutes?|mins?|hours?|hrs?|days?)\b(?:\s+to (?:study|prepare))?[,.!?;]*/gi,
    clause=>duration(clause)>0?'':clause).replace(/\s+/g,' ').trim();
}
