import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as hub from '../docs/hub-sync.js';
import * as cards from '../docs/cards.js';
import * as model from '../docs/model.js';
import * as calendar from '../docs/calendar.js';
import * as repo from '../docs/repository-v2.js';
const row=(id,time='2026-10-15T00:00:00Z')=>({listingId:id,updatedAt:time});
test('empty browser preserves remote entries',()=>assert.equal(hub.mergeManifest({listings:[row('a')]},[]).listings.length,1));
test('independent additions merge and older state cannot overwrite newer',()=>{
 const result=hub.mergeManifest({listings:[row('a','2026-10-16')]},[row('a'),row('b')]);
 assert.equal(result.listings.length,2);assert.equal(result.listings[0].updatedAt,'2026-10-16');
});
test('persistent tombstones prevent resurrection',()=>{
 const deleted=hub.mergeManifest({listings:[row('a')]},[],['a']);
 assert.equal(hub.mergeManifest(deleted,[row('a')]).listings.length,0);
});
test('reload preserves unsent task and listing but not unrelated stale data',()=>{
 const local={items:[{id:'pending'}, {id:'stale'}],outbox:[{id:'task',payload:{itemId:'pending'}}],newDraft:{raw:'draft'}};
 const value=hub.retainPendingState({items:[]},local);
 assert.deepEqual(value.items.map(x=>x.id),['pending']);assert.equal(value.outbox.length,1);assert.equal(value.newDraft.raw,'draft');
});
function harness(){
 const files=new Map(),requests=[],active=new Set();
 const root={addEventListener(){},innerHTML:''};
 const context=vm.createContext({...hub,...cards,...model,...calendar,...repo,console,structuredClone,crypto:webcrypto,TextEncoder,TextDecoder,AbortController,URLSearchParams,Blob,
 document:{getElementById:()=>root},window:{addEventListener(){}},location:{hash:''},setTimeout:()=>0,clearTimeout(){},
 btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
 saveState:async()=>{},readPhotoMedia:async(id,photos)=>photos,cachePhotoMedia:async()=>{}});
 const response=(status,value)=>({ok:status>=200&&status<300,status,json:async()=>value});
 let version=0,conflict=false;
 context.fetch=async(url,options={})=>{
  const route=new URL(url).pathname,method=options.method||'GET';requests.push({route,method});
  if(route==='/user/repos')return response(201,{});
  if(method==='GET'){const entry=files.get(route);return response(entry?200:404,entry||{});}
  const repository=route.split('/contents/')[0];
  if(active.has(repository))return response(409,{});
  active.add(repository);await new Promise(resolve=>setImmediate(resolve));
  try{
   const body=JSON.parse(options.body),current=files.get(route);
   if(route.endsWith('/registry/listings.json')&&!conflict){
    conflict=true;files.set(route,{sha:'remote',content:Buffer.from(JSON.stringify({listings:[{listingId:'other',updatedAt:'2026-10-15'}]})).toString('base64'),encoding:'base64'});
    return response(409,{});
   }
   if((current?.sha)!==body.sha)return response(409,{});
   if(method==='DELETE'){files.delete(route);return response(200,{});}
   files.set(route,{sha:String(++version),content:body.content,encoding:'base64'});return response(200,{});
  }finally{active.delete(repository);}
 };
 let source=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\nboot\(\);\s*$/,'');
 source+='\n globalThis.api={syncListingProjection,sendMailboxEvent,syncRepositoryProjection,loadHubState,updateManifest,updateCalendarProjection,setup:s=>{state=s;mailboxConnection={repo:"owner/hub",accessKey:"test"}},state:()=>state};';
 vm.runInContext(source,context);
 return {api:context.api,files,requests};
}
test('actual dispatch stores media and listing before command, merges conflict, survives reload',async()=>{
 const h=harness(),record=model.normalItem({id:'new-id',title:'Test',status:'queue',updatedAt:'2026-10-15T12:00:00Z',photos:[1,2,3].map(id=>({id:String(id),src:'data:image/png;base64,YQ==',type:'image/png'}))});
 const task={id:'task',type:'item.created',createdAt:'2026-10-15T12:00:00Z',payload:{itemId:record.id,item:record},markers:{listingId:record.id}};
 const state={...model.blankState(),items:[record],outbox:[task]};
 h.api.setup(state);await h.api.sendMailboxEvent(task);
 const listingPaths=[...h.files.keys()].filter(x=>x.endsWith('/contents/listing.json'));assert.equal(listingPaths.length,1);
 const persisted=JSON.parse(Buffer.from(h.files.get(listingPaths[0]).content,'base64'));
 assert.equal(persisted.item.photos.length,3);
 for(const photo of persisted.item.photos)assert.ok(h.files.has(listingPaths[0].replace(/listing.json$/,photo.path)));
 const manifest=JSON.parse(Buffer.from(h.files.get('/repos/owner/hub/contents/registry/listings.json').content,'base64'));
 assert.deepEqual(manifest.listings.map(x=>x.listingId).sort(),['new-id','other']);
 const command=h.requests.findIndex(x=>x.method==='PUT'&&x.route.endsWith('-command.json'));
 assert.ok(command>h.requests.findIndex(x=>x.method==='PUT'&&x.route.endsWith('/listing.json')));
 await h.api.loadHubState();assert.ok(h.api.state().items.some(x=>x.id==='new-id'));assert.equal(h.api.state().outbox.length,1);
});
test('empty device cannot overwrite full listings or registry',async()=>{
 const h=harness();h.api.setup(model.blankState());await h.api.updateManifest([row('a')]);await h.api.syncRepositoryProjection({state:model.blankState()});
 const m=JSON.parse(Buffer.from(h.files.get('/repos/owner/hub/contents/registry/listings.json').content,'base64'));
 assert.ok(m.listings.some(x=>x.listingId==='a'));
 assert.equal(h.requests.filter(x=>x.method==='PUT'&&x.route.endsWith('/listing.json')).length,0);
});

test('pending local calendar operation merges with a fresh remote calendar',()=>{
 const remote={items:[],slots:[{id:'remote-slot',date:'2027-03-01',from:'10:00',to:'11:00',updatedAt:'2026-10-16T10:00:00Z'}],bookings:[],calendarRevision:2};
 const local={items:[],outbox:[{id:'operation',type:'calendar.slot.opened',markers:{}}],slots:[{id:'local-slot',date:'2027-03-02',from:'10:00',to:'11:00',updatedAt:'2026-10-16T10:01:00Z'}],bookings:[],calendarAppliedOperationIds:['operation']};
 const merged=hub.retainPendingState(remote,local);
 assert.deepEqual(merged.slots.map(value=>value.id).sort(),['local-slot','remote-slot']);
 assert.ok(merged.calendarAppliedOperationIds.includes('operation'));
});

test('published and archived folders are exclusive and preserve canonical photos',async()=>{
 const h=harness(),item=model.normalItem({id:'status-test',status:'ready',photos:[]});
 h.api.setup({...model.blankState(),items:[item]});
 for(const status of ['ready','published','archived','ready']){
  item.status=status;item.updatedAt=new Date().toISOString();await h.api.syncListingProjection(item);
  const markers=[...h.files.keys()].filter(path=>path.includes('/states/'));
  assert.equal(markers.length,1);assert.ok(markers[0].includes('/states/'+status+'/'));
  const canonical=[...h.files.entries()].find(([path])=>path.endsWith('/contents/listing.json'));
  assert.equal(JSON.parse(Buffer.from(canonical[1].content,'base64')).item.status,status);
 }
});
