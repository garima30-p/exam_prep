import {supportedCalculation,renderCheckedCalculation,checkNumericalAnswer} from './answer-verification.mjs';

const statuses=new Set(['correct','partial','incorrect','needs_review']);
const result=(questionId,status,feedback,expectedAnswer,validationMethod,missingPoints=[])=>
 ({questionId,status,feedback,missingPoints,expectedAnswer,validationMethod});

export function reviewUnavailable(questionId){
 return result(questionId,'needs_review','There is no verified answer or rubric for this question.',null,'unverified');
}

const studyVerbs={provides:'provide',provide:'provide',stores:'store',store:'store',evicts:'evict',evict:'evict',
 allocates:'allocate',allocate:'allocate',prevents:'prevent',prevent:'prevent',manages:'manage',manage:'manage',
 converts:'convert',convert:'convert',translates:'translate',translate:'translate',determines:'determine',determine:'determine'};
const copula=/^(is|are|means|refers to|occurs when|happens when)$/i;
const nonspecific=/^(?:an?|the)?\s*(?:it|they|this|these|there|what|which|that|you|we|following|set of|group of|number of|key idea|main idea|important concept|topic|concept|thing|example)\b/i;

export function recallFact(statement){
 const match=statement.match(/^(.{2,65}?)\s+(is|are|means|refers to|occurs when|happens when|acts as|serves as|provides?|stores?|evicts?|allocates?|prevents?|manages?|converts?|translates?|determines?)\s+(.{12,})[.!]$/i);
 if(!match)return null;
 const [,subject,rawVerb,body]=match;
 const verb=rawVerb.toLowerCase();
 const term=subject.replace(/^(?:an?|the)\s+/i,'');
 if(nonspecific.test(subject)||/^system$/i.test(term)||!/^[\p{L}][\p{L}\p{N} /()+’-]*$/u.test(subject)||
   /\b(?:an? (?:important|key|useful|basic|essential|fundamental) (?:idea|topic|aspect|concept|component|part) (?:in|of|for)\b|an? (?:important|key|useful|basic|essential|fundamental) (?:idea|topic|aspect|concept)|something|as (?:above|follows|described)|covered in|see (?:the|above)|TBD|TODO)\b/i.test(body))return null;
 const named=/^(?:an?|the)\s|^[A-Z][a-z]{2,}$/i.test(subject)&&!/\b[A-Z]{2,}\b/.test(subject)?subject[0].toLowerCase()+subject.slice(1):subject;
 const role=verb==='acts as'||verb==='serves as'||(/\b(?:interface|intermediary|bridge)\b/i.test(body)&&(verb==='is'||verb==='provides'));
 const plural=verb==='are'||(Object.hasOwn(studyVerbs,verb)&&!verb.endsWith('s'));
 const relation=role?body.match(/\bbetween (.{8,95})$/i)?.[0]:undefined;
 const prompt=role?'What role does '+named+' play'+(relation?' '+relation:'')+'?':
  copula.test(verb)?'What '+(plural?'are':'is')+' '+named+'?':
   'What '+(plural?'do':'does')+' '+named+' '+studyVerbs[verb]+'?';
 // Split only relations with an explicit second claim. Keep paired participants
 // such as "between applications and hardware" together.
 const parts=body.split(/\s+(?=(?:because|through which|so that|and (?:allows?|provides?|prevents?|requires?|stores?|manages?))\b)/i);
 const rubric=parts.length>1&&parts.every(part=>part.length>=8)&&parts.length<=4?parts:[body];
 return {term,verb,body:body+statement.at(-1),prompt,referenceAnswer:statement,rubric,evidence:[statement]};
}

export function verifiedAnswer(question){
 const calculation=supportedCalculation(question);
 if(!calculation)return null;
 const solution=renderCheckedCalculation(calculation,question);
 if(!solution||(calculation.safe!==undefined&&/\b(?:need matrix|available vector)\b/i.test(question)))return null;
 // The scalar evaluator can establish only the supported, explicitly requested metrics.
 if(calculation.metrics&&/\b(?:gantt|draw|plot|each process|per.process|individual|response time|throughput|utili[sz]ation)\b/i.test(question))return null;
 const metrics=calculation.metrics?.filter(({label})=>solution.checkedMetrics.includes(label));
 return {calculation,solution,metrics};
}

function number(value){
 const normalized=value.trim().replace(/−/g,'-');
 const format='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
 const match=normalized.match(new RegExp('^('+format+')(?:\\s*\\/\\s*('+format+'))?(?:\\s*(%|ms|s|sec(?:onds?)?|milliseconds?|(?:time )?units?))?\\.?$','i'));
 if(!match)return null;
 const valueNumber=Number(match[1])/(match[2]===undefined?1:Number(match[2]));
 if(!Number.isFinite(valueNumber))return null;
 return {value:valueNumber,unit:(match[3]??'').toLowerCase()};
}

function equivalent(value,expected,question,label){
 const parsed=number(value);
 if(!parsed)return null;
 const milliseconds=/\b(?:ms|milliseconds?)\b/i.test(question);
 const seconds=!milliseconds&&/\b(?:seconds?|sec)\b/i.test(question);
 let actual=parsed.value;
 if(parsed.unit==='%'){
  if(!/\b(?:percentage|percent|proportion)\b|%/i.test(question))return null;
  if(!/\b(?:percentage|percent)\b|%/i.test(question))actual/=100;
 }else if(/^(?:ms|milliseconds?|s|sec|seconds?)$/.test(parsed.unit)){
  if(!/time/i.test(label)||!milliseconds&&!seconds)return null;
  const inputInMs=/^(?:ms|milliseconds?)$/.test(parsed.unit);
  if(inputInMs&&!milliseconds)actual/=1000;
  if(!inputInMs&&milliseconds)actual*=1000;
 }
 const tolerance=question.match(/(?:±|\+\/-|absolute tolerance(?: of|:)?|tolerance(?: of|:)?)\s*(\d+(?:\.\d+)?|\.\d+)(?![\d.%])/i);
 const precision=question.match(/\b(?:round(?:ed)? to|to)\s+([0-9])\s+decimal places?\b/i);
 const near=question.match(/\bwithin\s+(\d+(?:\.\d+)?|\.\d+)\s+(?:of\s+(?:the\s+)?(?:exact|true)|units?\b)/i);
 const margin=tolerance||near?Number((tolerance??near)[1]):precision?.[1]?0.5*10**-Number(precision[1]):1e-7;
 return Math.abs(actual-expected)<=margin+1e-9;
}

export function gradeVerifiedCalculation(questionId,question,response){
 const verified=verifiedAnswer(question);
 if(!verified)return reviewUnavailable(questionId);
 const {calculation,solution,metrics}=verified;
 const expected=calculation.detail&&metrics?.length?solution.explanation.replace(/^Average (?:waiting|turnaround) time: .+$/gm,line=>{
  const label=line.split(':')[0];
  const metric=metrics.find(item=>item.label===label);
  if(!metric||Number.isInteger(metric.value))return line;
  const total=calculation.detail.reduce((sum,row)=>sum+row[label.includes('waiting')?'waiting':'turnaround'],0);
  return label+': '+total+'/'+calculation.detail.length;
 }):solution.explanation;
 if(!metrics?.length){
  const input=/^\s*(?:safe|unsafe)\s*$/i.test(response)?'Safety: '+response.trim():response;
  const checked=checkNumericalAnswer(question,input,calculation);
  if(checked.validationStatus==='not_independently_checked')
   return result(questionId,'needs_review','Give the safety state and label any requested safe sequence.',expected,'independent_calculation');
  const correct=checked.validationStatus==='deterministically_checked';
  return result(questionId,correct?'correct':'incorrect',correct?'The safety result checks out.':'The '+checked.failedMetric.toLowerCase()+' does not match the resource constraints.',expected,'independent_calculation');
 }
 const fields=response.trim().split(/\s*[;\n,]\s*/).filter(Boolean);
 if(fields.length>metrics.length)return result(questionId,'needs_review','Enter one value for each requested result.',expected,'independent_calculation');
 const checks=metrics.map(({label,value},index)=>{
  const short=label.replace(/^Average /i,'').toLowerCase();
  const field=fields.find(entry=>entry.toLowerCase().startsWith(label.toLowerCase())||entry.toLowerCase().startsWith(short));
  const answer=field?field.replace(/^[^:=]+[:=]\s*/,''):fields.length===metrics.length?fields[index]:'';
  return {label,matches:equivalent(answer,value,question,label)};
 });
 if(checks.every(check=>check.matches===null))
  return result(questionId,'needs_review','Enter numerical values in the requested order, or label each result.',expected,'independent_calculation');
 const correct=checks.filter(check=>check.matches);
 const missing=checks.filter(check=>!check.matches).map(check=>check.label);
 return result(questionId,missing.length===0?'correct':correct.length?'partial':'incorrect',
  missing.length===0?'Your result matches the independently calculated solution.':
   correct.length?correct.map(check=>check.label).join(' and ')+' checks out. Recheck the remaining result.':'Your result differs from the independently calculated solution.',
  expected,'independent_calculation',missing);
}

export function gradeChoice(questionId,response,answerKey,options,expected){
 if(!options.includes(response)||!options.includes(answerKey))return reviewUnavailable(questionId);
 const correct=response===answerKey;
 return result(questionId,correct?'correct':'incorrect',correct?'Your choice matches the source.':'Your choice differs from the verified statement.',expected,'verified_key');
}

export function parseReviewGrade(text,questionId,expectedAnswer){
 let data;
 try{data=JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));}catch{return null;}
 if(!data||!statuses.has(data.status)||typeof data.feedback!=='string'||
   !data.feedback.trim()||data.feedback.length>480||
   !Array.isArray(data.missingPoints)||data.missingPoints.length>5||
   data.missingPoints.some(point=>typeof point!=='string'||!point.trim()||point.length>180)||
   (data.status==='correct'&&data.missingPoints.length)||(data.status==='partial'&&!data.missingPoints.length))return null;
 return result(questionId,data.status,data.feedback.trim(),expectedAnswer,'ai_assisted',data.missingPoints.map(point=>point.trim()));
}
