import { env, pipeline } from '@huggingface/transformers';
import { MODEL_ID, MODEL_REVISION } from './semantic.mjs';

const vectors=new Map();
const MAX_CACHE=256;
let extractorPromise;

export function prepareEmbeddings(){
 if(!extractorPromise){
  if(typeof process==='undefined' || !process.versions?.node){
   env.backends.onnx.wasm.numThreads=1;
   env.allowLocalModels=true;
   env.allowRemoteModels=false;
   env.localModelPath=new URL('/models/'+MODEL_REVISION+'/',self.location.href).href;
  }
  extractorPromise=pipeline('feature-extraction',MODEL_ID,{dtype:'q8',revision:MODEL_REVISION})
   .catch(error=>{extractorPromise=undefined;throw error;});
 }
 return extractorPromise;
}

export async function embedQuestions(texts) {
  const unique=[...new Set(texts)];
  const missing=unique.filter(text=>!vectors.has(text));
  if(missing.length){
    const extractor=await prepareEmbeddings();
    for(let i=0;i<missing.length;i+=8){
      const batch=missing.slice(i,i+8);
      const tensor=await extractor(batch,{pooling:'mean',normalize:true});
      try {
        const width=tensor.dims.at(-1);
        if(!width||tensor.data.length!==batch.length*width)throw new Error('Unexpected embedding dimensions');
        for(const [j,text] of batch.entries())vectors.set(text,Float32Array.from(tensor.data.slice(j*width,(j+1)*width)));
      } finally {
        tensor.dispose();
      }
    }
  }
  const result=new Map(unique.map(text=>[text,vectors.get(text)]));
  while(vectors.size>MAX_CACHE)vectors.delete(vectors.keys().next().value);
  return result;
}

