import { exportBlocks } from './study-pack';
import type { ExportBlock, Section, StudyPack } from './study-pack';

export type Format = 'pdf' | 'docx' | 'png';
const basename = 'in-nocent-study-pack';
const width = 900;
const height = 1273;
const margin = 54;
const styles = [
  { size:40, height:55, weight:750, gap:14 },
  { size:34, height:46, weight:750, gap:12 },
  { size:28, height:39, weight:700, gap:8 },
  { size:25, height:36, weight:400, gap:10 },
];

function wrap(text: string, ctx: CanvasRenderingContext2D) {
  const lines: string[]=[];
  let line='';
  const limit=width-2*margin;
  for(const word of text.split(/\s+/)) {
    if(line && ctx.measureText(line+' '+word).width>limit) {
      lines.push(line);
      line='';
    }
    if(ctx.measureText(word).width>limit) {
      for(const character of word) {
        if(line && ctx.measureText(line+character).width>limit){lines.push(line);line='';}
        line+=character;
      }
    } else line+=(line?' ':'')+word;
  }
  if(line) lines.push(line);
  return lines;
}

function* makePages(blocks: ExportBlock[]) {
  const canvas=document.createElement('canvas');
  canvas.width=width;
  canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Image rendering is unavailable.');
  const ctx=context;
  let y=margin;
  let pageNumber=0;
  function clear() {
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,width,height);
    ctx.textBaseline='top';
    y=margin;
  }
  function page() {
    ctx.font='20px Arial, sans-serif';
    ctx.fillStyle='#475569';
    ctx.fillText('in-nocent  /  '+ ++pageNumber,margin,height-43);
    return canvas.toDataURL('image/png');
  }
  clear();
  for(const block of blocks) {
    const style=styles[block.level];
    const font=style.weight+' '+style.size+'px Arial, sans-serif';
    ctx.font=font;
    const lines=wrap(block.text,ctx);
    if(block.level<3 && y+style.height*lines.length+50>height-margin && y>margin){yield page();clear();}
    for(const line of lines) {
      if(y+style.height>height-margin){yield page();clear();}
      ctx.font=font;
      ctx.fillStyle=block.level<3?'#172047':'#20252f';
      ctx.fillText(line,margin,y);
      y+=style.height;
    }
    y+=style.gap;
  }
  if(y>margin)yield page();
}

export async function createStudyDownload(pack: StudyPack, section: Section, format: Format) {
  const blocks=exportBlocks(pack,section);
  const name=section==='all'?basename:basename+'-'+section;
  if(format==='docx') {
    const { Document, Paragraph, HeadingLevel, Packer }=await import('docx');
    const headings=[HeadingLevel.TITLE,HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,undefined];
    const document=new Document({sections:[{children:blocks.map(block=>new Paragraph({
      text:block.text,heading:headings[block.level],spacing:{after:120},
    }))}]});
    return { blob:await Packer.toBlob(document), filename:name+'.docx' };
  }
  if(format==='pdf') {
    const { jsPDF }=await import('jspdf');
    const pdf=new jsPDF({format:'a4',compress:true});
    let index=0;
    for(const page of makePages(blocks)) {
      if(index++)pdf.addPage();
      pdf.addImage(page,'PNG',0,0,210,297,undefined,'FAST');
    }
    return { blob:pdf.output('blob'), filename:name+'.pdf' };
  }
  const pages=makePages(blocks);
  const first=pages.next().value;
  if(!first)throw new Error('There is no page to export.');
  const next=pages.next();
  if(next.done)return { blob:await fetch(first).then(response=>response.blob()), filename:name+'.png' };
  const { default: JSZip }=await import('jszip');
  const zip=new JSZip();
  let number=0;
  for(const image of [first,next.value,...pages]) {
    zip.file(name+'-page-'+String(++number).padStart(2,'0')+'.png',image.split(',')[1],{base64:true});
  }
  return { blob:await zip.generateAsync({type:'blob'}), filename:name+'-images.zip' };
}
