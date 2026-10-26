import test from 'node:test';
import assert from 'node:assert/strict';
import { cardInvoices, cardSchedule, extendCardRecurrences } from '../src/lib/cardLedger.ts';
import { summarizeFinancialEntries } from '../src/lib/finance.ts';
const card={id:'card',name:'Itaú Black',closing_day:25,due_day:5};
const data={kind:'despesa',status:'previsto',amount:100,date:'2026-10-15',recurrence:'nenhuma',installments:1,unit:'Pessoal',category:'Assinaturas',description:'Compra',notes:''};
test('purchase, subscriptions and installments receive the correct invoice with classification preserved',()=>{
 const subscription=cardSchedule({...data,recurrence:'mensal'},card);
 assert.equal(subscription.length,36);assert.equal(subscription[0].date,'2026-11-05');assert.equal(subscription[1].date,'2026-12-05');
 assert.ok(subscription.every(e=>e.amount===100&&e.category==='Assinaturas'&&e.bankId===null&&e.status==='previsto'));
 const installments=cardSchedule({...data,installments:24},card);
 assert.equal(installments.length,24);assert.equal(installments[23].date,'2028-10-05');
 assert.equal(installments.reduce((sum,e)=>sum+Math.round(e.amount*100),0),10000);
 assert.equal(installments[1].cardInstallmentOffset,1);
});
test('weekly subscriptions consolidate multiple purchases into one invoice without double counting',()=>{
 const schedule=cardSchedule({...data,recurrence:'semanal'},card);
 assert.equal(schedule.length,156);
 assert.equal(schedule[1].cardPurchaseDate,'2026-10-22');
 const invoiceItems=schedule.filter(e=>e.invoiceMonth==='2026-11');
 assert.equal(invoiceItems.length,2);
 const display=cardInvoices(invoiceItems,[card]);
 assert.equal(display.length,1);assert.equal(display[0].amount,200);assert.equal(display[0].invoicePendingAmount,200);
 assert.equal(summarizeFinancialEntries(invoiceItems).pay,200);
});
test('separate invoices by card and month, keeping ordinary expenses and mixed payment history',()=>{
 const row=cardSchedule(data,card)[0];
 const entries=[{...data,amount:30},{...row,id:'a'},{...row,id:'b',amount:50,status:'realizado',paidDate:'2026-11-05',bankId:'bank'}, {...row,creditCardId:'other',amount:20}];
 const grouped=cardInvoices(entries,[card]);
 assert.equal(grouped.length,3);
 const invoice=grouped.find(e=>e.creditCardId==='card');
 assert.equal(invoice.amount,150);assert.equal(invoice.invoicePaidAmount,50);assert.equal(invoice.invoicePendingAmount,100);
 assert.equal(grouped.reduce((sum,e)=>sum+e.amount,0),200);
});
test('recurring card forecasts extend by purchase date and preserve the original weekday/closing rules',()=>{
 const first=cardSchedule({...data,recurrence:'semanal'},card).slice(0,2).map((e,i)=>({...e,id:String(i),seriesId:'series'}));
 const future=extendCardRecurrences(first,[card],'2026-10-01','2026-11-05',(s,d)=>`${s}:${d}`);
 assert.deepEqual(future.map(e=>e.cardPurchaseDate),['2026-10-29','2026-11-05']);
 assert.deepEqual(future.map(e=>e.date),['2026-12-05','2026-12-05']);
 assert.equal(new Set(future.map(e=>e.id)).size,2);
 assert.equal(extendCardRecurrences(first.map(e=>({...e,recurrence:'nenhuma'})),[card],'2026-10-01','2026-11-05',()=>'' ).length,0);
});
