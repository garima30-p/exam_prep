let worker:Worker|undefined;
let nextId=0;
const startWorker=()=>worker??=new Worker(new URL('./embeddings.worker.ts',import.meta.url),{type:'module'});

export function warmEmbeddings(){
  if(worker)return;
  try{startWorker().postMessage({warm:true});}catch{/* The first ranking can still initialize or fall back. */}
}

export async function browserEmbeddings(texts:readonly string[],signal?:AbortSignal):Promise<Map<string,Float32Array>|null> {
  if(texts.length<2||signal?.aborted)return null;
  try {
    const active=startWorker();
    return await new Promise(resolve=>{
      const id=++nextId;
      const finish=(value:Map<string,Float32Array>|null,reset=false)=>{
        clearTimeout(timer);
        active.removeEventListener('message',message);
        active.removeEventListener('error',fail);
        signal?.removeEventListener('abort',abort);
        if(reset){active.terminate();if(worker===active)worker=undefined;}
        resolve(value);
      };
      const message=(event:MessageEvent<{id:number;vectors?:[string,Float32Array][]}>)=>{
        if(event.data.id===id)finish(event.data.vectors?new Map(event.data.vectors):null);
      };
      const fail=()=>finish(null,true);
      const abort=()=>finish(null);
      const timer=setTimeout(fail,45000);
      active.addEventListener('message',message);
      active.addEventListener('error',fail);
      signal?.addEventListener('abort',abort,{once:true});
      try {active.postMessage({id,texts});} catch {fail();}
    });
  } catch {
    return null;
  }
}
