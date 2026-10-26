import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPaymentEntries, invoiceMonthSummary } from '../src/lib/credit.ts';
import { cardInvoices } from '../src/lib/cardLedger.ts';
import { cashPosition, summarizeBank, summarizeFinancialEntries } from '../src/lib/finance.ts';

const card = { id: 'card', name: 'Itaú Platinum', closing_day: 15, due_day: 22 };
const purchase = (id, amount, extra = {}) => ({ id, kind: 'despesa', status: 'previsto', amount, date: '2026-11-22', paidDate: null, bankId: null,
  creditCardId: 'card', invoiceMonth: '2026-11', cardPurchaseDate: '2026-10-20', description: id, ...extra });
const partial = { id: 'p1', card_id: 'card', invoice_month: '2026-11', bank_id: 'itau', amount: 500, paid_date: '2026-11-05', settled_bank: null, settled_date: null, notes: '' };

test('a partial payment leaves the bank on its date while the invoice stays open with the remainder', () => {
  const purchases = [purchase('a', 1200), purchase('b', 800)];
  const payments = cardPaymentEntries([partial], [card]);
  const all = [...purchases, ...payments];
  assert.equal(summarizeBank(all, 'itau').balance, -500);
  const summary = invoiceMonthSummary(all, 'card', '2026-11');
  assert.deepEqual({ total: summary.total, paid: summary.paid, pending: summary.pending, partial: summary.partial }, { total: 2000, paid: 500, pending: 1500, partial: 500 });
  assert.equal(summary.items.length, 2);
  const invoice = cardInvoices(all, [card]).find((row) => row.invoiceSummary);
  assert.equal(invoice.status, 'previsto');
  assert.equal(invoice.amount, 1500);
  // Cash forecast for November: 500 already paid plus 1500 still due, never 2500.
  assert.equal(cashPosition(all, '2026-11-01', '2026-11-30').projectedClosing, -2000);
  assert.equal(summarizeFinancialEntries(all.filter((e) => e.status === 'previsto')).pay, 1500);
});

test('settling the invoice charges the bank only what remained after partial payments', () => {
  const settledPurchases = [purchase('a', 1200), purchase('b', 800)].map((p) => ({ ...p, status: 'realizado', bankId: 'itau', paidDate: '2026-11-20' }));
  const payments = cardPaymentEntries([{ ...partial, settled_bank: 'itau', settled_date: '2026-11-20' }], [card]);
  const all = [...settledPurchases, ...payments];
  assert.equal(summarizeBank(all, 'itau').balance, -2000);
  assert.equal(cashPosition(all, '2026-11-01', '2026-11-19').closing, -500);
  assert.equal(cashPosition(all, '2026-11-20', '2026-11-20').closing - cashPosition(all, '2026-11-20', '2026-11-20').opening, -1500);
  const summary = invoiceMonthSummary(all, 'card', '2026-11');
  assert.deepEqual({ total: summary.total, paid: summary.paid, pending: summary.pending }, { total: 2000, paid: 2000, pending: 0 });
});

test('partial payments are transfers: they are flagged so consumption reports can skip them', () => {
  const rows = cardPaymentEntries([partial], [card]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.cardPayment));
  const outflow = rows.find((row) => !row.creditCardId);
  assert.equal(outflow.description, 'Pagamento parcial · Fatura Itaú Platinum · 11/2026');
  assert.equal(outflow.bankId, 'itau');
  assert.equal(outflow.paidDate, '2026-11-05');
});

test('an invoice fully covered by partial payments still needs settling to close its purchases', () => {
  const all = [purchase('a', 500), ...cardPaymentEntries([partial], [card])];
  const summary = invoiceMonthSummary(all, 'card', '2026-11');
  assert.equal(summary.pending, 0);
  assert.equal(summary.unsettled, 1);
});


test('successive partial payments reduce the remaining invoice with exact cents and preserve its history', () => {
  const purchases = [purchase('nubank', 4162.74)];
  const first = { ...partial, amount: 1000, paid_date: '2026-10-26' };
  const second = { ...partial, id: 'p2', amount: 162.74, paid_date: '2026-10-26' };
  const afterFirst = invoiceMonthSummary([...purchases, ...cardPaymentEntries([first], [card])], 'card', '2026-11');
  assert.equal(afterFirst.pending, 3162.74);
  const entries = [...purchases, ...cardPaymentEntries([first, second], [card])];
  const afterSecond = invoiceMonthSummary(entries, 'card', '2026-11');
  assert.equal(afterSecond.total, 4162.74);
  assert.equal(afterSecond.paid, 1162.74);
  assert.equal(afterSecond.pending, 3000);
  assert.equal(afterSecond.items[0].status, 'previsto');
  assert.equal(summarizeBank(entries, 'itau').balance, -1162.74);
  assert.equal(entries.filter(e => e.cardPayment && !e.creditCardId).length, 2);
});
