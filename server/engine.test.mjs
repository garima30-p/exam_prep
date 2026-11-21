import { expect, it } from 'vitest';
import { handle } from './engine.mjs';

function post(body,origin) {
  return handle(new Request('http://localhost/api/analyze',{
    method:'POST',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)
  }));
}

it('ranks real extracted questions, counts distinct papers, and resolves answer evidence',async()=>{
  const result=await post({materials:[
    {name:'old.pdf',kind:'Past paper',documentIndex:23,pages:[{number:2,text:'Q1. Explain database normalization. [10]\nQ2. Explain database normalization. [10]'}]},
    {name:'recent.pdf',kind:'Past paper',pages:[{number:4,text:'Q3. Explain database normalization. (10)\nQ4. Compare inner and outer joins.'}]},
    {name:'notes.pdf',kind:'Notes',pages:[{number:1,text:'Database normalization organizes relations to reduce redundancy and prevent update anomalies.'}]}
  ]});
  expect(result.status).toBe(200);
  const {questions}=await result.json();
  expect(questions).toHaveLength(2);
  expect(questions[0]).toMatchObject({
    marks:10,reason:'Found in 2 of 2 uploaded past papers',
    source:{file:'old.pdf',page:2,number:'1',documentIndex:23},answerSource:{file:'notes.pdf',page:1}
  });
});

it('uses section and syllabus evidence with missing marks and renamed duplicate papers',async()=>{
  const pages=[{number:1,text:'Section B\nQ1. Explain database normalization.'}];
  const response=await post({minutes:35,pattern:'Section B is compulsory',materials:[
    {name:'DBMS_PYQ_2023.pdf',kind:'Past paper',pages},
    {name:'renamed-copy.pdf',kind:'Past paper',pages},
    {name:'syllabus.pdf',kind:'Syllabus',pages:[{number:2,text:'Unit II: Database normalization'}]}
  ]});
  const {questions,topics,plan}=await response.json();
  const selected=questions.find(question=>question.id===plan.selectedQuestionIds[0]);
  expect(selected).toMatchObject({units:[2],sections:['B'],marks:0,scoreComponents:{marks:null,syllabus:1},
    examYears:[2023],historicalFrequency:1,historicalPaperCount:1});
  expect(selected.sources).toHaveLength(2);
  expect(topics.some(topic=>topic.unit===2)).toBe(true);
  expect(plan.requirements[0].satisfied).toBe(true);
});

it('reports insufficient material without inventing a question or citation',async()=>{
  const response=await post({materials:[{name:'Pasted text',kind:'Unclassified',pages:[{number:1,text:'My exam is tomorrow.'}]}]});
  expect(await response.json()).toMatchObject({questions:[],topics:[],plan:{selectedQuestionIds:[]}});
});

it('bounds inputs and rejects cross-origin requests',async()=>{
  expect((await post({materials:[]},'https://other.invalid')).status).toBe(403);
  expect((await post({materials:[{name:'x',kind:'Past paper',pages:[{number:0,text:'x'}]}]})).status).toBe(400);
  expect((await post({padding:'a'.repeat(4_010_000)})).status).toBe(413);
});

it('excludes unverified pages and incomplete papers from historical frequency',async()=>{
  const response=await post({minutes:120,materials:[
    {name:'complete.pdf',kind:'Past paper',totalPages:1,pages:[{number:1,text:'Explain virtual memory.',method:'pdf-text'}]},
    {name:'incomplete.pdf',kind:'Past paper',totalPages:3,pages:[
      {number:1,text:'Explain virtual memory.',method:'ocr',status:'extracted'},
      {number:2,text:'Explain a hallucinated question.',method:'ocr',status:'review'}
    ]}
  ]});
  expect(response.status).toBe(200);
  const {questions}=await response.json();
  expect(questions).toHaveLength(1);
  expect(questions[0]).toMatchObject({historicalFrequency:1,historicalPaperCount:1});
  expect(questions[0].sources.map(source=>source.file)).toEqual(['complete.pdf','incomplete.pdf']);
});

it('accepts late pages and holds back complex OCR questions until manually verified',async()=>{
  const response=await post({materials:[
    {name:'large.pdf',kind:'Past paper',complete:false,pages:[
      {number:121,text:'Explain virtual memory.',method:'ocr'},
      {number:122,text:'Calculate the following reference string: 1, 2, 3.',method:'ocr'},
      {number:123,text:'Calculate the average waiting time for this sequence.',method:'manual',status:'verified'}
    ]}
  ]});
  const {questions}=await response.json();
  expect(questions.map(q=>q.source.page)).toEqual([121,123]);
  expect(questions.every(q=>q.historicalFrequency===0)).toBe(true);
});

it('keeps the raw OCR citation but gives marks credit only to verified text',async()=>{
  const response=await post({materials:[
    {name:'scan.pdf',kind:'Past paper',pages:[
      {number:1,text:'Q2. Explain virtual memory. [3]',method:'ocr'},
      {number:2,text:'Q3. Explain thrashing. [5]',method:'manual',status:'verified'}
    ]}
  ]});
  const {questions}=await response.json();
  expect(questions.find(q=>q.source.page===1)).toMatchObject({marks:0,scoreComponents:{marks:null},source:{number:'Line 1',excerpt:expect.stringContaining('[3]')}});
  expect(questions.find(q=>q.source.page===2)).toMatchObject({marks:5,source:{number:'3'}});
});
