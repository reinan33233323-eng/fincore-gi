import { invoiceDate, installmentAmounts, type CreditCard } from './credit.ts';
import { addDays, nextWeeklyDates } from './recurrence.ts';
import { addMonthsClamped } from './seriesDates.ts';
import { entryValue } from './finance.ts';

export function cardSchedule(data: any, card: CreditCard, parts?: {date:string;amount:string}[]) {
 const parse = (v:string) => Number(v.replaceAll('.','').replace(',','.'));
 const recurring = data.recurrence !== 'nenhuma';
 const count = data.recurrence === 'mensal' ? 36 : data.recurrence === 'semanal' ? 156 : data.installments;
 const amounts = recurring ? null : installmentAmounts(data.amount,count);
 const result: any[] = [];
 for(let i=0;i<count;i++) {
  const purchaseDate = data.recurrence === 'semanal' ? addDays(data.date,i*7) : data.recurrence === 'mensal' ? addMonthsClamped(data.date,i) : data.date;
  for(const [slot,part] of (parts?.length ? parts : [{date:purchaseDate,amount:''}]).entries()) {
   const sourceDate = part.amount ? addMonthsClamped(part.date,i) : purchaseDate;
   const offset = !recurring && !parts?.length ? i : 0;
   const date = invoiceDate(sourceDate,card,offset);
   result.push({...data,date,cardPurchaseDate:sourceDate,cardInstallmentOffset:offset,invoiceMonth:date.slice(0,7),creditCardId:card.id,
    kind:'despesa',bankId:null,status:'previsto',paidDate:null,juros:0,discount:0,
    amount:parts?.length ? parse(part.amount) : recurring ? data.amount : amounts![i],installments:1,
    installment:parts?.length ? `${slot+1}/${parts.length}` : !recurring && count>1 ? `${i+1}/${count}` : undefined});
  }
 }
 return result;
}

/** Display one invoice; underlying purchases remain the only financial records. */
export function cardInvoices<T extends any>(entries: T[], cards: CreditCard[]): T[] {
 const groups = new Map<string,any[]>();
 const plain:any[]=[];
 for(const item of entries as any[]) {
  if(!item.creditCardId){plain.push(item);continue;}
  const key=`${item.creditCardId}:${item.invoiceMonth || item.date.slice(0,7)}`;
  groups.set(key,[...(groups.get(key)||[]),item]);
 }
 for(const [key,rows] of groups) {
  const sample=rows[0];
  const paid=rows.filter(e=>e.status==='realizado').reduce((s,e)=>s+Math.round(entryValue(e)*100),0)/100;
  const pending=rows.filter(e=>e.status==='previsto').reduce((s,e)=>s+Math.round(entryValue(e)*100),0)/100;
  const units=[...new Set(rows.map(e=>e.unit))];
  plain.push({...sample,id:`invoice:${key}`,seriesId:undefined,recurrence:'nenhuma',installment:undefined,
   amount:Math.round((paid+pending)*100)/100,juros:0,discount:0,status:pending>0?'previsto':'realizado',paidDate:pending>0?null:rows.map(e=>e.paidDate||e.date).sort().at(-1),bankId:[...new Set(rows.filter(e=>e.status==='realizado').map(e=>e.bankId))].length===1?rows.find(e=>e.status==='realizado')?.bankId:null,
   date:[...rows].sort((a,b)=>b.date.localeCompare(a.date))[0].date,
   description:`Fatura ${cards.find(c=>c.id===sample.creditCardId)?.name || 'do cartão'} · ${sample.invoiceMonth || sample.date.slice(0,7)}`,
   category:'Fatura de cartão',unit:units.length===1?units[0]:'Vários centros de custo',beneficiary:'',notes:`${rows.length} compra(s). Detalhes na área do cartão.`,attachments:[],
   invoiceUnits:units,invoicePaidAmount:paid,invoicePendingAmount:pending,invoiceItemCount:rows.length,invoiceSummary:true});
 }
 return plain as T[];
}

export function extendCardRecurrences(entries:any[],cards:CreditCard[],from:string,through:string,idFor:(series:string,date:string,slot:string)=>string) {
 const groups=new Map<string,any[]>();
 for(const entry of entries.filter(e=>e.creditCardId&&e.seriesId&&e.recurrence!=='nenhuma')) {
  const key=`${entry.seriesId}:${entry.installment||''}`;
  groups.set(key,[...(groups.get(key)||[]),entry]);
 }
 const result:any[]=[];
 for(const rows of groups.values()) {
  const sorted=[...rows].sort((a,b)=>(a.cardPurchaseDate||a.date).localeCompare(b.cardPurchaseDate||b.date));
  const first=sorted[0],last=sorted.at(-1)!;
  const card=cards.find(c=>c.id===last.creditCardId); if(!card)continue;
  const anchor=first.cardPurchaseDate||first.date, latest=last.cardPurchaseDate||last.date;
  let dates:string[]=[];
  if(last.recurrence==='semanal')dates=nextWeeklyDates(latest,from,through);
  else {
   const [y,m]=anchor.split('-').map(Number),[ly,lm]=latest.split('-').map(Number);
   for(let i=(ly-y)*12+lm-m+1;;i++){
    const date=addMonthsClamped(anchor,i);if(date>through)break;if(date>=from)dates.push(date);
   }
  }
  for(const purchaseDate of dates){const date=invoiceDate(purchaseDate,card);result.push({...last,id:idFor(last.seriesId,purchaseDate,last.installment||''),cardPurchaseDate:purchaseDate,date,invoiceMonth:date.slice(0,7),status:'previsto',bankId:null,paidDate:null,juros:0,discount:0});}
 }
 return result;
}
