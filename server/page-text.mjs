const QUESTION=/^(?:(?:q(?:uestion)?\s*\.?\s*(\d+\s*\(?[a-z]\)?|\d+)|\(?([0-9]{1,2}\s*\(?[a-z]\)?|[0-9]{1,2})\)?)[.):\s-]+)?((?:explain|describe|define|discuss|compare|illustrate|derive|prove|calculate|solve|design|differentiate|evaluate|elaborate|list|write|draw|state|show|find|identify|what|why|how|when|which|give)\b.+)/i;
const NUMBERED=/^(?:q(?:uestion)?\s*\.?\s*)?(\d{1,2}(?:[.\s]*\([a-z]\)|[a-z])?|\((?:[a-z]|i{2,3}|iv|vi{1,3}|ix)\)|[a-z](?=[.)]))[.):\s-]+(.{12,})/i;
const HEADER=/^(?:section|unit|part)\s+[a-z\d]+\s*(?:[-:.(]|$)/i;
const GROUP=/^q(?:uestion)?\s*\.?\s*\d{1,2}\s*[.:)]?\s*(?:\s*\(?[\d x×=]+\s+marks?\)?)?$/i;
export const readQuestionCue=(line,pastPaper=false)=>{
  if(GROUP.test(line))return null;
  const solved=line.match(/^(Q\s*\d{1,3})\s+\[P\d[^\]]*\]\s+(.{12,})$/i);
  if(solved)return {number:solved[1].replace(/\s+/g,''),text:solved[2]};
  const command=line.match(QUESTION);
  const numbered=!command&&pastPaper?line.match(NUMBERED):null;
  const number=(command?.[1]??command?.[2]??numbered?.[1])?.replace(/\s+/g,'');
  return command?{number,text:command[3]}:numbered?{number,text:numbered[2]}:null;
};
export function countQuestions(text,pastPaper=true) {
  return text.split(/\r?\n/).filter(line=>!HEADER.test(line.trim())&&readQuestionCue(line.trim(),pastPaper)).length;
}

export function readMarks(text) {
  const mark=text.match(/\s*(?:(\d{1,2})\s*marks?|\[(\d{1,2})\]|\((\d{1,2})\))\s*$/i);
  return {text:(mark?text.slice(0,mark.index):text).replace(/\s*[[(]?\s*$/,'').trim(),
    marks:mark?Number(mark[1]??mark[2]??mark[3]):null};
}

export function countSupportedOcrQuestions(text,pastPaper) {
  return text.split(/\r?\n/).reduce((count,line)=>{
    const candidate=readQuestionCue(line.trim(),pastPaper);
    if(!candidate)return count;
    const statement=readMarks(candidate.text).text;
    return count+Number(statement.length>=12&&statement.length<=480&&!ocrQuestionNeedsReview(statement));
  },0);
}

export function formatPageText(text,kind) {
  if(kind!=='Past paper')return text.trim();
  const result=[];
  let active=-1;
  for(const source of text.split(/\r?\n/)){
    const line=source.replace(/[ \t]+/g,' ').trim();
    if(!line){
      if(active>=0&&/[.?!](?:\s+\(CO\d+\))?$/i.test(result[active]))active=-1;
      continue;
    }
    if(HEADER.test(line)||GROUP.test(line)||/^(?:P\.?\s*T\.?\s*O\.?|\(?\d{1,3}\)?\s+[A-Z]{2,}-?\d{2,}|turn over|page\s+\d+(?:\s+of\s+\d+)?|note for .*setters:?)$/i.test(line)){
      active=-1;
      result.push(line);
      continue;
    }
    if(readQuestionCue(line,true)){
      active=result.length;result.push(line);
    } else if(active>=0&&result[active].length+line.length<1200&&
        !/^\((?:[a-z]|[ivx]+)\)\s/i.test(line)&&!/^\(?CO\d+\)?$/i.test(line)&&
        !/\|.*\||[{}]{1,}|\w+\s{3,}\w+/.test(source)){
      result[active]+=' '+line;
    } else {
      result.push(line);
      if(!/^\(?CO\d+\)?$/i.test(line))active=-1;
    }
  }
  return result.join('\n');
}

export function ocrQuestionNeedsReview(text) {
  return /\b(?:(?:following|given)\s+(?:table|diagram|figure|graph|program|code|(?:page[- ]?)?reference string)|(?:table|diagram|figure|graph)\s+(?:below|given|shown)|calculate|compute|derive|numerical)\b/i.test(text)||
    /\d|[=≤≥±×÷√∑]/.test(text.replace(/\(CO\s*\d+(?:\s*,\s*CO\s*\d+)*\)/gi,''));
}

/** Locate a low-ink gutter on an upright landscape scan with text on both sides. */
export function findGutter(image) {
  const {data,width,height}=image;
  if(width<height*1.15)return null;
  const step=Math.max(2,Math.floor(width/650));
  const bands=[];
  let left=0,right=0;
  for(let x=Math.round(width*.12);x<width*.89;x+=step){
    let ink=0;
    for(let y=Math.round(height*.08);y<height*.91;y+=step){
      const i=(y*width+x)*4;
      if(data[i]+data[i+1]+data[i+2]<360)ink++;
    }
    if(x<width*.42)left+=ink;
    if(x>width*.65)right+=ink;
    bands.push({x,ink});
  }
  if(Math.min(left,right)<25||Math.min(left,right)/Math.max(left,right)<.08)return null;
  const central=bands.filter(band=>band.x>width*.42&&band.x<width*.65);
  const maxInk=(left+right)/(bands.length-central.length)*.17;
  let start=null,best=null;
  for(const band of [...central,{x:width*.65,ink:Infinity}]){
    if(band.ink<=maxInk){start??=band.x;continue;}
    if(start!==null){
      const size=band.x-start;
      if(!best||size>best.size)best={x:Math.round(start+size/2),size};
      start=null;
    }
  }
  return best&&best.size>=width*.021?best.x:null;
}

export function pageQuality(text,kind,confidence=null) {
  const compact=text.replace(/\s+/g,' ').trim();
  const words=compact.match(/\p{L}{2,}/gu)??[];
  const questions=countQuestions(text,kind==='Past paper');
  const symbols=compact.match(/[\uFFFD\u0000-\u0008\uE000-\uF8FF]/g)?.length??0;
  const goodText=words.length>=(questions>0&&confidence===null?5:8)&&(symbols/Math.max(1,compact.length)<.018)&&
    words.filter(word=>word.length>=3).length/words.length>=.55;
  const questionEvidence=kind!=='Past paper'||questions>0;
  const sufficient=goodText&&questionEvidence;
  const score=Math.min(words.length,180)*.11+Math.min(questions,18)*2+(confidence??0)*.8-symbols*2;
  if(!compact)return {status:'failed',questions,score,reason:'No readable text was found.'};
  if(!sufficient)return {status:'review',questions,score,reason:questionEvidence?'The text is sparse or contains unreadable characters.':'No complete question line was recognized on this page.'};
  if(confidence!==null&&confidence<78)return {status:'review',questions,score,reason:'The scan needs checking against the original page.'};
  return {status:'extracted',questions,score,reason:''};
}

export function chooseReading(current,next,kind) {
  if(!current)return next;
  const previous=pageQuality(current.text,kind,current.confidence);
  const candidate=pageQuality(next.text,kind,next.confidence);
  if(previous.status!==candidate.status&&[previous.status,candidate.status].includes('extracted'))
    return candidate.status==='extracted'?next:current;
  return candidate.score>previous.score+3?next:current;
}

export function scanScale(width,height,pixelBudget=7_000_000) {
  return Math.min(240/72,Math.sqrt(pixelBudget/(width*height)),3200/Math.max(width,height));
}

export function scanPasses(width,height,manual=false) {
  const broad=width>height*1.15;
  return [
    {rotation:0,filter:'raw',layout:'auto'},
    {rotation:0,filter:'contrast',layout:broad?'auto':'column'},
    ...(manual?[{rotation:0,filter:'binary',layout:'auto'}]:[]),
    {rotation:90,filter:'raw',layout:'auto'},
    {rotation:270,filter:'raw',layout:'auto'},
    ...(manual?[{rotation:180,filter:'contrast',layout:'auto'}]:[])
  ];
}

/** Grayscale percentile stretch, with optional Otsu thresholding for faded scans. */
export function enhanceScan(image,binary=false) {
  const {data}=image;
  const histogram=new Uint32Array(256);
  for(let i=0;i<data.length;i+=4){
    const gray=(77*data[i]+150*data[i+1]+29*data[i+2])>>8;
    data[i]=gray;
    histogram[gray]++;
  }
  const size=data.length/4;
  let low=0,high=255,cumulative=0;
  while(low<255&&(cumulative+=histogram[low])<size*.03)low++;
  cumulative=0;
  while(high>0&&(cumulative+=histogram[high])<size*.99)high--;
  if(high-low<45){low=0;high=255;}
  let threshold=125;
  if(binary){
    const sum=histogram.reduce((total,count,i)=>total+count*i,0);
    let count=0,background=0,best=-1;
    for(let i=0;i<255;i++){
      count+=histogram[i];background+=histogram[i]*i;
      if(!count || count===size)continue;
      const difference=background/count-(sum-background)/(size-count);
      const variance=count*(size-count)*difference*difference;
      if(variance>best){best=variance;threshold=i;}
    }
  }
  for(let i=0;i<data.length;i+=4){
    const gray=data[i];
    const value=binary?(gray<=threshold?0:255):Math.max(0,Math.min(255,Math.round((gray-low)*255/(high-low))));
    data[i]=data[i+1]=data[i+2]=value;
  }
  return image;
}
