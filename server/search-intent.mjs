import {academicScope} from './academic-sources.mjs';
import {studySubject,summarySearchTopic} from './coach-topics.mjs';

const find=/\b(?:search(?:ing)?(?: for)?|look up|look for|find|browse|retrieve|pull up|locate)\b/i;
const papers=/\b(?:pyqs?|(?:previous|past|prior|old)[ -]?(?:years?[ -]?)?(?:examination |exam |question )?papers?|(?:official |university )(?:exam(?:ination)? |question )?papers?)\b/i;
const curriculum=/\b(?:syllabus|curriculum|course outline|course catalog)\b/i;
const references=/\b(?:(?:academic|official|external|credible|additional|scholarly|web|online|university) (?:study )?(?:sources?|references?|material(?:s)?)|references?|sources? online)\b/i;

export function webSourceQuestion(text){
 if(typeof text!=='string')return '';
 const web=/\b(?:web|internet|online|external)\b/i.test(text);
 if(!web)return '';
 if(/\b(?:sources|references|websites|links)\b.{0,35}\b(?:supported|used|cited)\b/i.test(text)&&/\b(?:this|that|previous|last) (?:answer|reply|response)\b/i.test(text))return 'previous';
 if(/^(?:\s*)(?:did (?:you|this answer)|(?:which|what)(?:\s+\w+){0,5}\s+(?:sources|references|websites|links)\b|where did you)\b/i.test(text))return 'previous';
 if(/^\s*(?:(?:do|can|could|are) you|does in-nocent|is web)/i.test(text)&&
  /\b(?:use|support|access|retrieve|search|browse|available|enabled|academic)\b/i.test(text)&&
  !/\b(?:look up|find|consult|to (?:explain|compare|solve|answer|find)|about|for (?!academic research\b))\b/i.test(text))return 'capability';
 return '';
}

export function academicSearchIntent(text){
 if(typeof text!=='string'||!text||webSourceQuestion(text)||/^\s*(?:can|could|do) you (?:search|browse) (?:on )?(?:the )?(?:web|internet)(?:\s*[?.!]\s*)?$/i.test(text))return '';
 if(!find.test(text)&&!(/\b(?:use|consult|check|research)\b/i.test(text)&&/\b(?:web|online|external|internet)\b/i.test(text))&&!(references.test(text)&&/\b(?:give|show|list|provide|send)\b/i.test(text)))return '';
 if(papers.test(text))return 'papers';
 if(curriculum.test(text))return 'syllabus';
 if(/\b(?:university|college|institute)(?:[?.!]|\s|$)/i.test(text)&&!references.test(text)&&!/\b(?:online|web|internet)\b/i.test(text))return 'institution';
 return references.test(text)||/\b(?:web|online|internet|look up|browse)\b/i.test(text)?'references':'';
}

export function academicSearchRequest(question,context){
 const kind=academicSearchIntent(question);
 if(!kind)return null;
 const named=academicScope(question);
 const saved=academicScope(context.university);
 const scope=named.domain||named.named?named:saved;
 const explicitSubject=studySubject(question);
 const contextSubject=typeof context.subject==='string'?context.subject:'';
 const contextTopic=typeof context.topic==='string'?context.topic:'';
 const explicitFocus=summarySearchTopic(explicitSubject,[question]);
 const subject=explicitSubject||studySubject(explicitFocus)||studySubject(contextSubject)||studySubject(contextTopic);
 const namedSearch=kind!=='references';
 if(namedSearch&&(!subject||!scope.domain)){
  const clarification=!subject&&!scope.domain?'Which university and subject should I search for?':
   !scope.domain?(named.named&&!/\b(?:any|a|some|the) university\b/i.test(question)&&!/\buniversity[?.!]?\s*$/i.test(question)?'What is the university’s official website?':'Which university should I search for?'):'Which subject should I search for?';
  return {clarification};
 }
 const focus=summarySearchTopic(subject,explicitFocus?[question]:[contextTopic]).replace(/ study guide$/,'');
 if(kind==='references'&&!focus)return {clarification:'Which study topic should I look up?'};
 const courseCode=/\b(?:course|subject)\s+code\b/i.test(question)?named.code:undefined;
 const suffix=kind==='papers'?'official previous year examination question papers':kind==='references'?'university course notes academic references':'official syllabus course outline';
 // Only canonical subjects, recognized concepts and verified institutional search metadata go to Tavily.
 const query=[namedSearch?scope.name:null,kind==='references'?focus:subject,
  namedSearch?courseCode:null,kind==='papers'?named.year:null,kind==='papers'?named.exam:null,suffix].filter(Boolean).join(' ');
 return {kind:kind==='institution'?'syllabus':kind,scope:namedSearch?{...scope,code:courseCode,year:named.year,exam:named.exam}:null,
  subject,topic:kind==='references'?focus.replace(new RegExp('^'+subject+'\\s*','i'),''):'',query};
}
