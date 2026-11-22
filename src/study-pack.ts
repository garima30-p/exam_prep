import { documentFormat, documentLocation } from './document-formats';
import type { Context, Question, Source } from './api';
import type { LearningPlan } from '../server/learning.mjs';
import type { Revision } from './revision';

export const familiarityLabels = {
  unknown:'Unspecified', scratch:'Starting from scratch', familiar:'Somewhat familiar', revising:'Mostly revising',
};
export type StudyNote = {
  question: Question;
  minutes: number;
  priority: number;
  paragraphs: string[];
  source?: Source;
  checkpoint?: string;
  readOnly: boolean;
};
export type StudyPack = {
  revision?:Revision;
  subject: string;
  context: string[];
  notes: StudyNote[];
  timeline: { title: string; minutes: number }[];
  questions: { question: Question; minutes: number; rank: number; answer: string[] }[];
  warnings: string[];
};
export type Section = 'all' | 'notes' | 'timeline' | 'questions';

export const sourceLabel = (source: Source) => {
  const format=documentFormat(source.file);
  const location=format&&format!=='pdf'?documentLocation(source.file,source.page):'p. '+source.page;
  return source.file+(source.file==='Pasted text'?'':' · '+location)+' · '+source.number;
};

export function answerLines(question: Question, sample: boolean, minutes: number) {
  const text = question.answerSource?.excerpt || (sample ? question.answer : '');
  const parts = text.split(/(?<=[.!?])\s+(?=[\p{Lu}\d(])/u);
  return parts.map(part => part.trim()).filter(Boolean).slice(0, minutes <= 15 ? 2 : minutes <= 45 ? 4 : 8);
}

export function buildStudyPack(context: Context, minutes: number, plan: LearningPlan | null,
  fitted: readonly Question[], visible: readonly Question[], candidates: readonly Question[],
  sample: boolean, warnings: string[]): StudyPack {
  const notes: StudyNote[] = [];
  const timeline: StudyPack['timeline'] = [];
  const seen = new Set<string>();
  let spare = (plan?.preparationBudgetMinutes ?? Math.floor(minutes * .9)) -
    fitted.reduce((sum, question) => sum + (plan?.efforts[question.id]?.minutes ?? question.minutes), 0);

  function addNote(question: Question, allocation: number, readOnly: boolean) {
    const paragraphs = answerLines(question, sample, readOnly ? Math.min(minutes, 15) : minutes);
    const evidence = question.answerSource ?? (sample ? question.source : undefined);
    const key = paragraphs.join(' ').toLowerCase().replace(/\W+/g, ' ');
    if (!paragraphs.length || seen.has(key)) return false;
    seen.add(key);
    notes.push({ question, minutes:allocation, priority:notes.length+1, paragraphs, source:evidence,
      checkpoint: question.learning?.checkpoints.find(item=>item.phase==='recall')?.text, readOnly });
    return true;
  }

  const selected = new Set(fitted.map(question => question.id));
  for (const question of fitted) {
    const effort = plan?.efforts[question.id];
    const allocation = effort?.minutes ?? question.minutes;
    if (notes.length < 8 && (effort?.remaining.understanding ?? allocation) > 0) {
      addNote(question, allocation, false);
    }
    timeline.push({ title:question.topic, minutes:allocation });
  }
  for (const question of candidates) {
    if (spare < 2 || notes.length >= (minutes <= 15 ? 2 : minutes <= 45 ? 4 : 8)) break;
    if (selected.has(question.id) || plan?.preparedQuestionIds.includes(question.id)) continue;
    const allocation = Math.min(spare, minutes <= 15 ? 3 : 5);
    if (!addNote(question, allocation, true)) continue;
    timeline.push({ title:question.topic + ' (read only)', minutes:allocation });
    spare -= allocation;
  }
  const recall = timeline.length ? (plan?.revisionMinutes ?? Math.ceil(minutes * .1)) : 0;
  if (recall > 0) timeline.push({ title:'Active recall', minutes:recall });
  return {
    subject:context.subject,
    context:[context.subject, context.minutes?minutes+' min available':'', context.familiarity==='unknown'?'':familiarityLabels[context.familiarity],
      context.pass?'Passing target '+context.pass:''].filter(Boolean),
    notes, timeline,
    questions:visible.map((question,index)=>({question,rank:index+1,
      minutes:plan?.efforts[question.id]?.minutes ?? question.minutes,answer:answerLines(question,sample,minutes)})),
    warnings,
  };
}

export type ExportBlock = { level: 0 | 1 | 2 | 3; text: string };

export function exportBlocks(pack: StudyPack, section: Section): ExportBlock[] {
  const blocks: ExportBlock[] = [];
  const add = (level: ExportBlock['level'], text: string) => blocks.push({ level, text });
  add(0, 'in-nocent · Study pack');
  add(3, pack.context.join(' · '));
  if (section === 'all' || section === 'notes') {
    add(1, 'Must Read Now');
    if(pack.revision){
      add(2,pack.revision.title);
      for(const passage of pack.revision.passages){
        add(3,passage.excerpt);
        add(3,'Source: '+sourceLabel(passage));
      }
      add(3,'Recall: '+pack.revision.recall);
      add(3,pack.revision.answer);
    }
    if (!pack.notes.length&&!pack.revision) add(3, noNotes);
    for (const note of pack.notes) {
      add(2, note.priority + '. ' + note.question.topic + ' · ' + note.minutes + ' min' + (note.readOnly ? ' (read only)' : ''));
      note.paragraphs.forEach(text=>add(3,text));
      if (note.checkpoint) add(3, 'Recall: ' + note.checkpoint);
      add(3, 'Related question: ' + note.question.prompt);
      if(note.source) add(3, 'Source: ' + sourceLabel(note.source));
    }
  }
  if (section === 'all' || section === 'timeline') {
    add(1, 'Your Preparation Timeline');
    if(!pack.timeline.length) add(3,'No study tasks fit within the available time and evidence.');
    for(const item of pack.timeline) add(3,item.title + ' · ' + item.minutes + ' min');
    add(3,'Total: '+pack.timeline.reduce((sum,item)=>sum+item.minutes,0)+' min. Times are estimates.');
  }
  if (section === 'all' || section === 'questions') {
    add(1, 'Important Questions');
    if (!pack.questions.length) add(3,'No complete question fits this plan.');
    for(const {question,rank,minutes,answer} of pack.questions) {
      add(2, rank + '. ' + question.prompt);
      add(3, [question.unit?'Unit '+question.unit:'',minutes+' min',question.marks?question.marks+' marks':'',question.reason].filter(Boolean).join(' · '));
      answer.forEach(text=>add(3,text));
      if(!answer.length)add(3, 'No supporting answer passage is available.');
      for(const checkpoint of question.learning?.checkpoints ?? [])add(3, 'Checkpoint: '+checkpoint.text);
      for(const source of question.sources??[question.source])add(3,'Source: '+sourceLabel(source));
      if(question.answerSource)add(3,'Answer source: '+sourceLabel(question.answerSource));
    }
  }
  if(section==='all'&&pack.warnings.length){
    add(1,'Sources and Coverage');
    pack.warnings.forEach(warning=>add(3,warning));
  }
  return blocks;
}

export const noNotes = 'No supporting explanation was found. Add class notes or a solved question bank for source-backed notes.';
