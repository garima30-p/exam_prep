import type { RankedQuestion } from '../src/api';
import type { SyllabusTopic } from './optimizer.mjs';
export const MODEL_ID:string;
export const MODEL_REVISION:string;
export const EMBEDDING_LIMIT:number;
export function groupQuestions(questions:RankedQuestion[],topics:SyllabusTopic[],vectors:ReadonlyMap<string,ArrayLike<number>>|null,collectReview?:boolean):{
  questions:RankedQuestion[];topics:SyllabusTopic[];review:unknown[];mode:'semantic'|'exact'
};

