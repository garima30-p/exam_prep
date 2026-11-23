// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { App } from './main';
import { prepareScope } from './preparation-scope';
import { demoApi, fixture } from './api';
import type { ExamApi, RankedQuestion } from './api';
import { makeLearningPlan } from '../server/learning.mjs';
import { bookOutline } from './study-book';
import { reviewItems } from './learning-review';

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

it('teaches a recognized exam subject immediately and caches each learning depth',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement('div');
  document.body.append(host);
  const root=createRoot(host);
  const analyze=vi.fn<ExamApi['analyze']>(async()=>({questions:[],warnings:[]}));
  const requests:{learningMode?:string;minutes?:number;topic?:string}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
    requests.push(JSON.parse(init.body));
    return Response.json({explanation:'A process is a program that is being executed. The kernel manages resources.',sources:[]});
  }));
  const button=(name:string)=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent===name)!;
  try{
    await act(async()=>root.render(<App api={{...demoApi,analyze}}/>));
    await act(async()=>{
      const input=host.querySelector<HTMLTextAreaElement>('#prompt')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'OS ka paper hai, kuch nahi padha.');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>host.querySelector('.composer')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(host.querySelector('.learning-notes h2')?.textContent).toBe('Operating Systems');
    expect(host.textContent).not.toContain('How many minutes');
    expect(host.textContent).not.toContain('Generate Questions');
    expect(analyze.mock.calls[0][0].minutes).toBe(0);
    expect(analyze.mock.calls[0][3]?.learning).toBe(true);
    expect(requests).toMatchObject([{learningMode:'last-minute',topic:'Operating Systems'}]);
    expect(requests[0]).not.toHaveProperty('minutes');
    await act(async()=>button('Next topic →').click());
    expect([...host.querySelectorAll('.learning-notes h2')].map(h=>h.textContent)).toEqual(['Operating Systems','Process Management']);
    await act(async()=>button('Study').click());
    expect(host.querySelector('.book-page-number')?.textContent).toContain('Page 2');
    expect(requests.at(-1)).toMatchObject({learningMode:'study',topic:'Process Management'});
    await act(async()=>button('Last Minute').click());
    expect(requests.length).toBe(3);
    expect(analyze).toHaveBeenCalledTimes(1);
  }finally{
    await act(async()=>root.unmount());
    host.remove();vi.unstubAllGlobals();
  }
});

it('uses only the displayed notes for recall and retains original historical question evidence in the quiz',()=>{
  const question={...fixture[11],topic:'Deadlock',historical:true};
  const page=bookOutline({questions:[question],warnings:[]},'Operating Systems','',[]).find(unit=>unit.title==='Deadlock')!;
  const notes='Deadlock occurs when processes wait indefinitely for resources held by one another.';
  const recall=reviewItems(page,notes,false);
  expect(recall).toHaveLength(1);
  expect(recall[0]).toMatchObject({answer:'Deadlock',explanation:notes});
  expect(recall[0]).not.toHaveProperty('sources');
  const quiz=reviewItems(page,notes,true);
  expect(quiz[0]).toMatchObject({prompt:question.prompt,sources:[question.source]});
});
