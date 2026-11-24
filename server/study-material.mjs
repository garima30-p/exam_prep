export function administrativeLine(value) {
  return /^\s*(?:[|\d.\s]*CO\s*[0-9Il]+\b|category\s+of\s+course\b|(?:course|program(?:me)?)\s+outcomes?\b|course\s+(?:coordinator|objectives?|description)\b|(?:learning|program(?:me)? specific)\s+outcomes?\b|(?:maximum|total)\s+marks\b|(?:exam duration|time allowed|semester|academic year|name of (?:student|candidate))\s*:|department\s+of\b|academic\s+regulations?\b|course\s+(?:code|credits?)\b|L\s*\|\s*T\s*\|\s*P\b)/i.test(value);
}

export const administrativeSection=line=>/^\s*(?:(?:course|program(?:me)?|learning) outcomes?|course objectives?)\s*:?\s*$/i.test(line);
export const syllabusUnit=line=>/^\s*(?:unit|module)\s*[-–]?\s*([1-9][0-9]?|i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*[-–:.]?\s*(.*)/i.exec(line);
export const syllabusContentsHeading=line=>/^\s*(?:\d{1,2}\s*[.)]\s*)?(?:details of the course|course (?:content|contents|outline)|syllabus)\s*:?\s*$/i.test(line);
export const syllabusEnd=line=>/^\s*(?:\d{1,2}\s*[.)]\s*)?(?:text(?:books?| and reference books)|reference books|mode of evaluation|assessment scheme|total hours)\b/i.test(line);

const numberedHeading=/^(?:\d{1,2}(?:\.\d{1,2})+\.?|\d{1,2}[.)])\s+/;
const bulletHeading=/^[-•▪‣]\s*/;
const withoutMarker=line=>line.replace(bulletHeading,'').replace(numberedHeading,'').trim();
export const syllabusAdministrative=line=>administrativeLine(withoutMarker(line))||
 administrativeSection(withoutMarker(line))||
 /^(?:suggested (?:books?|readings?|references?)|(?:recommended|required) (?:text(?:books?)?|readings?|books?)|bibliograph(?:y|ies)|references?(?: books?)?|reading list|assessment(?: guidelines?| scheme| criteria| methods?)?|grading(?: policy| scheme)?|evaluation(?: methods?| scheme| criteria)?|course (?:outcomes?|objectives?|requirements?|information)|learning outcomes?|contact hours|examination scheme|instructional hours|teaching methods)(?:\s*[:.–-]|\s*$)/i.test(withoutMarker(line))||
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

const numericNoise=/^[\d\s.|/–—-]+$/;
const structuralMarker=/^(?:[-•▪‣]\s+|\d{1,2}(?:\.\d{1,2})+\.?\s+|\d{1,2}[.)]\s+)/;
function headingTitle(value,anchored){
 const title=withoutMarker(value).replace(/(?:\s+|\s*\|+\s*)\(?\d+\s*(?:hrs?|hours?)\)?$/i,'')
  .trim().replace(/[.;,]+$/,'');
 if(!title||numericNoise.test(title)||syllabusAdministrative(title)||syllabusContentsHeading(title)||
  /^(?:no\.|sl\.|sr\.|serial\b|contact hours?\b|the critical$)/i.test(title)||/\b(?:the|and|or|of|with|using)$/i.test(title)||
  !/[\p{L}]/u.test(title)||title.length>96||title.split(/\s+/).length>13||
  /\?$|[|]|\b(?:students? (?:will|should)|able to|the following)\b/i.test(title))return '';
 if(!anchored&&(/[.!?]\s*$/.test(value)||!/^[\p{Lu}\d]/u.test(title)||!/\s/.test(title)||
  /\b(?:is|are|was|were|means|occurs|includes?|provides?|should|shall|must)\b/i.test(title)))return '';
 return title;
}

export function parseSyllabus(pages){
 const topics=[],seen=new Set();
 const subject=syllabusSubject(pages).toLowerCase();
 let inside=false,blocked=false,unit=0,unitName='',major='',lastPage=0;
 const add=(title,group,row,level,excerpt=row.text)=>{
  const key=title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(!key||seen.has(key)||topics.length>=80)return;
  seen.add(key);
  topics.push({title,group:group===title?'':group,unit,level,page:row.page,line:row.line,excerpt,method:row.method});
 };
 for(const page of pages){
  // A skipped page cannot establish context for the text that follows it.
  if(lastPage&&page.number>lastPage+1){inside=false;blocked=false;unit=0;unitName='';major='';}
  lastPage=page.number;
  const rows=page.text.split(/\r?\n/).map((raw,index)=>({text:raw.trim(),indent:raw.search(/\S/),page:page.number,line:index+1,method:page.method}));
  for(let i=0;i<rows.length;i++){
   const row=rows[i];
   const line=row.text;
   if(!line||numericNoise.test(line))continue;
   if(syllabusContentsHeading(line)){inside=true;blocked=false;major='';continue;}
   const section=syllabusUnit(line);
   if(section){
    inside=true;blocked=false;major='';
    unit=Number(section[1])||['i','ii','iii','iv','v','vi','vii','viii','ix','x'].indexOf(section[1].toLowerCase())+1;
    const [name,...details]=section[2].split(/:\s*/);
    const [main,...listed]=name.split(/[,;]/);
    const title=headingTitle(main,true);
    unitName=title||'Unit '+section[1].toUpperCase();
    add(unitName,'',row,title?'major':'unit');
    for(const extra of [...listed,...details.flatMap(part=>part.split(/[,;]/))]){
     const child=headingTitle(extra,true);
     if(child)add(child,unitName,row,'subtopic');
    }
    continue;
   }
   if(syllabusAdministrative(line)){
    if(administrativeSection(withoutMarker(line))||!administrativeLine(line)){inside=false;blocked=true;major='';unitName='';}
    continue;
   }
   if(blocked||!inside&&!structuralMarker.test(line))continue;
   const next=rows[i+1];
   const marked=structuralMarker.test(line);
   let text=withoutMarker(line),excerpt=line;
   // Join a wrapped heading only when the list marker or the continuation punctuation supports the join.
   if(next&&/^\p{Lu}[\p{L}\d-]*$/u.test(text)&&/^\p{Lu}[\p{L}\d-]*\s*[:;,]?$/u.test(next.text)&&
    (marked||/[:;,]$/.test(next.text))&&!syllabusAdministrative(next.text)&&!syllabusUnit(next.text)){
    text+=' '+next.text;excerpt+=' '+next.text;i++;
   }
   const [label,...details]=text.split(/:\s*/);
   const subordinate=bulletHeading.test(line)||row.indent>0||/^\d{1,2}\.\d/.test(line);
   const explicitlyStructured=marked||details.some(part=>part.trim())||Boolean(next&&(next.indent>row.indent||bulletHeading.test(next.text)));
   if(/^\p{Ll}+$/u.test(label.trim())&&!details.some(part=>part.trim()))continue;
   if(subject&&['notes','syllabus','course outline'].some(kind=>label.toLowerCase()===subject+' '+kind))continue;
   const title=headingTitle(label,explicitlyStructured);
   if(!title)continue;
   const group=subordinate?major||unitName:unitName;
   add(title,group,row,subordinate?'subtopic':'major',excerpt);
   if(!subordinate)major=title;
   for(const value of details.flatMap(part=>part.split(/[,;]/))){
    const sub=headingTitle(value,false)||(/^[\p{L}\d][\p{L}\d +&()/-]{2,35}$/u.test(value.trim())?headingTitle(value,true):'');
    if(sub)add(sub,title,row,'subtopic',excerpt);
   }
  }
 }
 return topics;
}
