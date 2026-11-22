import type { SyllabusTopic } from '../server/optimizer.mjs';
import { describeLearning, familiarityFrom, makeLearningPlan } from '../server/learning.mjs';
import type { Familiarity, LearningCandidate, LearningPlan, LearningProfile } from '../server/learning.mjs';
import type { ExtractedDocument, PrepareOptions } from './document-state';
export type Context = {subject:string; date:string; minutes:number; pass:string; pattern:string; familiarity:Familiarity};
export type Material = {id:number; file:File; kind:string; kindOverride?:boolean};
export type Source = {id?:string; file:string; page:number; number:string; excerpt:string; documentIndex?:number;method?:'pdf-text'|'office-text'|'ocr'|'manual'};
export type Question = {id:number; topic:string; unit:number; prompt:string; minutes:number; marks:number; reason:string; source:Source; sources?:Source[]; answerSource?:Source|null; answer:string;learning?:LearningProfile;historicalFrequency?:number;historicalPaperCount?:number;examYears?:number[];historical?:boolean;practiceSeed?:boolean};
export type RankedQuestion = Question & LearningCandidate & {
  historicalFrequency:number;
  historicalPaperCount:number;
  paperIds?:number[];
  variants?:{id:number;prompt:string;sources:Source[]}[];
  examYears:number[];
  scoreComponents:Record<string,number|null>;
};
export type Analysis = {questions:readonly Question[];warnings:string[];generatedCoach?:boolean; optimization?:{
  candidates:readonly RankedQuestion[];
  topics:readonly SyllabusTopic[];
  plan:LearningPlan;
}};
export interface ExamApi {
  prepare?(materials:readonly Material[],options:PrepareOptions):Promise<ExtractedDocument[]>;
  parse(prompt:string):Context;
  analyze(context:Context, materials:readonly Material[], prompt:string,options?:{documents:readonly ExtractedDocument[];signal?:AbortSignal;onPlanning?:()=>void}):Promise<Analysis>;
  chat(message:string, questions:readonly Question[]):string;
}

export function duration(value:string) {
  const small = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens = ['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const words = new RegExp('\\b(' + tens.join('|') + ')(?:[- ](' + small.slice(1,10).join('|') + '))?\\b|\\b(' + small.join('|') + ')\\b', 'g');
  const normalized = value.toLowerCase().replace(words, (_, ten, unit, simple) =>
    String(ten ? (tens.indexOf(ten)+2)*10 + (unit ? small.indexOf(unit) : 0) : small.indexOf(simple)))
    .replace(/\b(?:an?|one)\s+hour\b/g, '1 hour');
  const explicit = /\b(?:have|can study for|time to study is|study for|only|replan for)\s+(?:just\s+|only\s+)?(?=\d)/g;
  const budgets = [...normalized.matchAll(explicit)];
  const input = budgets.length ? normalized.slice(budgets.at(-1)!.index! + budgets.at(-1)![0].length)
    : normalized.replace(/\b(?:exam|test|paper)\b[^.!?,;\n]*?\b(?:in|after|starts? in)\s+(?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|days?|d)\b\s*(?:and\s*)?)+/gi,'');
  const expression = input.match(/^\s*(?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|days?|d)(?![a-z])\s*(?:and\s*)?)+/)?.[0]
    ?? (!budgets.length ? input.match(/\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m|days?|d)\b(?=\s+left\b)/)?.[0] : undefined);
  const matches = expression?.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|days?|d)/g) ?? [];
  const minutes = [...matches].reduce((sum, [, amount, unit]) => sum + Number(amount) * ({h:60,d:1440,m:1}[unit[0]] ?? 1),0);
  return Number.isSafeInteger(Math.round(minutes)) ? Math.min(525600,Math.round(minutes)) : 0;
}

export function materialType(filename:string) {
  const name=filename.replace(/[_-]+/g,' ');
  if (/syllabus|curriculum/i.test(name)) return 'Syllabus';
  if (/notes|lecture|slides|question\s+bank|practice|mock|sample/i.test(name)) return 'Notes';
  if (/pyq|past|paper|previous|\b(?:mid|end)\s*(?:sem(?:ester)?|term)\b|\bexam(?:ination)?\b/i.test(name)) return 'Past paper';
  return 'Unclassified';
}

const examples: [string, string, string][] = [
 ['Normalization','Explain 1NF, 2NF and 3NF. Show how to decompose a relation into 3NF.','1NF requires atomic values. 2NF removes dependencies on part of a candidate key. 3NF additionally removes transitive dependencies between non-key attributes.'],
 ['SQL joins','Compare INNER JOIN and LEFT JOIN using a worked example.','INNER JOIN keeps matching pairs. LEFT JOIN also retains unmatched rows from the left table and fills right-side fields with NULL.'],
 ['Transactions','Explain the ACID properties of a transaction with an example.','Atomicity prevents partial commits. Consistency preserves constraints. Isolation controls concurrent effects. Durability preserves committed changes after failure.'],
 ['ER modelling','Draw an ER diagram for a library and map it to a relational schema.','Use Book, Member and Loan entities. Loan references a book copy and member using foreign keys.'],
 ['Keys','Compare candidate, primary and foreign keys with examples.','A candidate key minimally identifies a row. The primary key is the selected candidate key. A foreign key references a key in another relation.'],
 ['Indexing','Explain the structure and search operation of a B+ tree index.','Internal nodes route searches. Linked leaves support sequential scans and store record pointers.'],
 ['Relational algebra','Write relational algebra expressions for selection, projection and join.','Selection filters tuples, projection chooses attributes and join combines related tuples.'],
 ['Serializability','Use a precedence graph to test conflict serializability.','Add a directed edge for each ordered conflicting operation across transactions. A cycle means the schedule is not conflict serializable.'],
 ['Recovery','Explain undo and redo in write-ahead logging.','Persist the log before changed pages. Undo incomplete transactions and redo committed changes when required.'],
 ['Functional dependencies','Find a candidate key by computing attribute closures.','Start with a set of attributes and repeatedly apply dependencies until no more attributes can be added. A minimal set whose closure contains every attribute is a candidate key.'],
 ['Views','Explain views and give one use case.','A view exposes a query as a named relation. It can expose selected columns while hiding other data.'],
 ['Deadlocks','Explain how a wait-for graph detects deadlock.','Draw edges from waiting transactions to the transactions holding their requested locks. A cycle indicates deadlock.']
];

export const fixture:readonly Question[] = examples.map(([topic,prompt,answer],i) => ({
  id:i+1,topic,prompt,answer,unit:[2,2,3,1,1,4,2,3,4,2,2,3][i], minutes: i<3 ? [35,25,30][i] : 20,
  marks:i===0?10:5,reason:i<3?['Appears in 3 of 4 sample papers','Appears in 2 of 4 sample papers','Compulsory topic in the sample syllabus'][i]:'Covers an additional concept in the sample set',
  source:{file:'DBMS · sample paper',page:Math.floor(i/4)+1,number:'Q'+(i+1),excerpt:prompt}
}));

export const demoApi:ExamApi = {
  parse(prompt) {
    const subject = prompt.match(/\b(DBMS|OS|DSA|OOP|CN|DB|Operating Systems|Computer Networks|Database Management Systems|Mathematics)\b/i)?.[0] ?? prompt.match(/\bmy\s+([\w ]{2,45}?)\s+(?:exam|end.sem|midterm)\b/i)?.[1] ?? '';
    return {subject, date:prompt.match(/\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i)?.[0] ?? '',
      minutes:duration(prompt),pass:prompt.match(/\b(\d+\s*(?:\/|out of)\s*\d+)\b/i)?.[1] ?? prompt.match(/\b(\d+)\s+marks\b/i)?.[1] ?? '',
      pattern:prompt.split(/[.!?;\n]+/).filter(clause=>/\b(unit|section)\b/i.test(clause)&&/\b(compulsory|required|mandatory|must|attempt|choose|answer)\b/i.test(clause)).join('; ').trim().slice(0,600),
      familiarity:familiarityFrom(prompt)};
  },
  async analyze(context) {
    await new Promise(resolve=>setTimeout(resolve,420));
    const candidates=fixture.map((question,index)=>{
      const topicIds=['fixture:'+question.id];
      return {...question,topicIds,learning:describeLearning({...question,topicIds}),
        priorityScore:1200-50*index,historicalFrequency:0,historicalPaperCount:0,examYears:[],scoreComponents:{}};
    });
    const topics=candidates.map(question=>({id:question.topicIds[0],title:question.topic,unit:question.unit,weight:1}));
    return {questions:candidates,warnings:[],optimization:{candidates,topics,
      plan:makeLearningPlan(candidates,topics,context.minutes,context.pattern,context.familiarity)}};
  },
  chat(message, questions) {
    if (/\b(unit|coverage|gaps?)\b/i.test(message)) return 'Sample coverage includes units ' + ([...new Set(questions.map(q=>q.unit))].sort().join(', ') || 'none') + '. Your actual compulsory sections need to be checked against your syllabus.';
    const id = Number(message.match(/(?:#|question\s+)(\d+)/i)?.[1] ?? questions[0]?.id);
    const q = questions.find(item=>item.id===id);
    if (!q) return 'Try asking about a question in your visible sample plan.';
    if (/why|priority/i.test(message)) return q.reason + '. Sample source: ' + q.source.file + ', page ' + q.source.page + ', ' + q.source.number + '.';
    if (/answer|explain|simpl|mark/i.test(message)) return q.topic + ' · Sample answer\n' + q.answer;
    return 'Try “Why #' + q.id + '?”, “Explain #' + q.id + '”, or “Only 90 minutes left”.';
  }
};

export function fitQuestions(questions:readonly Question[], minutes:number) {
  let remaining = Math.floor(minutes * .9);
  return questions.filter(q=>{
    if(q.minutes>remaining) return false;
    remaining -= q.minutes;
    return true;
  });
}
