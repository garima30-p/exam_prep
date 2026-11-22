import { aiErrors, aiStatus, coachEnabled, diagnoseGemma, generateStudyReply, webSearchStatus } from './study-ai.mjs';
import { administrativeLine, administrativeSection, syllabusContentsHeading, syllabusEnd, syllabusUnit } from './study-material.mjs';
import { describeLearning, makeLearningPlan } from './learning.mjs';
import { exactQuestionKey } from './semantic.mjs';
import { initialMinutes, scorePriority } from './evidence.mjs';
import { publicStudyConcepts } from './coach-topics.mjs';
import { formatPageText, ocrQuestionNeedsReview, readMarks, readQuestionCue } from './page-text.mjs';

const MAX_BODY = 4_000_000;
const compact = value => typeof value === 'string' ? value.replace(/\s+/g,' ').trim() : '';
const bounded = (value, size) => compact(value).slice(0,size);
const ignored = new Set('a an and are as at be by for from in is it of on or the to with what how explain describe discuss define compare write short note about'.split(' '));
const tokens = value => [...new Set(value.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g)?.filter(word => !ignored.has(word)) ?? [])];
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const overlaps = (left,right) => left.filter(word=>right.includes(word)).length;
const solvedHeading = /^Q\s*\d{1,3}\s+\[P\d/i;
const boilerplate = /^(?:how to use|source policy|exam cue|learn\s*\/\s*verify|core formulas|priority map)\s*[.:|]/i;
function topicTitle(text) {
  const subject=text.replace(/^(?:explain|describe|define|compare|contrast|derive|draw|discuss|state|list|what (?:is|are))\s+/i,'')
    .split(/[.!?](?:\s|$)|\s+and\s+(?:explain|compare|describe|calculate|draw)\b|\s+with\s+(?:an?\s+)?(?:examples?|diagrams?)\b/i)[0]
    .replace(/^(?:a|an|the)\s+/i,'').replace(/[,;:]$/,'').trim();
  const title=subject.split(/\s+/).slice(0,8).join(' ')||text;
  return title[0].toUpperCase()+title.slice(1);
}

function materialLines(text, kind) {
  const lines=(kind==='Past paper'?formatPageText(text,kind):text).split(/\r?\n/);
  if(kind!=='Notes')return lines;
  for(let index=0;index<lines.length;index++){
    if(!solvedHeading.test(compact(lines[index])))continue;
    for(let next=index+1;next<=index+3&&next<lines.length&&!/[.?!]\s*$/.test(lines[index]);next++){
      const continuation=compact(lines[next]);
      if(!continuation)continue;
      if(solvedHeading.test(continuation)||boilerplate.test(continuation))break;
      lines[index]=compact(lines[index])+' '+continuation;
      lines[next]='';
    }
  }
  return lines;
}

function candidates(materials) {
  const questions = new Map();
  const prerequisites = new Map();
  for (const material of materials) {
    const structured=material.kind==='Notes'&&material.pages.some(page=>page.text.split(/\r?\n/).some(line=>solvedHeading.test(compact(line))));
    let unit = 0;
    let syllabusTable=false;
    let section = '';
    const year=Number(material.name.match(/\b(?:19|20)\d{2}\b|(?<=_)\d{4}(?=[_.])/g)?.find(value=>/^(19|20)/.test(value)))||Number(material.kind==='Past paper'&&material.pages[0]?.text.slice(0,1100).match(/\b(?:examination|exam)\b[^\n]{0,55}\b((?:19|20)\d{2})\b/i)?.[1])||0;
    for (const page of material.pages) {
      const lines = materialLines(page.text,material.kind);
      for (let n=0; n<lines.length; n++) {
        const line = compact(lines[n]);
        if(administrativeLine(line))continue;
        const sectionHeading=line.match(/^section\s+([a-z]|[ivx]+|\d+)\b/i);
        if(sectionHeading) {section=sectionHeading[1].toUpperCase();continue;}
        if(material.kind==='Syllabus'){
          if(syllabusContentsHeading(line)){syllabusTable=true;continue;}
          if(syllabusEnd(line)){syllabusTable=false;unit=0;continue;}
        }
        const heading = syllabusUnit(line);
        if (heading) {
          unit = Number(heading[1]) || ['i','ii','iii','iv','v','vi','vii','viii','ix','x'].indexOf(heading[1].toLowerCase())+1;
        }
        const prerequisiteLine=line.match(/^prerequisites?\s*[:–-]\s*(.{3,180})$/i);
        if (prerequisiteLine && material.kind==='Syllabus' && unit) {
          prerequisites.set(unit,[...new Set([...(prerequisites.get(unit)??[]),...prerequisiteLine[1].split(/[,;]/).map(item=>item.trim()).filter(Boolean)])].slice(0,4));
          continue;
        }
        const question = boilerplate.test(line)||(structured&&!solvedHeading.test(line))?null:readQuestionCue(line,material.kind==='Past paper');
        const isTopic = material.kind==='Syllabus' && (heading?.[2] || line.match(/^[-•]\s+(.+)/)?.[1]
          || (!heading && (unit||syllabusTable) && line.length>=12 && !/^(?:page\s|sl\.?\s*no\.?|contact hours|contents$)/i.test(line) ? line : ''));
        if (!question && !isTopic) continue;
        const base = question?.text ?? isTopic;
        const {text,marks}=readMarks(base);
        const scanned=page.method==='ocr';
        if(scanned&&ocrQuestionNeedsReview(text))continue;
        if (text.length<12 || text.length>480 || !tokens(text).length || /\b(?:and|or|of|the|for|using|with)\s*$/i.test(text)) continue;
        const key = exactQuestionKey(text);
        const source = {id:material.id+':'+page.number+':'+(n+1),file:material.name,page:page.number,number:!scanned&&question?.number||'Line '+(n+1),excerpt:line,documentIndex:material.documentIndex,method:page.method};
        let record = questions.get(key);
        if (!record) {
          if (questions.size>=500) continue;
          record={prompt:isTopic && !question?'Explain '+text.replace(/\.$/,'')+'.':text,topic:topicTitle(text),unit,units:new Set(),sections:new Set(),marks:0,marksByGroup:{},sources:[],papers:new Set(),years:new Set(),syllabus:false,historical:false};
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
        if (material.kind==='Past paper'&&question){
          if(!record.historical){record.historicalSource=source;record.historicalMarks=scanned?0:marks??0;record.prompt=text;record.topic=topicTitle(text);}
          record.historical=true;if(year)record.years.add(year);
        }
      }
    }
  }
  return {records:[...questions.values()],prerequisites};
}

export function buildPlan(materials) {
  materials=materials.map(material=>{
    if(material.kind!=='Syllabus')return material;
    let inOutcomes=false;
    return {...material,pages:material.pages.map(page=>({...page,text:page.text.split(/\r?\n/).map(line=>{
      if(syllabusUnit(line)||syllabusContentsHeading(line))inOutcomes=false;
      if(administrativeSection(line))inOutcomes=true;
      return inOutcomes||administrativeLine(line)?'':line;
    }).join('\n')}))};
  });
  const notes=[];
  let totalLines=0;
  for (const material of materials.filter(item=>item.kind!=='Past paper')) {
    for (const page of material.pages) {
      const lines=materialLines(page.text,material.kind);
      for (const [lineIndex,line] of lines.entries()) {
        if (++totalLines>5000) break;
        if(boilerplate.test(compact(line))||administrativeLine(line))continue;
        const cue=readQuestionCue(compact(line));
        if(cue && material.kind==='Notes') {
          const answer=[];
          const first=lineIndex+1;
          for(let next=first;next<Math.min(lines.length,first+24);next++){
            const text=compact(lines[next]);
            if(readQuestionCue(text)?.number||boilerplate.test(text)||/^(?:unit\s+\d|tcs502\s*[•|])/i.test(text))break;
            if(text)answer.push(text);
          }
          const excerpt=bounded(answer.join(' '),1800);
          if(excerpt.length>=55) notes.push({file:material.name,page:page.number,number:cue.number?cue.number+' answer':'Lines '+(first+1)+'–'+(first+answer.length),
            excerpt,words:tokens(cue.text),prompt:cue.text,documentIndex:material.documentIndex,method:page.method});
        }
        if(cue || /^\s*(?:unit\b|p[0-9]\s*\||learn\s*\/\s*verify|exam cue:|source policy|how to use)/i.test(line))continue;
        if(material.kind==='Syllabus'&&!/\b(?:is defined as|occurs when|means|works by|is a type of)\b/i.test(line))continue;
        const excerpt=compact(line);
        if (excerpt.length<45 || !/[.!]$/.test(excerpt) || excerpt.length>650 || /\b(?:exam is|minutes to study|marks to pass)\b/i.test(excerpt)) continue;
        notes.push({file:material.name,page:page.number,number:'Line '+(lineIndex+1),excerpt,words:tokens(excerpt),documentIndex:material.documentIndex,method:page.method});
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
    return {id,words:tokens(record.topic),concepts:publicStudyConcepts(record.prompt),unit:record.unit};
  });
  const maxMarks=Math.max(1,...records.map(record=>record.marks));
  const years=records.flatMap(record=>[...record.years]);
  const oldest=years.length?Math.min(...years):0;
  const latest=years.length?Math.max(...years):0;
  const prepared=records.map(record=>{
    const words=tokens(record.prompt);
    const concepts=publicStudyConcepts(record.prompt);
    const matching=knownTopics.filter(topic=>topic.concepts.some(concept=>concepts.includes(concept))||
      (topic.words.length>=2||record.syllabus)&&overlaps(words,topic.words)===topic.words.length);
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
    const note=notes.map(candidate=>{
      const shared=overlaps(candidate.words,questionWords);
      const exact=candidate.prompt&&exactQuestionKey(candidate.prompt)===exactQuestionKey(record.prompt);
      const eligible=shared>=Math.min(2,questionWords.length) &&
        shared/Math.max(1,questionWords.length)>=(candidate.prompt ? .65 : .45);
      return {candidate,score:exact?100:eligible?shared+(candidate.prompt?8:0):0};
    })
      .filter(match=>match.score>0)
      .sort((a,b)=>b.score-a.score)[0]?.candidate;
    const source=record.historicalSource??record.sources[0];
    const reason=record.papers.size
      ? 'Found in '+record.papers.size+' of '+paperCount+' uploaded past papers'
      : record.syllabus?'Identified in the supplied syllabus':'Identified in the supplied study material';
    const question={id:i+1,topic:record.topic,unit:record.unit||units[0]||0,prompt:record.prompt,minutes,priorityScore,scoreComponents,topicIds,
      units,sections:[...record.sections],marksByGroup:record.marksByGroup,paperIds:[...record.papers],historicalFrequency:record.papers.size,historicalPaperCount:paperCount,examYears:[...record.years].sort(),
      marks:record.historical?record.historicalMarks:record.marks,historical:record.historical,reason,source,sources:record.sources,answerSource:note?{file:note.file,page:note.page,number:note.number,excerpt:note.excerpt,documentIndex:note.documentIndex,method:note.method}:null,
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
      safePages.push({number:page.number,text:page.text,method:['pdf-text','office-text','ocr','manual'].includes(page.method)?page.method:undefined});
    }
    const declared=Number.isSafeInteger(item.totalPages)&&item.totalPages>0?item.totalPages:null;
    const complete=item.complete!==false&&safePages.length===item.pages.length&&
      (!declared||safePages.length===declared&&safePages.every(page=>page.number<=declared));
    materials.push({id:index,name,kind:item.kind,pages:safePages,complete,documentIndex:Number.isSafeInteger(item.documentIndex)?item.documentIndex:undefined});
  }
  return materials;
}

export async function handle(request,env) {
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const json=(data,status=200)=>Response.json(data,{status,headers});
  const path=new URL(request.url).pathname;
  if(path==='/api/coach/diagnostic')return diagnoseGemma(request,env);
  if(path==='/api/coach/status'&&request.method==='GET'){
    const code=aiStatus(env);
    const webSearch=webSearchStatus(env);
    return json(code==='ready'?{available:true,webSearch}:{available:false,code,message:aiErrors[code],webSearch});
  }
  if (path==='/api/health' && request.method==='GET') return json({status:'ok'});
  if (path!=='/api/analyze' && path!=='/api/coach') return json({error:'Endpoint not found.'},404);
  if (path==='/api/coach'&&!coachEnabled(env))return json({error:aiErrors[aiStatus(env)],code:aiStatus(env)},503);
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
      if(size>(path==='/api/coach'?18000:MAX_BODY)) {
        await reader.cancel();
        return json({error:path==='/api/coach'?'The coach request is too large.':'The extracted text exceeds 4 MB. Select fewer documents for this analysis.'},413);
      }
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
    const input=JSON.parse(raw);
    if(path==='/api/coach'){
      if(!input||typeof input!=='object')return json({error:'Invalid AI request.',code:'invalid_request'},400);
      try{return await generateStudyReply(input,env,request);}
      catch{return json({error:aiErrors.request_failed,code:'request_failed'},502);}
    }
    const materials=validate(input);
    if (!materials) return json({error:'Invalid material or page structure.'},400);
    const {questions,topics}=buildPlan(materials);
    const plan=makeLearningPlan(questions,topics,
      typeof input.minutes==='number'&&Number.isFinite(input.minutes)?input.minutes:0,
      typeof input.pattern==='string'?input.pattern.slice(0,600):'',input.familiarity);
    return json({questions,topics,plan,generatedCoach:coachEnabled(env)});
  } catch {
    return json({error:'Could not read the supplied material.'},400);
  } finally {
    reader.releaseLock();
  }
}

