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
  const requests:{task?:string;learningMode?:string;minutes?:number;topic?:string}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
    const request=JSON.parse(init.body);
    requests.push(request);
    if(request.task==='practiceBatch')return Response.json({questions:[{prompt:'What is a process?'}]});
    if(request.task==='outline')return Response.json({topics:[{title:'Process Management',group:''}]});
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
    expect(requests.filter(request=>request.task==='notes')).toMatchObject([{learningMode:'last-minute',topic:'Operating Systems'}]);
    expect(requests.find(request=>request.task==='notes')).not.toHaveProperty('minutes');
    await act(async()=>{
      const dialog=host.querySelector<HTMLDialogElement>('#topic-map-title')?.closest('dialog');
      if(dialog)dialog.showModal=vi.fn();
      button('Next topic →').click();
    });
    await act(async()=>button('Next topic →').click());
    expect([...host.querySelectorAll('.learning-notes h2')].map(h=>h.textContent)).toEqual(['Process Management']);
    await act(async()=>button('Study').click());
    expect(host.querySelector('.book-page-number')?.textContent).toContain('Page 2');
    expect(requests.find(request=>request.learningMode==='study')).toMatchObject({topic:'Process Management'});
    expect(requests.some(request=>request.task==='practiceBatch')).toBe(false);
    await act(async()=>button('More Questions ↓').click());
    expect(requests.find(request=>request.task==='practiceBatch')).toMatchObject({topic:'Process Management'});
    await act(async()=>button('Last Minute').click());
    expect(requests.filter(request=>request.task==='notes')).toHaveLength(3);
    expect(requests.filter(request=>request.task==='academic')).toHaveLength(1);
    expect(requests.filter(request=>request.task==='practiceBatch')).toHaveLength(1);
    expect(requests.filter(request=>request.task==='example')).toHaveLength(0);
    expect(analyze).toHaveBeenCalledTimes(1);
  }finally{
    await act(async()=>root.unmount());
    host.remove();vi.unstubAllGlobals();
  }
});

it('requires evidence for recall and retains original historical question evidence in the quiz',()=>{
  const question={...fixture[11],topic:'Deadlock',historical:true};
  const page=bookOutline({questions:[question],warnings:[]},'Operating Systems','',[],[{title:'Deadlock',group:''}]).find(unit=>unit.title==='Deadlock')!;
  const notes='Deadlock occurs when processes wait indefinitely for resources held by one another.';
  const recall=reviewItems(page,{text:notes,references:[]},false);
  expect(recall).toHaveLength(1);
  expect(recall[0]).toMatchObject({rule:{kind:'unverified'}});
  const quiz=reviewItems(page,{text:notes,references:[{...question.source,kind:'uploaded',id:'N1',excerpt:notes,documentType:'Notes'}]},true);
  expect(quiz[0]).toMatchObject({prompt:'What is deadlock?',rule:{kind:'descriptive',rubric:[notes]}});
  expect(quiz.find(item=>item.historical)).toMatchObject({prompt:question.prompt,sources:[question.source]});
});

it('does not use ranked question fragments as navigation titles even without a syllabus',()=>{
 const historical={...fixture[11],topic:'Command',prompt:'Describe command processing in operating systems.',historical:true};
 const [root,...extra]=bookOutline({questions:[historical],warnings:[]},'Operating Systems','',[]);
 expect(extra).toEqual([]);
 expect(root.questions).toEqual([]);
 expect(root.unassignedQuestions).toEqual([historical]);
});

it('assigns historical questions to academic topics and keeps uncertain questions available in sources',()=>{
 const prompts=[
  'What is the critical section problem and why does mutual exclusion matter?',
  'Compare FCFS and other CPU scheduling algorithms.',
  'What are system calls? Describe their types.',
  'Explain the necessary conditions for deadlocks.',
  'Identify the commands needed to adjust the terminal.',
 ];
 const questions=prompts.map((prompt,index)=>({...fixture[0],id:index,topic:'Operating Systems',prompt,historical:true}));
 const pages=bookOutline({questions,warnings:[]},'Operating Systems','',[],[
  {title:'Introduction to Operating Systems',group:''},
  {title:'System Calls',group:'Introduction to Operating Systems'},
  {title:'Process Synchronization',group:''},
  {title:'CPU Scheduling',group:''},
  {title:'Deadlocks',group:''},
 ]);
 const assigned=(title:string)=>pages.find(page=>page.title===title)?.questions.map(question=>question.id);
 expect(assigned('Introduction to Operating Systems')).toEqual([]);
 expect(assigned('System Calls')).toEqual([2]);
 expect(assigned('Process Synchronization')).toEqual([0]);
 expect(assigned('CPU Scheduling')).toEqual([1]);
 expect(assigned('Deadlocks')).toEqual([3]);
 expect(pages[0].unassignedQuestions?.map(question=>question.id)).toEqual([4]);
});
