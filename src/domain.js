export const SECTIONS = {
  item: {title:'Мои вещи',short:'Вещи',icon:'hanger',add:'Добавить вещь',empty:'Нет вещей'},
  inspiration: {title:'Вдохновение',short:'Вдохновение',icon:'spark',add:'Добавить вдохновение',empty:'Нет вдохновения'},
  outfit: {title:'Образы',short:'Образы',icon:'layers',add:'Создать образ',empty:'Нет образов'},
  wishlist: {title:'Хочу купить',short:'Покупки',icon:'bag',add:'Добавить покупку',empty:'Нет покупок'}
};
export const CATEGORIES = ['Верхняя одежда','Футболки и топы','Рубашки','Трикотаж','Джинсы','Брюки','Шорты','Обувь','Сумки','Аксессуары','Другое'];
export const SEASONS = ['Весна','Лето','Осень','Зима'];
export const PHOTO_ROLES = ['С сайта','Отдельно','На мне','Деталь','Образ'];
export function escapeHTML(value='') {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function safeLink(value) {
  if(!value?.trim())return '';
  try {const u=new URL(value.trim());return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}
}
export function filterEntries(entries,{section='item',search='',category='',season='',favorites=false,trash=false}={}) {
  const needle=search.trim().toLocaleLowerCase('ru');
  return entries.filter(e=>e.kind===section && Boolean(e.deleted_at)===trash && (!category||e.category===category) && (!season||e.seasons?.includes(season)) && (!favorites||e.favorite) && (!needle||[e.title,e.brand,e.color,e.note,e.category].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(needle)));
}
export function validateEntry(e) {
  if(!SECTIONS[e.kind])throw new Error('Неизвестный раздел.');
  if(!e.title?.trim())throw new Error('Добавь название.');
  if(e.title.trim().length>160)throw new Error('Название должно быть короче 160 символов.');
  if(e.source_url&&!safeLink(e.source_url))throw new Error('Ссылка должна начинаться с https:// или http://.');
  if(e.price!==null&&e.price!==undefined&&(!Number.isFinite(Number(e.price))||Number(e.price)<0))throw new Error('Проверь цену.');
  if(e.kind==='outfit'&&!e.item_ids?.length)throw new Error('Выбери хотя бы одну вещь для образа.');
  return {...e,title:e.title.trim(),source_url:safeLink(e.source_url)||null};
}
export function imageExtension(type) {const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif'};return types[type]||null;}
export function filename(value) {return String(value).replace(/[\\/:*?"<>|]/g,'-').trim().slice(0,100)||'гардероб';}
