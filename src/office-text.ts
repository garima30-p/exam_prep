import JSZip from 'jszip';
import type { JSZipObject } from 'jszip';
import { abortable } from './abortable';

const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const drawingNamespace = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const xmlLimit = 6_000_000;
const textLimit = 140_000;

type XmlStream = {
  on(event: 'data', callback: (chunk: Uint8Array) => void): XmlStream;
  on(event: 'error', callback: (error: Error) => void): XmlStream;
  on(event: 'end', callback: () => void): XmlStream;
  resume(): XmlStream;
  pause(): XmlStream;
};

async function readXml(entry: JSZipObject | null, signal: AbortSignal) {
  if (!entry) throw new Error('Missing Office document data.');
  signal.throwIfAborted();
  const stream = (entry as JSZipObject & {internalStream(type:'uint8array'):XmlStream}).internalStream('uint8array');
  const text = await abortable(new Promise<string>((resolve, reject) => {
    const decoder = new TextDecoder();
    let size = 0;
    let result = '';
    stream.on('data', chunk => {
      size += chunk.length;
      if (size > xmlLimit) {
        stream.pause();
        reject(new Error('Office document content exceeds the processing limit.'));
      } else result += decoder.decode(chunk,{stream:true});
    }).on('error', reject).on('end', () => resolve(result+decoder.decode())).resume();
  }), signal, () => stream.pause());
  if (/<!DOCTYPE/i.test(text)) throw new Error('Unsupported Office XML.');
  const xml = new DOMParser().parseFromString(text,'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Invalid Office XML.');
  return xml;
}

function wordSections(xml: Document) {
  const body = xml.getElementsByTagNameNS(wordNamespace,'body')[0];
  if (!body) throw new Error('Invalid Word document.');
  const result: string[] = [];
  let lines: string[] = [];
  let length = 0;
  function add(text: string) {
    if (!text) return;
    if (length+text.length+1>textLimit && lines.length) flush();
    for(let offset=0;offset<text.length;offset+=textLimit) {
      lines.push(text.slice(offset,offset+textLimit));
      length+=lines.at(-1)!.length+1;
      if(length>=textLimit)flush();
    }
  }
  function flush() {
    if(lines.length) result.push(lines.join('\n'));
    lines=[];length=0;
  }
  for (const paragraph of body.getElementsByTagNameNS(wordNamespace,'p')) {
    let line='';
    for (const node of paragraph.getElementsByTagNameNS(wordNamespace,'*')) {
      if(node.localName==='t')line+=node.textContent??'';
      if(node.localName==='tab')line+='\t';
      if(node.localName==='br'||node.localName==='cr'){
        add(line.trim());line='';
        if(node.getAttributeNS(wordNamespace,'type')==='page')flush();
      }
    }
    add(line.trim());
    if(paragraph.getElementsByTagNameNS(wordNamespace,'sectPr').length)flush();
  }
  flush();
  return result.length ? result : [''];
}

export async function readOfficeText(file: File, format: 'word'|'slides', signal: AbortSignal) {
  const bytes = await abortable(file.arrayBuffer(), signal);
  const zip = await abortable(JSZip.loadAsync(bytes),signal);
  if (format==='word') return wordSections(await readXml(zip.file('word/document.xml'),signal));

  const presentation = await readXml(zip.file('ppt/presentation.xml'),signal);
  const relations = await readXml(zip.file('ppt/_rels/presentation.xml.rels'),signal);
  const targets = new Map([...relations.getElementsByTagNameNS('*','Relationship')]
    .filter(node=>node.getAttribute('TargetMode')!=='External'&&node.getAttribute('Type')?.endsWith('/slide'))
    .map(node=>[node.getAttribute('Id'),node.getAttribute('Target')??'']));
  const ids = [...presentation.getElementsByTagNameNS('*','sldId')];
  if (ids.length>400) throw new Error('This presentation has more than 400 slides.');
  const result: string[]=[];
  for(const node of ids) {
    const key=[...node.attributes].find(attribute=>attribute.localName==='id'&&attribute.namespaceURI?.endsWith('/relationships'))?.value;
    const target=targets.get(key??'')??'';
    const normalized=target.startsWith('/')?target.slice(1):'ppt/'+target;
    if (!/^ppt\/slides\/[^/\\]+\.xml$/i.test(normalized)) throw new Error('Invalid PowerPoint slide reference.');
    const slide=await readXml(zip.file(normalized),signal);
    const text=[...slide.getElementsByTagNameNS(drawingNamespace,'p')].map(paragraph=>
      [...paragraph.getElementsByTagNameNS(drawingNamespace,'t')].map(run=>run.textContent).join('')).join('\n').trim();
    if(text.length>textLimit)throw new Error('A slide exceeds the text processing limit.');
    result.push(text);
  }
  return result.length?result:[''];
}
