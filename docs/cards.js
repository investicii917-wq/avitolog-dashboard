// Shared contract: UI, mailbox and local processor use the same vocabulary.
export const CARD_STYLES = Object.freeze({
 realistic: {label:'Домашние', description:'Товар в чистой, красивой домашней обстановке.'},
 studio: {label:'Студийные', description:'Предметная съёмка с аккуратным светом и фоном.'},
 designer: {label:'Дизайнерские', description:'Студийное фото с оформлением и преимуществами из описания.'}
});
export const normalizeCardStyle = value => Object.hasOwn(CARD_STYLES,value) ? value : 'realistic';
export const normalizeCardFormat = value => ['landscape','portrait'].includes(value) ? value : 'auto';
export const normalizeCardCount = value => Number.isInteger(Number(value)) && Number(value)>=1 && Number(value)<=10 ? Number(value) : 1;
const sourceKey=photo=>photo?.id||photo?.path||photo?.mediaPath||photo?.file||photo?.src||photo?.preview||null;
const generatedPhoto=photo=>String(photo?.path||photo?.mediaPath||'').startsWith('images/generated/');
export function cardSourcePhotos(record) {
 const history=Array.isArray(record?.imageHistory)?record.imageHistory:[];
 const sourceGroups=history.filter(group=>group?.kind==='source').flatMap(group=>group.photos||[]);
 const originalPaths=[...sourceGroups,...(record?.sourcePhotos||[]),...(record?.photos||[]),...history.flatMap(group=>group.photos||[])].filter(photo=>String(photo?.path||photo?.mediaPath||'').startsWith('images/originals/'));
 const candidates=originalPaths.length?originalPaths:[...sourceGroups,...(record?.sourcePhotos||[]).filter(photo=>!generatedPhoto(photo))];
 const seen=new Set();
 return candidates.filter(photo=>{const key=sourceKey(photo);if(!key||seen.has(key))return false;seen.add(key);return true;});
}
export function cardSpec(record) {
 const format=normalizeCardFormat(record.cardFormat),requested=!!record.generateCards;
 const style=requested?normalizeCardStyle(record.cardStyle):null;
 const aspectRatio=format==='landscape'?'4:3':format==='portrait'?'3:4':null;
 return {contractVersion:4,requested,style,styleLabel:style?CARD_STYLES[style].label:null,
  count:requested?normalizeCardCount(record.cardCount):0,format,
  formatLabel:format==='landscape'?'горизонтальный 4:3':format==='portrait'?'вертикальный 3:4':'подобрать по товару',
  aspectRatio,aspectRatioPolicy:aspectRatio?'fixed':'square-cover-then-uniform-series',
  coverAspectRatio:'1:1',uniformAspectRatio:false,baseStyle:style==='designer'?'studio':null,
  factsSource:'listing.description-only',preserveProduct:true,
  guide:'instructions/cards/README.md'};
}
export function cardRequestKey(record) {
 if(!record.generateCards)return null;
 // Canonical source description: changes to facts or images invalidate old results.
 return JSON.stringify({cards:cardSpec(record),title:record.title||'',raw:record.raw||'',
  description:record.description||'',price:record.price??null,condition:record.condition??null,
  productKind:record.productKind||'single',quantity:record.quantity??null,
  photos:cardSourcePhotos(record).map(p=>({id:p.id,file:p.file||null,name:p.name||'',revision:p.sha||p.updatedAt||null}))});
}
export function cardResultProblem(record, result) {
 if(!record||!record.generateCards)return 'Карточки больше не запрошены';
 if(result.requestKey!==record.cardRequestKey)return 'Результат относится к прошлой версии задания';
 if(normalizeCardStyle(record.cardStyle)!==result.style)return 'Стиль результата не совпадает с заданием';
 if(!['4:3','3:4'].includes(result.aspectRatio))return 'Не указан формат серии';
 const wanted=cardSpec(record).aspectRatio;
 if(wanted&&wanted!==result.aspectRatio)return 'Формат результата не совпадает с заданием';
 if(!Array.isArray(result.photos)||result.photos.length!==normalizeCardCount(record.cardCount))return 'Получены не все карточки';
 const [w,h]=result.aspectRatio.split(':').map(Number);
 if(new Set(result.photos.map(p=>p.id)).size!==result.photos.length)return 'Повторяются номера карточек';
 for(const [index,photo] of result.photos.entries()){
  const [pw,ph]=index===0?[1,1]:[w,h];
  if(!photo.id||(!photo.file&&!photo.src)||!Number.isInteger(photo.width)||!Number.isInteger(photo.height)||photo.width<1||photo.height<1||photo.width*ph!==photo.height*pw)return 'Первая карточка должна быть квадратной, остальные — в формате серии';
 }
 return null;
}
