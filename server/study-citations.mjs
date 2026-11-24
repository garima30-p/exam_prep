const whitespace = text => text.trim().replace(/\s+/g, ' ');

const insignificant=new Set('from that this these those have with will also when into which what should recall question explain answer about more some each must their there other they does such example section could would definition'.split(' '));
const keywords=text=>new Set((text.toLowerCase().match(/[a-z]{4,}/g)??[]).map(word=>word.replace(/(?:ing|ed|s)$/,'')).filter(word=>word.length>=3&&!insignificant.has(word)));
const quantities=text=>text.match(/\b\d+(?:\.\d+)?\s*(?:ms|seconds?|minutes?|kb|mb|gb|%)(?![a-z])/gi)??[];

// Only explicit, testable contradictions trigger a failed check.
const opposingClaims=[
  [/\b(?:only one|at most one|one (?:process|thread) at a time)\b.{0,100}\bcritical section\b/i,
   /\b(?:two|multiple|more than one) (?:processes|threads)\b.{0,50}\b(?:enter|execute|run|be)\b.{0,40}\bcritical section\b.{0,30}\b(?:at (?:the same time|once)|simultaneously|concurrently)\b/i],
  [/\b(?:wait|P\(\))\b.{0,45}\bdecrements?\b.{0,60}\bsemaphore\b/i,
   /\bwait\b.{0,45}\bincrements?\b.{0,60}\bsemaphore\b/i],
];
export function contradictsReference(claim,excerpt){
 return opposingClaims.some(([reference,opposite])=>reference.test(excerpt)&&opposite.test(claim)&&
   !/\b(?:cannot|can not|never|must not|does not|do not|prevents?|forbids?)\b/i.test(claim));
}
export function missingCriticalSectionConditions(question,answer,sources){
 if(!/\bcritical section\b/i.test(question)||!/\b(?:requirements|conditions|criteria)\b/i.test(question))return false;
 const reference=[...sources].map(source=>source.excerpt).join(' ');
 const concepts=[
  /\bmutual exclusion\b|\bonly one (?:process|thread) at a time\b/i,
  /\bprogress\b|\b(?:cannot|must not) be postponed indefinitely\b/i,
  /\bbounded waiting\b|\blimit (?:on|to) (?:the number|how many)\b/i,
 ];
 return concepts.every(concept=>concept.test(reference))&&!concepts.every(concept=>concept.test(answer));
}
const claimKey=text=>whitespace(text).toLowerCase().replace(/^[#*\s]+|[.!?*\s]+$/g,'');
const equivalentClaim=(claim,quote)=>claimKey(claim)===claimKey(quote);

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
  const citationMap=[];
  let issue;
  let supportedSections=0;
  let reviewedSections=0;
  for (const section of answer.sections) {
    if (typeof section?.text !== 'string' || !section.text.trim() || !Array.isArray(section.citations) || section.citations.length > 3) {
      issue ??= 'malformed_citations';
      continue;
    }
    if (strict && !section.citations.length) issue ??= 'missing_citations';
    const usedIds=new Set();
    let supported=false;
    let reviewed=false;
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
      if(contradictsReference(section.text,source.excerpt)){
        issue ??= 'contradicted_reference';
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
      supported=true;
      usedIds.add(id);
      reviewed ||= equivalentClaim(section.text,quote);
      const linked=references.get(id);
      const supportingQuotes=[...new Set([...(linked?.supportingQuotes??[]),quote])];
      references.set(id, {...source,supportingQuote:supportingQuotes[0],supportingQuotes});

    }
    if(supported)supportedSections++;
    if(reviewed)reviewedSections++;
    if(usedIds.size)citationMap.push({section:sections.length+1,sourceIds:[...usedIds]});
    sections.push(section.text.trim());
  }
  if (issue) return { issue, hasText: sections.length > 0 || answer.sections.some(section=>typeof section?.text==='string'&&section.text.trim()), ids:[...ids] };
  const evidenceStatus=!supportedSections?'no_supporting_source':supportedSections===sections.length?'source_backed':'partially_source_backed';
  return {explanation:sections.join('\n\n'),sources:[...references.values()],ids:[...ids],evidenceStatus,citationMap,
    validationStatus:reviewedSections===sections.length?'reviewed_against_references':'not_independently_checked'};

}
