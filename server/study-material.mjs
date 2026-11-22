export function administrativeLine(value) {
  return /^\s*(?:[|\d.\s]*CO\s*[0-9Il]+\b|category\s+of\s+course\b|(?:course|program(?:me)?)\s+outcomes?\b|course\s+(?:coordinator|objectives?|description)\b|(?:learning|program(?:me)? specific)\s+outcomes?\b|(?:maximum|total)\s+marks\b|(?:exam duration|time allowed|semester|academic year|name of (?:student|candidate))\s*:|department\s+of\b|academic\s+regulations?\b|course\s+(?:code|credits?)\b|L\s*\|\s*T\s*\|\s*P\b)/i.test(value);
}

export const administrativeSection=line=>/^\s*(?:(?:course|program(?:me)?|learning) outcomes?|course objectives?)\s*:?\s*$/i.test(line);
export const syllabusUnit=line=>/^\s*(?:unit|module)\s*[-–]?\s*([1-9][0-9]?|i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*[-–:.]?\s*(.*)/i.exec(line);
export const syllabusContentsHeading=line=>/^\s*(?:\d{1,2}\s*[.)]\s*)?(?:details of the course|course (?:content|contents|outline)|syllabus)\s*:?\s*$/i.test(line);
export const syllabusEnd=line=>/^\s*(?:\d{1,2}\s*[.)]\s*)?(?:text(?:books?| and reference books)|reference books|mode of evaluation|assessment scheme|total hours)\b/i.test(line);
