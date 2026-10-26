import { cashDate, entryValue, type FinancialEntry } from './finance.ts';
import { addDays } from './recurrence.ts';
import { addMonthsClamped } from './seriesDates.ts';

type Source = FinancialEntry & { id?: string; description?: string; balanceAdjustment?: boolean; creditCardId?: string | null; invoiceMonth?: string | null; installment?: string };
export type CashMovement = { description: string; kind: 'receita' | 'despesa'; amount: number; status: 'previsto' | 'realizado'; adjustment: boolean; overdue: boolean };
export type CashDay = { date: string; opening: number; income: number; expense: number; adjustment: number; pendingIncome: number; pendingExpense: number; closing: number; movements: CashMovement[] };
export type CashMonth = Omit<CashDay, 'date' | 'movements'> & { month: string; days: CashDay[] };

/** Running cash balance after each movement, including multiple movements on the same day. */
export function cashMovementRows(month: CashMonth) {
 let balance=Math.round(month.opening*100);
 return month.days.flatMap(day=>day.movements.map((movement,index)=>{
  const signed=Math.round(movement.amount*100)*(movement.kind==='receita'?1:-1);
  balance+=signed;
  return {...movement,key:`${day.date}:${index}`,date:day.date,signed:signed/100,balance:balance/100};
 }));
}

/** Actual bank cash is the base. Pending entries affect the forecast once, never the actual balance. */
export function buildCashFlow(entries: Source[], bankIds: string[], cards: {id:string;name:string}[], startMonth: string, count: number, today: string) {
 const cents = (value:number) => Math.round(value * 100);
 const bankSet = new Set(bankIds);
 const start = `${startMonth}-01`;
 const end = addDays(addMonthsClamped(start,count),-1);
 let actual = 0, opening = 0, overdueIncome = 0, overdueExpense = 0;
 const buckets = new Map<string, Map<string,CashMovement>>();
 entries.forEach((entry,index)=>{
  const settled = entry.status === 'realizado';
  // Unassigned realized entries never changed the balance of a registered account.
  if(settled && !bankSet.has(entry.bankId || '')) return;
  const originalDate = cashDate(entry);
  const date = settled || originalDate >= today ? originalDate : today;
  const value = cents(entryValue(entry));
  const signed = entry.kind === 'receita' ? value : -value;
  if(settled && originalDate <= today) actual += signed;
  if(!settled && originalDate < today){if(entry.kind==='receita')overdueIncome+=value;else overdueExpense+=value;}
  if(date < start) opening += signed;
  if(date < start || date > end) return;
  const day = buckets.get(date) || new Map<string,CashMovement>();
  // Purchases share one monthly invoice, separated by settlement date/status when necessary.
  const key = entry.creditCardId ? `${entry.creditCardId}:${entry.invoiceMonth}:${entry.status}` : `${index}`;
  const previous = day.get(key);
  day.set(key,{description:entry.creditCardId ? `Fatura ${cards.find(c=>c.id===entry.creditCardId)?.name || 'do cartão'} · ${entry.invoiceMonth || originalDate.slice(0,7)}` : `${entry.description || (entry.balanceAdjustment?'Ajuste de saldo':'Lançamento')}${entry.installment ? ` (${entry.installment})` : ''}`,
   kind:entry.kind,amount:((previous ? cents(previous.amount) : 0)+value)/100,status:entry.status,adjustment:!!entry.balanceAdjustment,overdue:!settled&&originalDate<today});
  buckets.set(date,day);
 });
 let balance = opening;
 const months: CashMonth[]=[];
 for(let i=0;i<count;i++){
  const monthStart=addMonthsClamped(start,i), next=addMonthsClamped(start,i+1);
  const days:CashDay[]=[];
  for(let date=monthStart;date<next;date=addDays(date,1)){
   const movements=[...(buckets.get(date)?.values() || [])];
   let income=0,expense=0,adjustment=0,pendingIncome=0,pendingExpense=0;
   for(const movement of movements){const amount=cents(movement.amount);
    if(movement.adjustment)adjustment+=movement.kind==='receita'?amount:-amount;
    else if(movement.status==='previsto'){if(movement.kind==='receita')pendingIncome+=amount;else pendingExpense+=amount;}
    else if(movement.kind==='receita')income+=amount;else expense+=amount;
   }
   const dayOpening=balance;
   balance+=income-expense+adjustment+pendingIncome-pendingExpense;
   days.push({date,opening:dayOpening/100,income:income/100,expense:expense/100,adjustment:adjustment/100,pendingIncome:pendingIncome/100,pendingExpense:pendingExpense/100,closing:balance/100,movements});
  }
  const total=(key:'income'|'expense'|'adjustment'|'pendingIncome'|'pendingExpense')=>days.reduce((sum,day)=>sum+cents(day[key]),0)/100;
  months.push({month:monthStart.slice(0,7),opening:days[0].opening,closing:balance/100,income:total('income'),expense:total('expense'),adjustment:total('adjustment'),pendingIncome:total('pendingIncome'),pendingExpense:total('pendingExpense'),days});
 }
 return {actual:actual/100,overdueIncome:overdueIncome/100,overdueExpense:overdueExpense/100,months};
}
