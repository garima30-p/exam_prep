// Only catalog labels may leave the Worker as automatic search terms.
const groups=[
 ['operating systems',['deadlock prevention','deadlock avoidance',"banker’s algorithm",'deadlock','page replacement','fifo','lru','virtual memory','paging','segmentation','process scheduling','semaphore','mutex','race condition','thrashing','process synchronization']],
 ['databases',['database normalization','normalization','functional dependency','third normal form','bcnf','acid properties','serializability','sql joins','database indexing','transactions','er diagram']],
 ['computer networks',['tcp congestion control','tcp','udp','osi model','subnetting','dns','routing','flow control','http','network address translation']],
 ['data structures and algorithms',['binary search tree','binary search','dijkstra','dynamic programming','breadth first search','depth first search','merge sort','quick sort','hash table','time complexity','linked list']],
 ['mathematics',['bayes theorem','eigenvalues','eigenvectors','matrix multiplication','binomial distribution','normal distribution','differentiation','integration','linear regression']],
 ['machine learning',['gradient descent','backpropagation','decision tree','overfitting','logistic regression','support vector machine','k means','transformer','attention mechanism']],
 ['physics',['newton’s laws','thermodynamics','entropy','ohm’s law','electromagnetic induction','quantum mechanics']],
 ['chemistry',['chemical equilibrium','periodic table','covalent bond','acid base titration','oxidation and reduction']],
 ['biology',['photosynthesis','cellular respiration','meiosis','mitosis','natural selection','mendelian inheritance']],
];
const normalize=text=>text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const catalog=groups.flatMap(([subject,concepts])=>concepts.map(concept=>({subject,concept:normalize(concept)})))
 .sort((a,b)=>b.concept.length-a.concept.length);
const ordinals=['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth'];
const rewrite=/^(?:(?:can|could) you |please )?(?:make (?:it|that|this|the preceding|the previous)|shorten|summarize (?:it|that|this|the last)|translate|rephrase|explain (?:it|that|this)(?: again| in)|give me an example)/i;
const casual=/^(?:hi|hey|hello|good (?:morning|afternoon|evening)|thanks|thank you)[!. ]*$/i;
const factual=/\b(?:what|why|how|explain|define|describe|compare|difference|conditions|meaning|steps|sources|references|examples?|theorem|formula)\b/i;

export function coachTopic(question,topics,lastQuestion=''){
 if(casual.test(question)||rewrite.test(question)||/\b(?:something|anything) unrelated\b/i.test(question))return {searchTopic:'',skipRetrieval:true};
 const ordinal=normalize(question).match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|[1-9][0-9]?(?:st|nd|rd|th)) topic\b|\btopic (\d{1,2})\b/);
 const position=ordinal?(ordinal[2]?Number(ordinal[2]):ordinals.includes(ordinal[1])?ordinals.indexOf(ordinal[1])+1:parseInt(ordinal[1],10)):0;
 if(position&&!topics[position-1])return {needsClarification:true};
 const text=position?topics[position-1]:question;
 const containsConcept=(input,concept)=>(' '+normalize(input)+' ').includes(' '+concept+' ');
 const match=catalog.find(({concept})=>containsConcept(text,concept));
 const followup=!match&&factual.test(question)&&/\b(?:it|that|this|the conditions|the steps|the formula)\b/i.test(question);
 const topic=match??(followup?catalog.find(({concept})=>containsConcept(lastQuestion,concept)):null);
 const searchTopic=topic&&(position||factual.test(question)||normalize(text)===topic.concept)
  ?topic.subject+' '+topic.concept+' explanation':'';
 return {searchTopic,selectedTopic:position?text:''};
}
