import type { Analysis, Context, Question, RankedQuestion } from './api';
import { fitQuestions } from './api';
import { makeLearningPlan } from '../server/learning.mjs';
import type { Progress } from '../server/learning.mjs';
import { makePlan } from '../server/optimizer.mjs';

export type PreparationScope={questions:readonly Question[]; review:boolean; allocations:Record<number,number>};

export function prepareScope(analysis:Analysis,context:Context,progress:Progress={}):PreparationScope {
  const {optimization}=analysis;
  if(!optimization)return {questions:fitQuestions(analysis.questions,context.minutes).slice(0,10),review:false,allocations:{}};
  const syllabusQuestionIds=new Set(optimization.topics.filter(topic=>topic.id.startsWith('syllabus:')).map(topic=>topic.id));
  const linked=(question:RankedQuestion)=>question.topicIds.some(id=>syllabusQuestionIds.has(id));
  const baseline=makeLearningPlan(optimization.candidates,optimization.topics,context.minutes,context.pattern,context.familiarity,progress);
  const relevant=optimization.candidates.filter(question=>linked(question)&&baseline.efforts[question.id]?.minutes);
  const prioritizeSyllabus=context.minutes<=15&&!context.pattern.trim()&&relevant.length>0;
  const plan=prioritizeSyllabus
    ?makeLearningPlan(relevant,optimization.topics,context.minutes,context.pattern,context.familiarity,progress)
    :baseline;
  const byId=new Map(optimization.candidates.map(question=>[question.id,question]));
  const selected=plan.selectedQuestionIds.map(id=>byId.get(id)!).slice(0,context.minutes<=15?2:6);
  if(selected.length||!context.minutes)return {questions:selected,review:false,allocations:{}};

  // A review covers the method or concept, without promising time for a full answer.
  const pending=optimization.candidates.filter(question=>baseline.efforts[question.id]?.minutes);
  const supported=pending.filter(question=>linked(question)||question.answerSource);
  const pool=prioritizeSyllabus?relevant:supported.length?supported:pending.filter(question=>question.historical||question.historicalFrequency>0);
  const candidates=pool.map(question=>({...question,minutes:Math.min(4,Math.max(2,baseline.efforts[question.id].remaining.understanding)),
    priorityScore:question.priorityScore+(linked(question)?150:0)+(question.answerSource?70:0)}));
  const review=makePlan(candidates,optimization.topics,context.minutes,context.pattern);
  const byCost=new Map(candidates.map(question=>[question.id,question.minutes]));
  const reviewIds=review.selectedQuestionIds.slice(0,context.minutes<=15?2:4);
  return {questions:reviewIds.map(id=>byId.get(id)!),review:true,
    allocations:Object.fromEntries(reviewIds.map(id=>[id,byCost.get(id)!]))};
}
