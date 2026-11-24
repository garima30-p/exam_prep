/// <reference types="vite/client" />
import { getDocument, GlobalWorkerOptions, OPS, Util } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { chooseReading, countQuestions, countSupportedOcrQuestions, formatPageText, pageQuality } from '../server/page-text.mjs';
import { isTrusted } from './document-state';
import type { ExtractedPage, PrepareOptions } from './document-state';
import type { Material } from './api';
import { abortable } from './abortable';
import { browserTiming, now } from '../server/performance.mjs';
import { documentFormat } from './document-formats';

GlobalWorkerOptions.workerSrc=workerUrl;

const rasterOperations=new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintInlineImageXObjectGroup,
  OPS.paintImageXObjectRepeat,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectGroup,OPS.paintImageMaskXObjectRepeat]);
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
  const {signal,retry,onUpdate,cache}=options;
  const extractionStarted=now();
  const records=files.map(file=>{
    const existing=options.records.find(record=>record.id===file.id);
    return existing?{...existing,pages:existing.pages.slice()}:{id:file.id,name:file.file.name,total:null,pages:[]};
  });
  const publish=(message:string)=>onUpdate({documents:records.map(record=>({...record,pages:record.pages.slice()})),message});
  type OcrWorker=Awaited<ReturnType<typeof import('./ocr').createOcr>>;
  const workers=new Map<number,OcrWorker>();
  async function workerFor(slot:number){
    const existing=workers.get(slot);
    if(existing)return existing;
    const started=now();
    try{
      const worker=await (await import('./ocr')).createOcr(signal);
      workers.set(slot,worker);
      return worker;
    }finally{browserTiming('study:ocr-init',started);}
  }
  async function releaseWorker(slot:number){
    const worker=workers.get(slot);
    workers.delete(slot);
    await worker?.close().catch(()=>{});
  }
  try {
    for(const [fileIndex,item] of files.entries()){
      signal.throwIfAborted();
      const record=records[fileIndex];
      if(record.total!==null&&!record.pages.some(page=>page.status==='pending'||retry&&!isTrusted(page)))continue;
      const label=(page?:number)=>item.file.name+' ('+(fileIndex+1)+'/'+files.length+')'+(page?' · page '+page+' of '+record.total:'');
      publish('Opening '+label());
      const format=documentFormat(item.file.name);
      let data:ArrayBuffer|undefined;
      let cacheKey:string|undefined;
      if(cache&&globalThis.crypto?.subtle){
        try{
          data=await abortable(item.file.arrayBuffer(),signal);
          const digest=await abortable(crypto.subtle.digest('SHA-256',data),signal);
          cacheKey=JSON.stringify([format,item.kind,Array.from(new Uint8Array(digest))]);
        }catch{signal.throwIfAborted();}
      }
      if(cache&&cacheKey){
        const hit=cache.get(cacheKey);
        if(hit&&record.total===null){
          record.total=hit.total;
          record.pages=hit.pages.slice();
          browserTiming('study:document-cache-hit',now());
          if(!retry||record.pages.every(isTrusted)){
            publish('Processed '+label());
            continue;
          }
        }
      }
      const remember=()=>{
        if(!cache||!cacheKey||record.error||record.total===null||record.pages.some(page=>page.status==='pending'||page.method==='manual'))return;
        if(cache.size>=12&&!cache.has(cacheKey))cache.delete(cache.keys().next().value!);
        cache.set(cacheKey,{...record,pages:record.pages.slice()});
      };
      if(format==='word'||format==='slides'){
        try {
          const pages=await (await import('./office-text')).readOfficeText(item.file,format,signal);
          record.error=undefined;
          record.total=pages.length;
          record.pages=pages.map((text,index)=>{
            const number=index+1;
            const cached=record.pages[index];
            if(cached&&isTrusted(cached))return cached;
            const usable=formatPageText(text,item.kind);
            return {number,text:usable,status:usable?'extracted':'review',method:'office-text',
              questions:countQuestions(usable,item.kind==='Past paper'),
              reason:usable?'':'No editable text found. Verify the content or attach a screenshot to scan it.'};
          });
          remember();
          publish('Processed '+label());
        }catch(error){
          signal.throwIfAborted();
          record.error=error instanceof Error?error.message:'This Office file could not be opened.';
          publish(record.error);
        }
        continue;
      }
      if(format==='image'){
        const cached=record.pages[0]??pending(1);
        record.total=1;
        record.error=undefined;
        record.pages=[cached];
        try {
          publish('Scanning '+label());
          const ocr=await workerFor(0);
          const started=now();
          const reading=await ocr.readImage(item.file,item.kind,Boolean(retry)).finally(()=>browserTiming('study:ocr',started));
          const prior=cached.text?{text:cached.text,confidence:cached.confidence??null,variant:'Prior image'}:null;
          const best=chooseReading(prior,reading,item.kind);
          const quality=pageQuality(best.text,item.kind,best.confidence);
          record.pages=[{number:1,text:best.text,status:quality.status,method:'ocr',
            questions:quality.status==='extracted'?countSupportedOcrQuestions(best.text,item.kind==='Past paper'):quality.questions,
            reason:quality.reason,...(best.confidence!==null?{confidence:best.confidence}:{}),
            attempts:[...cached.attempts??[],{variant:reading.variant,confidence:reading.confidence}].slice(-16)}];
        }catch{
          signal.throwIfAborted();
          await releaseWorker(0);
          record.pages=[{...cached,status:cached.text?'review':'failed',method:'ocr',reason:'The image could not be read. Check the original or retry.'}];
        }
        remember();
        publish('Processed '+label());
        continue;
      }
      data??=await abortable(item.file.arrayBuffer(),signal);
      const pdfStarted=now();
      const task=getDocument({data,enableXfa:false,wasmUrl:new URL('/pdfjs/wasm/',location.href).href});
      let destruction:Promise<void>|undefined;
      const destroy=()=>destruction??=task.destroy();
      const stop=()=>{void destroy().catch(()=>{});};
      try{
        const document=await abortable(task.promise,signal,stop).finally(()=>browserTiming('study:pdf-load',pdfStarted));
        record.total=document.numPages;
        record.error=undefined;
        const cached=new Map(record.pages.map(page=>[page.number,page]));
        record.pages=Array.from({length:document.numPages},(_,i)=>cached.get(i+1)??pending(i+1));
        const scans:{index:number;cachedPage:ExtractedPage;text:string}[]=[];
        for(const [index,cachedPage] of record.pages.entries()){
          signal.throwIfAborted();
          if(isTrusted(cachedPage)||cachedPage.status!=='pending'&&!retry)continue;
          const number=index+1;
          let page:PDFPageProxy|undefined;
          let text='',nativeCover=false;
          const started=now();
          try{
            page=await abortable(document.getPage(number),signal,stop);
            if(cachedPage.method!=='ocr')text=formatPageText(await nativeText(page,signal),item.kind);
            const native=pageQuality(text,item.kind);
            if(item.kind==='Past paper'&&!native.questions&&pageQuality(text,'Notes').status==='extracted'&&
              /\b(?:instructions(?: to candidates)?|time allowed|maximum marks|end[- ]?sem(?:ester)?|examination)\b/i.test(text)){
              const operators=await abortable(page.getOperatorList(),signal);
              nativeCover=!operators.fnArray.some(operator=>rasterOperations.has(operator));
            }
          }catch{signal.throwIfAborted();}
          finally{page?.cleanup();browserTiming('study:pdf-text',started);}
          const quality=pageQuality(text,item.kind);
          if(quality.status==='extracted'||nativeCover){
            record.pages[index]={number,text,status:'extracted',method:'pdf-text',questions:quality.questions,reason:''};
          }else scans.push({index,cachedPage,text});
        }
        publish('Read text layers in '+label());
        const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory??0;
        const parallel=scans.length>=4&&memory>=8&&navigator.hardwareConcurrency>=8?2:1;
        let nextPage=0;
        const scanned=await Promise.allSettled(Array.from({length:parallel},async(_,slot)=>{
          while(nextPage<scans.length){
            signal.throwIfAborted();
            const {index,cachedPage,text}=scans[nextPage++];
            const number=index+1;
            let page:PDFPageProxy|undefined;
            try{
              page=await abortable(document.getPage(number),signal,stop);
              publish('Scanning '+label(number));
              const ocr=await workerFor(slot);
              const started=now();
              const result=await ocr.read(page,item.kind,Boolean(retry),pass=>publish('Scanning '+label(number)+' · pass '+pass))
                .finally(()=>browserTiming('study:ocr',started));
              if(result.interrupted)await releaseWorker(slot);
              const previous=cachedPage.text&&cachedPage.method==='ocr'
                ?{text:cachedPage.text,confidence:cachedPage.confidence??null,variant:'prior pass'}:null;
              const reading=result.best?chooseReading(previous,result.best,item.kind):previous;
              const quality=pageQuality(text,item.kind);
              const useOcr=reading?.text&&(pageQuality(reading.text,item.kind,reading.confidence).score>quality.score||!text);
              const best=useOcr?reading.text:text;
              const confidence=useOcr?reading.confidence:null;
              const rated=pageQuality(best,item.kind,confidence);
              if(useOcr&&result.unconfirmed&&reading===result.best&&rated.status==='extracted'){
                rated.status='review';
                rated.reason='Only a preliminary scan was readable. Check it against the original page.';
              }
              record.pages[index]={number,text:best,status:rated.status,method:'ocr',
                questions:rated.status==='extracted'?countSupportedOcrQuestions(best,item.kind==='Past paper'):rated.questions,
                reason:rated.reason,...(confidence!==null?{confidence}:{}),dpi:result.dpi,rotation:result.rotation,
                attempts:[...cachedPage.attempts??[],...result.attempts.map(({confidence,variant})=>({confidence,variant}))].slice(-16)};
            }catch{
              signal.throwIfAborted();
              await releaseWorker(slot);
              const retained=text||cachedPage.text;
              record.pages[index]={...cachedPage,text:retained,status:retained?'review':'failed',method:'ocr',
                questions:pageQuality(retained,item.kind).questions,reason:'This attempt could not read the page reliably. Compare it with the original or retry.'};
            }finally{
              page?.cleanup();
              publish('Processed '+label(number));
            }
          }
        }));
        const failure=scanned.find(result=>result.status==='rejected');
        if(failure)throw failure.reason;
        remember();
      }catch {
        signal.throwIfAborted();
        record.error='This PDF could not be opened. It may be damaged or password-protected.';
        publish(record.error);
      }finally{
        // Extracted pages own their text. PDF worker teardown must not hold up their publication.
        stop();
      }
    }
    return records;
  }finally{
    for(const slot of workers.keys())void releaseWorker(slot);
    browserTiming('study:attachments',extractionStarted);
  }
}

