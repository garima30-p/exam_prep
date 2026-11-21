// @vitest-environment jsdom
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { readOfficeText } from './office-text';

async function archive(entries: Record<string, string>, name: string) {
  const zip = new JSZip();
  for (const [path,body] of Object.entries(entries)) zip.file(path,body);
  return new File([await zip.generateAsync({type:'arraybuffer'})],name);
}

it('extracts Word paragraphs and text inside table cells',async()=>{
  const file=await archive({'word/document.xml':
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+
    '<w:p><w:r><w:t>Explain deadlock.</w:t></w:r></w:p>'+
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Mutual exclusion</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'+
    '</w:body></w:document>'},'notes.docx');
  expect(await readOfficeText(file,'word',new AbortController().signal)).toEqual(['Explain deadlock.\nMutual exclusion']);
});

it('extracts PowerPoint slide text in presentation order',async()=>{
  const slide=(text:string)=>'<a:root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>'+text+'</a:t></a:r></a:p></a:root>';
  const file=await archive({
    'ppt/presentation.xml':'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="r2"/><p:sldId id="257" r:id="r1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="r2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml':slide('Second in presentation order'),
    'ppt/slides/slide2.xml':slide('First in presentation order'),
  },'slides.pptx');
  expect(await readOfficeText(file,'slides',new AbortController().signal))
    .toEqual(['First in presentation order','Second in presentation order']);
});
