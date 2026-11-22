// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { App } from './main';
import { demoApi, fixture } from './api';
import type { ExamApi, RankedQuestion } from './api';
import { makeLearningPlan } from '../server/learning.mjs';

it.each(['I have 30 minutes to study. ',''])('renders a real notes-only summary with budget prefix %j',async(prefix)=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement('div');
  document.body.append(host);
  const root=createRoot(host);
  const api:ExamApi={...demoApi,analyze:async()=>({questions:[],warnings:[]})};
  try{
    await act(async()=>root.render(<App api={api}/>));
    await act(async()=>{
      const prompt=host.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(prompt,
        'My Operating Systems exam is tomorrow. '+prefix+'Summarize my notes: FIFO evicts the page that arrived earliest. LRU evicts the page whose most recent access was furthest in the past. A hit updates recency in LRU.');
      prompt.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(document.activeElement?.id).toBe('results-title');
    expect(host.querySelector('[aria-label="Revision notes"]')?.textContent).toContain('A hit updates recency in LRU.');
    expect([...host.querySelectorAll('[aria-label="Revision notes"] details summary')].map(node=>node.textContent)).toContain('Show answer');
    expect(host.querySelector('.composer')).not.toBeNull();
    expect(host.textContent?.includes('Start here:')).toBe(Boolean(prefix));
  }finally{
    await act(async()=>root.unmount());
    host.remove();
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
    expect(host.textContent).toContain('How many minutes can you study?');
    await act(async()=>setValue(host.querySelector<HTMLInputElement>('#time')!,'5 hours'));
    await act(async()=>host.querySelector('#time')!.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,460));});
    expect(host.querySelectorAll('.question')).toHaveLength(0);
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Generate Questions')!.click());
    expect(host.querySelectorAll('.question')).toHaveLength(10);
    expect(document.activeElement?.id).toBe('results-title');
    expect(host.querySelector('.composer button[type=submit]')?.textContent).toBe('Notes are generated ↓');
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Ask why?')!.click());
    expect(host.querySelector('[role=log]')?.textContent).toContain('page 1, Q1');
    await act(async()=>setValue(host.querySelector<HTMLInputElement>('[aria-label="Ask about your plan"]')!,'Only 30 minutes left'));
    await act(async()=>host.querySelector('.coach form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(host.querySelector('.summary')?.textContent).toContain('30 min available');
    expect(host.querySelectorAll('.question').length).toBeGreaterThan(0);
    const allocations=[...host.querySelectorAll('.study-timeline strong')].map(item=>parseInt(item.textContent??'0',10));
    expect(allocations.reduce((sum,item)=>sum+item,0)).toBeLessThanOrEqual(30);
    expect(host.querySelector('[role=log]')?.textContent?.indexOf('Only 30 minutes left')).toBeLessThan(host.querySelector('[role=log]')?.textContent?.indexOf('Why #1?')??0);
    await act(async()=>setValue(host.querySelector('textarea')!,'My DBMS exam is tomorrow. I have two hours.'));
    expect(host.querySelector('#results-title')).toBeNull();
    expect(host.querySelector('.composer button[type=submit]')?.textContent).toBe('Generate Notes');
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
  try {
    await act(async()=>root.render(<App api={api}/>));
    await act(async()=>input('textarea','My DBMS exam is tomorrow. I have 67 minutes.'));
    await act(async()=>submit('.composer'));
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Generate Questions')!.click());
    expect([...host.querySelectorAll('.question h3')].map(item=>item.textContent)).toEqual(questions.slice(1).map(q=>q.prompt));
    await act(async()=>input('[aria-label="Ask about your plan"]','I only have 45 minutes now.'));
    await act(async()=>submit('.coach form'));
    expect(host.querySelector('.question h3')?.textContent).toBe(questions[0].prompt);
    expect(host.querySelector('.question .source')?.textContent).toContain('p. 1 · Q1');
    const checkpoint=host.querySelector<HTMLSelectElement>('.question select')!;
    await act(async()=>{
      checkpoint.value='completed';
      checkpoint.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await act(async()=>input('[aria-label="Ask about your plan"]','I have only 44 minutes left.'));
    await act(async()=>submit('.coach form'));
    expect(host.querySelector<HTMLSelectElement>('.question select')?.value).toBe('completed');
    expect(host.querySelector('.question summary')?.textContent).toContain('1/3 checkpoints');
    expect(calls).toBe(1);
  } finally {
    await act(async()=>root.unmount());
    host.remove();
  }
});
