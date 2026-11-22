import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { buildStudyPack, familiarityLabels, sourceLabel } from './study-pack';
import { DownloadStudyPack } from './study-output';
import { revise, revisionFromAnswer } from './revision';
import type { Revision } from './revision';
import { inspectStudyInput } from './study-input';
import { prepareScope } from './preparation-scope';
import { bookOutline, studySessionPrompt, studyTopic } from './study-book';
import type { BookPage } from './study-book';
import type { PreparationScope } from './preparation-scope';
import './style.css';

const sample = "My DBMS exam is tomorrow. I have 5 hours and need 40/100 to pass. Tell me what to prepare first.";
const empty:Context = {subject:'',date:'',minutes:0,pass:'',pattern:'',familiarity:'unknown'};
const preparationLabels={completed:'Checkpoints completed',revision:'Needs revision','in-progress':'In progress','not-started':'Not started'};
type Page = 'pricing'|'privacy'|'terms';
type PreparationMode = 'last-minute'|'study';
type BookContent = {text:string;references:CoachSource[];webLimited:boolean};
const studyTimes=[[5,'5 minutes'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour']] as const;

function practiceSeed(id:number,topic:string,answerSource?:Source):Question {
  return {id,topic,prompt:'What are the key points to remember about '+topic+'?',minutes:0,marks:0,unit:0,
    reason:'Based on your current study topic',answer:'',practiceSeed:true,answerSource,
    source:answerSource??{file:'',page:0,number:'',excerpt:''},sources:answerSource?[answerSource]:[]};
}
type CoachSource = (Source & {kind:'uploaded';id:string}) | {kind:'web';id:string;title:string;url:string};
type CoachRequest = {request:string;task:string;mode:'auto';topic?:string;subject:string;topics:string[];studyPage?:{title:string;text:string};
  history:{role:'user'|'assistant';content:string}[];sources:Source[];minutes:number};
type Message = {role:'You'|'Demo coach'|'in-nocent';text:string;references?:CoachSource[];
  generated?:boolean;pending?:boolean;error?:string;retry?:CoachRequest};

function Icon({name}:{name:'clip'|'send'|'spark'|'file'|'close'|'menu'}) {
  const paths = {
    menu:'M3 6h18M3 12h18M3 18h18',
    clip:'M21 11.5l-8.7 8.7a5 5 0 01-7.1-7.1l9.4-9.4a3.5 3.5 0 015 5l-9.4 9.4a2 2 0 01-2.8-2.8l8.7-8.7',
    send:'M3 11.5l18-8-7.5 18-3.2-7-7.3-3z M10.3 14.5L21 3.5',
    spark:'M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z',
    file:'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
    close:'M5 5l14 14M19 5L5 19'
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}

const StudyMarkdown=lazy(()=>import('./study-markdown'));

function CoachAnswer({text}:{text:string}) {
  return <Suspense fallback={<p role="status">Loading study content…</p>}><StudyMarkdown text={text}/></Suspense>;
}

function SourceStatus({references,openSource,generated=true}:{
  references:readonly CoachSource[];openSource:(source:Source)=>void;generated?:boolean;
}) {
  if(!generated&&!references.length)return null;
  return <div className="source-status">
    {generated&&<small>{references.length?'AI-generated':'AI-generated · Not source-verified'}</small>}
    {references.length>0&&<details><summary>Sources ({references.length})</summary>
      {references.map(reference=>reference.kind==='uploaded'
        ?<button key={reference.id} className="link accent source" onClick={()=>openSource(reference)}>{sourceLabel(reference)}</button>
        :<a key={reference.id} className="link accent source" href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a>)}
    </details>}
  </div>;
}

export function App({api=demoApi}:{api?:ExamApi}) {
  const theme = useTheme();
  const [characterPulse,setCharacterPulse]=useState(0);
  const [exampleMode,setExampleMode]=useState(false);
  const activeApi=exampleMode?demoApi:api;
  const sampleMode=activeApi===demoApi;
  const [mode,setMode]=useState<PreparationMode>('last-minute');
  const [drawerOpen,setDrawerOpen]=useState(false);
  const drawerToggle=useRef<HTMLButtonElement>(null);
  const drawerPanel=useRef<HTMLElement>(null);
  const [customTime,setCustomTime]=useState(false);
  const [savedBook,setBook]=useState<{subject:string;pages:BookPage[];demo:boolean;promptKey:string}|null>(null);
  const [bookIndex,setBookIndex]=useState(0);
  const [bookContent,setBookContent]=useState<Record<string,BookContent>>({});
  const [bookErrors,setBookErrors]=useState<Record<string,string>>({});
  const [loadingPage,setLoadingPage]=useState<string|null>(null);
  const bookRequest=useRef<AbortController|null>(null);
  const studyHeading=useRef<HTMLHeadingElement>(null);
  const [prompt,setPrompt]=useState('');
  const promptKey=studySessionPrompt(prompt);
  const book=savedBook?.promptKey===promptKey?savedBook:null;
  const activeBookPage=book?.pages[bookIndex];
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
  const questionsHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    if(!showQuestions)return;
    questionsHeading.current?.focus({preventScroll:true});
    questionsHeading.current?.scrollIntoView?.({block:'start'});
  },[showQuestions]);
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
  const [practiceUnavailable,setPracticeUnavailable]=useState<Record<number,boolean>>({});
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
  const chatTranscript=useRef<HTMLDivElement>(null);
  const followChat=useRef(true);
  const [showLatest,setShowLatest]=useState(false);
  const coachSection=useRef<HTMLElement>(null);
  function scrollChatToLatest(){
    followChat.current=true;
    if(chatLog.current)chatLog.current.scrollTop=chatLog.current.scrollHeight;
    setShowLatest(false);
  }
  useLayoutEffect(()=>{
    if(coachPage&&followChat.current)scrollChatToLatest();
  },[coachPage,messages]);
  useLayoutEffect(()=>{
    if(!coachPage||!chatTranscript.current||typeof ResizeObserver!=='function')return;
    const observer=new ResizeObserver(()=>{
      if(followChat.current)scrollChatToLatest();
    });
    observer.observe(chatTranscript.current);
    return ()=>observer.disconnect();
  },[coachPage]);
  useLayoutEffect(()=>{
    if(!coachPage)return;
    const viewport=window.visualViewport;
    const section=coachSection.current;
    if(!viewport||!section)return;
    // The mobile keyboard can shrink the visual viewport without resizing the layout viewport.
    const resize=()=>{
      const top=section.getBoundingClientRect().top+window.scrollY;
      section.style.setProperty('--coach-available-height',Math.max(140,viewport.height-top)+'px');
      if(followChat.current)scrollChatToLatest();
    };
    resize();
    viewport.addEventListener('resize',resize);
    return ()=>viewport.removeEventListener('resize',resize);
  },[coachPage]);
  const [chat,setChat]=useState('');
  const [coachPending,setCoachPending]=useState(false);
  const [coachPagePrompt,setCoachPagePrompt]=useState(false);
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
  const infoDialog=useRef<HTMLDialogElement>(null);
  const workspaceInput=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>()=>{controller.current?.abort();bookRequest.current?.abort();},[]);
  useEffect(()=>{
    if(!drawerOpen)return;
    drawerPanel.current?.querySelector('button')?.focus();
    const navigate=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setDrawerOpen(false);drawerToggle.current?.focus();return;}
      if(event.key!=='Tab')return;
      const buttons=drawerPanel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      const first=buttons?.[0],last=buttons?.[buttons.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    window.addEventListener('keydown',navigate);
    return ()=>window.removeEventListener('keydown',navigate);
  },[drawerOpen]);
  useEffect(()=>{
    if(mode!=='study'||coachPage||!activeBookPage)return;
    studyHeading.current?.focus({preventScroll:true});
    studyHeading.current?.scrollIntoView?.({block:'start'});
  },[activeBookPage,coachPage,mode]);
  useEffect(()=>{
    if(mode!=='study'||coachPage||!book||!activeBookPage||loadingPage||bookRequest.current
      ||bookContent[activeBookPage.id]||bookErrors[activeBookPage.id])return;
    const unit=activeBookPage;
    if(book.demo){
      const question=unit.questions[0];
      setBookContent(current=>({...current,[unit.id]:{text:question?.answer??unit.passages.map(source=>source.excerpt).join(' '),
        references:[],webLimited:false}}));
      return;
    }
    const operation=new AbortController();
    bookRequest.current=operation;
    setLoadingPage(unit.id);
    void (async()=>{
      try{
        const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.any([operation.signal,AbortSignal.timeout(50000)]),
          body:JSON.stringify({task:'notes',mode:'auto',studyUnit:true,subject:book.subject,topics:[unit.title],topic:unit.title,
            request:'Teach '+unit.title+' as one self-contained study-book section. Define the essentials, explain how they work, and include one useful example or recall prompt if supported.',
            priorities:unit.questions.map(question=>({topic:question.topic,prompt:question.prompt})),sources:unit.passages})});
        const data=await response.json() as {explanation?:string;code?:string;sources?:CoachSource[];webSearch?:{code:string}};
        if(!response.ok||!data.explanation?.trim())throw new Error(data.code==='usage_limit'?'The AI usage limit has been reached. Try this page again later.':'This page could not be generated. Try again.');
        if(!operation.signal.aborted)setBookContent(current=>({...current,[unit.id]:{text:data.explanation!,references:data.sources??[],webLimited:Boolean(data.webSearch&&data.webSearch.code!=='ok')}}));
      }catch(error){
        if(!operation.signal.aborted)setBookErrors(current=>({...current,[unit.id]:error instanceof Error&&error.name==='Error'?error.message:'This page could not be generated. Try again.'}));
      }finally{
        if(bookRequest.current===operation){bookRequest.current=null;setLoadingPage(null);}
      }
    })();
  },[activeBookPage,book,bookContent,bookErrors,coachPage,loadingPage,mode]);
  useEffect(()=>{
    const file=files.find(item=>item.id===source?.documentIndex)?.file;
    if(!file){setSourceUrl('');return;}
    const url=URL.createObjectURL(file);
    setSourceUrl(url);
    return ()=>URL.revokeObjectURL(url);
  },[files,source]);
  function clearBook(){
    bookRequest.current?.abort();bookRequest.current=null;setLoadingPage(null);
    setBook(null);setBookIndex(0);setBookContent({});setBookErrors({});
  }
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
    if(accepted.length){clearBook();setPlanGenerated(false);setAwaitReview(false);}
    setNotice(errors.length ? 'Could not attach ' + errors.join(', ') + '. Add up to 8 files of 20 MB each. Use PDF, DOCX, PPTX, PNG, JPEG, WebP, or BMP. Save older .ppt files as .pptx.' : '');
  };
  const editPrompt=(value:string)=>{setPrompt(value);const parsed=activeApi.parse(value);setContext(current=>({...parsed,minutes:parsed.minutes||current.minutes}));setNeedsTime(false);setNeedsSubject(false);setPlanGenerated(false);};
  const restartBudget=()=>{timeAnchor.current=Date.now();setElapsed(0);};
  const update=<K extends keyof Context,>(key:K,value:Context[K])=>{
    if(key==='minutes')restartBudget();
    if(key==='subject')clearBook();
    if(!sampleMode){practiceRun.current?.abort();setPracticePending(false);}
    setContext(current=>({...current,[key]:value}));
    if(!sampleMode||key!=='minutes'&&key!=='familiarity')setPlanGenerated(false);
  };
  async function generate(event?:FormEvent, adjusted=context,attempt:'normal'|'retry'|'continue'='normal') {
    event?.preventDefault();
    if(controller.current) return;
    if(!prompt.trim() && !files.length) {setNotice('Describe your exam or attach a file to begin.');return;}
    const studying=mode==='study';
    if(!studying&&!adjusted.minutes){setCustomTime(false);setNeedsTime(true);return;}
    if(studying)adjusted={...adjusted,minutes:0};
    setNeedsTime(false);setNeedsSubject(false);setNotice('');setBusy(true);
    const run=new AbortController();
    controller.current=run;
    setProcessingMessage(activeApi.prepare&&files.length?'Opening attachments…':'Building your plan…');
    try {
      let records=documents.filter(document=>files.some(file=>file.id===document.id));
      if(activeApi.prepare&&files.length&&(attempt==='retry'||files.some(file=>!records.some(document=>document.id===file.id)))){
        records=await activeApi.prepare(files,{records,signal:run.signal,retry:attempt==='retry',
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
        adjusted={...adjusted,subject:inspected.subject};setContext(current=>({...current,subject:inspected.subject}));
      }
      const requestedTopic=studying?studyTopic(prompt):'';
      const extracted=sampleMode?null:revise(requestedTopic?'':prompt,records,classified,adjusted.subject);
      const analysisKey=JSON.stringify([promptKey,classified.map(file=>[file.id,file.kind]),records]);
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
      if(!cached){
        if(!sampleMode)analyzed.current={key:analysisKey,analysis};
        practiceRun.current?.abort();setPracticePending(false);setPractice({});setPracticeUnavailable({});setQuestionAnswers({});
      }
      if(studying){
        const fallback=requestedTopic?[requestedTopic]:extracted?[extracted.title]:inspected.topics.length?inspected.topics:[adjusted.subject].filter(Boolean);
        const pages=bookOutline(analysis,fallback,extracted?.passages??[]);
        if(!pages.length){setNeedsSubject(true);return;}
        clearBook();
        setBook({subject:adjusted.subject||requestedTopic,pages,demo:sampleMode,promptKey});
        setResult(analysis.questions);setWarnings(analysis.warnings);
        setOptimization(analysis.optimization?{data:analysis.optimization}:null);
        setProgress(runProgress);
        setEditing(false);
        return;
      }
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
            else if(data.code==='citation_validation_failed')setNotice('The summary’s sources could not be verified. Try generating it again.');
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
      practiceRun.current?.abort();setPracticePending(false);
      setRevision(summary);setEditing(false);setShowQuestions(false);
      run.signal.throwIfAborted();
      setResult(analysis.questions);setWarnings(analysis.warnings);
      setOptimization(analysis.optimization?{data:analysis.optimization}:null);
      setPreparedScope(scope);setProgress(runProgress);restartBudget();setLimit(10);setPlanGenerated(true); }
    catch(error) { setNotice(run.signal.aborted?'Processing cancelled. Run again to resume from usable pages.':error instanceof Error?error.message:'The study plan could not load. Try again.'); }
    finally {controller.current=null;setProcessingMessage('');setBusy(false);}
  }
  const remainingTime=mode==='study'?0:Math.max(0,context.minutes-elapsed);
  const plan=useMemo(()=>{
    if(!optimization)return null;
    const {data}=optimization;
    const candidates=mode==='last-minute'&&!sampleMode&&preparedScope?data.candidates.filter(question=>preparedScope.questions.some(item=>item.id===question.id)):data.candidates;
    return makeLearningPlan(candidates,data.topics,remainingTime,context.pattern,context.familiarity,progress);
  },[optimization,preparedScope,mode,sampleMode,remainingTime,context.pattern,context.familiarity,progress]);
  const fitted=plan&&optimization
    ? plan.selectedQuestionIds.map(id=>optimization.data.candidates.find(question=>question.id===id)!)
    : fitQuestions(result ?? [],context.minutes);
  const visible=(remainingTime||context.minutes?fitted:result??[]).slice(0,limit);
  const summaryTopic=revision?.title&&revision.title!=='Key points'?revision.title:studyTopic(prompt)||context.subject||'this revision topic';
  const lastMinuteQuestions=preparedScope?.questions.length?preparedScope.questions:
    planGenerated?[practiceSeed(2000,summaryTopic,revision?.passages[0])]:[];
  const bookQuestions=activeBookPage?(activeBookPage.questions.length?activeBookPage.questions:
    [practiceSeed(3000+bookIndex,activeBookPage.title,activeBookPage.passages[0])]):[];
  const availableQuestions=(questions:readonly Question[])=>questions.flatMap(question=>
    practice[question.id]?[{...question,prompt:practice[question.id]}]:
      practiceUnavailable[question.id]?[{...question,prompt:practiceSeed(question.id,question.topic).prompt}]:
      !question.practiceSeed||sampleMode?[question]:[]);
  const questionList=!sampleMode?availableQuestions(lastMinuteQuestions):visible.length?visible:(result??[]).slice(0,limit);
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
    followChat.current=true;
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
    const unit=mode==='study'&&activeBookPage&&(coachPagePrompt||/\b(?:this|the current) (?:page|chapter|section)\b/i.test(text))?activeBookPage:null;
    setCoachPagePrompt(false);
    const candidates=[...(unit?.passages??[]),selected?.answerSource,...(unit?[]:retrieved),...(revision?.passages??[]),...fitted.map(question=>question.answerSource)]
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
      topic:unit?.title??selected?.topic,subject:context.subject||book?.subject||'',topics,
      studyPage:unit?{title:unit.title,text:bookContent[unit.id]?.text.slice(0,1400)??''}:undefined,
      history:history.slice(-6),sources,minutes:remainingTime});
  }
  function retryCoach(message:Message) {
    if(!message.retry||activeCoachRequest.current)return;
    const pending:Message={role:message.role,text:'',pending:true};
    setMessages(current=>current.map(item=>item===message?pending:item));
    void askCoach(pending,message.retry);
  }
  function open(next:Page|null, reference:Source|null=null){setPage(next);setSource(reference);dialog.current?.showModal();}
  function reset(){clearBook();practiceRun.current?.abort();analyzed.current=null;setPreparedScope(null);setQuestionAnswers({});activeCoachRequest.current?.abort();activeCoachRequest.current=null;setCoachPending(false);setExampleMode(false);setResult(null);setOptimization(null);setProgress({});restartBudget();setWarnings([]);setMessages([]);setFiles([]);setDocuments([]);setAwaitReview(false);setPrompt('');setContext(empty);setNeedsTime(false);setNeedsSubject(false);setNotice('');setTimeReply('');setSubjectReply('');setPlanGenerated(false);}
  function toggleExample(){setResult(null);setOptimization(null);setProgress({});restartBudget();setWarnings([]);setAwaitReview(false);analyzed.current=null;setPreparedScope(null);setExampleMode(!exampleMode);editPrompt(exampleMode?'':sample);}
  function modifyFile(id:number,kind?:string) {
    clearBook();
    setFiles(current=>kind?current.map(file=>file.id===id?{...file,kind,kindOverride:true}:file):current.filter(file=>file.id!==id));
    if(!kind)setDocuments(current=>current.filter(document=>document.id!==id));
    setAwaitReview(false);setPlanGenerated(false);
  }
  function verifyPage(id:number,number:number,text:string){
    clearBook();
    const kind=files.find(file=>file.id===id)?.kind;
    setDocuments(current=>current.map(document=>document.id!==id?document:{...document,pages:document.pages.map(page=>page.number!==number?page:{
      ...page,text:text.trim(),status:'verified',method:'manual',questions:countQuestions(text,kind==='Past paper'),reason:''})}));
    setPlanGenerated(false);
  }
  function changeCheckpoint(questionId:number,id:string,status:CheckpointState){
    if(status==='completed'&&progress[questionId]?.[id]!=='completed') setCharacterPulse(value=>value+1);
    setProgress(current=>({...current,[questionId]:{...current[questionId],[id]:status}}));
    if(mode==='last-minute')setElapsed(Math.max(0,Math.floor((Date.now()-timeAnchor.current)/60000)));
  }
  async function revealQuestions(){
    setShowQuestions(true);
    await preparePractice(lastMinuteQuestions);
  }
  async function preparePractice(questions:readonly Question[],retry=false){
    if(sampleMode||practiceRun.current)return;
    const candidates=questions.filter(question=>!practice[question.id]&&(retry||!practiceUnavailable[question.id])&&question.practiceSeed&&!question.historical&&
      !question.historicalFrequency&&!(question.sources??[question.source]).some(source=>files.some(file=>file.id===source.documentIndex&&file.kind==='Past paper')));
    if(!candidates.length)return;
    const operation=new AbortController();
    practiceRun.current=operation;
    setPracticePending(true);
    let generated:Record<number,string>={};
    try{
      const r=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
        signal:AbortSignal.any([operation.signal,AbortSignal.timeout(20000)]),
        body:JSON.stringify({task:'practice',priorities:candidates.map(({id,topic,prompt})=>({id,topic,prompt}))})});
      const data=await r.json() as {questions?:{id:number;prompt:string}[]};
      if(r.ok&&Array.isArray(data.questions)&&!operation.signal.aborted){
        const allowed=new Set(candidates.map(question=>question.id));
        const key=(value:string)=>value.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
        const used=new Set(questions.filter(question=>!allowed.has(question.id)).map(question=>key(question.prompt)));
        generated=Object.fromEntries(data.questions.flatMap(question=>{
          if(!allowed.has(question.id)||typeof question.prompt!=='string'||used.has(key(question.prompt)))return [];
          used.add(key(question.prompt));return [[question.id,question.prompt]];
        }));
      }
    }catch{/* The recall questions remain available when AI practice fails. */}
    finally{
      if(practiceRun.current===operation){
        practiceRun.current=null;setPracticePending(false);
        if(!operation.signal.aborted){
          setPractice(current=>({...current,...generated}));
          setPracticeUnavailable(current=>({...current,...Object.fromEntries(candidates.map(question=>[question.id,!generated[question.id]]))}));
        }
      }
    }
  }
  async function loadQuestionAnswer(question:Question,key:string){
    if(pendingAnswers.current.has(key)||questionAnswers[key]?.text)return;
    pendingAnswers.current.add(key);
    setQuestionAnswers(current=>({...current,[key]:{pending:true}}));
    try{
      const references=mode==='study'&&activeBookPage?bookContent[activeBookPage.id]?.references??[]:aiReferences;
      const sources=question.answerSource?[question.answerSource]:references.filter(reference=>reference.kind==='uploaded').slice(0,3);
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
    const allocation=mode==='study'?0:shortReview?reviewAllocations[q.id]:(sampleMode||plannedIds.has(q.id)?effort?.minutes??q.minutes:0);
    const answerKey=JSON.stringify([context.subject,q.prompt,q.answerSource??null,q.sources??[q.source]]);
    const answer=questionAnswers[answerKey];
    const evidence=q.sources??[q.source];
    const availableEvidence=evidence.filter(reference=>reference.file);
    const kind=q.historical?'Previous-Year Question':evidence.some(source=>files.some(file=>file.id===source.documentIndex&&file.kind==='Past paper'))
      ?'Uploaded past-paper question':practice[q.id]?'AI-Generated Practice Question':q.practiceSeed?'Recall practice':'Practice question';
    return <article className="question" key={q.id}>
      <header className="question-meta">{index!==undefined&&<span>#{index+1}</span>}{allocation>0&&<span>{allocation} min</span>}</header>
      <h3>{q.prompt}</h3>
      <details className="question-answer" onToggle={event=>{if(!sampleMode&&event.currentTarget.open&&!answer)void loadQuestionAnswer(q,answerKey);}}>
        <summary>View Answer ↓</summary>
        {sampleMode&&<CoachAnswer text={q.answer}/>}
        {answer?.pending&&<p role="status">Preparing answer…</p>}
        {answer?.error&&<><p>Couldn’t verify an answer right now. {q.answerSource?'You can still read the matching passage.':''}</p>
          <button className="link accent" onClick={()=>void loadQuestionAnswer(q,answerKey)}>Retry</button>
          {q.answerSource&&<button className="link accent" onClick={()=>open(null,q.answerSource!)}>{sourceLabel(q.answerSource)}</button>}</>}
        {answer?.text&&<><CoachAnswer text={answer.text}/>
          <SourceStatus references={answer.references??[]} generated={answer.generated} openSource={reference=>open(null,reference)}/></>}
      </details>
      <details className="question-info">
        <summary aria-label="Question information">ⓘ</summary>
        <div className="question-detail">
          <p>{kind}{q.examYears?.length?' · '+q.examYears.join(', '):''}{q.historicalFrequency?' · '+q.historicalFrequency+' recorded appearances'+(q.historicalPaperCount?' across '+q.historicalPaperCount+' papers':''):''}</p>
          <p>{q.topic}{q.unit?' · Unit '+q.unit:''}{q.marks?' · '+q.marks+' marks':''}</p>
          <p>{q.reason}</p>
          {shortReview&&<p>Use this allocation to review the method. A full answer takes longer.</p>}
          {effort&&<p>Remaining estimate: {effort.remaining.understanding} min understanding, {effort.remaining.practice} min practice, {effort.remaining.recall} min recall.</p>}
          {Boolean(q.learning?.prerequisites.length)&&<p>Syllabus prerequisites: {q.learning?.prerequisites.join(', ')}.</p>}
          {availableEvidence.length>0&&<details><summary>Question evidence ({availableEvidence.length})</summary>
            {availableEvidence.map((reference,i)=><button key={i} className="link accent source" onClick={()=>open(null,reference)}>{sourceLabel(reference)}</button>)}
          </details>}
        </div>
      </details>
      {effort&&q.learning&&<details className="checkpoints">
        <summary>Practice recall</summary>
        <p>{q.learning.type} · {preparationLabels[effort.status]} · {effort.completed}/{effort.total} checkpoints</p>
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
  function openWorkspace(coach:boolean){
    const hash=coach?'#study-coach':'#main';
    if(location.hash!==hash)history.pushState(null,'',hash);
    setCoachPage(coach);
    if(drawerOpen)drawerToggle.current?.focus();
    setDrawerOpen(false);
    setCoachPagePrompt(false);
  }
  function selectMode(next:PreparationMode){
    if(next!==mode){
      if(next==='last-minute')timeAnchor.current=Date.now()-elapsed*60000;
      else if(planGenerated)setElapsed(Math.max(0,Math.floor((Date.now()-timeAnchor.current)/60000)));
      setMode(next);setNotice('');setNeedsTime(false);setNeedsSubject(false);
    }
    openWorkspace(false);
  }
  function openBookPage(index:number){
    setBookIndex(index);selectMode('study');
  }
  function submitTime(minutes:number){
    if(!Number.isSafeInteger(minutes)||minutes<=0||minutes>525600){setNotice('Enter study time in minutes or hours.');return;}
    const adjusted={...context,minutes};
    setContext(adjusted);
    void generate(undefined,adjusted,'continue');
  }
  const hasContext=Boolean(prompt.trim() || files.length);
  const workspaceResult=mode==='study'?Boolean(book&&activeBookPage):Boolean(result&&planGenerated);
  const composerCollapsed=workspaceResult&&!editing&&!busy;
  useEffect(()=>{
    if(editing&&!coachPage)workspaceInput.current?.focus();
  },[editing,coachPage]);
  const reviewDocuments=documents.filter(document=>!documentComplete(document));
  const reviewCount=reviewDocuments.reduce((sum,document)=>sum+Math.max(0,(document.total??0)-document.pages.filter(isTrusted).length),0);
  const allReviewPages=reviewCount>0&&reviewDocuments.every(document=>document.name.toLowerCase().endsWith('.pdf')&&document.total!==null);
  const reviewLabel=reviewDocuments.some(document=>document.total===null)?'Check unreadable files':
    reviewCount+' '+(allReviewPages?'page':'part')+(reviewCount===1?' needs':'s need')+' review';
  const activeBookContent=activeBookPage?bookContent[activeBookPage.id]:undefined;
  const studyPageQuestions=availableQuestions(bookQuestions);
  function practiceRetry(questions:readonly Question[]){
    if(practicePending||!questions.some(question=>practiceUnavailable[question.id]&&!practice[question.id]))return null;
    return <p className="notice">AI practice questions are unavailable. You can use the recall questions below.{' '}
      <button type="button" className="link accent" onClick={()=>void preparePractice(questions,true)}>Retry AI questions</button>
    </p>;
  }
  const modeButtons=(label:string)=><nav className="preparation-modes" aria-label={label}>
    <button type="button" aria-pressed={mode==='last-minute'&&!coachPage} onClick={()=>selectMode('last-minute')}>Last Minute</button>
    <button type="button" aria-pressed={mode==='study'&&!coachPage} onClick={()=>selectMode('study')}>Study</button>
  </nav>;
  return <>
    <header className="top"><div className="wrap header-inner">
      <div className="book-brand"><button ref={drawerToggle} type="button" className="icon-btn" aria-label="Study navigation" aria-controls="study-drawer" aria-expanded={drawerOpen} onClick={()=>setDrawerOpen(open=>!open)}><Icon name="menu"/></button>
      <a className="brand" href="#main" aria-label="in-nocent home"><span className="brand-mark"><Icon name="spark"/></span>in-nocent<span className="brand-dot">.</span></a></div>
      <div className="header-tools"><ThemePicker {...theme}/>
        <button type="button" className="icon-btn" aria-label="Study information" onClick={()=>infoDialog.current?.showModal()}>ⓘ</button>
      </div>
      <nav aria-label="Workspace"><a className="link" href={coachPage?'#main':'#study-coach'} onClick={event=>{
        event.preventDefault();
        openWorkspace(!coachPage);
      }}>{coachPage?'Study workspace':'Study Coach'}</a></nav>
    </div></header>
    {drawerOpen&&<button type="button" className="drawer-backdrop" aria-label="Close study navigation" tabIndex={-1} onClick={()=>{setDrawerOpen(false);drawerToggle.current?.focus();}}/>}
    <aside ref={drawerPanel} id="study-drawer" className="study-drawer" hidden={!drawerOpen} aria-label="Study navigation">
      <div className="drawer-top"><strong>Study workspace</strong><button type="button" className="icon-btn" aria-label="Close navigation" onClick={()=>{setDrawerOpen(false);drawerToggle.current?.focus();}}><Icon name="close"/></button></div>
      {modeButtons('Preparation modes in navigation')}
      {(context.subject||book?.subject)&&<div className="drawer-exam"><small>Current examination</small><p>{context.subject||book?.subject}{context.minutes?' · '+context.minutes+' min':''}</p></div>}
      {book&&<nav aria-label="Table of contents"><h2>Contents</h2><ol>
        {book.pages.map((unit,index)=><li key={unit.id}><button type="button" aria-current={mode==='study'&&!coachPage&&bookIndex===index?'page':undefined} onClick={()=>openBookPage(index)}>
          <span>{index+1}</span>{unit.title}</button></li>)}
      </ol></nav>}
      <button type="button" className="link accent drawer-coach" onClick={()=>openWorkspace(true)}>Study Coach</button>
    </aside>
    <main id="main" className={'wrap '+(coachPage?'coach-workspace':workspaceResult?'workspace':'landing')}>
      {!coachPage&&<>
      {modeButtons('Preparation mode')}
      {!workspaceResult&&<ThemeHero {...theme}/>}
      <div className="exam-overview">
        {(context.subject||book?.subject||context.minutes>0)&&<p className="summary">{[context.subject||book?.subject,context.minutes?context.minutes+' min available':''].filter(Boolean).join(' · ')}</p>}
        {!busy&&reviewDocuments.length>0&&<button className="link review-notice" onClick={()=>infoDialog.current?.showModal()}>⚠ {reviewLabel}</button>}
        {!busy&&!reviewDocuments.length&&warnings.some(warning=>warning.startsWith('OCR-only'))&&<button className="link review-notice" onClick={()=>infoDialog.current?.showModal()}>⚠ OCR evidence needs review</button>}
        {workspaceResult&&<details className="submitted-input">
          <summary>Your input</summary>
          {prompt.trim()&&<p>{prompt}</p>}
          {files.length>0&&<ul>{files.map(file=><li key={file.id}>{file.file.name}</li>)}</ul>}
        </details>}
      </div>
      {mode==='last-minute' && result && planGenerated && <section className="results" aria-labelledby="results-title">
        <div className="study-heading">{theme.anime&&theme.character&&<StudyCharacter anime={theme.anime} character={theme.character} pulse={characterPulse}/>}<h2 id="results-title" ref={resultHeading} tabIndex={-1}>Must Read</h2></div>
        {aiNote?<article className="study-note" aria-label="Revision notes">
          <CoachAnswer text={aiNote}/>
          <SourceStatus references={aiReferences} openSource={reference=>open(null,reference)}/>
        </article>:sampleMode&&revision&&<article className="study-note" aria-label="Revision notes">
          <h3>{revision.title}</h3>{revision.passages.map((source,index)=><p key={index}>{source.excerpt}</p>)}
          <details><summary>Show answer</summary><p>{revision.answer}</p></details>
        </article>}
        {nextAction&&<p className="notice"><strong>Start here:</strong> {nextAction.title} · {nextAction.minutes} min</p>}

        {!showQuestions&&<button className="primary" onClick={()=>void revealQuestions()}>Generate Questions</button>}
        {showQuestions&&<section className="results-questions" aria-labelledby="important-questions">
          {showQuestions&&<h3 id="important-questions" ref={questionsHeading} tabIndex={-1}>Important Questions</h3>}
          {showQuestions&&practicePending&&<p role="status">Preparing practice questions…</p>}

          {showQuestions&&questionsOutsideBudget&&<p>These questions are available for reference. None fits the remaining preparation budget.</p>}
          {showQuestions&&practiceRetry(lastMinuteQuestions)}
          {showQuestions&&questionList.map((question,index)=>renderQuestion(question,index))}
          {showQuestions&&!practicePending&&!questionList.length&&revision&&<article className="question">
            <h3>{revision.recall}</h3>
            <details className="question-answer"><summary>View Answer ↓</summary><p>{revision.answer}</p>
              <details><summary>Sources (1)</summary><button className="link accent" onClick={()=>open(null,revision.passages[0])}>{sourceLabel(revision.passages[0])}</button></details>
            </details>
          </article>}
          {showQuestions&&!practicePending&&!questionList.length&&!revision&&<p>No reliable questions are available for these topics yet.</p>}
          {sampleMode&&showQuestions&&limit<fitted.length && <button className="secondary" onClick={()=>setLimit(current=>current+10)}>Show next 10</button>}
          {showQuestions&&tracked.length>0&&<details className="coverage"><summary>Revisit checkpoint progress ({tracked.length})</summary>{tracked.map(question=>renderQuestion(question))}</details>}
        </section>}
      </section>}
      {mode==='study'&&book&&activeBookPage&&<section className="study-book" aria-labelledby="book-page-title">
        <header className="book-page-header">
          <h2 id="book-page-title" tabIndex={-1} ref={studyHeading}>{activeBookPage.title}</h2>
        </header>
        {bookErrors[activeBookPage.id]?<div className="book-page-feedback"><p role="alert">{bookErrors[activeBookPage.id]}</p>
          <button type="button" className="secondary" onClick={()=>setBookErrors(current=>{const next={...current};delete next[activeBookPage.id];return next;})}>Retry page</button>
        </div>:activeBookContent?<article className="book-content" aria-label="Study page content">
          <CoachAnswer text={activeBookContent.text}/>
          {book.demo?<small>Demo</small>:<SourceStatus references={activeBookContent.references} openSource={reference=>open(null,reference)}/>}
          {bookQuestions.length>0&&<details key={activeBookPage.id} onToggle={event=>{if(event.currentTarget.open)void preparePractice(bookQuestions);}}>
            <summary>Generate Questions</summary>
            {practiceRetry(bookQuestions)}
            {studyPageQuestions.map((question,index)=>renderQuestion(question,index))}
            {practicePending&&<p role="status">Preparing practice questions…</p>}
            {!practicePending&&!studyPageQuestions.length&&<p>No reliable practice questions are available for this page.</p>}
          </details>}
          <button type="button" className="link accent" onClick={()=>{openWorkspace(true);setCoachPagePrompt(true);}}>Ask Study Coach about this page</button>
        </article>:<p role="status" className="book-page-feedback">Preparing this page…</p>}
        <nav className="book-pagination" aria-label="Study pages">
          <button type="button" className="secondary" disabled={bookIndex===0} onClick={()=>openBookPage(bookIndex-1)}>← Previous</button>
          <span className="book-page-number">Page {bookIndex+1} of {book.pages.length}</span>
          <button type="button" className="secondary" disabled={bookIndex+1===book.pages.length} onClick={()=>openBookPage(bookIndex+1)}>Next →</button>
        </nav>
      </section>}
      <section aria-label="Exam setup" className={'setup '+(composerCollapsed?'setup-collapsed':'')}>
        {composerCollapsed?<button type="button" className="secondary" onClick={()=>setEditing(true)}>Edit input</button>:<>
        <form onSubmit={event=>{if(workspaceResult){event.preventDefault();setEditing(false);return;}void generate(event);}} className={'composer '+(dragging?'dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);attachment(e.dataTransfer.files);}}>
          <label htmlFor="prompt">Paste notes or add a file</label>
          <textarea ref={workspaceInput} id="prompt" value={prompt} disabled={busy} onChange={e=>editPrompt(e.target.value)} placeholder="Paste a passage, or describe what you want to revise" rows={3} maxLength={8000}/>
          {files.length>0 && <ul className="files">{files.map(item=><li key={item.id}><Icon name="file"/><span title={item.file.name}>{item.file.name}</span><select disabled={busy} aria-label={'Type for '+item.file.name} value={item.kind} onChange={e=>modifyFile(item.id,e.target.value)}>{['Unclassified','Syllabus','Past paper','Notes','Administrative','Unreadable'].map(k=><option key={k}>{k}</option>)}</select><button disabled={busy} type="button" className="icon-btn" aria-label={'Remove '+item.file.name} onClick={()=>modifyFile(item.id)}><Icon name="close"/></button></li>)}</ul>}
          <div className="composer-actions">
            <input hidden ref={input} type="file" accept={acceptedDocuments} multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>{attachment(e.target.files);e.target.value='';}}/>
            <button className="secondary" type="button" disabled={busy} onClick={()=>input.current?.click()}><Icon name="clip"/> Attach files</button>
            <button className="primary" disabled={busy} type="submit">{workspaceResult?(mode==='study'?'Open study page ↓':'Summary generated ↓'):mode==='study'?(busy?'Preparing your book…':'Start Study'):busy?'Generating summary…':'Generate Summary'}</button>
          </div>
        </form>
        </>}
        {notice && <p role="alert" className="notice">{notice}</p>}
        {!composerCollapsed&&hasContext && <details><summary>Edit details</summary><fieldset className="context" disabled={busy}><legend>Plan settings</legend>
          <label>Exam<input value={context.subject} placeholder="Subject" onChange={e=>update('subject',e.target.value)}/></label>
          <label>Date<input value={context.date} placeholder="Exam date" onChange={e=>update('date',e.target.value)}/></label>
          {mode==='last-minute'&&<label>Minutes<input type="number" min="0" max="525600" value={context.minutes||''} placeholder="Study time" onChange={e=>{update('minutes',Math.max(0,Math.min(525600,Math.floor(Number(e.target.value)))));setPlanGenerated(false);}}/></label>}
          <label>Pass mark<input value={context.pass} placeholder="Optional" onChange={e=>update('pass',e.target.value)}/></label>
          <label>Paper rules<input value={context.pattern} placeholder="Optional" onChange={e=>update('pattern',e.target.value)}/></label>
          {context.familiarity!=='unknown'&&<span className="file-count">{familiarityLabels[context.familiarity]}</span>}
        </fieldset></details>}
        {mode==='last-minute'&&needsTime&&<section className="followup" aria-labelledby="time-question">
          <h3 id="time-question">How much time do you have to prepare?</h3>
          <div className="quick-times">{studyTimes.map(([minutes,label])=><button type="button" className="secondary" key={minutes} onClick={()=>submitTime(minutes)}>{label}</button>)}
            <button type="button" className="secondary" onClick={()=>setCustomTime(true)}>Custom</button></div>
          {customTime&&<form className="inline" onSubmit={event=>{event.preventDefault();submitTime(duration(timeReply)||(/^\d+$/.test(timeReply.trim())?Number(timeReply):0));}}>
            <label htmlFor="time" className="sr-only">Custom study time</label>
            <input autoFocus id="time" value={timeReply} onChange={event=>setTimeReply(event.target.value)} placeholder="e.g. 45 minutes"/>
            <button className="primary">Continue</button>
          </form>}
        </section>}
        {needsSubject&&<form className="followup" onSubmit={event=>{event.preventDefault();if(!subjectReply.trim())return;const adjusted={...context,subject:subjectReply.trim()};setContext(adjusted);void generate(undefined,adjusted,documents.length?'continue':'normal');}}>
          <label htmlFor="summary-subject">What subject should I summarize?</label>
          <div className="inline"><input id="summary-subject" value={subjectReply} maxLength={100} onChange={event=>setSubjectReply(event.target.value)}/><button className="primary" disabled={!subjectReply.trim()}>Continue</button></div>
        </form>}
        {busy && <div className="processing-status"><p role="status" className="notice">{sampleMode?'Loading sample questions…':processingMessage}</p>
          {!sampleMode&&<button className="secondary" type="button" onClick={()=>controller.current?.abort()}>Cancel processing</button>}
        </div>}
        {!busy&&!sampleMode&&awaitReview&&<button className="secondary" onClick={()=>void generate(undefined,context,'retry')}>Retry unread files</button>}
      </section>
      </>}
      {coachPage&&<section ref={coachSection} id="study-coach" className="coach" aria-labelledby="study-coach-title">
        <header><h1 id="study-coach-title">Study Coach</h1>
          {coachPagePrompt&&activeBookPage&&<p className="coach-page-topic">{activeBookPage.title}</p>}
        </header>
        <div className="chat-area">
          <div ref={chatLog} className="messages" role="log" aria-label="Chat messages" tabIndex={0} onScroll={event=>{
            const log=event.currentTarget;
            followChat.current=log.scrollHeight-log.scrollTop-log.clientHeight<60;
            setShowLatest(!followChat.current);
          }}>
            <div ref={chatTranscript}>
            {Array.from({length:Math.ceil(messages.length/2)},(_,index)=>index*2).map(index=>
              <div className="coach-turn" key={index}>{messages.slice(index,index+2).map(message=>
                <div className={'coach-message '+(message.role==='You'?'coach-user':'coach-reply')} key={message.role}>
                  <span className="sr-only">{message.role}</span>
                  {message.pending?<small role="status">Thinking…</small>:message.error?
                    <div className="coach-meta"><small role="alert">{message.error}</small>
                      <button type="button" className="link accent" disabled={coachPending} onClick={()=>retryCoach(message)}>Retry</button></div>
                    :message.role==='You'?<p>{message.text}</p>:<><CoachAnswer text={message.text}/>
                      <SourceStatus references={message.references??[]} generated={Boolean(message.generated)} openSource={reference=>open(null,reference)}/>
                    </>}
                </div>)}</div>)}
            </div>
          </div>
          {showLatest&&<button type="button" className="secondary jump-latest" onClick={scrollChatToLatest}>Latest ↓</button>}
        </div>
        <form className="inline coach-composer" onSubmit={event=>{event.preventDefault();send(chat);}}>
          <input aria-label="Ask about your plan" placeholder="Ask a question…" maxLength={500} value={chat} onChange={event=>setChat(event.target.value)}/>
          <button className="primary icon-btn" aria-label="Send chat message" disabled={!chat.trim()||coachPending}><Icon name="send"/></button>
        </form>
      </section>}
    </main>
    {!coachPage&&<footer className="wrap footer"><nav aria-label="Product information"><button className="link" onClick={()=>open('pricing')}>Plans</button><button className="link" onClick={()=>open('privacy')}>Privacy</button><button className="link" onClick={()=>open('terms')}>Terms</button></nav></footer>}
    <dialog ref={infoDialog} aria-labelledby="study-info-title" onClick={event=>{if(event.target===event.currentTarget)event.currentTarget.close();}}>
      <div className="dialog-content info-content">
        <div className="info-heading"><h2 id="study-info-title">Study information</h2>
          <form method="dialog"><button className="icon-btn" aria-label="Close study information"><Icon name="close"/></button></form>
        </div>
        {workspaceResult&&mode==='last-minute'&&<div className="study-actions">
          <DownloadStudyPack pack={pack}/><button className="secondary" disabled={busy} onClick={()=>{infoDialog.current?.close();reset();}}>Start over</button>
        </div>}
        {mode==='last-minute'&&workspaceResult&&pack.timeline.length>0&&<details><summary>Time breakdown</summary><ol className="study-timeline">
          {pack.timeline.map((item,index)=><li key={index}>{item.title} <strong>{item.minutes} min</strong></li>)}
        </ol></details>}
        {workspaceResult&&pack.warnings.length>0&&<details><summary>Sources and coverage</summary>
          <ul>{pack.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>
        </details>}
        {(aiNote||activeBookContent)&&<section>
          <h3>Source verification</h3>
          <p>Sources links to the uploaded passages or web references used in an answer. Unverified explanations are labeled beside the study content.</p>
          {(mode==='study'?activeBookContent?.webLimited:summaryWebLimited)&&<p>Web sources were unavailable for this result.</p>}
        </section>}
        {!sampleMode&&activeApi.prepare&&documents.length>0&&<DocumentReview documents={documents} files={files} busy={busy} onVerify={verifyPage}/>}
        {!coachPage&&<button className="link accent" type="button" disabled={busy} onClick={()=>{infoDialog.current?.close();toggleExample();}}>{exampleMode?'Exit demo':'Try an example'}</button>}
        {sampleMode?<p>Demo · Sample DBMS data</p>:<p>Original files stay on this device. Extracted text is sent for analysis.</p>}
      </div>
    </dialog>
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

