import type { Analysis, Question, RankedQuestion, Source } from './api';
import { makePlan } from '../server/optimizer.mjs';

export type BookPage = {
  id: string;
  title: string;
  questions: readonly Question[];
  passages: Source[];
};

export function studyTopic(prompt: string) {
  return prompt.trim().match(/^(?:could you |can you |please )?(?:help me (?:study|revise)|teach me(?: about)?|explain|study|revise|learn(?: about)?)\s+([^.!?\n]{3,90})[.?!]?$/i)?.[1]?.trim() ?? '';
}

export function bookOutline(analysis: Analysis, fallbackTopics: readonly string[], passages: readonly Source[]): BookPage[] {
  const candidates=analysis.optimization?.candidates??analysis.questions;
  const topics=analysis.optimization?.topics??[];
  const syllabus=new Map(topics.filter(topic=>topic.id.startsWith('syllabus:')).map(topic=>[topic.id,topic]));
  const groups=new Map<string,{page:BookPage; ids:string[]; score:number}>();
  const normalize=(title:string)=>title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

  for(const question of candidates){
    const ranked='topicIds' in question?question as RankedQuestion:null;
    const linked=ranked?.topicIds.filter(id=>syllabus.has(id))??[];
    const direct=normalize(question.topic);
    const existing=[...groups.values()].find(group=>normalize(group.page.title)===direct||
      linked.some(id=>group.ids.includes(id)));
    const score=ranked?.priorityScore??1;
    if(existing){
      if(existing.page.questions.length<3)existing.page.questions=[...existing.page.questions,question];
      existing.ids=[...new Set([...existing.ids,...linked])];
      existing.score=Math.max(existing.score,score);
      continue;
    }
    if(!direct)continue;
    groups.set(direct,{page:{id:direct,title:question.topic,questions:[question],passages:[]},ids:linked,score});
  }

  if(!groups.size){
    for(const title of fallbackTopics){
      const id=normalize(title);
      if(id&&!groups.has(id))groups.set(id,{page:{id,title,questions:[],passages:[]},ids:[],score:1});
    }
  }

  const ranked=[...groups.values()].sort((a,b)=>b.score-a.score).slice(0,16);
  // Use NEO's coverage selection for the opening units. One unit costs one slot,
  // so this orders the outline without imposing a time limit on the student.
  const opening=makePlan(ranked.map((group,index)=>({id:index+1,minutes:1,priorityScore:group.score,topicIds:group.ids})),
    topics,Math.min(4,ranked.length+1));
  const first=new Set(opening.selectedQuestionIds);
  const ordered=[...opening.selectedQuestionIds.map(id=>ranked[id-1]),...ranked.filter((_,index)=>!first.has(index+1))];
  return ordered.map(({page})=>{
    const words=new Set(normalize(page.title).split(' ').filter(word=>word.length>=3));
    const relevant=ordered.length===1?passages:passages.filter(source=>normalize(source.excerpt).split(' ').some(word=>words.has(word)));
    const sources=[...page.questions.flatMap(question=>question.answerSource?[question.answerSource]:[]),...relevant];
    return {...page,passages:[...new Map(sources.map(source=>[source.excerpt,source])).values()].slice(0,8)};
  });
}
