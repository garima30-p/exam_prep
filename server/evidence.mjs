const weights={recurrence:40,marks:20,syllabus:20,breadth:10,preparationTime:5,recency:5};

export function scorePriority(components) {
  return Math.round((10+Object.entries(weights).reduce((sum,[key,weight])=>sum+weight*(components[key]??0),0))*100);
}

export function initialMinutes(marks) {
  return marks>=10?30:marks>=5?20:15;
}
