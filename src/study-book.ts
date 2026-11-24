import {topicKey} from '../server/study-material.mjs';
import type {WebEvidence} from './practice';
import type { Analysis, Question, Source } from './api';
import { duration } from './api';
import { studySubject } from '../server/coach-topics.mjs';

export type TopicOutline={title:string;group:string;source?:Source;reference?:WebEvidence;
  subject?:string;unit?:number;level?:'unit'|'major'|'subtopic';validation?:'document-structure'|'structured-ocr'|'published-curriculum'|'inferred'};

export type BookPage = {
  id: string;
  title: string;
  group: string;
  priority:'high'|'medium'|'lower';
  provisionalPriority:boolean;
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
  const rankedSyllabus=new Set(analysis.optimization?.candidates.filter(question=>question.scoreComponents.syllabus===1&&!question.practiceSeed).map(question=>question.id));
  const prerequisites=new Set(ranked.flatMap(question=>question.learning?.prerequisites??[]).map(normalize));
  const provisionalPriority=!ranked.some(question=>question.historical);
  const hasRecurrence=ranked.some(question=>question.historical&&(question.historicalFrequency??0)>1);
  const parents=new Set(outline.map(entry=>normalize(entry.group)).filter(Boolean));
  const headingsByTitle=new Map(outline.map(entry=>[normalize(entry.title),entry]));
  const searchable=(value:string)=>' '+normalize(value)+' ';
  const rankedHeadings=[...outline].sort((a,b)=>b.title.length-a.title.length);
  for(const question of ranked){
    const own=normalize(question.topic);
    const prompt=searchable(question.prompt);
    const match=headingsByTitle.get(own)??rankedHeadings.find(entry=>prompt.includes(searchable(entry.title)));
    const key=normalize(match?.title??root);
    if(!key)continue;
    const items=evidence.get(key)??[];
    items.push(question);evidence.set(key,items);
  }
  const titles:TopicOutline[]=[{title:root,group:''},...outline];
  const labels=new Map(titles.map(entry=>[normalize(entry.title),entry.title]));
  const used=new Set<string>();
  return titles.flatMap(({title,group,source,reference,level})=>{
    const id=normalize(title);
    if(!id||used.has(id))return [];
    used.add(id);
    const questions=evidence.get(id)??[];
    const frequency=Math.max(0,...questions.filter(question=>question.historical).map(question=>question.historicalFrequency??0));
    const historical=questions.some(question=>question.historical);
    const foundation=prerequisites.has(id)||level==='unit'||(parents.has(id)&&!group);
    const syllabusEmphasis=level==='major'||questions.some(question=>rankedSyllabus.has(question.id));
    const priority=frequency>(hasRecurrence?1:0)||(!hasRecurrence&&historical)||(provisionalPriority&&foundation)
      ?'high':historical||foundation||syllabusEmphasis||questions.some(question=>question.answerSource)?'medium':'lower';
    const words=id.split(' ').filter(word=>word.length>3);
    const relevant=passages.filter(source=>words.some(word=>normalize(source.excerpt).includes(word)));
    const sources=[...questions.flatMap(question=>question.answerSource?[question.answerSource]:[]),
      ...(id===normalize(root)&&!relevant.length?passages:relevant)];
    const page:BookPage={id:JSON.stringify([normalize(subject),id]),title,group:labels.get(normalize(group))??'',priority,provisionalPriority,questions,priorities:id===normalize(root)?ranked.slice(0,4):undefined,scope:source,reference,
      passages:[...new Map(sources.map(source=>[source.excerpt,source])).values()].slice(0,8)};
    return [page];
  });
}

export function studySessionPrompt(prompt:string) {
  return prompt.replace(/\b(?:i (?:only )?have|only have|i can study for|replan for)\s+(?:(?:only|just)\s+)?(?:\d+(?:\.\d+)?|[a-z]+(?:[- ][a-z]+)?)\s*(?:minutes?|mins?|hours?|hrs?|days?)\b(?:\s+to (?:study|prepare))?[,.!?;]*/gi,
    clause=>duration(clause)>0?'':clause).replace(/\s+/g,' ').trim();
}
