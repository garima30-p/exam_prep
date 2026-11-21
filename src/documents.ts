/// <reference types="vite/client" />
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { chooseReading, countSupportedOcrQuestions, formatPageText, pageQuality } from '../server/page-text.mjs';
import { isTrusted } from './document-state';
import type { ExtractedPage, PrepareOptions } from './document-state';
import type { Material } from './api';
import { abortable } from './abortable';

GlobalWorkerOptions.workerSrc=workerUrl;

const pending=(number:number):ExtractedPage=>({number,text:'',status:'pending',method:'none',questions:0,reason:''});

async function nativeText(page:PDFPageProxy,signal:AbortSignal) {
  const content=await abortable(page.getTextContent(),signal);
  const viewport=page.getViewport({scale:1});
  let text='',previous:{x:number;y:number;end:number;height:number;eol:boolean}|null=null;
  for(const item of content.items){
    if(!('str' in item))continue;
    const transform=Util.transform(viewport.transform,item.transform);
    const x=transform[4],y=transform[5],height=Math.hypot(transform[2],transform[3]);
    if(previous) {
      const lineBreak=previous.eol||Math.abs(y-previous.y)>Math.max(3,Math.min(previous.height,height)*.55)
        ||x<previous.x-15||x>previous.end+Math.max(38,height*4);
      text+=lineBreak?'\n':' ';
    }
    text+=item.str;
    previous={x,y,height,eol:item.hasEOL,end:x+item.width};
  }
  return text.trim();
}

export async function extractDocuments(files:readonly Material[],options:PrepareOptions) {
  const {signal,retry,onUpdate}=options;
  const records=files.map(file=>{
    const existing=options.records.find(record=>record.id===file.id);
    return existing?{...existing,pages:existing.pages.slice()}:{id:file.id,name:file.file.name,total:null,pages:[]};
  });
  const publish=(message:string)=>onUpdate({documents:records.map(record=>({...record,pages:record.pages.slice()})),message});
  let ocr:Awaited<ReturnType<typeof import('./ocr').createOcr>>|undefined;
  try {
    for(const [fileIndex,item] of files.entries()){
      signal.throwIfAborted();
      const record=records[fileIndex];
      if(record.total!==null&&!record.pages.some(page=>page.status==='pending'||retry&&!isTrusted(page)))continue;
      const label=(page?:number)=>item.file.name+' ('+(fileIndex+1)+'/'+files.length+')'+(page?' · page '+page+' of '+record.total:'');
      publish('Opening '+label());
      const data=await abortable(item.file.arrayBuffer(),signal);
      const task=getDocument({data,enableXfa:false,wasmUrl:new URL('/pdfjs/wasm/',location.href).href});
      let destruction:Promise<void>|undefined;
      const destroy=()=>destruction??=task.destroy();
      const stop=()=>{void destroy().catch(()=>{});};
      try{
        const document=await abortable(task.promise,signal,stop);
        record.total=document.numPages;
        record.error=undefined;
        const cached=new Map(record.pages.map(page=>[page.number,page]));
        record.pages=Array.from({length:document.numPages},(_,i)=>cached.get(i+1)??pending(i+1));
        for(const [index,cachedPage] of record.pages.entries()){
          signal.throwIfAborted();
          if(isTrusted(cachedPage)||cachedPage.status!=='pending'&&!retry)continue;
          const number=index+1;
          publish('Reading '+label(number));
          let page:PDFPageProxy|undefined;
          let text='';
          try {
            page=await abortable(document.getPage(number),signal,stop);
            try {text=formatPageText(await nativeText(page,signal),item.kind);}
            catch {signal.throwIfAborted();}
            const quality=pageQuality(text,item.kind);
            if(quality.status==='extracted') {
              record.pages[index]={number,text,status:'extracted',method:'pdf-text',questions:quality.questions,reason:''};
              continue;
            }
            ocr??=await (await import('./ocr')).createOcr(signal);
            const result=await ocr.read(page,item.kind,Boolean(retry),pass=>publish('Scanning '+label(number)+' · pass '+pass));
            const previous=cachedPage.text&&cachedPage.method==='ocr'
              ?{text:cachedPage.text,confidence:cachedPage.confidence??null,variant:'prior pass'}:null;
            const reading=result.best?chooseReading(previous,result.best,item.kind):previous;
            const useOcr=reading?.text && (pageQuality(reading.text,item.kind,reading.confidence).score>quality.score||!text);
            const best=useOcr?reading.text:text;
            const confidence=useOcr?reading.confidence:null;
            const rated=pageQuality(best,item.kind,confidence);
            record.pages[index]={number,text:best,status:rated.status,method:'ocr',
              questions:rated.status==='extracted'?countSupportedOcrQuestions(best,item.kind==='Past paper'):rated.questions,reason:rated.reason,
              ...(confidence!==null?{confidence}:{}),dpi:result.dpi,rotation:result.rotation,
              attempts:[...cachedPage.attempts??[],...result.attempts.map(({confidence,variant})=>({confidence,variant}))].slice(-16)};
          } catch {
            signal.throwIfAborted();
            await ocr?.close().catch(()=>{});
            ocr=undefined;
            const retained=text||cachedPage.text;
            record.pages[index]={...cachedPage,text:retained,status:retained?'review':'failed',method:'ocr',
              questions:pageQuality(retained,item.kind).questions,reason:'This attempt could not read the page reliably. Compare it with the original or retry.'};
          } finally {
            page?.cleanup();
            publish('Processed '+label(number));
            if(number%3===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
          }
        }
      }catch {
        signal.throwIfAborted();
        record.error='This PDF could not be opened. It may be damaged or password-protected.';
        publish(record.error);
      }finally{
        await destroy().catch(()=>{});
      }
    }
    return records;
  }finally{
    await ocr?.close().catch(()=>{});
  }
}

