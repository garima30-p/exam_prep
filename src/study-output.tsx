import { useState } from 'react';
import { sourceLabel } from './study-pack';
import type { Section, StudyPack } from './study-pack';
import type { Format } from './study-export';
import type { Question, Source } from './api';

export function DownloadStudyPack({ pack }: { pack: StudyPack }) {
  const [section,setSection]=useState<Section>('all');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function download(format: Format) {
    setBusy(true);
    setError('');
    try {
      const { createStudyDownload }=await import('./study-export');
      const { blob,filename }=await createStudyDownload(pack,section,format);
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=url;
      anchor.download=filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30_000);
    } catch {
      setError('The download could not be prepared. Try again.');
    } finally {setBusy(false);}
  }
  return <details className="download">
    <summary className="secondary">Download ▾</summary>
    <div className="download-menu">
      <label>Include<select value={section} onChange={event=>setSection(event.target.value as Section)} disabled={busy}>
        <option value="all">Study pack</option><option value="notes">Must Read Now</option>
        <option value="timeline">Timeline</option><option value="questions">Important questions</option>
      </select></label>
      <div>{([['pdf','PDF'],['docx','Word'],['png','Image']] as const).map(([format,label])=>
        <button key={format} className="secondary" type="button" disabled={busy} onClick={()=>void download(format)}>{label}</button>)}</div>
      {busy&&<small role="status">Preparing download…</small>}
      {error&&<small role="alert">{error}</small>}
    </div>
  </details>;
}

export function StudyOutput({ pack, openSource, ask }: {
  pack:StudyPack; openSource:(source:Source)=>void; ask:(question:Question)=>void;
}) {
  return <>
    {pack.notes.length>0&&<section aria-labelledby="must-read-title" className="study-output">
      <h3 id="must-read-title">Must Read Now{pack.subject ? ' — '+pack.subject : ''}</h3>
      {pack.notes.map(note=><article className="study-note" key={note.question.id}>
        <h4>{note.priority}. {note.question.topic} <small>{note.minutes} min{note.readOnly?' · read only':''}</small></h4>
        <ul>{note.paragraphs.map((text,index)=><li key={index}>{text}</li>)}</ul>
        {note.checkpoint&&<p><strong>Recall:</strong> {note.checkpoint}</p>}
        <p><strong>Related question:</strong> {note.question.prompt}</p>
        {note.source&&<button className="link accent source" onClick={()=>openSource(note.source!)}>{sourceLabel(note.source)}</button>}
        <button className="secondary" onClick={()=>ask(note.question)}>Ask the coach</button>
      </article>)}
    </section>}
    {pack.timeline.length>0&&<section aria-labelledby="timeline-title" className="study-output coverage">
      <h3 id="timeline-title">Your Preparation Timeline</h3>
      {pack.timeline.length>0 ? <><ol className="study-timeline">
        {pack.timeline.map((item,index)=><li key={index}><span>{item.title}</span><strong>{item.minutes} min</strong></li>)}
      </ol><p>{pack.timeline.reduce((sum,item)=>sum+item.minutes,0)} min planned · estimates</p></>
        : <p>No study tasks fit within the available time and evidence.</p>}
    </section>}
  </>;
}
