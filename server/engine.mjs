import { describeLearning, makeLearningPlan } from './learning.mjs';
import { exactQuestionKey } from './semantic.mjs';
import { initialMinutes, scorePriority } from './evidence.mjs';
import { ocrQuestionNeedsReview, readMarks, readQuestionCue } from './page-text.mjs';

const MAX_BODY = 4_000_000;
const compact = value => typeof value === 'string' ? value.replace(/\s+/g,' ').trim() : '';
const bounded = (value, size) => compact(value).slice(0,size);
const ignored = new Set('a an and are as at be by for from in is it of on or the to with what how explain describe discuss define compare write short note about'.split(' '));
const tokens = value => [...new Set(value.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g)?.filter(word => !ignored.has(word)) ?? [])];
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const overlaps = (left,right) => left.filter(word=>right.includes(word)).length;

function candidates(materials) {
  const questions = new Map();
  const prerequisites = new Map();
  for (const material of materials) {
    let unit = 0;
    let section = '';
    const year=Number(material.name.match(/\b(?:19|20)\d{2}\b|(?<=_)\d{4}(?=[_.])/g)?.find(value=>/^(19|20)/.test(value)))||0;
    for (const page of material.pages) {
      const lines = page.text.split(/\r?\n/);
      for (let n=0; n<lines.length; n++) {
        const line = compact(lines[n]);
        const sectionHeading=line.match(/^section\s+([a-z]|[ivx]+|\d+)\b/i);
        if(sectionHeading) {section=sectionHeading[1].toUpperCase();continue;}
        const heading = line.match(/^unit\s+([1-9][0-9]?|i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*[-–:.]?\s*(.*)/i);
        if (heading) {
          unit = Number(heading[1]) || ['i','ii','iii','iv','v','vi','vii','viii','ix','x'].indexOf(heading[1].toLowerCase())+1;
        }
        const prerequisiteLine=line.match(/^prerequisites?\s*[:–-]\s*(.{3,180})$/i);
        if (prerequisiteLine && material.kind==='Syllabus' && unit) {
          prerequisites.set(unit,[...new Set([...(prerequisites.get(unit)??[]),...prerequisiteLine[1].split(/[,;]/).map(item=>item.trim()).filter(Boolean)])].slice(0,4));
          continue;
        }
        const question = readQuestionCue(line,material.kind==='Past paper');
        const isTopic = material.kind==='Syllabus' && (heading?.[2] || line.match(/^[-•]\s+(.+)/)?.[1]
          || (!heading && unit && line.length>=12 && !/^page\s/i.test(line) ? line : ''));
        if (!question && !isTopic) continue;
        const base = question?.text ?? isTopic;
        const {text,marks}=readMarks(base);
        const scanned=page.method==='ocr';
        if(scanned&&ocrQuestionNeedsReview(text))continue;
        if (text.length<12 || text.length>480 || !tokens(text).length) continue;
        const key = exactQuestionKey(text);
        const source = {id:material.id+':'+page.number+':'+(n+1),file:material.name,page:page.number,number:!scanned&&question?.number||'Line '+(n+1),excerpt:line,documentIndex:material.documentIndex,method:page.method};
        let record = questions.get(key);
        if (!record) {
          if (questions.size>=500) continue;
          record={prompt:isTopic && !question?'Explain '+text.replace(/\.$/,'')+'.':text,topic:tokens(text).slice(0,6).join(' '),unit,units:new Set(),sections:new Set(),marks:0,marksByGroup:{},sources:[],papers:new Set(),years:new Set(),syllabus:false};
          questions.set(key,record);
        }
        record.sources.push(source);
        if (!record.unit) record.unit=unit;
        if (unit) record.units.add(unit);
        if (section && material.kind==='Past paper') record.sections.add(section);
        if (!scanned&&marks!==null) {
          record.marks=Math.max(record.marks,marks);
          if(material.kind==='Past paper') {
            for(const key of [unit&&'unit:'+unit,section&&'section:'+section].filter(Boolean)) {
              record.marksByGroup[key]=Math.max(record.marksByGroup[key]??0,marks);
            }
          }
        }
        if (material.kind==='Past paper' && material.paperId!==undefined) {
          record.papers.add(material.paperId);
          if(year)record.years.add(year);
        }
        if (material.kind==='Syllabus') record.syllabus=true;
      }
    }
  }
  return {records:[...questions.values()],prerequisites};
}

export function buildPlan(materials) {
  const notes=[];
  let totalLines=0;
  for (const material of materials.filter(item=>item.kind==='Notes'||item.kind==='Unclassified')) {
    for (const page of material.pages) {
      for (const [lineIndex,line] of page.text.split(/\r?\n/).entries()) {
        if (++totalLines>5000) break;
        const excerpt=bounded(line,420);
        if (excerpt.length<45 || excerpt.endsWith('?')) continue;
        notes.push({file:material.name,page:page.number,number:'Line '+(lineIndex+1),excerpt,words:tokens(excerpt),documentIndex:material.documentIndex});
      }
      if(totalLines>5000) break;
    }
    if(totalLines>5000) break;
  }
  const uniquePapers=new Map();
  for(const material of materials.filter(item=>item.kind==='Past paper'&&item.complete!==false)) {
    const signature=JSON.stringify(material.pages.map(page=>compact(page.text)));
    if(!uniquePapers.has(signature))uniquePapers.set(signature,material.id);
    material.paperId=uniquePapers.get(signature);
  }
  const {records,prerequisites}=candidates(materials);
  const paperCount=uniquePapers.size;
  const topics=new Map();
  const knownTopics=records.filter(record=>record.syllabus).map(record=>{
    const id='syllabus:'+normalize(record.topic);
    topics.set(id,{id,title:record.topic,unit:record.unit||undefined,weight:1});
    return {id,words:tokens(record.topic),unit:record.unit};
  });
  const maxMarks=Math.max(1,...records.map(record=>record.marks));
  const years=records.flatMap(record=>[...record.years]);
  const oldest=years.length?Math.min(...years):0;
  const latest=years.length?Math.max(...years):0;
  const prepared=records.map(record=>{
    const words=tokens(record.prompt);
    const matching=knownTopics.filter(topic=>topic.words.length && overlaps(words,topic.words)===topic.words.length &&
      (topic.words.length>=2||record.syllabus));
    const inferred='question:'+words.slice().sort().join(' ');
    const topicIds=[...new Set(matching.length?matching.map(topic=>topic.id):[inferred])].slice(0,12);
    const units=[...new Set([...record.units,...matching.map(topic=>topic.unit).filter(Boolean)])];
    for(const id of topicIds) {
      const weight=1+(paperCount?record.papers.size/paperCount:0);
      const previous=topics.get(id);
      topics.set(id,previous?{...previous,weight:Math.max(weight,previous.weight)}:{id,title:record.topic,weight});
    }
    const minutes=initialMinutes(record.marks);
    const scoreComponents={
      recurrence:paperCount?record.papers.size/paperCount:null,
      marks:record.marks?record.marks/maxMarks:null,
      syllabus:knownTopics.length?Number(matching.length>0):null,
      breadth:matching.length?Math.min(new Set(matching.map(topic=>topic.id)).size,4)/4:null,
      preparationTime:(30-minutes)/15,
      recency:record.years.size&&latest>oldest?(Math.max(...record.years)-oldest)/(latest-oldest):null
    };
    return {record,minutes,priorityScore:scorePriority(scoreComponents),scoreComponents,topicIds,units};
  });
  const questions=prepared.sort((a,b)=>b.priorityScore-a.priorityScore).slice(0,100).map((item,i)=>{
    const {record,minutes,priorityScore,scoreComponents,topicIds,units}=item;
    const questionWords=tokens(record.prompt);
    const note=notes.map(candidate=>({candidate,score:overlaps(candidate.words,questionWords)}))
      .filter(match=>match.score>=Math.min(2,questionWords.length))
      .sort((a,b)=>b.score-a.score)[0]?.candidate;
    const source=record.sources[0];
    const reason=record.papers.size
      ? 'Found in '+record.papers.size+' of '+paperCount+' uploaded past papers'
      : record.syllabus?'Identified in the supplied syllabus':'Identified in the supplied study material';
    const question={id:i+1,topic:record.topic,unit:record.unit||units[0]||0,prompt:record.prompt,minutes,priorityScore,scoreComponents,topicIds,
      units,sections:[...record.sections],marksByGroup:record.marksByGroup,paperIds:[...record.papers],historicalFrequency:record.papers.size,historicalPaperCount:paperCount,examYears:[...record.years].sort(),
      marks:record.marks,reason,source,sources:record.sources,answerSource:note?{file:note.file,page:note.page,number:note.number,excerpt:note.excerpt,documentIndex:note.documentIndex}:null,
      answer:note?'Related notes excerpt · '+note.file+' · page '+note.page+'\n'+note.excerpt:'The supplied text identifies this question but provides no matching answer passage.'};
    const requiredConcepts=[...new Set(units.flatMap(unit=>prerequisites.get(unit)??[]))].slice(0,4);
    return {...question,learning:describeLearning({...question,prerequisites:requiredConcepts},[...topics.values()])};
  });
  return {questions,topics:[...topics.values()]};
}

function validate(body) {
  if (!body || !Array.isArray(body.materials) || body.materials.length>9) return null;
  const materials=[];
  for (const [index,item] of body.materials.entries()) {
    if (!item || !Array.isArray(item.pages) || !['Syllabus','Past paper','Notes','Unclassified'].includes(item.kind)) return null;
    const name=bounded(item.name,180);
    if (!name) return null;
    const safePages=[];
    const numbers=new Set();
    for (const page of item.pages) {
      if (!page || !Number.isSafeInteger(page.number) || page.number<1 || numbers.has(page.number) || typeof page.text!=='string' || page.text.length>150_000) return null;
      numbers.add(page.number);
      if(page.status==='review'||page.status==='failed'||page.status==='pending')continue;
      safePages.push({number:page.number,text:page.text,method:['pdf-text','ocr','manual'].includes(page.method)?page.method:undefined});
    }
    const declared=Number.isSafeInteger(item.totalPages)&&item.totalPages>0?item.totalPages:null;
    const complete=item.complete!==false&&safePages.length===item.pages.length&&
      (!declared||safePages.length===declared&&safePages.every(page=>page.number<=declared));
    materials.push({id:index,name,kind:item.kind,pages:safePages,complete,documentIndex:Number.isSafeInteger(item.documentIndex)?item.documentIndex:undefined});
  }
  return materials;
}

export async function handle(request) {
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const json=(data,status=200)=>Response.json(data,{status,headers});
  const path=new URL(request.url).pathname;
  if (path==='/api/health' && request.method==='GET') return json({status:'ok'});
  if (path!=='/api/analyze') return json({error:'Endpoint not found.'},404);
  if (request.method!=='POST') return json({error:'Use POST.'},405);
  if (request.headers.get('origin') && request.headers.get('origin')!==new URL(request.url).origin) return json({error:'Origin denied.'},403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({error:'JSON required.'},415);
  const reader=request.body?.getReader();
  if (!reader) return json({error:'Request body required.'},400);
  let size=0; let raw='';
  const decoder=new TextDecoder();
  try {
    while (true) {
      const {value,done}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if(size>MAX_BODY) {await reader.cancel();return json({error:'The extracted text exceeds 4 MB. Select fewer documents for this analysis.'},413);}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
    const input=JSON.parse(raw);
    const materials=validate(input);
    if (!materials) return json({error:'Invalid material or page structure.'},400);
    const {questions,topics}=buildPlan(materials);
    const plan=makeLearningPlan(questions,topics,
      typeof input.minutes==='number'&&Number.isFinite(input.minutes)?input.minutes:0,
      typeof input.pattern==='string'?input.pattern.slice(0,600):'',input.familiarity);
    return json({questions,topics,plan});
  } catch {
    return json({error:'Could not read the supplied material.'},400);
  } finally {
    reader.releaseLock();
  }
}

