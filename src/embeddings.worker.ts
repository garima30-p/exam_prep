import { embedQuestions, prepareEmbeddings } from '../server/embedding-runtime.mjs';

self.onmessage=async (event:MessageEvent<{id:number;texts:string[]}|{warm:true}>)=>{
  if('warm' in event.data){await prepareEmbeddings().catch(()=>{});return;}
  const {id,texts}=event.data;
  try {
    self.postMessage({id,vectors:[...await embedQuestions(texts)]});
  } catch {
    self.postMessage({id});
  }
};
