import {expect,it} from 'vitest';
import {parseSyllabus,syllabusSubject} from './study-material.mjs';

const page=(number,text)=>({number,text,method:'pdf-text'});

it('retains a structured engineering outline and rejects metadata and unanchored fragments',()=>{
 const pages=[page(1,'Course Title: Operating Systems\nCourse Outcomes\nCO1: Read a book.\nDetails of the Course\nUnit I: System Architecture\n- System\nCalls\n- Kernel Interfaces\n11\ncalls\nmodel'),
  page(2,'Unit II: 3D Graphics\nMemory layout: Paging, Segmentation\nframes\nimplementation\n11. Suggested Books\n- Textbook Title\nReferences\nA History of Computing')];
 expect(parseSyllabus(pages).map(({title,group,page,line})=>({title,group,page,line}))).toEqual([
  {title:'System Architecture',group:'',page:1,line:5},
  {title:'System Calls',group:'System Architecture',page:1,line:6},
  {title:'Kernel Interfaces',group:'System Architecture',page:1,line:8},
  {title:'3D Graphics',group:'',page:2,line:1},
  {title:'Memory layout',group:'3D Graphics',page:2,line:2},
  {title:'Paging',group:'Memory layout',page:2,line:2},
  {title:'Segmentation',group:'Memory layout',page:2,line:2},
 ]);
 expect(syllabusSubject(pages)).toBe('Operating Systems');
});

it('reads a non-catalog subject, preserves short structured headings, and does not bridge missing pages',()=>{
 const pages=[page(1,'Course Title: Cultural History\nCourse Outline\nModule I: Early Modern Europe\n- Renaissance\n- Reformation'),
  page(3,'A second part\nUrban Lives\nModule II: Industrial Revolution\nUrban history: Migration, Labour Movements\nAssessment Guidelines\n- Weekly quizzes\nBibliography\n- Selected books')];
 expect(syllabusSubject(pages)).toBe('Cultural History');
 expect(parseSyllabus(pages).map(item=>[item.title,item.group])).toEqual([
  ['Early Modern Europe',''],['Renaissance','Early Modern Europe'],['Reformation','Early Modern Europe'],
  ['Industrial Revolution',''],['Urban history','Industrial Revolution'],['Migration','Urban history'],['Labour Movements','Urban history'],
 ]);
});

it('recognizes structured science and commerce headings containing numbers',()=>{
 const science=page(1,'Syllabus\nModule 1: Organic Chemistry\n- SN1 and SN2 Reactions\n- Carbon-13 NMR');
 const commerce=page(1,'Course Outline\nUnit 1: Financial Reporting\n- IFRS 16\n- Taxation\nReferences\n- Annual Report');
 expect(parseSyllabus([science]).map(item=>item.title)).toEqual(['Organic Chemistry','SN1 and SN2 Reactions','Carbon-13 NMR']);
 expect(parseSyllabus([commerce]).map(item=>item.title)).toEqual(['Financial Reporting','IFRS 16','Taxation']);
});
