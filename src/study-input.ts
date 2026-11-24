import { browserTiming, now } from '../server/performance.mjs';
import type { TopicOutline } from './study-book';
import type { Material } from './api';
import type { ExtractedDocument } from './document-state';
import { isTrusted } from './document-state';
import { questionRejection, readMarks, readQuestionCue } from '../server/page-text.mjs';
import { administrativeLine, administrativeSection, parseSyllabus, syllabusContentsHeading, syllabusSubject, syllabusUnit, topicKey } from '../server/study-material.mjs';
import { studySubject } from '../server/coach-topics.mjs';

function academicLines(lines:string[]) {
  let inOutcomes=false;
  return lines.flatMap(line=>{
    if(syllabusUnit(line)||syllabusContentsHeading(line))inOutcomes=false;
    if(administrativeSection(line))inOutcomes=true;
    return !line||inOutcomes||administrativeLine(line)?[]:[line];
  });
}

const parsed=new WeakMap<ExtractedDocument['pages'][number],{pages:readonly ExtractedDocument['pages'][number][];subject:string;headings:ReturnType<typeof parseSyllabus>}>();
function headingsFor(pages:ExtractedDocument['pages'],subject:string){
  if(!pages.length)return [];
  const saved=parsed.get(pages[0]);
  if(saved?.subject===subject&&saved.pages.length===pages.length&&pages.every((page,index)=>saved.pages[index]===page))return saved.headings;
  const headings=parseSyllabus(pages,subject);
  parsed.set(pages[0],{pages,subject,headings});
  return headings;
}

export function inspectStudyInput(documents:readonly ExtractedDocument[],files:readonly Material[]) {
  const started=now();
  const subjects=new Map<string,number>();
  const outline=new Map<string,TopicOutline>();
  const classified=files.map(file=>{
    const document=documents.find(item=>item.id===file.id);
    if(!document)return file;
    const pages=document.pages.filter(isTrusted);
    if(!pages.length&&(document.total===null&&!document.error||document.pages.some(page=>page.status==='pending')))return file;
    const lines=pages.flatMap(page=>page.text.split(/\r?\n/).map(line=>line.trim()));
    const academic=academicLines(lines);
    const content=academic.join(' ').slice(0,18000);
    const header=lines.slice(0,18).filter(line=>!administrativeLine(line)).join(' ');
    const declared=syllabusSubject(pages);
    const subject=studySubject(header)||studySubject(declared)||declared||studySubject(content);
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
    if(subject)subjects.set(subject,(subjects.get(subject)??0)+(declared||classifiedKind==='Syllabus'?2:1));
    if(classifiedKind==='Syllabus'&&!examHeader){
      for(const heading of headingsFor(pages,subject)){
        const key=topicKey(heading.title);
        if(!outline.has(key))outline.set(key,{title:heading.title,group:heading.group,subject:heading.subject,unit:heading.unit,level:heading.level,validation:heading.validation,
          source:{file:document.name,page:heading.page,number:'Line '+heading.line,excerpt:heading.excerpt,
            documentIndex:file.id,documentType:'Syllabus',method:heading.method}});
      }
    }
    return {...file,kind:classifiedKind};
  });
  const ranked=[...subjects].sort((a,b)=>b[1]-a[1]);
  const subject=ranked[0]&&ranked[0][1]>(ranked[1]?.[1]??0)?ranked[0][0].replace(/^./,c=>c.toUpperCase()):'';
  browserTiming('study:topic-classification',started);
  return {files:classified,subject,outline:[...outline.values()]};
}
