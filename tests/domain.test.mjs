import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHTML,safeLink,filterEntries,validateEntry,filename,tagsForKind,photoRolesForKind,photoRoleForKind} from '../src/domain.js';
test('untrusted names and links cannot become executable markup',()=>{
  assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(safeLink('javascript:alert(1)'), '');assert.equal(safeLink('data:text/html,<script>'), '');
  assert.equal(safeLink('https://example.com/item'),'https://example.com/item');
});
const entries=[
 {id:'a',kind:'item',title:'Синие буткат джинсы',category:'Джинсы',color:'Синий',seasons:['Осень'],favorite:true},
 {id:'b',kind:'item',title:'Серая рубашка',category:'Рубашки',seasons:['Лето'],favorite:false},
 {id:'c',kind:'item',title:'Куртка',category:'Верхняя одежда',deleted_at:'2026-01-01'},
 {id:'d',kind:'wishlist',title:'Синие джинсы',category:'Джинсы'}
];
test('combined filters respect sections, favorites, season and trash',()=>{
 assert.deepEqual(filterEntries(entries,{section:'item',search:'БУТКАТ',category:'Джинсы',season:'Осень',favorites:true}).map(x=>x.id),['a']);
 assert.deepEqual(filterEntries(entries,{section:'item',trash:true}).map(x=>x.id),['c']);
 assert.equal(filterEntries(entries,{section:'item',season:'Зима'}).length,0);
});
test('outfits require actual selected pieces and invalid purchases are rejected',()=>{
 assert.throws(()=>validateEntry({kind:'outfit',title:'На вечер',item_ids:[]}),/Выбери/);
 assert.throws(()=>validateEntry({kind:'wishlist',title:'Ботинки',price:-1}),/цену/);
 assert.throws(()=>validateEntry({kind:'item',title:'Джинсы',source_url:'javascript:x'}),/Ссылка/);
 assert.equal(validateEntry({kind:'outfit',title:' На вечер ',item_ids:['a']}).title,'На вечер');
 assert.equal(filename('Фото / обувь: 1'),'Фото - обувь- 1');
});
test('multiple tags intersect and remain independent from favorites',()=>{
 const tagged=[
  {id:'a',kind:'item',title:'Рубашка',tags:['От отца','Тёмное','Любимое'],favorite:false},
  {id:'b',kind:'item',title:'Ботинки',tags:['Тёмное'],favorite:true},
  {id:'c',kind:'item',title:'Пальто',tags:['От отца'],favorite:true},
  {id:'d',kind:'item',title:'Без тегов'},
  {id:'e',kind:'outfit',title:'Вечер',tags:['Тёплый'],item_ids:['a']}
 ];
 assert.deepEqual(filterEntries(tagged,{tags:['От отца','Тёмное']}).map(e=>e.id),['a']);
 assert.deepEqual(filterEntries(tagged,{tags:['Любимое']}).map(e=>e.id),['a']);
 assert.deepEqual(filterEntries(tagged,{favorites:true}).map(e=>e.id),['b','c']);
 assert.equal(filterEntries(tagged,{tags:['Любимое'],favorites:true}).length,0);
 assert.deepEqual(filterEntries(tagged,{search:'ОТ ОТЦА'}).map(e=>e.id),['a','c']);
 assert.deepEqual(filterEntries(tagged,{section:'outfit',tags:['Тёплый']}).map(e=>e.id),['e']);
 assert.equal(filterEntries(tagged,{tags:['Тёплый']}).length,0);
});
test('tag validation separates garments from outfits and preserves legacy edits',()=>{
 assert.equal(tagsForKind('item').length,9);
 assert.deepEqual(tagsForKind('outfit'),['Лёгкий','Тёплый']);
 assert.deepEqual(validateEntry({kind:'item',title:'Рубашка',tags:['Любимое','Любимое'],favorite:false}).tags,['Любимое']);
 assert.equal(validateEntry({kind:'item',title:'Рубашка'}).tags,undefined);
 assert.throws(()=>validateEntry({kind:'item',title:'Рубашка',tags:['Осень']}),/теги/);
 assert.throws(()=>validateEntry({kind:'outfit',title:'Образ',item_ids:['a'],tags:['База']}),/теги/);
 assert.throws(()=>validateEntry({kind:'item',title:'Рубашка',tags:'Любимое'}),/теги/);
});
test('wishlist has no wardrobe tags or personal outfit photo roles',()=>{
 assert.deepEqual(tagsForKind('wishlist'),[]);
 assert.throws(()=>validateEntry({kind:'wishlist',title:'Покупка',tags:['От отца']}),/теги/);
 assert.deepEqual(photoRolesForKind('wishlist'),['С сайта','Отдельно','Деталь']);
 assert.equal(photoRoleForKind('wishlist','На мне'),'Отдельно');
 assert.equal(photoRoleForKind('wishlist','Образ'),'Отдельно');
 assert.equal(photoRoleForKind('wishlist','С сайта'),'С сайта');
 assert(photoRolesForKind('item').includes('На мне'));
 assert.equal(photoRoleForKind('item','На мне'),'На мне');
});
