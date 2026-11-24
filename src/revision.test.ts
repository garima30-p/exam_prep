import { expect, it } from 'vitest';
import { revise } from './revision';
import { inspectStudyInput } from './study-input';

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

it('does not count the exact exam request as uploaded explanation evidence',()=>{
  const input='My Operating Systems exam is tomorrow. I have only 10 minutes to study. Use my attached syllabus and previous-year paper to identify what matters most and generate concise revision notes.';
  expect(revise(input,[],[],'Operating Systems')).toBeNull();
});

it('classifies from trusted content and keeps learner overrides',()=>{
  const files=[1,2,3,4].map(id=>({id,kind:'Unclassified',file:{name:'upload-'+id+'.pdf'} as File}));
  const document=(id:number,text:string,status:'extracted'|'review'='extracted')=>({
    id,name:'upload-'+id+'.pdf',total:1,
    pages:[{number:1,text,status,method:'ocr' as const,questions:0,reason:''}],
  });
  const documents=[
    document(1,'TCS 502 Operating Systems\nCourse Outcomes\nIdentify administrative requirements.\nDetails of the Course\nUnit I: CPU scheduling\nUnit II: Deadlock prevention'),
    document(2,'End Semester Examination\nOperating Systems\nQ1. Explain deadlock prevention.\nQ2. Compare FIFO and LRU.'),
    document(3,'Department of computer science\nCourse Outcomes\nUnderstand the concept.'),
    document(4,'garbled deadlock OCR','review'),
  ];
  const result=inspectStudyInput(documents,files);
  expect(result.files.map(file=>file.kind)).toEqual(['Syllabus','Past paper','Administrative','Unreadable']);
  expect(result.subject).toBe('Operating systems');
  expect(result.outline.map(topic=>topic.title)).toEqual(['CPU scheduling','Deadlock prevention']);
  expect(inspectStudyInput(documents,[{...files[1],kind:'Notes',kindOverride:true}]).files[0].kind).toBe('Notes');
});
