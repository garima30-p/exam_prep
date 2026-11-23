import {expect,it,vi} from 'vitest';
import {handle} from './engine.mjs';
import {readStudyEvents} from './study-stream.mjs';

const ask=body=>new Request('https://example.test/api/coach',{
 method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({mode:'auto',task:'chat',request:'Explain how deadlock works.',stream:true,...body})
});
const encoder=new TextEncoder();
const delta=content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n';
const stream=parts=>new ReadableStream({start(controller){for(const part of parts)controller.enqueue(encoder.encode(part));controller.close();}});
const envFor=run=>({STUDY_AI_ENABLED:'true',AI:{run}});
async function events(response){
 const values=[];
 await readStudyEvents(response.body,(event,raw)=>{values.push([event,JSON.parse(raw)]);});
 return values;
}

it('streams answer deltas and emits a final unverified reply without thinking text',async()=>{
 const run=vi.fn(async()=>stream([delta('<thi'),delta('nk>private</think>Wait'),delta(' in a cycle.'),'data: [DONE]\n\n']));
 const response=await handle(ask(),envFor(run));
 expect(response.headers.get('content-type')).toContain('text/event-stream');
 expect(response.headers.get('server-timing')).toContain('request;dur=');
 const values=await events(response);
 expect(values.slice(0,2)).toEqual([['delta',{text:'Wait'}],['delta',{text:' in a cycle.'}]]);
 expect(values[2]).toMatchObject(['done',{explanation:'Wait in a cycle.',sources:[],sourceVerified:false}]);
 expect(run.mock.calls[0][1]).toMatchObject({stream:true,chat_template_kwargs:{enable_thinking:false}});
});

it('does not finalize a truncated upstream stream as a completed answer',async()=>{
 const response=await handle(ask(),envFor(async()=>stream([delta('Only partial text.')])));
 expect((await events(response)).map(([type])=>type)).toEqual(['delta','error']);
});

it('validates grounded citations before replying even when Coach requests streaming',async()=>{
 const quote='Deadlock occurs when processes wait for resources in a cycle.';
 const run=vi.fn(async()=>({response:{insufficientEvidence:false,sections:[{text:quote,citations:[{id:'N1',quote}]}]}}));
 const response=await handle(ask({sources:[{file:'notes.pdf',page:2,excerpt:quote}]}),envFor(run));
 expect(response.headers.get('content-type')).toContain('application/json');
 expect(await response.json()).toMatchObject({sourceVerified:true,sources:[{file:'notes.pdf',page:2,supportingQuote:quote}]});
 expect(run.mock.calls[0][1].stream).toBeUndefined();
});
