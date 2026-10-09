export const SECTIONS = {
  item: {title:'Мои вещи',short:'Вещи',icon:'hanger',add:'Добавить вещь',description:'Всё, что ты носишь, в одном месте.',empty:'Здесь начинается твой гардероб',hint:'Добавь первую вещь. Фото отдельно и на тебе помогут находить удачные сочетания.'},
  inspiration: {title:'Вдохновение',short:'Вдохновение',icon:'spark',add:'Добавить вдохновение',description:'Образы и детали, которые хочется повторить.',empty:'Собери своё вдохновение',hint:'Сохрани фото понравившегося образа, ссылку на источник и то, что тебе в нём нравится.'},
  outfit: {title:'Образы',short:'Образы',icon:'layers',add:'Создать образ',description:'Готовые сочетания из твоих вещей.',empty:'Первый образ — начало коллекции',hint:'Выбери вещи из гардероба, добавь пояснение и при желании фото всего комплекта.'},
  wishlist: {title:'Хочу купить',short:'Покупки',icon:'bag',add:'Добавить покупку',description:'Вещи, которые могут дополнить твой гардероб.',empty:'Покупки с понятной целью',hint:'Сохрани вещь и ссылку на магазин. Здесь удобно сравнивать варианты перед покупкой.'}
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
