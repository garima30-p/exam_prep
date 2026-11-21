let worker:Worker|undefined;
let nextId=0;

export async function browserEmbeddings(texts:readonly string[],signal?:AbortSignal):Promise<Map<string,Float32Array>|null> {
  if(texts.length<2||signal?.aborted)return null;
  try {
    const active=worker??=new Worker(new URL('./embeddings.worker.ts',import.meta.url),{type:'module'});
    return await new Promise(resolve=>{
      const id=++nextId;
      const finish=(value:Map<string,Float32Array>|null)=>{
        clearTimeout(timer);
        active.removeEventListener('message',message);
        active.removeEventListener('error',fail);
        signal?.removeEventListener('abort',fail);
        if(!value){active.terminate();if(worker===active)worker=undefined;}
        resolve(value);
      };
      const message=(event:MessageEvent<{id:number;vectors?:[string,Float32Array][]}>)=>{
        if(event.data.id===id)finish(event.data.vectors?new Map(event.data.vectors):null);
      };
      const fail=()=>finish(null);
      const timer=setTimeout(fail,45000);
      active.addEventListener('message',message);
      active.addEventListener('error',fail);
      signal?.addEventListener('abort',fail,{once:true});
      try {active.postMessage({id,texts});} catch {fail();}
    });
  } catch {
    return null;
  }
}
