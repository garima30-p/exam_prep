import { expect, it } from 'vitest';
import { revise } from './revision';

const text='FIFO evicts the page that arrived earliest. LRU evicts the page whose most recent access was furthest in the past. A hit updates recency in LRU.';

it('does not generate notes from a time-only prompt and administrative syllabus text',()=>{
  const file={id:1,kind:'Syllabus',file:{name:'OS syllabus.pdf'} as File};
  const document={id:1,name:'OS syllabus.pdf',total:1,pages:[{number:1,
    text:'Category of Course: | OC\nCourse Outcome | COI Understand the concept\nProcess Synchronization',
    method:'ocr' as const,status:'extracted' as const,questions:0,reason:''}]};
  expect(revise('Only have 10 mins.',[document],[file],'Operating Systems')).toBeNull();
});

it('extracts the FIFO/LRU contrast with or without a budget',()=>{
  for(const input of [text,'My Operating Systems exam is tomorrow. I have 30 minutes to study. Summarize my notes: '+text]){
    const result=revise(input,[],[],'');
    expect(result?.title).toBe('FIFO vs. LRU');
    expect(result?.passages.map(p=>p.excerpt).join(' ')).toBe(text);
    expect(result?.answer).toContain('whose most recent access was furthest in the past');
  }
});

it('does not treat a question or an unreadable page as explanatory material',()=>{
  expect(revise('Define virtual memory?',[],[],'')).toBeNull();
  expect(revise('',[{id:1,name:'scan.pdf',total:1,pages:[{number:1,text,method:'ocr',status:'review',questions:0,reason:''}]}],[],'')).toBeNull();
});

it('retains a notes PDF citation and excludes question-only past-paper text from answers',()=>{
  const file={id:4,kind:'Notes',file:{name:'lecture.pdf'} as File};
  const document={id:4,name:'lecture.pdf',total:1,pages:[
    {number:1,text,status:'extracted' as const,method:'pdf-text' as const,questions:0,reason:''},
  ]};
  expect(revise('',[document],[file],'')?.passages[0]).toMatchObject({file:'lecture.pdf',page:1,documentIndex:4});
  const paper={...document,pages:[{...document.pages[0],text:'Q1. Compare FIFO and LRU page replacement policies.'}]};
  expect(revise('',[paper],[{...file,kind:'Past paper'}],'')).toBeNull();
});
