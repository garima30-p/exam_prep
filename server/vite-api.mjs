import { Readable } from 'node:stream';
import { handle } from './engine.mjs';

export default function backend() {
  const mount = server => { server.middlewares.use(async (incoming,outgoing,next)=>{
    if(!incoming.url?.startsWith('/api/')) return next();
    const protocol = 'http:';
    const url = new URL(incoming.url,protocol+'//'+incoming.headers.host);
    try {
      const headers = new Headers();
      for(const [name,value] of Object.entries(incoming.headers)) {
        if(value) headers.set(name,Array.isArray(value)?value.join(', '):value);
      }
      const request = new Request(url,{method:incoming.method,headers,
        ...(incoming.method==='GET'||incoming.method==='HEAD'?{}:{body:Readable.toWeb(incoming),duplex:'half'})});
      const response = await handle(request);
      outgoing.writeHead(response.status,Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});
      outgoing.end(JSON.stringify({error:'The analysis service could not complete this request.'}));
    }
  }); };
  return {name:'exam-backend',configureServer:mount,configurePreviewServer:mount};
}
