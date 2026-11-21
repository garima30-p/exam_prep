import type { Reading } from '../server/page-text.mjs';

export type ExtractedPage = {
  number:number;
  text:string;
  status:'pending'|'extracted'|'review'|'failed'|'verified';
  method:'none'|'pdf-text'|'office-text'|'ocr'|'manual';
  confidence?:number;
  questions:number;
  reason:string;
  dpi?:number;
  rotation?:number;
  attempts?:Pick<Reading,'confidence'|'variant'>[];
};
export type ExtractedDocument = {id:number;name:string;total:number|null;pages:ExtractedPage[];error?:string};
export type ExtractionUpdate = {documents:ExtractedDocument[];message:string};
export type PrepareOptions = {
  records:readonly ExtractedDocument[];
  signal:AbortSignal;
  retry?:boolean;
  onUpdate:(update:ExtractionUpdate)=>void;
};
export const isTrusted=(page:ExtractedPage)=>page.status==='extracted'||page.status==='verified';
export const documentComplete=(document:ExtractedDocument)=>document.total!==null&&
  document.pages.length===document.total&&document.pages.every(isTrusted);
