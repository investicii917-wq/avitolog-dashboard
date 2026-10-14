// One pointer owns one reorder. Draft data changes only after a successful drop.
let suppressUntil=0;
export function installPhotoSort(root,{move,refresh}){
 const controller=new AbortController(),options={signal:controller.signal};
 let drag=null;
 const tiles=()=>[...root.querySelectorAll('[data-sort-list]')];
 const finish=commit=>{
  if(!drag)return;
  const d=drag;drag=null;clearTimeout(d.timer);cancelAnimationFrame(d.frame);
  d.ghost?.remove();d.tile.classList.remove('is-sorting');
  if(d.tile.hasPointerCapture?.(d.pointerId))d.tile.releasePointerCapture(d.pointerId);
  if(d.active){
   suppressUntil=Date.now()+500;
   if(commit)move(d.key,d.from,d.to);
   refresh();
  }
 };
 const place=()=>{
  if(!drag?.active)return;
  const d=drag;
  d.ghost.style.left=(d.x-d.offsetX)+'px';d.ghost.style.top=(d.y-d.offsetY)+'px';
  const target=document.elementFromPoint(d.x,d.y)?.closest('[data-sort-list]');
  if(!target||target===d.tile||target.dataset.sortList!==d.key)return;
  const siblings=tiles().filter(tile=>tile.dataset.sortList===d.key);
  const from=siblings.indexOf(d.tile),to=siblings.indexOf(target);
  if(to<0)return;
  target.parentNode.insertBefore(d.tile,to>from?target.nextSibling:target);
  d.to=tiles().filter(tile=>tile.dataset.sortList===d.key).indexOf(d.tile);
 };
 const tick=()=>{
  if(!drag?.active)return;
  const margin=72,y=drag.y,height=window.innerHeight;
  const dy=y<margin?-Math.ceil((margin-y)/6):y>height-margin?Math.ceil((y-height+margin)/6):0;
  if(dy){window.scrollBy(0,Math.max(-18,Math.min(18,dy)));place();}
  drag.frame=requestAnimationFrame(tick);
 };
 const activate=()=>{
  if(!drag||drag.active)return;
  const d=drag,rect=d.tile.getBoundingClientRect();d.active=true;
  const ghost=d.tile.cloneNode(true);ghost.removeAttribute('data-sort-list');ghost.removeAttribute('data-sort-index');
  ghost.querySelectorAll('button').forEach(button=>button.remove());
  ghost.classList.add('photo-drag-ghost');ghost.setAttribute('aria-hidden','true');
  Object.assign(ghost.style,{width:rect.width+'px',height:rect.height+'px'});
  document.body.appendChild(ghost);d.ghost=ghost;d.tile.classList.add('is-sorting');place();tick();
 };
 root.addEventListener('contextmenu',event=>{if(event.target.closest('[data-sort-list]'))event.preventDefault();},options);
 root.addEventListener('dragstart',event=>{if(event.target.closest('[data-sort-list]'))event.preventDefault();},options);
 root.addEventListener('click',event=>{if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},{...options,capture:true});
 root.addEventListener('pointerdown',event=>{
  const tile=event.target.closest('[data-sort-list]');
  if(!tile||event.target.closest('.remove')||event.button!==0||!event.isPrimary||drag)return;
  const rect=tile.getBoundingClientRect();
  drag={tile,key:tile.dataset.sortList,from:Number(tile.dataset.sortIndex),to:Number(tile.dataset.sortIndex),pointerId:event.pointerId,pointerType:event.pointerType,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,active:false};
  tile.setPointerCapture(event.pointerId);drag.timer=setTimeout(activate,240);
 },options);
 root.addEventListener('pointermove',event=>{
  if(!drag||drag.pointerId!==event.pointerId)return;
  drag.x=event.clientX;drag.y=event.clientY;
  const distance=Math.hypot(drag.x-drag.startX,drag.y-drag.startY);
  if(!drag.active&&distance>7){if(drag.pointerType==='mouse')activate();else{clearTimeout(drag.timer);return;}}
  if(drag.active){event.preventDefault();place();}
 },{...options,passive:false});
 root.addEventListener('pointerup',event=>{if(drag?.pointerId===event.pointerId){if(drag.active)event.preventDefault();finish(true);}},options);
 root.addEventListener('pointercancel',event=>{if(drag?.pointerId===event.pointerId)finish(false);},options);
 root.addEventListener('lostpointercapture',event=>{if(drag?.pointerId===event.pointerId)finish(false);},options);
 window.addEventListener('blur',()=>finish(false),options);
 return ()=>{controller.abort();if(drag){clearTimeout(drag.timer);cancelAnimationFrame(drag.frame);drag.ghost?.remove();drag.tile.classList.remove('is-sorting');drag=null;}};
}
