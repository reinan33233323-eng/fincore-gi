import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceDate, installmentAmounts, adjustmentEntry } from '../src/lib/credit.ts';
import { cashPosition, summarizeBank, cashDate } from '../src/lib/finance.ts';
test('closing date, next year, short months and installments use correct invoice due dates',()=>{
 const card={closing_day:25,due_day:5};
 assert.equal(invoiceDate('2026-10-24',card),'2026-11-05');
 assert.equal(invoiceDate('2026-10-25',card),'2026-12-05');
 assert.equal(invoiceDate('2026-12-24',card),'2027-01-05');
 assert.equal(invoiceDate('2026-10-24',card,2),'2027-01-05');
 assert.equal(invoiceDate('2028-02-01',{closing_day:20,due_day:31}),'2028-02-29');
 assert.equal(invoiceDate('2026-02-28',{closing_day:31,due_day:5}),'2026-04-05');
});
test('installments preserve every cent and reject invalid counts',()=>{
 assert.deepEqual(installmentAmounts(100,3),[33.34,33.33,33.33]);
 assert.throws(()=>installmentAmounts(0.02,3));
 assert.throws(()=>installmentAmounts(100,0));
});
test('bank adjustment is carried into later months and card purchases debit only on settlement',()=>{
 const adjustment=adjustmentEntry({id:'adjustment',bank_id:'bank',amount:1000,date:'2026-09-30',notes:''});
 const purchase={kind:'despesa',status:'previsto',amount:300,date:'2026-10-05',bankId:null};
 assert.equal(summarizeBank([adjustment,purchase],'bank').balance,1000);
 assert.deepEqual(cashPosition([adjustment,purchase],'2026-10-01','2026-10-31'),{opening:1000,closing:1000,projectedClosing:700});
 const paid={...purchase,status:'realizado',bankId:'bank',paidDate:'2026-11-02'};
 assert.equal(cashDate(paid),'2026-11-02');
 assert.equal(cashPosition([adjustment,paid],'2026-10-01','2026-10-31').closing,1000);
 assert.equal(cashPosition([adjustment,paid],'2026-11-01','2026-11-30').closing,700);
 assert.equal(summarizeBank([adjustment,paid],'bank').balance,700);
 const down=adjustmentEntry({id:'2',bank_id:'bank',amount:-100,date:'2026-11-10',notes:''});
 assert.equal(cashPosition([adjustment,paid,down],'2026-12-01','2026-12-31').opening,600);
});
