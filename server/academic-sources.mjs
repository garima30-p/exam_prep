import {parseSyllabus,topicKey,validatedTopicTitle} from './study-material.mjs';
import {studySubject,publicStudyConcepts} from './coach-topics.mjs';
import {readQuestionCue,questionRejection} from './page-text.mjs';

const institutions=[
 ['IIT Kanpur','iitk.ac.in',/\b(?:iit\s*kanpur|indian institute of technology kanpur)\b/i],
 ['Graphic Era Hill University','gehu.ac.in',/\b(?:graphic era hill university|gehu)\b/i],
 ['Graphic Era University','geu.ac.in',/\b(?:graphic era (?:deemed to be )?university|geu)\b/i],
 ['University of Delhi','du.ac.in',/\b(?:university of delhi|delhi university)\b/i],
 ['IIT Bombay','iitb.ac.in',/\b(?:iit\s*bombay|indian institute of technology bombay)\b/i],
 ['IIT Delhi','iitd.ac.in',/\b(?:iit\s*delhi|indian institute of technology delhi)\b/i],
 ['Anna University','annauniv.edu',/\banna university\b/i],
 ['MIT','mit.edu',/\b(?:massachusetts institute of technology|mit)\b/i],
 ['Stanford University','stanford.edu',/\bstanford(?: university)?\b/i],
 ['University of Cambridge','cam.ac.uk',/\b(?:university of cambridge|cambridge university)\b/i]
];
const matchesHost=(host,domain)=>host===domain||host.endsWith('.'+domain);
const academicHost=host=>/\.(?:edu|edu\.in|ac\.[a-z]{2}|edu\.[a-z]{2})$/i.test(host)||['nptel.ac.in','aicte-india.org'].some(domain=>matchesHost(host,domain));
const officialCourse = 'https://cse.iitk.ac.in/pages/CS330.html';
const title = 'CS 330: Operating Systems';
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const normalize=text=>text.toLowerCase().replace(/[^a-z0-9]/g,'');

export function academicScope(text){
 const request=clean(text,500);
 const institution=institutions.find(([,domain,pattern])=>pattern.test(request)||request.toLowerCase().split(/[^a-z0-9.-]+/).some(word=>matchesHost(word,domain)));
 const declared=request.match(/\b(?:[a-z0-9-]+\.)+(?:ac\.[a-z]{2}|edu(?:\.[a-z]{2})?)\b/i)?.[0]?.toLowerCase();
 const name=institution?.[0]??(declared&&academicHost(declared)?declared:undefined);
 const domain=institution?.[1]??(name?declared:undefined);
 const named=Boolean(name||/\b(?:university|institute of technology|college)\b/i.test(request));
 const explicitCode=request.match(/\b(?:course|subject)\s+code\s*[:#-]?\s*([a-z]{2,6}[- ]?\d{3,4}[a-z]?)\b/i)?.[1];
 const catalogCode=request.match(/\b(?!(?:ID|ROLL|ROOM|REG|PIN|PHONE)[ -]?\d)[A-Z]{2,6}-?\d{3,4}[A-Z]?\b/)?.[0];
 const code=(explicitCode??catalogCode)?.toUpperCase().replace(/[- ]/g,'');
 const year=request.match(/\b(?:19[9]\d|20[0-3]\d)\b/)?.[0];
 const exam=request.match(/\b(end[- ]?sem(?:ester)?|mid[- ]?(?:term|sem(?:ester)?))\b/i)?.[0]?.toLowerCase();
 return {name,domain,named,verifiedInstitution:Boolean(institution),code,year,exam};
}

export function academicQuery(scope,subject,topic,course=false){
 const canonical=studySubject(subject);
 const focus=publicStudyConcepts(topic)[0];
 if(!canonical||!scope.domain)return '';
 const courseCode=scope.code||(scope.domain==='iitk.ac.in'&&canonical==='operating systems'?'CS330':'');
 return [scope.name,canonical,courseCode,course?scope.year:focus,course?scope.exam:'',course?'syllabus examination question paper':'course notes'].filter(Boolean).join(' ');
}

const terms=text=>new Set(String(text??'').toLowerCase().match(/[a-z]{3,}/g)??[]);
const academicTerms=new Set(['study','guide','course','notes','official','examination','question','paper','university','syllabus','introduction','topic','example','prepare','teach']);
export function academicResult(result,policy){
 try{
  const url=new URL(result.url);
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  if(policy.scope?.domain&&!matchesHost(url.hostname,policy.scope.domain))return null;
  if(/(?:gate|entrance|admission|aptitude|model[-_ /]+paper|sample[-_ /]+paper|mock[-_ /]+paper)/i.test(url.pathname+' '+result.title))return null;
  const isAcademic=academicHost(url.hostname);
  if(!isAcademic&&!['openstax.org','khanacademy.org','acm.org','ieee.org','who.int','nih.gov','ams.org'].some(domain=>matchesHost(url.hostname,domain)))return null;
  const publisher=institutions.find(([,domain])=>matchesHost(url.hostname,domain))?.[0]??(matchesHost(url.hostname,'nptel.ac.in')?'NPTEL':url.hostname);
  const title=clean(result.title,160)||url.hostname;
  const snippet=clean(result.content,650);
  const raw=clean(result.raw_content,18000);
  const corpus=title+' '+snippet+' '+raw.slice(0,8000);
  const subject=studySubject(policy.subject)||policy.subject;
  const subjectTerms=[...terms(subject)].filter(word=>!academicTerms.has(word));
  const topicTerms=[...terms(policy.topic)].filter(word=>!academicTerms.has(word));
  const matches=(words,text)=>words.some(word=>terms(text).has(word)||terms(text).has(word+'s'));
  const codeMatches=Boolean(policy.scope?.code&&normalize(corpus).includes(normalize(policy.scope.code)));
  const subjectMatches=studySubject(corpus)===subject||subjectTerms.every(word=>matches([word],corpus));
  if((subjectTerms.length&&!subjectMatches&&!codeMatches)||(topicTerms.length&&!matches(topicTerms,snippet+' '+title)))return null;
  if(!snippet||!url.pathname.replace(/\//g,''))return null;
  const verifiedInstitution=policy.scope?.verifiedInstitution&&matchesHost(url.hostname,policy.scope.domain);
  const publishesPaper=/(?:examination|end[- ]?sem|mid[- ]?sem|midterm|semester exam|question paper)/i.test(title+' '+snippet)
    &&!/(?:entrance|gate|mock|sample paper|model paper|practice questions)/i.test(title+' '+snippet);
  const questions=verifiedInstitution&&publishesPaper&&raw&&(!policy.scope.code||codeMatches)
    &&(!policy.scope.year||corpus.includes(policy.scope.year))&&(!policy.scope.exam||normalize(corpus).includes(normalize(policy.scope.exam)))?
      raw.split(/\r?\n/).flatMap(line=>{
        const cue=readQuestionCue(line.trim(),true);
        return cue?.text&&!questionRejection(cue.text)?[cue.text]:[];
      }).slice(0,12):[];
  if(publishesPaper&&!questions.length)return null;
  const syllabus=/syllabus|course contents|curriculum|course outline/i.test(title+' '+snippet+' '+raw.slice(0,1800));
  const category=questions.length?'official-pyq':verifiedInstitution&&syllabus&&(!policy.scope.code||codeMatches)?'official-syllabus':'academic-reference';
  const scopeOutline=syllabus&&category!=='official-pyq'
   ?parseSyllabus([{number:1,text:'Course Contents\n'+(raw||snippet)}],subject).map(({title,group,excerpt})=>({title,group,excerpt}))
   :[];
  return {kind:'web',url:url.href,title,publisher,category,excerpt:snippet,status:raw?'provider-page-text':'provider-excerpt',scopeOutline,
   scopeTopics:scopeOutline.map(topic=>topic.title),questions};
 }catch{return null;}
}

const decode=text=>text.replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160);/gi,' ').replace(/&amp;/gi,'&')
 .replace(/&(?:quot|#34);/gi,'"').replace(/&(?:apos|#39);/gi,"'").replace(/\s+/g,' ').trim();
let verifiedCourse=null;
let pendingCourse=null;
export async function publishedCourse(scope,subject,topic=''){
 if(studySubject(subject)!=='operating systems'||scope.domain&&scope.domain!=='iitk.ac.in'||scope.code&&!['CS330','CS330A'].includes(scope.code))return [];
 if(!verifiedCourse||verifiedCourse.until<Date.now()){
  pendingCourse??=(async()=>{
   try{
    const response=await fetch(officialCourse,{redirect:'error',signal:AbortSignal.timeout(3700)});
    if(!response.ok||!response.headers.get('content-type')?.includes('html'))return;
    const reader=response.body?.getReader();
    if(!reader)return;
    const decoder=new TextDecoder();
    let html='',bytes=0;
    try{
     while(bytes<220000){
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value.length;
      html+=decoder.decode(part.value,{stream:true});
     }
    }finally{await reader.cancel().catch(()=>{});}
    const section=html.match(/Course Contents\s*:\s*<\/h[1-6]>[\s\S]*?<ol[^>]*>([\s\S]*?)<\/ol>/i)?.[1];
    const entries=section?[...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(match=>decode(match[1])).filter(Boolean):[];
    if(entries.length)verifiedCourse={entries,until:Date.now()+3600000};
   }catch{/* Provider search or an unverified explanation remains available. */}
   finally{pendingCourse=null;}
  })();
  await pendingCourse;
 }
 if(!verifiedCourse)return [];
 const concept=publicStudyConcepts(topic)[0];
 const entry=concept?verifiedCourse.entries.find(value=>value.toLowerCase().includes(concept)):verifiedCourse.entries.find(value=>/introduction/i.test(value));
 if(concept&&!entry)return [];
 const excerpt=(entry??verifiedCourse.entries[0]).slice(0,650);
 const scopeOutline=[];
 for(const paragraph of verifiedCourse.entries){
  const heading=validatedTopicTitle(paragraph.split(':')[0],{anchored:true,subject});
  const group=heading&&!/^introduction$/i.test(heading)?heading:'';
  if(group)scopeOutline.push({title:group,group:'',excerpt:paragraph.slice(0,650)});
  for(const label of publicStudyConcepts(paragraph)){
   if(topicKey(label)===topicKey(group))continue;
   scopeOutline.push({title:label.replace(/^./,letter=>letter.toUpperCase()),group,excerpt:paragraph.slice(0,650)});
  }
 }
 return [{kind:'web',url:officialCourse,title,publisher:'IIT Kanpur',category:scope.domain?'official-syllabus':'academic-reference',
  status:'page-inspected',excerpt,scopeOutline,scopeTopics:scopeOutline.map(topic=>topic.title),questions:[]}];
}


export function academicOutline(sources){
 const usable=sources.filter(source=>source.category!=='official-pyq'&&source.scopeOutline?.length);
 const official=usable.filter(source=>source.category==='official-syllabus');
 const seen=new Set();
 return (official.length?official:usable).flatMap(source=>source.scopeOutline.flatMap(topic=>{
  const key=topicKey(topic.title);
  if(!key||seen.has(key))return [];
  seen.add(key);
  const {scopeOutline:_,scopeTopics:__,questions:___,...reference}=source;
  return [{title:topic.title,group:topic.group,validation:'published-curriculum',reference:{...reference,excerpt:topic.excerpt}}];
 })).slice(0,24);
}
const synchronizationUrl='https://www.cs.uic.edu/~jbell/CourseNotes/OperatingSystems/5_Synchronization.html';
let synchronizationPage;
let synchronizationRequest;

export async function conceptualReferences(subject,topic){
 if(studySubject(subject)!=='operating systems'||!/\b(?:process synchronization|critical section|mutual exclusion|bounded waiting|semaphores?|race conditions?|mutex)\b/i.test(topic))return [];
 if(!synchronizationPage||synchronizationPage.until<Date.now()){
  synchronizationRequest??=(async()=>{
   try{
    const response=await fetch(synchronizationUrl,{redirect:'error',signal:AbortSignal.timeout(3500)});
    if(!response.ok||!response.headers.get('content-type')?.includes('html')||!response.body)return;
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let html='',bytes=0;
    try{
     while(bytes<180000){
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value.length;
      html+=decoder.decode(part.value,{stream:true});
     }
    }finally{await reader.cancel().catch(()=>{});}
    const heading=decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]??'');
    if(!/^Process Synchronization$/i.test(heading))return;
    const passages=[...html.matchAll(/<(?:p|li)\b[^>]*>((?:(?!<(?:p|li|ul|ol|h[1-6])\b)[\s\S]){60,950}?)<\/(?:p|li)>/gi)]
     .map(match=>decode(match[1])).filter(text=>text.length>=65);
    if(passages.length)synchronizationPage={passages,title:heading,until:Date.now()+3600000};
   }catch{/* A failed fetch does not create a reference. */}
   finally{synchronizationRequest=null;}
  })();
  await synchronizationRequest;
 }
 if(!synchronizationPage)return [];
 const focus=[...terms(topic)].filter(word=>!academicTerms.has(word));
 const core=['critical section','mutual exclusion','bounded waiting','race condition','semaphore'];
 const requested=focus.filter(word=>!['operating','systems','process','synchronization'].includes(word));
 const ranked=synchronizationPage.passages.map(text=>{
  const lower=text.toLowerCase();
  const score=requested.filter(word=>lower.includes(word)).length*4+core.filter(word=>lower.includes(word)).length;
  return {text,score};
 }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
 const essential=topic.toLowerCase()==='process synchronization'?[
  ranked.find(item=>/^mutual exclusion\b/i.test(item.text))?.text,
  ranked.find(item=>/\brace condition\b/i.test(item.text)&&item.text.length<=580)?.text,
 ].filter(Boolean):[];
 const passages=[...new Set([...essential,...ranked.map(item=>item.text)].filter(text=>text.length<=580))].slice(0,4);
 if(!passages.length)return [];
 return [{kind:'web',url:synchronizationUrl,title:synchronizationPage.title,publisher:'University of Illinois Chicago',
  category:'academic-reference',status:'page-inspected',role:'conceptual',excerpt:passages.join('\n\n')}];
}
