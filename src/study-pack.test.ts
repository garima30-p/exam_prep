import { expect, it } from 'vitest';
import { demoApi, duration, fixture } from './api';
import { buildStudyPack, exportBlocks } from './study-pack';

it('reads study budgets without counting time until the exam', () => {
  expect(duration('My DBMS exam is in 2 hours. I have only 30 minutes to study.')).toBe(30);
  expect(duration('The exam is in two hours.')).toBe(0);
  expect(duration('I can study for four hours.')).toBe(240);
  expect(duration('Actually, only twenty minutes left.')).toBe(20);
  expect(duration('I have 2.5 hours.')).toBe(150);
  expect(duration('1 hour and 15 minutes')).toBe(75);
});

it('fits extractive reading and recall into a short budget and exports the same evidence', () => {
  const question = {...fixture[0], answerSource:{
    file:'OS notes.pdf', page:4, number:'Q7 answer',
    excerpt:'Deadlock occurs when processes wait on resources held by each other. Mutual exclusion is necessary.',
  }};
  const context=demoApi.parse('My exam is tomorrow. I have 8 minutes.');
  const pack=buildStudyPack(context,8,null,[],[],[question],false,[]);
  expect(pack.notes[0]).toMatchObject({source:question.answerSource,readOnly:true});
  expect(pack.timeline.reduce((sum,item)=>sum+item.minutes,0)).toBeLessThanOrEqual(8);
  const full=exportBlocks(pack,'all').map(block=>block.text);
  const extract=exportBlocks(pack,'notes').map(block=>block.text);
  expect(extract).toContain('Source: OS notes.pdf · p. 4 · Q7 answer');
  expect(full).toContain('Deadlock occurs when processes wait on resources held by each other.');
  expect(extract).not.toContain('Important Questions');
});
