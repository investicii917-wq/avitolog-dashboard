
export const VERSION = 5;
export const todayKey = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const uid = () => crypto.randomUUID();
export const minutes = time => { if(!/^\d{2}:\d{2}$/.test(time||'')) return NaN; const [h,m]=time.split(':').map(Number); return h<24&&m<60?h*60+m:NaN; };
export const toTime = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export const blankState = () => ({version:VERSION,items:[],slots:[],bookings:[],outbox:[],eventIds:[],newDraft:null,deletedMailboxItemIds:[],importedMailboxInbox:[],processedMailboxResults:[],analytics:{updatedAt:null,period:null,source:null}});
export function normalItem(x) {
 if(!x.id || !['queue','ready','published','sold','archived'].includes(x.status)) throw Error('Некорректное объявление');
 const price=x.price==null||x.price===''?null:Number(x.price);
 if(price!==null&&(!Number.isFinite(price)||price<0)) throw Error('Укажите корректную цену');
 if((x.photos||[]).length>10) throw Error('Можно добавить не больше 10 фотографий');
 const productKind=x.productKind==='batch'?'batch':'single';
 const suppliedQuantity=productKind==='batch'?Number(x.quantity):null;
 const quantity=Number.isInteger(suppliedQuantity)&&suppliedQuantity>=1?suppliedQuantity:null;
 const suppliedCardCount=Number(x.cardCount);
 const cardCount=Number.isInteger(suppliedCardCount)&&suppliedCardCount>=1&&suppliedCardCount<=10?suppliedCardCount:1;
 return {title:'Новое объявление',raw:'',description:'',photos:[],comments:[],chats:[],price:null,fast:null,optimal:null,slow:null,pickupMinutes:60,delivery:false,stats:{views:0,favorites:0,contacts:0,messages:0,offers:0},offers:[],createdAt:new Date().toISOString(),productKind:'single',condition:'used',size:'',defects:'',quantity:null,generateCards:false,cardStyle:'realistic',cardCount:1,cardRequestKey:null,cardRequestStatus:null,...x,price,title:String(x.title||'Новое объявление').slice(0,50),productKind,condition:productKind==='single'?(x.condition==='new'?'new':'used'):null,size:String(x.size||'').slice(0,120),defects:String(x.defects||''),quantity,generateCards:!!x.generateCards,cardStyle:x.cardStyle==='studio'?'studio':'realistic',cardCount,stats:{views:0,favorites:0,contacts:0,messages:0,offers:0,...(x.stats||{})},chats:Array.isArray(x.chats)?x.chats:[],comments:Array.isArray(x.comments)?x.comments:[]};
}
export function receiveEvent(state,event) {
 if(!event || !event.id || !event.type) throw Error('У события должны быть id и type');
 if(state.eventIds.includes(event.id)) return state;
 const s=structuredClone(state),p=event.payload;
 if(event.type==='item.upsert'){
  const old=s.items.find(x=>x.id===p?.id);
  const item=normalItem({...old,...p});
  const idx=s.items.findIndex(x=>x.id===item.id);
  if(idx<0)s.items.unshift(item);else s.items[idx]=item;
 } else if(event.type==='offer.upsert'){
  const item=s.items.find(x=>x.id===p?.itemId);
  if(!item || !p.id || !Number.isFinite(Number(p.price))||Number(p.price)<=0) throw Error('Некорректное предложение');
  const offer={status:'pending',method:'pickup',messageCount:1,createdAt:new Date().toISOString(),...p};
  const idx=item.offers.findIndex(o=>o.id===offer.id);
  if(idx<0)item.offers.unshift(offer);else item.offers[idx]=offer;
 } else if(event.type==='chat.upsert'){
  const item=s.items.find(x=>x.id===p?.itemId);
  if(!item || !p.id) throw Error('Некорректная переписка');
  const chat={messages:[],summary:'',updatedAt:new Date().toISOString(),...p};
  item.chats??=[];
  const idx=item.chats.findIndex(c=>c.id===chat.id);
  if(idx<0)item.chats.unshift(chat);else item.chats[idx]={...item.chats[idx],...chat};
 } else if(event.type==='item.status'){
  const item=s.items.find(x=>x.id===p?.itemId);
  if(!item || !['queue','ready','published','sold','archived'].includes(p.status)) throw Error('Некорректный статус объявления');
  item.status=p.status;
  if(p.status==='archived')item.archivedAt=p.archivedAt||item.archivedAt||new Date().toISOString();else delete item.archivedAt;
 } else throw Error('Неизвестное событие: '+event.type);
 s.eventIds.push(event.id);return s;
}
export function addSlot(state,p) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||p.date<todayKey()) throw Error('Нельзя открыть время на прошедшую дату');
 const from=minutes(p.from),to=minutes(p.to);
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from) throw Error('Время окончания должно быть позже начала');
 if(state.slots.some(s=>s.date===p.date&&minutes(s.from)<to&&minutes(s.to)>from)) throw Error('Этот интервал пересекается с уже открытым временем');
 const s=structuredClone(state);s.slots.push({...p,id:p.id||uid(),kind:p.kind==='delivery'?'delivery':'pickup'});return s;
}
export function freeTimes(state,slot,item) {
 const duration=Number(item.pickupMinutes)||60,result=[];
 for(let m=minutes(slot.from);m+duration<=minutes(slot.to);m+=15){
  if(!state.bookings.some(b=>b.date===slot.date&&b.status!=='cancelled'&&minutes(b.from)<m+duration&&minutes(b.to)>m)) result.push(toTime(m));
 }
 return result;
}
export function addBooking(state,p){
 const slot=state.slots.find(x=>x.id===p.slotId),item=state.items.find(x=>x.id===p.itemId);
 if(!slot||!item||slot.date<todayKey())throw Error('Выберите доступный интервал');
 if(!freeTimes(state,slot,item).includes(p.from))throw Error('В это время встреча не помещается или время уже занято');
 const offer=item.offers.find(o=>o.id===p.offerId);
 if(offer&&offer.method!==slot.kind)throw Error('Способ получения не совпадает с интервалом');
 if(offer&&offer.status!=='pending')throw Error('Это предложение уже обработано');
 const s=structuredClone(state),duration=Number(item.pickupMinutes)||60;
 s.bookings.push({...p,id:uid(),date:slot.date,to:toTime(minutes(p.from)+duration),status:'scheduled',method:slot.kind});
 if(offer)s.items.find(x=>x.id===item.id).offers.find(o=>o.id===offer.id).status='accepted';
 return s;
}
export function dayLoad(state,date){
 const slots=state.slots.filter(x=>x.date===date);
 if(!slots.length)return 'closed';
 const total=slots.reduce((a,x)=>a+minutes(x.to)-minutes(x.from),0);
 const used=state.bookings.filter(x=>x.date===date&&x.status!=='cancelled').reduce((a,x)=>a+minutes(x.to)-minutes(x.from),0);
 return used===0?'open':used>=total?'full':used/total>=.65?'busy':'some';
}
export function sampleState(){ return blankState(); }
