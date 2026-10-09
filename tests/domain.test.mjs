import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHTML,safeLink,filterEntries,validateEntry,filename} from '../src/domain.js';
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
