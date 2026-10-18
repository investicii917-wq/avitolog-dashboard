import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as cards from '../docs/cards.js';
import * as model from '../docs/model.js';
import {mergeManifest} from '../docs/hub-sync.js';
import {taskDocument} from '../docs/repository-v2.js';
let checks=0;
const check=(ok)=>{assert.ok(ok);checks++;};
for(const style of ['realistic','studio','designer'])for(const format of ['auto','landscape','portrait'])for(const count of [1,3,10]){
 const record=model.normalItem({id:'x',status:'queue',generateCards:true,cardStyle:style,cardFormat:format,cardCount:count});
 const spec=cards.cardSpec(record);
 check(spec.style===style&&spec.count===count&&spec.format===format);
 check(JSON.parse(JSON.stringify(record)).cardStyle===style);
}
const legacy=model.normalItem({id:'old',status:'ready'});
check(legacy.cardFormat==='auto'&&legacy.cardStyle==='realistic');
check(cards.cardSpec(legacy).count===0);
check(model.normalItem({id:'legacy-pickup',status:'ready',pickupMinutes:0}).pickupMinutes===60);
const base=model.normalItem({id:'x',status:'queue',raw:'Клавиатура',description:'Описание для карточки',defects:'Внутренняя заметка',generateCards:true,cardStyle:'designer',cardFormat:'landscape',cardCount:3,photos:[{id:'src',type:'image/png',src:'data:image/png;base64,YQ==',name:'original.png'}],sourcePhotos:[{id:'src',type:'image/png',src:'data:image/png;base64,YQ==',name:'original.png'}]});
base.cardRequestKey=cards.cardRequestKey(base);
check(cards.cardRequestKey(structuredClone(base))===base.cardRequestKey);
for(const change of [{cardFormat:'portrait'},{cardStyle:'studio'},{cardCount:2},{raw:'Другой факт'},{description:'Новое описание'},{sourcePhotos:[{id:'other'}]}])check(cards.cardRequestKey({...base,...change})!==base.cardRequestKey);
check(cards.cardRequestKey({...base,defects:'Другая закрытая заметка'})===base.cardRequestKey);
const photos=[1,2,3].map(n=>({id:'p'+n,file:'20261013-p'+n+'.png',width:n===1?1200:1600,height:1200}));
const result={itemId:base.id,requestKey:base.cardRequestKey,style:'designer',aspectRatio:'4:3',photos};
check(cards.cardResultProblem(base,result)===null);
for(const change of [{requestKey:'old'},{style:'studio'},{aspectRatio:'3:4'},{photos:photos.slice(1)},{photos:photos.map(p=>({...p,width:1599}))},{photos:photos.map(p=>({...p,id:'same'}))}])check(!!cards.cardResultProblem(base,{...result,...change}));
check(!!cards.cardResultProblem({...base,generateCards:false},result));

const fakeRoot={addEventListener(){}};
const context=vm.createContext({...cards,...model,mergeManifest,taskDocument,crypto:webcrypto,console,structuredClone,Date,Map,Set,TextEncoder,TextDecoder,AbortController,Blob,
 btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
 setTimeout:()=>0,clearTimeout(){},URLSearchParams,
 document:{getElementById:()=>fakeRoot},window:{addEventListener(){}},location:{hash:''},
 saveState:async()=>{},readState:async()=>model.blankState()});
let source=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\nboot\(\);\s*$/,'');
const galleryStyles=fs.readFileSync(new URL('../docs/style.css',import.meta.url),'utf8');
check(!source.includes('track.style.height='));
check(galleryStyles.includes('Постоянный квадратный экран карточек')&&galleryStyles.includes('Фикс: каждая карточка полностью помещается'));
source+='\nstate=blankState();\nglobalThis.testApi={cardsHtml,mailboxManifest,applyMailboxEvent,sendMailboxEvent,restoreMailboxPhotos,connect:(c)=>{mailboxConnection=c},prepareCardRequest,decodeMailboxJson,readMailboxJson,availableImageHistory,cardInputItem};';
vm.runInContext(source,context);
const api=context.testApi;
const html=api.cardsHtml(base);
check(html.includes('value="designer" checked'));
check(html.includes('value="landscape" checked'));
check(html.includes('value="3"'));
const processorItem=api.cardInputItem(base);
const event={id:'test-event',type:'cards.requested',createdAt:'2026-10-13T10:00:00Z',payload:{item:processorItem,sourcePhotos:base.sourcePhotos,itemId:base.id,...cards.cardSpec(base),requestKey:base.cardRequestKey},markers:{cards:cards.cardSpec(base)}};
const manifest=JSON.parse(api.mailboxManifest(event,['test-photo.png']));
check(manifest.payload.style==='designer'&&manifest.payload.sourcePhotos[0].file==='test-photo.png');
check(!('defects' in manifest.payload.item));
check(!JSON.stringify(manifest).includes('data:image'));
const memoryRepo=new Map(),puts=[];
context.fetch=async(url,options={})=>{
 if(url==='https://api.github.com/user/repos'&&options.method==='POST')return {ok:true,status:201,json:async()=>({})};
 const path=decodeURIComponent(url.split('/contents/')[1]||'');
  if(!path&&!options.method)return {ok:true,status:200,json:async()=>[]};
 if(options.method==='PUT'){
  const body=JSON.parse(options.body);memoryRepo.set(path,body.content);puts.push(path);return {ok:true,status:201};
 }
 const content=memoryRepo.get(path);
 return {ok:!!content,status:content?200:404,json:async()=>({content,sha:'mock-sha'}),arrayBuffer:async()=>Uint8Array.from(Buffer.from(content,'base64')).buffer};
};
api.connect({repo:'test/private-mailbox',accessKey:'test-only-not-a-secret'});
await api.sendMailboxEvent(event);
check(puts.some(path=>path.endsWith('.png'))&&puts.some(path=>path.startsWith('tasks/in/')&&path.endsWith('.json')));
const received=[...memoryRepo.values()].flatMap(value=>{try{return [JSON.parse(Buffer.from(value,'base64').toString('utf8'))];}catch{return [];}}).find(value=>value.input?.payload?.requestKey===base.cardRequestKey)?.input;
check(received?.payload?.requestKey===base.cardRequestKey&&received?.markers?.cards?.style==='designer');
check(!!received?.payload?.sourcePhotos?.[0]?.file);
// Separate state represents another device. No browser credentials or real listings involved.
const second=model.blankState();second.items.push(structuredClone(base));
const loaded=photos.map(p=>({...p,mediaPath:'images/generated/test/'+p.file,path:'images/generated/test/'+p.file,src:'data:image/png;base64,YQ=='}));
api.applyMailboxEvent(second,{type:'cards.completed',createdAt:'2026-10-13T10:01:00Z',payload:result},loaded);
check(second.items[0].photos.length===3&&second.items[0].cardRequestStatus==='completed');
check(second.items[0].sourcePhotos[0].id==='src');
check(api.availableImageHistory(second.items[0])[0].id==='all-images');
api.applyMailboxEvent(second,{type:'cards.comment',payload:{itemId:base.id,comment:{id:'photo-note',text:'Не менять цвет',createdAt:'2026-10-13T10:02:00Z'}}});
check(second.items[0].cardComments[0].text==='Не менять цвет');
check(second.items[0].status==='queue');
const saved=JSON.stringify(second);
api.applyMailboxEvent(second,{type:'cards.completed',payload:{...result,requestKey:'obsolete'}},loaded);
check(JSON.stringify(second)===saved);
const third=second;
check(third.items[0].cardStyle==='designer'&&third.items[0].cardFormat==='landscape'&&third.items[0].photos[0].mediaPath&&third.items[0].imageHistory[0].photos[0].mediaPath);
const cleanManifest=JSON.parse(api.mailboxManifest({...event,payload:{...event.payload,item:{...base,sourcePhotos:base.photos}}},['original.png']));
check(!JSON.stringify(cleanManifest).includes('data:image'));
  const createdManifest=JSON.parse(api.mailboxManifest({...event,type:'item.created',payload:{item:{...base,imageHistory:[{id:'history',photos:base.photos}]}}},['original.png']));
  check(!JSON.stringify(createdManifest).includes('data:image'));
context.fetch=async(url,options)=>({ok:true,text:async()=>JSON.stringify({big:true,text:'x'.repeat(1100000)})});
const large=await api.decodeMailboxJson('state/site-state.json',{encoding:'none',content:''});
check(large.big&&large.text.length===1100000);
const small=await api.decodeMailboxJson('state/site-state.json',{encoding:'base64',content:Buffer.from(JSON.stringify({small:true})).toString('base64')});
check(small.small);
context.fetch=async()=>({ok:false,status:503});
await assert.rejects(()=>api.decodeMailboxJson('state/site-state.json',{content:''}));checks++;
const unchanged=structuredClone(base),prior=second.items[0];
api.prepareCardRequest(unchanged,prior);
check(unchanged.cardRequestKey===prior.cardRequestKey);
const changed={...structuredClone(base),raw:'Другой текст',generatedCards:{quality:'approved'}};
const prepared=api.prepareCardRequest(changed,prior);
check(prepared.signature!==prepared.previous&&changed.cardRequestStatus==='requested'&&changed.generatedCards===null);
console.log(JSON.stringify({passed:true,checks,transport:'in-memory GitHub Contents API; separate device state',liveGitHub:false}));

