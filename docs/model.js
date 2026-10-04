
export const VERSION = 3;
export const todayKey = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const uid = () => crypto.randomUUID();
export const minutes = time => { if(!/^\d{2}:\d{2}$/.test(time||'')) return NaN; const [h,m]=time.split(':').map(Number); return h<24&&m<60?h*60+m:NaN; };
export const toTime = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export const blankState = () => ({version:VERSION,items:[],slots:[],bookings:[],outbox:[],eventIds:[]});
export function normalItem(x) {
 if(!x.id || !['queue','ready','published','sold'].includes(x.status)) throw Error('Некорректное объявление');
 const price=x.price==null||x.price===''?null:Number(x.price);
 if(price!==null&&(!Number.isFinite(price)||price<0)) throw Error('Укажите корректную цену');
 if((x.photos||[]).length>10) throw Error('Можно добавить не больше 10 фотографий');
 return {title:'Новое объявление',raw:'',description:'',photos:[],comments:[],price:null,fast:null,optimal:null,slow:null,pickupMinutes:60,delivery:false,stats:{views:0,favorites:0,contacts:0},offers:[],createdAt:new Date().toISOString(),...x,price,title:String(x.title||'Новое объявление').slice(0,50)};
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
 s.outbox.push({id:uid(),type:'offer.accepted',payload:p,createdAt:new Date().toISOString()});return s;
}
export function dayLoad(state,date){
 const slots=state.slots.filter(x=>x.date===date);
 if(!slots.length)return 'closed';
 const total=slots.reduce((a,x)=>a+minutes(x.to)-minutes(x.from),0);
 const used=state.bookings.filter(x=>x.date===date&&x.status!=='cancelled').reduce((a,x)=>a+minutes(x.to)-minutes(x.from),0);
 return used===0?'open':used>=total?'full':used/total>=.65?'busy':'some';
}
export function sampleState(){
 let s=blankState();
 const next=new Date(todayKey()+'T12:00:00');next.setDate(next.getDate()+1);
 const tomorrow=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')+'-'+String(next.getDate()).padStart(2,'0');
 const events=[
 {id:'sample-gym-created',type:'item.upsert',payload:{id:'gym',status:'queue',title:'Силовой тренажёр',raw:'Домашний силовой тренажёр. Для выноса потребуется частичная разборка.',price:20000,pickupMinutes:90}},
 {id:'sample-gym-ready',type:'item.upsert',payload:{id:'gym',status:'ready',description:'Силовой тренажёр для домашних занятий.\n\nПеред публикацией уточните модель, габариты, комплектацию и состояние. Для самовывоза предусмотрено 90 минут: потребуется частичная разборка и вынос.',fast:18000,optimal:20000,slow:23000}},
 {id:'sample-treadmill',type:'item.upsert',payload:{id:'treadmill',status:'published',title:'Беговая дорожка',price:28500,pickupMinutes:60,raw:'Складная беговая дорожка. Есть транспортировочные ролики.',description:'Складная беговая дорожка для домашних тренировок.\n\nОсмотр при встрече. Основной способ получения — самовывоз.',stats:{views:94,favorites:11,contacts:4}}},
 {id:'sample-offer-1',type:'offer.upsert',payload:{id:'offer-ivan',itemId:'treadmill',buyer:'Иван',price:26000,method:'pickup',preferredDate:tomorrow,preferredTime:'15:00',messageCount:4,note:'Могу приехать с помощником. Потребуется место для погрузки.'}},
 {id:'sample-offer-2',type:'offer.upsert',payload:{id:'offer-anna',itemId:'treadmill',buyer:'Анна',price:27500,method:'delivery',preferredDate:tomorrow,preferredTime:'18:00',messageCount:2,note:'Можно обсудить доставку? Оплачу отдельно.'}}
 ];
 events.forEach(e=>s=receiveEvent(s,e));return s;
}
