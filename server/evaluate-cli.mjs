import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { evaluateHistorical } from './evaluate.mjs';
import { MODEL_ID, MODEL_REVISION } from './semantic.mjs';

const [input,output,...flags]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node server/evaluate-cli.mjs DATASET.json REPORT.json [--exact] [--cache=PATH]');
const dataset=JSON.parse((await readFile(input,'utf8')).replace(/^\uFEFF/,''));
const cacheFlag=flags.find(flag=>flag.startsWith('--cache='));
const cache=resolve(cacheFlag?.slice(8)??'.model-cache');
const bundled=resolve('public','models',MODEL_REVISION);
const beforeRss=process.memoryUsage.rss();
let peakRss=beforeRss;
const timer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage.rss());},20);
let firstRunMs=null,warmCacheMs=null;
let report;
try {
  let embed;
  if(!flags.includes('--exact')){
    const { env }=await import('@huggingface/transformers');
    env.cacheDir=cache;
    if(!cacheFlag){
      env.localModelPath=bundled;
      env.allowLocalModels=true;
      env.allowRemoteModels=false;
    }
    const {embedQuestions}=await import('./embedding-runtime.mjs');
    embed=async prompts=>{
      const start=performance.now();
      const result=await embedQuestions(prompts);
      if(firstRunMs===null){
        firstRunMs=Math.round(performance.now()-start);
        const warm=performance.now();
        await embedQuestions(prompts);
        warmCacheMs=Math.round((performance.now()-warm)*1000)/1000;
      }
      return result;
    };
  }
  report=await evaluateHistorical(dataset,embed);
} finally {
  clearInterval(timer);
  peakRss=Math.max(peakRss,process.memoryUsage.rss());
}
async function sizes(directory){
  try{
    return (await Promise.all((await readdir(directory,{withFileTypes:true})).map(async entry=>{
      const path=join(directory,entry.name);
      return entry.isDirectory()?sizes(path):[{file:entry.name,bytes:(await stat(path)).size}];
    }))).flat();
  }catch(error){if(error.code==='ENOENT')return [];throw error;}
}
const artifacts=(await sizes(join(cacheFlag?cache:bundled,MODEL_ID))).filter(asset=>/\.(json|onnx)$/.test(asset.file));
report.performance={model:MODEL_ID,revision:MODEL_REVISION,node:process.version,platform:process.platform,architecture:process.arch,
  firstRunMs,warmCacheMs,rssBaselineBytes:beforeRss,rssPeakBytes:peakRss,artifacts,artifactBytes:artifacts.reduce((sum,file)=>sum+file.bytes,0)};
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log('Wrote '+output);

