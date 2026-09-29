import ExcelJS from 'exceljs';
import type { Assignment, EventData, Interval, ValidationResult } from '../core/types';
import { clockOf, dateOf, splitByDay, toMinute } from '../core/time';
import { validateEvent } from '../core/validate';

export type ReportKind='full'|'person'|'location'|'program'|'changed';
export interface ReportOptions { kind?:ReportKind; personIds?:string[]; locationId?:string; roleId?:string; date?:string; range?:Interval; internal?:boolean; }
export interface Report {title:string;headers:string[];rows:(string|number)[][];totalMinutes:number;validation:ValidationResult;generatedAt:string;statusLabel:string;}
export function changedPeople(event:EventData):string[] {
  const previous=event.snapshots.at(event.status==='confirmed'?-2:-1)?.data;
  if(!previous)return event.people.map(p=>p.id);
  const signature=(assignments:Assignment[],id:string)=>JSON.stringify(assignments.filter(a=>a.personId===id).map(a=>[a.start,a.end,a.locationId,a.roleId,a.locked]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const display=(list:EventData['people'],id:string)=>{const p=list.find(p=>p.id===id);return p?`${p.name}|${p.alias}|${p.team}`:'';};
  const programSignature=(list:EventData['programs'],id:string)=>JSON.stringify(list.filter(p=>p.dedicated&&p.personId===id).map(p=>[p.start,p.end,p.locationId,p.title]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  return [...new Set([...previous.people.map(p=>p.id),...event.people.map(p=>p.id)])].filter(id=>signature(previous.assignments,id)!==signature(event.assignments,id)||display(previous.people,id)!==display(event.people,id)||programSignature(previous.programs,id)!==programSignature(event.programs,id));
}
export function statusLabel(event:EventData,validation=validateEvent(event)):string {
  if(validation.errors.length)return '수정 필요 초안';
  if(validation.shortageMinutes>0||validation.shortages.some(s=>s.leaderMissing>0))return '미완성 초안';
  return event.status==='confirmed'?'확정':event.status==='archived'?'보관':'초안';
}
function rangeFor(options:ReportOptions):Interval|undefined {
  if(options.range)return options.range;
  if(options.date){const start=toMinute(options.date,'00:00');return {start,end:start+1440};}
  return undefined;
}
function selectedPeople(event:EventData,options:ReportOptions):string[]|undefined {return options.kind==='changed'?changedPeople(event).filter(id=>options.personIds===undefined||options.personIds.includes(id)):options.personIds;}
function historicalPerson(event:EventData,id:string){return event.people.find(p=>p.id===id)??[...event.snapshots].reverse().flatMap(s=>s.data.people).find(p=>p.id===id);}
function scoped(event:EventData,options:ReportOptions):EventData {
  const range=rangeFor(options), selected=selectedPeople(event,options);
  const keep=(a:Assignment)=> (selected===undefined||selected.includes(a.personId))&&(!options.locationId||a.locationId===options.locationId)&&(!options.roleId||a.roleId===options.roleId)&&(!range||(a.start<range.end&&a.end>range.start));
  const assignments=event.assignments.filter(keep).filter(()=>options.kind!=='changed'||!!selected?.length).map(a=>range?{...a,start:Math.max(a.start,range.start),end:Math.min(a.end,range.end)}:a);
  const programs=event.programs.filter(p=>!options.roleId&&(selected===undefined||selected.includes(p.personId))&&(!options.locationId||p.locationId===options.locationId)&&(!range||(p.start<range.end&&p.end>range.start))).filter(()=>options.kind!=='changed'||!!selected?.length).map(p=>range?{...p,start:Math.max(p.start,range.start),end:Math.min(p.end,range.end)}:p);
  return {...event,assignments,programs};
}
export function buildReport(event:EventData,options:ReportOptions={}):Report {
  const kind=options.kind||'full',validation=validateEvent(event), selected=scoped(event,options),range=rangeFor(options);
  const person=(id:string)=>{const p=historicalPerson(event,id);return p?`${p.name}${p.alias?` (${p.alias})`:''}${event.people.some(current=>current.id===id)?'':' · 현재 명단에서 삭제됨'}`:'삭제된 참여자';};
  const location=(id:string)=>event.locations.find(l=>l.id===id)?.name||'미지정', role=(id:string)=>event.roles.find(r=>r.id===id)?.name||'미지정';
  const result:Report={title:({full:'전체 인력 배치표',person:'개인별 일정표',location:'장소·역할별 운영표',program:'행사 진행 시간표',changed:'변경된 사람 일정표'})[kind],headers:[],rows:[],totalMinutes:0,validation,generatedAt:new Date().toISOString(),statusLabel:statusLabel(event,validation)};
  if(kind==='program') {
    result.headers=['날짜','시작','종료 날짜','종료','제목','장소','담당자','담당 유형','공개 메모',...(options.internal?['운영자 메모']:[])];
    result.rows=selected.programs.flatMap(p=>splitByDay(p.start,p.end).map(part=>[part.date,clockOf(part.start),dateOf(part.end),clockOf(part.end),p.title,location(p.locationId),p.personId?person(p.personId):'',p.dedicated?'해당 시간 전담':'연락 담당',p.publicNote,...(options.internal?[p.internalNote]:[])]));
    result.totalMinutes=Object.values(validateEvent({...selected,assignments:[]}).personMinutes).reduce((sum,n)=>sum+n,0);
  } else {
    result.headers=['참여자 ID','이름','소속/팀','날짜','시작','종료 날짜','종료','장소','역할','배정 분','잠금'];
    const rows=[...selected.assignments].sort((a,b)=>kind==='person'||kind==='changed'?a.personId.localeCompare(b.personId)||a.start-b.start:kind==='location'?a.locationId.localeCompare(b.locationId)||a.start-b.start:a.start-b.start||a.locationId.localeCompare(b.locationId));
    result.rows=rows.flatMap(a=>splitByDay(a.start,a.end).map(part=>[a.personId,person(a.personId),event.people.find(p=>p.id===a.personId)?.team||'',part.date,clockOf(part.start),dateOf(part.end),clockOf(part.end),location(a.locationId),role(a.roleId),part.minutes,a.locked?'잠금':'']));
    selected.programs.filter(p=>p.dedicated&&p.personId).forEach(p=>splitByDay(p.start,p.end).forEach(part=>result.rows.push([p.personId,person(p.personId),event.people.find(person=>person.id===p.personId)?.team||'',part.date,clockOf(part.start),dateOf(part.end),clockOf(part.end),location(p.locationId),`전담 진행: ${p.title}`,part.minutes,'진행표'])));
    // Use shared validation totals for the exact filtered assignments rather than a separate time algorithm.
    const selectedValidation=validateEvent(selected);
    result.totalMinutes=Object.values(selectedValidation.personMinutes).reduce((sum,n)=>sum+n,0);
    if(kind==='person'||kind==='changed'){
      const ids=selectedPeople(event,options)??event.people.map(p=>p.id);
      for(const id of ids)if(!result.rows.some(r=>r[0]===id))result.rows.push([id,person(id),historicalPerson(event,id)?.team||'','','','','','','배정 없음',0,'']);
    }
  }
  return result;
}

/** ExcelJS string values are stored as strings, never formula objects. CSV also guards leading control characters. */
export function safeCsvCell(value:unknown):string {
  let s=String(value??'');if(/^[\s\u0000-\u001f]*[=+\-@]/.test(s))s=`'${s}`;
  return `"${s.replace(/"/g,'""')}"`;
}
export function toCsv(rows:unknown[][]):string {return '\uFEFF'+rows.map(row=>row.map(safeCsvCell).join(',')).join('\r\n');}

export async function createWorkbook(event:EventData,options:ReportOptions={}):Promise<Blob> {
  const wb=new ExcelJS.Workbook();wb.creator='행사 시간표 제작기';wb.created=new Date();
  const validation=validateEvent(event), main=buildReport(event,options);
  const add=(name:string,headers:string[],rows:(string|number)[][])=>{
    const sheet=wb.addWorksheet(name);sheet.addRow(headers);sheet.addRows(rows);sheet.views=[{state:'frozen',ySplit:1}];
    sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF205548'}};
    sheet.columns.forEach((c,i)=>{c.width=Math.max(14,Math.min(36,(headers[i]?.length||10)*2+2));});
    sheet.eachRow(row=>{row.eachCell(cell=>{if(typeof cell.value==='string')cell.numFmt='@';cell.alignment={vertical:'middle',wrapText:true};});});
    sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(sheet.rowCount,1),column:headers.length}};
    sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'};
    return sheet;
  };
  add('행사정보',['항목','내용'],[['행사명',event.name],['기관',event.organization],['행사 ID',event.id],['시간대',event.timezone],['버전',event.edition],['상태',main.statusLabel],['생성 시각',main.generatedAt],['출력 종류',main.title],['날짜 범위',options.date||'전체'],['선택 참여자',options.personIds?.join(', ')||'전체'],['내부용 항목',options.internal?'운영자 메모 포함':'미포함'],['안내','배포용 출력입니다. 편집 재개는 별도 JSON 전체 백업을 사용하세요.'],['합계 단위','분 (자정 넘김은 실제 날짜 기준으로 분할)']]);
  const full=buildReport(event,{...options,kind:options.kind==='changed'?'changed':'full'});add('전체 배치',full.headers,full.rows);
  const personal=buildReport(event,{...options,kind:options.kind==='changed'?'changed':'person'});add('개인별 배치',personal.headers,personal.rows);
  const filtered=scoped(event,options), totals=validateEvent(filtered);
  const allowed=selectedPeople(event,options)??event.people.map(p=>p.id);
  const rows:(string|number)[][]=[];
  allowed.forEach(id=>{const p=historicalPerson(event,id);if(!p)return;rows.push([p.id,p.name,'전체',totals.personMinutes[p.id]||0]);Object.entries(totals.dailyMinutes[p.id]||{}).sort().forEach(([date,mins])=>rows.push([p.id,p.name,date,mins]));});
  add('시간 합계',['참여자 ID','이름','날짜','합계 분'],rows);
  add('부족·주의',['종류','시작','종료','내용'],[...validation.errors.map(i=>['오류',i.start!==undefined?`${dateOf(i.start)} ${clockOf(i.start)}`:'',i.end!==undefined?`${dateOf(i.end)} ${clockOf(i.end)}`:'',i.message]),...validation.warnings.map(i=>['주의','','',i.message]),...validation.shortages.map(s=>['부족',`${dateOf(s.start)} ${clockOf(s.start)}`,`${dateOf(s.end)} ${clockOf(s.end)}`,`${event.locations.find(l=>l.id===s.locationId)?.name||s.locationId} / ${event.roles.find(r=>r.id===s.roleId)?.name||s.roleId}: 필요 ${s.needed}, 배정 ${s.assigned}, 부족 ${s.missing}, 책임자 부족 ${s.leaderMissing}. ${s.reason}`])]);
  const secondarySource=options.kind==='changed'?scoped(event,options):event;
  const program=buildReport(secondarySource,{...options,kind:'program'});add('행사 진행표',program.headers,program.rows);
  const loc=buildReport(secondarySource,{...options,kind:'location'});add('장소별 운영',loc.headers,loc.rows);
  return new Blob([await wb.xlsx.writeBuffer() as ArrayBuffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function downloadBlob(blob:Blob,filename:string):void {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename.replace(/[\\/:*?"<>|]/g,'_');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
