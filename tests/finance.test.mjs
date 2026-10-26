import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeFinancialEntries, summarizeBank, localMonthKey } from '../src/lib/finance.ts';
const row = (patch) => ({kind:'despesa', status:'previsto', amount:100, date:'2026-10-14', ...patch});
test('month totals include pending entries without treating them as paid', () => {
 const s = summarizeFinancialEntries([row({}), row({status:'realizado',amount:50}), row({kind:'receita',amount:20})]);
 assert.equal(s.totalExpense,150); assert.equal(s.expense,50); assert.equal(s.pay,100);
 assert.equal(s.totalIncome,20); assert.equal(s.income,0); assert.equal(s.receive,20);
 assert.equal(s.projectedBalance,-130);
});
test('bank balance uses the bank ID, includes receipts, interest and discount, and excludes forecasts', () => {
 const rows=[row({bankId:'bank-a',status:'realizado',amount:100,juros:10,discount:5}),
 row({bankId:'bank-a',kind:'receita',status:'realizado',amount:200}),
 row({bankId:'bank-a',amount:1000}),row({bankId:'bank-b',status:'realizado',amount:900}),row({status:'realizado',amount:20})];
 assert.equal(summarizeBank(rows,'bank-a').balance,95);
 assert.equal(summarizeBank(rows,'bank-a').pay,1000);
 assert.equal(summarizeBank(rows,null).expense,20);
});
test('money totals match the rounded values saved by PostgreSQL', () => {
 assert.equal(summarizeFinancialEntries([row({amount:10/3}),row({amount:10/3}),row({amount:10/3})]).pay,9.99);
});
test('month keys use the local calendar', () => {
 assert.equal(localMonthKey(new Date(2026,9,1,0,0)), '2026-10');
});
