import { embedQuestions } from '../server/embedding-runtime.mjs';

self.onmessage=async (event:MessageEvent<{id:number;texts:string[]}>)=>{
  const {id,texts}=event.data;
  try {
    self.postMessage({id,vectors:[...await embedQuestions(texts)]});
  } catch {
    self.postMessage({id});
  }
};
