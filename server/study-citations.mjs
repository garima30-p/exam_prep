const whitespace = text => text.trim().replace(/\s+/g, ' ');

const insignificant=new Set('from that this these those have with will also when into which what should recall question explain answer about more some each must their there other they does such example section could would definition'.split(' '));
const keywords=text=>new Set((text.toLowerCase().match(/[a-z]{4,}/g)??[]).map(word=>word.replace(/(?:ing|ed|s)$/,'')).filter(word=>word.length>=3&&!insignificant.has(word)));
const quantities=text=>text.match(/\b\d+(?:\.\d+)?\s*(?:ms|seconds?|minutes?|kb|mb|gb|%)(?![a-z])/gi)??[];

export function checkStudyAnswer(raw, registry, strict, verifyRelevance=false) {
  const text = raw.trim().replace(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i, '$1');
  let answer;
  try { answer = JSON.parse(text); }
  catch { return { issue: 'invalid_json', hasText: Boolean(text), ids: [] }; }
  if (answer?.insufficientEvidence === true && Array.isArray(answer.sections) && !answer.sections.length) {
    return { issue: 'insufficient_evidence', hasText: false, ids: [] };
  }
  if (answer?.insufficientEvidence !== false || !Array.isArray(answer.sections) ||
      !answer.sections.length || answer.sections.length > 6) {
    return { issue: 'invalid_structure', hasText: false, ids: [] };
  }
  const ids = new Set();
  const references = new Map();
  const sections = [];
  let issue;
  for (const section of answer.sections) {
    if (typeof section?.text !== 'string' || !section.text.trim() || !Array.isArray(section.citations) || section.citations.length > 3) {
      issue ??= 'malformed_citations';
      continue;
    }
    if (strict && !section.citations.length) issue ??= 'missing_citations';
    for (const citation of section.citations) {
      const id = citation?.id;
      if (typeof id === 'string' && /^[NW][0-9]{1,3}$/.test(id)) ids.add(id);
      const source = registry.get(id);
      if (!source) { issue ??= 'unknown_source_id'; continue; }
      const quote = typeof citation.quote === 'string' ? whitespace(citation.quote) : '';
      if (quote.length < 20 || !whitespace(source.excerpt).includes(quote)) {
        issue ??= 'unsupported_quote';
        continue;
      }
      if(verifyRelevance){
        const claim=keywords(section.text);
        const support=keywords(quote);
        const shared=[...claim].filter(word=>support.has(word)).length;
        if(shared<Math.min(2,claim.size)||quantities(section.text).some(value=>!whitespace(source.excerpt).toLowerCase().includes(value.toLowerCase()))){
          issue ??= 'unrelated_evidence';
          continue;
        }
      }
      references.set(id, source);
    }
    sections.push(section.text.trim());
  }
  if (issue) return { issue, hasText: sections.length > 0 || answer.sections.some(section=>typeof section?.text==='string'&&section.text.trim()), ids:[...ids] };
  return { explanation:sections.join('\n\n'), sources:[...references.values()], ids:[...ids] };
}
