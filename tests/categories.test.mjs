import test from 'node:test';
import assert from 'node:assert/strict';
import { renamedCategoryEntries, categorySelection } from '../src/lib/categories.ts';

test('renaming preserves ordinary, card, paid and future recurring classifications and all financial fields', () => {
 const old={name:'Alimentação',unit:'Pessoal',kind:'despesa'};
 const entries=[
  {id:'one',category:old.name,unit:old.unit,kind:old.kind,amount:20,date:'2026-10-17'},
  {id:'card',category:old.name,unit:old.unit,kind:old.kind,amount:30,creditCardId:'card',invoiceMonth:'2026-11',status:'realizado'},
  {id:'future',category:old.name,unit:old.unit,kind:old.kind,amount:50,seriesId:'s',recurrence:'mensal',date:'2027-01-01'},
  {id:'other-center',category:old.name,unit:'Outro',kind:old.kind},
  {id:'income',category:old.name,unit:old.unit,kind:'receita'},
  {id:'other-category',category:'Comida japonesa',unit:old.unit,kind:old.kind},
 ];
 const renamed=renamedCategoryEntries(entries,old,{...old,name:'Restaurantes'});
 assert.deepEqual(renamed.slice(0,3),entries.slice(0,3).map(e=>({...e,category:'Restaurantes'})));
 for(let i=3;i<entries.length;i++) assert.equal(renamed[i],entries[i]);
 assert.equal(entries[0].category,'Alimentação');
 assert.equal(renamedCategoryEntries(entries,old,{...old,color:'red'}),entries);
});

test('opening an existing entry never falls back to the first category when its old name is missing',()=>{
 const available=[{name:'Comida japonesa'},{name:'Restaurantes'}];
 assert.equal(categorySelection('Alimentação',available,true),'Alimentação');
 assert.equal(categorySelection('Restaurantes',available,true),'Restaurantes');
 assert.equal(categorySelection('Alimentação',[],true),'Alimentação');
});

test('new entries start blank and changing scope clears an unavailable category',()=>{
 const expenses=[{name:'Comida japonesa'},{name:'Restaurantes'}];
 const income=[{name:'Salário'}];
 assert.equal(categorySelection('',expenses,false),'');
 assert.equal(categorySelection('',income,false),'');
 assert.equal(categorySelection('',[],false),'');
 assert.equal(categorySelection('Restaurantes',expenses,false),'Restaurantes');
 assert.equal(categorySelection('Restaurantes',income,false),'');
 assert.equal(categorySelection('Outra unidade',expenses,false),'');
});
