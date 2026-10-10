
import {readState,saveState} from './data.js?v=7';
import {uid,todayKey,normalItem,receiveEvent,addSlot,addBooking,freeTimes,dayLoad,minutes} from './model.js?v=11';
const root=document.getElementById('app');
const CONNECTION_KEY='avitolog-mailbox-connection-v1';
let state,unlocked=false,mailboxConnection=null,draft=null,galleryIndex=0,toastTimer,photoBusy=false,commitQueue=Promise.resolve(),mailboxSyncing=false,mailboxSyncTimer,mailboxResultSyncing=false,mailboxResultTimer,mailboxStateTimer,mailboxStateSyncing=false;
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
const shortDate=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
const fullDate=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long'});
const stamp=d=>new Date(d).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const route=()=>{const [path,query='']=(location.hash.slice(1)||'/analytics').split('?');return {path,parts:path.split('/').filter(Boolean),params:new URLSearchParams(query)};};
function go(path){if(location.hash==='#'+path)render();else location.hash=path;}
function toast(message){clearTimeout(toastTimer);const el=document.getElementById('notifications');el.innerHTML='<div class="toast">'+esc(message)+'</div>';toastTimer=setTimeout(()=>el.innerHTML='',4200);}
async function commit(transform){const job=commitQueue.then(async()=>{const next=await transform(structuredClone(state));await saveState(next);state=next;void syncMailbox();void syncMailboxResults();queueMailboxStateSync();return state;});commitQueue=job.catch(()=>{});return job;}
function queueMailboxSync(delay=0){clearTimeout(mailboxSyncTimer);mailboxSyncTimer=setTimeout(()=>{void syncMailbox();},delay);}
function queueMailboxResultSync(delay=0){clearTimeout(mailboxResultTimer);mailboxResultTimer=setTimeout(()=>{void syncMailboxResults();},delay);}
function queueMailboxStateSync(delay=900){clearTimeout(mailboxStateTimer);mailboxStateTimer=setTimeout(()=>{void syncMailboxState();},delay);}
const utcStamp=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getUTCFullYear()+p(d.getUTCMonth()+1)+p(d.getUTCDate())+p(d.getUTCHours())+p(d.getUTCMinutes())+p(d.getUTCSeconds());};
const randomPart=()=>crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7,'0');
const mailboxEvent=(type,payload,markers={})=>({schema:'avitolog.mailbox.v1',id:uid(),type,createdAt:new Date().toISOString(),payload,markers:{origin:'site',...markers}});
const addOutbox=(s,type,payload,markers={})=>{s.outbox.push(mailboxEvent(type,payload,markers));return s;};
const listingMarkers=(record,action)=>({action,listingId:record.id,cards:{requested:!!record.generateCards,style:record.generateCards?record.cardStyle:null,count:record.generateCards?record.cardCount:0}});
const textBase64=value=>{const bytes=new TextEncoder().encode(value);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);};
const dataUriBase64=value=>String(value||'').replace(/^data:[^;]+;base64,/,'');
const mailboxPath=path=>'https://api.github.com/repos/'+mailboxConnection.repo.split('/').map(encodeURIComponent).join('/')+'/contents'+(path?'/'+path.split('/').map(encodeURIComponent).join('/'):'' );
async function mailboxRequest(path,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 try{return await fetch(mailboxPath(path),{...options,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+mailboxConnection.accessKey,...(options.headers||{})},signal:controller.signal});}
 finally{clearTimeout(timeout);}
}
function fileExtension(photo){const type=String(photo.type||'').toLowerCase();if(type.includes('png'))return 'png';if(type.includes('webp'))return 'webp';if(type.includes('gif'))return 'gif';return 'jpg';}
function mailboxManifest(task,attachmentNames){
 const payload=structuredClone(task.payload||{}),photos=payload?.item?.photos;
 if(Array.isArray(photos))payload.item.photos=photos.map((photo,index)=>({id:photo.id,name:photo.name||('photo-'+(index+1)),type:photo.type||'image/jpeg',file:attachmentNames[index]||null}));
 return JSON.stringify({schema:'avitolog.mailbox.v1',id:task.id,type:task.type,createdAt:task.createdAt,payload,markers:task.markers||{},attachments:attachmentNames},null,2);
}
async function putMailboxFile(path,content,message){
 const response=await mailboxRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,content})});
 if(!response.ok)throw Error('Не удалось передать данные в очередь');
}
function mailboxSnapshot(source){
 const copy=structuredClone(source);
 copy.outbox=[];copy.eventIds=[];copy.importedMailboxInbox=[];copy.processedMailboxResults=[];copy.newDraft=null;
 copy.items=(copy.items||[]).map(x=>({...x,photos:(x.photos||[]).map(p=>({...p,src:null,preview:p.preview||null}))}));
 return {schema:'avitolog.state.v1',savedAt:new Date().toISOString(),state:copy};
}
async function syncMailboxState(loadOnly=false){
 if(mailboxStateSyncing||!state||!mailboxConnection?.repo||!mailboxConnection?.accessKey)return;
 mailboxStateSyncing=true;
 try{
  const path='state/site-state.json',response=await mailboxRequest(path);
  let remote=null,sha=null;
  if(response.ok){const payload=await response.json();sha=payload.sha;try{remote=JSON.parse(base64Text(payload.content));}catch{}}
  if(remote?.schema==='avitolog.state.v1'&&remote.state&&loadOnly){
   const localOutbox=state.outbox||[],localDeleted=state.deletedMailboxItemIds||[];
   const imported={importedMailboxInbox:state.importedMailboxInbox||[],processedMailboxResults:state.processedMailboxResults||[]};
   state={...remote.state,...imported,outbox:localOutbox,deletedMailboxItemIds:[...new Set([...(remote.state.deletedMailboxItemIds||[]),...localDeleted])],version:state.version};
   state.items=(state.items||[]).filter(x=>!state.deletedMailboxItemIds.includes(x.id));
   await saveState(state);return;
  }
  if(loadOnly)return;
  const body={message:'Update current Avitolog state',content:textBase64(JSON.stringify(mailboxSnapshot(state)))};if(sha)body.sha=sha;
  const saved=await mailboxRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!saved.ok&&saved.status===409)queueMailboxStateSync(1600);
 }catch{}finally{mailboxStateSyncing=false;}
}
async function sendMailboxEvent(task){
 const prefix=utcStamp()+'-'+randomPart(),photos=['item.created','item.edited'].includes(task.type)&&Array.isArray(task.payload?.item?.photos)?task.payload.item.photos:[],attachmentNames=[];
 for(let index=0;index<photos.length;index++){
  const photo=photos[index],encoded=dataUriBase64(photo.src),extension=fileExtension(photo);
  if(!encoded)continue;
  const name=prefix+'-'+(index+1)+'-photo.'+extension;
  await putMailboxFile('inbox/'+name,encoded,'Add attachment '+name);attachmentNames.push(name);
 }
 const name=prefix+'-text.txt',manifest=mailboxManifest(task,attachmentNames);
 await putMailboxFile('inbox/'+name,textBase64(manifest),'Add announcement '+name);
}
async function syncMailbox(){
 if(mailboxSyncing||!state||!mailboxConnection?.repo||!mailboxConnection?.accessKey)return;
 mailboxSyncing=true;
 try{
  for(const task of state.outbox.filter(x=>!x.deliveredAt)){
   try{await sendMailboxEvent(task);}catch{queueMailboxSync(10000);return;}
   await commit(s=>{const saved=s.outbox.find(x=>x.id===task.id);if(saved)saved.deliveredAt=new Date().toISOString();return s;});
  }
 }finally{mailboxSyncing=false;if(state?.outbox.some(x=>!x.deliveredAt))queueMailboxSync(10000);}
}
const base64Text=value=>{const binary=atob(String(value||'').replace(/\s/g,'')),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes);};
async function readMailboxJson(folder,file){const response=await mailboxRequest(folder+'/'+file.name);if(!response.ok)throw Error('Не удалось прочитать файл очереди');return JSON.parse(base64Text((await response.json()).content));}
const mediaType=photo=>photo.type||({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp'}[(String(photo.file||'').split('.').pop()||'').toLowerCase()]||'image/jpeg');
async function restoreMailboxPhotos(folder,photos){
 const restored=[];
 for(const photo of photos||[]){
  if(photo.src){restored.push(photo);continue;}
  if(!photo.file){restored.push(photo);continue;}
  const response=await mailboxRequest(folder+'/'+photo.file);if(!response.ok)continue;
  const content=(await response.json()).content;
  restored.push({...photo,src:'data:'+mediaType(photo)+';base64,'+String(content||'').replace(/\s/g,'')});
 }
 return restored;
}
function markMailboxFile(s,folder,sha){
 const key=folder==='inbox'?'importedMailboxInbox':'processedMailboxResults';
 s[key]??=[];if(!s[key].includes(sha))s[key].push(sha);
}
function mergeRemoteItem(s,source,photos){
 if(!source?.id||s.deletedMailboxItemIds?.includes(source.id))return;
 const index=s.items.findIndex(x=>x.id===source.id),old=index>=0?s.items[index]:{};
 const next=normalItem({...old,...source,photos:photos?.length?photos:(source.photos||old.photos||[])});
 if(index>=0)s.items[index]=next;else s.items.unshift(next);
}
function applyMailboxEvent(s,event,photos=[]){
 const p=event?.payload||{},remote=p.item||(event?.type==='item.upsert'?p:null);
 if(event?.type==='listing.ready'){
  const source=event.item||remote||{id:event.itemId,status:'queue',photos:event.photos||[]};
  if(!source.id||s.deletedMailboxItemIds?.includes(source.id))return;
  mergeRemoteItem(s,{...source,...(event.listing||{}),id:event.itemId||source.id,status:'ready',processedAt:event.processedAt||new Date().toISOString()},photos);
  return;
 }
 if(event?.type==='item.deleted'&&p.itemId){s.items=s.items.filter(x=>x.id!==p.itemId);s.deletedMailboxItemIds??=[];if(!s.deletedMailboxItemIds.includes(p.itemId))s.deletedMailboxItemIds.push(p.itemId);return;}
 if(remote?.id){mergeRemoteItem(s,remote,photos);return;}
 if(event?.type==='item.status'&&p.itemId){const x=s.items.find(v=>v.id===p.itemId);if(x&&['queue','ready','published','sold','archived'].includes(p.status)){x.status=p.status;if(p.status==='archived')x.archivedAt=p.archivedAt||new Date().toISOString();else delete x.archivedAt;}return;}
 if(event?.type==='item.publish'&&p.itemId){const x=s.items.find(v=>v.id===p.itemId);if(x){x.status='published';delete x.archivedAt;}return;}
 if(event?.type==='item.comment'&&p.itemId&&p.comment){const x=s.items.find(v=>v.id===p.itemId);if(x){x.comments??=[];const i=x.comments.findIndex(v=>v.id===p.comment.id);if(i<0)x.comments.push(p.comment);else x.comments[i]=p.comment;}return;}
 if(event?.type==='offer.upsert'||event?.type==='chat.upsert'){try{receiveEvent(s,event);}catch{}return;}
 if(event?.type==='calendar.slot.opened'&&p.slot?.id){if(!s.slots.some(x=>x.id===p.slot.id))s.slots.push(p.slot);return;}
 if(event?.type==='calendar.slot.removed'&&p.slotId){s.slots=s.slots.filter(x=>x.id!==p.slotId);s.bookings=s.bookings.filter(x=>x.slotId!==p.slotId);return;}
 if(event?.type==='calendar.booking.created'&&p.booking?.id){if(!s.bookings.some(x=>x.id===p.booking.id))s.bookings.push(p.booking);return;}
 if(event?.type==='calendar.booking.cancelled'&&p.bookingId){const x=s.bookings.find(v=>v.id===p.bookingId);if(x)x.status='cancelled';return;}
 if(event?.type==='analytics.snapshot'){for(const report of p.items||[]){const x=s.items.find(v=>v.id===report.itemId);if(x)x.stats={...x.stats,...report.stats,messages:report.messages??x.stats?.messages??0,offers:report.offers??x.offers?.length??0};}s.analytics={updatedAt:p.updatedAt||event.createdAt||new Date().toISOString(),period:p.period||null,source:'avito'};return;}
}
async function importMailboxFolder(folder,processedKey){
 const listResponse=await mailboxRequest(folder);if(!listResponse.ok)return false;
 const files=(await listResponse.json()).filter(file=>file.type==='file'&&file.name!=='.gitkeep'&&(/-text\.txt$/i.test(file.name)||/\.(json|txt)$/i.test(file.name))).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
 for(const file of files){
  if(state[processedKey]?.includes(file.sha))continue;
  let event;try{event=await readMailboxJson(folder,file);}catch{continue;}
  const remote=event?.payload?.item||(event?.type==='item.upsert'?event.payload:null)||(event?.type==='listing.ready'?(event.item||{photos:event.photos||[]}):null);
  const photos=remote?.photos?await restoreMailboxPhotos(folder,remote.photos):[];
  await commit(s=>{if(s[processedKey]?.includes(file.sha))return s;applyMailboxEvent(s,event,photos);markMailboxFile(s,folder,file.sha);return s;});
  if(event?.type==='listing.ready'){toast('Объявление подготовлено к публикации');render();}
 }
 return true;
}
async function syncMailboxInbox(){return importMailboxFolder('inbox','importedMailboxInbox');}
async function syncMailboxResults(){
 if(mailboxResultSyncing||!state||!mailboxConnection?.repo||!mailboxConnection?.accessKey)return;
 mailboxResultSyncing=true;
 try{await syncMailboxInbox();await importMailboxFolder('outbox','processedMailboxResults');}
 catch{}finally{mailboxResultSyncing=false;queueMailboxResultSync(15000);}
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
 return '<header class="main-head">'+link(icon('calendar')+'Календарь','/calendar','calendar-link '+(tab==='calendar'?'active':''))+'<nav class="tabs" aria-label="Разделы">'+tabs.map(([key,label,short,href,count])=>link('<span class="long-label">'+label+'</span><span class="short-label">'+short+'</span><span class="count">'+count+'</span>',href,'tab '+(tab===key?'active':''))).join('')+'</nav></header>';}
function statusIndicator(x){const status=typeof x==='string'?x:x.status,labels={ready:'Готово к публикации',queue:'В обработке',archived:'Архив'},date=status==='archived'&&x.archivedAt?'<span class="archive-date">с '+shortDate(x.archivedAt.slice(0,10))+'</span>':'';return '<span class="processing-status '+(status==='ready'?'ready':status==='archived'?'archived':'processing')+'">'+labels[status]+'</span>'+date;}
function analyticsPage(){
 const demoStats={views:55,favorites:13,messages:3,offers:2,contacts:3};
 const cardItem=state.items.find(x=>/игральн.*(карт|колод)/i.test(x.title||''));
 const published=state.items.filter(x=>x.status==='published');
 const initialRecords=published.length?published:(cardItem?[{...cardItem,status:'published'}]:[]);
 const records=initialRecords.map(x=>{const isDemoCard=/игральн.*(карт|колод)/i.test(x.title||''),s=x.stats||{},hasLive=Number(s.views)||Number(s.favorites)||Number(s.contacts)||Number(s.messages)||Number(s.offers)||(x.offers||[]).length;return isDemoCard&&!hasLive?{...x,stats:{...s,...demoStats},offers:Array.from({length:2},(_,i)=>({id:'demo-'+i}))}:x;});
 const metrics=x=>{const s=x.stats||{},messages=Number(s.messages??s.contacts??(x.chats||[]).length),offers=Number(s.offers??(x.offers||[]).length);return {views:Number(s.views)||0,favorites:Number(s.favorites)||0,messages,offers};};
 const total=records.reduce((a,x)=>{const m=metrics(x);return {views:a.views+m.views,favorites:a.favorites+m.favorites,messages:a.messages+m.messages,offers:a.offers+m.offers};},{views:0,favorites:0,messages:0,offers:0});
 const selected=records[0],funnel=selected?metrics(selected):null;
 const source=state.analytics?.source==='avito'?'Avito API':selected?'Демо-данные':'';
 const top=section('<h1>Интерес к объявлениям</h1><p>Сводка по опубликованным объявлениям'+(source?' · '+source:'')+'.</p><div class="interest-total"><b>'+total.views+'</b><span>просмотров</span></div><div class="metric-row"><span>В избранном <b>'+total.favorites+'</b></span><span>Написали <b>'+total.messages+'</b></span><span>Предложения <b>'+total.offers+'</b></span></div></section>','interest-card');
 const listingInterest=records.length?section('<h2>Интерес по объявлениям</h2><div class="listing-interest">'+records.map(x=>{const m=metrics(x),maximum=Math.max(...records.map(v=>metrics(v).views),1);return '<div class="listing-interest-row"><div><b>'+esc(x.title)+'</b><small>'+m.views+' просмотров · '+m.messages+' написали</small></div><span><i style="width:'+Math.max(8,Math.round(m.views/maximum*100))+'%"></i></span></div>';}).join('')+'</div>','interest-card'):'';
 const funnelCard=funnel?section('<div class="funnel-head"><div><h2>Воронка интереса</h2><p>'+esc(selected.title)+'</p></div><span class="analytics-source">'+source+'</span></div><div class="funnel-bars">'+[['Посмотрели',funnel.views,'views'],['Добавили в избранное',funnel.favorites,'favorites'],['Написали',funnel.messages,'messages'],['Сделали предложение',funnel.offers,'offers']].map(([label,value,key],index)=>{const base=Math.max(funnel.views,1),width=Math.max(10,Math.round(value/base*100));return '<div class="funnel-step step-'+key+'"><div><span>'+label+'</span><b>'+value+'</b></div><i style="width:'+width+'%"></i></div>';}).join('')+'</div>','interest-card funnel-card'):'';
 const empty=section('<h1>Интерес к объявлениям</h1><p>После первой публикации здесь появятся просмотры, избранное, переписки и предложения.</p>','interest-card');
 return header('analytics')+'<main class="container analytics">'+(records.length?top+listingInterest+funnelCard:empty)+'<section class="analytics-top">'+link(icon('comment')+'Смотреть предложения','/offers','btn accent block')+'</section></main>';
}
function allOffersPage(){
 const offers=state.items.flatMap(x=>(x.offers||[]).filter(o=>o.status==='pending').map(o=>({item:x,offer:o}))).sort((a,b)=>String(b.offer.createdAt).localeCompare(String(a.offer.createdAt)));
 return page('Предложения','/analytics',offers.length?'<div class="list global-offers">'+offers.map(({item:x,offer:o})=>link('<div class="thumb">'+(mediaSrc(x.photos[0])?'<img src="'+esc(mediaSrc(x.photos[0]))+'" alt="">':icon('photo'))+'</div><div class="row-info"><div class="row-title">'+esc(x.title)+'</div><div class="offer-price-line">Ваша цена '+money(x.price)+' · <b>'+money(o.price)+'</b></div></div><div class="offer-delivery">'+(o.method==='delivery'?icon('box')+'<small>Доставка</small>':'')+'</div>','/item/'+x.id+'/offers','item-row')).join('')+'</div>':section('<p>Новых предложений пока нет.</p>'));}
function listPage(tab){
 if(tab==='queue')return analyticsPage();if(!['ready','published','archived'].includes(tab))tab='ready';
 const rows=state.items.filter(x=>tab==='ready'?(x.status==='queue'||x.status==='ready'||x.status==='archived'):x.status===tab),empty={ready:['Нет объявлений','Добавьте фотографии и заметки о товаре.'],published:['Пока ничего не опубликовано','Здесь появятся объявления после публикации.'],archived:['Архив пуст','Сюда попадут объявления, которые вы уберёте из публикации.']}[tab];
 if(tab==='ready')rows.sort((a,b)=>{const rank=x=>x.status==='archived'?1:0,diff=rank(a)-rank(b);return diff||(rank(a)?String(b.archivedAt||'').localeCompare(String(a.archivedAt||'')):0);});
 return header(tab)+'<main class="container '+(tab==='ready'?'has-dock':'')+'">'+(tab==='archived'?section(link('Вернуться к опубликованным','/list/published','btn outline block')):'')+(rows.length?'<div class="list">'+rows.map(x=>{const photo=x.photos[0],stats=x.stats||{};return link('<div class="thumb">'+(mediaSrc(photo)?'<img src="'+esc(mediaSrc(photo))+'" alt="">':' '+icon('photo'))+(photo?'<span class="photo-badge">'+x.photos.length+'</span>':'')+'</div><div class="row-info"><div class="row-title">'+esc(x.title)+'</div><div class="row-sub">'+(tab==='published'?'<span class="stat">'+icon('eye')+(stats.views||0)+'</span><span class="stat">'+icon('heart')+(stats.favorites||0)+'</span><span class="stat">'+icon('comment')+(stats.contacts||0)+'</span>':statusIndicator(x))+'</div></div><div class="row-price">'+money(x.price)+'<small>'+x.photos.length+' фото</small></div>','/item/'+x.id,'item-row')}).join('')+'</div>':'<div class="list empty">'+icon('box')+'<h2>'+empty[0]+'</h2><p>'+empty[1]+'</p></div>')+'</main>'+dockHtml(tab==='ready'?link(icon('plus')+'Добавить объявление','/new','btn primary'):'');}
function gallery(x){
 if(!x.photos.length)return '<div class="gallery gallery-empty">'+icon('photo')+'Фотографии пока не добавлены</div>';
 const visible=x.photos.filter(p=>mediaSrc(p));
 if(!visible.length)return '<div class="gallery gallery-empty">'+icon('photo')+'Фотографии переданы в обработку</div>';
 return '<div class="gallery"><div class="gallery-track" id="gallery-track">'+visible.map((p,i)=>'<figure><img src="'+esc(mediaSrc(p))+'" alt="'+esc(x.title)+' — фото '+(i+1)+'"></figure>').join('')+'</div>'+(visible.length>1?'<button class="gallery-arrow left" data-action="gallery-prev" aria-label="Предыдущее фото">'+icon('back')+'</button><button class="gallery-arrow right" data-action="gallery-next" aria-label="Следующее фото">'+icon('next')+'</button>':'')+'<span class="gallery-counter" id="gallery-counter">1 / '+visible.length+'</span></div>'+(visible.length>1?'<div class="gallery-thumbs" aria-label="Фотографии">'+visible.map((p,i)=>'<button data-action="gallery-at" data-index="'+i+'" aria-label="Фото '+(i+1)+'"><img src="'+esc(mediaSrc(p))+'" alt=""></button>').join('')+'</div>':'');
}
function detailPage(x){
 const main=gallery(x)+section('<span class="tag">'+statusName[x.status]+'</span><h1 class="detail-title">'+esc(x.title)+'</h1><div class="detail-price">'+money(x.price)+'</div><div class="facts"><div><span>Самовывоз</span><b>'+x.pickupMinutes+' мин на получение</b></div><div><span>Доставка</span><b>'+(x.delivery?'Можно обсудить':'Не предусмотрена')+'</b></div></div>');
 const stats=x.stats||{},publicationStats=(x.status==='published'||x.status==='archived')?section('<h2>Статистика объявления</h2><div class="stats-grid"><div>'+icon('eye')+'<span>Просмотры</span><b>'+Number(stats.views||0)+'</b></div><div>'+icon('heart')+'<span>В избранном</span><b>'+Number(stats.favorites||0)+'</b></div><div>'+icon('comment')+'<span>Обращения</span><b>'+Number(stats.contacts||0)+'</b></div><div>'+icon('box')+'<span>Предложения</span><b>'+(x.offers||[]).length+'</b></div></div>'):'';
 const actions=x.status==='published'?section('<div class="actions-stack">'+link(icon('comment')+'Написавшие <span class="count">'+(x.chats||[]).length+'</span>'+icon('next'),'/item/'+x.id+'/writers','btn outline')+link(icon('comment')+'Предложения <span class="count">'+x.offers.length+'</span>'+icon('next'),'/item/'+x.id+'/offers','btn accent')+'</div>'):'';
 const prices=x.status==='ready'?section('<h2>Цена продажи</h2><div class="price-choices">'+[['Быстрая',x.fast],['Оптимальная',x.optimal],['Долгая',x.slow]].map(([label,p])=>'<button class="price-choice '+(p===x.price?'active':'')+'" data-action="set-price" data-price="'+(p??'')+'" '+(p==null?'disabled':'')+'><small>'+label+'</small><b>'+money(p)+'</b></button>').join('')+'</div><form id="price-form" class="field"><label for="own-price">Своя цена, ₽</label><div class="inline-form"><input id="own-price" name="price" type="number" inputmode="numeric" min="0" max="1000000000" value="'+(x.price??'')+'" required><button class="btn">Сохранить</button></div></form>'):'';
 const raw=section('<h2>'+(x.status==='queue'?'Информация о товаре':'Исходные заметки')+'</h2><p class="text">'+esc(x.raw||'Заметок пока нет.')+'</p>');
 const desc=x.status!=='queue'||x.description?section('<h2>Описание объявления</h2><div class="description">'+esc(x.description||'Описание пока не составлено.')+'</div>'):'';
 const archiveAction=x.status==='published'?btn(icon('box')+'Архивировать объявление'+icon('next'),'archive-item','outline block action-link'):'';
 const bottom=section('<div class="actions-stack">'+link(icon('comment')+'Добавить комментарий для ИИ'+icon('next'),'/item/'+x.id+'/comments','btn outline')+link(icon('edit')+'Редактировать вручную'+icon('next'),'/item/'+x.id+'/edit','btn outline')+archiveAction+btn('Удалить объявление','delete-item','danger block delete-action')+'</div>','delete-zone');
 const dock=x.status==='ready'?link(icon('edit')+'Редактировать','/item/'+x.id+'/edit','btn')+btn('Опубликовать','publish','primary'):x.status==='archived'?btn('Вернуть в публикацию','restore-item','primary'):'';
 return page(x.title,x.status==='published'||x.status==='sold'?'/list/published':'/list/ready',main+publicationStats+prices+actions+desc+raw+bottom,dock);
}
function getDraft(id){const key=id||'new',fresh={photos:[],title:'',raw:'',description:'',price:null,pickupMinutes:60,delivery:false,productKind:'single',condition:'used',defects:'',quantity:1,generateCards:false,cardStyle:'realistic',cardCount:1};if(!draft||draft.key!==key)draft={key,...(id?structuredClone(item(id)):structuredClone(state?.newDraft||fresh))};return draft;}
function productFields(d){const kind=d.productKind==='batch'?'batch':'single',condition=d.condition==='new'?'new':'used';return '<section class="section product-section"><h2>Параметры товара</h2><div class="segmented" role="radiogroup" aria-label="Тип товара"><label><input type="radio" name="productKind" value="single" '+(kind==='single'?'checked':'')+'><span>Товар 1</span></label><label><input type="radio" name="productKind" value="batch" '+(kind==='batch'?'checked':'')+'><span>Товар тиражный</span></label></div><div class="product-single '+(kind==='single'?'':'is-hidden')+'"><div class="field-label">Состояние</div><div class="segmented condition" role="radiogroup" aria-label="Состояние"><label><input type="radio" name="condition" value="used" '+(condition==='used'?'checked':'')+'><span>Б/у</span></label><label><input type="radio" name="condition" value="new" '+(condition==='new'?'checked':'')+'><span>Новое</span></label></div></div><div class="product-batch '+(kind==='batch'?'':'is-hidden')+'">'+field('Количество штук','<input name="quantity" type="number" min="1" step="1" inputmode="numeric" value="'+(Number(d.quantity)||1)+'">','Укажите, сколько одинаковых единиц есть в наличии.')+'</div>'+field('Дефекты и нюансы','<textarea name="defects" rows="3" placeholder="Если есть — опишите честно. Это попадёт в обработку объявления.">'+esc(d.defects||'')+'</textarea>')+'</section>';}
function cardsHtml(d){const enabled=!!d.generateCards,style=d.cardStyle==='studio'?'studio':'realistic',count=Math.max(1,Math.min(10,Number(d.cardCount)||1));return '<section class="section cards-section"><label class="switch-row card-switch"><span><b>Создать карточки</b><small>Передать обработчику задачу на подготовку вариантов</small></span><input type="checkbox" name="generateCards" data-action="cards-toggle" '+(enabled?'checked':'')+'></label><div id="cards-config" class="cards-config '+(enabled?'':'is-hidden')+'"><div class="divider"></div><h2>Вариант карточек</h2><div class="card-style-options"><label class="card-style-option"><input type="radio" name="cardStyle" value="realistic" '+(style==='realistic'?'checked':'')+'><span><b>Реалистичные</b><small>Предмет в чистой домашней обстановке. Оригинальный товар сохраняется.</small></span></label><label class="card-style-option"><input type="radio" name="cardStyle" value="studio" '+(style==='studio'?'checked':'')+'><span><b>Студийные</b><small>Товарная карточка с аккуратной студийной подачей.</small></span></label></div>'+field('Количество карточек','<input name="cardCount" type="number" min="1" max="10" step="1" inputmode="numeric" value="'+count+'">','<span id="card-count-note">В задачу обработчику будет передано '+plural(count,'карточка','карточки','карточек')+'.</span>')+'</div></section>';}
function photosHtml(d){
 return '<div class="photo-editor-head"><b>Фотографии</b><span class="meta">'+d.photos.length+' / 10</span></div><div class="photo-grid">'+d.photos.map((p,i)=>'<div class="photo-tile"><img src="'+esc(p.src)+'" alt="Фото '+(i+1)+'"><button type="button" class="remove" data-action="photo-remove" data-index="'+i+'" aria-label="Удалить фото '+(i+1)+'">'+icon('close')+'</button>'+(i===0?'<span class="photo-order">Главное</span>':'<button type="button" class="photo-main" data-action="photo-main" data-index="'+i+'">На обложку</button>')+'</div>').join('')+(d.photos.length<10?'<button type="button" class="photo-add" data-action="photo-add">'+icon('plus')+'Добавить фото</button>':'')+'</div><input class="file-input" id="photo-files" type="file" accept="image/*" multiple><p class="help" style="margin-top:10px">Оригиналы фото сохраняются без обработки. До 10 фотографий.</p>';
}
function editPage(id){const d=getDraft(id),isNew=!id,back=isNew?'/list/ready':'/item/'+id;let fields=isNew?field('Что знаете о товаре','<textarea name="raw" rows="7" placeholder="Состояние, комплект, история…">'+esc(d.raw)+'</textarea>'):field('Заголовок','<input name="title" maxlength="50" required value="'+esc(d.title)+'">','До 50 символов')+field('Исходные заметки','<textarea name="raw" rows="5">'+esc(d.raw)+'</textarea>')+field('Описание объявления','<textarea name="description" rows="9">'+esc(d.description)+'</textarea>');fields+=field(isNew?'Желаемая цена, ₽':'Цена, ₽','<input name="price" type="number" min="0" max="1000000000" inputmode="numeric" value="'+(d.price??'')+'" placeholder="Необязательно">');if(!isNew)fields+=field('Время на получение, минут','<input name="pickupMinutes" type="number" inputmode="numeric" min="15" max="480" step="5" required value="'+d.pickupMinutes+'">','Учтите осмотр, разборку и вынос.')+'<label class="switch-row">Доставку можно обсудить<input name="delivery" type="checkbox" '+(d.delivery?'checked':'')+'></label>';return page(isNew?'Новое объявление':'Редактирование',back,'<form id="item-form">'+section('<div id="photo-editor">'+photosHtml(d)+'</div>')+section(fields)+cardsHtml(d)+productFields(d)+'<div id="form-error" aria-live="polite"></div></form>'+(isNew?section(btn('Удалить черновик','delete-draft','danger block'),'delete-zone'):''),'<button class="btn primary" type="submit" form="item-form">'+(isNew?'Добавить объявление':'Сохранить изменения')+'</button>',true);}
function commentsPage(x){return page('Комментарий для ИИ','/item/'+x.id,section('<h2>'+esc(x.title)+'</h2><p>Укажите, что нужно изменить, уточнить или учесть при обработке.</p><form id="comment-form">'+field('Комментарий','<textarea name="text" rows="6" required placeholder="Например: учесть царапины на корпусе и самовывоз вдвоём…"></textarea>')+'</form>')+section('<h2>Комментарии</h2>'+(x.comments.length?x.comments.slice().reverse().map(c=>'<div class="comment">'+esc(c.text)+'<small>'+stamp(c.createdAt)+' · Сохранён для обработки</small></div>').join(''):'<p>Комментариев пока нет.</p>')),'<button class="btn primary" form="comment-form" type="submit">Сохранить комментарий</button>');}
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
 root.innerHTML=!x?missing():parts[2]==='edit'?editPage(x.id):parts[2]==='comments'?commentsPage(x):parts[2]==='offers'?offersPage(x):parts[2]==='writers'?writersPage(x):parts[2]==='chat'?chatPage(x,parts[3]):parts[2]==='book'?bookingPage(x,parts[3],params):detailPage(x);
 }else root.innerHTML=listPage(parts[1]||'queue');
 }catch(e){root.innerHTML=page('Не удалось открыть страницу','/list/queue',section('<p>'+esc(e.message)+'</p>'));}
 const track=document.getElementById('gallery-track');
 if(track)track.addEventListener('scroll',()=>{galleryIndex=Math.round(track.scrollLeft/track.clientWidth);document.getElementById('gallery-counter').textContent=(galleryIndex+1)+' / '+track.children.length;},{passive:true});
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
 unlocked=true;state=await readState();await syncMailboxState(true);queueMailboxSync();queueMailboxResultSync();render();
}
function inlineError(message){const el=document.getElementById('form-error');if(el)el.innerHTML='<p class="inline-error">'+esc(message)+'</p>';else toast(message);}
async function saveItem(form){
 if(photoBusy)throw Error('Дождитесь загрузки фотографий');
 const f=new FormData(form),isNew=draft.key==='new';
 const raw=String(f.get('raw')||'').trim(),productKind=f.get('productKind')==='batch'?'batch':'single';
 const quantity=productKind==='batch'?(Number(f.get('quantity'))||null):null;
 const data={...(isNew?{}:item(draft.id)),id:isNew?uid():draft.id,status:isNew?'queue':draft.status,title:isNew?(raw.split(/[\n.!?]/)[0]||'Новое объявление').slice(0,50):String(f.get('title')||'').trim(),raw,description:isNew?'':String(f.get('description')||''),photos:draft.photos,price:f.get('price')===''?null:Number(f.get('price')),pickupMinutes:isNew?60:Number(f.get('pickupMinutes')),delivery:!isNew&&f.has('delivery'),productKind,condition:productKind==='single'?(f.get('condition')==='new'?'new':'used'):null,defects:String(f.get('defects')||'').trim(),quantity,generateCards:f.has('generateCards'),cardStyle:f.get('cardStyle')==='studio'?'studio':'realistic',cardCount:Number(f.get('cardCount'))||1};
 if(data.pickupMinutes<15||data.pickupMinutes>480)throw Error('Укажите время получения от 15 до 480 минут');
 const event={id:uid(),type:'item.upsert',payload:normalItem(data)};
 if(isNew)clearTimeout(draftSaveTimer);
 await commit(s=>{const next=receiveEvent(s,event),saved=next.items.find(x=>x.id===data.id),signature=saved.generateCards?[saved.cardStyle,saved.cardCount,...saved.photos.map(p=>p.id)].join(':'):null,previous=isNew?null:item(data.id)?.cardRequestKey;next.newDraft=null;if(signature!==previous){saved.cardRequestKey=signature;saved.cardRequestStatus=signature?'requested':null;}addOutbox(next,isNew?'item.created':'item.edited',{itemId:data.id,item:saved},listingMarkers(saved,isNew?'listing.create':'listing.update'));if(signature&&signature!==previous)addOutbox(next,'cards.requested',{itemId:data.id,item:saved,requestId:uid(),style:saved.cardStyle,count:saved.cardCount,photoIds:saved.photos.map(p=>p.id)},{action:'cards.generate',listingId:data.id,cards:{requested:true,style:saved.cardStyle,count:saved.cardCount}});return next;});
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
 await commit(s=>{const comment={id:uid(),text,createdAt:new Date().toISOString()};const record=s.items.find(x=>x.id===itemId);record.comments.push(comment);addOutbox(s,'item.comment',{itemId,comment,item:record},{action:'listing.comment',listingId:itemId});return s;});
 render();toast('Комментарий сохранён для обработки');
 }else if(id==='slot-form'){
 const p={...Object.fromEntries(f),id:uid(),kind:'pickup'};await commit(s=>{const next=addSlot(s,p);addOutbox(next,'calendar.slot.opened',{slot:next.slots.find(x=>x.id===p.id)},{action:'calendar.slot.open',slotId:p.id});return next;});go('/calendar?month='+p.date.slice(0,7)+'&day='+p.date);toast('Время открыто');
 }else if(id==='booking-form'){
 const x=item(f.get('itemId')),o=x.offers.find(v=>v.id===f.get('offerId')),p={...Object.fromEntries(f),buyer:o.buyer,price:o.price};
 await commit(s=>{const next=addBooking(s,p),booking=next.bookings.at(-1);addOutbox(next,'calendar.booking.created',{booking,item:next.items.find(v=>v.id===booking.itemId)},{action:'calendar.booking.create',bookingId:booking.id,listingId:booking.itemId});return next;});go('/slot/'+p.slotId);toast('Встреча сохранена');
 }
 }catch(err){inlineError(err.message);}finally{if(submitter?.isConnected)submitter.disabled=false;}
});
async function updateItem(patch){
 const id=route().parts[1];await commit(s=>{const idx=s.items.findIndex(x=>x.id===id);s.items[idx]=normalItem({...s.items[idx],...patch});addOutbox(s,'item.edited',{itemId:id,item:s.items[idx],changes:patch},listingMarkers(s.items[idx],'listing.update'));return s;});
}
root.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;const action=b.dataset.action;
 try{
 if(action==='photo-add'){document.getElementById('photo-files').click();return;}
 if(action==='photo-remove'){draft.photos.splice(Number(b.dataset.index),1);refreshPhotos();return;}
 if(action==='photo-main'){draft.photos.unshift(...draft.photos.splice(Number(b.dataset.index),1));refreshPhotos();return;}
 if(action==='cards-toggle'){draft.generateCards=b.checked;refreshCards();queueDraftSave();return;}
 if(action.startsWith('gallery-')){
 const track=document.getElementById('gallery-track');let i=action==='gallery-at'?Number(b.dataset.index):galleryIndex+(action==='gallery-next'?1:-1);
 i=Math.max(0,Math.min(track.children.length-1,i));track.scrollTo({left:i*track.clientWidth,behavior:'smooth'});return;
 }
 b.disabled=true;
 if(action==='delete-draft'){if(!window.confirm('Are you sure? Точно хотите удалить этот черновик?'))return;clearTimeout(draftSaveTimer);draft=null;await commit(s=>{delete s.newDraft;return s;});go('/new');toast('Черновик удалён');}
 else if(action==='set-price'){await updateItem({price:Number(b.dataset.price)});render();}
 else if(action==='publish'){
 const x=item(route().parts[1]);if(!x.price||!x.title)throw Error('Укажите заголовок и цену перед публикацией');
  await commit(s=>{const a=s.items.find(i=>i.id===x.id);a.status='published';delete a.archivedAt;addOutbox(s,'item.publish',{itemId:x.id,item:a},listingMarkers(a,'listing.publish'));return s;});
 go('/item/'+x.id);toast('Перемещено в «Публик.»');
 }else if(action==='archive-item'||action==='restore-item'){
  const x=item(route().parts[1]);if(!x)return;
  const status=action==='archive-item'?'archived':'published';
   await commit(s=>{const value=s.items.find(i=>i.id===x.id);value.status=status;if(status==='archived')value.archivedAt=new Date().toISOString();else delete value.archivedAt;addOutbox(s,'item.status',{itemId:x.id,item:value,status,archivedAt:value.archivedAt||null},listingMarkers(value,status==='archived'?'listing.archive':'listing.restore'));return s;});
  go(status==='archived'?'/list/ready':'/item/'+x.id);toast(status==='archived'?'Объявление перенесено в «Готовые» с пометкой «Архив»':'Объявление возвращено в опубликованные');
 }else if(action==='delete-item'){
  const id=route().parts[1],x=item(id);if(!x)return;
  if(!window.confirm('Are you sure? Точно хотите удалить это объявление?'))return;
   await commit(s=>{s.items=s.items.filter(value=>value.id!==id);s.deletedMailboxItemIds??=[];if(!s.deletedMailboxItemIds.includes(id))s.deletedMailboxItemIds.push(id);addOutbox(s,'item.deleted',{itemId:id},{action:'listing.delete',listingId:id});return s;});
  go('/list/ready');toast('Объявление удалено');
 }else if(action==='day-select'){
 const date=b.dataset.date;
 history.replaceState(null,'','#/calendar?month='+date.slice(0,7)+'&day='+date);
 render();requestAnimationFrame(()=>document.getElementById('day-panel')?.scrollIntoView({behavior:'smooth',block:'start'}));
 }else if(action==='remove-slot'){
 const id=b.dataset.id,s=state.slots.find(x=>x.id===id);
  await commit(v=>{if(v.bookings.some(x=>x.slotId===id&&x.status!=='cancelled'))throw Error('Сначала отмените назначенные встречи');v.slots=v.slots.filter(x=>x.id!==id);addOutbox(v,'calendar.slot.removed',{slotId:id},{action:'calendar.slot.remove',slotId:id});return v;});
 go('/calendar?month='+s.date.slice(0,7)+'&day='+s.date);
 }else if(action==='cancel-booking'){
 await commit(s=>{const booking=s.bookings.find(x=>x.id===b.dataset.id);booking.status='cancelled';const o=s.items.find(x=>x.id===booking.itemId)?.offers.find(x=>x.id===booking.offerId);if(o)o.status='pending';addOutbox(s,'calendar.booking.cancelled',{bookingId:booking.id,booking},{action:'calendar.booking.cancel',bookingId:booking.id});return s;});render();toast('Встреча отменена, время освобождено');
 }
 }catch(err){toast(err.message);}finally{if(b.isConnected)b.disabled=false;}
});
function refreshPhotos(){const el=document.getElementById('photo-editor');if(el)el.innerHTML=photosHtml(draft);refreshCards();queueDraftSave();}
function refreshCards(){const el=document.getElementById('cards-config');if(!el||!draft)return;const temp=document.createElement('div');temp.innerHTML=cardsHtml(draft);const next=temp.querySelector('#cards-config');if(next)el.replaceWith(next);}
function refreshCardCountNote(){const value=Math.max(1,Math.min(10,Number(document.querySelector('input[name=cardCount]')?.value)||1)),note=document.getElementById('card-count-note');if(note)note.textContent='В задачу обработчику будет передано '+plural(value,'карточка','карточки','карточек')+'.';}
function syncProductFields(){const kind=document.querySelector('input[name=productKind]:checked')?.value||'single';document.querySelector('.product-single')?.classList.toggle('is-hidden',kind!=='single');document.querySelector('.product-batch')?.classList.toggle('is-hidden',kind!=='batch');}
let draftSaveTimer;
function syncNewDraft(){const form=document.getElementById('item-form');if(!form||draft?.key!=='new')return;const f=new FormData(form);draft.raw=String(f.get('raw')||'');draft.price=f.get('price')===''?null:Number(f.get('price'));draft.productKind=f.get('productKind')==='batch'?'batch':'single';draft.condition=f.get('condition')==='new'?'new':'used';draft.quantity=Number(f.get('quantity'))||1;draft.defects=String(f.get('defects')||'');draft.generateCards=f.has('generateCards');draft.cardStyle=f.get('cardStyle')==='studio'?'studio':'realistic';draft.cardCount=Math.max(1,Math.min(10,Number(f.get('cardCount'))||1));queueDraftSave();}
function queueDraftSave(){if(draft?.key!=='new')return;const snapshot=structuredClone(draft);clearTimeout(draftSaveTimer);draftSaveTimer=setTimeout(()=>{commit(s=>{s.newDraft=snapshot;return s;}).catch(()=>toast('Не удалось сохранить черновик'));},180);}
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
 targetDraft.photos.push(...saved);refreshPhotos();toast('Добавлено фото: '+files.length);
 }catch(err){toast(err.message);if(input)input.value='';}finally{photoBusy=false;}
}
root.addEventListener('change',async e=>{
 const input=e.target;
 if(input.name==='productKind'){if(draft)draft.productKind=input.value==='batch'?'batch':'single';syncProductFields();syncNewDraft();return;}
 if(input.name==='cardStyle'&&draft){draft.cardStyle=input.value==='studio'?'studio':'realistic';refreshCards();queueDraftSave();return;}
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
 try{mailboxConnection=JSON.parse(localStorage.getItem(CONNECTION_KEY)||'null');unlocked=!!(mailboxConnection?.repo&&mailboxConnection?.accessKey);if(unlocked){state=await readState();await syncMailboxState(true);queueMailboxSync();queueMailboxResultSync();}render();}
 catch(e){root.innerHTML='<main class="login"><div class="login-card"><h1>Не удалось открыть хранилище</h1><p>'+esc(e.message)+'</p><p>Разрешите хранение данных для сайта и обновите страницу.</p></div></main>';}
}
boot();
