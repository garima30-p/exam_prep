export async function readStudyEvents(stream,receive,signal){
 const reader=stream.getReader();
 const decoder=new TextDecoder();
 let pending='';
 const abort=()=>{void reader.cancel().catch(()=>{});};
 signal?.addEventListener('abort',abort,{once:true});
 try{
  signal?.throwIfAborted();
  let event='',data=[];
  while(true){
   const chunk=await reader.read();
   signal?.throwIfAborted();
   pending+=chunk.done?decoder.decode()+'\n\n':decoder.decode(chunk.value,{stream:true});
   if(pending.length>131072)throw new Error('Oversized study event');
   let newline;
   while((newline=pending.indexOf('\n'))!==-1){
    const line=pending.slice(0,newline).replace(/\r$/,'');
    pending=pending.slice(newline+1);
    if(line===''){
     if(data.length&&receive(event,data.join('\n'))===false)return;
     event='';data=[];
    }else if(line.startsWith('event:'))event=line.slice(6).trim();
    else if(line.startsWith('data:'))data.push(line.slice(5).trimStart());
   }
   if(chunk.done)return;
  }
 }finally{
  signal?.removeEventListener('abort',abort);
  await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
}

export function studyEvent(type,value){
 return new TextEncoder().encode('event: '+type+'\ndata: '+JSON.stringify(value)+'\n\n');
}
