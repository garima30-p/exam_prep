export type Candidate = {
  id:number;
  minutes:number;
  priorityScore:number;
  topicIds:readonly string[];
  unit?:number;
  units?:readonly number[];
  sections?:readonly string[];
  marks?:number;
  marksByGroup?:Record<string,number>;
};
export type SyllabusTopic = {id:string;title:string;unit?:number;weight:number};
export type PreparationPlan = {
  selectedQuestionIds:number[];
  method:'knapsack'|'coverage';
  totalAvailableMinutes:number;
  preparationBudgetMinutes:number;
  estimatedPreparationMinutes:number;
  revisionMinutes:number;
  totalPriorityValue:number;
  weightedCoverageScore:number;
  coveredTopicIds:string[];
  uncoveredTopicIds:string[];
  warnings:string[];
};
export function makePlan(questions:readonly Candidate[],topics:readonly SyllabusTopic[],minutes:number,pattern?:string):PreparationPlan;
