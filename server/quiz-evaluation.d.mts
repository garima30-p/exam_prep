export type GradeStatus='correct'|'partial'|'incorrect'|'needs_review';
export type ReviewGrade={questionId:string;status:GradeStatus;feedback:string;missingPoints:string[];expectedAnswer:string|null;
  validationMethod:'verified_key'|'independent_calculation'|'ai_assisted'|'unverified'};
export function reviewUnavailable(questionId:string):ReviewGrade;
export function verifiedAnswer(question:string):{solution:{explanation:string}}|null;
export function gradeVerifiedCalculation(questionId:string,question:string,response:string):ReviewGrade;
export function gradeChoice(questionId:string,response:string,answerKey:string,options:string[],expected:string):ReviewGrade;
export function parseReviewGrade(text:string,questionId:string,expectedAnswer:string):ReviewGrade|null;
