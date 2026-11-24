import {topicKey} from '../server/study-material.mjs';
import type {WebEvidence} from './practice';
import type { Analysis, Question, Source } from './api';
import { duration } from './api';
import { publicStudyConcepts, studySubject } from '../server/coach-topics.mjs';

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
  unassignedQuestions?:readonly Question[];
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
  const rootKey=normalize(root);
  const subjectKey=normalize(subject);
  const unassignedQuestions:Question[]=[];
  const headings=[...(focus?[{title:focus,group:''}]:[]),...outline].flatMap(entry=>{
    const id=normalize(entry.title);
    if(!id||id===subjectKey)return [];
    const concepts=publicStudyConcepts(entry.title+' '+id+' '+id+'s');
    const terms=id.split(' ').filter(term=>term.length>2&&!['the','and','for','with','introduction','overview','basic','concepts'].includes(term));
    return [{id,terms,concepts,group:normalize(entry.group)}];
  });
  for(const question of ranked){
    const own=normalize(question.topic);
    const prompt=' '+normalize(question.prompt)+' ';
    const concepts=new Set(publicStudyConcepts(question.prompt));
    const syllabusIds=new Set(question.topicIds?.filter(id=>id.startsWith('syllabus:')).map(id=>normalize(id.slice(9))));
    const matches=headings.map(heading=>{
      const shared=heading.concepts.filter(concept=>concepts.has(concept)).length;
      const exact=prompt.includes(' '+heading.id+' ');
      const wording=heading.terms.length>=2&&heading.terms.every(term=>prompt.includes(' '+term+' ')||prompt.includes(' '+term+'s '));
      const neo=syllabusIds.has(heading.id);
      const score=(exact?90:0)+(shared?65+Math.min(shared,3)*8:0)+(wording?25:0)+(neo?45:0)+(own===heading.id?25:0);
      return {heading,score,shared,exact};
    }).filter(match=>match.score>=65).sort((a,b)=>b.score-a.score);
    const best=matches[0];
    if(!best){
      // An overview can host general questions about the subject, but never the unmatched remainder.
      const overview=headings.find(heading=>/^(?:introduction|overview)\b/.test(heading.id));
      if(!concepts.size&&own===subjectKey&&prompt.includes(' '+subjectKey+' ')){
        const key=overview?.id??rootKey;
        evidence.set(key,[...(evidence.get(key)??[]),question]);
      }else if(question.historical)unassignedQuestions.push(question);
      continue;
    }
    const keys=new Set([best.heading.id]);
    for(const match of matches.slice(1)){
      const parent=match.heading.id===best.heading.group;
      const distinctConcept=match.heading.concepts.some(concept=>concepts.has(concept)&&!best.heading.concepts.includes(concept));
      if((parent&&match.shared>0)||(match.exact&&distinctConcept))keys.add(match.heading.id);
      if(keys.size>=2)break;
    }
    for(const key of keys)evidence.set(key,[...(evidence.get(key)??[]),question]);
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
    const page:BookPage={id:JSON.stringify([normalize(subject),id]),title,group:labels.get(normalize(group))??'',priority,provisionalPriority,questions,priorities:id===rootKey?questions.slice(0,4):undefined,unassignedQuestions:id===rootKey?unassignedQuestions:undefined,scope:source,reference,
      passages:[...new Map(sources.map(source=>[source.excerpt,source])).values()].slice(0,8)};
    return [page];
  });
}

export function studySessionPrompt(prompt:string) {
  return prompt.replace(/\b(?:i (?:only )?have|only have|i can study for|replan for)\s+(?:(?:only|just)\s+)?(?:\d+(?:\.\d+)?|[a-z]+(?:[- ][a-z]+)?)\s*(?:minutes?|mins?|hours?|hrs?|days?)\b(?:\s+to (?:study|prepare))?[,.!?;]*/gi,
    clause=>duration(clause)>0?'':clause).replace(/\s+/g,' ').trim();
}
