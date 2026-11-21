// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { extractDocuments } from './documents';
import { documentComplete } from './document-state';
import type { PrepareOptions } from './document-state';
import type { Material } from './api';

const mock=vi.hoisted(()=>({
  cleanup:vi.fn(),destroy:vi.fn(async()=>{}),close:vi.fn(async()=>{}),
  read:vi.fn(),native:new Set<number>(),rotation:90
}));
vi.mock('pdfjs-dist',()=>({
  GlobalWorkerOptions:{},
  Util:{transform:(_viewport:number[],transform:number[])=>transform},
  getDocument:({data}:{data:ArrayBuffer})=>({
    promise:Promise.resolve({numPages:new Uint8Array(data)[0],async getPage(number:number){
      return {number,rotate:mock.rotation,cleanup:mock.cleanup,getViewport:()=>({transform:[1,0,0,1,0,0]}),
        getTextContent:async()=>({items:mock.native.has(number)?[{str:'Explain the role of virtual memory in modern systems.',transform:[10,0,0,10,15,40],width:100,hasEOL:true}]:[]})};
    }}),
    destroy:mock.destroy
  })
}));
vi.mock('./ocr',()=>({createOcr:async()=>({read:mock.read,close:mock.close})}));

const item=(id:number,count:number):Material=>({id,kind:'Past paper',file:{
  name:'paper'+id+'.pdf',arrayBuffer:async()=>Uint8Array.from([count]).buffer
} as File});
const reading=(number:number,confidence=88)=>({best:{text:'Explain the use of virtual memory in system '+number+'.',confidence,variant:'raw'},attempts:[],dpi:230,rotation:90});
const options=(controller=new AbortController()):PrepareOptions=>({signal:controller.signal,records:[],onUpdate:vi.fn()});

it('processes more than six pages across two documents in sequence, skips OCR for native pages, and reuses the cache',async()=>{
  mock.native=new Set([1]);mock.read.mockReset();mock.cleanup.mockClear();mock.close.mockClear();
  const rotations:number[]=[];
  let active=0,peak=0;
  mock.read.mockImplementation(async (page:{number:number;rotate:number})=>{
    rotations.push(page.rotate);active++;peak=Math.max(peak,active);
    await Promise.resolve();
    active--;return reading(page.number);
  });
  const files=[item(1,5),item(2,5)];
  const control=options();
  const records=await extractDocuments(files,control);
  expect(peak).toBe(1);
  expect(mock.read).toHaveBeenCalledTimes(8);
  expect(rotations).toEqual(Array(8).fill(90));
  expect(records.every(documentComplete)).toBe(true);
  expect(records[0].pages[0].method).toBe('pdf-text');
  expect(mock.cleanup).toHaveBeenCalledTimes(10);
  expect(mock.close).toHaveBeenCalledTimes(1);
  expect(control.onUpdate).toHaveBeenCalled();
  await extractDocuments(files,{...control,records});
  expect(mock.read).toHaveBeenCalledTimes(8);
});

it('retains poor readings for review, retries only unresolved pages and records an OCR failure',async()=>{
  mock.native=new Set([1]);mock.read.mockReset();
  mock.read.mockResolvedValueOnce(reading(2,25)).mockResolvedValueOnce(reading(3,88));
  const files=[item(1,3)];
  const run=options();
  const records=await extractDocuments(files,run);
  expect(records[0].pages.map(page=>page.status)).toEqual(['extracted','review','extracted']);
  expect(documentComplete(records[0])).toBe(false);
  mock.read.mockRejectedValueOnce(new Error('OCR failed'));
  const checked=await extractDocuments(files,{...run,records,retry:true});
  expect(checked[0].pages.map(page=>page.status)).toEqual(['extracted','review','extracted']);
  expect(checked[0].pages[1]).toMatchObject({text:records[0].pages[1].text,reason:expect.stringContaining('could not read')});
  expect(mock.read).toHaveBeenCalledTimes(3);
});

it('cancels processing, releases the worker and page, and leaves later pages pending',async()=>{
  mock.native=new Set([1]);mock.read.mockReset();mock.cleanup.mockClear();mock.destroy.mockClear();mock.close.mockClear();
  const controller=new AbortController();
  const run=options(controller);
  mock.read.mockImplementationOnce(async()=>{
    controller.abort();
    throw controller.signal.reason;
  });
  await expect(extractDocuments([item(1,4)],run)).rejects.toMatchObject({name:'AbortError'});
  expect(mock.read).toHaveBeenCalledTimes(1);
  expect(mock.cleanup).toHaveBeenCalledTimes(2);
  expect(mock.destroy).toHaveBeenCalledTimes(1);
  expect(mock.close).toHaveBeenCalledTimes(1);
  const calls=vi.mocked(run.onUpdate).mock.calls;
  expect(calls.at(-1)?.[0].documents[0].pages.map(page=>page.status)).toEqual(['extracted','pending','pending','pending']);
});
