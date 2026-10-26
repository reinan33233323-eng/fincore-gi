import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceMonthSummary, cardPaymentEntries } from '../src/lib/credit.ts';
import { summarizeBank, reportingPeriod } from '../src/lib/finance.ts';
import { cardInvoices } from '../src/lib/cardLedger.ts';
const card={id:'card',name:'Nubank',closing_day:25,due_day:5};
const purchase={id:'purchase',kind:'despesa',amount:4162.74,status:'previsto',date:'2026-11-05',cardPurchaseDate:'2026-10-20',creditCardId:'card',invoiceMonth:'2026-11'};
const payment={id:'payment',card_id:'card',invoice_month:'2026-11',amount:263.71,bank_id:'bank',paid_date:'2026-10-26',settled_bank:null,settled_date:null};
const adjustment=amount=>({...purchase,id:'adjustment',amount,invoiceAdjustment:true,cardPurchaseDate:null,bankId:null,paidDate:null});
test('manual decrease corrects the outstanding invoice without debiting the bank or reclassifying purchases',()=>{
 const original=[purchase,...cardPaymentEntries([payment],[card])];
 assert.equal(invoiceMonthSummary(original,'card','2026-11').pending,3899.03);
 const entries=[...original,adjustment(-399.03)];
 const summary=invoiceMonthSummary(entries,'card','2026-11');
 assert.equal(summary.pending,3500);assert.equal(summary.paid,263.71);
 assert.deepEqual(summary.items,[purchase]);assert.equal(summary.adjustments.length,1);
 assert.equal(summarizeBank(entries,'bank').balance,-263.71);
 assert.equal(cardInvoices(entries,[card]).find(e=>e.invoiceSummary).invoicePendingAmount,3500);
 assert.equal(reportingPeriod(entries,'2026-11-01','2026-11-30').some(e=>e.invoiceAdjustment),false);
});
test('an increase and a later partial payment reduce only the corrected outstanding balance',()=>{
 const entries=[purchase,adjustment(837.26),...cardPaymentEntries([{...payment,amount:500}],[card])];
 assert.equal(invoiceMonthSummary(entries,'card','2026-11').pending,4500);
 assert.equal(summarizeBank(entries,'bank').balance,-500);
});
test('settlement later charges exactly the corrected balance and preserves the earlier payment',()=>{
 const entries=[purchase,adjustment(-399.03)].map(e=>({...e,status:'realizado',bankId:'bank',paidDate:'2026-11-05'}));
 entries.push(...cardPaymentEntries([{...payment,settled_bank:'bank',settled_date:'2026-11-05'}],[card]));
 const summary=invoiceMonthSummary(entries,'card','2026-11');
 assert.equal(summary.pending,0);assert.equal(summary.paid,3763.71);
 assert.equal(summarizeBank(entries,'bank').balance,-3763.71);
});
test('an adjustment to zero leaves the account untouched until an explicit settlement',()=>{
 const entries=[purchase,adjustment(-4162.74)];
 assert.equal(invoiceMonthSummary(entries,'card','2026-11').pending,0);
 assert.equal(summarizeBank(entries,'bank').balance,0);
 assert.equal(invoiceMonthSummary(entries,'card','2026-11').unsettled,2);
});
