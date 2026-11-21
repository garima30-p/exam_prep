import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { demoApi, duration, fitQuestions, materialType } from './api';
import type { Analysis, Context, ExamApi, Material, Question, Source } from './api';
import { familiarityFrom, makeLearningPlan } from '../server/learning.mjs';
import type { CheckpointState, Progress } from '../server/learning.mjs';
import { countQuestions } from '../server/page-text.mjs';
import { documentComplete } from './document-state';
import type { ExtractedDocument } from './document-state';
import { DocumentReview } from './document-review';
import { playThemeSound } from './theme-sound';
import './style.css';

const sample = "My DBMS exam is tomorrow. I have 5 hours and need 40/100 to pass. Tell me what to prepare first.";
const empty:Context = {subject:'',date:'',minutes:0,pass:'',pattern:'',familiarity:'unknown'};
const familiarityLabels={unknown:'Unspecified',scratch:'Starting from scratch',familiar:'Somewhat familiar',revising:'Mostly revising'};
const preparationLabels={completed:'Checkpoints completed',revision:'Needs revision','in-progress':'In progress','not-started':'Not started'};
type Page = 'pricing'|'privacy'|'terms';
type Message = {role:'You'|'Demo coach'|'Study coach'; text:string; source?:Source};

const themes = {simple:'Simple', anime:'JJK-inspired', soft:'Cute'} as const;
type Theme = keyof typeof themes;
const themeKey = 'in-nocent-theme';

function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(themeKey);
    if (value === 'anime' || value === 'soft') return value;
  } catch { /* Storage may be unavailable. */ }
  return 'simple';
}

function ThemeScene({theme}:{theme:'anime'|'soft'}) {
  const anime=theme==='anime';
  return <div className="theme-scene">
    {anime
      ? <div className="scene-props storm-props">
          <span className="storm-bolt" aria-hidden="true"/>
          <div className="gojo" role="img" aria-label="Satoru Gojo"><span className="gojo-face"/><span className="gojo-hair"/><span className="gojo-blindfold"/></div>
          <span className="storm-bolt storm-bolt-small" aria-hidden="true"/>
        </div>
      : <div className="scene-props cute-props" aria-hidden="true">
          <span className="cute-prop">🧋</span>
          <span className="cute-prop">🐈</span>
          <span className="cute-prop cute-fidget"><i/><i/><i/><i/></span>
          <span className="cute-prop">🐱</span>
          <span className="cute-prop">🧸</span>
        </div>}
  </div>;
}

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

export function App({api=demoApi}:{api?:ExamApi}) {
  const [theme,setTheme]=useState(savedTheme);
  function selectTheme(next:Theme) {
    setTheme(next);
    if (next!=='simple') void playThemeSound(next).catch(()=>{ /* Theme selection also works without audio. */ });
  }
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
      getComputedStyle(document.documentElement).backgroundColor);
    try { localStorage.setItem(themeKey,theme); } catch { /* Theme still applies for this session. */ }
  },[theme]);
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
  const [dragging,setDragging]=useState(false);
  const [result,setResult]=useState<readonly Question[]|null>(null);
  const [warnings,setWarnings]=useState<string[]>([]);
  const [optimization,setOptimization]=useState<{data:NonNullable<Analysis['optimization']>;context:Context}|null>(null);
  const [progress,setProgress]=useState<Progress>({});
  const [elapsed,setElapsed]=useState(0);
  const timeAnchor=useRef(Date.now());
  const [messages,setMessages]=useState<Message[]>([]);
  const [chat,setChat]=useState('');
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
      if(!/\.pdf$/i.test(file.name) || file.size>20*1024*1024) { errors.push(file.name); continue; }
      if(files.some(item=>item.file.name===file.name && item.file.size===file.size && item.file.lastModified===file.lastModified) ||
        accepted.some(item=>item.file.name===file.name && item.file.size===file.size && item.file.lastModified===file.lastModified)) continue;
      if(files.length+accepted.length>=8) { errors.push(file.name); continue; }
      accepted.push({id:++nextFile.current,file,kind:materialType(file.name)});
    }
    setFiles([...files,...accepted]);
    if(accepted.length){setPlanGenerated(false);setAwaitReview(false);}
    setNotice(errors.length ? 'Could not attach ' + errors.join(', ') + '. Add up to 8 PDFs of 20 MB each.' : '');
  };
  const editPrompt=(value:string)=>{setPrompt(value);setContext(activeApi.parse(value));setNeedsTime(false);setPlanGenerated(false);};
  const restartBudget=()=>{timeAnchor.current=Date.now();setElapsed(0);};
  const update=<K extends keyof Context,>(key:K,value:Context[K])=>{
    if(key==='minutes')restartBudget();
    setContext(current=>({...current,[key]:value}));
  };
  async function generate(event?:FormEvent, adjusted=context,mode:'normal'|'retry'|'continue'='normal') {
    event?.preventDefault();
    if(controller.current) return;
    if(!prompt.trim() && !files.length) {setNotice('Describe your exam or attach a PDF to begin.');return;}
    if(!adjusted.minutes){setNeedsTime(true);return;}
    setNeedsTime(false);setNotice('');setBusy(true);
    const run=new AbortController();
    controller.current=run;
    setProcessingMessage(activeApi.prepare&&files.length?'Opening attached PDFs…':'Building your plan…');
    try {
      let records=documents.filter(document=>files.some(file=>file.id===document.id));
      if(activeApi.prepare&&files.length&&mode!=='continue'){
        records=await activeApi.prepare(files,{records,signal:run.signal,retry:mode==='retry',
          onUpdate:({documents:updated,message})=>{setDocuments(updated);setProcessingMessage(message);}});
        setDocuments(records);
        if(records.some(document=>!documentComplete(document))){
          setAwaitReview(true);
          return;
        }
      }
      run.signal.throwIfAborted();
      setAwaitReview(false);
      setProcessingMessage('Building your plan…');
      const analysis=await activeApi.analyze(adjusted, files, prompt,{documents:records,signal:run.signal,
        onPlanning:()=>setProcessingMessage('Matching equivalent questions and building your plan…')});
      run.signal.throwIfAborted();
      setResult(analysis.questions);setWarnings(analysis.warnings);
      setOptimization(analysis.optimization?{data:analysis.optimization,context:adjusted}:null);
      setProgress({});restartBudget();setLimit(10);setMessages([]);setPlanGenerated(true); }
    catch(error) { setNotice(run.signal.aborted?'Processing cancelled. Run again to resume from usable pages.':error instanceof Error?error.message:'The study plan could not load. Try again.'); }
    finally {controller.current=null;setProcessingMessage('');setBusy(false);}
  }
  const remainingTime=Math.max(0,context.minutes-elapsed);
  const plan=useMemo(()=>{
    if(!optimization)return null;
    const {data,context:original}=optimization;
    if(data.plan.totalAvailableMinutes===remainingTime&&original.pattern===context.pattern&&
      original.familiarity===context.familiarity&&!Object.keys(progress).length)return data.plan;
    return makeLearningPlan(data.candidates,data.topics,remainingTime,context.pattern,context.familiarity,progress);
  },[optimization,remainingTime,context.pattern,context.familiarity,progress]);
  const fitted=plan&&optimization
    ? plan.selectedQuestionIds.map(id=>optimization.data.candidates.find(question=>question.id===id)!)
    : fitQuestions(result ?? [],context.minutes);
  const visible=fitted.slice(0,limit);
  const plannedIds=new Set(fitted.map(question=>question.id));
  const tracked=optimization?.data.candidates.filter(question=>!plannedIds.has(question.id)&&progress[question.id])??[];
  const coveredUnits=[...new Set(visible.map(question=>question.unit).filter(Boolean))].sort((a,b)=>a-b);
  const missingUnits=[...new Set(result?.map(question=>question.unit).filter(unit=>unit&&!coveredUnits.includes(unit)))].sort((a,b)=>a-b);
  function send(text:string, target?:Question, marks?:number) {
    if(!text.trim())return;
    const minutes=duration(text);
    const familiarity=familiarityFrom(text);
    let reply:string;
    if(minutes && /left|replan|only|have/i.test(text)) {
      update('minutes',minutes);setLimit(10);
      if(familiarity!=='unknown')update('familiarity',familiarity);
      reply='Updated the plan for '+minutes+' minutes, including time for recall.';
    } else if(familiarity!=='unknown') {
      update('familiarity',familiarity);
      setElapsed(Math.max(0,Math.floor((Date.now()-timeAnchor.current)/60000)));
      setLimit(10);
      reply='Updated your preparation estimates for “'+familiarityLabels[familiarity].toLowerCase()+'”. Your checkpoint progress is still available.';
    } else if(/next\s+(?:10|ten)|more questions/i.test(text)) {
      setLimit(current=>current+10);
      reply=limit<fitted.length?'I added the next questions below.':'The current materials and study budget support '+fitted.length+' questions.';
    } else {
      const ranked=visible.map((question,index)=>({...question,id:index+1}));
      reply=activeApi.chat(text,target?[{...target,id:visible.indexOf(target)+1}]:ranked);
      if(target && marks && sampleMode) {
        const sentences=target.answer.match(/[^.!?]+[.!?]*/g) ?? [target.answer];
        reply='Sample '+marks+'-mark outline · '+target.topic+'\n'+(marks===2?sentences.slice(0,2).join('').trim():target.answer);
        if(marks===10) reply+='\nFor a longer response, define the terms and develop a worked example.';
      }
    }
    const answerSource=/answer|explain|mark/i.test(text)?target?.answerSource:null;
    setMessages(current=>[...current,{role:'You',text},{role:sampleMode?'Demo coach':'Study coach',text:reply,source:answerSource??undefined}]);setChat('');
  }
  function open(next:Page|null, reference:Source|null=null){setPage(next);setSource(reference);dialog.current?.showModal();}
  function reset(){setExampleMode(false);setResult(null);setOptimization(null);setProgress({});restartBudget();setWarnings([]);setMessages([]);setFiles([]);setDocuments([]);setAwaitReview(false);setPrompt('');setContext(empty);setNeedsTime(false);setNotice('');setTimeReply('');setPlanGenerated(false);}
  function toggleExample(){setResult(null);setOptimization(null);setProgress({});restartBudget();setWarnings([]);setAwaitReview(false);setExampleMode(!exampleMode);editPrompt(exampleMode?'':sample);}
  function modifyFile(id:number,kind?:string) {
    setFiles(current=>kind?current.map(file=>file.id===id?{...file,kind}:file):current.filter(file=>file.id!==id));
    setDocuments(current=>current.filter(document=>document.id!==id));
    setAwaitReview(false);setPlanGenerated(false);
  }
  function verifyPage(id:number,number:number,text:string){
    const kind=files.find(file=>file.id===id)?.kind;
    setDocuments(current=>current.map(document=>document.id!==id?document:{...document,pages:document.pages.map(page=>page.number!==number?page:{
      ...page,text:text.trim(),status:'verified',method:'manual',questions:countQuestions(text,kind==='Past paper'),reason:''})}));
    setPlanGenerated(false);
  }
  function changeCheckpoint(questionId:number,id:string,status:CheckpointState){
    setProgress(current=>({...current,[questionId]:{...current[questionId],[id]:status}}));
    setElapsed(Math.max(0,Math.floor((Date.now()-timeAnchor.current)/60000)));
  }
  function renderQuestion(q:Question,index?:number){
    const effort=plan?.efforts[q.id];
    return <article className="question" key={q.id}>
      <div className="question-meta">{index!==undefined&&<span className="rank">#{index+1}</span>}<span>{q.topic}{q.unit?' · Unit '+q.unit:''}</span><span className="spacer"/><span>{effort?.minutes??q.minutes} min{q.marks?' · '+q.marks+' marks':''}</span></div>
      <h3>{q.prompt}</h3><p>{q.reason}.</p>
      {(q.sources??[q.source]).map((reference,i)=><button key={i} className="link accent source" onClick={()=>open(null,reference)}><Icon name="file"/>{reference.file} · {reference.file==='Pasted text'?reference.number:'p. '+reference.page+' · '+reference.number}</button>)}
      {effort&&q.learning&&<details className="checkpoints">
        <summary>{q.learning.type} · {preparationLabels[effort.status]} · {effort.completed}/{effort.total} checkpoints</summary>
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
      {index!==undefined&&<div className="question-actions">
        {sampleMode?[2,5,10].map(m=><button className="secondary" key={m} onClick={()=>send('Show a '+m+'-mark answer for #'+(index+1),q,m)}>{m}-mark answer</button>):<button className="secondary" onClick={()=>send('Show answer evidence for #'+(index+1),q)}>Show answer evidence</button>}
        <button className="secondary" onClick={()=>send('Why #'+(index+1)+'?',q)}>Ask why?</button>
      </div>}
    </article>;
  }
  const hasContext=Boolean(prompt.trim() || files.length);
  const hasUnreadPages=documents.some(document=>!documentComplete(document));
  return <>
    <header className="top"><div className="wrap header-inner">
      <a className="brand" href="#main" aria-label="in-nocent home"><span className="brand-mark"><Icon name="spark"/></span>in-nocent<span className="brand-dot">.</span></a>
      <label className="theme-picker"><span>Theme</span><select value={theme} onChange={event=>selectTheme(event.target.value as Theme)}>
        {Object.entries(themes).map(([value,label])=><option key={value} value={value}>{label}</option>)}
      </select></label>
    </div></header>
    <main id="main" className={'wrap '+(result?'workspace':'landing')}>
      <section className="hero">
        <h1>Exam <em>planner</em></h1>
        {theme!=='simple'&&<ThemeScene key={theme} theme={theme}/>}
      </section>
      <section aria-label="Exam setup" className="setup">
        <form onSubmit={generate} className={'composer '+(dragging?'dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);attachment(e.dataTransfer.files);}}>
          <label htmlFor="prompt">Exam details</label>
          <textarea id="prompt" value={prompt} disabled={busy} onChange={e=>editPrompt(e.target.value)} placeholder="e.g. DBMS exam tomorrow, 5 hours to study" rows={3} maxLength={8000}/>
          {files.length>0 && <ul className="files">{files.map(item=><li key={item.id}><Icon name="file"/><span title={item.file.name}>{item.file.name}</span><select disabled={busy} aria-label={'Type for '+item.file.name} value={item.kind} onChange={e=>modifyFile(item.id,e.target.value)}>{['Unclassified','Syllabus','Past paper','Notes'].map(k=><option key={k}>{k}</option>)}</select><button disabled={busy} type="button" className="icon-btn" aria-label={'Remove '+item.file.name} onClick={()=>modifyFile(item.id)}><Icon name="close"/></button></li>)}</ul>}
          <div className="composer-actions">
            <input hidden ref={input} type="file" accept="application/pdf,.pdf" multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>{attachment(e.target.files);e.target.value='';}}/>
            <button className="secondary" type="button" disabled={busy} onClick={()=>input.current?.click()}><Icon name="clip"/> Attach PDFs</button>
            {planGenerated
              ? <a className="primary" href="#results-title">Plan generated<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v15m-6-6 6 6 6-6"/></svg></a>
              : <button className="primary" disabled={busy} type="submit">{busy?'Preparing plan…':'Generate plan'}</button>}
          </div>
        </form>
        {notice && <p role="alert" className="notice">{notice}</p>}
        {hasContext && <fieldset className="context" disabled={busy}><legend>Plan settings</legend>
          <label>Exam<input value={context.subject} placeholder="Subject" onChange={e=>update('subject',e.target.value)}/></label>
          <label>Date<input value={context.date} placeholder="Exam date" onChange={e=>update('date',e.target.value)}/></label>
          <label>Minutes<input type="number" min="0" max="525600" value={context.minutes||''} placeholder="Study time" onChange={e=>update('minutes',Math.max(0,Math.min(525600,Math.floor(Number(e.target.value)))))}/></label>
          <label>Pass mark<input value={context.pass} placeholder="Optional" onChange={e=>update('pass',e.target.value)}/></label>
          <label>Paper rules<input value={context.pattern} placeholder="Optional" onChange={e=>update('pattern',e.target.value)}/></label>
          {context.familiarity!=='unknown'&&<span className="file-count">{familiarityLabels[context.familiarity]}</span>}
        </fieldset>}
        {needsTime && <form className="followup" onSubmit={e=>{e.preventDefault();const minutes=duration(timeReply)||(/^\d+$/.test(timeReply.trim())?Number(timeReply):0);if(!minutes||!Number.isSafeInteger(minutes)){setNotice('Enter study time in minutes or hours.');return;} const adjusted={...context,minutes};setContext(adjusted);void generate(undefined,adjusted);}}><label htmlFor="time">How much time do you have to study?</label><div className="inline"><input autoFocus id="time" value={timeReply} onChange={e=>setTimeReply(e.target.value)} placeholder="e.g. 2 hours"/><button className="primary">Continue</button></div></form>}
        <div className="setup-meta"><button className="link accent" type="button" disabled={busy} onClick={toggleExample}>{exampleMode?'Exit demo':'Try an example'}</button>{sampleMode?<small>Demo · Sample DBMS data</small>:hasContext&&<small>PDFs stay on device. Text is sent for analysis.</small>}</div>
        {busy && <div className="processing-status"><p role="status" className="notice">{sampleMode?'Loading sample questions…':processingMessage}</p>
          {!sampleMode&&<button className="secondary" type="button" onClick={()=>controller.current?.abort()}>Cancel processing</button>}
        </div>}
        {!sampleMode&&activeApi.prepare&&<DocumentReview documents={documents} files={files} busy={busy} onVerify={verifyPage}/>}
        {!busy&&!sampleMode&&(awaitReview||hasUnreadPages)&&<div className="coverage">
          {hasUnreadPages
            ? <><p>Some pages need review. Continuing uses only usable text. Incomplete past papers are excluded from frequency counts.</p>
              <div className="processing-status"><button className="secondary" type="button" onClick={()=>void generate(undefined,context,'retry')}>Retry unread pages</button>{awaitReview&&<button className="primary" type="button" onClick={()=>void generate(undefined,context,'continue')}>Continue with incomplete evidence</button>}</div></>
            : <button className="primary" type="button" onClick={()=>void generate(undefined,context,'continue')}>Build verified plan</button>}
        </div>}
      </section>
      {result && <section className="results" aria-labelledby="results-title">
        <div className="result-top"><h2 id="results-title" tabIndex={-1}>{sampleMode?'Sample study plan':'Study plan'}</h2><button className="secondary" disabled={busy} onClick={reset}>Start over</button></div>
        <div className="summary"><span>Exam: {context.subject||'Unspecified'}</span><span>{plan?.totalAvailableMinutes??context.minutes} min remaining</span><span>{files.length} PDFs attached</span><span>{sampleMode?'Evidence: demo fixtures':result.some(q=>q.reason.startsWith('Found in'))?'Evidence: uploaded past papers':'Evidence: supplied text'}</span></div>
        {warnings.length>0&&<ul className="notice" aria-label="Extraction warnings">{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
        {plan&&<p className="notice">Full plan · {plan.estimatedPreparationMinutes} of {plan.preparationBudgetMinutes} preparation minutes · {plan.revisionMinutes} min reserved for revision · {plan.coveredTopicIds.length} identified topics covered</p>}
        {plan&&plan.warnings.length>0&&<ul className="notice" aria-label="Preparation warnings">{plan.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
        <div className="result-grid"><div>
          {visible.map((question,index)=>renderQuestion(question,index))}
          <div className="coverage"><h3>Coverage gaps</h3>
            {!result.length?<p>No usable questions were identified. Try a text-selectable past paper or paste the question lines directly.</p>:!visible.length?<p>{plan?.preparedQuestionIds.length===result.length?'All candidate checkpoints are marked completed. Revisit a question below whenever needed.':'No additional question fits the remaining preparation budget.'}</p>:<p>{coveredUnits.length?'Identified units: '+coveredUnits.join(', ')+'. ':''}Check compulsory sections and passing-mark coverage against your paper.</p>}
            {missingUnits.length>0&&<p>Units in the material missing from this shortlist: {missingUnits.join(', ')}.</p>}
            {visible.length<10&&fitted.length<result.length&&<p>Allow more study time to include additional topics.</p>}
          </div>
          {limit<fitted.length && <button className="secondary" onClick={()=>send('Show next 10')}>Show next 10</button>}
          {tracked.length>0&&<details className="coverage"><summary>Revisit checkpoint progress ({tracked.length})</summary>{tracked.map(question=>renderQuestion(question))}</details>}
        </div><aside className="coach" aria-label="Contextual chat"><h3><Icon name="spark"/> Study coach {sampleMode&&<span className="badge">Demo</span>}</h3><div className="messages" role="log" aria-label="Chat messages" tabIndex={0}>{messages.length===0?<p>Ask about a question, check unit coverage, or change your study time.</p>:messages.map((m,i)=><div key={i}><strong>{m.role}</strong><p>{m.text}</p>{m.source&&<button className="link accent" onClick={()=>open(null,m.source)} >View answer source</button>}</div>)}</div><form className="inline" onSubmit={e=>{e.preventDefault();send(chat);}}><input aria-label="Ask about your plan" placeholder="Ask about your plan…" maxLength={1000} value={chat} onChange={e=>setChat(e.target.value)}/><button className="primary icon-btn" aria-label="Send chat message" disabled={!chat.trim()}><Icon name="send"/></button></form></aside></div>
      </section>}
    </main>
    <footer className="wrap footer"><nav aria-label="Product information"><button className="link" onClick={()=>open('pricing')}>Plans</button><button className="link" onClick={()=>open('privacy')}>Privacy</button><button className="link" onClick={()=>open('terms')}>Terms</button></nav></footer>
    <dialog ref={dialog} aria-labelledby="dialog-title" onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.close();}}><div className="dialog-content"><form method="dialog" className="dialog-close"><button className="icon-btn" aria-label="Close dialog"><Icon name="close"/></button></form>
      {source?<><h2 id="dialog-title">{source.file}</h2><p>{sampleMode?'Sample fixture · ':''}{source.file==='Pasted text'?source.number:'Page '+source.page+' · '+source.number}{source.file!=='Pasted text'&&source.method==='ocr'?' · OCR text':source.file!=='Pasted text'&&source.method==='manual'?' · Manually verified text':''}</p><blockquote>{source.excerpt}</blockquote>{sourceUrl&&<a className="link accent" target="_blank" rel="noopener noreferrer" href={sourceUrl+'#page='+source.page}>Open original PDF at page {source.page}</a>}</>:page==='pricing'?<Plans/>:page==='privacy'?<><h2 id="dialog-title">Privacy preview</h2><p>PDF files stay in browser memory. In the study planner, extracted text and pasted text are sent to the analysis endpoint for scoring. This version keeps no saved sessions. Reloading clears the browser session.</p></>:<><h2 id="dialog-title">Terms preview</h2><p>Use materials you have permission to use. Use rankings as study guidance. No passing guarantee or university affiliation.</p></>}
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

