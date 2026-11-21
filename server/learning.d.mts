import type { Candidate, PreparationPlan, SyllabusTopic } from './optimizer.mjs';

export type Familiarity = 'scratch'|'familiar'|'revising'|'unknown';
export type CheckpointState = 'incomplete'|'completed'|'revision';
export type Progress = Record<number,Record<string,CheckpointState>>;
export type Phase = 'understanding'|'practice'|'recall';
export type LearningSource = {id?:string;file:string;page:number;number:string;excerpt:string;documentIndex?:number};
export type LearningProfile = {
  type:string;
  checkpoints:{id:string;text:string;label:string;phase:Phase;source?:LearningSource}[];
  prerequisites:string[];
  difficulty:'higher'|'standard';
  material:'notes'|'syllabus'|'question-only';
  baseMinutes:number[];
};
export type LearningEffort = {
  estimated:Record<Phase,number>;
  remaining:Record<Phase,number>;
  minutes:number;
  completed:number;
  status:'completed'|'revision'|'in-progress'|'not-started';
  total:number;
};
export type LearningPlan = PreparationPlan & {efforts:Record<number,LearningEffort>;preparedQuestionIds:number[]};
export type LearningCandidate = Candidate & {learning:LearningProfile};
export function describeLearning(question:{prompt:string;marks:number;topicIds:readonly string[];answerSource?:LearningSource|null;prerequisites?:readonly string[]},topics?:readonly SyllabusTopic[]):LearningProfile;
export function familiarityFrom(text:string):Familiarity;
export function makeLearningPlan(questions:readonly LearningCandidate[],topics:readonly SyllabusTopic[],minutes:number,pattern:string,familiarity:Familiarity,progress?:Progress):LearningPlan;
