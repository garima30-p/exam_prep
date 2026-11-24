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

it('reconstructs source-supported compounds and rejects noise and prose from OCR',()=>{
 const text=[
  'Course Title: Operating Systems','Details of the Course','Unit I: Process Management',
  'EN Ton','Operating','Command','System','Calls, Types of system calls...',
  'Process','Synchronization','- Critical Section','- Peterson’s Solution','- Semaphores','- CPU','- I/O',
  '11. Suggested Books','- A Book on Systems','References','A textbook title'
 ].join('\n');
 const headings=parseSyllabus([{number:1,text,method:'ocr'}]);
 const titles=headings.map(x=>x.title);
 expect(titles).toEqual(['Process Management','System Calls','Process Synchronization','Critical Section','Peterson’s Solution','Semaphores','CPU','I/O']);
 expect(headings.find(x=>x.title==='System Calls')).toMatchObject({page:1,line:7,excerpt:'System Calls, Types of system calls...',validation:'structured-ocr'});
 expect(headings.find(x=>x.title==='Critical Section')?.group).toBe('Process Synchronization');
});

it('rejects an exam heading and command phrases even when a paper is labelled as a syllabus',()=>{
 const text='END SEMESTER EXAMINATION\nName of the Course: Operating Systems\nUnit I: Operating\n- Explain system calls.\n- Command';
 expect(parseSyllabus([{number:1,text,method:'ocr'}])).toEqual([]);
});

it('keeps DBMS acronyms and merges duplicate singular and plural headings with provenance',()=>{
 const text='Course Title: Database Management Systems\nCourse Contents\nUnit 1: Relational Model\n- SQL\n- ACID\n- Functional Dependencies\n- Functional Dependency\n- Database Transactions\nUnit 2: Concurrency Control\n- Deadlock';
 const result=parseSyllabus([page(2,text)]);
 expect(result.map(topic=>topic.title)).toEqual(['Relational Model','SQL','ACID','Functional Dependencies','Database Transactions','Concurrency Control','Deadlock']);
 expect(result.find(topic=>topic.title==='SQL')).toMatchObject({subject:'Database Management Systems',unit:1,group:'Relational Model',page:2,line:4});
});

it('does not confuse introductory prose and biographies with a week-by-week course outline',()=>{
 const pages=[page(1,'Course Outline:\nWhile database systems vary, they share common structures.\nAbout the Instructor:\nProf. Sample received an engineering degree.'),
  page(2,'Week 1: Relational Model\nWeek 2: Structured Query Language (SQL)\nWeek 3: Concurrency Control')];
 expect(parseSyllabus(pages,'Databases').map(topic=>topic.title)).toEqual(['Relational Model','Structured Query Language (SQL)','Concurrency Control']);
});

it('recovers a Roman unit marker split by OCR without turning it into a topic',()=>{
 const pages=[{number:1,method:'ocr',text:'Course Contents\nUnit II: Process Synchronization\nUnit Ill: Deadlock Prevention\n- CPU'}];
 expect(parseSyllabus(pages,'Operating Systems').find(heading=>heading.title==='Deadlock Prevention')).toMatchObject({unit:3});
});

it('recovers an anchored OCR introduction using the declared subject and keeps unsupported fragments out',()=>{
 const text='Course Title: Operating Systems\nCourse Contents\nTatroduction {0 Operating Systems, UNIX: System Calls\nIntroduction to Operating Systems: System structure\n- CPU\n- I/O\n- Fragment (3 unrelated text\nSuggested Books\n- A book';
 const topics=parseSyllabus([{number:1,text,method:'ocr'}]);
 expect(topics.map(item=>item.title)).toEqual(['Introduction to Operating Systems','UNIX','System Calls','System structure','CPU','I/O']);
 expect(topics.find(item=>item.title==='System structure')?.group).toBe('Introduction to Operating Systems');
 expect(topics[0].excerpt).toContain('Tatroduction {0 Operating Systems');
});

it('repairs syllabus vocabulary when the full OCR heading closely matches a known term',()=>{
 const source='Course Title: Operating Systems\nCourse Outline\n- Operating System Servis\n- Muliple-Processor scheduling\n- Thread scheduling. wo\n- I/O';
 expect(parseSyllabus([{number:1,method:'ocr',text:source}]).map(topic=>topic.title)).toEqual([
  'Operating System Services','Multiple-Processor Scheduling','Thread Scheduling','I/O',
 ]);
});
