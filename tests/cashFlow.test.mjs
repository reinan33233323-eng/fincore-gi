import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashFlow, cashMovementRows } from '../src/lib/cashFlow.ts';
const settled=(amount,date='2026-10-15',kind='receita',extra={})=>({kind,status:'realizado',amount,date,bankId:'itau',...extra});
const pending=(amount,date,kind='despesa',extra={})=>({kind,status:'previsto',amount,date,...extra});
const build=(entries,start='2026-10',count=3)=>buildCashFlow(entries,['itau'],[{id:'card',name:'Nubank'}],start,count,'2026-10-15');
test('month-end summary adds pending net to current bank balance without counting settled amounts twice',()=>{
 const flow=build([settled(3673.98,'2026-10-15','receita',{balanceAdjustment:true}),settled(1,'2026-10-15','despesa',{balanceAdjustment:true}),pending(3537,'2026-10-30','receita'),pending(229,'2026-10-30')]);
 assert.equal(flow.actual,3672.98);
 assert.equal(flow.months[0].closing,6980.98);
 assert.equal(flow.months[1].opening,6980.98);
});
test('bank balances anchor daily forecasts and month closings carry into the next month',()=>{
 const flow=build([settled(1000,'2026-10-01'),pending(200,'2026-10-20'),pending(500,'2026-11-02','receita'),pending(100,'2026-11-10')]);
 assert.equal(flow.actual,1000);
 assert.equal(flow.months[0].days.find(d=>d.date==='2026-10-20').opening,1000);
 assert.equal(flow.months[0].closing,800);
 assert.equal(flow.months[1].opening,800);
 assert.equal(flow.months[1].closing,1200);
 assert.equal(flow.months[2].opening,1200);
});
test('balance edits recalculate every later day without becoming operating income',()=>{
 const entries=[settled(1000,'2026-10-01'),pending(200,'2026-10-20')];
 const before=build(entries);
 const after=build([...entries,settled(300,'2026-10-15','despesa',{balanceAdjustment:true})]);
 assert.equal(after.actual,700);
 assert.equal(after.months[0].income,1000);
 assert.equal(after.months[0].expense,0);
 assert.equal(after.months[0].adjustment,-300);
 assert.equal(after.months[0].closing,500);
 assert.equal(after.months[1].opening,before.months[1].opening-300);
 assert.equal(after.months[2].closing,before.months[2].closing-300);
});
test('all registered accounts form the base; paid entries use payment date, future receipts stay forecast',()=>{
 const flow=buildCashFlow([settled(1000),settled(500,'2026-10-15','receita',{bankId:'other'}),settled(800,'2026-10-15','receita',{bankId:null}),settled(100,'2026-10-01','despesa',{paidDate:'2026-10-20'}),pending(200,'2026-10-18','receita')],['itau','other'],[],'2026-10',1,'2026-10-15');
 assert.equal(flow.actual,1500);
 assert.equal(flow.months[0].days.find(d=>d.date==='2026-10-01').expense,0);
 assert.equal(flow.months[0].days.find(d=>d.date==='2026-10-20').expense,100);
 assert.equal(flow.months[0].closing,1600);
});
test('overdue forecasts appear once today and carry into a future month opening',()=>{
 const rows=[settled(1000,'2026-09-01'),pending(100,'2026-09-20'),pending(50,'2026-10-10','receita')];
 const flow=build(rows);
 assert.equal(flow.overdueExpense,100);assert.equal(flow.overdueIncome,50);
 assert.equal(flow.months[0].days.find(d=>d.date==='2026-10-10').pendingIncome,0);
 const today=flow.months[0].days.find(d=>d.date==='2026-10-15');
 assert.equal(today.pendingExpense,100);assert.equal(today.pendingIncome,50);
 assert.equal(flow.months[0].closing,950);
 assert.equal(build(rows,'2026-11',1).months[0].opening,950);
});
test('card purchases appear as one invoice on the due date, and payment never duplicates the forecast',()=>{
 const rows=[settled(1000,'2026-10-01'),pending(19.90,'2026-11-23','despesa',{creditCardId:'card',invoiceMonth:'2026-11'}),pending(99,'2026-11-23','despesa',{creditCardId:'card',invoiceMonth:'2026-11'}),pending(19.90,'2026-12-23','despesa',{creditCardId:'card',invoiceMonth:'2026-12'})];
 const flow=build(rows),day=flow.months[1].days.find(d=>d.date==='2026-11-23');
 assert.equal(day.movements.length,1);assert.equal(day.pendingExpense,118.90);assert.equal(flow.months[1].closing,881.10);
 const paid=build(rows.map(e=>e.invoiceMonth==='2026-11'?{...e,status:'realizado',paidDate:'2026-11-21',bankId:'itau'}:e));
 assert.equal(paid.months[1].pendingExpense,0);assert.equal(paid.months[1].expense,118.90);assert.equal(paid.months[1].closing,881.10);
});
test('daily cents remain exact across leap February and negative projected balances',()=>{
 const flow=buildCashFlow([settled(0.30,'2028-01-01'),pending(0.10,'2028-02-28'),pending(0.30,'2028-02-29')],['itau'],[],'2028-02',2,'2028-02-01');
 assert.equal(flow.months[0].days.length,29);assert.equal(flow.months[0].closing,-0.10);assert.equal(flow.months[1].opening,-0.10);
});

test('movement ledger shows every transaction and the balance after each one on the same day',()=>{
 const flow=build([settled(1000,'2026-09-01'),pending(30,'2026-10-20','despesa',{description:'Taxa'}),pending(500,'2026-10-20','receita',{description:'Salário'}),pending(100,'2026-10-21','despesa',{description:'Notebook',installment:'1/24'})]);
 const rows=cashMovementRows(flow.months[0]);
 assert.deepEqual(rows.map(r=>[r.date,r.signed,r.balance]),[['2026-10-20',-30,970],['2026-10-20',500,1470],['2026-10-21',-100,1370]]);
 assert.equal(rows[2].description,'Notebook (1/24)');
 assert.equal(rows.at(-1).balance,flow.months[0].closing);
});
test('movement ledger carries adjusted bank balance and consolidates card purchases into one row',()=>{
 const flow=build([settled(1000,'2026-09-01'),settled(200,'2026-10-15','despesa',{balanceAdjustment:true}),pending(19.90,'2026-11-23','despesa',{creditCardId:'card',invoiceMonth:'2026-11'}),pending(99,'2026-11-23','despesa',{creditCardId:'card',invoiceMonth:'2026-11'})]);
 const rows=cashMovementRows(flow.months[1]);
 assert.equal(rows.length,1);assert.equal(rows[0].amount,118.90);assert.equal(rows[0].balance,681.10);
 assert.equal(rows[0].balance,flow.months[1].closing);
});
