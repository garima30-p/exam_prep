import type { Material, Question, Source } from './api';
import { isTrusted } from './document-state';
import type { ExtractedDocument } from './document-state';
import { readQuestionCue } from '../server/page-text.mjs';
import { administrativeLine } from '../server/study-material.mjs';

export type Revision = { title:string; passages:Source[]; recall:string; answer:string };

export function revise(prompt:string, documents:readonly ExtractedDocument[], files:readonly Material[], subject:string):Revision|null {
  const pasted=prompt.replace(/^[\s\S]*?\b(?:summari[sz]e (?:my |these |the )?notes|(?:my )?notes)\s*:\s*/i,'')
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(line=>!/^\s*(?:my .{0,70}\b(?:exam|test)\b|(?:i (?:have|can study)|only)\s+(?:have\s+|only\s+)?(?:\d|one|two|three|four|five|ten|twenty|thirty)|(?:please )?(?:summari[sz]e|make|build|create|generate|use (?:my |the )?(?:attached|uploaded)\b)\b)/i.test(line))
    .filter(line=>!/\b(?:exam|test|paper) (?:preparation|revision|hai)\b|\bpreparation for\b/i.test(line)||/\b(?:is defined as|occurs when|means|works by)\b/i.test(line))
    .join('\n');
  const sources:Source[]=[{file:'Pasted text',page:1,number:'Notes',excerpt:pasted}];
  for(const doc of documents){
    const kind=files.find(file=>file.id===doc.id)?.kind;
    if(kind==='Administrative'||kind==='Unreadable')continue;
    for(const page of doc.pages.filter(isTrusted)){
      const text=kind==='Past paper'?page.text.split(/\n/).filter(line=>/^\s*(?:answer|solution|explanation)\s*:/i.test(line)).join('\n')
        :kind==='Syllabus'?page.text.split(/\n/).filter(line=>/\b(?:is defined as|occurs when|means|works by|is a type of)\b/i.test(line)).join('\n'):page.text;
      sources.push({file:doc.name,page:page.number,number:'Extracted passage',excerpt:text,documentIndex:doc.id,
        method:page.method==='none'?undefined:page.method});
    }
  }
  const passages:Source[]=[];
  const seen=new Set<string>();
  for(const source of sources){
    for(const line of source.excerpt.split(/\n+/)){
      const text=line.trim().replace(/^(?:answer|solution|explanation)\s*:\s*/i,'');
      if(!text||administrativeLine(text)||readQuestionCue(text)||text.endsWith('?'))continue;
      if(source.file!=='Pasted text'&&!/[.!;=→]|\b(?:is|are|means|uses|allows|occurs|requires|contains|provides|prevents)\b/i.test(text))continue;
      for(const sentence of text.split(/(?<=[.!?])\s+/)){
        const key=sentence.toLowerCase().replace(/\W+/g,' ');
        if(sentence.length<12||administrativeLine(sentence)||!/[\p{L}]{2,}\s+[\p{L}]{2,}|[=→]/u.test(sentence)||seen.has(key))continue;
        seen.add(key);
        passages.push({...source,excerpt:sentence.slice(0,450)});
        if(passages.length===6)break;
      }
      if(passages.length===6)break;
    }
    if(passages.length===6)break;
  }
  if(!passages.length)return null;
  const pair=passages.slice(0,2).map(({excerpt})=>excerpt.match(/^([A-Z][A-Z0-9-]+)\s+(\w+)\s+/));
  if(pair[0]&&pair[1]&&pair[0][1]!==pair[1][1]&&pair[0][2]===pair[1][2]){
    const [a,b]=pair.map(match=>match![1]);
    return {title:a+' vs. '+b,passages,recall:'How does '+a+' differ from '+b+'?',answer:passages.slice(0,2).map(source=>source.excerpt).join(' ')};
  }
  const first=passages[0].excerpt;
  const clause=first.match(/^(.{3,65}?)\s+(is|are|uses|allows|means|occurs|gives|evicts|requires|updates)\s+(.+)/i);
  return {title:clause?.[1]??(subject||'Key points'),passages,
    recall:clause?clause[1]+' '+clause[2]+' … What completes this statement?':'What is the key point in the opening passage?',
    answer:first};
}

export function revisionFromAnswer(question:Question|undefined):Revision|null {
  if(!question?.answerSource)return null;
  return {title:question.topic,passages:[question.answerSource],recall:question.prompt,answer:question.answerSource.excerpt};
}
