import { useEffect, useState } from 'react';
import type { Material } from './api';
import { documentFormat, documentLocation, originalDocumentLink } from './document-formats';
import { isTrusted } from './document-state';
import type { ExtractedDocument, ExtractedPage } from './document-state';

const stateLabels={pending:'Waiting',extracted:'Usable',review:'Needs review',failed:'Unreadable',verified:'Manually verified'};

export function DocumentReview({documents,files,busy,onVerify}:{
  documents:readonly ExtractedDocument[];
  files:readonly Material[];
  busy:boolean;
  onVerify:(documentId:number,page:number,text:string)=>void;
}) {
  const [selection,setSelection]=useState<{id:number;page:number;draft:string}|null>(null);
  const [original,setOriginal]=useState('');
  const activeDocument=documents.find(document=>document.id===selection?.id);
  const selected=activeDocument?.pages.find(page=>page.number===selection?.page);
  const file=files.find(item=>item.id===selection?.id)?.file;
  useEffect(()=>{
    if(!file){setOriginal('');return;}
    const url=URL.createObjectURL(file);
    setOriginal(url);
    return ()=>URL.revokeObjectURL(url);
  },[file]);
  if(!documents.length)return null;
  function review(id:number,page:ExtractedPage){
    setSelection({id,page:page.number,draft:page.text});
  }
  return <section className="document-review" aria-label="Document processing summary">
    <h3>Document processing</h3>
    {documents.map(document=>{
      const trusted=document.pages.filter(isTrusted).length;
      const ocr=document.pages.filter(page=>page.method==='ocr'||page.attempts?.length).length;
      const failed=document.pages.filter(page=>page.status==='failed').length;
      const unverified=document.total===null?null:document.total-trusted;
      return <details key={document.id}>
        <summary><strong>{document.name}</strong> · {document.total===null?'File not yet readable':trusted+' of '+document.total+' parts usable'}{unverified?' · '+unverified+' need review or processing':''}</summary>
        {document.error&&<p>{document.error}</p>}
        <p>{ocr} OCR parts · {failed} unreadable · {document.pages.filter(isTrusted).reduce((sum,page)=>sum+page.questions,0)} questions identified in usable text</p>
        <ul>{document.pages.map(page=><li key={page.number}><button className="link accent" disabled={busy||page.status==='pending'} onClick={()=>review(document.id,page)}>{documentLocation(document.name,page.number)} · {stateLabels[page.status]}</button></li>)}</ul>
      </details>;
    })}
    {selection&&selected&&<div className="page-review">
      <div className="inline">
        <h3>{activeDocument?.name} · {documentLocation(activeDocument?.name??'',selected.number)} review</h3>
        {original&&<a className="link accent" href={originalDocumentLink(file?.name??'',original,selected.number)} target="_blank" rel="noopener noreferrer">{documentFormat(file?.name??'')==='pdf'?'Open original PDF page':'Open original file'}</a>}
      </div>
      {selected.reason&&<p>{selected.reason}</p>}
      <label htmlFor="review-text">Extracted text</label>
      <textarea id="review-text" value={selection.draft} rows={9} disabled={busy}
        onChange={event=>setSelection({...selection,draft:event.target.value})}/>
      <p>Compare this text with the original before marking it verified. Check diagrams, tables and symbols separately.</p>
      <div className="inline">
        <button className="primary" type="button" disabled={busy||!selection.draft.trim()}
          onClick={()=>{onVerify(selection.id,selection.page,selection.draft);setSelection(null);}}>Save verified text</button>
        <button className="secondary" type="button" disabled={busy||selection.draft.trim().length>0}
          onClick={()=>{onVerify(selection.id,selection.page,'');setSelection(null);}}>Confirm blank</button>
        <button className="secondary" type="button" onClick={()=>setSelection(null)}>Close review</button>
      </div>
      <details>
        <summary>Page diagnostics</summary>
        <p>{selected.method} · {selected.questions} question cues{selected.dpi?' · '+selected.dpi+' render DPI':''}{selected.rotation!==undefined?' · PDF rotation '+selected.rotation+'°':''}{selected.confidence!==undefined?' · OCR confidence '+Math.round(selected.confidence)+'%':''}</p>
        {selected.attempts?.length&&<ul>{selected.attempts.map((attempt,index)=><li key={index}>{attempt.variant} · {attempt.confidence===null?'confidence unavailable':Math.round(attempt.confidence)+'%'}</li>)}</ul>}
      </details>
    </div>}
  </section>;
}
