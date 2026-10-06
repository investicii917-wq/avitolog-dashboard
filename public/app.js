
import {readState,saveState} from './data.js?v=6';
import {uid,todayKey,normalItem,receiveEvent,addSlot,addBooking,freeTimes,dayLoad,minutes} from './model.js?v=6';
const root=document.getElementById('app');
const CONNECTION_KEY='avitolog-bridge-connection-v1';
let state,unlocked=false,bridgeConnection=null,draft=null,galleryIndex=0,toastTimer,photoBusy=false,commitQueue=Promise.resolve();
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
const statusName={queue:'Ожидает обработки',ready:'Готово к публикации',published:'Опубликовано',sold:'Продано'};
const item=id=>state.items.find(x=>x.id===id);
const shortDate=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
const fullDate=d=>new Date(d+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'long',weekday:'long'});
const stamp=d=>new Date(d).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const route=()=>{const [path,query='']=(location.hash.slice(1)||'/analytics').split('?');return {path,parts:path.split('/').filter(Boolean),params:new URLSearchParams(query)};};
function go(path){if(location.hash==='#'+path)render();else location.hash=path;}
function toast(message){clearTimeout(toastTimer);const el=document.getElementById('notifications');el.innerHTML='<div class="toast">'+esc(message)+'</div>';toastTimer=setTimeout(()=>el.innerHTML='',4200);}
async function commit(transform){const job=commitQueue.then(async()=>{const next=await transform(structuredClone(state));await saveState(next);state=next;return state;});commitQueue=job.catch(()=>{});return job;}
const btn=(label,action,cls='')=>'<button type="button" class="btn '+cls+'" data-action="'+action+'">'+label+'</button>';
const link=(label,href,cls='')=>'<a class="'+cls+'" '+(label===icon('back')?'aria-label="Назад" ':label===icon('close')?'aria-label="Закрыть" ':label===icon('next')?'aria-label="Вперёд" ':'')+'href="#'+esc(href)+'">'+label+'</a>';
const section=(body,cls='')=>'<section class="section '+cls+'">'+body+'</section>';
function page(title,back,body,dock='',close=false){return '<header class="page-head"><div class="page-head-inner">'+(!close?link(icon('back'),back,'icon-button'):'')+'<h1>'+esc(title)+'</h1>'+(close?link(icon('close'),back,'icon-button'):'')+'</div></header><main class="page-content '+(dock?'has-dock':'')+'">'+body+'</main>'+dockHtml(dock);}
function dockHtml(body){return body?'<footer class="dock"><div class="dock-inner">'+body+'</div></footer>':'';}
function field(label,control,help=''){return '<label class="field">'+label+control+(help?'<small>'+help+'</small>':'')+'</label>';}
function header(tab){
 const readyCount=state.items.filter(x=>x.status==='queue'||x.status==='ready').length,publishedCount=state.items.filter(x=>x.status==='published').length,offerCount=state.items.reduce((n,x)=>n+(x.offers||[]).filter(o=>o.status==='pending').length,0);
 const tabs=[['analytics','Аналитика','Аналит.','/analytics',offerCount],['ready','Готовые','Готовые','/list/ready',readyCount],['published','Публик.','Публик.','/list/published',publishedCount]];
 return '<header class="main-head">'+link(icon('calendar')+'Календарь','/calendar','calendar-link '+(tab==='calendar'?'active':''))+'<nav class="tabs" aria-label="Разделы">'+tabs.map(([key,label,short,href,count])=>link('<span class="long-label">'+label+'</span><span class="short-label">'+short+'</span><span class="count">'+count+'</span>',href,'tab '+(tab===key?'active':''))).join('')+'</nav></header>';}
function statusIndicator(status){return '<span class="processing-status '+(status==='ready'?'ready':'processing')+'">'+(status==='ready'?'Готово к публикации':'В обработке')+'</span>';}
function analyticsPage(){
 const colors=['#d1b16b','#b77949','#98515a','#8b755b','#6e6870'],rows=state.items.filter(x=>x.status==='published').map((x,i)=>({item:x,value:Math.max(Number(x.stats?.contacts)||0,(x.offers||[]).length),color:colors[i%colors.length]})),total=rows.reduce((n,x)=>n+x.value,0),data=rows.map(x=>({...x,percent:total?Math.round(x.value/total*100):0}));
 let at=0;const segments=total?data.map(x=>{const from=at;at+=x.percent;return x.color+' '+from+'% '+at+'%'}).join(', '):'#e7e2da 0 100%';
 const top=section('<h1>Аналитика</h1><p>Данные появятся после первых событий от MCP-сервера.</p>');
 const chart=data.length?'<section class="interest-card"><h1>Интерес к объявлениям</h1><div class="interest-ring" style="background:conic-gradient('+segments+')"><div><b>'+total+'</b><span>'+plural(total,'интерес','интереса','интересов')+'</span></div></div><div class="interest-legend">'+data.map(x=>'<div class="interest-row"><i style="background:'+x.color+'"></i><span>'+esc(x.item.title)+'</span><b>'+x.percent+'%</b></div>').join('')+'</div></section>':'';
 return header('analytics')+'<main class="container analytics"><section class="analytics-top">'+link(icon('comment')+'Смотреть предложения','/offers','btn accent block')+'</section>'+(!data.length?top:chart)+'</main>';
}
function allOffersPage(){
 const offers=state.items.flatMap(x=>(x.offers||[]).filter(o=>o.status==='pending').map(o=>({item:x,offer:o}))).sort((a,b)=>String(b.offer.createdAt).localeCompare(String(a.offer.createdAt)));
 return page('Предложения','/analytics',offers.length?'<div class="list global-offers">'+offers.map(({item:x,offer:o})=>link('<div class="thumb">'+(x.photos[0]?'<img src="'+esc(x.photos[0].src)+'" alt="">':icon('photo'))+'</div><div class="row-info"><div class="row-title">'+esc(x.title)+'</div><div class="offer-price-line">Ваша цена '+money(x.price)+' · <b>'+money(o.price)+'</b></div></div><div class="offer-delivery">'+(o.method==='delivery'?icon('box')+'<small>Доставка</small>':'')+'</div>','/item/'+x.id+'/offers','item-row')).join('')+'</div>':section('<p>Новых предложений пока нет.</p>'));}
function listPage(tab){
 if(tab==='queue')return analyticsPage();if(!['ready','published'].includes(tab))tab='ready';
 const rows=state.items.filter(x=>tab==='ready'?(x.status==='queue'||x.status==='ready'):x.status===tab);
 return header(tab)+'<main class="container '+(tab==='ready'?'has-dock':'')+'">'+(rows.length?'<div class="list">'+rows.map(x=>{const photo=x.photos[0],stats=x.stats||{};return link('<div class="thumb">'+(photo?'<img src="'+esc(photo.src)+'" alt=""><span class="photo-badge">'+x.photos.length+'</span>':icon('photo'))+'</div><div class="row-info"><div class="row-title">'+esc(x.title)+'</div><div class="row-sub">'+(tab==='published'?'<span class="stat">'+icon('eye')+(stats.views||0)+'</span><span class="stat">'+icon('heart')+(stats.favorites||0)+'</span><span class="stat">'+icon('comment')+(stats.contacts||0)+'</span>':statusIndicator(x.status))+'</div></div><div class="row-price">'+money(x.price)+'<small>'+x.photos.length+' фото</small></div>','/item/'+x.id,'item-row')}).join('')+'</div>':'<div class="list empty">'+icon('box')+'<h2>'+({ready:'Нет объявлений',published:'Пока ничего не опубликовано'})[tab]+'</h2><p>'+(tab==='ready'?'Добавьте фотографии и заметки о товаре.':'Здесь появятся объявления после публикации.')+'</p></div>')+'</main>'+dockHtml(tab==='ready'?link(icon('plus')+'Добавить объявление','/new','btn primary'):'');}
function gallery(x){
 if(!x.photos.length)return '<div class="gallery gallery-empty">'+icon('photo')+'Фотографии пока не добавлены</div>';
 return '<div class="gallery"><div class="gallery-track" id="gallery-track">'+x.photos.map((p,i)=>'<figure><img src="'+esc(p.src)+'" alt="'+esc(x.title)+' — фото '+(i+1)+'"></figure>').join('')+'</div>'+(x.photos.length>1?'<button class="gallery-arrow left" data-action="gallery-prev" aria-label="Предыдущее фото">'+icon('back')+'</button><button class="gallery-arrow right" data-action="gallery-next" aria-label="Следующее фото">'+icon('next')+'</button>':'')+'<span class="gallery-counter" id="gallery-counter">1 / '+x.photos.length+'</span></div>'+(x.photos.length>1?'<div class="gallery-thumbs" aria-label="Фотографии">'+x.photos.map((p,i)=>'<button data-action="gallery-at" data-index="'+i+'" aria-label="Фото '+(i+1)+'"><img src="'+esc(p.src)+'" alt=""></button>').join('')+'</div>':'');
}
function detailPage(x){
 const main=gallery(x)+section('<span class="tag">'+statusName[x.status]+'</span><h1 class="detail-title">'+esc(x.title)+'</h1><div class="detail-price">'+money(x.price)+'</div><div class="facts"><div><span>Самовывоз</span><b>'+x.pickupMinutes+' мин на получение</b></div><div><span>Доставка</span><b>'+(x.delivery?'Можно обсудить':'Не предусмотрена')+'</b></div></div>');
 const actions=section('<div class="actions-stack">'+link(icon('edit')+'Редактировать вручную'+icon('next'),'/item/'+x.id+'/edit','btn outline')+link(icon('comment')+'Добавить комментарий для ИИ'+icon('next'),'/item/'+x.id+'/comments','btn outline')+(x.status==='published'?link(icon('comment')+'Предложения <span class="count">'+x.offers.length+'</span>'+icon('next'),'/item/'+x.id+'/offers','btn accent'):'')+'</div>');
 const prices=x.status==='ready'?section('<h2>Цена продажи</h2><div class="price-choices">'+[['Быстрая',x.fast],['Оптимальная',x.optimal],['Долгая',x.slow]].map(([label,p])=>'<button class="price-choice '+(p===x.price?'active':'')+'" data-action="set-price" data-price="'+(p??'')+'" '+(p==null?'disabled':'')+'><small>'+label+'</small><b>'+money(p)+'</b></button>').join('')+'</div><form id="price-form" class="field"><label for="own-price">Своя цена, ₽</label><div class="inline-form"><input id="own-price" name="price" type="number" inputmode="numeric" min="0" max="1000000000" value="'+(x.price??'')+'" required><button class="btn">Сохранить</button></div></form>'):'';
 const raw=section('<h2>'+(x.status==='queue'?'Информация о товаре':'Исходные заметки')+'</h2><p class="text">'+esc(x.raw||'Заметок пока нет.')+'</p>');
 const desc=x.status!=='queue'||x.description?section('<h2>Описание объявления</h2><div class="description">'+esc(x.description||'Описание пока не составлено.')+'</div>'):'';
 return page(x.title,x.status==='published'||x.status==='sold'?'/list/published':'/list/ready',main+prices+actions+desc+raw,x.status==='ready'?link(icon('edit')+'Редактировать','/item/'+x.id+'/edit','btn')+btn('Опубликовать','publish','primary'):'');
}
function getDraft(id){const key=id||'new',fresh={photos:[],title:'',raw:'',description:'',price:null,pickupMinutes:60,delivery:false,productKind:'single',condition:'used',defects:'',quantity:1,generateCards:false,cardStyle:'realistic'};if(!draft||draft.key!==key)draft={key,...(id?structuredClone(item(id)):structuredClone(state?.newDraft||fresh))};return draft;}
function productFields(d){const kind=d.productKind==='batch'?'batch':'single',condition=d.condition==='new'?'new':'used';return '<section class="section product-section"><h2>Параметры товара</h2><div class="segmented" role="radiogroup" aria-label="Тип товара"><label><input type="radio" name="productKind" value="single" '+(kind==='single'?'checked':'')+'><span>Товар 1</span></label><label><input type="radio" name="productKind" value="batch" '+(kind==='batch'?'checked':'')+'><span>Товар тиражный</span></label></div><div class="product-single '+(kind==='single'?'':'is-hidden')+'"><div class="field-label">Состояние</div><div class="segmented condition" role="radiogroup" aria-label="Состояние"><label><input type="radio" name="condition" value="used" '+(condition==='used'?'checked':'')+'><span>Б/у</span></label><label><input type="radio" name="condition" value="new" '+(condition==='new'?'checked':'')+'><span>Новое</span></label></div></div><div class="product-batch '+(kind==='batch'?'':'is-hidden')+'">'+field('Количество штук','<input name="quantity" type="number" min="1" step="1" inputmode="numeric" value="'+(Number(d.quantity)||1)+'">','Укажите, сколько одинаковых единиц есть в наличии.')+'</div>'+field('Дефекты и нюансы','<textarea name="defects" rows="3" placeholder="Если есть — опишите честно. Это попадёт в обработку объявления.">'+esc(d.defects||'')+'</textarea>')+'</section>';}
function cardsHtml(d){const enabled=!!d.generateCards,style=d.cardStyle==='studio'?'studio':'realistic',previews=d.photos.length?'<div class="card-preview-grid">'+d.photos.map((p,i)=>'<div class="source-cards"><div class="source-card-label">Фото '+(i+1)+'</div><div class="empty-card '+(style==='realistic'?'selected':'')+'"><span>Реалистичная</span><small>Будет создана позже</small></div><div class="empty-card '+(style==='studio'?'selected':'')+'"><span>Студийная</span><small>Будет создана позже</small></div></div>').join('')+'</div>':'<div class="cards-empty">Добавьте фотографии — для каждой появятся две будущие карточки.</div>';return '<section class="section cards-section"><label class="switch-row card-switch"><span><b>Создать карточки</b><small>Подготовить задачу для генерации вариантов</small></span><input type="checkbox" name="generateCards" data-action="cards-toggle" '+(enabled?'checked':'')+'></label><div id="cards-config" class="cards-config '+(enabled?'':'is-hidden')+'"><div class="divider"></div><h2>Вариант карточек</h2><div class="card-style-options"><label class="card-style-option"><input type="radio" name="cardStyle" value="realistic" '+(style==='realistic'?'checked':'')+'><span><b>Реалистичные</b><small>Предмет в чистой домашней обстановке. Оригинальный товар сохраняется.</small></span></label><label class="card-style-option"><input type="radio" name="cardStyle" value="studio" '+(style==='studio'?'checked':'')+'><span><b>Студийные</b><small>Товарная карточка с аккуратной студийной подачей.</small></span></label></div><p class="cards-note">Сейчас это только заготовки: изображения появятся после подключения обработчика.</p>'+previews+'</div></section>';}
function photosHtml(d){
 return '<div class="photo-editor-head"><b>Фотографии</b><span class="meta">'+d.photos.length+' / 10</span></div><div class="photo-grid">'+d.photos.map((p,i)=>'<div class="photo-tile"><img src="'+esc(p.src)+'" alt="Фото '+(i+1)+'"><button type="button" class="remove" data-action="photo-remove" data-index="'+i+'" aria-label="Удалить фото '+(i+1)+'">'+icon('close')+'</button>'+(i===0?'<span class="photo-order">Главное</span>':'<button type="button" class="photo-main" data-action="photo-main" data-index="'+i+'">На обложку</button>')+'</div>').join('')+(d.photos.length<10?'<button type="button" class="photo-add" data-action="photo-add">'+icon('plus')+'Добавить фото</button>':'')+'</div><input class="file-input" id="photo-files" type="file" accept="image/*" multiple><p class="help" style="margin-top:10px">Оригиналы фото сохраняются без обработки. До 10 фотографий.</p>';
}
function editPage(id){const d=getDraft(id),isNew=!id,back=isNew?'/list/ready':'/item/'+id;let fields=isNew?field('Что знаете о товаре','<textarea name="raw" rows="7" required placeholder="Состояние, комплект, история…">'+esc(d.raw)+'</textarea>'):field('Заголовок','<input name="title" maxlength="50" required value="'+esc(d.title)+'">','До 50 символов')+field('Исходные заметки','<textarea name="raw" rows="5">'+esc(d.raw)+'</textarea>')+field('Описание объявления','<textarea name="description" rows="9">'+esc(d.description)+'</textarea>');fields+=field(isNew?'Желаемая цена, ₽':'Цена, ₽','<input name="price" type="number" min="0" max="1000000000" inputmode="numeric" value="'+(d.price??'')+'" placeholder="Необязательно">');if(!isNew)fields+=field('Время на получение, минут','<input name="pickupMinutes" type="number" inputmode="numeric" min="15" max="480" step="5" required value="'+d.pickupMinutes+'">','Учтите осмотр, разборку и вынос.')+'<label class="switch-row">Доставку можно обсудить<input name="delivery" type="checkbox" '+(d.delivery?'checked':'')+'></label>';return page(isNew?'Новое объявление':'Редактирование',back,'<form id="item-form">'+section('<div id="photo-editor">'+photosHtml(d)+'</div>')+section(fields)+cardsHtml(d)+productFields(d)+'<div id="form-error" aria-live="polite"></div></form>'+(isNew?section(btn('Удалить черновик','delete-draft','danger block'),'delete-zone'):''),'<button class="btn primary" type="submit" form="item-form">'+(isNew?'Добавить объявление':'Сохранить изменения')+'</button>',true);}
function commentsPage(x){return page('Комментарий для ИИ','/item/'+x.id,section('<h2>'+esc(x.title)+'</h2><p>Укажите, что нужно изменить, уточнить или учесть при обработке.</p><form id="comment-form">'+field('Комментарий','<textarea name="text" rows="6" required placeholder="Например: учесть царапины на корпусе и самовывоз вдвоём…"></textarea>')+'</form>')+section('<h2>Комментарии</h2>'+(x.comments.length?x.comments.slice().reverse().map(c=>'<div class="comment">'+esc(c.text)+'<small>'+stamp(c.createdAt)+' · Сохранён для обработки</small></div>').join(''):'<p>Комментариев пока нет.</p>')),'<button class="btn primary" form="comment-form" type="submit">Сохранить комментарий</button>');}
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
 root.innerHTML=!x?missing():parts[2]==='edit'?editPage(x.id):parts[2]==='comments'?commentsPage(x):parts[2]==='offers'?offersPage(x):parts[2]==='book'?bookingPage(x,parts[3],params):detailPage(x);
 }else root.innerHTML=listPage(parts[1]||'queue');
 }catch(e){root.innerHTML=page('Не удалось открыть страницу','/list/queue',section('<p>'+esc(e.message)+'</p>'));}
 const track=document.getElementById('gallery-track');
 if(track)track.addEventListener('scroll',()=>{galleryIndex=Math.round(track.scrollLeft/track.clientWidth);document.getElementById('gallery-counter').textContent=(galleryIndex+1)+' / '+track.children.length;},{passive:true});
}
function connectionPage(){
 const saved=bridgeConnection||{};
 root.innerHTML='<main class="login connection"><form class="login-card" id="connection-form"><span class="connection-kicker">АВИТОЛОГ</span><h1>Подключение</h1><p>Выберите свой сервер и вставьте строку доступа, которую он создал.</p>'+field('Сервер','<select name="server" aria-label="Сервер"><option value="avitolog-bridge">Мост Авитолога</option></select>')+field('Адрес сервера','<input name="bridgeUrl" type="url" inputmode="url" autocomplete="url" required placeholder="https://…" value="'+esc(saved.bridgeUrl||'')+'">')+field('Строка подключения','<input name="accessKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required placeholder="Ключ моста" value="'+esc(saved.accessKey||'')+'">','Сохраняется только в браузере этого устройства.')+'<div id="form-error" aria-live="polite"></div><button class="btn primary">Подключить</button></form></main>';
}
function normalBridgeUrl(value){
 const url=new URL(String(value||'').trim());
 if(!['https:','http:'].includes(url.protocol))throw Error('Укажите адрес сервера с http:// или https://');
 return url.href.replace(/\/$/,'');
}
async function connectBridge(form){
 const data=new FormData(form),bridgeUrl=normalBridgeUrl(data.get('bridgeUrl')),accessKey=String(data.get('accessKey')||'').trim();
 if(!accessKey)throw Error('Вставьте строку подключения');
 let response;
 try{response=await fetch(bridgeUrl+'/api/v1/state',{headers:{'X-Avitolog-Key':accessKey},cache:'no-store'});}
 catch{throw Error('Сервер недоступен. Проверьте адрес и его запуск.');}
 if(response.status===401)throw Error('Строка подключения не подошла этому серверу');
 if(!response.ok)throw Error('Сервер ответил с ошибкой '+response.status);
 bridgeConnection={server:String(data.get('server')||'avitolog-bridge'),bridgeUrl,accessKey};
 localStorage.setItem(CONNECTION_KEY,JSON.stringify(bridgeConnection));
 unlocked=true;state=await readState();render();
}
function inlineError(message){const el=document.getElementById('form-error');if(el)el.innerHTML='<p class="inline-error">'+esc(message)+'</p>';else toast(message);}
async function saveItem(form){
 if(photoBusy)throw Error('Дождитесь загрузки фотографий');
 const f=new FormData(form),isNew=draft.key==='new';
 const raw=String(f.get('raw')||'').trim(),productKind=f.get('productKind')==='batch'?'batch':'single';
 const quantity=productKind==='batch'?Number(f.get('quantity')):null;
 if(productKind==='batch'&&(!Number.isInteger(quantity)||quantity<1))throw Error('Укажите количество товара');
 const data={...(isNew?{}:item(draft.id)),id:isNew?uid():draft.id,status:isNew?'queue':draft.status,title:isNew?(raw.split(/[\n.!?]/)[0]||'Новое объявление').slice(0,50):String(f.get('title')||'').trim(),raw,description:isNew?'':String(f.get('description')||''),photos:draft.photos,price:f.get('price')===''?null:Number(f.get('price')),pickupMinutes:isNew?60:Number(f.get('pickupMinutes')),delivery:!isNew&&f.has('delivery'),productKind,condition:productKind==='single'?(f.get('condition')==='new'?'new':'used'):null,defects:String(f.get('defects')||'').trim(),quantity,generateCards:f.has('generateCards'),cardStyle:f.get('cardStyle')==='studio'?'studio':'realistic'};
 if(!raw&&isNew)throw Error('Добавьте заметки о товаре');
 if(data.pickupMinutes<15||data.pickupMinutes>480)throw Error('Укажите время получения от 15 до 480 минут');
 const event={id:uid(),type:'item.upsert',payload:normalItem(data)};
 await commit(s=>{const next=receiveEvent(s,event),now=new Date().toISOString();next.newDraft=null;next.outbox.push({id:uid(),type:isNew?'item.created':'item.edited',payload:{itemId:data.id,item:event.payload},createdAt:now});if(data.generateCards)next.outbox.push({id:uid(),type:'cards.requested',payload:{itemId:data.id,style:data.cardStyle,photoIds:data.photos.map(p=>p.id)},createdAt:now});return next;});
 draft=null;go(isNew?'/list/ready':'/item/'+data.id);toast(isNew?'Объявление добавлено':'Изменения сохранены');
}
root.addEventListener('submit',async e=>{
 e.preventDefault();const form=e.target;if(!form.checkValidity()){form.reportValidity();return;}
 const id=form.id,f=new FormData(form),submitter=e.submitter; if(submitter)submitter.disabled=true;
 try{
 if(id==='connection-form')await connectBridge(form);
 else if(id==='item-form')await saveItem(form);
 else if(id==='price-form'){await updateItem({price:Number(f.get('price'))});render();toast('Цена сохранена');}
 else if(id==='comment-form'){
 const text=String(f.get('text')||'').trim();if(!text)throw Error('Напишите комментарий');
 const itemId=route().parts[1];
 await commit(s=>{const comment={id:uid(),text,createdAt:new Date().toISOString()};s.items.find(x=>x.id===itemId).comments.push(comment);s.outbox.push({id:uid(),type:'item.comment',payload:{itemId,...comment},createdAt:comment.createdAt});return s;});
 render();toast('Комментарий сохранён для обработки');
 }else if(id==='slot-form'){
 const p=Object.fromEntries(f);await commit(s=>addSlot(s,p));go('/calendar?month='+p.date.slice(0,7)+'&day='+p.date);toast('Время открыто');
 }else if(id==='booking-form'){
 const x=item(f.get('itemId')),o=x.offers.find(v=>v.id===f.get('offerId')),p={...Object.fromEntries(f),buyer:o.buyer,price:o.price};
 await commit(s=>addBooking(s,p));go('/slot/'+p.slotId);toast('Встреча сохранена');
 }
 }catch(err){inlineError(err.message);}finally{if(submitter?.isConnected)submitter.disabled=false;}
});
async function updateItem(patch){
 const id=route().parts[1];await commit(s=>{const idx=s.items.findIndex(x=>x.id===id);s.items[idx]=normalItem({...s.items[idx],...patch});s.outbox.push({id:uid(),type:'item.edited',payload:{itemId:id,...patch},createdAt:new Date().toISOString()});return s;});
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
 await commit(s=>{const a=s.items.find(i=>i.id===x.id);a.status='published';s.outbox.push({id:uid(),type:'item.publish',payload:{itemId:x.id},createdAt:new Date().toISOString()});return s;});
 go('/item/'+x.id);toast('Перемещено в «Публик.»');
 }else if(action==='day-select'){
 const date=b.dataset.date;
 history.replaceState(null,'','#/calendar?month='+date.slice(0,7)+'&day='+date);
 render();requestAnimationFrame(()=>document.getElementById('day-panel')?.scrollIntoView({behavior:'smooth',block:'start'}));
 }else if(action==='remove-slot'){
 const id=b.dataset.id,s=state.slots.find(x=>x.id===id);
 await commit(v=>{if(v.bookings.some(x=>x.slotId===id&&x.status!=='cancelled'))throw Error('Сначала отмените назначенные встречи');v.slots=v.slots.filter(x=>x.id!==id);return v;});
 go('/calendar?month='+s.date.slice(0,7)+'&day='+s.date);
 }else if(action==='cancel-booking'){
 await commit(s=>{const booking=s.bookings.find(x=>x.id===b.dataset.id);booking.status='cancelled';const o=s.items.find(x=>x.id===booking.itemId)?.offers.find(x=>x.id===booking.offerId);if(o)o.status='pending';return s;});render();toast('Встреча отменена, время освобождено');
 }
 }catch(err){toast(err.message);}finally{if(b.isConnected)b.disabled=false;}
});
function refreshPhotos(){const el=document.getElementById('photo-editor');if(el)el.innerHTML=photosHtml(draft);refreshCards();queueDraftSave();}
function refreshCards(){const el=document.getElementById('cards-config');if(!el||!draft)return;const temp=document.createElement('div');temp.innerHTML=cardsHtml(draft);const next=temp.querySelector('#cards-config');if(next)el.replaceWith(next);}
function syncProductFields(){const kind=document.querySelector('input[name=productKind]:checked')?.value||'single';document.querySelector('.product-single')?.classList.toggle('is-hidden',kind!=='single');document.querySelector('.product-batch')?.classList.toggle('is-hidden',kind!=='batch');}
let draftSaveTimer;
function syncNewDraft(){const form=document.getElementById('item-form');if(!form||draft?.key!=='new')return;const f=new FormData(form);draft.raw=String(f.get('raw')||'');draft.price=f.get('price')===''?null:Number(f.get('price'));draft.productKind=f.get('productKind')==='batch'?'batch':'single';draft.condition=f.get('condition')==='new'?'new':'used';draft.quantity=Number(f.get('quantity'))||1;draft.defects=String(f.get('defects')||'');draft.generateCards=f.has('generateCards');draft.cardStyle=f.get('cardStyle')==='studio'?'studio':'realistic';queueDraftSave();}
function queueDraftSave(){if(draft?.key!=='new')return;const snapshot=structuredClone(draft);clearTimeout(draftSaveTimer);draftSaveTimer=setTimeout(()=>{commit(s=>{s.newDraft=snapshot;return s;}).catch(()=>toast('Не удалось сохранить черновик'));},180);}
function fileData(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Не удалось прочитать фото '+file.name));r.readAsDataURL(file);});}

async function ingestPhotos(files,input){
 const targetDraft=draft;if(!targetDraft)return;
 try{
 if(photoBusy)throw Error('Фотографии ещё загружаются');
 if(targetDraft.photos.length+files.length>10)throw Error('Максимум 10 фотографий. Свободно мест: '+(10-targetDraft.photos.length));
 if(files.some(f=>!f.type.startsWith('image/')))throw Error('Выберите файлы фотографий');
 if(files.some(f=>f.size>20*1024*1024))throw Error('Одна фотография должна быть не больше 20 МБ');
 photoBusy=true;
 const saved=await Promise.all(files.map(async f=>({id:uid(),name:f.name,type:f.type,src:await fileData(f)})));
 if(draft!==targetDraft)return;
 targetDraft.photos.push(...saved);refreshPhotos();toast('Добавлено фото: '+files.length);
 }catch(err){toast(err.message);if(input)input.value='';}finally{photoBusy=false;}
}
root.addEventListener('change',async e=>{
 const input=e.target;
 if(input.name==='productKind'){if(draft)draft.productKind=input.value==='batch'?'batch':'single';syncProductFields();syncNewDraft();return;}
 if(input.name==='cardStyle'&&draft){draft.cardStyle=input.value==='studio'?'studio':'realistic';refreshCards();queueDraftSave();return;}
 if(draft?.key==='new'&&input.closest('#item-form'))syncNewDraft();
 if(input.id==='booking-slot'){const r=route();go('/item/'+r.parts[1]+'/book/'+r.parts[3]+'?slot='+input.value);return;}
 if(input.id==='photo-files')await ingestPhotos(Array.from(input.files||[]),input);
});
root.addEventListener('paste',async e=>{
 if(!draft)return;
 const files=Array.from(e.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));
 if(files.length){e.preventDefault();await ingestPhotos(files);}
});
root.addEventListener('input',e=>{if(e.target.hasAttribute('data-time-input')){const digits=e.target.value.replace(/\D/g,'').slice(0,4);e.target.value=digits.slice(0,2)+(digits.length>2?':'+digits.slice(2):'');}if(draft?.key==='new'&&e.target.closest('#item-form'))syncNewDraft();});
window.addEventListener('hashchange',()=>{window.scrollTo(0,0);render();});
window.avitologBridge=Object.freeze({
 receive:async event=>{if(!unlocked)throw Error('Сначала подключите сервер');await commit(s=>receiveEvent(s,event));render();return {ok:true,eventId:event.id};},
 export:()=>{if(!unlocked)throw Error('Сначала подключите сервер');return structuredClone(state);}
});
async function boot(){
 try{bridgeConnection=JSON.parse(localStorage.getItem(CONNECTION_KEY)||'null');unlocked=!!(bridgeConnection?.bridgeUrl&&bridgeConnection?.accessKey);if(unlocked)state=await readState();render();}
 catch(e){root.innerHTML='<main class="login"><div class="login-card"><h1>Не удалось открыть хранилище</h1><p>'+esc(e.message)+'</p><p>Разрешите хранение данных для сайта и обновите страницу.</p></div></main>';}
}
boot();
