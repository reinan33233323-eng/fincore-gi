import { localDateKey, type FinancialEntry } from './finance.ts';
export type CreditCard = { id: string; name: string; closing_day: number; due_day: number };
export function invoiceDate(purchaseDate: string, card: Pick<CreditCard,'closing_day'|'due_day'>, offset = 0) {
 const [year, month, day] = purchaseDate.split('-').map(Number);
 const closing = Math.min(card.closing_day, new Date(year, month, 0).getDate());
 const dueMonth = month - 1 + (day >= closing ? 1 : 0) + (card.due_day <= card.closing_day ? 1 : 0) + offset;
 const first = new Date(year,dueMonth,1);
 return localDateKey(new Date(first.getFullYear(),first.getMonth(),Math.min(card.due_day,new Date(first.getFullYear(),first.getMonth()+1,0).getDate())));
}
export function installmentAmounts(total: number, count: number) {
 const cents = Math.round(total*100);
 if (!Number.isSafeInteger(count) || count<1 || !Number.isSafeInteger(cents) || cents<count) throw new Error('Valor ou parcelas inválidos.');
 return Array.from({length:count},(_,i)=>(Math.floor(cents/count)+(i<cents%count?1:0))/100);
}
export type BalanceAdjustment = {id:string;bank_id:string;amount:number;date:string;notes:string};
export function adjustmentEntry(row: BalanceAdjustment) {
 return {id:row.id,kind:Number(row.amount)>0?'receita' as const:'despesa' as const,status:'realizado' as const,
 amount:Math.abs(Number(row.amount)),date:row.date,paidDate:row.date,bankId:row.bank_id,
 unit:'Saldo bancário',account:'Ajuste de saldo',category:'Ajuste de saldo',description:'Ajuste de saldo bancário',beneficiary:'',pix:'',recurrence:'nenhuma' as const,installments:1,notes:row.notes,balanceAdjustment:true};
}

/** Invoice months are named by their payment due date. Closing starts the next cycle. */
export function invoiceCycle(month: string, card: Pick<CreditCard,'closing_day'|'due_day'>) {
 const [year,monthNumber]=month.split('-').map(Number);
 const dayAt=(offset:number,day:number)=>{
  const start=new Date(year,monthNumber-1+offset,1);
  return localDateKey(new Date(start.getFullYear(),start.getMonth(),Math.min(day,new Date(start.getFullYear(),start.getMonth()+1,0).getDate())));
 };
 const closingOffset=card.due_day<=card.closing_day?-1:0;
 return {start:dayAt(closingOffset-1,card.closing_day),closing:dayAt(closingOffset,card.closing_day),due:dayAt(0,card.due_day)};
}

export function invoiceMonthSummary(entries:any[],cardId:string,month:string) {
 const rows=entries.filter(e=>e.creditCardId===cardId&&e.invoiceMonth===month);
 const financial=rows.filter(e=>!e.cardPayment);
 const items=financial.filter(e=>!e.invoiceAdjustment);
 const adjustments=financial.filter(e=>e.invoiceAdjustment);
 const cents=(e:any)=>Math.round((e.amount+(e.status==='realizado'?(e.juros||0)-(e.discount||0):0))*100);
 const settled=financial.filter(e=>e.status==='realizado').reduce((sum,e)=>sum+cents(e),0);
 const open=financial.filter(e=>e.status==='previsto').reduce((sum,e)=>sum+cents(e),0);
 // Open partial payments are credits (negative rows) waiting for the invoice to be settled.
 const credit=rows.filter(e=>e.cardPayment&&e.status==='previsto').reduce((sum,e)=>sum-cents(e),0);
 const partial=rows.filter(e=>e.cardPayment).reduce((sum,e)=>sum-cents(e),0);
 return {items,adjustments,paid:(settled+credit)/100,pending:(open-credit)/100,total:(settled+open)/100,partial:partial/100,
  unsettled:financial.filter(e=>e.status==='previsto').length};
}

export type CardPayment = {id:string;card_id:string;invoice_month:string;bank_id:string;amount:number|string;paid_date:string;settled_bank:string|null;settled_date:string|null;notes?:string};
/**
 * A partial invoice payment becomes two rows, both flagged `cardPayment` so
 * consumption reports skip them (it is a transfer, not new spending):
 * the bank outflow on the payment date, and a negative row inside the invoice
 * that lowers what is still due. Once the invoice is settled that negative row
 * is settled into the paying bank, so the bank is charged only the remainder.
 */
export function cardPaymentEntries(rows:CardPayment[],cards:CreditCard[]) {
 return rows.flatMap(row=>{
  const card=cards.find(c=>c.id===row.card_id);
  const amount=Number(row.amount);
  const [year,month]=row.invoice_month.split('-');
  const label=`Fatura ${card?.name||'do cartão'} · ${month}/${year}`;
  const due=card?invoiceCycle(row.invoice_month,card).due:`${row.invoice_month}-01`;
  const base={unit:'Cartão de crédito',account:'Pagamento de fatura',category:'Pagamento de fatura',beneficiary:card?.name||'',pix:'',
   recurrence:'nenhuma' as const,installments:1,notes:row.notes||'',attachments:[],juros:0,discount:0,cardPayment:true,cardPaymentId:row.id,paysCardId:row.card_id,paysInvoiceMonth:row.invoice_month};
  return [
   {...base,id:`card-payment:${row.id}`,kind:'despesa' as const,status:'realizado' as const,amount,date:row.paid_date,paidDate:row.paid_date,bankId:row.bank_id,
    description:`Pagamento parcial · ${label}`},
   {...base,id:`card-payment-credit:${row.id}`,kind:'despesa' as const,amount:-amount,creditCardId:row.card_id,invoiceMonth:row.invoice_month,
    status:(row.settled_date?'realizado':'previsto') as 'realizado'|'previsto',date:due,paidDate:row.settled_date,bankId:row.settled_bank,
    description:`Abatimento do pagamento parcial · ${label}`},
  ];
 });
}
