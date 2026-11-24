import {topicKey} from '../server/study-material.mjs';
import type {WebEvidence} from './practice';
import type { Analysis, Question, Source } from './api';
import { duration } from './api';
import { studySubject } from '../server/coach-topics.mjs';

export type TopicOutline={title:string;group:string;source?:Source;reference?:WebEvidence;
  subject?:string;unit?:number;level?:'unit'|'major'|'subtopic';validation?:'document-structure'|'structured-ocr'|'published-curriculum'};

export type BookPage = {
  id: string;
  title: string;
  group: string;
  questions: readonly Question[];
  priorities?:readonly Question[];
  passages: Source[];
  scope?:Source;
  reference?:WebEvidence;
};

export function studyTopic(prompt: string) {
  return prompt.trim().match(/^(?:could you |can you |please )?(?:help me (?:study|revise|prepare for)|teach me(?: about)?|explain|study|revise|learn(?: about)?)\s+([^.!?\n]{3,90})[.?!]?$/i)?.[1]?.trim() ?? '';
}

const normalize=topicKey;
export function learningSubject(text:string,fallback='') {
  const subject=studySubject(text);
  if(subject==='operating systems')return 'Operating Systems';
  return fallback||subject.replace(/\b\w/g,letter=>letter.toUpperCase());
}

export function bookOutline(analysis:Analysis,subject:string,focus:string,passages:readonly Source[],
  outline:readonly TopicOutline[]=[]) {
  const root=focus||subject;
  const evidence=new Map<string,Question[]>();
  const ranked=analysis.optimization?.candidates??analysis.questions;
  const structured=outline.some(entry=>entry.source||entry.reference);
  const searchable=(value:string)=>' '+normalize(value)+' ';
  const rankedHeadings=[...outline].sort((a,b)=>b.title.length-a.title.length);
  for(const question of ranked){
    const own=normalize(question.topic);
    const match=outline.find(entry=>normalize(entry.title)===own)
      ??rankedHeadings.find(entry=>searchable(question.prompt).includes(searchable(entry.title)));
    const key=normalize(match?.title??root);
    if(!key)continue;
    const items=evidence.get(key)??[];
    items.push(question);evidence.set(key,items);
  }
  const titles:TopicOutline[]=[{title:root,group:''},...outline];
  const labels=new Map(titles.map(entry=>[normalize(entry.title),entry.title]));
  const used=new Set<string>();
  return titles.flatMap(({title,group,source,reference})=>{
    const id=normalize(title);
    if(!id||used.has(id))return [];
    used.add(id);
    const questions=evidence.get(id)??[];
    const words=id.split(' ').filter(word=>word.length>3);
    const relevant=passages.filter(source=>words.some(word=>normalize(source.excerpt).includes(word)));
    const sources=[...questions.flatMap(question=>question.answerSource?[question.answerSource]:[]),
      ...(id===normalize(root)&&!relevant.length?passages:relevant)];
    const page:BookPage={id:JSON.stringify([normalize(subject),id]),title,group:labels.get(normalize(group))??'',questions,priorities:id===normalize(root)?ranked.slice(0,4):undefined,scope:source,reference,
      passages:[...new Map(sources.map(source=>[source.excerpt,source])).values()].slice(0,8)};
    return [page];
  }).slice(0,structured?80:16);
}

export function studySessionPrompt(prompt:string) {
  return prompt.replace(/\b(?:i (?:only )?have|only have|i can study for|replan for)\s+(?:(?:only|just)\s+)?(?:\d+(?:\.\d+)?|[a-z]+(?:[- ][a-z]+)?)\s*(?:minutes?|mins?|hours?|hrs?|days?)\b(?:\s+to (?:study|prepare))?[,.!?;]*/gi,
    clause=>duration(clause)>0?'':clause).replace(/\s+/g,' ').trim();
}
