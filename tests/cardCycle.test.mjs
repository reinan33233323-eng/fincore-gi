import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceDate, invoiceCycle, invoiceMonthSummary } from '../src/lib/credit.ts';
import { cardSchedule, cardInvoices } from '../src/lib/cardLedger.ts';
const card={id:'nubank',name:'Nubank',closing_day:15,due_day:23};
test('October 29 subscription belongs to November invoice and repeats by billing month',()=>{
 assert.equal(invoiceDate('2026-10-15',card),'2026-11-23');
 assert.equal(invoiceDate('2026-10-29',card),'2026-11-23');
 const rows=cardSchedule({amount:119.35,date:'2026-10-29',installments:1,recurrence:'mensal',description:'Claude'},card);
 assert.equal(rows[0].cardPurchaseDate,'2026-10-29');
 assert.equal(rows[0].invoiceMonth,'2026-11');
 assert.equal(rows[0].date,'2026-11-23');
 assert.equal(rows[1].cardPurchaseDate,'2026-11-29');
 assert.equal(rows[1].date,'2026-12-23');
 assert.equal(invoiceMonthSummary(rows,card.id,'2026-11').total,119.35);
 assert.equal(cardInvoices(rows,[card])[0].date,'2026-11-23');
});
test('closing on 15 starts next cycle, due on 23 after its closing',()=>{
 assert.equal(invoiceDate('2026-11-14',card),'2026-11-23');
 assert.equal(invoiceDate('2026-11-15',card),'2026-12-23');
 assert.equal(invoiceDate('2026-12-14',card),'2026-12-23');
 assert.equal(invoiceDate('2026-12-15',card),'2027-01-23');
 assert.deepEqual(invoiceCycle('2026-12',card),{start:'2026-11-15',closing:'2026-12-15',due:'2026-12-23'});
 assert.deepEqual(invoiceCycle('2026-11',card),{start:'2026-10-15',closing:'2026-11-15',due:'2026-11-23'});
});
test('19.90 monthly subscription contributes 19.90 to each invoice, never 716.40',()=>{
 const rows=cardSchedule({amount:19.90,date:'2026-11-07',installments:1,recurrence:'mensal',unit:'Pessoal',category:'Assinaturas',description:'Assinatura'},card);
 assert.equal(rows.length,36);
 for(const month of ['2026-11','2026-12','2027-01']){
  const invoice=invoiceMonthSummary(rows,card.id,month);
  assert.equal(invoice.total,19.90);assert.equal(invoice.pending,19.90);assert.equal(invoice.items.length,1);
 }
 const listed=cardInvoices(rows,[card]);
 assert.equal(listed.length,36);
 assert.ok(listed.every(e=>e.amount===19.90));
 assert.equal(listed.find(e=>e.invoiceMonth==='2026-11').date,'2026-11-23');
 assert.equal(listed.find(e=>e.invoiceMonth==='2026-12').date,'2026-12-23');
});
test('multiple purchases total only their own monthly invoice, with separate monthly payment state',()=>{
 const rows=[{creditCardId:'nubank',invoiceMonth:'2026-11',status:'previsto',amount:19.90},{creditCardId:'nubank',invoiceMonth:'2026-11',status:'realizado',amount:30},{creditCardId:'nubank',invoiceMonth:'2026-12',status:'previsto',amount:200}];
 const invoice=invoiceMonthSummary(rows,'nubank','2026-11');
 assert.equal(invoice.total,49.90);assert.equal(invoice.paid,30);assert.equal(invoice.pending,19.90);
 assert.deepEqual(invoiceCycle('2027-02',{closing_day:31,due_day:5}),{start:'2026-12-31',closing:'2027-01-31',due:'2027-02-05'});
});
