export function administrativeLine(value:string):boolean;
export function administrativeSection(value:string):boolean;
export function syllabusUnit(value:string):RegExpExecArray|null;
export function syllabusContentsHeading(value:string):boolean;
export function syllabusEnd(value:string):boolean;
export function syllabusAdministrative(value:string):boolean;
export function syllabusSubject(pages:readonly {text:string}[]):string;
export type SyllabusHeading={ title:string; group:string; unit:number; level:'unit'|'major'|'subtopic'; page:number; line:number; excerpt:string; method?:'pdf-text'|'office-text'|'ocr'|'manual' };
export function parseSyllabus(pages:readonly {number:number;text:string;method?:string}[]):SyllabusHeading[];
