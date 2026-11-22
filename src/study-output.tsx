import { useState } from 'react';
import type { Section, StudyPack } from './study-pack';
import type { Format } from './study-export';

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
