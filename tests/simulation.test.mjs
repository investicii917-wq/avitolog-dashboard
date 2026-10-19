import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDocument,freeStarts,mergeCalendar} from '../docs/calendar.js';

function random(seed){let value=seed>>>0;return ()=>{value=(value*1664525+1013904223)>>>0;return value/4294967296;};}
function dateAt(offset){const value=new Date(Date.UTC(2027,0,1+offset));return value.toISOString().slice(0,10);}
function localFrom(document){const bookings=structuredClone(document.bookings||[]),byDate=new Map();for(const booking of bookings){const values=byDate.get(booking.date)||[];values.push(booking);byDate.set(booking.date,values);}return {slots:structuredClone(document.slots||[]),bookings,calendarSlotTombstones:structuredClone(document.slotTombstones||[]),calendarBookingTombstones:structuredClone(document.bookingTombstones||[]),calendarAppliedOperationIds:structuredClone(document.appliedOperationIds||[]),byDate};}
function assertNoOverlap(bookings){
 const active=(bookings||[]).filter(value=>['held','scheduled','confirmed'].includes(value.status));
 for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
  if(active[i].date!==active[j].date)continue;
  const [a,b]=[active[i],active[j]].map(value=>value.from.split(':').reduce((total,part,index)=>total+Number(part)*(index?1:60),0));
  const [c,d]=[active[i],active[j]].map(value=>value.to.split(':').reduce((total,part,index)=>total+Number(part)*(index?1:60),0));
  assert.ok(!(a<d&&b<c), 'active bookings overlap: '+JSON.stringify([active[i],active[j]]));
 }
}
test('six-month calendar simulation: 100 listings, 3000 operations, two offline devices',()=>{
 for(const seed of [17,29,41]){
  const next=random(seed), slots=Array.from({length:181},(_,index)=>({id:'slot-'+index,date:dateAt(index),from:'09:00',to:'21:00',kind:'pickup',updatedAt:'2026-10-16T00:00:00.000Z'}));
  let remote={schema:'avitolog.calendar.v2',schemaVersion:2,timezone:'Europe/Moscow',revision:1,updatedAt:'2026-10-16T00:00:00.000Z',slots,bookings:[],slotTombstones:[],bookingTombstones:[],appliedOperationIds:[]};
  let deviceA=localFrom(remote),deviceB=localFrom(remote),sequence=0,created=0,cancelled=0;
  // 3000 операций достаточно для проверки слияния на шести месяцах, но тест
  // остаётся быстрым и пригодным для проверки перед выпуском.
  for(let step=0;step<3000;step++){
   const device=next()<.5?deviceA:deviceB, slot=slots[Math.floor(next()*slots.length)], stamp=new Date(Date.UTC(2026,9,16,0,0,sequence++)).toISOString();
   const active=(device.byDate.get(slot.date)||[]).filter(value=>['held','scheduled','confirmed'].includes(value.status));
   if(next()<.63){
    const starts=freeStarts([slot],active,slot,{pickupMinutes:[30,60,90,360][Math.floor(next()*4)]},{now:new Date('2026-10-16T00:00:00.000Z')});
    if(starts.length){const from=starts[Math.floor(next()*starts.length)],duration=[30,60,90,360][Math.floor(next()*4)],minute=Number(from.slice(0,2))*60+Number(from.slice(3));const to=String(Math.floor((minute+duration)/60)).padStart(2,'0')+':'+String((minute+duration)%60).padStart(2,'0');const booking={id:'b-'+seed+'-'+step,operationId:'op-'+seed+'-'+step,listingId:'listing-'+(step%100),date:slot.date,from,to,status:next()<.35?'held':'scheduled',createdAt:stamp,updatedAt:stamp};device.bookings.push(booking);(device.byDate.get(slot.date)||device.byDate.set(slot.date,[]).get(slot.date)).push(booking);device.calendarAppliedOperationIds.push('op-'+seed+'-'+step);created++;}
   } else if(active.length){const booking=active[Math.floor(next()*active.length)];booking.status='cancelled';booking.updatedAt=stamp;cancelled++;}
   if(step%100===0){remote=mergeCalendar(remote,device,new Date(stamp));const refreshed=localFrom(remote);if(device===deviceA)deviceA=refreshed;else deviceB=refreshed;}
  }
  remote=mergeCalendar(remote,deviceA,new Date('2026-10-17T00:00:00.000Z'));
  remote=mergeCalendar(remote,deviceB,new Date('2026-10-17T00:01:00.000Z'));
  assert.equal(remote.slots.length,181);
  assert.ok(created>250);assert.ok(cancelled>20);
  assert.equal(new Set(remote.appliedOperationIds).size,remote.appliedOperationIds.length);
  assertNoOverlap(remote.bookings);
  assert.equal(new Set(remote.bookings.map(value=>value.id)).size,remote.bookings.length);
 }
});
