const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const numbers=field=>field.trim().split(/[\s,]+/).map(Number);
const metric=(label,value)=>({label,value});

function bankerCalculation(text){
 if(!/\bbanker(?:['’]s)? algorithm\b/i.test(text))return null;
 const read=name=>{
  const payload=text.match(new RegExp('^'+name+'\\s*:\\s*(\\[[^\\n]+\\])\\s*$','im'))?.[1];
  try{return JSON.parse(payload??'null');}catch{return null;}
 };
 const allocation=read('Allocation'),maximum=read('Max(?:imum)?'),available=read('Available');
 const quantity=value=>Number.isSafeInteger(value)&&value>=0&&value<=100000;
 if(!Array.isArray(available)||!available.length||available.length>12||!available.every(quantity)||
   !Array.isArray(allocation)||!Array.isArray(maximum)||!allocation.length||allocation.length>32||
   maximum.length!==allocation.length)return null;
 const vector=row=>Array.isArray(row)&&row.length===available.length&&row.every(quantity);
 if(!allocation.every(vector)||!maximum.every(vector)||
   allocation.some((row,i)=>row.some((value,j)=>value>maximum[i][j])))return null;
 const work=available.slice(),sequence=[];
 const remaining=new Set(allocation.keys());
 while(remaining.size){
  const next=[...remaining].find(i=>allocation[i].every((value,j)=>maximum[i][j]-value<=work[j]));
  if(next===undefined)break;
  remaining.delete(next);
  sequence.push(next);
  allocation[next].forEach((value,j)=>{work[j]+=value;});
 }
 return {method:'Banker’s safety algorithm',safe:remaining.size===0,allocation,maximum,available,sequence};
}

export function supportedCalculation(question) {
 const text=question.replace(/\r/g,'');
 const banker=bankerCalculation(text);
 if(banker)return banker;
 // Require an explicit input format and an unambiguous algorithm; never extract data from the answer.
 if(/\bFCFS\b|first.come.first.served/i.test(text)&&!/\b(?:SJF|SRTF|round robin|priority|I\/O)\b/i.test(text)){
  const rows=[...text.matchAll(/^\s*\|?\s*(P\d+)\s*(?:\||,|\s)\s*(\d{1,5})\s*(?:\||,|\s)\s*(\d{1,5})\s*\|?\s*$/gim)]
   .map(([,id,arrival,burst])=>({id:id.toUpperCase(),arrival:Number(arrival),burst:Number(burst)}));
  if(rows.length!==(text.match(/^\s*\|?\s*P\d+\b/gim)?.length??0)||
   /\b(?:context[ -]switch|switching overhead)\b/i.test(text))return null;
  if(!/\barrival\b[^\n]*\bburst\b/i.test(text)||rows.length<2||rows.length>32||
   new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!row.burst))return null;
  if(rows.some((row,index)=>rows.some((other,i)=>i<index&&other.arrival===row.arrival))&&!/\b(?:listed order|table order|input order|process ID)\b/i.test(text))return null;
  if(/\bprocess ID\b/i.test(text))rows.sort((a,b)=>Number(a.id.slice(1))-Number(b.id.slice(1)));
  let end=0;
  const schedule=rows.sort((a,b)=>a.arrival-b.arrival).map(row=>{
   const start=Math.max(row.arrival,end);
   end=start+row.burst;
   return {...row,start,end,waiting:start-row.arrival,turnaround:end-row.arrival};
  });
  return {method:'FCFS scheduling',detail:schedule,metrics:[
   metric('Average waiting time',average(schedule.map(row=>row.waiting))),
   metric('Average turnaround time',average(schedule.map(row=>row.turnaround))),
  ]};
 }
 const algorithm=text.match(/\b(FIFO|LRU)\b/gi);
 const refs=text.match(/\b(?:reference string|page references)\s*[:=]\s*([\d, \t]+)(?:[.?!])?[ \t]*(?:\n|$)/i)?.[1];
 const capacity=Number(text.match(/\b(\d{1,2})\s+(?:empty\s+)?(?:page\s+)?frames\b/i)?.[1]??text.match(/\bframes\s*[:=]\s*(\d{1,2})\b/i)?.[1]);
 if(algorithm?.length&&new Set(algorithm.map(name=>name.toUpperCase())).size===1&&refs&&capacity>=1&&capacity<=20&&
    /\b(?:initially empty|empty (?:page )?frames)\b/i.test(text)&&/\b(?:page faults?|page replacement)\b/i.test(text)){
  const pages=numbers(refs);
  if(pages.length<2||pages.length>128)return null;
  const lru=algorithm[0].toUpperCase()==='LRU';
  const resident=[];
  let faults=0;
  for(const page of pages){
   const position=resident.indexOf(page);
   if(position>=0){if(lru){resident.splice(position,1);resident.push(page);}continue;}
   faults++;
   if(resident.length===capacity)resident.shift();
   resident.push(page);
  }
  return {method:lru?'LRU page replacement':'FIFO page replacement',
   metrics:[metric('Page faults',faults),metric('Page hits',pages.length-faults)]};
 }
 return null;
}

export function renderCheckedCalculation(calculation,question){
 if(!calculation)return null;
 if(typeof calculation.safe==='boolean'){
  if(!/\b(?:safety|safe state|safe sequence|unsafe)\b/i.test(question))return null;
  const sequence=calculation.sequence.map(index=>'P'+index).join(' → ');
  const text='**Safety:** '+(calculation.safe?'safe':'unsafe')+
   (calculation.safe?'\n\nSafe sequence: '+sequence:'')+
   '\n\nAt each step, a process can finish if its remaining need fits the available resources. When it finishes, its allocation returns to the available pool.';
  return {explanation:text,validationMethod:calculation.method,checkedMetrics:['Safety state',...(calculation.safe?['Safe sequence']:[])]};
 }
 const requested=calculation.metrics.filter(({label})=>new RegExp(label+'?', 'i').test(question));
 if(!requested.length)return null;
 const schedule=calculation.detail;
 const steps=schedule?'Waiting time = start − arrival. Turnaround time = finish − arrival.\n\n'+
  schedule.map(row=>'- '+row.id+' runs from '+row.start+' to '+row.end+'; waiting '+row.waiting+', turnaround '+row.turnaround+'.').join('\n')+
  '\n\nThe schedule assumes zero context-switch time.':
  calculation.method.startsWith('LRU')?'On a hit, move the page to most recently used. On a miss with full frames, replace the least recently used page.':
   'On a hit, keep the arrival order. On a miss with full frames, replace the earliest-loaded page.';
 const final=requested.map(({label,value})=>label+': '+Number(value.toFixed(2))).join('\n\n');
 return {explanation:steps+'\n\n'+final,validationMethod:calculation.method,checkedMetrics:requested.map(item=>item.label)};
}

export function checkNumericalAnswer(question,answer,calculation=supportedCalculation(question)){
 if(!calculation)return {validationStatus:'not_independently_checked'};
 const normalized=answer.replace(/[*_\x60]/g,'');
 if(typeof calculation.safe==='boolean'){
  const claimed=normalized.match(/\bsafety\s*:\s*(safe|unsafe)\b/i)?.[1]?.toLowerCase();
  if(!claimed)return {validationStatus:'not_independently_checked'};
  if((claimed==='safe')!==calculation.safe)return {validationStatus:'check_failed',validationMethod:calculation.method,failedMetric:'Safety state'};
  const requiresSequence=/\bsafe sequence\b/i.test(question)&&calculation.safe;
  if(!requiresSequence)return {validationStatus:'deterministically_checked',validationMethod:calculation.method,checkedMetrics:['Safety state']};
  const line=normalized.match(/\bsafe sequence\s*:\s*([^\n]+)/i)?.[1];
  if(!line)return {validationStatus:'not_independently_checked'};
  const sequence=[...line.matchAll(/\bP(\d+)\b/gi)].map(match=>Number(match[1]));
  const work=[...calculation.available];
  const valid=sequence.length===calculation.allocation.length&&new Set(sequence).size===sequence.length&&sequence.every(i=>{
   const allocation=calculation.allocation[i];
   if(!allocation||allocation.some((value,j)=>calculation.maximum[i][j]-value>work[j]))return false;
   allocation.forEach((value,j)=>{work[j]+=value;});
   return true;
  });
  return valid?{validationStatus:'deterministically_checked',validationMethod:calculation.method,checkedMetrics:['Safety state','Safe sequence']}
   :{validationStatus:'check_failed',validationMethod:calculation.method,failedMetric:'Safe sequence'};
 }
 const value='(-?\\d+(?:\\.\\d+)?)';
 const required=calculation.metrics.filter(({label})=>label.toLowerCase().startsWith('average')
  ?new RegExp(label,'i').test(question):new RegExp(label+'?','i').test(question));
 const checked=[];
 for(const {label,value:expected} of calculation.metrics){
  const name=label.toLowerCase();
  const values=[...normalized.matchAll(new RegExp('\\b'+name+'\\s*(?:=|:|is|are|of)\\s*'+value+'|'+value+'\\s+'+name+'\\b','gi'))]
   .map(match=>match[1]??match[2]);
  if(values.some(result=>{
   const places=result.split('.')[1]?.length??0;
   return Math.abs(Number(result)-expected)>(places?Math.max(.005,.5*10**-places):.005)+1e-9;
  }))return {validationStatus:'check_failed',validationMethod:calculation.method,failedMetric:label};
  if(values.length)checked.push(label);
 }
 return checked.length&&required.length&&required.every(({label})=>checked.includes(label))
  ?{validationStatus:'deterministically_checked',validationMethod:calculation.method,checkedMetrics:checked}
  :{validationStatus:'not_independently_checked'};
}
