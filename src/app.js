import {WardrobeBackend} from './backend.js';
import {SECTIONS,CATEGORIES,tagsForKind,photoRolesForKind,escapeHTML as esc,safeLink,filterEntries,validateEntry} from './domain.js';
import {icon} from './icons.js';

const root=document.querySelector('#app');
const state={section:'item',entries:[],search:'',category:'',tags:[],favorites:false,trash:false,sort:'new',loading:false};
let api,dialog,photoDrafts=[],editing=null,dirty=false,saving=false,toastTimer,signedRefresh;
const $=(selector)=>document.querySelector(selector);
const money=(e)=>e.price!=null?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(e.price):'';
const mark=`<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="m7 13 7 16 6-16 6 16 7-16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500);}
function errorMessage(error){if(!navigator.onLine)return 'Нет соединения. Проверь интернет и попробуй ещё раз.';if(error?.message?.includes('JWT')||error?.status===401)return 'Сессия истекла. Войди снова.';return error?.message||'Не удалось выполнить действие. Попробуй ещё раз.';}
function setBusy(button,value,label='Сохранение…'){if(!button)return;if(value){button.dataset.previous=button.innerHTML;button.innerHTML=`<span class="spinner"></span>${esc(label)}`;}else if(button.dataset.previous){button.innerHTML=button.dataset.previous;}button.disabled=value;}

function loginScreen(unconfigured=false){
  clearInterval(signedRefresh);
  root.innerHTML=`<main class="login-page"><section class="login-panel"><div class="login-form-wrap"><a class="brand" href="#">${mark}<span>Гардероб</span></a><h2>Вход</h2>${unconfigured?'<div class="setup-message">Вход временно недоступен.</div>':''}<form id="login-form"><label>Логин<input name="login" autocomplete="username" required maxlength="120" ${unconfigured?'disabled':''}></label><label>Пароль<div class="password-field"><input name="password" type="password" autocomplete="current-password" required ${unconfigured?'disabled':''}><button type="button" class="icon-button" id="password-toggle" aria-label="Показать пароль">${icon('eye')}</button></div></label><p id="login-error" class="form-error" role="alert"></p><button class="button primary full" type="submit" ${unconfigured?'disabled':''}>Войти ${icon('arrow')}</button></form></div></section></main>`;
  $('#password-toggle').onclick=()=>{const input=$('[name=password]');input.type=input.type==='password'?'text':'password';$('#password-toggle').setAttribute('aria-label',input.type==='password'?'Показать пароль':'Скрыть пароль');};
  $('#login-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;setBusy(button,true,'Входим…');$('#login-error').textContent='';try{const values=new FormData(event.target);await api.login(String(values.get('login')).trim(),String(values.get('password')));event.target.reset();await openApp();}catch(e){$('#login-error').textContent=errorMessage(e);setBusy(button,false);}};
}

function navigation(){return Object.entries(SECTIONS).map(([key,s])=>`<button class="nav-link ${state.section===key?'active':''}" data-section="${key}" ${state.section===key?'aria-current="page"':''}>${icon(s.icon)}<span class="desktop-label">${s.title}</span><span class="mobile-label">${s.short}</span><span class="nav-count">${state.entries.filter(e=>e.kind===key&&!e.deleted_at).length}</span></button>`).join('');}
function shell(){
  root.innerHTML=`<div class="app-shell"><aside class="sidebar"><a class="brand" href="#item">${mark}<span>Гардероб</span></a><nav aria-label="Разделы гардероба" class="navigation">${navigation()}</nav><div class="sidebar-bottom"><button class="nav-link" id="settings-desktop">${icon('settings')}<span>Настройки</span></button></div></aside><main class="main"><header class="page-header"><div><h1 id="page-title"></h1></div><div class="header-actions"><button class="button primary" id="add-button">${icon('plus')}<span>Добавить вещь</span></button><button class="icon-button mobile-settings" id="settings-mobile" aria-label="Настройки">${icon('settings')}</button></div></header><div class="search-row"><label class="search-box">${icon('search')}<input id="search" type="search" placeholder="Поиск" aria-label="Поиск по коллекции"></label><button class="filter-button" id="filter-toggle">${icon('tune')}<span>Фильтры</span><span id="filter-dot"></span></button><button class="favorite-filter icon-button" id="favorite-filter" aria-label="Только избранное" aria-pressed="false">${icon('heart')}</button></div><div id="filter-panel" class="filter-panel" hidden><fieldset class="tags-field filter-tags" id="tag-filters"><legend>Теги</legend><div class="checkbox-chips" id="tag-filter-options"></div></fieldset><label>Порядок<select id="sort-filter"><option value="new">Сначала новые</option><option value="name">По названию</option><option value="old">Сначала старые</option></select></label><button class="text-button" id="reset-filters">Сбросить</button></div><div id="categories" class="categories"></div><div class="collection-meta"><span id="result-count"></span><div class="meta-right"><span id="collection-status">${icon('check')} Сохранено</span><button id="refresh-button" class="icon-button" aria-label="Обновить коллекцию">${icon('restore')}</button></div></div><div id="trash-banner" class="trash-banner" hidden>${icon('trash')} Корзина<button class="text-button" id="exit-trash">Вернуться к коллекции</button></div><section id="collection" aria-label="Карточки коллекции" aria-live="polite"></section></main><nav class="mobile-nav" aria-label="Разделы гардероба">${navigation()}</nav></div><dialog id="dialog" class="dialog"><div id="dialog-content"></div></dialog>`;
  dialog=$('#dialog');
  dialog.addEventListener('cancel',event=>{if(saving){event.preventDefault();return;}if(dirty&&!confirm('Закрыть без сохранения?'))event.preventDefault();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeDialog();});
  dialog.addEventListener('close',cleanupDrafts);
  document.querySelectorAll('[data-section]').forEach(button=>button.onclick=()=>switchSection(button.dataset.section));
  $('#settings-desktop').onclick=$('#settings-mobile').onclick=settings;
  $('#add-button').onclick=()=>editEntry();
  $('#search').oninput=event=>{state.search=event.target.value;renderGrid();};
  $('#filter-toggle').onclick=()=>{$('#filter-panel').hidden=!$('#filter-panel').hidden;$('#filter-toggle').setAttribute('aria-expanded',String(!$('#filter-panel').hidden));};
  $('#favorite-filter').onclick=()=>{state.favorites=!state.favorites;renderGrid();};
  $('#sort-filter').onchange=event=>{state.sort=event.target.value;renderGrid();};
  $('#reset-filters').onclick=()=>{state.category='';state.tags=[];state.favorites=false;state.search='';$('#search').value='';renderSection();};
  $('#refresh-button').onclick=()=>reload().catch(e=>toast(errorMessage(e)));
  $('#exit-trash').onclick=()=>{state.trash=false;renderSection();};
  renderSection();
}
async function openApp(){
  await api.authorize();
  const key=location.hash.slice(1);if(SECTIONS[key])state.section=key;
  state.loading=true;shell();
  await reload();
  clearInterval(signedRefresh);signedRefresh=setInterval(()=>reload(true).catch(()=>{}),10*60*1000);
}
async function reload(quiet=false){
  if(!quiet){state.loading=true;renderGrid();$('#collection-status').innerHTML='<span class="spinner"></span> Обновляем';}
  try{state.entries=await api.load();state.loading=false;document.querySelectorAll('.navigation,.mobile-nav').forEach(nav=>{nav.innerHTML=navigation();nav.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>switchSection(b.dataset.section));});renderSection();$('#collection-status').innerHTML=`${icon('check')} Сохранено`;}
  catch(e){state.loading=false;$('#collection-status').textContent='Не удалось обновить';$('#collection').innerHTML=`<div class="empty-state"><div class="empty-icon">${icon('restore')}</div><h2>Коллекция временно недоступна</h2><p>${esc(errorMessage(e))}</p><button class="button primary" id="retry-load">Попробовать снова</button></div>`;$('#retry-load').onclick=()=>reload().catch(()=>{});throw e;}
}
function switchSection(section){if(!SECTIONS[section])return;state.section=section;state.search='';state.category='';state.tags=[];state.trash=false;$('#search').value='';location.hash=section;renderSection();window.scrollTo({top:0,behavior:'smooth'});}
function renderSection(){
  const section=SECTIONS[state.section];$('#page-title').textContent=section.title;$('#add-button').innerHTML=`${icon('plus')}<span>${section.add}</span>`;
  document.querySelectorAll('[data-section]').forEach(b=>{b.classList.toggle('active',b.dataset.section===state.section);if(b.dataset.section===state.section)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  renderTagFilters();
  const hasCategories=['item','wishlist'].includes(state.section);
  $('#categories').hidden=!hasCategories;
  $('#categories').innerHTML=hasCategories?['',...CATEGORIES].map(c=>`<button class="category-chip ${state.category===c?'selected':''}" data-category="${esc(c)}">${esc(c||'Все вещи')}</button>`).join(''):'';
  $('#categories').querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;renderSection();});
  $('#trash-banner').hidden=!state.trash;renderGrid();
}
function renderTagFilters(){
  const tags=tagsForKind(state.section);
  $('#tag-filters').hidden=!tags.length;
  $('#tag-filter-options').innerHTML=tags.map(tag=>`<label><input type="checkbox" name="filter_tags" value="${esc(tag)}" ${state.tags.includes(tag)?'checked':''}><span>${esc(tag)}</span></label>`).join('');
  $('#tag-filter-options').querySelectorAll('input').forEach(input=>input.onchange=()=>{state.tags=Array.from($('#tag-filter-options').querySelectorAll('input:checked'),el=>el.value);renderGrid();});
}
function sortedFiltered(){let entries=filterEntries(state.entries,state);if(state.sort==='name')entries.sort((a,b)=>a.title.localeCompare(b.title,'ru'));if(state.sort==='old')entries.reverse();return entries;}
function cardVisual(e){
  if(e.photos?.length)return `<img src="${esc(e.photos[0].url)}" alt="${esc(e.title)}" loading="lazy" class="${['С сайта','Отдельно','Деталь'].includes(e.photos[0].role)?'contain':''}">`;
  if(e.kind==='outfit'){
    const items=e.item_ids.map(id=>state.entries.find(x=>x.id===id)).filter(Boolean);
    const photos=items.filter(i=>i.photos.length).slice(0,4);
    if(photos.length)return `<div class="outfit-collage collage-${photos.length}">${photos.map(i=>`<img src="${esc(i.photos[0].url)}" alt="${esc(i.title)}" loading="lazy">`).join('')}</div>`;
  }
  return `<div class="card-placeholder">${icon(SECTIONS[e.kind].icon)}</div>`;
}
function card(e){
  const secondary=e.kind==='outfit'?`${e.item_ids.length} ${e.item_ids.length===1?'вещь':'вещи'} в образе`:e.category||e.brand||'Коллекция';
  return `<article class="collection-card"><button class="card-open" data-open="${e.id}" aria-label="Открыть ${esc(e.title)}"><div class="card-image">${cardVisual(e)}${e.photos.length>1?`<span class="photo-count">${icon('image')} ${e.photos.length}</span>`:''}${e.deleted_at?'<span class="card-label">В корзине</span>':''}</div><div class="card-info"><span class="card-category">${esc(secondary)}</span><h2>${esc(e.title)}</h2>${e.tags?.length?`<div class="card-tags">${e.tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div>`:''}${e.kind==='wishlist'&&e.store_name?`<p class="card-store">${esc(e.store_name)}</p>`:''}<div class="card-bottom ${e.kind==='wishlist'?'purchase-price-row':''}"><span class="${e.kind==='wishlist'?'card-price':''}">${esc(e.kind==='wishlist'?money(e):e.color||e.brand||'')}</span>${icon('arrow')}</div></div></button><button class="card-favorite ${e.favorite?'is-favorite':''}" data-favorite="${e.id}" aria-label="${e.favorite?'Убрать из избранного':'В избранное'}: ${esc(e.title)}" aria-pressed="${e.favorite}">${icon('heart')}</button></article>`;
}
function renderGrid(){
  const entries=sortedFiltered();$('#result-count').textContent=`${entries.length} ${state.section==='outfit'?'образов':state.section==='inspiration'?'референсов':'вещей'}`;$('#favorite-filter').classList.toggle('active',state.favorites);$('#favorite-filter').setAttribute('aria-pressed',String(state.favorites));$('#filter-dot').classList.toggle('filter-dot',Boolean(state.tags.length));
  if(state.loading){$('#collection').innerHTML='<div class="card-grid">'+Array.from({length:4},()=>'<div class="skeleton-card"><div></div><span></span><span></span></div>').join('')+'</div>';return;}
  if(entries.length){$('#collection').innerHTML=`<div class="card-grid ${state.section==='inspiration'?'inspiration-grid':''}">${entries.map(card).join('')}</div>`;$('#collection').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>detail(b.dataset.open));$('#collection').querySelectorAll('[data-favorite]').forEach(b=>b.onclick=()=>toggleFavorite(b.dataset.favorite));return;}
  const section=SECTIONS[state.section],filtered=state.search||state.category||state.tags.length||state.favorites;
  $('#collection').innerHTML=`<div class="empty-state"><div class="empty-art"><div class="empty-sheet sheet-back"></div><div class="empty-sheet sheet-front">${icon(section.icon)}<span>${icon('plus')}</span></div></div><h2>${state.trash?'Корзина пуста':filtered?'Ничего не найдено':section.empty}</h2>${state.trash?'':`<button class="button ${filtered?'secondary':'primary'}" id="empty-action">${icon(filtered?'restore':'plus')}${filtered?'Сбросить фильтры':section.add}</button>`}</div>`;
  if($('#empty-action'))$('#empty-action').onclick=()=>{if(filtered)$('#reset-filters').click();else editEntry();};
}
async function toggleFavorite(id){const entry=state.entries.find(e=>e.id===id),previous=entry.favorite;entry.favorite=!previous;renderGrid();try{await api.update(id,{favorite:entry.favorite});}catch(e){entry.favorite=previous;renderGrid();toast(errorMessage(e));}}

function cleanupDrafts(){for(const p of photoDrafts)if(p.file&&p.url)URL.revokeObjectURL(p.url);photoDrafts=[];editing=null;dirty=false;saving=false;}
function closeDialog(force=false){if(saving&&!force)return;if(dirty&&!force&&!confirm('Закрыть без сохранения?'))return;dialog.close();cleanupDrafts();}
function modal(content,wide=false){cleanupDrafts();dialog.classList.toggle('wide',wide);$('#dialog-content').innerHTML=content;if(!dialog.open)dialog.showModal();$('#dialog-content').querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeDialog());}
const closeButton=`<button class="icon-button" type="button" data-close aria-label="Закрыть">${icon('close')}</button>`;
function detail(id){
  const e=state.entries.find(x=>x.id===id);if(!e)return;
  const items=e.item_ids.map(itemId=>state.entries.find(x=>x.id===itemId)).filter(Boolean);
  const outfits=state.entries.filter(x=>x.kind==='outfit'&&!x.deleted_at&&x.item_ids.includes(id));
  const source=safeLink(e.source_url);
  modal(`<div class="detail-top">${closeButton}</div><div class="detail-layout"><div class="detail-media"><div class="gallery-main" id="gallery-main">${e.photos.length?`<img src="${esc(e.photos[0].url)}" alt="${esc(e.title)}">`:cardVisual(e)}</div>${e.photos.length?`<div class="gallery-caption" id="gallery-caption">${esc(e.photos[0].role)}${e.photos[0].caption?' · '+esc(e.photos[0].caption):''}</div><div class="gallery-thumbs">${e.photos.map((p,i)=>`<button data-photo="${i}" class="${i===0?'selected':''}" aria-label="Фото ${i+1}: ${esc(p.role)}"><img src="${esc(p.url)}" alt=""></button>`).join('')}</div>`:''}</div><div class="detail-body"><h2>${esc(e.title)}</h2><div class="detail-tags">${[e.category,e.color,...e.tags||[]].filter(Boolean).map(t=>`<span>${esc(t)}</span>`).join('')}</div>${money(e)?`<div class="detail-price">${money(e)}</div>`:''}${e.note?`<p class="detail-note">${esc(e.note)}</p>`:''}<dl class="detail-specs">${[['Магазин',e.store_name],['Бренд',e.brand],['Размер',e.size],['Посадка',e.fit]].filter(([,v])=>v).map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${source?`<a class="button secondary full" href="${esc(source)}" target="_blank" rel="noopener noreferrer">${icon('link')}${e.kind==='wishlist'?'Открыть магазин':'Открыть источник'}${icon('arrow')}</a>`:''}${items.length?`<div class="linked-section"><h3>Вещи в этом образе</h3>${items.map(item=>linkedCard(item)).join('')}</div>`:''}${outfits.length?`<div class="linked-section"><h3>Образы с этой вещью <span>${outfits.length}</span></h3>${outfits.map(item=>linkedCard(item)).join('')}</div>`:''}${e.inspiration_id?`<button class="button secondary full" id="source-inspiration">${icon('spark')}Посмотреть вдохновение</button>`:''}<div class="detail-actions">${e.deleted_at?`<button class="button primary" id="restore-entry">${icon('restore')}Восстановить</button><button class="button danger" id="delete-forever">Удалить навсегда</button>`:`<button class="button primary" id="edit-entry">${icon('edit')}Редактировать</button><button class="icon-button" id="delete-entry" aria-label="В корзину">${icon('trash')}</button>`}</div>${e.kind==='wishlist'&&!e.deleted_at?'<button class="text-button bought-button" id="mark-bought">Купил — перенести в мои вещи</button>':''}${e.kind==='inspiration'&&!e.deleted_at?'<button class="text-button bought-button" id="create-from-reference">Создать образ по этому референсу</button>':''}</div></div>`,true);
  let index=0;
  function showPhoto(i){index=i;$('#gallery-main').innerHTML=`<img src="${esc(e.photos[i].url)}" alt="${esc(e.title)}, фото ${i+1}">`;$('#gallery-caption').textContent=[e.photos[i].role,e.photos[i].caption].filter(Boolean).join(' · ');document.querySelectorAll('[data-photo]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.photo)===i));}
  document.querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>showPhoto(Number(b.dataset.photo)));
  let startX;$('#gallery-main').ontouchstart=event=>{startX=event.touches[0].clientX;};$('#gallery-main').ontouchend=event=>{const diff=event.changedTouches[0].clientX-startX;if(Math.abs(diff)>50&&e.photos.length>1)showPhoto((index+(diff<0?1:-1)+e.photos.length)%e.photos.length);};
  document.querySelectorAll('[data-linked]').forEach(b=>b.onclick=()=>detail(b.dataset.linked));
  if($('#edit-entry'))$('#edit-entry').onclick=()=>editEntry(e);
  if($('#source-inspiration'))$('#source-inspiration').onclick=()=>detail(e.inspiration_id);
  if($('#delete-entry'))$('#delete-entry').onclick=async()=>{const warning=outfits.length?`Вещь используется в ${outfits.length} образах. Она останется в их составе с отметкой «В корзине». Переместить?`:'Переместить карточку в корзину? Её можно восстановить.';if(confirm(warning))await changeEntry(e,{deleted_at:new Date().toISOString()},'Перемещено в корзину');};
  if($('#restore-entry'))$('#restore-entry').onclick=()=>changeEntry(e,{deleted_at:null},'Карточка восстановлена');
  if($('#delete-forever'))$('#delete-forever').onclick=async()=>{if(!confirm('Удалить карточку и фотографии навсегда? Это действие нельзя отменить.'))return;try{await api.removeForever(e);closeDialog(true);await reload();toast('Карточка удалена');}catch(err){toast(errorMessage(err));}};
  if($('#mark-bought'))$('#mark-bought').onclick=()=>changeEntry(e,{kind:'item',tags:[]},'Вещь добавлена в гардероб');
  if($('#create-from-reference'))$('#create-from-reference').onclick=()=>editEntry(null,{kind:'outfit',inspiration_id:e.id});
}
function linkedCard(e){return `<button class="linked-card" data-linked="${e.id}"><div>${cardVisual(e)}</div><span>${esc(e.title)}<small>${e.deleted_at?'В корзине':esc(e.category||SECTIONS[e.kind].title)}</small></span>${icon('arrow')}</button>`;}
async function changeEntry(entry,patch,message){try{if(entry.kind==='wishlist'&&patch.kind==='item')await api.save({...entry,...patch},entry.photos);else await api.update(entry.id,patch);closeDialog(true);await reload();toast(message);}catch(e){toast(errorMessage(e));}}

function input(label,name,value='',attrs=''){return `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;}
function editEntry(entry=null,defaults={}){
  const e=entry||{id:crypto.randomUUID(),kind:defaults.kind||state.section,title:'',seasons:[],tags:[],item_ids:[],photos:[],...defaults};
  const isGarment=['item','wishlist'].includes(e.kind);
  const available=state.entries.filter(x=>x.kind==='item'&&(!x.deleted_at||e.item_ids.includes(x.id)));
  const references=state.entries.filter(x=>x.kind==='inspiration'&&!x.deleted_at);
  modal(`<form id="entry-form"><header class="modal-header"><div><h2>${entry?'Редактировать':SECTIONS[e.kind].add}</h2></div>${closeButton}</header><div class="editor-body"><div class="photo-editor"><div class="field-heading"><h3>Фотографии</h3></div><label class="upload-area" id="upload-area">${icon('upload')}<strong>Добавить фотографии</strong><input id="photo-input" type="file" accept="image/*" multiple hidden></label><div id="photo-drafts" class="photo-drafts"></div></div><div class="editor-fields">${input('Название *','title',e.title,'required maxlength="160"')}${isGarment?`<div class="form-row"><label>Категория<select name="category"><option value="">Выбрать</option>${CATEGORIES.map(c=>`<option ${e.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label>${input('Цвет','color',e.color,'maxlength="80"')}</div><div class="form-row">${input('Бренд','brand',e.brand,'maxlength="100"')}${input('Размер','size',e.size,'maxlength="40"')}</div>${input('Посадка / крой','fit',e.fit,'maxlength="100"')}`:''}${tagsForKind(e.kind).length?`<fieldset class="tags-field"><legend>Теги</legend><div class="checkbox-chips">${tagsForKind(e.kind).map(tag=>`<label><input type="checkbox" name="tags" value="${esc(tag)}" ${e.tags?.includes(tag)?'checked':''}><span>${esc(tag)}</span></label>`).join('')}</div></fieldset>`:''}${e.kind==='wishlist'?input('Магазин','store_name',e.store_name,'maxlength="160"'):''}${['wishlist','inspiration'].includes(e.kind)?input(e.kind==='wishlist'?'Ссылка на магазин':'Ссылка на источник','source_url',e.source_url,'type="url" maxlength="2048"'):''}${e.kind==='wishlist'?input('Цена, ₽','price',e.price??'','type="number" min="0" max="999999999" step="0.01"'):''}<label>${e.kind==='inspiration'?'Что нравится в этом образе':e.kind==='outfit'?'Пояснение к образу':'Заметка'}<textarea name="note" rows="4" maxlength="5000">${esc(e.note)}</textarea></label>${e.kind==='outfit'?`<div class="outfit-picker"><div class="field-heading"><h3>Вещи в образе *</h3><span id="selected-count"></span></div><input type="search" id="picker-search" placeholder="Поиск" aria-label="Найти вещь для образа"><div class="picker-list" id="picker-list">${available.length?available.map(item=>`<label class="picker-item" data-picker-title="${esc(item.title.toLowerCase())}"><input type="checkbox" name="item_ids" value="${item.id}" ${e.item_ids.includes(item.id)?'checked':''}><div class="picker-image">${cardVisual(item)}</div><span>${esc(item.title)}<small>${esc(item.category||'Вещь')}${item.deleted_at?' · В корзине':''}</small></span><span class="picker-check">${icon('check')}</span></label>`).join(''):'<p class="muted picker-empty">Нет вещей</p>'}</div></div><label>Вдохновение для этого образа<select name="inspiration_id"><option value="">Без референса</option>${references.map(r=>`<option value="${r.id}" ${e.inspiration_id===r.id?'selected':''}>${esc(r.title)}</option>`).join('')}</select></label>`:''}<label class="simple-checkbox"><input name="favorite" type="checkbox" ${e.favorite?'checked':''}> Добавить в избранное</label></div></div><footer class="modal-footer"><p class="form-error" id="save-error" role="alert"></p><div><button type="button" class="button secondary" data-close>Отмена</button><button type="submit" class="button primary" id="save-button">${icon('check')}Сохранить</button><button type="submit" name="next" value="1" class="button secondary" id="save-next">Сохранить и ещё</button></div></footer></form>`,true);
  editing=e;photoDrafts=e.photos.map(p=>({...p}));renderPhotoDrafts();
  $('#entry-form').oninput=()=>{dirty=true;updateSelectedCount();};
  $('#photo-input').onchange=event=>{addPhotos(Array.from(event.target.files));event.target.value='';};
  const area=$('#upload-area');area.ondragover=event=>{event.preventDefault();area.classList.add('dragover');};area.ondragleave=()=>area.classList.remove('dragover');area.ondrop=event=>{event.preventDefault();area.classList.remove('dragover');addPhotos(Array.from(event.dataTransfer.files));};
  if($('#picker-search'))$('#picker-search').oninput=event=>{const query=event.target.value.toLowerCase();document.querySelectorAll('[data-picker-title]').forEach(el=>el.hidden=!el.dataset.pickerTitle.includes(query));};
  updateSelectedCount();
  $('#entry-form').onsubmit=async event=>{
    event.preventDefault();if(saving)return;
    const next=event.submitter?.name==='next';const f=new FormData(event.target);
    const value=name=>String(f.get(name)||'').trim();
    const draft={...editing,title:value('title'),category:value('category')||null,color:value('color')||null,brand:value('brand')||null,size:value('size')||null,fit:value('fit')||null,seasons:editing.seasons||[],tags:f.getAll('tags'),store_name:f.has('store_name')?(value('store_name')||null):(editing.store_name||null),source_url:f.has('source_url')?(value('source_url')||null):(editing.source_url||null),price:value('price')?Number(value('price')):null,note:value('note'),favorite:f.has('favorite'),item_ids:f.getAll('item_ids'),inspiration_id:value('inspiration_id')||null};
    try{validateEntry(draft);}catch(err){$('#save-error').textContent=errorMessage(err);return;}
    saving=true;$('#save-error').textContent='';event.target.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);setBusy($('#save-button'),true,'Сохраняем…');
    try{await api.save(draft,photoDrafts);dirty=false;closeDialog(true);try{await reload();toast('Сохранено');if(next)editEntry(null,{kind:draft.kind,category:draft.category});}catch{toast('Карточка сохранена. Обнови коллекцию, когда появится соединение.');}}
    catch(err){saving=false;$('#save-error').textContent=errorMessage(err);event.target.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=false);setBusy($('#save-button'),false);}
  };
}
function updateSelectedCount(){if($('#selected-count'))$('#selected-count').textContent=`Выбрано: ${document.querySelectorAll('[name=item_ids]:checked').length}`;}
function addPhotos(files){
  if(saving)return;
  if(photoDrafts.length+files.length>20){toast('В одной карточке может быть до 20 фотографий.');return;}
  for(const file of files){if(!file.type.startsWith('image/')){toast('Добавь файл изображения.');continue;}if(file.size>25*1024*1024){toast(`Фото ${file.name} больше 25 МБ.`);continue;}photoDrafts.push({id:crypto.randomUUID(),file,url:URL.createObjectURL(file),role:editing.kind==='inspiration'||editing.kind==='outfit'?'Образ':'Отдельно',caption:''});}
  dirty=true;renderPhotoDrafts();
}
function renderPhotoDrafts(){
  $('#photo-drafts').innerHTML=photoDrafts.map((p,i)=>`<div class="photo-draft"><div class="photo-draft-image"><img src="${esc(p.url)}" alt="Фото ${i+1}">${i===0?'<span class="cover-label">Обложка</span>':''}</div><div class="photo-draft-fields"><label class="sr-only" for="role-${i}">Тип фотографии ${i+1}</label><select id="role-${i}" data-role="${i}">${photoRolesForKind(editing.kind).map(r=>`<option ${p.role===r?'selected':''}>${r}</option>`).join('')}</select><input data-caption="${i}" value="${esc(p.caption)}" aria-label="Подпись к фото ${i+1}" maxlength="300"><div class="photo-draft-controls"><button type="button" class="icon-button" data-move="${i}" data-direction="-1" aria-label="Поднять фото ${i+1}" ${i===0?'disabled':''}>${icon('up')}</button><button type="button" class="icon-button" data-move="${i}" data-direction="1" aria-label="Опустить фото ${i+1}" ${i===photoDrafts.length-1?'disabled':''}>${icon('down')}</button><button type="button" class="icon-button" data-remove="${i}" aria-label="Убрать фото ${i+1}">${icon('trash')}</button></div></div></div>`).join('');
  document.querySelectorAll('[data-role]').forEach(el=>el.onchange=()=>{photoDrafts[Number(el.dataset.role)].role=el.value;dirty=true;});
  document.querySelectorAll('[data-caption]').forEach(el=>el.oninput=()=>{photoDrafts[Number(el.dataset.caption)].caption=el.value;dirty=true;});
  document.querySelectorAll('[data-move]').forEach(el=>el.onclick=()=>{const i=Number(el.dataset.move),j=i+Number(el.dataset.direction);[photoDrafts[i],photoDrafts[j]]=[photoDrafts[j],photoDrafts[i]];dirty=true;renderPhotoDrafts();});
  document.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{const [p]=photoDrafts.splice(Number(el.dataset.remove),1);if(p.file)URL.revokeObjectURL(p.url);dirty=true;renderPhotoDrafts();});
}
function settings(){
  modal(`<header class="modal-header"><div><h2>Настройки</h2></div>${closeButton}</header><div class="settings-body"><div class="settings-section"><div class="settings-icon">${icon('trash')}</div><div><h3>Корзина</h3><button class="button secondary" id="open-trash">Открыть корзину</button></div></div><div class="settings-section"><div class="settings-icon">${icon('upload')}</div><div><h3>Резервная копия</h3><button class="button secondary" id="export-button">Скачать гардероб</button><p id="export-status" role="status"></p></div></div><button class="button secondary full" id="logout-button">${icon('logout')}Выйти из аккаунта</button></div>`);
  $('#open-trash').onclick=()=>{closeDialog(true);state.trash=true;state.category='';state.tags=[];state.search='';state.favorites=false;$('#search').value='';renderSection();};
  $('#export-button').onclick=async()=>{const button=$('#export-button');setBusy(button,true,'Готовим архив…');try{await api.export(state.entries,(n,total)=>{$('#export-status').textContent=`Фотографии: ${n} из ${total}`;});$('#export-status').textContent='Архив скачан';}catch(e){$('#export-status').textContent=errorMessage(e);}finally{setBusy(button,false);}};
  $('#logout-button').onclick=async()=>{try{await api.logout();closeDialog(true);state.entries=[];loginScreen();}catch(e){toast(errorMessage(e));}};
}

window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
window.addEventListener('hashchange',()=>{const key=location.hash.slice(1);if(SECTIONS[key]&&key!==state.section&&$('.main'))switchSection(key);});
window.addEventListener('offline',()=>toast('Нет соединения. Изменения можно сохранить после подключения.'));
window.addEventListener('online',()=>{if($('.main'))reload().catch(()=>{});});
async function boot(){
  try{const response=await fetch('./config.json',{cache:'no-store'});if(!response.ok)throw new Error('CONFIG_MISSING');api=new WardrobeBackend(await response.json());const ticket=location.hash.startsWith('#setup=')?location.hash.slice(7):'';if(/^[0-9a-f]{64}$/.test(ticket)){history.replaceState(null,'',location.pathname);setupScreen(ticket);return;}const session=await api.session();if(session){try{await openApp();}catch(e){loginScreen();$('#login-error').textContent=errorMessage(e);}}else loginScreen();}
  catch(e){loginScreen(true);}
}
function setupScreen(ticket){
  loginScreen();
  $('.login-form-wrap').innerHTML=`<div class="lock-circle">${icon('lock')}</div><h2>Создать аккаунт</h2><form id="setup-form">${input('Логин','login','','required minlength="3" maxlength="60" autocomplete="username"')}${input('Email','email','','required type="email" autocomplete="email"')}<label>Пароль<input name="password" type="password" required minlength="12" autocomplete="new-password"></label><label>Повтори пароль<input name="repeat" type="password" required minlength="12" autocomplete="new-password"></label><p class="form-error" id="setup-error" role="alert"></p><button type="submit" class="button primary full">Создать мой аккаунт ${icon('arrow')}</button></form>`;
  $('#setup-form').onsubmit=async event=>{
    event.preventDefault();const f=new FormData(event.target);const password=String(f.get('password'));
    if(password!==f.get('repeat')){$('#setup-error').textContent='Пароли не совпадают.';return;}
    const button=event.submitter;setBusy(button,true,'Настраиваем…');$('#setup-error').textContent='';
    try{
      const response=await fetch(`${api.config.supabaseUrl}/functions/v1/wardrobe-setup`,{method:'POST',headers:{'Content-Type':'application/json',apikey:api.config.publishableKey},body:JSON.stringify({ticket,login:String(f.get('login')).trim(),email:String(f.get('email')).trim(),password})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Не удалось создать аккаунт.');
      event.target.reset();loginScreen();$('[name=login]').value=String(f.get('login')).trim();toast('Аккаунт создан. Войди с выбранным паролем.');
    }catch(e){$('#setup-error').textContent=errorMessage(e);setBusy(button,false);}
  };
}
boot();
