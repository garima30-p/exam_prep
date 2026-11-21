import { demoApi } from './api';
import type { Analysis, ExamApi, RankedQuestion } from './api';
import type { SyllabusTopic } from '../server/optimizer.mjs';
import type { LearningPlan } from '../server/learning.mjs';
import { makeLearningPlan } from '../server/learning.mjs';
import { EMBEDDING_LIMIT, groupQuestions } from '../server/semantic.mjs';
import { browserEmbeddings } from './embeddings';
import { extractDocuments } from './documents';
import { documentComplete, isTrusted } from './document-state';

export const liveApi:ExamApi = {
  parse:demoApi.parse,
  prepare:extractDocuments,
  async analyze(context, files, prompt, options):Promise<Analysis> {
    const warnings:string[]=[];
    if(files.length&&!options?.documents)throw new Error('Read and check the attached PDFs before generating a plan.');
    const materials=files.map(item=>{
      const record=options?.documents.find(document=>document.id===item.id);
      const complete=record!==undefined&&documentComplete(record);
      return {name:item.file.name,kind:item.kind,documentIndex:item.id,complete,totalPages:record?.total??null,
        pages:record?.pages.filter(isTrusted).map(({number,text,method,status})=>({number,text,method,status}))??[]};
    });
    const incomplete=materials.filter(material=>!material.complete);
    if(incomplete.length){
      const past=incomplete.filter(material=>material.kind==='Past paper').length;
      warnings.push('Rankings may be incomplete. '+incomplete.length+' attachment(s) have unread or unverified pages. '+(past?past+' incomplete past paper(s) were left out of historical frequency counts. ':'')+'Only usable text was submitted.');
    }
    if(materials.some(material=>material.pages.some(page=>page.method==='ocr')))
      warnings.push('OCR-only marks and questions that depend on numbers, tables, diagrams, code or calculations are held back. Verify or correct the page to include them.');
    if (prompt.trim()) materials.push({name:'Pasted text',kind:'Unclassified',documentIndex:0,complete:true,totalPages:1,
      pages:[{number:1,text:prompt,method:'manual',status:'verified'}]});
    const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},
      signal:options?.signal,body:JSON.stringify({materials,minutes:context.minutes,pattern:context.pattern,familiarity:context.familiarity})});
    const data=await response.json() as {questions?:RankedQuestion[];topics?:SyllabusTopic[];plan?:LearningPlan;generatedCoach?:boolean;error?:string};
    if(!response.ok||!data.questions||!data.topics||!data.plan) throw new Error(data.error||'Analysis service unavailable.');
    options?.onPlanning?.();
    const prompts=data.questions.slice(0,EMBEDDING_LIMIT).map(question=>question.prompt);
    const vectors=await browserEmbeddings(prompts,options?.signal);
    options?.signal?.throwIfAborted();
    if(prompts.length>1&&!vectors)warnings.push('Semantic matching was unavailable. Exact question matching was used.');
    const {questions,topics,mode}=groupQuestions(data.questions,data.topics,vectors,false);
    const plan=mode==='semantic'?makeLearningPlan(questions,topics,context.minutes,context.pattern,context.familiarity):data.plan;
    return {questions,warnings,generatedCoach:data.generatedCoach,optimization:{candidates:questions,topics,plan}};
  },
  chat(message,questions) {
    if (/\b(unit|coverage|gaps?)\b/i.test(message)) {
      const units=[...new Set(questions.map(question=>question.unit).filter(Boolean))].sort((a,b)=>a-b);
      return units.length?'Identified syllabus units in the visible plan: '+units.join(', ')+'. Check the paper rules for compulsory coverage.':'The visible materials do not identify syllabus units for this plan.';
    }
    const id=Number(message.match(/(?:#|question\s+)(\d+)/i)?.[1] ?? questions[0]?.id);
    const question=questions.find(item=>item.id===id);
    if(!question)return 'Refer to a visible ranked question, for example “Why #1?”';
    if(/why|priority/i.test(message))return question.reason+'. Source: '+question.source.file+', page '+question.source.page+', '+question.source.number+'.';
    if(/answer|explain|simpl|mark/i.test(message))return question.answer;
    return 'Ask why a question is ranked, request its supporting notes, or tell me how much study time you have left.';
  }
};

