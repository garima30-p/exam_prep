import { createWorker, OEM, PSM } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import englishData from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import type { PDFPageProxy } from 'pdfjs-dist';
import { chooseReading, enhanceScan, findGutter, formatPageText, pageQuality, scanPasses, scanScale } from '../server/page-text.mjs';
import type { Reading } from '../server/page-text.mjs';
import { abortable } from './abortable';

export async function createOcr(signal:AbortSignal) {
  const absolute=(path:string)=>new URL(path,location.href).href;
  const setup=createWorker('eng',OEM.LSTM_ONLY,{
    workerPath:absolute(workerPath),corePath:absolute(corePath),
    langPath:new URL('.',absolute(englishData)).href,cacheMethod:'none'
  });
  const startupSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
  const worker=await abortable(setup,startupSignal,()=>{void setup.then(worker=>worker.terminate()).catch(()=>{});});
  let termination:ReturnType<typeof worker.terminate>|undefined;
  const close=()=>termination??=worker.terminate();
  return {
    async readImage(file:File,kind:string,retry:boolean) {
      const decoding=createImageBitmap(file);
      const image=await abortable(decoding,signal,()=>{void decoding.then(bitmap=>bitmap.close()).catch(()=>{});});
      const canvas=document.createElement('canvas');
      const scale=Math.min(1,3200/Math.max(image.width,image.height),Math.sqrt(7_000_000/(image.width*image.height)));
      canvas.width=Math.max(1,Math.round(image.width*scale));
      canvas.height=Math.max(1,Math.round(image.height*scale));
      try {
        const context=canvas.getContext('2d');
        if(!context)throw new Error('Canvas unavailable');
        context.fillStyle='#fff';
        context.fillRect(0,0,canvas.width,canvas.height);
        context.drawImage(image,0,0,canvas.width,canvas.height);
        if(retry)context.putImageData(enhanceScan(context.getImageData(0,0,canvas.width,canvas.height),false),0,0);
        const stop=()=>{void close();};
        await abortable(worker.setParameters({tessedit_pageseg_mode:retry?PSM.SPARSE_TEXT:PSM.AUTO,
          user_defined_dpi:'150',preserve_interword_spaces:'1'}),signal,stop);
        const timeout=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
        const {data}=await abortable(worker.recognize(canvas),timeout,stop);
        return {text:formatPageText(data.text,kind),confidence:data.confidence,variant:retry?'Enhanced image':'Image'};
      } finally {
        image.close();
        canvas.width=canvas.height=0;
      }
    },
    async read(page:PDFPageProxy,kind:string,manual:boolean,onPass:(pass:number)=>void) {
      const original=page.getViewport({scale:1});
      const deviceMemory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory;
      const scale=scanScale(original.width,original.height,deviceMemory&&deviceMemory<=4?4_500_000:7_000_000);
      const attempts:Reading[]=[];
      let best:Reading|null=null;
      for(const [index,pass] of scanPasses(original.width,original.height,manual).entries()){
        signal.throwIfAborted();
        onPass(index+1);
        const viewport=page.getViewport({scale,rotation:(page.rotate+pass.rotation)%360});
        const canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);
        canvas.height=Math.ceil(viewport.height);
        try {
          const context=canvas.getContext('2d',{willReadFrequently:pass.filter!=='raw'});
          if(!context)throw new Error('Canvas unavailable');
          const render=page.render({canvas,canvasContext:context,viewport});
          await abortable(render.promise,signal,()=>render.cancel());
          const broad=canvas.width>canvas.height*1.15;
          const pixels=broad||pass.filter!=='raw'?context.getImageData(0,0,canvas.width,canvas.height):null;
          const gutter=pixels&&broad?findGutter(pixels):null;
          if(pixels&&pass.filter!=='raw'){
            context.putImageData(enhanceScan(pixels,pass.filter==='binary'),0,0);
          }
          const stop=()=>{void close();};
          await abortable(worker.setParameters({tessedit_pageseg_mode:pass.layout==='column'?PSM.SINGLE_COLUMN:PSM.AUTO,
            user_defined_dpi:String(Math.round(scale*72)),preserve_interword_spaces:'1'}),signal,stop);
          const regions=gutter?[{left:0,top:0,width:gutter,height:canvas.height},{left:gutter,top:0,width:canvas.width-gutter,height:canvas.height}]:[undefined];
          const parts=[];
          for(const rectangle of regions){
            const attemptSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
            const {data}=await abortable(worker.recognize(canvas,rectangle?{rectangle}:undefined),attemptSignal,stop);
            parts.push(data);
          }
          const substantial=parts.filter(part=>(part.text.match(/\p{L}{2,}/gu)?.length??0)>=8);
          const confidence=Math.min(...(substantial.length?substantial:parts).map(part=>part.confidence));
          const reading={text:parts.map(part=>formatPageText(part.text,kind)).join('\n\n').trim(),confidence,
            variant:pass.filter+' · '+(gutter?'two-column':pass.layout)+' · '+pass.rotation+'° extra rotation'};
          attempts.push(reading);
          best=chooseReading(best,reading,kind);
          if(pageQuality(reading.text,kind,reading.confidence).status==='extracted')break;
        } finally {
          canvas.width=canvas.height=0;
        }
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      return {best,attempts,dpi:Math.round(scale*72),rotation:page.rotate};
    },
    close
  };
}

