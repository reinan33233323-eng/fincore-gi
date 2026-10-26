import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, nextWeeklyDates, shiftWeeklyDate, defaultBankId } from '../src/lib/recurrence.ts';
test('weekly occurrences cross month/year and retain exact seven-day cadence',()=>{
 assert.deepEqual([0,1,2,3].map(i=>addDays('2026-12-25',i*7)),['2026-12-25','2027-01-01','2027-01-08','2027-01-15']);
 assert.deepEqual(nextWeeklyDates('2026-10-15','2026-10-01','2026-11-05'),['2026-10-22','2026-10-29','2026-11-05']);
 assert.deepEqual(nextWeeklyDates('2026-10-15','2026-11-01','2026-11-12'),['2026-11-05','2026-11-12']);
 assert.equal(shiftWeeklyDate('2026-11-05','2026-10-15','2026-10-17'),'2026-11-07');
});
test('new entries prefer Itaú, preserving no default when it does not exist',()=>{
 assert.equal(defaultBankId([{id:'other',name:'Banco B'},{id:'itau',name:'Itáu'}]),'itau');
 assert.equal(defaultBankId([{id:'itau',name:'Itaú PJ'}]),'itau');
 assert.equal(defaultBankId([{id:'other',name:'Banco B'}]),'');
});
