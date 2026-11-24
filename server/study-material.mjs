import {publicStudyConcepts,studySubject} from './coach-topics.mjs';
export function administrativeLine(value) {
  return /^\s*(?:[|\d.\s]*CO\s*[0-9Il]+\b|category\s+of\s+course\b|(?:course|program(?:me)?)\s+outcomes?\b|course\s+(?:coordinator|objectives?|description)\b|(?:learning|program(?:me)? specific)\s+outcomes?\b|(?:maximum|total)\s+marks\b|(?:exam duration|time allowed|semester|academic year|name of (?:student|candidate))\s*:|department\s+of\b|academic\s+regulations?\b|course\s+(?:code|credits?)\b|L\s*\|\s*T\s*\|\s*P\b)/i.test(value);
}

export const administrativeSection=line=>/^\s*(?:(?:course|program(?:me)?|learning) outcomes?|course objectives?)\s*:?\s*$/i.test(line);
const unitHeading=/^\s*(?:unit|module|week)\s*[-–]?\s*([1-9][0-9]?|i{1,3}|iv|v|vi{1,3}|ix|x|[il]{2,3})\b\s*[-–:.]?\s*(.*)/i;
export const syllabusUnit=line=>{
 const unit=unitHeading.exec(line);
 if(unit&&/^[il]{2,3}$/i.test(unit[1]))unit[1]=unit[1].replace(/l/gi,'i');
 return unit;
};
export const syllabusContentsHeading=line=>/^\s*(?:\d{1,2}\s*[.)]\s*)?(?:details of the course|course (?:content|contents|outline|layout|syllabus)|syllabus)\s*:?\s*$/i.test(line);
export const syllabusEnd=line=>/^\s*(?:\d{1,2}\s*[.)]\s*)?(?:text(?:books?| and reference books)|reference books|mode of evaluation|assessment scheme|total hours)\b/i.test(line);

const numberedHeading=/^(?:\d{1,2}(?:\.\d{1,2})+\.?|\d{1,2}[.)])\s+/;
const bulletHeading=/^[-•▪‣]\s*/;
const withoutMarker=line=>line.replace(bulletHeading,'').replace(numberedHeading,'').trim();
export const syllabusAdministrative=line=>administrativeLine(withoutMarker(line))||
 administrativeSection(withoutMarker(line))||
 /^(?:suggested (?:text(?:books?)?|books?|readings?|references?)|(?:recommended|required) (?:text(?:books?)?|readings?|books?)|bibliograph(?:y|ies)|references?(?: books?)?|reading list|assessment(?: guidelines?| scheme| criteria| methods?)?|grading(?: policy| scheme)?|evaluation(?: methods?| scheme| criteria)?|course (?:outcomes?|objectives?|requirements?|information)|learning outcomes?|contact hours|examination scheme|instructional hours|teaching methods)(?:\s*[:.–-]|\s*$)/i.test(withoutMarker(line))||
 syllabusEnd(line);

export function syllabusSubject(pages){
 for(const page of pages.slice(0,2))for(const raw of page.text.split(/\r?\n/).slice(0,16)){
  const line=raw.trim();
  const title=line.match(/^(?:course|subject|paper)\s+(?:title|name)\s*:\s*(.+)$/i)?.[1]
   ??line.match(/^(.{3,85}?)\s+(?:syllabus|course outline)$/i)?.[1];
  if(title&&/[\p{L}]/u.test(title)&&!syllabusAdministrative(title))return title.trim();
 }
 return '';
}

export const topicKey=text=>text.normalize('NFKC').toLowerCase().replace(/[’']/gu,'')
 .replace(/[^\p{L}\p{N}+/]+/gu,' ').trim().replace(/([a-z]{3,})ies$/,'$1y').replace(/([a-z]{3,})(?<!ss|us|is|ics)s$/,'$1');
const numericNoise=/^[\d\s.|/–—-]+$/;
const structuralMarker=/^(?:[-•▪‣]\s+|\d{1,2}(?:\.\d{1,2})+\.?\s+|\d{1,2}[.)]\s+)/;
const acronym=/^[A-Z][A-Z0-9]*(?:[+/.-][A-Z0-9]+|\+)*$/;
const endsIncomplete=/\b(?:the|and|or|of|with|using|for|to|a|an|in|by|on)$/i;
const sentence=/^(?:explain|describe|discuss|compare|define|state|list|calculate|consider|draw|find|apply|write|identify|illustrate|what|why|how|derive|evaluate)\b|\b(?:students? (?:will|should)|able to|the following|occurs?|requires?|provides?|allows?|should|shall|must|means|are used)\b/i;
const orphanedTail=/^(?:types|forms|methods|examples|applications|advantages|limitations)\s+of\b/i;
const examSection=/\b(?:end[- ]?semester|mid[- ]?(?:semester|term)|(?:question paper|semester examination)|(?:all|any) questions? (?:are|must))\b/i;
const supportedConcept=(title,subject)=>{
 const key=topicKey(title);
 return publicStudyConcepts(title+' '+key+' '+key+'s').some(concept=>topicKey(concept)===key)&&
  (!subject||!studySubject(title)||!studySubject(subject)||studySubject(title)===studySubject(subject));
};

function hasBalancedDelimiters(title){
 const delimiters=[];
 for(const character of title){
  if(character==='('||character==='['||character==='{')delimiters.push(character);
  else if(character===')'||character===']'||character==='}'){
   if(delimiters.pop()!==({')':'(',']':'[','}':'{'}[character]))return false;
  }
 }
 return delimiters.length===0;
}

function differsByOneCharacter(left,right){
 if(left===right||Math.abs(left.length-right.length)>1)return false;
 const index=[...left].findIndex((character,offset)=>character!==right[offset]);
 if(index<0)return left.length!==right.length;
 if(left.length===right.length)return left.slice(index+1)===right.slice(index+1);
 return left.length>right.length?left.slice(index+1)===right.slice(index):left.slice(index)===right.slice(index+1);
}

function headingEditDistance(word,target){
 let previous=Array.from({length:target.length+1},(_,i)=>i);
 for(const [i,character] of [...word].entries()){
  const current=[i+1];
  for(let j=1;j<=target.length;j++)current.push(Math.min(current[j-1]+1,previous[j]+1,previous[j-1]+Number(character!==target[j-1])));
  previous=current;
 }
 return previous[target.length];
}

const operatingSystemsHeadings=['Operating System Services','Multiple-Processor Scheduling','Thread Scheduling'];

function reconstructOcrHeading(title,subject){
 const parts=title.match(/^([a-z]{10,14})\s+(to|[t({][o0]|[o0])\s+(.+)$/i);
 if(parts&&topicKey(parts[3])===topicKey(subject)&&headingEditDistance(parts[1].toLowerCase(),'introduction')<=2){
  return 'Introduction to '+parts[3].trim();
 }
 if(topicKey(subject)!=='operating system')return title;
 const candidate=title.replace(/\.\s+[a-z]{1,3}$/,'').toLowerCase();
 const alternate=operatingSystemsHeadings.find(heading=>{
  const normalized=heading.toLowerCase();
  return candidate.slice(0,3)===normalized.slice(0,3)&&Math.abs(candidate.length-normalized.length)<=2&&
   headingEditDistance(candidate,normalized)<=2;
 });
 return alternate??title;
}

export function validatedTopicTitle(value,{anchored=false,ocr=false,subject='',context=false}={}){
 if(typeof value!=='string')return '';
 const raw=withoutMarker(value);
 let title=raw.replace(/(?:\s+|\s*\|+\s*)\(?\d+\s*(?:hrs?|hours?)\)?$/i,'')
  .trim().replace(/[.;,]+$/,'');
 if(ocr&&anchored&&subject)title=reconstructOcrHeading(title,subject);
 if(ocr&&/\b\p{Ll}{4,}\.\s+\p{Ll}{1,3}$/u.test(title))return '';
 if(!title||!hasBalancedDelimiters(title)||numericNoise.test(title)||syllabusAdministrative(title)||syllabusContentsHeading(title)||
  /^(?:course (?:overview|summari[sz]ation|summary)|epilogue)$/i.test(title)||
  /^(?:no\.|sl\.|sr\.|serial\b|page\s+\d|contact hours?\b)/i.test(title)||endsIncomplete.test(title)||
  !/^[\p{L}\p{N}]/u.test(title)||!/[\p{L}]/u.test(title)||/^(?:a|an|the)\s+[\p{L}]+(?:al|ive|ary|ing|ed|ous|ent)$/iu.test(title)||title.length>96||title.split(/\s+/).length>13||
  /[!?|…]|\.{2,}|\s+\d{2,}\s+\d|\bCO\d+\b/u.test(title)||sentence.test(title)||orphanedTail.test(title)||/\bfor (?:handling|managing|using|implementing)$/i.test(title))return '';
 const known=supportedConcept(title,subject);
 if(known)return title;
 const words=title.split(/\s+/);
 if(words.length===1)return (anchored&&acronym.test(title)&&title.length>1)||
  (anchored&&/^\p{Lu}\p{Ll}+[\p{L}\d-]*$/u.test(title)&&(!ocr||context))?title:'';
 if(!anchored&&(!context||ocr||!/^\p{Lu}/u.test(title)||/[.!?]$/.test(raw)))return '';
 // A mixed all-caps stub and a short title-case token is weak evidence on a scanned page.
 if(ocr&&words.length===2&&acronym.test(words[0])&&words[0].length<=2&&/^\p{Lu}\p{Ll}{1,3}$/u.test(words[1]))return '';
 if(!anchored&&/\b(?:is|are|was|were|has|have|does|did)\b/i.test(title))return '';
 return title;
}

function canJoin(left,right,marked,subject){
 if(!left||!right||structuralMarker.test(right)||syllabusAdministrative(right)||syllabusUnit(right)||syllabusContentsHeading(right))return false;
 const tail=left.split(/[,;:]/).at(-1)?.trim()??'';
 const head=right.split(/[,;:]/,1)[0].trim();
 if(!head||sentence.test(head)||/[.!?]$/.test(left))return false;
 if(supportedConcept((tail+' '+head).trim(),subject))return true;
 if(subject&&/^(?:introduction|overview)\s+(?:to|of)$/i.test(tail)&&topicKey(head)===topicKey(subject))return true;
 if(tail!==left&&/^\p{Lu}[\p{L}\d-]*$/u.test(tail)&&/^\p{Lu}\p{Ll}+[,:;]/u.test(right))return true;
 return marked&&/^\p{Lu}[\p{L}\d-]*$/u.test(left)&&/^\p{Lu}\p{Ll}+[,:;]$/u.test(right)&&!acronym.test(left);
}

export function parseSyllabus(pages,identifiedSubject=''){
 const topics=[],seen=new Map();
 const subject=syllabusSubject(pages)||identifiedSubject;
 const subjectKey=topicKey(subject);
 // Even an attachment manually labelled as a syllabus must have curriculum structure.
 const documentHead=pages.slice(0,2).map(page=>page.text.slice(0,900)).join('\n');
 const hasUnits=pages.some(page=>page.text.split(/\r?\n/).some(line=>syllabusUnit(line)));
 const hasContents=pages.some(page=>page.text.split(/\r?\n/).some(syllabusContentsHeading));
 const hasCurriculumAnchor=hasUnits||hasContents;
 if(!hasCurriculumAnchor||examSection.test(documentHead)&&!hasContents)return topics;
 let inside=false,blocked=false,unit=0,unitName='',major='',lastPage=0;
 const add=(title,group,row,level,excerpt=row.text)=>{
  const key=topicKey(title);
  const overview=key.match(/^(?:introduction|overview)(?: (?:to|of) (.+))?$/);
  const equivalent=overview&&(!overview[1]||overview[1]===subjectKey)?'introduction':key;
  if(!key||key===subjectKey)return title;
  if(row.method==='ocr'&&group&&differsByOneCharacter(key,topicKey(group))&&supportedConcept(group,subject))return group;
  if(seen.has(equivalent))return seen.get(equivalent);
  seen.set(equivalent,title);
  topics.push({title,group:group===title?'':group,subject,unit,level,page:row.page,line:row.line,excerpt,method:row.method,
   validation:row.method==='ocr'?'structured-ocr':'document-structure'});
  return title;
 };
 for(const page of pages){
  if(lastPage&&page.number>lastPage+1){inside=false;blocked=false;unit=0;unitName='';major='';}
  lastPage=page.number;
  const ocr=page.method==='ocr';
  const rows=page.text.split(/\r?\n/).map((raw,index)=>{
   const original=raw.trim();
   const text=ocr?original.replace(/^\d{1,2}\s*\|\s*/,'').replace(/\s*\|(?:\s*\d{1,2})?\s*$/,'')
    .replace(/^[‘’'“”]+\s*(?=\p{Lu})/u,''):original;
   return {text,original,indent:raw.search(/\S/),page:page.number,line:index+1,method:page.method};
  });
  const title=(value,anchored,context=false)=>validatedTopicTitle(value,{anchored,context,ocr,subject});
  const children=(parts,parent,row,excerpt,next)=>{
   const values=parts.flatMap(part=>part.split(ocr?/[,;]|(?<=\p{Ll})\.\s+(?=\p{Lu})/u:/[,;]/));
   const anchorWords=parent.match(/\b[A-Z][a-z]{4,}\b/g)??[];
   for(const [index,value] of values.entries()){
    let trimmed=value.trim();
    if(ocr&&anchorWords.length){
     trimmed=trimmed.replace(/^([A-Z][a-z]{4,})(?=\s)/,token=>
      anchorWords.find(anchor=>anchor.length===token.length&&anchor.slice(0,4)===token.slice(0,4)&&differsByOneCharacter(token,anchor))??token);
     trimmed=trimmed.replace(/\b[a-z]{4,}$/g,token=>anchorWords.map(anchor=>anchor.toLowerCase())
      .find(anchor=>anchor.length===token.length+1&&anchor.startsWith(token))??token);
    }
    const nextLine=next?.text.replace(/^\d{1,2}\s*\|\s*/,'')??'';
    const endsOcrLine=ocr&&index===values.length-1&&Boolean(next)&&!structuralMarker.test(nextLine)&&!syllabusAdministrative(nextLine);
    // Preserve a recognized term or acronym, but never promote a one-word continuation to its own topic.
    if(endsOcrLine&&/^[\p{L}-]+$/u.test(trimmed)&&!acronym.test(trimmed)&&!supportedConcept(trimmed,subject))continue;
    const child=title(trimmed,true,true);
    if(child)add(child,parent,row,'subtopic',excerpt);
   }
  };
  for(let i=0;i<rows.length;i++){
   const row=rows[i],line=row.text;
   if(!line||numericNoise.test(line))continue;
   if(syllabusContentsHeading(line)){inside=!hasUnits;blocked=false;major='';continue;}
   const section=syllabusUnit(line);
   if(section){
    inside=true;blocked=false;major='';
    unit=Number(section[1])||['i','ii','iii','iv','v','vi','vii','viii','ix','x'].indexOf(section[1].toLowerCase())+1;
    let body=section[2],excerpt=row.original;
    if(rows[i+1]&&canJoin(body,rows[i+1].text,true,subject)){
     const next=rows[++i];
     body+=' '+next.text;excerpt+=' '+next.original;
    }
    const [head,...details]=body.split(/:\s*/);
    const [main,...listed]=head.split(/[,;]/);
    const rest=[...listed,...details];
    const name=title(main,true,rest.length>0)||rest.map(value=>title(value,true,true)).find(Boolean);
    unitName=name||'Unit '+section[1].toUpperCase();
    unitName=add(unitName,'',row,name?'major':'unit',excerpt);
    children(rest,unitName,row,excerpt,rows[i+1]);
    continue;
   }
   if(syllabusAdministrative(line)){
    if(administrativeSection(withoutMarker(line))||!administrativeLine(line)){inside=false;blocked=true;major='';unitName='';}
    continue;
   }
   if(blocked||!inside)continue;
   const marked=structuralMarker.test(line),next=rows[i+1];
   let body=withoutMarker(line),excerpt=row.original;
   if(next&&canJoin(body,next.text,marked,subject)){
    body+=' '+next.text;excerpt+=' '+next.original;i++;
   }
   const [head,...details]=body.split(/:\s*/);
   const [main,...listed]=head.split(/[,;]/);
   const hasList=details.some(value=>value.trim())||listed.some(value=>value.trim());
   const subordinate=bulletHeading.test(line)||row.indent>0||/^\d{1,2}\.\d/.test(line);
   if(subjectKey&&['notes','syllabus','course outline'].some(kind=>topicKey(main)===subjectKey+' '+kind))continue;
   const nested=Boolean(next&&(next.indent>row.indent||bulletHeading.test(next.text)));
   const name=title(main,marked||details.some(value=>value.trim())||nested,!ocr&&!hasList&&Boolean(unitName));
   const subparts=[...listed,...details];
   const specificName=name&&/^case study$/i.test(name)&&details.length>1?title(subparts[0],true,true):'';
   if(specificName)subparts.shift();
   const heading=name?add(specificName||name,subordinate?major||unitName:unitName,row,subordinate?'subtopic':'major',excerpt):'';
   if(heading&&!subordinate)major=heading;
   if(heading||hasList&&marked)children(subparts,heading||major||unitName,row,excerpt,rows[i+1]);
  }
 }
 const introduction=topics.findIndex(topic=>topic.validation==='structured-ocr'&&!topic.group&&
  topicKey(topic.title)==='introduction to '+subjectKey);
 if(introduction>0){
  const [heading]=topics.splice(introduction,1);
  topics.unshift(heading);
 }
 return topics;
}
