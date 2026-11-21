import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node server/extract-pdf.mjs PAPER.pdf MATERIAL.json');
const task=getDocument({data:new Uint8Array(await readFile(input)),useSystemFonts:true,enableXfa:false});
try {
  const document=await task.promise;
  const pages=[];
  for(let number=1;number<=document.numPages;number++){
    const page=await document.getPage(number);
    const extracted=await page.getTextContent();
    const text=extracted.items.filter(item=>'str' in item).map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim();
    if(!text)console.warn('Page '+number+' has no selectable text. Verify OCR or add a transcription.');
    pages.push({number,text});
  }
  await writeFile(output,JSON.stringify({name:basename(input),pages},null,2)+'\n');
} finally {
  await task.destroy();
}

