import test from 'node:test';
import assert from 'node:assert/strict';
import * as calendar from '../docs/calendar.js';
const now=new Date('2026-10-16T09:00:00Z');
test('calendar validates real dates and Moscow future time',()=>{assert.equal(calendar.validDate('2028-02-29'),true);assert.equal(calendar.validDate('2027-02-29'),false);assert.throws(()=>calendar.assertSlot({date:'2027-02-29',from:'12:00',to:'13:00'},{now}));assert.throws(()=>calendar.assertSlot({date:'2026-10-16',from:'11:00',to:'12:00'},{now}));assert.doesNotThrow(()=>calendar.assertSlot({date:'2026-10-16',from:'13:00',to:'14:00'},{now}));});
test('calendar allows adjacent meetings but never overlaps a hold or meeting',()=>{const slot={id:'slot',date:'2026-10-17',from:'10:00',to:'12:00'},item={pickupMinutes:30},bookings=[{id:'held',date:'2026-10-17',from:'10:30',to:'11:00',status:'held'}];assert.deepEqual(calendar.freeStarts([slot],bookings,slot,item,{now}),['10:00','11:00','11:15','11:30']);});
test('calendar merge preserves independent device updates and deletion tombstones',()=>{const remote={schemaVersion:2,revision:2,slots:[{id:'a',date:'2026-11-01',from:'10:00',to:'11:00',updatedAt:'2026-10-16T10:00:00Z'}],bookings:[]},local={slots:[{id:'b',date:'2026-11-02',from:'10:00',to:'11:00',updatedAt:'2026-10-16T10:01:00Z'}],bookings:[],calendarSlotTombstones:[{id:'a',deletedAt:'2026-10-16T10:02:00Z'}]},merged=calendar.mergeCalendar(remote,local,now);assert.deepEqual(merged.slots.map(value=>value.id),['b']);assert.equal(merged.revision,3);});
test('calendar merge is idempotent for repeated operation identifiers',()=>{const value=calendar.mergeCalendar({slots:[],bookings:[],appliedOperationIds:['op-1']},{slots:[],bookings:[],calendarAppliedOperationIds:['op-1']},now);assert.deepEqual(value.appliedOperationIds,['op-1']);});
test('calendar merge is idempotent after a confirmed write',()=>{
 const remote={schemaVersion:2,revision:4,slots:[{id:'s',date:'2027-01-01',from:'10:00',to:'11:00',updatedAt:'2026-10-16T10:00:00Z'}],bookings:[],slotTombstones:[],bookingTombstones:[],appliedOperationIds:['op']};
 const merged=calendar.mergeCalendar(remote,{slots:remote.slots,bookings:remote.bookings,calendarSlotTombstones:[],calendarBookingTombstones:[],calendarAppliedOperationIds:['op']},new Date('2026-10-16T12:00:00Z'));
 assert.equal(merged.revision,4);
 assert.equal(calendar.calendarChanged(remote,merged),false);
});

test('calendar resolves simultaneous offline reservations without double booking',()=>{
 const remote={schemaVersion:2,revision:1,slots:[],bookings:[],slotTombstones:[],bookingTombstones:[],appliedOperationIds:[]};
 const a={slots:[],bookings:[{id:'a',date:'2027-02-01',from:'10:00',to:'11:00',status:'held',createdAt:'2026-10-16T10:00:00Z',updatedAt:'2026-10-16T10:00:00Z'}]};
 const b={slots:[],bookings:[{id:'b',date:'2027-02-01',from:'10:30',to:'11:30',status:'scheduled',createdAt:'2026-10-16T10:01:00Z',updatedAt:'2026-10-16T10:01:00Z'}]};
 const merged=calendar.mergeCalendar(calendar.mergeCalendar(remote,a),b);
 assert.deepEqual(merged.bookings.map(value=>value.status),['held','conflict']);
});
