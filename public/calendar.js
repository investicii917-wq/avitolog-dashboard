export const CALENDAR_SCHEMA_VERSION=2;
export const MOSCOW_TIME_ZONE='Europe/Moscow';
export function validDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;
 const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
export function moscowDate(now=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:MOSCOW_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function moscowMinutes(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:MOSCOW_TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now),value=type=>Number(parts.find(part=>part.type===type)?.value||0);
 return value('hour')*60+value('minute');
}
export function clockMinutes(value){if(!/^\d{2}:\d{2}$/.test(String(value||'')))return NaN;const [hour,minute]=value.split(':').map(Number);return hour<24&&minute<60?hour*60+minute:NaN;}
export function clockValue(value){return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');}
export function activeBooking(booking){return ['held','scheduled','confirmed'].includes(booking?.status);}
export function timestamp(value,fallback=0){const result=Date.parse(value||'');return Number.isFinite(result)?result:fallback;}
export function slotTime(slot){return timestamp(slot?.updatedAt||slot?.createdAt);}
export function bookingTime(booking){return timestamp(booking?.updatedAt||booking?.createdAt);}
export function futureSlot(date,from,now=new Date()){const today=moscowDate(now);return date>=today&&(date!==today||clockMinutes(from)>=moscowMinutes(now));}
export function assertSlot(slot,{now=new Date()}={}){
 if(!validDate(slot?.date))throw Error('Укажите существующую дату');const from=clockMinutes(slot.from),to=clockMinutes(slot.to);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)throw Error('Время окончания должно быть позже начала');if(!futureSlot(slot.date,slot.from,now))throw Error('Нельзя открыть прошедшее время');return {...slot,kind:slot.kind==='delivery'?'delivery':'pickup'};
}
export function rangesOverlap(left,right){return left.from<right.to&&right.from<left.to;}
export function freeStarts(slots,bookings,slot,item,{now=new Date()}={}){
 const duration=Math.max(30,Math.round(Number(item?.pickupMinutes)||30)),from=clockMinutes(slot?.from),to=clockMinutes(slot?.to),result=[];if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return result;
 for(let current=from;current+duration<=to;current+=15){if(!futureSlot(slot.date,clockValue(current),now))continue;const candidate={from:current,to:current+duration};if(!(bookings||[]).some(booking=>activeBooking(booking)&&booking.date===slot.date&&rangesOverlap(candidate,{from:clockMinutes(booking.from),to:clockMinutes(booking.to)})))result.push(clockValue(current));}return result;
}
export function calendarDocument(state,now=new Date()){return {schema:'avitolog.calendar.v2',schemaVersion:CALENDAR_SCHEMA_VERSION,timezone:MOSCOW_TIME_ZONE,revision:Number(state?.calendarRevision||0),updatedAt:now.toISOString(),slots:structuredClone(state?.slots||[]),bookings:structuredClone(state?.bookings||[]),slotTombstones:structuredClone(state?.calendarSlotTombstones||[]),bookingTombstones:structuredClone(state?.calendarBookingTombstones||[]),appliedOperationIds:[...(state?.calendarAppliedOperationIds||[])].slice(-2000)};}
function newestById(values,time){const map=new Map();for(const value of values||[]){if(!value?.id)continue;const old=map.get(value.id);if(!old||time(value)>=time(old))map.set(value.id,value);}return map;}
function tombstoneMap(values){return newestById(values,value=>timestamp(value?.deletedAt||value?.updatedAt));}
function mergeRows(remote,local,tombstones,time){const entries=newestById([...(remote||[]),...(local||[])],time),deleted=tombstoneMap(tombstones);for(const [id,tombstone] of deleted){const entry=entries.get(id);if(!entry||timestamp(tombstone.deletedAt||tombstone.updatedAt)>=time(entry))entries.delete(id);}return [...entries.values()];}
function resolveBookingConflicts(bookings,now){const acceptedByDate=new Map();return [...(bookings||[])].sort((left,right)=>timestamp(left.createdAt||left.updatedAt)-timestamp(right.createdAt||right.updatedAt)||String(left.id).localeCompare(String(right.id))).map(booking=>{if(!activeBooking(booking))return booking;const range={from:clockMinutes(booking.from),to:clockMinutes(booking.to)},accepted=acceptedByDate.get(booking.date)||[];if(!Number.isFinite(range.from)||!Number.isFinite(range.to)||range.to<=range.from||accepted.some(other=>rangesOverlap(range,{from:clockMinutes(other.from),to:clockMinutes(other.to)})))return {...booking,status:'conflict',conflictReason:'overlapping calendar operation',updatedAt:now.toISOString()};accepted.push(booking);acceptedByDate.set(booking.date,accepted);return booking;});}
function comparable(value){return JSON.stringify({slots:value?.slots||[],bookings:value?.bookings||[],slotTombstones:value?.slotTombstones||value?.calendarSlotTombstones||[],bookingTombstones:value?.bookingTombstones||value?.calendarBookingTombstones||[],appliedOperationIds:value?.appliedOperationIds||value?.calendarAppliedOperationIds||[]});}
export function mergeCalendar(remote,local,now=new Date()){
 const source=remote?.schemaVersion===CALENDAR_SCHEMA_VERSION?remote:{...remote,schemaVersion:CALENDAR_SCHEMA_VERSION,timezone:MOSCOW_TIME_ZONE},slotTombstones=[...(source.slotTombstones||[]),...(local.slotTombstones||local.calendarSlotTombstones||[])],bookingTombstones=[...(source.bookingTombstones||[]),...(local.bookingTombstones||local.calendarBookingTombstones||[])];
 const slots=mergeRows(source.slots,local.slots,slotTombstones,slotTime),bookings=resolveBookingConflicts(mergeRows(source.bookings,local.bookings,bookingTombstones,bookingTime),now),appliedOperationIds=[...new Set([...(source.appliedOperationIds||[]),...(local.appliedOperationIds||local.calendarAppliedOperationIds||[])])].slice(-2000);
 const result={schema:'avitolog.calendar.v2',schemaVersion:CALENDAR_SCHEMA_VERSION,timezone:MOSCOW_TIME_ZONE,revision:Number(source.revision||0),updatedAt:source.updatedAt||now.toISOString(),slots,bookings,slotTombstones:[...tombstoneMap(slotTombstones).values()],bookingTombstones:[...tombstoneMap(bookingTombstones).values()],appliedOperationIds};
 if(comparable(source)===comparable(result))return result;
 return {...result,revision:Number(source.revision||0)+1,updatedAt:now.toISOString()};
}
export function calendarChanged(left,right){return comparable(left)!==comparable(right);}