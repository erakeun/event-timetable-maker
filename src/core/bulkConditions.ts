import type { EventData, Person } from './types';
export const conditionLabels = {maxDaily:'하루 최대 배정',maxTotal:'행사 전체 최대 배정',maxContinuous:'최대 연속 배정',minBreak:'최소 휴게'} as const;
export type ConditionKey = keyof typeof conditionLabels;
export type ConditionValues = Partial<Record<ConditionKey,number>>;
export function planConditions(event:EventData,ids:string[],values:ConditionValues,overwrite=false) {
  const keys=(Object.keys(conditionLabels) as ConditionKey[]).filter(k=>values[k]!==undefined);
  for(const key of keys)if(!Number.isSafeInteger(values[key])||values[key]!<0)throw new Error('시간 조건은 0 이상의 정수 분으로 입력하세요.');
  const changes:{id:string;name:string;key:ConditionKey;before:number|undefined;after:number}[]=[];
  const kept:{id:string;key:ConditionKey}[]=[];
  for(const person of event.people.filter(p=>ids.includes(p.id)))for(const key of keys){
    if(person[key]!==undefined&&!overwrite){kept.push({id:person.id,key});continue;}
    if(person[key]!==values[key])changes.push({id:person.id,name:person.name,key,before:person[key],after:values[key]!});
  }
  return {changes,kept,people:event.people.filter(p=>ids.includes(p.id))};
}
export function applyConditions(event:EventData,ids:string[],values:ConditionValues,overwrite=false):EventData {
  const plan=planConditions(event,ids,values,overwrite);
  return {...event,people:event.people.map(person=>{
    const patch:Partial<Person>={};
    for(const change of plan.changes.filter(c=>c.id===person.id))patch[change.key]=change.after;
    return {...person,...patch};
  })};
}
