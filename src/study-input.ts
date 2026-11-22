import type { Material } from './api';
import type { ExtractedDocument } from './document-state';
import { isTrusted } from './document-state';
import { questionRejection, readMarks, readQuestionCue } from '../server/page-text.mjs';
import { administrativeLine, administrativeSection, syllabusContentsHeading, syllabusEnd, syllabusTopicLabel, syllabusUnit } from '../server/study-material.mjs';
import { studySubject } from '../server/coach-topics.mjs';

function academicLines(lines:string[]) {
  let inOutcomes=false;
  return lines.flatMap(line=>{
    if(syllabusUnit(line)||syllabusContentsHeading(line))inOutcomes=false;
    if(administrativeSection(line))inOutcomes=true;
    return !line||inOutcomes||administrativeLine(line)?[]:[line];
  });
}

export function inspectStudyInput(documents:readonly ExtractedDocument[],files:readonly Material[]) {
  const subjects=new Map<string,number>();
  const titles=new Set<string>();
  const classified=files.map(file=>{
    const document=documents.find(item=>item.id===file.id);
    if(!document)return file;
    const pages=document.pages.filter(isTrusted);
    const lines=pages.flatMap(page=>page.text.split(/\r?\n/).map(line=>line.trim()));
    const academic=academicLines(lines);
    const content=academic.join(' ').slice(0,18000);
    const header=lines.slice(0,18).filter(line=>!administrativeLine(line)).join(' ');
    const subject=studySubject(header)||studySubject(content);
    if(subject)subjects.set(subject,(subjects.get(subject)??0)+1);
    const questionCount=academic.filter(line=>{const cue=readQuestionCue(line,true);return cue&&!questionRejection(readMarks(cue.text).text);}).length;
    const unitCount=academic.filter(line=>syllabusUnit(line)).length;
    const examHeader=/\b(?:end[ -]?sem(?:ester)?|mid[ -]?sem(?:ester)?|question paper|examination)\b/i.test(header);
    const syllabusHeader=lines.some(syllabusContentsHeading)||/\b(?:syllabus|course outline|course contents?)\b/i.test(header);
    const explained=academic.filter(line=>line.length>=30&&/\b(?:is|are|occurs|uses|allows|works|means|prevents|requires|evicts)\b/i.test(line)&&!readQuestionCue(line)).length;
    const kind=!lines.some(Boolean)?'Unreadable':!academic.length?'Administrative':
      (unitCount>=2||syllabusHeader&&(unitCount>0||academic.length>=5))&&(!examHeader||questionCount<3)?'Syllabus':
      (examHeader&&questionCount>0||file.kind==='Past paper'&&questionCount>=2||questionCount>=3&&explained===0)?'Past paper':
      explained>0?'Notes':file.kind;
    const classifiedKind=file.kindOverride?file.kind:kind;
    if(classifiedKind==='Syllabus'){
      let inUnit=false;
      for(const line of academic){
        const header=syllabusUnit(line);
        if(syllabusEnd(line))break;
        if(syllabusContentsHeading(line)){inUnit=true;continue;}
        if(header)inUnit=true;
        const title=syllabusTopicLabel(header?header[2]:inUnit?line:'',Boolean(header||/^[-•]\s/.test(line)));
        if(title&&!readQuestionCue(title))titles.add(title);
        if(titles.size>=16)break;
      }
    }
    return {...file,kind:classifiedKind};
  });
  const ranked=[...subjects].sort((a,b)=>b[1]-a[1]);
  const subject=ranked[0]&&ranked[0][1]>(ranked[1]?.[1]??0)?ranked[0][0].replace(/^./,c=>c.toUpperCase()):'';
  return {files:classified,subject,topics:[...titles].slice(0,16)};
}
