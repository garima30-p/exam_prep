import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './main';
import { demoApi, fitQuestions, fixture, materialType } from './api';

describe('exam setup',()=>{
  it('offers a single prompt, multiple PDF attachments, and an explicit demo notice',()=>{
    const html=renderToStaticMarkup(<App/>);
    expect(html).toContain('for="prompt"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('Demo · Sample DBMS data');
    expect(html).not.toContain('How much time do you have to study?');
  });
  it('extracts common exam details and leaves missing time unset',()=>{
    expect(demoApi.parse('OS end-sem on Monday, I have 1 hour and 30 minutes. Need 35/100.')).toMatchObject({subject:'OS',date:'Monday',minutes:90,pass:'35/100'});
    expect(demoApi.parse('My DBMS exam is tomorrow.').minutes).toBe(0);
    expect(materialType('DBMS_PYQ_2025.pdf')).toBe('Past paper');
    expect(materialType('tcs502_endsem_2024_dec_21.pdf')).toBe('Past paper');
    expect(materialType('TCS502_OS_Priority_Question_Bank.pdf')).toBe('Notes');
    expect(materialType('scan01.pdf')).toBe('Unclassified');
  });
  it('fits sample questions to the revised budget and cites a real fixture',()=>{
    expect(fitQuestions(fixture,10)).toHaveLength(0);
    const shortlist=fitQuestions(fixture,60);
    expect(shortlist.reduce((total,q)=>total+q.minutes,0)).toBeLessThanOrEqual(54);
    expect(demoApi.chat('Why #1?',fixture)).toContain('page 1, Q1');
    expect(demoApi.chat('Explain #99',fixture)).toContain('visible sample plan');
  });
});
