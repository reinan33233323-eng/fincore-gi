import test from 'node:test';
import assert from 'node:assert/strict';
import { sameMonthParts } from '../src/lib/installments.ts';
import { installmentAmounts } from '../src/lib/credit.ts';
const cents = text => Math.round(Number(text.replaceAll('.','').replace(',','.'))*100);
test('same-month split accepts 24 and 180 installments without truncating and preserves total cents',()=>{
 for(const count of [24,180]) {
  const parts=sameMonthParts(count,7100,'2026-10-15');
  assert.equal(parts.length,count);
  assert.equal(parts.reduce((sum,p)=>sum+cents(p.amount),0),710000);
  assert.ok(parts.every(p=>p.date>='2026-10-15'&&p.date<='2026-10-31'));
 }
});
test('monthly and card splits accept amounts above former limits with exact total',()=>{
 for(const count of [24,61,180,360]) {
  const values=installmentAmounts(7100,count);
  assert.equal(values.length,count);
  assert.equal(values.reduce((sum,v)=>sum+Math.round(v*100),0),710000);
  assert.ok(values.every(v=>v>0));
 }
});

test('monthly preview and saving share a schedule that advances 24 months instead of days', async()=>{
 const { monthlyParts } = await import('../src/lib/installments.ts');
 const schedule=monthlyParts(24,7100,'2026-10-15');
 assert.deepEqual(schedule.slice(0,3).map(p=>p.date),['2026-10-15','2026-11-15','2026-12-15']);
 assert.equal(schedule[23].date,'2028-09-15');
 assert.equal(new Set(schedule.map(p=>p.date.slice(0,7))).size,24);
 assert.equal(schedule.reduce((sum,p)=>sum+Math.round(p.amount*100),0),710000);
 assert.deepEqual(monthlyParts(3,100,'2027-01-31').map(p=>p.date),['2027-01-31','2027-02-28','2027-03-31']);
});
