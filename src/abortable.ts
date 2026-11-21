export function abortable<T>(pending:Promise<T>,signal:AbortSignal,onAbort?:()=>void):Promise<T> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{onAbort?.();reject(signal.reason);};
    pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    if(signal.aborted)abort();
    else signal.addEventListener('abort',abort,{once:true});
  });
}
