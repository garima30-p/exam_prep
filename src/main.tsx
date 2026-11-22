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
import { acceptedDocuments, documentFormat, documentLocation, originalDocumentLink } from './document-formats';
import { StudyCharacter, ThemeHero, ThemePicker, useTheme } from './themes';
import { answerLines, buildStudyPack, familiarityLabels, sourceLabel } from './study-pack';
import { DownloadStudyPack, StudyOutput } from './study-output';
import { revise, revisionFromAnswer } from './revision';
import type { Revision } from './revision';
import './style.css';

const sample = "My DBMS exam is tomorrow. I have 5 hours and need 40/100 to pass. Tell me what to prepare first.";
const empty:Context = {subject:'',date:'',minutes:0,pass:'',pattern:'',familiarity:'unknown'};
const preparationLabels={completed:'Checkpoints completed',revision:'Needs revision','in-progress':'In progress','not-started':'Not started'};
type Page = 'pricing'|'privacy'|'terms';
type Message = {role:'You'|'Demo coach'|'Study coach'; text:string; source?:Source};

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
  const resultHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(planGenerated&&!editing){resultHeading.current?.focus();resultHeading.current?.scrollIntoView?.({block:'start'});}},[planGenerated,editing]);
  const [dragging,setDragging]=useState(false);
  const [result,setResult]=useState<readonly Question[]|null>(null);
  const [warnings,setWarnings]=useState<string[]>([]);
  const [optimization,setOptimization]=useState<{data:NonNullable<Analysis['optimization']>;context:Context}|null>(null);
  const [progress,setProgress]=useState<Progress>({});
  const [elapsed,setElapsed]=useState(0);
  const timeAnchor=useRef(Date.now());
  const [messages,setMessages]=useState<Message[]>([]);
  const [chat,setChat]=useState('');
  const [generatedCoach,setGeneratedCoach]=useState(false);
  const [coachPending,setCoachPending]=useState(false);
  const lastCoachQuestion=useRef<Question | undefined>(undefined);
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
  const editPrompt=(value:string)=>{setPrompt(value);setContext(activeApi.parse(value));setNeedsTime(false);setPlanGenerated(false);};
  const restartBudget=()=>{timeAnchor.current=Date.now();setElapsed(0);};
  const update=<K extends keyof Context,>(key:K,value:Context[K])=>{
    if(key==='minutes')restartBudget();
    setContext(current=>({...current,[key]:value}));
  };
  async function generate(event?:FormEvent, adjusted=context,mode:'normal'|'retry'|'continue'='normal') {
    event?.preventDefault();
    if(controller.current) return;
    if(!prompt.trim() && !files.length) {setNotice('Describe your exam or attach a file to begin.');return;}
    if(!adjusted.minutes&&/\b(?:timed plan|(?:make|build|create|give me) (?:a |my )?(?:study|revision|preparation) plan)\b/i.test(prompt.split(/summari[sz]e (?:my |these |the )?notes:/i)[0])){setNeedsTime(true);return;}
    setNeedsTime(false);setNotice('');setBusy(true);
    const run=new AbortController();
    controller.current=run;
    setProcessingMessage(activeApi.prepare&&files.length?'Opening attachments…':'Building your plan…');
    try {
      let records=documents.filter(document=>files.some(file=>file.id===document.id));
      if(activeApi.prepare&&files.length&&mode!=='continue'){
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
      const extracted=sampleMode?null:revise(prompt,records,files,adjusted.subject);
      let analysis:Analysis;
      try {
        analysis=await activeApi.analyze(adjusted, files, prompt,{documents:records,signal:run.signal,
          onPlanning:()=>setProcessingMessage('Matching equivalent questions and building your plan…')});
      } catch(error) {
        run.signal.throwIfAborted();
        if(!extracted)throw error;
        analysis={questions:[],warnings:['Question ranking is temporarily unavailable.']};
      }
      const summary=extracted??revisionFromAnswer(analysis.questions.find(question=>question.answerSource))
        ??(sampleMode&&analysis.questions[0]?revise(analysis.questions[0].answer,[],[],analysis.questions[0].topic):null);
      if(!summary&&!analysis.questions.length){
        setNotice('No study content could be read. Paste a readable passage or replace the attachment.');
        return;
      }
      setRevision(summary);setEditing(false);
      run.signal.throwIfAborted();
      setResult(analysis.questions);setWarnings(analysis.warnings);setGeneratedCoach(Boolean(analysis.generatedCoach));
      setOptimization(analysis.optimization?{data:analysis.optimization,context:adjusted}:null);
      setProgress({});restartBudget();setLimit(10);setMessages([]);lastCoachQuestion.current=undefined;setPlanGenerated(true); }
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
  const visible=(remainingTime||context.minutes?fitted:result??[]).slice(0,limit);
  const plannedIds=new Set(fitted.map(question=>question.id));
  const tracked=optimization?.data.candidates.filter(question=>!plannedIds.has(question.id)&&progress[question.id])??[];
  const coveredUnits=[...new Set(visible.map(question=>question.unit).filter(Boolean))].sort((a,b)=>a-b);
  const missingUnits=[...new Set(result?.map(question=>question.unit).filter(unit=>unit&&!coveredUnits.includes(unit)))].sort((a,b)=>a-b);
  const coverageMessage = missingUnits.length ? 'Units outside the current shortlist: '+missingUnits.join(', ')+'.' : '';
  const pack = buildStudyPack(context,remainingTime,plan,fitted,visible,optimization?.data.candidates??result??[],
    sampleMode,[...warnings,...(plan?.warnings??[]),coverageMessage].filter(Boolean));
  const readMinutes=revision&&remainingTime?Math.min(remainingTime,Math.max(1,Math.ceil(revision.passages.length/2))):0;
  if(revision){
    pack.revision=revision;
    if(readMinutes&&!pack.timeline.length)pack.timeline.push({title:revision.title+' · Read and recall',minutes:readMinutes});
  }
  const nextAction=pack.timeline[0];
  function send(text:string, target?:Question, marks?:number) {
    if(!text.trim())return;
    const minutes=duration(text);
    const familiarity=familiarityFrom(text);
    let reply:string;
    let answerSource:Source|null|undefined;
    let generateFor:Question|undefined;
    if(minutes && /\b(left|remaining|replan|have|time to study|can study)\b/i.test(text)) {
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
      const numbered = text.match(/(?:#|question\s+)(\d+)/i);
      const words = text.toLowerCase().match(/[a-z]{3,}/g)??[];
      const generic = new Set(['give','show','answer','suitable','marks','example','explain','simpler','english','what','about','this','that','minutes','minute']);
      const meaningful = words.filter(word=>!generic.has(word));
      const relevant = (result??[]).map(question=>({question, hits:meaningful.filter(word=>
        (question.topic+' '+question.prompt).toLowerCase().match(/[a-z]{3,}/g)?.includes(word)).length}))
        .filter(item=>item.hits>0).sort((a,b)=>b.hits-a.hits)[0]?.question;
      const asksForContent=/\b(answer|explain|simpler|example|marks?|define)\b/i.test(text);
      const selected=target??(numbered?visible[Number(numbered[1])-1]:relevant??(meaningful.length===0?lastCoachQuestion.current:undefined));
      if(selected)lastCoachQuestion.current=selected;
      if(asksForContent&&!sampleMode) {
        answerSource=selected?.answerSource;
        const excerpt=answerSource?.excerpt;
        if(!selected)reply='Name a topic from your materials or select a question to work on.';
        else if(!excerpt)reply='Your materials contain this question but no matching explanation. Add class notes or a solved answer to get a source-backed response.';
        else if(/\bexample\b/i.test(text)&&!/\b(example|suppose|consider|for instance)\b/i.test(excerpt))
          reply='The supporting passage does not contain a worked example. Here is the related evidence:\n'+answerLines(selected,false,15).join(' ');
        else {
          const focused=/\b(two minutes|2 min|simpler|brief)\b/i.test(text)?15:45;
          reply='From your materials · '+selected.topic+'\n'+answerLines(selected,false,focused).join('\n')+
            (/\bmarks?\b/i.test(text)?'\nUse these points to structure your answer. The material does not establish a marking rubric.':'');
        }
        if(generatedCoach&&selected&&(!excerpt||/\b(example|simpler)\b/i.test(text))&&!coachPending) generateFor=selected;
      } else reply=activeApi.chat(text,target?[{...target,id:visible.indexOf(target)+1}]:ranked);
      if(target && marks && sampleMode) {
        const sentences=target.answer.match(/[^.!?]+[.!?]*/g) ?? [target.answer];
        reply='Sample '+marks+'-mark outline · '+target.topic+'\n'+(marks===2?sentences.slice(0,2).join('').trim():target.answer);
        if(marks===10) reply+='\nFor a longer response, define the terms and develop a worked example.';
      }
    }
    const message:Message={role:sampleMode?'Demo coach':'Study coach',text:generateFor?'Preparing an explanation…':reply,source:answerSource??undefined};
    setMessages(current=>[...current,{role:'You',text},message]);setChat('');
    if(generateFor){
      setCoachPending(true);
      void fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),
        body:JSON.stringify({subject:context.subject,question:generateFor.prompt,request:text,evidence:generateFor.answerSource?.excerpt})})
        .then(async response=>{
          const data=await response.json() as {explanation?:string;error?:string};
          if(!response.ok||!data.explanation)throw new Error(data.error||'Generated explanation unavailable.');
          return 'Generated explanation · verify against your materials\n'+data.explanation;
        }).catch(error=>reply+'\n'+(error instanceof Error&&error.name==='Error'?error.message:'Generated explanation unavailable.'))
        .then(text=>setMessages(current=>current.map(item=>item===message?{...item,text}:item)))
        .finally(()=>setCoachPending(false));
    }
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
    if(status==='completed'&&progress[questionId]?.[id]!=='completed') setCharacterPulse(value=>value+1);
    setProgress(current=>({...current,[questionId]:{...current[questionId],[id]:status}}));
    setElapsed(Math.max(0,Math.floor((Date.now()-timeAnchor.current)/60000)));
  }
  function renderQuestion(q:Question,index?:number){
    const effort=plan?.efforts[q.id];
    return <article className="question" key={q.id}>
      <div className="question-meta">{index!==undefined&&<span className="rank">#{index+1}</span>}<span>{q.topic}{q.unit?' · Unit '+q.unit:''}</span><span className="spacer"/><span>{effort?.minutes??q.minutes} min{q.marks?' · '+q.marks+' marks':''}</span></div>
      <h3>{q.prompt}</h3><p>{q.reason}.</p>
      {!sampleMode&&q.answerSource&&<details className="checkpoints"><summary>Source-backed answer</summary>
        {answerLines(q,false,remainingTime).map((text,index)=><p key={index}>{text}</p>)}
        <button className="link accent" onClick={()=>open(null,q.answerSource!)}>{sourceLabel(q.answerSource)}</button>
      </details>}
      {!sampleMode&&!q.answerSource&&<p>No supporting answer passage is available.</p>}
      {(q.sources??[q.source]).map((reference,i)=><button key={i} className="link accent source" onClick={()=>open(null,reference)}><Icon name="file"/>{sourceLabel(reference)}</button>)}
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
  return <>
    <header className="top"><div className="wrap header-inner">
      <a className="brand" href="#main" aria-label="in-nocent home"><span className="brand-mark"><Icon name="spark"/></span>in-nocent<span className="brand-dot">.</span></a>
      <ThemePicker {...theme}/>
    </div></header>
    <main id="main" className={'wrap '+(planGenerated?'workspace':'landing')}>
      <ThemeHero {...theme}/>
      {planGenerated&&!editing?<button className="secondary" onClick={()=>setEditing(true)}>Edit input</button>:<section aria-label="Exam setup" className="setup">
        <form onSubmit={generate} className={'composer '+(dragging?'dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);attachment(e.dataTransfer.files);}}>
          <label htmlFor="prompt">Paste notes or add a file</label>
          <textarea id="prompt" value={prompt} disabled={busy} onChange={e=>editPrompt(e.target.value)} placeholder="Paste a passage, or describe what you want to revise" rows={3} maxLength={8000}/>
          {files.length>0 && <ul className="files">{files.map(item=><li key={item.id}><Icon name="file"/><span title={item.file.name}>{item.file.name}</span><select disabled={busy} aria-label={'Type for '+item.file.name} value={item.kind} onChange={e=>modifyFile(item.id,e.target.value)}>{['Unclassified','Syllabus','Past paper','Notes'].map(k=><option key={k}>{k}</option>)}</select><button disabled={busy} type="button" className="icon-btn" aria-label={'Remove '+item.file.name} onClick={()=>modifyFile(item.id)}><Icon name="close"/></button></li>)}</ul>}
          <div className="composer-actions">
            <input hidden ref={input} type="file" accept={acceptedDocuments} multiple onChange={(e:ChangeEvent<HTMLInputElement>)=>{attachment(e.target.files);e.target.value='';}}/>
            <button className="secondary" type="button" disabled={busy} onClick={()=>input.current?.click()}><Icon name="clip"/> Attach files</button>
            <button className="primary" disabled={busy} type="submit">{busy?'Summarizing…':'Summarize'}</button>
          </div>
        </form>
        {notice && <p role="alert" className="notice">{notice}</p>}
        {hasContext && <details><summary>Edit details</summary><fieldset className="context" disabled={busy}><legend>Plan settings</legend>
          <label>Exam<input value={context.subject} placeholder="Subject" onChange={e=>update('subject',e.target.value)}/></label>
          <label>Date<input value={context.date} placeholder="Exam date" onChange={e=>update('date',e.target.value)}/></label>
          <label>Minutes<input type="number" min="0" max="525600" value={context.minutes||''} placeholder="Study time" onChange={e=>update('minutes',Math.max(0,Math.min(525600,Math.floor(Number(e.target.value)))))}/></label>
          <label>Pass mark<input value={context.pass} placeholder="Optional" onChange={e=>update('pass',e.target.value)}/></label>
          <label>Paper rules<input value={context.pattern} placeholder="Optional" onChange={e=>update('pattern',e.target.value)}/></label>
          {context.familiarity!=='unknown'&&<span className="file-count">{familiarityLabels[context.familiarity]}</span>}
        </fieldset></details>}
        {needsTime && <form className="followup" onSubmit={e=>{e.preventDefault();const minutes=duration(timeReply)||(/^\d+$/.test(timeReply.trim())?Number(timeReply):0);if(!minutes||!Number.isSafeInteger(minutes)){setNotice('Enter study time in minutes or hours.');return;} const adjusted={...context,minutes};setContext(adjusted);void generate(undefined,adjusted);}}><label htmlFor="time">How many minutes can you study?</label><div className="inline"><input autoFocus id="time" value={timeReply} onChange={e=>setTimeReply(e.target.value)} placeholder="e.g. 2 hours"/><button className="primary">Continue</button></div></form>}
        <div className="setup-meta"><button className="link accent" type="button" disabled={busy} onClick={toggleExample}>{exampleMode?'Exit demo':'Try an example'}</button>{sampleMode?<small>Demo · Sample DBMS data</small>:hasContext&&<small>Original files stay on device. Text is sent for analysis.</small>}</div>
        {busy && <div className="processing-status"><p role="status" className="notice">{sampleMode?'Loading sample questions…':processingMessage}</p>
          {!sampleMode&&<button className="secondary" type="button" onClick={()=>controller.current?.abort()}>Cancel processing</button>}
        </div>}
        {!sampleMode&&activeApi.prepare&&<DocumentReview documents={documents} files={files} busy={busy} onVerify={verifyPage}/>}
        {!busy&&!sampleMode&&awaitReview&&<button className="secondary" onClick={()=>void generate(undefined,context,'retry')}>Retry unread files</button>}
      </section>}
      {result && planGenerated && <section className="results" aria-labelledby="results-title">
        <div className="result-top"><div className="study-heading">{theme.anime&&theme.character&&<StudyCharacter anime={theme.anime} character={theme.character} pulse={characterPulse}/>}<h2 id="results-title" ref={resultHeading} tabIndex={-1}>{revision?.title??'Past-paper questions'}</h2></div><div className="study-actions"><DownloadStudyPack pack={pack}/><button className="secondary" disabled={busy} onClick={reset}>Start over</button></div></div>
        <div className="summary">{pack.context.map(value=><span key={value}>{value}</span>)}</div>
        {revision?<article className="study-note" aria-label="Revision summary">
          {revision.passages.map((source,index)=><p key={index}>{source.excerpt}{' '}<button className="link accent" onClick={()=>open(null,source)}>{sourceLabel(source)}</button></p>)}
          <p><strong>Recall:</strong> {revision.recall}</p>
          <details key={revision.answer}><summary>Show answer</summary><p>{revision.answer}</p></details>
        </article>:<article className="study-note"><p>These are questions found in the material. They show what was asked, but no supporting answer was found.</p>
          {result.slice(0,3).map(question=><div key={question.id}><p>{question.prompt}</p><button className="link accent" onClick={()=>open(null,question.source)}>{sourceLabel(question.source)}</button></div>)}
        </article>}
        {nextAction&&<p className="notice"><strong>Start here:</strong> {nextAction.title} · {nextAction.minutes} min</p>}
        <details className="study-output" open={sampleMode||undefined}><summary>More study tools</summary>
        <StudyOutput pack={pack} openSource={reference=>open(null,reference)} ask={question=>{
          send('Explain '+question.topic,question);
          document.getElementById('study-coach-title')?.scrollIntoView?.({block:'nearest'});
        }}/>
        <div className="result-grid"><section aria-labelledby="important-questions">
          {(visible.length>0||tracked.length>0)&&<h3 id="important-questions">Important Questions</h3>}

          {visible.map((question,index)=>renderQuestion(question,index))}
          {limit<fitted.length && <button className="secondary" onClick={()=>send('Show next 10')}>Show next 10</button>}
          {tracked.length>0&&<details className="coverage"><summary>Revisit checkpoint progress ({tracked.length})</summary>{tracked.map(question=>renderQuestion(question))}</details>}
        </section><aside className="coach" aria-label="Contextual chat"><h3 id="study-coach-title"><Icon name="spark"/> Study coach {sampleMode&&<span className="badge">Demo</span>}</h3><div className="messages" role="log" aria-label="Chat messages" tabIndex={0}>{messages.length===0?<p>Ask about a question, check unit coverage, or change your study time.</p>:messages.map((m,i)=><div key={i}><strong>{m.role}</strong><p>{m.text}</p>{m.source&&<button className="link accent" onClick={()=>open(null,m.source)} >View answer source</button>}</div>)}</div><form className="inline" onSubmit={e=>{e.preventDefault();send(chat);}}><input aria-label="Ask about your plan" placeholder="Ask about your plan…" maxLength={1000} value={chat} onChange={e=>setChat(e.target.value)}/><button className="primary icon-btn" aria-label="Send chat message" disabled={!chat.trim()}><Icon name="send"/></button></form></aside></div>
          {result.length>0&&pack.warnings.length>0&&<div className="coverage"><h3>Sources and Coverage</h3>
            <ul className="notice">{pack.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>
          </div>}
        </details>
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

