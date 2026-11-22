// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { App } from './main';
import { prepareScope } from './preparation-scope';
import { demoApi, fixture } from './api';
import type { ExamApi, RankedQuestion } from './api';
import { makeLearningPlan } from '../server/learning.mjs';

const setDraft=(host:HTMLElement,value:string)=>{
  const field=host.querySelector<HTMLTextAreaElement>('#prompt')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,value);
  field.dispatchEvent(new Event('input',{bubbles:true}));
};
const submitDraft=(host:HTMLElement)=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const writeMessage=async(host:HTMLElement,value:string)=>{
  await act(async()=>setDraft(host,value));
  await act(async()=>submitDraft(host));
};

it.each(['I have 30 minutes to study. ',''])('renders a real notes-only summary with budget prefix %j',async(prefix)=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement('div');
  document.body.append(host);
  const root=createRoot(host);
  const api:ExamApi={...demoApi,analyze:async()=>({questions:[],warnings:[]})};
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'The Workers AI binding is missing.'},{status:503})));
  try{
    await act(async()=>root.render(<App api={api}/>));
    await act(async()=>{
      const prompt=host.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(prompt,
        'My Operating Systems exam is tomorrow. '+prefix+'Summarize my notes: FIFO evicts the page that arrived earliest. LRU evicts the page whose most recent access was furthest in the past. A hit updates recency in LRU.');
      prompt.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    if(!prefix){
      expect(host.querySelector('[role=log]')?.textContent).toContain('How many minutes can you study?');
      await writeMessage(host,'5 minutes');
    }
    expect(host.querySelector('[aria-label="Revision notes"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('AI generation is temporarily unavailable');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('AI generation failed. Please retry.');
    expect(host.querySelector('#prompt')).not.toBeNull();
  }finally{
    await act(async()=>root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    history.replaceState(null,'',location.pathname);
  }
});

it('asks for study time, then shows a plan and answers a contextual question', async ()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement('div');
  document.body.append(host);
  const root=createRoot(host);
  const setValue=(field:HTMLInputElement|HTMLTextAreaElement,value:string)=>{
    const elementType=field instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;
    Object.getOwnPropertyDescriptor(elementType.prototype,'value')?.set?.call(field,value);
    field.dispatchEvent(new Event('input',{bubbles:true}));
  };
  try {
    await import('./study-markdown');
    await act(async()=>root.render(<App/>));
    await act(async()=>setValue(host.querySelector('textarea')!,'My DBMS exam is tomorrow. Make a study plan.'));
    const picker=host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(picker,'files',{value:[new File(['fixture'],'DBMS_PYQ.pdf',{type:'application/pdf'})]});
    await act(async()=>picker.dispatchEvent(new Event('change',{bubbles:true})));
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Type for DBMS_PYQ.pdf"]')?.value).toBe('Past paper');
    await act(async()=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(host.querySelector('[role=log]')?.textContent).toContain('How many minutes can you study?');
    await writeMessage(host,'5 hours');
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,460));});
    expect(host.querySelectorAll('.question')).toHaveLength(0);
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Generate Questions')!.click());
    expect(host.querySelectorAll('.question')).toHaveLength(10);
    expect(document.activeElement?.id).toBe('important-questions');
    expect(host.querySelectorAll('#prompt')).toHaveLength(1);
    expect(host.textContent).not.toContain('Study Coach');
    await writeMessage(host,'Why #1?');
    expect(host.querySelector('[role=log]')?.textContent).toContain('page 1, Q1');
    await writeMessage(host,'Only 30 minutes left');
    expect(host.querySelector('[role=log]')?.textContent?.indexOf('Only 30 minutes left')).toBeGreaterThan(host.querySelector('[role=log]')?.textContent?.indexOf('Why #1?')??0);
    expect(host.querySelector('.summary')?.textContent).toContain('30 min available');
    expect(host.querySelectorAll('.question').length).toBeGreaterThan(0);
    const allocations=[...host.querySelectorAll('.study-timeline strong')].map(item=>parseInt(item.textContent??'0',10));
    expect(allocations.reduce((sum,item)=>sum+item,0)).toBeLessThanOrEqual(30);
    await act(async()=>setDraft(host,'My DBMS exam is tomorrow. I have two hours.'));
    expect(host.querySelector('#results-title')).not.toBeNull();
    expect(host.querySelector('.composer [aria-label="Send message"]')).not.toBeNull();
  } finally {
    await act(async()=>root.unmount());
    host.remove();
    history.replaceState(null,'',location.pathname);
  }
});

it('reoptimizes real plan candidates on chat without reanalyzing their sources', async ()=>{
  const host=document.createElement('div');
  document.body.append(host);
  const root=createRoot(host);
  let calls=0;
  const questions:RankedQuestion[]=fixture.slice(0,3).map((question,index)=>({...question,
    priorityScore:[50,40,40][index],minutes:[40,30,30][index],topicIds:[question.topic],marks:0,
    historicalFrequency:0,historicalPaperCount:0,examYears:[],scoreComponents:{},
    learning:{type:'explanation',baseMinutes:index===0?[20,10,5]:[15,6,5],difficulty:'standard',material:'question-only',prerequisites:[],
      checkpoints:[{id:'u',text:'Explain the idea',phase:'understanding',label:'Type guide'},
        {id:'p',text:'Try an example',phase:'practice',label:'Type guide'},
        {id:'r',text:'Recall it',phase:'recall',label:'Type guide'}]}}));
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({available:true,explanation:'Normalization reduces duplicated data.',sources:[]})));
  const topics=questions.map(question=>({id:question.topic,title:question.topic,weight:1}));
  const api:ExamApi={...demoApi,async analyze(context) {
    calls++;
    return {questions,warnings:[],optimization:{candidates:questions,topics,plan:makeLearningPlan(questions,topics,context.minutes,context.pattern,context.familiarity)}};
  }};
  const input=(selector:string,value:string)=>{
    const field=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector)!;
    const type=field instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype,'value')!.set!.call(field,value);
    field.dispatchEvent(new Event('input',{bubbles:true}));
  };
  const submit=(selector:string)=>host.querySelector(selector)!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  const reveal=()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Generate Questions')!.click();
  try {
    await act(async()=>root.render(<App api={api}/>));
    await act(async()=>input('textarea','My DBMS exam is tomorrow. I have 67 minutes. Summarize my notes: Normalization reduces duplicated data.'));
    await act(async()=>submit('.composer'));
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Generate Questions')!.click());
    expect([...host.querySelectorAll('.question h3')].map(item=>item.textContent)).toEqual(questions.slice(1).map(q=>q.prompt));
    await writeMessage(host,'I only have 45 minutes now.');
    expect(host.querySelector('#results-title')).not.toBeNull();
    await act(async()=>reveal());
    expect(host.querySelector('.question h3')?.textContent).toBe(questions[0].prompt);
    expect(host.querySelector('.question .source')?.textContent).toContain('p. 1 · Q1');
    const checkpoint=host.querySelector<HTMLSelectElement>('.question select')!;
    await act(async()=>{
      checkpoint.value='completed';
      checkpoint.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await writeMessage(host,'I have only 44 minutes left.');
    expect(host.querySelector('#results-title')).not.toBeNull();
    await act(async()=>reveal());
    expect(host.querySelector<HTMLSelectElement>('.question select')?.value).toBe('completed');
    expect(host.querySelector('.question .checkpoints p')?.textContent).toContain('1/3 checkpoints');
    expect(calls).toBe(1);
  } finally {
    await act(async()=>root.unmount());
    host.remove();
  }
});

it('chooses syllabus-aligned review over a cheap unrelated question in ten minutes',()=>{
 const [rare,aligned]=fixture;
 const candidates:RankedQuestion[]=[rare,aligned].map((question,index)=>({...question,
  topicIds:[index?'syllabus:deadlock':'question:throughput'],priorityScore:index?60:200,
  historicalFrequency:1,historicalPaperCount:2,examYears:[2025],scoreComponents:{},
  learning:{type:'explanation',prerequisites:[],difficulty:'standard',material:'question-only',
    baseMinutes:index?[12,5,3]:[2,2,1],checkpoints:[
      {id:'1',text:'Explain',label:'Type guide',phase:'understanding'},
      {id:'2',text:'Practice',label:'Type guide',phase:'practice'},
      {id:'3',text:'Recall',label:'Type guide',phase:'recall'},
    ]},
 }));
 const topics=[{id:'syllabus:deadlock',title:'Deadlock',weight:1.5},{id:'question:throughput',title:'Throughput',weight:1}];
 const context=demoApi.parse('My Operating Systems exam is tomorrow. I have only 10 minutes.');
 const plan=makeLearningPlan(candidates,topics,context.minutes,'',context.familiarity);
 expect(plan.selectedQuestionIds).toEqual([rare.id]);
 const selected=prepareScope({questions:candidates,warnings:[],optimization:{candidates,topics,plan}},context);
 expect(selected.questions.map(q=>q.id)).toEqual([aligned.id]);
 expect(selected.review).toBe(true);
 expect(selected.allocations[aligned.id]+1).toBeLessThanOrEqual(10);
});

it('generates study pages on demand and keeps page position and analysis across the two modes',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);
  const requests:{studyUnit?:boolean;topic?:string;minutes?:number;task?:string}[]=[];
  const api:ExamApi={...demoApi,analyze:vi.fn(demoApi.analyze)};
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const request=JSON.parse(init.body);requests.push(request);
    return Response.json({explanation:'Example explanation for '+request.topic,sources:[]});}));
  const button=(label:string,container:Element=host)=>Array.from(container.querySelectorAll('button')).find(item=>item.textContent===label)!;
  const click=(label:string,container?:Element)=>act(async()=>button(label,container).click());
  const submit=()=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  try{
    await act(async()=>root.render(<App api={api}/>));
    const modes=host.querySelector('[aria-label="Preparation mode"]')!;
    await click('Study',modes);
    await act(async()=>{const input=host.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Help me study DBMS');
      input.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>{submit();await new Promise(resolve=>setTimeout(resolve,470));});
    expect(host.querySelector('[role=log]')?.textContent).not.toContain('How many minutes can you study?');
    expect(host.querySelector('.book-page-number')?.textContent).toMatch(/^Page 1 of /);
    expect(requests.filter(req=>req.studyUnit)).toHaveLength(1);
    await click('Next →');
    const secondPage=host.querySelector('#book-page-title')?.textContent;
    expect(requests.filter(req=>req.studyUnit)).toHaveLength(2);
    await click('← Previous');
    expect(requests.filter(req=>req.studyUnit)).toHaveLength(2);
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Study navigation"]')!.click());
    const toc=host.querySelector('[aria-label="Table of contents"]')!;
    await act(async()=>toc.querySelectorAll('button')[1].click());
    expect(host.querySelector('#book-page-title')?.textContent).toBe(secondPage);
    expect(requests.filter(req=>req.studyUnit)).toHaveLength(2);
    await click('Last Minute',modes);
    await act(async()=>submit());
    await writeMessage(host,'5 minutes');
    expect(host.querySelector('.summary')?.textContent).toContain('5 min available');
    await click('Study',modes);
    expect(host.querySelector('#book-page-title')?.textContent).toBe(secondPage);
    expect(requests.filter(req=>req.studyUnit)).toHaveLength(2);
    await act(async()=>{const input=host.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Help me study DBMS I have 15 minutes.');
      input.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(host.querySelector('#book-page-title')?.textContent).toBe(secondPage);
    await click('Last Minute',modes);
    await act(async()=>submit());
    expect(host.querySelector('.summary')?.textContent).toContain('15 min available');
    expect(requests.filter(req=>req.studyUnit)).toHaveLength(2);
    expect(api.analyze).toHaveBeenCalledTimes(1);
  }finally{
    await act(async()=>root.unmount());
    host.remove();vi.unstubAllGlobals();history.replaceState(null,'',location.pathname);
  }
});

it('offers questions on a prompt-only Study page and lets users retry failed practice generation',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);
  const api:ExamApi={...demoApi,analyze:async()=>({questions:[],warnings:[]})};
  let practiceCalls=0;
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
    const request=JSON.parse(init.body);
    if(request.task==='practice'){
      expect(request.priorities[0].id).toBe(1);
      practiceCalls++;
      return practiceCalls===1?Response.json({code:'usage_limit'},{status:429}):
        Response.json({questions:[{id:request.priorities[0].id,prompt:'How can a circular wait lead to deadlock?'}]});
    }
    return Response.json({explanation:'Deadlock occurs when processes wait indefinitely for one another.',sources:[]});
  }));
  const button=(label:string)=>[...host.querySelectorAll('button')].find(item=>item.textContent===label)!;
  try{
    await act(async()=>root.render(<App api={api}/>));
    await act(async()=>button('Study').click());
    await act(async()=>{
      const input=host.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Teach me about deadlock.');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    const details=[...host.querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent==='Generate Questions')!;
    await act(async()=>{details.querySelector('summary')!.click();await new Promise(resolve=>setTimeout(resolve,25));});
    expect(host.querySelector('.question h3')?.textContent).toBe('What are the key points to remember about deadlock?');
    expect(host.querySelector('.question .source')).toBeNull();
    await act(async()=>button('Retry AI questions').click());
    expect(host.querySelector('.question h3')?.textContent).toBe('How can a circular wait lead to deadlock?');
    expect(host.querySelector('.question')?.textContent).toContain('AI-Generated Practice Question');
    expect(practiceCalls).toBe(2);
    await act(async()=>button('Last Minute').click());
    await act(async()=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await writeMessage(host,'5 minutes');
    await act(async()=>button('Generate Questions').click());
    expect(host.querySelector('.question h3')?.textContent).toBe('How can a circular wait lead to deadlock?');
    expect(practiceCalls).toBe(3);
  }finally{
    await act(async()=>root.unmount());
    host.remove();vi.unstubAllGlobals();history.replaceState(null,'',location.pathname);
  }
});
