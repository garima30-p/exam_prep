// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { App } from './main';
import { prepareScope } from './preparation-scope';
import { demoApi, fixture } from './api';
import type { ExamApi, RankedQuestion } from './api';
import { makeLearningPlan } from '../server/learning.mjs';

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
    await act(async()=>root.render(<App/>));
    await act(async()=>setValue(host.querySelector('textarea')!,'My DBMS exam is tomorrow. Make a study plan.'));
    const picker=host.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(picker,'files',{value:[new File(['fixture'],'DBMS_PYQ.pdf',{type:'application/pdf'})]});
    await act(async()=>picker.dispatchEvent(new Event('change',{bubbles:true})));
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Type for DBMS_PYQ.pdf"]')?.value).toBe('Past paper');
    await act(async()=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(host.textContent).toContain('How much time do you have to prepare?');
    await act(async()=>setValue(host.querySelector<HTMLInputElement>('#time')!,'5 hours'));
    await act(async()=>host.querySelector('#time')!.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,460));});
    expect(host.querySelectorAll('.question')).toHaveLength(0);
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Generate Questions')!.click());
    expect(host.querySelectorAll('.question')).toHaveLength(10);
    expect(document.activeElement?.id).toBe('results-title');
    expect(host.querySelector('.composer button[type=submit]')?.textContent).toBe('Summary generated ↓');
    expect(host.querySelector('.coach')).toBeNull();
    await act(async()=>host.querySelector<HTMLAnchorElement>('a[href="#study-coach"]')!.click());
    await act(async()=>setValue(host.querySelector<HTMLInputElement>('[aria-label="Ask about your plan"]')!,'Why #1?'));
    await act(async()=>host.querySelector('.coach form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(host.querySelector('[role=log]')?.textContent).toContain('page 1, Q1');
    await act(async()=>setValue(host.querySelector<HTMLInputElement>('[aria-label="Ask about your plan"]')!,'Only 30 minutes left'));
    await act(async()=>host.querySelector('.coach form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(host.querySelector('[role=log]')?.textContent?.indexOf('Only 30 minutes left')).toBeLessThan(host.querySelector('[role=log]')?.textContent?.indexOf('Why #1?')??0);
    await act(async()=>host.querySelector<HTMLAnchorElement>('nav[aria-label="Workspace"] a[href="#main"]')!.click());
    expect(host.querySelector('.summary')?.textContent).toContain('30 min available');
    expect(host.querySelectorAll('.question').length).toBeGreaterThan(0);
    const allocations=[...host.querySelectorAll('.study-timeline strong')].map(item=>parseInt(item.textContent??'0',10));
    expect(allocations.reduce((sum,item)=>sum+item,0)).toBeLessThanOrEqual(30);
    await act(async()=>setValue(host.querySelector('textarea')!,'My DBMS exam is tomorrow. I have two hours.'));
    expect(host.querySelector('#results-title')).toBeNull();
    expect(host.querySelector('.composer button[type=submit]')?.textContent).toBe('Generate Summary');
  } finally {
    await act(async()=>root.unmount());
    host.remove();
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
    await act(async()=>host.querySelector<HTMLAnchorElement>('a[href="#study-coach"]')!.click());
    await act(async()=>input('[aria-label="Ask about your plan"]','I only have 45 minutes now.'));
    await act(async()=>submit('.coach form'));
    await act(async()=>host.querySelector<HTMLAnchorElement>('nav[aria-label="Workspace"] a[href="#main"]')!.click());
    expect(host.querySelector('#results-title')).toBeNull();
    await act(async()=>submit('.composer'));
    await act(async()=>reveal());
    expect(host.querySelector('.question h3')?.textContent).toBe(questions[0].prompt);
    expect(host.querySelector('.question .source')?.textContent).toContain('p. 1 · Q1');
    const checkpoint=host.querySelector<HTMLSelectElement>('.question select')!;
    await act(async()=>{
      checkpoint.value='completed';
      checkpoint.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await act(async()=>host.querySelector<HTMLAnchorElement>('a[href="#study-coach"]')!.click());
    await act(async()=>input('[aria-label="Ask about your plan"]','I have only 44 minutes left.'));
    await act(async()=>submit('.coach form'));
    await act(async()=>host.querySelector<HTMLAnchorElement>('nav[aria-label="Workspace"] a[href="#main"]')!.click());
    expect(host.querySelector('#results-title')).toBeNull();
    await act(async()=>submit('.composer'));
    await act(async()=>reveal());
    expect(host.querySelector<HTMLSelectElement>('.question select')?.value).toBe('completed');
    expect(host.querySelector('.question details:last-of-type summary')?.textContent).toContain('1/3 checkpoints');
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
