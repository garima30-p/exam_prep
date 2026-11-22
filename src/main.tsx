import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { demoApi, duration, fitQuestions, materialType } from './api';
import type { Analysis, Context, ExamApi, Material, Question, Source } from './api';
import { familiarityFrom, makeLearningPlan } from '../server/learning.mjs';
import type { CheckpointState, Progress } from '../server/learning.mjs';
import { countQuestions } from '../server/page-text.mjs';
import { documentComplete, isTrusted } from './document-state';
import type { ExtractedDocument } from './document-state';
import { DocumentReview } from './document-review';
import { acceptedDocuments, documentFormat, documentLocation, originalDocumentLink } from './document-formats';
import { StudyCharacter, ThemeHero, ThemePicker, useTheme } from './themes';
import { answerLines, buildStudyPack, familiarityLabels, sourceLabel } from './study-pack';
import { DownloadStudyPack } from './study-output';
import { revise, revisionFromAnswer } from './revision';
import type { Revision } from './revision';
import { inspectStudyInput } from './study-input';
import { prepareScope } from './preparation-scope';
import type { PreparationScope } from './preparation-scope';
import './style.css';

const sample = "My DBMS exam is tomorrow. I have 5 hours and need 40/100 to pass. Tell me what to prepare first.";
const empty:Context = {subject:'',date:'',minutes:0,pass:'',pattern:'',familiarity:'unknown'};
const preparationLabels={completed:'Checkpoints completed',revision:'Needs revision','in-progress':'In progress','not-started':'Not started'};
type Page = 'pricing'|'privacy'|'terms';
type CoachSource = (Source & {kind:'uploaded';id:string}) | {kind:'web';id:string;title:string;url:string};
type CoachRequest = {request:string;task:string;mode:'auto';topic?:string;subject:string;topics:string[];
  history:{role:'user'|'assistant';content:string}[];sources:Source[];minutes:number};
type Message = {role:'You'|'Demo coach'|'in-nocent';text:string;references?:CoachSource[];
  generated?:boolean;pending?:boolean;error?:string;retry?:CoachRequest};

function Icon({name}:{name:'clip'|'send'|'spark'|'file'|'close'}) {
  const paths = {
    clip:'M21 11.5l-8.7 8.7a5 5 0 01-7.1-7.1l9.4-9.4a3.5 3.5 0 015 5l-9.4 9.4a2 2 0 01-2.8-2.8l8.7-8.7',
    send:'M3 11.5l18-8-7.5 18-3.2-7-7.3-3z M10.3 14.5L21 3.5',
    spark:'M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z',
    file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
    close:'M5 5l14 14M19 5L5 19'
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}

function coachInline(text:string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part,index)=>{
    if(part.startsWith('`')&&part.endsWith('`'))return <code key={index}>{part.slice(1,-1)}</code>;
    if(part.startsWith('**')&&part.endsWith('**'))return <strong key={index}>{part.slice(2,-2)}</strong>;
    return part;
  });
}
function CoachAnswer({text}:{text:string}) {
  return <div className="coach-answer">{text.split(/(```[\s\S]*?```)/).flatMap((part,index)=>{
    if(part.startsWith('```')&&part.endsWith('```'))return <pre key={index}><code>{part.slice(3,-3).replace(/^[-\w]*\r?\n/,'').trimEnd()}</code></pre>;
    return part.trim().split(/\n\s*\n/).filter(Boolean).map((block,blockIndex)=>{
      const key=index+'-'+blockIndex;
      const lines=block.split('\n');
      if(/^#{1,4}\s+/.test(lines[0]))return <div key={key}><h3>{coachInline(lines[0].replace(/^#{1,4}\s+/,''))}</h3>{lines.length>1&&<p>{coachInline(lines.slice(1).join('\n'))}</p>}</div>;
      if(lines.every(line=>/^\s*[-*]\s+/.test(line)))return <ul key={key}>{lines.map((line,i)=>
        <li key={i}>{coachInline(line.replace(/^\s*[-*]\s+/,''))}</li>)}</ul>;
      if(lines.every(line=>/^\s*\d+[.)]\s+/.test(line)))return <ol key={key}>{lines.map((line,i)=>
        <li key={i}>{coachInline(line.replace(/^\s*\d+[.)]\s+/,''))}</li>)}</ol>;
      return <p key={key}>{coachInline(block)}</p>;
    });
  })}</div>;
}

export function App({api=demoApi}:{api?:ExamApi}) {
  const theme = useTheme();
  const [characterPulse,setCharacterPulse]=useState(0);
  const [exampleMode,setExampleMode]=useState(false);
  const activeApi=exampleMode?demoApi:api;
  const sampleMode=activeApi===demoApi;
  const [prompt,setPrompt]=useState('');
  const [context,setContext]=useState(empty);
  const [files,setFiles]=useState<Material[]>([]);
  const [notice,setNotice]=useState('');
  const [needsTime,setNeedsTime]=useState(false);
  const [timeReply,setTimeReply]=useState('');
  const [busy,setBusy]=useState(false);
  const [documents,setDocuments]=useState<ExtractedDocument[]>([]);
  const [processingMessage,setProcessingMessage]=useState('');
  const [awaitReview,setAwaitReview]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const [planGenerated,setPlanGenerated]=useState(false);
  const [revision,setRevision]=useState<Revision|null>(null);
  const [editing,setEditing]=useState(false);
  const [showQuestions,setShowQuestions]=useState(false);
  const [aiNote,setAiNote]=useState('');
  const [aiReferences,setAiReferences]=useState<CoachSource[]>([]);
  const [coachPage,setCoachPage]=useState(()=>typeof location!=='undefined'&&location.hash==='#study-coach');
  useEffect(()=>{const read=()=>setCoachPage(location.hash==='#study-coach');window.addEventListener('hashchange',read);return ()=>window.removeEventListener('hashchange',read);},[]);
  const resultHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(planGenerated&&!editing){resultHeading.current?.focus();resultHeading.current?.scrollIntoView?.({block:'start'});}},[planGenerated,editing]);
  const [dragging,setDragging]=useState(false);
  const [result,setResult]=useState<readonly Question[]|null>(null);
  const [warnings,setWarnings]=useState<string[]>([]);
  const [optimization,setOptimization]=useState<{data:NonNullable<Analysis['optimization']>}|null>(null);
  const [preparedScope,setPreparedScope]=useState<PreparationScope|null>(null);
  const [practice,setPractice]=useState<Record<number,string>>({});
  const [practicePending,setPracticePending]=useState(false);
  const practiceRun=useRef<AbortController|null>(null);
  const analyzed=useRef<{key:string;analysis:Analysis}|null>(null);
  const [questionAnswers,setQuestionAnswers]=useState<Record<string,{text?:string;references?:CoachSource[];generated?:boolean;pending?:boolean;error?:boolean}>>({});
  const pendingAnswers=useRef(new Set<string>());
  const [progress,setProgress]=useState<Progress>({});
  const [elapsed,setElapsed]=useState(0);
  const timeAnchor=useRef(Date.now());
  const [messages,setMessages]=useState<Message[]>([]);
  const chatLog=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(chatLog.current)chatLog.current.scrollTop=0;},[messages]);
  const [chat,setChat]=useState('');
  const [coachPending,setCoachPending]=useState(false);
  const [needsSubject,setNeedsSubject]=useState(false);
  const [subjectReply,setSubjectReply]=useState('');
  const [summaryWebLimited,setSummaryWebLimited]=useState(false);
  const [limit,setLimit]=useState(10);
  const [page,setPage]=useState<Page|null>(null);
  const [source,setSource]=useState<Source|null>(null);
  const [sourceUrl,setSourceUrl]=useState('');
  const nextFile=useRef(0);
  const input=useRef<HTMLInputElement>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{
    const file=files.find(item=>item.id===source?.documentIndex)?.file;
    if(!file){setSourceUrl('');return;}
    const url=URL.createObjectURL(file);
    setSourceUrl(url);
    return ()=>URL.revokeObjectURL(url);
  },[files,source]);
  const attachment = (incoming:FileList|null) => {
    if (!incoming || busy) return;
    const accepted:Material[]=[]; const errors:string[]=[];
    for(const file of Array.from(incoming)) {
      if(!documentFormat(file.name) || file.size>20*1024*1024) { errors.push(file.name); continue; }
      if(files.some(item=>item.file.name===file.name && item.file.size===file.size && item.file.lastModified===file.lastModified) ||
        accepted.some(item=>item.file.name===file.name && item.file.size===file.size && item.file.lastModified===file.lastModified)) continue;
      if(files.length+accepted.length>=8) { errors.push(file.name); continue; }
      accepted.push({id:++nextFile.current,file,kind:materialType(file.name)});
    }
    setFiles([...files,...accepted]);
    if(accepted.length){setPlanGenerated(false);setAwaitReview(false);}
    setNotice(errors.length ? 'Could not attach ' + errors.join(', ') + '. Add up to 8 files of 20 MB each. Use PDF, DOCX, PPTX, PNG, JPEG, WebP, or BMP. Save older .ppt files as .pptx.' : '');
  };
  const editPrompt=(value:string)=>{setPrompt(value);setContext(activeApi.parse(value));setNeedsTime(false);setNeedsSubject(false);setPlanGenerated(false);};
  const restartBudget=()=>{timeAnchor.current=Date.now();setElapsed(0);};
  const update=<K extends keyof Context,>(key:K,value:Context[K])=>{
    if(key==='minutes')restartBudget();
    if(!sampleMode){practiceRun.current?.abort();setPracticePending(false);}
    setContext(current=>({...current,[key]:value}));
    if(!sampleMode||key!=='minutes'&&key!=='familiarity')setPlanGenerated(false);
  };
  async function generate(event?:FormEvent, adjusted=context,mode:'normal'|'retry'|'continue'='normal') {
    event?.preventDefault();
    if(controller.current) return;
    if(!prompt.trim() && !files.length) {setNotice('Describe your exam or attach a file to begin.');return;}
    if(!adjusted.minutes&&(!sampleMode&&!revise(prompt,[],[],adjusted.subject)&&Boolean(prompt.trim())||/\b(?:timed plan|(?:make|build|create|give me) (?:a |my )?(?:study|revision|preparation) plan)\b/i.test(prompt.split(/summari[sz]e (?:my |these |the )?notes:/i)[0]))){setNeedsTime(true);return;}
    setNeedsTime(false);setNeedsSubject(false);setNotice('');setBusy(true);
    const run=new AbortController();
    controller.current=run;
    setProcessingMessage(activeApi.prepare&&files.length?'Opening attachments…':'Building your plan…');
    try {
      let records=documents.filter(document=>files.some(file=>file.id===document.id));
      if(activeApi.prepare&&files.length&&(mode==='retry'||files.some(file=>!records.some(document=>document.id===file.id)))){
        records=await activeApi.prepare(files,{records,signal:run.signal,retry:mode==='retry',
          onUpdate:({documents:updated,message})=>{setDocuments(updated);setProcessingMessage(message);}});
        setDocuments(records);
        if(records.some(document=>!documentComplete(document)) && !revise(prompt,records,files,adjusted.subject) && !records.some(document=>document.pages.some(page=>page.text.trim()&&(page.status==='extracted'||page.status==='verified')))){
          setNotice('No readable material was found. Check the original or retry the attachment.');
          setAwaitReview(true);
          return;
        }
      }
      run.signal.throwIfAborted();
      setAwaitReview(false);
      setProcessingMessage('Building your plan…');
      const inspected=sampleMode?{files,subject:'',topics:[]}:inspectStudyInput(records,files);
      const classified=inspected.files;
      if(!sampleMode&&records.length)setFiles(classified);
      if(!adjusted.subject&&inspected.subject){
        adjusted={...adjusted,subject:inspected.subject};setContext(adjusted);
      }
      const extracted=sampleMode?null:revise(prompt,records,classified,adjusted.subject);
      if(!sampleMode&&classified.length&&!prompt.trim()&&!adjusted.minutes){
        setNeedsTime(true);return;
      }
      const analysisKey=JSON.stringify([prompt,classified.map(file=>[file.id,file.kind]),records]);
      const cached=!sampleMode&&analyzed.current?.key===analysisKey?analyzed.current.analysis:null;
      const runProgress=cached?progress:{};
      let analysis:Analysis;
      try {
        analysis=cached??await activeApi.analyze(adjusted, classified, prompt,{documents:records,signal:run.signal,
          onPlanning:()=>setProcessingMessage('Matching equivalent questions and building your plan…')});
      } catch(error) {
        run.signal.throwIfAborted();
        if(!extracted)throw error;
        analysis={questions:[],warnings:['Question ranking is temporarily unavailable.']};
      }
      if(!sampleMode&&!cached)analyzed.current={key:analysisKey,analysis};
      const scope=prepareScope(analysis,adjusted,runProgress);
      const summary=extracted??revisionFromAnswer(scope.questions.find(question=>question.answerSource))
        ??(sampleMode&&analysis.questions[0]?revise(analysis.questions[0].answer,[],[],analysis.questions[0].topic):null);
      const topics=[...new Set(scope.questions.length?scope.questions.map(question=>question.topic):
        summary?[summary.title]:inspected.topics)].slice(0,adjusted.minutes<=15?3:6);
      const sources=[...new Map([...scope.questions.flatMap(question=>question.answerSource?[question.answerSource]:[]),
        ...(summary?.passages??[])].map(source=>[source.excerpt,source])).values()].slice(0,8);
      if(!sampleMode&&!summary&&!adjusted.subject&&!topics.length){setNeedsSubject(true);return;}
      setAiNote('');
      setAiReferences([]);
      setSummaryWebLimited(false);
      if(!sampleMode){
        setProcessingMessage(summary?'Writing your revision summary…':'Looking for material to explain the key topics…');
        try {
          const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([run.signal,AbortSignal.timeout(50000)]),
            body:JSON.stringify({task:'notes',mode:'auto',subject:adjusted.subject,topics,minutes:adjusted.minutes,
              topic:scope.questions.length?topics[0]:summary?.title??adjusted.subject,request:'Write a concise revision summary for '+(adjusted.subject||summary?.title||'the supplied study topics')+'.',
              priorities:scope.questions.map(question=>({topic:question.topic,prompt:question.prompt})),sources})});
          const data=await response.json() as {explanation?:string;code?:string;sources?:CoachSource[];webSearch?:{code:string}};
          if(!response.ok||!data.explanation?.trim()){
            if(data.code==='subject_required')setNeedsSubject(true);
            else setNotice(data.code==='usage_limit'?'The AI usage limit has been reached. Try again later.':'AI generation failed. Please retry.');
            return;
          }
          setAiNote(data.explanation);
          setAiReferences(data.sources??[]);
          setSummaryWebLimited(Boolean(data.webSearch&&data.webSearch.code!=='ok'));
        }catch{
          run.signal.throwIfAborted();
          setNotice('AI generation failed. Please retry.');return;
        }
      }
      practiceRun.current?.abort();setPracticePending(false);setPractice({});
      setRevision(summary);setEditing(false);setShowQuestions(false);
      run.signal.throwIfAborted();
      setResult(analysis.questions);setWarnings(analysis.warnings);
      setOptimization(analysis.optimization?{data:analysis.optimization}:null);
      setPreparedScope(scope);setProgress(runProgress);restartBudget();setLimit(10);setPlanGenerated(true); }
    catch(error) { setNotice(run.signal.aborted?'Processing cancelled. Run again to resume from usable pages.':error instanceof Error?error.message:'The study plan could not load. Try again.'); }
    finally {controller.current=null;setProcessingMessage('');setBusy(false);}
  }
  const remainingTime=Math.max(0,context.minutes-elapsed);
  const plan=useMemo(()=>{
    if(!optimization)return null;
    const {data}=optimization;
    const candidates=!sampleMode&&preparedScope?data.candidates.filter(question=>preparedScope.questions.some(item=>item.id===question.id)):data.candidates;
    return makeLearningPlan(candidates,data.topics,remainingTime,context.pattern,context.familiarity,progress);
  },[optimization,preparedScope,sampleMode,remainingTime,context.pattern,context.familiarity,progress]);
  const fitted=plan&&optimization
    ? plan.selectedQuestionIds.map(id=>optimization.data.candidates.find(question=>question.id===id)!)
    : fitQuestions(result ?? [],context.minutes);
  const visible=(remainingTime||context.minutes?fitted:result??[]).slice(0,limit);
  const questionList=!sampleMode?(preparedScope?.questions??[]).map(question=>practice[question.id]?{...question,prompt:practice[question.id]}:question):visible.length?visible:(result??[]).slice(0,limit);
  const questionsOutsideBudget=Boolean(!sampleMode&&!preparedScope?.review&&!visible.length&&questionList.length);
  const plannedIds=new Set(fitted.map(question=>question.id));
  const tracked=optimization?.data.candidates.filter(question=>!plannedIds.has(question.id)&&progress[question.id])??[];
  const coveredUnits=[...new Set(visible.map(question=>question.unit).filter(Boolean))].sort((a,b)=>a-b);
  const missingUnits=[...new Set(result?.map(question=>question.unit).filter(unit=>unit&&!coveredUnits.includes(unit)))].sort((a,b)=>a-b);
  const coverageMessage = missingUnits.length ? 'Units outside the current shortlist: '+missingUnits.join(', ')+'.' : '';
  const pack = buildStudyPack(context,remainingTime,plan,fitted,sampleMode?visible:questionList,sampleMode?optimization?.data.candidates??result??[]:questionList,
    sampleMode,[...warnings,...(plan?.warnings??[]),coverageMessage].filter(Boolean));
  const readMinutes=revision&&remainingTime?Math.min(remainingTime,Math.max(1,Math.ceil(revision.passages.length/2))):0;
  if(aiNote&&!sampleMode)pack.generatedNotes={text:aiNote,references:aiReferences.map(source=>source.kind==='uploaded'?sourceLabel(source):source.title+' · '+source.url)};
  if(revision){
    if(sampleMode)pack.revision=revision;
    if(readMinutes&&!pack.timeline.length)pack.timeline.push({title:revision.title+' · Read and recall',minutes:readMinutes});
  }
  const reviewAllocations:Record<number,number>={};
  if(!sampleMode&&preparedScope?.review){
    let available=Math.min(remainingTime,Math.floor(remainingTime*.9));
    pack.timeline=preparedScope.questions.flatMap(question=>{const minutes=Math.min(available,preparedScope.allocations[question.id]??0);available-=minutes;reviewAllocations[question.id]=minutes;return minutes?[{title:question.topic+' (quick review)',minutes}]:[];});
    if(pack.timeline.length)pack.timeline.push({title:'Active recall',minutes:Math.ceil(remainingTime*.1)});
    pack.questions=pack.questions.map(entry=>({...entry,minutes:reviewAllocations[entry.question.id]??0}));
  }
  const nextAction=pack.timeline[0];
  const activeCoachRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>{activeCoachRequest.current?.abort();practiceRun.current?.abort();},[]);
  async function askCoach(message:Message,request:CoachRequest) {
    if(activeCoachRequest.current)return;
    const operation=new AbortController();
    activeCoachRequest.current=operation;
    setCoachPending(true);
    let reply:Message;
    try{
      const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
        signal:AbortSignal.any([operation.signal,AbortSignal.timeout(50000)]),body:JSON.stringify(request)});
      const data=await response.json() as {explanation?:string;generated?:boolean;sources?:CoachSource[];code?:string};
      if(!response.ok||!data.explanation?.trim()){
        throw new Error(data.code==='usage_limit'?'The AI usage limit has been reached. Try again later.':'Couldn’t answer right now. Try again.');
      }
      reply={...message,text:data.explanation,generated:data.generated!==false,references:data.sources};
    }catch(error){
      if(operation.signal.aborted)return;
      const errorMessage=error instanceof Error&&error.message==='The AI usage limit has been reached. Try again later.'
        ?error.message:'Couldn’t answer right now. Try again.';
      reply={...message,error:errorMessage,retry:request};
    }finally{
      if(activeCoachRequest.current===operation){activeCoachRequest.current=null;setCoachPending(false);}
    }
    setMessages(current=>current.map(item=>item===message?{...reply,pending:false}:item));
  }
  function send(value:string) {
    const text=value.trim();
    if(!text||activeCoachRequest.current)return;
    const minutes=duration(text);
    const familiarity=familiarityFrom(text);
    let reply:string|undefined;
    if(result&&minutes&&/\b(left|remaining|replan|can study|I (?:only )?have)\b/i.test(text)&&!text.includes('?')){
      update('minutes',minutes);setLimit(10);
      if(familiarity!=='unknown')update('familiarity',familiarity);
      reply='Updated the plan for '+minutes+' minutes, including time for recall.';
    }else if(result&&familiarity!=='unknown'&&!text.includes('?')){
      update('familiarity',familiarity);
      setElapsed(Math.max(0,Math.floor((Date.now()-timeAnchor.current)/60000)));
      setLimit(10);
      reply='Updated your preparation estimates for “'+familiarityLabels[familiarity].toLowerCase()+'”. Your checkpoint progress is still available.';
    }else if(result&&/^(?:show (?:the )?)?(?:next (?:10|ten)|more questions)[.!]?$/i.test(text)){
      setLimit(current=>current+10);
      reply=limit<fitted.length?'I added the next questions below.':'The current materials and study budget support '+fitted.length+' questions.';
    }
    if(sampleMode&&!reply)reply=activeApi.chat(text,visible.map((question,index)=>({...question,id:index+1})));
    const message:Message={role:sampleMode?'Demo coach':'in-nocent',text:reply??'',pending:!reply};
    setMessages(current=>[...current,{role:'You',text},message]);setChat('');
    if(reply)return;

    const topics=[...new Set((optimization?.data.topics.map(topic=>topic.title)??(result??[]).map(question=>question.topic)))].slice(0,20);
    const numbered=text.match(/(?:#|question\s+)(\d+)/i);
    const selected=numbered?visible[Number(numbered[1])-1]:undefined;
    const previousQuestion=messages.filter(item=>item.role==='You').at(-1)?.text??'';
    const query=new Set((text+' '+previousQuestion+' '+(selected?.topic??'')+' '+topics.join(' ')).toLowerCase().match(/[a-z]{4,}/g)??[]);
    const retrieved=documents.flatMap(document=>{
      if(files.find(file=>file.id===document.id)?.kind==='Past paper')return [];
      return document.pages.filter(isTrusted).flatMap(page=>page.text.split(/\n+/).map((line,index)=>({
        file:document.name,page:page.number,number:'Line '+(index+1),documentIndex:document.id,excerpt:line.trim().slice(0,650),
      })));
    }).map(source=>({source,score:[...new Set(source.excerpt.toLowerCase().match(/[a-z]{4,}/g)??[])].filter(word=>query.has(word)).length}))
      .filter(match=>match.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(match=>match.source);
    const candidates=[selected?.answerSource,...retrieved,...(revision?.passages??[]),...fitted.map(question=>question.answerSource)]
      .filter((candidate):candidate is Source=>Boolean(candidate));
    const sources=[...new Map(candidates.map(candidate=>[candidate.excerpt,candidate])).values()].slice(0,12);
    const history:CoachRequest['history']=[];
    for(let index=0;index<messages.length;index+=2){
      const [user,assistant]=messages.slice(index,index+2);
      if(user?.role==='You'&&assistant?.text&&!assistant.error&&!assistant.pending){
        history.push({role:'user',content:user.text},{role:'assistant',content:assistant.text});
      }
    }
    void askCoach(message,{request:text,mode:'auto',task:/\bmarks?\b/i.test(text)?'exam':'chat',
      topic:selected?.topic,subject:context.subject,topics,history:history.slice(-6),sources,minutes:remainingTime});
  }
  function retryCoach(message:Message) {
    if(!message.retry||activeCoachRequest.current)return;
    const pending:Message={role:message.role,text:'',pending:true};
    setMessages(current=>current.map(item=>item===message?pending:item));
    void askCoach(pending,message.retry);
  }
  function open(next:Page|null, reference:Source|null=null){setPage(next);setSource(reference);dialog.current?.showModal();}
  function reset(){practiceRun.current?.abort();analyzed.current=null;setPreparedScope(null);setQuestionAnswers({});activeCoachRequest.current?.abort();activeCoachRequest.current=null;setCoachPending(false);setExampleMode(false);setResult(null);setOptimization(null);setProgress({});restartBudget();setWarnings([]);setMessages([]);setFiles([]);setDocuments([]);setAwaitReview(false);setPrompt('');setContext(empty);setNeedsTime(false);setNeedsSubject(false);setNotice('');setTimeReply('');setSubjectReply('');setPlanGenerated(false);}
  function toggleExample(){setResult(null);setOptimization(null);setProgress({});restartBudget();setWarnings([]);setAwaitReview(false);analyzed.current=null;setPreparedScope(null);setExampleMode(!exampleMode);editPrompt(exampleMode?'':sample);}
  function modifyFile(id:number,kind?:string) {
    setFiles(current=>kind?current.map(file=>file.id===id?{...file,kind,kindOverride:true}:file):current.filter(file=>file.id!==id));
    if(!kind)setDocuments(current=>current.filter(document=>document.id!==id));
    setAwaitReview(false);setPlanGenerated(false);
  }
  function verifyPage(id:number,number:number,text:string){
    const kind=files.find(file=>file.id===id)?.kind;
    setDocuments(current=>current.map(document=>document.id!==id?document:{...document,pages:document.pages.map(page=>page.number!==number?page:{
      ...page,text:text.trim(),status:'verified',method:'manual',questions:countQuestions(text,kind==='Past paper'),reason:''})}));
    setPlanGenerated(false);
  }
  function changeCheckpoint(questionId:number,id:string,status:CheckpointState){
    if(status==='completed'&&progress[questionId]?.[id]!=='completed') setCharacterPulse(value=>value+1);
    setProgress(current=>({...current,[questionId]:{...current[questionId],[id]:status}}));
    setElapsed(Math.max(0,Math.floor((Date.now()-timeAnchor.current)/60000)));
  }
  async function revealQuestions(){
    setShowQuestions(true);
    if(sampleMode)return;
    const candidates=(preparedScope?.questions??[]).filter(question=>!question.historical&&
      !question.historicalFrequency&&!(question.sources??[question.source]).some(source=>files.some(file=>file.id===source.documentIndex&&file.kind==='Past paper')));
    if(!candidates.length)return;
    const operation=new AbortController();
    practiceRun.current=operation;
    setPracticePending(true);
    try{
      const r=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
        signal:AbortSignal.any([operation.signal,AbortSignal.timeout(20000)]),
        body:JSON.stringify({task:'practice',priorities:candidates.map(({id,topic,prompt})=>({id,topic,prompt}))})});
      const data=await r.json() as {questions?:{id:number;prompt:string}[]};
      if(r.ok&&Array.isArray(data.questions)&&!operation.signal.aborted){
        const allowed=new Set(candidates.map(question=>question.id));
        const key=(value:string)=>value.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
        const used=new Set((preparedScope?.questions??[]).filter(question=>!allowed.has(question.id)).map(question=>key(question.prompt)));
        setPractice(Object.fromEntries(data.questions.flatMap(question=>{
          if(!allowed.has(question.id)||typeof question.prompt!=='string'||used.has(key(question.prompt)))return [];
          used.add(key(question.prompt));return [[question.id,question.prompt]];
        })));
      }
    }catch{/* Keep syllabus practice questions available if generation fails. */}
    finally{if(practiceRun.current===operation){practiceRun.current=null;setPracticePending(false);}}
  }
  async function loadQuestionAnswer(question:Question,key:string){
    if(pendingAnswers.current.has(key)||questionAnswers[key]?.text)return;
    pendingAnswers.current.add(key);
    setQuestionAnswers(current=>({...current,[key]:{pending:true}}));
    try{
      const sources=question.answerSource?[question.answerSource]:aiReferences.filter(reference=>reference.kind==='uploaded').slice(0,3);
      const r=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(50000),
        body:JSON.stringify({task:'answer',mode:'auto',request:question.prompt,topic:question.topic,subject:context.subject,
          sources,minutes:remainingTime})});
      const response=await r.json() as {explanation?:string;sources?:CoachSource[];generated?:boolean};
      if(!r.ok||!response.explanation?.trim())throw new Error();
      setQuestionAnswers(current=>({...current,[key]:{text:response.explanation,references:response.sources,generated:response.generated!==false}}));
    }catch{setQuestionAnswers(current=>({...current,[key]:{error:true}}));}
    finally{pendingAnswers.current.delete(key);}
  }
  function renderQuestion(q:Question,index?:number){
    const effort=plan?.efforts[q.id];
    const shortReview=!sampleMode&&preparedScope?.review&&Boolean(preparedScope.allocations[q.id]);
    const allocation=shortReview?reviewAllocations[q.id]:(sampleMode||plannedIds.has(q.id)?effort?.minutes??q.minutes:0);
    const answerKey=JSON.stringify([context.subject,q.prompt,q.answerSource??null,q.sources??[q.source]]);
    const answer=questionAnswers[answerKey];
    return <article className="question" key={q.id}>
      <div className="question-meta">{index!==undefined&&<span className="rank">#{index+1}</span>}<span>{q.topic}{q.unit?' · Unit '+q.unit:''}</span><span className="spacer"/><span>{allocation?allocation+' min'+(shortReview?' quick review':''):'Reference'}{q.marks?' · '+q.marks+' marks':''}</span></div>
      <h3>{q.prompt}</h3><p>{q.historical?'Previous-Year Question'+(q.examYears?.length?' · '+q.examYears.join(', '):'')+' · ':q.sources?.some(source=>documents.some(doc=>doc.id===source.documentIndex&&files.some(file=>file.id===doc.id&&file.kind==='Past paper')))?'Uploaded past-paper question · ':practice[q.id]?'AI-Generated Practice Question · ':'Practice question · '}{q.reason}.</p>
      {!sampleMode&&<details className="checkpoints" onToggle={event=>{if(event.currentTarget.open&&!answer)void loadQuestionAnswer(q,answerKey);}}>
        <summary>View Answer ↓</summary>
        {answer?.pending&&<p role="status">Preparing answer…</p>}
        {answer?.error&&<><p>Couldn’t verify an answer right now. {q.answerSource?'You can still read the matching passage.':''}</p>
          <button className="link accent" onClick={()=>void loadQuestionAnswer(q,answerKey)}>Retry</button>
          {q.answerSource&&<button className="link accent" onClick={()=>open(null,q.answerSource!)}>{sourceLabel(q.answerSource)}</button>}</>}
        {answer?.text&&<>{answer.generated&&<small>{answer.references?.length?'AI-generated':'AI-generated · Not source-verified'}</small>}<CoachAnswer text={answer.text}/>
          {answer.references?.map(reference=>reference.kind==='uploaded'
            ?<button key={reference.id} className="link accent source" onClick={()=>open(null,reference)}>{sourceLabel(reference)}</button>
            :<a key={reference.id} className="link accent source" href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a>)}</>}
      </details>}
      {(q.sources??[q.source]).map((reference,i)=><button key={i} className="link accent source" onClick={()=>open(null,reference)}><Icon name="file"/>{sourceLabel(reference)}</button>)}
      {effort&&q.learning&&<details className="checkpoints">
        <summary>{q.learning.type} · {preparationLabels[effort.status]} · {effort.completed}/{effort.total} checkpoints</summary>
        {shortReview&&<p>Use this allocation to review the method. A full answer takes longer.</p>}
        <p>Remaining estimate: {effort.remaining.understanding} min understanding, {effort.remaining.practice} min practice, {effort.remaining.recall} min recall.</p>
        {q.learning.prerequisites.length>0&&<p>Syllabus prerequisites: {q.learning.prerequisites.join(', ')}.</p>}
        <ol>
          {q.learning.checkpoints.map(checkpoint=><li key={checkpoint.id}>
            <label><span>{checkpoint.text}<small>{checkpoint.label}</small></span>
              <select aria-label={checkpoint.text} value={progress[q.id]?.[checkpoint.id]??'incomplete'} onChange={event=>changeCheckpoint(q.id,checkpoint.id,event.target.value as CheckpointState)}>
                <option value="incomplete">Incomplete</option><option value="completed">Completed</option><option value="revision">Needs revision</option>
              </select>
            </label>
            {checkpoint.source&&<button className="link accent" onClick={()=>open(null,checkpoint.source)}>View notes excerpt</button>}
          </li>)}
        </ol>
      </details>}

    </article>;
  }
  const hasContext=Boolean(prompt.trim() || files.length);
  return <>
    <header className="top"><div className="wrap header-inner">
      <a className="brand" href="#main" aria-label="in-nocent home"><span className="brand-mark"><Icon name="spark"/></span>in-nocent<span className="brand-dot">.</span></a>
      <ThemePicker {...theme}/>
      <nav aria-label="Workspace"><a className="link" href={coachPage?'#main':'#study-coach'} onClick={event=>{
        event.preventDefault();
        history.pushState(null,'',event.currentTarget.hash);
        setCoachPage(!coachPage);
      }}>{coachPage?'Study workspace':'Study Coach'}</a></nav>
    </div></header>
    <main id="main" className={'wrap '+(planGenerated?'workspace':'landing')}>
      {!coachPage&&<>
      <ThemeHero {...theme}/>
      <section aria-label="Exam setup" className="setup">
        <form onSubmit={event=>{if(!planGenerated){void generate(event);return;}event.preventDefault();if(editing)setEditing(false);else resultHeading.current?.scrollIntoView?.({block:'start'});}} className={'composer '+(dragging?'dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);attachment(e.dataTransfer.files);}}>
          <label htmlFor="prompt">Paste notes or add a file</label>
          <textarea id="prompt" value={prompt} disabled={busy} onChange={e=>editPrompt(e.target.value)} placeholder="Paste a passage, or describe what you want to revise" rows={3} maxLength={8000}/>
          {files.length>0 && <ul className="files">{files.map(item=><li key={item.id}><Icon name="file"/><span title={item.file.name}>{item.file.name}</span><select disabled={busy} aria-label={'Type for '+item.file.name} value={item.kind} onChange={e=>modifyFile(item.id,e.target.value)}>{['Unclassified','Syllabus','Past paper','Notes','Administrative','Unreadable'].map(k=><option key={k}>{k}</option>)}</select><button disabled={busy} type="button" className="icon-btn" aria-label={'Remove '+item.file.name} onClick={()=>modifyFile(item.id)}><Icon name="close"/></button></li>)}</ul>}
          <div className="composer-actions">
            <input hidden ref={input} type="file" accept={acceptedDocuments} multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>{attachment(e.target.files);e.target.value='';}}/>
            <button className="secondary" type="button" disabled={busy} onClick={()=>input.current?.click()}><Icon name="clip"/> Attach files</button>
            <button className="primary" disabled={busy} type="submit">{busy?'Generating summary…':planGenerated?'Summary generated ↓':'Generate Summary'}</button>
          </div>
        </form>
        {notice && <p role="alert" className="notice">{notice}</p>}
        {hasContext && <details><summary>Edit details</summary><fieldset className="context" disabled={busy}><legend>Plan settings</legend>
          <label>Exam<input value={context.subject} placeholder="Subject" onChange={e=>update('subject',e.target.value)}/></label>
          <label>Date<input value={context.date} placeholder="Exam date" onChange={e=>update('date',e.target.value)}/></label>
          <label>Minutes<input type="number" min="0" max="525600" value={context.minutes||''} placeholder="Study time" onChange={e=>{update('minutes',Math.max(0,Math.min(525600,Math.floor(Number(e.target.value)))));setPlanGenerated(false);}}/></label>
          <label>Pass mark<input value={context.pass} placeholder="Optional" onChange={e=>update('pass',e.target.value)}/></label>
          <label>Paper rules<input value={context.pattern} placeholder="Optional" onChange={e=>update('pattern',e.target.value)}/></label>
          {context.familiarity!=='unknown'&&<span className="file-count">{familiarityLabels[context.familiarity]}</span>}
        </fieldset></details>}
        {needsTime && <form className="followup" onSubmit={e=>{e.preventDefault();const minutes=duration(timeReply)||(/^\d+$/.test(timeReply.trim())?Number(timeReply):0);if(!minutes||!Number.isSafeInteger(minutes)){setNotice('Enter study time in minutes or hours.');return;} const adjusted={...context,minutes};setContext(adjusted);void generate(undefined,adjusted,documents.length?'continue':'normal');}}><label htmlFor="time">How much time do you have to prepare?</label><div className="inline"><input autoFocus id="time" value={timeReply} onChange={e=>setTimeReply(e.target.value)} placeholder="e.g. 2 hours"/><button className="primary">Continue</button></div></form>}
        {needsSubject&&<form className="followup" onSubmit={event=>{event.preventDefault();if(!subjectReply.trim())return;const adjusted={...context,subject:subjectReply.trim()};setContext(adjusted);void generate(undefined,adjusted,documents.length?'continue':'normal');}}>
          <label htmlFor="summary-subject">What subject should I summarize?</label>
          <div className="inline"><input id="summary-subject" value={subjectReply} maxLength={100} onChange={event=>setSubjectReply(event.target.value)}/><button className="primary" disabled={!subjectReply.trim()}>Continue</button></div>
        </form>}
        <div className="setup-meta"><button className="link accent" type="button" disabled={busy} onClick={toggleExample}>{exampleMode?'Exit demo':'Try an example'}</button>{sampleMode?<small>Demo · Sample DBMS data</small>:hasContext&&<small>Original files stay on device. Text is sent for analysis.</small>}</div>
        {busy && <div className="processing-status"><p role="status" className="notice">{sampleMode?'Loading sample questions…':processingMessage}</p>
          {!sampleMode&&<button className="secondary" type="button" onClick={()=>controller.current?.abort()}>Cancel processing</button>}
        </div>}
        {!sampleMode&&activeApi.prepare&&<DocumentReview documents={documents} files={files} busy={busy} onVerify={verifyPage}/>}
        {!busy&&!sampleMode&&awaitReview&&<button className="secondary" onClick={()=>void generate(undefined,context,'retry')}>Retry unread files</button>}
      </section>
      {result && planGenerated && !editing && <section className="results" aria-labelledby="results-title">
        <div className="result-top"><div className="study-heading">{theme.anime&&theme.character&&<StudyCharacter anime={theme.anime} character={theme.character} pulse={characterPulse}/>}<h2 id="results-title" ref={resultHeading} tabIndex={-1}>Must Read{context.subject?' — '+context.subject:''}</h2><button className="link" onClick={()=>setEditing(true)} aria-label="Collapse summary">↑</button></div><div className="study-actions"><DownloadStudyPack pack={pack}/><button className="secondary" disabled={busy} onClick={reset}>Start over</button></div></div>
        <div className="summary">{pack.context.map(value=><span key={value}>{value}</span>)}</div>
        {aiNote?<article className="study-note" aria-label="Revision notes">
          <strong>{aiReferences.length?'AI-generated':'AI-generated · Not source-verified'}</strong>
          {summaryWebLimited&&<p className="notice">Web sources were unavailable. {aiReferences.length?'This summary uses your uploaded material.':'This is a general explanation.'}</p>}
          <CoachAnswer text={aiNote}/>
          {aiReferences.length>0&&<details><summary>References used</summary>{aiReferences.map(reference=>reference.kind==='uploaded'
            ?<button className="link accent source" key={reference.id} onClick={()=>open(null,reference)}>{sourceLabel(reference)}</button>
            :<a className="link accent source" key={reference.id} href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a>)}</details>}
        </article>:sampleMode&&revision&&<article className="study-note" aria-label="Revision notes">
          <h3>{revision.title}</h3>{revision.passages.map((source,index)=><p key={index}>{source.excerpt}</p>)}
          <details><summary>Show answer</summary><p>{revision.answer}</p></details>
        </article>}
        {documents.some(document=>!documentComplete(document))&&<p className="notice">Unreadable or unverified pages were excluded from the summary.</p>}
        {nextAction&&<p className="notice"><strong>Start here:</strong> {nextAction.title} · {nextAction.minutes} min</p>}
        <button className="secondary" onClick={()=>void revealQuestions()} disabled={showQuestions}>{practicePending?'Preparing practice questions…':'Generate Questions'}</button>
        <details className="study-output" open={showQuestions||undefined}><summary>More study tools</summary>
        {pack.timeline.length>0&&<details><summary>Time breakdown</summary><ol className="study-timeline">
          {pack.timeline.map((item,index)=><li key={index}>{item.title} <strong>{item.minutes} min</strong></li>)}
        </ol></details>}
        <div className="result-grid"><section aria-labelledby="important-questions">
          {showQuestions&&(questionList.length>0||tracked.length>0)&&<h3 id="important-questions">Important Questions</h3>}

          {showQuestions&&questionsOutsideBudget&&<p>These questions are available for reference. None fits the remaining preparation budget.</p>}
          {showQuestions&&questionList.map((question,index)=>renderQuestion(question,index))}
          {showQuestions&&!questionList.length&&revision&&<article className="question">
            <p>Practice question · based on your study material</p><h3>{revision.recall}</h3>
            <details><summary>Show answer</summary><p>{revision.answer}</p></details>
            <button className="link accent" onClick={()=>open(null,revision.passages[0])}>{sourceLabel(revision.passages[0])}</button>
          </article>}
          {showQuestions&&!questionList.length&&!revision&&<p>No supported questions were found.</p>}
          {sampleMode&&showQuestions&&limit<fitted.length && <button className="secondary" onClick={()=>setLimit(current=>current+10)}>Show next 10</button>}
          {showQuestions&&tracked.length>0&&<details className="coverage"><summary>Revisit checkpoint progress ({tracked.length})</summary>{tracked.map(question=>renderQuestion(question))}</details>}
        </section></div>
          {result.length>0&&pack.warnings.length>0&&<div className="coverage"><h3>Sources and Coverage</h3>
            <ul className="notice">{pack.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>
          </div>}
        </details>
      </section>}
      </>}
      {coachPage&&<section id="study-coach" className="study-output" aria-labelledby="study-coach-title">
        <div className="coach">
          <h3 id="study-coach-title">Study Coach</h3>
          <form className="inline" onSubmit={event=>{event.preventDefault();send(chat);}}>
            <input aria-label="Ask about your plan" placeholder="Ask a question…" maxLength={500} value={chat} onChange={event=>setChat(event.target.value)}/>
            <button className="primary icon-btn" aria-label="Send chat message" disabled={!chat.trim()||coachPending}><Icon name="send"/></button>
          </form>
          <div ref={chatLog} className="messages" role="log" aria-label="Chat messages" tabIndex={0}>
            {Array.from({length:Math.ceil(messages.length/2)},(_,index)=>index*2).reverse().map(index=>
              <div className="coach-turn" key={index}>{messages.slice(index,index+2).map(message=>
                <div className="coach-message" key={message.role}>
                  <strong>{message.role}</strong>
                  {message.pending?<small role="status">Thinking…</small>:message.error?
                    <div className="coach-meta"><small role="alert">{message.error}</small>
                      <button type="button" className="link accent" disabled={coachPending} onClick={()=>retryCoach(message)}>Retry</button></div>
                    :<>{message.role==='You'?<p>{message.text}</p>:<CoachAnswer text={message.text}/>}
                      {message.generated&&<small>{message.references?.length?'AI-generated':'AI-generated · Not source-verified'}</small>}
                      {Boolean(message.references?.length)&&<details><summary>Sources ({message.references?.length})</summary>{message.references?.map(reference=>reference.kind==='uploaded'
                        ?<button key={reference.id} className="link accent source" onClick={()=>open(null,reference)}>{sourceLabel(reference)}</button>
                        :<a key={reference.id} className="link accent source" href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a>)}</details>}
                    </>}
                </div>)}</div>)}
          </div>
        </div>
      </section>}
    </main>
    <footer className="wrap footer"><nav aria-label="Product information"><button className="link" onClick={()=>open('pricing')}>Plans</button><button className="link" onClick={()=>open('privacy')}>Privacy</button><button className="link" onClick={()=>open('terms')}>Terms</button></nav></footer>
    <dialog ref={dialog} aria-labelledby="dialog-title" onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.close();}}><div className="dialog-content"><form method="dialog" className="dialog-close"><button className="icon-btn" aria-label="Close dialog"><Icon name="close"/></button></form>
      {source?<><h2 id="dialog-title">{source.file}</h2><p>{sampleMode?'Sample fixture · ':''}{source.file==='Pasted text'?source.number:documentLocation(source.file,source.page)+' · '+source.number}{source.file!=='Pasted text'&&source.method==='ocr'?' · OCR text':source.file!=='Pasted text'&&source.method==='manual'?' · Manually verified text':''}</p><blockquote>{source.excerpt}</blockquote>{sourceUrl&&<a className="link accent" target="_blank" rel="noopener noreferrer" href={originalDocumentLink(source.file,sourceUrl,source.page)}>{documentFormat(source.file)==='pdf'?'Open original PDF at page '+source.page:'Open original file'}</a>}</>:page==='pricing'?<Plans/>:page==='privacy'?<><h2 id="dialog-title">Privacy preview</h2><p>Original files stay in browser memory. In the study planner, extracted text and pasted text are sent to the analysis endpoint for scoring. This version keeps no saved sessions. Reloading clears the browser session.</p></>:<><h2 id="dialog-title">Terms preview</h2><p>Use materials you have permission to use. Use rankings as study guidance. No passing guarantee or university affiliation.</p></>}
    </div></dialog>
  </>;
}

function Plans() {
  return <>
    <h2 id="dialog-title">Plans</h2>
    <p><strong>Free preview</strong> · Study plans, source previews and contextual chat.</p>
    <p><strong>Planned Plus</strong> · ₹29 for 2 days, manually renewable.</p>
    <p>Purchases are unavailable in this preview.</p>
  </>;
}

const root=typeof document==='undefined'?null:document.getElementById('root');
if(root) {
  const appRoot=createRoot(root);
  void import('./live').then(({liveApi})=>appRoot.render(<App api={liveApi}/>)).catch(()=>{
    appRoot.render(<p role="alert">The study planner could not start. Refresh to retry.</p>);
  });
}

