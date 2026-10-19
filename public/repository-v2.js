export const REPOSITORY_SCHEMA=2;
export const PAGE_SIZE=50;

export const listingPaths=id=>({
 item:`listings/${id}/item.json`,
 media:`listings/${id}/media.json`,
 offers:`listings/${id}/offers.json`,
 chatIndex:`chats/${id}/index.json`,
 originals:`media/${id}/originals`,
 generated:`media/${id}/generated`,
 previews:`media/${id}/previews`
});

export const indexPath=(status,page=1)=>`indexes/${status}/page-${String(page).padStart(4,'0')}.json`;

export function indexRow(item){
 const photo=item.photos?.[0]||{};
 return {listingId:item.id,title:item.title,status:item.status,price:item.price,coverId:photo.id||null,coverPreview:photo.previewPath||null,stats:item.stats||{},revision:item.revision||0,updatedAt:item.updatedAt};
}

export function splitPages(items,size=PAGE_SIZE){
 const pages=[];
 for(let offset=0;offset<items.length;offset+=size)pages.push(items.slice(offset,offset+size));
 return pages;
}

export function mediaDocument(item){
 const catalog=[],seen=new Set(),add=(photo,kind,createdAt)=>{
  if(!photo||seen.has(photo.id))return;
  seen.add(photo.id);
  catalog.push({id:photo.id,name:photo.name||'',type:photo.type||'image/jpeg',kind,createdAt:createdAt||item.updatedAt||item.createdAt||null,originalPath:photo.originalPath||null,generatedPath:photo.generatedPath||null,previewPath:photo.previewPath||null,width:photo.width||null,height:photo.height||null});
 };
 for(const photo of item.sourcePhotos||[])add(photo,'source',item.createdAt);
 for(const group of item.imageHistory||[])for(const photo of group.photos||[])add(photo,group.kind||'history',group.createdAt);
 for(const photo of item.photos||[])add(photo,item.generatedCards?'generated':'source',item.updatedAt);
 for(const photo of item.contextPhotos||[])add(photo,'context',item.updatedAt);
 return {schemaVersion:REPOSITORY_SCHEMA,listingId:item.id,revision:item.revision||0,updatedAt:item.updatedAt||item.createdAt||new Date().toISOString(),activePhotoIds:(item.photos||[]).map(photo=>photo.id),contextPhotoIds:(item.contextPhotos||[]).map(photo=>photo.id),catalog};
}

export function taskDocument({taskId,listingId,baseRevision,action,input,createdAt}){
 return {schemaVersion:REPOSITORY_SCHEMA,taskId,listingId,baseRevision,action,input,createdAt:createdAt||new Date().toISOString(),status:'pending'};
}
