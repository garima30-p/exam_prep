import {academicOutline} from '../server/academic-sources.mjs';
import type {TopicOutline} from './study-book';
import type {ReactNode} from 'react';
import {warmEmbeddings} from './embeddings';
import {readStudyEvents} from '../server/study-stream.mjs';
import {browserTiming,now} from '../server/performance.mjs';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { demoApi, duration, materialType } from './api';
import type { Analysis, Context, ExamApi, Material, Question, Source } from './api';
import { countQuestions } from '../server/page-text.mjs';
import { documentComplete, isTrusted } from './document-state';
import type { ExtractedDocument } from './document-state';
import { DocumentReview } from './document-review';
import { acceptedDocuments, documentFormat, documentLocation, originalDocumentLink } from './document-formats';
import { StudyCharacter, ThemeHero, ThemePicker, useTheme } from './themes';
import { sourceLabel } from './study-pack';
import type { StudyPack } from './study-pack';
import { DownloadStudyPack } from './study-output';
import { revise } from './revision';
import { inspectStudyInput } from './study-input';
import { bookOutline, learningSubject, studySessionPrompt, studyTopic } from './study-book';
import type { BookPage } from './study-book';
import { ReviewForm, reviewItems } from './learning-review';
import type { ReviewAttempt, ReviewItem } from './learning-review';
import { usePractice } from './practice';
import type { AcademicResult, LearningSource, PracticeItem, PracticeTopic } from './practice';
import { PracticeQuestions, SolvedExample } from './practice-panel';
import './style.css';

const subjectKey=(label:string)=>(learningSubject(label)||label).toLowerCase();
const documentKinds=['Unclassified','Syllabus','Past paper','Notes','Administrative','Unreadable'];
const empty:Context = {subject:'',date:'',minutes:0,pass:'',pattern:'',familiarity:'unknown'};
type Page = 'pricing'|'privacy'|'terms';
type PreparationMode = 'last-minute'|'study';
type BookContent = {text:string;references:CoachSource[];webLimited:boolean;excerpt?:boolean};
type Discussion = {title:string;text:string;sources:readonly Source[];question?:PracticeItem;pageId?:string};

type CoachSource=LearningSource;
type CoachRequest = {request:string;task:string;mode:'auto';topic?:string;subject:string;topics:string[];studyPage?:{title:string;text:string};
  activeQuestion?:string;preparationMode:PreparationMode;
  university?:string;academicGrounding?:boolean;
  history:{role:'user'|'assistant';content:string}[];sources:Source[];minutes:number};
type Message = {role:'You'|'in-nocent';text:string;references?:CoachSource[];inline?:boolean;
  generated?:boolean;pending?:boolean;status?:boolean;error?:string;retry?:CoachRequest;offer?:{topic:PracticeTopic;count:number;format:string}};

// Keep the complete question and newest context within the Worker's byte limit.
function coachRequestBody(request:CoachRequest) {
  const bounded={...request,history:[...request.history],sources:[...request.sources],stream:request.task==='chat'};
  const encoder=new TextEncoder();
  let body=JSON.stringify(bounded);
  while(encoder.encode(body).length>18000&&(bounded.history.length||bounded.sources.length)){
    if(bounded.history.length>2||!bounded.sources.length)bounded.history.splice(0,2);
    else bounded.sources.pop();
    body=JSON.stringify(bounded);
  }
  if(encoder.encode(body).length>18000)throw new Error('This message is too long to send. Shorten it and try again.');
  return body;
}

function topicPriorityLabel(page:BookPage){
  return page.priority+' priority'+(page.provisionalPriority?' (provisional)':'');
}

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

const loadStudyMarkdown=()=>import('./study-markdown');
const StudyMarkdown=lazy(loadStudyMarkdown);

function CoachAnswer({text}:{text:string}) {
  return <Suspense fallback={<p role="status">Loading study content…</p>}><StudyMarkdown text={text}/></Suspense>;
}

function SourceStatus({references,openSource,generated=true}:{
  references:readonly CoachSource[];openSource:(source:Source)=>void;generated?:boolean;
}) {
  if(!generated&&!references.length)return null;
  return <div className="source-status">
    {generated&&<small>{references.length?'AI-generated explanation':'AI-generated · Not source-verified'}</small>}
    {references.length>0&&<details><summary>Sources ↗ ({references.length})</summary>
      <ul className="source-references">{references.map(reference=><li key={reference.id}>
        {reference.kind==='uploaded'?<>
          <button className="link accent source" onClick={()=>openSource(reference)}>{sourceLabel(reference)}</button>
          <small>{reference.documentType?'Uploaded '+reference.documentType.toLowerCase():'Student-provided material'}
            {reference.method==='ocr'?' · OCR text, check against the original':''}</small>
        </>:<>
          <a className="link accent source" href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a>
          <small>{[reference.publisher,reference.category==='official-syllabus'?'Official university syllabus':reference.category==='official-pyq'
            ?'Official university PYQ':'Academic reference',reference.status==='page-inspected'?'Page inspected':reference.status==='provider-page-text'
            ?'Page text supplied by retrieval':reference.status==='provider-excerpt'?'Search excerpt':null].filter(Boolean).join(' · ')}</small>
        </>}
        {(reference.supportingQuote||reference.excerpt)&&<blockquote>{reference.supportingQuote||reference.excerpt}</blockquote>}
      </li>)}</ul>
    </details>}
  </div>;
}

export function App({api=demoApi}:{api?:ExamApi}) {
  const theme = useTheme();
  const activeApi=api;
  const [mode,setMode]=useState<PreparationMode>('last-minute');
  const [drawerOpen,setDrawerOpen]=useState(false);
  useEffect(()=>{
    if(location.hash==='#study-coach')history.replaceState(null,'','#main');
  },[]);
  const drawerToggle=useRef<HTMLButtonElement>(null);
  const drawerPanel=useRef<HTMLElement>(null);
  const [savedBook,setBook]=useState<{id:string;subject:string;pages:BookPage[];university:string;promptKey:string;initialRequest:string}|null>(null);
  const [activeTopicId,setActiveTopicId]=useState('');
  const [expandedTopics,setExpandedTopics]=useState<Record<string,boolean>>({});
  const practice=usePractice();
  const [selectedQuestions,setSelectedQuestions]=useState<Record<string,PracticeItem>>({});
  const [bookContent,setBookContent]=useState<Record<string,BookContent>>({});
  const [bookErrors,setBookErrors]=useState<Record<string,string>>({});
  const [loadingPage,setLoadingPage]=useState<string|null>(null);
  const bookRequest=useRef<AbortController|null>(null);
  const outlineCache=useRef(new Map<string,TopicOutline[]>());
  const outlineRequest=useRef<{start:()=>void;operation:AbortController}|null>(null);
  const studyHeading=useRef<HTMLHeadingElement>(null);
  const [prompt,setPrompt]=useState('');
  const promptKey=studySessionPrompt(prompt);
  const book=savedBook?.promptKey===promptKey?savedBook:null;
  const bookIndex=Math.max(0,book?.pages.findIndex(page=>page.id===activeTopicId)??0);
  const activeBookPage=book?.pages[bookIndex];
  const [academicByScope,setAcademicByScope]=useState<Record<string,AcademicResult|null>>({});
  const academicRequests=useRef(new Set<string>());
  const academic=book?academicByScope[book.id]:undefined;
  async function fetchAcademic(subject:string,university:string,signal:AbortSignal){
    const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},signal,
      body:JSON.stringify({task:'academic',subject,university})});
    const data=await response.json() as AcademicResult;
    return response.ok&&data.scope&&Array.isArray(data.sources)?data:null;
  }
  const [context,setContext]=useState(empty);
  const [files,setFiles]=useState<Material[]>([]);
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [documents,setDocuments]=useState<ExtractedDocument[]>([]);
  const [processingMessage,setProcessingMessage]=useState('');
  const [awaitReview,setAwaitReview]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const [dragging,setDragging]=useState(false);
  const [result,setResult]=useState<readonly Question[]|null>(null);
  const [warnings,setWarnings]=useState<string[]>([]);
  const analyzed=useRef(new Map<string,Analysis>());
  const documentCache=useRef(new Map<string,ExtractedDocument>());
  const firstContentStarted=useRef<number|null>(null);
  const activeSubject=useRef('');
  const evidenceIds=useRef<Set<number>|null>(null);
  const incomingEvidenceIds=useRef<number[]>([]);
  const [studied,setStudied]=useState<Record<string,boolean>>({});
  const [recallPage,setRecallPage]=useState<string|null>(null);
  const [quiz,setQuiz]=useState<{key:string;items:ReviewItem[]}|null>(null);
  const [quizAttempts,setQuizAttempts]=useState<Record<string,ReviewAttempt>>({});
  const quizDialog=useRef<HTMLDialogElement>(null);
  const mapDialog=useRef<HTMLDialogElement>(null);
  const [messages,setMessages]=useState<Message[]>([]);
  const [streamingReply,setStreamingReply]=useState<{message:Message;text:string}|null>(null);
  const [coachOpen,setCoachOpen]=useState(false);
  const [coachDraft,setCoachDraft]=useState('');
  const coachInput=useRef<HTMLTextAreaElement>(null);
  const coachToggle=useRef<HTMLButtonElement>(null);
  const coachPanel=useRef<HTMLElement>(null);
  const studyNotes=useRef<HTMLElement>(null);
  const [selectedText,setSelectedText]=useState('');
  const chatTranscript=useRef<HTMLDivElement>(null);
  const coachContent=useRef<HTMLDivElement>(null);
  const coachAtBottom=useRef(true);
  const composer=useRef<HTMLElement>(null);
  const [draft,setDraft]=useState('');
  const [assistantPending,setAssistantPending]=useState(false);
  const [discussion,setDiscussion]=useState<Discussion|null>(null);
  const [needsSubject,setNeedsSubject]=useState(false);
  const [draftAttachmentIds,setDraftAttachmentIds]=useState<number[]>([]);
  const draftFiles=files.filter(item=>draftAttachmentIds.includes(item.id));
  const newAttachments=draftFiles.length>0;
  useLayoutEffect(()=>{
    if(!coachAtBottom.current)return;
    if(chatTranscript.current)chatTranscript.current.scrollTop=chatTranscript.current.scrollHeight;
  },[messages,coachOpen,streamingReply]);
  useEffect(()=>{
    if(!coachOpen||!coachContent.current||typeof ResizeObserver!=='function')return;
    const observer=new ResizeObserver(()=>{
      if(coachAtBottom.current&&chatTranscript.current)chatTranscript.current.scrollTop=chatTranscript.current.scrollHeight;
    });
    observer.observe(coachContent.current);
    return ()=>observer.disconnect();
  },[coachOpen]);
  useLayoutEffect(()=>{
    const viewport=window.visualViewport;
    const section=composer.current;
    if(!viewport||!section)return;
    const resize=()=>{
      const obscured=Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop);
      section.style.setProperty('--composer-inset',obscured+'px');
    };
    const updateLauncher=()=>{
      const height=section.offsetHeight+'px';
      coachToggle.current?.style.setProperty('--composer-height',height);
      document.documentElement.style.setProperty('--composer-clearance',height);
    };
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(updateLauncher):null;
    observer?.observe(section);
    updateLauncher();
    viewport.addEventListener('resize',resize);
    viewport.addEventListener('scroll',resize);
    return ()=>{
      observer?.disconnect();
      document.documentElement.style.removeProperty('--composer-clearance');
      viewport.removeEventListener('resize',resize);
      viewport.removeEventListener('scroll',resize);
    };
  },[]);
  const [page,setPage]=useState<Page|null>(null);
  const [source,setSource]=useState<Source|null>(null);
  const [sourceUrl,setSourceUrl]=useState('');
  const [previewAttachmentId,setPreviewAttachmentId]=useState<number|null>(null);
  const previewAttachment=files.find(item=>item.id===previewAttachmentId);
  const originalFile=previewAttachment?.file??files.find(item=>item.id===source?.documentIndex)?.file;
  const nextFile=useRef(0);
  const input=useRef<HTMLInputElement>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const infoDialog=useRef<HTMLDialogElement>(null);
  const workspaceInput=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>()=>{controller.current?.abort();bookRequest.current?.abort();outlineRequest.current?.operation.abort();},[]);
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
    if(!coachOpen)return;
    coachInput.current?.focus({preventScroll:true});
    const viewport=window.visualViewport;
    const resize=()=>{
      const obscured=viewport?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop):0;
      coachPanel.current?.style.setProperty('--coach-inset',obscured+'px');
      if(viewport)coachPanel.current?.style.setProperty('--coach-viewport',viewport.height+'px');
    };
    resize();
    viewport?.addEventListener('resize',resize);
    viewport?.addEventListener('scroll',resize);
    return ()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);};
  },[coachOpen]);
  useEffect(()=>{
    const select=()=>{
      const selection=window.getSelection();
      setSelectedText(selection?.anchorNode&&selection.focusNode&&studyNotes.current?.contains(selection.anchorNode)&&studyNotes.current.contains(selection.focusNode)
        ?selection.toString().trim().slice(0,900):'');
    };
    document.addEventListener('selectionchange',select);
    return ()=>document.removeEventListener('selectionchange',select);
  },[]);
  function practiceTopic(page:BookPage):PracticeTopic|null{
    if(!book)return null;
    return {key:JSON.stringify([book.id,page.id]),subject:book.subject,page,university:book.university,official:academic?.sources??[]};
  }
  const activePractice=activeBookPage?practiceTopic(activeBookPage):null;
  useEffect(()=>{
    if(!book||academicRequests.current.has(book.id)||(!book.university&&book.subject!=='Operating Systems'))return;
    academicRequests.current.add(book.id);
    void fetchAcademic(book.subject,book.university,AbortSignal.timeout(12000))
      .then(data=>setAcademicByScope(current=>({...current,[book.id]:data})))
      .catch(()=>setAcademicByScope(current=>({...current,[book.id]:null})));
  },[book]);
  const selectedQuestion=activeBookPage?selectedQuestions[activeBookPage.id]:undefined;
  const lessonKey=activePractice?mode+':'+activePractice.key:'';
  const activeBookContent=bookContent[lessonKey];
  useEffect(()=>{
    if(!activeBookContent)return;
    const renderStarted=now();
    const root=studyNotes.current;
    if(!root)return;
    let frame=0;
    const painted=()=>{
      if(!root.querySelector('.learning-section:not([hidden]) .learning-body .coach-answer'))return;
      observer.disconnect();
      frame=requestAnimationFrame(()=>{
        browserTiming('study:render',renderStarted);
        outlineRequest.current?.start();
        if(firstContentStarted.current!==null){
          browserTiming('study:first-useful',firstContentStarted.current);
          firstContentStarted.current=null;
        }
      });
    };
    const observer=new MutationObserver(painted);
    observer.observe(root,{childList:true,subtree:true});
    painted();
    return ()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[activeBookContent,mode]);
  useEffect(()=>{
    if(mode!=='study'||!activePractice||(!activeBookContent&&!bookErrors[lessonKey]))return;
    const frame=requestAnimationFrame(()=>{
      if(!practice.batches[activePractice.key]?.requested)void practice.add(activePractice,5,'',true);
      if(!practice.details[practice.detailKey(activePractice,'example')])void practice.load(activePractice,'example');
    });
    return ()=>cancelAnimationFrame(frame);
  },[mode,activePractice,activeBookContent,practice,bookErrors,lessonKey]);
  useEffect(()=>{
    if(!activeBookPage)return;
    studyHeading.current?.focus({preventScroll:true});
    studyHeading.current?.scrollIntoView?.({block:'start'});
  },[activeBookPage?.id,mode]);
  useEffect(()=>{
    if(!book||!activeBookPage||loadingPage||bookRequest.current||bookContent[lessonKey]||bookErrors[lessonKey])return;
    const unit=activeBookPage;
    const excerpts=unit.passages.slice(0,3);
    const operation=new AbortController();
    bookRequest.current=operation;
    setLoadingPage(lessonKey);
    const requestedAt=now();
    void (async()=>{
      try{
        const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.any([operation.signal,AbortSignal.timeout(50000)]),
          body:JSON.stringify({task:'notes',mode:'auto',academicGrounding:true,university:book.university,studyUnit:true,learningMode:mode,minutes:context.minutes||undefined,
            subject:book.subject,topics:[unit.title],topic:unit.title,
            syllabusTopics:unit===book.pages[0]?book.pages.filter(page=>page.scope).slice(0,12).map(page=>page.title):undefined,
            request:(unit===book.pages[0]&&book.initialRequest?book.initialRequest+'\n\n':'')+'Teach '+unit.title+' to a beginner. Start with the foundation, explain the essential ideas and relationships, then give a short takeaway.',
            priorities:(unit.priorities??unit.questions).slice(0,4).map(question=>({topic:question.topic,prompt:question.prompt})),sources:unit.passages.map(source=>({...source,documentType:files.find(file=>file.id===source.documentIndex)?.kind||'Pasted notes'}))})});
        const data=await response.json() as {explanation?:string;code?:string;sources?:CoachSource[];webSearch?:{code:string}};
        if(!response.ok||!data.explanation?.trim()){
          throw new Error(data.code==='usage_limit'?'The AI usage limit has been reached.':data.code==='citation_validation_failed'
            ?'The generated notes could not be source-verified.':'This topic could not be generated.');
        }
        if(!operation.signal.aborted){
          setBookContent(current=>({...current,[lessonKey]:{text:data.explanation!,references:data.sources??[],webLimited:Boolean(data.webSearch&&data.webSearch.code!=='ok')}}));
          browserTiming('study:lesson-request',requestedAt);
        }
      }catch(error){
        if(operation.signal.aborted)return;
        if(excerpts.length)setBookContent(current=>({...current,[lessonKey]:{text:excerpts.map(source=>source.excerpt).join('\n\n'),
          references:excerpts.map((source,index)=>({...source,kind:'uploaded',id:'excerpt-'+index})),
          webLimited:false,excerpt:true}}));
        else setBookErrors(current=>({...current,[lessonKey]:error instanceof Error&&error.name==='Error'?error.message:'This topic could not be generated.'}));
      }finally{
        if(bookRequest.current===operation){bookRequest.current=null;setLoadingPage(null);}
      }
    })();
  },[activeBookPage,book,bookContent,bookErrors,loadingPage,lessonKey,mode,context.minutes]);
  useEffect(()=>{
    if(!originalFile){setSourceUrl('');return;}
    const url=URL.createObjectURL(originalFile);
    setSourceUrl(url);
    return ()=>URL.revokeObjectURL(url);
  },[originalFile]);
  function clearBook(){
    outlineRequest.current?.operation.abort();outlineRequest.current=null;
    practice.reset();setQuiz(null);setQuizAttempts({});
    setSelectedQuestions({});
    bookRequest.current?.abort();bookRequest.current=null;setLoadingPage(null);
    setBook(null);setActiveTopicId('');setExpandedTopics({});setBookContent({});setBookErrors({});setStudied({});setRecallPage(null);
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
    if(accepted.length){
      if(activeApi.prepare){
        void import('./documents').catch(()=>{});
        if(accepted.some(item=>item.kind==='Past paper'||item.kind==='Syllabus'))warmEmbeddings();
      }
      setDraftAttachmentIds(current=>[...current,...accepted.map(item=>item.id)]);
    }
    setNotice(errors.length ? 'Could not attach ' + errors.join(', ') + '. Add up to 8 files of 20 MB each. Use PDF, DOCX, PPTX, PNG, JPEG, WebP, or BMP. Save older .ppt files as .pptx.' : '');
  };
  function preparationContext(value:string):Context {
    const parsed=activeApi.parse(value);
    return {
      subject:learningSubject(value,parsed.subject)||context.subject,
      date:parsed.date||context.date,
      minutes:parsed.minutes||context.minutes,
      pass:parsed.pass||context.pass,
      pattern:parsed.pattern||context.pattern,
      familiarity:parsed.familiarity==='unknown'?context.familiarity:parsed.familiarity
    };
  }
  function clearComposer(){
    setDraft('');setDraftAttachmentIds([]);
  }
  function requestSubject(){
    setNeedsSubject(true);
    setNotice('What subject or topic would you like to study?');
  }
  function hasPendingAttachment(item:Material){
    const record=documents.find(document=>document.id===item.id);
    return !record||record.total===null&&!record.error||record.pages.some(page=>page.status==='pending');
  }
  async function readDocuments(run:AbortController,retry=false,onProgress?:(records:ExtractedDocument[])=>void){
    let records=documents.filter(document=>files.some(file=>file.id===document.id));
    if(activeApi.prepare&&files.length&&(retry||files.some(hasPendingAttachment))){
      records=await activeApi.prepare(files,{records,cache:documentCache.current,signal:run.signal,retry,
        onUpdate:({documents:updated,message})=>{setDocuments(updated);setProcessingMessage(message);onProgress?.(updated);}});
      run.signal.throwIfAborted();
      setDocuments(records);
    }
    return records;
  }
  async function generate(adjusted=context,attempt:'normal'|'retry'|'continue'='normal',inputPrompt=prompt) {
    if(controller.current||(!inputPrompt.trim()&&!files.length))return;
    if(attempt==='normal')incomingEvidenceIds.current=draftFiles.map(item=>item.id);
    setNeedsSubject(false);setNotice('');setBusy(true);
    const run=new AbortController();
    controller.current=run;
    firstContentStarted.current=now();
    void loadStudyMarkdown().catch(()=>{});
    setProcessingMessage(activeApi.prepare&&files.length?'Reading attachments…':'Finding your first topic…');
    try{
      let offerPartial:((records:ExtractedDocument[])=>void)|undefined;
      const firstReady=new Promise<ExtractedDocument[]>(resolve=>{offerPartial=resolve;});
      const explicit=learningSubject(inputPrompt,activeApi.parse(inputPrompt).subject);
      const complete=readDocuments(run,attempt==='retry',records=>{
        if(!offerPartial||!records.some(record=>record.total===null||record.pages.some(page=>page.status==='pending'))||
           !records.some(record=>record.pages.some(isTrusted)))return;
        const snapshot=inspectStudyInput(records,files);
        const subject=explicit||snapshot.subject;
        if(!subject||(!snapshot.outline.length&&!revise('',records,snapshot.files,subject)))return;
        offerPartial(records);offerPartial=undefined;
      });
      const first=await Promise.race([
        complete.then(records=>({records,partial:false})),
        firstReady.then(records=>({records,partial:true}))
      ]);
      const allRecords=first.records;
      const allInspected=inspectStudyInput(allRecords,files);
      if(allRecords.length&&!first.partial)setFiles(allInspected.files);
      const incomingIds=new Set(incomingEvidenceIds.current);
      const incomingFiles=allInspected.files.filter(item=>incomingIds.has(item.id));
      const incoming=inspectStudyInput(allRecords.filter(document=>incomingIds.has(document.id)),incomingFiles);
      const requestedSubject=explicit||incoming.subject||adjusted.subject||allInspected.subject;
      const changingSubject=Boolean(activeSubject.current&&requestedSubject&&subjectKey(activeSubject.current)!==subjectKey(requestedSubject));
      const scopedFiles=allInspected.files.filter(item=>{
        const records=allRecords.filter(document=>document.id===item.id);
        const detected=inspectStudyInput(records,[item]).subject;
        if(!requestedSubject)return true;
        if(detected)return subjectKey(detected)===subjectKey(requestedSubject);
        return incomingIds.has(item.id)||!activeSubject.current||(!changingSubject&&evidenceIds.current?.has(item.id));
      });
      const scopedIds=new Set(scopedFiles.map(item=>item.id));
      const records=allRecords.filter(document=>scopedIds.has(document.id));
      const inspected=inspectStudyInput(records,scopedFiles);
      adjusted={...adjusted,subject:requestedSubject};
      const requestedTopic=studyTopic(inputPrompt);
      const focus=requestedTopic.toLowerCase()===adjusted.subject.toLowerCase()?'':requestedTopic;
      const pastedNotes=focus?'':inputPrompt;
      const extracted=revise(pastedNotes,records,inspected.files,adjusted.subject);
      if(records.some(document=>!documentComplete(document))&&!extracted&&
        !records.some(document=>document.pages.some(page=>page.text.trim()&&isTrusted(page)))){
        setAwaitReview(true);
        if(!requestedSubject&&!focus){
          setNotice('No readable material was found. Check the original or retry the attachment.');
          return;
        }
        setNotice('Some pages could not be verified. The topic map will use published curriculum if one is available.');
      }else setAwaitReview(false);
      const namedUniversity=/\b(?:university|iit\b|gehu\b|geu\b|mit\b|[a-z]+\.ac\.[a-z]+|[a-z]+\.edu)\b/i.test(inputPrompt);
      const university=namedUniversity?inputPrompt.slice(0,500):(!changingSubject?savedBook?.university??'':'');
      const provisionalSubject=learningSubject(adjusted.subject||inspected.subject,adjusted.subject||inspected.subject)||focus||extracted?.title||'';
      const scopeKey=(subject:string)=>JSON.stringify([subjectKey(subject),university.toLowerCase().trim()]);
      const knownScope=provisionalSubject?scopeKey(provisionalSubject):'';
      const loadCourse=(subject:string)=>fetchAcademic(subject,university,AbortSignal.any([run.signal,AbortSignal.timeout(9500)])).catch(()=>null);
      const pendingCourse=mode==='study'&&university&&knownScope&&academicByScope[knownScope]===undefined?loadCourse(provisionalSubject):null;
      const key=JSON.stringify([studySessionPrompt(inputPrompt),inspected.files.map(file=>[file.id,file.kind]),records]);
      let analysis=analyzed.current.get(key)??null;
      let refinement:Promise<Analysis>|undefined;
      if(!analysis){
        try{
          let publishInitial:((value:Analysis)=>void)|undefined;
          const initial=new Promise<Analysis>(resolve=>{publishInitial=resolve;});
          // Fixed subject and trusted evidence allow Last Minute to start with the server's exact ranking.
          refinement=activeApi.analyze({...adjusted,minutes:0},inspected.files,inputPrompt,{learning:true,documents:records,signal:run.signal,
            onPreliminary:mode==='last-minute'&&explicit&&records.length?publishInitial:undefined}).then(final=>{
            run.signal.throwIfAborted();
            if(analyzed.current.size>=8)analyzed.current.delete(analyzed.current.keys().next().value!);
            analyzed.current.set(key,final);
            return final;
          });
          analysis=await Promise.race([refinement,initial]);
        }catch(error){
          run.signal.throwIfAborted();
          if(!extracted&&!adjusted.subject&&!focus)throw error;
          analysis={questions:[],warnings:['Question ranking is temporarily unavailable.']};
        }
      }else browserTiming('study:analysis-cache-hit',now());
      run.signal.throwIfAborted();
      const subject=learningSubject(adjusted.subject||inspected.subject,adjusted.subject||inspected.subject)
        ||focus||extracted?.title||analysis.questions[0]?.topic||'';
      if(!subject){requestSubject();return;}
      const bookId=scopeKey(subject);
      let course=academicByScope[bookId];
      if(mode==='study'&&university&&course===undefined){
        setProcessingMessage('Checking the university curriculum…');
        course=await ((bookId===knownScope?pendingCourse:null)??loadCourse(subject));
        run.signal.throwIfAborted();
        if(course){
          academicRequests.current.add(bookId);
          setAcademicByScope(current=>({...current,[bookId]:course}));
        }
      }
      const outline:TopicOutline[]=inspected.outline.length?inspected.outline:academicOutline(course?.sources??[]);
      const outlineKey=JSON.stringify([bookId,records.map(record=>[record.id,record.pages.filter(isTrusted).map(page=>page.number)])]);
      const cachedOutline=outlineCache.current.get(outlineKey);
      const needsOutline=!first.partial&&!outline.length&&!cachedOutline&&!focus;
      const sessionPrompt=studySessionPrompt(inputPrompt);
      const describeSource=(source:Source)=>({...source,documentType:files.find(file=>file.id===source.documentIndex)?.kind||'Pasted notes'});
      let latestRanking:Analysis=analysis;
      let latestOutline=outline.length?outline:cachedOutline??outline;
      const buildPages=(topics:typeof outline,ranked:Analysis=latestRanking,passages=extracted?.passages??[])=>bookOutline(ranked,subject,focus,passages,topics).map(page=>({...page,
        passages:page.passages.map(describeSource),
        questions:page.questions.map(question=>({...question,answerSource:question.answerSource?describeSource(question.answerSource):null}))
      }));
      const pages=buildPages(latestOutline);
      if(!pages.length){requestSubject();return;}
      if(activeSubject.current&&subjectKey(activeSubject.current)!==subjectKey(subject)){
        activeAssistantRequest.current?.abort();activeAssistantRequest.current=null;setAssistantPending(false);
        setMessages(current=>current.filter(message=>!message.inline));
      }
      clearBook();
      activeSubject.current=subject;
      evidenceIds.current=scopedIds;
      setContext(current=>({...current,subject}));
      setActiveTopicId(pages[0].id);
      setBook({id:bookId,subject,pages,university,promptKey:sessionPrompt,initialRequest:incomingIds.size?inputPrompt.slice(0,320):''});
      const queueOutline=()=>{
        const operation=new AbortController();
        let started=false;
        outlineRequest.current={operation,start:()=>{
          if(started||operation.signal.aborted)return;
          started=true;
          void (async()=>{
            try{
              const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
                signal:AbortSignal.any([operation.signal,AbortSignal.timeout(25000)]),
                body:JSON.stringify({task:'outline',subject,university,academicGrounding:true,
                  topics:[...new Set(latestRanking.questions.filter(question=>question.historical).map(question=>question.topic))].slice(0,12),
                  sources:extracted?.passages.slice(0,4)??[]})});
              const data=await response.json() as {topics?:TopicOutline[]};
              if(!response.ok||!Array.isArray(data.topics)||!data.topics.length)throw new Error();
              if(!operation.signal.aborted){
                if(!first.partial){
                  if(outlineCache.current.size>=8)outlineCache.current.delete(outlineCache.current.keys().next().value!);
                  outlineCache.current.set(outlineKey,data.topics);
                }
                latestOutline=data.topics;
                const pages=buildPages(latestOutline);
                setBook(current=>current?.id===bookId&&current.promptKey===sessionPrompt?{...current,pages}:current);
              }
            }catch{
              if(!operation.signal.aborted)setNotice('No reliable course outline was found. Review the attachment or enter a specific topic.');
            }
          })();
        }};
      };
      if(needsOutline)queueOutline();
      setResult(analysis.questions);setWarnings(analysis.warnings);
      if(refinement&&analyzed.current.get(key)!==analysis){
        setProcessingMessage('Checking related questions…');
        const final=await refinement;
        run.signal.throwIfAborted();
        latestRanking=final;
        const refined=buildPages(latestOutline,final);
        const originalIds=new Map(pages.map(page=>[page.title,page.id]));
        setBook(current=>current?.id===bookId&&current.promptKey===sessionPrompt?{...current,
          pages:refined.map(page=>({...page,id:originalIds.get(page.title)??page.id}))}:current);
        setResult(final.questions);setWarnings(final.warnings);
      }
      if(first.partial){
        const finished=await complete;
        run.signal.throwIfAborted();
        const reviewed=inspectStudyInput(finished,files);
        setFiles(reviewed.files);
        const included=reviewed.files.filter(file=>{
          const record=finished.find(document=>document.id===file.id);
          const detected=record?inspectStudyInput([record],[file]).subject:'';
          return detected?subjectKey(detected)===subjectKey(subject):scopedIds.has(file.id);
        });
        const ids=new Set(included.map(file=>file.id));
        const completeRecords=finished.filter(record=>ids.has(record.id));
        const completeInput=inspectStudyInput(completeRecords,included);
        const finalKey=JSON.stringify([sessionPrompt,included.map(file=>[file.id,file.kind]),completeRecords]);
        setProcessingMessage('Updating topics from the remaining pages…');
        const final=analyzed.current.get(finalKey)??await activeApi.analyze({...adjusted,minutes:0},included,inputPrompt,
          {learning:true,documents:completeRecords,signal:run.signal});
        run.signal.throwIfAborted();
        if(analyzed.current.size>=8)analyzed.current.delete(analyzed.current.keys().next().value!);
        analyzed.current.set(finalKey,final);
        evidenceIds.current=ids;
        latestRanking=final;
        latestOutline=completeInput.outline.length?completeInput.outline:latestOutline;
        const updated=buildPages(latestOutline,final,
          revise(pastedNotes,completeRecords,included,subject)?.passages??[]);
        setBook(current=>current?.id===bookId&&current.promptKey===sessionPrompt?{...current,pages:updated}:current);
        setResult(final.questions);setWarnings(final.warnings);
        if(!latestOutline.length&&!focus){
          queueOutline();
          outlineRequest.current?.start();
        }
      }
    }catch(error){
      setNotice(run.signal.aborted?'Reading cancelled. Send again to resume.':error instanceof Error?error.message:'These notes could not load. Try again.');
    }finally{
      controller.current=null;setProcessingMessage('');setBusy(false);
    }
  }
  const activeAssistantRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>{activeAssistantRequest.current?.abort();},[]);
  async function askAssistant(message:Message,request:CoachRequest) {
    if(activeAssistantRequest.current)return;
    const operation=new AbortController();
    activeAssistantRequest.current=operation;
    setAssistantPending(true);
    void loadStudyMarkdown().catch(()=>{});
    let reply:Message;
    try{
      const started=now();
      const signal=AbortSignal.any([operation.signal,AbortSignal.timeout(50000)]);
      const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},
        signal,body:coachRequestBody(request)});
      type Reply={explanation?:string;generated?:boolean;sources?:CoachSource[];code?:string;error?:string};
      let data:Reply={};
      if(response.ok&&response.body&&response.headers.get('content-type')?.startsWith('text/event-stream')){
        let received='';
        await readStudyEvents(response.body,(event,raw)=>{
          const packet=JSON.parse(raw);
          if(event==='delta'&&typeof packet.text==='string'){
            if(!received)browserTiming('study:coach-first-text',started);
            received+=packet.text;
            setStreamingReply({message,text:received});
          }
          if(event==='done'||event==='error'){data=packet;return false;}
        },signal);
      }else data=await response.json() as Reply;
      browserTiming('study:coach-request',started);
      if(!response.ok||!data.explanation?.trim()){
        throw new Error(response.status===413?'This message is too long to send. Shorten it and try again.':data.error||'Couldn’t answer right now. Try again.');
      }
      reply={...message,text:data.explanation,generated:data.generated!==false,references:data.sources};
    }catch(error){
      if(operation.signal.aborted)return;
      const errorMessage=error instanceof Error&&error.name==='Error'?error.message:'Couldn’t answer right now. Try again.';
      reply={...message,error:errorMessage,retry:request};
    }finally{
      if(activeAssistantRequest.current===operation){activeAssistantRequest.current=null;setAssistantPending(false);setStreamingReply(null);}
    }
    setMessages(current=>current.map(item=>item===message?{...reply,pending:false}:item));
  }
  function send(value:string,channel:'main'|'coach'='main') {
    const text=value.trim();
    if(!text||controller.current||activeAssistantRequest.current)return;
    const suppliedMinutes=duration(text);
    if(channel==='main'){
      const adjusted=preparationContext(text);
      setContext({...adjusted,subject:context.subject||book?.subject||adjusted.subject});
    }else if(suppliedMinutes)setContext(current=>({...current,minutes:suppliedMinutes}));
    const more=text.match(/^(?:please )?(?:generate|add|give me)\s+(\d{1,2})\s+more\s*(.*?)\s*questions\b[.!?]?$/i);
    const requestedFormat=more?.[2].trim()||'';
    const specificFormat=/numerical|coding|conceptual|comparison|theory|analytical|descriptive|multiple.choice/i.test(requestedFormat);
    const fitsTopic=!requestedFormat||specificFormat||activePractice?.page.title.toLowerCase().includes(requestedFormat.toLowerCase());
    const offer=channel==='coach'&&more&&fitsTopic&&mode==='study'&&activePractice?{topic:activePractice,count:Math.min(10,Math.max(1,Number(more[1]))),
      format:specificFormat?requestedFormat:''}:undefined;
    const inline=channel==='main';
    const message:Message={role:'in-nocent',inline,text:offer?'I can add these to '+offer.topic.page.title+'.':'',pending:!offer,offer};
    if(inline){setDraft('');setNotice('');}
    else {coachAtBottom.current=true;setCoachDraft('');}
    setMessages(current=>[...current,{role:'You',text,inline},message]);
    if(offer)return;

    const conversation=messages.filter(item=>Boolean(item.inline)===inline);
    const subject=book?.subject||context.subject||learningSubject(text);
    const topics=[...new Set((book?.pages.map(page=>page.title)??(result??[]).map(question=>question.topic)))].slice(0,20);
    const numbered=text.match(/(?:#|question\s+)(\d+)/i);
    const selected=numbered?activeBookPage?.questions[Number(numbered[1])-1]:undefined;
    const previousQuestion=conversation.filter(item=>item.role==='You').at(-1)?.text??'';
    const query=new Set((text+' '+previousQuestion+' '+(selected?.topic??'')+' '+topics.join(' ')).toLowerCase().match(/[a-z]{4,}/g)??[]);
    const retrieved=documents.flatMap(document=>{
      if(draftAttachmentIds.includes(document.id)||(evidenceIds.current&&!evidenceIds.current.has(document.id)))return [];
      const kind=files.find(file=>file.id===document.id)?.kind;
      if(kind==='Past paper'||kind==='Administrative'||kind==='Unreadable')return [];
      return document.pages.filter(isTrusted).flatMap(page=>page.text.split(/\n+/).map((line,index)=>({
        file:document.name,page:page.number,number:'Line '+(index+1),documentIndex:document.id,excerpt:line.trim().slice(0,650),
      })));
    }).map(source=>({source,score:[...new Set(source.excerpt.toLowerCase().match(/[a-z]{4,}/g)??[])].filter(word=>query.has(word)).length}))
      .filter(match=>match.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(match=>match.source);
    const unit=activeBookPage;
    const unitDiscussion:Discussion|null=unit&&activeBookContent?{title:unit.title,text:activeBookContent.text,sources:unit.passages}:null;
    const explicitTarget=!inline&&discussion?.pageId===unit?.id?discussion:null;
    const target=explicitTarget??unitDiscussion;
    const question=explicitTarget?explicitTarget.question:!inline?selectedQuestion:undefined;
    const candidates=[question?.answerSource,...(target?.sources??[]),...retrieved,selected?.answerSource]
      .filter((candidate):candidate is Source=>Boolean(candidate));
    const sources=[...new Map(candidates.map(candidate=>[candidate.excerpt,candidate])).values()].slice(0,12);
    const history:CoachRequest['history']=[];
    for(let index=1;index<conversation.length;index++){
      const user=conversation[index-1],assistant=conversation[index];
      if(user.role==='You'&&assistant.role!=='You'&&assistant.text&&!assistant.error&&!assistant.pending){
        history.push({role:'user',content:user.text.slice(0,1500)},{role:'assistant',content:assistant.text});
      }
    }
    void askAssistant(message,{request:text,mode:'auto',task:/\bmarks?\b/i.test(text)?'exam':'chat',
      topic:target?.title??selected?.topic,subject,topics,preparationMode:mode,university:book?.university,academicGrounding:true,activeQuestion:question?.prompt,
      studyPage:target?{title:target.title,text:target.text.slice(0,1400)}:undefined,
      history:history.slice(-6),sources:sources.map(source=>({...source,documentType:files.find(file=>file.id===source.documentIndex)?.kind||'Pasted notes'})),minutes:suppliedMinutes||context.minutes});
  }
  function discuss(target:Discussion){
    setDiscussion({...target,pageId:activeBookPage?.id});
    setCoachOpen(true);
    if(coachOpen)coachInput.current?.focus({preventScroll:true});
  }
  function minimizeCoach(){
    setCoachOpen(false);
    coachToggle.current?.focus({preventScroll:true});
  }
  function selectPractice(item:PracticeItem){
    if(!activeBookPage)return;
    setSelectedQuestions(current=>({...current,[activeBookPage.id]:item}));
    setDiscussion(null);
  }
  function askPractice(item:PracticeItem){
    if(!activeBookPage)return;
    selectPractice(item);
    discuss({title:activeBookPage.title,text:item.prompt,sources:item.answerSource?[item.answerSource]:activeBookPage.passages,question:item});
  }
  function submitMessage(){
    if(controller.current||activeAssistantRequest.current)return;
    const text=draft.trim();
    if(needsSubject&&!newAttachments&&text&&!text.includes('?')&&text.length<=100){
      const adjusted={...context,subject:activeApi.parse(text).subject||text};
      clearComposer();
      setContext(adjusted);
      void generate(adjusted,'continue');
      return;
    }
    const examRequest=/\bmy\s+(?:[\w-]+\s+){0,8}(?:exam|midterm)\b|\b(?:(?:study|revision) (?:plan|notes)|(?:help me|i (?:want|need) to) (?:study|revise))\b/i.test(text);
    const summaryRequest=/\bsummari[sz]e\b/i.test(text)&&
      (!messages.some(message=>message.inline)||/\b(?:attached|syllabus|my notes|study material|past paper|pyq)\b/i.test(text));
    const notes=!text.includes('?')&&text.split(/[.!\n]/).filter(line=>line.trim()).length>=2&&Boolean(revise(text,[],[],''));
    const detected=learningSubject(text,activeApi.parse(text).subject);
    const subjectChanged=Boolean(detected&&subjectKey(detected)!==subjectKey(book?.subject??''));
    const studyRequest=(/^teach me\b/i.test(text)&&Boolean(studyTopic(text)))||((!book||/\b(?:exam|paper) (?:preparation|revision|hai)\b/i.test(text))&&Boolean(learningSubject(text))&&!text.includes('?'));
    const preparation=newAttachments||summaryRequest||(!book&&(examRequest||studyRequest||notes))||
      (subjectChanged&&!text.includes('?')&&(examRequest||studyRequest))||(!text&&!workspaceResult&&(prompt||files.length));
    if(!preparation){
      send(text);
      return;
    }
    if(!text&&!prompt&&!files.length){
      workspaceInput.current?.focus();
      return;
    }
    const studyInput=text||(newAttachments?'':prompt);
    const adjusted=preparationContext(studyInput);
    clearComposer();
    setDiscussion(null);
    setPrompt(studyInput);
    setContext(adjusted);
    void generate(adjusted,'normal',studyInput);
  }
  function retryAssistant(message:Message) {
    if(!message.retry||busy||activeAssistantRequest.current)return;
    const pending:Message={role:message.role,inline:message.inline,text:'',pending:true};
    setMessages(current=>current.map(item=>item===message?pending:item));
    void askAssistant(pending,message.retry);
  }
  function open(next:Page|null, reference:Source|null=null){
    setPreviewAttachmentId(null);
    setPage(next);setSource(reference);dialog.current?.showModal();
  }
  function openAttachment(id:number){
    setDrawerOpen(false);
    drawerToggle.current?.focus();
    setSource(null);setPage(null);setPreviewAttachmentId(id);
    dialog.current?.showModal();
  }
  function reset(){
    clearBook();analyzed.current.clear();documentCache.current.clear();activeSubject.current='';evidenceIds.current=null;incomingEvidenceIds.current=[];
    activeAssistantRequest.current?.abort();activeAssistantRequest.current=null;setAssistantPending(false);
    setResult(null);setWarnings([]);
    setMessages([]);setCoachDraft('');setCoachOpen(false);setFiles([]);setDocuments([]);setAwaitReview(false);setPrompt('');setDraft('');setContext(empty);
    setNeedsSubject(false);setNotice('');setDiscussion(null);setDraftAttachmentIds([]);setPreviewAttachmentId(null);
  }
  function modifyFile(id:number,kind?:string) {
    if(!draftAttachmentIds.includes(id))clearBook();
    setFiles(current=>kind?current.map(file=>file.id===id?{...file,kind,kindOverride:true}:file):current.filter(file=>file.id!==id));
    if(!kind){
      setDocuments(current=>current.filter(document=>document.id!==id));
      setDraftAttachmentIds(current=>current.filter(fileId=>fileId!==id));
    }
    setAwaitReview(false);
  }
  function verifyPage(id:number,number:number,text:string){
    clearBook();
    const kind=files.find(file=>file.id===id)?.kind;
    setDocuments(current=>current.map(document=>document.id!==id?document:{...document,pages:document.pages.map(page=>page.number!==number?page:{
      ...page,text:text.trim(),status:'verified',method:'manual',questions:countQuestions(text,kind==='Past paper'),reason:''})}));
  }
  function cancelLesson(){
    if(!bookRequest.current)return;
    bookRequest.current.abort();bookRequest.current=null;setLoadingPage(null);
  }
  function selectMode(next:PreparationMode){
    if(next!==mode)cancelLesson();
    setMode(next);setNotice('');setDiscussion(null);setRecallPage(null);
    if(next==='last-minute')setCoachOpen(false);
    if(drawerOpen)drawerToggle.current?.focus();
    setDrawerOpen(false);
  }
  function rememberTopic(){
    if(activeBookPage&&activeBookContent)setStudied(current=>({...current,[activeBookPage.id]:true}));
  }
  function openBookPage(index:number,advancing=false){
    if(advancing)rememberTopic();
    if(!book?.pages[index])return;
    if(book.pages[index].id!==activeBookPage?.id){cancelLesson();firstContentStarted.current=now();}
    setActiveTopicId(book.pages[index].id);setRecallPage(null);setDiscussion(null);
    if(drawerOpen)drawerToggle.current?.focus();
    setDrawerOpen(false);
  }
  function openQuiz(){
    if(!book||!activeBookContent)return;
    rememberTopic();
    const items=book.pages.flatMap(page=>{
      if(!studied[page.id]&&page!==activeBookPage)return [];
      const key=practiceTopic(page)?.key;
      const content=bookContent[mode+':'+key]??bookContent['study:'+key]??bookContent['last-minute:'+key];
      return content?reviewItems(page,content.text,true):[];
    });
    const key=JSON.stringify([activeBookPage?.id,...items.map(item=>item.id)]);
    if(quiz?.key!==key)setQuiz({key,items:[...items.filter(item=>item.sources).slice(0,2),...items.filter(item=>!item.sources).slice(0,4)]});
    quizDialog.current?.showModal();
  }
  const workspaceResult=Boolean(book&&activeBookPage);
  const reviewDocuments=documents.filter(document=>!documentComplete(document));
  const reviewCount=reviewDocuments.reduce((sum,document)=>sum+Math.max(0,(document.total??0)-document.pages.filter(isTrusted).length),0);
  const allReviewPages=reviewCount>0&&reviewDocuments.every(document=>document.name.toLowerCase().endsWith('.pdf')&&document.total!==null);
  const reviewLabel=reviewDocuments.some(document=>document.total===null)?'Check unreadable files':
    reviewCount+' '+(allReviewPages?'page':'part')+(reviewCount===1?' needs':'s need')+' review';
  const pack:StudyPack={subject:book?.subject??'',context:[],notes:[],timeline:[],questions:[],warnings,
    generatedNotes:activeBookContent?{text:activeBookContent.text,references:activeBookContent.references.map(reference=>
      reference.kind==='uploaded'?sourceLabel(reference):reference.title+' · '+reference.url)}:undefined};
  const mapTopic=(page:BookPage,index:number)=><button type="button" className="link" data-topic-priority={index?page.priority:undefined}
    aria-description={index?topicPriorityLabel(page):undefined} aria-current={bookIndex===index?'location':undefined} onClick={()=>{mapDialog.current?.close?.();openBookPage(index);}}>
    {page.title}
  </button>;
  const mapEntries=book?.pages.map((page,index)=>({page,index}))??[];
  const mapChildren=new Map<string,typeof mapEntries>();
  for(const entry of mapEntries){
    const group=entry.page.group;
    if(!group||group===entry.page.title)continue;
    const children=mapChildren.get(group)??[];
    children.push(entry);mapChildren.set(group,children);
  }
  const currentAncestors=new Set<string>();
  let parent=activeBookPage?.group;
  while(parent&&!currentAncestors.has(parent)){
    currentAncestors.add(parent);
    parent=mapEntries.find(entry=>entry.page.title===parent)?.page.group;
  }
  function mapBranch(entry:typeof mapEntries[number],ancestorIds:readonly string[]=[]):ReactNode{
    const {page,index}=entry;
    if(ancestorIds.includes(page.id))return null;
    const path=[...ancestorIds,page.id];
    const children=mapChildren.get(page.title)??[];
    const expanded=expandedTopics[page.id]??currentAncestors.has(page.title);
    return <li key={page.id}>
      {mapTopic(page,index)}
      {children.length>0&&<button type="button" className="link topic-expand" aria-expanded={expanded}
        aria-label={'Subtopics for '+page.title} onClick={()=>setExpandedTopics(current=>({...current,[page.id]:!expanded}))}>{expanded?'−':'+'}</button>}
      {expanded&&children.length>0&&<ul>{children.map(child=>mapBranch(child,path))}</ul>}
    </li>;
  }
  const mapOrigin=mapEntries.some(entry=>entry.page.scope)?'Uploaded syllabus':
    mapEntries.some(entry=>entry.page.reference?.category==='official-syllabus')?'Official university syllabus':
    mapEntries.some(entry=>entry.page.reference)?'General academic outline':
    mapEntries.length>1?'Inferred topic outline':'No verified syllabus outline';
  const topicMap=book&&<div className="topic-map">
    {book.pages[0].title===book.subject?mapTopic(book.pages[0],0):<strong>{book.subject}</strong>}
    <small>{mapOrigin}</small>
    <div className="topic-branch"><ul>{mapEntries.filter(({page,index})=>
      (index!==0||page.title!==book.subject)&&(!page.group||page.group===book.subject||!mapEntries.some(entry=>entry.page.title===page.group))
    ).map(entry=>mapBranch(entry))}</ul></div>
  </div>;
  const modeButtons=(label:string)=><nav className="preparation-modes" aria-label={label}>
    <button type="button" disabled={busy} aria-pressed={mode==='last-minute'} onClick={()=>selectMode('last-minute')}>Last Minute</button>
    <button type="button" disabled={busy} aria-pressed={mode==='study'} onClick={()=>selectMode('study')}>Study</button>
  </nav>;
  return <>
    <header className="top"><div className="wrap header-inner">
      <div className="book-brand"><button ref={drawerToggle} type="button" className="icon-btn" aria-label="Study navigation" aria-controls="study-drawer" aria-expanded={drawerOpen} onClick={()=>setDrawerOpen(open=>!open)}><Icon name="menu"/></button>
      <a className="brand" href="#main" aria-label="in-nocent home"><span className="brand-mark"><Icon name="spark"/></span>in-nocent<span className="brand-dot">.</span></a></div>
      <div className="header-tools"><ThemePicker {...theme}/>
        <button type="button" className="icon-btn" aria-label="Study information" onClick={()=>infoDialog.current?.showModal()}>ⓘ</button>
      </div>
    </div></header>
    {drawerOpen&&<button type="button" className="drawer-backdrop" aria-label="Close study navigation" tabIndex={-1} onClick={()=>{setDrawerOpen(false);drawerToggle.current?.focus();}}/>}
    <aside ref={drawerPanel} id="study-drawer" className="study-drawer" hidden={!drawerOpen} aria-label="Study navigation">
      <div className="drawer-top"><strong>Study workspace</strong><button type="button" className="icon-btn" aria-label="Close navigation" onClick={()=>{setDrawerOpen(false);drawerToggle.current?.focus();}}><Icon name="close"/></button></div>
      {modeButtons('Preparation modes in navigation')}
      {(context.subject||book?.subject)&&<div className="drawer-exam"><small>Current examination</small><p>{context.subject||book?.subject}</p></div>}
      {book&&<nav aria-label="Table of contents"><h2>Contents</h2><ol>
        {book.pages.map((unit,index)=><li key={unit.id}><button type="button" data-topic-priority={index?unit.priority:undefined} aria-description={index?topicPriorityLabel(unit):undefined} aria-current={bookIndex===index?'page':undefined} onClick={()=>openBookPage(index)}>
          <span aria-hidden="true">{index+1}</span>{unit.title}</button></li>)}
      </ol></nav>}
      {files.some(item=>!draftAttachmentIds.includes(item.id))&&<section aria-labelledby="attached-documents-title">
        <h2 id="attached-documents-title">Attached documents</h2>
        <ul className="drawer-documents">
          {files.filter(item=>!draftAttachmentIds.includes(item.id)).map(item=><li key={item.id}>
            <button type="button" onClick={()=>openAttachment(item.id)}><Icon name="file"/>{item.file.name}</button>
          </li>)}
        </ul>
      </section>}
    </aside>
    <main id="main" className={'wrap '+(workspaceResult?'workspace':'landing')}>
      {modeButtons('Preparation mode')}
      <ThemeHero {...theme} compact={workspaceResult}/>
      <div className="exam-overview">
        {!busy&&reviewDocuments.length>0&&<button className="link review-notice" onClick={()=>infoDialog.current?.showModal()}>⚠ {reviewLabel}</button>}
        {!busy&&!reviewDocuments.length&&warnings.some(warning=>warning.startsWith('OCR-only'))&&<button className="link review-notice" onClick={()=>infoDialog.current?.showModal()}>⚠ OCR evidence needs review</button>}
      </div>
      {book&&activeBookPage&&<div className="learning-layout">
        <div className="mobile-learning-actions">
          <button type="button" className="secondary" disabled={!activeBookContent} onClick={openQuiz}>Quiz</button>
          <button type="button" className="secondary" onClick={()=>{outlineRequest.current?.start();mapDialog.current?.showModal();}}>Topic Map</button>
        </div>
        <section ref={studyNotes} className="learning-notes" aria-label={mode==='study'?'Study workspace':'Study notes'}>
          {busy&&documents.some(record=>record.total===null||record.pages.some(page=>page.status==='pending'))&&
            <small>Showing readable pages while the remaining pages are checked.</small>}
          {academic===null&&book.university&&<p className="notice">University references could not be checked. Use uploaded material or general explanations.</p>}
          {academic&&<div className="academic-scope">
            {academic.scope.requested&&<small>{academic.scope.officialSyllabus?'Official syllabus located for '+(academic.scope.institution??'the named university')+'.'
              :'An official syllabus for '+(academic.scope.institution??'the named university')+' could not be confirmed. Use uploaded material or general academic references.'}</small>}
            {academic.scope.requested&&!academic.scope.officialPyq&&<small>No official past paper was confirmed for this course.</small>}
            {academic.sources.length>0&&<details><summary>Course references</summary><SourceStatus references={academic.sources} generated={false} openSource={reference=>open(null,reference)}/></details>}
          </div>}
          {book.pages.map((unit,index)=>{
            const practiceForPage=practiceTopic(unit)!;
            const key=mode+':'+practiceForPage.key;
            const content=bookContent[key];
            const current=index===bookIndex;
            if(!current&&!content&&!practice.batches[practiceForPage.key])return null;
            const hidden=!current&&(mode==='study'||index>bookIndex||!content);
            return <article className="learning-section" key={unit.id} hidden={hidden}>
              <header className="study-heading">
                {current&&theme.anime&&theme.character&&<StudyCharacter anime={theme.anime} character={theme.character} pulse={0}/>}
                <h2 tabIndex={current?-1:undefined} ref={current?studyHeading:undefined}>{unit.title}</h2>
              </header>
              {unit.reference&&<SourceStatus references={[unit.reference]} generated={false} openSource={reference=>open(null,reference)}/>}
              {unit.scope&&<SourceStatus references={[{...unit.scope,kind:'uploaded',id:unit.id}]} generated={false} openSource={reference=>open(null,reference)}/>}
              {mode==='study'&&current&&<h3 className="study-introduction">Introduction</h3>}
              {content?<div className="learning-body">
                <CoachAnswer text={content.text.replace(/^#{1,6}\s+([^\n]+)\n+/, (heading,title:string)=>
                  title.trim().toLowerCase()===unit.title.toLowerCase()?'':heading)}/>
                {content.excerpt&&<p className="notice">Generated notes are unavailable. These excerpts come from your uploaded material.</p>}
                {content.webLimited&&!content.references.length&&<small>Web sources were unavailable for this topic.</small>}
                <SourceStatus references={content.references} generated={!content.excerpt} openSource={reference=>open(null,reference)}/>
                {current&&<div className="lesson-actions">
                  {mode==='study'&&<button type="button" className="link accent" onPointerDown={event=>{if(selectedText)event.preventDefault();}}
                    onClick={()=>discuss({title:unit.title,text:selectedText||content.text,sources:unit.passages})}>
                    {'Ask Coach'+(selectedText?' about selection':'')}</button>}
                  {mode==='last-minute'&&<button type="button" className="link accent" onClick={()=>selectMode('study')}>Explore deeper</button>}
                  {mode==='last-minute'&&recallPage!==key&&<button type="button" className="link accent" onClick={()=>{rememberTopic();setRecallPage(key);}}>Quick Recall</button>}
                </div>}
                {mode==='last-minute'&&current&&recallPage===key&&<section aria-label="Quick Recall" className="quick-recall">
                  <p>Ready for a quick recall?</p>
                  <ReviewForm key={key} items={reviewItems(unit,content.text,false)} openSource={reference=>open(null,reference)}/>
                  <button type="button" className="link" onClick={()=>setRecallPage(null)}>Back to notes</button>
                </section>}
              </div>:bookErrors[key]?<>
                <p role="alert">{bookErrors[key]}</p>
                <button type="button" className="secondary" onClick={()=>setBookErrors(({[key]:_,...rest})=>rest)}>Retry topic</button>
              </>:<p role="status">Preparing notes…</p>}
              {(current||mode==='study')&&<SolvedExample key={key} topic={practiceForPage} practice={practice}
                askCoach={mode==='study'?text=>discuss({title:unit.title,text:selectedText||text,sources:unit.passages}):undefined}
                renderText={text=><CoachAnswer text={text}/>} renderSources={(references,generated)=>
                  <SourceStatus references={references} generated={generated} openSource={reference=>open(null,reference)}/>}/>}
              {mode==='study'&&<PracticeQuestions key={unit.id} topic={practiceForPage} practice={practice}
                selected={selectedQuestions[unit.id]?.id} selectQuestion={selectPractice} askCoach={askPractice} openSource={reference=>open(null,reference)}
                renderText={text=><CoachAnswer text={text}/>} renderSources={(references,generated)=>
                  <SourceStatus references={references} generated={generated} openSource={reference=>open(null,reference)}/>}/>}
            </article>;
          })}
          {mode==='study'?<nav className="book-pagination" aria-label="Study pages">
            <button type="button" className="secondary" disabled={bookIndex===0} onClick={()=>openBookPage(bookIndex-1)}>← Previous</button>
            <span className="book-page-number">Page {bookIndex+1} of {book.pages.length}</span>
            <button type="button" className="secondary" disabled={bookIndex+1===book.pages.length} onClick={()=>openBookPage(bookIndex+1,true)}>Next →</button>
          </nav>:activeBookContent&&(bookIndex+1<book.pages.length||outlineRequest.current)&&
            <button type="button" className="secondary" onClick={()=>{if(bookIndex+1<book.pages.length)openBookPage(bookIndex+1,true);else {outlineRequest.current?.start();mapDialog.current?.showModal?.();}}}>Next topic →</button>}
        </section>
        <aside className="learning-sidebar" aria-label="Learning tools">
          <button type="button" className="secondary" disabled={!activeBookContent} onClick={openQuiz}>Quiz</button>
          <h2>Topic Map</h2>
          {topicMap}
        </aside>
      </div>}
      {messages.some(message=>message.inline)&&<section className="learning-notes inline-learning" aria-label="Inline explanations">
        {messages.filter(message=>message.inline).map((message,index)=><div key={index}>
          {message.role==='You'?<p>{message.text}</p>:message.pending?(streamingReply?.message===message?<p style={{whiteSpace:'pre-wrap'}}>{streamingReply.text}</p>:<p role="status">Preparing an explanation…</p>):
            message.error?<p role="alert">{message.error} {message.retry&&<button type="button" className="link" onClick={()=>retryAssistant(message)}>Retry</button>}</p>:
            <><CoachAnswer text={message.text}/><SourceStatus references={message.references??[]} generated={Boolean(message.generated)} openSource={reference=>open(null,reference)}/></>}
        </div>)}
      </section>}
      <section ref={composer} aria-label="Message composer" className="setup unified-composer">
        <form onSubmit={event=>{event.preventDefault();submitMessage();}} className={'composer '+(dragging?'dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);attachment(e.dataTransfer.files);}}>
          <label htmlFor="prompt" className="sr-only">Ask a question or paste notes</label>
          <textarea ref={workspaceInput} id="prompt" value={draft} onChange={event=>setDraft(event.target.value)}
            onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();submitMessage();}}}
            placeholder="Add past papers, your syllabus, or notes" rows={2} maxLength={8000}/>
          {draftFiles.length>0 && <ul className="files">{draftFiles.map(item=><li key={item.id}><Icon name="file"/><span title={item.file.name}>{item.file.name}</span><select disabled={busy} aria-label={'Type for '+item.file.name} value={item.kind} onChange={e=>modifyFile(item.id,e.target.value)}>{documentKinds.map(k=><option key={k}>{k}</option>)}</select><button disabled={busy} type="button" className="icon-btn" aria-label={'Remove '+item.file.name} onClick={()=>modifyFile(item.id)}><Icon name="close"/></button></li>)}</ul>}
          <div className="composer-actions">
            <input hidden ref={input} type="file" accept={acceptedDocuments} multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>{attachment(e.target.files);e.target.value='';}}/>
            <button className="secondary" type="button" disabled={busy} onClick={()=>input.current?.click()}><Icon name="clip"/> Attach files</button>
            <div className="message-actions">
              <button type="submit" className="primary icon-btn" aria-label="Send message" disabled={busy||assistantPending||!(draft.trim()||newAttachments)}><Icon name="send"/></button>
            </div>
          </div>
        </form>
        {notice && <p role="alert" className="notice">{notice}</p>}
        {busy && <div className="processing-status"><p role="status" className="notice">{processingMessage}</p>
          <button className="secondary" type="button" onClick={()=>controller.current?.abort()}>Cancel processing</button>
        </div>}
        {!busy&&awaitReview&&<button className="secondary" onClick={()=>void generate(context,'retry')}>Retry unread files</button>}
      </section>
    </main>
    {mode==='study'&&<button ref={coachToggle} type="button" className="secondary coach-toggle" aria-expanded={coachOpen} aria-controls="study-coach-panel"
      onClick={()=>coachOpen?minimizeCoach():setCoachOpen(true)}><Icon name="spark"/> Coach</button>}
    <aside ref={coachPanel} id="study-coach-panel" className="coach-panel" aria-labelledby="coach-panel-title" hidden={mode!=='study'||!coachOpen}
      onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();minimizeCoach();}}}>
      <header className="info-heading"><h2 id="coach-panel-title">Study Coach</h2>
        <button type="button" className="icon-btn" aria-label="Minimize Coach" onClick={minimizeCoach}><Icon name="close"/></button>
      </header>
      {book&&<nav className="coach-tools" aria-label="Coach workspace tools">
        <button type="button" className="link" disabled={!activeBookContent} onClick={openQuiz}>Quiz</button>
        <button type="button" className="link" onClick={()=>{outlineRequest.current?.start();mapDialog.current?.showModal();}}>Topic Map</button>
        <button type="button" className="link" onClick={()=>infoDialog.current?.showModal()}>Sources</button>
      </nav>}
      {(discussion||activeBookPage)&&<div className="coach-context">
        <span>{discussion?.question?'Selected question':discussion?'Reference':'Current topic'} · {discussion?.title??activeBookPage?.title}</span>
        {discussion&&<button type="button" className="link" onClick={()=>setDiscussion(null)}>Clear reference</button>}
      </div>}
      <div className="coach-messages" ref={chatTranscript} role="log" aria-label="Coach messages" onScroll={event=>{
        const log=event.currentTarget;
        if(coachOpen)coachAtBottom.current=log.scrollHeight-log.scrollTop-log.clientHeight<50;
      }}>
        <div ref={coachContent}>
        {messages.filter(message=>!message.inline).map((message,index)=><div className={'conversation-message '+(message.role==='You'?'message-user':'message-reply')} key={index}>
          <span className="sr-only">{message.role}</span>
          {message.pending?(streamingReply?.message===message?<p style={{whiteSpace:'pre-wrap'}}>{streamingReply.text}</p>:<small role="status">Thinking…</small>):message.error?<p role="alert">{message.error}{' '}
            {message.retry&&<button type="button" className="link accent" disabled={assistantPending} onClick={()=>retryAssistant(message)}>Retry</button>}</p>
            :message.role==='You'||message.offer?<p>{message.text}</p>:<><CoachAnswer text={message.text}/>
              <SourceStatus references={message.references??[]} generated={Boolean(message.generated)} openSource={reference=>open(null,reference)}/></>}
          {message.offer&&<button type="button" className="secondary" disabled={mode!=='study'||activePractice?.key!==message.offer.topic.key||practice.batches[message.offer.topic.key]?.pending}
            onClick={()=>{
              const offer=message.offer!;
              void practice.add(offer.topic,offer.count,offer.format);
              setMessages(current=>current.map(item=>item===message?{...item,offer:undefined,text:'Requested more questions for '+offer.topic.page.title+'.'}:item));
            }}>Add {message.offer.count} questions</button>}
        </div>)}
        </div>
      </div>
      <form className="coach-input" onSubmit={event=>{event.preventDefault();send(coachDraft,'coach');}}>
        <label htmlFor="coach-prompt" className="sr-only">Ask Study Coach</label>
        <textarea id="coach-prompt" ref={coachInput} rows={2} maxLength={500} value={coachDraft}
          onChange={event=>setCoachDraft(event.target.value)} placeholder="Ask about your work…"
          onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();send(coachDraft,'coach');}}}/>
        <button className="primary icon-btn" type="submit" aria-label="Send to Coach" disabled={busy||assistantPending||!coachDraft.trim()}><Icon name="send"/></button>
      </form>
    </aside>
    <dialog ref={mapDialog} aria-labelledby="topic-map-title"><div className="dialog-content">
      <div className="info-heading"><h2 id="topic-map-title">Topic Map</h2>
        <form method="dialog"><button className="icon-btn" aria-label="Close topic map"><Icon name="close"/></button></form>
      </div>
      {topicMap}
    </div></dialog>
    <dialog ref={quizDialog} aria-labelledby="quiz-title"><div className="dialog-content">
      <div className="info-heading"><h2 id="quiz-title">Quiz</h2>
        <form method="dialog"><button className="icon-btn" aria-label="Close quiz"><Icon name="close"/></button></form>
      </div>
      {quiz&&<ReviewForm key={quiz.key} items={quiz.items} subject={book?.subject}
        attempt={quizAttempts[quiz.key]} onAttempt={attempt=>setQuizAttempts(current=>({...current,[quiz.key]:attempt}))}
        revisit={title=>{
          const index=book?.pages.findIndex(page=>page.title===title)??-1;
          if(index>=0){quizDialog.current?.close();selectMode('study');openBookPage(index);}
        }} openSource={reference=>open(null,reference)}/>}
      <form method="dialog"><button className="link">Back to notes</button></form>
    </div></dialog>
    <dialog ref={infoDialog} aria-labelledby="study-info-title" onClick={event=>{if(event.target===event.currentTarget)event.currentTarget.close();}}>
      <div className="dialog-content info-content">
        <div className="info-heading"><h2 id="study-info-title">Study information</h2>
          <form method="dialog"><button className="icon-btn" aria-label="Close study information"><Icon name="close"/></button></form>
        </div>
        {workspaceResult&&<div className="study-actions">
          <DownloadStudyPack pack={pack} notesOnly/><button className="secondary" disabled={busy} onClick={()=>{infoDialog.current?.close();reset();}}>Start over</button>
        </div>}
        {workspaceResult&&pack.warnings.length>0&&<details><summary>Sources and coverage</summary>
          <ul>{pack.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>
        </details>}
        {activeBookContent&&<section>
          <h3>Source verification</h3>
          <p>Sources links to the uploaded passages or web references used in an answer. Unverified explanations are labeled beside the study content.</p>
          {activeBookContent.webLimited&&<p>Web sources were unavailable for this result.</p>}
        </section>}
        {activeApi.prepare&&documents.length>0&&<DocumentReview documents={documents} files={files} busy={busy} onVerify={verifyPage}/>}
        <p>Original files stay on this device. Extracted text is sent for analysis.</p>
        <nav className="product-links" aria-label="Product information">
          <button className="link" onClick={()=>open('pricing')}>Plans</button>
          <button className="link" onClick={()=>open('privacy')}>Privacy</button>
          <button className="link" onClick={()=>open('terms')}>Terms</button>
        </nav>
      </div>
    </dialog>
    <dialog ref={dialog} aria-labelledby="dialog-title" onClose={()=>{setPreviewAttachmentId(null);setSource(null);}} onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.close();}}><div className="dialog-content"><form method="dialog" className="dialog-close"><button className="icon-btn" aria-label="Close dialog"><Icon name="close"/></button></form>
      {previewAttachment?<div className="attachment-preview">
        <h2 id="dialog-title">{previewAttachment.file.name}</h2>
        {sourceUrl&&<a className="link accent" href={sourceUrl} target="_blank" rel="noopener noreferrer">Open original file</a>}
        <label>Document type
          <select value={previewAttachment.kind} disabled={busy} onChange={event=>modifyFile(previewAttachment.id,event.target.value)}>
            {documentKinds.map(kind=><option key={kind}>{kind}</option>)}
          </select>
        </label>
        <button type="button" className="link" disabled={busy} onClick={()=>{
          dialog.current?.close();
          setPreviewAttachmentId(null);
          modifyFile(previewAttachment.id);
        }}>Remove attachment</button>
      </div>:source?<><h2 id="dialog-title">{source.file}</h2><p>{source.file==='Pasted text'?source.number:documentLocation(source.file,source.page)+' · '+source.number}{source.file!=='Pasted text'&&source.method==='ocr'?' · OCR text':source.file!=='Pasted text'&&source.method==='manual'?' · Manually verified text':''}</p><blockquote>{source.supportingQuote||source.excerpt}</blockquote>{sourceUrl&&<a className="link accent" target="_blank" rel="noopener noreferrer" href={originalDocumentLink(source.file,sourceUrl,source.page)}>{documentFormat(source.file)==='pdf'?'Open original PDF at page '+source.page:'Open original file'}</a>}</>:page==='pricing'?<Plans/>:page==='privacy'?<><h2 id="dialog-title">Privacy preview</h2><p>Original files stay in browser memory. In the study planner, extracted text and pasted text are sent to the analysis endpoint for scoring. This version keeps no saved sessions. Reloading clears the browser session.</p></>:<><h2 id="dialog-title">Terms preview</h2><p>Use materials you have permission to use. Use rankings as study guidance. No passing guarantee or university affiliation.</p></>}
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
    appRoot.render(<p role="alert">The study workspace could not start. Refresh to retry.</p>);
  });
}

