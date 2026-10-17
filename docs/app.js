import {mergeManifest,retainPendingState} from './hub-sync.js?v=1';
import {installPhotoSort} from './photo-sort.js?v=2';
import {CARD_STYLES,normalizeCardStyle,normalizeCardFormat,cardSpec,cardRequestKey,cardResultProblem} from './cards.js?v=4';

import {readState,saveState,readPhotoMedia,cachePhotoMedia} from './data.js?v=11';
import {uid,todayKey,normalItem,receiveEvent,addSlot,addBooking,freeTimes,dayLoad,minutes,blankState} from './model.js?v=16';
import {calendarDocument,calendarChanged,mergeCalendar,CALENDAR_SCHEMA_VERSION} from './calendar.js?v=2';
import {REPOSITORY_SCHEMA,PAGE_SIZE,indexPath,indexRow,listingPaths,mediaDocument,splitPages,taskDocument} from './repository-v2.js?v=2';
const root=document.getElementById('app');
const CONNECTION_KEY='avitolog-mailbox-connection-v1';
let state,unlocked=false,mailboxConnection=null,draft=null,galleryIndex=0,toastTimer,photoBusy=false,photoSortSuppressClick=false,commitQueue=Promise.resolve(),mailboxSyncing=false,mailboxSyncTimer,mailboxResultSyncing=false,mailboxResultTimer,mailboxStateTimer,mailboxStateSyncing=false,mailboxStateFailed=false,calendarReturnPath='/analytics',repositoryProjectionHash='';
const SITE_REFRESH_INTERVAL=5*60*1000,PROCESSED_FILE_LIMIT=1500;
const icons={
 back:'<path d="m15 5-7 7 7 7"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h.01M12 15h.01M17 15h.01"/>',
 photo:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 6-5 4 3 3-3 5 5"/>',
 next:'<path d="m9 5 7 7-7 7"/>',edit:'<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/>',
 comment:'<path d="M20 14a3 3 0 0 1-3 3H9l-5 4V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3zM8 8h8M8 12h5"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
 heart:'<path d="M12 20 4 12a5 5 0 0 1 8-6 5 5 0 0 1 8 6z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 box:'<path d="m3 7 9-4 9 4v11l-9 4-9-4zM3 7l9 4 9-4M12 11v11M7 5l9 4"/>'
};
const icon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+(icons[name]||icons.box)+'</svg>';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plural=(n,one,few,many)=>n+' '+(n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many);
const money=n=>n==null?'Цена не указана':new Intl.NumberFormat('ru-RU').format(n)+' ₽';
const statusName={queue:'Ожидает обработки',ready:'Готово к публикации',published:'Опубликовано',sold:'Продано',archived:'В архиве'};
const item=id=>state.items.find(x=>x.id===id);
const mediaSrc=photo=>photo?.src||photo?.preview||'';
const samePhoto=(a,b)=>!!((a.id&&b.id&&a.id===b.id)||(a.path&&b.path&&a.path===b.path)||(a.file&&b.file&&a.file===b.file)||([a.src,a.preview].filter(Boolean).some(value=>value===b.src||value===b.preview)));
const activeCardPhotos=record=>record?.sourcePhotos?.length?record.sourcePhotos:(record?.photos||[]);
const photoIds=photos=>(photos||[]).map(photo=>photo.id).join('|');
const samePhotos=(left,right)=>photoIds(left)===photoIds(right);
function rememberPhotoSet(record,photos,label,kind){
 const saved=structuredClone(photos||[]);
 if(!saved.length)return;
 record.imageHistory??=[];
 if(record.imageHistory.some(group=>photoIds(group.photos)===photoIds(saved)))return;
 record.imageHistory.unshift({id:uid(),label,kind,createdAt:new Date().toISOString(),photos:saved});
}
function rememberImageSet(record,label,kind){rememberPhotoSet(record,record.photos,label,kind);}
function archiveCurrentPhotos(record){
 const known=new Set([...(record.sourcePhotos||[]),...(record.imageHistory||[]).flatMap(group=>group.photos||[])].map(photo=>photo.id));
 const missing=(record.photos||[]).filter(photo=>!known.has(photo.id));
 if(missing.length)rememberPhotoSet(record,missing,'Все фотографии','library');
}
function availableImageHistory(record){
 archiveCurrentPhotos(record);
 const groups=[...(record.imageHistory||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 const seen=new Set(),photos=[];
 for(const photo of [...groups.flatMap(group=>group.photos||[]),...(record.sourcePhotos||[])]){
  const key=photo.id||mediaSrc(photo);if(!key||seen.has(key)||photos.some(saved=>samePhoto(saved,photo)))continue;seen.add(key);photos.push(photo);
 }
 return [{id:'all-images',photos}];
}

function cardInputItem(record){
 const copy=structuredClone(record);
 copy.photos=structuredClone(activeCardPhotos(record));
 delete copy.sourcePhotos;delete copy.imageHistory;delete copy.defects;
 return copy;
}
const shortDate=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
const fullDate=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long'});
const stamp=d=>new Date(d).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const route=()=>{const [path,query='']=(location.hash.slice(1)||'/analytics').split('?');return {path,parts:path.split('/').filter(Boolean),params:new URLSearchParams(query)};};
function go(path){if(location.hash==='#'+path)render();else location.hash=path;}
function toast(message){clearTimeout(toastTimer);const el=document.getElementById('notifications');el.innerHTML='<div class="toast">'+esc(message)+'</div>';toastTimer=setTimeout(()=>el.innerHTML='',4200);}
async function commit(transform){const job=commitQueue.then(async()=>{const next=await transform(state);await saveState(next);state=next;queueMailboxSync(250);queueMailboxStateSync(3000);return state;});commitQueue=job.catch(()=>{});return job;}
function queueMailboxSync(delay=250){clearTimeout(mailboxSyncTimer);mailboxSyncTimer=setTimeout(()=>{void syncMailbox();},delay);}
function queueMailboxResultSync(delay=0){clearTimeout(mailboxResultTimer);mailboxResultTimer=setTimeout(()=>{void syncMailboxResults();},delay);}
function queueMailboxStateSync(delay=3000){clearTimeout(mailboxStateTimer);mailboxStateTimer=setTimeout(()=>{void syncMailboxState();},delay);}
const utcStamp=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getUTCFullYear()+p(d.getUTCMonth()+1)+p(d.getUTCDate())+p(d.getUTCHours())+p(d.getUTCMinutes())+p(d.getUTCSeconds());};
const randomPart=()=>crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7,'0');
const mailboxEvent=(type,payload,markers={})=>{const id=uid(),operationId=markers.operationId||(type.startsWith('calendar.')?id:null);return {schema:'avitolog.mailbox.v1',id,type,operationId,createdAt:new Date().toISOString(),payload:operationId?{...payload,operationId}:payload,markers:{origin:'site',...markers,operationId}};};
const rememberCalendarOperation=(s,operationId)=>{if(!operationId)return true;s.calendarAppliedOperationIds??=[];if(s.calendarAppliedOperationIds.includes(operationId))return false;s.calendarAppliedOperationIds=[...s.calendarAppliedOperationIds,operationId].slice(-2000);return true;};
const addOutbox=(s,type,payload,markers={})=>{const event=mailboxEvent(type,payload,markers);if(type.startsWith('calendar.'))rememberCalendarOperation(s,event.operationId);s.outbox.push(event);return s;};
const listingMarkers=(record,action)=>({action,listingId:record.id,cards:cardSpec(record)});
const textBase64=value=>{const bytes=new TextEncoder().encode(value);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);};
const dataUriBase64=value=>String(value||'').replace(/^data:[^;]+;base64,/,'');
const mailboxPath=path=>'https://api.github.com/repos/'+mailboxConnection.repo.split('/').map(encodeURIComponent).join('/')+'/contents'+(path?'/'+path.split('/').map(encodeURIComponent).join('/'):'' );
async function mailboxRequest(path,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 try{return await fetch(mailboxPath(path),{...options,cache:'no-store',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+mailboxConnection.accessKey,...(options.headers||{})},signal:controller.signal});}
 finally{clearTimeout(timeout);}
}
function fileExtension(photo){const type=String(photo.type||'').toLowerCase();if(type.includes('png'))return 'png';if(type.includes('webp'))return 'webp';if(type.includes('gif'))return 'gif';return 'jpg';}
function cardJob(task,payload,photos){
 const cards=cardSpec({generateCards:true,cardStyle:payload.style,cardFormat:payload.format,cardCount:payload.count});
 return {contractVersion:4,taskId:task.id,listingId:payload.itemId||task.markers?.listingId||null,intent:'cards.generate',
  style:{code:cards.style,label:cards.styleLabel,baseStyle:cards.baseStyle||cards.style},
  series:{requestedCount:cards.count,formatCode:cards.format,formatLabel:cards.formatLabel,aspectRatio:cards.aspectRatio,aspectRatioPolicy:cards.aspectRatioPolicy,coverAspectRatio:'1:1',uniformAspectRatio:false},
  source:{photoIds:photos.map(photo=>photo.id),attachments:photos.map(photo=>({photoId:photo.id,file:photo.file||null,type:photo.type})),factsSource:'listing.description-only'},
  resultRequirements:{styleCode:cards.style,exactCount:cards.count,coverAspectRatio:'1:1',oneAspectRatioForRemainingCards:true,echoRequestKey:payload.requestKey,returnPhotoIds:true}};
}
function mailboxManifest(task,attachmentNames){
 const payload=structuredClone(task.payload||{}),photos=task.type==='cards.requested'?payload?.sourcePhotos:payload?.item?.photos;
 const manifestPhotos=Array.isArray(photos)?photos.map((photo,index)=>({id:photo.id,name:photo.name||('photo-'+(index+1)),type:photo.type||'image/jpeg',file:attachmentNames[index]||null})):[];
 if(task.type==='cards.requested'){
  payload.sourcePhotos=manifestPhotos;if(payload.item)payload.item.photos=manifestPhotos;
  payload.cardJob=cardJob(task,payload,manifestPhotos);
 }
 else if(Array.isArray(photos))payload.item.photos=manifestPhotos;
  if(payload.item){delete payload.item.sourcePhotos;delete payload.item.imageHistory;}
 return JSON.stringify({schema:'avitolog.mailbox.v1',id:task.id,type:task.type,createdAt:task.createdAt,payload,markers:task.markers||{},attachments:attachmentNames},null,2);
}
function putMailboxFile(path,content,message,options={}){return queueRepositoryWrite(mailboxConnection.repo,()=>putMailboxFileNow(path,content,message,options));}
const repositoryWrites=new Map();
function queueRepositoryWrite(repo,operation){
 const previous=repositoryWrites.get(repo)||Promise.resolve();
 const next=previous.catch(()=>{}).then(operation);
 repositoryWrites.set(repo,next);
 return next;
}
async function updateManifest(rows,deletedIds=[]){
 return queueRepositoryWrite(mailboxConnection.repo,async()=>{
  for(let attempt=0;attempt<5;attempt++){
   const response=await mailboxRequest('registry/listings.json');
   if(!response.ok&&response.status!==404)throw Error('Не удалось прочитать реестр: '+response.status);
   const file=response.ok?await response.json():null;
   const remote=file?await decodeMailboxJson('registry/listings.json',file):{};
   const next=mergeManifest(remote,rows,deletedIds);
   if(JSON.stringify(remote.listings||[])===JSON.stringify(next.listings)&&JSON.stringify(remote.deletedListingIds||[])===JSON.stringify(next.deletedListingIds))return remote;
   const saved=await mailboxRequest('registry/listings.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Merge listing index safely',content:textBase64(JSON.stringify(next,null,2)),...(file?{sha:file.sha}:{})})});
   if(saved.ok)return next;
   if(saved.status!==409&&saved.status!==422)throw Error('Не удалось обновить реестр: '+saved.status);
  }
  throw Error('Реестр занят. Отправка будет повторена.');
 });
}
async function putMailboxFileNow(path,content,message,{ifMissing=false}={}){
 for(let attempt=0;attempt<5;attempt++){
 const current=await mailboxRequest(path),body={message,content};
 if(current.ok){const existing=await current.json();if(ifMissing)return false;if(existing.content&&existing.encoding==='base64'&&String(existing.content).replace(/\s/g,'')===String(content).replace(/\s/g,''))return false;if(existing.sha)body.sha=existing.sha;}
 else if(current.status!==404)throw Error('Не удалось проверить очередь');
 const response=await mailboxRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if([409,422].includes(response.status)&&attempt<4)continue;
 if(!response.ok)throw Error('Не удалось передать данные в очередь');
 return true;
 }
}
const mailboxJson=(path,value,message,options={})=>putMailboxFile(path,textBase64(JSON.stringify(value,null,2)),message,options);
const compactIds=values=>[...new Set(values||[])].slice(-PROCESSED_FILE_LIMIT);
const itemTime=item=>Date.parse(item?.updatedAt||item?.processedAt||item?.archivedAt||item?.createdAt||0)||0;
function mergeById(remote,local){
 const merged=new Map();
 for(const entry of [...(remote||[]),...(local||[])]){
  if(!entry?.id)continue;
  const old=merged.get(entry.id);
  if(!old||itemTime(entry)>=itemTime(old))merged.set(entry.id,entry);
 }
 return [...merged.values()];
}
function resetMailboxState(current,resetAt){
 const clean=blankState();
 return {...clean,version:current?.version||clean.version,mailboxResetAt:resetAt};
}
function mergeMailboxStates(remote,local){
 const resetAt=remote?.mailboxResetAt;
 if(resetAt&&Date.parse(resetAt)>Date.parse(local?.mailboxResetAt||0))return resetMailboxState(local,resetAt);
 const deleted=compactIds([...(remote?.deletedMailboxItemIds||[]),...(local?.deletedMailboxItemIds||[])]);
 const remoteItems=new Map((remote?.items||[]).map(value=>[value.id,value])),localItems=new Map((local?.items||[]).map(value=>[value.id,value]));
 const items=mergeById(remote?.items,local?.items).filter(x=>!deleted.includes(x.id)).map(value=>{
  const remoteItem=remoteItems.get(value.id)||{},localItem=localItems.get(value.id)||{};
  const sourceCandidates=[value.sourcePhotos,remoteItem.sourcePhotos,localItem.sourcePhotos].filter(Array.isArray),sourcePhotos=sourceCandidates.find(photos=>photos.some(mediaSrc))||sourceCandidates.find(photos=>photos.length)||[];
  const groups=[],seen=new Set();for(const group of [...(value.imageHistory||[]),...(localItem.imageHistory||[]),...(remoteItem.imageHistory||[])]){const photos=Array.isArray(group?.photos)?group.photos:[],key=group.id||photoIds(photos);if(!key||seen.has(key)||!photos.length)continue;seen.add(key);groups.push({...group,photos:structuredClone(photos)});}
  return normalItem({...value,sourcePhotos,imageHistory:groups.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))});
 });
 const analytics=itemTime(local?.analytics)>=itemTime(remote?.analytics)?(local?.analytics||remote?.analytics):(remote?.analytics||local?.analytics);
 return {...remote,...local,version:state?.version||local?.version||remote?.version,items,slots:mergeById(remote?.slots,local?.slots),bookings:mergeById(remote?.bookings,local?.bookings),outbox:mergeById(remote?.outbox,local?.outbox),deletedMailboxItemIds:deleted,importedMailboxInbox:compactIds([...(remote?.importedMailboxInbox||[]),...(local?.importedMailboxInbox||[])]),processedMailboxResults:compactIds([...(remote?.processedMailboxResults||[]),...(local?.processedMailboxResults||[])]),analytics:analytics||{updatedAt:null,period:null,source:null},newDraft:local?.newDraft||null,mailboxResetAt:remote?.mailboxResetAt||local?.mailboxResetAt||null};
}
const mediaReference=photo=>{const copy={...photo};delete copy.src;delete copy.preview;return copy;};
const hubOwner=()=>String(mailboxConnection?.repo||'').split('/')[0]||'';
const monthKey=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit'}).format(new Date());
const itemRepositoryName=record=>'item-'+String(record.id||'').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,48)+'-'+monthKey();
const repositoryPath=(repo,path='')=>'https://api.github.com/repos/'+String(repo).split('/').map(encodeURIComponent).join('/')+'/contents'+(path?'/'+path.split('/').map(encodeURIComponent).join('/'):'');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const itemRepositoryReady=new Map();

async function repositoryRequest(repo,path,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 try{return await fetch(repositoryPath(repo,path),{...options,cache:'no-store',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+mailboxConnection.accessKey,...(options.headers||{})},signal:controller.signal});}
 finally{clearTimeout(timeout);}
}
function putRepositoryFile(repo,path,content,message,options={}){return queueRepositoryWrite(repo,()=>putRepositoryFileNow(repo,path,content,message,options));}
async function putRepositoryFileNow(repo,path,content,message,{ifMissing=false}={}){
 for(let attempt=0;attempt<5;attempt++){
 const current=await repositoryRequest(repo,path),body={message,content};
 if(current.ok){const existing=await current.json();if(ifMissing)return false;if(existing.content&&existing.encoding==='base64'&&String(existing.content).replace(/\s/g,'')===String(content).replace(/\s/g,''))return false;if(existing.sha)body.sha=existing.sha;}
 else if(current.status!==404)throw Error('Не удалось проверить данные объявления');
 const response=await repositoryRequest(repo,path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if([409,422].includes(response.status)&&attempt<4){await pause(250*(attempt+1));continue;}
 if(!response.ok)throw Error('Не удалось сохранить данные объявления');
 return true;
 }
}
const repositoryJson=(repo,path,value,message,options={})=>putRepositoryFile(repo,path,textBase64(JSON.stringify(value,null,2)),message,options);

async function waitForItemRepository(target){
 for(let attempt=0;attempt<8;attempt++){
  const response=await repositoryRequest(target,'');
  if(response.ok)return;
  if(![404,409,422].includes(response.status))throw Error('Репозиторий объявления недоступен: '+response.status);
  await pause(Math.min(5000,400*2**attempt));
 }
 throw Error('Новый репозиторий объявления пока не готов. Отправка будет повторена автоматически.');
}
async function initializeItemRepository(record,target){
 await waitForItemRepository(target);
 await repositoryJson(target,'offers.json',{schemaVersion:1,listingId:record.id,offers:record.offers||[]},'Initialize offers',{ifMissing:true});
 await repositoryJson(target,'contacts.json',{schemaVersion:1,listingId:record.id,contacts:record.chats||[]},'Initialize contacts',{ifMissing:true});
 await repositoryJson(target,'tasks/in/.gitkeep',{},'Initialize task inbox',{ifMissing:true});
 await repositoryJson(target,'tasks/out/.gitkeep',{},'Initialize task outbox',{ifMissing:true});
 return target;
}
async function ensureItemRepository(record){
 let target=record?.itemRepository;
 if(!record?.id||!hubOwner())throw Error('Не удалось определить объявление');
 if(!target){
  target=hubOwner()+'/'+itemRepositoryName(record);
  const payload={name:target.split('/')[1],private:true,auto_init:true,description:'Avitolog listing '+record.id};
  let response=await fetch('https://api.github.com/user/repos',{method:'POST',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+mailboxConnection.accessKey,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok&&response.status===422)response=await repositoryRequest(target,'');
  if(!response.ok)throw Error('Не удалось создать репозиторий объявления. Для ключа нужны права Contents: Read and write и Repository creation: Write.');
  record.itemRepository=target;record.itemMonth=monthKey();record.itemLoaded=true;
 }
 let ready=itemRepositoryReady.get(target);
 if(!ready){ready=initializeItemRepository(record,target);itemRepositoryReady.set(target,ready);}
 try{return await ready;}catch(error){itemRepositoryReady.delete(target);throw error;}
}
async function removeItemRepository(record){
 if(!record?.itemRepository)return;
 const response=await fetch('https://api.github.com/repos/'+record.itemRepository,{method:'DELETE',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+mailboxConnection.accessKey}});
 if(!response.ok&&response.status!==404)throw Error('Не удалось удалить хранилище объявления. Объявление оставлено без изменений.');
}
async function itemSnapshotPhoto(record,photo,bucket,repo){
 if(!photo)return photo;
 const source=photo.src||photo.preview||'',id=String(photo.id||uid()),path=photo.mediaPath||photo.path||('images/'+bucket+'/'+id+'.'+fileExtension(photo));
 if(source.startsWith('data:'))await putRepositoryFile(repo,path,dataUriBase64(source),'Store listing media');
 return {...mediaReference(photo),mediaPath:path,path,src:null,preview:null};
}
async function itemDocument(record,repo){
 const copy=structuredClone(record);
 copy.photos=await Promise.all((copy.photos||[]).map(photo=>itemSnapshotPhoto(record,photo,record.generatedCards?'generated':'originals',repo)));
 copy.sourcePhotos=await Promise.all((copy.sourcePhotos||[]).map(photo=>itemSnapshotPhoto(record,photo,'originals',repo)));
 copy.imageHistory=await Promise.all((copy.imageHistory||[]).map(async group=>({...group,photos:await Promise.all((group.photos||[]).map(photo=>itemSnapshotPhoto(record,photo,group.kind==='generated'?'generated':'originals',repo)))})));
 return {schema:'avitolog.item.v1',schemaVersion:1,listingId:record.id,revision:record.revision||0,updatedAt:record.updatedAt||record.createdAt||new Date().toISOString(),item:copy};
}
async function syncStatusFolder(repo,document){
 const statuses=['queue','ready','published','archived','sold'],status=document.item.status;
 if(!statuses.includes(status))throw Error('Неизвестный статус объявления');
 await repositoryJson(repo,'states/'+status+'/listing.json',{schemaVersion:1,listingId:document.listingId,status,revision:document.revision,documentPath:'listing.json'},'Update status pointer');
 for(const other of statuses.filter(value=>value!==status)){
  const path='states/'+other+'/listing.json',response=await repositoryRequest(repo,path);
  if(response.status===404)continue;
  if(!response.ok)throw Error('Не удалось проверить предыдущий статус');
  const file=await response.json();
  const removed=await repositoryRequest(repo,path,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Remove previous status pointer',sha:file.sha})});
  if(!removed.ok&&removed.status!==404)throw Error('Перенос статуса будет повторён');
 }
}
async function syncListingProjection(record){
 if(!record?.id||record.itemLoaded===false)return null;
 const repo=await ensureItemRepository(record);
 await hydrateListingMedia(record,true);
 const document=await itemDocument(record,repo);
 await repositoryJson(repo,'listing.json',document,'Update listing');
 await syncStatusFolder(repo,document);
 await repositoryJson(repo,'offers.json',{schemaVersion:1,listingId:record.id,revision:record.revision||0,updatedAt:document.updatedAt,offers:record.offers||[]},'Update offers');
 await repositoryJson(repo,'contacts.json',{schemaVersion:1,listingId:record.id,revision:record.revision||0,updatedAt:document.updatedAt,contacts:record.chats||[]},'Update contacts');
 return {repo,document};
}
function hubListingRow(record,document){
 const photo=document?.item?.photos?.[0]||{};
 const activeOffer=(record.offers||[]).find(offer=>offer.status==='pending')||null;
 return {listingId:record.id,title:record.title,status:record.status,price:record.price,coverPath:photo.path||photo.mediaPath||null,itemRepository:record.itemRepository,revision:record.revision||0,updatedAt:record.updatedAt||record.createdAt||null,stats:record.stats||{},activeOffer:activeOffer?{id:activeOffer.id,price:activeOffer.price,buyer:activeOffer.buyer||'',createdAt:activeOffer.createdAt||null}:null};
}
let projectionQueue=Promise.resolve();
function syncRepositoryProjection(snapshot){
 const job=projectionQueue.catch(()=>{}).then(()=>syncRepositoryProjectionNow(snapshot));
 projectionQueue=job;return job;
}
async function updateCalendarProjection(source){
 const local=calendarDocument(source);
 for(let attempt=0;attempt<5;attempt++){
  const current=await mailboxRequest('calendar.json');
  let remote=null,sha=null;
  if(current.ok){const payload=await current.json();sha=payload.sha||null;remote=await decodeMailboxJson('calendar.json',payload);}
  else if(current.status!==404)throw Error('Не удалось проверить календарь');
  const merged=mergeCalendar(remote||{},local);
  if(remote?.schemaVersion===CALENDAR_SCHEMA_VERSION&&!calendarChanged(remote,merged))return remote;
  const body={message:'Update calendar',content:textBase64(JSON.stringify(merged,null,2))};if(sha)body.sha=sha;
  const written=await mailboxRequest('calendar.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(written.ok)return merged;
  if(![409,422].includes(written.status)||attempt===4)throw Error('Не удалось сохранить календарь');
 }
 throw Error('Не удалось сохранить календарь');
}
async function syncRepositoryProjectionNow(snapshot){
 const source=snapshot.state,deleted=source.deletedMailboxItemIds||[];
 const manifest=await readHubJson('registry/listings.json')||{};
 const tombstones=new Set([...(manifest.deletedListingIds||[]),...deleted]);
 const remoteRows=new Map((manifest.listings||[]).map(row=>[row.listingId,row]));
 const rows=[];
 for(const record of source.items||[]){
  if(tombstones.has(record.id)||record.itemLoaded===false)continue;
  const remote=remoteRows.get(record.id);
  if(remote&&itemTime(remote)>=itemTime(record))continue;
  const saved=await syncListingProjection(record);
  if(saved)rows.push(hubListingRow(record,saved.document));
 }
 await updateManifest(rows,deleted);
 const pending=(source.outbox||[]).filter(task=>!task.deliveredAt);
 if(pending.some(task=>task.type?.startsWith('calendar.')))await updateCalendarProjection(source);
}
async function writeTaskProjection(task,attachmentNames=[],repo=null){
 if(!task?.id)return;
 const listingId=task.markers?.listingId||task.payload?.itemId||task.payload?.item?.id||null;
 // В JSON задачи остаются только метаданные и имена вложений: тяжёлые data: URI сохранены отдельными файлами.
 const input=JSON.parse(mailboxManifest(task,attachmentNames)),document=taskDocument({taskId:task.id,listingId,baseRevision:item(listingId)?.revision||0,action:task.markers?.action||task.type,input,createdAt:task.createdAt});
 if(repo)await repositoryJson(repo,'tasks/in/'+task.id+'.json',document,'Queue listing task');
 else await mailboxJson('inbox/'+task.id+'.json',{taskId:task.id,listingId,type:task.type,createdAt:task.createdAt},'Queue hub task');
}async function readHubJson(path){
 const response=await mailboxRequest(path);if(response.status===404)return null;if(!response.ok)throw Error('Не удалось прочитать реестр');return decodeMailboxJson(path,await response.json());
}
async function loadHubState(){
 const manifest=await readHubJson('registry/listings.json');
 if(!manifest||!Array.isArray(manifest.listings))return;
 const clean=blankState();
 clean.deletedMailboxItemIds=manifest.deletedListingIds||[];
 clean.items=manifest.listings.map(row=>normalItem({id:row.listingId,status:row.status||'queue',title:row.title||'Новое объявление',price:row.price??null,photos:row.coverPath?[{id:'cover',path:row.coverPath,mediaPath:row.coverPath}]:[],stats:row.stats||{},offers:row.activeOffer?[row.activeOffer]:[],itemRepository:row.itemRepository||null,revision:row.revision||0,updatedAt:row.updatedAt||null,itemLoaded:false}));
 const calendar=await readHubJson('calendar.json');if(calendar){clean.slots=calendar.slots||[];clean.bookings=calendar.bookings||[];clean.calendarRevision=Number(calendar.revision||0);clean.calendarSlotTombstones=calendar.slotTombstones||[];clean.calendarBookingTombstones=calendar.bookingTombstones||[];clean.calendarAppliedOperationIds=calendar.appliedOperationIds||[];}
 const analytics=await readHubJson('analytics.json');if(analytics?.analytics)clean.analytics=analytics.analytics;
 const job=commitQueue.then(async()=>{state=retainPendingState(clean,state||blankState());await saveState(state);});commitQueue=job.catch(()=>{});await job;
}
async function syncMailboxState(loadOnly=false){
 if(mailboxStateSyncing||!state||!mailboxConnection?.repo||!mailboxConnection?.accessKey)return;
 mailboxStateSyncing=true;mailboxStateFailed=false;
 try{if(loadOnly){await loadHubState();return;}await syncRepositoryProjection({state,savedAt:new Date().toISOString()});}
 catch{mailboxStateFailed=true;queueMailboxStateSync(5000);}
 finally{mailboxStateSyncing=false;}
}
async function sendMailboxEvent(task){
 const listingId=task.markers?.listingId||task.payload?.itemId||task.payload?.item?.id,record=item(listingId)||task.payload?.item||null,repo=record?await ensureItemRepository(record):null,prefix=String(task.createdAt||new Date().toISOString()).replace(/\D/g,'').slice(0,14)+'-'+String(task.id).replace(/[^a-zA-Z0-9-]/g,''),photos=(task.type==='cards.requested'?task.payload?.sourcePhotos:(['item.created','item.edited'].includes(task.type)?task.payload?.item?.photos:[]))||[],attachmentNames=(photos||[]).map(()=>null);
 for(let index=0;index<photos.length;index++){
  const photo=photos[index],encoded=dataUriBase64(photo.src||photo.preview),extension=fileExtension(photo);if(!encoded)continue;
  const name=prefix+'-'+(index+1)+'-photo.'+extension;
  if(repo)await putRepositoryFile(repo,'tasks/in/'+name,encoded,'Add task attachment '+name);else await putMailboxFile('inbox/'+name,encoded,'Add attachment '+name);
  attachmentNames[index]=name;
 }
 if(record){
  const saved=await syncListingProjection(record);
  if(saved)await updateManifest([hubListingRow(record,saved.document)],state.deletedMailboxItemIds||[]);
 }
 if(repo)await writeTaskProjection(task,attachmentNames,repo);
 await mailboxJson('inbox/'+prefix+'-command.json',{schema:'avitolog.hub-command.v1',taskId:task.id,listingId:listingId||null,type:task.type,createdAt:task.createdAt,itemRepository:repo,taskPath:repo?'tasks/in/'+task.id+'.json':null},'Add hub command');
 await syncRepositoryProjection({state,savedAt:new Date().toISOString()});
}
async function syncMailbox(){
 if(mailboxSyncing||!state||!mailboxConnection?.repo||!mailboxConnection?.accessKey)return;
 mailboxSyncing=true;
 try{for(const task of state.outbox.filter(x=>!x.deliveredAt)){try{await sendMailboxEvent(task);}catch(error){mailboxStateFailed=true;toast('Объявление сохранено на устройстве. Отправка повторится: '+error.message);queueMailboxSync(10000);return;}await commit(s=>{const saved=s.outbox.find(x=>x.id===task.id);if(saved)saved.deliveredAt=new Date().toISOString();return s;});}}
 finally{mailboxSyncing=false;if(state?.outbox.some(x=>!x.deliveredAt))queueMailboxSync(10000);}
}
const base64Text=value=>{const binary=atob(String(value||'').replace(/\s/g,'')),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes);};
async function decodeMailboxJson(path,payload){
 if(payload.content&&payload.encoding!=='none')return JSON.parse(base64Text(payload.content));
 const raw=await mailboxRequest(path,{headers:{Accept:'application/vnd.github.raw+json'}});
 if(!raw.ok)throw Error('Не удалось прочитать большой файл');
 return JSON.parse(await raw.text());
}
async function readMailboxJson(folder,file){const path=folder+'/'+file.name,response=await mailboxRequest(path);if(!response.ok)throw Error('Не удалось прочитать файл очереди');return decodeMailboxJson(path,await response.json());}
const mediaType=photo=>photo.type||({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp'}[(String(photo.path||photo.file||'').split('.').pop()||'').toLowerCase()]||'image/jpeg');
async function restoreMailboxPhotos(folder,photos,repository=mailboxConnection?.repo){
 const restored=[];
 for(const photo of photos||[]){
  if(photo.src){restored.push(photo);continue;}
  const path=photo.path||[folder,photo.file].filter(Boolean).join('/');
  if(!path){restored.push(photo);continue;}
  if(path.startsWith('/')||path.includes('..')||!path.split('/').every(part=>/^[a-zA-Z0-9А-Яа-яЁё_. -]+$/.test(part)))throw Error('Некорректный путь фотографии');
  const response=repository===mailboxConnection?.repo
   ?await mailboxRequest(path,{headers:{Accept:'application/vnd.github.raw+json'}})
   :await repositoryRequest(repository,path,{headers:{Accept:'application/vnd.github.raw+json'}});
  if(!response.ok)throw Error('Не удалось загрузить фотографию. Повторим синхронизацию.');
  const bytes=await response.arrayBuffer();
  if(!bytes.byteLength)throw Error('Получена пустая фотография');
  restored.push({...photo,src:await fileData(new Blob([bytes],{type:mediaType(photo)}))});
 }
 return restored;
}async function decodeRepositoryJson(repo,path,payload){
 if(payload.content&&payload.encoding!=='none')return JSON.parse(base64Text(payload.content));
 const raw=await repositoryRequest(repo,path,{headers:{Accept:'application/vnd.github.raw+json'}});
 if(!raw.ok)throw Error('Не удалось прочитать данные объявления');
 return JSON.parse(await raw.text());
}
async function restoreSnapshotPhoto(photo,repo=mailboxConnection?.repo){
 const path=photo?.mediaPath||photo?.path;
 if(!path||mediaSrc(photo)||!repo)return photo;
 if(path.startsWith('/')||path.includes('..')||!path.split('/').every(part=>/^[a-zA-Z0-9А-Яа-яЁё_. -]+$/.test(part)))return photo;
 const response=await repositoryRequest(repo,path,{headers:{Accept:'application/vnd.github.raw+json'}});
 if(!response.ok)return photo;
 const bytes=await response.arrayBuffer();if(!bytes.byteLength)return photo;
 return {...photo,src:await fileData(new Blob([bytes],{type:mediaType(photo)})),preview:null};
}function markMailboxFile(s,folder,sha){
 const key=folder==='inbox'?'importedMailboxInbox':'processedMailboxResults';
 s[key]=compactIds([...(s[key]||[]),sha]);
}
function mergeRemoteItem(s,source,photos){
 if(!source?.id||s.deletedMailboxItemIds?.includes(source.id))return;
 const index=s.items.findIndex(x=>x.id===source.id),old=index>=0?s.items[index]:{};
 if(index>=0&&itemTime(old)>itemTime(source))return;
 const resolvedPhotos=photos?.length?photos:(source.photos||old.photos||[]);
 const next=normalItem({...old,...source,photos:resolvedPhotos,sourcePhotos:source.sourcePhotos?.length?(photos?.length?structuredClone(photos):source.sourcePhotos):(old.sourcePhotos||[])});
 next.imageHistory=[...(next.imageHistory||[]),...(old.imageHistory||[]).filter(group=>!(next.imageHistory||[]).some(value=>value.id===group.id))];rememberPhotoSet(next,old.photos,'Все фотографии','library');archiveCurrentPhotos(next);if(index>=0)s.items[index]=next;else s.items.unshift(next);
}
function applyMailboxEvent(s,event,photos=[]){
 const p=event?.payload||{},remote=p.item||(event?.type==='item.upsert'?p:null);
 if(event?.type==='cards.completed'){
  const record=s.items.find(x=>x.id===p.itemId),problem=cardResultProblem(record,{...p,photos:photos.length?photos:p.photos});
  if(problem)return;
  if(!photos.length||photos.some(p=>!p.src))throw Error('Файлы карточек ещё не получены');
  if(!record.sourcePhotos?.length)record.sourcePhotos=structuredClone(record.photos||[]);
  rememberImageSet(record,record.generatedCards?'Предыдущая серия карточек':'Исходные фотографии',record.generatedCards?'generated':'source');
  record.photos=photos.length?photos:p.photos;record.generatedCards={style:p.style,aspectRatio:p.aspectRatio,requestKey:p.requestKey,quality:p.quality||'review-required'};
  archiveCurrentPhotos(record);record.cardRequestStatus='completed';record.updatedAt=event.createdAt;return;
 }
 if(event?.type==='cards.requested')return;
  if(event?.type==='processing.completed'&&p.itemId&&p.item){
  mergeRemoteItem(s,p.item,photos);
  const x=s.items.find(value=>value.id===p.itemId);
  if(x)x.processingResult={taskId:p.taskId||null,status:'completed',summary:p.cli?.summary||'',checkedAt:event.createdAt||new Date().toISOString()};
  return;
 }
 if(event?.type==='processing.reviewed'&&p.itemId){const x=s.items.find(value=>value.id===p.itemId);if(x){x.processingResult={taskId:p.taskId||null,status:p.cli?.status||null,summary:p.cli?.summary||'',checkedAt:event.createdAt||new Date().toISOString()};}return;}

 if(event?.type==='listing.ready'){
  const source=event.item||remote||{id:event.itemId,status:'queue',photos:event.photos||[]};
  if(!source.id||s.deletedMailboxItemIds?.includes(source.id))return;
  mergeRemoteItem(s,{...source,...(event.listing||{}),id:event.itemId||source.id,status:'ready',processedAt:event.processedAt||new Date().toISOString(),updatedAt:event.updatedAt||event.processedAt||event.createdAt},photos);
  return;
 }
 if(event?.type==='item.deleted'&&p.itemId){s.items=s.items.filter(x=>x.id!==p.itemId);s.deletedMailboxItemIds??=[];if(!s.deletedMailboxItemIds.includes(p.itemId))s.deletedMailboxItemIds.push(p.itemId);return;}
 if(remote?.id){mergeRemoteItem(s,{...remote,updatedAt:remote.updatedAt||event.updatedAt||event.createdAt},photos);return;}
 if(event?.type==='item.status'&&p.itemId){const x=s.items.find(v=>v.id===p.itemId);if(x&&['queue','ready','published','sold','archived'].includes(p.status)){x.status=p.status;if(p.status==='archived')x.archivedAt=p.archivedAt||new Date().toISOString();else delete x.archivedAt;}return;}
 if(event?.type==='item.publish'&&p.itemId){const x=s.items.find(v=>v.id===p.itemId);if(x){x.status='published';delete x.archivedAt;}return;}
 if(event?.type==='item.comment'&&p.itemId&&p.comment){const x=s.items.find(v=>v.id===p.itemId);if(x){x.comments??=[];const i=x.comments.findIndex(v=>v.id===p.comment.id);if(i<0)x.comments.push(p.comment);else x.comments[i]=p.comment;}return;}
 if(event?.type==='cards.comment'&&p.itemId&&p.comment){const x=s.items.find(v=>v.id===p.itemId);if(x){x.cardComments??=[];const i=x.cardComments.findIndex(v=>v.id===p.comment.id);if(i<0)x.cardComments.push(p.comment);else x.cardComments[i]=p.comment;}return;}
 if(event?.type==='offer.upsert'||event?.type==='chat.upsert'){try{Object.assign(s,receiveEvent(s,event));}catch{}return;}
 if(event?.type?.startsWith('calendar.')&&!rememberCalendarOperation(s,p.operationId||event.operationId||event.id))return;
 if(event?.type==='calendar.slot.opened'&&p.slot?.id){const i=s.slots.findIndex(x=>x.id===p.slot.id);if(i<0)s.slots.push(p.slot);else if(itemTime(p.slot)>=itemTime(s.slots[i]))s.slots[i]=p.slot;return;}
 if(event?.type==='calendar.slot.removed'&&p.slotId){if(s.bookings.some(x=>x.slotId===p.slotId&&['held','scheduled','confirmed'].includes(x.status)))return;s.slots=s.slots.filter(x=>x.id!==p.slotId);s.calendarSlotTombstones??=[];s.calendarSlotTombstones.push({id:p.slotId,deletedAt:p.updatedAt||event.createdAt||new Date().toISOString()});return;}
 if(event?.type==='calendar.booking.created'&&p.booking?.id){const i=s.bookings.findIndex(x=>x.id===p.booking.id);if(i<0)s.bookings.push(p.booking);else if(itemTime(p.booking)>=itemTime(s.bookings[i]))s.bookings[i]=p.booking;return;}
 if(event?.type==='calendar.booking.cancelled'&&p.bookingId){const x=s.bookings.find(v=>v.id===p.bookingId);if(x){x.status='cancelled';x.updatedAt=p.updatedAt||event.createdAt||new Date().toISOString();}return;}
 if(event?.type==='analytics.snapshot'){for(const report of p.items||[]){const x=s.items.find(v=>v.id===report.itemId);if(x)x.stats={...x.stats,...report.stats,messages:report.messages??x.stats?.messages??0,offers:report.offers??x.offers?.length??0};}s.analytics={updatedAt:p.updatedAt||event.createdAt||new Date().toISOString(),period:p.period||null,source:'avito'};return;}
}
async function importMailboxFolder(folder,processedKey){
 const listResponse=await mailboxRequest(folder);if(!listResponse.ok)return false;
 const files=(await listResponse.json()).filter(file=>file.type==='file'&&file.name!=='.gitkeep'&&(/-text\.txt$/i.test(file.name)||/\.(json|txt)$/i.test(file.name))).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
 for(const file of files){
  if(state[processedKey]?.includes(file.sha))continue;
  let event;try{event=await readMailboxJson(folder,file);if(event?.itemRepository&&event?.resultPath){const resultResponse=await repositoryRequest(event.itemRepository,event.resultPath);if(!resultResponse.ok)continue;event=await decodeRepositoryJson(event.itemRepository,event.resultPath,await resultResponse.json());}}catch{continue;}
  const remote=event?.payload?.item||(event?.type==='item.upsert'?event.payload:null)||(event?.type==='listing.ready'?(event.item||{photos:event.photos||[]}):null);
  const incomingPhotos=event?.type==='cards.completed'?event.payload?.photos:remote?.photos;
  const photos=incomingPhotos?await restoreMailboxPhotos(folder,incomingPhotos,event?.itemRepository||mailboxConnection.repo):[];
  await commit(s=>{if(s[processedKey]?.includes(file.sha))return s;applyMailboxEvent(s,event,photos);markMailboxFile(s,folder,file.sha);return s;});
  if(folder==='outbox'&&event?.id)await mailboxJson('tasks/results/'+event.id+'.json',{schemaVersion:REPOSITORY_SCHEMA,eventId:event.id,type:event.type,listingId:event.payload?.itemId||event.itemId||event.item?.id||null,createdAt:event.createdAt||null,status:'applied'},'Index applied result');
  if(event?.type==='listing.ready'||event?.type==='processing.completed'){toast('Объявление подготовлено к публикации');render();}
  if(event?.type==='cards.completed'&&state.items.find(x=>x.id===event.payload?.itemId)?.generatedCards?.requestKey===event.payload?.requestKey){toast('Карточки синхронизированы');render();}
 }
 return true;
}
async function syncMailboxInbox(){return importMailboxFolder('inbox','importedMailboxInbox');}
async function syncMailboxResults(){
 if(mailboxResultSyncing||!state||!mailboxConnection?.repo||!mailboxConnection?.accessKey)return;
 mailboxResultSyncing=true;
 try{await syncMailboxInbox();await importMailboxFolder('outbox','processedMailboxResults');}
 catch{}finally{mailboxResultSyncing=false;queueMailboxResultSync(SITE_REFRESH_INTERVAL);}
}
const btn=(label,action,cls='')=>'<button type="button" class="btn '+cls+'" data-action="'+action+'">'+label+'</button>';
const link=(label,href,cls='')=>'<a class="'+cls+'" '+(label===icon('back')?'aria-label="Назад" ':label===icon('close')?'aria-label="Закрыть" ':label===icon('next')?'aria-label="Вперёд" ':'')+'href="#'+esc(href)+'">'+label+'</a>';
const section=(body,cls='')=>'<section class="section '+cls+'">'+body+'</section>';
function page(title,back,body,dock='',close=false){return '<header class="page-head"><div class="page-head-inner">'+(!close?link(icon('back'),back,'icon-button'):'')+'<h1>'+esc(title)+'</h1>'+(close?link(icon('close'),back,'icon-button'):'')+'</div></header><main class="page-content '+(dock?'has-dock':'')+'">'+body+'</main>'+dockHtml(dock);}
function dockHtml(body){return body?'<footer class="dock"><div class="dock-inner">'+body+'</div></footer>':'';}
function field(label,control,help=''){return '<label class="field">'+label+control+(help?'<small>'+help+'</small>':'')+'</label>';}
function header(tab){
 const readyCount=state.items.filter(x=>x.status==='queue'||x.status==='ready'||x.status==='archived').length,publishedCount=state.items.filter(x=>x.status==='published').length,offerCount=state.items.reduce((n,x)=>n+(x.offers||[]).filter(o=>o.status==='pending').length,0);
 const tabs=[['analytics','Аналитика','Аналит.','/analytics',offerCount],['ready','Готовые','Готовые','/list/ready',readyCount],['published','Публик.','Публик.','/list/published',publishedCount]];
 return '<header class="main-head"><a class="calendar-link '+(tab==='calendar'?'active':'')+'" data-action="calendar-toggle" href="#/calendar">'+icon('calendar')+'Календарь</a><nav class="tabs" aria-label="Разделы">'+tabs.map(([key,label,short,href,count])=>link('<span class="long-label">'+label+'</span><span class="short-label">'+short+'</span><span class="count">'+count+'</span>',href,'tab '+(tab===key?'active':''))).join('')+'</nav></header>';}
function statusIndicator(x){const status=typeof x==='string'?x:x.status,labels={ready:'Готово к публикации',queue:'В обработке',archived:'Архив'},date=status==='archived'&&x.archivedAt?'<span class="archive-date">с '+shortDate(x.archivedAt.slice(0,10))+'</span>':'';return '<span class="processing-status '+(status==='ready'?'ready':status==='archived'?'archived':'processing')+'">'+labels[status]+'</span>'+date;}
function analyticsPage(){
 const published=state.items.filter(x=>x.status==='published');
 const colors=['#718fbc','#d1b16b','#b77949','#98515a','#8b755b','#6e6870'];
 const colorFor=id=>{let hash=0;for(const char of String(id||''))hash=(hash*31+char.charCodeAt(0))>>>0;return colors[hash%colors.length];};
 const data=published.map(item=>{const stats=item.stats||{},value=Math.max(Number(stats.contacts)||0,Number(stats.messages)||0,(item.chats||[]).length,(item.offers||[]).length);return {item,value,color:colorFor(item.id)};});
 const total=data.reduce((sum,row)=>sum+row.value,0);
 let progress=0;
 const segments=total?data.map(row=>{const from=progress,share=Math.round(row.value/total*100);progress+=share;return row.color+' '+from+'% '+progress+'%';}).join(', '):'#2a2b30 0 100%';
 const chart=data.length?'<section class="interest-card"><h1>Интерес к объявлениям</h1><div class="interest-ring" style="background:conic-gradient('+segments+')"><div><b>'+total+'</b><span>'+plural(total,'интерес','интереса','интересов')+'</span></div></div><div class="interest-legend">'+data.map(row=>{const percent=total?Math.round(row.value/total*100):0;return '<div class="interest-row"><i style="background:'+row.color+'"></i><span>'+esc(row.item.title)+'</span><b>'+percent+'%</b></div>';}).join('')+'</div></section>':'';
 const activity=data.length?section('<h2>Отклик по объявлениям</h2>'+data.map(({item:x,color})=>{const stats=x.stats||{},views=Number(stats.views)||0,favorites=Number(stats.favorites)||0,written=Number(stats.messages??stats.contacts??(x.chats||[]).length)||0,activityBase=Math.max(views,1),boundedWidth=value=>Math.max(0,Math.min(100,Math.round(Number(value||0)/activityBase*100)));return '<div class="funnel-group"><p class="funnel-title"><i style="background:'+color+'"></i>'+esc(x.title)+'</p><div class="funnel-bars compact-bars">'+[['Просмотрели',views,'views'],['Добавили в избранное',favorites,'favorites'],['Написали',written,'messages']].map(([label,value,key])=>'<div class="funnel-step step-'+key+'"><div><span>'+label+'</span><b>'+value+'</b></div><i style="width:'+boundedWidth(value)+'%;--metric-color:'+color+'"></i></div>').join('')+'</div></div>';}).join(''),'interest-card funnel-card'):'';
 const empty=section('<h1>Интерес к объявлениям</h1><p>После первой публикации здесь появятся обращения покупателей.</p>','interest-card');
 return header('analytics')+'<main class="container analytics"><section class="analytics-top">'+link(icon('comment')+'Смотреть предложения','/offers','btn accent block')+'</section>'+(chart||empty)+activity+'</main>';
}
function allOffersPage(){
 const offers=state.items.flatMap(x=>(x.offers||[]).filter(o=>o.status==='pending').map(o=>({item:x,offer:o}))).sort((a,b)=>String(b.offer.createdAt).localeCompare(String(a.offer.createdAt)));
 return page('Предложения','/analytics',offers.length?'<div class="list global-offers">'+offers.map(({item:x,offer:o})=>link('<div class="thumb">'+(mediaSrc(x.photos[0])?'<img loading="lazy" decoding="async" src="'+esc(mediaSrc(x.photos[0]))+'" alt="">':icon('photo'))+'</div><div class="row-info"><div class="row-title">'+esc(x.title)+'</div><div class="offer-price-line">Ваша цена '+money(x.price)+' · <b>'+money(o.price)+'</b></div></div><div class="offer-delivery">'+(o.method==='delivery'?icon('box')+'<small>Доставка</small>':'')+'</div>','/item/'+x.id+'/offers','item-row')).join('')+'</div>':section('<p>Новых предложений пока нет.</p>'));}
function listPage(tab){
 if(tab==='queue')return analyticsPage();if(!['ready','published','archived'].includes(tab))tab='ready';
 const rows=state.items.filter(x=>tab==='ready'?(x.status==='queue'||x.status==='ready'||x.status==='archived'):x.status===tab),empty={ready:['Нет объявлений','Добавьте фотографии и заметки о товаре.'],published:['Пока ничего не опубликовано','Здесь появятся объявления после публикации.'],archived:['Архив пуст','Сюда попадут объявления, которые вы уберёте из публикации.']}[tab];
 if(tab==='ready')rows.sort((a,b)=>{const rank=x=>x.status==='archived'?1:0,diff=rank(a)-rank(b);return diff||(rank(a)?String(b.archivedAt||'').localeCompare(String(a.archivedAt||'')):0);});
 return header(tab)+'<main class="container '+(tab==='ready'?'has-dock':'')+'">'+(tab==='archived'?section(link('Вернуться к опубликованным','/list/published','btn outline block')):'')+(rows.length?'<div class="list">'+rows.map(x=>{const photo=x.photos[0],stats=x.stats||{};return link('<div class="thumb">'+(mediaSrc(photo)?'<img loading="lazy" decoding="async" src="'+esc(photo.preview||mediaSrc(photo))+'" alt="">':' '+icon('photo'))+(photo?'<span class="photo-badge">'+x.photos.length+'</span>':'')+'</div><div class="row-info"><div class="row-title">'+esc(x.title)+'</div><div class="row-sub">'+(tab==='published'?'<span class="stat">'+icon('eye')+(stats.views||0)+'</span><span class="stat">'+icon('heart')+(stats.favorites||0)+'</span><span class="stat">'+icon('comment')+(stats.contacts||0)+'</span>':statusIndicator(x))+'</div></div><div class="row-price">'+money(x.price)+'<small>'+x.photos.length+' фото</small></div>','/item/'+x.id,'item-row')}).join('')+'</div>':'<div class="list empty">'+icon('box')+'<h2>'+empty[0]+'</h2><p>'+empty[1]+'</p></div>')+'</main>'+dockHtml(tab==='ready'?link(icon('plus')+'Добавить объявление','/new','btn primary'):'');}
function gallery(x){
 if(!x.photos.length)return '<div class="gallery gallery-empty">'+icon('photo')+'Фотографии пока не добавлены</div>';
 const visible=x.photos.filter(p=>mediaSrc(p));
 if(!visible.length)return '<div class="gallery gallery-empty">'+icon('photo')+'Фотографии переданы в обработку</div>';
 const slides=visible.length>1?[...visible,...visible,...visible,...visible,...visible]:visible;
 return '<div class="gallery"><div class="gallery-track" id="gallery-track" data-count="'+visible.length+'">'+slides.map((p,i)=>'<figure '+(visible.length>1&&Math.floor(i/visible.length)!==2?'aria-hidden="true"':'')+'><img loading="lazy" decoding="async" src="'+esc(mediaSrc(p))+'" alt="'+(visible.length>1&&Math.floor(i/visible.length)!==2?'':esc(x.title)+' — фото '+((i%visible.length)+1))+'"></figure>').join('')+'</div>'+(visible.length>1?'<button class="gallery-arrow left" data-action="gallery-prev" aria-label="Предыдущее фото">'+icon('back')+'</button><button class="gallery-arrow right" data-action="gallery-next" aria-label="Следующее фото">'+icon('next')+'</button>':'')+'<span class="gallery-counter" id="gallery-counter">1 / '+visible.length+'</span></div>'+(visible.length>1?'<div class="gallery-thumbs" aria-label="Фотографии">'+visible.map((p,i)=>'<button data-action="gallery-at" data-index="'+i+'" aria-label="Фото '+(i+1)+'"><img loading="lazy" decoding="async" src="'+esc(mediaSrc(p))+'" alt=""></button>').join('')+'</div>':'');
}
function visualReviewPanel(x){
 if(!x.photos?.length)return section('<h2>Карточки товара</h2><p>Фотографий пока нет. Добавьте исходники и выберите оформление.</p>'+link(icon('plus')+'Настроить карточки'+icon('next'),'/item/'+x.id+'/edit','btn outline block action-link'));
 const note=x.generatedCards?.quality==='design-preview'?'<p class="help">Проверка оформления: изображения демонстрационные. Надписи на товаре требуют исправления перед публикацией.</p>':'';
 return section(note+link(icon('comment')+'Добавить комментарий по фото'+icon('next'),'/item/'+x.id+'/cards-comment','btn outline block action-link'),'visual-review');
}
function pickupLabel(minutes){return Number(minutes)>=480?'Весь день':Number(minutes)+' мин на получение';}
function detailPage(x){
 const main=gallery(x)+section('<span class="tag">'+statusName[x.status]+'</span><h1 class="detail-title">'+esc(x.title)+'</h1><div class="detail-price">'+money(x.price)+'</div><div class="facts"><div><span>Самовывоз</span><b>'+pickupLabel(x.pickupMinutes)+'</b></div><div><span>Доставка</span><b>'+(x.delivery?'Можно обсудить':'Не предусмотрена')+'</b></div></div>');
 const stats=x.stats||{},publicationStats=(x.status==='published'||x.status==='archived')?section('<h2>Статистика объявления</h2><div class="stats-grid"><div>'+icon('eye')+'<span>Просмотры</span><b>'+Number(stats.views||0)+'</b></div><div>'+icon('heart')+'<span>В избранном</span><b>'+Number(stats.favorites||0)+'</b></div><div>'+icon('comment')+'<span>Обращения</span><b>'+Number(stats.contacts||0)+'</b></div><div>'+icon('box')+'<span>Предложения</span><b>'+(x.offers||[]).length+'</b></div></div>'):'';
 const actions=x.status==='published'?section('<div class="actions-stack">'+link(icon('comment')+'Написавшие <span class="count">'+(x.chats||[]).length+'</span>'+icon('next'),'/item/'+x.id+'/writers','btn outline')+'</div>'):'';
 const prices='';
 const raw=section('<h2>'+(x.status==='queue'?'Информация о товаре':'Исходные заметки')+'</h2><p class="text">'+esc(x.raw||'Заметок пока нет.')+'</p>');
 const desc=x.status!=='queue'||x.description?section('<h2>Описание объявления</h2><div class="description">'+esc(x.description||'Описание пока не составлено.')+'</div>'):'';
 const archiveAction=x.status==='published'?btn(icon('box')+'Архивировать объявление'+icon('next'),'archive-item','archive-gold block action-link'):'';
 const bottom=section('<div class="actions-stack">'+link(icon('comment')+'Добавить комментарий для ИИ'+icon('next'),'/item/'+x.id+'/comments','btn outline')+link(icon('edit')+'Редактировать вручную'+icon('next'),'/item/'+x.id+'/edit','btn outline')+archiveAction+(x.status==='published'?'':btn('Удалить объявление','delete-item','danger block delete-action'))+'</div>','delete-zone');
 const dock=x.status==='published'?link(icon('edit')+'Редактировать','/item/'+x.id+'/edit','btn')+link('Предложения · '+(x.offers||[]).length,'/item/'+x.id+'/offers','btn primary'):x.status==='ready'?link(icon('edit')+'Редактировать','/item/'+x.id+'/edit','btn')+btn('Опубликовать','publish','primary'):x.status==='archived'?btn('Вернуть в публикацию','restore-item','primary'):'';
 return page(x.title,x.status==='published'||x.status==='sold'?'/list/published':'/list/ready',main+publicationStats+prices+actions+desc+raw+bottom,dock);
}
function priceSuggestions(d){
 const choices=[['Быстрая',d.fast],['Оптимальная',d.optimal],['Долгая',d.slow]].filter(([,price])=>Number.isFinite(Number(price))&&Number(price)>=0);
 if(!choices.length)return '';
 return '<div class="field price-suggestions"><span>Рекомендованные цены</span><div class="price-choices">'+choices.map(([label,price])=>'<button type="button" class="price-choice '+(Number(price)===Number(d.price)?'active':'')+'" data-action="set-draft-price" data-price="'+Number(price)+'"><small>'+label+'</small><b>'+money(price)+'</b></button>').join('')+'</div></div>';
}
function getDraft(id){const key=id||'new',fresh={photos:[],sourcePhotos:[],imageHistory:[],title:'',raw:'',description:'',price:null,pickupMinutes:30,delivery:false,productKind:'single',condition:'used',defects:'',quantity:1,generateCards:false,cardStyle:'realistic',cardFormat:'auto',cardCount:5};if(!draft||draft.key!==key){draft={key,...(id?structuredClone(item(id)):structuredClone(state?.newDraft||fresh))};}return draft;}
function productFields(d){const kind=d.productKind==='batch'?'batch':'single',condition=d.condition==='new'?'new':'used';return '<section class="section product-section"><h2>Параметры товара</h2><div class="segmented" role="radiogroup" aria-label="Тип товара"><label><input type="radio" name="productKind" value="single" '+(kind==='single'?'checked':'')+'><span>Товар 1</span></label><label><input type="radio" name="productKind" value="batch" '+(kind==='batch'?'checked':'')+'><span>Товар тиражный</span></label></div><div class="product-single '+(kind==='single'?'':'is-hidden')+'"><div class="field-label">Состояние</div><div class="segmented condition" role="radiogroup" aria-label="Состояние"><label><input type="radio" name="condition" value="used" '+(condition==='used'?'checked':'')+'><span>Б/у</span></label><label><input type="radio" name="condition" value="new" '+(condition==='new'?'checked':'')+'><span>Новое</span></label></div></div><div class="product-batch '+(kind==='batch'?'':'is-hidden')+'">'+field('Количество штук','<input name="quantity" type="number" min="1" step="1" inputmode="numeric" value="'+(Number(d.quantity)||1)+'">','Укажите, сколько одинаковых единиц есть в наличии.')+'</div>'+field('Дефекты и нюансы','<textarea name="defects" rows="3" placeholder="Если есть — опишите честно. Не попадёт в описание и карточки.">'+esc(d.defects||'')+'</textarea>')+'</section>';}
function cardSettingsKey(d){return JSON.stringify([!!d.generateCards,normalizeCardStyle(d.cardStyle),normalizeCardFormat(d.cardFormat),Number(d.cardCount)||5]);}
function cardsRegenerationChanged(d){
 if(!d?.id||d.key==='new'||!d.generateCards)return false;
 const saved=item(d.id);return !!saved&&cardSettingsKey(d)!==(saved.cardGenerationSettings||cardSettingsKey(saved));
}
function regenerationButton(d){return '<button type="button" id="cards-regenerate" class="btn primary block" data-action="cards-regenerate" '+(cardsRegenerationChanged(d)?'':'hidden')+'>Создать серию карточек</button>';}
function refreshRegenerationButton(){const button=document.getElementById('cards-regenerate');if(button)button.hidden=!cardsRegenerationChanged(draft);}
async function requestEditedCards(button){
 if(photoBusy)throw Error('Дождитесь загрузки фотографий');
 if(!cardsRegenerationChanged(draft))return;
 button.disabled=true;
 try{
 const id=draft.id,settings={generateCards:true,cardStyle:normalizeCardStyle(draft.cardStyle),cardFormat:normalizeCardFormat(draft.cardFormat),cardCount:Number(draft.cardCount)||5};
 const candidate={...structuredClone(item(id)),...settings};
 await hydrateListingMedia(candidate,true);
 const sources=activeCardPhotos(candidate);
 if(!sources.length||sources.some(photo=>!mediaSrc(photo)))throw Error('Дождитесь загрузки исходных фотографий');
 await commit(s=>{const saved=s.items.find(x=>x.id===id);Object.assign(saved,settings,{updatedAt:new Date().toISOString()});saved.cardGenerationSettings=cardSettingsKey(saved);saved.cardRequestKey=cardRequestKey(candidate);saved.cardRequestStatus='requested';addOutbox(s,'cards.requested',{itemId:id,item:cardInputItem(candidate),sourcePhotos:structuredClone(sources),requestId:uid(),...cardSpec(candidate),requestKey:saved.cardRequestKey,photoIds:sources.map(p=>p.id)},{action:'cards.generate',listingId:id,cards:{...cardSpec(candidate),requestKey:saved.cardRequestKey}});return s;});
 refreshRegenerationButton();toast('Запрос на генерацию добавлен в очередь');
 }finally{button.disabled=false;}
}
function cardsHtml(d){
 const enabled=!!d.generateCards,style=normalizeCardStyle(d.cardStyle),format=normalizeCardFormat(d.cardFormat),count=Math.max(1,Math.min(10,Number(d.cardCount)||5));
 const options=Object.entries(CARD_STYLES).map(([key,value])=>'<label class="card-style-option"><input type="radio" name="cardStyle" value="'+key+'" '+(style===key?'checked':'')+'><span><b>'+value.label+'</b><small>'+value.description+'</small></span></label>').join('');
 const formats=[['portrait','3:4'],['landscape','4:3'],['auto','Подобрать по товару']].map(([key,label])=>'<label class="format-option"><input type="radio" name="cardFormat" value="'+key+'" '+(format===key?'checked':'')+'><span class="format-shape '+key+'">'+label+'</span></label>').join('');
 const example=style==='realistic'?'home':style;
 return '<section class="section cards-section"><label class="switch-row card-switch"><span><b>Создать карточки</b><small>Выберите оформление и количество изображений</small></span><input type="checkbox" name="generateCards" data-action="cards-toggle" '+(enabled?'checked':'')+'></label><div id="cards-config" class="cards-config '+(enabled?'':'is-hidden')+'"><div class="divider"></div><h2>Оформление</h2><div class="card-style-options">'+options+'</div><img class="style-example" src="./card-examples/'+example+'-01.png" alt="Пример: '+CARD_STYLES[style].label+'" loading="lazy" decoding="async"><div class="field"><span>Формат всей серии</span><div class="format-options">'+formats+'</div></div><div class="field"><span>Количество карточек</span><input type="hidden" name="cardCount" value="'+count+'"><div class="count-reel-frame"><div class="count-reel" aria-label="Количество карточек">'+Array.from({length:10},(_,i)=>'<button type="button" data-action="card-count" data-count="'+(i+1)+'" aria-pressed="'+(count===i+1)+'">'+(i+1)+'</button>').join('')+'</div></div><small id="card-count-note">В серии '+plural(count,'карточка','карточки','карточек')+'.</small>'+regenerationButton(d)+'</div><p class="help">Все карточки одной серии будут одного формата.</p></div></section>';
}

function unusedPhotos(d){return availableImageHistory(d)[0].photos.filter(photo=>!d.photos.some(active=>samePhoto(active,photo)));}
function allPhotosHtml(d){
 const photos=unusedPhotos(d).filter(mediaSrc);
 return '<div class="all-photos"><div class="all-photos-head">Все фотографии</div>'+(photos.length?'<div class="history-photos">'+photos.map(photo=>'<button type="button" data-action="history-add" data-history="all-images" data-photo="'+esc(photo.id)+'" aria-label="Добавить изображение в объявление"><img loading="lazy" decoding="async" src="'+esc(photo.preview||mediaSrc(photo))+'" alt="" loading="lazy" decoding="async" draggable="false"></button>').join('')+'</div>':'<p class="help">Все фотографии уже в объявлении.</p>')+'</div>';
}

function photosHtml(d){
 const tiles=d.photos.map((p,i)=>'<div class="photo-tile" data-sort-list="current" data-sort-index="'+i+'"><img loading="lazy" decoding="async" src="'+esc(p.preview||mediaSrc(p))+'" alt="Фото '+(i+1)+'" draggable="false"><button type="button" class="remove" data-action="photo-remove" data-index="'+i+'" aria-label="Удалить фото '+(i+1)+'">'+icon('close')+'</button>'+(i===0?'<span class="photo-order">Главное</span>':'')+'</div>').join('');
 return '<details class="photos-collapse" open><summary class="photo-editor-head"><b>Фотографии</b><span class="meta">'+d.photos.length+' / 10</span><span class="photos-arrow">⌄</span></summary><div class="photo-grid">'+tiles+(d.photos.length<10?'<button type="button" class="photo-add" data-action="photo-add">'+icon('plus')+'Добавить фото</button>':'')+'</div><input class="file-input" id="photo-files" type="file" accept="image/*" multiple>'+allPhotosHtml(d)+'</details>';
}
function editPage(id){const d=getDraft(id),isNew=!id,back=isNew?'/list/ready':'/item/'+id;let fields=isNew?field('Что знаете о товаре','<textarea name="raw" rows="7" placeholder="Состояние, комплект, история…">'+esc(d.raw)+'</textarea>'):field('Заголовок','<input name="title" maxlength="50" required value="'+esc(d.title)+'">','До 50 символов')+field('Исходные заметки','<textarea name="raw" rows="5">'+esc(d.raw)+'</textarea>')+field('Описание объявления','<textarea name="description" rows="9">'+esc(d.description)+'</textarea>');fields+=priceSuggestions(d)+field(isNew?'Желаемая цена, ₽':'Цена, ₽','<input name="price" type="number" min="0" max="1000000000" inputmode="numeric" value="'+(d.price??'')+'" placeholder="Необязательно">');if(!isNew)fields+=field('Время на получение, минут','<input name="pickupMinutes" type="number" inputmode="numeric" min="30" max="480" step="5" required value="'+d.pickupMinutes+'">','Учтите осмотр, разборку и вынос.')+'<label class="switch-row">Доставку можно обсудить<input name="delivery" type="checkbox" '+(d.delivery?'checked':'')+'></label>';return page(isNew?'Новое объявление':'Редактирование',back,'<form id="item-form">'+section('<div id="photo-editor">'+photosHtml(d)+'</div>')+section(fields)+cardsHtml(d)+productFields(d)+'<div id="form-error" aria-live="polite"></div></form>'+(isNew?section(btn('Удалить черновик','delete-draft','danger block'),'delete-zone'):''),'<button class="btn primary" type="submit" form="item-form">'+(isNew?'Добавить объявление':'Сохранить изменения')+'</button>',true);}
function commentsPage(x){return page('Комментарий для ИИ','/item/'+x.id,section('<h2>'+esc(x.title)+'</h2><p>Укажите, что нужно изменить, уточнить или учесть при обработке текста объявления.</p><form id="comment-form">'+field('Комментарий','<textarea name="text" rows="6" required placeholder="Например: уточнить комплект и самовывоз…"></textarea>')+'</form>')+section('<h2>Комментарии</h2>'+((x.comments||[]).length?x.comments.slice().reverse().map(c=>'<div class="comment">'+esc(c.text)+'<small>'+stamp(c.createdAt)+' · Сохранён для обработки</small></div>').join(''):'<p>Комментариев пока нет.</p>')),'<button class="btn primary" form="comment-form" type="submit">Сохранить комментарий</button>');}
function cardCommentsPage(x){const comments=x.cardComments||[];return page('Комментарий по фото','/item/'+x.id,section('<h2>'+esc(x.title)+'</h2><p>Этот комментарий относится только к фотографиям и карточкам товара. Текст объявления не меняется.</p><form id="card-comment-form">'+field('Что исправить на фото','<textarea name="text" rows="6" required placeholder="Например: показать клавиши крупнее, не менять цвет товара…"></textarea>')+'</form>')+section('<h2>История комментариев по фото</h2>'+(comments.length?comments.slice().reverse().map(c=>'<div class="comment">'+esc(c.text)+'<small>'+stamp(c.createdAt)+' · Сохранён для обработки карточек</small></div>').join(''):'<p>Комментариев по фото пока нет.</p>')),'<button class="btn primary" form="card-comment-form" type="submit">Отправить комментарий по фото</button>');}
function writersPage(x){
 const chats=(x.chats||[]).slice().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 return page('Написавшие','/item/'+x.id,section('<h2>'+esc(x.title)+'</h2><p>Только текстовые переписки по этому объявлению.</p>')+(chats.length?'<div class="list chat-list">'+chats.map(c=>link('<div class="chat-avatar">'+esc((c.buyer||'П').trim().slice(0,1).toUpperCase())+'</div><div class="row-info"><div class="row-title">'+esc(c.buyer||'Покупатель')+'</div><div class="row-sub">'+esc(c.preview||c.messages?.at(-1)?.text||'Открыть переписку')+'</div></div><div class="chat-time">'+(c.updatedAt?stamp(c.updatedAt):'')+'</div>','/item/'+x.id+'/chat/'+c.id,'item-row')).join('')+'</div>':section('<p>Переписок пока нет. Они появятся здесь, когда обработчик передаст текстовые сообщения из Авито.</p>')));
}
function chatPage(x,chatId){
 const chat=(x.chats||[]).find(c=>c.id===chatId);if(!chat)return missing();
 const messages=(chat.messages||[]).slice().sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
 const thread=messages.length?'<div class="chat-thread">'+messages.map(m=>'<div class="chat-message '+(m.author==='seller'?'outgoing':'incoming')+'"><p>'+esc(m.text||'')+'</p><small>'+esc(m.author==='seller'?'Вы':(m.authorName||chat.buyer||'Покупатель'))+(m.createdAt?' · '+stamp(m.createdAt):'')+'</small></div>').join('')+'</div>':'<p>Текст переписки ещё не передан.</p>';
 return page(chat.buyer||'Переписка','/item/'+x.id+'/writers',section('<h2>Переписка</h2>'+thread)+section('<h2>Краткая сводка</h2><p class="chat-summary">'+esc(chat.summary||'Сводка появится после обработки переписки.')+'</p>','chat-summary-section'));
}
function offersPage(x){
 return page('Предложения','/item/'+x.id,section('<h2>'+esc(x.title)+'</h2><p>'+plural(x.offers.length,'предложение','предложения','предложений')+' · цена '+money(x.price)+'</p>')+
 (x.offers.length?x.offers.map(o=>section('<div class="offer-top"><div><h2>'+esc(o.buyer)+'</h2><div class="offer-sub">'+stamp(o.createdAt)+'</div></div><span class="tag">'+({pending:'Новое',accepted:'Принято',rejected:'Отклонено'})[o.status]+'</span></div><div class="offer-price">'+money(o.price)+'</div><div class="offer-sub">'+(x.price?Math.round((o.price/x.price-1)*100)+'% от вашей цены':'Цена покупателя')+'</div><div class="offer-facts"><div><span>Получение</span>'+(o.method==='delivery'?'Просит доставку':'Самовывоз')+'</div><div><span>Готов получить</span>'+(o.preferredDate?shortDate(o.preferredDate):'Не уточнено')+' '+esc(o.preferredTime||'')+'</div><div><span>Сообщений</span>'+o.messageCount+'</div></div><p>'+esc(o.note||'Без комментария')+'</p>'+(o.status==='pending'?'<div class="divider"></div>'+link('Принять и назначить время','/item/'+x.id+'/book/'+o.id,'btn accent block'):''))).join(''):section('<p>Здесь появятся предложения покупателей: цена, способ получения и удобное время.</p>')));
}
function calendarPage(params){
 const today=todayKey();const month=/^\d{4}-\d{2}$/.test(params.get('month')||'')?params.get('month'):today.slice(0,7);
 const selected=/^\d{4}-\d{2}-\d{2}$/.test(params.get('day')||'')?params.get('day'):(month===today.slice(0,7)?today:month+'-01');
 const [y,m]=month.split('-').map(Number),first=(new Date(y,m-1,1).getDay()+6)%7,total=new Date(y,m,0).getDate(),cells=Math.ceil((first+total)/7)*7;
 const shift=delta=>{const d=new Date(y,m-1+delta,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
 const grid=Array.from({length:cells},(_,i)=>{const n=i-first+1;if(n<1||n>total)return '<span class="day outside"></span>';
 const date=month+'-'+String(n).padStart(2,'0'),load=dayLoad(state,date),past=date<today;
 return '<button class="day '+load+(past?' past':'')+(date===today?' today':'')+(date===selected?' selected':'')+'" '+(past?'disabled':'data-action="day-select" data-date="'+date+'"')+' aria-label="'+fullDate(date)+' — '+({closed:'не работаем',open:'можно принять',some:'немного встреч',busy:'много встреч',full:'всё заполнено'})[load]+'" aria-pressed="'+(date===selected)+'">'+n+'</button>';}).join('');
 const slots=state.slots.filter(s=>s.date===selected).sort((a,b)=>a.from.localeCompare(b.from));
 const panel=section('<h2>'+fullDate(selected)+'</h2><div class="meta">Время и встречи</div>'+(slots.length?slots.map(s=>link('<div><b>'+s.from+' — '+s.to+'</b><small>'+(s.kind==='delivery'?'Отправки':'Самовывоз')+' · '+plural(state.bookings.filter(b=>b.slotId===s.id&&b.status!=='cancelled').length,'встреча','встречи','встреч')+'</small></div>'+icon('next'),'/slot/'+s.id,'slot-link')).join(''):'<p style="margin:14px 0">Время ещё не открыто.</p>')+(selected>=today?link(icon('plus')+'Добавить время','/slot/new?date='+selected,'btn outline block'):'<p>Прошедшая дата закрыта для добавления времени.</p>'));
 return header('calendar')+'<main class="container"><div class="calendar-layout"><section class="calendar-card"><div class="calendar-title"><h2>'+new Date(y,m-1,1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'})+'</h2><div class="month-nav">'+link(icon('back'),'/calendar?month='+shift(-1),'icon-button')+link(icon('next'),'/calendar?month='+shift(1),'icon-button')+'</div></div><div class="week">'+['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="days">'+grid+'</div><div class="legend"><span><i></i>Не работаем</span><span><i class="open"></i>Можно принять</span><span><i class="some"></i>Немного встреч</span><span><i class="busy"></i>Много встреч</span><span><i class="full"></i>Всё заполнено</span></div></section><aside class="day-panel" id="day-panel">'+panel+'</aside></div></main>';
}
function slotEditor(params){
 const date=params.get('date')||todayKey();
 if(date<todayKey())return page('Открыть время','/calendar',section('<p>На прошедшую дату нельзя добавить время.</p>'));
 return page('Открыть время','/calendar?month='+date.slice(0,7)+'&day='+date,'<form id="slot-form">'+section('<h2>'+fullDate(date)+'</h2><input type="hidden" name="date" value="'+date+'"><div class="split">'+field('С','<input name="from" type="text" inputmode="numeric" maxlength="5" data-time-input placeholder="ЧЧ:ММ" pattern="[0-2][0-9]:[0-5][0-9]" value="14:00" required aria-label="Время начала">')+field('До','<input name="to" type="text" inputmode="numeric" maxlength="5" data-time-input placeholder="ЧЧ:ММ" pattern="[0-2][0-9]:[0-5][0-9]" value="18:00" required aria-label="Время окончания">')+'</div>')+'<div id="form-error" aria-live="polite"></div></form>','<button class="btn primary" form="slot-form" type="submit">Сохранить время</button>',true);
}
function schedulePage(id){
 const s=state.slots.find(x=>x.id===id);if(!s)return missing();
 const bookings=state.bookings.filter(b=>b.slotId===id&&b.status!=='cancelled').sort((a,b)=>a.from.localeCompare(b.from));
 return page('Расписание','/calendar?month='+s.date.slice(0,7)+'&day='+s.date,section('<h1>'+s.from+' — '+s.to+'</h1><p style="margin-top:8px">'+fullDate(s.date)+' · '+(s.kind==='delivery'?'Отправки':'Самовывоз')+'</p>')+section('<h2>Кто и когда приедет</h2>'+(bookings.length?bookings.map(b=>'<div class="schedule-row"><time>'+b.from+'<span class="meta" style="display:block">'+b.to+'</span></time><div><h3>'+esc(b.buyer)+'</h3>'+link(esc(item(b.itemId)?.title||'Объявление'),'/item/'+b.itemId)+'<p>'+money(b.price)+' · '+(b.method==='delivery'?'Доставка':'Самовывоз')+'</p><p>'+esc(b.note||'')+'</p>'+btn('Отменить встречу','cancel-booking','link compact') .replace('data-action="cancel-booking"','data-action="cancel-booking" data-id="'+b.id+'"')+'</div></div>').join(''):'<p>В этом интервале встреч пока нет. Покупателя можно назначить из его предложения.</p>'))+(bookings.length?'':section(btn('Закрыть этот интервал','remove-slot','danger block').replace('data-action="remove-slot"','data-action="remove-slot" data-id="'+s.id+'"'))));
}
function bookingPage(x,offerId,params){
 const o=x.offers.find(v=>v.id===offerId);if(!o)return missing();
 const choices=state.slots.filter(s=>s.date>=todayKey()&&s.kind===o.method&&freeTimes(state,s,x).length).sort((a,b)=>(a.date+a.from).localeCompare(b.date+b.from));
 const selected=choices.find(s=>s.id===params.get('slot'))||choices[0];
 const form=selected?'<form id="booking-form"><input type="hidden" name="itemId" value="'+x.id+'"><input type="hidden" name="offerId" value="'+o.id+'">'+field('Открытый интервал','<select name="slotId" id="booking-slot">'+choices.map(s=>'<option value="'+s.id+'" '+(s.id===selected.id?'selected':'')+'>'+shortDate(s.date)+' · '+s.from+'–'+s.to+'</option>').join('')+'</select>')+field('Начало встречи','<select name="from">'+freeTimes(state,selected,x).map(t=>'<option>'+t+'</option>').join('')+'</select>','На получение отведено '+x.pickupMinutes+' мин. Занятое время исключено.')+field('Примечание к встрече','<textarea name="note" rows="3">'+esc(o.note||'')+'</textarea>')+'</form>':'<p>Нет подходящего открытого времени для '+(o.method==='delivery'?'отправки доставкой':'самовывоза')+'. Откройте интервал в календаре.</p><div class="divider"></div>'+link('Открыть календарь','/calendar','btn accent');
 return page('Назначить время','/item/'+x.id+'/offers',section('<h2>'+esc(o.buyer)+' · '+money(o.price)+'</h2><p>'+esc(x.title)+' · '+(o.method==='delivery'?'Доставка':'Самовывоз')+'</p>')+section(form),selected?'<button form="booking-form" class="btn primary" type="submit">Подтвердить встречу</button>':'');
}
function missing(){return page('Страница не найдена','/list/queue',section('<p>Объявление или интервал уже недоступны.</p>'));}
let mediaHydrationRevision=0;
const itemHydrationPending=new Map();
async function hydrateItemRepository(record){
 if(!record?.itemRepository||record.itemLoaded)return record;
 if(itemHydrationPending.has(record.id))return itemHydrationPending.get(record.id);
 const pending=(async()=>{
  const response=await repositoryRequest(record.itemRepository,'listing.json');
  if(!response.ok)throw Error('Не удалось загрузить объявление');
  const document=await decodeRepositoryJson(record.itemRepository,'listing.json',await response.json());
  const offersResponse=await repositoryRequest(record.itemRepository,'offers.json');
  const contactsResponse=await repositoryRequest(record.itemRepository,'contacts.json');
  const offers=offersResponse.ok?(await decodeRepositoryJson(record.itemRepository,'offers.json',await offersResponse.json())).offers||[]:[];
  const contacts=contactsResponse.ok?(await decodeRepositoryJson(record.itemRepository,'contacts.json',await contactsResponse.json())).contacts||[]:[];
  const merged=normalItem({...record,...(document.item||{}),offers,chats:contacts,itemRepository:record.itemRepository,itemLoaded:true});
  const index=state.items.findIndex(value=>value.id===record.id);if(index>=0){state.items[index]=merged;await saveState(state);}
  return merged;
 })().finally(()=>itemHydrationPending.delete(record.id));
 itemHydrationPending.set(record.id,pending);return pending;
}

async function hydrateListingMedia(record,full){
 let changed=false;
 const hydrate=async photos=>{
  if(!(photos||[]).some(photo=>!mediaSrc(photo)))return photos;
  const listingId=record.id||record.key||'new',loaded=await readPhotoMedia(listingId,photos,{full}),resolved=await Promise.all(loaded.map(photo=>restoreSnapshotPhoto(photo,record.itemRepository||mailboxConnection?.repo)));
  for(const photo of resolved)if(mediaSrc(photo))void cachePhotoMedia(listingId,photo);
  if(resolved.some((photo,index)=>mediaSrc(photo)!==mediaSrc(photos[index])))changed=true;
  return resolved;
 };
 record.photos=await hydrate(record.photos);
 record.sourcePhotos=await hydrate(record.sourcePhotos);
 if((record.imageHistory||[]).some(group=>(group.photos||[]).some(photo=>!mediaSrc(photo))))record.imageHistory=await Promise.all(record.imageHistory.map(async group=>({...group,photos:await hydrate(group.photos)})));
 return changed;
}
async function hydrateVisibleMedia(){
 if(!state)return;
 const request=++mediaHydrationRevision,{parts}=route();let changed=false;
 try{
  if(parts[0]==='new'){
   if(draft)changed=await hydrateListingMedia(draft,false);
  }else if(parts[0]==='item'&&parts[1]){
   const record=parts[2]==='edit'&&draft?draft:item(parts[1]);if(record)changed=await hydrateListingMedia(record,parts[2]!=='edit');
  }else if(parts[0]==='list'||!parts[0]||parts[0]==='analytics'){
   const records=(state.items||[]).filter(record=>record.photos?.[0]&&!mediaSrc(record.photos[0])).slice(0,50);
   await Promise.all(records.map(async record=>{const original=record.photos[0],temporary={id:record.id,photos:[original],sourcePhotos:[],imageHistory:[]};if(await hydrateListingMedia(temporary,false)){record.photos=[temporary.photos[0],...record.photos.slice(1)];changed=true}}));
  }
  if(changed&&request===mediaHydrationRevision)render();
 }catch{}
}
function render(){
 if(!unlocked){connectionPage();return;}
 if(!state){root.innerHTML='<div class="loading">Открываем объявления…</div>';return;}
 const {parts,params}=route();galleryIndex=0;
 if(parts[0]!=='new'&&!(parts[0]==='item'&&parts[2]==='edit'))draft=null;
 try{
 if(parts[0]==='new')root.innerHTML=editPage();
 else if(parts[0]==='analytics')root.innerHTML=analyticsPage();
 else if(parts[0]==='offers')root.innerHTML=allOffersPage();
 else if(parts[0]==='calendar')root.innerHTML=calendarPage(params);
 else if(parts[0]==='slot')root.innerHTML=parts[1]==='new'?slotEditor(params):schedulePage(parts[1]);
 else if(parts[0]==='item'){
 const x=item(parts[1]);
 if(x?.itemRepository&&!x.itemLoaded){root.innerHTML='<div class="loading">Загружаем объявление…</div>';void hydrateItemRepository(x).then(()=>render()).catch(error=>{root.innerHTML=page('Не удалось загрузить объявление','/list/ready',section('<p>'+esc(error.message)+'</p>'));});return;}
 root.innerHTML=!x?missing():parts[2]==='edit'?editPage(x.id):parts[2]==='comments'?commentsPage(x):parts[2]==='cards-comment'?cardCommentsPage(x):parts[2]==='offers'?offersPage(x):parts[2]==='writers'?writersPage(x):parts[2]==='chat'?chatPage(x,parts[3]):parts[2]==='book'?bookingPage(x,parts[3],params):detailPage(x);
 }else root.innerHTML=listPage(parts[1]||'queue');
 }catch(e){root.innerHTML=page('Не удалось открыть страницу','/list/queue',section('<p>'+esc(e.message)+'</p>'));}
 const track=document.getElementById('gallery-track');
 if(track){
  let swipe=null;
  const count=Number(track.dataset.count)||1,counter=document.getElementById('gallery-counter');
  const page=()=>Math.round(track.scrollLeft/(track.clientWidth||1));
  const setIndex=index=>{galleryIndex=((index%count)+count)%count;const active=track.children[page()]?.querySelector('img');if(active?.naturalWidth&&active?.naturalHeight)track.style.height=(track.clientWidth*active.naturalHeight/active.naturalWidth)+'px';if(counter)counter.textContent=(galleryIndex+1)+' / '+count;document.querySelectorAll('.gallery-thumbs [data-index]').forEach(button=>button.classList.toggle('active',Number(button.dataset.index)===galleryIndex));};
  const jump=target=>{const behavior=track.style.scrollBehavior;track.style.scrollBehavior='auto';track.scrollLeft=target*(track.clientWidth||1);requestAnimationFrame(()=>{track.style.scrollBehavior=behavior;});setIndex(target);};
  const showPage=target=>{track.scrollTo({left:target*(track.clientWidth||1),behavior:'smooth'});setIndex(target);};
  const update=()=>setIndex(page());
  track._galleryStep=step=>{const current=page(),target=current+step;if(target<0)jump(count*3-1);else if(target>=count*5)jump(count*2);else showPage(target);};
  track._galleryPick=index=>jump(count*2+Number(index));
  track.addEventListener('scroll',update,{passive:true});track.addEventListener('load',update,true);window.addEventListener('resize',update,{once:true});
  track.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'||count<2)return;swipe={id:event.pointerId,x:event.clientX,y:event.clientY,page:page()};track.setPointerCapture?.(event.pointerId);});
  track.addEventListener('pointerup',event=>{if(!swipe||swipe.id!==event.pointerId)return;const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y,startPage=swipe.page;swipe=null;if(Math.abs(dx)>=36&&Math.abs(dx)>Math.abs(dy)){if(startPage===count*5-1&&dx<0)jump(count*2);else if(startPage===0&&dx>0)jump(count*3-1);}});
  track.addEventListener('pointercancel',()=>{swipe=null;});
  requestAnimationFrame(()=>jump(count*2));
 }
 installPhotoSorting();installCountReel();
 void hydrateVisibleMedia();
}
function connectionPage(){
 const saved=mailboxConnection||{};
 root.innerHTML='<main class="login connection"><form class="login-card" id="connection-form"><span class="connection-kicker">АВИТОЛОГ</span><h1>Подключение</h1><p>Подключите личную очередь. Объявления будут отправляться туда сразу после добавления.</p>'+field('Репозиторий','<input name="repo" autocomplete="off" autocapitalize="none" spellcheck="false" required placeholder="владелец/название" value="'+esc(saved.repo||'')+'">')+field('Секретный ключ','<input name="accessKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required value="'+esc(saved.accessKey||'')+'">','Сохраняется только в браузере этого устройства.')+'<div id="form-error" aria-live="polite"></div><button class="btn primary">Подключить</button></form></main>';
}
function normalRepo(value){
 const repo=String(value||'').trim().replace(/^https?:\/\/github\.com\//i,'').replace(/\/$/,'');
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error('Укажите репозиторий в формате владелец/название');
 return repo;
}
async function connectMailbox(form){
 const data=new FormData(form),repo=normalRepo(data.get('repo')),accessKey=String(data.get('accessKey')||'').trim();
 if(!accessKey)throw Error('Введите секретный ключ');
 const candidate={repo,accessKey},previous=mailboxConnection;mailboxConnection=candidate;
 let response;
 try{response=await mailboxRequest('inbox');}catch{mailboxConnection=previous;throw Error('Не удалось подключиться к очереди');}
 if(!response.ok){mailboxConnection=previous;throw Error(response.status===401||response.status===403?'Секретный ключ не подходит':'Очередь недоступна. Проверьте репозиторий');}
 localStorage.setItem(CONNECTION_KEY,JSON.stringify(candidate));
 unlocked=true;
 state=previous?.repo===repo?await readState():blankState();
 await saveState(state);
 await syncMailboxState(true);
 render();queueMailboxSync();queueMailboxResultSync();
}function inlineError(message){const el=document.getElementById('form-error');if(el)el.innerHTML='<p class="inline-error">'+esc(message)+'</p>';else toast(message);}
function prepareCardRequest(saved,existing){
 const signature=cardRequestKey(saved),previous=existing?.cardRequestKey??null;
 if(signature!==previous){saved.cardRequestKey=signature;saved.cardRequestStatus=signature?'requested':null;saved.generatedCards=null;}

 return {signature,previous};
}
async function saveItem(form){
 if(photoBusy)throw Error('Дождитесь загрузки фотографий');
 const f=new FormData(form),isNew=draft.key==='new';
 const raw=String(f.get('raw')||'').trim(),productKind=f.get('productKind')==='batch'?'batch':'single';
 const quantity=productKind==='batch'?(Number(f.get('quantity'))||null):null;
 const data={...(isNew?{}:item(draft.id)),id:isNew?uid():draft.id,status:isNew?'queue':draft.status,title:isNew?(raw.split(/[\n.!?]/)[0]||'Новое объявление').slice(0,50):String(f.get('title')||'').trim(),raw,description:isNew?'':String(f.get('description')||''),photos:draft.photos,imageHistory:structuredClone(draft.imageHistory||[]),price:f.get('price')===''?null:Number(f.get('price')),pickupMinutes:isNew?30:Number(f.get('pickupMinutes')),delivery:!isNew&&f.has('delivery'),productKind,condition:productKind==='single'?(f.get('condition')==='new'?'new':'used'):null,defects:String(f.get('defects')||'').trim(),quantity,generateCards:f.has('generateCards'),cardStyle:normalizeCardStyle(f.get('cardStyle')),cardFormat:normalizeCardFormat(f.get('cardFormat')),cardCount:Number(f.get('cardCount'))||1,updatedAt:new Date().toISOString()};
 const existing=isNew?null:item(draft.id);
 if(existing)data.cardGenerationSettings=existing.cardGenerationSettings||cardSettingsKey(existing);
 if(isNew)data.sourcePhotos=structuredClone(draft.photos);
 else data.sourcePhotos=structuredClone(draft.sourcePhotos||existing?.sourcePhotos||[]);
   if(data.pickupMinutes<30||data.pickupMinutes>480)throw Error('Укажите время получения от 30 до 480 минут');
 const event={id:uid(),type:'item.upsert',payload:normalItem(data)};
 if(isNew)clearTimeout(draftSaveTimer);
 await commit(s=>{const next=receiveEvent(s,event),saved=next.items.find(x=>x.id===data.id),{signature,previous}=isNew?prepareCardRequest(saved,null):{signature:null,previous:null};next.newDraft=null;addOutbox(next,isNew?'item.created':'item.edited',{itemId:data.id,item:saved},{...listingMarkers(saved,isNew?'listing.create':'listing.update'),cards:{...cardSpec(saved),requested:isNew&&!!signature},generateImages:isNew&&!!signature});if(signature&&signature!==previous)addOutbox(next,'cards.requested',{itemId:data.id,item:cardInputItem(saved),sourcePhotos:structuredClone(activeCardPhotos(saved)),requestId:uid(),...cardSpec(saved),requestKey:signature,photoIds:activeCardPhotos(saved).map(p=>p.id)},{action:'cards.generate',listingId:data.id,cards:{...cardSpec(saved),requestKey:signature}});return next;});
 draft=null;go(isNew?'/list/ready':'/item/'+data.id);toast(isNew?'Объявление добавлено':'Изменения сохранены');
}
root.addEventListener('submit',async e=>{
 e.preventDefault();const form=e.target;if(!form.checkValidity()){form.reportValidity();return;}
 const id=form.id,f=new FormData(form),submitter=e.submitter; if(submitter)submitter.disabled=true;
 try{
 if(id==='connection-form')await connectMailbox(form);
 else if(id==='item-form')await saveItem(form);
 else if(id==='price-form'){await updateItem({price:Number(f.get('price'))});render();toast('Цена сохранена');}
 else if(id==='comment-form'){
 const text=String(f.get('text')||'').trim();if(!text)throw Error('Напишите комментарий');
 const itemId=route().parts[1];
  await commit(s=>{const comment={id:uid(),text,createdAt:new Date().toISOString()};const record=s.items.find(x=>x.id===itemId);record.comments.push(comment);record.updatedAt=new Date().toISOString();addOutbox(s,'item.comment',{itemId,comment,item:record},{action:'listing.comment',listingId:itemId});return s;});
 render();toast('Комментарий сохранён для обработки');
 }else if(id==='card-comment-form'){
 const text=String(f.get('text')||'').trim();if(!text)throw Error('Напишите комментарий по фото');
 const itemId=route().parts[1];
 await commit(s=>{const comment={id:uid(),text,createdAt:new Date().toISOString(),scope:'cards'};const record=s.items.find(x=>x.id===itemId);record.cardComments??=[];record.cardComments.push(comment);record.updatedAt=new Date().toISOString();addOutbox(s,'cards.comment',{itemId,comment},{action:'cards.comment',listingId:itemId,photos:(record.photos||[]).map(p=>p.id)});return s;});
 render();toast('Комментарий по фото отправлен в обработку');
 }else if(id==='slot-form'){
 const p={...Object.fromEntries(f),id:uid(),kind:'pickup',updatedAt:new Date().toISOString()};await commit(s=>{const next=addSlot(s,p);addOutbox(next,'calendar.slot.opened',{slot:next.slots.find(x=>x.id===p.id)},{action:'calendar.slot.open',slotId:p.id});return next;});go('/calendar?month='+p.date.slice(0,7)+'&day='+p.date);toast('Время открыто');
 }else if(id==='booking-form'){
 const x=item(f.get('itemId')),o=x.offers.find(v=>v.id===f.get('offerId')),p={...Object.fromEntries(f),buyer:o.buyer,price:o.price};
 await commit(s=>{const next=addBooking(s,p),booking=next.bookings.at(-1);addOutbox(next,'calendar.booking.created',{booking,item:next.items.find(v=>v.id===booking.itemId)},{action:'calendar.booking.create',bookingId:booking.id,listingId:booking.itemId});return next;});go('/slot/'+p.slotId);toast('Встреча сохранена');
 }
 }catch(err){inlineError(err.message);}finally{if(submitter?.isConnected)submitter.disabled=false;}
});
async function updateItem(patch){
 const id=route().parts[1];await commit(s=>{const idx=s.items.findIndex(x=>x.id===id);s.items[idx]=normalItem({...s.items[idx],...patch,updatedAt:new Date().toISOString()});addOutbox(s,'item.edited',{itemId:id,item:s.items[idx],changes:patch},listingMarkers(s.items[idx],'listing.update'));return s;});
}
root.addEventListener('click',async e=>{
 if(photoSortSuppressClick){e.preventDefault();photoSortSuppressClick=false;return;}
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const action=b.dataset.action;
 try{
 if(action==='calendar-toggle'){
  e.preventDefault();
  if(route().path==='/calendar')go(calendarReturnPath||'/analytics');
  else {calendarReturnPath=location.hash.slice(1)||'/analytics';go('/calendar');}
  return;
 }
 if(action==='cards-regenerate'){await requestEditedCards(b);return;}
 if(action==='card-count'){setCardCount(Number(b.dataset.count));const reel=b.closest('.count-reel');if(reel)reel.scrollTo({left:b.offsetLeft-(reel.clientWidth-b.offsetWidth)/2,behavior:'smooth'});return;}
 if(action==='photo-add'){document.getElementById('photo-files').click();return;}
 if(action==='photo-remove'){archiveCurrentPhotos(draft);const [removed]=draft.photos.splice(Number(b.dataset.index),1);if(removed)draft.imageHistory.unshift({id:uid(),label:'Все фотографии',kind:'library',createdAt:new Date().toISOString(),photos:[structuredClone(removed)]});refreshPhotos();return;}
 if(action==='history-add'){const group=availableImageHistory(draft).find(value=>value.id===b.dataset.history),photo=group?.photos?.find(value=>value.id===b.dataset.photo);if(!photo||!mediaSrc(photo))throw Error('Изображение из истории пока недоступно');if(draft.photos.length>=10)throw Error('Можно добавить не больше 10 фотографий');if(draft.photos.some(value=>samePhoto(value,photo))){refreshPhotos();return;}draft.photos.push(structuredClone(photo));refreshPhotos();return;}
 if(action==='cards-toggle'){draft.generateCards=b.checked;refreshCards();queueDraftSave();return;}
 if(action.startsWith('gallery-')){
 const track=document.getElementById('gallery-track');if(!track)return;
 if(action==='gallery-at')track._galleryPick?.(Number(b.dataset.index));else track._galleryStep?.(action==='gallery-next'?1:-1);return;
 }
 b.disabled=true;
 if(action==='delete-draft'){if(!window.confirm('Are you sure? Точно хотите удалить этот черновик?'))return;clearTimeout(draftSaveTimer);draft=null;await commit(s=>{delete s.newDraft;return s;});go('/new');toast('Черновик удалён');}
 else if(action==='set-price'){await updateItem({price:Number(b.dataset.price)});render();}
 else if(action==='set-draft-price'){const price=Number(b.dataset.price);if(!Number.isFinite(price))return;draft.price=price;const input=document.querySelector('input[name=price]');if(input)input.value=price;document.querySelectorAll('[data-action=set-draft-price]').forEach(button=>button.classList.toggle('active',Number(button.dataset.price)===price));queueDraftSave();}
 else if(action==='publish'){
 const x=item(route().parts[1]);if(!x.price||!x.title)throw Error('Укажите заголовок и цену перед публикацией');
  await commit(s=>{const a=s.items.find(i=>i.id===x.id);a.status='published';a.updatedAt=new Date().toISOString();delete a.archivedAt;addOutbox(s,'item.publish',{itemId:x.id,item:a},listingMarkers(a,'listing.publish'));return s;});
 go('/item/'+x.id);toast('Перемещено в «Публик.»');
 }else if(action==='archive-item'||action==='restore-item'){
  const x=item(route().parts[1]);if(!x)return;
  const status=action==='archive-item'?'archived':'published';
   await commit(s=>{const value=s.items.find(i=>i.id===x.id);value.status=status;value.updatedAt=new Date().toISOString();if(status==='archived')value.archivedAt=value.updatedAt;else delete value.archivedAt;addOutbox(s,'item.status',{itemId:x.id,item:value,status,archivedAt:value.archivedAt||null},listingMarkers(value,status==='archived'?'listing.archive':'listing.restore'));return s;});
  go(status==='archived'?'/list/ready':'/item/'+x.id);toast(status==='archived'?'Объявление перенесено в «Готовые» с пометкой «Архив»':'Объявление возвращено в опубликованные');
 }else if(action==='delete-item'){
  const id=route().parts[1],x=item(id);if(!x)return;if(x.status==='published'){toast('Сначала архивируйте объявление');return;}
  if(!window.confirm('Are you sure? Точно хотите удалить это объявление?'))return;
   await updateManifest([], [id]);
   await removeItemRepository(x);
    await commit(s=>{s.items=s.items.filter(value=>value.id!==id);s.deletedMailboxItemIds??=[];if(!s.deletedMailboxItemIds.includes(id))s.deletedMailboxItemIds.push(id);return s;});
  go('/list/ready');toast('Объявление удалено');
 }else if(action==='day-select'){
 const date=b.dataset.date;
 history.replaceState(null,'','#/calendar?month='+date.slice(0,7)+'&day='+date);
 render();requestAnimationFrame(()=>document.getElementById('day-panel')?.scrollIntoView({behavior:'smooth',block:'start'}));
 }else if(action==='remove-slot'){
 const id=b.dataset.id,s=state.slots.find(x=>x.id===id);
  await commit(v=>{if(v.bookings.some(x=>x.slotId===id&&['held','scheduled','confirmed'].includes(x.status)))throw Error('Сначала отмените назначенные встречи');const updatedAt=new Date().toISOString();v.slots=v.slots.filter(x=>x.id!==id);v.calendarSlotTombstones??=[];v.calendarSlotTombstones.push({id,deletedAt:updatedAt});addOutbox(v,'calendar.slot.removed',{slotId:id,updatedAt},{action:'calendar.slot.remove',slotId:id});return v;});
 go('/calendar?month='+s.date.slice(0,7)+'&day='+s.date);
 }else if(action==='cancel-booking'){
 await commit(s=>{const booking=s.bookings.find(x=>x.id===b.dataset.id);const updatedAt=new Date().toISOString();booking.status='cancelled';booking.updatedAt=updatedAt;const o=s.items.find(x=>x.id===booking.itemId)?.offers.find(x=>x.id===booking.offerId);if(o)o.status='pending';addOutbox(s,'calendar.booking.cancelled',{bookingId:booking.id,booking,updatedAt},{action:'calendar.booking.cancel',bookingId:booking.id});return s;});render();toast('Встреча отменена, время освобождено');
 }
 }catch(err){toast(err.message);}finally{if(b.isConnected)b.disabled=false;}
});
function photoSortList(key){if(!draft)return null;if(key==='current')return draft.photos;if(key==='all'){const photos=availableImageHistory(draft)[0].photos;draft.imageHistory=[{id:uid(),label:'Все фотографии',kind:'library',createdAt:new Date().toISOString(),photos}];return draft.imageHistory[0].photos;}if(key==='source')return draft.sourcePhotos;return key.startsWith('history:')?draft.imageHistory?.find(group=>group.id===key.slice(8))?.photos:null;}
function movePhoto(key,from,to){if(key==='all'){const photos=unusedPhotos(draft);if(from===to||from<0||to<0||from>=photos.length||to>=photos.length)return false;photos.splice(to,0,...photos.splice(from,1));draft.imageHistory=[{id:uid(),label:'Все фотографии',kind:'library',createdAt:new Date().toISOString(),photos:[...photos,...structuredClone(draft.photos)]}];return true;}const photos=photoSortList(key);if(!photos||from===to||from<0||to<0||from>=photos.length||to>=photos.length)return false;photos.splice(to,0,...photos.splice(from,1));return true;}
let disposePhotoSorting=null;
function installPhotoSorting(){
 disposePhotoSorting?.();
 const editor=document.getElementById('photo-editor');
 disposePhotoSorting=editor?installPhotoSort(editor,{move:movePhoto,refresh:refreshPhotos}):null;
}
function refreshPhotos(){const el=document.getElementById('photo-editor');if(el){const wasOpen=!!el.querySelector('.photos-collapse[open]');el.innerHTML=photosHtml(draft);const library=el.querySelector('.photos-collapse');if(library)library.open=wasOpen;}installPhotoSorting();queueDraftSave();}
function refreshCards(){const el=document.getElementById('cards-config');if(!el||!draft)return;const temp=document.createElement('div');temp.innerHTML=cardsHtml(draft);const next=temp.querySelector('#cards-config');if(next){el.replaceWith(next);installCountReel();}}
function setCardCount(value){
 if(!draft)return;draft.cardCount=value;
 const input=document.querySelector('input[name=cardCount]');if(input)input.value=value;
 document.querySelectorAll('[data-action=card-count]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.count)===value)));
 refreshCardCountNote();refreshRegenerationButton();queueDraftSave();
}
function installCountReel(){
 const reel=document.querySelector('.count-reel');if(!reel)return;
 const selected=reel.querySelector('[aria-pressed=true]');
 if(selected)requestAnimationFrame(()=>{reel.scrollLeft=selected.offsetLeft-(reel.clientWidth-selected.offsetWidth)/2;});
 let timer;reel.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>{const center=reel.getBoundingClientRect().left+reel.clientWidth/2;const buttons=[...reel.children];const nearest=buttons.reduce((best,button)=>Math.abs(button.getBoundingClientRect().left+button.offsetWidth/2-center)<Math.abs(best.getBoundingClientRect().left+best.offsetWidth/2-center)?button:best);setCardCount(Number(nearest.dataset.count));},120);},{passive:true});
}
function refreshCardCountNote(){const value=Math.max(1,Math.min(10,Number(document.querySelector('input[name=cardCount]')?.value)||1)),note=document.getElementById('card-count-note');if(note)note.textContent='В серии '+plural(value,'карточка','карточки','карточек')+'.';}
function syncProductFields(){const kind=document.querySelector('input[name=productKind]:checked')?.value||'single';document.querySelector('.product-single')?.classList.toggle('is-hidden',kind!=='single');document.querySelector('.product-batch')?.classList.toggle('is-hidden',kind!=='batch');}
let draftSaveTimer;
function syncNewDraft(){const form=document.getElementById('item-form');if(!form||draft?.key!=='new')return;const f=new FormData(form);draft.raw=String(f.get('raw')||'');draft.price=f.get('price')===''?null:Number(f.get('price'));draft.productKind=f.get('productKind')==='batch'?'batch':'single';draft.condition=f.get('condition')==='new'?'new':'used';draft.quantity=Number(f.get('quantity'))||1;draft.defects=String(f.get('defects')||'');draft.generateCards=f.has('generateCards');draft.cardStyle=normalizeCardStyle(f.get('cardStyle'));draft.cardFormat=normalizeCardFormat(f.get('cardFormat'));draft.cardCount=Math.max(1,Math.min(10,Number(f.get('cardCount'))||1));queueDraftSave();}
function queueDraftSave(){if(draft?.key!=='new')return;clearTimeout(draftSaveTimer);draftSaveTimer=setTimeout(()=>{if(draft?.key!=='new')return;const snapshot=structuredClone(draft);commit(s=>{s.newDraft=snapshot;return s;}).catch(()=>toast('Не удалось сохранить черновик'));},600);}
function fileData(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Не удалось прочитать фото '+file.name));r.readAsDataURL(file);});}
function previewData(src){return new Promise(resolve=>{const image=new Image();image.onload=()=>{const max=480,scale=Math.min(1,max/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.72));};image.onerror=()=>resolve(null);image.src=src;});}

async function ingestPhotos(files,input){
 const targetDraft=draft;if(!targetDraft)return;
 try{
 if(photoBusy)throw Error('Фотографии ещё загружаются');
 if(targetDraft.photos.length+files.length>10)throw Error('Максимум 10 фотографий. Свободно мест: '+(10-targetDraft.photos.length));
 if(files.some(f=>!f.type.startsWith('image/')))throw Error('Выберите файлы фотографий');
 if(files.some(f=>f.size>20*1024*1024))throw Error('Одна фотография должна быть не больше 20 МБ');
 photoBusy=true;
 const saved=await Promise.all(files.map(async f=>{const src=await fileData(f);return {id:uid(),name:f.name,type:f.type,src,preview:await previewData(src)};}));
 if(draft!==targetDraft)return;
 rememberPhotoSet(targetDraft,saved,'Все фотографии','source');targetDraft.photos.push(...saved);if(targetDraft.key!=='new'){targetDraft.sourcePhotos??=[];targetDraft.sourcePhotos.push(...structuredClone(saved));}refreshPhotos();toast('Добавлено фото: '+files.length);
 }catch(err){toast(err.message);if(input)input.value='';}finally{photoBusy=false;}
}
root.addEventListener('change',async e=>{
 const input=e.target;
 if(input.name==='productKind'){if(draft)draft.productKind=input.value==='batch'?'batch':'single';syncProductFields();syncNewDraft();return;}
 if(input.name==='cardStyle'&&draft){draft.cardStyle=normalizeCardStyle(input.value);refreshCards();queueDraftSave();return;}
 if(input.name==='cardFormat'&&draft){draft.cardFormat=normalizeCardFormat(input.value);queueDraftSave();return;}
 if(input.name==='cardCount'&&draft){draft.cardCount=Math.max(1,Math.min(10,Number(input.value)||1));refreshCards();queueDraftSave();return;}
 if(draft?.key==='new'&&input.closest('#item-form'))syncNewDraft();
 if(input.id==='booking-slot'){const r=route();go('/item/'+r.parts[1]+'/book/'+r.parts[3]+'?slot='+input.value);return;}
 if(input.id==='photo-files')await ingestPhotos(Array.from(input.files||[]),input);
});
root.addEventListener('paste',async e=>{
 if(!draft)return;
 const files=Array.from(e.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));
 if(files.length){e.preventDefault();await ingestPhotos(files);}
});
root.addEventListener('input',e=>{if(e.target.hasAttribute('data-time-input')){const digits=e.target.value.replace(/\D/g,'').slice(0,4);e.target.value=digits.slice(0,2)+(digits.length>2?':'+digits.slice(2):'');}if(e.target.name==='cardCount'){if(draft)draft.cardCount=Math.max(1,Math.min(10,Number(e.target.value)||1));refreshCardCountNote();}if(draft?.key==='new'&&e.target.closest('#item-form'))syncNewDraft();});
window.addEventListener('hashchange',()=>{window.scrollTo(0,0);render();});
async function boot(){
 try{
  mailboxConnection=JSON.parse(localStorage.getItem(CONNECTION_KEY)||'null');
  unlocked=!!(mailboxConnection?.repo&&mailboxConnection?.accessKey);
  if(unlocked){
   state=await readState();
   void syncMailboxState(true).then(()=>{render();queueMailboxSync();queueMailboxResultSync();});
  }
  render();
 }catch(e){root.innerHTML='<main class="login"><div class="login-card"><h1>Не удалось открыть хранилище</h1><p>'+esc(e.message)+'</p><p>Разрешите хранение данных для сайта и обновите страницу.</p></div></main>';}
}
boot();
