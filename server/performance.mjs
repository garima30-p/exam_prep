export const now=()=>performance.now();
export function elapsed(start){return Math.max(0,performance.now()-start);}
export function browserTiming(name,start){
 if(typeof performance.measure==='function'&&typeof performance.clearMeasures==='function'){
  if(performance.getEntriesByName(name,'measure').length>=50)performance.clearMeasures(name);
  performance.measure(name,{start,end:performance.now()});
 }
}
export function serverTiming(response,metrics){
 for(const [name,duration] of metrics)response.headers.append('Server-Timing',name+';dur='+duration.toFixed(1));
 return response;
}
